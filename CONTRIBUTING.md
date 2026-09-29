# Contributing to Hibro

Bug reports, documentation corrections, and code contributions are welcome. Search existing [issues](https://github.com/apemost/hibro/issues) and [pull requests](https://github.com/apemost/hibro/pulls) before starting. For a larger change, an issue describing the problem and proposed behavior helps establish the scope before implementation.

## Report a problem

Include enough detail for someone else to reproduce the problem:

- Hibro version or commit, browser name and version, and operating system.
- Steps to reproduce, expected behavior, and what happened instead.
- A public example page or a minimal example when the problem depends on page content.
- For model-related problems, the provider type and model name. Include the endpoint host or a redacted base URL if relevant.
- Relevant error messages, sanitized logs, and screenshots.

Remove API keys, tokens, private page content, and personal information before posting. Review URLs and screenshots for secrets too.

## Set up a development checkout

Use Node.js 24, matching the repository workflows, and the pnpm version specified by `packageManager` in [package.json](package.json). Use pnpm for dependency changes so the lockfile stays consistent.

Fork the repository on GitHub, then clone your fork and create a branch. Build the extension using the [README quick start](README.md#quick-start).

Open `chrome://extensions` in Chrome or `edge://extensions` in Edge, enable Developer mode, choose Load unpacked, and select `dist/`.

Run `pnpm dev` during development; it updates the same `dist/` directory. After changes to the manifest or extension lifecycle, reload the extension and the page you are testing. For the production build, stop the development server and run `pnpm build` again.

## Make a focused change

Keep a pull request focused on one problem. Explain why a new dependency is needed and avoid unrelated formatting or refactoring.

For a code change, add a test that demonstrates the expected behavior and observe it fail before implementing the fix. User-facing behavior changes belong in the browser tests in `e2e/extension.spec.ts`; other reusable tests should stay with the existing tests for that subsystem. Use deterministic fixtures where possible.

Write code comments and documentation in English. Keep English and Simplified Chinese interface messages in sync in `src/options/i18n.ts` and `src/panel/i18n.tsx` when changing the affected surface. Check both languages for layout changes.

Update `docs/features.md` when behavior changes.

For bundled skill files, see the [Agent Skills guide](skills/README.md).

## Verify the change

Run these checks for every change, including documentation changes:

```bash
pnpm typecheck
pnpm build
pnpm format:check
```

If formatting needs updating, format the files you changed with `pnpm exec prettier --write <paths>`, then review the diff.

For changes to extension behavior, run the browser suite. Install its Chromium build once:

```bash
pnpm exec playwright install chromium
pnpm test:e2e
```

The suite builds the extension and runs in headless Chromium with a local mock AI provider. It requires no API key or live provider account. Test affected UI flows manually in Chrome or Edge when browser-specific behavior needs checking, and record which browser you used.

Run additional checks for the area you changed:

| Changed area                                             | Check               |
| -------------------------------------------------------- | ------------------- |
| Public documentation, navigation, or documentation build | `pnpm test:docs`    |
| Extension packaging or release tooling                   | `pnpm test:package` |
| Evaluation harness                                       | `pnpm test:eval`    |

Use `pnpm docs:dev` to preview documentation changes. Real-model evaluation uses live websites and may incur provider charges; follow [eval/README.md](eval/README.md) when that evidence is needed.

These are local validation expectations. The current GitHub workflows cover specific documentation and packaging events; they do not run every check for every pull request.

## Open a pull request

Open the pull request from your branch to `apemost/hibro`'s `main` branch. Describe the problem and resulting behavior, link related issues, and list the checks you ran with their results. Include screenshots for visible UI changes and state any untested browser or provider behavior.

Keep discussion respectful and specific. Explain technical disagreements with examples or evidence, and ask for clarification when the intended behavior is unclear.
