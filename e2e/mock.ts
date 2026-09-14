// Local doubles for e2e: a fixture web page plus mock AI endpoints (an
// OpenAI-compatible Chat Completions endpoint and an Anthropic Messages
// endpoint). The mock is deterministic: it routes on the request shape, not
// on prompts — every panel run arrives as a streaming request carrying tools
// (the unified assistant loop), and the selection-explain path is recognized
// by its system prompt.
import http from 'node:http';

// A scripted tool-call to replay on a given loop turn (for deterministic,
// LLM-free tool-loop tests). The mock replays these in order across turns,
// then answers — so tests can drive any tool sequence (click/type/navigate/…)
// and assert real page side-effects.
export interface AgentScriptCall {
  name: string;
  args: Record<string, unknown>;
}

export interface MockServer {
  port: number;
  stats: { agent: number; stream: number; explain: number };
  // Authorization headers received by the OpenAI-compatible endpoint.
  authorizationHeaders: string[];
  // Each system prompt received on a unified-loop call, in order. Lets e2e
  // assert that skill guidance was injected into the assistant prompt.
  systems: string[];
  // Each last-user-message text received on a unified-loop call, in order.
  // Lets e2e assert what page context (overview, page-change marker) was sent.
  userMessages: string[];
  // Tool names exposed to the model on each agent request.
  toolNames: string[][];
  // Requests made by model-rendered image content.
  imageRequests: number;
  // Replay a fixed tool-call sequence on the next run (turn = number of tool
  // results already fed back). Empty = keyword default: action-looking
  // messages get one scroll call, everything else answers directly.
  setAgentScript(calls: AgentScriptCall[]): void;
  close(): Promise<void>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const FIXTURE_PAGE = `<!doctype html>
<html>
  <head><title>Hibro e2e fixture</title></head>
  <body style="height: 3000px">
    <h1>HIBRO E2E FIXTURE</h1>
    <p>Readable fixture text for extraction.</p>
    <p><a id="next" href="/target">Go to target page</a></p>
    <input id="q" placeholder="search" />
    <button id="go">Go</button>
    <p id="out"></p>
    <script>
      window.hibroKeyEvents = [];
      document.addEventListener('keydown', function (event) {
        if (event.target && event.target.id === 'q') {
          window.hibroKeyEvents.push('keydown:' + event.key);
        }
      });
      document.addEventListener('keyup', function (event) {
        if (event.target && event.target.id === 'q') {
          window.hibroKeyEvents.push('keyup:' + event.key);
        }
      });
      document.getElementById('go').addEventListener('click', function () {
        document.getElementById('out').textContent =
          'You typed: ' + document.getElementById('q').value;
      });
    </script>
  </body>
</html>`;

const TARGET_PAGE = `<!doctype html>
<html>
  <head><title>Hibro e2e target</title></head>
  <body><h1>HIBRO E2E TARGET</h1><p>You arrived at the target page.</p></body>
</html>`;

const PENDING_PAGE = `<!doctype html>
<html>
  <head><title>Hibro e2e pending page</title></head>
  <body><main><h1>HIBRO E2E UNINJECTED PAGE</h1></main>`;

// Messages that look like page actions get a default scroll call when no
// script is set (mirrors what a real model would do with them).
const ACTION_RE = /scroll|click|type|search|navigate|press|fill/i;

function completion(content: string) {
  return {
    id: 'chatcmpl-mock',
    object: 'chat.completion',
    created: 0,
    model: 'mock',
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content },
        finish_reason: 'stop',
      },
    ],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  };
}

// A Chat Completions response that requests a tool call. finish_reason
// 'tool_calls' tells the SDK to run the tool, append the result, and
// re-request — which the mock answers on the next turn. The id must be unique
// per call within a conversation.
function toolCompletion(
  id: string,
  name: string,
  args: Record<string, unknown>,
) {
  return {
    id: 'chatcmpl-mock',
    object: 'chat.completion',
    created: 0,
    model: 'mock',
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id,
              type: 'function',
              function: { name, arguments: JSON.stringify(args) },
            },
          ],
        },
        finish_reason: 'tool_calls',
      },
    ],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  };
}

// --- OpenAI-flavor Server-Sent Events (Chat Completions chunks) ---

function sseHead(res: http.ServerResponse) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
  });
}
const sseChunk = (res: http.ServerResponse, data: unknown) =>
  res.write(`data: ${JSON.stringify(data)}\n\n`);
const sseDone = (res: http.ServerResponse) => {
  res.write('data: [DONE]\n\n');
  res.end();
};

