import { act, cleanup, render } from '@testing-library/react'
import { createRef, forwardRef, useImperativeHandle } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppProvider, canonicalizeRemoteOperationalIdentifiers, createInitialState, useApp } from './AppContext'

const api = vi.hoisted(() => ({
  apiBootstrapState: vi.fn(),
  apiCommand: vi.fn(),
  apiGetAccountAvatar: vi.fn(),
  apiGetState: vi.fn(),
  apiGetStoreWorkspaceState: vi.fn(),
  apiLogin: vi.fn(),
  apiSelectSessionRole: vi.fn(),
  apiListUsers: vi.fn(),
  apiLogout: vi.fn(),
  clearApiSession: vi.fn(),
  localFallback: false,
}))

vi.mock('../services/idosiApi', () => ({
  apiBootstrapState: api.apiBootstrapState,
  apiCommand: api.apiCommand,
  apiGetAccountAvatar: api.apiGetAccountAvatar,
  apiGetState: api.apiGetState,
  apiGetStoreWorkspaceState: api.apiGetStoreWorkspaceState,
  apiLogin: api.apiLogin,
  apiSelectSessionRole: api.apiSelectSessionRole,
  apiListUsers: api.apiListUsers,
  apiLogout: api.apiLogout,
  apiPolicyEntries: () => [],
  apiPolicyMap: () => ({}),
  clearApiSession: api.clearApiSession,
  hasApiSession: () => false,
  isLocalApiFallbackAllowed: () => api.localFallback,
}))

const users = {
  admin: {
    id: 'ADMIN', username: 'admin', displayName: 'Admin IDOSI', role: 'admin', status: 'active', version: 1,
  },
  store_manager: {
    id: 'SM-01', username: 'manager', displayName: 'Quản lý', role: 'store_manager', storeId: 'CH001', status: 'active', version: 1,
  },
}

const createRemoteFixture = () => {
  const state = createInitialState()
  const [first, second, third, fourth] = state.orderInformationOptions
  const inactive = (option, reason) => ({
    ...option,
    active: false,
    deletedAt: '2026-08-24T00:00:00.000Z',
    deletedBy: { id: 'ADMIN', name: 'Admin IDOSI', role: 'admin' },
    deleteReason: reason,
  })
  const orderInformationOptions = [
    inactive(first, 'Nghề nghiệp cũ'),
    inactive(second, 'Không còn dùng'),
    third,
    fourth,
  ]
  const storeId = state.activeStoreId
  const legacyOrder = {
    id: 'ORD-LEGACY-001',
    code: 'LEGACY-001',
    storeId,
    customerName: 'Khách cũ',
    customerPhone: '0901000000',
    customerAge: 30,
    gender: 'Nam',
    occupation: first.label,
    acquisitionChannel: 'Facebook',
    amount: 350_000,
    paymentMethod: 'Tiền mặt',
    status: 'Hoàn tất',
    createdAt: '2026-08-24T00:00:00.000Z',
    updatedAt: '2026-08-24T00:00:00.000Z',
    deletedAt: null,
  }
  const unknownLegacyOrder = {
    ...legacyOrder,
    id: 'ORD-LEGACY-UNKNOWN',
    code: 'LEGACY-UNKNOWN',
    customerName: 'Khách nghề legacy',
    occupation: 'Nghề legacy ngoài danh mục',
  }
  const employee = {
    ...state.employees[0],
    workTimeSchedule: [{ effectiveFrom: '2026-08-01', workStart: '08:00', workEnd: '17:00' }],
  }
  return {
    ...state,
    employees: [employee, ...state.employees.slice(1)],
    orderInformationOptions,
    orders: [legacyOrder, unknownLegacyOrder, ...state.orders],
    legacyOrder,
    unknownLegacyOrder,
  }
}

let appRef
let remoteState

const Probe = forwardRef(function Probe(_props, ref) {
  const app = useApp()
  useImperativeHandle(ref, () => app, [app])
  return null
})

