// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'
import { createIdosiServer } from './server.mjs'

const today = new Date().toISOString()
const STORES = ['S0', 'S1']

const withStores = async (run) => {
  const directory = await mkdtemp(resolve(tmpdir(), 'idosi-rebase-'))
  const { server, runtime } = createIdosiServer({
    databasePath: resolve(directory, 'state.sqlite'),
    imagesDirectory: resolve(directory, 'images'),
    bootstrapToken: 'rebase-fixture-bootstrap',
    automaticRevenueBonusEnabled: false,
  })
  await new Promise((done) => server.listen(0, '127.0.0.1', done))
  const base = `http://127.0.0.1:${server.address().port}`
  const post = async (path, body, headers = {}) => {
    const response = await fetch(`${base}${path}`, {
      method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body),
    })
    return { status: response.status, headers: response.headers, body: await response.json() }
  }
  try {
    const employees = STORES.map((storeId, index) => ({
      id: `E${index}`, storeId, name: `Employee ${index}`, unit: 'store', status: 'Đang làm việc',
    }))
    const bootstrap = await post('/api/bootstrap', {
      username: 'rebase.admin', password: 'rebase-admin-password', displayName: 'Rebase Admin',
      initialState: {
        stores: STORES.map((id) => ({ id, name: `Store ${id}`, short: `ST${id}` })),
        employees,
        attendance: employees.map((employee) => ({
          id: `A-${employee.id}`, employeeId: employee.id, storeId: employee.storeId,
          workDate: today.slice(0, 10), checkInAt: today,
          checklistSnapshot: { source: 'work-catalog', storeChecklistRepairVersion: 1, tasks: [] },
        })),
      },
    }, { 'x-idosi-bootstrap-token': 'rebase-fixture-bootstrap' })
    expect(bootstrap.status).toBe(201)
    const insert = runtime.database.database.prepare(`
      INSERT INTO users(id, username, username_normalized, display_name, password_hash, password_salt,
        password_iterations, password_algorithm, role, status, store_id, employee_id,
        password_updated_at, created_at, updated_at)
      SELECT ?, ?, ?, ?, password_hash, password_salt, password_iterations, password_algorithm,
        'employee', 'active', ?, ?, password_updated_at, created_at, updated_at
      FROM users WHERE username = 'rebase.admin'
    `)
    employees.forEach((employee, index) => insert.run(
      `U${index}`, `rebase.employee.${index}`, `rebase.employee.${index}`, employee.name, employee.storeId, employee.id,
    ))
    const sessions = []
    for (const index of STORES.keys()) {
      const login = await post('/api/login', { username: `rebase.employee.${index}`, password: 'rebase-admin-password' })
      expect(login.status).toBe(200)
      sessions.push({ authorization: `Bearer ${login.body.token}`, version: login.body.bootstrap.version })
    }
    const admin = await post('/api/login', { username: 'rebase.admin', password: 'rebase-admin-password' })
    await run({ post, sessions, adminAuthorization: `Bearer ${admin.body.token}`, runtime })
  } finally {
    await new Promise((done) => server.close(done))
    await rm(directory, { recursive: true, force: true })
  }
}

const orderCommand = (storeId, expectedVersion) => ({
  type: 'order.create',
  expectedVersion,
  payload: {
    storeId, amount: 100_000, customerName: 'Khách', paymentMethod: 'Chuyển khoản',
    gender: 'Nữ', occupation: 'Buôn bán/kinh doanh', acquisitionChannel: 'Facebook',
  },
})

it('lets another store create an order with the version it loaded earlier', async () => {
  await withStores(async ({ post, sessions }) => {
    const first = await post('/api/command', orderCommand('S0', sessions[0].version), {
      authorization: sessions[0].authorization, 'idempotency-key': 'rebase-order-store0-0001',
    })
    expect(first.status).toBe(201)
    const second = await post('/api/command', orderCommand('S1', sessions[1].version), {
      authorization: sessions[1].authorization, 'idempotency-key': 'rebase-order-store1-0001',
    })
    expect(second.status).toBe(201)
    expect(second.body.version).toBe(first.body.version + 1)
    expect(second.body.order).toMatchObject({ storeId: 'S1', code: 'STS1-00001' })
  })
}, 60_000)

it('serves a burst of same-version orders without conflicts or duplicate codes', async () => {
  await withStores(async ({ post, sessions }) => {
    const results = await Promise.all([1, 2, 3, 4, 5].map((index) => post(
      '/api/command',
      orderCommand('S0', sessions[0].version),
      { authorization: sessions[0].authorization, 'idempotency-key': `rebase-burst-000${index}` },
    )))
    expect(results.map((result) => result.status)).toEqual([201, 201, 201, 201, 201])
    expect(new Set(results.map((result) => result.body.order.code)).size).toBe(5)
  })
}, 60_000)

it('replays a lost response when the retry carries a newer expectedVersion', async () => {
  await withStores(async ({ post, sessions }) => {
    const headers = { authorization: sessions[0].authorization, 'idempotency-key': 'rebase-lost-response-0001' }
    const original = await post('/api/command', orderCommand('S0', sessions[0].version), headers)
    expect(original.status).toBe(201)
    const retry = await post('/api/command', orderCommand('S0', original.body.version), headers)
    expect(retry.status).toBe(201)
    expect(retry.headers.get('idempotency-replayed')).toBe('true')
    expect(retry.body.order.id).toBe(original.body.order.id)
    const changedIntent = await post('/api/command', {
      ...orderCommand('S0', original.body.version),
      payload: { ...orderCommand('S0', 0).payload, amount: 200_000 },
    }, headers)
    expect(changedIntent.status).toBe(409)
    expect(changedIntent.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED')
  })
}, 60_000)

it('keeps strict optimistic concurrency for edits and rejects future versions', async () => {
  await withStores(async ({ post, sessions, adminAuthorization }) => {
    const created = await post('/api/command', orderCommand('S0', sessions[0].version), {
      authorization: sessions[0].authorization, 'idempotency-key': 'rebase-strict-order-0001',
    })
    expect(created.status).toBe(201)
    const staleEdit = await post('/api/command', {
      type: 'store.update', expectedVersion: sessions[0].version, payload: { storeId: 'S1', phone: '0901234567' },
    }, { authorization: adminAuthorization, 'idempotency-key': 'rebase-strict-store-0001' })
    expect(staleEdit.status).toBe(409)
    expect(staleEdit.body.error.code).toBe('VERSION_CONFLICT')
    const future = await post('/api/command', orderCommand('S1', created.body.version + 5), {
      authorization: sessions[1].authorization, 'idempotency-key': 'rebase-future-order-0001',
    })
    expect(future.status).toBe(409)
    expect(future.body.error.code).toBe('VERSION_CONFLICT')
  })
}, 60_000)
