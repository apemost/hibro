// Drives in-page translation from the toolbar popup over the worker's
// translation port, so a chat run and a translation never cancel one another.

import { useCallback, useEffect, useRef, useState } from 'react';
import { TRANSLATE_PORT, type TranslateEvent } from '@/shared/translation';
import { getActiveTab } from '@/panel/activeTab';

export type TranslationStatus = 'idle' | 'working' | 'active';

export interface PageTranslation {
  status: TranslationStatus;
  /** Blocks translated so far and blocks found, while a run is working. */
  progress: { done: number; total: number };
  error: string;
  toggle: () => void;
  dismissError: () => void;
}

// While a run works, the popup polls its state. That covers a popup that was
// closed and reopened mid-run (its progress events went to the port that died
// with it), and the traffic keeps the service worker's idle timer from
// expiring between batches.
const POLL_MS = 2000;

/** Tracks whether the active tab shows translations and toggles them. */
export function usePageTranslation(): PageTranslation {
  const [status, setStatus] = useState<TranslationStatus>('idle');
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [error, setError] = useState('');
  const portRef = useRef<chrome.runtime.Port | null>(null);
  const activeTabRef = useRef<number | undefined>(undefined);
  const statusRef = useRef<TranslationStatus>(status);
  statusRef.current = status;

  // Recreate the port after a disconnect so a restarted service worker never
  // leaves the surface talking to a dead channel.
  const connect = useCallback((): chrome.runtime.Port => {
    if (portRef.current) return portRef.current;
    const port = chrome.runtime.connect({ name: TRANSLATE_PORT });
    port.onMessage.addListener((event: TranslateEvent) => {
      if (event.type === 'translate-progress') {
        setProgress({ done: event.done, total: event.total });
        return;
      }
      if (event.type === 'translate-state') {
        setStatus(event.running ? 'working' : event.active ? 'active' : 'idle');
        if (!event.running) setProgress({ done: 0, total: 0 });
        return;
      }
      setError(event.text);
    });
    port.onDisconnect.addListener(() => {
      portRef.current = null;
      if (statusRef.current === 'working') setStatus('idle');
    });
    portRef.current = port;
    return port;
  }, []);

  const request = useCallback(
    async (type: 'translate' | 'revert' | 'state') => {
      let tab: chrome.tabs.Tab;
      try {
        tab = await getActiveTab();
      } catch (err) {
        if (type !== 'state') {
          setError(err instanceof Error ? err.message : String(err));
          setStatus('idle');
        }
        return;
      }
      activeTabRef.current = tab.id;
      try {
        connect().postMessage({ type, tabId: tab.id });
      } catch {
        // The port went away; the disconnect handler resets the state.
      }
    },
    [connect],
  );

  // A page this popup did not translate itself (a tab switch, a reopened
  // popup, or a run the assistant started) still reports its real state.
  // A load also clears the page's translation, so the toggle must not keep
  // offering to show the original after a reload or a navigation.
  useEffect(() => {
    void request('state');
    const onActivated = () => void request('state');
    const onUpdated = (
      tabId: number,
      changeInfo: chrome.tabs.OnUpdatedInfo,
    ) => {
      if (changeInfo.status === 'complete' && tabId === activeTabRef.current) {
        void request('state');
      }
    };
    chrome.tabs.onActivated.addListener(onActivated);
    chrome.tabs.onUpdated.addListener(onUpdated);
    return () => {
      chrome.tabs.onActivated.removeListener(onActivated);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      portRef.current?.disconnect();
      portRef.current = null;
    };
  }, [request]);

  useEffect(() => {
    if (status !== 'working') return;
    const timer = setInterval(() => void request('state'), POLL_MS);
    return () => clearInterval(timer);
  }, [request, status]);

  const toggle = useCallback(() => {
    if (status === 'working') return;
    setError('');
    if (status === 'active') {
      void request('revert');
      return;
    }
    setProgress({ done: 0, total: 0 });
    setStatus('working');
    void request('translate');
  }, [request, status]);

  const dismissError = useCallback(() => setError(''), []);

  return { status, progress, error, toggle, dismissError };
}
