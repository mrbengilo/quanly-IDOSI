import { businessDate } from '../../utils'

const attendanceDate = (record = {}) => String(record.date || record.workDate || record.checkInAt || record.createdAt || '').slice(0, 10)

export const ordersForOpenAttendance = (orders = [], employeeId = '', openRecord = null) => {
  if (!openRecord) return []
  return orders
    .filter((order) => {
      if (order.deletedAt || String(order.employeeId) !== String(employeeId) || order.source === 'legacy-opening-balance') return false
      if (order.attendanceId) return String(order.attendanceId) === String(openRecord.id)
      const orderShift = String(order.shiftId || order.shift || '')
      const attendanceShift = String(openRecord.shiftId || openRecord.shift || '')
      return orderShift === attendanceShift && businessDate(order.createdAt) === attendanceDate(openRecord)
    })
    .sort((left, right) => String(right.createdAt || '').localeCompare(String(left.createdAt || '')))
}
