// @vitest-environment node
import { Buffer } from 'node:buffer'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { expect, it, vi } from 'vitest'
import { createIdosiServer } from './server.mjs'
import { hydrateStateSnapshot, projectSharedState } from '../worker.js'
import { attendanceMatchesWindow, scheduleWindows, supportForScheduledWindow } from '../../src/domain/supportScheduling.js'

it.each([false, true])('loads transfer management without unrelated attendance/checklists or global repair writes (background=%s)', async (backgroundSnapshotReads) => {
  const directory = await mkdtemp(resolve(tmpdir(), 'idosi-transfer-screen-'))
  const { server, runtime } = createIdosiServer({
    databasePath: resolve(directory, 'state.sqlite'), imagesDirectory: resolve(directory, 'images'),
    bootstrapToken: 'transfer-screen-fixture', automaticRevenueBonusEnabled: false, backgroundSnapshotReads,
  })
  await new Promise((done) => server.listen(0, '127.0.0.1', done))
  const base = `http://127.0.0.1:${server.address().port}`
  const post = async (path, body, headers = {}) => {
    const response = await fetch(`${base}${path}`, { method: 'POST',
      headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) })
    const payload = await response.json()
    expect(response.ok, JSON.stringify(payload)).toBe(true)
    return payload
  }
  const db = runtime.database.database
  try {
    await post('/api/bootstrap', { username: 'transfer.screen.admin', password: 'synthetic-transfer-screen-password', initialState: {
      stores: [{ id: 'S1', name: 'Cửa hàng đi' }, { id: 'S2', name: 'Cửa hàng nhận' }],
      employees: [{ id: 'E1', code: 'NV-001', storeId: 'S1', unit: 'store', name: 'Nhân viên hỗ trợ' },
        { id: 'E2', storeId: 'S1', unit: 'store', name: 'Nhân viên khác' },
        { id: 'H1', storeId: 'BUSINESS_SUPPORT', unit: 'business_support', name: 'Nhân viên HTKD' }],
      supportTransfers: [{ id: 'TR1', employeeId: 'E1', fromStoreId: 'S1', toStoreId: 'S2',
        fromDate: '2026-11-17', toDate: '2026-11-18', hourlySupportRate: 45000, allowance: 150000, status: 'Đã duyệt' },
      { id: 'TR-DELETED', employeeId: 'ARCHIVED', fromStoreId: 'S1', toStoreId: 'S2', deletedAt: '2026-11-16', status: 'Đã xóa' }],
      shiftDefinitions: [{ id: 'ca1', storeId: 'S2', name: 'Ca sáng', start: '08:00', end: '12:00' }],
      attendance: [], schedule: [], tasks: [],
    } }, { 'x-idosi-bootstrap-token': 'transfer-screen-fixture' })
    const admin = await post('/api/login', { username: 'transfer.screen.admin', password: 'synthetic-transfer-screen-password' })
    // Copy only synthetic credentials to create allowed/denied actors without
    // command-side reconciliation concealing the legacy repair regression.
    for (const [role, employeeId] of [['business_support', 'H1'], ['employee', 'E2']]) {
      db.prepare(`INSERT INTO users (id, username, username_normalized, display_name, password_hash, password_salt,
        password_iterations, password_algorithm, role, status, store_id, employee_id, password_updated_at, created_at, updated_at)
        SELECT ?, ?, ?, ?, password_hash, password_salt, password_iterations, password_algorithm, ?, status,
          'S1', ?, password_updated_at, created_at, updated_at FROM users WHERE role='admin' LIMIT 1`)
        .run(role, role, role, role, role, employeeId)
    }
    const login = (username) => post('/api/login', { username, password: 'synthetic-transfer-screen-password' })
    const support = await login('business_support')
    const employee = await login('employee')
    const insert = (collection, value, index) => {
      const serialized = JSON.stringify(value)
      db.prepare(`INSERT OR IGNORE INTO state_collections (scope_key, collection_key, created_at, updated_at)
        VALUES ('global', ?, '2026-11-17', '2026-11-17')`).run(collection)
      db.prepare(`INSERT INTO state_entities (scope_key, collection_key, entity_key, entity_order,
        value_json, value_bytes, created_at, updated_at, employee_id, store_id, record_id, open_flag)
        VALUES ('global', ?, ?, ?, ?, ?, '2026-11-17', '2026-11-17', ?, ?, ?, ?)`)
        .run(collection, value.id, index, serialized, Buffer.byteLength(serialized),
          value.employeeId || null, value.storeId || null, value.id, value.checkOutAt ? 0 : 1)
    }
    const checklistSnapshot = { source: 'work-catalog', tasks: [{ name: 'CHECKLIST-PAYLOAD', detail: 'x'.repeat(16_000) }] }
    const attendance = { id: 'ATT1', employeeCode: ' nv-001 ', storeId: 'S2', shiftId: 'ca1', supportTransferId: 'TR1',
      date: '2026-11-17', workDate: '2026-11-17', note: 'Ca hỗ trợ tại cửa hàng nhận', checkInAt: '2026-11-17T01:00:00Z',
      checkOutAt: '2026-11-17T05:00:00Z', workedSeconds: 14400, hours: 4, checklistSnapshot }
    insert('attendance', attendance, 1)
    insert('attendance', { ...attendance, id: 'ATT-LEGACY', supportTransferId: '', date: '2026-11-18', workDate: '2026-11-18' }, 2)
    insert('attendance', { ...attendance, id: 'ATT-ARCHIVED', employeeCode: '', employeeId: 'ARCHIVED', supportTransferId: 'TR-DELETED' }, 3)
    insert('attendance', { ...attendance, id: 'ATT-ORPHAN', employeeCode: '', employeeId: 'MISSING', supportTransferId: 'TR1' }, 4)
    insert('attendance', { ...attendance, id: 'ATT-SUPPORT-OPEN', employeeCode: '', employeeId: 'H1',
      storeId: 'BUSINESS_SUPPORT', unit: 'business_support', supportTransferId: '', checkOutAt: null }, 5)
    for (let index = 0; index < 200; index += 1) {
      // A repairable open row must not cause a read-only transfer page to load
      // and rewrite the complete global task/attendance history.
      insert('attendance', { ...attendance, id: `OTHER-${index}`, employeeCode: '', employeeId: 'E2', storeId: 'S1',
        supportTransferId: '', checkOutAt: null, checklistSnapshot: index ? checklistSnapshot : null }, index + 10)
    }
    insert('schedule', { id: 'SCH1', employeeId: 'E1', storeId: 'S2', date: '2026-11-18', shiftId: 'ca1', supportTransferId: 'TR1' }, 1)
    insert('schedule', { id: 'SCH-OTHER', employeeId: 'E2', storeId: 'S1', date: '2026-11-18', shiftId: 'ca1' }, 2)
    const persistedBefore = db.prepare('SELECT * FROM state_entities ORDER BY collection_key, entity_key').all()
    const headBefore = db.prepare("SELECT version, last_request_id FROM app_state WHERE scope_key='global'").get()
    const globalRead = vi.spyOn(runtime.database, 'readStateSnapshot')
    const screenRead = vi.spyOn(runtime.database, 'readSystemStateSnapshot')
    const collections = ['stores', 'employees', 'supportTransfers', 'attendance', 'schedule', 'shiftDefinitions', 'notifications']
    const fullSnapshot = await runtime.database.readSystemStateSnapshot('global', collections)
    const fullState = JSON.parse(hydrateStateSnapshot(fullSnapshot.row, fullSnapshot.manifests, fullSnapshot.entities).value_json)
    const read = async (token) => {
      const response = await fetch(`${base}/api/system-screens/support-transfers`, { headers: { authorization: `Bearer ${token}` } })
      return { status: response.status, payload: await response.json() }
    }
    for (const actor of [admin, support]) {
      const { status, payload } = await read(actor.token)
      expect(status, JSON.stringify(payload)).toBe(200)
      expect(payload.state.attendance.map(({ id }) => id)).toEqual([
        'ATT1', 'ATT-LEGACY', 'ATT-ARCHIVED', 'ATT-ORPHAN',
        ...(actor.user.role === 'business_support' ? ['ATT-SUPPORT-OPEN'] : []),
      ])
      expect(payload.state.schedule.map(({ id }) => id)).toEqual(['SCH1'])
      expect(payload.state.supportTransfers.map(({ id }) => id)).toEqual(['TR1', 'TR-DELETED'])
      expect(JSON.stringify(payload)).not.toContain('CHECKLIST-PAYLOAD')
      const fullProjected = projectSharedState(fullState, { role: actor.user.role, employee_id: actor.user.employeeId, store_id: actor.user.storeId })
      expect(payload.state.activeAttendanceId).toBe(fullProjected.activeAttendanceId)
      expect(payload.state.checkedInAt).toBe(fullProjected.checkedInAt)
      if (actor.user.role === 'business_support') expect(payload.state.activeAttendanceId).toBe('ATT-SUPPORT-OPEN')
      expect(payload.state.attendance.find(({ id }) => id === 'ATT1').supportCompensation)
        .toEqual(fullProjected.attendance.find(({ id }) => id === 'ATT1').supportCompensation)
      const windows = scheduleWindows(payload.state, { employeeId: 'E1', storeId: 'S2' })
      expect(windows).toHaveLength(1)
      expect(supportForScheduledWindow(payload.state, windows[0])?.id).toBe('TR1')
      expect(payload.state.attendance.some((record) => attendanceMatchesWindow(record, windows[0]))).toBe(true)
      expect(payload.state.attendance.some((record) => record.supportTransferId === 'TR1' && !record.deletedAt)).toBe(true)
      expect(Buffer.byteLength(JSON.stringify(payload))).toBeLessThan(30_000)
    }
    expect((await read(employee.token)).status).toBe(403)
    expect(globalRead).not.toHaveBeenCalled()
    expect(screenRead.mock.calls.some(([, , screen]) => screen === 'support-transfers')).toBe(true)
    expect(db.prepare('SELECT * FROM state_entities ORDER BY collection_key, entity_key').all()).toEqual(persistedBefore)
    expect(db.prepare("SELECT version, last_request_id FROM app_state WHERE scope_key='global'").get()).toEqual(headBefore)
    // Other consumers retain the complete canonical checklist snapshots.
    const unchanged = await runtime.database.readSystemStateSnapshot('global', collections)
    expect(unchanged.entities.find(({ entity_key: id }) => id === 'ATT1').value_json).toContain('CHECKLIST-PAYLOAD')
    expect(Buffer.byteLength(JSON.stringify(fullState))).toBeGreaterThan(3_000_000)
  } finally {
    vi.restoreAllMocks()
    await new Promise((done) => server.close(done))
    await rm(directory, { recursive: true, force: true })
  }
}, 30_000)
