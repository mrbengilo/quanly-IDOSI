// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DEFAULT_ORDER_INFORMATION_OPTIONS } from '../../src/domain/orderInformationSettings.js'
import { orderBusinessDate } from '../../src/domain/orderSummary.js'
import { itemWeight, WEIGHT_TABLE_VERSION } from '../../src/domain/orderWeight.js'
import { createIdosiServer } from './server.mjs'

const beddingId = 'WEIGHT-BEDDING'
const beddingName = 'Chăn, ga, bao gối, nệm gòn'
const key = 'synthetic-bedding-warehouse-key-only'
let directory, server, runtime, request, command, tokens, date
beforeAll(async () => {
  directory = await mkdtemp(resolve(tmpdir(), 'idosi-bedding-weight-'))
  ;({ server, runtime } = createIdosiServer({ databasePath: resolve(directory, 'state.sqlite'), imagesDirectory: resolve(directory, 'images'), bootstrapToken: 'bedding-fixture', warehouseApiKey: key, warehouseApiStoreIds: 'S1' }))
  await new Promise((done) => server.listen(0, '127.0.0.1', done))
  const origin = `http://127.0.0.1:${server.address().port}`
  request = async (path, { body, token, headers = {} } = {}) => {
    const response = await fetch(origin + path, { method: body ? 'POST' : 'GET', headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) })
    return { status: response.status, body: await response.json() }
  }
  date = orderBusinessDate({ createdAt: new Date().toISOString() })
  const boot = await request('/api/bootstrap', { headers: { 'x-idosi-bootstrap-token': 'bedding-fixture' }, body: { username: 'bedding.admin', password: 'Synthetic-bedding-password-2026', initialState: {
    stores: [{ id: 'S1', name: 'Synthetic bedding store' }, { id: 'S2', name: 'Other synthetic store' }],
    employees: ['E1', 'E2'].map((id) => ({ id, storeId: 'S1', unit: 'store', name: id })),
    attendance: ['E1', 'E2'].map((id) => ({ id: `A${id}`, employeeId: id, storeId: 'S1', date, workDate: date, shiftId: 'AM', shiftName: 'Ca sáng', checkIn: '08:00', checkInAt: `${date}T01:00:00Z` })),
    orderInformationOptions: [...DEFAULT_ORDER_INFORMATION_OPTIONS, { id: beddingId, kind: 'product', label: beddingName, code: 'SYNTH-BED', active: true }], orders: [],
  } } })
  expect(boot.status, JSON.stringify(boot.body)).toBe(201)
  const login = async (username) => request('/api/login', { body: { username, password: 'Synthetic-bedding-password-2026' } })
  tokens = { admin: (await login('bedding.admin')).body.token }
  const versions = new Map()
  command = (type, payload, role = 'admin', idempotencyKey = crypto.randomUUID()) => {
    if (!versions.has(idempotencyKey)) versions.set(idempotencyKey, runtime.database.database.prepare("SELECT version FROM app_state WHERE scope_key='global'").get().version)
    return request('/api/command', { token: tokens[role], headers: { 'idempotency-key': idempotencyKey }, body: { type, payload, expectedVersion: versions.get(idempotencyKey) } })
  }
  for (const id of ['E1', 'E2']) {
    expect((await command('user.create', { username: `bedding.${id}`, password: 'Synthetic-bedding-password-2026', displayName: id, role: 'employee', storeId: 'S1', employeeId: id })).status).toBe(201)
    tokens[id] = (await login(`bedding.${id}`)).body.token
  }
}, 30000)
afterAll(async () => {
  if (server) await new Promise((done) => server.close(done))
  if (directory) await rm(directory, { recursive: true, force: true })
})
const query = (filter = {}) => new URLSearchParams({ storeId: 'S1', period: date.slice(0, 7), ...filter }).toString()
const read = (filter = {}, role = 'admin') => request(`/api/order-summary?${query(filter)}`, { token: tokens[role] })
const create = (data, role = 'E1', idempotencyKey) => command('order.create', { storeId: 'S1', customerName: 'Private synthetic bedding customer', gender: 'Nam', occupation: 'Kỹ sư', acquisitionChannel: 'Facebook', paymentMethod: 'Tiền mặt', ...data }, role, idempotencyKey)

