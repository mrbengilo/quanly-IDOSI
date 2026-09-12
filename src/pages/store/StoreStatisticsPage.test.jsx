import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { StoreStatisticsPage } from './StoreStatisticsPage'

const { apiGetOrderSummary } = vi.hoisted(() => ({ apiGetOrderSummary: vi.fn() }))

vi.mock('../../services/idosiApi', () => ({ apiGetOrderSummary }))
vi.mock('../../state/AppContext', () => ({
  useApp: () => ({
    activeStoreId: 'STORE-1',
    session: { role: 'store_manager', storeId: 'STORE-1' },
    stores: [{ id: 'STORE-1', name: 'IDOSI Quận 1' }],
    shiftDefinitions: [{ id: 'SHIFT-AM', name: 'Ca sáng', start: '08:00', end: '16:00', active: true }],
  }),
}))

const payload = {
  totals: { orders: 9, revenue: 2_000_000, cash: 800_000, transfer: 1_200_000, cashOrders: 4, transferOrders: 5 },
  products: {
    totalQuantity: 5_100,
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
})
