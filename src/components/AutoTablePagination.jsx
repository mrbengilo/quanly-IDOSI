import { useLayoutEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'

export const DEFAULT_TABLE_PAGE_SIZE = 20
export const IDOSI_TIME_ZONE = 'Asia/Ho_Chi_Minh'

const normalizeText = (value) => String(value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/gu, '')
  .replace(/đ/gu, 'd')
  .replace(/Đ/gu, 'D')
  .toLocaleLowerCase('vi-VN')
  .replace(/\s+/gu, ' ')
  .trim()

const dateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: IDOSI_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

const datePartsKey = (date) => {
  const parts = Object.fromEntries(dateFormatter.formatToParts(date)
    .filter(({ type }) => ['year', 'month', 'day'].includes(type))
    .map(({ type, value }) => [type, value]))
  return `${parts.year}-${parts.month}-${parts.day}`
}

export const vietnamTodayKey = (now = new Date()) => datePartsKey(now)

const shiftDateKey = (dateKey, dayOffset) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(String(dateKey || ''))
  if (!match) return ''
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + dayOffset, 12))
  return date.toISOString().slice(0, 10)
}

const validDateKey = (year, month, day) => {
  const y = Number(year)
  const m = Number(month)
  const d = Number(day)
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return ''
  const date = new Date(Date.UTC(y, m - 1, d, 12))
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return ''
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

const dateKeyFromCandidate = (candidate, todayKey) => {
  const value = String(candidate || '').trim()
  if (!value) return ''

  const isoDate = /(?:^|\D)(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})(?:\D|$)/u.exec(value)
  if (isoDate) return validDateKey(isoDate[1], isoDate[2], isoDate[3])

  const vietnamDate = /(?:^|\D)(\d{1,2})[/-](\d{1,2})[/-](20\d{2})(?:\D|$)/u.exec(value)
  if (vietnamDate) return validDateKey(vietnamDate[3], vietnamDate[2], vietnamDate[1])

  const compactVietnamDate = /(?:^|\D)(\d{1,2})[/-](\d{1,2})(?:\D|$)/u.exec(value)
  if (compactVietnamDate && /^20\d{2}-\d{2}-\d{2}$/u.test(todayKey)) {
    return validDateKey(todayKey.slice(0, 4), compactVietnamDate[2], compactVietnamDate[1])
  }

  if (/^\d{4}-\d{2}-\d{2}T/u.test(value) || /(?:GMT|Z$|T\d{2}:\d{2})/u.test(value)) {
    const timestamp = Date.parse(value)
    if (Number.isFinite(timestamp)) return datePartsKey(new Date(timestamp))
  }
  return ''
}

const ROW_DATE_ATTRIBUTES = [
  'datetime',
  'data-date',
  'data-business-date',
  'data-work-date',
  'data-created-at',
  'data-updated-at',
  'data-assigned-at',
  'data-occurred-at',
]

export const rowDateKey = (row, todayKey = vietnamTodayKey()) => {
  const candidates = []
  for (const attribute of ROW_DATE_ATTRIBUTES) {
    if (row.hasAttribute?.(attribute)) candidates.push(row.getAttribute(attribute))
    row.querySelectorAll?.(`[${attribute}]`).forEach((element) => candidates.push(element.getAttribute(attribute)))
  }
  row.querySelectorAll?.('time').forEach((element) => {
    candidates.push(element.getAttribute('datetime'))
    candidates.push(element.textContent)
  })
  row.querySelectorAll?.('td,th').forEach((cell) => candidates.push(cell.textContent))
  candidates.push(row.textContent)

  for (const candidate of candidates) {
    const key = dateKeyFromCandidate(candidate, todayKey)
    if (key) return key
  }
  return ''
}

const rowsInChunks = (rows, pageSize) => {
  const pages = []
  for (let index = 0; index < rows.length; index += pageSize) pages.push(rows.slice(index, index + pageSize))
  return pages
}

const tableContextText = (table) => {
  const container = table.closest([
    '[data-table-section]',
    '.card',
    '.panel',
    '.section',
    'section',
    'article',
  ].join(',')) || table.parentElement
  return normalizeText(container?.textContent || '')
}

