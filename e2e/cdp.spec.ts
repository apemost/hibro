import { expect, test } from '@playwright/test';
import { cdpNavigate, cdpPressKey, cdpScroll } from '../src/cdp';

type DebuggerEventListener = (
  source: chrome.debugger.Debuggee,
  method: string,
  params?: object,
) => void;

interface DebuggerHarnessOptions {
  attach?: () => Promise<void> | void;
  detach?: () => Promise<void> | void;
  sendCommand?: (
    method: string,
    params: Record<string, unknown>,
  ) => Promise<unknown> | unknown;
}

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function installDebuggerHarness(options: DebuggerHarnessOptions = {}) {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'chrome');
  const listeners = new Set<DebuggerEventListener>();
  const debuggerApi = {
    attach: async () => options.attach?.(),
    detach: async () => options.detach?.(),
    sendCommand: async (
      _target: chrome.debugger.Debuggee,
      method: string,
      params: Record<string, unknown> = {},
    ) => options.sendCommand?.(method, params),
    onEvent: {
      addListener: (listener: DebuggerEventListener) => listeners.add(listener),
      removeListener: (listener: DebuggerEventListener) =>
        listeners.delete(listener),
      hasListener: (listener: DebuggerEventListener) => listeners.has(listener),
      hasListeners: () => listeners.size > 0,
      addRules: () => {},
      getRules: () => {},
      removeRules: () => {},
    },
  };
  Object.defineProperty(globalThis, 'chrome', {
    configurable: true,
    value: { debugger: debuggerApi },
  });
  return {
    emit(tabId: number, method: string, params: object = {}) {
      for (const listener of listeners) listener({ tabId }, method, params);
    },
    restore() {
      if (original) Object.defineProperty(globalThis, 'chrome', original);
      else Reflect.deleteProperty(globalThis, 'chrome');
    },
  };
}

test('an aborted debugger waiter keeps later actions behind the active session', async () => {
  const firstCommandStarted = deferred();
  const releaseFirstCommand = deferred();
  let attached = false;
  let attachCalls = 0;
  let evaluateCalls = 0;
  const harness = installDebuggerHarness({
    attach: () => {
      attachCalls += 1;
      if (attached) throw new Error('Another debugger is already attached');
      attached = true;
    },
    detach: () => {
      attached = false;
    },
    sendCommand: async (method) => {
      if (method !== 'Runtime.evaluate') return {};
      evaluateCalls += 1;
      if (evaluateCalls === 1) {
        firstCommandStarted.resolve();
        await releaseFirstCommand.promise;
      }
      return { result: { value: 'ok' } };
    },
  });

  try {
    const first = cdpScroll(41, { direction: 'down', amount: 1 });
    await firstCommandStarted.promise;

    const controller = new AbortController();
    const second = cdpScroll(
      41,
      { direction: 'down', amount: 2 },
      controller.signal,
    ).then(
      () => 'fulfilled',
      (error: Error) => `rejected:${error.message}`,
    );
    controller.abort();
    expect(await second).toBe('rejected:Aborted.');

    const third = cdpScroll(41, { direction: 'down', amount: 3 }).then(
      (value) => ({ status: 'fulfilled' as const, value }),
      (error: Error) => ({ status: 'rejected' as const, error }),
    );
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    const attachCallsBeforeRelease = attachCalls;

    releaseFirstCommand.resolve();
    await first;
    const thirdResult = await third;

    expect(attachCallsBeforeRelease).toBe(1);
    expect(thirdResult.status).toBe('fulfilled');
    expect(attachCalls).toBe(2);
  } finally {
    releaseFirstCommand.resolve();
    harness.restore();
  }
});

