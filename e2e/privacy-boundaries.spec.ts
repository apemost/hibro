// Exercises privacy boundaries in the built extension without provider traffic.
import type { BrowserContext, Page, Request } from '@playwright/test';
import { test, expect } from './fixtures';

test('page perception omits password values while preserving ordinary controls', async ({
  browserContext,
  extensionId,
}) => {
  const fixtureUrl = 'https://privacy-fixture.example.org/profile';
  await browserContext.route(fixtureUrl, (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><title>Profile</title><main>
        <label>Username <input name="username" value="ordinary-user"></label>
        <label>Password <input type="password" name="password" value="markup-password-secret"></label>
        <button>Save profile</button>
      </main>`,
    }),
  );
  const control = await browserContext.newPage();
  const fixture = await browserContext.newPage();
  try {
    await control.goto(`chrome-extension://${extensionId}/src/options.html`);
    await fixture.goto(fixtureUrl);
    await fixture.getByLabel('Password').fill('live-password-secret');
    await expect
      .poll(() =>
        control.evaluate(async (url) => {
          const [tab] = await chrome.tabs.query({ url });
          if (!tab?.id) return false;
          return chrome.tabs
            .sendMessage(tab.id, { type: 'hibro:overview' })
            .then(
              () => true,
              () => false,
            );
        }, fixtureUrl),
      )
      .toBe(true);

    const outputs = await control.evaluate(async (url) => {
      const [tab] = await chrome.tabs.query({ url });
      const list = await chrome.tabs.sendMessage(tab.id!, {
        type: 'hibro:elements',
      });
      const details = await Promise.all(
        list.elements.map((element: { id: number }) =>
          chrome.tabs.sendMessage(tab.id!, {
            type: 'hibro:element-detail',
            id: element.id,
          }),
        ),
      );
      const snapshot = await chrome.tabs.sendMessage(tab.id!, {
        type: 'hibro:snapshot',
      });
      return { list, details, snapshot };
    }, fixtureUrl);

    for (const [kind, output] of Object.entries(outputs)) {
      expect
        .soft(JSON.stringify(output), kind)
        .not.toContain('live-password-secret');
      expect
        .soft(JSON.stringify(output), kind)
        .not.toContain('markup-password-secret');
    }
    const password = outputs.list.elements.find(
      (element: { name: string }) => element.name === 'password',
    );
    expect(password.id).toEqual(expect.any(Number));
    expect(
      outputs.details.find(
        (detail: { id: number }) => detail.id === password.id,
      ),
    ).toMatchObject({
      tag: 'input',
      attrs: { type: 'password', name: 'password' },
    });
    expect(
      outputs.details.find(
        (detail: { attrs: { name?: string } }) =>
          detail.attrs.name === 'username',
      ),
    ).toMatchObject({
      value: 'ordinary-user',
      attrs: { value: 'ordinary-user' },
    });
    await expect(fixture.getByLabel('Password')).toHaveValue(
      'live-password-secret',
    );
    await expect(fixture.getByLabel('Password')).toHaveAttribute(
      'value',
      'markup-password-secret',
    );
  } finally {
    await fixture.close();
    await control.close();
    await browserContext.unroute(fixtureUrl);
  }
});

/** Opens real persisted Markdown in the panel and restores the isolated test storage. */
async function withHtmlPreview(
  context: BrowserContext,
  extensionId: string,
  html: string,
  check: (panel: Page) => Promise<void>,
) {
  const control = await context.newPage();
  const panel = await context.newPage();
  const requests: Request[] = [];
  const dispatched: string[] = [];
  const pattern = 'https://preview-fixture.invalid/**';
  const onRequest = (request: Request) => {
    if (request.url().startsWith('https://preview-fixture.invalid/')) {
      requests.push(request);
    }
  };
  const keys = ['hibroConversations', 'activeConversationId', 'hibroOptions'];
  await control.goto(`chrome-extension://${extensionId}/src/options.html`);
  const previous = await control.evaluate(
    (names) => chrome.storage.local.get(names),
    keys,
  );
  context.on('request', onRequest);
  await context.route(pattern, (route) => {
    dispatched.push(route.request().url());
    return route.abort();
  });
  try {
    await control.evaluate(async (markup) => {
      const now = Date.now();
      await chrome.storage.local.set({
        hibroOptions: { language: 'en' },
        hibroConversations: [
          {
            id: 'privacy-preview',
            title: 'Privacy preview',
            createdAt: now,
            updatedAt: now,
            messages: [
              {
                id: 'preview-answer',
                role: 'assistant',
                parts: [
                  { type: 'text', text: `\`\`\`html\n${markup}\n\`\`\`` },
                ],
              },
            ],
          },
        ],
        activeConversationId: 'privacy-preview',
      });
    }, html);
    await panel.goto(`chrome-extension://${extensionId}/src/panel.html`);
    await panel.getByRole('button', { name: 'Preview', exact: true }).click();
    await check(panel);
    expect(dispatched).toEqual([]);
    // Chromium may report a CSS image request even when CSP stops it before
    // dispatch. Every observed request must be blocked by CSP, not our route.
    for (const request of requests) {
      await expect
        .poll(() => request.failure()?.errorText, { message: request.url() })
        .toBe('csp');
    }
  } finally {
    await panel.close();
    await control.evaluate(
      async ({ names, values }) => {
        await chrome.storage.local.remove(names);
        await chrome.storage.local.set(values);
      },
      { names: keys, values: previous },
    );
    await control.close();
    context.off('request', onRequest);
    await context.unroute(pattern);
  }
}

for (const [kind, link] of [
  [
    'HTML',
    '<a href="https://preview-fixture.invalid/html" target="_self">Navigation label</a>',
  ],
  [
    'SVG',
    '<svg width="220" height="40" xmlns:xlink="http://www.w3.org/1999/xlink"><a xlink:href="https://preview-fixture.invalid/svg" target="_self"><text x="0" y="24">Navigation label</text></a></svg>',
  ],
]) {
  test(`static HTML previews keep ${kind} link text readable without navigating`, async ({
    browserContext,
    extensionId,
  }) => {
    await withHtmlPreview(
      browserContext,
      extensionId,
      `<h1>Readable preview</h1><p>Selectable content</p>${link}`,
      async (panel) => {
        const preview = panel.frameLocator('iframe.html-preview');
        await expect(
          preview.getByRole('heading', { name: 'Readable preview' }),
        ).toBeVisible();
        await preview.getByText('Navigation label', { exact: true }).click();
        await expect(
          preview.getByRole('heading', { name: 'Readable preview' }),
        ).toBeVisible();
        const selection = await preview.locator('p').evaluate((paragraph) => {
          const range = document.createRange();
          range.selectNodeContents(paragraph);
          const selected = window.getSelection()!;
          selected.removeAllRanges();
          selected.addRange(range);
          return selected.toString();
        });
        expect(selection).toBe('Selectable content');
        await panel.getByRole('button', { name: 'Code', exact: true }).click();
        await expect(panel.locator('.html-code')).toContainText(link);
      },
    );
  });
}

test('static HTML previews block automatic and nested navigation while preserving styles and data images', async ({
  browserContext,
  extensionId,
}) => {
  await withHtmlPreview(
    browserContext,
    extensionId,
    `
    <meta http-equiv="refresh" content="0;url=https://preview-fixture.invalid/refresh">
    <base href="https://preview-fixture.invalid/" target="_self">
    <link rel="stylesheet" href="https://preview-fixture.invalid/stylesheet.css">
    <style>
      @import url("https://preview-fixture.invalid/import.css");
      h1 { color: rgb(12, 34, 56); background-image: url("https://preview-fixture.invalid/background.png"); }
    </style>
    <h1>Readable preview</h1>
    <img alt="Embedded pixel" src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=">
    <img alt="Remote image" src="https://preview-fixture.invalid/image.png">
    <iframe src="https://preview-fixture.invalid/frame"></iframe>
    <iframe srcdoc="<meta http-equiv='refresh' content='0;url=https://preview-fixture.invalid/nested'>"></iframe>
    <object data="https://preview-fixture.invalid/object"></object>
    <svg width="220" height="40"><a id="animated-link"><text x="0" y="24">Animated label</text><set attributeName="href" to="https://preview-fixture.invalid/animated" /></a></svg>
    <template><iframe src="https://preview-fixture.invalid/template"></iframe></template>
  `,
    async (panel) => {
      const preview = panel.frameLocator('iframe.html-preview');
      await expect(
        preview.getByRole('heading', { name: 'Readable preview' }),
      ).toHaveCSS('color', 'rgb(12, 34, 56)');
      await expect(
        preview.getByRole('img', { name: 'Embedded pixel' }),
      ).toBeVisible();
      await expect(
        preview.locator('meta[http-equiv="Content-Security-Policy"]'),
      ).toHaveCount(1);
      await expect(
        preview.locator(
          'base, meta[http-equiv="refresh" i], iframe, frame, frameset, object, embed, template, animate, animateMotion, animateTransform, set',
        ),
      ).toHaveCount(0);
      await expect(
        preview.locator(
          '[href], [xlink\\:href], [action], [formaction], [srcdoc]',
        ),
      ).toHaveCount(0);
      await preview.getByText('Animated label', { exact: true }).click();
      await expect(
        preview.getByRole('heading', { name: 'Readable preview' }),
      ).toBeVisible();
      await expect
        .poll(() =>
          preview
            .locator('body')
            .evaluate((body) => body.ownerDocument.readyState),
        )
        .toBe('complete');
      // Schedule on the parent: script callbacks are disabled in the preview.
      // Cross a rendering boundary to observe requests from parsing or layout.
      await panel.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      );
    },
  );
});
