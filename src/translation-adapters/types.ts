// Site implementations keep their own metadata behind these content-side handles.

/** A collected source that validates and renders its own site-specific content. */
export interface TranslationSource {
  readonly text: string;
  /** May change when the site recreates an equivalent source node. */
  readonly element: HTMLElement;
  /** Checks source identity and text before using a model result or cached copy. */
  isCurrent(): boolean;
  /** Replaces the displayed translation; both apply and restore use this path. */
  render(text: string, language?: string): void;
}

/** Owns site-specific collection and rendering effects for one collection. */
export interface TranslationAdapter {
  collect(): TranslationSource[];
  /** Stops observers and restores styles. Sources remain reusable after clearing. */
  clear(): void;
}
