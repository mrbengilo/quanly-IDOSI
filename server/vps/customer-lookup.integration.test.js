// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises'
import { Buffer } from 'node:buffer'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { createIdosiServer } from './server.mjs'
import { DEFAULT_ORDER_INFORMATION_OPTIONS } from '../../src/domain/orderInformationSettings.js'

let server, runtime, directory, origin, token, manager, employee, support
const password = 'Synthetic-customer-password-2026'
const order = (id, overrides = {}) => ({ id, code: id, storeId: 'S1', employeeId: 'E1',
  customerName: 'Nguyễn Ánh', customerPhone: '090 123 4567', createdAt: '2024-01-01T08:00:00+07:00',
  amount: 120000, paymentMethod: 'Tiền mặt', items: [{ productId: 'P1', productName: 'Áo', quantity: 2 }], ...overrides })
async function request(path, authorization = token, body, headers = {}) {
  const response = await fetch(`${origin}${path}`, { method: body ? 'POST' : 'GET',
    headers: { ...(authorization ? { authorization: `Bearer ${authorization}` } : {}),
      ...(body ? { 'content-type': 'application/json' } : {}), ...headers },
    ...(body ? { body: JSON.stringify(body) } : {}) })
  return { status: response.status, body: await response.json() }
}
const lookup = (options = {}, authorization = token) => request(`/api/customer-lookup?${new URLSearchParams({ storeId: 'S1', ...options })}`, authorization)
beforeAll(async () => {
  directory = await mkdtemp(resolve(tmpdir(), 'idosi-customer-lookup-'))
  ;({ server, runtime } = createIdosiServer({ databasePath: resolve(directory, 'state.sqlite'),
    imagesDirectory: resolve(directory, 'images'), bootstrapToken: 'customer-fixture', automaticRevenueBonusEnabled: false }))
  await new Promise((done) => server.listen(0, '127.0.0.1', done))
  origin = `http://127.0.0.1:${server.address().port}`
  expect((await request('/api/bootstrap', '', { username: 'customer.admin', password, initialState: {
    stores: [{ id: 'S1', name: 'Store 1' }, { id: 'S2', name: 'Store 2' }, { id: 'S3', name: 'Closed store', status: 'Ngừng hoạt động' }],
    employees: [{ id: 'E1', name: 'Employee', storeId: 'S1', unit: 'store', salary: 9999999 },
      { id: 'M1', name: 'Manager', storeId: 'S1', unit: 'store_manager' },
      { id: 'H1', name: 'Support', unit: 'business_support', storeId: 'BUSINESS_SUPPORT' }],
    deletedEmployees: [{ id: 'E-OLD', code: 'OLD-STAFF', name: 'Former employee', salary: 8888888 }],
    orderInformationOptions: DEFAULT_ORDER_INFORMATION_OPTIONS,
    orders: [order('OLD', { attendanceId: 'PRIVATE-ATTENDANCE', internalAudit: { secret: 'PRIVATE-AUDIT' }, editedBy: 'PRIVATE-ADMIN' }),
      order('NEW', { customerName: 'Ánh Nguyễn', customerPhone: '0901234567', createdAt: '2026-10-30T09:00:00+07:00' }),
      order('OTHER', { storeId: 'S2', customerName: 'Trần Khách Liên Cửa Hàng', customerPhone: '0999999999' }),
      order('CROSS-STORE', { storeId: 'S2', employeeId: 'OLD-STAFF', createdAt: '2025-01-01T01:00:00Z' }),
      order('CLOSED-STORE', { storeId: 'S3', employeeId: 'MISSING', employeeName: 'Seller snapshot' }),
      order('DELETED', { deletedAt: '2026-10-30', customerPhone: '0111111111' }),
      order('BALANCE', { source: 'legacy-opening-balance', customerPhone: '0222222222' }),
      order('NO-PHONE-1', { customerPhone: '' }), order('NO-PHONE-2', { customerPhone: '' }),
      ...Array.from({ length: 23 }, (_, index) => order(`PAGE-${index}`, { customerPhone: '0888888888' }))],
  } }, { 'x-idosi-bootstrap-token': 'customer-fixture' })).status).toBe(201)
  token = (await request('/api/login', '', { username: 'customer.admin', password })).body.token
  for (const [role, id] of [['store_manager', 'M1'], ['employee', 'E1'], ['business_support', 'H1']]) {
    const username = `customer.${role}`
    const created = await request('/api/command', token, { type: 'user.create', payload: {
      username, password, role, displayName: role, storeId: role === 'business_support' ? null : 'S1', employeeId: id,
    } }, { 'idempotency-key': `customer-user-${role}` })
    expect(created.status, JSON.stringify(created.body)).toBe(201)
    const login = await request('/api/login', '', { username, password })
    expect(login.status).toBe(200)
    if (role === 'store_manager') manager = login.body.token
    else if (role === 'employee') employee = login.body.token
    else support = login.body.token
  }
}, 30000)
afterAll(async () => {
  if (server) await new Promise((done) => server.close(done))
  if (directory) await rm(directory, { recursive: true, force: true })
})

