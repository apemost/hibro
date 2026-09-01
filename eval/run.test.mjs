import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('missing credential guidance includes the compatible provider base URL requirement', () => {
  const run = spawnSync(process.execPath, ['eval/run.mjs'], {
    cwd: ROOT,
    encoding: 'utf8',
    env: {
      ...process.env,
      HIBRO_EVAL_PROVIDER: 'openai-compatible',
      HIBRO_EVAL_API_KEY: '',
      HIBRO_EVAL_MODEL: 'test-model',
      HIBRO_EVAL_BASE_URL: '',
      PLAYWRIGHT_BROWSERS_PATH: path.join(
        ROOT,
        '.local',
        'tmp',
        'missing-browsers',
      ),
    },
  });

  const output = `${run.stdout}${run.stderr}`;
  assert.equal(run.status, 2, output);
  assert.match(output, /HIBRO_EVAL_API_KEY is required/);
  assert.match(
    output,
    /HIBRO_EVAL_BASE_URL is also required for openai-compatible/,
  );
  assert.doesNotMatch(output, /optional[^\n]*HIBRO_EVAL_BASE_URL/i);
  assert.doesNotMatch(output, /browserType\.launchPersistentContext/);
});

test('real eval rejects an OpenAI-compatible profile without a base URL before launch', () => {
  const run = spawnSync(process.execPath, ['eval/run.mjs'], {
    cwd: ROOT,
    encoding: 'utf8',
    env: {
      ...process.env,
      HIBRO_EVAL_PROVIDER: 'openai-compatible',
      HIBRO_EVAL_API_KEY: 'test-key',
      HIBRO_EVAL_MODEL: 'test-model',
      HIBRO_EVAL_BASE_URL: '',
      PLAYWRIGHT_BROWSERS_PATH: path.join(
        ROOT,
        '.local',
        'tmp',
        'missing-browsers',
      ),
    },
  });

  const output = `${run.stdout}${run.stderr}`;
  assert.equal(run.status, 2, output);
  assert.match(output, /HIBRO_EVAL_BASE_URL is required for openai-compatible/);
  assert.doesNotMatch(output, /browserType\.launchPersistentContext/);
});
