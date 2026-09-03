const TOKEN_KEY = 'idosi-api-session-v1'
const DEFAULT_TIMEOUT_MS = 12_000
const LOGIN_TIMEOUT_MS = 30_000
const STATE_READ_TIMEOUT_MS = 30_000
const STATE_READ_RETRIES = 1
const REVENUE_BONUS_LIVE_TIMEOUT_MS = 15_000
const REVENUE_BONUS_PERIOD_TIMEOUT_MS = 20_000
const RETRY_DELAY_MS = 250
const PRODUCTION_LOGIN_URL = 'https://idosi.io.vn/#/login'

export class IdosiApiError extends Error {
  constructor(message, { status = 0, code = 'NETWORK_ERROR', details = null } = {}) {
    super(message)
    this.name = 'IdosiApiError'
    this.status = status
    this.code = code
    this.details = details
  }
}

const readToken = () => {
  try {
    return window.sessionStorage.getItem(TOKEN_KEY) || ''
  } catch {
    return ''
  }
}

const writeToken = (token) => {
  try {
    if (token) window.sessionStorage.setItem(TOKEN_KEY, token)
    else window.sessionStorage.removeItem(TOKEN_KEY)
  } catch {
    // Phiên vẫn dùng được trong bộ nhớ của trang nếu sessionStorage bị chặn.
  }
}

let memoryToken = readToken()

export const hasApiSession = () => Boolean(memoryToken || readToken())
export const clearApiSession = () => {
  memoryToken = ''
  writeToken('')
}

const requestOnce = async (path, {
  method = 'GET',
  body,
  token = memoryToken || readToken(),
  headers = {},
  timeoutMs = DEFAULT_TIMEOUT_MS,
  timeoutMessage = 'Máy chủ phản hồi quá chậm. Vui lòng thử lại.',
} = {}) => {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(path, {
      method,
      cache: 'no-store',
      credentials: 'same-origin',
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    const payload = await response.json().catch(() => null)
    if (!response.ok || payload?.ok === false) {
      const error = payload?.error || {}
      throw new IdosiApiError(error.message || `Máy chủ trả về lỗi ${response.status}.`, {
        status: response.status,
        code: error.code || `HTTP_${response.status}`,
        details: error.details,
      })
    }
    return payload
  } catch (error) {
    if (error instanceof IdosiApiError) throw error
    if (error?.name === 'AbortError') throw new IdosiApiError(timeoutMessage, { code: 'TIMEOUT' })
    throw new IdosiApiError('Không thể kết nối máy chủ IDOSI.', { code: 'NETWORK_ERROR', details: error?.message })
  } finally {
    window.clearTimeout(timeout)
  }
}

const retryableReadError = (error) => ['NETWORK_ERROR', 'TIMEOUT'].includes(error?.code)

const request = async (path, options = {}) => {
  const { retries = 0, retryDelayMs = RETRY_DELAY_MS, ...requestOptions } = options
  const method = String(requestOptions.method || 'GET').toUpperCase()
  const allowedRetries = ['GET', 'HEAD'].includes(method) ? Math.max(0, Number(retries) || 0) : 0
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await requestOnce(path, requestOptions)
    } catch (error) {
      if (attempt >= allowedRetries || !retryableReadError(error)) throw error
      await new Promise((resolveRetry) => window.setTimeout(resolveRetry, retryDelayMs))
    }
  }
}

export const apiLogin = async (username, password) => {
  const payload = await request('/api/login', {
    method: 'POST',
    body: { username, password },
    token: '',
    timeoutMs: LOGIN_TIMEOUT_MS,
    timeoutMessage: 'Máy chủ chưa phản hồi sau 30 giây. Vui lòng tải lại trang rồi thử đăng nhập lại.',
  })
  if (!payload?.token || !payload?.user) {
    throw new IdosiApiError(
      `Phản hồi đăng nhập không hợp lệ. Vui lòng mở đúng địa chỉ ${PRODUCTION_LOGIN_URL} và tải lại trang.`,
      { code: 'API_UNAVAILABLE' },
    )
  }
  memoryToken = payload.token
  writeToken(payload.token)
  return payload
}

export const apiSelectSessionRole = (selection) => request('/api/session/role', {
  method: 'POST',
  body: selection,
})

const stateReadRequest = (path, options = {}) => request(path, {
  timeoutMs: STATE_READ_TIMEOUT_MS,
  timeoutMessage: 'Máy chủ tải dữ liệu quá chậm. Vui lòng thử lại.',
  retries: STATE_READ_RETRIES,
  ...options,
})