export const paginationModeForTable = ({ pathname, contextText }) => {
  const path = String(pathname || '').toLocaleLowerCase('en-US')
  const context = normalizeText(contextText)
  if (path.startsWith('/admin/assignments')
    && context.includes('lich su giao viec')
    && context.includes('tien do')) return 'assignment-two-days'
  if (path.startsWith('/store/orders')) return 'today-by-day'
  if ((path.includes('/store/attendance') || path.includes('/store/timekeeping'))
    && context.includes('lich su cham cong')) return 'today-by-day'
  if (path.startsWith('/store/')
    && context.includes('cong viec tinh thuong')
    && context.includes('vi pham')) return 'today-by-day'
  return 'rows-20'
}

export const buildTablePages = ({ rows, mode, todayKey = vietnamTodayKey(), pageSize = DEFAULT_TABLE_PAGE_SIZE }) => {
  const list = Array.from(rows || [])
  if (!list.length) return []
  if (mode === 'rows-20') return rowsInChunks(list, pageSize)

  const datedRows = list.map((row) => ({ row, date: rowDateKey(row, todayKey) }))
  const parsedCount = datedRows.filter(({ date }) => date).length
  if (!parsedCount || parsedCount / list.length < 0.6) return rowsInChunks(list, pageSize)

  const recentKeys = new Set(mode === 'assignment-two-days'
    ? [todayKey, shiftDateKey(todayKey, -1)]
    : [todayKey])
  const firstPage = datedRows.filter(({ date }) => recentKeys.has(date)).map(({ row }) => row)
  const olderGroups = new Map()
  const undatedRows = []
  datedRows.forEach(({ row, date }) => {
    if (recentKeys.has(date)) return
    if (!date) {
      undatedRows.push(row)
      return
    }
    if (!olderGroups.has(date)) olderGroups.set(date, [])
    olderGroups.get(date).push(row)
  })
  const olderPages = [...olderGroups.entries()]
    .sort(([left], [right]) => right.localeCompare(left))
    .map(([, dateRows]) => dateRows)
  return [firstPage, ...olderPages, ...rowsInChunks(undatedRows, pageSize)]
}

const visiblePageNumbers = (currentPage, totalPages) => {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, index) => index + 1)
  const values = new Set([1, totalPages, currentPage - 1, currentPage, currentPage + 1])
  const sorted = [...values].filter((page) => page >= 1 && page <= totalPages).sort((a, b) => a - b)
  const result = []
  sorted.forEach((page, index) => {
    if (index && page - sorted[index - 1] > 1) result.push('ellipsis')
    result.push(page)
  })
  return result
}

const hasExistingPagination = (table) => {
  if (table.closest('[data-auto-pagination="off"]')) return true
  const container = table.closest('.card,.panel,section,article') || table.parentElement
  return Boolean(container?.querySelector([
    '[data-pagination]',
    '.pagination',
    '.table-pagination',
    '.page-controls',
  ].join(',')))
}

const createButton = ({ label, text, disabled = false, active = false, onClick }) => {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = `auto-table-pagination__button${active ? ' is-active' : ''}`
  button.textContent = text
  button.setAttribute('aria-label', label)
  if (active) button.setAttribute('aria-current', 'page')
  button.disabled = disabled
  button.addEventListener('click', onClick)
  return button
}

const wrapperForTable = (table) => table.closest('.table-wrap,.table-scroll,.table-responsive') || table

const tableKeyFor = (table, pathname, index) => {
  const caption = normalizeText(table.querySelector('caption')?.textContent || '')
  const heading = normalizeText((table.closest('.card,.panel,section,article') || table.parentElement)
    ?.querySelector?.('h1,h2,h3,h4,strong')?.textContent || '')
  return `${pathname}|${index}|${caption || heading || 'table'}`
}

