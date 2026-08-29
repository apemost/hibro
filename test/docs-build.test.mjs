import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url))
const outputDirectory = fileURLToPath(
  new URL('../docs/.vitepress/dist/', import.meta.url),
)
const packageManager = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'

test('builds every public documentation route for the /hibro/ deployment', () => {
  rmSync(outputDirectory, { recursive: true, force: true })

  const build = spawnSync(packageManager, ['docs:build'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  })
  const buildOutput = [build.stdout, build.stderr].filter(Boolean).join('\n')

  assert.equal(
    build.status,
    0,
    `pnpm docs:build failed:\n${buildOutput}`,
  )

  const expectedPages = {
    'index.html': 'Documentation',
    'getting-started.html': 'Getting started',
    'features.html': 'Features',
    'providers.html': 'Provider setup',
    'privacy.html': 'Privacy policy',
    'troubleshooting.html': 'Troubleshooting',
    'skills.html': 'Agent Skills',
  }

  for (const [fileName, expectedText] of Object.entries(expectedPages)) {
    const html = readFileSync(`${outputDirectory}/${fileName}`, 'utf8')
    assert.match(html, new RegExp(expectedText), `${fileName} has its content`)
  }

  const home = readFileSync(`${outputDirectory}/index.html`, 'utf8')
  assert.match(home, /(?:href|src)="\/hibro\/assets\//)
  assert.match(home, /href="\/hibro\/getting-started"/)
  assert.doesNotMatch(home, /(?:href|src)="\/assets\//)
  assert.doesNotMatch(home, /href="\/getting-started"/)
})
