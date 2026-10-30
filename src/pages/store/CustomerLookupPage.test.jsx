import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { CustomerLookupPage } from './CustomerLookupPage'

const mocked = vi.hoisted(() => ({ app: {}, read: vi.fn() }))
vi.mock('../../state/AppContext', () => ({ useApp: () => mocked.app }))
vi.mock('../../services/idosiApi', () => ({ apiGetCustomerLookup: (...args) => mocked.read(...args) }))
const customer = { key: 'phone:0901234567', customerName: 'Nguyễn Ánh', customerPhone: '0901234567', orderCount: 2, hasPurchaseHistory: true }
const order = { id: 'O1', code: 'S1-00001', storeId: 'S1', customerName: customer.customerName, customerPhone: customer.customerPhone,
  createdAt: '2026-10-30T08:00:00+07:00', amount: 120000, items: [{ productId: 'P1', productName: 'Áo', quantity: 2 }], paymentMethod: 'Tiền mặt' }
beforeEach(() => {
  mocked.read.mockReset()
  mocked.app = { apiStatus: 'local', activeStoreId: 'S1', session: { role: 'store_manager', storeId: 'S1' }, orders: [order,
    { ...order, id: 'O2', createdAt: '2024-01-01T08:00:00+07:00' }, { ...order, id: 'OTHER', storeId: 'S2', customerName: 'Bí mật' }] }
})
afterEach(cleanup)

it('shows customer contacts, name/phone suggestions, all-period purchase details, and no other-store rows', () => {
  render(<CustomerLookupPage />)
  expect(screen.getByRole('table', { name: 'Danh sách khách hàng' })).toBeTruthy()
  expect(screen.queryByText('Bí mật')).toBeNull()
  expect(screen.getByText('KH cũ')).toBeTruthy()
  fireEvent.change(screen.getByRole('combobox', { name: 'Tìm theo tên khách hàng hoặc SĐT' }), { target: { value: 'nguyen anh' } })
  fireEvent.click(screen.getByRole('button', { name: 'Lịch sử mua hàng (2)' }))
  const dialog = screen.getByRole('dialog', { name: 'Lịch sử mua hàng' })
  expect(within(dialog).getByText('2 đơn hàng')).toBeTruthy()
  expect(within(dialog).getByText('KH cũ')).toBeTruthy()
  expect(within(dialog).getAllByText('Áo')).toHaveLength(2)
  expect(within(dialog).getAllByText('2 cái')).toHaveLength(2)
  expect(within(dialog).getAllByText(/120.000/)).toHaveLength(2)
  expect(within(dialog).getByText(/01\/01\/24/)).toBeTruthy()
  fireEvent.click(within(dialog).getByRole('button', { name: 'Đóng' }))
  fireEvent.change(screen.getByRole('combobox', { name: 'Tìm theo tên khách hàng hoặc SĐT' }), { target: { value: '0999' } })
  expect(screen.getByText('Không tìm thấy khách hàng')).toBeTruthy()
  expect(screen.getByText('KH mới')).toBeTruthy()
})

it('discards stale remote responses when the store changes and retries errors', async () => {
  mocked.app.apiStatus = 'connected'
  let resolveOld
  mocked.read.mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve }))
    .mockRejectedValueOnce(new Error('Không thể tải fixture'))
    .mockResolvedValue({ customers: [], total: 0, limit: 20 })
  const view = render(<CustomerLookupPage />)
  await waitFor(() => expect(mocked.read).toHaveBeenCalledTimes(1))
  mocked.app = { ...mocked.app, activeStoreId: 'S2' }
  view.rerender(<CustomerLookupPage />)
  await screen.findByText('Không thể tải fixture')
  resolveOld({ customers: [customer], total: 1, limit: 20 })
  expect(screen.queryByText('Nguyễn Ánh')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Làm mới' }))
  await screen.findByText('Chưa có khách hàng')
})
