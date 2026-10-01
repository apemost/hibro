// Runs model requests, page tools, and side-panel messaging in the extension
// service worker. Provider credentials come from extension storage.

import { streamText, tool, isStepCount } from 'ai';
import { z } from 'zod';
import {
  resolveActiveSkills,
  buildSkillInstructions,
  buildSkillSummary,
} from './skills';
import { cdpClick, cdpType, cdpScroll, cdpNavigate, cdpPressKey } from './cdp';
import type { HibroHistoryMessage, PanelEvent } from './shared/protocol';
import { ProviderConsentRequiredError, friendlyError } from './errors';
import { callAI, getModel } from './model';
import { sendToTab } from './tabMessaging';
import {
  normalizeImageMediaType,
  decodeImageBase64,
} from './shared/imageAssets';
import { REMOTE_IMAGE_PORT } from './shared/remoteImages';
import { attachRemoteImagePort } from './remoteImages';
import { TRANSLATE_PORT } from './shared/translation';
import {
  attachTranslatePort,
  resolveTranslationTarget,
  translatePage,
} from './translate';

// Page perception does not need extension storage; keep it in trusted contexts.
void chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });

interface SendMessage {
  type: 'send';
  text: string;
  tabId: number;
  history?: HibroHistoryMessage[];
  // Lets the worker tell the model when the active tab changed between turns.
  previousPageUrl?: string;
}

interface ControlMessage {
  type: 'stop' | 'ping';
}

type PanelMessage = SendMessage | ControlMessage;

// Every request uses tools, including ordinary page questions.
const MAX_AGENT_STEPS = 255;

chrome.runtime.onConnect.addListener((port) => {
  if (port.name === REMOTE_IMAGE_PORT) {
    attachRemoteImagePort(port);
    return;
  }
  if (port.name === TRANSLATE_PORT) {
    attachTranslatePort(port);
    return;
  }
  if (port.name !== 'hibro-panel') return;
  let abortController: AbortController | null = null;
  // Drop late events from a request that has already been replaced.
  let runSeq = 0;
  port.onDisconnect.addListener(() => {
    abortController?.abort();
  });
  port.onMessage.addListener((msg: PanelMessage) => {
    void (async () => {
      if (msg.type !== 'send') {
        if (msg.type === 'stop') abortController?.abort();
        // Ping keeps the service worker awake during a long model request.
        return;
      }
      // Only one request may stream over this port at a time.
      abortController?.abort();
      abortController = new AbortController();
      const runId = ++runSeq;
      const scopedEmit = (event: PanelEvent) => {
        if (runId === runSeq) emit(port, event);
      };
      try {
        await handleSend(scopedEmit, msg, abortController.signal);
      } catch (err) {
        scopedEmit({
          type: 'error',
          text: friendlyError(err),
          ...(err instanceof ProviderConsentRequiredError
            ? { action: 'open-provider-settings' as const }
            : {}),
        });
      }
    })();
  });
});

function emit(port: chrome.runtime.Port, event: PanelEvent): void {
  try {
    port.postMessage(event);
  } catch {
    // Panel was closed; nothing to do.
  }
}

// --- AI ---

// Flattens the panel's part-typed history into plain user/assistant text turns.
// Only text parts are carried back; reasoning and tool steps are display-only
// and are not resent to the model.
function flattenHistory(
  history: HibroHistoryMessage[] | undefined,
): { role: 'user' | 'assistant'; content: string }[] {
  if (!Array.isArray(history)) return [];
  return history
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({
      role: m.role,
      content:
        m.parts
          .filter((p) => p.type === 'text')
          .map((p) => p.text)
          .join('') || '(no text)',
    }));
}

// --- The assistant loop ---

