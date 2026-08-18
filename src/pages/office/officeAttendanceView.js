import {
  officeArrivalMinutes,
  officeArrivalStatus,
  officeAttendanceStats,
  officeRecordDate,
} from '../employee/officeAttendance'

const sameId = (left, right) => String(left ?? '') === String(right ?? '')
const recordEmployeeId = (record = {}) => String(record.employeeId || record.employeeCode || record.staffId || record.userId || '')

const employeeAliases = (employee = {}) => [employee.id, employee.code, employee.employeeCode]
  .map((value) => String(value || ''))
  .filter(Boolean)

const timeMinutes = (value) => {
  const match = String(value || '').match(/^(\d{1,2}):(\d{2})/u)
  if (!match) return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  return hours <= 23 && minutes <= 59 ? hours * 60 + minutes : null
}

const employeeMap = (employees = []) => new Map(employees.flatMap((employee) => (
  employeeAliases(employee).map((alias) => [alias, employee])
)))

const normalizeDepartureStatus = (record = {}, checkOut = '') => {
  if (!checkOut) return 'Chưa ra về'
  const value = String(record.departureTag || record.checkOutTag || record.checkoutTag || '').trim()
  if (value) return value
  return 'Đã ra về'
}

const recordForStats = (row) => ({
  ...row.record,
  shiftStart: row.shiftStart,
  checkIn: row.checkIn,
  arrivalTag: row.arrivalStatus,
  minutesEarly: row.earlyMinutes,
  minutesLate: row.lateMinutes,
})

export const formatOfficeTime24 = (value) => {
  if (!value) return ''
  const plain = String(value).match(/^(\d{1,2}):(\d{2})/u)
  if (plain) return `${String(plain[1]).padStart(2, '0')}:${plain[2]}`
  const parsed = new Date(value)
  if (!Number.isNaN(parsed.getTime())) {
    return new Intl.DateTimeFormat('vi-VN', {
      timeZone: 'Asia/Ho_Chi_Minh',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(parsed)
  }
  const embedded = String(value).match(/(?:T|\s)(\d{1,2}):(\d{2})/u)
  return embedded ? `${String(embedded[1]).padStart(2, '0')}:${embedded[2]}` : ''
}

export const officeAttendanceViewRows = ({ records = [], employees = [], fromDate = '', toDate = '', employeeId = 'all' } = {}) => {
  const employeesById = employeeMap(employees)
  return records
    .filter((record) => !record.deletedAt)
    .map((record) => {
      const id = recordEmployeeId(record)
      const employee = employeesById.get(id)
      const date = officeRecordDate(record)
      const checkIn = formatOfficeTime24(record.checkIn || record.checkInTime || record.checkInAt)
      const checkOut = formatOfficeTime24(record.checkOut || record.checkOutTime || record.checkOutAt)
      const shiftStart = formatOfficeTime24(record.shiftStart || record.startTime || employee?.workStart || employee?.startTime || '08:00')
      const shiftEnd = formatOfficeTime24(record.shiftEnd || record.endTime || employee?.workEnd || employee?.endTime || '17:00')
      const attendanceRecord = { ...record, checkIn, shiftStart }
      const arrivalStatus = officeArrivalStatus(attendanceRecord)
      const { earlyMinutes, lateMinutes } = officeArrivalMinutes(attendanceRecord)
      const startMinutes = timeMinutes(checkIn)
      const endMinutes = timeMinutes(checkOut)
      const calculatedHours = startMinutes == null || endMinutes == null
        ? 0
        : Math.max(0, (endMinutes >= startMinutes ? endMinutes - startMinutes : endMinutes + 1440 - startMinutes) / 60)
      return {
        id: String(record.id || `${id}:${date}:${checkIn}`),
        record,
        employee,
        employeeId: id,
        date,
        checkIn,
        checkOut,
        checkInLocation: record.checkInLocation || record.locationIn || record.locationName || record.location || record.address,
        checkOutLocation: record.checkOutLocation || record.locationOut || record.endLocation || record.checkoutLocation,
        shiftName: record.shiftName || record.shiftSnapshot?.name || record.shift || 'Ca văn phòng',
        shiftStart,
        shiftEnd,
        arrivalStatus,
        departureStatus: normalizeDepartureStatus(record, checkOut),
        earlyMinutes,
        lateMinutes,
        workedHours: Number.isFinite(Number(record.hours)) ? Number(record.hours) : calculatedHours,
      }
    })
    .filter((row) => (
      (!fromDate || row.date >= fromDate)
      && (!toDate || row.date <= toDate)
      && (employeeId === 'all' || sameId(row.employeeId, employeeId) || employeeAliases(row.employee).some((id) => sameId(id, employeeId)))
    ))
    .sort((left, right) => `${right.date}T${right.checkIn}`.localeCompare(`${left.date}T${left.checkIn}`))
}

export const officeAttendanceSummary = (rows = [], evaluation = {}) => officeAttendanceStats(
  rows.map(recordForStats),
  evaluation,
)

export const officeAttendanceStatsByEmployee = ({ rows = [], employees = [], evaluation = {}, employeeId = 'all' } = {}) => employees
  .filter((employee) => employeeId === 'all' || employeeAliases(employee).some((id) => sameId(id, employeeId)))
  .map((employee) => {
    const aliases = new Set(employeeAliases(employee))
    const employeeRows = rows.filter((row) => aliases.has(String(row.employeeId)))
    return { employee, ...officeAttendanceSummary(employeeRows, evaluation) }
  })
