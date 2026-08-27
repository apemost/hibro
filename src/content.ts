// Hibro content script: page perception for the reading assistant and the
// agent. Provides readable text, a Markdown rendering, a structural overview,
// tagged interactive elements, viewport text, and per-element detail.
// Interactive elements are tagged with a data-hibro-id attribute so the
// background worker can address them later via the debugger (CDP runs in the
// page's main world, separate from this isolated world).

import TurndownService from 'turndown';

const HIBRO_ID_ATTR = 'data-hibro-id';
const MAX_TEXT_LENGTH = 12000;
const MAX_MARKDOWN_LENGTH = 12000;
const MAX_SNAPSHOT_TEXT = 2000;
const MAX_VISIBLE_TEXT = 4000;
const MAX_ELEMENTS = 60;

interface ExtractResponse {
  title: string;
  url: string;
  text: string;
}

interface SnapshotElement {
  id: number;
  tag: string;
  text: string;
  type?: string;
  name?: string;
  placeholder?: string;
  href?: string;
}

interface SnapshotResponse {
  title: string;
  url: string;
  visibleText: string;
  elements: SnapshotElement[];
}

interface OverviewCounts {
  links: number;
  inputs: number;
  forms: number;
}

interface OverviewResponse {
  title: string;
  url: string;
  metaDescription: string;
  heading: string;
  counts: OverviewCounts;
}

interface MarkdownResponse {
  title: string;
  url: string;
  markdown: string;
  truncated: boolean;
}

interface ElementsResponse {
  elements: SnapshotElement[];
}

interface VisibleTextResponse {
  text: string;
}

interface ElementDetailResponse {
  id: number;
  tag: string;
  role: string;
  text: string;
  value: string;
  placeholder: string;
  href: string;
  attrs: Record<string, string>;
  bbox: { x: number; y: number; w: number; h: number };
}

interface ContentMessage {
  type?: string;
  selector?: string;
  filter?: string;
  id?: number | string;
}

const contentScriptState = globalThis as typeof globalThis & {
  __hibroContentMessageListener__?: typeof handleContentMessage;
};

// Recovery can inject this bundle before the manifest's document_idle run.
// Replace the previous listener when the bundle runs again in this document.
if (contentScriptState.__hibroContentMessageListener__) {
  chrome.runtime.onMessage.removeListener(contentScriptState.__hibroContentMessageListener__);
}
chrome.runtime.onMessage.addListener(handleContentMessage);
contentScriptState.__hibroContentMessageListener__ = handleContentMessage;

function handleContentMessage(
  msg: ContentMessage,
  _sender: chrome.runtime.MessageSender,
  sendResponse: (response: unknown) => void,
): void {
  if (!msg || typeof msg.type !== 'string') return;
  switch (msg.type) {
    case 'hibro:extract':
      sendResponse(extractPage());
      break;
    case 'hibro:snapshot':
      sendResponse(collectSnapshot());
      break;
    case 'hibro:markdown':
      sendResponse(toMarkdown(msg.selector));
      break;
    case 'hibro:overview':
      sendResponse(getOverview());
      break;
    case 'hibro:elements':
      sendResponse({ elements: snapshotElements(msg.filter) } satisfies ElementsResponse);
      break;
    case 'hibro:visible-text':
      sendResponse({ text: visibleText() } satisfies VisibleTextResponse);
      break;
    case 'hibro:element-detail':
      sendResponse(elementDetail(toId(msg.id)));
      break;
  }
}

function toId(value: number | string | undefined): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : NaN;
}

