import { expect, it } from 'vitest'
import { summarizeOrders } from './orderSummary'
import { salesOverviewFromSummary } from './salesOverview'

it('uses current conversion, combines piece categories and never ranks kilograms as pieces', () => {
  const summary = summarizeOrders([{ amount: 1000, items: [
    { productId: 'A', productName: 'Áo nữ', quantity: 5 },
    { productId: 'A', productName: 'Áo nữ', quantity: 5, revenueType: 'SALE_PIECE', unitPrice: 1 },
    { productId: 'B', productName: 'Đầm', quantity: 3 },
    { productId: 'K', productName: 'Hàng cân', quantity: 100, revenueType: 'SALE_KG', unitPrice: 1 },
  ] }])
  expect(salesOverviewFromSummary(summary)).toMatchObject({
    quantity: 13, weight: { totalKg: 103, actualKg: 100, estimatedKg: 3 },
    mostSold: { productName: 'Áo nữ', quantity: 10 }, leastSold: { productName: 'Đầm', quantity: 3 },
  })
  expect(salesOverviewFromSummary(summary).topProducts).toHaveLength(2)
})

it('keeps missing historical quantities and weights explicit instead of reporting a complete zero', () => {
  expect(salesOverviewFromSummary(summarizeOrders([{ amount: 1000 }]))).toMatchObject({
    quantity: 0, unclassifiedOrders: 1, weight: { isComplete: false, totalKg: null }, mostSold: null, leastSold: null,
  })
  expect(salesOverviewFromSummary(summarizeOrders([]))).toMatchObject({
    orders: 0, quantity: 0, weight: { totalKg: 0 }, mostSold: null, leastSold: null, topProducts: [],
  })
})

it('keeps compact aggregation identical to detailed totals and products across filters and historical products', () => {
  const orders = [
    { id: 'PREVIOUS-UTC', storeId: 'S1', employeeId: 'E1', createdAt: '2026-08-31T18:00:00Z', amount: 1000,
      items: [{ productId: 'A', productName: 'Áo nữ', quantity: 5 }, { productId: 'B', productName: 'Đầm', quantity: 2, revenueType: 'SALE_PIECE', unitPrice: 10 }] },
    { id: 'KG', storeId: 'S2', employeeId: 'E2', date: '2026-09-02', amount: 250,
      items: [{ productId: 'K', productName: 'Hàng cân', quantity: 2.5, revenueType: 'SALE_KG', unitPrice: 100 }] },
    { id: 'LEGACY', storeId: 'S1', date: '2026-09-03', amount: 500 },
    { id: 'UNMAPPED', storeId: 'S1', date: '2026-09-04', amount: 10, items: [{ productId: 'U', productName: 'Unknown conversion', quantity: 3 }] },
    { id: 'DELETED', storeId: 'S1', date: '2026-09-03', amount: 900, deletedAt: '2026-09-04' },
    { id: 'OPENING', storeId: 'S1', date: '2026-09-03', amount: 800, source: 'legacy-opening-balance' },
    { id: 'NEXT', storeId: 'S1', createdAt: '2026-09-30T18:00:00Z', amount: 700 },
  ]
  for (const scope of [{}, { storeId: 's1' }, { employeeId: 'E2' }, { date: '2026-09-02' }, { query: 'Áo nữ' }, { period: '2026-10' }]) {
    const options = { period: '2026-09', ...scope }
    const full = summarizeOrders(orders, options)
    const compact = summarizeOrders(orders, { ...options, includeGroups: false })
    expect(compact.totals).toEqual(full.totals)
    expect(compact.products).toEqual(full.products)
    expect(salesOverviewFromSummary(compact)).toEqual(salesOverviewFromSummary(full))
    expect(compact.groups).toEqual({ shift: [], day: [], month: [], employee: [] })
  }
  const bad = [{ id: 'INVALID', date: '2026-09-01', amount: -1 }]
  expect(() => summarizeOrders(bad, { includeGroups: false })).toThrow('INVALID')
})
