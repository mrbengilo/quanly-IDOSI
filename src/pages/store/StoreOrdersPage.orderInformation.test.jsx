import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { StoreOrdersPage } from './StoreV2Pages'

const mocked = vi.hoisted(() => ({ app: {} }))

vi.mock('../../state/AppContext', () => ({
  useApp: () => mocked.app,
}))

const store = { id: 'S01', name: 'Dosii KVC' }
const employee = { id: 'E01', name: 'Nguyễn An', unit: 'store', storeId: store.id }
const configuredOccupations = [
  { id: 'OCC-OLD', code: 'OCC-001', label: 'Kỹ sư', active: false, sortOrder: 100 },
  { id: 'OCC-ACTIVE', code: 'OCC-002', label: 'Bác sĩ', active: true, sortOrder: 200 },
]

const order = (overrides = {}) => ({
  id: 'ORDER-01',
  code: 'S01-00001',
  storeId: store.id,
  employeeId: employee.id,
  employeeName: employee.name,
  customerName: 'Khách kiểm thử',
  customerPhone: '0901234567',
  customerAge: 30,
  gender: 'Nữ',
  occupation: 'Kỹ sư',
  acquisitionChannel: 'Facebook',
  amount: 250_000,
  paymentMethod: 'Tiền mặt',
  status: 'Hoàn tất',
  createdAt: '2026-08-25T09:00:00+07:00',
  ...overrides,
})

const makeApp = (orderOverrides = {}) => ({
  session: { role: 'admin' },
  stores: [store],
  activeStoreId: store.id,
  activeStore: store,
  employees: [employee],
  orders: [order(orderOverrides)],
  orderInformationOptions: configuredOccupations,
  apiStatus: 'ready',
  updateOrder: vi.fn().mockResolvedValue({ ok: true }),
  deleteOrder: vi.fn(),
  notify: vi.fn(),
})

const renderPage = () => render(
  <MemoryRouter initialEntries={['/store/orders']}>
    <StoreOrdersPage />
  </MemoryRouter>,
)

afterEach(cleanup)

describe('StoreOrdersPage order information editing', () => {
  it('preserves an unchanged inactive occupation and exposes only two payment methods', async () => {
    mocked.app = makeApp()
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'Sửa' }))

    const dialog = screen.getByRole('dialog')
    const occupation = within(dialog).getByRole('combobox', { name: 'Nghề nghiệp' })
    expect(occupation.textContent).toContain('Kỹ sư (Đã ngừng sử dụng)')

    fireEvent.click(occupation)
    const listbox = within(dialog).getByRole('listbox', { name: 'Nghề nghiệp - danh sách' })
    expect(within(listbox).getByRole('option', { name: 'Kỹ sư (Đã ngừng sử dụng)' })).toBeTruthy()
    expect(within(listbox).getByRole('option', { name: 'Bác sĩ' })).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })

    const payment = within(dialog).getByLabelText(/Hình thức thanh toán/u)
    expect([...payment.options].map((option) => [option.value, option.textContent])).toEqual([
      ['', 'Chọn'],
      ['Tiền mặt', 'Tiền mặt'],
      ['Chuyển khoản', 'Chuyển khoản'],
    ])

    fireEvent.change(within(dialog).getByLabelText(/Lý do chỉnh sửa/u), { target: { value: '  Điều chỉnh thông tin khách  ' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'LƯU THAY ĐỔI' }))

    await waitFor(() => expect(mocked.app.updateOrder).toHaveBeenCalledTimes(1))
    expect(mocked.app.updateOrder).toHaveBeenCalledWith('ORDER-01', expect.objectContaining({
      occupation: 'Kỹ sư',
      paymentMethod: 'Tiền mặt',
      amount: 250_000,
      reason: 'Điều chỉnh thông tin khách',
    }))
  })

  it('keeps an unchanged legacy occupation but still blocks invalid payment, zero amount, and a missing audit reason', async () => {
    mocked.app = makeApp({ occupation: 'Nghề dữ liệu cũ', paymentMethod: 'Ví điện tử', amount: 0 })
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'Sửa' }))

    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByRole('combobox', { name: 'Nghề nghiệp' }).textContent).toContain('Nghề dữ liệu cũ (Dữ liệu cũ)')
    const saveButton = within(dialog).getByRole('button', { name: 'LƯU THAY ĐỔI' })
    fireEvent.click(saveButton)

    expect(mocked.app.updateOrder).not.toHaveBeenCalled()
    expect(within(dialog).queryByText('Vui lòng chọn nghề nghiệp trong danh sách.')).toBeNull()
    expect(within(dialog).getByText('Vui lòng chọn hình thức thanh toán.')).toBeTruthy()
    expect(within(dialog).getByText('Số tiền đơn hàng phải lớn hơn 0.')).toBeTruthy()
    expect(within(dialog).getByText('Cần nhập lý do chỉnh sửa.')).toBeTruthy()
    await waitFor(() => expect(saveButton.disabled).toBe(false))

    fireEvent.change(within(dialog).getByLabelText(/Hình thức thanh toán/u), { target: { value: 'Chuyển khoản' } })
    fireEvent.change(within(dialog).getByLabelText(/Số tiền/u), { target: { value: '35' } })
    fireEvent.change(within(dialog).getByLabelText(/Lý do chỉnh sửa/u), { target: { value: 'Sửa tiền, giữ nghề lịch sử' } })
    fireEvent.click(saveButton)

    await waitFor(() => expect(mocked.app.updateOrder).toHaveBeenCalledTimes(1))
    expect(mocked.app.updateOrder).toHaveBeenCalledWith('ORDER-01', expect.objectContaining({
      occupation: 'Nghề dữ liệu cũ',
      paymentMethod: 'Chuyển khoản',
      amount: 35,
      reason: 'Sửa tiền, giữ nghề lịch sử',
    }))
  })
})
