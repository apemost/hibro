// Hibro CDP action layer: Playwright-grade page interaction over chrome.debugger.
//
// The content script handles reads (perception); this module handles writes
// (actions). It uses real CDP input events (Input.dispatchMouseEvent /
// Input.insertText / Input.dispatchKeyEvent) rather than synthetic
// el.click()/value-setter scripts, so clicks and typing are trusted events and
// work on framework-driven, shadow-DOM, and SPA controls that defeated the old
// JSON-action expressions.
//
// Elements are addressed by the data-hibro-id assigned by the content script's
// list/snapshot calls. Each action resolves the id to a CDP node, scrolls it
// into view, focuses it, then dispatches input at its center. Each action
// attaches the debugger for its own duration and detaches in `finally`, so a
// thrown error never leaves the tab "already being debugged".

type Debuggee = chrome.debugger.Debuggee;
// Send a single CDP command on an already-attached target.
type Send = (method: string, params?: Record<string, unknown>) => Promise<any>;

function target(tabId: number): Debuggee {
  return { tabId };
}

// Throw if the run was aborted (Stop / conversation switch), so an in-flight
// action stops mutating the page instead of running to completion.
function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error('Aborted.');
}

// Attach for the duration of `fn` (which may issue many commands), then detach.
// The AI SDK may run one step's tool calls concurrently (Promise.all), so we
// serialize debugger sessions per tab on a shared attach instead of racing
// attach/detach (which throws "Another debugger is already attached").
const sessionLocks = new Map<number, Promise<void>>();

// Bounded waits so one wedged session can't freeze a tab forever: a hung CDP
// command times out and releases its session, and a queued session stops
// waiting (clear error, or immediately on abort) instead of queuing behind a
// dead lock. The queue wait is generous because legit sessions (e.g. a 15s
// navigation load) can run long; a truly wedged holder releases via its own
// command timeout well before it.
const COMMAND_TIMEOUT_MS = 20000;
const DETACH_TIMEOUT_MS = 5000;
const QUEUE_WAIT_TIMEOUT_MS = 60000;

async function withDebugger<T>(
  tabId: number,
  fn: (send: Send) => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  const prior = sessionLocks.get(tabId) ?? Promise.resolve();
  let release!: () => void;
  const mine = new Promise<void>((r) => {
    release = r;
  });
  // Enqueue behind any session already in flight for this tab.
  const chained = prior.catch(() => {}).then(() => mine);
  sessionLocks.set(tabId, chained);
  try {
    await waitForTurn(prior, signal);
    await withTimeout(
      chrome.debugger.attach(target(tabId), '1.3'),
      COMMAND_TIMEOUT_MS,
      'Attaching the debugger timed out; the tab may be unresponsive.',
    );
    try {
      return await fn((method, params) =>
        withTimeout(
          chrome.debugger.sendCommand(target(tabId), method, params ?? {}),
          COMMAND_TIMEOUT_MS,
          `CDP command ${method} did not finish within ${COMMAND_TIMEOUT_MS / 1000}s; the page may be unresponsive.`,
        )
      );
    } finally {
      await withTimeout(
        chrome.debugger.detach(target(tabId)),
        DETACH_TIMEOUT_MS,
        'Detaching the debugger timed out.',
      ).catch(() => {});
    }
  } finally {
    release();
    if (sessionLocks.get(tabId) === chained) sessionLocks.delete(tabId);
  }
}

// Wait for the previous session on this tab to release the lock, but not
// forever: resolves when `prior` settles (a failed predecessor still yields
// the turn), rejects on timeout or abort so a wedged holder or a stopped run
// can't block the queue permanently.
function waitForTurn(prior: Promise<unknown>, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const settle = (fn: () => void) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      fn();
    };
    const timer = setTimeout(
      () =>
        settle(() =>
          reject(new Error('The previous action on this tab did not finish in time; try again.')),
        ),
      QUEUE_WAIT_TIMEOUT_MS,
    );
    const onAbort = () => settle(() => reject(new Error('Aborted.')));
    prior.then(
      () => settle(() => resolve()),
      () => settle(() => resolve()),
    );
    if (signal?.aborted) settle(() => reject(new Error('Aborted.')));
    else signal?.addEventListener('abort', onAbort);
  });
}

interface NodeResult {
  nodeId: number;
}