it('uses global purchase thresholds for tags across list, history, suggestions and exact status without writes', async () => {
  const before = runtime.database.database.prepare("SELECT version FROM app_state WHERE scope_key='global'").get().version
  for (const [phone, returning] of [['0999999999', false], ['0901234567', true]]) {
    for (const scope of ['store', 'global']) {
      const options = { scope, query: phone }
      const list = await lookup(options)
      expect(list.status).toBe(200)
      if (scope === 'store' && phone === '0999999999') {
        expect(list.body.customers).toEqual([])
        expect((await lookup({ scope, mode: 'history', customerKey: `phone:${phone}` })).status).toBe(404)
        continue
      }
      expect(list.body.customers[0]).toMatchObject({ isReturningCustomer: returning, hasPurchaseHistory: true })
      const history = await lookup({ scope, mode: 'history', customerKey: `phone:${phone}` })
      expect(history.body.customer).toMatchObject({ isReturningCustomer: returning })
    }
    const suggestions = await lookup({ mode: 'suggest', query: phone }, employee)
    expect(suggestions.body.suggestions[0]).toMatchObject({ isReturningCustomer: returning })
    const status = await lookup({ mode: 'status', query: phone }, employee)
    expect(status.body).toMatchObject({ hasPurchaseHistory: true, isReturningCustomer: returning })
  }
  const missing = await lookup({ mode: 'status', query: '0777777777' }, employee)
  expect(missing.body).toMatchObject({ hasPurchaseHistory: false, isReturningCustomer: false })
  const noPhone = await lookup({ scope: 'global', query: 'nguyen anh' })
  expect(noPhone.body.customers.filter((customer) => !customer.customerPhone)).toEqual([
    expect.objectContaining({ orderCount: 1, isReturningCustomer: false }),
    expect.objectContaining({ orderCount: 1, isReturningCustomer: false }),
  ])
  expect(runtime.database.database.prepare("SELECT version FROM app_state WHERE scope_key='global'").get().version).toBe(before)
})

it('lists only store contacts across all periods and returns the selected customer purchases across stores', async () => {
  const result = await lookup({}, manager)
  expect(result.status, JSON.stringify(result.body)).toBe(200)
  expect(result.body.total).toBe(4)
  const customer = result.body.customers.find((row) => row.customerPhone === '0901234567')
  expect(customer).toMatchObject({ customerName: 'Ánh Nguyễn', orderCount: 4 })
  expect(customer.orders).toBeUndefined()
  expect((await lookup({ query: 'nguyen anh' })).body.customers).toHaveLength(4)
  expect((await lookup({ query: '090 123' }, support)).body.customers).toEqual([customer])
  expect((await lookup({ query: '0999' })).body.customers).toEqual([])
  const history = await lookup({ mode: 'history', customerKey: customer.key }, manager)
  expect(history.body.records.map((row) => row.id)).toEqual(['NEW', 'CROSS-STORE', 'OLD', 'CLOSED-STORE'])
  expect(history.body.records[0]).toMatchObject({ amount: 120000, items: [{ quantity: 2, productName: 'Áo' }] })
  expect((await lookup({ mode: 'history', customerKey: 'phone:0888888888', offset: 20 })).body.records).toHaveLength(3)
})

