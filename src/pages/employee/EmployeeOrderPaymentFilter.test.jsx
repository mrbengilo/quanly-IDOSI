import { DEFAULT_ORDER_INFORMATION_OPTIONS } from '../../domain/orderInformationSettings'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { Link, MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EmployeeOrdersPage } from './EmployeeV2Pages'

const mocked = vi.hoisted(() => ({ app: {} }))
vi.mock('../../state/AppContext', () => ({ useApp: () => mocked.app }))

const employee = { id: 'E01', name: 'Nhân viên hỗ trợ', storeId: 'HOME' }
const openAttendance = {
  id: 'ATT-SUPPORT', employeeId: 'E01', storeId: 'SUPPORT',
  date: '2026-09-03', shiftId: 'CA-SUPPORT', shiftName: 'Ca hỗ trợ',
  shiftStart: '08:00', shiftEnd: '12:00', checkInAt: '2026-09-03T01:00:00.000Z',
}

const order = (id, paymentMethod, amount = 100, overrides = {}) => ({
  id, code: id, employeeId: 'E01', createdByEmployeeId: 'E01', storeId: 'SUPPORT',
  attendanceId: 'ATT-SUPPORT', shiftId: 'CA-SUPPORT',
  createdAt: '2026-09-03T02:00:00.000Z', customerName: `Khách ${id}`,
  paymentMethod, amount, ...overrides,
})

const baseApp = () => ({
  // The still-open support attendance must win over this stale home session.
  session: { role: 'employee', employeeId: 'E01', storeId: 'HOME' },
  currentEmployee: employee,
  employees: [employee, { id: 'E02', name: 'Đồng nghiệp', storeId: 'SUPPORT' }],
  stores: [{ id: 'HOME', name: 'Cửa hàng chính' }, { id: 'SUPPORT', name: 'Cửa hàng hỗ trợ' }],
  attendance: [openAttendance, {
    ...openAttendance, id: 'ATT-CLOSED', date: '2026-09-02',
    checkInAt: '2026-09-02T01:00:00.000Z', checkOutAt: '2026-09-02T05:00:00.000Z',
  }],
  orders: [],
  createOrder: vi.fn(), notify: vi.fn(),
})

const renderOrders = (children) => render(<MemoryRouter initialEntries={['/employee/orders']}>
  <EmployeeOrdersPage />{children}
</MemoryRouter>)
const filter = () => screen.getByRole('combobox', { name: 'Lọc đơn hàng theo thanh toán' })
const selectPayment = (value) => fireEvent.change(filter(), { target: { value } })
const metric = (label) => within(screen.getByText(label).closest('.metric'))