// Resolve a data-hibro-id to a CDP nodeId via the current document. Throws a
// message the model can act on ("take a fresh snapshot") when the element is
// gone, e.g. after the page changed.
async function resolveNodeId(send: Send, id: number | string): Promise<number> {
  const doc = await send('DOM.getDocument', { depth: 0 });
  const rootId = doc?.root?.nodeId;
  if (!rootId) throw new Error('Could not read the page DOM; retry perception.');
  const selector = `[data-hibro-id="${String(id).replace(/"/g, '')}"]`;
  const res = (await send('DOM.querySelector', { nodeId: rootId, selector })) as NodeResult;
  if (!res?.nodeId) {
    throw new Error(
      `Element #${id} was not found on the page. Call list_interactive_elements to get fresh ids, then retry.`,
    );
  }
  return res.nodeId;
}

interface BoxModel {
  model?: { content?: number[] };
}

// Center (CSS pixels) of an element's content box, for input dispatch.
async function boxCenter(send: Send, nodeId: number): Promise<{ x: number; y: number }> {
  const model = (await send('DOM.getBoxModel', { nodeId })) as BoxModel;
  const c = model?.model?.content;
  if (!c || c.length < 8) throw new Error('Element has no visible box; it may be hidden.');
  const xs = [c[0], c[2], c[4], c[6]];
  const ys = [c[1], c[3], c[5], c[7]];
  return {
    x: (Math.min(...xs) + Math.max(...xs)) / 2,
    y: (Math.min(...ys) + Math.max(...ys)) / 2,
  };
}

async function mouse(
  send: Send,
  x: number,
  y: number,
  type: 'mouseMoved' | 'mousePressed' | 'mouseReleased',
): Promise<void> {
  const pressed = type === 'mousePressed';
  await send('Input.dispatchMouseEvent', {
    type,
    x,
    y,
    button: type === 'mouseMoved' ? 'none' : 'left',
    buttons: pressed ? 1 : 0,
    clickCount: type === 'mousePressed' || type === 'mouseReleased' ? 1 : 0,
  });
}

// Click an element with a trusted mouse sequence at its center.
export async function cdpClick(tabId: number, id: number | string, signal?: AbortSignal): Promise<string> {
  checkAbort(signal);
  return withDebugger(tabId, async (send) => {
    const nodeId = await resolveNodeId(send, id);
    await send('DOM.scrollIntoViewIfNeeded', { nodeId }).catch(() => {});
    await send('DOM.focus', { nodeId }).catch(() => {});
    const { x, y } = await boxCenter(send, nodeId);
    checkAbort(signal);
    await mouse(send, x, y, 'mouseMoved');
    await mouse(send, x, y, 'mousePressed');
    await mouse(send, x, y, 'mouseReleased');
    return `Clicked element #${id} at (${Math.round(x)}, ${Math.round(y)}).`;
  }, signal);
}

interface TypeArgs {
  id: number | string;
  text: string;
  submit?: boolean;
}

// Type text into a field. Uses Input.insertText (a trusted, IME-style commit)
// after focusing and moving the caret to the end, so it appends to existing
// text and works for <input>, <textarea>, and contenteditable. Submit
// optionally dispatches Enter afterwards.
export async function cdpType(tabId: number, args: TypeArgs, signal?: AbortSignal): Promise<string> {
  const { id, text, submit } = args;
  checkAbort(signal);
  return withDebugger(tabId, async (send) => {
    const nodeId = await resolveNodeId(send, id);
    await send('DOM.scrollIntoViewIfNeeded', { nodeId }).catch(() => {});
    await send('DOM.focus', { nodeId });
    checkAbort(signal);
    await moveCaretToEnd(send, nodeId);
    await send('Input.insertText', { text });
    if (submit) await pressEnter(send);
    return `Typed ${text.length} character(s) into element #${id}${submit ? ' and pressed Enter' : ''}.`;
  }, signal);
}

// Move the caret to the end of the field so insertText truly appends: a
// programmatic focus leaves the caret at the start (or a selection, which
// insertText would replace). Best-effort: on failure typing still proceeds.
async function moveCaretToEnd(send: Send, nodeId: number): Promise<void> {
  const resolved = await send('DOM.resolveNode', { nodeId }).catch(() => undefined);
  const objectId = resolved?.object?.objectId;
  if (!objectId) return;
  await send('Runtime.callFunctionOn', {
    objectId,
    functionDeclaration: `function () {
      try {
        if (this instanceof HTMLInputElement || this instanceof HTMLTextAreaElement) {
          this.setSelectionRange(this.value.length, this.value.length);
        } else if (this.isContentEditable) {
          const range = this.ownerDocument.createRange();
          range.selectNodeContents(this);
          range.collapse(false);
          const selection = this.ownerDocument.getSelection();
          selection.removeAllRanges();
          selection.addRange(range);
        }
      } catch (e) { /* selection unsupported on this control; keep the focus caret */ }
    }`,
  }).catch(() => {});
}

