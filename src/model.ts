// Provider resolution and model construction for the service worker. Provider
// credentials come from extension storage and are never bundled.

import { generateText, type ModelMessage } from 'ai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { ProviderConsentRequiredError } from './errors';
import {
  activeProfile,
  isComplete,
  isSecureProviderBaseUrl,
  readPrivacyConsent,
  readProviderConfig,
} from './shared/providers';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** Returns a usable provider profile or an error that tells the user what to fix. */
export async function getConfig() {
  const profile = activeProfile(await readProviderConfig());
  if (!isComplete(profile)) {
    throw new Error(
      'No LLM provider is set up. Open the extension options (right-click the extension icon, or use Settings in the side panel) and add or select a provider.',
    );
  }
  if (!isSecureProviderBaseUrl(profile.baseUrl)) {
    throw new Error(
      'Remote LLM provider URLs must use HTTPS. HTTP is allowed only for localhost and loopback addresses.',
    );
  }
  if (!(await readPrivacyConsent())) {
    throw new ProviderConsentRequiredError(
      'Review and accept the provider data-use notice in Settings before starting a chat.',
    );
  }
  return profile;
}

// Resolves the AI config and builds a model for the selected provider. The
// generic OpenAI-compatible provider speaks standard Chat Completions and works
// with secure remote or local development endpoints; the OpenAI provider targets OpenAI's own Chat
// Completions API (base URL optional); the Anthropic provider speaks the
// Messages API (/v1/messages). OpenAI and Anthropic default their endpoints, so
// base URL is optional for them (set it for a proxy or the local mock).
export async function getModel() {
  const profile = await getConfig();
  if (profile.provider === 'anthropic') {
    const anthropic = createAnthropic({
      apiKey: profile.apiKey,
      ...(profile.baseUrl
        ? { baseURL: profile.baseUrl.replace(/\/+$/, '') }
        : {}),
    });
    return anthropic.languageModel(profile.model);
  }
  if (profile.provider === 'openai') {
    const openai = createOpenAI({
      apiKey: profile.apiKey,
      ...(profile.baseUrl
        ? { baseURL: profile.baseUrl.replace(/\/+$/, '') }
        : {}),
    });
    return openai.chat(profile.model);
  }
  const provider = createOpenAICompatible({
    name: 'openai-compatible',
    baseURL: profile.baseUrl!.replace(/\/+$/, ''),
    apiKey: profile.apiKey,
  });
  return provider.chatModel(profile.model);
}

// One non-streaming model call, used by the selection-explain and page
// translation paths. (The panel run loop streams via streamText in
// handleSend.) Throws on an empty reply.
export async function callAI(
  messages: ChatMessage[],
  signal?: AbortSignal,
): Promise<string> {
  const model = await getModel();
  // AI SDK v7 rejects role:'system' entries inside `messages`; lift the system
  // prompt(s) into the `instructions` option. The provider serializes them
  // back as a leading system message in the request body, so the wire format
  // (and any OpenAI-compatible endpoint) is unchanged.
  const instructions =
    messages
      .filter((m) => m.role === 'system')
      .map((m) => m.content)
      .join('\n\n') || undefined;
  const turns = messages.filter((m) => m.role !== 'system') as ModelMessage[];
  const { text } = await generateText({
    model,
    messages: turns,
    instructions,
    temperature: 0.3,
    abortSignal: signal,
  });
  if (!text) throw new Error('The AI returned an empty response.');
  return text;
}
