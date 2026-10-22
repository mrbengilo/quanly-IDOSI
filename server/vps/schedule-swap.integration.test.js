// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { Buffer } from 'node:buffer'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createIdosiServer } from './server.mjs'
import { scheduleSwapRevision } from '../../src/domain/scheduleSwap.js'
import { STAFF_WORK_CATALOG_SEED_VERSION } from '../../src/domain/compensationPolicies.js'

const date = '2026-10-22'
let directory, options, server, runtime, base, admin
const db = () => runtime.database.database
const version = () => db().prepare("SELECT version FROM app_state WHERE scope_key='global'").get().version
const rows = (collection) => db().prepare('SELECT value_json FROM state_entities WHERE collection_key=?').all(collection).map((row) => JSON.parse(row.value_json)).sort((a, b) => String(a.id).localeCompare(String(b.id)))
const audit = () => db().prepare("SELECT * FROM audit_log WHERE action='schedule.swap'").all()
const start = async () => {
  ;({ server, runtime } = createIdosiServer(options))
  await new Promise((done) => server.listen(0, '127.0.0.1', done))
  base = `http://127.0.0.1:${server.address().port}`
}
const request = async (path, body, token, headers = {}) => {
  const response = await fetch(`${base}${path}`, { method: body ? 'POST' : 'GET',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  return { status: response.status, headers: response.headers, body: await response.json() }
}
const login = async (username) => {
  const response = await request('/api/login', { username, password: 'Synthetic-swap-password' })
  expect(response.status, JSON.stringify(response.body)).toBe(200)
  return response.body.token
}
const user = async (role, storeId = 'STORE', requestedEmployeeId) => {
  const employeeId = requestedEmployeeId || (role === 'employee' ? 'A' : role === 'store_manager' ? `M-${storeId}` : 'BS')
  const username = `swap.${role}.${storeId}.${employeeId}`.toLowerCase()
  db().prepare(`INSERT INTO users(id, username, username_normalized, display_name, password_hash, password_salt,
    password_iterations, password_algorithm, role, status, store_id, employee_id, password_updated_at, created_at, updated_at)
    SELECT ?, ?, ?, ?, password_hash, password_salt, password_iterations, password_algorithm, ?, 'active', ?, ?,
    password_updated_at, created_at, updated_at FROM users WHERE username='swap.admin'`)
    .run(crypto.randomUUID(), username, username, role, role, storeId, employeeId)
  return login(username)
}
const payload = (a = 'A', b = 'B') => ({ storeId: 'STORE', date,
  ...Object.fromEntries([['a', a], ['b', b]].map(([side, employeeId]) => {
    const assignment = rows('schedule').find((row) => row.employeeId === employeeId && row.storeId === 'STORE')
    return [side, { employeeId, assignmentId: assignment.id, shiftId: assignment.shiftIds[0], revision: scheduleSwapRevision(assignment) }]
  })),
})
const command = (token = admin, intent = payload(), expectedVersion = version(), key = crypto.randomUUID(), type = 'schedule.swap') =>
  request('/api/command', { type, payload: intent, expectedVersion, includeState: false }, token, { 'idempotency-key': key })

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(`${date}T08:30:00+07:00`))
  directory = await mkdtemp(resolve(tmpdir(), 'idosi-swap-'))
  options = { databasePath: resolve(directory, 'state.sqlite'), imagesDirectory: resolve(directory, 'images'),
    bootstrapToken: 'swap-fixture', automaticRevenueBonusEnabled: false }
  await start()
  const shifts = [['AM', '08:00', '12:00'], ['PM', '12:00', '16:00'], ['EV', '16:00', '20:00']]
    .map(([id, start, end]) => ({ id, storeId: 'STORE', name: id, start, end, active: true }))
  const bootstrap = await request('/api/bootstrap', { username: 'swap.admin', password: 'Synthetic-swap-password', initialState: {
    staffWorkCatalogSeedVersion: STAFF_WORK_CATALOG_SEED_VERSION,
    stores: [{ id: 'STORE', name: 'Fixture store' }, { id: 'OTHER', name: 'Other fixture' }],
    employees: [...['A', 'B', 'C'].map((id) => ({ id, code: `CODE-${id}`, storeId: 'STORE', name: `Employee ${id}`, unit: 'store', status: 'Đang làm việc' })),
      ...['STORE', 'OTHER'].map((storeId) => ({ id: `M-${storeId}`, storeId, name: `Manager ${storeId}`, unit: 'store_manager', status: 'Đang làm việc' })),
      { id: 'BS', storeId: 'BUSINESS_SUPPORT', name: 'Support fixture', unit: 'business_support', status: 'Đang làm việc' }],
    shiftDefinitions: shifts,
    schedule: ['A', 'B', 'C'].map((employeeId, index) => ({ id: `ASS-${employeeId}`, employeeId, storeId: 'STORE', date,
      shiftId: shifts[index].id, shiftIds: [shifts[index].id], shiftSnapshots: [shifts[index]], note: `note-${employeeId}` })),
    attendance: [], orders: [], tasks: [], workCatalogItems: [], payrollPeriods: [], supportTransfers: [], notifications: [],
    expenseEntries: [{ id: 'UNCHANGED', storeId: 'STORE', amount: 123456, sourceType: 'manual' }],
  } }, null, { 'x-idosi-bootstrap-token': 'swap-fixture' })
  expect(bootstrap.status, JSON.stringify(bootstrap.body)).toBe(201)
  admin = await login('swap.admin')
}, 30_000)
afterEach(async () => {
  if (server?.listening) await new Promise((done) => server.close(done))
  await rm(directory, { recursive: true, force: true })
  vi.useRealTimers()
})