it('returns purchase stores with name/phone suggestions while denying directory and unrelated store scope to employees', async () => {
  const result = await lookup({ mode: 'suggest', query: '090' }, employee)
  expect(result.status).toBe(200)
  expect(result.body.suggestions).toEqual([{ key: 'phone:0901234567', customerName: 'Ánh Nguyễn',
    customerPhone: '0901234567', hasPurchaseHistory: true, isReturningCustomer: true,
    purchaseStores: [{ storeId: 'S1', storeName: 'Store 1' }, { storeId: 'S2', storeName: 'Store 2' },
      { storeId: 'S3', storeName: 'Closed store' }] }])
  const names = await lookup({ mode: 'suggest', field: 'name', query: 'nguyen anh' }, employee)
  expect(names.status).toBe(200)
  expect(names.body.suggestions).toHaveLength(4)
  expect(names.body.suggestions.every((row) => row.hasPurchaseHistory && !('orders' in row) && !('orderCount' in row))).toBe(true)
  expect((await lookup({ mode: 'status', field: 'name', query: 'Nguyen Anh' }, employee)).body.hasPurchaseHistory).toBe(true)
  expect((await lookup({ mode: 'status', query: '090 123 4567' }, employee)).body.hasPurchaseHistory).toBe(true)
  expect((await lookup({ mode: 'status', query: '090123' }, employee)).body).toMatchObject({ hasPurchaseHistory: false, hasSuggestions: true })
  expect((await lookup({ mode: 'status', query: '0999999999' }, employee)).body.hasPurchaseHistory).toBe(true)
  expect((await lookup({ mode: 'suggest', query: '099' }, employee)).body.suggestions).toEqual([
    { key: 'phone:0999999999', customerName: 'Trần Khách Liên Cửa Hàng', customerPhone: '0999999999', hasPurchaseHistory: true, isReturningCustomer: false,
      purchaseStores: [{ storeId: 'S2', storeName: 'Store 2' }] },
  ])
  expect((await lookup({ mode: 'suggest', field: 'name', query: 'tran khach' }, employee)).body.suggestions).toEqual([
    expect.objectContaining({ customerPhone: '0999999999', hasPurchaseHistory: true }),
  ])
  expect((await lookup({ mode: 'status', field: 'name', query: 'tran khach lien cua hang' }, employee)).body.hasPurchaseHistory).toBe(true)
  for (const query of ['0111111111', '0222222222', '0777777777']) {
    expect((await lookup({ mode: 'status', query }, employee)).body.hasPurchaseHistory).toBe(false)
    expect((await lookup({ mode: 'suggest', query }, employee)).body.suggestions).toEqual([])
  }
  expect((await lookup({ mode: 'status', field: 'name', query: 'Khách chưa mua' }, employee)).body.hasPurchaseHistory).toBe(false)
  expect((await lookup({ mode: 'suggest', field: 'email', query: '090' }, employee)).status).toBe(400)
  expect((await lookup({ mode: 'suggest', query: '0' }, employee)).body.suggestions).toEqual([])
  expect((await lookup({}, employee)).status).toBe(403)
  expect((await lookup({ mode: 'history', customerKey: 'phone:0901234567' }, employee)).status).toBe(403)
  for (const authorization of [manager, employee]) expect((await lookup({ mode: 'suggest', query: '09', storeId: 'S2' }, authorization)).status).toBe(403)
  expect((await lookup({ mode: 'status', query: '0999999999', storeId: 'S2' }, employee)).status).toBe(403)
  expect((await lookup({}, '')).status).toBe(401)
  expect((await lookup({ offset: '-1' })).status).toBe(400)
  const outside = await lookup({ mode: 'history', customerKey: 'phone:0999999999' }, manager)
  expect(outside.status).toBe(404)
  expect(outside.body.records).toBeUndefined()
  expect((await lookup({ mode: 'history', customerKey: 'phone:0777777777' })).status).toBe(404)
})

