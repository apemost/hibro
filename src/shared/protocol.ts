// Message contract between the service worker and side panel. Parts keep text,
// reasoning, image assets, and tool calls separate while a response streams.

import type { HibroImageMediaType } from './imageAssets';

export type HibroToolState =
  | 'input-available'
  | 'output-available'
  | 'output-error';

export type HibroPart =
  | { type: 'text'; text: string }
  | { type: 'reasoning'; text: string }
  | {
      type: 'image-asset';
      provenance: 'provider-inline';
      mediaType: HibroImageMediaType;
      base64: string;
      byteLength: number;
      alt?: string;
    }
  | {
      type: 'tool-invocation';
      toolCallId: string;
      toolName: string;
      state: HibroToolState;
      input: Record<string, unknown>;
      output?: unknown;
      errorText?: string;
    };

export type ChatRole = 'user' | 'assistant';

export type PanelErrorAction = 'open-provider-settings';

/** A complete user or assistant turn stored by the panel. */
export interface PanelMessage {
  id: string;
  role: ChatRole;
  error?: boolean;
  errorAction?: PanelErrorAction;
  parts: HibroPart[];
}

export type HibroHistoryMessage = {
  role: ChatRole;
  parts: HibroPart[];
};

/** Requests sent from the side panel to the service worker. */
export type PanelRequest =
  | {
      type: 'send';
      text: string;
      tabId: number;
      history: HibroHistoryMessage[];
      // Omitted when the conversation has not used a page yet.
      previousPageUrl?: string;
    }
  | { type: 'stop' }
  | { type: 'ping' };

/** Events that let the panel build a response while it streams. */
export type PanelEvent =
  | { type: 'status'; text: string }
  | { type: 'run-start' }
  | { type: 'part-add'; part: HibroPart }
  | { type: 'part-delta'; partType: 'text' | 'reasoning'; delta: string }
  | {
      type: 'tool-update';
      toolCallId: string;
      state: HibroToolState;
      output?: unknown;
      errorText?: string;
    }
  | { type: 'run-end' }
  | { type: 'error'; text: string; action?: PanelErrorAction };
