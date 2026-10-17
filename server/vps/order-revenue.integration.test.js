// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { beforeEach, afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_ORDER_INFORMATION_OPTIONS } from '../../src/domain/orderInformationSettings.js'
import { orderBusinessDate } from '../../src/domain/orderSummary.js'
import { createIdosiServer } from './server.mjs'

const secret = 'synthetic-warehouse-key-for-revenue-tests-only'
const normal = { productId: 'order-product-001', quantity: 2 }
const kg = { productId: 'order-product-001', revenueType: 'SALE_KG', quantity: 2.5, unitPrice: 20000 }
const piece = { productId: 'order-product-001', revenueType: 'SALE_PIECE', quantity: 3, unitPrice: 10000 }
const mixed = { amount: 180000, normalAmount: 100000, items: [normal, kg, piece] }
let directory, server, runtime, base, tokens, command, read, request

beforeEach(async () => {
  directory = await mkdtemp(resolve(tmpdir(), 'idosi-order-revenue-'))
  ;({ server, runtime } = createIdosiServer({
    databasePath: resolve(directory, 'state.sqlite'), imagesDirectory: resolve(directory, 'images'),
    bootstrapToken: 'revenue-fixture', warehouseApiKey: secret, warehouseApiStoreIds: 'S1,S2',
  }))
  await new Promise((done) => server.listen(0, '127.0.0.1', done))
  base = `http://127.0.0.1:${server.address().port}`
  request = async (path, { body, token, headers = {} } = {}) => {
    const response = await fetch(`${base}${path}`, {
      method: body ? 'POST' : 'GET',
      headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
    return { status: response.status, body: await response.json() }
  }
  const date = orderBusinessDate({ createdAt: new Date().toISOString() })
  const boot = await request('/api/bootstrap', { headers: { 'x-idosi-bootstrap-token': 'revenue-fixture' }, body: {
    username: 'revenue.admin', password: 'synthetic-revenue-password', initialState: {
      stores: [{ id: 'S1', name: 'Fixture One' }, { id: 'S2', name: 'Fixture Two' }, { id: 'S3', name: 'Blocked Store' }],
      employees: ['E1', 'E2'].map((id) => ({ id, storeId: 'S1', unit: 'store', name: id })),
      attendance: ['E1', 'E2'].map((id) => ({ id: `A${id}`, employeeId: id, storeId: 'S1', date, workDate: date,
        shiftId: 'AM', shiftName: 'Ca sáng', checkIn: '08:00', checkInAt: `${date}T01:00:00Z` })),
      orderInformationOptions: DEFAULT_ORDER_INFORMATION_OPTIONS, orders: [],
    },
  } })
  expect(boot.status, JSON.stringify(boot.body)).toBe(201)
  const login = (username) => request('/api/login', { body: { username, password: 'synthetic-revenue-password' } })
  tokens = { admin: (await login('revenue.admin')).body.token }
  const versions = new Map()
  command = (type, payload, role = 'admin', key = crypto.randomUUID()) => {
    if (!versions.has(key)) versions.set(key, runtime.database.database.prepare("SELECT version FROM app_state WHERE scope_key='global'").get().version)
    return request('/api/command', { token: tokens[role], headers: { 'idempotency-key': key }, body: { type, payload, expectedVersion: versions.get(key) } })
  }
  for (const id of ['E1', 'E2']) {
    const created = await command('user.create', { username: `revenue.${id}`, password: 'synthetic-revenue-password', displayName: id,
      role: 'employee', storeId: 'S1', employeeId: id })
    expect(created.status, JSON.stringify(created.body)).toBe(201)
    tokens[id] = (await login(`revenue.${id}`)).body.token
  }
  read = (suffix = '', role = 'admin') => request(`/api/order-summary?storeId=S1&period=${date.slice(0, 7)}${suffix}`, { token: tokens[role] })
}, 30000)
afterEach(async () => {
  if (server) await new Promise((done) => server.close(done))
  if (directory) await rm(directory, { recursive: true, force: true })
})
const create = (data, role = 'E1', key) => command('order.create', {
  storeId: 'S1', customerName: 'Synthetic customer', gender: 'Nam', occupation: 'Kỹ sư', acquisitionChannel: 'Facebook',
  paymentMethod: 'Tiền mặt', ...data,
}, role, key)

describe('real SQLite order commands and warehouse statistics', () => {
  it('returns distinct sale and unclassified measures for each requested store', async () => {
    const first = await create(mixed)
    expect(first.status, JSON.stringify(first.body)).toBe(201)
    const second = await create({ storeId: 'S2', amount: 40_000, normalAmount: 10_000, items: [{ ...normal, revenueType: 'NORMAL' }, piece] }, 'admin')
    expect(second.status, JSON.stringify(second.body)).toBe(201)
    const period = orderBusinessDate(first.body.order).slice(0, 7)
    const warehouse = (storeId) => request(`/api/integrations/warehouse/v1/order-statistics?storeId=${storeId}&period=${period}`, { token: secret })
    const s1 = await warehouse('S1')
    const s2 = await warehouse('S2')
    expect(s1.status).toBe(200)
    expect(s2.status).toBe(200)
    expect(s1.body).toMatchObject({ storeId: 'S1', store: { id: 'S1' }, totals: { revenue: 180_000, unclassifiedRevenue: 100_000, unclassifiedOrders: 1, revenueByType: { SALE_KG: 50_000, SALE_PIECE: 30_000 } }, products: { salePieceQuantity: 3, totalWeightKg: 2.5 } })
    expect(s2.body).toMatchObject({ storeId: 'S2', store: { id: 'S2' }, totals: { revenue: 40_000, unclassifiedRevenue: 0, unclassifiedOrders: 0, revenueByType: { NORMAL: 10_000, SALE_KG: 0, SALE_PIECE: 30_000 } }, products: { salePieceQuantity: 3, totalWeightKg: 0 } })
    expect(s1.body.totals.weight.byRevenueType.SALE_KG.actualKg).toBe(2.5)
    expect(s1.body.totals.weight.byRevenueType.SALE_PIECE.estimatedKg).toBe(1)
    expect(s2.body.totals.weight.byRevenueType.SALE_KG.actualKg).toBe(0)
    expect(s2.body.totals.weight.byRevenueType.SALE_PIECE.estimatedKg).toBe(1)
    expect((await warehouse('S3')).status).toBe(403)
  })
  it('persists mixed revenue, replays without duplication and agrees across all report scopes', async () => {
    const first = await create(mixed, 'E1', 'same-revenue-command')
    expect(first.status, JSON.stringify(first.body)).toBe(201)
    const again = await create(mixed, 'E1', 'same-revenue-command')
    expect(again.body.order.id).toBe(first.body.order.id)
    expect(first.body.order.items[1]).toMatchObject({ unit: 'KG', quantity: 2.5, lineAmount: 50000 })
    const persisted = JSON.parse(runtime.database.database.prepare("SELECT value_json FROM state_entities WHERE collection_key='orders' AND record_id=?").get(first.body.order.id).value_json)
    expect(persisted.items).toEqual(first.body.order.items)
    expect(persisted.amount).toBe(180000)
    const report = await read()
    expect(report.status, JSON.stringify(report.body)).toBe(200)
    expect(report.body.totals).toMatchObject({ orders: 1, revenue: 180000, cash: 180000, revenueByType: { NORMAL: 100000, SALE_KG: 50000, SALE_PIECE: 30000 } })
    expect(report.body.products).toMatchObject({ totalQuantity: 5, totalWeightKg: 2.5 })
    const period = orderBusinessDate(first.body.order).slice(0, 7)
    for (const endpoint of ['/api/integrations/warehouse/order-statistics', '/api/integrations/warehouse/v1/order-statistics']) {
      const warehouse = await request(`${endpoint}?storeId=S1&period=${period}`, { token: secret })
      expect(warehouse.status, JSON.stringify(warehouse.body)).toBe(200)
      expect(warehouse.body.totals).toEqual(report.body.totals)
      for (const key of ['shift', 'day', 'month']) expect(warehouse.body.groups[key][0].revenueByType).toEqual(report.body.totals.revenueByType)
      expect(JSON.stringify(warehouse.body)).not.toContain('Synthetic customer')
      expect(warehouse.body).not.toHaveProperty('orders')
    }
  })
  it('never exposes another employee, admin-created assignments or another store to employees', async () => {
    expect((await create(mixed)).status).toBe(201)
    expect((await create({ amount: 50000, normalAmount: 0, items: [kg] }, 'E2')).status).toBe(201)
    expect((await create({ amount: 90000, items: [normal], employeeId: 'E1' }, 'admin')).status).toBe(201)
    const own = await read('', 'E1')
    expect(own.body.totals).toMatchObject({ orders: 1, revenue: 180000 })
    const all = await read()
    expect(all.body.totals).toMatchObject({ orders: 3, revenue: 320000 })
    expect((await read('&employeeId=E2', 'E1')).status).toBe(403)
    expect((await request('/api/order-summary?storeId=S2&period=2026-09', { token: tokens.E1 })).status).toBe(403)
    const history = await request(`/api/history/orders?storeId=S1&period=${orderBusinessDate({ createdAt: new Date().toISOString() }).slice(0, 7)}`, { token: tokens.E1 })
    expect(history.status, JSON.stringify(history.body)).toBe(200)
    expect(history.body.records).toHaveLength(1)
    expect((await create({ ...mixed, storeId: 'S2' })).status).toBe(403)
  })
  it('rejects forged data before writes and requires a valid scoped warehouse credential', async () => {
    for (const data of [
      { ...mixed, amount: 179999 }, { amount: 50001, items: [kg] },
      { amount: 50000, items: [{ ...kg, unit: 'PIECE' }] },
      { amount: 50000, items: [{ ...kg, quantity: 0.0001 }] },
      { amount: 30000, items: [{ ...piece, quantity: 1.5 }] },
      { amount: 50000, items: [{ ...kg, lineAmount: 1 }] },
      { amount: 50000, items: [{ ...kg, revenueType: 'SALE' }] },
    ]) {
      const rejected = await create(data)
      expect(rejected.status, JSON.stringify(rejected.body)).toBe(400)
      expect(rejected.body.error.code).toMatch(/^ORDER_/u)
    }
    expect((await read()).body.totals.orders).toBe(0)
    const path = '/api/integrations/warehouse/v1/order-statistics?storeId=S1&period=2026-09'
    expect((await request(path)).status).toBe(401)
    expect((await request(path, { token: tokens.E1 })).status).toBe(401)
    expect((await request(path.replace('S1', 'S3'), { token: secret })).status).toBe(403)
    expect((await request(`${path}&employeeId=E1`, { token: secret })).status).toBe(400)
  })
  it('recomputes all categories after audited admin edits and soft deletion, preserving normal legacy orders', async () => {
    const saved = await create(mixed)
    const orderId = saved.body.order.id
    const updated = await command('order.update', { orderId, amount: 190000, normalAmount: 100000, items: [normal, { ...kg, quantity: 3 }, piece], reason: 'Synthetic correction' })
    expect(updated.status, JSON.stringify(updated.body)).toBe(200)
    expect((await read()).body.totals).toMatchObject({ revenue: 190000, revenueByType: { NORMAL: 100000, SALE_KG: 60000, SALE_PIECE: 30000 } })
    expect((await read()).body.totals.unclassifiedRevenue).toBe(100000)
    const classified = await command('order.update', { orderId, items: [{ ...normal, revenueType: 'NORMAL' }, { ...kg, quantity: 3 }, piece], reason: 'Confirmed ordinary sale from source record' })
    expect(classified.status, JSON.stringify(classified.body)).toBe(200)
    expect((await read()).body.totals).toMatchObject({ unclassifiedRevenue: 0, unclassifiedOrders: 0, revenue: 190000 })
    expect((await command('order.update', { orderId, amount: 1, reason: 'Forbidden edit' }, 'E2')).status).toBe(403)
    expect((await command('order.delete', { orderId, reason: 'Synthetic removal' })).status).toBe(200)
    expect((await read()).body.totals.revenue).toBe(0)
    expect((await create({ amount: 123000 }, 'admin')).status).toBe(201)
    expect((await read()).body.totals.revenueByType).toEqual({ NORMAL: 123000, SALE_KG: 0, SALE_PIECE: 0 })
  })
})
