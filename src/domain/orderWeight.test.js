import { describe, expect, it } from 'vitest'
import { normalizeOrderItems, resolveOrderItems } from './orderItems.js'
import { orderRevenueByType } from './orderRevenue.js'
import { summarizeOrders } from './orderSummary.js'
import { createWeightSnapshot, findWeightRule, itemWeight, summarizeItemWeights, WEIGHT_CONVERSION_RULES, WEIGHT_TABLE_VERSION } from './orderWeight.js'

const dress = (quantity, revenueType = 'NORMAL') => ({ productId: 'DRESS', productName: 'Đầm', quantity, ...(revenueType === 'NORMAL' ? {} : { revenueType, unitPrice: 20000 }) })
const options = [{ id: 'DRESS', kind: 'product', code: 'PRD-002', label: 'Đầm', active: true }]
const scope = { storeId: 'S1', period: '2026-09', date: '2026-09-15' }
const base = { storeId: 'S1', employeeId: 'E1', createdAt: '2026-09-15T09:00:00+07:00', paymentMethod: 'Tiền mặt', shiftId: 'AM' }
const examples = [
  { ...base, id: 'O1', items: [dress(3)], amount: 100000 },
  { ...base, id: 'O2', items: [dress(6, 'SALE_PIECE')], amount: 120000 },
  { ...base, id: 'O3', shiftId: 'PM', items: [dress(5, 'SALE_KG')], amount: 100000 },
]

describe('user-approved pieces per kilogram table', () => {
  it('contains exactly the 25 supplied factors, including bedding 0.3 pieces/kg', () => {
    expect(Object.fromEntries(WEIGHT_CONVERSION_RULES.map((rule) => [rule.productName, rule.piecesPerKg]))).toEqual({
      'Đầm': 3, 'Quần Jeans': 2, 'Quần dài nữ': 3, 'Chân váy': 3, 'Quần short': 4,
      'Trẻ em': 6, 'Đồ đông': 1, 'Đồ bộ': 3, 'Đồ thể thao': 4, 'Áo khoác': 2,
      'Áo nữ': 5, 'Đồ nam': 3, 'Nam SM': 3, 'Nữ SM': 5, 'Áo vest': 1,
      'Áo dài': 2, 'Sản phẩm tiện ích': 1, 'Giày dép túi xách': 1, 'Big size': 3,
      'Hàng thương hiệu': 3, 'Trẻ em SM': 6, 'Khăn lông': 2, 'Chăn, ga, bao gối, nệm gòn': 0.3,
      'Đồ nội y mới': 4, 'Gấu bông': 2,
    })
    expect(Object.isFrozen(WEIGHT_CONVERSION_RULES)).toBe(true)
    expect(WEIGHT_CONVERSION_RULES.every(Object.isFrozen)).toBe(true)
  })
  it.each(WEIGHT_CONVERSION_RULES)('converts $productName by division, never multiplication', (rule) => {
    const quantity = rule.piecesPerKg < 1 ? 3 : rule.piecesPerKg
    const expected = rule.piecesPerKg < 1 ? 10 : 1
    for (const revenueType of ['NORMAL', 'SALE_PIECE']) {
      expect(itemWeight({ productName: rule.productName, quantity, revenueType })).toMatchObject({ kilograms: expected, piecesPerKg: rule.piecesPerKg, basis: 'ESTIMATED_FROM_PIECES' })
    }
    expect(itemWeight({ productName: rule.productName, quantity: 5, revenueType: 'SALE_KG' })).toMatchObject({ kilograms: 5, basis: 'ACTUAL_KG', piecesPerKg: null })
  })
  it('matches only normalized exact names and never guesses using a code or an approximate name', () => {
    expect(findWeightRule('  ĐẦM  '.normalize('NFD'))?.piecesPerKg).toBe(3)
    expect(findWeightRule('Đầm mới')).toBeNull()
    expect(itemWeight({ productCode: 'PRD-002', quantity: 3 }).kilograms).toBeNull()
  })
  it('does not round repeating fractions until the aggregation is complete', () => {
    expect(itemWeight(dress(1)).kilograms).toBe(0.333333)
    expect(summarizeItemWeights([dress(1), dress(1), dress(1)])).toMatchObject({ estimatedKg: 1, totalKg: 1 })
    expect(itemWeight({ productName: 'Chăn, ga, bao gối, nệm gòn', quantity: 1 }).kilograms).toBe(3.333333)
    expect(summarizeItemWeights(Array.from({ length: 3 }, () => ({ productName: 'Chăn, ga, bao gối, nệm gòn', quantity: 1 })))).toMatchObject({ totalKg: 10 })
  })
})

