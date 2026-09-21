import { describe, expect, it } from 'vitest'
import { normalizeOrderItems, resolveOrderItems } from './orderItems.js'
import { orderRevenueByType } from './orderRevenue.js'
import { summarizeOrders } from './orderSummary.js'
import { copyWeightSnapshot, createWeightSnapshot, findWeightRule, itemWeight, summarizeItemWeights, WEIGHT_CONVERSION_RULES, WEIGHT_TABLE_VERSION } from './orderWeight.js'

const beddingName = 'Chăn, ga, bao gối, nệm gòn'
const dress = (quantity, revenueType = 'NORMAL') => ({ productId: 'DRESS', productName: 'Đầm', quantity, ...(revenueType === 'NORMAL' ? {} : { revenueType, unitPrice: 20000 }) })
const bedding = (quantity, revenueType = 'NORMAL') => ({ ...dress(quantity, revenueType), productId: 'BEDDING', productName: beddingName })
const options = [{ id: 'DRESS', kind: 'product', code: 'PRD-002', label: 'Đầm', active: true }]
const scope = { storeId: 'S1', period: '2026-09', date: '2026-09-15' }
const base = { storeId: 'S1', employeeId: 'E1', createdAt: '2026-09-15T09:00:00+07:00', paymentMethod: 'Tiền mặt', shiftId: 'AM' }
const examples = [
  { ...base, id: 'O1', items: [dress(3)], amount: 100000 },
  { ...base, id: 'O2', items: [dress(6, 'SALE_PIECE')], amount: 120000 },
  { ...base, id: 'O3', shiftId: 'PM', items: [dress(5, 'SALE_KG')], amount: 100000 },
]

describe('user-approved weight conversion table v3', () => {
  it('keeps 24 original factors and represents bedding as exactly 3 kg per piece', () => {
    expect(WEIGHT_TABLE_VERSION).toBe('IDOSI-2026-09-21-v3')
    expect(WEIGHT_CONVERSION_RULES).toHaveLength(25)
    expect(Object.fromEntries(WEIGHT_CONVERSION_RULES.filter((rule) => rule.id !== 'bedding').map((rule) => [rule.productName, rule.piecesPerKg]))).toEqual({
      'Đầm': 3, 'Quần Jeans': 2, 'Quần dài nữ': 3, 'Chân váy': 3, 'Quần short': 4,
      'Trẻ em': 6, 'Đồ đông': 1, 'Đồ bộ': 3, 'Đồ thể thao': 4, 'Áo khoác': 2,
      'Áo nữ': 5, 'Quần áo nam': 3, 'Nam SM': 3, 'Nữ SM': 5, 'Áo vest': 1,
      'Áo dài': 2, 'Sản phẩm tiện ích': 1, 'Giày dép túi xách': 1, 'Big size': 3,
      'Hàng thương hiệu': 3, 'Trẻ em SM': 6, 'Khăn lông': 2, 'Đồ nội y mới': 4, 'Gấu bông': 2,
    })
    expect(findWeightRule(beddingName)).toEqual({ id: 'bedding', productName: beddingName, piecesPerKg: null, kgPerPiece: 3 })
    expect(findWeightRule('Quần Áo Nam')).toEqual({ id: 'men', productName: 'Quần áo nam', piecesPerKg: 3 })
    expect(findWeightRule('Đồ nam')).toEqual({ id: 'men', productName: 'Quần áo nam', piecesPerKg: 3 })
    expect(Object.isFrozen(WEIGHT_CONVERSION_RULES)).toBe(true)
    expect(WEIGHT_CONVERSION_RULES.every(Object.isFrozen)).toBe(true)
  })
  it.each(WEIGHT_CONVERSION_RULES)('converts $productName by its declared unit without converting actual kg again', (rule) => {
    const quantity = rule.kgPerPiece ? 1 : rule.piecesPerKg
    const expected = rule.kgPerPiece || 1
    for (const revenueType of ['NORMAL', 'SALE_PIECE']) {
      expect(itemWeight({ productName: rule.productName, quantity, revenueType })).toMatchObject({ kilograms: expected, piecesPerKg: rule.piecesPerKg, basis: 'ESTIMATED_FROM_PIECES' })
    }
    expect(itemWeight({ productName: rule.productName, quantity: 5, revenueType: 'SALE_KG' })).toMatchObject({ kilograms: 5, basis: 'ACTUAL_KG', piecesPerKg: null, kgPerPiece: null })
  })
  it.each(['NORMAL', 'SALE_PIECE'])('converts 1/2/3 bedding pieces to exactly 3/6/9 kg for %s', (type) => {
    for (const [quantity, kilograms] of [[1, 3], [2, 6], [3, 9], [1000000, 3000000]]) {
      expect(itemWeight(bedding(quantity, type))).toMatchObject({ kilograms, kgPerPiece: 3, piecesPerKg: null, tableVersion: WEIGHT_TABLE_VERSION })
    }
    expect(summarizeItemWeights([bedding(1, type), bedding(1, type), bedding(1, type)]).totalKg).toBe(9)
  })
  it('matches only normalized exact names and never guesses using a code or an approximate name', () => {
    expect(findWeightRule('  ĐẦM  '.normalize('NFD'))?.piecesPerKg).toBe(3)
    expect(findWeightRule('Đầm mới')).toBeNull()
    expect(itemWeight({ productCode: 'PRD-002', quantity: 3 }).kilograms).toBeNull()
  })
  it('does not round repeating fractions until the aggregation is complete', () => {
    expect(itemWeight(dress(1)).kilograms).toBe(0.333333)
    expect(summarizeItemWeights([dress(1), dress(1), dress(1)])).toMatchObject({ estimatedKg: 1, totalKg: 1 })
    expect(itemWeight(bedding(1)).kilograms).toBe(3)
    expect(summarizeItemWeights([bedding(1), bedding(1), bedding(1)])).toMatchObject({ totalKg: 9 })
  })
})

