// Shared storage helpers for named AI provider profiles and the active profile.

import {
  isProviderEnvelope,
  isProviderEnvelopeRecord,
  openProviderProfiles,
  rejectProviderEnvelope,
  sealProviderProfiles,
  validateProviderProfiles,
} from './providerVault';

export type ProviderType = 'openai-compatible' | 'openai' | 'anthropic';

export interface ProviderProfile {
  id: string;
  name: string;
  provider: ProviderType;
  baseUrl?: string;
  apiKey: string;
  model: string;
}

export interface ProviderConfig {
  profiles: ProviderProfile[];
  activeId: string | null;
}

export const PROVIDERS_KEY = 'hibroProviders';
export const ACTIVE_KEY = 'activeProviderId';
export const PRIVACY_CONSENT_KEY = 'hibroPrivacyConsent';

/** Returns whether the user accepted the provider data-use notice. */
export async function readPrivacyConsent(): Promise<boolean> {
  return (
    (await chrome.storage.local.get(PRIVACY_CONSENT_KEY))[
      PRIVACY_CONSENT_KEY
    ] === true
  );
}

/** Stores the user's current provider data-use choice. */
export async function writePrivacyConsent(accepted: boolean): Promise<void> {
  if (accepted) {
    await chrome.storage.local.set({ [PRIVACY_CONSENT_KEY]: true });
  } else {
    await chrome.storage.local.remove(PRIVACY_CONSENT_KEY);
  }
}

/** Allows encrypted remote provider traffic and unencrypted local development endpoints. */
export function isSecureProviderBaseUrl(value: string | undefined): boolean {
  if (!value) return true;
  try {
    const url = new URL(value);
    if (url.protocol === 'https:') return true;
    return (
      url.protocol === 'http:' &&
      (url.hostname === 'localhost' ||
        url.hostname === '127.0.0.1' ||
        url.hostname === '[::1]')
    );
  } catch {
    return false;
  }
}

interface LegacyProviderConfig {
  provider?: ProviderType;
  baseUrl?: string;
  apiKey?: string;
  model?: string;
}

function legacyProfile(
  value: LegacyProviderConfig | undefined,
): ProviderProfile | undefined {
  if (!value?.apiKey || !value.model) return undefined;
  return {
    id: 'migrated',
    name:
      value.provider && value.provider !== 'openai-compatible'
        ? value.provider
        : 'Default',
    provider: value.provider ?? 'openai-compatible',
    baseUrl: value.baseUrl,
    apiKey: value.apiKey,
    model: value.model,
  };
}

async function removeLegacyProvider(): Promise<void> {
  await chrome.storage.local.remove('hibroConfig');
}

/** Reads provider profiles and returns a valid active id when profiles exist. */
export async function readProviderConfig(): Promise<ProviderConfig> {
  const all = (await chrome.storage.local.get([
    PROVIDERS_KEY,
    ACTIVE_KEY,
    'hibroConfig',
  ])) as {
    [PROVIDERS_KEY]?: unknown;
    [ACTIVE_KEY]?: string | null;
    hibroConfig?: LegacyProviderConfig;
  };

  const storedProfiles = all[PROVIDERS_KEY];
  let profiles: ProviderProfile[];
  let activeId = all[ACTIVE_KEY] ?? null;

  if (isProviderEnvelopeRecord(storedProfiles)) {
    if (!isProviderEnvelope(storedProfiles))
      rejectProviderEnvelope(storedProfiles);
    profiles = await openProviderProfiles(storedProfiles);
    if (all.hibroConfig !== undefined) await removeLegacyProvider();
  } else if (storedProfiles === undefined || Array.isArray(storedProfiles)) {
    profiles =
      storedProfiles === undefined
        ? []
        : validateProviderProfiles(storedProfiles);

    // Older installations stored either a plaintext profile list or one
    // unnamed provider. Encrypt either format before returning it to callers.
    const migrated =
      profiles.length === 0 ? legacyProfile(all.hibroConfig) : undefined;
    if (migrated) {
      profiles = [migrated];
      activeId = migrated.id;
    }

    if (storedProfiles !== undefined || migrated) {
      const envelope = await sealProviderProfiles(profiles, true);
      await chrome.storage.local.set({
        [PROVIDERS_KEY]: envelope,
        ...(migrated ? { [ACTIVE_KEY]: activeId } : {}),
      });
      if (all.hibroConfig !== undefined) await removeLegacyProvider();
    }
  } else {
    rejectProviderEnvelope(storedProfiles as Record<string, unknown>);
  }

  if (
    profiles.length &&
    (!activeId || !profiles.some((p) => p.id === activeId))
  ) {
    activeId = profiles[0].id;
  }
  return { profiles, activeId };
}

/** Returns the active profile when one is available. */
export function activeProfile(c: ProviderConfig): ProviderProfile | undefined {
  return c.activeId ? c.profiles.find((p) => p.id === c.activeId) : undefined;
}

/** Encrypts and replaces the stored provider list. */
export async function writeProfiles(
  profiles: ProviderProfile[],
): Promise<void> {
  validateProviderProfiles(profiles);
  const stored = (await chrome.storage.local.get(PROVIDERS_KEY))[
    PROVIDERS_KEY
  ] as unknown;
  let createIfMissing = true;

  if (isProviderEnvelopeRecord(stored)) {
    if (!isProviderEnvelope(stored)) rejectProviderEnvelope(stored);
    // Confirm that the current value is readable before replacing it. A lost
    // key or damaged envelope must never look like an empty provider list.
    await openProviderProfiles(stored);
    createIfMissing = false;
  } else if (stored !== undefined) {
    if (!Array.isArray(stored))
      rejectProviderEnvelope(stored as Record<string, unknown>);
    validateProviderProfiles(stored);
  }

  const envelope = await sealProviderProfiles(profiles, createIfMissing);
  await chrome.storage.local.set({ [PROVIDERS_KEY]: envelope });
  const legacy = (await chrome.storage.local.get('hibroConfig')).hibroConfig;
  if (legacy !== undefined) await removeLegacyProvider();
}

/** Selects the provider profile used by the next request. */
export async function writeActive(id: string): Promise<void> {
  await chrome.storage.local.set({ [ACTIVE_KEY]: id });
}

/** Checks the fields required to call a provider and narrows the profile type. */
export function isComplete(
  p: ProviderProfile | undefined,
): p is ProviderProfile {
  return (
    !!p &&
    !!p.apiKey &&
    !!p.model &&
    (p.provider !== 'openai-compatible' || !!p.baseUrl)
  );
}
