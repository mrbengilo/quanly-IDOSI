// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'
import { createIdosiServer } from './server.mjs'

it('loads screen collections atomically and sends the account directory only to personnel screens', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'idosi-demand-screen-'))
  const entries = []
  const { server, runtime } = createIdosiServer({
    databasePath: resolve(directory, 'state.sqlite'),
    imagesDirectory: resolve(directory, 'images'),
    bootstrapToken: 'synthetic-demand',
    automaticRevenueBonusEnabled: false,
    requestLogger: (entry) => entries.push(entry),
  })
  await new Promise((done) => server.listen(0, '127.0.0.1', done))
  const base = `http://127.0.0.1:${server.address().port}`
  const request = async (path, { body, token, headers = {} } = {}) => {
    const response = await fetch(`${base}${path}`, {
      method: body ? 'POST' : 'GET',
      headers: {
        ...(body ? { 'content-type': 'application/json' } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
    const payload = await response.json()
    return { status: response.status, payload, metrics: entries.find((entry) => entry.requestId === payload.requestId) }
  }
  try {
    const employees = Array.from({ length: 40 }, (_, index) => ({
      id: `E${index}`, storeId: 'S1', unit: 'store', name: `Employee ${index}`,
    }))
    expect((await request('/api/bootstrap', {
      body: {
        username: 'demand.admin', password: 'synthetic-demand-password',
        initialState: { stores: [{ id: 'S1', name: 'Store' }], employees },
      },
      headers: { 'x-idosi-bootstrap-token': 'synthetic-demand' },
    })).status).toBe(201)
    const insertUser = runtime.database.database.prepare(`
      INSERT INTO users (
        id, username, username_normalized, display_name, password_hash, password_salt,
        password_iterations, password_algorithm, role, status, store_id, employee_id,
        password_updated_at, created_at, updated_at
      )
      SELECT ?, ?, ?, ?, password_hash, password_salt, password_iterations, password_algorithm,
        'employee', 'active', 'S1', ?, password_updated_at, created_at, updated_at
      FROM users WHERE username = 'demand.admin'
    `)
    employees.forEach((employee, index) => insertUser.run(
      `U${index}`, `demand.employee.${index}`, `demand.employee.${index}`, employee.name, employee.id,
    ))
    let globalReads = 0
    const readGlobal = runtime.database.readStateSnapshot.bind(runtime.database)
    runtime.database.readStateSnapshot = (...args) => { globalReads += 1; return readGlobal(...args) }

    const login = await request('/api/login', {
      body: { username: 'demand.admin', password: 'synthetic-demand-password' },
    })
    expect(login.status).toBe(200)
    expect(login.payload).not.toHaveProperty('users')
    expect(login.payload.bootstrap).toMatchObject({ partial: true, loadedCollections: ['stores'] })
    expect(login.payload.bootstrap.state).not.toHaveProperty('employees')
    expect(login.metrics.database.reads).toBe(3)
    const token = login.payload.token
    const optimizedRead = runtime.database.readSystemStateSnapshot
    const measurements = [{ path: '/api/login', reads: login.metrics.database.reads, bytes: login.metrics.responseBytes }]

    for (const screen of ['policies', 'account-settings', 'employees']) {
      const fast = await request(`/api/system-screens/${screen}`, { token })
      expect(fast.status).toBe(200)
      runtime.database.readSystemStateSnapshot = undefined
      const fallback = await request(`/api/system-screens/${screen}`, { token })
      runtime.database.readSystemStateSnapshot = optimizedRead
      expect(fallback.status).toBe(200)
      expect(fast.payload.state).toEqual(fallback.payload.state)
      expect(fast.payload.policies).toEqual(fallback.payload.policies)
      expect(fast.payload.version).toBe(fallback.payload.version)
      expect(fast.payload.users).toEqual(fallback.payload.users)
      expect(fast.metrics.database.reads).toBe(screen === 'employees' ? 4 : 3)
      expect(fallback.metrics.database.reads - fast.metrics.database.reads).toBe(4)
      expect(fast.payload.state).not.toHaveProperty('orders')
      measurements.push({ path: `/api/system-screens/${screen}`, reads: fast.metrics.database.reads, bytes: fast.metrics.responseBytes })
    }

    for (const screen of ['employees', 'business-support', 'store-managers', 'office']) {
      const result = await request(`/api/system-screens/${screen}`, { token })
      expect(result.status).toBe(200)
      expect(result.payload.users).toHaveLength(40)
      expect(result.payload.users[0]).toMatchObject({ status: 'active', version: 1 })
      expect(JSON.stringify(result.payload.users)).not.toMatch(/password_hash|password_salt|passwordHash/u)
    }
    for (const screen of ['policies', 'account-settings', 'settings', 'stores', 'support-violations']) {
      const result = await request(`/api/system-screens/${screen}`, { token })
      expect(result.status).toBe(200)
      expect(result.payload).not.toHaveProperty('users')
      expect(result.payload.user).toMatchObject({ username: 'demand.admin', role: 'admin' })
    }

    // A selected collection may be empty or still inline in an older database.
    // Its rows must match the D1 path without resurrecting an unrelated array.
    await runtime.database.prepare(`
      UPDATE app_state SET value_json = json_set(value_json,
        '$.deletedEmployees', json('[{"id":"OLD-E","name":"Archived employee"}]'),
        '$.unrelatedInlineRows', json('[{"id":"DO-NOT-SEND"}]'))
      WHERE scope_key = 'global'
    `).run()
    const archived = await request('/api/system-screens/employees', { token })
    expect(archived.payload.state.deletedEmployees).toEqual([{ id: 'OLD-E', name: 'Archived employee' }])
    expect(archived.payload.state).not.toHaveProperty('unrelatedInlineRows')

    const employeeLogin = await request('/api/login', {
      body: { username: 'demand.employee.0', password: 'synthetic-demand-password' },
    })
    expect(employeeLogin.status).toBe(200)
    expect(employeeLogin.payload).not.toHaveProperty('users')
    const employeeToken = employeeLogin.payload.token
    const ownAccount = await request('/api/system-screens/account-settings', { token: employeeToken })
    expect(ownAccount.status).toBe(200)
    expect(ownAccount.payload.state.employees.map(({ id }) => id)).toEqual(['E0'])
    expect(ownAccount.payload.state.accountProfile).toMatchObject({ code: 'E0', name: 'Employee 0' })
    expect(ownAccount.payload).not.toHaveProperty('users')
    expect((await request('/api/system-screens/employees', { token: employeeToken })).status).toBe(403)
    expect((await request('/api/system-screens/employees')).status).toBe(401)
    expect(globalReads).toBe(0)

    runtime.database.readSystemStateSnapshot = () => ({ unchanged: true })
    const invalid = await request('/api/system-screens/employees', { token })
    runtime.database.readSystemStateSnapshot = optimizedRead
    expect(invalid.status).toBe(500)
    expect(invalid.payload.error.code).toBe('STATE_SNAPSHOT_INVALID')
    expect(invalid.payload).not.toHaveProperty('state')
    console.info(JSON.stringify({ fixture: 'demand-screens-40-accounts', measurements }))
  } finally {
    await new Promise((done) => server.close(done))
    await rm(directory, { recursive: true, force: true })
  }
}, 30_000)
