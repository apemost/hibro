// Guarded service-worker fetches for remote images explicitly approved in the panel.

import {
  MAX_IMAGE_BYTES,
  hasMatchingImageSignature,
  imageBytesToBase64,
  normalizeImageMediaType,
  type HibroImageMediaType,
} from './shared/imageAssets';
import {
  type RemoteImageErrorCode,
  type RemoteImageRequest,
  type RemoteImageResult,
  validateRemoteImageUrl,
} from './shared/remoteImages';
import { PANEL_PAGE_PATH, isTrustedExtensionPort } from './panelPort';

const REMOTE_IMAGE_TIMEOUT_MS = 15_000;

class RemoteImageFetchError extends Error {
  constructor(readonly code: RemoteImageErrorCode) {
    super(code);
  }
}

function parseContentLength(value: string | null): number | null {
  if (value === null) return null;
  if (!/^\d+$/.test(value)) throw new RemoteImageFetchError('unsafe-response');
  const length = Number(value);
  if (!Number.isSafeInteger(length) || length > MAX_IMAGE_BYTES) {
    throw new RemoteImageFetchError('unsafe-response');
  }
  return length;
}

async function readLimitedBody(
  response: Response,
  signal: AbortSignal,
): Promise<Uint8Array> {
  if (!response.body) throw new RemoteImageFetchError('unsafe-response');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      if (signal.aborted) throw signal.reason;
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_IMAGE_BYTES) {
        await reader.cancel();
        throw new RemoteImageFetchError('unsafe-response');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  if (total === 0) throw new RemoteImageFetchError('unsafe-response');
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function fetchRemoteImage(
  rawUrl: string,
  outerSignal: AbortSignal,
): Promise<{ mediaType: HibroImageMediaType; bytes: Uint8Array }> {
  const destination = validateRemoteImageUrl(rawUrl);
  if (!destination.ok) throw new RemoteImageFetchError('blocked-url');

  const controller = new AbortController();
  const abort = () => controller.abort(outerSignal.reason);
  outerSignal.addEventListener('abort', abort, { once: true });
  const timeout = setTimeout(() => controller.abort(), REMOTE_IMAGE_TIMEOUT_MS);
  try {
    const response = await fetch(destination.url, {
      method: 'GET',
      mode: 'cors',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      redirect: 'error',
      cache: 'no-store',
      headers: { Accept: 'image/png,image/jpeg,image/webp' },
      signal: controller.signal,
    });
    if (
      response.status !== 200 ||
      response.type === 'opaque' ||
      response.redirected ||
      validateRemoteImageUrl(response.url).ok === false ||
      new URL(response.url).href !== destination.url
    ) {
      throw new RemoteImageFetchError('unsafe-response');
    }
    const mediaType = normalizeImageMediaType(
      response.headers.get('content-type') ?? '',
    );
    if (!mediaType) throw new RemoteImageFetchError('unsafe-response');
    const contentLength = parseContentLength(
      response.headers.get('content-length'),
    );
    const bytes = await readLimitedBody(response, controller.signal);
    if (
      (contentLength !== null && contentLength !== bytes.byteLength) ||
      !hasMatchingImageSignature(bytes, mediaType)
    ) {
      throw new RemoteImageFetchError('unsafe-response');
    }
    return { mediaType, bytes };
  } catch (error) {
    if (error instanceof RemoteImageFetchError) throw error;
    throw new RemoteImageFetchError('network-error');
  } finally {
    clearTimeout(timeout);
    outerSignal.removeEventListener('abort', abort);
  }
}

/** Handles one guarded remote-image request from a verified side-panel port. */
export function attachRemoteImagePort(port: chrome.runtime.Port): void {
  if (!isTrustedExtensionPort(port, [PANEL_PAGE_PATH])) {
    port.disconnect();
    return;
  }
  const controller = new AbortController();
  let handled = false;
  port.onDisconnect.addListener(() => controller.abort());
  port.onMessage.addListener((message: unknown) => {
    if (handled) return;
    handled = true;
    void (async () => {
      const request = message as Partial<RemoteImageRequest>;
      if (
        request.type !== 'fetch-remote-image' ||
        typeof request.requestId !== 'string' ||
        request.requestId.length > 128 ||
        typeof request.url !== 'string'
      ) {
        const invalid: RemoteImageResult = {
          type: 'remote-image-result',
          requestId:
            typeof request.requestId === 'string' ? request.requestId : '',
          ok: false,
          error: 'invalid-request',
        };
        port.postMessage(invalid);
        return;
      }
      try {
        const { mediaType, bytes } = await fetchRemoteImage(
          request.url,
          controller.signal,
        );
        const result: RemoteImageResult = {
          type: 'remote-image-result',
          requestId: request.requestId,
          ok: true,
          mediaType,
          base64: imageBytesToBase64(bytes),
          byteLength: bytes.byteLength,
        };
        port.postMessage(result);
      } catch (error) {
        const result: RemoteImageResult = {
          type: 'remote-image-result',
          requestId: request.requestId,
          ok: false,
          error:
            error instanceof RemoteImageFetchError
              ? error.code
              : 'network-error',
        };
        try {
          port.postMessage(result);
        } catch {
          // The panel was closed while the request was running.
        }
      }
    })();
  });
}
