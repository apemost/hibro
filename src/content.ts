// Hibro content script: page perception for the reading assistant and the
// agent. Provides readable text, a Markdown rendering, a structural overview,
// tagged interactive elements, viewport text, and per-element detail. It also
// renders page translations in place, one translation block under each source
// block.
// Interactive elements are tagged with a data-hibro-id attribute so the
// background worker can address them later via the debugger (CDP runs in the
// page's main world, separate from this isolated world).

import TurndownService from 'turndown';
import type { TranslationBlock } from './shared/translation';

const HIBRO_ID_ATTR = 'data-hibro-id';
// Attribute tagging a source block collected for translation.
const TRANSLATION_BLOCK_ATTR = 'data-hibro-block';
// Attribute tagging a translation this script rendered.
const TRANSLATION_NODE_ATTR = 'data-hibro-translation';
// Upper bounds on one translation run, so a long page cannot run away.
const MAX_TRANSLATION_BLOCKS = 300;
const MAX_TRANSLATION_CHARS = 40000;
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

interface TranslationCollectResponse {
  blocks: TranslationBlock[];
  truncated: boolean;
}

interface TranslationApplyResponse {
  applied: number;
}

interface TranslationRestoreResponse {
  applied: number;
  truncated: boolean;
}

interface TranslationStateResponse {
  active: boolean;
  count: number;
}

interface ContentMessage {
  type?: string;
  selector?: string;
  filter?: string;
  id?: number | string;
  items?: unknown;
  language?: string;
  target?: string;
}

const contentScriptState = globalThis as typeof globalThis & {
  __hibroContentMessageListener__?: typeof handleContentMessage;
};

// Recovery can inject this bundle before the manifest's document_idle run.
// Replace the previous listener when the bundle runs again in this document.
if (contentScriptState.__hibroContentMessageListener__) {
  chrome.runtime.onMessage.removeListener(
    contentScriptState.__hibroContentMessageListener__,
  );
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
      sendResponse({
        elements: snapshotElements(msg.filter),
      } satisfies ElementsResponse);
      break;
    case 'hibro:visible-text':
      sendResponse({ text: visibleText() } satisfies VisibleTextResponse);
      break;
    case 'hibro:element-detail':
      sendResponse(elementDetail(toId(msg.id)));
      break;
    case 'hibro:translate-collect':
      sendResponse(collectTranslationBlocks());
      break;
    case 'hibro:translate-apply':
      sendResponse({
        applied: applyTranslations(msg.items, msg.target, msg.language),
      } satisfies TranslationApplyResponse);
      break;
    case 'hibro:translate-restore':
      sendResponse({
        applied: restoreTranslations(msg.target),
        truncated: translationCache?.truncated ?? false,
      } satisfies TranslationRestoreResponse);
      break;
    case 'hibro:translate-revert':
      sendResponse({
        applied: revertTranslations(),
      } satisfies TranslationApplyResponse);
      break;
    case 'hibro:translate-state':
      sendResponse(translationState());
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
function selectSubtree(selector: string): {
  root?: HTMLElement;
  error?: string;
} {
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
      return {
        title: document.title,
        url: location.href,
        markdown: picked.error,
        truncated: false,
      };
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
    return {
      title: document.title,
      url: location.href,
      markdown: clean,
      truncated: false,
    };
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
    document.querySelector<HTMLMetaElement>('meta[name="description"]')
      ?.content ||
    document.querySelector<HTMLMetaElement>('meta[property="og:description"]')
      ?.content ||
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
    const text = truncate(
      el.innerText || (el as HTMLInputElement).value || '',
      60,
    );
    const name = el.getAttribute('name') || undefined;
    const placeholder = el.getAttribute('placeholder') || undefined;
    const href =
      el instanceof HTMLAnchorElement ? truncate(el.href, 120) : undefined;
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
    visibleText: truncate(
      document.body ? document.body.innerText : '',
      MAX_SNAPSHOT_TEXT,
    ),
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
    bbox: {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      w: Math.round(rect.width),
      h: Math.round(rect.height),
    },
  };
}

// --- Page translation ---

