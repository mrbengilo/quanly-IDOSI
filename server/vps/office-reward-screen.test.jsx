// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it, vi } from 'vitest'
import { createIdosiServer } from './server.mjs'
import { workRewardRows, rewardStatistics } from '../../src/pages/compensation/compensationStatistics.js'
import { UnitCompensationStatistics } from '../../src/pages/compensation/UnitCompensationStatistics.jsx'

const view = vi.hoisted(() => ({ app: {} }))
vi.mock('../../src/state/AppContext', () => ({ useApp: () => view.app }))

it('loads persisted office rewards and legacy completions into history and statistics without changing money or widening access', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'idosi-office-rewards-'))
  const { server, runtime } = createIdosiServer({
    databasePath: resolve(directory, 'state.sqlite'), imagesDirectory: resolve(directory, 'images'),
    bootstrapToken: 'office-screen-fixture', automaticRevenueBonusEnabled: false,
  })
  await new Promise((done) => server.listen(0, '127.0.0.1', done))
  const base = `http://127.0.0.1:${server.address().port}`
  const request = async (path, { body, token, headers = {} } = {}) => {
    const response = await fetch(`${base}${path}`, {
      method: body ? 'POST' : 'GET',
      headers: { ...(body ? { 'content-type': 'application/json' } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
    return { status: response.status, payload: await response.json() }
  }
  const reward = (id, amountVnd) => ({ catalogItemId: id, name: `Office ${id}`, kind: 'REWARD_TASK', amountVnd })
  const attendance = (id, employeeId, workDate, tasks, unit = 'office') => ({
    id, employeeId, workDate, unit, storeId: unit === 'office' ? 'OFFICE' : 'S1',
    shiftId: 'morning', shiftName: 'Ca sáng', checkOutAt: `${workDate}T05:00:00Z`,
    checklistSnapshot: { tasks },
  })
  const source = {
    stores: [{ id: 'S1', name: 'Fixture store' }],
    employees: [
      { id: 'O1', code: 'OFFICE-ONE', name: 'Office One', unit: 'office', storeId: 'OFFICE' },
      { id: 'S1-E', name: 'Store Employee', unit: 'store', storeId: 'S1' },
      { id: 'H1', name: 'Support Operator', unit: 'business_support', storeId: 'BUSINESS_SUPPORT' },
      { id: 'M1', name: 'Store Manager', unit: 'store_manager', storeId: 'S1' },
    ],
    attendance: [
      attendance('A1', 'O1', '2026-09-09', [reward('CLAIMED', 2000), reward('PENDING', 10000), reward('VOID', 7000), reward('UNCLAIMED', 9000)]),
      attendance('A2', 'OFFICE-ONE', '2026-09-30', [reward('LEGACY', 3000)]),
      attendance('A3', 'O1', '2026-10-01', [reward('OCTOBER', 4000)]),
      attendance('AS', 'S1-E', '2026-09-09', [reward('STORE', 90000)], 'store'),
    ],
    workCatalogProgress: [
      { id: 'P1', employeeId: 'O1', attendanceId: 'a1', catalogItemId: 'claimed', checked: true, status: 'CLAIMED', compensationEntryId: 'C1', claimedAt: '2026-09-09T04:00:00Z' },
      { id: 'PP', employeeId: 'O1', attendanceId: 'A1', catalogItemId: 'PENDING', checked: true, status: 'PENDING_TEAM_REVIEW' },
      { id: 'PV', employeeId: 'O1', attendanceId: 'A1', catalogItemId: 'VOID', checked: false, status: 'VOID' },
      { id: 'P3', employeeId: 'O1', attendanceId: 'A3', catalogItemId: 'OCTOBER', checked: true, status: 'CLAIMED', compensationEntryId: 'C3' },
    ],
    compensationEntries: [
      { id: 'C1', employeeId: 'O1', workDate: '2026-09-09', period: '2026-09', targetUnit: 'office', amountVnd: 2000, status: 'APPROVED' },
      { id: 'C3', employeeId: 'O1', workDate: '2026-10-01', period: '2026-10', targetUnit: 'office', amountVnd: 4000, status: 'APPROVED' },
    ],
    tasks: [
      { id: 'LEGACY-TASK', checklistAttendanceId: 'a2', checklistTaskId: 'legacy', completedBy: { 'office-one': true } },
      // An old completed task must not override a subsequently voided claim.
      { id: 'VOID-TASK', checklistAttendanceId: 'A1', checklistTaskId: 'VOID', completed: true },
      { id: 'SUPPORT-TASK', employeeId: 'H1', completed: true },
      ...Array.from({ length: 200 }, (_, i) => ({ id: `STORE-${i}`, employeeId: 'S1-E', detail: 'x'.repeat(1000) })),
    ],
    payrollPeriods: [{ id: 'LOCKED', storeId: 'OFFICE', period: '2026-09', status: 'Đã chốt' }],
  }
  try {
    const bootstrap = await request('/api/bootstrap', {
      body: { username: 'office.admin', password: 'synthetic-office-password', initialState: source },
      headers: { 'x-idosi-bootstrap-token': 'office-screen-fixture' },
    })
    expect(bootstrap.status, JSON.stringify(bootstrap.payload)).toBe(201)
    const database = runtime.database.database
    const insertUser = database.prepare(`
      INSERT INTO users (id, username, username_normalized, display_name, password_hash, password_salt,
        password_iterations, password_algorithm, role, status, store_id, employee_id, password_updated_at, created_at, updated_at)
      SELECT ?, ?, ?, ?, password_hash, password_salt, password_iterations, password_algorithm,
        ?, 'active', ?, ?, password_updated_at, created_at, updated_at FROM users WHERE username='office.admin'
    `)
    for (const [role, storeId, employeeId] of [
      ['business_support', 'BUSINESS_SUPPORT', 'H1'], ['employee', 'OFFICE', 'O1'], ['store_manager', 'S1', 'M1'],
    ]) insertUser.run(role, `office.${role}`, `office.${role}`, role, role, storeId, employeeId)
    const tokens = {}
    for (const role of ['admin', 'business_support', 'employee', 'store_manager']) {
      const login = await request('/api/login', { body: { username: `office.${role}`, password: 'synthetic-office-password' } })
      expect(login.status).toBe(200)
      tokens[role] = login.payload.token
    }
    const persisted = () => ({
      state: database.prepare('SELECT * FROM app_state ORDER BY scope_key').all(),
      entities: database.prepare('SELECT * FROM state_entities ORDER BY collection_key, entity_key').all(),
    })
    const before = persisted()
    const read = (token) => request('/api/system-screens/office', { token })
    const projectRewards = (state) => workRewardRows({ ...state, targetUnit: 'office' })
    for (const role of ['admin', 'business_support']) {
      const response = await read(tokens[role])
      expect(response.status, JSON.stringify(response.payload)).toBe(200)
      const state = response.payload.state
      expect(state.workCatalogProgress.map(({ id }) => id)).toEqual(['P1', 'PP', 'PV', 'P3'])
      expect(state.tasks.map(({ id }) => id)).toEqual(['LEGACY-TASK', 'VOID-TASK'])
      const rows = projectRewards(state)
      expect(rows.find(({ catalogItemId }) => catalogItemId === 'CLAIMED')).toMatchObject({ completed: true, paid: true, amountVnd: 2000 })
      expect(rows.find(({ catalogItemId }) => catalogItemId === 'LEGACY')).toMatchObject({ completed: true, paid: true, amountVnd: 3000 })
      expect(rows.find(({ catalogItemId }) => catalogItemId === 'VOID')).toMatchObject({ completed: false, paid: false, payoutStatus: 'void' })
      expect(rows.find(({ catalogItemId }) => catalogItemId === 'PENDING')).toMatchObject({ completed: true, paid: false, payoutStatus: 'pending' })
      expect(rows.some(({ catalogItemId }) => catalogItemId === 'STORE')).toBe(false)
      expect(rewardStatistics(rows).byMonth).toEqual([
        { key: '2026-10', label: 'Tháng 10/2026', count: 1, amountVnd: 4000 },
        { key: '2026-09', label: 'Tháng 09/2026', count: 2, amountVnd: 5000 },
      ])
      view.app = state
      const html = renderToStaticMarkup(<UnitCompensationStatistics targetUnit="office" employees={state.employees.filter((e) => e.unit === 'office')} />)
      expect(html).toContain('Office CLAIMED')
      expect(html).toContain('Office LEGACY')
      expect(html).toContain('Chờ duyệt team')
      expect(html).toContain('Tháng 09/2026')
      expect(html).toContain('5,000 đ')
      expect(html).not.toContain('Office VOID')
      expect(html).not.toContain('Office UNCLAIMED')
      expect(html).not.toContain('Chưa có lịch sử nhận thưởng.')
      const repeated = await read(tokens[role])
      expect(projectRewards(repeated.payload.state)).toEqual(rows)
    }
    const fast = await read(tokens.admin)
    const optimizedRead = runtime.database.readSystemStateSnapshot
    runtime.database.readSystemStateSnapshot = undefined
    try {
      const fallback = await read(tokens.admin)
      expect(fallback.status).toBe(200)
      expect(projectRewards(fallback.payload.state)).toEqual(projectRewards(fast.payload.state))
    } finally { runtime.database.readSystemStateSnapshot = optimizedRead }
    expect((await read()).status).toBe(401)
    expect((await read(tokens.employee)).status).toBe(403)
    expect((await read(tokens.store_manager)).status).toBe(403)
    expect(persisted()).toEqual(before)
  } finally {
    await new Promise((done) => server.close(done))
    await rm(directory, { recursive: true, force: true })
  }
}, 30_000)
