import { MemoryRouter } from 'react-router-dom'
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
    render(<MemoryRouter><StoreStatisticsPage /></MemoryRouter>)

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
    render(<MemoryRouter><StoreStatisticsPage /></MemoryRouter>)
    await screen.findByText('Đồ nam')
    fireEvent.change(screen.getByLabelText('Xem thống kê theo'), { target: { value: 'shift' } })
    await waitFor(() => expect(apiGetOrderSummary).toHaveBeenCalledWith(expect.objectContaining({
      storeId: 'STORE-1', shiftId: 'SHIFT-AM', date: expect.any(String),
    })))
    expect(screen.getAllByText(/Ca sáng/u).length).toBeGreaterThan(0)
  })
})

describe('revenue categories and drill-down', () => {
  afterEach(() => { cleanup(); vi.clearAllMocks() })
  const revenueByType = { NORMAL: 1_500_000, SALE_KG: 200_000, SALE_PIECE: 300_000 }
  const typedPayload = {
    ...payload,
    totals: { ...payload.totals, revenueByType, totalSaleRevenue: 500_000 },
    products: { ...payload.products, totalWeightKg: 10, items: [...payload.products.items,
      { productId: 'PKG', productName: 'Đồ sale cân ký', unit: 'KG', revenueType: 'SALE_KG', quantity: 10, orders: 1 },
    ] },
    groups: {
      shift: [{ key: '2026-09-15:SHIFT-AM', shiftId: 'SHIFT-AM', shiftName: 'Ca sáng', orders: 9, revenue: 2_000_000, revenueByType }],
      day: [{ key: '2026-09-15', orders: 9, revenue: 2_000_000, revenueByType }],
    },
  }
  it('renders separate revenue cards and routes Xem đơn to the exact store/date/shift', async () => {
    apiGetOrderSummary.mockResolvedValue(typedPayload)
    render(<MemoryRouter><StoreStatisticsPage /></MemoryRouter>)
    expect(await screen.findByTestId('revenue-NORMAL')).toHaveProperty('textContent', expect.stringContaining('1,500,000 đ'))
    expect(screen.getByTestId('revenue-SALE_KG').textContent).toContain('200,000 đ')
    expect(screen.getByTestId('revenue-SALE_PIECE').textContent).toContain('300,000 đ')
    expect(screen.getByTestId('revenue-TOTAL').textContent).toContain('2,000,000 đ')
    expect(screen.getByText('10 kg')).toBeTruthy()
    const link = screen.getByRole('link', { name: 'Xem đơn Ca sáng' })
    expect(link.getAttribute('href')).toContain('store=STORE-1')
    expect(link.getAttribute('href')).toContain('date=2026-09-15')
    expect(link.getAttribute('href')).toContain('shiftId=SHIFT-AM')
    fireEvent.change(screen.getByLabelText('Xem thống kê theo'), { target: { value: 'month' } })
    await screen.findByRole('heading', { name: 'Doanh thu từng ngày trong tháng' })
    expect(screen.getByRole('link', { name: 'Xem đơn 15/09/2026' }).getAttribute('href')).not.toContain('shiftId=')
    fireEvent.click(screen.getByRole('button', { name: 'Làm mới số liệu' }))
    await waitFor(() => expect(apiGetOrderSummary.mock.calls.length).toBeGreaterThanOrEqual(3))
  })
  it('does not show stale or zero revenue when a refresh fails and can retry', async () => {
    apiGetOrderSummary.mockResolvedValueOnce(typedPayload).mockRejectedValueOnce(new Error('Mất kết nối thống kê')).mockResolvedValue(typedPayload)
    render(<MemoryRouter><StoreStatisticsPage /></MemoryRouter>)
    await screen.findByTestId('revenue-NORMAL')
    fireEvent.click(screen.getByRole('button', { name: 'Làm mới số liệu' }))
    await screen.findByText('Mất kết nối thống kê')
    expect(screen.queryByTestId('revenue-NORMAL')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Làm mới số liệu' }))
    await screen.findByTestId('revenue-NORMAL')
  })
})
