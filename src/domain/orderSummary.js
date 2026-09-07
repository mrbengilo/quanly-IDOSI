const VIETNAM_OFFSET_MS = 7 * 60 * 60 * 1_000
const EXPLICIT_ZONE_DATE_TIME = /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:?\d{2})$/iu

const identifierKey = (value) => String(value ?? '').trim().toLocaleLowerCase('en-US')

const vietnamDate = (date) => new Date(date.getTime() + VIETNAM_OFFSET_MS).toISOString().slice(0, 10)

const businessDate = (value) => {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? '' : vietnamDate(value)
  const source = String(value ?? '').trim()
  if (!source) return ''
  if (/^\d{4}-\d{2}-\d{2}$/u.test(source)) return source
  if (EXPLICIT_ZONE_DATE_TIME.test(source)) {
    const timestamp = Date.parse(source)
    if (Number.isFinite(timestamp)) return vietnamDate(new Date(timestamp))
  }
  return source.match(/^\d{4}-\d{2}-\d{2}/u)?.[0] || ''
}

export const orderBusinessDate = (order = {}) => businessDate(
  order?.createdAt || order?.date || order?.businessDate || order?.updatedAt || '',
)

const shiftGroupKey = (order = {}) => {
  const explicitId = String(order?.shiftId || '').trim()
  if (explicitId) return explicitId
  const name = String(order?.shiftName || 'Chưa gắn ca').trim().toLocaleLowerCase('vi-VN')
  const start = String(order?.shiftStart || order?.start || order?.startTime || '').trim()
  const end = String(order?.shiftEnd || order?.end || order?.endTime || '').trim()
  return `${name}:${start}:${end}`
}

export const orderGroupKey = (order = {}, view = 'shift') => {
  if (view === 'employee') return String(order?.employeeId || 'system')
  const date = orderBusinessDate(order)
  if (view === 'day') return date
  return `${date}:${shiftGroupKey(order)}`
}

export const paymentChannel = (value) => {
  const normalized = String(value || '').trim().toLocaleLowerCase('vi-VN').replace(/[\s_-]+/gu, '')
  if (['tiềnmặt', 'cash'].includes(normalized)) return 'cash'
  if (['chuyểnkhoản', 'banktransfer', 'transfer', 'bank'].includes(normalized)) return 'transfer'
  return 'unknown'
}

// Blank means no filter; zero is a valid exact amount. Never round money.
export const parseOrderAmountFilter = (value) => {
  const text = String(value ?? '').trim()
  if (!text) return null
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+|\d{1,3}(?:\.\d{3})+|\d{1,3}(?: \d{3})+)$/u.test(text)) return Number.NaN
  const amount = Number(text.replace(/[,. ]/gu, ''))
  return Number.isSafeInteger(amount) && amount >= 0 ? amount : Number.NaN
}

export const orderMatchesFilters = (order, { date = '', shiftId = '', paymentMethod = '', amount = null, query = '' } = {}) => {
  if (!order || order.deletedAt || order.status === 'Đã xóa' || order.source === 'legacy-opening-balance') return false
  if (date && orderBusinessDate(order) !== date) return false
  if (shiftId && String(order.shiftId || '') !== shiftId) return false
  if (paymentMethod && paymentChannel(order.paymentMethod) !== paymentChannel(paymentMethod)) return false
  if (amount !== null && amount !== '' && (!['number', 'string'].includes(typeof order.amount) || String(order.amount).trim() === '' || Number(order.amount) !== Number(amount))) return false
  const haystack = [order.code, order.customerName, order.customerPhone, order.employeeName].join(' ').toLocaleLowerCase('vi-VN')
  return !query || haystack.includes(query.trim().toLocaleLowerCase('vi-VN'))
}

const emptyTotals = () => ({ orders: 0, cash: 0, transfer: 0, revenue: 0, cashOrders: 0, transferOrders: 0 })

const checkedAmount = (order) => {
  const rawAmount = order?.amount
  const amount = typeof rawAmount === 'number'
    || (typeof rawAmount === 'string' && rawAmount.trim())
    ? Number(rawAmount)
    : Number.NaN
  if (!Number.isSafeInteger(amount) || amount < 0) {
    throw new TypeError(`Invalid order amount for summary: ${String(order?.id || order?.code || 'unknown')}`)
  }
  return amount
}

const addOrder = (target, order, amount) => {
  const revenue = target.revenue + amount
  if (!Number.isSafeInteger(revenue)) throw new RangeError('Order summary exceeds the safe integer range.')
  target.orders += 1
  target.revenue = revenue
  const channel = paymentChannel(order.paymentMethod)
  if (channel === 'cash' || channel === 'transfer') {
    target[channel] += amount
    target[`${channel}Orders`] += 1
  }
}

const sortedGroups = (groups) => [...groups.entries()]
  .map(([key, totals]) => ({ key, ...totals }))
  .sort((left, right) => String(left.key).localeCompare(String(right.key), 'vi-VN'))

const shiftMetadata = (order) => {
  const shiftId = String(order?.shiftId || '').trim()
  const shiftName = String(order?.shiftName || '').trim()
  const shiftStart = String(order?.shiftStart || order?.start || order?.startTime || '').trim()
  const shiftEnd = String(order?.shiftEnd || order?.end || order?.endTime || '').trim()
  return {
    ...(shiftId ? { shiftId } : {}),
    ...(shiftName ? { shiftName } : {}),
    ...(shiftStart ? { shiftStart } : {}),
    ...(shiftEnd ? { shiftEnd } : {}),
  }
}

export const summarizeOrders = (orders = [], { storeId = '', period = '', employeeId = '', ...filters } = {}) => {
  const totals = emptyTotals()
  const groups = {
    shift: new Map(),
    day: new Map(),
    employee: new Map(),
  }
  const storeKey = identifierKey(storeId)
  const employeeKey = identifierKey(employeeId)

  for (const order of Array.isArray(orders) ? orders : []) {
    if (!orderMatchesFilters(order, filters)) continue
    if (storeKey && identifierKey(order.storeId) !== storeKey) continue
    if (employeeKey && identifierKey(order.employeeId) !== employeeKey) continue
    if (period && orderBusinessDate(order).slice(0, 7) !== period) continue

    const amount = checkedAmount(order)
    addOrder(totals, order, amount)
    for (const view of Object.keys(groups)) {
      const key = String(orderGroupKey(order, view))
      const groupTotals = groups[view].get(key) || {
        ...emptyTotals(),
        ...(view === 'shift' ? shiftMetadata(order) : {}),
      }
      addOrder(groupTotals, order, amount)
      groups[view].set(key, groupTotals)
    }
  }

  return {
    totals,
    groups: {
      shift: sortedGroups(groups.shift),
      day: sortedGroups(groups.day),
      employee: sortedGroups(groups.employee),
    },
  }
}
