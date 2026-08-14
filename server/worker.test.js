// @vitest-environment node

import { describe, expect, it, vi } from 'vitest'
import { Buffer } from 'node:buffer'
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
  constructor(database, sql, bindings = [], onQuery = () => {}) {
    this.database = database
    this.sql = sql
    this.bindings = bindings
    this.onQuery = onQuery
  }

  bind(...bindings) {
    return new MemoryD1Statement(this.database, this.sql, bindings, this.onQuery)
  }

  async first() {
    this.onQuery()
    return this.database.prepare(this.sql).get(...this.bindings) || null
  }

  async all() {
    this.onQuery()
    return { results: this.database.prepare(this.sql).all(...this.bindings) }
  }

  async run() {
    this.onQuery()
    const result = this.database.prepare(this.sql).run(...this.bindings)
    return { meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid || 0) } }
  }
}

class MemoryD1 {
  constructor() {
    this.database = new DatabaseSync(':memory:')
    this.queryCount = 0
    for (const file of [
      'drizzle/0000_idosi_core.sql',
      'drizzle/0001_manager_role.sql',
      'drizzle/0002_attendance_evaluation_policies.sql',
      'drizzle/0003_state_entities.sql',
    ]) {
      const migration = readFileSync(file, 'utf8').replaceAll('--> statement-breakpoint', '')
      this.database.exec(migration)
    }
  }

