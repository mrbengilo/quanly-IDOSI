// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSqliteD1 } from './sqlite-d1.mjs'
import worker, { finalizeAutomaticRevenueBonuses } from '../worker.js'
import { STAFF_WORK_CATALOG_SEED_VERSION } from '../../src/domain/compensationPolicies.js'

const PASSWORD = 'synthetic-revenue-config-password'
const resources = []
afterEach(async () => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  for (const { close, directory } of resources.splice(0)) {
    close()
    await rm(directory, { recursive: true, force: true })
  }
})

// Test-only tables, deliberately different from the legacy tables. Never seed.
const DOSII_TIERS = [{ thresholdVnd: 1_000_000, rateBasisPoints: 125 }, { thresholdVnd: 3_000_000, rateBasisPoints: 250 }]
const SM_TIERS = [{ thresholdVnd: 2_000_000, rateBasisPoints: 300 }, { thresholdVnd: 5_000_000, rateBasisPoints: 450 }]

const closedShift = (id, employeeId, storeId, date) => ({
  id, employeeId, storeId, date, workDate: date, shiftId: 'ca1', shiftName: 'Ca 1',
  checkInAt: `${date}T01:00:00.000Z`, checkOutAt: `${date}T05:00:00.000Z`, workedSeconds: 14_400,
})
const order = (id, storeId, employeeId, date, amount) => ({
  id, storeId, employeeId, amount, paymentMethod: 'Tiền mặt', status: 'Hoàn tất', createdAt: `${date}T03:00:00.000Z`,
})

const setNow = (iso) => vi.setSystemTime(new Date(iso))

