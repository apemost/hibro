// In-page translation: collect the body blocks of the active tab, translate
// them in batches, and render each translation under its source block. The
// toolbar popup drives this over the translation port, and the assistant loop
// reaches the same engine through the translate_page tool.

import { callAI } from './model';
import { friendlyError } from './errors';
import {
  PANEL_PAGE_PATH,
  POPUP_PAGE_PATH,
  isTrustedExtensionPort,
} from './panelPort';
import { probeTab, sendToTab } from './tabMessaging';
import {
  TRANSLATION_LANGUAGES,
  readTranslationTarget,
  translationLanguageName,
} from './shared/language';
import type {
  TranslateEvent,
  TranslateRequest,
  TranslationBlock,
  TranslationTarget,
} from './shared/translation';

// Batches keep each model call small enough to come back whole, and running a
// few at once keeps a long page from translating one paragraph at a time.
const BATCH_BLOCKS = 20;
const BATCH_CHARS = 1600;
const BATCH_CONCURRENCY = 3;

// Free-form target names come from the model, so they are bounded before they
// reach the prompt.
const MAX_TARGET_NAME = 40;

export interface TranslationRunResult {
  /** Blocks that received a translation. */
  count: number;
  /** Blocks collected from the page. */
  total: number;
  /** Set when the page was longer than one run's block or character budget. */
  truncated: boolean;
  /** Set when the page already held this translation and it was shown again. */
  restored: boolean;
  targetName: string;
}

export interface TranslationState {
  active: boolean;
  count: number;
  running: boolean;
}

// Runs are tracked per tab rather than per port. Translations are written into
// the page, not into the surface that asked for them, so a popup that closes
// the moment the user looks away must not cancel the work it just started.
const activeRuns = new Map<number, AbortController>();

/** Stops the translation run on a tab, if one is still working. */
export function cancelPageTranslation(tabId: number): void {
  activeRuns.get(tabId)?.abort();
  activeRuns.delete(tabId);
}

/**
 * Resolves the language a run translates into. An empty request falls back to
 * the target configured in Settings; a named language is matched against the
 * configurable list so the inserted nodes can carry a BCP-47 tag, and is
 * otherwise passed through as a prompt-only target.
 */
export async function resolveTranslationTarget(
  requested?: string,
): Promise<TranslationTarget> {
  const raw = String(requested ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_TARGET_NAME);
  if (!raw) {
    const code = await readTranslationTarget();
    return { code, name: translationLanguageName(code) };
  }
  const needle = raw.toLowerCase();
  const known = TRANSLATION_LANGUAGES.find(
    (entry) =>
      entry.code.toLowerCase() === needle ||
      entry.label.toLowerCase() === needle ||
      entry.english.toLowerCase() === needle,
  );
  return known
    ? { code: known.code, name: translationLanguageName(known.code) }
    : { name: raw };
}

function translationInstructions(target: string): string {
  return [
    `You translate web page text into ${target}.`,
    'The user message lists page segments, one per line, each starting with a [[n]] marker.',
    `Translate every segment into ${target} and reply with one line per segment, in the same order, each starting with the same [[n]] marker.`,
    'Reply with those lines and nothing else: no commentary, no blank lines, no Markdown, no code fences.',
    'Keep URLs, code identifiers, product names, and numbers as they are.',
    `Repeat a segment unchanged when it is already written in ${target}.`,
  ].join('\n');
}

