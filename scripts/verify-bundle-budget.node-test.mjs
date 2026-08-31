import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  collectEntryAssetReferences,
  verifyBundleBudgets,
} from './verify-bundle-budget.mjs'

const TEST_BUDGETS = {
  initialJavaScript: 10,
  entryCss: 10,
  favicon: 10,
}

async function createClientOutput(
  root,
  { nested = false, jsBytes = 5, preloadBytes = 4, cssBytes = 5, faviconBytes = 5 } = {},
) {
  const outputDirectory = nested ? join(root, 'client') : root
  await mkdir(join(outputDirectory, 'assets'), { recursive: true })
  await writeFile(join(outputDirectory, 'index.html'), `
    <link href="./assets/index-CSS123.css" rel="stylesheet">
    <link type="image/png" href="/favicon.png?v=1" rel="shortcut icon">
    <link href="./assets/AppContext-PRELOAD123.js" rel="modulepreload">
    <link href="./assets/index-JS123.js" rel="modulepreload">
    <script src="./assets/index-JS123.js" type="module"></script>
  `)
  await writeFile(join(outputDirectory, 'assets', 'index-JS123.js'), Buffer.alloc(jsBytes))
  await writeFile(join(outputDirectory, 'assets', 'AppContext-PRELOAD123.js'), Buffer.alloc(preloadBytes))
  await writeFile(join(outputDirectory, 'assets', 'index-CSS123.css'), Buffer.alloc(cssBytes))
  await writeFile(join(outputDirectory, 'favicon.png'), Buffer.alloc(faviconBytes))
}

test('collectEntryAssetReferences supports Vite tags regardless of attribute order', () => {
  assert.deepEqual(
    collectEntryAssetReferences(`
      <link href="./assets/app-HASH.css" rel="stylesheet">
      <link rel="shortcut icon" href="/favicon.png">
      <link href="./assets/context-HASH.js" rel="modulepreload">
      <script src="./assets/app-HASH.js" type="module"></script>
    `),
    {
      initialJavaScript: ['./assets/app-HASH.js', './assets/context-HASH.js'],
      entryCss: ['./assets/app-HASH.css'],
      favicon: ['/favicon.png'],
    },
  )
})

test('verifyBundleBudgets supports Vite dist and prepared dist/client outputs', async (context) => {
  const distDirectory = await mkdtemp(join(tmpdir(), 'idosi-bundle-budget-'))
  context.after(() => rm(distDirectory, { recursive: true, force: true }))

  await createClientOutput(distDirectory)
  await createClientOutput(distDirectory, { nested: true })

  const results = await verifyBundleBudgets({ distDirectory, budgets: TEST_BUDGETS })

  assert.equal(results.length, 2)
  assert.deepEqual(results.map(({ groups }) => groups.initialJavaScript.totalBytes), [9, 9])
})

test('verifyBundleBudgets rejects oversized initial JavaScript with a useful error', async (context) => {
  const distDirectory = await mkdtemp(join(tmpdir(), 'idosi-bundle-budget-'))
  context.after(() => rm(distDirectory, { recursive: true, force: true }))

  await createClientOutput(distDirectory, { jsBytes: 7 })

  await assert.rejects(
    verifyBundleBudgets({ distDirectory, budgets: TEST_BUDGETS }),
    /initial JavaScript: 0\.0 KiB > 0\.0 KiB \[assets[/\\]index-JS123\.js \(0\.0 KiB\)/u,
  )
})

test('verifyBundleBudgets rejects an oversized favicon', async (context) => {
  const distDirectory = await mkdtemp(join(tmpdir(), 'idosi-bundle-budget-'))
  context.after(() => rm(distDirectory, { recursive: true, force: true }))

  await createClientOutput(distDirectory, { faviconBytes: 11 })

  await assert.rejects(
    verifyBundleBudgets({ distDirectory, budgets: TEST_BUDGETS }),
    /favicon: 0\.0 KiB > 0\.0 KiB/u,
  )
})

test('verifyBundleBudgets rejects oversized entry CSS', async (context) => {
  const distDirectory = await mkdtemp(join(tmpdir(), 'idosi-bundle-budget-'))
  context.after(() => rm(distDirectory, { recursive: true, force: true }))

  await createClientOutput(distDirectory, { cssBytes: 11 })

  await assert.rejects(
    verifyBundleBudgets({ distDirectory, budgets: TEST_BUDGETS }),
    /entry CSS: 0\.0 KiB > 0\.0 KiB/u,
  )
})
