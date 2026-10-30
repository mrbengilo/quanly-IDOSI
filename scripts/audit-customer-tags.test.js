// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { env, execPath } from 'node:process'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, expect, it } from 'vitest'
import * as domain from '../src/domain/customerLookup.js'
import { auditCustomerTags } from './audit-customer-tags.mjs'

const directories = []
async function fixture() {
  const directory = await mkdtemp(resolve(tmpdir(), 'idosi-customer-tag-audit-'))
  directories.push(directory)
  const path = resolve(directory, 'fixture.sqlite')
  const db = new DatabaseSync(path)
  db.exec(`CREATE TABLE app_state (scope_key TEXT PRIMARY KEY, version INTEGER);
    INSERT INTO app_state VALUES ('global', 42);
    CREATE TABLE state_entities (scope_key TEXT, collection_key TEXT, entity_key TEXT, store_id TEXT, value_json TEXT)`)
  const insert = db.prepare('INSERT INTO state_entities VALUES (?, ?, ?, ?, ?)')
  for (const id of ['S1', 'S2', 'ARCHIVED']) insert.run('global', 'stores', id, '', JSON.stringify({ id }))
  const orders = [
    { id: 'FIRST', storeId: 'S1', customerPhone: '0901111111' },
    { id: 'CROSS1', storeId: 'S1', customerPhone: '090 222 2222' },
    { id: 'CROSS2', storeId: 's2', customerPhone: '0902222222' },
    { id: 'REPEAT1', storeId: 'ARCHIVED', customerPhone: '0903333333' },
    { id: 'REPEAT2', storeId: 'ARCHIVED', customerPhone: '0903333333' },
    { id: 'ANON1', storeId: 'S1', customerName: 'Khách lẻ' },
    { id: 'ANON2', storeId: 'S2', customerName: 'Khách lẻ' },
    { id: 'DELETED', storeId: 'S1', customerPhone: '0901111111', deletedAt: '2026-10-30' },
    { id: 'STATUS-DELETED', storeId: 'S1', customerPhone: '0901111111', status: 'Đã xóa' },
    { id: 'OPENING', storeId: 'S1', customerPhone: '0901111111', source: 'legacy-opening-balance' },
  ]
  for (const order of orders) insert.run('global', 'orders', order.id, order.storeId, JSON.stringify(order))
  db.close()
  return path
}
afterEach(async () => {
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true })
})

it('audits the entire snapshot across stores without changing persisted rows or version', async () => {
  const path = await fixture()
  const result = await auditCustomerTags(path)
  expect(result).toMatchObject({ ok: true, databaseReadOnly: true, queryOnly: true, snapshotVersion: 42,
    sourceOrderRows: 10, eligibleOrders: 7, excluded: { deleted: 2, openingBalance: 1 },
    customers: 5, newCustomers: 3, returningCustomers: 2, withoutPhone: 2, stores: 3,
    multiStoreCustomers: 1, multiStoreOneOrderPerStore: 1,
    globalChecks: 5, scopedChecks: 15, exactPhoneStatusChecks: 3, mismatchCount: 0 })
  const db = new DatabaseSync(path, { readOnly: true })
  expect(db.prepare('SELECT version FROM app_state').get().version).toBe(42)
  expect(db.prepare('SELECT COUNT(*) AS count FROM state_entities').get().count).toBe(13)
  db.close()
  expect(JSON.stringify(result)).not.toMatch(/0901111111|0902222222|Khách lẻ/u)
})

it('fails the audit for the old first-purchase classification and reports only hashed identities', async () => {
  const result = await auditCustomerTags(await fixture(), { ...domain,
    customerPublicInfo: (customer) => ({ ...domain.customerPublicInfo(customer), isReturningCustomer: customer.hasPurchaseHistory }),
  })
  expect(result.ok).toBe(false)
  expect(result.mismatchCounts).toMatchObject({ globalTag: 3, scopedTag: 9 })
  expect(result.mismatchSamples.every((sample) => /^[a-f0-9]{64}$/u.test(sample.customerKeySha256))).toBe(true)
})

it('detects loss of cross-store customers and incorrect exact-phone/suggestion tags', async () => {
  const result = await auditCustomerTags(await fixture(), { ...domain,
    customerDirectory: (orders) => domain.customerDirectory(orders, { storeId: 'S1' }),
    customerPurchaseStatus: () => ({ hasPurchaseHistory: true, isReturningCustomer: true }),
    customerSuggestions: () => [{ isReturningCustomer: true }],
  })
  expect(result.ok).toBe(false)
  expect(result.mismatchCounts.missingCustomer).toBe(2)
  expect(result.mismatchCounts.globalOrderCount).toBe(1)
  expect(result.mismatchCounts.exactPhoneStatus).toBe(1)
  expect(result.mismatchCounts.suggestionTag).toBe(1)
})

it('detects returning tags incorrectly computed from each store instead of the global count', async () => {
  const result = await auditCustomerTags(await fixture(), { ...domain,
    customerHistoryForStore: (customer, storeId) => {
      const scoped = domain.customerHistoryForStore(customer, storeId)
      return { ...scoped, isReturningCustomer: scoped.orderCount >= 2 }
    },
  })
  expect(result.ok).toBe(false)
  expect(result.mismatchCounts).toEqual({ scopedTag: 5 })
})

it('does not report a successful empty-population audit', async () => {
  const path = await fixture()
  const db = new DatabaseSync(path)
  db.exec("DELETE FROM state_entities WHERE collection_key='orders'")
  db.close()
  await expect(auditCustomerTags(path)).rejects.toThrow('No order rows')
})

it('runs through Node stdin exactly as the production SSH workflow invokes it', async () => {
  const path = await fixture()
  const output = execFileSync(execPath, ['--input-type=module'], {
    input: readFileSync(new URL('./audit-customer-tags.mjs', import.meta.url), 'utf8'),
    env: { ...env, IDOSI_DB_PATH: path, IDOSI_AUDIT_EXPECTED_DOMAIN_SHA: '', IDOSI_AUDIT_EXPECTED_WORKER_SHA: '' },
  })
  expect(JSON.parse(output)).toMatchObject({ ok: true, queryOnly: true, customers: 5, mismatchCount: 0 })
})

it('requires an explicit database path and verifies SQLite rejects writes through a read-only handle', async () => {
  const path = await fixture()
  // Verify the audit connection's SQLite read-only boundary independently.
  const db = new DatabaseSync(path, { readOnly: true })
  expect(() => db.exec('DELETE FROM state_entities')).toThrow(/readonly/iu)
  db.close()
  await expect(auditCustomerTags('')).rejects.toThrow('IDOSI_DB_PATH is required')
})
