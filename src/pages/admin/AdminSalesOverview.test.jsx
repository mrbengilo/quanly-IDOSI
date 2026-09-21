import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import AdminSalesOverview from './AdminSalesOverview'
import { apiGetSalesOverview } from '../../services/idosiApi'

vi.mock('../../services/idosiApi', () => ({ apiGetSalesOverview: vi.fn() }))
afterEach(() => { cleanup(); vi.clearAllMocks() })
const data = { quantity: 15, weight: { isComplete: true, totalKg: 3 }, mostSold: { productName: 'Áo nữ', quantity: 15 }, leastSold: { productName: 'Áo nữ', quantity: 15 }, topProducts: [{ productId: 'P1', productName: 'Áo nữ', quantity: 15 }] }

it('renders real local totals, ranking and an accessible product chart', () => {
  render(<AdminSalesOverview period="2026-09" orders={[{ amount: 1000, date: '2026-09-01', items: [{ productId: 'P1', productName: 'Áo nữ', quantity: 15 }] }]} />)
  expect(screen.getByText('3 kg')).toBeTruthy()
  expect(screen.getAllByText('Áo nữ (15 cái)')).toHaveLength(2)
  expect(screen.getByRole('list', { name: 'Số lượng bán theo mặt hàng' }).textContent).toContain('15 cái')
  expect(apiGetSalesOverview).not.toHaveBeenCalled()
})

it('aborts old requests and never displays old-month results while the new month loads', async () => {
  let resolveOld
  apiGetSalesOverview.mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve }))
    .mockResolvedValueOnce({ ...data, quantity: 20 })
  const view = render(<AdminSalesOverview remote period="2026-08" />)
  const signal = apiGetSalesOverview.mock.calls[0][1].signal
  view.rerender(<AdminSalesOverview remote period="2026-09" />)
  expect(signal.aborted).toBe(true)
  expect(await screen.findByText('20 cái')).toBeTruthy()
  await act(async () => resolveOld({ ...data, quantity: 999 }))
  expect(screen.queryByText('999 cái')).toBeNull()
})

it('shows errors without false zero totals, then retries and displays the empty state', async () => {
  apiGetSalesOverview.mockRejectedValueOnce(new Error('Mất kết nối')).mockResolvedValueOnce({ ...data, quantity: 0, mostSold: null, leastSold: null, topProducts: [] })
  render(<AdminSalesOverview remote period="2026-09" />)
  expect(await screen.findByRole('alert')).toBeTruthy()
  expect(screen.queryByText('0 cái')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Thử lại thống kê' }))
  expect(await screen.findByText('0 cái')).toBeTruthy()
  expect(screen.getByText('Chưa có mặt hàng bán theo cái trong kỳ đã chọn.')).toBeTruthy()
})

it('warns when historical orders lack item details', () => {
  render(<AdminSalesOverview period="2026-09" orders={[{ amount: 1000, date: '2026-09-01' }]} />)
  expect(screen.getByText('Chưa đủ dữ liệu')).toBeTruthy()
  expect(screen.getByText(/Có 1 đơn chưa có chi tiết/)).toBeTruthy()
})
