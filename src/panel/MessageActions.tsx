// Floating Copy and Explain actions for completed conversation messages.
// Interactive message content keeps its normal click behavior.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { usePanelI18n } from "./i18n";

interface ExplainResponse {
  ok: boolean;
  text?: string;
  error?: string;
}

interface Anchor {
  top: number;
  bottom: number;
  left: number;
  text: string;
}

interface Pill extends Anchor {
  kind: "message" | "selection";
}

interface Card extends Anchor {
  loading: boolean;
  result: string;
}

// Keep the action pill inside the narrow panel.
const clampLeft = (x: number): number =>
  Math.max(76, Math.min(x, window.innerWidth - 76));

const PILL_PLACE_BELOW_THRESHOLD = 44;
const CARD_EDGE_GAP = 8;
const CARD_ANCHOR_GAP = 6;
const COPIED_MS = 1200;

function clampCardCoordinate(preferred: number, size: number, viewportSize: number): number {
  const maximum = Math.max(CARD_EDGE_GAP, viewportSize - size - CARD_EDGE_GAP);
  return Math.min(Math.max(preferred, CARD_EDGE_GAP), maximum);
}

function placeCardWithinViewport(element: HTMLDivElement, anchor: Anchor): void {
  const rect = element.getBoundingClientRect();
  const left = clampCardCoordinate(anchor.left - rect.width / 2, rect.width, window.innerWidth);
  const below = anchor.bottom + CARD_ANCHOR_GAP;
  const above = anchor.top - rect.height - CARD_ANCHOR_GAP;
  const maximumTop = window.innerHeight - rect.height - CARD_EDGE_GAP;
  const fitsBelow = below <= maximumTop;
  const fitsAbove = above >= CARD_EDGE_GAP;
  const preferredTop = fitsBelow
    ? below
    : fitsAbove
      ? above
      : anchor.top > window.innerHeight - anchor.bottom
        ? above
        : below;

  element.style.left = `${left}px`;
  element.style.top = `${clampCardCoordinate(preferredTop, rect.height, window.innerHeight)}px`;
  element.style.visibility = "visible";
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fall back when the panel is not focused for the async clipboard API.
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch {
      ok = false;
    }
    ta.remove();
    return ok;
  }
}

/** Adds contextual Copy and Explain actions to the conversation log. */
export function MessageActions() {
  const { messages } = usePanelI18n();
  const [pill, setPill] = useState<Pill | null>(null);
  const [card, setCard] = useState<Card | null>(null);
  const [copied, setCopied] = useState(false);
  const pillRef = useRef<HTMLDivElement | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);

  // A message selection offers Copy and Explain at the selection.
  useEffect(() => {
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const sel = window.getSelection();
        if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;
        const range = sel.getRangeAt(0);
        const node = range.commonAncestorContainer;
        const el = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
        if (!el || !el.closest("#log .msg")) return;
        const text = sel.toString().trim();
        if (!text) return;
        const rect = range.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) return;
        setCopied(false);
        setPill({
          kind: "selection",
          top: rect.top,
          bottom: rect.bottom,
          left: clampLeft(rect.left + rect.width / 2),
          text
        });
        setCard(null);
      });
    };
    document.addEventListener("selectionchange", update);
    return () => {
      document.removeEventListener("selectionchange", update);
      cancelAnimationFrame(frame);
    };
  }, []);

  // A plain click on finished message text offers Copy at the click point.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const log = document.getElementById("log");
      const target = e.target as HTMLElement;
      if (!log || !log.contains(target)) return;
      const msg = target.closest<HTMLElement>(".msg");
      if (!msg) {
        setPill(null);
        return;
      }
      if (target.closest("a, button, summary, input, textarea, [role='button']")) return;
      const sel = window.getSelection();
      if (sel && !sel.isCollapsed) return; // a drag-selection's trailing click
      if (msg.classList.contains("streaming")) return;
      const text = (msg.querySelector<HTMLElement>(".msg-text")?.innerText ?? msg.innerText).trim();
      if (!text) return;
      setCopied(false);
      setPill({ kind: "message", top: e.clientY, bottom: e.clientY, left: clampLeft(e.clientX), text });
      setCard(null);
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  // Dismiss actions when their page position is no longer meaningful.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (pillRef.current?.contains(e.target as Node)) return;
      if (cardRef.current?.contains(e.target as Node)) return;
      setPill(null);
    };
    const onScroll = () => setPill(null);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("scroll", onScroll, true);
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setPill(null);
        setCard(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!card) return;
    const onDown = (e: MouseEvent) => {
      if (cardRef.current && !cardRef.current.contains(e.target as Node)) {
        setCard(null);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [card]);

  useLayoutEffect(() => {
    const element = cardRef.current;
    if (!card || !element) return;
    const update = () => placeCardWithinViewport(element, card);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    window.addEventListener("resize", update);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [card]);

  const onCopy = async (): Promise<void> => {
    if (!pill) return;
    const ok = await copyText(pill.text);
    if (!ok) return;
    setCopied(true);
    window.setTimeout(() => setCopied(false), COPIED_MS);
  };

  const onExplain = async (): Promise<void> => {
    if (!pill || pill.kind !== "selection") return;
    const { top, bottom, left, text } = pill;
    setCard({
      top,
      bottom,
      left,
      text,
      loading: true,
      result: ""
    });
    setPill(null);
    try {
      const res = (await chrome.runtime.sendMessage({
        type: "hibro:explain",
        text
      })) as ExplainResponse;
      const result = res.ok ? (res.text ?? "") : (res.error ?? messages.genericError);
      setCard((c) => (c && c.text === text ? { ...c, loading: false, result } : c));
    } catch (err) {
      const result = err instanceof Error ? err.message : String(err);
      setCard((c) => (c && c.text === text ? { ...c, loading: false, result } : c));
    }
  };

  const pillBelow = pill ? pill.top < PILL_PLACE_BELOW_THRESHOLD : false;

  return (
    <>
      {pill && (
        <div
          ref={pillRef}
          className={`action-pill${pillBelow ? " below" : ""}`}
          style={{
            top: `${pillBelow ? pill.bottom : pill.top}px`,
            left: `${pill.left}px`
          }}
          // Keep the selection available for Explain after Copy.
          onMouseDown={(e) => e.preventDefault()}
        >
          <button type="button" data-action="copy" onClick={() => void onCopy()}>
            {copied ? messages.copied : messages.copy}
          </button>
          {pill.kind === "selection" && (
            <>
              <span className="action-pill-divider" aria-hidden="true" />
              <button type="button" data-action="explain" onClick={() => void onExplain()}>
                {messages.explain}
              </button>
            </>
          )}
        </div>
      )}
      {card && (
        <div
          ref={cardRef}
          data-explain-result
          className="selection-explain-card"
        >
          <div className="selection-explain-card-head">
            <span className="selection-explain-quote">{card.text}</span>
            <button
              type="button"
              aria-label={messages.closeExplanation}
              className="selection-explain-close"
              onClick={() => setCard(null)}
            >
              ×
            </button>
          </div>
          <div className="selection-explain-body">
            {card.loading ? messages.thinking : card.result}
          </div>
        </div>
      )}
    </>
  );
}
