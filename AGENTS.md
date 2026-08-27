# AGENTS.md

A browser extension (Chrome / Edge, Manifest V3) for AI-assisted reading and web page automation.

## Skills

- `hibro-iteration` (`.agents/skills/hibro-iteration/SKILL.md`): the change → verify → document loop and the doc placement rules for this repo.

## Tech stack

- Vite 8 + `@crxjs/vite-plugin` 2 (MV3 manifest rewriting, service worker / content script bundling, HMR in dev)
- TypeScript (strict; `pnpm typecheck` runs `tsc --noEmit`; `@types/chrome` for extension APIs)
- pnpm (pinned via `packageManager` in `package.json`; do not use npm/yarn)
- React 19 + Tailwind CSS v4 (shadcn-style design tokens) for the panel and options pages, via `@vitejs/plugin-react` + `@tailwindcss/vite` alongside CRXJS
- `ai` (Vercel AI SDK 7) + `@ai-sdk/openai-compatible` / `@ai-sdk/openai` / `@ai-sdk/anthropic` for model calls in the service worker. All panel messages run through one streaming tool-calling loop (`streamText` + `tools` + `stopWhen` / `isStepCount` in `handleSend`): the model decides per message whether to answer, read the page with perception tools, or act on it, so a **function-calling-capable model** is required for every conversation — the earlier JSON-action protocol and the chat/task intent router are both gone. `getModel` branches on the configured `provider` (`openai-compatible` default, `openai`, or `anthropic` for the Claude Messages API)
- AI SDK v7 rejects `role: 'system'` entries in `messages`; pass the system prompt through the `instructions` option instead (see `callAI` in `src/background.ts`)
- Page **actions** run over `chrome.debugger` CDP (real `Input.*` events, scroll-into-view + focus) in `src/cdp.ts`; page **reads / perception** (Markdown via `turndown`, structural overview, tagged interactive elements, viewport text, element detail) run in the content script (`src/content.ts`)
- Vercel **AI Elements** chat components live (trimmed) in `src/components/ai-elements/` (`Conversation` / `Message` / `MessageResponse` (Streamdown) / `Tool`). The panel drives them from its own React state fed by the service-worker port, not `useChat`/HTTP. Streamdown is the Markdown renderer; beyond `cjk` + `math`, three extra fenced blocks are enabled: ```` ```mermaid ```` diagrams (lazy `await import("mermaid")` DiagramPlugin in `src/panel/mermaidPlugin.ts` — Mermaid v11 is eval-free, MV3-CSP-safe), ```` ```chart ```` data charts (pure-JSON ECharts option, zod-validated, lazy tree-shaken ECharts in `src/panel/ChartBlock.tsx`), and ```` ```html ```` blocks with a Code/Preview toggle (sandboxed, network-less iframe preview in `src/panel/HtmlBlock.tsx`). Markdown image URLs render as inert approval cards; the dedicated `hibro-remote-image` worker port performs a guarded one-time fetch after a click and returns validated bytes for local Blob rendering. Custom renderers gate mid-stream behavior on `src/panel/partStreaming.ts` (Streamdown's `isIncomplete` can't see an open fence — remend auto-closes it). The Shiki `code` plugin stays dropped (bundle size).
- Panel ↔ service worker use a structured-part protocol (`src/shared/protocol.ts`): the worker streams `PanelEvent`s (`run-start` / `part-add` / `part-delta` / `tool-update` / `run-end` / `status` / `error`) that the panel folds into `UIMessage`-style parts (text / reasoning / provider-inline image asset / tool-invocation).
- English is the source language for code, comments, docs, and translation keys. Settings and the side panel contain supported Simplified Chinese UI translations (`src/options/i18n.ts`, `src/panel/i18n.tsx`) over the shared storage contract in `src/shared/language.ts`

## Commands

```bash
pnpm install   # install dependencies
pnpm build     # production build → dist/ (git-ignored)
pnpm dev       # dev mode with HMR → load the same dist/
pnpm typecheck # strict TS check (tsc --noEmit)
pnpm test:e2e  # build + Playwright e2e (local mock AI; first run: playwright install chromium)
pnpm test:eval # eval-harness configuration regressions
pnpm eval      # isolated build + real-LLM run on live arXiv (loads `.env`; `--self-test` is keyless)
```

Load `dist/` via `chrome://extensions` → Developer mode → "Load unpacked".

