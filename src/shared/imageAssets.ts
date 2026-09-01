// Shared validation for image bytes that may cross the worker/panel boundary.

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_IMAGE_DIMENSION = 8192;
export const MAX_IMAGE_PIXELS = 32_000_000;

export type HibroImageMediaType = 'image/png' | 'image/jpeg' | 'image/webp';

const SUPPORTED_IMAGE_MEDIA_TYPES = new Set<HibroImageMediaType>([
  'image/png',
  'image/jpeg',
  'image/webp',
]);

/** Returns a supported raster media type without optional parameters. */
export function normalizeImageMediaType(
  value: string,
): HibroImageMediaType | null {
  const normalized = value.split(';', 1)[0].trim().toLowerCase();
  return SUPPORTED_IMAGE_MEDIA_TYPES.has(normalized as HibroImageMediaType)
    ? (normalized as HibroImageMediaType)
    : null;
}

/** Checks that decoded bytes match the declared raster format. */
export function hasMatchingImageSignature(
  bytes: Uint8Array,
  mediaType: HibroImageMediaType,
): boolean {
  if (mediaType === 'image/png') {
    const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    return signature.every((value, index) => bytes[index] === value);
  }
  if (mediaType === 'image/jpeg') {
    return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  return (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  );
}

/** Decodes and validates a base64 raster payload before it is rendered. */
export function decodeImageBase64(
  base64: string,
  mediaType: HibroImageMediaType,
  expectedByteLength?: number,
): Uint8Array | null {
  if (!base64 || base64.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 4)
    return null;
  let decoded: string;
  try {
    decoded = atob(base64);
  } catch {
    return null;
  }
  if (
    decoded.length === 0 ||
    decoded.length > MAX_IMAGE_BYTES ||
    (expectedByteLength !== undefined && decoded.length !== expectedByteLength)
  ) {
    return null;
  }
  const bytes = Uint8Array.from(decoded, (character) =>
    character.charCodeAt(0),
  );
  return hasMatchingImageSignature(bytes, mediaType) ? bytes : null;
}

/** Encodes validated binary data for structured extension messages. */
export function imageBytesToBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000;
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(
      ...bytes.subarray(offset, offset + chunkSize),
    );
  }
  return btoa(binary);
}
