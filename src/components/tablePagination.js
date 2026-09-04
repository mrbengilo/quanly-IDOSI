export const DEFAULT_TABLE_PAGE_SIZE = 20

const normalizedPageSize = (value) => {
  const size = Number(value)
  return Number.isSafeInteger(size) && size > 0 ? size : DEFAULT_TABLE_PAGE_SIZE
}

export const normalizeTableDate = (value) => String(value || '').trim().match(/^\d{4}-\d{2}-\d{2}/u)?.[0] || ''

export const shiftBusinessDate = (value, days = 0) => {
  const source = normalizeTableDate(value)
  const match = source.match(/^(\d{4})-(\d{2})-(\d{2})$/u)
  if (!match || !Number.isSafeInteger(Number(days))) return ''
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + Number(days)))
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10)
}

const chunk = (items, pageSize) => {
  const pages = []
  for (let index = 0; index < items.length; index += pageSize) {
    pages.push(items.slice(index, index + pageSize))
  }
  return pages
}

/**
 * Builds stable client-side pages. When `firstPageDates` is supplied, rows in
 * those dates are isolated at the beginning instead of being backfilled with
 * older dates. Remaining dated rows are grouped by date so clicking page 2, 3,
 * ... moves through history in chronological buckets. Every page is still
 * capped by `pageSize`.
 */
export const buildPaginatedPages = (items = [], {
  pageSize = DEFAULT_TABLE_PAGE_SIZE,
  getDate = () => '',
  firstPageDates = [],
  groupRemainingByDate = false,
} = {}) => {
  const source = Array.isArray(items) ? items : []
  const size = normalizedPageSize(pageSize)
  if (!source.length) return []

  const prioritizedDates = [...new Set((Array.isArray(firstPageDates) ? firstPageDates : [])
    .map(normalizeTableDate)
    .filter(Boolean))]
  if (!prioritizedDates.length) return chunk(source, size)

  const prioritizedDateSet = new Set(prioritizedDates)
  const prioritized = []
  const remaining = []
  source.forEach((item) => {
    const date = normalizeTableDate(getDate(item))
    if (date && prioritizedDateSet.has(date)) prioritized.push(item)
    else remaining.push(item)
  })

  const pages = []
  if (prioritized.length) pages.push(...chunk(prioritized, size))

  if (groupRemainingByDate) {
    const datedGroups = new Map()
    const undated = []
    remaining.forEach((item) => {
      const date = normalizeTableDate(getDate(item))
      if (!date) {
        undated.push(item)
        return
      }
      if (!datedGroups.has(date)) datedGroups.set(date, [])
      datedGroups.get(date).push(item)
    })
    ;[...datedGroups.entries()]
      .sort(([leftDate], [rightDate]) => rightDate.localeCompare(leftDate))
      .forEach(([, group]) => pages.push(...chunk(group, size)))
    pages.push(...chunk(undated, size))
  } else {
    pages.push(...chunk(remaining, size))
  }

  return pages.length ? pages : chunk(source, size)
}

export const paginationSequence = (currentPage, totalPages, maxVisible = 7) => {
  const total = Math.max(1, Number(totalPages) || 1)
  const current = Math.min(total, Math.max(1, Number(currentPage) || 1))
  const visible = Math.max(5, Number(maxVisible) || 7)
  if (total <= visible) return Array.from({ length: total }, (_, index) => index + 1)

  const innerSlots = visible - 4
  let start = Math.max(2, current - Math.floor(innerSlots / 2))
  let end = Math.min(total - 1, start + innerSlots - 1)
  start = Math.max(2, end - innerSlots + 1)

  const sequence = [1]
  if (start > 2) sequence.push('start-ellipsis')
  for (let page = start; page <= end; page += 1) sequence.push(page)
  if (end < total - 1) sequence.push('end-ellipsis')
  sequence.push(total)
  return sequence
}
