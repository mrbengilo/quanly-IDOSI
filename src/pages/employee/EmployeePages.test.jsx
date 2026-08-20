import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EmployeeShiftHistory } from './EmployeePages'

const mocked = vi.hoisted(() => ({ app: {} }))

vi.mock('../../state/AppContext', () => ({
  useApp: () => mocked.app,
}))

afterEach(cleanup)

describe('employee work-history route', () => {
  it('shows canonical support compensation while preserving full-time home pay behavior', () => {
    mocked.app = {
      session: { role: 'employee', employeeId: 'E01', storeId: 'S01', homeStoreId: 'S01' },
      employees: [{
        id: 'E01', name: 'Nguyễn Văn A', storeId: 'S01', employmentType: 'Full-Time', baseSalary: 8_000_000,
      }],
      stores: [{ id: 'S01', name: 'Dosii TNV' }],
      supportTransfers: [],
      attendance: [{
        id: 'ATT-HOME', employeeId: 'E01', storeId: 'S01', date: '2026-08-19',
        shift: 'ca1', shiftName: 'Ca cửa hàng chính', checkIn: '08:00', checkOut: '17:00', hours: 8,
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
    }

    render(
      <MemoryRouter initialEntries={['/employee/work-history']}>
        <Routes><Route path="/employee/work-history" element={<EmployeeShiftHistory />} /></Routes>
      </MemoryRouter>,
    )

    expect(screen.getByRole('heading', { name: 'LỊCH SỬ CA LÀM' })).toBeTruthy()
    expect(screen.getByText('Ca cửa hàng chính')).toBeTruthy()
    expect(screen.getByText('Theo lương tháng')).toBeTruthy()
    expect(screen.getByText('Ca hỗ trợ • Dosii KVC')).toBeTruthy()
    expect(screen.getByText('20/08/2026 14:00 – 20/08/2026 21:00')).toBeTruthy()
    expect(screen.getByText('29,000 đ/giờ • Phụ cấp 50,000 đ')).toBeTruthy()
    expect(screen.getByText('3.00 giờ × 29,000 đ + 50,000 đ')).toBeTruthy()
    expect(screen.getByText('137,000 đ')).toBeTruthy()
  })
})
