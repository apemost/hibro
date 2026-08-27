# Hibro agent evaluation

The agent evaluation runs Hibro with a real function-calling model on live arXiv pages. It checks outcomes such as reaching the right page, reading the expected content, and scrolling.

The evaluation adds its provider through Hibro Settings, so the API key is encrypted before it is saved in the browser profile.

Use `pnpm test:e2e` for routine development. It uses a local mock model and gives repeatable coverage of extension behavior. Use this evaluation when you need evidence from a real model and live site.

## Self-test

The self-test checks the evaluation setup without an API key:

```bash
pnpm eval -- --self-test
```

It builds an isolated evaluation copy under `.local/tmp/eval-dist/`, opens a live arXiv page in Chromium, and runs the navigation case with a local scripted model. Network access to arXiv is still required. The evaluation build never replaces the production `dist/` directory.

## Run with a real model

```bash
HIBRO_EVAL_PROVIDER=anthropic \
HIBRO_EVAL_API_KEY=sk-ant-... \
HIBRO_EVAL_MODEL=claude-sonnet-5 \
pnpm eval
```

Configuration:

| Variable | Required | Description |
| --- | --- | --- |
| `HIBRO_EVAL_PROVIDER` | No | `anthropic`, `openai`, or `openai-compatible`. The default is `openai-compatible`. |
| `HIBRO_EVAL_API_KEY` | Yes | API key for a real evaluation. |
| `HIBRO_EVAL_MODEL` | No | Model name understood by the selected provider. |
| `HIBRO_EVAL_BASE_URL` | No | Custom provider or proxy endpoint. |

## Evaluation cases

| Case | Expected result |
| --- | --- |
| `navigate` | Opens the abstract page for arXiv paper `1706.03762`. |
| `title` | Returns the paper title "Attention Is All You Need." |
| `subjects` | Finds `cs.CL` or "Computation and Language." |
| `scroll` | Moves the live page down. |

The script prints a pass or fail result for each case.

Results can vary with the selected model and changes to the live site, so they do not replace the deterministic browser tests.
