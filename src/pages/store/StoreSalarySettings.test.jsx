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
})
