import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { StoreEmployees } from './StoreOperations'
import { StoreManagerManagement } from '../admin/RoleManagement'

const mocked = vi.hoisted(() => ({ app: {} }))
vi.mock('../../state/AppContext', () => ({ useApp: () => mocked.app }))
vi.mock('../../services/employeeAvatarCache', () => ({
  loadEmployeeAvatarUrl: async () => '', subscribeEmployeeAvatarUpdates: () => () => {},
}))

afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks() })

const setup = (unit = 'store', role = 'business_support', extras = {}) => {
  const profile = { id: 'CANONICAL', name: 'Nhân sự thử', unit, storeId: 'S01', status: 'Đang làm việc', employmentType: 'Part-Time' }
  const action = vi.fn()
  mocked.app = {
    session: { role, storeId: 'S01' }, activeStoreId: 'S01',
    stores: [{ id: 'S01', name: 'Cửa hàng nguồn' }, { id: 'S02', name: 'Cửa hàng hỗ trợ' }],
    employees: [profile], storeManagers: unit === 'store_manager' ? [profile] : [],
    supportTransfers: [], attendance: [], policies: {}, notify: vi.fn(),
    deleteEmployee: action, deleteStoreManager: action, ...extras,
  }
  const Component = unit === 'store' ? StoreEmployees : StoreManagerManagement
  render(<MemoryRouter><Component /></MemoryRouter>)
  return action
}

describe('personnel deletion interactions', () => {
  it.each(['store', 'store_manager'])('confirms %s deletion, cancels safely and blocks repeated submission', async (unit) => {
    const action = setup(unit)
    fireEvent.click(screen.getByRole('button', { name: 'Xóa Nhân sự thử' }))
    fireEvent.click(screen.getByRole('button', { name: 'Hủy', exact: true }))
    expect(action).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Xóa Nhân sự thử' }))
    let resolve
    action.mockImplementationOnce(() => new Promise((done) => { resolve = done }))
    const confirm = screen.getByRole('button', { name: unit === 'store' ? 'XÓA NHÂN VIÊN' : 'XÓA HỒ SƠ' })
    fireEvent.click(confirm)
    fireEvent.click(confirm)
    expect(action).toHaveBeenCalledTimes(1)
    expect(action).toHaveBeenCalledWith('CANONICAL')
    expect(confirm.disabled).toBe(true)
    expect(screen.getByRole('dialog')).toBeTruthy()
    await act(async () => { resolve({ ok: true }) })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it.each(['store', 'store_manager'])('keeps the %s row and confirmation open on API error and permits retry', async (unit) => {
    const action = setup(unit)
    action.mockResolvedValueOnce({ ok: false, message: 'Dữ liệu đã thay đổi trên máy chủ' })
    fireEvent.click(screen.getByRole('button', { name: 'Xóa Nhân sự thử' }))
    const label = unit === 'store' ? 'XÓA NHÂN VIÊN' : 'XÓA HỒ SƠ'
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: label })) })
    expect(screen.getByRole('alert').textContent).toContain('Dữ liệu đã thay đổi trên máy chủ')
    expect(screen.getByRole('button', { name: 'Xóa Nhân sự thử' })).toBeTruthy()
    action.mockRejectedValueOnce(new Error('Mất kết nối'))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: label })) })
    expect(screen.getByRole('alert').textContent).toContain('Mất kết nối')
    expect(action).toHaveBeenCalledTimes(2)
  })

  it.each(['store_manager', 'employee'])('does not expose employee deletion to %s', (role) => {
    setup('store', role)
    expect(screen.queryByRole('button', { name: 'Xóa Nhân sự thử' })).toBeNull()
  })

  it('reserves retired manager deletion for Admin', () => {
    const retired = { id: 'RETIRED', name: 'Quản lý đã nghỉ', unit: 'store_manager', storeId: 'S01', status: 'Đã nghỉ việc' }
    setup('store_manager', 'business_support', { storeManagers: [retired], employees: [retired] })
    expect(screen.queryByRole('button', { name: 'Xóa Quản lý đã nghỉ' })).toBeNull()
    cleanup()
    setup('store_manager', 'admin', { storeManagers: [retired], employees: [retired] })
    expect(screen.getByRole('button', { name: 'Xóa Quản lý đã nghỉ' })).toBeTruthy()
  })

  it.each(['admin', 'manager'])('retains deletion for normalized actor %s', (role) => {
    setup('store', role)
    expect(screen.getByRole('button', { name: 'Xóa Nhân sự thử' })).toBeTruthy()
  })

  it('uses the source profile for a support row and retains the home-store transfer lock', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-27T09:00:00+07:00'))
    const extras = {
      activeStoreId: 'S02',
      supportTransfers: [{
        id: 'TRANSFER', employeeId: 'CANONICAL', fromStoreId: 'S01', toStoreId: 'S02',
        startAt: '2026-09-27T08:00:00+07:00', endAt: '2026-09-27T18:00:00+07:00',
        fromDate: '2026-09-27', toDate: '2026-09-27', status: 'Đã duyệt',
      }],
    }
    const action = setup('store', 'business_support', extras)
    action.mockResolvedValue({ ok: true })
    fireEvent.click(screen.getByRole('button', { name: 'Xóa Nhân sự thử' }))
    expect(screen.getByRole('dialog').textContent).toContain('Cửa hàng nguồn')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'XÓA NHÂN VIÊN' })) })
    expect(action).toHaveBeenCalledWith('CANONICAL')
    cleanup()
    setup('store', 'business_support', { ...extras, activeStoreId: 'S01' })
    expect(screen.queryByRole('button', { name: 'Xóa Nhân sự thử' })).toBeNull()
  })
})
