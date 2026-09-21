// @vitest-environment node
import { Buffer } from 'node:buffer'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'
import { DEFAULT_STORE_WORK_CATALOG_ITEMS } from '../../src/domain/compensationPolicies.js'
import { createIdosiServer } from './server.mjs'

it('does not reload global history when a store screen omits already persisted checklist tasks', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'idosi-store-screen-repair-'))
  const { server, runtime } = createIdosiServer({
    databasePath: resolve(directory, 'state.sqlite'), imagesDirectory: resolve(directory, 'images'),
    bootstrapToken: 'store-screen-repair', automaticRevenueBonusEnabled: false,
  })
  await new Promise((done) => server.listen(0, '127.0.0.1', done))
  const base = `http://127.0.0.1:${server.address().port}`
  const post = async (path, body, headers = {}) => {
    const response = await fetch(`${base}${path}`, {
      method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body),
    })
    expect(response.ok).toBe(true)
    return response.json()
  }
  try {
    await post('/api/bootstrap', {
      username: 'store.repair.admin', password: 'synthetic-store-repair-password',
      initialState: {
        stores: [{ id: 'S1', name: 'Fixture Store' }, { id: 'S2', name: 'Other Store' }],
        employees: [{ id: 'E1', storeId: 'S1', unit: 'store', name: 'Fixture Employee' }],
        workCatalogItems: DEFAULT_STORE_WORK_CATALOG_ITEMS,
        attendance: [{
          id: 'A1', storeId: 'S1', employeeId: 'E1', date: '2026-09-05', workDate: '2026-09-05',
          shiftId: 'ca1', checkIn: '08:05', checkInAt: '2026-09-05T01:05:00Z',
        }],
        tasks: [], taskAssignmentHistory: [], orders: [],
      },
    }, { 'x-idosi-bootstrap-token': 'store-screen-repair' })
    const admin = await post('/api/login', { username: 'store.repair.admin', password: 'synthetic-store-repair-password' })
    const initial = await fetch(`${base}/api/state`, { headers: { authorization: `Bearer ${admin.token}` } })
    expect(initial.status).toBe(200)
    await initial.arrayBuffer()
    const database = runtime.database.database
    const persistedAttendance = () => JSON.parse(database.prepare(
      "SELECT value_json FROM state_entities WHERE scope_key='global' AND collection_key='attendance' AND record_id='A1'",
    ).get().value_json)
    expect(persistedAttendance().checklistSnapshot.storeChecklistRepairVersion).toBe(1)
    expect(persistedAttendance().checklistSnapshot.tasks.length).toBeGreaterThan(0)
    const initialVersion = database.prepare("SELECT version FROM app_state WHERE scope_key='global'").get().version
    let globalReads = 0
    const readStateSnapshot = runtime.database.readStateSnapshot.bind(runtime.database)
    runtime.database.readStateSnapshot = (...args) => { globalReads += 1; return readStateSnapshot(...args) }
    for (const screen of ['overview', 'attendance', 'payroll', 'orders', 'statistics']) {
      const period = ['overview', 'payroll'].includes(screen) ? '&period=2026-09' : ''
      const response = await fetch(`${base}/api/store-screens/${screen}?storeId=S1${period}`, {
        headers: { authorization: `Bearer ${admin.token}` },
      })
      const payload = await response.json()
      expect(response.status, JSON.stringify(payload.error)).toBe(200)
      expect(payload.version).toBe(initialVersion)
      expect(globalReads, screen).toBe(0)
    }
    // A complete task screen must still detect genuinely missing task rows;
    // the optimization only changes preflights for intentionally partial data.
    const task = database.prepare("SELECT entity_key FROM state_entities WHERE collection_key='tasks' LIMIT 1").get()
    expect(task).toBeDefined()
    database.prepare("DELETE FROM state_entities WHERE collection_key='tasks' AND entity_key=?").run(task.entity_key)
    database.prepare("UPDATE app_state SET version=version+1 WHERE scope_key='global'").run()
    const tasks = await fetch(`${base}/api/store-screens/tasks?storeId=S1`, {
      headers: { authorization: `Bearer ${admin.token}` },
    })
    expect(tasks.status).toBe(200)
    await tasks.arrayBuffer()
    expect(globalReads).toBeGreaterThan(0)
    expect(database.prepare("SELECT version FROM app_state WHERE scope_key='global'").get().version).toBe(initialVersion + 2)
  } finally {
    await new Promise((done) => server.close(done))
    await rm(directory, { recursive: true, force: true })
  }
}, 30_000)

