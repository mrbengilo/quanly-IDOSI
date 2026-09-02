import {
  businessDate,
  operationalIdentifierRecordMatch,
} from '../../utils'
import {
  occupationValueAllowed,
  ORDER_PAYMENT_METHODS,
} from '../../domain/orderInformationSettings'
import { referenceMatchesAttendanceShift } from './employeeShiftScope'

const attendanceDate = (record) => String(record?.date || record?.workDate || record?.checkInAt || record?.createdAt || '').slice(0, 10)
const employeeAliases = (employee) => [employee?.id, employee?.code, employee?.employeeId, employee?.employeeCode]
  .map((value) => String(value || '').trim()).filter(Boolean)
const storeAliases = (store = {}) => [store.id, store.code]
  .map((value) => String(value || '').trim()).filter(Boolean)
const attendanceIdentifier = (record) => String(record?.id || record?.code || record?.attendanceId || '')
const attendanceAliases = (record) => [record?.id, record?.code, record?.attendanceId]
  .map((value) => String(value || '').trim()).filter(Boolean)

const resolveTarget = (records, reference, identifierOf, fallback) => {
  const source = Array.isArray(records) ? records : []
  if (!source.length) return fallback
  const resolution = operationalIdentifierRecordMatch(source, reference, identifierOf)
  return resolution.ambiguous ? null : resolution.record
}

const referenceMatchesTarget = (records, target, reference, identifierOf) => {
  if (!target || !String(reference || '').trim()) return false
  const source = Array.isArray(records) && records.length ? records : [target]
  const resolution = operationalIdentifierRecordMatch(source, reference, identifierOf)
  return !resolution.ambiguous && resolution.record === target
}

export const effectiveEmployeeStoreId = (session = {}, employee = {}) => String(
  session?.storeId || employee?.storeId || '',
).trim()

export const orderCreatorEmployeeId = (order = {}) => {
  const explicitEmployeeId = String(
    order.createdByEmployeeId
      || order.creatorEmployeeId
      || order.createdBy?.employeeId
      || order.createdBy?.employee_id
      || '',
  ).trim()
  if (explicitEmployeeId) return explicitEmployeeId

  const creatorRole = String(order.createdBy?.role || '').trim().toLowerCase()
  if (creatorRole && creatorRole !== 'employee') return ''
  return String(order.employeeId || order.employee_id || '').trim()
}

export const orderCreatedByEmployee = (order = {}, employeeId = '', employees = []) => {
  const requested = String(employeeId || '').trim()
  const employee = resolveTarget(employees, requested, employeeAliases, requested ? { id: requested } : null)
  return referenceMatchesTarget(employees, employee, orderCreatorEmployeeId(order), employeeAliases)
}

export const employeeCreatedOrders = (
  orders = [],
  employeeId = '',
  storeId = '',
  { employees = [], stores = [] } = {},
) => {
  const store = resolveTarget(stores, storeId, storeAliases, storeId ? { id: String(storeId) } : null)
  if (storeId && !store) return []
  return orders.filter((order) => (
    !order.deletedAt
    && order.source !== 'legacy-opening-balance'
    && orderCreatedByEmployee(order, employeeId, employees)
    && (!storeId || referenceMatchesTarget(stores, store, order.storeId, storeAliases))
  ))
  .sort((left, right) => String(right.createdAt || '').localeCompare(String(left.createdAt || '')))
}

export const ordersForOpenAttendance = (
  orders = [],
  employeeId = '',
  openRecord = null,
  attendanceRecords = [],
  { employees = [], stores = [], shiftDefinitions = [] } = {},
) => {
  if (!openRecord) return []
  const activeAttendance = (Array.isArray(attendanceRecords) ? attendanceRecords : [])
    .filter((record) => !record.deletedAt)
  const canonicalOpenRecord = resolveTarget(
    activeAttendance,
    attendanceIdentifier(openRecord),
    attendanceAliases,
    openRecord,
  )
  if (!canonicalOpenRecord) return []
  const store = resolveTarget(
    stores,
    canonicalOpenRecord.storeId,
    storeAliases,
    canonicalOpenRecord.storeId ? { id: String(canonicalOpenRecord.storeId) } : null,
  )
  const attendanceShift = String(canonicalOpenRecord.shiftId || canonicalOpenRecord.shift || '')
  if (canonicalOpenRecord.storeId && !store) return []
  return orders
    .filter((order) => {
      if (
        order.deletedAt
        || !orderCreatedByEmployee(order, employeeId, employees)
        || order.source === 'legacy-opening-balance'
        || (canonicalOpenRecord.storeId && order.storeId && !referenceMatchesTarget(stores, store, order.storeId, storeAliases))
      ) return false
      if (order.attendanceId) {
        return referenceMatchesTarget(
          activeAttendance.length ? activeAttendance : [canonicalOpenRecord],
          canonicalOpenRecord,
          order.attendanceId,
          attendanceAliases,
        )
      }
      const orderShift = String(order.shiftId || order.shift || '')
      const sameLegacyShift = (!orderShift && !attendanceShift)
        || referenceMatchesAttendanceShift({
          attendance: canonicalOpenRecord,
          reference: orderShift,
          shiftDefinitions,
        })
      return sameLegacyShift && businessDate(order.createdAt) === attendanceDate(canonicalOpenRecord)
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

export const validateEmployeeOrder = (form = {}, { occupationOptions } = {}) => {
  const errors = {}
  if (!String(form.customerName || '').trim()) errors.customerName = 'Vui lòng nhập tên khách hàng.'
  if (!(Number(form.amount) > 0)) errors.amount = 'Số tiền phải lớn hơn 0.'
  if (!ORDER_GENDERS.includes(form.gender)) errors.gender = 'Vui lòng chọn giới tính.'
  if (!occupationValueAllowed({ options: occupationOptions, value: form.occupation })) {
    errors.occupation = 'Vui lòng chọn nghề nghiệp trong danh sách.'
  }
  if (!ACQUISITION_CHANNELS.includes(form.acquisitionChannel)) errors.acquisitionChannel = 'Vui lòng chọn kênh khách hàng biết đến.'
  if (!ORDER_PAYMENT_METHODS.includes(form.paymentMethod)) errors.paymentMethod = 'Vui lòng chọn hình thức thanh toán.'
  return errors
}
