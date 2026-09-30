# Hibro

Hibro is an open-source AI browser assistant that helps you read and interact with web pages.

## Features

- Ask questions about the current page, or request summaries and explanations in the side panel.
- Get assistance with page interactions, such as following links, entering text, and navigating.
- Use immersive translation as a reading aid, with the original text kept visible.
- Read streaming responses with support for Markdown, math, diagrams, charts, code, and static HTML previews.
- Revisit up to 10 recent conversations, with options to switch, rename, or delete them.
- Add guidance for specific websites through built-in or custom skills.
- Choose between saved provider profiles for OpenAI-compatible services, OpenAI, and Anthropic.

## Quick start

Install [Hibro from the Chrome Web Store](https://chromewebstore.google.com/detail/hibro/adjgimddlhgjegcbbcmccalenolmeije). Open Hibro from the browser toolbar, then add an AI provider from Settings. Chat and page actions require a model that supports function calling.

To build Hibro from source, use Node.js 24 or later and the pnpm version specified by `packageManager` in [package.json](package.json):

```bash
pnpm install --frozen-lockfile
pnpm build
```

Load `dist/` as an unpacked extension in Chrome or Edge. See [Contributing](CONTRIBUTING.md) for development setup and checks.

## Documentation

- [Overview](docs/index.md)
- [Getting started](docs/getting-started.md)
- [Features](docs/features.md)
- [Provider setup](docs/providers.md)
- [Privacy policy](docs/privacy.md)
- [Troubleshooting](docs/troubleshooting.md)

## License

Hibro is licensed under the [Apache License, Version 2.0](LICENSE). Copyright 2026 Andrew Lyu.
