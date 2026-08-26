import {
  calculateTieredHourlyPay,
  defaultStoreTieredRates,
  effectiveStoreSalaryConfig,
  isHourlyStoreEmploymentType,
  normalizeStoreEmploymentType,
} from './domain/storeTieredPayroll'

export const money = (value) => `${new Intl.NumberFormat('en-US').format(Number(value) || 0)} đ`

export const parseMoneyInput = (value) => Number(String(value ?? '').replace(/\D/gu, '')) || 0

export const formatMoneyInput = (value) => {
  const amount = parseMoneyInput(value)
  return amount ? new Intl.NumberFormat('en-US').format(amount) : ''
}

export const number = (value, digits = 0) =>
  new Intl.NumberFormat('vi-VN', { maximumFractionDigits: digits }).format(Number(value) || 0)

export const getEmployeeType = (employee = {}) => {
  const value = String(employee.employmentType || employee.employeeType || employee.type || 'Full-Time').trim()
  if (/part[- ]?time/iu.test(value)) return 'Part-Time'
  if (/full[- ]?time/iu.test(value)) return 'Full-Time'
  return value
}

export const getPayBasis = (employee = {}) => {
  const value = String(employee.payBasis || employee.salaryBasis || employee.salaryType || employee.salaryUnit || '').toLowerCase()
  if (['tiered-hourly', 'tiered_hourly', 'store_full_time_tiered'].includes(value)
    || String(employee.payFormula || '').trim().toUpperCase() === 'STORE_FULL_TIME_TIERED') return 'tiered-hourly'
  if (['hourly', 'hour', 'gio', 'giờ'].includes(value)) return 'hourly'
  if (['monthly', 'month', 'thang', 'tháng'].includes(value)) return 'monthly'
  if (value === 'legacy') return 'legacy'
  const employmentType = getEmployeeType(employee)
  if (isHourlyStoreEmploymentType(employmentType)) return 'hourly'
  const unit = String(employee.unit || employee.unitType || '').trim().toLowerCase()
  if (normalizeStoreEmploymentType(employmentType) === 'Full-Time' && unit === 'store') return 'tiered-hourly'
  return 'monthly'
}

export const getMonthlySalary = (employee = {}) => {
  const explicit = Number(employee.monthlySalary)
  if (Number.isFinite(explicit) && explicit > 0) return explicit
  const baseSalary = Number(employee.baseSalary)
  if (Number.isFinite(baseSalary) && baseSalary > 0) return baseSalary
  return getPayBasis(employee) === 'monthly' ? Math.max(0, Number(employee.salary) || 0) : 0
}

export const getHourlyRate = (employee = {}) => {
  if (getPayBasis(employee) === 'tiered-hourly') {
    const standardRate = Number(employee.standardHourlyRateVnd || employee.regularHourlyRateVnd)
    return Number.isFinite(standardRate) && standardRate > 0 ? standardRate : 0
  }
  const explicit = Number(employee.hourlyRate)
  if (Number.isFinite(explicit) && explicit > 0) return explicit
  return getPayBasis(employee) === 'hourly' ? Math.max(0, Number(employee.salary) || 0) : 0
}

export const usesMonthlyHoursFormula = (employee = {}) => (
  getEmployeeType(employee) === 'Full-Time'
  && String(employee.payFormula || '').trim().toLowerCase() === 'monthly-hours'
  && Number(employee.requiredMonthlyHours) > 0
)

const isStoreFullTimeEmployee = (employee = {}, store = null) => {
  if (!store || normalizeStoreEmploymentType(getEmployeeType(employee)) !== 'Full-Time') return false
  const unit = String(employee.unit || employee.unitType || '').trim().toLowerCase()
  return !unit || unit === 'store'
}

export const resolveStoreEmployeeSalaryPolicy = (employee = {}, {
  store = null,
  salaryConfig = null,
  salaryConfigs = [],
  period = '',
} = {}) => {
  if (!isStoreFullTimeEmployee(employee, store) && getPayBasis(employee) !== 'tiered-hourly') return null
  const employeeId = String(employee.id || employee.code || employee.employeeId || '').trim()
  let policy = salaryConfig || employee.salaryConfig || employee.salaryConfigSnapshot || null
  if (!policy && employeeId && store?.id && period) {
    try {
      policy = effectiveStoreSalaryConfig(salaryConfigs, {
        employeeId,
        storeId: store.id,
        period,
        store,
      })
    } catch {
      policy = null
    }
  }
  if (!policy && store) {
    try {
      policy = defaultStoreTieredRates(store)
    } catch {
      policy = null
    }
  }
  if (!policy) return null
  const standardHourlyRateVnd = Number(policy.standardHourlyRateVnd ?? policy.regularHourlyRateVnd)
  const excessHourlyRateVnd = Number(policy.excessHourlyRateVnd)
  if (![standardHourlyRateVnd, excessHourlyRateVnd].every((value) => Number.isSafeInteger(value) && value > 0)) return null
  return {
    ...policy,
    thresholdHours: Number(policy.thresholdHours) || 208,
    standardHourlyRateVnd,
    excessHourlyRateVnd,
  }
}