function batchBlocks(blocks: TranslationBlock[]): TranslationBlock[][] {
  const batches: TranslationBlock[][] = [];
  let current: TranslationBlock[] = [];
  let chars = 0;
  for (const block of blocks) {
    if (
      current.length > 0 &&
      (current.length >= BATCH_BLOCKS ||
        chars + block.text.length > BATCH_CHARS)
    ) {
      batches.push(current);
      current = [];
      chars = 0;
    }
    current.push(block);
    chars += block.text.length;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

const MARKER_LINE = /^\s*\[\[(\d+)\]\]\s?(.*)$/;

// Reads the marker protocol back. A model that wraps a long segment over
// several lines still lands in the right block, and a marker the batch did not
// ask for is dropped instead of overwriting an unrelated block.
function parseTranslatedLines(
  reply: string,
  requested: Set<number>,
): TranslationBlock[] {
  const byId = new Map<number, string>();
  let current: number | null = null;
  for (const raw of reply.split('\n')) {
    const match = MARKER_LINE.exec(raw);
    if (match) {
      const id = Number(match[1]);
      current = requested.has(id) ? id : null;
      if (current !== null) byId.set(current, match[2].trim());
      continue;
    }
    const line = raw.trim();
    if (current === null || !line || line.startsWith('```')) continue;
    byId.set(current, `${byId.get(current) ?? ''} ${line}`.trim());
  }
  return [...byId]
    .map(([id, text]) => ({ id, text }))
    .filter((entry) => entry.text.length > 0);
}

async function translateBatch(
  batch: TranslationBlock[],
  target: string,
  signal?: AbortSignal,
): Promise<TranslationBlock[]> {
  const reply = await callAI(
    [
      { role: 'system', content: translationInstructions(target) },
      {
        role: 'user',
        content: batch
          .map((block) => `[[${block.id}]] ${block.text}`)
          .join('\n'),
      },
    ],
    signal,
  );
  return parseTranslatedLines(reply, new Set(batch.map((block) => block.id)));
}

/**
 * Translates the body of a tab in place. Each batch is rendered as soon as it
 * returns, so a long page fills in progressively instead of staying blank
 * until the last call finishes.
 */
export async function translatePage(
  tabId: number,
  target: TranslationTarget,
  options: {
    signal?: AbortSignal;
    onProgress?: (done: number, total: number) => void;
  } = {},
): Promise<TranslationRunResult> {
  const { onProgress } = options;
  // A new run supersedes whatever was still translating this tab, and the
  // caller's own signal (the assistant loop's step abort) still cancels it.
  cancelPageTranslation(tabId);
  const controller = new AbortController();
  activeRuns.set(tabId, controller);
  const signal = controller.signal;
  if (options.signal) {
    if (options.signal.aborted) controller.abort();
    else {
      options.signal.addEventListener('abort', () => controller.abort(), {
        once: true,
      });
    }
  }
  try {
    return await runTranslation(tabId, target, signal, onProgress);
  } finally {
    if (activeRuns.get(tabId) === controller) activeRuns.delete(tabId);
  }
}

async function runTranslation(
  tabId: number,
  target: TranslationTarget,
  signal: AbortSignal,
  onProgress?: (done: number, total: number) => void,
): Promise<TranslationRunResult> {
  // Showing a translation the page already holds for this target costs no
  // model call. The cache lives in the page, so a reload drops it.
  const cached = await sendToTab<{ applied?: number; truncated?: boolean }>(
    tabId,
    { type: 'hibro:translate-restore', target: target.name },
  );
  const restored = cached?.applied ?? 0;
  if (restored > 0) {
    onProgress?.(restored, restored);
    return {
      count: restored,
      total: restored,
      truncated: Boolean(cached?.truncated),
      restored: true,
      targetName: target.name,
    };
  }

  const collected = await sendToTab<{
    blocks?: TranslationBlock[];
    truncated?: boolean;
  }>(tabId, { type: 'hibro:translate-collect' });
  const blocks = Array.isArray(collected?.blocks) ? collected.blocks : [];
  const truncated = Boolean(collected?.truncated);
  const base = {
    total: blocks.length,
    truncated,
    restored: false,
    targetName: target.name,
  };
  if (blocks.length === 0) return { count: 0, ...base };

  const batches = batchBlocks(blocks);
  let nextBatch = 0;
  let done = 0;
  let applied = 0;
  onProgress?.(0, blocks.length);

  const runBatches = async (): Promise<void> => {
    while (nextBatch < batches.length) {
      if (signal.aborted) return;
      const batch = batches[nextBatch++];
      const items = await translateBatch(batch, target.name, signal);
      if (signal.aborted) return;
      if (items.length > 0) {
        const result = await sendToTab<{ applied?: number }>(tabId, {
          type: 'hibro:translate-apply',
          items,
          target: target.name,
          ...(target.code ? { language: target.code } : {}),
        });
        applied += result?.applied ?? 0;
      }
      done += batch.length;
      onProgress?.(Math.min(done, blocks.length), blocks.length);
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(BATCH_CONCURRENCY, batches.length) }, () =>
      runBatches(),
    ),
  );
  return { count: applied, ...base };
}

/**
 * Stops any run on the tab and restores the untranslated page. Cancelling
 * first keeps a batch that is still in flight from repainting what was just
 * cleared.
 */
export async function revertPageTranslation(tabId: number): Promise<number> {
  cancelPageTranslation(tabId);
  const result = await sendToTab<{ applied?: number }>(tabId, {
    type: 'hibro:translate-revert',
  });
  return result?.applied ?? 0;
}

/**
 * Reports whether a tab currently shows translations. A tab Hibro cannot reach
 * (a restricted page, or one without the content script) counts as
 * untranslated rather than as a failure: this runs whenever the panel opens or
 * the active tab changes.
 */
export async function readPageTranslationState(
  tabId: number,
): Promise<TranslationState> {
  const state = await probeTab<Partial<TranslationState>>(tabId, {
    type: 'hibro:translate-state',
  });
  const count = Number(state?.count ?? 0);
  return {
    active: Boolean(state?.active),
    count: Number.isFinite(count) ? count : 0,
    running: activeRuns.has(tabId),
  };
}

function post(port: chrome.runtime.Port, event: TranslateEvent): void {
  try {
    port.postMessage(event);
  } catch {
    // Panel was closed; nothing to report.
  }
}

// State read that keeps the panel's toggle in step with the page, including
// after a run failed part-way through.
async function postState(
  port: chrome.runtime.Port,
  tabId: number,
): Promise<void> {
  post(port, {
    type: 'translate-state',
    ...(await readPageTranslationState(tabId)),
  });
}

/**
 * Serves the translation port. Disconnecting does not cancel a run: the popup
 * closes as soon as the user clicks the page, and the translation it started
 * should still finish. A popup that reopens mid-run learns about it from the
 * state poll. The side panel is still allowed to open this port so a later
 * surface does not need a worker change.
 */
export function attachTranslatePort(port: chrome.runtime.Port): void {
  if (!isTrustedExtensionPort(port, [PANEL_PAGE_PATH, POPUP_PAGE_PATH])) {
    port.disconnect();
    return;
  }
  port.onMessage.addListener((msg: TranslateRequest) => {
    void (async () => {
      if (!msg || typeof msg.type !== 'string') return;
      try {
        if (msg.type === 'state') {
          await postState(port, msg.tabId);
          return;
        }
        if (msg.type === 'revert') {
          await revertPageTranslation(msg.tabId);
          await postState(port, msg.tabId);
          return;
        }
        const target = await resolveTranslationTarget();
        await translatePage(msg.tabId, target, {
          onProgress: (done, total) =>
            post(port, { type: 'translate-progress', done, total }),
        });
        await postState(port, msg.tabId);
      } catch (err) {
        post(port, { type: 'translate-error', text: friendlyError(err) });
        await postState(port, msg.tabId);
      }
    })();
  });
}
