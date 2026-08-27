import {
  Conversation,
  ConversationContent,
  ConversationEmptyState
} from "@/components/ai-elements/conversation";
import { Message, MessageContent, MessageResponse } from "@/components/ai-elements/message";
import { Tool } from "@/components/ai-elements/tool";
import { ConversationDrawer } from "./ConversationDrawer";
import { MessageActions } from "./MessageActions";
import { ProviderPicker } from "./ProviderPicker";
import { useProviders } from "./useProviders";
import { cn } from "@/lib/utils";
import type { HibroPart } from "@/shared/protocol";
import {
  type FormEvent,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  useId,
  useLayoutEffect,
  useRef,
  useState
} from "react";
import { useStickToBottomContext } from "use-stick-to-bottom";
import { useHibroChat } from "./useHibroChat";
import { useInputHistory } from "./useInputHistory";
import { deriveTitle } from "@/shared/conversations";
import { PartStreamingContext } from "./partStreaming";
import { PanelI18nProvider, usePanelI18n } from "./i18n";

const MAX_INPUT_HEIGHT = 400;
const INPUT_RESIZE_STEP = 24;
const COLLAPSED_USER_MESSAGE_HEIGHT = 400;

type InputResizeDrag = {
  pointerId: number;
  startY: number;
  startHeight: number;
};

// Renders answer text and tool cards. Reasoning stays in the temporary run
// readout, while the streaming flag helps fenced blocks avoid early previews.
function MessageParts({ parts, streaming }: { parts: HibroPart[]; streaming: boolean }) {
  return (
    <PartStreamingContext.Provider value={streaming}>
      {parts.map((p, i) => {
        if (p.type === "text") {
          return <MessageResponse key={i}>{p.text}</MessageResponse>;
        }
        if (p.type === "reasoning") return null;
        return <Tool key={i} part={p} />;
      })}
    </PartStreamingContext.Provider>
  );
}

// Keep the newest message visible when the run readout changes footer height.
// Do not move the log after the user has scrolled away from the bottom.
function ReadoutScrollCompensator({ rows, titled }: { rows: number; titled: boolean }) {
  const { scrollToBottom, isAtBottom } = useStickToBottomContext();
  useLayoutEffect(() => {
    if (isAtBottom) void scrollToBottom("instant");
    // Recheck bottom-following state whenever the readout height changes.
  }, [rows, titled]);
  return null;
}

