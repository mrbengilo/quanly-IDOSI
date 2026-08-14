import {
  attendanceSeed,
  employeesSeed,
  importsSeed,
  officeAdjustmentsSeed,
  scheduleSeed,
  storesSeed,
  tasksSeed,
} from '../src/data.js'
import { createDomainState } from '../src/state/initialDomainState.js'

const baseUrl = String(process.env.IDOSI_BASE_URL || '').replace(/\/$/u, '')
const bootstrapToken = process.env.BOOTSTRAP_TOKEN
const adminPassword = process.env.IDOSI_ADMIN_PASSWORD

if (!baseUrl || !bootstrapToken || !adminPassword) {
  throw new Error('Cần IDOSI_BASE_URL, BOOTSTRAP_TOKEN và IDOSI_ADMIN_PASSWORD.')
}

const clone = (value) => JSON.parse(JSON.stringify(value))
const dateParts = Object.fromEntries(new Intl.DateTimeFormat('en', {
  timeZone: 'Asia/Ho_Chi_Minh',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).formatToParts(new Date()).map((part) => [part.type, part.value]))
const workDate = `${dateParts.year}-${dateParts.month}-${dateParts.day}`
const employees = clone(employeesSeed).map((employee) => Object.fromEntries(
  Object.entries(employee).filter(([key]) => !['password', 'passwordHash', 'legacyPassword'].includes(key)),
))
const stores = clone(storesSeed).map((store) => ({
  ...store,
  employees: employees.filter((employee) => employee.unit === 'store' && employee.storeId === store.id && employee.status !== 'Đã nghỉ việc').length,
}))
const imports = clone(importsSeed)
const initialState = {
  stores,
  employees,
  imports,
  attendance: clone(attendanceSeed),
  schedule: clone(scheduleSeed),
  tasks: clone(tasksSeed).map((task) => ({ ...task, storeId: stores[0]?.id, shiftId: 'ca1', date: workDate })),
  officeAdjustments: clone(officeAdjustmentsSeed),
  activeStoreId: stores[0]?.id || null,
  settings: {
    name: 'Admin',
    email: 'admin@idosi.vn',
    phone: '0901000000',
    bio: 'Quản trị HỆ THỐNG QUẢN LÝ IDOSI.',
  },
  ...createDomainState({ stores, imports }),
}

const call = async (path, { method = 'GET', token, headers = {}, body } = {}) => {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      accept: 'application/json',
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(payload.error?.message || payload.message || `${method} ${path} thất bại (${response.status}).`)
    error.code = payload.error?.code || payload.code
    error.status = response.status
    throw error
  }
  return payload
}

let initialized = false
try {
  const bootstrap = await call('/api/bootstrap', {
    method: 'POST',
    headers: { 'x-idosi-bootstrap-token': bootstrapToken },
    body: {
      username: 'admin',
      password: adminPassword,
      displayName: 'Admin',
      initialState,
    },
  })
  initialized = !bootstrap.alreadyInitialized
} catch (error) {
  if (error.code !== 'SYSTEM_ALREADY_INITIALIZED' && error.status !== 409) throw error
}

const login = await call('/api/login', {
  method: 'POST',
  body: { username: 'admin', password: adminPassword },
})
const token = login.token
const usersPayload = await call('/api/users', { token })
const nonAdminUsers = usersPayload.users || []
if (nonAdminUsers.length) {
  throw new Error(`Sau khởi tạo chỉ được phép có tài khoản Admin; phát hiện ${nonAdminUsers.length} tài khoản khác.`)
}

const state = await call('/api/state?scope=global', { token })
await call('/api/logout', { method: 'POST', token })

console.log(JSON.stringify({
  initialized,
  nonAdminUsers: nonAdminUsers.length,
  stateVersion: state.version,
  stores: Array.isArray(state.state?.stores) ? state.state.stores.length : 0,
  employees: Array.isArray(state.state?.employees) ? state.state.employees.length : 0,
}))
