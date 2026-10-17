// Local load-time benchmark for every menu (screen) projection on a synthetic
// dataset. Usage: node scripts/bench-screens.mjs [scale]
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { createIdosiServer } from '../server/vps/server.mjs'

const scale = Number(process.argv[2] || 1)
const STORES = 12
const EMPLOYEES = 240
const DAYS = Math.round(365 * scale)
const ORDERS_PER_STORE_DAY = 12
const BASE = Date.UTC(2026, 9, 17)
const day = (offset) => new Date(BASE - offset * 86_400_000).toISOString().slice(0, 10)

const directory = await mkdtemp(resolve(tmpdir(), 'idosi-bench-'))
const { server, runtime } = createIdosiServer({
  databasePath: resolve(directory, 'state.sqlite'), imagesDirectory: resolve(directory, 'images'),
  bootstrapToken: 'bench', automaticRevenueBonusEnabled: false,
  requestLogger: () => {},
})
await new Promise((done) => server.listen(0, '127.0.0.1', done))
const base = `http://127.0.0.1:${server.address().port}`
const post = async (path, body, headers = {}) => {
  const response = await fetch(`${base}${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body),
  })
  return { status: response.status, payload: await response.json() }
}

const stores = Array.from({ length: STORES }, (_, index) => ({ id: `S${index + 1}`, name: `Cửa hàng ${index + 1}` }))
const employees = Array.from({ length: EMPLOYEES }, (_, index) => ({
  id: `E${index + 1}`, name: `Nhân viên ${index + 1}`, storeId: stores[index % STORES].id,
  unit: index % 20 === 0 ? 'office' : index % 25 === 1 ? 'business_support' : 'store',
}))
const seedCollections = ['orders', 'attendance', 'expenseEntries', 'tasks', 'notifications', 'compensationEntries',
  'violations', 'schedule', 'salaryAdjustments', 'workCatalogProgress', 'orderAudit', 'cashTransactions']
const initialState = { stores, employees }
for (const key of seedCollections) initialState[key] = [{ id: `${key}-seed`, storeId: 'S1', date: day(0) }]
const boot = await post('/api/bootstrap', { username: 'bench.admin', password: 'synthetic-bench-password', initialState },
  { 'x-idosi-bootstrap-token': 'bench' })
if (boot.status !== 201) throw new Error(`bootstrap ${boot.status} ${JSON.stringify(boot.payload)}`)

const db = runtime.database.database
const insert = db.prepare(`INSERT INTO state_entities (scope_key, collection_key, entity_key, entity_order,
  value_json, value_bytes, created_at, updated_at) VALUES ('global', ?, ?, ?, ?, ?, ?, ?)`)
let order = 1_000
const add = (collection, record) => {
  const json = JSON.stringify(record)
  insert.run(collection, record.id, order += 1, json, Buffer.byteLength(json), record.createdAt, record.createdAt)
}
db.exec('BEGIN')
for (let offset = 0; offset < DAYS; offset += 1) {
  const date = day(offset)
  const createdAt = `${date}T03:00:00.000Z`
  for (const store of stores) {
    for (let index = 0; index < ORDERS_PER_STORE_DAY; index += 1) {
      add('orders', {
        id: `O-${store.id}-${date}-${index}`, code: `DH${offset}${index}`, storeId: store.id, date, createdAt,
        employeeId: `E${(index % 20) * STORES + Number(store.id.slice(1))}`, customerName: 'Khách hàng mẫu',
        phone: '0900000000', status: 'Hoàn thành', total: 350_000 + index * 1000, paid: 350_000,
        items: [{ product: 'Giặt sấy', quantity: 3, unitPrice: 25_000, weightKg: 4.5 }, { product: 'Chăn', quantity: 1, unitPrice: 80_000 }],
        note: 'Ghi chú đơn hàng mẫu để có kích thước thực tế',
      })
    }
    for (let shift = 0; shift < 4; shift += 1) {
      const employeeId = `E${shift * STORES + Number(store.id.slice(1))}`
      add('attendance', {
        id: `A-${store.id}-${date}-${shift}`, employeeId, storeId: store.id, date, workDate: date, createdAt,
        shiftId: `shift-${shift}`, checkInAt: `${date}T01:00:00Z`, checkOutAt: `${date}T09:00:00Z`, workedSeconds: 28_800, hours: 8,
      })
      add('tasks', { id: `T-${store.id}-${date}-${shift}`, storeId: store.id, employeeId, date, createdAt, title: 'Vệ sinh máy', status: 'done' })
      add('notifications', { id: `N-${store.id}-${date}-${shift}`, storeId: store.id, employeeId, date, createdAt, message: 'Thông báo mẫu' })
    }
    add('expenseEntries', { id: `X-${store.id}-${date}`, storeId: store.id, date, createdAt, amount: 120_000, category: 'Điện nước' })
    add('schedule', { id: `SC-${store.id}-${date}`, storeId: store.id, date, createdAt, employeeId: `E${Number(store.id.slice(1))}`, shiftId: 'shift-0' })
    add('orderAudit', { id: `OA-${store.id}-${date}`, storeId: store.id, date, createdAt, action: 'update', orderId: `O-${store.id}-${date}-0` })
    if (offset % 3 === 0) add('compensationEntries', { id: `C-${store.id}-${date}`, storeId: store.id, employeeId: `E${Number(store.id.slice(1))}`, date, createdAt, amountVnd: 20_000 })
    if (offset % 7 === 0) add('violations', { id: `V-${store.id}-${date}`, storeId: store.id, employeeId: `E${Number(store.id.slice(1))}`, date, createdAt, points: 1 })
    if (offset % 2 === 0) add('workCatalogProgress', { id: `W-${store.id}-${date}`, storeId: store.id, employeeId: `E${Number(store.id.slice(1))}`, date, createdAt, status: 'DONE' })
  }
}
db.exec('COMMIT')
// Rebuild indexed query columns exactly as migration 0012 does.
const migration = readFileSync(new URL('../drizzle/0012_state_entity_query_indexes.sql', import.meta.url), 'utf8')
const update = migration.split('--> statement-breakpoint').find((part) => part.includes('UPDATE state_entities'))
db.exec(update)
db.exec('ANALYZE')
const counts = db.prepare('SELECT collection_key, count(*) AS n FROM state_entities GROUP BY 1 ORDER BY 2 DESC').all()

const login = await post('/api/login', { username: 'bench.admin', password: 'synthetic-bench-password' })
const token = login.payload.token
const time = async (path) => {
  const started = performance.now()
  const response = await fetch(`${base}${path}`, { headers: { authorization: `Bearer ${token}` } })
  const body = await response.arrayBuffer()
  const ms = performance.now() - started
  // requestId/timestamps differ per call; hash the state so runs on two
  // revisions can prove the payload is unchanged.
  const { state, version } = JSON.parse(Buffer.from(body).toString('utf8'))
  const sha = createHash('sha256').update(JSON.stringify({ state, version })).digest('hex').slice(0, 12)
  return { status: response.status, ms, kb: body.byteLength / 1024, sha }
}
const median = (values) => values.sort((a, b) => a - b)[Math.floor(values.length / 2)]
const measure = async (path) => {
  await time(path)
  const runs = []
  let last
  for (let index = 0; index < 3; index += 1) { last = await time(path); runs.push(last.ms) }
  return { path, status: last.status, ms: Math.round(median(runs)), kb: Math.round(last.kb), sha: last.sha }
}

const systemScreens = process.env.SCREENS?.split(',') || [
  'stores', 'cashflow', 'reports', 'employees', 'business-support', 'store-managers', 'office', 'order-audit',
  'customer-survey', 'support-transfers', 'work-catalog', 'compensation-managers', 'compensation-revenue', 'tasks',
  'assignments', 'reset', 'violations-store', 'violations-office', 'support-overview', 'settings',
]
const storeScreens = ['overview', 'schedule', 'employees', 'orders', 'statistics', 'tasks', 'expenses', 'attendance',
  'payroll', 'revenue-bonus', 'cashflow', 'reports']
const results = []
for (const screen of systemScreens) results.push(await measure(`/api/system-screens/${screen}`))
for (const screen of storeScreens) {
  const period = ['overview', 'payroll'].includes(screen) ? '&period=2026-10' : ''
  results.push(await measure(`/api/store-screens/${screen}?storeId=S1${period}`))
}
results.push(await measure('/api/state-metadata?scope=global'))
console.log(JSON.stringify({ scale, days: DAYS, counts, results }, null, 1))
server.close()
runtime.close?.()
await rm(directory, { recursive: true, force: true })
