import { describe, expect, it } from 'vitest'
import { orderMatchesFilters, summarizeOrders } from './orderSummary.js'
import { statisticsShiftKey, statisticsShiftOptions } from '../pages/store/statisticsShiftOptions.js'

const date = '2026-09-06'
const common = { storeId: 'S1', employeeId: 'E1', createdAt: `${date}T18:00:00+07:00`, paymentMethod: 'Tiền mặt' }
const mixed = { ...common, id: 'MIXED', shiftName: 'Ca tối', shiftStart: '17:00', shiftEnd: '22:00', amount: 180000, normalAmount: 100000, items: [
  { productId: 'P1', productName: 'Đồ nam', quantity: 2 },
  { productId: 'P1', productName: 'Đồ nam', revenueType: 'SALE_KG', quantity: 2.5, unitPrice: 20000 },
  { productId: 'P1', productName: 'Đồ nam', revenueType: 'SALE_PIECE', quantity: 3, unitPrice: 10000 },
] }
const orders = [mixed,
  { ...common, id: 'MORNING', shiftId: 'old-am', shiftName: 'Ca sáng', amount: 40000 },
  { ...common, id: 'OTHER-WINDOW', shiftName: 'Ca tối', shiftStart: '18:00', shiftEnd: '23:00', amount: 70000 },
  { ...common, id: 'UNBOUND', amount: 20000 },
  { ...mixed, id: 'OTHER-EMPLOYEE', employeeId: 'E2' },
  { ...mixed, id: 'OTHER-STORE', storeId: 'S2' },
  { ...mixed, id: 'OTHER-DAY', createdAt: '2026-09-07T18:00:00+07:00' },
  { ...mixed, id: 'DELETED', deletedAt: '2026-09-07T10:00:00Z' },
]
const scope = { storeId: 'S1', period: '2026-09', date }

describe('historical shift statistics identity', () => {
  it('round-trips every recorded shift key into exactly that group, not the whole day', () => {
    const day = summarizeOrders(orders, scope)
    let summed = 0
    for (const group of day.groups.shift) {
      const selected = summarizeOrders(orders, { ...scope, shiftId: group.shiftKey })
      expect(selected.totals.revenue).toBe(group.revenue)
      expect(selected.totals.orders).toBe(group.orders)
      expect(selected.totals.revenueByType).toEqual(group.revenueByType)
      expect(selected.groups.shift).toHaveLength(1)
      summed += selected.totals.revenue
    }
    expect(summed).toBe(day.totals.revenue)
    expect(day.totals.revenue).toBe(490000)
  })
  it('keeps three revenues, kg/piece quantities, employee, store and day boundaries', () => {
    const selected = summarizeOrders(orders, { ...scope, employeeId: 'E1', shiftId: 'ca tối:17:00:22:00' })
    expect(selected.totals).toMatchObject({ orders: 1, revenue: 180000, revenueByType: { NORMAL: 100000, SALE_KG: 50000, SALE_PIECE: 30000 } })
    expect(selected.products).toMatchObject({ totalWeightKg: 2.5, totalQuantity: 5 })
  })
  it('does not infer assignments from time, a matching name, or a recreated definition', () => {
    expect(orderMatchesFilters(mixed, { shiftId: 'new-pm' })).toBe(false)
    expect(orderMatchesFilters(mixed, { shiftId: 'ca tối:18:00:23:00' })).toBe(false)
    const unknown = summarizeOrders(orders, { ...scope, shiftId: 'chưa gắn ca::' })
    expect(unknown.totals).toMatchObject({ revenue: 20000, orders: 1 })
    expect(summarizeOrders(orders, { ...scope, shiftId: 'does-not-exist' }).totals.orders).toBe(0)
  })
  it('retains explicit IDs and lets historic/missing-ID groups be selected without active definitions', () => {
    const groups = summarizeOrders(orders, scope).groups.shift
    const definitions = [{ id: 'new-pm', name: 'Ca tối', start: '17:00', end: '22:00' }, { id: 'new-am', name: 'Ca sáng' }, { id: 'noon', name: 'Ca trưa' }]
    const options = statisticsShiftOptions(definitions, groups)
    expect(options.map((item) => item.id)).toEqual(expect.arrayContaining(['old-am', 'ca tối:17:00:22:00', 'ca tối:18:00:23:00', 'chưa gắn ca::', 'noon']))
    expect(options.some((item) => item.id === 'new-pm' || item.id === 'new-am')).toBe(false)
    expect(options.filter((item) => item.name === 'Ca tối')).toHaveLength(2)
    expect(statisticsShiftOptions([], groups)).toHaveLength(groups.length)
    expect(statisticsShiftKey({ key: `${date}:ca tối:17:00:22:00` })).toBe('ca tối:17:00:22:00')
  })
  it('shows configured shifts on genuinely empty days and respects historical labels', () => {
    const definitions = [{ id: 'AM', name: 'Ca sáng mới', start: '09:00', end: '13:00' }]
    expect(statisticsShiftOptions(definitions, [])[0]).toMatchObject({ id: 'AM', recorded: false })
    expect(statisticsShiftOptions(definitions, [{ key: `${date}:AM`, shiftId: 'AM', shiftName: 'Ca sáng cũ', shiftStart: '08:00', shiftEnd: '12:00', orders: 2 }])[0])
      .toMatchObject({ id: 'AM', name: 'Ca sáng cũ', start: '08:00', end: '12:00', orders: 2, recorded: true })
  })
})
