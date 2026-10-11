// Content-side translation lifecycle, independent of site structure and styling.
import type { TranslationBlock } from './shared/translation';
import type {
  TranslationAdapter,
  TranslationSource,
} from './translation-adapters/types';
import { selectTranslationAdapter } from './translation-adapters/select';
import {
  TRANSLATION_BLOCK_ATTR,
  TRANSLATION_NODE_ATTR,
} from './translation-adapters/dom';

const MAX_TRANSLATION_BLOCKS = 300;
const MAX_TRANSLATION_CHARS = 40000;

interface TranslationItem {
  text: string;
  language?: string;
}

interface TranslationCache {
  url: string;
  target: string;
  truncated: boolean;
  adapter: TranslationAdapter;
  sources: Map<number, TranslationSource>;
  items: Map<number, TranslationItem>;
}

let cache: TranslationCache | null = null;

function pageIdentity(): string {
  // Fragment navigation changes the viewport, not the source document.
  return location.href.split('#')[0];
}

function discardCache(): void {
  revertTranslations();
  cache = null;
}

/** Collects bounded source text through the adapter selected for the current page. */
export function collectTranslationBlocks(): {
  blocks: TranslationBlock[];
  truncated: boolean;
} {
  discardCache();
  const adapter = selectTranslationAdapter();
  const blocks: TranslationBlock[] = [];
  const sources = new Map<number, TranslationSource>();
  let chars = 0;
  let truncated = false;
  for (const source of adapter.collect()) {
    const { text } = source;
    if (text.length < 2 || !/\p{L}/u.test(text)) continue;
    if (
      blocks.length >= MAX_TRANSLATION_BLOCKS ||
      chars + text.length > MAX_TRANSLATION_CHARS
    ) {
      truncated = true;
      break;
    }
    const id = blocks.length + 1;
    source.element.setAttribute(TRANSLATION_BLOCK_ATTR, String(id));
    blocks.push({ id, text });
    sources.set(id, source);
    chars += text.length;
  }
  cache = {
    url: pageIdentity(),
    target: '',
    truncated,
    adapter,
    sources,
    items: new Map(),
  };
  return { blocks, truncated };
}

function isCurrent(
  current: TranslationCache,
  sources: Iterable<TranslationSource>,
): boolean {
  if (current.url !== pageIdentity()) return false;
  for (const source of sources) if (!source.isCurrent()) return false;
  return true;
}

/** Applies results to unchanged sources, replacing earlier results for the same ID. */
export function applyTranslations(
  items: unknown,
  target?: string,
  language?: string,
): number {
  const current = cache;
  if (!current || !Array.isArray(items)) return 0;
  if (!isCurrent(current, current.sources.values())) {
    discardCache();
    return 0;
  }
  if (target) current.target = target;
  const applied = new Set<number>();
  for (const entry of items as { id?: unknown; text?: unknown }[]) {
    const id = Number(entry?.id);
    const text = String(entry?.text ?? '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!Number.isFinite(id) || !text) continue;
    const source = current.sources.get(id);
    if (!source) continue;
    source.render(text, language);
    current.items.set(id, { text, language });
    applied.add(id);
  }
  return applied.size;
}

/** Restores the same target only while its original sources and page remain current. */
export function restoreTranslations(target?: string): {
  applied: number;
  truncated: boolean;
} {
  const current = cache;
  if (!current || !target || current.target !== target || !current.items.size) {
    return { applied: 0, truncated: current?.truncated ?? false };
  }
  if (
    !isCurrent(
      current,
      Array.from(current.items.keys(), (id) => current.sources.get(id)!),
    )
  ) {
    discardCache();
    return { applied: 0, truncated: false };
  }
  for (const [id, item] of current.items) {
    current.sources.get(id)!.render(item.text, item.language);
  }
  return { applied: current.items.size, truncated: current.truncated };
}

/** Removes rendered nodes and site effects while retaining valid text for cached restore. */
export function revertTranslations(): number {
  cache?.adapter.clear();
  const nodes = document.querySelectorAll(`[${TRANSLATION_NODE_ATTR}]`);
  nodes.forEach((node) => node.remove());
  document
    .querySelectorAll(`[${TRANSLATION_BLOCK_ATTR}]`)
    .forEach((el) => el.removeAttribute(TRANSLATION_BLOCK_ATTR));
  return nodes.length;
}

/** Reports rendered translations, discarding a previous page's rendering after navigation. */
export function translationState(): { active: boolean; count: number } {
  if (cache && cache.url !== pageIdentity()) discardCache();
  const count = document.querySelectorAll(`[${TRANSLATION_NODE_ATTR}]`).length;
  return { active: count > 0, count };
}
