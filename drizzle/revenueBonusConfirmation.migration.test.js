// @vitest-environment node

import { readFileSync } from 'node:fs'
import { Buffer } from 'node:buffer'
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
        revenueBonusDaily: [
          { id: 'legacy', status: 'APPROVED', calculatedAt: '2026-08-20T12:00:00Z' },
          { id: 'localized-approved', status: 'Đã duyệt', calculatedAt: '2026-08-20T12:00:00Z' },
          { id: 'localized-confirmed', status: 'Đã xác nhận', calculatedAt: '2026-08-20T12:00:00Z' },
          { id: 'draft', status: 'DRAFT' },
        ],
        revenueBonusAllocations: [
          { id: 'allocation', status: 'APPROVED', amountVnd: 100_000, approvedAt: '2026-08-20T12:00:00Z' },
          { id: 'localized-allocation', status: 'Đã duyệt', amountVnd: 250_000, approvedAt: '2026-08-20T12:00:00Z' },
        ],
      }
      database.prepare("INSERT INTO app_state (scope_key, value_json, version, updated_at) VALUES ('global', ?, 1, '2026-08-20T12:00:00Z')").run(JSON.stringify(state))
      database.exec(sql('drizzle/0012_revenue_bonus_confirmation.sql'))
      const migrated = JSON.parse(database.prepare("SELECT value_json FROM app_state WHERE scope_key = 'global'").get().value_json)
      expect(migrated.revenueBonusDaily).toEqual([
        expect.objectContaining({ id: 'legacy', status: 'CONFIRMED', confirmedAt: '2026-08-20T12:00:00Z' }),
        expect.objectContaining({ id: 'localized-approved', status: 'CONFIRMED', confirmedAt: '2026-08-20T12:00:00Z' }),
        expect.objectContaining({ id: 'localized-confirmed', status: 'CONFIRMED', confirmedAt: '2026-08-20T12:00:00Z' }),
        { id: 'draft', status: 'DRAFT' },
      ])
      expect(migrated.revenueBonusAllocations[0]).toMatchObject({ status: 'CONFIRMED' })
      expect(migrated.revenueBonusAllocations[1]).toMatchObject({ status: 'CONFIRMED', amountVnd: 250_000 })
      database.exec(sql('drizzle/0012_revenue_bonus_confirmation.sql'))
      const migratedAgain = JSON.parse(database.prepare("SELECT value_json FROM app_state WHERE scope_key = 'global'").get().value_json)
      expect(migratedAgain).toEqual(migrated)
      expect(database.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    } finally {
      database.close()
    }
  })

  it('normalizes localized official statuses in externalized daily and allocation rows', () => {
    const database = new DatabaseSync(':memory:')
    try {
      for (let index = 0; index <= 11; index += 1) {
        const name = ['idosi_core', 'manager_role', 'attendance_evaluation_policies', 'state_entities', 'operational_roles', 'admin_only_accounts', 'recursive_profile_secret_scrub', 'session_roles', 'order_information_options', 'compensation_foundation', 'store_employee_salary_configs', 'work_catalog'][index]
        database.exec(sql(`drizzle/${String(index).padStart(4, '0')}_${name}.sql`))
      }
      database.prepare("INSERT INTO app_state (scope_key, value_json, version, updated_at) VALUES ('global', '{}', 1, '2026-08-20T12:00:00Z')").run()
      for (const collection of ['revenueBonusDaily', 'revenueBonusAllocations']) {
        database.prepare('INSERT INTO state_collections (scope_key, collection_key, created_at, updated_at) VALUES (?, ?, ?, ?)').run('global', collection, '2026-08-20T12:00:00Z', '2026-08-20T12:00:00Z')
        const value = JSON.stringify({ id: collection, status: collection === 'revenueBonusDaily' ? 'Đã xác nhận' : 'Đã duyệt', amountVnd: 175_000 })
        database.prepare('INSERT INTO state_entities (scope_key, collection_key, entity_key, entity_order, value_json, value_bytes, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?, ?, ?)').run('global', collection, collection, value, Buffer.byteLength(value), '2026-08-20T12:00:00Z', '2026-08-20T12:00:00Z')
      }
      database.exec(sql('drizzle/0012_revenue_bonus_confirmation.sql'))
      const rows = database.prepare("SELECT value_json FROM state_entities WHERE scope_key = 'global' ORDER BY collection_key").all().map(({ value_json }) => JSON.parse(value_json))
      expect(rows).toEqual([
        expect.objectContaining({ status: 'CONFIRMED', amountVnd: 175_000 }),
        expect.objectContaining({ status: 'CONFIRMED', amountVnd: 175_000 }),
      ])
      database.exec(sql('drizzle/0012_revenue_bonus_confirmation.sql'))
      expect(database.prepare("SELECT COUNT(*) AS count FROM state_entities WHERE json_extract(value_json, '$.status') = 'CONFIRMED'").get()).toEqual({ count: 2 })
    } finally {
      database.close()
    }
  })
})
