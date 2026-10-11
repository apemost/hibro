# Translation adapters

`page-translation.ts` owns the content-side lifecycle: collection limits, source IDs, cached text, message validation, and apply/restore/revert. The background engine in `translate.ts` still handles model requests, batches, cancellation and progress.

Adapters own page structure. `select.ts` selects one adapter per collection. `default.ts` handles readable prose; `github.ts` handles GitHub source comments and uses `GitHubCodeLayout` for reversible formatting and spacing.

## Adding a site

1. Add a kebab-case module implementing `TranslationAdapter` from `types.ts`.
2. Add a narrowly scoped condition to `select.ts`, before the ordinary-page fallback. Validate the supported DOM in the adapter. A recognized code view with an unsupported structure must return no sources, rather than fall through to translating code or surrounding UI.
3. Add minimal, sanitized page fixtures and behavior tests. Cover actual DOM variants, including source replacement and any clipped or virtualized containers.

Use static imports. Keep browser perception, assistant skills and model/provider behavior outside this interface. Content-side modules may import shared message types with `import type`; do not introduce runtime dependencies on worker modules or additional content-script chunks.

## Source contract

`collect()` returns source handles in document order. Collection must not change rendering; the controller filters empty text, applies limits and assigns IDs. A handle contains the text sent to the model and its current `element` for source tagging. Site metadata stays in the adapter.

`isCurrent()` checks that the same source is still present with unchanged text, ignoring inserted translations. It may reconnect a recreated element only when its identity and original text match inside the same source root. The controller separately checks the document URL, excluding its fragment.

`render(text, language)` replaces that source's visible translation. Both incoming results and cached restore use this method. Preserve original content, insert model output as text, and use CSSOM styles so restrictive page CSPs do not drop translation styling. Shared helpers in `dom.ts` retain the translation marker, language, direction and ordinary nested-block insertion behavior.

`clear()` disconnects observers and restores adapter-owned styles and attributes. It must be safe before rendering or after a previous clear. It preserves collected source handles for cached restore. The controller then removes common translation nodes and source markers. Recollection and content-script reinjection use the same cleanup path.

## Verification

Run `pnpm typecheck`, `pnpm build`, `pnpm format:check`, and `pnpm test:e2e`. The built content script must remain a single independently injectable classic script.

Test source preservation, result replacement, stale-result rejection, restoration, cache reuse, navigation and DOM replacement. For layout adaptations, verify both position and visibility: matching coordinates do not prove a label is outside a clipping container. Replay saved pages locally with account data and remote scripts removed, and also verify the live site because static fixtures do not exercise its runtime updates.
