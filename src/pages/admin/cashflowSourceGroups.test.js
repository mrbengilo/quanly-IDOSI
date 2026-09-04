import { describe, expect, it } from 'vitest'
import { cashflowSourceDates, cashflowSourceRowsForDate } from './cashflowSourceGroups'

const transactions = [
  { id: 'O1', storeId: 'S01', sourceType: 'order', direction: 'in', amount: 100_000, occurredAt: '2026-09-04T09:00:00+07:00' },
  { id: 'O2', storeId: 'S01', sourceType: 'order', direction: 'in', amount: 250_000, occurredAt: '2026-09-04T10:00:00+07:00' },
  { id: 'E1', storeId: 'S01', sourceType: 'expense', source: 'Chi phí', category: 'Điện', direction: 'out', amount: 20_000, occurredAt: '2026-09-04T11:00:00+07:00' },
  { id: 'O3', storeId: 'S02', sourceType: 'order', direction: 'in', amount: 90_000, occurredAt: '2026-09-03T09:00:00+07:00' },
]

describe('cashflow source grouping', () => {
  it('collapses all order revenue for one store and day into one source row', () => {
    const rows = cashflowSourceRowsForDate(transactions, '2026-09-04')
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({
      storeId: 'S01', source: 'Tổng doanh thu đơn hàng', detail: '2 đơn hàng', amount: 350_000,
    })
    expect(rows.find((row) => row.sourceType === 'expense')).toMatchObject({ amount: 20_000, direction: 'out' })
  })

  it('starts with today and then exposes only older transaction dates', () => {
    expect(cashflowSourceDates(transactions, '2026-09-04')).toEqual(['2026-09-04', '2026-09-03'])
    expect(cashflowSourceDates(transactions, '2026-09-05')).toEqual(['2026-09-05', '2026-09-04', '2026-09-03'])
  })
})
