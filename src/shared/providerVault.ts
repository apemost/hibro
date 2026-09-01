// Encrypts provider profiles with a browser-managed key kept outside extension storage.

import type { ProviderProfile } from './providers';

const DATABASE_NAME = 'hibroVault';
const DATABASE_VERSION = 1;
const KEY_STORE = 'keys';
const KEY_ID = 'provider-profiles:v1';
const AAD = new TextEncoder().encode('hibro/provider-profiles/v1');

export interface ProviderEnvelopeV1 {
  kind: 'hibro-provider-profiles';
  version: 1;
  cipher: 'AES-GCM';
  iv: string;
  ciphertext: string;
}

export type ProviderVaultErrorCode =
  | 'vault-unavailable'
  | 'key-missing'
  | 'key-invalid'
  | 'envelope-invalid'
  | 'envelope-unsupported'
  | 'decrypt-failed'
  | 'payload-invalid';

/** Identifies provider storage failures without exposing encrypted data. */
export class ProviderVaultError extends Error {
  constructor(readonly code: ProviderVaultErrorCode) {
    super(`Provider vault error: ${code}`);
    this.name = 'ProviderVaultError';
  }
}

let databasePromise: Promise<IDBDatabase> | null = null;

function asVaultError(code: ProviderVaultErrorCode): ProviderVaultError {
  return new ProviderVaultError(code);
}

function openDatabase(): Promise<IDBDatabase> {
  if (databasePromise) return databasePromise;

  databasePromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    let settled = false;

    const fail = () => {
      if (settled) return;
      settled = true;
      databasePromise = null;
      reject(asVaultError('vault-unavailable'));
    };

    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(KEY_STORE)) {
        request.result.createObjectStore(KEY_STORE);
      }
    };
    request.onerror = fail;
    request.onblocked = fail;
    request.onsuccess = () => {
      if (settled) {
        request.result.close();
        return;
      }
      const database = request.result;
      if (!database.objectStoreNames.contains(KEY_STORE)) {
        database.close();
        fail();
        return;
      }
      settled = true;
      database.onversionchange = () => {
        database.close();
        databasePromise = null;
      };
      resolve(database);
    };
  });

  return databasePromise;
}

async function readStoredKey(): Promise<unknown> {
  try {
    const database = await openDatabase();
    return await new Promise((resolve, reject) => {
      const request = database
        .transaction(KEY_STORE, 'readonly')
        .objectStore(KEY_STORE)
        .get(KEY_ID);
      request.onerror = () => reject(asVaultError('vault-unavailable'));
      request.onsuccess = () => resolve(request.result);
    });
  } catch (error) {
    if (error instanceof ProviderVaultError) throw error;
    throw asVaultError('vault-unavailable');
  }
}

async function addStoredKey(key: CryptoKey): Promise<'added' | 'exists'> {
  try {
    const database = await openDatabase();
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(KEY_STORE, 'readwrite');
      const request = transaction.objectStore(KEY_STORE).add(key, KEY_ID);
      let conflict = false;

      request.onerror = () => {
        conflict = request.error?.name === 'ConstraintError';
      };
      transaction.oncomplete = () => resolve('added');
      transaction.onabort = () => {
        if (conflict) resolve('exists');
        else reject(asVaultError('vault-unavailable'));
      };
      transaction.onerror = () => {
        // The abort handler reports the final transaction result.
      };
    });
  } catch (error) {
    if (error instanceof ProviderVaultError) throw error;
    throw asVaultError('vault-unavailable');
  }
}

function requireValidKey(value: unknown): CryptoKey {
  const key = value instanceof CryptoKey ? value : undefined;
  const algorithm = key?.algorithm as AesKeyAlgorithm | undefined;
  if (
    !key ||
    key.type !== 'secret' ||
    key.extractable ||
    algorithm?.name !== 'AES-GCM' ||
    algorithm.length !== 256 ||
    key.usages.length !== 2 ||
    !key.usages.includes('encrypt') ||
    !key.usages.includes('decrypt')
  ) {
    throw asVaultError('key-invalid');
  }
  return key;
}

