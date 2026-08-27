// Shared interface-language preference for Settings and the side panel.

export type UiLanguage = "en" | "zh-CN";

export interface HibroOptions {
  language: UiLanguage;
}

export const HIBRO_OPTIONS_KEY = "hibroOptions";
export const DEFAULT_UI_LANGUAGE: UiLanguage = "en";
export const UI_LANGUAGE_LABELS: Record<UiLanguage, string> = {
  en: "English",
  "zh-CN": "简体中文"
};

/** Checks whether a stored value is a supported interface language. */
export function isUiLanguage(value: unknown): value is UiLanguage {
  return value === "en" || value === "zh-CN";
}

/** Returns the language stored in a Hibro options object. */
export function resolveUiLanguage(value: unknown): UiLanguage {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return DEFAULT_UI_LANGUAGE;
  }
  const language = (value as { language?: unknown }).language;
  return isUiLanguage(language) ? language : DEFAULT_UI_LANGUAGE;
}

/** Reads the interface language and falls back to English. */
export async function readUiLanguage(): Promise<UiLanguage> {
  const value = (await chrome.storage.local.get(HIBRO_OPTIONS_KEY))[HIBRO_OPTIONS_KEY];
  return resolveUiLanguage(value);
}

/** Stores the interface language shared by all extension pages. */
export async function writeUiLanguage(language: UiLanguage): Promise<void> {
  const options: HibroOptions = { language };
  await chrome.storage.local.set({ [HIBRO_OPTIONS_KEY]: options });
}
