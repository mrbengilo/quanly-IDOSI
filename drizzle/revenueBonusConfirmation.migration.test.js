// @vitest-environment node

import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'

const sql = (path) => readFileSync(path, 'utf8').replaceAll('--> statement-breakpoint', '')

describe('0012 revenue bonus confirmation migration', () => {
  it('preserves legacy official bonuses as confirmed and leaves drafts unchanged', () => {
    const database = new DatabaseSync(':memory:')
    try {
      for (let index = 0; index <= 11; index += 1) {
        const name = ['idosi_core', 'manager_role', 'attendance_evaluation_policies', 'state_entities', 'operational_roles', 'admin_only_accounts', 'recursive_profile_secret_scrub', 'session_roles', 'order_information_options', 'compensation_foundation', 'store_employee_salary_configs', 'work_catalog'][index]
        database.exec(sql(`drizzle/${String(index).padStart(4, '0')}_${name}.sql`))
      }
      const state = {
        revenueBonusDaily: [{ id: 'legacy', status: 'APPROVED', calculatedAt: '2026-08-20T12:00:00Z' }, { id: 'draft', status: 'DRAFT' }],
        revenueBonusAllocations: [{ id: 'allocation', status: 'APPROVED', approvedAt: '2026-08-20T12:00:00Z' }],
      }
      database.prepare("INSERT INTO app_state (scope_key, value_json, version, updated_at) VALUES ('global', ?, 1, '2026-08-20T12:00:00Z')").run(JSON.stringify(state))
      database.exec(sql('drizzle/0012_revenue_bonus_confirmation.sql'))
      const migrated = JSON.parse(database.prepare("SELECT value_json FROM app_state WHERE scope_key = 'global'").get().value_json)
      expect(migrated.revenueBonusDaily).toEqual([
        expect.objectContaining({ id: 'legacy', status: 'CONFIRMED', confirmedAt: '2026-08-20T12:00:00Z' }),
        { id: 'draft', status: 'DRAFT' },
      ])
      expect(migrated.revenueBonusAllocations[0]).toMatchObject({ status: 'CONFIRMED' })
      expect(database.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    } finally {
      database.close()
    }
  })
})
