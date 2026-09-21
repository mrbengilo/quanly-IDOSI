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
const setup = () => {
  const database = new DatabaseSync(':memory:')
  BASE_MIGRATIONS.forEach((path) => database.exec(migrationSql(path)))
  database.prepare(`
    INSERT INTO app_state (scope_key, value_json, version, updated_at)
    VALUES ('global', '{}', 1, '2026-09-21T00:00:00+07:00')
  `).run()
  database.exec(migrationSql('drizzle/0008_order_information_options.sql'))
  database.exec(migrationSql('drizzle/0014_order_product_options.sql'))
  return database
}
const products = (database) => database.prepare(`
  SELECT entity_key, value_json, value_bytes
  FROM state_entities
  WHERE scope_key = 'global'
    AND collection_key = 'orderInformationOptions'
    AND json_extract(value_json, '$.kind') = 'product'
  ORDER BY entity_order, entity_key
`).all().map((row) => ({ ...row, value: JSON.parse(row.value_json) }))

describe('0015 retired product names migration', () => {
  it('renames menswear, retires only the old womenswear option and preserves stable IDs', () => {
    const database = setup()
    try {
      const custom = JSON.stringify({
        id: 'custom-women-accessory', kind: 'product', code: 'CUSTOM-WOMEN',
        label: 'Đồ nữ phụ kiện', normalizedLabel: 'đồ nữ phụ kiện', active: true,
        sortOrder: 2500, deletedAt: null,
      })
      database.prepare(`
        INSERT INTO state_entities (
          scope_key, collection_key, entity_key, entity_order,
          value_json, value_bytes, created_at, updated_at
        ) VALUES ('global', 'orderInformationOptions', 'custom-women-accessory', 25000000, ?, ?,
          '2026-09-21T00:00:00+07:00', '2026-09-21T00:00:00+07:00')
      `).run(custom, Buffer.byteLength(custom))

      database.exec(migrationSql('drizzle/0015_retire_legacy_product_names.sql'))
      const firstRows = products(database)
      const byId = Object.fromEntries(firstRows.map((row) => [row.value.id, row]))

      expect(byId['order-product-001'].value).toMatchObject({
        code: 'PRD-001', label: 'Quần áo nam', normalizedLabel: 'quần áo nam', active: true,
      })
      expect(byId['order-product-003'].value).toMatchObject({ code: 'PRD-003', label: 'Áo nữ', active: true })
      expect(byId['order-product-004'].value).toMatchObject({
        code: 'PRD-004', label: 'Đồ nữ', active: false,
        deletedAt: '2026-09-21T00:00:00+07:00', deleteReason: 'Danh mục cũ đã ngừng; sử dụng Áo nữ.',
      })
      expect(byId['order-product-005'].value).toMatchObject({ code: 'PRD-005', label: 'Đồ bộ', active: true })
      expect(byId['custom-women-accessory'].value).toMatchObject({ label: 'Đồ nữ phụ kiện', active: true })
      expect(firstRows.every((row) => Buffer.byteLength(row.value_json) === row.value_bytes)).toBe(true)
      expect(database.prepare(`
        SELECT COUNT(*) AS count FROM system_metadata
        WHERE meta_key = 'migration:0015:retire-legacy-product-names'
      `).get()).toEqual({ count: 1 })

      database.exec(migrationSql('drizzle/0015_retire_legacy_product_names.sql'))
      expect(products(database)).toEqual(firstRows)
      expect(database.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    } finally {
      database.close()
    }
  })

  it('soft-disables an old menswear duplicate when a current option already exists', () => {
    const database = setup()
    try {
      const current = JSON.stringify({
        id: 'custom-current-menswear', kind: 'product', code: 'CURRENT-MEN',
        label: 'Quần áo nam', normalizedLabel: 'quần áo nam', active: true,
        sortOrder: 1950, deletedAt: null,
      })
      database.prepare(`
        INSERT INTO state_entities (
          scope_key, collection_key, entity_key, entity_order,
          value_json, value_bytes, created_at, updated_at
        ) VALUES ('global', 'orderInformationOptions', 'custom-current-menswear', 19500000, ?, ?,
          '2026-09-21T00:00:00+07:00', '2026-09-21T00:00:00+07:00')
      `).run(current, Buffer.byteLength(current))

      database.exec(migrationSql('drizzle/0015_retire_legacy_product_names.sql'))
      const byId = Object.fromEntries(products(database).map((row) => [row.value.id, row.value]))
      expect(byId['order-product-001']).toMatchObject({ label: 'Đồ nam', active: false })
      expect(byId['custom-current-menswear']).toMatchObject({ label: 'Quần áo nam', active: true })
    } finally {
      database.close()
    }
  })
})
