// Connects the side panel to the service worker and stores recent conversations.
// Incoming events become text, reasoning, and tool parts as they arrive.

import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import type {
  HibroHistoryMessage,
  HibroPart,
  PanelEvent,
  PanelMessage,
} from '@/shared/protocol';
import {
  CONVERSATIONS_KEY,
  type ConversationSummary,
  type StoredConversation,
  deriveTitle,
  readConversationState,
  renameConversationTitle,
  summarize,
  upsertConversation,
  writeActiveConversation,
  writeConversations,
} from '@/shared/conversations';

export type ChatStatus = 'ready' | 'streaming';

interface ChatState {
  messages: PanelMessage[];
  status: ChatStatus;
  statusText: string;
  // A fresh id keeps a new installation stable while storage loads.
  activeId: string;
  // Prevents the initial empty state from overwriting stored conversations.
  hydrated: boolean;
}

type Action =
  | { type: 'send'; text: string }
  | { type: 'stop' }
  | { type: 'idle' }
  | { type: 'hydrate'; messages: PanelMessage[]; activeId: string }
  | { type: 'new-chat'; activeId: string }
  | { type: 'switch'; messages: PanelMessage[]; activeId: string }
  | PanelEvent;

const uid = (): string => crypto.randomUUID();

const initial: ChatState = {
  messages: [],
  status: 'ready',
  statusText: '',
  activeId: uid(),
  hydrated: false,
};

// Returns a message list whose final entry can receive assistant parts.
function ensureAssistantTail(messages: PanelMessage[]): PanelMessage[] {
  const next = [...messages];
  const last = next[next.length - 1];
  if (last && last.role === 'assistant' && !last.error) return next;
  next.push({ id: uid(), role: 'assistant', parts: [] });
  return next;
}

function replaceLast(
  messages: PanelMessage[],
  parts: HibroPart[],
): PanelMessage[] {
  const next = [...messages];
  next[next.length - 1] = { ...next[next.length - 1], parts };
  return next;
}

