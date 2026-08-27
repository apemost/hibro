// Core e2e flows for Hibro, run against a local fixture page and a mock
// OpenAI-compatible endpoint (deterministic, no real AI calls).
import { readFileSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from './fixtures';
import { startMock, type MockServer } from './mock';
import { configureProvider as configureEvalProvider } from '../eval/configure-provider.mjs';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const ONE_PIXEL_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

// Serial: the options test persists the AI config that the chat/task tests
// rely on, and tab focus is managed explicitly.
test.describe.configure({ mode: 'serial' });

let mock: MockServer;
test.beforeAll(async () => {
  mock = await startMock();
});
test.afterAll(async () => {
  await mock.close();
});

// Persistence restores the active conversation when the panel opens, so the
// serial, storage-sharing suite would otherwise carry thread state across
// tests. Clear conversation state and interface language before each test.
test.beforeEach(async ({ browserContext, extensionId }) => {
  const p = await browserContext.newPage();
  await p.goto(`chrome-extension://${extensionId}/src/options.html`);
  await p.evaluate(async () => {
    await chrome.storage.local.remove([
      'hibroConversations',
      'activeConversationId',
      'hibroOptions'
    ]);
  });
  await p.close();
});

test('extension loads with required permissions', async ({ extensionId }) => {
  expect(extensionId).toBeTruthy();
  const manifest = JSON.parse(
    readFileSync(path.resolve(dirname, '..', 'dist', 'manifest.json'), 'utf8')
  );
  expect(manifest.permissions).toContain('debugger');
  expect(manifest.permissions).toContain('scripting');
  expect(manifest.permissions).not.toContain('tabs');
  expect(manifest.host_permissions).toContain('<all_urls>');
  expect(manifest.content_security_policy?.extension_pages).toContain(
    "img-src 'self' blob: data:"
  );
});

test('local storage is available to extension pages but not content scripts', async ({
  browserContext,
  extensionId
}) => {
  const control = await browserContext.newPage();
  const fixture = await browserContext.newPage();
  const probeKey = 'hibroStorageAccessProbe';
  const fixtureUrl = `http://127.0.0.1:${mock.port}/`;
  try {
    await control.goto(`chrome-extension://${extensionId}/src/options.html`);
    await fixture.goto(fixtureUrl);

    const trustedValue = await control.evaluate(async ({ key, value }) => {
      await chrome.storage.local.set({ [key]: value });
      return (await chrome.storage.local.get(key))[key];
    }, { key: probeKey, value: 'trusted-value' });
    expect(trustedValue).toBe('trusted-value');

    await expect
      .poll(
        async () =>
          control.evaluate(async ({ key, url }) => {
            const [tab] = await chrome.tabs.query({ url });
            if (!tab?.id) throw new Error('Storage access probe tab not found.');
            const [execution] = await chrome.scripting.executeScript({
              target: { tabId: tab.id },
              func: async (storageKey) => {
                try {
                  const storage = chrome.storage?.local;
                  if (!storage) return false;
                  await storage.get(storageKey);
                  return true;
                } catch {
                  return false;
                }
              },
              args: [key]
            });
            return execution.result;
          }, { key: probeKey, url: fixtureUrl }),
        { timeout: 5_000 }
      )
      .toBe(false);
  } finally {
    await control.evaluate(async (key) => chrome.storage.local.remove(key), probeKey);
    await fixture.close();
    await control.close();
  }
});

// Adds a provider profile via the options Add/Edit dialog. When `activate` is
// set, clicks the new row's "Use" button so it becomes the active provider.
async function addProvider(
  page: import('@playwright/test').Page,
  opts: {
    name: string;
    type?: string;
    baseUrl?: string;
    apiKey?: string;
    model: string;
    activate?: boolean;
  }
) {
  await page.click('#tab-config');
  const consent = page.locator('#providerPrivacyConsent');
  if (await consent.isVisible() && !(await consent.isChecked())) await consent.check();
  await page.click('#newProviderBtn');
  await page.fill('#providerName', opts.name);
  if (opts.type) await page.selectOption('#providerType', opts.type);
  if (opts.baseUrl !== undefined) await page.fill('#providerBaseUrl', opts.baseUrl);
  await page.fill('#providerApiKey', opts.apiKey ?? 'test-key');
  await page.fill('#providerModel', opts.model);
  await page.click('#providerForm button[type="submit"]');
  const row = page.locator('#providerList .provider-row', { hasText: opts.name });
  await expect(row).toBeVisible();
  if (opts.activate) {
    await row.locator('button[data-activate]').click();
  }
}

function expectEncryptedProviderEnvelope(value: unknown, hiddenValues: string[]): void {
  expect(Array.isArray(value)).toBe(false);
  expect(value).toMatchObject({
    kind: 'hibro-provider-profiles',
    version: 1,
    cipher: 'AES-GCM'
  });
  const envelope = value as { iv?: unknown; ciphertext?: unknown };
  expect(typeof envelope.iv).toBe('string');
  expect(typeof envelope.ciphertext).toBe('string');
  expect(envelope.iv).not.toBe('');
  expect(envelope.ciphertext).not.toBe('');
  const serialized = JSON.stringify(value);
  for (const hiddenValue of hiddenValues) {
    expect(serialized).not.toContain(hiddenValue);
  }
}

async function readProviderKeyMetadata(
  page: import('@playwright/test').Page
): Promise<{
  type: KeyType;
  extractable: boolean;
  algorithm: string;
  length: number;
  usages: KeyUsage[];
  exportError: string;
} | null> {
  return page.evaluate(async () => {
    const databases = await indexedDB.databases();
    if (!databases.some((database) => database.name === 'hibroVault')) return null;
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('hibroVault');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    try {
      const key = await new Promise<CryptoKey>((resolve, reject) => {
        const request = database
          .transaction('keys', 'readonly')
          .objectStore('keys')
          .get('provider-profiles:v1');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result as CryptoKey);
      });
      let exportError = '';
      try {
        await crypto.subtle.exportKey('raw', key);
      } catch (error) {
        exportError = error instanceof DOMException ? error.name : String(error);
      }
      return {
        type: key.type,
        extractable: key.extractable,
        algorithm: key.algorithm.name,
        length: (key.algorithm as AesKeyAlgorithm).length,
        usages: [...key.usages],
        exportError
      };
    } finally {
      database.close();
    }
  });
}

async function seedLongAssistantConversation(
  browserContext: import('@playwright/test').BrowserContext,
  extensionId: string,
  id: string
) {
  const storagePage = await browserContext.newPage();
  await storagePage.goto(`chrome-extension://${extensionId}/src/options.html`);
  await storagePage.evaluate(async (conversationId) => {
    const now = Date.now();
    await chrome.storage.local.set({
      hibroConversations: [
        {
          id: conversationId,
          title: 'Long assistant response',
          createdAt: now,
          updatedAt: now,
          messages: [
            {
              id: `${conversationId}-response`,
              role: 'assistant',
              parts: [
                {
                  type: 'text',
                  text: Array.from(
                    { length: 180 },
                    (_, index) =>
                      `Paragraph ${index + 1}: a deliberately long assistant response.`
                  ).join('\n\n')
                }
              ]
            }
          ]
        }
      ],
      activeConversationId: conversationId
    });
  }, id);
  await storagePage.close();
}

async function seedToolErrorConversation(
  browserContext: import('@playwright/test').BrowserContext,
  extensionId: string,
  id: string
) {
  const storagePage = await browserContext.newPage();
  await storagePage.goto(`chrome-extension://${extensionId}/src/options.html`);
  await storagePage.evaluate(async (conversationId) => {
    const now = Date.now();
    await chrome.storage.local.set({
      hibroConversations: [
        {
          id: conversationId,
          title: 'Tool connection error',
          createdAt: now,
          updatedAt: now,
          messages: [
            {
              id: `${conversationId}-response`,
              role: 'assistant',
              parts: [
                {
                  type: 'tool-invocation',
                  toolCallId: `${conversationId}-tool`,
                  toolName: 'get_page_overview',
                  state: 'output-error',
                  input: {},
                  errorText: 'Could not establish connection. Receiving end does not exist.'
                }
              ]
            }
          ]
        }
      ],
      activeConversationId: conversationId
    });
  }, id);
  await storagePage.close();
}

test('legacy single-provider config migrates and remains usable', async ({
  browserContext,
  extensionId
}) => {
  const page = await browserContext.newPage();
  let fixture: import('@playwright/test').Page | undefined;
  let panel: import('@playwright/test').Page | undefined;
  try {
    await page.goto(`chrome-extension://${extensionId}/src/options.html`);
    await page.evaluate(async (baseUrl) => {
      await chrome.storage.local.remove(['hibroProviders', 'activeProviderId']);
      await chrome.storage.local.set({
        hibroConfig: {
          baseUrl,
          apiKey: 'legacy-key',
          model: 'legacy-model'
        }
      });
    }, `http://127.0.0.1:${mock.port}`);
    await page.reload();

    const migratedRow = page.locator('#providerList .provider-row');
    await expect(migratedRow).toHaveCount(1);
    await expect(migratedRow).toContainText('Default');
    await expect(migratedRow).toContainText('legacy-model');
    await page.locator('#providerPrivacyConsent').check();

    ({ fixture, panel } = await openPanelOnFixture(browserContext, extensionId));
    await panel.fill('#input', 'Can the migrated provider answer?');
    await panel.click('#sendBtn');
    await expect(panel.locator('#log .msg.assistant').last()).toContainText(
      'streaming mock answer',
      { timeout: 30_000 }
    );
    await expect(panel.locator('#log .msg.error')).toHaveCount(0);

    const stored = await page.evaluate(async () => await chrome.storage.local.get());
    expectEncryptedProviderEnvelope(stored.hibroProviders, [
      'migrated',
      'Default',
      'openai-compatible',
      `http://127.0.0.1:${mock.port}`,
      'legacy-key',
      'legacy-model'
    ]);
    expect(stored.activeProviderId).toBe('migrated');
    expect(stored.hibroConfig).toBeUndefined();
    expect(JSON.stringify(stored)).not.toContain('legacy-key');
    expect(JSON.stringify(stored)).not.toContain('legacy-model');
  } finally {
    await page.evaluate(async () => {
      await chrome.storage.local.remove(['hibroProviders', 'activeProviderId', 'hibroConfig']);
    });
    await panel?.close();
    await fixture?.close();
    await page.close();
  }
});

test('plaintext provider profiles migrate to encrypted storage and remain usable', async ({
  browserContext,
  extensionId
}) => {
  const page = await browserContext.newPage();
  let fixture: import('@playwright/test').Page | undefined;
  let panel: import('@playwright/test').Page | undefined;
  const baseUrl = `http://127.0.0.1:${mock.port}`;
  try {
    await page.goto(`chrome-extension://${extensionId}/src/options.html`);
    await page.evaluate(async (url) => {
      await chrome.storage.local.set({
        hibroProviders: [
          {
            id: 'plaintext-provider',
            name: 'Plaintext upgrade',
            provider: 'openai-compatible',
            baseUrl: url,
            apiKey: 'plaintext-key',
            model: 'plaintext-model'
          }
        ],
        activeProviderId: 'plaintext-provider'
      });
    }, baseUrl);
    await page.reload();

    const row = page.locator('#providerList .provider-row');
    await expect(row).toHaveCount(1);
    await expect(row).toContainText('Plaintext upgrade');
    await expect(row).toContainText('plaintext-model');
    await row.locator('button[data-edit]').click();
    await expect(page.locator('#providerBaseUrl')).toHaveValue(baseUrl);
    await expect(page.locator('#providerApiKey')).toHaveValue('');
    await expect(page.locator('#providerModel')).toHaveValue('plaintext-model');
    await page.locator('#providerCancel').click();

    await expect
      .poll(async () => (await page.evaluate(async () => chrome.storage.local.get())).hibroProviders)
      .not.toEqual(expect.any(Array));
    const stored = await page.evaluate(async () => await chrome.storage.local.get());
    expectEncryptedProviderEnvelope(stored.hibroProviders, [
      'plaintext-provider',
      'Plaintext upgrade',
      'openai-compatible',
      baseUrl,
      'plaintext-key',
      'plaintext-model'
    ]);
    expect(JSON.stringify(stored)).not.toContain('plaintext-key');
    expect(JSON.stringify(stored)).not.toContain('plaintext-model');
    await page.locator('#providerPrivacyConsent').check();

    ({ fixture, panel } = await openPanelOnFixture(browserContext, extensionId));
    await panel.fill('#input', 'Can the upgraded provider answer?');
    await panel.click('#sendBtn');
    await expect(panel.locator('#log .msg.assistant').last()).toContainText(
      'streaming mock answer',
      { timeout: 30_000 }
    );
  } finally {
    await page.evaluate(async () => {
      await chrome.storage.local.remove(['hibroProviders', 'activeProviderId', 'hibroConfig']);
    });
    await panel?.close();
    await fixture?.close();
    await page.close();
  }
});

test('provider setup requires privacy acknowledgement', async ({
  browserContext,
  extensionId
}) => {
  const page = await browserContext.newPage();
  try {
    await page.goto(`chrome-extension://${extensionId}/src/options.html`);
    await page.evaluate(async () => chrome.storage.local.remove('hibroPrivacyConsent'));
    await page.reload();
    await page.click('#tab-config');

    const consent = page.getByRole('checkbox', {
      name: 'I understand and agree to this data use.'
    });
    await expect(consent).not.toBeChecked();
    await expect(page.locator('#newProviderBtn')).toBeDisabled();

    await consent.check();
    await expect(page.locator('#newProviderBtn')).toBeEnabled();
    expect(
      await page.evaluate(async () =>
        (await chrome.storage.local.get('hibroPrivacyConsent')).hibroPrivacyConsent
      )
    ).toBe(true);
  } finally {
    await page.close();
  }
});

