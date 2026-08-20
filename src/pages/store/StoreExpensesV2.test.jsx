import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { StoreExpensesV2 } from './StoreExpensesV2'

const mocked = vi.hoisted(() => ({ app: {} }))

vi.mock('../../state/AppContext', () => ({ useApp: () => mocked.app }))

const store = { id: 'S01', name: 'Dosii KVC' }
const categories = ['Set up', 'Mặt bằng', 'Điện', 'Nước', 'Wifi', 'Marketing', 'Rác', 'Khác']
const voucher = {
  id: 'FIX-001',
  storeId: store.id,
  type: 'Phiếu chi phí cửa hàng',
  items: [
    { category: 'Điện', name: '', amount: 450_000, description: '' },
    { category: 'Khác', name: 'Sửa bảng hiệu', amount: 250_000, description: 'Thay đèn bảng hiệu' },
  ],
  totalAmount: 700_000,
  amount: 700_000,
  note: 'Phiếu tháng 8',
  occurredAt: '2026-08-20T08:30:00+07:00',
  createdAt: '2026-08-20T08:31:00+07:00',
  createdBy: { id: 'ADMIN', name: 'Admin IDOSI' },
}

const makeApp = (role = 'admin') => ({
  session: role === 'store_manager' ? { role, storeId: store.id } : { role },
  stores: [store, { id: 'S02', name: 'Dosii TNV' }],
  activeStoreId: store.id,
  activeStore: store,
  fixedExpenses: [voucher, { ...voucher, id: 'OTHER', storeId: 'S02' }],
  addFixedExpense: vi.fn().mockResolvedValue({ ok: true }),
  updateFixedExpense: vi.fn().mockResolvedValue({ ok: true }),
  deleteFixedExpense: vi.fn().mockResolvedValue({ ok: true }),
  notify: vi.fn(),
})

const renderPage = () => render(<MemoryRouter><StoreExpensesV2 /></MemoryRouter>)

describe('StoreExpensesV2', () => {
  beforeEach(() => { mocked.app = makeApp() })
  afterEach(cleanup)

  it('renders store-scoped voucher history with timestamp, items, creator, and total', () => {
    renderPage()

    expect(screen.getByRole('heading', { name: 'CHI PHÍ CỬA HÀNG' })).toBeTruthy()
    expect(screen.getByText('Sửa bảng hiệu')).toBeTruthy()
    expect(screen.getByText('Thay đèn bảng hiệu')).toBeTruthy()
    expect(screen.getByText('Admin IDOSI')).toBeTruthy()
    expect(screen.getAllByText('700,000 đ').length).toBeGreaterThan(0)
    expect(screen.queryByText('Dosii TNV')).toBeNull()
  })

  it('creates a voucher with exact categories and custom name, amount, and required description', async () => {
    mocked.app.fixedExpenses = []
    renderPage()

    fireEvent.click(screen.getByRole('button', { name: 'TẠO PHIẾU CHI' }))
    const dialog = screen.getByRole('dialog')
    const category = within(dialog).getByLabelText(/Danh mục/i)
    expect(within(category).getAllByRole('option').map((option) => option.textContent)).toEqual(categories)
    fireEvent.change(category, { target: { value: 'Khác' } })
    fireEvent.change(within(dialog).getByLabelText(/Tên khoản chi/i), { target: { value: 'Bảo trì máy lạnh' } })
    fireEvent.change(within(dialog).getByLabelText(/Số tiền/i), { target: { value: '350000' } })
    fireEvent.change(within(dialog).getByLabelText(/Mô tả/i), { target: { value: 'Thay linh kiện dàn lạnh' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'LƯU PHIẾU' }))

    await waitFor(() => expect(mocked.app.addFixedExpense).toHaveBeenCalledTimes(1))
    expect(mocked.app.addFixedExpense.mock.calls[0][0]).toMatchObject({
      storeId: store.id,
      items: [{ category: 'Khác', name: 'Bảo trì máy lạnh', amount: 350_000, description: 'Thay linh kiện dàn lạnh' }],
    })
  })

  it('requires a description for category Khác before submitting', () => {
    mocked.app.fixedExpenses = []
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'TẠO PHIẾU CHI' }))
    const dialog = screen.getByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText(/Danh mục/i), { target: { value: 'Khác' } })
    fireEvent.change(within(dialog).getByLabelText(/Tên khoản chi/i), { target: { value: 'Khoản tùy chỉnh' } })
    fireEvent.change(within(dialog).getByLabelText(/Số tiền/i), { target: { value: '100000' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'LƯU PHIẾU' }))

    expect(mocked.app.notify).toHaveBeenCalledWith('Vui lòng nhập mô tả cho khoản chi Khác.', 'info')
    expect(mocked.app.addFixedExpense).not.toHaveBeenCalled()
  })

  it.each(['business_support', 'store_manager'])('lets %s create and edit but never exposes delete', (role) => {
    mocked.app = makeApp(role)
    renderPage()

    expect(screen.getByRole('button', { name: 'TẠO PHIẾU CHI' })).toBeTruthy()
    expect(screen.getByRole('button', { name: `Sửa phiếu chi ${voucher.id}` })).toBeTruthy()
    expect(screen.queryByRole('button', { name: `Xóa phiếu chi ${voucher.id}` })).toBeNull()
  })

  it('lets only Admin delete and sends the audit reason', async () => {
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: `Xóa phiếu chi ${voucher.id}` }))
    const dialog = screen.getByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText(/Lý do xóa/i), { target: { value: 'Nhập trùng phiếu' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'XÓA PHIẾU' }))

    await waitFor(() => expect(mocked.app.deleteFixedExpense).toHaveBeenCalledWith(voucher.id, 'Nhập trùng phiếu'))
  })
})
