import { describe, expect, it } from 'vitest'
import { calculateOrderRevenue, normalizeOrderRevenueItem, orderRevenuePreview, validateOrderRevenue, orderRequiresAdminEdit } from './orderRevenue'
import { resolveOrderItems } from './orderItems'
import { summarizeOrders } from './orderSummary'

const lines = [
  { productId: 'p', productName: 'Đồ nam', revenueType: 'NORMAL', quantity: 2, unitPrice: 50_000 },
  { productId: 'p', productName: 'Đồ nam', revenueType: 'SALE_KG', quantity: 2.5, unitPrice: 20_000 },
  { productId: 'q', productName: 'Đồ nữ', revenueType: 'SALE_PIECE', quantity: 3, unitPrice: 10_000 },
]
describe('three order revenue types', () => {
  it('keeps legacy normal amounts without inventing item prices', () => {
    expect(calculateOrderRevenue([{ quantity: 2 }], 80_000)).toEqual({
      amount: 80_000, revenueByType: { NORMAL: 80_000, SALE_KG: 0, SALE_PIECE: 0 }, totalSaleRevenue: 0,
    })
  })
  it('calculates a mixed order once, by exact item type', () => {
    expect(calculateOrderRevenue(lines, 180_000)).toEqual({ amount: 180_000,
      revenueByType: { NORMAL: 100_000, SALE_KG: 50_000, SALE_PIECE: 30_000 }, totalSaleRevenue: 80_000 })
  })
  it('rejects forged totals and missing normal prices inside mixed orders', () => {
    expect(() => calculateOrderRevenue(lines, 1)).toThrow(/không khớp/u)
    expect(() => calculateOrderRevenue([{ quantity: 1 }, lines[1]], 50_000)).toThrow(/từng dòng/u)
  })
  it.each([
    { revenueType: 'BAD', quantity: 1 },
    { revenueType: 'SALE_KG', unit: 'PIECE', quantity: 1, unitPrice: 1000 },
    { revenueType: 'SALE_PIECE', quantity: 1.5, unitPrice: 1000 },
    { revenueType: 'SALE_KG', quantity: '0.0001', unitPrice: 1000 },
    { revenueType: 'SALE_KG', quantity: -1, unitPrice: 1000 },
    { revenueType: 'SALE_KG', quantity: true, unitPrice: 1000 },
    { revenueType: 'SALE_KG', quantity: 2, unitPrice: '' },
    { revenueType: 'SALE_KG', quantity: 2, unitPrice: 100, discountAmount: 201 },
  ])('rejects malformed revenue fields: %j', (item) => expect(() => normalizeOrderRevenueItem(item)).toThrow())
  it('rounds kg money at the line once and preserves exact discounts', () => {
    expect(calculateOrderRevenue([{ revenueType: 'SALE_KG', quantity: '0,125', unitPrice: 1004, discountAmount: 1 }]).amount).toBe(125)
    expect(calculateOrderRevenue([{ revenueType: 'SALE_KG', quantity: '1.005', unitPrice: 1000 }]).amount).toBe(1005)
  })
  it('ignores forged lineTotal and recomputes the trusted value', () => {
    expect(normalizeOrderRevenueItem({ ...lines[1], lineTotal: 1 }).lineTotal).toBe(50_000)
  })
  it('allows the same product in distinct revenue types but rejects duplicates within one type', () => {
    const options = [{ id: 'p', kind: 'product', label: 'Đồ nam', code: 'NAM', active: true }]
    expect(resolveOrderItems({ items: lines.slice(0, 2), options }).error).toBe('')
    expect(resolveOrderItems({ items: [lines[1], lines[1]], options }).error).toMatch(/lặp lại/u)
  })
  it('keeps per-store shift/day/month totals consistent and kg separate from pieces', () => {
    const order = { id: '1', storeId: 'S1', employeeId: 'E1', shiftId: 'morning', amount: 180_000, items: lines, createdAt: '2026-09-15T01:00:00Z' }
    const result = summarizeOrders([order, { ...order, id: '2', storeId: 'S2' }, { ...order, id: '3', deletedAt: '2026-09-15' }], { storeId: 'S1', period: '2026-09' })
    expect(result.totals.revenueByType).toEqual({ NORMAL: 100_000, SALE_KG: 50_000, SALE_PIECE: 30_000 })
    expect(result.totals.orders).toBe(1)
    expect(result.groups.shift[0].revenueByType).toEqual(result.groups.day[0].revenueByType)
    expect(result.products.totalQuantity).toBe(5)
    expect(result.products.totalWeightKg).toBe(2.5)
    expect(result.products.items).toHaveLength(3)
  })
  it('never turns invalid pricing into a zero preview', () => {
    expect(orderRevenuePreview([{ revenueType: 'SALE_KG', quantity: 1, unitPrice: '' }])).toMatchObject({ amount: null, revenueByType: null })
  })
  it('shares state validation and protects financial item edits without increasing the initial bundle', () => {
    expect(validateOrderRevenue(lines, 180_000)).toBeNull()
    expect(validateOrderRevenue(lines, 1)).toMatchObject({ ok: false })
    expect(orderRequiresAdminEdit({ items: [] }, { items: lines }, ['items'])).toBe(true)
    expect(orderRequiresAdminEdit({ items: [] }, { items: [{ quantity: 1 }] }, ['items'])).toBe(false)
  })
  it('resolves inactive historical product snapshots without retaining old financial fields', () => {
    const previous = { ...lines[0], productCode: 'NAM', lineTotal: 100_000, discountAmount: 0 }
    const result = resolveOrderItems({ items: [{ productId: 'p', quantity: 3 }], options: [], previousItems: [previous], allowHistorical: true })
    expect(result.error).toBe('')
    expect(result.items).toEqual([{ productId: 'p', productCode: 'NAM', productName: 'Đồ nam', quantity: 3 }])
    expect(calculateOrderRevenue(result.items, 120_000).amount).toBe(120_000)
  })

})