const ASSISTANT_SYSTEM_PROMPT = [
  "You are a browser assistant for the current web page. You answer questions about the page, and you can operate the page with tools. Complete the user's request by calling tools when needed, then write a final answer.",
  '',
  'Work by progressive perception: each user message arrives with only a cheap structural overview of the page, never the full page content. Perceive what you need with tools, and do not assume page state you have not perceived.',
  '1. To answer a question about the page, first read the relevant part with read_page_as_markdown (article text, optionally scoped by CSS selector) or get_visible_text (what is on screen), then ground the answer in what you read. Never invent page content. Answer directly only when the overview or the conversation already covers the question.',
  '2. Before acting, call list_interactive_elements to see clickable/typeable elements and their ids. Element ids come ONLY from list_interactive_elements and are valid only until the page changes.',
  '3. After an action that changes the page (a click that navigates, navigate, or a submit), re-perceive before the next action; ids and content may have changed.',
  "4. When the request is complete or you cannot proceed, stop calling tools and write a concise final answer in the user's language.",
  '',
  'Tools:',
  '- get_page_overview(): title, url, meta description, main heading, and counts of links/inputs/forms.',
  '- list_interactive_elements({ filter? }): visible interactive elements, each with an id. Call before click/type/get_element_detail.',
  '- get_element_detail({ id }): tag, role, text, attributes, value, bounding box for one element.',
  '- get_visible_text(): text currently in the viewport (use after scrolling).',
  '- read_page_as_markdown({ selector? }): the page or a subtree as Markdown.',
  '- translate_page({ targetLanguage? }): translate the page body in place, rendering each translation under its source block. Use it when the user asks for the page itself to be translated, not when they ask you to translate a passage inside your answer.',
  '- click({ id }), type({ id, text, submit? }), scroll({ direction?, amount?, selector? }), navigate({ url }), press_key({ key }).',
  '',
  'Rules:',
  '- Do not perform irreversible actions (deleting, paying, publishing, submitting sensitive forms) unless the user explicitly asks.',
  '- Element ids are short-lived: if click/type reports an element was not found, call list_interactive_elements again and retry.',
  '- If the request is unrelated to the page, say so briefly and answer as helpfully as you can.',
  '- Format the final answer in Markdown.',
  'The panel renders two extra fenced block types. Use a ```mermaid block with Mermaid syntax when a diagram',
  '(flowchart, sequence, class, state, ER, gantt, mindmap, timeline, …) would explain the answer better than text.',
  'Use a ```chart block when a data chart would help. Its body must be pure JSON with no functions or comments.',
  'Use "type" (bar, line, pie, or scatter) and a non-empty "datasets" array. Bar, line, and pie charts require',
  'a matching "labels" array and numeric data. Scatter data uses [x, y] pairs.',
  'Example: ```chart {"type":"bar","labels":["Q1","Q2"],"datasets":[{"label":"Revenue","data":[3,5]}]} ```.',
  'A ```html block can be toggled into a static preview: scripts never run and external resources never load,',
  'so write it self-contained with inline styles and data: images only.',
].join('\n');

// Surfaces a tool call to the panel as a tool-invocation part (input-available,
// then output-available/output-error) and returns the tool's result. A failure
// is returned as a structured {isError:true, error} object the SDK feeds back,
// so the model gets a typed error instead of a prose string. Emissions go
// through the run-scoped emit so a superseded run cannot update the panel.
async function runWithCard<T>(
  emit: (event: PanelEvent) => void,
  toolCallId: string,
  toolName: string,
  input: Record<string, unknown>,
  fn: () => Promise<T>,
): Promise<unknown> {
  emit({
    type: 'part-add',
    part: {
      type: 'tool-invocation',
      toolCallId,
      toolName,
      state: 'input-available',
      input,
    },
  });
  try {
    const output = await fn();
    emit({
      type: 'tool-update',
      toolCallId,
      state: 'output-available',
      output: output as unknown,
    });
    return output;
  } catch (err) {
    const errorText = err instanceof Error ? err.message : String(err);
    emit({ type: 'tool-update', toolCallId, state: 'output-error', errorText });
    return { isError: true, error: errorText };
  }
}

