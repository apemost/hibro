// Keeps deletion authoritative across independent instances of the real panel.
import type { BrowserContext, Page } from '@playwright/test';
import http from 'node:http';
import { test, expect } from './fixtures';
import { configureProvider } from '../eval/configure-provider.mjs';

const CONVERSATION_ID = 'retention-private-conversation';
const CONVERSATION_TITLE = 'Private conversation to delete';

/** Opens two panels on the same saved thread and restores the prior storage. */
async function withSharedConversation(
  context: BrowserContext,
  extensionId: string,
  check: (first: Page, second: Page, control: Page) => Promise<void>,
) {
  const control = await context.newPage();
  const first = await context.newPage();
  const second = await context.newPage();
  const keys = [
    'hibroConversations',
    'activeConversationId',
    'hibroOptions',
    'hibroProviders',
    'activeProviderId',
    'hibroPrivacyConsent',
  ];
  await control.goto(`chrome-extension://${extensionId}/src/options.html`);
  const previous = await control.evaluate(
    (names) => chrome.storage.local.get(names),
    keys,
  );
  try {
    await control.evaluate(
      async ({ id, title }) => {
        const now = Date.now();
        await chrome.storage.local.set({
          hibroOptions: { language: 'en' },
          hibroConversations: [
            {
              id,
              title,
              createdAt: now,
              updatedAt: now,
              messages: [
                {
                  id: 'private-message',
                  role: 'user',
                  parts: [{ type: 'text', text: title }],
                },
              ],
            },
          ],
          activeConversationId: id,
        });
      },
      { id: CONVERSATION_ID, title: CONVERSATION_TITLE },
    );
    for (const panel of [first, second]) {
      await panel.goto(`chrome-extension://${extensionId}/src/panel.html`);
      await expect(panel.locator('#log')).toContainText(CONVERSATION_TITLE);
    }
    await check(first, second, control);
  } finally {
    await first.close();
    await second.close();
    await control.evaluate(
      async ({ names, values }) => {
        await chrome.storage.local.remove(names);
        await chrome.storage.local.set(values);
      },
      { names: keys, values: previous },
    );
    await control.close();
  }
}

/** Deletes the seeded conversation through History. */
async function deleteConversation(panel: Page) {
  await panel.getByRole('button', { name: 'Conversation history' }).click();
  await panel
    .getByRole('button', { name: `Delete conversation: ${CONVERSATION_TITLE}` })
    .click();
  await expect(panel.locator('#log .msg')).toHaveCount(0);
}

/** Reads the real stored conversation ids through an extension page. */
async function savedIds(control: Page) {
  return control.evaluate(async () => {
    const stored = await chrome.storage.local.get('hibroConversations');
    return (stored.hibroConversations ?? []).map(
      (item: { id: string }) => item.id,
    );
  });
}

test('New chat in another panel cannot restore a deleted conversation', async ({
  browserContext,
  extensionId,
}) => {
  await withSharedConversation(
    browserContext,
    extensionId,
    async (first, second, control) => {
      await deleteConversation(first);
      await expect.poll(() => savedIds(control)).toEqual([]);
      await second
        .getByRole('button', { name: 'New chat', exact: true })
        .click();
      await expect(second.locator('#log .msg')).toHaveCount(0);
      await expect.poll(() => savedIds(control)).toEqual([]);
    },
  );
});

