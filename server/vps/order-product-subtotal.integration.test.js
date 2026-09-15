// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createIdosiServer } from './server.mjs'

const warehouseKey = 'synthetic-weight-subtotal-warehouse'
const base = { storeId: 'S1', employeeId: 'E1', createdAt: '2026-09-15T09:00:00+07:00', shiftId: 'AM', paymentMethod: 'Tiền mặt', customerName: 'Synthetic subtotal customer' }
const quantities = [
  ['Áo nữ', 21], ['Chân váy', 5], ['Đầm', 4], ['Đồ bộ', 1], ['Đồ nam', 17], ['Đồ nội y mới', 6],
  ['Đồ thể thao', 10], ['Giày dép túi xách', 15], ['Hàng thương hiệu', 35], ['Khăn lông', 1],
  ['Nam SM', 12], ['Nữ SM', 214], ['Quần dài nữ', 4], ['Quần short', 1], ['Sản phẩm tiện ích', 14], ['Trẻ em SM', 32],
]
const orders = [
  { ...base, id: 'KNOWN', amount: 100000, items: quantities.map(([productName, quantity], index) => ({ productId: `P${index}`, productName, quantity })) },
  { ...base, id: 'LEGACY', amount: 1000 },
  { ...base, id: 'ACTUAL', shiftId: 'PM', amount: 5000, items: [{ productId: 'P2', productName: 'Đầm', quantity: 5, revenueType: 'SALE_KG', unitPrice: 1000 }] },
  { ...base, id: 'UNMAPPED', createdAt: '2026-09-16T09:00:00+07:00', amount: 1000, items: [{ productId: 'NEW', productName: 'Mặt hàng mới chưa có hệ số', quantity: 4 }] },
  { ...base, id: 'OTHER-STORE', storeId: 'S2', amount: 9000, items: [{ productId: 'P2', productName: 'Đầm', quantity: 9 }] },
  { ...base, id: 'OTHER-MONTH', createdAt: '2026-10-01T09:00:00+07:00', amount: 9000, items: [{ productId: 'P2', productName: 'Đầm', quantity: 9 }] },
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
  directory = await mkdtemp(resolve(tmpdir(), 'idosi-weight-subtotal-'))
  ;({ server } = createIdosiServer({ databasePath: resolve(directory, 'state.sqlite'), imagesDirectory: resolve(directory, 'images'),
    bootstrapToken: 'synthetic-subtotal-bootstrap', warehouseApiKey: warehouseKey, warehouseApiStoreIds: 'S1', automaticRevenueBonusEnabled: false }))
  await new Promise((done) => server.listen(0, '127.0.0.1', done))
  origin = `http://127.0.0.1:${server.address().port}`
  const boot = await request('/api/bootstrap', { headers: { 'x-idosi-bootstrap-token': 'synthetic-subtotal-bootstrap' }, body: {
    username: 'subtotal.admin', password: 'Synthetic-subtotal-password-2026', initialState: {
      stores: [{ id: 'S1', name: 'Subtotal test store' }, { id: 'S2', name: 'Other test store' }],
      employees: [{ id: 'E1', storeId: 'S1', unit: 'store', name: 'Synthetic employee' }], orders,
    },
  } })
  expect(boot.status, JSON.stringify(boot.body)).toBe(201)
  const login = await request('/api/login', { body: { username: 'subtotal.admin', password: 'Synthetic-subtotal-password-2026' } })
  expect(login.status).toBe(200)
  token = login.body.token
}, 30000)
afterAll(async () => {
  if (server) await new Promise((done) => server.close(done))
  if (directory) await rm(directory, { recursive: true, force: true })
})

describe('known weight subtotals retain API completeness and scope', () => {
  it('returns the existing 392-piece estimate even when totalKg is incomplete, without changing warehouse semantics', async () => {
    const params = query({ date: '2026-09-15' })
    const result = await request(`/api/order-summary?${params}`)
    expect(result.status, JSON.stringify(result.body)).toBe(200)
    expect(result.body.products).toMatchObject({ totalQuantity: 392, totalWeightKg: 5, weight: {
      estimatedKg: 112.083333, actualKg: 5, knownKg: 117.083333, isComplete: false, totalKg: null, unclassifiedOrders: 1,
    } })
    expect(result.body.products.weightByProduct).toHaveLength(16)
    expect(result.body.products.weightByProduct.every((row) => row.weight.isComplete)).toBe(true)
    expect(result.body.totals.revenue).toBe(106000)
    for (const endpoint of ['/api/integrations/warehouse/order-statistics', '/api/integrations/warehouse/v1/order-statistics']) {
      const api = await request(`${endpoint}?${params}`, { authorization: warehouseKey })
      expect(api.status).toBe(200)
      expect(api.body.products).toEqual(result.body.products)
      expect(api.body.totals).toEqual(result.body.totals)
      expect(JSON.stringify(api.body)).not.toContain('Synthetic subtotal customer')
    }
    expect((await request(`/api/order-summary?${params}`)).body.products).toEqual(result.body.products)
  })
  it('keeps known estimates when the month also has missing factors, while respecting day and shift boundaries', async () => {
    const month = await request(`/api/order-summary?${query()}`)
    expect(month.body.products).toMatchObject({ totalQuantity: 396, weight: { estimatedKg: 112.083333, missingFactorLines: 1, unclassifiedOrders: 1, totalKg: null } })
    const morning = await request(`/api/order-summary?${query({ date: '2026-09-15', shiftId: 'AM' })}`)
    expect(morning.body.products.weight).toMatchObject({ estimatedKg: 112.083333, actualKg: 0, totalKg: null })
    const afternoon = await request(`/api/order-summary?${query({ date: '2026-09-15', shiftId: 'PM' })}`)
    expect(afternoon.body.products.weight).toMatchObject({ estimatedKg: 0, actualKg: 5, totalKg: 5, isComplete: true })
    const missingOnly = await request(`/api/order-summary?${query({ date: '2026-09-16' })}`)
    expect(missingOnly.body.products.weight).toMatchObject({ estimatedKg: 0, totalKg: null, isComplete: false, missingFactorLines: 1 })
  })
  it('preserves denied requests and does not expose another store to the warehouse key', async () => {
    expect((await request(`/api/order-summary?${query()}`, { authorization: '' })).status).toBe(401)
    expect((await request(`/api/integrations/warehouse/v1/order-statistics?${query({ storeId: 'S2' })}`, { authorization: warehouseKey })).status).toBe(403)
  })
})