function reducer(state: ChatState, action: Action): ChatState {
  switch (action.type) {
    case 'send':
      return {
        ...state,
        status: 'streaming',
        statusText: 'Working…',
        // A send during startup must win over the pending storage restore.
        hydrated: true,
        messages: [
          ...state.messages,
          {
            id: uid(),
            role: 'user',
            parts: [{ type: 'text', text: action.text }],
          },
        ],
      };

    case 'status':
      return { ...state, statusText: action.text };

    case 'run-start': {
      const messages = ensureAssistantTail(state.messages);
      return { ...state, messages, status: 'streaming' };
    }

    case 'part-add': {
      // The local "stop" action already marks a pre-first-token stop with a
      // "Stopped." text part; drop the worker's identical follow-up so the
      // bubble shows it exactly once. Mid-stream stops still append: the tail
      // part then holds partial content, not the marker.
      const tailMessage = state.messages[state.messages.length - 1];
      const tailPart =
        tailMessage && tailMessage.role === 'assistant'
          ? tailMessage.parts[tailMessage.parts.length - 1]
          : undefined;
      if (
        action.part.type === 'text' &&
        action.part.text === 'Stopped.' &&
        tailPart?.type === 'text' &&
        tailPart.text === 'Stopped.'
      ) {
        return state;
      }
      const messages = ensureAssistantTail(state.messages);
      const last = messages[messages.length - 1];
      return {
        ...state,
        messages: replaceLast(messages, [...last.parts, action.part]),
      };
    }

    case 'part-delta': {
      const messages = ensureAssistantTail(state.messages);
      const last = messages[messages.length - 1];
      const parts = [...last.parts];
      // Append to the tail part only when it matches the delta type, so a later
      // text/reasoning run starts a new part instead of merging into an earlier
      // one across an interleaved tool invocation.
      const tail = parts[parts.length - 1];
      if (tail && tail.type === action.partType) {
        const cur = tail as { type: 'text' | 'reasoning'; text: string };
        parts[parts.length - 1] = {
          type: cur.type,
          text: cur.text + action.delta,
        };
      } else {
        parts.push({ type: action.partType, text: action.delta });
      }
      return { ...state, messages: replaceLast(messages, parts) };
    }

    case 'tool-update': {
      const messages = ensureAssistantTail(state.messages);
      const last = messages[messages.length - 1];
      const parts = last.parts.map((p) =>
        p.type === 'tool-invocation' && p.toolCallId === action.toolCallId
          ? {
              ...p,
              state: action.state,
              output: action.output,
              errorText: action.errorText,
            }
          : p,
      );
      return { ...state, messages: replaceLast(messages, parts) };
    }

    case 'run-end':
      return { ...state, status: 'ready', statusText: '' };

    case 'error': {
      // Drop an in-flight, still-empty assistant bubble before surfacing the error.
      const messages = [...state.messages];
      const last = messages[messages.length - 1];
      if (
        last &&
        last.role === 'assistant' &&
        !last.error &&
        last.parts.length === 0
      ) {
        messages.pop();
      }
      messages.push({
        id: uid(),
        role: 'assistant',
        error: true,
        errorAction: action.action,
        parts: [{ type: 'text', text: action.text }],
      });
      return { ...state, messages, status: 'ready', statusText: '' };
    }

    case 'stop': {
      const messages = [...state.messages];
      const last = messages[messages.length - 1];
      if (
        last &&
        last.role === 'assistant' &&
        !last.error &&
        last.parts.length === 0
      ) {
        messages[messages.length - 1] = {
          ...last,
          parts: [{ type: 'text', text: 'Stopped.' }],
        };
      }
      return { ...state, messages, status: 'ready', statusText: '' };
    }

    case 'hydrate':
      // Apply the restored conversation (or an empty one) and mark the state
      // usable for persistence.
      return {
        ...state,
        messages: action.messages,
        activeId: action.activeId,
        status: 'ready',
        statusText: '',
        hydrated: true,
      };

    case 'new-chat':
      // A deliberate user action counts as hydration too, so a new-chat that
      // races the mount-load is respected instead of being clobbered by it.
      return {
        ...state,
        messages: [],
        activeId: action.activeId,
        status: 'ready',
        statusText: '',
        hydrated: true,
      };

    case 'switch':
      return {
        ...state,
        messages: action.messages,
        activeId: action.activeId,
        status: 'ready',
        statusText: '',
        hydrated: true,
      };

    case 'idle':
      return { ...state, status: 'ready', statusText: '' };

    default:
      return state;
  }
}

const MAX_HISTORY = 10;
const SAVE_DEBOUNCE_MS = 400;

function toHistory(messages: PanelMessage[]): HibroHistoryMessage[] {
  return messages
    .map(
      (m): HibroHistoryMessage =>
        m.error
          ? // Errored turns stay as a minimal assistant note instead of being
            // dropped: dropping them leaves two consecutive user messages in the
            // history, which strict providers (Anthropic) reject: one failed run
            // would otherwise poison every later send of the thread.
            {
              role: m.role,
              parts: [
                {
                  type: 'text',
                  text: '(This run failed and produced no answer.)',
                },
              ],
            }
          : { role: m.role, parts: m.parts },
    )
    .slice(-MAX_HISTORY);
}

// Best-effort URL normalization so an adopted navigate target compares equal to
// the tab's reported URL (e.g. the trailing slash location.href adds).
function normalizeUrl(raw: string): string {
  try {
    return new URL(raw).href;
  } catch {
    return raw;
  }
}

async function getActiveTab(): Promise<chrome.tabs.Tab> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || tab.id === undefined) {
    throw new Error('Could not find the active tab.');
  }
  return tab;
}

