// @vitest-environment node
import { Buffer } from 'node:buffer'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createIdosiServer } from './server.mjs'
import { createSqliteD1 } from './sqlite-d1.mjs'

// Production incident (2026-10-17): at shift change every check-in, check-out
// and task save loaded the store's complete task, checklist and attendance
// history (~29 MB per store), blocking the single runtime for 7-13 s per
// command. Shift commands now load only the operational window.

const temporaryDirectories = []
const timestamp = '2026-10-17T07:00:00.000Z'

afterEach(async () => {
  vi.useRealTimers()
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

const createDatabase = async (rows) => {
  const directory = await mkdtemp(resolve(tmpdir(), 'idosi-operational-window-'))
  temporaryDirectories.push(directory)
  const database = createSqliteD1({ databasePath: resolve(directory, 'idosi.sqlite') })
  const collections = [...new Set(rows.map(([collectionKey]) => collectionKey))]
  await database.batch([
    database.prepare(`INSERT INTO app_state (scope_key, value_json, version, updated_at, updated_by, last_request_id)
      VALUES ('global', '{}', 3, ?, NULL, 'seed')`).bind(timestamp),
    ...collections.map((collectionKey) => database.prepare(`INSERT INTO state_collections
      (scope_key, collection_key, created_at, updated_at) VALUES ('global', ?, ?, ?)`).bind(collectionKey, timestamp, timestamp)),
    ...rows.map(([collectionKey, value, { occurredOn, openFlag = null } = {}], index) => {
      const valueJson = JSON.stringify(value)
      return database.prepare(`INSERT INTO state_entities (
        scope_key, collection_key, entity_key, entity_order, value_json, value_bytes, created_at, updated_at,
        store_id, employee_id, occurred_on, period_key, record_id, open_flag
      ) VALUES ('global', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
        collectionKey, `${collectionKey}-${index}`, index + 1, valueJson, Buffer.byteLength(valueJson), timestamp, timestamp,
        value.storeId || null, value.employeeId || null,
        occurredOn === undefined ? String(value.date || '').slice(0, 10) || null : occurredOn,
        occurredOn === undefined ? String(value.date || '').slice(0, 7) || null : occurredOn?.slice(0, 7) || null,
        value.id || null, openFlag,
      )
    }),
  ])
  return database
}

const idsOf = (snapshot, collectionKey) => snapshot.entities
  .filter((entity) => entity.collection_key === collectionKey)
  .map((entity) => JSON.parse(entity.value_json).id)
  .sort()

const rows = [
  ['stores', { id: 'S01', name: 'Cửa hàng 1' }],
  ['stores', { id: 'S02', name: 'Cửa hàng 2' }],
  ['employees', { id: 'E01', storeId: 'S01', unit: 'store' }],
  ['employees', { id: 'E02', storeId: 'S01', unit: 'store' }],
  ['supportTransfers', { id: 'ST-1', employeeId: 'E01', fromStoreId: 'S01', toStoreId: 'S02', status: 'Hoàn tất' }],
  ['attendance', { id: 'ATT-TODAY', storeId: 'S01', employeeId: 'E01', date: '2026-10-17', checkOutAt: null }, { openFlag: 1 }],
  ['attendance', { id: 'ATT-YESTERDAY', storeId: 'S01', employeeId: 'E02', date: '2026-10-16', checkOutAt: 'x' }, { openFlag: 0 }],
  ['attendance', { id: 'ATT-OLD', storeId: 'S01', employeeId: 'E02', date: '2026-10-01', checkOutAt: 'x' }, { openFlag: 0 }],
  ['attendance', {
    id: 'ATT-FORGOTTEN', storeId: 'S01', employeeId: 'E02', date: '2026-10-12', checkOutAt: null,
    taskShiftContexts: [{ shiftId: 'ca1', taskIds: ['TASK-BOUND-OLD'] }],
  }, { openFlag: 1 }],
  ['tasks', { id: 'TASK-TODAY', storeId: 'S01', date: '2026-10-17' }],
  ['tasks', { id: 'TASK-YESTERDAY', storeId: 'S01', date: '2026-10-16' }],
  ['tasks', { id: 'TASK-OLD', storeId: 'S01', date: '2026-10-01' }],
  ['tasks', { id: 'TASK-FORGOTTEN-DAY', storeId: 'S01', date: '2026-10-12', checklistAttendanceId: 'ATT-FORGOTTEN' }],
  ['tasks', { id: 'TASK-FORGOTTEN-UTC', storeId: 'S01', checklistAttendanceId: 'ATT-FORGOTTEN' }, { occurredOn: '2026-10-11' }],
  ['tasks', { id: 'TASK-BOUND-OLD', storeId: 'S01', date: '2026-09-20' }],
  ['tasks', { id: 'TASK-UNDATED', storeId: 'S01' }, { occurredOn: null }],
  ['tasks', { id: 'TASK-OTHER-STORE', storeId: 'S02', date: '2026-10-17' }],
  ['taskAssignmentHistory', { id: 'HISTORY-TODAY', storeId: 'S01', date: '2026-10-17' }],
  ['taskAssignmentHistory', { id: 'HISTORY-OLD', storeId: 'S01', date: '2026-10-01' }],
  ['orders', { id: 'ORDER-TODAY', storeId: 'S01', employeeId: 'E01', date: '2026-10-17' }],
  ['orders', { id: 'ORDER-OLD', storeId: 'S01', employeeId: 'E01', date: '2026-09-01' }],
]

describe('shift command operational window', () => {
  it('keeps every row a still open shift can reference and drops older history', async () => {
    const database = await createDatabase(rows)
    try {
      for (const screen of ['command-attendance', 'command-task-progress']) {
        const snapshot = database.readStoreStateSnapshot('global', 'S01', 'E01', screen, '', '2026-10-17')
        // The forgotten 2026-10-12 shift pulls its own day (and the day before
        // for UTC creation timestamps) into the window; 10-01 stays out.
        expect(idsOf(snapshot, 'tasks')).toEqual([
          'TASK-BOUND-OLD', 'TASK-FORGOTTEN-DAY', 'TASK-FORGOTTEN-UTC', 'TASK-TODAY', 'TASK-UNDATED', 'TASK-YESTERDAY',
        ])
        expect(idsOf(snapshot, 'taskAssignmentHistory')).toEqual(['HISTORY-TODAY'])
        expect(idsOf(snapshot, 'attendance')).toEqual(['ATT-FORGOTTEN', 'ATT-TODAY', 'ATT-YESTERDAY'])
      }
      // Revenue reconciliation must see every order of the shift: never windowed.
      const checkOut = database.readStoreStateSnapshot('global', 'S01', 'E01', 'command-attendance', '', '2026-10-17')
      expect(idsOf(checkOut, 'orders')).toEqual(['ORDER-OLD', 'ORDER-TODAY'])
    } finally {
      database.close()
    }
  })

  it('without a forgotten shift starts the window the day before the business date', async () => {
    const database = await createDatabase(rows.filter(([, value]) => value.id !== 'ATT-FORGOTTEN'))
    try {
      const snapshot = database.readStoreStateSnapshot('global', 'S01', 'E01', 'command-attendance', '', '2026-10-17')
      expect(idsOf(snapshot, 'tasks')).toEqual(['TASK-TODAY', 'TASK-UNDATED', 'TASK-YESTERDAY'])
      expect(idsOf(snapshot, 'attendance')).toEqual(['ATT-TODAY', 'ATT-YESTERDAY'])
    } finally {
      database.close()
    }
  })

  it('loads the complete history without a business date, on other screens and for invalid dates', async () => {
    const database = await createDatabase(rows)
    try {
      const full = database.readStoreStateSnapshot('global', 'S01', 'E01', 'command-attendance')
      expect(idsOf(full, 'tasks')).toEqual([
        'TASK-BOUND-OLD', 'TASK-FORGOTTEN-DAY', 'TASK-FORGOTTEN-UTC', 'TASK-OLD', 'TASK-TODAY', 'TASK-UNDATED', 'TASK-YESTERDAY',
      ])
      expect(idsOf(full, 'attendance')).toEqual(['ATT-FORGOTTEN', 'ATT-OLD', 'ATT-TODAY', 'ATT-YESTERDAY'])
      // The store manager task screen keeps the complete history.
      expect(database.readStoreStateSnapshot('global', 'S01', 'E01', 'tasks', '', '2026-10-17').entities)
        .toEqual(database.readStoreStateSnapshot('global', 'S01', 'E01', 'tasks').entities)
      expect(database.readStoreStateSnapshot('global', 'S01', 'E01', 'command-attendance', '', 'not-a-date').entities)
        .toEqual(full.entities)
    } finally {
      database.close()
    }
  })
})

describe('store employee task page', () => {
  it('lists the selected shift window only and never reads assignment history', async () => {
    const database = await createDatabase(rows)
    try {
      let snapshotSql = ''
      const prepare = database.database.prepare.bind(database.database)
      database.database.prepare = (sql) => {
        if (sql.includes('row_kind')) snapshotSql = sql
        return prepare(sql)
      }
      const snapshot = database.readStoreStateSnapshot('global', 'S01', 'E01', 'employee-tasks', '', '2026-10-17')
      database.database.prepare = prepare
      expect(idsOf(snapshot, 'tasks')).toEqual([
        'TASK-BOUND-OLD', 'TASK-FORGOTTEN-DAY', 'TASK-FORGOTTEN-UTC', 'TASK-TODAY', 'TASK-UNDATED', 'TASK-YESTERDAY',
      ])
      expect(idsOf(snapshot, 'taskAssignmentHistory')).toEqual([])
      expect(idsOf(snapshot, 'attendance')).toEqual(['ATT-FORGOTTEN', 'ATT-TODAY', 'ATT-YESTERDAY'])
      // Production regression (2026-10-17): a per-row correlated lookup of
      // the open shift days made one task page read take 43 s.
      const plan = prepare(`EXPLAIN QUERY PLAN ${snapshotSql}`).all('global', 'S01', 'E01', '', '2026-10-17')
        .map(({ detail }) => detail)
      expect(plan.some((detail) => detail.startsWith('CORRELATED LIST SUBQUERY'))).toBe(false)
    } finally {
      database.close()
    }
  })
})

describe('shift commands on a store with long history', () => {
  it('checks in, saves the checklist and checks out without touching older history', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-17T08:00:00+07:00'))
    const directory = await mkdtemp(resolve(tmpdir(), 'idosi-operational-window-runtime-'))
    temporaryDirectories.push(directory)
    const { server, runtime } = createIdosiServer({
      databasePath: resolve(directory, 'state.sqlite'), imagesDirectory: resolve(directory, 'images'),
      bootstrapToken: 'operational-window-fixture', automaticRevenueBonusEnabled: false,
    })
    await new Promise((done) => server.listen(0, '127.0.0.1', done))
    const base = `http://127.0.0.1:${server.address().port}`
    const request = async (path, body, token, headers = {}) => {
      const response = await fetch(`${base}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
        body: JSON.stringify(body),
      })
      return { status: response.status, payload: await response.json() }
    }
    const database = runtime.database
    const version = () => database.database.prepare("SELECT version FROM app_state WHERE scope_key='global'").get().version
    const command = (token, type, payload) => request('/api/command', {
      type, payload, expectedVersion: version(), includeState: false,
    }, token, { 'idempotency-key': crypto.randomUUID() })
    const password = 'Synthetic-operational-window-password'
    const oldDate = '2026-09-20'
    const forgottenDate = '2026-10-14'
    const checklist = (attendanceId, date, employeeId, count) => Array.from({ length: count }, (_, index) => ({
      id: `${attendanceId}_TASK-${index}`, assignmentId: `catalog_checklist_${attendanceId}`, checklistAttendanceId: attendanceId,
      storeId: 'S1', employeeId, employeeIds: [employeeId], date, workDate: date, shiftId: 'CA1', shift: 'CA1',
      title: `Checklist ${index}`, required: true, active: true, completedBy: index === 0 ? {} : { [employeeId]: true },
      createdAt: `${date}T01:00:00.000Z`,
    }))
    const attendanceFor = (id, date, employeeId, tasks, open) => ({
      id, storeId: 'S1', employeeId, date, workDate: date, shift: 'CA1', shiftId: 'CA1', shiftName: 'Ca 1',
      shiftStart: '00:00', shiftEnd: '23:59', checkIn: '08:00', checkInTime: '08:00', checkInAt: `${date}T01:00:00.000Z`,
      checkOut: open ? null : '16:00', checkOutAt: open ? null : `${date}T09:00:00.000Z`, createdAt: `${date}T01:00:00.000Z`,
      checklistSnapshot: {
        source: 'work-catalog', templateId: 'WORK-CATALOG', storeChecklistRepairVersion: 1,
        assignmentId: `catalog_checklist_${id}`, tasks: tasks.map((task) => ({ id: task.id, name: task.title, required: true })),
      },
    })
    const oldTasks = checklist('ATT-OLD', oldDate, 'E1', 3)
    const forgottenTasks = checklist('ATT-FORGOTTEN', forgottenDate, 'E2', 2)
    try {
      const bootstrap = await request('/api/bootstrap', {
        username: 'window.admin', password,
        initialState: {
          stores: [{ id: 'S1', name: 'Cửa hàng 1' }],
          employees: [
            { id: 'E1', name: 'Nhân viên 1', storeId: 'S1', unit: 'store', status: 'Đang làm việc' },
            { id: 'E2', name: 'Nhân viên 2', storeId: 'S1', unit: 'store', status: 'Đang làm việc' },
          ],
          shiftDefinitions: [{ id: 'CA1', storeId: 'S1', name: 'Ca 1', start: '00:00', end: '23:59', active: true }],
          attendance: [
            attendanceFor('ATT-OLD', oldDate, 'E1', oldTasks, false),
            attendanceFor('ATT-FORGOTTEN', forgottenDate, 'E2', forgottenTasks, true),
          ],
          tasks: [...oldTasks, ...forgottenTasks],
          taskAssignmentHistory: [{
            id: 'catalog_checklist_ATT-OLD', assignmentId: 'catalog_checklist_ATT-OLD', storeId: 'S1', date: oldDate,
            employeeIds: ['E1'], tasks: oldTasks, progressHistory: [],
          }],
          orders: [], workCatalogItems: [],
        },
      }, null, { 'x-idosi-bootstrap-token': 'operational-window-fixture' })
      expect(bootstrap.status, JSON.stringify(bootstrap.payload)).toBe(201)
      const admin = (await request('/api/login', { username: 'window.admin', password })).payload.token
      for (const [username, employeeId] of [['window.e1', 'E1'], ['window.e2', 'E2']]) {
        const created = await command(admin, 'user.create', {
          username, password, displayName: employeeId, role: 'employee', storeId: 'S1', employeeId,
        })
        expect(created.status, JSON.stringify(created.payload)).toBeLessThan(300)
      }
      const e1 = (await request('/api/login', { username: 'window.e1', password })).payload.token
      const e2 = (await request('/api/login', { username: 'window.e2', password })).payload.token
      const historyRows = () => database.database.prepare(`SELECT collection_key, record_id, value_json FROM state_entities
        WHERE collection_key IN ('tasks', 'taskAssignmentHistory', 'attendance') AND occurred_on = ? ORDER BY 1, 2`).all(oldDate)
      const oldHistoryBefore = historyRows()
      expect(oldHistoryBefore.map((row) => row.record_id)).toEqual([
        'ATT-OLD', 'catalog_checklist_ATT-OLD', 'ATT-OLD_TASK-0', 'ATT-OLD_TASK-1', 'ATT-OLD_TASK-2',
      ])
      const reads = []
      const readStore = database.readStoreStateSnapshot.bind(database)
      database.readStoreStateSnapshot = (...args) => { reads.push(args); return readStore(...args) }

      // A shift left open three days ago still owes its own checklist.
      const location = { latitude: 10.8, longitude: 106.7, accuracy: 5 }
      const forgottenCheckOut = await command(e2, 'attendance.check_out', {
        attendanceId: 'ATT-FORGOTTEN', location, cashRevenue: 0, transferRevenue: 0,
      })
      expect(forgottenCheckOut.status, JSON.stringify(forgottenCheckOut.payload)).toBe(409)
      expect(forgottenCheckOut.payload.error.code).toBe('TASK_PROGRESS_REQUIRED')
      expect(forgottenCheckOut.payload.error.details.taskIds).toEqual(['ATT-FORGOTTEN_TASK-0'])

      const checkedIn = await command(e1, 'attendance.check_in', { shiftId: 'CA1', location })
      expect(checkedIn.status, JSON.stringify(checkedIn.payload)).toBe(201)
      const attendanceId = checkedIn.payload.attendance.id
      const selected = await command(e1, 'task.shift.select', { attendanceId, selectedTaskShiftId: 'CA1' })
      expect(selected.status, JSON.stringify(selected.payload)).toBe(200)
      const taskIds = selected.payload.tasks.map((task) => task.id)
      expect(taskIds.length).toBeGreaterThan(0)
      const saved = await command(e1, 'task.progress.save', {
        attendanceId, selectedTaskShiftId: 'CA1', tasks: taskIds.map((id) => ({ id, completed: true })),
      })
      expect(saved.status, JSON.stringify(saved.payload)).toBe(200)
      vi.setSystemTime(new Date('2026-10-17T16:05:00+07:00'))
      const checkedOut = await command(e1, 'attendance.check_out', {
        attendanceId, location, cashRevenue: 0, transferRevenue: 0,
      })
      expect(checkedOut.status, JSON.stringify(checkedOut.payload)).toBe(200)
      expect(checkedOut.payload.attendance.checkOutAt).toBeTruthy()

      // Every shift command used the window with the server's business date.
      const shiftReads = reads.filter((args) => ['command-attendance', 'command-task-progress'].includes(args[3]))
      expect(shiftReads.length).toBeGreaterThanOrEqual(5)
      expect(shiftReads.every((args) => args[5] === '2026-10-17')).toBe(true)
      // Rows outside the window were neither loaded for the commit nor deleted.
      expect(historyRows()).toEqual(oldHistoryBefore)
      const savedTasks = database.database.prepare(`SELECT record_id, value_json FROM state_entities
        WHERE collection_key = 'tasks' AND occurred_on = '2026-10-17'`).all()
        .filter((row) => taskIds.includes(row.record_id))
      expect(savedTasks).toHaveLength(taskIds.length)
      expect(savedTasks.every((row) => JSON.parse(row.value_json).completedBy?.E1 === true)).toBe(true)
    } finally {
      await new Promise((done) => server.close(done))
    }
  }, 30_000)
})
