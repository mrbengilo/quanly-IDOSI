// @vitest-environment node
import { Buffer } from 'node:buffer'
import { readFileSync, readdirSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'

const sql = (file) => readFileSync(`drizzle/${file}`, 'utf8').replaceAll('--> statement-breakpoint', '')
const beforeMigration = () => {
  const db = new DatabaseSync(':memory:')
  readdirSync('drizzle').filter((file) => /^\d+.*\.sql$/.test(file) && file < '0016').sort().forEach((file) => db.exec(sql(file)))
  return db
}
const migration = () => sql('0016_staff_violation_points.sql')

describe('office and business-support violation points catalog migration', () => {
  it('keeps a fresh installation empty until bootstrap', () => {
    const db = beforeMigration()
    try {
      db.exec(migration())
      expect(db.prepare('SELECT COUNT(*) AS count FROM app_state').get().count).toBe(0)
      expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    } finally { db.close() }
  })

  it('converts known staff definitions once and preserves configured points, custom/store items and history', () => {
    const db = beforeMigration()
    const office = { id: 'OFFICE', targetGroup: 'office', kind: 'VIOLATION', code: 'office.violation.late', name: 'Đi trễ', amountVnd: 3000, version: 2 }
    const htkd = { id: 'HTKD', targetGroup: 'business_support', kind: 'VIOLATION', code: 'htkd.violation.assigned_store_error_requires_admin', name: 'Sai sót', amountVnd: 5000, version: 1 }
    const data = {
      workCatalogItems: [
        office,
        htkd,
        { ...office, id: 'CONFIGURED', code: 'office.violation.forgot_attendance', violationPoints: 2, amountVnd: 0 },
        { ...office, id: 'CUSTOM', code: 'office.custom' },
        { ...office, id: 'STORE', targetGroup: 'store', code: 'office.violation.late.store' },
        { ...office, id: 'REWARD', kind: 'REWARD_TASK', code: 'htkd.violation.late' },
      ],
      violations: [{ id: 'OLD', targetUnit: 'office', amountVnd: 3000, catalogSnapshot: office }],
      payrollPeriods: [{ id: 'PAID', status: 'Đã trả', rows: [{ violationVnd: 3000 }] }],
    }
    try {
      db.prepare("INSERT INTO app_state (scope_key,value_json,version,updated_at) VALUES ('global','{}',4,'before')").run()
      for (const [collection, rows] of Object.entries(data)) {
        db.prepare("INSERT INTO state_collections VALUES ('global',?,'before','before')").run(collection)
        rows.forEach((row, i) => {
          const body = JSON.stringify(row)
          db.prepare("INSERT INTO state_entities (scope_key,collection_key,entity_key,entity_order,value_json,value_bytes,created_at,updated_at) VALUES ('global',?,?,?,?,?,'before','before')").run(collection, row.id, i, body, Buffer.byteLength(body))
        })
      }
      const rows = (collection) => db.prepare('SELECT value_json FROM state_entities WHERE collection_key=? ORDER BY entity_order').all(collection).map((row) => JSON.parse(row.value_json))
      db.exec(migration())
      const [officeRow, htkdRow, ...others] = rows('workCatalogItems')
      expect(officeRow).toMatchObject({ ...office, amountVnd: 0, violationPoints: 0.5, version: 3 })
      expect(htkdRow).toMatchObject({ ...htkd, amountVnd: 0, violationPoints: 0.5, version: 2 })
      expect(others).toEqual(data.workCatalogItems.slice(2))
      for (const collection of ['violations', 'payrollPeriods']) expect(rows(collection)).toEqual(data[collection])
      const migrated = rows('workCatalogItems')
      db.exec(migration())
      expect(rows('workCatalogItems')).toEqual(migrated)
      expect(db.prepare("SELECT version FROM app_state WHERE scope_key='global'").get().version).toBe(5)
      expect(db.prepare('PRAGMA integrity_check').get().integrity_check).toBe('ok')
    } finally { db.close() }
  })
})
