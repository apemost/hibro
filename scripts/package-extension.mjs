// Packages a built browser extension as a ZIP with files at the archive root.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

const scriptArguments = process.argv.slice(2);
if (scriptArguments[0] === '--') {
  scriptArguments.shift();
}

const [tag, sourceArgument = 'dist', outputArgument = 'releases'] =
  scriptArguments;

if (!tag) {
  throw new Error(
    'Usage: node scripts/package-extension.mjs <tag> [source] [output]',
  );
}

if (!/^v[0-9A-Za-z][0-9A-Za-z._+-]*$/.test(tag)) {
  throw new Error(
    'Tag must match v followed by filename-safe letters, numbers, dots, underscores, plus signs, or hyphens',
  );
}

const sourceDirectory = resolve(sourceArgument);
const outputDirectory = resolve(outputArgument);
const archivePath = join(outputDirectory, `hibro-${tag}.zip`);

for (const fileName of ['LICENSE', 'NOTICE', '.vite/license.md']) {
  if (!existsSync(join(sourceDirectory, fileName))) {
    throw new Error(`Missing required license file: ${fileName}`);
  }
}

mkdirSync(outputDirectory, { recursive: true });
rmSync(archivePath, { force: true });

const zip = spawnSync('zip', ['-q', '-r', archivePath, '.'], {
  cwd: sourceDirectory,
  stdio: 'inherit',
});

if (zip.error) {
  throw zip.error;
}

if (zip.status !== 0) {
  throw new Error(`zip exited with status ${zip.status}`);
}

console.log(archivePath);
