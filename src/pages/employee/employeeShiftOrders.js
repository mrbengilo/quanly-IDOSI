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

const normalizedPaymentMethod = (value) => String(value || '')
  .trim()
  .toLocaleLowerCase('vi-VN')
  .replace(/[\s_-]+/gu, '')

export const paymentChannel = (value) => {
  const normalized = normalizedPaymentMethod(value)
  if (['tiềnmặt', 'cash'].includes(normalized)) return 'cash'
  if (['chuyểnkhoản', 'banktransfer', 'transfer', 'bank'].includes(normalized)) return 'transfer'
  return 'unknown'
}

export const shiftRevenueBreakdown = (orders = []) => orders.reduce((summary, order) => {
  const amount = Math.max(0, Math.trunc(Number(order.amount) || 0))
  const channel = paymentChannel(order.paymentMethod)
  if (channel === 'cash') summary.cash += amount
  if (channel === 'transfer') summary.transfer += amount
  if (channel === 'unknown') summary.unknown += amount
  summary.total += amount
  return summary
}, { cash: 0, transfer: 0, unknown: 0, total: 0 })

export const checkoutReconciliation = ({ orders = [], cashRevenue = 0, transferRevenue = 0 } = {}) => {
  const expected = shiftRevenueBreakdown(orders)
  const entered = {
    cash: Math.max(0, Math.trunc(Number(cashRevenue) || 0)),
    transfer: Math.max(0, Math.trunc(Number(transferRevenue) || 0)),
  }
  entered.total = entered.cash + entered.transfer
  return {
    expected,
    entered,
    cashMatches: entered.cash === expected.cash,
    transferMatches: entered.transfer === expected.transfer,
    matches: expected.unknown === 0 && entered.cash === expected.cash && entered.transfer === expected.transfer,
  }
}

export const ORDER_GENDERS = ['Nam', 'Nữ', 'Khác']
export const ACQUISITION_CHANNELS = ['Facebook', 'Tiktok', 'Zalo', 'Bạn Bè', 'Người thân', 'Khác']

export const validateEmployeeOrder = (form = {}) => {
  const errors = {}
  if (!String(form.customerName || '').trim()) errors.customerName = 'Vui lòng nhập tên khách hàng.'
  if (!(Number(form.amount) > 0)) errors.amount = 'Số tiền phải lớn hơn 0.'
  if (!ORDER_GENDERS.includes(form.gender)) errors.gender = 'Vui lòng chọn giới tính.'
  if (!String(form.occupation || '').trim()) errors.occupation = 'Vui lòng nhập nghề nghiệp.'
  if (!ACQUISITION_CHANNELS.includes(form.acquisitionChannel)) errors.acquisitionChannel = 'Vui lòng chọn kênh khách hàng biết đến.'
  return errors
}
