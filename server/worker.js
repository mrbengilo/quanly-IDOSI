const API_PREFIX = '/api/'
const MAX_JSON_BYTES = 1024 * 1024
const MAX_STATE_BYTES = 768 * 1024
const MAX_JSON_DEPTH = 64
const MAX_MONEY_VND = 100_000_000_000
const DEFAULT_SESSION_TTL_SECONDS = 8 * 60 * 60
const DEFAULT_PBKDF2_ITERATIONS = 100_000
const MIN_PBKDF2_ITERATIONS = 100_000
const MAX_PBKDF2_ITERATIONS = 100_000
const VALID_ROLES = new Set(['admin', 'employee'])
const VALID_ACCOUNT_STATUSES = new Set(['active', 'locked', 'inactive'])

const DEFAULT_POLICIES = Object.freeze({
  late_tolerance_minutes: 10,
  early_check_in_limit_minutes: 120,
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

const belongsToEmployee = (record, employeeId) => {
  if (!isPlainRecord(record)) return false
  if (employeeReference(record) === employeeId) return true
  if (Array.isArray(record.employeeIds) && record.employeeIds.map(String).includes(employeeId)) return true
  if (Array.isArray(record.assignees) && record.assignees.some((item) => String(item?.id || item) === employeeId)) return true
  return false
}

const filterArray = (state, key, predicate) => (Array.isArray(state[key]) ? state[key].filter(predicate) : [])

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
  if (user.role === 'admin') return { ...state, session: null }

  const storeId = String(user.store_id || '')
  const employeeId = String(user.employee_id || user.user_id || '')
  if (user.role === 'employee' && employeeId) {
    const own = (key) => filterArray(state, key, (record) => belongsToEmployee(record, employeeId))
    const ownAttendance = own('attendance')
    const openAttendance = ownAttendance.find((record) => !record.deletedAt && !record.checkOut && !record.checkOutAt)
    const latestAttendance = [...ownAttendance]
      .sort((left, right) => String(right.checkInAt || right.createdAt || '').localeCompare(String(left.checkInAt || left.createdAt || '')))[0]
    const stores = filterArray(state, 'stores', (record) => String(record.id || '') === storeId)
      .map((record) => Object.fromEntries(Object.entries(record).filter(([key]) => (
        !['revenue', 'expense', 'profit', 'cash', 'balance', 'costs'].includes(key)
      ))))
    const tasks = filterArray(state, 'tasks', (record) => {
      const hasExplicitAssignee = Boolean(employeeReference(record))
        || (Array.isArray(record.employeeIds) && record.employeeIds.length > 0)
        || (Array.isArray(record.assignees) && record.assignees.length > 0)
      return hasExplicitAssignee
        ? belongsToEmployee(record, employeeId)
        : String(record.storeId || '') === storeId
    }).map((record) => ({
      ...record,
      completedBy: Object.hasOwn(record.completedBy || {}, employeeId)
        ? { [employeeId]: Boolean(record.completedBy[employeeId]) }
        : {},
    }))
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
      orders: own('orders'),
      notifications: filterArray(state, 'notifications', (record) => belongsToEmployee(record, employeeId)),
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
  return session
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

const loadReceipt = (db, actorId, idempotencyKey) => first(db, `
  SELECT request_hash, response_json, status_code
  FROM command_receipts
  WHERE actor_id = ? AND idempotency_key = ?
  LIMIT 1
`, actorId, idempotencyKey)

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

const loadState = (db, scope) => first(db, `
  SELECT scope_key, value_json, version, updated_at, updated_by
  FROM app_state
  WHERE scope_key = ?
  LIMIT 1
`, scope)

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
  const stateJson = JSON.stringify(normalizedInitialState)
  if (textEncoder.encode(stateJson).byteLength > MAX_STATE_BYTES) {
    throw new ApiError(413, 'STATE_TOO_LARGE', 'Trạng thái ban đầu vượt quá giới hạn cho phép.')
  }

  const password = await hashPassword(body.password)
  const userId = `usr_${crypto.randomUUID()}`
  const requestId = context.requestId
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
    db.prepare(`
      INSERT INTO app_state (scope_key, value_json, version, updated_at, updated_by, last_request_id)
      VALUES ('global', ?, 1, ?, ?, ?)
    `).bind(stateJson, context.now, userId, requestId),
  ]
  for (const [key, value] of Object.entries(DEFAULT_POLICIES)) {
    statements.push(db.prepare(`
      INSERT INTO policies (
        policy_key, value_json, version, effective_at, updated_at, updated_by, last_request_id
      ) VALUES (?, ?, 1, ?, ?, ?, ?)
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
    const suffix = voucherCode.match(/-(\d{5})$/u)
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

  return jsonResponse(apiPayload(context, {
    token: rawToken,
    tokenType: 'Bearer',
    expiresAt,
    user: publicUser({ ...user, last_login_at: context.now }),
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
  'orders',
  'orderAudit',
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
  const nextJson = JSON.stringify(nextState)
  if (textEncoder.encode(nextJson).byteLength > MAX_STATE_BYTES) {
    throw new ApiError(413, 'STATE_TOO_LARGE', 'Trạng thái vượt quá giới hạn cho phép.')
  }

  const nextVersion = currentVersion + 1
  const responseBody = apiPayload(commandContext, {
    command: body.type,
    scope,
    state: nextState,
    version: nextVersion,
    updatedAt: commandContext.now,
  })
  const responseJson = JSON.stringify(responseBody)
  const mutation = current
    ? db.prepare(`
        UPDATE app_state
        SET value_json = ?, version = ?, updated_at = ?, updated_by = ?, last_request_id = ?
        WHERE scope_key = ? AND version = ?
      `).bind(nextJson, nextVersion, commandContext.now, user.user_id, commandContext.requestId, scope, currentVersion)
    : db.prepare(`
        INSERT OR IGNORE INTO app_state (
          scope_key, value_json, version, updated_at, updated_by, last_request_id
        ) VALUES (?, ?, 1, ?, ?, ?)
      `).bind(scope, nextJson, commandContext.now, user.user_id, commandContext.requestId)

  const results = await db.batch([
    mutation,
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
      current ? JSON.stringify(scope === 'global'
        ? normalizeSharedStateForStorage(currentState)
        : sanitizeStateValue(currentState)) : null,
      nextJson,
      JSON.stringify({ fromVersion: currentVersion, toVersion: nextVersion }),
      commandContext.now,
      scope,
      nextVersion,
      commandContext.requestId,
    ),
    db.prepare(`
      INSERT INTO command_receipts (
        actor_id, idempotency_key, request_hash, response_json, status_code, created_at
      )
      SELECT ?, ?, ?, ?, 200, ?
      WHERE EXISTS (
        SELECT 1 FROM app_state WHERE scope_key = ? AND version = ? AND last_request_id = ?
      )
    `).bind(
      user.user_id,
      commandContext.idempotencyKey,
      commandContext.hash,
      responseJson,
      commandContext.now,
      scope,
      nextVersion,
      commandContext.requestId,
    ),
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
    const date = new Date(serverTimestamp)
    const day = String(date.getUTCDate()).padStart(2, '0')
    const month = String(date.getUTCMonth() + 1).padStart(2, '0')
    const year = String(date.getUTCFullYear())
    return `PN-${day}${month}${year}-${sequence}`
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
  const nextStateJson = JSON.stringify(nextState)
  if (textEncoder.encode(nextStateJson).byteLength > MAX_STATE_BYTES) {
    throw new ApiError(413, 'STATE_TOO_LARGE', 'Trạng thái dùng chung vượt quá giới hạn cho phép.')
  }
  const currentVersion = Number(current.version)
  const nextVersion = currentVersion + 1
  const responseBody = apiPayload(commandContext, { ...options.response, version: nextVersion })
  const responseJson = JSON.stringify(responseBody)
  let results
  try {
    results = await db.batch([
      db.prepare(`
        UPDATE app_state
        SET value_json = ?, version = ?, updated_at = ?, updated_by = ?, last_request_id = ?
        WHERE scope_key = 'global' AND version = ?
      `).bind(
        nextStateJson,
        nextVersion,
        commandContext.now,
        actor.user_id,
        commandContext.requestId,
        currentVersion,
      ),
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
        options.before === undefined ? null : JSON.stringify(options.before),
        options.after === undefined ? null : JSON.stringify(options.after),
        options.metadata === undefined ? null : JSON.stringify(options.metadata),
        commandContext.now,
        nextVersion,
        commandContext.requestId,
      ),
      db.prepare(`
        INSERT INTO command_receipts (
          actor_id, idempotency_key, request_hash, response_json, status_code, created_at
        )
        SELECT ?, ?, ?, ?, ?, ?
        WHERE EXISTS (
          SELECT 1 FROM app_state
          WHERE scope_key = 'global' AND version = ? AND last_request_id = ?
        )
      `).bind(
        actor.user_id,
        commandContext.idempotencyKey,
        commandContext.hash,
        responseJson,
        options.status || 200,
        commandContext.now,
        nextVersion,
        commandContext.requestId,
      ),
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
  const nextStateJson = JSON.stringify(nextState)
  if (textEncoder.encode(nextStateJson).byteLength > MAX_STATE_BYTES) {
    throw new ApiError(413, 'STATE_TOO_LARGE', 'Trạng thái dùng chung vượt quá giới hạn cho phép.')
  }
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
  const stateMutation = db.prepare(`
    UPDATE app_state
    SET value_json = ?, version = ?, updated_at = ?, updated_by = ?, last_request_id = ?
    WHERE scope_key = 'global' AND version = ?
  `).bind(nextStateJson, nextVersion, commandContext.now, actor.user_id, commandContext.requestId, currentVersion)
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
      stateMutation,
      counterMutation,
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
        options.before === undefined ? null : JSON.stringify(options.before),
        options.after === undefined ? null : JSON.stringify(options.after),
        options.metadata === undefined ? null : JSON.stringify(options.metadata),
        commandContext.now,
        nextVersion,
        commandContext.requestId,
        counter.name,
        nextCounterVersion,
        commandContext.requestId,
      ),
      db.prepare(`
        INSERT INTO command_receipts (
          actor_id, idempotency_key, request_hash, response_json, status_code, created_at
        )
        VALUES (
          ?, ?,
          (SELECT ? WHERE EXISTS (
            SELECT 1 FROM app_state WHERE scope_key = 'global' AND version = ? AND last_request_id = ?
          ) AND EXISTS (
            SELECT 1 FROM counters WHERE counter_name = ? AND version = ? AND last_request_id = ?
          )),
          ?, ?, ?
        )
      `).bind(
        actor.user_id,
        commandContext.idempotencyKey,
        commandContext.hash,
        nextVersion,
        commandContext.requestId,
        counter.name,
        nextCounterVersion,
        commandContext.requestId,
        responseJson,
        status,
        commandContext.now,
      ),
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
  if (normalized === 'OFFICE' && (Array.isArray(state.employees) ? state.employees : []).some((employee) => (
    !employee.deletedAt
    && (String(employee.storeId || '') === 'OFFICE' || String(employee.unit || '').toLowerCase() === 'office')
  ))) {
    return { id: 'OFFICE', name: 'Khối Văn Phòng', unit: 'office' }
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

const adjustmentAmountFor = (state, employeeId, period) => (Array.isArray(state.salaryAdjustments) ? state.salaryAdjustments : [])
  .filter((record) => (
    belongsToEmployee(record, employeeId)
    && nonCancelled(record)
    && (record.period ? String(record.period) === period : monthFromRecord(record) === period)
  ))
  .reduce((sum, record) => {
    const amount = Number(record.amount)
    if (!Number.isSafeInteger(amount) || amount < 0) return sum
    return safeMoneySum(sum, (normalizeTextKey(record.type).includes('khau tru') ? -amount : amount), 'Tổng điều chỉnh lương')
  }, 0)

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
  requirePayrollUnit(state, storeId)
  const policies = await payrollPolicies(db)
  const employees = (Array.isArray(state.employees) ? state.employees : []).filter((employee) => (
    String(employee.storeId || '') === String(storeId)
    && !employee.deletedAt
    && normalizeTextKey(employee.status) !== 'da nghi viec'
  ))
  const participantIds = new Set()
  const participants = employees.map((employee) => {
    const employeeId = String(employee.id || employee.code || '').trim()
    if (!employeeId) throw new ApiError(409, 'PAYROLL_EMPLOYEE_INVALID', 'Hồ sơ nhân viên thiếu mã định danh.')
    if (participantIds.has(employeeId)) {
      throw new ApiError(409, 'PAYROLL_EMPLOYEE_DUPLICATE', 'Danh sách nhân viên có mã bị trùng.')
    }
    participantIds.add(employeeId)
    return { employee, hours: workedHoursFor(state, employeeId, period) }
  })
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
  const rows = participants.map(({ employee, hours }) => {
    const employeeId = String(employee.id || employee.code || '')
    const payBasis = String(employee.payBasis || employee.salaryBasis || (
      normalizeTextKey(employee.employmentType).includes('part') ? 'hourly' : 'monthly'
    )).toLowerCase()
    const hourlyRate = Number(employee.hourlyRate ?? (payBasis === 'hourly' ? employee.salary : 0) ?? 0)
    const monthlySalary = Number(employee.monthlySalary ?? (payBasis === 'monthly' ? employee.salary : 0) ?? 0)
    const base = payBasis === 'hourly'
      ? Math.floor(hours * (Number.isFinite(hourlyRate) && hourlyRate > 0 ? hourlyRate : 0))
      : Math.max(0, Number.isSafeInteger(monthlySalary) ? monthlySalary : Math.trunc(monthlySalary || 0))
    const kpiBonus = profit > 0 && totalHours > 0
      ? Math.floor((hours / totalHours) * (ratePercent / 100) * profit)
      : 0
    const allowance = Number.isSafeInteger(Number(employee.tiktokAllowance)) ? Number(employee.tiktokAllowance) : 0
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
      gross,
      kpiBonus,
      advancesPaid,
      remaining: Math.max(0, gross - advancesPaid),
      salarySnapshot: {
        salary: employee.salary ?? null,
        monthlySalary: employee.monthlySalary ?? null,
        hourlyRate: employee.hourlyRate ?? null,
        tiktokAllowance: employee.tiktokAllowance ?? 0,
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

const attendanceCommand = async (db, actor, body, commandContext) => {
  if (actor.role !== 'employee') {
    throw new ApiError(403, 'ROLE_FORBIDDEN', 'Lệnh chấm công trực tiếp chỉ dành cho tài khoản nhân viên.')
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
  if (!employee || String(employee.storeId || '') !== storeId) {
    throw new ApiError(409, 'EMPLOYEE_PROFILE_MISSING', 'Tài khoản chưa được liên kết với hồ sơ nhân viên hợp lệ.')
  }
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
    const shiftId = String(payload.shiftId || '').trim()
    if (!/^[A-Za-z0-9_-]{1,80}$/u.test(shiftId)) {
      throw new ApiError(400, 'SHIFT_INVALID', 'Cần chọn ca làm việc hợp lệ.')
    }
    const shift = (Array.isArray(state.shiftDefinitions) ? state.shiftDefinitions : [])
      .find((record) => (
        String(record.id || '') === shiftId
        && record.active !== false
        && (!record.storeId || String(record.storeId) === storeId)
        && (!record.date || String(record.date) === localNow.date)
      ))
    const times = shiftTimes(shift)
    if (!shift || !times.start || !times.end) {
      throw new ApiError(400, 'SHIFT_INVALID', 'Ca làm việc không tồn tại hoặc thiếu giờ bắt đầu/kết thúc.')
    }
    const dayAssignments = (Array.isArray(state.schedule) ? state.schedule : []).filter((record) => (
      belongsToEmployee(record, employeeId)
      && String(record.date || record.workDate || '') === localNow.date
      && !record.deletedAt
    ))
    if (dayAssignments.length && !dayAssignments.some((record) => (
      String(record.shiftId || '') === shiftId
      || (Array.isArray(record.shiftIds) && record.shiftIds.map(String).includes(shiftId))
    ))) {
      throw new ApiError(403, 'SHIFT_NOT_ASSIGNED', 'Ca này không nằm trong lịch làm việc hôm nay của bạn.')
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
      unit: employee.unit || 'store',
      employmentTypeSnapshot: employee.employmentType || null,
      payBasisSnapshot: employee.payBasis || null,
      monthlySalarySnapshot: Number(employee.monthlySalary || 0),
      hourlyRateSnapshot: Number(employee.hourlyRate || 0),
      standardWorkDaysSnapshot: Number(employee.standardWorkDays || 0),
      shift: shiftId,
      shiftId,
      shiftName: shift.name || shiftId,
      shiftStart: times.start.label,
      shiftEnd: times.end.label,
      shiftVersion: Number(shift.version || 1),
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
  const revenue = relatedOrders.reduce((sum, order) => sum + Number(order.amount || 0), 0)
  const cash = relatedOrders
    .filter((order) => order.paymentMethod === 'Tiền mặt')
    .reduce((sum, order) => sum + Number(order.amount || 0), 0)
  const shiftExpense = payload.expense == null ? 0 : asVnd(payload.expense, 'Chi phí trong ca')
  if (shiftExpense > 0) assertAccountingPeriodOpen(state, storeId, localNow.date.slice(0, 7))
  const updatedRecord = {
    ...openRecord,
    checkOut: localNow.time,
    checkOutTime: localNow.time,
    checkOutAt: commandContext.now,
    checkOutLocation: location,
    departureTag: shiftEnd && departureDelta < 0 ? 'Về sớm' : 'Đã ra về',
    workedSeconds,
    workedMinutes: workedSeconds / 60,
    hours: workedSeconds / 3_600,
    revenue,
    cash,
    transfer: revenue - cash,
    orderCount: relatedOrders.length,
    expense: shiftExpense,
    tiktok: Boolean(payload.tiktok),
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
    metadata: { storeId, shiftId: openRecord.shiftId || openRecord.shift, shiftExpense, serverTimestamp: commandContext.now },
    response: { command: body.type, attendance: updatedRecord, expense: expenseEntry },
  }, commandContext)
}

const orderCreateCommand = async (db, actor, body, commandContext) => {
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
  const employeeId = actor.role === 'employee'
    ? String(actor.employee_id || actor.user_id)
    : (String(payload.employeeId || '') || null)
  const employee = employeeId
    ? (Array.isArray(state.employees) ? state.employees : [])
      .find((record) => String(record.id || record.code || '') === employeeId && !record.deletedAt)
    : null
  const employeeStatus = normalizeTextKey(employee?.status)
  const employeeInactive = ['da nghi viec', 'tam ngung', 'inactive', 'locked'].includes(employeeStatus)
  if (actor.role === 'employee' && (!employee || employeeInactive)) {
    throw new ApiError(409, 'EMPLOYEE_PROFILE_MISSING', 'Tài khoản chưa được liên kết với hồ sơ nhân viên hợp lệ.')
  }
  if (employee && String(employee.storeId || '') !== storeId) {
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
  const counterVersion = Number(counter?.version || 0)
  if (!Number.isSafeInteger(counterValue) || counterValue >= 99_999) {
    throw new ApiError(409, 'ORDER_COUNTER_EXHAUSTED', 'Dãy mã đơn hàng của cửa hàng đã hết.')
  }
  const nextCounterValue = counterValue + 1
  const nextCounterVersion = counterVersion + 1
  const code = `${storeCode}-${String(nextCounterValue).padStart(5, '0')}`
  const order = {
    id: `ord_${crypto.randomUUID()}`,
    code,
    storeId,
    customerName,
    customerPhone,
    customerAge,
    amount,
    paymentMethod: payload.paymentMethod,
    employeeId,
    employeeName: employee?.name || actor.display_name || 'Quản trị viên',
    shiftId,
    shiftName: openAttendance?.shiftName || shiftDefinition?.name || String(payload.shiftName || '').trim().slice(0, 120) || 'Chưa gắn ca',
    shiftStart: openAttendance?.shiftStart || times.start?.label || null,
    shiftEnd: openAttendance?.shiftEnd || times.end?.label || null,
    attendanceId: openAttendance?.id || null,
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
  const nextStateJson = JSON.stringify(nextState)
  if (textEncoder.encode(nextStateJson).byteLength > MAX_STATE_BYTES) {
    throw new ApiError(413, 'STATE_TOO_LARGE', 'Trạng thái dùng chung vượt quá giới hạn cho phép.')
  }
  const nextVersion = currentVersion + 1
  const responseBody = apiPayload(commandContext, { command: body.type, version: nextVersion, order, notification })
  const responseJson = JSON.stringify(responseBody)
  const stateMutation = db.prepare(`
    UPDATE app_state
    SET value_json = ?, version = ?, updated_at = ?, updated_by = ?, last_request_id = ?
    WHERE scope_key = 'global' AND version = ?
  `).bind(nextStateJson, nextVersion, commandContext.now, actor.user_id, commandContext.requestId, currentVersion)
  const counterMutation = counter
    ? db.prepare(`
        UPDATE counters
        SET counter_value = ?, version = ?, updated_at = ?, last_request_id = ?
        WHERE counter_name = ? AND version = ?
      `).bind(nextCounterValue, nextCounterVersion, commandContext.now, commandContext.requestId, counterName, counterVersion)
    : db.prepare(`
        INSERT OR IGNORE INTO counters (counter_name, counter_value, version, updated_at, last_request_id)
        VALUES (?, 1, 1, ?, ?)
      `).bind(counterName, commandContext.now, commandContext.requestId)

  let results
  try {
    results = await db.batch([
      stateMutation,
      counterMutation,
      db.prepare(`
        INSERT INTO audit_log (
          request_id, actor_id, actor_role, action, entity_type, entity_id,
          before_json, after_json, metadata_json, server_timestamp
        )
        SELECT ?, ?, ?, 'order.create', 'order', ?, NULL, ?, ?, ?
        WHERE EXISTS (
          SELECT 1 FROM app_state WHERE scope_key = 'global' AND version = ? AND last_request_id = ?
        ) AND EXISTS (
          SELECT 1 FROM counters WHERE counter_name = ? AND version = ? AND last_request_id = ?
        )
      `).bind(
        commandContext.requestId,
        actor.user_id,
        actor.role,
        order.id,
        JSON.stringify(order),
        JSON.stringify({ storeId, counterName, counterValue: nextCounterValue }),
        commandContext.now,
        nextVersion,
        commandContext.requestId,
        counterName,
        nextCounterVersion,
        commandContext.requestId,
      ),
      db.prepare(`
        INSERT INTO command_receipts (
          actor_id, idempotency_key, request_hash, response_json, status_code, created_at
        ) VALUES (
          ?, ?,
          (SELECT ? WHERE EXISTS (
            SELECT 1 FROM app_state WHERE scope_key = 'global' AND version = ? AND last_request_id = ?
          ) AND EXISTS (
            SELECT 1 FROM counters WHERE counter_name = ? AND version = ? AND last_request_id = ?
          )),
          ?, 201, ?
        )
      `).bind(
        actor.user_id,
        commandContext.idempotencyKey,
        commandContext.hash,
        nextVersion,
        commandContext.requestId,
        counterName,
        nextCounterVersion,
        commandContext.requestId,
        responseJson,
        commandContext.now,
      ),
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
  return jsonResponse(responseBody, 201)
}

const orderMutationCommand = async (db, actor, body, commandContext) => {
  assertAdmin(actor, 'Chỉ quản trị viên được sửa hoặc xóa đơn hàng.')
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
    changedFields = ['customerName', 'customerPhone', 'customerAge', 'amount', 'paymentMethod']
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
  if (String(previous.storeId || '') !== storeId) {
    throw new ApiError(403, 'TASK_FORBIDDEN', 'Công việc không thuộc cửa hàng của bạn.')
  }
  const hasExplicitAssignee = Boolean(employeeReference(previous))
    || (Array.isArray(previous.employeeIds) && previous.employeeIds.length > 0)
    || (Array.isArray(previous.assignees) && previous.assignees.length > 0)
  if (hasExplicitAssignee && !belongsToEmployee(previous, employeeId)) {
    throw new ApiError(403, 'TASK_FORBIDDEN', 'Công việc không được giao cho bạn.')
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
    updatedAt: commandContext.now,
    updatedBy: serverActorSnapshot(actor),
  }
  const nextState = {
    ...state,
    tasks: tasks.map((task) => String(task.id || '') === taskId ? next : task),
    stateVersion: Math.max(1, Number(state.stateVersion) || 1) + 1,
  }
  return commitGlobalStateDomainCommand(db, actor, current, nextState, {
    action: body.type,
    entityType: 'task-completion',
    entityId: `${taskId}:${employeeId}`,
    before: { taskId, employeeId, done: Boolean(completedBy[employeeId]) },
    after: { taskId, employeeId, done: payload.done },
    metadata: { taskId, employeeId, storeId },
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
  assertAdmin(actor, 'Chỉ quản trị viên được quản lý chi phí.')
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
  const items = value.map((item, index) => {
    if (!isPlainRecord(item)) throw new ApiError(400, 'IMPORT_ITEM_INVALID', `Mặt hàng thứ ${index + 1} không hợp lệ.`)
    const name = String(item.name || '').trim()
    const category = String(item.category || 'Khác').trim()
    const note = String(item.note || '').trim()
    const quantity = Number(item.quantity)
    const price = asVnd(item.price, `Đơn giá mặt hàng thứ ${index + 1}`, { positive: true })
    if (!name || name.length > 160 || !category || category.length > 120 || note.length > 500) {
      throw new ApiError(400, 'IMPORT_ITEM_INVALID', `Thông tin mặt hàng thứ ${index + 1} không hợp lệ.`)
    }
    if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 1_000_000) {
      throw new ApiError(400, 'IMPORT_QUANTITY_INVALID', `Số lượng mặt hàng thứ ${index + 1} phải là số dương.`)
    }
    const lineAmount = Math.round(quantity * price)
    if (!Number.isSafeInteger(lineAmount) || lineAmount <= 0 || lineAmount > MAX_MONEY_VND) {
      throw new ApiError(400, 'IMPORT_TOTAL_INVALID', `Thành tiền mặt hàng thứ ${index + 1} không hợp lệ.`)
    }
    goodsAmount = safeMoneySum(goodsAmount, lineAmount, 'Tổng tiền hàng')
    if (goodsAmount > MAX_MONEY_VND) {
      throw new ApiError(400, 'IMPORT_TOTAL_INVALID', 'Tổng tiền hàng vượt quá giới hạn cho phép.')
    }
    return { name, category, quantity, price, note, lineAmount }
  })
  return { items, goodsAmount }
}

const importVoucherCommand = async (db, actor, body, commandContext) => {
  assertAdmin(actor, 'Chỉ quản trị viên được quản lý phiếu nhập.')
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
    requireStore(state, storeId)
    const { items, goodsAmount } = normalizeImportItems(payload.items)
    const shippingAmount = asVnd(payload.shippingAmount ?? 0, 'Phí vận chuyển')
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
      const match = String(voucher.code || '').match(/-(\d{5})$/u)
      return match ? Math.max(maximum, Number(match[1])) : maximum
    }, 0)
    const baseValue = Math.max(Number(counterRow?.counter_value || 0), historicalMax)
    if (!Number.isSafeInteger(baseValue) || baseValue >= 99_999) {
      throw new ApiError(409, 'IMPORT_COUNTER_EXHAUSTED', 'Dãy mã phiếu nhập đã hết.')
    }
    const nextValue = baseValue + 1
    const localNow = localDateTimeParts(commandContext.now)
    const [year, month, day] = localNow.date.split('-')
    const voucher = {
      id: `imp_${crypto.randomUUID()}`,
      code: `PN-${day}${month}${year}-${String(nextValue).padStart(5, '0')}`,
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
      ? { items: previous.items, goodsAmount: Number(previous.goodsAmount || 0) }
      : normalizeImportItems(payload.items)
    const shippingAmount = payload.shippingAmount === undefined
      ? asVnd(previous.shippingAmount || 0, 'Phí vận chuyển')
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
  assertAdmin(actor, 'Chỉ quản trị viên được tạo khoản điều chỉnh lương.')
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
  assertAdmin(actor, 'Chỉ quản trị viên được quản lý ứng lương.')
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
    const period = asMonth(payload.period)
    const storeId = String(employee.storeId || '')
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
  assertAdmin(actor, 'Chỉ quản trị viên được xử lý kỳ lương.')
  const payload = isPlainRecord(body.payload) ? body.payload : {}
  const operation = body.type.split('.').at(-1)
  if (!['close', 'pay', 'lock'].includes(operation)) {
    throw new ApiError(400, 'COMMAND_UNKNOWN', 'Lệnh kỳ lương không được hỗ trợ.')
  }
  const { current, state } = await loadGlobalCommandState(db, body)
  const storeId = String(payload.storeId || '').trim()
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
  if (user.role !== 'admin') throw new ApiError(403, 'ROLE_FORBIDDEN', 'Chỉ quản trị viên được thay đổi chính sách.')
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
  if (user.role !== 'admin') throw new ApiError(403, 'ROLE_FORBIDDEN', 'Chỉ quản trị viên được thay đổi chính sách.')
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
      SELECT ?, ?, 'admin', 'policies.set', 'policy-set', 'global', ?, ?, ?, ?
      WHERE (
        SELECT COUNT(*) FROM policies
        WHERE policy_key IN (${placeholders}) AND last_request_id = ?
      ) = ?
    `).bind(
      commandContext.requestId,
      user.user_id,
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
  if (actor.role !== 'admin') {
    throw new ApiError(403, 'ROLE_FORBIDDEN', 'Chỉ quản trị viên được quản lý tài khoản nhân viên.')
  }
  const payload = isPlainRecord(body.payload) ? body.payload : {}

  if (body.type === 'user.create') {
    const username = String(payload.username || '').trim()
    const normalizedUsername = normalizeUsername(username)
    const storeId = String(payload.storeId || '').trim()
    const employeeId = String(payload.employeeId || '').trim()
    const displayName = String(payload.displayName || '').trim().slice(0, 160)
    if (!/^[A-Za-z0-9._-]{3,80}$/u.test(username)) {
      throw new ApiError(400, 'INVALID_USERNAME', 'Tên đăng nhập nhân viên không hợp lệ.')
    }
    if (!/^[A-Za-z0-9_-]{1,80}$/u.test(storeId) || !/^[A-Za-z0-9_-]{1,80}$/u.test(employeeId)) {
      throw new ApiError(400, 'EMPLOYEE_SCOPE_INVALID', 'Nhân viên cần mã cửa hàng và mã nhân viên hợp lệ.')
    }
    const globalState = await loadState(db, 'global')
    const state = normalizeSharedStateForStorage(parseStoredJson(globalState?.value_json, {}))
    const employeeProfile = (Array.isArray(state.employees) ? state.employees : [])
      .find((record) => String(record.id || record.code || '') === employeeId && !record.deletedAt)
    const validStore = (Array.isArray(state.stores) ? state.stores : []).some((store) => (
      String(store.id || '') === storeId && !store.deletedAt
    ))
    const validOffice = storeId === 'OFFICE'
    if (!validStore && !validOffice) {
      throw new ApiError(400, 'STORE_INVALID', 'Đơn vị gán cho nhân viên không tồn tại.')
    }
    if (employeeProfile && String(employeeProfile.storeId || '') !== storeId) {
      throw new ApiError(400, 'EMPLOYEE_STORE_MISMATCH', 'Hồ sơ nhân viên không thuộc cửa hàng đã chọn.')
    }
    const existing = await first(db, `
      SELECT id FROM users WHERE username_normalized = ? OR employee_id = ? LIMIT 1
    `, normalizedUsername, employeeId)
    if (existing) throw new ApiError(409, 'USER_EXISTS', 'Tên đăng nhập hoặc mã nhân viên đã tồn tại.')
    const password = await hashPassword(payload.password)
    const userId = `usr_${crypto.randomUUID()}`
    const responseUser = {
      id: userId,
      username,
      displayName: displayName || employeeId,
      role: 'employee',
      storeId,
      employeeId,
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
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'employee', 'active', 1, ?, ?, ?, ?, ?)
        `).bind(
          userId,
          username,
          normalizedUsername,
          responseUser.displayName,
          password.hash,
          password.salt,
          password.iterations,
          password.algorithm,
          storeId,
          employeeId,
          commandContext.now,
          commandContext.now,
          commandContext.now,
        ),
        db.prepare(`
          INSERT INTO audit_log (
            request_id, actor_id, actor_role, action, entity_type, entity_id,
            before_json, after_json, metadata_json, server_timestamp
          ) VALUES (?, ?, 'admin', 'user.create', 'user', ?, NULL, ?, NULL, ?)
        `).bind(
          commandContext.requestId,
          actor.user_id,
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
        SELECT id FROM users WHERE username_normalized = ? OR employee_id = ? LIMIT 1
      `, normalizedUsername, employeeId)
      if (raced) throw new ApiError(409, 'USER_EXISTS', 'Tên đăng nhập hoặc mã nhân viên đã tồn tại.')
      throw error
    }
    return jsonResponse(responseBody, 201)
  }

  if (!['user.update', 'user.set_status', 'user.reset_password'].includes(body.type)) {
    throw new ApiError(400, 'COMMAND_UNKNOWN', 'Lệnh tài khoản không được hỗ trợ.')
  }
  const userId = String(payload.userId || '')
  const target = await first(db, 'SELECT * FROM users WHERE id = ? AND role = \'employee\' LIMIT 1', userId)
  if (!target) throw new ApiError(404, 'USER_NOT_FOUND', 'Không tìm thấy tài khoản nhân viên.')
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
    const storeId = payload.storeId === undefined ? target.store_id : String(payload.storeId || '').trim()
    if (!/^[A-Za-z0-9._-]{3,80}$/u.test(username)) {
      throw new ApiError(400, 'INVALID_USERNAME', 'Tên đăng nhập nhân viên không hợp lệ.')
    }
    if (!displayName) throw new ApiError(400, 'DISPLAY_NAME_INVALID', 'Tên hiển thị không được để trống.')
    if (!/^[A-Za-z0-9_-]{1,80}$/u.test(storeId)) {
      throw new ApiError(400, 'EMPLOYEE_SCOPE_INVALID', 'Mã cửa hàng không hợp lệ.')
    }
    const globalState = await loadState(db, 'global')
    const state = normalizeSharedStateForStorage(parseStoredJson(globalState?.value_json, {}))
    const validStore = (Array.isArray(state.stores) ? state.stores : []).some((store) => (
      String(store.id || '') === storeId && !store.deletedAt
    ))
    const validOffice = storeId === 'OFFICE'
    if (!validStore && !validOffice) {
      throw new ApiError(400, 'STORE_INVALID', 'Đơn vị gán cho nhân viên không tồn tại.')
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
        SELECT ?, ?, 'admin', 'user.update', 'user', ?, ?, ?, ?, ?
        WHERE EXISTS (SELECT 1 FROM users WHERE id = ? AND version = ? AND updated_at = ?)
      `).bind(
        commandContext.requestId,
        actor.user_id,
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
        SELECT ?, ?, 'admin', 'user.set_status', 'user', ?, ?, ?, NULL, ?
        WHERE EXISTS (SELECT 1 FROM users WHERE id = ? AND version = ? AND updated_at = ?)
      `).bind(
        commandContext.requestId,
        actor.user_id,
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
      SELECT ?, ?, 'admin', 'user.reset_password', 'user', ?, NULL, ?, NULL, ?
      WHERE EXISTS (SELECT 1 FROM users WHERE id = ? AND version = ? AND updated_at = ?)
    `).bind(
      commandContext.requestId,
      actor.user_id,
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
    if (body.type === 'policy.set') return await policyCommand(db, user, body, commandContext)
    if (body.type === 'policies.set') return await policiesCommand(db, user, body, commandContext)
    if (body.type === 'attendance.check_in' || body.type === 'attendance.check_out') {
      return await attendanceCommand(db, user, body, commandContext)
    }
    if (body.type === 'order.create') return await orderCreateCommand(db, user, body, commandContext)
    if (body.type === 'order.update' || body.type === 'order.delete') {
      return await orderMutationCommand(db, user, body, commandContext)
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
  if (actor.role !== 'admin') throw new ApiError(403, 'ROLE_FORBIDDEN', 'Chỉ quản trị viên được xem tài khoản nhân viên.')
  const rows = await all(db, `
    SELECT id, username, display_name, role, status, version, store_id, employee_id, last_login_at
    FROM users
    WHERE role = 'employee'
    ORDER BY display_name, username
  `)
  return jsonResponse(apiPayload(context, { users: rows.map(publicUser) }))
}

const listAudit = async (request, env, context, url) => {
  const db = getDatabase(env)
  const user = await requireSession(request, db, context)
  if (user.role !== 'admin') throw new ApiError(403, 'ROLE_FORBIDDEN', 'Chỉ quản trị viên được xem nhật ký hệ thống.')
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit')) || 50))
  const beforeId = Number(url.searchParams.get('beforeId'))
  const rows = Number.isInteger(beforeId) && beforeId > 0
    ? await all(db, `
        SELECT * FROM audit_log WHERE id < ? ORDER BY id DESC LIMIT ?
      `, beforeId, limit)
    : await all(db, 'SELECT * FROM audit_log ORDER BY id DESC LIMIT ?', limit)
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
