import { normalizeRevenueItem, revenueTypeOf, revenueQuantityUnits } from './orderRevenue.js'
import { copyWeightSnapshot, createWeightSnapshot } from './orderWeight.js'
import {
  findProductOption,
  normalizeOrderInformationLabel,
} from './orderInformationSettings.js'

export const MAX_ORDER_ITEM_TYPES = 100
export const MAX_ORDER_ITEM_QUANTITY = 1_000_000

const cleanText = (value = '') => String(value)
  .normalize('NFC')
  .trim()
  .replace(/\s+/gu, ' ')

const itemProductId = (item = {}) => cleanText(item.productId || item.id)
const itemProductCode = (item = {}) => cleanText(item.productCode || item.code).toUpperCase()
const itemProductName = (item = {}) => cleanText(item.productName || item.name || item.label)

export const normalizeOrderItems = (items = []) => {
  if (!Array.isArray(items)) return []
  return items.map((item) => {
    const productId = itemProductId(item)
    const productCode = itemProductCode(item)
    const productName = itemProductName(item)
    if (!productId && !productCode && !productName) return null
    try {
      const snapshot = Object.prototype.hasOwnProperty.call(item, 'weightConversion')
        ? { weightConversion: copyWeightSnapshot(item.weightConversion) } : {}
      return { productId, productCode, productName, ...normalizeRevenueItem(item), ...snapshot }
    } catch {
      return null
    }
  }).filter(Boolean)
}

const historicalItemKey = (item = {}) => itemProductId(item)
  || itemProductCode(item)
  || normalizeOrderInformationLabel(itemProductName(item))

export const resolveOrderItems = ({
  items,
  options,
  previousItems = [],
  allowHistorical = false,
  required = true,
} = {}) => {
  if (!Array.isArray(items)) {
    return { items: [], error: required ? 'Vui lòng chọn ít nhất một mặt hàng.' : '', ...(required ? { errorCode: 'ORDER_ITEMS_REQUIRED' } : {}) }
  }
  if (items.length > MAX_ORDER_ITEM_TYPES) {
    return { items: [], error: `Mỗi đơn hàng chỉ được chọn tối đa ${MAX_ORDER_ITEM_TYPES} mặt hàng.`, errorCode: 'ORDER_ITEMS_LIMIT' }
  }
  const historicalItems = normalizeOrderItems(previousItems)
  const unchangedLegacyOrder = allowHistorical && !items.length && !historicalItems.length
  if (required && !items.length && !unchangedLegacyOrder) {
    return { items: [], error: 'Vui lòng chọn ít nhất một mặt hàng.', errorCode: 'ORDER_ITEMS_REQUIRED' }
  }

  const historicalByKey = new Map(
    historicalItems.map((item) => [`${historicalItemKey(item)}:${revenueTypeOf(item)}`, item]),
  )
  const resolved = []
  const selectedIds = new Set()
  for (const item of items) {
    const productId = itemProductId(item)
    if (!productId) return { items: [], error: 'Mặt hàng đã chọn không hợp lệ.', errorCode: 'ORDER_PRODUCT_INVALID' }
    let fields
    let type
    try {
      fields = normalizeRevenueItem(item)
      type = revenueTypeOf(item)
    } catch (error) {
      return { items: [], error: error.message, errorCode: error.code }
    }
    const key = `${productId}:${type}`
    if (selectedIds.has(key)) {
      return { items: [], error: 'Một mặt hàng không được lặp lại trong cùng loại doanh thu.', errorCode: 'ORDER_PRODUCT_DUPLICATE' }
    }
    selectedIds.add(key)

    const option = findProductOption(options, productId, { includeInactive: true })
    const historical = historicalByKey.get(key)
    if (option?.active) {
      const productName = cleanText(option.label)
      resolved.push({
        productId: String(option.id),
        productCode: String(option.code || '').trim().toUpperCase(),
        productName,
        ...fields,
        ...(type === 'SALE_KG' ? {} : { weightConversion: createWeightSnapshot(productName, allowHistorical ? historical : undefined) }),
      })
      continue
    }
    if (allowHistorical && historical) {
      resolved.push({
        ...historical, productId, ...fields,
        ...(type === 'SALE_KG' ? {} : { weightConversion: createWeightSnapshot(historical.productName, historical) }),
      })
      continue
    }
    return { items: [], error: 'Mặt hàng không còn hoạt động. Vui lòng bỏ chọn hoặc chọn mặt hàng khác.', errorCode: 'ORDER_PRODUCT_INACTIVE' }
  }
  return { items: resolved, error: '' }
}

export const totalOrderItemQuantity = (items = []) => normalizeOrderItems(items)
  .filter((item) => revenueTypeOf(item) !== 'SALE_KG')
  .reduce((total, item) => total + item.quantity, 0)

export const orderItemsLabel = (items = []) => {
  const normalized = normalizeOrderItems(items)
  if (!normalized.length) return 'Chưa ghi nhận mặt hàng'
  return normalized.map((item) => `${item.productName || item.productCode || 'Mặt hàng'} × ${item.quantity}${revenueTypeOf(item) === 'SALE_KG' ? ' kg' : ''}`).join(', ')
}

export const totalOrderItemWeightKg = (items = []) => normalizeOrderItems(items)
  .filter((item) => revenueTypeOf(item) === 'SALE_KG')
  .reduce((grams, item) => grams + revenueQuantityUnits(item.quantity, 'SALE_KG'), 0) / 1000