function truncate(text: unknown, max: number): string {
  const clean = String(text || '')
    .replace(/\s+/g, ' ')
    .trim();
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

// Pick the main readable root: the primary content container, falling back to
// the whole body.
function readRoot(): HTMLElement {
  return (
    document.querySelector<HTMLElement>('article') ||
    document.querySelector<HTMLElement>('main') ||
    document.querySelector<HTMLElement>('[role="main"]') ||
    document.body
  );
}

// Resolve the model's CSS selector to a subtree root. A syntactically invalid
// selector makes querySelector throw; uncaught, that escapes the message
// listener and the model only sees an opaque "message port closed" tool error.
// A valid selector that matches nothing must not silently fall back to the
// whole body either. Both cases return an explanatory notice for the model so
// it can retry with a different selector or omit it.
function selectSubtree(selector: string): { root?: HTMLElement; error?: string } {
  let root: HTMLElement | null;
  try {
    root = document.querySelector<HTMLElement>(selector);
  } catch {
    return {
      error: `Error: the selector "${selector}" is syntactically invalid. Retry with a valid CSS selector, or omit the selector to read the main content.`,
    };
  }
  if (!root) {
    return {
      error: `Error: no element matches the selector "${selector}". Retry with a different selector, or omit it to read the main content.`,
    };
  }
  return { root };
}

// Extract the main readable text of the page for summarization and Q&A.
function extractPage(): ExtractResponse {
  const root = readRoot();
  return {
    title: document.title,
    url: location.href,
    text: truncate(root ? root.innerText : '', MAX_TEXT_LENGTH),
  };
}

// Render the page (or a subtree) as Markdown via Turndown. Turndown's browser
// build uses the native DOM and is CSP-clean (no eval/Function), so it is safe
// inside the extension. Non-content noise is stripped before conversion.
function toMarkdown(selector?: string): MarkdownResponse {
  let root: HTMLElement | undefined;
  if (selector) {
    const picked = selectSubtree(selector);
    // The notice travels in the markdown field: the service worker forwards it
    // to the model as the tool result, which can then correct the call.
    if (picked.error) {
      return { title: document.title, url: location.href, markdown: picked.error, truncated: false };
    }
    root = picked.root;
  } else {
    root = readRoot();
  }
  const td = new TurndownService({
    headingStyle: 'atx',
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
  });
  td.remove(['script', 'style', 'noscript', 'iframe', 'template']);
  const full = td.turndown((root || document.body) as HTMLElement);
  const clean = full
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
  if (clean.length <= MAX_MARKDOWN_LENGTH) {
    return { title: document.title, url: location.href, markdown: clean, truncated: false };
  }
  return {
    title: document.title,
    url: location.href,
    markdown: `${clean.slice(0, MAX_MARKDOWN_LENGTH)}…`,
    truncated: true,
  };
}

// A cheap structural first look: identity + counts. No LLM, no big payload.
// The agent uses this to decide which perception tool to call next.
function getOverview(): OverviewResponse {
  const meta =
    document.querySelector<HTMLMetaElement>('meta[name="description"]')?.content ||
    document.querySelector<HTMLMetaElement>('meta[property="og:description"]')?.content ||
    '';
  const heading =
    document.querySelector('h1')?.textContent ||
    document.querySelector('title')?.textContent ||
    '';
  return {
    title: document.title,
    url: location.href,
    metaDescription: truncate(meta, 300),
    heading: truncate(heading, 200),
    counts: {
      links: document.querySelectorAll('a[href]').length,
      inputs: document.querySelectorAll('input,textarea,select').length,
      forms: document.querySelectorAll('form').length,
    },
  };
}

// Tag visible interactive elements and return them. Previous tags are cleared
// first so ids are always fresh and contiguous for the caller. An optional
// filter (case-insensitive substring over text/href/name/placeholder) narrows
// candidates before the 60-result cap is applied.
function snapshotElements(filter?: string): SnapshotElement[] {
  document.querySelectorAll(`[${HIBRO_ID_ATTR}]`).forEach((el) => {
    el.removeAttribute(HIBRO_ID_ATTR);
  });

  const needle = filter ? filter.trim().toLowerCase() : '';
  const candidates = document.querySelectorAll<HTMLElement>(
    'a, button, input, textarea, select, [role="button"], [role="link"], [contenteditable="true"], summary',
  );
  const elements: SnapshotElement[] = [];
  for (const el of candidates) {
    if (!el.getClientRects().length) continue;
    const tag = el.tagName.toLowerCase();
    const text = truncate(el.innerText || (el as HTMLInputElement).value || '', 60);
    const name = el.getAttribute('name') || undefined;
    const placeholder = el.getAttribute('placeholder') || undefined;
    const href = el instanceof HTMLAnchorElement ? truncate(el.href, 120) : undefined;
    if (
      needle &&
      ![text, href, name, placeholder, tag]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(needle))
    ) {
      continue;
    }
    if (elements.length >= MAX_ELEMENTS) break;
    const id = elements.length + 1;
    el.setAttribute(HIBRO_ID_ATTR, String(id));
    elements.push({
      id,
      tag,
      text,
      type: el.getAttribute('type') || undefined,
      name,
      placeholder,
      href,
    });
  }

  return elements;
}

// Legacy snapshot kept for compatibility: visible text + tagged elements.
function collectSnapshot(): SnapshotResponse {
  return {
    title: document.title,
    url: location.href,
    visibleText: truncate(document.body ? document.body.innerText : '', MAX_SNAPSHOT_TEXT),
    elements: snapshotElements(),
  };
}

// Text currently in the viewport; the agent reads this after scrolling instead
// of re-reading the whole page. Collects the direct (leaf) text of block
// elements whose box intersects the viewport.
function visibleText(): string {
  const vh = window.innerHeight || document.documentElement.clientHeight || 0;
  const lines: string[] = [];
  const blocks = document.querySelectorAll<HTMLElement>(
    'h1,h2,h3,h4,h5,h6,p,li,td,th,span,a,button,label,blockquote,pre,code,div',
  );
  blocks.forEach((el) => {
    if (lines.length >= 200) return;
    const ownText = Array.from(el.childNodes)
      .filter((n) => n.nodeType === Node.TEXT_NODE)
      .map((n) => n.textContent || '')
      .join('')
      .replace(/\s+/g, ' ')
      .trim();
    if (!ownText) return;
    const r = el.getBoundingClientRect();
    if (r.height <= 0 || r.top >= vh || r.bottom <= 0) return;
    // No per-block length cap: long article paragraphs were being dropped here
    // entirely, leaving get_visible_text with only headings/labels. The overall
    // output is still bounded below by truncate(MAX_VISIBLE_TEXT).
    lines.push(ownText);
  });
  return truncate(lines.join('\n'), MAX_VISIBLE_TEXT);
}

// Rich detail for one tagged element. Requires a prior list/snapshot call to
// have assigned the data-hibro-id; returns null otherwise so the agent re-lists.
function elementDetail(id: number): ElementDetailResponse | null {
  if (!Number.isFinite(id)) return null;
  const el = document.querySelector<HTMLElement>(`[${HIBRO_ID_ATTR}="${id}"]`);
  if (!el) return null;
  const rect = el.getBoundingClientRect();
  const attrs: Record<string, string> = {};
  let attrCount = 0;
  for (const attr of Array.from(el.attributes)) {
    if (attr.name === HIBRO_ID_ATTR) continue;
    if (attrCount >= 20) break;
    attrs[attr.name] = truncate(attr.value, 120);
    attrCount++;
  }
  return {
    id,
    tag: el.tagName.toLowerCase(),
    role: el.getAttribute('role') || '',
    text: truncate(el.innerText || '', 300),
    value: 'value' in el ? String((el as HTMLInputElement).value ?? '') : '',
    placeholder: el.getAttribute('placeholder') || '',
    href: el instanceof HTMLAnchorElement ? truncate(el.href, 200) : '',
    attrs,
    bbox: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
  };
}
