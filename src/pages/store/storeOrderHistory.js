import { buildPaginatedPages } from '../../components/tablePagination'
import { orderBusinessDate } from '../../domain/orderSummary'

export const STORE_ORDER_HISTORY_PAGE_SIZE = 100

const orderRecordKey = (record = {}) => String(record.id || record.code || '')

export const mergeStoreOrderHistoryRecords = (current = [], additions = []) => {
  const byId = new Map((Array.isArray(current) ? current : []).map((record) => [orderRecordKey(record), record]))
  for (const record of Array.isArray(additions) ? additions : []) byId.set(orderRecordKey(record), record)
  return [...byId.values()]
}

const orderDate = orderBusinessDate

export const buildStoreOrderPages = (orders = [], {
  currentDay,
  pageSize = 20,
} = {}) => {
  const source = Array.isArray(orders) ? orders : []
  const normalizedCurrentDay = String(currentDay || '').trim()
  if (!normalizedCurrentDay) return buildPaginatedPages(source, { pageSize })

  const currentRows = []
  const historicalRows = []
  for (const order of source) {
    if (orderDate(order) === normalizedCurrentDay) currentRows.push(order)
    else historicalRows.push(order)
  }
  const historicalPages = buildPaginatedPages(historicalRows, {
    pageSize,
    getDate: orderDate,
    firstPageDates: [normalizedCurrentDay],
    groupRemainingByDate: true,
  })
  return currentRows.length ? [currentRows, ...historicalPages] : historicalPages
}

/**
 * Loads the first history page and follows its cursor while that page is still
 * entirely inside the current business day. This keeps every current-day
 * order available without downloading the complete historical collection.
 */
export const loadInitialStoreOrderHistory = async ({
  fetchPage,
  query,
  currentDay,
  requestedOrderId = '',
  pageSize = STORE_ORDER_HISTORY_PAGE_SIZE,
}) => {
  let records = []
  let page
  let cursor = ''
  let shouldContinue = true
  const visitedCursors = new Set()

  while (shouldContinue) {
    const payload = await fetchPage({ ...query, cursor, limit: pageSize })
    const additions = Array.isArray(payload?.records) ? payload.records : []
    records = mergeStoreOrderHistoryRecords(records, additions)
    page = payload?.page || null

    const nextCursor = String(page?.nextCursor || '')
    const lastRecordDay = orderDate(additions.at(-1))
    const seekingRequestedOrder = requestedOrderId && !records.some((record) => (
      [record.id, record.code].some((value) => String(value || '') === String(requestedOrderId))
    ))
    shouldContinue = Boolean(
      page?.hasMore
      && nextCursor
      && additions.length
      && (lastRecordDay === currentDay || seekingRequestedOrder)
      && !visitedCursors.has(nextCursor),
    )
    if (shouldContinue) {
      visitedCursors.add(nextCursor)
      cursor = nextCursor
    }
  }

  return { records, page: page || null }
}