export const calculateEmployeeBasePay = (employee = {}, {
  hours = 0,
  workedDays = 0,
  prorateMonthly = false,
  salaryConfig = null,
  salaryConfigs = [],
  store = null,
  period = '',
} = {}) => {
  const tieredPolicy = resolveStoreEmployeeSalaryPolicy(employee, {
    store,
    salaryConfig,
    salaryConfigs,
    period,
  })
  if (tieredPolicy) {
    return calculateTieredHourlyPay({
      workedHours: Math.max(0, Number(hours) || 0),
      thresholdHours: tieredPolicy.thresholdHours,
      standardHourlyRateVnd: tieredPolicy.standardHourlyRateVnd,
      excessHourlyRateVnd: tieredPolicy.excessHourlyRateVnd,
    }).amountVnd
  }
  if (getPayBasis(employee) === 'hourly') return Math.round(Math.max(0, Number(hours) || 0) * getHourlyRate(employee))
  const monthlySalary = getMonthlySalary(employee)
  if (usesMonthlyHoursFormula(employee)) {
    return Math.floor((Math.max(0, Number(hours) || 0) / Number(employee.requiredMonthlyHours)) * monthlySalary)
  }
  if (!prorateMonthly) return monthlySalary
  const standardWorkDays = Math.max(1, Number(employee.standardWorkDays) || 26)
  return Math.round((monthlySalary / standardWorkDays) * Math.max(0, Number(workedDays) || 0))
}

export const salaryBasisLabel = (employee = {}) => {
  const basis = getPayBasis(employee)
  if (basis === 'tiered-hourly') return 'Theo giờ lũy tiến'
  if (basis === 'hourly') return 'Theo giờ'
  if (basis === 'monthly') return 'Theo tháng'
  return 'Chưa thiết lập'
}

