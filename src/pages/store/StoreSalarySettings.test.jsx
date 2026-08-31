import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { StoreSalarySettings } from './StoreSalarySettings'

const mocked = vi.hoisted(() => ({ app: {} }))

vi.mock('../../state/AppContext', () => ({
  useApp: () => mocked.app,
}))

const store = { id: 'CH-DOSII', name: 'Dosii KVC', status: 'Đang hoạt động' }
const employee = {
  id: 'KVC-001',
  name: 'Nguyễn An',
  unit: 'store',
  storeId: store.id,
  status: 'Đang làm việc',
  employmentType: 'Full-Time',
}

const baseApp = (role = 'admin') => ({
  session: { role },
  activeStore: store,
  stores: [store],
  employees: [employee],
  storeEmployeeSalaryConfigs: [],
  setStoreEmployeeSalaryConfig: vi.fn(async () => ({
    salaryConfig: {
      employeeId: employee.id,
      storeId: store.id,
      thresholdHours: 208,
      standardHourlyRateVnd: 30_000,
      excessHourlyRateVnd: 27_000,
    },
  })),
  notify: vi.fn(),
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('StoreSalarySettings', () => {
  it('shows safe Dosii defaults and saves an employee-specific tiered policy', async () => {
    mocked.app = baseApp('admin')
    render(<StoreSalarySettings />)

    expect(screen.getByText('29,000 đ/giờ')).toBeTruthy()
    expect(screen.getByText('25,000 đ/giờ')).toBeTruthy()

    const moneyInputs = screen.getAllByRole('textbox')
    fireEvent.change(moneyInputs[0], { target: { value: '30000' } })
    fireEvent.change(moneyInputs[1], { target: { value: '27000' } })
    fireEvent.click(screen.getByRole('button', { name: 'LƯU CẤU HÌNH' }))

    await waitFor(() => expect(mocked.app.setStoreEmployeeSalaryConfig).toHaveBeenCalledWith(expect.objectContaining({
      employeeId: employee.id,
      storeId: store.id,
      thresholdHours: 208,
      regularHourlyRateVnd: 30_000,
      excessHourlyRateVnd: 27_000,
    })))
  })

  it('denies store managers even when the component is reached directly', () => {
    mocked.app = baseApp('store_manager')
    render(<StoreSalarySettings />)
    expect(screen.getByText(/Chỉ Admin và Nhân viên hỗ trợ KD/u)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'LƯU CẤU HÌNH' })).toBeNull()
  })

  it('shows a repair state and disables saving when salary config ids collide by case', () => {
    mocked.app = {
      ...baseApp('admin'),
      employees: [{ ...employee, storeId: store.id.toLowerCase() }],
      storeEmployeeSalaryConfigs: [{
        id: 'CFG-UPPER', employeeId: employee.id, storeId: store.id, effectiveFrom: '2026-08',
        thresholdHours: 208, standardHourlyRateVnd: 30_000, excessHourlyRateVnd: 27_000,
      }, {
        id: 'CFG-LOWER', employeeId: employee.id.toLowerCase(), storeId: store.id.toLowerCase(), effectiveFrom: '2026-08',
        thresholdHours: 208, standardHourlyRateVnd: 99_000, excessHourlyRateVnd: 98_000,
      }],
    }

    render(<StoreSalarySettings />)

    expect(screen.getByText(/Mã cấu hình lương của nhân viên đang trùng hoa\/thường/u)).toBeTruthy()
    expect(screen.getByText('Trùng mã cấu hình')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'LƯU CẤU HÌNH' }).disabled).toBe(true)
  })

  it('keeps exact employee casing isolated when two employee ids differ only by case', async () => {
    const lowerEmployee = { ...employee, id: employee.id.toLowerCase(), name: 'Nguyễn Bình' }
    mocked.app = { ...baseApp('admin'), employees: [employee, lowerEmployee] }

    render(<StoreSalarySettings />)
    fireEvent.change(screen.getByRole('combobox'), { target: { value: lowerEmployee.id } })
    fireEvent.click(screen.getByRole('button', { name: 'LƯU CẤU HÌNH' }))

    await waitFor(() => expect(mocked.app.setStoreEmployeeSalaryConfig).toHaveBeenCalledWith(expect.objectContaining({
      employeeId: lowerEmployee.id,
      storeId: store.id,
    })))
  })

  it('fails closed when the active store reference is ambiguous by case', () => {
    mocked.app = {
      ...baseApp('admin'),
      activeStore: { ...store, id: 'Ch-DoSiI' },
      stores: [store, { ...store, id: store.id.toLowerCase(), name: 'Dosii duplicate' }],
    }

    render(<StoreSalarySettings />)

    expect(screen.getByText(/Mã cửa hàng đang trùng hoa\/thường/u)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'LƯU CẤU HÌNH' }).disabled).toBe(true)
  })
})
