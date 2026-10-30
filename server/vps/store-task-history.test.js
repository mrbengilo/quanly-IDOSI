// @vitest-environment node
import { Buffer } from 'node:buffer'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { createIdosiServer } from './server.mjs'
import { workRewardRows, rewardStatistics } from '../../src/pages/compensation/compensationStatistics.js'

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
    add('attendance', { id: `A${i}`, storeId: 'S1', employeeId: 'E1', workDate: '2026-09-30', shiftId: i === 1 ? 'old-shift' : 'ca1', checkOut: '18:00', ignoredEvidence: 'LARGE-UNUSED-EVIDENCE'.repeat(500),
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
  expect((await read('/api/store-task-summary?storeId=S2')).status).toBe(403)
  expect((await read('/api/store-task-summary?storeId=S1', employee.token)).status).toBe(403)
  const summaryRead = async (query = '') => {
    const result = await read('/api/store-task-summary?storeId=S1' + query)
    expect(result.status, JSON.stringify(result.body)).toBe(200)
    expect(result.body.state).toBeUndefined()
    expect(result.body.records).toBeUndefined()
    expect(JSON.stringify(result.body).length).toBeLessThan(6000)
    expect(JSON.stringify(result.body)).not.toMatch(/FOREIGN_SECRET|SUPPORT_PRIVATE_DETAIL|LARGE-UNUSED-EVIDENCE/)
    return result.body.summary
  }
  const update = (collection, id, patch) => {
    const stored = database.prepare('SELECT value_json FROM state_entities WHERE collection_key=? AND record_id=?').get(collection, id)
    const json = JSON.stringify({ ...JSON.parse(stored.value_json), ...patch })
    database.prepare('UPDATE state_entities SET value_json=?, value_bytes=? WHERE collection_key=? AND record_id=?').run(json, Buffer.byteLength(json), collection, id)
    database.prepare("UPDATE app_state SET version=version+1 WHERE scope_key='global'").run()
  }
  expect(await summaryRead()).toMatchObject({ count: 31, totalAmountVnd: 0, statistics: { byEmployee: [{ count: 30, amountVnd: 0 }] } })
  update('violations', 'SUPPORT', { status: 'VOID' })
  const allSummary = await summaryRead()
  expect(allSummary).toMatchObject({ count: 31, totalAmountVnd: 93000, statistics: { byEmployee: [{ count: 30, amountVnd: 90000 }] } })
  expect(await summaryRead('&cursor=not-a-page-cursor')).toEqual(allSummary)
  expect(await summaryRead('&employeeId=ALIAS1')).toEqual(allSummary)
  expect(await summaryRead('&shiftId=old-shift')).toMatchObject({ count: 1, totalAmountVnd: 3000 })
  expect(await summaryRead('&date=2026-09-01')).toMatchObject({ count: 0, totalAmountVnd: 0 })
  expect(await summaryRead('&employeeId=missing')).toMatchObject({ count: 0, totalAmountVnd: 0 })
  update('compensationEntries', 'C31', { status: 'approved' })
  expect(await summaryRead()).toMatchObject({ totalAmountVnd: 93000, statistics: { byEmployee: [{ count: 31, amountVnd: 93000 }] } })
  update('workCatalogProgress', 'P2', { status: 'VOID' })
  expect(await summaryRead()).toMatchObject({ count: 30, totalAmountVnd: 90000 })
  add('employees', { id: 'E2', code: 'ALT2', storeId: 'S1', unit: 'store', name: 'Former Employee', status: 'Đã nghỉ việc' })
  add('attendance', { id: 'OLD', storeId: 'S1', employeeId: 'ALT2', workDate: '', date: '2026-08-20', shiftId: 'old-shift', checklistSnapshot: { tasks: [{ id: 'R1', kind: 'reward_task', amountVnd: 7000 }] } })
  add('tasks', { id: 'OLD-TASK', storeId: 'S1', checklistAttendanceId: 'OLD', catalogItemId: 'R1', completedBy: { ALT2: true } })
  add('attendance', { id: 'OCT', storeId: 'S1', employeeId: 'E1', workDate: '2026-10-15', shiftId: 'ca1', checklistSnapshot: { tasks: [{ id: 'R1', rewardEligible: true, amountVnd: 12000 }] } })
  add('workCatalogProgress', { id: 'OCT-P', storeId: 'S1', attendanceId: 'OCT', catalogItemId: 'R1', checked: true, status: 'CLAIMED' })
  add('violations', { id: 'OCT-POINT', storeId: 'S2', employeeId: 'ALIAS1', occurredOn: '2026-10-29', period: '2026-10', violationPoints: 5, status: 'ACTIVE' })
  database.prepare("UPDATE app_state SET version=version+1 WHERE scope_key='global'").run()
  expect(await summaryRead('&date=2026-08-20&employeeId=E2&shiftId=old-shift')).toMatchObject({ count: 1, totalAmountVnd: 7000 })
  expect(await summaryRead('&date=2026-10-15&employeeId=E1')).toMatchObject({ count: 1, totalAmountVnd: 0 })
  const rawState = Object.fromEntries(['attendance', 'tasks', 'workCatalogProgress', 'compensationEntries', 'violations', 'employees'].map((collection) => [collection,
    database.prepare('SELECT value_json FROM state_entities WHERE collection_key=? ORDER BY entity_order, entity_key').all(collection).map((row) => JSON.parse(row.value_json))]))
  const canonical = workRewardRows({ ...rawState, targetUnit: 'store', storeId: 'S1' })
  const canonicalHistory = canonical.filter((row) => row.completed && row.payoutStatus !== 'void')
  expect(await summaryRead()).toEqual({ count: canonicalHistory.length, totalAmountVnd: canonicalHistory.reduce((sum, row) => sum + row.amountVnd, 0), statistics: rewardStatistics(canonical) })
}, 30000)