export const downloadCsv = (name, rows) => {
  if (!rows?.length) return
  const headers = Object.keys(rows[0])
  const escape = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`
  const csv = `\uFEFF${headers.map(escape).join(',')}\n${rows
    .map((row) => headers.map((header) => escape(row[header])).join(','))
    .join('\n')}`
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  URL.revokeObjectURL(url)
}

let uidSequence = 0

const vietnamDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Ho_Chi_Minh',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

const formatVietnamDate = (date) => {
  const parts = Object.fromEntries(vietnamDateFormatter.formatToParts(date).map((part) => [part.type, part.value]))
  return `${parts.year}-${parts.month}-${parts.day}`
}

export const uid = (prefix = 'ID') => {
  uidSequence = (uidSequence + 1) % 1000
  return `${prefix}${Date.now().toString(36).toUpperCase()}${String(uidSequence).padStart(3, '0')}`
}

export const businessDate = (value) => {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? '' : formatVietnamDate(value)
  const source = String(value ?? '').trim()
  if (!source) return ''
  if (/^\d{4}-\d{2}-\d{2}$/u.test(source)) return source
  const explicitZone = /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:?\d{2})$/iu.test(source)
  if (explicitZone) {
    const parsed = new Date(source)
    if (!Number.isNaN(parsed.getTime())) return formatVietnamDate(parsed)
  }
  return source.match(/^\d{4}-\d{2}-\d{2}/u)?.[0] || ''
}

export const today = (date = new Date()) => businessDate(date)

export const shortDate = (iso) => {
  if (!iso) return ''
  const [year, month, day] = businessDate(iso).split('-')
  return year && month && day ? `${day}/${month}/${year.slice(-2)}` : String(iso)
}

const vietnamTimeFormatter = new Intl.DateTimeFormat('vi-VN', {
  timeZone: 'Asia/Ho_Chi_Minh',
  hourCycle: 'h23',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
})

export const shortDateTime24 = (value) => {
  if (!value) return '—'
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  return `${shortDate(date)} ${vietnamTimeFormatter.format(date)}`
}

export const validateCccd = (value) => /^\d{12}$/.test(String(value ?? '').trim())

export const normalizePhone = (value) => {
  let digits = String(value ?? '').trim().replace(/\D/g, '')
  if (digits.startsWith('0084')) digits = digits.slice(2)
  if (digits.startsWith('84') && digits.length === 11) digits = `0${digits.slice(2)}`
  return digits
}

export const validateVietnamPhone = (value) =>
  /^0(?:3[2-9]|5[2689]|7[06-9]|8[1-689]|9\d)\d{7}$/.test(normalizePhone(value))

export const buildAddress = (detailsOrStreet, ward, province) => {
  if (typeof detailsOrStreet === 'string') {
    return [detailsOrStreet, ward, province].map((item) => String(item ?? '').trim()).filter(Boolean).join(', ')
  }

  const record = detailsOrStreet || {}
  if (typeof record.address === 'string' && !record.street && !record.addressDetails) return record.address.trim()
  const details = record.addressDetails || (typeof record.address === 'object' ? record.address : null) || record
  const streetValue = details.street || details.addressStreet || record.street || record.addressStreet || ''
  const wardValue = details.ward || details.addressWard || record.ward || record.addressWard || ''
  const provinceValue = details.province || details.provinceCity || details.addressProvince || record.province || record.addressProvince || ''
  return [streetValue, wardValue, provinceValue].map((item) => String(item).trim()).filter(Boolean).join(', ')
}

export const timeToMinutes = (value) => {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.getHours() * 60 + value.getMinutes()
  const source = String(value ?? '').trim()
  const match = source.match(/(?:^|T|\s)(\d{1,2}):(\d{2})/)
  if (!match) return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours > 23 || minutes > 59) return null
  return hours * 60 + minutes
}

export const getArrivalTag = (actualTime, scheduledTime, toleranceMinutes = 5) => {
  const actual = timeToMinutes(actualTime)
  const scheduled = timeToMinutes(scheduledTime)
  if (actual == null || scheduled == null) return 'Chưa xác định'
  const difference = actual - scheduled
  if (difference < 0) return 'Đi sớm'
  if (difference <= Math.abs(toleranceMinutes)) return 'Đi đúng giờ'
  return 'Đi trễ'
}

export const getDepartureTag = (actualTime, scheduledTime, toleranceMinutes = 5) => {
  const actual = timeToMinutes(actualTime)
  const scheduled = timeToMinutes(scheduledTime)
  if (actual == null || scheduled == null) return 'Chưa xác định'
  let difference = actual - scheduled
  if (difference < -12 * 60) difference += 24 * 60
  if (difference > 12 * 60) difference -= 24 * 60
  if (difference < -Math.abs(toleranceMinutes)) return 'Về sớm'
  if (difference <= Math.abs(toleranceMinutes)) return 'Đúng giờ'
  return 'Về trễ'
}

export const calculateWorkedHours = (checkIn, checkOut) => {
  if (!checkIn || !checkOut) return 0
  const checkInTimestamp = checkIn instanceof Date ? checkIn.getTime() : Date.parse(checkIn)
  const checkOutTimestamp = checkOut instanceof Date ? checkOut.getTime() : Date.parse(checkOut)
  if (Number.isFinite(checkInTimestamp) && Number.isFinite(checkOutTimestamp)) {
    return Math.max(0, Math.round(((checkOutTimestamp - checkInTimestamp) / 3600000) * 100) / 100)
  }

  const start = timeToMinutes(checkIn)
  const end = timeToMinutes(checkOut)
  if (start == null || end == null) return 0
  const elapsedMinutes = end >= start ? end - start : end + 24 * 60 - start
  return Math.round((elapsedMinutes / 60) * 100) / 100
}

export const normalizeLocation = (location, fallbackLabel = '') => {
  if (!location && !fallbackLabel) return null
  if (typeof location === 'string') {
    return { latitude: null, longitude: null, accuracy: null, label: location }
  }

  const source = location?.coords || location || {}
  const latitude = Number(source.latitude ?? source.lat)
  const longitude = Number(source.longitude ?? source.lng ?? source.lon)
  const accuracy = Number(source.accuracy)
  const label = location?.label || location?.name || location?.address || source.label || fallbackLabel || ''
  return {
    latitude: Number.isFinite(latitude) ? latitude : null,
    longitude: Number.isFinite(longitude) ? longitude : null,
    accuracy: Number.isFinite(accuracy) ? accuracy : null,
    label,
  }
}

export const fileToDataUrl = (file) => new Promise((resolve, reject) => {
  if (typeof file === 'string') {
    resolve(file)
    return
  }
  if (!file) {
    reject(new Error('Không có tệp để đọc.'))
    return
  }
  if (typeof FileReader === 'undefined') {
    reject(new Error('Trình duyệt không hỗ trợ đọc tệp.'))
    return
  }
  const reader = new FileReader()
  reader.onload = () => resolve(String(reader.result || ''))
  reader.onerror = () => reject(reader.error || new Error('Không thể đọc tệp.'))
  reader.readAsDataURL(file)
})

export const attendanceHelpers = {
  timeToMinutes,
  getArrivalTag,
  getDepartureTag,
  calculateWorkedHours,
  normalizeLocation,
}
