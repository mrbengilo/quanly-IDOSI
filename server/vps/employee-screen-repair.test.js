// @vitest-environment node
import { Buffer } from 'node:buffer'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'
import { DEFAULT_STORE_WORK_CATALOG_ITEMS } from '../../src/domain/compensationPolicies.js'
import { createIdosiServer } from './server.mjs'

it.each([false, true])('preflights employee checklist repairs without repeated global reads (repairable=%s)', async (repairable) => {
  const directory = await mkdtemp(resolve(tmpdir(), 'idosi-screen-repair-'))
  const { server, runtime } = createIdosiServer({
    databasePath: resolve(directory, 'state.sqlite'), imagesDirectory: resolve(directory, 'images'),
    bootstrapToken: 'screen-repair-fixture',
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
      username: 'repair.admin', password: 'synthetic-repair-password',
      initialState: {
        stores: [{ id: 'S1', name: 'Fixture Store' }],
        employees: [{ id: 'E1', storeId: 'S1', unit: 'store', name: 'Fixture Employee' }],
        workCatalogItems: DEFAULT_STORE_WORK_CATALOG_ITEMS,
        attendance: [{
          id: 'A1', storeId: 'S1', employeeId: 'E1', date: '2026-09-05', workDate: '2026-09-05',
          shiftId: 'ca1', checkIn: '08:05', checkInAt: '2026-09-05T01:05:00Z',
          checklistSnapshot: { source: 'work-catalog', storeChecklistRepairVersion: 1, tasks: [] },
        }],
        tasks: [], taskAssignmentHistory: [], orders: [],
      },
    }, { 'x-idosi-bootstrap-token': 'screen-repair-fixture' })
    const admin = await post('/api/login', { username: 'repair.admin', password: 'synthetic-repair-password' })
    await post('/api/command', {
      type: 'user.create', payload: {
        username: 'repair.employee', password: 'synthetic-repair-password',
        displayName: 'Fixture Employee', role: 'employee', storeId: 'S1', employeeId: 'E1',
      },
    }, { authorization: `Bearer ${admin.token}`, 'idempotency-key': 'fixture-create-employee-repair' })
    const login = await post('/api/login', { username: 'repair.employee', password: 'synthetic-repair-password' })
    const database = runtime.database.database
    const readAttendance = () => JSON.parse(database.prepare(
      "SELECT value_json FROM state_entities WHERE scope_key='global' AND collection_key='attendance' AND record_id='A1'",
    ).get().value_json)
    const legacy = { ...readAttendance(), checklistSnapshot: null, ...(!repairable ? { shiftId: '' } : {}) }
    const serialized = JSON.stringify(legacy)
    database.prepare("UPDATE state_entities SET value_json=?, value_bytes=? WHERE scope_key='global' AND collection_key='attendance' AND record_id='A1'")
      .run(serialized, Buffer.byteLength(serialized))
    const initialVersion = database.prepare("SELECT version FROM app_state WHERE scope_key='global'").get().version
    let globalReads = 0
    const readStateSnapshot = runtime.database.readStateSnapshot.bind(runtime.database)
    runtime.database.readStateSnapshot = (...args) => { globalReads += 1; return readStateSnapshot(...args) }
    const read = async (screen) => {
      const response = await fetch(`${base}/api/system-screens/${screen}`, { headers: { authorization: `Bearer ${login.token}` } })
      expect(response.status).toBe(200)
      const payload = await response.json()
      expect(payload.state.employees.map(({ id }) => id)).toEqual(['E1'])
      return payload
    }
    // Overlapping reads may attempt the same repair; canonical persistence must
    // commit once, keep its audit, and never duplicate tasks or assignment rows.
    const first = await Promise.all([read('employee-home'), read('employee-orders')])
    if (repairable) {
      expect(globalReads).toBeGreaterThan(0)
      expect(readAttendance().checklistSnapshot.storeChecklistRepairVersion).toBe(1)
      expect(readAttendance().checklistSnapshot.tasks.some(({ kind }) => kind === 'FIXED_TASK')).toBe(true)
      const tasks = database.prepare("SELECT record_id FROM state_entities WHERE scope_key='global' AND collection_key='tasks'").all()
      expect(tasks.length).toBeGreaterThan(0)
      expect(new Set(tasks.map(({ record_id }) => record_id)).size).toBe(tasks.length)
      expect(database.prepare("SELECT COUNT(*) AS count FROM audit_log WHERE action='attendance.checklist.repair_legacy'").get().count).toBe(1)
      expect(database.prepare("SELECT version FROM app_state WHERE scope_key='global'").get().version).toBe(initialVersion + 1)
    } else {
      expect(globalReads).toBe(0)
      expect(readAttendance()).toEqual(legacy)
      expect(first.every(({ version }) => version === initialVersion)).toBe(true)
    }
    const readsAfterRepair = globalReads
    const again = await read('employee-home')
    expect(globalReads).toBe(readsAfterRepair)
    expect(again.state.tasks || []).toEqual([])
    const tasks = await read('employee-tasks')
    expect(globalReads).toBe(readsAfterRepair)
    expect(tasks.state.tasks.length > 0).toBe(repairable)
  } finally {
    await new Promise((done) => server.close(done))
    await rm(directory, { recursive: true, force: true })
  }
}, 30_000)
