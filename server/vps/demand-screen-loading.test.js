// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'
import { createIdosiServer } from './server.mjs'
import { STORE_SCREEN_COLLECTIONS } from './sqlite-d1.mjs'
import { commandStateProjection } from '../worker.js'
import { DEFAULT_STORE_WORK_CATALOG_ITEMS, TEAM_MILESTONE_PROGRAM_IDS } from '../../src/domain/compensationPolicies.js'

it('loads every Worker command input in the corresponding VPS command projection', () => {
  const commands = [
    'order.create', 'fixed_expense.create', 'expense.create', 'import.create', 'import_voucher.create',
    'compensation_entry.create', 'salary_adjustment.create', 'store_salary_config.create',
    'store.create', 'tasks.assign', 'tasks.replace_scope', 'employee.create', 'shift_definition.create',
    'schedule.create', 'account_settings.update', 'notification.read', 'support_transfer.update',
    'operational_reset.create', 'attendance.update', 'order_information.update', 'support_work.create',
    'support_schedule.presets.update', 'support_schedule.create', 'task.done', 'shift_expense.create',
    'salary_advance.create', 'work_catalog.create', 'work_reward.set', 'work_reward.set_batch',
    'violation.create', 'revenue_bonus.create', 'payroll.close',
  ]
  for (const type of commands) {
    const projection = commandStateProjection({ type })
    expect(projection, type).not.toBeNull()
    if (!projection.scoped) continue
    const collections = STORE_SCREEN_COLLECTIONS[projection.screen]
    expect(collections, type).toBeDefined()
    const actual = new Set(['stores', 'employees', 'supportTransfers', ...collections])
    expect(projection.collections.filter((key) => !actual.has(key)), type).toEqual([])
  }
})

