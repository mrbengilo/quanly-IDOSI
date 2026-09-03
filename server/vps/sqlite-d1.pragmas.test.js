// @vitest-environment node

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createSqliteD1 } from './sqlite-d1.mjs'

const temporaryDirectories = []

const pragmaValue = (database, name) => Object.values(
  database.database.prepare(`PRAGMA ${name}`).get(),
)[0]

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => (
    rm(directory, { recursive: true, force: true })
  )))
})

describe('SQLite production read configuration', () => {
  it('keeps WAL durability while providing a bounded read cache and memory-backed temp data', async () => {
    const directory = await mkdtemp(resolve(tmpdir(), 'idosi-sqlite-pragmas-'))
    temporaryDirectories.push(directory)
    const database = createSqliteD1({ databasePath: resolve(directory, 'idosi.sqlite') })
    try {
      expect(String(pragmaValue(database, 'journal_mode')).toLowerCase()).toBe('wal')
      expect(pragmaValue(database, 'busy_timeout')).toBe(5_000)
      expect(pragmaValue(database, 'cache_size')).toBe(-32_768)
      expect(pragmaValue(database, 'mmap_size')).toBeGreaterThanOrEqual(67_108_864)
      expect(pragmaValue(database, 'temp_store')).toBe(2)
    } finally {
      database.close()
    }
  })
})