async function pressEnter(send: Send): Promise<void> {
  await send('Input.dispatchKeyEvent', {
    type: 'rawKeyDown',
    key: 'Enter',
    code: 'Enter',
    windowsVirtualKeyCode: 13,
  });
  // The char (keypress) event is what triggers a form's native implicit
  // submission on Enter; rawKeyDown+keyUp alone does not.
  await send('Input.dispatchKeyEvent', {
    type: 'char',
    key: 'Enter',
    code: 'Enter',
    windowsVirtualKeyCode: 13,
    text: '\r',
  });
  await send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key: 'Enter',
    code: 'Enter',
    windowsVirtualKeyCode: 13,
  });
}

interface ScrollArgs {
  direction?: 'up' | 'down';
  amount?: number;
  selector?: string;
}

// Scroll the page by a delta, or scroll a selector-matched element into view.
// Forwards the abort signal so Stop can cancel an in-flight scroll.
export async function cdpScroll(tabId: number, args: ScrollArgs, signal?: AbortSignal): Promise<string> {
  const direction = args.direction === 'up' ? 'up' : 'down';
  const amount = Number.isFinite(args.amount) ? Math.abs(args.amount as number) : 600;
  const delta = direction === 'up' ? -amount : amount;
  if (args.selector) {
    const sel = JSON.stringify(args.selector);
    const expr = `(() => { const el = document.querySelector(${sel}); if (!el) return 'Element not found for scroll selector.'; el.scrollIntoView({ block: 'center' }); return 'Scrolled element into view.'; })()`;
    return cdpEvaluate(tabId, expr, signal);
  }
  const expr = `(() => { window.scrollBy(0, ${delta}); return 'Scrolled ${direction} ${amount}px; scrollY=' + Math.round(window.scrollY); })()`;
  return cdpEvaluate(tabId, expr, signal);
}

// Navigate the tab to a URL, waiting for the load to finish so the next
// perception call sees the new document (and the content script is injected)
// instead of racing the commit.
const NAVIGATE_TIMEOUT_MS = 15000;

export async function cdpNavigate(tabId: number, url: string, signal?: AbortSignal): Promise<string> {
  checkAbort(signal);
  return withDebugger(tabId, async (send) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let onEvent: ((source: Debuggee, method: string) => void) | undefined;
    const loaded = new Promise<void>((resolve, reject) => {
      timer = setTimeout(() => {
        reject(new Error('Navigation timed out waiting for the page to load.'));
      }, NAVIGATE_TIMEOUT_MS);
      onEvent = (source, method) => {
        if (source.tabId === tabId && method === 'Page.loadEventFired') resolve();
      };
      chrome.debugger.onEvent.addListener(onEvent);
    });
    // Consume a late rejection (e.g. the timer firing after a failed navigate)
    // so it never surfaces as an unhandled rejection; the await below still
    // re-throws the real error on the awaited path.
    loaded.catch(() => {});
    try {
      await send('Page.enable').catch(() => {});
      const res = await send('Page.navigate', { url });
      if (res?.errorText) throw new Error(`Navigation failed: ${res.errorText}`);
      await loaded;
      return `Navigated to ${url}.`;
    } finally {
      // Remove the listener and clear the timer on every exit path.
      if (timer !== undefined) clearTimeout(timer);
      if (onEvent) chrome.debugger.onEvent.removeListener(onEvent);
    }
  }, signal);
}

interface KeyMeta {
  named: boolean; // named (non-printable) key dispatched as a full keystroke
  key: string;
  code: string;
  keyCode: number;
  text?: string; // text the key inserts via a 'char' event (Enter, Space)
}

