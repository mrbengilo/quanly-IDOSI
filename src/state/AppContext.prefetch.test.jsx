import { act, cleanup, render } from '@testing-library/react'
import { useLayoutEffect } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { AppProvider, useApp } from './AppContext'

const api = vi.hoisted(() => ({
  login: vi.fn(), bootstrap: vi.fn(), users: vi.fn(), store: vi.fn(), system: vi.fn(),
  command: vi.fn(), logout: vi.fn(), selectRole: vi.fn(),
  readCache: vi.fn(), writeCache: vi.fn(), clearCache: vi.fn(),
}))
vi.mock('../services/idosiApi', async (original) => ({
  ...await original(), hasApiSession: () => false, isLocalApiFallbackAllowed: () => false,
  apiLogin: api.login, apiBootstrapState: api.bootstrap, apiListUsers: api.users,
  apiGetStoreWorkspaceState: api.store, apiGetSystemScreenState: api.system,
  apiCommand: api.command, apiLogout: api.logout, apiSelectSessionRole: api.selectRole,
}))
vi.mock('../services/workspaceCache', () => ({
  readWorkspaceCache: api.readCache, writeWorkspaceCache: api.writeCache, clearWorkspaceCache: api.clearCache,
}))
const manager = { id: 'U1', employeeId: 'E1', role: 'store_manager', storeId: 'S1', homeStoreId: 'S1', version: 1 }
const admin = { id: 'UA', role: 'admin', version: 1 }
const state = {
  stores: [{ id: 'S1', name: 'Store 1' }, { id: 'S2', name: 'Store 2' }],
  employees: [{ id: 'E1', name: 'Manager', storeId: 'S1', unit: 'store_manager' }],
  orders: [],
}
const payload = (screen, user = manager, version = 1) => ({
  user, version, policies: [], screen, projection: user.role === 'store_manager' ? 'store' : 'global',
  ...(user.role === 'store_manager' ? { storeId: 'S1' } : {}),
  state: { ...state, orders: screen === 'orders' ? [{ id: `O${version}`, storeId: 'S1' }] : [] },
})
const deferred = () => {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
let app
const Probe = () => {
  const value = useApp()
  useLayoutEffect(() => { app = value }, [value])
  return null
}
const signIn = async (user = manager) => {
  api.login.mockResolvedValue({ user, bootstrap: payload('overview', user) })
  render(<AppProvider><Probe /></AppProvider>)
  await act(async () => { expect((await app.login('fixture', 'synthetic-only')).ok).toBe(true) })
  api.writeCache.mockClear()
}
beforeEach(() => {
  vi.resetAllMocks()
  sessionStorage.clear()
  localStorage.clear()
  window.history.replaceState({}, '', '/')
  api.readCache.mockResolvedValue(null)
  api.writeCache.mockResolvedValue(true)
  api.clearCache.mockResolvedValue()
  api.store.mockImplementation(async (_storeId, options) => payload(options.screen))
  api.system.mockImplementation(async (screen) => payload(screen, admin))
  api.users.mockResolvedValue({ users: [] })
  api.logout.mockResolvedValue({ ok: true })
})
afterEach(() => { cleanup(); vi.useRealTimers() })

it('finishes compact Admin login without waiting for the unused account directory', async () => {
  api.login.mockResolvedValue({ user: admin, bootstrap: { ...payload('', admin), partial: true } })
  api.users.mockImplementation(() => new Promise(() => {}))
  render(<AppProvider><Probe /></AppProvider>)
  await act(async () => { expect((await app.login('fixture', 'synthetic-only')).ok).toBe(true) })
  expect(api.users).not.toHaveBeenCalled()
  expect(api.bootstrap).not.toHaveBeenCalled()
  expect(api.system).not.toHaveBeenCalled()
})

it.each(['policies', 'settings', 'stores', 'account-settings', 'support-schedule'])(
  'does not fetch an account directory when opening %s', async (screen) => {
    await signIn(admin)
    await act(async () => { await app.ensureSystemWorkspaceData({ screen }) })
    expect(api.users).not.toHaveBeenCalled()
    expect(api.system).toHaveBeenCalledTimes(1)
  },
)
it('retains the legacy account directory fallback on personnel screens', async () => {
  await signIn(admin)
  await act(async () => { await app.ensureSystemWorkspaceData({ screen: 'employees' }) })
  expect(api.users).toHaveBeenCalledTimes(1)
})

it('prefetches only on request, keeps the current view unchanged, then navigates from memory', async () => {
  await signIn()
  expect(api.store).not.toHaveBeenCalled()
  await act(async () => { await app.prefetchWorkspaceData('/store/orders') })
  expect(app.remoteProjection.screen).toBe('overview')
  expect(app.orders).toEqual([])
  expect(api.writeCache).not.toHaveBeenCalled()
  await act(async () => { await app.ensureStoreWorkspaceData('S1', { screen: 'orders' }) })
  expect(app.orders[0].id).toBe('O1')
  expect(api.store).toHaveBeenCalledTimes(1)
  expect(api.store).toHaveBeenCalledWith('S1', expect.objectContaining({ screen: 'orders', retries: 0 }))
})

it('promotes an in-flight matching prefetch instead of downloading twice', async () => {
  await signIn()
  const response = deferred()
  const caller = new AbortController()
  api.store.mockReturnValueOnce(response.promise)
  let background, foreground
  act(() => { background = app.prefetchWorkspaceData('/store/orders', { signal: caller.signal }) })
  act(() => { foreground = app.ensureStoreWorkspaceData('S1', { screen: 'orders' }) })
  caller.abort() // old menu cleanup after navigation
  expect(api.store.mock.calls[0][1].signal.aborted).toBe(false)
  await act(async () => { response.resolve(payload('orders')); await Promise.all([background, foreground]) })
  expect(app.remoteProjection.screen).toBe('orders')
  expect(app.orders[0].id).toBe('O1')
  expect(api.store).toHaveBeenCalledTimes(1)
})

it('deduplicates repeated intent while a prefetch is downloading', async () => {
  await signIn()
  const response = deferred()
  api.store.mockReturnValueOnce(response.promise)
  let first, second
  act(() => {
    first = app.prefetchWorkspaceData('/store/orders')
    second = app.prefetchWorkspaceData('/store/orders')
  })
  expect(first).toBe(second)
  await act(async () => { response.resolve(payload('orders')); await first })
  expect(api.store).toHaveBeenCalledTimes(1)
})

it('aborts irrelevant prefetch and gives a different foreground screen priority', async () => {
  await signIn()
  const response = deferred()
  api.store.mockReturnValueOnce(response.promise)
  let background
  act(() => { background = app.prefetchWorkspaceData('/store/orders') })
  const signal = api.store.mock.calls[0][1].signal
  await act(async () => { await app.ensureStoreWorkspaceData('S1', { screen: 'schedule' }) })
  expect(signal.aborted).toBe(true)
  await act(async () => { response.resolve(payload('orders')); await background })
  expect(app.remoteProjection.screen).toBe('schedule')
  await act(async () => { await app.ensureStoreWorkspaceData('S1', { screen: 'orders' }) })
  expect(api.store).toHaveBeenCalledTimes(3)
})

it.each(['logout', 'store change', 'command'])(
  'cancels speculative reads on %s and rejects their late response', async (change) => {
    await signIn(change === 'store change' ? admin : manager)
    const response = deferred()
    api.store.mockReturnValueOnce(response.promise)
    let background
    act(() => { background = app.prefetchWorkspaceData('/store/orders') })
    const signal = api.store.mock.calls[0][1].signal
    api.command.mockResolvedValue({ version: 2, store: { id: 'S1', name: 'Renamed' } })
    await act(async () => {
      if (change === 'logout') app.logout()
      if (change === 'store change') app.setActiveStoreId('S2')
      if (change === 'command') await app.createImportVoucher({ storeId: 'S1', items: [{ name: 'Fixture', weight: 1, price: 100 }] })
    })
    expect(signal.aborted).toBe(true)
    await act(async () => { response.resolve(payload('orders')); await background })
    expect(app.orders).not.toContainEqual(expect.objectContaining({ id: 'O1' }))
    if (change === 'logout') expect(app.session).toBeNull()
  },
)

it.each([
  ['data version', (result) => ({ ...result, version: 2 })],
  ['role', (result) => ({ ...result, user: { ...manager, role: 'employee' } })],
  ['effective store', (result) => ({ ...result, user: { ...manager, storeId: 'S2' } })],
  ['policy', (result) => ({ ...result, policies: [{ key: 'attendance', version: 2 }] })],
])('does not cache a speculative response with changed %s', async (_label, changed) => {
  await signIn()
  api.store.mockResolvedValueOnce(changed(payload('orders')))
  await act(async () => { await app.prefetchWorkspaceData('/store/orders') })
  expect(app.remoteProjection.screen).toBe('overview')
  await act(async () => { await app.ensureStoreWorkspaceData('S1', { screen: 'orders' }) })
  expect(api.store).toHaveBeenCalledTimes(2)
})

it('silently discards failed prefetch and retries on explicit navigation', async () => {
  await signIn()
  api.store.mockRejectedValueOnce(new Error('Temporary network failure'))
  await act(async () => { await app.prefetchWorkspaceData('/store/orders') })
  expect(app.apiStatus).toBe('connected')
  expect(app.toast).toBeNull()
  await act(async () => { await app.ensureStoreWorkspaceData('S1', { screen: 'orders' }) })
  expect(api.store).toHaveBeenCalledTimes(2)
})

it('does not prefetch an unscoped workspace, a denied role, or while foreground is loading', async () => {
  await signIn()
  await act(async () => {
    await app.prefetchWorkspaceData('/admin/overview')
    await app.prefetchWorkspaceData('/admin/policies')
  })
  const response = deferred()
  api.store.mockReturnValueOnce(response.promise)
  let foreground
  await act(async () => { foreground = app.ensureStoreWorkspaceData('S1', { screen: 'orders' }) })
  await act(async () => { await app.prefetchWorkspaceData('/store/schedule') })
  expect(api.system).not.toHaveBeenCalled()
  expect(api.store).toHaveBeenCalledTimes(1)
  await act(async () => { response.resolve(payload('orders')); await foreground })
})

it('bounds disk-cache waiting so blocked IndexedDB cannot stall a menu', async () => {
  vi.useFakeTimers()
  await signIn()
  api.readCache.mockImplementation(() => new Promise(() => {}))
  let foreground
  act(() => { foreground = app.ensureStoreWorkspaceData('S1', { screen: 'orders' }) })
  await act(async () => { await vi.advanceTimersByTimeAsync(50); await foreground })
  expect(api.store).toHaveBeenCalledTimes(1)
  expect(app.remoteProjection.screen).toBe('orders')
})

it('does not let a completed system prefetch undo an explicitly selected store', async () => {
  await signIn(admin)
  await act(async () => { await app.prefetchWorkspaceData('/admin/stores') })
  act(() => { app.setActiveStoreId('S2') })
  await act(async () => { await app.ensureSystemWorkspaceData({ screen: 'stores' }) })
  expect(app.activeStoreId).toBe('S2')
  expect(api.system).toHaveBeenCalledTimes(1)
})

it('preserves legacy directory enrichment when a prefetched personnel payload omits users', async () => {
  await signIn(admin)
  await act(async () => { await app.prefetchWorkspaceData('/admin/employees') })
  await act(async () => { await app.ensureSystemWorkspaceData({ screen: 'employees' }) })
  expect(api.users).toHaveBeenCalledTimes(1)
  expect(api.system).toHaveBeenCalledTimes(2)
})

it('reuses a personnel prefetch including its authentication fields', async () => {
  await signIn(admin)
  api.system.mockResolvedValueOnce({
    ...payload('employees', admin),
    users: [{ ...manager, username: 'fixture-manager', status: 'active' }],
  })
  await act(async () => { await app.prefetchWorkspaceData('/admin/employees') })
  await act(async () => { await app.ensureSystemWorkspaceData({ screen: 'employees' }) })
  expect(api.system).toHaveBeenCalledTimes(1)
  expect(api.users).not.toHaveBeenCalled()
  expect(app.employees.find(({ id }) => id === 'E1')).toMatchObject({ username: 'fixture-manager', authUserId: 'U1' })
})

it('retries a failed stale-cache refresh instead of treating the stale screen as current', async () => {
  await signIn(admin)
  await act(async () => { await app.prefetchWorkspaceData('/admin/stores') })
  api.command.mockResolvedValueOnce({ version: 2, store: { id: 'S1', name: 'Renamed' } })
  await act(async () => { await app.updateStore('S1', { name: 'Renamed' }) })
  api.system.mockRejectedValueOnce(new Error('Temporary refresh error'))
  await act(async () => {
    await expect(app.ensureSystemWorkspaceData({ screen: 'stores' })).rejects.toThrow('Temporary refresh error')
  })
  api.system.mockResolvedValueOnce(payload('stores', admin, 2))
  await act(async () => { await app.ensureSystemWorkspaceData({ screen: 'stores' }) })
  expect(api.system).toHaveBeenCalledTimes(3)
})

it('shares an in-flight stale refresh across repeated route-guard effects', async () => {
  await signIn(admin)
  await act(async () => { await app.prefetchWorkspaceData('/admin/stores') })
  api.command.mockResolvedValueOnce({ version: 2, store: { id: 'S1', name: 'Renamed' } })
  await act(async () => { await app.updateStore('S1', { name: 'Renamed' }) })
  const response = deferred()
  api.system.mockReturnValueOnce(response.promise)
  let first, second
  await act(async () => { first = app.ensureSystemWorkspaceData({ screen: 'stores' }) })
  act(() => { second = app.ensureSystemWorkspaceData({ screen: 'stores' }) })
  expect(second).toBe(first)
  await act(async () => { response.resolve(payload('stores', admin, 2)); await Promise.all([first, second]) })
  expect(api.system).toHaveBeenCalledTimes(2)
})

it('cancels prefetch before changing session role and never reuses the old-role page', async () => {
  const availableRoles = [
    { role: 'store_manager', storeId: 'S1', employeeId: 'E1' },
    { role: 'employee', storeId: 'S1', employeeId: 'E1' },
  ]
  await signIn({ ...manager, availableRoles })
  const response = deferred()
  api.store.mockReturnValueOnce(response.promise)
  let background
  act(() => { background = app.prefetchWorkspaceData('/store/orders') })
  const signal = api.store.mock.calls[0][1].signal
  const employee = { ...manager, role: 'employee', availableRoles }
  api.selectRole.mockResolvedValueOnce({ user: employee, bootstrap: payload('employee-home', employee) })
  await act(async () => { expect((await app.selectSessionRole(availableRoles[1])).ok).toBe(true) })
  expect(signal.aborted).toBe(true)
  await act(async () => { response.resolve(payload('orders')); await background })
  expect(app.session.role).toBe('employee')
  expect(app.remoteProjection.screen).toBe('employee-home')
  expect(app.orders).toEqual([])
})
