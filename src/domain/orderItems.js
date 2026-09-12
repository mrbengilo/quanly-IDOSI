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
    const quantity = Number(item?.quantity)
    if ((!productId && !productCode && !productName)
      || !Number.isSafeInteger(quantity)
      || quantity <= 0
      || quantity > MAX_ORDER_ITEM_QUANTITY) return null
    return { productId, productCode, productName, quantity }
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
    return { items: [], error: required ? 'Vui lòng chọn ít nhất một mặt hàng.' : '' }
  }
  if (items.length > MAX_ORDER_ITEM_TYPES) {
    return { items: [], error: `Mỗi đơn hàng chỉ được chọn tối đa ${MAX_ORDER_ITEM_TYPES} mặt hàng.` }
  }
  const historicalItems = normalizeOrderItems(previousItems)
  const unchangedLegacyOrder = allowHistorical && !items.length && !historicalItems.length
  if (required && !items.length && !unchangedLegacyOrder) {
    return { items: [], error: 'Vui lòng chọn ít nhất một mặt hàng.' }
  }

  const historicalByKey = new Map(
    historicalItems.map((item) => [historicalItemKey(item), item]),
  )
  const resolved = []
  const selectedIds = new Set()
  for (const item of items) {
    const productId = itemProductId(item)
    const quantity = Number(item?.quantity)
    if (!productId) return { items: [], error: 'Mặt hàng đã chọn không hợp lệ.' }
    if (!Number.isSafeInteger(quantity) || quantity <= 0 || quantity > MAX_ORDER_ITEM_QUANTITY) {
      return { items: [], error: `Số lượng mỗi mặt hàng phải là số nguyên từ 1 đến ${MAX_ORDER_ITEM_QUANTITY.toLocaleString('vi-VN')}.` }
    }
    if (selectedIds.has(productId)) {
      return { items: [], error: 'Một mặt hàng không được lặp lại trong cùng đơn hàng.' }
    }
    selectedIds.add(productId)

    const option = findProductOption(options, productId, { includeInactive: true })
    const historical = historicalByKey.get(productId)
    if (option?.active) {
      resolved.push({
        productId: String(option.id),
        productCode: String(option.code || '').trim().toUpperCase(),
        productName: cleanText(option.label),
        quantity,
      })
      continue
    }
    if (allowHistorical && historical) {
      resolved.push({ ...historical, productId, quantity })
      continue
    }
    return { items: [], error: 'Mặt hàng không còn hoạt động. Vui lòng bỏ chọn hoặc chọn mặt hàng khác.' }
  }
  return { items: resolved, error: '' }
}

export const totalOrderItemQuantity = (items = []) => normalizeOrderItems(items)
  .reduce((total, item) => total + item.quantity, 0)

export const orderItemsLabel = (items = []) => {
  const normalized = normalizeOrderItems(items)
  if (!normalized.length) return 'Chưa ghi nhận mặt hàng'
  return normalized.map((item) => `${item.productName || item.productCode || 'Mặt hàng'} × ${item.quantity}`).join(', ')
}
