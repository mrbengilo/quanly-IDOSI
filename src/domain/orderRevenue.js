/** Shared order-money contract. UI, commands and warehouse reports use this module. */
export const ORDER_REVENUE_TYPES = Object.freeze(['NORMAL', 'SALE_KG', 'SALE_PIECE'])
export const ORDER_REVENUE_LABELS = Object.freeze({
  NORMAL: 'Bán thường', SALE_KG: 'Sale theo ký', SALE_PIECE: 'Sale theo cái',
})
export const MAX_ORDER_MONEY = 100_000_000_000
export const emptyRevenueByType = () => ({ NORMAL: 0, SALE_KG: 0, SALE_PIECE: 0 })

export const orderItemRevenueType = (item = {}) => {
  const type = item.revenueType ?? 'NORMAL'
  if (!ORDER_REVENUE_TYPES.includes(type)) throw new TypeError('Loại doanh thu không hợp lệ.')
  return type
}
export const orderItemUnit = (item) => orderItemRevenueType(item) === 'SALE_KG' ? 'KG' : 'PIECE'

// Work in integer grams and VND. Do not multiply binary floating-point kg by money.
const quantityGrams = (value, type) => {
  const source = String(value ?? '').trim().replace(',', '.')
  const expression = type === 'SALE_KG' ? /^\d+(?:\.\d{1,3})?$/u : /^\d+$/u
  if (!expression.test(source)) throw new TypeError(type === 'SALE_KG'
    ? 'Khối lượng phải lớn hơn 0, tối đa 3 chữ số thập phân.'
    : 'Số lượng phải là số nguyên từ 1 đến 1.000.000.')
  const [whole, decimal = ''] = source.split('.')
  const grams = BigInt(whole) * 1000n + BigInt(decimal.padEnd(3, '0'))
  if (grams <= 0n || grams > 1_000_000_000n) throw new RangeError('Số lượng hoặc khối lượng phải lớn hơn 0 và không quá 1.000.000.')
  return grams
}
const moneyValue = (value, label) => {
  if (!['number', 'string'].includes(typeof value) || String(value).trim() === '') throw new TypeError(`${label} là bắt buộc.`)
  const amount = Number(value)
  if (!Number.isSafeInteger(amount) || amount < 0 || amount > MAX_ORDER_MONEY) throw new TypeError(`${label} phải là số nguyên đồng từ 0 đến 100.000.000.000.`)
  return amount
}
export const hasOrderLinePricing = (items = []) => (Array.isArray(items) ? items : []).some((item) => (
  orderItemRevenueType(item) !== 'NORMAL' || Object.hasOwn(item, 'unitPrice')
))

export const normalizeOrderRevenueItem = (item = {}) => {
  const type = orderItemRevenueType(item)
  const unit = orderItemUnit(item)
  if (item.unit != null && item.unit !== unit) throw new TypeError('Đơn vị không khớp loại doanh thu.')
  const grams = quantityGrams(item.quantity, type)
  const fields = { quantity: Number(grams) / 1000 }
  // Preserve the shape of historical unpriced normal items; never invent item prices.
  if (item.revenueType != null || item.unit != null || Object.hasOwn(item, 'unitPrice')) {
    Object.assign(fields, { revenueType: type, unit })
  }
  if (Object.hasOwn(item, 'unitPrice')) {
    const unitPrice = moneyValue(item.unitPrice, 'Đơn giá')
    const gross = (grams * BigInt(unitPrice) + 500n) / 1000n
    if (gross > BigInt(MAX_ORDER_MONEY)) throw new RangeError('Thành tiền vượt giới hạn cho phép.')
    const discountAmount = moneyValue(item.discountAmount ?? 0, 'Giảm giá')
    if (BigInt(discountAmount) > gross) throw new RangeError('Giảm giá không được vượt tiền hàng.')
    Object.assign(fields, { unitPrice, discountAmount, lineTotal: Number(gross) - discountAmount })
  } else if (item.discountAmount != null || item.lineTotal != null) {
    throw new TypeError('Cần đơn giá để xác định thành tiền và giảm giá của dòng hàng.')
  }
  return fields
}

/** amount is required for legacy unpriced orders; supplied priced totals must agree. */
export const calculateOrderRevenue = (items = [], amount) => {
  const source = Array.isArray(items) ? items : []
  const revenueByType = emptyRevenueByType()
  if (!hasOrderLinePricing(source)) {
    revenueByType.NORMAL = moneyValue(amount, 'Số tiền đơn hàng')
    return { amount: revenueByType.NORMAL, revenueByType, totalSaleRevenue: 0 }
  }
  let total = 0
  for (const item of source) {
    const fields = normalizeOrderRevenueItem(item)
    if (!Object.hasOwn(fields, 'unitPrice')) throw new TypeError('Đơn có hàng sale cần nhập đơn giá cho từng dòng, kể cả hàng thường.')
    const type = orderItemRevenueType(fields)
    revenueByType[type] += fields.lineTotal
    total += fields.lineTotal
    if (!Number.isSafeInteger(total) || total > MAX_ORDER_MONEY) throw new RangeError('Tổng đơn hàng vượt giới hạn cho phép.')
  }
  if (amount != null && moneyValue(amount, 'Số tiền đơn hàng') !== total) throw new TypeError('Tổng tiền đơn hàng không khớp tổng tiền các dòng hàng.')
  return { amount: total, revenueByType, totalSaleRevenue: revenueByType.SALE_KG + revenueByType.SALE_PIECE }
}

export const orderRevenuePreview = (items, amount) => {
  try { return { ...calculateOrderRevenue(items, amount), error: '' } }
  catch (error) { return { amount: null, revenueByType: null, error: error.message } }
}

export const revenueTypeLabelForOrder = (order) => {
  const types = new Set((order?.items || []).map(orderItemRevenueType))
  return types.size > 1 ? 'Đơn kết hợp' : ORDER_REVENUE_LABELS[[...types][0] || 'NORMAL']
}
