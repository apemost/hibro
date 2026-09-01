import { defineConfig } from 'vite';
import { crx } from '@crxjs/vite-plugin';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';
import manifest from './manifest.json' with { type: 'json' };

export default defineConfig(({ mode }) => {
  return {
    plugins: [crx({ manifest }), react(), tailwindcss()],
    build:
      mode === 'eval'
        ? { outDir: '.local/tmp/eval-dist', emptyOutDir: true }
        : undefined,
    resolve: {
      alias: [
        {
          find: '@',
          replacement: fileURLToPath(new URL('./src', import.meta.url)),
        },
      ],
    },
  };
});
