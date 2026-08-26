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
]

const migrationSql = (path) => readFileSync(path, 'utf8').replaceAll('--> statement-breakpoint', '')

const databaseBeforeMigration = () => {
  const database = new DatabaseSync(':memory:')
  PREVIOUS_MIGRATIONS.forEach((path) => database.exec(migrationSql(path)))
  return database
}

describe('0010 store employee salary configs migration', () => {
  it('keeps an uninitialized database empty for atomic bootstrap', () => {
    const database = databaseBeforeMigration()
    try {
      database.exec(migrationSql('drizzle/0010_store_employee_salary_configs.sql'))
      expect(database.prepare('SELECT COUNT(*) AS count FROM state_collections').get()).toEqual({ count: 0 })
      expect(database.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    } finally {
      database.close()
    }
  })

  it('registers the collection idempotently without changing legacy employee or payroll data', () => {
    const database = databaseBeforeMigration()
    const state = {
      employees: [{
        id: 'DOSII-TNV-001',
        storeId: 'CH002',
        employmentType: 'Full-Time',
        salary: 8_000_000,
        monthlySalary: 8_000_000,
        baseSalary: 8_000_000,
      }],
      payrollPeriods: [{
        id: 'payroll-legacy',
        storeId: 'CH002',
        period: '2026-07',
        status: 'Đã khóa',
        rows: [{ employeeId: 'DOSII-TNV-001', baseSalary: 8_000_000 }],
      }],
    }
    const stateJson = JSON.stringify(state)

    try {
      database.prepare(`
        INSERT INTO app_state (scope_key, value_json, version, updated_at, updated_by, last_request_id)
        VALUES ('global', ?, 3, '2026-08-26T00:00:00+07:00', NULL, 'before-0010')
      `).run(stateJson)

      database.exec(migrationSql('drizzle/0010_store_employee_salary_configs.sql'))
      database.exec(migrationSql('drizzle/0010_store_employee_salary_configs.sql'))

      expect(database.prepare(`
        SELECT collection_key
        FROM state_collections
        WHERE scope_key = 'global' AND collection_key = 'storeEmployeeSalaryConfigs'
      `).all()).toEqual([{ collection_key: 'storeEmployeeSalaryConfigs' }])
      expect(database.prepare("SELECT value_json FROM app_state WHERE scope_key = 'global'").get())
        .toEqual({ value_json: stateJson })
      expect(database.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    } finally {
      database.close()
    }
  })
})