function keyMeta(key: string): KeyMeta {
  // A literal ' ' means the Space key (trim would erase it).
  const k = key === ' ' ? 'Space' : key.trim();
  const named: Record<string, Omit<KeyMeta, 'named' | 'key'>> = {
    Enter: { code: 'Enter', keyCode: 13, text: '\r' },
    Tab: { code: 'Tab', keyCode: 9 },
    Escape: { code: 'Escape', keyCode: 27 },
    Backspace: { code: 'Backspace', keyCode: 8 },
    Delete: { code: 'Delete', keyCode: 46 },
    Home: { code: 'Home', keyCode: 36 },
    End: { code: 'End', keyCode: 35 },
    PageUp: { code: 'PageUp', keyCode: 33 },
    PageDown: { code: 'PageDown', keyCode: 34 },
    Space: { code: 'Space', keyCode: 32, text: ' ' },
    ArrowUp: { code: 'ArrowUp', keyCode: 38 },
    ArrowDown: { code: 'ArrowDown', keyCode: 40 },
    ArrowLeft: { code: 'ArrowLeft', keyCode: 37 },
    ArrowRight: { code: 'ArrowRight', keyCode: 39 }
  };
  for (let i = 1; i <= 12; i++) named[`F${i}`] = { code: `F${i}`, keyCode: 111 + i };
  if (named[k]) return { named: true, key: k, ...named[k] };
  if (k.length !== 1) {
    throw new Error(
      `Unsupported key "${key}". Pass a single printable character or one of: ${Object.keys(named).join(', ')}.`,
    );
  }
  // Printable character: Chromium inserts it only via a 'char' event carrying `text`.
  return {
    named: false,
    key: k,
    code: `Key${k.toUpperCase()}`,
    keyCode: k.toUpperCase().charCodeAt(0),
    text: k
  };
}

// Press a key. Named keys (Enter, Tab, Escape, Backspace, Delete, Home, End,
// PageUp, PageDown, Space, arrows, F1-F12) are dispatched as a full keystroke
// (rawKeyDown → char when the key produces text → keyUp) so framework
// handlers (e.g. submit-on-Enter) fire. A single printable character is
// inserted into the focused field via a 'char' event; any other
// multi-character key name throws so the model can correct itself. When `id`
// is given, the target element is focused first, so the key can't be dropped
// if focus moved elsewhere.
export async function cdpPressKey(
  tabId: number,
  key: string,
  id?: number | string,
  signal?: AbortSignal,
): Promise<string> {
  checkAbort(signal);
  return withDebugger(tabId, async (send) => {
    if (id !== undefined) {
      const nodeId = await resolveNodeId(send, id);
      await send('DOM.scrollIntoViewIfNeeded', { nodeId }).catch(() => {});
      await send('DOM.focus', { nodeId }).catch(() => {});
    }
    checkAbort(signal);
    const meta = keyMeta(key);
    if (meta.named) {
      const base = { key: meta.key, code: meta.code, windowsVirtualKeyCode: meta.keyCode };
      await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...base });
      if (meta.text) {
        await send('Input.dispatchKeyEvent', { type: 'char', ...base, text: meta.text });
      }
      await send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
    } else {
      await send('Input.dispatchKeyEvent', { type: 'char', text: meta.text });
    }
    return `Pressed ${key}.`;
  }, signal);
}

interface EvalResult {
  exceptionDetails?: { text: string; exception?: { description?: string } };
  result?: { value?: unknown };
}

// Runs the fixed expressions built by cdpScroll in the page's main world.
// This helper is intentionally private so model output can never become page
// JavaScript. The timeout also prevents a hung page from pinning the debugger.
const EVALUATE_TIMEOUT_MS = 5000;
// Cap the returned string like the perception reads do, so one evaluate can't
// flood the model context (and the panel's tool card) with an unbounded dump.
const EVALUATE_RESULT_MAX_CHARS = 8000;

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  // Clear the timer on settle so each command doesn't hold the service worker
  // alive for the full timeout.
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function cdpEvaluate(tabId: number, expression: string, signal?: AbortSignal): Promise<string> {
  checkAbort(signal);
  return withDebugger(tabId, async (send) => {
    const res = (await withTimeout(
      send('Runtime.evaluate', {
        expression,
        returnByValue: true,
        awaitPromise: true,
      }),
      EVALUATE_TIMEOUT_MS,
      'Evaluation timed out; the page script did not finish.',
    )) as EvalResult;
    if (res?.exceptionDetails) {
      const detail = res.exceptionDetails.exception;
      throw new Error(`Page script failed: ${(detail && detail.description) || res.exceptionDetails.text}`);
    }
    const value = res?.result?.value;
    if (value === undefined || value === null) return 'undefined';
    const str = typeof value === 'string' ? value : JSON.stringify(value);
    if (str.length > EVALUATE_RESULT_MAX_CHARS) {
      return `${str.slice(0, EVALUATE_RESULT_MAX_CHARS)}… [truncated: showing ${EVALUATE_RESULT_MAX_CHARS} of ${str.length} characters]`;
    }
    return str;
  }, signal);
}
