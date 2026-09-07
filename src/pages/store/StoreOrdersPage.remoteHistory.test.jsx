import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { money, today } from '../../utils'
import { orderBusinessDate, orderMatchesFilters, summarizeOrders } from '../../domain/orderSummary'
import { StoreOrdersPage } from './StoreV2Pages'

const mocked = vi.hoisted(() => ({
  app: {},
  remoteOrders: [],
  apiGetHistory: vi.fn(),
  apiGetOrderSummary: vi.fn(),
}))

vi.mock('../../state/AppContext', () => ({
  useApp: () => mocked.app,
}))

vi.mock('../../services/idosiApi', async (importOriginal) => ({
  ...await importOriginal(),
  apiGetHistory: (...args) => mocked.apiGetHistory(...args),
  apiGetOrderSummary: (...args) => mocked.apiGetOrderSummary(...args),
}))

const store = { id: 'DOSII-NTL', name: 'Dosii NTL' }
const employee = { id: 'DN-007', name: 'Trà Ngọc Kim Ngân', unit: 'store', storeId: store.id }
const historyOrder = (sequence, amount, date = today(), overrides = {}) => ({
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
  occupation: 'Kỹ sư',
  amount,
  paymentMethod: 'Tiền mặt',
  status: 'Hoàn tất',
  createdAt: new Date(Date.parse(`${date}T17:00:00+07:00`) + sequence * 60_000).toISOString(),
  ...overrides,
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
const morePage = (records, cursor = 'older-orders') => ({ records, page: { limit: 100, hasMore: true, nextCursor: cursor } })
const viewElement = (route = '/store/orders') => <MemoryRouter initialEntries={[route]}><StoreOrdersPage /></MemoryRouter>
const renderPage = (route) => render(viewElement(route))
const metricValue = (label) => within(screen.getByLabelText('Tổng quan đơn hàng'))
  .getByText(label).closest('.metric').querySelector('.metric__body > strong').textContent
const expectMetrics = ({ orders, revenue, cash, transfer }) => {
  expect(metricValue('TỔNG SỐ ĐƠN HÀNG')).toBe(String(orders))
  expect(metricValue('TỔNG DOANH THU')).toBe(money(revenue))
  expect(metricValue('TỔNG TIỀN MẶT')).toBe(money(cash))
  expect(metricValue('TỔNG TIỀN CHUYỂN KHOẢN')).toBe(money(transfer))
}
const expectPendingMetrics = () => {
  expect(within(screen.getByLabelText('Tổng quan đơn hàng')).getAllByText('—')).toHaveLength(4)
}
const deferred = () => {
  let resolve
  let reject
  const promise = new Promise((resolvePromise, rejectPromise) => { resolve = resolvePromise; reject = rejectPromise })
  return { promise, resolve, reject }
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-09-15T03:00:00Z'))
  mocked.app = appAtVersion(10)
  mocked.remoteOrders = []
  mocked.apiGetOrderSummary.mockImplementation(async (options) => summarizeOrders(mocked.remoteOrders, options))
  mocked.apiGetHistory.mockImplementation(async (_kind, { period }) => page(mocked.remoteOrders
    .filter((order) => orderBusinessDate(order).startsWith(period))))
})

afterEach(() => {
  cleanup()
  mocked.apiGetHistory.mockReset()
  mocked.apiGetOrderSummary.mockReset()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('StoreOrdersPage remote order completeness', () => {
  it('refreshes the store history after another account creates more orders', async () => {
    const firstThree = [historyOrder(1, 10_000), historyOrder(2, 30_000), historyOrder(3, 40_000)]
    const allSix = [...firstThree, historyOrder(4, 45_000), historyOrder(5, 88_000), historyOrder(6, 125_000)]
    mocked.apiGetHistory
      .mockResolvedValueOnce(page(firstThree))
      .mockResolvedValueOnce(page(allSix))
    mocked.remoteOrders = firstThree

    const view = renderPage()
    await waitFor(() => expect(screen.getByText('DOSIINTL-00003')).toBeTruthy())
    expect(within(screen.getByLabelText('Tổng quan đơn hàng')).getByText('3')).toBeTruthy()

    mocked.app = appAtVersion(11)
    mocked.remoteOrders = allSix
    view.rerender(viewElement())

    await waitFor(() => expect(mocked.apiGetHistory).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.getByText('DOSIINTL-00006')).toBeTruthy())
    const metrics = within(screen.getByLabelText('Tổng quan đơn hàng'))
    expect(metrics.getByText('6')).toBeTruthy()
    expect(metrics.getAllByText('338,000 đ')).toHaveLength(2)
    expect(mocked.apiGetOrderSummary).toHaveBeenCalledTimes(2)
  })

  it('keeps complete monthly and old-shift totals through pagination, load more and search', async () => {
    mocked.remoteOrders = Array.from({ length: 125 }, (_, index) => historyOrder(125 - index, 10_000, '2026-09-14', {
      paymentMethod: index % 2 ? 'Chuyển khoản' : 'Tiền mặt',
    }))
    mocked.apiGetHistory.mockImplementation(async (_kind, { cursor }) => cursor
      ? page(mocked.remoteOrders.slice(100))
      : morePage(mocked.remoteOrders.slice(0, 100)))
    renderPage()

    await screen.findByText('DOSIINTL-00125')
    const totals = { orders: 125, cash: 630_000, transfer: 620_000, revenue: 1_250_000 }
    const expectFullShift = () => {
      expectMetrics(totals)
      const header = screen.getByText('Tổng tiền cả ca').closest('.order-group__totals')
      expect(within(header).getByText('1,250,000 đ')).toBeTruthy()
      expect(within(header).getByText('125')).toBeTruthy()
    }
    expectFullShift()
    expect(screen.getAllByRole('row')).toHaveLength(21)
    expect(mocked.apiGetHistory).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'Trang 2', exact: true }))
    expect(screen.queryByText('DOSIINTL-00125')).toBeNull()
    expectFullShift()
    fireEvent.click(screen.getByRole('button', { name: 'TẢI THÊM LỊCH SỬ' }))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'TẢI THÊM LỊCH SỬ' })).toBeNull())
    expectFullShift()
    fireEvent.click(screen.getByRole('button', { name: 'Trang 7', exact: true }))
    expect(screen.getAllByRole('row')).toHaveLength(6)
    expect(screen.getByText('DOSIINTL-00001')).toBeTruthy()
    expectFullShift()

    fireEvent.change(screen.getByPlaceholderText('Tìm mã đơn, khách hàng...'), { target: { value: 'DOSIINTL-00001' } })
    expect(screen.getAllByRole('row')).toHaveLength(2)
    expectFullShift()
    fireEvent.change(screen.getByPlaceholderText('Tìm mã đơn, khách hàng...'), { target: { value: 'Không khớp đơn nào' } })
    expect(screen.queryByRole('table')).toBeNull()
    expectMetrics(totals)
    expect(mocked.apiGetOrderSummary).toHaveBeenCalledTimes(1)
  })

  it('defaults to the Vietnam month, selects other months and reports an empty month as zero', async () => {
    vi.setSystemTime(new Date('2026-08-31T17:30:00Z'))
    mocked.remoteOrders = [
      historyOrder(1, 100_000, '2026-08-31', { createdAt: '2026-08-31T16:59:00Z' }),
      historyOrder(2, 200_000, '2026-09-01', { createdAt: '2026-08-31T17:01:00Z', paymentMethod: 'Chuyển khoản' }),
    ]
    renderPage()
    expect(screen.getByLabelText('Kỳ đang xem').value).toBe('2026-09')
    await screen.findByText('DOSIINTL-00002')
    expectMetrics({ orders: 1, cash: 0, transfer: 200_000, revenue: 200_000 })
    expect(mocked.apiGetOrderSummary).toHaveBeenLastCalledWith({ storeId: store.id, period: '2026-09' })

    fireEvent.change(screen.getByLabelText('Lọc theo ngày'), { target: { value: '2026-09-01' } })
    fireEvent.change(screen.getByLabelText('Kỳ đang xem'), { target: { value: '2026-08' } })
    expect(screen.getByLabelText('Lọc theo ngày').value).toBe('')
    await screen.findByText('DOSIINTL-00001')
    expect(screen.queryByText('DOSIINTL-00002')).toBeNull()
    expectMetrics({ orders: 1, cash: 100_000, transfer: 0, revenue: 100_000 })

    fireEvent.change(screen.getByLabelText('Kỳ đang xem'), { target: { value: '2026-10' } })
    await waitFor(() => expect(metricValue('TỔNG SỐ ĐƠN HÀNG')).toBe('0'))
    expectMetrics({ orders: 0, cash: 0, transfer: 0, revenue: 0 })
    expect(screen.queryByRole('table')).toBeNull()
    expect(screen.getByText('Chưa có đơn hàng phù hợp bộ lọc.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Đặt lại' }))
    await screen.findByText('DOSIINTL-00002')
    expect(screen.getByLabelText('Kỳ đang xem').value).toBe('2026-09')
  })

  it('resolves an older deep link before requesting only its original monthly history and summary', async () => {
    const lookupRequest = deferred()
    const linkedStore = { ...store, id: 'S01' }
    const target = historyOrder(1, 100_000, '2026-08-14', { id: 'OLD-AUG', code: 'S01-OLD-AUG', storeId: linkedStore.id })
    const otherAugust = historyOrder(2, 50_000, '2026-08-14', { storeId: linkedStore.id, paymentMethod: 'Chuyển khoản' })
    const currentMonth = historyOrder(3, 900_000, today(), { storeId: linkedStore.id })
    mocked.app = { ...mocked.app, stores: [linkedStore], activeStore: linkedStore, activeStoreId: linkedStore.id, orders: [] }
    mocked.remoteOrders = [currentMonth, target, otherAugust]
    mocked.apiGetHistory.mockImplementation(async (_kind, options) => options.orderId
      ? lookupRequest.promise
      : page(mocked.remoteOrders.filter((order) => orderBusinessDate(order).startsWith(options.period))))
    renderPage('/store/orders?store=S01&order=OLD-AUG')

    expect(mocked.apiGetHistory).toHaveBeenCalledTimes(1)
    expect(mocked.apiGetHistory).toHaveBeenCalledWith('orders', { storeId: 'S01', orderId: 'OLD-AUG', limit: 10 })
    expect(mocked.apiGetOrderSummary).not.toHaveBeenCalled()
    expectPendingMetrics()
    await act(async () => lookupRequest.resolve(page([target])))

    const targetCell = await screen.findByText(target.code)
    expect(screen.getByLabelText('Kỳ đang xem').value).toBe('2026-08')
    expect(targetCell.closest('tr').classList.contains('order-row--highlight')).toBe(true)
    expect(screen.queryByText(currentMonth.code)).toBeNull()
    expectMetrics({ orders: 2, cash: 100_000, transfer: 50_000, revenue: 150_000 })
    expect(mocked.apiGetOrderSummary).toHaveBeenCalledTimes(1)
    expect(mocked.apiGetOrderSummary).toHaveBeenCalledWith({ storeId: 'S01', period: '2026-08' })
    expect(mocked.apiGetHistory).toHaveBeenCalledTimes(2)
    expect(mocked.apiGetHistory).toHaveBeenNthCalledWith(2, 'orders', expect.objectContaining({ storeId: 'S01', period: '2026-08', cursor: '' }))
    expect(mocked.apiGetHistory.mock.calls.some(([, options]) => options.period === '2026-09')).toBe(false)
  })

  it.each(['unknown', 'deleted', 'foreign'])('cannot inject an %s deep-link lookup result into the selected store', async (kind) => {
    const candidate = historyOrder(1, 800_000, '2026-08-14', {
      id: 'OLD-AUG',
      code: 'UNAVAILABLE-OLD-AUG',
      ...(kind === 'deleted' ? { deletedAt: '2026-09-01T00:00:00Z', status: 'Đã xóa' } : {}),
      ...(kind === 'foreign' ? { storeId: 'OTHER-STORE' } : {}),
    })
    const ownOrder = historyOrder(2, 30_000)
    mocked.remoteOrders = [ownOrder]
    mocked.apiGetHistory.mockImplementation(async (_kind, options) => options.orderId
      ? page(kind === 'unknown' ? [] : [candidate])
      : page([ownOrder]))
    renderPage(`/store/orders?store=${store.id}&order=OLD-AUG`)

    await screen.findByText('Không tìm thấy đơn hàng được yêu cầu trong cửa hàng này.')
    await screen.findByText(ownOrder.code)
    expect(screen.getByLabelText('Kỳ đang xem').value).toBe('2026-09')
    expect(screen.queryByText(candidate.code)).toBeNull()
    expect(screen.getByText(ownOrder.code).closest('tr').classList.contains('order-row--highlight')).toBe(false)
    expectMetrics({ orders: 1, cash: 30_000, transfer: 0, revenue: 30_000 })
    expect(mocked.apiGetOrderSummary).toHaveBeenCalledWith({ storeId: store.id, period: '2026-09' })
  })

  it('never substitutes loaded-row totals while monthly totals are pending or fail, and retries explicitly', async () => {
    const summaryRequest = deferred()
    mocked.remoteOrders = [historyOrder(1, 30_000)]
    mocked.apiGetOrderSummary.mockImplementationOnce(() => summaryRequest.promise)
    renderPage()
    await screen.findByText('DOSIINTL-00001')
    expectPendingMetrics()
    const header = screen.getByText('Tổng tiền cả ca').closest('.order-group__totals')
    expect(within(header).getAllByText('—')).toHaveLength(4)

    await act(async () => summaryRequest.reject(new Error('Không thể tải tổng kỳ kiểm tra.')))
    expect(screen.getByText('Không thể tải tổng kỳ kiểm tra.')).toBeTruthy()
    expectPendingMetrics()
    fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }))
    await waitFor(() => expect(metricValue('TỔNG SỐ ĐƠN HÀNG')).toBe('1'))
    expectMetrics({ orders: 1, cash: 30_000, transfer: 0, revenue: 30_000 })
    expect(mocked.apiGetOrderSummary).toHaveBeenCalledTimes(2)
  })

  it('does not present a stale partial projection as monthly totals when API status is error', async () => {
    const partialProjection = historyOrder(1, 30_000)
    mocked.app = { ...mocked.app, apiStatus: 'error', orders: [partialProjection] }
    mocked.remoteOrders = [partialProjection, historyOrder(2, 70_000)]
    mocked.apiGetOrderSummary.mockRejectedValue(new Error('Không thể xác minh tổng tháng.'))
    renderPage()

    expectPendingMetrics()
    await screen.findByText('Không thể xác minh tổng tháng.')
    expectPendingMetrics()
    expect(mocked.apiGetOrderSummary).toHaveBeenCalledWith({ storeId: store.id, period: '2026-09' })
    expect(within(screen.getByLabelText('Tổng quan đơn hàng')).queryByText('30,000 đ')).toBeNull()
    const header = screen.getByText('Tổng tiền cả ca').closest('.order-group__totals')
    expect(within(header).getAllByText('—')).toHaveLength(4)
  })

  it('refreshes edit and delete results with unchanged stateVersion and never restores a stale projection', async () => {
    const original = historyOrder(1, 30_000)
    mocked.remoteOrders = [original]
    mocked.app.orders = [original]
    mocked.app.updateOrder.mockImplementation(async (_id, changes) => {
      const updated = { ...original, ...changes, updatedAt: '2026-09-15T05:00:00Z' }
      mocked.remoteOrders = [updated]
      return { ok: true, order: updated }
    })
    mocked.app.deleteOrder.mockImplementation(async () => {
      const deleted = { ...mocked.remoteOrders[0], deletedAt: '2026-09-15T05:05:00Z', status: 'Đã xóa' }
      mocked.remoteOrders = [deleted]
      return { ok: true, order: deleted }
    })
    vi.spyOn(window, 'prompt').mockReturnValue('Đơn nhập trùng')
    const view = renderPage()
    await screen.findByText('DOSIINTL-00001')
    fireEvent.click(screen.getByRole('button', { name: 'Sửa', exact: true }))
    const editor = within(screen.getByRole('dialog'))
    fireEvent.change(editor.getByLabelText(/Số tiền/u), { target: { value: '45,000' } })
    fireEvent.change(editor.getByLabelText(/Hình thức thanh toán/u), { target: { value: 'Chuyển khoản' } })
    fireEvent.change(editor.getByLabelText(/Lý do chỉnh sửa/u), { target: { value: 'Đối chiếu thanh toán' } })
    fireEvent.click(editor.getByRole('button', { name: 'LƯU THAY ĐỔI' }))

    await waitFor(() => expect(mocked.apiGetHistory).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(metricValue('TỔNG DOANH THU')).toBe('45,000 đ'))
    expectMetrics({ orders: 1, cash: 0, transfer: 45_000, revenue: 45_000 })
    expect(mocked.app.stateVersion).toBe(10)
    expect(mocked.apiGetOrderSummary).toHaveBeenCalledTimes(2)
    const row = screen.getByText('DOSIINTL-00001').closest('tr')
    expect(within(row).getByText('45,000 đ')).toBeTruthy()
    expect(within(row).getByText('Chuyển khoản')).toBeTruthy()

    fireEvent.click(within(row).getByRole('button', { name: 'Xóa', exact: true }))
    await waitFor(() => expect(mocked.apiGetHistory).toHaveBeenCalledTimes(3))
    await waitFor(() => expect(metricValue('TỔNG SỐ ĐƠN HÀNG')).toBe('0'))
    expect(screen.queryByText('DOSIINTL-00001')).toBeNull()
    expectMetrics({ orders: 0, cash: 0, transfer: 0, revenue: 0 })

    mocked.app = { ...mocked.app, orders: [original] }
    view.rerender(viewElement())
    expect(screen.queryByText('DOSIINTL-00001')).toBeNull()
    expect(mocked.app.stateVersion).toBe(10)
    expect(mocked.apiGetOrderSummary).toHaveBeenCalledTimes(3)
  })

  it.each(['month', 'version'])('ignores an older load-more response after the %s changes', async (change) => {
    const oldRequest = deferred()
    const original = historyOrder(1, 30_000, '2026-09-14')
    const replacement = historyOrder(2, 90_000, change === 'month' ? '2026-08-14' : '2026-09-13')
    mocked.remoteOrders = [original]
    mocked.apiGetHistory
      .mockResolvedValueOnce(morePage([original]))
      .mockImplementationOnce(() => oldRequest.promise)
      .mockResolvedValueOnce(page([replacement]))
    const view = renderPage()
    await screen.findByText(original.code)
    fireEvent.click(screen.getByRole('button', { name: 'TẢI THÊM LỊCH SỬ' }))
    await waitFor(() => expect(mocked.apiGetHistory).toHaveBeenCalledTimes(2))
    mocked.remoteOrders = [replacement]
    if (change === 'month') {
      fireEvent.change(screen.getByLabelText('Kỳ đang xem'), { target: { value: '2026-08' } })
    } else {
      mocked.app = appAtVersion(11)
      view.rerender(viewElement())
    }
    await screen.findByText(replacement.code)
    expectMetrics({ orders: 1, cash: 90_000, transfer: 0, revenue: 90_000 })

    const obsolete = historyOrder(3, 800_000, '2026-09-13')
    await act(async () => oldRequest.resolve(morePage([obsolete], 'stale-cursor')))
    expect(screen.queryByText(obsolete.code)).toBeNull()
    expect(screen.queryByText(original.code)).toBeNull()
    expect(screen.queryByRole('button', { name: 'TẢI THÊM LỊCH SỬ' })).toBeNull()
    expectMetrics({ orders: 1, cash: 90_000, transfer: 0, revenue: 90_000 })
  })
  it('finds exact amounts beyond the first history page and combines payment without downloading unrelated pages', async () => {
    mocked.remoteOrders = Array.from({ length: 125 }, (_, index) => historyOrder(125 - index, index < 113 ? 10_000 : 20_000, '2026-09-14', {
      paymentMethod: index % 2 ? 'bank_transfer' : 'TIỀN MẶT',
      customerName: 'Nguyễn Thị Ánh với tên khách hàng rất dài để đọc đầy đủ trên điện thoại',
    }))
    mocked.remoteOrders.push(historyOrder(126, 0, '2026-09-14'))
    mocked.apiGetHistory.mockImplementation(async (_kind, options) => {
      const matches = mocked.remoteOrders.filter((order) => orderMatchesFilters(order, options))
      return matches.length > 100 ? morePage(matches.slice(0, 100)) : page(matches)
    })
    renderPage()
    await screen.findByText('DOSIINTL-00125')
    expect(screen.queryByText('DOSIINTL-00001')).toBeNull()
    const amountInput = screen.getByRole('textbox', { name: 'Lọc đơn hàng theo số tiền' })
    fireEvent.change(amountInput, { target: { value: '20,000' } })
    await screen.findByText('12 đơn phù hợp số tiền 20,000 đ')
    await screen.findByText('DOSIINTL-00001')
    expect(screen.queryByText('DOSIINTL-00125')).toBeNull()
    expect(mocked.apiGetHistory).toHaveBeenCalledTimes(2)
    expect(mocked.apiGetHistory).toHaveBeenLastCalledWith('orders', expect.objectContaining({ amount: 20_000, limit: 100 }))
    expect(mocked.apiGetOrderSummary).toHaveBeenCalledTimes(2)
    const header = screen.getByText('Tổng tiền cả ca').closest('.order-group__totals')
    expect(within(header).getByText('126')).toBeTruthy()
    expect(within(header).getByText('1,370,000 đ')).toBeTruthy()
    expect(within(header).getByText('64 đơn')).toBeTruthy()
    expect(within(header).getByText('62 đơn')).toBeTruthy()
    fireEvent.change(screen.getByRole('combobox', { name: 'Lọc đơn hàng theo thanh toán' }), { target: { value: 'Chuyển khoản' } })
    await screen.findByText('6 đơn phù hợp số tiền 20,000 đ')
    expect(screen.queryByText('DOSIINTL-00001')).toBeNull()
    const result = within(screen.getByRole('group', { name: 'Kết quả lọc' }))
    expect(result.getAllByText('120,000 đ')).toHaveLength(2)
    fireEvent.change(amountInput, { target: { value: '0' } })
    await screen.findByText('0 đơn phù hợp số tiền 0 đ')
    fireEvent.change(screen.getByRole('combobox', { name: 'Lọc đơn hàng theo thanh toán' }), { target: { value: 'Tiền mặt' } })
    await screen.findByText('1 đơn phù hợp số tiền 0 đ')
    await screen.findByText('DOSIINTL-00126')
    expect(screen.queryByRole('button', { name: 'TẢI THÊM LỊCH SỬ' })).toBeNull()
    expectMetrics({ orders: 126, revenue: 1_370_000, cash: 690_000, transfer: 680_000 })
  })

  it('discards late filtered responses and refreshes counts after an order changes payment method', async () => {
    mocked.remoteOrders = [historyOrder(1, 20_000), historyOrder(2, 20_000, today(), { paymentMethod: 'Chuyển khoản' })]
    const stale = deferred()
    mocked.apiGetHistory.mockImplementation(async (_kind, options) => {
      if (options.paymentMethod === 'Tiền mặt') return stale.promise
      return page(mocked.remoteOrders.filter((order) => orderMatchesFilters(order, options)))
    })
    const view = renderPage()
    await screen.findByText('DOSIINTL-00001')
    const payment = screen.getByRole('combobox', { name: 'Lọc đơn hàng theo thanh toán' })
    fireEvent.change(payment, { target: { value: 'Tiền mặt' } })
    await waitFor(() => expect(mocked.apiGetHistory).toHaveBeenCalledTimes(2))
    fireEvent.change(payment, { target: { value: 'Chuyển khoản' } })
    await screen.findByText('DOSIINTL-00002')
    await act(async () => stale.resolve(page([mocked.remoteOrders[0]])))
    expect(screen.queryByText('DOSIINTL-00001')).toBeNull()
    expect(screen.getByText('1 đơn phù hợp')).toBeTruthy()
    mocked.remoteOrders = mocked.remoteOrders.map((order) => ({ ...order, paymentMethod: 'Chuyển khoản' }))
    mocked.app = { ...mocked.app, stateVersion: 11 }
    view.rerender(viewElement())
    await screen.findByText('2 đơn phù hợp')
    await screen.findByText('DOSIINTL-00001')
    expect(within(screen.getByRole('group', { name: 'Kết quả lọc' })).getAllByText('40,000 đ')).toHaveLength(2)
  })

})
