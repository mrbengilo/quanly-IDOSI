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
  isSupportTransferActiveAt,
  projectSharedState,
  supportTransferTimeBounds,
  verifyPassword,
} from './worker'

const TEST_IDENTITY_IMAGE = `data:image/png;base64,${Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString('base64')}`
const testIdentityImages = () => ({ front: TEST_IDENTITY_IMAGE, back: TEST_IDENTITY_IMAGE })

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
      'drizzle/0004_operational_roles.sql',
      'drizzle/0005_admin_only_accounts.sql',
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

class MemoryR2 {
  constructor() {
    this.objects = new Map()
    this.deletedKeys = []
    this.pageSize = Number.POSITIVE_INFINITY
    this.failDeleteKeys = new Set()
    this.repeatCursor = false
  }

  async put(key, value, options = {}) {
    const bytes = value instanceof Uint8Array ? value.slice() : new Uint8Array(value)
    this.objects.set(key, {
      bytes,
      httpMetadata: options.httpMetadata || {},
      customMetadata: options.customMetadata || {},
    })
    return { key }
  }

  async get(key) {
    const stored = this.objects.get(key)
    if (!stored) return null
    return {
      body: stored.bytes.slice(),
      size: stored.bytes.byteLength,
      etag: `etag-${key}`,
      httpMetadata: stored.httpMetadata,
      customMetadata: stored.customMetadata,
    }
  }

  async list({ prefix = '', cursor = '' } = {}) {
    const start = Number(cursor || 0)
    const keys = [...this.objects.keys()].filter((key) => key.startsWith(prefix)).sort()
    const pageSize = Number.isFinite(this.pageSize) ? Math.max(1, this.pageSize) : keys.length || 1
    const objects = keys.slice(start, start + pageSize).map((key) => ({ key }))
    const truncated = start + pageSize < keys.length
    return {
      objects,
      truncated,
      ...(truncated ? { cursor: this.repeatCursor && cursor ? cursor : String(start + pageSize) } : {}),
    }
  }

