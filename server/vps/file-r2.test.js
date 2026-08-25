// @vitest-environment node

import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { atomicWriteFile, FileR2 } from './file-r2.mjs'

const key = 'account-avatars/usr_test/avatar.webp'

const options = (version, contentType = 'image/webp') => ({
  httpMetadata: { contentType },
  customMetadata: { userId: 'usr_test', version },
})

describe('FileR2', () => {
  it('stores bytes and metadata in one envelope and ignores a stale legacy sidecar', async () => {
    const directory = await mkdtemp(resolve(tmpdir(), 'idosi-file-r2-envelope-'))
    const root = resolve(directory, 'images')
    const objectPath = resolve(root, ...key.split('/'))
    const sidecarPath = `${objectPath}.idosi-meta.json`
    const bucket = new FileR2(root)

    try {
      await bucket.put(key, Uint8Array.from([1, 2, 3]), options('2'))
      await expect(readFile(sidecarPath)).rejects.toMatchObject({ code: 'ENOENT' })
      await writeFile(sidecarPath, JSON.stringify(options('stale', 'image/png')))

      const object = await bucket.get(key)
      expect([...(object?.body || [])]).toEqual([1, 2, 3])
      expect(object?.size).toBe(3)
      expect(object?.httpMetadata).toEqual({ contentType: 'image/webp' })
      expect(object?.customMetadata).toEqual({ userId: 'usr_test', version: '2' })
      expect((await bucket.list({ prefix: 'account-avatars/' })).objects).toMatchObject([
        { key, size: 3 },
      ])
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('reads legacy raw objects with sidecars and upgrades them on the next write', async () => {
    const directory = await mkdtemp(resolve(tmpdir(), 'idosi-file-r2-legacy-'))
    const root = resolve(directory, 'images')
    const objectPath = resolve(root, ...key.split('/'))
    const sidecarPath = `${objectPath}.idosi-meta.json`
    const bucket = new FileR2(root)

    try {
      await mkdir(dirname(objectPath), { recursive: true })
      await writeFile(objectPath, Uint8Array.from([4, 5, 6]))
      await writeFile(sidecarPath, JSON.stringify(options('legacy')))

      const legacy = await bucket.get(key)
      expect([...(legacy?.body || [])]).toEqual([4, 5, 6])
      expect(legacy?.customMetadata).toEqual({ userId: 'usr_test', version: 'legacy' })

      await bucket.put(key, Uint8Array.from([7, 8]), options('current', 'image/png'))
      await expect(readFile(sidecarPath)).rejects.toMatchObject({ code: 'ENOENT' })
      const current = await bucket.get(key)
      expect([...(current?.body || [])]).toEqual([7, 8])
      expect(current?.httpMetadata).toEqual({ contentType: 'image/png' })
      expect(current?.customMetadata).toEqual({ userId: 'usr_test', version: 'current' })
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('preserves the previous whole object when an atomic replacement fails before rename', async () => {
    const directory = await mkdtemp(resolve(tmpdir(), 'idosi-file-r2-crash-'))
    const root = resolve(directory, 'images')
    const original = new FileR2(root)

    try {
      await original.put(key, Uint8Array.from([1, 2, 3]), options('1'))
      const replacement = new FileR2(root, {
        atomicWriteFile: async (target, value) => {
          await writeFile(`${target}.simulated.tmp`, value)
          throw new Error('simulated crash before rename')
        },
      })

      await expect(replacement.put(key, Uint8Array.from([9, 8, 7]), options('2', 'image/png')))
        .rejects.toThrow('simulated crash before rename')

      const restored = await original.get(key)
      expect([...(restored?.body || [])]).toEqual([1, 2, 3])
      expect(restored?.httpMetadata).toEqual({ contentType: 'image/webp' })
      expect(restored?.customMetadata).toEqual({ userId: 'usr_test', version: '1' })
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('keeps bytes and metadata from the same writer during concurrent overwrites', async () => {
    const directory = await mkdtemp(resolve(tmpdir(), 'idosi-file-r2-concurrent-'))
    const root = resolve(directory, 'images')
    let releaseFirst
    let reportFirstStarted
    const firstStarted = new Promise((resolveStarted) => { reportFirstStarted = resolveStarted })
    const firstCanFinish = new Promise((resolveFinish) => { releaseFirst = resolveFinish })
    let writeCount = 0
    const bucket = new FileR2(root, {
      atomicWriteFile: async (target, value) => {
        writeCount += 1
        if (writeCount === 1) {
          reportFirstStarted()
          await firstCanFinish
        }
        await atomicWriteFile(target, value)
      },
    })

    try {
      const first = bucket.put(key, Uint8Array.from([1, 1, 1]), options('first'))
      await firstStarted
      await bucket.put(key, Uint8Array.from([2, 2]), options('second', 'image/png'))
      releaseFirst()
      await first

      const result = await bucket.get(key)
      expect([...(result?.body || [])]).toEqual([1, 1, 1])
      expect(result?.httpMetadata).toEqual({ contentType: 'image/webp' })
      expect(result?.customMetadata).toEqual({ userId: 'usr_test', version: 'first' })
    } finally {
      releaseFirst?.()
      await rm(directory, { recursive: true, force: true })
    }
  })
})
