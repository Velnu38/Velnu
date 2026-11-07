import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'

// Run after npm run build: this checks emitted assets, without rebuilding or
// depending on a development server that handles CSS differently.
const output = new URL('../dist/', import.meta.url)
const html = await readFile(new URL('index.html', output), 'utf8')
const entryPath = html.match(/<script\b[^>]*\bsrc="([^"]+\.js)"/)?.[1]
assert.ok(entryPath, 'The built HTML includes its JavaScript entry')
const entry = await readFile(new URL(entryPath.replace(/^\//, ''), output), 'utf8')
const stylesheetPaths = [...html.matchAll(/<link\b(?=[^>]*\brel="stylesheet")(?=[^>]*\bhref="([^"]+\.css)")[^>]*>/g)].map(match => match[1])
const styles = (await Promise.all(stylesheetPaths.map(path => readFile(new URL(path.replace(/^\//, ''), output), 'utf8')))).join('\n')

test('the guarded App bootstrap has no split stylesheet to await', () => {
  assert.ok(/import\(["']\.\/App-[^"']+\.js["']\)/.test(entry), 'App remains a guarded dynamic import')
  const splitStyles = [...entry.matchAll(/["']((?:\.?\.?\/)?assets\/[^"']+\.css|\.\/[^"']+\.css)["']/g)].map(match => match[1])
  assert.deepEqual(splitStyles, [], 'Bootstrap imports and preload dependencies contain no split CSS asset')
})

test('bootstrap component styles retain their previous cascade order in the entry stylesheet', () => {
  assert.ok(stylesheetPaths.length, 'Bootstrap styles are linked by the built HTML')
  const markers = [
    '.tier-card-grid{',
    '.private-beta-notice{',
    '.more-navigation{',
    '.finviant-workspace{',
    'button.fin-action-button{',
    '.task-fin-help{',
    '.customer-picker{',
    '.document-action-card,.document-record{',
    '.document-paper{',
  ]
  let previous = -1
  for (const marker of markers) {
    const position = styles.indexOf(marker)
    assert.ok(position > previous, `${marker} follows the preceding bootstrap styles`)
    previous = position
  }
})

test('workspace-only styles still have separate lazy assets', async () => {
  const assets = await readdir(new URL('assets/', output))
  for (const pattern of [/^DashboardPage-.*\.css$/, /^settings-.*\.css$/]) {
    const asset = assets.find(name => pattern.test(name))
    assert.ok(asset, `A lazy stylesheet matching ${pattern} is emitted`)
    assert.ok(!stylesheetPaths.some(path => path.endsWith('/' + asset)), `${asset} is not loaded by the HTML entry`)
  }
})
