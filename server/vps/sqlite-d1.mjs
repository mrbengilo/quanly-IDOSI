import { AsyncLocalStorage } from 'node:async_hooks'
import { mkdirSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { DatabaseSync } from 'node:sqlite'
import { applyVpsDataFixes } from './data-fixes.mjs'

const MIGRATION_TABLE = '_vps_migrations'
const requestMetrics = new AsyncLocalStorage()

const STATE_SNAPSHOT_HEAD_SQL = `
  SELECT version, last_request_id
  FROM app_state
  WHERE scope_key = ?
  LIMIT 1
`

const STATE_SNAPSHOT_SQL = `
  SELECT
    0 AS row_kind,
    scope_key,
    NULL AS collection_key,
    NULL AS entity_key,
    NULL AS entity_order,
    value_json,
    NULL AS value_bytes,
    NULL AS created_at,
    updated_at,
    updated_by,
    last_request_id,
    version
  FROM app_state
  WHERE scope_key = ?

  UNION ALL

  SELECT
    1,
    scope_key,
    collection_key,
    NULL,
    NULL,
    NULL,
    NULL,
    created_at,
    updated_at,
    NULL,
    NULL,
    NULL
  FROM state_collections
  WHERE scope_key = ?

  UNION ALL

  SELECT
    2,
    scope_key,
    collection_key,
    entity_key,
    entity_order,
    value_json,
    value_bytes,
    created_at,
    updated_at,
    NULL,
    NULL,
    NULL
  FROM state_entities
  WHERE scope_key = ?

  ORDER BY row_kind, collection_key, entity_order, entity_key
`

// Store workspaces intentionally exclude system-wide history. SQLite performs
// this projection before Node materializes JSON, keeping one busy store page
// from parsing and serializing every other store's records on the event loop.
const STORE_WORKSPACE_COLLECTIONS = Object.freeze([
  'stores',
  'employees',
  'deletedEmployees',
  'attendance',
  'schedule',
  'officeAdjustments',
  'supportWorkAssignments',
  'supportWorkSchedules',
  'supportWorkScheduleHistory',
  'tasks',
  'taskAssignmentHistory',
  'notifications',
  'salaryAdjustments',
  'salaryAdvances',
  'payrollPeriods',
  'payrollPayments',
  'storeEmployeeSalaryConfigs',
  'workCatalogItems',
  'workCatalogProgress',
  'storeShiftTaskTemplates',
  'compensationEntries',
  'violations',
  'violationRefunds',
  'revenueBonusDaily',
  'revenueBonusAllocations',
  'teamRewardClaims',
  'teamRewardParticipants',
  'periodReconciliations',
  'jobRuns',
  'shiftDefinitions',
  'orders',
  'expenseEntries',
  'fixedExpenses',
  'cashTransactions',
  'importVouchers',
  'imports',
  'supportTransfers',
  'orderInformationOptions',
])

const STORE_WORKSPACE_GLOBAL_COLLECTIONS = Object.freeze([
  'orderInformationOptions',
  'workCatalogItems',
  'storeShiftTaskTemplates',
  'shiftDefinitions',
])

const STORE_SCREEN_BASE_COLLECTIONS = Object.freeze([
  'stores',
  'employees',
  'supportTransfers',
])

const STORE_PAYROLL_COMMAND_COLLECTIONS = Object.freeze([
  'deletedEmployees', 'attendance', 'schedule', 'officeAdjustments', 'salaryAdjustments', 'salaryAdvances',
  'payrollPeriods', 'payrollPayments', 'storeEmployeeSalaryConfigs', 'compensationEntries',
  'violations', 'violationRefunds', 'revenueBonusDaily', 'revenueBonusAllocations',
  'teamRewardClaims', 'teamRewardParticipants', 'periodReconciliations', 'jobRuns',
  'orders', 'expenseEntries', 'fixedExpenses', 'cashTransactions', 'workCatalogProgress',
])

// Every route receives only the collections it renders. Keeping the map here
// makes SQLite build one small projection before JavaScript parses any JSON.
export const STORE_SCREEN_COLLECTIONS = Object.freeze({
  // Internal authentication/session projections. They are not routable screen
  // names but prevent auth from materializing the full operational history.
  // Only an open attendance row is needed to preserve an employee's effective
  // support-transfer store after the scheduled transfer window has ended.
  session: ['attendance'],
  initial: ['attendance', 'supportWorkSchedules', 'schedule'],
  'initial-support': [
    'attendance', 'supportWorkSchedules', 'officeAdjustments', 'salaryAdjustments', 'payrollPeriods',
  ],
  'initial-manager': ['attendance'],
  'initial-store-employee': ['attendance', 'schedule', 'shiftDefinitions'],
  'initial-office-employee': [
    'attendance', 'supportWorkSchedules', 'officeAdjustments', 'salaryAdjustments', 'payrollPeriods',
  ],
  // Internal mutation projections. These are deliberately not accepted by the
  // public screen route; they let a Save read only the target store/domain.
  'command-order': [
    'attendance', 'orders', 'notifications', 'payrollPeriods', 'orderAudit',
    'auditLogs', 'orderInformationOptions',
  ],
  'command-expense': ['expenseEntries', 'fixedExpenses', 'payrollPeriods'],
  'command-import': ['importVouchers', 'expenseEntries', 'payrollPeriods'],
  'command-compensation': ['compensationEntries', 'payrollPeriods'],
  'command-salary-adjustment': ['salaryAdjustments', 'payrollPeriods'],
  'command-salary-config': ['storeEmployeeSalaryConfigs', 'payrollPeriods'],
  'command-store': ['deletedStores', 'orders', 'workCatalogItems'],
  'command-task': [
    'tasks', 'taskAssignmentHistory', 'supportWorkSchedules', 'notifications',
    'accountSettings', 'deletedEmployees', 'shiftDefinitions',
    'workCatalogItems', 'storeShiftTaskTemplates',
  ],
  'command-employee': [
    'deletedEmployees', 'schedule', 'payrollPeriods', 'accountSettings',
  ],
  'command-schedule': ['schedule', 'shiftDefinitions'],
  'command-notification': ['notifications'],
  'command-attendance': [
    'attendance', 'schedule', 'supportWorkSchedules', 'payrollPeriods',
    'tasks', 'taskAssignmentHistory', 'workCatalogItems', 'workCatalogProgress',
    'shiftDefinitions', 'orders', 'expenseEntries', 'cashTransactions',
    'compensationEntries', 'violations',
  ],
  'command-support-work': ['supportWorkAssignments', 'notifications', 'workCatalogItems'],
  'command-support-schedule': [
    'supportWorkSchedules', 'supportWorkScheduleHistory', 'notifications',
  ],
  'command-task-progress': [
    'attendance', 'tasks', 'taskAssignmentHistory', 'notifications', 'workCatalogItems',
  ],
  'command-shift-expense': ['attendance', 'expenseEntries', 'cashTransactions'],
  'command-salary-advance': [
    ...STORE_PAYROLL_COMMAND_COLLECTIONS,
  ],
  'command-work-catalog': [
    'workCatalogItems', 'workCatalogProgress', 'storeShiftTaskTemplates', 'attendance',
    'tasks', 'taskAssignmentHistory', 'schedule', 'shiftDefinitions',
    'compensationEntries', 'teamRewardClaims',
  ],
  'command-work-reward': ['attendance', 'schedule', 'shiftDefinitions'],
  'command-violation': [
    ...STORE_PAYROLL_COMMAND_COLLECTIONS, 'shiftDefinitions', 'workCatalogItems',
  ],
  'command-revenue-bonus': [
    ...STORE_PAYROLL_COMMAND_COLLECTIONS, 'shiftDefinitions', 'workCatalogItems',
  ],
  'command-payroll': [
    ...STORE_PAYROLL_COMMAND_COLLECTIONS,
  ],
  overview: [
    'orders', 'attendance', 'schedule', 'expenseEntries', 'violationRefunds',
  ],
  schedule: ['schedule', 'attendance', 'shiftDefinitions'],
  employees: ['deletedEmployees', 'storeEmployeeSalaryConfigs'],
  // Order history is loaded through /api/history/orders with a cursor.
  orders: ['orderInformationOptions'],
  tasks: [
    'tasks', 'taskAssignmentHistory', 'supportWorkAssignments', 'workCatalogProgress',
    'compensationEntries', 'attendance', 'notifications', 'workCatalogItems',
  ],
  imports: ['importVouchers', 'imports'],
  expenses: ['fixedExpenses', 'expenseEntries', 'cashTransactions', 'attendance'],
  attendance: ['attendance', 'schedule', 'expenseEntries'],
  payroll: [
    'attendance', 'salaryAdjustments', 'salaryAdvances', 'payrollPeriods', 'payrollPayments',
    'storeEmployeeSalaryConfigs', 'compensationEntries', 'violations', 'violationRefunds',
    'revenueBonusDaily', 'revenueBonusAllocations', 'teamRewardClaims', 'teamRewardParticipants',
    'periodReconciliations', 'expenseEntries',
  ],
  'salary-settings': ['storeEmployeeSalaryConfigs'],
  'revenue-bonus': [
    'orders', 'attendance', 'schedule', 'revenueBonusDaily', 'revenueBonusAllocations',
    'salaryAdjustments', 'teamRewardClaims', 'teamRewardParticipants', 'shiftDefinitions',
  ],
  'violation-refunds': ['violations', 'violationRefunds', 'compensationEntries'],
  'my-compensation': [
    'compensationEntries', 'salaryAdjustments', 'payrollPeriods', 'violations',
    'revenueBonusDaily', 'revenueBonusAllocations',
  ],
  'my-violations': ['violations', 'violationRefunds'],
  cashflow: ['orders', 'expenseEntries', 'fixedExpenses', 'cashTransactions', 'violationRefunds'],
  reports: ['orders', 'expenseEntries', 'violationRefunds'],
  settings: ['storeEmployeeSalaryConfigs'],
  'employee-home': [
    'orders', 'attendance', 'schedule', 'supportWorkSchedules', 'officeAdjustments',
    'salaryAdjustments', 'payrollPeriods', 'shiftDefinitions',
  ],
  'employee-tasks': [
    'tasks', 'taskAssignmentHistory', 'supportWorkAssignments', 'workCatalogProgress',
    'compensationEntries', 'attendance', 'notifications', 'workCatalogItems',
  ],
  'employee-assigned-work': ['supportWorkAssignments', 'notifications'],
  'employee-reward-tasks': [
    'attendance', 'tasks', 'workCatalogProgress', 'compensationEntries',
  ],
  'employee-shift-expenses': ['attendance', 'expenseEntries', 'tasks', 'taskAssignmentHistory'],
  'employee-orders': [
    'orders', 'attendance', 'notifications', 'payrollPeriods', 'orderInformationOptions',
  ],
  'employee-attendance': [
    'attendance', 'schedule', 'supportWorkSchedules', 'expenseEntries', 'shiftDefinitions',
  ],
  'employee-work-history': [
    'attendance', 'schedule', 'supportWorkSchedules', 'expenseEntries', 'shiftDefinitions',
  ],
  'employee-schedule': ['schedule', 'supportWorkSchedules', 'shiftDefinitions'],
  'employee-payroll': [
    'attendance', 'officeAdjustments', 'salaryAdjustments', 'salaryAdvances', 'payrollPeriods',
    'payrollPayments', 'storeEmployeeSalaryConfigs', 'compensationEntries', 'violations',
    'violationRefunds', 'revenueBonusDaily', 'revenueBonusAllocations', 'teamRewardClaims',
    'teamRewardParticipants', 'expenseEntries',
  ],
  'employee-compensation': [
    'compensationEntries', 'salaryAdjustments', 'payrollPeriods', 'violations',
    'revenueBonusDaily', 'revenueBonusAllocations',
  ],
  'employee-violations': [
    'violations', 'violationRefunds', 'attendance', 'schedule', 'supportWorkSchedules',
    'shiftDefinitions', 'workCatalogItems',
  ],
  'employee-revenue-bonus': [
    'orders', 'attendance', 'schedule', 'revenueBonusDaily', 'revenueBonusAllocations',
    'salaryAdjustments', 'teamRewardClaims', 'teamRewardParticipants', 'shiftDefinitions',
  ],
  'employee-cashflow': ['orders', 'expenseEntries', 'attendance'],
})

const sqlStringList = (values) => values.map((value) => `'${value.replaceAll("'", "''")}'`).join(', ')
const storeWorkspaceGlobalCollectionsSql = sqlStringList(STORE_WORKSPACE_GLOBAL_COLLECTIONS)

const storeSnapshotSqlCache = new Map()
const STORE_SCREEN_PERIOD_COLLECTIONS = Object.freeze({
  payroll: [
    'attendance', 'salaryAdjustments', 'salaryAdvances', 'payrollPeriods', 'payrollPayments',
    'compensationEntries', 'violations', 'violationRefunds',
    'revenueBonusDaily', 'revenueBonusAllocations', 'teamRewardClaims', 'teamRewardParticipants',
    'periodReconciliations', 'expenseEntries',
  ],
})
const storeStateSnapshotSql = (screen = '') => {
  const normalizedScreen = String(screen || '').trim()
  const screenCollections = STORE_SCREEN_COLLECTIONS[normalizedScreen]
  const selectedCollections = screenCollections
    ? [...new Set([...STORE_SCREEN_BASE_COLLECTIONS, ...screenCollections])]
    : STORE_WORKSPACE_COLLECTIONS
  const cacheKey = screenCollections ? normalizedScreen : 'workspace'
  if (storeSnapshotSqlCache.has(cacheKey)) return storeSnapshotSqlCache.get(cacheKey)
  const storeWorkspaceCollectionsSql = sqlStringList(selectedCollections)
  const periodCollections = STORE_SCREEN_PERIOD_COLLECTIONS[normalizedScreen] || []
  const periodFilterSql = periodCollections.length
    ? `AND (params.period_key = '' OR entity.collection_key NOT IN (${sqlStringList(periodCollections)}) OR entity.period_key = params.period_key)`
    : ''
  const payrollAttendanceEmployeeSeedSql = normalizedScreen === 'payroll'
    ? `
    UNION
    SELECT DISTINCT lower(trim(attendance.employee_id)) AS employee_key
    FROM state_entities AS attendance
    JOIN params ON attendance.scope_key = params.scope_key
    WHERE attendance.collection_key = 'attendance'
      AND attendance.store_id = params.store_key COLLATE NOCASE
      AND attendance.employee_id IS NOT NULL
      AND trim(attendance.employee_id) <> ''
      AND json_extract(attendance.value_json, '$.deletedAt') IS NULL
      AND (
        json_type(attendance.value_json, '$.supportCompensation') = 'object'
        OR json_type(attendance.value_json, '$.compensation.support') = 'object'
        OR trim(COALESCE(CAST(json_extract(attendance.value_json, '$.supportStoreId') AS TEXT), '')) <> ''
      )
      AND (params.period_key = '' OR attendance.period_key = params.period_key)`
    : ''
  const sessionFilterSql = normalizedScreen === 'session'
    ? `AND (entity.collection_key <> 'attendance' OR (
        entity.open_flag = 1
        OR (
          entity.open_flag IS NULL
          AND json_extract(entity.value_json, '$.deletedAt') IS NULL
          AND trim(COALESCE(CAST(json_extract(entity.value_json, '$.checkOut') AS TEXT), '')) = ''
          AND trim(COALESCE(CAST(json_extract(entity.value_json, '$.checkOutAt') AS TEXT), '')) = ''
        )
      ))`
    : ''
  const sql = `
  WITH
  params AS (
    SELECT
      ? AS scope_key,
      lower(trim(?)) AS store_key,
      lower(trim(?)) AS actor_employee_key,
      trim(?) AS period_key
  ),
  inbound_employee_ids AS (
    SELECT DISTINCT lower(trim(CAST(json_extract(transfer.value_json, '$.employeeId') AS TEXT))) AS employee_key
    FROM state_entities AS transfer
    JOIN params ON transfer.scope_key = params.scope_key
    WHERE transfer.collection_key = 'supportTransfers'
      AND lower(trim(CAST(json_extract(transfer.value_json, '$.toStoreId') AS TEXT))) = params.store_key
      AND json_extract(transfer.value_json, '$.employeeId') IS NOT NULL
  ),
  seed_employee_ids AS (
    SELECT actor_employee_key AS employee_key FROM params WHERE actor_employee_key <> ''
    UNION
    SELECT employee_key FROM inbound_employee_ids WHERE employee_key <> ''
    ${payrollAttendanceEmployeeSeedSql}
  ),
  relevant_employee_rows AS (
    SELECT employee.entity_key
    FROM state_entities AS employee
    JOIN params ON employee.scope_key = params.scope_key
    WHERE employee.collection_key = 'employees'
      AND (
        employee.store_id = params.store_key COLLATE NOCASE
        OR employee.employee_id IN (
          SELECT employee_key COLLATE NOCASE FROM seed_employee_ids
        )
        OR EXISTS (
          SELECT 1
          FROM json_each(json_array(
            json_extract(employee.value_json, '$.id'),
            json_extract(employee.value_json, '$.code'),
            json_extract(employee.value_json, '$.employeeId'),
            json_extract(employee.value_json, '$.employeeCode')
          )) AS identifier
          JOIN seed_employee_ids AS seed
            ON lower(trim(CAST(identifier.value AS TEXT))) = seed.employee_key
          WHERE employee.store_id IS NULL
            AND employee.employee_id IS NULL
        )
      )
  ),
  selected_employee_ids AS (
    SELECT employee_key FROM seed_employee_ids
    UNION
    SELECT DISTINCT lower(trim(CAST(identifier.value AS TEXT))) AS employee_key
    FROM state_entities AS employee
    JOIN params ON employee.scope_key = params.scope_key
    JOIN relevant_employee_rows AS relevant ON relevant.entity_key = employee.entity_key
    JOIN json_each(json_array(
      json_extract(employee.value_json, '$.id'),
      json_extract(employee.value_json, '$.code'),
      json_extract(employee.value_json, '$.employeeId'),
      json_extract(employee.value_json, '$.employeeCode')
    )) AS identifier
    WHERE employee.collection_key = 'employees'
      AND identifier.value IS NOT NULL
      AND trim(CAST(identifier.value AS TEXT)) <> ''
  ),
  relevant_order_ids AS (
    SELECT DISTINCT lower(trim(CAST(json_extract(entity.value_json, '$.id') AS TEXT))) AS order_key
    FROM state_entities AS entity
    JOIN params ON entity.scope_key = params.scope_key
    WHERE entity.collection_key = 'orders'
      AND json_extract(entity.value_json, '$.id') IS NOT NULL
      AND (
        entity.store_id = params.store_key COLLATE NOCASE
        OR entity.employee_id IN (
          SELECT employee_key COLLATE NOCASE FROM selected_employee_ids
        )
        OR (entity.store_id IS NULL AND entity.employee_id IS NULL AND EXISTS (
          SELECT 1 FROM json_tree(entity.value_json) AS reference
          WHERE reference.key IN ('storeId', 'store_id', 'supportStoreId', 'fromStoreId', 'toStoreId')
            AND lower(trim(CAST(reference.value AS TEXT))) = params.store_key
        ))
        OR (entity.store_id IS NULL AND entity.employee_id IS NULL AND EXISTS (
          SELECT 1 FROM json_tree(entity.value_json) AS reference
          JOIN selected_employee_ids AS selected
            ON lower(trim(CAST(reference.value AS TEXT))) = selected.employee_key
          WHERE reference.type NOT IN ('object', 'array')
        ))
      )
  )
  SELECT
    0 AS row_kind,
    app.scope_key,
    NULL AS collection_key,
    NULL AS entity_key,
    NULL AS entity_order,
    app.value_json,
    NULL AS value_bytes,
    NULL AS created_at,
    app.updated_at,
    app.updated_by,
    app.last_request_id,
    app.version
  FROM app_state AS app
  JOIN params ON app.scope_key = params.scope_key

  UNION ALL

  SELECT
    1,
    collection.scope_key,
    collection.collection_key,
    NULL,
    NULL,
    NULL,
    NULL,
    collection.created_at,
    collection.updated_at,
    NULL,
    NULL,
    NULL
  FROM state_collections AS collection
  JOIN params ON collection.scope_key = params.scope_key
  WHERE collection.collection_key IN (${storeWorkspaceCollectionsSql})

  UNION ALL

  SELECT
    2,
    entity.scope_key,
    entity.collection_key,
    entity.entity_key,
    entity.entity_order,
    entity.value_json,
    entity.value_bytes,
    entity.created_at,
    entity.updated_at,
    NULL,
    NULL,
    NULL
  FROM state_entities AS entity
  JOIN params ON entity.scope_key = params.scope_key
  WHERE entity.collection_key IN (${storeWorkspaceCollectionsSql})
    ${periodFilterSql}
    ${sessionFilterSql}
    AND (
      entity.collection_key = 'stores'
      OR entity.store_id = params.store_key COLLATE NOCASE
      OR entity.employee_id IN (
        SELECT employee_key COLLATE NOCASE FROM selected_employee_ids
      )
      OR (
        entity.collection_key IN (${storeWorkspaceGlobalCollectionsSql})
        AND entity.store_id IS NULL
        AND trim(COALESCE(CAST(json_extract(entity.value_json, '$.storeId') AS TEXT), '')) = ''
      )
      OR (entity.store_id IS NULL AND entity.employee_id IS NULL AND EXISTS (
        SELECT 1 FROM json_tree(entity.value_json) AS reference
        WHERE reference.key IN ('storeId', 'store_id', 'supportStoreId', 'fromStoreId', 'toStoreId')
          AND lower(trim(CAST(reference.value AS TEXT))) = params.store_key
      ))
      OR (entity.store_id IS NULL AND entity.employee_id IS NULL AND EXISTS (
        SELECT 1 FROM json_tree(entity.value_json) AS reference
        JOIN selected_employee_ids AS selected
          ON lower(trim(CAST(reference.value AS TEXT))) = selected.employee_key
        WHERE reference.type NOT IN ('object', 'array')
      ))
      OR (
        entity.collection_key = 'notifications'
        AND EXISTS (
          SELECT 1 FROM json_tree(entity.value_json) AS reference
          JOIN relevant_order_ids AS relevant_order
            ON lower(trim(CAST(reference.value AS TEXT))) = relevant_order.order_key
          WHERE reference.type NOT IN ('object', 'array')
        )
      )
    )

  ORDER BY row_kind, collection_key, entity_order, entity_key
`
  storeSnapshotSqlCache.set(cacheKey, sql)
  return sql
}

const FINANCE_OVERVIEW_SQL = `
  WITH finance_entries AS (
    SELECT
      store_id,
      CAST(json_extract(value_json, '$.amount') AS INTEGER) AS amount,
      'revenue' AS direction
    FROM state_entities
    WHERE scope_key = 'global'
      AND collection_key = 'orders'
      AND store_id IS NOT NULL
      AND json_extract(value_json, '$.deletedAt') IS NULL
      AND COALESCE(CAST(json_extract(value_json, '$.status') AS TEXT), '') <> 'Đã xóa'
      AND typeof(json_extract(value_json, '$.amount')) IN ('integer', 'real')
      AND CAST(json_extract(value_json, '$.amount') AS INTEGER) = json_extract(value_json, '$.amount')
      AND CAST(json_extract(value_json, '$.amount') AS INTEGER) >= 0
      AND period_key = ?

    UNION ALL

    SELECT
      store_id,
      CAST(json_extract(value_json, '$.amount') AS INTEGER),
      'expense'
    FROM state_entities
    WHERE scope_key = 'global'
      AND collection_key = 'expenseEntries'
      AND store_id IS NOT NULL
      AND json_extract(value_json, '$.deletedAt') IS NULL
      AND json_extract(value_json, '$.recognized') IS NOT 0
      AND typeof(json_extract(value_json, '$.amount')) IN ('integer', 'real')
      AND CAST(json_extract(value_json, '$.amount') AS INTEGER) = json_extract(value_json, '$.amount')
      AND CAST(json_extract(value_json, '$.amount') AS INTEGER) >= 0
      AND period_key = ?

    UNION ALL

    SELECT
      store_id,
      CAST(COALESCE(
        json_extract(value_json, '$.amountVnd'),
        json_extract(value_json, '$.amount')
      ) AS INTEGER),
      'revenue'
    FROM state_entities
    WHERE scope_key = 'global'
      AND collection_key = 'violationRefunds'
      AND store_id IS NOT NULL
      AND json_extract(value_json, '$.recognized') = 1
      AND upper(CAST(json_extract(value_json, '$.status') AS TEXT)) = 'RECOGNIZED'
      AND json_extract(value_json, '$.deletedAt') IS NULL
      AND json_extract(value_json, '$.voidedAt') IS NULL
      AND typeof(COALESCE(
        json_extract(value_json, '$.amountVnd'),
        json_extract(value_json, '$.amount')
      )) IN ('integer', 'real')
      AND CAST(COALESCE(
        json_extract(value_json, '$.amountVnd'),
        json_extract(value_json, '$.amount')
      ) AS INTEGER) = COALESCE(
        json_extract(value_json, '$.amountVnd'),
        json_extract(value_json, '$.amount')
      )
      AND CAST(COALESCE(
        json_extract(value_json, '$.amountVnd'),
        json_extract(value_json, '$.amount')
      ) AS INTEGER) >= 0
      AND period_key = ?
  )
  SELECT
    store_id,
    CAST(SUM(CASE WHEN direction = 'revenue' THEN amount ELSE 0 END) AS INTEGER) AS revenue,
    CAST(SUM(CASE WHEN direction = 'expense' THEN amount ELSE 0 END) AS INTEGER) AS expense
  FROM finance_entries
  WHERE trim(COALESCE(store_id, '')) <> ''
  GROUP BY store_id
  ORDER BY store_id
`

const measuredStatement = (kind, operation) => {
  const metrics = requestMetrics.getStore()
  if (!metrics) return operation()
  const startedAt = performance.now()
  try {
    return operation()
  } finally {
    const durationMs = performance.now() - startedAt
    metrics.statements += 1
    metrics[kind] += 1
    metrics.totalMs += durationMs
    metrics.maxMs = Math.max(metrics.maxMs, durationMs)
  }
}

export const runWithSqliteMetrics = (metrics, operation) => requestMetrics.run(metrics, operation)

const decodeStateSnapshotRecords = (records) => {
  let row = null
  const manifests = []
  const entities = []
  for (const record of records) {
    if (Number(record.row_kind) === 0) {
      row = {
        scope_key: record.scope_key,
        value_json: record.value_json,
        version: record.version,
        updated_at: record.updated_at,
        updated_by: record.updated_by,
        last_request_id: record.last_request_id,
      }
    } else if (Number(record.row_kind) === 1) {
      manifests.push({
        collection_key: record.collection_key,
        created_at: record.created_at,
        updated_at: record.updated_at,
      })
    } else if (Number(record.row_kind) === 2) {
      entities.push({
        collection_key: record.collection_key,
        entity_key: record.entity_key,
        entity_order: record.entity_order,
        value_json: record.value_json,
        value_bytes: record.value_bytes,
        created_at: record.created_at,
        updated_at: record.updated_at,
      })
    }
  }
  return { unchanged: false, row, manifests, entities }
}

class SqliteD1Statement {
  constructor(database, sql, bindings = []) {
    this.database = database
    this.sql = sql
    this.bindings = bindings
  }

  bind(...bindings) {
    return new SqliteD1Statement(this.database, this.sql, bindings)
  }

  _firstSync() {
    return measuredStatement('reads', () => this.database.prepare(this.sql).get(...this.bindings) || null)
  }

  _allSync() {
    return measuredStatement('reads', () => ({ results: this.database.prepare(this.sql).all(...this.bindings) }))
  }

  _runSync() {
    return measuredStatement('writes', () => {
      const result = this.database.prepare(this.sql).run(...this.bindings)
      return {
        meta: {
          changes: Number(result.changes),
          last_row_id: Number(result.lastInsertRowid || 0),
        },
      }
    })
  }

  async first() {
    return this._firstSync()
  }

  async all() {
    return this._allSync()
  }

  async run() {
    return this._runSync()
  }
}

const applyMigrations = (database, migrationsDirectory) => {
  database.exec(`
    CREATE TABLE IF NOT EXISTS ${MIGRATION_TABLE} (
      migration_name TEXT PRIMARY KEY NOT NULL,
      applied_at TEXT NOT NULL
    ) STRICT;
  `)
  const applied = new Set(database.prepare(`SELECT migration_name FROM ${MIGRATION_TABLE}`).all()
    .map(({ migration_name: migrationName }) => migrationName))
  const migrationFiles = readdirSync(migrationsDirectory)
    .filter((name) => /^\d+.*\.sql$/u.test(name))
    .sort((left, right) => left.localeCompare(right))

  for (const migrationFile of migrationFiles) {
    if (applied.has(migrationFile)) continue
    const migrationSql = readFileSync(resolve(migrationsDirectory, migrationFile), 'utf8')
      .replaceAll('--> statement-breakpoint', '')
    database.exec('BEGIN IMMEDIATE')
    try {
      database.exec(migrationSql)
      database.prepare(`INSERT INTO ${MIGRATION_TABLE} (migration_name, applied_at) VALUES (?, ?)`)
        .run(migrationFile, new Date().toISOString())
      database.exec('COMMIT')
    } catch (error) {
      database.exec('ROLLBACK')
      throw new Error(`Không thể áp dụng migration ${migrationFile}: ${error.message}`, { cause: error })
    }
  }

  const violations = database.prepare('PRAGMA foreign_key_check').all()
  if (violations.length) {
    throw new Error(`Cơ sở dữ liệu có ${violations.length} lỗi khóa ngoại sau migration.`)
  }
}

export class SqliteD1 {
  constructor({ databasePath, migrationsDirectory }) {
    if (!databasePath) throw new Error('Thiếu đường dẫn IDOSI_DB_PATH.')
    mkdirSync(dirname(databasePath), { recursive: true })
    this.database = new DatabaseSync(databasePath)
    this.database.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
    PRAGMA cache_size = -32768;
    PRAGMA mmap_size = 67108864;
    PRAGMA temp_store = MEMORY;
  `)
    applyMigrations(this.database, migrationsDirectory)
    this.dataFixResult = applyVpsDataFixes(this.database)
    if (this.dataFixResult.status === 'applied') {
      console.info(JSON.stringify({ event: 'idosi.data_fix', ...this.dataFixResult.marker }))
    }
  }

  prepare(sql) {
    return new SqliteD1Statement(this.database, sql)
  }

  readStateSnapshot(scope, known = null) {
    const knownVersion = Number(known?.version)
    const knownLastRequestId = String(known?.lastRequestId || '')
    if (known && Number.isSafeInteger(knownVersion) && knownVersion >= 1) {
      const head = measuredStatement('reads', () => (
        this.database.prepare(STATE_SNAPSHOT_HEAD_SQL).get(scope) || null
      ))
      if (!head) {
        return { unchanged: false, row: null, manifests: [], entities: [] }
      }
      if (Number(head.version) === knownVersion
        && String(head.last_request_id || '') === knownLastRequestId) {
        return { unchanged: true }
      }
    }

    const records = measuredStatement('reads', () => (
      this.database.prepare(STATE_SNAPSHOT_SQL).all(scope, scope, scope)
    ))
    return decodeStateSnapshotRecords(records)
  }

  readStoreStateSnapshot(scope, storeId, actorEmployeeId = '', screen = '', period = '') {
    const records = measuredStatement('reads', () => (
      this.database.prepare(storeStateSnapshotSql(screen)).all(scope, storeId, actorEmployeeId, period)
    ))
    return decodeStateSnapshotRecords(records)
  }

  readFinanceOverview(period) {
    return measuredStatement('reads', () => (
      this.database.prepare(FINANCE_OVERVIEW_SQL).all(period, period, period)
    ))
  }

  readEntityHistory({
    scope = 'global',
    collectionKey,
    storeId,
    employeeId = '',
    period = '',
    beforeOccurredOn = null,
    beforeOrder = null,
    beforeKey = '',
    limit = 50,
  }) {
    const cursorOrder = Number.isSafeInteger(beforeOrder) ? beforeOrder : null
    return measuredStatement('reads', () => this.database.prepare(`
      SELECT
        entity_key, entity_order, value_json, value_bytes,
        store_id, employee_id, occurred_on, period_key, created_at, updated_at
      FROM state_entities
      WHERE scope_key = ?
        AND collection_key = ?
        AND store_id = ? COLLATE NOCASE
        AND (? = '' OR employee_id = ? COLLATE NOCASE)
        AND (? = '' OR period_key = ?)
      AND (
          ? IS NULL
          OR COALESCE(occurred_on, '') < ?
          OR (COALESCE(occurred_on, '') = ? AND entity_order < ?)
          OR (COALESCE(occurred_on, '') = ? AND entity_order = ? AND entity_key < ?)
        )
      ORDER BY COALESCE(occurred_on, '') DESC, entity_order DESC, entity_key DESC
      LIMIT ?
    `).all(
      scope,
      collectionKey,
      storeId,
      employeeId,
      employeeId,
      period,
      period,
      beforeOccurredOn,
      beforeOccurredOn,
      beforeOccurredOn,
      cursorOrder,
      beforeOccurredOn,
      cursorOrder,
      beforeKey,
      limit,
    ))
  }

  async batch(statements) {
    const metrics = requestMetrics.getStore()
    if (metrics) metrics.batches += 1
    this.database.exec('BEGIN IMMEDIATE')
    try {
      const results = statements.map((statement) => statement._runSync())
      this.database.exec('COMMIT')
      return results
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
  }

  close() {
    this.database.close()
  }
}

export const createSqliteD1 = ({
  databasePath,
  migrationsDirectory = resolve(process.cwd(), 'drizzle'),
} = {}) => new SqliteD1({ databasePath, migrationsDirectory })
