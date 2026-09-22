// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { expect, it, vi } from 'vitest'
import { createIdosiServer } from './server.mjs'
import { STAFF_WORK_CATALOG_SEED_VERSION } from '../../src/domain/compensationPolicies.js'

it('persists same-day shifts and separate attendance across VPS restart', async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-09-22T08:00:00+07:00'))
  const directory = await mkdtemp(resolve(tmpdir(), 'idosi-multi-shift-'))
  const options = { databasePath: resolve(directory, 'state.sqlite'), imagesDirectory: resolve(directory, 'images'),
    bootstrapToken: 'multi-shift-fixture', automaticRevenueBonusEnabled: false }
  let server, runtime, base
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
    const result = await response.json()
    expect(response.ok, JSON.stringify(result)).toBe(true)
    return result
  }
  const command = (token, type, payload) => request('/api/command', { type, payload,
    expectedVersion: runtime.database.database.prepare("SELECT version FROM app_state WHERE scope_key='global'").get().version,
  }, token, { 'idempotency-key': crypto.randomUUID() })
  const login = async (username) => (await request('/api/login', { username, password: 'Synthetic-multi-shift-password' })).token
  const location = { latitude: 10.8, longitude: 106.7, accuracy: 5 }
  const date = '2026-09-22'
  try {
    await start()
    await request('/api/bootstrap', { username: 'multi.admin', password: 'Synthetic-multi-shift-password', initialState: {
      staffWorkCatalogSeedVersion: STAFF_WORK_CATALOG_SEED_VERSION,
      stores: [{ id: 'S1', name: 'Cửa hàng kiểm thử' }],
      employees: [{ id: 'E1', name: 'Nhân viên kiểm thử', storeId: 'S1', unit: 'store', status: 'Đang làm việc', employmentType: 'Part-Time', hourlyRate: 30000 }],
      shiftDefinitions: [{ id: 'AM', storeId: 'S1', name: 'Ca sáng', start: '08:00', end: '12:00', active: true },
        { id: 'PM', storeId: 'S1', name: 'Ca chiều', start: '12:00', end: '17:00', active: true }],
      schedule: [], attendance: [], orders: [], tasks: [], workCatalogItems: [], supportTransfers: [],
    } }, null, { 'x-idosi-bootstrap-token': 'multi-shift-fixture' })
    const admin = await login('multi.admin')
    await command(admin, 'user.create', { username: 'multi.employee', password: 'Synthetic-multi-shift-password',
      displayName: 'Nhân viên kiểm thử', role: 'employee', storeId: 'S1', employeeId: 'E1' })
    const employee = await login('multi.employee')
    await command(admin, 'schedule.assign', { storeId: 'S1', date, employeeIds: ['E1'], shiftIds: ['AM'] })
    const first = await command(employee, 'attendance.check_in', { shiftId: 'AM', location })
    vi.setSystemTime(new Date(`${date}T12:00:00+07:00`))
    const closed = await command(employee, 'attendance.check_out', { attendanceId: first.attendance.id, cashRevenue: 0, transferRevenue: 0, location })
    expect(closed.attendance).toMatchObject({ workedSeconds: 14400, hours: 4 })
    await command(admin, 'schedule.assign', { storeId: 'S1', date, employeeIds: ['E1'], shiftIds: ['PM'] })
    const second = await command(employee, 'attendance.check_in', { shiftId: 'PM', location })
    expect(second.attendance.id).not.toBe(first.attendance.id)
    await new Promise((done) => server.close(done))
    await start()
    const state = (await request('/api/bootstrap', null, employee)).state
    expect(state.schedule).toContainEqual(expect.objectContaining({ employeeId: 'E1', date, shiftIds: ['AM', 'PM'] }))
    expect(state.attendance).toHaveLength(2)
    expect(state.attendance.find((row) => row.id === first.attendance.id)).toMatchObject(closed.attendance)
    expect(state.attendance.find((row) => row.id === second.attendance.id)).toMatchObject({ shiftId: 'PM', checkOut: null })
    const projected = (await request('/api/system-screens/employee-home', null, employee)).state
    expect(projected.schedule[0].shiftIds).toEqual(['AM', 'PM'])
    expect(projected.attendance.some((row) => row.id === second.attendance.id && !row.checkOutAt)).toBe(true)
    expect(runtime.database.database.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action='attendance.check_in'").get().n).toBe(2)
  } finally {
    if (server?.listening) await new Promise((done) => server.close(done))
    await rm(directory, { recursive: true, force: true })
    vi.useRealTimers()
  }
}, 30_000)
