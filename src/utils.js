export const money = (value) => `${new Intl.NumberFormat('vi-VN').format(Number(value) || 0)} đ`

export const number = (value, digits = 0) =>
  new Intl.NumberFormat('vi-VN', { maximumFractionDigits: digits }).format(Number(value) || 0)

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

export const uid = (prefix = 'ID') => {
  uidSequence = (uidSequence + 1) % 1000
  return `${prefix}${Date.now().toString(36).toUpperCase()}${String(uidSequence).padStart(3, '0')}`
}

export const today = (date = new Date()) => {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export const shortDate = (iso) => {
  if (!iso) return ''
  const [year, month, day] = String(iso).slice(0, 10).split('-')
  return year && month && day ? `${day}/${month}/${year}` : String(iso)
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
  if (difference < -Math.abs(toleranceMinutes)) return 'Đi sớm'
  if (difference <= Math.abs(toleranceMinutes)) return 'Đúng giờ'
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

