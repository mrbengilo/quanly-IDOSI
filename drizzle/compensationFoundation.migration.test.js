// @vitest-environment node

import { Buffer } from 'node:buffer'
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
]

const migrationSql = (path) => readFileSync(path, 'utf8').replaceAll('--> statement-breakpoint', '')

const databaseBeforeMigration = () => {
  const database = new DatabaseSync(':memory:')
  PREVIOUS_MIGRATIONS.forEach((path) => database.exec(migrationSql(path)))
  return database
}

describe('0009 compensation foundation migration', () => {
  it('registers collections without a compound SELECT', () => {
    const sql = migrationSql('drizzle/0009_compensation_foundation.sql')
    const registrationStatement = sql.slice(0, sql.indexOf('-- The current compensation model'))

    expect(registrationStatement).toMatch(/WITH compensation_collections\(collection_key\) AS \(\s*VALUES/iu)
    expect(registrationStatement).not.toMatch(/\bUNION(?:\s+ALL)?\b/iu)
  })

  it('keeps an uninitialized database empty for atomic bootstrap', () => {
    const database = databaseBeforeMigration()
    try {
      database.exec(migrationSql('drizzle/0009_compensation_foundation.sql'))
      expect(database.prepare("SELECT COUNT(*) AS count FROM state_collections").get()).toEqual({ count: 0 })
      expect(database.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    } finally {
      database.close()
    }
  })

  it('removes exact retired payroll fields while preserving every non-retired record', () => {
    const database = databaseBeforeMigration()
    const compactPeriod = {
      id: 'PAY-COMPACT',
      storeId: 'CH001',
      period: '2026-08',
      kpiSnapshot: { totalBonus: 7_000 },
      rows: [
        { employeeId: 'ST-001', gross: 107_000, kpiBonus: 7_000, manualBonus: 5_000 },
        { employeeId: 'ST-002', gross: 100_000 },
      ],
      financeSnapshot: { revenue: 500_000, profit: 393_000 },
    }
    const externalPeriod = {
      id: 'PAY-EXTERNAL',
      storeId: 'CH002',
      period: '2026-08',
      kpiSnapshot: { totalBonus: 9_000 },
      rows: [{ employeeId: 'ST-003', gross: 209_000, kpiBonus: 9_000, revenueBonus: 4_000 }],
      status: 'Đã chốt',
    }
    const compactState = {
      stores: [{ id: 'CH001', name: 'Cửa hàng giữ nguyên' }],
      policies: { employeeKpiRates: { from30000: 5 }, attendanceEvaluation: { maintainMaxLateCount: 2 } },
      payrollPeriods: [compactPeriod],
      unrelated: { value: 35 },
    }
    const externalJson = JSON.stringify(externalPeriod)

    try {
      database.prepare(`
        INSERT INTO app_state (scope_key, value_json, version, updated_at, updated_by, last_request_id)
        VALUES ('global', ?, 9, '2026-08-25T12:00:00+07:00', NULL, 'before-0009')
      `).run(JSON.stringify(compactState))
      for (const [key, value] of [
        ['employee_kpi_percent_30000', 5],
        ['employee_kpi_percent_15000', 3],
        ['employee_kpi_percent_7000', 1],
        ['late_tolerance_minutes', 10],
      ]) {
        database.prepare(`
          INSERT INTO policies (
            policy_key, value_json, version, effective_at, updated_at, updated_by, last_request_id
          ) VALUES (?, ?, 1, '2026-08-01', '2026-08-25T12:00:00+07:00', NULL, ?)
        `).run(key, JSON.stringify(value), `policy-${key}`)
      }
      database.prepare(`
        INSERT INTO state_collections (scope_key, collection_key, created_at, updated_at)
        VALUES ('global', 'payrollPeriods', '2026-08-25T12:00:00+07:00', '2026-08-25T12:00:00+07:00')
      `).run()
      database.prepare(`
        INSERT INTO state_entities (
          scope_key, collection_key, entity_key, entity_order,
          value_json, value_bytes, created_at, updated_at
        ) VALUES (
          'global', 'payrollPeriods', 'id:PAY-EXTERNAL', 1000000,
          ?, ?, '2026-08-25T12:00:00+07:00', '2026-08-25T12:00:00+07:00'
        )
      `).run(externalJson, Buffer.byteLength(externalJson))

      database.prepare(`
        INSERT INTO users (
          id, username, username_normalized, display_name,
          password_hash, password_salt, password_iterations, password_algorithm,
          role, status, version, password_updated_at, created_at, updated_at
        ) VALUES (
          'ADMIN-MIGRATION', 'admin-migration', 'admin-migration', 'Admin migration',
          'hash', 'salt', 100000, 'PBKDF2-SHA256',
          'admin', 'active', 1, '2026-08-25T12:00:00+07:00',
          '2026-08-25T12:00:00+07:00', '2026-08-25T12:00:00+07:00'
        )
      `).run()
      const receipts = [
        ['retired-policy', { policyKey: 'employee_kpi_percent_30000', preserved: 'receipt-only' }],
        ['retired-snapshot', { period: { kpiSnapshot: { totalBonus: 7_000 } } }],
        ['retired-row-bonus', { row: { kpiBonus: 7_000 } }],
        ['future-policy', { policyKey: 'employee_kpi_percent_future', preserved: true }],
        ['unrelated-receipt', { payroll: { gross: 100_000 }, preserved: true }],
      ]
      for (const [idempotencyKey, response] of receipts) {
        database.prepare(`
          INSERT INTO command_receipts (
            actor_id, idempotency_key, request_hash, response_json, status_code, created_at
          ) VALUES ('ADMIN-MIGRATION', ?, ?, ?, 200, '2026-08-25T12:00:00+07:00')
        `).run(idempotencyKey, `hash-${idempotencyKey}`, JSON.stringify(response))
        database.prepare(`
          INSERT INTO command_receipt_chunks (
            actor_id, idempotency_key, chunk_index, chunk_text, chunk_bytes, created_at
          ) VALUES ('ADMIN-MIGRATION', ?, 0, 'chunk', 5, '2026-08-25T12:00:00+07:00')
        `).run(idempotencyKey)
      }
      for (const [requestId, action, entityType] of [
        ['audit-kpi-entity', 'policy.update', 'KPI'],
        ['audit-kpi-action', 'kpi.recalculate', 'payroll'],
        ['audit-attendance', 'attendance.update', 'attendance'],
        ['audit-payroll', 'payroll.close', 'payroll'],
      ]) {
        database.prepare(`
          INSERT INTO audit_log (
            request_id, actor_id, actor_role, action, entity_type,
            entity_id, before_json, after_json, metadata_json, server_timestamp
          ) VALUES (?, 'ADMIN-MIGRATION', 'admin', ?, ?, 'ENTITY-1', NULL, NULL, '{}', '2026-08-25T12:00:00+07:00')
        `).run(requestId, action, entityType)
      }

      database.exec(migrationSql('drizzle/0009_compensation_foundation.sql'))

      const registered = database.prepare(`
        SELECT collection_key
        FROM state_collections
        WHERE scope_key = 'global'
          AND collection_key IN (
            'storeShiftTaskTemplates', 'compensationEntries', 'violations',
            'revenueBonusDaily', 'revenueBonusAllocations', 'teamRewardClaims',
            'teamRewardParticipants', 'periodReconciliations', 'jobRuns'
          )
        ORDER BY collection_key
      `).all().map(({ collection_key: key }) => key)
      expect(registered).toHaveLength(9)

      const policies = database.prepare('SELECT policy_key FROM policies ORDER BY policy_key').all()
      expect(policies).toContainEqual({ policy_key: 'late_tolerance_minutes' })
      expect(policies.some(({ policy_key: key }) => key.startsWith('employee_kpi_'))).toBe(false)

      const compact = JSON.parse(database.prepare("SELECT value_json FROM app_state WHERE scope_key = 'global'").get().value_json)
      expect(compact.unrelated).toEqual({ value: 35 })
      expect(compact.stores).toEqual(compactState.stores)
      expect(compact.policies).toEqual({ attendanceEvaluation: { maintainMaxLateCount: 2 } })
      const compactPeriodWithoutSnapshot = { ...compactPeriod }
      delete compactPeriodWithoutSnapshot.kpiSnapshot
      expect(compact.payrollPeriods).toEqual([{
        ...compactPeriodWithoutSnapshot,
        rows: compactPeriod.rows.map(({ kpiBonus: _retired, ...row }) => row),
      }])

      const external = database.prepare(`
        SELECT value_json, value_bytes
        FROM state_entities
        WHERE scope_key = 'global' AND collection_key = 'payrollPeriods'
      `).get()
      const externalValue = JSON.parse(external.value_json)
      const externalPeriodWithoutSnapshot = { ...externalPeriod }
      delete externalPeriodWithoutSnapshot.kpiSnapshot
      expect(externalValue).toEqual({
        ...externalPeriodWithoutSnapshot,
        rows: [{ employeeId: 'ST-003', gross: 209_000, revenueBonus: 4_000 }],
      })
      expect(external.value_bytes).toBe(Buffer.byteLength(external.value_json))
      expect(database.prepare(`
        SELECT idempotency_key
        FROM command_receipts
        ORDER BY idempotency_key
      `).all()).toEqual([
        { idempotency_key: 'future-policy' },
        { idempotency_key: 'unrelated-receipt' },
      ])
      expect(database.prepare(`
        SELECT idempotency_key
        FROM command_receipt_chunks
        ORDER BY idempotency_key
      `).all()).toEqual([
        { idempotency_key: 'future-policy' },
        { idempotency_key: 'unrelated-receipt' },
      ])
      expect(database.prepare(`
        SELECT request_id
        FROM audit_log
        ORDER BY request_id
      `).all()).toEqual([
        { request_id: 'audit-attendance' },
        { request_id: 'audit-payroll' },
      ])

      const appStateAfterFirstRun = database.prepare(`
        SELECT value_json
        FROM app_state
        WHERE scope_key = 'global'
      `).get()
      database.prepare(`
        UPDATE app_state
        SET updated_at = '2026-08-25T13:00:00+07:00'
        WHERE scope_key = 'global'
      `).run()
      database.exec(migrationSql('drizzle/0009_compensation_foundation.sql'))
      expect(database.prepare(`
        SELECT value_json, updated_at
        FROM app_state
        WHERE scope_key = 'global'
      `).get()).toEqual({
        ...appStateAfterFirstRun,
        updated_at: '2026-08-25T13:00:00+07:00',
      })
      expect(database.prepare('SELECT COUNT(*) AS count FROM command_receipts').get()).toEqual({ count: 2 })
      expect(database.prepare('SELECT COUNT(*) AS count FROM audit_log').get()).toEqual({ count: 2 })
      expect(database.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    } finally {
      database.close()
    }
  })
})
