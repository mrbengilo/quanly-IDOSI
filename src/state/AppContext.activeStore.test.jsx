import { act, cleanup, render, screen } from '@testing-library/react'
import { createRef, forwardRef, useImperativeHandle } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppProvider, createInitialState, SYSTEM_RESET_IDEMPOTENCY_STORAGE_KEY, useApp } from './AppContext'

const api = vi.hoisted(() => ({
  apiBootstrapState: vi.fn(),
  apiCommand: vi.fn(),
  apiGetAccountAvatar: vi.fn(),
  apiGetState: vi.fn(),
  apiGetStateMetadata: vi.fn(),
  apiLogin: vi.fn(),
  apiListUsers: vi.fn(),
  apiLogout: vi.fn(),
  clearApiSession: vi.fn(),
}))

vi.mock('../services/idosiApi', () => ({
  apiBootstrapState: api.apiBootstrapState,
  apiCommand: api.apiCommand,
  apiGetAccountAvatar: api.apiGetAccountAvatar,
  apiGetState: api.apiGetState,
  apiGetStateMetadata: api.apiGetStateMetadata,
  apiLogin: api.apiLogin,
  apiListUsers: api.apiListUsers,
  apiLogout: api.apiLogout,
  apiPolicyEntries: () => [],
  apiPolicyMap: () => ({}),
  clearApiSession: api.clearApiSession,
  hasApiSession: () => false,
  isLocalApiFallbackAllowed: () => false,
}))

const supportUser = {
  id: 'USER-HTKD-001',
  employeeId: 'HTKD-001',
  username: 'support-one',
  displayName: 'Hỗ trợ KD',
  role: 'business_support',
  status: 'active',
  version: 1,
}

const adminUser = {
  id: 'USER-ADMIN',
  username: 'admin',
  displayName: 'Admin',
  role: 'admin',
  status: 'active',
  version: 1,
}

const employeeHomeUser = {
  id: 'USER-E01', employeeId: 'E01', username: 'employee-one', displayName: 'Nhân viên 01',
  role: 'employee', storeId: 'STORE-A', homeStoreId: 'STORE-A', status: 'active', version: 1,
}

const makeRemoteState = (activeStoreId = 'STORE-A') => ({
  ...createInitialState(),
  stores: [
    { id: 'STORE-A', name: 'Cửa hàng A', status: 'Đang hoạt động' },
    { id: 'STORE-B', name: 'Cửa hàng B', status: 'Đang hoạt động' },
  ],
  employees: [{
    id: 'HTKD-001',
    code: 'HTKD-001',
    name: 'Hỗ trợ KD',
    unit: 'business_support',
    storeId: 'BUSINESS_SUPPORT',
    status: 'Đang làm việc',
  }],
  activeStoreId,
})

let appRef

const AppProbe = forwardRef(function AppProbe(_props, ref) {
  const app = useApp()
  useImperativeHandle(ref, () => app, [app])
  return <output aria-label="Cửa hàng đang chọn">{app.activeStoreId || 'none'}</output>
})

const renderProvider = () => render(<AppProvider><AppProbe ref={appRef} /></AppProvider>)