  async delete(key) {
    if (this.failDeleteKeys.has(key)) throw new Error(`delete failed for ${key}`)
    this.deletedKeys.push(key)
    this.objects.delete(key)
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

const setupSupportTransferRuntime = async ({
  token,
  transfer,
  attendance = [],
  payrollPeriods = [],
  schedule = [],
  shiftDefinitions = [],
  orders = [],
  notifications = [],
} = {}) => {
  const env = { DB: new MemoryD1(), BOOTSTRAP_TOKEN: token }
  const bootstrap = await worker.fetch(jsonRequest('https://idosi.example/api/bootstrap', {
    username: 'admin', password: 'transfer-runtime-admin-password',
    initialState: {
      stores: [
        { id: 'S01', short: 'HOME', name: 'IDOSI Home', status: 'Đang hoạt động' },
        { id: 'S02', short: 'DEST', name: 'IDOSI Destination', status: 'Đang hoạt động' },
      ],
      employees: [{
        id: 'E01', name: 'Nhân viên hỗ trợ', storeId: 'S01', unit: 'store', status: 'Đang làm việc',
        employmentType: 'Part-Time', hourlyRate: 30_000,
      }, {
        id: 'QL02', name: 'Quản lý đích', storeId: 'S02', unit: 'store_manager', status: 'Đang làm việc',
      }, {
        id: 'HTKD-TRANSFER', name: 'Hỗ trợ vận hành', storeId: 'BUSINESS_SUPPORT',
        unit: 'business_support', status: 'Đang làm việc',
      }],
      supportTransfers: [transfer],
      attendance,
      payrollPeriods,
      schedule,
      shiftDefinitions,
      orders,
      notifications,
      tasks: [], taskAssignmentHistory: [], orderAudit: [], expenseEntries: [], fixedExpenses: [],
      cashTransactions: [], salaryAdjustments: [], salaryAdvances: [], payrollPayments: [],
    },
  }, { 'x-idosi-bootstrap-token': token }), env)
  expect(bootstrap.status).toBe(201)
  const adminLogin = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
    username: 'admin', password: 'transfer-runtime-admin-password',
  }), env)
  expect(adminLogin.status).toBe(200)
  const adminAuthorization = { authorization: `Bearer ${(await adminLogin.json()).token}` }
  const employeeUser = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
    type: 'user.create',
    payload: {
      username: 'transfer.employee', password: 'transfer-employee-password', displayName: 'Nhân viên hỗ trợ',
      role: 'employee', storeId: 'S01', employeeId: 'E01',
    },
  }, { ...adminAuthorization, 'idempotency-key': `transfer-runtime-user-${token}` }), env)
  expect(employeeUser.status).toBe(201)
  const managerUser = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
    type: 'user.create',
    payload: {
      username: 'transfer.manager', password: 'transfer-manager-password', displayName: 'Quản lý đích',
      role: 'store_manager', storeId: 'S02', employeeId: 'QL02',
    },
  }, { ...adminAuthorization, 'idempotency-key': `transfer-runtime-manager-${token}` }), env)
  expect(managerUser.status).toBe(201)
  const supportUser = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
    type: 'user.create',
    payload: {
      username: 'transfer.support', password: 'transfer-support-password', displayName: 'Hỗ trợ vận hành',
      role: 'business_support', storeId: 'BUSINESS_SUPPORT', employeeId: 'HTKD-TRANSFER',
    },
  }, { ...adminAuthorization, 'idempotency-key': `transfer-runtime-support-${token}` }), env)
  expect(supportUser.status).toBe(201)
  const employeeLogin = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
    username: 'transfer.employee', password: 'transfer-employee-password',
  }), env)
  expect(employeeLogin.status).toBe(200)
  const employeeAuthorization = { authorization: `Bearer ${(await employeeLogin.json()).token}` }
  const managerLogin = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
    username: 'transfer.manager', password: 'transfer-manager-password',
  }), env)
  expect(managerLogin.status).toBe(200)
  const managerAuthorization = { authorization: `Bearer ${(await managerLogin.json()).token}` }
  const supportLogin = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
    username: 'transfer.support', password: 'transfer-support-password',
  }), env)
  expect(supportLogin.status).toBe(200)
  const supportAuthorization = { authorization: `Bearer ${(await supportLogin.json()).token}` }
  return { env, adminAuthorization, employeeAuthorization, managerAuthorization, supportAuthorization }
}

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

  it('uses exact start-inclusive and end-exclusive support-transfer boundaries with legacy compatibility', () => {
    const exact = {
      status: 'Đã duyệt',
      startAt: '2026-08-20T07:00:00.000Z',
      endAt: '2026-08-20T14:00:00.000Z',
    }
    expect(supportTransferTimeBounds(exact)).toMatchObject({
      startAt: '2026-08-20T07:00:00.000Z',
      endAt: '2026-08-20T14:00:00.000Z',
    })
    expect(isSupportTransferActiveAt(exact, '2026-08-20T06:59:59.999Z')).toBe(false)
    expect(isSupportTransferActiveAt(exact, '2026-08-20T07:00:00.000Z')).toBe(true)
    expect(isSupportTransferActiveAt(exact, '2026-08-20T10:30:00.000Z')).toBe(true)
    expect(isSupportTransferActiveAt(exact, '2026-08-20T14:00:00.000Z')).toBe(false)
    expect(isSupportTransferActiveAt(exact, '2026-08-20T14:00:00.001Z')).toBe(false)

    const legacy = { status: 'Đã duyệt', fromDate: '2026-08-20', toDate: '2026-08-21' }
    expect(supportTransferTimeBounds(legacy)).toMatchObject({
      startAt: '2026-08-19T17:00:00.000Z',
      endAt: '2026-08-21T17:00:00.000Z',
    })
    expect(isSupportTransferActiveAt(legacy, '2026-08-21T16:59:59.999Z')).toBe(true)
    expect(isSupportTransferActiveAt(legacy, '2026-08-21T17:00:00.000Z')).toBe(false)
  })

  it('enforces the admin, business-support, store-manager, and employee scope model', () => {
    const admin = { role: 'admin', user_id: 'admin-1' }
    const manager = { role: 'business_support', user_id: 'manager-1' }
    const storeManager = { role: 'store_manager', user_id: 'store-manager-1', store_id: 'store-01' }
    const employee = { role: 'employee', user_id: 'user-1', employee_id: 'employee-01', store_id: 'store-01' }

    expect(canReadScope(admin, 'store:store-02')).toBe(true)
    expect(canWriteScope(admin, 'global')).toBe(true)
    expect(canReadScope(manager, 'global')).toBe(true)
    expect(canReadScope(manager, 'store:store-01')).toBe(false)
    expect(canReadScope(manager, 'employee:employee-01')).toBe(false)
    expect(canWriteScope(manager, 'global')).toBe(false)
    expect(canReadScope(storeManager, 'global')).toBe(true)
    expect(canReadScope(storeManager, 'store:store-01')).toBe(true)
    expect(canReadScope(storeManager, 'store:store-02')).toBe(false)
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

  it('purges non-admin credentials while preserving profiles, history, and atomic account reissue', async () => {
    const database = new DatabaseSync(':memory:')
    const adminPassword = await hashPassword('legacy-admin-password')
    const employeePassword = await hashPassword('legacy-employee-password')
    const managerPassword = await hashPassword('legacy-manager-password')
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
      UPDATE users
      SET password_hash = ?, password_salt = ?, password_iterations = ?, password_algorithm = ?
      WHERE id = 'admin-legacy'
    `).run(adminPassword.hash, adminPassword.salt, adminPassword.iterations, adminPassword.algorithm)
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
      UPDATE users
      SET password_hash = ?, password_salt = ?, password_iterations = ?, password_algorithm = ?
      WHERE id = 'employee-legacy'
    `).run(employeePassword.hash, employeePassword.salt, employeePassword.iterations, employeePassword.algorithm)
    database.prepare(`
      INSERT INTO sessions (id, token_hash, user_id, created_at, last_seen_at, expires_at)
      VALUES ('session-legacy', 'token-hash-legacy', 'admin-legacy',
        '2026-08-14T00:00:00.000Z', '2026-08-14T00:00:00.000Z', '2026-08-15T00:00:00.000Z')
    `).run()
    const legacyState = {
      stores: [{ id: 'S01', name: 'Legacy', short: 'S01' }, { id: 'S01', name: 'Duplicate', short: 'DUP' }],
      employees: [
        {
          id: 'E01', code: 'E01', name: 'Legacy employee', phone: '0900000001',
          storeId: 'S01', unit: 'store', employmentType: 'Full-Time', monthlySalary: 8_000_000,
          username: 'employee', authUserId: 'employee-legacy', authVersion: 4,
        },
        {
          id: 'HTKD777', code: 'HTKD777', name: 'Legacy support', phone: '0900000002',
          storeId: 'BUSINESS_SUPPORT', unit: 'business_support', employmentType: 'Chính thức',
          payBasis: 'monthly', monthlySalary: 12_000_000, workStart: '08:00', workEnd: '17:00',
          standardWorkDays: 26, startDate: '2026-01-01', status: 'Đang làm việc',
          username: 'manager', authUserId: 'manager-new', authVersion: 2,
        },
      ],
      attendance: [{
        id: 'ATT-LEGACY-SUPPORT', employeeId: 'HTKD777', storeId: 'BUSINESS_SUPPORT',
        date: '2026-08-01', checkInAt: '2026-08-01T01:00:00.000Z', checkOutAt: '2026-08-01T10:00:00.000Z',
        workedSeconds: 32_400,
      }],
      accountSettings: {
        'admin-legacy': { name: 'Admin preference', notifications: { tasks: true } },
        'manager-new': { name: 'Deleted manager preference', avatar: 'private-avatar-data' },
      },
      mixed: ['x', null, true, 7, { id: 'M1' }],
      empty: [],
      scalar: 'kept',
    }
    database.prepare(`
      INSERT INTO app_state (
        scope_key, value_json, version, updated_at, updated_by, last_request_id
      ) VALUES ('global', ?, 3, '2026-08-14T00:00:00.000Z', 'admin-legacy', 'state-request-legacy')
    `).run(JSON.stringify(legacyState))
    database.exec(`
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
      database.exec(`
        INSERT INTO users (
          id, username, username_normalized, display_name, password_hash, password_salt,
          password_iterations, password_algorithm, role, status, version,
          password_updated_at, created_at, updated_at
        ) VALUES ('manager-new', 'manager', 'manager', 'Manager Legacy', 'hash', 'salt',
          100000, 'PBKDF2-SHA256', 'manager', 'active', 2,
          '2026-08-14T00:00:00.000Z', '2026-08-14T00:00:00.000Z', '2026-08-14T00:00:00.000Z');
        INSERT INTO sessions (id, token_hash, user_id, created_at, last_seen_at, expires_at)
        VALUES ('session-manager', 'token-hash-manager', 'manager-new',
          '2026-08-14T00:00:00.000Z', '2026-08-14T00:00:00.000Z', '2026-08-15T00:00:00.000Z');
      `)
      database.prepare(`
        UPDATE users
        SET password_hash = ?, password_salt = ?, password_iterations = ?, password_algorithm = ?
        WHERE id = 'manager-new'
      `).run(managerPassword.hash, managerPassword.salt, managerPassword.iterations, managerPassword.algorithm)
      database.exec(readFileSync('drizzle/0002_attendance_evaluation_policies.sql', 'utf8').replaceAll('--> statement-breakpoint', ''))
      database.exec(readFileSync('drizzle/0003_state_entities.sql', 'utf8').replaceAll('--> statement-breakpoint', ''))
      database.exec(`
        INSERT INTO command_receipts (
          actor_id, idempotency_key, request_hash, response_json, status_code, created_at
        ) VALUES (
          'manager-new', 'manager-command-0001', 'manager-request-hash',
          '{"chunked":true,"chunkCount":1,"totalBytes":11}', 200, '2026-08-14T00:00:00.000Z'
        );
        INSERT INTO command_receipt_chunks (
          actor_id, idempotency_key, chunk_index, chunk_text, chunk_bytes, created_at
        ) VALUES (
          'manager-new', 'manager-command-0001', 0, '{"ok":true}', 11, '2026-08-14T00:00:00.000Z'
        );
        INSERT INTO audit_log (
          request_id, actor_id, actor_role, action, entity_type, entity_id,
          metadata_json, server_timestamp
        ) VALUES (
          'audit-request-manager', 'manager-new', 'manager', 'legacy.manager.action', 'state', 'global',
          '{"history":"preserved"}', '2026-08-14T00:00:00.000Z'
        );
      `)
      database.exec(readFileSync('drizzle/0004_operational_roles.sql', 'utf8').replaceAll('--> statement-breakpoint', ''))
      database.exec('COMMIT')
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }

    expect(database.prepare('SELECT id, role, version FROM users ORDER BY id').all()).toEqual([
      { id: 'admin-legacy', role: 'admin', version: 1 },
    ])
    expect(database.prepare('SELECT COUNT(*) AS count FROM sessions').get()).toEqual({ count: 1 })
    expect(database.prepare("SELECT id, token_hash, user_id FROM sessions WHERE id = 'session-legacy'").get()).toEqual({
      id: 'session-legacy', token_hash: 'token-hash-legacy', user_id: 'admin-legacy',
    })
    expect(database.prepare("SELECT id FROM sessions WHERE id = 'session-manager'").get()).toBeUndefined()
    expect(database.prepare('SELECT COUNT(*) AS count FROM command_receipts').get()).toEqual({ count: 1 })
    expect(database.prepare("SELECT actor_id, request_hash, response_json FROM command_receipts WHERE idempotency_key = 'legacy-command-0001'").get()).toEqual({
      actor_id: 'admin-legacy', request_hash: 'request-hash-legacy', response_json: '{"ok":true}',
    })
    expect(database.prepare('SELECT COUNT(*) AS count FROM command_receipt_chunks').get()).toEqual({ count: 0 })
    expect(database.prepare('SELECT COUNT(*) AS count FROM app_state').get()).toEqual({ count: 1 })
    const migratedAppState = database.prepare(
      "SELECT value_json, version, updated_by FROM app_state WHERE scope_key = 'global'",
    ).get()
    expect({ version: migratedAppState.version, updated_by: migratedAppState.updated_by }).toEqual({
      version: 4, updated_by: 'admin-legacy',
    })
    const compactState = JSON.parse(migratedAppState.value_json)
    expect(compactState.stores).toEqual(legacyState.stores)
    expect(compactState.attendance).toEqual(legacyState.attendance)
    expect(compactState.scalar).toBe('kept')
    expect(compactState.accountSettings).toEqual({
      'admin-legacy': { name: 'Admin preference', notifications: { tasks: true } },
    })
    expect(JSON.stringify(compactState)).not.toContain('private-avatar-data')
    expect(compactState.employees.map(({ id }) => id)).toEqual(['E01', 'HTKD777'])
    expect(JSON.stringify(compactState.employees)).not.toMatch(/username|authUserId|authVersion/u)
    expect(database.prepare('SELECT collection_key FROM state_collections ORDER BY collection_key').all()).toEqual([
      { collection_key: 'attendance' },
      { collection_key: 'employees' },
      { collection_key: 'empty' },
      { collection_key: 'mixed' },
      { collection_key: 'stores' },
    ])
    const migratedProfiles = database.prepare(`
      SELECT value_json, value_bytes FROM state_entities
      WHERE scope_key = 'global' AND collection_key = 'employees'
      ORDER BY entity_order
    `).all().map(({ value_json: valueJson, value_bytes: valueBytes }) => ({
      profile: JSON.parse(valueJson), valueJson, valueBytes,
    }))
    expect(migratedProfiles.map(({ profile }) => profile.id)).toEqual(['E01', 'HTKD777'])
    expect(JSON.stringify(migratedProfiles)).not.toMatch(/username|authUserId|authVersion/u)
    expect(migratedProfiles.every(({ valueJson, valueBytes }) => Buffer.byteLength(valueJson) === valueBytes)).toBe(true)
    expect(database.prepare(`
      SELECT json_extract(value_json, '$.id') AS id
      FROM state_entities
      WHERE scope_key = 'global' AND collection_key = 'attendance'
    `).all()).toEqual([{ id: 'ATT-LEGACY-SUPPORT' }])
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
    expect(database.prepare('SELECT COUNT(*) AS count FROM audit_log').get()).toEqual({ count: 2 })
    expect(database.prepare("SELECT request_id, actor_id, metadata_json FROM audit_log WHERE request_id = 'audit-request-legacy'").get()).toEqual({
      request_id: 'audit-request-legacy', actor_id: 'admin-legacy', metadata_json: '{"preserved":true}',
    })
    expect(database.prepare("SELECT request_id, actor_id, metadata_json FROM audit_log WHERE request_id = 'audit-request-manager'").get()).toEqual({
      request_id: 'audit-request-manager', actor_id: null, metadata_json: '{"history":"preserved"}',
    })
    expect(database.prepare('PRAGMA foreign_key_check').all()).toEqual([])

    const migratedD1 = new MemoryD1()
    migratedD1.database.close()
    migratedD1.database = database
    const env = { DB: migratedD1, IDENTITY_IMAGES: new MemoryR2() }
    const oldManagerLogin = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
      username: 'manager', password: 'legacy-manager-password',
    }), env)
    expect(oldManagerLogin.status).toBe(401)
    const oldEmployeeLogin = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
      username: 'employee', password: 'legacy-employee-password',
    }), env)
    expect(oldEmployeeLogin.status).toBe(401)
    const adminLogin = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
      username: 'admin', password: 'legacy-admin-password',
    }), env)
    expect(adminLogin.status).toBe(200)
    const adminAuthorization = { authorization: `Bearer ${(await adminLogin.json()).token}` }

    const supportReissued = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'employee.update', expectedVersion: 4,
      payload: {
        employeeId: 'HTKD777', username: 'support.reissued', password: 'support-reissued-password',
        cccd: '079123456789', address: 'TP.HCM', employmentType: 'Full-Time', position: 'NV hỗ trợ KD',
        identityImages: testIdentityImages(),
      },
    }, { ...adminAuthorization, 'idempotency-key': 'migration-support-reissue-0001' }), env)
    expect(supportReissued.status).toBe(200)
    expect(await supportReissued.json()).toMatchObject({
      version: 5,
      employee: { id: 'HTKD777', username: 'support.reissued', authUserId: expect.any(String), authVersion: 1 },
      user: {
        role: 'business_support', storeId: 'BUSINESS_SUPPORT', employeeId: 'HTKD777',
        username: 'support.reissued', status: 'active', version: 1,
      },
    })
    const reissuedLogin = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
      username: 'support.reissued', password: 'support-reissued-password',
    }), env)
    expect(reissuedLogin.status).toBe(200)
    const hydratedAfterReissue = readHydratedState(database)
    expect(hydratedAfterReissue.employees.map(({ id }) => id)).toEqual(['E01', 'HTKD777'])
    expect(hydratedAfterReissue.attendance).toEqual([expect.objectContaining({
      id: 'ATT-LEGACY-SUPPORT', employeeId: 'HTKD777',
    })])
    expect(database.prepare("SELECT role, employee_id FROM users WHERE username_normalized = 'support.reissued'").get()).toEqual({
      role: 'business_support', employee_id: 'HTKD777',
    })
    expect(database.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    database.close()
  })

  it('re-purges live non-admin accounts while preserving profiles and history', () => {
    const database = new DatabaseSync(':memory:')
    for (const file of [
      'drizzle/0000_idosi_core.sql',
      'drizzle/0001_manager_role.sql',
      'drizzle/0002_attendance_evaluation_policies.sql',
      'drizzle/0003_state_entities.sql',
      'drizzle/0004_operational_roles.sql',
    ]) {
      database.exec(readFileSync(file, 'utf8').replaceAll('--> statement-breakpoint', ''))
    }

    const timestamp = '2026-08-17T12:00:00.000Z'
    const insertUser = database.prepare(`
      INSERT INTO users (
        id, username, username_normalized, display_name, password_hash, password_salt,
        password_iterations, password_algorithm, role, status, version, store_id,
        employee_id, password_updated_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'hash', 'salt', 100000, 'PBKDF2-SHA256', ?, 'active', 1, ?, ?, ?, ?, ?)
    `)
    insertUser.run('admin-live', 'admin', 'admin', 'Admin', 'admin', null, null, timestamp, timestamp, timestamp)
    insertUser.run(
      'support-live', 'htkd-ben', 'htkd-ben', 'Hỗ trợ Bến', 'business_support',
      'BUSINESS_SUPPORT', 'HTKD-002', timestamp, timestamp, timestamp,
    )
    insertUser.run(
      'manager-live', 'clct-diemthuy', 'clct-diemthuy', 'Quản lý Diễm Thúy', 'store_manager',
      'CH001', 'QLCH-002', timestamp, timestamp, timestamp,
    )
    insertUser.run(
      'employee-live', 'employee-live', 'employee-live', 'Nhân viên', 'employee',
      'CH001', 'SM234-099', timestamp, timestamp, timestamp,
    )

    for (const [id, userId] of [
      ['SESSION-ADMIN', 'admin-live'],
      ['SESSION-SUPPORT', 'support-live'],
      ['SESSION-MANAGER', 'manager-live'],
      ['SESSION-EMPLOYEE', 'employee-live'],
    ]) {
      database.prepare(`
        INSERT INTO sessions (id, token_hash, user_id, created_at, last_seen_at, expires_at)
        VALUES (?, ?, ?, ?, ?, '2026-08-18T12:00:00.000Z')
      `).run(id, `hash-${id}`, userId, timestamp, timestamp)
    }
    for (const [actorId, key] of [
      ['admin-live', 'receipt-admin'],
      ['support-live', 'receipt-support'],
      ['manager-live', 'receipt-manager'],
    ]) {
      database.prepare(`
        INSERT INTO command_receipts (
          actor_id, idempotency_key, request_hash, response_json, status_code, created_at
        ) VALUES (?, ?, 'request-hash', '{"chunked":true,"chunkCount":1,"totalBytes":2}', 200, ?)
      `).run(actorId, key, timestamp)
      database.prepare(`
        INSERT INTO command_receipt_chunks (
          actor_id, idempotency_key, chunk_index, chunk_text, chunk_bytes, created_at
        ) VALUES (?, ?, 0, '{}', 2, ?)
      `).run(actorId, key, timestamp)
    }

    const liveProfiles = [{
      id: 'HTKD-002', name: 'Hỗ trợ Bến', phone: '0900000002', unit: 'business_support',
      username: 'htkd-ben', authUserId: 'support-live', authVersion: 1,
      password: 'plain', passwordHash: 'hash', passwordResetToken: 'reset',
    }, {
      id: 'QLCH-002', name: 'Quản lý Diễm Thúy', phone: '0900000003', unit: 'store_manager',
      Username: 'clct-diemthuy', auth_user_id: 'manager-live', auth_version: 1,
      passwordSalt: 'salt', password_hint: 'hint',
    }]
    const deletedProfiles = [{
      id: 'SM234-099', name: 'Nhân viên đã nghỉ', storeId: 'CH001', unit: 'store',
      username: 'employee-live', authUserId: 'employee-live', authVersion: 1,
      passwordLegacy: 'legacy',
    }]
    const compactState = {
      stateVersion: 12,
      employees: liveProfiles,
      deletedEmployees: deletedProfiles,
      attendance: [{ id: 'ATT-HISTORY', employeeId: 'HTKD-002', checkInAt: timestamp }],
      accountSettings: {
        'admin-live': { name: 'Admin preference' },
        'support-live': { name: 'Support private preference' },
        'manager-live': { name: 'Manager private preference' },
        orphan: { name: 'Orphan private preference' },
      },
    }
    database.prepare(`
      INSERT INTO app_state (
        scope_key, value_json, version, updated_at, updated_by, last_request_id
      ) VALUES ('global', ?, 12, ?, 'support-live', 'live-request')
    `).run(JSON.stringify(compactState), timestamp)
    replaceStateCollection(database, 'employees', liveProfiles)
    replaceStateCollection(database, 'deletedEmployees', deletedProfiles)
    replaceStateCollection(database, 'attendance', compactState.attendance)

    database.exec(`
      INSERT INTO policies (
        policy_key, value_json, version, effective_at, updated_at, updated_by, last_request_id
      ) VALUES
        ('live_support_policy', '1', 1, '${timestamp}', '${timestamp}', 'support-live', 'policy-support'),
        ('live_admin_policy', '2', 1, '${timestamp}', '${timestamp}', 'admin-live', 'policy-admin');
      INSERT INTO audit_log (
        request_id, actor_id, actor_role, action, entity_type, entity_id, server_timestamp
      ) VALUES
        ('audit-live-employee', 'employee-live', 'employee', 'history.employee', 'employee', 'SM234-099', '${timestamp}'),
        ('audit-live-admin', 'admin-live', 'admin', 'history.admin', 'state', 'global', '${timestamp}');
    `)

    database.exec('BEGIN IMMEDIATE')
    try {
      database.exec(readFileSync('drizzle/0005_admin_only_accounts.sql', 'utf8').replaceAll('--> statement-breakpoint', ''))
      database.exec('COMMIT')
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }

    expect(database.prepare('SELECT id, username, role FROM users ORDER BY id').all()).toEqual([
      { id: 'admin-live', username: 'admin', role: 'admin' },
    ])
    expect(database.prepare('SELECT id, user_id FROM sessions ORDER BY id').all()).toEqual([
      { id: 'SESSION-ADMIN', user_id: 'admin-live' },
    ])
    expect(database.prepare('SELECT actor_id, idempotency_key FROM command_receipts ORDER BY actor_id').all()).toEqual([
      { actor_id: 'admin-live', idempotency_key: 'receipt-admin' },
    ])
    expect(database.prepare('SELECT actor_id, idempotency_key FROM command_receipt_chunks ORDER BY actor_id').all()).toEqual([
      { actor_id: 'admin-live', idempotency_key: 'receipt-admin' },
    ])
    expect(database.prepare(`
      SELECT policy_key, updated_by FROM policies
      WHERE policy_key LIKE 'live_%' ORDER BY policy_key
    `).all()).toEqual([
      { policy_key: 'live_admin_policy', updated_by: 'admin-live' },
      { policy_key: 'live_support_policy', updated_by: null },
    ])
    expect(database.prepare(`
      SELECT request_id, actor_id FROM audit_log
      WHERE request_id LIKE 'audit-live-%' ORDER BY request_id
    `).all()).toEqual([
      { request_id: 'audit-live-admin', actor_id: 'admin-live' },
      { request_id: 'audit-live-employee', actor_id: null },
    ])

    const migratedCompactRow = database.prepare(`
      SELECT value_json, version, updated_by, last_request_id
      FROM app_state WHERE scope_key = 'global'
    `).get()
    expect({
      version: migratedCompactRow.version,
      updated_by: migratedCompactRow.updated_by,
      last_request_id: migratedCompactRow.last_request_id,
    }).toEqual({
      version: 13,
      updated_by: null,
      last_request_id: 'migration:0005:admin-only-accounts',
    })
    const migratedCompact = JSON.parse(migratedCompactRow.value_json)
    expect(migratedCompact.employees.map(({ id }) => id)).toEqual(['HTKD-002', 'QLCH-002'])
    expect(migratedCompact.deletedEmployees.map(({ id }) => id)).toEqual(['SM234-099'])
    expect(migratedCompact.attendance).toEqual(compactState.attendance)
    expect(migratedCompact.accountSettings).toEqual({ 'admin-live': { name: 'Admin preference' } })
    expect(JSON.stringify([migratedCompact.employees, migratedCompact.deletedEmployees]))
      .not.toMatch(/username|auth_?user_?id|auth_?version|password/iu)

    const migratedProfiles = database.prepare(`
      SELECT collection_key, value_json, value_bytes
      FROM state_entities
      WHERE scope_key = 'global' AND collection_key IN ('employees', 'deletedEmployees')
      ORDER BY collection_key, entity_order
    `).all()
    expect(migratedProfiles.map(({ collection_key: collectionKey, value_json: valueJson }) => ({
      collectionKey, id: JSON.parse(valueJson).id,
    }))).toEqual([
      { collectionKey: 'deletedEmployees', id: 'SM234-099' },
      { collectionKey: 'employees', id: 'HTKD-002' },
      { collectionKey: 'employees', id: 'QLCH-002' },
    ])
    expect(JSON.stringify(migratedProfiles.map(({ value_json: valueJson }) => JSON.parse(valueJson))))
      .not.toMatch(/username|auth_?user_?id|auth_?version|password/iu)
    expect(migratedProfiles.every(({ value_json: valueJson, value_bytes: valueBytes }) => (
      Buffer.byteLength(valueJson) === valueBytes
    ))).toBe(true)
    expect(database.prepare(`
      SELECT json_extract(value_json, '$.id') AS id
      FROM state_entities WHERE collection_key = 'attendance'
    `).all()).toEqual([{ id: 'ATT-HISTORY' }])
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
        { id: 'O01', employeeId: 'E01', createdByEmployeeId: 'E01', storeId: 'S01', shiftId: 'CA-SAME', attendanceId: 'A01' },
        { id: 'O02', employeeId: 'E02', createdByEmployeeId: 'E02', storeId: 'S01', shiftId: 'CA-SAME', attendanceId: 'A02' },
        {
          id: 'O03', employeeId: 'E02', createdByEmployeeId: 'E02', storeId: 'S01', shiftId: 'CA-SAME',
          updatedBy: { employeeId: 'E01' },
        },
        { id: 'O04', employeeId: 'E01', createdBy: { id: 'ADMIN-01', role: 'admin' }, storeId: 'S01', shiftId: 'CA-SAME' },
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
        {
          id: 'T-mixed', storeId: 'S01', employeeIds: ['E01', 'E02'],
          assignees: [{ id: 'E01', name: 'Own' }, { id: 'E02', name: 'Peer secret' }],
          participants: [{ id: 'E01' }, { id: 'E02' }], completedBy: { E01: true, E02: false },
        },
        {
          id: 'T-nested', storeId: 'S01', employeeId: 'E01',
          before: { employeeId: 'E02', salary: 99_000_001, name: 'Nested peer secret' },
        },
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
    expect(projection.orders).toEqual([{
      id: 'O01', employeeId: 'E01', createdByEmployeeId: 'E01', storeId: 'S01', shiftId: 'CA-SAME', attendanceId: 'A01',
    }])
    expect(projection.notifications).toEqual([{ id: 'N01', employeeId: 'E01', readAt: null }])
    expect(projection.tasks.map(({ id }) => id)).toEqual(['T-store', 'T-own', 'T-mixed', 'T-nested'])
    expect(projection.tasks[2]).toMatchObject({
      employeeIds: ['E01'], assignees: [{ id: 'E01', name: 'Own' }],
      participants: [{ id: 'E01' }], completedBy: { E01: true },
    })
    expect(projection.tasks.find(({ id }) => id === 'T-nested')).not.toHaveProperty('before')
    expect(JSON.stringify(projection.tasks)).not.toMatch(/E02|Peer secret|Nested peer secret|99000001/u)
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
    const managerProjection = projectSharedState(state, { role: 'business_support', user_id: 'manager-1' })
    expect(managerProjection.orders).toEqual(state.orders)
    expect(managerProjection.employees.map(({ id }) => id)).toEqual(['E01', 'E02', 'VP001'])
    expect(managerProjection.supportTransfers.map(({ id }) => id)).toEqual(['ST01', 'ST02', 'ST03'])
    expect(managerProjection.officeAdjustments).toEqual(state.officeAdjustments)
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

  it('gives business support the full safe Admin projection while keeping store managers scoped', () => {
    const state = {
      schemaVersion: 2,
      stateVersion: 9,
      stores: [{ id: 'S01', name: 'Store 01' }],
      employees: [
        { id: 'E01', storeId: 'S01', unit: 'store', name: 'Store employee' },
        { id: 'HTKD001', storeId: 'BUSINESS_SUPPORT', unit: 'business_support', name: 'Support one', salary: 10_000_000 },
        { id: 'HTKD002', storeId: 'BUSINESS_SUPPORT', unit: 'business_support', name: 'Support two', salary: 11_000_000 },
        { id: 'QL-S01-001', storeId: 'S01', unit: 'store_manager', name: 'Manager one', salary: 15_000_000 },
        { id: 'QL-S01-002', storeId: 'S01', unit: 'store_manager', name: 'Manager two', salary: 16_000_000 },
        { id: 'VP001', storeId: 'OFFICE', unit: 'office', name: 'Office employee', salary: 12_000_000 },
      ],
      attendance: [
        { id: 'A-E01', storeId: 'S01', employeeId: 'E01' },
        { id: 'A-S1', storeId: 'BUSINESS_SUPPORT', unit: 'business_support', employeeId: 'HTKD001' },
        { id: 'A-S2', storeId: 'BUSINESS_SUPPORT', unit: 'business_support', employeeId: 'HTKD002' },
        { id: 'A-M1', storeId: 'S01', unit: 'store_manager', employeeId: 'QL-S01-001' },
        { id: 'A-M2', storeId: 'S01', unit: 'store_manager', employeeId: 'QL-S01-002' },
        { id: 'A-VP', storeId: 'OFFICE', unit: 'office', employeeId: 'VP001' },
        { id: 'A-E-DELETED', storeId: 'S01', employeeId: 'E-DELETED' },
        { id: 'A-M-DELETED', storeId: 'S01', unit: 'store_manager', employeeId: 'QL-S01-002' },
      ],
      schedule: [
        { id: 'SCH-E', storeId: 'S01', employeeId: 'E01' },
        { id: 'SCH-E-DELETED', storeId: 'S01', employeeId: 'E-DELETED' },
        { id: 'SCH-M1', storeId: 'S01', employeeId: 'QL-S01-001' },
        { id: 'SCH-MIX', storeId: 'S01', employeeIds: ['E01', 'QL-S01-002'] },
      ],
      tasks: [
        { id: 'TASK-STORE', storeId: 'S01', title: 'Store-wide task' },
        { id: 'TASK-E', storeId: 'S01', participants: [{ id: 'E01' }] },
        { id: 'TASK-MIX', storeId: 'S01', employeeIds: ['E01', 'QL-S01-002'] },
        { id: 'TASK-NESTED', storeId: 'S01', before: { employeeId: 'HTKD002', salary: 11_000_000 } },
      ],
      salaryAdjustments: [
        { id: 'ADJ-E', storeId: 'S01', employeeId: 'E01', amount: 100_000 },
        { id: 'ADJ-M1', storeId: 'S01', employeeId: 'QL-S01-001', amount: 900_000 },
      ],
      salaryAdvances: [
        { id: 'ADV-E', storeId: 'S01', employeeId: 'E01', amount: 100_000 },
        { id: 'ADV-M1', storeId: 'S01', employeeId: 'QL-S01-001', amount: 900_000 },
      ],
      payrollPayments: [
        { id: 'PAY-E', storeId: 'S01', employeeId: 'E01', amount: 8_000_000 },
        { id: 'PAY-M1', storeId: 'S01', employeeId: 'QL-S01-001', amount: 15_000_000 },
      ],
      expenseEntries: [
        { id: 'EXP-E', storeId: 'S01', employeeId: 'E01', amount: 50_000 },
        { id: 'EXP-E-DELETED', storeId: 'S01', employeeId: 'E-DELETED', amount: 70_000 },
        { id: 'EXP-M-DELETED', storeId: 'S01', employeeId: 'QL-S01-002', amount: 98_000_000 },
        { id: 'EXP-NESTED', storeId: 'S01', after: { employeeId: 'HTKD002', amount: 99_000_000 } },
      ],
      orders: [
        { id: 'O-E', storeId: 'S01', employeeId: 'E01', total: 100_000 },
        { id: 'O-E-DELETED', storeId: 'S01', employeeId: 'E-DELETED', total: 200_000 },
        { id: 'O-M-DELETED', storeId: 'S01', employeeId: 'QL-S01-002', total: 97_000_000 },
      ],
      orderAudit: [{ id: 'OA-SECRET', storeId: 'S01', before: { customerName: 'Private customer' } }],
      auditLogs: [{ id: 'AL-SECRET', storeId: 'S01', metadata: { customerName: 'Private audit' } }],
      payrollPeriods: [
        {
          id: 'P-S01', storeId: 'S01', period: '2026-08', rows: [
            { employeeId: 'E01', gross: 8_000_000, hours: 10, kpiBonus: 1_000_000 },
            { employeeId: 'E-DELETED', gross: 7_000_000, hours: 7, kpiBonus: 700_000 },
            { employeeId: 'QL-S01-001', gross: 15_000_000, hours: 8, kpiBonus: 800_000 },
            { employeeId: 'QL-S01-002', gross: 16_000_000, hours: 12, kpiBonus: 1_200_000 },
          ],
          financeSnapshot: { profit: 9_000_000 },
          kpiSnapshot: {
            eligible: true, profit: 9_000_000, totalHours: 30, profitPerHour: 300_000,
            employeeTier: { ratePercent: 5 }, totalBonus: 3_000_000,
            results: [
              { id: 'E01', role: 'employee', hours: 10, ratePercent: 5, amount: 1_000_000 },
              { id: 'E-DELETED', role: 'employee', hours: 7, ratePercent: 5, amount: 700_000 },
              { id: 'QL-S01-001', role: 'store_manager', hours: 8, ratePercent: 5, amount: 800_000 },
              { id: 'QL-S01-002', role: 'store_manager', hours: 12, ratePercent: 5, amount: 1_200_000 },
            ],
          },
        },
        {
          id: 'P-SUPPORT', storeId: 'BUSINESS_SUPPORT', period: '2026-08', rows: [
            { employeeId: 'HTKD001', gross: 10_000_000 },
            { employeeId: 'HTKD002', gross: 11_000_000 },
          ],
          kpiSnapshot: {
            eligible: true, profit: 2_000_000, totalHours: 20, profitPerHour: 100_000,
            employeeTier: { ratePercent: 5 }, totalBonus: 1_000_000,
            results: [
              { id: 'HTKD001', role: 'business_support', hours: 9, ratePercent: 5, amount: 450_000 },
              { id: 'HTKD002', role: 'business_support', hours: 11, ratePercent: 5, amount: 550_000 },
            ],
          },
        },
      ],
      deletedEmployees: [
        { id: 'E-DELETED', code: 'E-DELETED', storeId: 'S01', unit: 'store', name: 'Former store employee' },
        { id: 'QL-S01-002', code: 'QL-S01-002', storeId: 'S01', unit: 'store_manager', name: 'Former peer manager' },
      ],
      notifications: [
        { id: 'N-E01', storeId: 'S01', employeeId: 'E01' },
        { id: 'N-S1', storeId: 'BUSINESS_SUPPORT', employeeId: 'HTKD001' },
        { id: 'N-S2', storeId: 'BUSINESS_SUPPORT', employeeId: 'HTKD002' },
        { id: 'N-M1', storeId: 'S01', employeeId: 'QL-S01-001' },
        { id: 'N-M2', storeId: 'S01', employeeId: 'QL-S01-002' },
      ],
      accountSettings: {
        'U-S1': { name: 'Support one settings' },
        'U-S2': { name: 'Private peer settings', bio: 'must-not-leak' },
      },
    }

    const supportProjection = projectSharedState(state, {
      role: 'business_support', user_id: 'U-S1', employee_id: 'HTKD001', store_id: 'BUSINESS_SUPPORT',
    })
    expect(supportProjection.employees).toEqual(state.employees)
    expect(supportProjection.attendance).toEqual(state.attendance)
    expect(supportProjection.notifications.map(({ id }) => id)).toEqual(state.notifications.map(({ id }) => id))
    expect(supportProjection.schedule).toEqual(state.schedule)
    expect(supportProjection.tasks).toEqual(state.tasks)
    expect(supportProjection.orders).toEqual(state.orders)
    expect(supportProjection.expenseEntries).toEqual(state.expenseEntries)
    expect(supportProjection.orderAudit).toEqual(state.orderAudit)
    expect(supportProjection.auditLogs).toEqual(state.auditLogs)
    expect(supportProjection.payrollPeriods).toEqual(state.payrollPeriods)
    expect(supportProjection).not.toHaveProperty('accountSettings')
    expect(supportProjection.settings.name).toBe('Support one settings')
    expect(JSON.stringify(supportProjection)).not.toContain('must-not-leak')

    const managerProjection = projectSharedState(state, {
      role: 'store_manager', user_id: 'U-M1', employee_id: 'QL-S01-001', store_id: 'S01',
    })
    expect(managerProjection.employees.map(({ id }) => id)).toEqual(['E01', 'QL-S01-001'])
    expect(managerProjection.attendance.map(({ id }) => id)).toEqual(['A-E01', 'A-M1', 'A-E-DELETED'])
    expect(managerProjection.notifications.map(({ id }) => id)).toEqual(['N-E01', 'N-M1'])
    expect(managerProjection.schedule.map(({ id }) => id)).toEqual(['SCH-E'])
    expect(managerProjection.tasks.map(({ id }) => id)).toEqual(['TASK-STORE', 'TASK-E'])
    expect(managerProjection.salaryAdjustments.map(({ id }) => id)).toEqual(['ADJ-E'])
    expect(managerProjection.salaryAdvances.map(({ id }) => id)).toEqual(['ADV-E'])
    expect(managerProjection.payrollPayments.map(({ id }) => id)).toEqual(['PAY-E'])
    expect(managerProjection.orders.map(({ id }) => id)).toEqual(['O-E', 'O-E-DELETED'])
    expect(managerProjection.expenseEntries.map(({ id }) => id)).toEqual(['EXP-E', 'EXP-E-DELETED'])
    expect(managerProjection).not.toHaveProperty('orderAudit')
    expect(managerProjection).not.toHaveProperty('auditLogs')
    expect(managerProjection.payrollPeriods[0].rows).toEqual([
      { employeeId: 'E01', gross: 8_000_000, hours: 10, kpiBonus: 1_000_000 },
    ])
    expect(managerProjection.payrollPeriods[0].kpiSnapshot).toMatchObject({
      totalHours: 10, profitPerHour: 900_000, totalBonus: 1_000_000,
      results: [{ id: 'E01', role: 'employee', hours: 10, ratePercent: 5, amount: 1_000_000 }],
    })
    expect(managerProjection.deletedEmployees.map(({ id }) => id)).toEqual(['E-DELETED'])
    expect(JSON.stringify(managerProjection)).not.toMatch(/HTKD001|HTKD002|QL-S01-002|VP001/u)
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
        gender: 'Nữ',
        occupation: 'Kinh doanh',
        acquisitionChannel: 'Facebook',
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
        gender: 'Nam',
        occupation: 'Kỹ sư',
        acquisitionChannel: 'Tiktok',
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
        createdByEmployeeId: 'NV001',
        createdBy: { role: 'employee', employeeId: 'NV001' },
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
        cashRevenue: 0,
        transferRevenue: 1_250_000,
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

  it('stores CCCD images in private R2 and authorizes retrieval without persisting image bytes', async () => {
    const bucket = new MemoryR2()
    const env = { DB: new MemoryD1(), IDENTITY_IMAGES: bucket, BOOTSTRAP_TOKEN: 'bootstrap-identity-images' }
    const bootstrap = await worker.fetch(jsonRequest('https://idosi.example/api/bootstrap', {
      username: 'admin',
      password: 'identity-images-admin-password',
      initialState: {
        stores: [{ id: 'S01', name: 'IDOSI Tô Ngọc Vân', short: 'TNV' }],
        employees: [], attendance: [],
      },
    }, { 'x-idosi-bootstrap-token': env.BOOTSTRAP_TOKEN }), env)
    expect(bootstrap.status).toBe(201)
    const adminLogin = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
      username: 'admin', password: 'identity-images-admin-password',
    }), env)
    const adminAuthorization = { authorization: `Bearer ${(await adminLogin.json()).token}` }
    const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    const pngDataUrl = `data:image/png;base64,${Buffer.from(pngBytes).toString('base64')}`
    const jpegDataUrl = `data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 0x01, 0xff, 0xd9]).toString('base64')}`

    const supportCreated = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'employee.create', expectedVersion: 1,
      payload: {
        unit: 'business_support', name: 'Hỗ trợ có CCCD', phone: '0901234001', cccd: '079123450001',
        address: 'TP.HCM', startDate: '2026-08-01', employmentType: 'Full-Time', position: 'NV hỗ trợ KD',
        username: 'support.image', password: 'support-image-password', identityImages: { front: pngDataUrl, back: pngDataUrl },
      },
    }, { ...adminAuthorization, 'idempotency-key': 'identity-support-create-0001' }), env)
    expect(supportCreated.status).toBe(201)
    const supportCreatedBody = await supportCreated.json()
    const firstFrontKey = supportCreatedBody.employee.identityImages.front.key
    expect(supportCreatedBody).toMatchObject({
      employee: {
        id: 'HTKD-001', identityImages: { front: { contentType: 'image/png', size: 8, uploadedAt: expect.any(String) } },
      },
      user: { role: 'business_support', employeeId: 'HTKD-001' },
    })
    expect(JSON.stringify(supportCreatedBody)).not.toContain(pngDataUrl)
    expect(bucket.objects.has(firstFrontKey)).toBe(true)

    const managerCreated = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'employee.create', expectedVersion: 2,
      payload: {
        unit: 'store_manager', storeId: 'S01', name: 'Quản lý có CCCD', phone: '0901234002', cccd: '079123450002',
        address: 'TP.HCM', startDate: '2026-08-01', employmentType: 'Part-Time', position: 'Quản lý cửa hàng',
        username: 'manager.image', password: 'manager-image-password', cccdImages: { front: pngDataUrl, back: pngDataUrl },
      },
    }, { ...adminAuthorization, 'idempotency-key': 'identity-manager-create-0001' }), env)
    expect(managerCreated.status).toBe(201)
    const managerCreatedBody = await managerCreated.json()
    expect(managerCreatedBody.employee.id).toBe('QLCH-001')

    const adminImage = await worker.fetch(new Request('https://idosi.example/api/identity-images/HTKD-001/front', {
      headers: adminAuthorization,
    }), env)
    expect(adminImage.status).toBe(200)
    expect(adminImage.headers.get('content-type')).toBe('image/png')
    expect(adminImage.headers.get('cache-control')).toBe('private, no-store')
    expect(new Uint8Array(await adminImage.arrayBuffer())).toEqual(pngBytes)
    const anonymousImage = await worker.fetch(new Request('https://idosi.example/api/identity-images/HTKD-001/front'), env)
    expect(anonymousImage.status).toBe(401)

    const managerLogin = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
      username: 'manager.image', password: 'manager-image-password',
    }), env)
    const managerAuthorization = { authorization: `Bearer ${(await managerLogin.json()).token}` }
    expect((await worker.fetch(new Request('https://idosi.example/api/identity-images/QLCH-001/back', {
      headers: managerAuthorization,
    }), env)).status).toBe(200)
    expect((await worker.fetch(new Request('https://idosi.example/api/identity-images/HTKD-001/front', {
      headers: managerAuthorization,
    }), env)).status).toBe(403)

    const supportLogin = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
      username: 'support.image', password: 'support-image-password',
    }), env)
    const supportAuthorization = { authorization: `Bearer ${(await supportLogin.json()).token}` }
    expect((await worker.fetch(new Request('https://idosi.example/api/identity-images/QLCH-001/back', {
      headers: supportAuthorization,
    }), env)).status).toBe(200)
    const visibleUsers = await worker.fetch(new Request('https://idosi.example/api/users', { headers: supportAuthorization }), env)
    expect((await visibleUsers.json()).users.map(({ employeeId }) => employeeId)).toEqual(expect.arrayContaining(['HTKD-001', 'QLCH-001']))

    const supportUpdated = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'employee.update', expectedVersion: 3,
      payload: { employeeId: 'HTKD-001', identityImages: { front: jpegDataUrl } },
    }, { ...adminAuthorization, 'idempotency-key': 'identity-support-update-0001' }), env)
    expect(supportUpdated.status).toBe(200)
    const secondFrontKey = (await supportUpdated.json()).employee.identityImages.front.key
    expect(secondFrontKey).not.toBe(firstFrontKey)
    expect(bucket.objects.has(firstFrontKey)).toBe(false)
    expect(bucket.deletedKeys).toContain(firstFrontKey)

    const supportImageRemoved = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'employee.update', expectedVersion: 4,
      payload: { employeeId: 'HTKD-001', identityImages: { front: null } },
    }, { ...adminAuthorization, 'idempotency-key': 'identity-support-remove-0001' }), env)
    expect(supportImageRemoved.status).toBe(400)
    expect(await supportImageRemoved.json()).toMatchObject({ error: { code: 'IDENTITY_IMAGES_REQUIRED' } })
    expect(bucket.objects.has(secondFrontKey)).toBe(true)

    const unavailable = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'employee.update', expectedVersion: 4,
      payload: { employeeId: 'HTKD-001', identityImages: { front: pngDataUrl } },
    }, { ...adminAuthorization, 'idempotency-key': 'identity-storage-missing-0001' }), { DB: env.DB })
    expect(unavailable.status).toBe(503)
    expect(await unavailable.json()).toMatchObject({ error: { code: 'IDENTITY_IMAGE_STORAGE_UNAVAILABLE' } })
    expect(env.DB.database.prepare("SELECT version FROM app_state WHERE scope_key = 'global'").get()).toEqual({ version: 4 })

    const keysBeforeRace = [...bucket.objects.keys()]
    env.DB.beforeBatch = async ({ database }) => {
      database.prepare("UPDATE app_state SET version = version + 1 WHERE scope_key = 'global'").run()
    }
    const raced = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'employee.update', expectedVersion: 4,
      payload: { employeeId: 'HTKD-001', identityImages: { front: pngDataUrl } },
    }, { ...adminAuthorization, 'idempotency-key': 'identity-storage-race-0001' }), env)
    expect(raced.status).toBe(409)
    expect(await raced.json()).toMatchObject({ error: { code: 'VERSION_CONFLICT' } })
    expect([...bucket.objects.keys()]).toEqual(keysBeforeRace)
  }, 30_000)

  it('lets a manager operate stores while enforcing the explicit admin-only boundaries', async () => {
    const env = { DB: new MemoryD1(), IDENTITY_IMAGES: new MemoryR2(), BOOTSTRAP_TOKEN: 'bootstrap-manager-rbac' }
    const bootstrap = await worker.fetch(jsonRequest('https://idosi.example/api/bootstrap', {
      username: 'admin',
      password: 'manager-rbac-admin-password',
      initialState: {
        stores: [{ id: 'S01', name: 'IDOSI Tô Ngọc Vân', short: 'Tô Ngọc Vân', status: 'Đang hoạt động' }],
        employees: [
          { id: 'E01', code: 'E01', name: 'Nhân viên 01', phone: '0900000001', storeId: 'S01', employmentType: 'Full-Time', monthlySalary: 8_000_000 },
          { id: 'E02', code: 'E02', name: 'Nhân viên legacy nghỉ việc', phone: '0900000007', storeId: 'S01', employmentType: 'Full-Time', monthlySalary: 8_000_000, status: 'inactive' },
          { id: 'VP001', code: 'VP001', name: 'Nhân viên văn phòng', phone: '0900000002', storeId: 'OFFICE', unit: 'office' },
          { id: 'QLCH-RBAC', code: 'QLCH-RBAC', name: 'Quản lý IDOSI', storeId: 'S01', unit: 'store_manager', status: 'Đang làm việc' },
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
        role: 'store_manager',
        username: 'manager',
        password: 'manager-rbac-password',
        displayName: 'Quản lý IDOSI',
      },
    }, { ...adminAuthorization, 'idempotency-key': 'manager-create-0001' }), env)
    expect(managerCreated.status).toBe(400)
    expect(await managerCreated.json()).toMatchObject({ error: { code: 'EMPLOYEE_SCOPE_INVALID' } })

    const linkedManagerCreated = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'user.create',
      expectedVersion: 0,
      payload: {
        role: 'store_manager',
        storeId: 'S01',
        employeeId: 'QLCH-RBAC',
        username: 'manager',
        password: 'manager-rbac-password',
        displayName: 'Quản lý IDOSI',
      },
    }, { ...adminAuthorization, 'idempotency-key': 'manager-create-linked-0001' }), env)
    expect(linkedManagerCreated.status).toBe(201)
    expect(await linkedManagerCreated.json()).toMatchObject({ user: { role: 'store_manager', storeId: 'S01', employeeId: 'QLCH-RBAC' } })

    const managerLogin = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
      username: 'manager', password: 'manager-rbac-password',
    }), env)
    expect(managerLogin.status).toBe(200)
    const managerAuthorization = { authorization: `Bearer ${(await managerLogin.json()).token}` }
    const managerBootstrap = await worker.fetch(new Request('https://idosi.example/api/bootstrap', {
      headers: managerAuthorization,
    }), env)
    const managerBootstrapBody = await managerBootstrap.json()
    expect(managerBootstrapBody).toMatchObject({ projection: 'store_manager', user: { role: 'store_manager' } })
    expect(managerBootstrapBody.state.employees.map(({ id }) => id)).toEqual(['E01', 'E02', 'QLCH-RBAC'])
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
        body: {
          type: 'order.create', expectedVersion: 1,
          payload: {
            storeId: 'S01', customerName: 'Khách', gender: 'Khác', occupation: 'Khác',
            acquisitionChannel: 'Khác', amount: 100_000, paymentMethod: 'Tiền mặt',
          },
        },
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
        cccd: '079000000004', address: 'TP. Hồ Chí Minh', startDate: '2026-08-14',
        employmentType: 'Part-Time', hourlyRate: 35_000,
        username: 'employee.new', password: 'employee-new-password',
        identityImages: testIdentityImages(),
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

    const retiredEmployeeIdIgnored = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'employee.create', expectedVersion: 11,
      payload: {
        id: 'TNV-001', storeId: 'S01', name: 'Nhân viên trùng mã', phone: '0900000006',
        cccd: '079000000006', address: 'TP. Hồ Chí Minh', startDate: '2026-08-14',
        employmentType: 'Part-Time', hourlyRate: 36_000,
        username: 'employee.reused', password: 'employee-reused-password',
        identityImages: testIdentityImages(),
      },
    }, { ...managerAuthorization, 'idempotency-key': 'manager-employee-retired-id-0001' }), env)
    expect(retiredEmployeeIdIgnored.status).toBe(201)
    expect(await retiredEmployeeIdIgnored.json()).toMatchObject({ version: 12, employee: { id: 'TNV-002' } })

    const nextEmployeeCreated = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'employee.create', expectedVersion: 12,
      payload: {
        storeId: 'S01', name: 'Nhân viên kế tiếp', phone: '0900000005',
        cccd: '079000000005', address: 'TP. Hồ Chí Minh', startDate: '2026-08-14',
        employmentType: 'Part-Time', hourlyRate: 36_000,
        username: 'employee.next', password: 'employee-next-password',
        identityImages: testIdentityImages(),
      },
    }, { ...managerAuthorization, 'idempotency-key': 'manager-employee-next-0001' }), env)
    expect(nextEmployeeCreated.status).toBe(201)
    expect(await nextEmployeeCreated.json()).toMatchObject({
      version: 13,
      employee: { id: 'TNV-003' },
      user: { employeeId: 'TNV-003', status: 'active' },
    })

    const secondRoleWithSharedPersonalInfo = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'employee.create', expectedVersion: 13,
      payload: {
        storeId: 'S01', name: 'Nhân viên kiêm nhiệm', phone: '0900000005',
        cccd: '079000000005', address: 'TP. Hồ Chí Minh', startDate: '2026-08-14',
        employmentType: 'Part-Time', hourlyRate: 40_000,
        username: 'employee.second-role', password: 'employee-second-role-password',
        identityImages: testIdentityImages(),
      },
    }, { ...managerAuthorization, 'idempotency-key': 'manager-employee-shared-profile-0001' }), env)
    expect(secondRoleWithSharedPersonalInfo.status).toBe(201)
    expect(await secondRoleWithSharedPersonalInfo.json()).toMatchObject({
      version: 14,
      employee: { id: 'TNV-004', phone: '0900000005', cccd: '079000000005' },
      user: { employeeId: 'TNV-004', username: 'employee.second-role' },
    })

    const nextEmployeeLogin = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
      username: 'employee.next', password: 'employee-next-password',
    }), env)
    const nextEmployeeToken = (await nextEmployeeLogin.json()).token
    const employeeAvatar = `data:image/png;base64,${'A'.repeat(200 * 1024)}`
    const employeeSettingsUpdated = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'account_settings.update', expectedVersion: 14,
      payload: { name: 'Nhân viên kế tiếp', email: 'employee.next@idosi.vn', avatar: employeeAvatar },
    }, {
      authorization: `Bearer ${nextEmployeeToken}`,
      'idempotency-key': 'employee-account-settings-avatar-0001',
    }), env)
    expect(employeeSettingsUpdated.status).toBe(200)
    expect(await employeeSettingsUpdated.json()).toMatchObject({
      version: 15,
      settings: { name: 'Nhân viên kế tiếp', email: 'employee.next@idosi.vn', avatar: employeeAvatar },
      user: { role: 'employee', employeeId: 'TNV-003', version: 2 },
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
          { id: 'HTKD-PERSIST', code: 'HTKD-PERSIST', name: 'Quản lý cũ', storeId: 'BUSINESS_SUPPORT', unit: 'business_support', status: 'Đang làm việc' },
        ],
        supportTransfers: [{
          id: 'ST-OFFICE', employeeId: 'VP001', fromStoreId: 'OFFICE', toStoreId: 'S01',
          fromDate: '2026-08-01', toDate: '2026-08-02', status: 'Đã duyệt',
        }],
        payrollPeriods: [{
          id: 'PAYROLL-LOCKED', storeId: 'S01', period: '2026-09', status: 'Đã khóa',
          lockedAt: '2026-09-30T00:00:00.000Z',
        }, {
          id: 'PAYROLL-PAID', storeId: 'S02', period: '2026-10', status: 'Đã chi',
          confirmedAt: '2026-10-31T00:00:00.000Z',
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
        role: 'business_support', employeeId: 'HTKD-PERSIST', username: 'manager.settings', password: 'persistence-manager-password', displayName: 'Quản lý cũ',
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
    expect((await managerBootstrap.json()).state.supportTransfers).toEqual([
      expect.objectContaining({ id: 'ST-OFFICE', employeeId: 'VP001' }),
    ])

    const adminTransferValidated = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'support_transfer.create',
      expectedVersion: 1,
      payload: {
        employeeId: 'E01', toStoreId: 'S02', fromDate: '2026-08-15', toDate: '2026-08-17',
      },
    }, { ...adminAuthorization, 'idempotency-key': 'admin-support-transfer-validated-0001' }), env)
    expect(adminTransferValidated.status).toBe(400)
    expect(await adminTransferValidated.json()).toMatchObject({ error: { code: 'SUPPORT_HOURLY_RATE_REQUIRED' } })

    const transferRateRequired = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'support_transfer.create', expectedVersion: 1,
      payload: { employeeId: 'E01', toStoreId: 'S02', fromDate: '2026-08-15', toDate: '2026-08-17' },
    }, { ...managerAuthorization, 'idempotency-key': 'support-transfer-rate-required-0001' }), env)
    expect(transferRateRequired.status).toBe(400)
    expect(await transferRateRequired.json()).toMatchObject({ error: { code: 'SUPPORT_HOURLY_RATE_REQUIRED' } })

    const transferSourceMismatch = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'support_transfer.create', expectedVersion: 1,
      payload: {
        employeeId: 'E01', fromStoreId: 'S02', toStoreId: 'S01',
        fromDate: '2026-08-15', toDate: '2026-08-17', hourlySupportRate: 45_000, allowance: 0,
      },
    }, { ...managerAuthorization, 'idempotency-key': 'support-transfer-source-mismatch-0001' }), env)
    expect(transferSourceMismatch.status).toBe(400)
    expect(await transferSourceMismatch.json()).toMatchObject({ error: { code: 'TRANSFER_SOURCE_MISMATCH' } })

    const lockedTransfer = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'support_transfer.create',
      expectedVersion: 1,
      payload: {
        employeeId: 'E01', toStoreId: 'S02', fromDate: '2026-09-01', toDate: '2026-09-02',
        hourlySupportRate: 45_000, allowance: 150_000, note: 'Kỳ đã khóa',
      },
    }, { ...managerAuthorization, 'idempotency-key': 'support-transfer-locked-0001' }), env)
    expect(lockedTransfer.status).toBe(409)
    expect(await lockedTransfer.json()).toMatchObject({ error: { code: 'PAYROLL_PERIOD_LOCKED' } })
    const paidTransfer = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'support_transfer.create', expectedVersion: 1,
      payload: {
        employeeId: 'E01', toStoreId: 'S02', fromDate: '2026-10-01', toDate: '2026-10-02',
        hourlySupportRate: 45_000, allowance: 150_000,
      },
    }, { ...managerAuthorization, 'idempotency-key': 'support-transfer-paid-0001' }), env)
    expect(paidTransfer.status).toBe(409)
    expect(await paidTransfer.json()).toMatchObject({ error: { code: 'PAYROLL_PERIOD_PAID' } })

    const createTransferCommand = {
      type: 'support_transfer.create',
      expectedVersion: 1,
      payload: {
        employeeId: 'E01', fromStoreId: 'S01', toStoreId: 'S02',
        fromDate: '2026-08-15', toDate: '2026-08-17',
        hourlySupportRate: 45_000, allowance: 150_000, note: 'Hỗ trợ khai trương',
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
        fromDate: '2026-08-15', toDate: '2026-08-17', hourlySupportRate: 45_000,
        allowance: 150_000, status: 'Đã duyệt',
      },
    })
    const transferReplay = await worker.fetch(jsonRequest('https://idosi.example/api/command', createTransferCommand, {
      ...managerAuthorization, 'idempotency-key': 'support-transfer-create-0001',
    }), env)
    expect(transferReplay.status).toBe(201)
    expect(transferReplay.headers.get('idempotency-replayed')).toBe('true')
    expect(await transferReplay.json()).toEqual(transferCreatedBody)

    const overlappingTransfer = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'support_transfer.create', expectedVersion: 2,
      payload: {
        employeeId: 'E01', toStoreId: 'S02', fromDate: '2026-08-17', toDate: '2026-08-19',
        hourlySupportRate: 45_000, allowance: 0,
      },
    }, { ...managerAuthorization, 'idempotency-key': 'support-transfer-overlap-0001' }), env)
    expect(overlappingTransfer.status).toBe(409)
    expect(await overlappingTransfer.json()).toMatchObject({ error: { code: 'SUPPORT_TRANSFER_OVERLAP' } })

    const transferId = transferCreatedBody.transfer.id
    const transferUpdated = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'support_transfer.update',
      expectedVersion: 2,
      payload: { transferId, toDate: '2026-08-18', hourlyRate: 50_000, allowance: 200_000, note: 'Đã gia hạn', status: 'Hoàn tất' },
    }, { ...managerAuthorization, 'idempotency-key': 'support-transfer-update-0001' }), env)
    expect(transferUpdated.status).toBe(200)
    expect(await transferUpdated.json()).toMatchObject({
      version: 3, transfer: { id: transferId, toDate: '2026-08-18', hourlySupportRate: 50_000, allowance: 200_000, note: 'Đã gia hạn', status: 'Hoàn tất' },
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
    }, { ...adminAuthorization, 'idempotency-key': 'store-settings-invalid-0001' }), env)
    expect(invalidStore.status).toBe(400)
    expect(await invalidStore.json()).toMatchObject({ error: { code: 'PHONE_INVALID' } })
    const invalidHours = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'store.update', expectedVersion: 4,
      payload: { storeId: 'S01', operatingHours: { opening: '22:00', closing: '07:00' } },
    }, { ...adminAuthorization, 'idempotency-key': 'store-settings-hours-invalid-0001' }), env)
    expect(invalidHours.status).toBe(400)
    expect(await invalidHours.json()).toMatchObject({ error: { code: 'STORE_HOURS_INVALID' } })
    const storeUpdated = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'store.update',
      expectedVersion: 4,
      payload: {
        storeId: 'S01', phone: '0901234567', email: 'STORE01@IDOSI.VN', tax: '0312345678',
        operatingHours: { opening: '07:30', closing: '22:45' }, address: '123 Đường IDOSI',
      },
    }, { ...adminAuthorization, 'idempotency-key': 'store-settings-update-0001' }), env)
    expect(storeUpdated.status).toBe(200)
    expect(await storeUpdated.json()).toMatchObject({
      version: 5,
      store: {
        phone: '0901234567', email: 'store01@idosi.vn', tax: '0312345678', taxCode: '0312345678',
        opening: '07:30', openingTime: '07:30', closing: '22:45', closingTime: '22:45', address: '123 Đường IDOSI',
        operatingHours: { opening: '07:30', closing: '22:45' },
      },
    })
    const projectedStoreState = await worker.fetch(new Request('https://idosi.example/api/state', {
      headers: managerAuthorization,
    }), env)
    expect(projectedStoreState.status).toBe(200)
    expect((await projectedStoreState.json()).state.stores.find(({ id }) => id === 'S01')).toMatchObject({
      opening: '07:30', openingTime: '07:30', closing: '22:45', closingTime: '22:45',
      operatingHours: { opening: '07:30', closing: '22:45' },
    })

    const oversizedAvatar = `data:image/png;base64,${'A'.repeat(Math.ceil((200 * 1024 + 1) * 4 / 3))}`
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
    expect(await managerResetDenied.json()).toMatchObject({ error: { code: 'BUSINESS_SUPPORT_READ_ONLY' } })

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
      nonAdminAccountsPurged: true,
    })
    expect(resetBody.state).not.toHaveProperty('accountSettings')
    expect(env.DB.database.prepare(`
      SELECT id, username, display_name, role, status, version
      FROM users ORDER BY id
    `).all()).toEqual(usersBeforeReset.filter(({ role }) => role === 'admin'))
    expect(env.DB.database.prepare(`
      SELECT id, token_hash, user_id, revoked_at
      FROM sessions ORDER BY id
    `).all()).toEqual(sessionsBeforeReset.filter(({ user_id: userId }) => (
      usersBeforeReset.some(({ id, role }) => id === userId && role === 'admin')
    )))

    const rawState = readHydratedState(env.DB.database)
    expect(rawState).not.toHaveProperty('adminAccounts')
    expect(JSON.stringify(rawState)).not.toContain('must-be-removed')
    expect(rawState.accountSettings).toEqual({})
    const managerAfterReset = await worker.fetch(new Request('https://idosi.example/api/bootstrap', {
      headers: managerAuthorization,
    }), env)
    expect(managerAfterReset.status).toBe(401)
    const usersAfterReset = await worker.fetch(new Request('https://idosi.example/api/users', {
      headers: adminAuthorization,
    }), env)
    expect(usersAfterReset.status).toBe(200)
    expect((await usersAfterReset.json()).users).toEqual([])
    expect(env.DB.database.prepare('SELECT id FROM users WHERE role <> \'admin\'').all()).toEqual([])
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

  it('creates business-support and store-manager profiles atomically with scoped RBAC and attendance', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-08-14T00:55:00.000Z'))
      const env = { DB: new MemoryD1(), IDENTITY_IMAGES: new MemoryR2(), BOOTSTRAP_TOKEN: 'bootstrap-operational-roles' }
      const bootstrap = await worker.fetch(jsonRequest('https://idosi.example/api/bootstrap', {
        username: 'admin',
        password: 'operational-roles-admin-password',
        initialState: {
          stores: [
            { id: 'S01', short: 'TNV', name: 'IDOSI Tô Ngọc Vân', status: 'Đang hoạt động' },
            { id: 'S02', short: 'TH', name: 'IDOSI Tây Hòa', status: 'Đang hoạt động' },
          ],
          employees: [], attendance: [], schedule: [], tasks: [], shiftDefinitions: [],
          orders: [], expenseEntries: [], fixedExpenses: [], cashTransactions: [],
          salaryAdjustments: [], salaryAdvances: [], payrollPeriods: [], payrollPayments: [],
        },
      }, { 'x-idosi-bootstrap-token': env.BOOTSTRAP_TOKEN }), env)
      expect(bootstrap.status).toBe(201)
      const adminLogin = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
        username: 'admin', password: 'operational-roles-admin-password',
      }), env)
      const adminAuthorization = { authorization: `Bearer ${(await adminLogin.json()).token}` }

      const missingAddress = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'employee.create', expectedVersion: 1,
        payload: {
          unit: 'business_support', name: 'Thiếu địa chỉ', phone: '0901999999', cccd: '079123459999',
          startDate: '2026-08-01', employmentType: 'Full-Time', position: 'NV hỗ trợ KD',
          username: 'support.no.address', password: 'support-no-address-password',
        },
      }, { ...adminAuthorization, 'idempotency-key': 'business-support-address-required-0001' }), env)
      expect(missingAddress.status).toBe(400)
      expect(await missingAddress.json()).toMatchObject({ error: { code: 'EMPLOYEE_ADDRESS_INVALID' } })

      const supportCreated = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'employee.create', expectedVersion: 1,
        payload: {
          unit: 'business_support', name: 'Hỗ trợ Kinh doanh 01', phone: '0901000001',
          cccd: '079123456701', address: 'TP.HCM', employmentType: 'Full-Time', position: 'NV hỗ trợ KD',
          startDate: '2026-08-01', username: 'support.one', password: 'support-one-password',
          identityImages: testIdentityImages(),
        },
      }, { ...adminAuthorization, 'idempotency-key': 'business-support-create-0001' }), env)
      expect(supportCreated.status).toBe(201)
      expect(await supportCreated.json()).toMatchObject({
        version: 2,
        employee: {
          id: 'HTKD-001', unit: 'business_support', storeId: 'BUSINESS_SUPPORT', startDate: '2026-08-01',
          cccd: '079123456701', employmentType: 'Full-Time', position: 'NV hỗ trợ KD', workStart: '08:00', workEnd: '17:30',
        },
        user: { role: 'business_support', storeId: 'BUSINESS_SUPPORT', employeeId: 'HTKD-001' },
      })

      const storeManagerCreated = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'employee.create', expectedVersion: 2,
        payload: {
          unit: 'store_manager', storeId: 'S01', name: 'Quản lý TNV', phone: '0901000002',
          cccd: '079123456702', address: 'TP.HCM', employmentType: 'Full-Time', position: 'Quản lý cửa hàng',
          startDate: '2026-08-01', username: 'store.manager.one', password: 'store-manager-one-password',
          identityImages: testIdentityImages(),
        },
      }, { ...adminAuthorization, 'idempotency-key': 'store-manager-create-0001' }), env)
      expect(storeManagerCreated.status).toBe(201)
      expect(await storeManagerCreated.json()).toMatchObject({
        version: 3,
        employee: { id: 'QLCH-001', unit: 'store_manager', storeId: 'S01', position: 'Quản lý cửa hàng' },
        user: { role: 'store_manager', storeId: 'S01', employeeId: 'QLCH-001' },
      })

      const supportLogin = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
        username: 'support.one', password: 'support-one-password',
      }), env)
      const supportAuthorization = { authorization: `Bearer ${(await supportLogin.json()).token}` }
      for (const [index, type] of [
        'state.merge', 'system.reset_demo', 'user.create', 'task.done',
      ].entries()) {
        const denied = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
          type, expectedVersion: 3, payload: {},
        }, { ...supportAuthorization, 'idempotency-key': `support-read-only-${String(index).padStart(4, '0')}` }), env)
        expect(denied.status, type).toBe(403)
        expect(await denied.json(), type).toMatchObject({ error: { code: 'BUSINESS_SUPPORT_READ_ONLY' } })
      }
      expect(env.DB.database.prepare("SELECT version FROM app_state WHERE scope_key = 'global'").get()).toEqual({ version: 3 })
      const supportCheckIn = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'attendance.check_in', expectedVersion: 3,
        payload: { location: { latitude: 10.8, longitude: 106.7, accuracy: 8 } },
      }, { ...supportAuthorization, 'idempotency-key': 'business-support-check-in-0001' }), env)
      expect(supportCheckIn.status).toBe(201)
      const supportAttendance = (await supportCheckIn.json()).attendance
      expect(supportAttendance).toMatchObject({
        employeeId: 'HTKD-001', storeId: 'BUSINESS_SUPPORT', unit: 'business_support',
        attendanceMode: 'office', shiftId: 'full_time', shiftName: 'Giờ hành chính',
        shiftStart: '08:00', shiftEnd: '17:30', shiftSource: 'profile-work-shift', arrivalTag: 'Đi sớm',
      })
      vi.setSystemTime(new Date('2026-08-14T10:05:00.000Z'))
      const supportCheckOut = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'attendance.check_out', expectedVersion: 4,
        payload: {
          attendanceId: supportAttendance.id,
          location: { latitude: 10.8, longitude: 106.7, accuracy: 8 },
        },
      }, { ...supportAuthorization, 'idempotency-key': 'business-support-check-out-0001' }), env)
      expect(supportCheckOut.status).toBe(200)
      expect(await supportCheckOut.json()).toMatchObject({
        version: 5, attendance: { employeeId: 'HTKD-001', checkOut: '17:05', workdayCredit: 1 },
      })

      const storeManagerLogin = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
        username: 'store.manager.one', password: 'store-manager-one-password',
      }), env)
      const storeManagerAuthorization = { authorization: `Bearer ${(await storeManagerLogin.json()).token}` }
      const storeEmployeeCreated = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'employee.create', expectedVersion: 5,
        payload: {
          storeId: 'S01', unit: 'store', name: 'Nhân viên TNV', phone: '0901000003',
          cccd: '079123456703', address: 'TP.HCM', startDate: '2026-08-01',
          employmentType: 'Full-Time', standardWorkDays: 26, requiredMonthlyHours: 208, baseSalary: 8_000_000,
          username: 'store.employee.one', password: 'store-employee-one-password',
          identityImages: testIdentityImages(),
        },
      }, { ...storeManagerAuthorization, 'idempotency-key': 'store-manager-employee-create-0001' }), env)
      expect(storeEmployeeCreated.status).toBe(201)
      expect(await storeEmployeeCreated.json()).toMatchObject({
        version: 6, employee: { id: 'TNV-001', unit: 'store', storeId: 'S01' }, user: { role: 'employee' },
      })

      const managerScheduleDenied = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'schedule.assign', expectedVersion: 6,
        payload: {
          storeId: 'S01', date: '2026-08-15', employeeIds: ['QLCH-001'], shiftIds: ['SHIFT-01'],
        },
      }, { ...storeManagerAuthorization, 'idempotency-key': 'store-manager-own-schedule-denied-0001' }), env)
      expect(managerScheduleDenied.status).toBe(400)
      expect(await managerScheduleDenied.json()).toMatchObject({ error: { code: 'EMPLOYEE_STORE_MISMATCH' } })

      const crossStoreEmployee = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'employee.create', expectedVersion: 6,
        payload: {
          storeId: 'S02', unit: 'store', name: 'Vượt phạm vi', phone: '0901000004',
          employmentType: 'Full-Time', monthlySalary: 8_000_000,
        },
      }, { ...storeManagerAuthorization, 'idempotency-key': 'store-manager-cross-store-0001' }), env)
      expect(crossStoreEmployee.status).toBe(403)
      expect(await crossStoreEmployee.json()).toMatchObject({ error: { code: 'STORE_SCOPE_FORBIDDEN' } })
      const crossStoreUpdate = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'store.update', expectedVersion: 6, payload: { storeId: 'S02', name: 'Không được sửa' },
      }, { ...storeManagerAuthorization, 'idempotency-key': 'store-manager-cross-store-update-0001' }), env)
      expect(crossStoreUpdate.status).toBe(403)

      const storeUsers = await worker.fetch(new Request('https://idosi.example/api/users', {
        headers: storeManagerAuthorization,
      }), env)
      expect((await storeUsers.json()).users).toEqual([
        expect.objectContaining({ role: 'employee', storeId: 'S01', employeeId: 'TNV-001' }),
      ])
      const payrollClosed = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'payroll.close', expectedVersion: 6, payload: { storeId: 'S01', period: '2026-08' },
      }, { ...storeManagerAuthorization, 'idempotency-key': 'store-manager-payroll-close-0001' }), env)
      expect(payrollClosed.status).toBe(201)
      expect((await payrollClosed.json()).period.rows.map(({ employeeId }) => employeeId)).toEqual(['TNV-001'])

      const storeManagerState = await worker.fetch(new Request('https://idosi.example/api/state', {
        headers: storeManagerAuthorization,
      }), env)
      const storeManagerProjection = (await storeManagerState.json()).state
      expect(storeManagerProjection.stores.map(({ id }) => id)).toEqual(['S01'])
      expect(storeManagerProjection.employees.map(({ id }) => id).sort()).toEqual(['QLCH-001', 'TNV-001'])
      expect(storeManagerProjection.attendance).toEqual([])
      expect(JSON.stringify(storeManagerProjection)).not.toContain('HTKD-001')
    } finally {
      vi.useRealTimers()
    }
  })

  it('prorates business-support monthly salary by worked days and excludes store managers', async () => {
    const env = { DB: new MemoryD1(), BOOTSTRAP_TOKEN: 'bootstrap-support-payroll' }
    const bootstrap = await worker.fetch(jsonRequest('https://idosi.example/api/bootstrap', {
      username: 'admin',
      password: 'support-payroll-admin-password',
      initialState: {
        employees: [
          {
            id: 'HTKD001', code: 'HTKD001', name: 'Hỗ trợ Kinh doanh',
            storeId: 'BUSINESS_SUPPORT', unit: 'business_support', status: 'Đang làm việc',
            employmentType: 'Chính thức', payBasis: 'monthly', monthlySalary: 12_000_000,
            standardWorkDays: 20, monthlyWorkdayTargets: { '2026-08': 20 },
          },
          {
            id: 'QL-INTERNAL-001', code: 'QL-INTERNAL-001', name: 'Quản lý không tính lương',
            storeId: 'BUSINESS_SUPPORT', unit: 'store_manager', status: 'Đang làm việc',
            payBasis: 'monthly', monthlySalary: 99_000_000, standardWorkDays: 20,
          },
        ],
        attendance: [
          {
            id: 'ATT-SUPPORT-01', employeeId: 'HTKD001', storeId: 'BUSINESS_SUPPORT',
            date: '2026-08-01', workDate: '2026-08-01', checkInAt: '2026-08-01T01:00:00.000Z',
            checkOutAt: '2026-08-01T10:00:00.000Z', workedSeconds: 32_400, workdayCredit: 1,
          },
          {
            id: 'ATT-SUPPORT-02', employeeId: 'HTKD001', storeId: 'BUSINESS_SUPPORT',
            date: '2026-08-02', workDate: '2026-08-02', checkInAt: '2026-08-02T01:00:00.000Z',
            checkOutAt: '2026-08-02T10:00:00.000Z', workedSeconds: 32_400, workdayCredit: 1,
          },
          {
            id: 'ATT-MANAGER-01', employeeId: 'QL-INTERNAL-001', storeId: 'BUSINESS_SUPPORT',
            date: '2026-08-01', workDate: '2026-08-01', checkInAt: '2026-08-01T01:00:00.000Z',
            checkOutAt: '2026-08-01T10:00:00.000Z', workedSeconds: 32_400, workdayCredit: 1,
          },
        ],
        payrollPeriods: [], orders: [], expenseEntries: [], salaryAdjustments: [], salaryAdvances: [],
      },
    }, { 'x-idosi-bootstrap-token': env.BOOTSTRAP_TOKEN }), env)
    expect(bootstrap.status).toBe(201)
    const adminLogin = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
      username: 'admin', password: 'support-payroll-admin-password',
    }), env)
    const adminAuthorization = { authorization: `Bearer ${(await adminLogin.json()).token}` }

    const payrollClosed = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'payroll.close', expectedVersion: 1,
      payload: { storeId: 'BUSINESS_SUPPORT', period: '2026-08' },
    }, { ...adminAuthorization, 'idempotency-key': 'support-payroll-close-0001' }), env)
    expect(payrollClosed.status).toBe(201)
    const payroll = (await payrollClosed.json()).period
    expect(payroll.rows).toEqual([
      expect.objectContaining({
        employeeId: 'HTKD001', workedDays: 2, requiredWorkingDays: 20,
        baseSalary: 1_200_000, gross: 1_200_000, remaining: 1_200_000,
        salarySnapshot: expect.objectContaining({
          monthlySalary: 12_000_000, standardWorkDays: 20, proratedByWorkedDays: true,
        }),
      }),
    ])
    expect(payroll.kpiSnapshot.results.map(({ id }) => id)).toEqual(['HTKD001'])
    expect(JSON.stringify(payroll)).not.toContain('QL-INTERNAL-001')
  })

  it('calculates uncapped SecondMall SM234 Full-Time base salary from actual monthly hours', async () => {
    const attendance = Array.from({ length: 25 }, (_, index) => ({
      id: `ATT-SM234-${index + 1}`,
      employeeId: 'SM234-001',
      storeId: 'CH001',
      date: `2026-08-${String(index + 1).padStart(2, '0')}`,
      workDate: `2026-08-${String(index + 1).padStart(2, '0')}`,
      checkInAt: `2026-08-${String(index + 1).padStart(2, '0')}T01:00:00.000Z`,
      checkOutAt: `2026-08-${String(index + 1).padStart(2, '0')}T09:00:00.000Z`,
      workedSeconds: 8 * 3_600,
      hours: 8,
    }))
    const env = { DB: new MemoryD1(), IDENTITY_IMAGES: new MemoryR2(), BOOTSTRAP_TOKEN: 'bootstrap-sm234-payroll' }
    const bootstrap = await worker.fetch(jsonRequest('https://idosi.example/api/bootstrap', {
      username: 'admin', password: 'sm234-payroll-admin-password',
      initialState: {
        stores: [{ id: 'CH001', short: 'SM234', name: 'SecondMall SM234', status: 'Đang hoạt động' }],
        employees: [{
          id: 'SM234-001', code: 'SM234-001', name: 'Nhân viên SecondMall', phone: '0909876001',
          storeId: 'CH001', unit: 'store', employmentType: 'Full-Time', monthlySalary: 8_000_000,
          tiktokAllowance: 500_000, status: 'Đang làm việc',
        }],
        attendance,
        salaryAdjustments: [{
          id: 'ADJ-SM234', employeeId: 'SM234-001', storeId: 'CH001', period: '2026-08',
          type: 'Thưởng', amount: 250_000, status: 'Đã duyệt',
        }],
        salaryAdvances: [], payrollPeriods: [], payrollPayments: [], orders: [], expenseEntries: [],
      },
    }, { 'x-idosi-bootstrap-token': env.BOOTSTRAP_TOKEN }), env)
    expect(bootstrap.status).toBe(201)
    const login = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
      username: 'admin', password: 'sm234-payroll-admin-password',
    }), env)
    const authorization = { authorization: `Bearer ${(await login.json()).token}` }

    const missingConfiguration = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'payroll.close', expectedVersion: 1, payload: { storeId: 'CH001', period: '2026-08' },
    }, { ...authorization, 'idempotency-key': 'sm234-payroll-missing-config-0001' }), env)
    expect(missingConfiguration.status).toBe(409)
    expect(await missingConfiguration.json()).toMatchObject({
      error: {
        code: 'SM234_PAYROLL_CONFIG_REQUIRED',
        details: { employeeIds: ['SM234-001'], requiredFields: ['standardWorkDays', 'requiredMonthlyHours', 'baseSalary'] },
      },
    })

    for (const [key, payload, code] of [
      ['sm234-hours-invalid-0001', { employeeId: 'SM234-001', requiredMonthlyHours: 0 }, 'REQUIRED_MONTHLY_HOURS_INVALID'],
      ['sm234-days-invalid-0001', { employeeId: 'SM234-001', standardWorkDays: 32 }, 'STORE_WORK_DAYS_INVALID'],
      ['sm234-salary-invalid-0001', { employeeId: 'SM234-001', baseSalary: 8_000_000.5 }, 'MONEY_INVALID'],
    ]) {
      const invalid = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'employee.update', expectedVersion: 1, payload,
      }, { ...authorization, 'idempotency-key': key }), env)
      expect(invalid.status).toBe(400)
      expect(await invalid.json()).toMatchObject({ error: { code } })
    }

    const profileUpdated = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'employee.update', expectedVersion: 1,
      payload: {
        employeeId: 'SM234-001', standardWorkDays: 25, requiredMonthlyHours: 160, baseSalary: 8_000_000,
        identityImages: testIdentityImages(),
      },
    }, { ...authorization, 'idempotency-key': 'sm234-profile-update-0001' }), env)
    expect(profileUpdated.status).toBe(200)
    expect(await profileUpdated.json()).toMatchObject({
      version: 2,
      employee: {
        id: 'SM234-001', standardWorkDays: 25, requiredMonthlyHours: 160,
        baseSalary: 8_000_000, monthlySalary: 8_000_000, payFormula: 'monthly-hours',
      },
    })

    const closed = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'payroll.close', expectedVersion: 2, payload: { storeId: 'CH001', period: '2026-08' },
    }, { ...authorization, 'idempotency-key': 'sm234-payroll-close-0001' }), env)
    expect(closed.status).toBe(201)
    const closedBody = await closed.json()
    expect(closedBody.period.rows).toEqual([
      expect.objectContaining({
        employeeId: 'SM234-001', hours: 200, baseSalary: 10_000_000,
        gross: 10_750_000, remaining: 10_750_000,
        salarySnapshot: expect.objectContaining({
          baseSalary: 8_000_000, requiredMonthlyHours: 160, standardWorkDays: 25,
          payFormula: 'monthly-hours', proratedByActualHours: true,
        }),
      }),
    ])

    const salaryChanged = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'employee.update', expectedVersion: 3,
      payload: { employeeId: 'SM234-001', baseSalary: 8_500_000 },
    }, { ...authorization, 'idempotency-key': 'sm234-salary-change-0001' }), env)
    expect(salaryChanged.status).toBe(200)
    expect(readHydratedState(env.DB.database).payrollPeriods[0]).toMatchObject({
      id: closedBody.period.id, needsReclose: true, invalidationReason: 'employee.update',
    })

    const stalePayDenied = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'payroll.pay', expectedVersion: 4, payload: { storeId: 'CH001', period: '2026-08' },
    }, { ...authorization, 'idempotency-key': 'sm234-stale-pay-denied-0001' }), env)
    expect(stalePayDenied.status).toBe(409)
    expect(await stalePayDenied.json()).toMatchObject({ error: { code: 'PAYROLL_NEEDS_RECLOSE' } })

    const reclosed = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'payroll.close', expectedVersion: 4, payload: { storeId: 'CH001', period: '2026-08' },
    }, { ...authorization, 'idempotency-key': 'sm234-payroll-reclose-0001' }), env)
    expect(reclosed.status).toBe(200)
    expect(await reclosed.json()).toMatchObject({
      version: 5,
      period: { needsReclose: false, rows: [expect.objectContaining({ baseSalary: 10_625_000, gross: 11_375_000 })] },
    })

    const paid = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'payroll.pay', expectedVersion: 5, payload: { storeId: 'CH001', period: '2026-08' },
    }, { ...authorization, 'idempotency-key': 'sm234-payroll-pay-0001' }), env)
    expect(paid.status).toBe(200)
    const paidProfileChange = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'employee.update', expectedVersion: 6,
      payload: { employeeId: 'SM234-001', requiredMonthlyHours: 168 },
    }, { ...authorization, 'idempotency-key': 'sm234-paid-profile-change-0001' }), env)
    expect(paidProfileChange.status).toBe(409)
    expect(await paidProfileChange.json()).toMatchObject({ error: { code: 'PAYROLL_PERIOD_PAID' } })
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

  it('lets Admin and business support edit scoped attendance with payroll and audit invariants', async () => {
    const env = { DB: new MemoryD1(), BOOTSTRAP_TOKEN: 'bootstrap-attendance-edit' }
    const bootstrap = await worker.fetch(jsonRequest('https://idosi.example/api/bootstrap', {
      username: 'admin',
      password: 'attendance-edit-admin-password',
      initialState: {
        stores: [{ id: 'S01', name: 'Cửa hàng 01', short: 'S01' }],
        employees: [
          { id: 'E01', name: 'Nhân viên 01', storeId: 'S01', unit: 'store' },
          { id: 'VP-001', name: 'Nhân viên văn phòng', storeId: 'OFFICE', unit: 'office' },
          { id: 'HTKD-ATTENDANCE', code: 'HTKD-ATTENDANCE', name: 'Manager', storeId: 'BUSINESS_SUPPORT', unit: 'business_support', status: 'Đang làm việc' },
        ],
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
          {
            id: 'ATT-OFFICE', employeeId: 'VP-001', storeId: 'OFFICE', shiftStart: '08:00', shiftEnd: '17:00',
            date: '2026-08-14', workDate: '2026-08-14', checkIn: '08:00', checkInAt: '2026-08-14T01:00:00.000Z',
            checkOut: '17:00', checkOutAt: '2026-08-14T10:00:00.000Z', workedSeconds: 32_400, hours: 9,
          },
        ],
        orders: [
          {
            id: 'ORDER-ATT-CASH', code: 'S01-00001', storeId: 'S01', employeeId: 'E01', attendanceId: 'ATT-AUG',
            amount: 1_000_000, customerName: 'Khách 1', paymentMethod: 'Tiền mặt', status: 'Hoàn tất', source: 'order',
            createdAt: '2026-08-14T02:00:00.000Z', deletedAt: null,
          },
          {
            id: 'ORDER-ATT-TRANSFER', code: 'S01-00002', storeId: 'S01', employeeId: 'E01', attendanceId: 'ATT-AUG',
            amount: 1_500_000, customerName: 'Khách 2', paymentMethod: 'Chuyển khoản', status: 'Hoàn tất', source: 'order',
            createdAt: '2026-08-14T03:00:00.000Z', deletedAt: null,
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
      payload: { role: 'business_support', employeeId: 'HTKD-ATTENDANCE', username: 'attendance.manager', password: 'attendance-manager-password', displayName: 'Manager' },
    }, { ...adminAuthorization, 'idempotency-key': 'attendance-manager-create-0001' }), env)
    expect(managerCreate.status).toBe(201)
    const managerLogin = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
      username: 'attendance.manager', password: 'attendance-manager-password',
    }), env)
    const managerAuthorization = { authorization: `Bearer ${(await managerLogin.json()).token}` }

    const managerUpdated = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'attendance.update', expectedVersion: 1,
      payload: { attendanceId: 'ATT-AUG', checkIn: '08:15', checkOut: '17:05', reason: 'Đối soát theo yêu cầu cửa hàng' },
    }, { ...managerAuthorization, 'idempotency-key': 'attendance-support-update-0001' }), env)
    expect(managerUpdated.status).toBe(200)
    expect(await managerUpdated.json()).toMatchObject({
      version: 2,
      attendance: { id: 'ATT-AUG', checkIn: '08:15', checkOut: '17:05' },
      audit: { actor: { role: 'business_support' } },
    })
    const officeDenied = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'attendance.update', expectedVersion: 2,
      payload: { attendanceId: 'ATT-OFFICE', checkIn: '08:05', checkOut: '17:00', reason: 'Không được sửa khối văn phòng' },
    }, { ...managerAuthorization, 'idempotency-key': 'attendance-support-office-denied-0001' }), env)
    expect(officeDenied.status).toBe(403)
    expect(await officeDenied.json()).toMatchObject({ error: { code: 'OFFICE_FORBIDDEN' } })

    const missingReason = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'attendance.update', expectedVersion: 2,
      payload: { attendanceId: 'ATT-AUG', checkIn: '07:55', checkOut: '17:15' },
    }, { ...adminAuthorization, 'idempotency-key': 'attendance-reason-required-0001' }), env)
    expect(missingReason.status).toBe(400)
    expect(await missingReason.json()).toMatchObject({ error: { code: 'REASON_REQUIRED' } })
    const immutableScope = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'attendance.update', expectedVersion: 2,
      payload: {
        attendanceId: 'ATT-AUG', employeeId: 'E02', checkIn: '07:55', checkOut: '17:15', reason: 'Không được đổi nhân viên',
      },
    }, { ...adminAuthorization, 'idempotency-key': 'attendance-scope-immutable-0001' }), env)
    expect(immutableScope.status).toBe(400)
    expect(await immutableScope.json()).toMatchObject({ error: { code: 'ATTENDANCE_SCOPE_IMMUTABLE' } })
    const invalidOrder = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'attendance.update', expectedVersion: 2,
      payload: { attendanceId: 'ATT-AUG', checkIn: '17:00', checkOut: '08:00', reason: 'Sai thứ tự giờ' },
    }, { ...adminAuthorization, 'idempotency-key': 'attendance-time-invalid-0001' }), env)
    expect(invalidOrder.status).toBe(400)
    expect(await invalidOrder.json()).toMatchObject({ error: { code: 'ATTENDANCE_TIME_ORDER_INVALID' } })

    const updated = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'attendance.update', expectedVersion: 2,
      payload: { attendanceId: 'ATT-AUG', date: '2026-08-14', checkIn: '07:55', checkOut: '17:15', reason: 'Đối soát máy chấm công' },
    }, { ...adminAuthorization, 'idempotency-key': 'attendance-update-success-0001' }), env)
    expect(updated.status).toBe(200)
    expect(await updated.json()).toMatchObject({
      version: 3,
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

    const orderUpdatedAfterAttendance = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'order.update', expectedVersion: 3,
      payload: { orderId: 'ORDER-ATT-TRANSFER', amount: 2_000_000, reason: 'Cập nhật doanh thu sau chỉnh công' },
    }, { ...managerAuthorization, 'idempotency-key': 'attendance-followup-order-update-0001' }), env)
    expect(orderUpdatedAfterAttendance.status).toBe(200)
    expect(await orderUpdatedAfterAttendance.json()).toMatchObject({ version: 4, order: { amount: 2_000_000 } })
    expect(readHydratedState(env.DB.database).attendance.find(({ id }) => id === 'ATT-AUG')).toMatchObject({
      revenue: 3_000_000, cash: 1_000_000, transfer: 2_000_000, orderCount: 2,
    })

    const paidPeriodDenied = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'attendance.update', expectedVersion: 4,
      payload: { attendanceId: 'ATT-SEP', checkIn: '08:05', checkOut: '17:00', reason: 'Kỳ đã chi' },
    }, { ...adminAuthorization, 'idempotency-key': 'attendance-paid-denied-0001' }), env)
    expect(paidPeriodDenied.status).toBe(409)
    expect(await paidPeriodDenied.json()).toMatchObject({ error: { code: 'PAYROLL_PERIOD_PAID' } })
    expect(env.DB.database.prepare("SELECT version FROM app_state WHERE scope_key = 'global'").get()).toEqual({ version: 4 })
    const audit = env.DB.database.prepare("SELECT metadata_json FROM audit_log WHERE action = 'attendance.update' ORDER BY id DESC").get()
    expect(JSON.parse(audit.metadata_json)).toMatchObject({
      reason: 'Đối soát máy chấm công', storeId: 'S01', employeeId: 'E01',
    })

    const resetAttendanceCommand = {
      type: 'operational_reset.restore', expectedVersion: 4,
      payload: {
        dataType: 'attendance', storeId: 'S01', employeeId: 'E01',
        fromDate: '2026-08-14', toDate: '2026-08-14', reason: 'Khôi phục lần chỉnh gần nhất',
      },
    }
    const resetAttendance = await worker.fetch(jsonRequest('https://idosi.example/api/command', resetAttendanceCommand, {
      ...managerAuthorization, 'idempotency-key': 'attendance-operational-reset-0001',
    }), env)
    expect(resetAttendance.status).toBe(200)
    const resetAttendanceBody = await resetAttendance.json()
    expect(resetAttendanceBody).toMatchObject({
      version: 5, restoredCount: 1, restoredIds: ['ATT-AUG'],
      reset: { dataType: 'attendance', storeId: 'S01', employeeId: 'E01', restoredCount: 1 },
      restored: [{ id: 'ATT-AUG', checkIn: '08:15', checkOut: '17:05' }],
    })
    const resetAttendanceReplay = await worker.fetch(jsonRequest('https://idosi.example/api/command', resetAttendanceCommand, {
      ...managerAuthorization, 'idempotency-key': 'attendance-operational-reset-0001',
    }), env)
    expect(resetAttendanceReplay.status).toBe(200)
    expect(resetAttendanceReplay.headers.get('idempotency-replayed')).toBe('true')
    expect(await resetAttendanceReplay.json()).toEqual(resetAttendanceBody)
    const stateAfterReset = readHydratedState(env.DB.database)
    expect(stateAfterReset.attendance.find(({ id }) => id === 'ATT-AUG')).toMatchObject({
      checkIn: '08:15', checkOut: '17:05',
      revenue: 3_000_000, cash: 1_000_000, transfer: 2_000_000, orderCount: 2,
    })
    expect(stateAfterReset.attendanceAudit).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: 'Khôi phục', attendanceId: 'ATT-AUG' }),
      expect.objectContaining({ action: 'Sửa', attendanceId: 'ATT-AUG', restoredAt: expect.any(String) }),
    ]))

    const adminOperationalResetDenied = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      ...resetAttendanceCommand, expectedVersion: 5,
    }, { ...adminAuthorization, 'idempotency-key': 'admin-operational-reset-denied-0001' }), env)
    expect(adminOperationalResetDenied.status).toBe(403)
    expect(await adminOperationalResetDenied.json()).toMatchObject({ error: { code: 'ROLE_FORBIDDEN' } })
  })

  it('restores a pre-deploy attendance correction from the private D1 audit log once', async () => {
    const before = {
      id: 'ATT-LEGACY-D1', employeeId: 'E01', storeId: 'S01', shiftId: 'SHIFT-01',
      date: '2026-08-12', workDate: '2026-08-12', attendanceDate: '2026-08-12',
      checkIn: '08:20', checkInTime: '08:20', checkInAt: '2026-08-12T01:20:00.000Z',
      checkOut: '17:00', checkOutTime: '17:00', checkOutAt: '2026-08-12T10:00:00.000Z',
      arrivalTag: 'Đi trễ', departureTag: 'Đã ra về', punctuality: 'Đi trễ', status: 'Đi trễ',
      minutesEarly: 0, minutesLate: 20, workedSeconds: 31_200, workedMinutes: 520, hours: 26 / 3,
      revenue: 900_000, cash: 400_000, transfer: 500_000, orderCount: 2,
    }
    const after = {
      ...before,
      checkIn: '07:55', checkInTime: '07:55', checkInAt: '2026-08-12T00:55:00.000Z',
      checkOut: '17:15', checkOutTime: '17:15', checkOutAt: '2026-08-12T10:15:00.000Z',
      arrivalTag: 'Đi sớm', punctuality: 'Đi sớm', status: 'Đi sớm', minutesEarly: 5, minutesLate: 0,
      workedSeconds: 33_600, workedMinutes: 560, hours: 28 / 3,
      editedAt: '2026-08-13T02:00:00.000Z', editedBy: { id: 'legacy-admin', role: 'admin' },
      editReason: 'Đối soát trước khi nâng cấp', updatedAt: '2026-08-13T02:00:00.000Z',
    }
    const env = { DB: new MemoryD1(), BOOTSTRAP_TOKEN: 'bootstrap-legacy-attendance-audit' }
    const bootstrap = await worker.fetch(jsonRequest('https://idosi.example/api/bootstrap', {
      username: 'admin', password: 'legacy-attendance-admin-password',
      initialState: {
        stores: [{ id: 'S01', name: 'Cửa hàng 01' }],
        employees: [
          { id: 'E01', name: 'Nhân viên 01', storeId: 'S01', unit: 'store' },
          { id: 'HTKD-LEGACY', name: 'Hỗ trợ KD', storeId: 'BUSINESS_SUPPORT', unit: 'business_support' },
        ],
        attendance: [after], attendanceAudit: [],
        payrollPeriods: [{ id: 'PAY-LEGACY', storeId: 'S01', period: '2026-08', status: 'Đã chốt', needsReclose: false }],
      },
    }, { 'x-idosi-bootstrap-token': env.BOOTSTRAP_TOKEN }), env)
    expect(bootstrap.status).toBe(201)
    const adminLogin = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
      username: 'admin', password: 'legacy-attendance-admin-password',
    }), env)
    const adminAuthorization = { authorization: `Bearer ${(await adminLogin.json()).token}` }
    const adminId = env.DB.database.prepare("SELECT id FROM users WHERE role = 'admin'").get().id
    const metadata = {
      reason: 'Đối soát trước khi nâng cấp', storeId: 'S01', employeeId: 'E01',
      changedFields: ['checkIn', 'checkOut', 'workedSeconds', 'hours'],
    }
    env.DB.database.prepare(`
      INSERT INTO audit_log (
        request_id, actor_id, actor_role, action, entity_type, entity_id,
        before_json, after_json, metadata_json, server_timestamp
      ) VALUES (?, ?, 'admin', 'attendance.update', 'attendance', ?, ?, ?, ?, ?)
    `).run(
      'legacy-attendance-request-0001', adminId, 'ATT-LEGACY-D1',
      JSON.stringify(before), JSON.stringify(after), JSON.stringify(metadata), '2026-08-13T02:00:00.000Z',
    )
    const legacyAuditId = env.DB.database.prepare(`
      SELECT id FROM audit_log WHERE request_id = 'legacy-attendance-request-0001'
    `).get().id

    const supportUser = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'user.create', expectedVersion: 0,
      payload: {
        role: 'business_support', employeeId: 'HTKD-LEGACY', username: 'support.legacy',
        password: 'support-legacy-password', displayName: 'Hỗ trợ KD',
      },
    }, { ...adminAuthorization, 'idempotency-key': 'support-legacy-user-create-0001' }), env)
    expect(supportUser.status).toBe(201)
    const supportLogin = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
      username: 'support.legacy', password: 'support-legacy-password',
    }), env)
    const supportAuthorization = { authorization: `Bearer ${(await supportLogin.json()).token}` }
    const resetPayload = {
      dataType: 'attendance', storeId: 'S01', employeeId: 'E01',
      fromDate: '2026-08-12', toDate: '2026-08-12', reason: 'Khôi phục bản chỉnh cũ',
    }
    const restored = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'operational_reset.restore', expectedVersion: 1, payload: resetPayload,
    }, { ...supportAuthorization, 'idempotency-key': 'legacy-attendance-reset-0001' }), env)
    expect(restored.status).toBe(200)
    expect(await restored.json()).toMatchObject({
      version: 2, restoredCount: 1,
      restored: [{ id: 'ATT-LEGACY-D1', checkIn: '08:20', checkOut: '17:00', revenue: 900_000, orderCount: 2 }],
    })
    let state = readHydratedState(env.DB.database)
    expect(state.attendance[0]).toMatchObject({ checkIn: '08:20', checkOut: '17:00', revenue: 900_000, orderCount: 2 })
    expect(state.attendanceAudit).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: 'Khôi phục', attendanceId: 'ATT-LEGACY-D1' }),
      expect.objectContaining({
        id: `ata_legacy_${legacyAuditId}`, source: 'd1-audit-log', legacyAuditLogId: legacyAuditId,
        attendanceId: 'ATT-LEGACY-D1', restoredAt: expect.any(String),
      }),
    ]))
    expect(state.payrollPeriods[0]).toMatchObject({ needsReclose: true, invalidationReason: 'operational_reset.restore' })

    const secondReset = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'operational_reset.restore', expectedVersion: 2, payload: resetPayload,
    }, { ...supportAuthorization, 'idempotency-key': 'legacy-attendance-reset-noop-0001' }), env)
    expect(secondReset.status).toBe(200)
    expect(await secondReset.json()).toMatchObject({ version: 2, existing: true, restoredCount: 0, restored: [] })
    state = readHydratedState(env.DB.database)
    expect(state.attendanceAudit.filter(({ id }) => id === `ata_legacy_${legacyAuditId}`)).toHaveLength(1)

    const supportAuditView = await worker.fetch(new Request('https://idosi.example/api/audit', {
      headers: supportAuthorization,
    }), env)
    expect(supportAuditView.status).toBe(200)
    expect((await supportAuditView.json()).audit).toEqual([])
  })

  it('checks an Office employee in and out with server time, location, scoped history, and prorated payroll', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-08-14T00:55:00.000Z'))
      const env = { DB: new MemoryD1(), IDENTITY_IMAGES: new MemoryR2(), BOOTSTRAP_TOKEN: 'bootstrap-office-attendance' }
      const bootstrap = await worker.fetch(jsonRequest('https://idosi.example/api/bootstrap', {
        username: 'admin',
        password: 'office-attendance-admin-password',
        initialState: {
          employees: [{
            id: 'VP001', code: 'VP001', name: 'Nhân viên Văn phòng', phone: '0900000001',
            storeId: 'OFFICE', unit: 'office', isOffice: true, employmentType: 'Chính thức',
            payBasis: 'monthly', monthlySalary: 20_000_000, workStart: '08:00', workEnd: '17:00',
          }, {
            id: 'HTKD-OFFICE', code: 'HTKD-OFFICE', name: 'Manager', storeId: 'BUSINESS_SUPPORT',
            unit: 'business_support', status: 'Đang làm việc', workStart: '08:00', workEnd: '17:00',
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
          identityImages: testIdentityImages(),
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
        payload: { role: 'business_support', employeeId: 'HTKD-OFFICE', username: 'office.manager', password: 'office-manager-password', displayName: 'Manager' },
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
      expect(managerOfficeTakeoverDenied.status).toBe(400)
      expect(await managerOfficeTakeoverDenied.json()).toMatchObject({ error: { code: 'EMPLOYEE_STORE_IMMUTABLE' } })

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
          shiftId: 'full_time', shiftName: 'Giờ hành chính', shiftStart: '08:00', shiftEnd: '17:00',
          shiftSource: 'profile-work-shift', checkIn: '08:15', checkInAt: '2026-08-14T01:15:00.000Z',
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
      expect(managerStateBody.state.employees.map(({ id }) => id)).toEqual(['VP001', 'HTKD-OFFICE'])
      expect(managerStateBody.state.attendance).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: 'ATT-OFFICE-HISTORY', employeeId: 'VP001' }),
      ]))
      expect(managerStateBody.state.payrollPeriods).toEqual(expect.arrayContaining([
        expect.objectContaining({ storeId: 'OFFICE', period: '2026-08' }),
      ]))
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
          { id: 'HTKD-NOTIFY', code: 'HTKD-NOTIFY', name: 'Manager', storeId: 'BUSINESS_SUPPORT', unit: 'business_support', status: 'Đang làm việc' },
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
        role: 'business_support', employeeId: 'HTKD-NOTIFY', username: 'notification.manager', password: 'notification-manager-password', displayName: 'Manager',
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
    expect((await managerBootstrap.json()).state.notifications.map(({ id }) => id)).toEqual([
      'N-E01', 'N-STORE', 'N-READ', 'N-E02', 'N-OFFICE', 'N-OFFICE-IDS', 'N-OFFICE-ASSIGNEES',
    ])

    const managerOfficeAudienceRead = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'notification.mark_read', expectedVersion: 1, payload: { notificationId: 'N-OFFICE-IDS' },
    }, { ...managerAuthorization, 'idempotency-key': 'notification-manager-office-audience-0001' }), env)
    expect(managerOfficeAudienceRead.status).toBe(200)
    expect(await managerOfficeAudienceRead.json()).toMatchObject({
      version: 2, updatedCount: 1, notification: { id: 'N-OFFICE-IDS', readAt: expect.any(String) },
    })

    const otherEmployeeDenied = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'notification.mark_read', expectedVersion: 2, payload: { notificationId: 'N-E02' },
    }, { ...employeeAuthorization, 'idempotency-key': 'notification-other-denied-0001' }), env)
    expect(otherEmployeeDenied.status).toBe(404)
    expect(await otherEmployeeDenied.json()).toMatchObject({ error: { code: 'NOTIFICATION_NOT_FOUND' } })
    const marked = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'notification.mark_read', expectedVersion: 2, payload: { notificationId: 'N-E01' },
    }, { ...employeeAuthorization, 'idempotency-key': 'notification-mark-read-0001' }), env)
    expect(marked.status).toBe(200)
    const markedBody = await marked.json()
    expect(markedBody).toMatchObject({
      version: 3, updatedCount: 1,
      notification: { id: 'N-E01', readAt: expect.any(String) },
      notifications: [{ id: 'N-E01' }],
    })
    const markedReplay = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'notification.mark_read', expectedVersion: 2, payload: { notificationId: 'N-E01' },
    }, { ...employeeAuthorization, 'idempotency-key': 'notification-mark-read-0001' }), env)
    expect(markedReplay.headers.get('idempotency-replayed')).toBe('true')
    expect(await markedReplay.json()).toEqual(markedBody)

    const employeeStoreDenied = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'notification.mark_all_read', expectedVersion: 3, payload: { storeId: 'S02' },
    }, { ...employeeAuthorization, 'idempotency-key': 'notification-store-denied-0001' }), env)
    expect(employeeStoreDenied.status).toBe(403)
    const employeeMarkedAll = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'notification.mark_all_read', expectedVersion: 3, payload: {},
    }, { ...employeeAuthorization, 'idempotency-key': 'notification-employee-all-0001' }), env)
    expect(employeeMarkedAll.status).toBe(200)
    expect(await employeeMarkedAll.json()).toMatchObject({
      version: 4, storeId: 'S01', notificationIds: ['N-STORE'], notifications: [{ id: 'N-STORE' }], updatedCount: 1,
    })
    const employeeNoop = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'notification.mark_all_read', expectedVersion: 4, payload: {},
    }, { ...employeeAuthorization, 'idempotency-key': 'notification-employee-noop-0001' }), env)
    expect(employeeNoop.status).toBe(200)
    expect(await employeeNoop.json()).toMatchObject({ version: 4, notificationIds: [], updatedCount: 0, existing: true })

    const managerOfficeRead = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'notification.mark_all_read', expectedVersion: 4, payload: { storeId: 'OFFICE' },
    }, { ...managerAuthorization, 'idempotency-key': 'notification-manager-office-0001' }), env)
    expect(managerOfficeRead.status).toBe(200)
    expect(await managerOfficeRead.json()).toMatchObject({
      version: 5, storeId: 'OFFICE', notificationIds: ['N-OFFICE'], updatedCount: 1,
    })
    const managerMarkedAll = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'notification.mark_all_read', expectedVersion: 5, payload: {},
    }, { ...managerAuthorization, 'idempotency-key': 'notification-manager-all-0001' }), env)
    expect(managerMarkedAll.status).toBe(200)
    expect(await managerMarkedAll.json()).toMatchObject({
      version: 6,
      storeId: null,
      notificationIds: ['N-E01', 'N-STORE', 'N-E02', 'N-OFFICE-ASSIGNEES'],
      notifications: [{ id: 'N-E01' }, { id: 'N-STORE' }, { id: 'N-E02' }, { id: 'N-OFFICE-ASSIGNEES' }],
      updatedCount: 4,
    })
    const managerOfficeReadNoop = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'notification.mark_read', expectedVersion: 6, payload: { notificationId: 'N-OFFICE' },
    }, { ...managerAuthorization, 'idempotency-key': 'notification-manager-office-read-0001' }), env)
    expect(managerOfficeReadNoop.status).toBe(200)
    expect(await managerOfficeReadNoop.json()).toMatchObject({ version: 6, updatedCount: 0, existing: true })

    const adminClearedOffice = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'notification.clear', expectedVersion: 6, payload: { storeId: 'OFFICE' },
    }, { ...adminAuthorization, 'idempotency-key': 'notification-admin-clear-0001' }), env)
    expect(adminClearedOffice.status).toBe(200)
    expect(await adminClearedOffice.json()).toMatchObject({
      version: 7, command: 'notification.clear', storeId: 'OFFICE', notificationIds: ['N-OFFICE'], updatedCount: 1,
    })
    const adminProjectedForReplace = await worker.fetch(new Request('https://idosi.example/api/state', { headers: adminAuthorization }), env)
    const adminProjectedForReplaceBody = await adminProjectedForReplace.json()
    const adminReplace = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'state.replace', expectedVersion: 7, payload: { state: adminProjectedForReplaceBody.state },
    }, { ...adminAuthorization, 'idempotency-key': 'notification-admin-state-replace-0001' }), env)
    expect(adminReplace.status).toBe(200)
    expect(await adminReplace.json()).toMatchObject({ version: 8 })
    const finalState = readHydratedState(env.DB.database)
    const finalNotifications = Object.fromEntries(finalState.notifications.map((notification) => [notification.id, notification]))
    expect(finalState.notifications.filter(({ readAt }) => readAt).map(({ id }) => id)).toEqual(['N-READ'])
    expect(Object.keys(finalNotifications['N-E01'].readAtByUserId)).toHaveLength(2)
    expect(Object.keys(finalNotifications['N-STORE'].readAtByUserId)).toHaveLength(2)
    expect(Object.keys(finalNotifications['N-E02'].readAtByUserId)).toHaveLength(1)
    expect(Object.keys(finalNotifications['N-OFFICE'].readAtByUserId)).toHaveLength(2)
    expect(Object.keys(finalNotifications['N-OFFICE-IDS'].readAtByUserId)).toHaveLength(1)
    expect(Object.keys(finalNotifications['N-OFFICE-ASSIGNEES'].readAtByUserId)).toHaveLength(1)

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
      { action: 'notification.mark_read' },
      { action: 'notification.mark_all_read' },
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

  it('lets business support create store managers, mutate orders, and complete Admin assignments', async () => {
    const env = { DB: new MemoryD1(), IDENTITY_IMAGES: new MemoryR2(), BOOTSTRAP_TOKEN: 'bootstrap-support-work' }
    const bootstrap = await worker.fetch(jsonRequest('https://idosi.example/api/bootstrap', {
      username: 'admin', password: 'support-work-admin-password',
      initialState: {
        stores: [{ id: 'S01', name: 'IDOSI Tô Ngọc Vân', short: 'TNV', status: 'Đang hoạt động' }],
        employees: [], attendance: [], schedule: [], tasks: [], supportWorkAssignments: [],
        orders: [{
          id: 'ORDER-SUPPORT-01', code: 'S01-00001', storeId: 'S01', employeeId: 'E01',
          amount: 500_000, customerName: 'Khách hàng', paymentMethod: 'Tiền mặt',
          status: 'Hoàn tất', source: 'order', createdAt: '2026-08-18T01:00:00.000Z',
        }],
        orderAudit: [], auditLogs: [], notifications: [], shiftDefinitions: [],
        expenseEntries: [], fixedExpenses: [], cashTransactions: [], importVouchers: [],
        salaryAdjustments: [], salaryAdvances: [], payrollPeriods: [], payrollPayments: [],
      },
    }, { 'x-idosi-bootstrap-token': env.BOOTSTRAP_TOKEN }), env)
    expect(bootstrap.status).toBe(201)
    const adminLogin = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
      username: 'admin', password: 'support-work-admin-password',
    }), env)
    const adminAuthorization = { authorization: `Bearer ${(await adminLogin.json()).token}` }

    const supportCreated = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'employee.create', expectedVersion: 1,
      payload: {
        unit: 'business_support', name: 'Hỗ trợ Kinh doanh', phone: '0901111111',
        cccd: '079123456711', address: 'TP. Hồ Chí Minh', startDate: '2026-08-01',
        employmentType: 'Full-Time', position: 'NV hỗ trợ KD',
        username: 'support.work', password: 'support-work-account-password',
        identityImages: testIdentityImages(),
      },
    }, { ...adminAuthorization, 'idempotency-key': 'support-work-profile-create-0001' }), env)
    expect(supportCreated.status).toBe(201)
    const supportLogin = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
      username: 'support.work', password: 'support-work-account-password',
    }), env)
    const supportAuthorization = { authorization: `Bearer ${(await supportLogin.json()).token}` }

    const managerCreated = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'employee.create', expectedVersion: 2,
      payload: {
        unit: 'store_manager', storeId: 'S01', name: 'Quản lý do Hỗ trợ tạo', phone: '0902222222',
        cccd: '079123456722', address: 'TP. Hồ Chí Minh', startDate: '2026-08-18',
        employmentType: 'Full-Time', position: 'Quản lý cửa hàng',
        username: 'manager.by.support', password: 'manager-by-support-password',
        identityImages: testIdentityImages(),
      },
    }, { ...supportAuthorization, 'idempotency-key': 'support-create-store-manager-0001' }), env)
    expect(managerCreated.status).toBe(201)
    expect(await managerCreated.json()).toMatchObject({
      version: 3,
      employee: {
        id: 'QLCH-001', unit: 'store_manager', storeId: 'S01', employmentType: 'Full-Time',
        baseSalary: 0, salary: 0, payBasis: 'allowance-only', payFormula: 'allowance-bonus-only',
      },
      user: { role: 'store_manager', employeeId: 'QLCH-001', storeId: 'S01' },
    })
    expect(readHydratedState(env.DB.database).employees.find(({ id }) => id === 'QLCH-001')).toMatchObject({
      baseSalary: 0, salary: 0, payBasis: 'allowance-only', payFormula: 'allowance-bonus-only',
    })

    const invalidStoreEmployee = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'employee.create', expectedVersion: 3,
      payload: { unit: 'store', storeId: 'S01', name: 'Thiếu CCCD', phone: '0903333333' },
    }, { ...supportAuthorization, 'idempotency-key': 'support-create-store-employee-invalid-0001' }), env)
    expect(invalidStoreEmployee.status).toBe(400)
    expect(await invalidStoreEmployee.json()).toMatchObject({ error: { code: 'CCCD_INVALID' } })
    const orderUpdated = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'order.update', expectedVersion: 3,
      payload: { orderId: 'ORDER-SUPPORT-01', amount: 600_000, reason: 'Đối soát lại đơn hàng' },
    }, { ...supportAuthorization, 'idempotency-key': 'support-order-update-0001' }), env)
    expect(orderUpdated.status).toBe(200)
    expect(await orderUpdated.json()).toMatchObject({
      version: 4,
      order: { id: 'ORDER-SUPPORT-01', amount: 600_000 },
      audit: { actor: { role: 'business_support' }, reason: 'Đối soát lại đơn hàng' },
    })

    const assigned = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'support_work.assign', expectedVersion: 4,
      payload: {
        date: '2026-08-18', employeeId: 'HTKD-001',
        tasks: [
          { id: 'WORK-01', name: 'Kiểm tra báo cáo', description: 'Đối chiếu doanh thu' },
          { id: 'WORK-02', name: 'Liên hệ cửa hàng', description: 'Xác nhận tồn kho' },
        ],
      },
    }, { ...adminAuthorization, 'idempotency-key': 'support-work-assign-0001' }), env)
    expect(assigned.status).toBe(201)
    const assignedBody = await assigned.json()
    expect(assignedBody).toMatchObject({
      version: 5,
      assignment: { employeeId: 'HTKD-001', totalTasks: 2, completionRate: 0, status: 'assigned' },
      notification: { type: 'support-work-assigned', employeeId: 'HTKD-001', route: '/support/tasks' },
    })
    const assignmentId = assignedBody.assignment.id

    const secondAssigned = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'support_work.assign', expectedVersion: 5,
      payload: {
        date: '2026-08-18', employeeId: 'HTKD-001',
        tasks: [{ id: 'WORK-03', name: 'Kiểm tra cửa hàng', description: 'Ghi nhận hiện trạng' }],
      },
    }, { ...adminAuthorization, 'idempotency-key': 'support-work-assign-same-day-0001' }), env)
    expect(secondAssigned.status).toBe(201)
    const secondAssignedBody = await secondAssigned.json()
    expect(secondAssignedBody).toMatchObject({ version: 6, assignment: { status: 'assigned', totalTasks: 1 } })
    expect(secondAssignedBody.assignment.id).not.toBe(assignmentId)

    const replaced = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'support_work.assign', expectedVersion: 6,
      payload: {
        assignmentId: secondAssignedBody.assignment.id,
        date: '2026-08-18', employeeId: 'HTKD-001',
        tasks: [{ id: 'WORK-03', name: 'Kiểm tra cửa hàng cập nhật', description: 'Chụp và ghi nhận hiện trạng' }],
      },
    }, { ...adminAuthorization, 'idempotency-key': 'support-work-replace-explicit-0001' }), env)
    expect(replaced.status).toBe(200)
    expect(await replaced.json()).toMatchObject({
      version: 7,
      assignment: {
        id: secondAssignedBody.assignment.id,
        history: [
          expect.objectContaining({
            action: 'assigned',
            details: { taskCount: 1, tasks: [expect.objectContaining({ name: 'Kiểm tra cửa hàng' })] },
          }),
          expect.objectContaining({
            action: 'replaced',
            details: {
              taskCount: 1,
              beforeTasks: [expect.objectContaining({ name: 'Kiểm tra cửa hàng' })],
              afterTasks: [expect.objectContaining({ name: 'Kiểm tra cửa hàng cập nhật' })],
            },
          }),
        ],
      },
    })

    const supportStateResponse = await worker.fetch(new Request('https://idosi.example/api/state', {
      headers: supportAuthorization,
    }), env)
    const supportState = (await supportStateResponse.json()).state
    expect(supportState.supportWorkAssignments).toHaveLength(2)
    expect(supportState.supportWorkAssignments).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: assignmentId, employeeId: 'HTKD-001' }),
      expect.objectContaining({ id: secondAssignedBody.assignment.id, employeeId: 'HTKD-001' }),
    ]))
    expect(supportState.orderAudit).toEqual([
      expect.objectContaining({
        orderId: 'ORDER-SUPPORT-01', action: 'Sửa', actor: expect.objectContaining({ role: 'business_support' }),
      }),
    ])
    expect(supportState.notifications).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'support-work-assigned', assignmentId }),
    ]))

    const missingReason = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'support_work.update', expectedVersion: 7,
      payload: { assignmentId, tasks: [{ id: 'WORK-01', completed: true }], submit: true },
    }, { ...supportAuthorization, 'idempotency-key': 'support-work-missing-reason-0001' }), env)
    expect(missingReason.status).toBe(400)
    expect(await missingReason.json()).toMatchObject({ error: { code: 'SUPPORT_WORK_REASON_REQUIRED' } })

    const submitted = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'support_work.update', expectedVersion: 7,
      payload: {
        assignmentId,
        tasks: [{ id: 'WORK-01', completed: true }, { id: 'WORK-02', completed: false }],
        submit: true,
        incompleteReason: 'Cửa hàng chưa phản hồi tồn kho.',
      },
    }, { ...supportAuthorization, 'idempotency-key': 'support-work-submit-0001' }), env)
    expect(submitted.status).toBe(200)
    expect(await submitted.json()).toMatchObject({
      version: 8,
      assignment: {
        id: assignmentId, status: 'incomplete', completedTasks: 1, totalTasks: 2,
        completionRate: 50, incompleteReason: 'Cửa hàng chưa phản hồi tồn kho.',
        submittedAt: expect.any(String),
      },
      notification: { type: 'support-work-submitted', route: '/admin/business-support' },
    })

    const orderDeleted = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'order.delete', expectedVersion: 8,
      payload: { orderId: 'ORDER-SUPPORT-01', reason: 'Đơn hàng nhập trùng' },
    }, { ...supportAuthorization, 'idempotency-key': 'support-order-delete-0001' }), env)
    expect(orderDeleted.status).toBe(200)
    expect(await orderDeleted.json()).toMatchObject({ version: 9, order: { status: 'Đã xóa' } })

    const supportAudit = await worker.fetch(new Request('https://idosi.example/api/audit?limit=100', {
      headers: supportAuthorization,
    }), env)
    expect(supportAudit.status).toBe(200)
    expect((await supportAudit.json()).audit.map(({ action }) => action)).toEqual(['order.delete', 'order.update'])
    const adminState = (await (await worker.fetch(new Request('https://idosi.example/api/state', {
      headers: adminAuthorization,
    }), env)).json()).state
    const completedAssignment = adminState.supportWorkAssignments.find((record) => record.id === assignmentId)
    expect(completedAssignment).toMatchObject({
      id: assignmentId, employeeId: 'HTKD-001', status: 'incomplete', completionRate: 50,
      history: [
        expect.objectContaining({
          action: 'assigned', at: expect.any(String),
          details: {
            taskCount: 2,
            tasks: expect.arrayContaining([
              expect.objectContaining({ id: 'WORK-01', name: 'Kiểm tra báo cáo', description: 'Đối chiếu doanh thu' }),
              expect.objectContaining({ id: 'WORK-02', name: 'Liên hệ cửa hàng', description: 'Xác nhận tồn kho' }),
            ]),
          },
        }),
        expect.objectContaining({ action: 'submitted', at: expect.any(String) }),
      ],
    })
  })

  it('creates complete office accounts with VP hyphen codes and private identity images', async () => {
    const pngBytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01])
    const pngDataUrl = `data:image/png;base64,${Buffer.from(pngBytes).toString('base64')}`
    const env = {
      DB: new MemoryD1(), BOOTSTRAP_TOKEN: 'bootstrap-office-profile', IDENTITY_IMAGES: new MemoryR2(),
    }
    const bootstrap = await worker.fetch(jsonRequest('https://idosi.example/api/bootstrap', {
      username: 'admin', password: 'office-profile-admin-password',
      initialState: {
        stores: [],
        employees: [{
          id: 'VP001', code: 'VP001', storeId: 'OFFICE', unit: 'office',
          name: 'Hồ sơ cũ', phone: '0900000001', status: 'Đang làm việc',
        }],
        attendance: [], orders: [], notifications: [],
      },
    }, { 'x-idosi-bootstrap-token': env.BOOTSTRAP_TOKEN }), env)
    expect(bootstrap.status).toBe(201)
    const login = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
      username: 'admin', password: 'office-profile-admin-password',
    }), env)
    const adminAuthorization = { authorization: `Bearer ${(await login.json()).token}` }

    const invalidCccd = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'employee.create', expectedVersion: 1,
      payload: {
        unit: 'office', storeId: 'OFFICE', name: 'CCCD sai', phone: '0904444444', cccd: '123',
        address: 'TP. Hồ Chí Minh', startDate: '2026-08-18', employmentType: 'Full-Time',
        position: 'Kế Toán', username: 'office.invalid', password: 'office-invalid-password',
      },
    }, { ...adminAuthorization, 'idempotency-key': 'office-invalid-cccd-0001' }), env)
    expect(invalidCccd.status).toBe(400)
    expect(await invalidCccd.json()).toMatchObject({ error: { code: 'CCCD_INVALID' } })

    const missingIdentityImages = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'employee.create', expectedVersion: 1,
      payload: {
        unit: 'office', storeId: 'OFFICE', name: 'Thiếu ảnh CCCD', phone: '0904444444',
        cccd: '079123456744', address: 'TP. Hồ Chí Minh', startDate: '2026-08-18',
        employmentType: 'Full-Time', position: 'Kế Toán',
        username: 'office.missing.images', password: 'office-missing-images-password',
      },
    }, { ...adminAuthorization, 'idempotency-key': 'office-missing-images-0001' }), env)
    expect(missingIdentityImages.status).toBe(400)
    expect(await missingIdentityImages.json()).toMatchObject({ error: { code: 'IDENTITY_IMAGES_REQUIRED' } })

    const physicalStoreOffice = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'employee.create', expectedVersion: 1,
      payload: {
        unit: 'office', storeId: 'S01', name: 'Sai đơn vị', phone: '0904444444',
        cccd: '079123456744', address: 'TP. Hồ Chí Minh', startDate: '2026-08-18',
        employmentType: 'Full-Time', position: 'Kế Toán', identityImages: { front: pngDataUrl, back: pngDataUrl },
        username: 'office.wrong.store', password: 'office-wrong-store-password',
      },
    }, { ...adminAuthorization, 'idempotency-key': 'office-physical-store-denied-0001' }), env)
    expect(physicalStoreOffice.status).toBe(400)
    expect(await physicalStoreOffice.json()).toMatchObject({ error: { code: 'OFFICE_STORE_REQUIRED' } })

    const officeCreated = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'employee.create', expectedVersion: 1,
      payload: {
        unit: 'office', storeId: 'OFFICE', name: 'Nhân viên Kế Toán', phone: '0904444444',
        cccd: '079123456744', address: '12 Đường IDOSI, Phường Hiệp Bình, TP. Hồ Chí Minh',
        addressDetails: { province: 'TP. Hồ Chí Minh', ward: 'Phường Hiệp Bình', street: '12 Đường IDOSI' },
        startDate: '2026-08-18', employmentType: 'Full-Time', position: 'Kế Toán',
        identityImages: { front: pngDataUrl, back: pngDataUrl },
        username: 'office.accounting', password: 'office-accounting-password',
      },
    }, { ...adminAuthorization, 'idempotency-key': 'office-profile-create-0001' }), env)
    expect(officeCreated.status).toBe(201)
    const officeBody = await officeCreated.json()
    expect(officeBody).toMatchObject({
      version: 2,
      employee: {
        id: 'VP-002', code: 'VP-002', unit: 'office', storeId: 'OFFICE',
        employmentType: 'Full-Time', position: 'Kế Toán', cccd: '079123456744',
        addressDetails: { province: 'TP. Hồ Chí Minh', ward: 'Phường Hiệp Bình', street: '12 Đường IDOSI' },
        identityImages: {
          front: { contentType: 'image/png', size: pngBytes.byteLength },
          back: { contentType: 'image/png', size: pngBytes.byteLength },
        },
      },
      user: { role: 'employee', employeeId: 'VP-002', storeId: 'OFFICE' },
    })
    expect(JSON.stringify(officeBody)).not.toContain(pngDataUrl)
    const officeLogin = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
      username: 'office.accounting', password: 'office-accounting-password',
    }), env)
    const officeAuthorization = { authorization: `Bearer ${(await officeLogin.json()).token}` }
    const ownImage = await worker.fetch(new Request('https://idosi.example/api/identity-images/VP-002/front', {
      headers: officeAuthorization,
    }), env)
    expect(ownImage.status).toBe(200)
    expect(ownImage.headers.get('content-type')).toBe('image/png')
    expect(new Uint8Array(await ownImage.arrayBuffer())).toEqual(pngBytes)
  })

  it('lets business support create office and store employees with creator-provided credentials and policy access', async () => {
    const pngBytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01])
    const pngDataUrl = `data:image/png;base64,${Buffer.from(pngBytes).toString('base64')}`
    const env = {
      DB: new MemoryD1(), BOOTSTRAP_TOKEN: 'bootstrap-support-staff-policy', IDENTITY_IMAGES: new MemoryR2(),
    }
    const bootstrap = await worker.fetch(jsonRequest('https://idosi.example/api/bootstrap', {
      username: 'admin', password: 'support-staff-policy-admin-password',
      initialState: {
        stores: [
          { id: 'SM234', name: 'SecondMall SM234', short: 'SM234', status: 'Đang hoạt động' },
          { id: 'S02', name: 'IDOSI Tây Hòa', short: 'TH', status: 'Đang hoạt động' },
        ],
        employees: [], attendance: [], schedule: [], tasks: [], orders: [], notifications: [],
      },
    }, { 'x-idosi-bootstrap-token': env.BOOTSTRAP_TOKEN }), env)
    expect(bootstrap.status).toBe(201)
    const adminLogin = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
      username: 'admin', password: 'support-staff-policy-admin-password',
    }), env)
    const adminAuthorization = { authorization: `Bearer ${(await adminLogin.json()).token}` }

    const supportCreated = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'employee.create', expectedVersion: 1,
      payload: {
        unit: 'business_support', name: 'Hỗ trợ Nhân sự', phone: '0907000001',
        cccd: '079999000010', address: 'TP. Hồ Chí Minh', startDate: '2026-08-18',
        employmentType: 'Full-Time', position: 'NV hỗ trợ KD',
        username: 'support.staff', password: 'support-staff-account-password',
        identityImages: { front: pngDataUrl, back: pngDataUrl },
      },
    }, { ...adminAuthorization, 'idempotency-key': 'support-staff-profile-create-0001' }), env)
    expect(supportCreated.status).toBe(201)
    const managerCreated = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'employee.create', expectedVersion: 2,
      payload: {
        unit: 'store_manager', storeId: 'SM234', name: 'Quản lý SM234', phone: '0907000002',
        cccd: '079999000020', address: 'TP. Hồ Chí Minh', startDate: '2026-08-18',
        employmentType: 'Full-Time', position: 'Quản lý cửa hàng',
        username: 'manager.sm234', password: 'manager-sm234-account-password',
        identityImages: { front: pngDataUrl, back: pngDataUrl },
      },
    }, { ...adminAuthorization, 'idempotency-key': 'support-staff-manager-create-0001' }), env)
    expect(managerCreated.status).toBe(201)
    const supportLogin = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
      username: 'support.staff', password: 'support-staff-account-password',
    }), env)
    const supportAuthorization = { authorization: `Bearer ${(await supportLogin.json()).token}` }
    const managerLogin = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
      username: 'manager.sm234', password: 'manager-sm234-account-password',
    }), env)
    const managerAuthorization = { authorization: `Bearer ${(await managerLogin.json()).token}` }

    const officeCreated = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'employee.create', expectedVersion: 3,
      payload: {
        unit: 'office', storeId: 'OFFICE', name: 'Kế toán do Hỗ trợ tạo', phone: '0907000003',
        cccd: '079999000001', address: '12 Đường IDOSI, TP. Hồ Chí Minh', startDate: '2026-08-18',
        employmentType: 'Thực Tập Sinh', position: 'Kế Toán',
        identityImages: { front: pngDataUrl, back: pngDataUrl },
        username: 'support.office', password: 'support-office-account-password',
      },
    }, { ...supportAuthorization, 'idempotency-key': 'support-office-create-0001' }), env)
    expect(officeCreated.status).toBe(201)
    expect(await officeCreated.json()).toMatchObject({
      version: 4,
      employee: { id: 'VP-001', unit: 'office', position: 'Kế Toán', employmentType: 'Thực Tập Sinh' },
      user: { role: 'employee', employeeId: 'VP-001', storeId: 'OFFICE' },
    })

    const missingImages = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'employee.create', expectedVersion: 4,
      payload: {
        unit: 'store', storeId: 'SM234', name: 'Thiếu ảnh', phone: '0907000099', cccd: '079999999999',
        address: 'TP. Hồ Chí Minh', startDate: '2026-08-18', employmentType: 'Part-Time', hourlyRate: 30_000,
        username: 'missing.images', password: 'missing-images-password',
      },
    }, { ...supportAuthorization, 'idempotency-key': 'support-store-images-required-0001' }), env)
    expect(missingImages.status).toBe(400)
    expect(await missingImages.json()).toMatchObject({ error: { code: 'IDENTITY_IMAGES_REQUIRED' } })

    const firstStoreCommand = {
      type: 'employee.create', expectedVersion: 4,
      payload: {
        id: 'CLIENT-ID-999', code: 'CLIENT-CODE-999', employeeCode: 'CLIENT-EMPLOYEE-999',
        unit: 'store', storeId: 'SM234', name: 'Bến', phone: '0907000004', cccd: '079999123456',
        address: 'TP. Hồ Chí Minh', startDate: '2026-08-18', employmentType: 'Part-Time', hourlyRate: 30_000,
        position: 'Nhân viên bán hàng', identityImages: { front: pngDataUrl, back: pngDataUrl },
        username: 'sm234.ben', password: 'manual-ben-password',
      },
    }
    const firstStoreHeaders = { ...supportAuthorization, 'idempotency-key': 'support-store-ben-create-0001' }
    const firstStoreCreated = await worker.fetch(jsonRequest(
      'https://idosi.example/api/command', firstStoreCommand, firstStoreHeaders,
    ), env)
    expect(firstStoreCreated.status).toBe(201)
    const firstStoreBody = await firstStoreCreated.json()
    expect(firstStoreBody).toMatchObject({
      version: 5,
      employee: {
        id: 'SM234-001', unit: 'store', storeId: 'SM234', cccd: '079999123456',
        startDate: '2026-08-18', position: 'Nhân viên bán hàng', username: 'sm234.ben',
      },
      user: { role: 'employee', employeeId: 'SM234-001', username: 'sm234.ben' },
    })
    expect(firstStoreBody.employee).not.toHaveProperty('password')

    const duplicateNameCreated = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'employee.create', expectedVersion: 5,
      payload: {
        unit: 'store', storeId: 'SM234', name: 'Bến', phone: '0907000005', cccd: '079999654321',
        address: 'TP. Hồ Chí Minh', startDate: '2026-08-18', employmentType: 'Part-Time', hourlyRate: 31_000,
        identityImages: { front: pngDataUrl, back: pngDataUrl },
        username: 'sm234.ben.2', password: 'manual-ben-2-password',
      },
    }, { ...supportAuthorization, 'idempotency-key': 'support-store-ben-duplicate-create-0001' }), env)
    expect(duplicateNameCreated.status).toBe(201)
    expect(await duplicateNameCreated.json()).toMatchObject({
      version: 6,
      employee: { id: 'SM234-002', username: 'sm234.ben.2', position: 'Nhân viên bán hàng' },
    })

    const secondStoreCreated = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'employee.create', expectedVersion: 6,
      payload: {
        unit: 'store', storeId: 'S02', name: 'Anh', phone: '0907000006', cccd: '079999147852',
        address: 'TP. Hồ Chí Minh', startDate: '2026-08-18', employmentType: 'Part-Time', hourlyRate: 32_000,
        identityImages: { front: pngDataUrl, back: pngDataUrl },
        username: 'th.anh', password: 'manual-anh-password',
      },
    }, { ...supportAuthorization, 'idempotency-key': 'support-store-anh-create-0001' }), env)
    expect(secondStoreCreated.status).toBe(201)
    expect(await secondStoreCreated.json()).toMatchObject({
      version: 7,
      employee: { id: 'TH-001', username: 'th.anh' },
    })

    const replayed = await worker.fetch(jsonRequest(
      'https://idosi.example/api/command', firstStoreCommand, firstStoreHeaders,
    ), env)
    expect(replayed.status).toBe(201)
    expect(replayed.headers.get('idempotency-replayed')).toBe('true')
    const replayedBody = await replayed.json()
    expect(replayedBody).toMatchObject({ employee: { id: 'SM234-001' }, user: { username: 'sm234.ben' } })
    expect(replayedBody).not.toHaveProperty('generatedCredentials')

    const policyUpdated = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'policy.set', expectedVersion: 1,
      payload: { key: 'late_tolerance_minutes', value: 17 },
    }, { ...supportAuthorization, 'idempotency-key': 'support-policy-set-0001' }), env)
    expect(policyUpdated.status).toBe(200)
    expect(await policyUpdated.json()).toMatchObject({
      policy: { key: 'late_tolerance_minutes', value: 17, version: 2 },
    })
    const policiesUpdated = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'policies.set',
      payload: { updates: [{ key: 'early_check_in_limit_minutes', value: 100, expectedVersion: 1 }] },
    }, { ...supportAuthorization, 'idempotency-key': 'support-policies-set-0001' }), env)
    expect(policiesUpdated.status).toBe(200)
    expect(await policiesUpdated.json()).toMatchObject({
      policies: [{ key: 'early_check_in_limit_minutes', value: 100, version: 2 }],
    })
    expect(env.DB.database.prepare(`
      SELECT action, actor_role FROM audit_log
      WHERE action IN ('policy.set', 'policies.set') ORDER BY id
    `).all()).toEqual([
      { action: 'policy.set', actor_role: 'business_support' },
      { action: 'policies.set', actor_role: 'business_support' },
    ])

    const employeeUpdatedBySupport = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'employee.update', expectedVersion: 7,
      payload: { employeeId: 'SM234-001', name: 'Bến cập nhật' },
    }, { ...supportAuthorization, 'idempotency-key': 'support-staff-update-allowed-0001' }), env)
    expect(employeeUpdatedBySupport.status).toBe(200)
    expect(await employeeUpdatedBySupport.json()).toMatchObject({
      version: 8, employee: { id: 'SM234-001', name: 'Bến cập nhật' },
    })

    for (const [index, type] of ['employee.delete', 'system.reset_demo'].entries()) {
      const denied = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type, expectedVersion: 8,
        payload: type === 'system.reset_demo'
          ? { state: { stores: [], employees: [] } }
          : { employeeId: 'SM234-001', name: 'Không được sửa' },
      }, { ...supportAuthorization, 'idempotency-key': `support-staff-forbidden-${index}-0001` }), env)
      expect(denied.status, type).toBe(403)
      expect(await denied.json(), type).toMatchObject({ error: { code: 'BUSINESS_SUPPORT_READ_ONLY' } })
    }

    const employeeLogin = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
      username: 'sm234.ben', password: 'manual-ben-password',
    }), env)
    expect(employeeLogin.status).toBe(200)
    const employeeAuthorization = { authorization: `Bearer ${(await employeeLogin.json()).token}` }
    const supportImage = await worker.fetch(new Request(
      'https://idosi.example/api/identity-images/TH-001/front', { headers: supportAuthorization },
    ), env)
    expect(supportImage.status).toBe(200)
    const ownStoreManagerImage = await worker.fetch(new Request(
      'https://idosi.example/api/identity-images/SM234-001/front', { headers: managerAuthorization },
    ), env)
    expect(ownStoreManagerImage.status).toBe(200)
    const crossStoreManagerImage = await worker.fetch(new Request(
      'https://idosi.example/api/identity-images/TH-001/front', { headers: managerAuthorization },
    ), env)
    expect(crossStoreManagerImage.status).toBe(403)
    const ownEmployeeImage = await worker.fetch(new Request(
      'https://idosi.example/api/identity-images/SM234-001/back', { headers: employeeAuthorization },
    ), env)
    expect(ownEmployeeImage.status).toBe(200)
    const crossEmployeeImage = await worker.fetch(new Request(
      'https://idosi.example/api/identity-images/TH-001/back', { headers: employeeAuthorization },
    ), env)
    expect(crossEmployeeImage.status).toBe(403)

    const receipt = env.DB.database.prepare(`
      SELECT response_json FROM command_receipts WHERE idempotency_key = 'support-store-ben-create-0001'
    `).get()
    expect(receipt.response_json).not.toContain('manual-ben-password')
    expect(receipt.response_json).not.toContain('generatedCredentials')
    const rawState = JSON.stringify(readHydratedState(env.DB.database))
    expect(rawState).not.toContain('manual-ben-password')
    expect(rawState).not.toContain('CLIENT-ID-999')
    expect(rawState).not.toContain('CLIENT-CODE-999')
    expect(rawState).not.toContain('CLIENT-EMPLOYEE-999')
    const auditJson = JSON.stringify(env.DB.database.prepare(`
      SELECT before_json, after_json, metadata_json FROM audit_log ORDER BY id
    `).all())
    expect(auditJson).not.toContain('manual-ben-password')
  })

  it('proxies authenticated Vietnamese address suggestions without exposing the Google key', async () => {
    const env = { DB: new MemoryD1(), BOOTSTRAP_TOKEN: 'bootstrap-address-suggestions' }
    const bootstrap = await worker.fetch(jsonRequest('https://idosi.example/api/bootstrap', {
      username: 'admin', password: 'address-suggestions-admin-password',
      initialState: { stores: [], employees: [] },
    }, { 'x-idosi-bootstrap-token': env.BOOTSTRAP_TOKEN }), env)
    expect(bootstrap.status).toBe(201)
    const login = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
      username: 'admin', password: 'address-suggestions-admin-password',
    }), env)
    const authorization = { authorization: `Bearer ${(await login.json()).token}` }
    const unavailable = await worker.fetch(new Request(
      'https://idosi.example/api/address-suggestions?type=province&query=ho', { headers: authorization },
    ), env)
    expect(unavailable.status).toBe(200)
    expect(await unavailable.json()).toMatchObject({ configured: false, suggestions: [] })

    const upstreamFetch = vi.fn(async () => new Response(JSON.stringify({
      suggestions: [{
        placePrediction: {
          placeId: 'place-hcm', text: { text: 'Thành phố Hồ Chí Minh, Việt Nam' },
          structuredFormat: {
            mainText: { text: 'Thành phố Hồ Chí Minh' }, secondaryText: { text: 'Việt Nam' },
          },
        },
      }],
    }), { status: 200, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', upstreamFetch)
    try {
      env.GOOGLE_MAPS_API_KEY = 'google-maps-test-key-never-return'
      const suggested = await worker.fetch(new Request(
        'https://idosi.example/api/address-suggestions?type=ward&query=hiep&province=TP.%20Ho%20Chi%20Minh',
        { headers: authorization },
      ), env)
      expect(suggested.status).toBe(200)
      const suggestedBody = await suggested.json()
      expect(suggestedBody).toMatchObject({
        configured: true,
        suggestions: [{
          label: 'Thành phố Hồ Chí Minh, Việt Nam', value: 'Thành phố Hồ Chí Minh',
          placeId: 'place-hcm', province: 'TP. Ho Chi Minh', ward: 'Thành phố Hồ Chí Minh',
        }],
      })
      expect(JSON.stringify(suggestedBody)).not.toContain(env.GOOGLE_MAPS_API_KEY)
      expect(upstreamFetch).toHaveBeenCalledWith(
        'https://places.googleapis.com/v1/places:autocomplete',
        expect.objectContaining({ method: 'POST' }),
      )
      const upstreamOptions = upstreamFetch.mock.calls[0][1]
      expect(upstreamOptions.headers['X-Goog-Api-Key']).toBe(env.GOOGLE_MAPS_API_KEY)
      expect(upstreamOptions.headers['X-Goog-FieldMask']).toContain('suggestions.placePrediction.placeId')
      expect(JSON.parse(upstreamOptions.body)).toMatchObject({
        input: 'hiep, TP. Ho Chi Minh, Việt Nam', languageCode: 'vi', regionCode: 'vn',
        includedRegionCodes: ['vn'],
      })

      for (let index = 1; index < 30; index += 1) {
        const response = await worker.fetch(new Request(
          `https://idosi.example/api/address-suggestions?type=province&query=ho${index}`,
          { headers: authorization },
        ), env)
        expect(response.status).toBe(200)
      }
      const limited = await worker.fetch(new Request(
        'https://idosi.example/api/address-suggestions?type=province&query=limit',
        { headers: authorization },
      ), env)
      expect(limited.status).toBe(429)
      expect(await limited.json()).toMatchObject({ error: { code: 'ADDRESS_SUGGESTION_RATE_LIMITED' } })
      expect(upstreamFetch).toHaveBeenCalledTimes(30)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('restores the latest order edit atomically and reconciles shift revenue', async () => {
    const env = { DB: new MemoryD1(), BOOTSTRAP_TOKEN: 'bootstrap-order-operational-reset' }
    const bootstrap = await worker.fetch(jsonRequest('https://idosi.example/api/bootstrap', {
      username: 'admin', password: 'order-operational-reset-admin-password',
      initialState: {
        stores: [{ id: 'S01', name: 'Cửa hàng 01', short: 'S01' }],
        employees: [
          { id: 'E01', name: 'Nhân viên 01', storeId: 'S01', unit: 'store' },
          { id: 'HTKD-RESET', name: 'Hỗ trợ KD', storeId: 'BUSINESS_SUPPORT', unit: 'business_support' },
        ],
        attendance: [{
          id: 'ATT-ORDER-01', employeeId: 'E01', storeId: 'S01', shiftId: 'SHIFT-01',
          date: '2026-08-18', checkInAt: '2026-08-18T01:00:00.000Z', checkOutAt: '2026-08-18T10:00:00.000Z',
          revenue: 100_000, cash: 100_000, transfer: 0, orderCount: 1,
        }],
        orders: [{
          id: 'ORDER-RESET-01', code: 'S01-00001', storeId: 'S01', employeeId: 'E01', attendanceId: 'ATT-ORDER-01',
          amount: 100_000, customerName: 'Khách', paymentMethod: 'Tiền mặt', status: 'Hoàn tất', source: 'order',
          createdAt: '2026-08-18T02:00:00.000Z', updatedAt: '2026-08-18T02:00:00.000Z', deletedAt: null,
        }],
        orderAudit: [], attendanceAudit: [], operationalResetHistory: [],
        payrollPeriods: [{ id: 'PAY-CLOSED', storeId: 'S01', period: '2026-08', status: 'Đã chốt', needsReclose: false }],
      },
    }, { 'x-idosi-bootstrap-token': env.BOOTSTRAP_TOKEN }), env)
    expect(bootstrap.status).toBe(201)
    const adminLogin = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
      username: 'admin', password: 'order-operational-reset-admin-password',
    }), env)
    const adminAuthorization = { authorization: `Bearer ${(await adminLogin.json()).token}` }
    const supportUser = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'user.create', expectedVersion: 0,
      payload: {
        role: 'business_support', employeeId: 'HTKD-RESET', username: 'support.reset',
        password: 'support-reset-password', displayName: 'Hỗ trợ KD',
      },
    }, { ...adminAuthorization, 'idempotency-key': 'support-reset-user-create-0001' }), env)
    expect(supportUser.status).toBe(201)
    const supportLogin = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
      username: 'support.reset', password: 'support-reset-password',
    }), env)
    const supportAuthorization = { authorization: `Bearer ${(await supportLogin.json()).token}` }

    const updated = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'order.update', expectedVersion: 1,
      payload: { orderId: 'ORDER-RESET-01', amount: 250_000, reason: 'Đối soát doanh thu' },
    }, { ...supportAuthorization, 'idempotency-key': 'order-before-operational-reset-0001' }), env)
    expect(updated.status).toBe(200)
    expect(await updated.json()).toMatchObject({ version: 2, order: { amount: 250_000 } })
    let state = readHydratedState(env.DB.database)
    expect(state.attendance[0]).toMatchObject({ revenue: 250_000, cash: 250_000, transfer: 0, orderCount: 1 })
    expect(state.payrollPeriods[0]).toMatchObject({ needsReclose: true, invalidationReason: 'order.update' })

    const resetCommand = {
      type: 'operational_reset.restore', expectedVersion: 2,
      payload: {
        dataType: 'orders', storeId: 'S01', employeeId: 'E01',
        fromDate: '2026-08-18', toDate: '2026-08-18', reason: 'Hoàn tác lần sửa gần nhất',
      },
    }
    const restored = await worker.fetch(jsonRequest('https://idosi.example/api/command', resetCommand, {
      ...supportAuthorization, 'idempotency-key': 'order-operational-reset-0001',
    }), env)
    expect(restored.status).toBe(200)
    const restoredBody = await restored.json()
    expect(restoredBody).toMatchObject({
      version: 3, restoredCount: 1, restoredIds: ['ORDER-RESET-01'],
      reset: { dataType: 'orders', storeId: 'S01', employeeId: 'E01', restoredCount: 1 },
      restored: [{ id: 'ORDER-RESET-01', amount: 100_000, status: 'Hoàn tất', deletedAt: null }],
    })
    const replay = await worker.fetch(jsonRequest('https://idosi.example/api/command', resetCommand, {
      ...supportAuthorization, 'idempotency-key': 'order-operational-reset-0001',
    }), env)
    expect(replay.status).toBe(200)
    expect(replay.headers.get('idempotency-replayed')).toBe('true')
    expect(await replay.json()).toEqual(restoredBody)

    state = readHydratedState(env.DB.database)
    expect(state.orders[0]).toMatchObject({ id: 'ORDER-RESET-01', amount: 100_000, restoredAt: expect.any(String) })
    expect(state.attendance[0]).toMatchObject({ revenue: 100_000, cash: 100_000, transfer: 0, orderCount: 1 })
    expect(state.orderAudit).toEqual(expect.arrayContaining([
      expect.objectContaining({
        action: 'Khôi phục', orderId: 'ORDER-RESET-01', changedFields: ['amount'],
        revenueBefore: 250_000, revenueAfter: 100_000,
      }),
      expect.objectContaining({ action: 'Sửa', orderId: 'ORDER-RESET-01', restoredAt: expect.any(String) }),
    ]))
    expect(state.operationalResetHistory[0]).toMatchObject({
      dataType: 'orders', restoredCount: 1, restoredIds: ['ORDER-RESET-01'], createdBy: { role: 'business_support' },
    })
    expect(state.stores).toHaveLength(1)
    expect(state.employees).toHaveLength(2)
    expect(state.payrollPeriods).toHaveLength(1)
    const audit = env.DB.database.prepare("SELECT actor_role, entity_type, metadata_json FROM audit_log WHERE action = 'operational_reset.restore'").get()
    expect(audit).toMatchObject({ actor_role: 'business_support', entity_type: 'operational-reset' })
    expect(JSON.parse(audit.metadata_json)).toMatchObject({ dataType: 'orders', restoredCount: 1 })
    const protectedHistoryMutation = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'state.merge', expectedVersion: 3, payload: { patch: { attendanceAudit: [], operationalResetHistory: [] } },
    }, { ...adminAuthorization, 'idempotency-key': 'operational-history-raw-mutation-denied-0001' }), env)
    expect(protectedHistoryMutation.status).toBe(400)
    expect(await protectedHistoryMutation.json()).toMatchObject({ error: { code: 'DOMAIN_COMMAND_REQUIRED' } })
  })

  it('blocks paid order mutations and stale operational restore snapshots', async () => {
    const env = { DB: new MemoryD1(), BOOTSTRAP_TOKEN: 'bootstrap-paid-order-stale-reset' }
    const staleBefore = {
      id: 'ORDER-STALE', code: 'S02-00001', storeId: 'S02', employeeId: 'E02', amount: 50_000,
      customerName: 'Khách', paymentMethod: 'Tiền mặt', status: 'Hoàn tất', source: 'order',
      createdAt: '2026-08-18T02:00:00.000Z', updatedAt: '2026-08-18T02:00:00.000Z', deletedAt: null,
    }
    const staleAfter = { ...staleBefore, amount: 75_000, updatedAt: '2026-08-18T03:00:00.000Z' }
    const bootstrap = await worker.fetch(jsonRequest('https://idosi.example/api/bootstrap', {
      username: 'admin', password: 'paid-order-admin-password',
      initialState: {
        stores: [{ id: 'S01', name: 'Cửa hàng 01' }, { id: 'S02', name: 'Cửa hàng 02' }],
        employees: [
          { id: 'E01', name: 'Nhân viên 01', storeId: 'S01', unit: 'store' },
          { id: 'E02', name: 'Nhân viên 02', storeId: 'S02', unit: 'store' },
          { id: 'HTKD-LOCK', name: 'Hỗ trợ KD', storeId: 'BUSINESS_SUPPORT', unit: 'business_support' },
        ],
        orders: [{
          id: 'ORDER-PAID', code: 'S01-00001', storeId: 'S01', employeeId: 'E01', amount: 100_000,
          customerName: 'Khách', paymentMethod: 'Tiền mặt', status: 'Hoàn tất', source: 'order',
          createdAt: '2026-08-18T02:00:00.000Z', deletedAt: null,
        }, { ...staleBefore, amount: 90_000 }],
        orderAudit: [{
          id: 'AUDIT-STALE', action: 'Sửa', orderId: 'ORDER-STALE', storeId: 'S02',
          before: staleBefore, after: staleAfter, createdAt: '2026-08-18T03:00:00.000Z',
        }],
        payrollPeriods: [{
          id: 'PAY-PAID', storeId: 'S01', period: '2026-08', status: 'Đã chi',
          confirmedAt: '2026-08-31T00:00:00.000Z',
        }],
      },
    }, { 'x-idosi-bootstrap-token': env.BOOTSTRAP_TOKEN }), env)
    expect(bootstrap.status).toBe(201)
    const adminLogin = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
      username: 'admin', password: 'paid-order-admin-password',
    }), env)
    const adminAuthorization = { authorization: `Bearer ${(await adminLogin.json()).token}` }
    const supportUser = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'user.create', expectedVersion: 0,
      payload: {
        role: 'business_support', employeeId: 'HTKD-LOCK', username: 'support.lock',
        password: 'support-lock-password', displayName: 'Hỗ trợ KD',
      },
    }, { ...adminAuthorization, 'idempotency-key': 'support-lock-user-create-0001' }), env)
    expect(supportUser.status).toBe(201)
    const supportLogin = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
      username: 'support.lock', password: 'support-lock-password',
    }), env)
    const supportAuthorization = { authorization: `Bearer ${(await supportLogin.json()).token}` }

    for (const [index, authorization] of [supportAuthorization, adminAuthorization].entries()) {
      const denied = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'order.update', expectedVersion: 1,
        payload: { orderId: 'ORDER-PAID', amount: 200_000, reason: 'Kỳ đã chi' },
      }, { ...authorization, 'idempotency-key': `paid-order-update-denied-${index}` }), env)
      expect(denied.status).toBe(409)
      expect(await denied.json()).toMatchObject({ error: { code: 'PAYROLL_PERIOD_PAID' } })
    }
    const deleteDenied = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'order.delete', expectedVersion: 1,
      payload: { orderId: 'ORDER-PAID', reason: 'Kỳ đã chi' },
    }, { ...supportAuthorization, 'idempotency-key': 'paid-order-delete-denied-0001' }), env)
    expect(deleteDenied.status).toBe(409)
    expect(await deleteDenied.json()).toMatchObject({ error: { code: 'PAYROLL_PERIOD_PAID' } })

    const staleReset = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'operational_reset.restore', expectedVersion: 1,
      payload: {
        dataType: 'orders', storeId: 'S02', employeeId: 'E02', fromDate: '2026-08-18', toDate: '2026-08-18',
        reason: 'Không được ghi đè thay đổi mới',
      },
    }, { ...supportAuthorization, 'idempotency-key': 'stale-order-reset-denied-0001' }), env)
    expect(staleReset.status).toBe(409)
    expect(await staleReset.json()).toMatchObject({ error: { code: 'OPERATIONAL_RESET_STALE_AUDIT' } })
    expect(env.DB.database.prepare("SELECT version FROM app_state WHERE scope_key = 'global'").get()).toEqual({ version: 1 })
  })

  it('resets all runtime data in two phases, verifies paginated R2 cleanup, and keeps only Admin access', async () => {
    const bucket = new MemoryR2()
    bucket.pageSize = 1
    const env = {
      DB: new MemoryD1(), IDENTITY_IMAGES: bucket, BOOTSTRAP_TOKEN: 'bootstrap-reset-all-runtime',
    }
    const bootstrap = await worker.fetch(jsonRequest('https://idosi.example/api/bootstrap', {
      username: 'admin', password: 'reset-all-runtime-admin-password',
      initialState: {
        schemaVersion: 2,
        stores: [{ id: 'S01', name: 'IDOSI Tô Ngọc Vân', short: 'TNV' }],
        employees: [], attendance: [{ id: 'ATT-LEGACY', employeeId: 'OLD-01', storeId: 'S01' }],
        orders: [{ id: 'ORDER-LEGACY', storeId: 'S01', amount: 100_000 }],
      },
    }, { 'x-idosi-bootstrap-token': env.BOOTSTRAP_TOKEN }), env)
    expect(bootstrap.status).toBe(201)
    const firstAdminLogin = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
      username: 'admin', password: 'reset-all-runtime-admin-password',
    }), env)
    const firstAdminAuthorization = { authorization: `Bearer ${(await firstAdminLogin.json()).token}` }
    const currentAdminLogin = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
      username: 'admin', password: 'reset-all-runtime-admin-password',
    }), env)
    const currentAdminLoginBody = await currentAdminLogin.json()
    const currentAdminAuthorization = { authorization: `Bearer ${currentAdminLoginBody.token}` }
    const adminId = currentAdminLoginBody.user.id
    const secondAdminId = 'admin-reset-secondary'
    const secondAdminPassword = await hashPassword('reset-secondary-admin-password')
    env.DB.database.prepare(`
      INSERT INTO users (
        id, username, username_normalized, display_name, password_hash, password_salt,
        password_iterations, password_algorithm, role, status, version,
        password_updated_at, created_at, updated_at
      ) VALUES (?, 'admin.secondary', 'admin.secondary', 'Admin phụ', ?, ?, ?, ?, 'admin', 'active', 1, ?, ?, ?)
    `).run(
      secondAdminId,
      secondAdminPassword.hash,
      secondAdminPassword.salt,
      secondAdminPassword.iterations,
      secondAdminPassword.algorithm,
      '2026-08-18T00:00:00.000Z',
      '2026-08-18T00:00:00.000Z',
      '2026-08-18T00:00:00.000Z',
    )
    const secondAdminLogin = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
      username: 'admin.secondary', password: 'reset-secondary-admin-password',
    }), env)
    expect(secondAdminLogin.status).toBe(200)
    const secondAdminAuthorization = { authorization: `Bearer ${(await secondAdminLogin.json()).token}` }
    const pngBytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01])
    const pngDataUrl = `data:image/png;base64,${Buffer.from(pngBytes).toString('base64')}`

    const managerCreated = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'employee.create', expectedVersion: 1,
      payload: {
        unit: 'store_manager', storeId: 'S01', name: 'Quản lý sẽ bị xóa', phone: '0909000001',
        cccd: '079999900001', address: 'TP. Hồ Chí Minh', startDate: '2026-08-18',
        employmentType: 'Full-Time', position: 'Quản lý cửa hàng',
        baseSalary: 15_000_000, standardWorkDays: 26, requiredMonthlyHours: 208,
        identityImages: { front: pngDataUrl, back: pngDataUrl },
        username: 'manager.reset.all', password: 'manager-reset-all-password',
      },
    }, { ...currentAdminAuthorization, 'idempotency-key': 'reset-all-manager-create-0001' }), env)
    expect(managerCreated.status).toBe(201)
    const managerLogin = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
      username: 'manager.reset.all', password: 'manager-reset-all-password',
    }), env)
    const managerAuthorization = { authorization: `Bearer ${(await managerLogin.json()).token}` }
    const settingsUpdated = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'account_settings.update', expectedVersion: 2,
      payload: { name: 'Admin được giữ lại', email: 'admin@idosi.vn', notifications: { tasks: false } },
    }, { ...currentAdminAuthorization, 'idempotency-key': 'reset-all-admin-settings-0001' }), env)
    expect(settingsUpdated.status).toBe(200)

    env.DB.database.prepare(`
      INSERT INTO app_state (scope_key, value_json, version, updated_at, updated_by, last_request_id)
      VALUES ('private:reset-fixture', '{"secretBusinessState":true}', 1, ?, ?, 'fixture-private-state')
    `).run('2026-08-18T00:00:00.000Z', adminId)
    env.DB.database.prepare(`
      INSERT INTO state_collections (scope_key, collection_key, created_at, updated_at)
      VALUES ('private:reset-fixture', 'privateRecords', ?, ?)
    `).run('2026-08-18T00:00:00.000Z', '2026-08-18T00:00:00.000Z')
    const orphanKey = 'identity-images/orphan/front/orphan.png'
    await bucket.put(orphanKey, pngBytes)
    await bucket.put('other-prefix/must-survive.png', pngBytes)

    const missingConfirmation = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'system.reset_all', expectedVersion: 3, payload: { confirmation: 'RESET' },
    }, { ...currentAdminAuthorization, 'idempotency-key': 'reset-all-confirmation-invalid-0001' }), env)
    expect(missingConfirmation.status).toBe(400)
    expect(await missingConfirmation.json()).toMatchObject({ error: { code: 'RESET_CONFIRMATION_REQUIRED' } })
    const managerDenied = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'system.reset_all', expectedVersion: 3, payload: { confirmation: 'RESET_ALL_DATA' },
    }, { ...managerAuthorization, 'idempotency-key': 'reset-all-manager-denied-0001' }), env)
    expect(managerDenied.status).toBe(403)
    expect(await managerDenied.json()).toMatchObject({ error: { code: 'ROLE_FORBIDDEN' } })

    const resetCommand = {
      type: 'system.reset_all', expectedVersion: 3, payload: { confirmation: 'RESET_ALL_DATA' },
    }
    const resetHeaders = { ...currentAdminAuthorization, 'idempotency-key': 'reset-all-runtime-0001' }
    bucket.failDeleteKeys.add(orphanKey)
    const cleanupPending = await worker.fetch(jsonRequest(
      'https://idosi.example/api/command', resetCommand, resetHeaders,
    ), env)
    expect(cleanupPending.status).toBe(503)
    expect(await cleanupPending.json()).toMatchObject({ error: { code: 'RESET_CLEANUP_PENDING' } })
    expect(env.DB.database.prepare("SELECT version FROM app_state WHERE scope_key = 'global'").get()).toEqual({ version: 4 })
    expect(env.DB.database.prepare('SELECT meta_key FROM system_metadata WHERE meta_key = ?').get(
      'system:reset_all_pending',
    )).toEqual({ meta_key: 'system:reset_all_pending' })
    expect(env.DB.database.prepare('SELECT id, role FROM users ORDER BY id').all()).toEqual([{ id: adminId, role: 'admin' }])
    expect(env.DB.database.prepare('SELECT COUNT(*) AS count FROM sessions').get()).toEqual({ count: 1 })
    expect(env.DB.database.prepare('SELECT COUNT(*) AS count FROM audit_log').get()).toEqual({ count: 0 })
    expect(env.DB.database.prepare('SELECT COUNT(*) AS count FROM command_receipts').get()).toEqual({ count: 0 })
    expect((await worker.fetch(new Request('https://idosi.example/api/state', {
      headers: currentAdminAuthorization,
    }), env)).status).toBe(200)
    expect((await worker.fetch(new Request('https://idosi.example/api/state', {
      headers: firstAdminAuthorization,
    }), env)).status).toBe(401)
    expect((await worker.fetch(new Request('https://idosi.example/api/state', {
      headers: secondAdminAuthorization,
    }), env)).status).toBe(401)
    expect((await worker.fetch(new Request('https://idosi.example/api/state', {
      headers: managerAuthorization,
    }), env)).status).toBe(401)
    const mutationBlocked = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'state.merge', expectedVersion: 4, payload: { patch: { forbiddenDuringCleanup: true } },
    }, { ...currentAdminAuthorization, 'idempotency-key': 'reset-all-mutation-blocked-0001' }), env)
    expect(mutationBlocked.status).toBe(503)
    expect(await mutationBlocked.json()).toMatchObject({ error: { code: 'RESET_CLEANUP_PENDING' } })
    const logoutBlocked = await worker.fetch(jsonRequest(
      'https://idosi.example/api/logout', {}, currentAdminAuthorization,
    ), env)
    expect(logoutBlocked.status).toBe(503)

    bucket.failDeleteKeys.delete(orphanKey)
    const recoveryCommand = {
      type: 'system.reset_all', expectedVersion: 4, payload: { confirmation: 'RESET_ALL_DATA' },
    }
    const recoveryHeaders = { ...currentAdminAuthorization, 'idempotency-key': 'reset-all-runtime-recovery-0001' }
    const resetCompleted = await worker.fetch(jsonRequest(
      'https://idosi.example/api/command', recoveryCommand, recoveryHeaders,
    ), env)
    expect(resetCompleted.status).toBe(200)
    const completedBody = await resetCompleted.json()
    expect(completedBody).toMatchObject({
      ok: true,
      command: 'system.reset_all',
      version: 4,
      reset: {
        purged: {
          accounts: 2,
          otherAdminAccounts: 1,
          nonAdminAccounts: 1,
          sessions: 3,
          commandReceipts: 2,
          privateStateScopes: 1,
          identityImageObjectsTargeted: 3,
        },
        preservedAdminAccountIds: [adminId],
        preservedCurrentAdminSession: true,
        preservedAdminAccountSettings: [adminId],
        defaultPolicyCount: 8,
        identityImagePrefix: 'identity-images/',
        identityImageStorageVerifiedEmpty: true,
      },
      state: { stores: [], employees: [], attendance: [], orders: [] },
    })
    const replay = await worker.fetch(jsonRequest(
      'https://idosi.example/api/command', resetCommand, resetHeaders,
    ), env)
    expect(replay.status).toBe(200)
    expect(replay.headers.get('idempotency-replayed')).toBe('true')
    expect(await replay.json()).toEqual(completedBody)

    expect(env.DB.database.prepare('SELECT meta_key FROM system_metadata WHERE meta_key = ?').get(
      'system:reset_all_pending',
    )).toBeUndefined()
    expect(env.DB.database.prepare('SELECT action, actor_id FROM audit_log').all()).toEqual([
      { action: 'system.reset_all', actor_id: adminId },
    ])
    expect(env.DB.database.prepare('SELECT actor_id, idempotency_key FROM command_receipts').all()).toEqual([
      { actor_id: adminId, idempotency_key: 'reset-all-runtime-0001' },
    ])
    expect(env.DB.database.prepare('SELECT COUNT(*) AS count FROM command_receipt_chunks').get()).toEqual({ count: 0 })
    expect(env.DB.database.prepare('SELECT COUNT(*) AS count FROM state_entities').get()).toEqual({ count: 0 })
    expect(env.DB.database.prepare('SELECT scope_key FROM app_state ORDER BY scope_key').all()).toEqual([{ scope_key: 'global' }])
    expect(env.DB.database.prepare('SELECT COUNT(*) AS count FROM counters').get()).toEqual({ count: 0 })
    expect(env.DB.database.prepare('SELECT policy_key, version FROM policies ORDER BY policy_key').all()).toEqual(
      Object.keys({
        attendance_improve_min_late_count: 1,
        attendance_improve_min_late_minutes: 1,
        attendance_maintain_max_late_count: 1,
        early_check_in_limit_minutes: 1,
        employee_kpi_percent_15000: 1,
        employee_kpi_percent_30000: 1,
        employee_kpi_percent_7000: 1,
        late_tolerance_minutes: 1,
      }).sort().map((policy_key) => ({ policy_key, version: 1 })),
    )
    const resetState = readHydratedState(env.DB.database)
    for (const key of [
      'stores', 'employees', 'attendance', 'orders', 'orderAudit', 'notifications',
      'expenseEntries', 'payrollPeriods', 'supportTransfers', 'supportWorkAssignments',
    ]) expect(resetState[key]).toEqual([])
    expect(resetState.accountSettings[adminId]).toMatchObject({
      name: 'Admin được giữ lại', email: 'admin@idosi.vn', notifications: { tasks: false },
    })
    expect([...bucket.objects.keys()]).toEqual(['other-prefix/must-survive.png'])
    expect(bucket.deletedKeys).toEqual(expect.arrayContaining([
      orphanKey,
      expect.stringMatching(/^identity-images\/QLCH-001\/front\//u),
      expect.stringMatching(/^identity-images\/QLCH-001\/back\//u),
    ]))
    expect(env.DB.database.prepare('PRAGMA foreign_key_check').all()).toEqual([])
  })

  it('rejects an unsafe repeated R2 pagination cursor before mutating D1', async () => {
    const bucket = new MemoryR2()
    bucket.pageSize = 1
    bucket.repeatCursor = true
    const pngBytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    for (const key of [
      'identity-images/orphan-a/front/a.png',
      'identity-images/orphan-b/front/b.png',
      'identity-images/orphan-c/front/c.png',
    ]) await bucket.put(key, pngBytes)
    const env = {
      DB: new MemoryD1(), IDENTITY_IMAGES: bucket, BOOTSTRAP_TOKEN: 'bootstrap-reset-repeated-cursor',
    }
    await worker.fetch(jsonRequest('https://idosi.example/api/bootstrap', {
      username: 'admin', password: 'reset-repeated-cursor-admin-password',
      initialState: { stores: [{ id: 'S01', name: 'Store must remain' }], employees: [] },
    }, { 'x-idosi-bootstrap-token': env.BOOTSTRAP_TOKEN }), env)
    const login = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
      username: 'admin', password: 'reset-repeated-cursor-admin-password',
    }), env)
    const authorization = { authorization: `Bearer ${(await login.json()).token}` }
    const denied = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'system.reset_all', expectedVersion: 1, payload: { confirmation: 'RESET_ALL_DATA' },
    }, { ...authorization, 'idempotency-key': 'reset-repeated-cursor-0001' }), env)
    expect(denied.status).toBe(503)
    expect(await denied.json()).toMatchObject({ error: { code: 'IDENTITY_IMAGE_LIST_FAILED' } })
    expect(env.DB.database.prepare("SELECT version FROM app_state WHERE scope_key = 'global'").get()).toEqual({ version: 1 })
    expect(readHydratedState(env.DB.database).stores).toEqual([{ id: 'S01', name: 'Store must remain' }])
    expect(env.DB.database.prepare('SELECT meta_key FROM system_metadata WHERE meta_key = ?').get(
      'system:reset_all_pending',
    )).toBeUndefined()
    expect(bucket.objects.size).toBe(3)
    expect(env.DB.database.prepare('PRAGMA foreign_key_check').all()).toEqual([])
  })

  it('promotes an existing store employee to a dual store-manager role without manager salary', async () => {
    const env = {
      DB: new MemoryD1(), IDENTITY_IMAGES: new MemoryR2(), BOOTSTRAP_TOKEN: 'bootstrap-store-manager-promotion',
    }
    const bootstrap = await worker.fetch(jsonRequest('https://idosi.example/api/bootstrap', {
      username: 'admin', password: 'store-manager-promotion-admin-password',
      initialState: {
        stores: [{ id: 'S01', name: 'Dosii Tô Ngọc Vân', short: 'TNV' }],
        employees: [], attendance: [], payrollPeriods: [],
      },
    }, { 'x-idosi-bootstrap-token': env.BOOTSTRAP_TOKEN }), env)
    expect(bootstrap.status).toBe(201)
    const adminLogin = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
      username: 'admin', password: 'store-manager-promotion-admin-password',
    }), env)
    const authorization = { authorization: `Bearer ${(await adminLogin.json()).token}` }

    const storeEmployeeCreated = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'employee.create', expectedVersion: 1,
      payload: {
        unit: 'store', storeId: 'S01', name: 'Nhân viên kiêm quản lý', phone: '0908000001',
        cccd: '079888000001', address: 'TP. Hồ Chí Minh', startDate: '2026-08-18',
        employmentType: 'Full-Time', position: 'Nhân viên bán hàng', baseSalary: 9_000_000,
        standardWorkDays: 26, requiredMonthlyHours: 208,
        username: 'dual.manager', password: 'dual-manager-password', identityImages: testIdentityImages(),
      },
    }, { ...authorization, 'idempotency-key': 'dual-store-employee-create-0001' }), env)
    expect(storeEmployeeCreated.status).toBe(201)
    const storeEmployeeBody = await storeEmployeeCreated.json()
    expect(storeEmployeeBody).toMatchObject({
      version: 2,
      employee: {
        id: 'DOSII-TNV-001', unit: 'store', baseSalary: 9_000_000,
      },
      user: { role: 'employee', employeeId: 'DOSII-TNV-001' },
    })

    const employeeLogin = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
      username: 'dual.manager', password: 'dual-manager-password',
    }), env)
    expect(employeeLogin.status).toBe(200)
    const employeeToken = (await employeeLogin.json()).token

    const promoted = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'employee.create', expectedVersion: 2,
      payload: {
        unit: 'store_manager', storeId: 'S01', linkedEmployeeId: 'DOSII-TNV-001',
      },
    }, { ...authorization, 'idempotency-key': 'dual-store-manager-promote-0001' }), env)
    expect(promoted.status).toBe(201)
    expect(await promoted.json()).toMatchObject({
      version: 3,
      employee: {
        id: 'QLCH-001', linkedEmployeeId: 'DOSII-TNV-001', baseSalary: 0, salary: 0,
        payBasis: 'allowance-only', salaryUnit: 'none', payFormula: 'allowance-bonus-only',
      },
      user: { role: 'store_manager', employeeId: 'DOSII-TNV-001', storeId: 'S01' },
    })

    const staleEmployeeSession = await worker.fetch(new Request('https://idosi.example/api/state', {
      headers: { authorization: `Bearer ${employeeToken}` },
    }), env)
    expect(staleEmployeeSession.status).toBe(401)
    const managerLogin = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
      username: 'dual.manager', password: 'dual-manager-password',
    }), env)
    expect(managerLogin.status).toBe(200)
    expect(await managerLogin.clone().json()).toMatchObject({
      user: { role: 'store_manager', employeeId: 'DOSII-TNV-001', storeId: 'S01' },
    })
    const managerProjection = await worker.fetch(new Request('https://idosi.example/api/state', {
      headers: { authorization: `Bearer ${(await managerLogin.json()).token}` },
    }), env)
    const managerState = (await managerProjection.json()).state
    expect(managerState.employees.find(({ id }) => id === 'DOSII-TNV-001')).toMatchObject({
      unit: 'store', baseSalary: 9_000_000,
    })
    const rawProfiles = readHydratedState(env.DB.database).employees
    expect(rawProfiles.find(({ id }) => id === 'QLCH-001')).toMatchObject({
      linkedEmployeeId: 'DOSII-TNV-001', baseSalary: 0, salaryUnit: 'none',
    })
    expect(rawProfiles.find(({ id }) => id === 'DOSII-TNV-001')).toMatchObject({
      unit: 'store', baseSalary: 9_000_000,
    })
    expect(env.DB.database.prepare('PRAGMA foreign_key_check').all()).toEqual([])
  })

  it('excludes an Admin-created assigned order from employee checkout reconciliation', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-08-20T10:00:00.000Z'))
      const env = { DB: new MemoryD1(), BOOTSTRAP_TOKEN: 'bootstrap-exact-order-creator-checkout' }
      const bootstrap = await worker.fetch(jsonRequest('https://idosi.example/api/bootstrap', {
        username: 'admin', password: 'exact-order-creator-admin-password',
        initialState: {
          stores: [{ id: 'S01', short: 'TNV', name: 'IDOSI Tô Ngọc Vân', status: 'Đang hoạt động' }],
          employees: [{
            id: 'E01', name: 'Nhân viên Một', storeId: 'S01', unit: 'store', status: 'Đang làm việc',
            employmentType: 'Part-Time', hourlyRate: 30_000,
          }, {
            id: 'HTKD-ORDER', name: 'Hỗ trợ KD', storeId: 'BUSINESS_SUPPORT',
            unit: 'business_support', status: 'Đang làm việc',
          }],
          attendance: [{
            id: 'ATT-E01', employeeId: 'E01', employeeName: 'Nhân viên Một', storeId: 'S01',
            date: '2026-08-20', workDate: '2026-08-20', shiftId: 'CA-SAME', shift: 'CA-SAME',
            shiftName: 'Ca chung', shiftStart: '08:00', shiftEnd: '17:00',
            checkIn: '08:00', checkInAt: '2026-08-20T01:00:00.000Z', checkOut: null, checkOutAt: null,
          }],
          orders: [{
            id: 'ORDER-OWN', code: 'S01-OWN', storeId: 'S01', employeeId: 'E01',
            createdByEmployeeId: 'E01', createdBy: { role: 'employee', employeeId: 'E01' },
            attendanceId: 'ATT-E01', shiftId: 'CA-SAME', amount: 120_000,
            paymentMethod: 'Tiền mặt', status: 'Hoàn tất', source: 'order', createdAt: '2026-08-20T02:00:00.000Z',
          }, {
            id: 'ORDER-ADMIN-ASSIGNED', code: 'S01-ADMIN', storeId: 'S01', employeeId: 'E01',
            createdBy: { id: 'admin', role: 'admin' }, attendanceId: 'ATT-E01', shiftId: 'CA-SAME',
            amount: 900_000, paymentMethod: 'Chuyển khoản', status: 'Hoàn tất', source: 'order',
            createdAt: '2026-08-20T02:05:00.000Z',
          }],
          notifications: [{
            id: 'N-ORDER-OWN', type: 'order.created', storeId: 'S01', employeeId: 'E01',
            orderId: 'ORDER-OWN', orderCode: 'S01-OWN', title: 'Đơn do nhân viên tạo',
          }, {
            id: 'N-ORDER-OWN-LEGACY', type: 'order.created', storeId: 'S01', employeeId: 'E01',
            orderId: 'S01-OWN', title: 'Đơn legacy dùng mã trong orderId',
          }, {
            id: 'N-ORDER-ADMIN', type: 'order.created', storeId: 'S01', employeeId: 'E01',
            orderId: 'ORDER-ADMIN-ASSIGNED', orderCode: 'S01-ADMIN', title: 'Đơn do Admin tạo và gán',
          }],
          tasks: [], schedule: [], shiftDefinitions: [], supportTransfers: [],
        },
      }, { 'x-idosi-bootstrap-token': env.BOOTSTRAP_TOKEN }), env)
      expect(bootstrap.status).toBe(201)

      const adminLogin = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
        username: 'admin', password: 'exact-order-creator-admin-password',
      }), env)
      const adminAuthorization = { authorization: `Bearer ${(await adminLogin.json()).token}` }
      const userCreated = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'user.create',
        payload: {
          username: 'employee.one', password: 'employee-one-password', displayName: 'Nhân viên Một',
          storeId: 'S01', employeeId: 'E01', role: 'employee',
        },
      }, { ...adminAuthorization, 'idempotency-key': 'exact-order-creator-user-0001' }), env)
      expect(userCreated.status).toBe(201)
      const supportUserCreated = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'user.create',
        payload: {
          username: 'support.orders', password: 'support-orders-password', displayName: 'Hỗ trợ KD',
          storeId: 'BUSINESS_SUPPORT', employeeId: 'HTKD-ORDER', role: 'business_support',
        },
      }, { ...adminAuthorization, 'idempotency-key': 'exact-order-creator-support-user-0001' }), env)
      expect(supportUserCreated.status).toBe(201)
      const employeeLogin = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
        username: 'employee.one', password: 'employee-one-password',
      }), env)
      const employeeAuthorization = { authorization: `Bearer ${(await employeeLogin.json()).token}` }
      const supportLogin = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
        username: 'support.orders', password: 'support-orders-password',
      }), env)
      const supportAuthorization = { authorization: `Bearer ${(await supportLogin.json()).token}` }

      const employeeStateResponse = await worker.fetch(new Request('https://idosi.example/api/state', {
        headers: employeeAuthorization,
      }), env)
      expect(employeeStateResponse.status).toBe(200)
      const employeeState = (await employeeStateResponse.json()).state
      expect(employeeState.orders.map(({ id }) => id)).toEqual(['ORDER-OWN'])
      expect(employeeState.notifications.map(({ id }) => id)).toEqual(['N-ORDER-OWN', 'N-ORDER-OWN-LEGACY'])

      const checkedOut = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'attendance.check_out', expectedVersion: 1,
        payload: {
          attendanceId: 'ATT-E01', cashRevenue: 120_000, transferRevenue: 0,
          location: { latitude: 10.8, longitude: 106.7, accuracy: 8 },
        },
      }, { ...employeeAuthorization, 'idempotency-key': 'exact-order-creator-checkout-0001' }), env)
      expect(checkedOut.status).toBe(200)
      expect(await checkedOut.json()).toMatchObject({
        version: 2,
        attendance: {
          id: 'ATT-E01', orderCount: 1, revenue: 120_000, cash: 120_000, transfer: 0,
          revenueReconciliation: {
            matched: true, expectedCash: 120_000, expectedTransfer: 0, expectedTotal: 120_000,
          },
        },
      })

      const adminOrderUpdated = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'order.update', expectedVersion: 2,
        payload: { orderId: 'ORDER-ADMIN-ASSIGNED', amount: 950_000, reason: 'Đối soát đơn do Admin tạo' },
      }, { ...adminAuthorization, 'idempotency-key': 'exact-order-creator-admin-update-0001' }), env)
      expect(adminOrderUpdated.status).toBe(200)
      expect(await adminOrderUpdated.json()).toMatchObject({ version: 3, order: { amount: 950_000 } })
      expect(readHydratedState(env.DB.database).attendance[0]).toMatchObject({
        id: 'ATT-E01', orderCount: 1, revenue: 120_000, cash: 120_000, transfer: 0,
      })

      const adminOrderRestored = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'operational_reset.restore', expectedVersion: 3,
        payload: {
          dataType: 'orders', storeId: 'S01', employeeId: 'E01',
          fromDate: '2026-08-20', toDate: '2026-08-20', reason: 'Hoàn tác đơn do Admin tạo',
        },
      }, { ...supportAuthorization, 'idempotency-key': 'exact-order-creator-admin-reset-0001' }), env)
      expect(adminOrderRestored.status).toBe(200)
      expect(await adminOrderRestored.json()).toMatchObject({
        version: 4, restoredCount: 1, restoredIds: ['ORDER-ADMIN-ASSIGNED'],
      })
      expect(readHydratedState(env.DB.database).attendance[0]).toMatchObject({
        id: 'ATT-E01', orderCount: 1, revenue: 120_000, cash: 120_000, transfer: 0,
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('assigns future store tasks and reconciles employee checkout against mandatory customer orders', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-08-18T01:00:00.000Z'))
      const env = { DB: new MemoryD1(), BOOTSTRAP_TOKEN: 'bootstrap-employee-shift-reconciliation' }
      const bootstrap = await worker.fetch(jsonRequest('https://idosi.example/api/bootstrap', {
        username: 'admin', password: 'employee-shift-admin-password',
        initialState: {
          stores: [
            { id: 'S01', short: 'TNV', name: 'IDOSI Tô Ngọc Vân', status: 'Đang hoạt động' },
            { id: 'S02', short: 'TH', name: 'IDOSI Tây Hòa', status: 'Đang hoạt động' },
          ],
          employees: [
            { id: 'E01', name: 'Nhân viên Một', phone: '0901234567', cccd: '079123456789', address: '12 Tô Ngọc Vân', startDate: '2026-08-01', storeId: 'S01', unit: 'store', status: 'Đang làm việc', employmentType: 'Part-Time', hourlyRate: 30_000 },
            { id: 'E02', name: 'Nhân viên Hai', storeId: 'S02', unit: 'store', status: 'Đang làm việc', employmentType: 'Part-Time', hourlyRate: 30_000 },
            { id: 'HTKD-01', name: 'Hỗ trợ KD', storeId: 'BUSINESS_SUPPORT', unit: 'business_support', status: 'Đang làm việc' },
            { id: 'QLCH-01', name: 'Quản lý S01', storeId: 'S01', unit: 'store_manager', status: 'Đang làm việc' },
            { id: 'QLCH-02', name: 'Quản lý S02', storeId: 'S02', unit: 'store_manager', status: 'Đang làm việc' },
          ],
          attendance: [], schedule: [], tasks: [], taskAssignmentHistory: [], notifications: [],
          shiftDefinitions: [], orders: [], orderAudit: [], expenseEntries: [], fixedExpenses: [],
          cashTransactions: [], salaryAdjustments: [], salaryAdvances: [], payrollPeriods: [], payrollPayments: [],
        },
      }, { 'x-idosi-bootstrap-token': env.BOOTSTRAP_TOKEN }), env)
      expect(bootstrap.status).toBe(201)
      const adminLogin = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
        username: 'admin', password: 'employee-shift-admin-password',
      }), env)
      let adminAuthorization = { authorization: `Bearer ${(await adminLogin.json()).token}` }
      for (const account of [
        { username: 'employee.one', password: 'employee-one-password', displayName: 'Nhân viên Một', storeId: 'S01', employeeId: 'E01', role: 'employee' },
        { username: 'employee.two', password: 'employee-two-password', displayName: 'Nhân viên Hai', storeId: 'S02', employeeId: 'E02', role: 'employee' },
        { username: 'support.ops', password: 'support-ops-password', displayName: 'Hỗ trợ KD', storeId: 'BUSINESS_SUPPORT', employeeId: 'HTKD-01', role: 'business_support' },
        { username: 'manager.s01', password: 'manager-s01-password', displayName: 'Quản lý S01', storeId: 'S01', employeeId: 'QLCH-01', role: 'store_manager' },
        { username: 'manager.s02', password: 'manager-s02-password', displayName: 'Quản lý S02', storeId: 'S02', employeeId: 'QLCH-02', role: 'store_manager' },
      ]) {
        const created = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
          type: 'user.create', payload: account,
        }, { ...adminAuthorization, 'idempotency-key': `employee-shift-user-${account.employeeId}` }), env)
        expect(created.status, account.employeeId).toBe(201)
      }
      const loginAs = async (username, password) => {
        const response = await worker.fetch(jsonRequest('https://idosi.example/api/login', { username, password }), env)
        expect(response.status).toBe(200)
        return { authorization: `Bearer ${(await response.json()).token}` }
      }
      let employeeAuthorization = await loginAs('employee.one', 'employee-one-password')
      const otherEmployeeAuthorization = await loginAs('employee.two', 'employee-two-password')
      let supportAuthorization = await loginAs('support.ops', 'support-ops-password')
      const managerAuthorization = await loginAs('manager.s01', 'manager-s01-password')
      let destinationManagerAuthorization = await loginAs('manager.s02', 'manager-s02-password')

      const shiftCreated = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'shift_definition.create', expectedVersion: 1,
        payload: { storeId: 'S01', id: 'SHIFT-FUTURE', name: 'Ca tương lai', date: '2026-08-20', start: '08:00', end: '17:00' },
      }, { ...supportAuthorization, 'idempotency-key': 'support-future-shift-0001' }), env)
      expect(shiftCreated.status).toBe(201)
      expect(await shiftCreated.json()).toMatchObject({ version: 2, shift: { id: 'SHIFT-FUTURE', storeId: 'S01' } })

      const assigned = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'tasks.assign', expectedVersion: 2,
        payload: {
          storeId: 'S01', date: '2026-08-20', shiftId: 'SHIFT-FUTURE', employeeIds: ['E01'],
          tasks: [
            { id: 'TASK-FUTURE-01', title: 'Mở cửa hàng', detail: 'Kiểm tra vệ sinh' },
            { id: 'TASK-FUTURE-02', title: 'Kiểm hàng', detail: 'Ghi nhận tồn kho' },
          ],
        },
      }, { ...supportAuthorization, 'idempotency-key': 'support-future-task-0001' }), env)
      expect(assigned.status).toBe(201)
      const assignedBody = await assigned.json()
      expect(assignedBody).toMatchObject({
        version: 3,
        employeeIds: ['E01'],
        tasks: [
          { id: 'TASK-FUTURE-01', employeeIds: ['E01'] },
          { id: 'TASK-FUTURE-02', employeeIds: ['E01'] },
        ],
        notifications: [{ type: 'store-task-assigned', employeeId: 'E01', route: '/employee/home' }],
        history: { action: 'assigned', employeeIds: ['E01'], taskCount: 2 },
      })

      const crossStoreAssignment = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'tasks.assign', expectedVersion: 3,
        payload: {
          storeId: 'S01', date: '2026-08-20', shiftId: 'SHIFT-FUTURE', employeeIds: ['E02'],
          tasks: [{ title: 'Không hợp lệ' }],
        },
      }, { ...supportAuthorization, 'idempotency-key': 'support-cross-store-task-0001' }), env)
      expect(crossStoreAssignment.status).toBe(400)
      expect(await crossStoreAssignment.json()).toMatchObject({ error: { code: 'EMPLOYEE_STORE_MISMATCH' } })
      const managerCrossStore = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'tasks.assign', expectedVersion: 3,
        payload: {
          storeId: 'S02', date: '2026-08-20', employeeIds: ['E02'], tasks: [{ title: 'Vượt phạm vi' }],
        },
      }, { ...managerAuthorization, 'idempotency-key': 'manager-cross-store-task-0001' }), env)
      expect(managerCrossStore.status).toBe(403)
      expect(await managerCrossStore.json()).toMatchObject({ error: { code: 'STORE_SCOPE_FORBIDDEN' } })
      const otherEmployeeDenied = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'task.done', expectedVersion: 3, payload: { taskId: 'TASK-FUTURE-01', done: true },
      }, { ...otherEmployeeAuthorization, 'idempotency-key': 'other-employee-task-denied-0001' }), env)
      expect(otherEmployeeDenied.status).toBe(403)
      expect(await otherEmployeeDenied.json()).toMatchObject({ error: { code: 'TASK_FORBIDDEN' } })

      const scheduled = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'schedule.assign', expectedVersion: 3,
        payload: { storeId: 'S01', date: '2026-08-20', employeeIds: ['E01'], shiftIds: ['SHIFT-FUTURE'] },
      }, { ...supportAuthorization, 'idempotency-key': 'support-future-schedule-0001' }), env)
      expect(scheduled.status).toBe(200)
      expect(await scheduled.json()).toMatchObject({ version: 4, assignments: [{ employeeId: 'E01', shiftId: 'SHIFT-FUTURE' }] })
      const employeeBeforeShift = await worker.fetch(new Request('https://idosi.example/api/state', {
        headers: employeeAuthorization,
      }), env)
      const employeeBeforeShiftState = (await employeeBeforeShift.json()).state
      expect(employeeBeforeShiftState.tasks.map(({ id }) => id).sort()).toEqual(['TASK-FUTURE-01', 'TASK-FUTURE-02'])
      expect(employeeBeforeShiftState.notifications).toEqual([
        expect.objectContaining({ type: 'store-task-assigned', employeeId: 'E01' }),
      ])
      expect(employeeBeforeShiftState.taskAssignmentHistory).toEqual([
        expect.objectContaining({ action: 'assigned', employeeIds: ['E01'] }),
      ])
      const prematureDone = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'task.done', expectedVersion: 4, payload: { taskId: 'TASK-FUTURE-01', done: true },
      }, { ...employeeAuthorization, 'idempotency-key': 'employee-premature-task-0001' }), env)
      expect(prematureDone.status).toBe(409)
      expect(await prematureDone.json()).toMatchObject({ error: { code: 'TASK_DATE_INVALID' } })

      vi.setSystemTime(new Date('2026-08-20T01:00:00.000Z'))
      adminAuthorization = await loginAs('admin', 'employee-shift-admin-password')
      employeeAuthorization = await loginAs('employee.one', 'employee-one-password')
      supportAuthorization = await loginAs('support.ops', 'support-ops-password')
      const checkedIn = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'attendance.check_in', expectedVersion: 4,
        payload: { shiftId: 'SHIFT-FUTURE', location: { latitude: 10.8, longitude: 106.7, accuracy: 8 } },
      }, { ...employeeAuthorization, 'idempotency-key': 'employee-future-check-in-0001' }), env)
      expect(checkedIn.status).toBe(201)
      const attendanceId = (await checkedIn.json()).attendance.id
      const completedTask = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'task.done', expectedVersion: 5, payload: { taskId: 'TASK-FUTURE-01', done: true },
      }, { ...employeeAuthorization, 'idempotency-key': 'employee-task-done-0001' }), env)
      expect(completedTask.status).toBe(200)
      expect(await completedTask.json()).toMatchObject({ version: 6, task: { completedBy: { E01: true } } })

      const missingCustomerProfile = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'order.create', expectedVersion: 6,
        payload: { storeId: 'S01', customerName: 'Thiếu hồ sơ', amount: 100_000, paymentMethod: 'Tiền mặt' },
      }, { ...employeeAuthorization, 'idempotency-key': 'employee-order-profile-required-0001' }), env)
      expect(missingCustomerProfile.status).toBe(400)
      expect(await missingCustomerProfile.json()).toMatchObject({ error: { code: 'ORDER_GENDER_INVALID' } })
      const spoofedOrder = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'order.create', expectedVersion: 6,
        payload: {
          storeId: 'S02', employeeId: 'E02', attendanceId: 'ATT-SPOOF', customerName: 'Giả mạo',
          gender: 'Khác', occupation: 'Khác', acquisitionChannel: 'Khác', amount: 100_000, paymentMethod: 'Tiền mặt',
        },
      }, { ...employeeAuthorization, 'idempotency-key': 'employee-order-spoof-0001' }), env)
      expect(spoofedOrder.status).toBe(403)
      expect(await spoofedOrder.json()).toMatchObject({ error: { code: 'STORE_FORBIDDEN' } })

      const cashOrder = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'order.create', expectedVersion: 6,
        payload: {
          storeId: 'S01', employeeId: 'E02', attendanceId: 'ATT-SPOOF', customerName: 'Khách tiền mặt',
          gender: 'Nữ', occupation: 'Kế toán', acquisitionChannel: 'Facebook', amount: 100_000, paymentMethod: 'Tiền mặt',
        },
      }, { ...employeeAuthorization, 'idempotency-key': 'employee-cash-order-0001' }), env)
      expect(cashOrder.status).toBe(201)
      const cashOrderBody = await cashOrder.json()
      expect(cashOrderBody).toMatchObject({
        version: 7,
        order: {
          storeId: 'S01', employeeId: 'E01', attendanceId, gender: 'Nữ', occupation: 'Kế toán',
          acquisitionChannel: 'Facebook', paymentMethod: 'Tiền mặt', amount: 100_000,
        },
      })
      const transferOrder = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'order.create', expectedVersion: 7,
        payload: {
          storeId: 'S01', customerName: 'Khách chuyển khoản', gender: 'Nam', occupation: 'Kỹ sư',
          acquisitionChannel: 'Tiktok', amount: 200_000, paymentMethod: 'Chuyển khoản',
        },
      }, { ...employeeAuthorization, 'idempotency-key': 'employee-transfer-order-0001' }), env)
      expect(transferOrder.status).toBe(201)
      const transferOrderBody = await transferOrder.json()
      expect(transferOrderBody).toMatchObject({ version: 8, order: { attendanceId, acquisitionChannel: 'Tiktok' } })
      const updatedOrder = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'order.update', expectedVersion: 8,
        payload: {
          orderId: transferOrderBody.order.id, gender: 'Khác', occupation: 'Giáo viên',
          acquisitionChannel: 'Zalo', reason: 'Bổ sung hồ sơ khách hàng',
        },
      }, { ...adminAuthorization, 'idempotency-key': 'admin-order-profile-update-0001' }), env)
      expect(updatedOrder.status).toBe(200)
      expect(await updatedOrder.json()).toMatchObject({
        version: 9,
        order: { gender: 'Khác', occupation: 'Giáo viên', acquisitionChannel: 'Zalo' },
        audit: { changedFields: ['gender', 'occupation', 'acquisitionChannel'] },
      })

      const mismatchCheckout = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'attendance.check_out', expectedVersion: 9,
        payload: {
          attendanceId, cashRevenue: 50_000, transferRevenue: 200_000,
          incompleteTaskReason: 'Còn kiểm hàng',
          location: { latitude: 10.8, longitude: 106.7, accuracy: 8 },
        },
      }, { ...employeeAuthorization, 'idempotency-key': 'employee-checkout-mismatch-0001' }), env)
      expect(mismatchCheckout.status).toBe(409)
      expect(await mismatchCheckout.json()).toMatchObject({
        error: {
          code: 'SHIFT_REVENUE_MISMATCH',
          details: {
            expected: { cashRevenue: 100_000, transferRevenue: 200_000, totalRevenue: 300_000 },
            received: { cashRevenue: 50_000, transferRevenue: 200_000, totalRevenue: 250_000 },
          },
        },
      })
      const reasonRequired = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'attendance.check_out', expectedVersion: 9,
        payload: {
          attendanceId, cashRevenue: 100_000, transferRevenue: 200_000,
          location: { latitude: 10.8, longitude: 106.7, accuracy: 8 },
        },
      }, { ...employeeAuthorization, 'idempotency-key': 'employee-checkout-reason-required-0001' }), env)
      expect(reasonRequired.status).toBe(400)
      expect(await reasonRequired.json()).toMatchObject({
        error: { code: 'INCOMPLETE_TASK_REASON_REQUIRED', details: { taskIds: ['TASK-FUTURE-02'] } },
      })
      const checkedOut = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'attendance.check_out', expectedVersion: 9,
        payload: {
          attendanceId, cashRevenue: 100_000, transferRevenue: 200_000,
          incompleteTaskReason: 'Chưa hoàn tất kiểm hàng vì khách đông',
          location: { latitude: 10.8, longitude: 106.7, accuracy: 8 },
        },
      }, { ...employeeAuthorization, 'idempotency-key': 'employee-checkout-success-0001' }), env)
      expect(checkedOut.status).toBe(200)
      expect(await checkedOut.json()).toMatchObject({
        version: 10,
        attendance: {
          id: attendanceId, orderCount: 2, revenue: 300_000, cash: 100_000, transfer: 200_000,
          declaredRevenue: { cash: 100_000, transfer: 200_000, total: 300_000 },
          revenueReconciliation: {
            matched: true, expectedCash: 100_000, expectedTransfer: 200_000, expectedTotal: 300_000,
          },
          incompleteTaskReason: 'Chưa hoàn tất kiểm hàng vì khách đông',
          incompleteTasksSnapshot: [{ id: 'TASK-FUTURE-02', title: 'Kiểm hàng' }],
        },
      })
      const persistedState = readHydratedState(env.DB.database)
      expect(persistedState.taskAssignmentHistory.map(({ action }) => action)).toEqual(['assigned'])
      expect(persistedState.taskAssignmentHistory[0]).toMatchObject({
        tasks: [
          { id: 'TASK-FUTURE-01', completedBy: { E01: true } },
          { id: 'TASK-FUTURE-02', completedBy: {} },
        ],
        progressHistory: [{ taskId: 'TASK-FUTURE-01', employeeId: 'E01', done: true }],
      })
      expect(persistedState.tasks.find(({ id }) => id === 'TASK-FUTURE-01').completionHistory).toEqual([
        expect.objectContaining({ employeeId: 'E01', done: true }),
      ])

      const transferCreated = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'support_transfer.create', expectedVersion: 10,
        payload: {
          employeeId: 'E01', fromStoreId: 'S01', toStoreId: 'S02',
          startAt: '2026-08-21T08:00', endAt: '2026-08-21T12:00', hourlySupportRate: 45_000,
          allowance: 180_000, note: 'Hỗ trợ cửa hàng Tây Hòa',
        },
      }, { ...supportAuthorization, 'idempotency-key': 'support-runtime-transfer-0001' }), env)
      expect(transferCreated.status).toBe(201)
      const transferCreatedBody = await transferCreated.json()
      expect(transferCreatedBody).toMatchObject({
        version: 11,
        transfer: {
          employeeId: 'E01', toStoreId: 'S02',
          startAt: '2026-08-21T01:00:00.000Z', endAt: '2026-08-21T05:00:00.000Z',
          fromDate: '2026-08-21', toDate: '2026-08-21',
        },
      })

      vi.setSystemTime(new Date('2026-08-21T00:59:59.999Z'))
      const beforeTransferLogin = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
        username: 'employee.one', password: 'employee-one-password',
      }), env)
      expect(beforeTransferLogin.status).toBe(200)
      expect(await beforeTransferLogin.json()).toMatchObject({ user: { storeId: 'S01' } })
      vi.setSystemTime(new Date('2026-08-21T01:00:00.000Z'))
      employeeAuthorization = await loginAs('employee.one', 'employee-one-password')
      supportAuthorization = await loginAs('support.ops', 'support-ops-password')
      destinationManagerAuthorization = await loginAs('manager.s02', 'manager-s02-password')
      const transferredLogin = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
        username: 'employee.one', password: 'employee-one-password',
      }), env)
      expect(transferredLogin.status).toBe(200)
      expect(await transferredLogin.json()).toMatchObject({
        user: { storeId: 'S02', homeStoreId: 'S01', activeTransferId: transferCreatedBody.transfer.id },
      })
      const transferredEmployeeProjection = await worker.fetch(new Request('https://idosi.example/api/state', {
        headers: employeeAuthorization,
      }), env)
      const transferredEmployeeState = (await transferredEmployeeProjection.json()).state
      expect(transferredEmployeeState.stores.map(({ id }) => id).sort()).toEqual(['S01', 'S02'])
      expect(transferredEmployeeState.supportTransfers).toEqual([
        expect.objectContaining({ id: transferCreatedBody.transfer.id, hourlySupportRate: 45_000, allowance: 180_000 }),
      ])
      const destinationProjection = await worker.fetch(new Request('https://idosi.example/api/state', {
        headers: destinationManagerAuthorization,
      }), env)
      expect(destinationProjection.status).toBe(200)
      const destinationEmployee = (await destinationProjection.json()).state.employees.find(({ id }) => id === 'E01')
      expect(destinationEmployee).toMatchObject({
        id: 'E01', name: 'Nhân viên Một', phone: '0901234567', cccd: '079123456789', address: '12 Tô Ngọc Vân',
        homeStoreId: 'S01', supportStoreId: 'S02',
        supportAssignment: {
          startAt: '2026-08-21T01:00:00.000Z', endAt: '2026-08-21T05:00:00.000Z',
          fromDate: '2026-08-21', toDate: '2026-08-21', hourlySupportRate: 45_000,
          allowance: 180_000, status: 'Đã duyệt',
        },
      })

      const destinationCheckIn = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'attendance.check_in', expectedVersion: 11,
        payload: { location: { latitude: 10.81, longitude: 106.68, accuracy: 7 } },
      }, { ...employeeAuthorization, 'idempotency-key': 'employee-support-check-in-0001' }), env)
      expect(destinationCheckIn.status).toBe(201)
      const destinationCheckInBody = await destinationCheckIn.json()
      expect(destinationCheckInBody).toMatchObject({
        version: 12,
        attendance: {
          shiftName: 'Ca hỗ trợ cửa hàng', shiftSource: 'support-transfer',
          shiftStart: '08:00', shiftEnd: '12:00', arrivalTag: 'Đi đúng giờ', minutesLate: 0,
        },
      })
      const destinationAttendanceId = destinationCheckInBody.attendance.id
      vi.setSystemTime(new Date('2026-08-21T05:00:00.000Z'))
      const stateAtExclusiveEnd = await worker.fetch(new Request('https://idosi.example/api/state', {
        headers: employeeAuthorization,
      }), env)
      expect(stateAtExclusiveEnd.status).toBe(200)
      const stateAtExclusiveEndBody = await stateAtExclusiveEnd.json()
      expect(stateAtExclusiveEndBody).toMatchObject({ user: { storeId: 'S01' }, state: { activeStoreId: 'S01' } })
      expect(stateAtExclusiveEndBody.state.attendance.find(({ id }) => id === destinationAttendanceId)).toMatchObject({
        storeId: 'S02', checkOutAt: null,
      })
      expect(stateAtExclusiveEndBody.state.stores.map(({ id }) => id).sort()).toEqual(['S01', 'S02'])
      const destinationAtExclusiveEnd = await worker.fetch(new Request('https://idosi.example/api/state', {
        headers: destinationManagerAuthorization,
      }), env)
      expect(destinationAtExclusiveEnd.status).toBe(200)
      expect((await destinationAtExclusiveEnd.json()).state.employees.some(({ id }) => id === 'E01')).toBe(false)
      vi.setSystemTime(new Date('2026-08-21T07:00:00.000Z'))
      const destinationCheckOut = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'attendance.check_out', expectedVersion: 12,
        payload: {
          attendanceId: destinationAttendanceId, cashRevenue: 0, transferRevenue: 0,
          location: { latitude: 10.81, longitude: 106.68, accuracy: 7 },
        },
      }, { ...employeeAuthorization, 'idempotency-key': 'employee-support-check-out-0001' }), env)
      expect(destinationCheckOut.status).toBe(200)
      expect(await destinationCheckOut.json()).toMatchObject({
        version: 13,
        attendance: {
          storeId: 'S02', homeStoreId: 'S01', supportTransferId: transferCreatedBody.transfer.id,
          elapsedSeconds: 21_600, workedSeconds: 14_400, hours: 4,
        },
      })
      const stateAfterSupportShift = readHydratedState(env.DB.database)
      expect(stateAfterSupportShift.supportTransfers.find(({ id }) => id === transferCreatedBody.transfer.id)).toMatchObject({
        status: 'Hoàn tất',
      })
      const destinationPayroll = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'payroll.close', expectedVersion: 13, payload: { storeId: 'S02', period: '2026-08' },
      }, { ...supportAuthorization, 'idempotency-key': 'support-destination-payroll-0001' }), env)
      expect(destinationPayroll.status).toBe(201)
      const destinationPayrollBody = await destinationPayroll.json()
      expect(destinationPayrollBody).toMatchObject({ version: 14, period: { storeId: 'S02' } })
      expect(destinationPayrollBody.period.rows.find(({ employeeId }) => employeeId === 'E01')).toMatchObject({
        employeeId: 'E01', hours: 4, baseSalary: 180_000, supportHourlyPay: 180_000,
        supportAllowance: 180_000, gross: 360_000,
        supportTransferIds: [transferCreatedBody.transfer.id],
      })
      const employeeReturnedHome = await worker.fetch(new Request('https://idosi.example/api/state', {
        headers: employeeAuthorization,
      }), env)
      expect(await employeeReturnedHome.json()).toMatchObject({ state: { activeStoreId: 'S01' } })
      expect(env.DB.database.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    } finally {
      vi.useRealTimers()
    }
  }, 30_000)

  it('lets Business Support configure Office and protected support work shifts and check in the selected shift', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-08-20T06:05:00.000Z'))
      const env = { DB: new MemoryD1(), IDENTITY_IMAGES: new MemoryR2(), BOOTSTRAP_TOKEN: 'bootstrap-working-time-rbac' }
      const bootstrap = await worker.fetch(jsonRequest('https://idosi.example/api/bootstrap', {
        username: 'admin', password: 'working-time-admin-password',
        initialState: { stores: [], employees: [], attendance: [], schedule: [], shiftDefinitions: [] },
      }, { 'x-idosi-bootstrap-token': env.BOOTSTRAP_TOKEN }), env)
      expect(bootstrap.status).toBe(201)
      const adminLogin = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
        username: 'admin', password: 'working-time-admin-password',
      }), env)
      const adminAuthorization = { authorization: `Bearer ${(await adminLogin.json()).token}` }
      const supportCreated = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'employee.create', expectedVersion: 1,
        payload: {
          unit: 'business_support', name: 'Hỗ trợ ca linh hoạt', phone: '0908111222', cccd: '079888111222',
          address: 'TP. Hồ Chí Minh', startDate: '2026-08-20', employmentType: 'Part-Time', position: 'NV hỗ trợ KD',
          username: 'support.shifts', password: 'support-shifts-password', identityImages: testIdentityImages(),
          workShifts: [
            { id: 'support_am', name: 'Ca sáng', start: '08:00', end: '12:00' },
            { id: 'support_pm', name: 'Ca chiều', start: '13:00', end: '17:30' },
          ],
        },
      }, { ...adminAuthorization, 'idempotency-key': 'working-time-support-create-0001' }), env)
      expect(supportCreated.status).toBe(201)
      const support = (await supportCreated.json()).employee
      expect(support).toMatchObject({
        workTimeType: 'Part-Time', workStart: '08:00', workEnd: '12:00',
        workingTime: { type: 'Part-Time', mode: 'shifts' },
      })
      const officeCreated = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'employee.create', expectedVersion: 2,
        payload: {
          unit: 'office', storeId: 'OFFICE', name: 'Marketing linh hoạt', phone: '0908333444', cccd: '079888333444',
          address: 'Địa chỉ cũ', startDate: '2026-08-20', employmentType: 'Part-Time', position: 'Marketing',
          username: 'office.shifts', password: 'office-shifts-password', identityImages: testIdentityImages(),
          workShifts: [{ id: 'office_am', name: 'Ca sáng', start: '08:00', end: '12:00' }],
        },
      }, { ...adminAuthorization, 'idempotency-key': 'working-time-office-create-0001' }), env)
      const officeCreatedBody = await officeCreated.json()
      expect(officeCreated.status, JSON.stringify(officeCreatedBody)).toBe(201)
      const office = officeCreatedBody.employee
      const supportLogin = await worker.fetch(jsonRequest('https://idosi.example/api/login', {
        username: 'support.shifts', password: 'support-shifts-password',
      }), env)
      const supportAuthorization = { authorization: `Bearer ${(await supportLogin.json()).token}` }

      const officeUpdated = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'employee.update', expectedVersion: 3,
        payload: {
          employeeId: office.id, phone: '0908555666', address: 'Địa chỉ mới',
          workShifts: [
            { id: 'office_am', name: 'Ca sáng', start: '08:00', end: '12:00' },
            { id: 'office_pm', name: 'Ca chiều', start: '13:00', end: '17:30' },
          ],
        },
      }, { ...supportAuthorization, 'idempotency-key': 'working-time-office-update-0001' }), env)
      expect(officeUpdated.status).toBe(200)
      expect(await officeUpdated.json()).toMatchObject({
        version: 4,
        employee: { phone: '0908555666', address: 'Địa chỉ mới', workShifts: [{ id: 'office_am' }, { id: 'office_pm' }] },
      })

      const supportUpdated = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'employee.update', expectedVersion: 4,
        payload: {
          employeeId: support.id, workTimeType: 'Part-Time', workStart: '08:00', workEnd: '12:00',
          workShifts: [
            { id: 'support_am', name: 'Ca sáng', start: '08:00', end: '12:00' },
            { id: 'support_pm', name: 'Ca chiều mới', start: '13:00', end: '17:30' },
          ],
          workingTime: {
            type: 'Part-Time', mode: 'shifts',
            shifts: [
              { id: 'support_am', name: 'Ca sáng', start: '08:00', end: '12:00' },
              { id: 'support_pm', name: 'Ca chiều mới', start: '13:00', end: '17:30' },
            ],
          },
        },
      }, { ...supportAuthorization, 'idempotency-key': 'working-time-support-update-0001' }), env)
      expect(supportUpdated.status).toBe(200)
      expect(await supportUpdated.json()).toMatchObject({ version: 5, employee: { workShifts: [{ id: 'support_am' }, { id: 'support_pm', name: 'Ca chiều mới' }] } })

      const protectedUpdate = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'employee.update', expectedVersion: 5,
        payload: { employeeId: support.id, phone: '0908999999' },
      }, { ...supportAuthorization, 'idempotency-key': 'working-time-support-protected-0001' }), env)
      expect(protectedUpdate.status).toBe(403)
      expect(await protectedUpdate.json()).toMatchObject({ error: { code: 'BUSINESS_SUPPORT_READ_ONLY' } })

      const missingShift = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'attendance.check_in', expectedVersion: 5,
        payload: { location: { latitude: 10.8231, longitude: 106.6297, accuracy: 10 } },
      }, { ...supportAuthorization, 'idempotency-key': 'working-time-support-missing-shift-0001' }), env)
      expect(missingShift.status).toBe(400)
      expect(await missingShift.json()).toMatchObject({ error: { code: 'PROFILE_WORK_SHIFT_REQUIRED' } })

      const checkedIn = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'attendance.check_in', expectedVersion: 5,
        payload: {
          shiftId: 'support_pm',
          location: { latitude: 10.8231, longitude: 106.6297, accuracy: 10, label: 'Văn phòng IDOSI' },
        },
      }, { ...supportAuthorization, 'idempotency-key': 'working-time-support-check-in-0001' }), env)
      expect(checkedIn.status).toBe(201)
      expect(await checkedIn.json()).toMatchObject({
        version: 6,
        attendance: {
          employeeId: support.id, shiftId: 'support_pm', shiftName: 'Ca chiều mới',
          shiftStart: '13:00', shiftEnd: '17:30', shiftSource: 'profile-work-shift',
          checkIn: '13:05', arrivalTag: 'Đi đúng giờ', minutesLate: 5,
        },
      })
    } finally {
      vi.useRealTimers()
    }
  }, 30_000)

  it.each([
    {
      label: 'paid',
      period: { id: 'PAY-S02-AUG-PAID', storeId: 'S02', period: '2026-08', status: 'Đã chi', confirmedAt: '2026-08-20T00:00:00.000Z' },
      code: 'PAYROLL_PERIOD_PAID',
    },
    {
      label: 'locked',
      period: { id: 'PAY-S02-AUG-LOCKED', storeId: 'S02', period: '2026-08', status: 'Đã khóa', lockedAt: '2026-08-20T00:00:00.000Z' },
      code: 'PAYROLL_PERIOD_LOCKED',
    },
  ])('rejects a destination check-in when its payroll period is $label', async ({ label, period, code }) => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-08-20T02:00:00.000Z')) // 09:00 Vietnam
      const transfer = {
        id: `TR-CHECK-IN-${label.toUpperCase()}`, employeeId: 'E01', fromStoreId: 'S01', toStoreId: 'S02',
        startAt: '2026-08-20T01:00:00.000Z', endAt: '2026-08-20T05:00:00.000Z',
        fromDate: '2026-08-20', toDate: '2026-08-20', hourlySupportRate: 45_000, allowance: 0,
        status: 'Đã duyệt', createdAt: '2026-08-19T00:00:00.000Z',
      }
      const { env, employeeAuthorization } = await setupSupportTransferRuntime({
        token: `bootstrap-transfer-check-in-${label}`, transfer, payrollPeriods: [period],
      })
      const checkedIn = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'attendance.check_in', expectedVersion: 1,
        payload: { location: { latitude: 10.8, longitude: 106.7, accuracy: 8 } },
      }, { ...employeeAuthorization, 'idempotency-key': `transfer-check-in-${label}-0001` }), env)
      expect(checkedIn.status).toBe(409)
      expect(await checkedIn.json()).toMatchObject({ error: { code } })
      const state = readHydratedState(env.DB.database)
      expect(env.DB.database.prepare("SELECT version FROM app_state WHERE scope_key = 'global'").get()).toEqual({ version: 1 })
      expect(state.attendance).toEqual([])
    } finally {
      vi.useRealTimers()
    }
  }, 30_000)

  it('blocks payroll close, pay and lock while attendance is open, then allows checkout and close', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-08-20T02:00:00.000Z')) // 09:00 Vietnam
      const transfer = {
        id: 'TR-OPEN-PAYROLL-GUARD', employeeId: 'E01', fromStoreId: 'S01', toStoreId: 'S02',
        startAt: '2026-08-20T01:00:00.000Z', endAt: '2026-08-20T05:00:00.000Z',
        fromDate: '2026-08-20', toDate: '2026-08-20', hourlySupportRate: 45_000, allowance: 0,
        status: 'Đã duyệt', createdAt: '2026-08-19T00:00:00.000Z',
      }
      const { env, adminAuthorization, employeeAuthorization } = await setupSupportTransferRuntime({
        token: 'bootstrap-open-payroll-guard', transfer,
      })
      const checkedIn = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'attendance.check_in', expectedVersion: 1,
        payload: { location: { latitude: 10.8, longitude: 106.7, accuracy: 8 } },
      }, { ...employeeAuthorization, 'idempotency-key': 'open-payroll-guard-check-in-0001' }), env)
      expect(checkedIn.status).toBe(201)
      const attendanceId = (await checkedIn.json()).attendance.id

      for (const operation of ['close', 'pay', 'lock']) {
        const blocked = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
          type: `payroll.${operation}`, expectedVersion: 2, payload: { storeId: 'S02', period: '2026-08' },
        }, { ...adminAuthorization, 'idempotency-key': `open-payroll-guard-${operation}-0001` }), env)
        expect(blocked.status, operation).toBe(409)
        expect(await blocked.json()).toMatchObject({
          error: { code: 'PAYROLL_ATTENDANCE_OPEN', details: { attendanceIds: [attendanceId] } },
        })
      }

      vi.setSystemTime(new Date('2026-08-20T03:00:00.000Z'))
      const checkedOut = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'attendance.check_out', expectedVersion: 2,
        payload: {
          attendanceId, cashRevenue: 0, transferRevenue: 0,
          location: { latitude: 10.8, longitude: 106.7, accuracy: 8 },
        },
      }, { ...employeeAuthorization, 'idempotency-key': 'open-payroll-guard-check-out-0001' }), env)
      expect(checkedOut.status).toBe(200)
      expect(await checkedOut.json()).toMatchObject({ version: 3, attendance: { id: attendanceId, workedSeconds: 3_600 } })

      const closed = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'payroll.close', expectedVersion: 3, payload: { storeId: 'S02', period: '2026-08' },
      }, { ...adminAuthorization, 'idempotency-key': 'open-payroll-guard-close-after-checkout-0001' }), env)
      expect(closed.status).toBe(201)
      expect(await closed.json()).toMatchObject({ version: 4, period: { storeId: 'S02', period: '2026-08', status: 'Đã chốt' } })
    } finally {
      vi.useRealTimers()
    }
  }, 30_000)

  it('lets business support correct and restore destination attendance only within exact transfer bounds', async () => {
    const transfer = {
      id: 'TR-HISTORICAL-CORRECTION', employeeId: 'E01', fromStoreId: 'S01', toStoreId: 'S02',
      startAt: '2026-08-20T01:00:00.000Z', endAt: '2026-08-20T05:00:00.000Z',
      fromDate: '2026-08-20', toDate: '2026-08-20', hourlySupportRate: 45_000, allowance: 0,
      status: 'Hoàn tất', completedAt: '2026-08-20T05:00:00.000Z',
    }
    const attendance = [{
      id: 'ATT-TRANSFER-CORRECTION', employeeId: 'E01', employeeName: 'Nhân viên hỗ trợ',
      storeId: 'S02', homeStoreId: 'S01', supportTransferId: transfer.id,
      date: '2026-08-20', workDate: '2026-08-20', attendanceDate: '2026-08-20',
      shiftId: 'SUPPORT_TRANSFER_TR_HISTORICAL_CORRECTION', shiftStart: '08:00', shiftEnd: '12:00',
      checkIn: '08:10', checkInAt: '2026-08-20T01:10:00.000Z',
      checkOut: '11:50', checkOutAt: '2026-08-20T04:50:00.000Z', workedSeconds: 13_200, hours: 11 / 3,
      deletedAt: null,
    }]
    const { env, supportAuthorization } = await setupSupportTransferRuntime({
      token: 'bootstrap-transfer-correction', transfer, attendance,
    })

    const extended = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'attendance.update', expectedVersion: 1,
      payload: {
        attendanceId: attendance[0].id, date: '2026-08-20', checkIn: '08:00', checkOut: '23:00',
        reason: 'Không được kéo dài qua thời gian hỗ trợ',
      },
    }, { ...supportAuthorization, 'idempotency-key': 'transfer-correction-out-of-bounds-0001' }), env)
    expect(extended.status).toBe(400)
    expect(await extended.json()).toMatchObject({ error: { code: 'ATTENDANCE_TRANSFER_BOUNDS_INVALID' } })

    const corrected = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'attendance.update', expectedVersion: 1,
      payload: {
        attendanceId: attendance[0].id, date: '2026-08-20', checkIn: '08:00', checkOut: '12:00',
        reason: 'Đối soát đúng thời gian điều chuyển',
      },
    }, { ...supportAuthorization, 'idempotency-key': 'transfer-correction-valid-0001' }), env)
    expect(corrected.status).toBe(200)
    expect(await corrected.json()).toMatchObject({
      version: 2,
      attendance: {
        id: attendance[0].id, storeId: 'S02', supportTransferId: transfer.id,
        checkInAt: '2026-08-20T01:00:00.000Z', checkOutAt: '2026-08-20T05:00:00.000Z',
        workedSeconds: 14_400, departureTag: 'Đã ra về',
      },
      audit: { actor: { role: 'business_support' } },
    })

    const restored = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'operational_reset.restore', expectedVersion: 2,
      payload: {
        dataType: 'attendance', storeId: 'S02', employeeId: 'E01',
        fromDate: '2026-08-20', toDate: '2026-08-20', reason: 'Khôi phục giờ chấm công trước đó',
      },
    }, { ...supportAuthorization, 'idempotency-key': 'transfer-correction-restore-0001' }), env)
    expect(restored.status).toBe(200)
    expect(await restored.json()).toMatchObject({
      version: 3, restoredCount: 1,
      restored: [{ id: attendance[0].id, storeId: 'S02', checkIn: '08:10', checkOut: '11:50' }],
    })
  }, 30_000)

  it('corrects an overnight transferred attendance using absolute next-day checkout time', async () => {
    const transfer = {
      id: 'TR-OVERNIGHT-CORRECTION', employeeId: 'E01', fromStoreId: 'S01', toStoreId: 'S02',
      startAt: '2026-08-31T15:00:00.000Z', endAt: '2026-08-31T19:00:00.000Z',
      fromDate: '2026-08-31', toDate: '2026-09-01', hourlySupportRate: 45_000, allowance: 0,
      status: 'Hoàn tất', completedAt: '2026-08-31T19:00:00.000Z',
    }
    const attendance = [{
      id: 'ATT-OVERNIGHT-CORRECTION', employeeId: 'E01', employeeName: 'Nhân viên hỗ trợ',
      storeId: 'S02', homeStoreId: 'S01', supportTransferId: transfer.id,
      date: '2026-08-31', workDate: '2026-08-31', attendanceDate: '2026-08-31',
      shiftId: 'SUPPORT_TRANSFER_TR_OVERNIGHT_CORRECTION', shiftStart: '22:00', shiftEnd: '02:00',
      checkIn: '22:15', checkInAt: '2026-08-31T15:15:00.000Z',
      checkOut: '01:45', checkOutAt: '2026-08-31T18:45:00.000Z', workedSeconds: 12_600, hours: 3.5,
      deletedAt: null,
    }]
    const { env, adminAuthorization } = await setupSupportTransferRuntime({
      token: 'bootstrap-overnight-correction', transfer, attendance,
    })
    const corrected = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'attendance.update', expectedVersion: 1,
      payload: {
        attendanceId: attendance[0].id, date: '2026-08-31', checkIn: '22:30', checkOut: '01:30',
        reason: 'Đối soát ca hỗ trợ qua đêm',
      },
    }, { ...adminAuthorization, 'idempotency-key': 'overnight-correction-valid-0001' }), env)
    expect(corrected.status).toBe(200)
    expect(await corrected.json()).toMatchObject({
      version: 2,
      attendance: {
        checkInAt: '2026-08-31T15:30:00.000Z', checkOutAt: '2026-08-31T18:30:00.000Z',
        workedSeconds: 10_800, workedMinutes: 180, hours: 3,
        arrivalTag: 'Đi trễ', minutesLate: 30, departureTag: 'Về sớm',
      },
    })
  }, 30_000)

  it('checks into an overnight support transfer using the exact previous-day start instant', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-08-31T17:30:00.000Z')) // 01/09 00:30 Vietnam
      const transfer = {
        id: 'TR-OVERNIGHT', employeeId: 'E01', fromStoreId: 'S01', toStoreId: 'S02',
        startAt: '2026-08-31T15:00:00.000Z', endAt: '2026-08-31T19:00:00.000Z',
        fromDate: '2026-08-31', toDate: '2026-09-01', hourlySupportRate: 45_000, allowance: 180_000,
        status: 'Đã duyệt', createdAt: '2026-08-20T00:00:00.000Z',
      }
      const { env, employeeAuthorization } = await setupSupportTransferRuntime({
        token: 'bootstrap-transfer-overnight', transfer,
      })
      const checkedIn = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'attendance.check_in', expectedVersion: 1,
        payload: { location: { latitude: 10.8, longitude: 106.7, accuracy: 8 } },
      }, { ...employeeAuthorization, 'idempotency-key': 'overnight-transfer-check-in-0001' }), env)
      expect(checkedIn.status).toBe(201)
      expect(await checkedIn.json()).toMatchObject({
        version: 2,
        attendance: {
          date: '2026-09-01', storeId: 'S02', supportTransferId: 'TR-OVERNIGHT',
          shiftStart: '22:00', shiftEnd: '02:00', arrivalTag: 'Đi trễ', minutesLate: 150,
        },
      })
    } finally {
      vi.useRealTimers()
    }
  }, 30_000)

  it('caps cross-month support pay at endAt, invalidates the check-in period and pays allowance once', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-08-31T16:00:00.000Z')) // 31/08 23:00 Vietnam
      const transfer = {
        id: 'TR-CROSS-MONTH', employeeId: 'E01', fromStoreId: 'S01', toStoreId: 'S02',
        startAt: '2026-08-31T15:00:00.000Z', endAt: '2026-08-31T19:00:00.000Z',
        fromDate: '2026-08-31', toDate: '2026-09-01', hourlySupportRate: 45_000, allowance: 180_000,
        status: 'Đã duyệt', createdAt: '2026-08-20T00:00:00.000Z',
      }
      const { env, adminAuthorization, employeeAuthorization, managerAuthorization } = await setupSupportTransferRuntime({
        token: 'bootstrap-transfer-cross-month',
        transfer,
        payrollPeriods: [{
          id: 'PAY-S02-AUG', storeId: 'S02', period: '2026-08', status: 'Đã chốt', rows: [],
          confirmedAt: null, lockedAt: null, needsReclose: false,
        }],
      })
      const checkedIn = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'attendance.check_in', expectedVersion: 1,
        payload: { location: { latitude: 10.8, longitude: 106.7, accuracy: 8 } },
      }, { ...employeeAuthorization, 'idempotency-key': 'cross-month-transfer-check-in-0001' }), env)
      expect(checkedIn.status).toBe(201)
      const attendanceId = (await checkedIn.json()).attendance.id

      vi.setSystemTime(new Date('2026-08-31T16:05:00.000Z'))
      const orderCreated = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'order.create', expectedVersion: 2,
        payload: {
          storeId: 'S02', customerName: 'Khách hỗ trợ', gender: 'Nữ', occupation: 'Kế toán',
          acquisitionChannel: 'Facebook', amount: 100_000, paymentMethod: 'Tiền mặt',
        },
      }, { ...employeeAuthorization, 'idempotency-key': 'cross-month-transfer-order-0001' }), env)
      expect(orderCreated.status).toBe(201)
      const orderBody = await orderCreated.json()

      const deleteLinked = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'support_transfer.delete', expectedVersion: 3,
        payload: { transferId: transfer.id, reason: 'Không được xóa sau khi chấm công' },
      }, { ...adminAuthorization, 'idempotency-key': 'cross-month-transfer-delete-linked-0001' }), env)
      expect(deleteLinked.status).toBe(409)
      expect(await deleteLinked.json()).toMatchObject({ error: { code: 'SUPPORT_TRANSFER_ATTENDANCE_IMMUTABLE' } })
      const cancelLinked = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'support_transfer.update', expectedVersion: 3,
        payload: { transferId: transfer.id, status: 'Đã hủy' },
      }, { ...adminAuthorization, 'idempotency-key': 'cross-month-transfer-cancel-linked-0001' }), env)
      expect(cancelLinked.status).toBe(409)
      expect(await cancelLinked.json()).toMatchObject({ error: { code: 'SUPPORT_TRANSFER_ATTENDANCE_IMMUTABLE' } })

      vi.setSystemTime(new Date('2026-08-31T21:00:00.000Z')) // 01/09 04:00, two hours after endAt
      const checkedOut = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'attendance.check_out', expectedVersion: 3,
        payload: {
          attendanceId, cashRevenue: 100_000, transferRevenue: 0,
          location: { latitude: 10.8, longitude: 106.7, accuracy: 8 },
        },
      }, { ...employeeAuthorization, 'idempotency-key': 'cross-month-transfer-check-out-0001' }), env)
      expect(checkedOut.status).toBe(200)
      expect(await checkedOut.json()).toMatchObject({
        version: 4,
        attendance: {
          storeId: 'S02', supportTransferId: transfer.id,
          elapsedSeconds: 18_000, workedSeconds: 10_800, workedMinutes: 180, hours: 3,
        },
      })
      const afterCheckout = readHydratedState(env.DB.database)
      expect(afterCheckout.payrollPeriods.find(({ id }) => id === 'PAY-S02-AUG')).toMatchObject({
        period: '2026-08', needsReclose: true, invalidationReason: 'attendance.check_out',
      })
      expect(afterCheckout.payrollPeriods.some(({ period }) => period === '2026-09')).toBe(false)
      expect(afterCheckout.supportTransfers.find(({ id }) => id === transfer.id)).toMatchObject({ status: 'Hoàn tất' })

      const historicalManagerStateResponse = await worker.fetch(new Request('https://idosi.example/api/state', {
        headers: managerAuthorization,
      }), env)
      const historicalManagerState = (await historicalManagerStateResponse.json()).state
      expect(historicalManagerState.employees.some(({ id }) => id === 'E01')).toBe(false)
      expect(historicalManagerState.attendance.find(({ id }) => id === attendanceId)).toMatchObject({ storeId: 'S02' })
      expect(historicalManagerState.orders.find(({ id }) => id === orderBody.order.id)).toMatchObject({ storeId: 'S02' })
      expect(historicalManagerState.notifications.find(({ orderId }) => orderId === orderBody.order.id)).toMatchObject({
        type: 'order.created', storeId: 'S02', employeeId: 'E01',
      })

      const augustPayroll = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'payroll.close', expectedVersion: 4, payload: { storeId: 'S02', period: '2026-08' },
      }, { ...adminAuthorization, 'idempotency-key': 'cross-month-transfer-payroll-aug-0001' }), env)
      expect(augustPayroll.status).toBe(200)
      const augustPayrollBody = await augustPayroll.json()
      expect(augustPayrollBody.period.rows.find(({ employeeId }) => employeeId === 'E01')).toMatchObject({
        hours: 3, baseSalary: 135_000, supportHourlyPay: 135_000, supportAllowance: 180_000,
        supportTransferIds: [transfer.id],
      })
      const septemberPayroll = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'payroll.close', expectedVersion: 5, payload: { storeId: 'S02', period: '2026-09' },
      }, { ...adminAuthorization, 'idempotency-key': 'cross-month-transfer-payroll-sep-0001' }), env)
      expect(septemberPayroll.status).toBe(201)
      expect((await septemberPayroll.json()).period.rows.some(({ employeeId }) => employeeId === 'E01')).toBe(false)
      const homePayroll = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'payroll.close', expectedVersion: 6, payload: { storeId: 'S01', period: '2026-08' },
      }, { ...adminAuthorization, 'idempotency-key': 'cross-month-transfer-payroll-home-0001' }), env)
      expect(homePayroll.status).toBe(201)
      const homeEmployeeRow = (await homePayroll.json()).period.rows.find(({ employeeId }) => employeeId === 'E01')
      expect(homeEmployeeRow).toMatchObject({ hours: 0, baseSalary: 0, gross: 0 })
      expect(homeEmployeeRow).not.toHaveProperty('supportAllowance')
      const managerPayrollState = (await (await worker.fetch(new Request('https://idosi.example/api/state', {
        headers: managerAuthorization,
      }), env)).json()).state
      expect(managerPayrollState.payrollPeriods.find(({ period }) => period === '2026-08').rows).toEqual([
        expect.objectContaining({ employeeId: 'E01', supportAllowance: 180_000 }),
      ])
    } finally {
      vi.useRealTimers()
    }
  }, 30_000)

  it('rejects a cross-month checkout for legacy open attendance when the destination period is locked', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-08-31T16:00:00.000Z'))
      const transfer = {
        id: 'TR-LOCKED-AUG', employeeId: 'E01', fromStoreId: 'S01', toStoreId: 'S02',
        startAt: '2026-08-31T15:00:00.000Z', endAt: '2026-08-31T19:00:00.000Z',
        fromDate: '2026-08-31', toDate: '2026-09-01', hourlySupportRate: 45_000, allowance: 180_000,
        status: 'Đã duyệt', createdAt: '2026-08-20T00:00:00.000Z',
      }
      const { env, employeeAuthorization } = await setupSupportTransferRuntime({
        token: 'bootstrap-transfer-locked-aug',
        transfer,
        attendance: [{
          id: 'ATT-LOCKED-AUG-OPEN', employeeId: 'E01', employeeName: 'Nhân viên hỗ trợ',
          storeId: 'S02', homeStoreId: 'S01', supportTransferId: transfer.id,
          date: '2026-08-31', workDate: '2026-08-31', shiftId: 'SUPPORT_TRANSFER_TR_LOCKED_AUG',
          shiftStart: '22:00', shiftEnd: '02:00', checkIn: '23:00', checkInAt: '2026-08-31T16:00:00.000Z',
          checkOut: null, checkOutAt: null, deletedAt: null,
        }],
        payrollPeriods: [{
          id: 'PAY-S02-AUG-LOCKED', storeId: 'S02', period: '2026-08', status: 'Đã khóa', rows: [],
          confirmedAt: '2026-09-01T00:00:00.000Z', lockedAt: '2026-09-01T01:00:00.000Z',
        }],
      })
      vi.setSystemTime(new Date('2026-08-31T17:30:00.000Z')) // September locally, August attendance period
      const checkedOut = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'attendance.check_out', expectedVersion: 1,
        payload: {
          attendanceId: 'ATT-LOCKED-AUG-OPEN', cashRevenue: 0, transferRevenue: 0,
          location: { latitude: 10.8, longitude: 106.7, accuracy: 8 },
        },
      }, { ...employeeAuthorization, 'idempotency-key': 'locked-aug-transfer-check-out-0001' }), env)
      expect(checkedOut.status).toBe(409)
      expect(await checkedOut.json()).toMatchObject({ error: { code: 'PAYROLL_PERIOD_LOCKED' } })
      const state = readHydratedState(env.DB.database)
      expect(env.DB.database.prepare("SELECT version FROM app_state WHERE scope_key = 'global'").get()).toEqual({ version: 1 })
      expect(state.attendance.find(({ id }) => id === 'ATT-LOCKED-AUG-OPEN')).toMatchObject({ checkOutAt: null })
    } finally {
      vi.useRealTimers()
    }
  }, 30_000)

  it('does not complete an active transfer when closing a pre-existing home attendance', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-08-20T07:00:00.000Z'))
      const transfer = {
        id: 'TR-AFTER-HOME-SHIFT', employeeId: 'E01', fromStoreId: 'S01', toStoreId: 'S02',
        startAt: '2026-08-20T07:00:00.000Z', endAt: '2026-08-20T14:00:00.000Z',
        fromDate: '2026-08-20', toDate: '2026-08-20', hourlySupportRate: 45_000, allowance: 180_000,
        status: 'Đã duyệt', createdAt: '2026-08-01T00:00:00.000Z',
      }
      const { env, employeeAuthorization } = await setupSupportTransferRuntime({
        token: 'bootstrap-transfer-home-open',
        transfer,
        attendance: [{
          id: 'ATT-HOME-OPEN', employeeId: 'E01', employeeName: 'Nhân viên hỗ trợ', storeId: 'S01',
          date: '2026-08-20', workDate: '2026-08-20', shiftId: 'HOME-SHIFT', shiftName: 'Ca cửa hàng chính',
          shiftStart: '08:00', shiftEnd: '17:00', checkIn: '08:00', checkInAt: '2026-08-20T01:00:00.000Z',
          checkOut: null, checkOutAt: null, deletedAt: null,
        }],
      })
      const blockedDestinationCheckIn = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'attendance.check_in', expectedVersion: 1,
        payload: { location: { latitude: 10.8, longitude: 106.7, accuracy: 8 } },
      }, { ...employeeAuthorization, 'idempotency-key': 'home-open-destination-check-in-0001' }), env)
      expect(blockedDestinationCheckIn.status).toBe(409)
      expect(await blockedDestinationCheckIn.json()).toMatchObject({ error: { code: 'ATTENDANCE_ALREADY_OPEN' } })

      const homeCheckOut = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'attendance.check_out', expectedVersion: 1,
        payload: {
          attendanceId: 'ATT-HOME-OPEN', cashRevenue: 0, transferRevenue: 0,
          location: { latitude: 10.8, longitude: 106.7, accuracy: 8 },
        },
      }, { ...employeeAuthorization, 'idempotency-key': 'home-open-check-out-0001' }), env)
      expect(homeCheckOut.status).toBe(200)
      expect(await homeCheckOut.json()).toMatchObject({ version: 2, attendance: { storeId: 'S01' } })
      const afterHomeCheckout = readHydratedState(env.DB.database)
      const unchangedTransfer = afterHomeCheckout.supportTransfers.find(({ id }) => id === transfer.id)
      expect(unchangedTransfer).toMatchObject({ status: 'Đã duyệt' })
      expect(unchangedTransfer).not.toHaveProperty('completedAt')

      const destinationCheckIn = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'attendance.check_in', expectedVersion: 2,
        payload: { location: { latitude: 10.8, longitude: 106.7, accuracy: 8 } },
      }, { ...employeeAuthorization, 'idempotency-key': 'after-home-destination-check-in-0001' }), env)
      expect(destinationCheckIn.status).toBe(201)
      expect(await destinationCheckIn.json()).toMatchObject({
        version: 3,
        attendance: { storeId: 'S02', supportTransferId: transfer.id, shiftSource: 'support-transfer' },
      })
    } finally {
      vi.useRealTimers()
    }
  }, 30_000)
})
