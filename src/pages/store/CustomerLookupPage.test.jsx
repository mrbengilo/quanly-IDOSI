import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { CustomerLookupPage } from './CustomerLookupPage'

const mocked = vi.hoisted(() => ({ app: {}, read: vi.fn() }))
vi.mock('../../state/AppContext', () => ({ useApp: () => mocked.app }))
vi.mock('../../services/idosiApi', () => ({ apiGetCustomerLookup: (...args) => mocked.read(...args) }))
const customer = { key: 'phone:0901234567', customerName: 'Nguyễn Ánh', customerPhone: '0901234567', orderCount: 2, hasPurchaseHistory: true, isReturningCustomer: true }
const order = { id: 'O1', code: 'S1-00001', storeId: 'S1', customerName: customer.customerName, customerPhone: customer.customerPhone,
  createdAt: '2026-10-30T08:00:00+07:00', amount: 120000, items: [{ productId: 'P1', productName: 'Áo', quantity: 2 }], paymentMethod: 'Tiền mặt' }
beforeEach(() => {
  mocked.read.mockReset()
  mocked.app = { apiStatus: 'local', activeStoreId: 'S1', session: { role: 'store_manager', storeId: 'S1' }, orders: [order,
    { ...order, id: 'O2', createdAt: '2024-01-01T08:00:00+07:00' },
    { ...order, id: 'OTHER', storeId: 'S2', customerName: 'Khách cửa hàng khác', customerPhone: '0999999999', amount: 999999 }] }
})
afterEach(cleanup)

