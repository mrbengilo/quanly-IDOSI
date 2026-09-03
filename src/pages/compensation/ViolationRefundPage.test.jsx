import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ViolationRefundPage } from './ViolationRefundPage'

const mocked = vi.hoisted(() => ({ app: {} }))

vi.mock('../../state/AppContext', () => ({ useApp: () => mocked.app }))

const stores = [
  { id: 'STORE-A', name: 'Dosii NVT' },
  { id: 'STORE-B', name: 'SM TNV' },
]

const refunds = [{
  id: 'REFUND-1',
  storeId: 'STORE-A',
  employeeId: 'EMP-HOME',
  employeeName: 'Nhân viên chính',
  employeeHomeStoreId: 'STORE-A',
  title: 'Đi trễ',
  policyCode: 'store.violation.late',
  occurredOn: '2026-09-01',
  shiftName: 'Ca sáng',
  shiftStart: '08:00',
  shiftEnd: '12:00',
  amountVnd: 3_000,
  status: 'RECOGNIZED',
  recognizedAt: '2026-09-02T02:00:00.000Z',
}, {
  id: 'REFUND-2',
  storeId: 'STORE-A',
  employeeId: 'EMP-SUPPORT',
  employeeName: 'Nhân viên hỗ trợ',
  employeeHomeStoreId: 'STORE-B',
  supportStoreId: 'STORE-A',
  supportTransferId: 'TRANSFER-1',
  title: 'Quên chấm công',
  occurredOn: '2026-09-02',
  amountVnd: 2_000,
  status: 'PENDING_PAYROLL',
  period: '2026-09',
}, {
  id: 'REFUND-VOID',
  storeId: 'STORE-A',
  employeeId: 'EMP-HOME',
  employeeName: 'Nhân viên chính',
  employeeHomeStoreId: 'STORE-A',
  title: 'Bản ghi đã hủy',
  occurredOn: '2026-09-02',
  amountVnd: 99_000,
  status: 'VOID',
  voidReason: 'Ghi nhận nhầm',
}, {
  id: 'REFUND-OTHER-STORE',
  storeId: 'STORE-B',
  employeeId: 'EMP-OTHER',
  employeeName: 'Nhân viên cửa hàng khác',
  employeeHomeStoreId: 'STORE-B',
  title: 'Vi phạm cửa hàng khác',
  occurredOn: '2026-09-02',
  amountVnd: 8_000,
  status: 'RECOGNIZED',
}, {
  id: 'REFUND-WRONG-CASE',
  storeId: 'store-a',
  employeeId: 'EMP-WRONG-CASE',
  employeeName: 'Sai phạm vi chữ hoa',
  title: 'Không được chiếu nhầm',
  occurredOn: '2026-09-02',
  amountVnd: 12_000,
  status: 'RECOGNIZED',
}]

const baseApp = (role = 'admin') => ({
  session: role === 'store_manager'
    ? { role, name: 'Quản lý', storeId: 'STORE-A' }
    : { role, name: role },
  activeStoreId: role === 'store_manager' ? 'STORE-B' : 'STORE-A',
  stores,
  violationRefunds: refunds,
})

const metric = (label) => screen.getByText(label).closest('.metric')

describe('ViolationRefundPage', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-02T05:00:00.000Z'))
    mocked.app = baseApp()
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('shows only exact current-store refunds with safe financial totals and employee origin', () => {
    render(<ViolationRefundPage />)

    expect(screen.getByRole('heading', { name: 'HOÀN TRẢ VI PHẠM' })).toBeTruthy()
    expect(within(screen.getByRole('group', { name: 'Cửa hàng hiện tại' })).getByText('Dosii NVT')).toBeTruthy()
    expect(screen.queryByRole('combobox', { name: 'Cửa hàng' })).toBeNull()
    expect(screen.getAllByText('Nhân viên chính').length).toBeGreaterThan(0)
    expect(screen.getByText('Nhân viên hỗ trợ • Từ SM TNV')).toBeTruthy()
    expect(screen.queryByText('Nhân viên cửa hàng khác')).toBeNull()
    expect(screen.queryByText('Sai phạm vi chữ hoa')).toBeNull()
    expect(within(metric('TỔNG ĐÃ CỘNG DOANH THU')).getByText('3,000 đ')).toBeTruthy()
    expect(within(metric('CHỜ QUYẾT TOÁN')).getByText('2,000 đ')).toBeTruthy()
    expect(within(metric('SỐ LƯỢT HOÀN TRẢ')).getByText('2')).toBeTruthy()
    expect(screen.getByText('Đã hủy')).toBeTruthy()
    expect(screen.getByText('99,000 đ')).toBeTruthy()
  })

  it('filters historical snapshot rows by day, month and exact employee id', () => {
    mocked.app = {
      ...baseApp(),
      violationRefunds: [
        ...refunds,
        {
          id: 'REFUND-AUGUST', storeId: 'STORE-A', employeeId: 'FORMER-01', employeeName: 'Nhân viên đã nghỉ',
          employeeHomeStoreId: 'STORE-A', title: 'Vi phạm tháng Tám', occurredOn: '2026-08-20', amountVnd: 4_000, status: 'RECOGNIZED',
        },
      ],
    }
    render(<ViolationRefundPage />)

    fireEvent.change(screen.getByLabelText('Tháng hoàn trả vi phạm'), { target: { value: '2026-08' } })
    expect(screen.getAllByText('Nhân viên đã nghỉ').length).toBeGreaterThan(0)
    expect(screen.queryByText('Đi trễ')).toBeNull()
    fireEvent.change(screen.getByLabelText('Nhân viên được hoàn trả vi phạm'), { target: { value: 'FORMER-01' } })
    expect(screen.getByText('Vi phạm tháng Tám')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Ngày hoàn trả vi phạm'), { target: { value: '2026-08-21' } })
    expect(screen.getByText('Chưa có khoản hoàn trả vi phạm phù hợp bộ lọc.')).toBeTruthy()
  })

  it('locks store managers to their assigned store instead of the globally active store', () => {
    mocked.app = baseApp('store_manager')
    render(<ViolationRefundPage />)

    expect(within(screen.getByRole('group', { name: 'Cửa hàng hiện tại' })).getByText('Dosii NVT')).toBeTruthy()
    expect(screen.getByText('Đi trễ')).toBeTruthy()
    expect(screen.queryByText('Vi phạm cửa hàng khác')).toBeNull()
  })

  it('fails closed when a case-folded store reference is ambiguous', () => {
    mocked.app = {
      ...baseApp(),
      activeStoreId: 'Store-A',
      stores: [{ id: 'STORE-A', name: 'Cửa hàng hoa' }, { id: 'store-a', name: 'Cửa hàng thường' }],
    }
    render(<ViolationRefundPage />)

    expect(screen.getByText(/Mã cửa hàng hiện tại bị trùng/i)).toBeTruthy()
    expect(screen.queryByText('Đi trễ')).toBeNull()
  })
})
