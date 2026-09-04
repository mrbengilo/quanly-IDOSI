import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { today } from '../../utils'
import { StoreOrdersPage } from './StoreV2Pages'

const mocked = vi.hoisted(() => ({
  app: {},
  apiGetHistory: vi.fn(),
}))

vi.mock('../../state/AppContext', () => ({
  useApp: () => mocked.app,
}))

vi.mock('../../services/idosiApi', async (importOriginal) => ({
  ...await importOriginal(),
  apiGetHistory: (...args) => mocked.apiGetHistory(...args),
}))

const store = { id: 'DOSII-NTL', name: 'Dosii NTL' }
const employee = { id: 'DN-007', name: 'Trà Ngọc Kim Ngân', unit: 'store', storeId: store.id }
const historyOrder = (sequence, amount) => ({
  id: `ORDER-${sequence}`,
  code: `DOSIINTL-${String(sequence).padStart(5, '0')}`,
  storeId: 'dosii-ntl',
  employeeId: employee.id,
  employeeName: employee.name,
  shiftId: 'night',
  shiftName: 'Ca Tối',
  shiftStart: '17:00',
  shiftEnd: '21:00',
  customerName: 'Khách lẻ',
  amount,
  paymentMethod: 'Tiền mặt',
  status: 'Hoàn tất',
  createdAt: `${today()}T19:${String(50 + sequence).padStart(2, '0')}:00+07:00`,
})

const appAtVersion = (stateVersion) => ({
  session: { role: 'admin' },
  stores: [store],
  activeStoreId: store.id,
  activeStore: store,
  employees: [employee],
  orders: [],
  orderInformationOptions: [],
  apiStatus: 'connected',
  stateVersion,
  updateOrder: vi.fn(),
  deleteOrder: vi.fn(),
  notify: vi.fn(),
})

const page = (records) => ({ records, page: { limit: 100, hasMore: false, nextCursor: null } })

afterEach(() => {
  cleanup()
  mocked.apiGetHistory.mockReset()
})

describe('StoreOrdersPage remote order completeness', () => {
  it('refreshes the store history after another account creates more orders', async () => {
    const firstThree = [historyOrder(1, 10_000), historyOrder(2, 30_000), historyOrder(3, 40_000)]
    const allSix = [...firstThree, historyOrder(4, 45_000), historyOrder(5, 88_000), historyOrder(6, 125_000)]
    mocked.apiGetHistory
      .mockResolvedValueOnce(page(firstThree))
      .mockResolvedValueOnce(page(allSix))
    mocked.app = appAtVersion(10)

    const view = render(<MemoryRouter initialEntries={['/store/orders']}><StoreOrdersPage /></MemoryRouter>)
    await waitFor(() => expect(screen.getByText('DOSIINTL-00003')).toBeTruthy())
    expect(within(screen.getByLabelText('Tổng quan đơn hàng')).getByText('3')).toBeTruthy()

    mocked.app = appAtVersion(11)
    view.rerender(<MemoryRouter initialEntries={['/store/orders']}><StoreOrdersPage /></MemoryRouter>)

    await waitFor(() => expect(mocked.apiGetHistory).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.getByText('DOSIINTL-00006')).toBeTruthy())
    const metrics = within(screen.getByLabelText('Tổng quan đơn hàng'))
    expect(metrics.getByText('6')).toBeTruthy()
    expect(metrics.getAllByText('338,000 đ')).toHaveLength(2)
  })
})