// Every message runs through one streaming tool-calling loop: the model decides
// per message whether to answer from the overview, read more of the page with
// perception tools, or act on the page. The earlier chat/task intent router
// (one extra model call per send) is gone. `emit` is run-scoped by the caller:
// events from a superseded run are dropped before reaching the port.
async function handleSend(
  emit: (event: PanelEvent) => void,
  msg: SendMessage,
  signal: AbortSignal,
): Promise<void> {
  const tabId = msg.tabId;
  // Resolve site skills for the active tab once and fold them into the system
  // prompt: the name + description summary keeps "what skills do you have"
  // answerable, and the instruction bodies guide acting on the page.
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  const tabUrl = tab?.url || tab?.pendingUrl || '';
  const skills = await resolveActiveSkills(tabUrl);
  const promptParts = [ASSISTANT_SYSTEM_PROMPT];
  const skillSummary = buildSkillSummary(skills);
  const skillInstructions = buildSkillInstructions(skills);
  if (skillSummary) promptParts.push(skillSummary);
  if (skillInstructions) promptParts.push(skillInstructions);
  const systemPrompt = promptParts.join('\n\n');

  emit({ type: 'run-start' });
  emit({ type: 'status', text: 'Reading the page…' });
  // Progressive perception: seed the run with a cheap overview only. The model
  // perceives the rest on demand via tools, instead of receiving a full
  // snapshot up front. A page we cannot reach at all (restricted scheme, or an
  // orphaned content script) fails fast with the friendly communication error:
  // the loop can neither read nor reliably act on such a page.
  const overview = await sendToTab<Record<string, unknown>>(tabId, {
    type: 'hibro:overview',
  });

  let callSeq = 0;
  const cardId = (name: string) => `call-${++callSeq}-${name}`;

  const tools = {
    get_page_overview: tool({
      description:
        'Structural overview of the current page: title, URL, meta description, main heading, and counts of links/inputs/forms. Cheap first look.',
      inputSchema: z.object({}),
      execute: async () =>
        runWithCard(emit, cardId('overview'), 'get_page_overview', {}, () =>
          sendToTab(tabId, { type: 'hibro:overview' }),
        ),
    }),
    list_interactive_elements: tool({
      description:
        'List visible interactive elements (links, buttons, inputs, selects) each with a stable id used by click/type/get_element_detail. Optional filter narrows by text/href/name (case-insensitive). Call before acting on elements.',
      inputSchema: z.object({ filter: z.string().optional() }),
      execute: async ({ filter }) =>
        runWithCard(
          emit,
          cardId('elements'),
          'list_interactive_elements',
          { filter },
          async () => {
            const r = await sendToTab<{ elements: unknown[] }>(tabId, {
              type: 'hibro:elements',
              filter,
            });
            return r.elements;
          },
        ),
    }),
    get_element_detail: tool({
      description:
        'Rich detail for one element by id: tag, role, text, attributes, value, bounding box. Requires a prior list_interactive_elements call.',
      inputSchema: z.object({ id: z.number().int() }),
      execute: async ({ id }) =>
        runWithCard(emit, cardId('detail'), 'get_element_detail', { id }, () =>
          sendToTab(tabId, { type: 'hibro:element-detail', id }),
        ),
    }),
    get_visible_text: tool({
      description:
        'Text currently visible in the viewport. Use after scrolling.',
      inputSchema: z.object({}),
      execute: async () =>
        runWithCard(
          emit,
          cardId('visibletext'),
          'get_visible_text',
          {},
          async () => {
            const r = await sendToTab<{ text: string }>(tabId, {
              type: 'hibro:visible-text',
            });
            return r.text;
          },
        ),
    }),
    read_page_as_markdown: tool({
      description:
        'Read the current page (or a subtree by CSS selector) as Markdown. Omit selector for the main content.',
      inputSchema: z.object({ selector: z.string().optional() }),
      execute: async ({ selector }) =>
        runWithCard(
          emit,
          cardId('markdown'),
          'read_page_as_markdown',
          { selector },
          async () => {
            const r = await sendToTab<{ markdown: string; truncated: boolean }>(
              tabId,
              {
                type: 'hibro:markdown',
                selector,
              },
            );
            return r.truncated
              ? `${r.markdown}\n\n[content truncated]`
              : r.markdown;
          },
        ),
    }),
    translate_page: tool({
      description:
        'Translate the body of the current page in place: every source block keeps its text and gets its translation rendered right underneath. Omit targetLanguage to use the language configured in Settings.',
      inputSchema: z.object({ targetLanguage: z.string().optional() }),
      execute: async ({ targetLanguage }, { abortSignal }) =>
        runWithCard(
          emit,
          cardId('translate'),
          'translate_page',
          { targetLanguage },
          async () => {
            const target = await resolveTranslationTarget(targetLanguage);
            const result = await translatePage(tabId, target, {
              signal: abortSignal,
            });
            if (result.total === 0) {
              return 'No translatable body text was found on this page.';
            }
            const truncated = result.truncated
              ? ' The page was too long to translate in one run, so only its first part was translated.'
              : '';
            if (result.restored) {
              return `This page already held a ${result.targetName} translation, so it was shown again without translating anything anew (${result.count} blocks).${truncated}`;
            }
            return `Translated ${result.count} of ${result.total} page blocks into ${result.targetName}. The original text is still on the page, with each translation shown underneath it.${truncated}`;
          },
        ),
    }),
    click: tool({
      description:
        'Click an interactive element by id (scrolls it into view first).',
      inputSchema: z.object({ id: z.union([z.number(), z.string()]) }),
      execute: async ({ id }, { abortSignal }) =>
        runWithCard(emit, cardId('click'), 'click', { id }, () =>
          cdpClick(tabId, id, abortSignal),
        ),
    }),
    type: tool({
      description:
        'Type text into an input/textarea/contenteditable by id. Appends to existing text. Set submit:true to press Enter afterwards (e.g. to submit a search).',
      inputSchema: z.object({
        id: z.union([z.number(), z.string()]),
        text: z.string(),
        submit: z.boolean().optional(),
      }),
      execute: async (args, { abortSignal }) =>
        runWithCard(emit, cardId('type'), 'type', args, () =>
          cdpType(tabId, args, abortSignal),
        ),
    }),
    scroll: tool({
      description:
        'Scroll the page by direction (up/down, default amount 600px), or scroll a CSS-selector element into view.',
      inputSchema: z.object({
        direction: z.enum(['up', 'down']).optional(),
        amount: z.number().int().optional(),
        selector: z.string().optional(),
      }),
      execute: async (args, { abortSignal }) =>
        runWithCard(emit, cardId('scroll'), 'scroll', args, () =>
          cdpScroll(tabId, args, abortSignal),
        ),
    }),
    navigate: tool({
      description: 'Navigate the tab to a URL (waits for the page to load).',
      inputSchema: z.object({ url: z.string() }),
      execute: async ({ url }, { abortSignal }) =>
        runWithCard(emit, cardId('navigate'), 'navigate', { url }, () =>
          cdpNavigate(tabId, url, abortSignal),
        ),
    }),
    press_key: tool({
      description:
        'Press a keyboard key: a single printable character, or a named key — Enter, Tab, Escape, Backspace, Delete, Home, End, PageUp, PageDown, Space, ArrowUp/Down/Left/Right, F1-F12. Any other multi-character name errors. Pass the target element id (from list_interactive_elements) when a specific field should receive the key.',
      inputSchema: z.object({
        key: z.string(),
        id: z.union([z.number(), z.string()]).optional(),
      }),
      execute: async ({ key, id }, { abortSignal }) =>
        runWithCard(emit, cardId('press'), 'press_key', { key, id }, () =>
          cdpPressKey(tabId, key, id, abortSignal),
        ),
    }),
  };

  emit({ type: 'status', text: 'Working…' });
  const history = flattenHistory(msg.history).slice(-10);
  // The overview metadata is the only page context sent up front; the full
  // page content is never preloaded (the model reads it on demand via tools).
  // When the tab's URL differs from the URL this conversation last ran on,
  // flag the change so the model re-perceives instead of trusting stale reads.
  const pageUrl = (typeof overview.url === 'string' && overview.url) || tabUrl;
  const pageChanged = Boolean(
    msg.previousPageUrl && pageUrl && msg.previousPageUrl !== pageUrl,
  );
  const pageContext = [
    ...(pageChanged
      ? [
          `[The page changed since this conversation's last message: it was ${msg.previousPageUrl}, now it is ${pageUrl}. Earlier reads of the page no longer apply; perceive the new page with tools before relying on its content.]`,
        ]
      : []),
    `Current page overview:\n${JSON.stringify(overview, null, 2)}`,
  ].join('\n\n');
  let full = '';
  let sawImageAsset = false;
  // Set when the run ended because stopWhen hit the step cap with the model
  // still calling tools (as opposed to finishing or being stopped).
  let cappedByStepLimit = false;
  try {
    const result = streamText({
      model: await getModel(),
      instructions: systemPrompt,
      messages: [
        ...history,
        {
          role: 'user' as const,
          content: `${msg.text}\n\n${pageContext}`,
        },
      ],
      tools,
      stopWhen: isStepCount(MAX_AGENT_STEPS),
      temperature: 0.3,
      abortSignal: signal,
    });
    for await (const part of result.fullStream) {
      if (part.type === 'text-delta') {
        full += part.text;
        emit({ type: 'part-delta', partType: 'text', delta: part.text });
      } else if (part.type === 'reasoning-delta') {
        emit({ type: 'part-delta', partType: 'reasoning', delta: part.text });
      } else if (part.type === 'file') {
        const mediaType = normalizeImageMediaType(part.file.mediaType);
        const base64 = part.file.base64;
        const bytes = mediaType ? decodeImageBase64(base64, mediaType) : null;
        if (mediaType && bytes) {
          sawImageAsset = true;
          emit({
            type: 'part-add',
            part: {
              type: 'image-asset',
              provenance: 'provider-inline',
              mediaType,
              base64,
              byteLength: bytes.byteLength,
            },
          });
        }
      } else if (part.type === 'error') {
        throw part.error instanceof Error
          ? part.error
          : new Error(String(part.error));
      }
      // Tool calls run inside each tool's execute (surfaced via runWithCard);
      // the stream's tool-call/tool-result parts need no handling here.
    }
    // stopWhen (isStepCount) ends the loop without any stream signal: detect a
    // run cut off at the cap (max steps reached, and the last step still ended
    // in tool calls) so it can be surfaced instead of stopping silently.
    const steps = await result.steps;
    const lastStep = steps[steps.length - 1];
    cappedByStepLimit =
      steps.length >= MAX_AGENT_STEPS &&
      lastStep?.finishReason === 'tool-calls';
  } catch (err) {
    if (signal.aborted) {
      emit({ type: 'part-add', part: { type: 'text', text: 'Stopped.' } });
      emit({ type: 'run-end' });
      return;
    }
    throw err;
  }

  if (signal.aborted) {
    emit({ type: 'part-add', part: { type: 'text', text: 'Stopped.' } });
  } else if (cappedByStepLimit) {
    // The step cap stopped the run mid-task: say so explicitly (even when an
    // earlier step already produced text) instead of the misleading empty-
    // answer placeholder or silence.
    emit({
      type: 'part-add',
      part: {
        type: 'text',
        text: `Reached the maximum number of steps (${MAX_AGENT_STEPS}); the task may be incomplete — send a follow-up to continue.`,
      },
    });
  } else if (!full.trim() && !sawImageAsset) {
    emit({
      type: 'part-add',
      part: {
        type: 'text',
        text: '(The assistant finished without producing a final answer.)',
      },
    });
  }
  emit({ type: 'run-end' });
}

