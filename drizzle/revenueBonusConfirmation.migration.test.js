// @vitest-environment node

import { readFileSync } from 'node:fs'
import { Buffer } from 'node:buffer'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'

const sql = (path) => readFileSync(path, 'utf8').replaceAll('--> statement-breakpoint', '')
const migration = () => sql('drizzle/0012_revenue_bonus_confirmation.sql')
const migrations = ['idosi_core', 'manager_role', 'attendance_evaluation_policies', 'state_entities', 'operational_roles', 'admin_only_accounts', 'recursive_profile_secret_scrub', 'session_roles', 'order_information_options', 'compensation_foundation', 'store_employee_salary_configs', 'work_catalog']

const databaseWithSchema = () => {
  const database = new DatabaseSync(':memory:')
  migrations.forEach((name, index) => database.exec(sql(`drizzle/${String(index).padStart(4, '0')}_${name}.sql`)))
  database.exec('CREATE TABLE update_audit (target TEXT NOT NULL); CREATE TRIGGER audit_app_state AFTER UPDATE ON app_state BEGIN INSERT INTO update_audit VALUES (\'app_state\'); END; CREATE TRIGGER audit_state_entities AFTER UPDATE ON state_entities BEGIN INSERT INTO update_audit VALUES (\'state_entities\'); END;')
  return database
}

const officialVariants = ['APPROVED', 'approved', 'ACTIVE', 'confirmed', 'Đã duyệt', 'ĐÃ DUYỆT', 'đã duyệt', 'Đã DuYệT', 'Đã xác nhận', 'ĐÃ XÁC NHẬN', 'đã xác nhận', 'Đã XáC NhẬn']

describe('0012 revenue bonus confirmation migration', () => {
  it('canonicalizes compact daily/allocation variants once without touching unrelated states or metadata', () => {
    const database = databaseWithSchema()
    try {
      const preserved = { confirmedAt: '2026-08-19T01:00:00Z', confirmedBy: { id: 'ORIGINAL' } }
      const untouched = ['DRAFT', 'REJECTED', 'SUPERSEDED'].map((status) => ({ id: status, status }))
      const state = {
        revenueBonusDaily: [
          ...officialVariants.map((status, index) => ({ id: `daily-${index}`, status, amountVnd: 100 + index, ...preserved })),
          { id: 'canonical-daily', status: 'CONFIRMED', amountVnd: 999, ...preserved }, ...untouched,
        ],
        revenueBonusAllocations: [
          ...officialVariants.map((status, index) => ({ id: `allocation-${index}`, status, amountVnd: 200 + index, ...preserved })),
          { id: 'canonical-allocation', status: 'CONFIRMED', amountVnd: 888, ...preserved }, ...untouched,
        ],
        unrelated: [{ id: 'keep', status: 'APPROVED' }],
      }
      database.prepare("INSERT INTO app_state (scope_key, value_json, version, updated_at) VALUES ('global', ?, 1, '2026-08-20T12:00:00Z')").run(JSON.stringify(state))
      database.exec(migration())
      const first = database.prepare("SELECT value_json, updated_at FROM app_state WHERE scope_key = 'global'").get()
      const migrated = JSON.parse(first.value_json)
      for (const collection of ['revenueBonusDaily', 'revenueBonusAllocations']) {
        expect(migrated[collection].slice(0, officialVariants.length)).toEqual(officialVariants.map((_status, index) => expect.objectContaining({
          status: 'CONFIRMED', amountVnd: (collection === 'revenueBonusDaily' ? 100 : 200) + index, ...preserved,
        })))
        expect(migrated[collection].slice(officialVariants.length)).toEqual([
          expect.objectContaining({ status: 'CONFIRMED', ...preserved }), ...untouched,
        ])
      }
      expect(migrated.unrelated).toEqual(state.unrelated)
      expect(database.prepare("SELECT count(*) AS count FROM update_audit WHERE target = 'app_state'").get()).toEqual({ count: 1 })
      database.exec(migration())
      expect(database.prepare("SELECT value_json, updated_at FROM app_state WHERE scope_key = 'global'").get()).toEqual(first)
      expect(database.prepare("SELECT count(*) AS count FROM update_audit WHERE target = 'app_state'").get()).toEqual({ count: 1 })
      expect(database.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    } finally { database.close() }
  })

  it('updates only legacy externalized rows and makes canonical/empty compact state a write-free no-op', () => {
    const database = databaseWithSchema()
    try {
      const compact = JSON.stringify({ revenueBonusDaily: [], revenueBonusAllocations: [], unrelated: true })
      database.prepare("INSERT INTO app_state (scope_key, value_json, version, updated_at) VALUES ('global', ?, 1, '2026-08-20T12:00:00Z')").run(compact)
      for (const collection of ['revenueBonusDaily', 'revenueBonusAllocations']) {
        database.prepare('INSERT INTO state_collections (scope_key, collection_key, created_at, updated_at) VALUES (?, ?, ?, ?)').run('global', collection, '2026-08-20T12:00:00Z', '2026-08-20T12:00:00Z')
        for (const [index, status] of ['ĐÃ DUYỆT', 'Đã XáC NhẬn', 'CONFIRMED', 'DRAFT'].entries()) {
          const value = JSON.stringify({ id: `${collection}-${index}`, status, amountVnd: 175_000 + index, confirmedAt: '2026-08-18T00:00:00Z', confirmedBy: { id: 'KEEP' } })
          database.prepare('INSERT INTO state_entities (scope_key, collection_key, entity_key, entity_order, value_json, value_bytes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run('global', collection, `${collection}-${index}`, index + 1, value, Buffer.byteLength(value), '2026-08-20T12:00:00Z', `2026-08-20T12:00:0${index}Z`)
        }
      }
      database.exec(migration())
      const first = database.prepare('SELECT entity_key, value_json, updated_at FROM state_entities ORDER BY entity_key').all()
      expect(first.map(({ value_json }) => JSON.parse(value_json).status)).toEqual(['CONFIRMED', 'CONFIRMED', 'CONFIRMED', 'DRAFT', 'CONFIRMED', 'CONFIRMED', 'CONFIRMED', 'DRAFT'])
      expect(first.map(({ value_json }) => JSON.parse(value_json).confirmedBy)).toEqual(Array(8).fill({ id: 'KEEP' }))
      expect(database.prepare("SELECT count(*) AS count FROM update_audit WHERE target = 'state_entities'").get()).toEqual({ count: 4 })
      expect(database.prepare("SELECT count(*) AS count FROM update_audit WHERE target = 'app_state'").get()).toEqual({ count: 0 })
      database.exec(migration())
      expect(database.prepare('SELECT entity_key, value_json, updated_at FROM state_entities ORDER BY entity_key').all()).toEqual(first)
      expect(database.prepare("SELECT count(*) AS count FROM update_audit WHERE target = 'state_entities'").get()).toEqual({ count: 4 })
      expect(database.prepare("SELECT value_json, updated_at FROM app_state WHERE scope_key = 'global'").get()).toEqual({ value_json: compact, updated_at: '2026-08-20T12:00:00Z' })
      expect(database.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    } finally { database.close() }
  })
})