export default function AutoTablePagination() {
  const location = useLocation()
  const pageByTableRef = useRef(new Map())

  useLayoutEffect(() => {
    const root = document.querySelector('.workspace-content-region')
    if (!root) return undefined
    let observer
    let scheduled = 0
    let applying = false

    const removeControls = () => {
      root.querySelectorAll('[data-auto-table-pagination]').forEach((node) => node.remove())
    }

    const apply = () => {
      if (applying) return
      applying = true
      observer?.disconnect()
      removeControls()
      const tables = [...root.querySelectorAll('table')]
      tables.forEach((table, tableIndex) => {
        const rows = [...table.querySelectorAll(':scope > tbody > tr')]
        rows.forEach((row) => { row.hidden = false })
        if (rows.length <= 1 || hasExistingPagination(table)) return

        const mode = paginationModeForTable({
          pathname: location.pathname,
          contextText: tableContextText(table),
        })
        const pages = buildTablePages({ rows, mode })
        if (pages.length <= 1) return

        const key = tableKeyFor(table, location.pathname, tableIndex)
        let currentPage = Math.min(Math.max(Number(pageByTableRef.current.get(key) || 1), 1), pages.length)
        const rowPage = new Map()
        pages.forEach((pageRows, pageIndex) => pageRows.forEach((row) => rowPage.set(row, pageIndex + 1)))

        const controls = document.createElement('nav')
        controls.className = 'auto-table-pagination'
        controls.dataset.autoTablePagination = 'true'
        controls.setAttribute('aria-label', 'Phân trang bảng dữ liệu')

        const summary = document.createElement('span')
        summary.className = 'auto-table-pagination__summary'
        const buttons = document.createElement('span')
        buttons.className = 'auto-table-pagination__buttons'
        controls.append(summary, buttons)

        const renderPage = (nextPage) => {
          currentPage = Math.min(Math.max(nextPage, 1), pages.length)
          pageByTableRef.current.set(key, currentPage)
          rows.forEach((row) => { row.hidden = rowPage.get(row) !== currentPage })
          const visibleCount = pages[currentPage - 1]?.length || 0
          summary.textContent = `Trang ${currentPage}/${pages.length} · ${visibleCount} dòng`
          buttons.replaceChildren()
          buttons.append(createButton({
            label: 'Trang trước',
            text: '‹',
            disabled: currentPage === 1,
            onClick: () => renderPage(currentPage - 1),
          }))
          visiblePageNumbers(currentPage, pages.length).forEach((page, index) => {
            if (page === 'ellipsis') {
              const ellipsis = document.createElement('span')
              ellipsis.className = 'auto-table-pagination__ellipsis'
              ellipsis.textContent = '…'
              ellipsis.setAttribute('aria-hidden', 'true')
              ellipsis.dataset.index = String(index)
              buttons.append(ellipsis)
              return
            }
            buttons.append(createButton({
              label: `Trang ${page}`,
              text: String(page),
              active: page === currentPage,
              onClick: () => renderPage(page),
            }))
          })
          buttons.append(createButton({
            label: 'Trang sau',
            text: '›',
            disabled: currentPage === pages.length,
            onClick: () => renderPage(currentPage + 1),
          }))
        }

        const wrapper = wrapperForTable(table)
        wrapper.insertAdjacentElement('afterend', controls)
        renderPage(currentPage)
      })
      observer?.observe(root, { childList: true, subtree: true })
      applying = false
    }

    const scheduleApply = () => {
      window.clearTimeout(scheduled)
      scheduled = window.setTimeout(apply, 40)
    }

    observer = new MutationObserver((mutations) => {
      if (applying) return
      const meaningful = mutations.some((mutation) => (
        !mutation.target.closest?.('[data-auto-table-pagination]')
        && [...mutation.addedNodes, ...mutation.removedNodes]
          .some((node) => node.nodeType === Node.ELEMENT_NODE || node.nodeType === Node.TEXT_NODE)
      ))
      if (meaningful) scheduleApply()
    })
    apply()

    return () => {
      window.clearTimeout(scheduled)
      observer.disconnect()
      removeControls()
      root.querySelectorAll('tbody > tr[hidden]').forEach((row) => { row.hidden = false })
    }
  }, [location.key, location.pathname])

  return null
}
