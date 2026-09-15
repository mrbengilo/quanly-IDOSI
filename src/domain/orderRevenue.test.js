import { describe, expect, it } from 'vitest'
import { DEFAULT_ORDER_INFORMATION_OPTIONS } from './orderInformationSettings'
import { normalizeOrderItems, resolveOrderItems, totalOrderItemQuantity, totalOrderItemWeightKg } from './orderItems'
import { orderRevenueByType, prepareOrderRevenueInput, validateOrderRevenue } from './orderRevenue'
import { summarizeOrders } from './orderSummary'

const kg = (quantity = 2.5, unitPrice = 20_000) => ({ productId: 'order-product-001', revenueType: 'SALE_KG', quantity, unitPrice })
const piece = (quantity = 3, unitPrice = 10_000) => ({ productId: 'order-product-001', revenueType: 'SALE_PIECE', quantity, unitPrice })
const normal = { productId: 'order-product-001', quantity: 2 }
const options = DEFAULT_ORDER_INFORMATION_OPTIONS

describe('canonical three-type order revenue', () => {
  it('preserves manual normal orders, including legacy orders without item-level prices', () => {
    expect(orderRevenueByType({ amount: '180000' })).toEqual({ NORMAL: 180000, SALE_KG: 0, SALE_PIECE: 0 })
    expect(prepareOrderRevenueInput({ amount: 100000, items: [normal] })).toEqual({ amount: 100000, normalAmount: 100000 })
  })
  it('accepts the same product in three distinct categories, without combining kg and pieces', () => {
    const result = resolveOrderItems({ items: [normal, kg(), piece()], options })
    expect(result.error).toBe('')
    expect(result.items).toHaveLength(3)
    expect(result.items[1]).toMatchObject({ unit: 'KG', quantity: 2.5, unitPrice: 20000, lineAmount: 50000 })
    expect(result.items[2]).toMatchObject({ unit: 'PIECE', quantity: 3, lineAmount: 30000 })
    expect(totalOrderItemQuantity(result.items)).toBe(5)
    expect(totalOrderItemWeightKg(result.items)).toBe(2.5)
    expect(prepareOrderRevenueInput({ amount: 100000, items: result.items })).toEqual({ amount: 180000, normalAmount: 100000 })
    expect(orderRevenueByType({ amount: 180000, items: result.items })).toEqual({ NORMAL: 100000, SALE_KG: 50000, SALE_PIECE: 30000 })
  })
  it('calculates sale-only orders without a manually entered total', () => {
    expect(prepareOrderRevenueInput({ amount: '', items: [kg()] })).toEqual({ amount: 50000, normalAmount: 0 })
    expect(prepareOrderRevenueInput({ amount: 0, items: [piece()] })).toEqual({ amount: 30000, normalAmount: 0 })
  })
  it('rounds fractional kg exactly once with integer VND arithmetic', () => {
    expect(normalizeOrderItems([kg(0.333, 1001)])[0].lineAmount).toBe(333)
    expect(normalizeOrderItems([kg(0.001, 1500)])[0].lineAmount).toBe(2)
    const result = summarizeOrders(Array.from({ length: 100 }, (_, id) => ({ id, amount: 333, items: [kg(0.333, 1001)] })))
    expect(result.products.totalWeightKg).toBe(33.3)
    expect(result.products.totalQuantity).toBe(0)
    expect(result.totals.revenueByType.SALE_KG).toBe(33300)
  })
  it.each([
    [{ ...kg(), quantity: 0 }], [{ ...kg(), quantity: -1 }], [{ ...kg(), quantity: 0.0001 }],
    [{ ...kg(), quantity: '1e3' }], [{ ...kg(), quantity: 1000001 }],
    [{ ...piece(), quantity: 1.5 }], [{ ...piece(), quantity: null }],
    [{ ...kg(), revenueType: 'SALE' }], [{ ...kg(), revenueType: null }],
    [{ ...kg(), unit: 'PIECE' }], [{ ...piece(), unit: 'KG' }],
    [{ ...kg(), unitPrice: '' }], [{ ...kg(), unitPrice: -1 }], [{ ...kg(), unitPrice: 1.5 }],
    [{ ...kg(), lineAmount: 1 }], [kg(), kg()],
  ])('rejects invalid or forged line data: %j', (...items) => {
    expect(resolveOrderItems({ items, options }).error).not.toBe('')
  })
  it('rejects mismatched totals and unallocated money on a sale-only order', () => {
    expect(() => validateOrderRevenue({ amount: 49999, normalAmount: 0, items: [kg()] })).toThrow()
    expect(() => validateOrderRevenue({ amount: 50001, normalAmount: 0, items: [kg()] })).toThrow()
    expect(() => validateOrderRevenue({ amount: 180000, normalAmount: 1, items: [normal, kg(), piece()] })).toThrow()
    expect(() => prepareOrderRevenueInput({ amount: '-1', items: [normal] })).toThrow()
    expect(() => prepareOrderRevenueInput({ amount: 100000000000, items: [normal, kg()] })).toThrow()
  })
  it('keeps inactive sale snapshots in the original category only', () => {
    const previousItems = resolveOrderItems({ items: [kg()], options }).items
    const disabled = options.map((option) => option.id === normal.productId ? { ...option, active: false } : option)
    expect(resolveOrderItems({ items: [kg(3)], options: disabled, previousItems, allowHistorical: true }).error).toBe('')
    expect(resolveOrderItems({ items: [piece()], options: disabled, previousItems, allowHistorical: true }).error).not.toBe('')
  })
  it('uses one scoped source for shift/day/month totals, excludes deleted orders and counts mixed orders once', () => {
    const sample = { amount: 180000, items: [normal, kg(), piece()], storeId: 'S1', employeeId: 'E1', shiftId: 'AM', createdAt: '2026-09-14T02:00:00Z' }
    const rows = [sample, { ...sample, employeeId: 'E2' }, { ...sample, storeId: 'S2' }, { ...sample, deletedAt: '2026-09-14' }]
    const store = summarizeOrders(rows, { storeId: 'S1', period: '2026-09' })
    expect(store.totals.revenueByType).toEqual({ NORMAL: 200000, SALE_KG: 100000, SALE_PIECE: 60000 })
    expect(store.totals.orders).toBe(2)
    for (const grouping of ['shift', 'day', 'month']) expect(store.groups[grouping][0].revenueByType).toEqual(store.totals.revenueByType)
    const employee = summarizeOrders(rows, { storeId: 'S1', employeeId: 'E1', period: '2026-09' })
    expect(employee.totals.orders).toBe(1)
    expect(employee.totals.revenue).toBe(180000)
    expect(employee.products.productTypes).toBe(1)
    expect(employee.products.items).toHaveLength(3)
    expect(employee.products.totalQuantity).toBe(5)
    expect(employee.products.totalWeightKg).toBe(2.5)
  })
})