test('options encrypt provider profiles and sync open extension surfaces', async ({
  browserContext,
  extensionId
}) => {
  const writer = await browserContext.newPage();
  const observer = await browserContext.newPage();
  const baseUrl = `http://127.0.0.1:${mock.port}`;
  const { fixture, panel } = await openPanelOnFixture(browserContext, extensionId);
  try {
    await writer.goto(`chrome-extension://${extensionId}/src/options.html`);
    await observer.goto(`chrome-extension://${extensionId}/src/options.html`);
    await addProvider(writer, {
      name: 'Mock',
      type: 'openai-compatible',
      baseUrl,
      apiKey: 'test-key',
      model: 'test-model'
    });

    const observerRow = observer.locator('#providerList .provider-row', { hasText: 'Mock' });
    await expect(observerRow).toContainText('test-model');
    await expect(panel.locator('#providerSelect')).toHaveAttribute('title', 'Mock / test-model');

    const rowId = await writer
      .locator('#providerList .provider-row', { hasText: 'Mock' })
      .getAttribute('data-id');
    expect(rowId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
    const stored = await writer.evaluate(async () => await chrome.storage.local.get());
    expectEncryptedProviderEnvelope(stored.hibroProviders, [
      rowId!,
      'Mock',
      'openai-compatible',
      baseUrl,
      'test-key',
      'test-model'
    ]);
    expect(stored.activeProviderId).toBe(rowId);
    expect(JSON.stringify(stored)).not.toContain('test-key');

    const key = await readProviderKeyMetadata(writer);
    expect(key).toEqual({
      type: 'secret',
      extractable: false,
      algorithm: 'AES-GCM',
      length: 256,
      usages: ['encrypt', 'decrypt'],
      exportError: 'InvalidAccessError'
    });

    await writer.reload();
    const reloadedRow = writer.locator('#providerList .provider-row', { hasText: 'Mock' });
    await reloadedRow.locator('button[data-edit]').click();
    await expect(writer.locator('#providerBaseUrl')).toHaveValue(baseUrl);
    await expect(writer.locator('#providerApiKey')).toHaveValue('');
    await expect(writer.locator('#providerModel')).toHaveValue('test-model');
    await writer.locator('#providerCancel').click();

    await panel.fill('#input', 'Can the encrypted provider answer?');
    await panel.click('#sendBtn');
    await expect(panel.locator('#log .msg.assistant').last()).toContainText(
      'streaming mock answer',
      { timeout: 30_000 }
    );
  } finally {
    await panel.close();
    await fixture.close();
    await observer.close();
    await writer.close();
  }
});

test('privacy-consent errors link directly to provider settings', async ({
  browserContext,
  extensionId
}) => {
  const options = await browserContext.newPage();
  await options.goto(`chrome-extension://${extensionId}/src/options.html`);
  await addProvider(options, {
    name: 'Consent shortcut',
    type: 'openai-compatible',
    baseUrl: `http://127.0.0.1:${mock.port}`,
    model: 'test-model'
  });
  await options.getByRole('tab', { name: 'General' }).click();
  await options.getByRole('combobox', { name: 'Language' }).selectOption('zh-CN');
  await options.evaluate(async () => chrome.storage.local.remove('hibroPrivacyConsent'));
  await options.close();

  const { fixture, panel } = await openPanelOnFixture(browserContext, extensionId);
  try {
    await panel.fill('#input', 'Can you read this page?');
    await panel.click('#sendBtn');
    const error = panel.locator('#log .msg.error').last();
    await expect(error).toContainText(
      'Review and accept the provider data-use notice in Settings before starting a chat.',
      { timeout: 30_000 }
    );

    const openSettings = error.getByRole('link', { name: '打开服务商设置' });
    const openedPage = browserContext.waitForEvent('page');
    await openSettings.click();
    const settings = await openedPage;
    await settings.waitForLoadState('domcontentloaded');
    await expect(settings.getByRole('tab', { name: 'LLM 服务商' })).toHaveAttribute(
      'aria-selected',
      'true'
    );
    await settings.evaluate(async () => chrome.storage.local.set({ hibroPrivacyConsent: true }));
    await settings.close();
  } finally {
    await panel.close();
    await fixture.close();
  }
});

test('provider setup rejects insecure remote endpoints', async ({
  browserContext,
  extensionId
}) => {
  const page = await browserContext.newPage();
  try {
    await page.goto(`chrome-extension://${extensionId}/src/options.html`);
    await page.click('#tab-config');
    const consent = page.locator('#providerPrivacyConsent');
    if (!(await consent.isChecked())) await consent.check();
    await page.click('#newProviderBtn');
    await page.fill('#providerName', 'Insecure remote');
    await page.selectOption('#providerType', 'openai-compatible');
    await page.fill('#providerBaseUrl', 'http://api.example.com/v1');
    await page.fill('#providerApiKey', 'not-a-real-key');
    await page.fill('#providerModel', 'test-model');
    await page.click('#providerForm button[type="submit"]');

    await expect(page.locator('#providerDialog')).toBeVisible();
    await expect(page.locator('#providerBaseUrl')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.locator('#providerBaseUrlError')).toContainText(
      'Use HTTPS for remote providers'
    );
    await expect(page.locator('#providerList .provider-row', { hasText: 'Insecure remote' })).toHaveCount(0);
  } finally {
    await page.close();
  }
});

test('blank API key edit preserves the stored provider credential', async ({
  browserContext,
  extensionId
}) => {
  const options = await browserContext.newPage();
  let fixture: import('@playwright/test').Page | undefined;
  let panel: import('@playwright/test').Page | undefined;
  try {
    await options.goto(`chrome-extension://${extensionId}/src/options.html`);
    await addProvider(options, {
      name: 'Preserved key',
      baseUrl: `http://127.0.0.1:${mock.port}`,
      apiKey: 'preserved-test-key',
      model: 'preserved-model'
    });
    const row = options.locator('#providerList .provider-row', { hasText: 'Preserved key' });
    const activate = row.locator('button[data-activate]');
    if (await activate.count()) await activate.click();

    await row.locator('button[data-edit]').click();
    await options.locator('#providerApiKey').fill('');
    await options.locator('#providerModel').fill('preserved-model-edited');
    await options.locator('#providerForm button[type="submit"]').click();

    const authorizationCount = mock.authorizationHeaders.length;
    ({ fixture, panel } = await openPanelOnFixture(browserContext, extensionId));
    await panel.fill('#input', 'Use the preserved credential');
    await panel.click('#sendBtn');
    await expect
      .poll(() => mock.authorizationHeaders.length, { timeout: 5_000 })
      .toBeGreaterThan(authorizationCount);
    expect(mock.authorizationHeaders.at(-1)).toBe('Bearer preserved-test-key');
  } finally {
    await panel?.close();
    await fixture?.close();
    await options.close();
  }
});

test('eval provider setup never writes a plaintext provider record', async ({
  browserContext,
  extensionId
}) => {
  const observer = await browserContext.newPage();
  await observer.goto(`chrome-extension://${extensionId}/src/options.html`);
  const original = await observer.evaluate(async () =>
    chrome.storage.local.get(['hibroProviders', 'activeProviderId'])
  );
  await observer.evaluate(() => {
    const values: unknown[] = [];
    (window as unknown as { hibroProviderWrites: unknown[] }).hibroProviderWrites = values;
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName === 'local' && changes.hibroProviders) {
        values.push(changes.hibroProviders.newValue);
      }
    });
  });

  const hiddenValues = [
    'eval-review-provider',
    'eval-review-key',
    'eval-review-model',
    `http://127.0.0.1:${mock.port}`
  ];
  try {
    await configureEvalProvider(browserContext, extensionId, {
      provider: 'openai-compatible',
      baseUrl: `http://127.0.0.1:${mock.port}`,
      apiKey: 'eval-review-key',
      model: 'eval-review-model',
      name: 'eval-review-provider'
    });

    const writes = await observer.evaluate(
      () => (window as unknown as { hibroProviderWrites: unknown[] }).hibroProviderWrites
    );
    expect(writes.length).toBeGreaterThan(0);
    for (const value of writes) {
      expectEncryptedProviderEnvelope(value, hiddenValues);
    }
  } finally {
    await observer.evaluate(async (value) => {
      await chrome.storage.local.set(value);
    }, original);
    await observer.close();
  }
});

test('unreadable provider storage is reported without being overwritten', async ({
  browserContext,
  extensionId
}) => {
  const page = await browserContext.newPage();
  await page.goto(`chrome-extension://${extensionId}/src/options.html`);
  const original = await page.evaluate(async () =>
    chrome.storage.local.get(['hibroProviders', 'activeProviderId'])
  );
  const unreadable = {
    kind: 'hibro-provider-profiles',
    version: 1,
    cipher: 'AES-GCM',
    iv: 'AAAAAAAAAAAAAAAA',
    ciphertext: 'not-valid-ciphertext'
  };
  try {
    await page.evaluate(async (value) => {
      await chrome.storage.local.set({ hibroProviders: value });
    }, unreadable);
    await page.reload();
    await expect(page.getByRole('alert')).toContainText(
      "Hibro couldn’t unlock the saved LLM providers. The saved data was left unchanged."
    );
    await expect(page.locator('#newProviderBtn')).toBeDisabled();
    expect(
      await page.evaluate(async () =>
        (await chrome.storage.local.get('hibroProviders')).hibroProviders
      )
    ).toEqual(unreadable);
  } finally {
    await page.evaluate(async (value) => {
      await chrome.storage.local.set(value);
    }, original);
    await page.close();
  }
});

test('options page switches to Chinese and remembers the language', async ({
  browserContext,
  extensionId
}) => {
  const page = await browserContext.newPage();
  await page.goto(`chrome-extension://${extensionId}/src/options.html`);

  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.getByRole('heading', { name: 'Hibro Settings' })).toBeVisible();
  const generalTab = page.getByRole('tab', { name: 'General' });
  const generalPanel = page.locator('#panel-general');
  await expect(page.getByRole('tab', { name: 'LLM providers' })).toHaveAttribute(
    'aria-selected',
    'true'
  );
  await expect(page.getByRole('note', { name: 'Before you connect' })).toContainText(
    'messages, page address, content it reads'
  );
  await expect(page.getByRole('note', { name: 'Before you connect' })).toContainText(
    'Hibro developer does not receive this data'
  );
  await expect(
    page.getByRole('checkbox', { name: 'I understand and agree to this data use.' })
  ).toBeVisible();
  await expect(generalTab).toHaveAttribute('aria-selected', 'false');
  await expect(generalPanel).toBeHidden();
  await expect(page.locator('.settings-header').getByRole('combobox')).toHaveCount(0);
  await generalTab.click();
  await expect(generalPanel).toBeVisible();
  const language = generalPanel.getByRole('combobox', { name: 'Language' });
  await expect(generalPanel.locator('label[for="optionsLanguage"]')).toHaveText(
    'Language'
  );
  await expect(
    generalPanel.getByText('Choose the language used in Settings and the side panel.')
  ).toBeVisible();
  await expect(generalPanel.locator('svg')).toHaveCount(0);
  await expect(generalPanel.locator('[data-tip]')).toHaveCount(0);
  await expect(language).toHaveCSS('opacity', '1');
  await language.selectOption('zh-CN');

  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
  await expect(page.getByRole('heading', { name: 'Hibro 设置' })).toBeVisible();
  await expect(page.getByRole('tab', { name: '常规' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'LLM 服务商' })).toBeVisible();
  await expect(page.getByRole('tab', { name: '智能体技能' })).toBeVisible();
  await page.getByRole('tab', { name: 'LLM 服务商' }).click();
  await expect(page.getByRole('note', { name: '连接前请了解' })).toContainText(
    '消息、页面地址、读取到的页面内容'
  );
  await expect(page.getByRole('note', { name: '连接前请了解' })).toContainText(
    'Hibro 开发者不会收到这些数据'
  );
  await expect(page.getByRole('checkbox', { name: '我已了解并同意上述数据用途。' })).toBeVisible();
  await expect(page.getByRole('button', { name: '+ 添加服务商' })).toBeVisible();

  await page.getByRole('tab', { name: '智能体技能' }).click();
  await expect(page.getByRole('button', { name: '+ 新建技能' })).toBeVisible();

  await page.getByRole('tab', { name: '常规' }).click();
  await expect(page.locator('#panel-general')).toBeVisible();

  const stored = await page.evaluate(async () => chrome.storage.local.get('hibroOptions'));
  expect(stored.hibroOptions).toEqual({ language: 'zh-CN' });
  await page.close();

  const reopened = await browserContext.newPage();
  await reopened.goto(`chrome-extension://${extensionId}/src/options.html`);
  await expect(reopened.locator('html')).toHaveAttribute('lang', 'zh-CN');
  await expect(reopened.getByRole('heading', { name: 'Hibro 设置' })).toBeVisible();
  await expect(reopened.getByRole('tab', { name: 'LLM 服务商' })).toHaveAttribute(
    'aria-selected',
    'true'
  );
  await reopened.getByRole('tab', { name: '常规' }).click();
  await expect(
    reopened.locator('#panel-general').getByRole('combobox', { name: '语言' })
  ).toHaveValue('zh-CN');
  await reopened.evaluate(async () => {
    await chrome.storage.local.set({ hibroOptions: { language: 'unsupported' } });
  });
  await expect(reopened.locator('html')).toHaveAttribute('lang', 'en');
  await expect(reopened.getByRole('heading', { name: 'Hibro Settings' })).toBeVisible();
  await reopened.close();
});

test('a stale startup language read cannot overwrite a newer storage change', async ({
  browserContext,
  extensionId
}) => {
  const control = await browserContext.newPage();
  await control.goto(`chrome-extension://${extensionId}/src/options.html`);
  await control.evaluate(async () => {
    await chrome.storage.local.set({ hibroOptions: { language: 'en' } });
  });

  const page = await browserContext.newPage();
  await page.addInitScript(() => {
    const originalGet = chrome.storage.local.get.bind(chrome.storage.local);
    const state = window as unknown as {
      hibroLanguageReadStarted: boolean;
      releaseHibroLanguageRead?: () => void;
    };
    state.hibroLanguageReadStarted = false;
    chrome.storage.local.get = (async (...args: Parameters<typeof originalGet>) => {
      const result = await originalGet(...args);
      if (
        args[0] === 'hibroOptions' ||
        (Array.isArray(args[0]) && args[0].includes('hibroOptions'))
      ) {
        state.hibroLanguageReadStarted = true;
        await new Promise<void>((resolve) => {
          state.releaseHibroLanguageRead = resolve;
        });
      }
      return result;
    }) as typeof chrome.storage.local.get;
  });

  try {
    await page.goto(`chrome-extension://${extensionId}/src/options.html`);
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as unknown as { hibroLanguageReadStarted: boolean })
              .hibroLanguageReadStarted
        )
      )
      .toBe(true);

    await control.evaluate(async () => {
      await chrome.storage.local.set({ hibroOptions: { language: 'zh-CN' } });
    });
    await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
    await page.evaluate(() => {
      (window as unknown as { releaseHibroLanguageRead?: () => void }).releaseHibroLanguageRead?.();
    });
    await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
  } finally {
    await page.close();
    await control.close();
  }
});

test('Settings page does not scroll horizontally in either language', async ({
  browserContext,
  extensionId
}) => {
  const page = await browserContext.newPage();
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto(`chrome-extension://${extensionId}/src/options.html`);
  expect(await horizontalOverflow(page)).toEqual({ page: 0, scrollers: [] });
  await page.getByRole('tab', { name: 'General' }).click();
  const language = page.getByRole('combobox', { name: 'Language' });
  await expect(language).toBeVisible();
  await language.selectOption('zh-CN');
  expect(await horizontalOverflow(page)).toEqual({ page: 0, scrollers: [] });
  await page.close();
});

test('Settings language setting updates an open side panel and persists', async ({
  browserContext,
  extensionId
}) => {
  const options = await browserContext.newPage();
  const panel = await browserContext.newPage();
  await Promise.all([
    options.goto(`chrome-extension://${extensionId}/src/options.html`),
    panel.goto(`chrome-extension://${extensionId}/src/panel.html`)
  ]);

  await expect(panel.locator('html')).toHaveAttribute('lang', 'en');
  await expect(panel.getByRole('heading', { name: 'Ask about this page' })).toBeVisible();
  await options.getByRole('tab', { name: 'General' }).click();
  const language = options.getByRole('combobox', { name: 'Language' });
  await expect(language).toBeVisible();
  await language.selectOption('zh-CN');

  await expect(panel.locator('html')).toHaveAttribute('lang', 'zh-CN');
  await expect(panel.getByRole('heading', { name: '询问此页面' })).toBeVisible();
  await expect(panel.getByRole('textbox')).toHaveAttribute(
    'placeholder',
    '输入问题，或描述要执行的页面操作…'
  );
  await expect(panel.getByRole('button', { name: '设置' })).toBeVisible();
  await expect(panel.getByRole('button', { name: '新对话' })).toBeVisible();
  await panel.getByRole('button', { name: '对话历史' }).click();
  await expect(panel.getByRole('heading', { name: '历史记录' })).toBeVisible();

  await panel.reload();
  await expect(panel.locator('html')).toHaveAttribute('lang', 'zh-CN');
  await expect(panel.getByRole('heading', { name: '询问此页面' })).toBeVisible();
  await panel.close();
  await options.close();
});

test('options page manages user skills', async ({ browserContext, extensionId }) => {
  const page = await browserContext.newPage();
  await page.goto(`chrome-extension://${extensionId}/src/options.html`);
  // Site skills content is on a hidden tab; the tab rule must hide it.
  await expect(page.locator('#newSkillBtn')).toBeHidden();
  await page.click('#tab-skills');
  await expect(page.locator('#newSkillBtn')).toBeVisible();
  // The skill form is behind a "New skill" button (dialog closed by default).
  await expect(page.locator('#skillName')).toBeHidden();
  await page.click('#newSkillBtn');
  await expect(page.locator('#skillName')).toBeVisible();
  // Create a skill via the form.
  await page.fill('#skillName', 'demo-ui');
  await page.fill('#skillMatch', '*://127.0.0.1*/*');
  await page.fill('#skillInstructions', 'UI_TOKEN_99 do the thing');
  await page.click('#skillForm button[type="submit"]');
  // The dialog closes on save.
  await expect(page.locator('#skillName')).toBeHidden();
  await expect(page.locator('#userSkillsList .skill-row')).toHaveCount(1);

  let stored = await page.evaluate(
    async () => (await chrome.storage.local.get('hibroUserSkills')).hibroUserSkills
  );
  expect(stored).toHaveLength(1);
  expect(stored[0].name).toBe('demo-ui');
  expect(stored[0].instructions).toContain('UI_TOKEN_99');
  expect(stored[0].enabled).toBe(true);

  // Toggle it off via the row checkbox.
  await page.uncheck('#userSkillsList .skill-row input[data-toggle]');
  stored = await page.evaluate(
    async () => (await chrome.storage.local.get('hibroUserSkills')).hibroUserSkills
  );
  expect(stored[0].enabled).toBe(false);

  // Delete it.
  await page.click('#userSkillsList .skill-row button[data-delete]');
  await expect(page.locator('#userSkillsList .skill-row')).toHaveCount(0);
  stored = await page.evaluate(
    async () => (await chrome.storage.local.get('hibroUserSkills')).hibroUserSkills
  );
  expect(stored ?? []).toHaveLength(0);
  await page.close();
});

test('built-in skills are listed on the options page', async ({ browserContext, extensionId }) => {
  const page = await browserContext.newPage();
  await page.goto(`chrome-extension://${extensionId}/src/options.html`);
  await page.click('#tab-skills');
  const builtin = page.locator('#builtinSkills');
  // The arXiv built-in is bundled (build-time glob + frontmatter parse) and
  // rendered with its name, description, and match patterns.
  await expect(builtin).toContainText('arxiv');
  await expect(builtin).toContainText('arxiv.org');
  // The added site skills also bundle (build-time glob + frontmatter parse)
  // and render with their name and match patterns.
  await expect(builtin).toContainText('Wikipedia');
  await expect(builtin).toContainText('wikipedia.org');
  await expect(builtin).toContainText('Hacker News');
  await expect(builtin).toContainText('news.ycombinator.com');
  await expect(builtin).toContainText('V2EX');
  await expect(builtin).toContainText('v2ex.com');
  // Every built-in skill row carries a "Built-in" badge that user skills do not.
  const rows = builtin.locator('.skill-row');
  const rowCount = await rows.count();
  expect(rowCount).toBeGreaterThanOrEqual(4);
  expect(await builtin.locator('.badge.builtin').count()).toBe(rowCount);
  await page.close();
});

// Opens the fixture page and the side panel as tabs, leaving the fixture tab
// active so the panel's getActiveTab() picks it up.
async function openPanelOnFixture(
  browserContext: import('@playwright/test').BrowserContext,
  extensionId: string
) {
  const fixture = await browserContext.newPage();
  await fixture.goto(`http://127.0.0.1:${mock.port}/`);
  const panel = await browserContext.newPage();
  await panel.goto(`chrome-extension://${extensionId}/src/panel.html`);
  await fixture.bringToFront();
  return { fixture, panel };
}

async function horizontalOverflow(page: import('@playwright/test').Page) {
  return await page.evaluate(() => {
    const root = document.documentElement;
    const scrollers = [document.body, ...document.querySelectorAll<HTMLElement>('*')]
      .filter((element) => {
        if (element.scrollWidth <= element.clientWidth + 1) return false;
        const overflowX = getComputedStyle(element).overflowX;
        return overflowX === 'auto' || overflowX === 'scroll';
      })
      .map((element) =>
        element.id
          ? `#${element.id}`
          : `${element.tagName.toLowerCase()}.${[...element.classList].join('.')}`
      );
    return {
      page: root.scrollWidth - root.clientWidth,
      scrollers
    };
  });
}