test('deletion wins over another panel save already waiting on storage', async ({
  browserContext,
  extensionId,
}) => {
  await withSharedConversation(
    browserContext,
    extensionId,
    async (first, second, control) => {
      // Delay the storage boundary so deletion overlaps a real pending save.
      await second.evaluate(() => {
        const original = chrome.storage.local.set.bind(chrome.storage.local);
        const state = window as typeof window & {
          releaseSave?: () => void;
          saveWaiting?: boolean;
        };
        chrome.storage.local.set = async (items) => {
          if ('hibroConversations' in items && !state.saveWaiting) {
            state.saveWaiting = true;
            await new Promise<void>((resolve) => {
              state.releaseSave = resolve;
            });
          }
          return original(items);
        };
      });
      await second
        .getByRole('button', { name: 'New chat', exact: true })
        .click();
      await expect
        .poll(() => second.evaluate(() => Boolean((window as any).saveWaiting)))
        .toBe(true);
      await first.getByRole('button', { name: 'Conversation history' }).click();
      await first
        .getByRole('button', {
          name: `Delete conversation: ${CONVERSATION_TITLE}`,
        })
        .click();
      // Either deletion completed (old code) or it waits for the held writer.
      await expect
        .poll(() =>
          control.evaluate(async () => {
            const stored = await chrome.storage.local.get('hibroConversations');
            const locks = await navigator.locks.query();
            return (
              stored.hibroConversations.length === 0 ||
              locks.pending?.some((lock) => lock.name === 'hibroConversations')
            );
          }),
        )
        .toBe(true);
      await second.evaluate(() => (window as any).releaseSave());
      await expect(first.locator('#log .msg')).toHaveCount(0);
      await expect(second.locator('#log .msg')).toHaveCount(0);
      await expect.poll(() => savedIds(control)).toEqual([]);
    },
  );
});

test('deletion cancels a stream in another panel and a fresh chat still saves', async ({
  browserContext,
  extensionId,
}) => {
  let heldResponse: http.ServerResponse | undefined;
  const server = http.createServer((request, response) => {
    if (request.method !== 'POST') {
      response.writeHead(200, { 'Content-Type': 'text/html' });
      response.end(
        '<!doctype html><title>Retention fixture</title><main><p>Local fixture</p></main>',
      );
      return;
    }
    request.resume();
    request.on('end', () => {
      response.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const text = heldResponse
        ? 'Fresh response'
        : 'Private streaming response';
      response.write(
        `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: text } }] })}\n\n`,
      );
      if (!heldResponse) {
        heldResponse = response;
        return;
      }
      response.write(
        `data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`,
      );
      response.end('data: [DONE]\n\n');
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('No fixture port');
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const fixture = await browserContext.newPage();
  try {
    await withSharedConversation(
      browserContext,
      extensionId,
      async (first, second, control) => {
        await configureProvider(browserContext, extensionId, {
          name: 'Retention fixture',
          provider: 'openai-compatible',
          baseUrl,
          apiKey: 'test-key',
          model: 'retention-test',
        });
        await fixture.goto(baseUrl);
        await fixture.bringToFront();
        await second.locator('#input').fill('Continue the private thread');
        await second.getByRole('button', { name: 'Send', exact: true }).click();
        await expect(second.locator('#log')).toContainText(
          'Private streaming response',
        );
        await expect(
          second.getByRole('button', { name: 'Stop', exact: true }),
        ).toBeVisible();
        await deleteConversation(first);
        await expect(second.locator('#log .msg')).toHaveCount(0);
        await expect(
          second.getByRole('button', { name: 'Stop', exact: true }),
        ).toHaveCount(0);
        await expect.poll(() => heldResponse?.destroyed).toBe(true);
        await expect.poll(() => savedIds(control)).toEqual([]);

        await fixture.bringToFront();
        await second
          .locator('#input')
          .fill('A fresh conversation after deletion');
        await second.getByRole('button', { name: 'Send', exact: true }).click();
        await expect(second.locator('#log')).toContainText('Fresh response');
        await expect.poll(async () => (await savedIds(control)).length).toBe(1);
        expect(await savedIds(control)).not.toContain(CONVERSATION_ID);
        await second.reload();
        await expect(second.locator('#log')).toContainText(
          'A fresh conversation after deletion',
        );
        await expect(second.locator('#log')).not.toContainText(
          CONVERSATION_TITLE,
        );
      },
    );
  } finally {
    await fixture.close();
    heldResponse?.destroy();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('deleting in one panel clears the other panel before it closes', async ({
  browserContext,
  extensionId,
}) => {
  await withSharedConversation(
    browserContext,
    extensionId,
    async (first, second, control) => {
      await deleteConversation(first);
      await expect(second.locator('#log .msg')).toHaveCount(0);
      await second.close();
      await expect.poll(() => savedIds(control)).toEqual([]);
    },
  );
});
