// @vitest-environment node

import { Buffer } from 'node:buffer'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { applyVpsDataFixes, TEST_MANAGER_PURGE_MARKER } from './data-fixes.mjs'
import { createSqliteD1 } from './sqlite-d1.mjs'

const temporaryDirectories = []
const timestamp = '2026-09-02T08:00:00.000Z'
const targetProfile = {
  id: 'QLCH-004',
  code: 'QLCH-004',
  employeeCode: 'QLCH-004',
  name: 'Trần Thị Ngọc Bích',
  unit: 'store_manager',
  storeId: 'CH-TNV',
  authUserId: 'usr-manager-test',
  status: 'Đã nghỉ việc',
  deletedAt: '2026-09-01T08:00:00.000Z',
}
const store = { id: 'CH-TNV', name: 'SM TNV' }
const unrelatedEmployee = { id: 'NV-KEEP', code: 'NV-KEEP', name: 'Nhân viên giữ lại', unit: 'store', storeId: 'CH-TNV' }

const temporaryDatabase = async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'idosi-data-fix-'))
  temporaryDirectories.push(directory)
  const databasePath = resolve(directory, 'idosi.sqlite')
  return { databasePath, database: createSqliteD1({ databasePath }) }
}

const insertEntity = async (database, collectionKey, entityKey, value, order = 1_000_000) => {
  const serialized = JSON.stringify(value)
  await database.prepare(`
    INSERT INTO state_entities (
      scope_key, collection_key, entity_key, entity_order,
      value_json, value_bytes, created_at, updated_at
    ) VALUES ('global', ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    collectionKey,
    entityKey,
    order,
    serialized,
    Buffer.byteLength(serialized),
    timestamp,
    timestamp,
  ).run()
}

const seedTargetFixture = async (database, profile = targetProfile) => {
  const compactState = {
    stores: [store],
    employees: [unrelatedEmployee],
    deletedEmployees: [profile],
    attendance: [
      { id: 'ATT-TARGET', employeeId: 'QLCH-004', storeId: 'CH-TNV', checkInAt: '2026-09-01T01:00:00.000Z' },
      { id: 'ATT-KEEP', employeeId: 'NV-KEEP', storeId: 'CH-TNV', checkInAt: '2026-09-01T01:00:00.000Z' },
    ],
    supportWorkSchedules: [
      { id: 'WORK-TARGET', employeeId: 'QLCH-004', date: '2026-09-01' },
      { id: 'WORK-KEEP', employeeId: 'NV-KEEP', date: '2026-09-01' },
    ],
    payrollPeriods: [{
      id: 'PAYROLL-2026-09',
      storeId: 'CH-TNV',
      rows: [
        { employeeId: 'QLCH-004', amount: 0 },
        { employeeId: 'NV-KEEP', amount: 1_000_000 },
      ],
    }],
    orders: [{ id: 'ORDER-KEEP', storeId: 'CH-TNV', createdByEmployeeId: 'QLCH-004', amount: 150_000 }],
    accountSettings: {
      'usr-manager-test': { notifications: true },
      'usr-keep': { notifications: false },
    },
  }
  await database.prepare(`
    INSERT INTO users (
      id, username, username_normalized, display_name, password_hash, password_salt,
      password_iterations, password_algorithm, role, status, version, store_id, employee_id,
      password_updated_at, created_at, updated_at
    ) VALUES
      ('admin-test', 'admin-test', 'admin-test', 'Admin Test', 'hash', 'salt', 100000,
        'PBKDF2-SHA256', 'admin', 'active', 1, NULL, NULL, ?, ?, ?),
      ('usr-manager-test', 'manager-test', 'manager-test', 'Trần Thị Ngọc Bích', 'hash', 'salt', 100000,
        'PBKDF2-SHA256', 'store_manager', 'inactive', 4, 'CH-TNV', 'QLCH-004', ?, ?, ?)
  `).bind(timestamp, timestamp, timestamp, timestamp, timestamp, timestamp).run()
  await database.prepare(`
    INSERT INTO app_state (scope_key, value_json, version, updated_at, updated_by, last_request_id)
    VALUES ('global', ?, 7, ?, 'admin-test', 'fixture-request')
  `).bind(JSON.stringify(compactState), timestamp).run()
  for (const collection of [
    'stores', 'employees', 'deletedEmployees', 'attendance', 'supportWorkSchedules', 'payrollPeriods', 'orders',
  ]) {
    await database.prepare(`
      INSERT INTO state_collections (scope_key, collection_key, created_at, updated_at)
      VALUES ('global', ?, ?, ?)
    `).bind(collection, timestamp, timestamp).run()
  }
  await insertEntity(database, 'stores', 'store-tnv', store)
  await insertEntity(database, 'employees', 'employee-keep', unrelatedEmployee)
  await insertEntity(database, 'deletedEmployees', 'manager-target', profile)
  await insertEntity(database, 'attendance', 'attendance-target', compactState.attendance[0])
  await insertEntity(database, 'attendance', 'attendance-keep', compactState.attendance[1], 2_000_000)
  await insertEntity(database, 'supportWorkSchedules', 'work-target', compactState.supportWorkSchedules[0])
  await insertEntity(database, 'supportWorkSchedules', 'work-keep', compactState.supportWorkSchedules[1], 2_000_000)
  await insertEntity(database, 'payrollPeriods', 'payroll-period', compactState.payrollPeriods[0])
  await insertEntity(database, 'orders', 'order-keep', compactState.orders[0])
  await database.prepare(`
    INSERT INTO sessions (id, token_hash, user_id, created_at, last_seen_at, expires_at)
    VALUES ('session-target', 'token-target', 'usr-manager-test', ?, ?, '2026-09-03T08:00:00.000Z')
  `).bind(timestamp, timestamp).run()
  await database.prepare(`
    INSERT INTO command_receipts (
      actor_id, idempotency_key, request_hash, response_json, status_code, created_at
    ) VALUES ('usr-manager-test', 'target-command', 'hash', '{"ok":true}', 200, ?)
  `).bind(timestamp).run()
  await database.prepare(`
    INSERT INTO audit_log (
      request_id, actor_id, actor_role, action, entity_type, entity_id,
      before_json, after_json, metadata_json, server_timestamp
    ) VALUES
      ('audit-target', 'usr-manager-test', 'store_manager', 'attendance.check_in', 'attendance', 'ATT-TARGET',
        NULL, ?, NULL, ?),
      ('audit-keep', 'admin-test', 'admin', 'store.update', 'store', 'CH-TNV',
        NULL, NULL, '{"kept":true}', ?)
  `).bind(JSON.stringify({ employeeId: 'QLCH-004' }), timestamp, timestamp).run()
}

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('VPS exact test-manager data fix', () => {
  it('purges only QLCH-004 work/account data and is idempotent', async () => {
    const { databasePath, database } = await temporaryDatabase()
    await seedTargetFixture(database)
    database.close()
    vi.spyOn(console, 'info').mockImplementation(() => {})

    const reopened = createSqliteD1({ databasePath })
    expect(reopened.dataFixResult).toMatchObject({
      status: 'applied',
      marker: {
        employeeId: 'QLCH-004',
        storeId: 'CH-TNV',
        deletedByCollection: { deletedEmployees: 1, attendance: 1, supportWorkSchedules: 1 },
        deletedUsers: 1,
        deletedAuditRows: 1,
      },
    })
    expect((await reopened.prepare(`
      SELECT collection_key, value_json FROM state_entities
      WHERE scope_key = 'global' AND collection_key IN ('deletedEmployees', 'attendance', 'supportWorkSchedules')
      ORDER BY collection_key, entity_key
    `).all()).results.map((row) => [row.collection_key, JSON.parse(row.value_json).id])).toEqual([
      ['attendance', 'ATT-KEEP'],
      ['supportWorkSchedules', 'WORK-KEEP'],
    ])
    const payroll = JSON.parse((await reopened.prepare(`
      SELECT value_json FROM state_entities
      WHERE scope_key = 'global' AND collection_key = 'payrollPeriods'
    `).first()).value_json)
    expect(payroll.rows).toEqual([{ employeeId: 'NV-KEEP', amount: 1_000_000 }])
    expect(JSON.parse((await reopened.prepare(`
      SELECT value_json FROM state_entities
      WHERE scope_key = 'global' AND collection_key = 'orders'
    `).first()).value_json)).toMatchObject({ id: 'ORDER-KEEP', createdByEmployeeId: 'QLCH-004' })
    expect(await reopened.prepare("SELECT id FROM users WHERE id = 'usr-manager-test'").first()).toBeNull()
    expect(await reopened.prepare("SELECT id FROM sessions WHERE id = 'session-target'").first()).toBeNull()
    expect(await reopened.prepare("SELECT actor_id FROM command_receipts WHERE idempotency_key = 'target-command'").first()).toBeNull()
    expect((await reopened.prepare('SELECT request_id FROM audit_log ORDER BY request_id').all()).results)
      .toEqual([{ request_id: 'audit-keep' }])

    const compactRow = await reopened.prepare("SELECT value_json, version FROM app_state WHERE scope_key = 'global'").first()
    const compact = JSON.parse(compactRow.value_json)
    expect(compactRow.version).toBe(8)
    expect(compact.deletedEmployees).toEqual([])
    expect(compact.attendance.map(({ id }) => id)).toEqual(['ATT-KEEP'])
    expect(compact.supportWorkSchedules.map(({ id }) => id)).toEqual(['WORK-KEEP'])
    expect(compact.payrollPeriods[0].rows).toEqual([{ employeeId: 'NV-KEEP', amount: 1_000_000 }])
    expect(compact.orders).toEqual([{ id: 'ORDER-KEEP', storeId: 'CH-TNV', createdByEmployeeId: 'QLCH-004', amount: 150_000 }])
    expect(compact.accountSettings).toEqual({ 'usr-keep': { notifications: false } })
    expect(JSON.parse((await reopened.prepare(
      'SELECT value_json FROM system_metadata WHERE meta_key = ?',
    ).bind(TEST_MANAGER_PURGE_MARKER).first()).value_json).status).toBe('applied')
    reopened.close()

    const idempotent = createSqliteD1({ databasePath })
    expect(idempotent.dataFixResult.status).toBe('already_applied')
    expect((await idempotent.prepare("SELECT version FROM app_state WHERE scope_key = 'global'").first()).version).toBe(8)
    idempotent.close()
  }, 30_000)

  it('fails closed without changing data when QLCH-004 has a different identity', async () => {
    const { database } = await temporaryDatabase()
    await seedTargetFixture(database, { ...targetProfile, name: 'Người khác' })

    expect(() => applyVpsDataFixes(database.database, timestamp)).toThrow(/dừng an toàn/u)
    expect(await database.prepare(`
      SELECT entity_key FROM state_entities
      WHERE scope_key = 'global' AND collection_key = 'deletedEmployees'
    `).first()).toEqual({ entity_key: 'manager-target' })
    expect(await database.prepare('SELECT value_json FROM system_metadata WHERE meta_key = ?')
      .bind(TEST_MANAGER_PURGE_MARKER).first()).toBeNull()
    database.close()
  })

  it('accepts the exact legacy manager profile where unit remained store', async () => {
    const { databasePath, database } = await temporaryDatabase()
    await seedTargetFixture(database, {
      ...targetProfile,
      unit: 'store',
      unitType: 'store',
      department: 'store',
      roleType: 'employee',
      accountRole: 'employee',
      position: 'Quản lý cửa hàng',
      jobPosition: 'Quản lý cửa hàng',
      isStoreManager: true,
    })
    database.close()

    const reopened = createSqliteD1({ databasePath })
    expect(reopened.dataFixResult).toMatchObject({
      status: 'applied',
      marker: {
        employeeId: 'QLCH-004',
        deletedByCollection: { deletedEmployees: 1, attendance: 1 },
      },
    })
    reopened.close()
  })
})
