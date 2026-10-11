// Select once per collection. Source handles retain that adapter during restore.
import { createDefaultAdapter } from './default';
import { createGitHubAdapter } from './github';
import type { TranslationAdapter } from './types';

/** Keeps GitHub file views comment-only even when their code layout is unsupported. */
export function selectTranslationAdapter(): TranslationAdapter {
  if (
    location.hostname === 'github.com' &&
    /^\/[^/]+\/[^/]+\/blob\/.+/.test(location.pathname)
  ) {
    return createGitHubAdapter();
  }
  return createDefaultAdapter();
}
