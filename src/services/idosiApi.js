const TOKEN_KEY = 'idosi-api-session-v1'
const DEFAULT_TIMEOUT_MS = 12_000

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

const request = async (path, { method = 'GET', body, token = memoryToken || readToken(), headers = {}, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) => {
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
    if (error?.name === 'AbortError') throw new IdosiApiError('Máy chủ phản hồi quá chậm. Vui lòng thử lại.', { code: 'TIMEOUT' })
    throw new IdosiApiError('Không thể kết nối máy chủ IDOSI.', { code: 'NETWORK_ERROR', details: error?.message })
  } finally {
    window.clearTimeout(timeout)
  }
}

export const apiLogin = async (username, password) => {
  const payload = await request('/api/login', { method: 'POST', body: { username, password }, token: '' })
  if (!payload?.token || !payload?.user) {
    throw new IdosiApiError('API IDOSI chưa hoạt động trong môi trường này.', { code: 'API_UNAVAILABLE' })
  }
  memoryToken = payload.token
  writeToken(payload.token)
  return payload
}

export const apiSelectSessionRole = (selection) => request('/api/session/role', {
  method: 'POST',
  body: selection,
})

export const apiBootstrapState = (scope = 'global') => request(`/api/bootstrap?scope=${encodeURIComponent(scope)}`)
export const apiGetState = (scope = 'global') => request(`/api/state?scope=${encodeURIComponent(scope)}`)

export const apiCommand = (type, payload, {
  expectedVersion = 0,
  scope = 'global',
  idempotencyKey = `${type}:${crypto.randomUUID()}`,
} = {}) => request('/api/command', {
  method: 'POST',
  headers: { 'Idempotency-Key': idempotencyKey },
  body: { type, scope, expectedVersion, payload },
})

export const apiListUsers = () => request('/api/users')

export const apiAddressSuggestions = (params = {}) => {
  const query = new URLSearchParams()
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && String(value).trim()) query.set(key, String(value).trim())
  })
  return request(`/api/address-suggestions?${query.toString()}`)
}

export const apiGetAccountAvatar = async ({ timeoutMs = DEFAULT_TIMEOUT_MS } = {}) => {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs)
  try {
    const token = memoryToken || readToken()
    const response = await fetch('/api/account-avatar', {
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
  const employeeKpiRates = {}
  if (values.employee_kpi_percent_30000 != null) employeeKpiRates.from30000 = Number(values.employee_kpi_percent_30000)
  if (values.employee_kpi_percent_15000 != null) employeeKpiRates.from15000 = Number(values.employee_kpi_percent_15000)
  if (values.employee_kpi_percent_7000 != null) employeeKpiRates.from7000 = Number(values.employee_kpi_percent_7000)
  if (Object.keys(employeeKpiRates).length) mapped.employeeKpiRates = employeeKpiRates
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
  ['employee_kpi_percent_30000', Number(policies.employeeKpiRates?.from30000)],
  ['employee_kpi_percent_15000', Number(policies.employeeKpiRates?.from15000)],
  ['employee_kpi_percent_7000', Number(policies.employeeKpiRates?.from7000)],
  ['attendance_maintain_max_late_count', Number(policies.attendanceEvaluation?.maintainMaxLateCount)],
  ['attendance_improve_min_late_count', Number(policies.attendanceEvaluation?.improveMinLateCount)],
  ['attendance_improve_min_late_minutes', Number(policies.attendanceEvaluation?.improveMinLateMinutes)],
]

export const isLocalApiFallbackAllowed = () => import.meta.env.DEV || import.meta.env.MODE === 'test'