test('same-document navigation completes on Page.navigatedWithinDocument', async () => {
  let emitEvent!: (tabId: number, method: string, params?: object) => void;
  const harness = installDebuggerHarness({
    sendCommand: async (method) => {
      if (method === 'Page.navigate') {
        queueMicrotask(() =>
          emitEvent(52, 'Page.navigatedWithinDocument', { frameId: 'main' }),
        );
        return { frameId: 'main' };
      }
      return {};
    },
  });
  emitEvent = harness.emit;

  try {
    let settled = false;
    const navigation = cdpNavigate(
      52,
      'https://example.test/article#history',
    ).then((value) => {
      settled = true;
      return value;
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    const settledOnSameDocumentEvent = settled;
    if (!settled) harness.emit(52, 'Page.loadEventFired');
    const result = await navigation;

    expect(settledOnSameDocumentEvent).toBe(true);
    expect(result).toBe('Navigated to https://example.test/article#history.');
  } finally {
    harness.restore();
  }
});

test('same-document navigation ignores child-frame events until the target frame navigates', async () => {
  let emitEvent!: (tabId: number, method: string, params?: object) => void;
  const harness = installDebuggerHarness({
    sendCommand: async (method) => {
      if (method === 'Page.navigate') {
        queueMicrotask(() =>
          emitEvent(53, 'Page.navigatedWithinDocument', { frameId: 'child' }),
        );
        return { frameId: 'main' };
      }
      return {};
    },
  });
  emitEvent = harness.emit;

  try {
    let settled = false;
    const navigation = cdpNavigate(
      53,
      'https://example.test/article#target',
    ).then((value) => {
      settled = true;
      return value;
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(settled).toBe(false);

    harness.emit(53, 'Page.navigatedWithinDocument', { frameId: 'main' });
    await expect(navigation).resolves.toBe(
      'Navigated to https://example.test/article#target.',
    );
  } finally {
    harness.restore();
  }
});

test('a printable key dispatches keydown, char, and keyup in order', async () => {
  const keyEvents: Record<string, unknown>[] = [];
  const harness = installDebuggerHarness({
    sendCommand: (method, params) => {
      if (method === 'Input.dispatchKeyEvent') keyEvents.push(params);
      return {};
    },
  });

  try {
    await cdpPressKey(63, 'x');
    expect(keyEvents).toEqual([
      {
        type: 'rawKeyDown',
        key: 'x',
        code: 'KeyX',
        windowsVirtualKeyCode: 88,
      },
      {
        type: 'char',
        key: 'x',
        code: 'KeyX',
        windowsVirtualKeyCode: 88,
        text: 'x',
      },
      {
        type: 'keyUp',
        key: 'x',
        code: 'KeyX',
        windowsVirtualKeyCode: 88,
      },
    ]);
  } finally {
    harness.restore();
  }
});

test('printable punctuation uses valid physical keyboard metadata', async () => {
  const keyEvents: Record<string, unknown>[] = [];
  const harness = installDebuggerHarness({
    sendCommand: (method, params) => {
      if (method === 'Input.dispatchKeyEvent') keyEvents.push(params);
      return {};
    },
  });

  try {
    await cdpPressKey(64, '.');
    expect(keyEvents).toEqual([
      {
        type: 'rawKeyDown',
        key: '.',
        code: 'Period',
        windowsVirtualKeyCode: 190,
      },
      {
        type: 'char',
        key: '.',
        code: 'Period',
        windowsVirtualKeyCode: 190,
        text: '.',
      },
      {
        type: 'keyUp',
        key: '.',
        code: 'Period',
        windowsVirtualKeyCode: 190,
      },
    ]);
  } finally {
    harness.restore();
  }
});

test('unmapped printable Unicode omits misleading physical keyboard metadata', async () => {
  const keyEvents: Record<string, unknown>[] = [];
  const harness = installDebuggerHarness({
    sendCommand: (method, params) => {
      if (method === 'Input.dispatchKeyEvent') keyEvents.push(params);
      return {};
    },
  });

  try {
    await cdpPressKey(65, 'é');
    expect(keyEvents).toEqual([
      { type: 'rawKeyDown', key: 'é' },
      { type: 'char', key: 'é', text: 'é' },
      { type: 'keyUp', key: 'é' },
    ]);
  } finally {
    harness.restore();
  }
});
