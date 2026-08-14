/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useEffect, useRef, useState } from 'react'
import {
  adminAccountsSeed,
  attendanceSeed,
  employeesSeed,
  importsSeed,
  officeAdjustmentsSeed,
  scheduleSeed,
  shifts,
  storesSeed,
  tasksSeed,
} from '../data'
import {
  buildAddress,
  businessDate,
  calculateWorkedHours,
  getEmployeeType,
  getPayBasis,
  getHourlyRate,
  getMonthlySalary,
  getArrivalTag,
  getDepartureTag,
  normalizeLocation,
  normalizePhone,
  today,
  uid,
} from '../utils'
import { createDomainState, defaultPolicies, migrateDomainState } from './initialDomainState'
import { hashPassword, verifyPassword } from '../security/passwords'
import { calculateKpiBonuses, financeSummaryFromState } from '../domain'
import {
  apiBootstrapState,
  apiCommand,
  apiGetState,
  apiLogin,
  apiListUsers,
  apiLogout,
  apiPolicyEntries,
  apiPolicyMap,
  clearApiSession,
  hasApiSession,
  isLocalApiFallbackAllowed,
} from '../services/idosiApi'

const AppContext = createContext(null)
export const STORAGE_KEY = 'idosi-state-v2'
const LEGACY_STORAGE_KEY = 'idosi-manager-state-v1'

const clone = (value) => JSON.parse(JSON.stringify(value))
const REMOTE_ARRAY_KEYS = [
  'stores', 'employees', 'imports', 'attendance', 'schedule', 'tasks', 'officeAdjustments',
  'orders', 'orderAudit', 'notifications', 'expenseEntries', 'fixedExpenses', 'cashTransactions',
  'salaryAdjustments', 'salaryAdvances', 'payrollPeriods', 'payrollPayments', 'shiftDefinitions',
  'importVouchers', 'auditLogs', 'deletedStores', 'deletedEmployees', 'supportTransfers',
]
const SERVER_EXCLUDED_FIELDS = new Set([
  'password', 'passwordHash', 'password_hash', 'passwordSalt', 'password_salt', 'passwordIterations',
  'legacyPassword', 'token', 'tokenHash', 'adminAccounts', 'managerAccounts', 'managerPayroll',
  'profitShares', 'policies', 'orderCounters', 'importCounter', 'idempotencyKeys',
  'session', 'activeAttendanceId', 'checkedInAt', 'finishedShift',
])

const sharedStateSnapshot = (state) => JSON.parse(JSON.stringify(state, (key, value) => (
  SERVER_EXCLUDED_FIELDS.has(key) ? undefined : value
)))

const recordTimestamp = (record) => String(record?.updatedAt || record?.createdAt || record?.deletedAt || '')
const mergeArrayRecordKey = (record, index, origin, collection) => {
  const direct = record?.id || record?.code
  if (direct) return String(direct)
  if (collection === 'schedule' && record?.employeeId) {
    return `schedule:${record.employeeId}:${record.date || record.workDate || 'template'}`
  }
  return `${origin}-${index}`
}
const mergeRecordArrays = (remoteRows = [], localRows = [], collection = '') => {
  const records = new Map()
  remoteRows.forEach((record, index) => records.set(mergeArrayRecordKey(record, index, 'remote', collection), record))
  localRows.forEach((record, index) => {
    const key = mergeArrayRecordKey(record, index, 'local', collection)
    const remote = records.get(key)
    if (!remote || recordTimestamp(record) >= recordTimestamp(remote)) records.set(key, record)
  })
  return [...records.values()]
}

const mergeSharedState = (remoteState = {}, localState = {}) => {
  const merged = { ...remoteState, ...localState }
  REMOTE_ARRAY_KEYS.forEach((key) => {
    merged[key] = mergeRecordArrays(remoteState[key], localState[key], key)
  })
  const deletedStoreIds = new Set((merged.deletedStores || []).map((store) => String(store.id || store.storeId || '')))
  const deletedEmployeeIds = new Set((merged.deletedEmployees || []).map((employee) => String(employee.id || employee.employeeId || employee.code || '')))
  merged.stores = (merged.stores || []).filter((store) => !deletedStoreIds.has(String(store.id)))
  merged.employees = (merged.employees || []).filter((employee) => !deletedEmployeeIds.has(String(employee.id || employee.code)))
  merged.stateVersion = Math.max(Number(remoteState.stateVersion) || 0, Number(localState.stateVersion) || 0) + 1
  return merged
}
const normalizeText = (value) => String(value ?? '').trim().toLowerCase()
const isOfficeUnit = (value) => ['office', 'văn phòng', 'van phong', 'khối văn phòng', 'khoi van phong', 'vp'].includes(normalizeText(value))
const isActiveAccount = (status) => !['tạm ngưng', 'tạm nghỉ', 'đã nghỉ việc', 'inactive', 'disabled'].includes(normalizeText(status))

const addressDetailsFrom = (payload = {}) => {
  const nested = payload.addressDetails || (typeof payload.address === 'object' ? payload.address : {}) || {}
  return {
    province: String(payload.province ?? payload.addressProvince ?? nested.province ?? nested.provinceCity ?? '').trim(),
    ward: String(payload.ward ?? payload.addressWard ?? nested.ward ?? '').trim(),
    street: String(payload.street ?? payload.addressStreet ?? nested.street ?? (typeof payload.address === 'string' ? payload.address : '')).trim(),
  }
}

const normalizeCccdImages = (payload = {}) => {
  if (Array.isArray(payload.cccdImages)) return payload.cccdImages
  const image = payload.cccdImage || payload.identityImage || ''
  return image ? [image] : []
}

const normalizeEmployee = (payload = {}, fallbackStoreId = storesSeed[0]?.id) => {
  const details = addressDetailsFrom(payload)
  const proposedUnit = payload.unit ?? payload.unitType ?? payload.department ?? payload.employeeGroup
  const unit = payload.isOffice || isOfficeUnit(proposedUnit) || isOfficeUnit(payload.storeId) ? 'office' : 'store'
  const position = String(payload.position ?? payload.workPosition ?? payload.role ?? 'Nhân viên bán hàng').trim()
  const id = String(payload.id || payload.code || payload.employeeCode || uid(unit === 'office' ? 'VP' : 'NV')).trim()
  const cccdImage = payload.cccdImage || payload.identityImage || ''
  const cccdImageName = payload.cccdImageName || payload.identityImageName || ''
  const phone = normalizePhone(payload.phone)
  const storeId = unit === 'office' ? 'OFFICE' : String(payload.storeId || fallbackStoreId || '').trim()
  const employmentType = getEmployeeType(payload)
  const rawSalary = Math.max(0, Number(payload.salary) || 0)
  const hasExplicitBasis = Boolean(payload.payBasis || payload.salaryBasis || payload.salaryType || payload.salaryUnit || payload.compensationVersion >= 2)
  let payBasis = getPayBasis({ ...payload, employmentType })
  if (employmentType === 'Part-time' && !hasExplicitBasis && !Number(payload.hourlyRate) && rawSalary > 500000) {
    payBasis = 'legacy'
  }
  const monthlySalary = payBasis === 'monthly' ? getMonthlySalary({ ...payload, salary: rawSalary, payBasis }) : 0
  const hourlyRate = payBasis === 'hourly' ? getHourlyRate({ ...payload, salary: rawSalary, payBasis }) : 0
  const normalizedSalary = payBasis === 'monthly' ? monthlySalary : payBasis === 'hourly' ? hourlyRate : rawSalary

  return {
    ...payload,
    id,
    code: String(payload.code || payload.employeeCode || id).trim(),
    employeeCode: String(payload.employeeCode || payload.code || id).trim(),
    name: String(payload.name || '').trim(),
    cccd: String(payload.cccd ?? payload.citizenId ?? '').trim(),
    citizenId: String(payload.cccd ?? payload.citizenId ?? '').trim(),
    phone,
    province: details.province,
    ward: details.ward,
    street: details.street,
    addressDetails: details,
    address: buildAddress(details),
    salary: normalizedSalary,
    payBasis,
    salaryBasis: payBasis,
    salaryUnit: payBasis === 'monthly' ? 'month' : payBasis === 'hourly' ? 'hour' : 'legacy',
    monthlySalary: monthlySalary || null,
    hourlyRate: hourlyRate || null,
    legacySalary: payBasis === 'legacy' ? rawSalary : null,
    compensationVersion: payBasis === 'legacy' ? 1 : 2,
    standardWorkDays: Math.max(1, Number(payload.standardWorkDays) || 26),
    tiktokAllowance: nonNegativeInteger(payload.tiktokAllowance),
    currency: payload.currency || 'VND',
    position,
    workPosition: position,
    role: position,
    shortRole: String(payload.shortRole || position.replace(/^Nhân viên\s*/i, '')).trim(),
    age: Number(payload.age) || 0,
    cccdImage,
    cccdImageName,
    cccdImages: normalizeCccdImages(payload),
    username: String(payload.username || '').trim(),
    passwordHash: String(payload.passwordHash || ''),
    legacyPassword: payload.passwordHash ? '' : String(payload.password || ''),
    password: undefined,
    status: payload.status || 'Đang làm việc',
    unit,
    unitType: unit,
    department: unit,
    isOffice: unit === 'office',
    storeId,
    employmentType,
    employeeType: employmentType,
    color: payload.color || '#d9c2b6',
    roleType: 'employee',
    workStart: payload.workStart || (unit === 'office' ? '08:00' : '07:00'),
    workEnd: payload.workEnd || (unit === 'office' ? '17:00' : '12:00'),
  }
}

const normalizeAdmin = (payload = {}) => ({
  ...payload,
  id: payload.id || payload.code || 'ADMIN',
  code: payload.code || payload.id || 'ADMIN',
  username: String(payload.username || '').trim(),
  passwordHash: String(payload.passwordHash || ''),
  legacyPassword: payload.passwordHash ? '' : String(payload.password || ''),
  password: undefined,
  role: 'admin',
  accountType: 'admin',
  status: payload.status || 'Đang hoạt động',
})

const countStoreEmployees = (stores, employees) => stores.map((store) => ({
  ...store,
  employees: employees.filter((employee) => employee.unit === 'store' && employee.storeId === store.id && employee.status !== 'Đã nghỉ việc').length,
}))

const normalizeTask = (task = {}, fallbackStoreId = null) => ({
  ...task,
  id: task.id || uid('CV'),
  storeId: task.storeId || fallbackStoreId,
  shiftId: task.shiftId || task.shift || 'ca1',
  date: task.date || task.workDate || today(),
  title: String(task.title || '').trim(),
  detail: String(task.detail || '').trim(),
  done: Boolean(task.done),
})

export const createInitialState = () => {
  const employees = employeesSeed.map((employee) => normalizeEmployee(clone(employee)))
  const stores = countStoreEmployees(clone(storesSeed), employees)
  return {
    stores,
    adminAccounts: adminAccountsSeed.map((account) => normalizeAdmin(clone(account))),
    employees,
    imports: clone(importsSeed),
    attendance: clone(attendanceSeed),
    schedule: clone(scheduleSeed),
    tasks: clone(tasksSeed).map((task) => normalizeTask(task, storesSeed[0]?.id)),
    officeAdjustments: clone(officeAdjustmentsSeed),
    activeStoreId: storesSeed[0]?.id || null,
    activeAttendanceId: null,
    session: null,
    checkedInAt: null,
    finishedShift: false,
    settings: {
      name: 'Quản trị cấp cao',
      email: 'admin@idosi.vn',
      phone: '0901000000',
      birthday: '1990-05-15',
      gender: 'Nam',
      address: 'TP. Hồ Chí Minh',
      bio: 'Quản trị HỆ THỐNG QUẢN LÝ IDOSI.',
    },
    ...createDomainState({ stores, imports: importsSeed }),
  }
}

const hydrateState = (stored) => {
  const base = createInitialState()
  if (!stored || typeof stored !== 'object') return base
  const safeStored = Object.fromEntries(Object.entries(stored).filter(([key]) => !['managerAccounts', 'managerPayroll', 'profitShares'].includes(key)))
  const employees = Array.isArray(safeStored.employees)
    ? safeStored.employees.map((employee) => normalizeEmployee(employee, safeStored.activeStoreId || base.activeStoreId))
    : base.employees
  const stores = Array.isArray(safeStored.stores) && safeStored.stores.length ? safeStored.stores : base.stores
  const hydrated = {
    ...base,
    ...safeStored,
    session: null,
    stores: countStoreEmployees(stores, employees),
    employees,
    adminAccounts: Array.isArray(safeStored.adminAccounts) ? safeStored.adminAccounts.map(normalizeAdmin) : base.adminAccounts,
    officeAdjustments: Array.isArray(safeStored.officeAdjustments) ? safeStored.officeAdjustments : base.officeAdjustments,
    tasks: Array.isArray(safeStored.tasks)
      ? safeStored.tasks.map((task) => normalizeTask(task, safeStored.activeStoreId || base.activeStoreId))
      : base.tasks,
    activeStoreId: stores.some((store) => store.id === safeStored.activeStoreId) ? safeStored.activeStoreId : stores[0]?.id || null,
  }
  return migrateDomainState(hydrated, { stores: hydrated.stores, imports: hydrated.imports })
}