// --- Selection explain ---

interface ExplainMessage {
  type?: string;
  text?: string;
  title?: string;
  url?: string;
}

const EXPLAIN_SYSTEM_PROMPT = [
  'You are a reading assistant. The user selected an excerpt from your conversation about the current web page.',
  'Explain it concisely: the meaning, key terms, and why it matters in context.',
  'Reply in the same language as the excerpt, as plain text (no Markdown).',
].join(' ');

// One-off runtime message carrying the panel's selection-explain requests.
// Panel run traffic uses the long-lived port and never reaches this listener.
chrome.runtime.onMessage.addListener(
  (msg: ExplainMessage, _sender, sendResponse: (response: unknown) => void) => {
    if (!msg || msg.type !== 'hibro:explain') return;
    void handleExplain(msg)
      .then((text) => sendResponse({ ok: true, text }))
      .catch((err: unknown) =>
        sendResponse({ ok: false, error: friendlyError(err) }),
      );
    return true; // keep the channel open for the async response
  },
);

async function handleExplain(msg: ExplainMessage): Promise<string> {
  return callAI([
    { role: 'system', content: EXPLAIN_SYSTEM_PROMPT },
    {
      role: 'user',
      content: `Page: ${msg.title || '(untitled)'} (${msg.url || 'unknown'})\n\nExcerpt:\n${String(msg.text ?? '')}`,
    },
  ]);
}
