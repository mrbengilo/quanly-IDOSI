import { ORDER_REVENUE_TYPES, revenueQuantityUnits, revenueTypeOf } from './orderRevenue.js'

// Immutable user-approved table. Add a new version rather than editing this history.
export const WEIGHT_TABLE_VERSION = 'IDOSI-2026-09-15-v1'
export const WEIGHT_CONVERSION_RULES = Object.freeze([
  ['dress', 'Đầm', 3],
  ['jeans', 'Quần Jeans', 2],
  ['women-trousers', 'Quần dài nữ', 3],
  ['skirt', 'Chân váy', 3],
  ['shorts', 'Quần short', 4],
  ['children', 'Trẻ em', 6],
  ['winter', 'Đồ đông', 1],
  ['sets', 'Đồ bộ', 3],
  ['sportswear', 'Đồ thể thao', 4],
  ['jacket', 'Áo khoác', 2],
  ['women-tops', 'Áo nữ', 5],
  ['men', 'Đồ nam', 3],
  ['men-sm', 'Nam SM', 3],
  ['women-sm', 'Nữ SM', 5],
  ['vest', 'Áo vest', 1],
  ['ao-dai', 'Áo dài', 2],
  ['utilities', 'Sản phẩm tiện ích', 1],
  ['shoes-bags', 'Giày dép túi xách', 1],
  ['big-size', 'Big size', 3],
  ['branded', 'Hàng thương hiệu', 3],
  ['children-sm', 'Trẻ em SM', 6],
  ['towel', 'Khăn lông', 2],
  ['bedding', 'Chăn, ga, bao gối, nệm gòn', 0.3],
  ['new-underwear', 'Đồ nội y mới', 4],
  ['plush', 'Gấu bông', 2],
].map(([id, productName, piecesPerKg]) => Object.freeze({ id, productName, piecesPerKg })))

const nameKey = (value) => String(value ?? '').normalize('NFC').trim().replace(/\s+/gu, ' ').toLocaleLowerCase('vi-VN')
const rulesByName = new Map(WEIGHT_CONVERSION_RULES.map((rule) => [nameKey(rule.productName), rule]))
const rulesById = new Map(WEIGHT_CONVERSION_RULES.map((rule) => [rule.id, rule]))
export const findWeightRule = (name) => rulesByName.get(nameKey(name)) || null
const hasSnapshot = (item) => Object.prototype.hasOwnProperty.call(item || {}, 'weightConversion')

// Keep unknown/corrupt historical snapshots visibly incomplete; never silently reclassify them.
export function copyWeightSnapshot(snapshot) {
  if (snapshot?.version === WEIGHT_TABLE_VERSION) {
    if (snapshot.status === 'UNMAPPED') return { version: WEIGHT_TABLE_VERSION, status: 'UNMAPPED', ruleId: null, piecesPerKg: null }
    const rule = rulesById.get(snapshot.ruleId)
    if (snapshot.status === 'MAPPED' && rule && snapshot.piecesPerKg === rule.piecesPerKg) {
      return { version: WEIGHT_TABLE_VERSION, status: 'MAPPED', ruleId: rule.id, piecesPerKg: rule.piecesPerKg }
    }
  }
  return { version: String(snapshot?.version || ''), status: 'INVALID', ruleId: null, piecesPerKg: null }
}

// Call only with a server-resolved product name and the stored previous order line.
// A submitted coefficient is deliberately not an argument to this function.
export function createWeightSnapshot(productName, previousItem) {
  if (previousItem && hasSnapshot(previousItem)) return copyWeightSnapshot(previousItem.weightConversion)
  const rule = findWeightRule(previousItem ? previousItem.productName : productName)
  return {
    version: WEIGHT_TABLE_VERSION,
    status: rule ? 'MAPPED' : 'UNMAPPED',
    ruleId: rule?.id || null,
    piecesPerKg: rule?.piecesPerKg ?? null,
  }
}

