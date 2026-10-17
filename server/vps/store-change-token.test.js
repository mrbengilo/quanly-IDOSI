// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { createIdosiServer } from './server.mjs'

// Production incident (2026-10-17): every open screen polled the single global
// version, so each check-in in any store made every client of every store
// reload its screen at shift change. Screens now poll their store's token.

const directories = []
afterEach(async () => {
  vi.useRealTimers()
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

it('moves a store change token only for its own store, shared data and unattributed writes', async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-17T08:00:00+07:00'))
  const directory = await mkdtemp(resolve(tmpdir(), 'idosi-store-change-token-'))
  directories.push(directory)
  const { server, runtime } = createIdosiServer({
    databasePath: resolve(directory, 'state.sqlite'), imagesDirectory: resolve(directory, 'images'),
    bootstrapToken: 'store-change-token', automaticRevenueBonusEnabled: false,
  })
  await new Promise((done) => server.listen(0, '127.0.0.1', done))
  const base = `http://127.0.0.1:${server.address().port}`
  const call = async (method, path, body, token, headers = {}) => {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
    return { status: response.status, payload: await response.json() }
  }
  const database = runtime.database.database
  const version = () => database.prepare("SELECT version FROM app_state WHERE scope_key='global'").get().version
  const command = async (token, type, payload) => {
    const result = await call('POST', '/api/command', { type, payload, expectedVersion: version(), includeState: false }, token,
      { 'idempotency-key': crypto.randomUUID() })
    expect(result.status, JSON.stringify(result.payload)).toBeLessThan(300)
    return result.payload
  }
  const password = 'Synthetic-store-change-token-password'
  try {
    const bootstrap = await call('POST', '/api/bootstrap', {
      username: 'token.admin', password,
      initialState: {
        stores: [{ id: 'S1', name: 'Cửa hàng 1' }, { id: 'S2', name: 'Cửa hàng 2' }],
        employees: [
          { id: 'E1', name: 'Nhân viên 1', storeId: 'S1', unit: 'store', status: 'Đang làm việc' },
          { id: 'E2', name: 'Nhân viên 2', storeId: 'S2', unit: 'store', status: 'Đang làm việc' },
        ],
        shiftDefinitions: [
          { id: 'CA1', storeId: 'S1', name: 'Ca 1', start: '00:00', end: '23:59', active: true },
          { id: 'CA2', storeId: 'S2', name: 'Ca 2', start: '00:00', end: '23:59', active: true },
        ],
        attendance: [], tasks: [], taskAssignmentHistory: [], orders: [], workCatalogItems: [],
      },
    }, null, { 'x-idosi-bootstrap-token': 'store-change-token' })
    expect(bootstrap.status, JSON.stringify(bootstrap.payload)).toBe(201)
    const admin = (await call('POST', '/api/login', { username: 'token.admin', password })).payload.token
    for (const [username, employeeId, storeId] of [['token.e1', 'E1', 'S1'], ['token.e2', 'E2', 'S2']]) {
      await command(admin, 'user.create', { username, password, displayName: employeeId, role: 'employee', storeId, employeeId })
    }
    const e1 = (await call('POST', '/api/login', { username: 'token.e1', password })).payload.token
    const e2 = (await call('POST', '/api/login', { username: 'token.e2', password })).payload.token
    const metadata = async (token, storeId) => (await call('GET', `/api/state-metadata?scope=global&storeId=${storeId}`, null, token)).payload

    // The employee screen names the store its projection was read for.
    const home = await call('GET', '/api/system-screens/employee-home', null, e1)
    expect(home.payload.changeStoreId).toBe('S1')
    const storeScreen = await call('GET', '/api/store-screens/overview?storeId=S2', null, admin)
    expect(storeScreen.payload).toMatchObject({ projection: 'store', storeId: 'S2', changeStoreId: 'S2' })

    const before = await metadata(e1, 'S1')
    expect(before.scopeVersion).toBeLessThanOrEqual(before.version)

    // Another store's check-in moves the global version, not S1's token.
    const location = { latitude: 10.8, longitude: 106.7, accuracy: 5 }
    await command(e2, 'attendance.check_in', { shiftId: 'CA2', location })
    const afterOtherStore = await metadata(e1, 'S1')
    expect(afterOtherStore.version).toBeGreaterThan(before.version)
    expect(afterOtherStore.scopeVersion).toBe(before.scopeVersion)
    expect((await metadata(e2, 'S2')).scopeVersion).toBe(afterOtherStore.version)

    // This store's check-in moves its token to the head version.
    await command(e1, 'attendance.check_in', { shiftId: 'CA1', location })
    const afterOwnStore = await metadata(e1, 'S1')
    expect(afterOwnStore.scopeVersion).toBe(afterOwnStore.version)

    // Shared directory data (stores) reaches every store's token.
    await command(admin, 'store.update', { storeId: 'S2', name: 'Cửa hàng 2', short: 'CH2', phone: '0901234567' })
    const afterDirectory = await metadata(e1, 'S1')
    expect(afterDirectory.scopeVersion).toBe(afterDirectory.version)

    // A version bumped outside the commit bookkeeping (a data fix or a
    // migration) makes every token fall back to the global version.
    database.prepare("UPDATE app_state SET version = version + 1 WHERE scope_key = 'global'").run()
    const afterUnattributed = await metadata(e1, 'S1')
    expect(afterUnattributed.scopeVersion).toBe(afterUnattributed.version)

    // Store staff only get their own store's token; admins any store's.
    expect((await metadata(e1, 'S2')).scopeVersion).toBeUndefined()
    expect((await metadata(admin, 'S2')).scopeVersion).toEqual(expect.any(Number))
    expect((await call('GET', '/api/state-metadata?scope=global', null, e1)).payload.scopeVersion).toBeUndefined()
  } finally {
    await new Promise((done) => server.close(done))
  }
}, 30_000)

it('includes partitions of the store employees and inbound support staff', async () => {
  const { Buffer } = await import('node:buffer')
  const { createSqliteD1 } = await import('./sqlite-d1.mjs')
  const directory = await mkdtemp(resolve(tmpdir(), 'idosi-store-change-partitions-'))
  directories.push(directory)
  const d1 = createSqliteD1({ databasePath: resolve(directory, 'idosi.sqlite') })
  const now = '2026-10-17T01:00:00.000Z'
  const entity = (collectionKey, value, index) => {
    const valueJson = JSON.stringify(value)
    return d1.prepare(`INSERT INTO state_entities (scope_key, collection_key, entity_key, entity_order, value_json, value_bytes,
      created_at, updated_at, store_id, employee_id, record_id) VALUES ('global', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(collectionKey, `${collectionKey}-${index}`, index, valueJson, Buffer.byteLength(valueJson), now, now,
        value.storeId || value.toStoreId || null, value.employeeId || (collectionKey === 'employees' ? value.id : null), value.id)
  }
  try {
    await d1.batch([
      d1.prepare("INSERT INTO app_state (scope_key, value_json, version, updated_at) VALUES ('global', '{}', 10, ?)").bind(now),
      ...['employees', 'supportTransfers'].map((key) => d1.prepare(`INSERT INTO state_collections
        (scope_key, collection_key, created_at, updated_at) VALUES ('global', ?, ?, ?)`).bind(key, now, now)),
      entity('employees', { id: 'E1', storeId: 'S1' }, 1),
      entity('employees', { id: 'E2', storeId: 'S2' }, 2),
      entity('employees', { id: 'E3', storeId: 'S3' }, 3),
      entity('supportTransfers', { id: 'T1', employeeId: 'E3', fromStoreId: 'S3', toStoreId: 'S1' }, 4),
      d1.prepare(`INSERT INTO state_change_partitions (scope_key, partition_key, version, updated_at)
        VALUES ('global', '#attributed', 10, ?), ('global', '*', 3, ?), ('global', 'store:s1', 4, ?),
          ('global', 'store:s2', 9, ?), ('global', 'employee:e1', 6, ?), ('global', 'employee:e3', 8, ?)
        ON CONFLICT(scope_key, partition_key) DO UPDATE SET version = excluded.version`)
        .bind(now, now, now, now, now, now),
    ])
    // E1 works for S1 (6) and E3 supports S1 (8); S2's write (9) is not S1's.
    expect(d1.readStoreChangeVersion('global', 'S1', '')).toBe(8)
    expect(d1.readStoreChangeVersion('global', 'S2', '')).toBe(9)
    // The actor's own partition counts for the actor's view.
    expect(d1.readStoreChangeVersion('global', 'S2', 'E1')).toBe(9)
    expect(d1.readStoreChangeVersion('global', 'S3', 'E1')).toBe(8)
  } finally {
    d1.close()
  }
})
