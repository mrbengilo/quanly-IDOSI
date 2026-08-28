import { act, cleanup, render, screen } from '@testing-library/react'
import { createRef, forwardRef, useImperativeHandle } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppProvider, createInitialState, STORAGE_KEY, SYSTEM_RESET_IDEMPOTENCY_STORAGE_KEY, useApp } from './AppContext'

const api = vi.hoisted(() => ({
  localFallbackAllowed: false,
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
  isLocalApiFallbackAllowed: () => api.localFallbackAllowed,
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

const storeManagerUser = {
  id: 'USER-MANAGER-A', employeeId: 'MANAGER-A', username: 'manager-a', displayName: 'Quản lý A',
  role: 'store_manager', storeId: 'STORE-A', status: 'active', version: 1,
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
    api.localFallbackAllowed = false
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

  it('resolves the signed-in employee through legacy profile aliases', async () => {
    const aliasedState = {
      ...makeRemoteState('STORE-A'),
      employees: [{
        id: 'PROFILE-MANAGER-A', code: 'QL-A', employeeId: 'MANAGER-A', employeeCode: 'LEGACY-QL-A',
        name: 'Quản lý A', unit: 'store_manager', storeId: 'STORE-A', status: 'Đang làm việc',
      }],
    }
    api.apiLogin.mockResolvedValue({
      user: storeManagerUser,
      bootstrap: { user: storeManagerUser, state: aliasedState, policies: [], version: 1 },
      users: [storeManagerUser],
    })
    renderProvider()

    await act(async () => {
      expect((await appRef.current.login('manager-a', 'password')).ok).toBe(true)
    })

    expect(appRef.current.currentEmployee).toMatchObject({
      id: 'PROFILE-MANAGER-A', employeeId: 'MANAGER-A', employeeCode: 'LEGACY-QL-A',
    })
  })

  it('prefers a direct employee profile over an earlier linked manager proxy', async () => {
    const employeeState = {
      ...makeRemoteState('STORE-A'),
      employees: [{
        id: 'QLCH-01', linkedEmployeeId: 'E01', name: 'Vai trò quản lý',
        unit: 'store_manager', storeId: 'STORE-A', status: 'Đang làm việc',
      }, {
        id: 'E01', code: 'E01', name: 'Nhân viên 01',
        unit: 'store', storeId: 'STORE-A', status: 'Đang làm việc',
      }],
    }
    api.apiLogin.mockResolvedValue({
      user: employeeHomeUser,
      bootstrap: { user: employeeHomeUser, state: employeeState, policies: [], version: 1 },
    })
    renderProvider()

    await act(async () => {
      expect((await appRef.current.login('employee-one', 'password')).ok).toBe(true)
    })

    expect(appRef.current.currentEmployee).toMatchObject({ id: 'E01', unit: 'store' })
  })

  it('lets an aliased employee submit shift expense and task progress through legacy record keys', async () => {
    const aliasedState = {
      ...makeRemoteState('STORE-A'),
      employees: [{
        id: 'PROFILE-E01', code: 'CODE-E01', employeeId: 'LEGACY-E01', employeeCode: 'STAFF-E01',
        name: 'Nhân viên 01', unit: 'store', storeId: 'STORE-A', status: 'Đang làm việc',
      }],
      attendance: [{
        id: 'ATT-ALIAS', employeeId: 'LEGACY-E01', storeId: 'STORE-A', date: '2026-08-28',
        shiftId: 'SHIFT-AM', shiftName: 'Ca sáng', checkInAt: '2026-08-28T01:00:00.000Z',
        checkOutAt: null, checkOut: null,
      }],
      tasks: [{
        id: 'TASK-ALIAS', assignmentId: 'ASSIGN-ALIAS', employeeIds: ['STAFF-E01'],
        storeId: 'STORE-A', date: '2026-08-28', shiftId: 'SHIFT-AM', title: 'Mở cửa', required: false,
      }],
    }
    const aliasedUser = { ...employeeHomeUser, employeeId: 'CODE-E01' }
    api.apiLogin.mockResolvedValue({
      user: aliasedUser,
      bootstrap: { user: aliasedUser, state: aliasedState, policies: [], version: 1 },
    })
    api.apiCommand
      .mockResolvedValueOnce({ version: 2, expense: { id: 'EXP-ALIAS' } })
      .mockResolvedValueOnce({ version: 3, completionRate: 100 })
    api.apiGetState.mockImplementation(() => new Promise(() => {}))
    renderProvider()

    await act(async () => {
      expect((await appRef.current.login('employee-one', 'password')).ok).toBe(true)
    })
    await act(async () => {
      expect((await appRef.current.addShiftExpense({
        attendanceId: 'ATT-ALIAS', name: 'Mua vật dụng', amount: 35, note: 'Trong ca',
        idempotencyKey: 'expense-alias-0001',
      })).ok).toBe(true)
      expect((await appRef.current.saveStoreTaskProgress({
        attendanceId: 'ATT-ALIAS', tasks: [{ id: 'TASK-ALIAS', completed: true }],
        incompleteReason: '', idempotencyKey: 'task-alias-0001',
      })).ok).toBe(true)
    })

    expect(api.apiCommand).toHaveBeenNthCalledWith(1, 'shift_expense.create', {
      attendanceId: 'ATT-ALIAS', name: 'Mua vật dụng', amount: 35, note: 'Trong ca',
    }, { expectedVersion: 1, idempotencyKey: 'expense-alias-0001' })
    expect(api.apiCommand).toHaveBeenNthCalledWith(2, 'task.progress.save', {
      attendanceId: 'ATT-ALIAS', tasks: [{ id: 'TASK-ALIAS', completed: true }], incompleteReason: '',
    }, { expectedVersion: 2, idempotencyKey: 'task-alias-0001' })
  })

  it('keeps a legacy reward task optional when required is omitted', async () => {
    const rewardState = {
      ...makeRemoteState('STORE-A'),
      employees: [{
        id: 'E01', name: 'Nhân viên 01', unit: 'store', storeId: 'STORE-A', status: 'Đang làm việc',
      }],
      attendance: [{
        id: 'ATT-REWARD', employeeId: 'E01', storeId: 'STORE-A', date: '2026-08-28',
        shiftId: 'SHIFT-AM', checkInAt: '2026-08-28T01:00:00.000Z', checkOutAt: null,
      }],
      tasks: [{
        id: 'TASK-REWARD', employeeId: 'E01', storeId: 'STORE-A', date: '2026-08-28',
        shiftId: 'SHIFT-AM', catalogKind: 'REWARD_TASK', title: 'Quay clip sản phẩm',
      }],
    }
    api.apiLogin.mockResolvedValue({
      user: employeeHomeUser,
      bootstrap: { user: employeeHomeUser, state: rewardState, policies: [], version: 1 },
    })
    api.apiCommand.mockResolvedValue({ version: 2, completionRate: 0 })
    api.apiGetState.mockImplementation(() => new Promise(() => {}))
    renderProvider()

    let saveResult
    await act(async () => {
      expect((await appRef.current.login('employee-one', 'password')).ok).toBe(true)
    })
    await act(async () => {
      saveResult = await appRef.current.saveStoreTaskProgress({
        attendanceId: 'ATT-REWARD',
        tasks: [{ id: 'TASK-REWARD', completed: false }],
        incompleteReason: '',
        idempotencyKey: 'reward-optional-0001',
      })
    })
    expect(saveResult).toEqual({ ok: true, version: 2, completionRate: 0 })

    expect(api.apiCommand).toHaveBeenCalledWith('task.progress.save', {
      attendanceId: 'ATT-REWARD', tasks: [{ id: 'TASK-REWARD', completed: false }], incompleteReason: '',
    }, { expectedVersion: 1, idempotencyKey: 'reward-optional-0001' })
  })

  it('returns the employee-only preflight error when no profile is linked to the session', async () => {
    const unlinkedState = { ...makeRemoteState('STORE-A'), employees: [] }
    api.apiLogin.mockResolvedValue({
      user: employeeHomeUser,
      bootstrap: { user: employeeHomeUser, state: unlinkedState, policies: [], version: 1 },
    })
    renderProvider()

    await act(async () => {
      expect((await appRef.current.login('employee-one', 'password')).ok).toBe(true)
    })
    await act(async () => {
      await expect(appRef.current.addShiftExpense({ name: 'Không hợp lệ', amount: 1 }))
        .resolves.toMatchObject({ ok: false, message: 'Chức năng này chỉ dành cho nhân viên cửa hàng.' })
      await expect(appRef.current.saveStoreTaskProgress({ tasks: [] }))
        .resolves.toMatchObject({ ok: false, message: 'Chức năng này chỉ dành cho nhân viên cửa hàng.' })
    })
    expect(api.apiCommand).not.toHaveBeenCalled()
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

  it('submits only the open-attendance checklist plus manual tasks to the remote progress command', async () => {
    const employeeState = {
      ...makeRemoteState('STORE-A'),
      employees: [{
        id: 'E01', code: 'E01', name: 'Nhân viên 01', unit: 'store', storeId: 'STORE-A', status: 'Đang làm việc',
      }],
      attendance: [{
        id: 'ATT-CURRENT', employeeId: 'E01', storeId: 'STORE-A', date: '2026-08-28',
        shiftId: 'SHIFT-MORNING', unit: 'store', checkInAt: '2026-08-28T01:00:00.000Z',
      }],
      tasks: [{
        id: 'TASK-OLD-CHECKLIST', assignmentId: 'catalog_checklist_ATT-OLD', storeId: 'STORE-A', date: '2026-08-28',
        shiftId: 'SHIFT-MORNING', employeeIds: ['E01'], title: 'Checklist cũ', required: true,
      }, {
        id: 'TASK-CURRENT-CHECKLIST', assignmentId: 'catalog_checklist_ATT-CURRENT', storeId: 'STORE-A', date: '2026-08-28',
        shiftId: 'SHIFT-MORNING', employeeIds: ['E01'], title: 'Checklist hiện tại', required: true,
      }, {
        id: 'TASK-MANUAL', storeId: 'STORE-A', date: '2026-08-28', shiftId: 'SHIFT-MORNING',
        employeeIds: ['E01'], title: 'Công việc giao thủ công', required: false,
      }],
      taskAssignmentHistory: [],
    }
    const bootstrap = { user: employeeHomeUser, state: employeeState, policies: [], version: 7 }
    api.apiLogin.mockResolvedValue({ user: employeeHomeUser, bootstrap })
    api.apiGetState.mockResolvedValue(bootstrap)
    api.apiCommand.mockResolvedValue({ version: 8, completionRate: 100, completedTasks: 2, totalTasks: 2 })

    renderProvider()
    await act(async () => {
      expect((await appRef.current.login('employee-one', 'password')).ok).toBe(true)
    })
    await act(async () => {
      expect(await appRef.current.saveStoreTaskProgress({
        attendanceId: 'ATT-CURRENT',
        tasks: [
          { id: 'TASK-CURRENT-CHECKLIST', completed: true },
          { id: 'TASK-MANUAL', completed: true },
        ],
        idempotencyKey: 'task-progress:current-attendance',
      })).toMatchObject({ ok: true, totalTasks: 2 })
    })

    expect(api.apiCommand).toHaveBeenCalledWith('task.progress.save', {
      attendanceId: 'ATT-CURRENT',
      tasks: [
        { id: 'TASK-CURRENT-CHECKLIST', completed: true },
        { id: 'TASK-MANUAL', completed: true },
      ],
      incompleteReason: '',
    }, expect.objectContaining({
      expectedVersion: 7,
      idempotencyKey: 'task-progress:current-attendance',
    }))
  })

  it('stores one local semantic receipt without matching assignment history and ignores stale checklists at checkout', async () => {
    const initial = createInitialState()
    const employee = {
      id: 'E-LOCAL', code: 'E-LOCAL', username: 'employee-local', password: 'password',
      name: 'Nhân viên local', unit: 'store', storeId: 'STORE-LOCAL', status: 'Đang làm việc',
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      ...initial,
      stores: [{ id: 'STORE-LOCAL', name: 'Cửa hàng local', status: 'Đang hoạt động' }],
      employees: [employee],
      adminAccounts: [],
      managerAccounts: [],
      activeStoreId: 'STORE-LOCAL',
      activeAttendanceId: 'ATT-LOCAL-CURRENT',
      attendance: [{
        id: 'ATT-LOCAL-CURRENT', employeeId: employee.id, employeeName: employee.name,
        storeId: 'STORE-LOCAL', date: '2026-08-28', workDate: '2026-08-28',
        shiftId: 'SHIFT-MORNING', shift: 'SHIFT-MORNING', shiftEnd: '12:00', unit: 'store',
        checkIn: '08:00:00', checkInAt: '2026-08-28T08:00:00+07:00', checkOut: null, checkOutAt: null,
      }],
      tasks: [{
        id: 'TASK-LOCAL-OLD', assignmentId: 'catalog_checklist_ATT-LOCAL-OLD', storeId: 'STORE-LOCAL', date: '2026-08-28',
        shiftId: 'SHIFT-MORNING', employeeIds: [employee.id], title: 'Checklist cũ chưa xong', required: true, completedBy: {},
      }, {
        id: 'TASK-LOCAL-CURRENT', assignmentId: 'catalog_checklist_ATT-LOCAL-CURRENT',
        storeId: 'STORE-LOCAL', date: '2026-08-28', shiftId: 'SHIFT-MORNING', employeeIds: [employee.id],
        title: 'Checklist thưởng hiện tại', catalogItemId: 'CAT-LOCAL-REWARD', catalogKind: 'REWARD_TASK',
        amountVnd: 8_000, required: false, completedBy: {},
        catalogSnapshot: {
          catalogItemId: 'CAT-LOCAL-REWARD', catalogCode: 'store.reward.local', catalogVersion: 1,
          kind: 'REWARD_TASK', targetGroup: 'store', name: 'Checklist thưởng hiện tại', amountVnd: 8_000,
        },
      }, {
        id: 'TASK-LOCAL-CURRENT-REQUIRED', assignmentId: 'catalog_checklist_ATT-LOCAL-CURRENT',
        storeId: 'STORE-LOCAL', date: '2026-08-28', shiftId: 'SHIFT-MORNING', employeeIds: [employee.id],
        title: 'Checklist bắt buộc hiện tại', required: true, completedBy: {},
      }, {
        id: 'TASK-LOCAL-MANUAL', storeId: 'STORE-LOCAL', date: '2026-08-28', shiftId: 'SHIFT-MORNING',
        assignmentId: 'ASSIGNMENT-ORPHAN', employeeIds: [employee.id],
        title: 'Công việc giao thủ công', required: true, completedBy: {},
      }],
      taskAssignmentHistory: [],
      notifications: [],
      orders: [],
    }))
    api.localFallbackAllowed = true
    api.apiLogin.mockRejectedValue(Object.assign(new Error('offline'), { code: 'API_UNAVAILABLE' }))

    renderProvider()
    let loginResult
    await act(async () => {
      loginResult = await appRef.current.login('employee-local', 'password')
    })
    expect(loginResult).toMatchObject({ ok: true })
    const progress = {
      attendanceId: 'ATT-LOCAL-CURRENT',
      tasks: [
        { id: 'TASK-LOCAL-CURRENT', completed: true },
        { id: 'TASK-LOCAL-CURRENT-REQUIRED', completed: true },
        { id: 'TASK-LOCAL-MANUAL', completed: true },
      ],
    }
    await act(async () => {
      expect(await appRef.current.saveStoreTaskProgress({
        ...progress,
        idempotencyKey: 'task-progress:first-local-save',
      })).toMatchObject({ ok: true, completedTasks: 3, totalTasks: 3 })
    })

    expect(appRef.current.tasks.find((task) => task.id === 'TASK-LOCAL-OLD')?.completedBy).toEqual({})
    expect(appRef.current.tasks.find((task) => task.id === 'TASK-LOCAL-CURRENT')?.completedBy).toEqual({ 'E-LOCAL': true })
    expect(appRef.current.tasks.find((task) => task.id === 'TASK-LOCAL-CURRENT-REQUIRED')?.completedBy).toEqual({ 'E-LOCAL': true })
    expect(appRef.current.tasks.find((task) => task.id === 'TASK-LOCAL-MANUAL')?.completedBy).toEqual({ 'E-LOCAL': true })
    expect(appRef.current.taskAssignmentHistory).toEqual([
      expect.objectContaining({
        id: 'task_progress_receipt:ATT-LOCAL-CURRENT',
        source: 'task-progress-receipt',
        taskIds: ['TASK-LOCAL-CURRENT', 'TASK-LOCAL-CURRENT-REQUIRED', 'TASK-LOCAL-MANUAL'],
        progressHistory: [expect.objectContaining({
          fingerprint: expect.any(String),
          requiredTasks: 2,
          completedRequiredTasks: 2,
          rewardTaskSnapshots: [expect.objectContaining({
            taskId: 'TASK-LOCAL-CURRENT', catalogItemId: 'CAT-LOCAL-REWARD', amountVnd: 8_000, completed: true,
          })],
          completedRewardTaskSnapshots: [expect.objectContaining({ taskId: 'TASK-LOCAL-CURRENT' })],
        })],
      }),
    ])
    expect(appRef.current.notifications).toHaveLength(3)

    await act(async () => {
      expect(await appRef.current.saveStoreTaskProgress({
        ...progress,
        idempotencyKey: 'task-progress:semantic-retry',
      })).toMatchObject({ ok: true, existing: true, completedTasks: 3, totalTasks: 3 })
    })
    expect(appRef.current.taskAssignmentHistory[0].progressHistory).toHaveLength(1)
    expect(appRef.current.notifications).toHaveLength(3)

    const changedProgress = {
      ...progress,
      tasks: progress.tasks.map((task) => (
        task.id === 'TASK-LOCAL-CURRENT' ? { ...task, completed: false } : task
      )),
    }
    await act(async () => {
      expect(await appRef.current.saveStoreTaskProgress({
        ...changedProgress,
        idempotencyKey: 'task-progress:changed-local-save',
      })).toMatchObject({ ok: true, completedTasks: 2, totalTasks: 3 })
    })
    expect(appRef.current.taskAssignmentHistory[0].progressHistory).toHaveLength(2)
    expect(appRef.current.notifications).toHaveLength(6)

    await act(async () => {
      expect(await appRef.current.saveStoreTaskProgress({
        ...changedProgress,
        idempotencyKey: 'task-progress:changed-semantic-retry',
      })).toMatchObject({ ok: true, existing: true, completedTasks: 2, totalTasks: 3 })
    })
    expect(appRef.current.taskAssignmentHistory[0].progressHistory).toHaveLength(2)
    expect(appRef.current.notifications).toHaveLength(6)

    let restoredProgress
    await act(async () => {
      restoredProgress = await appRef.current.saveStoreTaskProgress({
        ...progress,
        idempotencyKey: 'task-progress:restore-earlier-status',
      })
    })
    expect(restoredProgress).toMatchObject({ ok: true, completedTasks: 3, totalTasks: 3 })
    expect(restoredProgress.existing).not.toBe(true)
    expect(appRef.current.taskAssignmentHistory[0].progressHistory).toHaveLength(3)
    expect(appRef.current.notifications).toHaveLength(9)

    const checkoutPayload = {
      employeeId: employee.id,
      attendanceId: 'ATT-LOCAL-CURRENT',
      at: '2026-08-28T05:00:00.000Z',
      cashRevenue: 0,
      transferRevenue: 0,
      location: { latitude: 10.8, longitude: 106.7, accuracy: 8 },
    }
    await act(async () => {
      expect(await appRef.current.setTaskDone('TASK-LOCAL-CURRENT-REQUIRED', false, employee.id)).toMatchObject({ ok: true })
    })
    await act(async () => {
      expect(await appRef.current.checkOut(checkoutPayload)).toMatchObject({
        ok: false,
        incompleteTaskIds: ['TASK-LOCAL-CURRENT-REQUIRED'],
      })
    })
    expect(appRef.current.attendance.find((record) => record.id === 'ATT-LOCAL-CURRENT')?.checkOutAt).toBeNull()

    await act(async () => {
      expect(await appRef.current.setTaskDone('TASK-LOCAL-CURRENT-REQUIRED', true, employee.id)).toMatchObject({ ok: true })
    })
    await act(async () => {
      expect(await appRef.current.checkOut(checkoutPayload)).toMatchObject({ ok: true, record: { id: 'ATT-LOCAL-CURRENT' } })
    })
  })

  it('sends one violation batch command with the caller idempotency key', async () => {
    api.apiCommand.mockResolvedValueOnce({
      version: 2,
      batchId: 'VIO-BATCH-01',
      violations: [{ id: 'VIO-01' }, { id: 'VIO-02' }],
      totalAmountVnd: 4_000,
    })
    renderProvider()
    await act(async () => {
      expect((await appRef.current.login('support-one', 'password')).ok).toBe(true)
    })

    const payload = {
      targetUnit: 'store',
      storeId: 'STORE-A',
      employeeId: 'E01',
      occurredOn: '2026-08-28',
      shiftId: 'SHIFT-MORNING',
      policyCodes: ['store.violation.late', 'store.violation.forgot_attendance'],
      idempotencyKey: 'violation-batch:stable-test',
    }
    await act(async () => {
      expect(await appRef.current.createViolationBatch(payload)).toMatchObject({ batchId: 'VIO-BATCH-01' })
    })

    expect(api.apiCommand).toHaveBeenCalledWith('violation.create_batch', payload, expect.objectContaining({
      idempotencyKey: 'violation-batch:stable-test',
    }))
  })

  it('limits a store manager violation batch to the assigned store', async () => {
    const bootstrap = () => ({ user: storeManagerUser, state: makeRemoteState('STORE-A'), policies: [], version: 1 })
    api.apiLogin.mockResolvedValue({ user: storeManagerUser })
    api.apiBootstrapState.mockImplementation(async () => bootstrap())
    api.apiGetState.mockImplementation(async () => bootstrap())
    api.apiCommand.mockResolvedValue({ version: 2, batchId: 'VIO-MANAGER-OWN' })
    renderProvider()
    await act(async () => {
      expect((await appRef.current.login('manager-a', 'password')).ok).toBe(true)
    })

    await act(async () => {
      await expect(appRef.current.createViolationBatch({
        targetUnit: 'store', storeId: 'STORE-B', employeeId: 'E02', occurredOn: '2026-08-28',
        shiftId: 'SHIFT-MORNING', policyCodes: ['store.violation.late'],
      })).rejects.toThrow('chỉ được ghi nhận vi phạm tại cửa hàng được phân quyền')
    })
    expect(api.apiCommand).not.toHaveBeenCalled()

    await act(async () => {
      expect(await appRef.current.createViolationBatch({
        targetUnit: 'store', storeId: 'STORE-A', employeeId: 'E01', occurredOn: '2026-08-28',
        shiftId: 'SHIFT-MORNING', policyCodes: ['store.violation.late'], idempotencyKey: 'manager-own-store',
      })).toMatchObject({ batchId: 'VIO-MANAGER-OWN' })
    })
    expect(api.apiCommand.mock.calls.find(([type]) => type === 'violation.create_batch')?.[1]).toMatchObject({ storeId: 'STORE-A' })
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
