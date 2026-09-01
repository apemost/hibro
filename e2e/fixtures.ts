// Playwright fixtures for extension e2e: a worker-scoped persistent browser
// context with the built extension loaded, plus the extension ID derived
// from the fixed "key" in manifest.json (no need to wait for the service
// worker, which may stay dormant until first use).
import { test as base, chromium, type BrowserContext } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(dirname, '..', 'dist');

// Chrome derives the extension ID from the manifest key: SHA-256 of the
// DER public key, first 16 bytes, each nibble mapped to a-p.
function extensionIdFromKey(key: string): string {
  const der = Buffer.from(key, 'base64');
  const hash = createHash('sha256').update(der).digest();
  return [...hash.subarray(0, 16)]
    .map(
      (b) =>
        String.fromCharCode(97 + (b >> 4)) + String.fromCharCode(97 + (b & 15)),
    )
    .join('');
}

const manifest = JSON.parse(
  readFileSync(path.join(dist, 'manifest.json'), 'utf8'),
);
if (!manifest.key) throw new Error('dist/manifest.json is missing "key"');
const extensionId = extensionIdFromKey(manifest.key);

export const test = base.extend<
  object,
  { browserContext: BrowserContext; extensionId: string }
>({
  browserContext: [
    async ({}, use) => {
      const context = await chromium.launchPersistentContext('', {
        // channel 'chromium' = full Chromium build in new headless mode.
        // (Playwright's default headless shell cannot navigate extension URLs.)
        channel: 'chromium',
        // Playwright's default --disable-extensions kills even the one we
        // load explicitly; re-enable extensions for extension testing.
        ignoreDefaultArgs: ['--disable-extensions'],
        args: [
          `--disable-extensions-except=${dist}`,
          `--load-extension=${dist}`,
        ],
      });
      // Extension registration is asynchronous; navigating to an extension
      // URL too early fails with ERR_BLOCKED_BY_CLIENT. Poll until ready.
      const probe = await context.newPage();
      for (let i = 0; i < 50; i++) {
        try {
          const resp = await probe.goto(
            `chrome-extension://${extensionId}/manifest.json`,
          );
          if (resp && resp.ok) break;
        } catch {
          await new Promise((r) => setTimeout(r, 200));
        }
      }
      await probe.close();
      await use(context);
      await context.close();
    },
    { scope: 'worker' },
  ],
  extensionId: [
    async ({}, use) => {
      await use(extensionId);
    },
    { scope: 'worker' },
  ],
});

export const expect = test.expect;