describe('employee order payment filter', () => {
  beforeEach(() => { mocked.app = baseApp() })
  afterEach(cleanup)

  it('filters only the employee open-support-shift rows and retains all-shift metrics', () => {
    mocked.app.orders = [
      order('CASH', 'Tiền mặt', 100), order('BANK', 'Chuyển khoản', 200),
      order('LEGACY-CASH', 'cash', 30), order('LEGACY-BANK', 'bank_transfer', 40),
      order('UNKNOWN', 'Thanh toán cũ', 50),
      order('COWORKER', 'Tiền mặt', 900, { employeeId: 'E02', createdByEmployeeId: 'E02' }),
      order('HOME', 'Tiền mặt', 900, { storeId: 'HOME' }),
      order('CLOSED', 'Chuyển khoản', 900, { attendanceId: 'ATT-CLOSED' }),
      order('DELETED', 'Chuyển khoản', 900, { deletedAt: '2026-09-03T03:00:00.000Z' }),
    ]
    renderOrders()

    expect(within(filter()).getAllByRole('option').map((option) => option.textContent))
      .toEqual(['Tất cả', 'Tiền mặt', 'Chuyển khoản'])
    expect(screen.getByText('5 / 5 đơn trong ca')).toBeTruthy()
    expect(screen.getByText(/do bạn tạo trong ca đang làm tại Cửa hàng hỗ trợ/u)).toBeTruthy()
    for (const excluded of ['COWORKER', 'HOME', 'CLOSED', 'DELETED']) {
      expect(screen.queryByText(excluded)).toBeNull()
    }

    selectPayment('Tiền mặt')
    expect(screen.getByText('CASH')).toBeTruthy()
    expect(screen.getByText('LEGACY-CASH')).toBeTruthy()
    expect(screen.queryByText('BANK')).toBeNull()
    expect(screen.queryByText('UNKNOWN')).toBeNull()
    expect(screen.getByText('2 / 5 đơn trong ca')).toBeTruthy()

    selectPayment('Chuyển khoản')
    expect(screen.getByText('BANK')).toBeTruthy()
    expect(screen.getByText('LEGACY-BANK')).toBeTruthy()
    expect(screen.queryByText('CASH')).toBeNull()
    expect(screen.queryByText('CLOSED')).toBeNull()
    expect(screen.getByText('2 / 5 đơn trong ca')).toBeTruthy()
    expect(metric('ĐƠN TRONG CA').getByText('5')).toBeTruthy()
    expect(metric('DOANH THU TRONG CA').getByText('420 đ')).toBeTruthy()
    expect(metric('DOANH THU TRONG CA').getByText('Chỉ các đơn hàng của bạn trong ca')).toBeTruthy()

    selectPayment('all')
    expect(screen.getByText('UNKNOWN')).toBeTruthy()
    expect(screen.getByText('5 / 5 đơn trong ca')).toBeTruthy()
    expect(mocked.app.createOrder).not.toHaveBeenCalled()
  })

  it('filters before pagination and resets to the first page when the method changes', () => {
    mocked.app.orders = Array.from({ length: 25 }, (_, index) => order(
      `ORDER-${index + 1}`, index < 23 ? 'Tiền mặt' : 'Chuyển khoản', 100,
      { createdAt: `2026-09-03T02:${String(index).padStart(2, '0')}:00.000Z` },
    ))
    renderOrders()

    fireEvent.click(screen.getByRole('button', { name: 'Trang 2' }))
    expect(screen.getByText('ORDER-1')).toBeTruthy()
    expect(screen.queryByText('ORDER-25')).toBeNull()

    selectPayment('Tiền mặt')
    expect(screen.getByRole('button', { name: 'Trang 1' }).getAttribute('aria-current')).toBe('page')
    expect(screen.getByText('ORDER-23')).toBeTruthy()
    expect(screen.queryByText('ORDER-1')).toBeNull()
    expect(screen.queryByText('ORDER-25')).toBeNull()
    expect(screen.getByText('23 / 25 đơn trong ca')).toBeTruthy()
    expect(screen.getByText(/Hiển thị 1–20 \/ 23 bản ghi/u)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Trang 2' }))
    expect(screen.getByText('ORDER-1')).toBeTruthy()
    selectPayment('all')
    expect(screen.getByRole('button', { name: 'Trang 1' }).getAttribute('aria-current')).toBe('page')
    expect(screen.getByText('ORDER-25')).toBeTruthy()
    expect(metric('ĐƠN TRONG CA').getByText('25')).toBeTruthy()
    expect(metric('DOANH THU TRONG CA').getByText('2,500 đ')).toBeTruthy()
  })

  it('distinguishes an empty payment result from an empty or closed attendance', () => {
    mocked.app.orders = [order('CASH', 'Tiền mặt')]
    const view = renderOrders()
    selectPayment('Chuyển khoản')

    expect(screen.getByText('Không có đơn hàng phù hợp')).toBeTruthy()
    expect(screen.getByText(/Chọn Tất cả và xóa số tiền để xem toàn bộ đơn trong ca/u)).toBeTruthy()
    expect(screen.getByText('0 / 1 đơn trong ca')).toBeTruthy()
    expect(screen.queryByRole('table')).toBeNull()
    expect(metric('DOANH THU TRONG CA').getByText('100 đ')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'TẠO ĐƠN HÀNG' }).disabled).toBe(false)

    mocked.app.attendance = [{ ...openAttendance, checkOutAt: '2026-09-03T05:00:00.000Z' }]
    view.rerender(<MemoryRouter><EmployeeOrdersPage /></MemoryRouter>)
    expect(screen.getByText('Chưa có ca đang mở')).toBeTruthy()
    expect(filter().disabled).toBe(true)
    expect(screen.getByText('0 / 0 đơn trong ca')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'TẠO ĐƠN HÀNG' }).disabled).toBe(true)
    expect(screen.queryByText('CASH')).toBeNull()
  })

  it('clears a stale payment filter for a new scoped order deep link', () => {
    mocked.app.orders = [order('CASH', 'Tiền mặt'), order('BANK', 'Chuyển khoản')]
    renderOrders(<Link to="/employee/orders?order=BANK">Mở đơn từ thông báo</Link>)
    selectPayment('Tiền mặt')
    expect(screen.queryByText('BANK')).toBeNull()

    fireEvent.click(screen.getByRole('link', { name: 'Mở đơn từ thông báo' }))
    expect(filter().value).toBe('all')
    expect(screen.getByText('BANK').closest('tr').classList.contains('order-row--highlight')).toBe(true)
  })
  it('combines an exact amount with payment, counts every match before pagination, and clears on a new attendance', () => {
    mocked.app.orders = Array.from({ length: 26 }, (_, index) => order(`AMOUNT-${index}`, index % 2 ? 'Chuyển khoản' : 'Tiền mặt', 20_000))
    mocked.app.orders.push(order('OTHER-AMOUNT', 'Tiền mặt', 20_001), order('ZERO', 'Tiền mặt', 0))
    const view = renderOrders()
    const amountInput = () => screen.getByRole('textbox', { name: 'Lọc đơn hàng theo số tiền' })
    expect(metric('TỔNG TIỀN CHUYỂN KHOẢN').getByText('13 đơn chuyển khoản')).toBeTruthy()
    expect(metric('TỔNG TIỀN MẶT').getByText('15 đơn tiền mặt')).toBeTruthy()
    fireEvent.change(amountInput(), { target: { value: '20,000' } })
    expect(screen.getByRole('status').textContent).toContain('Số tiền 20,000 đ: 26 đơn')
    expect(screen.queryByText('OTHER-AMOUNT')).toBeNull()
    expect(screen.getByText(/Hiển thị 1–20 \/ 26 bản ghi/u)).toBeTruthy()
    selectPayment('Chuyển khoản')
    expect(screen.getByRole('status').textContent).toContain('Số tiền 20,000 đ: 13 đơn')
    expect(within(screen.getByRole('group', { name: 'Kết quả lọc' })).getAllByText('260,000 đ')).toHaveLength(2)
    expect(metric('DOANH THU TRONG CA').getByText('540,001 đ')).toBeTruthy()
    fireEvent.change(amountInput(), { target: { value: '0' } })
    expect(screen.getByRole('status').textContent).toContain('Số tiền 0 đ: 0 đơn')
    selectPayment('Tiền mặt')
    expect(screen.getByText('ZERO')).toBeTruthy()
    fireEvent.change(amountInput(), { target: { value: '-20000' } })
    expect(screen.getByText('Nhập số tiền nguyên không âm, ví dụ 200,000.')).toBeTruthy()
    expect(screen.queryByRole('table')).toBeNull()
    mocked.app.attendance = [{ ...openAttendance, id: 'ATT-NEW' }]
    view.rerender(<MemoryRouter><EmployeeOrdersPage /></MemoryRouter>)
    expect(amountInput().value).toBe('')
    expect(filter().value).toBe('all')
    expect(screen.queryByText('AMOUNT-0')).toBeNull()
  })

})


