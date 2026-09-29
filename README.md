# Hibro

Hibro is an open-source AI assistant that helps you read and interact with supported web pages. Ask questions and request page actions from the side panel, or translate page content from the toolbar.

## What it does

- Works with OpenAI-compatible services, OpenAI, and Anthropic.
- Streams Markdown answers with diagrams, charts, validated image assets, code, and sandboxed HTML previews.
- Translates a page in place, with each translation under the block it came from.
- Saves recent conversations and supports site-specific skills.
- Keeps settings and history in browser extension storage.

## Quick start

Install [Hibro from the Chrome Web Store](https://chromewebstore.google.com/detail/hibro/adjgimddlhgjegcbbcmccalenolmeije). Open Hibro from the browser toolbar, open the side panel from its menu, then add an AI provider from Settings. The selected model must support function calling.

To build Hibro from source, use Node.js 24 and the pnpm version specified by `packageManager` in [package.json](package.json):

```bash
pnpm install --frozen-lockfile
pnpm build
```

Load `dist/` as an unpacked extension in Chrome or Edge. See [Contributing](CONTRIBUTING.md) for development setup and checks.

## Documentation

- [Documentation index](docs/index.md)
- [Getting started](docs/getting-started.md)
- [Features](docs/features.md)
- [Provider setup](docs/providers.md)
- [Privacy policy](docs/privacy.md)
- [Troubleshooting](docs/troubleshooting.md)

## License

Hibro is licensed under the [Apache License, Version 2.0](LICENSE). Copyright 2026 Andrew Lyu.
