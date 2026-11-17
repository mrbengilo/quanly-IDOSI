// @vitest-environment node
import { copyFile, mkdtemp, mkdir, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { Buffer } from 'node:buffer'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'
import { createSqliteD1, runWithSqliteMetrics } from './sqlite-d1.mjs'
import { customerDirectory } from '../../src/domain/customerLookup.js'

const timestamp = '2026-11-17T00:00:00Z'
const seedScope = (db, scope = 'global') => {
  db.prepare(`INSERT INTO app_state(scope_key,value_json,version,updated_at,last_request_id)
    VALUES (?, '{}', 1, ?, 'fixture')`).run(scope, timestamp)
  db.prepare(`INSERT INTO state_collections VALUES (?, 'orders', ?, ?)`).run(scope, timestamp, timestamp)
}
const insert = (db, id, fields = {}, scope = 'global') => {
  const value = JSON.stringify({ id, storeId: 'S1', customerPhone: '0901234567',
    customerName: 'Nguyễn Ánh', createdAt: timestamp, ...fields })
  db.prepare(`INSERT OR REPLACE INTO state_entities(scope_key,collection_key,entity_key,entity_order,
    value_json,value_bytes,created_at,updated_at,store_id,record_id)
    VALUES (?, 'orders', ?, 1, ?, ?, ?, ?, ?, ?)`)
    .run(scope, id, value, Buffer.byteLength(value), timestamp, timestamp, fields.storeId || 'S1', id)
}
const update = (db, id, fields) => {
  const old = db.prepare("SELECT value_json FROM state_entities WHERE scope_key='global' AND collection_key='orders' AND entity_key=?").get(id)
  const value = JSON.stringify({ ...JSON.parse(old.value_json), ...fields })
  db.prepare("UPDATE state_entities SET value_json=?,value_bytes=? WHERE scope_key='global' AND collection_key='orders' AND entity_key=?")
    .run(value, Buffer.byteLength(value), id)
}

it('backfills existing orders without changing canonical state, then tracks writes, replacements, rollback and cascade deletes', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'idosi-contact-migration-'))
  let adapter
  try {
    const oldMigrations = resolve(directory, 'old-migrations')
    await mkdir(oldMigrations)
    for (const name of await readdir(resolve('drizzle'))) {
      if (name.endsWith('.sql') && name < '0018_') {
        await copyFile(resolve('drizzle', name), resolve(oldMigrations, name))
      }
    }
    const databasePath = resolve(directory, 'state.sqlite')
    adapter = createSqliteD1({ databasePath, migrationsDirectory: oldMigrations })
    seedScope(adapter.database)
    seedScope(adapter.database, 'another-scope')
    insert(adapter.database, 'O1', { items: [{ privateDetail: 'x'.repeat(100_000) }] })
    insert(adapter.database, 'O2', { storeId: 'S2' })
    insert(adapter.database, 'PRIVATE', { customerPhone: '0999999999' }, 'another-scope')
    const canonical = adapter.database.prepare('SELECT * FROM state_entities ORDER BY scope_key,entity_key').all()
    adapter.close()
    adapter = createSqliteD1({ databasePath })
    const db = adapter.database
    expect(db.prepare('SELECT * FROM state_entities ORDER BY scope_key,entity_key').all()).toEqual(canonical)
    expect(db.prepare("SELECT version FROM app_state WHERE scope_key='global'").get().version).toBe(1)
    const expectedOrders = canonical.filter(row => row.scope_key === 'global')
      .map(row => ({ ...JSON.parse(row.value_json), entityKey: row.entity_key }))
    // Only the compact contact shape is cached, never full items or money.
    const first = await adapter.readCustomerDirectory()
    expect(first.map(({ orders: _orders, ...contact }) => contact)).toEqual(customerDirectory(expectedOrders).map(({ orders: _orders, ...contact }) => contact))
    expect(first[0].orders.map(order => order.entityKey)).toEqual(['O2', 'O1'])
    expect(JSON.stringify(first)).not.toMatch(/privateDetail|items|0999999999/)
    expect(await adapter.readCustomerDirectory()).toBe(first)
    db.prepare("UPDATE app_state SET version=version+1 WHERE scope_key='global'").run()
    expect(await adapter.readCustomerDirectory()).toBe(first)

    update(db, 'O2', { customerPhone: '0888888888' })
    expect((await adapter.readCustomerDirectory()).map(row => row.customerPhone)).toEqual(['0888888888', '0901234567'])
    update(db, 'O2', { deletedAt: timestamp })
    expect((await adapter.readCustomerDirectory()).flatMap(row => row.orders).map(row => row.id)).toEqual(['O1'])
    update(db, 'O2', { deletedAt: null, source: 'legacy-opening-balance' })
    expect((await adapter.readCustomerDirectory()).flatMap(row => row.orders)).toHaveLength(1)
    insert(db, 'O2') // INSERT OR REPLACE must not leave an old projection.
    const restored = await adapter.readCustomerDirectory()
    expect(restored[0].orderCount).toBe(2)
    db.exec('BEGIN IMMEDIATE')
    update(db, 'O2', { customerPhone: '0777777777' })
    db.exec('ROLLBACK')
    expect(await adapter.readCustomerDirectory()).toBe(restored)
    db.prepare("DELETE FROM state_entities WHERE scope_key='global' AND collection_key='orders' AND entity_key='O2'").run()
    expect((await adapter.readCustomerDirectory())[0].orderCount).toBe(1)
    // Imports may move a row between collections/scopes. A same-key order in
    // the old scope must retain its contact and its cached classification.
    insert(db, 'SHARED', { customerPhone: '0666666666' })
    insert(db, 'SHARED', { customerPhone: '0555555555' }, 'another-scope')
    db.prepare("INSERT INTO state_collections VALUES ('global','schedule',?,?)").run(timestamp, timestamp)
    db.prepare("UPDATE state_entities SET scope_key='global',collection_key='schedule' WHERE scope_key='another-scope' AND collection_key='orders' AND entity_key='SHARED'").run()
    db.prepare("UPDATE state_entities SET scope_key='another-scope',collection_key='orders' WHERE scope_key='global' AND collection_key='schedule' AND entity_key='SHARED'").run()
    expect((await adapter.readCustomerDirectory()).find(row => row.customerPhone === '0666666666')?.orderCount).toBe(1)
    expect((await adapter.readCustomerDirectory()).some(row => row.customerPhone === '0555555555')).toBe(false)
    db.prepare("DELETE FROM state_collections WHERE scope_key='global' AND collection_key='orders'").run()
    expect(await adapter.readCustomerDirectory()).toEqual([])
    expect(db.prepare("SELECT * FROM customer_order_contacts WHERE scope_key='global'").all()).toEqual([])
    expect(db.prepare('PRAGMA integrity_check').get().integrity_check).toBe('ok')
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([])
  } finally {
    adapter?.close()
    await rm(directory, { recursive: true, force: true })
  }
})

