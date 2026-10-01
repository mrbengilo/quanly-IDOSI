// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { expect, it, vi } from 'vitest'
import { createIdosiServer } from './server.mjs'

const PASSWORD = 'Synthetic-status-password'
const images = { front: { key: 'identity/front-fixture' }, back: { key: 'identity/back-fixture' } }
const storeEmployee = (id, extra = {}) => ({ id, code: id, name: `Nhân viên ${id}`, storeId: 'S1', unit: 'store', status: 'Đang làm việc',
  employmentType: 'Part-Time', hourlyRate: 30000, salary: 30000, phone: '0901234567', cccd: '079123456789', address: 'TP. Hồ Chí Minh',
  startDate: '2026-09-01', age: 22, identityImages: images, ...extra })

it('lets HTKD mark a scoped store employee as departed, locks every login path server-side and keeps data', async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-09-22T09:00:00+07:00'))
  const directory = await mkdtemp(resolve(tmpdir(), 'idosi-employee-status-'))
  const options = { databasePath: resolve(directory, 'state.sqlite'), imagesDirectory: resolve(directory, 'images'),
    bootstrapToken: 'status-fixture', automaticRevenueBonusEnabled: false }
  let server, runtime, base
  const start = async () => {
    ;({ server, runtime } = createIdosiServer(options))
    await new Promise((done) => server.listen(0, '127.0.0.1', done))
    base = `http://127.0.0.1:${server.address().port}`
  }
  const raw = async (path, body, token, headers = {}) => {
    const response = await fetch(`${base}${path}`, { method: body ? 'POST' : 'GET',
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
      ...(body ? { body: JSON.stringify(body) } : {}) })
    return { status: response.status, body: await response.json() }
  }
  const request = async (path, body, token, headers = {}, status = 200) => {
    const result = await raw(path, body, token, headers)
    expect(result.status, JSON.stringify(result.body)).toBe(status)
    return result.body
  }
  const sql = (query) => runtime.database.database.prepare(query)
  const version = () => sql("SELECT version FROM app_state WHERE scope_key='global'").get().version
  const command = (token, type, payload, status = 200, expectedVersion = version()) => request('/api/command',
    { type, payload, expectedVersion }, token, { 'idempotency-key': crypto.randomUUID() }, status)
  const login = (username, status = 200) => request('/api/login', { username, password: PASSWORD }, null, {}, status)
  const userRow = (employeeId) => sql('SELECT id, status, version FROM users WHERE LOWER(employee_id) = LOWER(?)').get(employeeId)
  const liveSessions = (userId) => sql('SELECT COUNT(*) AS n FROM sessions WHERE user_id = ? AND revoked_at IS NULL').get(userId).n
  const profile = async (token, id) => (await request('/api/state', null, token)).state.employees.find((employee) => employee.id === id)
  try {
    await start()
    await request('/api/bootstrap', { username: 'status.admin', password: PASSWORD, initialState: {
      stores: [{ id: 'S1', name: 'Cửa hàng 1' }, { id: 'S2', name: 'Cửa hàng 2' }],
      employees: [
        storeEmployee('E1'),
        storeEmployee('E2'),
        storeEmployee('E3'),
        { id: 'H1', code: 'H1', name: 'HTKD thao tác', storeId: 'BUSINESS_SUPPORT', unit: 'business_support', status: 'Đang làm việc', phone: '0901111111' },
        { id: 'H2', code: 'H2', name: 'HTKD có vai trò cửa hàng', storeId: 'BUSINESS_SUPPORT', unit: 'business_support', status: 'Đang làm việc', phone: '0902222222' },
        storeEmployee('S1-H2', { linkedEmployeeId: 'H2', name: 'HTKD có vai trò cửa hàng' }),
        { id: 'QL1', code: 'QL1', name: 'Quản lý', storeId: 'S1', unit: 'store_manager', status: 'Đang làm việc', phone: '0903333333', identityImages: images },
        { id: 'VP1', code: 'VP1', name: 'Văn phòng', storeId: 'OFFICE', unit: 'office', status: 'Đang làm việc', phone: '0904444444', cccd: '079123456700', identityImages: images },
      ],
      attendance: [{ id: 'ATT-E1-OPEN', employeeId: 'E1', storeId: 'S1', date: '2026-09-22', workDate: '2026-09-22', shiftId: 'ca1',
        checkIn: '08:00', checkInAt: '2026-09-22T01:00:00.000Z', checkOut: null, checkOutAt: null }],
      orders: [{ id: 'ORD-E1', storeId: 'S1', employeeId: 'E1', amount: 100000, paymentMethod: 'Tiền mặt', status: 'Hoàn tất', createdAt: '2026-09-22T02:00:00.000Z' }],
      schedule: [], tasks: [], shiftDefinitions: [],
    } }, null, { 'x-idosi-bootstrap-token': 'status-fixture' }, 201)
    const admin = (await login('status.admin')).token
    for (const [username, role, storeId, employeeId] of [
      ['status.e1', 'employee', 'S1', 'E1'], ['status.e2', 'employee', 'S1', 'E2'], ['status.e3', 'employee', 'S1', 'E3'],
      ['status.h1', 'business_support', 'BUSINESS_SUPPORT', 'H1'], ['status.h2', 'business_support', 'BUSINESS_SUPPORT', 'H2'],
      ['status.ql1', 'store_manager', 'S1', 'QL1'],
    ]) await command(admin, 'user.create', { username, password: PASSWORD, displayName: username, role, storeId, employeeId }, 201)
    await command(admin, 'employee.update', { employeeId: 'E2', status: 'Tạm ngưng' })
    const htkd = (await login('status.h1')).token
    const manager = (await login('status.ql1')).token
    const e1Phone = (await login('status.e1')).token
    const e1Laptop = (await login('status.e1')).token
    const e1User = userRow('E1')
    expect(liveSessions(e1User.id)).toBe(2)

    // Denied paths never write.
    const before = version()
    expect((await command(manager, 'employee.update', { employeeId: 'E1', status: 'Đã nghỉ việc' }, 403)).error.code).toBe('EMPLOYEE_DELETE_FORBIDDEN')
    expect((await command(e1Phone, 'employee.update', { employeeId: 'E1', status: 'Đã nghỉ việc' }, 403)).error.code).toBeTruthy()
    expect((await command(htkd, 'employee.update', { employeeId: 'QL1', status: 'Đã nghỉ việc' }, 403)).error.code).toBe('EMPLOYEE_DELETE_FORBIDDEN')
    expect((await command(htkd, 'employee.update', { employeeId: 'VP1', status: 'Đã nghỉ việc' }, 403)).error.code).toBe('EMPLOYEE_DELETE_FORBIDDEN')
    expect((await command(htkd, 'employee.update', { employeeId: 'H2', status: 'Đã nghỉ việc' }, 403)).error.code).toBe('BUSINESS_SUPPORT_READ_ONLY')
    expect((await command(htkd, 'user.set_status', { userId: e1User.id, status: 'inactive' }, 403, e1User.version)).error.code).toBe('BUSINESS_SUPPORT_READ_ONLY')
    // Stale version: no partial profile/account change.
    await command(htkd, 'employee.update', { employeeId: 'E1', status: 'Đã nghỉ việc' }, 409, before - 1)
    expect(version()).toBe(before)
    expect(userRow('E1').status).toBe('active')

    // HTKD departs E1 with a status-only payload (no password/CCCD re-entry).
    const departed = await command(htkd, 'employee.update', { employeeId: 'E1', status: 'Đã nghỉ làm' })
    expect(departed.employee).toMatchObject({ id: 'E1', status: 'Đã nghỉ việc', cccd: '079123456789', phone: '0901234567' })
    expect(departed.user).toMatchObject({ status: 'inactive' })
    expect(userRow('E1').status).toBe('inactive')
    expect(liveSessions(e1User.id)).toBe(0)
    for (const token of [e1Phone, e1Laptop]) {
      expect((await raw('/api/state', null, token)).status).toBe(401)
      expect((await raw('/api/command', { type: 'notification.mark_all_read', payload: {}, expectedVersion: version() }, token, { 'idempotency-key': crypto.randomUUID() })).status).toBe(401)
      expect((await raw('/api/session/role', { role: 'employee', storeId: 'S1', employeeId: 'E1' }, token)).status).toBe(401)
    }
    expect((await login('status.e1', 403)).error.code).toBe('ACCOUNT_DISABLED')
    const audit = sql("SELECT actor_role, entity_id, metadata_json, request_id FROM audit_log WHERE action = 'employee.update' AND entity_id = 'E1' ORDER BY id DESC LIMIT 1").get()
    expect(audit.actor_role).toBe('business_support')
    expect(audit.request_id).toBeTruthy()
    expect(JSON.parse(audit.metadata_json).statusChange).toMatchObject({ from: 'Đang làm việc', to: 'Đã nghỉ việc', storeId: 'S1', loginScope: 'account' })
    expect(audit.metadata_json).not.toMatch(/password/iu)
    // HTKD cannot reactivate; data is preserved and attendance is not closed.
    expect((await command(htkd, 'employee.update', { employeeId: 'E1', status: 'Đang làm việc' }, 403)).error.code).toBe('EMPLOYEE_REACTIVATE_FORBIDDEN')
    let state = (await request('/api/state', null, admin)).state
    expect(state.attendance.find((row) => row.id === 'ATT-E1-OPEN')).toMatchObject({ checkOutAt: null })
    expect(state.orders.find((row) => row.id === 'ORD-E1')).toBeTruthy()
    expect(state.employees.find((row) => row.id === 'E1')).toMatchObject({ status: 'Đã nghỉ việc' })

    // Legacy "Tạm ngưng" survives an unrelated HTKD edit.
    await command(htkd, 'employee.update', { employeeId: 'E2', name: 'Nhân viên E2 đổi tên', status: 'Tạm nghỉ' })
    expect(await profile(admin, 'E2')).toMatchObject({ status: 'Tạm ngưng', name: 'Nhân viên E2 đổi tên' })

    // Login racing the departure: a session created before the commit is unusable afterwards.
    const e3Racing = (await login('status.e3')).token
    await command(htkd, 'employee.update', { employeeId: 'E3', status: 'Đã nghỉ việc' })
    expect((await raw('/api/state', null, e3Racing)).status).toBe(401)

    // Linked store role of an HTKD login: only that role is removed.
    const h2Base = (await login('status.h2')).token
    const h2Store = (await login('status.h2')).token
    const roles = (await request('/api/session/role', { role: 'employee', storeId: 'S1', employeeId: 'S1-H2' }, h2Store)).user
    expect(roles.role).toBe('employee')
    await command(htkd, 'employee.update', { employeeId: 'S1-H2', status: 'Đã nghỉ việc' })
    expect(userRow('H2').status).toBe('active')
    expect((await raw('/api/state', null, h2Store)).status).toBe(401)
    expect((await raw('/api/state', null, h2Base)).status).toBe(200)
    const relogin = await login('status.h2')
    expect((relogin.user.availableRoles || []).map((option) => option.role)).not.toContain('employee')
    expect((await raw('/api/session/role', { role: 'employee', storeId: 'S1', employeeId: 'S1-H2' }, relogin.token)).status).toBe(400)
    const linkedAudit = sql("SELECT metadata_json FROM audit_log WHERE action = 'employee.update' AND entity_id = 'S1-H2' ORDER BY id DESC LIMIT 1").get()
    expect(JSON.parse(linkedAudit.metadata_json).statusChange.loginScope).toBe('linked-store-role')

    // Restart keeps everything locked.
    await new Promise((done) => server.close(done))
    await start()
    expect((await login('status.e1', 403)).error.code).toBe('ACCOUNT_DISABLED')
    expect((await raw('/api/state', null, e1Laptop)).status).toBe(401)
    const adminAgain = (await login('status.admin')).token
    expect(await profile(adminAgain, 'E1')).toMatchObject({ status: 'Đã nghỉ việc' })

    // Admin restore keeps old sessions revoked; only a new login works.
    await command(adminAgain, 'employee.update', { employeeId: 'E1', status: 'Đang làm việc' })
    expect(userRow('E1').status).toBe('active')
    expect((await raw('/api/state', null, e1Phone)).status).toBe(401)
    expect((await login('status.e1')).token).toBeTruthy()
    state = (await request('/api/state', null, adminAgain)).state
    expect(state.attendance.find((row) => row.id === 'ATT-E1-OPEN')).toMatchObject({ checkOutAt: null })
  } finally {
    if (server?.listening) await new Promise((done) => server.close(done))
    await rm(directory, { recursive: true, force: true })
    vi.useRealTimers()
  }
}, 60_000)
