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

const uniqueReferences = (values = []) => [...new Set(values.map(compact).filter(Boolean))]

const notificationOrderIds = (notification = {}) => uniqueReferences([
  notification.orderId,
  notification.order_id,
  notification.data?.orderId,
  notification.data?.order_id,
  notification.data?.order?.id,
  notification.order?.id,
])

const notificationOrderCodes = (notification = {}) => uniqueReferences([
  notification.orderCode,
  notification.order_code,
  notification.data?.orderCode,
  notification.data?.order_code,
  notification.data?.order?.code,
  notification.order?.code,
])

const notificationStoreReferences = (notification = {}) => uniqueReferences([
  notification.order?.storeId,
  notification.order?.store_id,
  notification.data?.order?.storeId,
  notification.data?.order?.store_id,
  notification.data?.storeId,
  notification.data?.store_id,
  notification.storeId,
  notification.store_id,
  notification.store?.id,
])

const firstValidStoreId = (stores = [], references = []) => (
  uniqueReferences(references).map((value) => validStoreId(stores, value)).find(Boolean) || ''
)

const embeddedOrderStoreId = (notification = {}, stores = []) => firstValidStoreId(stores, [
  notification.order?.storeId,
  notification.order?.store_id,
  notification.data?.order?.storeId,
  notification.data?.order?.store_id,
])

const genericNotificationStoreId = (notification = {}, stores = []) => firstValidStoreId(stores, [
  notification.data?.storeId,
  notification.data?.store_id,
  notification.storeId,
  notification.store_id,
  notification.store?.id,
])

const storeIdFromOrderCode = (stores = [], code = '') => {
  const prefix = normalizeIdentity(compact(code).replace(/-\d+$/u, ''))
  if (!prefix) return ''
  const matches = stores.filter((store) => [
    store?.id,
    store?.short,
    store?.code,
    store?.employeePrefix,
    store?.name,
  ].some((value) => normalizeIdentity(value) === prefix))
  return matches.length === 1 ? compact(matches[0]?.id) : ''
}

const uniqueOrderForReference = (orders = [], field = 'id', reference = '', preferredStoreIds = []) => {
  const requested = compact(reference)
  if (!requested) return null
  const matches = orders.filter((order) => compact(order?.[field]) === requested)
  if (matches.length === 1) return matches[0]
  for (const storeId of uniqueReferences(preferredStoreIds)) {
    const scoped = matches.filter((order) => compact(order?.storeId) === storeId)
    if (scoped.length === 1) return scoped[0]
  }
  return null
}

const findOrderByTypedReferences = ({
  orders = [],
  idReferences = [],
  codeReferences = [],
  preferredStoreIds = [],
} = {}) => {
  for (const reference of uniqueReferences(idReferences)) {
    const order = uniqueOrderForReference(orders, 'id', reference, preferredStoreIds)
    if (order) return order
  }
  for (const reference of uniqueReferences(codeReferences)) {
    const order = uniqueOrderForReference(orders, 'code', reference, preferredStoreIds)
    if (order) return order
  }
  return null
}

export const findOrderByReference = (orders = [], references = [], preferredStoreIds = []) => {
  const requested = Array.isArray(references) ? references : [references]
  return findOrderByTypedReferences({
    orders,
    idReferences: requested,
    codeReferences: requested,
    preferredStoreIds,
  })
}

export const resolveOrderNotificationTarget = ({ notification = {}, orders = [], stores = [] } = {}) => {
  const idReferences = notificationOrderIds(notification)
  const codeReferences = notificationOrderCodes(notification)
  const embeddedStoreId = embeddedOrderStoreId(notification, stores)
  const genericStoreId = genericNotificationStoreId(notification, stores)
  const codeStoreId = storeIdFromOrderCode(stores, codeReferences.find((value) => /-\d+$/u.test(value)))
  const legacyIdAsCodeStoreId = storeIdFromOrderCode(stores, idReferences.find((value) => /-\d+$/u.test(value)))
  let order = findOrderByTypedReferences({
    orders,
    idReferences,
    codeReferences,
    preferredStoreIds: [embeddedStoreId, codeStoreId, legacyIdAsCodeStoreId, genericStoreId],
  })
  if (!order) {
    for (const reference of idReferences) {
      const referenceStoreId = storeIdFromOrderCode(stores, reference)
      order = uniqueOrderForReference(orders, 'code', reference, [
        embeddedStoreId,
        referenceStoreId,
        genericStoreId,
      ])
      if (order) break
    }
  }
  const orderStoreId = validStoreId(stores, order?.storeId)
  const resolvedCodeStoreId = storeIdFromOrderCode(stores, order?.code) || codeStoreId || legacyIdAsCodeStoreId
  const fallbackStoreId = firstValidStoreId(stores, notificationStoreReferences(notification))
  return {
    order,
    orderId: compact(order?.id || idReferences[0] || codeReferences[0]),
    storeId: orderStoreId || embeddedStoreId || resolvedCodeStoreId || fallbackStoreId,
  }
}

export const resolveOrderRouteScope = ({
  requestedStoreId = '',
  requestedOrderId = '',
  fallbackStoreId = '',
  orders = [],
  stores = [],
} = {}) => {
  const requestedStore = validStoreId(stores, requestedStoreId)
  const fallbackStore = validStoreId(stores, fallbackStoreId)
  const order = findOrderByReference(orders, requestedOrderId, [requestedStore, fallbackStore])
  const orderStoreId = validStoreId(stores, order?.storeId)
  const codeStoreId = storeIdFromOrderCode(stores, order?.code || requestedOrderId)
  return {
    order,
    storeId: orderStoreId
      || codeStoreId
      || requestedStore
      || fallbackStore,
  }
}