test('content script extracts page text', async ({ browserContext, extensionId }) => {
  const { fixture, panel } = await openPanelOnFixture(browserContext, extensionId);
  const text = await panel.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const page = await chrome.tabs.sendMessage(tab.id!, { type: 'hibro:extract' });
    return page.text as string;
  });
  expect(text).toContain('HIBRO E2E FIXTURE');
  await panel.close();
  await fixture.close();
});

test('interactive-element filtering happens before the 60-result cap', async ({
  browserContext,
  extensionId
}) => {
  const { fixture, panel } = await openPanelOnFixture(browserContext, extensionId);
  await fixture.evaluate(() => {
    const host = document.createElement('section');
    for (let index = 0; index < 61; index += 1) {
      const button = document.createElement('button');
      button.textContent = `Filler ${index + 1}`;
      host.append(button);
    }
    const target = document.createElement('button');
    target.id = 'filtered-target';
    target.textContent = 'Unique target';
    host.append(target);
    document.body.append(host);
  });

  const elements = await panel.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const response = await chrome.tabs.sendMessage(tab.id!, {
      type: 'hibro:elements',
      filter: 'unique target'
    });
    return response.elements as Array<{ id: number; tag: string; text: string }>;
  });

  expect(elements).toEqual([{ id: 1, tag: 'button', text: 'Unique target' }]);
  expect(await fixture.locator('#filtered-target').getAttribute('data-hibro-id')).toBe('1');
  await expect(fixture.locator('[data-hibro-id]')).toHaveCount(1);
  await panel.close();
  await fixture.close();
});

