import { orderMatchesFilters } from './orderSummary.js'

export const customerPhone = (value) => String(value || '').replace(/\D/gu, '')
const searchText = (value) => String(value || '').trim().normalize('NFD')
  .replace(/[\u0300-\u036f]/gu, '').replace(/đ/giu, 'd').toLocaleLowerCase('vi-VN')
export const customerOrderTime = (order) => String(order.createdAt || order.date || order.businessDate || '')
export const customerKey = (order) => customerPhone(order.customerPhone)
  ? `phone:${customerPhone(order.customerPhone)}` : `order:${order.id || order.code || order.entityKey}`

// A phone identifies a purchase contact. Nameless/phone-less orders must never
// merge merely because their display name happens to be the same.
export function customerDirectory(orders = [], { storeId = '', query = '' } = {}) {
  const groups = new Map()
  const sorted = orders.filter((order) => orderMatchesFilters(order)
    && (!storeId || String(order.storeId).toLowerCase() === String(storeId).toLowerCase()))
    .sort((a, b) => customerOrderTime(b).localeCompare(customerOrderTime(a))
      || String(b.id || b.code).localeCompare(String(a.id || a.code)))
  for (const order of sorted) {
    const key = customerKey(order)
    let customer = groups.get(key)
    if (!customer) {
      customer = { key, customerName: String(order.customerName || '').trim() || 'Khách lẻ',
        customerPhone: customerPhone(order.customerPhone), orderCount: 0, orders: [] }
      groups.set(key, customer)
    }
    customer.orders.push(order)
    customer.orderCount += 1
  }
  const text = searchText(query)
  const digits = customerPhone(query)
  return [...groups.values()].filter((customer) => !text
    || customer.orders.some((order) => searchText(order.customerName).includes(text))
    || (digits && /^[\d\s()+.-]+$/u.test(query) && customer.customerPhone.includes(digits)))
}

// Contact identity/classification is global; detailed history and counts can
// still be restricted to the caller's store without losing the global flag.
export function customerHistoryForStore(customer, storeId = '') {
  const orders = customer.orders.filter((order) => !storeId
    || String(order.storeId).toLowerCase() === String(storeId).toLowerCase())
  return { ...customer, orders, orderCount: orders.length, hasPurchaseHistory: customer.orderCount > 0 }
}

export const customerPublicInfo = ({ key, customerName, customerPhone, orderCount, hasPurchaseHistory = orderCount > 0 }) => ({
  key, customerName, customerPhone, orderCount, hasPurchaseHistory,
})

// Suggestions expose contacts and a history flag, never order counts/details.
export function customerSuggestions(customers, query, field = 'phone', limit = 10) {
  const text = field === 'phone' ? customerPhone(query) : searchText(query)
  if (text.length < 2) return []
  return customers.filter((customer) => field === 'phone'
    ? customer.customerPhone.includes(text)
    : customer.orders.some((order) => searchText(order.customerName).includes(text)))
    .slice(0, limit).map((customer) => ({ key: customer.key, customerName: customer.customerName,
      customerPhone: customer.customerPhone, hasPurchaseHistory: customer.orderCount > 0 }))
}

// Exact matching is separate from the capped substring suggestions. The caller
// chooses phone whenever supplied, so an unrelated namesake cannot override it.
export function customerHasPurchaseHistory(customers, query, field = 'phone') {
  const text = field === 'phone' ? customerPhone(query) : searchText(query)
  return Boolean(text) && customers.some((customer) => field === 'phone'
    ? customer.customerPhone === text
    : customer.orders.some((order) => searchText(order.customerName) === text))
}
