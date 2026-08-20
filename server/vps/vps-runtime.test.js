// @vitest-environment node

import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { FileR2 } from './file-r2.mjs'
import { createSqliteD1 } from './sqlite-d1.mjs'
import { createIdosiServer } from './server.mjs'

const temporaryDirectories = []

const temporaryDirectory = async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'idosi-vps-'))
  temporaryDirectories.push(directory)
  return directory
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('IDOSI VPS runtime', () => {
  it('applies migrations once and rolls back a failed D1 batch', async () => {
    const directory = await temporaryDirectory()
    const databasePath = resolve(directory, 'idosi.sqlite')
    const db = createSqliteD1({ databasePath })
    expect((await db.prepare('SELECT COUNT(*) AS count FROM _vps_migrations').first()).count).toBe(7)

    await expect(db.batch([
      db.prepare("INSERT INTO system_metadata (meta_key, value_json, version, updated_at) VALUES ('rollback-check', '{}', 1, '2026-08-18T00:00:00.000Z')"),
      db.prepare("INSERT INTO system_metadata (meta_key, value_json, version, updated_at) VALUES ('rollback-check', '{}', 1, '2026-08-18T00:00:00.000Z')"),
    ])).rejects.toThrow()
    expect(await db.prepare("SELECT meta_key FROM system_metadata WHERE meta_key = 'rollback-check'").first()).toBeNull()
    db.close()

    const reopened = createSqliteD1({ databasePath })
    expect((await reopened.prepare('SELECT COUNT(*) AS count FROM _vps_migrations').first()).count).toBe(7)
    reopened.close()
  })

  it('stores private identity images under the configured directory', async () => {
    const directory = await temporaryDirectory()
    const bucket = new FileR2(resolve(directory, 'images'))
    const bytes = Uint8Array.from([1, 2, 3, 4])
    await bucket.put('identity-images/E01/front.png', bytes, {
      httpMetadata: { contentType: 'image/png' },
      customMetadata: { employeeId: 'E01' },
    })
    const stored = await bucket.get('identity-images/E01/front.png')
    expect([...stored.body]).toEqual([...bytes])
    expect(stored.httpMetadata.contentType).toBe('image/png')
    expect((await bucket.list({ prefix: 'identity-images/' })).objects.map(({ key }) => key))
      .toEqual(['identity-images/E01/front.png'])
    await expect(bucket.get('../outside')).rejects.toThrow(/Khóa tệp/u)
    await bucket.delete('identity-images/E01/front.png')
    expect(await bucket.get('identity-images/E01/front.png')).toBeNull()
  })

  it('serves the SPA and bootstraps exactly one Admin through HTTP', async () => {
    const directory = await temporaryDirectory()
    const staticDirectory = resolve(directory, 'client')
    await mkdir(staticDirectory, { recursive: true })
    await writeFile(resolve(staticDirectory, 'index.html'), '<!doctype html><title>IDOSI VPS</title>')
    const { server } = createIdosiServer({
      databasePath: resolve(directory, 'idosi.sqlite'),
      imagesDirectory: resolve(directory, 'images'),
      staticDirectory,
      bootstrapToken: 'bootstrap-test-token',
    })
    await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen))
    const address = server.address()
    const baseUrl = `http://127.0.0.1:${address.port}`
    try {
      const health = await fetch(`${baseUrl}/api/health`).then((response) => response.json())
      expect(health).toMatchObject({ ok: true, databaseConfigured: true, identityImageStorageConfigured: true })

      const bootstrapResponse = await fetch(`${baseUrl}/api/bootstrap`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-idosi-bootstrap-token': 'bootstrap-test-token' },
        body: JSON.stringify({
          username: 'admin-vps',
          password: 'secure-vps-password',
          displayName: 'Admin VPS',
          initialState: {},
        }),
      })
      expect(bootstrapResponse.status).toBe(201)

      const loginResponse = await fetch(`${baseUrl}/api/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: 'admin-vps', password: 'secure-vps-password' }),
      })
      const login = await loginResponse.json()
      expect(loginResponse.status).toBe(200)
      expect(login.user).toMatchObject({ username: 'admin-vps', role: 'admin' })

      const bootstrapAgain = await fetch(`${baseUrl}/api/bootstrap`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-idosi-bootstrap-token': 'wrong-token' },
        body: JSON.stringify({ username: 'other-admin', password: 'another-password' }),
      }).then((response) => response.json())
      expect(bootstrapAgain).toMatchObject({ ok: true, initialized: true, alreadyInitialized: true })

      expect(await fetch(`${baseUrl}/employee/home`).then((response) => response.text()))
        .toContain('IDOSI VPS')
      expect(await readFile(resolve(staticDirectory, 'index.html'), 'utf8')).toContain('IDOSI VPS')
    } finally {
      await new Promise((resolveClose) => server.close(resolveClose))
    }
  })
})