test('normal page without a content script recovers without a page refresh', async ({
  browserContext,
  extensionId
}) => {
  const unconnectedPage = await browserContext.newPage();
  const targetUrl = `http://127.0.0.1:${mock.port}/uninjected`;
  await unconnectedPage.goto(targetUrl, { waitUntil: 'commit' });
  await expect(
    unconnectedPage.getByRole('heading', { name: 'HIBRO E2E UNINJECTED PAGE' })
  ).toBeVisible();
  const pageMarker = await unconnectedPage.evaluate(() => {
    const marker = crypto.randomUUID();
    document.body.dataset.hibroPageMarker = marker;
    return marker;
  });

  const control = await browserContext.newPage();
  await control.goto(`chrome-extension://${extensionId}/src/options.html`);
  const connectionBeforeRecovery = await control.evaluate(async (url) => {
    const [tab] = await chrome.tabs.query({ url });
    if (!tab?.id) return 'target tab not found';
    try {
      await chrome.tabs.sendMessage(tab.id, { type: 'hibro:overview' });
      return 'connected';
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  }, targetUrl);
  expect(connectionBeforeRecovery).toContain('Receiving end does not exist');

  const panel = await browserContext.newPage();
  await panel.goto(`chrome-extension://${extensionId}/src/panel.html`);
  await unconnectedPage.bringToFront();
  await panel.fill('#input', 'What is this page about?');
  await panel.click('#sendBtn');

  await expect(panel.locator('#log .msg.assistant').last()).toContainText(
    'streaming mock answer',
    { timeout: 30_000 }
  );
  await expect(panel.locator('#log .msg.error')).toHaveCount(0);
  expect(await unconnectedPage.evaluate(() => document.body.dataset.hibroPageMarker)).toBe(
    pageMarker
  );

  await panel.close();
  await control.close();
  await unconnectedPage.close();
});

test('recovery before document idle leaves one content-script listener', async ({
  browserContext,
  extensionId
}) => {
  let finishResponse: (() => void) | undefined;
  const server = http.createServer((request, response) => {
    if (request.url !== '/') {
      response.writeHead(204);
      response.end();
      return;
    }
    response.writeHead(200, { 'Content-Type': 'text/html' });
    response.write(`<!doctype html><html><body>
      <button id="target">Target</button>
      <script>
        window.hibroMutations = [];
        new MutationObserver((records) => {
          for (const record of records) {
            if (record.attributeName === 'data-hibro-id') {
              window.hibroMutations.push({
                oldValue: record.oldValue,
                value: record.target.getAttribute('data-hibro-id')
              });
            }
          }
        }).observe(document.documentElement, {
          subtree: true,
          attributes: true,
          attributeOldValue: true
        });
      </script>`);
    finishResponse = () => {
      if (!response.writableEnded) response.end('</body></html>');
      finishResponse = undefined;
    };
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No server address.');
  const targetUrl = `http://127.0.0.1:${address.port}/`;

  const target = await browserContext.newPage();
  const panel = await browserContext.newPage();
  const control = await browserContext.newPage();
  try {
    await target.goto(targetUrl, { waitUntil: 'commit' });
    await expect(target.locator('#target')).toBeVisible();

    await panel.goto(`chrome-extension://${extensionId}/src/panel.html`);
    await target.bringToFront();
    await panel.fill('#input', 'Trigger recovery');
    await panel.click('#sendBtn');

    await control.goto(`chrome-extension://${extensionId}/src/options.html`);
    await expect
      .poll(() =>
        control.evaluate(async (url) => {
          const [tab] = await chrome.tabs.query({ url });
          if (!tab?.id) return false;
          try {
            await chrome.tabs.sendMessage(tab.id, { type: 'hibro:overview' });
            return true;
          } catch {
            return false;
          }
        }, targetUrl)
      )
      .toBe(true);

    finishResponse?.();
    await target.waitForLoadState('load');
    await target.waitForTimeout(250);
    await target.evaluate(() => {
      (window as unknown as { hibroMutations: unknown[] }).hibroMutations = [];
    });

    await control.evaluate(async (url) => {
      const [tab] = await chrome.tabs.query({ url });
      if (!tab?.id) throw new Error('Target tab not found.');
      await chrome.tabs.sendMessage(tab.id, { type: 'hibro:elements' });
    }, targetUrl);
    await expect
      .poll(() =>
        target.evaluate(
          () => (window as unknown as { hibroMutations: unknown[] }).hibroMutations.length
        )
      )
      .toBeGreaterThan(0);
    expect(
      await target.evaluate(
        () => (window as unknown as { hibroMutations: unknown[] }).hibroMutations
      )
    ).toHaveLength(1);
  } finally {
    finishResponse?.();
    await control.close();
    await panel.close();
    await target.close();
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
  }
});

test('slow page reads time out without injecting or retrying the content script', async ({
  browserContext,
  extensionId
}) => {
  test.setTimeout(30_000);
  const slowPage = await browserContext.newPage();
  const targetUrl = `http://127.0.0.1:${mock.port}/uninjected`;
  await slowPage.goto(targetUrl, { waitUntil: 'commit' });
  await expect(
    slowPage.getByRole('heading', { name: 'HIBRO E2E UNINJECTED PAGE' })
  ).toBeVisible();

  const control = await browserContext.newPage();
  await control.goto(`chrome-extension://${extensionId}/src/options.html`);
  const tabId = await control.evaluate(async (url) => {
    const [tab] = await chrome.tabs.query({ url });
    if (!tab?.id) throw new Error('Slow-reader target tab not found.');
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      injectImmediately: true,
      func: () => {
        document.body.dataset.hibroSlowMarkdownCalls = '0';
        const marker = document.createElement('button');
        marker.id = 'slow-reader-marker';
        marker.textContent = 'Slow reader marker';
        document.body.append(marker);

        chrome.runtime.onMessage.addListener(
          (message: { type?: string }, _sender, sendResponse) => {
            if (message.type === 'hibro:overview') {
              sendResponse({
                title: document.title,
                url: location.href,
                metaDescription: '',
                heading: document.querySelector('h1')?.textContent ?? '',
                counts: { links: 0, inputs: 0, forms: 0 }
              });
              return;
            }
            if (message.type !== 'hibro:markdown') return;

            const calls = Number(document.body.dataset.hibroSlowMarkdownCalls ?? '0') + 1;
            document.body.dataset.hibroSlowMarkdownCalls = String(calls);
            if (calls === 1) {
              const deadline = performance.now() + 9_000;
              while (performance.now() < deadline) {
                // Match a large synchronous page conversion that blocks the renderer.
              }
            }
            sendResponse({
              title: document.title,
              url: location.href,
              markdown: 'Slow page content',
              truncated: false
            });
          }
        );
      }
    });
    return tab.id;
  }, targetUrl);

  const panel = await browserContext.newPage();
  try {
    mock.setAgentScript([{ name: 'read_page_as_markdown', args: {} }]);
    await panel.goto(`chrome-extension://${extensionId}/src/panel.html`);
    await slowPage.bringToFront();
    await panel.fill('#input', 'Read this slow page');
    await panel.click('#sendBtn');

    await expect(panel.locator('#log .msg.assistant').last()).toContainText('Task finished.', {
      timeout: 20_000
    });
    expect(
      await slowPage.evaluate(() => Number(document.body.dataset.hibroSlowMarkdownCalls ?? '0'))
    ).toBe(1);

    const card = panel.locator('#log details', { hasText: 'read_page_as_markdown' }).first();
    await expect(card).toContainText('Error');
    await expect(card).toContainText('TAB_MESSAGE_TIMEOUT');

    await control.evaluate(async (id) => {
      await Promise.race([
        chrome.tabs.sendMessage(id, { type: 'hibro:elements' }).catch(() => undefined),
        new Promise<void>((resolve) => setTimeout(resolve, 500))
      ]);
    }, tabId);
    await expect(slowPage.locator('#slow-reader-marker')).not.toHaveAttribute(
      'data-hibro-id',
      /.+/
    );
  } finally {
    mock.setAgentScript([]);
    await panel.close();
    await control.close();
    await slowPage.close();
  }
});

test('chat streams a markdown answer', async ({ browserContext, extensionId }) => {
  const { fixture, panel } = await openPanelOnFixture(browserContext, extensionId);
  await panel.evaluate(() => {
    const w = window as unknown as {
      __sawStreaming: boolean;
      __sawStopSwap: boolean;
      __sawDots: boolean;
    };
    w.__sawStreaming = false;
    w.__sawDots = false;
    new MutationObserver(() => {
      if (document.querySelector('.msg.streaming')) w.__sawStreaming = true;
      if (document.querySelector('.stream-dots')) w.__sawDots = true;
    }).observe(document.getElementById('log')!, { childList: true, subtree: true });
    // While a reply is running, the send button must be replaced by stop.
    // Recorded via observer so the assertion does not race the mock's speed.
    w.__sawStopSwap = false;
    const send = document.getElementById('sendBtn') as HTMLButtonElement;
    const stop = document.getElementById('stopBtn') as HTMLButtonElement;
    new MutationObserver(() => {
      if (send.hidden && !stop.hidden) w.__sawStopSwap = true;
    }).observe(document.querySelector('.toolbar')!, {
      attributes: true,
      attributeFilter: ['hidden'],
      subtree: true
    });
  });
  await panel.fill('#input', 'What is this page about?');
  // Send via Enter (the click path is covered elsewhere). The composer keeps
  // focus during the stream so a follow-up can be typed right away — the
  // streaming indicator is a pulsing dot, not a caret, so there's no
  // double-caret conflict.
  await panel.press('#input', 'Enter');
  expect(await panel.evaluate(() => (document.activeElement as HTMLElement | null)?.id ?? ''))
    .toBe('input');
  const last = panel.locator('#log .msg.assistant').last();
  await expect(last).toContainText('streaming mock answer', { timeout: 30_000 });
  // The dots only mark the pre-text pause (thinking / tool wait): they showed
  // during the mock's reasoning window, and are gone once answer text is up.
  expect(await panel.evaluate(() => (window as unknown as { __sawDots: boolean }).__sawDots)).toBe(true);
  await expect(panel.locator('.stream-dots')).toHaveCount(0);
  // Completion swaps the buttons back.
  await expect(panel.locator('#sendBtn')).toBeVisible();
  await expect(panel.locator('#stopBtn')).toBeHidden();
  // Markdown bold renders: Streamdown emits a Tailwind-styled span tagged with
  // data-streamdown="strong" instead of a raw <strong> element.
  expect(await last.innerHTML()).toContain('data-streamdown="strong"');
  expect(await panel.evaluate(() => (window as unknown as { __sawStreaming: boolean }).__sawStreaming)).toBe(true);
  expect(await panel.evaluate(() => (window as unknown as { __sawStopSwap: boolean }).__sawStopSwap)).toBe(true);
  // The unified assistant loop ran (no separate router call) and streamed.
  expect(mock.stats.agent).toBeGreaterThan(0);
  expect(mock.stats.stream).toBeGreaterThan(0);
  await panel.close();
  await fixture.close();
});

test('composer recalls sent messages with ArrowUp/ArrowDown', async ({ browserContext, extensionId }) => {
  const { fixture, panel } = await openPanelOnFixture(browserContext, extensionId);
  const input = panel.locator('#input');
  // Send, then wait for the request to reach the mock and the run to end, so
  // the next send is never dropped for busy-ness. Both probe messages take the
  // mock's keyword-default direct answer (no tool calls).
  const sendAndWait = async (text: string, seenBefore: number) => {
    await panel.fill('#input', text);
    await panel.press('#input', 'Enter');
    await expect.poll(() => mock.userMessages.length, { timeout: 30_000 }).toBe(seenBefore + 1);
    await expect(panel.locator('#sendBtn')).toBeVisible({ timeout: 30_000 });
  };
  // The beforeEach conversation wipe makes these the only two history entries.
  const seen = mock.userMessages.length;
  await sendAndWait('history probe one', seen);
  await sendAndWait('history probe two', seen + 1);

  // ArrowUp walks newest → oldest and sticks at the oldest entry.
  await input.press('ArrowUp');
  await expect(input).toHaveValue('history probe two');
  await input.press('ArrowUp');
  await expect(input).toHaveValue('history probe one');
  await input.press('ArrowUp');
  await expect(input).toHaveValue('history probe one');

  // ArrowDown walks back; stepping past the newest entry restores the stashed
  // draft (empty here).
  await input.press('ArrowDown');
  await expect(input).toHaveValue('history probe two');
  await input.press('ArrowDown');
  await expect(input).toHaveValue('');

  // A non-empty draft survives the round trip. Browsing starts only with the
  // caret at the very start, so Home moves it there first.
  await input.fill('scratch draft');
  await input.press('Home');
  await input.press('ArrowUp');
  await expect(input).toHaveValue('history probe two');
  await input.press('ArrowDown');
  await expect(input).toHaveValue('scratch draft');

  // With the caret at the end of typed text (the draft restore left it there),
  // ArrowUp keeps its default caret movement instead of recalling.
  await input.press('ArrowUp');
  await expect(input).toHaveValue('scratch draft');

  await panel.close();
  await fixture.close();
});

test('chat renders mermaid diagrams and chart blocks', async ({ browserContext, extensionId }) => {
  const { fixture, panel } = await openPanelOnFixture(browserContext, extensionId);
  // Neither renderer may trip MV3's eval ban while it works.
  const cspErrors: string[] = [];
  panel.on('console', (m) => {
    if (/unsafe-eval|EvalError/i.test(m.text())) cspErrors.push(m.text());
  });
  panel.on('pageerror', (e) => {
    if (/eval/i.test(String(e))) cspErrors.push(String(e));
  });

  // Mermaid: the fence streams in pieces; once it closes, the lazily-loaded
  // mermaid chunk renders an SVG inside the built-in diagram frame.
  await panel.fill('#input', 'draw a diagram of the flow');
  await panel.press('#input', 'Enter');
  const mermaidBlock = panel.locator('[data-streamdown="mermaid-block"]');
  await expect(mermaidBlock).toBeVisible({ timeout: 30_000 });
  await expect(mermaidBlock.locator('svg').first()).toBeVisible({ timeout: 30_000 });

  // Chart: a pure-JSON ECharts spec renders to a canvas once the fence closes.
  // Send swaps to Stop while a run is busy and onSubmit drops input in that
  // window, so wait for the swap back before sending the next message.
  await expect(panel.locator('#sendBtn')).toBeVisible();
  await panel.fill('#input', 'show a chart of quarterly numbers');
  await panel.press('#input', 'Enter');
  const chartBlock = panel.locator('[data-streamdown="chart-block"]');
  await expect(chartBlock.locator('canvas')).toBeVisible({ timeout: 30_000 });

  // A broken spec falls back to the raw code with a note instead of crashing.
  await expect(panel.locator('#sendBtn')).toBeVisible();
  await panel.fill('#input', 'show a broken chart please');
  await panel.press('#input', 'Enter');
  await expect(panel.locator('.chart-note')).toContainText('Invalid chart spec', { timeout: 30_000 });
  await expect(panel.locator('.chart-invalid .chart-fallback')).toBeVisible();

  expect(cspErrors).toEqual([]);
  await panel.close();
  await fixture.close();
});

test('model Markdown cannot load remote images', async ({ browserContext, extensionId }) => {
  const { fixture, panel } = await openPanelOnFixture(browserContext, extensionId);
  const imageRequests = mock.imageRequests;
  try {
    await panel.fill('#input', 'show a remote markdown image');
    await panel.press('#input', 'Enter');
    await expect(panel.locator('#log .msg.assistant').last()).toContainText('Remote image test.');
    await expect(panel.locator('#log .msg.assistant').last().locator('img')).toHaveCount(0);
    await panel.waitForTimeout(250);
    expect(mock.imageRequests).toBe(imageRequests);
  } finally {
    await panel.close();
    await fixture.close();
  }
});

test('trusted provider image assets render from local data without a network request', async ({
  browserContext,
  extensionId
}) => {
  const { fixture, panel } = await openPanelOnFixture(browserContext, extensionId);
  const externalRequests: string[] = [];
  const onRequest = (request: import('@playwright/test').Request) => {
    if (/^https?:/i.test(request.url())) externalRequests.push(request.url());
  };
  browserContext.on('request', onRequest);
  await panel.evaluate(async ({ data }) => {
    const now = Date.now();
    await chrome.storage.local.set({
      hibroConversations: [
        {
          id: 'provider-image',
          title: 'Provider image',
          createdAt: now,
          updatedAt: now,
          messages: [
            {
              id: 'provider-image-response',
              role: 'assistant',
              parts: [
                {
                  type: 'image-asset',
                  provenance: 'provider-inline',
                  mediaType: 'image/png',
                  base64: data,
                  byteLength: 68,
                  alt: 'Generated pixel'
                }
              ]
            }
          ]
        }
      ],
      activeConversationId: 'provider-image'
    });
  }, { data: ONE_PIXEL_PNG_BASE64 });

  try {
    externalRequests.length = 0;
    await panel.reload();
    const image = panel.getByRole('img', { name: 'Generated pixel' });
    await expect(image).toBeVisible();
    await expect(image).toHaveAttribute('src', /^blob:chrome-extension:\/\//);
    expect(externalRequests).toEqual([]);
  } finally {
    browserContext.off('request', onRequest);
    await panel.close();
    await fixture.close();
  }
});

test('remote Markdown images require one-time loading without credentials or referrer', async ({
  browserContext,
  extensionId
}) => {
  const { fixture, panel } = await openPanelOnFixture(browserContext, extensionId);
  const imageUrl = 'https://assets.example.org/generated.png?token=unique';
  const requests: Array<{ cookie?: string; referer?: string }> = [];
  await browserContext.addCookies([
    {
      name: 'remote-session',
      value: 'must-not-leak',
      domain: 'assets.example.org',
      path: '/',
      secure: true,
      sameSite: 'None'
    }
  ]);
  await browserContext.route(imageUrl, async (route) => {
    const headers = route.request().headers();
    requests.push({ cookie: headers.cookie, referer: headers.referer });
    await route.fulfill({
      status: 200,
      contentType: 'image/png',
      body: Buffer.from(ONE_PIXEL_PNG_BASE64, 'base64')
    });
  });
  await panel.evaluate(async ({ url }) => {
    const now = Date.now();
    await chrome.storage.local.set({
      hibroConversations: [
        {
          id: 'remote-image-load-once',
          title: 'Remote image load once',
          createdAt: now,
          updatedAt: now,
          messages: [
            {
              id: 'remote-image-response',
              role: 'assistant',
              parts: [{ type: 'text', text: `![Generated landscape](${url})` }]
            }
          ]
        }
      ],
      activeConversationId: 'remote-image-load-once'
    });
  }, { url: imageUrl });

  try {
    await panel.reload();
    const card = panel.getByRole('figure', { name: 'Generated landscape' });
    await expect(card).toContainText('assets.example.org');
    await expect(card).toContainText('IP address');
    await expect(
      card.getByRole('button', { name: 'Load image from assets.example.org' })
    ).toBeVisible();
    expect(requests).toEqual([]);

    await card.getByRole('button', { name: 'Load image from assets.example.org' }).click();
    const image = card.getByRole('img', { name: 'Generated landscape' });
    await expect(image).toBeVisible();
    await expect.poll(() => requests.length).toBe(1);
    expect(requests).toEqual([{ cookie: undefined, referer: undefined }]);

    const objectUrl = await image.getAttribute('src');
    expect(objectUrl).toMatch(/^blob:chrome-extension:\/\//);
    expect(
      await panel.evaluate(async (url) => (await fetch(url!)).ok, objectUrl)
    ).toBe(true);

    await panel.locator('#quickNewChatBtn').click();
    await expect(image).toHaveCount(0);
    await expect
      .poll(() =>
        panel.evaluate(async (url) => {
          try {
            await fetch(url!);
            return true;
          } catch {
            return false;
          }
        }, objectUrl)
      )
      .toBe(false);
  } finally {
    await browserContext.unroute(imageUrl);
    await panel.close();
    await fixture.close();
  }
});

test('remote image loading blocks unsafe destinations and unsafe responses', async ({
  browserContext,
  extensionId
}) => {
  const { fixture, panel } = await openPanelOnFixture(browserContext, extensionId);
  const origin = 'https://assets.example.org';
  const requests: string[] = [];
  const redirectedTargets: string[] = [];
  await browserContext.route(`${origin}/**`, async (route) => {
    const url = new URL(route.request().url());
    requests.push(url.pathname);
    if (url.pathname === '/not-image') {
      await route.fulfill({ status: 200, contentType: 'text/plain', body: 'not an image' });
      return;
    }
    if (url.pathname === '/oversized.png') {
      await route.fulfill({
        status: 200,
        contentType: 'image/png',
        body: Buffer.alloc(5 * 1024 * 1024 + 1)
      });
      return;
    }
    if (url.pathname === '/redirect.png') {
      await route.fulfill({
        status: 302,
        headers: { location: 'https://127.0.0.1/private-target.png' }
      });
      return;
    }
    await route.abort();
  });
  await browserContext.route('https://127.0.0.1/private-target.png', async (route) => {
    redirectedTargets.push(route.request().url());
    await route.abort();
  });
  await panel.evaluate(async ({ origin }) => {
    const now = Date.now();
    const markdown = [
      '![Insecure scheme](http://assets.example.org/insecure.png)',
      '![Private address](https://127.0.0.1/private.png)',
      '![Credential address](https://user:secret@assets.example.org/credential.png)',
      `![Wrong response type](${origin}/not-image)`,
      `![Oversized response](${origin}/oversized.png)`,
      `![Redirect response](${origin}/redirect.png)`
    ].join('\n\n');
    await chrome.storage.local.set({
      hibroConversations: [
        {
          id: 'unsafe-remote-images',
          title: 'Unsafe remote images',
          createdAt: now,
          updatedAt: now,
          messages: [
            {
              id: 'unsafe-remote-images-response',
              role: 'assistant',
              parts: [{ type: 'text', text: markdown }]
            }
          ]
        }
      ],
      activeConversationId: 'unsafe-remote-images'
    });
  }, { origin });

  try {
    await panel.reload();
    for (const name of ['Insecure scheme', 'Private address', 'Credential address']) {
      const card = panel.getByRole('figure', { name });
      await expect(card).toContainText('blocked');
      await expect(card.getByRole('button')).toHaveCount(0);
    }
    expect(requests).toEqual([]);

    for (const name of ['Wrong response type', 'Oversized response', 'Redirect response']) {
      const card = panel.getByRole('figure', { name });
      await card.getByRole('button', { name: 'Load image from assets.example.org' }).click();
      await expect(card.getByRole('alert')).toContainText('could not be loaded safely');
    }
    expect(requests).toEqual(['/not-image', '/oversized.png', '/redirect.png']);
    expect(redirectedTargets).toEqual([]);
  } finally {
    await browserContext.unroute(`${origin}/**`);
    await browserContext.unroute('https://127.0.0.1/private-target.png');
    await panel.close();
    await fixture.close();
  }
});

test('Mermaid diagrams cannot load remote images', async ({ browserContext, extensionId }) => {
  const { fixture, panel } = await openPanelOnFixture(browserContext, extensionId);
  const imageRequests = mock.imageRequests;
  const trackingUrl = `http://127.0.0.1:${mock.port}/tracking-pixel`;
  const escapedTrackingUrl = trackingUrl.replace('http://', 'h&#x74;tp&colon;&sol;&sol;');
  await panel.evaluate(async ({ url }) => {
    const now = Date.now();
    await chrome.storage.local.set({
      hibroConversations: [
        {
          id: 'remote-mermaid',
          title: 'Remote Mermaid image',
          createdAt: now,
          updatedAt: now,
          messages: [
            {
              id: 'remote-mermaid-response',
              role: 'assistant',
              parts: [
                {
                  type: 'text',
                  text: `\`\`\`mermaid\nflowchart TD\n  A@{ img: "${url}", label: "Remote" }\n\`\`\``
                }
              ]
            }
          ]
        }
      ],
      activeConversationId: 'remote-mermaid'
    });
  }, { url: escapedTrackingUrl });

  try {
    await panel.reload();
    const block = panel.locator('[data-streamdown="mermaid-block"]');
    await expect(block).toContainText('Remote resources are not allowed in Mermaid diagrams', {
      timeout: 30_000
    });
    await expect(block.locator('[data-streamdown="mermaid"]')).toHaveCount(0);
    await panel.waitForTimeout(250);
    expect(mock.imageRequests).toBe(imageRequests);
  } finally {
    await panel.close();
    await fixture.close();
  }
});

test('chart options reject remote image resources', async ({ browserContext, extensionId }) => {
  const { fixture, panel } = await openPanelOnFixture(browserContext, extensionId);
  const imageRequests = mock.imageRequests;
  try {
    await panel.fill('#input', 'show a remote image chart');
    await panel.press('#input', 'Enter');
    await expect(panel.locator('.chart-note')).toContainText(
      'external resources are not allowed',
      { timeout: 30_000 }
    );
    await expect(panel.locator('[data-streamdown="chart-block"]')).toHaveCount(0);
    await panel.waitForTimeout(250);
    expect(mock.imageRequests).toBe(imageRequests);
  } finally {
    await panel.close();
    await fixture.close();
  }
});

test('html blocks toggle between code and a sandboxed preview', async ({
  browserContext,
  extensionId
}) => {
  const { fixture, panel } = await openPanelOnFixture(browserContext, extensionId);
  await panel.fill('#input', 'show me an html snippet');
  await panel.press('#input', 'Enter');

  const block = panel.locator('[data-streamdown="html-block"]');
  await expect(block).toBeVisible({ timeout: 30_000 });
  // Code is the default view; no iframe exists until the user asks for it.
  await expect(block.locator('pre.html-code')).toBeVisible({ timeout: 30_000 });
  await expect(block.locator('iframe')).toHaveCount(0);

  await block.locator('.html-toggle button', { hasText: 'Preview' }).click();
  const frame = block.locator('iframe.html-preview');
  await expect(frame).toBeVisible();
  // The preview is fully sandboxed: no scripts, no forms, no popups.
  const sandbox = await frame.getAttribute('sandbox');
  expect(sandbox ?? '').not.toContain('allow-scripts');
  expect(sandbox ?? '').not.toContain('allow-same-origin');
  // The injected meta CSP travels inside the srcdoc along with the markup.
  const srcdoc = (await frame.getAttribute('srcdoc')) ?? '';
  expect(srcdoc).toContain("default-src 'none'");
  expect(srcdoc).toContain('Preview me');
  // The markup really rendered inside the sandboxed frame.
  const frameBody = frame.contentFrame().locator('h2');
  await expect(frameBody).toHaveText('Preview me');

  await block.locator('.html-toggle button', { hasText: 'Code' }).click();
  await expect(block.locator('pre.html-code')).toBeVisible();
  await expect(block.locator('iframe')).toHaveCount(0);
  await panel.close();
  await fixture.close();
});

test('code blocks cap at 25 lines and scroll beyond that', async ({ browserContext, extensionId }) => {
  const { fixture, panel } = await openPanelOnFixture(browserContext, extensionId);
  await panel.fill('#input', 'give me a long code sample');
  await panel.press('#input', 'Enter');

  const pre = panel.locator('[data-streamdown="code-block-body"] pre').last();
  await expect(pre).toContainText('line 40', { timeout: 30_000 });
  const metrics = await pre.evaluate((el) => {
    const lh = parseFloat(getComputedStyle(el).lineHeight);
    return { clientHeight: el.clientHeight, scrollHeight: el.scrollHeight, lineHeight: lh };
  });
  // 40 lines of code, but only ~25 are visible; the rest scroll.
  expect(metrics.scrollHeight).toBeGreaterThan(metrics.clientHeight);
  expect(metrics.clientHeight).toBeLessThanOrEqual(metrics.lineHeight * 25 + 1);
  expect(metrics.clientHeight).toBeGreaterThan(metrics.lineHeight * 23);
  await panel.close();
  await fixture.close();
});

test('run readout pushes the log up without covering the streaming dots', async ({
  browserContext,
  extensionId
}) => {
  const { fixture, panel } = await openPanelOnFixture(browserContext, extensionId);
  // The readout grows in the footer while reasoning streams; whenever it and
  // the streaming dots coexist, the dots must stay inside the log viewport and
  // above the readout (the log re-pins instead of letting the strip cover
  // them). Sampled on an interval so the assertion doesn't race the mock.
  await panel.evaluate(() => {
    const w = window as unknown as { __dotsChecked: boolean; __dotsCovered: boolean };
    w.__dotsChecked = false;
    w.__dotsCovered = false;
    setInterval(() => {
      const dots = document.querySelector('.stream-dots');
      const readout = document.getElementById('run-readout');
      if (!dots || !readout) return;
      const d = dots.getBoundingClientRect();
      const r = readout.getBoundingClientRect();
      const l = document.getElementById('log')!.getBoundingClientRect();
      w.__dotsChecked = true;
      if (d.bottom > Math.min(r.top, l.bottom) + 1) w.__dotsCovered = true;
    }, 16);
  });
  await panel.fill('#input', 'What is this page about?');
  await panel.press('#input', 'Enter');
  const last = panel.locator('#log .msg.assistant').last();
  await expect(last).toContainText('streaming mock answer', { timeout: 30_000 });
  expect(
    await panel.evaluate(() => (window as unknown as { __dotsChecked: boolean }).__dotsChecked)
  ).toBe(true);
  expect(
    await panel.evaluate(() => (window as unknown as { __dotsCovered: boolean }).__dotsCovered)
  ).toBe(false);
  await panel.close();
  await fixture.close();
});

test('reasoning streams into the run readout, not the message', async ({ browserContext, extensionId }) => {
  const { fixture, panel } = await openPanelOnFixture(browserContext, extensionId);
  await panel.evaluate(() => {
    // The Thinking strip must be gone as soon as answer text starts streaming
    // (not only at run end). Record any overlap (title visible while answer
    // text exists) via observer so the assertion cannot race chunk timing.
    const w = window as unknown as { __sawThinkingOverlap: boolean };
    w.__sawThinkingOverlap = false;
    new MutationObserver(() => {
      const title = document.querySelector('#run-readout .run-readout-title');
      const texts = document.querySelectorAll('#log .msg.assistant .msg-text');
      const answer = texts[texts.length - 1];
      if (title && answer?.textContent?.includes('streaming')) w.__sawThinkingOverlap = true;
    }).observe(document.getElementById('root')!, {
      childList: true,
      subtree: true,
      characterData: true
    });
  });
  await panel.fill('#input', 'What is this page about?');
  await panel.click('#sendBtn');
  const readout = panel.locator('#run-readout');
  const last = panel.locator('#log .msg.assistant').last();
  // While the run is busy, the readout above the input shows the rolling tail
  // of the model's reasoning: the last 3 of the mock's 4 thought lines, under
  // a "Thinking…" title (shown for reasoning only, not for status fallbacks).
  await expect(readout).toContainText('mock thought line four', { timeout: 30_000 });
  await expect(readout).toContainText('Thinking');
  await expect(readout).not.toContainText('line one');
  await expect(readout.locator('.run-readout-line')).toHaveCount(3);
  // Reasoning never renders inside the message bubble itself.
  await expect(last).toContainText('streaming mock answer', { timeout: 30_000 });
  await expect(last).not.toContainText('mock thought');
  // The strip is gone once the run settles, and it never coexisted with the
  // streaming answer (thinking ended → strip hidden immediately).
  await expect(readout).toBeHidden();
  expect(
    await panel.evaluate(() => (window as unknown as { __sawThinkingOverlap: boolean }).__sawThinkingOverlap)
  ).toBe(false);
  await panel.close();
  await fixture.close();
});

test('chat is aware of active site skills', async ({ browserContext, extensionId }) => {
  const { fixture, panel } = await openPanelOnFixture(browserContext, extensionId);
  await panel.evaluate(async () => {
    await chrome.storage.local.set({
      hibroUserSkills: [
        {
          id: 'chat-demo',
          name: 'chatdemo',
          description: 'CHATDEMO_TOKEN_55',
          match: ['*://127.0.0.1*/*'],
          enabled: true
        }
      ]
    });
  });
  const before = mock.systems.length;
  await panel.fill('#input', 'What skills do you have?');
  await panel.click('#sendBtn');
  await expect(panel.locator('#log .msg.assistant').last()).toContainText('streaming mock answer', {
    timeout: 30_000
  });
  // The assistant system prompt includes the active skill's name + description,
  // so "what skills do you have" can be answered truthfully.
  expect(mock.systems.length).toBeGreaterThan(before);
  const sys = mock.systems[mock.systems.length - 1];
  expect(sys).toContain('chatdemo');
  expect(sys).toContain('CHATDEMO_TOKEN_55');
  await panel.evaluate(async () => {
    await chrome.storage.local.remove('hibroUserSkills');
  });
  await panel.close();
  await fixture.close();
});

// The assistant is seeded with page metadata only; the page body is never
// preloaded into the request (the model reads it on demand via tools).
test('sends page metadata only, never the preloaded page content', async ({
  browserContext,
  extensionId
}) => {
  const { fixture, panel } = await openPanelOnFixture(browserContext, extensionId);
  await panel.fill('#input', 'What is this page about?');
  await panel.click('#sendBtn');
  await expect(panel.locator('#log .msg.assistant').last()).toContainText('streaming mock answer', {
    timeout: 30_000
  });
  const sent = mock.userMessages[mock.userMessages.length - 1];
  expect(sent).toContain('What is this page about?');
  // The metadata block carries the overview fields...
  expect(sent).toContain('Current page overview');
  expect(sent).toContain('Hibro e2e fixture');
  expect(sent).toContain(`http://127.0.0.1:${mock.port}/`);
  // ...but the page body is not part of the request.
  expect(sent).not.toContain('Readable fixture text for extraction');
  await panel.close();
  await fixture.close();
});

// Page-switch awareness: the panel tracks each conversation's last page URL and
// the worker flags the change in the next request's context.
test('marks the context when the page changed since the last send', async ({
  browserContext,
  extensionId
}) => {
  const { fixture, panel } = await openPanelOnFixture(browserContext, extensionId);
  const fixtureUrl = `http://127.0.0.1:${mock.port}/`;
  const targetUrl = `http://127.0.0.1:${mock.port}/target`;
  await panel.fill('#input', 'What is this page about?');
  await panel.click('#sendBtn');
  await expect(panel.locator('#log .msg.assistant').last()).toContainText('streaming mock answer', {
    timeout: 30_000
  });
  await expect(panel.locator('#sendBtn')).toBeVisible();
  // The first send of a fresh conversation carries no page-change marker.
  expect(mock.userMessages[mock.userMessages.length - 1]).not.toContain('The page changed');
  const seen = mock.userMessages.length;

  // Navigate the tab; the next send in the same conversation must flag it.
  await fixture.goto(targetUrl);
  await expect(fixture.locator('h1')).toHaveText('HIBRO E2E TARGET');
  await panel.fill('#input', 'And now?');
  await panel.click('#sendBtn');
  // Both answers read "streaming mock answer", so the bubble text can't tell
  // the second run apart from the first; wait for the second request itself.
  await expect.poll(() => mock.userMessages.length, { timeout: 30_000 }).toBe(seen + 1);
  const sent = mock.userMessages[mock.userMessages.length - 1];
  expect(sent).toContain('The page changed');
  expect(sent).toContain(fixtureUrl);
  expect(sent).toContain(targetUrl);
  await panel.close();
  await fixture.close();
});

// Grounding: a page question makes the loop read the page with a perception
// tool before answering (the request itself still carries no page body).
test('page questions are answered by reading the page with tools first', async ({
  browserContext,
  extensionId
}) => {
  const { fixture, panel } = await openPanelOnFixture(browserContext, extensionId);
  mock.setAgentScript([{ name: 'read_page_as_markdown', args: {} }]);
  try {
    await panel.fill('#input', 'Summarize this page');
    await panel.click('#sendBtn');
    // The read tool ran (its card shows the tool name) before the answer came.
    // Tool cards are native <details> elements; there is no .tool-invocation
    // class in the DOM.
    const card = panel.locator('#log details', { hasText: 'read_page_as_markdown' }).first();
    await expect(card).toBeVisible({ timeout: 30_000 });
    await expect(panel.locator('#log .msg.assistant').last()).toContainText('Task finished.', {
      timeout: 30_000
    });
    const sent = mock.userMessages[mock.userMessages.length - 1];
    expect(sent).not.toContain('Readable fixture text for extraction');
  } finally {
    mock.setAgentScript([]);
    await panel.close();
    await fixture.close();
  }
});

test('copy action copies an assistant message', async ({ browserContext, extensionId }) => {
  const { fixture, panel } = await openPanelOnFixture(browserContext, extensionId);
  await panel.fill('#input', 'What is this page about?');
  await panel.click('#sendBtn');
  const last = panel.locator('#log .msg.assistant').last();
  await expect(last).toContainText('streaming mock answer', { timeout: 30_000 });
  // No pill while streaming; wait for the run to finish first.
  await expect(panel.locator('#sendBtn')).toBeVisible();
  await browserContext.grantPermissions(['clipboard-read'], {
    origin: `http://127.0.0.1:${mock.port}`
  });
  await panel.bringToFront();
  // A plain click on the bubble reveals the action pill; its Copy button
  // copies the whole message's rendered text.
  await last.locator('.msg-text').click();
  const copyBtn = panel.locator('.action-pill [data-action="copy"]');
  await expect(copyBtn).toBeVisible();
  // Message scope has no Explain (that's selection scope only).
  await expect(panel.locator('.action-pill [data-action="explain"]')).toHaveCount(0);
  await copyBtn.click();
  await expect(copyBtn).toContainText('Copied');
  await fixture.bringToFront();
  const clip = await fixture.evaluate(async () => {
    for (let i = 0; i < 10; i++) {
      const t = await navigator.clipboard.readText();
      if (t) return t;
      await new Promise((r) => setTimeout(r, 50));
    }
    return '';
  });
  expect(clip).toContain('streaming mock answer');
  await panel.close();
  await fixture.close();
});

test('copy action copies a user message', async ({ browserContext, extensionId }) => {
  const { fixture, panel } = await openPanelOnFixture(browserContext, extensionId);
  await panel.fill('#input', 'What is this page about?');
  await panel.click('#sendBtn');
  const userMsg = panel.locator('#log .msg.user').last();
  await expect(userMsg).toContainText('What is this page about?');
  await expect(panel.locator('#sendBtn')).toBeVisible();
  await browserContext.grantPermissions(['clipboard-read'], {
    origin: `http://127.0.0.1:${mock.port}`
  });
  await panel.bringToFront();
  // The same click-pill works on user bubbles.
  await userMsg.click();
  const copyBtn = panel.locator('.action-pill [data-action="copy"]');
  await expect(copyBtn).toBeVisible();
  await copyBtn.click();
  await expect(copyBtn).toContainText('Copied');
  await fixture.bringToFront();
  const clip = await fixture.evaluate(async () => {
    for (let i = 0; i < 10; i++) {
      const t = await navigator.clipboard.readText();
      if (t) return t;
      await new Promise((r) => setTimeout(r, 50));
    }
    return '';
  });
  expect(clip).toContain('What is this page about?');
  await panel.close();
  await fixture.close();
});

test('no action pill on the empty conversation state', async ({ browserContext, extensionId }) => {
  const { fixture, panel } = await openPanelOnFixture(browserContext, extensionId);
  // The empty-state placeholder ("Ask about this page"…) is not a message:
  // neither selecting its text nor clicking it may raise the action pill.
  await panel.locator('#log').selectText();
  await panel.waitForTimeout(300); // allow the selectionchange → pill path to fire
  await expect(panel.locator('.action-pill')).toHaveCount(0);
  await panel.locator('#log').click();
  await expect(panel.locator('.action-pill')).toHaveCount(0);
  await panel.close();
  await fixture.close();
});

// Scripted multi-tool tasks: the mock replays a fixed tool-call sequence so the
// full agent loop + CDP actions (type/press_key/click/navigate) are exercised
// deterministically, with assertions on real page side-effects — no real LLM.
test('agent types, presses a key, and clicks via tool calls', async ({
  browserContext,
  extensionId
}) => {
  const { fixture, panel } = await openPanelOnFixture(browserContext, extensionId);
  // Fixture interactive order: a#next=1, input#q=2, button#go=3.
  mock.setAgentScript([
    { name: 'list_interactive_elements', args: {} },
    { name: 'type', args: { id: 2, text: 'hi' } },
    { name: 'press_key', args: { key: 'a' } },
    { name: 'click', args: { id: 3 } }
  ]);
  // Dot-indicator invariants across the tool lifecycle: the dots fill dead air
  // (run start, gaps between steps) but must never coexist with a running tool
  // card, which already shows its own pulsing "Running" badge.
  await panel.evaluate(() => {
    const w = window as unknown as { __sawDots: boolean; __sawDotsOverRunningTool: boolean };
    w.__sawDots = false;
    w.__sawDotsOverRunningTool = false;
    new MutationObserver(() => {
      const dots = document.querySelector('.stream-dots');
      if (dots) w.__sawDots = true;
      // The running tool card's pulsing "Running" dot is the only
      // .animate-pulse element in the log.
      if (dots && document.querySelector('.animate-pulse'))
        w.__sawDotsOverRunningTool = true;
    }).observe(document.getElementById('log')!, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true
    });
  });
  try {
    await panel.fill('#input', 'Type, press, and click to submit');
    await panel.click('#sendBtn');
    // type 'hi' + press 'a' → input holds 'hia'; clicking #go writes it to #out.
    await expect(fixture.locator('#out')).toHaveText('You typed: hia', { timeout: 60_000 });
    expect(
      await fixture.evaluate(
        () => (window as unknown as { hibroKeyEvents: string[] }).hibroKeyEvents
      )
    ).toEqual(['keydown:a', 'keyup:a']);
    await expect(panel.locator('#log .msg.assistant').last()).toContainText('Task finished.');
    expect(await panel.evaluate(() => (window as unknown as { __sawDots: boolean }).__sawDots)).toBe(
      true
    );
    expect(
      await panel.evaluate(
        () => (window as unknown as { __sawDotsOverRunningTool: boolean }).__sawDotsOverRunningTool
      )
    ).toBe(false);
    await expect(panel.locator('.stream-dots')).toHaveCount(0);
  } finally {
    mock.setAgentScript([]);
    await panel.close();
    await fixture.close();
  }
});

test('agent navigates via a tool call', async ({ browserContext, extensionId }) => {
  const { fixture, panel } = await openPanelOnFixture(browserContext, extensionId);
  const target = `http://127.0.0.1:${mock.port}/target`;
  mock.setAgentScript([{ name: 'navigate', args: { url: target } }]);
  try {
    await panel.fill('#input', 'Navigate to the target page');
    await panel.click('#sendBtn');
    await expect(fixture).toHaveURL(target, { timeout: 60_000 });
    await expect(fixture.locator('h1')).toHaveText('HIBRO E2E TARGET');
  } finally {
    mock.setAgentScript([]);
    await panel.close();
    await fixture.close();
  }
});


test('active site skills inject their guidance into the agent prompt', async ({
  browserContext,
  extensionId
}) => {
  const { fixture, panel } = await openPanelOnFixture(browserContext, extensionId);
  // A user skill that matches the fixture page; its body carries a token we
  // can detect in the agent system prompt the service worker sends.
  await panel.evaluate(async () => {
    await chrome.storage.local.set({
      hibroUserSkills: [
        {
          id: 'test-demo',
          name: 'demo',
          description: 'demo skill',
          match: ['*://127.0.0.1*/*', '*://localhost*/*'],
          instructions: 'SKILL_DEMO_TOKEN_7341 guidance for the demo page',
          enabled: true
        }
      ]
    });
  });
  const before = mock.systems.length;
  await panel.fill('#input', 'Scroll down the page');
  await panel.click('#sendBtn');
  await expect(panel.locator('#log .msg.assistant').last()).toContainText('Task finished.', {
    timeout: 60_000
  });
  // The task path ran and the skill body reached the agent system prompt.
  expect(mock.systems.length).toBeGreaterThan(before);
  expect(mock.systems[mock.systems.length - 1]).toContain('SKILL_DEMO_TOKEN_7341');
  await panel.evaluate(async () => {
    await chrome.storage.local.remove('hibroUserSkills');
  });
  await panel.close();
  await fixture.close();
});

test('disabled or non-matching skills are not injected', async ({ browserContext, extensionId }) => {
  const { fixture, panel } = await openPanelOnFixture(browserContext, extensionId);
  await panel.evaluate(async () => {
    await chrome.storage.local.set({
      hibroUserSkills: [
        {
          id: 'off',
          name: 'off',
          description: '',
          match: ['*://127.0.0.1*/*'],
          instructions: 'OFF_TOKEN_0000',
          enabled: false
        },
        {
          id: 'nomatch',
          name: 'nomatch',
          description: '',
          match: ['https://example.invalid/*'],
          instructions: 'NOMATCH_TOKEN_0000',
          enabled: true
        }
      ]
    });
  });
  const before = mock.systems.length;
  await panel.fill('#input', 'Scroll down the page');
  await panel.click('#sendBtn');
  await expect(panel.locator('#log .msg.assistant').last()).toContainText('Task finished.', {
    timeout: 60_000
  });
  if (mock.systems.length > before) {
    const sys = mock.systems[mock.systems.length - 1];
    expect(sys).not.toContain('OFF_TOKEN_0000');
    expect(sys).not.toContain('NOMATCH_TOKEN_0000');
  }
  await panel.evaluate(async () => {
    await chrome.storage.local.remove('hibroUserSkills');
  });
  await panel.close();
  await fixture.close();
});

// Built-in site skills must activate only on their own site. The real domain
// is served as a stub page via request interception, so the active tab's URL
// matches the skill's `match` glob with no network access. A task then runs;
// the matching skill's body reaches the agent system prompt (systems) and
// the other sites' bodies do not, which proves the `match` globs are specific.
const BUILTIN_SITE_SKILLS = [
  {
    label: 'Wikipedia',
    url: 'https://en.wikipedia.org/wiki/Agent_(software)',
    token: 'mw-content-text',
    others: ['hn.algolia.com', 'topic_content']
  },
  {
    label: 'Hacker News',
    url: 'https://news.ycombinator.com/item?id=1',
    token: 'hn.algolia.com',
    others: ['mw-content-text', 'topic_content']
  },
  {
    label: 'V2EX',
    url: 'https://www.v2ex.com/t/12345',
    token: 'topic_content',
    others: ['mw-content-text', 'hn.algolia.com']
  }
];

for (const s of BUILTIN_SITE_SKILLS) {
  test(`built-in ${s.label} skill activates on its site`, async ({ browserContext, extensionId }) => {
    const fixture = await browserContext.newPage();
    // Fulfill every request from this tab locally so tab.url is the real site
    // URL without any network access.
    await fixture.route('**/*', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: `<!doctype html><html><head><title>${s.label} stub</title></head><body><h1>${s.label} stub</h1></body></html>`
      })
    );
    await fixture.goto(s.url);
    await expect(fixture).toHaveTitle(`${s.label} stub`);
    const panel = await browserContext.newPage();
    await panel.goto(`chrome-extension://${extensionId}/src/panel.html`);
    await fixture.bringToFront();

    const before = mock.systems.length;
    await panel.fill('#input', 'Scroll down the page');
    await panel.click('#sendBtn');
    await expect(panel.locator('#log .msg.assistant').last()).toContainText('Task finished.', {
      timeout: 60_000
    });
    expect(mock.systems.length).toBeGreaterThan(before);
    const sys = mock.systems[mock.systems.length - 1];
    // The matching skill's guidance is injected...
    expect(sys).toContain(s.token);
    // ...and the other built-in site skills' guidance is not.
    for (const other of s.others) {
      expect(sys).not.toContain(other);
    }

    await panel.close();
    await fixture.close();
  });
}