// Block tags that carry body text. A translation is rendered under each of
// them, so the page reads as one source block followed by its translation.
const TRANSLATABLE_BLOCK_SELECTOR =
  'p,h1,h2,h3,h4,h5,h6,li,dd,dt,blockquote,figcaption,td,th,summary';

// Page furniture and verbatim text are left alone: navigation and side rails
// are not body text, and code must stay in its original form.
const TRANSLATION_SKIP_SELECTOR =
  'nav,aside,footer,pre,code,kbd,samp,script,style,noscript,textarea,svg,[contenteditable="true"],[aria-hidden="true"],[hidden]';

// Skip markers, bullets, and bare numbers: nothing to translate there.
const TRANSLATABLE_TEXT = /\p{L}/u;
const MIN_TRANSLATION_TEXT = 2;

// Whether a child node belongs to this block's own text. Nested blocks (a list
// item's sub-list, a table cell's paragraph) are translated on their own, and
// translations Hibro already inserted are never re-read as source text.
// Children the reader cannot see are dropped too: documentation themes hang a
// permalink anchor off every heading and keep it visibility:hidden until
// hover, and its pilcrow would otherwise be sent to the model as part of the
// heading text.
function isVisibleChild(el: Element): boolean {
  if (el.getClientRects().length === 0) return false;
  return getComputedStyle(el).visibility !== 'hidden';
}

function ownsChildNode(node: Node): boolean {
  if (node.nodeType === Node.TEXT_NODE) return true;
  if (node.nodeType !== Node.ELEMENT_NODE) return false;
  const el = node as Element;
  if (el.hasAttribute(TRANSLATION_NODE_ATTR)) return false;
  if (!isVisibleChild(el)) return false;
  return (
    !el.matches(TRANSLATABLE_BLOCK_SELECTOR) &&
    !el.querySelector(TRANSLATABLE_BLOCK_SELECTOR)
  );
}

// The text a block owns directly.
function ownBlockText(el: HTMLElement): string {
  let text = '';
  for (const node of Array.from(el.childNodes)) {
    if (!ownsChildNode(node)) continue;
    text += node.textContent || '';
  }
  return text.replace(/\s+/g, ' ').trim();
}

// The child the translation is inserted before, or null to append it last.
// It goes before the first nested block (so a list item's translation lands
// above its sub-list, not after it) and otherwise at the very end. Appending
// last matters for trailing inline content the block does not own: a
// documentation theme's hidden permalink anchor would otherwise be pushed
// past the block-level translation and take a blank line of its own.
function translationAnchor(el: HTMLElement): Node | null {
  for (const node of Array.from(el.childNodes)) {
    if (node.nodeType !== Node.ELEMENT_NODE) continue;
    const child = node as Element;
    if (child.hasAttribute(TRANSLATION_NODE_ATTR)) continue;
    if (
      child.matches(TRANSLATABLE_BLOCK_SELECTOR) ||
      child.querySelector(TRANSLATABLE_BLOCK_SELECTOR)
    ) {
      return child;
    }
  }
  return null;
}

function isTranslatableBlock(el: HTMLElement): boolean {
  if (el.closest(TRANSLATION_SKIP_SELECTOR)) return false;
  if (el.closest(`[${TRANSLATION_NODE_ATTR}]`)) return false;
  // Rendered check, not a viewport check: getClientRects covers boxes below
  // the fold but drops display:none and collapsed subtrees.
  return el.getClientRects().length > 0;
}

// What the page was last translated into, kept so that hiding the translation
// and asking for the same language again costs nothing. It lives in the page,
// so a reload drops it and the next run translates afresh.
interface TranslationCache {
  target: string;
  truncated: boolean;
  items: { el: HTMLElement; text: string; language?: string }[];
}

let translationCache: TranslationCache | null = null;