/** Manages streaming chat state and persisted conversation history. */
export function useHibroChat() {
  const [state, dispatch] = useReducer(reducer, initial);
  const [summaries, setSummaries] = useState<ConversationSummary[]>([]);
  const portRef = useRef<chrome.runtime.Port | null>(null);
  const messagesRef = useRef<PanelMessage[]>(state.messages);
  const keepaliveRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Async callbacks read the latest state through refs.
  const activeIdRef = useRef<string>(state.activeId);
  const hydratedRef = useRef<boolean>(state.hydrated);
  const itemsRef = useRef<StoredConversation[]>([]);
  // User actions may win hydration before the initial stored items are ready.
  // Keep persistence gated separately so that early saves cannot replace them.
  const startupStorageReadyRef = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Last page used by this conversation, including successful navigation tools.
  const lastUrlRef = useRef<string | undefined>(undefined);
  // Target URL for each navigation tool that has not finished yet.
  const navigateCallsRef = useRef(new Map<string, string>());
  // Serialize conversation changes so their storage writes cannot interleave.
  const transitioningRef = useRef(false);

  useEffect(() => {
    messagesRef.current = state.messages;
  }, [state.messages]);

  useEffect(() => {
    activeIdRef.current = state.activeId;
  }, [state.activeId]);

  useEffect(() => {
    hydratedRef.current = state.hydrated;
  }, [state.hydrated]);

  // Save immediately before a conversation change. Empty chats stay out of History.
  const persistNow = useCallback(async () => {
    if (!hydratedRef.current || !startupStorageReadyRef.current) return;
    const messages = messagesRef.current;
    const activeId = activeIdRef.current;
    if (messages.length === 0) {
      await writeActiveConversation(activeId);
      return;
    }
    const now = Date.now();
    const existing = itemsRef.current.find(
      (conversation) => conversation.id === activeId,
    );
    const conv: StoredConversation = {
      id: activeId,
      // Keep a manual title instead of deriving it again after every message.
      title: existing?.title.trim() ? existing.title : deriveTitle(messages),
      createdAt: now,
      updatedAt: now,
      messages,
      // Omit an unknown page URL instead of storing undefined.
      ...(lastUrlRef.current ? { lastUrl: lastUrlRef.current } : {}),
    };
    const items = upsertConversation(itemsRef.current, conv);
    itemsRef.current = items;
    setSummaries(summarize(items));
    await Promise.all([
      writeConversations(items),
      writeActiveConversation(activeId),
    ]);
  }, []);

  // Cancel stale writes before switching or deleting a conversation.
  const cancelPendingSave = useCallback(() => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
  }, []);

  // Restore storage unless the user already started a conversation during load.
  useEffect(() => {
    void (async () => {
      const { items, activeId } = await readConversationState();
      itemsRef.current = items;
      setSummaries(summarize(items));
      startupStorageReadyRef.current = true;
      if (hydratedRef.current) {
        // The user acted while startup was pending. Merge that authoritative
        // in-memory thread into the stored snapshot now that it is safe.
        await persistNow();
        return;
      }
      const active = activeId
        ? items.find((c) => c.id === activeId)
        : undefined;
      if (active) {
        lastUrlRef.current = active.lastUrl;
        dispatch({
          type: 'hydrate',
          messages: active.messages,
          activeId: active.id,
        });
      } else {
        dispatch({
          type: 'hydrate',
          messages: [],
          activeId: activeIdRef.current,
        });
      }
    })();
  }, [persistNow]);

  // Coalesce frequent streaming updates; transitions and unmount still flush.
  useEffect(() => {
    if (!state.hydrated) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      void persistNow();
    }, SAVE_DEBOUNCE_MS);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [state.messages, state.activeId, state.hydrated, persistNow]);

  // Save the final state when the panel closes.
  useEffect(() => {
    return () => {
      void persistNow();
    };
  }, [persistNow]);

  // Refresh History without replacing the active in-memory conversation.
  useEffect(() => {
    const onChanged = (
      changes: { [key: string]: chrome.storage.StorageChange },
      area: string,
    ) => {
      if (area !== 'local' || !changes[CONVERSATIONS_KEY]) return;
      void (async () => {
        const { items } = await readConversationState();
        itemsRef.current = items;
        setSummaries(summarize(items));
      })();
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
  }, []);

  // Adopt the target of the agent's own navigate tool as the conversation's
  // lastUrl once the call succeeds: the tab really is on that page then, so the
  // next send's previousPageUrl must match it; otherwise the worker injects a
  // false "[The page changed …]" marker for a navigation the model witnessed
  // itself. External navigations (user clicks, SPA routing) never touch
  // lastUrlRef, so genuine page changes are still flagged.
  const trackAgentNavigation = useCallback((event: PanelEvent) => {
    const calls = navigateCallsRef.current;
    if (event.type === 'run-start') {
      calls.clear();
      return;
    }
    if (
      event.type === 'part-add' &&
      event.part.type === 'tool-invocation' &&
      event.part.toolName === 'navigate' &&
      typeof event.part.input.url === 'string'
    ) {
      calls.set(event.part.toolCallId, normalizeUrl(event.part.input.url));
      return;
    }
    if (event.type === 'tool-update') {
      const url = calls.get(event.toolCallId);
      if (url === undefined) return;
      calls.delete(event.toolCallId);
      if (event.state === 'output-available' && !event.errorText) {
        lastUrlRef.current = url;
      }
    }
  }, []);

  // Lazily connect the port and recreate it after a disconnect, so a restarted
  // service worker never leaves the panel talking to a dead channel.
  const connect = useCallback((): chrome.runtime.Port => {
    if (portRef.current) return portRef.current;
    const port = chrome.runtime.connect({ name: 'hibro-panel' });
    port.onMessage.addListener((event: PanelEvent) => {
      trackAgentNavigation(event);
      dispatch(event);
    });
    port.onDisconnect.addListener(() => {
      portRef.current = null;
      dispatch({ type: 'idle' });
    });
    portRef.current = port;
    return port;
  }, [trackAgentNavigation]);

  // Keep the service worker alive during long runs: an open port alone does
  // not prevent termination, but message traffic resets the idle timer.
  useEffect(() => {
    if (state.status !== 'streaming') {
      if (keepaliveRef.current) {
        clearInterval(keepaliveRef.current);
        keepaliveRef.current = null;
      }
      return;
    }
    keepaliveRef.current = setInterval(() => {
      try {
        portRef.current?.postMessage({ type: 'ping' });
      } catch {
        // Port is gone; the disconnect handler already reset state.
      }
    }, 20000);
    return () => {
      if (keepaliveRef.current) clearInterval(keepaliveRef.current);
      keepaliveRef.current = null;
    };
  }, [state.status]);

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || state.status === 'streaming') return;
      let tab: chrome.tabs.Tab;
      try {
        tab = await getActiveTab();
      } catch (err) {
        dispatch({
          type: 'error',
          text: err instanceof Error ? err.message : String(err),
        });
        return;
      }
      // Prior turns, captured before the new user message is appended.
      const history = toHistory(messagesRef.current);
      // The URL this conversation last ran on lets the worker flag a page
      // change; the field is omitted when unknown (fresh or legacy threads).
      const previousPageUrl = lastUrlRef.current;
      const currentUrl = tab.url || '';
      if (currentUrl) lastUrlRef.current = currentUrl;
      // Keep the startup restore from observing a stale pre-dispatch ref.
      hydratedRef.current = true;
      dispatch({ type: 'send', text: trimmed });
      connect().postMessage({
        type: 'send',
        text: trimmed,
        tabId: tab.id,
        history,
        ...(previousPageUrl ? { previousPageUrl } : {}),
      });
    },
    [state.status],
  );

  const stop = useCallback(() => {
    try {
      portRef.current?.postMessage({ type: 'stop' });
    } catch {
      // Port is gone; nothing to stop.
    }
    dispatch({ type: 'stop' });
  }, []);

  // Stop the current run before another conversation takes over the port.
  const abortRun = useCallback(() => {
    try {
      portRef.current?.postMessage({ type: 'stop' });
      portRef.current?.disconnect();
    } catch {
      // Port is gone; the next connect() recreates it.
    }
    portRef.current = null;
    dispatch({ type: 'idle' });
  }, []);

  // Save the current thread and stop its request before opening a new one.
  const newChat = useCallback(async () => {
    if (transitioningRef.current) return;
    transitioningRef.current = true;
    try {
      abortRun();
      cancelPendingSave();
      await persistNow();
      const id = uid();
      lastUrlRef.current = undefined;
      // Update refs before render so an early flush sees the new identity.
      activeIdRef.current = id;
      messagesRef.current = [];
      hydratedRef.current = true;
      dispatch({ type: 'new-chat', activeId: id });
      await writeActiveConversation(id);
    } finally {
      transitioningRef.current = false;
    }
  }, [abortRun, cancelPendingSave, persistNow]);

  // Save the current thread before switching to the latest stored copy.
  const switchTo = useCallback(
    async (id: string) => {
      if (transitioningRef.current) return;
      transitioningRef.current = true;
      try {
        abortRun();
        cancelPendingSave();
        await persistNow();
        const { items } = await readConversationState();
        itemsRef.current = items;
        setSummaries(summarize(items));
        const conv = items.find((c) => c.id === id);
        if (!conv) return;
        lastUrlRef.current = conv.lastUrl;
        // Update refs before render for the same flush safety as newChat.
        activeIdRef.current = conv.id;
        messagesRef.current = conv.messages;
        dispatch({ type: 'switch', messages: conv.messages, activeId: id });
        await writeActiveConversation(id);
      } finally {
        transitioningRef.current = false;
      }
    },
    [abortRun, cancelPendingSave, persistNow],
  );

  // Save first so the renamed title remains authoritative on later writes.
  const renameConversation = useCallback(
    async (id: string, rawTitle: string) => {
      if (transitioningRef.current || !rawTitle.trim()) return;
      transitioningRef.current = true;
      try {
        cancelPendingSave();
        await persistNow();
        const next = renameConversationTitle(itemsRef.current, id, rawTitle);
        if (next === itemsRef.current) return;
        itemsRef.current = next;
        setSummaries(summarize(next));
        await writeConversations(next);
      } finally {
        transitioningRef.current = false;
      }
    },
    [cancelPendingSave, persistNow],
  );

  // Deleting the active thread discards its unsaved tail and opens the next one.
  const deleteConversation = useCallback(
    async (id: string) => {
      if (transitioningRef.current) return;
      transitioningRef.current = true;
      try {
        const deletingActive = id === activeIdRef.current;
        if (deletingActive) abortRun();
        cancelPendingSave();
        if (!deletingActive) await persistNow();
        const { items } = await readConversationState();
        const next = items.filter((c) => c.id !== id);
        itemsRef.current = next;
        setSummaries(summarize(next));
        if (id !== activeIdRef.current) {
          await writeConversations(next);
          return;
        }
        const target = next
          .slice()
          .sort((a, b) => b.updatedAt - a.updatedAt)[0];
        // Update refs first so an early flush cannot restore the deleted thread.
        if (target) {
          lastUrlRef.current = target.lastUrl;
          activeIdRef.current = target.id;
          messagesRef.current = target.messages;
          dispatch({
            type: 'switch',
            messages: target.messages,
            activeId: target.id,
          });
          await Promise.all([
            writeConversations(next),
            writeActiveConversation(target.id),
          ]);
        } else {
          const fresh = uid();
          lastUrlRef.current = undefined;
          activeIdRef.current = fresh;
          messagesRef.current = [];
          dispatch({ type: 'new-chat', activeId: fresh });
          await Promise.all([
            writeConversations(next),
            writeActiveConversation(fresh),
          ]);
        }
      } finally {
        transitioningRef.current = false;
      }
    },
    [abortRun, cancelPendingSave, persistNow],
  );

  useEffect(
    () => () => {
      try {
        portRef.current?.disconnect();
      } catch {
        // Already disconnected.
      }
      portRef.current = null;
    },
    [],
  );

  return {
    messages: state.messages,
    status: state.status,
    statusText: state.statusText,
    activeId: state.activeId,
    summaries,
    send,
    stop,
    newChat,
    switchTo,
    renameConversation,
    deleteConversation,
  };
}