describe('exact bedding conversion persisted to SQLite', () => {
  it('reconciles 1 normal piece + 2 sale pieces + 5 actual kg to 14kg, then verifies edits, replay and permissions', async () => {
    const forged = { version: WEIGHT_TABLE_VERSION, status: 'MAPPED', ruleId: 'bedding', piecesPerKg: 0.3, kgPerPiece: 99 }
    const requests = [
      { amount: 100000, items: [{ productId: beddingId, quantity: 1, productName: 'Đầm', weightConversion: forged }] },
      { amount: 20000, items: [{ productId: beddingId, quantity: 2, revenueType: 'SALE_PIECE', unitPrice: 10000, weightConversion: forged }] },
      { amount: 100000, items: [{ productId: beddingId, quantity: 5, revenueType: 'SALE_KG', unitPrice: 20000, weightConversion: forged }] },
    ]
    const saved = []
    for (const [index, payload] of requests.entries()) {
      const result = await create(payload, 'E1', `bedding-create-${index}`)
      expect(result.status, JSON.stringify(result.body)).toBe(201)
      const stored = JSON.parse(runtime.database.database.prepare("SELECT value_json FROM state_entities WHERE collection_key='orders' AND record_id=?").get(result.body.order.id).value_json)
      expect(stored.items).toEqual(result.body.order.items)
      expect(stored.amount).toBe(payload.amount)
      expect(stored.items[0].quantity).toBe(payload.items[0].quantity)
      expect(stored.items[0].productName).toBe(beddingName)
      expect(itemWeight(stored.items[0]).kilograms).toBe([3, 6, 5][index])
      if (index < 2) expect(stored.items[0].weightConversion).toEqual({ version: WEIGHT_TABLE_VERSION, status: 'MAPPED', ruleId: 'bedding', piecesPerKg: null, kgPerPiece: 3 })
      else expect(stored.items[0]).not.toHaveProperty('weightConversion')
      saved.push(stored)
    }
    expect((await create(requests[0], 'E1', 'bedding-create-0')).body.order.id).toBe(saved[0].id)
    for (const filter of [{}, { date }, { date, shiftId: 'AM' }]) {
      const summary = await read(filter)
      expect(summary.status).toBe(200)
      expect(summary.body.totals).toMatchObject({ orders: 3, revenue: 220000, revenueByType: { NORMAL: 100000, SALE_PIECE: 20000, SALE_KG: 100000 }, weight: { actualKg: 5, estimatedKg: 9, totalKg: 14, isComplete: true } })
      expect(summary.body.products).toMatchObject({ totalQuantity: 3, totalWeightKg: 5 })
      expect(summary.body.products.weightByProduct).toHaveLength(1)
      expect(summary.body.products.weightByProduct[0]).toMatchObject({ productId: beddingId, orders: 3, weight: { totalKg: 14 } })
      for (const group of ['shift', 'day', 'month']) expect(summary.body.groups[group][0].weight.totalKg).toBe(14)
      for (const endpoint of ['/api/integrations/warehouse/order-statistics', '/api/integrations/warehouse/v1/order-statistics']) {
        const warehouse = await request(`${endpoint}?${query(filter)}`, { token: key })
        expect(warehouse.status, JSON.stringify(warehouse.body)).toBe(200)
        expect(warehouse.body.totals).toEqual(summary.body.totals)
        expect(warehouse.body.products).toEqual(summary.body.products)
        expect(JSON.stringify(warehouse.body)).not.toContain('Private synthetic bedding customer')
      }
    }
    const update = await command('order.update', { orderId: saved[0].id, amount: 100000, items: [{ productId: beddingId, quantity: 2, weightConversion: forged }], reason: 'Synthetic bedding quantity correction' })
    expect(update.status, JSON.stringify(update.body)).toBe(200)
    expect((await read()).body.totals).toMatchObject({ revenue: 220000, weight: { actualKg: 5, estimatedKg: 12, totalKg: 17 } })
    expect((await create({ amount: 50000, items: [{ productId: beddingId, quantity: 1 }] }, 'E2')).status).toBe(201)
    expect((await read({}, 'E1')).body.totals.weight.totalKg).toBe(17)
    expect((await read()).body.totals.weight.totalKg).toBe(20)
    expect((await read({ employeeId: 'E2' }, 'E1')).status).toBe(403)
    expect((await read({ storeId: 'S2' }, 'E1')).status).toBe(403)
    expect((await request(`/api/integrations/warehouse/v1/order-statistics?${query({ storeId: 'S2' })}`, { token: key })).status).toBe(403)
    expect((await command('order.delete', { orderId: saved[0].id, reason: 'Synthetic deletion regression' })).status).toBe(200)
    expect((await read({}, 'E1')).body.totals).toMatchObject({ orders: 2, revenue: 120000, weight: { totalKg: 11 } })
  }, 30000)
})
