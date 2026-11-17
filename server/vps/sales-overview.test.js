// @vitest-environment node
import { Buffer } from 'node:buffer'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { expect, it, vi } from 'vitest'
import { createIdosiServer } from './server.mjs'

it.each([false, true])('summarizes all stores with scoped reads, Vietnam dates and admin-only access on VPS and SQL fallback (background=%s)', async (backgroundSnapshotReads) => {
  const directory = await mkdtemp(resolve(tmpdir(), 'idosi-sales-overview-'))
  const { server, runtime } = createIdosiServer({
    databasePath: resolve(directory, 'state.sqlite'), imagesDirectory: resolve(directory, 'images'),
    bootstrapToken: 'sales-fixture', automaticRevenueBonusEnabled: false, backgroundSnapshotReads,
  })
  await new Promise((done) => server.listen(0, '127.0.0.1', done))
  const base = `http://127.0.0.1:${server.address().port}`
  const post = async (path, body, headers = {}) => {
    const response = await fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) })
    expect(response.ok).toBe(true)
    return response.json()
  }
  const order = (id, storeId, createdAt, quantity, extra = {}) => ({ id, storeId, createdAt, amount: 1000, items: [{ productId: 'P1', productName: 'Áo nữ', quantity }], ...extra })
  try {
    await post('/api/bootstrap', { username: 'sales.admin', password: 'synthetic-sales-password', initialState: {
      stores: [{ id: 'S1', name: 'Store 1' }, { id: 'S2', name: 'Store 2', status: 'Ngừng hoạt động' }],
      orderInformationOptions: [{ id: 'P1', kind: 'product', code: 'FIXTURE', label: 'Áo nữ', active: true }],
      orders: [
        order('O1', 'S1', '2026-08-31T18:00:00Z', 5), order('O2', 'S2', '2026-09-02', 10),
        order('O3', 'S1', '2026-09-30T18:00:00Z', 100), order('O4', 'S1', '2026-09-01', 200, { deletedAt: '2026-09-02' }),
        order('O5', 'S1', '2026-09-01', 300, { source: 'legacy-opening-balance' }),
        order('O6', 'MISSING-STORE', '2026-09-01', 999),
      ],
    } }, { 'x-idosi-bootstrap-token': 'sales-fixture' })
    const login = await post('/api/login', { username: 'sales.admin', password: 'synthetic-sales-password' })
    const headers = { authorization: `Bearer ${login.token}` }
    runtime.database.readStateSnapshot = () => { throw new Error('Unexpected full-state read') }
    const salesRead = vi.spyOn(runtime.database, 'readSalesOverviewRows')
    const orderRead = vi.spyOn(runtime.database, 'readOrderSummaryRows')
    const statements = vi.spyOn(runtime.database.database, 'prepare')
    const read = (query = 'period=2026-09', auth = headers) => fetch(`${base}/api/sales-overview?${query}`, { headers: auth })
    const [response, concurrent] = await Promise.all([read(), read()])
    const payload = await response.json()
    expect(response.status, JSON.stringify(payload)).toBe(200)
    expect(payload).toMatchObject({ period: '2026-09', orders: 2, quantity: 15, weight: { totalKg: 3 }, mostSold: { quantity: 15 } })
    expect(payload.state).toBeUndefined()
    expect(await concurrent.json()).toMatchObject({ orders: 2, quantity: 15 })
    expect(orderRead).toHaveBeenCalledTimes(1)
    expect(orderRead).toHaveBeenCalledWith({ scope: 'global', storeIds: ['s1', 's2'], period: '2026-09' })
    if (!backgroundSnapshotReads) {
      const [sql] = statements.mock.calls.find(([sql]) => sql.includes('selected_store CROSS JOIN'))
      const plan = runtime.database.database.prepare(`EXPLAIN QUERY PLAN ${sql}`)
        .all('["s1","s2"]', 'global', '', '', '2026-08', '2026-09', '2026-10', '2026-08', '2026-09', '2026-10')
        .map((row) => row.detail).join('\n')
      expect(plan).toMatch(/SEARCH entity USING INDEX .*store_id=\?/u)
    }
    const cached = await (await read()).json()
    expect(cached).toMatchObject({ orders: 2, quantity: 15 })
    expect(cached.requestId).not.toBe(payload.requestId)
    expect(salesRead).toHaveBeenCalledTimes(1)
    const db = runtime.database.database
    // Unrelated writes must not recompute sales; every order change must.
    db.prepare("UPDATE app_state SET version=version+1 WHERE scope_key='global'").run()
    expect(await (await read()).json()).toMatchObject({ orders: 2, quantity: 15 })
    expect(salesRead).toHaveBeenCalledTimes(1)
    const update = (collection, id, value) => {
      const serialized = JSON.stringify(value)
      db.prepare('UPDATE state_entities SET value_json=?, value_bytes=? WHERE collection_key=? AND record_id=?')
        .run(serialized, Buffer.byteLength(serialized), collection, id)
    }
    update('orders', 'O2', order('O2', 'S2', '2026-09-02', 12))
    expect(await (await read()).json()).toMatchObject({ orders: 2, quantity: 17 })
    expect(salesRead).toHaveBeenCalledTimes(2)
    // The catalog is also a dependency even when order revision is unchanged.
    update('orderInformationOptions', 'P1', { id: 'P1', kind: 'product', code: 'FIXTURE', label: 'Fixture renamed product', active: true })
    expect(await (await read()).json()).toMatchObject({ mostSold: { productName: 'Fixture renamed product', quantity: 17 } })
    expect(salesRead).toHaveBeenCalledTimes(3)
    update('orders', 'O2', order('O2', 'S2', '2026-09-02', 12, { deletedAt: '2026-09-03' }))
    expect(await (await read()).json()).toMatchObject({ orders: 1, quantity: 5 })
    update('orders', 'O2', order('O2', 'S2', '2026-09-02', 10))
    expect(await (await read()).json()).toMatchObject({ orders: 2, quantity: 15 })
    const storeJson = JSON.stringify({ id: 'MISSING-STORE', name: 'Newly configured store' })
    db.prepare(`INSERT INTO state_entities (scope_key, collection_key, entity_key, entity_order,
      value_json, value_bytes, created_at, updated_at, record_id)
      VALUES ('global', 'stores', 'ADDED-STORE', 99, ?, ?, '2026-09-01', '2026-09-01', 'MISSING-STORE')`)
      .run(storeJson, Buffer.byteLength(storeJson))
    expect(await (await read()).json()).toMatchObject({ orders: 3, quantity: 1014 })
    db.prepare("DELETE FROM state_entities WHERE collection_key='stores' AND entity_key='ADDED-STORE'").run()
    expect(await (await read()).json()).toMatchObject({ orders: 2, quantity: 15 })
    // A failed background read cannot poison future retries of this revision.
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    salesRead.mockRejectedValueOnce(new Error('Synthetic transient read failure'))
    expect((await read('period=2026-08')).status).toBe(500)
    expect(await (await read('period=2026-08')).json()).toMatchObject({ orders: 0, quantity: 0 })
    consoleError.mockRestore()
    runtime.database.readSalesOverviewRows = undefined
    runtime.database.readOrderSummaryRevision = undefined
    runtime.database.readOrderSummaryRows = undefined
    expect(await (await read()).json()).toMatchObject({ orders: 2, quantity: 15, weight: { totalKg: 3 } })
    expect(await (await read('period=2026-07')).json()).toMatchObject({ orders: 0, quantity: 0, mostSold: null })
    expect((await read('period=invalid')).status).toBe(400)
    expect((await read('period=2026-09', {})).status).toBe(401)
    // The same valid session no longer has global access after its role changes.
    runtime.database.database.prepare("UPDATE users SET role='store_manager', store_id='S1' WHERE username='sales.admin'").run()
    expect((await read()).status).toBe(403)
  } finally {
    vi.restoreAllMocks()
    await new Promise((done) => server.close(done))
    await rm(directory, { recursive: true, force: true })
  }
})
