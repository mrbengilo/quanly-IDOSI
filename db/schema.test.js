// @vitest-environment node
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'
import { createSqliteD1 } from '../server/vps/sqlite-d1.mjs'
import { migrations, schema } from './schema.ts'

const tableName = (key, definition) => definition.table || key

it('lists every SQL migration in order', async () => {
  const files = (await readdir(resolve('drizzle'))).filter((name) => /^\d+.*\.sql$/u.test(name)).sort()
  expect(migrations).toEqual(files.map((name) => `drizzle/${name}`))
})

it('matches the columns produced by the migrations', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'idosi-schema-'))
  const database = createSqliteD1({ databasePath: resolve(directory, 'schema.sqlite'), migrationsDirectory: resolve('drizzle') })
  try {
    for (const [key, definition] of Object.entries(schema)) {
      const columns = database.database.prepare(`PRAGMA table_info(${tableName(key, definition)})`).all()
        .map((column) => column.name)
      expect(columns.sort(), key).toEqual([...definition.columns].sort())
    }
  } finally {
    database.close()
    await rm(directory, { recursive: true, force: true })
  }
})