// Tag the body blocks of the readable root and return their source text.
// Previous tags, translations, and the cached translation are cleared first,
// so every run starts from the untranslated page and ids are fresh and
// contiguous.
function collectTranslationBlocks(): TranslationCollectResponse {
  revertTranslations();
  translationCache = null;
  const root = readRoot();
  if (!root) return { blocks: [], truncated: false };

  const blocks: TranslationBlock[] = [];
  let chars = 0;
  let truncated = false;
  for (const el of root.querySelectorAll<HTMLElement>(
    TRANSLATABLE_BLOCK_SELECTOR,
  )) {
    if (!isTranslatableBlock(el)) continue;
    const text = ownBlockText(el);
    if (text.length < MIN_TRANSLATION_TEXT || !TRANSLATABLE_TEXT.test(text)) {
      continue;
    }
    if (
      blocks.length >= MAX_TRANSLATION_BLOCKS ||
      chars + text.length > MAX_TRANSLATION_CHARS
    ) {
      truncated = true;
      break;
    }
    const id = blocks.length + 1;
    el.setAttribute(TRANSLATION_BLOCK_ATTR, String(id));
    blocks.push({ id, text });
    chars += text.length;
  }
  translationCache = { target: '', truncated, items: [] };
  return { blocks, truncated };
}

// A phrasing-content span is valid inside every block tag this feature targets,
// and CSSOM properties survive a page CSP that would drop an injected
// stylesheet or a style attribute. The translation inherits the block's own
// styling and is separated by spacing alone, so it reads as part of the page
// rather than as an annotation stuck onto it. dir="auto" keeps right-to-left
// targets readable under a left-to-right source block.
function buildTranslationNode(
  text: string,
  language?: string,
): HTMLSpanElement {
  const node = document.createElement('span');
  node.setAttribute(TRANSLATION_NODE_ATTR, '');
  if (language) node.lang = language;
  node.dir = 'auto';
  node.textContent = text;
  node.style.display = 'block';
  node.style.marginBlockStart = '0.35em';
  return node;
}

// Render translated text under the matching source blocks. Batches arrive as
// they finish, so this runs several times per translation run, and each one
// adds to the cache that backs a later restore.
function applyTranslations(
  items: unknown,
  target?: string,
  language?: string,
): number {
  if (!Array.isArray(items)) return 0;
  if (translationCache && target) translationCache.target = target;
  let applied = 0;
  for (const entry of items as { id?: unknown; text?: unknown }[]) {
    const id = Number(entry?.id);
    const text = String(entry?.text ?? '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!Number.isFinite(id) || !text) continue;
    const el = document.querySelector<HTMLElement>(
      `[${TRANSLATION_BLOCK_ATTR}="${id}"]`,
    );
    if (!el) continue;
    el.querySelector(`:scope > [${TRANSLATION_NODE_ATTR}]`)?.remove();
    el.insertBefore(
      buildTranslationNode(text, language),
      translationAnchor(el),
    );
    translationCache?.items.push({ el, text, language });
    applied++;
  }
  return applied;
}

/**
 * Re-renders the cached translation when it was made for the same target.
 * A cached block whose element has left the document means the page moved on
 * since that run, so the whole cache is dropped and the caller translates
 * again rather than restoring a stale half of the page.
 */
function restoreTranslations(target?: string): number {
  const cache = translationCache;
  if (!cache || !target || !cache.target || cache.target !== target) return 0;
  if (cache.items.length === 0) return 0;
  if (cache.items.some((item) => !item.el.isConnected)) {
    translationCache = null;
    return 0;
  }
  let restored = 0;
  for (const item of cache.items) {
    item.el.querySelector(`:scope > [${TRANSLATION_NODE_ATTR}]`)?.remove();
    item.el.insertBefore(
      buildTranslationNode(item.text, item.language),
      translationAnchor(item.el),
    );
    restored++;
  }
  return restored;
}

// Show the untranslated page again: drop the inserted nodes and the source
// tags, leaving no Hibro markup behind. The cache survives and holds the
// elements directly, so asking for the same language again costs no model
// call even though the tags are gone.
function revertTranslations(): number {
  const nodes = document.querySelectorAll(`[${TRANSLATION_NODE_ATTR}]`);
  nodes.forEach((node) => node.remove());
  document
    .querySelectorAll(`[${TRANSLATION_BLOCK_ATTR}]`)
    .forEach((el) => el.removeAttribute(TRANSLATION_BLOCK_ATTR));
  return nodes.length;
}

// Lets the side panel show the right toggle state for the current tab. A page
// load clears the DOM, so a reloaded tab reports itself as untranslated.
function translationState(): TranslationStateResponse {
  const count = document.querySelectorAll(`[${TRANSLATION_NODE_ATTR}]`).length;
  return { active: count > 0, count };
}
