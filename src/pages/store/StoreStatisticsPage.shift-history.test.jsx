import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { summarizeOrders } from '../../domain/orderSummary'
import { StoreStatisticsPage } from './StoreStatisticsPage'

const { apiGetOrderSummary, context } = vi.hoisted(() => ({ apiGetOrderSummary: vi.fn(), context: { storeId: 'S1' } }))
vi.mock('../../services/idosiApi', () => ({ apiGetOrderSummary }))
vi.mock('../../state/AppContext', () => ({ useApp: () => ({
  activeStoreId: context.storeId, stateVersion: 1,
  session: { role: 'store_manager', storeId: context.storeId },
  stores: [{ id: 'S1', name: 'Synthetic store one' }, { id: 'S2', name: 'Synthetic store two' }],
  shiftDefinitions: [{ id: 'new-am', name: 'Ca sáng', start: '08:00', end: '12:00' }, { id: 'new-pm', name: 'Ca tối', start: '17:00', end: '22:00' }],
}) }))

const date = '2026-09-06'
const pm = 'ca tối:17:00:22:00'
const common = { storeId: 'S1', employeeId: 'E1', createdAt: `${date}T18:00:00+07:00`, paymentMethod: 'Tiền mặt' }
const rows = [
  { ...common, id: 'AM', shiftId: 'old-am', shiftName: 'Ca sáng', shiftStart: '08:00', shiftEnd: '12:00', amount: 100000 },
  { ...common, id: 'PM', shiftName: 'Ca tối', shiftStart: '17:00', shiftEnd: '22:00', amount: 180000, normalAmount: 100000, items: [
    { productId: 'P1', productName: 'Đồ nam kiểm thử', quantity: 2 },
    { productId: 'P1', productName: 'Đồ nam kiểm thử', revenueType: 'SALE_KG', quantity: 2.5, unitPrice: 20000 },
    { productId: 'P1', productName: 'Đồ nam kiểm thử', revenueType: 'SALE_PIECE', quantity: 3, unitPrice: 10000 },
  ] },
  { ...common, id: 'UNKNOWN', amount: 20000 },
  { ...common, id: 'S2-PM', storeId: 'S2', shiftId: 'S2-old', shiftName: 'Ca tối', amount: 777000 },
]
const response = (query) => Promise.resolve(summarizeOrders(rows, query))
const selectMode = (value) => fireEvent.change(screen.getByLabelText('Xem thống kê theo'), { target: { value } })
const selectDate = (value) => fireEvent.change(screen.getByLabelText('Ngày thống kê'), { target: { value } })
const selectShift = (value) => fireEvent.change(screen.getByLabelText('Ca thống kê'), { target: { value } })
const revenue = (name) => screen.findByRole('region', { name: `Doanh thu ${name} • 06/09/2026` })
beforeEach(() => { context.storeId = 'S1'; apiGetOrderSummary.mockImplementation(response) })
afterEach(() => { cleanup(); vi.resetAllMocks() })
async function openDay() {
  const view = render(<StoreStatisticsPage />)
  selectDate(date)
  await screen.findByRole('region', { name: 'Doanh thu Ngày 06/09/2026' })
  return view
}

