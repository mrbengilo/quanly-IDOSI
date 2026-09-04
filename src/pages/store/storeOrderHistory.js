import { buildPaginatedPages } from '../../components/tablePagination'
import { businessDate } from '../../utils'

export const STORE_ORDER_HISTORY_PAGE_SIZE = 100

const orderRecordKey = (record = {}) => String(record.id || record.code || '')

export const mergeStoreOrderHistoryRecords = (current = [], additions = []) => {
  const byId = new Map((Array.isArray(current) ? current : []).map((record) => [orderRecordKey(record), record]))
  for (const record of Array.isArray(additions) ? additions : []) byId.set(orderRecordKey(record), record)
  return [...byId.values()]
}

const orderDate = (record = {}) => businessDate(
  record.createdAt || record.date || record.businessDate || record.updatedAt || '',
)

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
    shouldContinue = Boolean(
      page?.hasMore
      && nextCursor
      && additions.length
      && lastRecordDay === currentDay
      && !visitedCursors.has(nextCursor),
    )
    if (shouldContinue) {
      visitedCursors.add(nextCursor)
      cursor = nextCursor
    }
  }

  return { records, page: page || null }
}
