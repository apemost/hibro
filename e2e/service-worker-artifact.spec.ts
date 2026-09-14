import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(dirname, '..', 'dist');

test('service worker bundle uses only static imports', () => {
  const loader = readFileSync(
    path.join(dist, 'service-worker-loader.js'),
    'utf8',
  );
  const workerPath = loader.match(
    /['"]\.\/(assets\/background[^'"]+\.js)['"]/,
  )?.[1];
  expect(workerPath).toBeTruthy();

  const worker = readFileSync(path.join(dist, workerPath!), 'utf8');
  expect(worker).not.toMatch(/\bimport\s*\(/);
});

test('lazy Chart.js bundle stays tree-shaken', () => {
  const assetsDirectory = path.join(dist, 'assets');
  const chartBundles = readdirSync(assetsDirectory).filter((name) =>
    /^chart(?:JsRuntime)?-.*\.js$/.test(name),
  );
  expect(chartBundles).toHaveLength(1);

  const bytes = statSync(path.join(assetsDirectory, chartBundles[0])).size;
  expect(bytes).toBeLessThan(190_000);
});
