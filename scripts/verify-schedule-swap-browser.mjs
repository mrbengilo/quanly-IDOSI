// Real browser + React + HTTP + temporary SQLite. Run after npm ci.
// Set IDOSI_PLAYWRIGHT_MODULE to an installed playwright module URL/path.
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createServer } from 'vite'
import { createIdosiServer } from '../server/vps/server.mjs'
import { STAFF_WORK_CATALOG_SEED_VERSION } from '../src/domain/compensationPolicies.js'
import { vietnamScheduleDate } from '../src/pages/store/scheduleView.js'

const modulePath = process.env.IDOSI_PLAYWRIGHT_MODULE
const { chromium } = await import(modulePath ? pathToFileURL(resolve(modulePath)).href : 'playwright')
const directory = await mkdtemp(resolve(tmpdir(), 'idosi-swap-browser-'))
const output = resolve(process.env.IDOSI_BROWSER_OUTPUT || directory, 'schedule-swap-evidence')
await mkdir(output, { recursive: true })
const { server, runtime } = createIdosiServer({ databasePath: resolve(directory, 'fixture.sqlite'),
  imagesDirectory: resolve(directory, 'images'), bootstrapToken: 'browser-swap-fixture', automaticRevenueBonusEnabled: false })
await new Promise((done) => server.listen(0, '127.0.0.1', done))
const apiBase = `http://127.0.0.1:${server.address().port}`
const vite = await createServer({ server: { host: '127.0.0.1', port: 0, proxy: { '/api': apiBase } } })
await vite.listen()
const base = `http://127.0.0.1:${vite.httpServer.address().port}`
const browser = await chromium.launch({ headless: true })
const date = vietnamScheduleDate()
const tomorrow = new Date(`${date}T12:00:00Z`); tomorrow.setUTCDate(tomorrow.getUTCDate() + 1)
const nextDate = tomorrow.toISOString().slice(0, 10)
const errors = [], evidence = [], expectedMissingAvatars = []
const post = async (path, body, headers = {}) => {
  const response = await fetch(`${apiBase}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) })
  const data = await response.json(); assert.ok(response.ok, JSON.stringify(data)); return data
}
try {
  const shifts = [['AM', 'Ca sáng kiểm thử', '08:00', '12:00'], ['PM', 'Ca chiều kiểm thử', '12:00', '16:00'], ['EV', 'Ca tối bổ sung', '16:00', '18:00'], ['LATE', 'Ca cuối ngày bổ sung', '18:00', '20:00']]
    .map(([id, name, start, end]) => ({ id, name, start, end, storeId: 'STORE', active: true }))
  const employees = ['A', 'B'].map((id) => ({ id, code: `CODE-${id}`, name: `Nhân viên kiểm thử tên dài ${id} Nguyễn Thị Minh Anh`, storeId: 'STORE', unit: 'store', status: 'Đang làm việc' }))
  await post('/api/bootstrap', { username: 'browser.admin', password: 'Synthetic-browser-password', initialState: {
    staffWorkCatalogSeedVersion: STAFF_WORK_CATALOG_SEED_VERSION,
    stores: [{ id: 'STORE', name: 'Cửa hàng kiểm thử đổi ca', short: 'TEST' }], employees: [...employees,
      { id: 'M', name: 'Quản lý kiểm thử', storeId: 'STORE', unit: 'store_manager', status: 'Đang làm việc' }],
    shiftDefinitions: shifts, attendance: [], tasks: [], orders: [], supportTransfers: [], workCatalogItems: [],
    schedule: [date, nextDate].flatMap((workDate) => employees.map((employee, index) => {
      const selected = workDate === date ? [shifts[index]] : [shifts[index], shifts[index + 2]]
      return { id: `${employee.id}-${workDate}`, employeeId: employee.id, storeId: 'STORE', date: workDate,
        shiftId: selected[0].id, shiftIds: selected.map((shift) => shift.id), shiftSnapshots: selected }
    })),
  } }, { 'x-idosi-bootstrap-token': 'browser-swap-fixture' })
  const insert = runtime.database.database.prepare(`INSERT INTO users(id, username, username_normalized, display_name, password_hash, password_salt,
    password_iterations, password_algorithm, role, status, store_id, employee_id, password_updated_at, created_at, updated_at)
    SELECT ?, ?, ?, ?, password_hash, password_salt, password_iterations, password_algorithm, ?, 'active', 'STORE', ?,
    password_updated_at, created_at, updated_at FROM users WHERE username='browser.admin'`)
  for (const [id, role] of [['M', 'store_manager'], ['A', 'employee'], ['B', 'employee']]) insert.run(id, `browser.${id}`.toLowerCase(), `browser.${id}`.toLowerCase(), id, role, id)
  const pageFor = async (id) => {
    const { token } = await post('/api/login', { username: `browser.${id}`.toLowerCase(), password: 'Synthetic-browser-password' })
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
    await context.addInitScript((value) => sessionStorage.setItem('idosi-api-session-v1', value), token)
    const page = await context.newPage()
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('response', (response) => {
      if (response.status() === 404 && response.url().includes('/api/account-avatars/')) expectedMissingAvatars.push(response.url())
      else if (response.status() >= 400 && response.url().includes('/api/')) errors.push(`${response.status()} ${response.url()}`)
    })
    return page
  }
  const page = await pageFor('M')
  await page.goto(`${base}/#/store/schedule`)
  await page.getByRole('tab', { name: 'Theo ngày', exact: true }).focus()
  await page.keyboard.press('End')
  assert.equal(await page.getByRole('tab', { name: 'Đổi ca' }).getAttribute('aria-selected'), 'true')
  await page.getByLabel('Chọn nhân viên A').selectOption('A')
  await page.getByLabel('Chọn nhân viên B').selectOption('B')
  for (const width of [375, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 })
    const geometry = await page.locator('.schedule-swap').evaluate((panel) => {
      const bounds = panel.getBoundingClientRect()
      const controls = [...panel.querySelectorAll('select, button')].map((element) => {
        const rect = element.getBoundingClientRect(); return { width: rect.width, left: rect.left, right: rect.right }
      })
      return { viewport: innerWidth, scrollWidth: document.documentElement.scrollWidth, left: bounds.left, right: bounds.right, controls }
    })
    assert.ok(geometry.scrollWidth <= width + 1, JSON.stringify(geometry))
    assert.ok(geometry.controls.every((control) => control.width > 40 && control.left >= 0 && control.right <= width + 1), JSON.stringify(geometry))
    await page.getByLabel('Ca cần đổi của B').focus(); await page.keyboard.press('Tab')
    assert.equal(await page.getByRole('button', { name: 'Đổi ca', exact: true }).evaluate((element) => element === document.activeElement), true)
    await page.getByRole('button', { name: 'Đổi ca', exact: true }).click({ trial: true })
    await page.screenshot({ path: resolve(output, `swap-${width}.png`), fullPage: true, animations: 'disabled' })
    evidence.push({ width, geometry, keyboardSubmitFocus: true })
  }
  await page.getByRole('button', { name: 'Đổi ca', exact: true }).click()
  await page.getByText('Đã đổi ca thành công.', { exact: false }).waitFor()
  await page.reload()
  await page.getByRole('tab', { name: 'Đổi ca' }).click()
  await page.getByLabel('Chọn nhân viên A').selectOption('A')
  assert.equal(await page.getByLabel('Ca cần đổi của A').inputValue(), JSON.stringify([`A-${date}`, 'PM']))
  await page.getByLabel('Ngày phân ca', { exact: true }).fill(nextDate)
  await page.getByLabel('Chọn nhân viên A').selectOption('A')
  await page.getByLabel('Chọn nhân viên B').selectOption('B')
  assert.equal(await page.getByLabel('Ca cần đổi của A').inputValue(), '')
  assert.equal(await page.getByLabel('Ca cần đổi của B').inputValue(), '')
  await page.getByLabel('Ca cần đổi của A').selectOption(JSON.stringify([`A-${nextDate}`, 'AM']))
  await page.getByLabel('Ca cần đổi của B').selectOption(JSON.stringify([`B-${nextDate}`, 'PM']))
  await page.getByRole('button', { name: 'Đổi ca', exact: true }).click()
  await page.getByText('Đã đổi ca thành công.', { exact: false }).waitFor()
  for (const [id, expected, retained] of [['A', 'Ca chiều kiểm thử', 'Ca tối bổ sung'], ['B', 'Ca sáng kiểm thử', 'Ca cuối ngày bổ sung']]) {
    const employeePage = await pageFor(id)
    await employeePage.goto(`${base}/#/employee/schedule?date=${nextDate}`)
    await employeePage.getByText(expected, { exact: true }).first().waitFor()
    await employeePage.getByText(retained, { exact: true }).first().waitFor()
    await employeePage.reload(); await employeePage.getByText(expected, { exact: true }).first().waitFor()
    await employeePage.screenshot({ path: resolve(output, `employee-${id}.png`), fullPage: true })
  }
  const persisted = runtime.database.database.prepare("SELECT value_json FROM state_entities WHERE collection_key='schedule'").all().map((row) => JSON.parse(row.value_json))
  assert.deepEqual(persisted.find((row) => row.id === `A-${nextDate}`).shiftIds, ['PM', 'EV'])
  assert.deepEqual(persisted.find((row) => row.id === `B-${nextDate}`).shiftIds, ['AM', 'LATE'])
  assert.deepEqual(errors, [])
  await writeFile(resolve(output, 'results.json'), JSON.stringify({ status: 'PASS', evidence, errors, expectedMissingAvatars, singleAndMultipleSwap: true, employeeReload: ['A', 'B'] }, null, 2))
  console.log(JSON.stringify({ status: 'PASS', output, viewportWidths: [375, 768, 1440], singleAndMultipleSwap: true, employeeReload: ['A', 'B'] }))
} finally {
  await browser.close(); await vite.close(); await new Promise((done) => server.close(done))
  if (!output.startsWith(directory)) await rm(directory, { recursive: true, force: true })
}