describe('store historical shift selection', () => {
  it('selects the recorded evening snapshot and renders its three totals and products, not the day total', async () => {
    await openDay(); selectMode('shift')
    await waitFor(() => expect(screen.getByLabelText('Ca thống kê').disabled).toBe(false))
    selectShift(pm)
    const selected = await revenue('Ca tối')
    for (const amount of ['100,000 đ', '50,000 đ', '30,000 đ', '180,000 đ']) expect(within(selected).getByText(amount)).toBeTruthy()
    expect(within(selected).queryByText('300,000 đ')).toBeNull()
    expect(apiGetOrderSummary).toHaveBeenCalledWith(expect.objectContaining({ storeId: 'S1', date, period: '2026-09', shiftId: pm }))
    expect(screen.getAllByText('Đồ nam kiểm thử').length).toBeGreaterThan(0)
    const weight = screen.getByRole('region', { name: 'Khối lượng • Doanh thu Ca tối • 06/09/2026' })
    expect(within(weight).getByText('2,5 kg')).toBeTruthy()
    const productRow = within(document.querySelector('.store-statistics-products')).getByRole('row', { name: /Sale theo ký/u })
    expect(productRow.querySelector('[data-label="Số lượng"]').textContent).toBe('2,5 kg')
    expect([...screen.getByLabelText('Ca thống kê').options].some((option) => option.value === 'new-pm')).toBe(false)
  })
  it('enables Xem ca for historical IDs and missing IDs, and isolates the unbound group', async () => {
    await openDay()
    const row = screen.getByRole('row', { name: /Ca tối/u })
    fireEvent.click(within(row).getByRole('button', { name: 'Xem ca' }))
    expect(within(await revenue('Ca tối')).getByText('180,000 đ')).toBeTruthy()
    selectShift('old-am')
    expect(within(await revenue('Ca sáng')).getAllByText('100,000 đ').length).toBeGreaterThan(0)
    selectShift('chưa gắn ca::')
    expect(within(await revenue('Chưa gắn ca')).getAllByText('20,000 đ').length).toBeGreaterThan(0)
  })
  it('refreshes day identities and the selected shift, but reuses the cached day when switching shifts', async () => {
    await openDay(); selectMode('shift')
    await waitFor(() => expect(screen.getByLabelText('Ca thống kê').disabled).toBe(false))
    selectShift(pm); await revenue('Ca tối')
    const dayReads = () => apiGetOrderSummary.mock.calls.filter(([q]) => q.date === date && !q.shiftId).length
    const before = dayReads()
    selectShift('old-am'); await revenue('Ca sáng')
    expect(dayReads()).toBe(before)
    fireEvent.click(screen.getByRole('button', { name: 'Làm mới số liệu' }))
    await revenue('Ca sáng')
    await waitFor(() => expect(dayReads()).toBe(before + 1))
    expect(apiGetOrderSummary.mock.lastCall[0]).toMatchObject({ date, shiftId: 'old-am' })
  })
  it('does not turn a failed date request into zero revenue or keep stale shift totals', async () => {
    await openDay(); selectMode('shift')
    await waitFor(() => expect(screen.getByLabelText('Ca thống kê').disabled).toBe(false))
    selectShift(pm); await revenue('Ca tối')
    apiGetOrderSummary.mockImplementation((q) => q.date === '2026-09-07' ? Promise.reject(new Error('Không tải được ngày mới')) : response(q))
    selectDate('2026-09-07')
    await screen.findByText('Không tải được ngày mới')
    expect(screen.queryByText('180,000 đ')).toBeNull()
    expect(screen.queryByText('0 đ')).toBeNull()
  })
  it('ignores a slower response after another shift is selected', async () => {
    await openDay()
    let resolveEvening
    apiGetOrderSummary.mockImplementation((q) => q.shiftId === pm ? new Promise((resolve) => { resolveEvening = resolve }) : response(q))
    selectMode('shift')
    await waitFor(() => expect(screen.getByLabelText('Ca thống kê').disabled).toBe(false))
    selectShift(pm)
    await waitFor(() => expect(resolveEvening).toBeTypeOf('function'))
    selectShift('old-am'); await revenue('Ca sáng')
    resolveEvening(summarizeOrders(rows, { storeId: 'S1', date, shiftId: pm }))
    await waitFor(() => expect(screen.queryByText('180,000 đ')).toBeNull())
    expect(within(await revenue('Ca sáng')).getAllByText('100,000 đ').length).toBeGreaterThan(0)
  })
  it('resets selected keys when the store changes and never shows the previous store response', async () => {
    const view = await openDay(); selectMode('shift')
    await waitFor(() => expect(screen.getByLabelText('Ca thống kê').disabled).toBe(false))
    selectShift(pm); await revenue('Ca tối')
    context.storeId = 'S2'; view.rerender(<StoreStatisticsPage />)
    await waitFor(() => expect(apiGetOrderSummary).toHaveBeenCalledWith(expect.objectContaining({ storeId: 'S2', date, shiftId: 'S2-old' })))
    await waitFor(() => expect(screen.getAllByText('777,000 đ').length).toBeGreaterThan(0))
    expect(screen.queryByText('180,000 đ')).toBeNull()
  })
})
