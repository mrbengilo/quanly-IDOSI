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
const databaseBeforeMigration = () => {
  const database = new DatabaseSync(':memory:')
  BASE_MIGRATIONS.forEach((path) => database.exec(migrationSql(path)))
  return database
}

const productRows = (database) => database.prepare(`
  SELECT value_json, value_bytes
  FROM state_entities
  WHERE scope_key = 'global'
    AND collection_key = 'orderInformationOptions'
    AND json_extract(value_json, '$.kind') = 'product'
  ORDER BY entity_order, entity_key
`).all()

describe('0014 order product options migration', () => {
  it('leaves an uninitialized database for atomic bootstrap', () => {
    const database = databaseBeforeMigration()
    try {
      database.exec(migrationSql('drizzle/0014_order_product_options.sql'))
      expect(productRows(database)).toEqual([])
      expect(database.prepare(`SELECT COUNT(*) AS count FROM system_metadata WHERE meta_key = 'migration:0014:order-product-options'`).get()).toEqual({ count: 0 })
    } finally {
      database.close()
    }
  })

  it('idempotently fills missing products while preserving an existing Vietnamese label variant', () => {
    const database = databaseBeforeMigration()
    try {
      database.prepare(`
        INSERT INTO app_state (scope_key, value_json, version, updated_at)
        VALUES ('global', '{}', 1, '2026-09-12T00:00:00+07:00')
      `).run()
      database.exec(migrationSql('drizzle/0008_order_information_options.sql'))
      const custom = JSON.stringify({
        id: 'legacy-menswear', kind: 'product', code: 'LEGACY-MEN', label: '  ĐỒ NAM  ', active: true, sortOrder: 1950,
      })
      database.prepare(`
        INSERT INTO state_entities (
          scope_key, collection_key, entity_key, entity_order,
          value_json, value_bytes, created_at, updated_at
        ) VALUES ('global', 'orderInformationOptions', 'legacy-menswear', 19500000, ?, ?, '2026-09-12T00:00:00+07:00', '2026-09-12T00:00:00+07:00')
      `).run(custom, Buffer.byteLength(custom))

      database.exec(migrationSql('drizzle/0014_order_product_options.sql'))
      const firstRows = productRows(database)
      const products = firstRows.map((row) => JSON.parse(row.value_json))
      expect(products).toHaveLength(5)
      expect(products.filter((product) => product.label.trim().toLocaleLowerCase('vi-VN') === 'đồ nam')).toHaveLength(1)
      expect(products.map((product) => product.label)).toEqual(expect.arrayContaining(['  ĐỒ NAM  ', 'Đầm', 'Áo nữ', 'Đồ nữ', 'Đồ bộ']))
      expect(firstRows.every((row) => Buffer.byteLength(row.value_json) === row.value_bytes)).toBe(true)

      database.exec(migrationSql('drizzle/0014_order_product_options.sql'))
      expect(productRows(database)).toEqual(firstRows)
      expect(JSON.parse(database.prepare(`SELECT value_json FROM system_metadata WHERE meta_key = 'migration:0014:order-product-options'`).get().value_json)).toMatchObject({ productSeedCount: 5 })
      expect(database.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    } finally {
      database.close()
    }
  })
})
