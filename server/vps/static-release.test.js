// @vitest-environment node

import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  prepareStaticRelease,
  runStaticReleaseCli,
  STATIC_RELEASE_MARKER,
  verifyStaticRelease,
} from './static-release.mjs'

const RELEASE_SHA = '1234567890abcdef1234567890abcdef12345678'
const OTHER_RELEASE_SHA = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const temporaryDirectories = []

const temporaryDirectory = async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'idosi-static-release-'))
  temporaryDirectories.push(directory)
  return directory
}

const writeStaticFixture = async (root, {
  entryContent = 'console.log("IDOSI")',
  faviconContent = 'favicon',
  html = `<!doctype html>
    <link href="/favicon.png?v=1" sizes="any" rel="shortcut icon">
    <script defer src="/assets/entry.js#release" type="module"></script>`,
  includeEntry = true,
  includeFavicon = true,
  includeIndex = true,
} = {}) => {
  await mkdir(join(root, 'assets'), { recursive: true })
  if (includeIndex) await writeFile(join(root, 'index.html'), html)
  if (includeEntry) await writeFile(join(root, 'assets', 'entry.js'), entryContent)
  if (includeFavicon) await writeFile(join(root, 'favicon.png'), faviconContent)
}

const prepareFixture = async (options = {}) => {
  const root = await temporaryDirectory()
  const source = join(root, 'source')
  const target = join(root, 'target')
  await writeStaticFixture(source, options)
  return { root, source, target }
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0)
    .map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('VPS static release preparation', () => {
  it('copies and verifies a release, then treats the same SHA as idempotent', async () => {
    const { source, target } = await prepareFixture()

    const prepared = await prepareStaticRelease({ sourceDirectory: source, targetDirectory: target, releaseSha: RELEASE_SHA })
    expect(prepared).toMatchObject({
      ok: true,
      copied: true,
      releaseSha: RELEASE_SHA,
      moduleEntries: ['/assets/entry.js#release'],
      favicons: ['/favicon.png?v=1'],
    })
    expect(await readFile(join(target, STATIC_RELEASE_MARKER), 'utf8')).toBe(`${RELEASE_SHA}\n`)
    expect(await readFile(join(target, 'assets', 'entry.js'), 'utf8')).toContain('IDOSI')

    await rm(source, { recursive: true })
    await expect(prepareStaticRelease({
      sourceDirectory: source,
      targetDirectory: target,
      releaseSha: RELEASE_SHA,
    })).resolves.toMatchObject({ ok: true, copied: false, releaseSha: RELEASE_SHA })
    await expect(verifyStaticRelease({ targetDirectory: target, releaseSha: RELEASE_SHA }))
      .resolves.toMatchObject({ ok: true, copied: false })
  })

  it('supports the stable prepare and verify CLI contracts', async () => {
    const { source, target } = await prepareFixture()
    await expect(runStaticReleaseCli([
      'prepare', '--source', source, '--target', target, '--sha', RELEASE_SHA,
    ])).resolves.toMatchObject({ copied: true, releaseSha: RELEASE_SHA })
    await expect(runStaticReleaseCli([
      'verify', '--target', target, '--sha', RELEASE_SHA,
    ])).resolves.toMatchObject({ copied: false, releaseSha: RELEASE_SHA })
    await expect(runStaticReleaseCli([
      'verify', '--source', source, '--target', target, '--sha', RELEASE_SHA,
    ])).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' })
  })

  it('requires an exact lowercase full release SHA', async () => {
    const { source, target } = await prepareFixture()
    for (const releaseSha of ['1234', RELEASE_SHA.toUpperCase(), `${RELEASE_SHA}\n`]) {
      await expect(prepareStaticRelease({ sourceDirectory: source, targetDirectory: target, releaseSha }))
        .rejects.toMatchObject({ code: 'INVALID_RELEASE_SHA' })
    }
  })

  it('rejects a different marker without changing the existing release', async () => {
    const { source, target } = await prepareFixture()
    await mkdir(target)
    await writeStaticFixture(target)
    await writeFile(join(target, STATIC_RELEASE_MARKER), `${OTHER_RELEASE_SHA}\n`)

    await expect(prepareStaticRelease({ sourceDirectory: source, targetDirectory: target, releaseSha: RELEASE_SHA }))
      .rejects.toMatchObject({ code: 'MARKER_MISMATCH' })
    expect(await readFile(join(target, STATIC_RELEASE_MARKER), 'utf8')).toBe(`${OTHER_RELEASE_SHA}\n`)
  })

  it('rejects source and target symlinks', async () => {
    const { root, source, target } = await prepareFixture()
    await writeFile(join(root, 'outside.js'), 'outside')
    await symlink(join(root, 'outside.js'), join(source, 'assets', 'linked.js'))
    await expect(prepareStaticRelease({ sourceDirectory: source, targetDirectory: target, releaseSha: RELEASE_SHA }))
      .rejects.toMatchObject({ code: 'SYMLINK_NOT_ALLOWED' })

    await rm(join(source, 'assets', 'linked.js'))
    const realTarget = join(root, 'real-target')
    await mkdir(realTarget)
    await symlink(realTarget, target)
    await expect(prepareStaticRelease({ sourceDirectory: source, targetDirectory: target, releaseSha: RELEASE_SHA }))
      .rejects.toMatchObject({ code: 'SYMLINK_NOT_ALLOWED' })
  })

  it('rejects a non-empty unpublished target instead of overwriting it', async () => {
    const { source, target } = await prepareFixture()
    await mkdir(target)
    await writeFile(join(target, 'unrelated.txt'), 'keep')
    await expect(prepareStaticRelease({ sourceDirectory: source, targetDirectory: target, releaseSha: RELEASE_SHA }))
      .rejects.toMatchObject({ code: 'TARGET_NOT_EMPTY' })
    expect(await readFile(join(target, 'unrelated.txt'), 'utf8')).toBe('keep')
  })

  it.each([
    {
      name: 'index.html',
      fixture: { includeIndex: false },
      code: 'INDEX_MISSING',
    },
    {
      name: 'module entry declaration',
      fixture: { html: '<link rel="icon" href="/favicon.png">' },
      code: 'MODULE_ENTRY_MISSING',
    },
    {
      name: 'module entry file',
      fixture: { includeEntry: false },
      code: 'ASSET_MISSING',
    },
    {
      name: 'favicon declaration',
      fixture: { html: '<script type="module" src="/assets/entry.js"></script>' },
      code: 'FAVICON_MISSING',
    },
    {
      name: 'favicon file',
      fixture: { includeFavicon: false },
      code: 'ASSET_MISSING',
    },
  ])('rejects a release missing $name and never publishes its marker', async ({ fixture, code }) => {
    const { source, target } = await prepareFixture(fixture)
    await expect(prepareStaticRelease({ sourceDirectory: source, targetDirectory: target, releaseSha: RELEASE_SHA }))
      .rejects.toMatchObject({ code })
    await expect(readFile(join(target, STATIC_RELEASE_MARKER), 'utf8'))
      .rejects.toMatchObject({ code: 'ENOENT' })
  })

  it.each([
    { name: 'module entry', fixture: { entryContent: '' } },
    { name: 'favicon', fixture: { faviconContent: '' } },
  ])('rejects an empty referenced $name and never publishes its marker', async ({ fixture }) => {
    const { source, target } = await prepareFixture(fixture)
    await expect(prepareStaticRelease({ sourceDirectory: source, targetDirectory: target, releaseSha: RELEASE_SHA }))
      .rejects.toMatchObject({ code: 'ASSET_MISSING' })
    await expect(readFile(join(target, STATIC_RELEASE_MARKER), 'utf8'))
      .rejects.toMatchObject({ code: 'ENOENT' })
  })

  it.each([
    '../outside.js',
    '/assets/%2e%2e/outside.js',
    '/assets/%5coutside.js',
    'https://example.com/entry.js',
    'https://static.idosi.invalid/entry.js',
    '//example.com/entry.js',
  ])('rejects unsafe module reference %s', async (reference) => {
    const { source, target } = await prepareFixture({
      html: `<link rel="icon" href="/favicon.png"><script type="module" src="${reference}"></script>`,
    })
    await expect(prepareStaticRelease({ sourceDirectory: source, targetDirectory: target, releaseSha: RELEASE_SHA }))
      .rejects.toMatchObject({ code: 'INVALID_ASSET_REFERENCE' })
  })

  it('requires the release marker in verify-only mode', async () => {
    const { source } = await prepareFixture()
    await expect(verifyStaticRelease({ targetDirectory: source, releaseSha: RELEASE_SHA }))
      .rejects.toMatchObject({ code: 'MARKER_MISSING' })
  })
})