test('selection pill copies and explains a selection', async ({ browserContext, extensionId }) => {
  const { fixture, panel } = await openPanelOnFixture(browserContext, extensionId);
  await panel.fill('#input', 'What is this page about?');
  await panel.click('#sendBtn');
  const last = panel.locator('#log .msg.assistant').last();
  await expect(last).toContainText('streaming mock answer', { timeout: 30_000 });
  await expect(panel.locator('#sendBtn')).toBeVisible();
  const explainCalls = mock.stats.explain;
  // Selecting text in a message reveals the floating pill with Copy (left) and
  // Explain (right).
  await last.locator('.msg-text').selectText();
  const copyBtn = panel.locator('.action-pill [data-action="copy"]');
  const explainBtn = panel.locator('.action-pill [data-action="explain"]');
  await expect(copyBtn).toBeVisible();
  await expect(explainBtn).toBeVisible();
  // A visible divider sits between Copy and Explain.
  await expect(panel.locator('.action-pill .action-pill-divider')).toHaveCount(1);
  const copyBox = (await copyBtn.boundingBox())!;
  const explainBox = (await explainBtn.boundingBox())!;
  expect(copyBox.x).toBeLessThan(explainBox.x);
  // Copy puts exactly the selected text on the clipboard; the pill (and the
  // selection) stays so Explain remains reachable afterwards.
  await browserContext.grantPermissions(['clipboard-read'], {
    origin: `http://127.0.0.1:${mock.port}`
  });
  await panel.bringToFront();
  await copyBtn.click();
  await expect(copyBtn).toContainText('Copied');
  await fixture.bringToFront();
  const clip = await fixture.evaluate(async () => {
    for (let i = 0; i < 10; i++) {
      const t = await navigator.clipboard.readText();
      if (t) return t;
      await new Promise((r) => setTimeout(r, 50));
    }
    return '';
  });
  expect(clip).toContain('streaming mock answer');
  // Explain sends the selection via the hibro:explain runtime message.
  await panel.bringToFront();
  await explainBtn.click();
  await expect(panel.locator('[data-explain-result]')).toContainText('mock explanation', {
    timeout: 30_000
  });
  expect(mock.stats.explain).toBe(explainCalls + 1);
  await panel.close();
  await fixture.close();
});

test('restricted-page errors render as a distinct error card', async ({
  browserContext,
  extensionId
}) => {
  // Keep the panel tab itself active: content scripts cannot run on an
  // extension page, so recovery reports that the page is unsupported.
  const panel = await browserContext.newPage();
  await panel.goto(`chrome-extension://${extensionId}/src/panel.html`);
  await panel.bringToFront();
  await panel.fill('#input', 'What is this page about?');
  await panel.click('#sendBtn');
  const err = panel.locator('#log .msg.error');
  await expect(err).toContainText('This page is not supported', { timeout: 30_000 });
  // Errors need a distinct surface and warning sign, not only a text color.
  const bubble = panel.locator('#log .msg.error .error-bubble');
  const styles = await bubble.evaluate((el) => {
    const cs = getComputedStyle(el);
    return {
      bg: cs.backgroundColor,
      border: cs.borderTopColor,
      icon: getComputedStyle(el, '::before').content
    };
  });
  expect(styles.bg).not.toBe('rgba(0, 0, 0, 0)');
  expect(styles.border).not.toBe('rgba(0, 0, 0, 0)');
  expect(styles.icon).toContain('⚠');
  await panel.close();
});

