import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { StoreEmployees } from './StoreOperations'

const mocked = vi.hoisted(() => ({ app: {} }))
vi.mock('../../state/AppContext', () => ({ useApp: () => mocked.app }))
vi.mock('../../services/employeeAvatarCache', () => ({
  loadEmployeeAvatarUrl: async () => '', subscribeEmployeeAvatarUpdates: () => () => {},
}))

afterEach(() => { cleanup(); vi.restoreAllMocks() })

const employee = (id, status, extra = {}) => ({
  id, name: `Nhân viên ${id}`, unit: 'store', storeId: 'S01', status, employmentType: 'Part-Time', hourlyRate: 30000, salary: 30000,
  phone: '0901234567', cccd: '079123456789', age: 22, startDate: '2026-09-01', username: `user.${id.toLowerCase()}`, authUserId: `usr-${id}`,
  addressDetails: { province: 'TP. Hồ Chí Minh', ward: 'Phường 1', street: '1 Lê Lợi' }, identityImages: { front: { key: 'f' }, back: { key: 'b' } },
  ...extra,
})

const setup = (role = 'business_support', employees = [employee('E1', 'Đang làm việc')], extras = {}) => {
  const updateEmployee = vi.fn().mockResolvedValue({ ok: true })
  mocked.app = {
    session: { role, storeId: 'S01' }, activeStoreId: 'S01',
    stores: [{ id: 'S01', name: 'Cửa hàng 1' }], employees, supportTransfers: [], attendance: [], policies: {},
    notify: vi.fn(), updateEmployee, addEmployee: vi.fn(), deleteEmployee: vi.fn(), ...extras,
  }
  render(<MemoryRouter><StoreEmployees /></MemoryRouter>)
  return updateEmployee
}
const statusSelect = () => screen.getByLabelText(/Trạng thái làm việc/u)

describe('store employee working status', () => {
  it('labels departed as "Đã nghỉ làm" in badges, filters and counts, keeping legacy paused data', () => {
    setup('business_support', [
      employee('E1', 'Đang làm việc'), employee('E2', 'Đã nghỉ việc'), employee('E3', 'inactive'), employee('E4', 'Tạm nghỉ'),
    ])
    expect(screen.getAllByText('Đã nghỉ làm').length).toBeGreaterThanOrEqual(3)
    fireEvent.click(screen.getByRole('button', { name: 'Đã nghỉ làm' }))
    expect(screen.getByText('Nhân viên E2')).toBeTruthy()
    expect(screen.getByText('Nhân viên E3')).toBeTruthy()
    expect(screen.queryByText('Nhân viên E1')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Tạm ngưng' }))
    expect(screen.getByText('Nhân viên E4')).toBeTruthy()
  })

  it('lets HTKD depart a store employee with a status-only update, explains the login impact and blocks double submit', async () => {
    const updateEmployee = setup('business_support', [employee('E1', 'Đang làm việc')], {
      attendance: [{ id: 'A1', employeeId: 'E1', storeId: 'S01', checkOutAt: null }],
    })
    fireEvent.click(screen.getByRole('button', { name: 'Sửa Nhân viên E1' }))
    const options = within(statusSelect()).getAllByRole('option').map((option) => option.textContent)
    expect(options).toEqual(['Đang làm việc', 'Đã nghỉ làm'])
    fireEvent.change(statusSelect(), { target: { value: 'Đã nghỉ việc' } })
    const warning = screen.getByRole('alert').textContent
    expect(warning).toContain('bị khóa ngay')
    expect(warning).toContain('không tự kết ca')
    expect(warning).toContain('ca chưa kết thúc')
    let resolve
    updateEmployee.mockImplementationOnce(() => new Promise((done) => { resolve = done }))
    const confirm = screen.getByRole('button', { name: 'Xác nhận nghỉ làm' })
    fireEvent.click(confirm)
    fireEvent.click(confirm)
    expect(updateEmployee).toHaveBeenCalledTimes(1)
    expect(updateEmployee).toHaveBeenCalledWith('E1', { status: 'Đã nghỉ việc' })
    await act(async () => { resolve({ ok: true }) })
    expect(screen.queryByLabelText(/Trạng thái làm việc/u)).toBeNull()
  })

  it('keeps the dialog open with the server error so the change is not shown as saved', async () => {
    const updateEmployee = setup()
    updateEmployee.mockResolvedValueOnce({ ok: false, message: 'Dữ liệu đã thay đổi trên máy chủ.' })
    fireEvent.click(screen.getByRole('button', { name: 'Sửa Nhân viên E1' }))
    fireEvent.change(statusSelect(), { target: { value: 'Đã nghỉ việc' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Xác nhận nghỉ làm' })) })
    expect(screen.getByText('Dữ liệu đã thay đổi trên máy chủ.')).toBeTruthy()
    expect(statusSelect().value).toBe('Đã nghỉ việc')
  })

  it('does not let HTKD reactivate and does not let a store manager change status', () => {
    setup('business_support', [employee('E2', 'Đã nghỉ việc')])
    fireEvent.click(screen.getByRole('button', { name: 'Sửa Nhân viên E2' }))
    expect(statusSelect().disabled).toBe(true)
    expect(screen.getByText(/Chỉ Admin được khôi phục/u)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Lưu thay đổi' }).disabled).toBe(true)
    cleanup()
    setup('store_manager')
    fireEvent.click(screen.getByRole('button', { name: 'Sửa Nhân viên E1' }))
    expect(statusSelect().disabled).toBe(true)
    expect(screen.getByText(/Chỉ Admin hoặc Hỗ trợ KD được thay đổi trạng thái/u)).toBeTruthy()
  })

  it('keeps a legacy paused value selectable instead of silently activating it', () => {
    setup('business_support', [employee('E4', 'Tạm nghỉ')])
    fireEvent.click(screen.getByRole('button', { name: 'Sửa Nhân viên E4' }))
    expect(statusSelect().value).toBe('Tạm ngưng')
    expect(within(statusSelect()).getAllByRole('option').map((option) => option.textContent)).toEqual(['Đang làm việc', 'Tạm ngưng', 'Đã nghỉ làm'])
  })

  it('explains that only the store role of a shared login is removed', () => {
    setup('business_support', [
      { id: 'H2', name: 'Hỗ trợ KD', unit: 'business_support', storeId: 'BUSINESS_SUPPORT', status: 'Đang làm việc' },
      employee('S1-H2', 'Đang làm việc', { linkedEmployeeId: 'H2', authUserId: undefined }),
    ])
    fireEvent.click(screen.getByRole('button', { name: 'Sửa Nhân viên S1-H2' }))
    fireEvent.change(statusSelect(), { target: { value: 'Đã nghỉ việc' } })
    expect(screen.getByRole('alert').textContent).toContain('chỉ vai trò Nhân viên cửa hàng này bị gỡ')
  })

  it('lets Admin restore a departed employee', async () => {
    const updateEmployee = setup('admin', [employee('E2', 'Đã nghỉ việc')])
    fireEvent.click(screen.getByRole('button', { name: 'Sửa Nhân viên E2' }))
    fireEvent.change(statusSelect(), { target: { value: 'Đang làm việc' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Lưu thay đổi' })) })
    expect(updateEmployee).toHaveBeenCalledWith('E2', { status: 'Đang làm việc' })
  })
})
