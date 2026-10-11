// Slide-over list for switching, renaming, and deleting recent conversations.

import { useEffect, useState, type FormEvent } from 'react';
import type { ConversationSummary } from '@/shared/conversations';
import { usePanelI18n, type PanelMessages } from './i18n';

interface ConversationDrawerProps {
  open: boolean;
  onClose: () => void;
  summaries: ConversationSummary[];
  activeId: string;
  onSelect: (id: string) => void;
  onRename: (id: string, title: string) => Promise<void>;
  onDelete: (id: string) => void;
}

// Keep recent timestamps short enough for narrow History rows.
function formatRelative(ts: number, messages: PanelMessages): string {
  const m = Math.floor((Date.now() - ts) / 60000);
  if (m < 1) return messages.justNow;
  if (m < 60) return messages.minutesAgo(m);
  const h = Math.floor(m / 60);
  if (h < 24) return messages.hoursAgo(h);
  const d = Math.floor(h / 24);
  if (d < 7) return messages.daysAgo(d);
  const dt = new Date(ts);
  return `${dt.getMonth() + 1}-${dt.getDate()}`;
}

/** Renders the conversation History drawer. */
export function ConversationDrawer({
  open,
  onClose,
  summaries,
  activeId,
  onSelect,
  onRename,
  onDelete,
}: ConversationDrawerProps) {
  const { messages } = usePanelI18n();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) return;
    setEditingId(null);
    setDraftTitle('');
    setSaving(false);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const beginRename = (conversation: ConversationSummary) => {
    setEditingId(conversation.id);
    setDraftTitle(conversation.title);
  };

  const cancelRename = () => {
    setEditingId(null);
    setDraftTitle('');
  };

  const submitRename = async (event: FormEvent, id: string) => {
    event.preventDefault();
    const title = draftTitle.trim();
    if (!title) {
      cancelRename();
      return;
    }
    setSaving(true);
    try {
      await onRename(id, title);
      cancelRename();
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      {open && (
        <div id="convBackdrop" className="conv-backdrop" onClick={onClose} />
      )}
      <aside
        id="convDrawer"
        className={`conv-drawer${open ? ' open' : ''}`}
        aria-hidden={!open}
        aria-label={messages.recentConversations}
        inert={!open}
      >
        <div className="conv-drawer-head">
          <h2 className="conv-drawer-title">{messages.history}</h2>
          <span className="spacer" />
          <button
            type="button"
            id="convDrawerClose"
            className="icon-btn"
            data-tip={messages.close}
            aria-label={messages.closeHistory}
            onClick={onClose}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
            >
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        </div>
        <div
          className="conv-drawer-list"
          role="list"
          aria-label={messages.recentConversations}
        >
          {summaries.length === 0 && (
            <p className="conv-empty">{messages.noConversations}</p>
          )}
          {summaries.map((c) => (
            <div
              key={c.id}
              className={`conv-row${c.id === activeId ? ' active' : ''}`}
              role="listitem"
            >
              {editingId === c.id ? (
                <form
                  className="conv-rename-form"
                  onSubmit={(event) => void submitRename(event, c.id)}
                >
                  <input
                    className="conv-rename-input"
                    aria-label={messages.conversationTitle}
                    value={draftTitle}
                    disabled={saving}
                    autoFocus
                    onFocus={(event) => event.currentTarget.select()}
                    onChange={(event) =>
                      setDraftTitle(event.currentTarget.value)
                    }
                    onKeyDown={(event) => {
                      if (event.key !== 'Escape') return;
                      event.preventDefault();
                      event.stopPropagation();
                      cancelRename();
                    }}
                  />
                  <button
                    type="submit"
                    className="conv-action"
                    aria-label={messages.saveConversationTitle}
                    disabled={saving}
                  >
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      aria-hidden="true"
                    >
                      <path d="m5 12 4 4L19 6" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    className="conv-action"
                    aria-label={messages.cancelRename}
                    disabled={saving}
                    onClick={cancelRename}
                  >
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      aria-hidden="true"
                    >
                      <path d="M18 6 6 18" />
                      <path d="m6 6 12 12" />
                    </svg>
                  </button>
                </form>
              ) : (
                <>
                  <button
                    type="button"
                    className="conv-row-main"
                    aria-current={c.id === activeId ? 'true' : undefined}
                    onClick={() => onSelect(c.id)}
                  >
                    <span className="conv-title">{c.title}</span>
                    <time className="conv-time">
                      {formatRelative(c.updatedAt, messages)}
                    </time>
                  </button>
                  <div className="conv-actions">
                    <button
                      type="button"
                      className="conv-action"
                      aria-label={messages.renameConversation(c.title)}
                      onClick={() => beginRename(c)}
                    >
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        aria-hidden="true"
                      >
                        <path d="M12 20h9" />
                        <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L8 18l-4 1 1-4Z" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      className="conv-action conv-del"
                      aria-label={messages.deleteConversation(c.title)}
                      onClick={() => onDelete(c.id)}
                    >
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <path d="M3 6h18" />
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
                        <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                      </svg>
                    </button>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      </aside>
    </>
  );
}
