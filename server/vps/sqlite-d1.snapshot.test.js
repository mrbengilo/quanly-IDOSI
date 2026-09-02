// @vitest-environment node

import { Buffer } from 'node:buffer'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createSqliteD1, runWithSqliteMetrics } from './sqlite-d1.mjs'

const temporaryDirectories = []
const timestamp = '2026-08-31T08:00:00.000Z'

const emptyMetrics = () => ({
  statements: 0,
  reads: 0,
  writes: 0,
  batches: 0,
  totalMs: 0,
  maxMs: 0,
})

const createSnapshotDatabase = async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'idosi-snapshot-'))
  temporaryDirectories.push(directory)
  const database = createSqliteD1({ databasePath: resolve(directory, 'idosi.sqlite') })
  const firstEntity = JSON.stringify({ id: 'ORDER-01', label: 'Đơn đầu tiên' })
  const secondEntity = JSON.stringify({ id: 'ORDER-02', label: 'Đơn thứ hai' })
  await database.batch([
    database.prepare(`
      INSERT INTO app_state (
        scope_key, value_json, version, updated_at, updated_by, last_request_id
      ) VALUES (?, ?, ?, ?, NULL, ?)
    `).bind('global', JSON.stringify({ schemaVersion: 2 }), 7, timestamp, 'request-version-7'),
    database.prepare(`
      INSERT INTO state_collections (scope_key, collection_key, created_at, updated_at)
      VALUES (?, ?, ?, ?)
    `).bind('global', 'orders', timestamp, timestamp),
    database.prepare(`
      INSERT INTO state_collections (scope_key, collection_key, created_at, updated_at)
      VALUES (?, ?, ?, ?)
    `).bind('global', 'emptyCollection', timestamp, timestamp),
    database.prepare(`
      INSERT INTO state_entities (
        scope_key, collection_key, entity_key, entity_order,
        value_json, value_bytes, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      'global',
      'orders',
      'entity-second',
      20,
      secondEntity,
      Buffer.byteLength(secondEntity),
      timestamp,
      timestamp,
    ),
    database.prepare(`
      INSERT INTO state_entities (
        scope_key, collection_key, entity_key, entity_order,
        value_json, value_bytes, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      'global',
      'orders',
      'entity-first',
      10,
      firstEntity,
      Buffer.byteLength(firstEntity),
      timestamp,
      timestamp,
    ),
  ])
  return { database, firstEntity, secondEntity }
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => (
    rm(directory, { recursive: true, force: true })
  )))
})

