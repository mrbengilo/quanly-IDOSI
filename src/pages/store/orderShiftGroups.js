import { businessDate } from '../../utils'

const timeToMinutes = (value) => {
  const match = String(value || '').trim().match(/^(\d{1,2}):(\d{2})/u)
  if (!match) return null
  const hour = Number(match[1])
  const minute = Number(match[2])
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour > 23 || minute > 59) return null
  return (hour * 60) + minute
}

const semanticShiftStart = (name) => {
  const normalized = String(name || '')
    .trim()
    .toLocaleLowerCase('vi-VN')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/gu, '')
    .replace(/đ/gu, 'd')
  if (normalized.includes('dem') || normalized.includes('toi')) return 18 * 60
  if (normalized.includes('chieu')) return 13 * 60
  if (normalized.includes('sang')) return 8 * 60
  if (normalized.includes('hanh chinh')) return (8 * 60) + 30
  return -1
}

const orderTimestamp = (order = {}) => {
  const parsed = Date.parse(order.updatedAt || order.createdAt || '')
  return Number.isFinite(parsed) ? parsed : 0
}

const orderDay = (order = {}) => businessDate(
  order.createdAt || order.updatedAt || order.businessDate || order.date || '',
)

const groupShiftStart = (orders = []) => orders.reduce((latest, order) => {
  const explicit = timeToMinutes(order.shiftStart || order.start || order.startTime)
  const inferred = explicit ?? semanticShiftStart(order.shiftName)
  return Math.max(latest, inferred)
}, -1)

const compareOrdersNewestFirst = (left, right) => (
  orderTimestamp(right) - orderTimestamp(left)
  || String(right.id || right.code || '').localeCompare(String(left.id || left.code || ''), 'vi-VN')
)

const compareGroups = (view) => ([, left], [, right]) => {
  const leftFirst = left[0] || {}
  const rightFirst = right[0] || {}
  if (view === 'shift') {
    const dayOrder = String(orderDay(rightFirst)).localeCompare(String(orderDay(leftFirst)))
    if (dayOrder) return dayOrder
    const shiftOrder = groupShiftStart(right) - groupShiftStart(left)
    if (shiftOrder) return shiftOrder
  } else if (view === 'day') {
    const dayOrder = String(orderDay(rightFirst)).localeCompare(String(orderDay(leftFirst)))
    if (dayOrder) return dayOrder
  }
  const latestOrder = orderTimestamp(rightFirst) - orderTimestamp(leftFirst)
  if (latestOrder) return latestOrder
  return String(leftFirst.shiftName || leftFirst.employeeName || '').localeCompare(
    String(rightFirst.shiftName || rightFirst.employeeName || ''),
    'vi-VN',
  )
}

const shiftGroupKey = (order = {}) => {
  const explicitId = String(order.shiftId || '').trim()
  if (explicitId) return explicitId
  const name = String(order.shiftName || 'Chưa gắn ca').trim().toLocaleLowerCase('vi-VN')
  const start = String(order.shiftStart || order.start || order.startTime || '').trim()
  const end = String(order.shiftEnd || order.end || order.endTime || '').trim()
  return `${name}:${start}:${end}`
}

export const groupOrdersForDisplay = (orders = [], view = 'shift') => {
  const keyOf = view === 'employee'
    ? (order) => order.employeeId || 'system'
    : view === 'day'
      ? (order) => orderDay(order)
      : (order) => `${orderDay(order)}:${shiftGroupKey(order)}`
  const grouped = new Map()
  for (const order of Array.isArray(orders) ? orders : []) {
    const key = keyOf(order)
    if (!grouped.has(key)) grouped.set(key, [])
    grouped.get(key).push(order)
  }
  for (const group of grouped.values()) group.sort(compareOrdersNewestFirst)
  return [...grouped.entries()].sort(compareGroups(view))
}