it('persists both assignments, real audit actor, replay and projections across restart', async () => {
  const manager = await user('store_manager')
  const employeeA = await user('employee')
  const employeeB = await user('employee', 'STORE', 'B')
  const support = await user('business_support', 'OTHER', '')
  const otherManager = await user('store_manager', 'OTHER', '')
  const intent = { ...payload(), actor: { role: 'admin', id: 'FAKE' } }
  const displayed = await request('/api/store-screens/schedule?storeId=STORE', null, manager)
  for (const side of ['a', 'b']) intent[side].revision = scheduleSwapRevision(displayed.body.state.schedule.find((row) => row.id === intent[side].assignmentId))
  const originalVersion = version()
  const key = crypto.randomUUID()
  const saved = await command(manager, intent, originalVersion, key)
  expect(saved.status, JSON.stringify(saved.body)).toBe(200)
  expect(saved.body.assignments.map((row) => row.shiftIds)).toEqual([['PM'], ['AM']])
  expect(saved.body.assignments).toHaveLength(2)
  expect(audit()).toHaveLength(1)
  expect(audit()[0].actor_role).toBe('store_manager')
  expect(audit()[0].actor_id).not.toBe('FAKE')
  expect(JSON.parse(audit()[0].before_json).map((row) => row.shiftIds)).toEqual([['AM'], ['PM']])
  const replay = await command(manager, intent, saved.body.version, key)
  expect(replay.status).toBe(200)
  expect(replay.headers.get('idempotency-replayed')).toBe('true')
  expect(replay.body.assignments).toEqual(saved.body.assignments)
  expect(audit()).toHaveLength(1)
  const reused = await command(manager, { ...intent, date: '2026-10-23' }, version(), key)
  expect(reused.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED')
  await new Promise((done) => server.close(done)); await start()
  expect(rows('schedule').filter((row) => ['A', 'B'].includes(row.employeeId))).toEqual(saved.body.assignments)
  for (const [token, path, employeeId, expectedShift] of [
    [employeeA, '/api/system-screens/employee-schedule', 'A', 'PM'],
    [employeeB, '/api/system-screens/employee-schedule', 'B', 'AM'],
    [manager, '/api/store-screens/schedule?storeId=STORE', 'A', 'PM'],
    [support, '/api/store-screens/schedule?storeId=STORE', 'B', 'AM'],
  ]) {
    const read = await request(path, null, token)
    expect(read.status, JSON.stringify(read.body)).toBe(200)
    expect(read.body.state.schedule).toContainEqual(expect.objectContaining({ employeeId, shiftIds: [expectedShift] }))
  }
  const outside = await request('/api/store-screens/schedule?storeId=OTHER', null, otherManager)
  expect(outside.body.state.schedule).toEqual([])
  expect(rows('attendance')).toEqual([])
  expect(rows('orders')).toEqual([])
  expect(rows('expenseEntries')).toContainEqual(expect.objectContaining({ id: 'UNCHANGED', amount: 123456 }))
}, 30_000)

it.each(['admin', 'store_manager', 'business_support'])('allows established operations role %s', async (role) => {
  const token = role === 'admin' ? admin : await user(role)
  const result = await command(token)
  expect(result.status, JSON.stringify(result.body)).toBe(200)
})

it('denies employee, wrong store manager, internal-unit support and forged scope', async () => {
  const employee = await user('employee')
  const wrongManager = await user('store_manager', 'OTHER', '')
  const support = await user('business_support', 'OTHER', '')
  const before = rows('schedule')
  for (const [token, intent] of [[employee, payload()], [wrongManager, payload()], [support, { ...payload(), storeId: 'OFFICE' }],
    [wrongManager, { ...payload(), storeId: 'OTHER' }]]) {
    const result = await command(token, intent)
    expect(result.status).toBeGreaterThanOrEqual(400)
    expect(result.body.assignments).toBeUndefined()
  }
  expect(rows('schedule')).toEqual(before)
  expect(audit()).toHaveLength(0)
})

it.each(['employeeId', 'assignmentId', 'shiftId'])('rejects forged %s without partial state or audit', async (field) => {
  const intent = payload(); intent.a[field] = 'WRONG'
  const before = rows('schedule'); const v = version()
  expect((await command(admin, intent)).status).toBe(409)
  expect(version()).toBe(v); expect(rows('schedule')).toEqual(before); expect(audit()).toHaveLength(0)
})

it.each(['audit_log', 'command_receipts'])('rolls back state, audit and receipt when SQLite fails at %s', async (table) => {
  const before = rows('schedule'); const v = version(); const intent = payload(); const key = crypto.randomUUID()
  const receiptCount = db().prepare('SELECT COUNT(*) AS n FROM command_receipts').get().n
  db().exec(`CREATE TRIGGER fail_swap_audit BEFORE INSERT ON ${table} BEGIN SELECT RAISE(ABORT, 'injected swap failure'); END`)
  const failed = await command(admin, intent, v, key)
  expect(failed.status).toBe(500)
  expect(rows('schedule')).toEqual(before); expect(version()).toBe(v); expect(audit()).toHaveLength(0)
  expect(db().prepare('SELECT COUNT(*) AS n FROM command_receipts').get().n).toBe(receiptCount)
  db().exec('DROP TRIGGER fail_swap_audit')
  expect((await command(admin, intent, v, key)).status).toBe(200)
  expect(audit()).toHaveLength(1)
})

it('rejects receipt of a cancelled shift without changing persisted cancellation history', async () => {
  const assignment = rows('schedule').find((row) => row.employeeId === 'A')
  assignment.cancelledShifts = [{ shiftId: 'PM', reason: 'Historical cancellation', cancelledAt: '2026-10-21' }]
  const value = JSON.stringify(assignment)
  expect(db().prepare("UPDATE state_entities SET value_json=?, value_bytes=? WHERE collection_key='schedule' AND json_extract(value_json, '$.id')=?")
    .run(value, Buffer.byteLength(value), assignment.id).changes).toBe(1)
  const before = rows('schedule'); const v = version()
  const receipts = db().prepare('SELECT COUNT(*) AS n FROM command_receipts').get().n
  const result = await command()
  expect(result.status).toBe(409)
  expect(result.body.error.code).toBe('SCHEDULE_CANCELLED_SHIFT')
  expect(rows('schedule')).toEqual(before); expect(version()).toBe(v); expect(audit()).toHaveLength(0)
  expect(db().prepare('SELECT COUNT(*) AS n FROM command_receipts').get().n).toBe(receipts)
})

it.each([['Đã khóa', 'PAYROLL_PERIOD_LOCKED'], ['Đã chi', 'PAYROLL_PERIOD_PAID']])('preserves %s payroll history and blocks the swap', async (status, code) => {
  const value = JSON.stringify({ id: 'LOCKED-PAYROLL', storeId: 'STORE', period: '2026-10', status, rows: [{ employeeId: 'A', salary: 123456 }] })
  db().prepare(`INSERT INTO state_entities(scope_key, collection_key, entity_key, entity_order, value_json, value_bytes, created_at, updated_at)
    VALUES('global', 'payrollPeriods', 'LOCKED-PAYROLL', 0, ?, ?, ?, ?)`).run(value, Buffer.byteLength(value), date, date)
  const before = rows('schedule'); const v = version()
  const result = await command()
  expect(result.body.error.code).toBe(code)
  expect(rows('schedule')).toEqual(before); expect(version()).toBe(v); expect(audit()).toHaveLength(0)
  expect(rows('payrollPeriods')[0].rows).toEqual([{ employeeId: 'A', salary: 123456 }])
})

it.each(['same-pair', 'shared-employee', 'edit'])('serializes concurrent %s intents without lost or reversed shifts', async (kind) => {
  const first = payload(); const v = version()
  const second = kind === 'shared-employee' ? payload('A', 'C') : first
  const results = await Promise.all([command(admin, first, v), kind === 'edit'
    ? command(admin, { storeId: 'STORE', date, employeeIds: ['C'], shiftIds: ['AM'] }, v, crypto.randomUUID(), 'schedule.assign')
    : command(admin, second, v)])
  expect(results.map((result) => result.status).sort()).toEqual([200, 409])
  expect(results.find((result) => result.status === 409).body.error.code).toBe('VERSION_CONFLICT')
  expect(rows('schedule')).toHaveLength(3)
  if (kind !== 'edit') expect(rows('schedule').flatMap((row) => row.shiftIds).sort()).toEqual(['AM', 'EV', 'PM'])
})

it('rejects stale global version and stale selection even with a refreshed version', async () => {
  const intent = payload(); const v = version()
  expect((await command()).status).toBe(200)
  expect((await command(admin, intent, v)).body.error.code).toBe('VERSION_CONFLICT')
  expect((await command(admin, intent, version())).body.error.code).toBe('VERSION_CONFLICT')
  expect(audit()).toHaveLength(1)
})

it.each(['check-in-first', 'swap-first', 'parallel'])('uses authoritative schedule for check-in race: %s', async (order) => {
  const employee = await user('employee'); const intent = payload(); const v = version()
  const checkIn = () => command(employee, { shiftId: 'AM', location: { latitude: 10.8, longitude: 106.7, accuracy: 5 } }, v, crypto.randomUUID(), 'attendance.check_in')
  let swap, attendance
  if (order === 'check-in-first') {
    attendance = await checkIn(); expect(attendance.status, JSON.stringify(attendance.body)).toBe(201)
    swap = await command(admin, intent, version())
    expect(swap.body.error.code).toBe('SCHEDULE_STARTED_IMMUTABLE')
  } else if (order === 'swap-first') {
    swap = await command(); expect(swap.status).toBe(200)
    attendance = await checkIn(); expect(attendance.status).toBeGreaterThanOrEqual(400)
  } else {
    ;[swap, attendance] = await Promise.all([command(admin, intent, v), checkIn()])
    expect([swap.status < 300, attendance.status < 300].filter(Boolean)).toHaveLength(1)
  }
  if (rows('attendance').length) expect(rows('schedule').find((row) => row.employeeId === 'A').shiftIds).toEqual(['AM'])
})
