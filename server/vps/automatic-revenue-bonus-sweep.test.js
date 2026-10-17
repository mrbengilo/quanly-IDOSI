// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'
import { finalizeAutomaticRevenueBonuses } from '../worker.js'
import { createIdosiServer } from './server.mjs'

const STORES = ['S1', 'S2', 'S3']
const DAYS = ['2026-09-10', '2026-09-11', '2026-09-12']

const closedAttendance = (storeId, date) => ({
  id: `ATT-${storeId}-${date}`,
  employeeId: `E-${storeId}`,
  storeId,
  date,
  workDate: date,
  shiftId: 'ca1',
  shiftName: 'Ca 1',
  shiftStart: '08:00',
  shiftEnd: '17:00',
  checkInAt: `${date}T01:00:00.000Z`,
  checkOutAt: `${date}T10:00:00.000Z`,
})

const withRuntime = async (initialState, run) => {
  const directory = await mkdtemp(resolve(tmpdir(), 'idosi-bonus-sweep-'))
  const { server, runtime } = createIdosiServer({
    databasePath: resolve(directory, 'state.sqlite'),
    imagesDirectory: resolve(directory, 'images'),
    bootstrapToken: 'bonus-sweep-bootstrap-token',
    automaticRevenueBonusEnabled: false,
  })
  await new Promise((done) => server.listen(0, '127.0.0.1', done))
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/bootstrap`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-idosi-bootstrap-token': 'bonus-sweep-bootstrap-token' },
      body: JSON.stringify({
        username: 'sweep.admin', password: 'sweep-admin-password', displayName: 'Sweep Admin', initialState,
      }),
    })
    expect(response.status).toBe(201)
    await run(runtime)
  } finally {
    await new Promise((done) => server.close(done))
    await rm(directory, { recursive: true, force: true })
  }
}

const countRows = (runtime, collection) => runtime.database.database.prepare(`
  SELECT COUNT(*) AS count FROM state_entities WHERE scope_key = 'global' AND collection_key = ?
`).get(collection).count

it('spends each sweep on unsettled days so newer days are never starved', async () => {
  await withRuntime({
    stores: STORES.map((id) => ({ id, name: `Store ${id}`, short: id })),
    employees: STORES.map((storeId) => ({
      id: `E-${storeId}`, storeId, name: `Employee ${storeId}`, unit: 'store', status: 'Đang làm việc',
    })),
    attendance: STORES.flatMap((storeId) => DAYS.map((date) => closedAttendance(storeId, date))),
    orders: STORES.map((storeId) => ({
      id: `ORD-${storeId}`, storeId, employeeId: `E-${storeId}`, amount: 100_000,
      createdAt: '2026-09-10T03:00:00.000Z',
    })),
  }, async (runtime) => {
    const fullReads = { count: 0 }
    const readStateSnapshot = runtime.database.readStateSnapshot.bind(runtime.database)
    runtime.database.readStateSnapshot = (...args) => {
      fullReads.count += 1
      return readStateSnapshot(...args)
    }
    const yields = { count: 0 }
    const options = {
      now: '2026-09-13T16:00:00.000Z',
      trigger: 'test-sweep',
      maxScopes: 4,
      yieldControl: async () => { yields.count += 1 },
    }
    const first = await finalizeAutomaticRevenueBonuses(runtime.env, options)
    expect(first).toMatchObject({ candidateCount: 4, finalized: 4, failed: 0, pendingCount: 9 })
    expect(yields.count).toBe(3)

    const second = await finalizeAutomaticRevenueBonuses(runtime.env, options)
    expect(second).toMatchObject({ candidateCount: 4, finalized: 4, alreadyFinalized: 4, failed: 0 })
    const firstKeys = first.results.map((result) => `${result.storeId}:${result.businessDate}`)
    const secondKeys = second.results.map((result) => `${result.storeId}:${result.businessDate}`)
    expect(secondKeys.some((key) => firstKeys.includes(key))).toBe(false)

    const third = await finalizeAutomaticRevenueBonuses(runtime.env, options)
    expect(third).toMatchObject({ candidateCount: 1, finalized: 1, alreadyFinalized: 8, failed: 0 })

    // Scoped commits must keep every other store/day's rows and all history.
    expect(countRows(runtime, 'revenueBonusDaily')).toBe(9)
    expect(countRows(runtime, 'attendance')).toBe(9)
    expect(countRows(runtime, 'orders')).toBe(3)
    expect(countRows(runtime, 'jobRuns')).toBe(9)
    expect(fullReads.count).toBe(0)

    const idle = await finalizeAutomaticRevenueBonuses(runtime.env, options)
    expect(idle).toMatchObject({ candidateCount: 0, finalized: 0, alreadyFinalized: 9 })
  })
}, 60_000)

it('skips payroll-locked months without rewriting payroll rows', async () => {
  await withRuntime({
    stores: [{ id: 'S1', name: 'Store S1', short: 'S1' }],
    employees: [{ id: 'E-S1', storeId: 'S1', name: 'Employee S1', unit: 'store', status: 'Đang làm việc' }],
    attendance: DAYS.map((date) => closedAttendance('S1', date)),
    payrollPeriods: [{
      id: 'PAY-S1-2026-09', storeId: 'S1', period: '2026-09', status: 'Đã khóa', lockedAt: '2026-09-13T00:00:00.000Z',
    }],
  }, async (runtime) => {
    const before = runtime.database.database.prepare(`
      SELECT entity_key, value_json FROM state_entities WHERE collection_key = 'payrollPeriods'
    `).all()
    const summary = await finalizeAutomaticRevenueBonuses(runtime.env, {
      now: '2026-09-13T16:00:00.000Z', trigger: 'test-locked',
    })
    expect(summary).toMatchObject({ candidateCount: 0, finalized: 0, payrollLocked: 3 })
    const explicit = await finalizeAutomaticRevenueBonuses(runtime.env, {
      now: '2026-09-13T16:00:00.000Z', trigger: 'test-locked', storeId: 'S1', businessDate: '2026-09-10',
    })
    expect(explicit).toMatchObject({ candidateCount: 1, finalized: 0, payrollLocked: 1 })
    expect(runtime.database.database.prepare(`
      SELECT entity_key, value_json FROM state_entities WHERE collection_key = 'payrollPeriods'
    `).all()).toEqual(before)
    expect(countRows(runtime, 'revenueBonusDaily')).toBe(0)
  })
}, 60_000)
