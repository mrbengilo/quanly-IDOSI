// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { expect, it, vi } from 'vitest'
import { createIdosiServer } from './server.mjs'

// Production regression (2026-10-10): a Business Support check-in carried no
// store hint, so the command hydrated every store's tasks, assignment history
// and orders. Once that history outgrew the Node heap the app crashed with an
// out-of-memory error and every check-in timed out on the client.
it('checks Business Support in from its own store projection, never all stores', async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-10T08:40:00+07:00'))
  const directory = await mkdtemp(resolve(tmpdir(), 'idosi-support-check-in-'))
  const { server, runtime } = createIdosiServer({
    databasePath: resolve(directory, 'state.sqlite'), imagesDirectory: resolve(directory, 'images'),
    bootstrapToken: 'support-check-in-fixture', automaticRevenueBonusEnabled: false,
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
  const version = () => runtime.database.database.prepare("SELECT version FROM app_state WHERE scope_key='global'").get().version
  const command = (token, type, payload) => request('/api/command', {
    type, payload, expectedVersion: version(), includeState: false,
  }, token, { 'idempotency-key': crypto.randomUUID() })
  const password = 'Synthetic-support-check-in-password'
  const date = '2026-10-10'
  const foreignTasks = Array.from({ length: 5 }, (_, index) => ({
    id: `FOREIGN-TASK-${index}`, storeId: 'S1', employeeId: 'STORE-E', date, title: `Foreign task ${index}`,
  }))
  try {
    const bootstrap = await request('/api/bootstrap', {
      username: 'scope.admin', password,
      initialState: {
        stores: [{ id: 'S1', name: 'Store 1' }],
        employees: [
          { id: 'H1', name: 'Business support', storeId: 'BUSINESS_SUPPORT', unit: 'business_support', status: 'Đang làm việc' },
          { id: 'STORE-E', name: 'Store employee', storeId: 'S1', unit: 'store', status: 'Đang làm việc' },
        ],
        supportWorkSchedules: [{ id: 'SWS-H1', employeeId: 'H1', date, start: '08:30', end: '17:30', shiftName: 'Giờ hành chính' }],
        attendance: [], tasks: foreignTasks, taskAssignmentHistory: [], orders: [], workCatalogItems: [],
      },
    }, null, { 'x-idosi-bootstrap-token': 'support-check-in-fixture' })
    expect(bootstrap.status, JSON.stringify(bootstrap.payload)).toBe(201)
    const admin = (await request('/api/login', { username: 'scope.admin', password })).payload.token
    const created = await command(admin, 'user.create', {
      username: 'scope.support', password, displayName: 'Business support',
      role: 'business_support', storeId: 'BUSINESS_SUPPORT', employeeId: 'H1',
    })
    expect(created.status, JSON.stringify(created.payload)).toBeLessThan(300)
    const support = (await request('/api/login', { username: 'scope.support', password })).payload.token

    const storeReads = []
    const systemReads = []
    let globalReads = 0
    const database = runtime.database
    const readStore = database.readStoreStateSnapshot.bind(database)
    const readSystem = database.readSystemStateSnapshot.bind(database)
    const readGlobal = database.readStateSnapshot.bind(database)
    database.readStoreStateSnapshot = (...args) => { storeReads.push(args); return readStore(...args) }
    database.readSystemStateSnapshot = (...args) => { systemReads.push(args); return readSystem(...args) }
    database.readStateSnapshot = (...args) => { globalReads += 1; return readGlobal(...args) }

    const location = { latitude: 10.8, longitude: 106.7, accuracy: 5 }
    const checkedIn = await command(support, 'attendance.check_in', { shiftId: 'SWS-H1', location })
    expect(checkedIn.status, JSON.stringify(checkedIn.payload)).toBe(201)
    expect(checkedIn.payload.attendance).toMatchObject({ employeeId: 'H1', storeId: 'BUSINESS_SUPPORT', date })

    expect(globalReads).toBe(0)
    const attendanceReads = storeReads.filter((args) => args[3] === 'command-attendance')
    expect(attendanceReads.map((args) => args[1])).toEqual(['BUSINESS_SUPPORT'])
    expect(systemReads.filter((args) => args[1]?.includes?.('tasks'))).toEqual([])

    // The scoped commit must keep other stores' history intact.
    const taskIds = database.database.prepare("SELECT record_id FROM state_entities WHERE collection_key='tasks'")
      .all().map(({ record_id: id }) => id)
    expect(taskIds).toEqual(expect.arrayContaining(foreignTasks.map(({ id }) => id)))

    vi.setSystemTime(new Date('2026-10-10T17:35:00+07:00'))
    const checkedOut = await command(support, 'attendance.check_out', {
      attendanceId: checkedIn.payload.attendance.id, location,
    })
    expect(checkedOut.status, JSON.stringify(checkedOut.payload)).toBe(200)
    expect(globalReads).toBe(0)
  } finally {
    await new Promise((done) => server.close(done))
    await rm(directory, { recursive: true, force: true })
    vi.useRealTimers()
  }
}, 30_000)
