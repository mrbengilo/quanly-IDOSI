// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'
import { createIdosiServer } from './server.mjs'
import { DEFAULT_STORE_WORK_CATALOG_ITEMS } from '../../src/domain/compensationPolicies.js'

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

it.each([false, true])('checks canonical repair eligibility before command preloads (eligible=%s)', async (eligible) => {
  const directory = await mkdtemp(resolve(tmpdir(), 'idosi-command-repair-'))
  const { server, runtime } = createIdosiServer({
    databasePath: resolve(directory, 'state.sqlite'), imagesDirectory: resolve(directory, 'images'),
    bootstrapToken: 'command-repair-fixture', automaticRevenueBonusEnabled: false,
  })
  await new Promise((done) => server.listen(0, '127.0.0.1', done))
  const base = `http://127.0.0.1:${server.address().port}`
  const request = async (path, body, token, extraHeaders = {}) => {
    const response = await fetch(`${base}${path}`, {
      method: body ? 'POST' : 'GET',
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...extraHeaders },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
    return { status: response.status, payload: await response.json() }
  }
  try {
    const employees = [
      { id: 'E1', code: 'CODE-1', name: 'Store employee', unit: 'store', storeId: 'S1' },
      { id: 'E2', name: 'Office employee', unit: 'office', storeId: 'OFFICE' },
      { id: 'E3', name: 'Support employee', unit: 'business_support', storeId: 'BUSINESS_SUPPORT' },
      { id: 'E4', name: 'Store manager', unit: 'store_manager', storeId: 'S1' },
      { id: 'E9', name: 'Foreign employee', unit: 'store', storeId: 'S2' },
    ]
    const legacyAttendance = {
      storeId: 'S1', date: '2026-09-05', shiftId: 'ca1', checkInAt: '2026-09-05T01:05:00Z',
    }
    const attendance = [
      { ...legacyAttendance, id: 'A1', employeeId: 'code-1', ...(!eligible ? { shiftId: '' } : {}) },
      { ...legacyAttendance, id: 'A2', employeeId: 'E2' },
      { ...legacyAttendance, id: 'A3', employeeId: 'E3' },
      { ...legacyAttendance, id: 'A4', employeeId: 'E4' },
      { ...legacyAttendance, id: 'A5', employeeId: 'UNKNOWN' },
      { ...legacyAttendance, id: 'A6', employeeId: 'E1', checklistSnapshot: { source: 'foreign-template', tasks: [] } },
      { ...legacyAttendance, id: 'A7', employeeId: 'E1', date: '' },
      { ...legacyAttendance, id: 'A8', employeeId: 'E1', checkInAt: '' },
    ]
    const bootstrap = await request('/api/bootstrap', {
      username: 'repair.admin', password: 'synthetic-command-password',
      initialState: {
        stores: [{ id: 'S1', name: 'Store 1' }, { id: 'S2', name: 'Store 2' }], employees, attendance,
        tasks: [{ id: 'UNRELATED-TASK', title: 'Keep task', employeeId: 'E9', storeId: 'S2' }],
        taskAssignmentHistory: [{ id: 'UNRELATED-HISTORY', tasks: [], detail: 'HISTORY-MUST-NOT-LOAD'.repeat(250) }],
        workCatalogItems: DEFAULT_STORE_WORK_CATALOG_ITEMS,
        workCatalogProgress: [{ id: 'UNRELATED-PROGRESS', employeeId: 'E9', detail: 'PROGRESS-MUST-NOT-LOAD' }],
        compensationEntries: [{ id: 'UNRELATED-REWARD', employeeId: 'E9', detail: 'REWARD-MUST-NOT-LOAD' }],
        teamRewardClaims: [{ id: 'UNRELATED-CLAIM', storeId: 'S2', detail: 'CLAIM-MUST-NOT-LOAD' }],
        shiftDefinitions: [{ id: 'SHIFT-1', storeId: 'S1', name: 'Fixture shift', start: '08:00', end: '17:00' }],
        orders: [{ id: 'FOREIGN-ORDER', storeId: 'S2', amount: 999_000 }],
      },
    }, null, { 'x-idosi-bootstrap-token': 'command-repair-fixture' })
    expect(bootstrap.status).toBe(201)
    const database = runtime.database.database
    // Exercise both indexed and legacy NULL dimensions. The eligible row is
    // in the UNION's second branch, after ineligible open records.
    database.prepare("UPDATE state_entities SET open_flag=NULL WHERE collection_key='attendance' AND record_id IN ('A1', 'A2')").run()
    const insertUser = database.prepare(`
      INSERT INTO users (id, username, username_normalized, display_name, password_hash, password_salt,
        password_iterations, password_algorithm, role, status, store_id, employee_id, password_updated_at, created_at, updated_at)
      SELECT ?, ?, ?, ?, password_hash, password_salt, password_iterations, password_algorithm,
        ?, 'active', ?, ?, password_updated_at, created_at, updated_at FROM users WHERE username='repair.admin'
    `)
    for (const [username, role, employee] of [
      ['repair.employee', 'employee', employees[0]], ['repair.support', 'business_support', employees[2]],
      ['repair.manager', 'store_manager', employees[3]], ['repair.foreign', 'employee', employees[4]],
    ]) insertUser.run(`USER-${employee.id}`, username, username, employee.name, role, employee.storeId, employee.id)
    const logins = {}
    for (const role of ['admin', 'support', 'manager', 'employee']) {
      const login = await request('/api/login', { username: `repair.${role}`, password: 'synthetic-command-password' })
      expect(login.status).toBe(200)
      logins[role] = login.payload.token
    }
    let globalReads = 0
    const readSnapshot = runtime.database.readStateSnapshot.bind(runtime.database)
    runtime.database.readStateSnapshot = (...args) => { globalReads += 1; return readSnapshot(...args) }
    // Catalogue settings renders definitions and identity only. Its read must
    // not load operational history or run a repair even when one is eligible.
    for (const role of ['admin', 'support']) {
      const catalog = await request('/api/system-screens/work-catalog', null, logins[role])
      expect(catalog.status).toBe(200)
      expect(catalog.payload.state.workCatalogItems.map(({ id }) => id)).toEqual(expect.arrayContaining(
        DEFAULT_STORE_WORK_CATALOG_ITEMS.map(({ id }) => id),
      ))
      expect(catalog.payload.state.stores.map(({ id }) => id)).toEqual(['S1', 'S2'])
      expect(catalog.payload.state.shiftDefinitions).toEqual([
        { id: 'SHIFT-1', storeId: 'S1', name: 'Fixture shift', start: '08:00', end: '17:00' },
      ])
      for (const key of ['attendance', 'tasks', 'taskAssignmentHistory', 'workCatalogProgress', 'compensationEntries', 'teamRewardClaims']) {
        expect(catalog.payload.state[key] || []).toEqual([])
      }
      if (role === 'support') expect(catalog.payload.state.accountProfile).toMatchObject({ code: 'E3', name: 'Support employee' })
      expect(JSON.stringify(catalog.payload)).not.toContain('MUST-NOT-LOAD')
    }
    expect(globalReads).toBe(0)
    const ownUsers = await request('/api/users', null, logins.manager)
    expect(ownUsers.status).toBe(200)
    expect(ownUsers.payload.users.map(({ employeeId }) => employeeId)).toEqual(['E1'])
    expect((await request('/api/users', null, logins.support)).status).toBe(200)
    expect((await request('/api/users', null, logins.employee)).status).toBe(403)
    expect(globalReads).toBe(0)

    const beforeAttendance = database.prepare("SELECT value_json FROM state_entities WHERE collection_key='attendance' ORDER BY entity_key").all()
    const readUnrelatedHistory = () => database.prepare("SELECT value_json FROM state_entities WHERE collection_key='taskAssignmentHistory' AND record_id='UNRELATED-HISTORY'").get()
    const beforeHistory = readUnrelatedHistory()
    const command = { type: 'store.update', includeState: false, expectedVersion: 1, payload: { id: 'S1', name: 'Renamed Store', short: 'Renamed' } }
    const saved = await request('/api/command', command, logins.admin, { 'idempotency-key': 'command-repair-save' })
    expect(saved.status, JSON.stringify(saved.payload)).toBe(200)
    expect(saved.payload.version).toBe(eligible ? 3 : 2)
    expect(saved.payload).not.toHaveProperty('state')
    expect(database.prepare("SELECT COUNT(*) AS count FROM audit_log WHERE action='attendance.checklist.repair_legacy'").get().count)
      .toBe(eligible ? 1 : 0)
    if (eligible) {
      expect(globalReads).toBeGreaterThan(0)
      const repaired = JSON.parse(database.prepare("SELECT value_json FROM state_entities WHERE collection_key='attendance' AND record_id='A1'").get().value_json)
      expect(repaired.checklistSnapshot.storeChecklistRepairVersion).toBe(1)
      expect(repaired.checklistSnapshot.tasks.some(({ kind }) => kind === 'FIXED_TASK')).toBe(true)
    } else {
      expect(globalReads).toBe(0)
      expect(database.prepare("SELECT value_json FROM state_entities WHERE collection_key='attendance' ORDER BY entity_key").all()).toEqual(beforeAttendance)
    }
    const readsAfterSave = globalReads
    const replay = await request('/api/command', command, logins.admin, { 'idempotency-key': 'command-repair-save' })
    expect(replay.status).toBe(200)
    expect(replay.payload.version).toBe(saved.payload.version)
    expect(globalReads).toBe(readsAfterSave)
    expect(JSON.parse(database.prepare("SELECT value_json FROM state_entities WHERE collection_key='orders' AND record_id='FOREIGN-ORDER'").get().value_json))
      .toMatchObject({ id: 'FOREIGN-ORDER', storeId: 'S2', amount: 999_000 })
    expect(readUnrelatedHistory()).toEqual(beforeHistory)
  } finally {
    await new Promise((done) => server.close(done))
    await rm(directory, { recursive: true, force: true })
  }
}, 30_000)
