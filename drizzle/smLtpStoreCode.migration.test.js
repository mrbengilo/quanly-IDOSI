// @vitest-environment node

import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'

const sql = (name) => readFileSync(`drizzle/${name}.sql`, 'utf8').replaceAll('--> statement-breakpoint', '')
const migration = sql('0020_sm_ltp_store_code')

const withStoreDatabase = (run) => {
  const db = new DatabaseSync(':memory:')
  try {
    db.exec(sql('0000_idosi_core'))
    db.exec(sql('0003_state_entities'))
    db.exec(`
      INSERT INTO app_state (scope_key, value_json, version, updated_at, last_request_id)
      VALUES ('global', '{}', 7, '2026-11-20', 'existing-request');
      INSERT INTO state_collections (scope_key, collection_key, created_at, updated_at)
      VALUES ('global', 'stores', '2026-11-20', '2026-11-20'),
        ('global', 'deletedStores', '2026-11-20', '2026-11-20');
    `)
    const insert = (collection, key, store) => db.prepare(`
      INSERT INTO state_entities (scope_key, collection_key, entity_key, entity_order, value_json, value_bytes, created_at, updated_at)
      VALUES ('global', ?, ?, 0, ?, length(CAST(? AS BLOB)), '2026-11-20', '2026-11-20')
    `).run(collection, key, JSON.stringify(store), JSON.stringify(store))
    const read = (key) => JSON.parse(db.prepare('SELECT value_json FROM state_entities WHERE entity_key = ?').get(key).value_json)
    run({ db, insert, read })
  } finally {
    db.close()
  }
}

describe('0020 SM LTP store code migration', () => {
  it('assigns SM-LTP to the exact existing record and retains its id and profile', () => withStoreDatabase(({ db, insert, read }) => {
    const store = { id: 'DOSII-LTP', name: 'SM LTP', short: 'LTP', address: 'Địa chỉ cửa hàng' }
    insert('stores', 'canonical-store-row', store)
    insert('stores', 'other-row', { id: 'DOSII-NTL', name: 'Dosii NTL' })
    db.exec(migration)
    expect(read('canonical-store-row')).toEqual({ ...store, code: 'SM-LTP', storeBrand: 'SM' })
    expect(read('other-row')).toEqual({ id: 'DOSII-NTL', name: 'Dosii NTL' })
    expect(db.prepare('SELECT version, last_request_id FROM app_state').get())
      .toMatchObject({ version: 8, last_request_id: 'migration:0020:sm-ltp-store-code' })
  }))

  it('leaves the rows intact when SM-LTP is already reserved by a retired store', () => withStoreDatabase(({ db, insert, read }) => {
    const store = { id: 'DOSII-LTP', name: 'SM LTP' }
    insert('stores', 'canonical-store-row', store)
    insert('deletedStores', 'retired-store-row', { id: 'OLD-ID', code: 'sm-ltp' })
    db.exec(migration)
    expect(read('canonical-store-row')).toEqual(store)
    expect(db.prepare('SELECT version FROM app_state').get().version).toBe(7)
  }))
})