describe('conversion snapshots and missing data', () => {
  it('applies v3 to historical men aliases, unmapped snapshots and renamed mapped products without writes', () => {
    for (const name of ['Đồ nam', 'Quần áo nam', ' QUẦN  ÁO NAM '.normalize('NFD')]) {
      const item = { productName: name, quantity: 6, weightConversion: {
        version: 'IDOSI-2026-09-15-v2', status: 'UNMAPPED', ruleId: null, piecesPerKg: null,
      } }
      const before = JSON.stringify(item)
      expect(itemWeight(item)).toMatchObject({ kilograms: 2, ruleId: 'men', tableVersion: WEIGHT_TABLE_VERSION })
      expect(JSON.stringify(item)).toBe(before)
    }
    expect(itemWeight({ productName: 'Tên đã đổi', quantity: 6, weightConversion: {
      version: 'IDOSI-2026-09-15-v2', status: 'MAPPED', ruleId: 'men', piecesPerKg: 3,
    } })).toMatchObject({ kilograms: 2, tableVersion: WEIGHT_TABLE_VERSION })
    expect(findWeightRule('Đồ nam')).toBe(findWeightRule('Quần áo nam'))
  })

  it('captures the server-resolved product factor and ignores forged names, factors and kg', () => {
    const result = resolveOrderItems({ options, items: [{ productId: 'DRESS', productName: 'Đồ đông', quantity: 3, kilograms: 999, weightConversion: { version: WEIGHT_TABLE_VERSION, status: 'MAPPED', ruleId: 'winter', piecesPerKg: 1 } }] })
    expect(result.error).toBe('')
    expect(result.items[0]).toMatchObject({ productName: 'Đầm', weightConversion: { version: WEIGHT_TABLE_VERSION, status: 'MAPPED', ruleId: 'dress', piecesPerKg: 3 } })
    expect(itemWeight(result.items[0]).kilograms).toBe(1)
    expect(result.items[0]).not.toHaveProperty('kilograms')
    expect(normalizeOrderItems(result.items)[0].weightConversion).toEqual(result.items[0].weightConversion)
  })
  it('resolves bedding server-side, persists its multiplication rule and preserves it on edit', () => {
    const catalog = [{ id: 'BEDDING', kind: 'product', label: beddingName, active: true }]
    const forged = { version: WEIGHT_TABLE_VERSION, status: 'MAPPED', ruleId: 'bedding', piecesPerKg: 0.3, kgPerPiece: 333 }
    const saved = resolveOrderItems({ options: catalog, items: [{ productId: 'BEDDING', quantity: 1, weightConversion: forged }] })
    expect(saved.error).toBe('')
    expect(saved.items[0].weightConversion).toEqual({ version: WEIGHT_TABLE_VERSION, status: 'MAPPED', ruleId: 'bedding', piecesPerKg: null, kgPerPiece: 3 })
    expect(itemWeight(normalizeOrderItems(saved.items)[0]).kilograms).toBe(3)
    const edited = resolveOrderItems({ options: [{ ...catalog[0], label: 'Đầm' }], allowHistorical: true, previousItems: saved.items, items: [{ productId: 'BEDDING', quantity: 2, weightConversion: forged }] })
    expect(edited.error).toBe('')
    expect(itemWeight(edited.items[0]).kilograms).toBe(6)
    expect(saved.items[0].quantity).toBe(1)
  })
  it('recalculates v1 bedding using v3 while preserving the original stored evidence', () => {
    const previous = { ...bedding(1), weightConversion: { version: 'IDOSI-2026-09-15-v1', status: 'MAPPED', ruleId: 'bedding', piecesPerKg: 0.3 } }
    expect(itemWeight(previous)).toMatchObject({ kilograms: 3, tableVersion: WEIGHT_TABLE_VERSION, source: 'CURRENT_TABLE_V3' })
    expect(createWeightSnapshot(beddingName, previous)).toEqual(previous.weightConversion)
    expect(itemWeight(bedding(1))).toMatchObject({ kilograms: 3, source: 'CURRENT_TABLE_V3' })
    for (const bad of [
      { version: WEIGHT_TABLE_VERSION, status: 'MAPPED', ruleId: 'bedding', piecesPerKg: 0.3 },
      { version: WEIGHT_TABLE_VERSION, status: 'MAPPED', ruleId: 'bedding', piecesPerKg: 1 / 3, kgPerPiece: 3 },
      { version: WEIGHT_TABLE_VERSION, status: 'MAPPED', ruleId: 'dress', piecesPerKg: 3, kgPerPiece: 3 },
    ]) expect(copyWeightSnapshot(bad).status).toBe('INVALID')
  })
  it('preserves an existing factor on edit even after product rename or client tampering', () => {
    const previous = resolveOrderItems({ options, items: [{ productId: 'DRESS', quantity: 3 }] }).items
    const result = resolveOrderItems({ options: [{ ...options[0], label: 'Áo nữ' }], allowHistorical: true, previousItems: previous,
      items: [{ productId: 'DRESS', quantity: 6, weightConversion: createWeightSnapshot('Áo nữ') }] })
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
    expect(itemWeight(previous[0]).source).toBe('CURRENT_TABLE_V3')
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
    expect(summarizeItemWeights([dress(-1)]).byRevenueType.NORMAL).toMatchObject({ isComplete: false, invalidLines: 1 })
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
  it('uses bedding 3 + 6 + 5 = 14 kg consistently per order, shift, day, month and product', () => {
    const rows = [
      { ...base, id: 'B1', amount: 100000, items: [bedding(1)] },
      { ...base, id: 'B2', amount: 40000, items: [bedding(2, 'SALE_PIECE')] },
      { ...base, id: 'B3', shiftId: 'PM', amount: 100000, items: [bedding(5, 'SALE_KG')] },
    ]
    expect(rows.map((order) => summarizeItemWeights(order.items).totalKg)).toEqual([3, 6, 5])
    const result = summarizeOrders(rows, scope)
    expect(result.totals.weight).toMatchObject({ actualKg: 5, estimatedKg: 9, totalKg: 14, isComplete: true })
    expect(result.totals.revenue).toBe(240000)
    for (const view of ['day', 'month', 'employee']) expect(result.groups[view][0].weight.totalKg).toBe(14)
    expect(result.groups.shift.map((group) => group.weight.totalKg)).toEqual([9, 5])
    expect(result.products.weightByProduct[0]).toMatchObject({ productId: 'BEDDING', weight: { totalKg: 14 } })
    expect(result.products.totalQuantity).toBe(3)
    expect(result.products.totalWeightKg).toBe(5)
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
