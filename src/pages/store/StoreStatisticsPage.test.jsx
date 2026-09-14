import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { StoreStatisticsPage } from './StoreStatisticsPage'

const { apiGetOrderSummary, version } = vi.hoisted(() => ({ apiGetOrderSummary: vi.fn(), version: { value: 1 } }))

vi.mock('../../services/idosiApi', () => ({ apiGetOrderSummary }))
vi.mock('../../state/AppContext', () => ({
  useApp: () => ({
    stateVersion: version.value,
    activeStoreId: 'STORE-1',
    session: { role: 'store_manager', storeId: 'STORE-1' },
    stores: [{ id: 'STORE-1', name: 'IDOSI Quận 1' }],
    shiftDefinitions: [{ id: 'SHIFT-AM', name: 'Ca sáng', start: '08:00', end: '16:00', active: true }],
  }),
}))

const payload = {
  totals: { orders: 9, revenue: 2_000_000, cash: 800_000, transfer: 1_200_000, cashOrders: 4, transferOrders: 5, revenueByType: { NORMAL: 1500000, SALE_KG: 200000, SALE_PIECE: 300000 } },
  products: {
    totalQuantity: 5_100,
    totalWeightKg: 10,
    productTypes: 3,
    ordersWithItems: 9,
    unclassifiedOrders: 0,
    items: [
      { productId: 'P1', productCode: 'PRD-001', productName: 'Đồ nam', quantity: 2_000, orders: 4 },
      { productId: 'P2', productCode: 'PRD-002', productName: 'Đồ nữ', quantity: 3_000, orders: 4 },
      { productId: 'P3', productCode: 'PRD-003', productName: 'Đồ bộ', quantity: 100, orders: 1 },
    ],
  },
}

describe('StoreStatisticsPage', () => {
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
    version.value = 1
  })

  it('loads only the selected aggregate scope and renders every product quantity', async () => {
    apiGetOrderSummary.mockResolvedValue(payload)
    render(<StoreStatisticsPage />)

    await waitFor(() => expect(apiGetOrderSummary).toHaveBeenCalledWith(expect.objectContaining({
      storeId: 'STORE-1',
      date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/u),
    })))
    expect(await screen.findAllByText('2,000,000 đ')).toHaveLength(2)
    expect(screen.getByText('Đồ nam')).toBeTruthy()
    expect(screen.getByText('2.000 cái')).toBeTruthy()
    expect(screen.getByText('3.000 cái')).toBeTruthy()
    expect(screen.getByText('100 cái')).toBeTruthy()
  })

  it('applies the selected shift to the summary request', async () => {
    apiGetOrderSummary.mockResolvedValue(payload)
    render(<StoreStatisticsPage />)
    await screen.findByText('Đồ nam')
    fireEvent.change(screen.getByLabelText('Xem thống kê theo'), { target: { value: 'shift' } })
    await waitFor(() => expect(apiGetOrderSummary).toHaveBeenCalledWith(expect.objectContaining({
      storeId: 'STORE-1', shiftId: 'SHIFT-AM', date: expect.any(String),
    })))
    expect(screen.getAllByText(/Ca sáng/u).length).toBeGreaterThan(0)
  })
  it('drills month -> day -> shift with all revenue categories and matching request filters', async () => {
    const totals = payload.totals
    apiGetOrderSummary.mockResolvedValue({ ...payload, groups: {
      day: [{ ...totals, key: '2026-09-14' }],
      shift: [{ ...totals, key: '2026-09-14:SHIFT-AM', shiftId: 'SHIFT-AM', shiftName: 'Ca sáng' }],
    } })
    render(<StoreStatisticsPage />)
    await screen.findByText('Đồ nam')
    fireEvent.change(screen.getByLabelText('Xem thống kê theo'), { target: { value: 'month' } })
    fireEvent.change(screen.getByLabelText('Tháng thống kê'), { target: { value: '2026-09' } })
    fireEvent.click(await screen.findByRole('button', { name: 'Xem ngày' }))
    await waitFor(() => expect(apiGetOrderSummary).toHaveBeenCalledWith(expect.objectContaining({ period: '2026-09', date: '2026-09-14' })))
    fireEvent.click(await screen.findByRole('button', { name: 'Xem ca' }))
    await waitFor(() => expect(apiGetOrderSummary).toHaveBeenCalledWith(expect.objectContaining({ period: '2026-09', date: '2026-09-14', shiftId: 'SHIFT-AM' })))
    expect(screen.getAllByText('1,500,000 đ').length).toBeGreaterThan(0)
    expect(screen.getAllByText('200,000 đ').length).toBeGreaterThan(0)
    expect(screen.getAllByText('300,000 đ').length).toBeGreaterThan(0)
    expect(screen.getByText('10 kg')).toBeTruthy()
  })

  it('invalidates cached statistics after a successful state change and supports explicit retry', async () => {
    apiGetOrderSummary.mockResolvedValue(payload)
    const view = render(<StoreStatisticsPage />)
    await screen.findByText('Đồ nam')
    expect(apiGetOrderSummary).toHaveBeenCalledTimes(1)
    version.value += 1
    apiGetOrderSummary.mockRejectedValueOnce(new Error('Mất kết nối thử nghiệm'))
    view.rerender(<StoreStatisticsPage />)
    await screen.findByText('Mất kết nối thử nghiệm')
    expect(screen.queryByText('0 đ')).toBeNull()
    expect(screen.queryByText('Đồ nam')).toBeNull()
    apiGetOrderSummary.mockResolvedValue(payload)
    fireEvent.click(screen.getByRole('button', { name: 'Làm mới số liệu' }))
    await screen.findByText('Đồ nam')
    expect(apiGetOrderSummary).toHaveBeenCalledTimes(3)
  })

  it('ignores out-of-order responses from an older date', async () => {
    let oldResolve
    apiGetOrderSummary.mockImplementationOnce(() => new Promise((resolve) => { oldResolve = resolve }))
      .mockResolvedValue({ ...payload, products: { ...payload.products, items: [{ productId: 'NEW', productName: 'Dữ liệu ngày mới', quantity: 1 }] } })
    render(<StoreStatisticsPage />)
    await waitFor(() => expect(apiGetOrderSummary).toHaveBeenCalledTimes(1))
    fireEvent.change(screen.getByLabelText('Ngày thống kê'), { target: { value: '2026-08-12' } })
    await screen.findByText('Dữ liệu ngày mới')
    oldResolve(payload)
    await waitFor(() => expect(screen.queryByText('Đồ nam')).toBeNull())
    expect(screen.getByText('Dữ liệu ngày mới')).toBeTruthy()
  })

})
