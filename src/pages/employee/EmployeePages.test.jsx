import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EmployeePayroll, EmployeeShiftHistory } from './EmployeePages'

const mocked = vi.hoisted(() => ({ app: {} }))

vi.mock('../../state/AppContext', () => ({
  useApp: () => mocked.app,
}))

afterEach(cleanup)

describe('employee work-history route', () => {
  const employeeApp = () => ({
    session: { role: 'employee', employeeId: 'E01', storeId: 'S01', homeStoreId: 'S01' },
    employees: [{
      id: 'E01', name: 'Nguyễn Văn A', storeId: 'S01', unit: 'store', employmentType: 'Full-Time', baseSalary: 8_000_000,
    }],
    stores: [{ id: 'S01', name: 'Dosii TNV', status: 'Đang hoạt động' }],
    storeEmployeeSalaryConfigs: [{
      id: 'CFG-01', employeeId: 'E01', storeId: 'S01', effectiveFrom: '2026-08',
      thresholdHours: 208, standardHourlyRateVnd: 30_000, excessHourlyRateVnd: 27_000, active: true,
    }],
    supportTransfers: [],
    attendance: [{
      id: 'ATT-HOME', employeeId: 'E01', storeId: 'S01', date: '2026-08-19',
      shift: 'ca1', shiftName: 'Ca cửa hàng chính', checkIn: '08:00', checkOut: '17:00', hours: 8,
    }, {
      id: 'ATT-DELETED', employeeId: 'E01', storeId: 'S01', date: '2026-08-19',
      shift: 'ca1', shiftName: 'Ca đã xóa', checkIn: '08:00', checkOut: '17:00', hours: 100,
      deletedAt: '2026-08-20T00:00:00.000Z',
    }, {
      id: 'ATT-SUPPORT', employeeId: 'E01', storeId: 'S02', date: '2026-08-20',
      shift: 'support', shiftName: 'Ca hỗ trợ', checkIn: '14:00', checkOut: '17:00', hours: 3,
      supportTransferId: 'TR-01',
      supportCompensation: {
        transferId: 'TR-01', homeStoreId: 'S01', supportStoreId: 'S02', supportStoreName: 'Dosii KVC',
        transferStartAt: '2026-08-20T14:00:00+07:00', transferEndAt: '2026-08-20T21:00:00+07:00',
        hourlyRate: 29_000, hours: 3, basePay: 87_000, allowance: 50_000,
        allowanceApplied: true, totalPay: 137_000,
      },
    }],
    notify: vi.fn(),
  })

  it('uses canonical tiered home pay while preserving support compensation', () => {
    mocked.app = employeeApp()

    render(
      <MemoryRouter initialEntries={['/employee/work-history']}>
        <Routes><Route path="/employee/work-history" element={<EmployeeShiftHistory />} /></Routes>
      </MemoryRouter>,
    )

    expect(screen.getByRole('heading', { name: 'LỊCH SỬ CA LÀM' })).toBeTruthy()
    expect(screen.getByText('Ca cửa hàng chính')).toBeTruthy()
    expect(screen.getByText('240,000 đ')).toBeTruthy()
    expect(screen.getByText('Đến 208 giờ: 30,000 đ/giờ · Vượt: 27,000 đ/giờ')).toBeTruthy()
    expect(screen.getByText('Ca hỗ trợ • Dosii KVC')).toBeTruthy()
    expect(screen.getByText('20/08/2026 14:00 – 20/08/2026 21:00')).toBeTruthy()
    expect(screen.getByText('29,000 đ/giờ • Phụ cấp 50,000 đ')).toBeTruthy()
    expect(screen.getByText('3.00 giờ × 29,000 đ + 50,000 đ')).toBeTruthy()
    expect(screen.getByText('137,000 đ')).toBeTruthy()
  })

  it('keeps support pay separate from tiered home pay in the legacy payroll reader', () => {
    mocked.app = employeeApp()

    render(<MemoryRouter><EmployeePayroll /></MemoryRouter>)

    expect(screen.getByText('LƯƠNG CỬA HÀNG CHÍNH')).toBeTruthy()
    expect(screen.getAllByText('240,000 đ').length).toBeGreaterThan(0)
    expect(screen.getByText('LƯƠNG CA HỖ TRỢ')).toBeTruthy()
    expect(screen.getAllByText('137,000 đ').length).toBeGreaterThan(0)
    expect(screen.getAllByText('377,000 đ').length).toBeGreaterThan(0)
    expect(screen.queryByText('Ca đã xóa')).toBeNull()
  })
})
