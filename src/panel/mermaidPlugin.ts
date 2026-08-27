// Loads Mermaid when the first diagram appears. The published Mermaid v11 code
// does not use eval or new Function, so it works with the extension CSP.

import type { MermaidConfig } from "mermaid";
import type { DiagramPlugin } from "streamdown";

let mermaidPromise: Promise<typeof import("mermaid")> | null = null;
const loadMermaid = () => (mermaidPromise ??= import("mermaid"));

// Strict mode sanitizes labels. The panel font and current color scheme keep
// diagrams consistent without loading remote fonts.
const baseConfig = (): MermaidConfig => ({
  startOnLoad: false,
  securityLevel: "strict",
  suppressErrorRendering: true,
  fontFamily: "inherit",
  theme: window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "default"
});

let currentConfig: MermaidConfig = baseConfig();

/** Streamdown plugin for lazily rendered Mermaid diagrams. */
export const hibroMermaid: DiagramPlugin = {
  name: "mermaid",
  type: "diagram",
  language: "mermaid",
  getMermaid(config?: MermaidConfig) {
    if (config) currentConfig = { ...baseConfig(), ...config };
    return {
      initialize(cfg: MermaidConfig) {
        currentConfig = { ...currentConfig, ...cfg };
      },
      async render(id: string, source: string) {
        const mermaid = (await loadMermaid()).default;
        mermaid.initialize(currentConfig);
        return await mermaid.render(id, source);
      }
    };
  }
};