describe('employee revenue entry', () => {
  beforeEach(() => { mocked.app = baseApp(); mocked.app.orderInformationOptions = DEFAULT_ORDER_INFORMATION_OPTIONS })
  afterEach(cleanup)
  it('creates a sale-kg order with automatic amount and own active attendance/store through the Save control', async () => {
    mocked.app.createOrder.mockResolvedValue({ ok: true, order: { id: 'NEW' } })
    renderOrders()
    fireEvent.click(screen.getByRole('button', { name: 'TẠO ĐƠN HÀNG' }))
    const dialog = within(screen.getByRole('dialog'))
    fireEvent.change(dialog.getByLabelText(/Tên khách hàng/u), { target: { value: 'Khách kiểm thử' } })
    fireEvent.change(dialog.getByLabelText(/Giới tính/u), { target: { value: 'Nữ' } })
    fireEvent.click(dialog.getByRole('combobox', { name: 'Nghề nghiệp' }))
    fireEvent.click(dialog.getByRole('option', { name: 'Kỹ sư' }))
    fireEvent.change(dialog.getByLabelText(/Biết qua kênh nào/u), { target: { value: 'Facebook' } })
    fireEvent.change(dialog.getByLabelText(/Hình thức thanh toán/u), { target: { value: 'Tiền mặt' } })
    fireEvent.click(dialog.getByRole('button', { name: 'Sale theo ký Hàng sale' }))
    fireEvent.click(dialog.getByRole('checkbox', { name: /Đồ nam/u }))
    fireEvent.change(dialog.getByLabelText('Khối lượng Đồ nam'), { target: { value: '2.5' } })
    fireEvent.change(dialog.getByLabelText('Đơn giá Đồ nam'), { target: { value: '20000' } })
    expect(dialog.getByLabelText(/^Số tiền/u).readOnly).toBe(true)
    expect(dialog.getByLabelText(/^Số tiền/u).value).toBe('50,000')
    fireEvent.click(dialog.getByRole('button', { name: 'LƯU ĐƠN' }))
    await waitFor(() => expect(mocked.app.createOrder).toHaveBeenCalledTimes(1))
    expect(mocked.app.createOrder).toHaveBeenCalledWith(expect.objectContaining({
      amount: 50_000, employeeId: 'E01', storeId: 'SUPPORT', attendanceId: 'ATT-SUPPORT',
      shiftId: 'CA-SUPPORT', items: [{ productId: 'order-product-001', revenueType: 'SALE_KG', unit: 'KG', quantity: 2.5, unitPrice: 20000 }],
    }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })
  it('keeps three revenue types scoped to the current employee, unchanged by payment filters', () => {
    const items = [
      { productId: 'p', productName: 'Đồ nam', quantity: 2, unitPrice: 50000 },
      { productId: 'p', productName: 'Đồ nam', revenueType: 'SALE_KG', quantity: 2.5, unitPrice: 20000 },
      { productId: 'q', productName: 'Đồ nữ', revenueType: 'SALE_PIECE', quantity: 3, unitPrice: 10000 },
    ]
    mocked.app.orders = [order('OWN', 'Tiền mặt', 180000, { items }), order('COLLEAGUE-SECRET', 'Tiền mặt', 180000, { items, employeeId: 'E02', createdByEmployeeId: 'E02' })]
    renderOrders()
    expect(screen.getByTestId('revenue-NORMAL').textContent).toContain('100,000 đ')
    expect(screen.getByTestId('revenue-SALE_KG').textContent).toContain('50,000 đ')
    expect(screen.getByTestId('revenue-SALE_PIECE').textContent).toContain('30,000 đ')
    expect(screen.getByTestId('revenue-TOTAL').textContent).toContain('180,000 đ')
    expect(screen.queryByText('COLLEAGUE-SECRET')).toBeNull()
    selectPayment('Chuyển khoản')
    expect(screen.getByTestId('revenue-TOTAL').textContent).toContain('180,000 đ')
  })
})