describe('SQLite state snapshots', () => {
  it('reads the state shell, empty collections, and ordered entities in one measured query', async () => {
    const { database, firstEntity, secondEntity } = await createSnapshotDatabase()
    const metrics = emptyMetrics()
    try {
      const snapshot = runWithSqliteMetrics(metrics, () => database.readStateSnapshot('global'))

      expect(snapshot).toEqual({
        unchanged: false,
        row: {
          scope_key: 'global',
          value_json: JSON.stringify({ schemaVersion: 2 }),
          version: 7,
          updated_at: timestamp,
          updated_by: null,
          last_request_id: 'request-version-7',
        },
        manifests: [
          { collection_key: 'emptyCollection', created_at: timestamp, updated_at: timestamp },
          { collection_key: 'orders', created_at: timestamp, updated_at: timestamp },
        ],
        entities: [
          {
            collection_key: 'orders',
            entity_key: 'entity-first',
            entity_order: 10,
            value_json: firstEntity,
            value_bytes: Buffer.byteLength(firstEntity),
            created_at: timestamp,
            updated_at: timestamp,
          },
          {
            collection_key: 'orders',
            entity_key: 'entity-second',
            entity_order: 20,
            value_json: secondEntity,
            value_bytes: Buffer.byteLength(secondEntity),
            created_at: timestamp,
            updated_at: timestamp,
          },
        ],
      })
      expect(metrics).toMatchObject({ statements: 1, reads: 1, writes: 0, batches: 0 })
      expect(metrics.totalMs).toBeGreaterThanOrEqual(0)
      expect(metrics.maxMs).toBeGreaterThanOrEqual(0)
    } finally {
      database.close()
    }
  })

  it('uses one head query only for an exact version and request id cache key', async () => {
    const { database } = await createSnapshotDatabase()
    try {
      const warmMetrics = emptyMetrics()
      const unchanged = runWithSqliteMetrics(warmMetrics, () => database.readStateSnapshot('global', {
        version: 7,
        lastRequestId: 'request-version-7',
      }))
      expect(unchanged).toEqual({ unchanged: true })
      expect(warmMetrics).toMatchObject({ statements: 1, reads: 1, writes: 0, batches: 0 })

      for (const known of [
        { version: 6, lastRequestId: 'request-version-7' },
        { version: 7, lastRequestId: 'different-request' },
      ]) {
        const refreshMetrics = emptyMetrics()
        const refreshed = runWithSqliteMetrics(refreshMetrics, () => (
          database.readStateSnapshot('global', known)
        ))
        expect(refreshed).toMatchObject({
          unchanged: false,
          row: { version: 7, last_request_id: 'request-version-7' },
        })
        expect(refreshMetrics).toMatchObject({ statements: 2, reads: 2, writes: 0, batches: 0 })
      }
    } finally {
      database.close()
    }
  })

  it('reads only records relevant to one store workspace', async () => {
    const { database } = await createSnapshotDatabase()
    const entity = (collectionKey, entityKey, order, value) => {
      const valueJson = JSON.stringify(value)
      return database.prepare(`
        INSERT INTO state_entities (
          scope_key, collection_key, entity_key, entity_order,
          value_json, value_bytes, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        'global', collectionKey, entityKey, order,
        valueJson, Buffer.byteLength(valueJson), timestamp, timestamp,
      )
    }
    const collections = [
      'stores', 'employees', 'supportTransfers', 'attendance', 'workCatalogItems', 'notifications',
    ]
    try {
      await database.batch([
        ...collections.map((collectionKey) => database.prepare(`
          INSERT INTO state_collections (scope_key, collection_key, created_at, updated_at)
          VALUES (?, ?, ?, ?)
        `).bind('global', collectionKey, timestamp, timestamp)),
        entity('stores', 'store-s01', 10, { id: 'S01', name: 'Cửa hàng 01' }),
        entity('stores', 'store-s02', 20, { id: 'S02', name: 'Cửa hàng 02' }),
        entity('employees', 'employee-e01', 10, { id: 'E01', storeId: 'S01', unit: 'store' }),
        entity('employees', 'employee-e02', 20, {
          id: 'E02', storeId: 'S02', unit: 'store', note: 'FOREIGN_STORE_SECRET',
        }),
        entity('employees', 'employee-inbound', 30, { id: 'E-INBOUND', storeId: 'S02', unit: 'store' }),
        entity('supportTransfers', 'transfer-inbound', 10, {
          id: 'TRANSFER-INBOUND', employeeId: 'E-INBOUND', fromStoreId: 'S02', toStoreId: 'S01',
        }),
        entity('supportTransfers', 'transfer-foreign', 20, {
          id: 'TRANSFER-FOREIGN', employeeId: 'E02', fromStoreId: 'S02', toStoreId: 'S03',
          note: 'FOREIGN_STORE_SECRET',
        }),
        entity('attendance', 'attendance-inbound', 10, { id: 'ATT-INBOUND', employeeId: 'E-INBOUND' }),
        entity('attendance', 'attendance-foreign', 20, {
          id: 'ATT-FOREIGN', employeeId: 'E02', note: 'FOREIGN_STORE_SECRET',
        }),
        entity('workCatalogItems', 'catalog-global', 10, { id: 'CATALOG-GLOBAL', targetGroup: 'store' }),
        entity('workCatalogItems', 'catalog-foreign', 20, {
          id: 'CATALOG-FOREIGN', targetGroup: 'store', storeId: 'S02', note: 'FOREIGN_STORE_SECRET',
        }),
        entity('notifications', 'notice-selected', 10, {
          id: 'NOTICE-SELECTED', data: { storeId: 'S01' },
        }),
        entity('notifications', 'notice-foreign', 20, {
          id: 'NOTICE-FOREIGN', data: { storeId: 'S02' }, note: 'FOREIGN_STORE_SECRET',
        }),
      ])

      const metrics = emptyMetrics()
      const snapshot = runWithSqliteMetrics(metrics, () => (
        database.readStoreStateSnapshot('global', 'S01')
      ))
      const values = snapshot.entities.map(({ value_json: valueJson }) => JSON.parse(valueJson))
      const serialized = JSON.stringify(values)

      expect(snapshot).toMatchObject({ unchanged: false, row: { version: 7 } })
      expect(values.map(({ id }) => id)).toEqual(expect.arrayContaining([
        'S01',
        'S02',
        'E01',
        'E-INBOUND',
        'TRANSFER-INBOUND',
        'ATT-INBOUND',
        'CATALOG-GLOBAL',
        'NOTICE-SELECTED',
      ]))
      expect(serialized).not.toContain('FOREIGN_STORE_SECRET')
      expect(values.map(({ id }) => id)).not.toContain('E02')
      expect(metrics).toMatchObject({ statements: 1, reads: 1, writes: 0, batches: 0 })
    } finally {
      database.close()
    }
  })

  it('aggregates one finance period without returning operational rows', async () => {
    const { database } = await createSnapshotDatabase()
    const entity = (collectionKey, entityKey, order, value) => {
      const valueJson = JSON.stringify(value)
      const periodKey = String(
        value.occurredOn || value.occurredAt || value.createdAt || '',
      ).slice(0, 7) || null
      return database.prepare(`
        INSERT INTO state_entities (
          scope_key, collection_key, entity_key, entity_order,
          value_json, value_bytes, created_at, updated_at, store_id, period_key
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        'global', collectionKey, entityKey, order,
        valueJson, Buffer.byteLength(valueJson), timestamp, timestamp, value.storeId, periodKey,
      )
    }
    try {
      await database.batch([
        ...['expenseEntries', 'violationRefunds'].map((collectionKey) => database.prepare(`
          INSERT INTO state_collections (scope_key, collection_key, created_at, updated_at)
          VALUES (?, ?, ?, ?)
        `).bind('global', collectionKey, timestamp, timestamp)),
        entity('orders', 'finance-order-s01', 30, {
          id: 'FINANCE-ORDER-S01', storeId: 'S01', amount: 100_000, createdAt: '2026-09-02T02:00:00.000Z',
        }),
        entity('orders', 'finance-order-other-period', 40, {
          id: 'FINANCE-ORDER-AUGUST', storeId: 'S01', amount: 900_000, createdAt: '2026-08-31T23:00:00.000Z',
        }),
        entity('expenseEntries', 'finance-expense-s01', 10, {
          id: 'FINANCE-EXPENSE-S01', storeId: 'S01', amount: 20_000, occurredAt: '2026-09-02T03:00:00.000Z',
        }),
        entity('expenseEntries', 'finance-expense-deleted', 20, {
          id: 'FINANCE-EXPENSE-DELETED', storeId: 'S01', amount: 700_000,
          occurredAt: '2026-09-02T03:00:00.000Z', deletedAt: '2026-09-02T04:00:00.000Z',
        }),
        entity('violationRefunds', 'finance-refund-s01', 10, {
          id: 'FINANCE-REFUND-S01', storeId: 'S01', amountVnd: 30_000,
          status: 'RECOGNIZED', recognized: true, occurredOn: '2026-09-01',
        }),
        entity('orders', 'finance-order-s02', 50, {
          id: 'FINANCE-ORDER-S02', storeId: 'S02', amount: 200_000, createdAt: '2026-09-03T02:00:00.000Z',
        }),
      ])

      const metrics = emptyMetrics()
      const rows = runWithSqliteMetrics(metrics, () => database.readFinanceOverview('2026-09'))

      expect(rows).toEqual([
        { store_id: 'S01', revenue: 130_000, expense: 20_000 },
        { store_id: 'S02', revenue: 200_000, expense: 0 },
      ])
      expect(metrics).toMatchObject({ statements: 1, reads: 1, writes: 0, batches: 0 })
    } finally {
      database.close()
    }
  })

  it('filters session attendance to open rows and payroll entities to one period', async () => {
    const { database } = await createSnapshotDatabase()
    const insert = (collectionKey, entityKey, order, value, periodKey = null) => {
      const valueJson = JSON.stringify(value)
      return database.prepare(`
        INSERT INTO state_entities (
          scope_key, collection_key, entity_key, entity_order,
          value_json, value_bytes, created_at, updated_at,
          store_id, employee_id, occurred_on, period_key, record_id
        ) VALUES ('global', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        collectionKey, entityKey, order, valueJson, Buffer.byteLength(valueJson), timestamp, timestamp,
        value.storeId || null, value.employeeId || null, value.date || value.effectiveDate || null,
        periodKey, value.id || null,
      )
    }
    try {
      await database.batch([
        ...['stores', 'employees', 'attendance', 'compensationEntries', 'storeEmployeeSalaryConfigs'].map((collectionKey) => database.prepare(`
          INSERT OR IGNORE INTO state_collections (scope_key, collection_key, created_at, updated_at)
          VALUES ('global', ?, ?, ?)
        `).bind(collectionKey, timestamp, timestamp)),
        insert('stores', 'store-s01-screen-filter', 30, { id: 'S01', name: 'Cửa hàng 01' }),
        insert('employees', 'employee-e01-screen-filter', 30, { id: 'E01', storeId: 'S01', unit: 'store' }),
        insert('attendance', 'attendance-open', 30, {
          id: 'ATT-OPEN', storeId: 'S01', employeeId: 'E01', date: '2026-09-02', checkOutAt: null,
        }, '2026-09'),
        insert('attendance', 'attendance-closed', 40, {
          id: 'ATT-CLOSED', storeId: 'S01', employeeId: 'E01', date: '2026-09-01',
          checkOutAt: '2026-09-01T10:00:00.000Z',
        }, '2026-09'),
        insert('compensationEntries', 'compensation-september', 30, {
          id: 'COMP-SEP', storeId: 'S01', employeeId: 'E01', effectiveDate: '2026-09-02',
        }, '2026-09'),
        insert('compensationEntries', 'compensation-august', 40, {
          id: 'COMP-AUG', storeId: 'S01', employeeId: 'E01', effectiveDate: '2026-08-02',
        }, '2026-08'),
        insert('storeEmployeeSalaryConfigs', 'salary-config-august', 30, {
          id: 'CONFIG-AUG', storeId: 'S01', employeeId: 'E01', effectiveFrom: '2026-08',
        }, '2026-08'),
      ])

      const session = database.readStoreStateSnapshot('global', 'S01', 'E01', 'session')
      expect(session.entities
        .filter(({ collection_key: collectionKey }) => collectionKey === 'attendance')
        .map(({ value_json: valueJson }) => JSON.parse(valueJson).id)).toEqual(['ATT-OPEN'])

      const payroll = database.readStoreStateSnapshot('global', 'S01', 'E01', 'payroll', '2026-09')
      expect(payroll.entities
        .filter(({ collection_key: collectionKey }) => collectionKey === 'compensationEntries')
        .map(({ value_json: valueJson }) => JSON.parse(valueJson).id)).toEqual(['COMP-SEP'])
      expect(payroll.entities
        .filter(({ collection_key: collectionKey }) => collectionKey === 'storeEmployeeSalaryConfigs')
        .map(({ value_json: valueJson }) => JSON.parse(valueJson).id)).toEqual(['CONFIG-AUG'])
    } finally {
      database.close()
    }
  })

  it('reads one indexed cursor page of store history', async () => {
    const { database } = await createSnapshotDatabase()
    const insert = (entityKey, order, value) => {
      const valueJson = JSON.stringify(value)
      return database.prepare(`
        INSERT INTO state_entities (
          scope_key, collection_key, entity_key, entity_order,
          value_json, value_bytes, created_at, updated_at,
          store_id, employee_id, occurred_on, period_key
        ) VALUES (?, 'orders', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        'global', entityKey, order, valueJson, Buffer.byteLength(valueJson), timestamp, timestamp,
        value.storeId, value.employeeId || null, value.createdAt.slice(0, 10), value.createdAt.slice(0, 7),
      )
    }
    try {
      await database.batch([
        insert('history-s01-1', 100, { id: 'HISTORY-S01-1', storeId: 'S01', createdAt: '2026-09-01' }),
        insert('history-s01-2', 200, { id: 'HISTORY-S01-2', storeId: 'S01', createdAt: '2026-09-02' }),
        insert('history-s01-3', 300, { id: 'HISTORY-S01-3', storeId: 'S01', createdAt: '2026-09-03' }),
        insert('history-s02-secret', 400, { id: 'HISTORY-S02', storeId: 'S02', createdAt: '2026-09-04', note: 'SECRET' }),
      ])
      const metrics = emptyMetrics()
      const first = runWithSqliteMetrics(metrics, () => database.readEntityHistory({
        collectionKey: 'orders', storeId: 'S01', period: '2026-09', limit: 2,
      }))
      expect(first.map(({ entity_key: entityKey }) => entityKey)).toEqual([
        'history-s01-3', 'history-s01-2',
      ])
      const second = database.readEntityHistory({
        collectionKey: 'orders', storeId: 'S01', period: '2026-09',
        beforeOccurredOn: first[1].occurred_on,
        beforeOrder: Number(first[1].entity_order),
        beforeKey: first[1].entity_key,
        limit: 2,
      })
      expect(second.map(({ entity_key: entityKey }) => entityKey)).toEqual(['history-s01-1'])
      expect(JSON.stringify([...first, ...second])).not.toContain('SECRET')
      expect(metrics).toMatchObject({ statements: 1, reads: 1, writes: 0, batches: 0 })
      const queryPlan = (await database.prepare(`
        EXPLAIN QUERY PLAN
        SELECT entity_key FROM state_entities
        WHERE scope_key = 'global'
          AND collection_key = 'orders'
          AND store_id = 's01' COLLATE NOCASE
          AND period_key = '2026-09'
        ORDER BY entity_order DESC
      `).all()).results.map(({ detail }) => detail).join(' ')
      expect(queryPlan).toContain('idx_state_entities_store_period')
    } finally {
      database.close()
    }
  })
})
