import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AdminCashflowV2 } from './SystemFinanceV2'

const appState = {
  stores: [
    { id: 'S01', name: 'Dosii KVC' },
    { id: 'S02', name: 'Dosii TNV' },
  ],
  orders: [
    { id: 'ORDER-AUG-21', storeId: 'S01', amount: 200000, status: 'Hoàn tất', createdAt: '2026-08-21T09:00:00+07:00' },
    { id: 'ORDER-AUG-22-S01', storeId: 'S01', amount: 100000, status: 'Hoàn tất', createdAt: '2026-08-22T09:00:00+07:00' },
    { id: 'ORDER-AUG-22-S02', storeId: 'S02', amount: 300000, status: 'Hoàn tất', createdAt: '2026-08-22T10:00:00+07:00' },
    { id: 'ORDER-SEP-01', storeId: 'S01', amount: 400000, status: 'Hoàn tất', createdAt: '2026-09-01T09:00:00+07:00' },
    { id: 'ORDER-SEP-02-UTC', storeId: 'S02', amount: 500000, status: 'Hoàn tất', createdAt: '2026-09-01T18:00:00.000Z' },
  ],
  expenseEntries: [
    { id: 'EXP-AUG-22-S01', storeId: 'S01', amount: 10000, type: 'Điện', recognized: true, createdAt: '2026-08-22T11:00:00+07:00' },
    { id: 'EXP-AUG-22-S02', storeId: 'S02', amount: 20000, type: 'Nước', recognized: true, createdAt: '2026-08-22T12:00:00+07:00' },
  ],
}

vi.mock('../../state/AppContext', () => ({
  useApp: () => appState,
}))

const cardFor = (title) => screen.getByRole('heading', { name: title }).closest('.card')

describe('AdminCashflowV2 filters', () => {
  afterEach(cleanup)

  it('filters the daily cash-flow table by an exact day and store', () => {
    render(<AdminCashflowV2 />)
    const card = cardFor('Dòng tiền theo ngày')

    fireEvent.change(within(card).getByLabelText('Chế độ lọc dòng tiền theo ngày'), { target: { value: 'day' } })
    fireEvent.change(within(card).getByLabelText('Chọn ngày dòng tiền theo ngày'), { target: { value: '2026-08-22' } })
    fireEvent.change(within(card).getByLabelText('Chọn cửa hàng dòng tiền theo ngày'), { target: { value: 'S01' } })

    expect(within(card).getByText('22/08/26')).toBeTruthy()
    expect(within(card).getByText('100,000 đ')).toBeTruthy()
    expect(within(card).getByText('10,000 đ')).toBeTruthy()
    expect(within(card).queryByText('300,000 đ')).toBeNull()
    expect(within(card).queryByText('21/08/26')).toBeNull()
  })

  it('shows current-day sources first, groups order revenue, and pages older dates', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-02T03:00:00.000Z'))
    try {
      render(<AdminCashflowV2 />)
      const dailyCard = cardFor('Dòng tiền theo ngày')
      const sourceCard = cardFor('Nguồn giao dịch')
      const sourceRows = sourceCard.querySelector('tbody')

      expect(within(sourceRows).getByText('02/09/26')).toBeTruthy()
      expect(within(sourceRows).getByText('Tổng doanh thu đơn hàng')).toBeTruthy()
      expect(within(sourceRows).getByText('1 đơn hàng')).toBeTruthy()
      expect(within(sourceRows).getByText('500,000 đ')).toBeTruthy()
      expect(within(sourceRows).queryByText('01/09/26')).toBeNull()

      fireEvent.click(within(sourceCard).getByRole('button', { name: 'Ngày giao dịch cũ hơn' }))
      expect(within(sourceRows).getByText('01/09/26')).toBeTruthy()
      expect(within(sourceRows).getByText('400,000 đ')).toBeTruthy()
      expect(within(sourceRows).queryByText('02/09/26')).toBeNull()

      fireEvent.change(within(sourceCard).getByLabelText('Lọc cửa hàng nguồn giao dịch'), { target: { value: 'S02' } })
      expect(within(sourceRows).getByText('500,000 đ')).toBeTruthy()
      expect(within(sourceRows).queryByText('400,000 đ')).toBeNull()

      fireEvent.change(within(dailyCard).getByLabelText('Chọn tháng dòng tiền theo ngày'), { target: { value: '2026-09' } })
      expect(within(dailyCard).getByText('01/09/26')).toBeTruthy()
    } finally {
      vi.useRealTimers()
    }
  })

  it('groups UTC timestamps by the Vietnam business date used by the finance filter', () => {
    render(<AdminCashflowV2 />)
    const dailyCard = cardFor('Dòng tiền theo ngày')

    fireEvent.change(within(dailyCard).getByLabelText('Chế độ lọc dòng tiền theo ngày'), { target: { value: 'day' } })
    fireEvent.change(within(dailyCard).getByLabelText('Chọn ngày dòng tiền theo ngày'), { target: { value: '2026-09-02' } })
    fireEvent.change(within(dailyCard).getByLabelText('Chọn cửa hàng dòng tiền theo ngày'), { target: { value: 'S02' } })

    expect(within(dailyCard).getByText('02/09/26')).toBeTruthy()
    expect(within(dailyCard).getAllByText('500,000 đ')).toHaveLength(2)
    expect(within(dailyCard).queryByText('01/09/26')).toBeNull()
  })

  it('keeps the last valid period when the native picker emits an empty value', () => {
    render(<AdminCashflowV2 />)
    const dailyCard = cardFor('Dòng tiền theo ngày')
    const monthPicker = within(dailyCard).getByLabelText('Chọn tháng dòng tiền theo ngày')

    fireEvent.change(monthPicker, { target: { value: '2026-09' } })
    expect(monthPicker.value).toBe('2026-09')
    fireEvent.change(monthPicker, { target: { value: '' } })

    expect(monthPicker.value).toBe('2026-09')
    expect(within(dailyCard).getByText('01/09/26')).toBeTruthy()
  })
})