it('allows employees to inspect one searched customer across stores without exposing other contacts or internal metadata', async () => {
  const before = runtime.database.database.prepare("SELECT version FROM app_state WHERE scope_key='global'").get().version
  for (const [query, field, key, ids] of [
    ['090 123', 'phone', 'phone:0901234567', ['NEW', 'CROSS-STORE', 'OLD', 'CLOSED-STORE']],
    ['tran khach', 'name', 'phone:0999999999', ['OTHER']],
    ['nguyen anh', 'name', 'order:NO-PHONE-1', ['NO-PHONE-1']],
  ]) {
    const history = await lookup({ mode: 'history', query, field, customerKey: key }, employee)
    expect(history.status, JSON.stringify(history.body)).toBe(200)
    expect(history.body.records.map((record) => record.id)).toEqual(ids)
    expect(JSON.stringify(history.body)).not.toMatch(/salary|password|attendanceId|entityKey|editedBy|internalAudit|PRIVATE-/u)
    expect(history.body.records.every((record) => 'storeName' in record && 'employeeName' in record)).toBe(true)
  }
  const page = await lookup({ mode: 'history', query: '088', customerKey: 'phone:0888888888', offset: 20 }, employee)
  expect(page.body.records).toHaveLength(3)
  expect(page.body.total).toBe(23)
  expect((await lookup({ mode: 'history', query: '099', customerKey: 'phone:0901234567' }, employee)).status).toBe(404)
  expect((await lookup({ mode: 'history', query: '0', customerKey: 'phone:0901234567' }, employee)).status).toBe(403)
  expect((await lookup({ mode: 'history', query: '090', customerKey: 'phone:0901234567', storeId: 'S2' }, employee)).status).toBe(403)
  for (const query of ['0111111111', '0222222222']) {
    expect((await lookup({ mode: 'history', query, customerKey: `phone:${query}` }, employee)).status).toBe(404)
  }
  expect(runtime.database.database.prepare("SELECT version FROM app_state WHERE scope_key='global'").get().version).toBe(before)
})

it('loads the new store screen without hydrating order history or changing state', async () => {
  const before = runtime.database.database.prepare("SELECT version FROM app_state WHERE scope_key='global'").get().version
  const result = await request('/api/store-screens/customer-lookup?storeId=S1', manager)
  expect(result.status, JSON.stringify(result.body)).toBe(200)
  expect(result.body.state?.orders || []).toHaveLength(0)
  await lookup({}, manager)
  expect(runtime.database.database.prepare("SELECT version FROM app_state WHERE scope_key='global'").get().version).toBe(before)
})

it('fails closed if a selected order changes contact between the directory scan and detail read', async () => {
  const db = runtime.database.database
  const prepare = db.prepare.bind(db)
  const previous = prepare("SELECT value_json, value_bytes FROM state_entities WHERE collection_key='orders' AND record_id='OLD'").get()
  let changed = false
  db.prepare = (sql) => {
    if (!changed && sql.includes('SELECT entity_key, value_json, value_bytes') && sql.includes('entity_key IN')) {
      changed = true
      const value = JSON.stringify({ ...JSON.parse(previous.value_json), customerPhone: '0777777777' })
      prepare("UPDATE state_entities SET value_json=?, value_bytes=? WHERE collection_key='orders' AND record_id='OLD'")
        .run(value, Buffer.byteLength(value))
    }
    return prepare(sql)
  }
  try {
    const history = await lookup({ mode: 'history', query: '090', customerKey: 'phone:0901234567' }, employee)
    expect(changed).toBe(true)
    expect(history.status, JSON.stringify(history.body)).toBe(409)
    expect(history.body.error.code).toBe('CUSTOMER_HISTORY_CHANGED')
    expect(history.body.records).toBeUndefined()
  } finally {
    db.prepare = prepare
    prepare("UPDATE state_entities SET value_json=?, value_bytes=? WHERE collection_key='orders' AND record_id='OLD'")
      .run(previous.value_json, previous.value_bytes)
  }
})

