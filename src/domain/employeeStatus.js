// Canonical store-employee working status shared by the HTKD/Admin UI and the
// client-side permission mirror. Stored values stay the historical canonical
// strings (server `employeeStatusValues`); "Đã nghỉ làm" is only the label.

export const EMPLOYEE_STATUS = Object.freeze({
  ACTIVE: 'Đang làm việc',
  PAUSED: 'Tạm ngưng',
  DEPARTED: 'Đã nghỉ việc',
})

const statusKey = (value) => String(value ?? '')
  .normalize('NFD')
  .replace(/[̀-ͯ]/gu, '')
  .replace(/[đĐ]/gu, 'd')
  .toLocaleLowerCase('vi-VN')
  .trim()

const ACTIVE_KEYS = new Set(['', 'active', 'dang lam viec', 'dang hoat dong'])
const PAUSED_KEYS = new Set(['locked', 'tam ngung', 'tam nghi'])
const DEPARTED_KEYS = new Set(['inactive', 'da nghi viec', 'da nghi lam'])

// Unknown values are returned unchanged so they are never silently coerced to
// "Đang làm việc" when a form is opened and saved.
export const canonicalEmployeeStatus = (value) => {
  const key = statusKey(value)
  if (ACTIVE_KEYS.has(key)) return EMPLOYEE_STATUS.ACTIVE
  if (PAUSED_KEYS.has(key)) return EMPLOYEE_STATUS.PAUSED
  if (DEPARTED_KEYS.has(key)) return EMPLOYEE_STATUS.DEPARTED
  return String(value)
}

export const isDepartedEmployeeStatus = (value) => canonicalEmployeeStatus(value) === EMPLOYEE_STATUS.DEPARTED

export const employeeStatusLabel = (value) => {
  const status = canonicalEmployeeStatus(value)
  if (status === EMPLOYEE_STATUS.DEPARTED) return 'Đã nghỉ làm'
  return status
}

export const employeeStatusTone = (value) => {
  const status = canonicalEmployeeStatus(value)
  if (status === EMPLOYEE_STATUS.ACTIVE) return 'green'
  if (status === EMPLOYEE_STATUS.DEPARTED) return 'red'
  return 'orange'
}

// Mirrors the server rule: Admin manages every status; HTKD may mark a store
// employee as departed (never reactivate); store managers cannot depart anyone.
export const employeeStatusChangePermission = ({ actorRole, unit, from, to }) => {
  const previous = canonicalEmployeeStatus(from)
  const next = canonicalEmployeeStatus(to)
  if (previous === next) return { ok: true }
  if (actorRole === 'admin') return { ok: true }
  if (previous === EMPLOYEE_STATUS.DEPARTED) {
    return { ok: false, code: 'EMPLOYEE_REACTIVATE_FORBIDDEN', message: 'Chỉ Admin được khôi phục nhân viên đã nghỉ làm.' }
  }
  if (next === EMPLOYEE_STATUS.DEPARTED && !(actorRole === 'business_support' && String(unit || '').toLowerCase() === 'store')) {
    return { ok: false, code: 'EMPLOYEE_DELETE_FORBIDDEN', message: 'Chỉ Admin hoặc Hỗ trợ KD (với nhân viên cửa hàng) được cho nhân viên nghỉ làm.' }
  }
  return { ok: true }
}

// Options shown in the status field for one actor and current value. A legacy
// "Tạm ngưng" stays selectable while it is the current value only.
export const employeeStatusOptions = ({ actorRole, current }) => {
  const status = canonicalEmployeeStatus(current)
  const base = [EMPLOYEE_STATUS.ACTIVE, EMPLOYEE_STATUS.DEPARTED]
  const withLegacy = actorRole === 'admin' || status === EMPLOYEE_STATUS.PAUSED
    ? [EMPLOYEE_STATUS.ACTIVE, EMPLOYEE_STATUS.PAUSED, EMPLOYEE_STATUS.DEPARTED]
    : base
  const values = withLegacy.includes(status) ? withLegacy : [status, ...withLegacy]
  return values.map((value) => ({ value, label: employeeStatusLabel(value) }))
}
