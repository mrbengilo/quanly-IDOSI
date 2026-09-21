import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { summarizeOrders } from '../../domain/orderSummary'
import { StoreStatisticsPage } from './StoreStatisticsPage'

const { apiGetOrderSummary, version } = vi.hoisted(() => ({ apiGetOrderSummary: vi.fn(), version: { value: 1 } }))
vi.mock('../../services/idosiApi', () => ({ apiGetOrderSummary }))
vi.mock('../../state/AppContext', () => ({ useApp: () => ({
  stateVersion: version.value, activeStoreId: 'STORE-1', session: { role: 'store_manager', storeId: 'STORE-1' },
  stores: [{ id: 'STORE-1', name: 'IDOSI Quận 1' }],
  shiftDefinitions: [{ id: 'SHIFT-AM', name: 'Ca sáng', start: '08:00', end: '16:00', active: true }],
}) }))

// A consistent nine-order response, including both piece and actual-kg rows.
const data = [
  ['P1', 'Đồ nam', 1000, 100000, 'Tiền mặt', 'NORMAL'],
  ['P1', 'Đồ nam', 1000, 150000, 'Tiền mặt', 'NORMAL'],
  ['P2', 'Đồ nữ', 1000, 400000, 'Tiền mặt', 'NORMAL'],
  ['P2', 'Đồ nữ', 750, 250000, 'Chuyển khoản', 'NORMAL'],
  ['P2', 'Đồ nữ', 750, 300000, 'Chuyển khoản', 'NORMAL'],
  ['P3', 'Đồ bộ', 100, 300000, 'Chuyển khoản', 'NORMAL'],
  ['P1', 'Đồ nam', 10, 200000, 'Chuyển khoản', 'SALE_KG'],
  ['P2', 'Đồ nữ', 250, 150000, 'Tiền mặt', 'SALE_PIECE'],
  ['P2', 'Đồ nữ', 250, 150000, 'Chuyển khoản', 'SALE_PIECE'],
]
const report = summarizeOrders(data.map(([productId, productName, quantity, amount, paymentMethod, revenueType], index) => ({
  id: `TEST-${index}`, storeId: 'STORE-1', createdAt: '2026-09-14T09:00:00+07:00', shiftId: 'SHIFT-AM', shiftName: 'Ca sáng', amount, paymentMethod,
  items: [{ productId, productName, quantity, revenueType, ...(revenueType !== 'NORMAL' ? { unitPrice: amount / quantity } : {}) }],
})))
const payload = { totals: report.totals, products: report.products }
const productsTable = () => document.querySelector('.store-statistics-products')
const ready = async () => waitFor(() => expect(productsTable()).not.toBeNull())

describe('StoreStatisticsPage', () => {
  afterEach(() => { cleanup(); vi.clearAllMocks(); version.value = 1 })
  it('loads only the selected aggregate scope and renders every product quantity', async () => {
    apiGetOrderSummary.mockResolvedValue(payload)
    render(<StoreStatisticsPage />)
    await waitFor(() => expect(apiGetOrderSummary).toHaveBeenCalledWith(expect.objectContaining({ storeId: 'STORE-1', date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/u) })))
    expect(await screen.findAllByText('2,000,000 đ')).toHaveLength(2)
    await ready()
    const table = within(productsTable())
    expect(table.getAllByText('Quần áo nam')).toHaveLength(2)
    for (const quantity of ['2.000 cái', '2.500 cái', '500 cái', '100 cái']) expect(table.getByText(quantity)).toBeTruthy()
    expect(screen.getByText('5.100 cái')).toBeTruthy()
    expect(report.totals).toMatchObject({ orders: 9, cash: 800000, transfer: 1200000, cashOrders: 4, transferOrders: 5 })
  })
  it('applies the selected shift to the summary request', async () => {
    apiGetOrderSummary.mockResolvedValue(payload)
    render(<StoreStatisticsPage />); await ready()
    fireEvent.change(screen.getByLabelText('Xem thống kê theo'), { target: { value: 'shift' } })
    await waitFor(() => expect(apiGetOrderSummary).toHaveBeenCalledWith(expect.objectContaining({ storeId: 'STORE-1', shiftId: 'SHIFT-AM', date: expect.any(String) })))
    expect(screen.getAllByText(/Ca sáng/u).length).toBeGreaterThan(0)
  })
  it('drills month -> day -> shift with all revenue categories and matching request filters', async () => {
    apiGetOrderSummary.mockResolvedValue(report)
    render(<StoreStatisticsPage />); await ready()
    fireEvent.change(screen.getByLabelText('Xem thống kê theo'), { target: { value: 'month' } })
    fireEvent.change(screen.getByLabelText('Tháng thống kê'), { target: { value: '2026-09' } })
    fireEvent.click(await screen.findByRole('button', { name: 'Xem ngày' }))
    await waitFor(() => expect(apiGetOrderSummary).toHaveBeenCalledWith(expect.objectContaining({ period: '2026-09', date: '2026-09-14' })))
    fireEvent.click(await screen.findByRole('button', { name: 'Xem ca' }))
    await waitFor(() => expect(apiGetOrderSummary).toHaveBeenCalledWith(expect.objectContaining({ period: '2026-09', date: '2026-09-14', shiftId: 'SHIFT-AM' })))
    for (const amount of ['1,500,000 đ', '200,000 đ', '300,000 đ']) expect(screen.getAllByText(amount).length).toBeGreaterThan(0)
    const weight = screen.getByRole('region', { name: 'Khối lượng • Doanh thu Ca sáng • 14/09/2026' })
    expect(within(weight).getByText('10 kg')).toBeTruthy()
  })
  it('invalidates cached statistics after a successful state change and supports explicit retry', async () => {
    apiGetOrderSummary.mockResolvedValue(payload)
    const view = render(<StoreStatisticsPage />); await ready()
    expect(apiGetOrderSummary).toHaveBeenCalledTimes(1)
    version.value += 1
    apiGetOrderSummary.mockRejectedValueOnce(new Error('Mất kết nối thử nghiệm'))
    view.rerender(<StoreStatisticsPage />)
    await screen.findByText('Mất kết nối thử nghiệm')
    expect(screen.queryByText('0 đ')).toBeNull()
    expect(productsTable()).toBeNull()
    apiGetOrderSummary.mockResolvedValue(payload)
    fireEvent.click(screen.getByRole('button', { name: 'Làm mới số liệu' })); await ready()
    expect(apiGetOrderSummary).toHaveBeenCalledTimes(3)
  })
  it('ignores out-of-order responses from an older date without confusing the reference table with sold products', async () => {
    let oldResolve
    apiGetOrderSummary.mockImplementationOnce(() => new Promise((resolve) => { oldResolve = resolve }))
      .mockResolvedValue({ ...payload, products: { ...payload.products, weightByProduct: [], items: [{ productId: 'NEW', productName: 'Dữ liệu ngày mới', quantity: 1 }] } })
    render(<StoreStatisticsPage />)
    await waitFor(() => expect(apiGetOrderSummary).toHaveBeenCalledTimes(1))
    fireEvent.change(screen.getByLabelText('Ngày thống kê'), { target: { value: '2026-08-12' } })
    await screen.findByText('Dữ liệu ngày mới')
    oldResolve(payload)
    await waitFor(() => expect(within(productsTable()).queryByText('Đồ nam')).toBeNull())
    expect(within(productsTable()).getByText('Dữ liệu ngày mới')).toBeTruthy()
  })
})