describe('conversion snapshots and missing data', () => {
  it('captures the server-resolved product factor and ignores forged names, factors and kg', () => {
    const result = resolveOrderItems({ options, items: [{ productId: 'DRESS', productName: 'Đồ đông', quantity: 3, kilograms: 999, weightConversion: { version: WEIGHT_TABLE_VERSION, status: 'MAPPED', ruleId: 'winter', piecesPerKg: 1 } }] })
    expect(result.error).toBe('')
    expect(result.items[0]).toMatchObject({ productName: 'Đầm', weightConversion: { version: WEIGHT_TABLE_VERSION, status: 'MAPPED', ruleId: 'dress', piecesPerKg: 3 } })
    expect(itemWeight(result.items[0]).kilograms).toBe(1)
    expect(result.items[0]).not.toHaveProperty('kilograms')
    expect(normalizeOrderItems(result.items)[0].weightConversion).toEqual(result.items[0].weightConversion)
  })
  it('preserves an existing factor on edit even after product rename or client tampering', () => {
    const previous = resolveOrderItems({ options, items: [{ productId: 'DRESS', quantity: 3 }] }).items
    const result = resolveOrderItems({
      options: [{ ...options[0], label: 'Áo nữ' }], allowHistorical: true, previousItems: previous,
      items: [{ productId: 'DRESS', quantity: 6, weightConversion: createWeightSnapshot('Áo nữ') }],
    })
    expect(result.error).toBe('')
    expect(result.items[0].weightConversion.piecesPerKg).toBe(3)
    expect(itemWeight(result.items[0]).kilograms).toBe(2)
    expect(previous[0].quantity).toBe(3)
  })
  it('uses the saved old label for unsnapshotted historical lines without mutating the originals', () => {
    const previous = [dress(3)]
    const result = resolveOrderItems({ options: [{ ...options[0], label: 'Áo nữ' }], items: [{ productId: 'DRESS', quantity: 6 }], previousItems: previous, allowHistorical: true })
    expect(result.items[0].weightConversion.piecesPerKg).toBe(3)
    expect(previous[0]).not.toHaveProperty('weightConversion')
    expect(itemWeight(previous[0]).source).toBe('LEGACY_TABLE_V1')
  })
  it('keeps unknown or unsupported factors incomplete instead of counting them as zero kg', () => {
    const missing = summarizeItemWeights([dress(3), { productName: 'Mặt hàng chưa cấu hình', quantity: 4 }, dress(5, 'SALE_KG')])
    expect(missing).toMatchObject({ actualKg: 5, estimatedKg: 1, knownKg: 6, totalKg: null, isComplete: false, missingFactorLines: 1 })
    expect(itemWeight({ ...dress(3), weightConversion: { version: 'unknown-version', status: 'MAPPED', ruleId: 'dress', piecesPerKg: 3 } }).kilograms).toBeNull()
    expect(summarizeItemWeights([])).toMatchObject({ totalKg: null, isComplete: false, unclassifiedOrders: 1 })
  })
  it('retains missing historical mappings and still counts actual kg for an unknown product', () => {
    const unknown = { productId: 'DRESS', productName: 'Chưa rõ', quantity: 3, weightConversion: createWeightSnapshot('Chưa rõ') }
    const result = resolveOrderItems({ options, items: [{ productId: 'DRESS', quantity: 6 }], previousItems: [unknown], allowHistorical: true })
    expect(result.items[0].weightConversion.status).toBe('UNMAPPED')
    expect(itemWeight({ productName: 'Chưa rõ', revenueType: 'SALE_KG', quantity: 1.125 }).kilograms).toBe(1.125)
  })
  it('does not convert negative, fractional piece, invalid or over-precise quantities', () => {
    for (const item of [dress(-1), dress(1.5), dress(1000001), dress(1.2345, 'SALE_KG'), { ...dress(3), revenueType: 'INVALID' }]) {
      expect(itemWeight(item).kilograms).toBeNull()
      expect(summarizeItemWeights([item])).toMatchObject({ totalKg: null, isComplete: false, invalidLines: 1 })
    }
  })
})

