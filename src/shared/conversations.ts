// Stores recent conversations and the active conversation in extension storage.

import type { PanelMessage } from './protocol';

export const CONVERSATIONS_KEY = 'hibroConversations';
export const ACTIVE_CONVERSATION_KEY = 'activeConversationId';
export const MAX_CONVERSATIONS = 10;

export interface StoredConversation {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: PanelMessage[];
  // Missing for conversations that have not used a page yet.
  lastUrl?: string;
}

/** The fields needed to render one History row. */
export interface ConversationSummary {
  id: string;
  title: string;
  updatedAt: number;
}

function isStoredConversation(v: unknown): v is StoredConversation {
  if (!v || typeof v !== 'object') return false;
  const c = v as Record<string, unknown>;
  return (
    typeof c.id === 'string' &&
    typeof c.title === 'string' &&
    typeof c.createdAt === 'number' &&
    typeof c.updatedAt === 'number' &&
    Array.isArray(c.messages)
  );
}

/** Reads stored conversations and discards malformed entries. */
export async function readConversationState(): Promise<{
  items: StoredConversation[];
  activeId: string | null;
}> {
  const all = (await chrome.storage.local.get([
    CONVERSATIONS_KEY,
    ACTIVE_CONVERSATION_KEY,
  ])) as Record<string, unknown>;
  const raw = all[CONVERSATIONS_KEY];
  const items = Array.isArray(raw)
    ? (raw.filter(isStoredConversation) as StoredConversation[])
    : [];
  const activeId =
    typeof all[ACTIVE_CONVERSATION_KEY] === 'string'
      ? (all[ACTIVE_CONVERSATION_KEY] as string)
      : null;
  return { items, activeId };
}

/** Replaces the stored conversation list. */
export async function writeConversations(
  items: StoredConversation[],
): Promise<void> {
  await chrome.storage.local.set({ [CONVERSATIONS_KEY]: items });
}

/** Stores the active conversation id, or clears it for an empty state. */
export async function writeActiveConversation(
  id: string | null,
): Promise<void> {
  if (id === null) {
    await chrome.storage.local.remove(ACTIVE_CONVERSATION_KEY);
  } else {
    await chrome.storage.local.set({ [ACTIVE_CONVERSATION_KEY]: id });
  }
}

/** Derives a short title from the first non-empty user message. */
export function deriveTitle(messages: PanelMessage[]): string {
  for (const m of messages) {
    if (m.role !== 'user' || m.error) continue;
    const text = m.parts
      .filter((p) => p.type === 'text')
      .map((p) => (p as { text: string }).text)
      .join('')
      .trim();
    if (!text) continue;
    const firstLine =
      text
        .split('\n')
        .map((l) => l.trim())
        .find(Boolean) ?? text;
    return firstLine.length > 48 ? `${firstLine.slice(0, 48)}…` : firstLine;
  }
  return 'New chat';
}

/** Returns conversation summaries with the newest first. */
export function summarize(items: StoredConversation[]): ConversationSummary[] {
  return items
    .slice()
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map((c) => ({ id: c.id, title: c.title, updatedAt: c.updatedAt }));
}

/** Returns a copy with one valid conversation title replaced. */
export function renameConversationTitle(
  items: StoredConversation[],
  id: string,
  rawTitle: string,
): StoredConversation[] {
  const title = rawTitle.trim();
  if (!title) return items;
  const target = items.find((conversation) => conversation.id === id);
  if (!target || target.title === title) return items;
  return items.map((conversation) =>
    conversation.id === id ? { ...conversation, title } : conversation,
  );
}

export const MAX_INPUT_HISTORY = 50;

/** Builds composer recall history and collapses consecutive duplicates. */
export function deriveInputHistory(items: StoredConversation[]): string[] {
  const sorted = items.slice().sort((a, b) => a.updatedAt - b.updatedAt);
  const out: string[] = [];
  for (const c of sorted) {
    for (const m of c.messages) {
      if (m.role !== 'user' || m.error) continue;
      const text = m.parts
        .filter((p) => p.type === 'text')
        .map((p) => (p as { text: string }).text)
        .join('')
        .trim();
      if (text && out[out.length - 1] !== text) out.push(text);
    }
  }
  return out.slice(-MAX_INPUT_HISTORY);
}

/** Inserts or updates a conversation and keeps only the newest entries. */
export function upsertConversation(
  items: StoredConversation[],
  conv: StoredConversation,
): StoredConversation[] {
  const existing = items.find((c) => c.id === conv.id);
  const merged: StoredConversation = {
    ...conv,
    createdAt: existing ? existing.createdAt : conv.createdAt,
  };
  const without = items.filter((c) => c.id !== conv.id);
  return [merged, ...without]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_CONVERSATIONS);
}