  prepare(sql) {
    return new MemoryD1Statement(this.database, sql, [], () => { this.queryCount += 1 })
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

const readHydratedState = (database, scope = 'global') => {
  const row = database.prepare('SELECT value_json FROM app_state WHERE scope_key = ?').get(scope)
  const state = JSON.parse(row?.value_json || '{}')
  const collections = database.prepare(`
    SELECT collection_key FROM state_collections WHERE scope_key = ? ORDER BY collection_key
  `).all(scope)
  for (const { collection_key: collectionKey } of collections) {
    state[collectionKey] = database.prepare(`
      SELECT value_json FROM state_entities
      WHERE scope_key = ? AND collection_key = ?
      ORDER BY entity_order, entity_key
    `).all(scope, collectionKey).map(({ value_json: valueJson }) => JSON.parse(valueJson))
  }
  return state
}

const replaceStateCollection = (database, collectionKey, values, scope = 'global') => {
  const timestamp = '2026-08-14T00:00:00.000Z'
  database.prepare(`
    INSERT INTO state_collections (scope_key, collection_key, created_at, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(scope_key, collection_key) DO UPDATE SET updated_at = excluded.updated_at
  `).run(scope, collectionKey, timestamp, timestamp)
  database.prepare('DELETE FROM state_entities WHERE scope_key = ? AND collection_key = ?')
    .run(scope, collectionKey)
  const insert = database.prepare(`
    INSERT INTO state_entities (
      scope_key, collection_key, entity_key, entity_order, value_json, value_bytes, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `)
  values.forEach((value, index) => {
    const valueJson = JSON.stringify(value)
    insert.run(
      scope,
      collectionKey,
      `test:${String(index).padStart(12, '0')}`,
      (index + 1) * 1_000_000,
      valueJson,
      Buffer.byteLength(valueJson),
      timestamp,
      timestamp,
    )
  })
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
    expect(record.iterations).toBe(100_000)
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

  it('enforces the admin, manager, and employee scope model', () => {
    const admin = { role: 'admin', user_id: 'admin-1' }
    const manager = { role: 'manager', user_id: 'manager-1' }
    const employee = { role: 'employee', user_id: 'user-1', employee_id: 'employee-01', store_id: 'store-01' }

    expect(canReadScope(admin, 'store:store-02')).toBe(true)
    expect(canWriteScope(admin, 'global')).toBe(true)
    expect(canReadScope(manager, 'global')).toBe(true)
    expect(canReadScope(manager, 'store:store-01')).toBe(false)
    expect(canReadScope(manager, 'employee:employee-01')).toBe(false)
    expect(canWriteScope(manager, 'global')).toBe(false)
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

  it('migrates legacy users and array state without losing values, order, or foreign keys', () => {
    const database = new DatabaseSync(':memory:')
    database.exec(readFileSync('drizzle/0000_idosi_core.sql', 'utf8').replaceAll('--> statement-breakpoint', ''))
    database.prepare(`
      INSERT INTO users (
        id, username, username_normalized, display_name, password_hash, password_salt,
        password_iterations, password_algorithm, role, status, version,
        password_updated_at, created_at, updated_at
      ) VALUES ('admin-legacy', 'admin', 'admin', 'Admin', 'hash', 'salt',
        100000, 'PBKDF2-SHA256', 'admin', 'active', 1,
        '2026-08-14T00:00:00.000Z', '2026-08-14T00:00:00.000Z', '2026-08-14T00:00:00.000Z')
    `).run()
    database.prepare(`
      INSERT INTO users (
        id, username, username_normalized, display_name, password_hash, password_salt,
        password_iterations, password_algorithm, role, status, version, store_id, employee_id,
        password_updated_at, created_at, updated_at
      ) VALUES ('employee-legacy', 'employee', 'employee', 'Employee', 'hash', 'salt',
        100000, 'PBKDF2-SHA256', 'employee', 'active', 4, 'S01', 'E01',
        '2026-08-14T00:00:00.000Z', '2026-08-14T00:00:00.000Z', '2026-08-14T00:00:00.000Z')
    `).run()
    database.prepare(`
      INSERT INTO sessions (id, token_hash, user_id, created_at, last_seen_at, expires_at)
      VALUES ('session-legacy', 'token-hash-legacy', 'admin-legacy',
        '2026-08-14T00:00:00.000Z', '2026-08-14T00:00:00.000Z', '2026-08-15T00:00:00.000Z')
    `).run()
    database.exec(`
      INSERT INTO app_state (
        scope_key, value_json, version, updated_at, updated_by, last_request_id
      ) VALUES (
        'global', '{"stores":[{"id":"S01","name":"Legacy"},{"id":"S01","name":"Duplicate"}],"mixed":["x",null,true,7,{"id":"M1"}],"empty":[],"scalar":"kept"}',
        3, '2026-08-14T00:00:00.000Z', 'admin-legacy', 'state-request-legacy'
      );
      INSERT INTO policies (
        policy_key, value_json, version, effective_at, updated_at, updated_by, last_request_id
      ) VALUES (
        'late_tolerance_minutes', '10', 2, '2026-08-01T00:00:00.000Z',
        '2026-08-14T00:00:00.000Z', 'admin-legacy', 'policy-request-legacy'
      );
      INSERT INTO audit_log (
        request_id, actor_id, actor_role, action, entity_type, entity_id,
        metadata_json, server_timestamp
      ) VALUES (
        'audit-request-legacy', 'admin-legacy', 'admin', 'legacy.action', 'state', 'global',
        '{"preserved":true}', '2026-08-14T00:00:00.000Z'
      );
      INSERT INTO command_receipts (
        actor_id, idempotency_key, request_hash, response_json, status_code, created_at
      ) VALUES (
        'admin-legacy', 'legacy-command-0001', 'request-hash-legacy', '{"ok":true}', 200,
        '2026-08-14T00:00:00.000Z'
      );
    `)
    database.exec('BEGIN IMMEDIATE')
    try {
      database.exec(readFileSync('drizzle/0001_manager_role.sql', 'utf8').replaceAll('--> statement-breakpoint', ''))
      database.exec(readFileSync('drizzle/0002_attendance_evaluation_policies.sql', 'utf8').replaceAll('--> statement-breakpoint', ''))
      database.exec(readFileSync('drizzle/0003_state_entities.sql', 'utf8').replaceAll('--> statement-breakpoint', ''))
      database.exec('COMMIT')
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }

    expect(database.prepare('SELECT id, role, version FROM users ORDER BY id').all()).toEqual([
      { id: 'admin-legacy', role: 'admin', version: 1 },
      { id: 'employee-legacy', role: 'employee', version: 4 },
    ])
    expect(database.prepare('SELECT COUNT(*) AS count FROM sessions').get()).toEqual({ count: 1 })
    expect(database.prepare("SELECT id, token_hash, user_id FROM sessions WHERE id = 'session-legacy'").get()).toEqual({
      id: 'session-legacy', token_hash: 'token-hash-legacy', user_id: 'admin-legacy',
    })
    expect(database.prepare('SELECT COUNT(*) AS count FROM command_receipts').get()).toEqual({ count: 1 })
    expect(database.prepare("SELECT actor_id, request_hash, response_json FROM command_receipts WHERE idempotency_key = 'legacy-command-0001'").get()).toEqual({
      actor_id: 'admin-legacy', request_hash: 'request-hash-legacy', response_json: '{"ok":true}',
    })
    expect(database.prepare('SELECT COUNT(*) AS count FROM app_state').get()).toEqual({ count: 1 })
    expect(database.prepare("SELECT value_json, version, updated_by FROM app_state WHERE scope_key = 'global'").get()).toEqual({
      value_json: '{"stores":[{"id":"S01","name":"Legacy"},{"id":"S01","name":"Duplicate"}],"mixed":["x",null,true,7,{"id":"M1"}],"empty":[],"scalar":"kept"}',
      version: 3,
      updated_by: 'admin-legacy',
    })
    expect(database.prepare('SELECT collection_key FROM state_collections ORDER BY collection_key').all()).toEqual([
      { collection_key: 'empty' },
      { collection_key: 'mixed' },
      { collection_key: 'stores' },
    ])
    const migratedMixed = database.prepare(`
      SELECT entity_order, value_json, value_bytes
      FROM state_entities
      WHERE scope_key = 'global' AND collection_key = 'mixed'
      ORDER BY entity_order
    `).all()
    expect(migratedMixed.map(({ entity_order, value_json }) => ({ entity_order, value: JSON.parse(value_json) }))).toEqual([
      { entity_order: 1_000_000, value: 'x' },
      { entity_order: 2_000_000, value: null },
      { entity_order: 3_000_000, value: true },
      { entity_order: 4_000_000, value: 7 },
      { entity_order: 5_000_000, value: { id: 'M1' } },
    ])
    expect(migratedMixed.every(({ value_json, value_bytes }) => Buffer.byteLength(value_json) === value_bytes)).toBe(true)
    expect(database.prepare('SELECT COUNT(*) AS count FROM policies').get()).toEqual({ count: 4 })
    expect(database.prepare("SELECT value_json, version, updated_by FROM policies WHERE policy_key = 'late_tolerance_minutes'").get()).toEqual({
      value_json: '10', version: 2, updated_by: 'admin-legacy',
    })
    expect(database.prepare(`
      SELECT policy_key, value_json, version, updated_by
      FROM policies
      WHERE policy_key LIKE 'attendance_%'
      ORDER BY policy_key
    `).all()).toEqual([
      { policy_key: 'attendance_improve_min_late_count', value_json: '3', version: 1, updated_by: null },
      { policy_key: 'attendance_improve_min_late_minutes', value_json: '30', version: 1, updated_by: null },
      { policy_key: 'attendance_maintain_max_late_count', value_json: '2', version: 1, updated_by: null },
    ])
    expect(database.prepare('SELECT COUNT(*) AS count FROM audit_log').get()).toEqual({ count: 1 })
    expect(database.prepare("SELECT request_id, actor_id, metadata_json FROM audit_log WHERE request_id = 'audit-request-legacy'").get()).toEqual({
      request_id: 'audit-request-legacy', actor_id: 'admin-legacy', metadata_json: '{"preserved":true}',
    })
    database.prepare(`
      INSERT INTO users (
        id, username, username_normalized, display_name, password_hash, password_salt,
        password_iterations, password_algorithm, role, status, version,
        password_updated_at, created_at, updated_at
      ) VALUES ('manager-new', 'manager', 'manager', 'Manager', 'hash', 'salt',
        100000, 'PBKDF2-SHA256', 'manager', 'active', 1,
        '2026-08-14T00:00:00.000Z', '2026-08-14T00:00:00.000Z', '2026-08-14T00:00:00.000Z')
    `).run()
    expect(database.prepare('SELECT id, role FROM users ORDER BY id').all()).toEqual([
      { id: 'admin-legacy', role: 'admin' },
      { id: 'employee-legacy', role: 'employee' },
      { id: 'manager-new', role: 'manager' },
    ])
    expect(database.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    database.close()
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
        { id: 'VP001', storeId: 'OFFICE', unit: 'office', name: 'Nhân viên văn phòng' },
      ],
      orders: [
        { id: 'O01', employeeId: 'E01', storeId: 'S01' },
        { id: 'O02', employeeId: 'E02', storeId: 'S01' },
      ],
      officeAdjustments: [{ id: 'OA01', employeeId: 'VP001', amount: 500_000 }],
      supportTransfers: [
        { id: 'ST01', employeeId: 'E01', fromStoreId: 'S01', toStoreId: 'S02' },
        { id: 'ST02', employeeId: 'VP001', fromStoreId: 'OFFICE', toStoreId: 'S01' },
        { id: 'ST03', employeeId: 'E02', fromStoreId: 'S01', toStoreId: 'OFFICE' },
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
    expect(projection.notifications).toEqual([{ id: 'N01', employeeId: 'E01', readAt: null }])
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
    const managerProjection = projectSharedState(state, { role: 'manager', user_id: 'manager-1' })
    expect(managerProjection.orders).toEqual(state.orders)
    expect(managerProjection.employees.map(({ id }) => id)).toEqual(['E01', 'E02'])
    expect(managerProjection.supportTransfers.map(({ id }) => id)).toEqual(['ST01'])
    expect(managerProjection).not.toHaveProperty('officeAdjustments')
    expect(JSON.stringify(managerProjection)).not.toContain('VP001')
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
        items: [{ name: 'Áo', category: 'Áo', quantity: 1, weight: 1, price: 100_000 }],
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
    expect(readHydratedState(env.DB.database).importVouchers).toEqual([])

    const retry = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      ...command,
      expectedVersion: 2,
    }, {
      ...authorization,
      'idempotency-key': 'import-counter-race-2',
    }), env)
    expect(retry.status).toBe(201)
    expect(await retry.json()).toMatchObject({
      voucher: { code: expect.stringMatching(/-0001$/u) },
      counter: { value: 1 },
    })
  })

  it('hydrates, mutates, replaces, replays, and reloads state larger than two megabytes', async () => {
    const env = { DB: new MemoryD1(), BOOTSTRAP_TOKEN: 'bootstrap-large-state' }
    const largeOrders = Array.from({ length: 25_100 }, (_, index) => ({
      id: `legacy-order-${String(index).padStart(5, '0')}`,
      code: `S01-${String(index + 1).padStart(5, '0')}`,
      storeId: 'S01',
      amount: 10_000,
      paymentMethod: 'Tiền mặt',
      padding: `history-${index}-${'x'.repeat(40)}`,
    }))
    expect(Buffer.byteLength(JSON.stringify(largeOrders))).toBeGreaterThan(2 * 1024 * 1024)

    const bootstrap = await worker.fetch(jsonRequest('https://idosi.example/api/bootstrap', {
      username: 'admin',
      password: 'large-state-password',
      initialState: {
        schemaVersion: 2,
        stateVersion: 1,
        stores: [{ id: 'S01', short: 'S01', name: 'Cửa hàng 01' }],
        orders: largeOrders,
        notifications: [],
        employees: [],
        attendance: [],
      },
    }, { 'x-idosi-bootstrap-token': env.BOOTSTRAP_TOKEN }), env)
    expect(bootstrap.status).toBe(201)
    const compactState = env.DB.database.prepare(`
      SELECT value_json FROM app_state WHERE scope_key = 'global'
    `).get().value_json
    expect(Buffer.byteLength(compactState)).toBeLessThan(1_500_000)
    expect(JSON.parse(compactState)).not.toHaveProperty('orders')
    expect(env.DB.database.prepare(`
      SELECT COUNT(*) AS count FROM state_entities
      WHERE scope_key = 'global' AND collection_key = 'orders'
    `).get()).toEqual({ count: largeOrders.length })

    const login = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
      username: 'admin', password: 'large-state-password',
    }), env)
    const authorization = { authorization: `Bearer ${(await login.json()).token}` }
    env.DB.queryCount = 0
    const initialReload = await worker.fetch(new Request('https://idosi.example/api/state', { headers: authorization }), env)
    expect(initialReload.status).toBe(200)
    const initialReloadBody = await initialReload.json()
    expect(initialReloadBody.state.orders).toHaveLength(largeOrders.length)
    expect(initialReloadBody.state.orders.at(-1).id).toBe('legacy-order-25099')
    expect(env.DB.queryCount).toBeLessThan(25)

    const historicalRowBefore = env.DB.database.prepare(`
      SELECT entity_key, entity_order, value_json, updated_at
      FROM state_entities
      WHERE scope_key = 'global' AND collection_key = 'orders'
        AND json_extract(value_json, '$.id') = 'legacy-order-00000'
    `).get()
    const created = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'order.create',
      expectedVersion: 1,
      payload: {
        storeId: 'S01',
        customerName: 'Khách hàng mới',
        amount: 25_000,
        paymentMethod: 'Chuyển khoản',
      },
    }, { ...authorization, 'idempotency-key': 'large-state-order-create-0001' }), env)
    expect(created.status).toBe(201)
    expect(await created.json()).toMatchObject({ version: 2, order: { code: 'S01-25101' } })
    expect(env.DB.database.prepare(`
      SELECT entity_key, entity_order, value_json, updated_at
      FROM state_entities
      WHERE scope_key = 'global' AND collection_key = 'orders'
        AND json_extract(value_json, '$.id') = 'legacy-order-00000'
    `).get()).toEqual(historicalRowBefore)
    expect(env.DB.database.prepare(`
      SELECT COUNT(*) AS count FROM state_entities
      WHERE scope_key = 'global' AND collection_key = 'orders'
    `).get()).toEqual({ count: largeOrders.length + 1 })

    const replacementState = readHydratedState(env.DB.database)
    replacementState.largeStateMarker = 'persisted'
    const replaceCommand = {
      type: 'state.replace',
      expectedVersion: 2,
      payload: { state: replacementState },
    }
    const replaced = await worker.fetch(jsonRequest('https://idosi.example/api/command', replaceCommand, {
      ...authorization,
      'idempotency-key': 'large-state-replace-0001',
    }), env)
    expect(replaced.status).toBe(200)
    const replacedBody = await replaced.json()
    expect(replacedBody).toMatchObject({ version: 3, state: { largeStateMarker: 'persisted' } })
    expect(replacedBody.state.orders).toHaveLength(largeOrders.length + 1)
    const receiptMarker = JSON.parse(env.DB.database.prepare(`
      SELECT response_json FROM command_receipts
      WHERE idempotency_key = 'large-state-replace-0001'
    `).get().response_json)
    expect(receiptMarker).toMatchObject({ __idosiChunkedResponse: 1 })
    expect(env.DB.database.prepare(`
      SELECT COUNT(*) AS count FROM command_receipt_chunks
      WHERE idempotency_key = 'large-state-replace-0001'
    `).get().count).toBe(receiptMarker.chunkCount)

    const replayed = await worker.fetch(jsonRequest('https://idosi.example/api/command', replaceCommand, {
      ...authorization,
      'idempotency-key': 'large-state-replace-0001',
    }), env)
    expect(replayed.status).toBe(200)
    expect(replayed.headers.get('Idempotency-Replayed')).toBe('true')
    expect((await replayed.json()).state.orders).toHaveLength(largeOrders.length + 1)

    const finalReload = await worker.fetch(new Request('https://idosi.example/api/state', { headers: authorization }), env)
    const finalState = (await finalReload.json()).state
    expect(finalState.largeStateMarker).toBe('persisted')
    expect(finalState.orders).toHaveLength(largeOrders.length + 1)
    expect(finalState.orders[0].code).toBe('S01-25101')
    expect(env.DB.database.prepare('PRAGMA foreign_key_check').all()).toEqual([])
  }, 30_000)

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
    expect(initialBody.policies).toHaveLength(8)
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
    expect(employeeBootstrapBody.policies).toHaveLength(8)
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

  it('never reuses a deleted store code when creating the next store', async () => {
    const env = { DB: new MemoryD1(), BOOTSTRAP_TOKEN: 'bootstrap-store-code' }
    const bootstrap = await worker.fetch(jsonRequest('https://idosi.example/api/bootstrap', {
      username: 'admin', password: 'store-code-admin-password',
      initialState: {
        stores: [{ id: 'CH003', name: 'IDOSI Cửa hàng cũ', short: 'Cũ', status: 'Ngưng hoạt động' }],
        deletedStores: [{ id: 'CH002', name: 'IDOSI Cửa hàng đã xóa', deletedAt: '2026-08-01T00:00:00.000Z' }],
        employees: [], orders: [],
      },
    }, { 'x-idosi-bootstrap-token': env.BOOTSTRAP_TOKEN }), env)
    expect(bootstrap.status).toBe(201)
    const login = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
      username: 'admin', password: 'store-code-admin-password',
    }), env)
    const authorization = { authorization: `Bearer ${(await login.json()).token}` }

    const deleted = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'store.delete', expectedVersion: 1, payload: { storeId: 'CH003' },
    }, { ...authorization, 'idempotency-key': 'store-code-delete-0001' }), env)
    expect(deleted.status).toBe(200)
    expect(await deleted.json()).toMatchObject({ version: 2, store: { id: 'CH003' } })

    const retiredIdDenied = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'store.create', expectedVersion: 2, payload: { id: 'CH003', name: 'IDOSI Trùng mã' },
    }, { ...authorization, 'idempotency-key': 'store-code-retired-0001' }), env)
    expect(retiredIdDenied.status).toBe(409)
    expect(await retiredIdDenied.json()).toMatchObject({ error: { code: 'STORE_ID_RETIRED' } })

    const created = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'store.create', expectedVersion: 2, payload: { name: 'IDOSI Cửa hàng mới', short: 'Mới' },
    }, { ...authorization, 'idempotency-key': 'store-code-create-0001' }), env)
    expect(created.status).toBe(201)
    expect(await created.json()).toMatchObject({ version: 3, store: { id: 'CH004' } })
  })

  it('lets a manager operate stores while enforcing the explicit admin-only boundaries', async () => {
    const env = { DB: new MemoryD1(), BOOTSTRAP_TOKEN: 'bootstrap-manager-rbac' }
    const bootstrap = await worker.fetch(jsonRequest('https://idosi.example/api/bootstrap', {
      username: 'admin',
      password: 'manager-rbac-admin-password',
      initialState: {
        stores: [{ id: 'S01', name: 'IDOSI Tô Ngọc Vân', short: 'Tô Ngọc Vân', status: 'Đang hoạt động' }],
        employees: [
          { id: 'E01', code: 'E01', name: 'Nhân viên 01', phone: '0900000001', storeId: 'S01', employmentType: 'Full-Time', monthlySalary: 8_000_000 },
          { id: 'E02', code: 'E02', name: 'Nhân viên legacy nghỉ việc', phone: '0900000007', storeId: 'S01', employmentType: 'Full-Time', monthlySalary: 8_000_000, status: 'inactive' },
          { id: 'VP001', code: 'VP001', name: 'Nhân viên văn phòng', phone: '0900000002', storeId: 'OFFICE', unit: 'office' },
        ],
        orders: [{ id: 'O01', code: 'S01-00001', storeId: 'S01', customerName: 'Khách', amount: 100_000, paymentMethod: 'Tiền mặt' }],
        officeAdjustments: [{ id: 'OA01', employeeId: 'VP001', amount: 500_000 }],
        shiftDefinitions: [{ id: 'ca1', storeId: 'S01', name: 'Ca giao việc', date: '2026-08-14', start: '07:00', end: '12:00', active: true }],
        tasks: [],
      },
    }, { 'x-idosi-bootstrap-token': env.BOOTSTRAP_TOKEN }), env)
    expect(bootstrap.status).toBe(201)
    const adminLogin = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
      username: 'admin', password: 'manager-rbac-admin-password',
    }), env)
    const adminAuthorization = { authorization: `Bearer ${(await adminLogin.json()).token}` }
    const managerCreated = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'user.create',
      expectedVersion: 0,
      payload: {
        role: 'manager',
        username: 'manager',
        password: 'manager-rbac-password',
        displayName: 'Quản lý IDOSI',
      },
    }, { ...adminAuthorization, 'idempotency-key': 'manager-create-0001' }), env)
    expect(managerCreated.status).toBe(201)
    expect(await managerCreated.json()).toMatchObject({ user: { role: 'manager', storeId: null, employeeId: null } })

    const managerLogin = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
      username: 'manager', password: 'manager-rbac-password',
    }), env)
    expect(managerLogin.status).toBe(200)
    const managerAuthorization = { authorization: `Bearer ${(await managerLogin.json()).token}` }
    const managerBootstrap = await worker.fetch(new Request('https://idosi.example/api/bootstrap', {
      headers: managerAuthorization,
    }), env)
    const managerBootstrapBody = await managerBootstrap.json()
    expect(managerBootstrapBody).toMatchObject({ projection: 'manager', user: { role: 'manager' } })
    expect(managerBootstrapBody.state.employees.map(({ id }) => id)).toEqual(['E01', 'E02'])
    expect(managerBootstrapBody.state).not.toHaveProperty('officeAdjustments')

    const forbiddenCommands = [
      {
        key: 'manager-state-0001',
        body: { type: 'state.merge', expectedVersion: 1, payload: { patch: { stores: [] } } },
      },
      {
        key: 'manager-policy-0001',
        body: { type: 'policy.set', expectedVersion: 1, payload: { key: 'late_tolerance_minutes', value: 99 } },
      },
      {
        key: 'manager-order-edit-0001',
        body: { type: 'order.update', expectedVersion: 1, payload: { orderId: 'O01', amount: 200_000, reason: 'Không được phép' } },
      },
      {
        key: 'manager-order-create-0001',
        body: { type: 'order.create', expectedVersion: 1, payload: { storeId: 'S01', customerName: 'Khách', amount: 100_000, paymentMethod: 'Tiền mặt' } },
      },
      {
        key: 'manager-store-delete-0001',
        body: { type: 'store.delete', expectedVersion: 1, payload: { storeId: 'S01' } },
      },
      {
        key: 'manager-office-0001',
        body: {
          type: 'employee.create',
          expectedVersion: 1,
          payload: { storeId: 'OFFICE', name: 'Văn phòng', phone: '0900000003', employmentType: 'Chính thức', monthlySalary: 8_000_000 },
        },
      },
    ]
    for (const command of forbiddenCommands) {
      const response = await worker.fetch(jsonRequest('https://idosi.example/api/command', command.body, {
        ...managerAuthorization,
        'idempotency-key': command.key,
      }), env)
      expect(response.status, command.key).toBe(403)
    }
    const legacyInactiveReactivateDenied = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'employee.update', expectedVersion: 1,
      payload: { employeeId: 'E02', status: 'Đang làm việc' },
    }, { ...managerAuthorization, 'idempotency-key': 'manager-legacy-inactive-reactivate-0001' }), env)
    expect(legacyInactiveReactivateDenied.status).toBe(403)
    expect(await legacyInactiveReactivateDenied.json()).toMatchObject({ error: { code: 'EMPLOYEE_REACTIVATE_FORBIDDEN' } })
    const inactiveProfileAccountDenied = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'user.create',
      payload: {
        username: 'employee.inactive', password: 'employee-inactive-password', displayName: 'Nhân viên inactive',
        storeId: 'S01', employeeId: 'E02',
      },
    }, { ...managerAuthorization, 'idempotency-key': 'manager-inactive-profile-account-0001' }), env)
    expect(inactiveProfileAccountDenied.status).toBe(409)
    expect(await inactiveProfileAccountDenied.json()).toMatchObject({ error: { code: 'EMPLOYEE_INACTIVE' } })

    const storeUpdated = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'store.update',
      expectedVersion: 1,
      payload: { storeId: 'S01', status: 'Ngưng hoạt động', address: '123 Đường IDOSI' },
    }, { ...managerAuthorization, 'idempotency-key': 'manager-store-update-0001' }), env)
    expect(storeUpdated.status).toBe(200)
    expect(await storeUpdated.json()).toMatchObject({ version: 2, store: { status: 'Ngưng hoạt động' } })

    const invalidTaskShift = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'tasks.replace_scope',
      expectedVersion: 2,
      payload: { storeId: 'S01', date: '2026-08-14', shiftId: 'missing-shift', tasks: [] },
    }, { ...managerAuthorization, 'idempotency-key': 'manager-tasks-invalid-shift-0001' }), env)
    expect(invalidTaskShift.status).toBe(400)
    expect(await invalidTaskShift.json()).toMatchObject({ error: { code: 'SHIFT_INVALID' } })
    const mismatchedTaskDate = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'tasks.replace_scope',
      expectedVersion: 2,
      payload: { storeId: 'S01', date: '2026-08-15', shiftId: 'ca1', tasks: [] },
    }, { ...managerAuthorization, 'idempotency-key': 'manager-tasks-wrong-date-0001' }), env)
    expect(mismatchedTaskDate.status).toBe(400)
    expect(await mismatchedTaskDate.json()).toMatchObject({ error: { code: 'SHIFT_DATE_MISMATCH' } })

    const tasksSaved = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'tasks.replace_scope',
      expectedVersion: 2,
      payload: {
        storeId: 'S01', date: '2026-08-14', shiftId: 'ca1',
        tasks: [{ title: 'Mở cửa hàng', detail: 'Kiểm tra vệ sinh' }],
      },
    }, { ...managerAuthorization, 'idempotency-key': 'manager-tasks-0001' }), env)
    expect(tasksSaved.status).toBe(200)
    expect(await tasksSaved.json()).toMatchObject({ version: 3, tasks: [{ storeId: 'S01', shiftId: 'ca1' }] })

    const employeeCreated = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'employee.create',
      expectedVersion: 3,
      payload: {
        storeId: 'S01', name: 'Nhân viên mới', phone: '0900000004',
        employmentType: 'Part-Time', hourlyRate: 35_000,
        username: 'employee.new', password: 'employee-new-password',
      },
    }, { ...managerAuthorization, 'idempotency-key': 'manager-employee-0001' }), env)
    expect(employeeCreated.status).toBe(201)
    const employeeCreatedBody = await employeeCreated.json()
    expect(employeeCreatedBody).toMatchObject({
      version: 4,
      employee: { id: 'TNV-001', payBasis: 'hourly', hourlyRate: 35_000, status: 'Đang làm việc' },
      user: { role: 'employee', storeId: 'S01', employeeId: 'TNV-001', version: 1 },
    })

    const shiftCreated = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'shift_definition.create',
      expectedVersion: 4,
      payload: { storeId: 'S01', name: 'Ca sáng', date: '2026-08-14', start: '07:00', end: '12:30' },
    }, { ...managerAuthorization, 'idempotency-key': 'manager-shift-0001' }), env)
    expect(shiftCreated.status).toBe(201)
    const shiftCreatedBody = await shiftCreated.json()
    expect(shiftCreatedBody).toMatchObject({
      version: 5,
      shift: { start: '07:00', end: '12:30', durationMinutes: 330, color: expect.stringMatching(/^#/u) },
    })

    const scheduleSaved = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'schedule.assign',
      expectedVersion: 5,
      payload: {
        storeId: 'S01', date: '2026-08-14',
        employeeIds: ['E01', employeeCreatedBody.employee.id],
        shiftIds: [shiftCreatedBody.shift.id],
      },
    }, { ...managerAuthorization, 'idempotency-key': 'manager-schedule-0001' }), env)
    expect(scheduleSaved.status).toBe(200)
    expect(await scheduleSaved.json()).toMatchObject({ version: 6, assignments: [{ storeId: 'S01' }, { storeId: 'S01' }] })

    const employeeUpdated = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'employee.update',
      expectedVersion: 6,
      payload: { employeeId: employeeCreatedBody.employee.id, name: 'Nhân viên mới cập nhật' },
    }, { ...managerAuthorization, 'idempotency-key': 'manager-employee-update-0001' }), env)
    expect(employeeUpdated.status).toBe(200)
    const employeeUpdatedBody = await employeeUpdated.json()
    expect(employeeUpdatedBody).toMatchObject({
      version: 7,
      employee: { id: 'TNV-001', name: 'Nhân viên mới cập nhật', authVersion: 2 },
      user: { displayName: 'Nhân viên mới cập nhật', version: 2 },
    })
    const employeeLocked = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'employee.update',
      expectedVersion: 7,
      payload: { employeeId: 'TNV-001', status: 'Tạm ngưng' },
    }, { ...managerAuthorization, 'idempotency-key': 'manager-employee-lock-0001' }), env)
    expect(employeeLocked.status).toBe(200)
    expect(await employeeLocked.json()).toMatchObject({
      version: 8,
      employee: { status: 'Tạm ngưng', authVersion: 3 },
      user: { status: 'locked', version: 3 },
    })
    const lockedLogin = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
      username: 'employee.new', password: 'employee-new-password',
    }), env)
    expect(lockedLogin.status).toBe(403)
    const employeeReactivated = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'employee.update',
      expectedVersion: 8,
      payload: { employeeId: 'TNV-001', status: 'Đang làm việc' },
    }, { ...managerAuthorization, 'idempotency-key': 'manager-employee-active-0001' }), env)
    expect(employeeReactivated.status).toBe(200)
    const employeeReactivatedBody = await employeeReactivated.json()
    expect(employeeReactivatedBody).toMatchObject({
      version: 9,
      employee: { status: 'Đang làm việc', authVersion: 4 },
      user: { status: 'active', version: 4 },
    })
    const createdEmployeeLogin = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
      username: 'employee.new', password: 'employee-new-password',
    }), env)
    expect(createdEmployeeLogin.status).toBe(200)
    const createdEmployeeLoginBody = await createdEmployeeLogin.json()
    expect(createdEmployeeLoginBody).toMatchObject({
      user: { role: 'employee', employeeId: 'TNV-001', displayName: 'Nhân viên mới cập nhật' },
    })

    const users = await worker.fetch(new Request('https://idosi.example/api/users', { headers: managerAuthorization }), env)
    expect(users.status).toBe(200)
    const usersBody = await users.json()
    expect(usersBody.users.map(({ role }) => role)).toEqual(['employee'])
    expect(usersBody.users.map(({ employeeId }) => employeeId)).toEqual(expect.arrayContaining(['TNV-001']))

    const managerCannotDeactivate = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'user.set_status',
      expectedVersion: employeeReactivatedBody.user.version,
      payload: { userId: employeeReactivatedBody.user.id, status: 'inactive' },
    }, { ...managerAuthorization, 'idempotency-key': 'manager-user-delete-0001' }), env)
    expect(managerCannotDeactivate.status).toBe(403)
    expect(await managerCannotDeactivate.json()).toMatchObject({ error: { code: 'EMPLOYEE_DELETE_FORBIDDEN' } })

    const adminMarkedResigned = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'employee.update', expectedVersion: 9,
      payload: { employeeId: 'TNV-001', status: 'Đã nghỉ việc' },
    }, { ...adminAuthorization, 'idempotency-key': 'admin-employee-resigned-0001' }), env)
    expect(adminMarkedResigned.status).toBe(200)
    expect(await adminMarkedResigned.json()).toMatchObject({
      version: 10,
      employee: { status: 'Đã nghỉ việc' },
      user: { status: 'inactive', version: 5 },
    })
    const managerCannotReactivateProfile = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'employee.update', expectedVersion: 10,
      payload: { employeeId: 'TNV-001', status: 'Đang làm việc' },
    }, { ...managerAuthorization, 'idempotency-key': 'manager-employee-reactivate-denied-0001' }), env)
    expect(managerCannotReactivateProfile.status).toBe(403)
    expect(await managerCannotReactivateProfile.json()).toMatchObject({ error: { code: 'EMPLOYEE_REACTIVATE_FORBIDDEN' } })

    const employeeDeleted = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'employee.delete',
      expectedVersion: 10,
      payload: { employeeId: 'TNV-001' },
    }, { ...adminAuthorization, 'idempotency-key': 'admin-employee-delete-0001' }), env)
    expect(employeeDeleted.status).toBe(200)
    expect(await employeeDeleted.json()).toMatchObject({
      version: 11,
      employee: { id: 'TNV-001', status: 'Đã nghỉ việc' },
      user: { status: 'inactive', version: 6 },
    })
    const deletedSession = await worker.fetch(new Request('https://idosi.example/api/state', {
      headers: { authorization: `Bearer ${createdEmployeeLoginBody.token}` },
    }), env)
    expect(deletedSession.status).toBe(401)
    const deletedLogin = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
      username: 'employee.new', password: 'employee-new-password',
    }), env)
    expect(deletedLogin.status).toBe(403)
    expect(await deletedLogin.json()).toMatchObject({ error: { code: 'ACCOUNT_DISABLED' } })

    const managerCannotReactivateAccount = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'user.set_status', expectedVersion: 6,
      payload: { userId: employeeReactivatedBody.user.id, status: 'active' },
    }, { ...managerAuthorization, 'idempotency-key': 'manager-user-reactivate-denied-0001' }), env)
    expect(managerCannotReactivateAccount.status).toBe(403)
    expect(await managerCannotReactivateAccount.json()).toMatchObject({ error: { code: 'EMPLOYEE_REACTIVATE_FORBIDDEN' } })
    const retiredAccountDenied = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'user.create',
      payload: {
        username: 'employee.retired', password: 'employee-retired-password', displayName: 'Nhân viên đã xóa',
        storeId: 'S01', employeeId: 'TNV-001',
      },
    }, { ...managerAuthorization, 'idempotency-key': 'manager-retired-account-0001' }), env)
    expect(retiredAccountDenied.status).toBe(409)
    expect(await retiredAccountDenied.json()).toMatchObject({ error: { code: 'EMPLOYEE_ID_RETIRED' } })

    const retiredEmployeeIdDenied = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'employee.create', expectedVersion: 11,
      payload: {
        id: 'TNV-001', storeId: 'S01', name: 'Nhân viên trùng mã', phone: '0900000006',
        employmentType: 'Part-Time', hourlyRate: 36_000,
        username: 'employee.reused', password: 'employee-reused-password',
      },
    }, { ...managerAuthorization, 'idempotency-key': 'manager-employee-retired-id-0001' }), env)
    expect(retiredEmployeeIdDenied.status).toBe(409)
    expect(await retiredEmployeeIdDenied.json()).toMatchObject({ error: { code: 'EMPLOYEE_ID_RETIRED' } })

    const nextEmployeeCreated = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'employee.create', expectedVersion: 11,
      payload: {
        storeId: 'S01', name: 'Nhân viên kế tiếp', phone: '0900000005',
        employmentType: 'Part-Time', hourlyRate: 36_000,
        username: 'employee.next', password: 'employee-next-password',
      },
    }, { ...managerAuthorization, 'idempotency-key': 'manager-employee-next-0001' }), env)
    expect(nextEmployeeCreated.status).toBe(201)
    expect(await nextEmployeeCreated.json()).toMatchObject({
      version: 12,
      employee: { id: 'TNV-002' },
      user: { employeeId: 'TNV-002', status: 'active' },
    })
  })

  it('persists manager-safe transfers, store settings, account preferences, and admin demo reset', async () => {
    const env = { DB: new MemoryD1(), BOOTSTRAP_TOKEN: 'bootstrap-persistence-gaps' }
    const bootstrap = await worker.fetch(jsonRequest('https://idosi.example/api/bootstrap', {
      username: 'admin',
      password: 'persistence-admin-password',
      initialState: {
        schemaVersion: 2,
        stateVersion: 1,
        stores: [
          { id: 'S01', name: 'Cửa hàng 01', short: 'S01', status: 'Đang hoạt động' },
          { id: 'S02', name: 'Cửa hàng 02', short: 'S02', status: 'Đang hoạt động' },
        ],
        employees: [
          { id: 'E01', code: 'E01', name: 'Nhân viên 01', storeId: 'S01', unit: 'store' },
          { id: 'VP001', code: 'VP001', name: 'Nhân viên văn phòng', storeId: 'OFFICE', unit: 'office' },
        ],
        supportTransfers: [{
          id: 'ST-OFFICE', employeeId: 'VP001', fromStoreId: 'OFFICE', toStoreId: 'S01',
          fromDate: '2026-08-01', toDate: '2026-08-02', status: 'Đã duyệt',
        }],
        payrollPeriods: [{
          id: 'PAYROLL-LOCKED', storeId: 'S01', period: '2026-09', status: 'Đã khóa',
          lockedAt: '2026-09-30T00:00:00.000Z',
        }],
      },
    }, { 'x-idosi-bootstrap-token': env.BOOTSTRAP_TOKEN }), env)
    expect(bootstrap.status).toBe(201)

    const adminLogin = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
      username: 'admin', password: 'persistence-admin-password',
    }), env)
    const adminToken = (await adminLogin.json()).token
    const adminAuthorization = { authorization: `Bearer ${adminToken}` }
    const managerCreated = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'user.create',
      expectedVersion: 0,
      payload: {
        role: 'manager', username: 'manager.settings', password: 'persistence-manager-password', displayName: 'Quản lý cũ',
      },
    }, { ...adminAuthorization, 'idempotency-key': 'persistence-manager-create-0001' }), env)
    expect(managerCreated.status).toBe(201)
    const managerCreatedBody = await managerCreated.json()
    const managerLogin = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
      username: 'manager.settings', password: 'persistence-manager-password',
    }), env)
    const managerToken = (await managerLogin.json()).token
    const managerAuthorization = { authorization: `Bearer ${managerToken}` }

    const managerBootstrap = await worker.fetch(new Request('https://idosi.example/api/bootstrap', {
      headers: managerAuthorization,
    }), env)
    expect((await managerBootstrap.json()).state.supportTransfers).toEqual([])

    const lockedTransfer = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'support_transfer.create',
      expectedVersion: 1,
      payload: {
        employeeId: 'E01', toStoreId: 'S02', fromDate: '2026-09-01', toDate: '2026-09-02', note: 'Kỳ đã khóa',
      },
    }, { ...managerAuthorization, 'idempotency-key': 'support-transfer-locked-0001' }), env)
    expect(lockedTransfer.status).toBe(409)
    expect(await lockedTransfer.json()).toMatchObject({ error: { code: 'PAYROLL_PERIOD_LOCKED' } })

    const createTransferCommand = {
      type: 'support_transfer.create',
      expectedVersion: 1,
      payload: {
        employeeId: 'E01', toStoreId: 'S02', fromDate: '2026-08-15', toDate: '2026-08-17', note: 'Hỗ trợ khai trương',
      },
    }
    const transferCreated = await worker.fetch(jsonRequest('https://idosi.example/api/command', createTransferCommand, {
      ...managerAuthorization, 'idempotency-key': 'support-transfer-create-0001',
    }), env)
    expect(transferCreated.status).toBe(201)
    const transferCreatedBody = await transferCreated.json()
    expect(transferCreatedBody).toMatchObject({
      ok: true,
      version: 2,
      transfer: {
        employeeId: 'E01', fromStoreId: 'S01', toStoreId: 'S02',
        fromDate: '2026-08-15', toDate: '2026-08-17', status: 'Đã duyệt',
      },
    })
    const transferReplay = await worker.fetch(jsonRequest('https://idosi.example/api/command', createTransferCommand, {
      ...managerAuthorization, 'idempotency-key': 'support-transfer-create-0001',
    }), env)
    expect(transferReplay.status).toBe(201)
    expect(transferReplay.headers.get('idempotency-replayed')).toBe('true')
    expect(await transferReplay.json()).toEqual(transferCreatedBody)

    const transferId = transferCreatedBody.transfer.id
    const transferUpdated = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'support_transfer.update',
      expectedVersion: 2,
      payload: { transferId, toDate: '2026-08-18', note: 'Đã gia hạn', status: 'Hoàn tất' },
    }, { ...managerAuthorization, 'idempotency-key': 'support-transfer-update-0001' }), env)
    expect(transferUpdated.status).toBe(200)
    expect(await transferUpdated.json()).toMatchObject({
      version: 3, transfer: { id: transferId, toDate: '2026-08-18', note: 'Đã gia hạn', status: 'Hoàn tất' },
    })
    const transferDeleted = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'support_transfer.delete',
      expectedVersion: 3,
      payload: { transferId, reason: 'Điều chuyển đã kết thúc' },
    }, { ...managerAuthorization, 'idempotency-key': 'support-transfer-delete-0001' }), env)
    expect(transferDeleted.status).toBe(200)
    expect(await transferDeleted.json()).toMatchObject({
      version: 4, transfer: { id: transferId, status: 'Đã xóa', deleteReason: 'Điều chuyển đã kết thúc' },
    })

    const invalidStore = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'store.update', expectedVersion: 4, payload: { storeId: 'S01', phone: '1234' },
    }, { ...managerAuthorization, 'idempotency-key': 'store-settings-invalid-0001' }), env)
    expect(invalidStore.status).toBe(400)
    expect(await invalidStore.json()).toMatchObject({ error: { code: 'PHONE_INVALID' } })
    const storeUpdated = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'store.update',
      expectedVersion: 4,
      payload: {
        storeId: 'S01', phone: '0901234567', email: 'STORE01@IDOSI.VN', tax: '0312345678',
        opening: '07:30', closing: '22:45', address: '123 Đường IDOSI',
      },
    }, { ...managerAuthorization, 'idempotency-key': 'store-settings-update-0001' }), env)
    expect(storeUpdated.status).toBe(200)
    expect(await storeUpdated.json()).toMatchObject({
      version: 5,
      store: {
        phone: '0901234567', email: 'store01@idosi.vn', tax: '0312345678', taxCode: '0312345678',
        opening: '07:30', openingTime: '07:30', closing: '22:45', closingTime: '22:45', address: '123 Đường IDOSI',
      },
    })

    const oversizedAvatar = `data:image/png;base64,${'A'.repeat(128 * 1024)}`
    const avatarRejected = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'account_settings.update', expectedVersion: 5, payload: { avatar: oversizedAvatar },
    }, { ...managerAuthorization, 'idempotency-key': 'account-settings-avatar-0001' }), env)
    expect(avatarRejected.status).toBe(413)
    expect(await avatarRejected.json()).toMatchObject({ error: { code: 'AVATAR_TOO_LARGE' } })
    const settingsUpdated = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'account_settings.update',
      expectedVersion: 5,
      payload: {
        name: 'Quản lý IDOSI', email: 'manager@idosi.vn', phone: '0907654321', birthday: '1991-10-20',
        gender: 'Khác', address: 'TP. Hồ Chí Minh', bio: 'Quản lý vận hành cửa hàng.',
        notifications: { tasks: false, dailyReport: true, expenseAlert: true },
      },
    }, { ...managerAuthorization, 'idempotency-key': 'account-settings-update-0001' }), env)
    expect(settingsUpdated.status).toBe(200)
    expect(await settingsUpdated.json()).toMatchObject({
      version: 6,
      settings: {
        name: 'Quản lý IDOSI', email: 'manager@idosi.vn', phone: '0907654321', birthday: '1991-10-20',
        notifications: { tasks: false, dailyReport: true, expenseAlert: true },
      },
      user: { id: managerCreatedBody.user.id, displayName: 'Quản lý IDOSI', version: 2 },
    })

    const adminStateResponse = await worker.fetch(new Request('https://idosi.example/api/state', {
      headers: adminAuthorization,
    }), env)
    const adminProjectedState = (await adminStateResponse.json()).state
    expect(adminProjectedState).not.toHaveProperty('accountSettings')
    const genericReplace = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'state.replace', expectedVersion: 6, payload: { state: adminProjectedState },
    }, { ...adminAuthorization, 'idempotency-key': 'admin-generic-replace-0001' }), env)
    expect(genericReplace.status).toBe(200)
    const genericReplaceBody = await genericReplace.json()
    expect(genericReplaceBody).toMatchObject({ version: 7 })
    expect(genericReplaceBody.state).not.toHaveProperty('accountSettings')
    const managerAfterGenericReplace = await worker.fetch(new Request('https://idosi.example/api/bootstrap', {
      headers: managerAuthorization,
    }), env)
    expect(await managerAfterGenericReplace.json()).toMatchObject({
      state: {
        settings: {
          name: 'Quản lý IDOSI', email: 'manager@idosi.vn',
          notifications: { tasks: false, dailyReport: true, expenseAlert: true },
        },
      },
    })
    const rawSettingsMutation = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'state.merge', expectedVersion: 7, payload: { patch: { accountSettings: {} } },
    }, { ...adminAuthorization, 'idempotency-key': 'admin-raw-settings-0001' }), env)
    expect(rawSettingsMutation.status).toBe(400)
    expect(await rawSettingsMutation.json()).toMatchObject({ error: { code: 'DOMAIN_COMMAND_REQUIRED' } })

    const resetPayload = {
      state: {
        schemaVersion: 2,
        stateVersion: 1,
        stores: [{ id: 'D01', name: 'Cửa hàng mẫu', short: 'D01', status: 'Đang hoạt động' }],
        employees: [],
        activeStoreId: 'D01',
        supportTransfers: [],
        orders: [],
        adminAccounts: [{ username: 'attacker', password: 'must-be-removed' }],
        accountSettings: { [managerCreatedBody.user.id]: { name: 'Không được ghi đè' } },
      },
    }
    const managerResetDenied = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'system.reset_demo', expectedVersion: 7, payload: resetPayload,
    }, { ...managerAuthorization, 'idempotency-key': 'manager-reset-demo-0001' }), env)
    expect(managerResetDenied.status).toBe(403)
    expect(await managerResetDenied.json()).toMatchObject({ error: { code: 'ROLE_FORBIDDEN' } })

    const usersBeforeReset = env.DB.database.prepare(`
      SELECT id, username, display_name, role, status, version
      FROM users ORDER BY id
    `).all()
    const sessionsBeforeReset = env.DB.database.prepare(`
      SELECT id, token_hash, user_id, revoked_at
      FROM sessions ORDER BY id
    `).all()
    const resetResponse = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'system.reset_demo', expectedVersion: 7, payload: resetPayload,
    }, { ...adminAuthorization, 'idempotency-key': 'admin-reset-demo-0001' }), env)
    expect(resetResponse.status).toBe(200)
    const resetBody = await resetResponse.json()
    expect(resetBody).toMatchObject({
      ok: true, version: 8, state: { stores: [{ id: 'D01' }], employees: [], activeStoreId: 'D01' },
    })
    expect(resetBody.state).not.toHaveProperty('accountSettings')
    expect(env.DB.database.prepare(`
      SELECT id, username, display_name, role, status, version
      FROM users ORDER BY id
    `).all()).toEqual(usersBeforeReset)
    expect(env.DB.database.prepare(`
      SELECT id, token_hash, user_id, revoked_at
      FROM sessions ORDER BY id
    `).all()).toEqual(sessionsBeforeReset)

    const rawState = readHydratedState(env.DB.database)
    expect(rawState).not.toHaveProperty('adminAccounts')
    expect(JSON.stringify(rawState)).not.toContain('must-be-removed')
    expect(rawState.accountSettings[managerCreatedBody.user.id]).toMatchObject({
      name: 'Quản lý IDOSI', notifications: { tasks: false, dailyReport: true, expenseAlert: true },
    })
    const managerAfterReset = await worker.fetch(new Request('https://idosi.example/api/bootstrap', {
      headers: managerAuthorization,
    }), env)
    expect(managerAfterReset.status).toBe(200)
    expect(await managerAfterReset.json()).toMatchObject({
      user: { id: managerCreatedBody.user.id, displayName: 'Quản lý IDOSI' },
      state: {
        stores: [{ id: 'D01' }],
        settings: { name: 'Quản lý IDOSI', notifications: { tasks: false, dailyReport: true, expenseAlert: true } },
      },
    })
    expect(env.DB.database.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    expect(env.DB.database.prepare('SELECT action FROM audit_log ORDER BY id').all().map(({ action }) => action)).toEqual(expect.arrayContaining([
      'support_transfer.create',
      'support_transfer.update',
      'support_transfer.delete',
      'store.update',
      'account_settings.update',
      'system.reset_demo',
    ]))
  })

  it('snapshots assigned shifts and keeps schedule history immutable across shift changes', async () => {
    const env = { DB: new MemoryD1(), BOOTSTRAP_TOKEN: 'bootstrap-shift-snapshot' }
    const bootstrap = await worker.fetch(jsonRequest('https://idosi.example/api/bootstrap', {
      username: 'admin',
      password: 'shift-snapshot-admin-password',
      initialState: {
        stores: [{ id: 'S01', name: 'Cửa hàng 01', short: 'S01' }],
        employees: [{ id: 'E01', name: 'Nhân viên 01', storeId: 'S01' }],
        shiftDefinitions: [],
        schedule: [],
      },
    }, { 'x-idosi-bootstrap-token': env.BOOTSTRAP_TOKEN }), env)
    expect(bootstrap.status).toBe(201)
    const login = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
      username: 'admin', password: 'shift-snapshot-admin-password',
    }), env)
    const authorization = { authorization: `Bearer ${(await login.json()).token}` }

    const shiftCreated = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'shift_definition.create',
      expectedVersion: 1,
      payload: { storeId: 'S01', name: 'Ca sáng gốc', date: '2026-08-14', start: '07:00', end: '12:00' },
    }, { ...authorization, 'idempotency-key': 'snapshot-shift-create-0001' }), env)
    expect(shiftCreated.status).toBe(201)
    const shiftCreatedBody = await shiftCreated.json()
    expect(shiftCreatedBody).toMatchObject({
      version: 2,
      shift: { name: 'Ca sáng gốc', start: '07:00', end: '12:00', durationMinutes: 300, durationHours: 5, version: 1 },
    })
    const shiftId = shiftCreatedBody.shift.id

    const wrongDate = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'schedule.assign',
      expectedVersion: 2,
      payload: { storeId: 'S01', date: '2026-08-15', employeeIds: ['E01'], shiftIds: [shiftId] },
    }, { ...authorization, 'idempotency-key': 'snapshot-wrong-date-0001' }), env)
    expect(wrongDate.status).toBe(400)
    expect(await wrongDate.json()).toMatchObject({ error: { code: 'SHIFT_DATE_MISMATCH' } })

    const assigned = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'schedule.assign',
      expectedVersion: 2,
      payload: { storeId: 'S01', date: '2026-08-14', employeeIds: ['E01'], shiftIds: [shiftId] },
    }, { ...authorization, 'idempotency-key': 'snapshot-schedule-assign-0001' }), env)
    expect(assigned.status).toBe(200)
    const assignedBody = await assigned.json()
    const originalSnapshot = assignedBody.assignments[0].shiftSnapshots[0]
    expect(originalSnapshot).toEqual({
      id: shiftId,
      name: 'Ca sáng gốc',
      start: '07:00',
      end: '12:00',
      time: '07:00 - 12:00',
      color: shiftCreatedBody.shift.color,
      durationMinutes: 300,
      durationHours: 5,
      date: '2026-08-14',
      version: 1,
    })

    const shiftUpdated = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'shift_definition.update',
      expectedVersion: 3,
      payload: { shiftId, storeId: 'S01', name: 'Ca sáng đã đổi', start: '08:00', end: '13:30' },
    }, { ...authorization, 'idempotency-key': 'snapshot-shift-update-0001' }), env)
    expect(shiftUpdated.status).toBe(200)
    expect(await shiftUpdated.json()).toMatchObject({
      version: 4,
      shift: { id: shiftId, name: 'Ca sáng đã đổi', start: '08:00', end: '13:30', durationMinutes: 330, version: 2 },
    })

    const scheduleReplaced = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'schedule.replace_day',
      expectedVersion: 4,
      payload: {
        storeId: 'S01', date: '2026-08-14', assignments: [{ employeeId: 'E01', shiftIds: [shiftId], note: 'Giữ ca cũ' }],
      },
    }, { ...authorization, 'idempotency-key': 'snapshot-schedule-replace-0001' }), env)
    expect(scheduleReplaced.status).toBe(200)
    const scheduleReplacedBody = await scheduleReplaced.json()
    expect(scheduleReplacedBody.version).toBe(5)
    expect(scheduleReplacedBody.assignments[0].shiftSnapshots).toEqual([originalSnapshot])

    const shiftDeleted = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'shift_definition.delete', expectedVersion: 5, payload: { shiftId, storeId: 'S01' },
    }, { ...authorization, 'idempotency-key': 'snapshot-shift-delete-0001' }), env)
    expect(shiftDeleted.status).toBe(200)
    expect(await shiftDeleted.json()).toMatchObject({ version: 6, shift: { id: shiftId, active: false, deletedAt: expect.any(String) } })

    const finalStateResponse = await worker.fetch(new Request('https://idosi.example/api/state', { headers: authorization }), env)
    const finalState = (await finalStateResponse.json()).state
    expect(finalState.schedule[0]).toMatchObject({ employeeId: 'E01', shiftIds: [shiftId], note: 'Giữ ca cũ' })
    expect(finalState.schedule[0].shiftSnapshots).toEqual([originalSnapshot])
  })

  it('lets only admin edit attendance time with payroll and audit invariants', async () => {
    const env = { DB: new MemoryD1(), BOOTSTRAP_TOKEN: 'bootstrap-attendance-edit' }
    const bootstrap = await worker.fetch(jsonRequest('https://idosi.example/api/bootstrap', {
      username: 'admin',
      password: 'attendance-edit-admin-password',
      initialState: {
        stores: [{ id: 'S01', name: 'Cửa hàng 01', short: 'S01' }],
        employees: [{ id: 'E01', name: 'Nhân viên 01', storeId: 'S01' }],
        shiftDefinitions: [{ id: 'SHIFT-01', storeId: 'S01', name: 'Ca ngày', start: '08:00', end: '17:00', active: true }],
        attendance: [
          {
            id: 'ATT-AUG', employeeId: 'E01', storeId: 'S01', shiftId: 'SHIFT-01', shiftStart: '08:00', shiftEnd: '17:00',
            date: '2026-08-14', workDate: '2026-08-14', attendanceDate: '2026-08-14',
            checkIn: '08:20', checkInTime: '08:20', checkInAt: '2026-08-14T01:20:00.000Z',
            checkOut: '17:00', checkOutTime: '17:00', checkOutAt: '2026-08-14T10:00:00.000Z',
            arrivalTag: 'Đi trễ', status: 'Đi trễ', minutesLate: 20, workedSeconds: 31_200, hours: 26 / 3,
            revenue: 2_500_000, cash: 1_000_000, transfer: 1_500_000, orderCount: 3,
          },
          {
            id: 'ATT-SEP', employeeId: 'E01', storeId: 'S01', shiftId: 'SHIFT-01', shiftStart: '08:00', shiftEnd: '17:00',
            date: '2026-09-14', workDate: '2026-09-14', checkIn: '08:00', checkInAt: '2026-09-14T01:00:00.000Z',
            checkOut: '17:00', checkOutAt: '2026-09-14T10:00:00.000Z', workedSeconds: 32_400, hours: 9,
          },
        ],
        payrollPeriods: [
          { id: 'PAY-AUG', storeId: 'S01', period: '2026-08', status: 'Đã chốt', needsReclose: false },
          { id: 'PAY-SEP', storeId: 'S01', period: '2026-09', status: 'Đã chi', confirmedAt: '2026-09-30T00:00:00.000Z' },
        ],
      },
    }, { 'x-idosi-bootstrap-token': env.BOOTSTRAP_TOKEN }), env)
    expect(bootstrap.status).toBe(201)
    const adminLogin = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
      username: 'admin', password: 'attendance-edit-admin-password',
    }), env)
    const adminAuthorization = { authorization: `Bearer ${(await adminLogin.json()).token}` }
    const managerCreate = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'user.create', expectedVersion: 0,
      payload: { role: 'manager', username: 'attendance.manager', password: 'attendance-manager-password', displayName: 'Manager' },
    }, { ...adminAuthorization, 'idempotency-key': 'attendance-manager-create-0001' }), env)
    expect(managerCreate.status).toBe(201)
    const managerLogin = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
      username: 'attendance.manager', password: 'attendance-manager-password',
    }), env)
    const managerAuthorization = { authorization: `Bearer ${(await managerLogin.json()).token}` }

    const managerDenied = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'attendance.update', expectedVersion: 1,
      payload: { attendanceId: 'ATT-AUG', checkIn: '07:55', checkOut: '17:15', reason: 'Manager không được sửa' },
    }, { ...managerAuthorization, 'idempotency-key': 'attendance-manager-denied-0001' }), env)
    expect(managerDenied.status).toBe(403)
    expect(await managerDenied.json()).toMatchObject({ error: { code: 'ROLE_FORBIDDEN' } })

    const missingReason = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'attendance.update', expectedVersion: 1,
      payload: { attendanceId: 'ATT-AUG', checkIn: '07:55', checkOut: '17:15' },
    }, { ...adminAuthorization, 'idempotency-key': 'attendance-reason-required-0001' }), env)
    expect(missingReason.status).toBe(400)
    expect(await missingReason.json()).toMatchObject({ error: { code: 'REASON_REQUIRED' } })
    const immutableScope = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'attendance.update', expectedVersion: 1,
      payload: {
        attendanceId: 'ATT-AUG', employeeId: 'E02', checkIn: '07:55', checkOut: '17:15', reason: 'Không được đổi nhân viên',
      },
    }, { ...adminAuthorization, 'idempotency-key': 'attendance-scope-immutable-0001' }), env)
    expect(immutableScope.status).toBe(400)
    expect(await immutableScope.json()).toMatchObject({ error: { code: 'ATTENDANCE_SCOPE_IMMUTABLE' } })
    const invalidOrder = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'attendance.update', expectedVersion: 1,
      payload: { attendanceId: 'ATT-AUG', checkIn: '17:00', checkOut: '08:00', reason: 'Sai thứ tự giờ' },
    }, { ...adminAuthorization, 'idempotency-key': 'attendance-time-invalid-0001' }), env)
    expect(invalidOrder.status).toBe(400)
    expect(await invalidOrder.json()).toMatchObject({ error: { code: 'ATTENDANCE_TIME_ORDER_INVALID' } })

    const updated = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'attendance.update', expectedVersion: 1,
      payload: { attendanceId: 'ATT-AUG', date: '2026-08-14', checkIn: '07:55', checkOut: '17:15', reason: 'Đối soát máy chấm công' },
    }, { ...adminAuthorization, 'idempotency-key': 'attendance-update-success-0001' }), env)
    expect(updated.status).toBe(200)
    expect(await updated.json()).toMatchObject({
      version: 2,
      attendance: {
        id: 'ATT-AUG', employeeId: 'E01', storeId: 'S01', shiftId: 'SHIFT-01',
        date: '2026-08-14', checkIn: '07:55', checkInAt: '2026-08-14T00:55:00.000Z',
        checkOut: '17:15', checkOutAt: '2026-08-14T10:15:00.000Z',
        arrivalTag: 'Đi sớm', status: 'Đi sớm', minutesLate: 0,
        departureTag: 'Đã ra về', workedSeconds: 33_600, workedMinutes: 560, hours: 28 / 3,
        revenue: 2_500_000, cash: 1_000_000, transfer: 1_500_000, orderCount: 3,
        editReason: 'Đối soát máy chấm công',
      },
    })
    const stateAfterUpdate = readHydratedState(env.DB.database)
    expect(stateAfterUpdate.payrollPeriods.find(({ id }) => id === 'PAY-AUG')).toMatchObject({
      status: 'Đã chốt', needsReclose: true, invalidationReason: 'attendance.update',
    })

    const paidPeriodDenied = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'attendance.update', expectedVersion: 2,
      payload: { attendanceId: 'ATT-SEP', checkIn: '08:05', checkOut: '17:00', reason: 'Kỳ đã chi' },
    }, { ...adminAuthorization, 'idempotency-key': 'attendance-paid-denied-0001' }), env)
    expect(paidPeriodDenied.status).toBe(409)
    expect(await paidPeriodDenied.json()).toMatchObject({ error: { code: 'PAYROLL_PERIOD_PAID' } })
    expect(env.DB.database.prepare("SELECT version FROM app_state WHERE scope_key = 'global'").get()).toEqual({ version: 2 })
    const audit = env.DB.database.prepare("SELECT metadata_json FROM audit_log WHERE action = 'attendance.update'").get()
    expect(JSON.parse(audit.metadata_json)).toMatchObject({
      reason: 'Đối soát máy chấm công', storeId: 'S01', employeeId: 'E01',
    })
  })

  it('checks an Office employee in and out with server time, location, scoped history, and prorated payroll', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-08-14T00:55:00.000Z'))
      const env = { DB: new MemoryD1(), BOOTSTRAP_TOKEN: 'bootstrap-office-attendance' }
      const bootstrap = await worker.fetch(jsonRequest('https://idosi.example/api/bootstrap', {
        username: 'admin',
        password: 'office-attendance-admin-password',
        initialState: {
          employees: [{
            id: 'VP001', code: 'VP001', name: 'Nhân viên Văn phòng', phone: '0900000001',
            storeId: 'OFFICE', unit: 'office', isOffice: true, employmentType: 'Chính thức',
            payBasis: 'monthly', monthlySalary: 20_000_000, workStart: '08:00', workEnd: '17:00',
          }],
          attendance: [{
            id: 'ATT-OFFICE-HISTORY', employeeId: 'VP001', employeeName: 'Nhân viên Văn phòng',
            storeId: 'OFFICE', unit: 'office', attendanceMode: 'office', date: '2026-08-13',
            workDate: '2026-08-13', attendanceDate: '2026-08-13', shiftId: 'OFFICE_DEFAULT',
            shiftStart: '08:00', shiftEnd: '17:00', checkIn: '08:00', checkInAt: '2026-08-13T01:00:00.000Z',
            checkOut: '17:00', checkOutAt: '2026-08-13T10:00:00.000Z', workedSeconds: 32_400,
            workedMinutes: 540, hours: 9, workdayCredit: 1, arrivalTag: 'Đi đúng giờ', minutesEarly: 0, minutesLate: 0,
            requiredWorkingDaysSnapshot: 24, standardWorkDaysSnapshot: 24,
          }],
          officeAdjustments: [{
            id: 'DCH-OFFICE-HISTORY', employeeId: 'VP001', employeeName: 'Nhân viên Văn phòng',
            date: '2026-08-10', type: 'Phụ cấp', amount: 200_000, content: 'Phụ cấp dữ liệu cũ',
          }],
        },
      }, { 'x-idosi-bootstrap-token': env.BOOTSTRAP_TOKEN }), env)
      expect(bootstrap.status).toBe(201)
      const adminLogin = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
        username: 'admin', password: 'office-attendance-admin-password',
      }), env)
      const adminAuthorization = { authorization: `Bearer ${(await adminLogin.json()).token}` }

      const invalidWorkTime = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'employee.update', expectedVersion: 1,
        payload: { employeeId: 'VP001', workStart: '18:00', workEnd: '08:00' },
      }, { ...adminAuthorization, 'idempotency-key': 'office-work-time-invalid-0001' }), env)
      expect(invalidWorkTime.status).toBe(400)
      expect(await invalidWorkTime.json()).toMatchObject({ error: { code: 'OFFICE_WORK_TIME_INVALID' } })
      const invalidWorkdayPeriod = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'employee.update', expectedVersion: 1,
        payload: { employeeId: 'VP001', standardWorkDaysPeriod: '2026-13', standardWorkDays: 20 },
      }, { ...adminAuthorization, 'idempotency-key': 'office-work-period-invalid-0001' }), env)
      expect(invalidWorkdayPeriod.status).toBe(400)
      expect(await invalidWorkdayPeriod.json()).toMatchObject({ error: { code: 'OFFICE_WORK_DAYS_PERIOD_INVALID' } })

      const officeProfileUpdated = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'employee.update', expectedVersion: 1,
        payload: {
          employeeId: 'VP001', workStart: '08:00', workEnd: '17:00',
          standardWorkDaysPeriod: '2026-08', standardWorkDays: 20,
        },
      }, { ...adminAuthorization, 'idempotency-key': 'office-profile-update-0001' }), env)
      expect(officeProfileUpdated.status).toBe(200)
      expect(await officeProfileUpdated.json()).toMatchObject({
        version: 2,
        employee: {
          id: 'VP001', workStart: '08:00', workEnd: '17:00', standardWorkDays: 20,
          standardWorkDaysPeriod: '2026-08', monthlyWorkdayTargets: { '2026-08': 20 },
        },
      })

      const policiesUpdated = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'policies.set',
        payload: {
          updates: [
            { key: 'attendance_maintain_max_late_count', value: 1, expectedVersion: 1 },
            { key: 'attendance_improve_min_late_count', value: 2, expectedVersion: 1 },
            { key: 'attendance_improve_min_late_minutes', value: 15, expectedVersion: 1 },
          ],
        },
      }, { ...adminAuthorization, 'idempotency-key': 'office-policies-update-0001' }), env)
      expect(policiesUpdated.status).toBe(200)
      expect(await policiesUpdated.json()).toMatchObject({
        policies: [
          { key: 'attendance_maintain_max_late_count', value: 1, version: 2 },
          { key: 'attendance_improve_min_late_count', value: 2, version: 2 },
          { key: 'attendance_improve_min_late_minutes', value: 15, version: 2 },
        ],
      })

      const officeUserCreated = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'user.create',
        payload: {
          username: 'office.employee', password: 'office-employee-password', displayName: 'Nhân viên Văn phòng',
          storeId: 'OFFICE', employeeId: 'VP001',
        },
      }, { ...adminAuthorization, 'idempotency-key': 'office-user-create-0001' }), env)
      expect(officeUserCreated.status).toBe(201)
      const managerCreated = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'user.create',
        payload: { role: 'manager', username: 'office.manager', password: 'office-manager-password', displayName: 'Manager' },
      }, { ...adminAuthorization, 'idempotency-key': 'office-manager-create-0001' }), env)
      expect(managerCreated.status).toBe(201)
      const officeLogin = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
        username: 'office.employee', password: 'office-employee-password',
      }), env)
      const officeAuthorization = { authorization: `Bearer ${(await officeLogin.json()).token}` }
      const managerLogin = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
        username: 'office.manager', password: 'office-manager-password',
      }), env)
      const managerAuthorization = { authorization: `Bearer ${(await managerLogin.json()).token}` }

      const managerOfficeTakeoverDenied = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'employee.update', expectedVersion: 2,
        payload: {
          employeeId: 'VP001', storeId: 'S01', username: 'office.takeover', password: 'office-takeover-password',
        },
      }, { ...managerAuthorization, 'idempotency-key': 'office-manager-takeover-denied-0001' }), env)
      expect(managerOfficeTakeoverDenied.status).toBe(403)
      expect(await managerOfficeTakeoverDenied.json()).toMatchObject({ error: { code: 'OFFICE_FORBIDDEN' } })

      vi.setSystemTime(new Date('2026-08-14T01:15:00.000Z'))
      const missingLocation = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'attendance.check_in', expectedVersion: 2, payload: {},
      }, { ...officeAuthorization, 'idempotency-key': 'office-location-required-0001' }), env)
      expect(missingLocation.status).toBe(400)
      expect(await missingLocation.json()).toMatchObject({ error: { code: 'LOCATION_REQUIRED' } })

      const checkedIn = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'attendance.check_in', expectedVersion: 2,
        payload: { location: { latitude: 10.8231, longitude: 106.6297, accuracy: 12, label: 'Văn phòng IDOSI' } },
      }, { ...officeAuthorization, 'idempotency-key': 'office-attendance-in-0001' }), env)
      expect(checkedIn.status).toBe(201)
      const checkedInBody = await checkedIn.json()
      expect(checkedInBody).toMatchObject({
        version: 3,
        serverTime: '2026-08-14T01:15:00.000Z',
        attendance: {
          employeeId: 'VP001', storeId: 'OFFICE', attendanceMode: 'office', date: '2026-08-14',
          shiftId: 'OFFICE_DEFAULT', shiftName: 'Giờ làm Văn phòng', shiftStart: '08:00', shiftEnd: '17:00',
          shiftSource: 'office-profile', checkIn: '08:15', checkInAt: '2026-08-14T01:15:00.000Z',
          arrivalTag: 'Đi trễ', minutesEarly: 0, minutesLate: 15, requiredWorkingDaysSnapshot: 20,
          standardWorkDaysSnapshot: 20, workdayCredit: 0,
          checkInLocation: {
            latitude: 10.8231, longitude: 106.6297, accuracy: 12, label: 'Văn phòng IDOSI',
            capturedAt: '2026-08-14T01:15:00.000Z',
          },
        },
      })
      const attendanceId = checkedInBody.attendance.id

      vi.setSystemTime(new Date('2026-08-14T10:05:00.000Z'))
      const officeExpenseDenied = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'attendance.check_out', expectedVersion: 3,
        payload: {
          attendanceId, expense: 10_000,
          location: { latitude: 10.8232, longitude: 106.6298, accuracy: 10 },
        },
      }, { ...officeAuthorization, 'idempotency-key': 'office-expense-denied-0001' }), env)
      expect(officeExpenseDenied.status).toBe(400)
      expect(await officeExpenseDenied.json()).toMatchObject({ error: { code: 'OFFICE_CHECK_OUT_FIELDS_INVALID' } })
      const checkedOut = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'attendance.check_out', expectedVersion: 3,
        payload: {
          attendanceId,
          location: { latitude: 10.8232, longitude: 106.6298, accuracy: 10, label: 'Văn phòng IDOSI' },
        },
      }, { ...officeAuthorization, 'idempotency-key': 'office-attendance-out-0001' }), env)
      expect(checkedOut.status).toBe(200)
      expect(await checkedOut.json()).toMatchObject({
        version: 4,
        attendance: {
          id: attendanceId, checkOut: '17:05', checkOutAt: '2026-08-14T10:05:00.000Z',
          departureTag: 'Đã ra về', workedSeconds: 31_800, workdayCredit: 1,
          checkOutLocation: { capturedAt: '2026-08-14T10:05:00.000Z' },
        },
        expense: null,
      })

      vi.setSystemTime(new Date('2026-08-14T10:06:00.000Z'))
      const duplicateOfficeDay = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'attendance.check_in', expectedVersion: 4,
        payload: { location: { latitude: 10.8232, longitude: 106.6298, accuracy: 10 } },
      }, { ...officeAuthorization, 'idempotency-key': 'office-duplicate-day-0001' }), env)
      expect(duplicateOfficeDay.status).toBe(409)
      expect(await duplicateOfficeDay.json()).toMatchObject({ error: { code: 'OFFICE_ATTENDANCE_ALREADY_RECORDED' } })
      const officeAdjustment = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'salary_adjustment.create', expectedVersion: 4,
        payload: {
          employeeId: 'VP001', period: '2026-08', type: 'Thưởng khác', amount: 500_000,
          note: 'Thưởng chuyên cần',
        },
      }, { ...adminAuthorization, 'idempotency-key': 'office-salary-adjustment-0001' }), env)
      expect(officeAdjustment.status).toBe(201)
      expect(await officeAdjustment.json()).toMatchObject({
        version: 5,
        adjustment: { employeeId: 'VP001', storeId: 'OFFICE', period: '2026-08', amount: 500_000 },
      })
      const secondOfficeAdjustment = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'salary_adjustment.create', expectedVersion: 5,
        payload: {
          employeeId: 'VP001', period: '2026-08', type: 'Thưởng khác', amount: 500_000,
          note: 'Thưởng chuyên cần',
        },
      }, { ...adminAuthorization, 'idempotency-key': 'office-salary-adjustment-0002' }), env)
      expect(secondOfficeAdjustment.status).toBe(201)
      expect(await secondOfficeAdjustment.json()).toMatchObject({ version: 6 })
      const managerOfficePayrollDenied = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'payroll.close', expectedVersion: 6, payload: { storeId: 'OFFICE', period: '2026-08' },
      }, { ...managerAuthorization, 'idempotency-key': 'office-manager-payroll-denied-0001' }), env)
      expect(managerOfficePayrollDenied.status).toBe(403)
      expect(await managerOfficePayrollDenied.json()).toMatchObject({ error: { code: 'OFFICE_FORBIDDEN' } })

      const payrollClosed = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'payroll.close', expectedVersion: 6, payload: { storeId: 'OFFICE', period: '2026-08' },
      }, { ...adminAuthorization, 'idempotency-key': 'office-payroll-close-0001' }), env)
      expect(payrollClosed.status).toBe(201)
      expect(await payrollClosed.json()).toMatchObject({
        version: 7,
        period: {
          storeId: 'OFFICE', period: '2026-08',
          rows: [{
            employeeId: 'VP001', workedDays: 2, requiredWorkingDays: 20,
            baseSalary: 2_000_000, gross: 3_200_000, remaining: 3_200_000,
            salarySnapshot: { monthlySalary: 20_000_000, standardWorkDays: 20, proratedByWorkedDays: true },
          }],
        },
      })

      const officeState = await worker.fetch(new Request('https://idosi.example/api/state', { headers: officeAuthorization }), env)
      expect(officeState.status).toBe(200)
      const officeStateBody = await officeState.json()
      expect(officeStateBody).toMatchObject({
        projection: 'employee', version: 7,
        state: {
          employees: [{
            id: 'VP001', storeId: 'OFFICE', standardWorkDaysPeriod: '2026-08',
            monthlyWorkdayTargets: { '2026-08': 20 },
          }],
          attendance: [
            { id: attendanceId, employeeId: 'VP001', checkOut: '17:05', workdayCredit: 1 },
            { id: 'ATT-OFFICE-HISTORY', employeeId: 'VP001', workdayCredit: 1 },
          ],
          salaryAdjustments: [
            { employeeId: 'VP001', period: '2026-08', amount: 500_000 },
            { employeeId: 'VP001', period: '2026-08', amount: 500_000 },
          ],
          officeAdjustments: [{ id: 'DCH-OFFICE-HISTORY', employeeId: 'VP001', amount: 200_000 }],
          payrollPeriods: [{ storeId: 'OFFICE', rows: [{ employeeId: 'VP001', gross: 3_200_000 }] }],
          activeAttendanceId: null,
          finishedShift: true,
        },
      })
      expect(officeStateBody.policies).toEqual(expect.arrayContaining([
        expect.objectContaining({ key: 'attendance_improve_min_late_minutes', value: 15, version: 2 }),
      ]))

      const payrollProfileUpdated = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'employee.update', expectedVersion: 7,
        payload: {
          employeeId: 'VP001', salary: 21_000_000,
          standardWorkDaysPeriod: '2026-08', standardWorkDays: 18,
        },
      }, { ...adminAuthorization, 'idempotency-key': 'office-payroll-profile-update-0001' }), env)
      expect(payrollProfileUpdated.status).toBe(200)
      expect(await payrollProfileUpdated.json()).toMatchObject({ version: 8 })
      const dirtyPeriod = readHydratedState(env.DB.database)
        .payrollPeriods.find((item) => item.storeId === 'OFFICE' && item.period === '2026-08')
      expect(dirtyPeriod).toMatchObject({ needsReclose: true, invalidationReason: 'employee.update' })

      const dirtyOfficePay = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'payroll.pay', expectedVersion: 8, payload: { storeId: 'OFFICE', period: '2026-08' },
      }, { ...adminAuthorization, 'idempotency-key': 'office-payroll-pay-dirty-0001' }), env)
      expect(dirtyOfficePay.status).toBe(409)
      expect(await dirtyOfficePay.json()).toMatchObject({ error: { code: 'PAYROLL_NEEDS_RECLOSE' } })

      const officePayrollReclosed = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'payroll.close', expectedVersion: 8, payload: { storeId: 'OFFICE', period: '2026-08' },
      }, { ...adminAuthorization, 'idempotency-key': 'office-payroll-reclose-0001' }), env)
      expect(officePayrollReclosed.status).toBe(200)
      expect(await officePayrollReclosed.json()).toMatchObject({
        version: 9,
        period: { rows: [{ employeeId: 'VP001', requiredWorkingDays: 18, baseSalary: 2_333_333, gross: 3_533_333 }] },
      })
      const officePayrollPaid = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'payroll.pay', expectedVersion: 9, payload: { storeId: 'OFFICE', period: '2026-08' },
      }, { ...adminAuthorization, 'idempotency-key': 'office-payroll-pay-0001' }), env)
      expect(officePayrollPaid.status).toBe(200)
      expect(await officePayrollPaid.json()).toMatchObject({ version: 10 })
      const paidTargetChangeDenied = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'employee.update', expectedVersion: 10,
        payload: { employeeId: 'VP001', standardWorkDaysPeriod: '2026-08', standardWorkDays: 19 },
      }, { ...adminAuthorization, 'idempotency-key': 'office-paid-target-denied-0001' }), env)
      expect(paidTargetChangeDenied.status).toBe(409)
      expect(await paidTargetChangeDenied.json()).toMatchObject({ error: { code: 'PAYROLL_PERIOD_PAID' } })

      const managerState = await worker.fetch(new Request('https://idosi.example/api/state', { headers: managerAuthorization }), env)
      expect(managerState.status).toBe(200)
      const managerStateBody = await managerState.json()
      expect(managerStateBody.state.employees).toEqual([])
      expect(managerStateBody.state.attendance).toEqual([])
      expect(managerStateBody.state.payrollPeriods).toEqual([])
    } finally {
      vi.useRealTimers()
    }
  })

  it('marks notifications read atomically within employee, manager, and admin projections', async () => {
    const env = { DB: new MemoryD1(), BOOTSTRAP_TOKEN: 'bootstrap-notification-scope' }
    const bootstrap = await worker.fetch(jsonRequest('https://idosi.example/api/bootstrap', {
      username: 'admin',
      password: 'notification-admin-password',
      initialState: {
        stores: [
          { id: 'S01', name: 'Cửa hàng 01', short: 'S01' },
          { id: 'S02', name: 'Cửa hàng 02', short: 'S02' },
        ],
        employees: [
          { id: 'E01', name: 'Nhân viên 01', storeId: 'S01', unit: 'store' },
          { id: 'E02', name: 'Nhân viên 02', storeId: 'S02', unit: 'store' },
          { id: 'VP001', name: 'Nhân viên văn phòng', storeId: 'OFFICE', unit: 'office' },
        ],
        notifications: [
          { id: 'N-E01', employeeId: 'E01', storeId: 'S01', title: 'Thông báo E01', readAt: null },
          { id: 'N-STORE', storeId: 'S01', title: 'Thông báo cửa hàng', readAt: null },
          { id: 'N-READ', employeeId: 'E01', storeId: 'S01', title: 'Đã đọc', readAt: '2026-08-01T00:00:00.000Z' },
          { id: 'N-E02', employeeId: 'E02', storeId: 'S02', title: 'Thông báo E02', readAt: null },
          { id: 'N-OFFICE', employeeId: 'VP001', storeId: 'OFFICE', title: 'Thông báo văn phòng', readAt: null },
          { id: 'N-OFFICE-IDS', employeeIds: ['VP001'], title: 'Thông báo nhóm văn phòng', readAt: null },
          { id: 'N-OFFICE-ASSIGNEES', assignees: [{ id: 'VP001' }], title: 'Thông báo giao Văn phòng', readAt: null },
        ],
      },
    }, { 'x-idosi-bootstrap-token': env.BOOTSTRAP_TOKEN }), env)
    expect(bootstrap.status).toBe(201)
    const adminLogin = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
      username: 'admin', password: 'notification-admin-password',
    }), env)
    const adminAuthorization = { authorization: `Bearer ${(await adminLogin.json()).token}` }
    const employeeCreated = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'user.create',
      payload: {
        username: 'notification.employee', password: 'notification-employee-password', displayName: 'Nhân viên 01',
        storeId: 'S01', employeeId: 'E01',
      },
    }, { ...adminAuthorization, 'idempotency-key': 'notification-employee-create-0001' }), env)
    expect(employeeCreated.status).toBe(201)
    const managerCreated = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'user.create',
      payload: {
        role: 'manager', username: 'notification.manager', password: 'notification-manager-password', displayName: 'Manager',
      },
    }, { ...adminAuthorization, 'idempotency-key': 'notification-manager-create-0001' }), env)
    expect(managerCreated.status).toBe(201)
    const employeeLogin = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
      username: 'notification.employee', password: 'notification-employee-password',
    }), env)
    const employeeAuthorization = { authorization: `Bearer ${(await employeeLogin.json()).token}` }
    const managerLogin = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
      username: 'notification.manager', password: 'notification-manager-password',
    }), env)
    const managerAuthorization = { authorization: `Bearer ${(await managerLogin.json()).token}` }

    const employeeBootstrap = await worker.fetch(new Request('https://idosi.example/api/bootstrap', {
      headers: employeeAuthorization,
    }), env)
    expect((await employeeBootstrap.json()).state.notifications.map(({ id }) => id)).toEqual(['N-E01', 'N-STORE', 'N-READ'])
    const managerBootstrap = await worker.fetch(new Request('https://idosi.example/api/bootstrap', {
      headers: managerAuthorization,
    }), env)
    expect((await managerBootstrap.json()).state.notifications.map(({ id }) => id)).toEqual(['N-E01', 'N-STORE', 'N-READ', 'N-E02'])

    const managerOfficeAudienceDenied = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'notification.mark_read', expectedVersion: 1, payload: { notificationId: 'N-OFFICE-IDS' },
    }, { ...managerAuthorization, 'idempotency-key': 'notification-manager-office-audience-0001' }), env)
    expect(managerOfficeAudienceDenied.status).toBe(404)
    expect(await managerOfficeAudienceDenied.json()).toMatchObject({ error: { code: 'NOTIFICATION_NOT_FOUND' } })

    const otherEmployeeDenied = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'notification.mark_read', expectedVersion: 1, payload: { notificationId: 'N-E02' },
    }, { ...employeeAuthorization, 'idempotency-key': 'notification-other-denied-0001' }), env)
    expect(otherEmployeeDenied.status).toBe(404)
    expect(await otherEmployeeDenied.json()).toMatchObject({ error: { code: 'NOTIFICATION_NOT_FOUND' } })
    const marked = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'notification.mark_read', expectedVersion: 1, payload: { notificationId: 'N-E01' },
    }, { ...employeeAuthorization, 'idempotency-key': 'notification-mark-read-0001' }), env)
    expect(marked.status).toBe(200)
    const markedBody = await marked.json()
    expect(markedBody).toMatchObject({
      version: 2, updatedCount: 1,
      notification: { id: 'N-E01', readAt: expect.any(String) },
      notifications: [{ id: 'N-E01' }],
    })
    const markedReplay = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'notification.mark_read', expectedVersion: 1, payload: { notificationId: 'N-E01' },
    }, { ...employeeAuthorization, 'idempotency-key': 'notification-mark-read-0001' }), env)
    expect(markedReplay.headers.get('idempotency-replayed')).toBe('true')
    expect(await markedReplay.json()).toEqual(markedBody)

    const employeeStoreDenied = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'notification.mark_all_read', expectedVersion: 2, payload: { storeId: 'S02' },
    }, { ...employeeAuthorization, 'idempotency-key': 'notification-store-denied-0001' }), env)
    expect(employeeStoreDenied.status).toBe(403)
    const employeeMarkedAll = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'notification.mark_all_read', expectedVersion: 2, payload: {},
    }, { ...employeeAuthorization, 'idempotency-key': 'notification-employee-all-0001' }), env)
    expect(employeeMarkedAll.status).toBe(200)
    expect(await employeeMarkedAll.json()).toMatchObject({
      version: 3, storeId: 'S01', notificationIds: ['N-STORE'], notifications: [{ id: 'N-STORE' }], updatedCount: 1,
    })
    const employeeNoop = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'notification.mark_all_read', expectedVersion: 3, payload: {},
    }, { ...employeeAuthorization, 'idempotency-key': 'notification-employee-noop-0001' }), env)
    expect(employeeNoop.status).toBe(200)
    expect(await employeeNoop.json()).toMatchObject({ version: 3, notificationIds: [], updatedCount: 0, existing: true })

    const managerOfficeDenied = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'notification.mark_all_read', expectedVersion: 3, payload: { storeId: 'OFFICE' },
    }, { ...managerAuthorization, 'idempotency-key': 'notification-manager-office-0001' }), env)
    expect(managerOfficeDenied.status).toBe(403)
    const managerMarkedAll = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'notification.mark_all_read', expectedVersion: 3, payload: {},
    }, { ...managerAuthorization, 'idempotency-key': 'notification-manager-all-0001' }), env)
    expect(managerMarkedAll.status).toBe(200)
    expect(await managerMarkedAll.json()).toMatchObject({
      version: 4,
      storeId: null,
      notificationIds: ['N-E01', 'N-STORE', 'N-E02'],
      notifications: [{ id: 'N-E01' }, { id: 'N-STORE' }, { id: 'N-E02' }],
      updatedCount: 3,
    })
    const managerOfficeReadDenied = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'notification.mark_read', expectedVersion: 4, payload: { notificationId: 'N-OFFICE' },
    }, { ...managerAuthorization, 'idempotency-key': 'notification-manager-office-read-0001' }), env)
    expect(managerOfficeReadDenied.status).toBe(404)

    const adminClearedOffice = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'notification.clear', expectedVersion: 4, payload: { storeId: 'OFFICE' },
    }, { ...adminAuthorization, 'idempotency-key': 'notification-admin-clear-0001' }), env)
    expect(adminClearedOffice.status).toBe(200)
    expect(await adminClearedOffice.json()).toMatchObject({
      version: 5, command: 'notification.clear', storeId: 'OFFICE', notificationIds: ['N-OFFICE'], updatedCount: 1,
    })
    const adminProjectedForReplace = await worker.fetch(new Request('https://idosi.example/api/state', { headers: adminAuthorization }), env)
    const adminProjectedForReplaceBody = await adminProjectedForReplace.json()
    const adminReplace = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'state.replace', expectedVersion: 5, payload: { state: adminProjectedForReplaceBody.state },
    }, { ...adminAuthorization, 'idempotency-key': 'notification-admin-state-replace-0001' }), env)
    expect(adminReplace.status).toBe(200)
    expect(await adminReplace.json()).toMatchObject({ version: 6 })
    const finalState = readHydratedState(env.DB.database)
    const finalNotifications = Object.fromEntries(finalState.notifications.map((notification) => [notification.id, notification]))
    expect(finalState.notifications.filter(({ readAt }) => readAt).map(({ id }) => id)).toEqual(['N-READ'])
    expect(Object.keys(finalNotifications['N-E01'].readAtByUserId)).toHaveLength(2)
    expect(Object.keys(finalNotifications['N-STORE'].readAtByUserId)).toHaveLength(2)
    expect(Object.keys(finalNotifications['N-E02'].readAtByUserId)).toHaveLength(1)
    expect(Object.keys(finalNotifications['N-OFFICE'].readAtByUserId)).toHaveLength(1)

    const employeeFinal = await worker.fetch(new Request('https://idosi.example/api/state', { headers: employeeAuthorization }), env)
    const employeeFinalNotifications = Object.fromEntries((await employeeFinal.json()).state.notifications.map((notification) => [notification.id, notification]))
    expect(employeeFinalNotifications['N-E01'].readAt).toEqual(expect.any(String))
    expect(employeeFinalNotifications['N-STORE'].readAt).toEqual(expect.any(String))
    const adminFinal = await worker.fetch(new Request('https://idosi.example/api/state', { headers: adminAuthorization }), env)
    const adminFinalNotifications = Object.fromEntries((await adminFinal.json()).state.notifications.map((notification) => [notification.id, notification]))
    expect(adminFinalNotifications['N-E01'].readAt).toBeNull()
    expect(adminFinalNotifications['N-OFFICE'].readAt).toEqual(expect.any(String))
    expect(env.DB.database.prepare('SELECT action FROM audit_log WHERE action LIKE ? ORDER BY id',).all('notification.%')).toEqual([
      { action: 'notification.mark_read' },
      { action: 'notification.mark_all_read' },
      { action: 'notification.mark_all_read' },
      { action: 'notification.clear' },
    ])
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
        items: [{ name: 'Áo thun', category: 'Áo', quantity: 2, weight: 2, price: 100_000 }],
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
      voucher: { code: expect.stringMatching(/^PN-\d{2}\/\d{2}\/\d{2}-0006$/u), goodsAmount: 200_000, totalAmount: 210_000 },
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
        items: [{ name: 'Áo thun', category: 'Áo', quantity: 3, weight: 3, price: 100_000 }],
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

    const payrollState = readHydratedState(env.DB.database)
    const payrollIndex = payrollState.payrollPeriods.findIndex((item) => item.storeId === 'S01' && item.period === period)
    const cleanPayrollPeriods = structuredClone(payrollState.payrollPeriods)
    payrollState.payrollPeriods[payrollIndex].rows.push({ ...payrollState.payrollPeriods[payrollIndex].rows[0] })
    replaceStateCollection(env.DB.database, 'payrollPeriods', payrollState.payrollPeriods)
    const duplicatePayrollPay = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'payroll.pay',
      expectedVersion: 17,
      payload: { storeId: 'S01', period },
    }, { ...adminAuthorization, 'idempotency-key': 'payroll-pay-duplicate-row' }), env)
    expect(duplicatePayrollPay.status).toBe(409)
    expect(await duplicatePayrollPay.json()).toMatchObject({ error: { code: 'PAYROLL_ROW_DUPLICATE' } })
    replaceStateCollection(env.DB.database, 'payrollPeriods', cleanPayrollPeriods)

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
