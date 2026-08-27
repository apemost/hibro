// Real, LLM-driven evaluation of the Hibro agent against live pages (arXiv).
//
// Unlike the mock-based e2e suite (which proves mechanics), this drives the
// actual agent with a REAL function-calling model and asserts task outcomes on
// live pages: did it reach the right page, extract the right content, scroll?
//
// Usage:
//   pnpm eval                              # real run: needs HIBRO_EVAL_API_KEY etc.
//   pnpm eval -- --self-test               # keyless wiring check (scripted local "model",
//                                          # still exercises real arXiv + real CDP navigate)
//
// Env (real run):
//   HIBRO_EVAL_PROVIDER   anthropic | openai | openai-compatible   (default openai-compatible)
//   HIBRO_EVAL_API_KEY    required for a real run
//   HIBRO_EVAL_MODEL      e.g. claude-sonnet-5 / gpt-4o-mini        (provider-specific default)
//   HIBRO_EVAL_BASE_URL   required for openai-compatible; optional for other providers

import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { configureProvider } from './configure-provider.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, '.local', 'tmp', 'eval-dist');
const RUN_TIMEOUT_MS = 180_000;

// --- Task suite: real arXiv tasks with deterministic outcome checks ---
const ABS = 'https://arxiv.org/abs/1706.03762'; // Attention Is All You Need
const TASKS = [
  {
    id: 'navigate',
    url: 'https://arxiv.org/',
    prompt: 'Go to the abstract page for arXiv paper 1706.03762.',
    check: (o) => result(o.url.includes('/abs/1706.03762'), `url=${o.url}`)
  },
  {
    id: 'title',
    url: ABS,
    prompt: 'What is the exact title of this paper? Reply with only the title.',
    check: (o) => result(/attention is all you need/i.test(o.answer), `answer="${o.answer.slice(0, 120)}"`)
  },
  {
    id: 'subjects',
    url: ABS,
    prompt: 'List the arXiv subject categories this paper is classified under.',
    check: (o) =>
      result(/cs\.CL|computation and language/i.test(o.answer), `answer="${o.answer.slice(0, 120)}"`)
  },
  {
    id: 'scroll',
    url: ABS,
    prompt: 'Scroll down the page.',
    check: (o) => result(o.scrollY > 0, `scrollY=${o.scrollY}`)
  }
];

const result = (pass, detail) => ({ pass, detail });

function defaultModel(provider) {
  if (provider === 'anthropic') return 'claude-sonnet-5';
  if (provider === 'openai') return 'gpt-4o-mini';
  return 'gpt-4o-mini';
}

function realProfileFromEnv() {
  const provider = process.env.HIBRO_EVAL_PROVIDER || 'openai-compatible';
  const apiKey = process.env.HIBRO_EVAL_API_KEY;
  const baseUrl = process.env.HIBRO_EVAL_BASE_URL || '';
  if (!apiKey) {
    console.error(
      'HIBRO_EVAL_API_KEY is required for a real eval.' +
        (provider === 'openai-compatible'
          ? ' HIBRO_EVAL_BASE_URL is also required for openai-compatible providers.'
          : '') +
        '\nHIBRO_EVAL_PROVIDER and HIBRO_EVAL_MODEL are optional.\n' +
        'For a keyless harness check, run: pnpm eval -- --self-test'
    );
    process.exit(2);
  }
  if (provider === 'openai-compatible' && !baseUrl) {
    console.error(
      'HIBRO_EVAL_BASE_URL is required for openai-compatible providers. Add it to .env or export it before running pnpm eval.'
    );
    process.exit(2);
  }
  return {
    provider,
    baseUrl,
    apiKey,
    model: process.env.HIBRO_EVAL_MODEL || defaultModel(provider)
  };
}

// --- Extension loading (mirror of e2e/fixtures.ts) ---
function extensionIdFromKey(key) {
  const hash = crypto.createHash('sha256').update(Buffer.from(key, 'base64')).digest();
  let id = '';
  for (let i = 0; i < 16; i++) {
    id += String.fromCharCode('a'.charCodeAt(0) + (hash[i] >> 4));
    id += String.fromCharCode('a'.charCodeAt(0) + (hash[i] & 0xf));
  }
  return id;
}

async function launchExtension() {
  if (!fs.existsSync(path.join(DIST, 'manifest.json'))) {
    throw new Error(`Eval build not found at ${DIST}. Run "pnpm eval" to build it.`);
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(DIST, 'manifest.json'), 'utf8'));
  const extId = extensionIdFromKey(manifest.key);
  const ctx = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    ignoreDefaultArgs: ['--disable-extensions'],
    args: [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`],
    headless: false
  });
  const probe = await ctx.newPage();
  for (let i = 0; i < 50; i++) {
    try {
      const res = await probe.goto(`chrome-extension://${extId}/manifest.json`);
      if (res && res.ok()) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  await probe.close();
  return { ctx, extId };
}

// The panel restores the persisted active conversation when it opens, so a
// previous task's thread would otherwise hydrate into this task's panel and
// leak its history into the send (the e2e suite clears the same keys in
// beforeEach). Reset the conversation keys before each task for a clean slate.
async function clearConversations(ctx, extId) {
  const p = await ctx.newPage();
  await p.goto(`chrome-extension://${extId}/src/options.html`);
  await p.evaluate(async () => {
    await chrome.storage.local.remove(['hibroConversations', 'activeConversationId']);
  });
  await p.close();
}

