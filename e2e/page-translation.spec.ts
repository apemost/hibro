import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { githubCodePage } from './github-code';

const target = 'Simplified Chinese';
const article = '<main><p id="source">Original article text.</p></main>';
const comments = githubCodePage('nonvirtual', [
  '<span class="pl-c">// Original comment.</span>',
  '<span class="pl-c">// Continuation of the comment.</span>',
  'return true;',
]);

for (const site of ['article', 'github'] as const) {
  test.describe(`${site} translation lifecycle`, () => {
    let page: Page;
    let control: Page;
    let tabId: number;
    const url =
      site === 'github'
        ? 'https://github.com/example/repo/blob/main/file.ts'
        : 'https://example.org/article';
    const send = (message: Record<string, unknown>) =>
      control.evaluate(
        ({ tabId, message }) => chrome.tabs.sendMessage(tabId, message),
        { tabId, message },
      );
    const collect = () => send({ type: 'hibro:translate-collect' });
    const apply = (text = '译文') =>
      send({
        type: 'hibro:translate-apply',
        target,
        language: 'zh-CN',
        items: [{ id: 1, text }],
      });

    test.beforeEach(async ({ browserContext, extensionId }) => {
      page = await browserContext.newPage();
      control = await browserContext.newPage();
      await page.route(url, (route) =>
        route.fulfill({
          contentType: 'text/html',
          body: site === 'github' ? comments : article,
        }),
      );
      await page.goto(url);
      await control.goto(`chrome-extension://${extensionId}/src/options.html`);
      tabId = await control.evaluate(
        async (url) => (await chrome.tabs.query({ url }))[0].id!,
        url,
      );
      await expect
        .poll(async () => {
          try {
            return (await collect()).blocks.length;
          } catch {
            return 0;
          }
        })
        .toBe(1);
    });

    test.afterEach(async () => {
      await page?.close();
      await control?.close();
    });

    for (const change of ['source', 'navigation'] as const) {
      test(`rejects stale results and cached translations after ${change} changes`, async () => {
        const mutate = (step: number) =>
          page.evaluate(
            ({ site, change, step }) => {
              if (change === 'navigation') {
                history.pushState({}, '', `?revision=${step}`);
              } else {
                // Change the first row, while the GitHub group ends on the second.
                document.querySelector(
                  site === 'github' ? '#LC1 .pl-c' : '#source',
                )!.textContent =
                  site === 'github'
                    ? `// Changed comment ${step}.`
                    : `Changed article ${step}.`;
              }
            },
            { site, change, step },
          );
        await mutate(1);
        expect(await apply()).toEqual({ applied: 0 });
        await expect(page.locator('[data-hibro-translation]')).toHaveCount(0);
        expect((await collect()).blocks).toHaveLength(1);
        expect(await apply()).toEqual({ applied: 1 });
        await send({ type: 'hibro:translate-revert' });
        await mutate(2);
        expect(
          (await send({ type: 'hibro:translate-restore', target })).applied,
        ).toBe(0);
        await expect(page.locator('[data-hibro-translation]')).toHaveCount(0);
      });
    }

    test('caches only the latest result for each source and restores it once', async () => {
      expect(await apply('初次译文')).toEqual({ applied: 1 });
      expect(await apply('更新译文')).toEqual({ applied: 1 });
      await expect(page.locator('[data-hibro-translation]')).toHaveCount(1);
      await send({ type: 'hibro:translate-revert' });
      expect(
        (await send({ type: 'hibro:translate-restore', target })).applied,
      ).toBe(1);
      await expect(page.locator('[data-hibro-translation]')).toHaveCount(1);
      await expect(page.locator('[data-hibro-translation]')).toContainText(
        '更新译文',
      );
      await expect(page.locator('[data-hibro-translation]')).not.toContainText(
        '初次译文',
      );
      await page.evaluate(() => {
        location.hash = 'section';
      });
      await send({ type: 'hibro:translate-revert' });
      expect(
        (await send({ type: 'hibro:translate-restore', target })).applied,
      ).toBe(1);
    });

    if (site === 'github') {
      test('reselects the adapter after navigation and does not fall back on unsupported code views', async () => {
        await apply();
        await page.evaluate(() => {
          history.pushState({}, '', '/example/repo/issues/1');
          document.body.innerHTML = '<main><p>Issue body text.</p></main>';
        });
        expect((await collect()).blocks).toEqual([
          { id: 1, text: 'Issue body text.' },
        ]);
        await apply('问题正文译文');
        await expect(page.locator('[data-hibro-translation]')).toHaveText(
          '问题正文译文',
        );
        await expect(page.locator('[data-hibro-translation]')).not.toHaveClass(
          /pl-c/,
        );
        await page.evaluate(() => {
          history.pushState({}, '', '/example/repo/blob/main/unknown.ts');
          document.body.innerHTML =
            '<main><h1>File title</h1><pre><code>unrecognized code structure</code></pre></main>';
        });
        expect((await collect()).blocks).toEqual([]);
      });
    }
  });
}
