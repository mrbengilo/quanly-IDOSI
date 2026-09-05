// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { expect, it } from 'vitest'
import { createIdosiServer } from './server.mjs'

it('serves 20 distinct employee sessions without full snapshots or cross-account data', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'idosi-concurrent-'))
  const { server, runtime } = createIdosiServer({
    databasePath: resolve(directory, 'state.sqlite'),
    imagesDirectory: resolve(directory, 'images'),
    bootstrapToken: 'concurrent-fixture-bootstrap',
  })
  await new Promise((done) => server.listen(0, '127.0.0.1', done))
  const base = `http://127.0.0.1:${server.address().port}`
  const post = async (path, body, headers = {}) => {
    const response = await fetch(`${base}${path}`, {
      method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body),
    })
    return { status: response.status, body: await response.json() }
  }
  try {
    const employees = Array.from({ length: 20 }, (_, i) => ({
      id: `E${i}`, storeId: `S${i % 4}`, name: `Fixture employee ${i}`, unit: 'store', status: 'Đang làm việc',
    }))
    const bootstrap = await post('/api/bootstrap', {
      username: 'load.admin', password: 'synthetic-load-password', displayName: 'Fixture Admin',
      initialState: {
        stores: Array.from({ length: 4 }, (_, i) => ({ id: `S${i}`, name: `Fixture Store ${i}` })),
        employees,
        attendance: employees.map((employee) => ({
          id: `A-${employee.id}`, employeeId: employee.id, storeId: employee.storeId,
          workDate: '2026-09-05', checkInAt: '2026-09-05T01:00:00Z',
          checklistSnapshot: { source: 'work-catalog', storeChecklistRepairVersion: 1, tasks: [] },
        })),
        orders: employees.flatMap((employee) => Array.from({ length: 200 }, (_, index) => ({
          id: `O-${employee.id}-${index}`, storeId: employee.storeId, employeeId: employee.id,
          attendanceId: `A-${employee.id}`, businessDate: '2026-09-05', amount: 100_000,
          note: `private-${employee.id}`,
        }))),
      },
    }, { 'x-idosi-bootstrap-token': 'concurrent-fixture-bootstrap' })
    expect(bootstrap.status).toBe(201)
    const insert = runtime.database.database.prepare(`
      INSERT INTO users(id, username, username_normalized, display_name, password_hash, password_salt,
        password_iterations, password_algorithm, role, status, store_id, employee_id,
        password_updated_at, created_at, updated_at)
      SELECT ?, ?, ?, ?, password_hash, password_salt, password_iterations, password_algorithm,
        'employee', 'active', ?, ?, password_updated_at, created_at, updated_at
      FROM users WHERE username = 'load.admin'
    `)
    employees.forEach((employee, i) => insert.run(
      `U${i}`, `load.employee.${i}`, `load.employee.${i}`, employee.name, employee.storeId, employee.id,
    ))
    let fullReads = 0
    const readSnapshot = runtime.database.readStateSnapshot.bind(runtime.database)
    runtime.database.readStateSnapshot = (...args) => { fullReads += 1; return readSnapshot(...args) }
    const beforeVersion = runtime.database.database.prepare("SELECT version FROM app_state WHERE scope_key='global'").get().version
    const loginStarted = performance.now()
    const logins = await Promise.all(employees.map((_, i) => post('/api/login', {
      username: `load.employee.${i}`, password: 'synthetic-load-password',
    })))
    const loginMs = Math.round(performance.now() - loginStarted)
    expect(logins.every((login) => login.status === 200)).toBe(true)
    expect(new Set(logins.map((login) => login.body.token)).size).toBe(20)
    const readStarted = performance.now()
    await Promise.all(logins.map(async (login, i) => {
      const headers = { authorization: `Bearer ${login.body.token}` }
      for (const path of ['/api/bootstrap', '/api/system-screens/employee-home']) {
        const response = await fetch(`${base}${path}`, { headers })
        const payload = await response.json()
        expect(response.status).toBe(200)
        expect(payload.state.orders).toHaveLength(200)
        expect(payload.state.orders.every((order) => order.employeeId === employees[i].id)).toBe(true)
        expect(payload.state.employees.map((employee) => employee.id)).toEqual([employees[i].id])
      }
    }))
    const readMs = Math.round(performance.now() - readStarted)
    expect(fullReads).toBe(0)
    expect(runtime.database.database.prepare("SELECT version FROM app_state WHERE scope_key='global'").get().version)
      .toBe(beforeVersion)
    const logouts = await Promise.all(logins.map((login) => post('/api/logout', {}, {
      authorization: `Bearer ${login.body.token}`,
    })))
    expect(logouts.every((logout) => logout.status === 200 && logout.body.loggedOut)).toBe(true)
    expect(fullReads).toBe(0)
    console.info(JSON.stringify({ fixture: '20-employees-4000-orders', loginBatchMs: loginMs, readBatchMs: readMs }))
  } finally {
    await new Promise((done) => server.close(done))
    await rm(directory, { recursive: true, force: true })
  }
}, 60_000)
