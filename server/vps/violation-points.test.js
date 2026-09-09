// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSqliteD1 } from './sqlite-d1.mjs'
import worker, { projectSharedState, revenueBonusLiveSnapshot } from '../worker.js'
import { STAFF_WORK_CATALOG_SEED_VERSION } from '../../src/domain/compensationPolicies.js'

const resources = []
afterEach(async () => {
  vi.useRealTimers()
  for (const { db, directory } of resources.splice(0)) {
    db.close()
    await rm(directory, { recursive: true, force: true })
  }
})

const point = (id, value, overrides = {}) => ({ id, targetUnit: 'store', employeeId: 'E1', storeId: 'S1',
  period: '2026-09', occurredOn: '2026-09-01', violationPoints: value, amountVnd: 0, status: 'ACTIVE', ...overrides })
const fixture = async (initial = {}) => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-02T03:00:00Z'))
  const directory = await mkdtemp(resolve(tmpdir(), 'idosi-point-policy-'))
  const db = createSqliteD1({ databasePath: resolve(directory, 'state.sqlite') })
  resources.push({ db, directory })
  const env = { DB: db, BOOTSTRAP_TOKEN: 'point-fixture-token' }
  const post = async (path, body, headers = {}) => {
    const response = await worker.fetch(new Request(`https://idosi.example${path}`, { method: 'POST',
      headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) }), env)
    return { status: response.status, body: await response.json(), headers: response.headers }
  }
  const shift = { id: 'AM', storeId: 'S1', name: 'Ca sáng', start: '08:00', end: '12:00', active: true }
  const bootstrap = await post('/api/bootstrap', { username: 'point.admin', password: 'synthetic-point-password', initialState: {
    staffWorkCatalogSeedVersion: STAFF_WORK_CATALOG_SEED_VERSION,
    stores: [{ id: 'S1', name: 'Dosii NTL' }, { id: 'S2', name: 'Cửa hàng hỗ trợ' }, { id: 'S3', name: 'Cửa hàng khác' }],
    employees: [
      { id: 'E1', code: 'E1', storeId: 'S1', unit: 'store', name: 'Nhân viên một', status: 'Đang làm việc', employmentType: 'Part-Time', hourlyRate: 30000 },
      { id: 'E2', code: 'E2', storeId: 'S1', unit: 'store', name: 'Nhân viên hai', status: 'Đang làm việc', employmentType: 'Part-Time', hourlyRate: 30000 },
      { id: 'M1', storeId: 'S1', unit: 'store_manager', name: 'Quản lý một' },
      { id: 'M3', storeId: 'S3', unit: 'store_manager', name: 'Quản lý khác' },
      { id: 'H', storeId: 'BUSINESS_SUPPORT', unit: 'business_support', name: 'HTKD' },
    ],
    shiftDefinitions: [shift],
    schedule: Array.from({ length: 4 }, (_, index) => ({ id: `SCH${index}`, employeeId: 'E1', storeId: 'S1',
      date: `2026-09-0${index + 2}`, shiftIds: ['AM'], shiftSnapshots: [shift] })),
    attendance: [], orders: [], notifications: [], payrollPeriods: [],
    workCatalogItems: [{ id: 'POINT', code: 'store.violation.test_points', kind: 'VIOLATION', targetGroup: 'store',
      storeId: 'S1', name: 'Vi phạm thử nghiệm', violationPoints: 0.5, amountVnd: 0, active: true, version: 1 }],
    compensationEntries: ['WORK', 'REVENUE', 'MANUAL', 'ALLOWANCE'].map((type, index) => ({
      id: type, type, targetUnit: 'store', employeeId: 'E1', storeId: 'S1', effectiveDate: '2026-09-01', period: '2026-09',
      amountVnd: [10000, 20000, 3000, 4000][index], status: 'APPROVED',
    })),
    violations: [], ...initial,
  } }, { 'x-idosi-bootstrap-token': env.BOOTSTRAP_TOKEN })
  expect(bootstrap.status, JSON.stringify(bootstrap.body)).toBe(201)
  const raw = db.database
  const insert = raw.prepare(`INSERT INTO users(id, username, username_normalized, display_name, password_hash, password_salt,
    password_iterations, password_algorithm, role, status, store_id, employee_id, password_updated_at, created_at, updated_at)
    SELECT ?, ?, ?, ?, password_hash, password_salt, password_iterations, password_algorithm, ?, 'active', ?, ?,
    password_updated_at, created_at, updated_at FROM users WHERE username='point.admin'`)
  for (const [id, role, storeId] of [['E1', 'employee', 'S1'], ['M1', 'store_manager', 'S1'], ['M3', 'store_manager', 'S3'], ['H', 'business_support', 'BUSINESS_SUPPORT']]) {
    insert.run(`U${id}`, `point.${id}`, `point.${id}`.toLowerCase(), id, role, storeId, id)
  }
  const tokens = {}
  for (const id of ['admin', 'E1', 'M1', 'M3', 'H']) {
    const logged = await post('/api/login', { username: `point.${id}`, password: 'synthetic-point-password' })
    expect(logged.status, JSON.stringify(logged.body)).toBe(200)
    tokens[id] = logged.body.token
  }
  const command = (actor, type, payload, options = {}) => post('/api/command', { type, payload, includeState: false,
    expectedVersion: options.version ?? raw.prepare("SELECT version FROM app_state WHERE scope_key='global'").get().version,
  }, { authorization: `Bearer ${tokens[actor]}`, 'idempotency-key': options.key || crypto.randomUUID() })
  const read = async (actor, path) => {
    const response = await worker.fetch(new Request(`https://idosi.example${path}`, { headers: { authorization: `Bearer ${tokens[actor]}` } }), env)
    const body = await response.json()
    expect(response.status, JSON.stringify(body)).toBe(200)
    return body
  }
  const rows = (collection) => raw.prepare('SELECT value_json FROM state_entities WHERE collection_key=? ORDER BY entity_order').all(collection).map((row) => JSON.parse(row.value_json))
  const batch = (date = '2026-09-02') => ({ targetUnit: 'store', storeId: 'S1', employeeId: 'E1', occurredOn: date, shiftId: 'AM', catalogItemIds: ['POINT'] })
  return { db, raw, rows, command, read, batch }
}

