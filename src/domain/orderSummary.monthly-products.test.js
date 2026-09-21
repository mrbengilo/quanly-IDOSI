import { describe, expect, it } from 'vitest'
import { summarizeOrders } from './orderSummary.js'

const base = { storeId: 'S1', employeeId: 'E1', createdAt: '2026-09-01T09:00:00+07:00', shiftId: 'AM', paymentMethod: 'Tiền mặt' }
const item = (productId, productName, quantity, revenueType = 'NORMAL') => ({ productId, productName, quantity, revenueType, ...(revenueType === 'NORMAL' ? {} : { unitPrice: 1000 }) })
const orders = [
  { ...base, id: 'NORMAL', amount: 100000, items: [item('MEN', 'Đồ nam', 200), item('DRESS', 'Đầm', 250)] },
  { ...base, id: 'PIECES', employeeId: 'E2', createdAt: '2026-09-20T18:00:00+07:00', shiftId: 'PM', amount: 250000, items: [item('MEN', 'Đồ nam', 100, 'SALE_PIECE'), item('DRESS', 'Đầm', 150, 'SALE_PIECE')] },
  { ...base, id: 'WEIGHT', createdAt: '2026-09-30T18:00:00+07:00', amount: 5000, items: [item('DRESS', 'Đầm', 5, 'SALE_KG')] },
]
const monthly = (rows = orders, extra = {}) => summarizeOrders(rows, { storeId: 'S1', period: '2026-09', ...extra })
const product = (report, id) => report.products.weightByProduct.find((row) => row.productId === id)

describe('monthly product quantity and estimated kilograms', () => {
  it('has one row per product for the whole month and does not add actual kg to pieces', () => {
    const report = monthly()
    expect(report.products.weightByProduct).toHaveLength(2)
    expect(product(report, 'MEN')).toMatchObject({ totalQuantity: 300, orders: 2, weight: { estimatedKg: 100, actualKg: 0, totalKg: 100 } })
    expect(product(report, 'DRESS')).toMatchObject({ totalQuantity: 400, orders: 3, weight: { estimatedKg: 133.333333, actualKg: 5, totalKg: 138.333333 } })
    expect(report.products).toMatchObject({ totalQuantity: 700, totalWeightKg: 5 })
    expect(report.totals).toMatchObject({ revenue: 355000, revenueByType: { NORMAL: 100000, SALE_PIECE: 250000, SALE_KG: 5000 } })
  })
  it('respects store, employee, month, day, shift and deleted order boundaries', () => {
    const extras = [
      { ...orders[0], id: 'OTHER-STORE', storeId: 'S2' },
      { ...orders[0], id: 'OTHER-MONTH', createdAt: '2026-08-31T16:59:59Z' },
      { ...orders[0], id: 'DELETED', deletedAt: '2026-09-02' },
      { ...orders[0], id: 'OCTOBER', createdAt: '2026-09-30T17:00:00Z' },
    ]
    expect(monthly([...orders, ...extras]).products).toEqual(monthly().products)
    expect(product(monthly(orders, { employeeId: 'E1' }), 'MEN').totalQuantity).toBe(200)
    expect(product(monthly(orders, { date: '2026-09-20', shiftId: 'PM' }), 'DRESS').totalQuantity).toBe(150)
    expect(monthly(orders, { date: '2026-09-20', shiftId: 'AM' }).products.weightByProduct).toEqual([])
  })
  it('counts a mixed order once per product but includes all original piece quantities', () => {
    const rows = [{ ...base, id: 'MIX', amount: 180000, normalAmount: 100000, items: [
      item('DRESS', 'Đầm', 3), { ...item('DRESS', 'Đầm', 6, 'SALE_PIECE'), unitPrice: 5000 },
      { ...item('DRESS', 'Đầm', 5, 'SALE_KG'), unitPrice: 10000 },
    ] }]
    expect(product(monthly(rows), 'DRESS')).toMatchObject({ totalQuantity: 9, orders: 1, weight: { estimatedKg: 3, actualKg: 5, totalKg: 8 } })
  })
  it('preserves exact aggregation before rounding and the corrected bedding coefficient', () => {
    const rows = [1, 2, 3].map((id) => ({ ...base, id, amount: 1000, items: [item('DRESS', 'Đầm', 1)] }))
    rows.push({ ...base, id: 'BED', amount: 1000, items: [item('BED', 'Chăn, ga, bao gối, nệm gòn', 2)] })
    expect(product(monthly(rows), 'DRESS')).toMatchObject({ totalQuantity: 3, weight: { estimatedKg: 1 } })
    expect(product(monthly(rows), 'BED')).toMatchObject({ totalQuantity: 2, weight: { estimatedKg: 6 } })
  })
  it('keeps known quantities when a weight mapping is missing and does not merge unrelated product IDs', () => {
    const report = monthly([{ ...base, id: 'MISSING', amount: 5000, items: [item('A', 'Mặt hàng mới', 4), item('B', 'Mặt hàng mới', 7)] }])
    expect(report.products.weightByProduct).toHaveLength(2)
    expect(product(report, 'A')).toMatchObject({ totalQuantity: 4, weight: { isComplete: false, totalKg: null } })
    expect(product(report, 'B').totalQuantity).toBe(7)
    expect(monthly([]).products).toMatchObject({ totalQuantity: 0, weightByProduct: [] })
  })
})