describe('remote command active-store preservation', () => {
  beforeEach(() => {
    appRef = createRef()
    sessionStorage.clear()
    localStorage.clear()
    const bootstrap = () => ({ user: supportUser, state: makeRemoteState('STORE-A'), policies: [], version: 1 })
    api.apiLogin.mockResolvedValue({ user: supportUser })
    api.apiBootstrapState.mockImplementation(async () => bootstrap())
    api.apiListUsers.mockResolvedValue({ users: [supportUser] })
    api.apiGetState.mockImplementation(async () => bootstrap())
    api.apiGetStateMetadata.mockResolvedValue({ version: 1 })
    api.apiCommand.mockResolvedValue({ version: 2, store: { id: 'STORE-A', name: 'Cửa hàng A mới' } })
  })

  afterEach(() => {
    cleanup()
    sessionStorage.clear()
    localStorage.clear()
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.clearAllMocks()
  })

  it('keeps store B selected after a successful command refresh returns global store A', async () => {
    renderProvider()
    await act(async () => {
      expect((await appRef.current.login('support-one', 'password')).ok).toBe(true)
    })
    act(() => appRef.current.setActiveStoreId('STORE-B'))
    expect(screen.getByLabelText('Cửa hàng đang chọn').textContent).toBe('STORE-B')

    await act(async () => {
      expect((await appRef.current.updateStore('STORE-A', { name: 'Cửa hàng A mới' })).ok).toBe(true)
    })

    expect(api.apiGetState).toHaveBeenCalledWith('global')
    expect(screen.getByLabelText('Cửa hàng đang chọn').textContent).toBe('STORE-B')
  })

  it('uses the authenticated bootstrap projection without a second full-state login request', async () => {
    api.apiLogin.mockResolvedValue({
      user: supportUser,
      bootstrap: { user: supportUser, state: makeRemoteState('STORE-A'), policies: [], version: 1 },
      users: [supportUser],
    })
    renderProvider()

    await act(async () => {
      expect((await appRef.current.login('support-one', 'password')).ok).toBe(true)
    })

    expect(api.apiBootstrapState).not.toHaveBeenCalled()
    expect(api.apiListUsers).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Cửa hàng đang chọn').textContent).toBe('STORE-A')
  })

  it('renders the compact Admin bootstrap before the complete state finishes loading', async () => {
    let resolveCompleteBootstrap
    const completeBootstrap = new Promise((resolve) => { resolveCompleteBootstrap = resolve })
    api.apiLogin.mockResolvedValue({
      user: adminUser,
      bootstrap: {
        user: adminUser,
        state: {
          stores: [{ id: 'STORE-A', name: 'Cửa hàng A', status: 'Đang hoạt động' }],
          orders: [],
          expenseEntries: [],
        },
        policies: [],
        version: 1,
        partial: true,
        loadedCollections: ['stores', 'orders', 'expenseEntries'],
      },
      users: [adminUser],
    })
    api.apiBootstrapState.mockReturnValueOnce(completeBootstrap)
    renderProvider()

    await act(async () => {
      expect((await appRef.current.login('admin', 'password')).ok).toBe(true)
    })

    expect(appRef.current.session).toMatchObject({ role: 'admin' })
    expect(appRef.current.remoteDataReady).toBe(false)
    expect(screen.getByLabelText('Cửa hàng đang chọn').textContent).toBe('STORE-A')
    expect(api.apiBootstrapState).toHaveBeenCalledWith('global')

    await act(async () => {
      resolveCompleteBootstrap({ user: adminUser, state: makeRemoteState('STORE-A'), policies: [], version: 1 })
      await completeBootstrap
      await Promise.resolve()
    })

    expect(appRef.current.remoteDataReady).toBe(true)
    expect(appRef.current.employees).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'HTKD-001' }),
    ]))
  })

  it('returns from a successful mutation before the background full-state reconciliation finishes', async () => {
    let resolveRefresh
    api.apiGetState.mockImplementationOnce(() => new Promise((resolve) => { resolveRefresh = resolve }))
    renderProvider()
    await act(async () => {
      expect((await appRef.current.login('support-one', 'password')).ok).toBe(true)
    })

    await act(async () => {
      const result = await appRef.current.updateStore('STORE-A', { name: 'Cửa hàng A mới' })
      expect(result.ok).toBe(true)
      expect(resolveRefresh).toBeTypeOf('function')
      resolveRefresh({ user: supportUser, state: makeRemoteState('STORE-A'), policies: [], version: 2 })
      await Promise.resolve()
    })
  })

  it('retries a failed background reconciliation from lightweight metadata', async () => {
    vi.useFakeTimers()
    api.apiGetState
      .mockRejectedValueOnce(new Error('temporary state download failure'))
      .mockResolvedValue({ user: supportUser, state: makeRemoteState('STORE-A'), policies: [], version: 2 })
    api.apiGetStateMetadata.mockResolvedValue({ version: 2, userVersion: 1, policyVersions: {} })
    renderProvider()
    await act(async () => {
      expect((await appRef.current.login('support-one', 'password')).ok).toBe(true)
    })
    await act(async () => {
      expect((await appRef.current.updateStore('STORE-A', { name: 'Cửa hàng A mới' })).ok).toBe(true)
      await Promise.resolve()
    })
    expect(api.apiGetState).toHaveBeenCalledTimes(1)

    await act(async () => { await vi.advanceTimersByTimeAsync(5_010) })

    expect(api.apiGetStateMetadata).toHaveBeenCalledWith('global')
    expect(api.apiGetState).toHaveBeenCalledTimes(2)
  })

  it('polls lightweight metadata without downloading unchanged shared state', async () => {
    vi.useFakeTimers()
    renderProvider()
    await act(async () => {
      expect((await appRef.current.login('support-one', 'password')).ok).toBe(true)
    })
    api.apiGetState.mockClear()

    await act(async () => { await vi.advanceTimersByTimeAsync(5_010) })

    expect(api.apiGetStateMetadata).toHaveBeenCalledWith('global')
    expect(api.apiGetState).not.toHaveBeenCalled()
  })

  it('refreshes shared state when a policy version changes without a state mutation', async () => {
    vi.useFakeTimers()
    api.apiGetStateMetadata.mockResolvedValue({
      version: 1,
      userVersion: 1,
      policyVersions: { late_tolerance_minutes: 2 },
    })
    renderProvider()
    await act(async () => {
      expect((await appRef.current.login('support-one', 'password')).ok).toBe(true)
    })
    api.apiGetState.mockClear()

    await act(async () => { await vi.advanceTimersByTimeAsync(5_010) })

    expect(api.apiGetState).toHaveBeenCalledWith('global')
  })

  it('switches an already-open employee session at the exact boundary even when state version is unchanged', async () => {
    vi.useFakeTimers()
    vi.setSystemTime('2026-08-20T06:59:00.000Z')
    const transfer = {
      id: 'TR-01', employeeId: 'E01', fromStoreId: 'STORE-A', toStoreId: 'STORE-B',
      startAt: '2026-08-20T14:00', endAt: '2026-08-20T21:00', status: 'Đã duyệt',
    }
    const employeeState = {
      ...makeRemoteState('STORE-A'),
      employees: [{ id: 'E01', code: 'E01', name: 'Nhân viên 01', unit: 'store', storeId: 'STORE-A', status: 'Đang làm việc' }],
      supportTransfers: [transfer],
    }
    const currentUser = () => Date.now() < Date.parse('2026-08-20T07:00:00.000Z')
      ? employeeHomeUser
      : { ...employeeHomeUser, storeId: 'STORE-B', activeTransferId: 'TR-01' }
    const payload = () => ({ user: currentUser(), state: employeeState, policies: [], version: 7 })
    api.apiLogin.mockResolvedValue({ user: employeeHomeUser })
    api.apiBootstrapState.mockImplementation(async () => payload())
    api.apiGetState.mockImplementation(async () => payload())

    renderProvider()
    await act(async () => {
      expect((await appRef.current.login('employee-one', 'password')).ok).toBe(true)
    })
    expect(screen.getByLabelText('Cửa hàng đang chọn').textContent).toBe('STORE-A')

    await act(async () => { await vi.advanceTimersByTimeAsync(59_999) })
    expect(screen.getByLabelText('Cửa hàng đang chọn').textContent).toBe('STORE-A')

    await act(async () => { await vi.advanceTimersByTimeAsync(30) })
    expect(screen.getByLabelText('Cửa hàng đang chọn').textContent).toBe('STORE-B')
    expect(appRef.current.session).toMatchObject({ storeId: 'STORE-B', homeStoreId: 'STORE-A', activeTransferId: 'TR-01' })
    expect(api.apiGetState).toHaveBeenCalledWith('global')
  })

  it('queues a hidden-tab transfer boundary and force-refreshes when the employee returns', async () => {
    vi.useFakeTimers()
    vi.setSystemTime('2026-08-20T06:59:00.000Z')
    let hidden = true
    vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden)
    const transfer = {
      id: 'TR-HIDDEN', employeeId: 'E01', fromStoreId: 'STORE-A', toStoreId: 'STORE-B',
      startAt: '2026-08-20T14:00', endAt: '2026-08-20T21:00', status: 'Đã duyệt',
    }
    const employeeState = {
      ...makeRemoteState('STORE-A'),
      employees: [{ id: 'E01', code: 'E01', name: 'Nhân viên 01', unit: 'store', storeId: 'STORE-A', status: 'Đang làm việc' }],
      supportTransfers: [transfer],
    }
    const currentUser = () => Date.now() < Date.parse('2026-08-20T07:00:00.000Z')
      ? employeeHomeUser
      : { ...employeeHomeUser, storeId: 'STORE-B', activeTransferId: 'TR-HIDDEN' }
    const payload = () => ({ user: currentUser(), state: employeeState, policies: [], version: 7 })
    api.apiLogin.mockResolvedValue({ user: employeeHomeUser })
    api.apiBootstrapState.mockImplementation(async () => payload())
    api.apiGetState.mockImplementation(async () => payload())

    renderProvider()
    await act(async () => {
      expect((await appRef.current.login('employee-one', 'password')).ok).toBe(true)
    })
    api.apiGetState.mockClear()

    await act(async () => { await vi.advanceTimersByTimeAsync(60_030) })
    expect(screen.getByLabelText('Cửa hàng đang chọn').textContent).toBe('STORE-A')
    expect(api.apiGetState).not.toHaveBeenCalled()

    hidden = false
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
      await vi.advanceTimersByTimeAsync(1)
    })

    expect(api.apiGetState).toHaveBeenCalledWith('global')
    expect(screen.getByLabelText('Cửa hàng đang chọn').textContent).toBe('STORE-B')
    expect(appRef.current.session).toMatchObject({ storeId: 'STORE-B', homeStoreId: 'STORE-A', activeTransferId: 'TR-HIDDEN' })
  })

  it('drains a forced transfer-boundary refresh after an in-flight metadata poll finishes', async () => {
    vi.useFakeTimers()
    vi.setSystemTime('2026-08-20T06:59:54.000Z')
    const transfer = {
      id: 'TR-BUSY', employeeId: 'E01', fromStoreId: 'STORE-A', toStoreId: 'STORE-B',
      startAt: '2026-08-20T14:00', endAt: '2026-08-20T21:00', status: 'Đã duyệt',
    }
    const employeeState = {
      ...makeRemoteState('STORE-A'),
      employees: [{ id: 'E01', code: 'E01', name: 'Nhân viên 01', unit: 'store', storeId: 'STORE-A', status: 'Đang làm việc' }],
      supportTransfers: [transfer],
    }
    const currentUser = () => Date.now() < Date.parse('2026-08-20T07:00:00.000Z')
      ? employeeHomeUser
      : { ...employeeHomeUser, storeId: 'STORE-B', activeTransferId: 'TR-BUSY' }
    const payload = () => ({ user: currentUser(), state: employeeState, policies: [], version: 7 })
    let resolveMetadata
    api.apiLogin.mockResolvedValue({ user: employeeHomeUser })
    api.apiBootstrapState.mockImplementation(async () => payload())
    api.apiGetState.mockImplementation(async () => payload())
    api.apiGetStateMetadata.mockImplementationOnce(() => new Promise((resolve) => { resolveMetadata = resolve }))

    renderProvider()
    await act(async () => {
      expect((await appRef.current.login('employee-one', 'password')).ok).toBe(true)
    })
    api.apiGetState.mockClear()

    act(() => { vi.advanceTimersByTime(5_000) })
    expect(api.apiGetStateMetadata).toHaveBeenCalledWith('global')
    act(() => { vi.advanceTimersByTime(1_030) })
    expect(api.apiGetState).not.toHaveBeenCalled()

    await act(async () => {
      resolveMetadata({ version: 7 })
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(api.apiGetState).toHaveBeenCalledWith('global')
    expect(screen.getByLabelText('Cửa hàng đang chọn').textContent).toBe('STORE-B')
    expect(appRef.current.session).toMatchObject({ storeId: 'STORE-B', homeStoreId: 'STORE-A', activeTransferId: 'TR-BUSY' })
  })

  it('creates a reusable remote shift without requiring or sending an application date', async () => {
    api.apiCommand.mockResolvedValueOnce({
      version: 2,
      shift: { id: 'SHIFT-MORNING', storeId: 'STORE-A', name: 'Ca sáng', start: '08:00', end: '12:00', date: null },
    })
    renderProvider()
    await act(async () => {
      expect((await appRef.current.login('support-one', 'password')).ok).toBe(true)
    })

    let result
    await act(async () => {
      result = await appRef.current.createShiftDefinition({
        storeId: 'STORE-A',
        name: 'Ca sáng',
        start: '08:00',
        end: '12:00',
      })
    })

    expect(result).toMatchObject({ ok: true, shift: { id: 'SHIFT-MORNING', date: null } })
    const command = api.apiCommand.mock.calls.find(([type]) => type === 'shift_definition.create')
    expect(command?.[1]).toEqual({ storeId: 'STORE-A', name: 'Ca sáng', start: '08:00', end: '12:00' })
    expect(Object.hasOwn(command?.[1] || {}, 'date')).toBe(false)
  })

  it('stores a reusable local shift with a null date', async () => {
    renderProvider()

    let result
    await act(async () => {
      result = await appRef.current.createShiftDefinition({
        storeId: 'STORE-A',
        name: 'Ca chiều',
        start: '13:00',
        end: '17:30',
      })
    })

    expect(result).toMatchObject({
      ok: true,
      shift: { storeId: 'STORE-A', name: 'Ca chiều', start: '13:00', end: '17:30', date: null, effectiveFrom: null },
    })
    expect(api.apiCommand).not.toHaveBeenCalled()
  })

  it('restores the selected store after the provider reloads', async () => {
    const firstView = renderProvider()
    await act(async () => {
      expect((await appRef.current.login('support-one', 'password')).ok).toBe(true)
    })
    act(() => appRef.current.setActiveStoreId('STORE-B'))
    expect(screen.getByLabelText('Cửa hàng đang chọn').textContent).toBe('STORE-B')

    firstView.unmount()
    appRef = createRef()
    renderProvider()
    await act(async () => {
      expect((await appRef.current.login('support-one', 'password')).ok).toBe(true)
    })

    expect(screen.getByLabelText('Cửa hàng đang chọn').textContent).toBe('STORE-B')
  })

  it('keeps store B selected when a version conflict refreshes the latest state', async () => {
    renderProvider()
    await act(async () => {
      expect((await appRef.current.login('support-one', 'password')).ok).toBe(true)
    })
    act(() => appRef.current.setActiveStoreId('STORE-B'))
    const conflict = Object.assign(new Error('conflict'), { code: 'VERSION_CONFLICT' })
    api.apiCommand.mockRejectedValueOnce(conflict)

    await act(async () => {
      expect((await appRef.current.updateStore('STORE-A', { name: 'Cửa hàng A mới' })).ok).toBe(false)
    })

    expect(screen.getByLabelText('Cửa hàng đang chọn').textContent).toBe('STORE-B')
  })

  it('retries pending reset cleanup with the exact payload and same idempotency key', async () => {
    const adminBootstrap = () => ({ user: adminUser, state: makeRemoteState('STORE-A'), policies: [], version: 1 })
    api.apiLogin.mockResolvedValue({ user: adminUser })
    api.apiBootstrapState.mockImplementation(async () => adminBootstrap())
    api.apiGetState.mockImplementation(async () => adminBootstrap())
    api.apiListUsers.mockResolvedValue({ users: [adminUser] })
    api.apiCommand
      .mockRejectedValueOnce(Object.assign(new Error('cleanup pending'), { code: 'RESET_CLEANUP_PENDING' }))
      .mockResolvedValueOnce({ version: 2, state: makeRemoteState('STORE-A') })

    renderProvider()
    await act(async () => {
      expect((await appRef.current.login('admin', 'password')).ok).toBe(true)
    })
    await act(async () => {
      expect((await appRef.current.resetAllData()).ok).toBe(true)
    })

    const resetCalls = api.apiCommand.mock.calls.filter(([type]) => type === 'system.reset_all')
    expect(resetCalls).toHaveLength(2)
    expect(resetCalls[0][1]).toEqual({ confirmation: 'RESET_ALL_DATA' })
    expect(resetCalls[1][1]).toEqual({ confirmation: 'RESET_ALL_DATA' })
    expect(resetCalls[0][2].idempotencyKey).toBe(resetCalls[1][2].idempotencyKey)
    expect(sessionStorage.getItem(SYSTEM_RESET_IDEMPOTENCY_STORAGE_KEY)).toBeNull()
  })

  it('reuses a pending reset key after retries are exhausted and the provider reloads', async () => {
    vi.useFakeTimers()
    const adminBootstrap = () => ({ user: adminUser, state: makeRemoteState('STORE-A'), policies: [], version: 1 })
    api.apiLogin.mockResolvedValue({ user: adminUser })
    api.apiBootstrapState.mockImplementation(async () => adminBootstrap())
    api.apiGetState.mockImplementation(async () => adminBootstrap())
    api.apiListUsers.mockResolvedValue({ users: [adminUser] })
    const pending = Object.assign(new Error('cleanup pending'), { code: 'RESET_CLEANUP_PENDING' })
    api.apiCommand.mockRejectedValue(pending)

    const firstRender = renderProvider()
    await act(async () => {
      expect((await appRef.current.login('admin', 'password')).ok).toBe(true)
    })
    let firstResult
    await act(async () => {
      const resetPromise = appRef.current.resetAllData()
      await vi.runAllTimersAsync()
      firstResult = await resetPromise
    })
    expect(firstResult.ok).toBe(false)
    const persistedKey = sessionStorage.getItem(SYSTEM_RESET_IDEMPOTENCY_STORAGE_KEY)
    expect(persistedKey).toMatch(/^system\.reset_all:/)
    const exhaustedCalls = api.apiCommand.mock.calls.filter(([type]) => type === 'system.reset_all')
    expect(exhaustedCalls).toHaveLength(4)
    expect(new Set(exhaustedCalls.map(([, , options]) => options.idempotencyKey))).toEqual(new Set([persistedKey]))

    firstRender.unmount()
    appRef = createRef()
    api.apiCommand.mockResolvedValue({ version: 2, state: makeRemoteState('STORE-A') })
    renderProvider()
    await act(async () => {
      expect((await appRef.current.login('admin', 'password')).ok).toBe(true)
    })
    await act(async () => {
      expect((await appRef.current.resetAllData()).ok).toBe(true)
    })

    const allResetCalls = api.apiCommand.mock.calls.filter(([type]) => type === 'system.reset_all')
    expect(allResetCalls.at(-1)[2].idempotencyKey).toBe(persistedKey)
    expect(sessionStorage.getItem(SYSTEM_RESET_IDEMPOTENCY_STORAGE_KEY)).toBeNull()
  })
})
