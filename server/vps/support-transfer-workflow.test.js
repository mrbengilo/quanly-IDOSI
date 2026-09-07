// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { expect, it, vi } from 'vitest'
import { createIdosiServer } from './server.mjs'
import { STAFF_WORK_CATALOG_SEED_VERSION } from '../../src/domain/compensationPolicies.js'

it('persists support schedules, notifications and checkout precedence through the SQLite projections', async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-09-07T05:10:00Z'))
  const directory = await mkdtemp(resolve(tmpdir(), 'idosi-transfer-'))
  const { server, runtime } = createIdosiServer({ databasePath: resolve(directory, 'state.sqlite'),
    imagesDirectory: resolve(directory, 'images'), bootstrapToken: 'transfer-fixture' })
  await new Promise((done) => server.listen(0, '127.0.0.1', done))
  const base = `http://127.0.0.1:${server.address().port}`
  const post = async (path, body, headers = {}) => {
    const response = await fetch(`${base}${path}`, { method: 'POST',
      headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) })
    return { status: response.status, body: await response.json() }
  }
  const db = runtime.database.database
  const command = (token, type, payload) => post('/api/command', { type, payload, includeState: false,
    expectedVersion: db.prepare("SELECT version FROM app_state WHERE scope_key='global'").get().version,
  }, { authorization: `Bearer ${token}`, 'idempotency-key': crypto.randomUUID() })
  const read = async (token, path) => {
    const response = await fetch(`${base}${path}`, { headers: { authorization: `Bearer ${token}` } })
    const body = await response.json()
    expect(response.status, JSON.stringify(body)).toBe(200)
    return body.state
  }
  const login = async (username) => {
    const response = await post('/api/login', { username, password: 'synthetic-transfer-password' })
    expect(response.status, JSON.stringify(response.body)).toBe(200)
    return response.body
  }
  const transfer = { id: 'TR-SQLITE', employeeId: 'E1', fromStoreId: 'S1', toStoreId: 'S2',
    startAt: '2026-09-07T01:00:00Z', endAt: '2026-09-09T10:00:00Z', hourlySupportRate: 45000, allowance: 180000, status: 'Đã duyệt' }
  const home = { id: 'HOME-AM', storeId: 'S1', name: 'Ca chính', start: '08:00', end: '12:00', active: true }
  const host = { id: 'HOST-PM', storeId: 'S2', name: 'Ca hỗ trợ', start: '12:00', end: '16:00', active: true }
  try {
    const bootstrap = await post('/api/bootstrap', { username: 'fixture.admin', password: 'synthetic-transfer-password', initialState: {
      staffWorkCatalogSeedVersion: STAFF_WORK_CATALOG_SEED_VERSION,
      stores: ['S1', 'S2', 'S3'].map((id) => ({ id, name: `Cửa hàng ${id}` })),
      employees: [{ id: 'E1', storeId: 'S1', name: 'Nhân viên hỗ trợ', unit: 'store', status: 'Đang làm việc', employmentType: 'Part-Time', hourlyRate: 30000 },
        ...['S1', 'S2', 'S3'].map((storeId) => ({ id: `M-${storeId}`, storeId, unit: 'store_manager', name: `Quản lý ${storeId}` }))],
      supportTransfers: [transfer], shiftDefinitions: [home, host, { ...host, id: 'OVERLAP', start: '10:00', end: '14:00' }],
      schedule: [{ id: 'HOME-ASSIGNED', employeeId: 'E1', storeId: 'S1', date: '2026-09-07', shiftIds: [home.id], shiftSnapshots: [home] }],
      attendance: [], notifications: [], orders: [], workCatalogItems: [],
      expenseEntries: [{ id: 'UNCHANGED', storeId: 'S1', amount: 765432, sourceType: 'manual' }],
    } }, { 'x-idosi-bootstrap-token': 'transfer-fixture' })
    expect(bootstrap.status).toBe(201)
    const insert = db.prepare(`INSERT INTO users(id, username, username_normalized, display_name, password_hash, password_salt,
      password_iterations, password_algorithm, role, status, store_id, employee_id, password_updated_at, created_at, updated_at)
      SELECT ?, ?, ?, ?, password_hash, password_salt, password_iterations, password_algorithm, ?, 'active', ?, ?,
      password_updated_at, created_at, updated_at FROM users WHERE username='fixture.admin'`)
    insert.run('U-E1', 'fixture.employee', 'fixture.employee', 'Nhân viên hỗ trợ', 'employee', 'S1', 'E1')
    for (const id of ['S1', 'S2', 'S3']) insert.run(`U-${id}`, `fixture.${id}`, `fixture.${id}`.toLowerCase(), id, 'store_manager', id, `M-${id}`)
    const admin = await login('fixture.admin')
    const homeManager = await login('fixture.S1')
    const hostManager = await login('fixture.S2')
    const otherManager = await login('fixture.S3')
    const employeeBefore = await login('fixture.employee')
    expect(employeeBefore.user.storeId).toBe('S1')
    const beforeMoney = db.prepare("SELECT value_json FROM state_entities WHERE collection_key='expenseEntries'").all()
    const overlap = await command(hostManager.token, 'schedule.assign', { storeId: 'S2', date: '2026-09-07', employeeIds: ['E1'], shiftIds: ['OVERLAP'] })
    expect(overlap.body.error.code).toBe('SCHEDULE_TIME_OVERLAP')
    for (const date of ['2026-09-07', '2026-09-08']) {
      const saved = await command(hostManager.token, 'schedule.assign', { storeId: 'S2', date, employeeIds: ['E1'], shiftIds: [host.id] })
      expect(saved.status, JSON.stringify(saved.body)).toBe(200)
    }
    const planner = await read(hostManager.token, '/api/store-screens/schedule?storeId=S2')
    expect(planner.supportRoster.map((row) => row.id)).toContain('E1')
    expect(planner.scheduleBusy.some((row) => row.storeId === 'S1' && row.employeeId === 'E1')).toBe(true)
    const employee = await login('fixture.employee')
    expect(employee.user).toMatchObject({ storeId: 'S2', homeStoreId: 'S1' })
    for (const [token, path] of [[homeManager.token, '/api/store-screens/overview?storeId=S1'], [hostManager.token, '/api/store-screens/overview?storeId=S2'], [employee.token, '/api/system-screens/employee-home']]) {
      const state = await read(token, path)
      expect(state.notifications.some((notice) => notice.type === 'support-transfer.schedule'), `${path}: ${JSON.stringify(state.notifications)}`).toBe(true)
    }
    expect((await read(otherManager.token, '/api/store-screens/overview?storeId=S3')).notifications).toEqual([])
    const checkedIn = await command(employee.token, 'attendance.check_in', { shiftId: host.id, location: { latitude: 10.8, longitude: 106.7 } })
    expect(checkedIn.status, JSON.stringify(checkedIn.body)).toBe(201)
    const failed = await command(employee.token, 'attendance.check_out', { attendanceId: checkedIn.body.attendance.id,
      cashRevenue: 1, transferRevenue: 0, location: { latitude: 10.8, longitude: 106.7 } })
    expect(failed.body.error.code).toBe('SHIFT_REVENUE_MISMATCH')
    const stopped = await command(admin.token, 'support_transfer.stop', { transferId: transfer.id, reason: 'Thay đổi kế hoạch' })
    expect(stopped.status, JSON.stringify(stopped.body)).toBe(200)
    expect(db.prepare("SELECT value_json FROM state_entities WHERE collection_key='expenseEntries'").all()).toEqual(beforeMoney)
    expect((await login('fixture.employee')).user.storeId).toBe('S2')
    const closed = await command(employee.token, 'attendance.check_out', { attendanceId: checkedIn.body.attendance.id,
      cashRevenue: 0, transferRevenue: 0, location: { latitude: 10.8, longitude: 106.7 } })
    expect(closed.status, JSON.stringify(closed.body)).toBe(200)
    expect((await login('fixture.employee')).user.storeId).toBe('S1')
    const cleared = await command(homeManager.token, 'notification.mark_all_read', { storeId: 'S1' })
    expect(cleared.body.updatedCount).toBeGreaterThan(0)
    expect((await read(employee.token, '/api/system-screens/employee-home')).notifications.some((notice) => !notice.readAt)).toBe(true)
  } finally {
    await new Promise((done) => server.close(done))
    await rm(directory, { recursive: true, force: true })
    vi.useRealTimers()
  }
}, 30_000)