it.each(['admin', 'business_support', 'store_manager'])('provides cross-store all-period directory and detailed history to %s', async (role) => {
  const authorization = role === 'admin' ? token : role === 'store_manager' ? manager : support
  const before = runtime.database.database.prepare("SELECT version FROM app_state WHERE scope_key='global'").get().version
  const result = await lookup({ scope: 'global', storeId: '', query: '090 123' }, authorization)
  expect(result.status, JSON.stringify(result.body)).toBe(200)
  expect(result.body.customers).toEqual([expect.objectContaining({ key: 'phone:0901234567', orderCount: 4 })])
  expect(result.body.customers[0].orders).toBeUndefined()
  const names = await lookup({ scope: 'global', storeId: '', query: 'nguyen anh' }, authorization)
  expect(names.body.customers.some((row) => row.key === 'phone:0901234567')).toBe(true)
  const history = await lookup({ scope: 'global', storeId: '', mode: 'history', customerKey: 'phone:0901234567' }, authorization)
  expect(history.status, JSON.stringify(history.body)).toBe(200)
  expect(history.body.total).toBe(4)
  expect(history.body.records.map((row) => row.id)).toEqual(['NEW', 'CROSS-STORE', 'OLD', 'CLOSED-STORE'])
  expect(history.body.records[0]).toMatchObject({ storeName: 'Store 1', employeeName: 'Employee', amount: 120000,
    items: [{ productName: 'Áo', quantity: 2 }] })
  expect(history.body.records[1]).toMatchObject({ storeName: 'Store 2', employeeName: 'Former employee' })
  expect(history.body.records[3]).toMatchObject({ storeName: 'Closed store', employeeName: 'Seller snapshot' })
  expect(JSON.stringify(history.body)).not.toMatch(/salary|9999999|8888888/u)
  const secondPage = await lookup({ scope: 'global', storeId: '', mode: 'history', customerKey: 'phone:0888888888', offset: 20 }, authorization)
  expect(secondPage.body.records).toHaveLength(3)
  const screen = await request('/api/system-screens/customer-lookup', authorization)
  expect(screen.status, JSON.stringify(screen.body)).toBe(role === 'store_manager' ? 403 : 200)
  expect(screen.body.state?.orders || []).toEqual([])
  expect(runtime.database.database.prepare("SELECT version FROM app_state WHERE scope_key='global'").get().version).toBe(before)
})

it('denies global lookup to employees and keeps the Admin workspace inaccessible to store roles', async () => {
  for (const authorization of [employee]) {
    for (const mode of ['list', 'history', 'suggest', 'status']) {
      const result = await lookup({ scope: 'global', mode, customerKey: 'phone:0901234567', query: '090' }, authorization)
      expect(result.status).toBe(403)
      expect(result.body.customers || result.body.records || result.body.suggestions).toBeUndefined()
    }
    expect((await request('/api/system-screens/customer-lookup', authorization)).status).toBe(403)
  }
  expect((await request('/api/system-screens/customer-lookup', manager)).status).toBe(403)
  expect((await lookup({ scope: 'global', storeId: '' }, '')).status).toBe(401)
  expect((await lookup({ scope: 'all' })).status).toBe(400)
  expect((await lookup({ scope: 'global', offset: '0.1' })).status).toBe(400)
})

