// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createIdosiServer } from './server.mjs'

const key = 'synthetic-monthly-products-warehouse'
const common = { storeId: 'S1', employeeId: 'E1', customerName: 'Synthetic monthly private customer', paymentMethod: 'Tiền mặt', shiftId: 'AM' }
const men = (quantity, revenueType = 'NORMAL') => ({ productId: 'MEN', productName: 'Đồ nam', quantity, revenueType, ...(revenueType === 'NORMAL' ? {} : { unitPrice: 1000 }) })
const dress = (quantity, revenueType = 'NORMAL') => ({ ...men(quantity, revenueType), productId: 'DRESS', productName: 'Đầm' })
const orders = [
  { ...common, id: 'N', createdAt: '2026-09-01T09:00:00+07:00', amount: 100000, items: [men(200), dress(250)] },
  { ...common, id: 'P', createdAt: '2026-09-20T18:00:00+07:00', shiftId: 'PM', amount: 250000, items: [men(100, 'SALE_PIECE'), dress(150, 'SALE_PIECE')] },
  { ...common, id: 'K', createdAt: '2026-09-30T18:00:00+07:00', amount: 5000, items: [dress(5, 'SALE_KG')] },
  { ...common, id: 'AUGUST', createdAt: '2026-08-31T16:59:59Z', amount: 50000, items: [men(50)] },
  { ...common, id: 'OCTOBER', createdAt: '2026-09-30T17:00:00Z', amount: 12000, items: [men(12)] },
  { ...common, id: 'OTHER-STORE', storeId: 'S2', createdAt: '2026-09-10', amount: 900000, items: [men(900)] },
  { ...common, id: 'REMOVED', deletedAt: '2026-09-16', createdAt: '2026-09-10', amount: 1000, items: [men(1)] },
]
let server, directory, origin, token
async function request(path, { body, authorization = token, headers = {} } = {}) {
  const response = await fetch(`${origin}${path}`, {
    method: body ? 'POST' : 'GET', headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(authorization ? { authorization: `Bearer ${authorization}` } : {}), ...headers },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  return { status: response.status, body: await response.json() }
}
const query = (extra = {}) => new URLSearchParams({ storeId: 'S1', period: '2026-09', ...extra })
beforeAll(async () => {
  directory = await mkdtemp(resolve(tmpdir(), 'idosi-monthly-products-'))
  ;({ server } = createIdosiServer({ databasePath: resolve(directory, 'state.sqlite'), imagesDirectory: resolve(directory, 'images'),
    bootstrapToken: 'synthetic-monthly-bootstrap', warehouseApiKey: key, warehouseApiStoreIds: 'S1', automaticRevenueBonusEnabled: false }))
  await new Promise((done) => server.listen(0, '127.0.0.1', done))
  origin = `http://127.0.0.1:${server.address().port}`
  const boot = await request('/api/bootstrap', { headers: { 'x-idosi-bootstrap-token': 'synthetic-monthly-bootstrap' }, body: {
    username: 'monthly.admin', password: 'Synthetic-monthly-password-2026', initialState: {
      stores: [{ id: 'S1', name: 'Monthly test store' }, { id: 'S2', name: 'Other test store' }],
      employees: [{ id: 'E1', storeId: 'S1', unit: 'store', name: 'Synthetic employee' }], orders,
    },
  } })
  expect(boot.status, JSON.stringify(boot.body)).toBe(201)
  const login = await request('/api/login', { body: { username: 'monthly.admin', password: 'Synthetic-monthly-password-2026' } })
  expect(login.status).toBe(200)
  token = login.body.token
}, 30000)
afterAll(async () => {
  if (server) await new Promise((done) => server.close(done))
  if (directory) await rm(directory, { recursive: true, force: true })
})

describe('SQLite monthly product report and warehouse API', () => {
  it('returns one monthly row per product with original pieces and separate estimated/actual weight', async () => {
    const result = await request(`/api/order-summary?${query()}`)
    expect(result.status, JSON.stringify(result.body)).toBe(200)
    const rows = result.body.products.weightByProduct
    expect(rows).toHaveLength(2)
    expect(rows.find((row) => row.productId === 'MEN')).toMatchObject({ totalQuantity: 300, weight: { estimatedKg: 100, actualKg: 0 } })
    expect(rows.find((row) => row.productId === 'DRESS')).toMatchObject({ totalQuantity: 400, weight: { estimatedKg: 133.333333, actualKg: 5 } })
    expect(result.body.totals).toMatchObject({ orders: 3, revenue: 355000, revenueByType: { NORMAL: 100000, SALE_PIECE: 250000, SALE_KG: 5000 } })
    for (const path of ['/api/integrations/warehouse/order-statistics', '/api/integrations/warehouse/v1/order-statistics']) {
      const warehouse = await request(`${path}?${query()}`, { authorization: key })
      expect(warehouse.status).toBe(200)
      expect(warehouse.body.products).toEqual(result.body.products)
      expect(warehouse.body.totals).toEqual(result.body.totals)
      expect(JSON.stringify(warehouse.body)).not.toContain('Synthetic monthly private customer')
    }
    expect((await request(`/api/order-summary?${query()}`)).body.products).toEqual(result.body.products)
  })
  it('switches month/day/shift without carrying over a prior scope or counting deleted/other-store orders', async () => {
    const previous = await request(`/api/order-summary?${query({ period: '2026-08' })}`)
    expect(previous.body.products.weightByProduct).toHaveLength(1)
    expect(previous.body.products.weightByProduct[0].totalQuantity).toBe(50)
    const october = await request(`/api/order-summary?${query({ period: '2026-10' })}`)
    expect(october.body.products.totalQuantity).toBe(12)
    const shift = await request(`/api/order-summary?${query({ date: '2026-09-20', shiftId: 'PM' })}`)
    expect(shift.body.products.totalQuantity).toBe(250)
    expect(shift.body.products.weightByProduct.find((row) => row.productId === 'DRESS').totalQuantity).toBe(150)
    const empty = await request(`/api/order-summary?${query({ period: '2026-07' })}`)
    expect(empty.body.products.weightByProduct).toEqual([])
  })
  it('still requires authentication and restricts the warehouse to its allowed store', async () => {
    expect((await request(`/api/order-summary?${query()}`, { authorization: '' })).status).toBe(401)
    expect((await request(`/api/integrations/warehouse/v1/order-statistics?${query({ storeId: 'S2' })}`, { authorization: key })).status).toBe(403)
  })
})