it.each([true, false])('preflights real legacy store repairs without repeat global reads (repairable=%s)', async (repairable) => {
  const directory = await mkdtemp(resolve(tmpdir(), 'idosi-store-legacy-repair-'))
  const { server, runtime } = createIdosiServer({
    databasePath: resolve(directory, 'state.sqlite'), imagesDirectory: resolve(directory, 'images'),
    bootstrapToken: 'store-legacy-repair', automaticRevenueBonusEnabled: false,
  })
  await new Promise((done) => server.listen(0, '127.0.0.1', done))
  const base = `http://127.0.0.1:${server.address().port}`
  const post = async (path, body, headers = {}) => {
    const response = await fetch(`${base}${path}`, {
      method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body),
    })
    const payload = await response.json()
    expect(response.ok, JSON.stringify(payload.error)).toBe(true)
    return payload
  }
  try {
    await post('/api/bootstrap', {
      username: 'legacy.store.admin', password: 'synthetic-store-repair-password',
      initialState: {
        stores: [{ id: 'S1', name: 'Store 1' }, { id: 'S2', name: 'Store 2' }],
        employees: [
          { id: 'E1', storeId: 'S1', unit: 'store', name: 'Employee' },
          { id: 'M1', storeId: 'S1', unit: 'store_manager', name: 'Manager' },
        ],
        attendance: [], tasks: [], taskAssignmentHistory: [], workCatalogItems: DEFAULT_STORE_WORK_CATALOG_ITEMS,
      },
    }, { 'x-idosi-bootstrap-token': 'store-legacy-repair' })
    const admin = await post('/api/login', { username: 'legacy.store.admin', password: 'synthetic-store-repair-password' })
    await post('/api/command', {
      type: 'user.create', payload: { username: 'legacy.store.manager', password: 'synthetic-store-repair-password',
        displayName: 'Manager', role: 'store_manager', storeId: 'S1', employeeId: 'M1' },
    }, { authorization: `Bearer ${admin.token}`, 'idempotency-key': 'create-store-repair-manager' })
    const manager = await post('/api/login', { username: 'legacy.store.manager', password: 'synthetic-store-repair-password' })
    const database = runtime.database.database
    const legacy = { id: 'A1', storeId: 'S1', employeeId: 'E1', date: '2026-09-05', workDate: '2026-09-05',
      shiftId: repairable ? 'ca1' : '', checkIn: '08:05', checkInAt: '2026-09-05T01:05:00Z', checklistSnapshot: null }
    const valueJson = JSON.stringify(legacy)
    database.prepare(`INSERT INTO state_entities
      (scope_key, collection_key, entity_key, entity_order, value_json, value_bytes, created_at, updated_at,
       store_id, employee_id, record_id, open_flag, period_key)
      VALUES ('global', 'attendance', 'fixture-legacy', 1, ?, ?, ?, ?, 'S1', 'E1', 'A1', 1, '2026-09')`)
      .run(valueJson, Buffer.byteLength(valueJson), legacy.checkInAt, legacy.checkInAt)
    database.prepare("UPDATE app_state SET version=version+1 WHERE scope_key='global'").run()
    const initialVersion = database.prepare("SELECT version FROM app_state WHERE scope_key='global'").get().version
    const readAttendance = () => JSON.parse(database.prepare("SELECT value_json FROM state_entities WHERE record_id='A1' AND collection_key='attendance'").get().value_json)
    let globalReads = 0
    const readStateSnapshot = runtime.database.readStateSnapshot.bind(runtime.database)
    runtime.database.readStateSnapshot = (...args) => { globalReads += 1; return readStateSnapshot(...args) }
    const read = async (token, storeId = 'S1') => {
      const response = await fetch(`${base}/api/store-screens/overview?storeId=${storeId}&period=2026-09`, {
        headers: { authorization: `Bearer ${token}` },
      })
      return { status: response.status, payload: await response.json() }
    }
    expect((await read(manager.token, 'S2')).status).toBe(403)
    expect(globalReads).toBe(0)
    const results = await Promise.all([read(admin.token), read(manager.token)])
    expect(results.map(({ status }) => status)).toEqual([200, 200])
    if (repairable) {
      expect(globalReads).toBeGreaterThan(0)
      expect(readAttendance().checklistSnapshot.storeChecklistRepairVersion).toBe(1)
      expect(readAttendance().checklistSnapshot.tasks.length).toBeGreaterThan(0)
    } else {
      expect(globalReads).toBe(0)
      expect(readAttendance()).toEqual(legacy)
    }
    expect(database.prepare("SELECT version FROM app_state WHERE scope_key='global'").get().version)
      .toBe(initialVersion + (repairable ? 1 : 0))
    expect(database.prepare("SELECT COUNT(*) AS count FROM audit_log WHERE action='attendance.checklist.repair_legacy'").get().count)
      .toBe(repairable ? 1 : 0)
    const readsAfterRepair = globalReads
    for (const token of [admin.token, manager.token]) {
      expect((await read(token)).status).toBe(200)
      expect(globalReads).toBe(readsAfterRepair)
    }
  } finally {
    await new Promise((done) => server.close(done))
    await rm(directory, { recursive: true, force: true })
  }
}, 30_000)