test('anthropic provider runs a task through the mock', async ({ browserContext, extensionId }) => {
  // Add an Anthropic provider and activate it (options-side selection).
  // Anthropic uses the Messages API (/v1/messages), which the mock serves; the
  // task path is non-streaming, so no SSE is needed.
  const opts = await browserContext.newPage();
  await opts.goto(`chrome-extension://${extensionId}/src/options.html`);
  await addProvider(opts, {
    name: 'Anthropic-Mock',
    type: 'anthropic',
    baseUrl: `http://127.0.0.1:${mock.port}`,
    apiKey: 'test-key',
    model: 'claude-3-5-haiku-latest',
    activate: true
  });
  await opts.close();

  const { fixture, panel } = await openPanelOnFixture(browserContext, extensionId);
  await fixture.evaluate(() => window.scrollTo(0, 0));
  await panel.fill('#input', 'Scroll down the page');
  await panel.click('#sendBtn');
  await expect(panel.locator('#log .msg.assistant').last()).toContainText('Task finished.', {
    timeout: 60_000
  });
  await expect(panel.locator('#sendBtn')).toBeVisible();
  await expect(panel.locator('#stopBtn')).toBeHidden();
  expect(await fixture.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  await panel.close();
  await fixture.close();
});

test('openai provider runs a chat through the mock', async ({ browserContext, extensionId }) => {
  // Add the OpenAI provider (a second profile; the openai-compatible mock is
  // already active, so this one is not auto-activated). The dedicated OpenAI
  // provider also speaks Chat Completions, so it reuses the same mock.
  const opts = await browserContext.newPage();
  await opts.goto(`chrome-extension://${extensionId}/src/options.html`);
  await addProvider(opts, {
    name: 'OpenAI-Mock',
    type: 'openai',
    baseUrl: `http://127.0.0.1:${mock.port}`,
    apiKey: 'test-key',
    model: 'gpt-4o-mini'
  });
  await opts.close();

  const { fixture, panel } = await openPanelOnFixture(browserContext, extensionId);
  // Select it from the panel's custom provider dropdown (the panel picks which
  // provider it runs on); the service worker then uses it for the next call.
  // Options are labeled "name / model". The menu must stay right-aligned with
  // its button and inside the panel; the native select popup shifted left on
  // macOS once the labels grew longer.
  await panel.click('#providerSelect');
  const menu = panel.getByRole('listbox');
  await expect(menu).toBeVisible();
  const btnBox = (await panel.locator('#providerSelect').boundingBox())!;
  const menuBox = (await menu.boundingBox())!;
  expect(Math.abs(btnBox.x + btnBox.width - (menuBox.x + menuBox.width))).toBeLessThan(2);
  expect(menuBox.x).toBeGreaterThanOrEqual(0);
  await panel.getByRole('option', { name: 'OpenAI-Mock / gpt-4o-mini' }).click();
  await expect(menu).toBeHidden();
  await panel.fill('#input', 'What is this page about?');
  await panel.click('#sendBtn');
  await expect(panel.locator('#log .msg.assistant').last()).toContainText('streaming mock answer', {
    timeout: 30_000
  });
  await panel.close();
  await fixture.close();
});

test('provider picker uses available toolbar width for long model names', async ({
  browserContext,
  extensionId
}) => {
  const options = await browserContext.newPage();
  await options.goto(`chrome-extension://${extensionId}/src/options.html`);
  await addProvider(options, {
    name: 'DeepSeek',
    baseUrl: `http://127.0.0.1:${mock.port}`,
    model: 'deepseek-v4-flash-vision-exp'
  });
  const providerRow = options.locator('#providerList .provider-row', { hasText: 'DeepSeek' });
  const activate = providerRow.locator('button[data-activate]');
  if (await activate.count()) await activate.click();
  await options.close();

  const panel = await browserContext.newPage();
  await panel.setViewportSize({ width: 400, height: 720 });
  await panel.goto(`chrome-extension://${extensionId}/src/panel.html`);
  await expect(panel.locator('#providerSelect')).toHaveAttribute(
    'title',
    'DeepSeek / deepseek-v4-flash-vision-exp'
  );

  const label = panel.locator('.provider-picker-label');
  const labelWidth = await label.evaluate((element) => ({
    client: element.clientWidth,
    scroll: element.scrollWidth
  }));
  expect(labelWidth.scroll).toBeLessThanOrEqual(labelWidth.client);
  await expect(panel.locator('#settingsBtn')).toBeVisible();
  await expect(panel.locator('#sendBtn')).toBeVisible();
  expect(await horizontalOverflow(panel)).toEqual({ page: 0, scrollers: [] });
  await panel.close();
});

test('Settings opens on LLM providers', async ({
  browserContext,
  extensionId
}) => {
  const first = await browserContext.newPage();
  await first.goto(`chrome-extension://${extensionId}/src/options.html`);
  await first.getByRole('tab', { name: 'Agent skills' }).click();
  await expect(first.getByRole('tab', { name: 'Agent skills' })).toHaveAttribute(
    'aria-selected',
    'true'
  );
  await first.close();

  const reopened = await browserContext.newPage();
  await reopened.goto(`chrome-extension://${extensionId}/src/options.html`);
  await expect(reopened.getByRole('tab', { name: 'LLM providers' })).toHaveAttribute(
    'aria-selected',
    'true'
  );
  await reopened.close();
});

test('a send during startup cannot be overwritten by stale conversation hydration', async ({
  browserContext,
  extensionId
}) => {
  const control = await browserContext.newPage();
  await control.goto(`chrome-extension://${extensionId}/src/options.html`);
  await control.evaluate(async () => {
    const now = Date.now();
    await chrome.storage.local.set({
      hibroConversations: [
        {
          id: 'stored-startup-conversation',
          title: 'Stored startup conversation',
          createdAt: now,
          updatedAt: now,
          messages: [
            {
              id: 'stored-startup-message',
              role: 'user',
              parts: [{ type: 'text', text: 'Stored prompt from before startup' }]
            }
          ]
        }
      ],
      activeConversationId: 'stored-startup-conversation'
    });
  });
  await control.close();

  const fixture = await browserContext.newPage();
  await fixture.goto(`http://127.0.0.1:${mock.port}/`);
  const panel = await browserContext.newPage();
  await panel.addInitScript(() => {
    const state = window as unknown as {
      hibroConversationReadStarted: boolean;
      releaseHibroConversationRead?: () => void;
    };
    state.hibroConversationReadStarted = false;
    let releaseRead!: () => void;
    const readGate = new Promise<void>((resolve) => {
      releaseRead = resolve;
    });
    const originalGet = chrome.storage.local.get.bind(chrome.storage.local);
    let holdConversationRead = true;
    chrome.storage.local.get = (async (...args: Parameters<typeof originalGet>) => {
      const result = await originalGet(...args);
      const keys = args[0];
      if (
        holdConversationRead &&
        Array.isArray(keys) &&
        keys.includes('hibroConversations')
      ) {
        holdConversationRead = false;
        state.hibroConversationReadStarted = true;
        await readGate;
      }
      return result;
    }) as typeof chrome.storage.local.get;

    const originalConnect = chrome.runtime.connect.bind(chrome.runtime);
    chrome.runtime.connect = ((...args: Parameters<typeof originalConnect>) => {
      const port = originalConnect(...args);
      const originalPostMessage = port.postMessage.bind(port);
      port.postMessage = ((message: unknown) => {
        if ((message as { type?: string })?.type === 'send') releaseRead();
        originalPostMessage(message);
      }) as typeof port.postMessage;
      return port;
    }) as typeof chrome.runtime.connect;
  });

  try {
    await panel.goto(`chrome-extension://${extensionId}/src/panel.html`);
    await expect
      .poll(() =>
        panel.evaluate(
          () =>
            (window as unknown as { hibroConversationReadStarted: boolean })
              .hibroConversationReadStarted
        )
      )
      .toBe(true);
    await fixture.bringToFront();
    await panel.fill('#input', 'New prompt submitted during startup');
    await panel.click('#sendBtn');
    await panel.waitForTimeout(300);

    const log = await panel.locator('#log').innerText();
    expect(log).toContain('New prompt submitted during startup');
    expect(log).not.toContain('Stored prompt from before startup');
  } finally {
    await panel.close();
    await fixture.close();
  }
});

test('startup persistence waits for stored conversations before saving an immediate send', async ({
  browserContext,
  extensionId
}) => {
  const control = await browserContext.newPage();
  await control.goto(`chrome-extension://${extensionId}/src/options.html`);
  await control.evaluate(async () => {
    const now = Date.now();
    await chrome.storage.local.set({
      hibroConversations: [
        {
          id: 'existing-startup-history',
          title: 'Existing startup history',
          createdAt: now,
          updatedAt: now,
          messages: [
            {
              id: 'existing-startup-message',
              role: 'user',
              parts: [{ type: 'text', text: 'Keep this stored conversation' }]
            }
          ]
        }
      ],
      activeConversationId: 'existing-startup-history'
    });
  });

  const fixture = await browserContext.newPage();
  await fixture.goto(`http://127.0.0.1:${mock.port}/`);
  const panel = await browserContext.newPage();
  await panel.addInitScript(() => {
    type StartupPersistenceProbe = {
      hibroConversationReadStarted: boolean;
      hibroPendingSaveTimers: Map<number, () => void>;
      hibroLastConversationWrite: Promise<void> | null;
      releaseHibroConversationRead?: () => void;
      flushHibroSaveTimers: () => Promise<void>;
    };
    const state = window as unknown as Window & StartupPersistenceProbe;
    state.hibroConversationReadStarted = false;
    state.hibroPendingSaveTimers = new Map();
    state.hibroLastConversationWrite = null;

    const originalGet = chrome.storage.local.get.bind(chrome.storage.local);
    let holdConversationRead = true;
    chrome.storage.local.get = (async (...args: Parameters<typeof originalGet>) => {
      const result = await originalGet(...args);
      const keys = args[0];
      if (
        holdConversationRead &&
        Array.isArray(keys) &&
        keys.includes('hibroConversations') &&
        keys.includes('activeConversationId')
      ) {
        holdConversationRead = false;
        state.hibroConversationReadStarted = true;
        await new Promise<void>((resolve) => {
          state.releaseHibroConversationRead = resolve;
        });
      }
      return result;
    }) as typeof chrome.storage.local.get;

    const originalSet = chrome.storage.local.set.bind(chrome.storage.local);
    chrome.storage.local.set = ((items: Record<string, unknown>) => {
      const write = originalSet(items);
      if ('hibroConversations' in items) {
        state.hibroLastConversationWrite = Promise.resolve(write);
      }
      return write;
    }) as typeof chrome.storage.local.set;

    const originalSetTimeout = window.setTimeout.bind(window);
    const originalClearTimeout = window.clearTimeout.bind(window);
    window.setTimeout = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
      if (timeout !== 400) return originalSetTimeout(handler, timeout, ...args);
      const id = originalSetTimeout(() => {}, 60_000);
      state.hibroPendingSaveTimers.set(id, () => {
        originalClearTimeout(id);
        state.hibroPendingSaveTimers.delete(id);
        if (typeof handler === 'function') handler(...args);
      });
      return id;
    }) as typeof window.setTimeout;
    window.clearTimeout = ((id?: number) => {
      if (id !== undefined) state.hibroPendingSaveTimers.delete(id);
      originalClearTimeout(id);
    }) as typeof window.clearTimeout;
    state.flushHibroSaveTimers = async () => {
      const callbacks = [...state.hibroPendingSaveTimers.values()];
      for (const callback of callbacks) callback();
      if (state.hibroLastConversationWrite) await state.hibroLastConversationWrite;
    };
  });

  try {
    await panel.goto(`chrome-extension://${extensionId}/src/panel.html`);
    await expect
      .poll(() =>
        panel.evaluate(
          () =>
            (window as unknown as { hibroConversationReadStarted: boolean })
              .hibroConversationReadStarted
        )
      )
      .toBe(true);
    await fixture.bringToFront();
    await panel.fill('#input', 'Immediate startup message');
    await panel.click('#sendBtn');
    await expect
      .poll(() =>
        panel.evaluate(
          () =>
            (window as unknown as { hibroPendingSaveTimers: Map<number, () => void> })
              .hibroPendingSaveTimers.size
        )
      )
      .toBeGreaterThan(0);
    await panel.evaluate(() =>
      (window as unknown as { flushHibroSaveTimers: () => Promise<void> })
        .flushHibroSaveTimers()
    );

    const idsBeforeRelease = await control.evaluate(async () =>
      ((await chrome.storage.local.get('hibroConversations')).hibroConversations as Array<{
        id: string;
      }>).map((item) => item.id)
    );
    expect(idsBeforeRelease).toContain('existing-startup-history');

    await panel.evaluate(() =>
      (window as unknown as { releaseHibroConversationRead?: () => void })
        .releaseHibroConversationRead?.()
    );
    await expect
      .poll(() =>
        control.evaluate(async () => {
          const items = (await chrome.storage.local.get('hibroConversations'))
            .hibroConversations as Array<{ id: string; messages: unknown[] }>;
          return {
            keptStored: items.some((item) => item.id === 'existing-startup-history'),
            savedImmediate: JSON.stringify(items).includes('Immediate startup message')
          };
        })
      )
      .toEqual({ keptStored: true, savedImmediate: true });
  } finally {
    await panel.close();
    await fixture.close();
    await control.close();
  }
});

test('New chat during startup cannot be overwritten by stale conversation hydration', async ({
  browserContext,
  extensionId
}) => {
  const control = await browserContext.newPage();
  await control.goto(`chrome-extension://${extensionId}/src/options.html`);
  await control.evaluate(async () => {
    const now = Date.now();
    await chrome.storage.local.set({
      hibroConversations: [
        {
          id: 'stored-before-new-chat',
          title: 'Stored before New chat',
          createdAt: now,
          updatedAt: now,
          messages: [
            {
              id: 'stored-before-new-chat-message',
              role: 'user',
              parts: [{ type: 'text', text: 'Stored prompt before New chat' }]
            }
          ]
        }
      ],
      activeConversationId: 'stored-before-new-chat'
    });
  });
  await control.close();

  const panel = await browserContext.newPage();
  await panel.addInitScript(() => {
    type ProbeState = {
      hibroConversationReadStarted: boolean;
      hibroConversationReadResumed: boolean;
      hibroSchedulerBlocked: boolean;
      hibroSchedulerProcessed: number;
      hibroSchedulerQueue: Array<() => void>;
      releaseHibroConversationRead?: () => void;
      blockHibroScheduler: () => void;
      flushHibroScheduler: () => void;
    };

    const state = window as unknown as Window & ProbeState;
    state.hibroConversationReadStarted = false;
    state.hibroConversationReadResumed = false;
    state.hibroSchedulerBlocked = false;
    state.hibroSchedulerProcessed = 0;
    state.hibroSchedulerQueue = [];

    // Install before React loads so its Scheduler uses this channel.
    const NativeMessageChannel = MessageChannel;
    Object.defineProperty(window, 'MessageChannel', {
      configurable: true,
      value: class extends NativeMessageChannel {
        constructor() {
          super();
          this.port1.addEventListener('message', () => {
            queueMicrotask(() => {
              state.hibroSchedulerProcessed += 1;
            });
          });
          this.port1.start();

          const originalPostMessage = this.port2.postMessage.bind(this.port2);
          this.port2.postMessage = ((message: unknown) => {
            const post = () => originalPostMessage(message);
            if (state.hibroSchedulerBlocked) {
              state.hibroSchedulerQueue.push(post);
            } else {
              post();
            }
          }) as typeof this.port2.postMessage;
        }
      }
    });

    state.blockHibroScheduler = () => {
      state.hibroSchedulerBlocked = true;
    };
    state.flushHibroScheduler = () => {
      state.hibroSchedulerBlocked = false;
      const queued = state.hibroSchedulerQueue.splice(0);
      for (const post of queued) post();
    };

    const originalGet = chrome.storage.local.get.bind(chrome.storage.local);
    let holdConversationRead = true;
    chrome.storage.local.get = (async (...args: Parameters<typeof originalGet>) => {
      const result = await originalGet(...args);
      const keys = args[0];
      if (
        holdConversationRead &&
        Array.isArray(keys) &&
        keys.includes('hibroConversations') &&
        keys.includes('activeConversationId')
      ) {
        holdConversationRead = false;
        state.hibroConversationReadStarted = true;
        await new Promise<void>((resolve) => {
          state.releaseHibroConversationRead = resolve;
        });
        state.hibroConversationReadResumed = true;
      }
      return result;
    }) as typeof chrome.storage.local.get;

    const originalRandomUUID = crypto.randomUUID.bind(crypto);
    crypto.randomUUID = (() => {
      const id = originalRandomUUID();
      if (state.hibroSchedulerBlocked && state.releaseHibroConversationRead) {
        const releaseRead = state.releaseHibroConversationRead;
        state.releaseHibroConversationRead = undefined;
        releaseRead();
      }
      return id;
    }) as typeof crypto.randomUUID;
  });

  try {
    await panel.goto(`chrome-extension://${extensionId}/src/panel.html`);
    await expect
      .poll(() =>
        panel.evaluate(
          () =>
            (window as unknown as { hibroConversationReadStarted: boolean })
              .hibroConversationReadStarted
        )
      )
      .toBe(true);

    await panel.evaluate(() => {
      const state = window as unknown as { blockHibroScheduler: () => void };
      state.blockHibroScheduler();
      (document.querySelector('#quickNewChatBtn') as HTMLButtonElement).click();
    });
    await expect
      .poll(() =>
        panel.evaluate(
          () =>
            (window as unknown as { hibroConversationReadResumed: boolean })
              .hibroConversationReadResumed
        )
      )
      .toBe(true);

    // Let the stale hydration continuation enqueue its update while React's
    // Scheduler remains paused, then wait until React handles the released queue.
    await panel.evaluate(() => new Promise<void>((resolve) => window.setTimeout(resolve, 0)));
    await expect
      .poll(() =>
        panel.evaluate(
          () =>
            (window as unknown as { hibroSchedulerQueue: Array<() => void> })
              .hibroSchedulerQueue.length
        )
      )
      .toBeGreaterThan(0);
    const processedBeforeFlush = await panel.evaluate(() => {
      const state = window as unknown as {
        hibroSchedulerProcessed: number;
        flushHibroScheduler: () => void;
      };
      const before = state.hibroSchedulerProcessed;
      state.flushHibroScheduler();
      return before;
    });
    await expect
      .poll(() =>
        panel.evaluate(
          () =>
            (window as unknown as { hibroSchedulerProcessed: number })
              .hibroSchedulerProcessed
        )
      )
      .toBeGreaterThan(processedBeforeFlush);

    await expect(panel.locator('#log .msg')).toHaveCount(0);
    await expect(panel.locator('#log')).toContainText('Ask about this page');
    await expect(panel.locator('#log')).not.toContainText('Stored prompt before New chat');
    await expect
      .poll(() =>
        panel.evaluate(
          async () =>
            (await chrome.storage.local.get('activeConversationId'))
              .activeConversationId
        )
      )
      .not.toBe('stored-before-new-chat');
  } finally {
    await panel.close();
  }
});