it.each(['S1', 'S2'])('recomputes tags from persisted orders through create, customer edits, retries and soft deletion in %s', async (secondStore) => {
  const phoneA = secondStore === 'S1' ? '0917000101' : '0918000101'
  const phoneB = secondStore === 'S1' ? '0917000202' : '0918000202'
  const versions = new Map()
  const command = (type, payload, key = crypto.randomUUID(), authorization = token) => {
    if (!versions.has(key)) versions.set(key, runtime.database.database.prepare("SELECT version FROM app_state WHERE scope_key='global'").get().version)
    return request('/api/command', authorization, { type, payload, expectedVersion: versions.get(key) }, { 'idempotency-key': key })
  }
  const create = (phone, storeId, key) => command('order.create', { storeId, customerName: `Fixture ${phone === phoneA ? 'A' : 'B'}`,
    customerPhone: phone, gender: 'Nam', occupation: 'Kỹ sư', acquisitionChannel: 'Facebook',
    paymentMethod: 'Tiền mặt', amount: 100000, items: [{ productId: 'order-product-001', quantity: 1 }] }, key)
  const assertContact = async (phone, count, storeCounts) => {
    const expected = { isReturningCustomer: count >= 2, hasPurchaseHistory: count > 0 }
    const global = await lookup({ scope: 'global', query: phone })
    expect(global.status).toBe(200)
    expect(global.body.customers).toHaveLength(count ? 1 : 0)
    const status = await lookup({ mode: 'status', query: phone }, employee)
    expect(status.body).toMatchObject(expected)
    const suggestions = await lookup({ mode: 'suggest', query: phone }, employee)
    expect(suggestions.body.suggestions).toHaveLength(count ? 1 : 0)
    if (!count) return
    expect(global.body.customers[0]).toMatchObject({ ...expected, orderCount: count })
    expect(suggestions.body.suggestions[0]).toMatchObject(expected)
    for (const storeId of ['S1', 'S2']) {
      const list = await lookup({ storeId, query: phone })
      const history = await lookup({ storeId, mode: 'history', customerKey: `phone:${phone}` })
      if (!storeCounts[storeId]) {
        expect(list.body.customers).toEqual([])
        expect(history.status).toBe(404)
      } else {
        expect(list.body.customers[0]).toMatchObject({ ...expected, orderCount: count })
        expect(history.body).toMatchObject({ total: count, customer: { ...expected, orderCount: count } })
        expect(history.body.records).toHaveLength(count)
      }
    }
  }
  await assertContact(phoneA, 0)
  const firstA = await create(phoneA, 'S1')
  const firstB = await create(phoneB, 'S2')
  expect(firstA.status, JSON.stringify(firstA.body)).toBe(201)
  expect(firstB.status, JSON.stringify(firstB.body)).toBe(201)
  await assertContact(phoneA, 1, { S1: 1 })
  await assertContact(phoneB, 1, { S2: 1 })
  const createKey = crypto.randomUUID()
  const second = await create(phoneA, secondStore, createKey)
  expect(second.status, JSON.stringify(second.body)).toBe(201)
  const twoA = { S1: 1 + Number(secondStore === 'S1'), S2: Number(secondStore === 'S2') }
  await assertContact(phoneA, 2, twoA)
  const replay = await create(phoneA, secondStore, createKey)
  expect(replay.body.order.id).toBe(second.body.order.id)
  await assertContact(phoneA, 2, twoA)
  const moved = await command('order.update', { orderId: second.body.order.id, customerName: 'Fixture B', customerPhone: phoneB, reason: 'Correct customer identity' })
  expect(moved.status, JSON.stringify(moved.body)).toBe(200)
  await assertContact(phoneA, 1, { S1: 1 })
  await assertContact(phoneB, 2, { S1: Number(secondStore === 'S1'), S2: 1 + Number(secondStore === 'S2') })
  const restored = await command('order.update', { orderId: second.body.order.id, customerName: 'Fixture A', customerPhone: phoneA.replace(/(\d{3})(\d{3})(\d+)/u, '$1 $2 $3'), reason: 'Restore normalized contact' })
  expect(restored.status, JSON.stringify(restored.body)).toBe(200)
  await assertContact(phoneA, 2, twoA)
  await assertContact(phoneB, 1, { S2: 1 })
  const nameOnly = await command('order.update', { orderId: second.body.order.id, customerName: 'Fixture A renamed', reason: 'Name correction only' })
  expect(nameOnly.status).toBe(200)
  await assertContact(phoneA, 2, twoA)
  expect((await command('order.update', { orderId: second.body.order.id, customerPhone: phoneB, reason: '' })).status).toBe(400)
  expect((await command('order.delete', { orderId: second.body.order.id, reason: 'Denied manager deletion' }, crypto.randomUUID(), manager)).status).toBe(403)
  await assertContact(phoneA, 2, twoA)
  const deleteKey = crypto.randomUUID()
  const removed = await command('order.delete', { orderId: second.body.order.id, reason: 'Remove duplicate test sale' }, deleteKey)
  expect(removed.status, JSON.stringify(removed.body)).toBe(200)
  await assertContact(phoneA, 1, { S1: 1 })
  expect((await command('order.delete', { orderId: second.body.order.id, reason: 'Remove duplicate test sale' }, deleteKey)).status).toBe(200)
  await assertContact(phoneA, 1, { S1: 1 })
  const persisted = runtime.database.database.prepare("SELECT value_json FROM state_entities WHERE collection_key='orders' AND record_id=?").get(second.body.order.id)
  expect(JSON.parse(persisted.value_json)).toMatchObject({ status: 'Đã xóa', deletedAt: expect.any(String) })
  expect((await command('order.delete', { orderId: firstA.body.order.id, reason: 'Remove last fixture sale' })).status).toBe(200)
  await assertContact(phoneA, 0)
  expect((await command('order.delete', { orderId: firstB.body.order.id, reason: 'Remove remaining fixture sale' })).status).toBe(200)
  await assertContact(phoneB, 0)
})