describe('violation point policy through VPS commands and projections', () => {
  it('requires valid configured points for new store violations without changing historical amounts', async () => {
    const catalog = { id: 'LEGACY', code: 'store.violation.custom_legacy', kind: 'VIOLATION', targetGroup: 'store', storeId: 'S1', name: 'Nội dung cũ', amountVnd: 2000, active: true, version: 1 }
    const f = await fixture({ workCatalogItems: [catalog] })
    for (const violationPoints of [0, -1, 10.5, '0,55', 'không hợp lệ']) {
      const invalid = await f.command('admin', 'work_catalog.update', { itemId: 'LEGACY', violationPoints })
      expect(invalid.status, JSON.stringify(invalid.body)).toBe(400)
    }
    const batch = { ...f.batch(), catalogItemIds: ['LEGACY'] }
    const missing = await f.command('M1', 'violation.create_batch', batch)
    expect(missing.status).toBe(400)
    expect(missing.body.error.code).toBe('VIOLATION_POINTS_REQUIRED')
    const legacyClient = await f.command('M1', 'violation.create', { ...batch, catalogItemId: 'LEGACY' })
    expect(legacyClient.status).toBe(400)
    expect(legacyClient.body.error.code).toBe('VIOLATION_POINTS_REQUIRED')
    expect(f.rows('violations')).toEqual([])
    expect(f.rows('workCatalogItems')[0]).toMatchObject({ amountVnd: 2000, version: 1 })
    const configured = await f.command('H', 'work_catalog.update', { itemId: 'LEGACY', violationPoints: '0,5' })
    expect(configured.status, JSON.stringify(configured.body)).toBe(200)
    expect(f.rows('workCatalogItems')[0]).toMatchObject({ amountVnd: 0, violationPoints: 0.5 })
    const created = await f.command('M1', 'violation.create_batch', batch)
    expect(created.status, JSON.stringify(created.body)).toBe(201)
    expect(created.body.violations[0]).toMatchObject({ amountVnd: 0, violationPoints: 0.5 })
    expect(f.rows('violationRefunds')).toEqual([])
  }, 30000)

  it('persists decimal points, emits thresholds once, zeros both bonuses and restores them after a valid void', async () => {
    const f = await fixture({ violations: [point('PREVIOUS', 2.5)] })
    const input = f.batch()
    const created = await f.command('M1', 'violation.create_batch', input, { version: 1, key: 'point-batch-retry-0001' })
    expect(created.status, JSON.stringify(created.body)).toBe(201)
    expect(created.body.pointAssessments[0]).toMatchObject({ points: 3, threshold: 3, workBonusBlocked: false })
    expect(created.body.violations[0]).toMatchObject({ violationPoints: 0.5, amountVnd: 0, catalogSnapshot: { violationPoints: 0.5 } })
    expect(f.rows('notifications')).toHaveLength(1)
    const retry = await f.command('M1', 'violation.create_batch', input, { version: 1, key: 'point-batch-retry-0001' })
    expect(retry.body).toEqual(created.body)
    expect(retry.headers.get('Idempotency-Replayed')).toBe('true')
    const duplicate = await f.command('M1', 'violation.create_batch', input)
    expect(duplicate.body).toMatchObject({ existing: true, createdCount: 0 })
    expect(f.rows('notifications')).toHaveLength(1)
    const configured = await f.command('admin', 'work_catalog.update', { itemId: 'POINT', violationPoints: 2 })
    expect(configured.status, JSON.stringify(configured.body)).toBe(200)
    const five = await f.command('M1', 'violation.create_batch', f.batch('2026-09-03'))
    expect(five.status, JSON.stringify(five.body)).toBe(201)
    expect(five.body.pointAssessments[0]).toMatchObject({ points: 5, threshold: 5, workBonusBlocked: true, revenueBonusBlocked: true })
    expect(f.rows('violations').find((row) => row.id === created.body.violations[0].id).violationPoints).toBe(0.5)
    expect(f.rows('notifications').map((row) => row.threshold).sort()).toEqual([3, 5])
    expect(f.rows('notifications').find((row) => row.threshold === 5).message).toMatch(/thưởng doanh thu và thưởng công việc/iu)
    const own = (await f.read('E1', '/api/system-screens/employee-compensation')).state
    expect(own.compensationEntries.filter((row) => ['WORK', 'REVENUE'].includes(row.type)).map((row) => row.amountVnd)).toEqual([0, 0])
    expect(own.violationPointSummaries).toEqual([expect.objectContaining({ employeeId: 'E1', points: 5 })])
    expect(f.rows('compensationEntries').map((row) => row.amountVnd)).toEqual([10000, 20000, 3000, 4000])
    const award = await f.command('H', 'compensation_entry.create', { type: 'WORK', targetUnit: 'store', employeeId: 'E1', storeId: 'S1', effectiveDate: '2026-09-05', amountVnd: 5000, note: 'Công việc phát sinh sau khi đạt 5 điểm' })
    expect(award.status, JSON.stringify(award.body)).toBe(201)
    const approve = await f.command('admin', 'compensation_entry.approve', { entryId: award.body.entry.id })
    expect(approve.status, JSON.stringify(approve.body)).toBe(200)
    const projected = (await f.read('admin', '/api/state')).state
    const replace = await f.command('admin', 'state.replace', { state: projected })
    expect(replace.status, JSON.stringify(replace.body)).toBe(200)
    expect(f.rows('compensationEntries').find((row) => row.id === award.body.entry.id).amountVnd).toBe(5000)
    const close = await f.command('admin', 'payroll.close', { storeId: 'S1', period: '2026-09' })
    expect([200, 201], JSON.stringify(close.body)).toContain(close.status)
    const closed = close.body.period.rows.find((row) => row.employeeId === 'E1')
    expect(closed).toMatchObject({ workBonusVnd: 0, revenueBonusVnd: 0, manualBonusVnd: 3000, violationVnd: 0, violationPoints: 5 })
    const removed = await f.command('M1', 'violation.void', { violationId: five.body.violations[0].id, reason: 'Ghi nhận nhầm' })
    expect(removed.status, JSON.stringify(removed.body)).toBe(200)
    expect(removed.body.pointAssessments[0]).toMatchObject({ points: 3, workBonusBlocked: false })
    expect(f.rows('payrollPeriods')[0]).toMatchObject({ needsReclose: true })
    const reclosed = await f.command('admin', 'payroll.close', { storeId: 'S1', period: '2026-09' })
    expect(reclosed.body.period.rows.find((row) => row.employeeId === 'E1')).toMatchObject({ workBonusVnd: 15000, revenueBonusVnd: 20000, violationPoints: 3 })
    await f.command('admin', 'work_catalog.update', { itemId: 'POINT', violationPoints: 3 })
    const six = await f.command('M1', 'violation.create_batch', f.batch('2026-09-04'))
    expect(six.body.pointAssessments[0]).toMatchObject({ points: 6, label: 'Đình chỉ làm việc' })
    expect(f.rows('notifications').some((row) => row.title === 'Đình chỉ làm việc')).toBe(true)
    expect(f.rows('employees').find((row) => row.id === 'E1').status).toBe('Đang làm việc')
    const otherMonth = await f.command('admin', 'payroll.close', { storeId: 'S1', period: '2026-10' })
    expect(otherMonth.body.period.rows.find((row) => row.employeeId === 'E1')).toMatchObject({ violationPoints: 0, workBonusBlocked: false, revenueBonusBlocked: false })
  }, 30000)

  it('denies employees and other stores, protects paid payroll and exposes only authorized point summaries', async () => {
    const f = await fixture({ violations: [point('FIVE', 5), point('OTHER', 6, { employeeId: 'E3', storeId: 'S3' })],
      payrollPeriods: [{ id: 'PAID', storeId: 'S1', period: '2026-09', status: 'Đã chi', paidAt: '2026-09-09', rows: [{ employeeId: 'E1' }] }] })
    for (const actor of ['E1', 'M3']) {
      const denied = await f.command(actor, 'violation.create_batch', f.batch())
      expect(denied.status, JSON.stringify(denied.body)).toBe(actor === 'E1' ? 403 : 404)
    }
    const locked = await f.command('M1', 'violation.void', { violationId: 'FIVE', reason: 'Kiểm tra khóa kỳ' })
    expect(locked.status, JSON.stringify(locked.body)).toBe(409)
    expect(f.rows('violations')[0].status).toBe('ACTIVE')
    const state = (await f.read('M1', '/api/store-screens/tasks?storeId=S1')).state
    expect(state.violationPointSummaries.map((row) => row.employeeId)).toEqual(['E1'])
    expect(state.violations).not.toContainEqual(expect.objectContaining({ employeeId: 'E1' }))
  }, 30000)

  it('protects a paid home-store payroll when a support-store point event is voided', async () => {
    const f = await fixture({ violations: [point('SUPPORT-POINT', 5, { storeId: 'S2', employeeHomeStoreId: 'S1', supportTransferId: 'TR-OLD' })],
      payrollPeriods: [{ id: 'HOME-PAID', storeId: 'S1', period: '2026-09', status: 'Đã chi', rows: [{ employeeId: 'E1' }] }],
    })
    const denied = await f.command('admin', 'violation.void', { violationId: 'SUPPORT-POINT', reason: 'Không được đổi kỳ đã chi' })
    expect(denied.status, JSON.stringify(denied.body)).toBe(409)
    expect(denied.body.error.code).toBe('PAYROLL_PERIOD_PAID')
    expect(f.rows('violations')[0].status).toBe('ACTIVE')
  }, 30000)

  it('reads the entire point month across stores for revenue while retaining audit shares', async () => {
    const f = await fixture({ violations: [point('HOME', 2.5), point('SUPPORT', 2.5, { storeId: 'S2', occurredOn: '2026-09-07' }), point('OLD', 10, { period: '2026-08', occurredOn: '2026-08-01' })],
      revenueBonusDaily: [{ id: 'DAY', storeId: 'S1', businessDate: '2026-09-03', period: '2026-09', status: 'CONFIRMED', revenueVnd: 1000000, totalPoolVnd: 30000, unallocatedVnd: 0 }],
      revenueBonusAllocations: [{ id: 'ALLOC', revenueBonusDailyId: 'DAY', employeeId: 'E1', storeId: 'S1', businessDate: '2026-09-03', period: '2026-09', amountVnd: 10000, status: 'APPROVED' }],
    })
    const snapshot = f.db.readRevenueBonusStateSnapshot('global', 'S1', '2026-09-03')
    const scoped = Object.fromEntries(snapshot.manifests.map(({ collection_key: key }) => [key,
      snapshot.entities.filter((row) => row.collection_key === key).map((row) => JSON.parse(row.value_json))]))
    expect(scoped.violations.map((row) => row.id).sort()).toEqual(['HOME', 'SUPPORT'])
    const live = revenueBonusLiveSnapshot({ state: scoped, store: scoped.stores[0], businessDate: '2026-09-03' })
    expect(live.allocations[0]).toMatchObject({ amountVnd: 0, preViolationAmountVnd: 10000, status: 'VIOLATION_EXCLUDED' })
    const full = Object.fromEntries(['employees', 'stores', 'violations', 'compensationEntries', 'revenueBonusDaily', 'revenueBonusAllocations'].map((key) => [key, f.rows(key)]))
    const admin = projectSharedState(full, { role: 'admin' })
    expect(admin.compensationEntries.filter((row) => ['WORK', 'REVENUE'].includes(row.type)).every((row) => row.amountVnd === 0)).toBe(true)
  }, 30000)
})
