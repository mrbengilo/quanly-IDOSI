// @vitest-environment node
import { readFileSync, readdirSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'

const sql = (file) => readFileSync(`drizzle/${file}`, 'utf8').replaceAll('--> statement-breakpoint', '')
const beforeMigration = () => {
  const db = new DatabaseSync(':memory:')
  readdirSync('drizzle').filter((file) => /^\d+.*\.sql$/.test(file) && file < '0013').sort().forEach((file) => db.exec(sql(file)))
  return db
}
const migration = () => sql('0013_store_violation_points.sql')

describe('store violation points catalog migration', () => {
  it('keeps a fresh installation empty until bootstrap', () => {
    const db = beforeMigration()
    try {
      db.exec(migration())
      expect(db.prepare('SELECT COUNT(*) AS count FROM app_state').get().count).toBe(0)
      expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    } finally { db.close() }
  })
  it('converts known catalog definitions once and preserves configured points, custom items and all historical snapshots', () => {
    const db = beforeMigration()
    const catalog = { id: 'CAT', targetGroup: 'store', kind: 'VIOLATION', code: 'store.violation.late', name: 'Đi trễ', amountVnd: 2000, version: 4, active: false, deletedAt: '2026-08-01' }
    const data = {
      workCatalogItems: [catalog, { ...catalog, id: 'CONFIGURED', violationPoints: 2, amountVnd: 0 }, { ...catalog, id: 'CUSTOM', code: 'store.custom' }, { ...catalog, id: 'OFFICE', targetGroup: 'office' }],
      violations: [{ id: 'OLD', targetUnit: 'store', amountVnd: 2000, catalogSnapshot: catalog }],
      attendance: [{ id: 'ATT', checklistSnapshot: { tasks: [catalog] } }],
      payrollPeriods: [{ id: 'PAID', status: 'Đã trả', rows: [{ violationVnd: 2000, workBonusVnd: 5000 }] }],
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
      expect(rows('workCatalogItems')[0]).toMatchObject({ ...catalog, amountVnd: 0, violationPoints: 0.5, version: 5 })
      expect(rows('workCatalogItems').slice(1)).toEqual(data.workCatalogItems.slice(1))
      for (const collection of ['violations', 'attendance', 'payrollPeriods']) expect(rows(collection)).toEqual(data[collection])
      const migrated = rows('workCatalogItems')
      db.exec(migration())
      expect(rows('workCatalogItems')).toEqual(migrated)
      expect(db.prepare("SELECT version FROM app_state WHERE scope_key='global'").get().version).toBe(5)
      expect(db.prepare('PRAGMA integrity_check').get().integrity_check).toBe('ok')
    } finally { db.close() }
  })
})
