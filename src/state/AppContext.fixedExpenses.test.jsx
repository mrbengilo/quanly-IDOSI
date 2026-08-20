import { act, cleanup, render } from '@testing-library/react'
import { createRef, forwardRef, useImperativeHandle } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppProvider, createInitialState, useApp } from './AppContext'

const api = vi.hoisted(() => ({
  apiBootstrapState: vi.fn(),
  apiCommand: vi.fn(),
  apiGetState: vi.fn(),
  apiLogin: vi.fn(),
  apiListUsers: vi.fn(),
  apiLogout: vi.fn(),
  clearApiSession: vi.fn(),
}))

vi.mock('../services/idosiApi', () => ({
  apiBootstrapState: api.apiBootstrapState,
  apiCommand: api.apiCommand,
  apiGetState: api.apiGetState,
  apiLogin: api.apiLogin,
  apiListUsers: api.apiListUsers,
  apiLogout: api.apiLogout,
  apiPolicyEntries: () => [],
  apiPolicyMap: () => ({}),
  clearApiSession: api.clearApiSession,
  hasApiSession: () => false,
  isLocalApiFallbackAllowed: () => false,
}))

const voucher = {
  id: 'FIX-001', storeId: 'S01', type: 'Phiếu chi phí cửa hàng',
  items: [{ category: 'Điện', name: '', amount: 200_000, description: '' }],
  amount: 200_000, totalAmount: 200_000, occurredAt: '2026-08-20T08:00:00.000Z',
  createdBy: { id: 'ADMIN', name: 'Admin IDOSI' }, deletedAt: null,
}
const users = {
  admin: { id: 'ADMIN', username: 'admin', displayName: 'Admin IDOSI', role: 'admin', status: 'active', version: 1 },
  business_support: { id: 'BS-01', username: 'support', displayName: 'Hỗ trợ KD', role: 'business_support', status: 'active', version: 1 },
  store_manager: { id: 'SM-01', username: 'manager', displayName: 'Quản lý', role: 'store_manager', storeId: 'S01', status: 'active', version: 1 },
}
const remoteState = () => ({
  ...createInitialState(),
  stores: [{ id: 'S01', name: 'Dosii KVC' }, { id: 'S02', name: 'Dosii TNV' }],
  activeStoreId: 'S01',
  fixedExpenses: [voucher, { ...voucher, id: 'FIX-OTHER', storeId: 'S02' }],
})

let appRef
const Probe = forwardRef(function Probe(_props, ref) {
  const app = useApp()
  useImperativeHandle(ref, () => app, [app])
  return null
})

const renderFor = async (role) => {
  const user = users[role]
  const payload = () => ({ user, state: remoteState(), policies: [], version: 1 })
  api.apiLogin.mockResolvedValue({ user })
  api.apiBootstrapState.mockImplementation(async () => payload())
  api.apiGetState.mockImplementation(async () => payload())
  api.apiListUsers.mockResolvedValue({ users: [user] })
  render(<AppProvider><Probe ref={appRef} /></AppProvider>)
  await act(async () => { expect((await appRef.current.login(user.username, 'password')).ok).toBe(true) })
}

describe('AppContext store expense voucher commands', () => {
  beforeEach(() => {
    appRef = createRef()
    localStorage.clear()
    sessionStorage.clear()
    api.apiCommand.mockImplementation(async (type) => ({ version: 2, expense: voucher, expenseEntry: { id: 'EXP-001' }, type }))
  })
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
    localStorage.clear()
    sessionStorage.clear()
  })

  it('sends persisted item contracts for create/update and an Admin-only delete reason', async () => {
    await renderFor('admin')
    const items = [{ category: 'Khác', name: 'Bảo trì máy lạnh', amount: 350_000, description: 'Thay linh kiện' }]

    await act(async () => {
      expect((await appRef.current.addFixedExpense({ storeId: 'S01', occurredAt: '2026-08-20T08:00:00.000Z', items, note: 'Tháng 8' })).ok).toBe(true)
      expect((await appRef.current.updateFixedExpense('FIX-001', { items, reason: 'Điều chỉnh nội dung' })).ok).toBe(true)
      expect((await appRef.current.deleteFixedExpense('FIX-001', 'Nhập trùng')).ok).toBe(true)
    })

    expect(api.apiCommand.mock.calls.find(([type]) => type === 'fixed_expense.create')?.[1]).toEqual({
      storeId: 'S01', items, note: 'Tháng 8', occurredAt: '2026-08-20T08:00:00.000Z',
    })
    expect(api.apiCommand.mock.calls.find(([type]) => type === 'fixed_expense.update')?.[1]).toMatchObject({
      expenseId: 'FIX-001', items, reason: 'Điều chỉnh nội dung',
    })
    expect(api.apiCommand.mock.calls.find(([type]) => type === 'fixed_expense.delete')?.[1]).toEqual({ id: 'FIX-001', reason: 'Nhập trùng' })
  })

  it('denies delete for Business Support before any remote command', async () => {
    await renderFor('business_support')
    let result
    await act(async () => { result = await appRef.current.deleteFixedExpense('FIX-001', 'Không hợp lệ') })

    expect(result).toMatchObject({ ok: false })
    expect(api.apiCommand.mock.calls.some(([type]) => type === 'fixed_expense.delete')).toBe(false)
  })

  it('keeps a store manager scoped to the assigned store', async () => {
    await renderFor('store_manager')
    let createResult
    let updateResult
    await act(async () => {
      createResult = await appRef.current.addFixedExpense({ storeId: 'S02', items: [{ category: 'Điện', amount: 50_000 }] })
      updateResult = await appRef.current.updateFixedExpense('FIX-OTHER', { items: [{ category: 'Điện', amount: 50_000 }], reason: 'Sửa' })
    })

    expect(createResult.ok).toBe(false)
    expect(updateResult.ok).toBe(false)
    expect(api.apiCommand).not.toHaveBeenCalled()
  })
})
