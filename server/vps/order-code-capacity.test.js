// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'
import { createIdosiServer } from './server.mjs'

it('keeps creating orders after a store passes 99,999 codes', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'idosi-order-code-'))
  const { server, runtime } = createIdosiServer({
    databasePath: resolve(directory, 'state.sqlite'),
    imagesDirectory: resolve(directory, 'images'),
    bootstrapToken: 'order-code-bootstrap',
    automaticRevenueBonusEnabled: false,
  })
  await new Promise((done) => server.listen(0, '127.0.0.1', done))
  const base = `http://127.0.0.1:${server.address().port}`
  const post = async (path, body, headers = {}) => {
    const response = await fetch(`${base}${path}`, {
      method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body),
    })
    return { status: response.status, body: await response.json() }
  }
  try {
    const today = new Date().toISOString()
    const stores = [{ id: 'S1', name: 'Store S1', short: 'S1' }, { id: 'S2', name: 'Store S2', short: 'S2' }]
    const employees = stores.map((store, index) => ({
      id: `E${index + 1}`, storeId: store.id, name: `Employee ${index + 1}`, unit: 'store', status: 'Đang làm việc',
    }))
    expect((await post('/api/bootstrap', {
      username: 'code.admin', password: 'code-admin-password', displayName: 'Code Admin',
      initialState: {
        stores,
        employees,
        attendance: employees.map((employee) => ({
          id: `A-${employee.id}`, employeeId: employee.id, storeId: employee.storeId,
          workDate: today.slice(0, 10), checkInAt: today,
          checklistSnapshot: { source: 'work-catalog', storeChecklistRepairVersion: 1, tasks: [] },
        })),
        orders: [
          { id: 'O-OLD-1', code: 'S1-99999', storeId: 'S1', amount: 1_000, createdAt: today },
          { id: 'O-OLD-2', code: 'S2-123456', storeId: 'S2', amount: 1_000, createdAt: today },
        ],
      },
    }, { 'x-idosi-bootstrap-token': 'order-code-bootstrap' })).status).toBe(201)
    const insert = runtime.database.database.prepare(`
      INSERT INTO users(id, username, username_normalized, display_name, password_hash, password_salt,
        password_iterations, password_algorithm, role, status, store_id, employee_id,
        password_updated_at, created_at, updated_at)
      SELECT ?, ?, ?, ?, password_hash, password_salt, password_iterations, password_algorithm,
        'employee', 'active', ?, ?, password_updated_at, created_at, updated_at
      FROM users WHERE username = 'code.admin'
    `)
    employees.forEach((employee, index) => insert.run(
      `U${index}`, `code.employee.${index}`, `code.employee.${index}`, employee.name, employee.storeId, employee.id,
    ))
    const createOrder = async (index, key) => {
      const login = await post('/api/login', { username: `code.employee.${index}`, password: 'code-admin-password' })
      return post('/api/command', {
        type: 'order.create',
        expectedVersion: login.body.bootstrap.version,
        payload: {
          storeId: stores[index].id, amount: 100_000, customerName: 'Khách', paymentMethod: 'Chuyển khoản',
          gender: 'Nữ', occupation: 'Buôn bán/kinh doanh', acquisitionChannel: 'Facebook',
        },
      }, { authorization: `Bearer ${login.body.token}`, 'idempotency-key': key })
    }
    const first = await createOrder(0, 'order-code-capacity-0001')
    expect(first.status).toBe(201)
    expect(first.body.order.code).toBe('S1-100000')
    const second = await createOrder(1, 'order-code-capacity-0002')
    expect(second.status).toBe(201)
    expect(second.body.order.code).toBe('S2-123457')
  } finally {
    await new Promise((done) => server.close(done))
    await rm(directory, { recursive: true, force: true })
  }
}, 60_000)
