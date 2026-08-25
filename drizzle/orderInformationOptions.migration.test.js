// @vitest-environment node

import { Buffer } from 'node:buffer'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'

const BASE_MIGRATIONS = [
  'drizzle/0000_idosi_core.sql',
  'drizzle/0001_manager_role.sql',
  'drizzle/0002_attendance_evaluation_policies.sql',
  'drizzle/0003_state_entities.sql',
  'drizzle/0004_operational_roles.sql',
  'drizzle/0005_admin_only_accounts.sql',
  'drizzle/0006_recursive_profile_secret_scrub.sql',
  'drizzle/0007_session_roles.sql',
]

const migrationSql = (path) => readFileSync(path, 'utf8').replaceAll('--> statement-breakpoint', '')

const createDatabaseBeforeMigration = () => {
  const database = new DatabaseSync(':memory:')
  BASE_MIGRATIONS.forEach((path) => database.exec(migrationSql(path)))
  return database
}

const orderInformationRows = (database) => database.prepare(`
  SELECT entity_key, entity_order, value_json, value_bytes, created_at, updated_at
  FROM state_entities
  WHERE scope_key = 'global' AND collection_key = 'orderInformationOptions'
  ORDER BY entity_order, entity_key
`).all()

describe('0008 order information options migration', () => {
  it('leaves an uninitialized database for the atomic bootstrap flow', () => {
    const database = createDatabaseBeforeMigration()
    try {
      database.exec(migrationSql('drizzle/0008_order_information_options.sql'))
      database.exec(migrationSql('drizzle/0008_order_information_options.sql'))

      expect(database.prepare("SELECT COUNT(*) AS count FROM app_state WHERE scope_key = 'global'").get()).toEqual({ count: 0 })
      expect(database.prepare("SELECT COUNT(*) AS count FROM state_collections WHERE collection_key = 'orderInformationOptions'").get()).toEqual({ count: 0 })
      expect(database.prepare("SELECT COUNT(*) AS count FROM state_entities WHERE collection_key = 'orderInformationOptions'").get()).toEqual({ count: 0 })
    } finally {
      database.close()
    }
  })

  it('Unicode-folds Vietnamese labels without data loss while idempotently filling 17 canonical defaults', () => {
    const database = createDatabaseBeforeMigration()
    const existingOccupation = {
      id: 'order-occupation-001',
      kind: 'occupation',
      code: 'OCC-001',
      label: 'Nhân viên VP',
      normalizedLabel: 'nhân viên vp',
      active: false,
      sortOrder: 100,
      system: false,
      note: 'Giữ nguyên tùy chỉnh production',
      deletedAt: '2026-08-24T00:00:00+07:00',
    }
    const customOccupation = {
      id: 'order-occupation-custom-architect',
      kind: 'occupation',
      code: 'OCC-ARCHITECT',
      label: 'Kiến trúc sư',
      normalizedLabel: 'kiến trúc sư',
      active: true,
      sortOrder: 175,
    }
    const legacyCaseVariant = {
      id: 'legacy-doctor',
      kind: 'occupation',
      code: 'LEGACY-DOCTOR',
      label: '  BÁC SĨ  ',
      active: true,
      sortOrder: 250,
    }
    const legacyCashPayment = {
      id: 'legacy-cash-payment',
      kind: 'payment_method',
      code: 'LEGACY-CASH',
      label: '  TIỀN MẶT  ',
      active: true,
      system: true,
      sortOrder: 1600,
    }
    const compactState = JSON.stringify({
      scalar: 'must-survive',
      orderInformationOptions: [existingOccupation, customOccupation, legacyCaseVariant, legacyCashPayment],
    })
    const unrelatedValue = JSON.stringify({ id: 'ORDER-KEEP', amount: 123456 })

    try {
      database.prepare(`
        INSERT INTO app_state (
          scope_key, value_json, version, updated_at, updated_by, last_request_id
        ) VALUES ('global', ?, 7, '2026-08-24T12:34:56+07:00', NULL, 'state-before-0008')
      `).run(compactState)
      database.prepare(`
        INSERT INTO state_collections (scope_key, collection_key, created_at, updated_at)
        VALUES ('global', 'orders', '2026-08-24T12:34:56+07:00', '2026-08-24T12:34:56+07:00')
      `).run()
      database.prepare(`
        INSERT INTO state_entities (
          scope_key, collection_key, entity_key, entity_order,
          value_json, value_bytes, created_at, updated_at
        ) VALUES (
          'global', 'orders', 'id:ORDER-KEEP', 1000000,
          ?, ?, '2026-08-24T12:34:56+07:00', '2026-08-24T12:34:56+07:00'
        )
      `).run(unrelatedValue, Buffer.byteLength(unrelatedValue))

      database.exec(migrationSql('drizzle/0008_order_information_options.sql'))

      const firstRows = orderInformationRows(database)
      const options = firstRows.map(({ value_json: valueJson }) => JSON.parse(valueJson))
      const byId = new Map(options.map((option) => [option.id, option]))
      expect(options).toHaveLength(18)
      expect([...Array(15)].map((_, index) => `order-occupation-${String(index + 1).padStart(3, '0')}`)
        .filter((id) => id !== 'order-occupation-003')
        .every((id) => byId.has(id))).toBe(true)
      expect([...Array(15)].map((_, index) => `OCC-${String(index + 1).padStart(3, '0')}`)
        .filter((code) => code !== 'OCC-003')
        .every((code) => options.some((option) => option.code === code))).toBe(true)
      expect(byId.get(existingOccupation.id)).toEqual(existingOccupation)
      expect(byId.get(customOccupation.id)).toEqual(customOccupation)
      expect(byId.get(legacyCaseVariant.id)).toEqual(legacyCaseVariant)
      expect(byId.get(legacyCashPayment.id)).toEqual(legacyCashPayment)
      expect(byId.has('order-occupation-003')).toBe(false)
      expect(byId.has('order-payment-001')).toBe(false)
      expect(byId.get('order-occupation-002')).toMatchObject({
        code: 'OCC-002', label: 'Kỹ sư', active: true, system: false, sortOrder: 200,
      })
      expect(byId.get('order-payment-002')).toMatchObject({
        kind: 'payment_method', code: 'PAY-002', label: 'Chuyển khoản', active: true, system: true, sortOrder: 1700,
      })
      expect(firstRows.every(({ value_json: valueJson, value_bytes: valueBytes }) => (
        Buffer.byteLength(valueJson) === valueBytes
      ))).toBe(true)

      expect(database.prepare(`
        SELECT value_json, version, updated_at, updated_by, last_request_id
        FROM app_state WHERE scope_key = 'global'
      `).get()).toEqual({
        value_json: compactState,
        version: 7,
        updated_at: '2026-08-24T12:34:56+07:00',
        updated_by: null,
        last_request_id: 'state-before-0008',
      })
      expect(database.prepare(`
        SELECT entity_key, entity_order, value_json, value_bytes, created_at, updated_at
        FROM state_entities
        WHERE scope_key = 'global' AND collection_key = 'orders'
      `).get()).toEqual({
        entity_key: 'id:ORDER-KEEP',
        entity_order: 1000000,
        value_json: unrelatedValue,
        value_bytes: Buffer.byteLength(unrelatedValue),
        created_at: '2026-08-24T12:34:56+07:00',
        updated_at: '2026-08-24T12:34:56+07:00',
      })

      database.exec(migrationSql('drizzle/0008_order_information_options.sql'))
      expect(orderInformationRows(database)).toEqual(firstRows)
      expect(database.prepare(`
        SELECT COUNT(*) AS count FROM system_metadata
        WHERE meta_key = 'migration:0008:order-information-options'
      `).get()).toEqual({ count: 1 })
      expect(JSON.parse(database.prepare(`
        SELECT value_json FROM system_metadata
        WHERE meta_key = 'migration:0008:order-information-options'
      `).get().value_json)).toMatchObject({
        canonicalSeedCount: 17,
        occupationSeedCount: 15,
        paymentMethodSeedCount: 2,
      })
      expect(database.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    } finally {
      database.close()
    }
  })
})
