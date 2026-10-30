// Real Chromium tabs/contexts + React + HTTP + isolated SQLite; never production.
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createServer } from 'vite'
import { createIdosiServer } from '../server/vps/server.mjs'
import { DEFAULT_ORDER_INFORMATION_OPTIONS } from '../src/domain/orderInformationSettings.js'

const playwrightPath = process.env.IDOSI_PLAYWRIGHT_MODULE
const { chromium } = await import(playwrightPath ? pathToFileURL(resolve(playwrightPath)).href : 'playwright')
const directory = await mkdtemp(resolve(tmpdir(), 'idosi-customer-browser-'))
const output = resolve(process.env.IDOSI_BROWSER_OUTPUT || directory, 'customer-cross-tab-evidence')
await mkdir(output, { recursive: true })
const { server, runtime } = createIdosiServer({ databasePath: resolve(directory, 'state.sqlite'),
  imagesDirectory: resolve(directory, 'images'), bootstrapToken: 'customer-browser', automaticRevenueBonusEnabled: false })
await new Promise((done) => server.listen(0, '127.0.0.1', done))
const apiBase = `http://127.0.0.1:${server.address().port}`
const vite = await createServer({ server: { host: '127.0.0.1', port: 0, proxy: { '/api': apiBase } } })
await vite.listen()
const base = `http://127.0.0.1:${vite.httpServer.address().port}`
const browser = await chromium.launch({ headless: true })
const evidence = [], errors = []
const password = 'Synthetic-customer-browser-password'
const phoneA = '0900000101', phoneB = '0900000202'
const post = async (path, body, token = '', headers = {}) => {
  const response = await fetch(`${apiBase}${path}`, { method: 'POST', headers: { 'content-type': 'application/json',
    ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers }, body: JSON.stringify(body) })
  const result = await response.json()
  assert.ok(response.ok, JSON.stringify(result))
  return result
}
try {
  await post('/api/bootstrap', { username: 'customer.admin', password, initialState: {
    stores: [{ id: 'S1', name: 'Reader store' }, { id: 'S2', name: 'Writer store' }],
    employees: [{ id: 'M1', name: 'Reader manager', storeId: 'S1', unit: 'store_manager', status: 'Đang làm việc' }],
    orderInformationOptions: DEFAULT_ORDER_INFORMATION_OPTIONS,
    orders: [{ id: 'A1', code: 'A1', storeId: 'S1', customerName: 'Customer A', customerPhone: phoneA, amount: 100000, status: 'Hoàn tất' },
      { id: 'B1', code: 'B1', storeId: 'S1', customerName: 'Customer B', customerPhone: phoneB, amount: 100000, status: 'Hoàn tất' }],
  } }, '', { 'x-idosi-bootstrap-token': 'customer-browser' })
  const admin = (await post('/api/login', { username: 'customer.admin', password })).token
  const command = (type, payload) => post('/api/command', { type, payload, includeState: false,
    expectedVersion: runtime.database.database.prepare("SELECT version FROM app_state WHERE scope_key='global'").get().version }, admin,
  { 'idempotency-key': crypto.randomUUID() })
  await command('user.create', { username: 'customer.manager', password, displayName: 'Reader manager',
    role: 'store_manager', storeId: 'S1', employeeId: 'M1' })
  const manager = (await post('/api/login', { username: 'customer.manager', password })).token
  const contextFor = async (token) => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
    await context.addInitScript((value) => sessionStorage.setItem('idosi-api-session-v1', value), token)
    return context
  }
  const adminContext = await contextFor(admin)
  const managerContext = await contextFor(manager) // Separate device/session: no shared hints.
  const adminTab1 = await adminContext.newPage(), adminTab2 = await adminContext.newPage()
  const remoteStore = await managerContext.newPage()
  const pages = [adminTab1, adminTab2, remoteStore]
  for (const page of pages) page.on('pageerror', (error) => errors.push(error.message))
  await Promise.all(pages.map((page) => page.goto(`${base}/#/${page === remoteStore ? 'store' : 'admin'}/customer-lookup`)))
  const table = (page) => page.getByRole('table', { name: 'Danh sách khách hàng' })
  const row = (page, name) => table(page).getByRole('row').filter({ has: page.getByText(name, { exact: true }) })
  const tag = async (page, name, returning) => {
    await row(page, name).getByText(returning ? 'KH cũ' : 'KH mới', { exact: true }).waitFor({ timeout: 12000 })
  }
  for (const page of pages) { await page.bringToFront(); await tag(page, 'Customer A', false) }
  await remoteStore.bringToFront()
  await row(remoteStore, 'Customer A').getByRole('button', { name: 'Lịch sử mua hàng (1)' }).click()
  await remoteStore.getByRole('dialog').getByText('1 đơn hàng', { exact: true }).waitFor()
  const verify = async (name, returningA, returningB, countA) => {
    // No navigation/reload/click on refresh after the initial route load.
    // The manager stays visible during the remote mutation and must poll it.
    await tag(remoteStore, 'Customer A', returningA)
    await tag(remoteStore, 'Customer B', returningB)
    await remoteStore.getByRole('dialog').getByText(`${countA} đơn hàng`, { exact: true }).waitFor({ timeout: 12000 })
    for (const page of [adminTab1, adminTab2]) {
      await page.bringToFront() // Also proves frozen/background-tab recovery.
      await tag(page, 'Customer A', returningA)
      await tag(page, 'Customer B', returningB)
    }
    evidence.push({ step: name, customerA: returningA ? 'KH cũ' : 'KH mới', customerB: returningB ? 'KH cũ' : 'KH mới', countA })
    await adminTab2.screenshot({ path: resolve(output, `${evidence.length}-${name}.png`), fullPage: true })
    await remoteStore.bringToFront()
  }
  const created = await command('order.create', { storeId: 'S2', customerName: 'Customer A', customerPhone: phoneA,
    amount: 100000, gender: 'Nam', occupation: 'Kỹ sư', acquisitionChannel: 'Facebook', paymentMethod: 'Tiền mặt',
    items: [{ productId: 'order-product-001', quantity: 1 }] })
  await verify('cross-store-create', true, false, 2)
  await command('order.update', { orderId: created.order.id, customerName: 'Customer B', customerPhone: phoneB, reason: 'Synthetic customer correction' })
  await verify('move-to-customer-b', false, true, 1)
  await command('order.update', { orderId: created.order.id, customerName: 'Customer A', customerPhone: phoneA, reason: 'Synthetic correction back' })
  await verify('move-back-to-customer-a', true, false, 2)
  await command('order.delete', { orderId: created.order.id, reason: 'Synthetic deletion' })
  await verify('cross-store-delete', false, false, 1)
  // Prove native same-browser delivery independently of polling: hold this
  // reader's metadata token fixed, then invoke the actual publisher in a peer.
  const fixedVersion = runtime.database.database.prepare("SELECT version FROM app_state WHERE scope_key='global'").get().version
  await adminTab2.route('**/api/state-metadata?*', (route) => route.fulfill({ contentType: 'application/json',
    body: JSON.stringify({ ok: true, version: fixedVersion, customerVersion: fixedVersion, userVersion: 1, policyVersions: {} }) }))
  const baseline = adminTab2.waitForResponse((response) => response.url().includes('/api/state-metadata?') && response.url().includes('customers=1'))
  await adminTab2.bringToFront()
  await adminTab2.evaluate(() => window.dispatchEvent(new Event('focus')))
  await baseline
  await tag(adminTab2, 'Customer A', false)
  await adminTab2.evaluate(() => new Promise(requestAnimationFrame))
  const native = await command('order.create', { storeId: 'S2', customerName: 'Customer A', customerPhone: phoneA,
    amount: 100000, gender: 'Nam', occupation: 'Kỹ sư', acquisitionChannel: 'Facebook', paymentMethod: 'Tiền mặt',
    items: [{ productId: 'order-product-001', quantity: 1 }] })
  await adminTab1.evaluate(async () => (await import('/src/services/customerLookupSync.js')).publishCustomerOrderChange())
  await row(adminTab2, 'Customer A').getByText('KH cũ', { exact: true }).waitFor({ timeout: 4000 })
  evidence.push({ step: 'native-broadcast-with-frozen-poll-token', customerA: 'KH cũ', countA: 2 })
  await adminTab2.screenshot({ path: resolve(output, '5-native-broadcast.png'), fullPage: true })
  await adminTab2.unroute('**/api/state-metadata?*')
  await remoteStore.bringToFront()
  await command('order.delete', { orderId: native.order.id, reason: 'Synthetic native broadcast cleanup' })
  await verify('native-broadcast-cleanup', false, false, 1)
  assert.deepEqual(errors, [])
  await writeFile(resolve(output, 'result.json'), JSON.stringify({ ok: true, isolated: true, tabs: 3, contexts: 2,
    manualReloads: 0, pollIntervalMs: 5000, evidence, errors }, null, 2))
  console.log(JSON.stringify({ ok: true, output, evidence }))
} catch (error) {
  for (const [index, page] of browser.contexts().flatMap((context) => context.pages()).entries()) {
    await page.screenshot({ path: resolve(output, `failure-${index}.png`), fullPage: true }).catch(() => {})
  }
  throw error
} finally {
  await browser.close()
  await vite.close()
  await new Promise((done) => server.close(done))
  assert.ok(directory.startsWith(`${resolve(tmpdir())}${sep}`) && basename(directory).startsWith('idosi-customer-browser-'))
  await rm(directory, { recursive: true, force: true })
}
