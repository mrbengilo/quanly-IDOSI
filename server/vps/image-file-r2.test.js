// @vitest-environment node
import { randomBytes } from 'node:crypto'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import sharp from 'sharp'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { encodeImagePreview, ImageFileR2 } from './image-file-r2.mjs'
import { createIdosiServer } from './server.mjs'

const directories = []
const directory = async () => {
  const path = await mkdtemp(resolve(tmpdir(), 'idosi-image-preview-'))
  directories.push(path)
  return path
}
afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

const noisyImage = () => sharp(randomBytes(1400 * 900 * 3), { raw: { width: 1400, height: 900, channels: 3 } }).jpeg({ quality: 25 }).toBuffer()

describe('private image previews', () => {
  it('compresses detailed documents and avatars to their budgets without changing the stored source', async () => {
    const bucket = new ImageFileR2(await directory())
    const key = 'identity-images/E01/front/original.jpg'
    const source = await noisyImage()
    await bucket.put(key, source, { httpMetadata: { contentType: 'image/jpeg' } })
    for (const [variant, budget, edge] of [['identity', 100 * 1024, 1400], ['avatar', 20 * 1024, 256]]) {
      const preview = await bucket.getPreview(key, variant)
      expect(preview.size).toBeLessThanOrEqual(budget)
      expect(preview.httpMetadata.contentType).toBe('image/webp')
      const metadata = await sharp(preview.body).metadata()
      expect(metadata.width).toBeLessThanOrEqual(edge)
      expect(metadata.width / metadata.height).toBeCloseTo(1400 / 900, 2)
      expect(metadata.exif).toBeUndefined()
    }
    expect((await bucket.get(key)).body).toEqual(source)
  })

  it('reuses one encode across 20 simultaneous readers, restarts and invalidates on overwrite/delete', async () => {
    const root = await directory()
    const encodePreview = vi.fn(encodeImagePreview)
    const bucket = new ImageFileR2(root, { encodePreview })
    const key = 'account-avatars/test/avatar.jpg'
    await bucket.put(key, await noisyImage())
    const previews = await Promise.all(Array.from({ length: 20 }, () => bucket.getPreview(key, 'avatar')))
    expect(new Set(previews.map(({ etag }) => etag)).size).toBe(1)
    expect(encodePreview).toHaveBeenCalledOnce()
    const restarted = new ImageFileR2(root, { encodePreview })
    expect((await restarted.getPreview(key, 'avatar')).etag).toBe(previews[0].etag)
    expect(encodePreview).toHaveBeenCalledOnce()
    await bucket.put(key, await sharp({ create: { width: 80, height: 50, channels: 3, background: '#ff0000' } }).png().toBuffer())
    const replaced = await bucket.getPreview(key, 'avatar')
    expect(replaced.etag).not.toBe(previews[0].etag)
    expect(encodePreview).toHaveBeenCalledTimes(2)
    expect((await sharp(replaced.body).metadata()).width).toBe(80)
    await bucket.delete(key)
    expect(await bucket.getPreview(key, 'avatar')).toBeNull()
    expect((await bucket.list({ prefix: 'image-previews/' })).objects).toEqual([])
  })

  it('supports legacy raw files, rejects corrupt images and never serves a stale encode after deletion', async () => {
    const root = await directory()
    const key = 'identity-images/E01/front/legacy.jpg'
    await mkdir(dirname(resolve(root, key)), { recursive: true })
    await writeFile(resolve(root, key), await noisyImage())
    const bucket = new ImageFileR2(root)
    expect((await bucket.getPreview(key, 'identity')).size).toBeLessThanOrEqual(100 * 1024)
    await bucket.put('broken.jpg', new Uint8Array([1, 2, 3]))
    await expect(bucket.getPreview('broken.jpg', 'identity')).rejects.toThrow()
    await expect(bucket.getPreview('../outside', 'identity')).rejects.toThrow()
    await expect(bucket.getPreview(key, 'original')).rejects.toThrow()
    let release
    const encodePreview = vi.fn(() => new Promise((resolveEncode) => { release = resolveEncode }))
    const delayed = new ImageFileR2(root, { encodePreview })
    const pending = delayed.getPreview(key, 'avatar')
    await vi.waitFor(() => expect(encodePreview).toHaveBeenCalledOnce())
    const deletion = delayed.delete(key)
    await vi.waitFor(async () => expect(await delayed.version(key)).toBeNull())
    release(new Uint8Array([1, 2, 3]))
    expect(await pending).toBeNull()
    await deletion
    expect((await delayed.list({ prefix: 'image-previews/' })).objects).toEqual([])
  })

  it('serves only authorized small previews through HTTP without a global history snapshot', async () => {
    const root = await directory()
    const { server, runtime } = createIdosiServer({ databasePath: resolve(root, 'state.sqlite'), imagesDirectory: resolve(root, 'images') })
    runtime.env.BOOTSTRAP_TOKEN = 'preview-fixture'
    await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen))
    const baseUrl = `http://127.0.0.1:${server.address().port}`
    const post = (path, body, headers = {}) => fetch(`${baseUrl}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) })
    try {
      const bytes = await noisyImage()
      const avatarKey = 'account-avatars/legacy-profile-E01/avatar-v1.jpg'
      const peerAvatarKey = 'account-avatars/legacy-profile-E02/avatar-v1.jpg'
      const identityKey = 'identity-images/E01/front/original.jpg'
      const metadata = (key) => ({ key, size: bytes.byteLength, contentType: 'image/jpeg', version: 1, updatedAt: new Date().toISOString() })
      const bootstrap = await post('/api/bootstrap', { username: 'preview.admin', password: 'preview-fixture-password', initialState: {
        stores: [{ id: 'S01', status: 'Đang hoạt động' }, { id: 'S02', status: 'Đang hoạt động' }],
        employees: [
          { id: 'E01', storeId: 'S01', unit: 'store', status: 'Đang làm việc', avatarImage: metadata(avatarKey), identityImages: { front: metadata(identityKey) } },
          { id: 'E02', storeId: 'S02', unit: 'store', status: 'Đang làm việc', avatarImage: metadata(peerAvatarKey) },
          { id: 'M01', storeId: 'S01', unit: 'store_manager', status: 'Đang làm việc' },
          { id: 'H01', storeId: 'BUSINESS_SUPPORT', unit: 'business_support', status: 'Đang làm việc' },
          { id: 'O01', storeId: 'OFFICE', unit: 'office', status: 'Đang làm việc' },
        ],
        orders: [{ id: 'UNRELATED', storeId: 'S02', note: 'unrelated history' }],
      } }, { 'x-idosi-bootstrap-token': 'preview-fixture' })
      expect(bootstrap.status).toBe(201)
      for (const key of [avatarKey, peerAvatarKey, identityKey]) await runtime.env.IDENTITY_IMAGES.put(key, bytes, { httpMetadata: { contentType: 'image/jpeg' } })
      runtime.database.database.prepare(`INSERT INTO users(id,username,username_normalized,display_name,password_hash,password_salt,password_iterations,password_algorithm,role,status,store_id,employee_id,password_updated_at,created_at,updated_at)
        SELECT 'PREVIEW-E1','preview.employee','preview.employee','Preview employee',password_hash,password_salt,password_iterations,password_algorithm,'employee','active','S01','E01',password_updated_at,created_at,updated_at FROM users WHERE username='preview.admin'`).run()
      const login = await (await post('/api/login', { username: 'preview.employee', password: 'preview-fixture-password' })).json()
      const headers = { authorization: `Bearer ${login.token}` }
      const globalRead = vi.spyOn(runtime.database, 'readStateSnapshot')
      const encode = vi.spyOn(runtime.env.IDENTITY_IMAGES, 'encodePreview')
      for (const [path, budget] of [['/api/account-avatars/E01', 20 * 1024], ['/api/account-avatar', 20 * 1024], ['/api/identity-images/E01/front', 100 * 1024]]) {
        const response = await fetch(`${baseUrl}${path}`, { headers })
        expect(response.status).toBe(200)
        expect(response.headers.get('content-type')).toBe('image/webp')
        expect(response.headers.get('cache-control')).toBe('private, no-store')
        const body = await response.arrayBuffer()
        expect(body.byteLength).toBeLessThanOrEqual(budget)
        expect(Number(response.headers.get('content-length'))).toBe(body.byteLength)
      }
      expect(globalRead).not.toHaveBeenCalled()
      expect(encode).toHaveBeenCalledTimes(2)
      expect((await fetch(`${baseUrl}/api/identity-images/E02/front`, { headers })).status).toBe(403)
      const operationalRead = vi.spyOn(runtime.database, 'readStoreStateSnapshot')
      for (const [username, role, store, employee] of [
        ['preview.manager', 'store_manager', 'S01', 'M01'],
        ['preview.support', 'business_support', 'BUSINESS_SUPPORT', 'H01'],
        ['preview.office', 'employee', 'OFFICE', 'O01'],
      ]) {
        runtime.database.database.prepare(`INSERT INTO users(id,username,username_normalized,display_name,password_hash,password_salt,password_iterations,password_algorithm,role,status,store_id,employee_id,password_updated_at,created_at,updated_at)
          SELECT ?,?,?,?,password_hash,password_salt,password_iterations,password_algorithm,?,'active',?,?,password_updated_at,created_at,updated_at FROM users WHERE username='preview.admin'`)
          .run(username, username, username, username, role, store, employee)
      }
      for (const username of ['preview.admin', 'preview.employee', 'preview.manager', 'preview.support', 'preview.office']) {
        const response = await post('/api/login', { username, password: 'preview-fixture-password' })
        expect(response.status, username).toBe(200)
        const viewer = { authorization: `Bearer ${(await response.json()).token}` }
        globalRead.mockClear()
        operationalRead.mockClear()
        const avatar = await fetch(`${baseUrl}/api/account-avatars/E02`, { headers: viewer })
        expect(avatar.status, username).toBe(200)
        expect(avatar.headers.get('content-type')).toBe('image/webp')
        expect((await avatar.arrayBuffer()).byteLength).toBeLessThanOrEqual(20 * 1024)
        expect(globalRead).not.toHaveBeenCalled()
        expect(operationalRead).not.toHaveBeenCalled()
      }
      expect((await fetch(`${baseUrl}/api/account-avatars/E02`)).status).toBe(401)
      expect((await fetch(`${baseUrl}/api/identity-images/E01/front`)).status).toBe(401)
      expect(encode).toHaveBeenCalledTimes(3)
    } finally {
      await new Promise((resolveClose) => server.close(resolveClose))
    }
  })
})
