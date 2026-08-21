const normalize = (value) => String(value ?? '').trim().toLocaleLowerCase('vi-VN')

export const officeEmployeeKey = (employee = {}) => String(employee.id || employee.code || employee.employeeCode || '')

export const officePayrollStoreId = (session = {}, employee = {}) => (
  normalize(session?.role) === 'business_support' || normalize(employee?.unit) === 'business_support'
    ? 'BUSINESS_SUPPORT'
    : 'OFFICE'
)

export const officeLocationLabel = (location) => {
  if (!location) return 'Chưa ghi nhận'
  if (typeof location === 'string') return location
  if (location.label || location.address) return String(location.label || location.address)
  const latitude = Number(location.latitude ?? location.lat)
  const longitude = Number(location.longitude ?? location.lng ?? location.lon)
  return Number.isFinite(latitude) && Number.isFinite(longitude)
    ? `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`
    : 'Đã ghi nhận vị trí'
}

export const officeLocationMapUrl = (location) => {
  if (!location) return ''
  const latitude = typeof location === 'object' ? Number(location.latitude ?? location.lat) : Number.NaN
  const longitude = typeof location === 'object' ? Number(location.longitude ?? location.lng ?? location.lon) : Number.NaN
  const hasCoordinates = Number.isFinite(latitude) && latitude >= -90 && latitude <= 90
    && Number.isFinite(longitude) && longitude >= -180 && longitude <= 180
  const query = hasCoordinates
    ? `${latitude}, ${longitude}`
    : typeof location === 'string'
      ? location.trim()
      : String(location.label || location.address || location.name || '').trim()
  return query ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}` : ''
}

export const isOfficeProfile = (session = {}, employee = {}) => {
  session = session || {}
  employee = employee || {}
  const values = [
    session.unit,
    session.department,
    session.storeId,
    employee.unit,
    employee.department,
    employee.unitType,
    employee.storeId,
  ].map(normalize)
  return Boolean(session.isOffice || employee.isOffice || values.some((value) => (
    value === 'office'
    || value === 'văn phòng'
    || value === 'khối văn phòng'
  )))
}

export const officeRecordDate = (record = {}) => String(
  record.date || record.workDate || record.attendanceDate || record.checkInAt || '',
).slice(0, 10)

const timeLabel = (value) => {
  if (!value) return ''
  const match = String(value).match(/(?:T|\s|^)(\d{1,2}):(\d{2})/u)
  if (!match) return ''
  return `${String(match[1]).padStart(2, '0')}:${match[2]}`
}

const minutesFromTime = (value) => {
  const match = timeLabel(value).match(/^(\d{2}):(\d{2})$/u)
  if (!match) return null
  const hour = Number(match[1])
  const minute = Number(match[2])
  return hour <= 23 && minute <= 59 ? hour * 60 + minute : null
}

const arrivalLabel = (record = {}) => {
  const source = normalize(record.arrivalTag || record.punctuality || record.status)
  if (source.includes('trễ')) return 'Đi trễ'
  if (source.includes('sớm')) return 'Đi sớm'
  if (source.includes('đúng')) return 'Đi đúng giờ'
  const actual = minutesFromTime(record.checkIn || record.checkInTime || record.checkInAt)
  const expected = minutesFromTime(record.shiftStart || '08:00')
  if (actual == null || expected == null) return 'Chưa xác định'
  if (actual < expected) return 'Đi sớm'
  return actual === expected ? 'Đi đúng giờ' : 'Đi trễ'
}

const arrivalDifference = (record = {}) => {
  const actual = minutesFromTime(record.checkIn || record.checkInTime || record.checkInAt)
  const expected = minutesFromTime(record.shiftStart || '08:00')
  return actual == null || expected == null ? 0 : actual - expected
}

export const officeAttendanceRows = (records = [], employee = {}) => {
  const employeeId = officeEmployeeKey(employee)
  if (!employeeId) return []
  return records
    .filter((record) => !record.deletedAt && String(record.employeeId || record.employeeCode || record.staffId || '') === employeeId)
    .toSorted((left, right) => String(right.checkInAt || officeRecordDate(right)).localeCompare(String(left.checkInAt || officeRecordDate(left))))
}

export const officeArrivalStatus = (record = {}) => arrivalLabel(record)

export const officeArrivalMinutes = (record = {}) => {
  const label = arrivalLabel(record)
  const difference = arrivalDifference(record)
  if (label === 'Đi sớm') return { earlyMinutes: Math.max(0, -difference), lateMinutes: 0 }
  if (label === 'Đi trễ') {
    const recorded = Number(record.minutesLate)
    return { earlyMinutes: 0, lateMinutes: Number.isFinite(recorded) && recorded >= 0 ? recorded : Math.max(0, difference) }
  }
  return { earlyMinutes: 0, lateMinutes: 0 }
}

export const officeAttendanceStats = (records = [], evaluation = {}) => {
  const stats = records.reduce((result, record) => {
    if (!(record.checkIn || record.checkInTime || record.checkInAt)) return result
    const label = arrivalLabel(record)
    const minutes = officeArrivalMinutes(record)
    result.total += 1
    result.earlyMinutes += minutes.earlyMinutes
    result.lateMinutes += minutes.lateMinutes
    if (label === 'Đi sớm') result.early += 1
    else if (label === 'Đi trễ') result.late += 1
    else if (label === 'Đi đúng giờ') result.onTime += 1
    return result
  }, { total: 0, early: 0, onTime: 0, late: 0, earlyMinutes: 0, lateMinutes: 0 })

  const requestedMaintainMax = Number(evaluation.maintainMaxLateCount)
  const maintainMaxLateCount = Number.isFinite(requestedMaintainMax) && requestedMaintainMax >= 0
    ? Math.trunc(requestedMaintainMax)
    : 2
  const improveLateCount = Math.max(maintainMaxLateCount + 1, Math.trunc(Number(evaluation.improveMinLateCount) || 3))
  const improveLateMinutes = Math.max(1, Number(evaluation.improveMinLateMinutes) || 30)
  stats.onTimeRate = stats.total ? ((stats.early + stats.onTime) / stats.total) * 100 : 0
  stats.rating = !stats.total
    ? 'Chưa có dữ liệu'
    : stats.late === 0
      ? 'Chuyên cần tốt'
      : stats.late >= improveLateCount || stats.lateMinutes >= improveLateMinutes
        ? 'Cần cải thiện'
        : stats.late <= maintainMaxLateCount
          ? 'Cần duy trì'
          : 'Cần theo dõi'
  stats.thresholds = { maintainMaxLateCount, improveLateCount, improveLateMinutes }
  return stats
}

const adjustmentType = (value) => {
  const normalized = normalize(value)
  if (normalized.includes('phụ cấp')) return 'Phụ cấp khác'
  if (normalized.includes('khấu trừ')) return 'Khấu trừ'
  return 'Thưởng khác'
}

const adjustmentEmployee = (item = {}) => String(item.employeeId || item.employeeCode || item.staffId || '')
const adjustmentPeriod = (item = {}) => String(item.period || item.date || item.createdAt || '').slice(0, 7)
const adjustmentNote = (item = {}) => String(item.note || item.content || '').trim()
const adjustmentSignature = (item) => [
  adjustmentEmployee(item),
  adjustmentPeriod(item),
  adjustmentType(item.type || item.kind || item.adjustmentType),
  Number(item.amount || 0),
  normalize(adjustmentNote(item)),
].join('|')

export const officeSalaryAdjustments = ({ salaryAdjustments = [], legacyAdjustments = [], employeeId = '', period = '' } = {}) => {
  const matches = (item) => {
    const status = normalize(item.status)
    return !item.deletedAt
      && !status.includes('hủy')
      && !['cancelled', 'canceled', 'voided'].includes(status)
      && adjustmentEmployee(item) === String(employeeId)
      && adjustmentPeriod(item) === String(period)
  }
  const primary = salaryAdjustments.filter(matches).map((item) => ({
    ...item,
    type: adjustmentType(item.type),
    note: adjustmentNote(item),
    period: adjustmentPeriod(item),
    source: 'salary-adjustment',
  }))
  const primaryIds = new Set(primary.map((item) => String(item.id || '')).filter(Boolean))
  const primarySignatures = new Set(primary.map(adjustmentSignature))
  const legacy = legacyAdjustments.filter(matches).flatMap((item) => {
    if ((item.id && primaryIds.has(String(item.id))) || primarySignatures.has(adjustmentSignature(item))) return []
    return [{
      ...item,
      type: adjustmentType(item.type || item.kind || item.adjustmentType),
      note: adjustmentNote(item),
      period: adjustmentPeriod(item),
      source: 'legacy-office-adjustment',
    }]
  })
  return [...primary, ...legacy].toSorted((left, right) => String(right.createdAt || right.date || '').localeCompare(String(left.createdAt || left.date || '')))
}

export const officeAdjustmentTotals = (items = []) => items.reduce((totals, item) => {
  const amount = Math.max(0, Number(item.amount) || 0)
  const type = adjustmentType(item.type)
  if (type === 'Thưởng khác') totals.bonus += amount
  if (type === 'Phụ cấp khác') totals.allowance += amount
  if (type === 'Khấu trừ') totals.deduction += amount
  totals.net = totals.bonus + totals.allowance - totals.deduction
  return totals
}, { bonus: 0, allowance: 0, deduction: 0, net: 0 })

const validWorkDays = (value) => {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 31 ? parsed : 0
}

export const editableOfficeWorkdayTarget = ({ employee = {}, period = '', fallback = 26 } = {}) => {
  const monthlyTarget = validWorkDays(employee.monthlyWorkdayTargets?.[period])
  if (monthlyTarget) return monthlyTarget
  if (String(employee.standardWorkDaysPeriod || '') === String(period)) {
    const matchingDefault = validWorkDays(employee.standardWorkDays)
    if (matchingDefault) return matchingDefault
  }
  return validWorkDays(fallback) || 26
}

export const requiredOfficeWorkingDays = ({ records = [], employee = {}, period = '' } = {}) => {
  const monthlyTargets = employee.monthlyWorkdayTargets && typeof employee.monthlyWorkdayTargets === 'object'
    ? employee.monthlyWorkdayTargets
    : {}
  const monthlyTarget = validWorkDays(monthlyTargets[period])
  if (monthlyTarget) return { days: monthlyTarget, source: 'monthly-target' }
  const snapshot = records.map((record) => validWorkDays(record.requiredWorkingDaysSnapshot || record.standardWorkDaysSnapshot)).find(Boolean)
  if (snapshot) return { days: snapshot, source: 'snapshot' }
  const employeeDays = validWorkDays(employee.standardWorkDays)
  return { days: employeeDays || 26, source: employeeDays ? 'employee' : 'fallback' }
}

export const officePayrollSummary = ({ records = [], employee = {}, period = '', historical = false, payrollRow = null } = {}) => {
  if (payrollRow && typeof payrollRow === 'object') {
    const requiredDays = validWorkDays(payrollRow.requiredWorkingDays || payrollRow.salarySnapshot?.standardWorkDays) || 26
    const actualDays = Math.max(0, Number(payrollRow.workedDays) || 0)
    const monthlySalary = Math.max(0, Number(payrollRow.salarySnapshot?.monthlySalary || employee.monthlySalary || employee.salary) || 0)
    const basePay = Math.max(0, Number(payrollRow.baseSalary) || 0)
    const gross = Math.max(0, Number(payrollRow.gross ?? basePay) || 0)
    return {
      actualDays,
      requiredDays,
      requiredDaysSource: 'closed-payroll',
      monthlySalary,
      payableDays: Math.min(actualDays, requiredDays),
      ratio: requiredDays ? Math.min(actualDays, requiredDays) / requiredDays : 0,
      basePay,
      gross,
      authoritative: true,
    }
  }
  const actualDays = new Set(records
    .filter((record) => {
      if (record.workdayCredit != null) return Number(record.workdayCredit) >= 1
      return Boolean(record.checkOut || record.checkOutTime || record.checkOutAt)
    })
    .map(officeRecordDate)
    .filter(Boolean)).size
  const required = requiredOfficeWorkingDays({ records, employee, period })
  const snapshotSalary = historical
    ? records.map((record) => Number(record.monthlySalarySnapshot)).find((value) => Number.isFinite(value) && value > 0)
    : 0
  const monthlySalary = snapshotSalary || Number(employee.monthlySalary || employee.salary || 0)
  const payableDays = Math.min(actualDays, required.days)
  return {
    actualDays,
    requiredDays: required.days,
    requiredDaysSource: required.source,
    monthlySalary,
    payableDays,
    ratio: required.days ? payableDays / required.days : 0,
    basePay: required.days ? Math.floor((monthlySalary / required.days) * payableDays) : 0,
    gross: null,
    authoritative: false,
  }
}

export const officeAttendanceInternals = Object.freeze({ arrivalLabel, minutesFromTime, timeLabel, validWorkDays })
