// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'
import { createIdosiServer } from './server.mjs'
import { workRewardRows } from '../../src/pages/compensation/compensationStatistics.js'

it('keeps HTKD rewards, legacy references and violation inputs while excluding store task history', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'idosi-support-screen-'))
  const { server, runtime } = createIdosiServer({
    databasePath: resolve(directory, 'state.sqlite'), imagesDirectory: resolve(directory, 'images'),
    bootstrapToken: 'support-screen-fixture',
  })
  await new Promise((done) => server.listen(0, '127.0.0.1', done))
  const base = `http://127.0.0.1:${server.address().port}`
  const post = async (path, body, headers = {}) => {
    const response = await fetch(`${base}${path}`, {
      method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body),
    })
    const payload = await response.json()
    expect(response.ok, JSON.stringify(payload)).toBe(true)
    return payload
  }
  const reward = { id: 'REWARD', name: 'Fixture reward', kind: 'REWARD_TASK', amountVnd: 75000, targetGroup: 'business_support' }
  const source = {
    stores: [{ id: 'S1', name: 'Fixture Store' }],
    employees: [
      { id: 'H1', code: 'HTKD-001', storeId: 'BUSINESS_SUPPORT', unit: 'business_support', name: 'Fixture Support' },
      { id: 'H2', storeId: 'BUSINESS_SUPPORT', unit: 'business_support', name: 'Fixture Peer' },
      { id: 'E1', storeId: 'S1', unit: 'store', name: 'Fixture Employee' },
    ],
    attendance: [
      { id: 'A1', employeeCode: 'HTKD-001', workDate: '2026-08-28', unit: 'business_support', shiftId: 'morning',
        checkOutAt: '2026-08-28T10:30:00Z', checklistSnapshot: { tasks: [reward] } },
      { id: 'A2', employeeId: 'H2', workDate: '2026-09-05', unit: 'business_support', shiftId: 'morning',
        checkOutAt: '2026-09-05T10:30:00Z', checklistSnapshot: { tasks: [reward] } },
      { id: 'AS', employeeId: 'E1', storeId: 'S1', workDate: '2026-09-05', shiftId: 'morning',
        checkOutAt: '2026-09-05T10:30:00Z', checklistSnapshot: { tasks: [reward] } },
    ],
    tasks: [
      { id: 'T1', checklistAttendanceId: 'A1', checklistTaskId: 'REWARD', checklistEmployeeId: 'HTKD-001', kind: 'REWARD_TASK' },
      { id: 'T2', checklistAttendanceId: 'A2', checklistTaskId: 'REWARD', kind: 'REWARD_TASK' },
      ...Array.from({ length: 200 }, (_, index) => ({ id: `STORE-${index}`, employeeId: 'E1', storeId: 'S1', detail: 'x'.repeat(1000) })),
    ],
    workCatalogItems: [reward, { id: 'VIOLATION', name: 'Fixture violation', kind: 'VIOLATION', amountVnd: 3000, targetGroup: 'business_support' }],
    workCatalogProgress: [{ id: 'P1', attendanceId: 'A1', catalogItemId: 'REWARD', checked: true, status: 'CLAIMED' }],
    compensationEntries: [{ id: 'C1', employeeId: 'HTKD-001', sourceAttendanceId: 'A1', amountVnd: 75000, targetUnit: 'business_support' }],
    violations: [{ id: 'V1', employeeId: 'HTKD-001', targetUnit: 'business_support', occurredOn: '2026-08-28', amountVnd: -3000 }],
    supportWorkSchedules: [{ id: 'SC1', employeeId: 'HTKD-001', date: '2026-08-28' }],
    supportWorkAssignments: [{ id: 'W1', employeeId: 'HTKD-001', date: '2026-08-28', tasks: [] }, { id: 'W2', employeeId: 'H2', tasks: [] }],
    shiftDefinitions: [{ id: 'morning', storeId: 'S1', name: 'Ca sáng', start: '08:30', end: '12:00' }],
  }
  try {
    await post('/api/bootstrap', { username: 'projection.admin', password: 'synthetic-projection-password', initialState: source },
      { 'x-idosi-bootstrap-token': 'support-screen-fixture' })
    const admin = await post('/api/login', { username: 'projection.admin', password: 'synthetic-projection-password' })
    await post('/api/command', { type: 'user.create', payload: {
      username: 'projection.support', password: 'synthetic-projection-password', displayName: 'Fixture Support', role: 'business_support', storeId: 'BUSINESS_SUPPORT', employeeId: 'H1',
    } }, { authorization: `Bearer ${admin.token}`, 'idempotency-key': 'fixture-support-user' })
    const support = await post('/api/login', { username: 'projection.support', password: 'synthetic-projection-password' })
    const read = async (screen, token) => {
      const response = await fetch(`${base}/api/system-screens/${screen}`, { headers: { authorization: `Bearer ${token}` } })
      const result = await response.json()
      expect(response.status, JSON.stringify(result)).toBe(200)
      return result.state
    }
    const before = runtime.database.database.prepare("SELECT value_json FROM state_entities WHERE collection_key='tasks' ORDER BY entity_key").all()
    const adminState = await read('tasks', admin.token)
    expect(adminState.tasks.map(({ id }) => id)).toEqual(['T1', 'T2'])
    expect(adminState.attendance.map(({ id }) => id)).toEqual(['A1', 'A2'])
    expect(adminState.violations.map(({ id }) => id)).toEqual(['V1'])
    expect(adminState.supportWorkSchedules.map(({ id }) => id)).toEqual(['SC1'])
    expect(adminState.shiftDefinitions.map(({ id }) => id)).toEqual(['morning'])
    expect(adminState.workCatalogItems.some(({ id }) => id === 'VIOLATION')).toBe(true)
    const rewardRows = workRewardRows({ ...adminState, targetUnit: 'business_support' })
    expect(rewardRows.some((row) => row.attendanceId === 'A1' && row.completed)).toBe(true)
    expect(rewardRows.some((row) => row.attendanceId === 'AS')).toBe(false)
    const supportState = await read('support-tasks', support.token)
    expect(supportState.tasks.map(({ id }) => id)).toEqual(['T1'])
    expect(supportState.attendance.map(({ id }) => id)).toEqual(['A1'])
    expect(supportState.workCatalogProgress.map(({ id }) => id)).toEqual(['P1'])
    const inbox = await read('support-assigned-work', support.token)
    expect(inbox.supportWorkAssignments.map(({ id }) => id)).toEqual(['W1'])
    expect(runtime.database.database.prepare("SELECT value_json FROM state_entities WHERE collection_key='tasks' ORDER BY entity_key").all()).toEqual(before)
    const saveTasks = async (date, id, type = 'tasks.assign') => fetch(`${base}/api/command`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${admin.token}`,
        'idempotency-key': `${type}-${date}-${id}` },
      body: JSON.stringify({ type, includeState: false,
        expectedVersion: runtime.database.database.prepare("SELECT version FROM app_state WHERE scope_key='global'").get().version,
        payload: { storeId: 'S1', date, shiftId: 'morning', employeeIds: ['E1'], tasks: [{ id, title: 'Fixture task' }] },
      }),
    })
    const saved = await saveTasks('2026-07-10', 'CROSS-MONTH-TASK')
    expect(saved.status).toBe(201)
    expect((await saved.json()).state).toBeUndefined()
    const duplicate = await saveTasks('2026-08-10', 'CROSS-MONTH-TASK')
    expect(duplicate.status).toBe(409)
    expect((await duplicate.json()).error.code).toBe('TASK_ID_EXISTS')
    const replaced = await saveTasks('2026-07-10', 'REPLACEMENT-TASK', 'tasks.replace_scope')
    expect(replaced.status).toBe(200)
    const persisted = runtime.database.database.prepare("SELECT record_id FROM state_entities WHERE collection_key='tasks'").all().map(({ record_id: id }) => id)
    expect(persisted).toContain('REPLACEMENT-TASK')
    expect(persisted).not.toContain('CROSS-MONTH-TASK')
    expect(persisted).toContain('STORE-0')
    expect(persisted).toContain('T1')
  } finally {
    await new Promise((done) => server.close(done))
    await rm(directory, { recursive: true, force: true })
  }
}, 30_000)