export const apiBootstrapState = (scope = 'global', { profile = '', ...options } = {}) => {
  const query = new URLSearchParams({ scope })
  if (profile) query.set('profile', profile)
  return stateReadRequest(`/api/bootstrap?${query.toString()}`, options)
}
export const apiGetState = (scope = 'global', options = {}) => stateReadRequest(
  `/api/state?scope=${encodeURIComponent(scope)}`,
  options,
)
export const apiGetStoreWorkspaceState = (storeId, { screen = '', ...options } = {}) => {
  if (screen) return apiGetStoreScreenState(storeId, screen, options)
  const query = new URLSearchParams({
    scope: 'global',
    view: 'store',
    storeId: String(storeId || ''),
  })
  return stateReadRequest(`/api/state?${query.toString()}`, options)
}
export const apiGetStoreScreenState = (storeId, screen, { period = '', ...options } = {}) => {
  const query = new URLSearchParams({ storeId: String(storeId || '') })
  if (period) query.set('period', String(period))
  return stateReadRequest(
    `/api/store-screens/${encodeURIComponent(String(screen || ''))}?${query.toString()}`,
    options,
  )
}
export const apiGetSystemScreenState = (screen, options = {}) => stateReadRequest(
  `/api/system-screens/${encodeURIComponent(String(screen || ''))}`,
  options,
)
export const apiGetStateMetadata = (scope = 'global') => request(`/api/state-metadata?scope=${encodeURIComponent(scope)}`)
export const apiGetFinanceOverview = (period) => stateReadRequest(
  `/api/finance-overview?period=${encodeURIComponent(String(period || ''))}`,
)
export const apiGetHistory = (kind, {
  storeId,
  employeeId = '',
  period = '',
  cursor = '',
  limit = 50,
} = {}) => {
  const query = new URLSearchParams({
    storeId: String(storeId || ''),
    limit: String(limit),
  })
  if (employeeId) query.set('employeeId', String(employeeId))
  if (period) query.set('period', String(period))
  if (cursor) query.set('cursor', String(cursor))
  return stateReadRequest(`/api/history/${encodeURIComponent(String(kind || ''))}?${query.toString()}`)
}
export const apiGetRevenueBonusLive = ({ storeId, businessDate }) => {
  const query = new URLSearchParams({
    storeId: String(storeId || ''),
    businessDate: String(businessDate || ''),
  })
  return request(`/api/revenue-bonus/live?${query.toString()}`, {
    timeoutMs: REVENUE_BONUS_LIVE_TIMEOUT_MS,
    timeoutMessage: 'Máy chủ chưa cập nhật được trạng thái tính thưởng. Hệ thống sẽ tự thử lại.',
    retries: 1,
  })
}

export const apiGetRevenueBonusPeriod = ({ storeId, period }) => {
  const query = new URLSearchParams({
    storeId: String(storeId || ''),
    period: String(period || ''),
  })
  return request(`/api/revenue-bonus/period?${query.toString()}`, {
    timeoutMs: REVENUE_BONUS_PERIOD_TIMEOUT_MS,
    timeoutMessage: 'Máy chủ chưa tải được lịch sử thưởng doanh thu. Hệ thống sẽ tự thử lại.',
    retries: 1,
  })
}

export const apiCommand = (type, payload, {
  expectedVersion = 0,
  scope = 'global',
  idempotencyKey = `${type}:${crypto.randomUUID()}`,
  includeState = true,
} = {}) => request('/api/command', {
  method: 'POST',
  headers: { 'Idempotency-Key': idempotencyKey },
  body: {
    type,
    scope,
    expectedVersion,
    payload,
    ...(includeState === false ? { includeState: false } : {}),
  },
})

export const apiListUsers = (options = {}) => stateReadRequest('/api/users', options)

export const apiGetAudit = ({ limit = 100, beforeId = 0 } = {}, options = {}) => {
  const query = new URLSearchParams({ limit: String(limit) })
  if (Number(beforeId) > 0) query.set('beforeId', String(beforeId))
  return stateReadRequest(`/api/audit?${query.toString()}`, options)
}

export const apiAddressSuggestions = (params = {}) => {
  const query = new URLSearchParams()
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && String(value).trim()) query.set(key, String(value).trim())
  })
  return request(`/api/address-suggestions?${query.toString()}`)
}

const apiGetAvatarBlob = async (path, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) => {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs)
  try {
    const token = memoryToken || readToken()
    const response = await fetch(path, {
      method: 'GET',
      cache: 'no-store',
      credentials: 'same-origin',
      signal: controller.signal,
      headers: {
        Accept: 'image/jpeg,image/png,image/webp,image/gif',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    })
    if (!response.ok) {
      const payload = await response.json().catch(() => null)
      const error = payload?.error || {}
      throw new IdosiApiError(error.message || `Máy chủ trả về lỗi ${response.status}.`, {
        status: response.status,
        code: error.code || `HTTP_${response.status}`,
        details: error.details,
      })
    }
    const blob = await response.blob()
    if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(String(blob.type || ''))) {
      throw new IdosiApiError('Máy chủ trả về ảnh đại diện không hợp lệ.', { code: 'ACCOUNT_AVATAR_INVALID' })
    }
    return blob
  } catch (error) {
    if (error instanceof IdosiApiError) throw error
    if (error?.name === 'AbortError') throw new IdosiApiError('Máy chủ phản hồi quá chậm. Vui lòng thử lại.', { code: 'TIMEOUT' })
    throw new IdosiApiError('Không thể tải ảnh đại diện.', { code: 'NETWORK_ERROR', details: error?.message })
  } finally {
    window.clearTimeout(timeout)
  }
}

