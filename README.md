# Hibro

Hibro is an AI assistant for the Chrome and Edge side panel. It can answer questions about the current page and carry out browser tasks such as clicking, typing, scrolling, and navigation.

## What it does

- Works with OpenAI-compatible services, OpenAI, and Anthropic.
- Streams Markdown answers with diagrams, charts, validated image assets, code, and safe HTML previews.
- Translates a page in place, with each translation under the block it came from.
- Saves recent conversations and supports site-specific skills.
- Keeps settings and history in browser extension storage.
- Supports English and Simplified Chinese.

## Quick start

Install [Hibro from the Chrome Web Store](https://chromewebstore.google.com/detail/hibro/adjgimddlhgjegcbbcmccalenolmeije). Open Hibro from the browser toolbar, open the side panel from its menu, then add an AI provider from Settings. The selected model must support function calling.

To build Hibro from source for local development:

```bash
pnpm install
pnpm build
```

Load `dist/` as an unpacked extension.

## Documentation

- [Documentation index](docs/index.md)
- [Getting started](docs/getting-started.md)
- [Features](docs/features.md)
- [Provider setup](docs/providers.md)
- [Privacy policy](docs/privacy.md)
- [Troubleshooting](docs/troubleshooting.md)

## License

Hibro is licensed under the [Apache License, Version 2.0](LICENSE). Copyright 2026 Andrew Lyu.
