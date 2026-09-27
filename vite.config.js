import { defineConfig } from 'vite';
import { crx } from '@crxjs/vite-plugin';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import manifest from './manifest.json' with { type: 'json' };

const licenseFiles = ['LICENSE', 'NOTICE'];

export default defineConfig(({ mode }) => {
  return {
    plugins: [
      crx({ manifest }),
      react(),
      tailwindcss(),
      {
        name: 'include-license-files',
        generateBundle() {
          for (const fileName of licenseFiles) {
            this.emitFile({
              type: 'asset',
              fileName,
              source: readFileSync(new URL(fileName, import.meta.url)),
            });
          }
        },
      },
    ],
    build: {
      ...(mode === 'eval'
        ? { outDir: '.local/tmp/eval-dist', emptyOutDir: true }
        : {}),
      license: true,
    },
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
