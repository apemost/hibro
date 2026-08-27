// Protocol and URL policy for explicitly requested remote Markdown images.

import type { HibroImageMediaType } from './imageAssets';

export const REMOTE_IMAGE_PORT = 'hibro-remote-image';

export type RemoteImageErrorCode =
  | 'invalid-request'
  | 'blocked-url'
  | 'network-error'
  | 'unsafe-response';

export interface RemoteImageRequest {
  type: 'fetch-remote-image';
  requestId: string;
  url: string;
}

export type RemoteImageResult =
  | {
      type: 'remote-image-result';
      requestId: string;
      ok: true;
      mediaType: HibroImageMediaType;
      base64: string;
      byteLength: number;
    }
  | {
      type: 'remote-image-result';
      requestId: string;
      ok: false;
      error: RemoteImageErrorCode;
    };

export type RemoteImageDestination =
  | { ok: true; url: string; host: string }
  | { ok: false; error: 'blocked-url' };

function isIpLiteral(hostname: string): boolean {
  return hostname.startsWith('[') || /^(?:\d{1,3}\.){3}\d{1,3}$/.test(hostname);
}

function hasBlockedSpecialUseName(hostname: string): boolean {
  return [
    'localhost',
    '.localhost',
    '.local',
    '.internal',
    'home.arpa',
    '.home.arpa',
    '.test',
    '.invalid',
    '.example',
    '.onion',
  ].some((suffix) => hostname === suffix.replace(/^\./, '') || hostname.endsWith(suffix));
}

/** Canonicalizes an allowed public-looking HTTPS destination without fetching it. */
export function validateRemoteImageUrl(value: string): RemoteImageDestination {
  if (!value || value.length > 4096) return { ok: false, error: 'blocked-url' };
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, error: 'blocked-url' };
  }
  if (url.protocol !== 'https:' || url.username || url.password) {
    return { ok: false, error: 'blocked-url' };
  }

  const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
  if (
    !hostname ||
    !hostname.includes('.') ||
    isIpLiteral(hostname) ||
    hasBlockedSpecialUseName(hostname)
  ) {
    return { ok: false, error: 'blocked-url' };
  }

  url.hostname = hostname;
  url.hash = '';
  return { ok: true, url: url.href, host: url.host };
}
