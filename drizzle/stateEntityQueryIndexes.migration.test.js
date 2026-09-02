// @vitest-environment node

import { afterEach, describe, expect, it } from 'vitest'
import { Buffer } from 'node:buffer'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'

const databases = []
const migrationSql = (path) => readFileSync(path, 'utf8').replaceAll('--> statement-breakpoint', '')

afterEach(() => {
  while (databases.length) databases.pop().close()
})

describe('0012 state entity query indexes migration', () => {
  it('backfills indexed store, employee, date, and period dimensions without changing JSON', () => {
    const database = new DatabaseSync(':memory:')
    databases.push(database)
    for (const migration of [
      'drizzle/0000_idosi_core.sql',
      'drizzle/0001_manager_role.sql',
      'drizzle/0002_attendance_evaluation_policies.sql',
      'drizzle/0003_state_entities.sql',
    ]) database.exec(migrationSql(migration))

    const now = '2026-09-02T08:00:00.000Z'
    database.prepare(`
      INSERT INTO app_state (scope_key, value_json, version, updated_at, updated_by, last_request_id)
      VALUES ('global', '{}', 1, ?, NULL, 'request-1')
    `).run(now)
    database.prepare(`
      INSERT INTO state_collections (scope_key, collection_key, created_at, updated_at)
      VALUES ('global', 'compensationEntries', ?, ?)
    `).run(now, now)
    const record = JSON.stringify({
      id: 'COMP-1', storeId: 'S01', employeeId: 'E01',
      effectiveDate: '2026-09-02', amountVnd: 50000,
    })
    database.prepare(`
      INSERT INTO state_entities (
        scope_key, collection_key, entity_key, entity_order,
        value_json, value_bytes, created_at, updated_at
      ) VALUES ('global', 'compensationEntries', 'COMP-1', 1000000, ?, ?, ?, ?)
    `).run(record, Buffer.byteLength(record), now, now)
    database.prepare(`
      INSERT INTO state_collections (scope_key, collection_key, created_at, updated_at)
      VALUES ('global', 'attendance', ?, ?)
    `).run(now, now)
    const openAttendance = JSON.stringify({ id: 'ATT-1', storeId: 'S01', employeeId: 'E01' })
    database.prepare(`
      INSERT INTO state_entities (
        scope_key, collection_key, entity_key, entity_order,
        value_json, value_bytes, created_at, updated_at
      ) VALUES ('global', 'attendance', 'ATT-1', 1000000, ?, ?, ?, ?)
    `).run(openAttendance, Buffer.byteLength(openAttendance), now, now)

    database.exec(migrationSql('drizzle/0012_state_entity_query_indexes.sql'))

    expect(database.prepare(`
      SELECT store_id, employee_id, occurred_on, period_key, record_id, value_json
      FROM state_entities WHERE entity_key = 'COMP-1'
    `).get()).toEqual({
      store_id: 'S01',
      employee_id: 'E01',
      occurred_on: '2026-09-02',
      period_key: '2026-09',
      record_id: 'COMP-1',
      value_json: record,
    })
    expect(database.prepare(`
      SELECT open_flag FROM state_entities WHERE entity_key = 'ATT-1'
    `).get()).toEqual({ open_flag: 1 })
    const indexNames = database.prepare(`
      SELECT name FROM sqlite_master
      WHERE type = 'index' AND (
        name LIKE 'idx_state_entities_%history'
        OR name IN ('idx_state_entities_record_lookup', 'idx_state_entities_open_attendance')
      )
      ORDER BY name
    `).all().map(({ name }) => name)
    expect(indexNames).toEqual([
      'idx_state_entities_employee_history',
      'idx_state_entities_open_attendance',
      'idx_state_entities_record_lookup',
      'idx_state_entities_store_history',
    ])
    const pendingRepairPlan = database.prepare(`
      EXPLAIN QUERY PLAN
      SELECT 1 FROM state_entities
      WHERE scope_key = 'global' AND collection_key = 'attendance' AND open_flag = 1
      LIMIT 1
    `).all().map(({ detail }) => detail).join(' ')
    expect(pendingRepairPlan).toContain('idx_state_entities_open_attendance')
    const financePeriodPlan = database.prepare(`
      EXPLAIN QUERY PLAN
      SELECT store_id FROM state_entities
      WHERE scope_key = 'global'
        AND collection_key = 'compensationEntries'
        AND period_key = '2026-09'
    `).all().map(({ detail }) => detail).join(' ')
    expect(financePeriodPlan).toContain('idx_state_entities_period_store')
  })
})