// A streamed tool call: one delta carrying the whole call, then the
// tool_calls finish reason.
async function streamToolCall(
  res: http.ServerResponse,
  id: string,
  name: string,
  args: Record<string, unknown>,
) {
  sseHead(res);
  sseChunk(res, {
    choices: [
      {
        index: 0,
        delta: {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              index: 0,
              id,
              type: 'function',
              function: { name, arguments: JSON.stringify(args) },
            },
          ],
        },
      },
    ],
  });
  await sleep(60);
  sseChunk(res, {
    choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }],
  });
  sseDone(res);
}

// Streamed text, optionally preceded by reasoning chunks (the
// openai-compatible provider maps `reasoning_content` to reasoning stream
// parts, which feed the panel's run readout).
async function streamTextChunks(
  res: http.ServerResponse,
  chunks: string[],
  reasoning?: string[],
) {
  sseHead(res);
  for (const note of reasoning ?? []) {
    sseChunk(res, {
      choices: [{ index: 0, delta: { reasoning_content: note } }],
    });
    await sleep(80);
  }
  for (const chunk of chunks) {
    sseChunk(res, { choices: [{ index: 0, delta: { content: chunk } }] });
    await sleep(80);
  }
  sseChunk(res, { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] });
  sseDone(res);
}

// --- Anthropic-flavor Server-Sent Events (Messages API) ---

const anthropicEvent = (
  res: http.ServerResponse,
  event: string,
  data: unknown,
) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

function anthropicMessageStart(res: http.ServerResponse, model: string) {
  sseHead(res);
  anthropicEvent(res, 'message_start', {
    type: 'message_start',
    message: {
      id: 'msg_mock',
      type: 'message',
      role: 'assistant',
      model,
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 1, output_tokens: 1 },
    },
  });
}

async function anthropicStreamText(
  res: http.ServerResponse,
  model: string,
  text: string,
) {
  anthropicMessageStart(res, model);
  anthropicEvent(res, 'content_block_start', {
    type: 'content_block_start',
    index: 0,
    content_block: { type: 'text', text: '' },
  });
  await sleep(40);
  anthropicEvent(res, 'content_block_delta', {
    type: 'content_block_delta',
    index: 0,
    delta: { type: 'text_delta', text },
  });
  anthropicEvent(res, 'content_block_stop', {
    type: 'content_block_stop',
    index: 0,
  });
  anthropicEvent(res, 'message_delta', {
    type: 'message_delta',
    delta: { stop_reason: 'end_turn', stop_sequence: null },
    usage: { output_tokens: 1 },
  });
  anthropicEvent(res, 'message_stop', { type: 'message_stop' });
  res.end();
}

async function anthropicStreamToolCall(
  res: http.ServerResponse,
  model: string,
  id: string,
  name: string,
  args: Record<string, unknown>,
) {
  anthropicMessageStart(res, model);
  anthropicEvent(res, 'content_block_start', {
    type: 'content_block_start',
    index: 0,
    content_block: { type: 'tool_use', id, name, input: {} },
  });
  await sleep(40);
  anthropicEvent(res, 'content_block_delta', {
    type: 'content_block_delta',
    index: 0,
    delta: { type: 'input_json_delta', partial_json: JSON.stringify(args) },
  });
  anthropicEvent(res, 'content_block_stop', {
    type: 'content_block_stop',
    index: 0,
  });
  anthropicEvent(res, 'message_delta', {
    type: 'message_delta',
    delta: { stop_reason: 'tool_use', stop_sequence: null },
    usage: { output_tokens: 1 },
  });
  anthropicEvent(res, 'message_stop', { type: 'message_stop' });
  res.end();
}

// Non-streaming Anthropic Messages response (kept for completeness; the panel
// run loop always streams).
function anthropicJson(
  res: http.ServerResponse,
  model: string,
  contentBlocks: Array<Record<string, unknown>>,
  stopReason: string,
) {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(
    JSON.stringify({
      id: 'msg_mock',
      type: 'message',
      role: 'assistant',
      model,
      content: contentBlocks,
      stop_reason: stopReason,
      stop_sequence: null,
      usage: { input_tokens: 1, output_tokens: 1 },
    }),
  );
}

