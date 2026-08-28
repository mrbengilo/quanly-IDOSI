const VIETNAM_DATE_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Ho_Chi_Minh',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

const vietnamDate = (date) => {
  const parts = Object.fromEntries(VIETNAM_DATE_FORMATTER.formatToParts(date).map(({ type, value }) => [type, value]))
  return `${parts.year}-${parts.month}-${parts.day}`
}

export const recordBusinessDate = (record = {}) => {
  const explicitDate = String(record.workDate || record.attendanceDate || record.date || '').trim()
  if (/^\d{4}-\d{2}-\d{2}$/u.test(explicitDate)) return explicitDate
  const source = String(record.occurredAt || record.createdAt || '').trim()
  if (/^\d{4}-\d{2}-\d{2}$/u.test(source)) return source
  const timestamp = Date.parse(source)
  return Number.isFinite(timestamp) ? vietnamDate(new Date(timestamp)) : source.slice(0, 10)
}

export const isNonNegativeSafeIntegerAmount = (value) => {
  const amount = Number(value)
  return Number.isSafeInteger(amount) && amount >= 0
}

export const scheduleShiftIds = (record = {}) => {
  const values = Array.isArray(record.shiftIds) && record.shiftIds.length
    ? record.shiftIds
    : record.shiftId ? [record.shiftId] : []
  return [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))]
}

export const normalizeClock = (value) => {
  if (typeof value !== 'string') return ''
  const match = value.trim().match(/^(\d{1,2}):([0-5]\d)$/u)
  if (!match) return ''
  const hour = Number(match[1])
  if (hour > 23) return ''
  return `${String(hour).padStart(2, '0')}:${match[2]}`
}

export const clockMinuteOfDay = (value) => {
  const clock = normalizeClock(value)
  if (!clock) return null
  const [hour, minute] = clock.split(':').map(Number)
  return (hour * 60) + minute
}

export const employeeIdentifierAliases = (employee = {}) => [...new Set([
  employee.id, employee.code, employee.employeeId, employee.employeeCode,
].filter((value) => typeof value === 'string').map((value) => value.trim()).filter(Boolean))]

export const canonicalEmployeeIdentity = (employee = {}) => employeeIdentifierAliases(employee)[0] || ''

export const attendanceCheckIn = (attendance = {}) => (
  attendance.checkInAt || attendance.checkIn || attendance.checkInTime || null
)

export const attendanceCheckOut = (attendance = {}) => (
  attendance.checkOutAt || attendance.checkOut || attendance.checkOutTime || null
)

export const attendanceHasCheckOut = (attendance = {}) => Boolean(attendanceCheckOut(attendance))

export const resolveRecordEmployee = (record = {}, employees = []) => {
  const identifiers = [
    ['employeeId', record.employeeId],
    ['employeeCode', record.employeeCode],
  ].filter(([, value]) => typeof value === 'string' && value.trim()).map(([field, value]) => [field, value.trim()])
  if (!identifiers.length) return { status: 'missing', code: 'EMPLOYEE_IDENTIFIER_MISSING', employee: null }
  const resolved = identifiers.map(([field, identifier]) => {
    const matches = (Array.isArray(employees) ? employees : []).filter((employee) => (
      employeeIdentifierAliases(employee).includes(identifier)
    ))
    return { field, identifier, matches }
  })
  const ambiguous = resolved.find(({ matches }) => matches.length > 1)
  if (ambiguous) return { status: 'ambiguous', code: 'EMPLOYEE_IDENTIFIER_AMBIGUOUS', employee: null,
    field: ambiguous.field, identifier: ambiguous.identifier }
  const unknown = resolved.find(({ matches }) => matches.length === 0)
  if (unknown) return { status: 'unknown', code: 'EMPLOYEE_IDENTIFIER_UNKNOWN', employee: null,
    field: unknown.field, identifier: unknown.identifier }
  const employee = resolved[0].matches[0]
  if (resolved.some(({ matches }) => matches[0] !== employee)) {
    return { status: 'conflict', code: 'EMPLOYEE_IDENTIFIER_CONFLICT', employee: null }
  }
  return { status: 'resolved', code: 'EMPLOYEE_IDENTIFIER_RESOLVED', employee }
}