const renderRemote = async (role = 'admin') => {
  const user = users[role]
  const payload = () => ({ user, state: remoteState, policies: [], version: 1 })
  api.apiLogin.mockResolvedValue({ user })
  api.apiBootstrapState.mockImplementation(async () => payload())
  api.apiGetState.mockImplementation(async () => payload())
  api.apiListUsers.mockResolvedValue({ users: [user] })
  render(<AppProvider><Probe ref={appRef} /></AppProvider>)
  await act(async () => {
    expect((await appRef.current.login(user.username, 'password')).ok).toBe(true)
  })
}

const renderLocalAdmin = async () => {
  const unavailable = Object.assign(new Error('API unavailable'), { code: 'API_UNAVAILABLE' })
  api.localFallback = true
  api.apiLogin.mockRejectedValue(unavailable)
  render(<AppProvider><Probe ref={appRef} /></AppProvider>)
  await act(async () => {
    expect((await appRef.current.login('admin', 'idosi123')).ok).toBe(true)
  })
}

const commandPayload = (type) => api.apiCommand.mock.calls.find(([command]) => command === type)?.[1]

describe('AppContext order information options', () => {
  beforeEach(() => {
    appRef = createRef()
    remoteState = createRemoteFixture()
    api.localFallback = false
    localStorage.clear()
    sessionStorage.clear()
    api.apiCommand.mockImplementation(async (type, payload) => ({
      version: 2,
      option: { id: payload.optionId || 'OCC-NEW', ...payload },
      options: remoteState.orderInformationOptions,
      order: type === 'order.update'
        ? { ...remoteState.legacyOrder, ...payload }
        : { ...remoteState.legacyOrder, id: 'ORD-NEW', code: 'NEW-001', ...payload },
    }))
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
    localStorage.clear()
    sessionStorage.clear()
  })

  it('canonicalizes non-credential operational references without changing usernames', () => {
    const canonical = canonicalizeRemoteOperationalIdentifiers({
      stores: [{ id: 'SM-TNV' }],
      employees: [{ id: 'ST-003', code: 'NV-003', storeId: 'SM-TNV' }],
      shiftDefinitions: [{ id: 'CA-SANG', storeId: 'SM-TNV' }],
      attendance: [{ id: 'ATT-001', employeeId: 'st-003', storeId: 'sm-tnv', shiftId: 'ca-sang' }],
      tasks: [{ id: 'TASK-001', employeeIds: ['st-003'], storeId: 'sm-tnv', shift: 'ca-sang', checklistAttendanceId: 'att-001' }],
      orders: [{ id: 'ORDER-001', employeeId: 'nv-003', storeId: 'sm-tnv', attendanceId: 'att-001' }],
      payrollPeriods: [{ id: 'PAY-001', rows: [{ employeeId: 'st-003', storeId: 'sm-tnv' }] }],
      supportTransfers: [{ id: 'TRANSFER-001', employeeId: 'st-003', fromStoreId: 'sm-tnv', toStoreId: 'sm-tnv' }],
      account: { username: 'CaseSensitive.User', activeTransferId: 'transfer-001' },
    })

    expect(canonical.attendance[0]).toMatchObject({ employeeId: 'ST-003', storeId: 'SM-TNV', shiftId: 'CA-SANG' })
    expect(canonical.tasks[0]).toMatchObject({
      employeeIds: ['ST-003'], storeId: 'SM-TNV', shift: 'CA-SANG', checklistAttendanceId: 'ATT-001',
    })
    expect(canonical.orders[0]).toMatchObject({ employeeId: 'ST-003', storeId: 'SM-TNV', attendanceId: 'ATT-001' })
    expect(canonical.payrollPeriods[0].rows[0]).toMatchObject({ employeeId: 'ST-003', storeId: 'SM-TNV' })
    expect(canonical.supportTransfers[0]).toMatchObject({ employeeId: 'ST-003', fromStoreId: 'SM-TNV', toStoreId: 'SM-TNV' })
    expect(canonical.account).toMatchObject({ username: 'CaseSensitive.User', activeTransferId: 'TRANSFER-001' })
  })

  it('does not rewrite protected or audited remote identifiers during an Admin state sync', async () => {
    const employeeId = String(remoteState.employees[0].id)
    const storeId = String(remoteState.stores[0].id)
    const attendance = {
      id: 'ATT-REMOTE-RAW',
      employeeId: employeeId.toLocaleLowerCase('en-US'),
      storeId: storeId.toLocaleLowerCase('en-US'),
      date: '2026-08-30',
      checkInAt: '2026-08-30T01:00:00.000Z',
    }
    const audit = {
      id: 'AUD-REMOTE-RAW',
      entity: 'attendance',
      entityId: 'att-remote-raw',
      after: {
        attendanceId: 'att-remote-raw',
        employeeId: employeeId.toLocaleLowerCase('en-US'),
        storeId: storeId.toLocaleLowerCase('en-US'),
      },
    }
    remoteState = { ...remoteState, attendance: [attendance], auditLogs: [audit] }

    await renderRemote('admin')
    expect(appRef.current.attendance).toEqual([attendance])
    expect(appRef.current.auditLogs).toEqual([audit])

    vi.useFakeTimers()
    try {
      act(() => {
        appRef.current.addOfficeAdjustment({
          employeeId,
          employeeName: 'Nhân viên kiểm thử',
          amount: 1_000,
          type: 'Thưởng',
          content: 'Kích hoạt đồng bộ state không được sửa lịch sử',
        })
      })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(500)
      })

      const statePatch = api.apiCommand.mock.calls.find(([type]) => type === 'state.merge')
      expect(statePatch?.[1]?.patch?.officeAdjustments).toEqual(expect.arrayContaining([
        expect.objectContaining({ employeeId, amount: 1_000 }),
      ]))
      expect(statePatch?.[1]?.patch).not.toHaveProperty('attendance')
      expect(statePatch?.[1]?.patch).not.toHaveProperty('auditLogs')
      expect(statePatch?.[2]).toMatchObject({ includeState: false })
    } finally {
      vi.useRealTimers()
    }
  })

  it('rebases only the changed collection after an Admin patch version conflict', async () => {
    await renderRemote('admin')
    const concurrentAdjustment = {
      id: 'OFFICE-REMOTE-CONCURRENT',
      employeeId: remoteState.employees[0].id,
      amount: 2_000,
      type: 'Thưởng',
      content: 'Ghi nhận từ phiên khác',
    }
    api.apiCommand
      .mockRejectedValueOnce(Object.assign(new Error('conflict'), { code: 'VERSION_CONFLICT' }))
      .mockResolvedValueOnce({ version: 3 })
    api.apiGetState.mockResolvedValue({
      user: users.admin,
      state: { ...remoteState, officeAdjustments: [concurrentAdjustment] },
      policies: [],
      version: 2,
    })

    vi.useFakeTimers()
    try {
      act(() => {
        appRef.current.addOfficeAdjustment({
          employeeId: remoteState.employees[0].id,
          employeeName: remoteState.employees[0].name,
          amount: 1_000,
          type: 'Thưởng',
          content: 'Ghi nhận tại phiên hiện tại',
        })
      })
      await act(async () => { await vi.advanceTimersByTimeAsync(500) })

      const statePatches = api.apiCommand.mock.calls.filter(([type]) => type === 'state.merge')
      expect(statePatches).toHaveLength(2)
      expect(statePatches[1][1].patch.officeAdjustments).toEqual(expect.arrayContaining([
        concurrentAdjustment,
        expect.objectContaining({ amount: 1_000, content: 'Ghi nhận tại phiên hiện tại' }),
      ]))
      expect(statePatches[1][1].patch).not.toHaveProperty('attendance')
      expect(statePatches[1][1].patch).not.toHaveProperty('orders')
      expect(appRef.current.officeAdjustments).toEqual(expect.arrayContaining([
        concurrentAdjustment,
        expect.objectContaining({ amount: 1_000, content: 'Ghi nhận tại phiên hiện tại' }),
      ]))
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps only local fallback credentials case-sensitive', async () => {
    const unavailable = Object.assign(new Error('API unavailable'), { code: 'API_UNAVAILABLE' })
    api.localFallback = true
    api.apiLogin.mockRejectedValue(unavailable)
    render(<AppProvider><Probe ref={appRef} /></AppProvider>)

    await act(async () => {
      expect(await appRef.current.login('Admin', 'idosi123')).toMatchObject({ ok: false })
      expect(await appRef.current.login('admin', 'IDOSI123')).toMatchObject({ ok: false })
      expect(await appRef.current.login('admin', 'idosi123')).toMatchObject({ ok: true })
    })
  })

  it('hydrates the remote collection, exposes CRUD actions, and uses the worker command contract', async () => {
    await renderRemote('admin')
    const [first, second, third, fourth] = remoteState.orderInformationOptions
    const reversedIds = [...remoteState.orderInformationOptions].reverse().map((option) => option.id)

    expect(appRef.current.orderInformationOptions.map((option) => option.id)).toEqual(
      remoteState.orderInformationOptions.map((option) => option.id),
    )
    expect(Object.hasOwn(appRef.current, 'setEmployeeWorkingTime')).toBe(false)
    expect(appRef.current.employees[0].workTimeSchedule).toEqual(remoteState.employees[0].workTimeSchedule)

    await act(async () => {
      expect((await appRef.current.createOrderInformationOption({ label: '  Kiến trúc   sư ', code: ' occ-901 ' })).ok).toBe(true)
    })
    await act(async () => {
      expect((await appRef.current.updateOrderInformationOption(fourth.id, { label: 'Kỹ sư phần mềm', code: 'occ-004' })).ok).toBe(true)
    })
    await act(async () => {
      expect((await appRef.current.deleteOrderInformationOption(third.id, '  Ngừng dùng  ')).ok).toBe(true)
    })
    await act(async () => {
      expect((await appRef.current.restoreOrderInformationOption(first.id)).ok).toBe(true)
    })
    await act(async () => {
      expect((await appRef.current.reorderOrderInformationOptions(reversedIds)).ok).toBe(true)
    })

    expect(commandPayload('order_information.create')).toEqual({ label: 'Kiến trúc sư', code: 'OCC-901' })
    expect(commandPayload('order_information.update')).toEqual({
      optionId: fourth.id, label: 'Kỹ sư phần mềm', code: 'OCC-004',
    })
    expect(commandPayload('order_information.disable')).toEqual({ optionId: third.id, reason: 'Ngừng dùng' })
    expect(commandPayload('order_information.restore')).toEqual({ optionId: first.id })
    expect(commandPayload('order_information.reorder')).toEqual({ orderedIds: reversedIds })
    expect(second.active).toBe(false)
  })

  it('performs audited CRUD, soft-disable, restore, and reorder in local fallback mode', async () => {
    await renderLocalAdmin()
    let created

    await act(async () => {
      created = await appRef.current.createOrderInformationOption({ label: 'Chuyên viên dữ liệu', code: 'occ-950' })
    })
    expect(created.ok).toBe(true)
    expect(appRef.current.orderInformationOptions.find((option) => option.id === created.option.id)).toMatchObject({
      label: 'Chuyên viên dữ liệu', code: 'OCC-950', active: true,
    })

    await act(async () => {
      expect((await appRef.current.updateOrderInformationOption(created.option.id, {
        label: 'Chuyên gia dữ liệu', code: 'occ-951',
      })).ok).toBe(true)
    })
    await act(async () => {
      expect((await appRef.current.deleteOrderInformationOption(created.option.id, 'Tạm ngừng')).ok).toBe(true)
    })
    expect(appRef.current.orderInformationOptions.find((option) => option.id === created.option.id)).toMatchObject({
      active: false, deleteReason: 'Tạm ngừng',
    })

    await act(async () => {
      expect((await appRef.current.restoreOrderInformationOption(created.option.id)).ok).toBe(true)
    })
    expect(appRef.current.orderInformationOptions.find((option) => option.id === created.option.id)).toMatchObject({
      active: true, deletedAt: null, deletedBy: null,
    })

    const reversedIds = [...appRef.current.orderInformationOptions].reverse().map((option) => option.id)
    await act(async () => {
      expect((await appRef.current.reorderOrderInformationOptions(reversedIds)).ok).toBe(true)
    })
    expect(appRef.current.orderInformationOptions.map((option) => option.id)).toEqual(reversedIds)
    expect(appRef.current.auditLogs.slice(0, 5).map((entry) => entry.action)).toEqual([
      'reorder', 'restore', 'disable', 'update', 'create',
    ])
    expect(api.apiCommand).not.toHaveBeenCalled()
  })

  it('rejects option mutations for a store manager before a remote command', async () => {
    await renderRemote('store_manager')

    let result
    await act(async () => {
      result = await appRef.current.createOrderInformationOption({ label: 'Kế toán', code: 'OCC-999' })
    })

    expect(result).toMatchObject({ ok: false })
    expect(api.apiCommand).not.toHaveBeenCalled()
  })

  it('validates active/inactive occupations and exactly two payment methods before order commands', async () => {
    await renderRemote('admin')
    const [legacyInactive, otherInactive, activeOccupation] = remoteState.orderInformationOptions
    const baseCreate = {
      storeId: remoteState.activeStoreId,
      customerName: 'Khách mới',
      gender: 'Nữ',
      acquisitionChannel: 'Zalo',
      amount: 35,
    }

    let inactiveCreate
    let invalidPaymentCreate
    await act(async () => {
      inactiveCreate = await appRef.current.createOrder({
        ...baseCreate, occupation: legacyInactive.label, paymentMethod: 'Tiền mặt',
      })
      invalidPaymentCreate = await appRef.current.createOrder({
        ...baseCreate, occupation: activeOccupation.label, paymentMethod: 'Ví điện tử',
      })
    })
    expect(inactiveCreate.ok).toBe(false)
    expect(invalidPaymentCreate.ok).toBe(false)

    await act(async () => {
      expect((await appRef.current.createOrder({
        ...baseCreate, occupation: activeOccupation.label, paymentMethod: 'Tiền mặt',
      })).ok).toBe(true)
    })
    await act(async () => {
      expect((await appRef.current.createOrder({
        ...baseCreate, occupation: activeOccupation.label, paymentMethod: 'Chuyển khoản',
      })).ok).toBe(true)
    })

    await act(async () => {
      expect((await appRef.current.updateOrder(remoteState.legacyOrder.id, {
        customerName: 'Khách cũ đã sửa',
        occupation: legacyInactive.label,
        paymentMethod: 'Tiền mặt',
        reason: 'Bổ sung tên',
      })).ok).toBe(true)
    })
    await act(async () => {
      expect((await appRef.current.updateOrder(remoteState.unknownLegacyOrder.id, {
        customerName: 'Khách nghề legacy đã sửa',
        occupation: remoteState.unknownLegacyOrder.occupation,
        paymentMethod: 'Tiền mặt',
        reason: 'Sửa tên, giữ nghề lịch sử',
      })).ok).toBe(true)
    })

    let changedToInactive
    let invalidPaymentUpdate
    await act(async () => {
      changedToInactive = await appRef.current.updateOrder(remoteState.legacyOrder.id, {
        occupation: otherInactive.label,
        reason: 'Thử đổi nghề',
      })
      invalidPaymentUpdate = await appRef.current.updateOrder(remoteState.legacyOrder.id, {
        paymentMethod: 'Ví điện tử',
        reason: 'Thử đổi thanh toán',
      })
    })
    expect(changedToInactive.ok).toBe(false)
    expect(invalidPaymentUpdate.ok).toBe(false)

    const createCommands = api.apiCommand.mock.calls.filter(([type]) => type === 'order.create')
    expect(createCommands.map(([, payload]) => payload.paymentMethod)).toEqual(['Tiền mặt', 'Chuyển khoản'])
    expect(createCommands.every(([, payload]) => payload.amount === 35)).toBe(true)
    const updateCommands = api.apiCommand.mock.calls.filter(([type]) => type === 'order.update')
    expect(updateCommands).toHaveLength(2)
    expect(updateCommands[1][1]).toMatchObject({
      orderId: remoteState.unknownLegacyOrder.id,
      occupation: remoteState.unknownLegacyOrder.occupation,
    })
  })
})