async function providerKey(createIfMissing: boolean): Promise<CryptoKey> {
  const stored = await readStoredKey();
  if (stored !== undefined) return requireValidKey(stored);
  if (!createIfMissing) throw asVaultError('key-missing');

  let candidate: CryptoKey;
  try {
    candidate = (await crypto.subtle.generateKey(
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    )) as CryptoKey;
  } catch {
    throw asVaultError('vault-unavailable');
  }

  const result = await addStoredKey(candidate);
  if (result === 'added') return requireValidKey(candidate);
  const winner = await readStoredKey();
  if (winner === undefined) throw asVaultError('vault-unavailable');
  return requireValidKey(winner);
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/u, '');
}

function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  if (!value || !/^[A-Za-z0-9_-]+$/u.test(value) || value.length % 4 === 1) {
    throw asVaultError('envelope-invalid');
  }
  const padded = value
    .replaceAll('-', '+')
    .replaceAll('_', '/')
    .padEnd(value.length + ((4 - (value.length % 4)) % 4), '=');
  try {
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  } catch {
    throw asVaultError('envelope-invalid');
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isProviderProfile(value: unknown): value is ProviderProfile {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    (value.provider === 'openai-compatible' ||
      value.provider === 'openai' ||
      value.provider === 'anthropic') &&
    (value.baseUrl === undefined || typeof value.baseUrl === 'string') &&
    typeof value.apiKey === 'string' &&
    typeof value.model === 'string'
  );
}

/** Checks whether a value belongs to the provider-envelope format. */
export function isProviderEnvelopeRecord(
  value: unknown,
): value is Record<string, unknown> {
  return isRecord(value) && value.kind === 'hibro-provider-profiles';
}

/** Checks the supported provider-envelope metadata before decryption. */
export function isProviderEnvelope(
  value: unknown,
): value is ProviderEnvelopeV1 {
  return (
    isProviderEnvelopeRecord(value) &&
    value.version === 1 &&
    value.cipher === 'AES-GCM' &&
    typeof value.iv === 'string' &&
    typeof value.ciphertext === 'string'
  );
}

/** Validates a plaintext profile list before encrypting an upgrade. */
export function validateProviderProfiles(value: unknown): ProviderProfile[] {
  if (!Array.isArray(value) || !value.every(isProviderProfile)) {
    throw asVaultError('payload-invalid');
  }
  return value;
}

/** Encrypts a complete provider list with a fresh authenticated nonce. */
export async function sealProviderProfiles(
  profiles: readonly ProviderProfile[],
  createIfMissing: boolean,
): Promise<ProviderEnvelopeV1> {
  validateProviderProfiles(profiles);
  const key = await providerKey(createIfMissing);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  let ciphertext: ArrayBuffer;
  try {
    ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: AAD },
      key,
      new TextEncoder().encode(JSON.stringify(profiles)),
    );
  } catch {
    throw asVaultError('vault-unavailable');
  }
  return {
    kind: 'hibro-provider-profiles',
    version: 1,
    cipher: 'AES-GCM',
    iv: bytesToBase64Url(iv),
    ciphertext: bytesToBase64Url(new Uint8Array(ciphertext)),
  };
}

/** Decrypts and validates a supported provider envelope. */
export async function openProviderProfiles(
  envelope: ProviderEnvelopeV1,
): Promise<ProviderProfile[]> {
  const iv = base64UrlToBytes(envelope.iv);
  const ciphertext = base64UrlToBytes(envelope.ciphertext);
  if (iv.length !== 12) throw asVaultError('envelope-invalid');
  const key = await providerKey(false);

  let plaintext: ArrayBuffer;
  try {
    plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv, additionalData: AAD },
      key,
      ciphertext,
    );
  } catch {
    throw asVaultError('decrypt-failed');
  }

  try {
    const decoded = new TextDecoder('utf-8', { fatal: true }).decode(plaintext);
    return validateProviderProfiles(JSON.parse(decoded));
  } catch (error) {
    if (error instanceof ProviderVaultError) throw error;
    throw asVaultError('payload-invalid');
  }
}

/** Reports an unsupported or malformed envelope without exposing its contents. */
export function rejectProviderEnvelope(value: unknown): never {
  if (isProviderEnvelopeRecord(value) && value.version !== 1) {
    throw asVaultError('envelope-unsupported');
  }
  throw asVaultError('envelope-invalid');
}
