// @vitest-environment node
import { Buffer } from 'node:buffer'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { createIdosiServer } from './server.mjs'

let cleanup = async () => {}
afterEach(async () => cleanup())
it('bounds reward history in SQL, preserves overlays and paging, and enforces store/role scope', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'idosi-task-page-'))
  const { server, runtime } = createIdosiServer({ databasePath: resolve(directory, 'db.sqlite'), imagesDirectory: resolve(directory, 'images'), bootstrapToken: 'task-page-fixture', automaticRevenueBonusEnabled: false })
  await new Promise((done) => server.listen(0, '127.0.0.1', done))
  cleanup = async () => { await new Promise((done) => server.close(done)); await rm(directory, { recursive: true, force: true }) }
  const base = `http://127.0.0.1:${server.address().port}`
  const post = async (path, body, headers = {}) => {
    const response = await fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) })
    const result = await response.json()
    expect(response.ok, JSON.stringify(result)).toBe(true)
    return result
  }
  const password = 'synthetic-task-page-password'
  await post('/api/bootstrap', { username: 'task.page.admin', password, initialState: {
    stores: [{ id: 'S1', name: 'Page Store' }, { id: 'S2', name: 'Other Store' }],
    employees: [{ id: 'M1', name: 'Manager', storeId: 'S1', unit: 'store_manager', position: 'Quản lý cửa hàng' }, { id: 'E1', code: 'ALIAS1', name: 'Page Employee', storeId: 'S1', unit: 'store' }],
  } }, { 'x-idosi-bootstrap-token': 'task-page-fixture' })
  const admin = await post('/api/login', { username: 'task.page.admin', password })
  for (const [username, role, employeeId] of [['task.manager', 'store_manager', 'M1'], ['task.employee', 'employee', 'E1']]) {
    await post('/api/command', { type: 'user.create', payload: { username, password, displayName: username, role, employeeId, storeId: 'S1' } }, { authorization: `Bearer ${admin.token}`, 'idempotency-key': username })
  }
  const manager = await post('/api/login', { username: 'task.manager', password })
  const employee = await post('/api/login', { username: 'task.employee', password })
  const database = runtime.database.database
  const insert = database.prepare(`INSERT INTO state_entities (scope_key, collection_key, entity_key, entity_order, value_json, value_bytes, created_at, updated_at, store_id, employee_id, record_id, occurred_on, period_key)
    VALUES ('global', ?, ?, ?, ?, ?, '2026-09-30', '2026-09-30', ?, ?, ?, ?, '2026-09')`)
  const add = (collection, row, order = 0) => {
    database.prepare("INSERT OR IGNORE INTO state_collections(scope_key,collection_key,created_at,updated_at) VALUES('global',?,'2026-09-30','2026-09-30')").run(collection)
    const json = JSON.stringify(row)
    insert.run(collection, row.id, order, json, Buffer.byteLength(json), row.storeId || null, row.employeeId || null, row.id, row.workDate || row.occurredOn || '2026-09-30')
  }
  for (let i = 1; i <= 31; i++) {
    add('attendance', { id: `A${i}`, storeId: 'S1', employeeId: 'E1', workDate: '2026-09-30', shiftId: i === 1 ? 'old-shift' : 'ca1', checkOut: '18:00',
      checklistSnapshot: { tasks: [{ id: 'R1', kind: 'REWARD_TASK', name: 'Reward', amountVnd: 3000 }] } }, i)
    add('tasks', { id: `T${i}`, storeId: 'S1', checklistAttendanceId: `A${i}`, catalogItemId: 'R1', completed: true }, i)
    add('workCatalogProgress', { id: `P${i}`, storeId: 'S1', attendanceId: `A${i}`, catalogItemId: 'R1', checked: true, compensationEntryId: `C${i}` }, i)
    add('compensationEntries', { id: `C${i}`, storeId: 'S1', status: i === 31 ? 'pending' : 'approved' }, i)
  }
  add('attendance', { id: 'SECRET', storeId: 'S2', employeeId: 'E2', workDate: '2026-09-30', note: 'FOREIGN_SECRET' }, 999)
  add('violations', { id: 'SUPPORT', storeId: 'S2', employeeId: 'ALIAS1', occurredOn: '2026-09-29', period: '2026-09', violationPoints: 5, status: 'ACTIVE', note: 'SUPPORT_PRIVATE_DETAIL' })
  add('taskAssignmentHistory', { id: 'ASSIGN1', storeId: 'S1', progressHistory: [{ employeeId: 'E1' }] })
  database.prepare("UPDATE app_state SET version=version+1 WHERE scope_key='global'").run()
  runtime.database.readStateSnapshot = () => { throw new Error('Forbidden full history read') }
  const read = async (path, token = manager.token) => {
    const response = await fetch(`${base}${path}`, { headers: { authorization: `Bearer ${token}` } })
    return { status: response.status, body: await response.json() }
  }
  const shell = await read('/api/store-screens/tasks?storeId=S1')
  expect(shell.status).toBe(200)
  for (const collection of ['attendance', 'tasks', 'taskAssignmentHistory', 'workCatalogProgress']) expect(shell.body.state[collection] || []).toHaveLength(0)
  const first = await read('/api/store-task-history?storeId=S1&assignmentId=ASSIGN1')
  expect(first.status, JSON.stringify(first.body)).toBe(200)
  expect(first.body.state.attendance.map((row) => row.id)).toEqual(Array.from({ length: 10 }, (_, i) => `A${31 - i}`))
  expect(first.body.state.tasks).toHaveLength(10)
  expect(first.body.state.workCatalogProgress).toHaveLength(10)
  expect(first.body.state.compensationEntries).toHaveLength(10)
  expect(first.body.state.taskAssignmentHistory[0].id).toBe('ASSIGN1')
  expect(first.body.state.violationPointSummaries[0]).toMatchObject({ employeeId: 'E1', points: 5, workBonusBlocked: true })
  expect(JSON.stringify(first.body)).not.toMatch(/FOREIGN_SECRET|SUPPORT_PRIVATE_DETAIL/)
  const seen = [...first.body.state.attendance]
  let page = first.body.page
  while (page.hasMore) {
    const next = await read(`/api/store-task-history?storeId=S1&cursor=${page.nextCursor}`)
    expect(next.status).toBe(200)
    seen.push(...next.body.state.attendance)
    page = next.body.page
  }
  expect(seen).toHaveLength(31)
  expect(new Set(seen.map((row) => row.id)).size).toBe(31)
  expect((await read('/api/store-task-history?storeId=S1&employeeId=ALIAS1')).body.state.attendance).toHaveLength(10)
  const filtered = await read('/api/store-task-history?storeId=S1&shiftId=old-shift')
  expect(filtered.body.state.attendance.map((row) => row.id)).toEqual(['A1'])
  expect((await read('/api/store-task-history?storeId=S1&date=2026-09-01')).body.state.attendance).toHaveLength(0)
  expect((await read('/api/store-task-history?storeId=S2')).status).toBe(403)
  expect((await read('/api/store-task-history?storeId=S1', employee.token)).status).toBe(403)
  expect((await read('/api/store-task-history?storeId=S1&cursor=bad')).status).toBe(400)
  expect((await read('/api/store-screens/task-violations?storeId=S1')).status).toBe(400)
}, 30000)
