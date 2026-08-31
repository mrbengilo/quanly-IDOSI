import { AsyncLocalStorage } from 'node:async_hooks'
import { mkdirSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { DatabaseSync } from 'node:sqlite'

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
    this.database.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;')
    applyMigrations(this.database, migrationsDirectory)
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
