// Composer recall history derived from stored conversations. Browsing preserves
// the current draft and follows storage changes from other extension pages.

import { useCallback, useEffect, useRef, type KeyboardEvent } from 'react';
import {
  CONVERSATIONS_KEY,
  MAX_INPUT_HISTORY,
  deriveInputHistory,
  readConversationState,
} from '@/shared/conversations';

interface UseInputHistoryOptions {
  text: string;
  setText: (t: string) => void;
}

/** Adds ArrowUp and ArrowDown recall to the controlled composer input. */
export function useInputHistory({ text, setText }: UseInputHistoryOptions) {
  const entriesRef = useRef<string[]>([]);
  // Null means the user is not browsing history.
  const posRef = useRef<number | null>(null);
  const draftRef = useRef('');
  // Keep a just-sent message available while its debounced save catches up.
  const lastSentRef = useRef<string | null>(null);

  useEffect(() => {
    const refresh = async () => {
      const { items } = await readConversationState();
      let entries = deriveInputHistory(items);
      const last = lastSentRef.current;
      if (last && entries[entries.length - 1] !== last) {
        entries = [...entries, last].slice(-MAX_INPUT_HISTORY);
      }
      entriesRef.current = entries;
    };
    void refresh();
    const onChanged = (
      changes: { [key: string]: chrome.storage.StorageChange },
      area: string,
    ) => {
      if (area !== 'local' || !changes[CONVERSATIONS_KEY]) return;
      void refresh();
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
  }, []);

  // Add the latest send before storage finishes its debounced write.
  const record = useCallback((sent: string) => {
    const entries = entriesRef.current;
    if (sent && entries[entries.length - 1] !== sent) {
      entriesRef.current = [...entries, sent].slice(-MAX_INPUT_HISTORY);
    }
    lastSentRef.current = sent || null;
    posRef.current = null;
  }, []);

  // Returns true when history navigation consumed the key.
  const handleKey = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>): boolean => {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return false;
      const el = e.currentTarget;
      const entries = entriesRef.current;
      // End browsing if storage changed or the recalled text was edited.
      if (
        posRef.current !== null &&
        (posRef.current >= entries.length || text !== entries[posRef.current])
      ) {
        posRef.current = null;
      }
      // Move the caret after React renders the recalled value.
      const moveCaretToEnd = (expectedText: string) => {
        requestAnimationFrame(() => {
          if (el.value !== expectedText) return;
          el.selectionStart = el.selectionEnd = el.value.length;
        });
      };

      if (e.key === 'ArrowUp') {
        if (entries.length === 0) return false;
        if (posRef.current === null) {
          // Preserve normal caret movement unless the caret is at the start.
          if (text && (el.selectionStart !== 0 || el.selectionEnd !== 0))
            return false;
          draftRef.current = text;
          posRef.current = entries.length - 1;
        } else if (posRef.current > 0) {
          posRef.current -= 1;
        }
        e.preventDefault();
        const recalled = entries[posRef.current];
        setText(recalled);
        moveCaretToEnd(recalled);
        return true;
      }

      // ArrowDown keeps normal caret movement outside a recall session.
      if (posRef.current === null) return false;
      e.preventDefault();
      let recalled: string;
      if (posRef.current < entries.length - 1) {
        posRef.current += 1;
        recalled = entries[posRef.current];
      } else {
        posRef.current = null;
        recalled = draftRef.current;
      }
      setText(recalled);
      moveCaretToEnd(recalled);
      return true;
    },
    [text, setText],
  );

  return { record, handleKey };
}
