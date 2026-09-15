// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createIdosiServer } from './server.mjs'

const day = '2026-09-06'
const key = 'synthetic-shift-history-warehouse-only'
const baseOrder = { storeId: 'S1', employeeId: 'E1', createdAt: `${day}T18:00:00+07:00`, paymentMethod: 'Tiền mặt', customerName: 'Synthetic private name' }
const orders = [
  { ...baseOrder, id: 'PM-SNAPSHOT', shiftName: 'Ca tối', shiftStart: '17:00', shiftEnd: '22:00', amount: 180000, normalAmount: 100000, items: [
    { productId: 'P1', productName: 'Đồ nam', quantity: 2 },
    { productId: 'P1', productName: 'Đồ nam', revenueType: 'SALE_KG', quantity: 2.5, unitPrice: 20000 },
    { productId: 'P1', productName: 'Đồ nam', revenueType: 'SALE_PIECE', quantity: 3, unitPrice: 10000 },
  ] },
  { ...baseOrder, id: 'OLD-ID', shiftId: 'retired-am', shiftName: 'Ca sáng', shiftStart: '08:00', shiftEnd: '12:00', amount: 40000 },
  { ...baseOrder, id: 'PM-OTHER-WINDOW', shiftName: 'Ca tối', shiftStart: '18:00', shiftEnd: '23:00', amount: 70000 },
  { ...baseOrder, id: 'UNKNOWN', amount: 20000 },
  { ...baseOrder, id: 'NEXT-DAY', shiftName: 'Ca tối', shiftStart: '17:00', shiftEnd: '22:00', createdAt: '2026-09-07T18:00:00+07:00', amount: 99000 },
  { ...baseOrder, id: 'OTHER-STORE', storeId: 'S2', shiftName: 'Ca tối', shiftStart: '17:00', shiftEnd: '22:00', amount: 777000 },
]
let server, directory, origin, token
const request = async (path, { body, authorization = token, headers = {} } = {}) => {
  const response = await fetch(`${origin}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(authorization ? { authorization: `Bearer ${authorization}` } : {}), ...headers },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  return { status: response.status, body: await response.json() }
}
const query = (extra = {}) => new URLSearchParams({ storeId: 'S1', period: '2026-09', date: day, ...extra }).toString()

beforeAll(async () => {
  directory = await mkdtemp(resolve(tmpdir(), 'idosi-shift-history-'))
  ;({ server } = createIdosiServer({ databasePath: resolve(directory, 'state.sqlite'), imagesDirectory: resolve(directory, 'images'),
    bootstrapToken: 'synthetic-shift-bootstrap', warehouseApiKey: key, warehouseApiStoreIds: 'S1' }))
  await new Promise((done) => server.listen(0, '127.0.0.1', done))
  origin = `http://127.0.0.1:${server.address().port}`
  const boot = await request('/api/bootstrap', { headers: { 'x-idosi-bootstrap-token': 'synthetic-shift-bootstrap' }, body: {
    username: 'shift.admin', password: 'Synthetic-shift-password-2026', initialState: {
      stores: [{ id: 'S1', name: 'Synthetic store one' }, { id: 'S2', name: 'Synthetic store two' }],
      employees: [{ id: 'E1', storeId: 'S1', unit: 'store', name: 'Synthetic employee' }],
      shiftDefinitions: [{ id: 'new-pm', name: 'Ca tối', start: '17:00', end: '22:00', active: true }], orders,
    },
  } })
  expect(boot.status, JSON.stringify(boot.body)).toBe(201)
  const login = await request('/api/login', { body: { username: 'shift.admin', password: 'Synthetic-shift-password-2026' } })
  expect(login.status).toBe(200)
  token = login.body.token
}, 30000)
afterAll(async () => {
  if (server) await new Promise((done) => server.close(done))
  if (directory) await rm(directory, { recursive: true, force: true })
})

describe('SQLite historical shift statistics', () => {
  it('returns the selected snapshot only with all three revenue categories and products', async () => {
    const report = await request(`/api/order-summary?${query({ shiftId: 'ca tối:17:00:22:00' })}`)
    expect(report.status, JSON.stringify(report.body)).toBe(200)
    expect(report.body.totals).toMatchObject({ orders: 1, revenue: 180000, revenueByType: { NORMAL: 100000, SALE_KG: 50000, SALE_PIECE: 30000 } })
    expect(report.body.products).toMatchObject({ totalQuantity: 5, totalWeightKg: 2.5 })
    expect(report.body.groups.shift).toHaveLength(1)
    expect(report.body.groups.shift[0].shiftKey).toBe('ca tối:17:00:22:00')
  })
  it('round-trips every recorded group through both warehouse endpoints without counting another day/store', async () => {
    const daily = await request(`/api/order-summary?${query()}`)
    expect(daily.status).toBe(200)
    expect(daily.body.totals.revenue).toBe(310000)
    let total = 0
    for (const group of daily.body.groups.shift) {
      const params = query({ shiftId: group.shiftKey })
      const report = await request(`/api/order-summary?${params}`)
      expect(report.status, JSON.stringify(report.body)).toBe(200)
      expect(report.body.totals.revenue).toBe(group.revenue)
      total += report.body.totals.revenue
      for (const endpoint of ['/api/integrations/warehouse/order-statistics', '/api/integrations/warehouse/v1/order-statistics']) {
        const warehouse = await request(`${endpoint}?${params}`, { authorization: key })
        expect(warehouse.status, JSON.stringify(warehouse.body)).toBe(200)
        expect(warehouse.body.totals).toEqual(report.body.totals)
        expect(warehouse.body.products).toEqual(report.body.products)
        expect(JSON.stringify(warehouse.body)).not.toContain('Synthetic private name')
      }
    }
    expect(total).toBe(daily.body.totals.revenue)
  })
  it('keeps missing/retired IDs separate and continues to reject unauthenticated or forbidden reads', async () => {
    const old = await request(`/api/order-summary?${query({ shiftId: 'retired-am' })}`)
    expect(old.body.totals.revenue).toBe(40000)
    const unbound = await request(`/api/order-summary?${query({ shiftId: 'chưa gắn ca::' })}`)
    expect(unbound.body.totals).toMatchObject({ orders: 1, revenue: 20000 })
    const nonexistent = await request(`/api/order-summary?${query({ shiftId: 'new-pm' })}`)
    expect(nonexistent.body.totals.orders).toBe(0)
    expect((await request(`/api/order-summary?${query()}`, { authorization: '' })).status).toBe(401)
    expect((await request(`/api/integrations/warehouse/v1/order-statistics?${query({ storeId: 'S2' })}`, { authorization: key })).status).toBe(403)
  })
})
