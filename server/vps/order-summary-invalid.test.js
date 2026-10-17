// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { expect, it, vi } from 'vitest'
import { createIdosiServer } from './server.mjs'

it('names the malformed order instead of failing the report with a generic error', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'idosi-order-invalid-'))
  const { server } = createIdosiServer({
    databasePath: resolve(directory, 'state.sqlite'),
    imagesDirectory: resolve(directory, 'images'),
    bootstrapToken: 'order-invalid-bootstrap',
    automaticRevenueBonusEnabled: false,
  })
  await new Promise((done) => server.listen(0, '127.0.0.1', done))
  const base = `http://127.0.0.1:${server.address().port}`
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
  try {
    const bootstrap = await fetch(`${base}/api/bootstrap`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-idosi-bootstrap-token': 'order-invalid-bootstrap' },
      body: JSON.stringify({
        username: 'invalid.admin', password: 'invalid-admin-password', displayName: 'Invalid Admin',
        initialState: {
          stores: [{ id: 'S1', name: 'Store S1', short: 'S1' }],
          orders: [
            { id: 'O-GOOD', code: 'S1-00001', storeId: 'S1', amount: 100_000, createdAt: '2026-09-10T03:00:00.000Z' },
            {
              id: 'O-BAD', code: 'S1-00002', storeId: 'S1', amount: 100_000, createdAt: '2026-09-11T03:00:00.000Z',
              items: [{ revenueType: 'SALE_KG', quantity: '1', unitPrice: 50_000 }],
            },
          ],
        },
      }),
    })
    expect(bootstrap.status).toBe(201)
    const login = await (await fetch(`${base}/api/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'invalid.admin', password: 'invalid-admin-password' }),
    })).json()
    const response = await fetch(`${base}/api/order-summary?storeId=S1&period=2026-09`, {
      headers: { authorization: `Bearer ${login.token}` },
    })
    const payload = await response.json()
    expect(response.status).toBe(422)
    expect(payload.error).toMatchObject({
      code: 'ORDER_DATA_INVALID',
      details: { orderId: 'O-BAD', orderCode: 'S1-00002', storeId: 'S1', reason: 'ORDER_REVENUE_MISMATCH' },
    })
    expect(payload.error.message).toContain('S1-00002')
  } finally {
    consoleError.mockRestore()
    await new Promise((done) => server.close(done))
    await rm(directory, { recursive: true, force: true })
  }
}, 60_000)
