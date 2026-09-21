// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'
import { createIdosiServer } from './server.mjs'

it('summarizes all stores with scoped reads, Vietnam dates and admin-only access on VPS and SQL fallback', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'idosi-sales-overview-'))
  const { server, runtime } = createIdosiServer({
    databasePath: resolve(directory, 'state.sqlite'), imagesDirectory: resolve(directory, 'images'),
    bootstrapToken: 'sales-fixture', automaticRevenueBonusEnabled: false,
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
      orders: [
        order('O1', 'S1', '2026-08-31T18:00:00Z', 5), order('O2', 'S2', '2026-09-02', 10),
        order('O3', 'S1', '2026-09-30T18:00:00Z', 100), order('O4', 'S1', '2026-09-01', 200, { deletedAt: '2026-09-02' }),
        order('O5', 'S1', '2026-09-01', 300, { source: 'legacy-opening-balance' }),
      ],
    } }, { 'x-idosi-bootstrap-token': 'sales-fixture' })
    const login = await post('/api/login', { username: 'sales.admin', password: 'synthetic-sales-password' })
    const headers = { authorization: `Bearer ${login.token}` }
    runtime.database.readStateSnapshot = () => { throw new Error('Unexpected full-state read') }
    const read = (query = 'period=2026-09', auth = headers) => fetch(`${base}/api/sales-overview?${query}`, { headers: auth })
    const response = await read()
    const payload = await response.json()
    expect(response.status, JSON.stringify(payload)).toBe(200)
    expect(payload).toMatchObject({ period: '2026-09', orders: 2, quantity: 15, weight: { totalKg: 3 }, mostSold: { quantity: 15 } })
    expect(payload.state).toBeUndefined()
    runtime.database.readOrderSummaryRows = undefined
    expect(await (await read()).json()).toMatchObject({ orders: 2, quantity: 15, weight: { totalKg: 3 } })
    expect(await (await read('period=2026-07')).json()).toMatchObject({ orders: 0, quantity: 0, mostSold: null })
    expect((await read('period=invalid')).status).toBe(400)
    expect((await read('period=2026-09', {})).status).toBe(401)
    // The same valid session no longer has global access after its role changes.
    runtime.database.database.prepare("UPDATE users SET role='store_manager', store_id='S1' WHERE username='sales.admin'").run()
    expect((await read()).status).toBe(403)
  } finally {
    await new Promise((done) => server.close(done))
    await rm(directory, { recursive: true, force: true })
  }
})
