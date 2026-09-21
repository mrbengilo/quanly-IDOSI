// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { beforeEach, afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_ORDER_INFORMATION_OPTIONS } from '../../src/domain/orderInformationSettings.js'
import { orderBusinessDate } from '../../src/domain/orderSummary.js'
import { WEIGHT_TABLE_VERSION } from '../../src/domain/orderWeight.js'
import { createIdosiServer } from './server.mjs'

const warehouseKey = 'synthetic-warehouse-weight-test-only'
const dressId = 'order-product-002'
const normal = { productId: dressId, quantity: 3 }
const pieces = { productId: dressId, revenueType: 'SALE_PIECE', quantity: 6, unitPrice: 10000 }
const kilograms = { productId: dressId, revenueType: 'SALE_KG', quantity: 5, unitPrice: 20000 }
let directory, server, runtime, request, command, tokens, date

beforeEach(async () => {
  directory = await mkdtemp(resolve(tmpdir(), 'idosi-order-weight-'))
  ;({ server, runtime } = createIdosiServer({ databasePath: resolve(directory, 'state.sqlite'), imagesDirectory: resolve(directory, 'images'),
    bootstrapToken: 'weight-fixture', warehouseApiKey: warehouseKey, warehouseApiStoreIds: 'S1' }))
  await new Promise((done) => server.listen(0, '127.0.0.1', done))
  const origin = `http://127.0.0.1:${server.address().port}`
  request = async (path, { body, token, headers = {} } = {}) => {
    const response = await fetch(`${origin}${path}`, { method: body ? 'POST' : 'GET',
      headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
    return { status: response.status, body: await response.json() }
  }
  date = orderBusinessDate({ createdAt: new Date().toISOString() })
  const boot = await request('/api/bootstrap', { headers: { 'x-idosi-bootstrap-token': 'weight-fixture' }, body: {
    username: 'weight.admin', password: 'synthetic-weight-password', initialState: {
      stores: [{ id: 'S1', name: 'Weight fixture one' }, { id: 'S2', name: 'Weight fixture two' }],
      employees: ['E1', 'E2'].map((id) => ({ id, storeId: 'S1', unit: 'store', name: id })),
      attendance: ['E1', 'E2'].map((id) => ({ id: `A${id}`, employeeId: id, storeId: 'S1', date, workDate: date,
        shiftId: 'AM', shiftName: 'Ca sáng', checkIn: '08:00', checkInAt: `${date}T01:00:00Z` })),
      orderInformationOptions: [...DEFAULT_ORDER_INFORMATION_OPTIONS, { id: 'UNMAPPED', kind: 'product', code: 'CUSTOM-NEW', label: 'Mặt hàng chưa có hệ số', active: true }], orders: [],
    },
  } })
  expect(boot.status, JSON.stringify(boot.body)).toBe(201)
  const login = (username) => request('/api/login', { body: { username, password: 'synthetic-weight-password' } })
  tokens = { admin: (await login('weight.admin')).body.token }
  const versions = new Map()
  command = (type, payload, role = 'admin', key = crypto.randomUUID()) => {
    if (!versions.has(key)) versions.set(key, runtime.database.database.prepare("SELECT version FROM app_state WHERE scope_key='global'").get().version)
    return request('/api/command', { token: tokens[role], headers: { 'idempotency-key': key }, body: { type, payload, expectedVersion: versions.get(key) } })
  }
  for (const employeeId of ['E1', 'E2']) {
    const user = await command('user.create', { username: `weight.${employeeId}`, password: 'synthetic-weight-password', displayName: employeeId,
      role: 'employee', storeId: 'S1', employeeId })
    expect(user.status, JSON.stringify(user.body)).toBe(201)
    tokens[employeeId] = (await login(`weight.${employeeId}`)).body.token
  }
}, 30000)
afterEach(async () => {
  if (server) await new Promise((done) => server.close(done))
  if (directory) await rm(directory, { recursive: true, force: true })
})
const create = (data, role = 'E1', key) => command('order.create', { storeId: 'S1', customerName: 'Synthetic weight customer', gender: 'Nam', occupation: 'Kỹ sư', acquisitionChannel: 'Facebook', paymentMethod: 'Tiền mặt', ...data }, role, key)
const query = (extra = {}) => new URLSearchParams({ storeId: 'S1', period: date.slice(0, 7), ...extra }).toString()
const read = (extra = {}, role = 'admin') => request(`/api/order-summary?${query(extra)}`, { token: tokens[role] })
const createExamples = async () => {
  const saved = []
  for (const data of [{ amount: 100000, items: [normal] }, { amount: 60000, items: [pieces] }, { amount: 100000, items: [kilograms] }]) {
    const response = await create(data)
    expect(response.status, JSON.stringify(response.body)).toBe(201)
    saved.push(response.body.order)
  }
  return saved
}

describe('persisted piece/kg conversion and authenticated reports', () => {
  it('recalculates saved historical snapshots across store and warehouse reports without rewriting orders', async () => {
    const saved = await createExamples()
    const db = runtime.database.database
    const before = []
    for (const [index, order] of saved.entries()) {
      const stored = JSON.parse(db.prepare("SELECT value_json FROM state_entities WHERE collection_key='orders' AND record_id=?").get(order.id).value_json)
      stored.items[0].productName = index === 0 ? 'Chăn, ga, bao gối, nệm gòn' : 'Quần áo nam'
      if (index === 0) stored.items[0].weightConversion = {
        version: 'IDOSI-2026-09-15-v1', status: 'MAPPED', ruleId: 'bedding', piecesPerKg: 0.3,
      }
      if (index === 1) stored.items[0].weightConversion = {
        version: 'IDOSI-2026-09-15-v2', status: 'UNMAPPED', ruleId: null, piecesPerKg: null,
      }
      const json = JSON.stringify(stored)
      db.prepare("UPDATE state_entities SET value_json=?, value_bytes=? WHERE collection_key='orders' AND record_id=?")
        .run(json, new TextEncoder().encode(json).length, order.id)
      before.push(json)
    }
    // 3 bedding pieces=9 kg; 6 men's pieces=2 kg; actual 5 kg stays 5 kg.
    for (const filter of [{}, { date }, { date, shiftId: 'AM' }]) {
      const result = await read(filter)
      expect(result.status).toBe(200)
      expect(result.body.totals).toMatchObject({ revenue: 260000, cash: 260000, transfer: 0,
        weight: { tableVersion: WEIGHT_TABLE_VERSION, estimatedKg: 11, actualKg: 5, totalKg: 16 } })
      for (const group of ['shift', 'day', 'month']) expect(result.body.groups[group][0].weight.totalKg).toBe(16)
      for (const endpoint of ['/api/integrations/warehouse/order-statistics', '/api/integrations/warehouse/v1/order-statistics']) {
        const warehouse = await request(`${endpoint}?${query(filter)}`, { token: warehouseKey })
        expect(warehouse.status).toBe(200)
        expect(warehouse.body.totals).toEqual(result.body.totals)
        expect(warehouse.body.products).toEqual(result.body.products)
      }
    }
    expect(saved.map(order => db.prepare("SELECT value_json FROM state_entities WHERE collection_key='orders' AND record_id=?").get(order.id).value_json)).toEqual(before)
  })

  it('persists 3 dresses=1 kg, 6 sale dresses=2 kg and 5 actual kg; UI/API scopes agree at 8 kg', async () => {
    const saved = await createExamples()
    for (const order of saved) {
      const stored = JSON.parse(runtime.database.database.prepare("SELECT value_json FROM state_entities WHERE collection_key='orders' AND record_id=?").get(order.id).value_json)
      expect(stored.items).toEqual(order.items)
      expect(stored.amount).toBe(order.amount)
    }
    for (const order of saved.slice(0, 2)) expect(order.items[0].weightConversion).toEqual({ version: WEIGHT_TABLE_VERSION, status: 'MAPPED', ruleId: 'dress', piecesPerKg: 3 })
    expect(saved[2].items[0]).not.toHaveProperty('weightConversion')
    for (const filter of [{}, { date }, { date, shiftId: 'AM' }]) {
      const result = await read(filter)
      expect(result.status, JSON.stringify(result.body)).toBe(200)
      expect(result.body.totals).toMatchObject({ orders: 3, revenue: 260000, revenueByType: { NORMAL: 100000, SALE_PIECE: 60000, SALE_KG: 100000 }, weight: { actualKg: 5, estimatedKg: 3, totalKg: 8, isComplete: true } })
      expect(result.body.products).toMatchObject({ totalQuantity: 9, totalWeightKg: 5 })
      expect(result.body.products.weightByProduct).toHaveLength(1)
      expect(result.body.products.weightByProduct[0]).toMatchObject({ productId: dressId, orders: 3, weight: { totalKg: 8 } })
      for (const group of ['shift', 'day', 'month']) expect(result.body.groups[group][0].weight.totalKg).toBe(8)
      for (const endpoint of ['/api/integrations/warehouse/order-statistics', '/api/integrations/warehouse/v1/order-statistics']) {
        const warehouse = await request(`${endpoint}?${query(filter)}`, { token: warehouseKey })
        expect(warehouse.status, JSON.stringify(warehouse.body)).toBe(200)
        expect(warehouse.body.totals).toEqual(result.body.totals)
        expect(warehouse.body.products).toEqual(result.body.products)
        expect(JSON.stringify(warehouse.body)).not.toContain('Synthetic weight customer')
      }
    }
    expect((await read()).body.totals.weight.totalKg).toBe(8)
  })
  it('ignores forged conversion metadata and preserves factors, quantities and money after edit/replay/delete', async () => {
    const data = { amount: 100000, items: [{ ...normal, productName: 'Đồ đông', weightConversion: { version: WEIGHT_TABLE_VERSION, status: 'MAPPED', ruleId: 'winter', piecesPerKg: 1 }, kilograms: 999 }] }
    const first = await create(data, 'E1', 'weight-idempotent-command')
    const again = await create(data, 'E1', 'weight-idempotent-command')
    expect(first.status, JSON.stringify(first.body)).toBe(201)
    expect(again.body.order.id).toBe(first.body.order.id)
    expect(first.body.order.items[0].weightConversion.piecesPerKg).toBe(3)
    expect((await read()).body.totals).toMatchObject({ orders: 1, revenue: 100000, weight: { totalKg: 1 } })
    const updated = await command('order.update', { orderId: first.body.order.id, amount: 100000, items: [{ ...normal, quantity: 6, weightConversion: { piecesPerKg: 1 } }], reason: 'Synthetic quantity correction' })
    expect(updated.status, JSON.stringify(updated.body)).toBe(200)
    expect((await read()).body.totals).toMatchObject({ revenue: 100000, weight: { totalKg: 2 } })
    expect((await command('order.delete', { orderId: first.body.order.id, reason: 'Synthetic test cleanup' })).status).toBe(200)
    expect((await read()).body.totals).toMatchObject({ orders: 0, revenue: 0, weight: { totalKg: 0 } })
  })
  it('never exposes coworker or other-store kg and never uses a missing coefficient as zero', async () => {
    await createExamples()
    expect((await create({ amount: 40000, items: [{ ...normal, quantity: 9 }] }, 'E2')).status).toBe(201)
    expect((await read({}, 'E1')).body.totals.weight.totalKg).toBe(8)
    expect((await read()).body.totals.weight.totalKg).toBe(11)
    expect((await read({ employeeId: 'E2' }, 'E1')).status).toBe(403)
    expect((await request(`/api/order-summary?${query({ storeId: 'S2' })}`, { token: tokens.E1 })).status).toBe(403)
    expect((await request(`/api/integrations/warehouse/v1/order-statistics?${query({ storeId: 'S2' })}`, { token: warehouseKey })).status).toBe(403)
    const missing = await create({ amount: 9000, items: [{ productId: 'UNMAPPED', quantity: 2 }] })
    expect(missing.status, JSON.stringify(missing.body)).toBe(201)
    expect((await read({}, 'E1')).body.totals.weight).toMatchObject({ knownKg: 8, totalKg: null, isComplete: false, missingFactorLines: 1 })
    expect((await read({}, 'E1')).body.totals.revenue).toBe(269000)
  })
})