it('preserves reward, expense and payroll safeguards without a global command preload', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'idosi-command-inputs-'))
  const { server, runtime } = createIdosiServer({
    databasePath: resolve(directory, 'state.sqlite'), imagesDirectory: resolve(directory, 'images'),
    bootstrapToken: 'command-inputs-fixture', automaticRevenueBonusEnabled: false,
  })
  await new Promise((done) => server.listen(0, '127.0.0.1', done))
  const base = `http://127.0.0.1:${server.address().port}`
  const request = async (path, body, token, extraHeaders = {}) => {
    const response = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...extraHeaders },
      body: JSON.stringify(body),
    })
    return { status: response.status, payload: await response.json() }
  }
  try {
    const progressId = 'work-catalog-progress:v1:OFFICE-E:2026-08-28:OFFICE-ATT:REWARD-VOID'
    const bootstrap = await request('/api/bootstrap', {
      username: 'inputs.admin', password: 'synthetic-command-inputs-password',
      initialState: {
        stores: [{ id: 'S1', name: 'Store 1' }, { id: 'S2', name: 'Store 2' }],
        employees: [
          { id: 'OFFICE-E', name: 'Office employee', storeId: 'OFFICE', unit: 'office' },
          { id: 'STORE-E', name: 'Store employee', storeId: 'S1', unit: 'store' },
        ],
        attendance: [{
          id: 'OFFICE-ATT', employeeId: 'OFFICE-E', storeId: 'OFFICE', unit: 'office',
          date: '2026-08-28', shiftId: 'office_am', checkInAt: '2026-08-28T01:00:00Z',
          checklistSnapshot: { source: 'work-catalog', targetGroup: 'office', tasks: [
            { catalogItemId: 'REWARD-ONE', kind: 'REWARD_TASK', name: 'Captured reward', amountVnd: 2_000 },
            { catalogItemId: 'REWARD-VOID', kind: 'REWARD_TASK', name: 'Previously voided reward', amountVnd: 3_000 },
            { catalogItemId: 'REWARD-TEAM', kind: 'REWARD_TASK', name: 'Team reward', amountVnd: 350_000,
              rewardScope: 'team', milestoneProgramId: TEAM_MILESTONE_PROGRAM_IDS.OFFICE_VIDEO_VIEWS,
              milestoneId: 'office.video.over_100_000_views' },
          ] },
        }, {
          // Missing shift means this legacy row cannot trigger checklist repair.
          id: 'STORE-OPEN', employeeId: 'STORE-E', storeId: 'S1', date: '2026-08-28', checkInAt: '2026-08-28T01:00:00Z',
        }, {
          id: 'SUPPORT-CLOSED', employeeId: 'STORE-E', storeId: 'S2', homeStoreId: 'S1',
          supportTransferId: 'TRANSFER-ONE', date: '2026-08-20', workDate: '2026-08-20',
          checkInAt: '2026-08-20T01:00:00Z', checkOutAt: '2026-08-20T02:00:00Z', workedSeconds: 3600, hours: 1,
        }],
        supportTransfers: [{
          id: 'TRANSFER-ONE', employeeId: 'STORE-E', fromStoreId: 'S1', toStoreId: 'S2',
          startAt: '2026-08-20T00:00:00Z', endAt: '2026-08-20T03:00:00Z',
          hourlySupportRate: 45_000, allowance: 150_000, status: 'Đã duyệt',
        }],
        expenseEntries: [{
          id: 'LEGACY-SUPPORT-EXPENSE', sourceType: 'support-attendance-compensation', sourceId: 'SUPPORT-CLOSED',
          storeId: 'S2', amount: 195_000, recognized: true, reconciliationNote: 'Preserve metadata',
        }, { id: 'FOREIGN-EXPENSE', storeId: 'S2', amount: 777_000, recognized: true }],
        workCatalogProgress: [{ id: progressId, employeeId: 'OFFICE-E', storeId: 'OFFICE', status: 'VOID', checked: false }],
        compensationEntries: [{ id: 'FOREIGN-COMPENSATION', employeeId: 'OTHER', storeId: 'S2', amountVnd: 888_000 }],
        payrollPeriods: [
          { id: 'PAY-OFFICE', storeId: 'OFFICE', period: '2026-08', status: 'Đã chốt' },
          { id: 'PAY-S1', storeId: 'S1', period: '2026-08', status: 'Đang tính' },
          { id: 'PAY-S2', storeId: 'S2', period: '2026-08', status: 'Đã chốt' },
        ],
      },
    }, null, { 'x-idosi-bootstrap-token': 'command-inputs-fixture' })
    expect(bootstrap.status).toBe(201)
    const database = runtime.database.database
    const insertUser = database.prepare(`
      INSERT INTO users (id, username, username_normalized, display_name, password_hash, password_salt,
        password_iterations, password_algorithm, role, status, store_id, employee_id, password_updated_at, created_at, updated_at)
      SELECT ?, ?, ?, ?, password_hash, password_salt, password_iterations, password_algorithm,
        'employee', 'active', ?, ?, password_updated_at, created_at, updated_at FROM users WHERE username='inputs.admin'
    `)
    insertUser.run('USER-OFFICE', 'inputs.office', 'inputs.office', 'Office employee', 'OFFICE', 'OFFICE-E')
    insertUser.run('USER-STORE', 'inputs.store', 'inputs.store', 'Store employee', 'S1', 'STORE-E')
    const tokens = {}
    for (const role of ['admin', 'office', 'store']) {
      const login = await request('/api/login', { username: `inputs.${role}`, password: 'synthetic-command-inputs-password' })
      expect(login.status).toBe(200)
      tokens[role] = login.payload.token
    }
    let globalReads = 0
    const readSnapshot = runtime.database.readStateSnapshot.bind(runtime.database)
    runtime.database.readStateSnapshot = (...args) => { globalReads += 1; return readSnapshot(...args) }
    const readRows = (collection) => database.prepare('SELECT value_json FROM state_entities WHERE collection_key=? ORDER BY entity_order, entity_key')
      .all(collection).map(({ value_json: json }) => JSON.parse(json))
    const mutationCounts = () => database.prepare(`SELECT
      (SELECT version FROM app_state WHERE scope_key='global') AS version,
      (SELECT count(*) FROM audit_log) AS audits,
      (SELECT count(*) FROM command_receipts) AS receipts,
      (SELECT count(*) FROM state_entities) AS entities`).get()
    const command = (type, payload, version, role, key) => request('/api/command', {
      type, payload, expectedVersion: version, includeState: false,
    }, tokens[role], { 'idempotency-key': key })
    const beforeRejected = mutationCounts()
    const rejectedBatch = await command('work_reward.set_batch', {
      attendanceId: 'OFFICE-ATT', items: [
        { catalogItemId: 'REWARD-ONE', checked: true }, { catalogItemId: 'REWARD-VOID', checked: true },
      ],
    }, 1, 'office', 'inputs-rejected-batch')
    expect(rejectedBatch.status, JSON.stringify(rejectedBatch.payload)).toBe(409)
    expect(rejectedBatch.payload.error.code).toBe('WORK_REWARD_ALREADY_RECORDED')
    expect(mutationCounts()).toEqual(beforeRejected)
    const rewardPayload = { attendanceId: 'office-att', catalogItemId: 'reward-one', checked: true }
    const claimed = await command('work_reward.set', rewardPayload, 1, 'office', 'inputs-claim-one')
    expect(claimed.status, JSON.stringify(claimed.payload)).toBe(201)
    expect(claimed.payload.entry).toMatchObject({ amountVnd: 2_000, status: 'APPROVED' })
    expect(readRows('payrollPeriods').find(({ id }) => id === 'PAY-OFFICE')).toMatchObject({ needsReclose: true, invalidationReason: 'work_reward.set' })
    const replay = await command('work_reward.set', rewardPayload, 1, 'office', 'inputs-claim-one')
    expect(replay.payload.version).toBe(2)
    const duplicate = await command('work_reward.set', rewardPayload, 2, 'office', 'inputs-logical-duplicate')
    expect(duplicate.status).toBe(200)
    expect(duplicate.payload).toMatchObject({ existing: true, version: 2 })
    expect(readRows('compensationEntries')).toHaveLength(2)
    expect(readRows('compensationEntries').find(({ id }) => id === 'FOREIGN-COMPENSATION')).toMatchObject({ amountVnd: 888_000 })
    const teamPayload = { attendanceId: 'OFFICE-ATT', catalogItemId: 'REWARD-TEAM', checked: true }
    expect((await command('work_reward.set', teamPayload, 2, 'office', 'inputs-team-claim')).status).toBe(201)
    expect((await command('work_reward.set', teamPayload, 3, 'office', 'inputs-team-duplicate')).payload).toMatchObject({ existing: true, version: 3 })
    expect(readRows('teamRewardClaims')).toHaveLength(1)
    const transfer = await command('support_transfer.update', {
      transferId: 'TRANSFER-ONE', hourlySupportRate: 50_000, allowance: 200_000,
    }, 3, 'admin', 'inputs-transfer-update')
    expect(transfer.status, JSON.stringify(transfer.payload)).toBe(200)
    const expenseRows = readRows('expenseEntries')
    expect(expenseRows.filter(({ sourceId }) => sourceId === 'SUPPORT-CLOSED')).toEqual([
      expect.objectContaining({ id: 'LEGACY-SUPPORT-EXPENSE', amount: 250_000, reconciliationNote: 'Preserve metadata' }),
    ])
    expect(expenseRows.find(({ id }) => id === 'FOREIGN-EXPENSE')).toMatchObject({ amount: 777_000 })
    expect(readRows('payrollPeriods').find(({ id }) => id === 'PAY-S2')).toMatchObject({ needsReclose: true })
    // Lock only the source period after transfer reconciliation, then ensure
    // the employee's shift expense cannot bypass the canonical payroll guard.
    database.prepare(`UPDATE state_entities SET
      value_json=json_set(value_json, '$.status', 'Đã khóa'),
      value_bytes=length(CAST(json_set(value_json, '$.status', 'Đã khóa') AS BLOB))
      WHERE collection_key='payrollPeriods' AND record_id='PAY-S1'`).run()
    const beforeLocked = mutationCounts()
    const locked = await command('shift_expense.create', {
      attendanceId: 'STORE-OPEN', name: 'Cannot enter locked expense', amount: 10_000,
    }, 4, 'store', 'inputs-locked-expense')
    expect(locked.status, JSON.stringify(locked.payload)).toBe(409)
    expect(locked.payload.error.code).toBe('PAYROLL_PERIOD_LOCKED')
    expect(mutationCounts()).toEqual(beforeLocked)
    expect(readRows('expenseEntries')).toEqual(expenseRows)
    expect(globalReads).toBe(0)
  } finally {
    await new Promise((done) => server.close(done))
    await rm(directory, { recursive: true, force: true })
  }
}, 30_000)

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
      { id: 'E3', code: 'SUPPORT3', name: 'Support employee', unit: 'business_support', storeId: 'BUSINESS_SUPPORT' },
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
      ...['employeeCode', 'staffId', 'userId'].map((field, index) => ({
        id: `SUPPORT-HISTORY-${index}`, [field]: 'support3', date: '2026-09-04',
        checkInAt: '2026-09-04T01:00:00Z', checkOutAt: '2026-09-04T09:00:00Z',
        checklistSnapshot: { tasks: [{ id: 'HISTORICAL', amount: 12000 }] },
      })),
      { id: 'FOREIGN-BULK', employeeId: 'E9', checkOutAt: '2026-09-04T09:00:00Z',
        checklistSnapshot: { description: 'FOREIGN-HISTORY'.repeat(20_000) } },
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
        supportWorkSchedules: [
          { id: 'OWN-SCHEDULE', employeeId: 'support3', date: '2026-09-05', start: '08:00', end: '17:00' },
          { id: 'PEER-SCHEDULE', employeeId: 'E9', date: '2026-09-05', start: '09:00', end: '18:00' },
        ],
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
      if (role === 'support') expect(catalog.payload.state.accountProfile).toMatchObject({ code: 'SUPPORT3', name: 'Support employee' })
      expect(JSON.stringify(catalog.payload)).not.toContain('MUST-NOT-LOAD')
    }
    expect(globalReads).toBe(0)
    const optimizedRead = runtime.database.readSystemStateSnapshot
    const overview = await request('/api/system-screens/support-overview', null, logins.support)
    expect(overview.status).toBe(200)
    runtime.database.readSystemStateSnapshot = undefined
    const fallbackOverview = await request('/api/system-screens/support-overview', null, logins.support)
    runtime.database.readSystemStateSnapshot = optimizedRead
    expect(fallbackOverview.status).toBe(200)
    expect(overview.payload.state).toEqual(fallbackOverview.payload.state)
    expect(overview.payload.state.attendance.map(({ id }) => id).sort()).toEqual([
      'A3', 'SUPPORT-HISTORY-0', 'SUPPORT-HISTORY-1', 'SUPPORT-HISTORY-2',
    ])
    expect(overview.payload.state.attendance.find(({ id }) => id === 'SUPPORT-HISTORY-0').checklistSnapshot)
      .toEqual({ tasks: [{ id: 'HISTORICAL', amount: 12000 }] })
    expect(overview.payload.state.supportWorkSchedules.map(({ id }) => id)).toEqual(['OWN-SCHEDULE'])
    expect(overview.payload.state.activeAttendanceId).toBe('A3')
    expect(overview.payload.state.employees).toHaveLength(employees.length)
    expect(overview.payload.state.compensationEntries || []).toEqual([])
    expect(JSON.stringify(overview.payload)).not.toContain('FOREIGN-HISTORY')
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
