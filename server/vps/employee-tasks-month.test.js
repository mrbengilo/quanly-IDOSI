// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { createIdosiServer } from './server.mjs'

const directories = []
afterEach(async () => {
  vi.useRealTimers()
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

const task = (id, employeeId, date) => ({ id, storeId: 'S1', date, employeeIds: [employeeId], title: `Công việc ${id}` })
const history = (id, employeeId, date) => ({
  id, assignmentId: id, storeId: 'S1', date, employeeIds: [employeeId],
  progressHistory: [{ employeeId, at: `${date}T09:00:00.000Z`, completedTasks: 1, totalTasks: 1, completionRate: 100 }],
})

it('loads only the current month and the open shift day on a store employee task page', async () => {
  // 00:30 on the 1st in Vietnam: last night's shift (30/09) is still open.
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-01T00:30:00+07:00'))
  const directory = await mkdtemp(resolve(tmpdir(), 'idosi-employee-tasks-month-'))
  directories.push(directory)
  const { server, runtime } = createIdosiServer({
    databasePath: resolve(directory, 'state.sqlite'),
    imagesDirectory: resolve(directory, 'images'),
    bootstrapToken: 'employee-tasks-month',
    automaticRevenueBonusEnabled: false,
  })
  await new Promise((done) => server.listen(0, '127.0.0.1', done))
  const base = `http://127.0.0.1:${server.address().port}`
  const request = async (path, body, token, headers = {}) => {
    const response = await fetch(`${base}${path}`, {
      method: body ? 'POST' : 'GET',
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
    const result = await response.json()
    expect(response.ok, JSON.stringify(result)).toBe(true)
    return result
  }
  const login = async (username) => (await request('/api/login', { username, password: 'Synthetic-month-password' })).token
  const ids = (records) => records.map(({ id }) => id).sort()
  try {
    await request('/api/bootstrap', {
      username: 'month.admin',
      password: 'Synthetic-month-password',
      initialState: {
        stores: [{ id: 'S1', name: 'Cửa hàng kiểm thử' }],
        employees: [
          { id: 'E1', name: 'Nhân viên cửa hàng', storeId: 'S1', unit: 'store', status: 'Đang làm việc' },
          { id: 'O1', name: 'Nhân viên văn phòng', storeId: 'S1', unit: 'office', status: 'Đang làm việc' },
        ],
        attendance: [{
          id: 'ATT-OPEN', employeeId: 'E1', storeId: 'S1', date: '2026-09-30', shiftId: 'ca-dem',
          checkIn: '22:00', checkInAt: '2026-09-30T15:00:00.000Z',
          checklistSnapshot: { storeChecklistRepairVersion: 1, source: 'work-catalog', tasks: [] },
        }],
        tasks: [
          task('T-E1-OCT', 'E1', '2026-10-01'),
          task('T-E1-OPEN', 'E1', '2026-09-30'),
          task('T-E1-SEP', 'E1', '2026-09-15'),
          task('T-E1-AUG', 'E1', '2026-08-10'),
          task('T-O1-SEP', 'O1', '2026-09-15'),
        ],
        taskAssignmentHistory: [
          history('H-E1-OCT', 'E1', '2026-10-01'),
          history('H-E1-OPEN', 'E1', '2026-09-30'),
          history('H-E1-SEP', 'E1', '2026-09-10'),
        ],
      },
    }, null, { 'x-idosi-bootstrap-token': 'employee-tasks-month' })
    const admin = await login('month.admin')
    for (const [username, employeeId] of [['month.store', 'E1'], ['month.office', 'O1']]) {
      await request('/api/command', {
        type: 'user.create',
        payload: { username, password: 'Synthetic-month-password', displayName: username, role: 'employee', storeId: 'S1', employeeId },
      }, admin, { 'idempotency-key': `month-user-${employeeId}` })
    }

    const loadedTaskIds = []
    const readStoreStateSnapshot = runtime.database.readStoreStateSnapshot.bind(runtime.database)
    runtime.database.readStoreStateSnapshot = (...arguments_) => {
      const snapshot = readStoreStateSnapshot(...arguments_)
      if (arguments_[3] === 'employee-tasks') {
        loadedTaskIds.push(...snapshot.entities
          .filter(({ collection_key: collectionKey }) => ['tasks', 'taskAssignmentHistory'].includes(collectionKey))
          .map(({ value_json: value }) => JSON.parse(value).id))
      }
      return snapshot
    }

    const storeState = (await request('/api/system-screens/employee-tasks', null, await login('month.store'))).state
    expect(ids(storeState.tasks)).toEqual(['T-E1-OCT', 'T-E1-OPEN'])
    expect(ids(storeState.taskAssignmentHistory)).toEqual(['H-E1-OCT', 'H-E1-OPEN'])
    // Older months are filtered in SQLite, before any JSON is hydrated.
    expect(loadedTaskIds).toEqual(expect.arrayContaining(['T-E1-OCT', 'T-E1-OPEN', 'H-E1-OCT', 'H-E1-OPEN']))
    expect(loadedTaskIds).not.toContain('T-E1-SEP')
    expect(loadedTaskIds).not.toContain('T-E1-AUG')
    expect(loadedTaskIds).not.toContain('H-E1-SEP')

    // Office staff use this route for reward work with a date picker, so
    // their earlier months stay available.
    const officeState = (await request('/api/system-screens/employee-tasks', null, await login('month.office'))).state
    expect(ids(officeState.tasks)).toContain('T-O1-SEP')
  } finally {
    await new Promise((done) => server.close(done))
  }
})
