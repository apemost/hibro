---
name: hibro-iteration
description: Iteration loop and doc gardening for the hibro browser extension. Use for any change in the hibro repo (code, docs, icons, tests) to apply its verify ladder and documentation placement rules.
---

# Hibro iteration

Project workflow for changing hibro (Chrome/Edge MV3 extension, Vite + CRXJS, strict TypeScript, pnpm). Read this before editing code, docs, icons, or tests.

## Iteration loop

1. Make the change. Keep it minimal and match the surrounding style; no new dependencies without a concrete reason. A behavior change adds or updates an e2e test in `e2e/extension.spec.ts` in the same change.
2. Run `pnpm typecheck` and `pnpm build` after every change, docs-only ones included. Both are fast and must pass.
3. When `manifest.json`, permissions, or entry points change, inspect `dist/manifest.json` too: it should contain the rewritten service worker loader, the bundled content script, `options_page`, and the `storage` permission.
4. When a core flow changes (load, options, extract, chat stream, reasoning readout, task loop, message actions, error card), run `pnpm test:e2e`. It builds first, then runs the serial Playwright suite in headless Chromium against the deterministic mock AI in `e2e/mock.ts` (`test-results/` is git-ignored); no API key or network needed. First run needs `playwright install chromium`.
5. Anything beyond the mock (real AI endpoint, real sites) is verified manually in Chrome/Edge. `pnpm dev` gives HMR on the same `dist/`; load it via `chrome://extensions` → Developer mode → "Load unpacked". When a change was only verified this way, say so and name what was not covered.

Hard rules:

- Never hardcode API keys anywhere in the repo; AI config lives in `chrome.storage.local` under `hibroProviders` + `activeProviderId`.
- Do not remove the `key` from `manifest.json`; the e2e fixtures derive the extension ID from it.
- Keep extension Service Worker imports static. Select development/eval adapters through build-time aliases; never call dynamic `import()` from `src/background.ts`.
- Use pnpm only (pinned in `package.json`), never npm/yarn.

## Doc gardening

Doc map:

- `AGENTS.md`: agent/maintainer conventions, guardrails, and terse pointers to `docs/`. Update it when the tech stack, commands, structure, or conventions change.
- `README.md`: user-facing pitch and quick start. Nothing else belongs there.
- `docs/index.md`: public documentation index and user-oriented navigation.
- `docs/features.md`: community-facing feature behavior and messaging protocols. Update it in the same change that alters the behavior it documents.
- `docs/getting-started.md`: installation and first use.
- `docs/providers.md`: provider profile requirements and selection.
- `docs/privacy.md`: local storage, provider requests, and permissions.
- `docs/skills.md`: user-facing Skill format and behavior.
- `docs/troubleshooting.md`: common user problems and practical fixes.
- `eval/README.md`: maintainer guide for running the real-model evaluation harness.

Placement rules:

- `docs/` is public product documentation for Hibro users and the open-source community. Prioritize installation, configuration, product behavior, privacy, troubleshooting, and user-extensible features.
- Maintainer-only operational guides stay beside the tool they describe, such as `eval/README.md`. Repository-wide maintainer constraints stay in `AGENTS.md`.
- Put contributor material on the public site only when it is intentionally organized as a developer guide. Do not place maintainer runbooks under general user navigation.
- Guardrails that must not be missed (the hard rules above) stay in `AGENTS.md` even when the related detail moves to `docs/`.

Style rules:

- Everything in the repo is English, including comments and UI strings.
- Plain reference prose: no em/en dashes, no promotional adjectives, no rule-of-three padding, no fake-depth "-ing" tails. When adding more than a few lines of prose, do a humanizer pass against Wikipedia's "Signs of AI writing" patterns.
- Moved text keeps its wording; fix only outright grammar errors.
