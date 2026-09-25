// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { expect, it } from 'vitest'
import { createOnlineBackup } from './online-backup.mjs'
import { createSqliteD1 } from './sqlite-d1.mjs'

it('copies committed data while a writer holds an open transaction', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'idosi-online-backup-'))
  const databasePath = resolve(directory, 'idosi.sqlite')
  const outputPath = resolve(directory, 'snapshot', 'idosi.sqlite')
  const live = createSqliteD1({ databasePath, migrationsDirectory: resolve('drizzle') })
  try {
    const now = new Date().toISOString()
    live.database.prepare(`
      INSERT INTO app_state (scope_key, value_json, version, updated_at) VALUES ('global', '{}', 7, ?)
    `).run(now)
    live.database.exec('BEGIN IMMEDIATE')
    live.database.prepare(`
      INSERT INTO system_metadata (meta_key, value_json, updated_at) VALUES ('uncommitted', '{}', ?)
    `).run(now)

    const result = createOnlineBackup({ databasePath, outputPath, busyTimeoutMs: 1_000 })
    live.database.exec('COMMIT')

    expect(result).toMatchObject({ integrity: 'ok', stateVersion: 7, outputPath })
    const copy = new DatabaseSync(outputPath, { readOnly: true })
    try {
      expect(copy.prepare("SELECT COUNT(*) AS count FROM system_metadata WHERE meta_key = 'uncommitted'").get().count).toBe(0)
      expect(copy.prepare('PRAGMA journal_mode').get().journal_mode).not.toBe('wal')
      expect(copy.prepare('SELECT COUNT(*) AS count FROM _vps_migrations').get().count).toBeGreaterThan(10)
    } finally {
      copy.close()
    }
  } finally {
    live.close()
    await rm(directory, { recursive: true, force: true })
  }
})

it('refuses to report a backup when the source is missing', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'idosi-online-backup-missing-'))
  try {
    expect(() => createOnlineBackup({
      databasePath: resolve(directory, 'idosi.sqlite'),
      outputPath: resolve(directory, 'out.sqlite'),
    })).toThrow('Không tìm thấy SQLite nguồn')
    expect(existsSync(resolve(directory, 'idosi.sqlite'))).toBe(false)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
