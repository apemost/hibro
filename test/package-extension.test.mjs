import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const packageScript = join(repositoryRoot, 'scripts/package-extension.mjs');
const packageManager = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';

test('uses dist and releases as the default directories', (t) => {
  const workspace = mkdtempSync(join(tmpdir(), 'hibro-package-test-'));
  const sourceDirectory = join(workspace, 'dist');
  mkdirSync(sourceDirectory);
  writeFileSync(join(sourceDirectory, 'manifest.json'), '{"name":"Hibro"}\n');
  t.after(() => rmSync(workspace, { recursive: true, force: true }));

  const packageRun = spawnSync(process.execPath, [packageScript, 'v1.2.3'], {
    cwd: workspace,
    encoding: 'utf8',
  });
  const packageOutput = [packageRun.stdout, packageRun.stderr]
    .filter(Boolean)
    .join('\n');
  assert.equal(packageRun.status, 0, packageOutput);
  assert.equal(
    existsSync(join(workspace, 'releases', 'hibro-v1.2.3.zip')),
    true,
  );
});

test('creates a tag-named ZIP with extension files at the archive root', (t) => {
  const workspace = mkdtempSync(join(tmpdir(), 'hibro-package-test-'));
  const sourceDirectory = join(workspace, 'dist');
  const outputDirectory = join(workspace, 'releases');
  mkdirSync(join(sourceDirectory, 'assets'), { recursive: true });
  writeFileSync(join(sourceDirectory, 'manifest.json'), '{"name":"Hibro"}\n');
  writeFileSync(join(sourceDirectory, 'assets', 'panel.js'), 'export {}\n');
  t.after(() => rmSync(workspace, { recursive: true, force: true }));

  const packageRun = spawnSync(
    packageManager,
    ['package:extension', '--', 'v1.2.3', sourceDirectory, outputDirectory],
    { cwd: repositoryRoot, encoding: 'utf8' },
  );
  const packageOutput = [packageRun.stdout, packageRun.stderr]
    .filter(Boolean)
    .join('\n');
  assert.equal(packageRun.status, 0, packageOutput);

  const archivePath = join(outputDirectory, 'hibro-v1.2.3.zip');
  const listRun = spawnSync('unzip', ['-Z1', archivePath], {
    encoding: 'utf8',
  });
  assert.equal(listRun.status, 0, listRun.stderr);

  const entries = listRun.stdout.trim().split('\n');
  assert.ok(entries.includes('manifest.json'));
  assert.ok(entries.includes('assets/panel.js'));
  assert.ok(entries.every((entry) => !entry.startsWith('dist/')));
});

test('rejects a tag that is unsafe for an artifact name', (t) => {
  const workspace = mkdtempSync(join(tmpdir(), 'hibro-package-test-'));
  const sourceDirectory = join(workspace, 'dist');
  const outputDirectory = join(workspace, 'releases');
  mkdirSync(sourceDirectory);
  writeFileSync(join(sourceDirectory, 'manifest.json'), '{}\n');
  t.after(() => rmSync(workspace, { recursive: true, force: true }));

  const packageRun = spawnSync(
    process.execPath,
    [packageScript, 'v1.2.3/test', sourceDirectory, outputDirectory],
    { encoding: 'utf8' },
  );

  assert.notEqual(packageRun.status, 0);
  assert.match(packageRun.stderr, /Tag must match/);
});