// Drive one task through the real panel and capture the outcome.
async function runTask(ctx, extId, task) {
  const page = await ctx.newPage();
  await page.goto(task.url, { waitUntil: 'commit', timeout: 60_000 }).catch(() => {});
  await page.waitForLoadState('domcontentloaded', { timeout: 60_000 }).catch(() => {});
  await page.bringToFront();

  await clearConversations(ctx, extId);
  const panel = await ctx.newPage();
  await panel.goto(`chrome-extension://${extId}/src/panel.html`);
  // The agent acts on chrome.tabs active tab; make sure that's the target page,
  // not the panel we just opened (matches the e2e openPanelOnFixture pattern).
  await page.bringToFront();
  await panel.fill('#input', task.prompt);
  await panel.click('#sendBtn');
  await panel.waitForSelector('#stopBtn', { state: 'visible', timeout: 15_000 }).catch(() => {});
  await panel.waitForSelector('#sendBtn', { state: 'visible', timeout: RUN_TIMEOUT_MS });

  const answer = (await panel.locator('#log .msg.assistant').last().innerText().catch(() => '')).trim();
  const url = page.url();
  const scrollY = await page.evaluate(() => window.scrollY).catch(() => 0);
  await panel.close();
  await page.close();
  return { id: task.id, prompt: task.prompt, answer, url, scrollY };
}

// --- Keyless self-test: a scripted local "model" so the harness + real CDP can
// be verified without credentials. It performs the navigate task for real.
// The unified assistant loop always streams and carries tools, so the mock
// serves SSE: a navigate tool call on turn 0, the final answer afterwards.
function startSelfTestMock(targetUrl) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      if (req.method !== 'POST' || !req.url.endsWith('/chat/completions')) {
        res.writeHead(404);
        res.end();
        return;
      }
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        const parsed = JSON.parse(body);
        const toolResults = (parsed.messages ?? []).filter((m) => m.role === 'tool').length;
        const hasTools = Array.isArray(parsed.tools) && parsed.tools.length > 0;
        const send = (obj) => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(obj));
        };
        const sse = (chunks) => {
          res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
          for (const c of chunks) res.write(`data: ${JSON.stringify(c)}\n\n`);
          res.write('data: [DONE]\n\n');
          res.end();
        };
        if (!hasTools) return send(completion('ok'));
        if (toolResults === 0) {
          const call = { id: 'call_0', type: 'function', function: { name: 'navigate', arguments: JSON.stringify({ url: targetUrl }) } };
          if (parsed.stream) {
            return sse([
              { choices: [{ index: 0, delta: { role: 'assistant', content: null, tool_calls: [{ index: 0, ...call }] } }] },
              { choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] }
            ]);
          }
          return send(toolCompletion('call_0', 'navigate', { url: targetUrl }));
        }
        if (parsed.stream) {
          return sse([
            { choices: [{ index: 0, delta: { content: 'Task finished.' } }] },
            { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }
          ]);
        }
        return send(completion('Task finished.'));
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ port, close: () => new Promise((r) => server.close(() => r())) });
    });
  });
}

function completion(content) {
  return {
    id: 'chatcmpl-eval',
    object: 'chat.completion',
    created: 0,
    model: 'eval',
    choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
  };
}
function toolCompletion(id, name, args) {
  return {
    id: 'chatcmpl-eval',
    object: 'chat.completion',
    created: 0,
    model: 'eval',
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }]
        },
        finish_reason: 'tool_calls'
      }
    ],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
  };
}

function report(results) {
  console.log('\n================ Hibro agent eval ================\n');
  let passed = 0;
  for (const r of results) {
    const mark = r.pass ? 'PASS' : 'FAIL';
    if (r.pass) passed++;
    console.log(`${mark}  ${r.id}`);
    console.log(`     prompt: ${r.prompt}`);
    console.log(`     ${r.detail}`);
    if (r.error) console.log(`     error:  ${r.error}`);
  }
  console.log(`\n${passed}/${results.length} tasks passed.\n`);
  return passed === results.length;
}

async function main() {
  const selfTest = process.argv.includes('--self-test');
  let profile;
  let mock;
  let tasks;
  if (selfTest) {
    mock = await startSelfTestMock(ABS);
    profile = {
      provider: 'openai-compatible',
      baseUrl: `http://127.0.0.1:${mock.port}`,
      apiKey: 'eval-mock',
      model: 'eval'
    };
    tasks = [TASKS[0]]; // navigate, performed for real by the scripted "model"
    console.log(`[self-test] scripted mock on :${mock.port}; real navigate → ${ABS}`);
  } else {
    profile = realProfileFromEnv();
    tasks = TASKS;
    console.log(`[eval] provider=${profile.provider} model=${profile.model}`);
  }

  const { ctx, extId } = await launchExtension();
  const results = [];
  try {
    await configureProvider(ctx, extId, profile);
    for (const t of tasks) {
      try {
        const o = await runTask(ctx, extId, t);
        const r = t.check(o);
        results.push({ ...o, ...r });
      } catch (e) {
        results.push({ id: t.id, prompt: t.prompt, pass: false, detail: 'threw', error: e.message });
      }
    }
  } finally {
    await ctx.close();
    if (mock) await mock.close();
  }
  const ok = report(results);
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
