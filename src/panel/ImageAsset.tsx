import {
  MAX_IMAGE_DIMENSION,
  MAX_IMAGE_PIXELS,
  decodeImageBase64,
} from '@/shared/imageAssets';
import type { HibroPart } from '@/shared/protocol';
import { useEffect, useState } from 'react';
import { usePanelI18n } from './i18n';

type ImageAssetPart = Extract<HibroPart, { type: 'image-asset' }>;

/** Rejects undecodable or exceptionally large image dimensions before display. */
export async function validateImageBlob(blob: Blob): Promise<boolean> {
  try {
    const bitmap = await createImageBitmap(blob);
    const valid =
      bitmap.width > 0 &&
      bitmap.height > 0 &&
      bitmap.width <= MAX_IMAGE_DIMENSION &&
      bitmap.height <= MAX_IMAGE_DIMENSION &&
      bitmap.width * bitmap.height <= MAX_IMAGE_PIXELS;
    bitmap.close();
    return valid;
  } catch {
    return false;
  }
}

/** Renders a validated provider-returned image from a revocable local URL. */
export function ImageAsset({ part }: { part: ImageAssetPart }) {
  const { messages } = usePanelI18n();
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  const label = part.alt?.trim() || messages.generatedImage;

  useEffect(() => {
    let active = true;
    let localUrl: string | null = null;
    setObjectUrl(null);
    setInvalid(false);
    const bytes = decodeImageBase64(
      part.base64,
      part.mediaType,
      part.byteLength,
    );
    if (!bytes) {
      setInvalid(true);
      return () => {
        active = false;
      };
    }
    const blob = new Blob([new Uint8Array(bytes)], { type: part.mediaType });
    localUrl = URL.createObjectURL(blob);
    void validateImageBlob(blob).then((valid) => {
      if (!active) return;
      if (valid) setObjectUrl(localUrl);
      else {
        URL.revokeObjectURL(localUrl!);
        localUrl = null;
        setInvalid(true);
      }
    });
    return () => {
      active = false;
      if (localUrl) URL.revokeObjectURL(localUrl);
    };
  }, [part.base64, part.byteLength, part.mediaType]);

  if (invalid) {
    return (
      <figure
        className="image-asset-card"
        aria-label={label}
        data-hibro-image-state="blocked"
      >
        <div role="alert" className="image-asset-error">
          {messages.inlineImageInvalid}
        </div>
      </figure>
    );
  }
  return (
    <figure
      className="image-asset-card"
      aria-label={label}
      data-hibro-image-state="local"
    >
      {objectUrl ? (
        <img className="message-image" src={objectUrl} alt={label} />
      ) : (
        <div className="image-asset-status">{messages.imageLoading}</div>
      )}
    </figure>
  );
}
