// Ordinary readable pages retain their original inline and nested block layout.
import { readRoot } from '../readable-root';
import type { TranslationAdapter } from './types';
import {
  TRANSLATABLE_BLOCK_SELECTOR,
  TRANSLATION_SKIP_SELECTOR,
  TRANSLATION_NODE_ATTR,
  isVisibleChild,
  ownBlockText,
  buildTranslationNode,
  insertTranslation,
} from './dom';

/** Collects visible body prose, excluding code, hidden content, and page furniture. */
export function createDefaultAdapter(): TranslationAdapter {
  return {
    collect() {
      const root = readRoot();
      if (!root) return [];
      return Array.from(
        root.querySelectorAll<HTMLElement>(TRANSLATABLE_BLOCK_SELECTOR),
      )
        .filter(
          (el) =>
            !el.closest(
              `${TRANSLATION_SKIP_SELECTOR},pre,code,[aria-hidden="true"],[${TRANSLATION_NODE_ATTR}]`,
            ) && isVisibleChild(el),
        )
        .map((el) => {
          const text = ownBlockText(el);
          return {
            text,
            element: el,
            isCurrent: () => el.isConnected && ownBlockText(el) === text,
            render(translated: string, language?: string) {
              insertTranslation(el, buildTranslationNode(translated, language));
            },
          };
        });
    },
    clear() {},
  };
}