describe('order, shift, day, month and per-product weight statistics', () => {
  it('matches the three user examples and combines the same product into 8 kg', () => {
    expect(examples.map((order) => summarizeItemWeights(order.items).totalKg)).toEqual([1, 2, 5])
    const report = summarizeOrders(examples, scope)
    expect(report.totals.weight).toMatchObject({ actualKg: 5, estimatedKg: 3, totalKg: 8, isComplete: true })
    expect(report.totals.weight.byRevenueType).toMatchObject({ NORMAL: { totalKg: 1 }, SALE_PIECE: { totalKg: 2 }, SALE_KG: { totalKg: 5 } })
    expect(report.products.totalWeightKg).toBe(5)
    expect(report.products.totalQuantity).toBe(9)
    expect(report.products.weightByProduct).toHaveLength(1)
    expect(report.products.weightByProduct[0]).toMatchObject({ productId: 'DRESS', orders: 3, weight: { totalKg: 8 } })
    expect(report.groups.day[0].weight.totalKg).toBe(8)
    expect(report.groups.month[0].weight.totalKg).toBe(8)
    expect(report.groups.shift.map((group) => group.weight.totalKg)).toEqual([3, 5])
    expect(report.totals.revenueByType).toEqual({ NORMAL: 100000, SALE_KG: 100000, SALE_PIECE: 120000 })
    expect(report.totals.revenue).toBe(320000)
    expect(() => JSON.stringify(report)).not.toThrow()
  })
  it('counts a mixed order once per product, while retaining three distinct revenue rows', () => {
    const mixed = { ...base, id: 'MIXED', amount: 320000, items: examples.flatMap((order) => order.items) }
    const report = summarizeOrders([mixed], scope)
    expect(report.products.weightByProduct[0]).toMatchObject({ orders: 1, weight: { totalKg: 8 } })
    expect(report.products.items).toHaveLength(3)
    expect(report.totals.revenueByType).toEqual(orderRevenueByType(mixed))
  })
  it('preserves date, month, shift, employee, payment, deletion and store boundaries', () => {
    const all = [...examples,
      { ...examples[0], id: 'OTHER-STORE', storeId: 'S2' },
      { ...examples[0], id: 'OTHER-EMPLOYEE', employeeId: 'E2' },
      { ...examples[0], id: 'OTHER-DAY', createdAt: '2026-09-16T09:00:00+07:00' },
      { ...examples[0], id: 'OTHER-MONTH', createdAt: '2026-08-15T09:00:00+07:00' },
      { ...examples[0], id: 'DELETED', deletedAt: '2026-09-15T12:00:00Z' },
    ]
    expect(summarizeOrders(all, { ...scope, employeeId: 'E1' }).totals.weight.totalKg).toBe(8)
    expect(summarizeOrders(all, { ...scope, employeeId: 'E1', shiftId: 'PM' }).totals.weight.totalKg).toBe(5)
    expect(summarizeOrders(all, { ...scope, paymentMethod: 'Chuyển khoản' }).totals.weight.totalKg).toBe(0)
    expect(summarizeOrders(all, { ...scope, employeeId: 'E1', date: '' }).totals.weight.totalKg).toBe(9)
  })
  it('flags unclassified old orders but preserves their revenue and the known weights', () => {
    const report = summarizeOrders([...examples, { ...base, id: 'LEGACY', amount: 42000 }], scope)
    expect(report.totals.revenue).toBe(362000)
    expect(report.totals.weight).toMatchObject({ knownKg: 8, totalKg: null, isComplete: false, unclassifiedOrders: 1 })
    expect(report.products.weightByProduct[0].weight.totalKg).toBe(8)
  })
})
