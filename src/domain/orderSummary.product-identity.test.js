import { describe, expect, it } from 'vitest'
import { summarizeOrders } from './orderSummary.js'
import { productIdentityResolver } from './orderInformationSettings.js'

// The catalog below reproduces the state that broke warehouse reconciliation:
// "Đồ nữ" (PRD-004) was retired in favour of "Áo nữ" (PRD-003), and the PRD-004
// code was later handed to a brand new "Áo khoác". Orders keep the identity they
// were sold with, so one product spans two ids and one code spans two products.
const catalog = [
  { id: 'order-product-003', kind: 'product', code: 'PRD-003', label: 'Áo nữ', active: true, sortOrder: 2200 },
  { id: 'order-product-004', kind: 'product', code: 'PRD-004', label: 'Đồ nữ', active: false, deletedAt: '2026-09-21T00:00:00+07:00', supersededBy: 'order-product-003', sortOrder: 2300 },
  { id: 'order-product-030', kind: 'product', code: 'PRD-004', label: 'Áo khoác', active: true, sortOrder: 2400 },
]

const base = { storeId: 'S1', createdAt: '2026-09-10T09:00:00+07:00', shiftId: 'AM', paymentMethod: 'Tiền mặt' }
const item = (productId, productCode, productName, quantity, revenueType = 'NORMAL') => ({
  productId, productCode, productName, quantity, revenueType,
  ...(revenueType === 'NORMAL' ? {} : { unitPrice: 1000 }),
})
const summary = (orders, extra = {}) => summarizeOrders(orders, { storeId: 'S1', period: '2026-09', productCatalog: catalog, ...extra })
const rowFor = (report, canonicalProductId) => report.products.weightByProduct
  .find((row) => row.canonicalProductId === canonicalProductId)

describe('product identity resolved from the catalog', () => {
  it('merges one product sold under two option ids into a single canonical row', () => {
    // 742 pieces were sold while the line still carried the retired id, 26 after.
    const orders = [
      { ...base, id: 'OLD', amount: 100000, items: [item('order-product-004', 'PRD-004', 'Đồ nữ', 742)] },
      { ...base, id: 'NEW', amount: 20000, items: [item('order-product-003', 'PRD-003', 'Áo nữ', 26)] },
    ]
    const report = summary(orders)
    expect(report.products.weightByProduct).toHaveLength(1)
    expect(rowFor(report, 'order-product-003')).toMatchObject({
      canonicalProductId: 'order-product-003',
      canonicalProductCode: 'PRD-003',
      productName: 'Áo nữ',
      totalQuantity: 768,
      orders: 2,
    })
  })

  it('keeps two different products apart even though a code was handed out twice', () => {
    const orders = [
      { ...base, id: 'WOMEN', amount: 100000, items: [item('order-product-004', 'PRD-004', 'Đồ nữ', 742)] },
      { ...base, id: 'COAT', amount: 50000, items: [item('order-product-030', 'PRD-004', 'Áo khoác', 55)] },
    ]
    const report = summary(orders)
    expect(report.products.weightByProduct).toHaveLength(2)
    expect(rowFor(report, 'order-product-003')).toMatchObject({ productName: 'Áo nữ', totalQuantity: 742 })
    expect(rowFor(report, 'order-product-030')).toMatchObject({ productName: 'Áo khoác', totalQuantity: 55 })
  })

  it('exposes the canonical identity on every revenue-type row and keeps the snapshot', () => {
    const orders = [{
      ...base, id: 'MIX', amount: 120000, normalAmount: 100000,
      items: [
        item('order-product-004', 'PRD-004', 'Đồ nữ', 742),
        item('order-product-003', 'PRD-003', 'Áo nữ', 26, 'SALE_PIECE'),
      ],
    }]
    const items = summary(orders).products.items
    expect(items).toHaveLength(2)
    for (const row of items) {
      expect(row.canonicalProductId).toBe('order-product-003')
      expect(row.canonicalProductCode).toBe('PRD-003')
      expect(row.productName).toBe('Áo nữ')
    }
    // The snapshot the order was sold with stays available for reconciliation.
    expect(items.map((row) => row.productId).sort()).toEqual(['order-product-003', 'order-product-004'])
  })

  it('leaves aggregation unchanged when no catalog is supplied', () => {
    const orders = [{ ...base, id: 'X', amount: 1000, items: [item('order-product-030', 'PRD-004', 'Áo khoác', 5)] }]
    const withoutCatalog = summarizeOrders(orders, { storeId: 'S1', period: '2026-09' })
    expect(withoutCatalog.products.weightByProduct).toHaveLength(1)
    expect(withoutCatalog.products.weightByProduct[0]).not.toHaveProperty('canonicalProductId')
  })
})

describe('productIdentityResolver', () => {
  const resolve = productIdentityResolver(catalog)

  it('follows a superseded option to the entry in use today', () => {
    expect(resolve({ productId: 'order-product-004', productName: 'Đồ nữ' }))
      .toEqual({ id: 'order-product-003', code: 'PRD-003', label: 'Áo nữ' })
  })

  it('prefers the active entry when a code was reused', () => {
    expect(resolve({ productCode: 'PRD-004', productName: 'Áo khoác' }))
      .toEqual({ id: 'order-product-030', code: 'PRD-004', label: 'Áo khoác' })
  })

  it('returns null for a product the catalog does not know', () => {
    expect(resolve({ productId: 'unknown', productCode: 'ZZZ-999', productName: 'Mặt hàng lạ' })).toBeNull()
  })

  it('stops instead of looping on a superseded cycle', () => {
    const cyclic = [
      { id: 'a', kind: 'product', code: 'PRD-A', label: 'A', active: false, supersededBy: 'b' },
      { id: 'b', kind: 'product', code: 'PRD-B', label: 'B', active: false, supersededBy: 'a' },
    ]
    expect(productIdentityResolver(cyclic)({ productId: 'a', productName: 'A' })).toBeTruthy()
  })
})
