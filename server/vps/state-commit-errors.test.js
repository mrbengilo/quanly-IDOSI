// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { expect, it, vi } from 'vitest'
import { createIdosiServer } from './server.mjs'

it('reports a real database failure as a server error instead of a version conflict', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'idosi-commit-errors-'))
  const { server, runtime } = createIdosiServer({
    databasePath: resolve(directory, 'state.sqlite'),
    imagesDirectory: resolve(directory, 'images'),
    bootstrapToken: 'commit-errors-bootstrap',
    automaticRevenueBonusEnabled: false,
  })
  await new Promise((done) => server.listen(0, '127.0.0.1', done))
  const base = `http://127.0.0.1:${server.address().port}`
  const post = async (path, body, headers = {}) => {
    const response = await fetch(`${base}${path}`, {
      method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body),
    })
    return { status: response.status, body: await response.json() }
  }
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
  try {
    expect((await post('/api/bootstrap', {
      username: 'commit.admin', password: 'commit-admin-password', displayName: 'Commit Admin',
      initialState: { stores: [{ id: 'S1', name: 'Store S1', short: 'S1' }] },
    }, { 'x-idosi-bootstrap-token': 'commit-errors-bootstrap' })).status).toBe(201)
    const login = await post('/api/login', { username: 'commit.admin', password: 'commit-admin-password' })
    const authorization = `Bearer ${login.body.token}`
    const version = login.body.bootstrap.version

    runtime.database.database.exec(`
      CREATE TRIGGER simulated_storage_failure BEFORE INSERT ON audit_log
      WHEN NEW.action = 'store.update'
      BEGIN SELECT RAISE(ABORT, 'simulated storage failure'); END;
    `)
    const failed = await post('/api/command', {
      type: 'store.update', expectedVersion: version, payload: { storeId: 'S1', phone: '0901234567' },
    }, { authorization, 'idempotency-key': 'commit-error-store-0001' })
    expect(failed.status).toBe(500)
    expect(failed.body.error.code).toBe('INTERNAL_ERROR')
    expect(consoleError).toHaveBeenCalledWith('IDOSI state commit failed', expect.objectContaining({
      action: 'store.update', error: expect.stringContaining('simulated storage failure'),
    }))
    expect(runtime.database.database.prepare(
      "SELECT version FROM app_state WHERE scope_key = 'global'",
    ).get().version).toBe(version)

    runtime.database.database.exec('DROP TRIGGER simulated_storage_failure')
    const recovered = await post('/api/command', {
      type: 'store.update', expectedVersion: version, payload: { storeId: 'S1', phone: '0901234567' },
    }, { authorization, 'idempotency-key': 'commit-error-store-0002' })
    expect(recovered.status).toBe(200)
    const stale = await post('/api/command', {
      type: 'store.update', expectedVersion: version, payload: { storeId: 'S1', phone: '0907654321' },
    }, { authorization, 'idempotency-key': 'commit-error-store-0003' })
    expect(stale.status).toBe(409)
    expect(stale.body.error.code).toBe('VERSION_CONFLICT')
  } finally {
    consoleError.mockRestore()
    await new Promise((done) => server.close(done))
    await rm(directory, { recursive: true, force: true })
  }
}, 60_000)
