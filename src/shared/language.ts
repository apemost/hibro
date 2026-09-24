// Shared language preferences for Settings and the side panel: the interface
// language, and the language the page-translation feature translates into.
// Both live in the same `hibroOptions` object, so writes merge instead of
// replacing it.

export type UiLanguage = 'en' | 'zh-CN';

/**
 * Languages offered as page-translation targets. `label` is the endonym shown
 * in Settings, `english` names the language in the translation prompt.
 */
export const TRANSLATION_LANGUAGES = [
  { code: 'en', label: 'English', english: 'English' },
  { code: 'zh-CN', label: '简体中文', english: 'Simplified Chinese' },
  { code: 'zh-TW', label: '繁體中文', english: 'Traditional Chinese' },
  { code: 'ja', label: '日本語', english: 'Japanese' },
  { code: 'ko', label: '한국어', english: 'Korean' },
  { code: 'fr', label: 'Français', english: 'French' },
  { code: 'de', label: 'Deutsch', english: 'German' },
  { code: 'es', label: 'Español', english: 'Spanish' },
  { code: 'pt', label: 'Português', english: 'Portuguese' },
  { code: 'ru', label: 'Русский', english: 'Russian' },
  { code: 'it', label: 'Italiano', english: 'Italian' },
  { code: 'ar', label: 'العربية', english: 'Arabic' },
  { code: 'hi', label: 'हिन्दी', english: 'Hindi' },
  { code: 'id', label: 'Bahasa Indonesia', english: 'Indonesian' },
  { code: 'vi', label: 'Tiếng Việt', english: 'Vietnamese' },
  { code: 'th', label: 'ไทย', english: 'Thai' },
] as const;

export type TranslationLanguage =
  (typeof TRANSLATION_LANGUAGES)[number]['code'];

export interface HibroOptions {
  language: UiLanguage;
  // Absent until the user picks one, so the target keeps following the
  // interface language instead of freezing at whatever it was first read as.
  translationTarget?: TranslationLanguage;
}

export const HIBRO_OPTIONS_KEY = 'hibroOptions';
export const DEFAULT_UI_LANGUAGE: UiLanguage = 'en';
export const UI_LANGUAGE_LABELS: Record<UiLanguage, string> = {
  en: 'English',
  'zh-CN': '简体中文',
};

/** Checks whether a stored value is a supported interface language. */
export function isUiLanguage(value: unknown): value is UiLanguage {
  return value === 'en' || value === 'zh-CN';
}

/** Checks whether a stored value is a supported translation target. */
export function isTranslationLanguage(
  value: unknown,
): value is TranslationLanguage {
  return TRANSLATION_LANGUAGES.some((entry) => entry.code === value);
}

function readOptionsObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

/** Returns the language stored in a Hibro options object. */
export function resolveUiLanguage(value: unknown): UiLanguage {
  const language = readOptionsObject(value).language;
  return isUiLanguage(language) ? language : DEFAULT_UI_LANGUAGE;
}

/**
 * Returns the translation target stored in a Hibro options object. Without an
 * explicit choice it follows the interface language, which is always one of
 * the supported translation targets.
 */
export function resolveTranslationTarget(value: unknown): TranslationLanguage {
  const target = readOptionsObject(value).translationTarget;
  return isTranslationLanguage(target) ? target : resolveUiLanguage(value);
}

/** Names a translation target for the translation prompt. */
export function translationLanguageName(code: TranslationLanguage): string {
  const entry = TRANSLATION_LANGUAGES.find((item) => item.code === code);
  return entry ? `${entry.english} (${entry.label})` : code;
}

async function readOptions(): Promise<unknown> {
  return (await chrome.storage.local.get(HIBRO_OPTIONS_KEY))[HIBRO_OPTIONS_KEY];
}

// Both preferences share one storage object, so a write merges into the
// stored value instead of replacing it. Fields nobody has set stay absent.
async function patchOptions(patch: Partial<HibroOptions>): Promise<void> {
  const current = readOptionsObject(await readOptions());
  await chrome.storage.local.set({
    [HIBRO_OPTIONS_KEY]: { ...current, ...patch },
  });
}

/** Reads the interface language and falls back to English. */
export async function readUiLanguage(): Promise<UiLanguage> {
  return resolveUiLanguage(await readOptions());
}

/** Stores the interface language shared by all extension pages. */
export async function writeUiLanguage(language: UiLanguage): Promise<void> {
  await patchOptions({ language });
}

/** Reads the page-translation target and falls back to the interface language. */
export async function readTranslationTarget(): Promise<TranslationLanguage> {
  return resolveTranslationTarget(await readOptions());
}

/** Stores the page-translation target shared by all extension pages. */
export async function writeTranslationTarget(
  translationTarget: TranslationLanguage,
): Promise<void> {
  await patchOptions({ translationTarget });
}
