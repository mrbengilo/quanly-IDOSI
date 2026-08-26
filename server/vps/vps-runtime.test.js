// @vitest-environment node

import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FileR2 } from './file-r2.mjs'
import { createSqliteD1 } from './sqlite-d1.mjs'
import { createIdosiServer } from './server.mjs'

const temporaryDirectories = []

const vietnamDateKey = (date = new Date()) => Object.fromEntries(
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date).filter(({ type }) => type !== 'literal').map(({ type, value }) => [type, value]),
)

const vietnamWorkDate = (date = new Date()) => {
  const { year, month, day } = vietnamDateKey(date)
  return `${year}-${month}-${day}`
}

const postJson = async (baseUrl, path, body, headers = {}) => {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
  return { response, body: await response.json() }
}

const temporaryDirectory = async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'idosi-vps-'))
  temporaryDirectories.push(directory)
  return directory
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('IDOSI VPS runtime', () => {
  it('keeps Node upstream sockets alive longer than the Caddy proxy pool', async () => {
    const directory = await temporaryDirectory()
    const { server, runtime } = createIdosiServer({
      databasePath: resolve(directory, 'idosi.sqlite'),
      imagesDirectory: resolve(directory, 'images'),
    })
    try {
      expect(server.keepAliveTimeout).toBe(65_000)
      expect(server.headersTimeout).toBe(70_000)
      expect(server.headersTimeout).toBeGreaterThan(server.keepAliveTimeout)

      const caddyfile = await readFile(resolve('deploy', 'vps', 'Caddyfile'), 'utf8')
      expect(caddyfile).toMatch(/reverse_proxy app:3000\s*\{[\s\S]*?transport http\s*\{[\s\S]*?keepalive 30s/u)
    } finally {
      runtime.database.close()
    }
  })

  it('applies migrations once and rolls back a failed D1 batch', async () => {
    const directory = await temporaryDirectory()
    const databasePath = resolve(directory, 'idosi.sqlite')
    const migrationFiles = (await readdir(resolve('drizzle')))
      .filter((name) => /^\d+.*\.sql$/u.test(name))
      .sort((left, right) => left.localeCompare(right))
    const db = createSqliteD1({ databasePath })
    expect((await db.prepare('SELECT migration_name FROM _vps_migrations ORDER BY migration_name').all()).results)
      .toEqual(migrationFiles.map((migration_name) => ({ migration_name })))

    await expect(db.batch([
      db.prepare("INSERT INTO system_metadata (meta_key, value_json, version, updated_at) VALUES ('rollback-check', '{}', 1, '2026-08-18T00:00:00.000Z')"),
      db.prepare("INSERT INTO system_metadata (meta_key, value_json, version, updated_at) VALUES ('rollback-check', '{}', 1, '2026-08-18T00:00:00.000Z')"),
    ])).rejects.toThrow()
    expect(await db.prepare("SELECT meta_key FROM system_metadata WHERE meta_key = 'rollback-check'").first()).toBeNull()
    db.close()

    const reopened = createSqliteD1({ databasePath })
    expect((await reopened.prepare('SELECT migration_name FROM _vps_migrations ORDER BY migration_name').all()).results)
      .toEqual(migrationFiles.map((migration_name) => ({ migration_name })))
    reopened.close()
  }, 30_000)

  it('stores private identity images under the configured directory', async () => {
    const directory = await temporaryDirectory()
    const bucket = new FileR2(resolve(directory, 'images'))
    const bytes = Uint8Array.from([1, 2, 3, 4])
    await bucket.put('identity-images/E01/front.png', bytes, {
      httpMetadata: { contentType: 'image/png' },
      customMetadata: { employeeId: 'E01' },
    })
    const stored = await bucket.get('identity-images/E01/front.png')
    expect([...stored.body]).toEqual([...bytes])
    expect(stored.httpMetadata.contentType).toBe('image/png')
    expect((await bucket.list({ prefix: 'identity-images/' })).objects.map(({ key }) => key))
      .toEqual(['identity-images/E01/front.png'])
    await expect(bucket.get('../outside')).rejects.toThrow(/Khóa tệp/u)
    await bucket.delete('identity-images/E01/front.png')
    expect(await bucket.get('identity-images/E01/front.png')).toBeNull()
  })

  it('serves the SPA and bootstraps exactly one Admin through HTTP', async () => {
    const directory = await temporaryDirectory()
    const staticDirectory = resolve(directory, 'client')
    await mkdir(staticDirectory, { recursive: true })
    await writeFile(resolve(staticDirectory, 'index.html'), '<!doctype html><title>IDOSI VPS</title>')
    const { server, runtime } = createIdosiServer({
      databasePath: resolve(directory, 'idosi.sqlite'),
      imagesDirectory: resolve(directory, 'images'),
      staticDirectory,
      bootstrapToken: 'bootstrap-test-token',
    })
    await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen))
    const address = server.address()
    const baseUrl = `http://127.0.0.1:${address.port}`
    try {
      const health = await fetch(`${baseUrl}/api/health`).then((response) => response.json())
      expect(health).toMatchObject({ ok: true, databaseConfigured: true, identityImageStorageConfigured: true })

      const bootstrapResponse = await fetch(`${baseUrl}/api/bootstrap`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-idosi-bootstrap-token': 'bootstrap-test-token' },
        body: JSON.stringify({
          username: 'admin-vps',
          password: 'secure-vps-password',
          displayName: 'Admin VPS',
          initialState: {},
        }),
      })
      expect(bootstrapResponse.status).toBe(201)
      const persistedDefaults = (await runtime.database.prepare(`
        SELECT value_json FROM state_entities
        WHERE scope_key = 'global' AND collection_key = 'orderInformationOptions'
        ORDER BY entity_order, entity_key
      `).all()).results.map(({ value_json: valueJson }) => JSON.parse(valueJson))
      expect(persistedDefaults).toHaveLength(17)
      expect(persistedDefaults.filter(({ kind }) => kind === 'occupation')).toHaveLength(15)
      expect(persistedDefaults.filter(({ kind }) => kind === 'payment_method')).toEqual([
        expect.objectContaining({ id: 'order-payment-001', label: 'Tiền mặt', system: true }),
        expect.objectContaining({ id: 'order-payment-002', label: 'Chuyển khoản', system: true }),
      ])
      const bootstrapAudit = await runtime.database.prepare(`
        SELECT metadata_json FROM audit_log WHERE action = 'system.bootstrap'
      `).first()
      expect(JSON.parse(bootstrapAudit.metadata_json)).toMatchObject({
        orderInformationDefaults: { persisted: true, canonicalSeedCount: 17 },
      })

      const loginResponse = await fetch(`${baseUrl}/api/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: 'admin-vps', password: 'secure-vps-password' }),
      })
      const login = await loginResponse.json()
      expect(loginResponse.status).toBe(200)
      expect(login.user).toMatchObject({ username: 'admin-vps', role: 'admin' })

      const bootstrapAgain = await fetch(`${baseUrl}/api/bootstrap`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-idosi-bootstrap-token': 'wrong-token' },
        body: JSON.stringify({ username: 'other-admin', password: 'another-password' }),
      }).then((response) => response.json())
      expect(bootstrapAgain).toMatchObject({ ok: true, initialized: true, alreadyInitialized: true })

      expect(await fetch(`${baseUrl}/employee/home`).then((response) => response.text()))
        .toContain('IDOSI VPS')
      expect(await readFile(resolve(staticDirectory, 'index.html'), 'utf8')).toContain('IDOSI VPS')
    } finally {
      await new Promise((resolveClose) => server.close(resolveClose))
    }
  })

  it('persists daily Office attendance snapshots through the Worker and SQLite adapter', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-08-24T01:35:00.000Z')) // 08:35 Vietnam
    let server
    try {
      const directory = await temporaryDirectory()
      const staticDirectory = resolve(directory, 'client')
      const databasePath = resolve(directory, 'idosi.sqlite')
      const employeeId = 'VP-VPS-001'
      const workDate = vietnamWorkDate()
      await mkdir(staticDirectory, { recursive: true })
      await writeFile(resolve(staticDirectory, 'index.html'), '<!doctype html><title>IDOSI VPS</title>')
      const created = createIdosiServer({
        databasePath,
        imagesDirectory: resolve(directory, 'images'),
        staticDirectory,
        bootstrapToken: 'bootstrap-daily-attendance',
      })
      server = created.server
      const { runtime } = created
      await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen))
      const address = server.address()
      const baseUrl = `http://127.0.0.1:${address.port}`
      const bootstrap = await postJson(baseUrl, '/api/bootstrap', {
        username: 'admin-daily-vps',
        password: 'daily-vps-admin-password',
        displayName: 'Admin Daily VPS',
        initialState: {
          stores: [],
          employees: [{
            id: employeeId,
            code: employeeId,
            name: 'Nhân viên văn phòng VPS',
            storeId: 'OFFICE',
            unit: 'office',
            status: 'Đang làm việc',
            employmentType: 'Full-Time',
            monthlySalary: 12_000_000,
            requiredWorkingDays: 26,
            workTimeType: 'Full-Time',
            workStart: '08:00',
            workEnd: '17:30',
            workShifts: [{ id: 'full_time', name: 'Giờ hành chính', start: '08:00', end: '17:30' }],
          }],
          attendance: [],
          schedule: [],
          shiftDefinitions: [],
          supportWorkSchedules: [],
          supportWorkScheduleHistory: [],
          notifications: [],
        },
      }, { 'x-idosi-bootstrap-token': 'bootstrap-daily-attendance' })
      expect(bootstrap.response.status).toBe(201)

      const adminLogin = await postJson(baseUrl, '/api/login', {
        username: 'admin-daily-vps', password: 'daily-vps-admin-password',
      })
      expect(adminLogin.response.status).toBe(200)
      const adminHeaders = { authorization: `Bearer ${adminLogin.body.token}` }

      const userCreated = await postJson(baseUrl, '/api/command', {
        type: 'user.create',
        payload: {
          username: 'office.daily.vps',
          password: 'office-daily-vps-password',
          displayName: 'Nhân viên văn phòng VPS',
          role: 'employee',
          storeId: 'OFFICE',
          employeeId,
        },
      }, { ...adminHeaders, 'idempotency-key': 'vps-daily-attendance-user' })
      expect(userCreated.response.status).toBe(201)

      const assigned = await postJson(baseUrl, '/api/command', {
        type: 'support_schedule.assign',
        expectedVersion: 1,
        payload: {
          targetUnit: 'office',
          employeeId,
          date: workDate,
          shiftName: 'Lịch riêng VPS',
          start: '00:00',
          end: '23:59',
          note: 'Kiểm thử Worker qua SQLite',
        },
      }, { ...adminHeaders, 'idempotency-key': 'vps-daily-attendance-schedule' })
      expect(assigned.response.status).toBe(200)
      expect(assigned.body.schedule).toMatchObject({ employeeId, date: workDate, start: '00:00', end: '23:59' })

      const employeeLogin = await postJson(baseUrl, '/api/login', {
        username: 'office.daily.vps', password: 'office-daily-vps-password',
      })
      expect(employeeLogin.response.status).toBe(200)
      const checkedIn = await postJson(baseUrl, '/api/command', {
        type: 'attendance.check_in',
        expectedVersion: 2,
        payload: {
          shiftId: assigned.body.schedule.id,
          location: { latitude: 10.8231, longitude: 106.6297, accuracy: 8, label: 'Văn phòng IDOSI' },
        },
      }, {
        authorization: `Bearer ${employeeLogin.body.token}`,
        'idempotency-key': 'vps-daily-attendance-check-in',
      })
      expect(checkedIn.response.status).toBe(201)
      expect(checkedIn.body.attendance).toMatchObject({
        employeeId,
        workDate,
        shiftId: assigned.body.schedule.id,
        shiftName: 'Lịch riêng VPS',
        shiftStart: '00:00',
        shiftEnd: '23:59',
        shiftVersion: 1,
        shiftSource: 'support-daily-schedule',
        monthlySalarySnapshot: 12_000_000,
        requiredWorkingDaysSnapshot: 26,
        workdayCredit: 0,
        checkInLocation: { latitude: 10.8231, longitude: 106.6297 },
      })

      const storedRows = await runtime.database.prepare(`
        SELECT value_json FROM state_entities
        WHERE scope_key = ? AND collection_key = ?
        ORDER BY entity_order
      `).bind('global', 'attendance').all()
      expect(storedRows.results.map(({ value_json: valueJson }) => JSON.parse(valueJson))).toEqual([
        expect.objectContaining({
          id: checkedIn.body.attendance.id,
          employeeId,
          workDate,
          shiftId: assigned.body.schedule.id,
          shiftStart: '00:00',
          shiftEnd: '23:59',
          shiftSource: 'support-daily-schedule',
        }),
      ])
    } finally {
      if (server?.listening) await new Promise((resolveClose) => server.close(resolveClose))
      vi.useRealTimers()
    }
  }, 90_000)

  it('runs effective Office and Business Support attendance through Worker HTTP and SQLite payroll', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-08-24T01:35:00.000Z')) // 08:35 Vietnam
    let server
    try {
      const directory = await temporaryDirectory()
      const staticDirectory = resolve(directory, 'client')
      const databasePath = resolve(directory, 'idosi.sqlite')
      const workDate = '2026-08-24'
      const officeId = 'VP-VPS-EFFECTIVE'
      const supportId = 'HTKD-VPS-EFFECTIVE'
      await mkdir(staticDirectory, { recursive: true })
      await writeFile(resolve(staticDirectory, 'index.html'), '<!doctype html><title>IDOSI VPS</title>')
      const created = createIdosiServer({
        databasePath,
        imagesDirectory: resolve(directory, 'images'),
        staticDirectory,
        bootstrapToken: 'bootstrap-effective-attendance',
      })
      server = created.server
      const { runtime } = created
      await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen))
      const address = server.address()
      const baseUrl = `http://127.0.0.1:${address.port}`
      const location = { latitude: 10.8231, longitude: 106.6297, accuracy: 8, label: 'Văn phòng IDOSI' }
      const bootstrap = await postJson(baseUrl, '/api/bootstrap', {
        username: 'admin-effective-vps',
        password: 'effective-vps-admin-password',
        displayName: 'Admin Effective VPS',
        initialState: {
          stores: [],
          employees: [{
            id: officeId,
            code: officeId,
            name: 'Nhân viên văn phòng hiệu lực',
            storeId: 'OFFICE',
            unit: 'office',
            status: 'Đang làm việc',
            employmentType: 'Full-Time',
            payBasis: 'monthly',
            monthlySalary: 12_000_000,
            standardWorkDays: 20,
            monthlyWorkdayTargets: { '2026-08': 20 },
            workTimeType: 'Full-Time',
            workStart: '08:00',
            workEnd: '17:30',
            workShifts: [{ id: 'office_old', name: 'Giờ văn phòng cũ', start: '08:00', end: '17:30' }],
            workTimeSchedule: [{
              effectiveFrom: workDate,
              employmentType: 'Full-Time',
              workTimeType: 'Full-Time',
              workShifts: [{ id: 'office_effective', name: 'Giờ văn phòng 08:30', start: '08:30', end: '17:00' }],
              source: 'fixture',
            }],
          }, {
            id: supportId,
            code: supportId,
            name: 'Nhân viên hỗ trợ hiệu lực',
            storeId: 'BUSINESS_SUPPORT',
            unit: 'business_support',
            status: 'Đang làm việc',
            employmentType: 'Full-Time',
            payBasis: 'monthly',
            monthlySalary: 12_000_000,
            standardWorkDays: 20,
            monthlyWorkdayTargets: { '2026-08': 20 },
            workTimeType: 'Full-Time',
            workStart: '08:00',
            workEnd: '17:30',
            workShifts: [{ id: 'support_old', name: 'Giờ hỗ trợ cũ', start: '08:00', end: '17:30' }],
            workTimeSchedule: [{
              effectiveFrom: workDate,
              employmentType: 'Full-Time',
              workTimeType: 'Full-Time',
              workShifts: [{ id: 'support_effective', name: 'Giờ hỗ trợ 08:30', start: '08:30', end: '17:00' }],
              source: 'fixture',
            }],
          }],
          attendance: [],
          schedule: [],
          shiftDefinitions: [],
          supportWorkSchedules: [],
          payrollPeriods: [],
          salaryAdjustments: [],
          salaryAdvances: [],
          orders: [],
          expenseEntries: [],
        },
      }, { 'x-idosi-bootstrap-token': 'bootstrap-effective-attendance' })
      expect(bootstrap.response.status).toBe(201)

      const adminLogin = await postJson(baseUrl, '/api/login', {
        username: 'admin-effective-vps', password: 'effective-vps-admin-password',
      })
      expect(adminLogin.response.status).toBe(200)
      const adminHeaders = { authorization: `Bearer ${adminLogin.body.token}` }

      for (const account of [{
        username: 'office.effective.vps',
        password: 'office-effective-vps-password',
        displayName: 'Nhân viên văn phòng hiệu lực',
        role: 'employee',
        storeId: 'OFFICE',
        employeeId: officeId,
      }, {
        username: 'support.effective.vps',
        password: 'support-effective-vps-password',
        displayName: 'Nhân viên hỗ trợ hiệu lực',
        role: 'business_support',
        storeId: 'BUSINESS_SUPPORT',
        employeeId: supportId,
      }]) {
        const created = await postJson(baseUrl, '/api/command', {
          type: 'user.create', payload: account,
        }, { ...adminHeaders, 'idempotency-key': `vps-effective-user-${account.employeeId}` })
        expect(created.response.status).toBe(201)
      }

      const retiredOfficeWorkingTime = await postJson(baseUrl, '/api/command', {
        type: 'employee.working_time.set',
        expectedVersion: 1,
        payload: {
          employeeId: officeId,
          effectiveFrom: workDate,
          workTimeType: 'Full-Time',
          workShifts: [{ id: 'office_effective', name: 'Giờ văn phòng 08:30', start: '08:30', end: '17:00' }],
        },
      }, { ...adminHeaders, 'idempotency-key': 'vps-effective-office-working-time' })
      expect(retiredOfficeWorkingTime.response.status).toBe(410)
      expect(retiredOfficeWorkingTime.body).toMatchObject({ error: { code: 'COMMAND_RETIRED' } })

      const retiredSupportWorkingTime = await postJson(baseUrl, '/api/command', {
        type: 'employee.working_time.set',
        expectedVersion: 1,
        payload: {
          employeeId: supportId,
          effectiveFrom: workDate,
          workTimeType: 'Full-Time',
          workShifts: [{ id: 'support_effective', name: 'Giờ hỗ trợ 08:30', start: '08:30', end: '17:00' }],
        },
      }, { ...adminHeaders, 'idempotency-key': 'vps-effective-support-working-time' })
      expect(retiredSupportWorkingTime.response.status).toBe(410)
      expect(retiredSupportWorkingTime.body).toMatchObject({ error: { code: 'COMMAND_RETIRED' } })

      const officeLogin = await postJson(baseUrl, '/api/login', {
        username: 'office.effective.vps', password: 'office-effective-vps-password',
      })
      const supportLogin = await postJson(baseUrl, '/api/login', {
        username: 'support.effective.vps', password: 'support-effective-vps-password',
      })
      expect(officeLogin.response.status).toBe(200)
      expect(supportLogin.response.status).toBe(200)
      const officeHeaders = { authorization: `Bearer ${officeLogin.body.token}` }
      const supportHeaders = { authorization: `Bearer ${supportLogin.body.token}` }

      const officeCheckIn = await postJson(baseUrl, '/api/command', {
        type: 'attendance.check_in',
        expectedVersion: 1,
        payload: { shiftId: 'office_old', location },
      }, { ...officeHeaders, 'idempotency-key': 'vps-effective-office-check-in' })
      expect(officeCheckIn.response.status).toBe(201)
      expect(officeCheckIn.body.attendance).toMatchObject({
        employeeId: officeId,
        workDate,
        shiftId: 'office_effective',
        shiftName: 'Giờ văn phòng 08:30',
        shiftStart: '08:30',
        shiftEnd: '17:00',
        shiftSource: 'profile-work-shift',
        checkInAt: '2026-08-24T01:35:00.000Z',
        checkInLocation: { latitude: 10.8231, longitude: 106.6297 },
      })

      const supportCheckIn = await postJson(baseUrl, '/api/command', {
        type: 'attendance.check_in',
        expectedVersion: 2,
        payload: { shiftId: 'support_old', location },
      }, { ...supportHeaders, 'idempotency-key': 'vps-effective-support-check-in' })
      expect(supportCheckIn.response.status).toBe(201)
      expect(supportCheckIn.body.attendance).toMatchObject({
        employeeId: supportId,
        workDate,
        shiftId: 'support_effective',
        shiftName: 'Giờ hỗ trợ 08:30',
        shiftStart: '08:30',
        shiftEnd: '17:00',
        shiftSource: 'profile-work-shift',
        checkInAt: '2026-08-24T01:35:00.000Z',
        checkInLocation: { latitude: 10.8231, longitude: 106.6297 },
      })

      const persistedCheckIns = await runtime.database.prepare(`
        SELECT value_json FROM state_entities
        WHERE scope_key = ? AND collection_key = ?
        ORDER BY entity_order
      `).bind('global', 'attendance').all()
      const persistedCheckInRows = persistedCheckIns.results.map(({ value_json: valueJson }) => JSON.parse(valueJson))
      expect(persistedCheckInRows).toHaveLength(2)
      expect(persistedCheckInRows).toEqual(expect.arrayContaining([
        expect.objectContaining({
          employeeId: officeId,
          shiftId: 'office_effective',
          shiftStart: '08:30',
          shiftEnd: '17:00',
        }),
        expect.objectContaining({
          employeeId: supportId,
          shiftId: 'support_effective',
          shiftStart: '08:30',
          shiftEnd: '17:00',
        }),
      ]))

      vi.setSystemTime(new Date('2026-08-24T10:00:00.000Z')) // 17:00 Vietnam
      const officeCheckOut = await postJson(baseUrl, '/api/command', {
        type: 'attendance.check_out',
        expectedVersion: 3,
        payload: { attendanceId: officeCheckIn.body.attendance.id, location },
      }, { ...officeHeaders, 'idempotency-key': 'vps-effective-office-check-out' })
      expect(officeCheckOut.response.status).toBe(200)
      expect(officeCheckOut.body.attendance).toMatchObject({
        shiftId: 'office_effective', shiftStart: '08:30', shiftEnd: '17:00', workdayCredit: 1,
      })

      const supportCheckOut = await postJson(baseUrl, '/api/command', {
        type: 'attendance.check_out',
        expectedVersion: 4,
        payload: { attendanceId: supportCheckIn.body.attendance.id, location },
      }, { ...supportHeaders, 'idempotency-key': 'vps-effective-support-check-out' })
      expect(supportCheckOut.response.status).toBe(200)
      expect(supportCheckOut.body.attendance).toMatchObject({
        shiftId: 'support_effective', shiftStart: '08:30', shiftEnd: '17:00', workdayCredit: 1,
      })

      const duplicate = await postJson(baseUrl, '/api/command', {
        type: 'attendance.check_in',
        expectedVersion: 5,
        payload: { shiftId: 'office_old', location },
      }, { ...officeHeaders, 'idempotency-key': 'vps-effective-office-duplicate' })
      expect(duplicate.response.status).toBe(409)
      expect(duplicate.body).toMatchObject({ error: { code: 'OFFICE_ATTENDANCE_ALREADY_RECORDED' } })

      const officePayroll = await postJson(baseUrl, '/api/command', {
        type: 'payroll.close', expectedVersion: 5, payload: { storeId: 'OFFICE', period: '2026-08' },
      }, { ...adminHeaders, 'idempotency-key': 'vps-effective-office-payroll' })
      expect(officePayroll.response.status).toBe(201)
      expect(officePayroll.body.period.rows).toEqual([
        expect.objectContaining({
          employeeId: officeId,
          workedDays: 1,
          requiredWorkingDays: 20,
          baseSalary: 600_000,
          gross: 600_000,
        }),
      ])

      const supportPayroll = await postJson(baseUrl, '/api/command', {
        type: 'payroll.close', expectedVersion: 6, payload: { storeId: 'BUSINESS_SUPPORT', period: '2026-08' },
      }, { ...adminHeaders, 'idempotency-key': 'vps-effective-support-payroll' })
      expect(supportPayroll.response.status).toBe(201)
      expect(supportPayroll.body.period.rows).toEqual([
        expect.objectContaining({
          employeeId: supportId,
          workedDays: 1,
          requiredWorkingDays: 20,
          baseSalary: 600_000,
          gross: 600_000,
        }),
      ])

      const persistedAttendance = await runtime.database.prepare(`
        SELECT value_json FROM state_entities
        WHERE scope_key = ? AND collection_key = ?
        ORDER BY entity_order
      `).bind('global', 'attendance').all()
      const persistedAttendanceRows = persistedAttendance.results.map(({ value_json: valueJson }) => JSON.parse(valueJson))
      expect(persistedAttendanceRows).toHaveLength(2)
      expect(persistedAttendanceRows).toEqual(expect.arrayContaining([
        expect.objectContaining({
          employeeId: officeId,
          shiftId: 'office_effective',
          shiftStart: '08:30',
          shiftEnd: '17:00',
          workdayCredit: 1,
        }),
        expect.objectContaining({
          employeeId: supportId,
          shiftId: 'support_effective',
          shiftStart: '08:30',
          shiftEnd: '17:00',
          workdayCredit: 1,
        }),
      ]))

      const persistedPayroll = await runtime.database.prepare(`
        SELECT value_json FROM state_entities
        WHERE scope_key = ? AND collection_key = ?
        ORDER BY entity_order
      `).bind('global', 'payrollPeriods').all()
      const persistedPayrollPeriods = persistedPayroll.results.map(({ value_json: valueJson }) => JSON.parse(valueJson))
      expect(persistedPayrollPeriods).toHaveLength(2)
      expect(persistedPayrollPeriods).toEqual(expect.arrayContaining([
        expect.objectContaining({
          storeId: 'OFFICE',
          period: '2026-08',
          rows: [expect.objectContaining({ employeeId: officeId, workedDays: 1, gross: 600_000 })],
        }),
        expect.objectContaining({
          storeId: 'BUSINESS_SUPPORT',
          period: '2026-08',
          rows: [expect.objectContaining({ employeeId: supportId, workedDays: 1, gross: 600_000 })],
        }),
      ]))
    } finally {
      if (server?.listening) await new Promise((resolveClose) => server.close(resolveClose))
      vi.useRealTimers()
    }
  }, 90_000)
})
