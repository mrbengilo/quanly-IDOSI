import { describe, expect, it } from 'vitest'
import { importPeriodChange, importVoucherAmounts, previousImportPeriod, selectImportHistory, validImportPeriod } from './importHistory'

describe('import history periods and stored amounts', () => {
  it('uses the Vietnam creation date and excludes other stores and deleted vouchers', () => {
    const vouchers = [
      { id: 'A', storeId: 'S1', createdAt: '2026-08-31T17:00:00Z', goodsAmount: 100, shippingAmount: 20, totalAmount: 125 },
      { id: 'B', storeId: 'S1', createdAt: '2026-08-31T16:59:59Z', totalAmount: 200 },
      { id: 'C', storeId: 'S2', createdAt: '2026-09-01', totalAmount: 9999 },
      { id: 'D', storeId: 'S1', createdAt: '2026-09-01', deletedAt: '2026-09-02', totalAmount: 9999 },
      { id: 'E', storeId: 'S1', createdAt: '2026-09-01', status: 'Đã xóa', totalAmount: 9999 },
    ]
    const history = selectImportHistory(vouchers, { storeId: 'S1', period: '2026-09' })
    expect(history.rows.map(({ id }) => id)).toEqual(['A'])
    expect(history.totals).toEqual({ goods: 100, shipping: 20, total: 125, count: 1 })
    expect(selectImportHistory(vouchers, { storeId: 'S1', period: '2026-09-01', mode: 'day' }).rows).toEqual(history.rows)
    expect(vouchers.map(({ id }) => id)).toEqual(['A', 'B', 'C', 'D', 'E'])
  })

  it('preserves stored zero totals and uses all legacy items plus related costs only when totals are absent', () => {
    const voucher = { items: [{ weight: 2, price: 10 }, { quantity: 3, price: 5 }], shippingAmount: 4, relatedAmount: 1 }
    expect(importVoucherAmounts(voucher)).toEqual({ goods: 35, shipping: 4, total: 40 })
    expect(importVoucherAmounts({ ...voucher, goodsAmount: 30, totalAmount: 0 })).toEqual({ goods: 30, shipping: 4, total: 0 })
    expect(importVoucherAmounts({ items: [{ weight: 1.5, price: 3 }, { weight: 1.5, price: 3 }] }).goods).toBe(10)
    expect(importVoucherAmounts({})).toEqual({ goods: 0, shipping: 0, total: 0 })
  })

  it('handles month/year rollover, leap days, malformed filters and empty periods', () => {
    expect(previousImportPeriod('2026-01')).toBe('2025-12')
    expect(previousImportPeriod('2024-03-01', 'day')).toBe('2024-02-29')
    expect(previousImportPeriod('2026-01-01', 'day')).toBe('2025-12-31')
    expect(validImportPeriod('2026-02-30', 'day')).toBe(false)
    expect(validImportPeriod('2026-13')).toBe(false)
    expect(selectImportHistory([], { storeId: 'S1', period: '2026-09' }).totals.count).toBe(0)
    expect(selectImportHistory([{ storeId: '', createdAt: '2026-09-01' }], { storeId: '', period: '2026-09' }).rows).toEqual([])
  })

  it('compares increases, decreases and zero baselines without infinite percentages', () => {
    expect(importPeriodChange(150, 100)).toEqual({ amount: 50, percent: 50 })
    expect(importPeriodChange(50, 100)).toEqual({ amount: -50, percent: -50 })
    expect(importPeriodChange(100, 0)).toEqual({ amount: 100, percent: null })
    expect(importPeriodChange(0, 0)).toEqual({ amount: 0, percent: 0 })
  })
})
