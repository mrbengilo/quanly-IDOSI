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

export const customerPublicInfo = ({ key, customerName, customerPhone, orderCount }) => ({ key, customerName, customerPhone, orderCount })
