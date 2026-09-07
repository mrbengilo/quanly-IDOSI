import { describe, expect, it } from 'vitest'
import { orderBusinessDate, orderGroupKey, parseOrderAmountFilter, summarizeOrders } from './orderSummary'

describe('orderSummary', () => {
  it('uses the Vietnam business date for explicit-zone timestamps only', () => {
    expect(orderBusinessDate({ createdAt: '2026-08-31T18:30:00.000Z' })).toBe('2026-09-01')
    expect(orderBusinessDate({ createdAt: '2026-09-01T00:30:00+07:00' })).toBe('2026-09-01')
    expect(orderBusinessDate({ createdAt: '2026-08-31T23:30:00' })).toBe('2026-08-31')
    expect(orderBusinessDate({ date: '2026-09-10', updatedAt: '2026-12-20T01:00:00Z' })).toBe('2026-09-10')
  })

  it('builds the same shift, day and employee keys as the order display', () => {
    const order = {
      createdAt: '2026-09-01T01:00:00+07:00',
      employeeId: 'E01',
      shiftName: 'CA SÁNG',
      shiftStart: '08:00',
      shiftEnd: '12:00',
    }
    expect(orderGroupKey(order)).toBe('2026-09-01:ca sáng:08:00:12:00')
    expect(orderGroupKey(order, 'day')).toBe('2026-09-01')
    expect(orderGroupKey(order, 'employee')).toBe('E01')
    expect(orderGroupKey({ ...order, shiftId: 'morning' })).toBe('2026-09-01:morning')
    expect(orderBusinessDate(null)).toBe('')
    expect(orderGroupKey(null, 'employee')).toBe('system')
    expect(orderGroupKey({ employeeId: 123 }, 'employee')).toBe('123')
  })

  it('summarizes the full eligible scoped period by payment method and group', () => {
    const result = summarizeOrders([
      { id: 'CASH', storeId: 'S01', employeeId: 'E01', shiftId: 'morning', amount: 100_000, paymentMethod: 'Tiền mặt', createdAt: '2026-08-31T18:00:00Z' },
      { id: 'TRANSFER', storeId: 's01', employeeId: 'E02', shiftId: 'night', amount: 250_000, paymentMethod: 'Chuyển khoản', createdAt: '2026-09-01T20:00:00+07:00' },
      { id: 'OTHER', storeId: 'S01', amount: 50_000, paymentMethod: 'Khác', createdAt: '2026-09-02' },
      { id: 'DELETED', storeId: 'S01', amount: 900_000, deletedAt: '2026-09-03', createdAt: '2026-09-03' },
      { id: 'OPENING', storeId: 'S01', amount: 800_000, source: 'legacy-opening-balance', createdAt: '2026-09-04' },
      { id: 'FOREIGN', storeId: 'S02', amount: 700_000, createdAt: '2026-09-05' },
    ], { storeId: 'S01', period: '2026-09' })

    expect(result.totals).toEqual({ orders: 3, cash: 100_000, transfer: 250_000, revenue: 400_000, cashOrders: 1, transferOrders: 1 })
    expect(result.groups.shift).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: '2026-09-01:morning', shiftId: 'morning', orders: 1 }),
    ]))
    expect(result.groups.shift).toHaveLength(3)
    expect(result.groups.day.map(({ key }) => key)).toEqual(['2026-09-01', '2026-09-02'])
    expect(result.groups.employee.map(({ key, revenue }) => [key, revenue])).toEqual([
      ['E01', 100_000], ['E02', 250_000], ['system', 50_000],
    ])
  })

  it('fails closed on invalid eligible VND amounts', () => {
    expect(() => summarizeOrders([
      { id: 'INVALID', storeId: 'S01', amount: 1.5, createdAt: '2026-09-01' },
    ], { storeId: 'S01', period: '2026-09' })).toThrow(/Invalid order amount/u)
    expect(() => summarizeOrders([
      { id: 'BLANK', storeId: 'S01', amount: ' ', createdAt: '2026-09-01' },
    ], { storeId: 'S01', period: '2026-09' })).toThrow(/Invalid order amount/u)
  })

  it('preserves valid legacy numeric-string VND amounts', () => {
    expect(summarizeOrders([
      { id: 'LEGACY', storeId: 'S01', amount: '125000', paymentMethod: 'Tiền mặt', createdAt: '2026-09-01' },
    ], { storeId: 'S01', period: '2026-09' }).totals).toEqual({
      orders: 1, cash: 125_000, transfer: 0, revenue: 125_000, cashOrders: 1, transferOrders: 0,
    })
  })

  it('keeps an edited legacy order in its original business month', () => {
    const order = {
      id: 'LEGACY-EDITED', storeId: 'S01', amount: 50_000,
      date: '2026-09-10', updatedAt: '2026-12-20T01:00:00Z',
    }
    expect(summarizeOrders([order], { storeId: 'S01', period: '2026-09' }).totals.orders).toBe(1)
    expect(summarizeOrders([order], { storeId: 'S01', period: '2026-12' }).totals.orders).toBe(0)
  })
  it('combines exact amounts, payment aliases, Vietnam dates and text without changing whole-shift totals', () => {
    const rows = ['TIỀN MẶT', 'bank_transfer', 'cash', 'Khác'].map((paymentMethod, index) => ({
      id: String(index), code: 'ORDER', storeId: 'S01', employeeId: 'E01', shiftId: 'night',
      createdAt: '2026-08-31T18:00:00Z', amount: index === 2 ? 20_001 : '20000', paymentMethod, customerName: 'Nguyễn Ánh',
    }))
    const scope = { storeId: 's01', employeeId: 'e01', period: '2026-09' }
    expect(summarizeOrders(rows, scope).totals).toEqual({ orders: 4, revenue: 80_001, cash: 40_001, transfer: 20_000, cashOrders: 2, transferOrders: 1 })
    const result = summarizeOrders(rows, { ...scope, amount: 20_000, paymentMethod: 'cash', date: '2026-09-01', shiftId: 'night', query: 'ÁNH' })
    expect(result.totals).toEqual({ orders: 1, revenue: 20_000, cash: 20_000, transfer: 0, cashOrders: 1, transferOrders: 0 })
    expect(result.groups.shift[0]).toMatchObject({ key: '2026-09-01:night', orders: 1, cashOrders: 1 })
    expect(summarizeOrders(rows, { ...scope, amount: 0 }).totals.orders).toBe(0)
    expect(summarizeOrders([{ ...rows[0], amount: 0 }], { ...scope, amount: 0 }).totals.orders).toBe(1)
    expect(summarizeOrders(rows, { ...scope, date: '2026-08-31' }).totals.orders).toBe(0)
  })

  it('keeps blank distinct from zero and rejects invalid or imprecise filter amounts', () => {
    expect(parseOrderAmountFilter('')).toBe(null)
    expect(parseOrderAmountFilter('0')).toBe(0)
    for (const input of ['20000', '20,000', '20.000', '20 000']) expect(parseOrderAmountFilter(input)).toBe(20_000)
    for (const input of ['-1', '1.5', '1e3', '20abc', '9007199254740992', '1,20']) expect(parseOrderAmountFilter(input)).toBeNaN()
  })

})
