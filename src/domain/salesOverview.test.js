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
