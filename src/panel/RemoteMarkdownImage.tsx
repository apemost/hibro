import { decodeImageBase64 } from "@/shared/imageAssets";
import {
  REMOTE_IMAGE_PORT,
  type RemoteImageRequest,
  type RemoteImageResult,
  validateRemoteImageUrl,
} from "@/shared/remoteImages";
import { useEffect, useRef, useState, type ComponentProps } from "react";
import { validateImageBlob } from "./ImageAsset";
import { usePanelI18n } from "./i18n";

type RemoteImageState = "ready" | "loading" | "loaded" | "error";

function requestRemoteImage(url: string, portRef: { current: chrome.runtime.Port | null }) {
  return new Promise<RemoteImageResult>((resolve, reject) => {
    const requestId = crypto.randomUUID();
    const port = chrome.runtime.connect({ name: REMOTE_IMAGE_PORT });
    portRef.current = port;
    let settled = false;
    port.onMessage.addListener((message: RemoteImageResult) => {
      if (message.type !== "remote-image-result" || message.requestId !== requestId) return;
      settled = true;
      resolve(message);
    });
    port.onDisconnect.addListener(() => {
      if (!settled) reject(new Error("Remote image port disconnected"));
    });
    const request: RemoteImageRequest = { type: "fetch-remote-image", requestId, url };
    port.postMessage(request);
  });
}

/** Shows a model-authored image URL as an inert, per-resource approval card. */
export function RemoteMarkdownImage(props: ComponentProps<"img"> & { node?: unknown }) {
  const { messages } = usePanelI18n();
  const src = typeof props.src === "string" ? props.src : undefined;
  const alt = typeof props.alt === "string" ? props.alt : undefined;
  const destination = validateRemoteImageUrl(src ?? "");
  const label = alt?.trim() || messages.remoteImage;
  const [state, setState] = useState<RemoteImageState>("ready");
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const portRef = useRef<chrome.runtime.Port | null>(null);
  const versionRef = useRef(0);

  useEffect(() => {
    versionRef.current += 1;
    portRef.current?.disconnect();
    portRef.current = null;
    setState("ready");
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    objectUrlRef.current = null;
    setObjectUrl(null);
    return () => {
      versionRef.current += 1;
      portRef.current?.disconnect();
      portRef.current = null;
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    };
  }, [src]);

  const load = async () => {
    if (!destination.ok || state === "loading") return;
    const version = ++versionRef.current;
    setState("loading");
    try {
      const result = await requestRemoteImage(destination.url, portRef);
      if (version !== versionRef.current || !result.ok) {
        if (version === versionRef.current) setState("error");
        return;
      }
      const bytes = decodeImageBase64(result.base64, result.mediaType, result.byteLength);
      if (!bytes) throw new Error("Invalid remote image bytes");
      const blob = new Blob([new Uint8Array(bytes)], { type: result.mediaType });
      if (!(await validateImageBlob(blob))) throw new Error("Unsafe remote image dimensions");
      if (version !== versionRef.current) return;
      const nextUrl = URL.createObjectURL(blob);
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = nextUrl;
      setObjectUrl(nextUrl);
      setState("loaded");
    } catch {
      if (version === versionRef.current) setState("error");
    } finally {
      if (version === versionRef.current) {
        portRef.current?.disconnect();
        portRef.current = null;
      }
    }
  };

  if (!destination.ok) {
    return (
      <figure className="image-asset-card" aria-label={label} data-hibro-image-state="blocked">
        <div className="image-asset-error">{messages.remoteImageBlocked}</div>
      </figure>
    );
  }

  return (
    <figure className="image-asset-card" aria-label={label} data-hibro-image-state={state}>
      {objectUrl ? (
        <img className="message-image" src={objectUrl} alt={label} />
      ) : (
        <>
          <figcaption className="image-asset-caption">
            <strong>{destination.host}</strong>
            <span>{messages.remoteImageDisclosure}</span>
          </figcaption>
          {state === "error" ? (
            <div role="alert" className="image-asset-error">
              {messages.remoteImageLoadError}
            </div>
          ) : (
            <button
              type="button"
              className="image-asset-load"
              aria-label={messages.loadRemoteImage(destination.host)}
              disabled={state === "loading"}
              onClick={() => void load()}
            >
              {state === "loading" ? messages.imageLoading : messages.loadOnce}
            </button>
          )}
        </>
      )}
    </figure>
  );
}
