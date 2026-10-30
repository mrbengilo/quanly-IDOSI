// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { createIdosiServer } from './server.mjs'

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
    orders: [order('OLD'), order('NEW', { customerName: 'Ánh Nguyễn', customerPhone: '0901234567', createdAt: '2026-10-30T09:00:00+07:00' }),
      order('CROSS-STORE', { storeId: 'S2', employeeId: 'OLD-STAFF', createdAt: '2025-01-01T01:00:00Z' }),
      order('CLOSED-STORE', { storeId: 'S3', employeeId: 'MISSING', employeeName: 'Seller snapshot' }),
      order('OTHER', { storeId: 'S2', customerPhone: '0999999999' }),
      order('DELETED', { deletedAt: '2026-10-30' }), order('BALANCE', { source: 'legacy-opening-balance' }),
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

it('searches all periods and name aliases, normalizes phones, keeps missing phones separate, and excludes deleted/balance/other-store rows', async () => {
  const result = await lookup({}, manager)
  expect(result.status, JSON.stringify(result.body)).toBe(200)
  expect(result.body.total).toBe(4)
  const customer = result.body.customers.find((row) => row.customerPhone === '0901234567')
  expect(customer).toMatchObject({ customerName: 'Ánh Nguyễn', orderCount: 2 })
  expect(customer.orders).toBeUndefined()
  expect((await lookup({ query: 'nguyen anh' })).body.customers).toHaveLength(4)
  expect((await lookup({ query: '090 123' }, support)).body.customers).toEqual([customer])
  expect((await lookup({ query: '0999' })).body.total).toBe(0)
  const history = await lookup({ mode: 'history', customerKey: customer.key }, manager)
  expect(history.body.records.map((row) => row.id)).toEqual(['NEW', 'OLD'])
  expect(history.body.records[0]).toMatchObject({ amount: 120000, items: [{ quantity: 2, productName: 'Áo' }] })
  expect((await lookup({ mode: 'history', customerKey: 'phone:0888888888', offset: 20 })).body.records).toHaveLength(3)
})

it('returns compact name/phone suggestions and exact history flags to employees, denying details and cross-store reads', async () => {
  const result = await lookup({ mode: 'suggest', query: '090' }, employee)
  expect(result.status).toBe(200)
  expect(result.body.suggestions).toEqual([{ key: 'phone:0901234567', customerName: 'Ánh Nguyễn',
    customerPhone: '0901234567', hasPurchaseHistory: true }])
  const names = await lookup({ mode: 'suggest', field: 'name', query: 'nguyen anh' }, employee)
  expect(names.status).toBe(200)
  expect(names.body.suggestions).toHaveLength(4)
  expect(names.body.suggestions.every((row) => row.hasPurchaseHistory && !('orders' in row) && !('orderCount' in row))).toBe(true)
  expect((await lookup({ mode: 'status', field: 'name', query: 'Nguyen Anh' }, employee)).body.hasPurchaseHistory).toBe(true)
  expect((await lookup({ mode: 'status', query: '090 123 4567' }, employee)).body.hasPurchaseHistory).toBe(true)
  expect((await lookup({ mode: 'status', query: '090123' }, employee)).body).toMatchObject({ hasPurchaseHistory: false, hasSuggestions: true })
  expect((await lookup({ mode: 'status', query: '0999999999' }, employee)).body.hasPurchaseHistory).toBe(false)
  expect((await lookup({ mode: 'status', field: 'name', query: 'Khách chưa mua' }, employee)).body.hasPurchaseHistory).toBe(false)
  expect((await lookup({ mode: 'suggest', field: 'email', query: '090' }, employee)).status).toBe(400)
  expect((await lookup({ mode: 'suggest', query: '0' }, employee)).body.suggestions).toEqual([])
  expect((await lookup({}, employee)).status).toBe(403)
  expect((await lookup({ mode: 'history', customerKey: 'phone:0901234567' }, employee)).status).toBe(403)
  for (const authorization of [manager, employee]) expect((await lookup({ mode: 'suggest', query: '09', storeId: 'S2' }, authorization)).status).toBe(403)
  expect((await lookup({ mode: 'status', query: '0999999999', storeId: 'S2' }, employee)).status).toBe(403)
  expect((await lookup({}, '')).status).toBe(401)
  expect((await lookup({ offset: '-1' })).status).toBe(400)
  expect((await lookup({ mode: 'history', customerKey: 'phone:0999999999' })).status).toBe(404)
})

it('loads the new store screen without hydrating order history or changing state', async () => {
  const before = runtime.database.database.prepare("SELECT version FROM app_state WHERE scope_key='global'").get().version
  const result = await request('/api/store-screens/customer-lookup?storeId=S1', manager)
  expect(result.status, JSON.stringify(result.body)).toBe(200)
  expect(result.body.state?.orders || []).toHaveLength(0)
  await lookup({}, manager)
  expect(runtime.database.database.prepare("SELECT version FROM app_state WHERE scope_key='global'").get().version).toBe(before)
})

it.each(['admin', 'business_support'])('provides cross-store all-period directory and detailed history to %s', async (role) => {
  const authorization = role === 'admin' ? token : support
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
  expect(screen.status, JSON.stringify(screen.body)).toBe(200)
  expect(screen.body.state?.orders || []).toEqual([])
  expect(runtime.database.database.prepare("SELECT version FROM app_state WHERE scope_key='global'").get().version).toBe(before)
})

it('denies every global lookup mode and global screen to store roles, and requires authentication', async () => {
  for (const authorization of [manager, employee]) {
    for (const mode of ['list', 'history', 'suggest', 'status']) {
      const result = await lookup({ scope: 'global', mode, customerKey: 'phone:0901234567', query: '090' }, authorization)
      expect(result.status).toBe(403)
      expect(result.body.customers || result.body.records || result.body.suggestions).toBeUndefined()
    }
    expect((await request('/api/system-screens/customer-lookup', authorization)).status).toBe(403)
  }
  expect((await lookup({ scope: 'global', storeId: '' }, '')).status).toBe(401)
  expect((await lookup({ scope: 'all' })).status).toBe(400)
  expect((await lookup({ scope: 'global', offset: '0.1' })).status).toBe(400)
})