const hydrateRemoteState = (remoteState, remoteUser, policyRecords = []) => {
  const emptyCollections = Object.fromEntries(REMOTE_ARRAY_KEYS.map((key) => [key, []]))
  const mappedPolicies = apiPolicyMap(policyRecords)
  const safeRemote = {
    ...emptyCollections,
    ...(remoteState && typeof remoteState === 'object' ? remoteState : {}),
  }
  const employeeId = remoteUser?.employeeId || remoteUser?.employee_id
  const remoteEmployee = safeRemote.employees.find((employee) => String(employee.id || employee.code) === String(employeeId))
  const session = remoteUser?.role === 'admin'
    ? { id: remoteUser.id, code: 'ADMIN', name: remoteUser.displayName || remoteUser.username, username: remoteUser.username, role: 'admin', accountType: 'admin', authVersion: remoteUser.version }
    : {
        id: employeeId || remoteUser?.id,
        code: employeeId || remoteUser?.id,
        name: remoteEmployee?.name || remoteUser?.displayName || remoteUser?.username,
        username: remoteUser?.username,
        role: 'employee',
        accountType: 'employee',
        employeeId: employeeId || remoteUser?.id,
        storeId: remoteUser?.storeId || remoteEmployee?.storeId,
        unit: remoteEmployee?.unit || 'store',
        unitType: remoteEmployee?.unit || 'store',
        authUserId: remoteUser?.id,
        authVersion: remoteUser?.version,
      }
  const employees = safeRemote.employees.map((employee) => normalizeEmployee(employee, safeRemote.activeStoreId || session.storeId || ''))
  const stores = countStoreEmployees(safeRemote.stores, employees)
  const normalized = {
    ...safeRemote,
    adminAccounts: [],
    employees,
    stores,
    session: null,
    settings: safeRemote.settings && typeof safeRemote.settings === 'object' ? safeRemote.settings : {},
    tasks: safeRemote.tasks.map((task) => normalizeTask(task, safeRemote.activeStoreId || session.storeId || stores[0]?.id)),
    activeStoreId: stores.some((store) => store.id === safeRemote.activeStoreId)
      ? safeRemote.activeStoreId
      : stores[0]?.id || null,
    policies: {
      ...defaultPolicies,
      ...mappedPolicies,
      employeeKpiRates: { ...defaultPolicies.employeeKpiRates, ...(mappedPolicies.employeeKpiRates || {}) },
      attendanceEvaluation: { ...defaultPolicies.attendanceEvaluation, ...(mappedPolicies.attendanceEvaluation || {}) },
    },
  }
  const hydrated = migrateDomainState(normalized, { stores, imports: normalized.imports })
  return {
    ...hydrated,
    session,
    activeStoreId: session.role === 'employee' ? session.storeId : hydrated.activeStoreId,
  }
}

const readState = () => {
  try {
    if (typeof localStorage === 'undefined') return createInitialState()
    const serialized = localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_STORAGE_KEY)
    return hydrateState(serialized ? JSON.parse(serialized) : null)
  } catch {
    return createInitialState()
  }
}

const accountKey = (account = {}) => String(account.id || account.code || account.employeeCode || '')

const toSession = (account, source) => {
  const common = {
    id: account.id || account.code,
    code: account.code || account.employeeCode || account.id,
    name: account.name,
    username: account.username,
    storeId: account.storeId,
    accountType: source,
  }
  if (source === 'admin') return { ...common, role: 'admin' }
  return {
    ...common,
    role: 'employee',
    employeeId: account.id || account.code,
    unit: account.unit || 'store',
    unitType: account.unit || 'store',
    employmentType: account.employmentType,
    payBasis: account.payBasis,
    monthlySalary: account.monthlySalary,
    hourlyRate: account.hourlyRate,
    position: account.position,
  }
}

const localDateTime = (date) => {
  const pad = (value) => String(value).padStart(2, '0')
  const offset = -date.getTimezoneOffset()
  const sign = offset >= 0 ? '+' : '-'
  const absoluteOffset = Math.abs(offset)
  return `${today(date)}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}${sign}${pad(Math.floor(absoluteOffset / 60))}:${pad(absoluteOffset % 60)}`
}

const timeLabel = (date) => date.toLocaleTimeString('vi-VN', { hour12: false })

const resolveDate = (value) => {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value
  if (value) {
    const parsed = new Date(value)
    if (!Number.isNaN(parsed.getTime())) return parsed
  }
  return new Date()
}

const nonNegativeInteger = (value) => {
  const parsed = Number(String(value ?? '').replaceAll(',', '').replaceAll('.', ''))
  return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : 0
}

const monthKey = (value = new Date()) => {
  return businessDate(resolveDate(value)).slice(0, 7)
}

const recordDate = (record = {}) => record.period
  ? `${String(record.period).slice(0, 7)}-01`
  : businessDate(record.date || record.workDate || record.occurredAt || record.createdAt)

const isInMonth = (record, period) => !period || period === 'all' || recordDate(record).startsWith(String(period).slice(0, 7))

const minuteDifference = (actual, scheduled) => {
  const [actualHour, actualMinute] = String(actual || '').slice(0, 5).split(':').map(Number)
  const [scheduledHour, scheduledMinute] = String(scheduled || '').slice(0, 5).split(':').map(Number)
  if (![actualHour, actualMinute, scheduledHour, scheduledMinute].every(Number.isFinite)) return 0
  return (actualHour * 60 + actualMinute) - (scheduledHour * 60 + scheduledMinute)
}

const minutesLate = (actual, scheduled) => Math.max(0, minuteDifference(actual, scheduled))

const actorSnapshot = (session) => ({
  id: session?.id || session?.code || 'SYSTEM',
  name: session?.name || 'Hệ thống',
  role: session?.role || 'system',
})

const visibleOrders = (orders = []) => orders.filter((order) => !order.deletedAt && order.status !== 'Đã xóa')

const employeeGrossFor = (state, employeeId, period = monthKey()) => {
  const employee = state.employees.find((item) => item.id === employeeId)
  if (!employee) return 0
  const attendance = state.attendance.filter((item) => item.employeeId === employeeId && isInMonth(item, period))
  const hours = attendance.reduce((sum, item) => sum + Math.max(0, Number(item.hours) || 0), 0)
  const base = getPayBasis(employee) === 'hourly'
    ? Math.floor(hours * getHourlyRate(employee))
    : getMonthlySalary(employee)
  const adjustments = state.salaryAdjustments
    .filter((item) => item.employeeId === employeeId && isInMonth(item, period) && item.status !== 'Đã hủy')
    .reduce((sum, item) => sum + (normalizeText(item.type).includes('khấu trừ') ? -1 : 1) * nonNegativeInteger(item.amount), 0)
  const tiktokAllowance = nonNegativeInteger(employee.tiktokAllowance)
  return Math.max(0, base + tiktokAllowance + adjustments)
}

const advancePaidFor = (state, employeeId, period = monthKey()) => state.salaryAdvances
  .filter((item) => item.employeeId === employeeId && item.period === period && item.status === 'Đã chi')
  .reduce((sum, item) => sum + nonNegativeInteger(item.amount), 0)

const voucherDate = (value = new Date()) => {
  const date = resolveDate(value)
  return `${String(date.getDate()).padStart(2, '0')}${String(date.getMonth() + 1).padStart(2, '0')}${date.getFullYear()}`
}

const storeCode = (store = {}) => String(store.short || store.code || store.id || 'CH')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^A-Za-z0-9]/g, '')
  .toUpperCase()
  .slice(0, 12) || 'CH'