const fixture = async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  setNow('2026-10-13T03:00:00.000Z')
  const directory = await mkdtemp(resolve(tmpdir(), 'idosi-revenue-config-'))
  const databasePath = resolve(directory, 'state.sqlite')
  const handle = { db: createSqliteD1({ databasePath }) }
  resources.push({ close: () => handle.db.close(), directory })
  const env = () => ({ DB: handle.db, BOOTSTRAP_TOKEN: 'revenue-config-token' })
  const call = async (path, { body, token, headers = {} } = {}) => {
    const response = await worker.fetch(new Request(`https://idosi.example${path}`, {
      method: body ? 'POST' : 'GET',
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }), env())
    return { status: response.status, body: await response.json(), headers: response.headers }
  }
  const bootstrap = await call('/api/bootstrap', { headers: { 'x-idosi-bootstrap-token': 'revenue-config-token' }, body: {
    username: 'cfg.admin', password: PASSWORD, initialState: {
      staffWorkCatalogSeedVersion: STAFF_WORK_CATALOG_SEED_VERSION,
      stores: [{ id: 'S1', name: 'Dosii NTL' }, { id: 'S2', name: 'SM TNV' }],
      employees: [
        { id: 'E1', code: 'E1', storeId: 'S1', unit: 'store', name: 'Nhân viên Dosii', status: 'Đang làm việc', employmentType: 'Part-Time', hourlyRate: 30000 },
        { id: 'E2', code: 'E2', storeId: 'S2', unit: 'store', name: 'Nhân viên SM', status: 'Đang làm việc', employmentType: 'Part-Time', hourlyRate: 30000 },
        { id: 'M1', storeId: 'S1', unit: 'store_manager', name: 'Quản lý' },
        { id: 'H', storeId: 'BUSINESS_SUPPORT', unit: 'business_support', name: 'HTKD' },
      ],
      attendance: [
        closedShift('A-S1-13', 'E1', 'S1', '2026-10-13'),
        closedShift('A-S1-14', 'E1', 'S1', '2026-10-14'),
        closedShift('A-S2-14', 'E2', 'S2', '2026-10-14'),
      ],
      orders: [
        order('O-S1-13', 'S1', 'E1', '2026-10-13', 3_000_000),
        order('O-S1-14', 'S1', 'E1', '2026-10-14', 3_000_000),
        order('O-S2-14', 'S2', 'E2', '2026-10-14', 5_000_001),
      ],
      schedule: [], tasks: [], shiftDefinitions: [], payrollPeriods: [], violations: [],
    },
  } })
  expect(bootstrap.status, JSON.stringify(bootstrap.body)).toBe(201)
  const insertUser = handle.db.database.prepare(`INSERT INTO users(id, username, username_normalized, display_name, password_hash, password_salt,
    password_iterations, password_algorithm, role, status, store_id, employee_id, password_updated_at, created_at, updated_at)
    SELECT ?, ?, ?, ?, password_hash, password_salt, password_iterations, password_algorithm, ?, 'active', ?, ?,
    password_updated_at, created_at, updated_at FROM users WHERE username='cfg.admin'`)
  for (const [id, role, storeId] of [['E1', 'employee', 'S1'], ['M1', 'store_manager', 'S1'], ['H', 'business_support', 'BUSINESS_SUPPORT']]) {
    insertUser.run(`U${id}`, `cfg.${id}`, `cfg.${id}`.toLowerCase(), id, role, storeId, id)
  }
  const tokens = {}
  const login = async () => {
    for (const id of ['admin', 'E1', 'M1', 'H']) {
      const logged = await call('/api/login', { body: { username: `cfg.${id}`, password: PASSWORD } })
      expect(logged.status, JSON.stringify(logged.body)).toBe(200)
      tokens[id] = logged.body.token
    }
  }
  await login()
  // Sessions expire across simulated days; sign in again at the new time.
  const advance = async (iso) => {
    setNow(iso)
    await login()
  }
  const sql = (query, ...args) => handle.db.database.prepare(query).all(...args)
  const version = () => sql("SELECT version FROM app_state WHERE scope_key='global'")[0].version
  const command = (actor, type, payload, { key = crypto.randomUUID(), expectedVersion = version() } = {}) => call('/api/command', {
    token: tokens[actor], headers: { 'idempotency-key': key }, body: { type, payload, expectedVersion, includeState: false },
  })
  const save = (actor, payload, options) => command(actor, 'revenue_bonus_config.save', {
    storePolicy: 'DOSII', effectiveFrom: '2026-10-14', tiers: DOSII_TIERS, baseVersion: 0, ...payload,
  }, options)
  const configs = () => sql("SELECT value_json FROM state_entities WHERE collection_key='revenueBonusConfigs' ORDER BY entity_order")
    .map((row) => JSON.parse(row.value_json))
  const audits = () => sql("SELECT actor_role, action, entity_id, before_json, after_json, metadata_json, request_id FROM audit_log WHERE action = 'revenue_bonus_config.save' ORDER BY id")
  const reopen = () => {
    handle.db.close()
    handle.db = createSqliteD1({ databasePath })
  }
  return { call, command, save, configs, audits, sql, version, tokens, env, reopen, handle, advance }
}

