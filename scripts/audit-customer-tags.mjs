import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { pathToFileURL } from 'node:url'

const digest = (value) => createHash('sha256').update(value).digest('hex')

// Runs against the deployed domain module. The independent reference below
// counts compact persisted order rows without calling customerDirectory.
export async function auditCustomerTags(databasePath, domain) {
  if (!databasePath) throw new Error('IDOSI_DB_PATH is required')
  const rules = domain || await import(pathToFileURL(resolve('src/domain/customerLookup.js')).href)
  const db = new DatabaseSync(databasePath, { readOnly: true })
  try {
    db.exec('PRAGMA query_only=ON; BEGIN')
    const snapshotVersion = db.prepare("SELECT version FROM app_state WHERE scope_key='global'").get()?.version
    if (!Number.isSafeInteger(snapshotVersion)) throw new Error('Global state version is missing or invalid')
    const rows = db.prepare(`SELECT entity_key AS entityKey,
      json_extract(value_json, '$.id') AS id, json_extract(value_json, '$.code') AS code,
      store_id AS storeId, json_extract(value_json, '$.customerName') AS customerName,
      json_extract(value_json, '$.customerPhone') AS customerPhone,
      json_extract(value_json, '$.createdAt') AS createdAt, json_extract(value_json, '$.date') AS date,
      json_extract(value_json, '$.businessDate') AS businessDate,
      json_extract(value_json, '$.deletedAt') AS deletedAt,
      json_extract(value_json, '$.status') AS status, json_extract(value_json, '$.source') AS source
      FROM state_entities WHERE scope_key='global' AND collection_key='orders'
      ORDER BY entity_key`).all()
    if (!rows.length) throw new Error('No order rows: cannot verify the existing customer population')
    const storeIds = new Set(db.prepare(`SELECT json_extract(value_json, '$.id') AS id
      FROM state_entities WHERE scope_key='global' AND collection_key='stores'`).all()
      .map((row) => String(row.id || '').toLowerCase()).filter(Boolean))
    const reference = new Map()
    const excluded = { deleted: 0, openingBalance: 0 }
    let eligibleOrders = 0
    for (const row of rows) {
      if (row.deletedAt || row.status === 'Đã xóa') { excluded.deleted += 1; continue }
      if (row.source === 'legacy-opening-balance') { excluded.openingBalance += 1; continue }
      eligibleOrders += 1
      const phone = String(row.customerPhone || '').replace(/[^0-9]/gu, '')
      const key = phone ? `phone:${phone}` : `order:${row.id || row.code || row.entityKey}`
      let customer = reference.get(key)
      if (!customer) {
        customer = { count: 0, phone, byStore: new Map() }
        reference.set(key, customer)
      }
      customer.count += 1
      const storeId = String(row.storeId || '').toLowerCase()
      if (storeId) storeIds.add(storeId)
      customer.byStore.set(storeId, (customer.byStore.get(storeId) || 0) + 1)
    }
    const actual = rules.customerDirectory(rows)
    const seen = new Set()
    const mismatchCounts = {}
    const mismatchSamples = []
    const fail = (kind, key) => {
      mismatchCounts[kind] = (mismatchCounts[kind] || 0) + 1
      // Evidence must not disclose names, phone numbers or full order payloads.
      if (mismatchSamples.length < 20) mismatchSamples.push({ kind, customerKeySha256: digest(String(key)) })
    }
    let newCustomers = 0, returningCustomers = 0, multiStoreCustomers = 0
    let multiStoreOneOrderPerStore = 0, withoutPhone = 0, scopedChecks = 0, statusChecks = 0
    for (const expected of reference.values()) {
      if (expected.count === 1) newCustomers += 1
      else returningCustomers += 1
      if (!expected.phone) withoutPhone += 1
      if (expected.byStore.size > 1) {
        multiStoreCustomers += 1
        if ([...expected.byStore.values()].every((count) => count === 1)) multiStoreOneOrderPerStore += 1
      }
    }
    for (const customer of actual) {
      const expected = reference.get(customer.key)
      if (!expected) { fail('unexpectedCustomer', customer.key); continue }
      if (seen.has(customer.key)) fail('duplicateCustomer', customer.key)
      seen.add(customer.key)
      const returning = expected.count >= 2
      const globalInfo = rules.customerPublicInfo(rules.customerHistoryForStore(customer))
      if (customer.orderCount !== expected.count || globalInfo.orderCount !== expected.count) fail('globalOrderCount', customer.key)
      if (globalInfo.isReturningCustomer !== returning || globalInfo.hasPurchaseHistory !== true) fail('globalTag', customer.key)
      // Include stores without a purchase: the scoped count may be 0/1 while
      // the returning flag must still reflect all stores combined.
      for (const storeId of storeIds) {
        const scoped = rules.customerPublicInfo(rules.customerHistoryForStore(customer, storeId))
        scopedChecks += 1
        if (scoped.orderCount !== (expected.byStore.get(storeId) || 0)) fail('scopedOrderCount', customer.key)
        if (scoped.isReturningCustomer !== returning || scoped.hasPurchaseHistory !== true) fail('scopedTag', customer.key)
      }
      if (expected.phone) {
        const status = rules.customerPurchaseStatus(actual, expected.phone)
        statusChecks += 1
        if (status.isReturningCustomer !== returning || status.hasPurchaseHistory !== true) fail('exactPhoneStatus', customer.key)
        if (expected.phone.length >= 2) {
          const [suggestion] = rules.customerSuggestions([customer], expected.phone)
          if (suggestion?.isReturningCustomer !== returning) fail('suggestionTag', customer.key)
        }
      }
    }
    for (const key of reference.keys()) if (!seen.has(key)) fail('missingCustomer', key)
    const mismatchCount = Object.values(mismatchCounts).reduce((sum, count) => sum + count, 0)
    const result = {
      ok: mismatchCount === 0, checkedAt: new Date().toISOString(),
      scope: 'all orders, all dates, all stores including archived stores',
      databaseReadOnly: true, queryOnly: db.prepare('PRAGMA query_only').get().query_only === 1,
      snapshotVersion, sourceOrderRows: rows.length, eligibleOrders, excluded,
      sourceCompactRowsSha256: digest(JSON.stringify(rows)),
      customers: reference.size, classifiedCustomers: actual.length, newCustomers, returningCustomers,
      withoutPhone, stores: storeIds.size, multiStoreCustomers, multiStoreOneOrderPerStore,
      globalChecks: actual.length, scopedChecks, exactPhoneStatusChecks: statusChecks,
      mismatchCount, mismatchCounts, mismatchSamples,
    }
    db.exec('COMMIT')
    return result
  } finally {
    db.close()
  }
}

