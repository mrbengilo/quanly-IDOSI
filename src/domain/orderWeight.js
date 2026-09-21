import { ORDER_REVENUE_TYPES, revenueQuantityUnits, revenueTypeOf } from './orderRevenue.js'

// Retain the earlier version for explicit stored snapshots; never rewrite history.
const PREVIOUS_TABLE_VERSION = 'IDOSI-2026-09-15-v1'
const SECOND_TABLE_VERSION = 'IDOSI-2026-09-15-v2'
export const WEIGHT_TABLE_VERSION = 'IDOSI-2026-09-21-v3'
const previousRules = Object.freeze([
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

// User correction: exactly 1 bedding piece = 3 kg, NOT 0.3 pieces/kg or a rounded 1/3.
const secondRules = Object.freeze(previousRules.map((rule) => rule.id === 'bedding'
  ? Object.freeze({ id: rule.id, productName: rule.productName, piecesPerKg: null, kgPerPiece: 3 }) : rule))
export const WEIGHT_CONVERSION_RULES = Object.freeze(secondRules.map((rule) => rule.id === 'men'
  ? Object.freeze({ ...rule, productName: 'Quần áo nam' }) : rule))
const tables = new Map([
  [PREVIOUS_TABLE_VERSION, new Map(previousRules.map((rule) => [rule.id, rule]))],
  [SECOND_TABLE_VERSION, new Map(secondRules.map((rule) => [rule.id, rule]))],
  [WEIGHT_TABLE_VERSION, new Map(WEIGHT_CONVERSION_RULES.map((rule) => [rule.id, rule]))],
])
const nameKey = (value) => String(value ?? '').normalize('NFC').trim().replace(/\s+/gu, ' ').toLocaleLowerCase('vi-VN')
const rulesByName = new Map(WEIGHT_CONVERSION_RULES.map((rule) => [nameKey(rule.productName), rule]))
rulesByName.set(nameKey('Đồ nam'), rulesByName.get(nameKey('Quần áo nam')))
export const findWeightRule = (name) => rulesByName.get(nameKey(name)) || null
const hasSnapshot = (item) => Object.prototype.hasOwnProperty.call(item || {}, 'weightConversion')
const snapshotOf = (version, rule) => ({
  version, status: rule ? 'MAPPED' : 'UNMAPPED', ruleId: rule?.id || null,
  piecesPerKg: rule?.piecesPerKg ?? null,
  ...(rule?.kgPerPiece !== undefined ? { kgPerPiece: rule.kgPerPiece } : {}),
})

// Keep unknown/corrupt historical snapshots visibly incomplete; never silently reclassify them.
export function copyWeightSnapshot(snapshot) {
  const table = tables.get(snapshot?.version)
  if (table) {
    if (snapshot.status === 'UNMAPPED') return snapshotOf(snapshot.version, null)
    const rule = table.get(snapshot.ruleId)
    if (snapshot.status === 'MAPPED' && rule && snapshot.piecesPerKg === rule.piecesPerKg
      && (snapshot.kgPerPiece ?? null) === (rule.kgPerPiece ?? null)) return snapshotOf(snapshot.version, rule)
  }
  return { version: String(snapshot?.version || ''), status: 'INVALID', ruleId: null, piecesPerKg: null }
}

// Call only with a server-resolved product name and the stored previous order line.
// Client-supplied coefficients are deliberately not arguments to this function.
export function createWeightSnapshot(productName, previousItem) {
  if (previousItem && hasSnapshot(previousItem)) return copyWeightSnapshot(previousItem.weightConversion)
  return snapshotOf(WEIGHT_TABLE_VERSION, findWeightRule(previousItem ? previousItem.productName : productName))
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
  if (type === 'SALE_KG') return { type, value: fraction(BigInt(units), 1000n), basis: 'ACTUAL_KG', source: 'ORDER_QUANTITY', piecesPerKg: null, kgPerPiece: null, ruleId: null, tableVersion: null }
  const stored = hasSnapshot(item) ? copyWeightSnapshot(item.weightConversion) : null
  // Approved retrospective policy: retain stored evidence, but calculate every
  // valid historical line with the current table. A valid rule ID survives
  // product renames; formerly unmapped lines may now match an approved name.
  // Corrupt/unknown snapshots remain incomplete rather than being guessed.
  const rule = stored?.status === 'MAPPED'
    ? tables.get(WEIGHT_TABLE_VERSION).get(stored.ruleId)
    : findWeightRule(item?.productName || item?.name || item?.label)
  const snapshot = stored?.status === 'INVALID' ? stored : snapshotOf(WEIGHT_TABLE_VERSION, rule)
  const source = 'CURRENT_TABLE_V3'
  const metadata = { source, tableVersion: snapshot.version }
  if (snapshot.status !== 'MAPPED') return { type, value: null, basis: 'UNMAPPED', ...metadata, piecesPerKg: null, kgPerPiece: null, ruleId: null, reason: snapshot.status }
  const multiply = snapshot.kgPerPiece !== undefined
  const coefficient = ratioOf(multiply ? snapshot.kgPerPiece : snapshot.piecesPerKg)
  return {
    type, value: multiply
      ? fraction(BigInt(units) * coefficient.numerator, coefficient.denominator)
      : fraction(BigInt(units) * coefficient.denominator, coefficient.numerator),
    basis: 'ESTIMATED_FROM_PIECES', ...metadata, piecesPerKg: snapshot.piecesPerKg,
    kgPerPiece: snapshot.kgPerPiece ?? null, ruleId: snapshot.ruleId,
  }
}

const bucket = () => ({ actual: fraction(), estimated: fraction(), missingFactorLines: 0, invalidLines: 0, unclassifiedOrders: 0 })
export const createWeightAccumulator = () => ({ ...bucket(), byRevenueType: Object.fromEntries(ORDER_REVENUE_TYPES.map((type) => [type, bucket()])) })

export function addItemWeight(accumulator, item) {
  let line
  try { line = lineParts(item) } catch {
    accumulator.invalidLines += 1
    try { accumulator.byRevenueType[revenueTypeOf(item)].invalidLines += 1 } catch { /* Unknown revenue category remains a global error. */ }
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
      basis: result.basis, source: result.source, piecesPerKg: result.piecesPerKg, kgPerPiece: result.kgPerPiece,
      ruleId: result.ruleId, tableVersion: result.tableVersion, reason: result.reason || null,
    }
  } catch {
    return { kilograms: null, basis: 'INVALID', source: null, piecesPerKg: null, kgPerPiece: null, ruleId: null, tableVersion: null, reason: 'INVALID_QUANTITY' }
  }
}