describe('Admin daily revenue bonus configuration (SQLite runtime)', () => {
  it('lets only Admin write and read the configuration and ignores client-supplied audit metadata', async () => {
    const f = await fixture()
    const before = f.version()
    for (const actor of ['E1', 'M1', 'H']) {
      const denied = await f.save(actor, {})
      expect(denied.status, JSON.stringify(denied.body)).toBe(403)
      expect((await f.call('/api/revenue-bonus/configs', { token: f.tokens[actor] })).status).toBe(403)
    }
    expect((await f.call('/api/revenue-bonus/configs')).status).toBe(401)
    const anonymous = await f.call('/api/command', { headers: { 'idempotency-key': crypto.randomUUID() }, body: {
      type: 'revenue_bonus_config.save', expectedVersion: before, payload: { storePolicy: 'DOSII', effectiveFrom: '2026-10-14', tiers: DOSII_TIERS, baseVersion: 0 },
    } })
    expect(anonymous.status).toBe(401)
    expect(f.version()).toBe(before)
    expect(f.configs()).toEqual([])

    const empty = await f.call('/api/revenue-bonus/configs', { token: f.tokens.admin })
    expect(empty.status).toBe(200)
    expect(empty.body).toMatchObject({ today: '2026-10-13', minimumEffectiveFrom: '2026-10-14' })
    expect(empty.body.groups.map((group) => [group.storePolicy, group.headVersion, group.current.source]))
      .toEqual([['DOSII', 0, 'LEGACY'], ['SM_TNV', 0, 'LEGACY']])

    const saved = await f.save('admin', {
      id: 'client-id', version: 99, createdBy: { id: 'forged' }, role: 'admin', requestId: 'forged', status: 'SUPERSEDED',
    })
    expect(saved.status, JSON.stringify(saved.body)).toBe(201)
    expect(saved.body.revenueBonusConfig).toMatchObject({
      storePolicy: 'DOSII', programId: 'revenue-bonus.store-dosii-daily.v1', effectiveFrom: '2026-10-14', version: 1,
      status: 'ACTIVE', tiers: DOSII_TIERS, createdBy: { id: expect.any(String), role: 'admin' },
    })
    expect(saved.body.revenueBonusConfig.id).toMatch(/^rbc_/u)
    expect(saved.body.revenueBonusConfig.createdBy.id).not.toBe('forged')
    expect(saved.body.revenueBonusConfig.requestId).not.toBe('forged')
    const [audit] = f.audits()
    expect(audit).toMatchObject({ actor_role: 'admin', entity_id: saved.body.revenueBonusConfig.id })
    expect(audit.request_id).toBeTruthy()
    expect(JSON.parse(audit.after_json)).toMatchObject({ version: 1, tiers: DOSII_TIERS })
    expect(JSON.parse(audit.before_json)).toMatchObject({ headVersion: 0, current: { source: 'LEGACY' } })
    expect(JSON.parse(audit.metadata_json)).toMatchObject({ storePolicy: 'DOSII', version: 1, baseVersion: 0 })

    const read = await f.call('/api/revenue-bonus/configs', { token: f.tokens.admin })
    const dosii = read.body.groups.find((group) => group.storePolicy === 'DOSII')
    expect(dosii).toMatchObject({ headVersion: 1, current: { source: 'LEGACY' }, pending: [{ version: 1, effectiveFrom: '2026-10-14' }] })
    expect(read.body.groups.find((group) => group.storePolicy === 'SM_TNV')).toMatchObject({ headVersion: 0, pending: [] })
  }, 30_000)

  it('validates on the server with row-level details and rejects invalid groups or programs', async () => {
    const f = await fixture()
    const before = f.version()
    const invalid = await f.save('admin', {
      effectiveFrom: '2026-10-13',
      tiers: [
        { thresholdVnd: 2_000_000, rateBasisPoints: 100 },
        { thresholdVnd: 2_000_000, rateBasisPoints: 200 },
        { thresholdVnd: 1_000_000, rateBasisPoints: 10_001 },
        { thresholdVnd: '3000000', rateBasisPoints: 1.5 },
      ],
    })
    expect(invalid.status).toBe(400)
    expect(invalid.body.error.code).toBe('REVENUE_BONUS_CONFIG_VALIDATION')
    expect(invalid.body.error.details.fieldErrors.effectiveFrom).toMatch(/ngày mai/u)
    expect(invalid.body.error.details.rowErrors.map((row) => row.index)).toEqual([1, 2, 3])
    expect((await f.save('admin', { tiers: [] })).body.error.details.formErrors).toEqual(['Cần ít nhất một mốc thưởng.'])
    expect((await f.save('admin', { storePolicy: 'OTHER' })).body.error.code).toBe('REVENUE_BONUS_CONFIG_STORE_POLICY_INVALID')
    expect((await f.save('admin', { programId: 'revenue-bonus.store-sm-daily.v1' })).body.error.code).toBe('REVENUE_BONUS_CONFIG_PROGRAM_MISMATCH')
    expect((await f.save('admin', { baseVersion: undefined })).body.error.code).toBe('REVENUE_BONUS_CONFIG_BASE_VERSION_REQUIRED')
    expect((await f.save('admin', { effectiveFrom: '2026-02-30' })).status).toBe(400)
    expect(f.version()).toBe(before)
    expect(f.configs()).toEqual([])
  }, 30_000)

  it('rejects stale and concurrent writes, replays retries once and keeps history of replaced pending tables', async () => {
    const f = await fixture()
    const racing = await Promise.all([
      f.save('admin', { effectiveFrom: '2026-10-20' }),
      f.save('admin', { effectiveFrom: '2026-10-21' }),
    ])
    expect(racing.map((result) => result.status).toSorted()).toEqual([201, 409])
    expect(racing.find((result) => result.status === 409).body.error).toMatchObject({
      code: 'REVENUE_BONUS_CONFIG_CONFLICT', details: { currentVersion: 1, baseVersion: 0 },
    })
    expect(f.configs()).toHaveLength(1)

    // Another Admin still editing version 0 cannot overwrite version 1.
    const stale = await f.save('admin', { effectiveFrom: '2026-10-22' })
    expect(stale.status).toBe(409)
    expect(stale.body.error.code).toBe('REVENUE_BONUS_CONFIG_CONFLICT')

    // A stale global version is rebased: only the configuration version guards.
    const staleGlobal = f.version()
    await f.command('admin', 'store.update', { storeId: 'S2', phone: '0901234567' })
    const key = 'revenue-config-retry-0001'
    const replacement = await f.save('admin', { effectiveFrom: '2026-10-18', baseVersion: 1, tiers: [{ thresholdVnd: 500_000, rateBasisPoints: 50 }] },
      { key, expectedVersion: staleGlobal })
    expect(replacement.status, JSON.stringify(replacement.body)).toBe(201)
    const retried = await f.save('admin', { effectiveFrom: '2026-10-18', baseVersion: 1, tiers: [{ thresholdVnd: 500_000, rateBasisPoints: 50 }] },
      { key, expectedVersion: staleGlobal })
    expect(retried.status).toBe(201)
    expect(retried.headers.get('idempotency-replayed')).toBe('true')
    expect(retried.body.revenueBonusConfig.id).toBe(replacement.body.revenueBonusConfig.id)
    const reused = await f.save('admin', { effectiveFrom: '2026-10-19', baseVersion: 1 }, { key })
    expect(reused.status).toBe(409)
    expect(reused.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED')

    expect(f.audits()).toHaveLength(2)
    const stored = f.configs()
    expect(stored.map((record) => [record.version, record.status, record.effectiveFrom])).toEqual([
      [1, 'SUPERSEDED', expect.any(String)], [2, 'ACTIVE', '2026-10-18'],
    ])
    expect(stored[0]).toMatchObject({ supersededByConfigId: stored[1].id, supersededBy: { role: 'admin' } })
    expect(stored[1].supersedesConfigIds).toEqual([stored[0].id])
  }, 30_000)

  it('cannot be bypassed through state patches and leaves no partial row when the write fails', async () => {
    const f = await fixture()
    expect((await f.save('admin', {})).status).toBe(201)
    const state = (await f.call('/api/state', { token: f.tokens.admin })).body.state
    expect(state.revenueBonusConfigs).toHaveLength(1)
    const tampered = { ...state, revenueBonusConfigs: [{ ...state.revenueBonusConfigs[0], tiers: [{ thresholdVnd: 1, rateBasisPoints: 10_000 }] }] }
    const replaced = await f.command('admin', 'state.replace', { state: tampered })
    expect(replaced.status).toBe(400)
    expect(replaced.body.error.code).toBe('DOMAIN_COMMAND_REQUIRED')
    const injected = await f.command('admin', 'state.replace', { state: { ...state, revenueBonusConfigs: [] } })
    expect(injected.body.error.code).toBe('DOMAIN_COMMAND_REQUIRED')
    expect(f.configs()[0].tiers).toEqual(DOSII_TIERS)

    vi.spyOn(console, 'error').mockImplementation(() => {})
    f.handle.db.database.exec(`CREATE TRIGGER fail_config_audit BEFORE INSERT ON audit_log
      WHEN NEW.action = 'revenue_bonus_config.save' BEGIN SELECT RAISE(ABORT, 'simulated storage failure'); END;`)
    const versionBefore = f.version()
    const failed = await f.save('admin', { storePolicy: 'SM_TNV', tiers: SM_TIERS })
    expect(failed.status).toBe(500)
    expect(f.version()).toBe(versionBefore)
    expect(f.configs()).toHaveLength(1)
    expect(f.audits()).toHaveLength(1)
  }, 30_000)

  it('persists across a runtime restart and drives live, finalized and payroll amounts by business date', async () => {
    const f = await fixture()
    expect((await f.save('admin', {})).status).toBe(201)
    expect((await f.save('admin', { storePolicy: 'SM_TNV', tiers: SM_TIERS })).status).toBe(201)
    f.reopen()
    const reread = await f.call('/api/revenue-bonus/configs', { token: f.tokens.admin })
    expect(reread.body.groups.map((group) => group.pending[0]?.tiers)).toEqual([DOSII_TIERS, SM_TIERS])

    // Late evening on the 15th: both earlier days are closed and final.
    await f.advance('2026-10-15T16:00:00.000Z')
    const live = async (storeId, businessDate) => {
      const response = await f.call(`/api/revenue-bonus/live?storeId=${storeId}&businessDate=${businessDate}`, { token: f.tokens.admin })
      expect(response.status, JSON.stringify(response.body)).toBe(200)
      return response.body.snapshot
    }
    expect(await live('S1', '2026-10-13')).toMatchObject({ rateBasisPoints: 200, percentagePoolVnd: 60_000, revenueBonusConfig: { source: 'LEGACY' } })
    expect(await live('S1', '2026-10-14')).toMatchObject({ rateBasisPoints: 125, percentagePoolVnd: 37_500, revenueBonusConfig: { source: 'ADMIN_CONFIG', version: 1 } })
    expect(await live('S2', '2026-10-14')).toMatchObject({ rateBasisPoints: 450, percentagePoolVnd: 225_000, revenueBonusConfig: { storePolicy: 'SM_TNV' } })
    const employeeView = await f.call('/api/revenue-bonus/live?storeId=S1&businessDate=2026-10-14', { token: f.tokens.E1 })
    expect(employeeView.body.snapshot).toMatchObject({ rateBasisPoints: 125, revenueBonusConfig: { configId: expect.any(String) } })

    const finalized = await finalizeAutomaticRevenueBonuses(f.env(), { now: '2026-10-15T16:00:00.000Z', trigger: 'test' })
    expect(finalized).toMatchObject({ failed: 0 })
    const daily = f.sql("SELECT value_json FROM state_entities WHERE collection_key='revenueBonusDaily'").map((row) => JSON.parse(row.value_json))
    const s1Day = daily.find((row) => row.storeId === 'S1' && row.businessDate === '2026-10-14')
    expect(s1Day).toMatchObject({ status: 'FINALIZED', percentagePoolVnd: 37_500, rateBasisPoints: 125, revenueBonusConfig: { version: 1, effectiveFrom: '2026-10-14' } })
    expect(s1Day.revenueBonusConfig.tiers.map((tier) => tier.rateBasisPoints)).toEqual([125, 250])
    expect(daily.find((row) => row.storeId === 'S1' && row.businessDate === '2026-10-13')).toMatchObject({ percentagePoolVnd: 60_000, revenueBonusConfig: { source: 'LEGACY' } })

    // A newer table starting tomorrow never rewrites a finalized day.
    expect((await f.save('admin', { effectiveFrom: '2026-10-16', baseVersion: 1, tiers: [{ thresholdVnd: 1, rateBasisPoints: 10_000 }] })).status).toBe(201)
    expect(await live('S1', '2026-10-14')).toMatchObject({ status: 'FINALIZED', percentagePoolVnd: 37_500, revenueBonusConfig: { version: 1 } })
    const period = await f.call('/api/revenue-bonus/period?storeId=S1&period=2026-10', { token: f.tokens.admin })
    expect(period.body.period.days.map((day) => [day.businessDate, day.rateBasisPoints, day.revenueBonusConfigVersion]))
      .toEqual([['2026-10-13', 200, null], ['2026-10-14', 125, 1]])
    expect(period.body.period.percentagePoolVnd).toBe(97_500)

    await f.advance('2026-11-02T03:00:00.000Z')
    const close = await f.command('admin', 'payroll.close', { storeId: 'S1', period: '2026-10' })
    expect([200, 201], JSON.stringify(close.body)).toContain(close.status)
    expect(close.body.period.rows.find((row) => row.employeeId === 'E1')).toMatchObject({ revenueBonusVnd: 97_500 })
  }, 60_000)

  it('keeps a finalize run and a concurrent configuration save on one consistent version', async () => {
    const f = await fixture()
    expect((await f.save('admin', {})).status).toBe(201)
    await f.advance('2026-10-15T16:00:00.000Z')
    const [finalized, saved] = await Promise.all([
      finalizeAutomaticRevenueBonuses(f.env(), { now: '2026-10-15T16:00:00.000Z', trigger: 'test', maxAttempts: 8 }),
      f.save('admin', { baseVersion: 1, effectiveFrom: '2026-10-16', tiers: [{ thresholdVnd: 1, rateBasisPoints: 10_000 }] }),
    ])
    expect(saved.status, JSON.stringify(saved.body)).toBe(201)
    expect(finalized.failed).toBe(0)
    const daily = f.sql("SELECT value_json FROM state_entities WHERE collection_key='revenueBonusDaily'").map((row) => JSON.parse(row.value_json))
    expect(daily.find((row) => row.storeId === 'S1' && row.businessDate === '2026-10-14'))
      .toMatchObject({ percentagePoolVnd: 37_500, revenueBonusConfig: { version: 1 } })
    expect(f.configs().map((record) => [record.version, record.status])).toEqual([[1, 'ACTIVE'], [2, 'ACTIVE']])
  }, 60_000)

  it('uses the configuration of an unfinalized day in payroll and fails closed on corrupted configuration', async () => {
    const f = await fixture()
    expect((await f.save('admin', {})).status).toBe(201)
    await f.advance('2026-11-02T03:00:00.000Z')
    const close = await f.command('admin', 'payroll.close', { storeId: 'S1', period: '2026-10' })
    expect([200, 201], JSON.stringify(close.body)).toContain(close.status)
    expect(close.body.period.rows.find((row) => row.employeeId === 'E1')).toMatchObject({ revenueBonusVnd: 97_500 })

    vi.spyOn(console, 'error').mockImplementation(() => {})
    f.handle.db.database.prepare(`UPDATE state_entities
      SET value_json = json_set(value_json, '$.tiers', json('[]')),
        value_bytes = length(CAST(json_set(value_json, '$.tiers', json('[]')) AS BLOB))
      WHERE collection_key = 'revenueBonusConfigs'`).run()
    const read = await f.call('/api/revenue-bonus/configs', { token: f.tokens.admin })
    expect(read.status).toBe(500)
    expect(read.body.error.code).toBe('REVENUE_BONUS_CONFIG_INVALID')
    const live = await f.call('/api/revenue-bonus/live?storeId=S1&businessDate=2026-10-14', { token: f.tokens.admin })
    expect(live.status).toBe(500)
    expect(live.body.error.code).toBe('REVENUE_BONUS_CONFIG_INVALID')
    const finalized = await finalizeAutomaticRevenueBonuses(f.env(), { now: '2026-11-02T03:00:00.000Z', trigger: 'test', storeId: 'S1', businessDate: '2026-10-14' })
    expect(finalized.results).toEqual([expect.objectContaining({ status: 'FAILED', code: 'REVENUE_BONUS_CONFIG_INVALID' })])
    expect(f.sql("SELECT COUNT(*) AS count FROM state_entities WHERE collection_key='revenueBonusDaily'")[0].count).toBe(0)
    const save = await f.save('admin', { baseVersion: 1, effectiveFrom: '2026-11-10' })
    expect(save.status).toBe(500)
    expect(save.body.error.code).toBe('REVENUE_BONUS_CONFIG_INVALID')
  }, 60_000)
})