// Keep the full user message available to copy while collapsing its visual height.
function CollapsibleUserMessage({ text }: { text: string }) {
  const { messages } = usePanelI18n();
  const contentId = useId();
  const contentRef = useRef<HTMLDivElement>(null);
  const [overflowing, setOverflowing] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useLayoutEffect(() => {
    const content = contentRef.current;
    if (!content) return;
    const measure = () => {
      const nextOverflowing = content.scrollHeight > COLLAPSED_USER_MESSAGE_HEIGHT;
      setOverflowing(nextOverflowing);
      if (!nextOverflowing) setExpanded(false);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(content);
    return () => observer.disconnect();
  }, [text]);

  return (
    <>
      <div
        ref={contentRef}
        id={contentId}
        className="msg-text user-message-content"
        style={
          overflowing && !expanded
            ? { maxHeight: COLLAPSED_USER_MESSAGE_HEIGHT, overflow: "hidden" }
            : undefined
        }
      >
        {text}
      </div>
      {overflowing && (
        <button
          type="button"
          className="user-message-toggle"
          aria-controls={contentId}
          aria-expanded={expanded}
          onClick={() => setExpanded((current) => !current)}
        >
          {expanded ? messages.showLess : messages.showMore}
        </button>
      )}
    </>
  );
}

function PanelApp() {
  const { messages: ui } = usePanelI18n();
  const {
    messages,
    status,
    statusText,
    activeId,
    summaries,
    send,
    stop,
    newChat,
    switchTo,
    renameConversation,
    deleteConversation
  } = useHibroChat();
  const {
    profiles,
    activeId: activeProviderId,
    storageError: providerStorageError,
    setActive
  } = useProviders();
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const inputMinHeight = useRef<number | null>(null);
  const inputResizeDrag = useRef<InputResizeDrag | null>(null);
  const [inputHeight, setInputHeight] = useState<number | null>(null);
  // Recall sent messages without losing the current draft.
  const { record: recordInput, handleKey: handleHistoryKey } = useInputHistory({ text, setText });
  const [drawerOpen, setDrawerOpen] = useState(false);
  // Chrome already labels the side panel, so the app bar shows the thread title.
  const storedTitle = summaries.find((conversation) => conversation.id === activeId)?.title;
  const activeTitle = storedTitle ?? (messages.length === 0 ? ui.newChat : deriveTitle(messages));
  const busy = status === "streaming";
  const selectedProvider = activeProviderId ?? profiles[0]?.id ?? "";

  // Show the latest reasoning lines while they stream, otherwise show the
  // worker status. Hide the readout as soon as answer text starts.
  const lastMessage = messages[messages.length - 1];
  const tailParts =
    busy && lastMessage?.role === "assistant" && !lastMessage.error ? lastMessage.parts : [];
  const lastPart = tailParts[tailParts.length - 1];
  const reasoningLines =
    lastPart?.type === "reasoning"
      ? lastPart.text
          .split("\n")
          .map((l) => l.trim())
          .filter(Boolean)
          .slice(-3)
      : [];
  const sawReasoning = tailParts.some((p) => p.type === "reasoning");
  const readoutLines =
    reasoningLines.length > 0
      ? reasoningLines
      : busy && !sawReasoning && statusText
        ? [ui.localizeStatus(statusText)]
        : [];

  // Preserve the initial two-row height as the resize floor.
  useLayoutEffect(() => {
    const initialHeight = inputRef.current?.getBoundingClientRect().height;
    if (!initialHeight) return;
    inputMinHeight.current = initialHeight;
    setInputHeight(initialHeight);
  }, []);

  const resizeInput = (nextHeight: number) => {
    const measuredHeight = inputRef.current?.getBoundingClientRect().height ?? nextHeight;
    const minHeight = inputMinHeight.current ?? measuredHeight;
    inputMinHeight.current = minHeight;
    setInputHeight(Math.min(MAX_INPUT_HEIGHT, Math.max(minHeight, nextHeight)));
  };

  const onInputResizePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !inputRef.current) return;
    const startHeight = inputRef.current.getBoundingClientRect().height;
    if (inputMinHeight.current === null) inputMinHeight.current = startHeight;
    inputResizeDrag.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startHeight
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  };

  const onInputResizePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = inputResizeDrag.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    resizeInput(drag.startHeight + drag.startY - event.clientY);
    event.preventDefault();
  };

  const finishInputResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (inputResizeDrag.current?.pointerId !== event.pointerId) return;
    inputResizeDrag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const onInputResizeKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const currentHeight = inputRef.current?.getBoundingClientRect().height;
    if (!currentHeight) return;
    const minHeight = inputMinHeight.current ?? currentHeight;
    let nextHeight: number;
    switch (event.key) {
      case "ArrowUp":
        nextHeight = currentHeight + INPUT_RESIZE_STEP;
        break;
      case "ArrowDown":
        nextHeight = currentHeight - INPUT_RESIZE_STEP;
        break;
      case "Home":
        nextHeight = minHeight;
        break;
      case "End":
        nextHeight = MAX_INPUT_HEIGHT;
        break;
      default:
        return;
    }
    event.preventDefault();
    resizeInput(nextHeight);
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    setText("");
    recordInput(trimmed);
    // The composer keeps focus so a follow-up can be typed while the answer
    // streams. No double-caret conflict: the streaming indicator is the
    // .stream-dots bubble below the log, not a text caret.
    void send(trimmed);
  };

  return (
    <>
      <header className="app-bar">
        <button
          type="button"
          id="convDrawerBtn"
          className="icon-btn"
          data-tip={ui.history}
          aria-label={ui.conversationHistory}
          onClick={() => setDrawerOpen(true)}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
          >
            <path d="M3 6h18" />
            <path d="M3 12h18" />
            <path d="M3 18h18" />
          </svg>
        </button>
        <span className="app-title">{activeTitle}</span>
        <button
          type="button"
          id="quickNewChatBtn"
          className="icon-btn"
          data-tip={ui.newChat}
          aria-label={ui.newChat}
          onClick={() => void newChat()}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            aria-hidden="true"
          >
            <path d="M12 5v14" />
            <path d="M5 12h14" />
          </svg>
        </button>
      </header>

      <Conversation id="log">
        <ReadoutScrollCompensator rows={readoutLines.length} titled={reasoningLines.length > 0} />
        <ConversationContent>
          {messages.length === 0 ? (
            <ConversationEmptyState
              title={ui.askTitle}
              description={ui.askDescription}
            />
          ) : (
            messages.map((m, i) => {
              const streaming =
                busy && i === messages.length - 1 && m.role === "assistant" && !m.error;
              // The dots fill only dead air: the pre-first-token wait,
              // reasoning, and the thinking gaps between tool steps. They hide
              // while answer text streams (the text itself is the progress
              // signal) and while a tool call is executing. A running tool
              // card carries its own pulsing "Running" badge, driven by the
              // tool part's input-available → output-available/output-error
              // lifecycle, so the dots never duplicate it.
              const anyToolRunning = m.parts.some(
                (p) => p.type === "tool-invocation" && p.state === "input-available"
              );
              const tailIsText = m.parts[m.parts.length - 1]?.type === "text";
              const showDots = streaming && !tailIsText && !anyToolRunning;
              const userText = m.parts
                .filter((p) => p.type === "text")
                .map((p) => p.text)
                .join("");
              return (
                <Message
                  key={m.id}
                  from={m.role}
                  className={cn(
                    "msg",
                    m.role,
                    m.error && "error",
                    streaming && "streaming"
                  )}
                >
                  <MessageContent className={m.error ? "error-bubble" : undefined}>
                    {m.role === "user" ? (
                      <CollapsibleUserMessage text={userText} />
                    ) : (
                      <div className="msg-text">
                        <MessageParts parts={m.parts} streaming={streaming} />
                        {m.errorAction === "open-provider-settings" && (
                          <a
                            className="error-action"
                            href={chrome.runtime.getURL("src/options.html")}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {ui.openProviderSettings}
                          </a>
                        )}
                      </div>
                    )}
                  </MessageContent>
                  {showDots && (
                    <span className="stream-dots" aria-hidden="true">
                      <i />
                      <i />
                      <i />
                    </span>
                  )}
                </Message>
              );
            })
          )}
        </ConversationContent>
      </Conversation>

      <footer>
        {readoutLines.length > 0 && (
          <div id="run-readout" aria-live="polite">
            {reasoningLines.length > 0 && <div className="run-readout-title">{ui.thinking}</div>}
            {readoutLines.map((line, i) => (
              <div className="run-readout-line" key={i}>
                {line}
              </div>
            ))}
          </div>
        )}
        <form className="composer" onSubmit={onSubmit}>
          <div className="composer-input">
            <div
              id="inputResizeHandle"
              className="input-resize-handle"
              role="separator"
              aria-label={ui.resizeMessageInput}
              aria-orientation="horizontal"
              aria-controls="input"
              aria-valuemin={
                inputMinHeight.current === null ? undefined : Math.round(inputMinHeight.current)
              }
              aria-valuemax={MAX_INPUT_HEIGHT}
              aria-valuenow={inputHeight === null ? undefined : Math.round(inputHeight)}
              tabIndex={0}
              onPointerDown={onInputResizePointerDown}
              onPointerMove={onInputResizePointerMove}
              onPointerUp={finishInputResize}
              onPointerCancel={finishInputResize}
              onLostPointerCapture={finishInputResize}
              onKeyDown={onInputResizeKeyDown}
            />
            <textarea
              ref={inputRef}
              id="input"
              rows={2}
              style={{ height: inputHeight ?? undefined }}
              placeholder={ui.composerPlaceholder}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                // Let an IME finish composition before handling chat shortcuts.
                if (e.nativeEvent.isComposing || e.keyCode === 229) return;
                // Leave unhandled arrow keys to the textarea caret.
                if (handleHistoryKey(e)) return;
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  e.currentTarget.form?.requestSubmit();
                }
              }}
            />
          </div>
          <div className="toolbar">
            <button
              type="button"
              id="settingsBtn"
              className="icon-btn"
              data-tip={ui.settings}
              aria-label={ui.settings}
              onClick={() => chrome.runtime.openOptionsPage()}
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
              >
                <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.38a2 2 0 0 0-.73-2.73l-.15-.09a2 2 0 0 1-1-1.74v-.51a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            </button>
            <span className="spacer" />
            <ProviderPicker
              profiles={profiles}
              selectedId={selectedProvider}
              disabled={providerStorageError || profiles.length === 0}
              onSelect={(id) => void setActive(id)}
            />
            <button
              type="button"
              id="stopBtn"
              className="icon-btn primary"
              data-tip={ui.stop}
              aria-label={ui.stop}
              hidden={!busy}
              onClick={stop}
            >
              <svg viewBox="0 0 24 24" fill="currentColor">
                <rect x="6" y="6" width="12" height="12" rx="2" />
              </svg>
            </button>
            <button
              type="submit"
              id="sendBtn"
              className="icon-btn primary"
              data-tip={ui.send}
              aria-label={ui.send}
              hidden={busy}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M22 2 11 13" /><path d="M22 2 15 22l-4-9-9-4z" />
              </svg>
            </button>
          </div>
        </form>
      </footer>

      <ConversationDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        summaries={summaries}
        activeId={activeId}
        onSelect={(id) => {
          void switchTo(id);
          setDrawerOpen(false);
        }}
        onRename={renameConversation}
        onDelete={(id) => {
          void deleteConversation(id);
        }}
      />

      <MessageActions />
    </>
  );
}

/** Renders the localized side-panel chat interface. */
export function App() {
  return (
    <PanelI18nProvider>
      <PanelApp />
    </PanelI18nProvider>
  );
}