export async function startMock(): Promise<MockServer> {
  const stats = { agent: 0, stream: 0, explain: 0 };
  const authorizationHeaders: string[] = [];
  const systems: string[] = [];
  const userMessages: string[] = [];
  const toolNames: string[][] = [];
  let imageRequests = 0;
  let agentScript: AgentScriptCall[] = [];

  // The next tool call to emit on this loop turn: the scripted call when one
  // is set, else the default scroll for action-looking messages on turn 0.
  // Null means "no more tools; produce the final answer".
  const nextCall = (
    lastUser: string,
    toolTurns: number,
  ): AgentScriptCall | null => {
    const scripted = agentScript[toolTurns];
    if (scripted) return scripted;
    if (
      toolTurns === 0 &&
      agentScript.length === 0 &&
      ACTION_RE.test(lastUser)
    ) {
      return { name: 'scroll', args: { direction: 'down' } };
    }
    return null;
  };

  const server = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(FIXTURE_PAGE);
      return;
    }
    if (req.method === 'GET' && req.url === '/tracking-pixel') {
      imageRequests++;
      res.writeHead(204);
      res.end();
      return;
    }
    if (req.method === 'GET' && req.url === '/target') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(TARGET_PAGE);
      return;
    }
    if (req.method === 'GET' && req.url === '/uninjected') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.write(PENDING_PAGE);
      return;
    }
    if (req.method === 'POST' && req.url === '/chat/completions') {
      authorizationHeaders.push(req.headers.authorization ?? '');
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', async () => {
        const parsed = JSON.parse(body);
        const messages = parsed.messages ?? [];
        const sys: string = messages[0]?.content ?? '';
        const lastUser: string =
          [...messages]
            .reverse()
            .find((m: { role: string }) => m.role === 'user')?.content ?? '';
        const json = (content: string) => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(completion(content)));
        };
        // Selection explain: a plain non-streaming completion without tools.
        if (sys.includes('selected an excerpt')) {
          stats.explain++;
          json('mock explanation');
          return;
        }
        const hasTools = Array.isArray(parsed.tools) && parsed.tools.length > 0;
        if (!hasTools) {
          json('plain answer');
          return;
        }
        // Unified assistant loop. Turn index = number of tool results the SDK
        // has fed back so far.
        const toolTurns = messages.filter(
          (m: { role: string }) => m.role === 'tool',
        ).length;
        toolNames.push(
          parsed.tools.map(
            (entry: { function?: { name?: string } }) =>
              entry.function?.name ?? '',
          ),
        );
        systems.push(sys);
        userMessages.push(lastUser);
        stats.agent++;
        const call = nextCall(lastUser, toolTurns);
        if (call) {
          if (parsed.stream) {
            stats.stream++;
            await streamToolCall(
              res,
              `call_mock_${toolTurns}`,
              call.name,
              call.args,
            );
          } else {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(
              JSON.stringify(
                toolCompletion(`call_mock_${toolTurns}`, call.name, call.args),
              ),
            );
          }
          return;
        }
        if (toolTurns > 0) {
          // The turn after tool results: the final answer.
          if (parsed.stream) {
            stats.stream++;
            await streamTextChunks(res, ['Task finished.']);
          } else {
            json('Task finished.');
          }
          return;
        }
        // Direct answer (the message needed no tool): streamed markdown,
        // preceded by reasoning deltas so the run readout is observable.
        // Diagram/chart/html/code variants skip the reasoning window: they
        // exist to exercise the custom renderers, and their fences arrive in
        // pieces so the panel's incomplete-block path runs.
        if (parsed.stream) {
          stats.stream++;
          const address = server.address();
          const trackingUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}/tracking-pixel`;
          const chunks = /remote markdown image/i.test(lastUser)
            ? [`Remote image test.\n\n![remote content](${trackingUrl})`]
            : /remote image chart/i.test(lastUser)
              ? [
                  'Here is the chart:\n\n```chart\n',
                  `{"type":"scatter","datasets":[{"label":"Remote","data":[[1,2]],"image":"${trackingUrl}"}]}\n`,
                  '```\n',
                ]
              : /diagram/i.test(lastUser)
                ? [
                    'Sure, here is the flow:\n\n```mermaid\n',
                    'graph TD\n  A[Start] --> B{OK?}\n  B -->|yes| C[Done]\n  B -->|no| A\n```\n',
                    '\nThat is the whole flow.',
                  ]
                : /broken chart/i.test(lastUser)
                  ? [
                      'Here is the chart:\n\n```chart\n',
                      '{not valid json}\n',
                      '```\n',
                    ]
                  : /chart formats/i.test(lastUser)
                    ? [
                        'Supported chart formats:\n\n',
                        '```chart\n{"type":"bar","labels":["Q1","Q2"],"datasets":[{"label":"Bar","data":[3,5]}]}\n```\n\n',
                        '```chart\n{"type":"line","labels":["Q1","Q2"],"datasets":[{"label":"Line","data":[3,5]}]}\n```\n\n',
                        '```chart\n{"type":"pie","labels":["Yes","No"],"datasets":[{"label":"Pie","data":[7,3]}]}\n```\n\n',
                        '```chart\n{"type":"scatter","datasets":[{"label":"Scatter","data":[[1,2],[2,4]]}]}\n```\n',
                      ]
                    : /chart/i.test(lastUser)
                      ? [
                          'Here is the chart:\n\n```chart\n',
                          '{"type":"bar","labels":["Q1","Q2","Q3"],"datasets":[{"label":"Quarterly numbers","data":[3,5,4]}],"title":"Quarterly numbers"}\n',
                          '```\n\nQuarterly numbers.',
                        ]
                      : /html/i.test(lastUser)
                        ? [
                            'Here is the snippet:\n\n```html\n',
                            '<div style="padding:16px;border:2px solid #1d4ed8;border-radius:8px">\n  <h2 style="color:#1d4ed8;margin:0">Preview me</h2>\n</div>\n',
                            '```\n',
                          ]
                        : /long code/i.test(lastUser)
                          ? // 40 lines: well past the panel's 25-line code-block cap.
                            [
                              'Here is the code:\n\n```\n',
                              Array.from(
                                { length: 40 },
                                (_, i) => `line ${i + 1}`,
                              ).join('\n'),
                              '\n```\n',
                            ]
                          : null;
          if (chunks) {
            await streamTextChunks(res, chunks);
            return;
          }
          // Four reasoning lines so the panel's last-3-lines readout window is
          // observable.
          await streamTextChunks(
            res,
            [
              'This is a **streaming**',
              ' mock answer',
              '.\n\n- first\n- second',
            ],
            [
              'mock thought line one\n',
              'mock thought line two\n',
              'mock thought line three\n',
              'mock thought line four',
            ],
          );
          return;
        }
        json('plain answer');
      });
      return;
    }
    // Anthropic Messages API (/messages or /v1/messages). The AI SDK anthropic
    // provider maps the `instructions` system prompt to the top-level `system`
    // field, so route on it the same way as the OpenAI handler. The unified
    // loop streams, so both text and tool_use replies are served as SSE.
    if (req.method === 'POST' && req.url.endsWith('/messages')) {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', async () => {
        const parsed = JSON.parse(body);
        // The anthropic provider sends `system` (and message content) either as
        // a plain string or as an array of {type:'text',text} blocks; normalize
        // both to a string so the keyword routing below works.
        const textOf = (content: unknown): string => {
          if (typeof content === 'string') return content;
          if (Array.isArray(content)) {
            return content
              .map((b) =>
                typeof b === 'string'
                  ? b
                  : ((b as { text?: string })?.text ?? ''),
              )
              .join('');
          }
          return '';
        };
        const sys = textOf(parsed.system);
        const msgs = parsed.messages ?? [];
        const lastUserMsg = [...msgs].reverse().find((m) => m.role === 'user');
        const lastUser = textOf(lastUserMsg?.content);
        const model = parsed.model ?? 'mock';
        if (sys.includes('selected an excerpt')) {
          stats.explain++;
          anthropicJson(
            res,
            model,
            [{ type: 'text', text: 'mock explanation', index: 0 }],
            'end_turn',
          );
          return;
        }
        const hasTools = Array.isArray(parsed.tools) && parsed.tools.length > 0;
        if (!hasTools) {
          anthropicJson(
            res,
            model,
            [{ type: 'text', text: 'plain answer', index: 0 }],
            'end_turn',
          );
          return;
        }
        // Unified loop; a turn's index = messages carrying tool_result blocks.
        const toolTurns = msgs.filter(
          (m) =>
            Array.isArray(m.content) &&
            m.content.some((b: { type?: string }) => b?.type === 'tool_result'),
        ).length;
        toolNames.push(
          parsed.tools.map((entry: { name?: string }) => entry.name ?? ''),
        );
        systems.push(sys);
        userMessages.push(lastUser);
        stats.agent++;
        const call = nextCall(lastUser, toolTurns);
        if (parsed.stream) stats.stream++;
        if (call) {
          if (parsed.stream) {
            await anthropicStreamToolCall(
              res,
              model,
              `toolu_mock_${toolTurns}`,
              call.name,
              call.args,
            );
          } else {
            anthropicJson(
              res,
              model,
              [
                {
                  type: 'tool_use',
                  id: `toolu_mock_${toolTurns}`,
                  name: call.name,
                  input: call.args,
                  index: 0,
                },
              ],
              'tool_use',
            );
          }
          return;
        }
        const answer = toolTurns > 0 ? 'Task finished.' : 'plain answer';
        if (parsed.stream) {
          await anthropicStreamText(res, model, answer);
        } else {
          anthropicJson(
            res,
            model,
            [{ type: 'text', text: answer, index: 0 }],
            'end_turn',
          );
        }
      });
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('mock server has no port');
  return {
    port: address.port,
    stats,
    authorizationHeaders,
    systems,
    userMessages,
    toolNames,
    get imageRequests() {
      return imageRequests;
    },
    setAgentScript: (calls: AgentScriptCall[]) => {
      agentScript = calls;
    },
    // server.close() alone waits for keep-alive connections (e.g. SSE fetches)
    // to drain; closeAllConnections() drops them so teardown doesn't hang.
    close: () =>
      new Promise((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}
