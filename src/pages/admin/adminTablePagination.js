export const ADMIN_TABLE_PAGE_SIZE = 20

const normalizedPageSize = (pageSize) => {
  const parsed = Number(pageSize)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : ADMIN_TABLE_PAGE_SIZE
}

const normalizedPage = (page, pageCount) => {
  const parsed = Number(page)
  const requested = Number.isInteger(parsed) ? parsed : 0
  return Math.min(Math.max(0, requested), Math.max(0, pageCount - 1))
}

export function paginateRows(rows = [], requestedPage = 0, pageSize = ADMIN_TABLE_PAGE_SIZE) {
  const source = Array.isArray(rows) ? rows : []
  const size = normalizedPageSize(pageSize)
  const pageCount = Math.max(1, Math.ceil(source.length / size))
  const page = normalizedPage(requestedPage, pageCount)
  return {
    page,
    pageCount,
    totalRows: source.length,
    rows: source.slice(page * size, (page + 1) * size),
  }
}

const chunkRows = (rows, pageSize) => {
  if (!rows.length) return [[]]
  const chunks = []
  for (let offset = 0; offset < rows.length; offset += pageSize) {
    chunks.push(rows.slice(offset, offset + pageSize))
  }
  return chunks
}

export function paginateRowsByDate({
  rows = [],
  dateOf,
  focusDate = '',
  requestedPage = 0,
  pageSize = ADMIN_TABLE_PAGE_SIZE,
} = {}) {
  if (typeof dateOf !== 'function') throw new TypeError('dateOf must be a function.')
  const source = Array.isArray(rows) ? rows : []
  const size = normalizedPageSize(pageSize)
  const grouped = new Map()
  for (const row of source) {
    const date = String(dateOf(row) || '')
    if (!date) continue
    if (!grouped.has(date)) grouped.set(date, [])
    grouped.get(date).push(row)
  }
  const normalizedFocus = String(focusDate || '')
  const dates = [...grouped.keys()].sort((left, right) => right.localeCompare(left))
  const orderedDates = normalizedFocus
    ? [normalizedFocus, ...dates.filter((date) => date !== normalizedFocus)]
    : dates
  if (!orderedDates.length) orderedDates.push(normalizedFocus)
  const pages = orderedDates.flatMap((date) => {
    const chunks = chunkRows(grouped.get(date) || [], size)
    return chunks.map((pageRows, datePage) => ({
      date,
      datePage,
      datePageCount: chunks.length,
      rows: pageRows,
    }))
  })
  const pageCount = Math.max(1, pages.length)
  const page = normalizedPage(requestedPage, pageCount)
  return {
    page,
    pageCount,
    totalRows: source.length,
    ...(pages[page] || { date: normalizedFocus, datePage: 0, datePageCount: 1, rows: [] }),
  }
}
