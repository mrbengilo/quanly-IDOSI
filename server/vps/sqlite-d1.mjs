import { mkdirSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const MIGRATION_TABLE = '_vps_migrations'

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
    return this.database.prepare(this.sql).get(...this.bindings) || null
  }

  _allSync() {
    return { results: this.database.prepare(this.sql).all(...this.bindings) }
  }

  _runSync() {
    const result = this.database.prepare(this.sql).run(...this.bindings)
    return {
      meta: {
        changes: Number(result.changes),
        last_row_id: Number(result.lastInsertRowid || 0),
      },
    }
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

  async batch(statements) {
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