it.each(['admin', 'business_support', 'store_manager'])('updates the %s directory, suggestion and history tag after the second global purchase', (role) => {
  mocked.app = { ...mocked.app, session: { role }, orders: [order] }
  const systemWide = role !== 'store_manager'
  const view = render(<CustomerLookupPage systemWide={systemWide} />)
  const table = screen.getByRole('table', { name: 'Danh sách khách hàng' })
  expect(within(table).getByText('KH mới')).toBeTruthy()
  expect(screen.getByRole('option', { hidden: true }).textContent).toContain('KH mới')
  fireEvent.click(screen.getByRole('button', { name: 'Lịch sử mua hàng (1)' }))
  expect(within(screen.getByRole('dialog')).getByText('KH mới')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Đóng' }))
  mocked.app = { ...mocked.app, orders: [order, { ...order, id: 'SECOND', storeId: 'S2' }] }
  view.rerender(<CustomerLookupPage systemWide={systemWide} />)
  expect(within(table).getByText('KH cũ')).toBeTruthy()
  expect(screen.getByRole('option', { hidden: true }).textContent).toContain('KH cũ')
  fireEvent.click(screen.getByRole('button', { name: `Lịch sử mua hàng (${systemWide ? 2 : 1})` }))
  expect(within(screen.getByRole('dialog')).getByText('KH cũ')).toBeTruthy()
})

it('shows global customer contacts and tags but only authorized store purchase details', () => {
  render(<CustomerLookupPage />)
  expect(screen.getByRole('table', { name: 'Danh sách khách hàng' })).toBeTruthy()
  expect(screen.getByText('Khách cửa hàng khác')).toBeTruthy()
  expect(screen.getAllByText('KH cũ')).toHaveLength(1)
  expect(screen.getAllByText('KH mới')).toHaveLength(1)
  fireEvent.change(screen.getByRole('combobox', { name: 'Tìm theo tên khách hàng hoặc SĐT' }), { target: { value: 'nguyen anh' } })
  fireEvent.click(screen.getByRole('button', { name: 'Lịch sử mua hàng (2)' }))
  const dialog = screen.getByRole('dialog', { name: 'Lịch sử mua hàng' })
  expect(within(dialog).getByText('2 đơn hàng tại cửa hàng')).toBeTruthy()
  expect(within(dialog).getByText('KH cũ')).toBeTruthy()
  expect(within(dialog).getAllByText('Áo')).toHaveLength(2)
  expect(within(dialog).getAllByText('2 cái')).toHaveLength(2)
  expect(within(dialog).getAllByText(/120.000/)).toHaveLength(2)
  expect(within(dialog).getByText(/01\/01\/24/)).toBeTruthy()
  fireEvent.click(within(dialog).getByRole('button', { name: 'Đóng' }))
  fireEvent.change(screen.getByRole('combobox', { name: 'Tìm theo tên khách hàng hoặc SĐT' }), { target: { value: '0999' } })
  expect(screen.getByText('KH mới')).toBeTruthy()
  expect(screen.queryByText('KH cũ')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Lịch sử mua hàng (0)' }))
  const outside = screen.getByRole('dialog', { name: 'Lịch sử mua hàng' })
  expect(within(outside).getByText('KH mới')).toBeTruthy()
  expect(within(outside).getByText('Chưa có đơn hàng tại cửa hàng này')).toBeTruthy()
  expect(within(outside).queryByRole('table')).toBeNull()
  expect(within(outside).queryByText(/999[.,]999/)).toBeNull()
  fireEvent.click(within(outside).getByRole('button', { name: 'Đóng' }))
  fireEvent.change(screen.getByRole('combobox', { name: 'Tìm theo tên khách hàng hoặc SĐT' }), { target: { value: '0777777777' } })
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

it.each(['admin', 'business_support'])('shows the system-wide directory, suggestions and stores/sellers without choosing a store for %s', (role) => {
  mocked.app = { ...mocked.app, activeStoreId: '', session: { role },
    stores: [{ id: 'S1', name: 'Cửa hàng Một' }, { id: 'S2', name: 'Cửa hàng Hai' }],
    employees: [{ id: 'E1', name: 'Nhân viên Một' }],
    deletedEmployees: [{ id: 'E2', name: 'Nhân viên Hai' }],
    orders: [{ ...order, employeeId: 'E1' }, { ...order, id: 'O2', storeId: 'S2', employeeId: 'E2' },
      { ...order, id: 'OTHER', customerName: 'Khách khác', customerPhone: '0888888888' }] }
  render(<CustomerLookupPage systemWide />)
  expect(screen.queryByText('Chưa chọn cửa hàng')).toBeNull()
  const input = screen.getByRole('combobox', { name: 'Tìm theo tên khách hàng hoặc SĐT' })
  fireEvent.change(input, { target: { value: 'nguyen anh' } })
  expect(screen.getByRole('option', { hidden: true }).getAttribute('value')).toBe('0901234567')
  expect(screen.queryByText('Khách khác')).toBeNull()
  fireEvent.change(input, { target: { value: '090 123' } })
  fireEvent.click(screen.getByRole('button', { name: 'Lịch sử mua hàng (2)' }))
  const dialog = screen.getByRole('dialog', { name: 'Lịch sử mua hàng' })
  for (const label of ['2 đơn hàng', 'Cửa hàng Một', 'Cửa hàng Hai', 'Nhân viên Một', 'Nhân viên Hai']) {
    expect(within(dialog).getByText(label)).toBeTruthy()
  }
  expect(within(dialog).getAllByText('Áo')).toHaveLength(2)
  expect(within(dialog).getAllByText('2 cái')).toHaveLength(2)
  expect(within(dialog).getAllByText(/120.000/)).toHaveLength(2)
})

it('uses the remote global API and ignores active-store changes, with history retry and search cancellation', async () => {
  mocked.app = { ...mocked.app, apiStatus: 'connected', session: { role: 'business_support' } }
  mocked.read.mockImplementation((options) => options.mode === 'history'
    ? Promise.reject(new Error('Lỗi lịch sử kiểm thử'))
    : Promise.resolve({ customers: [customer], total: 1, limit: 20 }))
  const view = render(<CustomerLookupPage systemWide />)
  await screen.findByRole('button', { name: 'Lịch sử mua hàng (2)' })
  expect(mocked.read).toHaveBeenCalledWith(expect.objectContaining({ scope: 'global', storeId: '', mode: 'list' }))
  mocked.app = { ...mocked.app, activeStoreId: 'S2' }
  view.rerender(<CustomerLookupPage systemWide />)
  expect(mocked.read).toHaveBeenCalledTimes(1)
  fireEvent.click(screen.getByRole('button', { name: 'Lịch sử mua hàng (2)' }))
  await screen.findByText('Lỗi lịch sử kiểm thử')
  mocked.read.mockResolvedValueOnce({ customer, records: [{ ...order, storeName: 'Cửa hàng Hai', employeeName: 'Người bán' }], total: 2, limit: 20 })
  fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }))
  await screen.findByText('Người bán')
  expect(mocked.read).toHaveBeenLastCalledWith(expect.objectContaining({ scope: 'global', storeId: '', mode: 'history', customerKey: customer.key }))
  fireEvent.click(screen.getByRole('button', { name: 'Đóng' }))
  const input = screen.getByRole('combobox', { name: 'Tìm theo tên khách hàng hoặc SĐT' })
  let resolveOld
  mocked.read.mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve }))
  fireEvent.change(input, { target: { value: 'nguyen' } })
  await waitFor(() => expect(resolveOld).toBeTypeOf('function'))
  const oldSignal = mocked.read.mock.calls.at(-1)[0].signal
  mocked.read.mockResolvedValueOnce({ customers: [], total: 0, limit: 20 })
  fireEvent.change(input, { target: { value: '099999' } })
  await screen.findByText('Không tìm thấy khách hàng')
  resolveOld({ customers: [customer], total: 1, limit: 20 })
  expect(oldSignal.aborted).toBe(true)
  expect(screen.queryByRole('button', { name: 'Lịch sử mua hàng (2)' })).toBeNull()
})

it('paginates system customers and all-store purchase history', () => {
  mocked.app = { ...mocked.app, session: { role: 'admin' }, orders: [
    ...Array.from({ length: 23 }, (_, i) => ({ ...order, id: `O${i}`, storeId: i % 2 ? 'S1' : 'S2' })),
    ...Array.from({ length: 22 }, (_, i) => ({ ...order, id: `C${i}`, customerPhone: `08888888${String(i).padStart(2, '0')}` })),
  ] }
  render(<CustomerLookupPage systemWide />)
  const input = screen.getByRole('combobox', { name: 'Tìm theo tên khách hàng hoặc SĐT' })
  fireEvent.click(screen.getByRole('button', { name: 'Trang 2' }))
  const rows = within(screen.getByRole('table', { name: 'Danh sách khách hàng' })).getAllByRole('row')
  expect(rows).toHaveLength(4)
  expect(within(rows[1]).getByText('21')).toBeTruthy()
  fireEvent.change(input, { target: { value: '090' } })
  fireEvent.click(screen.getByRole('button', { name: 'Lịch sử mua hàng (23)' }))
  const dialog = screen.getByRole('dialog', { name: 'Lịch sử mua hàng' })
  fireEvent.click(within(dialog).getByRole('button', { name: 'Trang 2' }))
  const purchases = within(within(dialog).getByRole('table')).getAllByRole('row')
  expect(purchases).toHaveLength(4)
  expect(within(purchases[1]).getByText('21')).toBeTruthy()
})
