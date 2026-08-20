const compact = (value) => String(value || '').trim()

const normalizeIdentity = (value) => compact(value)
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/gu, '')
  .toUpperCase()
  .replace(/[^A-Z0-9]/gu, '')

const validStoreId = (stores, value) => {
  const requested = compact(value)
  if (!requested) return ''
  return stores.some((store) => compact(store?.id) === requested) ? requested : ''
}

const orderReferences = (notification = {}) => [...new Set([
  notification.orderId,
  notification.order_id,
  notification.orderCode,
  notification.order_code,
  notification.data?.orderId,
  notification.data?.order_id,
  notification.data?.orderCode,
  notification.data?.order_code,
  notification.order?.id,
  notification.order?.code,
].map(compact).filter(Boolean))]

const notificationStoreReference = (notification = {}) => compact(
  notification.storeId
  || notification.store_id
  || notification.data?.storeId
  || notification.data?.store_id
  || notification.order?.storeId
  || notification.store?.id,
)

const storeIdFromOrderCode = (stores = [], code = '') => {
  const prefix = normalizeIdentity(compact(code).replace(/-\d+$/u, ''))
  if (!prefix) return ''
  const matches = stores.filter((store) => [
    store?.short,
    store?.code,
    store?.employeePrefix,
    store?.name,
  ].some((value) => normalizeIdentity(value) === prefix))
  return matches.length === 1 ? compact(matches[0]?.id) : ''
}

export const findOrderByReference = (orders = [], references = []) => {
  const requested = new Set((Array.isArray(references) ? references : [references]).map(compact).filter(Boolean))
  if (!requested.size) return null
  return orders.find((order) => requested.has(compact(order?.id)) || requested.has(compact(order?.code))) || null
}

export const resolveOrderNotificationTarget = ({ notification = {}, orders = [], stores = [] } = {}) => {
  const references = orderReferences(notification)
  const order = findOrderByReference(orders, references)
  const orderStoreId = validStoreId(stores, order?.storeId)
  const codeStoreId = storeIdFromOrderCode(stores, order?.code || references.find((value) => /-\d+$/u.test(value)))
  const fallbackStoreId = validStoreId(stores, notificationStoreReference(notification))
  return {
    order,
    orderId: compact(order?.id || references[0]),
    storeId: orderStoreId || codeStoreId || fallbackStoreId,
  }
}

export const resolveOrderRouteScope = ({
  requestedStoreId = '',
  requestedOrderId = '',
  fallbackStoreId = '',
  orders = [],
  stores = [],
} = {}) => {
  const order = findOrderByReference(orders, requestedOrderId)
  const orderStoreId = validStoreId(stores, order?.storeId)
  const codeStoreId = storeIdFromOrderCode(stores, order?.code || requestedOrderId)
  return {
    order,
    storeId: orderStoreId
      || codeStoreId
      || validStoreId(stores, requestedStoreId)
      || validStoreId(stores, fallbackStoreId),
  }
}
