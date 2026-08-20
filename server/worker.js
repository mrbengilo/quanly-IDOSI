const API_PREFIX = '/api/'
const MAX_JSON_BYTES = 16 * 1024 * 1024
const MAX_COMPACT_STATE_BYTES = 1_500_000
const MAX_STATE_ENTITY_BYTES = 1_500_000
const MAX_STATE_BATCH_JSON_BYTES = 1_400_000
const MAX_AUDIT_JSON_BYTES = 350_000
const MAX_RECEIPT_INLINE_BYTES = 1_500_000
const MAX_RECEIPT_CHUNK_BYTES = 1_500_000
const STATE_ENTITY_ORDER_STEP = 1_000_000
const STATE_ENTITY_PAGE_SIZE = 10_000
const MAX_AVATAR_BYTES = 200 * 1024
const MAX_IDENTITY_IMAGE_BYTES = 2 * 1024 * 1024
const MAX_JSON_DEPTH = 64
const MAX_MONEY_VND = 100_000_000_000
const DEFAULT_SESSION_TTL_SECONDS = 12 * 60 * 60
const DEFAULT_PBKDF2_ITERATIONS = 100_000
const MIN_PBKDF2_ITERATIONS = 100_000
const MAX_PBKDF2_ITERATIONS = 100_000
const VALID_ROLES = new Set(['admin', 'business_support', 'store_manager', 'employee'])
const VALID_ACCOUNT_STATUSES = new Set(['active', 'locked', 'inactive'])
const BUSINESS_SUPPORT_STORE_ID = 'BUSINESS_SUPPORT'
const OFFICE_STORE_ID = 'OFFICE'
const OPERATIONS_ROLES = new Set(['admin', 'business_support', 'store_manager'])
const BUSINESS_SUPPORT_SELF_SERVICE_COMMANDS = new Set([
  'attendance.check_in',
  'attendance.check_out',
  'account_settings.update',
  'notification.mark_read',
  'notification.mark_all_read',
  'notification.clear',
  'notification.clear_all',
  'user.change_password',
])
const BUSINESS_SUPPORT_DOMAIN_COMMANDS = new Set([
  'store.update',
  'employee.create',
  'employee.update',
  'shift_definition.create',
  'shift_definition.update',
  'shift_definition.delete',
  'schedule.assign',
  'schedule.replace_day',
  'tasks.assign',
  'tasks.replace_scope',
  'fixed_expense.create',
  'fixed_expense.update',
  'fixed_expense.delete',
  'expense.create',
  'expense.update',
  'expense.delete',
  'import.create',
  'import.update',
  'import.delete',
  'import_voucher.create',
  'import_voucher.update',
  'import_voucher.delete',
  'salary_adjustment.create',
  'salary_advance.create',
  'salary_advance.update',
  'salary_advance.confirm',
  'payroll.close',
  'payroll.pay',
  'payroll.lock',
  'attendance.update',
  'order.update',
  'order.delete',
  'policy.set',
  'policies.set',
  'operational_reset.restore',
  'support_transfer.create',
  'support_transfer.update',
  'support_transfer.delete',
  'support_work.update',
])
const ADDRESS_SUGGESTION_TYPES = new Set(['province', 'ward', 'street'])
const ADDRESS_SUGGESTION_RATE_LIMIT = 30
const ADDRESS_SUGGESTION_RATE_WINDOW_MS = 60_000
const MAX_LEGACY_ATTENDANCE_AUDITS = 10_000
const addressSuggestionRateWindows = new Map()

const DEFAULT_POLICIES = Object.freeze({
  late_tolerance_minutes: 10,
  early_check_in_limit_minutes: 120,
  attendance_maintain_max_late_count: 2,
  attendance_improve_min_late_count: 3,
  attendance_improve_min_late_minutes: 30,
  employee_kpi_percent_30000: 5,
  employee_kpi_percent_15000: 3,
  employee_kpi_percent_7000: 1,
})

class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.details = details
  }
}

const textEncoder = new TextEncoder()

const toBase64Url = (bytes) => {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '')
}

const fromBase64Url = (value) => {
  const normalized = String(value).replaceAll('-', '+').replaceAll('_', '/')
  const padding = '='.repeat((4 - (normalized.length % 4)) % 4)
  const binary = atob(`${normalized}${padding}`)
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

const decodeIdentityImage = (value, side) => {
  const source = String(value || '')
  const match = source.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/u)
  if (!match) {
    throw new ApiError(400, 'IDENTITY_IMAGE_INVALID', 'Ảnh CCCD phải là ảnh JPEG, PNG hoặc WebP mã hóa base64 hợp lệ.', { side })
  }
  if (match[2].length > Math.ceil(MAX_IDENTITY_IMAGE_BYTES / 3) * 4 + 4) {
    throw new ApiError(413, 'IDENTITY_IMAGE_TOO_LARGE', 'Mỗi ảnh CCCD không được vượt quá 2 MiB.', { side })
  }
  let bytes
  try {
    const binary = atob(match[2])
    bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
  } catch {
    throw new ApiError(400, 'IDENTITY_IMAGE_INVALID', 'Dữ liệu ảnh CCCD không hợp lệ.', { side })
  }
  if (!bytes.length || bytes.byteLength > MAX_IDENTITY_IMAGE_BYTES) {
    throw new ApiError(bytes.length ? 413 : 400, bytes.length ? 'IDENTITY_IMAGE_TOO_LARGE' : 'IDENTITY_IMAGE_INVALID', bytes.length
      ? 'Mỗi ảnh CCCD không được vượt quá 2 MiB.'
      : 'Ảnh CCCD không được để trống.', { side })
  }
  const type = match[1]
  const validSignature = type === 'image/jpeg'
    ? bytes[0] === 0xff && bytes[1] === 0xd8 && bytes.at(-2) === 0xff && bytes.at(-1) === 0xd9
    : (type === 'image/png'
        ? [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((byte, index) => bytes[index] === byte)
        : bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
          && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50)
  if (!validSignature) {
    throw new ApiError(400, 'IDENTITY_IMAGE_INVALID', 'Nội dung ảnh CCCD không khớp định dạng đã khai báo.', { side })
  }
  const extension = type === 'image/jpeg' ? 'jpg' : type.slice('image/'.length)
  return { bytes, contentType: type, extension }
}

const randomBytes = (length) => {
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  return bytes
}

const constantTimeEqual = (left, right) => {
  const leftBytes = left instanceof Uint8Array ? left : textEncoder.encode(String(left))
  const rightBytes = right instanceof Uint8Array ? right : textEncoder.encode(String(right))
  const length = Math.max(leftBytes.length, rightBytes.length)
  let difference = leftBytes.length ^ rightBytes.length
  for (let index = 0; index < length; index += 1) {
    difference |= (leftBytes[index] || 0) ^ (rightBytes[index] || 0)
  }
  return difference === 0
}

const derivePasswordBytes = async (password, salt, iterations) => {
  const key = await crypto.subtle.importKey(
    'raw',
    textEncoder.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits'],
  )
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    key,
    256,
  )
  return new Uint8Array(bits)
}

export const hashPassword = async (password, options = {}) => {
  const source = String(password || '')
  if (source.length < 8 || source.length > 256) {
    throw new ApiError(400, 'INVALID_PASSWORD', 'Mật khẩu phải có từ 8 đến 256 ký tự.')
  }
  const iterations = Number(options.iterations || DEFAULT_PBKDF2_ITERATIONS)
  if (!Number.isInteger(iterations) || iterations < MIN_PBKDF2_ITERATIONS || iterations > MAX_PBKDF2_ITERATIONS) {
    throw new ApiError(500, 'INVALID_PASSWORD_POLICY', 'Cấu hình băm mật khẩu không hợp lệ.')
  }
  const salt = options.salt ? fromBase64Url(options.salt) : randomBytes(16)
  const digest = await derivePasswordBytes(source, salt, iterations)
  return {
    hash: toBase64Url(digest),
    salt: toBase64Url(salt),
    iterations,
    algorithm: 'PBKDF2-SHA256',
  }
}

export const verifyPassword = async (password, record) => {
  try {
    const iterations = Number(record?.iterations)
    if (!Number.isInteger(iterations) || iterations < MIN_PBKDF2_ITERATIONS || iterations > MAX_PBKDF2_ITERATIONS) return false
    const salt = fromBase64Url(record.salt)
    const expected = fromBase64Url(record.hash)
    const actual = await derivePasswordBytes(String(password || ''), salt, iterations)
    return constantTimeEqual(actual, expected)
  } catch {
    return false
  }
}

const sha256 = async (value) => {
  const digest = await crypto.subtle.digest('SHA-256', textEncoder.encode(String(value)))
  return toBase64Url(new Uint8Array(digest))
}

const normalizeUsername = (value) => String(value || '').trim().toLocaleLowerCase('vi-VN')
const isPlainRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
const parseStoredJson = (value, fallback = null) => {
  try {
    return JSON.parse(value)
  } catch {
    return fallback
  }
}

const localDateTimeParts = (isoTimestamp) => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(isoTimestamp)).map(({ type, value }) => [type, value]))
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
    seconds: `${parts.hour}:${parts.minute}:${parts.second}`,
    minuteOfDay: (Number(parts.hour) * 60) + Number(parts.minute),
  }
}

const parseShiftTime = (value) => {
  const match = String(value || '').trim().match(/^(\d{1,2}):(\d{2})$/u)
  if (!match) return null
  const hour = Number(match[1])
  const minute = Number(match[2])
  if (hour > 23 || minute > 59) return null
  return { label: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`, minuteOfDay: (hour * 60) + minute }
}

const shiftTimes = (shift) => {
  const range = String(shift?.time || '').split(/[–—-]/u).map((part) => part.trim())
  const start = parseShiftTime(shift?.start || range[0])
  const end = parseShiftTime(shift?.end || range[1])
  return { start, end }
}

const normalizeLocation = (value, serverTimestamp) => {
  if (!isPlainRecord(value)) {
    throw new ApiError(400, 'LOCATION_REQUIRED', 'Cần cấp quyền vị trí để ghi nhận chấm công.')
  }
  const latitude = Number(value.latitude ?? value.lat)
  const longitude = Number(value.longitude ?? value.lng ?? value.lon)
  const accuracy = value.accuracy == null ? null : Number(value.accuracy)
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90
    || !Number.isFinite(longitude) || longitude < -180 || longitude > 180
    || (accuracy !== null && (!Number.isFinite(accuracy) || accuracy < 0 || accuracy > 100_000))) {
    throw new ApiError(400, 'LOCATION_INVALID', 'Tọa độ chấm công không hợp lệ.')
  }
  return {
    latitude,
    longitude,
    accuracy,
    label: String(value.label || '').trim().slice(0, 160) || null,
    capturedAt: serverTimestamp,
  }
}

const canonicalize = (value, depth = 0) => {
  if (depth > MAX_JSON_DEPTH) throw new ApiError(400, 'JSON_TOO_DEEP', 'Dữ liệu JSON lồng quá sâu.')
  if (Array.isArray(value)) return value.map((item) => canonicalize(item, depth + 1))
  if (!isPlainRecord(value)) return value
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, canonicalize(value[key], depth + 1)]),
  )
}

const SECRET_STATE_FIELDS = new Set([
  'password',
  'passwordHash',
  'password_hash',
  'passwordSalt',
  'password_salt',
  'passwordIterations',
  'password_iterations',
  'legacyPassword',
  'token',
  'tokenHash',
  'token_hash',
])

const normalizedStateKey = (key) => String(key || '').toLocaleLowerCase('en-US').replace(/[^a-z0-9]/gu, '')

const isSecretStateField = (key) => {
  if (SECRET_STATE_FIELDS.has(key)) return true
  const normalized = normalizedStateKey(key)
  return [
    'password',
    'passwordhash',
    'passwordsalt',
    'passworditerations',
    'legacypassword',
    'token',
    'tokenhash',
    'accesstoken',
    'refreshtoken',
    'apikey',
    'secret',
    'credential',
    'credentials',
    'authorization',
    'cookie',
    'setcookie',
  ].includes(normalized)
    || normalized.includes('password')
    || normalized.endsWith('token')
    || normalized.endsWith('tokenhash')
    || normalized.includes('accesstoken')
    || normalized.includes('refreshtoken')
    || normalized.includes('apikey')
    || normalized.includes('secret')
    || normalized.includes('credential')
    || normalized.includes('authorization')
    || normalized.includes('cookie')
}

const isCredentialEnvelope = (value) => {
  if (!isPlainRecord(value)) return false
  const keys = new Set(Object.keys(value).map(normalizedStateKey))
  return ['hash', 'salt', 'iterations', 'algorithm'].every((key) => keys.has(key))
}

const sanitizeStateValue = (value, depth = 0) => {
  if (depth > MAX_JSON_DEPTH) throw new ApiError(400, 'JSON_TOO_DEEP', 'Dữ liệu JSON lồng quá sâu.')
  if (Array.isArray(value)) return value
    .filter((item) => !isCredentialEnvelope(item))
    .map((item) => sanitizeStateValue(item, depth + 1))
  if (!isPlainRecord(value)) return value
  if (isCredentialEnvelope(value)) return null
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key, item]) => !isSecretStateField(key) && !isCredentialEnvelope(item))
      .map(([key, item]) => [key, sanitizeStateValue(item, depth + 1)]),
  )
}

const normalizeSharedStateForStorage = (value) => {
  const sanitized = sanitizeStateValue(isPlainRecord(value) ? value : {})
  const state = isPlainRecord(sanitized) ? sanitized : {}
  for (const key of [
    'adminAccounts',
    'managerAccounts',
    'managerPayroll',
    'profitShares',
    'policies',
    'orderCounters',
    'importCounter',
    'idempotencyKeys',
    'session',
    'activeAttendanceId',
    'checkedInAt',
    'finishedShift',
  ]) delete state[key]
  if (Array.isArray(state.stores)) {
    state.stores = state.stores.map((store) => {
      const configured = isPlainRecord(store?.operatingHours) ? store.operatingHours : {}
      const opening = parseShiftTime(store?.opening ?? store?.openingTime ?? configured.opening)
      const closing = parseShiftTime(store?.closing ?? store?.closingTime ?? configured.closing)
      if (!opening || !closing || closing.minuteOfDay <= opening.minuteOfDay) return store
      return {
        ...store,
        opening: opening.label,
        openingTime: opening.label,
        closing: closing.label,
        closingTime: closing.label,
        operatingHours: { opening: opening.label, closing: closing.label },
      }
    })
  }
  if (Array.isArray(state.importVouchers)) {
    const expenses = Array.isArray(state.expenseEntries) ? state.expenseEntries : []
    const canonicalImportExpenses = new Map()
    const otherExpenses = []
    for (const expense of expenses) {
      if (String(expense?.sourceType || '') !== 'import-voucher') {
        otherExpenses.push(expense)
        continue
      }
      const sourceId = String(expense?.sourceId || '')
      if (sourceId && !canonicalImportExpenses.has(sourceId)) canonicalImportExpenses.set(sourceId, expense)
    }
    for (const voucher of state.importVouchers) {
      const voucherId = String(voucher?.id || '')
      if (!voucherId || canonicalImportExpenses.has(voucherId)) continue
      const totalAmount = Number(voucher.totalAmount ?? (
        Number(voucher.goodsAmount || 0)
        + Number(voucher.shippingAmount || 0)
        + Number(voucher.relatedAmount || 0)
      ))
      if (!Number.isSafeInteger(totalAmount) || totalAmount < 0) continue
      const deleted = Boolean(voucher.deletedAt || voucher.status === 'Đã xóa')
      canonicalImportExpenses.set(voucherId, {
        id: `exp_import_${voucherId}`,
        storeId: voucher.storeId,
        type: 'Nhập hàng',
        category: 'inventory',
        amount: totalAmount,
        description: `Phiếu nhập ${voucher.code || voucherId}`,
        sourceType: 'import-voucher',
        sourceId: voucherId,
        recognized: !deleted,
        occurredAt: voucher.createdAt,
        createdAt: voucher.createdAt,
        createdBy: voucher.createdBy?.id || voucher.createdBy || 'SYSTEM',
        ...(deleted ? { deletedAt: voucher.deletedAt, voidedAt: voucher.deletedAt } : {}),
      })
    }
    state.expenseEntries = [...canonicalImportExpenses.values(), ...otherExpenses]
  }
  return state
}

const employeeReference = (record) => String(
  record?.employeeId || record?.employee_id || record?.assigneeId || record?.userId || '',
)

const employeeReferences = (record) => {
  const references = new Set()
  const add = (value) => {
    const normalized = String(value || '').trim()
    if (normalized) references.add(normalized)
  }
  const collect = (value, parentKey = '', depth = 0) => {
    if (depth > 16 || value == null) return
    if (Array.isArray(value)) {
      for (const item of value) {
        if (['employeeIds', 'assignees', 'participants'].includes(parentKey)) {
          if (isPlainRecord(item)) add(
            item.employeeId || item.employee_id || item.assigneeId || item.userId || item.id || item.code,
          )
          else add(item)
        }
        collect(item, parentKey, depth + 1)
      }
      return
    }
    if (!isPlainRecord(value)) return
    if (['assignees', 'participants'].includes(parentKey)) {
      add(value.employeeId || value.employee_id || value.assigneeId || value.userId || value.id || value.code)
    }
    if (['before', 'after'].includes(parentKey)
      && (value.employeeCode || value.unit || value.unitType || value.department)) {
      add(value.employeeId || value.employee_id || value.employeeCode || value.id || value.code)
    }
    for (const [key, nested] of Object.entries(value)) {
      if (['employeeId', 'employee_id', 'assigneeId', 'userId'].includes(key)) add(nested)
      if (key === 'completedBy' && isPlainRecord(nested)) Object.keys(nested).forEach(add)
      collect(nested, key, depth + 1)
    }
  }
  collect(record)
  return [...references]
}

const redactEmployeeReferences = (value, allowedEmployeeIds, parentKey = '', depth = 0) => {
  if (depth > 16 || value == null) return value
  if (Array.isArray(value)) {
    return value.flatMap((item) => {
      if (['employeeIds', 'assignees', 'participants'].includes(parentKey)) {
        const reference = isPlainRecord(item)
          ? String(item.employeeId || item.employee_id || item.assigneeId || item.userId || item.id || item.code || '')
          : String(item || '')
        if (reference && !allowedEmployeeIds.has(reference)) return []
      }
      const redacted = redactEmployeeReferences(item, allowedEmployeeIds, parentKey, depth + 1)
      return redacted === undefined ? [] : [redacted]
    })
  }
  if (!isPlainRecord(value)) return value
  const directReference = String(
    value.employeeId || value.employee_id || value.assigneeId || value.userId || '',
  ).trim()
  const contextualReference = ['before', 'after', 'assignees', 'participants'].includes(parentKey)
    ? String(value.employeeCode || value.id || value.code || '').trim()
    : ''
  if (depth > 0
    && ((directReference && !allowedEmployeeIds.has(directReference))
      || (contextualReference && !allowedEmployeeIds.has(contextualReference)))) return undefined
  const projected = {}
  for (const [key, nested] of Object.entries(value)) {
    if (['employeeId', 'employee_id', 'assigneeId', 'userId'].includes(key)) {
      if (allowedEmployeeIds.has(String(nested || ''))) projected[key] = nested
      continue
    }
    if (key === 'completedBy' && isPlainRecord(nested)) {
      projected[key] = Object.fromEntries(Object.entries(nested)
        .filter(([employeeId]) => allowedEmployeeIds.has(String(employeeId))))
      continue
    }
    const redacted = redactEmployeeReferences(nested, allowedEmployeeIds, key, depth + 1)
    if (redacted !== undefined) projected[key] = redacted
  }
  return projected
}

const belongsToEmployee = (record, employeeId) => {
  if (!isPlainRecord(record)) return false
  return employeeReferences(record).includes(String(employeeId))
}

const taskAssigneeIds = (task) => {
  const references = new Set()
  const add = (value) => {
    const normalized = String(value || '').trim()
    if (normalized) references.add(normalized)
  }
  add(task?.employeeId || task?.employee_id || task?.assigneeId || task?.userId)
  for (const value of Array.isArray(task?.employeeIds) ? task.employeeIds : []) add(value)
  for (const value of Array.isArray(task?.assignees) ? task.assignees : []) {
    if (isPlainRecord(value)) add(value.employeeId || value.employee_id || value.assigneeId || value.userId || value.id || value.code)
    else add(value)
  }
  return [...references]
}

const taskAppliesToEmployee = (task, employeeId, storeId) => {
  if (!isPlainRecord(task) || task.deletedAt || String(task.storeId || '') !== String(storeId || '')) return false
  const assignees = taskAssigneeIds(task)
  return !assignees.length || assignees.includes(String(employeeId || ''))
}

const filterArray = (state, key, predicate) => (Array.isArray(state[key]) ? state[key].filter(predicate) : [])

const hasExplicitNotificationAudience = (record) => employeeReferences(record).length > 0

const employeeUnit = (record) => {
  const explicit = String(record?.unit || record?.unitType || record?.department || '').trim().toLowerCase()
  if (['business_support', 'business-support', 'support'].includes(explicit)) return 'business_support'
  if (['store_manager', 'store-manager', 'manager'].includes(explicit)) return 'store_manager'
  if (explicit === 'office' || String(record?.storeId || '') === OFFICE_STORE_ID || record?.isOffice === true) return 'office'
  return 'store'
}

const officeLikeEmployee = (record) => ['office', 'business_support', 'store_manager'].includes(employeeUnit(record))

const roleForEmployeeUnit = (unit) => {
  if (unit === 'business_support') return 'business_support'
  if (unit === 'store_manager') return 'store_manager'
  return 'employee'
}

const payrollProjectionEmployeeId = (record) => String(
  record?.employeeId || record?.employee_id || record?.id || record?.code || '',
).trim()

const finiteProjectionNumber = (value) => {
  const number = Number(value)
  return Number.isFinite(number) ? number : 0
}

const projectPayrollPeriodForEmployees = (period, visibleEmployeeIds, { stripKpi = false } = {}) => {
  const rows = Array.isArray(period?.rows)
    ? period.rows.filter((row) => visibleEmployeeIds.has(payrollProjectionEmployeeId(row)))
    : null
  const { kpiSnapshot, ...safePeriod } = period
  const projected = { ...safePeriod, ...(rows ? { rows } : {}) }
  if (stripKpi || !isPlainRecord(kpiSnapshot)) return projected

  const results = (Array.isArray(kpiSnapshot.results) ? kpiSnapshot.results : [])
    .filter((result) => visibleEmployeeIds.has(payrollProjectionEmployeeId(result)))
    .map((result) => ({
      id: payrollProjectionEmployeeId(result),
      role: String(result.role || 'employee'),
      hours: finiteProjectionNumber(result.hours),
      ratePercent: finiteProjectionNumber(result.ratePercent),
      amount: finiteProjectionNumber(result.amount),
    }))
  const totalHours = results.reduce((sum, result) => sum + result.hours, 0)
  const totalBonus = results.reduce((sum, result) => sum + result.amount, 0)
  const profit = finiteProjectionNumber(kpiSnapshot.profit ?? period?.financeSnapshot?.profit)
  const ratePercents = [...new Set(results.map((result) => result.ratePercent))]

  return {
    ...projected,
    kpiSnapshot: {
      eligible: profit > 0 && totalHours > 0,
      profit,
      totalHours,
      profitPerHour: totalHours > 0 ? profit / totalHours : 0,
      employeeTier: ratePercents.length === 1 && ratePercents[0] > 0
        ? { ratePercent: ratePercents[0] }
        : null,
      results,
      totalBonus,
    },
  }
}

const canAccessNotification = (state, actor, record) => {
  if (!isPlainRecord(record)) return false
  if (actor.role === 'admin') return true
  if (actor.role === 'business_support') {
    if (String(record.type || '') === 'support-work-submitted') return false
    if (String(record.type || '') === 'support-work-assigned') {
      return belongsToEmployee(record, String(actor.employee_id || actor.user_id || ''))
    }
    return true
  }
  const recordStoreId = String(record.storeId || '')
  if (actor.role === 'store_manager') {
    const storeId = String(actor.store_id || '')
    if (!storeId || recordStoreId !== storeId) return false
    const referencedEmployeeIds = employeeReferences(record)
    if (!referencedEmployeeIds.length) return true
    return referencedEmployeeIds.every((reference) => (
      (Array.isArray(state.employees) ? state.employees : []).some((employee) => (
        [employee.id, employee.code, employee.employeeId].map(String).includes(reference)
        && String(employee.storeId || '') === storeId
        && (employeeUnit(employee) === 'store'
          || [employee.id, employee.code, employee.employeeId].map(String).includes(String(actor.employee_id || '')))
      ))
    ))
  }
  if (actor.role !== 'employee') return false
  const employeeId = String(actor.employee_id || actor.user_id || '')
  const storeId = String(actor.store_id || '')
  if (!employeeId || !storeId || (recordStoreId && recordStoreId !== storeId)) return false
  return hasExplicitNotificationAudience(record)
    ? belongsToEmployee(record, employeeId)
    : recordStoreId === storeId
}

const notificationActorId = (actor) => String(actor?.user_id || actor?.id || '')

const notificationReadAtForActor = (record, actor) => {
  if (!isPlainRecord(record)) return null
  if (record.readAt || record.read || record.isRead) return record.readAt || record.updatedAt || record.createdAt || null
  const actorId = notificationActorId(actor)
  if (!actorId || !isPlainRecord(record.readAtByUserId)) return null
  return record.readAtByUserId[actorId] || null
}

const projectNotificationForActor = (record, actor) => {
  const safeRecord = actor.role === 'employee'
    ? redactEmployeeReferences(record, new Set([String(actor.employee_id || actor.user_id || '')]))
    : record
  const { readAtByUserId, readByUserIds, ...projected } = safeRecord
  void readAtByUserId
  void readByUserIds
  return { ...projected, readAt: notificationReadAtForActor(record, actor) }
}

const ownAccountSettings = (state, user) => {
  const userId = String(user.user_id || user.id || '')
  const stored = isPlainRecord(state.accountSettings?.[userId]) ? state.accountSettings[userId] : null
  const legacy = user.role === 'admin' && isPlainRecord(state.settings) ? state.settings : {}
  return {
    name: user.display_name || user.displayName || user.username || '',
    email: '',
    phone: '',
    birthday: '',
    gender: '',
    address: '',
    bio: '',
    avatar: '',
    ...legacy,
    ...(stored || {}),
    notifications: {
      tasks: true,
      dailyReport: true,
      expenseAlert: false,
      ...(isPlainRecord(legacy.notifications) ? legacy.notifications : {}),
      ...(isPlainRecord(stored?.notifications) ? stored.notifications : {}),
    },
  }
}

export const projectSharedState = (rawState, user) => {
  const state = normalizeSharedStateForStorage(rawState)
  const common = {
    schemaVersion: state.schemaVersion,
    stateVersion: state.stateVersion,
    session: null,
    activeAttendanceId: null,
    checkedInAt: null,
    finishedShift: false,
  }
  if (user.role === 'admin') {
    const { accountSettings, ...adminState } = state
    void accountSettings
    return {
      ...adminState,
      notifications: filterArray(state, 'notifications', () => true).map((record) => projectNotificationForActor(record, user)),
      settings: ownAccountSettings(state, user),
      session: null,
    }
  }

  if (user.role === 'business_support') {
    const ownEmployeeId = String(user.employee_id || '')
    const ownAttendance = filterArray(state, 'attendance', (record) => belongsToEmployee(record, ownEmployeeId))
    const ownOpenAttendance = ownAttendance.find((record) => !record.deletedAt && !record.checkOut && !record.checkOutAt)
    const ownLatestAttendance = [...ownAttendance]
      .sort((left, right) => String(right.checkInAt || right.createdAt || '').localeCompare(String(left.checkInAt || left.createdAt || '')))[0]
    const { accountSettings, ...operationalState } = state
    void accountSettings
    return {
      ...operationalState,
      supportWorkAssignments: filterArray(state, 'supportWorkAssignments', (record) => (
        belongsToEmployee(record, ownEmployeeId)
      )),
      notifications: filterArray(state, 'notifications', (record) => canAccessNotification(state, user, record))
        .map((record) => projectNotificationForActor(record, user)),
      settings: ownAccountSettings(state, user),
      activeAttendanceId: ownOpenAttendance?.id || null,
      checkedInAt: ownOpenAttendance?.checkInAt || ownOpenAttendance?.checkIn || null,
      finishedShift: Boolean(!ownOpenAttendance && ownLatestAttendance?.checkOutAt),
      session: null,
    }
  }

  if (user.role === 'store_manager') {
    const storeId = String(user.store_id || '')
    if (!storeId || [OFFICE_STORE_ID, BUSINESS_SUPPORT_STORE_ID].includes(storeId)) return common
    const ownEmployeeId = String(user.employee_id || '')
    const ownAttendance = filterArray(state, 'attendance', (record) => belongsToEmployee(record, ownEmployeeId))
    const ownOpenAttendance = ownAttendance.find((record) => !record.deletedAt && !record.checkOut && !record.checkOutAt)
    const ownLatestAttendance = [...ownAttendance]
      .sort((left, right) => String(right.checkInAt || right.createdAt || '').localeCompare(String(left.checkInAt || left.createdAt || '')))[0]
    const homeEmployees = filterArray(state, 'employees', (record) => (
      String(record.storeId || '') === storeId
      && (employeeUnit(record) === 'store'
        || [record.id, record.code, record.employeeId].map(String).includes(ownEmployeeId))
    ))
    const projectionDate = localDateTimeParts(new Date().toISOString()).date
    const inboundTransfers = filterArray(state, 'supportTransfers', (record) => (
      String(record.toStoreId || '') === storeId
      && !record.deletedAt
      && !['Đã xóa', 'Đã hủy', 'Hoàn tất'].includes(String(record.status || ''))
      && String(record.toDate || '') >= projectionDate
    ))
    const inboundTransferByEmployee = new Map(inboundTransfers.map((record) => [String(record.employeeId || ''), record]))
    const transferredEmployees = filterArray(state, 'employees', (record) => (
      employeeUnit(record) === 'store'
      && !record.deletedAt
      && inboundTransferByEmployee.has(String(record.id || record.code || ''))
    )).map((record) => {
      const transfer = inboundTransferByEmployee.get(String(record.id || record.code || ''))
      return {
        ...record,
        homeStoreId: record.storeId,
        supportStoreId: storeId,
        supportAssignment: {
          id: transfer.id,
          fromStoreId: transfer.fromStoreId,
          toStoreId: transfer.toStoreId,
          fromDate: transfer.fromDate,
          toDate: transfer.toDate,
          hourlySupportRate: transfer.hourlySupportRate,
          allowance: transfer.allowance,
          status: transfer.status,
        },
      }
    })
    const employees = [...homeEmployees]
    for (const employee of transferredEmployees) {
      if (!employees.some((record) => String(record.id || record.code || '') === String(employee.id || employee.code || ''))) {
        employees.push(employee)
      }
    }
    const visibleEmployeeIds = new Set(employees.flatMap((record) => (
      [record.id, record.code, record.employeeId].map((value) => String(value || '')).filter(Boolean)
    )))
    const storeEmployeeIds = new Set(employees.filter((record) => employeeUnit(record) === 'store')
      .flatMap((record) => [record.id, record.code, record.employeeId]
        .map((value) => String(value || '')).filter(Boolean)))
    const historicalStoreEmployeeIds = new Set([
      ...storeEmployeeIds,
      ...filterArray(state, 'deletedEmployees', (record) => (
        String(record.storeId || '') === storeId && employeeUnit(record) === 'store'
      )).flatMap((record) => [record.id, record.code, record.employeeId]
        .map((value) => String(value || '')).filter(Boolean)),
    ])
    const historicalVisibleEmployeeIds = new Set([...visibleEmployeeIds, ...historicalStoreEmployeeIds])
    const belongsToAllowedStoreEmployees = (record, allowedEmployeeIds) => {
      const recordStoreId = String(record?.storeId || '')
      if (recordStoreId && recordStoreId !== storeId) return false
      const references = employeeReferences(record)
      if (references.length) return references.every((reference) => allowedEmployeeIds.has(reference))
      return recordStoreId === storeId
    }
    const employeeScoped = (key) => filterArray(
      state,
      key,
      (record) => belongsToAllowedStoreEmployees(record, storeEmployeeIds),
    )
    const historicalVisibleScoped = (key) => filterArray(
      state,
      key,
      (record) => belongsToAllowedStoreEmployees(record, historicalVisibleEmployeeIds),
    )
    const historicalEmployeeScoped = (key) => filterArray(
      state,
      key,
      (record) => belongsToAllowedStoreEmployees(record, historicalStoreEmployeeIds),
    )
    const payrollPeriods = filterArray(state, 'payrollPeriods', (period) => (
      String(period.storeId || '') === storeId
    )).map((period) => projectPayrollPeriodForEmployees(period, storeEmployeeIds))
    const deletedEmployees = filterArray(state, 'deletedEmployees', (record) => (
      String(record.storeId || '') === storeId
      && (employeeUnit(record) === 'store'
        || [record.id, record.code, record.employeeId].map(String).includes(ownEmployeeId))
    ))
    return {
      ...common,
      activeStoreId: storeId,
      activeAttendanceId: ownOpenAttendance?.id || null,
      checkedInAt: ownOpenAttendance?.checkInAt || ownOpenAttendance?.checkIn || null,
      finishedShift: Boolean(!ownOpenAttendance && ownLatestAttendance?.checkOutAt),
      stores: filterArray(state, 'stores', (record) => String(record.id || '') === storeId),
      employees,
      attendance: historicalVisibleScoped('attendance'),
      schedule: employeeScoped('schedule'),
      tasks: employeeScoped('tasks'),
      taskAssignmentHistory: historicalEmployeeScoped('taskAssignmentHistory'),
      notifications: filterArray(state, 'notifications', (record) => canAccessNotification(state, user, record))
        .map((record) => projectNotificationForActor(record, user)),
      salaryAdjustments: employeeScoped('salaryAdjustments'),
      salaryAdvances: employeeScoped('salaryAdvances'),
      payrollPeriods,
      payrollPayments: employeeScoped('payrollPayments'),
      shiftDefinitions: employeeScoped('shiftDefinitions'),
      orders: historicalEmployeeScoped('orders'),
      expenseEntries: historicalEmployeeScoped('expenseEntries'),
      fixedExpenses: historicalEmployeeScoped('fixedExpenses'),
      cashTransactions: historicalEmployeeScoped('cashTransactions'),
      importVouchers: historicalEmployeeScoped('importVouchers'),
      imports: historicalEmployeeScoped('imports'),
      deletedEmployees,
      supportTransfers: historicalEmployeeScoped('supportTransfers').filter((record) => (
        String(record.fromStoreId || '') === storeId || String(record.toStoreId || '') === storeId
      )),
      settings: ownAccountSettings(state, user),
      session: null,
    }
  }

  const storeId = String(user.store_id || '')
  const employeeId = String(user.employee_id || user.user_id || '')
  if (user.role === 'employee' && employeeId) {
    const own = (key) => filterArray(state, key, (record) => belongsToEmployee(record, employeeId))
    const ownAttendance = own('attendance')
    const openAttendance = ownAttendance.find((record) => !record.deletedAt && !record.checkOut && !record.checkOutAt)
    const latestAttendance = [...ownAttendance]
      .sort((left, right) => String(right.checkInAt || right.createdAt || '').localeCompare(String(left.checkInAt || left.createdAt || '')))[0]
    const visibleStoreIds = new Set([
      storeId,
      String(user.home_store_id || ''),
    ].filter(Boolean))
    const stores = filterArray(state, 'stores', (record) => visibleStoreIds.has(String(record.id || '')))
      .map((record) => Object.fromEntries(Object.entries(record).filter(([key]) => (
        !['revenue', 'expense', 'profit', 'cash', 'balance', 'costs'].includes(key)
      ))))
    const tasks = filterArray(state, 'tasks', (record) => {
      return taskAppliesToEmployee(record, employeeId, storeId)
    }).map((record) => redactEmployeeReferences(record, new Set([employeeId])))
    const payrollPeriods = (Array.isArray(state.payrollPeriods) ? state.payrollPeriods : []).flatMap((period) => {
      const rows = Array.isArray(period.rows)
        ? period.rows.filter((row) => belongsToEmployee(row, employeeId))
        : []
      if (!rows.length) return []
      const { financeSnapshot, kpiSnapshot, closedBy, ...safePeriod } = period
      void financeSnapshot
      void kpiSnapshot
      void closedBy
      return [{ ...safePeriod, rows }]
    })
    return {
      ...common,
      activeStoreId: storeId || null,
      stores,
      employees: filterArray(state, 'employees', (record) => String(record.id || record.employeeId || record.code || '') === employeeId),
      attendance: ownAttendance,
      schedule: own('schedule'),
      tasks,
      taskAssignmentHistory: own('taskAssignmentHistory')
        .map((record) => redactEmployeeReferences(record, new Set([employeeId]))),
      supportTransfers: own('supportTransfers'),
      orders: own('orders'),
      notifications: filterArray(state, 'notifications', (record) => canAccessNotification(state, user, record))
        .map((record) => projectNotificationForActor(record, user)),
      officeAdjustments: own('officeAdjustments'),
      salaryAdjustments: own('salaryAdjustments'),
      salaryAdvances: own('salaryAdvances'),
      payrollPeriods,
      payrollPayments: own('payrollPayments'),
      shiftDefinitions: filterArray(state, 'shiftDefinitions', (record) => !record.storeId || String(record.storeId) === storeId),
      activeAttendanceId: openAttendance?.id || null,
      checkedInAt: openAttendance?.checkInAt || openAttendance?.checkIn || null,
      finishedShift: Boolean(!openAttendance && latestAttendance?.checkOutAt),
    }
  }
  return common
}

const requestHash = (value) => sha256(JSON.stringify(canonicalize(value)))

const jsonResponse = (body, status = 200, extraHeaders = {}) => {
  const headers = new Headers({
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    ...extraHeaders,
  })
  return new Response(JSON.stringify(body), { status, headers })
}

const apiPayload = (context, body = {}) => ({
  ok: true,
  ...body,
  serverTime: context.now,
  requestId: context.requestId,
})

const readJson = async (request) => {
  const declaredLength = Number(request.headers.get('content-length') || 0)
  if (declaredLength > MAX_JSON_BYTES) throw new ApiError(413, 'PAYLOAD_TOO_LARGE', 'Dữ liệu gửi lên quá lớn.')
  let text = ''
  if (request.body) {
    const reader = request.body.getReader()
    const decoder = new TextDecoder()
    let received = 0
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      received += value.byteLength
      if (received > MAX_JSON_BYTES) {
        await reader.cancel()
        throw new ApiError(413, 'PAYLOAD_TOO_LARGE', 'Dữ liệu gửi lên quá lớn.')
      }
      text += decoder.decode(value, { stream: true })
    }
    text += decoder.decode()
  }
  if (!text.trim()) return {}
  try {
    const parsed = JSON.parse(text)
    if (!isPlainRecord(parsed)) throw new Error('JSON body must be an object')
    return parsed
  } catch {
    throw new ApiError(400, 'INVALID_JSON', 'Dữ liệu JSON không hợp lệ.')
  }
}

const getDatabase = (env) => {
  if (!env?.DB?.prepare || !env?.DB?.batch) {
    throw new ApiError(503, 'DATABASE_UNAVAILABLE', 'Cơ sở dữ liệu chưa được cấu hình.')
  }
  return env.DB
}

const first = (db, sql, ...bindings) => db.prepare(sql).bind(...bindings).first()
const run = (db, sql, ...bindings) => db.prepare(sql).bind(...bindings).run()
const all = async (db, sql, ...bindings) => {
  const result = await db.prepare(sql).bind(...bindings).all()
  return Array.isArray(result?.results) ? result.results : []
}
const changes = (result) => Number(result?.meta?.changes ?? result?.changes ?? 0)

const sessionTtlSeconds = (env) => {
  const configured = Number(env?.SESSION_TTL_SECONDS || DEFAULT_SESSION_TTL_SECONDS)
  if (!Number.isInteger(configured)) return DEFAULT_SESSION_TTL_SECONDS
  return Math.min(7 * 24 * 60 * 60, Math.max(15 * 60, configured))
}

const addSeconds = (isoTimestamp, seconds) => new Date(Date.parse(isoTimestamp) + seconds * 1000).toISOString()

const publicUser = (user) => ({
  id: user.user_id || user.id,
  username: user.username,
  displayName: user.display_name,
  role: user.role,
  storeId: user.store_id || null,
  employeeId: user.employee_id || null,
  status: user.status,
  version: Number(user.version || 1),
  lastLoginAt: user.last_login_at || null,
  ...(user.home_store_id ? { homeStoreId: user.home_store_id } : {}),
  ...(user.active_transfer_id ? { activeTransferId: user.active_transfer_id } : {}),
})

const bearerToken = (request) => {
  const match = request.headers.get('authorization')?.match(/^Bearer\s+([^\s]+)$/iu)
  return match?.[1] || null
}

const requireSession = async (request, db, context) => {
  const token = bearerToken(request)
  if (!token || token.length < 32 || token.length > 512) {
    throw new ApiError(401, 'AUTH_REQUIRED', 'Vui lòng đăng nhập để tiếp tục.')
  }
  const tokenHash = await sha256(token)
  const session = await first(db, `
    SELECT
      s.id AS session_id,
      s.token_hash,
      s.expires_at,
      u.id AS user_id,
      u.username,
      u.display_name,
      u.role,
      u.store_id,
      u.employee_id,
      u.status,
      u.version,
      u.last_login_at
    FROM sessions AS s
    INNER JOIN users AS u ON u.id = s.user_id
    WHERE s.token_hash = ?
      AND s.revoked_at IS NULL
      AND s.expires_at > ?
      AND u.status = 'active'
    LIMIT 1
  `, tokenHash, context.now)
  if (!session) throw new ApiError(401, 'SESSION_INVALID', 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn.')
  await run(db, 'UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?', context.now, tokenHash)
  return resolveEffectiveEmployeeStore(db, session, context.now)
}

const activeSupportTransferFor = (state, employeeId, date) => (Array.isArray(state.supportTransfers)
  ? state.supportTransfers
  : [])
  .filter((record) => (
    String(record.employeeId || '') === String(employeeId || '')
    && !record.deletedAt
    && !['Đã xóa', 'Đã hủy', 'Hoàn tất'].includes(String(record.status || ''))
    && String(record.fromDate || '') <= date
    && String(record.toDate || '') >= date
  ))
  .sort((left, right) => String(right.createdAt || '').localeCompare(String(left.createdAt || '')))[0] || null

const supportTransferToStoreOnDate = (state, employeeId, storeId, date) => (Array.isArray(state.supportTransfers)
  ? state.supportTransfers
  : [])
  .filter((record) => (
    String(record.employeeId || '') === String(employeeId || '')
    && String(record.toStoreId || '') === String(storeId || '')
    && !record.deletedAt
    && !['Đã xóa', 'Đã hủy', 'Hoàn tất'].includes(String(record.status || ''))
    && String(record.fromDate || '') <= date
    && String(record.toDate || '') >= date
  ))
  .sort((left, right) => String(right.createdAt || '').localeCompare(String(left.createdAt || '')))[0] || null

const employeeWorksAtStoreOnDate = (state, employee, storeId, date) => (
  String(employee?.storeId || '') === String(storeId || '')
  || Boolean(supportTransferToStoreOnDate(
    state,
    String(employee?.id || employee?.code || ''),
    storeId,
    date,
  ))
)

const resolveEffectiveEmployeeStore = async (db, user, now) => {
  if (user?.role !== 'employee' || !user?.employee_id) return user
  const stateRow = await loadState(db, 'global')
  const state = stateRow ? parseStoredJson(stateRow.value_json, {}) : {}
  const date = localDateTimeParts(now).date
  const transfer = activeSupportTransferFor(state, user.employee_id, date)
  if (!transfer?.toStoreId) return user
  return {
    ...user,
    home_store_id: user.store_id || transfer.fromStoreId || null,
    store_id: String(transfer.toStoreId),
    active_transfer_id: String(transfer.id || ''),
  }
}

const validScope = (scope) => /^(?:global|store:[A-Za-z0-9_-]{1,80}|employee:[A-Za-z0-9_-]{1,80})$/u.test(String(scope || ''))

const defaultScope = (user) => {
  if (VALID_ROLES.has(user.role)) return 'global'
  throw new ApiError(403, 'SCOPE_UNAVAILABLE', 'Tài khoản chưa được gán phạm vi dữ liệu.')
}

export const canReadScope = (user, scope) => {
  if (!validScope(scope)) return false
  if (scope === 'global' && VALID_ROLES.has(user.role)) return true
  if (user.role === 'admin') return true
  if (user.role === 'business_support') return scope === 'global'
  if (user.role === 'store_manager') return scope === `store:${user.store_id}`
  if (user.role === 'employee') return scope === `employee:${user.employee_id || user.user_id}`
  return false
}

export const canWriteScope = (user, scope) => user.role === 'admin' && validScope(scope)

export const canUseCounter = (user, name) => {
  const counterName = String(name || '')
  if (!/^[A-Za-z0-9:_-]{3,120}$/u.test(counterName)) return false
  return user.role === 'admin'
}

const assertScope = (user, scope, write = false) => {
  const allowed = write ? canWriteScope(user, scope) : canReadScope(user, scope)
  if (!allowed) throw new ApiError(403, 'SCOPE_FORBIDDEN', 'Bạn không có quyền truy cập phạm vi dữ liệu này.')
}

const validateExpectedVersion = (value) => {
  const version = Number(value)
  if (!Number.isInteger(version) || version < 0) {
    throw new ApiError(400, 'INVALID_VERSION', 'Phiên bản dữ liệu mong đợi phải là số nguyên không âm.')
  }
  return version
}

const validateIdempotencyKey = (request, body) => {
  const value = String(request.headers.get('idempotency-key') || body.idempotencyKey || '').trim()
  if (!/^[A-Za-z0-9._:-]{8,160}$/u.test(value)) {
    throw new ApiError(400, 'INVALID_IDEMPOTENCY_KEY', 'Mỗi lệnh ghi cần khóa chống gửi trùng hợp lệ.')
  }
  return value
}

const jsonByteLength = (value) => textEncoder.encode(String(value)).byteLength

const splitUtf8String = (value, maximumBytes) => {
  const source = String(value)
  const encoded = textEncoder.encode(source)
  if (encoded.byteLength <= maximumBytes) return [source]
  const decoder = new TextDecoder('utf-8', { fatal: true })
  const chunks = []
  let start = 0
  while (start < encoded.byteLength) {
    let end = Math.min(encoded.byteLength, start + maximumBytes)
    while (end < encoded.byteLength && end > start && (encoded[end] & 0xC0) === 0x80) end -= 1
    if (end <= start) throw new ApiError(500, 'JSON_CHUNK_FAILED', 'Không thể chia nhỏ dữ liệu JSON an toàn.')
    chunks.push(decoder.decode(encoded.subarray(start, end)))
    start = end
  }
  return chunks
}

const loadReceipt = async (db, actorId, idempotencyKey) => {
  const receipt = await first(db, `
    SELECT request_hash, response_json, status_code
    FROM command_receipts
    WHERE actor_id = ? AND idempotency_key = ?
    LIMIT 1
  `, actorId, idempotencyKey)
  if (!receipt) return null
  const marker = parseStoredJson(receipt.response_json, null)
  if (marker?.__idosiChunkedResponse !== 1) return receipt
  const chunkCount = Number(marker.chunkCount)
  if (!Number.isSafeInteger(chunkCount) || chunkCount < 1 || chunkCount > 10_000) {
    throw new ApiError(500, 'RECEIPT_CORRUPT', 'Manifest biên nhận chống gửi trùng không hợp lệ.')
  }
  const rows = []
  for (let index = 0; index < chunkCount; index += 1) {
    const chunk = await first(db, `
      SELECT chunk_index, chunk_text, chunk_bytes
      FROM command_receipt_chunks
      WHERE actor_id = ? AND idempotency_key = ? AND chunk_index = ?
      LIMIT 1
    `, actorId, idempotencyKey, index)
    if (!chunk) throw new ApiError(500, 'RECEIPT_CORRUPT', 'Biên nhận chống gửi trùng không đầy đủ.')
    rows.push(chunk)
  }
  const responseJson = rows.map((row) => String(row.chunk_text)).join('')
  const valid = rows.length === chunkCount
    && rows.every((row, index) => Number(row.chunk_index) === index
      && jsonByteLength(row.chunk_text) === Number(row.chunk_bytes))
    && jsonByteLength(responseJson) === Number(marker.byteLength)
  if (!valid) throw new ApiError(500, 'RECEIPT_CORRUPT', 'Biên nhận chống gửi trùng không đầy đủ.')
  return { ...receipt, response_json: responseJson }
}

const replayReceipt = (receipt, hash) => {
  if (!receipt) return null
  if (!constantTimeEqual(receipt.request_hash, hash)) {
    throw new ApiError(409, 'IDEMPOTENCY_KEY_REUSED', 'Khóa chống gửi trùng đã được dùng cho một lệnh khác.')
  }
  return new Response(receipt.response_json, {
    status: Number(receipt.status_code) || 200,
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json; charset=utf-8',
      'Idempotency-Replayed': 'true',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}

const stateEntityIdentity = (value, serialized) => {
  if (isPlainRecord(value)) {
    for (const key of ['id', 'notificationId']) {
      const candidate = String(value[key] || '').trim()
      if (candidate) return `${key}:${candidate}`
    }
  }
  return `value:${serialized}`
}

const loadStateEntityRows = async (db, scope) => {
  const rows = []
  let cursor = null
  let metadataBuffer = []
  let metadataExhausted = false
  while (true) {
    if (!metadataBuffer.length) {
      if (metadataExhausted) break
      metadataBuffer = cursor
        ? await all(db, `
            SELECT collection_key, entity_key, entity_order, value_bytes
            FROM state_entities
            WHERE scope_key = ? AND (
              collection_key > ?
              OR (collection_key = ? AND entity_order > ?)
              OR (collection_key = ? AND entity_order = ? AND entity_key > ?)
            )
            ORDER BY collection_key, entity_order, entity_key
            LIMIT ${STATE_ENTITY_PAGE_SIZE}
          `, scope, cursor.collectionKey, cursor.collectionKey, cursor.entityOrder,
          cursor.collectionKey, cursor.entityOrder, cursor.entityKey)
        : await all(db, `
            SELECT collection_key, entity_key, entity_order, value_bytes
            FROM state_entities
            WHERE scope_key = ?
            ORDER BY collection_key, entity_order, entity_key
            LIMIT ${STATE_ENTITY_PAGE_SIZE}
          `, scope)
      if (!metadataBuffer.length) break
      metadataExhausted = metadataBuffer.length < STATE_ENTITY_PAGE_SIZE
    }
    let pageCount = 0
    let estimatedBytes = 0
    for (const metadata of metadataBuffer) {
      const rowBytes = Number(metadata.value_bytes)
        + jsonByteLength(metadata.collection_key)
        + jsonByteLength(metadata.entity_key)
        + 256
      if (pageCount > 0 && estimatedBytes + rowBytes > MAX_STATE_BATCH_JSON_BYTES) break
      pageCount += 1
      estimatedBytes += rowBytes
    }
    const page = cursor
      ? await all(db, `
          SELECT collection_key, entity_key, entity_order, value_json, value_bytes, created_at, updated_at
          FROM state_entities
          WHERE scope_key = ? AND (
            collection_key > ?
            OR (collection_key = ? AND entity_order > ?)
            OR (collection_key = ? AND entity_order = ? AND entity_key > ?)
          )
          ORDER BY collection_key, entity_order, entity_key
          LIMIT ${pageCount}
        `, scope, cursor.collectionKey, cursor.collectionKey, cursor.entityOrder,
        cursor.collectionKey, cursor.entityOrder, cursor.entityKey)
      : await all(db, `
          SELECT collection_key, entity_key, entity_order, value_json, value_bytes, created_at, updated_at
          FROM state_entities
          WHERE scope_key = ?
          ORDER BY collection_key, entity_order, entity_key
          LIMIT ${pageCount}
        `, scope)
    if (page.length !== pageCount) {
      throw new ApiError(409, 'STATE_SNAPSHOT_CHANGED', 'Trạng thái thay đổi trong khi đang đọc.')
    }
    rows.push(...page)
    metadataBuffer = metadataBuffer.slice(pageCount)
    const last = page.at(-1)
    cursor = {
      collectionKey: String(last.collection_key),
      entityOrder: Number(last.entity_order),
      entityKey: String(last.entity_key),
    }
  }
  return rows
}

const loadStateSnapshot = async (db, scope) => {
  const row = await first(db, `
    SELECT scope_key, value_json, version, updated_at, updated_by, last_request_id
    FROM app_state
    WHERE scope_key = ?
    LIMIT 1
  `, scope)
  if (!row) return null
  const manifests = await all(db, `
    SELECT collection_key, created_at, updated_at
    FROM state_collections
    WHERE scope_key = ?
    ORDER BY collection_key
  `, scope)
  if (!manifests.length) return row
  const hydrated = parseStoredJson(row.value_json, null)
  if (!isPlainRecord(hydrated)) throw new ApiError(500, 'STATE_CORRUPT', 'Trạng thái lưu trữ không hợp lệ.')
  const metadata = new Map(manifests.map((manifest) => [String(manifest.collection_key), {
    createdAt: manifest.created_at,
    updatedAt: manifest.updated_at,
    rows: [],
  }]))
  for (const key of metadata.keys()) hydrated[key] = []
  for (const entity of await loadStateEntityRows(db, scope)) {
    const collectionKey = String(entity.collection_key)
    const collection = metadata.get(collectionKey)
    if (!collection) throw new ApiError(500, 'STATE_ENTITY_ORPHANED', 'Bản ghi trạng thái không có danh mục cha.')
    const serialized = String(entity.value_json)
    if (jsonByteLength(serialized) !== Number(entity.value_bytes)
      || Number(entity.value_bytes) > MAX_STATE_ENTITY_BYTES) {
      throw new ApiError(500, 'STATE_ENTITY_CORRUPT', 'Kích thước bản ghi trạng thái không hợp lệ.')
    }
    const value = parseStoredJson(serialized, undefined)
    if (value === undefined && serialized !== 'null') {
      throw new ApiError(500, 'STATE_ENTITY_CORRUPT', 'Bản ghi trạng thái không phải JSON hợp lệ.')
    }
    hydrated[collectionKey].push(value)
    collection.rows.push({
      entityKey: String(entity.entity_key),
      entityOrder: Number(entity.entity_order),
      valueJson: serialized,
      value,
      createdAt: entity.created_at,
      updatedAt: entity.updated_at,
    })
  }
  row.value_json = JSON.stringify(hydrated)
  Object.defineProperty(row, '_externalCollections', { value: metadata, enumerable: false })
  return row
}

const loadState = async (db, scope) => {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    let row
    try {
      row = await loadStateSnapshot(db, scope)
    } catch (error) {
      if (error instanceof ApiError
        && ['STATE_SNAPSHOT_CHANGED', 'STATE_ENTITY_ORPHANED'].includes(error.code)) continue
      throw error
    }
    if (!row || !(row._externalCollections instanceof Map)) return row
    const latest = await first(db, `
      SELECT version, last_request_id FROM app_state WHERE scope_key = ? LIMIT 1
    `, scope)
    if (latest
      && Number(latest.version) === Number(row.version)
      && String(latest.last_request_id || '') === String(row.last_request_id || '')) return row
  }
  throw new ApiError(409, 'STATE_READ_CONFLICT', 'Trạng thái đang được cập nhật; vui lòng thử lại.')
}

const assignStateEntityOrders = (descriptors) => {
  const anchors = descriptors
    .map((descriptor, index) => descriptor.match ? { index, order: descriptor.match.entityOrder } : null)
    .filter(Boolean)
  const monotonic = anchors.every((anchor, index) => (
    Number.isSafeInteger(anchor.order)
    && (index === 0 || anchor.order > anchors[index - 1].order)
  ))
  const reindex = () => descriptors.forEach((descriptor, index) => {
    descriptor.entityOrder = (index + 1) * STATE_ENTITY_ORDER_STEP
  })
  if (!anchors.length || !monotonic) {
    reindex()
    return
  }
  for (const anchor of anchors) descriptors[anchor.index].entityOrder = anchor.order
  let previousIndex = -1
  let previousOrder = null
  for (const anchor of anchors) {
    const count = anchor.index - previousIndex - 1
    if (count > 0) {
      if (previousOrder === null) {
        const start = anchor.order - count
        if (!Number.isSafeInteger(start)) return reindex()
        for (let offset = 0; offset < count; offset += 1) {
          descriptors[previousIndex + 1 + offset].entityOrder = start + offset
        }
      } else {
        const gap = anchor.order - previousOrder - 1
        if (gap < count) return reindex()
        let lastAssigned = previousOrder
        for (let offset = 0; offset < count; offset += 1) {
          const order = previousOrder + Math.floor(((anchor.order - previousOrder) * (offset + 1)) / (count + 1))
          if (!Number.isSafeInteger(order) || order <= lastAssigned || order >= anchor.order) return reindex()
          descriptors[previousIndex + 1 + offset].entityOrder = order
          lastAssigned = order
        }
      }
    }
    previousIndex = anchor.index
    previousOrder = anchor.order
  }
  for (let index = previousIndex + 1; index < descriptors.length; index += 1) {
    const order = previousOrder + ((index - previousIndex) * STATE_ENTITY_ORDER_STEP)
    if (!Number.isSafeInteger(order)) return reindex()
    descriptors[index].entityOrder = order
  }
}

const packJsonArrayPayloads = (items, maximumBytes = MAX_STATE_BATCH_JSON_BYTES) => {
  const payloads = []
  const oversized = []
  let parts = []
  let bytes = 2
  const flush = () => {
    if (!parts.length) return
    payloads.push(`[${parts.join(',')}]`)
    parts = []
    bytes = 2
  }
  for (const item of items) {
    const serialized = JSON.stringify(item)
    const itemBytes = jsonByteLength(serialized) + (parts.length ? 1 : 0)
    if (itemBytes + 2 > maximumBytes) {
      flush()
      oversized.push(item)
      continue
    }
    if (bytes + itemBytes > maximumBytes) flush()
    parts.push(serialized)
    bytes += jsonByteLength(serialized) + (parts.length > 1 ? 1 : 0)
  }
  flush()
  return { payloads, oversized }
}

const prepareStatePersistencePlan = (current, nextState, now) => {
  const compactState = {}
  const nextCollections = new Map()
  for (const [key, value] of Object.entries(nextState)) {
    if (Array.isArray(value)) nextCollections.set(key, value)
    else compactState[key] = value
  }
  const compactJson = JSON.stringify(compactState)
  if (jsonByteLength(compactJson) > MAX_COMPACT_STATE_BYTES) {
    throw new ApiError(413, 'STATE_SHELL_TOO_LARGE', 'Phần cấu hình trạng thái vượt giới hạn an toàn của D1.')
  }

  const existingCollections = current?._externalCollections instanceof Map
    ? current._externalCollections
    : new Map()
  const manifestCreates = []
  const manifestDeletes = []
  const entityUpserts = []
  const entityDeletes = []
  const collectionClears = []

  for (const key of nextCollections.keys()) {
    if (key.length > 512) throw new ApiError(400, 'STATE_COLLECTION_KEY_INVALID', 'Tên danh mục trạng thái quá dài.')
    if (!existingCollections.has(key)) manifestCreates.push(key)
  }
  for (const key of existingCollections.keys()) {
    if (!nextCollections.has(key)) manifestDeletes.push(key)
  }

  for (const [collectionKey, values] of nextCollections) {
    const existingRows = existingCollections.get(collectionKey)?.rows || []
    const queues = new Map()
    for (const row of existingRows) {
      const identity = stateEntityIdentity(row.value, row.valueJson)
      if (!queues.has(identity)) queues.set(identity, [])
      queues.get(identity).push(row)
    }
    const usedKeys = new Set()
    const descriptors = values.map((value) => {
      const valueJson = JSON.stringify(value) ?? 'null'
      const valueBytes = jsonByteLength(valueJson)
      if (valueBytes > MAX_STATE_ENTITY_BYTES) {
        throw new ApiError(413, 'STATE_ENTITY_TOO_LARGE', `Bản ghi trong ${collectionKey} vượt giới hạn an toàn của D1.`)
      }
      const identity = stateEntityIdentity(value, valueJson)
      const match = queues.get(identity)?.shift() || null
      if (match) usedKeys.add(match.entityKey)
      return { valueJson, valueBytes, match }
    })
    assignStateEntityOrders(descriptors)
    if (existingRows.length && usedKeys.size === 0) {
      collectionClears.push(collectionKey)
    } else {
      for (const row of existingRows) {
        if (!usedKeys.has(row.entityKey)) entityDeletes.push({ collectionKey, entityKey: row.entityKey })
      }
    }
    for (const descriptor of descriptors) {
      const entityKey = descriptor.match?.entityKey || `ent_${crypto.randomUUID()}`
      if (!descriptor.match
        || descriptor.match.valueJson !== descriptor.valueJson
        || descriptor.match.entityOrder !== descriptor.entityOrder) {
        entityUpserts.push({
          collectionKey,
          entityKey,
          entityOrder: descriptor.entityOrder,
          recordJson: descriptor.valueJson,
          valueBytes: descriptor.valueBytes,
          createdAt: descriptor.match?.createdAt || now,
        })
      }
    }
  }
  return {
    compactJson,
    manifestCreates,
    manifestDeletes,
    collectionClears,
    entityUpserts,
    entityDeletes,
  }
}

const stateSuccessSql = `
  SELECT 1 FROM app_state
  WHERE scope_key = ? AND version = ? AND last_request_id = ?
`

const statePersistenceStatements = (db, scope, plan, nextVersion, requestId, now) => {
  const statements = []
  for (const payload of packJsonArrayPayloads(plan.manifestCreates).payloads) {
    statements.push(db.prepare(`
      INSERT INTO state_collections (scope_key, collection_key, created_at, updated_at)
      SELECT ?, CAST(entry.value AS TEXT), ?, ?
      FROM json_each(?) AS entry
      WHERE EXISTS (${stateSuccessSql})
      ON CONFLICT(scope_key, collection_key) DO UPDATE SET updated_at = excluded.updated_at
    `).bind(scope, now, now, payload, scope, nextVersion, requestId))
  }
  for (const payload of packJsonArrayPayloads(plan.collectionClears).payloads) {
    statements.push(db.prepare(`
      DELETE FROM state_entities
      WHERE scope_key = ?
        AND EXISTS (${stateSuccessSql})
        AND collection_key IN (SELECT CAST(value AS TEXT) FROM json_each(?))
    `).bind(scope, scope, nextVersion, requestId, payload))
  }
  for (const payload of packJsonArrayPayloads(plan.entityDeletes).payloads) {
    statements.push(db.prepare(`
      DELETE FROM state_entities
      WHERE scope_key = ?
        AND EXISTS (${stateSuccessSql})
        AND EXISTS (
          SELECT 1 FROM json_each(?) AS entry
          WHERE json_extract(entry.value, '$.collectionKey') = state_entities.collection_key
            AND json_extract(entry.value, '$.entityKey') = state_entities.entity_key
        )
    `).bind(scope, scope, nextVersion, requestId, payload))
  }
  const packedUpserts = packJsonArrayPayloads(plan.entityUpserts)
  for (const payload of packedUpserts.payloads) {
    statements.push(db.prepare(`
      INSERT INTO state_entities (
        scope_key, collection_key, entity_key, entity_order, value_json, value_bytes, created_at, updated_at
      )
      SELECT
        ?,
        json_extract(entry.value, '$.collectionKey'),
        json_extract(entry.value, '$.entityKey'),
        json_extract(entry.value, '$.entityOrder'),
        json_extract(entry.value, '$.recordJson'),
        json_extract(entry.value, '$.valueBytes'),
        json_extract(entry.value, '$.createdAt'),
        ?
      FROM json_each(?) AS entry
      WHERE EXISTS (${stateSuccessSql})
      ON CONFLICT(scope_key, collection_key, entity_key) DO UPDATE SET
        entity_order = excluded.entity_order,
        value_json = excluded.value_json,
        value_bytes = excluded.value_bytes,
        updated_at = excluded.updated_at
    `).bind(scope, now, payload, scope, nextVersion, requestId))
  }
  for (const item of packedUpserts.oversized) {
    statements.push(db.prepare(`
      INSERT INTO state_entities (
        scope_key, collection_key, entity_key, entity_order, value_json, value_bytes, created_at, updated_at
      )
      SELECT ?, ?, ?, ?, ?, ?, ?, ?
      WHERE EXISTS (${stateSuccessSql})
      ON CONFLICT(scope_key, collection_key, entity_key) DO UPDATE SET
        entity_order = excluded.entity_order,
        value_json = excluded.value_json,
        value_bytes = excluded.value_bytes,
        updated_at = excluded.updated_at
    `).bind(
      scope,
      item.collectionKey,
      item.entityKey,
      item.entityOrder,
      item.recordJson,
      item.valueBytes,
      item.createdAt,
      now,
      scope,
      nextVersion,
      requestId,
    ))
  }
  for (const payload of packJsonArrayPayloads(plan.manifestDeletes).payloads) {
    statements.push(db.prepare(`
      DELETE FROM state_collections
      WHERE scope_key = ?
        AND EXISTS (${stateSuccessSql})
        AND collection_key IN (SELECT CAST(value AS TEXT) FROM json_each(?))
    `).bind(scope, scope, nextVersion, requestId, payload))
  }
  return statements
}

const prepareStateCommit = (db, {
  current,
  nextState,
  scope,
  currentVersion,
  nextVersion,
  now,
  actorId,
  requestId,
}) => {
  const plan = prepareStatePersistencePlan(current, nextState, now)
  const mutation = current
    ? db.prepare(`
        UPDATE app_state
        SET value_json = ?, version = ?, updated_at = ?, updated_by = ?, last_request_id = ?
        WHERE scope_key = ? AND version = ?
      `).bind(plan.compactJson, nextVersion, now, actorId, requestId, scope, currentVersion)
    : db.prepare(`
        INSERT OR IGNORE INTO app_state (
          scope_key, value_json, version, updated_at, updated_by, last_request_id
        ) VALUES (?, ?, ?, ?, ?, ?)
      `).bind(scope, plan.compactJson, nextVersion, now, actorId, requestId)
  return {
    mutation,
    compactJson: plan.compactJson,
    externalStatements: statePersistenceStatements(db, scope, plan, nextVersion, requestId, now),
  }
}

const boundedAuditJson = (value) => {
  if (value === undefined) return null
  const serialized = JSON.stringify(value)
  if (jsonByteLength(serialized) <= MAX_AUDIT_JSON_BYTES) return serialized
  const summary = {
    truncated: true,
    byteLength: jsonByteLength(serialized),
    kind: Array.isArray(value) ? 'array' : typeof value,
  }
  if (isPlainRecord(value)) {
    summary.id = value.id || value.code || value.employeeId || null
    summary.keys = Object.keys(value).slice(0, 100)
  }
  return JSON.stringify(summary)
}

const stateAuditSnapshot = (state) => ({
  stateVersion: Number(state?.stateVersion || 0),
  collections: Object.fromEntries(Object.entries(state || {})
    .filter(([, value]) => Array.isArray(value))
    .map(([key, value]) => [key, value.length])),
  scalarKeys: Object.entries(state || {}).filter(([, value]) => !Array.isArray(value)).map(([key]) => key),
})

const receiptStatements = (db, {
  actorId,
  idempotencyKey,
  requestHash: hash,
  responseJson,
  status,
  createdAt,
  successSql,
  successBindings,
  enforceSuccess = false,
}) => {
  const responseBytes = jsonByteLength(responseJson)
  const chunks = responseBytes > MAX_RECEIPT_INLINE_BYTES
    ? splitUtf8String(responseJson, MAX_RECEIPT_CHUNK_BYTES)
    : []
  const storedResponse = chunks.length
    ? JSON.stringify({ __idosiChunkedResponse: 1, chunkCount: chunks.length, byteLength: responseBytes })
    : responseJson
  const receipt = enforceSuccess
    ? db.prepare(`
        INSERT INTO command_receipts (
          actor_id, idempotency_key, request_hash, response_json, status_code, created_at
        ) VALUES (?, ?, (SELECT ? WHERE EXISTS (${successSql})), ?, ?, ?)
      `).bind(actorId, idempotencyKey, hash, ...successBindings, storedResponse, status, createdAt)
    : db.prepare(`
        INSERT INTO command_receipts (
          actor_id, idempotency_key, request_hash, response_json, status_code, created_at
        )
        SELECT ?, ?, ?, ?, ?, ?
        WHERE EXISTS (${successSql})
      `).bind(actorId, idempotencyKey, hash, storedResponse, status, createdAt, ...successBindings)
  return [
    receipt,
    ...chunks.map((chunk, index) => db.prepare(`
      INSERT INTO command_receipt_chunks (
        actor_id, idempotency_key, chunk_index, chunk_text, chunk_bytes, created_at
      )
      SELECT ?, ?, ?, ?, ?, ?
      WHERE EXISTS (
        SELECT 1 FROM command_receipts
        WHERE actor_id = ? AND idempotency_key = ? AND request_hash = ? AND created_at = ?
      )
    `).bind(
      actorId,
      idempotencyKey,
      index,
      chunk,
      jsonByteLength(chunk),
      createdAt,
      actorId,
      idempotencyKey,
      hash,
      createdAt,
    )),
  ]
}

const listPolicies = async (db) => {
  const rows = await all(db, `
    SELECT policy_key, value_json, version, effective_at, updated_at, updated_by
    FROM policies
    ORDER BY policy_key
  `)
  return rows.map((row) => ({
    key: row.policy_key,
    value: parseStoredJson(row.value_json),
    version: Number(row.version),
    effectiveAt: row.effective_at,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
  }))
}

const bootstrapDatabase = async (request, env, context) => {
  const db = getDatabase(env)
  const existing = await first(db, 'SELECT COUNT(*) AS count FROM users')
  if (Number(existing?.count) > 0) {
    return jsonResponse(apiPayload(context, { initialized: true, alreadyInitialized: true }))
  }

  const configuredToken = String(env?.BOOTSTRAP_TOKEN || '')
  const providedToken = String(request.headers.get('x-idosi-bootstrap-token') || '')
  if (!configuredToken) {
    throw new ApiError(503, 'BOOTSTRAP_DISABLED', 'Cần cấu hình khóa khởi tạo bảo mật trước lần sử dụng đầu tiên.')
  }
  if (!providedToken || !constantTimeEqual(configuredToken, providedToken)) {
    throw new ApiError(403, 'BOOTSTRAP_FORBIDDEN', 'Khóa khởi tạo không hợp lệ.')
  }

  const body = await readJson(request)
  const username = String(body.username || '').trim()
  const normalizedUsername = normalizeUsername(username)
  const displayName = String(body.displayName || 'Quản trị viên IDOSI').trim().slice(0, 160)
  if (!/^[A-Za-z0-9._-]{3,80}$/u.test(username)) {
    throw new ApiError(400, 'INVALID_USERNAME', 'Tên đăng nhập phải có từ 3 đến 80 ký tự hợp lệ.')
  }
  const initialState = body.initialState === undefined ? {} : body.initialState
  if (!isPlainRecord(initialState)) throw new ApiError(400, 'INVALID_STATE', 'Trạng thái ban đầu phải là một đối tượng JSON.')
  const normalizedInitialState = normalizeSharedStateForStorage(initialState)

  const password = await hashPassword(body.password)
  const userId = `usr_${crypto.randomUUID()}`
  const requestId = context.requestId
  const stateCommit = prepareStateCommit(db, {
    current: null,
    nextState: normalizedInitialState,
    scope: 'global',
    currentVersion: 0,
    nextVersion: 1,
    now: context.now,
    actorId: userId,
    requestId,
  })
  const statements = [
    db.prepare(`
      INSERT INTO system_metadata (meta_key, value_json, version, updated_at)
      VALUES ('bootstrap', ?, 1, ?)
    `).bind(JSON.stringify({ requestId, username: normalizedUsername }), context.now),
    db.prepare(`
      INSERT INTO users (
        id, username, username_normalized, display_name, password_hash, password_salt,
        password_iterations, password_algorithm, role, status, created_at, updated_at, password_updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'admin', 'active', ?, ?, ?)
    `).bind(
      userId,
      username,
      normalizedUsername,
      displayName,
      password.hash,
      password.salt,
      password.iterations,
      password.algorithm,
      context.now,
      context.now,
      context.now,
    ),
    stateCommit.mutation,
    ...stateCommit.externalStatements,
  ]
  for (const [key, value] of Object.entries(DEFAULT_POLICIES)) {
    statements.push(db.prepare(`
      INSERT INTO policies (
        policy_key, value_json, version, effective_at, updated_at, updated_by, last_request_id
      ) VALUES (?, ?, 1, ?, ?, ?, ?)
      ON CONFLICT(policy_key) DO UPDATE SET
        value_json = excluded.value_json,
        version = 1,
        effective_at = excluded.effective_at,
        updated_at = excluded.updated_at,
        updated_by = excluded.updated_by,
        last_request_id = excluded.last_request_id
    `).bind(key, JSON.stringify(value), context.now, context.now, userId, requestId))
  }
  for (const name of ['system:sessions']) {
    statements.push(db.prepare(`
      INSERT INTO counters (counter_name, counter_value, version, updated_at, last_request_id)
      VALUES (?, 0, 1, ?, ?)
    `).bind(name, context.now, requestId))
  }
  const orderCounterValues = new Map()
  const seenOrderCodes = new Set()
  for (const order of Array.isArray(normalizedInitialState.orders) ? normalizedInitialState.orders : []) {
    const orderCode = String(order?.code || '').trim().toUpperCase()
    const storeId = String(order?.storeId || '').trim()
    if (!orderCode || !storeId) continue
    if (seenOrderCodes.has(orderCode)) {
      throw new ApiError(400, 'DUPLICATE_ORDER_CODE', 'Dữ liệu ban đầu chứa mã đơn hàng bị trùng.')
    }
    seenOrderCodes.add(orderCode)
    const suffix = orderCode.match(/-(\d{5})$/u)
    if (!suffix) continue
    const value = Number(suffix[1])
    orderCounterValues.set(storeId, Math.max(orderCounterValues.get(storeId) || 0, value))
  }
  for (const [storeId, value] of orderCounterValues) {
    statements.push(db.prepare(`
      INSERT INTO counters (counter_name, counter_value, version, updated_at, last_request_id)
      VALUES (?, ?, 1, ?, ?)
    `).bind(`store:${storeId}:orders`, value, context.now, requestId))
  }
  let importCounterValue = 0
  const seenImportCodes = new Set()
  for (const voucher of Array.isArray(normalizedInitialState.importVouchers) ? normalizedInitialState.importVouchers : []) {
    const voucherCode = String(voucher?.code || '').trim().toUpperCase()
    if (!voucherCode) continue
    if (seenImportCodes.has(voucherCode)) {
      throw new ApiError(400, 'DUPLICATE_IMPORT_CODE', 'Dữ liệu ban đầu chứa mã phiếu nhập bị trùng.')
    }
    seenImportCodes.add(voucherCode)
    const suffix = voucherCode.match(/-(\d{4,5})$/u)
    if (suffix) importCounterValue = Math.max(importCounterValue, Number(suffix[1]))
  }
  statements.push(db.prepare(`
    INSERT INTO counters (counter_name, counter_value, version, updated_at, last_request_id)
    VALUES ('system:imports', ?, 1, ?, ?)
  `).bind(importCounterValue, context.now, requestId))
  statements.push(db.prepare(`
    INSERT INTO audit_log (
      request_id, actor_id, actor_role, action, entity_type, entity_id,
      before_json, after_json, metadata_json, server_timestamp
    ) VALUES (?, ?, 'admin', 'system.bootstrap', 'system', 'idosi', NULL, ?, ?, ?)
  `).bind(
    requestId,
    userId,
    JSON.stringify({ initialized: true }),
    JSON.stringify({ source: 'bootstrap-api' }),
    context.now,
  ))

  let created = true
  let admin
  try {
    await db.batch(statements)
  } catch (error) {
    admin = await first(db, `
      SELECT id, username, display_name, role
      FROM users
      WHERE role = 'admin'
      ORDER BY created_at, id
      LIMIT 1
    `)
    if (!admin) throw error
    created = false
  }
  admin ||= await first(db, `
    SELECT id, username, display_name, role FROM users WHERE username_normalized = ? LIMIT 1
  `, normalizedUsername)
  if (!admin) throw new ApiError(500, 'BOOTSTRAP_FAILED', 'Không thể xác nhận tài khoản quản trị ban đầu.')
  return jsonResponse(apiPayload(context, {
    initialized: true,
    alreadyInitialized: !created,
    admin: { id: admin.id, username: admin.username, displayName: admin.display_name, role: admin.role },
  }), created ? 201 : 200)
}

const login = async (request, env, context) => {
  const db = getDatabase(env)
  const body = await readJson(request)
  const username = normalizeUsername(body.username)
  const passwordValue = String(body.password || '')
  if (!/^[a-z0-9._-]{3,80}$/u.test(username) || passwordValue.length < 1 || passwordValue.length > 256) {
    throw new ApiError(400, 'CREDENTIALS_INVALID', 'Tên đăng nhập hoặc mật khẩu không hợp lệ.')
  }
  const user = await first(db, `
    SELECT * FROM users WHERE username_normalized = ? LIMIT 1
  `, username)

  const passwordRecord = user ? {
    hash: user.password_hash,
    salt: user.password_salt,
    iterations: user.password_iterations,
  } : {
    hash: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    salt: 'AAAAAAAAAAAAAAAAAAAAAA',
    iterations: DEFAULT_PBKDF2_ITERATIONS,
  }
  const matches = await verifyPassword(passwordValue, passwordRecord)
  if (!user || !matches) throw new ApiError(401, 'INVALID_CREDENTIALS', 'Tên đăng nhập hoặc mật khẩu chưa đúng.')
  if (!VALID_ACCOUNT_STATUSES.has(user.status) || user.status !== 'active') {
    throw new ApiError(403, 'ACCOUNT_DISABLED', 'Tài khoản hiện không ở trạng thái hoạt động.')
  }
  if (!VALID_ROLES.has(user.role)) throw new ApiError(403, 'ROLE_INVALID', 'Vai trò tài khoản không hợp lệ.')

  const rawToken = toBase64Url(randomBytes(32))
  const tokenHash = await sha256(rawToken)
  const sessionId = `ses_${crypto.randomUUID()}`
  const expiresAt = addSeconds(context.now, sessionTtlSeconds(env))
  const userAgent = String(request.headers.get('user-agent') || '').slice(0, 512)
  const ipAddress = String(request.headers.get('cf-connecting-ip') || '').slice(0, 80)
  await db.batch([
    db.prepare(`
      INSERT INTO sessions (
        id, token_hash, user_id, created_at, last_seen_at, expires_at, user_agent, ip_address
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(sessionId, tokenHash, user.id, context.now, context.now, expiresAt, userAgent, ipAddress),
    db.prepare('UPDATE users SET last_login_at = ?, updated_at = ? WHERE id = ?')
      .bind(context.now, context.now, user.id),
    db.prepare(`
      INSERT INTO audit_log (
        request_id, actor_id, actor_role, action, entity_type, entity_id,
        before_json, after_json, metadata_json, server_timestamp
      ) VALUES (?, ?, ?, 'auth.login', 'session', ?, NULL, ?, ?, ?)
    `).bind(
      context.requestId,
      user.id,
      user.role,
      sessionId,
      JSON.stringify({ expiresAt }),
      JSON.stringify({ userAgent, ipAddress: ipAddress || null }),
      context.now,
    ),
  ])

  const effectiveUser = await resolveEffectiveEmployeeStore(db, { ...user, last_login_at: context.now }, context.now)
  return jsonResponse(apiPayload(context, {
    token: rawToken,
    tokenType: 'Bearer',
    expiresAt,
    user: publicUser(effectiveUser),
  }))
}

const getBootstrap = async (request, env, context, url) => {
  const db = getDatabase(env)
  const user = await requireSession(request, db, context)
  const scope = url.searchParams.get('scope') || defaultScope(user)
  assertScope(user, scope)
  const [stateRow, policies] = await Promise.all([loadState(db, scope), listPolicies(db)])
  const rawState = stateRow ? parseStoredJson(stateRow.value_json, {}) : {}
  return jsonResponse(apiPayload(context, {
    user: publicUser(user),
    scope,
    projection: scope === 'global' ? user.role : 'private',
    state: scope === 'global' ? projectSharedState(rawState, user) : sanitizeStateValue(rawState),
    version: Number(stateRow?.version || 0),
    updatedAt: stateRow?.updated_at || null,
    policies,
  }))
}

const getState = async (request, env, context, url) => {
  const db = getDatabase(env)
  const user = await requireSession(request, db, context)
  const scope = url.searchParams.get('scope') || defaultScope(user)
  assertScope(user, scope)
  const [row, policies] = await Promise.all([loadState(db, scope), listPolicies(db)])
  const rawState = row ? parseStoredJson(row.value_json, {}) : {}
  return jsonResponse(apiPayload(context, {
    scope,
    projection: scope === 'global' ? user.role : 'private',
    state: scope === 'global' ? projectSharedState(rawState, user) : sanitizeStateValue(rawState),
    version: Number(row?.version || 0),
    updatedAt: row?.updated_at || null,
    updatedBy: row?.updated_by || null,
    policies,
  }))
}

const DOMAIN_PROTECTED_STATE_COLLECTIONS = new Set([
  'attendance',
  'attendanceAudit',
  'tasks',
  'taskAssignmentHistory',
  'orders',
  'orderAudit',
  'operationalResetHistory',
  'supportTransfers',
  'supportWorkAssignments',
  'expenseEntries',
  'fixedExpenses',
  'cashTransactions',
  'importVouchers',
  'salaryAdjustments',
  'salaryAdvances',
  'payrollPeriods',
  'payrollPayments',
])

const assertProtectedCollectionsUnchanged = (currentState, nextState) => {
  for (const key of DOMAIN_PROTECTED_STATE_COLLECTIONS) {
    if (JSON.stringify(canonicalize(currentState?.[key])) !== JSON.stringify(canonicalize(nextState?.[key]))) {
      throw new ApiError(400, 'DOMAIN_COMMAND_REQUIRED', `Bộ sưu tập ${key} chỉ được thay đổi bằng lệnh nghiệp vụ.`)
    }
  }
}

const preserveNotificationReadReceipts = (currentState, nextState) => {
  const currentById = new Map((Array.isArray(currentState?.notifications) ? currentState.notifications : [])
    .map((record) => [String(record.id || record.notificationId || ''), record]))
  return (Array.isArray(nextState?.notifications) ? nextState.notifications : []).map((record) => {
    const id = String(record.id || record.notificationId || '')
    const current = currentById.get(id)
    const { readAtByUserId: _incomingReceipts, readByUserIds: _incomingReaderIds, ...safe } = record
    void _incomingReceipts
    void _incomingReaderIds
    if (!current) {
      const { readAt: _incomingReadAt, read: _incomingRead, isRead: _incomingIsRead, ...created } = safe
      void _incomingReadAt
      void _incomingRead
      void _incomingIsRead
      return created
    }
    const restored = {
      ...safe,
      readAt: current.readAt || null,
      ...(current.read !== undefined ? { read: current.read } : {}),
      ...(current.isRead !== undefined ? { isRead: current.isRead } : {}),
    }
    if (isPlainRecord(current.readAtByUserId)) restored.readAtByUserId = current.readAtByUserId
    return restored
  })
}

const stateCommand = async (db, user, body, commandContext) => {
  const scope = String(body.scope || defaultScope(user))
  assertScope(user, scope, true)
  const expectedVersion = validateExpectedVersion(body.expectedVersion)
  const current = await loadState(db, scope)
  const currentVersion = Number(current?.version || 0)
  if (currentVersion !== expectedVersion) {
    throw new ApiError(409, 'VERSION_CONFLICT', 'Dữ liệu đã thay đổi trên máy chủ.', { currentVersion })
  }

  const payload = isPlainRecord(body.payload) ? body.payload : {}
  const currentState = current ? parseStoredJson(current.value_json, {}) : {}
  if (scope === 'global') {
    const rawMutation = body.type === 'state.replace' ? payload.state : payload.patch
    if (isPlainRecord(rawMutation) && Object.hasOwn(rawMutation, 'accountSettings')) {
      throw new ApiError(
        400,
        'DOMAIN_COMMAND_REQUIRED',
        'Thiết lập tài khoản chỉ được thay đổi bằng lệnh account_settings.update.',
      )
    }
  }
  let nextState
  if (body.type === 'state.replace') {
    nextState = payload.state
  } else {
    if (!isPlainRecord(currentState) || !isPlainRecord(payload.patch)) {
      throw new ApiError(400, 'INVALID_STATE_PATCH', 'Dữ liệu cập nhật trạng thái không hợp lệ.')
    }
    nextState = { ...currentState, ...payload.patch }
  }
  if (!isPlainRecord(nextState)) throw new ApiError(400, 'INVALID_STATE', 'Trạng thái phải là một đối tượng JSON.')
  if (scope === 'global') assertProtectedCollectionsUnchanged(currentState, nextState)
  nextState = normalizeSharedStateForStorage(nextState)
  if (scope === 'global') {
    const currentAccountSettings = normalizeSharedStateForStorage(currentState).accountSettings
    nextState.accountSettings = isPlainRecord(currentAccountSettings) ? currentAccountSettings : {}
    nextState.notifications = preserveNotificationReadReceipts(currentState, nextState)
  }
  const nextVersion = currentVersion + 1
  const responseBody = apiPayload(commandContext, {
    command: body.type,
    scope,
    state: scope === 'global' ? projectSharedState(nextState, user) : nextState,
    version: nextVersion,
    updatedAt: commandContext.now,
  })
  const responseJson = JSON.stringify(responseBody)
  const stateCommit = prepareStateCommit(db, {
    current,
    nextState,
    scope,
    currentVersion,
    nextVersion,
    now: commandContext.now,
    actorId: user.user_id,
    requestId: commandContext.requestId,
  })

  const results = await db.batch([
    stateCommit.mutation,
    ...stateCommit.externalStatements,
    db.prepare(`
      INSERT INTO audit_log (
        request_id, actor_id, actor_role, action, entity_type, entity_id,
        before_json, after_json, metadata_json, server_timestamp
      )
      SELECT ?, ?, ?, ?, 'state', ?, ?, ?, ?, ?
      WHERE EXISTS (
        SELECT 1 FROM app_state WHERE scope_key = ? AND version = ? AND last_request_id = ?
      )
    `).bind(
      commandContext.requestId,
      user.user_id,
      user.role,
      body.type,
      scope,
      current ? boundedAuditJson(scope === 'global'
        ? stateAuditSnapshot(normalizeSharedStateForStorage(currentState))
        : stateAuditSnapshot(sanitizeStateValue(currentState))) : null,
      boundedAuditJson(stateAuditSnapshot(nextState)),
      JSON.stringify({ fromVersion: currentVersion, toVersion: nextVersion }),
      commandContext.now,
      scope,
      nextVersion,
      commandContext.requestId,
    ),
    ...receiptStatements(db, {
      actorId: user.user_id,
      idempotencyKey: commandContext.idempotencyKey,
      requestHash: commandContext.hash,
      responseJson,
      status: 200,
      createdAt: commandContext.now,
      successSql: stateSuccessSql,
      successBindings: [scope, nextVersion, commandContext.requestId],
    }),
  ])
  if (changes(results?.[0]) !== 1) {
    const latest = await loadState(db, scope)
    throw new ApiError(409, 'VERSION_CONFLICT', 'Dữ liệu đã thay đổi trên máy chủ.', {
      currentVersion: Number(latest?.version || 0),
    })
  }
  return jsonResponse(responseBody)
}

const validatePolicy = (key, value) => {
  if (!Object.hasOwn(DEFAULT_POLICIES, key)) {
    throw new ApiError(400, 'POLICY_UNKNOWN', 'Chính sách không được hỗ trợ.')
  }
  const number = Number(value)
  if (!Number.isFinite(number) || number < 0) {
    throw new ApiError(400, 'POLICY_VALUE_INVALID', 'Giá trị chính sách phải là số không âm.')
  }
  if (key === 'late_tolerance_minutes' || key === 'early_check_in_limit_minutes') {
    if (!Number.isInteger(number) || number > 1_440) {
      throw new ApiError(400, 'POLICY_VALUE_INVALID', 'Số phút đi trễ phải là số nguyên từ 0 đến 1.440.')
    }
    return number
  }
  if (key === 'attendance_maintain_max_late_count' || key === 'attendance_improve_min_late_count') {
    if (!Number.isInteger(number) || number > 366) {
      throw new ApiError(400, 'POLICY_VALUE_INVALID', 'Số lần đi trễ phải là số nguyên từ 0 đến 366.')
    }
    return number
  }
  if (key === 'attendance_improve_min_late_minutes') {
    if (!Number.isInteger(number) || number > 44_640) {
      throw new ApiError(400, 'POLICY_VALUE_INVALID', 'Tổng phút đi trễ phải là số nguyên từ 0 đến 44.640.')
    }
    return number
  }
  if (number > 100) throw new ApiError(400, 'POLICY_VALUE_INVALID', 'Tỷ lệ phần trăm không được vượt quá 100.')
  return number
}

const serverCounterCode = (name, value, serverTimestamp) => {
  const parts = String(name).split(':')
  const kind = String(parts.at(-1) || '').toLocaleLowerCase('vi-VN')
  const sequence = String(value).padStart(5, '0')
  if (parts[0] === 'store' && parts[1] && kind === 'orders') {
    const storeCode = parts[1].toUpperCase().replace(/[^A-Z0-9]/gu, '').slice(0, 20)
    if (!storeCode) throw new ApiError(400, 'COUNTER_NAME_INVALID', 'Bộ đếm đơn hàng thiếu mã cửa hàng hợp lệ.')
    return `${storeCode}-${sequence}`
  }
  if (kind === 'imports') {
    const local = localDateTimeParts(serverTimestamp)
    const [year, month, day] = local.date.split('-')
    return `PN-${day}/${month}/${year.slice(-2)}-${String(value).padStart(4, '0')}`
  }
  const serverPrefix = kind.toUpperCase().replace(/[^A-Z0-9]/gu, '').slice(0, 12) || 'ID'
  return `${serverPrefix}-${sequence}`
}

const policyNumber = async (db, key, fallback) => {
  const row = await first(db, 'SELECT value_json FROM policies WHERE policy_key = ? LIMIT 1', key)
  const value = Number(parseStoredJson(row?.value_json, fallback))
  return Number.isFinite(value) ? value : fallback
}

const commitGlobalStateDomainCommand = async (db, actor, current, nextState, options, commandContext) => {
  const currentVersion = Number(current.version)
  const nextVersion = currentVersion + 1
  const receiptBody = apiPayload(commandContext, { ...options.response, version: nextVersion })
  const responseBody = options.ephemeralResponse
    ? apiPayload(commandContext, { ...options.response, ...options.ephemeralResponse, version: nextVersion })
    : receiptBody
  const responseJson = JSON.stringify(receiptBody)
  const stateGuardSql = options.stateGuard?.sql ? ` AND EXISTS (${options.stateGuard.sql})` : ''
  const stateGuardBindings = Array.isArray(options.stateGuard?.bindings) ? options.stateGuard.bindings : []
  const additionalStatements = Array.isArray(options.additionalStatements) ? options.additionalStatements : []
  const stateCommit = prepareStateCommit(db, {
    current,
    nextState,
    scope: 'global',
    currentVersion,
    nextVersion,
    now: commandContext.now,
    actorId: actor.user_id,
    requestId: commandContext.requestId,
  })
  const stateMutation = options.stateGuard?.sql
    ? db.prepare(`
        UPDATE app_state
        SET value_json = ?, version = ?, updated_at = ?, updated_by = ?, last_request_id = ?
        WHERE scope_key = 'global' AND version = ?${stateGuardSql}
      `).bind(
        stateCommit.compactJson,
        nextVersion,
        commandContext.now,
        actor.user_id,
        commandContext.requestId,
        currentVersion,
        ...stateGuardBindings,
      )
    : stateCommit.mutation
  let results
  try {
    results = await db.batch([
      stateMutation,
      ...stateCommit.externalStatements,
      ...additionalStatements,
      db.prepare(`
        INSERT INTO audit_log (
          request_id, actor_id, actor_role, action, entity_type, entity_id,
          before_json, after_json, metadata_json, server_timestamp
        )
        SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        WHERE EXISTS (
          SELECT 1 FROM app_state
          WHERE scope_key = 'global' AND version = ? AND last_request_id = ?
        )
      `).bind(
        commandContext.requestId,
        actor.user_id,
        actor.role,
        options.action,
        options.entityType,
        options.entityId,
        boundedAuditJson(options.before),
        boundedAuditJson(options.after),
        boundedAuditJson(options.metadata),
        commandContext.now,
        nextVersion,
        commandContext.requestId,
      ),
      ...receiptStatements(db, {
        actorId: actor.user_id,
        idempotencyKey: commandContext.idempotencyKey,
        requestHash: commandContext.hash,
        responseJson,
        status: options.status || 200,
        createdAt: commandContext.now,
        successSql: stateSuccessSql,
        successBindings: ['global', nextVersion, commandContext.requestId],
      }),
    ])
  } catch {
    const latest = await loadState(db, 'global')
    throw new ApiError(409, 'VERSION_CONFLICT', 'Dữ liệu đã thay đổi trên máy chủ.', {
      currentVersion: Number(latest?.version || 0),
    })
  }
  if (changes(results?.[0]) !== 1) {
    const latest = await loadState(db, 'global')
    throw new ApiError(409, 'VERSION_CONFLICT', 'Dữ liệu đã thay đổi trên máy chủ.', {
      currentVersion: Number(latest?.version || 0),
    })
  }
  return jsonResponse(responseBody, options.status || 200)
}

const commitGlobalStateCounterDomainCommand = async (
  db,
  actor,
  current,
  nextState,
  counter,
  options,
  commandContext,
) => {
  const currentVersion = Number(current.version)
  const nextVersion = currentVersion + 1
  const counterVersion = Number(counter.row?.version || 0)
  const nextCounterVersion = counterVersion + 1
  const status = options.status || 200
  const responseBody = apiPayload(commandContext, {
    ...options.response,
    version: nextVersion,
    counter: { name: counter.name, value: counter.value, version: nextCounterVersion },
  })
  const responseJson = JSON.stringify(responseBody)
  const stateCommit = prepareStateCommit(db, {
    current,
    nextState,
    scope: 'global',
    currentVersion,
    nextVersion,
    now: commandContext.now,
    actorId: actor.user_id,
    requestId: commandContext.requestId,
  })
  const counterMutation = counter.row
    ? db.prepare(`
        UPDATE counters
        SET counter_value = ?, version = ?, updated_at = ?, last_request_id = ?
        WHERE counter_name = ? AND version = ?
      `).bind(counter.value, nextCounterVersion, commandContext.now, commandContext.requestId, counter.name, counterVersion)
    : db.prepare(`
        INSERT OR IGNORE INTO counters (counter_name, counter_value, version, updated_at, last_request_id)
        VALUES (?, ?, 1, ?, ?)
      `).bind(counter.name, counter.value, commandContext.now, commandContext.requestId)
  let results
  try {
    results = await db.batch([
      stateCommit.mutation,
      counterMutation,
      ...stateCommit.externalStatements,
      db.prepare(`
        INSERT INTO audit_log (
          request_id, actor_id, actor_role, action, entity_type, entity_id,
          before_json, after_json, metadata_json, server_timestamp
        )
        SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        WHERE EXISTS (
          SELECT 1 FROM app_state WHERE scope_key = 'global' AND version = ? AND last_request_id = ?
        ) AND EXISTS (
          SELECT 1 FROM counters WHERE counter_name = ? AND version = ? AND last_request_id = ?
        )
      `).bind(
        commandContext.requestId,
        actor.user_id,
        actor.role,
        options.action,
        options.entityType,
        options.entityId,
        boundedAuditJson(options.before),
        boundedAuditJson(options.after),
        boundedAuditJson(options.metadata),
        commandContext.now,
        nextVersion,
        commandContext.requestId,
        counter.name,
        nextCounterVersion,
        commandContext.requestId,
      ),
      ...receiptStatements(db, {
        actorId: actor.user_id,
        idempotencyKey: commandContext.idempotencyKey,
        requestHash: commandContext.hash,
        responseJson,
        status,
        createdAt: commandContext.now,
        successSql: `
          SELECT 1 FROM app_state
          WHERE scope_key = 'global' AND version = ? AND last_request_id = ?
            AND EXISTS (
              SELECT 1 FROM counters WHERE counter_name = ? AND version = ? AND last_request_id = ?
            )
        `,
        successBindings: [
          nextVersion,
          commandContext.requestId,
          counter.name,
          nextCounterVersion,
          commandContext.requestId,
        ],
        enforceSuccess: true,
      }),
    ])
  } catch {
    const latest = await loadState(db, 'global')
    throw new ApiError(409, 'VERSION_CONFLICT', 'Dữ liệu hoặc bộ đếm đã thay đổi trên máy chủ.', {
      currentVersion: Number(latest?.version || 0),
    })
  }
  if (changes(results?.[0]) !== 1 || changes(results?.[1]) !== 1) {
    throw new ApiError(409, 'VERSION_CONFLICT', 'Dữ liệu hoặc bộ đếm đã thay đổi trên máy chủ.')
  }
  return jsonResponse(responseBody, status)
}

const serverActorSnapshot = (actor) => ({
  id: actor.user_id,
  name: actor.display_name || actor.username || 'Hệ thống',
  role: actor.role,
})

const assertAdmin = (actor, message = 'Chỉ quản trị viên được thực hiện thao tác này.') => {
  if (actor.role !== 'admin') throw new ApiError(403, 'ROLE_FORBIDDEN', message)
}

const assertOperationsRole = (actor, message = 'Tài khoản không có quyền thực hiện thao tác này.') => {
  if (!OPERATIONS_ROLES.has(actor.role)) throw new ApiError(403, 'ROLE_FORBIDDEN', message)
}

const businessSupportCommandAllowed = (body) => {
  const type = String(body?.type || '')
  return BUSINESS_SUPPORT_SELF_SERVICE_COMMANDS.has(type) || BUSINESS_SUPPORT_DOMAIN_COMMANDS.has(type)
}

const assertOperationalStoreAccess = (actor, storeId) => {
  const normalizedStoreId = String(storeId || '')
  if (actor.role === 'business_support'
    && (!normalizedStoreId || [OFFICE_STORE_ID, BUSINESS_SUPPORT_STORE_ID].includes(normalizedStoreId))) {
    throw new ApiError(403, 'OFFICE_FORBIDDEN', 'Nhân viên hỗ trợ kinh doanh không có quyền thao tác Khối văn phòng hoặc đơn vị nội bộ.')
  }
  if (actor.role === 'store_manager'
    && (!normalizedStoreId || normalizedStoreId !== String(actor.store_id || ''))) {
    throw new ApiError(403, 'STORE_SCOPE_FORBIDDEN', 'Quản lý cửa hàng chỉ được thao tác đúng cửa hàng được phân công.')
  }
}

const loadGlobalCommandState = async (db, body) => {
  const expectedVersion = validateExpectedVersion(body.expectedVersion)
  const current = await loadState(db, 'global')
  const currentVersion = Number(current?.version || 0)
  if (!current || currentVersion !== expectedVersion) {
    throw new ApiError(409, 'VERSION_CONFLICT', 'Dữ liệu đã thay đổi trên máy chủ.', { currentVersion })
  }
  return {
    current,
    state: normalizeSharedStateForStorage(parseStoredJson(current.value_json, {})),
  }
}

const nextStoreCode = (state) => {
  const knownStores = [
    ...(Array.isArray(state.stores) ? state.stores : []),
    ...(Array.isArray(state.deletedStores) ? state.deletedStores : []),
  ]
  const next = knownStores.reduce((maximum, store) => {
    const match = String(store?.id || '').match(/^CH(\d+)$/u)
    return match ? Math.max(maximum, Number(match[1])) : maximum
  }, 0) + 1
  return `CH${String(next).padStart(3, '0')}`
}

const storeCommand = async (db, actor, body, commandContext) => {
  assertOperationsRole(actor, 'Chỉ Admin, Nhân viên hỗ trợ KD hoặc Quản lý cửa hàng được cập nhật cửa hàng.')
  const operation = body.type.split('.').at(-1)
  if (!['create', 'update', 'delete'].includes(operation)) {
    throw new ApiError(400, 'COMMAND_UNKNOWN', 'Lệnh cửa hàng không được hỗ trợ.')
  }
  if (operation === 'delete') assertAdmin(actor, 'Chỉ Admin được xóa cửa hàng.')
  if (actor.role === 'store_manager' && operation !== 'update') {
    throw new ApiError(403, 'STORE_SCOPE_FORBIDDEN', 'Quản lý cửa hàng chỉ được cập nhật cửa hàng được phân công.')
  }
  const payload = isPlainRecord(body.payload) ? body.payload : {}
  const { current, state } = await loadGlobalCommandState(db, body)
  const stores = Array.isArray(state.stores) ? state.stores : []
  const storeId = operation === 'create'
    ? String(payload.id || nextStoreCode(state)).trim().toUpperCase()
    : String(payload.storeId || payload.id || '').trim()
  if (operation !== 'create') assertOperationalStoreAccess(actor, storeId)
  if (!/^[A-Za-z0-9_-]{1,80}$/u.test(storeId) || storeId === 'OFFICE') {
    throw new ApiError(400, 'STORE_ID_INVALID', 'Mã cửa hàng không hợp lệ.')
  }
  const existing = stores.find((store) => String(store.id || '') === storeId)

  if (operation === 'create') {
    if (existing && !existing.deletedAt) throw new ApiError(409, 'STORE_EXISTS', 'Mã cửa hàng đã tồn tại.')
    if ((Array.isArray(state.deletedStores) ? state.deletedStores : []).some((store) => String(store.id || '') === storeId)) {
      throw new ApiError(409, 'STORE_ID_RETIRED', 'Mã cửa hàng đã được sử dụng và không thể cấp lại.')
    }
    const name = String(payload.name || '').trim().slice(0, 160)
    if (!name) throw new ApiError(400, 'STORE_NAME_INVALID', 'Tên cửa hàng không được để trống.')
    if (stores.some((store) => !store.deletedAt && normalizeTextKey(store.name) === normalizeTextKey(name))) {
      throw new ApiError(409, 'STORE_EXISTS', 'Tên cửa hàng đã tồn tại.')
    }
    const phone = String(payload.phone || '').replace(/\D/gu, '')
    if (phone && !/^0\d{9}$/u.test(phone)) {
      throw new ApiError(400, 'PHONE_INVALID', 'Số điện thoại cửa hàng phải có đúng 10 số và bắt đầu bằng số 0.')
    }
    const email = String(payload.email || '').trim().toLowerCase()
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) {
      throw new ApiError(400, 'EMAIL_INVALID', 'Email cửa hàng không đúng định dạng.')
    }
    const tax = String(payload.tax ?? payload.taxCode ?? '').trim().slice(0, 64)
    const operatingHours = isPlainRecord(payload.operatingHours) ? payload.operatingHours : {}
    const opening = parseShiftTime(payload.opening ?? payload.openingTime ?? operatingHours.opening ?? '07:00')
    const closing = parseShiftTime(payload.closing ?? payload.closingTime ?? operatingHours.closing ?? '23:00')
    if (!opening || !closing || closing.minuteOfDay <= opening.minuteOfDay) {
      throw new ApiError(400, 'STORE_HOURS_INVALID', 'Giờ mở/đóng cửa phải theo định dạng 24 giờ và giờ đóng phải sau giờ mở.')
    }
    const store = {
      id: storeId,
      name,
      short: String(payload.short || name.replace(/^(?:IDOSI|SecondMall)\s*/iu, '')).trim().slice(0, 80),
      location: String(payload.location || '').trim().slice(0, 160),
      address: String(payload.address || '').trim().slice(0, 500),
      phone,
      email: email.slice(0, 254),
      tax,
      taxCode: tax,
      opening: opening.label,
      openingTime: opening.label,
      closing: closing.label,
      closingTime: closing.label,
      operatingHours: { opening: opening.label, closing: closing.label },
      status: ['Ngưng hoạt động', 'inactive'].includes(String(payload.status)) ? 'Ngưng hoạt động' : 'Đang hoạt động',
      accent: String(payload.accent || '#075fba').trim().slice(0, 32),
      employees: 0,
      revenue: 0,
      expense: 0,
      createdAt: commandContext.now,
      createdBy: serverActorSnapshot(actor),
    }
    const nextState = {
      ...state,
      stores: [store, ...stores.filter((item) => String(item.id || '') !== storeId)],
      stateVersion: Math.max(1, Number(state.stateVersion) || 1) + 1,
    }
    return commitGlobalStateDomainCommand(db, actor, current, nextState, {
      action: body.type,
      entityType: 'store',
      entityId: storeId,
      before: null,
      after: store,
      response: { command: body.type, store },
      status: 201,
    }, commandContext)
  }

  if (!existing || existing.deletedAt) throw new ApiError(404, 'STORE_NOT_FOUND', 'Không tìm thấy cửa hàng.')
  if (operation === 'delete') {
    const hasOrders = (Array.isArray(state.orders) ? state.orders : []).some((order) => (
      String(order.storeId || '') === storeId && !order.deletedAt && order.status !== 'Đã xóa'
      && order.source !== 'legacy-opening-balance'
    ))
    const hasEmployees = (Array.isArray(state.employees) ? state.employees : []).some((employee) => (
      String(employee.storeId || '') === storeId && !employee.deletedAt
      && !['Đã nghỉ việc', 'inactive'].includes(String(employee.status || ''))
    ))
    if (hasOrders || hasEmployees) {
      throw new ApiError(409, 'STORE_IN_USE', 'Không thể xóa cửa hàng đang có đơn hàng hoặc nhân viên.')
    }
    const deleted = { ...existing, deletedAt: commandContext.now, deletedBy: serverActorSnapshot(actor) }
    const nextState = {
      ...state,
      stores: stores.filter((store) => String(store.id || '') !== storeId),
      deletedStores: [deleted, ...(Array.isArray(state.deletedStores) ? state.deletedStores : [])],
      stateVersion: Math.max(1, Number(state.stateVersion) || 1) + 1,
    }
    return commitGlobalStateDomainCommand(db, actor, current, nextState, {
      action: body.type,
      entityType: 'store',
      entityId: storeId,
      before: existing,
      after: null,
      response: { command: body.type, store: deleted },
    }, commandContext)
  }

  const candidate = { ...existing }
  if (payload.name !== undefined) candidate.name = String(payload.name || '').trim().slice(0, 160)
  if (payload.short !== undefined) candidate.short = String(payload.short || '').trim().slice(0, 80)
  if (payload.location !== undefined) candidate.location = String(payload.location || '').trim().slice(0, 160)
  if (payload.address !== undefined) candidate.address = String(payload.address || '').trim().slice(0, 500)
  if (payload.accent !== undefined) candidate.accent = String(payload.accent || '').trim().slice(0, 32)
  if (payload.phone !== undefined) candidate.phone = String(payload.phone || '').replace(/\D/gu, '')
  if (payload.email !== undefined) candidate.email = String(payload.email || '').trim().toLowerCase().slice(0, 254)
  if (payload.tax !== undefined || payload.taxCode !== undefined) {
    candidate.tax = String(payload.tax ?? payload.taxCode ?? '').trim().slice(0, 64)
    candidate.taxCode = candidate.tax
  }
  const operatingHours = isPlainRecord(payload.operatingHours) ? payload.operatingHours : {}
  if (payload.opening !== undefined || payload.openingTime !== undefined || operatingHours.opening !== undefined) {
    candidate.opening = String(payload.opening ?? payload.openingTime ?? operatingHours.opening ?? '').trim()
    candidate.openingTime = candidate.opening
  }
  if (payload.closing !== undefined || payload.closingTime !== undefined || operatingHours.closing !== undefined) {
    candidate.closing = String(payload.closing ?? payload.closingTime ?? operatingHours.closing ?? '').trim()
    candidate.closingTime = candidate.closing
  }
  if (payload.status !== undefined) {
    const status = String(payload.status || '')
    if (!['Đang hoạt động', 'Ngưng hoạt động', 'Hoạt động'].includes(status)) {
      throw new ApiError(400, 'STORE_STATUS_INVALID', 'Trạng thái cửa hàng không hợp lệ.')
    }
    candidate.status = status === 'Hoạt động' ? 'Đang hoạt động' : status
  }
  if (!candidate.name || !candidate.short) {
    throw new ApiError(400, 'STORE_INVALID', 'Tên và tên viết tắt của cửa hàng là bắt buộc.')
  }
  if (candidate.phone && !/^0\d{9}$/u.test(candidate.phone)) {
    throw new ApiError(400, 'PHONE_INVALID', 'Số điện thoại cửa hàng phải có đúng 10 số và bắt đầu bằng số 0.')
  }
  if (candidate.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(candidate.email)) {
    throw new ApiError(400, 'EMAIL_INVALID', 'Email cửa hàng không đúng định dạng.')
  }
  const opening = parseShiftTime(candidate.opening ?? candidate.openingTime ?? '07:00')
  const closing = parseShiftTime(candidate.closing ?? candidate.closingTime ?? '23:00')
  if (!opening || !closing || closing.minuteOfDay <= opening.minuteOfDay) {
    throw new ApiError(400, 'STORE_HOURS_INVALID', 'Giờ mở/đóng cửa phải theo định dạng 24 giờ và giờ đóng phải sau giờ mở.')
  }
  candidate.opening = opening.label
  candidate.openingTime = opening.label
  candidate.closing = closing.label
  candidate.closingTime = closing.label
  candidate.operatingHours = { opening: opening.label, closing: closing.label }
  const changedFields = [
    'name', 'short', 'location', 'address', 'accent', 'status', 'phone', 'email',
    'tax', 'taxCode', 'opening', 'openingTime', 'closing', 'closingTime', 'operatingHours',
  ]
    .filter((key) => JSON.stringify(candidate[key]) !== JSON.stringify(existing[key]))
  if (!changedFields.length) {
    return recordNoopCommand(db, actor, {
      command: body.type,
      version: Number(current.version),
      store: existing,
      existing: true,
    }, 200, commandContext)
  }
  const updated = { ...candidate, updatedAt: commandContext.now, updatedBy: serverActorSnapshot(actor) }
  const nextState = {
    ...state,
    stores: stores.map((store) => String(store.id || '') === storeId ? updated : store),
    stateVersion: Math.max(1, Number(state.stateVersion) || 1) + 1,
  }
  return commitGlobalStateDomainCommand(db, actor, current, nextState, {
    action: body.type,
    entityType: 'store',
    entityId: storeId,
    before: existing,
    after: updated,
    metadata: { changedFields },
    response: { command: body.type, store: updated },
  }, commandContext)
}

const taskAssignmentCommand = async (db, actor, body, commandContext) => {
  assertOperationsRole(actor, 'Tài khoản không có quyền giao việc cửa hàng.')
  if (!['tasks.assign', 'tasks.replace_scope'].includes(body.type)) {
    throw new ApiError(400, 'COMMAND_UNKNOWN', 'Lệnh giao việc cửa hàng không được hỗ trợ.')
  }
  const payload = isPlainRecord(body.payload) ? body.payload : {}
  const storeId = String(payload.storeId || '').trim()
  assertOperationalStoreAccess(actor, storeId)
  const date = String(payload.date || '').trim()
  const shiftId = String(payload.shiftId || '').trim()
  if (!/^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/u.test(date)) {
    throw new ApiError(400, 'TASK_DATE_INVALID', 'Ngày giao việc phải có định dạng YYYY-MM-DD.')
  }
  if (shiftId && !/^[A-Za-z0-9_-]{1,80}$/u.test(shiftId)) {
    throw new ApiError(400, 'SHIFT_INVALID', 'Ca làm việc không hợp lệ.')
  }
  if (!Array.isArray(payload.tasks) || payload.tasks.length > 100
    || (body.type === 'tasks.assign' && payload.tasks.length < 1)) {
    throw new ApiError(400, 'TASKS_INVALID', 'Danh sách giao việc phải có từ 1 đến 100 công việc.')
  }
  const { current, state } = await loadGlobalCommandState(db, body)
  const store = requireStore(state, storeId)
  if (shiftId) {
    const shift = (Array.isArray(state.shiftDefinitions) ? state.shiftDefinitions : []).find((definition) => (
      String(definition.id || '') === shiftId
      && !definition.deletedAt
      && definition.active !== false
    ))
    if (!shift || String(shift.storeId || '') !== storeId) {
      throw new ApiError(400, 'SHIFT_INVALID', 'Ca làm việc không tồn tại hoặc không thuộc cửa hàng.')
    }
    if (shift.date && String(shift.date) !== date) {
      throw new ApiError(400, 'SHIFT_DATE_MISMATCH', `Ca ${shift.name || shift.id} chỉ áp dụng ngày ${shift.date}.`)
    }
  }
  const employeeIds = Array.isArray(payload.employeeIds)
    ? [...new Set(payload.employeeIds.map((value) => String(value || '').trim()).filter(Boolean))]
    : []
  if (body.type === 'tasks.assign' && !employeeIds.length) {
    throw new ApiError(400, 'TASK_ASSIGNEES_REQUIRED', 'Cần chọn ít nhất một nhân viên nhận việc.')
  }
  const activeStoreEmployees = new Map((Array.isArray(state.employees) ? state.employees : [])
    .filter((employee) => (
      employeeWorksAtStoreOnDate(state, employee, storeId, date)
      && employeeUnit(employee) === 'store'
      && !employee.deletedAt
      && !['da nghi viec', 'tam ngung', 'inactive', 'locked'].includes(normalizeTextKey(employee.status))
    ))
    .map((employee) => [String(employee.id || employee.code || ''), employee]))
  const invalidEmployeeIds = employeeIds.filter((employeeId) => !activeStoreEmployees.has(employeeId))
  if (invalidEmployeeIds.length) {
    throw new ApiError(400, 'EMPLOYEE_STORE_MISMATCH', 'Danh sách nhận việc có nhân viên không thuộc cửa hàng hoặc không còn hoạt động.', {
      employeeIds: invalidEmployeeIds,
    })
  }
  const assignmentId = `tsa_${crypto.randomUUID()}`
  const existingTasks = Array.isArray(state.tasks) ? state.tasks : []
  const previousTasks = existingTasks.filter((task) => (
    String(task.storeId || '') === storeId
    && String(task.shiftId || task.shift || '') === shiftId
    && String(task.date || task.workDate || '') === date
  ))
  const replaceableTaskIds = new Set(body.type === 'tasks.replace_scope'
    ? previousTasks.map((task) => String(task.id || '')).filter(Boolean)
    : [])
  const existingTaskIds = new Set(existingTasks.map((task) => String(task.id || '')).filter(Boolean))
  const seenTaskIds = new Set()
  const tasks = payload.tasks.map((rawTask, index) => {
    if (!isPlainRecord(rawTask)) throw new ApiError(400, 'TASK_INVALID', `Công việc thứ ${index + 1} không hợp lệ.`)
    const title = String(rawTask.title || '').trim().slice(0, 240)
    const detail = String(rawTask.detail || '').trim().slice(0, 2_000)
    if (!title) throw new ApiError(400, 'TASK_TITLE_REQUIRED', `Công việc thứ ${index + 1} chưa có nội dung.`)
    const taskId = String(rawTask.id || `task_${crypto.randomUUID()}`).trim().slice(0, 160)
    if (!/^[A-Za-z0-9_-]{1,160}$/u.test(taskId) || seenTaskIds.has(taskId)) {
      throw new ApiError(400, 'TASK_ID_INVALID', 'Mã công việc phải hợp lệ và không được trùng trong cùng lượt giao.')
    }
    if (existingTaskIds.has(taskId) && !replaceableTaskIds.has(taskId)) {
      throw new ApiError(409, 'TASK_ID_EXISTS', 'Mã công việc đã tồn tại trong lịch sử giao việc đang hoạt động.')
    }
    seenTaskIds.add(taskId)
    return {
      id: taskId,
      assignmentId,
      storeId,
      storeName: store.name,
      shiftId,
      date,
      employeeIds,
      title,
      detail,
      done: false,
      completedBy: {},
      createdAt: commandContext.now,
      createdBy: serverActorSnapshot(actor),
      assignedAt: commandContext.now,
      assignedBy: serverActorSnapshot(actor),
    }
  })
  const replaced = body.type === 'tasks.replace_scope'
  const notifications = employeeIds.map((employeeId) => {
    const employee = activeStoreEmployees.get(employeeId)
    return {
      id: `ntf_${crypto.randomUUID()}`,
      type: 'store-task-assigned',
      storeId,
      employeeId,
      assignmentId,
      taskIds: tasks.map((task) => task.id),
      date,
      shiftId,
      route: '/employee/home',
      title: 'Bạn có công việc mới',
      message: `${actor.display_name || actor.username || 'Quản lý'} đã giao ${tasks.length} công việc cho ${employee?.name || employeeId} ngày ${date}.`,
      createdAt: commandContext.now,
      createdBy: serverActorSnapshot(actor),
      readAt: null,
    }
  })
  const history = {
    id: assignmentId,
    historyId: `tah_${crypto.randomUUID()}`,
    assignmentId,
    action: replaced ? 'scope-replaced' : 'assigned',
    storeId,
    storeName: store.name,
    date,
    shiftId,
    employeeIds,
    taskCount: tasks.length,
    tasks: tasks.map((task) => ({
      id: task.id,
      title: task.title,
      detail: task.detail,
      employeeIds: task.employeeIds,
      completedBy: {},
    })),
    ...(replaced ? {
      replacedTasks: previousTasks.map((task) => ({
        id: task.id,
        assignmentId: task.assignmentId || null,
        title: task.title,
        detail: task.detail || '',
        employeeIds: Array.isArray(task.employeeIds) ? task.employeeIds : [],
        completedBy: isPlainRecord(task.completedBy) ? task.completedBy : {},
        createdAt: task.createdAt || null,
      })),
    } : {}),
    createdAt: commandContext.now,
    createdBy: serverActorSnapshot(actor),
  }
  const nextState = {
    ...state,
    tasks: replaced
      ? [
          ...tasks,
          ...existingTasks.filter((task) => !(
        String(task.storeId || '') === storeId
        && String(task.shiftId || task.shift || '') === shiftId
        && String(task.date || task.workDate || '') === date
      )),
        ]
      : [...tasks, ...existingTasks],
    taskAssignmentHistory: [history, ...(Array.isArray(state.taskAssignmentHistory) ? state.taskAssignmentHistory : [])],
    notifications: [...notifications, ...(Array.isArray(state.notifications) ? state.notifications : [])],
    stateVersion: Math.max(1, Number(state.stateVersion) || 1) + 1,
  }
  return commitGlobalStateDomainCommand(db, actor, current, nextState, {
    action: body.type,
    entityType: 'task-assignment',
    entityId: assignmentId,
    before: replaced ? previousTasks : null,
    after: tasks,
    metadata: {
      storeId, date, shiftId, employeeIds, taskCount: tasks.length,
      replaced, notificationIds: notifications.map((notification) => notification.id),
    },
    response: {
      command: body.type, assignmentId, storeId, date, shiftId, employeeIds,
      tasks, notifications, history,
    },
    status: replaced ? 200 : 201,
  }, commandContext)
}

const STORE_EMPLOYEE_PREFIXES = new Map([
  ['SECOND MALL SM234', 'SM234'],
  ['SM234', 'SM234'],
  ['TO NGOC VAN', 'TNV'],
  ['TNV', 'TNV'],
  ['DI AN', 'DIAN'],
  ['DIAN', 'DIAN'],
  ['KHA VAN CAN', 'KVC'],
  ['KVC', 'KVC'],
  ['TAY HOA', 'TH'],
  ['TH', 'TH'],
  ['NGUYEN VAN THUONG', 'NVT'],
  ['NVT', 'NVT'],
  ['NO TRANG LONG', 'NTL'],
  ['NTL', 'NTL'],
  ['LE VAN THO', 'LVT'],
  ['LVT', 'LVT'],
  ['BUON MA THUOT', 'BMT'],
  ['BUON MA THUOC', 'BMT'],
  ['BMT', 'BMT'],
  ['CAN THO', 'CT'],
  ['CT', 'CT'],
])

const asciiUpper = (value) => String(value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/gu, '')
  .replace(/Đ/gu, 'D')
  .replace(/đ/gu, 'd')
  .toUpperCase()
  .replace(/[^A-Z0-9]+/gu, ' ')
  .trim()

const storeEmployeePrefix = (store) => {
  const rawCandidates = [store?.employeePrefix, store?.short, store?.name]
    .map((value) => asciiUpper(value))
    .filter(Boolean)
  const candidates = rawCandidates.map((value) => value.replace(/^IDOSI\s+/u, ''))
  const identity = rawCandidates.join(' ')
  const brand = /\bDOSII\b/u.test(identity)
    ? 'DOSII'
    : (/\bDOSSI\b/u.test(identity)
        ? 'DOSSI'
        : (/\bSM\b/u.test(identity) ? 'SM' : ''))
  for (const candidate of candidates) {
    if (STORE_EMPLOYEE_PREFIXES.has(candidate)) {
      const branch = STORE_EMPLOYEE_PREFIXES.get(candidate)
      if (branch === 'SM234') return branch
      return brand ? `${brand}-${branch}` : branch
    }
    if (/\d/u.test(candidate)) return candidate.replace(/\s+/gu, '').slice(0, 12)
  }
  const words = (candidates[0] || 'NV').split(/\s+/u).filter(Boolean)
  return words.map((word) => word[0]).join('').slice(0, 8) || 'NV'
}

const nextEmployeeCode = (state, store, unit = null) => {
  const normalizedUnit = unit || (String(store?.id || '') === OFFICE_STORE_ID ? 'office' : 'store')
  const prefix = storeEmployeePrefix(store)
  const pattern = normalizedUnit === 'office'
    ? /^VP-?(\d+)$/u
    : (normalizedUnit === 'business_support'
      ? /^HTKD-?(\d+)$/u
      : (normalizedUnit === 'store_manager'
        ? /^(?:QLCH-|QL-[A-Z0-9]+-)(\d+)$/u
        : new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}-(\\d+)$`, 'u')))
  const knownEmployees = [
    ...(Array.isArray(state.employees) ? state.employees : []),
    ...(Array.isArray(state.deletedEmployees) ? state.deletedEmployees : []),
  ]
  const next = knownEmployees.reduce((maximum, employee) => {
    const match = String(employee.id || employee.code || employee.employeeCode || '').toUpperCase().match(pattern)
    return match ? Math.max(maximum, Number(match[1])) : maximum
  }, 0) + 1
  if (normalizedUnit === 'office') return `VP-${String(next).padStart(3, '0')}`
  if (normalizedUnit === 'business_support') return `HTKD-${String(next).padStart(3, '0')}`
  if (normalizedUnit === 'store_manager') return `QLCH-${String(next).padStart(3, '0')}`
  return `${prefix}-${String(next).padStart(3, '0')}`
}

const employeeStatusValues = (value) => {
  const normalized = normalizeTextKey(value)
  if (['active', 'dang lam viec', 'dang hoat dong'].includes(normalized)) {
    return { profile: 'Đang làm việc', account: 'active' }
  }
  if (['locked', 'tam ngung', 'tam nghi'].includes(normalized)) {
    return { profile: 'Tạm ngưng', account: 'locked' }
  }
  if (['inactive', 'da nghi viec'].includes(normalized)) {
    return { profile: 'Đã nghỉ việc', account: 'inactive' }
  }
  throw new ApiError(400, 'STATUS_INVALID', 'Trạng thái nhân viên không hợp lệ.')
}

const normalizeEmployeeUnitRequest = (payload, previous = null) => {
  if (previous) return employeeUnit(previous)
  const raw = String(payload.unit || payload.unitType || payload.department || payload.role || '').trim().toLowerCase()
  if (['business_support', 'business-support', 'support'].includes(raw)) return 'business_support'
  if (['store_manager', 'store-manager', 'manager'].includes(raw)) return 'store_manager'
  if (raw === 'office' || String(payload.storeId || '') === OFFICE_STORE_ID) return 'office'
  return 'store'
}

const OPERATIONAL_PROFILE_FIELDS = new Set([
  'employeeId', 'id', 'code', 'employeeCode',
  'unit', 'unitType', 'department', 'role', 'storeId',
  'name', 'phone', 'cccd', 'citizenId', 'address', 'addressDetails', 'startDate', 'joinDate',
  'employmentType', 'position', 'jobPosition', 'username', 'password', 'authUserId',
  'workTimeType', 'workStart', 'workEnd', 'workShifts', 'workingTime',
  'baseSalary', 'standardWorkDays', 'requiredMonthlyHours', 'linkedEmployeeId',
  'identityImages', 'cccdImages', 'identityCardImages', 'cccdFront', 'cccdBack',
])

const BUSINESS_SUPPORT_WORK_TIME_PROFILE_FIELDS = new Set([
  'employeeId', 'id', 'code', 'employeeCode',
  'workTimeType', 'workStart', 'workEnd', 'workShifts', 'workingTime',
])

const operationalEmploymentType = (value) => {
  const normalized = normalizeTextKey(value).replace(/[ _]+/gu, '-')
  if (normalized === 'full-time') return 'Full-Time'
  if (normalized === 'part-time') return 'Part-Time'
  if (normalized === 'thuc-tap-sinh') return 'Thực Tập Sinh'
  throw new ApiError(400, 'EMPLOYMENT_TYPE_INVALID', 'Loại nhân viên phải là Full-Time, Part-Time hoặc Thực Tập Sinh.')
}

const officeEmploymentType = (value) => {
  const normalized = normalizeTextKey(value).replace(/[ _]+/gu, '-')
  if (['full-time', 'chinh-thuc', 'thu-viec'].includes(normalized)) return 'Full-Time'
  if (normalized === 'part-time') return 'Part-Time'
  if (['thuc-tap-sinh', 'thuc-tap'].includes(normalized)) return 'Thực Tập Sinh'
  throw new ApiError(400, 'EMPLOYMENT_TYPE_INVALID', 'Loại nhân viên Khối văn phòng phải là Full-Time, Part-Time hoặc Thực Tập Sinh.')
}

const officePosition = (value) => {
  const normalized = normalizeTextKey(value)
  if (normalized === 'ke toan') return 'Kế Toán'
  if (normalized === 'marketing') return 'Marketing'
  throw new ApiError(400, 'POSITION_INVALID', 'Vị trí công việc Khối văn phòng phải là Kế Toán hoặc Marketing.')
}

const normalizeAddressDetails = (value) => {
  if (value === undefined || value === null) return null
  if (!isPlainRecord(value)) {
    throw new ApiError(400, 'ADDRESS_DETAILS_INVALID', 'Thông tin địa chỉ chi tiết không hợp lệ.')
  }
  const province = String(value.province || '').trim()
  const ward = String(value.ward || '').trim()
  const street = String(value.street || '').trim()
  if ([province, ward, street].some((part) => part.length > 200)) {
    throw new ApiError(400, 'ADDRESS_DETAILS_INVALID', 'Mỗi phần địa chỉ không được vượt quá 200 ký tự.')
  }
  return { province, ward, street }
}

const operationalPosition = (value, unit) => {
  const expected = unit === 'business_support' ? 'NV hỗ trợ KD' : 'Quản lý cửa hàng'
  if (value == null || String(value).trim() === '') return expected
  if (normalizeTextKey(value) !== normalizeTextKey(expected)) {
    throw new ApiError(400, 'POSITION_INVALID', `Vị trí công việc phải là ${expected}.`)
  }
  return expected
}

const MAX_REQUIRED_MONTHLY_HOURS = 744
const MAX_PROFILE_WORK_SHIFTS = 12

const expectedWorkTimeType = (employmentType) => (
  employmentType === 'Full-Time' ? 'Full-Time' : 'Part-Time'
)

const profileWorkShiftId = (value, index) => {
  const safe = String(value || '').trim().replace(/[^A-Za-z0-9_-]/gu, '_').slice(0, 80)
  return safe || `work_${index + 1}`
}

const normalizeProfileWorkingTime = (payload, previous, employmentType) => {
  const workTimeType = expectedWorkTimeType(employmentType)
  const requestedType = payload.workTimeType ?? payload.workingTime?.type
  if (requestedType !== undefined && String(requestedType).trim() !== workTimeType) {
    throw new ApiError(400, 'OFFICE_WORK_TIME_TYPE_INVALID', 'Loại thời gian làm việc phải khớp với loại nhân viên.')
  }
  const hasCanonicalPayload = Object.hasOwn(payload, 'workShifts') || Object.hasOwn(payload, 'workingTime')
  const canonicalInput = payload.workShifts ?? payload.workingTime?.shifts
  let rawShifts
  if (hasCanonicalPayload) {
    if (!Array.isArray(canonicalInput)) {
      throw new ApiError(400, 'OFFICE_WORK_SHIFTS_INVALID', 'Danh sách ca làm việc không hợp lệ.')
    }
    rawShifts = canonicalInput
  } else if (payload.workStart !== undefined || payload.workEnd !== undefined) {
    rawShifts = [{
      id: workTimeType === 'Full-Time' ? 'full_time' : 'work_1',
      name: workTimeType === 'Full-Time' ? 'Giờ hành chính' : 'Ca 1',
      start: payload.workStart ?? previous?.workStart,
      end: payload.workEnd ?? previous?.workEnd,
    }]
  } else if (Array.isArray(previous?.workShifts)) {
    rawShifts = previous.workShifts
  } else if (Array.isArray(previous?.workingTime?.shifts)) {
    rawShifts = previous.workingTime.shifts
  } else {
    rawShifts = [{
      id: workTimeType === 'Full-Time' ? 'full_time' : 'work_1',
      name: workTimeType === 'Full-Time' ? 'Giờ hành chính' : 'Ca 1',
      start: previous?.workStart || '08:00',
      end: previous?.workEnd || (workTimeType === 'Full-Time' ? '17:30' : '12:00'),
    }]
  }
  if (!rawShifts.length || rawShifts.length > MAX_PROFILE_WORK_SHIFTS) {
    throw new ApiError(400, 'OFFICE_WORK_SHIFTS_INVALID', `Cần từ 1 đến ${MAX_PROFILE_WORK_SHIFTS} ca làm việc.`)
  }
  if (workTimeType === 'Full-Time' && rawShifts.length !== 1) {
    throw new ApiError(400, 'OFFICE_WORK_SHIFTS_INVALID', 'Nhân viên Full-Time chỉ dùng một khung giờ cố định.')
  }
  const workShifts = rawShifts.map((rawShift, index) => {
    if (!isPlainRecord(rawShift)) throw new ApiError(400, 'OFFICE_WORK_SHIFT_INVALID', 'Ca làm việc không hợp lệ.')
    const name = String(rawShift.name || '').trim().slice(0, 80)
    const start = parseShiftTime(rawShift.start)
    const end = parseShiftTime(rawShift.end)
    if (!name || !start || !end || end.minuteOfDay <= start.minuteOfDay) {
      throw new ApiError(400, 'OFFICE_WORK_TIME_INVALID', 'Mỗi ca cần tên, giờ bắt đầu và giờ kết thúc hợp lệ trong cùng ngày.')
    }
    return { id: profileWorkShiftId(rawShift.id, index), name, start: start.label, end: end.label }
  })
  const ids = workShifts.map(({ id }) => id)
  const names = workShifts.map(({ name }) => normalizeTextKey(name))
  if (new Set(ids).size !== ids.length || new Set(names).size !== names.length) {
    throw new ApiError(400, 'OFFICE_WORK_SHIFTS_DUPLICATE', 'Mã và tên ca làm việc không được trùng nhau.')
  }
  const first = workShifts[0]
  return {
    workTimeType,
    workStart: first.start,
    workEnd: first.end,
    workShifts,
    workingTime: {
      type: workTimeType,
      mode: workTimeType === 'Full-Time' ? 'fixed' : 'shifts',
      shifts: workShifts,
    },
  }
}

const configuredProfileWorkShifts = (employee) => {
  const canonical = Array.isArray(employee?.workShifts)
    ? employee.workShifts
    : Array.isArray(employee?.workingTime?.shifts) ? employee.workingTime.shifts : []
  const shifts = canonical.flatMap((rawShift, index) => {
    if (!isPlainRecord(rawShift)) return []
    const start = parseShiftTime(rawShift.start)
    const end = parseShiftTime(rawShift.end)
    if (!start || !end || end.minuteOfDay <= start.minuteOfDay) return []
    return [{
      id: profileWorkShiftId(rawShift.id, index),
      name: String(rawShift.name || `Ca ${index + 1}`).trim().slice(0, 80),
      start: start.label,
      end: end.label,
      version: 1,
      source: 'profile-work-shift',
    }]
  })
  if (shifts.length) return shifts
  const start = parseShiftTime(employee?.workStart)
  const end = parseShiftTime(employee?.workEnd)
  if (!start || !end || end.minuteOfDay <= start.minuteOfDay) return []
  return [{
    id: `${employeeUnit(employee).toUpperCase()}_DEFAULT`,
    name: employeeUnit(employee) === 'office' ? 'Giờ làm Văn phòng' : 'Giờ làm theo hồ sơ',
    start: start.label,
    end: end.label,
    version: 1,
    source: 'office-profile',
  }]
}

const validRequiredMonthlyHours = (value) => {
  const hours = Number(value)
  return Number.isFinite(hours) && hours > 0 && hours <= MAX_REQUIRED_MONTHLY_HOURS ? hours : null
}

const isSecondMallSm234Store = (store) => {
  const id = asciiUpper(store?.id).replace(/\s+/gu, '')
  const identity = [store?.short, store?.name, store?.employeePrefix]
    .map((value) => asciiUpper(value).replace(/\s+/gu, ''))
    .join('|')
  return id === 'CH001' || identity.includes('SM234') || identity.includes('SECONDMALL')
}

const identityImageInputs = (payload) => {
  const container = payload.identityImages ?? payload.cccdImages ?? payload.identityCardImages
  const fromContainer = (side, index) => {
    if (isPlainRecord(container) && Object.hasOwn(container, side)) {
      return { provided: true, value: container[side] }
    }
    if (Array.isArray(container) && index < container.length) {
      return { provided: true, value: container[index] }
    }
    return { provided: false, value: undefined }
  }
  const front = Object.hasOwn(payload, 'cccdFront')
    ? { provided: true, value: payload.cccdFront }
    : fromContainer('front', 0)
  const back = Object.hasOwn(payload, 'cccdBack')
    ? { provided: true, value: payload.cccdBack }
    : fromContainer('back', 1)
  return { front, back }
}

const withoutIdentityImagePayload = (payload) => Object.fromEntries(Object.entries(payload).filter(([key]) => ![
  'identityImages', 'cccdImages', 'identityCardImages', 'cccdFront', 'cccdBack',
].includes(key)))

const bestEffortDeleteIdentityImages = async (bucket, keys) => {
  if (!bucket?.delete) return
  for (const key of new Set((keys || []).filter(Boolean))) {
    try {
      await bucket.delete(key)
    } catch (error) {
      console.warn('Unable to clean up an IDOSI identity image', { key, error: String(error) })
    }
  }
}

const prepareIdentityImageUpdate = async (env, payload, previous, employeeId, timestamp) => {
  const inputs = identityImageInputs(payload)
  const changedSides = Object.entries(inputs).filter(([, input]) => input.provided)
  const existing = isPlainRecord(previous?.identityImages) ? previous.identityImages : {}
  if (!changedSides.length) return { identityImages: existing, uploadedKeys: [], retiredKeys: [] }
  const bucket = env?.IDENTITY_IMAGES
  if (!bucket?.put || !bucket?.delete) {
    throw new ApiError(503, 'IDENTITY_IMAGE_STORAGE_UNAVAILABLE', 'Kho lưu ảnh CCCD chưa được cấu hình.')
  }
  const identityImages = { ...existing }
  const uploadedKeys = []
  const retiredKeys = []
  try {
    for (const [side, input] of changedSides) {
      const oldKey = String(existing?.[side]?.key || '')
      if (input.value == null || String(input.value).trim() === '') {
        delete identityImages[side]
        if (oldKey) retiredKeys.push(oldKey)
        continue
      }
      const image = decodeIdentityImage(input.value, side)
      const key = `identity-images/${employeeId}/${side}/${crypto.randomUUID()}.${image.extension}`
      await bucket.put(key, image.bytes, {
        httpMetadata: { contentType: image.contentType },
        customMetadata: { employeeId, side, uploadedAt: timestamp },
      })
      uploadedKeys.push(key)
      if (oldKey && oldKey !== key) retiredKeys.push(oldKey)
      identityImages[side] = {
        key,
        contentType: image.contentType,
        size: image.bytes.byteLength,
        uploadedAt: timestamp,
      }
    }
  } catch (error) {
    await bestEffortDeleteIdentityImages(bucket, uploadedKeys)
    if (error instanceof ApiError) throw error
    throw new ApiError(503, 'IDENTITY_IMAGE_STORAGE_FAILED', 'Không thể lưu ảnh CCCD vào kho riêng tư.')
  }
  return { identityImages, uploadedKeys, retiredKeys }
}

const normalizeOperationalEmployeeProfile = (payload, previous, store, state, unit) => {
  const unsupportedFields = Object.keys(payload).filter((key) => !OPERATIONAL_PROFILE_FIELDS.has(key))
  if (unsupportedFields.length) {
    throw new ApiError(400, 'EMPLOYEE_PROFILE_FIELDS_INVALID', 'Hồ sơ vai trò này chỉ nhận các thuộc tính nhân sự đã quy định.', {
      fields: unsupportedFields,
    })
  }
  const id = previous
    ? String(previous.id || previous.code || previous.employeeCode || '')
    : nextEmployeeCode(state, store, unit)
  const name = payload.name === undefined && previous ? String(previous.name || '') : String(payload.name || '').trim().slice(0, 160)
  if (!name) throw new ApiError(400, 'EMPLOYEE_NAME_INVALID', 'Tên nhân viên không được để trống.')
  const phone = payload.phone === undefined && previous
    ? String(previous.phone || '')
    : String(payload.phone || '').replace(/\D/gu, '')
  if (!/^0\d{9}$/u.test(phone)) {
    throw new ApiError(400, 'PHONE_INVALID', 'Số điện thoại phải có đúng 10 số và bắt đầu bằng số 0.')
  }
  const cccd = payload.cccd === undefined && payload.citizenId === undefined && previous
    ? String(previous.cccd || previous.citizenId || '')
    : String(payload.cccd ?? payload.citizenId ?? '').replace(/\D/gu, '')
  if (!/^\d{12}$/u.test(cccd)) {
    throw new ApiError(400, 'CCCD_INVALID', 'CCCD phải có đúng 12 chữ số.')
  }
  const address = payload.address === undefined && previous
    ? String(previous.address || '')
    : String(payload.address || '').trim().slice(0, 500)
  if (!address) throw new ApiError(400, 'EMPLOYEE_ADDRESS_INVALID', 'Địa chỉ nhân viên không được để trống.')
  const addressDetails = normalizeAddressDetails(payload.addressDetails ?? previous?.addressDetails)
  const rawStartDate = payload.startDate ?? payload.joinDate ?? previous?.startDate ?? previous?.joinDate ?? ''
  const startDate = optionalCalendarDate(rawStartDate, 'Ngày bắt đầu làm')
  if (!startDate) throw new ApiError(400, 'START_DATE_REQUIRED', 'Ngày bắt đầu làm là bắt buộc.')
  const employmentType = operationalEmploymentType(payload.employmentType ?? previous?.employmentType ?? 'Full-Time')
  if (unit === 'store_manager' && !['Full-Time', 'Part-Time'].includes(employmentType)) {
    throw new ApiError(400, 'EMPLOYMENT_TYPE_INVALID', 'Loại nhân viên Quản lý cửa hàng phải là Full-Time hoặc Part-Time.')
  }
  const workingTime = normalizeProfileWorkingTime(payload, previous, employmentType)
  const position = operationalPosition(payload.position ?? payload.jobPosition ?? previous?.position, unit)
  const preservedMetadata = previous ? Object.fromEntries(Object.entries(previous).filter(([key]) => [
    'createdAt', 'createdBy', 'updatedAt', 'updatedBy', 'authUserId', 'authVersion', 'identityImages',
  ].includes(key))) : {}
  const profile = sanitizeStateValue({
    ...preservedMetadata,
    id,
    code: id,
    employeeCode: id,
    name,
    phone,
    cccd,
    citizenId: cccd,
    address,
    ...(addressDetails ? { addressDetails } : {}),
    startDate,
    joinDate: startDate,
    employmentType,
    ...(unit === 'store_manager' ? {
      salary: 0,
      baseSalary: 0,
      monthlySalary: 0,
      hourlyRate: 0,
      payBasis: 'allowance-only',
      salaryBasis: 'allowance-only',
      salaryUnit: 'none',
      payFormula: 'allowance-bonus-only',
      ...(payload.linkedEmployeeId || previous?.linkedEmployeeId
        ? { linkedEmployeeId: String(payload.linkedEmployeeId || previous.linkedEmployeeId) }
        : {}),
    } : {}),
    position,
    jobPosition: position,
    storeId: store.id,
    unit,
    unitType: unit,
    department: unit,
    isOffice: false,
    isOfficeLike: true,
    ...workingTime,
    status: previous?.status || 'Đang làm việc',
  })
  if (previous?.username) profile.username = previous.username
  return profile
}

const normalizeEmployeeProfilePayload = (payload, previous, store, state, unit = null) => {
  const normalizedUnit = unit || employeeUnit(previous || { storeId: store?.id })
  if (['business_support', 'store_manager'].includes(normalizedUnit)) {
    return normalizeOperationalEmployeeProfile(payload, previous, store, state, normalizedUnit)
  }
  const officeLike = ['office', 'business_support', 'store_manager'].includes(normalizedUnit)
  const id = previous
    ? String(previous.id || previous.code || previous.employeeCode || '')
    : String(['business_support', 'store_manager', 'office'].includes(normalizedUnit)
      ? nextEmployeeCode(state, store, normalizedUnit)
      : (payload.id || payload.code || payload.employeeCode || nextEmployeeCode(state, store, normalizedUnit))).trim().toUpperCase()
  if (!/^[A-Za-z0-9_-]{2,80}$/u.test(id)) throw new ApiError(400, 'EMPLOYEE_ID_INVALID', 'Mã nhân viên không hợp lệ.')
  const name = payload.name === undefined && previous ? previous.name : String(payload.name || '').trim().slice(0, 160)
  if (!name) throw new ApiError(400, 'EMPLOYEE_NAME_INVALID', 'Tên nhân viên không được để trống.')
  const phone = payload.phone === undefined && previous ? String(previous.phone || '') : String(payload.phone || '').replace(/\D/gu, '')
  if (!/^0\d{9}$/u.test(phone)) {
    throw new ApiError(400, 'PHONE_INVALID', 'Số điện thoại phải có đúng 10 số và bắt đầu bằng số 0.')
  }
  const rawEmploymentType = String(payload.employmentType ?? previous?.employmentType ?? (officeLike ? 'Chính thức' : 'Full-Time')).trim()
  const employmentType = normalizedUnit === 'office'
    ? officeEmploymentType(rawEmploymentType)
    : (/^part[- ]?time$/u.test(normalizeTextKey(rawEmploymentType)) ? 'Part-Time' : 'Full-Time')
  const allowedTypes = normalizedUnit === 'office'
    ? ['Full-Time', 'Part-Time', 'Thực Tập Sinh']
    : ['Full-Time', 'Part-Time']
  if (!allowedTypes.includes(employmentType)) {
    throw new ApiError(400, 'EMPLOYMENT_TYPE_INVALID', 'Loại nhân viên không hợp lệ.')
  }
  const payBasis = employmentType === 'Part-Time' ? 'hourly' : 'monthly'
  const salarySource = payBasis === 'monthly'
    ? (payload.baseSalary ?? payload.monthlySalary ?? payload.salary
      ?? previous?.baseSalary ?? previous?.monthlySalary ?? previous?.salary ?? 0)
    : (payload.hourlyRate ?? payload.salary ?? previous?.hourlyRate ?? previous?.salary ?? 0)
  const salary = asVnd(salarySource, payBasis === 'monthly' ? 'Lương tháng' : 'Lương giờ')
  const storeFullTime = normalizedUnit === 'store' && employmentType === 'Full-Time'
  const requestedStoreWorkDays = storeFullTime
    ? Number(payload.standardWorkDays ?? previous?.standardWorkDays)
    : null
  if (storeFullTime && payload.standardWorkDays !== undefined && !validRequiredWorkingDays(requestedStoreWorkDays)) {
    throw new ApiError(400, 'STORE_WORK_DAYS_INVALID', 'Số ngày công quy định mỗi tháng phải là số nguyên từ 1 đến 31.')
  }
  const requestedMonthlyHours = storeFullTime
    ? Number(payload.requiredMonthlyHours ?? previous?.requiredMonthlyHours)
    : null
  if (storeFullTime && payload.requiredMonthlyHours !== undefined && !validRequiredMonthlyHours(requestedMonthlyHours)) {
    throw new ApiError(400, 'REQUIRED_MONTHLY_HOURS_INVALID', `Tổng giờ làm quy định mỗi tháng phải lớn hơn 0 và không quá ${MAX_REQUIRED_MONTHLY_HOURS} giờ.`)
  }
  if (!previous && storeFullTime && isSecondMallSm234Store(store)
    && (!validRequiredWorkingDays(requestedStoreWorkDays) || !validRequiredMonthlyHours(requestedMonthlyHours))) {
    throw new ApiError(400, 'SM234_PAYROLL_FIELDS_REQUIRED', 'Nhân viên Full-Time SecondMall SM234 cần số ngày công và tổng giờ làm quy định mỗi tháng.')
  }
  const cccd = ['office', 'store'].includes(normalizedUnit)
    ? String(payload.cccd ?? payload.citizenId ?? previous?.cccd ?? previous?.citizenId ?? '').replace(/\D/gu, '')
    : String(payload.cccd ?? payload.citizenId ?? previous?.cccd ?? previous?.citizenId ?? '').trim().slice(0, 20)
  if (['office', 'store'].includes(normalizedUnit) && (!previous || payload.cccd !== undefined || payload.citizenId !== undefined)
    && !/^\d{12}$/u.test(cccd)) {
    throw new ApiError(400, 'CCCD_INVALID', 'CCCD phải có đúng 12 chữ số.')
  }
  const address = String(payload.address ?? previous?.address ?? '').trim().slice(0, 500)
  if (['office', 'store'].includes(normalizedUnit) && !previous && !address) {
    throw new ApiError(400, 'EMPLOYEE_ADDRESS_INVALID', 'Địa chỉ nhân viên không được để trống.')
  }
  const addressDetails = normalizeAddressDetails(payload.addressDetails ?? previous?.addressDetails)
  const workingTime = officeLike ? normalizeProfileWorkingTime(payload, previous, employmentType) : null
  if (officeLike && payload.monthlyWorkdayTargets !== undefined) {
    throw new ApiError(400, 'OFFICE_WORK_DAYS_PAYLOAD_INVALID', 'Hãy cập nhật ngày công theo cặp standardWorkDaysPeriod và standardWorkDays.')
  }
  const monthlyWorkdayTargets = Object.fromEntries(Object.entries(
    isPlainRecord(previous?.monthlyWorkdayTargets) ? previous.monthlyWorkdayTargets : {},
  ).filter(([period, days]) => (
    /^\d{4}-(?:0[1-9]|1[0-2])$/u.test(period)
    && Number.isInteger(Number(days))
    && Number(days) >= 1
    && Number(days) <= 31
  )).map(([period, days]) => [period, Number(days)]))
  const hasRequestedStandardWorkDays = officeLike && payload.standardWorkDays !== undefined
  const requestedStandardWorkDays = hasRequestedStandardWorkDays
    ? Number(payload.standardWorkDays)
    : Number(previous?.standardWorkDays)
  if (hasRequestedStandardWorkDays && !validRequiredWorkingDays(requestedStandardWorkDays)) {
    throw new ApiError(400, 'OFFICE_WORK_DAYS_INVALID', 'Số ngày công riêng của nhân viên Văn phòng phải từ 1 đến 31.')
  }
  const requestedStandardWorkDaysPeriod = officeLike && payload.standardWorkDaysPeriod !== undefined
    ? String(payload.standardWorkDaysPeriod || '').trim()
    : ''
  if (requestedStandardWorkDaysPeriod && !/^\d{4}-(?:0[1-9]|1[0-2])$/u.test(requestedStandardWorkDaysPeriod)) {
    throw new ApiError(400, 'OFFICE_WORK_DAYS_PERIOD_INVALID', 'Tháng áp dụng ngày công phải theo định dạng YYYY-MM.')
  }
  if (officeLike && payload.standardWorkDaysPeriod !== undefined && !hasRequestedStandardWorkDays) {
    throw new ApiError(400, 'OFFICE_WORK_DAYS_REQUIRED', 'Cần gửi standardWorkDays cùng tháng áp dụng.')
  }
  if (officeLike && hasRequestedStandardWorkDays && payload.standardWorkDaysPeriod === undefined) {
    throw new ApiError(400, 'OFFICE_WORK_DAYS_PERIOD_REQUIRED', 'Cần chọn tháng áp dụng cùng số ngày công.')
  }
  if (requestedStandardWorkDaysPeriod) monthlyWorkdayTargets[requestedStandardWorkDaysPeriod] = requestedStandardWorkDays
  const requestedStartDate = payload.startDate ?? payload.joinDate ?? previous?.startDate ?? previous?.joinDate ?? ''
  const startDate = requestedStartDate ? optionalCalendarDate(requestedStartDate, 'Ngày bắt đầu làm') : ''
  if (!previous && ['business_support', 'store_manager', 'office', 'store'].includes(normalizedUnit) && !startDate) {
    throw new ApiError(400, 'START_DATE_REQUIRED', 'Ngày bắt đầu làm là bắt buộc.')
  }
  const position = normalizedUnit === 'office'
    ? (payload.position !== undefined || previous?.position
        ? officePosition(payload.position ?? previous.position)
        : (previous ? '' : officePosition(payload.position)))
    : String(payload.position ?? previous?.position ?? (normalizedUnit === 'store' ? 'Nhân viên bán hàng' : '')).trim().slice(0, 160)
  const profile = sanitizeStateValue({
    ...(previous || {}),
    ...payload,
    id,
    code: id,
    employeeCode: id,
    name,
    phone,
    cccd,
    citizenId: cccd,
    address,
    ...(addressDetails ? { addressDetails } : {}),
    storeId: store.id,
    unit: normalizedUnit,
    unitType: normalizedUnit,
    department: normalizedUnit,
    isOffice: normalizedUnit === 'office',
    isOfficeLike: officeLike,
    employmentType,
    position,
    jobPosition: position,
    payBasis,
    salaryBasis: payBasis,
    salaryUnit: payBasis === 'monthly' ? 'month' : 'hour',
    salary,
    monthlySalary: payBasis === 'monthly' ? salary : null,
    hourlyRate: payBasis === 'hourly' ? salary : null,
    baseSalary: storeFullTime ? salary : null,
    requiredMonthlyHours: storeFullTime && validRequiredMonthlyHours(requestedMonthlyHours)
      ? requestedMonthlyHours
      : null,
    ...(storeFullTime && validRequiredWorkingDays(requestedStoreWorkDays)
      ? { standardWorkDays: requestedStoreWorkDays }
      : {}),
    ...(storeFullTime && isSecondMallSm234Store(store)
      ? { payFormula: 'monthly-hours' }
      : {}),
    ...(startDate ? { startDate, joinDate: startDate } : {}),
    ...(['business_support', 'store_manager'].includes(normalizedUnit)
      ? { needsProfileCompletion: !startDate }
      : {}),
    ...(officeLike ? {
      ...workingTime,
      monthlyWorkdayTargets,
      ...(validRequiredWorkingDays(requestedStandardWorkDays)
        ? { standardWorkDays: requestedStandardWorkDays }
        : {}),
      ...(requestedStandardWorkDaysPeriod
        ? { standardWorkDaysPeriod: requestedStandardWorkDaysPeriod }
        : {}),
    } : {}),
    status: previous?.status || 'Đang làm việc',
  })
  for (const key of [
    'password', 'passwordHash', 'legacyPassword', 'token', 'role',
    'deletedAt', 'deletedBy', 'createdAt', 'createdBy', 'updatedAt', 'updatedBy',
  ]) delete profile[key]
  if (normalizedUnit === 'store' && !storeFullTime) {
    delete profile.standardWorkDays
    delete profile.requiredMonthlyHours
    delete profile.baseSalary
    delete profile.payFormula
  } else if (normalizedUnit === 'store' && !isSecondMallSm234Store(store)) {
    delete profile.payFormula
  }
  if (previous?.authUserId) profile.authUserId = previous.authUserId
  else delete profile.authUserId
  if (previous?.authVersion) profile.authVersion = previous.authVersion
  else delete profile.authVersion
  return profile
}

const employeeProfileCommand = async (db, actor, body, commandContext, env) => {
  assertOperationsRole(actor, 'Tài khoản không có quyền quản lý hồ sơ nhân viên.')
  const operation = body.type.split('.').at(-1)
  if (!['create', 'update', 'delete'].includes(operation)) {
    throw new ApiError(400, 'COMMAND_UNKNOWN', 'Lệnh hồ sơ nhân viên không được hỗ trợ.')
  }
  if (operation === 'delete') assertAdmin(actor, 'Chỉ Admin được xóa nhân viên khỏi hệ thống.')
  const payload = isPlainRecord(body.payload) ? body.payload : {}
  const profilePayload = isPlainRecord(payload.employee) ? payload.employee : payload
  const { current, state } = await loadGlobalCommandState(db, body)
  const employees = Array.isArray(state.employees) ? state.employees : []
  let employeeId = operation === 'create'
    ? String(profilePayload.id || profilePayload.code || profilePayload.employeeCode || '').trim().toUpperCase()
    : String(payload.employeeId || profilePayload.id || profilePayload.code || '').trim()
  const previous = operation === 'create'
    ? null
    : employees.find((employee) => String(employee.id || employee.code || '') === employeeId && !employee.deletedAt)
  if (operation !== 'create' && !previous) throw new ApiError(404, 'EMPLOYEE_NOT_FOUND', 'Không tìm thấy hồ sơ nhân viên.')
  const unit = normalizeEmployeeUnitRequest(profilePayload, previous)
  const linkedEmployeeId = operation === 'create' && unit === 'store_manager'
    ? String(profilePayload.linkedEmployeeId || '').trim()
    : ''
  const linkedStoreEmployee = linkedEmployeeId
    ? employees.find((employee) => (
        String(employee.id || employee.code || '') === linkedEmployeeId
        && employeeUnit(employee) === 'store'
        && !employee.deletedAt
        && !['da nghi viec', 'inactive'].includes(normalizeTextKey(employee.status))
      ))
    : null
  if (linkedEmployeeId && !linkedStoreEmployee) {
    throw new ApiError(404, 'LINKED_EMPLOYEE_NOT_FOUND', 'Không tìm thấy nhân viên cửa hàng đang làm việc để phân quyền Quản lý cửa hàng.')
  }
  const creatingStoreEmployee = operation === 'create' && unit === 'store'
  const supportCreatingStoreEmployee = actor.role === 'business_support' && creatingStoreEmployee
  if (creatingStoreEmployee) employeeId = ''
  const supportWorkingTimeUpdate = actor.role === 'business_support'
    && operation === 'update'
    && ['office', 'business_support'].includes(unit)
    && Object.keys(profilePayload).every((field) => BUSINESS_SUPPORT_WORK_TIME_PROFILE_FIELDS.has(field))
    && Object.keys(profilePayload).some((field) => ['workTimeType', 'workStart', 'workEnd', 'workShifts', 'workingTime'].includes(field))
  const supportOperationAllowed = (
    ['store', 'office', 'store_manager'].includes(unit) && ['create', 'update'].includes(operation)
  ) || supportWorkingTimeUpdate
  if (actor.role === 'business_support' && !supportOperationAllowed) {
    throw new ApiError(403, 'BUSINESS_SUPPORT_READ_ONLY', 'Nhân viên hỗ trợ KD chỉ được thêm hoặc cập nhật nhân viên cửa hàng, Khối văn phòng và Quản lý cửa hàng.')
  }
  const requestedIdentityImages = identityImageInputs(profilePayload)
  const hasIdentityImagePayload = Object.values(requestedIdentityImages).some((input) => input.provided)
  const hasCompleteIdentityImages = ['front', 'back'].every((side) => (
    requestedIdentityImages[side].provided && String(requestedIdentityImages[side].value || '').trim()
  ))
  if (hasIdentityImagePayload && !['business_support', 'store_manager', 'office', 'store'].includes(unit)) {
    throw new ApiError(400, 'IDENTITY_IMAGE_ROLE_INVALID', 'Ảnh CCCD riêng tư chỉ áp dụng cho hồ sơ nhân viên hợp lệ.')
  }
  if (previous && ['unit', 'unitType', 'department', 'role'].some((field) => profilePayload[field] !== undefined)) {
    const requestedUnit = normalizeEmployeeUnitRequest(profilePayload)
    if (requestedUnit !== unit) {
      throw new ApiError(400, 'EMPLOYEE_UNIT_IMMUTABLE', 'Không thể đổi nhóm vai trò của hồ sơ nhân viên.')
    }
  }
  if (unit === 'business_support' && actor.role !== 'admin' && !supportWorkingTimeUpdate) {
    throw new ApiError(403, 'ROLE_FORBIDDEN', 'Chỉ Admin được quản lý hồ sơ Nhân viên hỗ trợ KD.')
  }
  if (['store_manager', 'office'].includes(unit)
    && !['admin', 'business_support'].includes(actor.role)) {
    throw new ApiError(403, 'ROLE_FORBIDDEN', 'Chỉ Admin hoặc Nhân viên hỗ trợ KD được quản lý hồ sơ này.')
  }
  if (previous && unit === 'store') assertOperationalStoreAccess(actor, String(previous.storeId || ''))
  if (actor.role !== 'admin' && previous && ['da nghi viec', 'inactive'].includes(normalizeTextKey(previous.status))) {
    throw new ApiError(403, 'EMPLOYEE_REACTIVATE_FORBIDDEN', 'Chỉ Admin được khôi phục nhân viên đã nghỉ việc.')
  }
  if (previous && profilePayload.storeId !== undefined
    && String(profilePayload.storeId || '').trim() !== String(previous.storeId || '')) {
    throw new ApiError(400, 'EMPLOYEE_STORE_IMMUTABLE', 'Không thể đổi đơn vị của nhân viên qua cập nhật hồ sơ.')
  }
  const storeId = unit === 'business_support'
    ? BUSINESS_SUPPORT_STORE_ID
    : (operation === 'create'
      ? String(profilePayload.storeId || linkedStoreEmployee?.storeId || '').trim()
      : String(previous.storeId || '').trim())
  if (operation === 'create' && unit === 'office' && storeId !== OFFICE_STORE_ID) {
    throw new ApiError(400, 'OFFICE_STORE_REQUIRED', 'Nhân viên Khối văn phòng bắt buộc thuộc đơn vị OFFICE.')
  }
  if (unit === 'store') assertOperationalStoreAccess(actor, storeId)
  let store
  if (unit === 'business_support') {
    store = { id: BUSINESS_SUPPORT_STORE_ID, name: 'Nhân viên hỗ trợ kinh doanh', short: 'HTKD' }
  } else if (unit === 'office' && storeId === OFFICE_STORE_ID && ['admin', 'business_support'].includes(actor.role)) {
    store = { id: OFFICE_STORE_ID, name: 'Khối Văn Phòng', short: 'VP' }
  } else store = requireStore(state, storeId)
  if (unit === 'store_manager' && [OFFICE_STORE_ID, BUSINESS_SUPPORT_STORE_ID].includes(storeId)) {
    throw new ApiError(400, 'STORE_INVALID', 'Quản lý cửa hàng phải được gán cho một cửa hàng đang tồn tại.')
  }
  if (linkedStoreEmployee && String(linkedStoreEmployee.storeId || '') !== storeId) {
    throw new ApiError(400, 'LINKED_EMPLOYEE_STORE_MISMATCH', 'Nhân viên được chọn không thuộc cửa hàng cần phân quyền quản lý.')
  }

  if (operation === 'delete') {
    const authTarget = await first(db, 'SELECT * FROM users WHERE employee_id = ? LIMIT 1', employeeId)
    const nextAuthVersion = authTarget ? Number(authTarget.version || 1) + 1 : null
    const { identityImages: deletedIdentityImages, ...profileWithoutIdentityImages } = previous
    const deleted = {
      ...profileWithoutIdentityImages,
      ...(authTarget ? { authUserId: authTarget.id, authVersion: nextAuthVersion } : {}),
      status: 'Đã nghỉ việc',
      deletedAt: commandContext.now,
      deletedBy: serverActorSnapshot(actor),
    }
    const nextState = {
      ...state,
      employees: employees.filter((employee) => String(employee.id || employee.code || '') !== employeeId),
      schedule: (Array.isArray(state.schedule) ? state.schedule : []).filter((entry) => !belongsToEmployee(entry, employeeId)),
      deletedEmployees: [deleted, ...(Array.isArray(state.deletedEmployees) ? state.deletedEmployees : [])],
      stateVersion: Math.max(1, Number(state.stateVersion) || 1) + 1,
    }
    const nextStateVersion = Number(current.version) + 1
    const additionalStatements = authTarget ? [
      db.prepare(`
        UPDATE users
        SET status = 'inactive', version = ?, updated_at = ?
        WHERE id = ? AND version = ?
          AND EXISTS (
            SELECT 1 FROM app_state
            WHERE scope_key = 'global' AND version = ? AND last_request_id = ?
          )
      `).bind(
        nextAuthVersion,
        commandContext.now,
        authTarget.id,
        Number(authTarget.version || 1),
        nextStateVersion,
        commandContext.requestId,
      ),
      db.prepare(`
        UPDATE sessions
        SET revoked_at = ?, last_seen_at = ?
        WHERE user_id = ? AND revoked_at IS NULL
          AND EXISTS (
            SELECT 1 FROM users WHERE id = ? AND status = 'inactive' AND version = ?
          )
      `).bind(
        commandContext.now,
        commandContext.now,
        authTarget.id,
        authTarget.id,
        nextAuthVersion,
      ),
    ] : []
    const response = await commitGlobalStateDomainCommand(db, actor, current, nextState, {
      action: body.type,
      entityType: 'employee',
      entityId: employeeId,
      before: previous,
      after: null,
      response: {
        command: body.type,
        employee: deleted,
        ...(authTarget ? {
          user: { ...publicUser(authTarget), status: 'inactive', version: nextAuthVersion },
        } : {}),
      },
      additionalStatements,
      stateGuard: authTarget ? {
        sql: 'SELECT 1 FROM users WHERE id = ? AND version = ?',
        bindings: [authTarget.id, Number(authTarget.version || 1)],
      } : undefined,
    }, commandContext)
    await bestEffortDeleteIdentityImages(
      env?.IDENTITY_IMAGES,
      Object.values(isPlainRecord(deletedIdentityImages) ? deletedIdentityImages : {}).map((image) => image?.key),
    )
    return response
  }

  const profileInput = withoutIdentityImagePayload(linkedStoreEmployee ? {
    ...profilePayload,
    name: linkedStoreEmployee.name,
    phone: linkedStoreEmployee.phone,
    cccd: linkedStoreEmployee.cccd || linkedStoreEmployee.citizenId,
    address: linkedStoreEmployee.address,
    addressDetails: linkedStoreEmployee.addressDetails,
    startDate: linkedStoreEmployee.startDate || linkedStoreEmployee.joinDate,
    employmentType: linkedStoreEmployee.employmentType || 'Full-Time',
    linkedEmployeeId,
  } : profilePayload)
  if (creatingStoreEmployee) {
    for (const field of ['employeeId', 'id', 'code', 'employeeCode']) delete profileInput[field]
  }
  const profile = normalizeEmployeeProfilePayload(profileInput, previous, store, state, unit)
  const linkedIdentityImages = isPlainRecord(linkedStoreEmployee?.identityImages)
    ? linkedStoreEmployee.identityImages
    : {}
  const previousIdentityImages = isPlainRecord(previous?.identityImages) ? previous.identityImages : {}
  const hasEffectiveIdentityImages = ['front', 'back'].every((side) => {
    if (linkedIdentityImages[side]?.key) return true
    const requested = requestedIdentityImages[side]
    if (requested.provided) return Boolean(String(requested.value || '').trim())
    return Boolean(previousIdentityImages[side]?.key)
  })
  if (!hasEffectiveIdentityImages) {
    throw new ApiError(400, 'IDENTITY_IMAGES_REQUIRED', 'Cần tải đủ ảnh mặt trước và mặt sau CCCD của nhân viên.')
  }
  if (supportCreatingStoreEmployee) {
    const normalizedCccd = String(profilePayload.cccd ?? profilePayload.citizenId ?? '').replace(/\D/gu, '')
    if (!/^\d{12}$/u.test(normalizedCccd)) {
      throw new ApiError(400, 'CCCD_INVALID', 'CCCD phải có đúng 12 chữ số.')
    }
    if (!profile.startDate) {
      throw new ApiError(400, 'START_DATE_REQUIRED', 'Ngày bắt đầu làm là bắt buộc đối với nhân viên cửa hàng.')
    }
    if (!hasCompleteIdentityImages) {
      throw new ApiError(400, 'IDENTITY_IMAGES_REQUIRED', 'Cần tải đủ ảnh mặt trước và mặt sau CCCD của nhân viên cửa hàng.')
    }
    profile.cccd = normalizedCccd
    profile.citizenId = normalizedCccd
    profile.position = 'Nhân viên bán hàng'
    profile.jobPosition = 'Nhân viên bán hàng'
  }
  let requestedStatus = null
  if (operation === 'update' && profilePayload.status !== undefined) {
    requestedStatus = employeeStatusValues(profilePayload.status)
    if (actor.role !== 'admin' && requestedStatus.account === 'inactive') {
      throw new ApiError(403, 'EMPLOYEE_DELETE_FORBIDDEN', 'Chỉ Admin được cho nhân viên nghỉ việc hoặc xóa khỏi hệ thống.')
    }
    profile.status = requestedStatus.profile
  }
  if (operation === 'create') {
    if (employeeId && employeeId !== profile.id) {
      throw new ApiError(400, 'EMPLOYEE_ID_INVALID', 'Mã nhân viên gửi lên không khớp mã được tạo.')
    }
    if (employees.some((employee) => String(employee.id || employee.code || '') === profile.id)) {
      throw new ApiError(409, 'EMPLOYEE_EXISTS', 'Mã nhân viên đã tồn tại.')
    }
    if ((Array.isArray(state.deletedEmployees) ? state.deletedEmployees : []).some((employee) => (
      String(employee.id || employee.code || employee.employeeCode || '') === profile.id
    ))) {
      throw new ApiError(409, 'EMPLOYEE_ID_RETIRED', 'Mã nhân viên đã được sử dụng và không thể cấp lại.')
    }
  }
  const saved = {
    ...profile,
    ...(operation === 'create'
      ? { createdAt: commandContext.now, createdBy: serverActorSnapshot(actor) }
      : { updatedAt: commandContext.now, updatedBy: serverActorSnapshot(actor) }),
  }
  const nextStateVersion = Number(current.version) + 1
  const additionalStatements = []
  let stateGuard
  let responseUser = null
  let requestedUsername = String(profilePayload.username || '').trim()
  let requestedPassword = String(profilePayload.password || '')
  const requestedAuthUserId = String(profilePayload.authUserId || '').trim()
  const expectedAuthRole = roleForEmployeeUnit(unit)

  if (operation === 'create') {
    if (linkedStoreEmployee) {
      const linkedTarget = await first(db, 'SELECT * FROM users WHERE employee_id = ? LIMIT 1', linkedEmployeeId)
      if (!linkedTarget || !['employee', 'store_manager'].includes(linkedTarget.role)) {
        throw new ApiError(409, 'LINKED_EMPLOYEE_ACCOUNT_REQUIRED', 'Nhân viên được chọn phải có tài khoản đăng nhập đang hoạt động.')
      }
      if (linkedTarget.status !== 'active') {
        throw new ApiError(409, 'LINKED_EMPLOYEE_ACCOUNT_INACTIVE', 'Tài khoản nhân viên được chọn đang bị khóa hoặc ngưng hoạt động.')
      }
      const currentAuthVersion = Number(linkedTarget.version || 1)
      const nextAuthVersion = currentAuthVersion + 1
      responseUser = {
        ...publicUser(linkedTarget),
        role: 'store_manager',
        storeId,
        employeeId: linkedEmployeeId,
        version: nextAuthVersion,
      }
      saved.username = linkedTarget.username
      saved.authUserId = linkedTarget.id
      saved.authVersion = nextAuthVersion
      saved.linkedEmployeeId = linkedEmployeeId
      stateGuard = {
        sql: 'SELECT 1 FROM users WHERE id = ? AND version = ? AND employee_id = ?',
        bindings: [linkedTarget.id, currentAuthVersion, linkedEmployeeId],
      }
      additionalStatements.push(db.prepare(`
        UPDATE users
        SET role = 'store_manager', store_id = ?, version = ?, updated_at = ?
        WHERE id = ? AND version = ? AND employee_id = ? AND role IN ('employee', 'store_manager')
          AND EXISTS (
            SELECT 1 FROM app_state
            WHERE scope_key = 'global' AND version = ? AND last_request_id = ?
          )
      `).bind(
        storeId,
        nextAuthVersion,
        commandContext.now,
        linkedTarget.id,
        currentAuthVersion,
        linkedEmployeeId,
        nextStateVersion,
        commandContext.requestId,
      ))
      additionalStatements.push(db.prepare(`
        UPDATE sessions
        SET revoked_at = ?, last_seen_at = ?
        WHERE user_id = ? AND revoked_at IS NULL
      `).bind(commandContext.now, commandContext.now, linkedTarget.id))
    } else {
    if (requestedAuthUserId && !['business_support', 'store_manager', 'office'].includes(unit)) {
      throw new ApiError(400, 'AUTH_LINK_INVALID', 'Chỉ hồ sơ Hỗ trợ KD, Quản lý cửa hàng hoặc Khối văn phòng được liên kết tài khoản có sẵn.')
    }
    const linkedTarget = requestedAuthUserId
      ? await first(db, 'SELECT * FROM users WHERE id = ? LIMIT 1', requestedAuthUserId)
      : null
    if (requestedAuthUserId && !linkedTarget) {
      throw new ApiError(404, 'USER_NOT_FOUND', 'Không tìm thấy tài khoản cần liên kết.')
    }
    if (linkedTarget) {
      if (linkedTarget.role !== expectedAuthRole || linkedTarget.employee_id) {
        throw new ApiError(409, 'AUTH_LINK_INVALID', 'Tài khoản đã liên kết hồ sơ hoặc không đúng vai trò.')
      }
      const username = requestedUsername || linkedTarget.username
      if (!/^[A-Za-z0-9._-]{3,80}$/u.test(username)) {
        throw new ApiError(400, 'INVALID_USERNAME', 'Tên đăng nhập nhân viên không hợp lệ.')
      }
      const normalizedUsername = normalizeUsername(username)
      const duplicate = await first(db, `
        SELECT id FROM users WHERE username_normalized = ? AND id <> ? LIMIT 1
      `, normalizedUsername, linkedTarget.id)
      if (duplicate) throw new ApiError(409, 'USER_EXISTS', 'Tên đăng nhập đã được sử dụng.')
      const password = requestedPassword ? await hashPassword(requestedPassword) : null
      const currentAuthVersion = Number(linkedTarget.version || 1)
      const nextAuthVersion = currentAuthVersion + 1
      responseUser = {
        ...publicUser(linkedTarget),
        username,
        displayName: saved.name,
        storeId,
        employeeId: saved.id,
        version: nextAuthVersion,
      }
      saved.username = username
      saved.authUserId = linkedTarget.id
      saved.authVersion = nextAuthVersion
      stateGuard = {
        sql: 'SELECT 1 FROM users WHERE id = ? AND version = ? AND employee_id IS NULL',
        bindings: [linkedTarget.id, currentAuthVersion],
      }
      additionalStatements.push(db.prepare(`
        UPDATE users
        SET username = ?, username_normalized = ?, display_name = ?, store_id = ?, employee_id = ?,
            password_hash = ?, password_salt = ?, password_iterations = ?, password_algorithm = ?,
            password_updated_at = ?, version = ?, updated_at = ?
        WHERE id = ? AND version = ? AND employee_id IS NULL AND role = ?
          AND EXISTS (
            SELECT 1 FROM app_state
            WHERE scope_key = 'global' AND version = ? AND last_request_id = ?
          )
      `).bind(
        username,
        normalizedUsername,
        saved.name,
        storeId,
        saved.id,
        password?.hash || linkedTarget.password_hash,
        password?.salt || linkedTarget.password_salt,
        password?.iterations || linkedTarget.password_iterations,
        password?.algorithm || linkedTarget.password_algorithm,
        password ? commandContext.now : linkedTarget.password_updated_at,
        nextAuthVersion,
        commandContext.now,
        linkedTarget.id,
        currentAuthVersion,
        expectedAuthRole,
        nextStateVersion,
        commandContext.requestId,
      ))
      additionalStatements.push(db.prepare(`
        UPDATE sessions
        SET revoked_at = ?, last_seen_at = ?
        WHERE user_id = ? AND revoked_at IS NULL
          AND EXISTS (SELECT 1 FROM users WHERE id = ? AND version = ? AND employee_id = ?)
      `).bind(
        commandContext.now,
        commandContext.now,
        linkedTarget.id,
        linkedTarget.id,
        nextAuthVersion,
        saved.id,
      ))
    } else {
      const credentialsRequired = ['business_support', 'store_manager', 'office', 'store'].includes(unit)
      if (credentialsRequired && (!requestedUsername || !requestedPassword)) {
        throw new ApiError(400, 'EMPLOYEE_CREDENTIALS_REQUIRED', 'Tên đăng nhập và mật khẩu là bắt buộc cho vai trò này.')
      }
      if (requestedUsername || requestedPassword) {
        if (!requestedUsername || !requestedPassword) {
          throw new ApiError(400, 'EMPLOYEE_CREDENTIALS_REQUIRED', 'Tên đăng nhập và mật khẩu nhân viên phải được gửi cùng nhau.')
        }
        if (!/^[A-Za-z0-9._-]{3,80}$/u.test(requestedUsername)) {
          throw new ApiError(400, 'INVALID_USERNAME', 'Tên đăng nhập nhân viên không hợp lệ.')
        }
        const normalizedUsername = normalizeUsername(requestedUsername)
        const duplicate = await first(db, `
          SELECT id FROM users WHERE username_normalized = ? OR employee_id = ? LIMIT 1
        `, normalizedUsername, saved.id)
        if (duplicate) throw new ApiError(409, 'USER_EXISTS', 'Tên đăng nhập hoặc mã nhân viên đã có tài khoản.')
        const password = await hashPassword(requestedPassword)
        const userId = `usr_${crypto.randomUUID()}`
        responseUser = {
          id: userId,
          username: requestedUsername,
          displayName: saved.name,
          role: expectedAuthRole,
          storeId,
          employeeId: saved.id,
          status: 'active',
          version: 1,
          lastLoginAt: null,
        }
        saved.username = requestedUsername
        saved.authUserId = userId
        saved.authVersion = 1
        additionalStatements.push(db.prepare(`
          INSERT INTO users (
            id, username, username_normalized, display_name, password_hash, password_salt,
            password_iterations, password_algorithm, role, status, version, store_id, employee_id,
            created_at, updated_at, password_updated_at
          )
          SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', 1, ?, ?, ?, ?, ?
          WHERE EXISTS (
            SELECT 1 FROM app_state
            WHERE scope_key = 'global' AND version = ? AND last_request_id = ?
          )
        `).bind(
          userId,
          requestedUsername,
          normalizedUsername,
          saved.name,
          password.hash,
          password.salt,
          password.iterations,
          password.algorithm,
          expectedAuthRole,
          storeId,
          saved.id,
          commandContext.now,
          commandContext.now,
          commandContext.now,
          nextStateVersion,
          commandContext.requestId,
        ))
      }
    }
    }
  }

  if (operation === 'update') {
    const authEmployeeId = unit === 'store_manager' && previous?.linkedEmployeeId
      ? String(previous.linkedEmployeeId)
      : saved.id
    const authTarget = await first(db, 'SELECT * FROM users WHERE employee_id = ? LIMIT 1', authEmployeeId)
    if (authTarget) {
      if (authTarget.role !== expectedAuthRole) {
        throw new ApiError(409, 'EMPLOYEE_ROLE_MISMATCH', 'Vai trò tài khoản không khớp nhóm hồ sơ nhân viên.')
      }
      if (actor.role !== 'admin' && authTarget.status === 'inactive') {
        throw new ApiError(403, 'EMPLOYEE_REACTIVATE_FORBIDDEN', 'Chỉ Admin được khôi phục tài khoản nhân viên đã nghỉ việc.')
      }
      const username = requestedUsername || authTarget.username
      const normalizedUsername = normalizeUsername(username)
      if (!/^[A-Za-z0-9._-]{3,80}$/u.test(username)) {
        throw new ApiError(400, 'INVALID_USERNAME', 'Tên đăng nhập nhân viên không hợp lệ.')
      }
      const duplicate = await first(db, `
        SELECT id FROM users WHERE username_normalized = ? AND id <> ? LIMIT 1
      `, normalizedUsername, authTarget.id)
      if (duplicate) throw new ApiError(409, 'USER_EXISTS', 'Tên đăng nhập đã được sử dụng.')
      const password = requestedPassword ? await hashPassword(requestedPassword) : null
      const currentAuthVersion = Number(authTarget.version || 1)
      const nextAuthVersion = currentAuthVersion + 1
      responseUser = {
        ...publicUser(authTarget),
        username,
        displayName: saved.name,
        storeId,
        status: requestedStatus?.account || authTarget.status,
        version: nextAuthVersion,
      }
      saved.username = username
      saved.authUserId = authTarget.id
      saved.authVersion = nextAuthVersion
      stateGuard = {
        sql: 'SELECT 1 FROM users WHERE id = ? AND version = ?',
        bindings: [authTarget.id, currentAuthVersion],
      }
      additionalStatements.push(db.prepare(`
        UPDATE users
        SET username = ?, username_normalized = ?, display_name = ?, store_id = ?, status = ?,
            password_hash = ?, password_salt = ?, password_iterations = ?, password_algorithm = ?,
            password_updated_at = ?, version = ?, updated_at = ?
        WHERE id = ? AND version = ?
          AND EXISTS (
            SELECT 1 FROM app_state
            WHERE scope_key = 'global' AND version = ? AND last_request_id = ?
          )
      `).bind(
        username,
        normalizedUsername,
        saved.name,
        storeId,
        requestedStatus?.account || authTarget.status,
        password?.hash || authTarget.password_hash,
        password?.salt || authTarget.password_salt,
        password?.iterations || authTarget.password_iterations,
        password?.algorithm || authTarget.password_algorithm,
        password ? commandContext.now : authTarget.password_updated_at,
        nextAuthVersion,
        commandContext.now,
        authTarget.id,
        currentAuthVersion,
        nextStateVersion,
        commandContext.requestId,
      ))
      if (requestedPassword
        || String(authTarget.store_id || '') !== storeId
        || (requestedStatus && requestedStatus.account !== 'active')) {
        additionalStatements.push(db.prepare(`
          UPDATE sessions
          SET revoked_at = ?, last_seen_at = ?
          WHERE user_id = ? AND revoked_at IS NULL
            AND EXISTS (
              SELECT 1 FROM users WHERE id = ? AND version = ? AND updated_at = ?
            )
        `).bind(
          commandContext.now,
          commandContext.now,
          authTarget.id,
          authTarget.id,
          nextAuthVersion,
          commandContext.now,
        ))
      }
    } else {
      delete saved.username
      delete saved.authUserId
      delete saved.authVersion
      if (requestedUsername || requestedPassword) {
        if (!requestedUsername || !requestedPassword) {
          throw new ApiError(400, 'EMPLOYEE_CREDENTIALS_REQUIRED', 'Tên đăng nhập và mật khẩu nhân viên phải được gửi cùng nhau.')
        }
        if (!/^[A-Za-z0-9._-]{3,80}$/u.test(requestedUsername)) {
          throw new ApiError(400, 'INVALID_USERNAME', 'Tên đăng nhập nhân viên không hợp lệ.')
        }
        const normalizedUsername = normalizeUsername(requestedUsername)
        const duplicate = await first(db, `
          SELECT id FROM users WHERE username_normalized = ? OR employee_id = ? LIMIT 1
        `, normalizedUsername, saved.id)
        if (duplicate) throw new ApiError(409, 'USER_EXISTS', 'Tên đăng nhập hoặc mã nhân viên đã có tài khoản.')
        const password = await hashPassword(requestedPassword)
        const userId = `usr_${crypto.randomUUID()}`
        const accountStatus = employeeStatusValues(saved.status).account
        responseUser = {
          id: userId,
          username: requestedUsername,
          displayName: saved.name,
          role: expectedAuthRole,
          storeId,
          employeeId: saved.id,
          status: accountStatus,
          version: 1,
          lastLoginAt: null,
        }
        saved.username = requestedUsername
        saved.authUserId = userId
        saved.authVersion = 1
        stateGuard = {
          sql: 'SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM users WHERE username_normalized = ? OR employee_id = ?)',
          bindings: [normalizedUsername, saved.id],
        }
        additionalStatements.push(db.prepare(`
          INSERT INTO users (
            id, username, username_normalized, display_name, password_hash, password_salt,
            password_iterations, password_algorithm, role, status, version, store_id, employee_id,
            created_at, updated_at, password_updated_at
          )
          SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?
          WHERE EXISTS (
            SELECT 1 FROM app_state
            WHERE scope_key = 'global' AND version = ? AND last_request_id = ?
          )
        `).bind(
          userId,
          requestedUsername,
          normalizedUsername,
          saved.name,
          password.hash,
          password.salt,
          password.iterations,
          password.algorithm,
          expectedAuthRole,
          accountStatus,
          storeId,
          saved.id,
          commandContext.now,
          commandContext.now,
          commandContext.now,
          nextStateVersion,
          commandContext.requestId,
        ))
      }
    }
  }
  const nextEmployees = operation === 'create'
    ? [saved, ...employees]
    : employees.map((employee) => String(employee.id || employee.code || '') === employeeId ? saved : employee)
  const payrollTargets = []
  if (operation === 'update') {
    const targetPeriod = String(profilePayload.standardWorkDaysPeriod || '')
    const targetDaysChanged = Boolean(targetPeriod) && (
      Number(previous?.monthlyWorkdayTargets?.[targetPeriod]) !== Number(saved.monthlyWorkdayTargets?.[targetPeriod])
    )
    if (targetDaysChanged) {
      const period = payrollPeriodFor(state, storeId, targetPeriod)
      if (period?.lockedAt || period?.status === 'Đã khóa') {
        throw new ApiError(409, 'PAYROLL_PERIOD_LOCKED', 'Kỳ lương đã khóa; không thể đổi số ngày công.')
      }
      if (period?.confirmedAt || period?.status === 'Đã chi') {
        throw new ApiError(409, 'PAYROLL_PERIOD_PAID', 'Kỳ lương đã chi; không thể đổi số ngày công.')
      }
      payrollTargets.push({ storeId, period: targetPeriod })
    }
    const payrollFields = [
      'status', 'employmentType', 'payBasis', 'salaryBasis', 'salary',
      'monthlySalary', 'hourlyRate', 'baseSalary', 'requiredMonthlyHours',
      'standardWorkDays', 'payFormula', 'tiktokAllowance',
    ]
    const compensationChanged = payrollFields.some((field) => (
      JSON.stringify(canonicalize(previous?.[field])) !== JSON.stringify(canonicalize(saved?.[field]))
    ))
    if (compensationChanged) {
      const currentPeriod = localDateTimeParts(commandContext.now).date.slice(0, 7)
      if (unit === 'store' && isSecondMallSm234Store(store)) {
        assertPayrollNotPaidOrLocked(state, storeId, currentPeriod)
      }
      for (const period of Array.isArray(state.payrollPeriods) ? state.payrollPeriods : []) {
        if (String(period.storeId || '') !== storeId
          || period.status !== 'Đã chốt'
          || period.confirmedAt
          || period.lockedAt) continue
        payrollTargets.push({ storeId, period: String(period.period || '') })
      }
    }
  }
  const identityImageUpdate = linkedStoreEmployee
    ? { identityImages: linkedIdentityImages, uploadedKeys: [], retiredKeys: [] }
    : ['business_support', 'store_manager', 'office', 'store'].includes(unit)
      ? await prepareIdentityImageUpdate(env, profilePayload, previous, saved.id, commandContext.now)
    : { identityImages: {}, uploadedKeys: [], retiredKeys: [] }
  if (Object.keys(identityImageUpdate.identityImages).length) saved.identityImages = identityImageUpdate.identityImages
  else delete saved.identityImages
  const nextState = {
    ...state,
    employees: nextEmployees,
    stores: (Array.isArray(state.stores) ? state.stores : []).map((item) => ({
      ...item,
      employees: nextEmployees.filter((employee) => (
        String(employee.storeId || '') === String(item.id || '')
        && employeeUnit(employee) === 'store'
        && !employee.deletedAt
        && !['Đã nghỉ việc', 'inactive'].includes(String(employee.status || ''))
      )).length,
    })),
    payrollPeriods: invalidateClosedPayrollPeriods(state, payrollTargets, commandContext.now, body.type),
    stateVersion: Math.max(1, Number(state.stateVersion) || 1) + 1,
  }
  try {
    const response = await commitGlobalStateDomainCommand(db, actor, current, nextState, {
      action: body.type,
      entityType: 'employee',
      entityId: saved.id,
      before: previous,
      after: saved,
      metadata: { payrollTargets },
      response: { command: body.type, employee: saved, ...(responseUser ? { user: responseUser } : {}) },
      additionalStatements,
      stateGuard,
      status: operation === 'create' ? 201 : 200,
    }, commandContext)
    await bestEffortDeleteIdentityImages(env?.IDENTITY_IMAGES, identityImageUpdate.retiredKeys)
    return response
  } catch (error) {
    await bestEffortDeleteIdentityImages(env?.IDENTITY_IMAGES, identityImageUpdate.uploadedKeys)
    throw error
  }
}

const BRIGHT_SHIFT_COLORS = Object.freeze([
  '#22C55E', '#3B82F6', '#F97316', '#A855F7', '#EC4899',
  '#06B6D4', '#EAB308', '#EF4444', '#14B8A6', '#8B5CF6',
])

const shiftDefinitionCommand = async (db, actor, body, commandContext) => {
  assertOperationsRole(actor, 'Tài khoản không có quyền quản lý ca làm việc cửa hàng.')
  const operation = body.type.split('.').at(-1)
  if (!['create', 'update', 'delete'].includes(operation)) {
    throw new ApiError(400, 'COMMAND_UNKNOWN', 'Lệnh ca làm việc không được hỗ trợ.')
  }
  const payload = isPlainRecord(body.payload) ? body.payload : {}
  const { current, state } = await loadGlobalCommandState(db, body)
  const definitions = Array.isArray(state.shiftDefinitions) ? state.shiftDefinitions : []
  const shiftId = operation === 'create'
    ? String(payload.id || `shift_${crypto.randomUUID()}`).trim()
    : String(payload.shiftId || payload.id || '').trim()
  if (!/^[A-Za-z0-9_-]{1,160}$/u.test(shiftId)) throw new ApiError(400, 'SHIFT_INVALID', 'Mã ca làm việc không hợp lệ.')
  const previous = definitions.find((shift) => String(shift.id || '') === shiftId && !shift.deletedAt)
  if (operation !== 'create' && !previous) throw new ApiError(404, 'SHIFT_NOT_FOUND', 'Không tìm thấy ca làm việc.')
  const storeId = String(payload.storeId ?? previous?.storeId ?? '').trim()
  assertOperationalStoreAccess(actor, storeId)
  requireStore(state, storeId)

  if (operation === 'delete') {
    const deleted = { ...previous, deletedAt: commandContext.now, deletedBy: serverActorSnapshot(actor), active: false }
    const nextState = {
      ...state,
      shiftDefinitions: definitions.map((shift) => String(shift.id || '') === shiftId ? deleted : shift),
      stateVersion: Math.max(1, Number(state.stateVersion) || 1) + 1,
    }
    return commitGlobalStateDomainCommand(db, actor, current, nextState, {
      action: body.type,
      entityType: 'shift-definition',
      entityId: shiftId,
      before: previous,
      after: deleted,
      response: { command: body.type, shift: deleted },
    }, commandContext)
  }

  const name = String(payload.name ?? previous?.name ?? '').trim().slice(0, 160)
  const date = String(payload.date ?? previous?.date ?? '').trim()
  const start = parseShiftTime(payload.start ?? previous?.start)
  const end = parseShiftTime(payload.end ?? previous?.end)
  if (!name) throw new ApiError(400, 'SHIFT_NAME_INVALID', 'Tên ca không được để trống.')
  if (date && !/^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/u.test(date)) {
    throw new ApiError(400, 'SHIFT_DATE_INVALID', 'Ngày áp dụng ca phải có định dạng YYYY-MM-DD.')
  }
  if (!start || !end || end.minuteOfDay <= start.minuteOfDay) {
    throw new ApiError(400, 'SHIFT_TIME_INVALID', 'Giờ bắt đầu/kết thúc phải theo định dạng 24 giờ và giờ kết thúc phải sau giờ bắt đầu.')
  }
  const sameStoreCount = definitions.filter((shift) => String(shift.storeId || '') === storeId && !shift.deletedAt).length
  const shift = {
    ...(previous || {}),
    id: shiftId,
    storeId,
    name,
    date: date || null,
    start: start.label,
    end: end.label,
    time: `${start.label} - ${end.label}`,
    color: previous?.color || BRIGHT_SHIFT_COLORS[sameStoreCount % BRIGHT_SHIFT_COLORS.length],
    durationMinutes: end.minuteOfDay - start.minuteOfDay,
    durationHours: (end.minuteOfDay - start.minuteOfDay) / 60,
    version: operation === 'create' ? 1 : Number(previous?.version || 1) + 1,
    active: true,
    ...(operation === 'create'
      ? { createdAt: commandContext.now, createdBy: serverActorSnapshot(actor) }
      : { updatedAt: commandContext.now, updatedBy: serverActorSnapshot(actor) }),
  }
  const nextState = {
    ...state,
    shiftDefinitions: operation === 'create'
      ? [shift, ...definitions]
      : definitions.map((item) => String(item.id || '') === shiftId ? shift : item),
    stateVersion: Math.max(1, Number(state.stateVersion) || 1) + 1,
  }
  return commitGlobalStateDomainCommand(db, actor, current, nextState, {
    action: body.type,
    entityType: 'shift-definition',
    entityId: shiftId,
    before: previous,
    after: shift,
    response: { command: body.type, shift },
    status: operation === 'create' ? 201 : 200,
  }, commandContext)
}

const scheduleCommand = async (db, actor, body, commandContext) => {
  assertOperationsRole(actor, 'Tài khoản không có quyền phân ca cửa hàng.')
  if (!['schedule.assign', 'schedule.replace_day'].includes(body.type)) {
    throw new ApiError(400, 'COMMAND_UNKNOWN', 'Lệnh lịch phân ca không được hỗ trợ.')
  }
  const payload = isPlainRecord(body.payload) ? body.payload : {}
  const storeId = String(payload.storeId || '').trim()
  const date = String(payload.date || '').trim()
  assertOperationalStoreAccess(actor, storeId)
  if (!/^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/u.test(date)) {
    throw new ApiError(400, 'SCHEDULE_DATE_INVALID', 'Ngày phân ca phải có định dạng YYYY-MM-DD.')
  }
  const { current, state } = await loadGlobalCommandState(db, body)
  requireStore(state, storeId)
  const storeEmployees = new Set((Array.isArray(state.employees) ? state.employees : [])
    .filter((employee) => (
      employeeWorksAtStoreOnDate(state, employee, storeId, date)
      && employeeUnit(employee) === 'store'
      && !employee.deletedAt
    ))
    .map((employee) => String(employee.id || employee.code || '')))
  const shiftDefinitions = (Array.isArray(state.shiftDefinitions) ? state.shiftDefinitions : [])
    .filter((shift) => String(shift.storeId || '') === storeId && !shift.deletedAt && shift.active !== false)
  const shifts = new Map(shiftDefinitions.map((shift) => [String(shift.id || ''), shift]))
  const schedule = Array.isArray(state.schedule) ? state.schedule : []
  let rawAssignments
  if (body.type === 'schedule.assign') {
    const employeeIds = Array.isArray(payload.employeeIds) ? [...new Set(payload.employeeIds.map(String))] : []
    const shiftIds = Array.isArray(payload.shiftIds) ? [...new Set(payload.shiftIds.map(String))] : []
    if (!employeeIds.length || !shiftIds.length) {
      throw new ApiError(400, 'SCHEDULE_ASSIGNMENT_INVALID', 'Cần chọn ít nhất một ca và một nhân viên.')
    }
    rawAssignments = employeeIds.map((employeeId) => ({ employeeId, shiftIds, note: payload.note }))
  } else {
    if (!Array.isArray(payload.assignments) || payload.assignments.length > 500) {
      throw new ApiError(400, 'SCHEDULE_ASSIGNMENT_INVALID', 'Danh sách phân ca không hợp lệ.')
    }
    rawAssignments = payload.assignments
  }
  const assignments = rawAssignments.map((assignment, index) => {
    if (!isPlainRecord(assignment)) throw new ApiError(400, 'SCHEDULE_ASSIGNMENT_INVALID', `Phân ca thứ ${index + 1} không hợp lệ.`)
    const employeeId = String(assignment.employeeId || '').trim()
    const shiftIds = Array.isArray(assignment.shiftIds)
      ? [...new Set(assignment.shiftIds.map(String))]
      : [String(assignment.shiftId || '')].filter(Boolean)
    if (!storeEmployees.has(employeeId)) {
      throw new ApiError(400, 'EMPLOYEE_STORE_MISMATCH', `Nhân viên ${employeeId || index + 1} không thuộc cửa hàng.`)
    }
    if (!shiftIds.length || shiftIds.some((shiftId) => !shifts.has(shiftId))) {
      throw new ApiError(400, 'SHIFT_INVALID', `Ca làm việc của nhân viên ${employeeId} không hợp lệ.`)
    }
    const mismatchedShift = shiftIds.map((shiftId) => shifts.get(shiftId))
      .find((shift) => shift.date && String(shift.date) !== date)
    if (mismatchedShift) {
      throw new ApiError(400, 'SHIFT_DATE_MISMATCH', `Ca ${mismatchedShift.name || mismatchedShift.id} chỉ áp dụng ngày ${mismatchedShift.date}.`)
    }
    const previousAssignment = schedule.find((entry) => (
      String(entry.storeId || '') === storeId
      && String(entry.date || entry.workDate || '') === date
      && employeeReference(entry) === employeeId
    ))
    const previousSnapshots = new Map((Array.isArray(previousAssignment?.shiftSnapshots) ? previousAssignment.shiftSnapshots : [])
      .filter(isPlainRecord)
      .map((snapshot) => [String(snapshot.id || ''), snapshot]))
    const shiftSnapshots = shiftIds.map((shiftId) => {
      const previousSnapshot = previousSnapshots.get(shiftId)
      if (previousSnapshot) return previousSnapshot
      const shift = shifts.get(shiftId)
      return {
        id: shift.id,
        name: shift.name,
        start: shift.start,
        end: shift.end,
        time: shift.time || `${shift.start} - ${shift.end}`,
        color: shift.color,
        durationMinutes: Number(shift.durationMinutes || 0),
        durationHours: Number(shift.durationHours || 0),
        date: shift.date || null,
        version: Number(shift.version || 1),
      }
    })
    return {
      id: String(assignment.id || previousAssignment?.id || `schedule_${crypto.randomUUID()}`),
      storeId,
      employeeId,
      date,
      shiftIds,
      shiftId: shiftIds[0],
      shiftSnapshots,
      note: String(assignment.note || '').trim().slice(0, 500),
      createdAt: previousAssignment?.createdAt || commandContext.now,
      createdBy: previousAssignment?.createdBy || serverActorSnapshot(actor),
      ...(previousAssignment ? { updatedAt: commandContext.now, updatedBy: serverActorSnapshot(actor) } : {}),
    }
  })
  const outsideDay = schedule.filter((entry) => !(
    String(entry.storeId || '') === storeId && String(entry.date || entry.workDate || '') === date
  ))
  let nextDay = assignments
  if (body.type === 'schedule.assign') {
    const selected = new Set(assignments.map((entry) => entry.employeeId))
    nextDay = [
      ...assignments,
      ...schedule.filter((entry) => (
        String(entry.storeId || '') === storeId
        && String(entry.date || entry.workDate || '') === date
        && !selected.has(employeeReference(entry))
      )),
    ]
  }
  const nextState = {
    ...state,
    schedule: [...nextDay, ...outsideDay],
    stateVersion: Math.max(1, Number(state.stateVersion) || 1) + 1,
  }
  return commitGlobalStateDomainCommand(db, actor, current, nextState, {
    action: body.type,
    entityType: 'schedule-day',
    entityId: `${storeId}:${date}`,
    before: schedule.filter((entry) => String(entry.storeId || '') === storeId && String(entry.date || entry.workDate || '') === date),
    after: nextDay,
    metadata: { storeId, date, assignmentCount: nextDay.length },
    response: { command: body.type, storeId, date, assignments: nextDay },
  }, commandContext)
}

const optionalCalendarDate = (value, field) => {
  const date = String(value || '').trim()
  if (!date) return ''
  const match = date.match(/^(\d{4})-(\d{2})-(\d{2})$/u)
  const parsed = match ? new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))) : null
  if (!parsed
    || parsed.getUTCFullYear() !== Number(match[1])
    || parsed.getUTCMonth() + 1 !== Number(match[2])
    || parsed.getUTCDate() !== Number(match[3])) {
    throw new ApiError(400, 'DATE_INVALID', `${field} không hợp lệ.`)
  }
  return date
}

const accountSettingsCommand = async (db, actor, body, commandContext) => {
  if (!VALID_ROLES.has(actor.role)) throw new ApiError(403, 'ROLE_FORBIDDEN', 'Tài khoản không có quyền cập nhật thiết lập tài khoản.')
  if (body.type !== 'account_settings.update') {
    throw new ApiError(400, 'COMMAND_UNKNOWN', 'Lệnh thiết lập tài khoản không được hỗ trợ.')
  }
  const payload = isPlainRecord(body.payload?.settings) ? body.payload.settings : (isPlainRecord(body.payload) ? body.payload : {})
  const { current, state } = await loadGlobalCommandState(db, body)
  const target = await first(db, "SELECT * FROM users WHERE id = ? AND role IN ('admin', 'business_support', 'store_manager', 'employee') LIMIT 1", actor.user_id)
  if (!target) throw new ApiError(404, 'USER_NOT_FOUND', 'Không tìm thấy tài khoản quản trị hiện tại.')
  const previous = ownAccountSettings(state, actor)
  const next = { ...previous }
  if (payload.name !== undefined) next.name = String(payload.name || '').trim().slice(0, 160)
  if (!next.name) throw new ApiError(400, 'DISPLAY_NAME_INVALID', 'Họ tên không được để trống.')
  if (payload.email !== undefined) {
    const email = String(payload.email || '').trim().toLowerCase()
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) {
      throw new ApiError(400, 'EMAIL_INVALID', 'Email không đúng định dạng.')
    }
    next.email = email.slice(0, 254)
  }
  if (payload.phone !== undefined) {
    const phone = String(payload.phone || '').replace(/\D/gu, '')
    if (phone && !/^0\d{9}$/u.test(phone)) {
      throw new ApiError(400, 'PHONE_INVALID', 'Số điện thoại phải có đúng 10 số và bắt đầu bằng số 0.')
    }
    next.phone = phone
  }
  if (payload.birthday !== undefined) next.birthday = optionalCalendarDate(payload.birthday, 'Ngày sinh')
  if (payload.gender !== undefined) {
    const gender = String(payload.gender || '').trim()
    if (gender && !['Nam', 'Nữ', 'Khác'].includes(gender)) {
      throw new ApiError(400, 'GENDER_INVALID', 'Giới tính không hợp lệ.')
    }
    next.gender = gender
  }
  if (payload.address !== undefined) next.address = String(payload.address || '').trim().slice(0, 500)
  if (payload.bio !== undefined) {
    const bio = String(payload.bio || '').trim()
    if (bio.length > 200) throw new ApiError(400, 'BIO_TOO_LONG', 'Giới thiệu không được vượt quá 200 ký tự.')
    next.bio = bio
  }
  if (payload.avatar !== undefined) {
    const avatar = String(payload.avatar || '')
    if (avatar && !/^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/=]+$/u.test(avatar)) {
      throw new ApiError(400, 'AVATAR_INVALID', 'Ảnh đại diện phải là ảnh PNG hoặc JPEG hợp lệ.')
    }
    const base64 = avatar.split(',')[1] || ''
    const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0
    const avatarBytes = avatar ? Math.max(0, Math.floor(base64.length * 3 / 4) - padding) : 0
    if (avatarBytes > MAX_AVATAR_BYTES) {
      throw new ApiError(413, 'AVATAR_TOO_LARGE', 'Ảnh đại diện không được vượt quá 200 KB.')
    }
    next.avatar = avatar
  }
  if (payload.notifications !== undefined) {
    if (!isPlainRecord(payload.notifications)) {
      throw new ApiError(400, 'NOTIFICATION_PREFERENCES_INVALID', 'Thiết lập thông báo không hợp lệ.')
    }
    const notifications = { ...previous.notifications }
    for (const key of ['tasks', 'dailyReport', 'expenseAlert']) {
      if (payload.notifications[key] !== undefined) {
        if (typeof payload.notifications[key] !== 'boolean') {
          throw new ApiError(400, 'NOTIFICATION_PREFERENCES_INVALID', 'Giá trị thông báo phải là bật hoặc tắt.')
        }
        notifications[key] = payload.notifications[key]
      }
    }
    next.notifications = notifications
  }
  const userId = String(actor.user_id)
  const currentUserVersion = Number(target.version || 1)
  const nextUserVersion = currentUserVersion + 1
  const nextStateVersion = Number(current.version) + 1
  const nextState = {
    ...state,
    accountSettings: { ...(isPlainRecord(state.accountSettings) ? state.accountSettings : {}), [userId]: next },
    stateVersion: Math.max(1, Number(state.stateVersion) || 1) + 1,
  }
  const responseUser = { ...publicUser(target), displayName: next.name, version: nextUserVersion }
  return commitGlobalStateDomainCommand(db, actor, current, nextState, {
    action: body.type,
    entityType: 'account-settings',
    entityId: userId,
    before: previous,
    after: next,
    response: { command: body.type, settings: next, user: responseUser },
    stateGuard: {
      sql: 'SELECT 1 FROM users WHERE id = ? AND version = ?',
      bindings: [userId, currentUserVersion],
    },
    additionalStatements: [db.prepare(`
      UPDATE users
      SET display_name = ?, version = ?, updated_at = ?
      WHERE id = ? AND version = ?
        AND EXISTS (
          SELECT 1 FROM app_state
          WHERE scope_key = 'global' AND version = ? AND last_request_id = ?
        )
    `).bind(
      next.name,
      nextUserVersion,
      commandContext.now,
      userId,
      currentUserVersion,
      nextStateVersion,
      commandContext.requestId,
    )],
  }, commandContext)
}

const notificationUnread = (record, actor) => !notificationReadAtForActor(record, actor)

const markNotificationReadForActor = (record, actor, timestamp) => {
  const actorId = notificationActorId(actor)
  if (!actorId) throw new ApiError(401, 'SESSION_INVALID', 'Phiên đăng nhập không hợp lệ.')
  return {
    ...record,
    readAtByUserId: {
      ...(isPlainRecord(record.readAtByUserId) ? record.readAtByUserId : {}),
      [actorId]: timestamp,
    },
    updatedAt: timestamp,
  }
}

const notificationCommand = async (db, actor, body, commandContext) => {
  const operation = body.type.split('.').at(-1)
  const markAll = ['mark_all_read', 'clear', 'clear_all'].includes(operation)
  if (operation !== 'mark_read' && !markAll) {
    throw new ApiError(400, 'COMMAND_UNKNOWN', 'Lệnh thông báo không được hỗ trợ.')
  }
  const payload = isPlainRecord(body.payload) ? body.payload : {}
  const { current, state } = await loadGlobalCommandState(db, body)
  const notifications = Array.isArray(state.notifications) ? state.notifications : []

  if (operation === 'mark_read') {
    const notificationId = String(payload.notificationId || payload.id || '').trim()
    if (!notificationId) throw new ApiError(400, 'NOTIFICATION_ID_REQUIRED', 'Cần chọn thông báo.')
    const previous = notifications.find((record) => String(record.id || record.notificationId || '') === notificationId)
    if (!previous || !canAccessNotification(state, actor, previous)) {
      throw new ApiError(404, 'NOTIFICATION_NOT_FOUND', 'Không tìm thấy thông báo trong phạm vi được phép.')
    }
    const previousProjected = projectNotificationForActor(previous, actor)
    if (!notificationUnread(previous, actor)) {
      return recordNoopCommand(db, actor, {
        command: body.type,
        version: Number(current.version),
        notification: previousProjected,
        notifications: [previousProjected],
        updatedCount: 0,
        existing: true,
      }, 200, commandContext)
    }
    const next = markNotificationReadForActor(previous, actor, commandContext.now)
    const nextProjected = projectNotificationForActor(next, actor)
    const nextState = {
      ...state,
      notifications: notifications.map((record) => (
        String(record.id || record.notificationId || '') === notificationId ? next : record
      )),
      stateVersion: Math.max(1, Number(state.stateVersion) || 1) + 1,
    }
    return commitGlobalStateDomainCommand(db, actor, current, nextState, {
      action: body.type,
      entityType: 'notification',
      entityId: notificationId,
      before: previous,
      after: next,
      metadata: { updatedCount: 1, readerId: notificationActorId(actor) },
      response: { command: body.type, notification: nextProjected, notifications: [nextProjected], updatedCount: 1 },
    }, commandContext)
  }

  const requestedStoreId = String(payload.storeId || '').trim()
  let storeId = requestedStoreId
  if (actor.role === 'employee') {
    storeId = String(actor.store_id || '')
    if (requestedStoreId && requestedStoreId !== storeId) {
      throw new ApiError(403, 'STORE_FORBIDDEN', 'Nhân viên chỉ được xử lý thông báo của cửa hàng mình.')
    }
  }
  if (actor.role === 'store_manager') {
    storeId = String(actor.store_id || '')
    if (requestedStoreId && requestedStoreId !== storeId) {
      throw new ApiError(403, 'STORE_SCOPE_FORBIDDEN', 'Quản lý cửa hàng chỉ được xử lý thông báo của cửa hàng mình.')
    }
  }
  if (storeId && ![OFFICE_STORE_ID, BUSINESS_SUPPORT_STORE_ID].includes(storeId)) requireStore(state, storeId)
  const targets = notifications.filter((record) => (
    notificationUnread(record, actor)
    && canAccessNotification(state, actor, record)
    && (!storeId || String(record.storeId || '') === storeId)
  ))
  if (!targets.length) {
    return recordNoopCommand(db, actor, {
      command: body.type,
      version: Number(current.version),
      storeId: storeId || null,
      notificationIds: [],
      notifications: [],
      updatedCount: 0,
      existing: true,
    }, 200, commandContext)
  }
  const targetIds = new Set(targets.map((record) => String(record.id || record.notificationId || '')))
  const updated = targets.map((record) => markNotificationReadForActor(record, actor, commandContext.now))
  const projectedUpdated = updated.map((record) => projectNotificationForActor(record, actor))
  const updatedById = new Map(updated.map((record) => [String(record.id || record.notificationId || ''), record]))
  const nextState = {
    ...state,
    notifications: notifications.map((record) => (
      updatedById.get(String(record.id || record.notificationId || '')) || record
    )),
    stateVersion: Math.max(1, Number(state.stateVersion) || 1) + 1,
  }
  return commitGlobalStateDomainCommand(db, actor, current, nextState, {
    action: body.type,
    entityType: 'notification-scope',
    entityId: `${actor.role}:${storeId || 'all'}`,
    before: targets.map((record) => ({ id: record.id || record.notificationId, readAt: notificationReadAtForActor(record, actor) })),
    after: projectedUpdated.map((record) => ({ id: record.id || record.notificationId, readAt: record.readAt })),
    metadata: { storeId: storeId || null, updatedCount: targetIds.size, readerId: notificationActorId(actor) },
    response: {
      command: body.type,
      storeId: storeId || null,
      notificationIds: [...targetIds],
      notifications: projectedUpdated,
      updatedCount: targetIds.size,
    },
  }, commandContext)
}

const monthsInDateRange = (fromDate, toDate) => {
  const start = new Date(`${fromDate}T00:00:00.000Z`)
  const end = new Date(`${toDate}T00:00:00.000Z`)
  if (start > end || (end.getTime() - start.getTime()) > 366 * 24 * 60 * 60 * 1000) {
    throw new ApiError(400, 'TRANSFER_DATE_RANGE_INVALID', 'Khoảng điều chuyển phải theo thứ tự và không vượt quá 366 ngày.')
  }
  const months = []
  let year = start.getUTCFullYear()
  let month = start.getUTCMonth() + 1
  const endKey = (end.getUTCFullYear() * 12) + end.getUTCMonth()
  while ((year * 12) + month - 1 <= endKey) {
    months.push(`${year}-${String(month).padStart(2, '0')}`)
    month += 1
    if (month > 12) {
      year += 1
      month = 1
    }
  }
  return months
}

const supportTransferCommand = async (db, actor, body, commandContext) => {
  if (!['admin', 'business_support'].includes(actor.role)) {
    throw new ApiError(403, 'ROLE_FORBIDDEN', 'Chỉ Admin hoặc Nhân viên hỗ trợ KD được quản lý điều chuyển nhân sự.')
  }
  const operation = body.type.split('.').at(-1)
  if (!['create', 'update', 'delete'].includes(operation)) {
    throw new ApiError(400, 'COMMAND_UNKNOWN', 'Lệnh điều chuyển hỗ trợ không được hỗ trợ.')
  }
  const payload = isPlainRecord(body.payload) ? body.payload : {}
  const { current, state } = await loadGlobalCommandState(db, body)
  const transfers = Array.isArray(state.supportTransfers) ? state.supportTransfers : []
  const transferId = operation === 'create'
    ? String(payload.id || `support_${crypto.randomUUID()}`).trim()
    : String(payload.transferId || payload.id || '').trim()
  if (!/^[A-Za-z0-9_-]{3,100}$/u.test(transferId)) {
    throw new ApiError(400, 'SUPPORT_TRANSFER_ID_INVALID', 'Mã điều chuyển không hợp lệ.')
  }
  if (operation === 'create' && transfers.some((record) => String(record.id || '') === transferId)) {
    throw new ApiError(409, 'SUPPORT_TRANSFER_EXISTS', 'Mã điều chuyển đã tồn tại.')
  }
  const previous = operation === 'create'
    ? null
    : transfers.find((record) => String(record.id || '') === transferId)
  if (operation !== 'create' && !previous) {
    throw new ApiError(404, 'SUPPORT_TRANSFER_NOT_FOUND', 'Không tìm thấy điều chuyển hỗ trợ.')
  }
  if (previous?.deletedAt || previous?.status === 'Đã xóa') {
    if (operation === 'delete') {
      return recordNoopCommand(db, actor, {
        command: body.type,
        version: Number(current.version),
        transfer: previous,
        existing: true,
      }, 200, commandContext)
    }
    throw new ApiError(409, 'SUPPORT_TRANSFER_DELETED', 'Điều chuyển hỗ trợ đã bị xóa.')
  }
  const employeeId = String(payload.employeeId ?? previous?.employeeId ?? '').trim()
  const employee = [
    ...(Array.isArray(state.employees) ? state.employees : []),
    ...(operation === 'create' ? [] : (Array.isArray(state.deletedEmployees) ? state.deletedEmployees : [])),
  ].find((record) => (
    String(record.id || record.code || '') === employeeId
    && employeeUnit(record) === 'store'
  ))
  if (!employee
    || (operation === 'create' && (employee.deletedAt || ['Đã nghỉ việc', 'inactive'].includes(String(employee.status || ''))))) {
    throw new ApiError(400, 'EMPLOYEE_INVALID', 'Nhân viên hỗ trợ không hợp lệ.')
  }
  const fromStoreId = String(previous?.fromStoreId || employee.storeId || '').trim()
  const requestedFromStoreId = String(payload.fromStoreId ?? fromStoreId).trim()
  if (requestedFromStoreId !== fromStoreId) {
    throw new ApiError(400, 'TRANSFER_SOURCE_MISMATCH', 'Cửa hàng điều chuyển phải đúng với cửa hàng hiện tại của nhân viên.')
  }
  const toStoreId = String(payload.toStoreId ?? previous?.toStoreId ?? '').trim()
  assertOperationalStoreAccess(actor, fromStoreId)
  assertOperationalStoreAccess(actor, toStoreId)
  requireStore(state, fromStoreId)
  requireStore(state, toStoreId)
  if (fromStoreId === toStoreId) {
    throw new ApiError(400, 'SUPPORT_STORE_INVALID', 'Cửa hàng hỗ trợ phải khác cửa hàng hiện tại của nhân viên.')
  }
  const fromDate = optionalCalendarDate(
    payload.fromDate ?? payload.startDate ?? payload.startAt?.slice?.(0, 10) ?? payload.date ?? previous?.fromDate,
    'Ngày bắt đầu',
  )
  const toDate = optionalCalendarDate(
    payload.toDate ?? payload.endDate ?? payload.endAt?.slice?.(0, 10) ?? payload.date ?? previous?.toDate,
    'Ngày kết thúc',
  )
  if (!fromDate || !toDate) throw new ApiError(400, 'TRANSFER_DATE_REQUIRED', 'Cần nhập đủ ngày bắt đầu và kết thúc.')
  const months = monthsInDateRange(fromDate, toDate)
  const previousMonths = previous ? monthsInDateRange(previous.fromDate, previous.toDate) : []
  const payrollTargets = [...new Map([
    ...[fromStoreId, toStoreId].flatMap((storeId) => months.map((period) => ({ storeId, period }))),
    ...(previous ? [previous.fromStoreId, previous.toStoreId]
      .flatMap((storeId) => previousMonths.map((period) => ({ storeId, period }))) : []),
  ].map((target) => [`${target.storeId}:${target.period}`, target])).values()]
  for (const target of payrollTargets) assertPayrollNotPaidOrLocked(state, target.storeId, target.period)

  if (operation === 'delete') {
    const reason = String(payload.reason || '').trim()
    if (!reason || reason.length > 500) {
      throw new ApiError(400, 'REASON_REQUIRED', 'Cần nhập lý do xóa từ 1 đến 500 ký tự.')
    }
    const deleted = {
      ...previous,
      status: 'Đã xóa',
      deletedAt: commandContext.now,
      deletedBy: serverActorSnapshot(actor),
      deleteReason: reason,
      updatedAt: commandContext.now,
    }
    const nextState = {
      ...state,
      supportTransfers: transfers.map((record) => String(record.id || '') === transferId ? deleted : record),
      payrollPeriods: invalidateClosedPayrollPeriods(state, payrollTargets, commandContext.now, body.type),
      stateVersion: Math.max(1, Number(state.stateVersion) || 1) + 1,
    }
    return commitGlobalStateDomainCommand(db, actor, current, nextState, {
      action: body.type,
      entityType: 'support-transfer',
      entityId: transferId,
      before: previous,
      after: deleted,
      metadata: { reason, payrollTargets },
      response: { command: body.type, transfer: deleted },
    }, commandContext)
  }

  const note = String(payload.note ?? previous?.note ?? '').trim()
  if (note.length > 1_000) throw new ApiError(400, 'NOTE_TOO_LONG', 'Ghi chú không được vượt quá 1.000 ký tự.')
  const rawHourlySupportRate = payload.hourlySupportRate ?? payload.hourlyRate
    ?? payload.supportHourlyRate ?? previous?.hourlySupportRate
  if (rawHourlySupportRate === undefined || rawHourlySupportRate === null || rawHourlySupportRate === '') {
    throw new ApiError(400, 'SUPPORT_HOURLY_RATE_REQUIRED', 'Cần nhập lương hỗ trợ theo giờ.')
  }
  const hourlySupportRate = asVnd(rawHourlySupportRate, 'Lương hỗ trợ theo giờ', { positive: true })
  const allowance = asVnd(payload.allowance ?? previous?.allowance ?? 0, 'Phụ cấp')
  const status = String(payload.status ?? previous?.status ?? 'Đã duyệt')
  if (!['Đã duyệt', 'Hoàn tất', 'Đã hủy'].includes(status)) {
    throw new ApiError(400, 'SUPPORT_TRANSFER_STATUS_INVALID', 'Trạng thái điều chuyển không hợp lệ.')
  }
  const overlap = transfers.find((record) => (
    String(record.id || '') !== transferId
    && String(record.employeeId || '') === employeeId
    && !record.deletedAt
    && !['Đã xóa', 'Đã hủy', 'Hoàn tất'].includes(String(record.status || ''))
    && String(record.fromDate || '') <= toDate
    && String(record.toDate || '') >= fromDate
  ))
  if (overlap) {
    throw new ApiError(409, 'SUPPORT_TRANSFER_OVERLAP', 'Nhân viên đã có lịch điều chuyển trùng thời gian.', { transferId: overlap.id })
  }
  const transfer = {
    ...(previous || {}),
    id: transferId,
    employeeId,
    employeeName: employee.name || employeeId,
    fromStoreId,
    toStoreId,
    fromDate,
    toDate,
    hourlySupportRate,
    allowance,
    note,
    status,
    ...(operation === 'create'
      ? { createdAt: commandContext.now, createdBy: serverActorSnapshot(actor) }
      : { updatedAt: commandContext.now, updatedBy: serverActorSnapshot(actor) }),
  }
  const nextState = {
    ...state,
    supportTransfers: operation === 'create'
      ? [transfer, ...transfers]
      : transfers.map((record) => String(record.id || '') === transferId ? transfer : record),
    payrollPeriods: invalidateClosedPayrollPeriods(state, payrollTargets, commandContext.now, body.type),
    stateVersion: Math.max(1, Number(state.stateVersion) || 1) + 1,
  }
  return commitGlobalStateDomainCommand(db, actor, current, nextState, {
    action: body.type,
    entityType: 'support-transfer',
    entityId: transferId,
    before: previous,
    after: transfer,
    metadata: { payrollTargets },
    response: { command: body.type, transfer },
    status: operation === 'create' ? 201 : 200,
  }, commandContext)
}

const RESET_ARRAY_COLLECTIONS = Object.freeze([
  'stores',
  'employees',
  'imports',
  'attendance',
  'attendanceAudit',
  'schedule',
  'tasks',
  'taskAssignmentHistory',
  'officeAdjustments',
  'orders',
  'orderAudit',
  'notifications',
  'expenseEntries',
  'fixedExpenses',
  'cashTransactions',
  'salaryAdjustments',
  'salaryAdvances',
  'payrollPeriods',
  'payrollPayments',
  'shiftDefinitions',
  'importVouchers',
  'auditLogs',
  'deletedStores',
  'deletedEmployees',
  'supportTransfers',
  'operationalResetHistory',
  'supportWorkAssignments',
  'policyHistory',
])

const resetStateSummary = (state) => ({
  schemaVersion: Number(state.schemaVersion || 0),
  stateVersion: Number(state.stateVersion || 0),
  collections: Object.fromEntries(RESET_ARRAY_COLLECTIONS.map((key) => [key, Array.isArray(state[key]) ? state[key].length : 0])),
})

const normalizeDemoResetState = (value, currentState) => {
  if (!isPlainRecord(value)) {
    throw new ApiError(400, 'RESET_STATE_INVALID', 'Dữ liệu mẫu phải là một đối tượng JSON.')
  }
  const normalized = normalizeSharedStateForStorage(value)
  for (const required of ['stores', 'employees']) {
    if (!Array.isArray(normalized[required])) {
      throw new ApiError(400, 'RESET_STATE_INVALID', `Dữ liệu mẫu thiếu danh sách ${required}.`)
    }
  }
  for (const key of RESET_ARRAY_COLLECTIONS) {
    if (normalized[key] !== undefined && !Array.isArray(normalized[key])) {
      throw new ApiError(400, 'RESET_STATE_INVALID', `Bộ sưu tập ${key} phải là một mảng.`)
    }
    if (Array.isArray(normalized[key]) && normalized[key].some((record) => !isPlainRecord(record))) {
      throw new ApiError(400, 'RESET_STATE_INVALID', `Bộ sưu tập ${key} chỉ được chứa đối tượng.`)
    }
  }
  const uniqueIds = (records, field, label) => {
    const ids = records.map((record) => String(record[field] || '').trim())
    if (ids.some((id) => !id) || new Set(ids).size !== ids.length) {
      throw new ApiError(400, 'RESET_STATE_INVALID', `${label} phải có mã duy nhất và không được để trống.`)
    }
  }
  uniqueIds(normalized.stores, 'id', 'Cửa hàng')
  uniqueIds(normalized.employees, 'id', 'Nhân viên')
  const storeIds = new Set(normalized.stores.map((store) => String(store.id)))
  if (normalized.activeStoreId !== undefined && normalized.activeStoreId !== null
    && !storeIds.has(String(normalized.activeStoreId))) {
    throw new ApiError(400, 'RESET_STATE_INVALID', 'Cửa hàng đang chọn không tồn tại trong dữ liệu mẫu.')
  }
  const schemaVersion = Number(normalized.schemaVersion || 2)
  if (!Number.isInteger(schemaVersion) || schemaVersion < 1 || schemaVersion > 2) {
    throw new ApiError(400, 'RESET_STATE_INVALID', 'Phiên bản lược đồ dữ liệu mẫu không được hỗ trợ.')
  }
  return {
    ...normalized,
    schemaVersion,
    accountSettings: isPlainRecord(currentState.accountSettings) ? currentState.accountSettings : {},
  }
}

const systemResetDemoCommand = async (db, actor, body, commandContext) => {
  assertAdmin(actor, 'Chỉ Admin được Reset dữ liệu mẫu.')
  if (body.type !== 'system.reset_demo') {
    throw new ApiError(400, 'COMMAND_UNKNOWN', 'Lệnh hệ thống không được hỗ trợ.')
  }
  const payload = isPlainRecord(body.payload) ? body.payload : {}
  const { current, state } = await loadGlobalCommandState(db, body)
  const resetState = normalizeDemoResetState(payload.state, state)
  const adminSettings = isPlainRecord(resetState.accountSettings?.[actor.user_id])
    ? { [actor.user_id]: resetState.accountSettings[actor.user_id] }
    : {}
  const nextState = {
    ...resetState,
    accountSettings: adminSettings,
    stateVersion: Math.max(1, Number(state.stateVersion) || 1) + 1,
  }
  const projectedState = projectSharedState(nextState, actor)
  const nextStateVersion = Number(current.version) + 1
  return commitGlobalStateDomainCommand(db, actor, current, nextState, {
    action: body.type,
    entityType: 'system',
    entityId: 'demo-state',
    before: resetStateSummary(state),
    after: resetStateSummary(nextState),
    metadata: {
      nonAdminAccountsPurged: true,
      nonAdminSessionsPurged: true,
      preservedAdminAccountSettings: true,
    },
    response: { command: body.type, state: projectedState, nonAdminAccountsPurged: true },
    additionalStatements: [
      db.prepare(`
        DELETE FROM users
        WHERE role <> 'admin'
          AND EXISTS (
            SELECT 1 FROM app_state
            WHERE scope_key = 'global' AND version = ? AND last_request_id = ?
          )
      `).bind(nextStateVersion, commandContext.requestId),
    ],
  }, commandContext)
}

const RESET_ALL_PENDING_METADATA_KEY = 'system:reset_all_pending'
const IDENTITY_IMAGE_KEY_PREFIX = 'identity-images/'

const identityImageKeysFromState = (state) => {
  const keys = new Set()
  for (const collection of ['employees', 'deletedEmployees']) {
    for (const profile of Array.isArray(state?.[collection]) ? state[collection] : []) {
      if (!isPlainRecord(profile?.identityImages)) continue
      for (const metadata of Object.values(profile.identityImages)) {
        const key = String(metadata?.key || '')
        if (key.startsWith(IDENTITY_IMAGE_KEY_PREFIX)) keys.add(key)
      }
    }
  }
  return keys
}

const listIdentityImageKeysForReset = async (bucket, state = null) => {
  if (!bucket?.list || !bucket?.delete) {
    throw new ApiError(503, 'IDENTITY_IMAGE_STORAGE_UNAVAILABLE', 'Reset toàn bộ dữ liệu cần kho ảnh CCCD có quyền liệt kê và xóa.')
  }
  const keys = identityImageKeysFromState(state)
  let cursor
  const seenCursors = new Set()
  try {
    for (let pageIndex = 0; pageIndex < 10_000; pageIndex += 1) {
      const page = await bucket.list({ prefix: IDENTITY_IMAGE_KEY_PREFIX, ...(cursor ? { cursor } : {}) })
      for (const object of Array.isArray(page?.objects) ? page.objects : []) {
        const key = String(object?.key || '')
        if (key.startsWith(IDENTITY_IMAGE_KEY_PREFIX)) keys.add(key)
      }
      if (!page?.truncated) return [...keys].sort()
      const nextCursor = String(page.cursor || '')
      if (!nextCursor || seenCursors.has(nextCursor)) {
        throw new Error('R2 pagination cursor is missing or repeated')
      }
      seenCursors.add(nextCursor)
      cursor = nextCursor
    }
    throw new Error('R2 pagination exceeded the safety limit')
  } catch (error) {
    throw new ApiError(503, 'IDENTITY_IMAGE_LIST_FAILED', 'Không thể kiểm kê đầy đủ kho ảnh CCCD trước khi Reset toàn bộ dữ liệu.', {
      cause: String(error),
    })
  }
}

const purgeAndVerifyIdentityImages = async (bucket, initialKeys = null) => {
  let keys = Array.isArray(initialKeys) ? [...new Set(initialKeys)].sort() : await listIdentityImageKeysForReset(bucket)
  try {
    for (let pass = 0; pass < 3; pass += 1) {
      for (const key of keys) await bucket.delete(key)
      keys = await listIdentityImageKeysForReset(bucket)
      if (!keys.length) return
    }
  } catch (error) {
    if (error instanceof ApiError && error.code === 'RESET_CLEANUP_PENDING') throw error
    throw new ApiError(503, 'RESET_CLEANUP_PENDING', 'Dữ liệu D1 đã được Reset nhưng kho ảnh CCCD chưa xóa xong; hãy gửi lại đúng lệnh để tiếp tục.', {
      cause: String(error),
    })
  }
  throw new ApiError(503, 'RESET_CLEANUP_PENDING', 'Dữ liệu D1 đã được Reset nhưng vẫn còn ảnh CCCD; hãy gửi lại đúng lệnh để tiếp tục.', {
    remainingIdentityImageObjects: keys.length,
  })
}

const loadPendingSystemResetAll = (db) => first(db, `
  SELECT value_json FROM system_metadata WHERE meta_key = ? LIMIT 1
`, RESET_ALL_PENDING_METADATA_KEY)

const finalizeSystemResetAll = async (db, pendingRow) => {
  const markerJson = String(pendingRow?.value_json || '')
  const marker = parseStoredJson(markerJson, null)
  if (!isPlainRecord(marker) || !isPlainRecord(marker.responseBody) || !isPlainRecord(marker.audit)) {
    throw new ApiError(500, 'RESET_MARKER_INVALID', 'Trạng thái tiếp tục Reset toàn bộ dữ liệu không hợp lệ.')
  }
  const markerGuardSql = `
    SELECT 1 FROM system_metadata WHERE meta_key = ? AND value_json = ?
  `
  const responseJson = JSON.stringify(marker.responseBody)
  try {
    await db.batch([
      db.prepare(`
        INSERT INTO audit_log (
          request_id, actor_id, actor_role, action, entity_type, entity_id,
          before_json, after_json, metadata_json, server_timestamp
        )
        SELECT ?, ?, ?, 'system.reset_all', 'system', 'all-application-data', ?, ?, ?, ?
        WHERE EXISTS (${markerGuardSql})
      `).bind(
        marker.requestId,
        marker.actorId,
        marker.actorRole,
        boundedAuditJson(marker.audit.before),
        boundedAuditJson(marker.audit.after),
        boundedAuditJson(marker.audit.metadata),
        marker.serverTime,
        RESET_ALL_PENDING_METADATA_KEY,
        markerJson,
      ),
      ...receiptStatements(db, {
        actorId: marker.actorId,
        idempotencyKey: marker.idempotencyKey,
        requestHash: marker.requestHash,
        responseJson,
        status: 200,
        createdAt: marker.serverTime,
        successSql: markerGuardSql,
        successBindings: [RESET_ALL_PENDING_METADATA_KEY, markerJson],
      }),
      db.prepare(`
        DELETE FROM system_metadata
        WHERE meta_key = ? AND value_json = ?
          AND EXISTS (
            SELECT 1 FROM command_receipts
            WHERE actor_id = ? AND idempotency_key = ? AND request_hash = ?
          )
      `).bind(
        RESET_ALL_PENDING_METADATA_KEY,
        markerJson,
        marker.actorId,
        marker.idempotencyKey,
        marker.requestHash,
      ),
    ])
  } catch (error) {
    const receipt = await loadReceipt(db, marker.actorId, marker.idempotencyKey)
    const replay = replayReceipt(receipt, marker.requestHash)
    if (replay) return replay
    throw new ApiError(500, 'RESET_FINALIZE_FAILED', 'Kho ảnh đã được xóa nhưng không thể hoàn tất biên nhận Reset.', {
      cause: String(error),
    })
  }
  const receipt = await loadReceipt(db, marker.actorId, marker.idempotencyKey)
  if (!receipt || await loadPendingSystemResetAll(db)) {
    throw new ApiError(500, 'RESET_FINALIZE_FAILED', 'Không thể xác nhận hoàn tất Reset toàn bộ dữ liệu.')
  }
  return jsonResponse(marker.responseBody)
}

const systemResetAllCommand = async (db, actor, body, commandContext, env) => {
  assertAdmin(actor, 'Chỉ Admin được Reset toàn bộ dữ liệu hệ thống.')
  if (body.type !== 'system.reset_all') {
    throw new ApiError(400, 'COMMAND_UNKNOWN', 'Lệnh hệ thống không được hỗ trợ.')
  }
  const payload = isPlainRecord(body.payload) ? body.payload : {}
  const unsupportedFields = Object.keys(payload).filter((key) => key !== 'confirmation')
  if (unsupportedFields.length) {
    throw new ApiError(400, 'RESET_PAYLOAD_INVALID', 'Reset toàn bộ dữ liệu chỉ nhận trường xác nhận.', {
      fields: unsupportedFields,
    })
  }
  if (payload.confirmation !== 'RESET_ALL_DATA') {
    throw new ApiError(400, 'RESET_CONFIRMATION_REQUIRED', 'Cần xác nhận chính xác RESET_ALL_DATA để Reset toàn bộ dữ liệu.')
  }

  const pendingRow = await loadPendingSystemResetAll(db)
  if (pendingRow) {
    const pending = parseStoredJson(pendingRow.value_json, null)
    if (!isPlainRecord(pending)
      || pending.actorId !== actor.user_id) {
      throw new ApiError(409, 'RESET_ALREADY_PENDING', 'Một lệnh Reset toàn bộ dữ liệu của Admin khác đang chờ xóa ảnh CCCD.')
    }
    await purgeAndVerifyIdentityImages(env?.IDENTITY_IMAGES)
    return finalizeSystemResetAll(db, pendingRow)
  }

  const { current, state } = await loadGlobalCommandState(db, body)
  const [
    removableAccounts,
    removableAdminAccounts,
    nonAdminAccounts,
    removableSessions,
    receipts,
    receiptChunks,
    audits,
    policies,
    counters,
    privateStateScopes,
    stateCollections,
    stateEntities,
  ] = await Promise.all([
    first(db, 'SELECT COUNT(*) AS count FROM users WHERE id <> ?', actor.user_id),
    first(db, "SELECT COUNT(*) AS count FROM users WHERE id <> ? AND role = 'admin'", actor.user_id),
    first(db, "SELECT COUNT(*) AS count FROM users WHERE role <> 'admin'"),
    first(db, 'SELECT COUNT(*) AS count FROM sessions WHERE id <> ?', actor.session_id),
    first(db, 'SELECT COUNT(*) AS count FROM command_receipts'),
    first(db, 'SELECT COUNT(*) AS count FROM command_receipt_chunks'),
    first(db, 'SELECT COUNT(*) AS count FROM audit_log'),
    first(db, 'SELECT COUNT(*) AS count FROM policies'),
    first(db, 'SELECT COUNT(*) AS count FROM counters'),
    first(db, "SELECT COUNT(*) AS count FROM app_state WHERE scope_key <> 'global'"),
    first(db, 'SELECT COUNT(*) AS count FROM state_collections'),
    first(db, 'SELECT COUNT(*) AS count FROM state_entities'),
  ])
  const adminAccountIds = [String(actor.user_id)]
  const actorAccountSettings = isPlainRecord(state.accountSettings?.[actor.user_id])
    ? state.accountSettings[actor.user_id]
    : ownAccountSettings(state, actor)
  const preservedAccountSettings = { [actor.user_id]: actorAccountSettings }
  const identityImageKeys = await listIdentityImageKeysForReset(env?.IDENTITY_IMAGES, state)
  const nextState = {
    schemaVersion: Number.isInteger(Number(state.schemaVersion)) && Number(state.schemaVersion) > 0
      ? Number(state.schemaVersion)
      : 2,
    stateVersion: Math.max(1, Number(state.stateVersion) || 1) + 1,
    accountSettings: preservedAccountSettings,
    ...Object.fromEntries(RESET_ARRAY_COLLECTIONS.map((key) => [key, []])),
  }
  const purged = {
    accounts: Number(removableAccounts?.count || 0),
    otherAdminAccounts: Number(removableAdminAccounts?.count || 0),
    nonAdminAccounts: Number(nonAdminAccounts?.count || 0),
    sessions: Number(removableSessions?.count || 0),
    commandReceipts: Number(receipts?.count || 0),
    commandReceiptChunks: Number(receiptChunks?.count || 0),
    audits: Number(audits?.count || 0),
    policies: Number(policies?.count || 0),
    counters: Number(counters?.count || 0),
    privateStateScopes: Number(privateStateScopes?.count || 0),
    stateCollections: Number(stateCollections?.count || 0),
    stateEntities: Number(stateEntities?.count || 0),
    identityImageObjectsTargeted: identityImageKeys.length,
  }
  const nextStateVersion = Number(current.version) + 1
  const responseBody = apiPayload(commandContext, {
    command: body.type,
    state: projectSharedState(nextState, actor),
    reset: {
      purged,
      preservedAdminAccountIds: adminAccountIds,
      preservedCurrentAdminSession: true,
      preservedAdminAccountSettings: Object.keys(preservedAccountSettings).sort(),
      defaultPolicyCount: Object.keys(DEFAULT_POLICIES).length,
      identityImagePrefix: IDENTITY_IMAGE_KEY_PREFIX,
      identityImageStorageVerifiedEmpty: true,
    },
    version: nextStateVersion,
  })
  const marker = {
    schema: 1,
    actorId: actor.user_id,
    actorRole: actor.role,
    idempotencyKey: commandContext.idempotencyKey,
    requestHash: commandContext.hash,
    requestId: commandContext.requestId,
    serverTime: commandContext.now,
    responseBody,
    audit: {
      before: resetStateSummary(state),
      after: resetStateSummary(nextState),
      metadata: {
        confirmation: 'RESET_ALL_DATA',
        purged,
        preservedAdminAccountIds: adminAccountIds,
        preservedCurrentAdminSession: true,
        preservedAdminAccountSettings: Object.keys(preservedAccountSettings).sort(),
        defaultPoliciesRestored: Object.keys(DEFAULT_POLICIES).sort(),
        identityImagePrefix: IDENTITY_IMAGE_KEY_PREFIX,
      },
    },
  }
  const markerJson = JSON.stringify(marker)
  const guardSql = `
    EXISTS (
      SELECT 1 FROM app_state
      WHERE scope_key = 'global' AND version = ? AND last_request_id = ?
    )
  `
  const stateCommit = prepareStateCommit(db, {
    current,
    nextState,
    scope: 'global',
    currentVersion: Number(current.version),
    nextVersion: nextStateVersion,
    now: commandContext.now,
    actorId: actor.user_id,
    requestId: commandContext.requestId,
  })
  const additionalStatements = [
    db.prepare(`DELETE FROM app_state WHERE scope_key <> 'global' AND ${guardSql}`)
      .bind(nextStateVersion, commandContext.requestId),
    db.prepare(`DELETE FROM audit_log WHERE ${guardSql}`)
      .bind(nextStateVersion, commandContext.requestId),
    db.prepare(`DELETE FROM command_receipt_chunks WHERE ${guardSql}`)
      .bind(nextStateVersion, commandContext.requestId),
    db.prepare(`DELETE FROM command_receipts WHERE ${guardSql}`)
      .bind(nextStateVersion, commandContext.requestId),
    db.prepare(`DELETE FROM sessions WHERE id <> ? AND ${guardSql}`)
      .bind(actor.session_id, nextStateVersion, commandContext.requestId),
    db.prepare(`DELETE FROM users WHERE id <> ? AND ${guardSql}`)
      .bind(actor.user_id, nextStateVersion, commandContext.requestId),
    db.prepare(`DELETE FROM policies WHERE ${guardSql}`)
      .bind(nextStateVersion, commandContext.requestId),
    ...Object.entries(DEFAULT_POLICIES).map(([key, value]) => db.prepare(`
      INSERT INTO policies (
        policy_key, value_json, version, effective_at, updated_at, updated_by, last_request_id
      )
      SELECT ?, ?, 1, ?, ?, ?, ?
      WHERE ${guardSql}
    `).bind(
      key,
      JSON.stringify(value),
      commandContext.now,
      commandContext.now,
      actor.user_id,
      commandContext.requestId,
      nextStateVersion,
      commandContext.requestId,
    )),
    db.prepare(`DELETE FROM counters WHERE ${guardSql}`)
      .bind(nextStateVersion, commandContext.requestId),
    db.prepare(`
      INSERT INTO system_metadata (meta_key, value_json, version, updated_at)
      SELECT ?, ?, 1, ?
      WHERE ${guardSql}
      ON CONFLICT(meta_key) DO UPDATE SET
        value_json = excluded.value_json,
        version = system_metadata.version + 1,
        updated_at = excluded.updated_at
    `).bind(
      RESET_ALL_PENDING_METADATA_KEY,
      markerJson,
      commandContext.now,
      nextStateVersion,
      commandContext.requestId,
    ),
  ]
  let results
  try {
    results = await db.batch([
      stateCommit.mutation,
      ...stateCommit.externalStatements,
      ...additionalStatements,
    ])
  } catch (error) {
    const latest = await loadState(db, 'global')
    throw new ApiError(409, 'VERSION_CONFLICT', 'Dữ liệu đã thay đổi trên máy chủ trước khi Reset.', {
      currentVersion: Number(latest?.version || 0),
      cause: String(error),
    })
  }
  if (changes(results?.[0]) !== 1) {
    const latest = await loadState(db, 'global')
    throw new ApiError(409, 'VERSION_CONFLICT', 'Dữ liệu đã thay đổi trên máy chủ trước khi Reset.', {
      currentVersion: Number(latest?.version || 0),
    })
  }
  await purgeAndVerifyIdentityImages(env?.IDENTITY_IMAGES, identityImageKeys)
  return finalizeSystemResetAll(db, await loadPendingSystemResetAll(db))
}

const asVnd = (value, field, { positive = false } = {}) => {
  const amount = Number(value)
  if (!Number.isSafeInteger(amount) || amount < 0 || amount > MAX_MONEY_VND || (positive && amount === 0)) {
    throw new ApiError(400, 'MONEY_INVALID', `${field} phải là số nguyên ${positive ? 'dương' : 'không âm'} không quá ${MAX_MONEY_VND.toLocaleString('vi-VN')}đ.`)
  }
  return amount
}

const safeMoneySum = (left, right, field = 'Tổng tiền') => {
  const result = Number(left) + Number(right)
  if (!Number.isSafeInteger(result) || Math.abs(result) > Number.MAX_SAFE_INTEGER) {
    throw new ApiError(409, 'MONEY_TOTAL_INVALID', `${field} vượt quá giới hạn an toàn.`)
  }
  return result
}

const asMonth = (value, field = 'Kỳ') => {
  const period = String(value || '').trim()
  if (!/^\d{4}-(?:0[1-9]|1[0-2])$/u.test(period)) {
    throw new ApiError(400, 'PERIOD_INVALID', `${field} phải có định dạng YYYY-MM.`)
  }
  return period
}

const dateFromRecord = (record) => {
  const businessDate = String(record?.workDate || record?.attendanceDate || record?.date || '').trim()
  if (/^\d{4}-\d{2}-\d{2}$/u.test(businessDate)) return businessDate
  const source = String(record?.occurredAt || record?.createdAt || '').trim()
  if (/^\d{4}-\d{2}-\d{2}$/u.test(source)) return source
  const timestamp = Date.parse(source)
  return Number.isFinite(timestamp) ? localDateTimeParts(new Date(timestamp).toISOString()).date : source.slice(0, 10)
}

export const monthFromRecord = (record) => {
  const period = String(record?.period || '').trim()
  return /^\d{4}-(?:0[1-9]|1[0-2])$/u.test(period) ? period : dateFromRecord(record).slice(0, 7)
}

const asOccurredAt = (value, fallback) => {
  const occurredAt = value == null || value === '' ? fallback : String(value)
  const match = occurredAt.match(/^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])(?:T|$)/u)
  const calendarDate = match
    ? new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
    : null
  const calendarValid = Boolean(calendarDate
    && calendarDate.getUTCFullYear() === Number(match[1])
    && calendarDate.getUTCMonth() + 1 === Number(match[2])
    && calendarDate.getUTCDate() === Number(match[3]))
  if (!calendarValid
    || !Number.isFinite(Date.parse(occurredAt.length === 10 ? `${occurredAt}T00:00:00+07:00` : occurredAt))) {
    throw new ApiError(400, 'OCCURRED_AT_INVALID', 'Ngày ghi nhận không hợp lệ.')
  }
  return occurredAt
}

const requireStore = (state, storeId) => {
  const normalized = String(storeId || '').trim()
  const store = (Array.isArray(state.stores) ? state.stores : [])
    .find((record) => String(record.id || '') === normalized && !record.deletedAt)
  if (!store) throw new ApiError(400, 'STORE_INVALID', 'Cửa hàng không hợp lệ.')
  return store
}

const requirePayrollUnit = (state, storeId) => {
  const normalized = String(storeId || '').trim()
  if (normalized === OFFICE_STORE_ID && (Array.isArray(state.employees) ? state.employees : []).some((employee) => (
    !employee.deletedAt
    && employeeUnit(employee) === 'office'
  ))) {
    return { id: OFFICE_STORE_ID, name: 'Khối Văn Phòng', unit: 'office' }
  }
  if (normalized === BUSINESS_SUPPORT_STORE_ID && (Array.isArray(state.employees) ? state.employees : []).some((employee) => (
    !employee.deletedAt && employeeUnit(employee) === 'business_support'
  ))) {
    return { id: BUSINESS_SUPPORT_STORE_ID, name: 'Nhân viên hỗ trợ kinh doanh', unit: 'business_support' }
  }
  return requireStore(state, normalized)
}

const payrollPeriodFor = (state, storeId, period) => (Array.isArray(state.payrollPeriods) ? state.payrollPeriods : [])
  .find((record) => String(record.storeId || '') === String(storeId) && String(record.period || '') === period)

const assertAccountingPeriodOpen = (state, storeId, period) => {
  const payroll = payrollPeriodFor(state, storeId, period)
  if (payroll?.status === 'Đã khóa' || payroll?.lockedAt) {
    throw new ApiError(409, 'PAYROLL_PERIOD_LOCKED', 'Kỳ lương liên quan đã khóa; không thể thay đổi số liệu.')
  }
}

const invalidateClosedPayrollPeriods = (state, targets, timestamp, reason) => {
  const targetKeys = new Set((Array.isArray(targets) ? targets : [targets])
    .filter(Boolean)
    .map((target) => `${String(target.storeId || '')}:${String(target.period || '')}`))
  return (Array.isArray(state.payrollPeriods) ? state.payrollPeriods : []).map((payroll) => {
    const key = `${String(payroll.storeId || '')}:${String(payroll.period || '')}`
    if (!targetKeys.has(key)
      || payroll.status !== 'Đã chốt'
      || payroll.confirmedAt
      || payroll.lockedAt) return payroll
    return {
      ...payroll,
      needsReclose: true,
      invalidatedAt: timestamp,
      invalidationReason: reason,
      updatedAt: timestamp,
    }
  })
}

const sourceMatch = (record, sourceType, sourceId) => (
  String(record?.sourceType || '') === sourceType && String(record?.sourceId || '') === String(sourceId)
)

const recordNoopCommand = async (db, actor, response, status, commandContext) => {
  const responseBody = apiPayload(commandContext, response)
  try {
    await run(db, `
      INSERT INTO command_receipts (
        actor_id, idempotency_key, request_hash, response_json, status_code, created_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `, actor.user_id, commandContext.idempotencyKey, commandContext.hash, JSON.stringify(responseBody), status, commandContext.now)
  } catch {
    const receipt = await loadReceipt(db, actor.user_id, commandContext.idempotencyKey)
    const replay = replayReceipt(receipt, commandContext.hash)
    if (replay) return replay
    throw new ApiError(409, 'IDEMPOTENCY_CONFLICT', 'Không thể ghi nhận lệnh lặp lại.')
  }
  return jsonResponse(responseBody, status)
}

const orderBelongsToAttendance = (order, attendance) => {
  if (String(order.attendanceId || '') === String(attendance.id || '')) return true
  if (order.attendanceId || !attendance.employeeId || !attendance.storeId) return false
  const createdAt = Date.parse(order.createdAt)
  const checkInAt = Date.parse(attendance.checkInAt)
  const checkOutAt = Date.parse(attendance.checkOutAt || attendance.updatedAt)
  return belongsToEmployee(order, String(attendance.employeeId))
    && String(order.storeId || '') === String(attendance.storeId)
    && String(order.shiftId || '') === String(attendance.shiftId || attendance.shift || '')
    && Number.isFinite(createdAt)
    && Number.isFinite(checkInAt)
    && Number.isFinite(checkOutAt)
    && createdAt >= checkInAt
    && createdAt <= checkOutAt
}

const orderSalesTotals = (orders, attendance) => {
  const scoped = orders.filter((order) => (
    !order.deletedAt
    && order.status !== 'Đã xóa'
    && orderBelongsToAttendance(order, attendance)
  ))
  const revenue = scoped.reduce((sum, order) => safeMoneySum(sum, Number(order.amount || 0), 'Doanh thu ca'), 0)
  const cash = scoped.filter((order) => order.paymentMethod === 'Tiền mặt')
    .reduce((sum, order) => safeMoneySum(sum, Number(order.amount || 0), 'Tiền mặt trong ca'), 0)
  return { revenue, cash, transfer: revenue - cash, orderCount: scoped.length }
}

const refreshAttendanceSales = (state, orders, changedOrder, timestamp) => {
  const attendance = Array.isArray(state.attendance) ? state.attendance : []
  const target = attendance.find((record) => (
    String(record.id || '') === String(changedOrder.attendanceId || '')
    || orderBelongsToAttendance(changedOrder, record)
  ))
  if (!target) return attendance
  const totals = orderSalesTotals(orders, target)
  return attendance.map((record) => String(record.id || '') === String(target.id)
    ? { ...record, ...totals, updatedAt: timestamp }
    : record)
}

const normalizeTextKey = (value) => String(value || '')
  .trim()
  .toLocaleLowerCase('vi-VN')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/gu, '')
  .replaceAll('đ', 'd')

const nonCancelled = (record) => {
  const status = normalizeTextKey(record?.status)
  return !record?.deletedAt && !['da huy', 'huy', 'cancelled', 'voided'].includes(status)
}

const workedHoursFor = (state, employeeId, period) => (Array.isArray(state.attendance) ? state.attendance : [])
  .filter((record) => (
    !record.deletedAt
    && belongsToEmployee(record, employeeId)
    && monthFromRecord(record) === period
  ))
  .reduce((sum, record) => {
    const hours = Number(record.hours ?? (Number(record.workedSeconds || 0) / 3_600))
    return sum + (Number.isFinite(hours) && hours > 0 ? hours : 0)
  }, 0)

const supportTransferPayFor = (state, employeeId, storeId, period) => {
  const monthStart = `${period}-01`
  const monthEnd = `${period}-31`
  const transfers = (Array.isArray(state.supportTransfers) ? state.supportTransfers : []).filter((record) => (
    String(record.employeeId || '') === String(employeeId || '')
    && String(record.toStoreId || '') === String(storeId || '')
    && !record.deletedAt
    && !['Đã xóa', 'Đã hủy'].includes(String(record.status || ''))
    && String(record.fromDate || '') <= monthEnd
    && String(record.toDate || '') >= monthStart
  ))
  if (!transfers.length) return null
  let hours = 0
  let base = 0
  let allowance = 0
  for (const transfer of transfers) {
    const transferHours = (Array.isArray(state.attendance) ? state.attendance : [])
      .filter((record) => (
        !record.deletedAt
        && belongsToEmployee(record, employeeId)
        && String(record.storeId || '') === String(storeId)
        && monthFromRecord(record) === period
        && dateFromRecord(record) >= String(transfer.fromDate || '')
        && dateFromRecord(record) <= String(transfer.toDate || '')
        && (!record.supportTransferId || String(record.supportTransferId) === String(transfer.id || ''))
      ))
      .reduce((sum, record) => {
        const value = Number(record.hours ?? (Number(record.workedSeconds || 0) / 3_600))
        return sum + (Number.isFinite(value) && value > 0 ? value : 0)
      }, 0)
    hours += transferHours
    base = safeMoneySum(
      base,
      Math.floor(transferHours * Number(transfer.hourlySupportRate || 0)),
      'Lương hỗ trợ điều chuyển',
    )
    allowance = safeMoneySum(allowance, Number(transfer.allowance || 0), 'Phụ cấp điều chuyển')
  }
  return { transfers, hours, base, allowance }
}

const validRequiredWorkingDays = (value) => {
  const days = Number(value)
  return Number.isInteger(days) && days >= 1 && days <= 31 ? days : null
}

const requiredWorkingDaysForEmployee = (employee, period) => (
  validRequiredWorkingDays(isPlainRecord(employee?.monthlyWorkdayTargets)
    ? employee.monthlyWorkdayTargets[period]
    : null)
  || validRequiredWorkingDays(employee?.standardWorkDays)
  || 26
)

const snapshottedRequiredWorkingDaysFor = (state, employee, employeeId, period) => {
  const monthlyTarget = validRequiredWorkingDays(isPlainRecord(employee?.monthlyWorkdayTargets)
    ? employee.monthlyWorkdayTargets[period]
    : null)
  if (monthlyTarget) return monthlyTarget
  const records = (Array.isArray(state.attendance) ? state.attendance : [])
    .filter((record) => (
      !record.deletedAt
      && belongsToEmployee(record, employeeId)
      && monthFromRecord(record) === period
    ))
    .sort((left, right) => dateFromRecord(left).localeCompare(dateFromRecord(right)))
  for (const record of records) {
    const snapshot = validRequiredWorkingDays(
      record.requiredWorkingDaysSnapshot ?? record.standardWorkDaysSnapshot,
    )
    if (snapshot) return snapshot
  }
  return validRequiredWorkingDays(employee?.standardWorkDays) || 26
}

const workedDaysFor = (state, employeeId, period) => {
  const credits = new Map()
  for (const record of Array.isArray(state.attendance) ? state.attendance : []) {
    if (record.deletedAt || !belongsToEmployee(record, employeeId) || monthFromRecord(record) !== period) continue
    const completed = Boolean(record.checkOutAt || record.checkOut || record.checkOutTime)
    if (!completed) continue
    const workedSeconds = Number(record.workedSeconds ?? (Number(record.hours || 0) * 3_600))
    if (!Number.isFinite(workedSeconds) || workedSeconds <= 0) continue
    const date = dateFromRecord(record)
    if (!/^\d{4}-\d{2}-\d{2}$/u.test(date)) continue
    const explicitCredit = Number(record.workdayCredit)
    const credit = Number.isFinite(explicitCredit) ? Math.min(1, Math.max(0, explicitCredit)) : 1
    credits.set(date, Math.max(credits.get(date) || 0, credit))
  }
  return [...credits.values()].reduce((sum, credit) => sum + credit, 0)
}

const recognizedExpensesFor = (state, storeId, period) => {
  const sources = new Set()
  let amount = 0
  for (const entry of Array.isArray(state.expenseEntries) ? state.expenseEntries : []) {
    if (String(entry.storeId || '') !== String(storeId)
      || monthFromRecord(entry) !== period
      || entry.recognized === false
      || entry.deletedAt
      || entry.voidedAt) continue
    const value = Number(entry.amount)
    if (!Number.isSafeInteger(value) || value < 0) continue
    const source = entry.sourceType && entry.sourceId
      ? `${entry.sourceType}:${entry.sourceId}`
      : `id:${entry.id}`
    if (sources.has(source)) continue
    sources.add(source)
    amount = safeMoneySum(amount, value, 'Tổng chi phí trong kỳ')
  }
  return amount
}

const revenueFor = (state, storeId, period) => (Array.isArray(state.orders) ? state.orders : [])
  .filter((order) => (
    String(order.storeId || '') === String(storeId)
    && monthFromRecord(order) === period
    && !order.deletedAt
    && order.status !== 'Đã xóa'
    && Number.isSafeInteger(Number(order.amount))
    && Number(order.amount) >= 0
  ))
  .reduce((sum, order) => safeMoneySum(sum, Number(order.amount), 'Tổng doanh thu trong kỳ'), 0)

const payrollPolicies = async (db) => {
  const [from30000, from15000, from7000] = await Promise.all([
    policyNumber(db, 'employee_kpi_percent_30000', 5),
    policyNumber(db, 'employee_kpi_percent_15000', 3),
    policyNumber(db, 'employee_kpi_percent_7000', 1),
  ])
  return {
    employeeKpiRates: { from30000, from15000, from7000 },
  }
}

const adjustmentKind = (record = {}) => {
  const type = normalizeTextKey(record.type || record.kind || record.adjustmentType)
  if (type.includes('khau tru')) return 'deduction'
  if (type.includes('phu cap')) return 'allowance'
  return 'bonus'
}

const adjustmentAmountFor = (state, employeeId, period) => {
  const current = Array.isArray(state.salaryAdjustments) ? state.salaryAdjustments : []
  const legacy = Array.isArray(state.officeAdjustments) ? state.officeAdjustments : []
  const seenIds = new Set()
  const primarySignatures = new Set()
  const matches = (record) => (
      belongsToEmployee(record, employeeId)
      && nonCancelled(record)
      && (record.period ? String(record.period) === period : monthFromRecord(record) === period)
  )
  const apply = (sum, record, legacyRecord) => {
      const amount = Number(record.amount)
      if (!Number.isSafeInteger(amount) || amount < 0) return sum
      const id = String(record.id || '').trim()
      const kind = adjustmentKind(record)
      const signature = [employeeId, period, kind, amount, normalizeTextKey(record.note || record.content)].join('|')
      if ((id && seenIds.has(id)) || (legacyRecord && primarySignatures.has(signature))) return sum
      if (id) seenIds.add(id)
      if (!legacyRecord) primarySignatures.add(signature)
      return safeMoneySum(sum, kind === 'deduction' ? -amount : amount, 'Tổng điều chỉnh lương')
  }
  let total = current.filter(matches).reduce((sum, record) => apply(sum, record, false), 0)
  total = legacy.filter(matches).reduce((sum, record) => apply(sum, record, true), total)
  return total
}

const paidAdvancesFor = (state, employeeId, period) => (Array.isArray(state.salaryAdvances) ? state.salaryAdvances : [])
  .filter((record) => (
    belongsToEmployee(record, employeeId)
    && String(record.period || '') === period
    && normalizeTextKey(record.status) === 'da chi'
    && !record.deletedAt
  ))
  .reduce((sum, record) => safeMoneySum(
    sum,
    Number.isSafeInteger(Number(record.amount)) ? Number(record.amount) : 0,
    'Tổng ứng lương',
  ), 0)

const calculatePayrollSnapshot = async (db, state, storeId, period) => {
  const payrollUnit = requirePayrollUnit(state, storeId)
  const policies = await payrollPolicies(db)
  const employees = (Array.isArray(state.employees) ? state.employees : []).filter((employee) => (
    String(employee.storeId || '') === String(storeId)
    && employeeUnit(employee) === String(payrollUnit.unit || 'store')
    && !employee.deletedAt
    && normalizeTextKey(employee.status) !== 'da nghi viec'
  ))
  if (String(payrollUnit.unit || 'store') === 'store' && isSecondMallSm234Store(payrollUnit)) {
    const misconfigured = employees.filter((employee) => (
      normalizeTextKey(employee.employmentType) === 'full-time'
      && (!Number.isSafeInteger(Number(employee.baseSalary))
        || Number(employee.baseSalary) < 0
        || Number(employee.baseSalary) > MAX_MONEY_VND
        || !validRequiredMonthlyHours(employee.requiredMonthlyHours)
        || !validRequiredWorkingDays(employee.standardWorkDays))
    )).map((employee) => String(employee.id || employee.code || ''))
    if (misconfigured.length) {
      throw new ApiError(409, 'SM234_PAYROLL_CONFIG_REQUIRED', 'Nhân viên Full-Time SecondMall SM234 thiếu cấu hình lương theo giờ tháng.', {
        employeeIds: misconfigured,
        requiredFields: ['standardWorkDays', 'requiredMonthlyHours', 'baseSalary'],
      })
    }
  }
  const participantIds = new Set()
  const participants = employees.map((employee) => {
    const employeeId = String(employee.id || employee.code || '').trim()
    if (!employeeId) throw new ApiError(409, 'PAYROLL_EMPLOYEE_INVALID', 'Hồ sơ nhân viên thiếu mã định danh.')
    if (participantIds.has(employeeId)) {
      throw new ApiError(409, 'PAYROLL_EMPLOYEE_DUPLICATE', 'Danh sách nhân viên có mã bị trùng.')
    }
    participantIds.add(employeeId)
    return {
      employee,
      hours: workedHoursFor(state, employeeId, period),
      workedDays: workedDaysFor(state, employeeId, period),
      supportPay: null,
    }
  })
  for (const employee of Array.isArray(state.employees) ? state.employees : []) {
    const employeeId = String(employee.id || employee.code || '').trim()
    if (!employeeId || participantIds.has(employeeId) || employeeUnit(employee) !== 'store' || employee.deletedAt) continue
    const supportPay = supportTransferPayFor(state, employeeId, storeId, period)
    if (!supportPay) continue
    participantIds.add(employeeId)
    participants.push({ employee, hours: supportPay.hours, workedDays: 0, supportPay })
  }
  const revenue = revenueFor(state, storeId, period)
  const expense = recognizedExpensesFor(state, storeId, period)
  const profit = revenue - expense
  if (![revenue, expense, profit].every(Number.isSafeInteger)) {
    throw new ApiError(409, 'FINANCE_DATA_INVALID', 'Số liệu tài chính trong kỳ vượt quá giới hạn an toàn.')
  }
  const totalHours = participants.reduce((sum, participant) => sum + participant.hours, 0)
  const profitPerHour = totalHours > 0 ? profit / totalHours : 0
  const ratePercent = profit > 0 && totalHours > 0
    ? (profitPerHour >= 30_000
        ? policies.employeeKpiRates.from30000
        : (profitPerHour >= 15_000
            ? policies.employeeKpiRates.from15000
            : (profitPerHour >= 7_000 ? policies.employeeKpiRates.from7000 : 0)))
    : 0
  const attendanceProratedPayroll = ['office', 'business_support'].includes(String(payrollUnit.unit || ''))
  const rows = participants.map(({ employee, hours, workedDays, supportPay }) => {
    const employeeId = String(employee.id || employee.code || '')
    const payBasis = String(employee.payBasis || employee.salaryBasis || (
      normalizeTextKey(employee.employmentType).includes('part') ? 'hourly' : 'monthly'
    )).toLowerCase()
    const hourlyRate = Number(employee.hourlyRate ?? (payBasis === 'hourly' ? employee.salary : 0) ?? 0)
    const monthlySalary = Number(employee.monthlySalary ?? (payBasis === 'monthly' ? employee.salary : 0) ?? 0)
    const requiredWorkingDays = snapshottedRequiredWorkingDaysFor(
      state,
      employee,
      employeeId,
      period,
    )
    const configuredBaseSalary = Number(employee.baseSalary ?? monthlySalary)
    const monthlyBase = Math.max(0, Number.isSafeInteger(configuredBaseSalary)
      ? configuredBaseSalary
      : Math.trunc(configuredBaseSalary || 0))
    const requiredMonthlyHours = validRequiredMonthlyHours(employee.requiredMonthlyHours)
    const sm234HoursFormula = String(payrollUnit.unit || 'store') === 'store'
      && isSecondMallSm234Store(payrollUnit)
      && normalizeTextKey(employee.employmentType) === 'full-time'
      && Boolean(requiredMonthlyHours)
    const base = supportPay ? supportPay.base : payBasis === 'hourly'
      ? Math.floor(hours * (Number.isFinite(hourlyRate) && hourlyRate > 0 ? hourlyRate : 0))
      : (sm234HoursFormula
          ? Math.floor((hours / requiredMonthlyHours) * monthlyBase)
          : (attendanceProratedPayroll
          ? Math.floor(monthlyBase * Math.min(requiredWorkingDays, Math.max(0, workedDays)) / requiredWorkingDays)
          : monthlyBase))
    const kpiBonus = profit > 0 && totalHours > 0
      ? Math.floor((hours / totalHours) * (ratePercent / 100) * profit)
      : 0
    const allowance = safeMoneySum(
      Number.isSafeInteger(Number(employee.tiktokAllowance)) ? Number(employee.tiktokAllowance) : 0,
      Number(supportPay?.allowance || 0),
      'Tổng phụ cấp nhân viên',
    )
    const adjustment = adjustmentAmountFor(state, employeeId, period)
    if (![base, kpiBonus, allowance, adjustment].every(Number.isSafeInteger)) {
      throw new ApiError(409, 'PAYROLL_DATA_INVALID', `Số liệu lương của ${employeeId} không hợp lệ.`)
    }
    const gross = Math.max(0, base + allowance + adjustment + kpiBonus)
    const advancesPaid = paidAdvancesFor(state, employeeId, period)
    if (!Number.isSafeInteger(gross) || !Number.isSafeInteger(advancesPaid)) {
      throw new ApiError(409, 'PAYROLL_DATA_INVALID', `Tổng lương của ${employeeId} vượt quá giới hạn an toàn.`)
    }
    return {
      employeeId,
      employeeName: employee.name || employee.displayName || employeeId,
      hours,
      workedDays,
      requiredWorkingDays: attendanceProratedPayroll ? requiredWorkingDays : null,
      baseSalary: base,
      gross,
      kpiBonus,
      advancesPaid,
      ...(supportPay ? {
        supportTransferIds: supportPay.transfers.map((record) => record.id),
        supportHourlyPay: supportPay.base,
        supportAllowance: supportPay.allowance,
      } : {}),
      remaining: Math.max(0, gross - advancesPaid),
      salarySnapshot: {
        salary: employee.salary ?? null,
        monthlySalary: employee.monthlySalary ?? null,
        baseSalary: employee.baseSalary ?? null,
        hourlyRate: employee.hourlyRate ?? null,
        requiredMonthlyHours: employee.requiredMonthlyHours ?? null,
        tiktokAllowance: employee.tiktokAllowance ?? 0,
        standardWorkDays: attendanceProratedPayroll ? requiredWorkingDays : (employee.standardWorkDays ?? null),
        proratedByWorkedDays: attendanceProratedPayroll && payBasis === 'monthly',
        payFormula: sm234HoursFormula ? 'monthly-hours' : (employee.payFormula ?? null),
        proratedByActualHours: sm234HoursFormula,
      },
    }
  })
  return {
    rows,
    financeSnapshot: { revenue, expense, profit },
    kpiSnapshot: {
      eligible: profit > 0 && totalHours > 0,
      profit,
      totalHours,
      profitPerHour,
      employeeTier: ratePercent ? { ratePercent } : null,
      results: rows.map((row) => ({
        id: row.employeeId,
        role: 'employee',
        hours: row.hours,
        ratePercent,
        amount: row.kpiBonus,
      })),
      totalBonus: rows.reduce((sum, row) => sum + row.kpiBonus, 0),
    },
    policySnapshot: policies,
  }
}

const vietnamBusinessTimestamp = (date, time) => {
  const timestamp = new Date(`${date}T${time}:00+07:00`)
  if (!Number.isFinite(timestamp.getTime())) {
    throw new ApiError(400, 'ATTENDANCE_TIME_INVALID', 'Ngày giờ chấm công không hợp lệ.')
  }
  return timestamp.toISOString()
}

const attendanceUpdateCommand = async (db, actor, body, commandContext) => {
  if (!['admin', 'business_support'].includes(actor.role)) {
    throw new ApiError(403, 'ROLE_FORBIDDEN', 'Chỉ Admin hoặc Nhân viên hỗ trợ KD được chỉnh sửa thời gian chấm công.')
  }
  if (body.type !== 'attendance.update') {
    throw new ApiError(400, 'COMMAND_UNKNOWN', 'Lệnh chỉnh sửa chấm công không được hỗ trợ.')
  }
  const payload = isPlainRecord(body.payload) ? body.payload : {}
  if (['employeeId', 'storeId', 'shiftId', 'shift'].some((field) => payload[field] !== undefined)) {
    throw new ApiError(400, 'ATTENDANCE_SCOPE_IMMUTABLE', 'Không được thay đổi nhân viên, cửa hàng hoặc ca liên kết của chấm công.')
  }
  const reason = String(payload.reason || '').trim()
  if (!reason || reason.length > 500) {
    throw new ApiError(400, 'REASON_REQUIRED', 'Cần nhập lý do chỉnh sửa từ 1 đến 500 ký tự.')
  }
  const attendanceId = String(payload.attendanceId || payload.id || '').trim()
  if (!attendanceId) throw new ApiError(400, 'ATTENDANCE_ID_REQUIRED', 'Cần chọn bản ghi chấm công.')
  const { current, state } = await loadGlobalCommandState(db, body)
  const attendance = Array.isArray(state.attendance) ? state.attendance : []
  const previous = attendance.find((record) => String(record.id || '') === attendanceId && !record.deletedAt)
  if (!previous) throw new ApiError(404, 'ATTENDANCE_NOT_FOUND', 'Không tìm thấy bản ghi chấm công.')
  const storeId = String(previous.storeId || '').trim()
  const employeeId = employeeReference(previous)
  if (!storeId || !employeeId) {
    throw new ApiError(409, 'ATTENDANCE_SCOPE_INVALID', 'Bản ghi chấm công thiếu liên kết nhân viên hoặc cửa hàng.')
  }
  const linkedEmployee = [
    ...(Array.isArray(state.employees) ? state.employees : []),
    ...(Array.isArray(state.deletedEmployees) ? state.deletedEmployees : []),
  ].find((employee) => [employee.id, employee.code, employee.employeeId].map(String).includes(employeeId))
  if (actor.role === 'business_support') {
    assertOperationalStoreAccess(actor, storeId)
    if (!linkedEmployee
      || employeeUnit(linkedEmployee) !== 'store'
      || String(linkedEmployee.storeId || '') !== storeId) {
      throw new ApiError(403, 'ATTENDANCE_STORE_EMPLOYEE_ONLY', 'Nhân viên hỗ trợ KD chỉ được chỉnh chấm công của nhân viên cửa hàng.')
    }
  }

  const date = optionalCalendarDate(payload.date ?? payload.workDate ?? dateFromRecord(previous), 'Ngày chấm công')
  const checkIn = parseShiftTime(payload.checkIn ?? payload.checkInTime ?? previous.checkIn ?? previous.checkInTime)
  if (!checkIn) throw new ApiError(400, 'ATTENDANCE_TIME_INVALID', 'Giờ vào phải theo định dạng 24 giờ HH:mm.')
  const previousCheckOut = previous.checkOut ?? previous.checkOutTime
    ?? (previous.checkOutAt ? localDateTimeParts(previous.checkOutAt).time : '')
  const requestedCheckOut = payload.checkOut !== undefined ? payload.checkOut : payload.checkOutTime
  if (requestedCheckOut !== undefined && !String(requestedCheckOut || '').trim() && previous.checkOutAt) {
    throw new ApiError(400, 'ATTENDANCE_CHECK_OUT_REQUIRED', 'Không thể xóa giờ ra của ca đã kết thúc.')
  }
  const checkOut = parseShiftTime(requestedCheckOut === undefined ? previousCheckOut : requestedCheckOut)
  if ((requestedCheckOut === undefined ? previousCheckOut : requestedCheckOut) && !checkOut) {
    throw new ApiError(400, 'ATTENDANCE_TIME_INVALID', 'Giờ ra phải theo định dạng 24 giờ HH:mm.')
  }
  if (checkOut && checkOut.minuteOfDay <= checkIn.minuteOfDay) {
    throw new ApiError(400, 'ATTENDANCE_TIME_ORDER_INVALID', 'Giờ ra phải sau giờ vào trong cùng ngày làm việc.')
  }

  const previousPeriod = monthFromRecord(previous)
  const nextPeriod = date.slice(0, 7)
  const payrollTargets = [...new Map([
    { storeId, period: previousPeriod },
    { storeId, period: nextPeriod },
  ].map((target) => [`${target.storeId}:${target.period}`, target])).values()]
  for (const target of payrollTargets) assertPayrollNotPaidOrLocked(state, target.storeId, target.period)

  const checkInAt = vietnamBusinessTimestamp(date, checkIn.label)
  const checkOutAt = checkOut ? vietnamBusinessTimestamp(date, checkOut.label) : null
  const workedSeconds = checkOut ? Math.floor((Date.parse(checkOutAt) - Date.parse(checkInAt)) / 1000) : 0
  if (!Number.isSafeInteger(workedSeconds) || workedSeconds < 0 || workedSeconds >= 24 * 60 * 60) {
    throw new ApiError(400, 'ATTENDANCE_DURATION_INVALID', 'Thời lượng chấm công phải lớn hơn 0 và nhỏ hơn 24 giờ.')
  }
  const linkedShift = (Array.isArray(state.shiftDefinitions) ? state.shiftDefinitions : [])
    .find((shift) => String(shift.id || '') === String(previous.shiftId || previous.shift || ''))
  const shiftStart = parseShiftTime(previous.shiftStart) || shiftTimes(linkedShift).start
  const shiftEnd = parseShiftTime(previous.shiftEnd) || shiftTimes(linkedShift).end
  if (!shiftStart) throw new ApiError(409, 'ATTENDANCE_SHIFT_INVALID', 'Bản ghi chấm công thiếu giờ bắt đầu ca.')
  const minutesFromStart = checkIn.minuteOfDay - shiftStart.minuteOfDay
  const lateTolerance = Math.trunc(await policyNumber(db, 'late_tolerance_minutes', 10))
  const officeAttendance = officeLikeEmployee(previous) || previous.attendanceMode === 'office'
  const requiredWorkingDays = validRequiredWorkingDays(previous.requiredWorkingDaysSnapshot)
    || validRequiredWorkingDays(previous.standardWorkDaysSnapshot)
    || requiredWorkingDaysForEmployee(linkedEmployee, date.slice(0, 7))
  const arrivalTag = minutesFromStart < 0
    ? 'Đi sớm'
    : (minutesFromStart <= lateTolerance ? 'Đi đúng giờ' : 'Đi trễ')
  const departureTag = !checkOut
    ? 'Chưa ra về'
    : (shiftEnd && checkOut.minuteOfDay < shiftEnd.minuteOfDay ? 'Về sớm' : 'Đã ra về')
  const next = {
    ...previous,
    date,
    workDate: date,
    attendanceDate: date,
    checkIn: checkIn.label,
    checkInTime: checkIn.label,
    checkInAt,
    checkOut: checkOut?.label || null,
    checkOutTime: checkOut?.label || null,
    checkOutAt,
    arrivalTag,
    departureTag,
    punctuality: arrivalTag,
    status: arrivalTag,
    minutesEarly: Math.max(0, -minutesFromStart),
    minutesLate: Math.max(0, minutesFromStart),
    ...(officeAttendance ? {
      attendanceMode: 'office',
      requiredWorkingDaysSnapshot: requiredWorkingDays,
      standardWorkDaysSnapshot: requiredWorkingDays,
      workdayCredit: checkOut ? 1 : 0,
    } : {}),
    workedSeconds,
    workedMinutes: workedSeconds / 60,
    hours: workedSeconds / 3_600,
    editedAt: commandContext.now,
    editedBy: serverActorSnapshot(actor),
    editReason: reason,
    updatedAt: commandContext.now,
    updatedBy: serverActorSnapshot(actor),
  }
  const changedFields = [
    'date', 'checkIn', 'checkInAt', 'checkOut', 'checkOutAt', 'arrivalTag',
    'departureTag', 'minutesEarly', 'minutesLate', 'workdayCredit', 'workedSeconds', 'hours',
  ].filter((field) => JSON.stringify(next[field]) !== JSON.stringify(previous[field]))
  const auditRecord = {
    id: `ata_${crypto.randomUUID()}`,
    action: 'Sửa',
    attendanceId,
    storeId,
    employeeId,
    before: previous,
    after: next,
    changedFields,
    reason,
    actor: serverActorSnapshot(actor),
    createdAt: commandContext.now,
  }
  const nextState = {
    ...state,
    attendance: attendance.map((record) => String(record.id || '') === attendanceId ? next : record),
    attendanceAudit: [auditRecord, ...(Array.isArray(state.attendanceAudit) ? state.attendanceAudit : [])],
    auditLogs: [auditRecord, ...(Array.isArray(state.auditLogs) ? state.auditLogs : [])],
    payrollPeriods: invalidateClosedPayrollPeriods(state, payrollTargets, commandContext.now, body.type),
    stateVersion: Math.max(1, Number(state.stateVersion) || 1) + 1,
  }
  return commitGlobalStateDomainCommand(db, actor, current, nextState, {
    action: body.type,
    entityType: 'attendance',
    entityId: attendanceId,
    before: previous,
    after: next,
    metadata: { reason, changedFields, storeId, employeeId, payrollTargets },
    response: { command: body.type, attendance: next, audit: auditRecord },
  }, commandContext)
}

const normalizedOperationalResetType = (value) => {
  const normalized = normalizeTextKey(value).replace(/\s+/gu, '_')
  if (['order', 'orders', 'don_hang'].includes(normalized)) return 'orders'
  if (['attendance', 'attendances', 'cham_cong'].includes(normalized)) return 'attendance'
  return ''
}

const recordEmployeeId = (record) => String(record?.employeeId || record?.employeeCode || '').trim()

const ORDER_OPERATIONAL_MUTABLE_FIELDS = Object.freeze([
  'customerName', 'customerPhone', 'customerAge', 'amount', 'paymentMethod',
  'status', 'deletedAt', 'deletedBy', 'deleteReason',
])

const ATTENDANCE_CORRECTION_FIELDS = Object.freeze([
  'date', 'workDate', 'attendanceDate', 'checkIn', 'checkInTime', 'checkInAt',
  'checkOut', 'checkOutTime', 'checkOutAt', 'arrivalTag', 'departureTag',
  'punctuality', 'status', 'minutesEarly', 'minutesLate', 'workedSeconds',
  'workedMinutes', 'hours', 'workdayCredit', 'attendanceMode',
  'requiredWorkingDaysSnapshot', 'standardWorkDaysSnapshot',
  'editedAt', 'editedBy', 'editReason',
])

const restoreAuditedFields = (current, baseline, fields) => {
  const restored = { ...current }
  for (const field of fields) {
    if (Object.hasOwn(baseline, field)) restored[field] = baseline[field]
    else delete restored[field]
  }
  return restored
}

const operationalAuditFingerprint = (record, dataType) => {
  const keys = dataType === 'orders'
    ? [
        'id', 'code', 'storeId', 'employeeId', 'attendanceId', 'customerName',
        'customerPhone', 'customerAge', 'amount', 'paymentMethod', 'status',
        'deletedAt', 'createdAt',
      ]
    : ['id', 'storeId', 'employeeId', 'shiftId', 'shift', ...ATTENDANCE_CORRECTION_FIELDS]
  return JSON.stringify(Object.fromEntries(keys.map((key) => [key, record?.[key] ?? null])))
}

const recordWithinOperationalResetScope = (record, scope) => {
  if (!isPlainRecord(record) || String(record.storeId || '') !== scope.storeId) return false
  const date = dateFromRecord(record)
  if (!date || date < scope.fromDate || date > scope.toDate) return false
  return !scope.employeeId || recordEmployeeId(record) === scope.employeeId
}

const latestRestorableAuditByEntity = (history, options) => {
  const latest = new Map()
  for (const audit of Array.isArray(history) ? history : []) {
    if (!isPlainRecord(audit) || audit.restoredAt || !isPlainRecord(audit.before)) continue
    if (!options.actions.has(String(audit.action || ''))) continue
    if (!String(audit.id || '').trim()) continue
    const entityId = String(audit[options.entityKey] || audit.before.id || '').trim()
    const scopedRecord = isPlainRecord(audit.after) ? audit.after : audit.before
    if (!entityId || !recordWithinOperationalResetScope(scopedRecord, options.scope)) continue
    const current = latest.get(entityId)
    const timestamp = Date.parse(audit.createdAt || '')
    const currentTimestamp = Date.parse(current?.createdAt || '')
    if (!current || (Number.isFinite(timestamp) && (!Number.isFinite(currentTimestamp) || timestamp > currentTimestamp))) {
      latest.set(entityId, audit)
    }
  }
  return latest
}

const attendanceAuditSignature = (audit) => {
  if (!isPlainRecord(audit?.before) || !isPlainRecord(audit?.after)) return ''
  return JSON.stringify([
    String(audit.attendanceId || audit.before.id || ''),
    String(audit.createdAt || ''),
    operationalAuditFingerprint(audit.before, 'attendance'),
    operationalAuditFingerprint(audit.after, 'attendance'),
  ])
}

const legacyAttendanceAuditsForScope = async (db, stateAudits, scope) => {
  const rows = await all(db, `
    SELECT
      id, request_id, actor_id, actor_role, entity_id,
      before_json, after_json, metadata_json, server_timestamp
    FROM audit_log
    WHERE action = 'attendance.update' AND entity_type = 'attendance'
      AND json_extract(after_json, '$.storeId') = ?
      AND COALESCE(
        json_extract(after_json, '$.workDate'),
        json_extract(after_json, '$.attendanceDate'),
        json_extract(after_json, '$.date'),
        substr(json_extract(after_json, '$.createdAt'), 1, 10),
        ''
      ) BETWEEN ? AND ?
      AND (? = '' OR COALESCE(
        json_extract(after_json, '$.employeeId'),
        json_extract(after_json, '$.employeeCode'),
        ''
      ) = ?)
    ORDER BY id DESC
    LIMIT ?
  `, scope.storeId, scope.fromDate, scope.toDate, scope.employeeId, scope.employeeId, MAX_LEGACY_ATTENDANCE_AUDITS)
  const represented = new Set((Array.isArray(stateAudits) ? stateAudits : [])
    .map(attendanceAuditSignature).filter(Boolean))
  const legacy = []
  for (const row of rows) {
    const auditLogId = Number(row.id)
    if (!Number.isSafeInteger(auditLogId) || auditLogId <= 0) continue
    let before
    let after
    let metadata
    try {
      before = sanitizeStateValue(parseStoredJson(row.before_json))
      after = sanitizeStateValue(parseStoredJson(row.after_json))
      metadata = sanitizeStateValue(parseStoredJson(row.metadata_json, {}))
    } catch {
      continue
    }
    if (!isPlainRecord(before) || !isPlainRecord(after)
      || before.truncated === true || after.truncated === true) continue
    const attendanceId = String(row.entity_id || before.id || '').trim()
    if (!attendanceId
      || String(before.id || '') !== attendanceId
      || String(after.id || '') !== attendanceId
      || String(before.storeId || '') !== String(after.storeId || '')
      || employeeReference(before) !== employeeReference(after)
      || !recordWithinOperationalResetScope(after, scope)) continue
    const audit = {
      id: `ata_legacy_${auditLogId}`,
      action: 'Sửa',
      attendanceId,
      storeId: String(metadata.storeId || after.storeId || ''),
      employeeId: String(metadata.employeeId || employeeReference(after) || ''),
      before,
      after,
      changedFields: Array.isArray(metadata.changedFields)
        ? metadata.changedFields.map(String).slice(0, 100)
        : [],
      reason: String(metadata.reason || '').slice(0, 500),
      actor: {
        id: row.actor_id ? String(row.actor_id) : null,
        name: 'Nhật ký hệ thống',
        role: VALID_ROLES.has(String(row.actor_role || '')) ? String(row.actor_role) : 'admin',
      },
      createdAt: String(row.server_timestamp || ''),
      legacyAuditLogId: auditLogId,
      legacyRequestId: String(row.request_id || ''),
      source: 'd1-audit-log',
    }
    const signature = attendanceAuditSignature(audit)
    if (!signature || represented.has(signature)) continue
    represented.add(signature)
    legacy.push(audit)
  }
  return legacy
}

const operationalResetCommand = async (db, actor, body, commandContext) => {
  if (actor.role !== 'business_support') {
    throw new ApiError(403, 'ROLE_FORBIDDEN', 'Chỉ Nhân viên hỗ trợ KD được khôi phục chỉnh sửa dữ liệu vận hành.')
  }
  if (body.type !== 'operational_reset.restore') {
    throw new ApiError(400, 'COMMAND_UNKNOWN', 'Lệnh khôi phục dữ liệu vận hành không được hỗ trợ.')
  }
  const payload = isPlainRecord(body.payload) ? body.payload : {}
  const dataType = normalizedOperationalResetType(payload.dataType ?? payload.type)
  if (!dataType) {
    throw new ApiError(400, 'OPERATIONAL_RESET_TYPE_INVALID', 'Chỉ có thể khôi phục chỉnh sửa đơn hàng hoặc chấm công.')
  }
  const reason = String(payload.reason || '').trim()
  if (!reason || reason.length > 500) {
    throw new ApiError(400, 'REASON_REQUIRED', 'Cần nhập lý do khôi phục từ 1 đến 500 ký tự.')
  }
  const { current, state } = await loadGlobalCommandState(db, body)
  const storeId = String(payload.storeId || '').trim()
  assertOperationalStoreAccess(actor, storeId)
  requireStore(state, storeId)
  const fromDate = optionalCalendarDate(payload.fromDate ?? payload.startDate ?? payload.date, 'Từ ngày')
  const toDate = optionalCalendarDate(payload.toDate ?? payload.endDate ?? payload.date, 'Đến ngày')
  if (!fromDate || !toDate) {
    throw new ApiError(400, 'OPERATIONAL_RESET_DATE_REQUIRED', 'Cần chọn khoảng ngày khôi phục.')
  }
  monthsInDateRange(fromDate, toDate)
  const employeeId = String(payload.employeeId || '').trim()
  if (employeeId) {
    const employee = [
      ...(Array.isArray(state.employees) ? state.employees : []),
      ...(Array.isArray(state.deletedEmployees) ? state.deletedEmployees : []),
    ].find((record) => [record.id, record.code, record.employeeId].map(String).includes(employeeId))
    if (!employee || employeeUnit(employee) !== 'store' || String(employee.storeId || '') !== storeId) {
      throw new ApiError(400, 'OPERATIONAL_RESET_EMPLOYEE_INVALID', 'Nhân viên không thuộc cửa hàng đã chọn.')
    }
  }
  const scope = { storeId, fromDate, toDate, employeeId }
  const resetId = `opr_${crypto.randomUUID()}`
  const actorSnapshot = serverActorSnapshot(actor)
  let beforeRecords = []
  let restoredRecords = []
  let sourceAuditIds = []
  let nextState

  if (dataType === 'orders') {
    const orders = Array.isArray(state.orders) ? state.orders : []
    const orderAudit = Array.isArray(state.orderAudit) ? state.orderAudit : []
    const latestAudits = latestRestorableAuditByEntity(orderAudit, {
      actions: new Set(['Sửa', 'Xóa']), entityKey: 'orderId', scope,
    })
    const restorationById = new Map()
    for (const [orderId, audit] of latestAudits) {
      const currentOrder = orders.find((record) => String(record.id || '') === orderId)
      if (!currentOrder) continue
      if (operationalAuditFingerprint(currentOrder, dataType) !== operationalAuditFingerprint(audit.after, dataType)) {
        throw new ApiError(409, 'OPERATIONAL_RESET_STALE_AUDIT', 'Đơn hàng đã thay đổi sau bản chỉnh sửa gần nhất; hãy tải lại dữ liệu trước khi khôi phục.', { entityId: orderId })
      }
      const baseline = audit.before
      const restored = {
        ...restoreAuditedFields(currentOrder, baseline, ORDER_OPERATIONAL_MUTABLE_FIELDS),
        restoredAt: commandContext.now,
        restoredBy: actorSnapshot,
        restoreReason: reason,
        updatedAt: commandContext.now,
        updatedBy: actorSnapshot,
      }
      beforeRecords.push(currentOrder)
      restoredRecords.push(restored)
      sourceAuditIds.push(String(audit.id || ''))
      restorationById.set(orderId, { restored, audit })
    }
    if (!restorationById.size) {
      return recordNoopCommand(db, actor, {
        command: body.type,
        version: Number(current.version),
        reset: { id: null, dataType, scope, restoredCount: 0, restoredIds: [] },
        restoredCount: 0,
        restoredIds: [],
        restored: [],
        existing: true,
      }, 200, commandContext)
    }
    const payrollTargets = [...new Map(restoredRecords.flatMap((restored, index) => [
      { storeId: String(restored.storeId || ''), period: monthFromRecord(restored) },
      { storeId: String(beforeRecords[index].storeId || ''), period: monthFromRecord(beforeRecords[index]) },
    ]).map((target) => [`${target.storeId}:${target.period}`, target])).values()]
    for (const target of payrollTargets) assertPayrollNotPaidOrLocked(state, target.storeId, target.period)
    const nextOrders = orders.map((record) => restorationById.get(String(record.id || ''))?.restored || record)
    const affectedAttendanceIds = new Set()
    for (const [orderId, { restored }] of restorationById) {
      const currentOrder = orders.find((record) => String(record.id || '') === orderId)
      for (const order of [currentOrder, restored]) {
        if (order?.attendanceId) affectedAttendanceIds.add(String(order.attendanceId))
      }
      for (const attendance of Array.isArray(state.attendance) ? state.attendance : []) {
        if (orderBelongsToAttendance(currentOrder, attendance) || orderBelongsToAttendance(restored, attendance)) {
          affectedAttendanceIds.add(String(attendance.id || ''))
        }
      }
    }
    const nextAttendance = (Array.isArray(state.attendance) ? state.attendance : []).map((attendance) => (
      affectedAttendanceIds.has(String(attendance.id || ''))
        ? { ...attendance, ...orderSalesTotals(nextOrders, attendance), updatedAt: commandContext.now }
        : attendance
    ))
    const restoredAudit = orderAudit.map((audit) => (
      sourceAuditIds.includes(String(audit.id || ''))
        ? { ...audit, restoredAt: commandContext.now, restoredBy: actorSnapshot, resetId }
        : audit
    ))
    const resetAuditRecords = restoredRecords.map((restored, index) => {
      const before = beforeRecords[index]
      const changedFields = [
        ...ORDER_OPERATIONAL_MUTABLE_FIELDS,
      ].filter((field) => JSON.stringify(before[field]) !== JSON.stringify(restored[field]))
      return {
        id: `oda_${crypto.randomUUID()}`,
        action: 'Khôi phục',
        orderId: restored.id,
        orderCode: restored.code,
        storeId,
        before,
        after: restored,
        changedFields,
        revenueBefore: before.deletedAt || before.status === 'Đã xóa' ? 0 : Number(before.amount || 0),
        revenueAfter: restored.deletedAt || restored.status === 'Đã xóa' ? 0 : Number(restored.amount || 0),
        reason,
        actor: actorSnapshot,
        resetId,
        sourceAuditId: sourceAuditIds[index],
        createdAt: commandContext.now,
      }
    })
    const historyRecord = {
      id: resetId, dataType, ...scope, reason, restoredCount: restoredRecords.length,
      restoredIds: restoredRecords.map((record) => record.id), sourceAuditIds,
      createdAt: commandContext.now, createdBy: actorSnapshot,
    }
    nextState = {
      ...state,
      orders: nextOrders,
      attendance: nextAttendance,
      orderAudit: [...resetAuditRecords, ...restoredAudit],
      auditLogs: [...resetAuditRecords, ...(Array.isArray(state.auditLogs) ? state.auditLogs : [])],
      operationalResetHistory: [historyRecord, ...(Array.isArray(state.operationalResetHistory) ? state.operationalResetHistory : [])],
      payrollPeriods: invalidateClosedPayrollPeriods(state, payrollTargets, commandContext.now, body.type),
      stateVersion: Math.max(1, Number(state.stateVersion) || 1) + 1,
    }
  } else {
    const attendance = Array.isArray(state.attendance) ? state.attendance : []
    const stateAttendanceAudit = Array.isArray(state.attendanceAudit) ? state.attendanceAudit : []
    const attendanceAudit = [
      ...stateAttendanceAudit,
      ...await legacyAttendanceAuditsForScope(db, stateAttendanceAudit, scope),
    ]
    const latestAudits = latestRestorableAuditByEntity(attendanceAudit, {
      actions: new Set(['Sửa']), entityKey: 'attendanceId', scope,
    })
    const restorationById = new Map()
    for (const [attendanceId, audit] of latestAudits) {
      const currentAttendance = attendance.find((record) => String(record.id || '') === attendanceId && !record.deletedAt)
      if (!currentAttendance) continue
      if (operationalAuditFingerprint(currentAttendance, dataType) !== operationalAuditFingerprint(audit.after, dataType)) {
        throw new ApiError(409, 'OPERATIONAL_RESET_STALE_AUDIT', 'Chấm công đã thay đổi sau bản chỉnh sửa gần nhất; hãy tải lại dữ liệu trước khi khôi phục.', { entityId: attendanceId })
      }
      const restored = {
        ...restoreAuditedFields(currentAttendance, audit.before, ATTENDANCE_CORRECTION_FIELDS),
        restoredAt: commandContext.now,
        restoredBy: actorSnapshot,
        restoreReason: reason,
        updatedAt: commandContext.now,
        updatedBy: actorSnapshot,
      }
      beforeRecords.push(currentAttendance)
      restoredRecords.push(restored)
      sourceAuditIds.push(String(audit.id || ''))
      restorationById.set(attendanceId, { restored, audit })
    }
    if (!restorationById.size) {
      return recordNoopCommand(db, actor, {
        command: body.type,
        version: Number(current.version),
        reset: { id: null, dataType, scope, restoredCount: 0, restoredIds: [] },
        restoredCount: 0,
        restoredIds: [],
        restored: [],
        existing: true,
      }, 200, commandContext)
    }
    const payrollTargets = [...new Map(restoredRecords.flatMap((restored, index) => [
      { storeId: String(restored.storeId || ''), period: monthFromRecord(restored) },
      { storeId: String(beforeRecords[index].storeId || ''), period: monthFromRecord(beforeRecords[index]) },
    ]).map((target) => [`${target.storeId}:${target.period}`, target])).values()]
    for (const target of payrollTargets) assertPayrollNotPaidOrLocked(state, target.storeId, target.period)
    const restoredAudit = attendanceAudit.map((audit) => (
      sourceAuditIds.includes(String(audit.id || ''))
        ? { ...audit, restoredAt: commandContext.now, restoredBy: actorSnapshot, resetId }
        : audit
    ))
    const resetAuditRecords = restoredRecords.map((restored, index) => {
      const before = beforeRecords[index]
      const changedFields = ATTENDANCE_CORRECTION_FIELDS
        .filter((field) => JSON.stringify(before[field]) !== JSON.stringify(restored[field]))
      return {
        id: `ata_${crypto.randomUUID()}`,
        action: 'Khôi phục',
        attendanceId: restored.id,
        storeId,
        employeeId: recordEmployeeId(restored),
        before,
        after: restored,
        changedFields,
        reason,
        actor: actorSnapshot,
        resetId,
        sourceAuditId: sourceAuditIds[index],
        createdAt: commandContext.now,
      }
    })
    const historyRecord = {
      id: resetId, dataType, ...scope, reason, restoredCount: restoredRecords.length,
      restoredIds: restoredRecords.map((record) => record.id), sourceAuditIds,
      createdAt: commandContext.now, createdBy: actorSnapshot,
    }
    nextState = {
      ...state,
      attendance: attendance.map((record) => restorationById.get(String(record.id || ''))?.restored || record),
      attendanceAudit: [...resetAuditRecords, ...restoredAudit],
      auditLogs: [...resetAuditRecords, ...(Array.isArray(state.auditLogs) ? state.auditLogs : [])],
      operationalResetHistory: [historyRecord, ...(Array.isArray(state.operationalResetHistory) ? state.operationalResetHistory : [])],
      payrollPeriods: invalidateClosedPayrollPeriods(state, payrollTargets, commandContext.now, body.type),
      stateVersion: Math.max(1, Number(state.stateVersion) || 1) + 1,
    }
  }

  const reset = nextState.operationalResetHistory[0]
  return commitGlobalStateDomainCommand(db, actor, current, nextState, {
    action: body.type,
    entityType: 'operational-reset',
    entityId: resetId,
    before: beforeRecords,
    after: restoredRecords,
    metadata: { dataType, scope, reason, sourceAuditIds, restoredCount: restoredRecords.length },
    response: {
      command: body.type,
      reset,
      restoredCount: restoredRecords.length,
      restoredIds: restoredRecords.map((record) => record.id),
      restored: restoredRecords,
    },
  }, commandContext)
}

const attendanceCommand = async (db, actor, body, commandContext) => {
  if (!['employee', 'business_support', 'store_manager'].includes(actor.role)) {
    throw new ApiError(403, 'ROLE_FORBIDDEN', 'Lệnh chấm công trực tiếp chỉ dành cho tài khoản nhân sự.')
  }
  const expectedVersion = validateExpectedVersion(body.expectedVersion)
  const current = await loadState(db, 'global')
  const currentVersion = Number(current?.version || 0)
  if (!current || currentVersion !== expectedVersion) {
    throw new ApiError(409, 'VERSION_CONFLICT', 'Dữ liệu đã thay đổi trên máy chủ.', { currentVersion })
  }
  const state = normalizeSharedStateForStorage(parseStoredJson(current.value_json, {}))
  const payload = isPlainRecord(body.payload) ? body.payload : {}
  const employeeId = String(actor.employee_id || actor.user_id || '')
  const storeId = String(actor.store_id || '')
  const employee = (Array.isArray(state.employees) ? state.employees : [])
    .find((record) => String(record.id || record.code || '') === employeeId && !record.deletedAt)
  const activeTransfer = actor.active_transfer_id
    ? (Array.isArray(state.supportTransfers) ? state.supportTransfers : []).find((record) => (
        String(record.id || '') === String(actor.active_transfer_id)
        && String(record.employeeId || '') === employeeId
        && String(record.toStoreId || '') === storeId
        && !record.deletedAt
        && !['Đã xóa', 'Đã hủy', 'Hoàn tất'].includes(String(record.status || ''))
      ))
    : null
  if (!employee || (String(employee.storeId || '') !== storeId && !activeTransfer)) {
    throw new ApiError(409, 'EMPLOYEE_PROFILE_MISSING', 'Tài khoản chưa được liên kết với hồ sơ nhân viên hợp lệ.')
  }
  const officeEmployee = officeLikeEmployee(employee)
  const location = normalizeLocation(payload.location, commandContext.now)
  const attendance = Array.isArray(state.attendance) ? state.attendance : []
  const ownOpenRecords = attendance.filter((record) => (
    belongsToEmployee(record, employeeId)
    && !record.deletedAt
    && !record.checkOut
    && !record.checkOutAt
  ))
  const localNow = localDateTimeParts(commandContext.now)

  if (body.type === 'attendance.check_in') {
    if (ownOpenRecords.length) {
      throw new ApiError(409, 'ATTENDANCE_ALREADY_OPEN', 'Bạn đã có một ca làm việc đang mở.', {
        attendanceId: ownOpenRecords[0].id,
      })
    }
    const dayAssignments = (Array.isArray(state.schedule) ? state.schedule : []).filter((record) => (
      belongsToEmployee(record, employeeId)
      && String(record.date || record.workDate || '') === localNow.date
      && !record.deletedAt
    ))
    const assignedShiftIds = new Set(dayAssignments.flatMap((record) => [
      String(record.shiftId || ''),
      ...(Array.isArray(record.shiftIds) ? record.shiftIds.map(String) : []),
    ]).filter(Boolean))
    const activeShifts = (Array.isArray(state.shiftDefinitions) ? state.shiftDefinitions : []).filter((record) => (
      record.active !== false
      && (!record.storeId || String(record.storeId) === storeId)
      && (!record.date || String(record.date) === localNow.date)
      && shiftTimes(record).start
      && shiftTimes(record).end
    ))
    const profileShifts = officeEmployee ? configuredProfileWorkShifts(employee) : []
    let shiftId = String(payload.shiftId || payload.workShiftId || '').trim()
    let shift = shiftId ? activeShifts.find((record) => String(record.id || '') === shiftId) : null
    if (shiftId && !/^[A-Za-z0-9_-]{1,80}$/u.test(shiftId)) {
      throw new ApiError(400, 'SHIFT_INVALID', 'Cần chọn ca làm việc hợp lệ.')
    }
    if (!shift && officeEmployee && shiftId) {
      shift = profileShifts.find((record) => String(record.id || '') === shiftId) || null
    }
    if (shift && shift.source !== 'profile-work-shift' && shift.source !== 'office-profile'
      && dayAssignments.length && !assignedShiftIds.has(shiftId)) {
      throw new ApiError(403, 'SHIFT_NOT_ASSIGNED', 'Ca này không nằm trong lịch làm việc hôm nay của bạn.')
    }
    if (activeTransfer && (!shift || !assignedShiftIds.has(shiftId))) {
      const supportStore = (Array.isArray(state.stores) ? state.stores : [])
        .find((record) => String(record.id || '') === storeId)
      const configuredStart = parseShiftTime(
        supportStore?.openingTime || supportStore?.opening || supportStore?.openTime,
      )
      const configuredEnd = parseShiftTime(
        supportStore?.closingTime || supportStore?.closing || supportStore?.closeTime,
      )
      const safeEnd = configuredEnd && configuredEnd.minuteOfDay > localNow.minuteOfDay
        ? configuredEnd
        : parseShiftTime('23:59')
      shiftId = `SUPPORT_TRANSFER_${activeTransfer.id}`.replace(/[^A-Za-z0-9_-]/gu, '_').slice(0, 80)
      shift = {
        id: shiftId,
        name: 'Ca hỗ trợ cửa hàng',
        storeId,
        start: configuredStart && configuredStart.minuteOfDay <= localNow.minuteOfDay
          ? configuredStart.label
          : localNow.time,
        end: safeEnd.label,
        version: 1,
        source: 'support-transfer',
      }
    }
    if (!shift && officeEmployee && !shiftId) {
      shift = activeShifts.find((record) => assignedShiftIds.has(String(record.id || ''))) || null
      shiftId = String(shift?.id || '')
    }
    if (!shift && officeEmployee && !shiftId) {
      if (profileShifts.length > 1) {
        throw new ApiError(400, 'PROFILE_WORK_SHIFT_REQUIRED', 'Vui lòng chọn ca làm việc trong hồ sơ trước khi điểm danh.')
      }
      shift = profileShifts[0] || null
      shiftId = String(shift?.id || '')
    }
    if (!shift && officeEmployee && !profileShifts.length) {
      throw new ApiError(409, 'OFFICE_WORK_TIME_INVALID', 'Hồ sơ nhân sự thiếu giờ làm việc hợp lệ.')
    }
    const times = shiftTimes(shift)
    if (!shift || !times.start || !times.end) {
      throw new ApiError(400, 'SHIFT_INVALID', 'Ca làm việc không tồn tại hoặc thiếu giờ bắt đầu/kết thúc.')
    }
    if (officeEmployee && attendance.some((record) => (
      belongsToEmployee(record, employeeId)
      && !record.deletedAt
      && dateFromRecord(record) === localNow.date
    ))) {
      throw new ApiError(409, 'OFFICE_ATTENDANCE_ALREADY_RECORDED', 'Bạn đã chấm công trong ngày hôm nay.')
    }
    const minutesFromStart = localNow.minuteOfDay - times.start.minuteOfDay
    const earlyLimit = Math.trunc(await policyNumber(db, 'early_check_in_limit_minutes', 120))
    if (minutesFromStart < -earlyLimit) {
      throw new ApiError(409, 'CHECK_IN_TOO_EARLY', `Chỉ được điểm danh sớm tối đa ${earlyLimit} phút.`, {
        minutesUntilStart: Math.abs(minutesFromStart),
        earlyLimitMinutes: earlyLimit,
      })
    }
    const lateTolerance = Math.trunc(await policyNumber(db, 'late_tolerance_minutes', 10))
    const requiredWorkingDays = requiredWorkingDaysForEmployee(employee, localNow.date.slice(0, 7))
    const arrivalTag = minutesFromStart < 0
      ? 'Đi sớm'
      : (minutesFromStart <= lateTolerance ? 'Đi đúng giờ' : 'Đi trễ')
    const record = {
      id: `att_${crypto.randomUUID()}`,
      date: localNow.date,
      workDate: localNow.date,
      attendanceDate: localNow.date,
      employeeId,
      employeeName: employee.name || actor.display_name,
      storeId,
      homeStoreId: activeTransfer?.fromStoreId || employee.storeId || storeId,
      ...(activeTransfer ? { supportTransferId: activeTransfer.id } : {}),
      unit: employee.unit || 'store',
      employmentTypeSnapshot: employee.employmentType || null,
      payBasisSnapshot: employee.payBasis || null,
      monthlySalarySnapshot: Number(employee.monthlySalary || 0),
      hourlyRateSnapshot: Number(employee.hourlyRate || 0),
      standardWorkDaysSnapshot: officeEmployee
        ? requiredWorkingDays
        : Number(employee.standardWorkDays || 0),
      ...(officeEmployee ? {
        requiredWorkingDaysSnapshot: requiredWorkingDays,
        workdayCredit: 0,
        attendanceMode: 'office',
      } : {}),
      shift: shiftId,
      shiftId,
      shiftName: shift.name || shiftId,
      shiftStart: times.start.label,
      shiftEnd: times.end.label,
      shiftVersion: Number(shift.version || 1),
      shiftSource: shift.source || (officeEmployee ? 'office-schedule' : 'store-schedule'),
      checkIn: localNow.time,
      checkInTime: localNow.time,
      checkInAt: commandContext.now,
      checkInLocation: location,
      location,
      locationName: location.label || '',
      checkOut: null,
      checkOutTime: null,
      checkOutAt: null,
      checkOutLocation: null,
      arrivalTag,
      departureTag: 'Chưa ra về',
      punctuality: arrivalTag,
      status: arrivalTag,
      minutesEarly: Math.max(0, -minutesFromStart),
      minutesLate: Math.max(0, minutesFromStart),
      workedSeconds: 0,
      hours: 0,
      createdAt: commandContext.now,
      updatedAt: commandContext.now,
      device: { userAgent: commandContext.userAgent || null },
      deletedAt: null,
    }
    const nextState = {
      ...state,
      attendance: [record, ...attendance],
      stateVersion: Math.max(1, Number(state.stateVersion) || 1) + 1,
    }
    return commitGlobalStateDomainCommand(db, actor, current, nextState, {
      action: body.type,
      entityType: 'attendance',
      entityId: record.id,
      before: null,
      after: record,
      metadata: { storeId, shiftId, serverTimestamp: commandContext.now },
      response: { command: body.type, attendance: record },
      status: 201,
    }, commandContext)
  }

  if (body.type !== 'attendance.check_out') {
    throw new ApiError(400, 'COMMAND_UNKNOWN', 'Lệnh chấm công không được hỗ trợ.')
  }
  const requestedId = String(payload.attendanceId || '')
  const openRecord = requestedId
    ? ownOpenRecords.find((record) => String(record.id || '') === requestedId)
    : ownOpenRecords[0]
  if (!openRecord) throw new ApiError(409, 'ATTENDANCE_NOT_OPEN', 'Không tìm thấy ca làm việc đang mở.')
  if (ownOpenRecords.length > 1 && !requestedId) {
    throw new ApiError(409, 'ATTENDANCE_AMBIGUOUS', 'Có nhiều ca đang mở; cần chỉ rõ mã chấm công.')
  }
  const checkInTime = Date.parse(openRecord.checkInAt)
  const checkOutTime = Date.parse(commandContext.now)
  if (!Number.isFinite(checkInTime) || checkOutTime < checkInTime) {
    throw new ApiError(409, 'ATTENDANCE_TIME_INVALID', 'Thời gian vào ca đang lưu không hợp lệ.')
  }
  const workedSeconds = Math.floor((checkOutTime - checkInTime) / 1000)
  const shiftStart = parseShiftTime(openRecord.shiftStart)
  const shiftEnd = parseShiftTime(openRecord.shiftEnd)
  let departureDelta = 0
  if (shiftStart && shiftEnd) {
    let endMinute = shiftEnd.minuteOfDay
    let currentMinute = localNow.minuteOfDay
    if (endMinute <= shiftStart.minuteOfDay) {
      endMinute += 1_440
      if (currentMinute < shiftStart.minuteOfDay) currentMinute += 1_440
    }
    departureDelta = currentMinute - endMinute
  }
  const relatedOrders = (Array.isArray(state.orders) ? state.orders : []).filter((order) => (
    !order.deletedAt
    && String(order.status || '') === 'Hoàn tất'
    && belongsToEmployee(order, employeeId)
    && String(order.storeId || '') === storeId
    && (
      String(order.attendanceId || '') === String(openRecord.id)
      || (!order.attendanceId
        && String(order.shiftId || '') === String(openRecord.shiftId || openRecord.shift || '')
        && Date.parse(order.createdAt) >= checkInTime
        && Date.parse(order.createdAt) <= checkOutTime)
    )
  ))
  const revenue = relatedOrders.reduce(
    (sum, order) => safeMoneySum(sum, Number(order.amount || 0), 'Doanh thu đơn hàng trong ca'),
    0,
  )
  const cash = relatedOrders
    .filter((order) => order.paymentMethod === 'Tiền mặt')
    .reduce((sum, order) => safeMoneySum(sum, Number(order.amount || 0), 'Tiền mặt đơn hàng trong ca'), 0)
  const transfer = revenue - cash
  const storeEmployee = employeeUnit(employee) === 'store'
  let declaredCash = cash
  let declaredTransfer = transfer
  if (storeEmployee) {
    if (payload.cashRevenue === undefined || payload.cashRevenue === null || payload.cashRevenue === ''
      || payload.transferRevenue === undefined || payload.transferRevenue === null || payload.transferRevenue === '') {
      throw new ApiError(400, 'SHIFT_REVENUE_REQUIRED', 'Cần nhập đủ doanh thu tiền mặt và chuyển khoản trước khi kết ca.')
    }
    declaredCash = asVnd(payload.cashRevenue, 'Doanh thu tiền mặt')
    declaredTransfer = asVnd(payload.transferRevenue, 'Doanh thu chuyển khoản')
    if (declaredCash !== cash || declaredTransfer !== transfer) {
      throw new ApiError(409, 'SHIFT_REVENUE_MISMATCH', 'Doanh thu kết ca không khớp với đơn hàng Hoàn tất trong ca.', {
        expected: { cashRevenue: cash, transferRevenue: transfer, totalRevenue: revenue },
        received: {
          cashRevenue: declaredCash,
          transferRevenue: declaredTransfer,
          totalRevenue: safeMoneySum(declaredCash, declaredTransfer, 'Doanh thu khai báo kết ca'),
        },
      })
    }
  }
  const attendanceDate = String(openRecord.date || openRecord.workDate || localNow.date)
  const attendanceShiftId = String(openRecord.shiftId || openRecord.shift || '')
  const incompleteTasks = storeEmployee
    ? (Array.isArray(state.tasks) ? state.tasks : []).filter((task) => {
        if (!taskAppliesToEmployee(task, employeeId, storeId)) return false
        if (String(task.date || task.workDate || '') !== attendanceDate) return false
        const taskShiftId = String(task.shiftId || task.shift || '')
        if (taskShiftId && taskShiftId !== attendanceShiftId) return false
        const completedBy = isPlainRecord(task.completedBy) ? task.completedBy : {}
        return completedBy[employeeId] !== true && task.done !== true
      })
    : []
  const incompleteTaskReason = String(payload.incompleteTaskReason || '').trim()
  if (incompleteTaskReason.length > 1_000) {
    throw new ApiError(400, 'INCOMPLETE_TASK_REASON_INVALID', 'Lý do chưa hoàn thành công việc không được vượt quá 1.000 ký tự.')
  }
  if (incompleteTasks.length && !incompleteTaskReason) {
    throw new ApiError(400, 'INCOMPLETE_TASK_REASON_REQUIRED', 'Cần nhập lý do cho các công việc chưa hoàn thành trước khi kết ca.', {
      taskIds: incompleteTasks.map((task) => task.id),
    })
  }
  if (officeEmployee && (Number(payload.expense || 0) !== 0 || payload.tiktok === true)) {
    throw new ApiError(400, 'OFFICE_CHECK_OUT_FIELDS_INVALID', 'Chấm công ra về của nhân sự theo giờ hồ sơ chỉ ghi nhận thời gian và vị trí.')
  }
  const shiftExpense = officeEmployee || payload.expense == null ? 0 : asVnd(payload.expense, 'Chi phí trong ca')
  if (shiftExpense > 0) assertAccountingPeriodOpen(state, storeId, localNow.date.slice(0, 7))
  const updatedRecord = {
    ...openRecord,
    checkOut: localNow.time,
    checkOutTime: localNow.time,
    checkOutAt: commandContext.now,
    checkOutLocation: location,
    departureTag: shiftEnd && departureDelta < 0 ? 'Về sớm' : 'Đã ra về',
    ...(officeEmployee ? { workdayCredit: workedSeconds > 0 ? 1 : 0 } : {}),
    workedSeconds,
    workedMinutes: workedSeconds / 60,
    hours: workedSeconds / 3_600,
    revenue,
    cash,
    transfer,
    ...(storeEmployee ? {
      declaredRevenue: {
        cash: declaredCash,
        transfer: declaredTransfer,
        total: safeMoneySum(declaredCash, declaredTransfer, 'Doanh thu khai báo kết ca'),
      },
      revenueReconciliation: {
        matched: true,
        expectedCash: cash,
        expectedTransfer: transfer,
        expectedTotal: revenue,
        checkedAt: commandContext.now,
      },
      incompleteTaskReason: incompleteTasks.length ? incompleteTaskReason : null,
      incompleteTasksSnapshot: incompleteTasks.map((task) => ({
        id: task.id,
        assignmentId: task.assignmentId || null,
        title: task.title,
        detail: task.detail || '',
      })),
    } : {}),
    orderCount: relatedOrders.length,
    expense: shiftExpense,
    tiktok: officeEmployee ? false : Boolean(payload.tiktok),
    updatedAt: commandContext.now,
  }
  const expenseEntry = shiftExpense > 0 ? {
    id: `exp_shift_${openRecord.id}`,
    storeId,
    employeeId,
    shiftId: openRecord.shiftId || openRecord.shift || null,
    type: 'Chi phí trong ca',
    category: 'shift',
    amount: shiftExpense,
    description: `Chi phí ${openRecord.shiftName || openRecord.shift || ''}`.trim(),
    sourceType: 'shift-expense',
    sourceId: openRecord.id,
    recognized: true,
    occurredAt: commandContext.now,
    createdAt: commandContext.now,
    createdBy: actor.user_id,
  } : null
  const cashTransaction = shiftExpense > 0 ? {
    id: `txn_shift_${openRecord.id}`,
    storeId,
    employeeId,
    type: 'Chi phí trong ca',
    direction: 'out',
    amount: shiftExpense,
    sourceType: 'shift-expense',
    sourceId: openRecord.id,
    occurredAt: commandContext.now,
    createdAt: commandContext.now,
    actor: serverActorSnapshot(actor),
  } : null
  const expenseEntries = Array.isArray(state.expenseEntries) ? state.expenseEntries : []
  const cashTransactions = Array.isArray(state.cashTransactions) ? state.cashTransactions : []
  if (expenseEntry && expenseEntries.some((entry) => sourceMatch(entry, 'shift-expense', openRecord.id))) {
    throw new ApiError(409, 'SHIFT_EXPENSE_EXISTS', 'Chi phí của ca này đã được ghi nhận.')
  }
  const nextState = {
    ...state,
    attendance: attendance.map((record) => String(record.id || '') === String(openRecord.id) ? updatedRecord : record),
    expenseEntries: expenseEntry ? [expenseEntry, ...expenseEntries] : expenseEntries,
    cashTransactions: cashTransaction ? [cashTransaction, ...cashTransactions] : cashTransactions,
    supportTransfers: activeTransfer
      ? (Array.isArray(state.supportTransfers) ? state.supportTransfers : []).map((record) => (
          String(record.id || '') === String(activeTransfer.id)
            ? {
                ...record,
                status: 'Hoàn tất',
                completedAt: commandContext.now,
                completedAttendanceId: openRecord.id,
                updatedAt: commandContext.now,
              }
            : record
        ))
      : (Array.isArray(state.supportTransfers) ? state.supportTransfers : []),
    payrollPeriods: invalidateClosedPayrollPeriods(
      state,
      { storeId, period: localNow.date.slice(0, 7) },
      commandContext.now,
      body.type,
    ),
    stateVersion: Math.max(1, Number(state.stateVersion) || 1) + 1,
  }
  return commitGlobalStateDomainCommand(db, actor, current, nextState, {
    action: body.type,
    entityType: 'attendance',
    entityId: openRecord.id,
    before: openRecord,
    after: updatedRecord,
    metadata: {
      storeId,
      shiftId: openRecord.shiftId || openRecord.shift,
      shiftExpense,
      serverTimestamp: commandContext.now,
      ...(storeEmployee ? {
        revenueReconciliation: {
          cashRevenue: cash,
          transferRevenue: transfer,
          totalRevenue: revenue,
          matched: true,
        },
        incompleteTaskIds: incompleteTasks.map((task) => task.id),
        incompleteTaskReason: incompleteTasks.length ? incompleteTaskReason : null,
      } : {}),
    },
    response: { command: body.type, attendance: updatedRecord, expense: expenseEntry },
  }, commandContext)
}

const ORDER_GENDERS = new Set(['Nam', 'Nữ', 'Khác'])
const ORDER_ACQUISITION_CHANNELS = new Set(['Facebook', 'Tiktok', 'Zalo', 'Bạn Bè', 'Người thân', 'Khác'])

const orderCustomerProfile = (payload, previous = null) => {
  const gender = String(payload.gender ?? payload.customerGender ?? previous?.gender ?? '').trim()
  if (!ORDER_GENDERS.has(gender)) {
    throw new ApiError(400, 'ORDER_GENDER_INVALID', 'Giới tính là bắt buộc và phải là Nam, Nữ hoặc Khác.')
  }
  const occupation = String(payload.occupation ?? payload.customerOccupation ?? previous?.occupation ?? '').trim()
  if (!occupation || occupation.length > 160) {
    throw new ApiError(400, 'ORDER_OCCUPATION_INVALID', 'Nghề nghiệp là bắt buộc và không được vượt quá 160 ký tự.')
  }
  const acquisitionChannel = String(
    payload.acquisitionChannel ?? payload.channel ?? payload.knownFrom ?? previous?.acquisitionChannel ?? '',
  ).trim()
  if (!ORDER_ACQUISITION_CHANNELS.has(acquisitionChannel)) {
    throw new ApiError(400, 'ORDER_ACQUISITION_CHANNEL_INVALID', 'Kênh biết đến phải là Facebook, Tiktok, Zalo, Bạn Bè, Người thân hoặc Khác.')
  }
  return { gender, occupation, acquisitionChannel }
}

const orderCreateCommand = async (db, actor, body, commandContext) => {
  if (['business_support', 'store_manager'].includes(actor.role)) {
    throw new ApiError(403, 'ORDER_READ_ONLY', 'Tài khoản quản lý vận hành chỉ được xem danh sách đơn hàng.')
  }
  const payload = isPlainRecord(body.payload) ? body.payload : {}
  const expectedVersion = validateExpectedVersion(body.expectedVersion)
  const current = await loadState(db, 'global')
  const currentVersion = Number(current?.version || 0)
  if (!current || currentVersion !== expectedVersion) {
    throw new ApiError(409, 'VERSION_CONFLICT', 'Dữ liệu đã thay đổi trên máy chủ.', { currentVersion })
  }
  const state = normalizeSharedStateForStorage(parseStoredJson(current.value_json, {}))
  const requestedStoreId = String(payload.storeId || '')
  const storeId = actor.role === 'admin' ? requestedStoreId : String(actor.store_id || '')
  if (!storeId || (actor.role === 'employee' && requestedStoreId && requestedStoreId !== storeId)) {
    throw new ApiError(403, 'STORE_FORBIDDEN', 'Bạn không có quyền tạo đơn cho cửa hàng này.')
  }
  const store = (Array.isArray(state.stores) ? state.stores : [])
    .find((record) => String(record.id || '') === storeId && !record.deletedAt)
  const storeCode = String(store?.short || store?.code || store?.id || '')
    .toUpperCase().replace(/[^A-Z0-9]/gu, '').slice(0, 20)
  if (!store || !storeCode) throw new ApiError(400, 'STORE_INVALID', 'Cửa hàng không hợp lệ hoặc thiếu mã cửa hàng.')

  const amount = Number(payload.amount)
  if (!Number.isSafeInteger(amount) || amount <= 0 || amount > MAX_MONEY_VND) {
    throw new ApiError(400, 'ORDER_AMOUNT_INVALID', 'Số tiền đơn hàng phải là số nguyên dương theo đơn vị đồng.')
  }
  const customerName = String(payload.customerName || '').trim()
  if (!customerName || customerName.length > 160) {
    throw new ApiError(400, 'CUSTOMER_NAME_INVALID', 'Tên khách hàng là bắt buộc và không được vượt quá 160 ký tự.')
  }
  const customerPhone = String(payload.customerPhone || '').replace(/\D/gu, '')
  if (customerPhone && (customerPhone.length < 9 || customerPhone.length > 15)) {
    throw new ApiError(400, 'CUSTOMER_PHONE_INVALID', 'Số điện thoại khách hàng không hợp lệ.')
  }
  let customerAge = null
  if (payload.customerAge !== '' && payload.customerAge != null) {
    customerAge = Number(payload.customerAge)
    if (!Number.isInteger(customerAge) || customerAge < 0 || customerAge > 150) {
      throw new ApiError(400, 'CUSTOMER_AGE_INVALID', 'Tuổi khách hàng phải là số nguyên từ 0 đến 150.')
    }
  }
  if (!['Tiền mặt', 'Chuyển khoản'].includes(payload.paymentMethod)) {
    throw new ApiError(400, 'PAYMENT_METHOD_INVALID', 'Hình thức thanh toán không hợp lệ.')
  }
  const customerProfile = orderCustomerProfile(payload)
  const employeeId = actor.role === 'employee'
    ? String(actor.employee_id || actor.user_id)
    : (String(payload.employeeId || '') || null)
  const employee = employeeId
    ? (Array.isArray(state.employees) ? state.employees : [])
      .find((record) => (
        String(record.id || record.code || '') === employeeId
        && employeeUnit(record) === 'store'
        && !record.deletedAt
      ))
    : null
  const employeeStatus = normalizeTextKey(employee?.status)
  const employeeInactive = ['da nghi viec', 'tam ngung', 'inactive', 'locked'].includes(employeeStatus)
  if (actor.role === 'employee' && (!employee || employeeInactive)) {
    throw new ApiError(409, 'EMPLOYEE_PROFILE_MISSING', 'Tài khoản chưa được liên kết với hồ sơ nhân viên hợp lệ.')
  }
  const activeTransfer = actor.active_transfer_id
    ? (Array.isArray(state.supportTransfers) ? state.supportTransfers : []).find((record) => (
        String(record.id || '') === String(actor.active_transfer_id)
        && String(record.employeeId || '') === employeeId
        && String(record.toStoreId || '') === storeId
        && !record.deletedAt
        && !['Đã xóa', 'Đã hủy', 'Hoàn tất'].includes(String(record.status || ''))
      ))
    : null
  if (employee && String(employee.storeId || '') !== storeId && !activeTransfer) {
    throw new ApiError(403, 'EMPLOYEE_STORE_MISMATCH', 'Nhân viên không thuộc cửa hàng tạo đơn.')
  }

  const openAttendance = employeeId
    ? (Array.isArray(state.attendance) ? state.attendance : []).find((record) => (
        belongsToEmployee(record, employeeId)
        && String(record.storeId || '') === storeId
        && !record.deletedAt
        && !record.checkOut
        && !record.checkOutAt
      ))
    : null
  if (actor.role === 'employee' && !openAttendance) {
    throw new ApiError(409, 'ATTENDANCE_NOT_OPEN', 'Nhân viên chỉ được tạo đơn trong ca đang mở.')
  }
  const requestedShiftId = String(payload.shiftId || '') || null
  const shiftId = openAttendance?.shift || openAttendance?.shiftId || (actor.role === 'admin' ? requestedShiftId : null)
  const shiftDefinition = shiftId
    ? (Array.isArray(state.shiftDefinitions) ? state.shiftDefinitions : [])
      .find((record) => String(record.id || '') === String(shiftId))
    : null
  const times = shiftTimes(shiftDefinition)

  const counterName = `store:${storeId}:orders`
  const counter = await first(db, `
    SELECT counter_name, counter_value, version FROM counters WHERE counter_name = ? LIMIT 1
  `, counterName)
  const counterValue = Number(counter?.counter_value || 0)
  if (!Number.isSafeInteger(counterValue) || counterValue >= 99_999) {
    throw new ApiError(409, 'ORDER_COUNTER_EXHAUSTED', 'Dãy mã đơn hàng của cửa hàng đã hết.')
  }
  const nextCounterValue = counterValue + 1
  const code = `${storeCode}-${String(nextCounterValue).padStart(5, '0')}`
  const order = {
    id: `ord_${crypto.randomUUID()}`,
    code,
    storeId,
    customerName,
    customerPhone,
    customerAge,
    ...customerProfile,
    amount,
    paymentMethod: payload.paymentMethod,
    employeeId,
    employeeName: employee?.name || actor.display_name || 'Quản trị viên',
    shiftId,
    shiftName: openAttendance?.shiftName || shiftDefinition?.name || String(payload.shiftName || '').trim().slice(0, 120) || 'Chưa gắn ca',
    shiftStart: openAttendance?.shiftStart || times.start?.label || null,
    shiftEnd: openAttendance?.shiftEnd || times.end?.label || null,
    attendanceId: openAttendance?.id || null,
    ...(activeTransfer ? { supportTransferId: activeTransfer.id, homeStoreId: activeTransfer.fromStoreId } : {}),
    status: 'Hoàn tất',
    source: 'order',
    createdAt: commandContext.now,
    updatedAt: commandContext.now,
    deletedAt: null,
  }
  const notification = {
    id: `ntf_${crypto.randomUUID()}`,
    type: 'order.created',
    storeId,
    employeeId,
    orderId: order.id,
    orderCode: order.code,
    title: `Đơn hàng mới ${order.code}`,
    message: `${order.employeeName} vừa tạo đơn ${order.code}.`,
    createdAt: commandContext.now,
    readAt: null,
  }
  const nextState = {
    ...state,
    orders: [order, ...(Array.isArray(state.orders) ? state.orders : [])],
    notifications: [notification, ...(Array.isArray(state.notifications) ? state.notifications : [])],
    payrollPeriods: invalidateClosedPayrollPeriods(
      state,
      { storeId, period: monthFromRecord(order) },
      commandContext.now,
      body.type,
    ),
    stateVersion: Math.max(1, Number(state.stateVersion) || 1) + 1,
  }
  return commitGlobalStateCounterDomainCommand(db, actor, current, nextState, {
    name: counterName,
    row: counter,
    value: nextCounterValue,
  }, {
    action: body.type,
    entityType: 'order',
    entityId: order.id,
    before: null,
    after: order,
    metadata: { storeId, counterName, counterValue: nextCounterValue },
    response: { command: body.type, order, notification },
    status: 201,
  }, commandContext)
}

const orderMutationCommand = async (db, actor, body, commandContext) => {
  if (!['admin', 'business_support'].includes(actor.role)) {
    throw new ApiError(403, 'ROLE_FORBIDDEN', 'Chỉ Admin hoặc Nhân viên hỗ trợ KD được sửa hoặc xóa đơn hàng.')
  }
  const payload = isPlainRecord(body.payload) ? body.payload : {}
  const reason = String(payload.reason || '').trim()
  if (!reason || reason.length > 500) {
    throw new ApiError(400, 'REASON_REQUIRED', 'Cần nhập lý do từ 1 đến 500 ký tự.')
  }
  const { current, state } = await loadGlobalCommandState(db, body)
  const orderId = String(payload.orderId || payload.id || '').trim()
  const orders = Array.isArray(state.orders) ? state.orders : []
  const previous = orders.find((order) => String(order.id || '') === orderId)
  if (!previous || previous.deletedAt || previous.status === 'Đã xóa') {
    throw new ApiError(404, 'ORDER_NOT_FOUND', 'Không tìm thấy đơn hàng đang hoạt động.')
  }
  if (previous.source === 'legacy-opening-balance') {
    throw new ApiError(409, 'LEGACY_ORDER_IMMUTABLE', 'Không thể thay đổi bản ghi doanh thu chuyển tiếp.')
  }
  assertPayrollNotPaidOrLocked(state, previous.storeId, monthFromRecord(previous))
  const actorSnapshot = serverActorSnapshot(actor)
  let next
  let action
  let changedFields
  if (body.type === 'order.delete') {
    action = 'Xóa'
    changedFields = ['status', 'deletedAt', 'deletedBy']
    next = {
      ...previous,
      status: 'Đã xóa',
      deletedAt: commandContext.now,
      deletedBy: actorSnapshot,
      updatedAt: commandContext.now,
    }
  } else if (body.type === 'order.update') {
    action = 'Sửa'
    const candidate = { ...previous }
    if (payload.customerName !== undefined) {
      const customerName = String(payload.customerName || '').trim()
      if (!customerName || customerName.length > 160) {
        throw new ApiError(400, 'CUSTOMER_NAME_INVALID', 'Tên khách hàng là bắt buộc và không quá 160 ký tự.')
      }
      candidate.customerName = customerName
    }
    if (payload.customerPhone !== undefined) {
      const customerPhone = String(payload.customerPhone || '').replace(/\D/gu, '')
      if (customerPhone && (customerPhone.length < 9 || customerPhone.length > 15)) {
        throw new ApiError(400, 'CUSTOMER_PHONE_INVALID', 'Số điện thoại khách hàng không hợp lệ.')
      }
      candidate.customerPhone = customerPhone
    }
    if (payload.customerAge !== undefined) {
      if (payload.customerAge === '' || payload.customerAge === null) candidate.customerAge = null
      else {
        const customerAge = Number(payload.customerAge)
        if (!Number.isInteger(customerAge) || customerAge < 0 || customerAge > 150) {
          throw new ApiError(400, 'CUSTOMER_AGE_INVALID', 'Tuổi khách hàng phải là số nguyên từ 0 đến 150.')
        }
        candidate.customerAge = customerAge
      }
    }
    if (payload.amount !== undefined) candidate.amount = asVnd(payload.amount, 'Số tiền đơn hàng', { positive: true })
    if (payload.paymentMethod !== undefined) {
      if (!['Tiền mặt', 'Chuyển khoản'].includes(payload.paymentMethod)) {
        throw new ApiError(400, 'PAYMENT_METHOD_INVALID', 'Hình thức thanh toán không hợp lệ.')
      }
      candidate.paymentMethod = payload.paymentMethod
    }
    if (payload.gender !== undefined || payload.customerGender !== undefined) {
      const gender = String(payload.gender ?? payload.customerGender ?? '').trim()
      if (!ORDER_GENDERS.has(gender)) {
        throw new ApiError(400, 'ORDER_GENDER_INVALID', 'Giới tính phải là Nam, Nữ hoặc Khác.')
      }
      candidate.gender = gender
    }
    if (payload.occupation !== undefined || payload.customerOccupation !== undefined) {
      const occupation = String(payload.occupation ?? payload.customerOccupation ?? '').trim()
      if (!occupation || occupation.length > 160) {
        throw new ApiError(400, 'ORDER_OCCUPATION_INVALID', 'Nghề nghiệp không được để trống và không quá 160 ký tự.')
      }
      candidate.occupation = occupation
    }
    if (payload.acquisitionChannel !== undefined || payload.channel !== undefined || payload.knownFrom !== undefined) {
      const acquisitionChannel = String(
        payload.acquisitionChannel ?? payload.channel ?? payload.knownFrom ?? '',
      ).trim()
      if (!ORDER_ACQUISITION_CHANNELS.has(acquisitionChannel)) {
        throw new ApiError(400, 'ORDER_ACQUISITION_CHANNEL_INVALID', 'Kênh biết đến không hợp lệ.')
      }
      candidate.acquisitionChannel = acquisitionChannel
    }
    changedFields = [
      'customerName', 'customerPhone', 'customerAge', 'gender', 'occupation',
      'acquisitionChannel', 'amount', 'paymentMethod',
    ]
      .filter((key) => JSON.stringify(candidate[key]) !== JSON.stringify(previous[key]))
    if (!changedFields.length) {
      return recordNoopCommand(db, actor, {
        command: body.type,
        version: Number(current.version),
        order: previous,
        existing: true,
      }, 200, commandContext)
    }
    next = { ...candidate, updatedAt: commandContext.now }
  } else {
    throw new ApiError(400, 'COMMAND_UNKNOWN', 'Lệnh đơn hàng không được hỗ trợ.')
  }

  const nextOrders = orders.map((order) => String(order.id || '') === orderId ? next : order)
  const nextAttendance = refreshAttendanceSales(state, nextOrders, previous, commandContext.now)
  const auditRecord = {
    id: `oda_${crypto.randomUUID()}`,
    action,
    orderId,
    orderCode: previous.code,
    storeId: previous.storeId,
    before: previous,
    after: next,
    changedFields,
    revenueBefore: Number(previous.amount || 0),
    revenueAfter: next.deletedAt ? 0 : Number(next.amount || 0),
    reason,
    actor: actorSnapshot,
    createdAt: commandContext.now,
  }
  const nextState = {
    ...state,
    orders: nextOrders,
    attendance: nextAttendance,
    orderAudit: [auditRecord, ...(Array.isArray(state.orderAudit) ? state.orderAudit : [])],
    auditLogs: [auditRecord, ...(Array.isArray(state.auditLogs) ? state.auditLogs : [])],
    payrollPeriods: invalidateClosedPayrollPeriods(
      state,
      { storeId: previous.storeId, period: monthFromRecord(previous) },
      commandContext.now,
      body.type,
    ),
    stateVersion: Math.max(1, Number(state.stateVersion) || 1) + 1,
  }
  return commitGlobalStateDomainCommand(db, actor, current, nextState, {
    action: body.type,
    entityType: 'order',
    entityId: orderId,
    before: previous,
    after: next,
    metadata: { reason, changedFields, attendanceId: previous.attendanceId || null },
    response: { command: body.type, order: next, audit: auditRecord },
  }, commandContext)
}

const supportWorkMetrics = (tasks) => {
  const totalTasks = tasks.length
  const completedTasks = tasks.filter((task) => task.completed === true).length
  return {
    totalTasks,
    completedTasks,
    completionRate: totalTasks ? Math.round((completedTasks / totalTasks) * 100) : 0,
  }
}

const supportWorkTaskHistorySnapshot = (tasks) => (Array.isArray(tasks) ? tasks : []).map((task) => ({
  id: String(task.id || ''),
  name: String(task.name || task.title || ''),
  description: String(task.description || task.detail || ''),
  completed: task.completed === true,
  completedAt: task.completedAt || null,
  completedBy: task.completedBy || null,
}))

const normalizeAssignedSupportTasks = (rawTasks, previousTasks, actor, timestamp) => {
  if (!Array.isArray(rawTasks) || rawTasks.length < 1 || rawTasks.length > 100) {
    throw new ApiError(400, 'SUPPORT_WORK_TASKS_INVALID', 'Danh sách công việc phải có từ 1 đến 100 mục.')
  }
  const priorById = new Map((Array.isArray(previousTasks) ? previousTasks : [])
    .map((task) => [String(task.id || ''), task]))
  const ids = new Set()
  return rawTasks.map((rawTask, index) => {
    if (!isPlainRecord(rawTask)) {
      throw new ApiError(400, 'SUPPORT_WORK_TASK_INVALID', `Công việc thứ ${index + 1} không hợp lệ.`)
    }
    const id = String(rawTask.id || `swt_${crypto.randomUUID()}`).trim()
    if (!/^[A-Za-z0-9_-]{1,160}$/u.test(id) || ids.has(id)) {
      throw new ApiError(400, 'SUPPORT_WORK_TASK_ID_INVALID', 'Mã công việc phải hợp lệ và không được trùng.')
    }
    ids.add(id)
    const name = String(rawTask.name ?? rawTask.title ?? '').trim()
    const description = String(rawTask.description ?? rawTask.detail ?? '').trim()
    if (!name || name.length > 200) {
      throw new ApiError(400, 'SUPPORT_WORK_TASK_NAME_INVALID', 'Tên công việc là bắt buộc và không quá 200 ký tự.')
    }
    if (description.length > 2_000) {
      throw new ApiError(400, 'SUPPORT_WORK_TASK_DESCRIPTION_INVALID', 'Mô tả công việc không được vượt quá 2.000 ký tự.')
    }
    const prior = priorById.get(id)
    return {
      id,
      name,
      title: name,
      description,
      detail: description,
      completed: Boolean(prior?.completed),
      completedAt: prior?.completedAt || null,
      completedBy: prior?.completedBy || null,
      completedByActor: prior?.completedByActor || null,
      assignedAt: prior?.assignedAt || timestamp,
      assignedBy: prior?.assignedBy || serverActorSnapshot(actor),
    }
  })
}

const supportWorkCommand = async (db, actor, body, commandContext) => {
  const payload = isPlainRecord(body.payload) ? body.payload : {}
  const { current, state } = await loadGlobalCommandState(db, body)
  const assignments = Array.isArray(state.supportWorkAssignments) ? state.supportWorkAssignments : []

  if (body.type === 'support_work.assign') {
    assertAdmin(actor, 'Chỉ Admin được giao việc cho Nhân viên hỗ trợ KD.')
    const date = optionalCalendarDate(payload.date, 'Ngày giao việc')
    if (!date) throw new ApiError(400, 'SUPPORT_WORK_DATE_REQUIRED', 'Ngày giao việc là bắt buộc.')
    const employeeId = String(payload.employeeId || '').trim()
    const employee = (Array.isArray(state.employees) ? state.employees : []).find((record) => (
      !record.deletedAt
      && [record.id, record.code, record.employeeId].map(String).includes(employeeId)
      && employeeUnit(record) === 'business_support'
      && !['da nghi viec', 'inactive'].includes(normalizeTextKey(record.status))
    ))
    if (!employee) {
      throw new ApiError(404, 'SUPPORT_EMPLOYEE_NOT_FOUND', 'Không tìm thấy Nhân viên hỗ trợ KD đang hoạt động.')
    }
    const requestedAssignmentId = String(payload.assignmentId || '').trim()
    if (requestedAssignmentId && !/^[A-Za-z0-9_-]{1,160}$/u.test(requestedAssignmentId)) {
      throw new ApiError(400, 'SUPPORT_WORK_ID_INVALID', 'Mã lượt giao việc không hợp lệ.')
    }
    const previous = requestedAssignmentId
      ? assignments.find((record) => String(record.id || '') === requestedAssignmentId && !record.deletedAt)
      : null
    if (requestedAssignmentId && !previous) {
      throw new ApiError(404, 'SUPPORT_WORK_NOT_FOUND', 'Không tìm thấy lượt giao việc cần cập nhật.')
    }
    if (previous && (String(previous.employeeId || '') !== employeeId || String(previous.date || '') !== date)) {
      throw new ApiError(400, 'SUPPORT_WORK_SCOPE_IMMUTABLE', 'Không thể đổi nhân viên hoặc ngày của lượt giao việc đã tạo.')
    }
    if (previous?.submittedAt) {
      throw new ApiError(409, 'SUPPORT_WORK_SUBMITTED', 'Công việc đã được nhân viên gửi kết quả và không thể thay thế.')
    }
    const tasks = normalizeAssignedSupportTasks(payload.tasks, previous?.tasks, actor, commandContext.now)
    const metrics = supportWorkMetrics(tasks)
    const assignmentId = previous?.id || `swa_${crypto.randomUUID()}`
    const historyEntry = {
      action: previous ? 'replaced' : 'assigned',
      at: commandContext.now,
      actor: serverActorSnapshot(actor),
      details: previous
        ? {
            taskCount: tasks.length,
            beforeTasks: supportWorkTaskHistorySnapshot(previous.tasks),
            afterTasks: supportWorkTaskHistorySnapshot(tasks),
          }
        : {
            taskCount: tasks.length,
            tasks: supportWorkTaskHistorySnapshot(tasks),
          },
    }
    const assignment = {
      ...(previous || {}),
      id: assignmentId,
      date,
      employeeId,
      employeeName: employee.name || employeeId,
      tasks,
      ...metrics,
      status: metrics.completedTasks ? 'in_progress' : 'assigned',
      incompleteReason: null,
      submittedAt: null,
      assignedAt: previous?.assignedAt || commandContext.now,
      assignedBy: previous?.assignedBy || serverActorSnapshot(actor),
      updatedAt: commandContext.now,
      updatedBy: serverActorSnapshot(actor),
      history: [...(Array.isArray(previous?.history) ? previous.history : []), historyEntry],
    }
    const notification = {
      id: `notif_${crypto.randomUUID()}`,
      type: 'support-work-assigned',
      storeId: BUSINESS_SUPPORT_STORE_ID,
      employeeId,
      assignmentId,
      route: '/support/tasks',
      title: 'Công việc mới từ Admin',
      message: `Bạn có ${tasks.length} công việc được giao cho ngày ${date}.`,
      createdAt: commandContext.now,
      createdBy: serverActorSnapshot(actor),
      readAt: null,
    }
    const nextState = {
      ...state,
      supportWorkAssignments: previous
        ? assignments.map((record) => String(record.id || '') === assignmentId ? assignment : record)
        : [assignment, ...assignments],
      notifications: [notification, ...(Array.isArray(state.notifications) ? state.notifications : [])],
      stateVersion: Math.max(1, Number(state.stateVersion) || 1) + 1,
    }
    return commitGlobalStateDomainCommand(db, actor, current, nextState, {
      action: body.type,
      entityType: 'support-work-assignment',
      entityId: assignmentId,
      before: previous,
      after: assignment,
      metadata: { employeeId, date, taskCount: tasks.length, replaced: Boolean(previous) },
      response: { command: body.type, assignment, notification },
      status: previous ? 200 : 201,
    }, commandContext)
  }

  if (body.type !== 'support_work.update') {
    throw new ApiError(400, 'COMMAND_UNKNOWN', 'Lệnh giao việc Hỗ trợ KD không được hỗ trợ.')
  }
  if (actor.role !== 'business_support') {
    throw new ApiError(403, 'ROLE_FORBIDDEN', 'Chỉ Nhân viên hỗ trợ KD được cập nhật tiến độ công việc của mình.')
  }
  const assignmentId = String(payload.assignmentId || payload.id || '').trim()
  const previous = assignments.find((record) => String(record.id || '') === assignmentId && !record.deletedAt)
  if (!previous) throw new ApiError(404, 'SUPPORT_WORK_NOT_FOUND', 'Không tìm thấy công việc được giao.')
  const employeeId = String(actor.employee_id || actor.user_id || '')
  if (!belongsToEmployee(previous, employeeId)) {
    throw new ApiError(403, 'SUPPORT_WORK_FORBIDDEN', 'Bạn chỉ được cập nhật công việc được giao cho chính mình.')
  }
  if (previous.submittedAt) {
    throw new ApiError(409, 'SUPPORT_WORK_SUBMITTED', 'Kết quả công việc đã được gửi và không thể thay đổi.')
  }
  const updates = payload.tasks === undefined ? [] : payload.tasks
  if (!Array.isArray(updates) || updates.length > 100) {
    throw new ApiError(400, 'SUPPORT_WORK_PROGRESS_INVALID', 'Tiến độ công việc phải là một danh sách không quá 100 mục.')
  }
  const updateById = new Map()
  for (const update of updates) {
    const id = String(update?.id || '').trim()
    if (!id || typeof update?.completed !== 'boolean' || updateById.has(id)) {
      throw new ApiError(400, 'SUPPORT_WORK_PROGRESS_INVALID', 'Mỗi tiến độ phải có mã duy nhất và trạng thái completed dạng boolean.')
    }
    updateById.set(id, update.completed)
  }
  const knownIds = new Set((Array.isArray(previous.tasks) ? previous.tasks : []).map((task) => String(task.id || '')))
  const unknownIds = [...updateById.keys()].filter((id) => !knownIds.has(id))
  if (unknownIds.length) {
    throw new ApiError(400, 'SUPPORT_WORK_TASK_NOT_FOUND', 'Tiến độ chứa công việc không thuộc lượt giao việc này.', { taskIds: unknownIds })
  }
  const changedTaskIds = []
  const tasks = (Array.isArray(previous.tasks) ? previous.tasks : []).map((task) => {
    const id = String(task.id || '')
    if (!updateById.has(id) || Boolean(task.completed) === updateById.get(id)) return task
    changedTaskIds.push(id)
    const completed = updateById.get(id)
    return {
      ...task,
      completed,
      completedAt: completed ? commandContext.now : null,
      completedBy: completed ? String(actor.user_id || '') : null,
      completedByActor: completed ? serverActorSnapshot(actor) : null,
    }
  })
  const submit = payload.submit === true
  if (payload.submit !== undefined && typeof payload.submit !== 'boolean') {
    throw new ApiError(400, 'SUPPORT_WORK_SUBMIT_INVALID', 'Trạng thái gửi kết quả phải là boolean.')
  }
  const metrics = supportWorkMetrics(tasks)
  const reason = String(payload.incompleteReason || '').trim()
  if (reason.length > 1_000) {
    throw new ApiError(400, 'SUPPORT_WORK_REASON_INVALID', 'Lý do chưa hoàn thành không được vượt quá 1.000 ký tự.')
  }
  if (submit && metrics.completedTasks < metrics.totalTasks && !reason) {
    throw new ApiError(400, 'SUPPORT_WORK_REASON_REQUIRED', 'Cần nhập lý do khi gửi kết quả chưa hoàn thành hết công việc.')
  }
  if (!changedTaskIds.length && !submit) {
    return recordNoopCommand(db, actor, {
      command: body.type,
      version: Number(current.version),
      assignment: previous,
      existing: true,
    }, 200, commandContext)
  }
  const status = submit
    ? (metrics.completedTasks === metrics.totalTasks ? 'completed' : 'incomplete')
    : (metrics.completedTasks ? 'in_progress' : 'assigned')
  const historyEntry = {
    action: submit ? 'submitted' : 'progress-updated',
    at: commandContext.now,
    actor: serverActorSnapshot(actor),
    details: {
      changedTaskIds,
      ...metrics,
      tasks: supportWorkTaskHistorySnapshot(tasks),
      ...(submit && reason ? { incompleteReason: reason } : {}),
    },
  }
  const assignment = {
    ...previous,
    tasks,
    ...metrics,
    status,
    incompleteReason: submit && metrics.completedTasks < metrics.totalTasks ? reason : null,
    submittedAt: submit ? commandContext.now : null,
    updatedAt: commandContext.now,
    updatedBy: serverActorSnapshot(actor),
    history: [...(Array.isArray(previous.history) ? previous.history : []), historyEntry],
  }
  const notification = submit ? {
    id: `notif_${crypto.randomUUID()}`,
    type: 'support-work-submitted',
    storeId: BUSINESS_SUPPORT_STORE_ID,
    audienceRoles: ['admin'],
    assignmentId,
    route: '/admin/business-support',
    title: 'Hỗ trợ KD đã gửi kết quả công việc',
    message: `${previous.employeeName || employeeId} hoàn thành ${metrics.completedTasks}/${metrics.totalTasks} công việc ngày ${previous.date}.`,
    createdAt: commandContext.now,
    createdBy: serverActorSnapshot(actor),
    readAt: null,
  } : null
  const nextState = {
    ...state,
    supportWorkAssignments: assignments.map((record) => String(record.id || '') === assignmentId ? assignment : record),
    notifications: notification
      ? [notification, ...(Array.isArray(state.notifications) ? state.notifications : [])]
      : state.notifications,
    stateVersion: Math.max(1, Number(state.stateVersion) || 1) + 1,
  }
  return commitGlobalStateDomainCommand(db, actor, current, nextState, {
    action: body.type,
    entityType: 'support-work-assignment',
    entityId: assignmentId,
    before: previous,
    after: assignment,
    metadata: { employeeId, changedTaskIds, submitted: submit, ...metrics },
    response: { command: body.type, assignment, ...(notification ? { notification } : {}) },
  }, commandContext)
}

const taskDoneCommand = async (db, actor, body, commandContext) => {
  if (actor.role !== 'employee') {
    throw new ApiError(403, 'ROLE_FORBIDDEN', 'Lệnh hoàn thành công việc chỉ dành cho nhân viên.')
  }
  const payload = isPlainRecord(body.payload) ? body.payload : {}
  if (typeof payload.done !== 'boolean') {
    throw new ApiError(400, 'TASK_STATUS_INVALID', 'Trạng thái công việc phải là true hoặc false.')
  }
  const { current, state } = await loadGlobalCommandState(db, body)
  const taskId = String(payload.taskId || payload.id || '').trim()
  const tasks = Array.isArray(state.tasks) ? state.tasks : []
  const previous = tasks.find((task) => String(task.id || '') === taskId && !task.deletedAt)
  if (!previous) throw new ApiError(404, 'TASK_NOT_FOUND', 'Không tìm thấy công việc.')
  const employeeId = String(actor.employee_id || actor.user_id || '')
  const storeId = String(actor.store_id || '')
  if (!taskAppliesToEmployee(previous, employeeId, storeId)) {
    throw new ApiError(403, 'TASK_FORBIDDEN', 'Công việc không thuộc cửa hàng của bạn.')
  }
  const localNow = localDateTimeParts(commandContext.now)
  const taskDate = String(previous.date || previous.workDate || '')
  if (taskDate && taskDate !== localNow.date) {
    throw new ApiError(409, 'TASK_DATE_INVALID', 'Chỉ được cập nhật công việc của ngày hiện tại.')
  }
  const taskShiftId = String(previous.shiftId || previous.shift || '')
  if (taskShiftId) {
    const openAttendance = (Array.isArray(state.attendance) ? state.attendance : []).find((record) => (
      belongsToEmployee(record, employeeId)
      && !record.deletedAt
      && !record.checkOutAt
      && !record.checkOut
    ))
    if (!openAttendance || String(openAttendance.shiftId || openAttendance.shift || '') !== taskShiftId) {
      throw new ApiError(409, 'TASK_SHIFT_INVALID', 'Công việc không thuộc ca đang mở của bạn.')
    }
  }
  const completedBy = isPlainRecord(previous.completedBy) ? previous.completedBy : {}
  if (Boolean(completedBy[employeeId]) === payload.done && Object.hasOwn(completedBy, employeeId)) {
    return recordNoopCommand(db, actor, {
      command: body.type,
      version: Number(current.version),
      task: { ...previous, completedBy: { [employeeId]: payload.done } },
      existing: true,
    }, 200, commandContext)
  }
  const next = {
    ...previous,
    completedBy: { ...completedBy, [employeeId]: payload.done },
    completionHistory: [
      ...(Array.isArray(previous.completionHistory) ? previous.completionHistory : []),
      {
        done: payload.done,
        at: commandContext.now,
        employeeId,
        actor: serverActorSnapshot(actor),
      },
    ],
    updatedAt: commandContext.now,
    updatedBy: serverActorSnapshot(actor),
  }
  const completionEvent = {
    taskId,
    employeeId,
    done: payload.done,
    at: commandContext.now,
    actor: serverActorSnapshot(actor),
  }
  const taskAssignmentHistory = (Array.isArray(state.taskAssignmentHistory) ? state.taskAssignmentHistory : [])
    .map((assignment) => {
      if (!previous.assignmentId || String(assignment.assignmentId || assignment.id || '') !== String(previous.assignmentId)) {
        return assignment
      }
      return {
        ...assignment,
        tasks: (Array.isArray(assignment.tasks) ? assignment.tasks : []).map((task) => (
          String(task.id || '') === taskId
            ? {
                ...task,
                completedBy: {
                  ...(isPlainRecord(task.completedBy) ? task.completedBy : {}),
                  [employeeId]: payload.done,
                },
              }
            : task
        )),
        progressHistory: [
          ...(Array.isArray(assignment.progressHistory) ? assignment.progressHistory : []),
          completionEvent,
        ],
        updatedAt: commandContext.now,
        updatedBy: serverActorSnapshot(actor),
      }
    })
  const nextState = {
    ...state,
    tasks: tasks.map((task) => String(task.id || '') === taskId ? next : task),
    taskAssignmentHistory,
    stateVersion: Math.max(1, Number(state.stateVersion) || 1) + 1,
  }
  return commitGlobalStateDomainCommand(db, actor, current, nextState, {
    action: body.type,
    entityType: 'task-completion',
    entityId: `${taskId}:${employeeId}`,
    before: { taskId, employeeId, done: Boolean(completedBy[employeeId]) },
    after: { taskId, employeeId, done: payload.done },
    metadata: { taskId, employeeId, storeId, assignmentId: previous.assignmentId || null },
    response: {
      command: body.type,
      task: { ...next, completedBy: { [employeeId]: payload.done } },
    },
  }, commandContext)
}

const FIXED_EXPENSE_TYPES = new Set([
  'Điện',
  'Nước',
  'Wi-Fi',
  'Rác',
  'Marketing',
  'Chi phí thiết lập cửa hàng',
  'Chi phí khác',
])

const expenseCommand = async (db, actor, body, commandContext) => {
  assertOperationsRole(actor, 'Tài khoản không có quyền quản lý chi phí cửa hàng.')
  const payload = isPlainRecord(body.payload) ? body.payload : {}
  const fixed = body.type.startsWith('fixed_expense.')
  const operation = body.type.split('.').at(-1)
  if (!['create', 'update', 'delete'].includes(operation)) {
    throw new ApiError(400, 'COMMAND_UNKNOWN', 'Lệnh chi phí không được hỗ trợ.')
  }
  const { current, state } = await loadGlobalCommandState(db, body)
  const actorSnapshot = serverActorSnapshot(actor)
  const expenses = Array.isArray(state.expenseEntries) ? state.expenseEntries : []
  const fixedExpenses = Array.isArray(state.fixedExpenses) ? state.fixedExpenses : []

  if (operation === 'create') {
    const storeId = String(payload.storeId || '').trim()
    assertOperationalStoreAccess(actor, storeId)
    requireStore(state, storeId)
    const amount = asVnd(payload.amount, 'Số tiền chi phí', { positive: true })
    const type = String(payload.type || 'Chi phí khác').trim()
    if (!type || type.length > 120 || (fixed && !FIXED_EXPENSE_TYPES.has(type))) {
      throw new ApiError(400, 'EXPENSE_TYPE_INVALID', 'Loại chi phí không hợp lệ.')
    }
    const note = String(payload.note ?? payload.description ?? '').trim()
    if (note.length > 1_000) throw new ApiError(400, 'NOTE_TOO_LONG', 'Ghi chú không được vượt quá 1.000 ký tự.')
    const occurredAt = asOccurredAt(payload.occurredAt, commandContext.now)
    assertAccountingPeriodOpen(state, storeId, occurredAt.slice(0, 7))
    const sourceId = `${fixed ? 'fix' : 'mex'}_${crypto.randomUUID()}`
    const entry = {
      id: `exp_${crypto.randomUUID()}`,
      storeId,
      type,
      category: fixed ? 'fixed' : String(payload.category || 'other').trim().slice(0, 80) || 'other',
      amount,
      description: note,
      sourceType: fixed ? 'fixed-expense' : 'manual-expense',
      sourceId,
      recognized: true,
      occurredAt,
      createdAt: commandContext.now,
      createdBy: actor.user_id,
    }
    const fixedRecord = fixed ? {
      id: sourceId,
      storeId,
      type,
      amount,
      note,
      occurredAt,
      createdAt: commandContext.now,
      createdBy: actorSnapshot,
      deletedAt: null,
    } : null
    const nextState = {
      ...state,
      expenseEntries: [entry, ...expenses],
      fixedExpenses: fixedRecord ? [fixedRecord, ...fixedExpenses] : fixedExpenses,
      payrollPeriods: invalidateClosedPayrollPeriods(
        state,
        { storeId, period: occurredAt.slice(0, 7) },
        commandContext.now,
        body.type,
      ),
      stateVersion: Math.max(1, Number(state.stateVersion) || 1) + 1,
    }
    return commitGlobalStateDomainCommand(db, actor, current, nextState, {
      action: body.type,
      entityType: fixed ? 'fixed-expense' : 'expense',
      entityId: sourceId,
      before: null,
      after: fixedRecord || entry,
      metadata: { expenseEntryId: entry.id, storeId },
      response: {
        command: body.type,
        expense: fixedRecord || entry,
        expenseEntry: entry,
      },
      status: 201,
    }, commandContext)
  }

  const reason = String(payload.reason || '').trim()
  if (!reason || reason.length > 500) {
    throw new ApiError(400, 'REASON_REQUIRED', 'Cần nhập lý do từ 1 đến 500 ký tự.')
  }
  const entityId = String(
    fixed ? (payload.expenseId || payload.fixedExpenseId || payload.id) : (payload.expenseId || payload.id),
  ).trim()
  const previous = fixed
    ? fixedExpenses.find((record) => String(record.id || '') === entityId)
    : expenses.find((record) => (
        String(record.id || '') === entityId
        && String(record.sourceType || '') === 'manual-expense'
      ))
  if (!previous) throw new ApiError(404, 'EXPENSE_NOT_FOUND', 'Không tìm thấy chi phí.')
  assertOperationalStoreAccess(actor, previous.storeId)
  const previousEntry = fixed
    ? expenses.find((entry) => sourceMatch(entry, 'fixed-expense', previous.id))
    : previous
  if (previous.deletedAt || previousEntry?.deletedAt || previousEntry?.recognized === false) {
    if (operation === 'delete') {
      return recordNoopCommand(db, actor, {
        command: body.type,
        version: Number(current.version),
        expense: previous,
        existing: true,
      }, 200, commandContext)
    }
    throw new ApiError(409, 'EXPENSE_DELETED', 'Chi phí đã bị xóa.')
  }
  const previousPeriod = monthFromRecord(previous)
  assertAccountingPeriodOpen(state, previous.storeId, previousPeriod)

  let next
  let nextEntry
  let changedFields
  if (operation === 'delete') {
    changedFields = ['deletedAt', 'recognized']
    next = {
      ...previous,
      deletedAt: commandContext.now,
      deletedBy: actorSnapshot,
      updatedAt: commandContext.now,
    }
    nextEntry = {
      ...(previousEntry || {
        id: `exp_${crypto.randomUUID()}`,
        storeId: previous.storeId,
        type: previous.type,
        category: fixed ? 'fixed' : 'other',
        amount: previous.amount,
        description: previous.note || previous.description || '',
        sourceType: fixed ? 'fixed-expense' : 'manual-expense',
        sourceId: previous.id,
        occurredAt: previous.occurredAt,
        createdAt: previous.createdAt,
      }),
      recognized: false,
      voidedAt: commandContext.now,
      deletedAt: commandContext.now,
      deletedBy: actor.user_id,
      updatedAt: commandContext.now,
    }
  } else {
    const candidate = { ...previous }
    if (payload.type !== undefined) {
      const type = String(payload.type || '').trim()
      if (!type || type.length > 120 || (fixed && !FIXED_EXPENSE_TYPES.has(type))) {
        throw new ApiError(400, 'EXPENSE_TYPE_INVALID', 'Loại chi phí không hợp lệ.')
      }
      candidate.type = type
    }
    if (payload.amount !== undefined) candidate.amount = asVnd(payload.amount, 'Số tiền chi phí', { positive: true })
    if (payload.note !== undefined || payload.description !== undefined) {
      const note = String(payload.note ?? payload.description ?? '').trim()
      if (note.length > 1_000) throw new ApiError(400, 'NOTE_TOO_LONG', 'Ghi chú không được vượt quá 1.000 ký tự.')
      if (fixed) candidate.note = note
      else candidate.description = note
    }
    if (payload.occurredAt !== undefined) candidate.occurredAt = asOccurredAt(payload.occurredAt, previous.occurredAt)
    if (!fixed && payload.category !== undefined) {
      candidate.category = String(payload.category || '').trim().slice(0, 80) || 'other'
    }
    const businessFields = fixed
      ? ['type', 'amount', 'note', 'occurredAt']
      : ['type', 'category', 'amount', 'description', 'occurredAt']
    changedFields = businessFields.filter((key) => JSON.stringify(candidate[key]) !== JSON.stringify(previous[key]))
    if (!changedFields.length) {
      return recordNoopCommand(db, actor, {
        command: body.type,
        version: Number(current.version),
        expense: previous,
        expenseEntry: previousEntry,
        existing: true,
      }, 200, commandContext)
    }
    assertAccountingPeriodOpen(state, previous.storeId, String(candidate.occurredAt).slice(0, 7))
    next = { ...candidate, updatedAt: commandContext.now, updatedBy: actorSnapshot }
    nextEntry = {
      ...(previousEntry || {
        id: `exp_${crypto.randomUUID()}`,
        storeId: previous.storeId,
        sourceType: fixed ? 'fixed-expense' : 'manual-expense',
        sourceId: previous.id,
        recognized: true,
        createdAt: previous.createdAt || commandContext.now,
        createdBy: actor.user_id,
      }),
      type: next.type,
      category: fixed ? 'fixed' : next.category,
      amount: next.amount,
      description: fixed ? next.note : next.description,
      occurredAt: next.occurredAt,
      recognized: true,
      updatedAt: commandContext.now,
      updatedBy: actor.user_id,
    }
  }

  const nextExpenses = previousEntry
    ? expenses.map((entry) => String(entry.id || '') === String(previousEntry.id) ? nextEntry : entry)
    : [nextEntry, ...expenses]
  if (!fixed) next = nextEntry
  const nextState = {
    ...state,
    expenseEntries: nextExpenses,
    fixedExpenses: fixed
      ? fixedExpenses.map((record) => String(record.id || '') === entityId ? next : record)
      : fixedExpenses,
    payrollPeriods: invalidateClosedPayrollPeriods(state, [
      { storeId: previous.storeId, period: previousPeriod },
      { storeId: previous.storeId, period: monthFromRecord(next) },
    ], commandContext.now, body.type),
    stateVersion: Math.max(1, Number(state.stateVersion) || 1) + 1,
  }
  return commitGlobalStateDomainCommand(db, actor, current, nextState, {
    action: body.type,
    entityType: fixed ? 'fixed-expense' : 'expense',
    entityId,
    before: previous,
    after: next,
    metadata: { reason, changedFields, expenseEntryId: nextEntry.id },
    response: { command: body.type, expense: next, expenseEntry: nextEntry },
  }, commandContext)
}

const normalizeImportItems = (value) => {
  if (!Array.isArray(value) || value.length < 1 || value.length > 200) {
    throw new ApiError(400, 'IMPORT_ITEMS_INVALID', 'Phiếu nhập phải có từ 1 đến 200 mặt hàng.')
  }
  let goodsAmount = 0
  let shippingAmount = 0
  const items = value.map((item, index) => {
    if (!isPlainRecord(item)) throw new ApiError(400, 'IMPORT_ITEM_INVALID', `Mặt hàng thứ ${index + 1} không hợp lệ.`)
    const name = String(item.name || '').trim()
    const category = String(item.category || 'Khác').trim()
    const note = String(item.note || '').trim()
    const quantity = Number(item.quantity)
    const weight = Number(item.weight)
    const price = asVnd(item.price, `Đơn giá mặt hàng thứ ${index + 1}`, { positive: true })
    if (!name || name.length > 160 || !category || category.length > 120 || note.length > 500) {
      throw new ApiError(400, 'IMPORT_ITEM_INVALID', `Thông tin mặt hàng thứ ${index + 1} không hợp lệ.`)
    }
    if (!Number.isSafeInteger(quantity) || quantity <= 0 || quantity > 1_000_000) {
      throw new ApiError(400, 'IMPORT_QUANTITY_INVALID', `Số bao mặt hàng thứ ${index + 1} phải là số nguyên dương.`)
    }
    if (!Number.isFinite(weight) || weight <= 0 || weight > 1_000_000) {
      throw new ApiError(400, 'IMPORT_WEIGHT_INVALID', `Cân nặng mặt hàng thứ ${index + 1} phải là số dương.`)
    }
    const itemShippingAmount = asVnd(
      item.shippingAmount ?? item.shipping ?? 0,
      `Phí vận chuyển mặt hàng thứ ${index + 1}`,
    )
    const lineAmount = Math.round(weight * price)
    if (!Number.isSafeInteger(lineAmount) || lineAmount <= 0 || lineAmount > MAX_MONEY_VND) {
      throw new ApiError(400, 'IMPORT_TOTAL_INVALID', `Thành tiền mặt hàng thứ ${index + 1} không hợp lệ.`)
    }
    goodsAmount = safeMoneySum(goodsAmount, lineAmount, 'Tổng tiền hàng')
    shippingAmount = safeMoneySum(shippingAmount, itemShippingAmount, 'Tổng phí vận chuyển')
    if (goodsAmount > MAX_MONEY_VND) {
      throw new ApiError(400, 'IMPORT_TOTAL_INVALID', 'Tổng tiền hàng vượt quá giới hạn cho phép.')
    }
    return { name, category, quantity, weight, price, shippingAmount: itemShippingAmount, note, lineAmount }
  })
  return { items, goodsAmount, shippingAmount }
}

const importVoucherCommand = async (db, actor, body, commandContext) => {
  assertOperationsRole(actor, 'Tài khoản không có quyền quản lý phiếu nhập cửa hàng.')
  const payload = isPlainRecord(body.payload) ? body.payload : {}
  const operation = body.type.split('.').at(-1)
  if (!['create', 'update', 'delete'].includes(operation)) {
    throw new ApiError(400, 'COMMAND_UNKNOWN', 'Lệnh phiếu nhập không được hỗ trợ.')
  }
  const { current, state } = await loadGlobalCommandState(db, body)
  const vouchers = Array.isArray(state.importVouchers) ? state.importVouchers : []
  const expenses = Array.isArray(state.expenseEntries) ? state.expenseEntries : []
  const actorSnapshot = serverActorSnapshot(actor)

  if (operation === 'create') {
    const storeId = String(payload.storeId || '').trim()
    assertOperationalStoreAccess(actor, storeId)
    requireStore(state, storeId)
    const normalizedItems = normalizeImportItems(payload.items)
    const { items, goodsAmount } = normalizedItems
    const shippingAmount = asVnd(payload.shippingAmount ?? normalizedItems.shippingAmount, 'Phí vận chuyển')
    const relatedAmount = asVnd(payload.relatedAmount ?? 0, 'Chi phí liên quan')
    const totalAmount = safeMoneySum(safeMoneySum(goodsAmount, shippingAmount), relatedAmount)
    if (totalAmount <= 0 || totalAmount > MAX_MONEY_VND) {
      throw new ApiError(400, 'IMPORT_TOTAL_INVALID', 'Tổng giá trị phiếu nhập không hợp lệ.')
    }
    const counterName = 'system:imports'
    const counterRow = await first(db, `
      SELECT counter_name, counter_value, version FROM counters WHERE counter_name = ? LIMIT 1
    `, counterName)
    const historicalMax = vouchers.reduce((maximum, voucher) => {
      const match = String(voucher.code || '').match(/-(\d{4,5})$/u)
      return match ? Math.max(maximum, Number(match[1])) : maximum
    }, 0)
    const baseValue = Math.max(Number(counterRow?.counter_value || 0), historicalMax)
    if (!Number.isSafeInteger(baseValue) || baseValue >= 9_999) {
      throw new ApiError(409, 'IMPORT_COUNTER_EXHAUSTED', 'Dãy mã phiếu nhập đã hết.')
    }
    const nextValue = baseValue + 1
    const localNow = localDateTimeParts(commandContext.now)
    const [year, month, day] = localNow.date.split('-')
    const voucher = {
      id: `imp_${crypto.randomUUID()}`,
      code: `PN-${day}/${month}/${year.slice(-2)}-${String(nextValue).padStart(4, '0')}`,
      storeId,
      items,
      goodsAmount,
      shippingAmount,
      relatedAmount,
      totalAmount,
      status: 'Đã lưu',
      createdAt: commandContext.now,
      createdBy: actorSnapshot,
      updatedAt: commandContext.now,
      deletedAt: null,
    }
    const expense = {
      id: `exp_import_${voucher.id}`,
      storeId,
      type: 'Nhập hàng',
      category: 'inventory',
      amount: totalAmount,
      description: `Phiếu nhập ${voucher.code}`,
      sourceType: 'import-voucher',
      sourceId: voucher.id,
      recognized: true,
      occurredAt: commandContext.now,
      createdAt: commandContext.now,
      createdBy: actor.user_id,
    }
    const nextState = {
      ...state,
      importVouchers: [voucher, ...vouchers],
      expenseEntries: [expense, ...expenses],
      payrollPeriods: invalidateClosedPayrollPeriods(
        state,
        { storeId, period: monthFromRecord(voucher) },
        commandContext.now,
        body.type,
      ),
      stateVersion: Math.max(1, Number(state.stateVersion) || 1) + 1,
    }
    return commitGlobalStateCounterDomainCommand(db, actor, current, nextState, {
      name: counterName,
      row: counterRow,
      value: nextValue,
    }, {
      action: body.type,
      entityType: 'import-voucher',
      entityId: voucher.id,
      before: null,
      after: voucher,
      metadata: { storeId, code: voucher.code, counterValue: nextValue, expenseEntryId: expense.id },
      response: { command: body.type, voucher, expense },
      status: 201,
    }, commandContext)
  }

  const voucherId = String(payload.voucherId || payload.id || '').trim()
  const previous = vouchers.find((voucher) => String(voucher.id || '') === voucherId)
  if (!previous) throw new ApiError(404, 'IMPORT_NOT_FOUND', 'Không tìm thấy phiếu nhập.')
  assertOperationalStoreAccess(actor, previous.storeId)
  if (previous.deletedAt || previous.status === 'Đã xóa') {
    if (operation === 'delete') {
      return recordNoopCommand(db, actor, {
        command: body.type,
        version: Number(current.version),
        voucher: previous,
        existing: true,
      }, 200, commandContext)
    }
    throw new ApiError(409, 'IMPORT_DELETED', 'Phiếu nhập đã bị xóa.')
  }
  const reason = String(payload.reason || '').trim()
  if (!reason || reason.length > 500) {
    throw new ApiError(400, 'REASON_REQUIRED', 'Cần nhập lý do từ 1 đến 500 ký tự.')
  }
  assertAccountingPeriodOpen(state, previous.storeId, monthFromRecord(previous))
  const previousExpense = expenses.find((entry) => sourceMatch(entry, 'import-voucher', previous.id))
  let next
  let nextExpense
  let changedFields
  if (operation === 'delete') {
    changedFields = ['status', 'deletedAt']
    next = {
      ...previous,
      status: 'Đã xóa',
      deletedAt: commandContext.now,
      deletedBy: actorSnapshot,
      updatedAt: commandContext.now,
    }
    nextExpense = {
      ...(previousExpense || {
        id: `exp_import_${previous.id}`,
        storeId: previous.storeId,
        type: 'Nhập hàng',
        category: 'inventory',
        amount: Number(previous.totalAmount || 0),
        description: `Phiếu nhập ${previous.code}`,
        sourceType: 'import-voucher',
        sourceId: previous.id,
        occurredAt: previous.createdAt,
        createdAt: previous.createdAt,
      }),
      recognized: false,
      voidedAt: commandContext.now,
      deletedAt: commandContext.now,
      deletedBy: actor.user_id,
      updatedAt: commandContext.now,
    }
  } else {
    const normalized = payload.items === undefined
      ? {
          items: previous.items,
          goodsAmount: Number(previous.goodsAmount || 0),
          shippingAmount: Number(previous.shippingAmount || 0),
        }
      : normalizeImportItems(payload.items)
    const shippingAmount = payload.shippingAmount === undefined
      ? asVnd(normalized.shippingAmount ?? previous.shippingAmount ?? 0, 'Phí vận chuyển')
      : asVnd(payload.shippingAmount, 'Phí vận chuyển')
    const relatedAmount = payload.relatedAmount === undefined
      ? asVnd(previous.relatedAmount || 0, 'Chi phí liên quan')
      : asVnd(payload.relatedAmount, 'Chi phí liên quan')
    const totalAmount = safeMoneySum(safeMoneySum(normalized.goodsAmount, shippingAmount), relatedAmount)
    if (totalAmount <= 0 || totalAmount > MAX_MONEY_VND) {
      throw new ApiError(400, 'IMPORT_TOTAL_INVALID', 'Tổng giá trị phiếu nhập không hợp lệ.')
    }
    const candidate = {
      ...previous,
      items: normalized.items,
      goodsAmount: normalized.goodsAmount,
      shippingAmount,
      relatedAmount,
      totalAmount,
    }
    changedFields = ['items', 'goodsAmount', 'shippingAmount', 'relatedAmount', 'totalAmount']
      .filter((key) => JSON.stringify(candidate[key]) !== JSON.stringify(previous[key]))
    if (!changedFields.length) {
      return recordNoopCommand(db, actor, {
        command: body.type,
        version: Number(current.version),
        voucher: previous,
        expense: previousExpense,
        existing: true,
      }, 200, commandContext)
    }
    next = { ...candidate, updatedAt: commandContext.now, updatedBy: actorSnapshot }
    nextExpense = {
      ...(previousExpense || {
        id: `exp_import_${previous.id}`,
        storeId: previous.storeId,
        type: 'Nhập hàng',
        category: 'inventory',
        description: `Phiếu nhập ${previous.code}`,
        sourceType: 'import-voucher',
        sourceId: previous.id,
        recognized: true,
        occurredAt: previous.createdAt,
        createdAt: previous.createdAt,
        createdBy: actor.user_id,
      }),
      amount: totalAmount,
      recognized: true,
      updatedAt: commandContext.now,
      updatedBy: actor.user_id,
    }
  }
  const nextExpenses = previousExpense
    ? expenses.map((entry) => String(entry.id || '') === String(previousExpense.id) ? nextExpense : entry)
    : [nextExpense, ...expenses]
  const nextState = {
    ...state,
    importVouchers: vouchers.map((voucher) => String(voucher.id || '') === voucherId ? next : voucher),
    expenseEntries: nextExpenses,
    payrollPeriods: invalidateClosedPayrollPeriods(
      state,
      { storeId: previous.storeId, period: monthFromRecord(previous) },
      commandContext.now,
      body.type,
    ),
    stateVersion: Math.max(1, Number(state.stateVersion) || 1) + 1,
  }
  return commitGlobalStateDomainCommand(db, actor, current, nextState, {
    action: body.type,
    entityType: 'import-voucher',
    entityId: voucherId,
    before: previous,
    after: next,
    metadata: { reason, changedFields, expenseEntryId: nextExpense.id },
    response: { command: body.type, voucher: next, expense: nextExpense },
  }, commandContext)
}

const assertPayrollNotPaidOrLocked = (state, storeId, period) => {
  const payroll = payrollPeriodFor(state, storeId, period)
  if (payroll?.lockedAt || payroll?.status === 'Đã khóa') {
    throw new ApiError(409, 'PAYROLL_PERIOD_LOCKED', 'Kỳ lương đã khóa.')
  }
  if (payroll?.confirmedAt || payroll?.status === 'Đã chi') {
    throw new ApiError(409, 'PAYROLL_PERIOD_PAID', 'Kỳ lương đã chi; không thể thay đổi.')
  }
  return payroll
}

const SALARY_ADJUSTMENT_TYPES = new Set(['Thưởng khác', 'Phụ cấp khác', 'Khấu trừ'])

const salaryAdjustmentCommand = async (db, actor, body, commandContext) => {
  assertOperationsRole(actor, 'Tài khoản không có quyền tạo khoản điều chỉnh lương cửa hàng.')
  if (body.type !== 'salary_adjustment.create') {
    throw new ApiError(400, 'COMMAND_UNKNOWN', 'Lệnh điều chỉnh lương không được hỗ trợ.')
  }
  const payload = isPlainRecord(body.payload) ? body.payload : {}
  const { current, state } = await loadGlobalCommandState(db, body)
  const employeeId = String(payload.employeeId || '').trim()
  const employee = (Array.isArray(state.employees) ? state.employees : [])
    .find((record) => String(record.id || record.code || '') === employeeId && !record.deletedAt)
  const status = normalizeTextKey(employee?.status)
  if (!employee || ['da nghi viec', 'tam ngung', 'inactive', 'locked'].includes(status)) {
    throw new ApiError(400, 'EMPLOYEE_INVALID', 'Nhân viên không hợp lệ.')
  }
  const storeId = String(employee.storeId || '').trim()
  if (employeeUnit(employee) === 'store_manager') {
    throw new ApiError(400, 'EMPLOYEE_INVALID', 'Quản lý cửa hàng không tham gia bảng lương nhân viên cửa hàng.')
  }
  assertOperationalStoreAccess(actor, storeId)
  const period = asMonth(payload.period)
  requirePayrollUnit(state, storeId)
  assertPayrollNotPaidOrLocked(state, storeId, period)
  const type = String(payload.type || '').trim()
  if (!SALARY_ADJUSTMENT_TYPES.has(type)) {
    throw new ApiError(400, 'SALARY_ADJUSTMENT_TYPE_INVALID', 'Loại điều chỉnh lương không hợp lệ.')
  }
  const amount = asVnd(payload.amount, 'Số tiền điều chỉnh', { positive: true })
  const note = String(payload.note || '').trim()
  if (note.length > 1_000) throw new ApiError(400, 'NOTE_TOO_LONG', 'Ghi chú không được vượt quá 1.000 ký tự.')
  const adjustment = {
    id: `adj_${crypto.randomUUID()}`,
    employeeId,
    employeeName: employee.name || employee.displayName || employeeId,
    storeId,
    period,
    type,
    amount,
    note,
    status: 'Đã tạo',
    createdAt: commandContext.now,
    createdBy: serverActorSnapshot(actor),
    deletedAt: null,
  }
  const nextState = {
    ...state,
    salaryAdjustments: [adjustment, ...(Array.isArray(state.salaryAdjustments) ? state.salaryAdjustments : [])],
    payrollPeriods: invalidateClosedPayrollPeriods(
      state,
      { storeId, period },
      commandContext.now,
      body.type,
    ),
    stateVersion: Math.max(1, Number(state.stateVersion) || 1) + 1,
  }
  return commitGlobalStateDomainCommand(db, actor, current, nextState, {
    action: body.type,
    entityType: 'salary-adjustment',
    entityId: adjustment.id,
    before: null,
    after: adjustment,
    metadata: { storeId, period, employeeId, type },
    response: { command: body.type, adjustment },
    status: 201,
  }, commandContext)
}

const salaryAdvanceCommand = async (db, actor, body, commandContext) => {
  assertOperationsRole(actor, 'Tài khoản không có quyền quản lý ứng lương cửa hàng.')
  const payload = isPlainRecord(body.payload) ? body.payload : {}
  const operation = body.type.split('.').at(-1)
  if (!['create', 'update', 'confirm'].includes(operation)) {
    throw new ApiError(400, 'COMMAND_UNKNOWN', 'Lệnh ứng lương không được hỗ trợ.')
  }
  const { current, state } = await loadGlobalCommandState(db, body)
  const advances = Array.isArray(state.salaryAdvances) ? state.salaryAdvances : []
  const actorSnapshot = serverActorSnapshot(actor)

  if (operation === 'create') {
    const employeeId = String(payload.employeeId || '').trim()
    const employee = (Array.isArray(state.employees) ? state.employees : [])
      .find((record) => String(record.id || record.code || '') === employeeId && !record.deletedAt)
    if (!employee || normalizeTextKey(employee.status) === 'da nghi viec') {
      throw new ApiError(400, 'EMPLOYEE_INVALID', 'Nhân viên không hợp lệ.')
    }
    if (employeeUnit(employee) === 'store_manager') {
      throw new ApiError(400, 'EMPLOYEE_INVALID', 'Quản lý cửa hàng không tham gia bảng lương nhân viên cửa hàng.')
    }
    const period = asMonth(payload.period)
    const storeId = String(employee.storeId || '')
    assertOperationalStoreAccess(actor, storeId)
    requirePayrollUnit(state, storeId)
    assertPayrollNotPaidOrLocked(state, storeId, period)
    const snapshot = await calculatePayrollSnapshot(db, state, storeId, period)
    const payrollRow = snapshot.rows.find((row) => row.employeeId === employeeId)
    const available = Number(payrollRow?.remaining || 0)
    const amount = asVnd(payload.amount, 'Số tiền ứng', { positive: true })
    if (amount >= available) {
      throw new ApiError(409, 'SALARY_ADVANCE_TOO_HIGH', 'Số tiền ứng phải nhỏ hơn lương khả dụng.', { availableSalary: available })
    }
    const note = String(payload.note || '').trim()
    if (note.length > 1_000) throw new ApiError(400, 'NOTE_TOO_LONG', 'Ghi chú không được vượt quá 1.000 ký tự.')
    const advance = {
      id: `adv_${crypto.randomUUID()}`,
      employeeId,
      employeeName: employee.name || employee.displayName || employeeId,
      storeId,
      period,
      amount,
      availableAtCreation: available,
      availableSalaryAtCreation: available,
      remainingAfter: available - amount,
      remainingSalaryAfterAdvance: available - amount,
      note,
      status: 'Mới tạo',
      createdAt: commandContext.now,
      createdBy: actorSnapshot,
      confirmedAt: null,
      confirmedBy: null,
      deletedAt: null,
    }
    const nextState = {
      ...state,
      salaryAdvances: [advance, ...advances],
      stateVersion: Math.max(1, Number(state.stateVersion) || 1) + 1,
    }
    return commitGlobalStateDomainCommand(db, actor, current, nextState, {
      action: body.type,
      entityType: 'salary-advance',
      entityId: advance.id,
      before: null,
      after: advance,
      metadata: { employeeId, storeId, period, availableSalary: available },
      response: { command: body.type, advance },
      status: 201,
    }, commandContext)
  }

  const advanceId = String(payload.advanceId || payload.id || '').trim()
  const previous = advances.find((advance) => String(advance.id || '') === advanceId && !advance.deletedAt)
  if (!previous) throw new ApiError(404, 'SALARY_ADVANCE_NOT_FOUND', 'Không tìm thấy khoản ứng lương.')
  assertOperationalStoreAccess(actor, previous.storeId)
  if (previous.status !== 'Mới tạo') {
    throw new ApiError(409, 'SALARY_ADVANCE_IMMUTABLE', 'Chỉ khoản ứng mới tạo mới được thay đổi hoặc xác nhận.')
  }
  const period = asMonth(previous.period)
  assertPayrollNotPaidOrLocked(state, previous.storeId, period)
  const snapshot = await calculatePayrollSnapshot(db, state, previous.storeId, period)
  const payrollRow = snapshot.rows.find((row) => row.employeeId === String(previous.employeeId))
  const available = Number(payrollRow?.remaining || 0)

  if (operation === 'update') {
    const amount = payload.amount === undefined
      ? asVnd(previous.amount, 'Số tiền ứng', { positive: true })
      : asVnd(payload.amount, 'Số tiền ứng', { positive: true })
    if (amount >= available) {
      throw new ApiError(409, 'SALARY_ADVANCE_TOO_HIGH', 'Số tiền ứng phải nhỏ hơn lương khả dụng.', { availableSalary: available })
    }
    const note = payload.note === undefined ? previous.note : String(payload.note || '').trim()
    if (note.length > 1_000) throw new ApiError(400, 'NOTE_TOO_LONG', 'Ghi chú không được vượt quá 1.000 ký tự.')
    const changedFields = ['amount', 'note'].filter((key) => (
      key === 'amount' ? amount !== Number(previous.amount) : note !== String(previous.note || '')
    ))
    if (!changedFields.length) {
      return recordNoopCommand(db, actor, {
        command: body.type,
        version: Number(current.version),
        advance: previous,
        existing: true,
      }, 200, commandContext)
    }
    const next = {
      ...previous,
      amount,
      note,
      remainingAfter: available - amount,
      remainingSalaryAfterAdvance: available - amount,
      updatedAt: commandContext.now,
      updatedBy: actorSnapshot,
    }
    const nextState = {
      ...state,
      salaryAdvances: advances.map((advance) => String(advance.id || '') === advanceId ? next : advance),
      stateVersion: Math.max(1, Number(state.stateVersion) || 1) + 1,
    }
    return commitGlobalStateDomainCommand(db, actor, current, nextState, {
      action: body.type,
      entityType: 'salary-advance',
      entityId: advanceId,
      before: previous,
      after: next,
      metadata: { changedFields, availableSalary: available },
      response: { command: body.type, advance: next },
    }, commandContext)
  }

  const amount = asVnd(previous.amount, 'Số tiền ứng', { positive: true })
  if (amount >= available) {
    throw new ApiError(409, 'SALARY_ADVANCE_TOO_HIGH', 'Lương khả dụng đã thay đổi; cần điều chỉnh khoản ứng.', { availableSalary: available })
  }
  const expenseEntries = Array.isArray(state.expenseEntries) ? state.expenseEntries : []
  const cashTransactions = Array.isArray(state.cashTransactions) ? state.cashTransactions : []
  if (expenseEntries.some((entry) => sourceMatch(entry, 'salary-advance', advanceId))
    || cashTransactions.some((entry) => sourceMatch(entry, 'salary-advance', advanceId))) {
    throw new ApiError(409, 'SALARY_ADVANCE_FINANCE_EXISTS', 'Khoản ứng đã có bút toán tài chính.')
  }
  const confirmed = {
    ...previous,
    status: 'Đã chi',
    confirmedAt: commandContext.now,
    confirmedBy: actorSnapshot,
    availableAtConfirmation: available,
    remainingAfter: available - amount,
    remainingSalaryAfterPayment: available - amount,
    updatedAt: commandContext.now,
  }
  const transaction = {
    id: `txn_advance_${advanceId}`,
    storeId: previous.storeId,
    employeeId: previous.employeeId,
    type: 'Ứng lương',
    direction: 'out',
    amount,
    sourceType: 'salary-advance',
    sourceId: advanceId,
    occurredAt: commandContext.now,
    createdAt: commandContext.now,
    actor: actorSnapshot,
  }
  const expense = {
    id: `exp_advance_${advanceId}`,
    storeId: previous.storeId,
    employeeId: previous.employeeId,
    type: 'Ứng lương',
    category: 'payroll',
    amount,
    description: `Ứng lương ${previous.employeeName}`,
    sourceType: 'salary-advance',
    sourceId: advanceId,
    recognized: true,
    occurredAt: commandContext.now,
    createdAt: commandContext.now,
    createdBy: actor.user_id,
  }
  const nextState = {
    ...state,
    salaryAdvances: advances.map((advance) => String(advance.id || '') === advanceId ? confirmed : advance),
    payrollPeriods: invalidateClosedPayrollPeriods(
      state,
      { storeId: previous.storeId, period },
      commandContext.now,
      body.type,
    ),
    expenseEntries: [expense, ...expenseEntries],
    cashTransactions: [transaction, ...cashTransactions],
    stateVersion: Math.max(1, Number(state.stateVersion) || 1) + 1,
  }
  return commitGlobalStateDomainCommand(db, actor, current, nextState, {
    action: body.type,
    entityType: 'salary-advance',
    entityId: advanceId,
    before: previous,
    after: confirmed,
    metadata: { availableSalary: available, expenseId: expense.id, transactionId: transaction.id },
    response: { command: body.type, advance: confirmed, expense, transaction },
  }, commandContext)
}

const payrollCommand = async (db, actor, body, commandContext) => {
  assertOperationsRole(actor, 'Tài khoản không có quyền xử lý kỳ lương cửa hàng.')
  const payload = isPlainRecord(body.payload) ? body.payload : {}
  const operation = body.type.split('.').at(-1)
  if (!['close', 'pay', 'lock'].includes(operation)) {
    throw new ApiError(400, 'COMMAND_UNKNOWN', 'Lệnh kỳ lương không được hỗ trợ.')
  }
  const { current, state } = await loadGlobalCommandState(db, body)
  const storeId = String(payload.storeId || '').trim()
  assertOperationalStoreAccess(actor, storeId)
  const period = asMonth(payload.period)
  requirePayrollUnit(state, storeId)
  const periods = Array.isArray(state.payrollPeriods) ? state.payrollPeriods : []
  const existing = payrollPeriodFor(state, storeId, period)
  const actorSnapshot = serverActorSnapshot(actor)

  if (operation === 'close') {
    if (existing?.lockedAt || existing?.status === 'Đã khóa') {
      throw new ApiError(409, 'PAYROLL_PERIOD_LOCKED', 'Kỳ lương đã khóa.')
    }
    if (existing?.confirmedAt || existing?.status === 'Đã chi') {
      throw new ApiError(409, 'PAYROLL_PERIOD_PAID', 'Kỳ lương đã chi; không thể chốt lại.')
    }
    const snapshot = await calculatePayrollSnapshot(db, state, storeId, period)
    const next = {
      id: existing?.id || `pyr_${crypto.randomUUID()}`,
      storeId,
      period,
      ...snapshot,
      status: 'Đã chốt',
      closedAt: commandContext.now,
      closedBy: actorSnapshot,
      confirmedAt: null,
      confirmedBy: null,
      lockedAt: null,
      lockedBy: null,
      needsReclose: false,
    }
    const nextState = {
      ...state,
      payrollPeriods: [next, ...periods.filter((record) => !(
        String(record.storeId || '') === storeId && String(record.period || '') === period
      ))],
      stateVersion: Math.max(1, Number(state.stateVersion) || 1) + 1,
    }
    return commitGlobalStateDomainCommand(db, actor, current, nextState, {
      action: body.type,
      entityType: 'payroll-period',
      entityId: next.id,
      before: existing || null,
      after: next,
      metadata: { storeId, period, rowCount: next.rows.length },
      response: { command: body.type, period: next },
      status: existing ? 200 : 201,
    }, commandContext)
  }

  if (!existing) throw new ApiError(404, 'PAYROLL_PERIOD_NOT_FOUND', 'Cần chốt sổ kỳ lương trước.')
  if (operation === 'lock') {
    if (existing.status === 'Đã khóa' || existing.lockedAt) {
      return recordNoopCommand(db, actor, {
        command: body.type,
        version: Number(current.version),
        period: existing,
        existing: true,
      }, 200, commandContext)
    }
    if (!existing.confirmedAt || existing.status !== 'Đã chi') {
      throw new ApiError(409, 'PAYROLL_NOT_PAID', 'Chỉ được khóa kỳ lương sau khi đã chi.')
    }
    const locked = {
      ...existing,
      status: 'Đã khóa',
      lockedAt: commandContext.now,
      lockedBy: actorSnapshot,
      updatedAt: commandContext.now,
    }
    const nextState = {
      ...state,
      payrollPeriods: periods.map((record) => String(record.id || '') === String(existing.id) ? locked : record),
      stateVersion: Math.max(1, Number(state.stateVersion) || 1) + 1,
    }
    return commitGlobalStateDomainCommand(db, actor, current, nextState, {
      action: body.type,
      entityType: 'payroll-period',
      entityId: existing.id,
      before: existing,
      after: locked,
      metadata: { storeId, period },
      response: { command: body.type, period: locked },
    }, commandContext)
  }

  if (existing.lockedAt || existing.status === 'Đã khóa') {
    throw new ApiError(409, 'PAYROLL_PERIOD_LOCKED', 'Kỳ lương đã khóa.')
  }
  if (existing.needsReclose) {
    throw new ApiError(409, 'PAYROLL_NEEDS_RECLOSE', 'Số liệu trong kỳ đã thay đổi; cần chốt sổ lại trước khi chi.')
  }
  if (existing.confirmedAt || existing.status === 'Đã chi') {
    return recordNoopCommand(db, actor, {
      command: body.type,
      version: Number(current.version),
      period: existing,
      payments: (Array.isArray(state.payrollPayments) ? state.payrollPayments : [])
        .filter((payment) => (
          String(payment.periodId || '') === String(existing.id)
          || (String(payment.storeId || '') === storeId && String(payment.period || '') === period)
        )),
      existing: true,
    }, 200, commandContext)
  }
  if (existing.status !== 'Đã chốt' || !Array.isArray(existing.rows)) {
    throw new ApiError(409, 'PAYROLL_NOT_CLOSED', 'Kỳ lương chưa có bản chốt hợp lệ.')
  }
  const existingPayments = Array.isArray(state.payrollPayments) ? state.payrollPayments : []
  const expenses = Array.isArray(state.expenseEntries) ? state.expenseEntries : []
  const transactions = Array.isArray(state.cashTransactions) ? state.cashTransactions : []
  const payments = []
  const paymentExpenses = []
  const paymentTransactions = []
  const paidEmployeeIds = new Set()
  for (const row of existing.rows) {
    const amount = asVnd(row.remaining ?? 0, 'Số tiền chi lương')
    if (amount === 0) continue
    const employeeId = String(row.employeeId || '').trim()
    if (!employeeId) throw new ApiError(409, 'PAYROLL_ROW_INVALID', 'Dòng lương thiếu mã nhân viên.')
    if (paidEmployeeIds.has(employeeId)) {
      throw new ApiError(409, 'PAYROLL_ROW_DUPLICATE', 'Bản chốt lương có nhân viên bị trùng.')
    }
    paidEmployeeIds.add(employeeId)
    if (existingPayments.some((payment) => (
      (String(payment.periodId || '') === String(existing.id)
        || (String(payment.storeId || '') === storeId && String(payment.period || '') === period))
      && String(payment.employeeId || '') === employeeId
    ))) {
      throw new ApiError(409, 'PAYROLL_PAYMENT_EXISTS', 'Kỳ lương đã có bản ghi chi trả không nhất quán.')
    }
    const payment = {
      id: `pay_${existing.id}_${employeeId}`,
      periodId: existing.id,
      storeId,
      period,
      employeeId,
      employeeName: row.employeeName || employeeId,
      amount,
      type: 'Lương nhân viên',
      createdAt: commandContext.now,
      actor: actorSnapshot,
    }
    if (expenses.some((entry) => sourceMatch(entry, 'payroll-payment', payment.id))
      || transactions.some((entry) => sourceMatch(entry, 'payroll-payment', payment.id))) {
      throw new ApiError(409, 'PAYROLL_FINANCE_EXISTS', 'Bút toán chi lương đã tồn tại không nhất quán.')
    }
    payments.push(payment)
    paymentExpenses.push({
      id: `exp_${payment.id}`,
      storeId,
      employeeId,
      type: payment.type,
      category: 'payroll',
      amount,
      description: `${payment.type} kỳ ${period}`,
      sourceType: 'payroll-payment',
      sourceId: payment.id,
      recognized: true,
      occurredAt: commandContext.now,
      createdAt: commandContext.now,
      createdBy: actor.user_id,
    })
    paymentTransactions.push({
      id: `txn_${payment.id}`,
      storeId,
      employeeId,
      type: payment.type,
      direction: 'out',
      amount,
      sourceType: 'payroll-payment',
      sourceId: payment.id,
      occurredAt: commandContext.now,
      createdAt: commandContext.now,
      actor: actorSnapshot,
    })
  }
  const paid = {
    ...existing,
    status: 'Đã chi',
    confirmedAt: commandContext.now,
    confirmedBy: actorSnapshot,
    updatedAt: commandContext.now,
  }
  const nextState = {
    ...state,
    payrollPeriods: periods.map((record) => String(record.id || '') === String(existing.id) ? paid : record),
    payrollPayments: [...payments, ...existingPayments],
    expenseEntries: [...paymentExpenses, ...expenses],
    cashTransactions: [...paymentTransactions, ...transactions],
    stateVersion: Math.max(1, Number(state.stateVersion) || 1) + 1,
  }
  return commitGlobalStateDomainCommand(db, actor, current, nextState, {
    action: body.type,
    entityType: 'payroll-period',
    entityId: existing.id,
    before: existing,
    after: paid,
    metadata: { storeId, period, paymentIds: payments.map((payment) => payment.id) },
    response: { command: body.type, period: paid, payments },
  }, commandContext)
}

const policyCommand = async (db, user, body, commandContext) => {
  if (!['admin', 'business_support'].includes(user.role)) {
    throw new ApiError(403, 'ROLE_FORBIDDEN', 'Chỉ Admin hoặc Nhân viên hỗ trợ KD được thay đổi chính sách.')
  }
  const payload = isPlainRecord(body.payload) ? body.payload : {}
  const key = String(payload.key || '')
  const value = validatePolicy(key, payload.value)
  const expectedVersion = validateExpectedVersion(body.expectedVersion)
  const current = await first(db, `
    SELECT policy_key, value_json, version, effective_at, updated_at, updated_by
    FROM policies WHERE policy_key = ? LIMIT 1
  `, key)
  const currentVersion = Number(current?.version || 0)
  if (currentVersion !== expectedVersion) {
    throw new ApiError(409, 'VERSION_CONFLICT', 'Chính sách đã thay đổi trên máy chủ.', { currentVersion })
  }
  const nextVersion = currentVersion + 1
  const valueJson = JSON.stringify(value)
  const effectiveAt = commandContext.now
  const responseBody = apiPayload(commandContext, {
    command: body.type,
    policy: { key, value, version: nextVersion, effectiveAt, updatedAt: commandContext.now },
  })
  const responseJson = JSON.stringify(responseBody)
  const mutation = current
    ? db.prepare(`
        UPDATE policies
        SET value_json = ?, version = ?, effective_at = ?, updated_at = ?, updated_by = ?, last_request_id = ?
        WHERE policy_key = ? AND version = ?
      `).bind(
        valueJson,
        nextVersion,
        effectiveAt,
        commandContext.now,
        user.user_id,
        commandContext.requestId,
        key,
        currentVersion,
      )
    : db.prepare(`
        INSERT OR IGNORE INTO policies (
          policy_key, value_json, version, effective_at, updated_at, updated_by, last_request_id
        ) VALUES (?, ?, 1, ?, ?, ?, ?)
      `).bind(key, valueJson, effectiveAt, commandContext.now, user.user_id, commandContext.requestId)

  const results = await db.batch([
    mutation,
    db.prepare(`
      INSERT INTO audit_log (
        request_id, actor_id, actor_role, action, entity_type, entity_id,
        before_json, after_json, metadata_json, server_timestamp
      )
      SELECT ?, ?, ?, 'policy.set', 'policy', ?, ?, ?, ?, ?
      WHERE EXISTS (
        SELECT 1 FROM policies WHERE policy_key = ? AND version = ? AND last_request_id = ?
      )
    `).bind(
      commandContext.requestId,
      user.user_id,
      user.role,
      key,
      current?.value_json || null,
      valueJson,
      JSON.stringify({ fromVersion: currentVersion, toVersion: nextVersion, effectiveAt }),
      commandContext.now,
      key,
      nextVersion,
      commandContext.requestId,
    ),
    db.prepare(`
      INSERT INTO command_receipts (
        actor_id, idempotency_key, request_hash, response_json, status_code, created_at
      )
      SELECT ?, ?, ?, ?, 200, ?
      WHERE EXISTS (
        SELECT 1 FROM policies WHERE policy_key = ? AND version = ? AND last_request_id = ?
      )
    `).bind(
      user.user_id,
      commandContext.idempotencyKey,
      commandContext.hash,
      responseJson,
      commandContext.now,
      key,
      nextVersion,
      commandContext.requestId,
    ),
  ])
  if (changes(results?.[0]) !== 1) {
    const latest = await first(db, 'SELECT version FROM policies WHERE policy_key = ?', key)
    throw new ApiError(409, 'VERSION_CONFLICT', 'Chính sách đã thay đổi trên máy chủ.', {
      currentVersion: Number(latest?.version || 0),
    })
  }
  return jsonResponse(responseBody)
}

const policiesCommand = async (db, user, body, commandContext) => {
  if (!['admin', 'business_support'].includes(user.role)) {
    throw new ApiError(403, 'ROLE_FORBIDDEN', 'Chỉ Admin hoặc Nhân viên hỗ trợ KD được thay đổi chính sách.')
  }
  const payload = isPlainRecord(body.payload) ? body.payload : {}
  const updates = Array.isArray(payload.updates) ? payload.updates : []
  if (!updates.length || updates.length > Object.keys(DEFAULT_POLICIES).length) {
    throw new ApiError(400, 'POLICY_BATCH_INVALID', 'Danh sách chính sách cần cập nhật không hợp lệ.')
  }
  const keys = updates.map((update) => String(update?.key || ''))
  if (new Set(keys).size !== keys.length) {
    throw new ApiError(400, 'POLICY_BATCH_DUPLICATE', 'Mỗi chính sách chỉ được xuất hiện một lần trong lệnh.')
  }
  const normalized = updates.map((update, index) => ({
    key: keys[index],
    value: validatePolicy(keys[index], update?.value),
    expectedVersion: validateExpectedVersion(update?.expectedVersion),
  }))
  const currentRows = await Promise.all(normalized.map(({ key }) => first(db, `
    SELECT policy_key, value_json, version, effective_at, updated_at, updated_by
    FROM policies WHERE policy_key = ? LIMIT 1
  `, key)))
  const conflict = normalized.find((update, index) => Number(currentRows[index]?.version || 0) !== update.expectedVersion)
  if (conflict) {
    const index = normalized.indexOf(conflict)
    throw new ApiError(409, 'VERSION_CONFLICT', 'Một chính sách đã thay đổi trên máy chủ.', {
      key: conflict.key,
      currentVersion: Number(currentRows[index]?.version || 0),
    })
  }
  const after = normalized.map((update) => ({
    key: update.key,
    value: update.value,
    version: update.expectedVersion + 1,
    effectiveAt: commandContext.now,
    updatedAt: commandContext.now,
    updatedBy: user.user_id,
  }))
  const responseBody = apiPayload(commandContext, { command: body.type, policies: after })
  const statements = normalized.map((update, index) => {
    const current = currentRows[index]
    return current
      ? db.prepare(`
          UPDATE policies
          SET value_json = ?, version = ?, effective_at = ?, updated_at = ?, updated_by = ?, last_request_id = ?
          WHERE policy_key = ? AND version = ?
        `).bind(
          JSON.stringify(update.value),
          update.expectedVersion + 1,
          commandContext.now,
          commandContext.now,
          user.user_id,
          commandContext.requestId,
          update.key,
          update.expectedVersion,
        )
      : db.prepare(`
          INSERT OR IGNORE INTO policies (
            policy_key, value_json, version, effective_at, updated_at, updated_by, last_request_id
          ) VALUES (?, ?, 1, ?, ?, ?, ?)
        `).bind(
          update.key,
          JSON.stringify(update.value),
          commandContext.now,
          commandContext.now,
          user.user_id,
          commandContext.requestId,
        )
  })
  const placeholders = normalized.map(() => '?').join(', ')
  const guardBindings = [...keys, commandContext.requestId, normalized.length]
  statements.push(
    db.prepare(`
      INSERT INTO audit_log (
        request_id, actor_id, actor_role, action, entity_type, entity_id,
        before_json, after_json, metadata_json, server_timestamp
      )
      SELECT ?, ?, ?, 'policies.set', 'policy-set', 'global', ?, ?, ?, ?
      WHERE (
        SELECT COUNT(*) FROM policies
        WHERE policy_key IN (${placeholders}) AND last_request_id = ?
      ) = ?
    `).bind(
      commandContext.requestId,
      user.user_id,
      user.role,
      JSON.stringify(currentRows.map((row) => row ? {
        key: row.policy_key,
        value: parseStoredJson(row.value_json),
        version: Number(row.version),
      } : null)),
      JSON.stringify(after),
      JSON.stringify({ atomic: true, count: normalized.length }),
      commandContext.now,
      ...guardBindings,
    ),
    db.prepare(`
      INSERT INTO command_receipts (
        actor_id, idempotency_key, request_hash, response_json, status_code, created_at
      ) VALUES (
        ?, ?,
        (SELECT ? WHERE (
          SELECT COUNT(*) FROM policies
          WHERE policy_key IN (${placeholders}) AND last_request_id = ?
        ) = ?),
        ?, 200, ?
      )
    `).bind(
      user.user_id,
      commandContext.idempotencyKey,
      commandContext.hash,
      ...guardBindings,
      JSON.stringify(responseBody),
      commandContext.now,
    ),
  )
  let results
  try {
    results = await db.batch(statements)
  } catch {
    const latest = await Promise.all(keys.map((key) => first(db, 'SELECT version FROM policies WHERE policy_key = ?', key)))
    throw new ApiError(409, 'VERSION_CONFLICT', 'Một chính sách đã thay đổi trên máy chủ.', {
      versions: Object.fromEntries(keys.map((key, index) => [key, Number(latest[index]?.version || 0)])),
    })
  }
  if (results.slice(0, normalized.length).some((result) => changes(result) !== 1)) {
    throw new ApiError(409, 'VERSION_CONFLICT', 'Một chính sách đã thay đổi trên máy chủ.')
  }
  return jsonResponse(responseBody)
}

const counterCommand = async (db, user, body, commandContext) => {
  if (user.role !== 'admin') {
    throw new ApiError(403, 'ROLE_FORBIDDEN', 'Bộ đếm kỹ thuật chỉ dành cho quản trị viên.')
  }
  const payload = isPlainRecord(body.payload) ? body.payload : {}
  const name = String(payload.name || '')
  if (!canUseCounter(user, name)) throw new ApiError(403, 'COUNTER_FORBIDDEN', 'Bạn không có quyền sử dụng bộ đếm này.')
  const counterKind = String(name.split(':').at(-1) || '').toLocaleLowerCase('vi-VN')
  if (['orders', 'imports'].includes(counterKind)) {
    throw new ApiError(400, 'DOMAIN_COMMAND_REQUIRED', 'Mã nghiệp vụ chỉ được sinh trong lệnh tạo bản ghi tương ứng.')
  }
  const expectedVersion = validateExpectedVersion(body.expectedVersion)
  const current = await first(db, `
    SELECT counter_name, counter_value, version FROM counters WHERE counter_name = ? LIMIT 1
  `, name)
  const currentVersion = Number(current?.version || 0)
  if (currentVersion !== expectedVersion) {
    throw new ApiError(409, 'VERSION_CONFLICT', 'Bộ đếm đã thay đổi trên máy chủ.', { currentVersion })
  }
  const currentValue = Number(current?.counter_value || 0)
  if (!Number.isSafeInteger(currentValue) || currentValue >= 99_999) {
    throw new ApiError(409, 'COUNTER_EXHAUSTED', 'Bộ đếm đã vượt giới hạn an toàn.')
  }
  const nextValue = currentValue + 1
  const nextVersion = currentVersion + 1
  const code = serverCounterCode(name, nextValue, commandContext.now)
  const responseBody = apiPayload(commandContext, {
    command: body.type,
    counter: { name, value: nextValue, version: nextVersion, code },
  })
  const responseJson = JSON.stringify(responseBody)
  const mutation = current
    ? db.prepare(`
        UPDATE counters
        SET counter_value = ?, version = ?, updated_at = ?, last_request_id = ?
        WHERE counter_name = ? AND version = ?
      `).bind(nextValue, nextVersion, commandContext.now, commandContext.requestId, name, currentVersion)
    : db.prepare(`
        INSERT OR IGNORE INTO counters (counter_name, counter_value, version, updated_at, last_request_id)
        VALUES (?, 1, 1, ?, ?)
      `).bind(name, commandContext.now, commandContext.requestId)

  const results = await db.batch([
    mutation,
    db.prepare(`
      INSERT INTO audit_log (
        request_id, actor_id, actor_role, action, entity_type, entity_id,
        before_json, after_json, metadata_json, server_timestamp
      )
      SELECT ?, ?, ?, 'counter.next', 'counter', ?, ?, ?, ?, ?
      WHERE EXISTS (
        SELECT 1 FROM counters WHERE counter_name = ? AND version = ? AND last_request_id = ?
      )
    `).bind(
      commandContext.requestId,
      user.user_id,
      user.role,
      name,
      JSON.stringify({ value: currentValue, version: currentVersion }),
      JSON.stringify({ value: nextValue, version: nextVersion, code }),
      JSON.stringify({ serverGenerated: true }),
      commandContext.now,
      name,
      nextVersion,
      commandContext.requestId,
    ),
    db.prepare(`
      INSERT INTO command_receipts (
        actor_id, idempotency_key, request_hash, response_json, status_code, created_at
      )
      SELECT ?, ?, ?, ?, 200, ?
      WHERE EXISTS (
        SELECT 1 FROM counters WHERE counter_name = ? AND version = ? AND last_request_id = ?
      )
    `).bind(
      user.user_id,
      commandContext.idempotencyKey,
      commandContext.hash,
      responseJson,
      commandContext.now,
      name,
      nextVersion,
      commandContext.requestId,
    ),
  ])
  if (changes(results?.[0]) !== 1) {
    const latest = await first(db, 'SELECT version FROM counters WHERE counter_name = ?', name)
    throw new ApiError(409, 'VERSION_CONFLICT', 'Bộ đếm đã thay đổi trên máy chủ.', {
      currentVersion: Number(latest?.version || 0),
    })
  }
  return jsonResponse(responseBody)
}

const changeOwnPasswordCommand = async (db, actor, body, commandContext) => {
  const payload = isPlainRecord(body.payload) ? body.payload : {}
  const expectedVersion = validateExpectedVersion(body.expectedVersion)
  const target = await first(db, 'SELECT * FROM users WHERE id = ? LIMIT 1', actor.user_id)
  if (!target || target.status !== 'active') {
    throw new ApiError(401, 'SESSION_INVALID', 'Tài khoản hoặc phiên đăng nhập không còn hợp lệ.')
  }
  const currentVersion = Number(target.version || 1)
  if (currentVersion !== expectedVersion) {
    throw new ApiError(409, 'VERSION_CONFLICT', 'Tài khoản đã thay đổi trên máy chủ.', { currentVersion })
  }
  const currentPassword = String(payload.currentPassword || '')
  if (currentPassword.length < 1 || currentPassword.length > 256) {
    throw new ApiError(400, 'CURRENT_PASSWORD_REQUIRED', 'Cần nhập mật khẩu hiện tại.')
  }
  const currentRecord = {
    hash: target.password_hash,
    salt: target.password_salt,
    iterations: target.password_iterations,
  }
  if (!await verifyPassword(currentPassword, currentRecord)) {
    throw new ApiError(401, 'CURRENT_PASSWORD_INVALID', 'Mật khẩu hiện tại chưa đúng.')
  }
  const newPassword = String(payload.newPassword || '')
  if (await verifyPassword(newPassword, currentRecord)) {
    throw new ApiError(400, 'PASSWORD_UNCHANGED', 'Mật khẩu mới phải khác mật khẩu hiện tại.')
  }
  const password = await hashPassword(newPassword)
  const nextVersion = currentVersion + 1
  const after = { ...publicUser(target), version: nextVersion, passwordUpdatedAt: commandContext.now }
  const responseBody = apiPayload(commandContext, {
    command: body.type,
    user: after,
    otherSessionsRevoked: true,
  })
  const results = await db.batch([
    db.prepare(`
      UPDATE users
      SET password_hash = ?, password_salt = ?, password_iterations = ?, password_algorithm = ?,
          password_updated_at = ?, updated_at = ?, version = ?
      WHERE id = ? AND version = ?
    `).bind(
      password.hash,
      password.salt,
      password.iterations,
      password.algorithm,
      commandContext.now,
      commandContext.now,
      nextVersion,
      actor.user_id,
      currentVersion,
    ),
    db.prepare(`
      UPDATE sessions
      SET revoked_at = ?, last_seen_at = ?
      WHERE user_id = ? AND id <> ? AND revoked_at IS NULL
        AND EXISTS (
          SELECT 1 FROM users WHERE id = ? AND version = ? AND updated_at = ?
        )
    `).bind(
      commandContext.now,
      commandContext.now,
      actor.user_id,
      actor.session_id,
      actor.user_id,
      nextVersion,
      commandContext.now,
    ),
    db.prepare(`
      INSERT INTO audit_log (
        request_id, actor_id, actor_role, action, entity_type, entity_id,
        before_json, after_json, metadata_json, server_timestamp
      )
      SELECT ?, ?, ?, 'user.change_password', 'user', ?, NULL, ?, ?, ?
      WHERE EXISTS (SELECT 1 FROM users WHERE id = ? AND version = ? AND updated_at = ?)
    `).bind(
      commandContext.requestId,
      actor.user_id,
      actor.role,
      actor.user_id,
      JSON.stringify({ passwordUpdatedAt: commandContext.now, version: nextVersion }),
      JSON.stringify({ otherSessionsRevoked: true }),
      commandContext.now,
      actor.user_id,
      nextVersion,
      commandContext.now,
    ),
    db.prepare(`
      INSERT INTO command_receipts (
        actor_id, idempotency_key, request_hash, response_json, status_code, created_at
      )
      SELECT ?, ?, ?, ?, 200, ?
      WHERE EXISTS (SELECT 1 FROM users WHERE id = ? AND version = ? AND updated_at = ?)
    `).bind(
      actor.user_id,
      commandContext.idempotencyKey,
      commandContext.hash,
      JSON.stringify(responseBody),
      commandContext.now,
      actor.user_id,
      nextVersion,
      commandContext.now,
    ),
  ])
  if (changes(results?.[0]) !== 1) {
    throw new ApiError(409, 'VERSION_CONFLICT', 'Tài khoản đã thay đổi trên máy chủ.')
  }
  return jsonResponse(responseBody)
}

const userCommand = async (db, actor, body, commandContext) => {
  assertOperationsRole(actor, 'Tài khoản không có quyền quản lý tài khoản nhân sự.')
  const payload = isPlainRecord(body.payload) ? body.payload : {}

  if (body.type === 'user.create') {
    const role = String(payload.role || 'employee').trim()
    if (!['business_support', 'store_manager', 'employee'].includes(role)) {
      throw new ApiError(400, 'ROLE_INVALID', 'Vai trò tài khoản không hợp lệ.')
    }
    if (role !== 'employee' && actor.role !== 'admin') {
      throw new ApiError(403, 'ROLE_FORBIDDEN', 'Chỉ Admin được tạo tài khoản Hỗ trợ KD hoặc Quản lý cửa hàng.')
    }
    const username = String(payload.username || '').trim()
    const normalizedUsername = normalizeUsername(username)
    const storeId = role === 'business_support'
      ? BUSINESS_SUPPORT_STORE_ID
      : String(payload.storeId || '').trim()
    const employeeId = String(payload.employeeId || '').trim()
    const displayName = String(payload.displayName || '').trim().slice(0, 160)
    if (!/^[A-Za-z0-9._-]{3,80}$/u.test(username)) {
      throw new ApiError(400, 'INVALID_USERNAME', 'Tên đăng nhập không hợp lệ.')
    }
    if (!/^[A-Za-z0-9_-]{1,80}$/u.test(storeId) || !/^[A-Za-z0-9_-]{1,80}$/u.test(employeeId)) {
      throw new ApiError(400, 'EMPLOYEE_SCOPE_INVALID', 'Tài khoản cần mã đơn vị và mã nhân viên hợp lệ.')
    }
    if (role === 'employee') assertOperationalStoreAccess(actor, storeId)
    const globalState = await loadState(db, 'global')
    const state = normalizeSharedStateForStorage(parseStoredJson(globalState?.value_json, {}))
    const employeeProfile = (Array.isArray(state.employees) ? state.employees : [])
      .find((record) => String(record.id || record.code || '') === employeeId && !record.deletedAt)
    const retiredEmployee = (Array.isArray(state.deletedEmployees) ? state.deletedEmployees : [])
      .some((record) => String(record.id || record.code || record.employeeCode || '') === employeeId)
    const validStore = (Array.isArray(state.stores) ? state.stores : []).some((store) => (
      String(store.id || '') === storeId && !store.deletedAt
    ))
    const validVirtualUnit = [OFFICE_STORE_ID, BUSINESS_SUPPORT_STORE_ID].includes(storeId)
    if (!validStore && !validVirtualUnit) {
      throw new ApiError(400, 'STORE_INVALID', 'Đơn vị gán cho nhân viên không tồn tại.')
    }
    if (retiredEmployee) {
      throw new ApiError(409, 'EMPLOYEE_ID_RETIRED', 'Mã nhân viên đã nghỉ việc và không thể cấp lại tài khoản.')
    }
    if (!employeeProfile) {
      throw new ApiError(404, 'EMPLOYEE_NOT_FOUND', 'Cần có hồ sơ nhân viên đang hoạt động trước khi tạo tài khoản.')
    }
    const profileStatus = normalizeTextKey(employeeProfile?.status)
    if (profileStatus && !['active', 'dang lam viec', 'dang hoat dong', 'hoat dong'].includes(profileStatus)) {
      throw new ApiError(409, 'EMPLOYEE_INACTIVE', 'Không thể tạo tài khoản hoạt động cho nhân viên đã ngưng hoặc nghỉ việc.')
    }
    if (String(employeeProfile.storeId || '') !== storeId || roleForEmployeeUnit(employeeUnit(employeeProfile)) !== role) {
      throw new ApiError(400, 'EMPLOYEE_ROLE_MISMATCH', 'Hồ sơ nhân viên không thuộc đúng đơn vị hoặc vai trò đã chọn.')
    }
    const existing = await first(db, `
      SELECT id FROM users WHERE username_normalized = ? OR (? <> '' AND employee_id = ?) LIMIT 1
    `, normalizedUsername, employeeId, employeeId)
    if (existing) throw new ApiError(409, 'USER_EXISTS', 'Tên đăng nhập hoặc mã nhân viên đã tồn tại.')
    const password = await hashPassword(payload.password)
    const userId = `usr_${crypto.randomUUID()}`
    const responseUser = {
      id: userId,
      username,
      displayName: displayName || employeeProfile.name || employeeId,
      role,
      storeId: storeId || null,
      employeeId: employeeId || null,
      status: 'active',
      version: 1,
      lastLoginAt: null,
    }
    const responseBody = apiPayload(commandContext, { command: body.type, user: responseUser })
    try {
      await db.batch([
        db.prepare(`
          INSERT INTO users (
            id, username, username_normalized, display_name, password_hash, password_salt,
            password_iterations, password_algorithm, role, status, version, store_id, employee_id,
            created_at, updated_at, password_updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', 1, ?, ?, ?, ?, ?)
        `).bind(
          userId,
          username,
          normalizedUsername,
          responseUser.displayName,
          password.hash,
          password.salt,
          password.iterations,
          password.algorithm,
          role,
          storeId || null,
          employeeId || null,
          commandContext.now,
          commandContext.now,
          commandContext.now,
        ),
        db.prepare(`
          INSERT INTO audit_log (
            request_id, actor_id, actor_role, action, entity_type, entity_id,
            before_json, after_json, metadata_json, server_timestamp
          ) VALUES (?, ?, ?, 'user.create', 'user', ?, NULL, ?, NULL, ?)
        `).bind(
          commandContext.requestId,
          actor.user_id,
          actor.role,
          userId,
          JSON.stringify(responseUser),
          commandContext.now,
        ),
        db.prepare(`
          INSERT INTO command_receipts (
            actor_id, idempotency_key, request_hash, response_json, status_code, created_at
          ) VALUES (?, ?, ?, ?, 201, ?)
        `).bind(
          actor.user_id,
          commandContext.idempotencyKey,
          commandContext.hash,
          JSON.stringify(responseBody),
          commandContext.now,
        ),
      ])
    } catch (error) {
      const raced = await first(db, `
        SELECT id FROM users WHERE username_normalized = ? OR (? <> '' AND employee_id = ?) LIMIT 1
      `, normalizedUsername, employeeId, employeeId)
      if (raced) throw new ApiError(409, 'USER_EXISTS', 'Tên đăng nhập hoặc mã nhân viên đã tồn tại.')
      throw error
    }
    return jsonResponse(responseBody, 201)
  }

  if (!['user.update', 'user.set_status', 'user.reset_password'].includes(body.type)) {
    throw new ApiError(400, 'COMMAND_UNKNOWN', 'Lệnh tài khoản không được hỗ trợ.')
  }
  const userId = String(payload.userId || '')
  const target = await first(db, "SELECT * FROM users WHERE id = ? AND role IN ('employee', 'business_support', 'store_manager') LIMIT 1", userId)
  if (!target) throw new ApiError(404, 'USER_NOT_FOUND', 'Không tìm thấy tài khoản được phép quản lý.')
  if (target.role !== 'employee' && actor.role !== 'admin') {
    throw new ApiError(403, 'ROLE_FORBIDDEN', 'Chỉ Admin được quản lý tài khoản Hỗ trợ KD hoặc Quản lý cửa hàng.')
  }
  if (target.role === 'employee') assertOperationalStoreAccess(actor, target.store_id)
  if (actor.role !== 'admin' && target.status === 'inactive') {
    throw new ApiError(403, 'EMPLOYEE_REACTIVATE_FORBIDDEN', 'Chỉ Admin được quản lý lại tài khoản nhân viên đã nghỉ việc.')
  }
  if (payload.role !== undefined && String(payload.role) !== String(target.role)) {
    throw new ApiError(400, 'ROLE_IMMUTABLE', 'Vai trò tài khoản không thể thay đổi.')
  }
  const expectedVersion = validateExpectedVersion(body.expectedVersion)
  const currentVersion = Number(target.version || 1)
  if (expectedVersion !== currentVersion) {
    throw new ApiError(409, 'VERSION_CONFLICT', 'Tài khoản đã thay đổi trên máy chủ.', { currentVersion })
  }
  const nextVersion = currentVersion + 1

  if (body.type === 'user.update') {
    if (payload.employeeId !== undefined && String(payload.employeeId) !== String(target.employee_id || '')) {
      throw new ApiError(400, 'EMPLOYEE_ID_IMMUTABLE', 'Mã nhân viên của tài khoản không thể thay đổi.')
    }
    const username = payload.username === undefined ? target.username : String(payload.username || '').trim()
    const normalizedUsername = normalizeUsername(username)
    const displayName = payload.displayName === undefined
      ? target.display_name
      : String(payload.displayName || '').trim().slice(0, 160)
    const storeId = String(target.store_id || '')
    if (payload.storeId !== undefined && String(payload.storeId || '').trim() !== storeId) {
      throw new ApiError(400, 'EMPLOYEE_STORE_IMMUTABLE', 'Không thể đổi đơn vị tài khoản tách khỏi hồ sơ nhân viên.')
    }
    if (!/^[A-Za-z0-9._-]{3,80}$/u.test(username)) {
      throw new ApiError(400, 'INVALID_USERNAME', 'Tên đăng nhập nhân viên không hợp lệ.')
    }
    if (!displayName) throw new ApiError(400, 'DISPLAY_NAME_INVALID', 'Tên hiển thị không được để trống.')
    if (!/^[A-Za-z0-9_-]{1,80}$/u.test(storeId)) {
      throw new ApiError(400, 'EMPLOYEE_SCOPE_INVALID', 'Mã cửa hàng không hợp lệ.')
    }
    if (target.role === 'employee') {
      assertOperationalStoreAccess(actor, storeId)
      const globalState = await loadState(db, 'global')
      const state = normalizeSharedStateForStorage(parseStoredJson(globalState?.value_json, {}))
      const validStore = (Array.isArray(state.stores) ? state.stores : []).some((store) => (
        String(store.id || '') === storeId && !store.deletedAt
      ))
      const validOffice = storeId === OFFICE_STORE_ID
      if (!validStore && !validOffice) {
        throw new ApiError(400, 'STORE_INVALID', 'Đơn vị gán cho nhân viên không tồn tại.')
      }
    }
    const duplicate = await first(db, `
      SELECT id FROM users WHERE username_normalized = ? AND id <> ? LIMIT 1
    `, normalizedUsername, userId)
    if (duplicate) throw new ApiError(409, 'USER_EXISTS', 'Tên đăng nhập đã được sử dụng.')
    const scopeChanged = String(target.store_id || '') !== storeId
    const after = {
      ...publicUser(target),
      username,
      displayName,
      storeId,
      version: nextVersion,
    }
    const responseBody = apiPayload(commandContext, { command: body.type, user: after })
    const statements = [
      db.prepare(`
        UPDATE users
        SET username = ?, username_normalized = ?, display_name = ?, store_id = ?, version = ?, updated_at = ?
        WHERE id = ? AND version = ?
      `).bind(
        username,
        normalizedUsername,
        displayName,
        storeId,
        nextVersion,
        commandContext.now,
        userId,
        currentVersion,
      ),
    ]
    if (scopeChanged) {
      statements.push(db.prepare(`
        UPDATE sessions
        SET revoked_at = ?, last_seen_at = ?
        WHERE user_id = ? AND revoked_at IS NULL
          AND EXISTS (
            SELECT 1 FROM users WHERE id = ? AND version = ? AND updated_at = ?
          )
      `).bind(
        commandContext.now,
        commandContext.now,
        userId,
        userId,
        nextVersion,
        commandContext.now,
      ))
    }
    statements.push(
      db.prepare(`
        INSERT INTO audit_log (
          request_id, actor_id, actor_role, action, entity_type, entity_id,
          before_json, after_json, metadata_json, server_timestamp
        )
        SELECT ?, ?, ?, 'user.update', 'user', ?, ?, ?, ?, ?
        WHERE EXISTS (SELECT 1 FROM users WHERE id = ? AND version = ? AND updated_at = ?)
      `).bind(
        commandContext.requestId,
        actor.user_id,
        actor.role,
        userId,
        JSON.stringify(publicUser(target)),
        JSON.stringify(after),
        JSON.stringify({ scopeChanged }),
        commandContext.now,
        userId,
        nextVersion,
        commandContext.now,
      ),
      db.prepare(`
        INSERT INTO command_receipts (
          actor_id, idempotency_key, request_hash, response_json, status_code, created_at
        )
        SELECT ?, ?, ?, ?, 200, ?
        WHERE EXISTS (SELECT 1 FROM users WHERE id = ? AND version = ? AND updated_at = ?)
      `).bind(
        actor.user_id,
        commandContext.idempotencyKey,
        commandContext.hash,
        JSON.stringify(responseBody),
        commandContext.now,
        userId,
        nextVersion,
        commandContext.now,
      ),
    )
    let results
    try {
      results = await db.batch(statements)
    } catch (error) {
      const racedDuplicate = await first(db, `
        SELECT id FROM users WHERE username_normalized = ? AND id <> ? LIMIT 1
      `, normalizedUsername, userId)
      if (racedDuplicate) throw new ApiError(409, 'USER_EXISTS', 'Tên đăng nhập đã được sử dụng.')
      throw error
    }
    if (changes(results?.[0]) !== 1) throw new ApiError(409, 'VERSION_CONFLICT', 'Tài khoản đã thay đổi trên máy chủ.')
    return jsonResponse(responseBody)
  }

  if (body.type === 'user.set_status') {
    const status = String(payload.status || '')
    if (!VALID_ACCOUNT_STATUSES.has(status)) throw new ApiError(400, 'STATUS_INVALID', 'Trạng thái tài khoản không hợp lệ.')
    if (actor.role !== 'admin' && (status === 'inactive' || target.status === 'inactive')) {
      throw new ApiError(403, 'EMPLOYEE_DELETE_FORBIDDEN', 'Chỉ Admin được xóa hoặc vô hiệu hóa nhân viên khỏi hệ thống.')
    }
    const after = { ...publicUser(target), status, version: nextVersion }
    const responseBody = apiPayload(commandContext, { command: body.type, user: after })
    const statements = [
      db.prepare(`
        UPDATE users SET status = ?, version = ?, updated_at = ? WHERE id = ? AND version = ?
      `).bind(status, nextVersion, commandContext.now, userId, currentVersion),
    ]
    if (status !== 'active') {
      statements.push(db.prepare(`
        UPDATE sessions
        SET revoked_at = ?, last_seen_at = ?
        WHERE user_id = ? AND revoked_at IS NULL
          AND EXISTS (
            SELECT 1 FROM users WHERE id = ? AND version = ? AND updated_at = ?
          )
      `).bind(
        commandContext.now,
        commandContext.now,
        userId,
        userId,
        nextVersion,
        commandContext.now,
      ))
    }
    statements.push(
      db.prepare(`
        INSERT INTO audit_log (
          request_id, actor_id, actor_role, action, entity_type, entity_id,
          before_json, after_json, metadata_json, server_timestamp
        )
        SELECT ?, ?, ?, 'user.set_status', 'user', ?, ?, ?, NULL, ?
        WHERE EXISTS (SELECT 1 FROM users WHERE id = ? AND version = ? AND updated_at = ?)
      `).bind(
        commandContext.requestId,
        actor.user_id,
        actor.role,
        userId,
        JSON.stringify(publicUser(target)),
        JSON.stringify(after),
        commandContext.now,
        userId,
        nextVersion,
        commandContext.now,
      ),
      db.prepare(`
        INSERT INTO command_receipts (
          actor_id, idempotency_key, request_hash, response_json, status_code, created_at
        )
        SELECT ?, ?, ?, ?, 200, ?
        WHERE EXISTS (SELECT 1 FROM users WHERE id = ? AND version = ? AND updated_at = ?)
      `).bind(
        actor.user_id,
        commandContext.idempotencyKey,
        commandContext.hash,
        JSON.stringify(responseBody),
        commandContext.now,
        userId,
        nextVersion,
        commandContext.now,
      ),
    )
    const results = await db.batch(statements)
    if (changes(results?.[0]) !== 1) throw new ApiError(409, 'VERSION_CONFLICT', 'Tài khoản đã thay đổi trên máy chủ.')
    return jsonResponse(responseBody)
  }

  const password = await hashPassword(payload.password)
  const after = { ...publicUser(target), version: nextVersion, passwordUpdatedAt: commandContext.now }
  const responseBody = apiPayload(commandContext, { command: body.type, user: after })
  const results = await db.batch([
    db.prepare(`
      UPDATE users
      SET password_hash = ?, password_salt = ?, password_iterations = ?, password_algorithm = ?,
          password_updated_at = ?, updated_at = ?, version = ?
      WHERE id = ? AND version = ?
    `).bind(
      password.hash,
      password.salt,
      password.iterations,
      password.algorithm,
      commandContext.now,
      commandContext.now,
      nextVersion,
      userId,
      currentVersion,
    ),
    db.prepare(`
      UPDATE sessions
      SET revoked_at = ?, last_seen_at = ?
      WHERE user_id = ? AND revoked_at IS NULL
        AND EXISTS (
          SELECT 1 FROM users WHERE id = ? AND version = ? AND updated_at = ?
        )
    `).bind(
      commandContext.now,
      commandContext.now,
      userId,
      userId,
      nextVersion,
      commandContext.now,
    ),
    db.prepare(`
      INSERT INTO audit_log (
        request_id, actor_id, actor_role, action, entity_type, entity_id,
        before_json, after_json, metadata_json, server_timestamp
      )
      SELECT ?, ?, ?, 'user.reset_password', 'user', ?, NULL, ?, NULL, ?
      WHERE EXISTS (SELECT 1 FROM users WHERE id = ? AND version = ? AND updated_at = ?)
    `).bind(
      commandContext.requestId,
      actor.user_id,
      actor.role,
      userId,
      JSON.stringify({ passwordUpdatedAt: commandContext.now, version: nextVersion }),
      commandContext.now,
      userId,
      nextVersion,
      commandContext.now,
    ),
    db.prepare(`
      INSERT INTO command_receipts (
        actor_id, idempotency_key, request_hash, response_json, status_code, created_at
      )
      SELECT ?, ?, ?, ?, 200, ?
      WHERE EXISTS (SELECT 1 FROM users WHERE id = ? AND version = ? AND updated_at = ?)
    `).bind(
      actor.user_id,
      commandContext.idempotencyKey,
      commandContext.hash,
      JSON.stringify(responseBody),
      commandContext.now,
      userId,
      nextVersion,
      commandContext.now,
    ),
  ])
  if (changes(results?.[0]) !== 1) throw new ApiError(409, 'VERSION_CONFLICT', 'Tài khoản đã thay đổi trên máy chủ.')
  return jsonResponse(responseBody)
}

const executeCommand = async (request, env, context) => {
  const db = getDatabase(env)
  const user = await requireSession(request, db, context)
  const body = await readJson(request)
  if (body.type !== 'system.reset_all' && await loadPendingSystemResetAll(db)) {
    throw new ApiError(503, 'RESET_CLEANUP_PENDING', 'Hệ thống đang hoàn tất xóa ảnh CCCD của lần Reset toàn bộ dữ liệu; các lệnh ghi tạm thời bị khóa.')
  }
  if (user.role === 'business_support' && !businessSupportCommandAllowed(body)) {
    throw new ApiError(403, 'BUSINESS_SUPPORT_READ_ONLY', 'Nhân viên hỗ trợ KD không có quyền thực hiện thao tác này.')
  }
  const idempotencyKey = validateIdempotencyKey(request, body)
  const hash = await requestHash({ ...body, idempotencyKey: undefined })
  const existingReceipt = await loadReceipt(db, user.user_id, idempotencyKey)
  const replay = replayReceipt(existingReceipt, hash)
  if (replay) return replay

  const commandContext = {
    ...context,
    idempotencyKey,
    hash,
    userAgent: String(request.headers.get('user-agent') || '').slice(0, 512),
  }
  try {
    if (body.type === 'state.replace' || body.type === 'state.merge') {
      return await stateCommand(db, user, body, commandContext)
    }
    if (String(body.type || '').startsWith('store.')) {
      return await storeCommand(db, user, body, commandContext)
    }
    if (body.type === 'tasks.assign' || body.type === 'tasks.replace_scope') {
      return await taskAssignmentCommand(db, user, body, commandContext)
    }
    if (String(body.type || '').startsWith('employee.')) {
      return await employeeProfileCommand(db, user, body, commandContext, env)
    }
    if (String(body.type || '').startsWith('shift_definition.')) {
      return await shiftDefinitionCommand(db, user, body, commandContext)
    }
    if (String(body.type || '').startsWith('schedule.')) {
      return await scheduleCommand(db, user, body, commandContext)
    }
    if (String(body.type || '').startsWith('account_settings.')) {
      return await accountSettingsCommand(db, user, body, commandContext)
    }
    if (String(body.type || '').startsWith('notification.')) {
      return await notificationCommand(db, user, body, commandContext)
    }
    if (String(body.type || '').startsWith('support_transfer.')) {
      return await supportTransferCommand(db, user, body, commandContext)
    }
    if (String(body.type || '').startsWith('operational_reset.')) {
      return await operationalResetCommand(db, user, body, commandContext)
    }
    if (body.type === 'system.reset_all') {
      return await systemResetAllCommand(db, user, body, commandContext, env)
    }
    if (body.type === 'system.reset_demo') {
      return await systemResetDemoCommand(db, user, body, commandContext)
    }
    if (body.type === 'policy.set') return await policyCommand(db, user, body, commandContext)
    if (body.type === 'policies.set') return await policiesCommand(db, user, body, commandContext)
    if (body.type === 'attendance.update') {
      return await attendanceUpdateCommand(db, user, body, commandContext)
    }
    if (body.type === 'attendance.check_in' || body.type === 'attendance.check_out') {
      return await attendanceCommand(db, user, body, commandContext)
    }
    if (body.type === 'order.create') return await orderCreateCommand(db, user, body, commandContext)
    if (body.type === 'order.update' || body.type === 'order.delete') {
      return await orderMutationCommand(db, user, body, commandContext)
    }
    if (String(body.type || '').startsWith('support_work.')) {
      return await supportWorkCommand(db, user, body, commandContext)
    }
    if (body.type === 'task.done' || body.type === 'task.set_done') {
      return await taskDoneCommand(db, user, body, commandContext)
    }
    if (String(body.type || '').startsWith('fixed_expense.')
      || String(body.type || '').startsWith('expense.')) {
      return await expenseCommand(db, user, body, commandContext)
    }
    if (String(body.type || '').startsWith('import.')
      || String(body.type || '').startsWith('import_voucher.')) {
      return await importVoucherCommand(db, user, body, commandContext)
    }
    if (String(body.type || '').startsWith('salary_advance.')) {
      return await salaryAdvanceCommand(db, user, body, commandContext)
    }
    if (String(body.type || '').startsWith('salary_adjustment.')) {
      return await salaryAdjustmentCommand(db, user, body, commandContext)
    }
    if (String(body.type || '').startsWith('payroll.')) {
      return await payrollCommand(db, user, body, commandContext)
    }
    if (body.type === 'counter.next') return await counterCommand(db, user, body, commandContext)
    if (body.type === 'user.change_password') {
      return await changeOwnPasswordCommand(db, user, body, commandContext)
    }
    if (String(body.type || '').startsWith('user.')) return await userCommand(db, user, body, commandContext)
    throw new ApiError(400, 'COMMAND_UNKNOWN', 'Lệnh không được hỗ trợ.')
  } catch (error) {
    const racedReceipt = await loadReceipt(db, user.user_id, idempotencyKey)
    const racedReplay = replayReceipt(racedReceipt, hash)
    if (racedReplay) return racedReplay
    throw error
  }
}

const logout = async (request, env, context) => {
  const db = getDatabase(env)
  const user = await requireSession(request, db, context)
  if (await loadPendingSystemResetAll(db)) {
    throw new ApiError(503, 'RESET_CLEANUP_PENDING', 'Không thể đăng xuất phiên Admin đang dùng để hoàn tất Reset toàn bộ dữ liệu.')
  }
  await db.batch([
    db.prepare('UPDATE sessions SET revoked_at = ?, last_seen_at = ? WHERE id = ? AND revoked_at IS NULL')
      .bind(context.now, context.now, user.session_id),
    db.prepare(`
      INSERT INTO audit_log (
        request_id, actor_id, actor_role, action, entity_type, entity_id,
        before_json, after_json, metadata_json, server_timestamp
      ) VALUES (?, ?, ?, 'auth.logout', 'session', ?, NULL, ?, NULL, ?)
    `).bind(
      context.requestId,
      user.user_id,
      user.role,
      user.session_id,
      JSON.stringify({ revokedAt: context.now }),
      context.now,
    ),
  ])
  return jsonResponse(apiPayload(context, { loggedOut: true }))
}

const listUsers = async (request, env, context) => {
  const db = getDatabase(env)
  const actor = await requireSession(request, db, context)
  if (!OPERATIONS_ROLES.has(actor.role)) {
    throw new ApiError(403, 'ROLE_FORBIDDEN', 'Tài khoản không có quyền xem danh sách tài khoản nhân sự.')
  }
  const rows = ['admin', 'business_support'].includes(actor.role)
    ? await all(db, `
        SELECT id, username, display_name, role, status, version, store_id, employee_id, last_login_at
        FROM users
        WHERE role IN ('employee', 'business_support', 'store_manager')
        ORDER BY role DESC, display_name, username
      `)
    : await all(db, `
        SELECT id, username, display_name, role, status, version, store_id, employee_id, last_login_at
        FROM users
        WHERE role = 'employee' AND store_id = ?
        ORDER BY display_name, username
      `, String(actor.store_id || ''))
  return jsonResponse(apiPayload(context, { users: rows.map(publicUser) }))
}

const getIdentityImage = async (request, env, context, employeeId, side) => {
  const db = getDatabase(env)
  const actor = await requireSession(request, db, context)
  const normalizedEmployeeId = String(employeeId || '').trim()
  if (!/^[A-Za-z0-9_-]{2,80}$/u.test(normalizedEmployeeId) || !['front', 'back'].includes(side)) {
    throw new ApiError(404, 'IDENTITY_IMAGE_NOT_FOUND', 'Không tìm thấy ảnh CCCD.')
  }
  const current = await loadState(db, 'global')
  const state = normalizeSharedStateForStorage(parseStoredJson(current?.value_json, {}))
  const profile = [
    ...(Array.isArray(state.employees) ? state.employees : []),
    ...(Array.isArray(state.deletedEmployees) ? state.deletedEmployees : []),
  ].find((record) => String(record.id || record.code || record.employeeCode || '') === normalizedEmployeeId)
  const authorized = actor.role === 'admin'
    || actor.role === 'business_support'
    || (actor.role === 'store_manager' && String(actor.store_id || '') === String(profile?.storeId || ''))
    || (actor.role === 'employee' && String(actor.employee_id || '') === normalizedEmployeeId)
  if (!profile || !['business_support', 'store_manager', 'office', 'store'].includes(employeeUnit(profile)) || !authorized) {
    throw new ApiError(403, 'IDENTITY_IMAGE_FORBIDDEN', 'Bạn không có quyền xem ảnh CCCD này.')
  }
  const metadata = isPlainRecord(profile.identityImages?.[side]) ? profile.identityImages[side] : null
  const key = String(metadata?.key || '')
  if (!key.startsWith(`identity-images/${normalizedEmployeeId}/${side}/`)) {
    throw new ApiError(404, 'IDENTITY_IMAGE_NOT_FOUND', 'Không tìm thấy ảnh CCCD.')
  }
  const bucket = env?.IDENTITY_IMAGES
  if (!bucket?.get) {
    throw new ApiError(503, 'IDENTITY_IMAGE_STORAGE_UNAVAILABLE', 'Kho lưu ảnh CCCD chưa được cấu hình.')
  }
  const object = await bucket.get(key)
  if (!object?.body) throw new ApiError(404, 'IDENTITY_IMAGE_NOT_FOUND', 'Không tìm thấy ảnh CCCD.')
  const contentType = ['image/jpeg', 'image/png', 'image/webp'].includes(String(metadata.contentType))
    ? String(metadata.contentType)
    : 'application/octet-stream'
  const size = Number(metadata.size ?? object.size)
  const headers = new Headers({
    'Cache-Control': 'private, no-store',
    'Content-Disposition': `inline; filename="${side}.${contentType === 'image/jpeg' ? 'jpg' : contentType.split('/')[1] || 'bin'}"`,
    'Content-Security-Policy': "default-src 'none'",
    'Content-Type': contentType,
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
  })
  if (Number.isSafeInteger(size) && size >= 0) headers.set('Content-Length', String(size))
  if (object.etag) headers.set('ETag', String(object.etag))
  return new Response(object.body, { status: 200, headers })
}

const listAudit = async (request, env, context, url) => {
  const db = getDatabase(env)
  const user = await requireSession(request, db, context)
  if (!['admin', 'business_support'].includes(user.role)) {
    throw new ApiError(403, 'ROLE_FORBIDDEN', 'Tài khoản không có quyền xem nhật ký hệ thống.')
  }
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit')) || 50))
  const beforeId = Number(url.searchParams.get('beforeId'))
  const orderOnly = user.role === 'business_support'
  const rows = orderOnly
    ? (Number.isInteger(beforeId) && beforeId > 0
        ? await all(db, `
            SELECT * FROM audit_log
            WHERE entity_type = 'order' AND action IN ('order.update', 'order.delete') AND id < ?
            ORDER BY id DESC LIMIT ?
          `, beforeId, limit)
        : await all(db, `
            SELECT * FROM audit_log
            WHERE entity_type = 'order' AND action IN ('order.update', 'order.delete')
            ORDER BY id DESC LIMIT ?
          `, limit))
    : (Number.isInteger(beforeId) && beforeId > 0
        ? await all(db, 'SELECT * FROM audit_log WHERE id < ? ORDER BY id DESC LIMIT ?', beforeId, limit)
        : await all(db, 'SELECT * FROM audit_log ORDER BY id DESC LIMIT ?', limit))
  return jsonResponse(apiPayload(context, {
    audit: rows.map((row) => ({
      id: Number(row.id),
      requestId: row.request_id,
      actorId: row.actor_id,
      actorRole: row.actor_role,
      action: row.action,
      entityType: row.entity_type,
      entityId: row.entity_id,
      before: parseStoredJson(row.before_json),
      after: parseStoredJson(row.after_json),
      metadata: parseStoredJson(row.metadata_json),
      serverTimestamp: row.server_timestamp,
    })),
  }))
}

const addressSuggestionRateKey = (request, actor) => {
  const forwarded = String(request.headers.get('cf-connecting-ip') || '').trim().slice(0, 64)
  return `${String(actor.user_id || actor.id || '')}:${forwarded}`
}

const enforceAddressSuggestionRate = (request, actor, context) => {
  const now = Number.isFinite(Date.parse(context.now)) ? Date.parse(context.now) : Date.now()
  const key = addressSuggestionRateKey(request, actor)
  const previous = addressSuggestionRateWindows.get(key)
  const entry = !previous || now - previous.startedAt >= ADDRESS_SUGGESTION_RATE_WINDOW_MS
    ? { startedAt: now, count: 0 }
    : previous
  entry.count += 1
  addressSuggestionRateWindows.set(key, entry)
  if (addressSuggestionRateWindows.size > 2_000) {
    for (const [candidateKey, window] of addressSuggestionRateWindows) {
      if (now - window.startedAt >= ADDRESS_SUGGESTION_RATE_WINDOW_MS) addressSuggestionRateWindows.delete(candidateKey)
    }
  }
  if (entry.count > ADDRESS_SUGGESTION_RATE_LIMIT) {
    throw new ApiError(429, 'ADDRESS_SUGGESTION_RATE_LIMITED', 'Bạn đã gửi quá nhiều yêu cầu gợi ý địa chỉ. Vui lòng thử lại sau.', {
      retryAfterSeconds: Math.max(1, Math.ceil((entry.startedAt + ADDRESS_SUGGESTION_RATE_WINDOW_MS - now) / 1_000)),
    })
  }
}

const safeAddressContextPart = (value, label) => {
  const text = [...String(value || '').trim()]
    .filter((character) => character.codePointAt(0) >= 32 && character.codePointAt(0) !== 127)
    .join('')
  if (text.length > 120) throw new ApiError(400, 'ADDRESS_QUERY_TOO_LONG', `${label} không được vượt quá 120 ký tự.`)
  return text
}

const getAddressSuggestions = async (request, env, context, url) => {
  const db = getDatabase(env)
  const actor = await requireSession(request, db, context)
  const apiKey = String(env?.GOOGLE_MAPS_API_KEY || '').trim()
  if (!apiKey) {
    return jsonResponse(apiPayload(context, { configured: false, suggestions: [] }))
  }
  const type = String(url.searchParams.get('type') || '').trim().toLowerCase()
  if (!ADDRESS_SUGGESTION_TYPES.has(type)) {
    throw new ApiError(400, 'ADDRESS_TYPE_INVALID', 'Loại gợi ý địa chỉ phải là province, ward hoặc street.')
  }
  const query = safeAddressContextPart(url.searchParams.get('query'), 'Nội dung tìm kiếm')
  const province = safeAddressContextPart(url.searchParams.get('province'), 'Tỉnh/thành phố')
  const ward = safeAddressContextPart(url.searchParams.get('ward'), 'Phường/xã')
  if (query.length < 2) {
    return jsonResponse(apiPayload(context, { configured: true, suggestions: [] }))
  }
  enforceAddressSuggestionRate(request, actor, context)
  const contextParts = type === 'province'
    ? ['Việt Nam']
    : (type === 'ward' ? [province, 'Việt Nam'] : [ward, province, 'Việt Nam'])
  const input = [query, ...contextParts.filter(Boolean)].join(', ').slice(0, 400)
  const sessionToken = String(url.searchParams.get('sessionToken') || '').trim()
  if (sessionToken && !/^[A-Za-z0-9_-]{8,80}$/u.test(sessionToken)) {
    throw new ApiError(400, 'ADDRESS_SESSION_TOKEN_INVALID', 'Mã phiên gợi ý địa chỉ không hợp lệ.')
  }
  const upstreamBody = {
    input,
    languageCode: 'vi',
    regionCode: 'vn',
    includedRegionCodes: ['vn'],
    ...(sessionToken ? { sessionToken } : {}),
  }
  let upstream
  try {
    upstream = await fetch('https://places.googleapis.com/v1/places:autocomplete', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': [
          'suggestions.placePrediction.placeId',
          'suggestions.placePrediction.text.text',
          'suggestions.placePrediction.structuredFormat.mainText.text',
          'suggestions.placePrediction.structuredFormat.secondaryText.text',
        ].join(','),
      },
      body: JSON.stringify(upstreamBody),
      ...(typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
        ? { signal: AbortSignal.timeout(5_000) }
        : {}),
    })
  } catch {
    throw new ApiError(502, 'ADDRESS_PROVIDER_UNAVAILABLE', 'Dịch vụ gợi ý địa chỉ tạm thời không khả dụng.')
  }
  if (!upstream.ok) {
    throw new ApiError(502, 'ADDRESS_PROVIDER_ERROR', 'Dịch vụ gợi ý địa chỉ không thể xử lý yêu cầu.')
  }
  let result
  try {
    result = await upstream.json()
  } catch {
    throw new ApiError(502, 'ADDRESS_PROVIDER_INVALID_RESPONSE', 'Dịch vụ gợi ý địa chỉ trả về dữ liệu không hợp lệ.')
  }
  const suggestions = (Array.isArray(result?.suggestions) ? result.suggestions : []).flatMap((entry) => {
    const prediction = entry?.placePrediction
    const label = String(prediction?.text?.text || '').trim()
    if (!label) return []
    const value = String(prediction?.structuredFormat?.mainText?.text || label).trim()
    return [{
      label: label.slice(0, 500),
      value: value.slice(0, 200),
      placeId: String(prediction?.placeId || '').slice(0, 200),
      ...(type === 'province' ? { province: value.slice(0, 200) } : {}),
      ...(type === 'ward' ? { province, ward: value.slice(0, 200) } : {}),
      ...(type === 'street' ? { province, ward, street: value.slice(0, 200) } : {}),
    }]
  }).slice(0, 8)
  return jsonResponse(apiPayload(context, { configured: true, suggestions }))
}

const methodNotAllowed = (allowed) => {
  throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Phương thức không được hỗ trợ.', { allowed })
}

const handleApi = async (request, env, context, url) => {
  const path = url.pathname
  if (path === '/api/health') {
    if (request.method !== 'GET') return methodNotAllowed(['GET'])
    return jsonResponse(apiPayload(context, {
      service: 'idosi-api',
      databaseConfigured: Boolean(env?.DB?.prepare && env?.DB?.batch),
      identityImageStorageConfigured: Boolean(env?.IDENTITY_IMAGES?.get && env?.IDENTITY_IMAGES?.put),
      addressSuggestionsConfigured: Boolean(String(env?.GOOGLE_MAPS_API_KEY || '').trim()),
    }))
  }
  if (path === '/api/bootstrap') {
    if (request.method === 'POST') return bootstrapDatabase(request, env, context)
    if (request.method === 'GET') return getBootstrap(request, env, context, url)
    return methodNotAllowed(['GET', 'POST'])
  }
  if (path === '/api/login') {
    if (request.method !== 'POST') return methodNotAllowed(['POST'])
    return login(request, env, context)
  }
  if (path === '/api/state') {
    if (request.method !== 'GET') return methodNotAllowed(['GET'])
    return getState(request, env, context, url)
  }
  if (path === '/api/command') {
    if (request.method !== 'POST') return methodNotAllowed(['POST'])
    return executeCommand(request, env, context)
  }
  if (path === '/api/logout') {
    if (request.method !== 'POST') return methodNotAllowed(['POST'])
    return logout(request, env, context)
  }
  if (path === '/api/users') {
    if (request.method !== 'GET') return methodNotAllowed(['GET'])
    return listUsers(request, env, context)
  }
  if (path === '/api/address-suggestions') {
    if (request.method !== 'GET') return methodNotAllowed(['GET'])
    return getAddressSuggestions(request, env, context, url)
  }
  const identityImageMatch = path.match(/^\/api\/identity-images\/([^/]+)\/(front|back)$/u)
  if (identityImageMatch) {
    if (request.method !== 'GET') return methodNotAllowed(['GET'])
    let employeeId
    try {
      employeeId = decodeURIComponent(identityImageMatch[1])
    } catch {
      throw new ApiError(404, 'IDENTITY_IMAGE_NOT_FOUND', 'Không tìm thấy ảnh CCCD.')
    }
    return getIdentityImage(request, env, context, employeeId, identityImageMatch[2])
  }
  if (path === '/api/audit') {
    if (request.method !== 'GET') return methodNotAllowed(['GET'])
    return listAudit(request, env, context, url)
  }
  throw new ApiError(404, 'API_NOT_FOUND', 'Không tìm thấy API.')
}

const fetchAsset = (request, env) => {
  if (!env?.ASSETS?.fetch) return Promise.resolve(new Response('Static asset binding is unavailable.', { status: 503 }))
  return env.ASSETS.fetch(request)
}

const handleStatic = async (request, env) => {
  const response = await fetchAsset(request, env)
  if (response.status !== 404 || !['GET', 'HEAD'].includes(request.method)) return response
  const url = new URL(request.url)
  if (url.pathname.includes('.')) return response
  url.pathname = '/index.html'
  return fetchAsset(new Request(url, request), env)
}

const worker = {
  async fetch(request, env) {
    const url = new URL(request.url)
    if (!url.pathname.startsWith(API_PREFIX)) return handleStatic(request, env)
    const context = {
      now: new Date().toISOString(),
      requestId: crypto.randomUUID(),
    }
    try {
      return await handleApi(request, env, context, url)
    } catch (error) {
      if (error instanceof ApiError) {
        return jsonResponse({
          ok: false,
          error: { code: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) },
          serverTime: context.now,
          requestId: context.requestId,
        }, error.status)
      }
      console.error('Unhandled IDOSI worker error', error)
      return jsonResponse({
        ok: false,
        error: { code: 'INTERNAL_ERROR', message: 'Máy chủ không thể xử lý yêu cầu.' },
        serverTime: context.now,
        requestId: context.requestId,
      }, 500)
    }
  },
}

export default worker
