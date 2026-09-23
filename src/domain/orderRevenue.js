// Canonical revenue contract shared by forms, commands, reports and the warehouse API.
// NORMAL retains the existing manually-entered money; sale rows have explicit prices.
export const ORDER_REVENUE_TYPES = Object.freeze(['NORMAL', 'SALE_KG', 'SALE_PIECE'])
export const ORDER_REVENUE_LABELS = Object.freeze({ NORMAL: 'Bán thường', SALE_KG: 'Sale theo ký', SALE_PIECE: 'Sale theo cái' })
export const MAX_ORDER_MONEY_VND = 100_000_000_000
export const MAX_REVENUE_QUANTITY = 1_000_000

const invalid = (message, code) => Object.assign(new TypeError(message), { code })
export const revenueTypeOf = (item = {}) => {
  const type = item?.revenueType === undefined ? 'NORMAL' : item?.revenueType
  if (!ORDER_REVENUE_TYPES.includes(type)) throw invalid('Loại doanh thu không hợp lệ.', 'ORDER_REVENUE_TYPE_INVALID')
  return type
}
export const revenueUnitOf = (type) => type === 'SALE_KG' ? 'KG' : 'PIECE'
const numberText = (value) => typeof value === 'number' || typeof value === 'string' ? String(value).trim() : ''
const moneyValue = (value, positive = false) => {
  const text = numberText(value)
  const amount = /^\d+$/u.test(text) ? Number(text) : Number.NaN
  if (positive && amount === 0) throw invalid('Số tiền đơn hàng phải lớn hơn 0.', 'ORDER_AMOUNT_INVALID')
  if (!Number.isSafeInteger(amount) || amount < (positive ? 1 : 0) || amount > MAX_ORDER_MONEY_VND) {
    throw invalid('Số tiền phải là số nguyên đồng hợp lệ.', 'ORDER_AMOUNT_INVALID')
  }
  return amount
}
export const revenueQuantityUnits = (value, type = 'NORMAL') => {
  const text = numberText(value)
  const kg = type === 'SALE_KG'
  if (!(kg ? /^\d+(?:\.\d{1,3})?$/u : /^\d+$/u).test(text)) {
    throw invalid(kg ? 'Khối lượng phải lớn hơn 0, tối đa 3 chữ số thập phân.' : 'Số lượng phải là số nguyên dương.', 'ORDER_ITEM_QUANTITY_INVALID')
  }
  const [whole, fraction = ''] = text.split('.')
  const units = kg ? Number(whole) * 1000 + Number(fraction.padEnd(3, '0')) : Number(whole)
  if (!Number.isSafeInteger(units) || units <= 0 || units > MAX_REVENUE_QUANTITY * (kg ? 1000 : 1)) {
    throw invalid('Số lượng mỗi mặt hàng không hợp lệ hoặc vượt giới hạn.', 'ORDER_ITEM_QUANTITY_INVALID')
  }
  return units
}

export const normalizeRevenueItem = (item = {}) => {
  const type = revenueTypeOf(item)
  const unit = revenueUnitOf(type)
  if (item.unit !== undefined && item.unit !== unit) throw invalid('Đơn vị không khớp loại doanh thu.', 'ORDER_REVENUE_UNIT_INVALID')
  const units = revenueQuantityUnits(item.quantity, type)
  const quantity = type === 'SALE_KG' ? units / 1000 : units
  if (type === 'NORMAL') return { quantity, ...(item.revenueType !== undefined ? { revenueType: type, unit } : {}) }
  const unitPrice = moneyValue(item.unitPrice, true)
  // Integer arithmetic: round half up once per row, never accumulate fractional VND.
  const denominator = type === 'SALE_KG' ? 1000n : 1n
  const lineAmount = Number((BigInt(units) * BigInt(unitPrice) + denominator / 2n) / denominator)
  if (!Number.isSafeInteger(lineAmount) || lineAmount <= 0 || lineAmount > MAX_ORDER_MONEY_VND) {
    throw invalid('Thành tiền dòng hàng sale không hợp lệ.', 'ORDER_AMOUNT_INVALID')
  }
  if (item.lineAmount !== undefined && moneyValue(item.lineAmount) !== lineAmount) {
    throw invalid('Thành tiền hàng sale không khớp số lượng và đơn giá.', 'ORDER_REVENUE_MISMATCH')
  }
  return { quantity, revenueType: type, unit, unitPrice, lineAmount }
}

export const emptyRevenueByType = () => ({ NORMAL: 0, SALE_KG: 0, SALE_PIECE: 0 })
export const saleRevenueFromItems = (items = []) => {
  const result = emptyRevenueByType()
  for (const item of Array.isArray(items) ? items : []) {
    const type = revenueTypeOf(item)
    if (type === 'NORMAL') continue
    result[type] += normalizeRevenueItem(item).lineAmount
    if (!Number.isSafeInteger(result[type]) || result[type] > MAX_ORDER_MONEY_VND) throw invalid('Doanh thu sale vượt giới hạn.', 'ORDER_AMOUNT_INVALID')
  }
  return result
}

export const orderRevenueByType = (order = {}) => {
  const amount = moneyValue(order.amount)
  const result = saleRevenueFromItems(order.items)
  result.NORMAL = amount - result.SALE_KG - result.SALE_PIECE
  const items = Array.isArray(order.items) ? order.items : []
  const saleOnly = items.length > 0 && items.every((item) => revenueTypeOf(item) !== 'NORMAL')
  if (result.NORMAL < 0 || (saleOnly && result.NORMAL !== 0)) {
    throw invalid('Tổng tiền không khớp ba loại doanh thu.', 'ORDER_REVENUE_MISMATCH')
  }
  return result
}

// Older orders and clients did not persist a revenue type for ordinary lines.
// Keep the legacy NORMAL amount for v1 consumers, but expose its provenance so
// reports can show it separately until an Admin explicitly classifies the order.
export const unclassifiedNormalRevenue = (order = {}, normalRevenue = orderRevenueByType(order).NORMAL) => {
  const items = Array.isArray(order.items) ? order.items : []
  return !items.length || items.some((item) => item?.revenueType === undefined) ? normalRevenue : 0
}

export const validateOrderRevenue = ({ amount, normalAmount, items = [] } = {}) => {
  moneyValue(amount, true)
  const revenueByType = orderRevenueByType({ amount, items })
  if (normalAmount !== undefined && moneyValue(normalAmount) !== revenueByType.NORMAL) {
    throw invalid('Tiền bán thường và tiền sale không khớp tổng đơn.', 'ORDER_REVENUE_MISMATCH')
  }
  return revenueByType
}

// Form's amount remains the existing NORMAL money field. The submitted amount is the full order.
export const prepareOrderRevenueInput = ({ amount, items = [] } = {}) => {
  const normalAmount = String(amount ?? '').trim() === '' ? 0 : moneyValue(amount)
  const sale = saleRevenueFromItems(items)
  const total = normalAmount + sale.SALE_KG + sale.SALE_PIECE
  validateOrderRevenue({ amount: total, normalAmount, items })
  return { amount: total, normalAmount }
}

export const orderRevenueTypesLabel = (order = {}) => {
  const totals = orderRevenueByType(order)
  const labels = ORDER_REVENUE_TYPES.filter((type) => totals[type] > 0).map((type) => ORDER_REVENUE_LABELS[type])
  return labels.length > 1 ? `Đơn kết hợp: ${labels.join(' + ')}` : labels[0] || 'Bán thường'
}
