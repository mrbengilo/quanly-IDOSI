// @vitest-environment node

import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'

const PREVIOUS_MIGRATIONS = [
  'drizzle/0000_idosi_core.sql',
  'drizzle/0001_manager_role.sql',
  'drizzle/0002_attendance_evaluation_policies.sql',
  'drizzle/0003_state_entities.sql',
  'drizzle/0004_operational_roles.sql',
  'drizzle/0005_admin_only_accounts.sql',
  'drizzle/0006_recursive_profile_secret_scrub.sql',
  'drizzle/0007_session_roles.sql',
  'drizzle/0008_order_information_options.sql',
  'drizzle/0009_compensation_foundation.sql',
  'drizzle/0010_store_employee_salary_configs.sql',
]

const migrationSql = (path) => readFileSync(path, 'utf8').replaceAll('--> statement-breakpoint', '')

const databaseBeforeMigration = () => {
  const database = new DatabaseSync(':memory:')
  PREVIOUS_MIGRATIONS.forEach((path) => database.exec(migrationSql(path)))
  return database
}

describe('0011 work catalog migration', () => {
  it('keeps an uninitialized database empty for atomic bootstrap', () => {
    const database = databaseBeforeMigration()
    try {
      database.exec(migrationSql('drizzle/0011_work_catalog.sql'))
      expect(database.prepare('SELECT COUNT(*) AS count FROM state_collections').get()).toEqual({ count: 0 })
      expect(database.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    } finally {
      database.close()
    }
  })

  it('registers both collections idempotently without changing historical state', () => {
    const database = databaseBeforeMigration()
    const historicalState = JSON.stringify({
      employees: [{ id: 'ST-001', name: 'Nhân viên cũ' }],
      attendance: [{ id: 'ATT-001', checklistSnapshot: { tasks: [{ id: 'legacy-task' }] } }],
      violations: [{ id: 'VIO-001', policyCode: 'legacy.violation', amountVnd: 35_000 }],
    })
    try {
      database.prepare(`
        INSERT INTO app_state (scope_key, value_json, version, updated_at, updated_by, last_request_id)
        VALUES ('global', ?, 4, '2026-08-26T00:00:00+07:00', NULL, 'before-0011')
      `).run(historicalState)

      database.exec(migrationSql('drizzle/0011_work_catalog.sql'))
      database.exec(migrationSql('drizzle/0011_work_catalog.sql'))

      expect(database.prepare(`
        SELECT collection_key
        FROM state_collections
        WHERE scope_key = 'global'
          AND collection_key IN ('workCatalogItems', 'workCatalogProgress')
        ORDER BY collection_key
      `).all()).toEqual([
        { collection_key: 'workCatalogItems' },
        { collection_key: 'workCatalogProgress' },
      ])
      expect(database.prepare("SELECT value_json FROM app_state WHERE scope_key = 'global'").get())
        .toEqual({ value_json: historicalState })
      expect(database.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    } finally {
      database.close()
    }
  })
})
