import { describe, expect, it } from 'vitest'
import { storeDailyReportRows, storeMonthlyReportRows } from './storeReportAnalytics'

describe('store report analytics', () => {
  const transactions = [
    { storeId: 'S01', direction: 'in', amount: 200_000, occurredAt: '2026-08-19T08:00:00+07:00' },
    { storeId: 'S01', direction: 'out', type: 'Điện', amount: 50_000, occurredAt: '2026-08-19T09:00:00+07:00' },
    { storeId: 'S01', direction: 'in', amount: 400_000, occurredAt: '2026-08-20T08:00:00+07:00' },
    { storeId: 'S01', direction: 'out', type: 'Marketing', amount: 100_000, occurredAt: '2026-08-20T09:00:00+07:00' },
    { storeId: 'S01', direction: 'in', amount: 100_000, occurredAt: '2026-07-20T08:00:00+07:00' },
  ]
  const orders = [
    { id: '1', storeId: 'S01', amount: 200_000, shiftName: 'Ca sáng', createdAt: '2026-08-19T08:00:00+07:00' },
    { id: '2', storeId: 'S01', amount: 400_000, shiftName: 'Ca tối', createdAt: '2026-08-20T08:00:00+07:00' },
  ]

  it('shows daily shift revenue, expense categories, and prior-day growth', () => {
    const rows = storeDailyReportRows({ transactions, orders, storeId: 'S01', period: '2026-08' })
    expect(rows[0]).toMatchObject({ key: '2026-08-20', revenue: 400_000, expense: 100_000, shifts: { 'Ca tối': 400_000 }, expenses: { Marketing: 100_000 } })
    expect(rows[0].comparison).toMatchObject({ label: 'Tăng trưởng', percent: 100 })
  })

  it('compares the selected month to the previous month', () => {
    const rows = storeMonthlyReportRows({ transactions, orders, storeId: 'S01', period: '2026-08' })
    expect(rows[0]).toMatchObject({ key: '2026-08', revenue: 600_000, expense: 150_000, previous: { key: '2026-07', revenue: 100_000 } })
    expect(rows[0].comparison.label).toBe('Tăng trưởng')
  })
})
