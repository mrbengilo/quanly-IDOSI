import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import worker, {
  canReadScope,
  canUseCounter,
  canWriteScope,
  hashPassword,
  monthFromRecord,
  projectSharedState,
  verifyPassword,
} from './worker'

class MemoryD1Statement {
  constructor(database, sql, bindings = []) {
    this.database = database
    this.sql = sql
    this.bindings = bindings
  }

  bind(...bindings) {
    return new MemoryD1Statement(this.database, this.sql, bindings)
  }

  async first() {
    return this.database.prepare(this.sql).get(...this.bindings) || null
  }

  async all() {
    return { results: this.database.prepare(this.sql).all(...this.bindings) }
  }

  async run() {
    const result = this.database.prepare(this.sql).run(...this.bindings)
    return { meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid || 0) } }
  }
}

class MemoryD1 {
  constructor() {
    this.database = new DatabaseSync(':memory:')
    const migration = readFileSync('drizzle/0000_idosi_core.sql', 'utf8')
      .replaceAll('--> statement-breakpoint', '')
    this.database.exec(migration)
  }

  prepare(sql) {
    return new MemoryD1Statement(this.database, sql)
  }

  async batch(statements) {
    if (this.beforeBatch) {
      const beforeBatch = this.beforeBatch
      this.beforeBatch = null
      await beforeBatch(this, statements)
    }
    this.database.exec('BEGIN IMMEDIATE')
    try {
      const results = []
      for (const statement of statements) results.push(await statement.run())
      this.database.exec('COMMIT')
      return results
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
  }
}

const jsonRequest = (url, body, headers = {}) => new Request(url, {
  method: 'POST',
  headers: { 'content-type': 'application/json', ...headers },
  body: JSON.stringify(body),
})

describe('IDOSI Worker security primitives', () => {
  it('hashes passwords with salted PBKDF2 and verifies without storing plaintext', async () => {
    const record = await hashPassword('idosi-test-password', { iterations: 100_000 })

    expect(record.algorithm).toBe('PBKDF2-SHA256')
    expect(record.hash).not.toContain('idosi-test-password')
    expect(record.salt).toBeTruthy()
    await expect(verifyPassword('idosi-test-password', record)).resolves.toBe(true)
    await expect(verifyPassword('wrong-password', record)).resolves.toBe(false)
  })

  it('assigns ISO timestamps to the Vietnamese business month', () => {
    expect(monthFromRecord({ createdAt: '2026-08-31T17:30:00.000Z' })).toBe('2026-09')
    expect(monthFromRecord({ period: '2026-10', createdAt: '2026-08-31T17:30:00.000Z' })).toBe('2026-10')
    expect(monthFromRecord({ workDate: '2026-11-01', createdAt: '2026-10-31T17:30:00.000Z' })).toBe('2026-11')
  })

  it('enforces the admin and employee scope model', () => {
    const admin = { role: 'admin', user_id: 'admin-1' }
    const retiredManager = { role: 'store', user_id: 'manager-1', store_id: 'store-01' }
    const employee = { role: 'employee', user_id: 'user-1', employee_id: 'employee-01', store_id: 'store-01' }

    expect(canReadScope(admin, 'store:store-02')).toBe(true)
    expect(canWriteScope(admin, 'global')).toBe(true)
    expect(canReadScope(retiredManager, 'global')).toBe(false)
    expect(canWriteScope(retiredManager, 'store:store-01')).toBe(false)
    expect(canReadScope(employee, 'global')).toBe(true)
    expect(canReadScope(employee, 'employee:employee-01')).toBe(true)
    expect(canReadScope(employee, 'employee:employee-02')).toBe(false)
    expect(canWriteScope(employee, 'global')).toBe(false)
  })

  it('keeps generic counters admin-only because business codes use domain commands', () => {
    const admin = { role: 'admin', user_id: 'admin-1' }
    const employee = { role: 'employee', user_id: 'user-1', employee_id: 'employee-01', store_id: 'store-01' }

    expect(canUseCounter(admin, 'system:sessions')).toBe(true)
    expect(canUseCounter(employee, 'employee:employee-01:tasks')).toBe(false)
    expect(canUseCounter(employee, 'store:store-01:orders')).toBe(false)
    expect(canUseCounter(employee, 'store:store-02:orders')).toBe(false)
  })

  it('projects only an employee own records and strips privileged legacy fields', () => {
    const state = {
      schemaVersion: 2,
      stateVersion: 7,
      adminAccounts: [{ username: 'admin', passwordHash: 'secret' }],
      managerAccounts: [{ username: 'manager', passwordHash: 'secret' }],
      managerPayroll: [{ id: 'pay-manager' }],
      profitShares: [{ id: 'share-manager' }],
      integration: {
        label: 'safe-value',
        accessToken: 'access-token-secret',
        refresh_token: 'refresh-token-secret',
        apiKey: 'api-key-secret',
        client_secret_key: 'client-secret-value',
        authorization_header: 'Bearer hidden',
        cookie_jar: 'session=hidden',
        disguisedCredential: {
          hash: 'credential-hash',
          salt: 'credential-salt',
          iterations: 210_000,
          algorithm: 'PBKDF2-SHA256',
        },
        list: [{ hash: 'h', salt: 's', iterations: 210_000, algorithm: 'PBKDF2-SHA256' }, { safe: true }],
      },
      policies: { late_tolerance_minutes: 99 },
      policyHistory: [{ id: 'policy-history-1', key: 'late_tolerance_minutes' }],
      orderCounters: { S01: 12 },
      stores: [{ id: 'S01', name: 'Cửa hàng 1', revenue: 9_000_000, expense: 2_000_000, profit: 7_000_000 }, { id: 'S02' }],
      employees: [
        { id: 'E01', storeId: 'S01', name: 'Nhân viên 1', passwordHash: 'secret' },
        { id: 'E02', storeId: 'S01', name: 'Nhân viên 2' },
      ],
      orders: [
        { id: 'O01', employeeId: 'E01', storeId: 'S01' },
        { id: 'O02', employeeId: 'E02', storeId: 'S01' },
      ],
      cashTransactions: [
        { id: 'C01', storeId: 'S01', employeeId: 'E02', amount: 1_000_000 },
      ],
      notifications: [
        { id: 'N01', employeeId: 'E01' },
        { id: 'N02', employeeId: 'E02' },
      ],
      attendance: [
        { id: 'A01', employeeId: 'E01', checkInAt: '2026-08-14T01:00:00.000Z', checkOutAt: null },
        { id: 'A02', employeeId: 'E02', checkInAt: '2026-08-14T01:00:00.000Z', checkOutAt: null },
      ],
      tasks: [
        { id: 'T-store', storeId: 'S01', title: 'Công việc chung' },
        { id: 'T-own', storeId: 'S01', employeeId: 'E01' },
        { id: 'T-other', storeId: 'S01', employeeId: 'E02' },
      ],
      payrollPeriods: [{
        id: 'P01',
        period: '2026-08',
        financeSnapshot: { profit: 9_000_000 },
        kpiSnapshot: { results: [{ id: 'E01' }, { id: 'E02' }] },
        closedBy: { id: 'admin-1', name: 'Admin' },
        rows: [
          { employeeId: 'E01', gross: 5_000_000 },
          { employeeId: 'E02', gross: 6_000_000 },
        ],
      }],
    }

    const projection = projectSharedState(state, {
      role: 'employee',
      user_id: 'user-1',
      employee_id: 'E01',
      store_id: 'S01',
    })

    expect(projection.stores).toEqual([{ id: 'S01', name: 'Cửa hàng 1' }])
    expect(projection.employees).toEqual([{ id: 'E01', storeId: 'S01', name: 'Nhân viên 1' }])
    expect(projection.orders).toEqual([{ id: 'O01', employeeId: 'E01', storeId: 'S01' }])
    expect(projection.notifications).toEqual([{ id: 'N01', employeeId: 'E01' }])
    expect(projection.tasks.map(({ id }) => id)).toEqual(['T-store', 'T-own'])
    expect(projection.payrollPeriods).toEqual([{
      id: 'P01',
      period: '2026-08',
      rows: [{ employeeId: 'E01', gross: 5_000_000 }],
    }])
    expect(projection.activeAttendanceId).toBe('A01')
    expect(projection.checkedInAt).toBe('2026-08-14T01:00:00.000Z')
    expect(projection.finishedShift).toBe(false)
    expect(projection).not.toHaveProperty('cashTransactions')
    for (const key of ['adminAccounts', 'managerAccounts', 'managerPayroll', 'profitShares', 'policies', 'orderCounters']) {
      expect(projection).not.toHaveProperty(key)
    }
    expect(projectSharedState(state, { role: 'admin' }).policyHistory).toEqual(state.policyHistory)
    const adminProjection = projectSharedState(state, { role: 'admin' })
    expect(adminProjection.integration).toEqual({ label: 'safe-value', list: [{ safe: true }] })
    expect(JSON.stringify(adminProjection)).not.toMatch(/access-token-secret|refresh-token-secret|api-key-secret|client-secret-value|credential-hash|Bearer hidden|session=hidden/u)
  })

  it('preserves SPA fallback and exposes a no-cache API health response', async () => {
    const html = '<!doctype html><div id="root"></div>'
    const env = {
      ASSETS: {
        async fetch(request) {
          return new URL(request.url).pathname === '/index.html'
            ? new Response(html, { headers: { 'content-type': 'text/html' } })
            : new Response('Not found', { status: 404 })
        },
      },
    }

    const page = await worker.fetch(new Request('https://idosi.example/admin/overview'), env)
    expect(page.status).toBe(200)
    expect(await page.text()).toContain('id="root"')

    const health = await worker.fetch(new Request('https://idosi.example/api/health'), env)
    expect(health.status).toBe(200)
    expect(health.headers.get('cache-control')).toBe('no-store')
    expect(await health.json()).toMatchObject({ ok: true, service: 'idosi-api', databaseConfigured: false })
  })

  it('rolls back the import counter when the shared-state CAS loses a race', async () => {
    const env = { DB: new MemoryD1(), BOOTSTRAP_TOKEN: 'bootstrap-counter-race' }
    const bootstrap = await worker.fetch(jsonRequest('https://idosi.example/api/bootstrap', {
      username: 'admin',
      password: 'counter-race-password',
      initialState: {
        stores: [{ id: 'S01', short: 'S01', name: 'Cửa hàng 01' }],
        importVouchers: [],
        expenseEntries: [],
      },
    }, { 'x-idosi-bootstrap-token': env.BOOTSTRAP_TOKEN }), env)
    expect(bootstrap.status).toBe(201)
    const login = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
      username: 'admin',
      password: 'counter-race-password',
    }), env)
    const authorization = { authorization: `Bearer ${(await login.json()).token}` }
    const command = {
      type: 'import.create',
      expectedVersion: 1,
      payload: {
        storeId: 'S01',
        items: [{ name: 'Áo', category: 'Áo', quantity: 1, price: 100_000 }],
      },
    }
    env.DB.beforeBatch = async (database, statements) => {
      if (statements.some((statement) => statement.sql.includes('UPDATE counters'))) {
        database.database.prepare("UPDATE app_state SET version = version + 1 WHERE scope_key = 'global'").run()
      }
    }
    const raced = await worker.fetch(jsonRequest('https://idosi.example/api/command', command, {
      ...authorization,
      'idempotency-key': 'import-counter-race-1',
    }), env)
    expect(raced.status).toBe(409)
    expect(env.DB.database.prepare("SELECT counter_value FROM counters WHERE counter_name = 'system:imports'").get().counter_value).toBe(0)
    expect(JSON.parse(env.DB.database.prepare("SELECT value_json FROM app_state WHERE scope_key = 'global'").get().value_json).importVouchers).toEqual([])

    const retry = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      ...command,
      expectedVersion: 2,
    }, {
      ...authorization,
      'idempotency-key': 'import-counter-race-2',
    }), env)
    expect(retry.status).toBe(201)
    expect(await retry.json()).toMatchObject({
      voucher: { code: expect.stringMatching(/-00001$/u) },
      counter: { value: 1 },
    })
  })

  it('runs bootstrap, employee lifecycle, projected state, atomic order creation, and logout end to end', async () => {
    const env = { DB: new MemoryD1(), BOOTSTRAP_TOKEN: 'bootstrap-secret-for-test' }
    const initialState = {
      schemaVersion: 2,
      stateVersion: 1,
      stores: [{ id: 'SM234', short: 'SM234', name: 'IDOSI 234' }],
      employees: [
        { id: 'NV001', storeId: 'SM234', name: 'Nhân viên 1', passwordHash: 'must-never-leave-server' },
      ],
      orders: [{
        id: 'legacy-order-7',
        code: 'SM234-00007',
        storeId: 'SM234',
        employeeId: 'NV001',
        amount: 500_000,
        paymentMethod: 'Tiền mặt',
        source: 'order',
        createdAt: '2026-01-01T00:00:00.000Z',
        deletedAt: null,
      }],
      notifications: [],
      attendance: [],
      schedule: [],
      tasks: [],
      shiftDefinitions: [{ id: 'ca1', name: 'Ca kiểm thử', start: '00:00', end: '23:59', active: true, storeId: 'SM234' }],
      managerAccounts: [{ username: 'removed-role', passwordHash: 'must-be-removed' }],
      managerPayroll: [{ id: 'legacy-manager-payroll' }],
      profitShares: [{ id: 'legacy-profit-share' }],
      policies: { late_tolerance_minutes: 500 },
      orderCounters: { SM234: 99 },
    }
    const bootstrap = await worker.fetch(jsonRequest('https://idosi.example/api/bootstrap', {
      username: 'admin',
      password: 'idosi-test-password',
      displayName: 'Quản trị kiểm thử',
      initialState,
    }, { 'x-idosi-bootstrap-token': env.BOOTSTRAP_TOKEN }), env)
    expect(bootstrap.status).toBe(201)
    expect(await bootstrap.json()).toMatchObject({ ok: true, initialized: true })

    const login = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
      username: 'ADMIN',
      password: 'idosi-test-password',
    }), env)
    expect(login.status).toBe(200)
    const loginBody = await login.json()
    expect(loginBody.user).toMatchObject({ username: 'admin', role: 'admin' })
    expect(loginBody.token).toBeTruthy()
    const authorization = { authorization: `Bearer ${loginBody.token}` }

    const initial = await worker.fetch(new Request('https://idosi.example/api/bootstrap', { headers: authorization }), env)
    expect(initial.status).toBe(200)
    const initialBody = await initial.json()
    expect(initialBody).toMatchObject({
      scope: 'global',
      projection: 'admin',
      version: 1,
      state: { stores: [{ id: 'SM234' }], employees: [{ id: 'NV001' }] },
    })
    expect(initialBody.policies).toHaveLength(5)
    for (const key of ['managerAccounts', 'managerPayroll', 'profitShares', 'policies', 'orderCounters']) {
      expect(initialBody.state).not.toHaveProperty(key)
    }

    const createUserBody = {
      type: 'user.create',
      payload: {
        username: 'employee1',
        password: 'employee-test-password',
        displayName: 'Nhân viên 1',
        storeId: 'SM234',
        employeeId: 'NV001',
      },
    }
    const createUserHeaders = { ...authorization, 'idempotency-key': 'user-create-0001' }
    const createdUser = await worker.fetch(jsonRequest(
      'https://idosi.example/api/command',
      createUserBody,
      createUserHeaders,
    ), env)
    expect(createdUser.status).toBe(201)
    const createdUserBody = await createdUser.json()
    expect(createdUserBody.user).toMatchObject({
      username: 'employee1',
      role: 'employee',
      storeId: 'SM234',
      employeeId: 'NV001',
      status: 'active',
      version: 1,
    })
    const employeeUserId = createdUserBody.user.id

    const users = await worker.fetch(new Request('https://idosi.example/api/users', { headers: authorization }), env)
    expect(users.status).toBe(200)
    const usersBody = await users.json()
    expect(usersBody.users).toEqual([expect.objectContaining({
      id: employeeUserId,
      username: 'employee1',
      role: 'employee',
      version: 1,
    })])
    expect(JSON.stringify(usersBody)).not.toContain('password_hash')
    expect(JSON.stringify(usersBody)).not.toContain('employee-test-password')

    const employeeLogin = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
      username: 'employee1',
      password: 'employee-test-password',
    }), env)
    expect(employeeLogin.status).toBe(200)
    const employeeLoginBody = await employeeLogin.json()
    const employeeAuthorization = { authorization: `Bearer ${employeeLoginBody.token}` }

    const updateUser = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'user.update',
      expectedVersion: 1,
      payload: { userId: employeeUserId, displayName: 'Nhân viên Một' },
    }, { ...authorization, 'idempotency-key': 'user-update-0001' }), env)
    expect(updateUser.status).toBe(200)
    expect(await updateUser.json()).toMatchObject({ user: { displayName: 'Nhân viên Một', version: 2 } })

    const employeeBootstrap = await worker.fetch(new Request(
      'https://idosi.example/api/bootstrap',
      { headers: employeeAuthorization },
    ), env)
    expect(employeeBootstrap.status).toBe(200)
    const employeeBootstrapBody = await employeeBootstrap.json()
    expect(employeeBootstrapBody).toMatchObject({
      scope: 'global',
      projection: 'employee',
      version: 1,
      user: { role: 'employee', employeeId: 'NV001', storeId: 'SM234', version: 2 },
      state: {
        stores: [{ id: 'SM234' }],
        employees: [{ id: 'NV001' }],
        orders: [{ code: 'SM234-00007' }],
      },
    })
    expect(employeeBootstrapBody.policies).toHaveLength(5)
    expect(employeeBootstrapBody.state.employees[0]).not.toHaveProperty('passwordHash')

    const employeeCannotReplace = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'state.merge',
      scope: 'global',
      expectedVersion: 1,
      payload: { patch: { compromised: true } },
    }, { ...employeeAuthorization, 'idempotency-key': 'employee-state-0001' }), env)
    expect(employeeCannotReplace.status).toBe(403)
    expect(await employeeCannotReplace.json()).toMatchObject({ error: { code: 'SCOPE_FORBIDDEN' } })

    const commandBody = {
      type: 'state.merge',
      scope: 'global',
      expectedVersion: 1,
      payload: { patch: { ready: true } },
    }
    const commandHeaders = { ...authorization, 'idempotency-key': 'state-command-0001' }
    const updated = await worker.fetch(jsonRequest('https://idosi.example/api/command', commandBody, commandHeaders), env)
    expect(updated.status).toBe(200)
    expect(await updated.json()).toMatchObject({ version: 2, state: { stores: [{ id: 'SM234' }], ready: true } })

    const replayed = await worker.fetch(jsonRequest('https://idosi.example/api/command', commandBody, commandHeaders), env)
    expect(replayed.status).toBe(200)
    expect(replayed.headers.get('idempotency-replayed')).toBe('true')
    expect(await replayed.json()).toMatchObject({ version: 2 })

    const reusedKey = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      ...commandBody,
      payload: { patch: { different: true } },
    }, commandHeaders), env)
    expect(reusedKey.status).toBe(409)
    expect(await reusedKey.json()).toMatchObject({ ok: false, error: { code: 'IDEMPOTENCY_KEY_REUSED' } })

    const stale = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      ...commandBody,
      payload: { patch: { stale: true } },
    }, { ...authorization, 'idempotency-key': 'state-command-0002' }), env)
    expect(stale.status).toBe(409)
    expect(await stale.json()).toMatchObject({ ok: false, error: { code: 'VERSION_CONFLICT' } })

    const policy = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'policy.set',
      expectedVersion: 1,
      payload: { key: 'late_tolerance_minutes', value: 12 },
    }, { ...authorization, 'idempotency-key': 'policy-command-0001' }), env)
    expect(policy.status).toBe(200)
    expect(await policy.json()).toMatchObject({ policy: { key: 'late_tolerance_minutes', value: 12, version: 2 } })

    const policyBatch = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'policies.set',
      payload: {
        updates: [
          { key: 'late_tolerance_minutes', value: 13, expectedVersion: 2 },
          { key: 'early_check_in_limit_minutes', value: 90, expectedVersion: 1 },
        ],
      },
    }, { ...authorization, 'idempotency-key': 'policy-batch-0001' }), env)
    expect(policyBatch.status).toBe(200)
    expect(await policyBatch.json()).toMatchObject({
      policies: [
        { key: 'late_tolerance_minutes', value: 13, version: 3 },
        { key: 'early_check_in_limit_minutes', value: 90, version: 2 },
      ],
    })

    const businessCounter = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'counter.next',
      expectedVersion: 0,
      payload: { name: 'store:SM234:orders', prefix: 'CLIENT-CANNOT-CONTROL' },
    }, { ...authorization, 'idempotency-key': 'counter-command-0001' }), env)
    expect(businessCounter.status).toBe(400)
    expect(await businessCounter.json()).toMatchObject({ error: { code: 'DOMAIN_COMMAND_REQUIRED' } })

    const checkInBody = {
      type: 'attendance.check_in',
      expectedVersion: 2,
      payload: {
        shiftId: 'ca1',
        location: { latitude: 10.7769, longitude: 106.7009, accuracy: 12 },
      },
    }
    const checkInHeaders = { ...employeeAuthorization, 'idempotency-key': 'attendance-in-0001' }
    const checkedIn = await worker.fetch(jsonRequest(
      'https://idosi.example/api/command',
      checkInBody,
      checkInHeaders,
    ), env)
    expect(checkedIn.status).toBe(201)
    const checkedInBody = await checkedIn.json()
    expect(checkedInBody).toMatchObject({
      version: 3,
      attendance: {
        employeeId: 'NV001',
        storeId: 'SM234',
        shiftId: 'ca1',
        shiftName: 'Ca kiểm thử',
        checkInLocation: { latitude: 10.7769, longitude: 106.7009, accuracy: 12 },
      },
    })
    const attendanceId = checkedInBody.attendance.id

    const replayedCheckIn = await worker.fetch(jsonRequest(
      'https://idosi.example/api/command',
      checkInBody,
      checkInHeaders,
    ), env)
    expect(replayedCheckIn.status).toBe(201)
    expect(replayedCheckIn.headers.get('idempotency-replayed')).toBe('true')

    const orderBody = {
      type: 'order.create',
      expectedVersion: 3,
      payload: {
        storeId: 'SM234',
        amount: 1_250_000,
        customerName: 'Khách kiểm thử',
        customerPhone: '0901 234 567',
        paymentMethod: 'Chuyển khoản',
      },
    }
    const orderHeaders = { ...employeeAuthorization, 'idempotency-key': 'order-create-0001' }
    const createdOrder = await worker.fetch(jsonRequest(
      'https://idosi.example/api/command',
      orderBody,
      orderHeaders,
    ), env)
    expect(createdOrder.status).toBe(201)
    const createdOrderBody = await createdOrder.json()
    expect(createdOrderBody).toMatchObject({
      version: 4,
      order: {
        code: 'SM234-00008',
        storeId: 'SM234',
        employeeId: 'NV001',
        shiftId: 'ca1',
        shiftName: 'Ca kiểm thử',
        attendanceId,
        amount: 1_250_000,
      },
    })

    const replayedOrder = await worker.fetch(jsonRequest(
      'https://idosi.example/api/command',
      orderBody,
      orderHeaders,
    ), env)
    expect(replayedOrder.status).toBe(201)
    expect(replayedOrder.headers.get('idempotency-replayed')).toBe('true')
    expect((await replayedOrder.json()).order.code).toBe('SM234-00008')

    const checkedOut = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'attendance.check_out',
      expectedVersion: 4,
      payload: {
        attendanceId,
        location: { latitude: 10.777, longitude: 106.701, accuracy: 15 },
      },
    }, { ...employeeAuthorization, 'idempotency-key': 'attendance-out-0001' }), env)
    expect(checkedOut.status).toBe(200)
    expect(await checkedOut.json()).toMatchObject({
      version: 5,
      attendance: {
        id: attendanceId,
        orderCount: 1,
        revenue: 1_250_000,
        cash: 0,
        transfer: 1_250_000,
      },
    })

    const employeeState = await worker.fetch(new Request(
      'https://idosi.example/api/state',
      { headers: employeeAuthorization },
    ), env)
    expect(employeeState.status).toBe(200)
    const employeeStateBody = await employeeState.json()
    expect(employeeStateBody.version).toBe(5)
    expect(employeeStateBody.state.orders).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'SM234-00008', employeeId: 'NV001', attendanceId }),
      expect.objectContaining({ code: 'SM234-00007', employeeId: 'NV001' }),
    ]))
    expect(employeeStateBody.state.attendance).toEqual([
      expect.objectContaining({ id: attendanceId, checkOutAt: expect.any(String), revenue: 1_250_000 }),
    ])
    expect(employeeStateBody.state).not.toHaveProperty('cashTransactions')

    const lockUser = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'user.set_status',
      expectedVersion: 2,
      payload: { userId: employeeUserId, status: 'locked' },
    }, { ...authorization, 'idempotency-key': 'user-lock-0001' }), env)
    expect(lockUser.status).toBe(200)
    expect(await lockUser.json()).toMatchObject({ user: { status: 'locked', version: 3 } })

    const afterLock = await worker.fetch(new Request(
      'https://idosi.example/api/state',
      { headers: employeeAuthorization },
    ), env)
    expect(afterLock.status).toBe(401)

    const resetPassword = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'user.reset_password',
      expectedVersion: 3,
      payload: { userId: employeeUserId, password: 'employee-new-password' },
    }, { ...authorization, 'idempotency-key': 'user-password-0001' }), env)
    expect(resetPassword.status).toBe(200)
    expect(await resetPassword.json()).toMatchObject({ user: { version: 4 } })

    const reactivate = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'user.set_status',
      expectedVersion: 4,
      payload: { userId: employeeUserId, status: 'active' },
    }, { ...authorization, 'idempotency-key': 'user-active-0001' }), env)
    expect(reactivate.status).toBe(200)
    expect(await reactivate.json()).toMatchObject({ user: { status: 'active', version: 5 } })

    const relogin = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
      username: 'employee1',
      password: 'employee-new-password',
    }), env)
    expect(relogin.status).toBe(200)
    expect(await relogin.json()).toMatchObject({ user: { role: 'employee', version: 5 } })

    const changeAdminPassword = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'user.change_password',
      expectedVersion: 1,
      payload: {
        currentPassword: 'idosi-test-password',
        newPassword: 'idosi-admin-new-password',
      },
    }, { ...authorization, 'idempotency-key': 'admin-password-0001' }), env)
    expect(changeAdminPassword.status).toBe(200)
    expect(await changeAdminPassword.json()).toMatchObject({
      user: { role: 'admin', version: 2 },
      otherSessionsRevoked: true,
    })

    const audit = await worker.fetch(new Request('https://idosi.example/api/audit?limit=20', { headers: authorization }), env)
    expect(audit.status).toBe(200)
    expect((await audit.json()).audit.map(({ action }) => action)).toEqual(expect.arrayContaining([
      'system.bootstrap',
      'auth.login',
      'user.create',
      'user.update',
      'state.merge',
      'policy.set',
      'policies.set',
      'attendance.check_in',
      'order.create',
      'attendance.check_out',
      'user.set_status',
      'user.reset_password',
      'user.change_password',
    ]))

    const logout = await worker.fetch(jsonRequest('https://idosi.example/api/logout', {}, authorization), env)
    expect(logout.status).toBe(200)
    const afterLogout = await worker.fetch(new Request('https://idosi.example/api/state', { headers: authorization }), env)
    expect(afterLogout.status).toBe(401)
  })

  it('commits production domain commands atomically with RBAC, audit, and finance deduplication', async () => {
    const env = { DB: new MemoryD1(), BOOTSTRAP_TOKEN: 'bootstrap-finance-secret' }
    const localDate = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Ho_Chi_Minh',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date())
    const period = localDate.slice(0, 7)
    const occurredAt = `${localDate}T12:00:00+07:00`
    const initialState = {
      schemaVersion: 2,
      stateVersion: 1,
      stores: [{ id: 'S01', short: 'S01', name: 'Cửa hàng 01' }],
      employees: [{
        id: 'E01',
        storeId: 'S01',
        name: 'Nhân viên 01',
        status: 'Đang làm việc',
        payBasis: 'monthly',
        monthlySalary: 10_000_000,
        tiktokAllowance: 0,
      }],
      orders: [{
        id: 'ORDER-01',
        code: 'S01-00001',
        storeId: 'S01',
        employeeId: 'E01',
        employeeName: 'Nhân viên 01',
        attendanceId: 'ATT-01',
        shiftId: 'SHIFT-01',
        amount: 20_000_000,
        paymentMethod: 'Tiền mặt',
        customerName: 'Khách ban đầu',
        customerPhone: '0901234567',
        customerAge: 30,
        source: 'order',
        status: 'Hoàn tất',
        createdAt: occurredAt,
        updatedAt: occurredAt,
        deletedAt: null,
      }],
      attendance: [{
        id: 'ATT-01',
        employeeId: 'E01',
        storeId: 'S01',
        shiftId: 'SHIFT-01',
        date: localDate,
        checkInAt: `${localDate}T08:00:00+07:00`,
        checkOutAt: `${localDate}T17:00:00+07:00`,
        hours: 160,
        revenue: 20_000_000,
        cash: 20_000_000,
        transfer: 0,
        orderCount: 1,
      }],
      tasks: [{ id: 'TASK-01', storeId: 'S01', employeeId: 'E01', title: 'Kiểm kê', completedBy: {} }],
      orderAudit: [],
      auditLogs: [],
      notifications: [],
      expenseEntries: [],
      fixedExpenses: [],
      cashTransactions: [],
      importVouchers: [{
        id: 'IMPORT-LEGACY',
        code: 'PN-01012020-00005',
        storeId: 'S01',
        items: [{ name: 'Dữ liệu cũ', category: 'Khác', quantity: 1, price: 1 }],
        goodsAmount: 1,
        shippingAmount: 0,
        relatedAmount: 0,
        totalAmount: 1,
        status: 'Đã xóa',
        createdAt: '2020-01-01T12:00:00+07:00',
        deletedAt: '2020-01-02T12:00:00+07:00',
      }],
      salaryAdjustments: [],
      salaryAdvances: [],
      payrollPeriods: [],
      payrollPayments: [],
      schedule: [],
      shiftDefinitions: [],
    }
    const bootstrap = await worker.fetch(jsonRequest('https://idosi.example/api/bootstrap', {
      username: 'admin',
      password: 'finance-admin-password',
      displayName: 'Admin tài chính',
      initialState,
    }, { 'x-idosi-bootstrap-token': env.BOOTSTRAP_TOKEN }), env)
    expect(bootstrap.status).toBe(201)

    const adminLogin = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
      username: 'admin',
      password: 'finance-admin-password',
    }), env)
    const adminToken = (await adminLogin.json()).token
    const adminAuthorization = { authorization: `Bearer ${adminToken}` }
    const createEmployee = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'user.create',
      payload: {
        username: 'employee01',
        password: 'finance-employee-password',
        displayName: 'Nhân viên 01',
        storeId: 'S01',
        employeeId: 'E01',
      },
    }, { ...adminAuthorization, 'idempotency-key': 'finance-user-create' }), env)
    expect(createEmployee.status).toBe(201)
    const employeeLogin = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
      username: 'employee01',
      password: 'finance-employee-password',
    }), env)
    const employeeToken = (await employeeLogin.json()).token
    const employeeAuthorization = { authorization: `Bearer ${employeeToken}` }

    const taskDone = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'task.done',
      expectedVersion: 1,
      payload: { taskId: 'TASK-01', done: true, employeeId: 'SHOULD-BE-IGNORED' },
    }, { ...employeeAuthorization, 'idempotency-key': 'task-done-01' }), env)
    expect(taskDone.status).toBe(200)
    expect(await taskDone.json()).toMatchObject({
      version: 2,
      task: { id: 'TASK-01', completedBy: { E01: true } },
    })

    const forbiddenOrderEdit = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'order.update',
      expectedVersion: 2,
      payload: { orderId: 'ORDER-01', amount: 21_000_000, reason: 'Không có quyền' },
    }, { ...employeeAuthorization, 'idempotency-key': 'employee-order-edit' }), env)
    expect(forbiddenOrderEdit.status).toBe(403)

    const updatedOrder = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'order.update',
      expectedVersion: 2,
      payload: {
        orderId: 'ORDER-01',
        amount: 21_000_000,
        paymentMethod: 'Chuyển khoản',
        reason: 'Sửa theo chứng từ',
      },
    }, { ...adminAuthorization, 'idempotency-key': 'order-update-01' }), env)
    expect(updatedOrder.status).toBe(200)
    expect(await updatedOrder.json()).toMatchObject({
      version: 3,
      order: { id: 'ORDER-01', amount: 21_000_000, paymentMethod: 'Chuyển khoản' },
      audit: { reason: 'Sửa theo chứng từ', revenueBefore: 20_000_000, revenueAfter: 21_000_000 },
    })

    const deletedOrder = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'order.delete',
      expectedVersion: 3,
      payload: { orderId: 'ORDER-01', reason: 'Hủy đơn sai' },
    }, { ...adminAuthorization, 'idempotency-key': 'order-delete-01' }), env)
    expect(deletedOrder.status).toBe(200)
    expect(await deletedOrder.json()).toMatchObject({ version: 4, order: { status: 'Đã xóa' } })

    const fixedCreated = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'fixed_expense.create',
      expectedVersion: 4,
      payload: { storeId: 'S01', type: 'Điện', amount: 100_000, note: 'Tháng này', occurredAt },
    }, { ...adminAuthorization, 'idempotency-key': 'fixed-create-01' }), env)
    expect(fixedCreated.status).toBe(201)
    const fixedCreatedBody = await fixedCreated.json()
    expect(fixedCreatedBody).toMatchObject({
      version: 5,
      expense: { type: 'Điện', amount: 100_000 },
      expenseEntry: { sourceType: 'fixed-expense', recognized: true },
    })
    const fixedId = fixedCreatedBody.expense.id

    const fixedUpdated = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'fixed_expense.update',
      expectedVersion: 5,
      payload: { expenseId: fixedId, amount: 150_000, reason: 'Hóa đơn bổ sung' },
    }, { ...adminAuthorization, 'idempotency-key': 'fixed-update-01' }), env)
    expect(fixedUpdated.status).toBe(200)
    expect(await fixedUpdated.json()).toMatchObject({ version: 6, expenseEntry: { amount: 150_000 } })

    const manualExpense = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'expense.create',
      expectedVersion: 6,
      payload: { storeId: 'S01', type: 'Vật tư', category: 'other', amount: 50_000, occurredAt },
    }, { ...adminAuthorization, 'idempotency-key': 'expense-create-01' }), env)
    expect(manualExpense.status).toBe(201)
    expect(await manualExpense.json()).toMatchObject({ version: 7, expenseEntry: { sourceType: 'manual-expense' } })

    const importBody = {
      type: 'import.create',
      expectedVersion: 7,
      payload: {
        storeId: 'S01',
        items: [{ name: 'Áo thun', category: 'Áo', quantity: 2, price: 100_000 }],
        shippingAmount: 10_000,
        relatedAmount: 0,
      },
    }
    const importHeaders = { ...adminAuthorization, 'idempotency-key': 'import-create-01' }
    const importCreated = await worker.fetch(jsonRequest('https://idosi.example/api/command', importBody, importHeaders), env)
    expect(importCreated.status).toBe(201)
    const importCreatedBody = await importCreated.json()
    expect(importCreatedBody).toMatchObject({
      version: 8,
      voucher: { code: expect.stringMatching(/^PN-\d{8}-00006$/u), goodsAmount: 200_000, totalAmount: 210_000 },
      expense: { amount: 210_000, sourceType: 'import-voucher' },
      counter: { name: 'system:imports', value: 6 },
    })
    const replayedImport = await worker.fetch(jsonRequest('https://idosi.example/api/command', importBody, importHeaders), env)
    expect(replayedImport.status).toBe(201)
    expect(replayedImport.headers.get('idempotency-replayed')).toBe('true')
    const voucherId = importCreatedBody.voucher.id

    const importUpdated = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'import.update',
      expectedVersion: 8,
      payload: {
        voucherId,
        items: [{ name: 'Áo thun', category: 'Áo', quantity: 3, price: 100_000 }],
        shippingAmount: 10_000,
        relatedAmount: 0,
        reason: 'Tăng số lượng theo phiếu giao',
      },
    }, { ...adminAuthorization, 'idempotency-key': 'import-update-01' }), env)
    expect(importUpdated.status).toBe(200)
    expect(await importUpdated.json()).toMatchObject({ version: 9, voucher: { totalAmount: 310_000 }, expense: { amount: 310_000 } })

    const importDeleted = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'import.delete',
      expectedVersion: 9,
      payload: { voucherId, reason: 'Phiếu nhập trùng' },
    }, { ...adminAuthorization, 'idempotency-key': 'import-delete-01' }), env)
    expect(importDeleted.status).toBe(200)
    expect(await importDeleted.json()).toMatchObject({
      version: 10,
      voucher: { status: 'Đã xóa' },
      expense: { recognized: false },
    })

    const salaryAdjustment = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'salary_adjustment.create',
      expectedVersion: 10,
      payload: {
        employeeId: 'E01',
        period,
        type: 'Thưởng khác',
        amount: 500_000,
        note: 'Thưởng kiểm thử',
      },
    }, { ...adminAuthorization, 'idempotency-key': 'salary-adjustment-create-01' }), env)
    expect(salaryAdjustment.status).toBe(201)
    expect(await salaryAdjustment.json()).toMatchObject({
      version: 11,
      adjustment: { employeeId: 'E01', period, type: 'Thưởng khác', amount: 500_000 },
    })

    const advanceCreated = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'salary_advance.create',
      expectedVersion: 11,
      payload: { employeeId: 'E01', period, amount: 2_000_000, note: 'Tạm ứng' },
    }, { ...adminAuthorization, 'idempotency-key': 'advance-create-01' }), env)
    expect(advanceCreated.status).toBe(201)
    const advanceCreatedBody = await advanceCreated.json()
    expect(advanceCreatedBody).toMatchObject({
      version: 12,
      advance: { amount: 2_000_000, availableAtCreation: 10_500_000, status: 'Mới tạo' },
    })
    const advanceId = advanceCreatedBody.advance.id

    const advanceUpdated = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'salary_advance.update',
      expectedVersion: 12,
      payload: { advanceId, amount: 2_500_000, note: 'Tạm ứng đã duyệt' },
    }, { ...adminAuthorization, 'idempotency-key': 'advance-update-01' }), env)
    expect(advanceUpdated.status).toBe(200)
    expect(await advanceUpdated.json()).toMatchObject({ version: 13, advance: { amount: 2_500_000 } })

    const advanceConfirmed = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'salary_advance.confirm',
      expectedVersion: 13,
      payload: { advanceId },
    }, { ...adminAuthorization, 'idempotency-key': 'advance-confirm-01' }), env)
    expect(advanceConfirmed.status).toBe(200)
    expect(await advanceConfirmed.json()).toMatchObject({
      version: 14,
      advance: { status: 'Đã chi', amount: 2_500_000 },
      expense: { amount: 2_500_000, sourceType: 'salary-advance' },
      transaction: { amount: 2_500_000, direction: 'out' },
    })

    const payrollClosed = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'payroll.close',
      expectedVersion: 14,
      payload: { storeId: 'S01', period },
    }, { ...adminAuthorization, 'idempotency-key': 'payroll-close-01' }), env)
    expect(payrollClosed.status).toBe(201)
    expect(await payrollClosed.json()).toMatchObject({
      version: 15,
      period: {
        status: 'Đã chốt',
        rows: [{ employeeId: 'E01', gross: 10_500_000, advancesPaid: 2_500_000, remaining: 8_000_000 }],
      },
    })

    const adjustmentAfterClose = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'salary_adjustment.create',
      expectedVersion: 15,
      payload: {
        employeeId: 'E01',
        period,
        type: 'Phụ cấp khác',
        amount: 100_000,
        note: 'Phát sinh sau chốt',
      },
    }, { ...adminAuthorization, 'idempotency-key': 'salary-adjustment-after-close' }), env)
    expect(adjustmentAfterClose.status).toBe(201)
    expect(await adjustmentAfterClose.json()).toMatchObject({ version: 16 })

    const dirtyPayrollPay = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'payroll.pay',
      expectedVersion: 16,
      payload: { storeId: 'S01', period },
    }, { ...adminAuthorization, 'idempotency-key': 'payroll-pay-dirty' }), env)
    expect(dirtyPayrollPay.status).toBe(409)
    expect(await dirtyPayrollPay.json()).toMatchObject({ error: { code: 'PAYROLL_NEEDS_RECLOSE' } })

    const payrollReclosed = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'payroll.close',
      expectedVersion: 16,
      payload: { storeId: 'S01', period },
    }, { ...adminAuthorization, 'idempotency-key': 'payroll-reclose-01' }), env)
    expect(payrollReclosed.status).toBe(200)
    expect(await payrollReclosed.json()).toMatchObject({
      version: 17,
      period: {
        needsReclose: false,
        rows: [{ employeeId: 'E01', gross: 10_600_000, advancesPaid: 2_500_000, remaining: 8_100_000 }],
      },
    })

    const payrollStateRow = env.DB.database.prepare("SELECT value_json FROM app_state WHERE scope_key = 'global'").get()
    const payrollState = JSON.parse(payrollStateRow.value_json)
    const payrollIndex = payrollState.payrollPeriods.findIndex((item) => item.storeId === 'S01' && item.period === period)
    const cleanPayrollStateJson = payrollStateRow.value_json
    payrollState.payrollPeriods[payrollIndex].rows.push({ ...payrollState.payrollPeriods[payrollIndex].rows[0] })
    env.DB.database.prepare("UPDATE app_state SET value_json = ? WHERE scope_key = 'global'").run(JSON.stringify(payrollState))
    const duplicatePayrollPay = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'payroll.pay',
      expectedVersion: 17,
      payload: { storeId: 'S01', period },
    }, { ...adminAuthorization, 'idempotency-key': 'payroll-pay-duplicate-row' }), env)
    expect(duplicatePayrollPay.status).toBe(409)
    expect(await duplicatePayrollPay.json()).toMatchObject({ error: { code: 'PAYROLL_ROW_DUPLICATE' } })
    env.DB.database.prepare("UPDATE app_state SET value_json = ? WHERE scope_key = 'global'").run(cleanPayrollStateJson)

    const payrollPaid = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'payroll.pay',
      expectedVersion: 17,
      payload: { storeId: 'S01', period },
    }, { ...adminAuthorization, 'idempotency-key': 'payroll-pay-01' }), env)
    expect(payrollPaid.status).toBe(200)
    expect(await payrollPaid.json()).toMatchObject({
      version: 18,
      period: { status: 'Đã chi' },
      payments: [{ employeeId: 'E01', amount: 8_100_000 }],
    })

    const payrollLocked = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'payroll.lock',
      expectedVersion: 18,
      payload: { storeId: 'S01', period },
    }, { ...adminAuthorization, 'idempotency-key': 'payroll-lock-01' }), env)
    expect(payrollLocked.status).toBe(200)
    expect(await payrollLocked.json()).toMatchObject({ version: 19, period: { status: 'Đã khóa' } })

    const lockedAdvance = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'salary_advance.create',
      expectedVersion: 19,
      payload: { employeeId: 'E01', period, amount: 100_000 },
    }, { ...adminAuthorization, 'idempotency-key': 'advance-after-lock' }), env)
    expect(lockedAdvance.status).toBe(409)
    expect(await lockedAdvance.json()).toMatchObject({ error: { code: 'PAYROLL_PERIOD_LOCKED' } })

    const protectedReplace = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'state.merge',
      expectedVersion: 19,
      payload: { patch: { orders: [] } },
    }, { ...adminAuthorization, 'idempotency-key': 'protected-state-change' }), env)
    expect(protectedReplace.status).toBe(400)
    expect(await protectedReplace.json()).toMatchObject({ error: { code: 'DOMAIN_COMMAND_REQUIRED' } })

    const rawStateRow = env.DB.database.prepare("SELECT value_json FROM app_state WHERE scope_key = 'global'").get()
    const rawState = JSON.parse(rawStateRow.value_json)
    rawState.legacyIntegration = {
      access_token: 'legacy-access-secret-sentinel',
      disguised: { hash: 'legacy-hash-sentinel', salt: 'salt', iterations: 210_000, algorithm: 'PBKDF2-SHA256' },
    }
    env.DB.database.prepare("UPDATE app_state SET value_json = ? WHERE scope_key = 'global'").run(JSON.stringify(rawState))
    const scrubbedMerge = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'state.merge',
      expectedVersion: 19,
      payload: { patch: { scrubbedLegacyState: true } },
    }, { ...adminAuthorization, 'idempotency-key': 'scrub-legacy-state' }), env)
    expect(scrubbedMerge.status).toBe(200)
    expect(JSON.stringify(await scrubbedMerge.json())).not.toMatch(/legacy-access-secret-sentinel|legacy-hash-sentinel/u)

    const finalStateResponse = await worker.fetch(new Request('https://idosi.example/api/state', {
      headers: adminAuthorization,
    }), env)
    const finalState = (await finalStateResponse.json()).state
    expect(finalState.attendance[0]).toMatchObject({ revenue: 0, cash: 0, transfer: 0, orderCount: 0 })
    expect(finalState.expenseEntries.filter((entry) => (
      entry.sourceType === 'salary-advance' || entry.sourceType === 'payroll-payment'
    )).reduce((sum, entry) => sum + entry.amount, 0)).toBe(10_600_000)
    expect(finalState.expenseEntries.filter((entry) => entry.sourceType === 'import-voucher' && entry.sourceId === voucherId)).toEqual([
      expect.objectContaining({ sourceId: voucherId, amount: 310_000, recognized: false }),
    ])
    expect(finalState.cashTransactions.filter((entry) => entry.sourceType === 'salary-advance')).toHaveLength(1)
    expect(finalState.cashTransactions.filter((entry) => entry.sourceType === 'payroll-payment')).toHaveLength(1)

    const auditResponse = await worker.fetch(new Request('https://idosi.example/api/audit?limit=100', {
      headers: adminAuthorization,
    }), env)
    const auditBody = await auditResponse.json()
    const auditActions = auditBody.audit.map(({ action }) => action)
    expect(JSON.stringify(auditBody)).not.toMatch(/legacy-access-secret-sentinel|legacy-hash-sentinel/u)
    expect(auditActions).toEqual(expect.arrayContaining([
      'task.done',
      'order.update',
      'order.delete',
      'fixed_expense.create',
      'fixed_expense.update',
      'expense.create',
      'import.create',
      'import.update',
      'import.delete',
      'salary_adjustment.create',
      'salary_advance.create',
      'salary_advance.update',
      'salary_advance.confirm',
      'payroll.close',
      'payroll.pay',
      'payroll.lock',
    ]))
  })
})