const gcd = (a, b) => { while (b) { const remainder = a % b; a = b; b = remainder } return a }
const fraction = (numerator = 0n, denominator = 1n) => {
  const divisor = gcd(numerator, denominator)
  return { numerator: numerator / divisor, denominator: denominator / divisor }
}
const plus = (a, b) => fraction(a.numerator * b.denominator + b.numerator * a.denominator, a.denominator * b.denominator)
const ratioOf = (number) => {
  const [whole, decimals = ''] = String(number).split('.')
  return fraction(BigInt(`${whole}${decimals}`), 10n ** BigInt(decimals.length))
}
// Aggregate fractions before rounding. Three 1/3 kg lines must total exactly 1 kg.
const kilograms = (value) => {
  const rounded = (value.numerator * 1_000_000n + value.denominator / 2n) / value.denominator
  if (rounded > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError('Khối lượng tổng hợp vượt giới hạn an toàn.')
  return Number(rounded) / 1_000_000
}

function lineParts(item) {
  const type = revenueTypeOf(item)
  const units = revenueQuantityUnits(item?.quantity, type)
  if (type === 'SALE_KG') return { type, value: fraction(BigInt(units), 1000n), basis: 'ACTUAL_KG', source: 'ORDER_QUANTITY', piecesPerKg: null, ruleId: null }
  const snapshot = hasSnapshot(item) ? copyWeightSnapshot(item.weightConversion) : createWeightSnapshot(item?.productName || item?.name || item?.label)
  const source = hasSnapshot(item) ? 'ORDER_SNAPSHOT' : 'LEGACY_TABLE_V1'
  if (snapshot.status !== 'MAPPED') return { type, value: null, basis: 'UNMAPPED', source, piecesPerKg: null, ruleId: null, reason: snapshot.status }
  const coefficient = ratioOf(snapshot.piecesPerKg)
  return {
    type, value: fraction(BigInt(units) * coefficient.denominator, coefficient.numerator),
    basis: 'ESTIMATED_FROM_PIECES', source, piecesPerKg: snapshot.piecesPerKg, ruleId: snapshot.ruleId,
  }
}

const bucket = () => ({ actual: fraction(), estimated: fraction(), missingFactorLines: 0, invalidLines: 0, unclassifiedOrders: 0 })
export const createWeightAccumulator = () => ({ ...bucket(), byRevenueType: Object.fromEntries(ORDER_REVENUE_TYPES.map((type) => [type, bucket()])) })

export function addItemWeight(accumulator, item) {
  let line
  try { line = lineParts(item) } catch {
    accumulator.invalidLines += 1
    return
  }
  const category = accumulator.byRevenueType[line.type]
  if (!line.value) {
    accumulator.missingFactorLines += 1
    category.missingFactorLines += 1
    return
  }
  const field = line.basis === 'ACTUAL_KG' ? 'actual' : 'estimated'
  accumulator[field] = plus(accumulator[field], line.value)
  category[field] = plus(category[field], line.value)
}

export function addOrderWeight(accumulator, order) {
  const items = Array.isArray(order?.items) ? order.items : []
  if (!items.length) accumulator.unclassifiedOrders += 1
  else items.forEach((item) => addItemWeight(accumulator, item))
}

const serializeBucket = (value) => {
  const isComplete = value.missingFactorLines === 0 && value.invalidLines === 0 && value.unclassifiedOrders === 0
  const knownKg = kilograms(plus(value.actual, value.estimated))
  return {
    actualKg: kilograms(value.actual), estimatedKg: kilograms(value.estimated), knownKg,
    totalKg: isComplete ? knownKg : null, isComplete,
    missingFactorLines: value.missingFactorLines, invalidLines: value.invalidLines, unclassifiedOrders: value.unclassifiedOrders,
  }
}
export const finishWeight = (accumulator) => ({
  schemaVersion: 1, unit: 'KG', tableVersion: WEIGHT_TABLE_VERSION,
  ...serializeBucket(accumulator),
  byRevenueType: Object.fromEntries(ORDER_REVENUE_TYPES.map((type) => [type, serializeBucket(accumulator.byRevenueType[type])])),
})

export function summarizeItemWeights(items = []) {
  const accumulator = createWeightAccumulator()
  addOrderWeight(accumulator, { items })
  return finishWeight(accumulator)
}

export function itemWeight(item = {}) {
  try {
    const result = lineParts(item)
    return {
      kilograms: result.value ? kilograms(result.value) : null,
      basis: result.basis, source: result.source, piecesPerKg: result.piecesPerKg,
      ruleId: result.ruleId, tableVersion: WEIGHT_TABLE_VERSION, reason: result.reason || null,
    }
  } catch {
    return { kilograms: null, basis: 'INVALID', source: null, piecesPerKg: null, ruleId: null, tableVersion: WEIGHT_TABLE_VERSION, reason: 'INVALID_QUANTITY' }
  }
}