if (!process.argv[1] || import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const expectedDomainSha = process.env.IDOSI_AUDIT_EXPECTED_DOMAIN_SHA
    const expectedWorkerSha = process.env.IDOSI_AUDIT_EXPECTED_WORKER_SHA
    let productionReleaseSha
    if (expectedDomainSha || expectedWorkerSha) {
      for (const [path, expected] of [['src/domain/customerLookup.js', expectedDomainSha], ['server/worker.js', expectedWorkerSha]]) {
        if (!/^[a-f0-9]{64}$/u.test(expected || '') || digest(readFileSync(resolve(path))) !== expected) {
          throw new Error(`Deployed source does not match audited source: ${path}`)
        }
      }
      const response = await fetch('http://127.0.0.1:3000/api/release', { signal: AbortSignal.timeout(15000) })
      if (!response.ok) throw new Error('Cannot verify production release')
      const release = await response.json()
      productionReleaseSha = release.data?.releaseSha || release.releaseSha || ''
      if (!/^[a-f0-9]{40}$/u.test(productionReleaseSha)) throw new Error('Invalid production release SHA')
    }
    const result = await auditCustomerTags(process.env.IDOSI_DB_PATH)
    console.log(JSON.stringify({ ...result, productionReleaseSha, deployedDomainSha256: expectedDomainSha,
      deployedWorkerSha256: expectedWorkerSha }, null, 2))
    if (!result.ok) process.exitCode = 1
  } catch (error) {
    console.error(JSON.stringify({ ok: false, error: error.message }))
    process.exitCode = 1
  }
}