it('uses one atomic revision with queued contacts and reuses the directory without scanning order JSON', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'idosi-contact-reader-'))
  const adapter = createSqliteD1({ databasePath: resolve(directory, 'state.sqlite'), backgroundSnapshotReads: true })
  try {
    seedScope(adapter.database)
    insert(adapter.database, 'O1')
    const slow = adapter.snapshotReader.query(`WITH RECURSIVE n(x) AS (
      VALUES(0) UNION ALL SELECT x+1 FROM n WHERE x<2000000
    ) SELECT sum(x) AS total FROM n`, [])
    const pending = adapter.readCustomerDirectory()
    // Simulate a committed write from another request before the reader starts.
    insert(adapter.database, 'O2')
    await slow
    const customers = await pending
    expect(customers[0].orderCount).toBe(2)
    const revision = adapter.database.prepare("SELECT revision FROM customer_contact_revisions WHERE scope_key='global'").get().revision
    expect(adapter.customerDirectoryCache.revision).toBe(revision)
    const metrics = { statements:0,reads:0,writes:0,batches:0,totalMs:0,maxMs:0 }
    expect(await runWithSqliteMetrics(metrics, () => adapter.readCustomerDirectory())).toBe(customers)
    expect(metrics.reads).toBe(1)
    expect(metrics.writes).toBe(0)
    expect(metrics.maxStatement).toBe('customerContacts:revision')
  } finally {
    adapter.close()
    await rm(directory, { recursive: true, force: true })
  }
})