## Project structure

```
manifest.json       # MV3 manifest: debugger + scripting + sidePanel + storage permissions, <all_urls> host
vite.config.js      # Vite + CRXJS config
docs/
├── README.md           # Documentation index
├── features.md         # Community guide to user-facing behavior
├── getting-started.md  # Install and first-use guide
├── privacy.md          # Stored data, provider requests, and browser permissions
├── providers.md        # Provider profile setup
└── troubleshooting.md  # Common setup and page-access problems
public/
└── icons/          # Extension icons: icon.svg master + icon-16/32/48/128.png regenerated on change
skills/
└── README.md       # Agent Skills (SKILL.md) format reference; built-in skills live here as <name>/SKILL.md
src/
├── background.ts        # Service worker: config resolution, the streaming tool-calling assistant loop
│                        # (streamText + tools + stopWhen; metadata-only page seed + page-change marker),
│                        # actions via src/cdp.ts; emits PanelEvent parts over 'hibro-panel'
├── remoteImages.ts      # guarded, user-triggered remote image fetches over a dedicated panel port
├── content.ts           # Content script: page perception (Markdown via turndown, overview, tagged interactive
│                        # elements, viewport text, element detail); tags elements with data-hibro-id
├── cdp.ts               # CDP action layer over chrome.debugger: click / type / scroll / navigate / press_key
├── skills.ts            # Agent Skills: load built-in + user skills, URL-match, inject guidance into the agent prompt
├── shared/protocol.ts   # PanelEvent / HibroPart protocol shared by the service worker and the panel
├── shared/imageAssets.ts # supported raster types plus byte/signature/size validation
├── shared/remoteImages.ts # remote image port types and public-looking HTTPS URL policy
├── shared/providerVault.ts # AES-GCM envelope + non-exportable IndexedDB key for provider profiles
├── shared/providers.ts  # encrypted provider profiles (hibroProviders) + active selection/migration
├── shared/language.ts   # shared English / Simplified Chinese preference and storage helpers
├── shared/conversations.ts # last-10 conversation persistence (hibroConversations + activeConversationId)
│                        # + restore/switch; per-conversation lastUrl drives the page-change marker
├── lib/utils.ts         # cn() className combiner (shadcn convention)
├── components/ai-elements/  # Trimmed AI Elements components (copied in, not an npm dep): conversation,
│                        # message (+ MessageResponse/Streamdown), tool
├── panel.html           # Side panel entry; mounts src/panel/main.tsx
├── panel.css            # Tailwind v4 import + shadcn tokens + Streamdown @source + panel layout
├── panel/               # React panel: main.tsx (mount), App.tsx (app bar + collapsible user messages), useHibroChat.ts
│                        # (port adapter + conversation hydrate/persist/switch/rename), ConversationDrawer.tsx (history
│                        # slide-over), ProviderPicker.tsx (custom provider dropdown), MessageActions.tsx
│                        # (click/selection copy+explain pill), mermaidPlugin.ts (lazy Mermaid DiagramPlugin),
│                        # ImageAsset.tsx (provider-inline Blob rendering), RemoteMarkdownImage.tsx
│                        # (inert URL card + guarded one-time load),
│                        # ChartBlock.tsx (```chart JSON→ECharts CustomRenderer), HtmlBlock.tsx (```html
│                        # Code/Preview toggle, sandboxed iframe), i18n.tsx (live panel translations),
│                        # partStreaming.ts (per-message streaming
│                        # context for custom renderers), useInputHistory.ts (ArrowUp/Down recall of sent
│                        # messages, derived from the stored conversations). Send swaps to Stop while busy
├── options.html         # Options entry; mounts src/options/main.tsx
├── options.css
└── options/             # React options: main.tsx (mount), OptionsApp.tsx (AI config + skills CRUD),
                         # i18n.ts (English / Simplified Chinese copy)
e2e/
├── fixtures.ts          # Worker-scoped persistent context (channel chromium + ignoreDefaultArgs
│                        # '--disable-extensions'); extension ID derived from manifest "key"
├── image-assets.spec.ts # pure image-byte and remote-destination policy regressions
├── mock.ts              # Local mock OpenAI-compatible / OpenAI / Anthropic endpoint + fixture page (deterministic)
└── extension.spec.ts    # Serial core-flow tests (load / options / extract / chat stream /
                         # reasoning readout / task / skills / page metadata & page-change marker /
                         # message actions / error card / providers)
eval/
└── run.mjs              # Real LLM-driven agent eval on live arXiv (mock.ts covers mechanics; this
                         # drives a real function-calling model and asserts outcomes). Gated on
                         # HIBRO_EVAL_*.
```

## Conventions

User-facing behavior lives in `docs/features.md`; update it when behavior changes. Keep setup and project orientation in `README.md` and data handling in `docs/privacy.md`.

- **AI config**: named provider profiles (`id` / `name` / `provider` / `baseUrl` / `apiKey` / `model`) are serialized into a versioned AES-GCM envelope at `chrome.storage.local.hibroProviders`; `activeProviderId` stays plaintext because it is an opaque selector. `src/shared/providerVault.ts` keeps the non-exportable key in extension-origin IndexedDB (`hibroVault` / `keys` / `provider-profiles:v1`) and uses a fresh 96-bit IV plus fixed AAD on every write. `src/shared/providers.ts` owns storage, active selection, and one-time migration of plaintext `hibroProviders` and legacy `hibroConfig`; consumers must call `readProviderConfig()` after storage changes rather than casting the envelope. Never create a new key when ciphertext already exists, overwrite unreadable storage, or hardcode credentials. Three provider types: `openai-compatible` (default) / `openai` / `anthropic`.
- **Manifest `key`**: pins the extension ID; do not remove it (the e2e fixtures derive the ID from it).
- **Features**: messaging (part protocol), the unified assistant loop (metadata seed + page-change marker), streaming, page automation tools, agent skills, per-message copy/explain actions, and restricted pages are documented in `docs/features.md`.
- **Image assets**: only a validated AI SDK `file` stream part becomes an `image-asset` with `provider-inline` provenance. Supported types are PNG/JPEG/WebP with matching signatures and a 5 MiB ceiling; current chat adapters may not emit these parts. Arbitrary Markdown URLs never become trusted assets. Eligible HTTPS URLs require a per-image click, are fetched in `src/remoteImages.ts` with credentials/referrer omitted and redirects disabled, and are displayed only through revocable Blob URLs. All IP literals, local/special/single-label hosts, SVG, mismatched types, and oversized bodies are blocked. DNS-to-private-address and rebinding cannot be proven away client-side, so keep that limitation accurate in `docs/privacy.md`. Mermaid/chart/HTML preview must not call this loader.
- **Conversation history**: the panel persists the last 10 conversations (full detail: text + reasoning + provider-inline image asset + tool parts, plus the last send's `lastUrl`) to `chrome.storage.local` (`hibroConversations` + `activeConversationId`), restores the active one on open, starts a thread from the top-right New chat icon, and switches, renames, or deletes history through the titled top-left drawer (`src/shared/conversations.ts`, `src/panel/useHibroChat.ts`, `src/panel/ConversationDrawer.tsx`). Custom titles remain authoritative across later saves. `unlimitedStorage` is declared so full-detail threads don't hit the quota. Persistence is panel-only; the service worker only receives `previousPageUrl` per send for page-change detection. Bytes loaded through the one-time remote Markdown flow are never added to the stored part.
- **Icons**: circular blue-gradient badge (`#60a5fa` → `#1d4ed8`, top highlight) with a white "i", transparent outside the disc. `public/icons/icon.svg` is the design master; regenerate the PNGs with direct IM drawing rather than rasterizing the SVG (IM's built-in renderer drops gradients): `gradient:` base + `DstIn` circle mask (apply the mask to the blurred highlight layer too, or it bleeds past the disc), white glyph drawn at 128px, `PNG32:` output to keep the alpha channel, then `-resize` down to 16/32/48.
- **Language**: AI replies follow the user's/page's language. English remains the source language. Settings and the side panel support English and Simplified Chinese through separate message catalogs. General preferences are stored as a JSON object at `hibroOptions`; open surfaces synchronize through `chrome.storage.onChanged`.