export const apiGetAccountAvatar = (options = {}) => apiGetAvatarBlob('/api/account-avatar', options)

// Authorized personnel-avatar contract. The backend resolves the canonical
// employee profile and enforces actor scope before returning any bytes:
// Admin/HTKD may read every active store, Store Manager only their store, and
// an Employee only their own profile. Keeping this separate from the current
// account endpoint prevents list rows from accidentally reusing the session
// avatar.
export const apiGetEmployeeAvatar = (employeeId, options = {}) => {
  const normalizedEmployeeId = String(employeeId || '').trim()
  if (!normalizedEmployeeId) {
    return Promise.reject(new IdosiApiError('Thiếu mã nhân viên cần tải ảnh đại diện.', {
      status: 400,
      code: 'EMPLOYEE_AVATAR_ID_REQUIRED',
    }))
  }
  return apiGetAvatarBlob(`/api/account-avatars/${encodeURIComponent(normalizedEmployeeId)}`, options)
}

export const apiGetIdentityImage = async (employeeId, side, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) => {
  const normalizedSide = side === 'back' ? 'back' : 'front'
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs)
  try {
    const token = memoryToken || readToken()
    const response = await fetch(`/api/identity-images/${encodeURIComponent(employeeId)}/${normalizedSide}`, {
      method: 'GET',
      cache: 'no-store',
      credentials: 'same-origin',
      signal: controller.signal,
      headers: {
        Accept: 'image/jpeg,image/png,image/webp',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    })
    if (!response.ok) {
      const payload = await response.json().catch(() => null)
      const error = payload?.error || {}
      throw new IdosiApiError(error.message || `Máy chủ trả về lỗi ${response.status}.`, {
        status: response.status,
        code: error.code || `HTTP_${response.status}`,
        details: error.details,
      })
    }
    const blob = await response.blob()
    if (!String(blob.type || '').startsWith('image/')) {
      throw new IdosiApiError('Máy chủ trả về tệp ảnh CCCD không hợp lệ.', { code: 'IDENTITY_IMAGE_INVALID' })
    }
    return blob
  } catch (error) {
    if (error instanceof IdosiApiError) throw error
    if (error?.name === 'AbortError') throw new IdosiApiError('Máy chủ phản hồi quá chậm. Vui lòng thử lại.', { code: 'TIMEOUT' })
    throw new IdosiApiError('Không thể tải hình ảnh CCCD.', { code: 'NETWORK_ERROR', details: error?.message })
  } finally {
    window.clearTimeout(timeout)
  }
}

export const apiLogout = async () => {
  if (!hasApiSession()) return
  try {
    await request('/api/logout', { method: 'POST', body: {} })
  } finally {
    clearApiSession()
  }
}

export const apiPolicyMap = (records = []) => {
  const values = Object.fromEntries(records.map((record) => [record.key, record.value]))
  const mapped = {}
  if (values.late_tolerance_minutes != null) mapped.lateToleranceMinutes = Number(values.late_tolerance_minutes)
  if (values.early_check_in_limit_minutes != null) mapped.earlyCheckInLimitMinutes = Number(values.early_check_in_limit_minutes)
  const attendanceEvaluation = {}
  if (values.attendance_maintain_max_late_count != null) attendanceEvaluation.maintainMaxLateCount = Number(values.attendance_maintain_max_late_count)
  if (values.attendance_improve_min_late_count != null) attendanceEvaluation.improveMinLateCount = Number(values.attendance_improve_min_late_count)
  if (values.attendance_improve_min_late_minutes != null) attendanceEvaluation.improveMinLateMinutes = Number(values.attendance_improve_min_late_minutes)
  if (Object.keys(attendanceEvaluation).length) mapped.attendanceEvaluation = attendanceEvaluation
  return mapped
}

export const apiPolicyEntries = (policies = {}) => [
  ['late_tolerance_minutes', Number(policies.lateToleranceMinutes)],
  ['early_check_in_limit_minutes', Number(policies.earlyCheckInLimitMinutes)],
  ['attendance_maintain_max_late_count', Number(policies.attendanceEvaluation?.maintainMaxLateCount)],
  ['attendance_improve_min_late_count', Number(policies.attendanceEvaluation?.improveMinLateCount)],
  ['attendance_improve_min_late_minutes', Number(policies.attendanceEvaluation?.improveMinLateMinutes)],
]

export const isLocalApiFallbackAllowed = () => import.meta.env.DEV || import.meta.env.MODE === 'test'
