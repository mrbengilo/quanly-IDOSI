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
    const currentDate = new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10)
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
        ...['stores', 'employees', 'attendance', 'orders', 'schedule', 'compensationEntries', 'storeEmployeeSalaryConfigs'].map((collectionKey) => database.prepare(`
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
        insert('orders', 'overview-order-september', 30, {
          id: 'ORDER-SEP', storeId: 'S01', employeeId: 'E01', date: '2026-09-02',
        }, '2026-09'),
        insert('orders', 'overview-order-august', 40, {
          id: 'ORDER-AUG', storeId: 'S01', employeeId: 'E01', date: '2026-08-02',
        }, '2026-08'),
        insert('orders', 'overview-order-today', 50, {
          id: 'ORDER-TODAY', storeId: 'S01', employeeId: 'E01', date: currentDate,
        }, currentDate.slice(0, 7)),
        insert('schedule', 'overview-recurring-schedule', 50, {
          id: 'SCHEDULE-RECURRING', storeId: 'S01', employeeId: 'E01',
        }),
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

      const overview = database.readStoreStateSnapshot('global', 'S01', 'E01', 'overview', '2026-09')
      expect(overview.entities
        .filter(({ collection_key: collectionKey }) => collectionKey === 'orders')
        .map(({ value_json: valueJson }) => JSON.parse(valueJson).id)).toEqual(['ORDER-SEP', 'ORDER-TODAY'])
      const historicalOverview = database.readStoreStateSnapshot('global', 'S01', 'E01', 'overview', '1999-01')
      expect(historicalOverview.entities
        .filter(({ collection_key: key }) => ['orders', 'schedule'].includes(key))
        .map(({ value_json: valueJson }) => JSON.parse(valueJson).id)).toEqual(['ORDER-TODAY', 'SCHEDULE-RECURRING'])
    } finally {
      database.close()
    }
  })

  it('bounds support task screens to selected employees while preserving history and identity collision checks', async () => {
    const { database } = await createSnapshotDatabase()
    const insert = (collectionKey, entityKey, order, value, {
      employeeId = value.employeeId || null,
      occurredOn = value.date || null,
      periodKey = occurredOn?.slice(0, 7) || null,
    } = {}) => {
      const valueJson = JSON.stringify(value)
      return database.prepare(`
        INSERT INTO state_entities (
          scope_key, collection_key, entity_key, entity_order,
          value_json, value_bytes, created_at, updated_at,
          store_id, employee_id, occurred_on, period_key, record_id
        ) VALUES ('global', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        collectionKey, entityKey, order, valueJson, Buffer.byteLength(valueJson), timestamp, timestamp,
        value.storeId || null, employeeId, occurredOn, periodKey, value.id || null,
      )
    }
    try {
      await database.batch([
        ...['stores', 'employees', 'tasks', 'workCatalogItems'].map((collectionKey) => database.prepare(`
          INSERT OR IGNORE INTO state_collections (scope_key, collection_key, created_at, updated_at)
          VALUES ('global', ?, ?, ?)
        `).bind(collectionKey, timestamp, timestamp)),
        insert('stores', 'system-store-s01', 10, { id: 'S01', name: 'Cửa hàng 01' }),
        insert('employees', 'system-employee-e01', 10, { id: 'E01', unit: 'business_support' }, { employeeId: 'E01' }),
        insert('employees', 'system-employee-e02', 20, { id: 'E02', unit: 'business_support' }, { employeeId: 'E02' }),
        insert('tasks', 'system-task-today', 10, {
          id: 'TASK-TODAY', storeId: 'S01', employeeIds: ['E01'], date: '2026-09-06',
        }, { employeeId: null }),
        insert('tasks', 'system-task-old', 20, {
          id: 'TASK-OLD', storeId: 'S01', employeeIds: ['E01'], date: '2026-09-05',
        }, { employeeId: null }),
        insert('tasks', 'system-task-other', 30, {
          id: 'TASK-OTHER', storeId: 'S01', employeeIds: ['E02'], date: '2026-09-06',
        }, { employeeId: null }),
        insert('workCatalogItems', 'system-catalog-shared', 10, { id: 'CATALOG-01', title: 'Việc chung' }),
      ])

      const adminSnapshot = database.readSystemStateSnapshot(
        'global', ['stores', 'tasks'], 'tasks', ['E01', 'E02'],
      )
      expect(adminSnapshot.entities
        .filter(({ collection_key: key }) => key === 'tasks')
        .map(({ value_json: valueJson }) => JSON.parse(valueJson).id)).toEqual([
          'TASK-TODAY', 'TASK-OLD', 'TASK-OTHER',
        ])

      const supportSnapshot = database.readSystemStateSnapshot(
        'global', ['employees', 'tasks', 'workCatalogItems'], 'support-tasks', ['E01'],
      )
      expect(supportSnapshot.entities
        .filter(({ collection_key: key }) => key === 'tasks')
        .map(({ value_json: valueJson }) => JSON.parse(valueJson).id)).toEqual([
          'TASK-TODAY', 'TASK-OLD',
        ])
      expect(supportSnapshot.entities
        .filter(({ collection_key: key }) => key === 'employees')
        .map(({ value_json: valueJson }) => JSON.parse(valueJson).id)).toEqual(['E01', 'E02'])
      expect(supportSnapshot.entities
        .filter(({ collection_key: key }) => key === 'workCatalogItems')
        .map(({ value_json: valueJson }) => JSON.parse(valueJson).id)).toEqual(['CATALOG-01'])
    } finally {
      database.close()
    }
  })

  it('bounds employee home orders to the signed-in employee open attendance', async () => {
    const { database } = await createSnapshotDatabase()
    const vietnamNow = new Date(Date.now() + (7 * 60 * 60 * 1_000))
    const currentPeriod = vietnamNow.toISOString().slice(0, 7)
    const previousMonth = new Date(`${currentPeriod}-01T00:00:00.000Z`)
    previousMonth.setUTCMonth(previousMonth.getUTCMonth() - 1)
    const previousPeriod = previousMonth.toISOString().slice(0, 7)
    const insert = (collectionKey, entityKey, order, value, {
      periodKey = null,
      openFlag = null,
    } = {}) => {
      const valueJson = JSON.stringify(value)
      return database.prepare(`
        INSERT INTO state_entities (
          scope_key, collection_key, entity_key, entity_order,
          value_json, value_bytes, created_at, updated_at,
          store_id, employee_id, occurred_on, period_key, record_id, open_flag
        ) VALUES ('global', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        collectionKey, entityKey, order, valueJson, Buffer.byteLength(valueJson), timestamp, timestamp,
        value.storeId || null, value.employeeId || null, String(value.date || value.createdAt || '').slice(0, 10) || null,
        periodKey, value.id || null, openFlag,
      )
    }
    try {
      await database.batch([
        ...['stores', 'employees', 'orders', 'attendance'].map((collectionKey) => database.prepare(`
          INSERT OR IGNORE INTO state_collections (scope_key, collection_key, created_at, updated_at)
          VALUES ('global', ?, ?, ?)
        `).bind(collectionKey, timestamp, timestamp)),
        insert('stores', 'store-s01-employee-home', 10, { id: 'S01', name: 'Dosii Tây Hòa' }),
        insert('employees', 'employee-e01-employee-home', 10, { id: 'E01', storeId: 'S01', unit: 'store' }),
        insert('employees', 'employee-e02-employee-home', 20, { id: 'E02', storeId: 'S01', unit: 'store' }),
        insert('attendance', 'attendance-open-employee-home', 10, {
          id: 'ATT-OPEN', storeId: 'S01', employeeId: 'E01', date: `${previousPeriod}-28`, checkOutAt: null,
        }, { periodKey: previousPeriod, openFlag: 1 }),
        insert('attendance', 'attendance-closed-employee-home', 20, {
          id: 'ATT-CLOSED', storeId: 'S01', employeeId: 'E01', date: `${currentPeriod}-03`,
          checkOutAt: `${currentPeriod}-03T10:00:00.000Z`,
        }, { periodKey: currentPeriod, openFlag: 0 }),
        insert('orders', 'order-own-current', 10, {
          id: 'ORDER-OWN-CURRENT', storeId: 'S01', employeeId: 'E01', attendanceId: 'ATT-OPEN',
          createdAt: `${currentPeriod}-04T02:00:00.000Z`,
        }, { periodKey: currentPeriod }),
        insert('orders', 'order-own-open-attendance', 20, {
          id: 'ORDER-OWN-OPEN', storeId: 'S01', employeeId: 'E01', attendanceId: 'ATT-OPEN',
          createdAt: `${previousPeriod}-28T02:00:00.000Z`,
        }, { periodKey: previousPeriod }),
        insert('orders', 'order-own-old-closed', 30, {
          id: 'ORDER-OWN-OLD', storeId: 'S01', employeeId: 'E01', createdAt: `${previousPeriod}-01T02:00:00.000Z`,
        }, { periodKey: previousPeriod }),
        insert('orders', 'order-own-current-unlinked', 35, {
          id: 'ORDER-OWN-CURRENT-UNLINKED', storeId: 'S01', employeeId: 'E01',
          createdAt: `${currentPeriod}-04T03:00:00.000Z`,
        }, { periodKey: currentPeriod }),
        insert('orders', 'order-own-closed-attendance', 37, {
          id: 'ORDER-OWN-CLOSED', storeId: 'S01', employeeId: 'E01', attendanceId: 'ATT-CLOSED',
          createdAt: `${currentPeriod}-03T03:00:00.000Z`,
        }, { periodKey: currentPeriod }),
        insert('orders', 'order-coworker-current', 40, {
          id: 'ORDER-COWORKER-CURRENT', storeId: 'S01', employeeId: 'E02', createdAt: `${currentPeriod}-04T02:00:00.000Z`,
        }, { periodKey: currentPeriod }),
      ])

      let snapshotSql
      const prepare = database.database.prepare.bind(database.database)
      database.database.prepare = (sql) => {
        snapshotSql = sql
        return prepare(sql)
      }
      const snapshot = database.readStoreStateSnapshot('global', 'S01', 'E01', 'employee-home')
      database.database.prepare = prepare
      const plan = prepare(`EXPLAIN QUERY PLAN ${snapshotSql}`).all('global', 'S01', 'E01', '')
      // Resolve the actor's open shifts once, rather than scanning attendance
      // again for every order. This also protects the no-open-shift path.
      expect(plan.map(({ detail }) => detail).join('\n')).toContain('MATERIALIZE open_actor_attendance_ids')
      const identityLookups = plan.map(({ detail }) => detail)
        .filter((detail) => /^SEARCH (employee|transfer) /u.test(detail))
      expect(identityLookups.length).toBeGreaterThanOrEqual(2)
      expect(identityLookups.every((detail) => detail.includes('USING PRIMARY KEY (scope_key=? AND collection_key=?)')))
        .toBe(true)
      const orderIds = snapshot.entities
        .filter(({ collection_key: collectionKey }) => collectionKey === 'orders')
        .map(({ value_json: valueJson }) => JSON.parse(valueJson).id)

      expect(orderIds).toEqual(['ORDER-OWN-CURRENT', 'ORDER-OWN-OPEN'])
      await database.prepare("UPDATE state_entities SET open_flag = 0 WHERE collection_key = 'attendance'").run()
      expect(database.readStoreStateSnapshot('global', 'S01', 'E01', 'employee-home').entities
        .filter(({ collection_key: key }) => key === 'orders')).toEqual([])
    } finally {
      database.close()
    }
  })

  it('reads one indexed cursor page of store history', async () => {
    const { database } = await createSnapshotDatabase()
    const insert = (entityKey, order, value, {
      occurredOn = value.createdAt?.slice(0, 10) || value.date,
      periodKey = occurredOn?.slice(0, 7),
    } = {}) => {
      const valueJson = JSON.stringify(value)
      return database.prepare(`
        INSERT INTO state_entities (
          scope_key, collection_key, entity_key, entity_order,
          value_json, value_bytes, created_at, updated_at,
          store_id, employee_id, occurred_on, period_key
        ) VALUES (?, 'orders', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        'global', entityKey, order, valueJson, Buffer.byteLength(valueJson), timestamp, timestamp,
        value.storeId, value.employeeId || null, occurredOn, periodKey,
      )
    }
    try {
      await database.batch([
        insert('history-s01-stale-period-index', 15, {
          id: 'HISTORY-S01-STALE-PERIOD', storeId: 'S01', employeeId: 'E04', amount: 9_000,
          period: '2026-06', createdAt: '2026-09-01T01:00:00.000Z',
        }, { occurredOn: '2026-06-01', periodKey: '2026-06' }),
        insert('history-s01-legacy-edited', 25, {
          id: 'HISTORY-S01-LEGACY-EDITED', code: 'S01-LEGACY-CODE',
          storeId: 'S01', employeeId: 'E03', amount: 7_000,
          date: '2026-09-10', updatedAt: '2026-12-20T01:00:00.000Z',
        }),
        insert('history-s01-utc-boundary', 50, {
          id: 'HISTORY-S01-UTC-BOUNDARY', storeId: 'S01', employeeId: 'E01',
          amount: 5_000, createdAt: '2026-08-31T18:30:00.000Z',
        }),
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
        'history-s01-legacy-edited', 'history-s01-3',
      ])
      const second = database.readEntityHistory({
        collectionKey: 'orders', storeId: 'S01', period: '2026-09',
        beforeOccurredOn: first[1].occurred_on,
        beforeOrder: Number(first[1].entity_order),
        beforeKey: first[1].entity_key,
        limit: 2,
      })
      expect(second.map(({ entity_key: entityKey }) => entityKey)).toEqual(['history-s01-2', 'history-s01-1'])
      const third = database.readEntityHistory({
        collectionKey: 'orders', storeId: 'S01', period: '2026-09',
        beforeOccurredOn: second[1].occurred_on,
        beforeOrder: Number(second[1].entity_order),
        beforeKey: second[1].entity_key,
        limit: 2,
      })
      expect(third.map(({ entity_key: entityKey }) => entityKey)).toEqual([
        'history-s01-utc-boundary', 'history-s01-stale-period-index',
      ])
      expect(third[0].occurred_on).toBe('2026-09-01')
      expect(database.readEntityHistory({
        collectionKey: 'orders', storeId: 'S01', employeeId: 'E03', period: '2026-12', limit: 2,
      })).toEqual([])
      expect(database.readEntityHistory({
        collectionKey: 'orders', storeId: 'S01', employeeId: 'E04', period: '2026-09', limit: 2,
      }).map(({ entity_key: entityKey }) => entityKey)).toEqual(['history-s01-stale-period-index'])
      expect(database.readEntityHistory({
        collectionKey: 'orders', storeId: 'S01', period: '2026-12',
        orderId: 'S01-LEGACY-CODE', limit: 2,
      }).map(({ entity_key: entityKey }) => entityKey)).toEqual(['history-s01-legacy-edited'])
      expect(database.readEntityHistory({
        collectionKey: 'orders', storeId: 'S01', period: '2026-09',
        orderId: 'HISTORY-S02', limit: 2,
      })).toEqual([])
      expect(JSON.stringify([...first, ...second, ...third])).not.toContain('SECRET')
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

      expect(database.readOrderSummaryRows({ storeId: 'S01', period: '2026-09' })
        .map(({ value_json: valueJson }) => JSON.parse(valueJson).id)).toEqual([
        'HISTORY-S01-3', 'HISTORY-S01-2', 'HISTORY-S01-1', 'HISTORY-S01-UTC-BOUNDARY',
        'HISTORY-S01-LEGACY-EDITED', 'HISTORY-S01-STALE-PERIOD',
      ])
      expect(database.readOrderSummaryRows({ storeId: 'S01', employeeId: 'E01', period: '2026-09' })
        .map(({ value_json: valueJson }) => JSON.parse(valueJson).id)).toEqual([
        'HISTORY-S01-UTC-BOUNDARY',
      ])
    } finally {
      database.close()
    }
  })
})