test('deleting an inactive conversation flushes the active pending save', async ({
  browserContext,
  extensionId
}) => {
  const control = await browserContext.newPage();
  await control.goto(`chrome-extension://${extensionId}/src/options.html`);
  await control.evaluate(async () => {
    const now = Date.now();
    await chrome.storage.local.set({
      hibroConversations: [
        {
          id: 'active-delete-source',
          title: 'Active delete source',
          createdAt: now,
          updatedAt: now,
          messages: [
            {
              id: 'active-delete-message',
              role: 'user',
              parts: [{ type: 'text', text: 'Original active prompt' }]
            }
          ]
        },
        {
          id: 'inactive-delete-target',
          title: 'Inactive delete target',
          createdAt: now - 1,
          updatedAt: now - 1,
          messages: [
            {
              id: 'inactive-delete-message',
              role: 'user',
              parts: [{ type: 'text', text: 'Old inactive prompt' }]
            }
          ]
        }
      ],
      activeConversationId: 'active-delete-source'
    });
  });
  await control.close();

  const fixture = await browserContext.newPage();
  await fixture.goto(`http://127.0.0.1:${mock.port}/`);
  const panel = await browserContext.newPage();
  await panel.addInitScript(() => {
    const originalSetTimeout = window.setTimeout.bind(window);
    window.setTimeout = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) =>
      originalSetTimeout(handler, timeout === 400 ? 60_000 : timeout, ...args)) as typeof window.setTimeout;
  });

  try {
    await panel.goto(`chrome-extension://${extensionId}/src/panel.html`);
    await expect(panel.locator('#log')).toContainText('Original active prompt');
    await fixture.bringToFront();
    await panel.fill('#input', 'Unsaved active follow-up');
    await panel.click('#sendBtn');
    await expect(panel.locator('#sendBtn')).toBeVisible({ timeout: 30_000 });

    await panel.click('#convDrawerBtn');
    const inactive = panel.locator('#convDrawer .conv-row', {
      hasText: 'Inactive delete target'
    });
    await inactive.locator('.conv-del').click();
    await expect
      .poll(async () =>
        panel.evaluate(async () => {
          const items = (await chrome.storage.local.get('hibroConversations'))
            .hibroConversations as Array<{ id: string }>;
          return items.some((item) => item.id === 'inactive-delete-target');
        })
      )
      .toBe(false);

    const storedMessages = await panel.evaluate(async () => {
      const items = (await chrome.storage.local.get('hibroConversations'))
        .hibroConversations as Array<{ id: string; messages: unknown[] }>;
      return items.find((item) => item.id === 'active-delete-source')?.messages ?? [];
    });
    expect(JSON.stringify(storedMessages)).toContain('Unsaved active follow-up');
  } finally {
    await panel.close();
    await fixture.close();
  }
});

test('conversations persist across panel reload and the drawer switches them', async ({
  browserContext,
  extensionId
}) => {
  const { fixture, panel } = await openPanelOnFixture(browserContext, extensionId);
  await panel.fill('#input', 'What is this page about?');
  await panel.click('#sendBtn');
  await expect(panel.locator('#log .msg.assistant').last()).toContainText('streaming mock answer', {
    timeout: 30_000
  });
  await expect(panel.locator('#sendBtn')).toBeVisible();

  // The exchange is persisted with full detail (user + assistant parts), and the
  // open thread is the active one. The save is debounced, so poll for it.
  await expect
    .poll(
      async () =>
        (await panel.evaluate(async () => (await chrome.storage.local.get('hibroConversations')).hibroConversations))
          ?.length ?? 0,
      { timeout: 5000 }
    )
    .toBe(1);
  const stored = await panel.evaluate(
    async () => await chrome.storage.local.get(['hibroConversations', 'activeConversationId'])
  );
  expect(stored.activeConversationId).toBe(stored.hibroConversations[0].id);
  const msgs = stored.hibroConversations[0].messages as { role: string }[];
  expect(msgs.some((m) => m.role === 'user')).toBe(true);
  expect(msgs.some((m) => m.role === 'assistant')).toBe(true);

  // Reload the panel: the active conversation is restored from storage on mount.
  await panel.reload();
  await expect(panel.locator('#log .msg.user').last()).toContainText('What is this page about?', {
    timeout: 30_000
  });
  await expect(panel.locator('#log .msg.assistant').last()).toContainText('streaming mock answer');

  // The history drawer lists the one conversation, with the active row selected.
  await panel.click('#convDrawerBtn');
  await expect(panel.locator('#convBackdrop')).toBeVisible();
  await expect(panel.locator('#convDrawer [role="listitem"]')).toHaveCount(1);
  await expect(panel.locator('#convDrawer .conv-row-main[aria-current="true"]')).toHaveCount(1);

  // The top-bar New chat action empties the panel while keeping the prior thread
  // in the drawer.
  await panel.click('#convDrawerClose');
  await panel.click('#quickNewChatBtn');
  await expect(panel.locator('#log')).toContainText('Ask about this page');
  await panel.click('#convDrawerBtn');
  await expect(panel.locator('#convBackdrop')).toBeVisible();
  await expect(panel.locator('#convDrawer [role="listitem"]')).toHaveCount(1);

  // Switch back: the prior conversation's messages are restored.
  await panel.locator('#convDrawer .conv-row-main').first().click();
  await expect(panel.locator('#convBackdrop')).toHaveCount(0);
  await expect(panel.locator('#log .msg.assistant').last()).toContainText('streaming mock answer');
  await expect(panel.locator('#log .msg.user').last()).toContainText('What is this page about?');

  await panel.close();
  await fixture.close();
});

test('history drawer renames a conversation and preserves its custom title', async ({
  browserContext,
  extensionId
}) => {
  const { fixture, panel } = await openPanelOnFixture(browserContext, extensionId);
  const conversationId = 'rename-conversation';
  const originalTitle = 'Original conversation title';
  await panel.evaluate(
    async ({ id, title }) => {
      const now = Date.now();
      await chrome.storage.local.set({
        hibroConversations: [
          {
            id,
            title,
            createdAt: now,
            updatedAt: now,
            messages: [
              {
                id: 'rename-message',
                role: 'user',
                parts: [{ type: 'text', text: 'Original prompt' }]
              },
              {
                id: 'rename-response',
                role: 'assistant',
                parts: [{ type: 'text', text: 'Original response' }]
              }
            ]
          }
        ],
        activeConversationId: id
      });
    },
    { id: conversationId, title: originalTitle }
  );
  await panel.reload();
  await expect(panel.locator('.app-title')).toHaveText(originalTitle);

  await panel.getByRole('button', { name: 'Conversation history' }).click();
  const rename = panel.getByRole('button', {
    name: `Rename conversation: ${originalTitle}`
  });
  await rename.click();
  const titleInput = panel.getByRole('textbox', { name: 'Conversation title' });
  await expect(titleInput).toBeFocused();
  await titleInput.fill('Discard this title');
  await titleInput.press('Escape');
  await expect(titleInput).toHaveCount(0);
  await expect(panel.locator('#convBackdrop')).toBeVisible();
  await expect(panel.locator('#convDrawer')).toContainText(originalTitle);
  await expect
    .poll(async () =>
      panel.evaluate(
        async (id) =>
          (
            (await chrome.storage.local.get('hibroConversations'))
              .hibroConversations as { id: string; title: string }[]
          ).find((conversation) => conversation.id === id)?.title,
        conversationId
      )
    )
    .toBe(originalTitle);

  await rename.click();
  await titleInput.fill('   ');
  await titleInput.press('Enter');
  await expect(titleInput).toHaveCount(0);
  await expect(panel.locator('#convDrawer')).toContainText(originalTitle);
  await expect
    .poll(async () =>
      panel.evaluate(
        async (id) =>
          (
            (await chrome.storage.local.get('hibroConversations'))
              .hibroConversations as { id: string; title: string }[]
          ).find((conversation) => conversation.id === id)?.title,
        conversationId
      )
    )
    .toBe(originalTitle);

  await rename.click();
  await titleInput.fill('  Project notes  ');
  await titleInput.press('Enter');
  await expect(panel.locator('#convDrawer')).toContainText('Project notes');
  await expect(panel.locator('.app-title')).toHaveText('Project notes');
  await expect
    .poll(async () =>
      panel.evaluate(
        async (id) =>
          (
            (await chrome.storage.local.get('hibroConversations'))
              .hibroConversations as { id: string; title: string }[]
          ).find((conversation) => conversation.id === id)?.title,
        conversationId
      )
    )
    .toBe('Project notes');

  await panel.getByRole('button', { name: 'Close history' }).click();
  await panel.getByRole('textbox').fill('Follow-up question');
  await panel.getByRole('button', { name: 'Send' }).click();
  await expect(panel.locator('#log .msg.assistant').last()).toContainText('streaming mock answer', {
    timeout: 30_000
  });
  await expect
    .poll(async () =>
      panel.evaluate(
        async (id) =>
          (
            (await chrome.storage.local.get('hibroConversations'))
              .hibroConversations as { id: string; title: string }[]
          ).find((conversation) => conversation.id === id)?.title,
        conversationId
      )
    )
    .toBe('Project notes');

  await panel.reload();
  await expect(panel.locator('.app-title')).toHaveText('Project notes');
  await panel.close();
  await fixture.close();
});

test('Settings shortcut renders a gear icon', async ({ browserContext, extensionId }) => {
  const { fixture, panel } = await openPanelOnFixture(browserContext, extensionId);
  const settingsIcon = panel.getByRole('button', { name: 'Settings' }).locator('svg');
  await expect(settingsIcon).toBeVisible();
  await expect(settingsIcon.locator('circle')).toHaveCount(1);
  await panel.close();
  await fixture.close();
});

test('history drawer does not duplicate the New chat action', async ({
  browserContext,
  extensionId
}) => {
  const { fixture, panel } = await openPanelOnFixture(browserContext, extensionId);
  await panel.click('#convDrawerBtn');
  await expect(panel.locator('#convBackdrop')).toBeVisible();
  await expect(panel.getByRole('heading', { name: 'History' })).toBeVisible();
  await expect(panel.locator('#convDrawer #newChatBtn')).toHaveCount(0);
  await panel.close();
  await fixture.close();
});

test('panel does not scroll horizontally at side-panel width', async ({
  browserContext,
  extensionId
}) => {
  const panel = await browserContext.newPage();
  await panel.setViewportSize({ width: 320, height: 720 });
  await panel.goto(`chrome-extension://${extensionId}/src/panel.html`);
  expect(await horizontalOverflow(panel)).toEqual({ page: 0, scrollers: [] });
  await panel.locator('#convDrawerBtn').hover();
  expect(await horizontalOverflow(panel)).toEqual({ page: 0, scrollers: [] });
  await panel.locator('#quickNewChatBtn').hover();
  expect(await horizontalOverflow(panel)).toEqual({ page: 0, scrollers: [] });
  await panel.locator('#convDrawerBtn').click();
  await panel.locator('#convDrawerClose').hover();
  expect(await horizontalOverflow(panel)).toEqual({ page: 0, scrollers: [] });
  const logOverflowX = await panel
    .locator('#log')
    .evaluate((element) => getComputedStyle(element).overflowX);
  expect(logOverflowX).toBe('hidden');
  await panel.close();
});

test('long assistant output settles promptly and remains vertically scrollable', async ({
  browserContext,
  extensionId
}) => {
  await seedLongAssistantConversation(browserContext, extensionId, 'long-scroll-output');
  const panel = await browserContext.newPage();
  await panel.setViewportSize({ width: 320, height: 720 });
  await panel.goto(`chrome-extension://${extensionId}/src/panel.html`);
  await expect(panel.locator('#log .msg.assistant')).toBeVisible();

  const viewport = panel.locator('#log > div');
  const overflow = async () =>
    viewport.evaluate((element) => ({
      remaining: element.scrollHeight - element.clientHeight - element.scrollTop,
      scrollHeight: element.scrollHeight,
      clientHeight: element.clientHeight
    }));
  expect((await overflow()).scrollHeight).toBeGreaterThan((await overflow()).clientHeight);
  await expect.poll(async () => (await overflow()).remaining, { timeout: 500 }).toBeLessThanOrEqual(1);

  const before = await viewport.evaluate((element) => element.scrollTop);
  await viewport.hover();
  await panel.mouse.wheel(0, -600);
  await expect.poll(async () => viewport.evaluate((element) => element.scrollTop)).toBeLessThan(before);
  await panel.close();
});

test('conversation scrollbar is visible only while the viewport is scrolling', async ({
  browserContext,
  extensionId
}) => {
  await seedLongAssistantConversation(browserContext, extensionId, 'transient-scrollbar');
  const panel = await browserContext.newPage();
  await panel.setViewportSize({ width: 320, height: 720 });
  await panel.goto(`chrome-extension://${extensionId}/src/panel.html`);
  await expect(panel.locator('#log .msg.assistant')).toBeVisible();

  const viewport = panel.locator('#log > div');
  await expect(viewport).toHaveClass(/conversation-scroll/);
  const scrollbarState = () =>
    viewport.evaluate((element) => {
      const log = element.parentElement!;
      const horizontal = getComputedStyle(log, '::before');
      const vertical = getComputedStyle(log, '::after');
      return {
        verticalActive: element.classList.contains('is-scrolling-y'),
        horizontalVisible: horizontal.content !== 'none' && horizontal.opacity !== '0',
        verticalVisible: vertical.content !== 'none' && vertical.opacity !== '0'
      };
    });
  await expect.poll(scrollbarState, { timeout: 2_000 }).toEqual({
    verticalActive: false,
    horizontalVisible: false,
    verticalVisible: false
  });

  await viewport.hover();
  await panel.mouse.wheel(0, -300);
  await expect.poll(scrollbarState).toEqual({
    verticalActive: true,
    horizontalVisible: false,
    verticalVisible: true
  });
  await expect.poll(scrollbarState, { timeout: 2_000 }).toEqual({
    verticalActive: false,
    horizontalVisible: false,
    verticalVisible: false
  });
  await panel.close();
});

test('horizontal conversation scrollbar appears only during horizontal scrolling', async ({
  browserContext,
  extensionId
}) => {
  await seedLongAssistantConversation(browserContext, extensionId, 'horizontal-scrollbar');
  const panel = await browserContext.newPage();
  await panel.setViewportSize({ width: 320, height: 720 });
  await panel.goto(`chrome-extension://${extensionId}/src/panel.html`);
  await expect(panel.locator('#log .msg.assistant')).toBeVisible();

  const viewport = panel.locator('#log > div');
  await viewport.evaluate((element) => {
    (element.firstElementChild as HTMLElement).style.minWidth = '900px';
  });
  await expect
    .poll(() => viewport.evaluate((element) => element.scrollWidth > element.clientWidth))
    .toBe(true);

  const axisState = () =>
    viewport.evaluate((element) => {
      const log = element.parentElement!;
      const horizontal = getComputedStyle(log, '::before');
      const vertical = getComputedStyle(log, '::after');
      return {
        horizontalActive: element.classList.contains('is-scrolling-x'),
        horizontalVisible: horizontal.content !== 'none' && horizontal.opacity !== '0',
        verticalVisible: vertical.content !== 'none' && vertical.opacity !== '0'
      };
    });
  await expect.poll(axisState, { timeout: 2_000 }).toEqual({
    horizontalActive: false,
    horizontalVisible: false,
    verticalVisible: false
  });

  const before = await viewport.evaluate((element) => element.scrollLeft);
  await viewport.hover();
  await panel.mouse.wheel(300, 0);
  await expect.poll(() => viewport.evaluate((element) => element.scrollLeft)).toBeGreaterThan(before);
  await expect.poll(axisState).toEqual({
    horizontalActive: true,
    horizontalVisible: true,
    verticalVisible: false
  });
  await expect.poll(axisState, { timeout: 2_000 }).toEqual({
    horizontalActive: false,
    horizontalVisible: false,
    verticalVisible: false
  });
  await panel.close();
});

