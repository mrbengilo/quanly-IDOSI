// @vitest-environment node
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSqliteD1, runWithSqliteMetrics } from './sqlite-d1.mjs'
import worker, { revenueBonusLiveSnapshot, revenueBonusPeriodSnapshot } from '../worker.js'

const directories = []
const now = '2026-09-05T16:00:00.000Z'
const store = { id: 'S01', name: 'Dosii NTL', code: 'DOSII-NTL' }
const fixture = () => ({
  stores: [store, { id: 'S02', name: 'SM TNV' }],
  employees: [
    { id: 'E01', storeId: 'S01', name: 'Nhân viên chính', unit: 'store', status: 'Đang làm việc' },
    { id: 'E02', storeId: 'S02', name: 'Nhân viên hỗ trợ', unit: 'store', status: 'Đang làm việc' },
  ],
  supportTransfers: [],
  orders: [
    { id: 'O1', storeId: 'S01', businessDate: '2026-09-05', amount: 2_000_000 },
    { id: 'O2', storeId: 'S01', workDate: '2026-09-05', effectiveDate: '2026-08-01', amount: 100_000 },
    { id: 'O3', storeId: 'S01', businessDate: '2026-09-05', amount: 9_000_000, deletedAt: now },
    { id: 'O4', storeId: 'S02', businessDate: '2026-09-05', amount: 90_000_000 },
    ...Array.from({ length: 2_000 }, (_, index) => ({
      id: `OLD-${index}`, storeId: 'S01', businessDate: '2026-08-01', amount: 20_000,
    })),
  ],
  attendance: [
    { id: 'A1', storeId: 'S01', employeeId: 'E01', attendanceDate: '2026-09-05',
      createdAt: '2026-08-01', workedSeconds: 3_600, checkOutAt: now },
    { id: 'A2', storeId: 'S01', employeeId: 'E02', workDate: '2026-09-05',
      workedSeconds: 3_600, checkOutAt: now, supportTransferId: 'OLD-TRANSFER' },
    { id: 'A3', storeId: 'S01', employeeId: 'E01', workDate: '2026-09-04',
      workedSeconds: 7_200, checkOutAt: now },
  ],
  revenueBonusDaily: [],
  revenueBonusAllocations: [],
  revenueBonusOverrides: [],
  orderAudit: Array.from({ length: 2_000 }, (_, index) => ({ id: `AUDIT-${index}`, detail: 'x'.repeat(100) })),
})

