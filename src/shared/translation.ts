// Contract for in-page translation, shared by the side panel, the toolbar
// popup, the service worker, and the content script. Translation has its own
// port so a running chat cannot cancel it, and vice versa.
//
// The content script imports types from here only. A value import would make
// Rollup split this module into a chunk the content-script loader has to fetch
// on every page, which both widens the injection race the service worker
// recovers from and exposes another web-accessible resource. Values the
// content script needs live in src/content.ts.

import type { TranslationLanguage } from './language';

export const TRANSLATE_PORT = 'hibro-translate';

/** One source text block collected from the page body. */
export interface TranslationBlock {
  id: number;
  text: string;
}

/**
 * The language a run translates into: `name` goes into the prompt, `code`
 * is the BCP-47 tag put on the inserted nodes when the target is one of the
 * configurable languages.
 */
export interface TranslationTarget {
  name: string;
  code?: TranslationLanguage;
}

/** Requests a Hibro surface sends over the translation port. */
export type TranslateRequest =
  | { type: 'translate'; tabId: number }
  | { type: 'revert'; tabId: number }
  // Polled while a run is working, which also keeps the worker's idle timer
  // from expiring mid-run.
  | { type: 'state'; tabId: number };

/** Events the service worker streams back over the translation port. */
export type TranslateEvent =
  | {
      type: 'translate-state';
      active: boolean;
      count: number;
      /** A run is still translating this tab, whatever surface started it. */
      running: boolean;
    }
  | { type: 'translate-progress'; done: number; total: number }
  | { type: 'translate-error'; text: string };
