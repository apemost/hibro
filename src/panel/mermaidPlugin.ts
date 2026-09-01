// Loads Mermaid when the first diagram appears. The published Mermaid v11 code
// does not use eval or new Function, so it works with the extension CSP.

import type { MermaidConfig } from 'mermaid';
import type { DiagramPlugin } from 'streamdown';

let mermaidPromise: Promise<typeof import('mermaid')> | null = null;
const loadMermaid = () => (mermaidPromise ??= import('mermaid'));

function normalizeResourceEscapes(source: string): string {
  return source
    .replace(/&#(x[\da-f]+|\d+);?/gi, (match, raw: string) => {
      const value = raw.toLowerCase().startsWith('x')
        ? Number.parseInt(raw.slice(1), 16)
        : Number.parseInt(raw, 10);
      try {
        return String.fromCodePoint(value);
      } catch {
        return match;
      }
    })
    .replace(/&colon;/gi, ':')
    .replace(/&sol;/gi, '/')
    .replace(
      /\\u(?:\{([\da-f]{1,6})\}|([\da-f]{4}))/gi,
      (match, braced, fixed) => {
        try {
          const raw = braced ?? fixed;
          return String.fromCodePoint(Number.parseInt(raw, 16));
        } catch {
          return match;
        }
      },
    )
    .replace(/\\x([\da-f]{2})/gi, (_match, raw: string) =>
      String.fromCodePoint(Number.parseInt(raw, 16)),
    );
}

function rejectUnsafeResources(source: string): void {
  const normalized = normalizeResourceEscapes(source);
  if (/\bhttps?:|[\\/]{2}/i.test(normalized)) {
    throw new Error('Remote resources are not allowed in Mermaid diagrams.');
  }
  if (/@\{[^}]*\bimg\s*:/is.test(normalized)) {
    throw new Error('Image resources are not allowed in Mermaid diagrams.');
  }
}

// Strict mode sanitizes labels. The panel font and current color scheme keep
// diagrams consistent without loading remote fonts.
const baseConfig = (): MermaidConfig => ({
  startOnLoad: false,
  securityLevel: 'strict',
  suppressErrorRendering: true,
  fontFamily: 'inherit',
  theme: window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'default',
});

let currentConfig: MermaidConfig = baseConfig();

/** Streamdown plugin for lazily rendered Mermaid diagrams. */
export const hibroMermaid: DiagramPlugin = {
  name: 'mermaid',
  type: 'diagram',
  language: 'mermaid',
  getMermaid(config?: MermaidConfig) {
    if (config) currentConfig = { ...baseConfig(), ...config };
    return {
      initialize(cfg: MermaidConfig) {
        currentConfig = { ...currentConfig, ...cfg };
      },
      async render(id: string, source: string) {
        // Mermaid image nodes fetch during layout, before the returned SVG can
        // be sanitized, so reject network addresses and image declarations
        // before loading Mermaid.
        rejectUnsafeResources(source);
        const mermaid = (await loadMermaid()).default;
        mermaid.initialize(currentConfig);
        return await mermaid.render(id, source);
      },
    };
  },
};