test('horizontal and vertical conversation scrollbars share style and thickness', async ({
  browserContext,
  extensionId
}) => {
  const panel = await browserContext.newPage();
  await panel.setViewportSize({ width: 320, height: 720 });
  await panel.goto(`chrome-extension://${extensionId}/src/panel.html`);
  const style = await panel.locator('#log > div').evaluate((viewport) => {
    const log = viewport.parentElement!;
    const nativeScrollbar = getComputedStyle(viewport, '::-webkit-scrollbar');
    const horizontal = getComputedStyle(log, '::before');
    const vertical = getComputedStyle(log, '::after');
    return {
      nativeHorizontalThickness: nativeScrollbar.height,
      nativeVerticalThickness: nativeScrollbar.width,
      fallbackHorizontalThickness: horizontal.height,
      fallbackVerticalThickness: vertical.width,
      horizontalColor: horizontal.backgroundColor,
      verticalColor: vertical.backgroundColor,
      horizontalRadius: horizontal.borderRadius,
      verticalRadius: vertical.borderRadius,
      horizontalPointerEvents: horizontal.pointerEvents,
      verticalPointerEvents: vertical.pointerEvents
    };
  });

  expect(Number.parseFloat(style.nativeHorizontalThickness)).toBeGreaterThan(0);
  expect(style.nativeHorizontalThickness).toBe(style.nativeVerticalThickness);
  expect(Number.parseFloat(style.fallbackHorizontalThickness)).toBeGreaterThan(0);
  expect(style.fallbackHorizontalThickness).toBe(style.fallbackVerticalThickness);
  expect(style.horizontalColor).toBe(style.verticalColor);
  expect(style.horizontalRadius).toBe(style.verticalRadius);
  expect(style.horizontalPointerEvents).toBe('none');
  expect(style.verticalPointerEvents).toBe('none');
  await panel.close();
});

test('Tool output horizontal scrollbar matches the thin conversation scrollbar', async ({
  browserContext,
  extensionId
}) => {
  await seedToolErrorConversation(browserContext, extensionId, 'thin-tool-scrollbar');
  const panel = await browserContext.newPage();
  await panel.setViewportSize({ width: 320, height: 720 });
  await panel.goto(`chrome-extension://${extensionId}/src/panel.html`);

  const card = panel.locator('#log details', { hasText: 'get_page_overview' });
  const output = card.locator('pre');
  await expect(output).toBeVisible();
  await expect
    .poll(() => output.evaluate((element) => element.scrollWidth > element.clientWidth))
    .toBe(true);

  const styles = await panel.evaluate(() => {
    const conversation = document.querySelector<HTMLElement>('#log > div')!;
    const toolOutput = document.querySelector<HTMLElement>('#log details pre')!;
    const conversationBar = getComputedStyle(conversation, '::-webkit-scrollbar');
    const conversationThumb = getComputedStyle(conversation, '::-webkit-scrollbar-thumb');
    const toolBar = getComputedStyle(toolOutput, '::-webkit-scrollbar');
    const toolThumb = getComputedStyle(toolOutput, '::-webkit-scrollbar-thumb');
    return {
      conversationHeight: conversationBar.height,
      toolHeight: toolBar.height,
      conversationThumbBorderTop: conversationThumb.borderTopWidth,
      toolThumbBorderTop: toolThumb.borderTopWidth,
      conversationThumbBorderBottom: conversationThumb.borderBottomWidth,
      toolThumbBorderBottom: toolThumb.borderBottomWidth,
      conversationThumbRadius: conversationThumb.borderRadius,
      toolThumbRadius: toolThumb.borderRadius
    };
  });

  expect(Number.parseFloat(styles.conversationHeight)).toBeGreaterThan(0);
  expect(styles.toolHeight).toBe(styles.conversationHeight);
  expect(styles.toolThumbBorderTop).toBe(styles.conversationThumbBorderTop);
  expect(styles.toolThumbBorderBottom).toBe(styles.conversationThumbBorderBottom);
  expect(styles.toolThumbRadius).toBe(styles.conversationThumbRadius);
  await panel.close();
});

test('Tool output horizontal scrollbar is visible only while that output scrolls', async ({
  browserContext,
  extensionId
}) => {
  await seedToolErrorConversation(browserContext, extensionId, 'transient-tool-scrollbar');
  const panel = await browserContext.newPage();
  await panel.setViewportSize({ width: 320, height: 720 });
  await panel.goto(`chrome-extension://${extensionId}/src/panel.html`);

  const output = panel.locator('#log details', { hasText: 'get_page_overview' }).locator('pre');
  await expect(output).toBeVisible();
  const thumbColor = () =>
    output.evaluate(
      (element) => getComputedStyle(element, '::-webkit-scrollbar-thumb').backgroundColor
    );
  const idleColor = await thumbColor();
  expect(idleColor).toBe('rgba(0, 0, 0, 0)');

  const before = await output.evaluate((element) => element.scrollLeft);
  await output.hover();
  await panel.mouse.wheel(300, 0);
  await expect.poll(() => output.evaluate((element) => element.scrollLeft)).toBeGreaterThan(before);
  await expect.poll(async () => (await thumbColor()) !== idleColor).toBe(true);
  await expect.poll(thumbColor, { timeout: 2_000 }).toBe(idleColor);
  await panel.close();
});

test('composer hides the native textarea resize affordance', async ({
  browserContext,
  extensionId
}) => {
  const panel = await browserContext.newPage();
  await panel.goto(`chrome-extension://${extensionId}/src/panel.html`);
  const input = panel.getByRole('textbox');
  await expect(input).toHaveCSS('resize', 'none');
  await expect(input).toHaveCSS('max-height', '400px');
  await panel.close();
});

test('composer grows upward from its top handle and clamps at 400px', async ({
  browserContext,
  extensionId
}) => {
  const panel = await browserContext.newPage();
  await panel.setViewportSize({ width: 360, height: 640 });
  await panel.goto(`chrome-extension://${extensionId}/src/panel.html`);

  const input = panel.getByRole('textbox');
  const handle = panel.getByRole('separator', { name: 'Resize message input' });
  await expect(handle).toBeVisible();
  const initialInput = await input.boundingBox();
  const initialHandle = await handle.boundingBox();
  expect(initialInput).not.toBeNull();
  expect(initialHandle).not.toBeNull();

  await panel.mouse.move(
    initialHandle!.x + initialHandle!.width / 2,
    initialHandle!.y + initialHandle!.height / 2
  );
  await panel.mouse.down();
  await panel.mouse.move(
    initialHandle!.x + initialHandle!.width / 2,
    initialHandle!.y - 600,
    { steps: 10 }
  );
  await panel.mouse.up();

  await expect
    .poll(async () => Math.round((await input.boundingBox())?.height ?? 0))
    .toBe(400);
  const enlargedInput = await input.boundingBox();
  expect(enlargedInput).not.toBeNull();
  expect(enlargedInput!.y).toBeLessThan(initialInput!.y);
  expect(enlargedInput!.y + enlargedInput!.height).toBeCloseTo(
    initialInput!.y + initialInput!.height,
    0
  );
  await expect(handle).toHaveAttribute('aria-valuenow', '400');
  await expect(panel.getByRole('button', { name: 'Send' })).toBeVisible();
  expect(await horizontalOverflow(panel)).toEqual({ page: 0, scrollers: [] });

  const enlargedHandle = await handle.boundingBox();
  expect(enlargedHandle).not.toBeNull();
  await panel.mouse.move(
    enlargedHandle!.x + enlargedHandle!.width / 2,
    enlargedHandle!.y + enlargedHandle!.height / 2
  );
  await panel.mouse.down();
  await panel.mouse.move(
    enlargedHandle!.x + enlargedHandle!.width / 2,
    enlargedHandle!.y + 600,
    { steps: 10 }
  );
  await panel.mouse.up();

  await expect
    .poll(async () => Math.round((await input.boundingBox())?.height ?? 0))
    .toBe(Math.round(initialInput!.height));

  await handle.focus();
  await handle.press('End');
  await expect
    .poll(async () => Math.round((await input.boundingBox())?.height ?? 0))
    .toBe(400);
  await handle.press('Home');
  await expect
    .poll(async () => Math.round((await input.boundingBox())?.height ?? 0))
    .toBe(Math.round(initialInput!.height));
  await panel.close();
});

test('long user messages expand past 400px and collapse again', async ({
  browserContext,
  extensionId
}) => {
  const storagePage = await browserContext.newPage();
  await storagePage.goto(`chrome-extension://${extensionId}/src/options.html`);
  await storagePage.evaluate(async () => {
    const now = Date.now();
    await chrome.storage.local.set({
      hibroConversations: [
        {
          id: 'long-user-message',
          title: 'Long user message',
          createdAt: now,
          updatedAt: now,
          messages: [
            {
              id: 'long-user-message-content',
              role: 'user',
              parts: [
                {
                  type: 'text',
                  text: Array.from({ length: 80 }, (_, index) => `Line ${index + 1}`).join('\n')
                }
              ]
            }
          ]
        }
      ],
      activeConversationId: 'long-user-message'
    });
  });
  await storagePage.close();

  const panel = await browserContext.newPage();
  await panel.setViewportSize({ width: 320, height: 720 });
  await panel.goto(`chrome-extension://${extensionId}/src/panel.html`);
  const content = panel.locator('.user-message-content');
  const toggle = panel.getByRole('button', { name: 'Show more' });
  await expect(toggle).toBeVisible();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect
    .poll(async () => Math.round((await content.boundingBox())?.height ?? 0))
    .toBe(400);

  await toggle.click();
  await expect(panel.getByRole('button', { name: 'Show less' })).toHaveAttribute(
    'aria-expanded',
    'true'
  );
  expect(Math.round((await content.boundingBox())?.height ?? 0)).toBeGreaterThan(400);

  await panel.evaluate(async () => {
    await chrome.storage.local.set({ hibroOptions: { language: 'zh-CN' } });
  });
  const localizedToggle = panel.getByRole('button', { name: '收起' });
  await expect(localizedToggle).toBeVisible();
  await localizedToggle.click();
  await expect(panel.getByRole('button', { name: '展开' })).toHaveAttribute(
    'aria-expanded',
    'false'
  );
  await expect
    .poll(async () => Math.round((await content.boundingBox())?.height ?? 0))
    .toBe(400);
  await panel.close();
});

test('New chat tooltip is layered above conversation messages', async ({
  browserContext,
  extensionId
}) => {
  const storagePage = await browserContext.newPage();
  await storagePage.goto(`chrome-extension://${extensionId}/src/options.html`);
  await storagePage.evaluate(async () => {
    const now = Date.now();
    await chrome.storage.local.set({
      hibroConversations: [
        {
          id: 'tooltip-stacking',
          title: 'A conversation with visible content',
          createdAt: now,
          updatedAt: now,
          messages: [
            {
              id: 'tooltip-stacking-message',
              role: 'user',
              parts: [{ type: 'text', text: 'A conversation with visible content' }]
            }
          ]
        }
      ],
      activeConversationId: 'tooltip-stacking'
    });
  });
  await storagePage.close();

  const panel = await browserContext.newPage();
  await panel.goto(`chrome-extension://${extensionId}/src/panel.html`);
  await expect(panel.locator('#log .msg.user')).toBeVisible();
  await panel.locator('#quickNewChatBtn').hover();

  const stacking = await panel.locator('#quickNewChatBtn').evaluate((button) => {
    const appBar = button.closest('.app-bar');
    const log = document.querySelector('#log');
    const numericZIndex = (element: Element | null): number => {
      if (!element) return 0;
      const value = Number.parseInt(getComputedStyle(element).zIndex, 10);
      return Number.isNaN(value) ? 0 : value;
    };
    return {
      tooltipOpacity: getComputedStyle(button, '::after').opacity,
      appBarZIndex: numericZIndex(appBar),
      logZIndex: numericZIndex(log)
    };
  });
  expect(stacking.tooltipOpacity).toBe('1');
  expect(stacking.appBarZIndex, JSON.stringify(stacking)).toBeGreaterThan(
    stacking.logZIndex
  );
  await panel.close();
});

test('top bar New chat shortcut starts a fresh conversation', async ({
  browserContext,
  extensionId
}) => {
  const { fixture, panel } = await openPanelOnFixture(browserContext, extensionId);
  const originalId = 'quick-new-chat-source';
  await panel.evaluate(async (id) => {
    const now = Date.now();
    await chrome.storage.local.set({
      hibroConversations: [
        {
          id,
          title: 'Keep this conversation in history',
          createdAt: now,
          updatedAt: now,
          messages: [
            {
              id: 'quick-new-chat-message',
              role: 'user',
              parts: [{ type: 'text', text: 'Keep this conversation in history' }]
            }
          ]
        }
      ],
      activeConversationId: id
    });
  }, originalId);
  await panel.reload();
  await expect(panel.locator('#log .msg.user')).toContainText('Keep this conversation in history');

  const quickNewChat = panel.getByRole('button', { name: 'New chat' });
  await expect(quickNewChat).toBeVisible();
  await expect(quickNewChat.locator('svg')).toBeVisible();
  const tooltipPosition = await quickNewChat.evaluate((button) => {
    const style = getComputedStyle(button, '::after');
    return { right: style.right, transform: style.transform };
  });
  expect(tooltipPosition.right).toBe('0px');
  expect(tooltipPosition.transform).toBe('none');

  const appBar = await panel.locator('.app-bar').boundingBox();
  const shortcut = await quickNewChat.boundingBox();
  expect(appBar).not.toBeNull();
  expect(shortcut).not.toBeNull();
  expect(shortcut!.x + shortcut!.width / 2).toBeGreaterThan(appBar!.x + appBar!.width / 2);

  await quickNewChat.click();
  await expect(panel.locator('#log')).toContainText('Ask about this page');
  await expect(panel.locator('#log .msg')).toHaveCount(0);
  await expect
    .poll(
      async () =>
        (await panel.evaluate(
          async () => (await chrome.storage.local.get('activeConversationId')).activeConversationId
        )) as string
    )
    .not.toBe(originalId);

  await panel.click('#convDrawerBtn');
  await expect(panel.locator('#convDrawer [role="listitem"]')).toHaveCount(1);
  await panel.close();
  await fixture.close();
});

test('drawer can delete conversations, including the active one', async ({
  browserContext,
  extensionId
}) => {
  const { fixture, panel } = await openPanelOnFixture(browserContext, extensionId);

  // Conversation A.
  await panel.fill('#input', 'First question about apples');
  await panel.click('#sendBtn');
  await expect(panel.locator('#log .msg.assistant').last()).toContainText('streaming mock answer', {
    timeout: 30_000
  });
  await expect(panel.locator('#sendBtn')).toBeVisible();

  // Conversation B (New chat + send) becomes the active thread.
  await panel.click('#quickNewChatBtn');
  await expect(panel.locator('#log')).toContainText('Ask about this page');
  await panel.fill('#input', 'Second question about bananas');
  await panel.click('#sendBtn');
  await expect(panel.locator('#log .msg.assistant').last()).toContainText('streaming mock answer', {
    timeout: 30_000
  });
  await expect(panel.locator('#sendBtn')).toBeVisible();

  // The drawer lists both; B (active) is the first row.
  await panel.click('#convDrawerBtn');
  await expect(panel.locator('#convBackdrop')).toBeVisible();
  await expect(panel.locator('#convDrawer .conv-row')).toHaveCount(2);

  // Delete the active conversation (B). With one remaining, the panel falls
  // back to the most recent conversation (A).
  await panel.locator('#convDrawer .conv-del').first().click();
  await expect(panel.locator('#log .msg.user').last()).toContainText('First question about apples', {
    timeout: 10_000
  });
  await expect(panel.locator('#convDrawer .conv-row')).toHaveCount(1);

  // Delete the now-active A too: nothing remains → a fresh empty chat.
  await panel.locator('#convDrawer .conv-del').first().click();
  await expect(panel.locator('#log')).toContainText('Ask about this page');
  await expect(panel.locator('#convDrawer .conv-row')).toHaveCount(0);
  const stored = await panel.evaluate(
    async () => (await chrome.storage.local.get('hibroConversations')).hibroConversations
  );
  expect(stored ?? []).toHaveLength(0);

  await panel.close();
  await fixture.close();
});

// Switching conversations mid-run must abort the in-flight stream first, so the
// old run's deltas can't be folded onto the newly-active thread (and persisted).
test('switching conversations during a run does not leak the old run', async ({
  browserContext,
  extensionId
}) => {
  const { fixture, panel } = await openPanelOnFixture(browserContext, extensionId);

  // Seed conversation A so the drawer has a switch target.
  await panel.fill('#input', 'First about apples');
  await panel.click('#sendBtn');
  await expect(panel.locator('#log .msg.assistant').last()).toContainText('streaming mock answer', {
    timeout: 30_000
  });
  await expect(panel.locator('#sendBtn')).toBeVisible();

  // Start a new chat and a long task run.
  await panel.click('#quickNewChatBtn');
  mock.setAgentScript([
    { name: 'get_page_overview', args: {} },
    { name: 'get_page_overview', args: {} },
    { name: 'get_page_overview', args: {} },
    { name: 'get_page_overview', args: {} }
  ]);
  try {
    await panel.fill('#input', 'Long task that keeps calling tools');
    await panel.click('#sendBtn');
    await expect(panel.locator('#sendBtn')).toBeHidden(); // run is in flight

    // Switch back to conversation A while the run is still executing. The
    // transition aborts the run, so the target must not receive its deltas.
    await panel.click('#convDrawerBtn');
    await expect(panel.locator('#convBackdrop')).toBeVisible();
    await panel.locator('#convDrawer .conv-row-main').first().click();

    const lastA = panel.locator('#log .msg.assistant').last();
    await expect(lastA).toContainText('streaming mock answer');
    await expect(lastA).not.toContainText('Task finished.');
    // No tool cards from the aborted run leaked into conversation A (tool
    // cards are native <details> elements).
    await expect(panel.locator('#log details')).toHaveCount(0);
  } finally {
    mock.setAgentScript([]);
    await panel.close();
    await fixture.close();
  }
});

test('the model is not given an arbitrary JavaScript execution tool', async ({
  browserContext,
  extensionId
}) => {
  const { fixture, panel } = await openPanelOnFixture(browserContext, extensionId);
  try {
    await panel.fill('#input', 'List the tools available for this request');
    await panel.click('#sendBtn');
    await expect(panel.locator('#sendBtn')).toBeVisible({ timeout: 30_000 });
    expect(mock.toolNames.at(-1)).not.toContain('evaluate');
  } finally {
    await panel.close();
    await fixture.close();
  }
});