const createDatabase = async (state) => {
  const directory = await mkdtemp(resolve(tmpdir(), 'idosi-revenue-read-'))
  directories.push(directory)
  const db = createSqliteD1({ databasePath: resolve(directory, 'state.sqlite') })
  await db.batch([
    db.prepare(`INSERT INTO app_state (scope_key, value_json, version, updated_at, last_request_id)
      VALUES ('global', '{}', 1, ?, 'revenue-test')`).bind(now),
    ...Object.entries(state).flatMap(([key, values]) => [
      db.prepare(`INSERT INTO state_collections (scope_key, collection_key, created_at, updated_at)
        VALUES ('global', ?, ?, ?)`).bind(key, now, now),
      ...values.map((value, index) => {
        const json = JSON.stringify(value)
        return db.prepare(`INSERT INTO state_entities (
          scope_key, collection_key, entity_key, entity_order, value_json, value_bytes,
          created_at, updated_at, store_id, employee_id, occurred_on
        ) VALUES ('global', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .bind(key, `${key}:${index}`, index, json, Buffer.byteLength(json), now, now,
            value.storeId || null, value.employeeId || null,
            value.effectiveDate || value.businessDate || value.workDate || value.createdAt || null)
      }),
    ]),
  ])
  return db
}
const hydrate = (snapshot) => Object.fromEntries(snapshot.manifests.map(({ collection_key: key }) => [
  key, snapshot.entities.filter((entity) => entity.collection_key === key).map((entity) => JSON.parse(entity.value_json)),
]))

afterEach(async () => {
  vi.restoreAllMocks()
  vi.useRealTimers()
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('scoped revenue bonus reads', () => {
  it.each([
    ['deletedEmployees', { id: 'e01', deletedAt: now }, 'EMPLOYEE_IDENTIFIER_COLLISION'],
    ['deletedStores', { id: 's01', deletedAt: now }, 'STORE_IDENTIFIER_COLLISION'],
  ])('retains %s to reject ambiguous historical identity references', async (collection, record, code) => {
    const state = fixture()
    state[collection] = [record]
    const db = await createDatabase(state)
    try {
      const projected = hydrate(db.readRevenueBonusStateSnapshot('global', 'S01', '2026-09-05'))
      expect(projected[collection]).toEqual([record])
      for (const source of [state, projected]) {
        expect(() => revenueBonusLiveSnapshot({ state: source, store, businessDate: '2026-09-05', now }))
          .toThrow(expect.objectContaining({ code }))
      }
    } finally { db.close() }
  })

  it('uses scoped reads for authenticated APIs and enforces employee privacy before reading another store', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(now))
    const db = await createDatabase(fixture())
    try {
      const token = 'revenue-read-test-session-token-00000001'
      const tokenHash = createHash('sha256').update(token).digest('base64url')
      await db.batch([
        db.prepare(`INSERT INTO users (id, username, username_normalized, display_name,
          password_hash, password_salt, password_iterations, role, store_id, employee_id,
          password_updated_at, created_at, updated_at)
          VALUES ('U1', 'read-test', 'read-test', 'Read test', 'unused', 'unused', 100000,
          'employee', 'S01', 'E01', ?, ?, ?)`).bind(now, now, now),
        db.prepare(`INSERT INTO sessions (id, token_hash, user_id, created_at, last_seen_at, expires_at)
          VALUES ('SESSION', ?, 'U1', ?, ?, '2026-09-06T16:00:00.000Z')`).bind(tokenHash, now, now),
      ])
      const fullRead = vi.spyOn(db, 'readStateSnapshot')
      const scopedRead = vi.spyOn(db, 'readRevenueBonusStateSnapshot')
      const get = (path) => worker.fetch(new Request(`https://idosi.example${path}`, {
        headers: { authorization: `Bearer ${token}` },
      }), { DB: db })
      const daily = await get('/api/revenue-bonus/live?storeId=S01&businessDate=2026-09-05')
      const dailyBody = await daily.json()
      expect(daily.status, JSON.stringify(dailyBody.error)).toBe(200)
      expect(dailyBody.snapshot.allocations.map((row) => row.employeeId)).toEqual(['E01'])
      const period = await get('/api/revenue-bonus/period?storeId=S01&period=2026-09')
      expect(period.status).toBe(200)
      expect((await period.json()).period.allocations.every((row) => row.employeeId === 'E01')).toBe(true)
      expect(scopedRead).toHaveBeenCalledTimes(2)
      expect(fullRead).not.toHaveBeenCalled()
      expect((await get('/api/revenue-bonus/live?storeId=S02&businessDate=2026-09-05')).status).toBe(403)
      expect((await get('/api/revenue-bonus/period?storeId=S02&period=2026-09')).status).toBe(403)
      expect(scopedRead).toHaveBeenCalledTimes(2)
      expect(db.database.prepare("SELECT version FROM app_state WHERE scope_key = 'global'").get().version).toBe(1)
    } finally { db.close() }
  })

  it('reads one day in one query without unrelated history and preserves canonical revenue/support hours', async () => {
    const state = fixture()
    const db = await createDatabase(state)
    try {
      const metrics = { statements: 0, reads: 0, writes: 0, batches: 0, totalMs: 0, maxMs: 0 }
      const snapshot = runWithSqliteMetrics(metrics, () => db.readRevenueBonusStateSnapshot('global', 's01', '2026-09-05'))
      const projected = hydrate(snapshot)
      expect(metrics).toMatchObject({ statements: 1, reads: 1, writes: 0 })
      expect(projected.orders.map((record) => record.id)).toEqual(['O1', 'O2', 'O3'])
      expect(projected.attendance.map((record) => record.id)).toEqual(['A1', 'A2'])
      expect(projected.employees).toEqual(state.employees)
      expect(projected).not.toHaveProperty('orderAudit')
      expect(snapshot.entities.length).toBeLessThan(10)
      expect(db.readStateSnapshot('global').entities.length).toBeGreaterThan(4_000)
      const actual = revenueBonusLiveSnapshot({ state: projected, store, businessDate: '2026-09-05', now })
      expect(actual).toEqual(revenueBonusLiveSnapshot({ state, store, businessDate: '2026-09-05', now }))
      expect(actual).toMatchObject({ revenueVnd: 2_100_000, totalWorkedSeconds: 7_200, supportExcludedCount: 1 })
      const periodState = hydrate(db.readRevenueBonusStateSnapshot('global', 'S01', '2026-09'))
      expect(revenueBonusPeriodSnapshot({ state: periodState, store, period: '2026-09', now }))
        .toEqual(revenueBonusPeriodSnapshot({ state, store, period: '2026-09', now }))
    } finally { db.close() }
  })

  it('keeps finalized days, undated allocations and audited overrides authoritative', async () => {
    const state = fixture()
    state.revenueBonusDaily = [{ id: 'DAY', storeId: 'S01', businessDate: '2026-09-05', revenueVnd: 1_000_000 }]
    state.revenueBonusAllocations = [{ id: 'ALLOC', revenueBonusDailyId: 'DAY', employeeId: 'E01', amountVnd: 10_000 }]
    state.revenueBonusOverrides = [{ id: 'OVERRIDE', storeId: 'S01', businessDate: '2026-09-05',
      employeeId: 'E01', status: 'active', mode: 'AMOUNT', amountVnd: 12_000, reason: 'Đối soát' }]
    const db = await createDatabase(state)
    try {
      const projected = hydrate(db.readRevenueBonusStateSnapshot('global', 'S01', '2026-09-05'))
      const snapshot = revenueBonusLiveSnapshot({ state: projected, store, businessDate: '2026-09-05', now })
      expect(snapshot).toEqual(revenueBonusLiveSnapshot({ state, store, businessDate: '2026-09-05', now }))
      expect(snapshot).toMatchObject({ revenueVnd: 1_000_000, allocatedVnd: 12_000, status: 'FINALIZED' })
      projected.revenueBonusDaily.push({ ...state.revenueBonusDaily[0], id: 'DUPLICATE' })
      expect(() => revenueBonusLiveSnapshot({ state: projected, store, businessDate: '2026-09-05', now }))
        .toThrow(/nhiều kết quả/)
    } finally { db.close() }
  })
})