export function AppProvider({ children }) {
  const [state, setState] = useState(readState)
  const [toast, setToast] = useState(null)
  const [credentialsReady, setCredentialsReady] = useState(false)
  const [apiStatus, setApiStatus] = useState('local')
  const apiRef = useRef({
    enabled: false,
    role: null,
    user: null,
    version: 0,
    policyVersions: {},
    suppressNext: false,
    syncing: false,
    pending: null,
    timer: null,
    lastSerialized: '',
  })

  const activateRemotePayload = (payload, loginUser) => {
    const remoteUser = payload.user || loginUser
    const hydrated = hydrateRemoteState(payload.state, remoteUser, payload.policies)
    const remote = apiRef.current
    remote.enabled = true
    remote.role = remoteUser.role
    remote.user = remoteUser
    remote.version = Number(payload.version || 0)
    remote.policyVersions = Object.fromEntries((payload.policies || []).map((policy) => [policy.key, Number(policy.version || 0)]))
    remote.suppressNext = true
    remote.lastSerialized = JSON.stringify(sharedStateSnapshot(hydrated))
    setApiStatus('connected')
    setState(hydrated)
    return hydrated.session
  }

  const runRemoteDomainCommand = async (type, payload, idempotencyKey = `${type}:${crypto.randomUUID()}`) => {
    const remote = apiRef.current
    try {
      const result = await apiCommand(type, payload, {
        expectedVersion: remote.version,
        idempotencyKey,
      })
      remote.version = Number(result.version)
      try {
        const latest = await apiGetState('global')
        activateRemotePayload(latest, remote.user)
      } catch {
        remote.suppressNext = true
        setApiStatus('error')
      }
      return result
    } catch (error) {
      if (error.code === 'VERSION_CONFLICT') {
        try {
          const latest = await apiGetState('global')
          activateRemotePayload(latest, remote.user)
        } catch {
          setApiStatus('error')
        }
        const conflict = new Error('Dữ liệu vừa thay đổi trên máy chủ. Nội dung mới nhất đã được tải; vui lòng thực hiện lại thao tác.')
        conflict.code = 'VERSION_CONFLICT'
        throw conflict
      }
      throw error
    }
  }

  useEffect(() => {
    if (!hasApiSession()) return undefined
    let active = true
    apiBootstrapState('global').then(async (payload) => {
      if (payload.user?.role === 'admin') {
        const users = await apiListUsers()
        const authByEmployee = new Map((users.users || []).map((user) => [String(user.employeeId), user]))
        payload.state.employees = (payload.state.employees || []).map((employee) => {
          const user = authByEmployee.get(String(employee.id || employee.code))
          const statuses = { active: 'Đang làm việc', locked: 'Tạm ngưng', inactive: 'Đã nghỉ việc' }
          return user ? { ...employee, authUserId: user.id, authVersion: user.version, lastLoginAt: user.lastLoginAt, status: statuses[user.status] || employee.status } : employee
        })
      }
      if (active) activateRemotePayload(payload)
    }).catch(() => {
      clearApiSession()
      if (active) setApiStatus('local')
    })
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (credentialsReady) return undefined
    let active = true
    const migrate = async () => {
      const migrateAccounts = async (accounts) => Promise.all(accounts.map(async (account) => account.legacyPassword
        ? { ...account, passwordHash: await hashPassword(account.legacyPassword), legacyPassword: '', password: undefined }
        : { ...account, password: undefined }))
      const [adminAccounts, employees] = await Promise.all([
        migrateAccounts(state.adminAccounts),
        migrateAccounts(state.employees),
      ])
      if (!active) return
      setState((current) => ({ ...current, adminAccounts, employees }))
      setCredentialsReady(true)
    }
    migrate()
    return () => { active = false }
  }, [credentialsReady, state.adminAccounts, state.employees])

  useEffect(() => {
    if (!credentialsReady || typeof localStorage === 'undefined') return
    const safeState = {
      ...state,
      session: null,
      adminAccounts: state.adminAccounts.map(({ password: _password, legacyPassword: _legacyPassword, ...account }) => account),
      employees: state.employees.map(({ password: _password, legacyPassword: _legacyPassword, ...account }) => account),
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(safeState))
  }, [credentialsReady, state])

  useEffect(() => {
    const remote = apiRef.current
    if (!credentialsReady || !remote.enabled || remote.role !== 'admin' || !state.session) return undefined
    const snapshot = sharedStateSnapshot(state)
    const serialized = JSON.stringify(snapshot)
    if (remote.suppressNext) {
      remote.suppressNext = false
      remote.lastSerialized = serialized
      return undefined
    }
    if (serialized === remote.lastSerialized) return undefined
    remote.pending = { snapshot, serialized }
    window.clearTimeout(remote.timer)
    remote.timer = window.setTimeout(async () => {
      if (remote.syncing) return
      remote.syncing = true
      setApiStatus('syncing')
      try {
        while (remote.pending) {
          let pending = remote.pending
          remote.pending = null
          try {
            const result = await apiCommand('state.replace', { state: pending.snapshot }, {
              expectedVersion: remote.version,
              idempotencyKey: `state:${crypto.randomUUID()}`,
            })
            remote.version = Number(result.version)
            remote.lastSerialized = pending.serialized
          } catch (error) {
            if (error.code !== 'VERSION_CONFLICT') throw error
            const latest = await apiGetState('global')
            const merged = mergeSharedState(latest.state, pending.snapshot)
            pending = { snapshot: merged, serialized: JSON.stringify(merged) }
            const result = await apiCommand('state.replace', { state: merged }, {
              expectedVersion: Number(latest.version),
              idempotencyKey: `state-merge:${crypto.randomUUID()}`,
            })
            remote.version = Number(result.version)
            remote.lastSerialized = pending.serialized
            remote.suppressNext = true
            setState((current) => ({
              ...hydrateRemoteState(merged, remote.user, latest.policies),
              session: current.session,
            }))
          }
        }
        setApiStatus('connected')
      } catch (error) {
        setApiStatus('error')
        setToast({ id: Date.now(), message: error.message || 'Không thể đồng bộ dữ liệu với máy chủ.', type: 'info' })
      } finally {
        remote.syncing = false
      }
    }, 450)
    return () => window.clearTimeout(remote.timer)
  }, [credentialsReady, state])

  useEffect(() => {
    if (!toast) return undefined
    const timeout = window.setTimeout(() => setToast(null), 2800)
    return () => window.clearTimeout(timeout)
  }, [toast])

  const notify = (message, type = 'success') => setToast({ id: Date.now(), message, type })

  const login = async (username, password) => {
    try {
      setApiStatus('connecting')
      const authenticated = await apiLogin(username, password)
      const bootstrap = await apiBootstrapState('global')
      if (authenticated.user.role === 'admin') {
        const users = await apiListUsers()
        const authByEmployee = new Map((users.users || []).map((user) => [String(user.employeeId), user]))
        bootstrap.state.employees = (bootstrap.state.employees || []).map((employee) => {
          const user = authByEmployee.get(String(employee.id || employee.code))
          const statuses = { active: 'Đang làm việc', locked: 'Tạm ngưng', inactive: 'Đã nghỉ việc' }
          return user ? { ...employee, authUserId: user.id, authVersion: user.version, lastLoginAt: user.lastLoginAt, status: statuses[user.status] || employee.status } : employee
        })
      }
      const session = activateRemotePayload(bootstrap, authenticated.user)
      return { ok: true, account: session }
    } catch (error) {
      clearApiSession()
      const unavailable = ['NETWORK_ERROR', 'TIMEOUT', 'API_UNAVAILABLE', 'HTTP_404', 'DATABASE_UNAVAILABLE'].includes(error.code)
      if (!isLocalApiFallbackAllowed() || !unavailable) {
        setApiStatus('error')
        return { ok: false, message: error.message || 'Không thể đăng nhập vào hệ thống.' }
      }
      setApiStatus('local')
    }

    const normalizedUsername = normalizeText(username)
    const sources = [
      ...state.adminAccounts.map((account) => ({ account, source: 'admin' })),
      ...state.employees.map((account) => ({ account, source: 'employee' })),
    ]
    const matched = sources.find(({ account }) => normalizeText(account.username) === normalizedUsername)
    if (!matched) return { ok: false, message: 'Tên đăng nhập hoặc mật khẩu chưa đúng.' }
    const passwordMatches = matched.account.passwordHash
      ? await verifyPassword(password, matched.account.passwordHash)
      : Boolean(matched.account.legacyPassword) && matched.account.legacyPassword === password
    if (!passwordMatches) return { ok: false, message: 'Tên đăng nhập hoặc mật khẩu chưa đúng.' }
    if (!isActiveAccount(matched.account.status)) return { ok: false, message: 'Tài khoản hiện không ở trạng thái hoạt động.' }

    const session = toSession(matched.account, matched.source)
    const migratedPasswordHash = matched.account.passwordHash || await hashPassword(password)
    const loginTimestamp = new Date().toISOString()
    const workDate = today()
    const recent = matched.source === 'employee'
      ? state.attendance.find((record) => record.employeeId === session.employeeId && !record.deletedAt && !record.checkOutAt && !record.checkOut)
        || state.attendance.find((record) => record.employeeId === session.employeeId && !record.deletedAt && (record.date || record.workDate) === workDate)
      : null
    setState((current) => ({
      ...current,
      session,
      activeStoreId: session.storeId && session.storeId !== 'OFFICE' ? session.storeId : current.activeStoreId,
      activeAttendanceId: recent && !recent.checkOutAt && !recent.checkOut ? recent.id : null,
      checkedInAt: recent?.checkIn || recent?.checkInTime || null,
      finishedShift: Boolean(recent?.checkOutAt || recent?.checkOut),
      adminAccounts: matched.source === 'admin' ? current.adminAccounts.map((account) => accountKey(account) === accountKey(matched.account) ? { ...account, passwordHash: migratedPasswordHash, legacyPassword: '', password: undefined, lastLoginAt: loginTimestamp } : account) : current.adminAccounts,
      employees: matched.source === 'employee' ? current.employees.map((account) => accountKey(account) === accountKey(matched.account) ? { ...account, passwordHash: migratedPasswordHash, legacyPassword: '', password: undefined, lastLoginAt: loginTimestamp } : account) : current.employees,
    }))
    return { ok: true, account: session }
  }

  const quickLogin = () => null

  const logout = () => {
    if (apiRef.current.enabled) apiLogout().catch(() => clearApiSession())
    apiRef.current.enabled = false
    apiRef.current.role = null
    apiRef.current.user = null
    apiRef.current.pending = null
    window.clearTimeout(apiRef.current.timer)
    setApiStatus('local')
    setState((current) => ({
      ...current,
      session: null,
      activeAttendanceId: null,
      checkedInAt: null,
      finishedShift: false,
    }))
  }

  const updateCollection = (key, updater) =>
    setState((current) => ({ ...current, [key]: updater(Array.isArray(current[key]) ? current[key] : []) }))

  const setActiveStoreId = (id) => {
    if (!state.stores.some((store) => store.id === id)) return false
    setState((current) => ({ ...current, activeStoreId: id }))
    return true
  }

  const addStore = (payload) => {
    const name = String(payload.name || '').trim().replace(/^DORE\s+/i, 'IDOSI ')
    if (!name) {
      notify('Vui lòng nhập tên cửa hàng.', 'info')
      return null
    }
    if (state.stores.some((item) => normalizeText(item.name) === normalizeText(name))) {
      notify('Tên cửa hàng đang hoạt động đã tồn tại.', 'info')
      return null
    }
    const store = {
      id: payload.id || uid('CH'),
      employees: 0,
      revenue: 0,
      expense: 0,
      status: 'Hoạt động',
      accent: '#075fba',
      ...payload,
      name,
      short: payload.short || name.replace(/^(?:IDOSI|SecondMall)\s*/i, ''),
    }
    updateCollection('stores', (items) => [store, ...items])
    notify('Đã thêm cửa hàng mới.')
    return store
  }

  const updateStore = (id, payload) => {
    updateCollection('stores', (items) => items.map((store) => store.id === id ? { ...store, ...payload } : store))
    notify('Đã cập nhật cửa hàng.')
  }

  const deleteStore = (id) => {
    const store = state.stores.find((item) => item.id === id)
    if (!store) return false
    const orderCount = visibleOrders(state.orders).filter((order) => order.storeId === id && order.source !== 'legacy-opening-balance').length
    if (orderCount > 0) {
      notify(`Không thể xóa vì cửa hàng đã phát sinh ${orderCount} đơn hàng.`, 'info')
      return false
    }
    setState((current) => {
      const stores = current.stores.filter((store) => store.id !== id)
      const timestamp = new Date().toISOString()
      const actor = actorSnapshot(current.session)
      return {
        ...current,
        stores,
        deletedStores: [{ ...store, deletedAt: timestamp, deletedBy: actor }, ...current.deletedStores],
        auditLogs: [{ id: uid('AUD'), entity: 'store', entityId: id, action: 'delete', before: store, after: null, actor, createdAt: timestamp }, ...current.auditLogs],
        activeStoreId: current.activeStoreId === id ? stores[0]?.id || null : current.activeStoreId,
      }
    })
    notify('Đã xóa cửa hàng.', 'info')
    return true
  }

  const hasDuplicateAccount = (payload, ignoredKey = '') => {
    const records = [...state.adminAccounts, ...state.employees].filter((account) => accountKey(account) !== String(ignoredKey))
    const username = normalizeText(payload.username)
    const cccd = String(payload.cccd || payload.citizenId || '').trim()
    return records.some((account) =>
      (username && normalizeText(account.username) === username)
      || (cccd && String(account.cccd || account.citizenId || '') === cccd),
    )
  }

  const addEmployee = async (payload) => {
    if (hasDuplicateAccount(payload)) {
      notify('Tên đăng nhập hoặc số CCCD đã tồn tại.', 'info')
      return { ok: false }
    }
    if (apiRef.current.enabled) {
      if (state.session?.role !== 'admin') return { ok: false, message: 'Chỉ Admin được tạo tài khoản nhân viên.' }
      try {
        const result = await apiCommand('user.create', {
          username: payload.username,
          password: payload.password,
          displayName: payload.name,
          storeId: payload.storeId,
          employeeId: payload.id || payload.code || payload.employeeCode,
        }, { expectedVersion: 0, idempotencyKey: `user-create:${crypto.randomUUID()}` })
        const employee = normalizeEmployee({
          ...payload,
          password: undefined,
          passwordHash: '',
          authUserId: result.user.id,
          authVersion: result.user.version,
        }, state.activeStoreId)
        setState((current) => {
          const employees = [employee, ...current.employees]
          return { ...current, employees, stores: countStoreEmployees(current.stores, employees), stateVersion: current.stateVersion + 1 }
        })
        notify('Đã tạo hồ sơ và tài khoản đăng nhập nhân viên.')
        return { ok: true, employee }
      } catch (error) {
        notify(error.message || 'Không thể tạo tài khoản nhân viên.', 'info')
        return { ok: false, message: error.message }
      }
    }
    const passwordHash = payload.password ? await hashPassword(payload.password) : ''
    if (!passwordHash) return { ok: false, message: 'Mật khẩu là bắt buộc.' }
    const employee = normalizeEmployee({ ...payload, password: undefined, passwordHash }, state.activeStoreId)
    setState((current) => {
      const employees = [employee, ...current.employees]
      return { ...current, employees, stores: countStoreEmployees(current.stores, employees) }
    })
    notify('Đã lưu hồ sơ nhân viên.')
    return { ok: true, employee }
  }

  const updateEmployee = async (id, payload) => {
    if (hasDuplicateAccount(payload, id)) {
      notify('Tên đăng nhập hoặc số CCCD đã tồn tại.', 'info')
      return { ok: false }
    }
    const previous = state.employees.find((employee) => accountKey(employee) === String(id))
    if (!previous) return { ok: false }
    let authVersion = previous.authVersion
    if (apiRef.current.enabled && previous.authUserId) {
      try {
        if (
          (payload.username !== undefined && payload.username !== previous.username)
          || (payload.name !== undefined && payload.name !== previous.name)
          || (payload.storeId !== undefined && payload.storeId !== previous.storeId)
        ) {
          const updatedUser = await apiCommand('user.update', {
            userId: previous.authUserId,
            employeeId: previous.id,
            username: payload.username ?? previous.username,
            displayName: payload.name ?? previous.name,
            storeId: payload.storeId ?? previous.storeId,
          }, {
            expectedVersion: Number(authVersion || 1),
            idempotencyKey: `user-update:${crypto.randomUUID()}`,
          })
          authVersion = updatedUser.user.version
        }
        if (payload.password) {
          const reset = await apiCommand('user.reset_password', {
            userId: previous.authUserId,
            password: payload.password,
          }, {
            expectedVersion: Number(authVersion || 1),
            idempotencyKey: `user-password:${crypto.randomUUID()}`,
          })
          authVersion = reset.user.version
        }
        if (payload.status && payload.status !== previous.status) {
          const statuses = { 'Đang làm việc': 'active', 'Đang hoạt động': 'active', 'Tạm ngưng': 'locked', 'Đã nghỉ việc': 'inactive' }
          const status = await apiCommand('user.set_status', {
            userId: previous.authUserId,
            status: statuses[payload.status] || 'locked',
          }, {
            expectedVersion: Number(authVersion || 1),
            idempotencyKey: `user-status:${crypto.randomUUID()}`,
          })
          authVersion = status.user.version
        }
      } catch (error) {
        notify(error.message || 'Không thể cập nhật tài khoản đăng nhập.', 'info')
        return { ok: false, message: error.message }
      }
    }
    const passwordHash = apiRef.current.enabled ? '' : payload.password ? await hashPassword(payload.password) : previous.passwordHash
    const employee = normalizeEmployee({ ...previous, ...payload, password: undefined, legacyPassword: '', passwordHash, authVersion }, previous.storeId || state.activeStoreId)
    setState((current) => {
      const employees = current.employees.map((item) => accountKey(item) === String(id) ? employee : item)
      return {
        ...current,
        employees,
        stores: countStoreEmployees(current.stores, employees),
        session: current.session?.employeeId === id ? toSession(employee, 'employee') : current.session,
      }
    })
    notify('Đã cập nhật nhân viên.')
    return { ok: true, employee }
  }

  const deleteEmployee = async (id) => {
    const previous = state.employees.find((employee) => accountKey(employee) === String(id))
    if (!previous) return false
    let deletedAuthVersion = previous.authVersion
    if (apiRef.current.enabled && previous.authUserId) {
      try {
        const result = await apiCommand('user.set_status', {
          userId: previous.authUserId,
          status: 'inactive',
        }, {
          expectedVersion: Number(previous.authVersion || 1),
          idempotencyKey: `user-delete:${crypto.randomUUID()}`,
        })
        deletedAuthVersion = result.user.version
      } catch (error) {
        notify(error.message || 'Không thể vô hiệu hóa tài khoản nhân viên.', 'info')
        return false
      }
    }
    setState((current) => {
      const employees = current.employees.filter((employee) => accountKey(employee) !== String(id))
      const timestamp = new Date().toISOString()
      const actor = actorSnapshot(current.session)
      return {
        ...current,
        employees,
        stores: countStoreEmployees(current.stores, employees),
        schedule: current.schedule.filter((item) => item.employeeId !== id),
        deletedEmployees: [{ ...previous, authVersion: deletedAuthVersion, password: undefined, deletedAt: timestamp, deletedBy: actor }, ...current.deletedEmployees],
        auditLogs: [{ id: uid('AUD'), entity: 'employee', entityId: id, action: 'delete', before: { ...previous, password: undefined }, after: null, actor, createdAt: timestamp }, ...current.auditLogs],
      }
    })
    notify('Đã xóa nhân viên.', 'info')
    return true
  }

  const addOfficeAdjustment = (payload) => {
    const adjustment = {
      id: payload.id || uid('DCH'),
      date: payload.date || today(),
      type: payload.type || payload.kind || payload.adjustmentType || 'Thưởng',
      kind: payload.kind || payload.type || payload.adjustmentType || 'Thưởng',
      adjustmentType: payload.adjustmentType || payload.type || payload.kind || 'Thưởng',
      employeeId: payload.employeeId,
      employeeName: payload.employeeName || state.employees.find((employee) => employee.id === payload.employeeId)?.name || '',
      amount: Number(payload.amount) || 0,
      content: String(payload.content || payload.note || '').trim(),
      createdAt: payload.createdAt || localDateTime(new Date()),
    }
    updateCollection('officeAdjustments', (items) => [adjustment, ...items])
    notify(`Đã lưu khoản ${adjustment.type.toLowerCase()}.`)
    return adjustment
  }

  const updateOfficeAdjustment = (id, payload) => {
    updateCollection('officeAdjustments', (items) => items.map((item) => item.id === id ? { ...item, ...payload, amount: Number(payload.amount ?? item.amount) || 0 } : item))
    notify('Đã cập nhật thưởng/phụ cấp.')
  }

  const deleteOfficeAdjustment = (id) => {
    updateCollection('officeAdjustments', (items) => items.filter((item) => item.id !== id))
    notify('Đã xóa khoản thưởng/phụ cấp.', 'info')
  }

  const addImport = async (payload) => {
    const voucherResult = await createImportVoucher({
      storeId: payload.storeId || state.session?.storeId || state.activeStoreId,
      items: [payload],
      shippingAmount: payload.shipping,
      relatedAmount: payload.relatedAmount,
      idempotencyKey: payload.idempotencyKey,
    })
    if (!voucherResult.ok) return null
    const record = {
      id: voucherResult.voucher.code,
      voucherId: voucherResult.voucher.id,
      voucherCode: voucherResult.voucher.code,
      storeId: payload.storeId || state.session?.storeId || state.activeStoreId,
      createdAt: new Date().toLocaleString('vi-VN'),
      creator: state.session?.name || 'Admin IDOSI',
      ...payload,
    }
    updateCollection('imports', (items) => [record, ...items])
    notify('Đã thêm mặt hàng nhập kho.')
    return record
  }

  const deleteImport = (id) => {
    updateCollection('imports', (items) => items.filter((item) => item.id !== id))
    notify('Đã xóa mặt hàng.', 'info')
  }

  const updateImport = (id, payload) => {
    updateCollection('imports', (items) => items.map((item) => item.id === id ? {
      ...item,
      ...payload,
      quantity: Number(payload.quantity ?? item.quantity) || 0,
      weight: Number(payload.weight ?? item.weight) || 0,
      price: Number(payload.price ?? item.price) || 0,
      shipping: Number(payload.shipping ?? item.shipping) || 0,
      updatedAt: new Date().toLocaleString('vi-VN'),
    } : item))
    notify('Đã cập nhật mặt hàng nhập kho.')
    return true
  }

  const setTaskDone = async (id, done, employeeId = state.session?.employeeId || state.session?.code) => {
    if (apiRef.current.enabled) {
      try {
        const result = await runRemoteDomainCommand('task.done', { taskId: id, done: Boolean(done) })
        notify(done ? 'Đã hoàn thành công việc.' : 'Đã mở lại công việc.', 'success')
        return { ok: true, task: result.task }
      } catch (error) {
        notify(error.message || 'Không thể cập nhật công việc.', 'info')
        return { ok: false, message: error.message }
      }
    }
    updateCollection('tasks', (items) => items.map((item) => item.id === id ? {
      ...item,
      ...(employeeId
        ? { completedBy: { ...(item.completedBy || {}), [employeeId]: Boolean(done) } }
        : { done: Boolean(done) }),
    } : item))
    return { ok: true }
  }

  const replaceTasks = (tasks) => {
    const nextTasks = (Array.isArray(tasks) ? tasks : []).map((task) => normalizeTask(task, state.activeStoreId))
    const scope = nextTasks[0]
    setState((current) => ({
      ...current,
      tasks: scope
        ? [
            ...nextTasks,
            ...current.tasks.filter((task) => !(
              String(task.storeId) === String(scope.storeId)
              && String(task.shiftId || task.shift) === String(scope.shiftId)
              && String(task.date || task.workDate) === String(scope.date)
            )),
          ]
        : current.tasks,
    }))
    notify('Đã lưu và gửi danh sách công việc.')
  }

  const saveSchedule = (employeeIds, shiftId, details = {}) => {
    updateCollection('schedule', (items) => {
      const scheduleDate = details.date || today()
      const schedule = new Map(items.map((item) => [`${item.employeeId}:${item.date || scheduleDate}`, { ...item, shiftIds: [...(item.shiftIds || [])] }]))
      employeeIds.forEach((employeeId) => {
        const employee = state.employees.find((item) => item.id === employeeId)
        const key = `${employeeId}:${scheduleDate}`
        const item = schedule.get(key) || { employeeId, storeId: employee?.storeId || state.activeStoreId, date: scheduleDate, shiftIds: [] }
        if (!item.shiftIds.includes(shiftId)) item.shiftIds.push(shiftId)
        schedule.set(key, { ...item, note: details.note ?? item.note ?? '' })
      })
      return [...schedule.values()]
    })
    notify('Đã lưu lịch phân ca.')
  }

  const changeAdminPassword = async (id, password, currentPassword = '') => {
    if (apiRef.current.enabled) {
      try {
        const result = await apiCommand('user.change_password', {
          currentPassword,
          newPassword: password,
        }, {
          expectedVersion: Number(apiRef.current.user?.version || state.session?.authVersion || 1),
          idempotencyKey: `password-change:${crypto.randomUUID()}`,
        })
        apiRef.current.user = { ...apiRef.current.user, ...result.user }
        setState((current) => ({ ...current, session: { ...current.session, authVersion: result.user.version } }))
        notify('Đã đổi mật khẩu quản trị và thu hồi các phiên khác.')
        return true
      } catch (error) {
        notify(error.message || 'Không thể đổi mật khẩu quản trị.', 'info')
        return false
      }
    }
    const accountExists = state.adminAccounts.some((account) => account.id === id || account.username === id)
    if (!accountExists) {
      notify('Không tìm thấy tài khoản quản trị.', 'info')
      return false
    }
    const passwordHash = await hashPassword(password)
    updateCollection('adminAccounts', (items) => items.map((account) =>
      account.id === id || account.username === id ? { ...account, passwordHash, legacyPassword: '', password: undefined } : account,
    ))
    notify('Đã đổi mật khẩu quản trị.')
    return true
  }

  const verifyCurrentPassword = async (password) => {
    if (apiRef.current.enabled) return Boolean(password)
    const collection = state.session?.role === 'admin' ? state.adminAccounts : state.employees
    const account = collection.find((item) => accountKey(item) === accountKey(state.session) || item.username === state.session?.username)
    if (!account) return false
    if (account.passwordHash) return verifyPassword(password, account.passwordHash)
    return Boolean(account.legacyPassword) && account.legacyPassword === password
  }

  const saveSettings = (settings) => {
    setState((current) => ({ ...current, settings }))
    notify('Đã lưu thay đổi tài khoản.')
  }

  const createOrder = async (payload = {}) => {
    const amount = nonNegativeInteger(payload.amount)
    const requestedStoreId = payload.storeId || state.session?.storeId || state.activeStoreId
    const storeId = state.session?.role === 'employee' ? state.session.storeId : requestedStoreId
    const store = state.stores.find((item) => item.id === storeId)
    if (!store || amount <= 0) return { ok: false, message: 'Cửa hàng hoặc số tiền đơn hàng chưa hợp lệ.' }
    const idempotencyKey = String(payload.idempotencyKey || '').trim()
    if (idempotencyKey && state.idempotencyKeys.includes(idempotencyKey)) {
      const existing = state.orders.find((item) => item.idempotencyKey === idempotencyKey)
      return { ok: true, order: existing, existing: true }
    }

    if (apiRef.current.enabled) {
      try {
        const result = await runRemoteDomainCommand(
          'order.create',
          { ...payload, amount, storeId, idempotencyKey: undefined },
          idempotencyKey || `order:${crypto.randomUUID()}`,
        )
        notify(`Đã tạo đơn hàng ${result.order.code}.`)
        return { ok: true, order: result.order }
      } catch (error) {
        notify(error.message || 'Không thể tạo đơn hàng.', 'info')
        return { ok: false, message: error.message }
      }
    }

    const employeeId = payload.employeeId || state.session?.employeeId || state.session?.code || null
    const employee = state.employees.find((item) => item.id === employeeId)
    const openAttendance = state.attendance.find((item) => item.employeeId === employeeId && !item.deletedAt && !item.checkOut && !item.checkOutAt)
    const sequence = Math.max(1, Number(state.orderCounters[storeId]) || 1)
    const timestamp = new Date().toISOString()
    const order = {
      id: uid('ORD'),
      code: `${storeCode(store)}-${String(sequence).padStart(5, '0')}`,
      storeId,
      customerName: String(payload.customerName || '').trim(),
      customerPhone: normalizePhone(payload.customerPhone),
      customerAge: payload.customerAge === '' || payload.customerAge == null ? null : Math.max(0, Number(payload.customerAge) || 0),
      amount,
      paymentMethod: payload.paymentMethod === 'Tiền mặt' ? 'Tiền mặt' : 'Chuyển khoản',
      employeeId,
      employeeName: employee?.name || state.session?.name || 'Admin IDOSI',
      shiftId: openAttendance?.shift || payload.shiftId || null,
      shiftName: payload.shiftName || openAttendance?.shiftName || state.shiftDefinitions.find((item) => item.id === (openAttendance?.shift || payload.shiftId))?.name || 'Chưa gắn ca',
      shiftStart: openAttendance?.shiftStart || payload.shiftStart || null,
      shiftEnd: openAttendance?.shiftEnd || payload.shiftEnd || null,
      attendanceId: openAttendance?.id || null,
      status: 'Hoàn tất',
      source: 'order',
      createdAt: timestamp,
      updatedAt: timestamp,
      deletedAt: null,
      idempotencyKey: idempotencyKey || null,
    }
    const notification = {
      id: uid('NTF'),
      type: 'order.created',
      storeId,
      orderId: order.id,
      orderCode: order.code,
      title: `Đơn hàng mới ${order.code}`,
      message: `${order.employeeName} vừa tạo đơn ${order.code}.`,
      createdAt: timestamp,
      readAt: null,
    }
    setState((current) => ({
      ...current,
      orders: [order, ...current.orders],
      orderCounters: { ...current.orderCounters, [storeId]: sequence + 1 },
      notifications: [notification, ...current.notifications],
      idempotencyKeys: idempotencyKey ? [...current.idempotencyKeys, idempotencyKey] : current.idempotencyKeys,
      stateVersion: current.stateVersion + 1,
    }))
    notify(`Đã tạo đơn hàng ${order.code}.`)
    return { ok: true, order }
  }

  const updateOrder = async (id, payload = {}) => {
    if (state.session?.role !== 'admin') return { ok: false, message: 'Chỉ Admin được sửa đơn hàng.' }
    const previous = state.orders.find((item) => item.id === id && !item.deletedAt)
    if (!previous) return { ok: false, message: 'Không tìm thấy đơn hàng.' }
    const reason = String(payload.reason || '').trim()
    if (!reason) return { ok: false, message: 'Cần nhập lý do chỉnh sửa.' }
    if (apiRef.current.enabled) {
      try {
        const result = await runRemoteDomainCommand('order.update', { orderId: id, ...payload, reason })
        notify(`Đã cập nhật đơn hàng ${result.order.code}.`)
        return { ok: true, order: result.order, existing: result.existing }
      } catch (error) {
        notify(error.message || 'Không thể cập nhật đơn hàng.', 'info')
        return { ok: false, message: error.message }
      }
    }
    const timestamp = new Date().toISOString()
    const candidate = {
      ...previous,
      customerName: payload.customerName == null ? previous.customerName : String(payload.customerName).trim(),
      customerPhone: payload.customerPhone == null ? previous.customerPhone : normalizePhone(payload.customerPhone),
      customerAge: payload.customerAge == null ? previous.customerAge : Math.max(0, Number(payload.customerAge) || 0),
      amount: payload.amount == null ? previous.amount : nonNegativeInteger(payload.amount),
      paymentMethod: payload.paymentMethod || previous.paymentMethod,
    }
    if (candidate.amount <= 0) return { ok: false, message: 'Số tiền đơn hàng phải lớn hơn 0.' }
    const changedFields = ['customerName', 'customerPhone', 'customerAge', 'amount', 'paymentMethod']
      .filter((key) => JSON.stringify(previous[key]) !== JSON.stringify(candidate[key]))
    if (!changedFields.length) return { ok: true, order: previous, existing: true }
    const next = { ...candidate, updatedAt: timestamp }
    const actor = actorSnapshot(state.session)
    const audit = { id: uid('ODA'), action: 'Sửa', orderId: id, orderCode: previous.code, storeId: previous.storeId, before: previous, after: next, changedFields, revenueBefore: previous.amount, revenueAfter: next.amount, reason, actor, createdAt: timestamp }
    setState((current) => ({ ...current, orders: current.orders.map((item) => item.id === id ? next : item), orderAudit: [audit, ...current.orderAudit], auditLogs: [audit, ...current.auditLogs], stateVersion: current.stateVersion + 1 }))
    notify(`Đã cập nhật đơn hàng ${previous.code}.`)
    return { ok: true, order: next }
  }

  const deleteOrder = async (id, reason = '') => {
    if (state.session?.role !== 'admin') return { ok: false, message: 'Chỉ Admin được xóa đơn hàng.' }
    const previous = state.orders.find((item) => item.id === id && !item.deletedAt)
    if (!previous || previous.source === 'legacy-opening-balance') return { ok: false, message: 'Không thể xóa bản ghi doanh thu chuyển tiếp.' }
    const normalizedReason = String(reason || '').trim()
    if (!normalizedReason) return { ok: false, message: 'Cần nhập lý do xóa đơn hàng.' }
    if (apiRef.current.enabled) {
      try {
        const result = await runRemoteDomainCommand('order.delete', { orderId: id, reason: normalizedReason })
        notify(`Đã xóa mềm đơn hàng ${result.order.code}.`, 'info')
        return { ok: true, order: result.order }
      } catch (error) {
        notify(error.message || 'Không thể xóa đơn hàng.', 'info')
        return { ok: false, message: error.message }
      }
    }
    const timestamp = new Date().toISOString()
    const actor = actorSnapshot(state.session)
    const deleted = { ...previous, status: 'Đã xóa', deletedAt: timestamp, deletedBy: actor, updatedAt: timestamp }
    const audit = { id: uid('ODA'), action: 'Xóa', orderId: id, orderCode: previous.code, storeId: previous.storeId, before: previous, after: deleted, changedFields: ['status', 'deletedAt'], revenueBefore: previous.amount, revenueAfter: 0, reason: normalizedReason, actor, createdAt: timestamp }
    setState((current) => ({ ...current, orders: current.orders.map((item) => item.id === id ? deleted : item), orderAudit: [audit, ...current.orderAudit], auditLogs: [audit, ...current.auditLogs], stateVersion: current.stateVersion + 1 }))
    notify(`Đã xóa mềm đơn hàng ${previous.code}.`, 'info')
    return { ok: true }
  }

  const readNotification = (id) => {
    const timestamp = new Date().toISOString()
    updateCollection('notifications', (items) => items.map((item) => item.id === id ? { ...item, readAt: item.readAt || timestamp } : item))
  }

  const clearNotifications = () => {
    const timestamp = new Date().toISOString()
    updateCollection('notifications', (items) => items.map((item) => !item.readAt ? { ...item, readAt: timestamp } : item))
    notify('Đã xóa danh sách thông báo chưa đọc.', 'info')
  }

  const savePolicies = async (payload = {}) => {
    if (state.session?.role !== 'admin') return { ok: false, message: 'Chỉ Quản trị viên cấp cao được thay đổi chính sách.' }
    const next = {
      ...state.policies,
      ...payload,
      lateToleranceMinutes: Number(payload.lateToleranceMinutes ?? state.policies.lateToleranceMinutes),
      earlyCheckInLimitMinutes: Number(payload.earlyCheckInLimitMinutes ?? state.policies.earlyCheckInLimitMinutes),
      employeeKpiRates: { ...state.policies.employeeKpiRates, ...(payload.employeeKpiRates || {}) },
      attendanceEvaluation: { ...state.policies.attendanceEvaluation, ...(payload.attendanceEvaluation || {}) },
      effectiveFrom: payload.effectiveFrom || today(),
      version: Number(state.policies.version || 1) + 1,
    }
    const numericValues = [next.lateToleranceMinutes, next.earlyCheckInLimitMinutes, ...Object.values(next.employeeKpiRates), ...Object.values(next.attendanceEvaluation)]
    if (numericValues.some((value) => !Number.isFinite(Number(value)) || Number(value) < 0) || !Number.isInteger(next.lateToleranceMinutes)) {
      return { ok: false, message: 'Giá trị chính sách phải là số hợp lệ và không âm.' }
    }
    const comparableCurrent = { ...state.policies, version: 0 }
    const comparableNext = { ...next, version: 0 }
    if (JSON.stringify(comparableCurrent) === JSON.stringify(comparableNext)) return { ok: true, existing: true }
    if (apiRef.current.enabled) {
      const remote = apiRef.current
      try {
        const makeUpdates = () => apiPolicyEntries(next).map(([key, value]) => ({
          key,
          value,
          expectedVersion: Number(remote.policyVersions[key] || 0),
        }))
        let result
        try {
          result = await apiCommand('policies.set', { updates: makeUpdates() }, {
            idempotencyKey: `policies:${crypto.randomUUID()}`,
          })
        } catch (error) {
          if (error.code !== 'VERSION_CONFLICT') throw error
          const latest = await apiGetState('global')
          remote.policyVersions = Object.fromEntries((latest.policies || []).map((policy) => [policy.key, Number(policy.version || 0)]))
          result = await apiCommand('policies.set', { updates: makeUpdates() }, {
            idempotencyKey: `policies-retry:${crypto.randomUUID()}`,
          })
        }
        const savedPolicies = result.policies || []
        savedPolicies.forEach((policy) => {
          remote.policyVersions[policy.key] = Number(policy.version)
        })
      } catch (error) {
        notify(error.message || 'Không thể lưu chính sách trên máy chủ.', 'info')
        return { ok: false, message: error.message }
      }
    }
    const timestamp = new Date().toISOString()
    const actor = actorSnapshot(state.session)
    const history = { id: uid('POL'), before: state.policies, after: next, actor, createdAt: timestamp }
    setState((current) => ({ ...current, policies: next, policyHistory: [history, ...current.policyHistory], auditLogs: [{ ...history, entity: 'policy', action: 'update' }, ...current.auditLogs], stateVersion: current.stateVersion + 1 }))
    notify(`Đã lưu chính sách phiên bản ${next.version}.`)
    return { ok: true, policies: next }
  }

  const addFixedExpense = async (payload = {}) => {
    if (state.session?.role !== 'admin') return { ok: false, message: 'Chỉ Admin được tạo chi phí.' }
    const storeId = payload.storeId || state.activeStoreId || state.session?.storeId
    const amount = nonNegativeInteger(payload.amount)
    if (!storeId || amount <= 0) return { ok: false, message: 'Cửa hàng hoặc số tiền chưa hợp lệ.' }
    if (apiRef.current.enabled) {
      try {
        const result = await runRemoteDomainCommand('fixed_expense.create', {
          storeId,
          type: payload.type || 'Chi phí khác',
          amount,
          note: String(payload.note || '').trim(),
          occurredAt: payload.occurredAt,
        })
        notify('Đã lưu một bản ghi chi phí cố định mới.')
        return { ok: true, expense: result.expense, expenseEntry: result.expenseEntry }
      } catch (error) {
        notify(error.message || 'Không thể lưu chi phí.', 'info')
        return { ok: false, message: error.message }
      }
    }
    const timestamp = new Date().toISOString()
    const actor = actorSnapshot(state.session)
    const record = { id: uid('FIX'), storeId, type: payload.type || 'Chi phí khác', amount, note: String(payload.note || '').trim(), occurredAt: payload.occurredAt || timestamp, createdAt: timestamp, createdBy: actor }
    const expense = { id: uid('EXP'), storeId, type: record.type, category: 'fixed', amount, description: record.note, sourceType: 'fixed-expense', sourceId: record.id, recognized: true, occurredAt: record.occurredAt, createdAt: timestamp, createdBy: actor.id }
    setState((current) => ({ ...current, fixedExpenses: [record, ...current.fixedExpenses], expenseEntries: [expense, ...current.expenseEntries], stateVersion: current.stateVersion + 1 }))
    notify('Đã lưu một bản ghi chi phí cố định mới.')
    return { ok: true, expense: record }
  }

  const addSalaryAdjustment = async (payload = {}) => {
    if (state.session?.role !== 'admin') return { ok: false, message: 'Chỉ Admin được tạo khoản lương thưởng.' }
    const employee = state.employees.find((item) => item.id === payload.employeeId)
    const amount = nonNegativeInteger(payload.amount)
    const period = payload.period || monthKey()
    if (!employee || amount <= 0) return { ok: false, message: 'Nhân viên hoặc số tiền chưa hợp lệ.' }
    const payroll = state.payrollPeriods.find((item) => item.storeId === employee.storeId && item.period === period)
    if (payroll?.lockedAt || payroll?.confirmedAt || ['Đã khóa', 'Đã chi'].includes(payroll?.status)) {
      return { ok: false, message: 'Kỳ lương đã chi hoặc đã khóa; không thể thêm khoản điều chỉnh.' }
    }
    if (apiRef.current.enabled) {
      try {
        const result = await runRemoteDomainCommand('salary_adjustment.create', {
          employeeId: employee.id,
          period,
          type: payload.type || 'Thưởng khác',
          amount,
          note: String(payload.note || '').trim(),
        }, payload.idempotencyKey || `salary-adjustment:${crypto.randomUUID()}`)
        notify(`Đã tạo khoản ${result.adjustment.type.toLowerCase()}.`)
        return { ok: true, adjustment: result.adjustment }
      } catch (error) {
        notify(error.message || 'Không thể tạo khoản điều chỉnh lương.', 'info')
        return { ok: false, message: error.message }
      }
    }
    const timestamp = new Date().toISOString()
    const record = { id: uid('ADJ'), employeeId: employee.id, employeeName: employee.name, storeId: employee.storeId, period, type: payload.type || 'Thưởng khác', amount, note: String(payload.note || '').trim(), status: 'Đã tạo', createdAt: timestamp, createdBy: actorSnapshot(state.session) }
    setState((current) => ({
      ...current,
      salaryAdjustments: [record, ...current.salaryAdjustments],
      payrollPeriods: current.payrollPeriods.map((item) => item.storeId === employee.storeId && item.period === period && item.status === 'Đã chốt' && !item.confirmedAt && !item.lockedAt ? { ...item, needsReclose: true, invalidatedAt: timestamp, invalidationReason: 'salary_adjustment.create' } : item),
      stateVersion: current.stateVersion + 1,
    }))
    notify(`Đã tạo khoản ${record.type.toLowerCase()}.`)
    return { ok: true, adjustment: record }
  }

  const getAvailableSalary = (employeeId, period = monthKey()) => Math.max(0, employeeGrossFor(state, employeeId, period) - advancePaidFor(state, employeeId, period))

  const createSalaryAdvance = async (payload = {}) => {
    if (state.session?.role !== 'admin') return { ok: false, message: 'Chỉ Admin được tạo ứng lương.' }
    const employee = state.employees.find((item) => item.id === payload.employeeId)
    const period = payload.period || monthKey()
    const amount = nonNegativeInteger(payload.amount)
    const available = getAvailableSalary(payload.employeeId, period)
    if (!employee || amount <= 0 || amount >= available) return { ok: false, message: `Số tiền ứng phải lớn hơn 0 và nhỏ hơn lương khả dụng ${available.toLocaleString('vi-VN')}đ.` }
    const idempotencyKey = String(payload.idempotencyKey || '').trim()
    if (apiRef.current.enabled) {
      try {
        const result = await runRemoteDomainCommand('salary_advance.create', {
          employeeId: employee.id,
          period,
          amount,
          note: String(payload.note || '').trim(),
        }, idempotencyKey || `salary-advance:${crypto.randomUUID()}`)
        notify('Đã tạo đề nghị ứng lương.')
        return { ok: true, advance: result.advance }
      } catch (error) {
        notify(error.message || 'Không thể tạo khoản ứng lương.', 'info')
        return { ok: false, message: error.message }
      }
    }
    if (idempotencyKey && state.idempotencyKeys.includes(idempotencyKey)) return { ok: true, existing: true }
    const timestamp = new Date().toISOString()
    const advance = { id: uid('ADV'), employeeId: employee.id, employeeName: employee.name, storeId: employee.storeId, period, amount, availableAtCreation: available, remainingAfter: available - amount, note: String(payload.note || '').trim(), status: 'Mới tạo', createdAt: timestamp, createdBy: actorSnapshot(state.session), confirmedAt: null, confirmedBy: null, idempotencyKey: idempotencyKey || null }
    setState((current) => ({ ...current, salaryAdvances: [advance, ...current.salaryAdvances], idempotencyKeys: idempotencyKey ? [...current.idempotencyKeys, idempotencyKey] : current.idempotencyKeys, stateVersion: current.stateVersion + 1 }))
    notify('Đã tạo đề nghị ứng lương.')
    return { ok: true, advance }
  }

  const updateSalaryAdvance = async (id, payload = {}) => {
    const previous = state.salaryAdvances.find((item) => item.id === id)
    if (!previous || previous.status !== 'Mới tạo') return { ok: false, message: 'Chỉ khoản ứng mới tạo mới được chỉnh sửa.' }
    const availableWithoutCurrent = getAvailableSalary(previous.employeeId, previous.period)
    const amount = nonNegativeInteger(payload.amount ?? previous.amount)
    if (amount <= 0 || amount >= availableWithoutCurrent) return { ok: false, message: 'Số tiền ứng phải nhỏ hơn lương khả dụng.' }
    if (apiRef.current.enabled) {
      try {
        const result = await runRemoteDomainCommand('salary_advance.update', {
          advanceId: id,
          amount,
          note: payload.note == null ? previous.note : String(payload.note).trim(),
        })
        notify('Đã cập nhật khoản ứng lương.')
        return { ok: true, advance: result.advance }
      } catch (error) {
        notify(error.message || 'Không thể cập nhật khoản ứng lương.', 'info')
        return { ok: false, message: error.message }
      }
    }
    const next = { ...previous, amount, remainingAfter: availableWithoutCurrent - amount, note: payload.note == null ? previous.note : String(payload.note).trim(), updatedAt: new Date().toISOString() }
    updateCollection('salaryAdvances', (items) => items.map((item) => item.id === id ? next : item))
    notify('Đã cập nhật khoản ứng lương.')
    return { ok: true, advance: next }
  }

  const confirmSalaryAdvance = async (id) => {
    const previous = state.salaryAdvances.find((item) => item.id === id)
    if (!previous || previous.status !== 'Mới tạo') return { ok: false, message: 'Khoản ứng không còn ở trạng thái có thể xác nhận.' }
    const available = getAvailableSalary(previous.employeeId, previous.period)
    if (previous.amount >= available) return { ok: false, message: 'Lương khả dụng đã thay đổi; vui lòng điều chỉnh số tiền ứng.' }
    if (apiRef.current.enabled) {
      try {
        const result = await runRemoteDomainCommand('salary_advance.confirm', { advanceId: id })
        notify('Đã xác nhận chi ứng lương.')
        return { ok: true, advance: result.advance }
      } catch (error) {
        notify(error.message || 'Không thể xác nhận chi ứng lương.', 'info')
        return { ok: false, message: error.message }
      }
    }
    const timestamp = new Date().toISOString()
    const actor = actorSnapshot(state.session)
    const confirmed = { ...previous, status: 'Đã chi', confirmedAt: timestamp, confirmedBy: actor, remainingAfter: available - previous.amount }
    const transaction = { id: uid('TXN'), storeId: previous.storeId, type: 'Ứng lương', direction: 'out', amount: previous.amount, sourceType: 'salary-advance', sourceId: previous.id, occurredAt: timestamp, createdAt: timestamp, actor }
    const expense = { id: uid('EXP'), storeId: previous.storeId, type: 'Ứng lương', category: 'payroll', amount: previous.amount, description: `Ứng lương ${previous.employeeName}`, sourceType: 'salary-advance', sourceId: previous.id, recognized: true, occurredAt: timestamp, createdAt: timestamp, createdBy: actor.id }
    const audit = { id: uid('AUD'), entity: 'salary-advance', entityId: id, action: 'confirm', before: previous, after: confirmed, actor, createdAt: timestamp }
    setState((current) => ({ ...current, salaryAdvances: current.salaryAdvances.map((item) => item.id === id ? confirmed : item), cashTransactions: [transaction, ...current.cashTransactions], expenseEntries: [expense, ...current.expenseEntries], auditLogs: [audit, ...current.auditLogs], stateVersion: current.stateVersion + 1 }))
    notify('Đã xác nhận chi ứng lương.')
    return { ok: true, advance: confirmed }
  }

  const closePayrollPeriod = async (storeId = state.activeStoreId, period = monthKey()) => {
    const existing = state.payrollPeriods.find((item) => item.storeId === storeId && item.period === period)
    if (existing?.status === 'Đã khóa') return { ok: false, message: 'Kỳ lương đã khóa.' }
    if (apiRef.current.enabled) {
      try {
        const result = await runRemoteDomainCommand('payroll.close', { storeId, period })
        notify(`Đã chốt sổ kỳ ${period}.`)
        return { ok: true, period: result.period }
      } catch (error) {
        notify(error.message || 'Không thể chốt kỳ lương.', 'info')
        return { ok: false, message: error.message }
      }
    }
    const employees = state.employees.filter((item) => item.storeId === storeId && item.status !== 'Đã nghỉ việc')
    const employeeHours = employees.map((employee) => ({
      id: employee.id,
      role: 'employee',
      hours: state.attendance.filter((record) => !record.deletedAt && record.employeeId === employee.id && isInMonth(record, period)).reduce((sum, record) => sum + Math.max(0, Number(record.hours) || 0), 0),
    }))
    const periodStart = `${period}-01`
    const periodEnd = `${period}-${String(new Date(Number(period.slice(0, 4)), Number(period.slice(5, 7)), 0).getDate()).padStart(2, '0')}`
    const summary = financeSummaryFromState(state, { storeId, from: periodStart, to: periodEnd })
    const kpi = calculateKpiBonuses({
      profit: summary.profit,
      participants: employeeHours,
      employeeTiers: [
        { threshold: 30000, ratePercent: state.policies.employeeKpiRates.from30000 },
        { threshold: 15000, ratePercent: state.policies.employeeKpiRates.from15000 },
        { threshold: 7000, ratePercent: state.policies.employeeKpiRates.from7000 },
      ],
      policyId: `policy-v${state.policies.version}`,
      policyEffectiveAt: state.policies.effectiveFrom,
    })
    const rows = employees.map((employee) => {
      const kpiBonus = kpi.results.find((result) => result.id === employee.id)?.amount || 0
      const gross = employeeGrossFor(state, employee.id, period) + kpiBonus
      const advancesPaid = advancePaidFor(state, employee.id, period)
      return { employeeId: employee.id, employeeName: employee.name, hours: employeeHours.find((item) => item.id === employee.id)?.hours || 0, gross, kpiBonus, advancesPaid, remaining: Math.max(0, gross - advancesPaid), salarySnapshot: { salary: employee.salary, monthlySalary: employee.monthlySalary, hourlyRate: employee.hourlyRate, tiktokAllowance: employee.tiktokAllowance } }
    })
    const timestamp = new Date().toISOString()
    const periodRecord = { id: existing?.id || uid('PAY'), storeId, period, rows, kpiSnapshot: kpi, financeSnapshot: summary, policySnapshot: clone(state.policies), status: 'Đã chốt', closedAt: timestamp, closedBy: actorSnapshot(state.session), confirmedAt: existing?.confirmedAt || null, lockedAt: null }
    setState((current) => ({ ...current, payrollPeriods: [periodRecord, ...current.payrollPeriods.filter((item) => !(item.storeId === storeId && item.period === period))], stateVersion: current.stateVersion + 1 }))
    notify(`Đã chốt sổ kỳ ${period}.`)
    return { ok: true, period: periodRecord }
  }

  const confirmPayrollPayment = async (storeId = state.activeStoreId, period = monthKey()) => {
    const snapshot = state.payrollPeriods.find((item) => item.storeId === storeId && item.period === period)
    if (snapshot?.confirmedAt) return { ok: false, message: 'Kỳ lương đã được xác nhận chi.' }
    if (apiRef.current.enabled) {
      if (!snapshot) return { ok: false, message: 'Cần chốt sổ trước khi xác nhận chi lương.' }
      try {
        const result = await runRemoteDomainCommand('payroll.pay', { storeId, period })
        notify(`Đã xác nhận chi lương kỳ ${period}.`)
        return { ok: true, period: result.period, payments: result.payments || [] }
      } catch (error) {
        notify(error.message || 'Không thể xác nhận chi lương.', 'info')
        return { ok: false, message: error.message }
      }
    }
    const source = snapshot || (await closePayrollPeriod(storeId, period)).period
    if (!source) return { ok: false, message: 'Không thể tạo số liệu kỳ lương.' }
    const timestamp = new Date().toISOString()
    const actor = actorSnapshot(state.session)
    const employeePayments = source.rows.filter((row) => row.remaining > 0).map((row) => ({ id: uid('PAYTX'), storeId, period, employeeId: row.employeeId, employeeName: row.employeeName, amount: row.remaining, type: 'Lương nhân viên', createdAt: timestamp, actor }))
    const payments = employeePayments
    const expenses = payments.map((payment) => ({ id: uid('EXP'), storeId, type: payment.type, category: 'payroll', amount: payment.amount, description: `${payment.type} kỳ ${period}`, sourceType: 'payroll-payment', sourceId: payment.id, recognized: true, occurredAt: timestamp, createdAt: timestamp, createdBy: actor.id }))
    const transactions = payments.map((payment) => ({ id: uid('TXN'), storeId, type: payment.type, direction: 'out', amount: payment.amount, sourceType: 'payroll-payment', sourceId: payment.id, occurredAt: timestamp, createdAt: timestamp, actor }))
    const confirmed = { ...source, confirmedAt: timestamp, confirmedBy: actor, status: 'Đã chi' }
    setState((current) => ({ ...current, payrollPeriods: [confirmed, ...current.payrollPeriods.filter((item) => !(item.storeId === storeId && item.period === period))], payrollPayments: [...payments, ...current.payrollPayments], expenseEntries: [...expenses, ...current.expenseEntries], cashTransactions: [...transactions, ...current.cashTransactions], stateVersion: current.stateVersion + 1 }))
    notify(`Đã xác nhận chi lương kỳ ${period}.`)
    return { ok: true, payments }
  }

  const lockPayrollPeriod = async (storeId = state.activeStoreId, period = monthKey()) => {
    const previous = state.payrollPeriods.find((item) => item.storeId === storeId && item.period === period)
    if (!previous) return { ok: false, message: 'Cần chốt sổ trước khi khóa kỳ.' }
    if (previous.status === 'Đã khóa') return { ok: true, existing: true }
    if (apiRef.current.enabled) {
      try {
        const result = await runRemoteDomainCommand('payroll.lock', { storeId, period })
        notify(`Đã khóa kỳ lương ${period}.`)
        return { ok: true, period: result.period }
      } catch (error) {
        notify(error.message || 'Không thể khóa kỳ lương.', 'info')
        return { ok: false, message: error.message }
      }
    }
    const timestamp = new Date().toISOString()
    const actor = actorSnapshot(state.session)
    const locked = { ...previous, status: 'Đã khóa', lockedAt: timestamp, lockedBy: actor }
    const audit = { id: uid('AUD'), entity: 'payroll-period', entityId: previous.id, action: 'lock', before: previous, after: locked, actor, createdAt: timestamp }
    setState((current) => ({ ...current, payrollPeriods: current.payrollPeriods.map((item) => item.id === previous.id ? locked : item), auditLogs: [audit, ...current.auditLogs], stateVersion: current.stateVersion + 1 }))
    notify(`Đã khóa kỳ lương ${period}.`)
    return { ok: true, period: locked }
  }

  const createShiftDefinition = (payload = {}) => {
    const name = String(payload.name || '').trim()
    if (!name || !payload.start || !payload.end || !payload.date) return { ok: false, message: 'Vui lòng nhập đủ tên, thời gian và ngày áp dụng.' }
    const definition = { id: uid('SHIFT'), storeId: payload.storeId || state.activeStoreId, name, start: payload.start, end: payload.end, time: `${payload.start} - ${payload.end}`, date: payload.date, effectiveFrom: payload.date, color: payload.color || '#075fba', tint: '#edf5ff', active: true, version: 1, createdAt: new Date().toISOString(), createdBy: actorSnapshot(state.session) }
    updateCollection('shiftDefinitions', (items) => [definition, ...items])
    notify('Đã tạo ca làm việc theo ngày.')
    return { ok: true, shift: definition }
  }

  const updateShiftDefinition = (id, payload = {}) => {
    const previous = state.shiftDefinitions.find((item) => item.id === id)
    if (!previous) return { ok: false, message: 'Không tìm thấy ca làm việc.' }
    const next = { ...previous, ...payload, time: `${payload.start || previous.start} - ${payload.end || previous.end}`, version: Number(previous.version || 1) + 1, updatedAt: new Date().toISOString(), updatedBy: actorSnapshot(state.session) }
    updateCollection('shiftDefinitions', (items) => items.map((item) => item.id === id ? next : item))
    notify('Đã cập nhật ca; dữ liệu lịch sử giữ nguyên bản chụp cũ.')
    return { ok: true, shift: next }
  }

  const deleteShiftDefinition = (id) => {
    updateCollection('shiftDefinitions', (items) => items.map((item) => item.id === id ? { ...item, active: false, deletedAt: new Date().toISOString(), deletedBy: actorSnapshot(state.session) } : item))
    notify('Đã ngừng sử dụng ca làm việc.', 'info')
    return true
  }

  const saveScheduleMultiple = (employeeIds = [], shiftIds = [], details = {}) => {
    const date = details.date || today()
    if (!employeeIds.length || !shiftIds.length) return { ok: false, message: 'Vui lòng chọn ca và nhân viên.' }
    updateCollection('schedule', (items) => {
      const next = [...items]
      employeeIds.forEach((employeeId) => {
        const employee = state.employees.find((item) => item.id === employeeId)
        const keyIndex = next.findIndex((item) => item.employeeId === employeeId && (item.date || date) === date)
        const current = keyIndex >= 0 ? next[keyIndex] : { employeeId, storeId: employee?.storeId || state.activeStoreId, date, shiftIds: [] }
        const merged = [...new Set([...(current.shiftIds || []), ...shiftIds])]
        const snapshots = merged.map((shiftId) => {
          const shift = state.shiftDefinitions.find((item) => item.id === shiftId)
          return shift ? { id: shift.id, name: shift.name, start: shift.start, end: shift.end, version: shift.version } : { id: shiftId }
        })
        const value = { ...current, date, shiftIds: merged, shiftSnapshots: snapshots, note: details.note || current.note || '' }
        if (keyIndex >= 0) next[keyIndex] = value
        else next.unshift(value)
      })
      return next
    })
    notify('Đã lưu lịch phân ca.')
    return { ok: true }
  }

  const createImportVoucher = async (payload = {}) => {
    const storeId = payload.storeId || state.activeStoreId || state.session?.storeId
    const items = Array.isArray(payload.items) ? payload.items.filter(Boolean) : []
    if (!storeId || !items.length) return { ok: false, message: 'Phiếu nhập cần có ít nhất một hàng hóa.' }
    const shippingAmount = nonNegativeInteger(payload.shippingAmount)
    const relatedAmount = nonNegativeInteger(payload.relatedAmount)
    if (apiRef.current.enabled) {
      try {
        const result = await runRemoteDomainCommand('import.create', {
          storeId,
          items,
          shippingAmount,
          relatedAmount,
        }, payload.idempotencyKey || `import:${crypto.randomUUID()}`)
        notify(`Đã lưu phiếu nhập ${result.voucher.code}.`)
        return { ok: true, voucher: result.voucher }
      } catch (error) {
        notify(error.message || 'Không thể lưu phiếu nhập.', 'info')
        return { ok: false, message: error.message }
      }
    }
    const sequence = Math.max(1, Number(state.importCounter) + 1)
    const timestamp = new Date().toISOString()
    const goodsAmount = items.reduce((sum, item) => sum + Math.round((Number(item.quantity) || Number(item.weight) || 0) * (Number(item.price) || 0)), 0)
    const voucher = { id: uid('PV'), code: `PN-${voucherDate(timestamp)}-${String(sequence).padStart(5, '0')}`, storeId, items, goodsAmount, shippingAmount, relatedAmount, totalAmount: goodsAmount + shippingAmount + relatedAmount, status: 'Đã lưu', createdAt: timestamp, createdBy: actorSnapshot(state.session), idempotencyKey: payload.idempotencyKey || null }
    const expense = { id: uid('EXP'), storeId, type: 'Nhập hàng', category: 'inventory', amount: voucher.totalAmount, description: `Phiếu nhập ${voucher.code}`, sourceType: 'import-voucher', sourceId: voucher.id, recognized: true, occurredAt: timestamp, createdAt: timestamp, createdBy: state.session?.id || state.session?.code }
    setState((current) => ({ ...current, importVouchers: [voucher, ...current.importVouchers], importCounter: sequence, expenseEntries: [expense, ...current.expenseEntries], stateVersion: current.stateVersion + 1 }))
    notify(`Đã lưu phiếu nhập ${voucher.code}.`)
    return { ok: true, voucher }
  }

  const updateImportVoucher = async (id, payload = {}) => {
    const previous = state.importVouchers.find((item) => item.id === id && !item.deletedAt)
    const reason = String(payload.reason || '').trim()
    if (!previous) return { ok: false, message: 'Không tìm thấy phiếu nhập.' }
    if (!reason) return { ok: false, message: 'Vui lòng nhập lý do chỉnh sửa phiếu nhập.' }
    const items = Array.isArray(payload.items) ? payload.items.filter(Boolean) : previous.items
    const shippingAmount = nonNegativeInteger(payload.shippingAmount ?? previous.shippingAmount)
    const relatedAmount = nonNegativeInteger(payload.relatedAmount ?? previous.relatedAmount)
    if (apiRef.current.enabled) {
      try {
        const result = await runRemoteDomainCommand('import.update', {
          voucherId: id,
          items,
          shippingAmount,
          relatedAmount,
          reason,
        })
        notify(`Đã cập nhật phiếu nhập ${result.voucher.code}.`)
        return { ok: true, voucher: result.voucher }
      } catch (error) {
        notify(error.message || 'Không thể cập nhật phiếu nhập.', 'info')
        return { ok: false, message: error.message }
      }
    }
    const goodsAmount = items.reduce((sum, item) => sum + Math.round((Number(item.quantity) || Number(item.weight) || 0) * (Number(item.price) || 0)), 0)
    const timestamp = new Date().toISOString()
    const actor = actorSnapshot(state.session)
    const voucher = { ...previous, items, goodsAmount, shippingAmount, relatedAmount, totalAmount: goodsAmount + shippingAmount + relatedAmount, updatedAt: timestamp, updatedBy: actor, updateReason: reason }
    const audit = { id: uid('AUD'), entity: 'import-voucher', entityId: id, action: 'update', reason, before: previous, after: voucher, actor, createdAt: timestamp }
    setState((current) => ({
      ...current,
      importVouchers: current.importVouchers.map((item) => item.id === id ? voucher : item),
      expenseEntries: current.expenseEntries.map((entry) => entry.sourceType === 'import-voucher' && entry.sourceId === id ? { ...entry, amount: voucher.totalAmount, description: `Phiếu nhập ${voucher.code}`, updatedAt: timestamp } : entry),
      auditLogs: [audit, ...current.auditLogs],
      stateVersion: current.stateVersion + 1,
    }))
    notify(`Đã cập nhật phiếu nhập ${voucher.code}.`)
    return { ok: true, voucher }
  }

  const deleteImportVoucher = async (id, reasonValue = '') => {
    const previous = state.importVouchers.find((item) => item.id === id && !item.deletedAt)
    const reason = String(reasonValue || '').trim()
    if (!previous) return { ok: false, message: 'Không tìm thấy phiếu nhập.' }
    if (!reason) return { ok: false, message: 'Vui lòng nhập lý do xóa phiếu nhập.' }
    if (apiRef.current.enabled) {
      try {
        const result = await runRemoteDomainCommand('import.delete', { voucherId: id, reason })
        notify(`Đã xóa phiếu nhập ${previous.code}.`, 'info')
        return { ok: true, voucher: result.voucher }
      } catch (error) {
        notify(error.message || 'Không thể xóa phiếu nhập.', 'info')
        return { ok: false, message: error.message }
      }
    }
    const timestamp = new Date().toISOString()
    const actor = actorSnapshot(state.session)
    const voucher = { ...previous, status: 'Đã xóa', deletedAt: timestamp, deletedBy: actor, deleteReason: reason }
    const audit = { id: uid('AUD'), entity: 'import-voucher', entityId: id, action: 'delete', reason, before: previous, after: voucher, actor, createdAt: timestamp }
    setState((current) => ({
      ...current,
      importVouchers: current.importVouchers.map((item) => item.id === id ? voucher : item),
      expenseEntries: current.expenseEntries.map((entry) => entry.sourceType === 'import-voucher' && entry.sourceId === id ? { ...entry, recognized: false, voidedAt: timestamp, voidedBy: actor.id } : entry),
      auditLogs: [audit, ...current.auditLogs],
      stateVersion: current.stateVersion + 1,
    }))
    notify(`Đã xóa phiếu nhập ${previous.code}.`, 'info')
    return { ok: true, voucher }
  }

  const saveSupportTransfer = (payload = {}) => {
    const record = { id: uid('SUP'), employeeId: payload.employeeId, fromStoreId: payload.fromStoreId, toStoreId: payload.toStoreId, fromDate: payload.fromDate, toDate: payload.toDate, note: String(payload.note || '').trim(), status: 'Đã duyệt', createdAt: new Date().toISOString(), createdBy: actorSnapshot(state.session) }
    updateCollection('supportTransfers', (items) => [record, ...items])
    notify('Đã lưu điều chuyển hỗ trợ.')
    return record
  }

  const addAttendanceRecord = (payload) => {
    const record = { id: payload.id || uid('CC'), ...payload, deletedAt: null }
    updateCollection('attendance', (items) => [record, ...items])
    return record
  }

  const updateAttendance = (id, payload) => {
    if (state.session?.role !== 'admin') {
      notify('Chỉ Quản trị viên cấp cao được chỉnh sửa chấm công.', 'info')
      return false
    }
    const previous = state.attendance.find((record) => record.id === id)
    if (!previous) return false
    const next = { ...previous, ...payload }
    next.hours = calculateWorkedHours(next.checkInAt || next.checkIn, next.checkOutAt || next.checkOut)
    next.arrivalTag = getArrivalTag(next.checkIn || next.checkInTime, next.shiftStart, state.policies.lateToleranceMinutes)
    next.punctuality = next.arrivalTag
    next.status = next.arrivalTag
    next.minutesLate = minutesLate(next.checkIn || next.checkInTime, next.shiftStart)
    const timestamp = new Date().toISOString()
    const actor = actorSnapshot(state.session)
    const audit = { id: uid('AUD'), entity: 'attendance', entityId: id, action: 'update', before: previous, after: next, actor, createdAt: timestamp }
    setState((current) => ({ ...current, attendance: current.attendance.map((record) => record.id === id ? next : record), auditLogs: [audit, ...current.auditLogs], stateVersion: current.stateVersion + 1 }))
    notify('Đã cập nhật chấm công và tính lại số giờ.')
    return true
  }

  const deleteAttendance = (id) => {
    if (state.session?.role !== 'admin') return false
    const previous = state.attendance.find((record) => record.id === id)
    if (!previous) return false
    const timestamp = new Date().toISOString()
    const actor = actorSnapshot(state.session)
    const next = { ...previous, deletedAt: timestamp, deletedBy: actor }
    const audit = { id: uid('AUD'), entity: 'attendance', entityId: id, action: 'delete', before: previous, after: next, actor, createdAt: timestamp }
    setState((current) => ({ ...current, attendance: current.attendance.map((record) => record.id === id ? next : record), auditLogs: [audit, ...current.auditLogs], stateVersion: current.stateVersion + 1 }))
    return true
  }

  const checkIn = async (payload = {}) => {
    const employeeId = payload.employeeId || state.session?.employeeId || state.session?.code
    const employee = state.employees.find((item) => item.id === employeeId || item.code === employeeId)
    if (!employee) {
      notify('Không tìm thấy hồ sơ nhân viên để điểm danh.', 'info')
      return { ok: false }
    }

    if (apiRef.current.enabled) {
      const idempotencyKey = payload.idempotencyKey || `attendance-in:${crypto.randomUUID()}`
      try {
        const result = await runRemoteDomainCommand('attendance.check_in', {
          shiftId: payload.shiftId || payload.shift,
          location: payload.location || payload.coords || payload,
        }, idempotencyKey)
        notify(`Điểm danh thành công lúc ${result.attendance.checkIn}.`)
        return { ok: true, record: result.attendance }
      } catch (error) {
        notify(error.message || 'Không thể điểm danh.', 'info')
        return { ok: false, message: error.message }
      }
    }

    const at = resolveDate(payload.at || payload.checkInAt)
    const workDate = payload.date || today(at)
    const existing = state.attendance.find((record) => record.employeeId === employee.id && !record.deletedAt && !record.checkOut && !record.checkOutAt)
    if (existing) {
      setState((current) => ({ ...current, activeAttendanceId: existing.id, checkedInAt: existing.checkIn || existing.checkInTime, finishedShift: false }))
      notify('Bạn đã điểm danh ca làm việc này.', 'info')
      return { ok: true, record: existing, existing: true }
    }

    const scheduled = state.shiftDefinitions.find((shift) => shift.id === payload.shiftId && shift.active !== false)
      || shifts.find((shift) => shift.id === payload.shiftId)
    const shiftId = payload.shiftId || payload.shift || 'ca1'
    const shiftStart = payload.shiftStart || scheduled?.start || employee.workStart || (employee.unit === 'office' ? '08:00' : '07:00')
    const shiftEnd = payload.shiftEnd || scheduled?.end || employee.workEnd || (employee.unit === 'office' ? '17:00' : '12:00')
    const checkInTime = timeLabel(at)
    const storeName = state.stores.find((store) => store.id === employee.storeId)?.name
    const rawLocation = payload.location || payload.coords || (
      payload.latitude != null || payload.lat != null ? payload : null
    )
    const location = normalizeLocation(rawLocation, employee.unit === 'office' ? 'Văn phòng IDOSI' : storeName || 'IDOSI')
    const toleranceMinutes = payload.toleranceMinutes ?? state.policies.lateToleranceMinutes
    const arrivalTag = getArrivalTag(checkInTime, shiftStart, toleranceMinutes)
    const earlyMinutes = Math.max(0, -minuteDifference(checkInTime, shiftStart))
    if (earlyMinutes > Number(state.policies.earlyCheckInLimitMinutes || 120)) {
      notify(`Chỉ được điểm danh sớm tối đa ${state.policies.earlyCheckInLimitMinutes || 120} phút.`, 'info')
      return { ok: false, message: 'Vượt quá giới hạn điểm danh sớm.' }
    }
    const record = {
      id: uid('CC'),
      date: workDate,
      workDate,
      attendanceDate: workDate,
      employeeId: employee.id,
      employeeName: employee.name,
      storeId: employee.storeId,
      unit: employee.unit,
      unitType: employee.unit,
      department: employee.unit,
      employmentTypeSnapshot: employee.employmentType,
      payBasisSnapshot: employee.payBasis,
      monthlySalarySnapshot: employee.monthlySalary,
      hourlyRateSnapshot: employee.hourlyRate,
      standardWorkDaysSnapshot: employee.standardWorkDays,
      shift: shiftId,
      shiftName: scheduled?.name || payload.shiftName || shiftId,
      shiftStart,
      shiftEnd,
      checkIn: checkInTime,
      checkInTime,
      checkInAt: localDateTime(at),
      checkInLocation: location,
      location,
      locationName: location?.label || '',
      checkOut: null,
      checkOutTime: null,
      checkOutAt: null,
      checkOutLocation: null,
      arrivalTag,
      departureTag: 'Chưa ra về',
      punctuality: arrivalTag,
      status: arrivalTag,
      minutesLate: minutesLate(checkInTime, shiftStart),
      hours: 0,
      note: arrivalTag === 'Đi trễ' ? 'Đi trễ so với giờ bắt đầu' : '',
    }
    setState((current) => ({
      ...current,
      attendance: [record, ...current.attendance],
      activeAttendanceId: record.id,
      checkedInAt: checkInTime,
      finishedShift: false,
    }))
    notify(`Điểm danh thành công lúc ${checkInTime}.`)
    return { ok: true, record }
  }

  const closeAttendance = async (payload = {}, finishMessage = false) => {
    const employeeId = payload.employeeId || state.session?.employeeId || state.session?.code
    const openRecord = state.attendance.find((record) =>
      (state.activeAttendanceId ? record.id === state.activeAttendanceId : record.employeeId === employeeId)
      && !record.checkOut
      && !record.checkOutAt,
    )
    if (!openRecord) {
      notify('Không tìm thấy lượt điểm danh đang mở.', 'info')
      return { ok: false }
    }

    if (apiRef.current.enabled) {
      const idempotencyKey = payload.idempotencyKey || `attendance-out:${crypto.randomUUID()}`
      try {
        const commandPayload = {
          attendanceId: openRecord.id,
          location: payload.location || payload.coords || payload,
          ...(payload.expense == null ? {} : { expense: nonNegativeInteger(payload.expense) }),
          ...(payload.tiktok == null ? {} : { tiktok: Boolean(payload.tiktok) }),
        }
        const result = await runRemoteDomainCommand('attendance.check_out', commandPayload, idempotencyKey)
        notify(finishMessage ? 'Đã kết ca và lưu thông tin chấm công.' : `Đã ghi nhận ra về lúc ${result.attendance.checkOut}.`)
        return { ok: true, record: result.attendance }
      } catch (error) {
        notify(error.message || 'Không thể ghi nhận ra về.', 'info')
        return { ok: false, message: error.message }
      }
    }

    const at = resolveDate(payload.at || payload.checkOutAt)
    const checkOutTime = timeLabel(at)
    const rawLocation = payload.location || payload.coords || (
      payload.latitude != null || payload.lat != null ? payload : null
    )
    const location = normalizeLocation(rawLocation, openRecord.locationName || 'IDOSI')
    const departureTag = getDepartureTag(checkOutTime, openRecord.shiftEnd, payload.toleranceMinutes ?? state.policies.lateToleranceMinutes)
    const checkOutAt = localDateTime(at)
    const hours = calculateWorkedHours(openRecord.checkInAt || openRecord.checkIn, checkOutAt)
    const updated = {
      ...openRecord,
      ...payload.details,
      checkOut: checkOutTime,
      checkOutTime,
      checkOutAt,
      checkOutLocation: location,
      departureTag,
      hours,
      revenue: Number(payload.revenue ?? payload.totalRevenue ?? (Number(payload.cash || 0) + Number(payload.transfer || 0))) || Number(openRecord.revenue) || 0,
      expense: Number(payload.expense) || Number(openRecord.expense) || 0,
      cash: Number(payload.cash) || Number(openRecord.cash) || 0,
      transfer: Number(payload.transfer) || Number(openRecord.transfer) || 0,
      tiktok: Boolean(payload.tiktok ?? openRecord.tiktok),
      note: payload.note ?? openRecord.note,
    }
    setState((current) => ({
      ...current,
      attendance: current.attendance.map((record) => record.id === openRecord.id ? updated : record),
      expenseEntries: updated.expense > 0 && !current.expenseEntries.some((entry) => entry.sourceType === 'shift-expense' && entry.sourceId === openRecord.id)
        ? [{ id: uid('EXP'), storeId: openRecord.storeId, type: 'Chi phí trong ca', category: 'shift', amount: updated.expense, description: `Chi phí ${openRecord.shiftName || openRecord.shift}`, sourceType: 'shift-expense', sourceId: openRecord.id, recognized: true, occurredAt: checkOutAt, createdAt: checkOutAt, createdBy: employeeId, employeeId, shiftId: openRecord.shift }, ...current.expenseEntries]
        : current.expenseEntries,
      cashTransactions: updated.expense > 0 && !current.cashTransactions.some((entry) => entry.sourceType === 'shift-expense' && entry.sourceId === openRecord.id)
        ? [{ id: uid('TXN'), storeId: openRecord.storeId, type: 'Chi phí trong ca', direction: 'out', amount: updated.expense, sourceType: 'shift-expense', sourceId: openRecord.id, occurredAt: checkOutAt, createdAt: checkOutAt, actor: actorSnapshot(current.session) }, ...current.cashTransactions]
        : current.cashTransactions,
      activeAttendanceId: null,
      checkedInAt: openRecord.checkIn || openRecord.checkInTime,
      finishedShift: true,
    }))
    notify(finishMessage ? 'Đã kết ca và lưu thông tin chấm công.' : `Đã ghi nhận ra về lúc ${checkOutTime}.`)
    return { ok: true, record: updated }
  }

  const checkOut = (payload = {}) => closeAttendance(payload, false)
  const finishShift = (payload = {}) => closeAttendance(payload, true)

  const resetDemo = () => {
    setState(createInitialState())
    notify('Đã khôi phục dữ liệu mẫu IDOSI.', 'info')
  }

  const selectedStoreId = state.session?.role === 'employee'
    ? state.session.storeId
    : state.activeStoreId || state.session?.storeId
  const activeStore = state.stores.find((store) => store.id === selectedStoreId)
    || (state.session?.role === 'employee' ? null : state.stores[0] || null)
  const currentEmployee = state.session?.employeeId ? state.employees.find((employee) => employee.id === state.session.employeeId) || null : null

  const value = {
    ...state,
    activeStore,
    currentEmployee,
    apiStatus,
    toast,
    notify,
    login,
    quickLogin,
    logout,
    setActiveStoreId,
    setActiveStore: setActiveStoreId,
    addStore,
    updateStore,
    deleteStore,
    addEmployee,
    updateEmployee,
    deleteEmployee,
    addOfficeAdjustment,
    updateOfficeAdjustment,
    deleteOfficeAdjustment,
    addImport,
    updateImport,
    deleteImport,
    setTaskDone,
    replaceTasks,
    saveSchedule,
    changeAdminPassword,
    verifyCurrentPassword,
    saveSettings,
    createOrder,
    updateOrder,
    deleteOrder,
    readNotification,
    clearNotifications,
    savePolicies,
    addFixedExpense,
    addSalaryAdjustment,
    getAvailableSalary,
    createSalaryAdvance,
    updateSalaryAdvance,
    confirmSalaryAdvance,
    closePayrollPeriod,
    confirmPayrollPayment,
    lockPayrollPeriod,
    createShiftDefinition,
    updateShiftDefinition,
    deleteShiftDefinition,
    saveScheduleMultiple,
    createImportVoucher,
    updateImportVoucher,
    deleteImportVoucher,
    saveSupportTransfer,
    addAttendanceRecord,
    updateAttendance,
    deleteAttendance,
    checkIn,
    checkOut,
    clockIn: checkIn,
    clockOut: checkOut,
    finishShift,
    resetDemo,
  }

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

export const useApp = () => {
  const context = useContext(AppContext)
  if (!context) throw new Error('useApp must be used inside AppProvider')
  return context
}
