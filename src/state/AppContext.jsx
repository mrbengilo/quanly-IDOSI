/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import {
  adminAccountsSeed,
  attendanceSeed,
  employeesSeed,
  importsSeed,
  managerAccountsSeed,
  officeAdjustmentsSeed,
  scheduleSeed,
  shifts,
  storesSeed,
  tasksSeed,
} from '../data'
import {
  buildAddress,
  businessDate,
  calculateEmployeeBasePay,
  calculateWorkedHours,
  getEmployeeType,
  getPayBasis,
  getHourlyRate,
  getMonthlySalary,
  getArrivalTag,
  getDepartureTag,
  normalizeLocation,
  normalizePhone,
  operationalIdentifierEntry,
  operationalIdentifierRecordMatch,
  operationalIdentifierReferenceMatchesRecord,
  resolveStoreEmployeeSalaryPolicy,
  timeToMinutes,
  today,
  uid,
} from '../utils'
import { createDomainState, defaultPolicies, migrateDomainState } from './initialDomainState'
import { applyNotificationCommandResult } from './notificationState'
import { hashPassword, verifyPassword } from '../security/passwords'
import { calculateAvailableSalary, financeSummaryFromState } from '../domain'
import { STORE_SALARY_CONFIG_IDENTIFIER_COLLISION } from '../domain/storeTieredPayroll'
import { validateAccountAvatarDataUrl } from '../domain/accountAvatar'
import { isVietnamDateTimeLocal, supportTransferBounds } from '../domain/supportTransferTime'
import {
  normalizeOrderInformationOptions,
  occupationValueAllowed,
  ORDER_INFORMATION_KIND,
  ORDER_PAYMENT_METHODS,
  validateOrderInformationOptionInput,
} from '../domain/orderInformationSettings'
import {
  resolveAttendanceShiftSelection,
  resolveAttendanceWorkingTime,
} from '../domain/attendanceWorkingTime'
import { resolveEffectiveWorkingTime } from '../domain/workTimeSchedule'
import { resolveExactlyOneActiveStoreManager } from '../domain/managerRevenueBonus'
import {
  apiBootstrapState,
  apiCommand,
  apiGetAccountAvatar,
  apiGetState,
  apiGetStateMetadata,
  apiLogin,
  apiSelectSessionRole,
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
export const SYSTEM_RESET_IDEMPOTENCY_STORAGE_KEY = 'idosi-system-reset-all-idempotency-key'
export const ACTIVE_STORE_STORAGE_PREFIX = 'idosi-active-store:'
const LEGACY_STORAGE_KEY = 'idosi-manager-state-v1'
const ACCOUNT_CREDENTIAL_EPOCH = 1
const LOCAL_CACHE_PRIVACY_EPOCH = 1
const LOCAL_PROFILE_CREDENTIAL_KEYS = new Set([
  'password', 'passwordHash', 'password_hash', 'passwordSalt', 'password_salt',
  'passwordIterations', 'legacyPassword', 'authUserId', 'authVersion', 'username',
  'token', 'accessToken', 'refreshToken',
])
const ACCOUNT_SETTINGS_KEYS = ['name', 'email', 'phone', 'birthday', 'gender', 'address', 'bio']

const accountAvatarMetadata = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const key = String(value.key || '')
  const contentType = String(value.contentType || '')
  const size = Number(value.size)
  const version = Number(value.version)
  if (!key.startsWith('account-avatars/')
    || !['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(contentType)
    || !Number.isSafeInteger(size) || size < 1
    || !Number.isSafeInteger(version) || version < 1) return null
  return { ...value, key, contentType, size, version }
}

const accountAvatarMetadataSignature = (value) => {
  const metadata = accountAvatarMetadata(value)
  return metadata ? `${metadata.key}:${metadata.version}` : ''
}

export const createAccountSettingsPayload = (settings = {}) => {
  const payload = Object.fromEntries(ACCOUNT_SETTINGS_KEYS
    .filter((key) => settings[key] !== undefined)
    .map((key) => [key, settings[key]]))
  if (settings.notifications && typeof settings.notifications === 'object') {
    payload.notifications = {
      tasks: Boolean(settings.notifications.tasks),
      dailyReport: Boolean(settings.notifications.dailyReport),
      expenseAlert: Boolean(settings.notifications.expenseAlert),
    }
  }
  if (settings.avatar !== undefined) {
    const avatar = typeof settings.avatar === 'string' ? settings.avatar.trim() : settings.avatar
    if (avatar === '') payload.avatar = ''
    else if (typeof avatar === 'string' && avatar.startsWith('data:image/')) {
      payload.avatar = validateAccountAvatarDataUrl(avatar).dataUrl
    } else if (avatar != null && typeof avatar !== 'string' && !accountAvatarMetadata(avatar)) {
      throw new Error('Ảnh đại diện không hợp lệ.')
    }
  }
  return payload
}

const ORDER_OPERATIONAL_MUTABLE_FIELDS = [
  'customerName', 'customerPhone', 'customerAge', 'gender', 'occupation', 'acquisitionChannel', 'amount', 'paymentMethod',
  'status', 'deletedAt', 'deletedBy', 'deleteReason',
]
const ATTENDANCE_CORRECTION_FIELDS = [
  'date', 'workDate', 'attendanceDate', 'checkIn', 'checkInTime', 'checkInAt',
  'checkOut', 'checkOutTime', 'checkOutAt', 'arrivalTag', 'departureTag',
  'punctuality', 'status', 'minutesEarly', 'minutesLate', 'workedSeconds',
  'workedMinutes', 'hours', 'workdayCredit', 'attendanceMode',
  'requiredWorkingDaysSnapshot', 'standardWorkDaysSnapshot',
  'editedAt', 'editedBy', 'editReason',
]

export const BUSINESS_SUPPORT_WORKING_TIME_FIELDS = Object.freeze([
  'workTimeType', 'workStart', 'workEnd', 'workShifts', 'workingTime',
])

export const canBusinessSupportUpdateEmployee = (previous = {}, payload = {}) => {
  const unit = String(previous.unit || previous.unitType || previous.department || '').trim().toLowerCase()
  const fields = Object.keys(payload || {})
  if (fields.some((field) => BUSINESS_SUPPORT_WORKING_TIME_FIELDS.includes(field))) return false
  if (['store', 'store_manager', 'office'].includes(unit)) return true
  return false
}

export const restoreOperationalRecordFields = (current, baseline, dataType) => {
  const fields = dataType === 'orders' ? ORDER_OPERATIONAL_MUTABLE_FIELDS : ATTENDANCE_CORRECTION_FIELDS
  const restored = { ...current }
  fields.forEach((field) => {
    if (Object.hasOwn(baseline, field)) restored[field] = baseline[field]
    else delete restored[field]
  })
  return restored
}

export const isRestorableOperationalAuditAction = (action, dataType) => (
  dataType === 'orders'
    ? ['Sửa', 'Xóa'].includes(String(action || ''))
    : ['Sửa', 'update'].includes(String(action || ''))
)

const clone = (value) => JSON.parse(JSON.stringify(value))
const normalizedIdentifier = (value) => String(value ?? '').trim().toLocaleLowerCase('en-US')
const sameIdentifier = (left, right) => (
  Boolean(normalizedIdentifier(left))
  && normalizedIdentifier(left) === normalizedIdentifier(right)
)
const employeeIdentifierValues = (employee = {}) => [
  employee.id,
  employee.code,
  employee.employeeId,
  employee.employeeCode,
].map((value) => String(value || '').trim()).filter(Boolean)
const resolveEmployeeIdentifier = (employees, reference) => operationalIdentifierRecordMatch(
  employees,
  reference,
  employeeIdentifierValues,
)
const resolveRecordIdentifier = (records, reference, identifierValuesOf = (record) => [record?.id]) => (
  operationalIdentifierRecordMatch(records, reference, identifierValuesOf)
)
const matchedRecordOrNull = (match) => (match?.ambiguous ? null : match?.record || null)
const hasOperationalIdentifierCollision = (records, identifierValuesOf = (record) => [record?.id]) => {
  const ownersByIdentifier = new Map()
  ;(Array.isArray(records) ? records : []).forEach((record, index) => {
    const values = identifierValuesOf(record)
    ;(Array.isArray(values) ? values : [values]).forEach((value) => {
      const key = normalizedIdentifier(value)
      if (!key) return
      const owners = ownersByIdentifier.get(key) || new Set()
      owners.add(index)
      ownersByIdentifier.set(key, owners)
    })
  })
  return [...ownersByIdentifier.values()].some((owners) => owners.size > 1)
}
const resolveOpenAttendanceIdentifier = (attendance, { employeeId, attendanceId = '' } = {}) => {
  const openRecords = (Array.isArray(attendance) ? attendance : []).filter((record) => (
    !record.deletedAt
    && !record.checkOutAt
    && !record.checkOut
    && (!employeeId || sameIdentifier(record.employeeId, employeeId))
  ))
  return operationalIdentifierRecordMatch(
    openRecords,
    attendanceId || employeeId,
    (record) => attendanceId ? [record.id] : [record.employeeId],
  )
}
const withCanonicalIdentifierEntry = (record, identifier, value) => {
  const canonicalIdentifier = String(identifier ?? '').trim()
  const entries = Object.entries(record && typeof record === 'object' && !Array.isArray(record) ? record : {})
  const existing = operationalIdentifierEntry(record, canonicalIdentifier)
  if (existing.ambiguous) return Object.fromEntries(entries)
  const entriesWithoutResolvedKey = entries
    .filter(([candidateId]) => candidateId !== existing.key)
  if (canonicalIdentifier) entriesWithoutResolvedKey.push([canonicalIdentifier, value])
  return Object.fromEntries(entriesWithoutResolvedKey)
}

const revenueBonusView = (dailyRecords = [], allocationRecords = []) => {
  const allocations = Array.isArray(allocationRecords) ? allocationRecords : []
  const daily = Array.isArray(dailyRecords) ? dailyRecords : []
  return daily.map((record) => {
    const linked = allocations.filter((allocation) => (
      operationalIdentifierReferenceMatchesRecord(
        daily,
        record,
        allocation?.revenueBonusDailyId || allocation?.calculationId,
      )
    ))
    return {
      ...record,
      allocations: linked.length ? linked : (Array.isArray(record?.allocations) ? record.allocations : []),
    }
  })
}

const REMOTE_ARRAY_KEYS = [
  'stores', 'employees', 'imports', 'attendance', 'schedule', 'tasks', 'taskAssignmentHistory', 'supportWorkAssignments', 'supportWorkSchedules', 'supportWorkScheduleHistory', 'officeAdjustments',
  'orders', 'orderInformationOptions', 'orderAudit', 'notifications', 'expenseEntries', 'fixedExpenses', 'cashTransactions',
  'salaryAdjustments', 'salaryAdvances', 'payrollPeriods', 'payrollPayments', 'shiftDefinitions',
  'storeEmployeeSalaryConfigs', 'workCatalogItems', 'workCatalogProgress',
  'storeShiftTaskTemplates', 'compensationEntries', 'violations', 'revenueBonusDaily', 'revenueBonusAllocations',
  'teamRewardClaims', 'teamRewardParticipants', 'periodReconciliations', 'jobRuns',
  'importVouchers', 'auditLogs', 'attendanceAudit', 'operationalResetHistory', 'deletedStores', 'deletedEmployees', 'supportTransfers',
]

const canonicalIdentifierMap = (records = [], identifierValues, canonicalValue) => {
  const result = new Map()
  const rows = Array.isArray(records) ? records : []
  rows.forEach((record) => {
    const canonical = String(canonicalValue(record) ?? '').trim()
    if (!canonical) return
    identifierValues(record).forEach((identifier) => {
      const key = normalizedIdentifier(identifier)
      if (!key) return
      if (!result.has(key)) result.set(key, canonical)
      else if (result.get(key) !== canonical) result.set(key, null)
    })
  })
  return result
}

const OPERATIONAL_REFERENCE_KEYS = {
  employee: new Set([
    'employeeid', 'employeeids', 'employeecode', 'staffid', 'staffids',
    'assigneeid', 'assigneeids', 'assignedemployeeid', 'assignedemployeeids',
    'createdbyemployeeid', 'manageremployeeid', 'participantemployeeid', 'participantemployeeids',
  ]),
  store: new Set([
    'storeid', 'storeids', 'homestoreid', 'fromstoreid', 'tostoreid', 'sourcestoreid',
    'destinationstoreid', 'targetstoreid', 'supportstoreid', 'assignedstoreid', 'effectivestoreid',
  ]),
  shift: new Set(['shiftid', 'shiftids', 'shift']),
  attendance: new Set(['attendanceid', 'attendanceids', 'checklistattendanceid']),
  task: new Set(['taskid', 'taskids']),
  workCatalog: new Set(['catalogitemid', 'catalogitemids', 'workcatalogitemid', 'workcatalogitemids']),
  supportTransfer: new Set(['supporttransferid', 'supporttransferids', 'activetransferid']),
}

const operationalReferenceKind = (key) => {
  const normalizedKey = String(key || '').replace(/[_-]/gu, '').toLocaleLowerCase('en-US')
  return Object.entries(OPERATIONAL_REFERENCE_KEYS)
    .find(([, keys]) => keys.has(normalizedKey))?.[0] || null
}

export const canonicalizeRemoteOperationalIdentifiers = (remoteState = {}) => {
  const source = remoteState && typeof remoteState === 'object' && !Array.isArray(remoteState) ? remoteState : {}
  const rows = (value) => (Array.isArray(value) ? value : [])
  const maps = {
    employee: canonicalIdentifierMap(
      [...rows(source.employees), ...rows(source.deletedEmployees)],
      (record) => [record?.id, record?.code, record?.employeeId, record?.employeeCode],
      (record) => record?.id || record?.code || record?.employeeId || record?.employeeCode,
    ),
    store: canonicalIdentifierMap(
      [...rows(source.stores), ...rows(source.deletedStores)],
      (record) => [record?.id, record?.storeId, record?.code],
      (record) => record?.id || record?.storeId || record?.code,
    ),
    shift: canonicalIdentifierMap(source.shiftDefinitions, (record) => [record?.id, record?.shiftId], (record) => record?.id || record?.shiftId),
    attendance: canonicalIdentifierMap(source.attendance, (record) => [record?.id, record?.attendanceId], (record) => record?.id || record?.attendanceId),
    task: canonicalIdentifierMap(source.tasks, (record) => [record?.id, record?.taskId], (record) => record?.id || record?.taskId),
    workCatalog: canonicalIdentifierMap(source.workCatalogItems, (record) => [record?.id], (record) => record?.id),
    supportTransfer: canonicalIdentifierMap(source.supportTransfers, (record) => [record?.id], (record) => record?.id),
  }
  const canonicalize = (value, referenceKind = null) => {
    if (Array.isArray(value)) return value.map((item) => canonicalize(item, referenceKind))
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([key, child]) => (
        [key, canonicalize(child, operationalReferenceKind(key))]
      )))
    }
    if (!referenceKind) return value
    const key = normalizedIdentifier(value)
    return key && maps[referenceKind]?.get(key) ? maps[referenceKind].get(key) : value
  }
  return canonicalize(source)
}

const SERVER_EXCLUDED_FIELDS = new Set([
  'password', 'passwordHash', 'password_hash', 'passwordSalt', 'password_salt', 'passwordIterations',
  'legacyPassword', 'token', 'tokenHash', 'adminAccounts', 'managerAccounts', 'managerPayroll',
  'profitShares', 'policies', 'orderCounters', 'importCounter', 'idempotencyKeys',
  'session', 'activeAttendanceId', 'checkedInAt', 'finishedShift', 'accountProfile',
])

const sharedStateSnapshot = (state) => {
  const snapshot = JSON.parse(JSON.stringify(state, (key, value) => (
    SERVER_EXCLUDED_FIELDS.has(key) ? undefined : value
  )))
  // Account settings are a per-user server projection. Keeping them out of the
  // generic Admin state synchronizer also guarantees that blob/data preview URLs
  // never reach state.replace.
  delete snapshot.settings
  return snapshot
}

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

export const mergeLegacyCredentialMigration = (current, migratedAccounts, remoteEnabled) => (
  remoteEnabled ? current : { ...current, ...migratedAccounts }
)

export const mergeEmployeeAuthUsers = (employees = [], users = []) => {
  const employeeRows = Array.isArray(employees) ? employees : []
  const userRows = Array.isArray(users) ? users : []
  const identifiersFor = (employee) => [
    employee?.id,
    employee?.code,
    employee?.employeeId,
    employee?.employeeCode,
  ].map((value) => String(value || '').trim()).filter(Boolean)
  const authUserFor = (employee) => {
    const identifiers = identifiersFor(employee)
    const exactMatches = userRows.filter((user) => identifiers.includes(String(user?.employeeId || '').trim()))
    if (exactMatches.length === 1) return exactMatches[0]
    if (exactMatches.length > 1) return null
    const foldedMatches = userRows.filter((user) => identifiers.some((identifier) => (
      sameIdentifier(identifier, user?.employeeId)
    )))
    if (foldedMatches.length !== 1) return null
    const foldedOwners = employeeRows.filter((candidate) => identifiersFor(candidate).some((candidateIdentifier) => (
      identifiers.some((identifier) => sameIdentifier(candidateIdentifier, identifier))
    )))
    return foldedOwners.length === 1 ? foldedMatches[0] : null
  }
  const statuses = { active: 'Đang làm việc', locked: 'Tạm ngưng', inactive: 'Đã nghỉ việc' }
  return employeeRows.map((employee) => {
    const user = authUserFor(employee)
    return user ? {
      ...employee,
      username: user.username || employee.username,
      authUserId: user.id,
      authVersion: user.version,
      lastLoginAt: user.lastLoginAt,
      status: statuses[user.status] || employee.status,
    } : employee
  })
}

const stripLocalProfileCredentials = (profiles = []) => profiles.map((profile) => Object.fromEntries(
  Object.entries(profile).filter(([key]) => !LOCAL_PROFILE_CREDENTIAL_KEYS.has(key)),
))

export const purgeLegacyLocalCredentials = (stored = {}) => ({
  ...stored,
  accountCredentialEpoch: ACCOUNT_CREDENTIAL_EPOCH,
  managerAccounts: [],
  employees: stripLocalProfileCredentials(Array.isArray(stored.employees) ? stored.employees : []),
  deletedEmployees: stripLocalProfileCredentials(Array.isArray(stored.deletedEmployees) ? stored.deletedEmployees : []),
})

export const isCurrentLocalCache = (stored) => (
  stored?.storageMode === 'local' && Number(stored?.cachePrivacyEpoch) >= LOCAL_CACHE_PRIVACY_EPOCH
)
const normalizeText = (value) => String(value ?? '').trim().toLowerCase()
const isOfficeUnit = (value) => ['office', 'văn phòng', 'van phong', 'khối văn phòng', 'khoi van phong', 'vp'].includes(normalizeText(value))
const isBusinessSupportUnit = (value) => ['business_support', 'business support', 'support', 'hỗ trợ kinh doanh', 'ho tro kinh doanh', 'htkd'].includes(normalizeText(value))
const isStoreManagerUnit = (value) => ['store_manager', 'store manager', 'quản lý cửa hàng', 'quan ly cua hang', 'qlch'].includes(normalizeText(value))
const normalizeAuthRole = (role) => normalizeText(role) === 'manager' ? 'business_support' : normalizeText(role)
export const remoteEffectiveUserChanged = (current = {}, latest = {}) => {
  if (!latest || typeof latest !== 'object' || !Object.keys(latest).length) return false
  const field = (record, camel, snake = camel) => String(record?.[camel] ?? record?.[snake] ?? '')
  return normalizeAuthRole(current?.role) !== normalizeAuthRole(latest?.role)
    || normalizedIdentifier(field(current, 'storeId', 'store_id')) !== normalizedIdentifier(field(latest, 'storeId', 'store_id'))
    || normalizedIdentifier(field(current, 'homeStoreId', 'home_store_id')) !== normalizedIdentifier(field(latest, 'homeStoreId', 'home_store_id'))
    || normalizedIdentifier(field(current, 'activeTransferId', 'active_transfer_id')) !== normalizedIdentifier(field(latest, 'activeTransferId', 'active_transfer_id'))
}
export const canManageSupportTransfers = (role) => ['admin', 'business_support'].includes(normalizeAuthRole(role))
export const canDeleteSupportTransfers = (role) => normalizeAuthRole(role) === 'admin'
export const nextSupportTransferBoundaryDelay = (transfers = [], at = Date.now()) => {
  const nowMs = at instanceof Date ? at.getTime() : Number(at)
  if (!Number.isFinite(nowMs)) return null
  const nextBoundary = transfers
    .filter((record) => !record?.deletedAt && !['Đã xóa', 'Đã hủy', 'Hoàn tất'].includes(String(record?.status || '')))
    .flatMap((record) => {
      const bounds = supportTransferBounds(record)
      return bounds ? [bounds.startMs, bounds.endMs] : []
    })
    .filter((epochMs) => epochMs > nowMs)
    .sort((left, right) => left - right)[0]
  return Number.isFinite(nextBoundary) ? Math.max(0, nextBoundary - nowMs) : null
}
export const canCreateEmployeeUnit = (role, unit) => {
  const normalizedRole = normalizeAuthRole(role)
  if (normalizedRole === 'admin') return true
  if (normalizedRole === 'business_support') return ['store_manager', 'office', 'store'].includes(unit)
  return normalizedRole === 'store_manager' && unit === 'store'
}
export const canManagePolicies = (role) => ['admin', 'business_support'].includes(normalizeAuthRole(role))
const isActiveAccount = (status) => !['tạm ngưng', 'tạm nghỉ', 'đã nghỉ việc', 'inactive', 'disabled'].includes(normalizeText(status))
const isSystemRole = (role) => ['admin', 'business_support', 'manager'].includes(normalizeText(role))
const isStoreWorkspaceRole = (role) => ['admin', 'business_support', 'manager', 'store_manager'].includes(normalizeText(role))
const STORE_EXPENSE_CATEGORIES = new Set(['Set up', 'Mặt bằng', 'Điện', 'Nước', 'Wifi', 'Marketing', 'Rác', 'Khác'])
const LEGACY_STORE_EXPENSE_CATEGORIES = {
  'Wi-Fi': 'Wifi',
  'Chi phí thiết lập cửa hàng': 'Set up',
  'Chi phí khác': 'Khác',
}
const normalizeStoreExpenseItems = (payload = {}, fallback = {}) => {
  const sourceItems = Array.isArray(payload.items) && payload.items.length
    ? payload.items
    : [{
      category: payload.type || fallback.type || 'Khác',
      name: payload.name || fallback.name || '',
      amount: payload.amount ?? fallback.amount,
      description: payload.description ?? payload.note ?? fallback.description ?? fallback.note ?? '',
    }]
  return sourceItems.map((item) => {
    const rawCategory = String(item?.category || item?.type || 'Khác').trim()
    const category = LEGACY_STORE_EXPENSE_CATEGORIES[rawCategory] || rawCategory
    return {
      category: STORE_EXPENSE_CATEGORIES.has(category) ? category : 'Khác',
      name: String(item?.name || '').trim(),
      amount: nonNegativeInteger(item?.amount),
      description: String(item?.description || '').trim(),
    }
  })
}
const validateStoreExpenseItems = (items = []) => {
  if (!items.length || items.some((item) => item.amount <= 0)) return 'Mỗi khoản chi phải có số tiền lớn hơn 0.'
  if (items.some((item) => item.category === 'Khác' && !item.description)) return 'Khoản chi Khác bắt buộc phải có mô tả.'
  if (items.some((item) => item.category === 'Khác' && !item.name)) return 'Khoản chi Khác bắt buộc phải có tên khoản chi.'
  return ''
}
const canListAccounts = (role) => ['admin', 'business_support', 'manager', 'store_manager'].includes(normalizeText(role))
const isValidEmployeePhone = (value) => /^0\d{9}$/.test(normalizePhone(value))
const ORDER_GENDERS = new Set(['Nam', 'Nữ', 'Khác'])
const ORDER_ACQUISITION_CHANNELS = new Set(['Facebook', 'Tiktok', 'Zalo', 'Bạn Bè', 'Người thân', 'Khác'])
const normalizeOrderInformationFields = (payload = {}) => ({
  label: String(payload.label || '').normalize('NFC').trim().replace(/\s+/gu, ' '),
  code: String(payload.code || '').trim().toUpperCase(),
})

const normalizeCredentialToken = (value = '') => String(value)
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[Đđ]/g, 'd')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '')

export const generateBusinessSupportStoreCredentials = (payload = {}, store = {}, accounts = []) => {
  const givenName = normalizeCredentialToken(payload.name).split('-').filter(Boolean).at(-1) || 'nhanvien'
  const storePrefix = normalizeCredentialToken(store.short || store.id || 'store') || 'store'
  const baseUsername = `${storePrefix}-${givenName}`
  const usernames = new Set(accounts.map((account) => normalizeText(account.username)).filter(Boolean))
  let username = baseUsername
  let suffix = 2
  while (usernames.has(normalizeText(username))) {
    username = `${baseUsername}-${suffix}`
    suffix += 1
  }
  const cccd = String(payload.cccd || payload.citizenId || '').replace(/\D/g, '')
  return { username, password: `${cccd.slice(-6)}${givenName}@` }
}

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

const normalizeIdentityImages = (payload = {}) => {
  const images = payload.identityImages
  if (images && typeof images === 'object' && !Array.isArray(images)) {
    return {
      ...(images.front ? { front: images.front } : {}),
      ...(images.back ? { back: images.back } : {}),
    }
  }
  const [front, back] = normalizeCccdImages(payload)
  return { ...(front ? { front } : {}), ...(back ? { back } : {}) }
}

const normalizeEmployee = (payload = {}, fallbackStoreId = storesSeed[0]?.id) => {
  const details = addressDetailsFrom(payload)
  const proposedUnit = payload.unit ?? payload.unitType ?? payload.department ?? payload.employeeGroup
  const requestedRole = normalizeAuthRole(payload.roleType || payload.accountRole || payload.authRole)
  const unit = isBusinessSupportUnit(proposedUnit) || requestedRole === 'business_support'
    ? 'business_support'
    : isStoreManagerUnit(proposedUnit) || requestedRole === 'store_manager'
      ? 'store_manager'
      : payload.isOffice || isOfficeUnit(proposedUnit) || isOfficeUnit(payload.storeId)
        ? 'office'
        : 'store'
  const officeLike = unit !== 'store'
  const position = String(payload.position ?? payload.workPosition ?? payload.role ?? 'Nhân viên bán hàng').trim()
  const fallbackPrefix = unit === 'office' ? 'VP' : unit === 'business_support' ? 'HTKD' : unit === 'store_manager' ? 'QL' : 'NV'
  const id = String(payload.id || payload.code || payload.employeeCode || uid(fallbackPrefix)).trim()
  const cccdImage = payload.cccdImage || payload.identityImage || ''
  const cccdImageName = payload.cccdImageName || payload.identityImageName || ''
  const phone = normalizePhone(payload.phone)
  const storeId = unit === 'office'
    ? 'OFFICE'
    : unit === 'business_support'
      ? 'BUSINESS_SUPPORT'
      : String(payload.storeId || fallbackStoreId || '').trim()
  const employmentType = getEmployeeType(payload)
  const rawSalary = Math.max(0, Number(payload.salary) || 0)
  const hasExplicitBasis = Boolean(payload.payBasis || payload.salaryBasis || payload.salaryType || payload.salaryUnit || payload.compensationVersion >= 2)
  let payBasis = getPayBasis({ ...payload, employmentType })
  if (employmentType === 'Part-Time' && !hasExplicitBasis && !Number(payload.hourlyRate) && rawSalary > 500000) {
    payBasis = 'legacy'
  }
  const monthlySalary = payBasis === 'monthly' ? getMonthlySalary({ ...payload, salary: rawSalary, payBasis }) : 0
  const hourlyRate = payBasis === 'hourly' ? getHourlyRate({ ...payload, salary: rawSalary, payBasis }) : 0
  const normalizedSalary = payBasis === 'monthly' ? monthlySalary : payBasis === 'hourly' ? hourlyRate : rawSalary
  const standardWorkDays = Math.max(1, Math.min(31, Number(payload.standardWorkDays) || 26))
  const requiredMonthlyHours = Math.max(0, Number(payload.requiredMonthlyHours) || 0)
  const baseSalary = Math.max(0, Number(payload.baseSalary) || monthlySalary || 0)
  const standardWorkDaysPeriod = String(payload.standardWorkDaysPeriod || '').trim()
  const monthlyWorkdayTargets = payload.monthlyWorkdayTargets && typeof payload.monthlyWorkdayTargets === 'object'
    ? { ...payload.monthlyWorkdayTargets }
    : {}
  if (officeLike && /^\d{4}-(?:0[1-9]|1[0-2])$/u.test(standardWorkDaysPeriod)) {
    monthlyWorkdayTargets[standardWorkDaysPeriod] = standardWorkDays
  }

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
    standardWorkDays,
    requiredMonthlyHours: requiredMonthlyHours || null,
    baseSalary: baseSalary || null,
    payFormula: String(payload.payFormula || '').trim() || null,
    standardWorkDaysPeriod,
    monthlyWorkdayTargets,
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
    identityImages: normalizeIdentityImages(payload),
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
    roleType: unit === 'business_support' ? 'business_support' : unit === 'store_manager' ? 'store_manager' : 'employee',
    accountRole: unit === 'business_support' ? 'business_support' : unit === 'store_manager' ? 'store_manager' : 'employee',
    startDate: String(payload.startDate || payload.employmentStartDate || '').slice(0, 10),
    workStart: payload.workStart || (officeLike ? '08:00' : '07:00'),
    workEnd: payload.workEnd || (officeLike ? '17:00' : '12:00'),
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

const normalizeManager = (payload = {}) => ({
  ...payload,
  id: payload.id || payload.code || 'MANAGER',
  code: payload.code || payload.id || 'MANAGER',
  username: String(payload.username || '').trim(),
  passwordHash: String(payload.passwordHash || ''),
  legacyPassword: payload.passwordHash ? '' : String(payload.password || ''),
  password: undefined,
  role: 'business_support',
  accountType: 'business_support',
  status: payload.status || 'Đang hoạt động',
})

const countStoreEmployees = (stores, employees) => stores.map((store) => ({
  ...store,
  employees: employees.filter((employee) => (
    employee.unit === 'store'
    && sameIdentifier(employee.storeId, store.id)
    && employee.status !== 'Đã nghỉ việc'
  )).length,
}))

const normalizeTask = (task = {}, fallbackStoreId = null) => ({
  ...task,
  id: task.id || uid('CV'),
  storeId: task.storeId || fallbackStoreId,
  shiftId: task.shiftId || task.shift || 'ca1',
  date: task.date || task.workDate || today(),
  title: String(task.title || '').trim(),
  detail: String(task.detail || '').trim(),
  employeeId: task.employeeId || null,
  employeeIds: [...new Set([
    ...(Array.isArray(task.employeeIds) ? task.employeeIds : []),
    ...(Array.isArray(task.assigneeIds) ? task.assigneeIds : []),
    ...(task.employeeId ? [task.employeeId] : []),
  ].map(String).filter(Boolean))],
  done: Boolean(task.done),
})

export const storeTasksForAttendance = ({
  tasks = [],
  attendance,
  attendanceRecords = [],
  employeeId,
  employees = [],
  stores = [],
  shiftDefinitions = [],
  taskAssignmentHistory = [],
}) => {
  if (!attendance) return []
  const storeId = String(attendance.storeId || '')
  const date = String(attendance.date || attendance.workDate || '').slice(0, 10)
  const shiftId = String(attendance.shiftId || attendance.shift || '')
  const storeRecords = stores.length ? stores : [{ id: storeId }]
  const storeMatch = resolveRecordIdentifier(storeRecords, storeId)
  const scopedStore = matchedRecordOrNull(storeMatch)
  if (!scopedStore) return []
  const employeeRecords = employees.length ? employees : [{ id: employeeId }]
  const employeeMatch = resolveEmployeeIdentifier(employeeRecords, employeeId)
  const scopedEmployee = matchedRecordOrNull(employeeMatch)
  if (!scopedEmployee) return []
  const storeShifts = shiftDefinitions.filter((record) => (
    operationalIdentifierReferenceMatchesRecord(storeRecords, scopedStore, record.storeId)
  ))
  const shiftRecords = storeShifts.length ? storeShifts : [{ id: shiftId }]
  const shiftMatch = resolveRecordIdentifier(shiftRecords, shiftId)
  const scopedShift = matchedRecordOrNull(shiftMatch)
  if (shiftId && !scopedShift) return []
  const activeAttendance = (Array.isArray(attendanceRecords) ? attendanceRecords : [])
    .filter((record) => !record.deletedAt)
  return (Array.isArray(tasks) ? tasks : []).filter((task) => {
    if (task.deletedAt || !operationalIdentifierReferenceMatchesRecord(storeRecords, scopedStore, task.storeId)) return false
    if (String(task.date || task.workDate || '').slice(0, 10) !== date) return false
    const checklistAttendanceId = String(task.checklistAttendanceId || '').trim()
    if (checklistAttendanceId && !operationalIdentifierReferenceMatchesRecord(
      activeAttendance.length ? activeAttendance : [attendance],
      attendance,
      checklistAttendanceId,
    )) return false
    const taskShiftId = String(task.shiftId || task.shift || '')
    if (taskShiftId && !operationalIdentifierReferenceMatchesRecord(shiftRecords, scopedShift, taskShiftId)) return false
    const assignmentId = String(task.assignmentId || task.taskAssignmentId || '').trim()
    if (assignmentId && taskAssignmentHistory.length) {
      const assignmentMatch = resolveRecordIdentifier(
        taskAssignmentHistory,
        assignmentId,
        (record) => [record?.id, record?.assignmentId],
      )
      if (!matchedRecordOrNull(assignmentMatch)) return false
    }
    const assignees = [
      task.employeeId,
      ...(Array.isArray(task.employeeIds) ? task.employeeIds : []),
      ...(Array.isArray(task.assigneeIds) ? task.assigneeIds : []),
      ...(Array.isArray(task.assignedEmployeeIds) ? task.assignedEmployeeIds : []),
    ].filter(Boolean)
    return !assignees.length || assignees.some((assigneeId) => (
      matchedRecordOrNull(resolveEmployeeIdentifier(employeeRecords, assigneeId)) === scopedEmployee
    ))
  })
}

export const createInitialState = () => {
  const employees = employeesSeed.map((employee) => normalizeEmployee(clone(employee)))
  const stores = countStoreEmployees(clone(storesSeed), employees)
  return {
    accountCredentialEpoch: ACCOUNT_CREDENTIAL_EPOCH,
    cachePrivacyEpoch: LOCAL_CACHE_PRIVACY_EPOCH,
    storageMode: 'local',
    stores,
    adminAccounts: adminAccountsSeed.map((account) => normalizeAdmin(clone(account))),
    managerAccounts: managerAccountsSeed.map((account) => normalizeManager(clone(account))),
    employees,
    imports: clone(importsSeed),
    attendance: clone(attendanceSeed),
    schedule: clone(scheduleSeed),
    tasks: clone(tasksSeed).map((task) => normalizeTask(task, storesSeed[0]?.id)),
    taskAssignmentHistory: [],
    supportWorkAssignments: [],
    officeAdjustments: clone(officeAdjustmentsSeed),
    activeStoreId: storesSeed[0]?.id || null,
    activeAttendanceId: null,
    session: null,
    checkedInAt: null,
    finishedShift: false,
    settings: {
      name: 'Admin',
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

export const hydrateState = (stored) => {
  const base = createInitialState()
  if (!stored || typeof stored !== 'object') return base
  const filteredStored = Object.fromEntries(Object.entries(stored).filter(([key]) => !['managerPayroll', 'profitShares'].includes(key)))
  const safeStored = Number(filteredStored.accountCredentialEpoch) >= ACCOUNT_CREDENTIAL_EPOCH
    ? filteredStored
    : purgeLegacyLocalCredentials(filteredStored)
  const employees = Array.isArray(safeStored.employees)
    ? safeStored.employees.map((employee) => normalizeEmployee(employee, safeStored.activeStoreId || base.activeStoreId))
    : base.employees
  const stores = Array.isArray(safeStored.stores) && (safeStored.stores.length || safeStored.systemResetCompletedAt)
    ? safeStored.stores
    : base.stores
  const hydrated = {
    ...base,
    ...safeStored,
    session: null,
    stores: countStoreEmployees(stores, employees),
    employees,
    adminAccounts: Array.isArray(safeStored.adminAccounts) ? safeStored.adminAccounts.map(normalizeAdmin) : base.adminAccounts,
    managerAccounts: Array.isArray(safeStored.managerAccounts) ? safeStored.managerAccounts.map(normalizeManager) : base.managerAccounts,
    officeAdjustments: Array.isArray(safeStored.officeAdjustments) ? safeStored.officeAdjustments : base.officeAdjustments,
    tasks: Array.isArray(safeStored.tasks)
      ? safeStored.tasks.map((task) => normalizeTask(task, safeStored.activeStoreId || base.activeStoreId))
      : base.tasks,
    activeStoreId: stores.some((store) => store.id === safeStored.activeStoreId) ? safeStored.activeStoreId : stores[0]?.id || null,
  }
  return migrateDomainState(hydrated, { stores: hydrated.stores, imports: hydrated.imports })
}

export const createLocalSystemResetState = (current = {}) => {
  const clearedState = createInitialState()
  REMOTE_ARRAY_KEYS.forEach((key) => { clearedState[key] = [] })
  clearedState.policyHistory = []
  clearedState.idempotencyKeys = []
  clearedState.orderCounters = {}
  clearedState.importCounter = 0
  clearedState.systemResetCompletedAt = new Date().toISOString()
  const retainedAdmin = (Array.isArray(current.adminAccounts) ? current.adminAccounts : [])
    .find((account) => normalizeAuthRole(account.role) === 'admin' && (
      accountKey(account) === accountKey(current.session)
      || (account.username && normalizeText(account.username) === normalizeText(current.session?.username))
    ))
  clearedState.adminAccounts = retainedAdmin ? [normalizeAdmin(retainedAdmin)] : clearedState.adminAccounts.slice(0, 1)
  clearedState.managerAccounts = []
  clearedState.settings = current.settings && typeof current.settings === 'object' ? { ...current.settings } : clearedState.settings
  clearedState.session = current.session?.role === 'admin' ? current.session : null
  clearedState.activeStoreId = null
  clearedState.activeAttendanceId = null
  clearedState.checkedInAt = null
  clearedState.finishedShift = false
  return clearedState
}

export const resolveRemoteActiveStoreId = ({ stores = [], session, remoteActiveStoreId, preferredActiveStoreId }) => {
  const canonicalStoreId = (id) => matchedRecordOrNull(resolveRecordIdentifier(stores, id))?.id || null
  if (session?.role === 'store_manager' || (session?.role === 'employee' && session?.unit !== 'office')) {
    return canonicalStoreId(session.storeId)
  }
  const preferredStoreId = canonicalStoreId(preferredActiveStoreId)
  if (['admin', 'business_support'].includes(normalizeAuthRole(session?.role)) && preferredStoreId) {
    return preferredStoreId
  }
  const activeStoreId = canonicalStoreId(remoteActiveStoreId)
  if (activeStoreId) return activeStoreId
  return stores[0]?.id || null
}

const hydrateRemoteAccountSettings = (settings = {}) => {
  const source = settings && typeof settings === 'object' ? settings : {}
  const avatarMetadata = accountAvatarMetadata(source.avatar)
  const compatibleAvatar = typeof source.avatar === 'string'
    && !source.avatar.startsWith('data:image/')
    ? source.avatar
    : ''
  return {
    ...source,
    avatar: compatibleAvatar,
    avatarMetadata,
    avatarLoading: Boolean(avatarMetadata),
    avatarError: '',
  }
}

const hydrateRemoteState = (remoteState, remoteUser, policyRecords = [], preferredActiveStoreId = null) => {
  const emptyCollections = Object.fromEntries(REMOTE_ARRAY_KEYS.map((key) => [key, []]))
  const mappedPolicies = apiPolicyMap(policyRecords)
  // Keep the server snapshot byte-for-byte authoritative. Operational lookups
  // below are case-insensitive, but rewriting the hydrated collections would
  // later make Admin state.replace mutate protected finance/audit history.
  const safeRemote = {
    ...emptyCollections,
    ...(remoteState && typeof remoteState === 'object' ? remoteState : {}),
  }
  const remoteRole = normalizeAuthRole(remoteUser?.role)
  const requestedEmployeeId = remoteUser?.employeeId || remoteUser?.employee_id
  const remoteEmployeeMatch = resolveEmployeeIdentifier(safeRemote.employees, requestedEmployeeId)
  if (remoteEmployeeMatch.ambiguous) {
    throw Object.assign(new Error('Không thể xác định hồ sơ nhân viên vì có mã trùng nhau khi không phân biệt chữ hoa/thường.'), {
      code: 'EMPLOYEE_IDENTIFIER_COLLISION',
    })
  }
  const remoteEmployee = remoteEmployeeMatch.ambiguous ? null : remoteEmployeeMatch.record
  // Client-side preflights use the canonical profile identifier. Historical
  // rows retain their original spelling and are resolved case-insensitively by
  // their readers, so authentication aliases cannot block valid mutations.
  const employeeId = remoteEmployee?.id || remoteEmployee?.code || remoteEmployee?.employeeId || requestedEmployeeId
  const requestedStoreId = remoteUser?.storeId || remoteUser?.store_id || remoteEmployee?.storeId
  const requestedStoreMatch = resolveRecordIdentifier(safeRemote.stores, requestedStoreId)
  if (requestedStoreMatch.ambiguous) {
    throw Object.assign(new Error('Không thể xác định cửa hàng của phiên vì có mã trùng nhau khi không phân biệt chữ hoa/thường.'), {
      code: 'STORE_IDENTIFIER_COLLISION',
    })
  }
  const canonicalStoreId = requestedStoreMatch.record?.id
  const requestedActiveTransferId = remoteUser?.activeTransferId || remoteUser?.active_transfer_id
  const activeTransferMatch = resolveRecordIdentifier(safeRemote.supportTransfers, requestedActiveTransferId)
  if (activeTransferMatch.ambiguous) {
    throw Object.assign(new Error('Không thể xác định phiếu điều chuyển đang hiệu lực vì có mã trùng nhau khi không phân biệt chữ hoa/thường.'), {
      code: 'SUPPORT_TRANSFER_IDENTIFIER_COLLISION',
    })
  }
  const canonicalActiveTransferId = activeTransferMatch.record?.id
  const requestedHomeStoreId = remoteUser?.homeStoreId || remoteUser?.home_store_id || remoteEmployee?.storeId
  const homeStoreMatch = resolveRecordIdentifier(safeRemote.stores, requestedHomeStoreId)
  if (homeStoreMatch.ambiguous) {
    throw Object.assign(new Error('Không thể xác định cửa hàng chính của nhân viên vì có mã trùng nhau khi không phân biệt chữ hoa/thường.'), {
      code: 'STORE_IDENTIFIER_COLLISION',
    })
  }
  const isAdminAccount = remoteRole === 'admin'
  const session = isAdminAccount
    ? { id: remoteUser.id, code: 'ADMIN', name: remoteUser.displayName || remoteUser.username, username: remoteUser.username, role: 'admin', accountType: 'admin', authVersion: remoteUser.version, availableRoles: remoteUser.availableRoles || [], needsRoleSelection: Boolean(remoteUser.needsRoleSelection) }
    : {
        id: employeeId || remoteUser?.id,
        code: employeeId || remoteUser?.id,
        name: remoteEmployee?.name || remoteUser?.displayName || remoteUser?.username,
        username: remoteUser?.username,
        role: ['business_support', 'store_manager'].includes(remoteRole) ? remoteRole : 'employee',
        accountType: ['business_support', 'store_manager'].includes(remoteRole) ? remoteRole : 'employee',
        employeeId: employeeId || remoteEmployee?.id || remoteEmployee?.code || (remoteRole === 'business_support' ? null : remoteUser?.id),
        storeId: canonicalStoreId || requestedStoreId || (remoteRole === 'business_support' ? 'BUSINESS_SUPPORT' : undefined),
        homeStoreId: homeStoreMatch.record?.id || requestedHomeStoreId || undefined,
        activeTransferId: canonicalActiveTransferId || requestedActiveTransferId || undefined,
        unit: remoteEmployee?.unit || (remoteRole === 'business_support' ? 'business_support' : remoteRole === 'store_manager' ? 'store_manager' : 'store'),
        unitType: remoteEmployee?.unit || (remoteRole === 'business_support' ? 'business_support' : remoteRole === 'store_manager' ? 'store_manager' : 'store'),
        authUserId: remoteUser?.id,
        authVersion: remoteUser?.version,
        availableRoles: Array.isArray(remoteUser?.availableRoles) ? remoteUser.availableRoles : [],
        needsRoleSelection: Boolean(remoteUser?.needsRoleSelection),
      }
  const employees = safeRemote.employees.map((employee) => normalizeEmployee(employee, safeRemote.activeStoreId || session.storeId || ''))
  const stores = countStoreEmployees(safeRemote.stores, employees)
  const remoteActiveStoreMatch = resolveRecordIdentifier(stores, safeRemote.activeStoreId)
  const normalized = {
    ...safeRemote,
    adminAccounts: [],
    managerAccounts: [],
    employees,
    stores,
    session: null,
    settings: hydrateRemoteAccountSettings(safeRemote.settings),
    tasks: safeRemote.tasks.map((task) => normalizeTask(task, safeRemote.activeStoreId || session.storeId || stores[0]?.id)),
    activeStoreId: remoteActiveStoreMatch.ambiguous
      ? null
      : remoteActiveStoreMatch.record?.id || stores[0]?.id || null,
    policies: {
      ...defaultPolicies,
      ...mappedPolicies,
      attendanceEvaluation: { ...defaultPolicies.attendanceEvaluation, ...(mappedPolicies.attendanceEvaluation || {}) },
    },
  }
  const hydrated = migrateDomainState(normalized, { stores, imports: normalized.imports })
  return {
    ...hydrated,
    session,
    activeStoreId: resolveRemoteActiveStoreId({
      stores: hydrated.stores,
      session,
      remoteActiveStoreId: hydrated.activeStoreId,
      preferredActiveStoreId,
    }),
  }
}

const readState = () => {
  try {
    if (typeof localStorage === 'undefined') return createInitialState()
    const serialized = localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_STORAGE_KEY)
    if (!serialized) return createInitialState()
    const parsed = JSON.parse(serialized)
    if (!isCurrentLocalCache(parsed)) {
      localStorage.removeItem(STORAGE_KEY)
      localStorage.removeItem(LEGACY_STORAGE_KEY)
      return createInitialState()
    }
    return hydrateState(parsed)
  } catch {
    return createInitialState()
  }
}

const getOrCreateSystemResetIdempotencyKey = (inMemoryKey) => {
  if (inMemoryKey) return inMemoryKey
  let persistedKey = ''
  try {
    if (typeof sessionStorage !== 'undefined') persistedKey = String(sessionStorage.getItem(SYSTEM_RESET_IDEMPOTENCY_STORAGE_KEY) || '')
  } catch {
    persistedKey = ''
  }
  const key = persistedKey || `system.reset_all:${crypto.randomUUID()}`
  try {
    if (typeof sessionStorage !== 'undefined') sessionStorage.setItem(SYSTEM_RESET_IDEMPOTENCY_STORAGE_KEY, key)
  } catch {
    // The in-memory ref still preserves the key when browser storage is unavailable.
  }
  return key
}

const clearSystemResetIdempotencyKey = (completedKey) => {
  try {
    if (typeof sessionStorage === 'undefined') return
    if (sessionStorage.getItem(SYSTEM_RESET_IDEMPOTENCY_STORAGE_KEY) === completedKey) {
      sessionStorage.removeItem(SYSTEM_RESET_IDEMPOTENCY_STORAGE_KEY)
    }
  } catch {
    // A completed reset remains successful even when browser storage is unavailable.
  }
}

const activeStoreStorageKey = (account = {}) => {
  const accountId = String(account.id || account.user_id || account.username || '').trim()
  return accountId ? `${ACTIVE_STORE_STORAGE_PREFIX}${accountId}` : ''
}

const readRememberedActiveStore = (account) => {
  try {
    const key = activeStoreStorageKey(account)
    return key && typeof sessionStorage !== 'undefined' ? String(sessionStorage.getItem(key) || '') : ''
  } catch {
    return ''
  }
}

const rememberActiveStore = (account, storeId) => {
  try {
    const key = activeStoreStorageKey(account)
    if (key && storeId && typeof sessionStorage !== 'undefined') sessionStorage.setItem(key, String(storeId))
  } catch {
    // The active route still remains in the URL when session storage is unavailable.
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
  if (source === 'manager') return { ...common, role: 'business_support', accountType: 'business_support', employeeId: account.employeeId || null, unit: 'business_support', unitType: 'business_support' }
  const accountRole = normalizeAuthRole(account.roleType || account.accountRole || account.authRole)
  const sessionRole = ['business_support', 'store_manager'].includes(accountRole) ? accountRole : 'employee'
  return {
    ...common,
    role: sessionRole,
    accountType: sessionRole,
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

const localRoleOptionsForSession = (current, session) => {
  if (!session) return []
  if (session.role === 'admin') return [{ role: 'admin', label: 'Admin', employeeId: session.employeeId || null, storeId: null }]
  const employees = Array.isArray(current.employees) ? current.employees : []
  const rootEmployeeId = String(session.employeeId || session.code || '')
  const options = []
  const add = (option) => {
    const key = `${option.role}:${option.storeId || ''}:${option.employeeId || ''}`
    if (!options.some((item) => `${item.role}:${item.storeId || ''}:${item.employeeId || ''}` === key)) options.push(option)
  }
  const root = employees.find((profile) => String(profile.id || profile.code || '') === rootEmployeeId)
  if (normalizeAuthRole(session.role) === 'business_support') {
    add({ role: 'business_support', label: 'Hỗ trợ KD', employeeId: rootEmployeeId, storeId: 'BUSINESS_SUPPORT' })
  } else if (normalizeAuthRole(session.role) === 'store_manager') {
    add({ role: 'store_manager', label: 'Quản lý CH', employeeId: rootEmployeeId, storeId: root?.storeId || session.storeId || null })
  } else {
    const rootUnit = String(root?.unit || root?.unitType || '').toLowerCase()
    add({ role: 'employee', label: rootUnit === 'office' ? 'Nhân viên văn phòng' : 'Nhân viên', employeeId: rootEmployeeId, storeId: root?.storeId || session.storeId || null })
  }
  employees.filter((profile) => !profile.deletedAt && String(profile.linkedEmployeeId || '') === rootEmployeeId).forEach((profile) => {
    const unit = String(profile.unit || profile.unitType || '').toLowerCase()
    if (unit === 'store_manager') add({ role: 'store_manager', label: 'Quản lý CH', employeeId: profile.id || profile.code, storeId: profile.storeId || null })
    if (unit === 'store') add({ role: 'employee', label: 'Nhân viên cửa hàng', employeeId: profile.id || profile.code, storeId: profile.storeId || null })
  })
  const order = { store_manager: 0, employee: 1, business_support: 2 }
  return options.sort((left, right) => (order[left.role] ?? 9) - (order[right.role] ?? 9))
}

const localDateTime = (date) => {
  const pad = (value) => String(value).padStart(2, '0')
  const offset = -date.getTimezoneOffset()
  const sign = offset >= 0 ? '+' : '-'
  const absoluteOffset = Math.abs(offset)
  return `${today(date)}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}${sign}${pad(Math.floor(absoluteOffset / 60))}:${pad(absoluteOffset % 60)}`
}

const timeLabel = (date) => date.toLocaleTimeString('vi-VN', { hour12: false })

const vietnamAttendanceDateTimeFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Ho_Chi_Minh',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
})

const vietnamAttendanceDateTimeParts = (date) => Object.fromEntries(
  vietnamAttendanceDateTimeFormatter.formatToParts(date).map(({ type, value }) => [type, value]),
)

const vietnamAttendanceTimeLabel = (date) => {
  const parts = vietnamAttendanceDateTimeParts(date)
  return `${parts.hour}:${parts.minute}:${parts.second}`
}

const vietnamAttendanceDateTime = (date) => {
  const parts = vietnamAttendanceDateTimeParts(date)
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}+07:00`
}

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

const attendanceRecordWorkDate = (record = {}) => businessDate(
  record.date || record.workDate || record.attendanceDate || record.checkInAt || record.createdAt,
)

const attendanceClaimKey = (employeeId, workDate) => `${String(employeeId || '')}:${String(workDate || '')}`

const localStoreSalaryConfigFor = (state, employee, store, period) => {
  if (!employee || !store) return null
  return resolveStoreEmployeeSalaryPolicy(employee, {
    store,
    salaryConfigs: state.storeEmployeeSalaryConfigs || [],
    period,
  })
}

export const calculateLocalStoreEmployeeBasePay = ({
  state = {},
  employee = {},
  store = null,
  period = monthKey(),
  hours = 0,
} = {}) => {
  const salaryConfig = localStoreSalaryConfigFor(state, employee, store, period)
  return {
    baseSalary: calculateEmployeeBasePay(employee, {
      hours,
      salaryConfig,
      store,
      period,
    }),
    salaryConfig,
  }
}

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

export const localHomePayrollAttendance = ({
  attendance = [],
  employee = {},
  employees = [],
  stores = [],
  period = monthKey(),
} = {}) => {
  const employeeCatalog = employees.length ? employees : [employee]
  const targetEmployee = employeeCatalog.includes(employee)
    ? employee
    : matchedRecordOrNull(resolveEmployeeIdentifier(employeeCatalog, employee.id || employee.code || employee.employeeId))
  const storeCatalog = stores.length ? stores : [{ id: employee.storeId }]
  const targetStore = matchedRecordOrNull(resolveRecordIdentifier(storeCatalog, employee.storeId))
  if (!targetEmployee || !targetStore) return []
  return attendance.filter((record) => (
    !record.deletedAt
    && matchedRecordOrNull(resolveEmployeeIdentifier(employeeCatalog, record.employeeId)) === targetEmployee
    && matchedRecordOrNull(resolveRecordIdentifier(storeCatalog, record.storeId)) === targetStore
    && !record.supportTransferId
    && !record.supportCompensation?.transferId
    && !record.compensation?.support?.transferId
    && isInMonth(record, period)
  ))
}

const employeeGrossFor = (state, employeeId, period = monthKey()) => {
  const employee = matchedRecordOrNull(resolveEmployeeIdentifier(state.employees || [], employeeId))
  if (!employee) return 0
  const employeeStore = matchedRecordOrNull(resolveRecordIdentifier(state.stores || [], employee.storeId))
  if (!employeeStore) return 0
  const attendance = localHomePayrollAttendance({
    attendance: state.attendance,
    employee,
    employees: state.employees,
    stores: state.stores,
    period,
  })
  const hours = attendance.reduce((sum, item) => sum + Math.max(0, Number(item.hours) || 0), 0)
  const { baseSalary: base } = calculateLocalStoreEmployeeBasePay({
    state,
    employee,
    store: employeeStore,
    period,
    hours,
  })
  const adjustments = state.salaryAdjustments
    .filter((item) => (
      matchedRecordOrNull(resolveEmployeeIdentifier(state.employees, item.employeeId)) === employee
      && (!item.storeId || matchedRecordOrNull(resolveRecordIdentifier(state.stores, item.storeId)) === employeeStore)
      && isInMonth(item, period)
      && item.status !== 'Đã hủy'
    ))
  const adjustmentAmount = (matches) => adjustments
    .filter((item) => matches(normalizeText(item.bonusSource || item.type)))
    .reduce((sum, item) => sum + nonNegativeInteger(item.amount), 0)
  const revenueBonus = adjustmentAmount((type) => type === 'revenue' || type.includes('thưởng doanh thu'))
  const workBonus = adjustmentAmount((type) => type === 'work' || type.includes('thưởng công việc'))
  const manualBonus = adjustmentAmount((type) => type === 'manual' || type.includes('thưởng khác') || type.includes('thưởng thủ công'))
  const otherAllowance = adjustmentAmount((type) => type === 'allowance' || type.includes('phụ cấp'))
  const violations = adjustmentAmount((type) => type === 'violation' || type.includes('khấu trừ') || type.includes('vi phạm'))
  const tiktokAllowance = nonNegativeInteger(employee.tiktokAllowance)
  return calculateAvailableSalary({
    basePay: base,
    revenueBonus,
    workBonus,
    manualBonus,
    tiktokAllowance,
    otherAllowance,
    confirmedViolations: violations,
  }).availableSalary
}

const advancePaidFor = (state, employeeId, period = monthKey()) => {
  const employee = matchedRecordOrNull(resolveEmployeeIdentifier(state.employees || [], employeeId))
  const employeeStore = employee
    ? matchedRecordOrNull(resolveRecordIdentifier(state.stores || [], employee.storeId))
    : null
  if (!employee || !employeeStore) return 0
  return state.salaryAdvances
    .filter((item) => (
      matchedRecordOrNull(resolveEmployeeIdentifier(state.employees, item.employeeId)) === employee
      && (!item.storeId || matchedRecordOrNull(resolveRecordIdentifier(state.stores, item.storeId)) === employeeStore)
      && item.period === period
      && item.status === 'Đã chi'
    ))
    .reduce((sum, item) => sum + nonNegativeInteger(item.amount), 0)
}

const resolutionTouches = (resolution, targets) => (
  targets.has(resolution?.record) || (resolution?.ambiguous && resolution.matches.some((record) => targets.has(record)))
)

export const hasLocalPayrollReferenceCollision = ({ state = {}, employees = [], store = null, period = monthKey() } = {}) => {
  if (!store || !employees.length) return false
  const employeeTargets = new Set(employees)
  const storeTargets = new Set([store])
  const collides = (record, { storeOptional = false } = {}) => {
    const employeeMatch = resolveEmployeeIdentifier(state.employees || [], record.employeeId)
    const storeReference = String(record.storeId || '').trim()
    const storeMatch = storeReference ? resolveRecordIdentifier(state.stores || [], storeReference) : null
    const touchesEmployee = resolutionTouches(employeeMatch, employeeTargets)
    const touchesStore = storeReference
      ? resolutionTouches(storeMatch, storeTargets)
      : storeOptional && touchesEmployee
    return touchesEmployee && touchesStore && (employeeMatch.ambiguous || storeMatch?.ambiguous)
  }
  const attendanceCollision = (state.attendance || []).some((record) => (
    !record.deletedAt
    && !record.supportTransferId
    && !record.supportCompensation?.transferId
    && !record.compensation?.support?.transferId
    && isInMonth(record, period)
    && collides(record)
  ))
  if (attendanceCollision) return true
  const adjustmentCollision = (state.salaryAdjustments || []).some((record) => (
    record.status !== 'Đã hủy' && isInMonth(record, period) && collides(record, { storeOptional: true })
  ))
  if (adjustmentCollision) return true
  return (state.salaryAdvances || []).some((record) => (
    record.period === period && record.status === 'Đã chi' && collides(record, { storeOptional: true })
  ))
}

export const localAvailableSalaryForEmployee = (state, employeeId, period = monthKey()) => Math.max(
  0,
  employeeGrossFor(state, employeeId, period) - advancePaidFor(state, employeeId, period),
)

export const buildLocalPayrollFinanceSnapshot = ({ state, storeId, period, netPayrollExpense = 0 }) => {
  const settlementSources = new Set(['payroll-accrual', 'payroll-payment', 'salary-advance'])
  const withoutPayrollSettlements = {
    ...state,
    expenseEntries: (state.expenseEntries || []).filter((entry) => !(
      String(entry.storeId || '') === String(storeId || '')
      && isInMonth(entry, period)
      && settlementSources.has(String(entry.sourceType || ''))
    )),
  }
  const periodStart = `${period}-01`
  const periodEnd = `${period}-${String(new Date(Number(period.slice(0, 4)), Number(period.slice(5, 7)), 0).getDate()).padStart(2, '0')}`
  const recognized = financeSummaryFromState(withoutPayrollSettlements, {
    storeId,
    from: periodStart,
    to: periodEnd,
  })
  const payrollExpense = nonNegativeInteger(netPayrollExpense)
  const expense = recognized.expense + payrollExpense
  return {
    ...recognized,
    expense,
    profit: recognized.revenue - expense,
    recognizedExpense: recognized.expense,
    nonPayrollExpense: recognized.expense,
    earnedPayrollExpense: payrollExpense,
    netPayrollExpense: payrollExpense,
  }
}

const voucherDate = (value = new Date()) => {
  const date = resolveDate(value)
  return `${String(date.getDate()).padStart(2, '0')}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getFullYear()).slice(-2)}`
}

const storeCode = (store = {}) => String(store.short || store.code || store.id || 'CH')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^A-Za-z0-9]/g, '')
  .toUpperCase()
  .slice(0, 12) || 'CH'

const employeePrefixForStore = (store = {}) => {
  const normalize = (value) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/gu, '').toUpperCase()
  const identity = [store.id, store.short, store.name, store.employeePrefix].map(normalize).join(' ')
  if (identity.includes('SM234') || identity.includes('SECOND MALL')) return 'SM234'
  const branches = [
    ['TO NGOC VAN', 'TNV'], ['DI AN', 'DIAN'], ['KHA VAN CAN', 'KVC'], ['TAY HOA', 'TH'],
    ['NGUYEN VAN THUONG', 'NVT'], ['NO TRANG LONG', 'NTL'], ['LE VAN THO', 'LVT'],
    ['BUON MA THUOT', 'BMT'], ['BUON MA THUOC', 'BMT'], ['CAN THO', 'CT'],
  ]
  const branch = branches.find(([label]) => identity.includes(label))?.[1]
    || normalize(store.employeePrefix || storeCode(store)).replace(/[^A-Z0-9]/gu, '').slice(0, 12)
  const brand = identity.includes('DOSII')
    ? 'DOSII'
    : identity.includes('DOSSI')
      ? 'DOSSI'
      : /(^|\s)SM(\s|$)/u.test(identity)
        ? 'SM'
        : ''
  return brand && branch && !branch.startsWith(`${brand}-`) ? `${brand}-${branch}` : branch
}

const nextEmployeeCode = (payload, state) => {
  const requestedRole = normalizeAuthRole(payload.roleType || payload.accountRole || payload.authRole)
  const businessSupport = isBusinessSupportUnit(payload.unit) || requestedRole === 'business_support'
  const storeManager = isStoreManagerUnit(payload.unit) || requestedRole === 'store_manager'
  const officeEmployee = payload.isOffice || isOfficeUnit(payload.unit) || isOfficeUnit(payload.storeId)
  const store = state.stores.find((item) => String(item.id) === String(payload.storeId || state.activeStoreId))
  const prefix = businessSupport
    ? 'HTKD'
    : storeManager
      ? 'QLCH'
      : officeEmployee
        ? 'VP'
        : employeePrefixForStore(store)
  const separator = officeEmployee ? '' : '-'
  const pattern = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}${separator}(\\d+)$`, 'i')
  const knownEmployees = [...(state.employees || []), ...(state.deletedEmployees || [])]
  const highest = knownEmployees.reduce((current, employee) => {
    const match = String(employee.id || employee.code || employee.employeeCode || '').match(pattern)
    return match ? Math.max(current, Number(match[1]) || 0) : current
  }, 0)
  return `${prefix}${separator}${String(highest + 1).padStart(3, '0')}`
}

export function AppProvider({ children }) {
  const [state, setState] = useState(readState)
  const [toast, setToast] = useState(null)
  const [credentialsReady, setCredentialsReady] = useState(false)
  const [sessionRestoreReady, setSessionRestoreReady] = useState(() => !hasApiSession())
  const [apiStatus, setApiStatus] = useState('local')
  const [attendanceCheckoutRequests, setAttendanceCheckoutRequests] = useState({})
  const apiRef = useRef({
    enabled: false,
    role: null,
    user: null,
    version: 0,
    hydratedVersion: 0,
    policyVersions: {},
    suppressNext: false,
    syncing: false,
    pending: null,
    timer: null,
    lastSerialized: '',
    systemResetIdempotencyKey: null,
  })
  const localAttendanceCheckInClaimsRef = useRef(new Set())
  const avatarObjectUrlRef = useRef({ signature: '', url: '' })
  const avatarLoadRequestRef = useRef(0)
  const activeStoreIdRef = useRef(state.activeStoreId)
  const policiesRef = useRef(state.policies)
  policiesRef.current = state.policies

  useEffect(() => {
    localAttendanceCheckInClaimsRef.current = new Set(
      (Array.isArray(state.attendance) ? state.attendance : [])
        .filter((record) => !record.deletedAt && attendanceRecordWorkDate(record))
        .map((record) => attendanceClaimKey(record.employeeId, attendanceRecordWorkDate(record))),
    )
  }, [state.attendance])

  const activateRemotePayload = useCallback((payload, loginUser, preferredActiveStoreId = null) => {
    const remoteUser = payload.user || loginUser
    const rememberedActiveStoreId = preferredActiveStoreId || readRememberedActiveStore(remoteUser)
    const hydrated = hydrateRemoteState(payload.state, remoteUser, payload.policies, rememberedActiveStoreId)
    if (!Array.isArray(payload.policies)) hydrated.policies = policiesRef.current
    const hydratedAvatarSignature = accountAvatarMetadataSignature(hydrated.settings?.avatarMetadata)
    if (hydratedAvatarSignature && avatarObjectUrlRef.current.signature === hydratedAvatarSignature) {
      hydrated.settings = {
        ...hydrated.settings,
        avatar: avatarObjectUrlRef.current.url,
        avatarLoading: false,
        avatarError: '',
      }
    }
    const remote = apiRef.current
    remote.enabled = true
    remote.role = normalizeAuthRole(remoteUser.role)
    remote.user = { ...remoteUser, role: normalizeAuthRole(remoteUser.role) }
    remote.version = Number(payload.version || 0)
    remote.hydratedVersion = Number(payload.version || 0)
    if (Array.isArray(payload.policies)) {
      remote.policyVersions = Object.fromEntries(payload.policies.map((policy) => [policy.key, Number(policy.version || 0)]))
    }
    remote.suppressNext = true
    remote.lastSerialized = JSON.stringify(sharedStateSnapshot(hydrated))
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(STORAGE_KEY)
      localStorage.removeItem(LEGACY_STORAGE_KEY)
    }
    setApiStatus('connected')
    rememberActiveStore(remoteUser, hydrated.activeStoreId)
    activeStoreIdRef.current = hydrated.activeStoreId
    setState(hydrated)
    return hydrated.session
  }, [])

  const runRemoteDomainCommand = async (type, payload, idempotencyKey = `${type}:${crypto.randomUUID()}`) => {
    const remote = apiRef.current
    try {
      const result = await apiCommand(type, payload, {
        expectedVersion: remote.version,
        idempotencyKey,
      })
      remote.version = Number(result.version)
      if (remote.role === 'admin') {
        // Admin still has a small number of legacy local mutations that are
        // persisted through a whole-state replace. Applying a domain-command
        // refresh in the background could race with that snapshot and lose one
        // of the two writes, so keep the ordered reconciliation for Admin.
        const latest = await apiGetState('global')
        activateRemotePayload(latest, latest.user || remote.user, activeStoreIdRef.current)
        return result
      }
      // The mutation is already durable when POST resolves. Do not keep the
      // Save/Create button blocked behind another full shared-state download.
      // Reconcile in the background; discard a response if a newer mutation
      // completed while it was in flight.
      const committedVersion = Number(result.version || 0)
      void apiGetState('global').then((latest) => {
        if (Number(latest?.version || 0) < Number(remote.version || committedVersion)) return
        activateRemotePayload(latest, latest.user || remote.user, activeStoreIdRef.current)
      }).catch(() => {
        setApiStatus('error')
      })
      return result
    } catch (error) {
      if (error.code === 'VERSION_CONFLICT') {
        try {
          const latest = await apiGetState('global')
          activateRemotePayload(latest, remote.user, activeStoreIdRef.current)
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

  const remoteAvatarSignature = accountAvatarMetadataSignature(state.settings?.avatarMetadata)
  const remoteAvatarSessionKey = state.session ? `${state.session.id || ''}:${state.session.role || ''}` : ''

  useEffect(() => {
    const revokeObjectUrl = (url) => {
      if (url && typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(url)
    }
    const currentObjectUrl = avatarObjectUrlRef.current
    if (!apiRef.current.enabled || !remoteAvatarSessionKey || !remoteAvatarSignature) {
      avatarLoadRequestRef.current += 1
      revokeObjectUrl(currentObjectUrl.url)
      avatarObjectUrlRef.current = { signature: '', url: '' }
      return undefined
    }
    if (currentObjectUrl.signature === remoteAvatarSignature && currentObjectUrl.url) return undefined

    revokeObjectUrl(currentObjectUrl.url)
    avatarObjectUrlRef.current = { signature: '', url: '' }
    const requestId = avatarLoadRequestRef.current + 1
    avatarLoadRequestRef.current = requestId
    let active = true
    setState((current) => accountAvatarMetadataSignature(current.settings?.avatarMetadata) === remoteAvatarSignature
      ? {
          ...current,
          // Keep the last confirmed image (or the just-submitted preview) visible
          // while the private object is downloaded. Clearing it here caused the
          // header to fall back to initials after a successful save.
          settings: { ...current.settings, avatarLoading: true, avatarError: '' },
        }
      : current)
    apiGetAccountAvatar().then((blob) => {
      if (!active || avatarLoadRequestRef.current !== requestId) return
      if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
        throw new Error('Trình duyệt không hỗ trợ hiển thị ảnh đại diện riêng tư.')
      }
      const objectUrl = URL.createObjectURL(blob)
      avatarObjectUrlRef.current = { signature: remoteAvatarSignature, url: objectUrl }
      setState((current) => accountAvatarMetadataSignature(current.settings?.avatarMetadata) === remoteAvatarSignature
        ? {
            ...current,
            settings: { ...current.settings, avatar: objectUrl, avatarLoading: false, avatarError: '' },
          }
        : current)
    }).catch((error) => {
      if (!active || avatarLoadRequestRef.current !== requestId) return
      setState((current) => accountAvatarMetadataSignature(current.settings?.avatarMetadata) === remoteAvatarSignature
        ? {
            ...current,
            settings: {
              ...current.settings,
              avatarLoading: false,
              avatarError: error?.message || 'Không thể tải ảnh đại diện.',
            },
          }
        : current)
    })
    return () => { active = false }
  }, [remoteAvatarSessionKey, remoteAvatarSignature])

  useEffect(() => () => {
    avatarLoadRequestRef.current += 1
    if (avatarObjectUrlRef.current.url
      && typeof URL !== 'undefined'
      && typeof URL.revokeObjectURL === 'function') {
      URL.revokeObjectURL(avatarObjectUrlRef.current.url)
    }
    avatarObjectUrlRef.current = { signature: '', url: '' }
  }, [])

  useEffect(() => {
    if (!hasApiSession()) return undefined
    let active = true
    apiBootstrapState('global').then(async (payload) => {
      if (canListAccounts(payload.user?.role)) {
        const users = await apiListUsers()
        payload.state.employees = mergeEmployeeAuthUsers(payload.state.employees, users.users)
      }
      if (active) activateRemotePayload(payload)
    }).catch(() => {
      clearApiSession()
      if (active) setApiStatus('local')
    }).finally(() => {
      if (active) setSessionRestoreReady(true)
    })
    return () => { active = false }
  }, [activateRemotePayload])

  useEffect(() => {
    const remote = apiRef.current
    const role = normalizeAuthRole(state.session?.role)
    if (!credentialsReady || !remote.enabled || !state.session || !['business_support', 'store_manager', 'employee'].includes(role)) return undefined
    let active = true
    let busy = false
    let pendingForce = false
    const refresh = async ({ force = false } = {}) => {
      if (!active) return
      // A support-transfer boundary is correctness-sensitive: dropping this
      // refresh while the tab is hidden or another poll is in flight can leave
      // an employee attached to the wrong store until the shared-state version
      // changes. Remember the force request and drain it as soon as possible.
      if (force) pendingForce = true
      if (busy || (typeof document !== 'undefined' && document.hidden)) return
      const forceRefresh = pendingForce
      pendingForce = false
      busy = true
      try {
        const metadata = forceRefresh ? null : await apiGetStateMetadata('global')
        // A command can finish before its background projection download. Track
        // the version actually rendered separately so a failed reconciliation
        // is retried by the next lightweight metadata poll.
        const stateVersionAdvanced = Number(metadata?.version || 0) > Number(remote.hydratedVersion || 0)
        const metadataPolicyVersions = metadata?.policyVersions && typeof metadata.policyVersions === 'object'
          ? metadata.policyVersions
          : null
        const policyKeys = metadataPolicyVersions
          ? new Set([...Object.keys(metadataPolicyVersions), ...Object.keys(remote.policyVersions || {})])
          : new Set()
        const policiesChanged = [...policyKeys].some((key) => (
          Number(metadataPolicyVersions?.[key] || 0) !== Number(remote.policyVersions?.[key] || 0)
        ))
        const metadataUserVersion = Number(metadata?.userVersion || 0)
        const userChanged = metadataUserVersion > 0
          && metadataUserVersion !== Number(remote.user?.version || 0)
        const metadataChanged = forceRefresh || stateVersionAdvanced || policiesChanged || userChanged
        if (!active || !metadataChanged) return
        const latest = await apiGetState('global')
        const effectiveUserChanged = remoteEffectiveUserChanged(remote.user, latest.user)
        if (!forceRefresh && !metadataChanged && !effectiveUserChanged) return
        if (metadataChanged && canListAccounts(role)) {
          const users = await apiListUsers()
          latest.state.employees = mergeEmployeeAuthUsers(latest.state.employees, users.users)
        }
        if (active) activateRemotePayload(latest, latest.user || remote.user, activeStoreIdRef.current)
      } catch {
        // Polling is best-effort; the next interval or a foreground action will retry.
      } finally {
        busy = false
        if (active && pendingForce && (typeof document === 'undefined' || !document.hidden)) void refresh()
      }
    }
    const timer = window.setInterval(refresh, 5000)
    const boundaryDelay = ['store_manager', 'employee'].includes(role)
      ? nextSupportTransferBoundaryDelay(state.supportTransfers, Date.now())
      : null
    const boundaryTimer = boundaryDelay == null
      ? null
      : window.setTimeout(() => refresh({ force: true }), Math.min(boundaryDelay + 25, 2_147_000_000))
    const refreshWhenVisible = () => {
      if (!document.hidden) refresh({ force: pendingForce || ['store_manager', 'employee'].includes(role) })
    }
    document.addEventListener('visibilitychange', refreshWhenVisible)
    return () => {
      active = false
      window.clearInterval(timer)
      if (boundaryTimer != null) window.clearTimeout(boundaryTimer)
      document.removeEventListener('visibilitychange', refreshWhenVisible)
    }
  }, [activateRemotePayload, credentialsReady, state.activeStoreId, state.session, state.supportTransfers])

  useEffect(() => {
    if (credentialsReady) return undefined
    let active = true
    const migrate = async () => {
      const migrateAccounts = async (accounts) => Promise.all(accounts.map(async (account) => account.legacyPassword
        ? { ...account, passwordHash: await hashPassword(account.legacyPassword), legacyPassword: '', password: undefined }
        : { ...account, password: undefined }))
      const [adminAccounts, managerAccounts, employees] = await Promise.all([
        migrateAccounts(state.adminAccounts),
        migrateAccounts(state.managerAccounts),
        migrateAccounts(state.employees),
      ])
      if (!active) return
      setState((current) => mergeLegacyCredentialMigration(
        current,
        { adminAccounts, managerAccounts, employees },
        apiRef.current.enabled,
      ))
      setCredentialsReady(true)
    }
    migrate()
    return () => { active = false }
  }, [credentialsReady, state.adminAccounts, state.managerAccounts, state.employees])

  useEffect(() => {
    if (!credentialsReady || typeof localStorage === 'undefined') return
    if (apiRef.current.enabled) {
      localStorage.removeItem(STORAGE_KEY)
      localStorage.removeItem(LEGACY_STORAGE_KEY)
      return
    }
    const safeState = {
      ...state,
      cachePrivacyEpoch: LOCAL_CACHE_PRIVACY_EPOCH,
      storageMode: 'local',
      session: null,
      adminAccounts: state.adminAccounts.map(({ password: _password, legacyPassword: _legacyPassword, ...account }) => account),
      managerAccounts: state.managerAccounts.map(({ password: _password, legacyPassword: _legacyPassword, ...account }) => account),
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
            remote.hydratedVersion = Number(result.version)
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
            remote.hydratedVersion = Number(result.version)
            remote.lastSerialized = pending.serialized
            remote.suppressNext = true
            setState((current) => ({
              ...hydrateRemoteState(merged, remote.user, latest.policies, current.activeStoreId),
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
      const isSystemOperator = canListAccounts(authenticated.user.role)
      const embeddedUsers = Array.isArray(authenticated.users) ? { users: authenticated.users } : null
      const [bootstrap, users] = await Promise.all([
        authenticated.bootstrap ? Promise.resolve(authenticated.bootstrap) : apiBootstrapState('global'),
        isSystemOperator ? (embeddedUsers || apiListUsers()) : Promise.resolve(null),
      ])
      if (users) {
        bootstrap.state.employees = mergeEmployeeAuthUsers(bootstrap.state.employees, users.users)
      }
      const session = activateRemotePayload(bootstrap, authenticated.user)
      setSessionRestoreReady(true)
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

    const submittedUsername = String(username || '').trim()
    const sources = [
      ...state.adminAccounts.map((account) => ({ account, source: 'admin' })),
      ...state.managerAccounts.map((account) => ({ account, source: 'manager' })),
      ...state.employees.map((account) => ({ account, source: 'employee' })),
    ]
    const matched = sources.find(({ account }) => String(account.username || '').trim() === submittedUsername)
    if (!matched) return { ok: false, message: 'Tên đăng nhập hoặc mật khẩu chưa đúng.' }
    const passwordMatches = matched.account.passwordHash
      ? await verifyPassword(password, matched.account.passwordHash)
      : Boolean(matched.account.legacyPassword) && matched.account.legacyPassword === password
    if (!passwordMatches) return { ok: false, message: 'Tên đăng nhập hoặc mật khẩu chưa đúng.' }
    if (!isActiveAccount(matched.account.status)) return { ok: false, message: 'Tài khoản hiện không ở trạng thái hoạt động.' }

    const baseSession = toSession(matched.account, matched.source)
    const availableRoles = localRoleOptionsForSession(state, baseSession)
    const initialRole = availableRoles.find((option) => option.role === normalizeAuthRole(baseSession.role)) || availableRoles[0]
    const session = {
      ...baseSession,
      role: initialRole?.role || baseSession.role,
      storeId: initialRole?.storeId ?? baseSession.storeId,
      employeeId: initialRole?.employeeId ?? baseSession.employeeId,
      availableRoles,
      needsRoleSelection: availableRoles.length > 1,
    }
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
      activeStoreId: (session.role === 'store_manager' || (session.role === 'employee' && session.unit !== 'office')) && session.storeId
        ? session.storeId
        : current.activeStoreId,
      activeAttendanceId: recent && !recent.checkOutAt && !recent.checkOut ? recent.id : null,
      checkedInAt: recent?.checkIn || recent?.checkInTime || null,
      finishedShift: Boolean(recent?.checkOutAt || recent?.checkOut),
      adminAccounts: matched.source === 'admin' ? current.adminAccounts.map((account) => accountKey(account) === accountKey(matched.account) ? { ...account, passwordHash: migratedPasswordHash, legacyPassword: '', password: undefined, lastLoginAt: loginTimestamp } : account) : current.adminAccounts,
      managerAccounts: matched.source === 'manager' ? current.managerAccounts.map((account) => accountKey(account) === accountKey(matched.account) ? { ...account, passwordHash: migratedPasswordHash, legacyPassword: '', password: undefined, lastLoginAt: loginTimestamp } : account) : current.managerAccounts,
      employees: matched.source === 'employee' ? current.employees.map((account) => accountKey(account) === accountKey(matched.account) ? { ...account, passwordHash: migratedPasswordHash, legacyPassword: '', password: undefined, lastLoginAt: loginTimestamp } : account) : current.employees,
    }))
    return { ok: true, account: session }
  }

  const selectSessionRole = async (selection = {}) => {
    const options = Array.isArray(state.session?.availableRoles) ? state.session.availableRoles : []
    const selected = options.find((option) => (
      option.role === selection.role
      && (!selection.storeId || String(option.storeId || '') === String(selection.storeId))
      && (!selection.employeeId || String(option.employeeId || '') === String(selection.employeeId))
    ))
    if (!selected) return { ok: false, message: 'Vai trò được chọn không còn hợp lệ. Vui lòng đăng nhập lại.' }
    if (apiRef.current.enabled) {
      try {
        const response = await apiSelectSessionRole(selected)
        const payload = await apiBootstrapState('global')
        if (canListAccounts(response.user?.role)) {
          const users = await apiListUsers()
          payload.state.employees = mergeEmployeeAuthUsers(payload.state.employees, users.users)
        }
        const session = activateRemotePayload(payload, response.user, selected.storeId)
        return { ok: true, account: session }
      } catch (error) {
        notify(error.message || 'Không thể chuyển vai trò đăng nhập.', 'info')
        return { ok: false, message: error.message }
      }
    }
    const session = {
      ...state.session,
      ...selected,
      availableRoles: options,
      needsRoleSelection: false,
    }
    setState((current) => ({
      ...current,
      session,
      activeStoreId: ['store_manager', 'employee'].includes(session.role) && session.storeId
        ? session.storeId
        : current.activeStoreId,
    }))
    return { ok: true, account: session }
  }

  const quickLogin = () => null

  const logout = () => {
    const wasRemote = apiRef.current.enabled
    if (wasRemote) apiLogout().catch(() => clearApiSession())
    apiRef.current.enabled = false
    apiRef.current.role = null
    apiRef.current.user = null
    apiRef.current.version = 0
    apiRef.current.hydratedVersion = 0
    apiRef.current.pending = null
    apiRef.current.suppressNext = false
    window.clearTimeout(apiRef.current.timer)
    setApiStatus('local')
    if (wasRemote) {
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem(STORAGE_KEY)
        localStorage.removeItem(LEGACY_STORAGE_KEY)
      }
      const initialState = createInitialState()
      activeStoreIdRef.current = initialState.activeStoreId
      setState(initialState)
      return
    }
    setState((current) => ({ ...current, session: null, activeAttendanceId: null, checkedInAt: null, finishedShift: false }))
  }

  const updateCollection = (key, updater) =>
    setState((current) => ({ ...current, [key]: updater(Array.isArray(current[key]) ? current[key] : []) }))

  const setActiveStoreId = (id) => {
    if (state.session?.role === 'store_manager' && String(id) !== String(state.session.storeId)) return false
    if (!state.stores.some((store) => store.id === id)) return false
    rememberActiveStore(apiRef.current.user || state.session, id)
    activeStoreIdRef.current = id
    setState((current) => ({ ...current, activeStoreId: id }))
    return true
  }

  const addStore = async (payload) => {
    const name = String(payload.name || '').trim().replace(/^DORE\s+/i, 'IDOSI ')
    if (!name) {
      notify('Vui lòng nhập tên cửa hàng.', 'info')
      return { ok: false, message: 'Vui lòng nhập tên cửa hàng.' }
    }
    if (state.stores.some((item) => normalizeText(item.name) === normalizeText(name))) {
      notify('Tên cửa hàng đang hoạt động đã tồn tại.', 'info')
      return { ok: false, message: 'Tên cửa hàng đang hoạt động đã tồn tại.' }
    }
    if (!isSystemRole(state.session?.role)) return { ok: false, message: 'Chỉ Admin hoặc Quản lý được thêm cửa hàng.' }
    if (apiRef.current.enabled) {
      try {
        const result = await runRemoteDomainCommand('store.create', { ...payload, name })
        notify('Đã thêm cửa hàng mới.')
        return { ok: true, store: result.store }
      } catch (error) {
        notify(error.message || 'Không thể thêm cửa hàng.', 'info')
        return { ok: false, message: error.message }
      }
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
    return { ok: true, store }
  }

  const updateStore = async (id, payload) => {
    if (!isStoreWorkspaceRole(state.session?.role)) return { ok: false, message: 'Tài khoản không có quyền cập nhật cửa hàng.' }
    if (state.session?.role === 'store_manager' && String(id) !== String(state.session.storeId)) {
      return { ok: false, message: 'Quản lý cửa hàng chỉ được cập nhật cửa hàng được phân công.' }
    }
    if (apiRef.current.enabled) {
      try {
        const result = await runRemoteDomainCommand('store.update', { storeId: id, ...payload })
        notify('Đã cập nhật cửa hàng.')
        return { ok: true, store: result.store }
      } catch (error) {
        notify(error.message || 'Không thể cập nhật cửa hàng.', 'info')
        return { ok: false, message: error.message }
      }
    }
    const previous = state.stores.find((store) => store.id === id)
    if (!previous) return { ok: false, message: 'Không tìm thấy cửa hàng.' }
    const store = { ...previous, ...payload }
    updateCollection('stores', (items) => items.map((item) => item.id === id ? store : item))
    notify('Đã cập nhật cửa hàng.')
    return { ok: true, store }
  }

  const deleteStore = async (id) => {
    if (state.session?.role !== 'admin') {
      notify('Chỉ Admin được xóa cửa hàng khỏi hệ thống.', 'info')
      return { ok: false, message: 'Chỉ Admin được xóa cửa hàng khỏi hệ thống.' }
    }
    const store = state.stores.find((item) => item.id === id)
    if (!store) return { ok: false, message: 'Không tìm thấy cửa hàng.' }
    if (apiRef.current.enabled) {
      try {
        const result = await runRemoteDomainCommand('store.delete', { storeId: id })
        notify('Đã xóa cửa hàng.', 'info')
        return { ok: true, store: result.store }
      } catch (error) {
        notify(error.message || 'Không thể xóa cửa hàng.', 'info')
        return { ok: false, message: error.message }
      }
    }
    const orderCount = visibleOrders(state.orders).filter((order) => order.storeId === id && order.source !== 'legacy-opening-balance').length
    if (orderCount > 0) {
      notify(`Không thể xóa vì cửa hàng đã phát sinh ${orderCount} đơn hàng.`, 'info')
      return { ok: false, message: `Không thể xóa vì cửa hàng đã phát sinh ${orderCount} đơn hàng.` }
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
    return { ok: true, store }
  }

  const hasDuplicateAccount = (payload, ignoredKey = '') => {
    const records = [...state.adminAccounts, ...state.managerAccounts, ...state.employees].filter((account) => accountKey(account) !== String(ignoredKey))
    const username = normalizeText(payload.username)
    return records.some((account) => username && normalizeText(account.username) === username)
  }

  const addEmployee = async (payload) => {
    const actorRole = normalizeAuthRole(state.session?.role)
    const requestedUnit = isBusinessSupportUnit(payload.unit)
      ? 'business_support'
      : isStoreManagerUnit(payload.unit)
        ? 'store_manager'
        : payload.isOffice || isOfficeUnit(payload.unit) || isOfficeUnit(payload.storeId)
          ? 'office'
          : 'store'
    if (!canCreateEmployeeUnit(actorRole, requestedUnit)) return { ok: false, message: 'Tài khoản không có quyền tạo nhân viên thuộc khối này.' }
    if (requestedUnit === 'business_support' && actorRole !== 'admin') return { ok: false, message: 'Chỉ Admin được tạo tài khoản Hỗ trợ KD.' }
    if (requestedUnit === 'store_manager' && !['admin', 'business_support'].includes(actorRole)) return { ok: false, message: 'Tài khoản không có quyền tạo Quản lý cửa hàng.' }
    if (requestedUnit === 'office' && !['admin', 'business_support'].includes(actorRole)) return { ok: false, message: 'Tài khoản không có quyền tạo nhân viên Văn Phòng.' }
    const scopedStoreId = actorRole === 'store_manager' ? state.session.storeId : payload.storeId
    const normalizedPayload = { ...payload, unit: requestedUnit, storeId: requestedUnit === 'store' ? scopedStoreId || state.activeStoreId : scopedStoreId }
    const linkedRolePromotion = ['store_manager', 'store'].includes(requestedUnit) && Boolean(normalizedPayload.linkedEmployeeId)
    const generatedCode = String(payload.id || payload.code || payload.employeeCode || nextEmployeeCode(normalizedPayload, state)).trim()
    const employeePayload = {
      ...normalizedPayload,
      ...(requestedUnit === 'store' ? {
        position: normalizedPayload.position || 'Nhân viên bán hàng',
        workPosition: normalizedPayload.workPosition || 'Nhân viên bán hàng',
        role: normalizedPayload.role || 'Nhân viên bán hàng',
      } : {}),
      id: generatedCode,
      code: generatedCode,
      employeeCode: generatedCode,
    }
    if (!apiRef.current.enabled && requestedUnit === 'store_manager') {
      const managerStoreId = String(employeePayload.storeId || '').trim()
      if (managerStoreId) {
        const managerResolution = resolveExactlyOneActiveStoreManager({
          storeId: managerStoreId,
          managers: [
            ...(Array.isArray(state.employees) ? state.employees : []),
            ...(Array.isArray(state.managerAccounts) ? state.managerAccounts : []),
          ],
        })
        if (managerResolution.ok || managerResolution.code === 'STORE_MANAGER_MULTIPLE_ACTIVE') {
          return { ok: false, message: 'Cửa hàng đã có một Quản lý cửa hàng đang hoạt động.' }
        }
      }
    }
    const officeEmployee = requestedUnit === 'office'
    if (!linkedRolePromotion && !isValidEmployeePhone(employeePayload.phone)) return { ok: false, message: 'Số điện thoại phải gồm đúng 10 số và bắt đầu bằng số 0.' }
    if (!linkedRolePromotion && !/^\d{12}$/.test(String(employeePayload.cccd || employeePayload.citizenId || ''))) {
      return { ok: false, message: 'Số CCCD phải gồm đúng 12 chữ số.' }
    }
    if (!linkedRolePromotion && !/^\d{4}-\d{2}-\d{2}$/u.test(String(employeePayload.startDate || employeePayload.joinDate || ''))) {
      return { ok: false, message: 'Ngày bắt đầu làm không hợp lệ.' }
    }
    if (!linkedRolePromotion && (!employeePayload.identityImages?.front || !employeePayload.identityImages?.back)) {
      return { ok: false, message: 'Cần tải lên đủ ảnh mặt trước và mặt sau CCCD.' }
    }
    if (!linkedRolePromotion && (!String(employeePayload.username || '').trim() || !String(employeePayload.password || ''))) {
      return { ok: false, message: 'Tên đăng nhập và mật khẩu là bắt buộc.' }
    }
    if (!linkedRolePromotion && hasDuplicateAccount(employeePayload)) {
      notify('Tên đăng nhập đã tồn tại.', 'info')
      return { ok: false }
    }
    if (apiRef.current.enabled) {
      try {
        const result = await runRemoteDomainCommand('employee.create', {
          ...employeePayload,
          id: undefined,
          code: undefined,
          employeeCode: undefined,
          employmentType: officeEmployee
            ? employeePayload.officeEmployeeType || employeePayload.officeEmploymentType || 'Chính thức'
            : employeePayload.employmentType,
          passwordHash: undefined,
          legacyPassword: undefined,
          monthlyWorkdayTargets: undefined,
        })
        notify('Đã tạo hồ sơ và tài khoản đăng nhập nhân viên.')
        return {
          ok: true,
          employee: result.employee,
          user: result.user,
        }
      } catch (error) {
        notify(error.message || 'Không thể tạo tài khoản nhân viên.', 'info')
        return { ok: false, message: error.message }
      }
    }
    const passwordHash = employeePayload.password ? await hashPassword(employeePayload.password) : ''
    if (!linkedRolePromotion && !passwordHash) return { ok: false, message: 'Mật khẩu là bắt buộc.' }
    const linkedSource = linkedRolePromotion
      ? state.employees.find((record) => accountKey(record) === String(employeePayload.linkedEmployeeId || ''))
      : null
    const employee = normalizeEmployee({
      ...(linkedSource || {}),
      ...employeePayload,
      password: undefined,
      ...(passwordHash ? { passwordHash } : {}),
      ...(linkedSource?.authUserId ? { authUserId: linkedSource.authUserId } : {}),
    }, state.activeStoreId)
    setState((current) => {
      const employees = [employee, ...current.employees]
      return { ...current, employees, stores: countStoreEmployees(current.stores, employees) }
    })
    notify('Đã lưu hồ sơ nhân viên.')
    return { ok: true, employee }
  }

  const updateEmployee = async (id, payload) => {
    const actorRole = normalizeAuthRole(state.session?.role)
    if (!['admin', 'business_support', 'store_manager'].includes(actorRole)) return { ok: false, message: 'Tài khoản không có quyền cập nhật nhân viên.' }
    const previous = state.employees.find((employee) => accountKey(employee) === String(id))
    if (!previous) return { ok: false }
    if (Object.keys(payload || {}).some((field) => BUSINESS_SUPPORT_WORKING_TIME_FIELDS.includes(field))) {
      return { ok: false, message: 'Không thể chỉnh sửa cấu hình giờ làm trực tiếp trong hồ sơ sau khi tạo.' }
    }
    if (actorRole === 'business_support' && !canBusinessSupportUpdateEmployee(previous, payload)) {
      return { ok: false, message: 'Hỗ trợ KD không được sửa hồ sơ Nhân viên hỗ trợ KD.' }
    }
    if (hasDuplicateAccount(payload, id)) {
      notify('Tên đăng nhập đã tồn tại.', 'info')
      return { ok: false }
    }
    if (actorRole === 'store_manager' && previous.unit !== 'store') return { ok: false, message: 'Quản lý cửa hàng chỉ được cập nhật nhân viên cửa hàng.' }
    if (actorRole === 'store_manager' && String(previous.storeId) !== String(state.session.storeId)) {
      return { ok: false, message: 'Quản lý cửa hàng chỉ được cập nhật nhân viên thuộc cửa hàng được phân công.' }
    }
    if (payload.phone !== undefined && !isValidEmployeePhone(payload.phone)) return { ok: false, message: 'Số điện thoại phải gồm đúng 10 số và bắt đầu bằng số 0.' }
    let authVersion = previous.authVersion
    if (apiRef.current.enabled) {
      try {
        const result = await runRemoteDomainCommand('employee.update', {
          employeeId: previous.id,
          ...payload,
          id: undefined,
          code: undefined,
          employeeCode: undefined,
          employmentType: actorRole === 'business_support' && previous.unit === 'business_support'
            ? undefined
            : isOfficeUnit(previous.unit) || isOfficeUnit(previous.storeId)
              ? payload.officeEmployeeType || payload.officeEmploymentType || previous.officeEmployeeType || previous.employmentType || 'Chính thức'
              : payload.employmentType ?? previous.employmentType,
          passwordHash: undefined,
          legacyPassword: undefined,
          monthlyWorkdayTargets: undefined,
        })
        notify('Đã cập nhật nhân viên.')
        return { ok: true, employee: result.employee, user: result.user }
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
    if (state.session?.role !== 'admin') {
      notify('Chỉ Admin được xóa nhân viên khỏi hệ thống.', 'info')
      return false
    }
    const previous = state.employees.find((employee) => accountKey(employee) === String(id))
    if (!previous) return false
    const deletedAuthVersion = previous.authVersion
    if (apiRef.current.enabled) {
      try {
        const result = await runRemoteDomainCommand('employee.delete', { employeeId: id })
        notify('Đã xóa nhân viên.', 'info')
        return { ok: true, employee: result.employee }
      } catch (error) {
        notify(error.message || 'Không thể vô hiệu hóa tài khoản nhân viên.', 'info')
        return { ok: false, message: error.message }
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

  const addBusinessSupport = (payload = {}) => addEmployee({
    ...payload,
    unit: 'business_support',
    storeId: 'BUSINESS_SUPPORT',
  })

  const immutableRoleProfileUpdate = (payload = {}) => {
    const { unit, storeId, assignedStoreId, ...profile } = payload
    void unit
    void storeId
    void assignedStoreId
    return profile
  }

  const updateBusinessSupport = (id, payload = {}) => updateEmployee(id, immutableRoleProfileUpdate(payload))

  const deleteBusinessSupport = (id) => deleteEmployee(id)

  const addStoreManager = (payload = {}) => addEmployee({
    ...payload,
    unit: 'store_manager',
  })

  const updateStoreManager = (id, payload = {}) => updateEmployee(id, immutableRoleProfileUpdate(payload))

  const deleteStoreManager = (id) => deleteEmployee(id)

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
    const taskMatch = resolveRecordIdentifier(state.tasks, id)
    const task = matchedRecordOrNull(taskMatch)
    if (!task) {
      return { ok: false, code: taskMatch.ambiguous ? 'TASK_IDENTIFIER_COLLISION' : 'TASK_NOT_FOUND', message: taskMatch.ambiguous ? 'Không thể xác định công việc vì có mã trùng nhau khi không phân biệt chữ hoa/thường.' : 'Không tìm thấy công việc.' }
    }
    if (employeeId && operationalIdentifierEntry(task.completedBy, employeeId).ambiguous) {
      return { ok: false, code: 'TASK_COMPLETION_IDENTIFIER_COLLISION', message: 'Không thể cập nhật vì trạng thái hoàn thành có mã nhân viên trùng nhau khi không phân biệt chữ hoa/thường.' }
    }
    updateCollection('tasks', (items) => items.map((item) => item === task ? {
      ...item,
      ...(employeeId
        ? { completedBy: withCanonicalIdentifierEntry(item.completedBy, employeeId, Boolean(done)) }
        : { done: Boolean(done) }),
    } : item))
    notify(done ? 'Đã hoàn thành công việc.' : 'Đã mở lại công việc.', 'success')
    return { ok: true }
  }

  const addShiftExpense = async (payload = {}) => {
    const employeeId = String(state.session?.employeeId || state.session?.code || '')
    const employeeMatch = resolveEmployeeIdentifier(state.employees, employeeId)
    if (employeeMatch.ambiguous || employeeMatch.matches.length > 1) {
      return { ok: false, code: 'EMPLOYEE_IDENTIFIER_COLLISION', message: 'Không thể xác định nhân viên vì có mã trùng nhau khi không phân biệt chữ hoa/thường.' }
    }
    const employee = employeeMatch.record
    const role = normalizeAuthRole(state.session?.role)
    const employeeUnit = String(employee?.unit || employee?.unitType || employee?.department || '').trim()
    if (role !== 'employee' || !employee || isOfficeUnit(employeeUnit) || isBusinessSupportUnit(employeeUnit) || isStoreManagerUnit(employeeUnit)) {
      return { ok: false, message: 'Chức năng này chỉ dành cho nhân viên cửa hàng.' }
    }
    const attendanceId = String(payload.attendanceId || '')
    const attendanceMatch = resolveOpenAttendanceIdentifier(state.attendance, {
      employeeId: accountKey(employee),
      attendanceId,
    })
    if (attendanceMatch.ambiguous) {
      return { ok: false, code: 'ATTENDANCE_IDENTIFIER_COLLISION', message: 'Không thể xác định ca đang mở vì có mã chấm công trùng nhau khi không phân biệt chữ hoa/thường.' }
    }
    const openAttendance = attendanceMatch.record
    if (!openAttendance) return { ok: false, message: 'Bạn cần điểm danh và đang trong ca để nhập chi phí.' }
    if (String(state.session?.storeId || '') && !sameIdentifier(openAttendance.storeId, state.session.storeId)) {
      return { ok: false, message: 'Ca đang mở không thuộc cửa hàng hiện tại của tài khoản.' }
    }
    const name = String(payload.name || payload.expenseName || '').trim()
    const note = String(payload.note || '').trim()
    const amount = nonNegativeInteger(payload.amount)
    if (!name || name.length > 160) return { ok: false, message: 'Tên chi phí là bắt buộc và không được vượt quá 160 ký tự.' }
    if (amount <= 0) return { ok: false, message: 'Số tiền chi phí phải lớn hơn 0.' }
    if (note.length > 1_000) return { ok: false, message: 'Ghi chú không được vượt quá 1.000 ký tự.' }
    const period = recordDate(openAttendance).slice(0, 7)
    const lockedPeriod = state.payrollPeriods.find((item) => (
      String(item.storeId || '') === String(openAttendance.storeId || '')
      && String(item.period || '') === period
      && (item.lockedAt || item.status === 'Đã khóa')
    ))
    if (lockedPeriod) return { ok: false, message: 'Kỳ lương liên quan đã khóa; không thể thay đổi số liệu.' }
    const idempotencyKey = String(payload.idempotencyKey || `shift-expense:${crypto.randomUUID()}`)
    if (apiRef.current.enabled) {
      try {
        const result = await runRemoteDomainCommand('shift_expense.create', {
          attendanceId: openAttendance.id,
          name,
          amount,
          note,
        }, idempotencyKey)
        notify('Đã lưu chi phí trong ca.')
        return { ok: true, expense: result.expense, attendance: result.attendance, existing: result.existing }
      } catch (error) {
        notify(error.message || 'Không thể lưu chi phí trong ca.', 'info')
        return { ok: false, message: error.message }
      }
    }
    const existing = state.expenseEntries.find((entry) => String(entry.idempotencyKey || '') === idempotencyKey)
    if (existing) return { ok: true, expense: existing, existing: true }
    const timestamp = new Date().toISOString()
    const expense = {
      id: uid('EXPCA'),
      storeId: openAttendance.storeId,
      employeeId,
      employeeName: employee.name || employeeId,
      attendanceId: openAttendance.id,
      shiftId: openAttendance.shiftId || openAttendance.shift || null,
      shiftName: openAttendance.shiftName || openAttendance.shift || '',
      type: name,
      name,
      category: 'shift',
      amount,
      description: note || name,
      note,
      sourceType: 'shift-expense-item',
      sourceId: null,
      idempotencyKey,
      recognized: true,
      occurredAt: timestamp,
      createdAt: timestamp,
      createdBy: employeeId,
      createdByActor: actorSnapshot(state.session),
    }
    expense.sourceId = expense.id
    const transaction = {
      id: uid('TXNCA'),
      storeId: openAttendance.storeId,
      employeeId,
      attendanceId: openAttendance.id,
      shiftId: expense.shiftId,
      type: name,
      direction: 'out',
      amount,
      description: note || name,
      sourceType: 'shift-expense-item',
      sourceId: expense.id,
      occurredAt: timestamp,
      createdAt: timestamp,
      actor: actorSnapshot(state.session),
    }
    setState((current) => {
      if (current.expenseEntries.some((entry) => String(entry.idempotencyKey || '') === idempotencyKey)) return current
      const previousTotal = current.expenseEntries
        .filter((entry) => entry.recognized !== false
          && operationalIdentifierReferenceMatchesRecord(current.attendance, openAttendance, entry.attendanceId)
          && String(entry.sourceType || '') === 'shift-expense-item')
        .reduce((total, entry) => total + nonNegativeInteger(entry.amount), 0)
      const totalShiftExpense = previousTotal + amount
      return {
        ...current,
        attendance: current.attendance.map((record) => String(record.id || '') === String(openAttendance.id || '')
          ? { ...record, expense: totalShiftExpense, shiftExpenseTotal: totalShiftExpense, updatedAt: timestamp }
          : record),
        expenseEntries: [expense, ...current.expenseEntries],
        cashTransactions: [transaction, ...current.cashTransactions],
        auditLogs: [{ id: uid('AUD'), entity: 'shift-expense', entityId: expense.id, action: 'create', before: null, after: expense, actor: actorSnapshot(current.session), createdAt: timestamp }, ...current.auditLogs],
        stateVersion: current.stateVersion + 1,
      }
    })
    notify('Đã lưu chi phí trong ca.')
    return { ok: true, expense }
  }

  const saveStoreTaskProgress = async (payload = {}) => {
    const employeeId = String(state.session?.employeeId || state.session?.code || '')
    const employeeMatch = resolveEmployeeIdentifier(state.employees, employeeId)
    if (employeeMatch.ambiguous) {
      return { ok: false, code: 'EMPLOYEE_IDENTIFIER_COLLISION', message: 'Không thể xác định nhân viên vì có mã trùng nhau khi không phân biệt chữ hoa/thường.' }
    }
    const employee = employeeMatch.record
    const role = normalizeAuthRole(state.session?.role)
    const employeeUnit = String(employee?.unit || employee?.unitType || employee?.department || '').trim()
    if (role !== 'employee' || !employee || isOfficeUnit(employeeUnit) || isBusinessSupportUnit(employeeUnit) || isStoreManagerUnit(employeeUnit)) {
      return { ok: false, message: 'Chức năng này chỉ dành cho nhân viên cửa hàng.' }
    }
    const attendanceId = String(payload.attendanceId || '')
    const attendanceMatch = resolveOpenAttendanceIdentifier(state.attendance, {
      employeeId: accountKey(employee),
      attendanceId,
    })
    if (attendanceMatch.ambiguous) {
      return { ok: false, code: 'ATTENDANCE_IDENTIFIER_COLLISION', message: 'Không thể xác định ca đang mở vì có mã chấm công trùng nhau khi không phân biệt chữ hoa/thường.' }
    }
    const openAttendance = attendanceMatch.record
    if (!openAttendance) return { ok: false, message: 'Bạn cần điểm danh và đang trong ca để lưu kết quả công việc.' }
    const storeId = String(openAttendance.storeId || employee.storeId || '')
    const date = String(openAttendance.date || openAttendance.workDate || '').slice(0, 10)
    const shiftId = String(openAttendance.shiftId || openAttendance.shift || '')
    const scopedTasks = storeTasksForAttendance({
      tasks: state.tasks,
      attendance: openAttendance,
      attendanceRecords: state.attendance,
      employeeId,
      employees: state.employees,
      stores: state.stores,
      shiftDefinitions: state.shiftDefinitions,
      taskAssignmentHistory: state.taskAssignmentHistory,
    })
    if (!scopedTasks.length) return { ok: false, message: 'Ca đang làm chưa có công việc được giao.' }
    if (scopedTasks.some((task) => operationalIdentifierEntry(task.completedBy, employeeId).ambiguous)) {
      return { ok: false, code: 'TASK_COMPLETION_IDENTIFIER_COLLISION', message: 'Không thể lưu kết quả vì trạng thái hoàn thành có mã nhân viên trùng nhau khi không phân biệt chữ hoa/thường.' }
    }
    const statuses = Array.isArray(payload.tasks) ? payload.tasks : []
    const submitted = new Map()
    const taskIdByKey = new Map(scopedTasks.map((task) => [normalizedIdentifier(task.id), String(task.id || '')]))
    if (taskIdByKey.size !== scopedTasks.length) {
      return { ok: false, code: 'TASK_IDENTIFIER_COLLISION', message: 'Không thể lưu kết quả vì danh sách công việc có mã trùng nhau khi không phân biệt chữ hoa/thường.' }
    }
    const taskIds = new Set(taskIdByKey.keys())
    for (const item of statuses) {
      const taskId = String(item?.id || item?.taskId || '')
      const taskKey = normalizedIdentifier(taskId)
      if (!taskIds.has(taskKey) || submitted.has(taskKey) || typeof item?.completed !== 'boolean') {
        return { ok: false, message: 'Danh sách kết quả có công việc không hợp lệ hoặc không thuộc ca đang làm.' }
      }
      submitted.set(taskKey, item.completed)
    }
    if (submitted.size !== taskIds.size) return { ok: false, message: 'Cần gửi trạng thái của đầy đủ công việc được giao trong ca.' }
    const incompleteReason = String(payload.incompleteReason || payload.note || '').trim()
    const requiredTaskIds = new Set(scopedTasks.filter((task) => task.required !== false).map((task) => normalizedIdentifier(task.id)))
    const incompleteTaskIds = [...submitted]
      .filter(([taskId, completed]) => requiredTaskIds.has(taskId) && !completed)
      .map(([taskId]) => taskId)
    if (incompleteReason.length > 1_000) return { ok: false, message: 'Ghi chú chưa hoàn thành không được vượt quá 1.000 ký tự.' }
    if (incompleteTaskIds.length && !incompleteReason) return { ok: false, message: 'Cần nhập ghi chú khi chưa hoàn thành công việc cố định.' }
    const idempotencyKey = String(payload.idempotencyKey || `task-progress:${crypto.randomUUID()}`)
    if (apiRef.current.enabled) {
      try {
        const result = await runRemoteDomainCommand('task.progress.save', {
          attendanceId: openAttendance.id,
          tasks: [...submitted].map(([id, completed]) => ({ id: taskIdByKey.get(id) || id, completed })),
          incompleteReason,
        }, idempotencyKey)
        notify(`Đã lưu kết quả: hoàn thành ${result.completionRate || 0}%.`)
        return { ok: true, ...result }
      } catch (error) {
        notify(error.message || 'Không thể lưu kết quả công việc.', 'info')
        return { ok: false, message: error.message }
      }
    }
    const normalizedStatuses = [...submitted].sort(([left], [right]) => left.localeCompare(right))
    const fingerprint = JSON.stringify({ attendanceId: openAttendance.id, tasks: normalizedStatuses, incompleteReason })
    const existing = state.taskAssignmentHistory.flatMap((assignment) => assignment.progressHistory || [])
      .find((event) => sameIdentifier(event.employeeId, employeeId) && String(event.fingerprint || '') === fingerprint)
    const mandatoryProgress = (items = scopedTasks) => {
      const mandatoryIds = items
        .filter((task) => task.required !== false)
        .map((task) => normalizedIdentifier(task.id))
      const totalTasks = mandatoryIds.length
      const completedTasks = mandatoryIds.filter((taskId) => submitted.get(taskId) === true).length
      return {
        completedTasks,
        totalTasks,
        completionRate: totalTasks ? Math.round((completedTasks / totalTasks) * 100) : 0,
      }
    }
    const { completedTasks, totalTasks, completionRate } = mandatoryProgress()
    if (existing) return { ok: true, existing: true, completedTasks, totalTasks, completionRate, submittedAt: existing.at }
    const timestamp = new Date().toISOString()
    const assignmentIds = [...new Set(scopedTasks.map((task) => String(task.assignmentId || '')).filter(Boolean))]
    const assignmentKeys = new Set(assignmentIds.map(normalizedIdentifier))
    if (assignmentKeys.size !== assignmentIds.length) {
      return { ok: false, code: 'TASK_ASSIGNMENT_IDENTIFIER_COLLISION', message: 'Không thể lưu kết quả vì lượt giao việc có mã trùng nhau khi không phân biệt chữ hoa/thường.' }
    }
    const submittedByExactTaskId = new Map(scopedTasks.map((task) => [
      String(task.id || ''),
      submitted.get(normalizedIdentifier(task.id)),
    ]))
    const assignmentSummaries = (assignmentIds.length ? assignmentIds : ['']).map((assignmentId) => {
      const scopedAssignmentTasks = scopedTasks
        .filter((task) => !assignmentId || sameIdentifier(task.assignmentId, assignmentId))
      const progress = mandatoryProgress(scopedAssignmentTasks)
      return {
        assignmentId,
        ...progress,
      }
    })
    setState((current) => ({
      ...current,
      tasks: current.tasks.map((task) => submittedByExactTaskId.has(String(task.id || '')) ? {
        ...task,
        completedBy: withCanonicalIdentifierEntry(task.completedBy, employeeId, submittedByExactTaskId.get(String(task.id || ''))),
        completionHistory: [...(task.completionHistory || []), { done: submittedByExactTaskId.get(String(task.id || '')), at: timestamp, employeeId, actor: actorSnapshot(current.session) }],
        updatedAt: timestamp,
      } : task),
      taskAssignmentHistory: current.taskAssignmentHistory.map((assignment) => {
        const assignmentId = String(assignment.assignmentId || assignment.id || '')
        if (!assignmentIds.some((reference) => operationalIdentifierReferenceMatchesRecord(
          current.taskAssignmentHistory,
          assignment,
          reference,
          (record) => record.assignmentId || record.id,
        ))) return assignment
        const assignmentProgress = mandatoryProgress(scopedTasks.filter((task) => String(task.assignmentId || '') === assignmentId))
        const assignmentCompleted = assignmentProgress.completedTasks
        const assignmentTotal = assignmentProgress.totalTasks
        const assignmentRate = assignmentProgress.completionRate
        const requiredComplete = assignmentTotal === 0 || assignmentCompleted === assignmentTotal
        const event = { action: 'progress-submitted', employeeId, employeeName: employee.name || employeeId, attendanceId: openAttendance.id, storeId, date, shiftId, assignmentId, completedTasks: assignmentCompleted, totalTasks: assignmentTotal, completionRate: assignmentRate, incompleteReason: requiredComplete ? '' : incompleteReason, fingerprint, at: timestamp, actor: actorSnapshot(current.session) }
        return {
          ...assignment,
          status: requiredComplete ? 'completed' : 'incomplete',
          completionRate: assignmentRate,
          completedTasks: assignmentCompleted,
          totalTasks: assignmentTotal,
          incompleteReason: requiredComplete ? '' : incompleteReason,
          progressHistory: [...(assignment.progressHistory || []), event],
          updatedAt: timestamp,
        }
      }),
      notifications: assignmentSummaries.flatMap((summary) => (
        ['admin', 'business_support', 'store_manager'].map((targetRole) => ({
          id: uid('NTF'),
          type: 'store-task-progress-submitted',
          targetRole,
          storeId,
          employeeId,
          attendanceId: openAttendance.id,
          assignmentId: summary.assignmentId || null,
          route: `/store/tasks${summary.assignmentId ? `?assignment=${encodeURIComponent(summary.assignmentId)}` : ''}`,
          title: `${employee.name || employeeId} đã gửi kết quả công việc`,
          message: `Hoàn thành ${summary.completedTasks}/${summary.totalTasks} công việc (${summary.completionRate}%).`,
          createdAt: timestamp,
          readAt: null,
        }))
      )).concat(current.notifications || []),
      auditLogs: [{ id: uid('AUD'), entity: 'task-progress', entityId: `${openAttendance.id}:${employeeId}`, action: 'submit', before: null, after: normalizedStatuses, actor: actorSnapshot(current.session), createdAt: timestamp }, ...current.auditLogs],
      stateVersion: current.stateVersion + 1,
    }))
    notify(`Đã lưu kết quả: hoàn thành ${completionRate}%.`)
    return { ok: true, completedTasks, totalTasks, completionRate, incompleteReason, submittedAt: timestamp }
  }

  const replaceTasks = async (input) => {
    const envelope = Array.isArray(input)
      ? { tasks: input }
      : (input && typeof input === 'object' ? input : { tasks: [] })
    const rawTasks = Array.isArray(envelope.tasks) ? envelope.tasks : []
    const legacyScope = rawTasks[0] || {}
    const storeId = envelope.storeId || legacyScope.storeId || state.activeStoreId
    const date = envelope.date || legacyScope.date || legacyScope.workDate || today()
    const shiftId = envelope.shiftId ?? legacyScope.shiftId ?? legacyScope.shift ?? ''
    const employeeIds = [...new Set([
      ...(Array.isArray(envelope.employeeIds) ? envelope.employeeIds : []),
      ...(Array.isArray(envelope.assigneeIds) ? envelope.assigneeIds : []),
      ...(envelope.employeeId ? [envelope.employeeId] : []),
    ].map(String).filter(Boolean))]
    const nextTasks = rawTasks.map((task) => normalizeTask({
      ...task,
      storeId,
      date,
      shiftId,
      employeeIds: employeeIds.length ? employeeIds : task.employeeIds,
    }, storeId))
    const scope = nextTasks[0]
    if (!scope) return { ok: false, message: 'Cần có ít nhất một công việc để lưu.' }
    if (!storeId || !date || !shiftId) return { ok: false, message: 'Vui lòng chọn đủ cửa hàng, ngày và ca làm việc.' }
    if (apiRef.current.enabled) {
      try {
        const assigningEmployees = employeeIds.length > 0
        const result = await runRemoteDomainCommand(assigningEmployees ? 'tasks.assign' : 'tasks.replace_scope', {
          storeId,
          date,
          shiftId,
          ...(assigningEmployees ? { employeeIds } : {}),
          tasks: nextTasks.map((task) => ({
            title: task.title,
            detail: task.detail,
            catalogItemId: task.catalogItemId,
            catalogCode: task.catalogCode,
            catalogVersion: task.catalogVersion,
            kind: task.kind || task.catalogKind,
            catalogKind: task.catalogKind || task.kind,
            amountVnd: task.amountVnd,
            required: task.required,
            ...(task.catalogSnapshot && typeof task.catalogSnapshot === 'object'
              ? { catalogSnapshot: { ...task.catalogSnapshot } }
              : {}),
          })),
        }, envelope.idempotencyKey || `tasks:${crypto.randomUUID()}`)
        notify('Đã lưu và gửi danh sách công việc.')
        return { ok: true, tasks: result.tasks || [], assignment: result.assignment || null, history: result.history || result.taskAssignmentHistory || null }
      } catch (error) {
        notify(error.message || 'Không thể lưu danh sách công việc.', 'info')
        return { ok: false, message: error.message }
      }
    }
    const assignedAt = new Date().toISOString()
    const assignedBy = actorSnapshot(state.session)
    const assignmentId = employeeIds.length ? uid('TAS') : null
    const assignedTasks = nextTasks.map((task) => ({
      ...task,
      ...(assignmentId ? { assignmentId, employeeIds, assignedAt, assignedBy, createdAt: assignedAt, createdBy: assignedBy } : {}),
    }))
    const assignment = assignmentId ? {
      id: assignmentId,
      storeId,
      date,
      shiftId,
      employeeIds,
      tasks: assignedTasks.map((task) => ({
        ...task,
        completedBy: task.completedBy || {},
        ...(task.catalogSnapshot && typeof task.catalogSnapshot === 'object'
          ? { catalogSnapshot: { ...task.catalogSnapshot } }
          : {}),
      })),
      assignedAt,
      assignedBy,
      status: 'Đã giao',
    } : null
    setState((current) => {
      const legacyTasks = assignmentId
        ? current.tasks
        : current.tasks.filter((task) => !(
            String(task.storeId) === String(scope.storeId)
            && String(task.shiftId || task.shift) === String(scope.shiftId)
            && String(task.date || task.workDate) === String(scope.date)
          ))
      const notifications = assignmentId
        ? employeeIds.map((employeeId) => ({
            id: uid('NTF'), type: 'store-task-assigned', storeId, employeeId, targetEmployeeId: employeeId,
            assignmentId, title: 'Bạn có công việc mới', message: `Bạn được giao ${assignedTasks.length} công việc cho ngày ${date}.`,
            route: '/employee/home', createdAt: assignedAt, readAt: null,
          }))
        : []
      return {
        ...current,
        tasks: [...assignedTasks, ...legacyTasks],
        taskAssignmentHistory: assignment ? [assignment, ...(current.taskAssignmentHistory || [])] : (current.taskAssignmentHistory || []),
        notifications: [...notifications, ...(current.notifications || [])],
      }
    })
    notify('Đã lưu và gửi danh sách công việc.')
    return { ok: true, tasks: assignedTasks, assignment }
  }

  const assignSupportWork = async (payload = {}) => {
    if (normalizeAuthRole(state.session?.role) !== 'admin') return { ok: false, message: 'Chỉ Admin được giao việc cho nhân viên.' }
    const date = String(payload.date || '').trim()
    const targetUnit = payload.targetUnit === 'office' ? 'office' : 'business_support'
    const employeeId = String(payload.employeeId || '').trim()
    const employeeMatch = resolveEmployeeIdentifier(state.employees, employeeId)
    const employeeCandidate = matchedRecordOrNull(employeeMatch)
    const employee = employeeCandidate && (targetUnit === 'office'
      ? isOfficeUnit(employeeCandidate.unit || employeeCandidate.unitType || employeeCandidate.department)
      : isBusinessSupportUnit(employeeCandidate.unit))
      ? employeeCandidate
      : null
    const tasks = (Array.isArray(payload.tasks) ? payload.tasks : [])
      .map((task) => ({
        ...task,
        id: String(task.id || uid('CVHT')),
        name: String(task.name || task.title || '').trim(),
        description: String(task.description || task.detail || '').trim(),
        ...(task.catalogSnapshot && typeof task.catalogSnapshot === 'object'
          ? { catalogSnapshot: { ...task.catalogSnapshot } }
          : {}),
      }))
      .filter((task) => task.name)
    if (!/^\d{4}-\d{2}-\d{2}$/u.test(date)) return { ok: false, message: 'Ngày giao việc không hợp lệ.' }
    if (!employee) return { ok: false, message: 'Không tìm thấy nhân viên nhận việc.' }
    if (!tasks.length) return { ok: false, message: 'Cần có ít nhất một công việc.' }
    if (apiRef.current.enabled) {
      try {
        const result = await runRemoteDomainCommand('support_work.assign', { date, targetUnit, employeeId, tasks })
        notify(`Đã gửi ${tasks.length} công việc đến ${employee.name}.`)
        return { ok: true, assignment: result.assignment, notification: result.notification }
      } catch (error) {
        notify(error.message || 'Không thể giao việc.', 'info')
        return { ok: false, message: error.message }
      }
    }
    const timestamp = new Date().toISOString()
    const actor = actorSnapshot(state.session)
    const assignment = {
      id: uid('CVHT'),
      date,
      employeeId,
      employeeName: employee.name,
      targetUnit,
      tasks: tasks.map((task) => ({ ...task, completed: false, completedAt: null, completedBy: null })),
      status: 'assigned',
      incompleteReason: '',
      assignedAt: timestamp,
      assignedBy: actor,
      updatedAt: timestamp,
      submittedAt: null,
      history: [{
        action: 'Giao việc',
        at: timestamp,
        actor,
        details: { tasks: tasks.map((task) => ({ ...task, completed: false })) },
      }],
    }
    const notification = {
      id: uid('NTF'),
      type: 'support-work-assigned',
      targetEmployeeId: employeeId,
      employeeId,
      assignmentId: assignment.id,
      targetUnit,
      storeId: targetUnit === 'office' ? 'OFFICE' : 'BUSINESS_SUPPORT',
      route: `${targetUnit === 'office' ? '/employee/assigned-work' : '/support/assigned-work'}?assignment=${encodeURIComponent(assignment.id)}`,
      title: `Công việc mới ngày ${date}`,
      message: `Admin đã giao ${tasks.length} công việc cho bạn.`,
      createdAt: timestamp,
      readAt: null,
    }
    setState((current) => ({
      ...current,
      supportWorkAssignments: [assignment, ...(current.supportWorkAssignments || [])],
      notifications: [notification, ...current.notifications],
      stateVersion: current.stateVersion + 1,
    }))
    notify(`Đã gửi ${tasks.length} công việc đến ${employee.name}.`)
    return { ok: true, assignment, notification }
  }

  const updateSupportWork = async (payload = {}) => {
    const actorRole = normalizeAuthRole(state.session?.role)
    const sessionEmployeeId = String(state.session?.employeeId || state.session?.code || '')
    const currentProfileMatch = resolveEmployeeIdentifier(state.employees, sessionEmployeeId)
    const currentProfile = currentProfileMatch.ambiguous ? null : currentProfileMatch.record
    const officeEmployee = actorRole === 'employee' && isOfficeUnit(currentProfile?.unit || currentProfile?.unitType || currentProfile?.department)
    if (actorRole !== 'business_support' && !officeEmployee) return { ok: false, message: 'Chỉ nhân viên nhận việc được cập nhật công việc được giao.' }
    const assignmentId = String(payload.assignmentId || '').trim()
    const assignmentMatch = operationalIdentifierRecordMatch(
      state.supportWorkAssignments,
      assignmentId,
      (item) => [item.id],
    )
    const assignment = assignmentMatch.ambiguous ? null : assignmentMatch.record
    const assignmentProfileMatch = assignment
      ? resolveEmployeeIdentifier(state.employees, assignment.employeeId)
      : { record: null, ambiguous: false }
    const employeeId = accountKey(currentProfile) || sessionEmployeeId
    if (!assignment
      || !currentProfile
      || assignmentProfileMatch.ambiguous
      || assignmentProfileMatch.record !== currentProfile) {
      return { ok: false, message: 'Không tìm thấy công việc thuộc tài khoản này.' }
    }
    if ((assignment.targetUnit === 'office') !== officeEmployee) return { ok: false, message: 'Nhóm tài khoản không khớp với lượt giao việc.' }
    if (assignment.submittedAt) return { ok: false, message: 'Kết quả công việc đã được gửi và không thể thay đổi.' }
    const progressById = new Map((Array.isArray(payload.tasks) ? payload.tasks : []).map((task) => {
      const noteProvided = Object.prototype.hasOwnProperty.call(task || {}, 'note')
        || Object.prototype.hasOwnProperty.call(task || {}, 'employeeNote')
      return [String(task.id), {
        completed: Boolean(task.completed),
        note: noteProvided ? String(task.note ?? task.employeeNote ?? '').trim() : '',
        noteProvided,
      }]
    }))
    if ([...progressById.values()].some((task) => task.note.length > 1_000)) {
      return { ok: false, message: 'Ghi chú của từng công việc không được vượt quá 1.000 ký tự.' }
    }
    const timestamp = new Date().toISOString()
    const nextTasks = (assignment.tasks || []).map((task) => {
      if (!progressById.has(String(task.id))) return task
      const progress = progressById.get(String(task.id))
      const completed = progress.completed
      return {
        ...task,
        completed,
        employeeNote: progress.noteProvided ? progress.note : String(task.employeeNote || ''),
        completedAt: completed ? task.completedAt || timestamp : null,
        completedBy: completed ? state.session?.name || employeeId : null,
      }
    })
    const incompleteRequired = nextTasks.some((task) => {
      if (task.completed) return false
      if (task.required === true) return true
      if (task.required === false) return false
      return String(task.kind || task.catalogKind || task.catalogSnapshot?.kind || '').trim().toUpperCase() !== 'REWARD_TASK'
    })
    const reason = String(payload.incompleteReason || '').trim()
    if (payload.submit && incompleteRequired && !reason) return { ok: false, message: 'Vui lòng nhập lý do khi chưa hoàn thành hết công việc bắt buộc.' }
    if (apiRef.current.enabled) {
      try {
        const result = await runRemoteDomainCommand('support_work.update', {
          assignmentId,
          tasks: nextTasks.map((task) => ({ id: task.id, completed: Boolean(task.completed), note: String(task.employeeNote || '') })),
          submit: Boolean(payload.submit),
          incompleteReason: incompleteRequired ? reason : '',
        })
        notify(payload.submit ? 'Đã gửi kết quả công việc.' : 'Đã lưu tiến độ công việc.')
        return { ok: true, assignment: result.assignment }
      } catch (error) {
        notify(error.message || 'Không thể cập nhật công việc.', 'info')
        return { ok: false, message: error.message }
      }
    }
    const actor = actorSnapshot(state.session)
    const updated = {
      ...assignment,
      tasks: nextTasks,
      status: payload.submit ? (incompleteRequired ? 'incomplete' : 'completed') : nextTasks.some((task) => task.completed) ? 'in_progress' : 'assigned',
      incompleteReason: incompleteRequired ? reason : '',
      updatedAt: timestamp,
      submittedAt: payload.submit ? timestamp : assignment.submittedAt || null,
      history: [...(assignment.history || []), {
        action: payload.submit ? 'Gửi kết quả' : 'Lưu tiến độ',
        at: timestamp,
        actor,
        details: { tasks: nextTasks.map((task) => ({ id: task.id, name: task.name, completed: task.completed, employeeNote: task.employeeNote })) },
      }],
    }
    const notification = payload.submit ? {
      id: uid('NTF'),
      type: 'support-work-submitted',
      targetRole: 'admin',
      audienceRoles: ['admin'],
      assignmentId: assignment.id,
      targetUnit: assignment.targetUnit,
      storeId: assignment.targetUnit === 'office' ? 'OFFICE' : 'BUSINESS_SUPPORT',
      route: `/admin/assignments?unit=${assignment.targetUnit === 'office' ? 'office' : 'business_support'}&assignment=${encodeURIComponent(assignment.id)}`,
      title: assignment.targetUnit === 'office' ? 'Nhân viên Khối văn phòng đã gửi kết quả công việc' : 'Hỗ trợ KD đã gửi kết quả công việc',
      message: `${assignment.employeeName || employeeId} hoàn thành ${nextTasks.filter((task) => task.completed).length}/${nextTasks.length} công việc ngày ${assignment.date}.`,
      createdAt: timestamp,
      readAt: null,
    } : null
    setState((current) => ({
      ...current,
      supportWorkAssignments: (current.supportWorkAssignments || []).map((item) => item.id === assignment.id ? updated : item),
      notifications: notification ? [notification, ...(current.notifications || [])] : current.notifications,
      stateVersion: current.stateVersion + 1,
    }))
    notify(payload.submit ? 'Đã gửi kết quả công việc.' : 'Đã lưu tiến độ công việc.')
    return { ok: true, assignment: updated, ...(notification ? { notification } : {}) }
  }

  const saveBusinessSupportSchedule = async (payload = {}) => {
    const actorRole = normalizeAuthRole(state.session?.role)
    const actorEmployeeId = String(state.session?.employeeId || '').trim()
    const actorEmployee = matchedRecordOrNull(resolveEmployeeIdentifier(state.employees, actorEmployeeId))
    const selfManagingOfficeSchedule = actorRole === 'employee'
      && String(actorEmployee?.unit || actorEmployee?.unitType || '').toLowerCase() === 'office'
    if (!['admin', 'business_support'].includes(actorRole) && !selfManagingOfficeSchedule) {
      return { ok: false, message: 'Tài khoản không có quyền phân lịch làm việc.' }
    }
    const requestedEmployeeId = String(payload.employeeId || '').trim()
    if (selfManagingOfficeSchedule && requestedEmployeeId && !sameIdentifier(requestedEmployeeId, actorEmployeeId)) {
      return { ok: false, message: 'Nhân viên văn phòng chỉ được tạo hoặc sửa lịch làm việc của chính mình.' }
    }
    const employeeId = selfManagingOfficeSchedule ? actorEmployeeId : requestedEmployeeId
    const targetUnit = selfManagingOfficeSchedule ? 'office' : payload.targetUnit === 'office' ? 'office' : 'business_support'
    const date = String(payload.date || '').trim()
    const start = String(payload.start || '').slice(0, 5)
    const end = String(payload.end || '').slice(0, 5)
    const employeeCandidate = matchedRecordOrNull(resolveEmployeeIdentifier(state.employees, employeeId))
    const employee = employeeCandidate && String(employeeCandidate.unit || employeeCandidate.unitType || '').toLowerCase() === targetUnit
      ? employeeCandidate
      : null
    if (!employee || !/^\d{4}-\d{2}-\d{2}$/u.test(date) || timeToMinutes(start) == null || timeToMinutes(end) == null || timeToMinutes(end) <= timeToMinutes(start)) {
      return { ok: false, message: 'Ngày, nhân viên hoặc thời gian làm việc chưa hợp lệ.' }
    }
    const employmentType = String(employee.employmentType || employee.workTimeType || 'Full-Time')
    const partTime = /part|thực tập/u.test(employmentType.toLocaleLowerCase('vi-VN'))
    const commandPayload = {
      ...(payload.scheduleId ? { scheduleId: String(payload.scheduleId) } : {}),
      employeeId,
      targetUnit,
      date,
      start,
      end,
      shiftName: partTime ? String(payload.shiftName || '').trim() : (String(payload.shiftName || '').trim() || 'Làm việc Full-Time'),
      note: String(payload.note || '').trim(),
    }
    if (partTime && !commandPayload.shiftName) return { ok: false, message: 'Cần nhập tên ca làm việc.' }
    if (apiRef.current.enabled) {
      try {
        const result = await runRemoteDomainCommand('support_schedule.assign', commandPayload)
        notify(`Đã lưu lịch làm việc của ${targetUnit === 'office' ? 'nhân viên Khối văn phòng' : 'Nhân viên hỗ trợ KD'}.`)
        return { ok: true, schedule: result.schedule, history: result.history }
      } catch (error) {
        notify(error.message || 'Không thể lưu lịch làm việc.', 'info')
        return { ok: false, message: error.message }
      }
    }
    const timestamp = new Date().toISOString()
    const previousMatch = payload.scheduleId
      ? resolveRecordIdentifier(state.supportWorkSchedules || [], payload.scheduleId)
      : operationalIdentifierRecordMatch(
          (state.supportWorkSchedules || []).filter((record) => record.date === date),
          employeeId,
          (record) => [record.employeeId],
        )
    if (previousMatch.ambiguous) {
      return { ok: false, code: 'SUPPORT_SCHEDULE_IDENTIFIER_COLLISION', message: 'Không thể xác định lịch làm việc vì có mã trùng nhau khi không phân biệt chữ hoa/thường.' }
    }
    const previous = previousMatch.record || null
    if (selfManagingOfficeSchedule && previous && (
      !sameIdentifier(previous.employeeId, actorEmployeeId)
      || previous.targetUnit !== 'office'
    )) return { ok: false, message: 'Nhân viên văn phòng chỉ được sửa lịch làm việc của chính mình.' }
    const schedule = {
      id: previous?.id || uid('SWS'),
      employeeId,
      employeeName: employee.name || employeeId,
      targetUnit,
      employmentType,
      ...commandPayload,
      version: Number(previous?.version || 0) + 1,
      createdAt: previous?.createdAt || timestamp,
      updatedAt: timestamp,
      updatedBy: actorSnapshot(state.session),
    }
    const history = { ...schedule, id: uid('SWSH'), scheduleId: schedule.id, recordedAt: timestamp, recordedBy: actorSnapshot(state.session) }
    setState((current) => ({
      ...current,
      supportWorkSchedules: previous
        ? (current.supportWorkSchedules || []).map((record) => record === previous ? schedule : record)
        : [schedule, ...(current.supportWorkSchedules || [])],
      supportWorkScheduleHistory: [history, ...(current.supportWorkScheduleHistory || [])],
    }))
    notify(`Đã lưu lịch làm việc của ${targetUnit === 'office' ? 'nhân viên Khối văn phòng' : 'Nhân viên hỗ trợ KD'}.`)
    return { ok: true, schedule, history }
  }

  const deleteBusinessSupportSchedule = async (scheduleId, reason = '') => {
    const actorRole = normalizeAuthRole(state.session?.role)
    const actorEmployeeId = String(state.session?.employeeId || '').trim()
    const actorEmployee = matchedRecordOrNull(resolveEmployeeIdentifier(state.employees, actorEmployeeId))
    const selfManagingOfficeSchedule = actorRole === 'employee'
      && String(actorEmployee?.unit || actorEmployee?.unitType || '').toLowerCase() === 'office'
    if (!['admin', 'business_support'].includes(actorRole) && !selfManagingOfficeSchedule) return { ok: false, message: 'Tài khoản không có quyền xóa lịch làm việc.' }
    const previousMatch = resolveRecordIdentifier(state.supportWorkSchedules || [], scheduleId)
    const previous = matchedRecordOrNull(previousMatch)
    const normalizedReason = String(reason || '').trim()
    if (!previous) return { ok: false, message: 'Không tìm thấy lịch làm việc.' }
    if (selfManagingOfficeSchedule && (
      !sameIdentifier(previous.employeeId, actorEmployeeId)
      || previous.targetUnit !== 'office'
    )) return { ok: false, message: 'Nhân viên văn phòng chỉ được xóa lịch làm việc của chính mình.' }
    if (!normalizedReason) return { ok: false, message: 'Cần nhập lý do xóa lịch làm việc.' }
    if (apiRef.current.enabled) {
      try {
        const result = await runRemoteDomainCommand('support_schedule.delete', { scheduleId, reason: normalizedReason })
        notify('Đã xóa lịch làm việc.')
        return { ok: true, schedule: result.schedule, history: result.history }
      } catch (error) {
        notify(error.message || 'Không thể xóa lịch làm việc.', 'info')
        return { ok: false, message: error.message }
      }
    }
    const timestamp = new Date().toISOString()
    const history = { ...previous, id: uid('SWSH'), scheduleId: previous.id, action: 'Xóa lịch', reason: normalizedReason, recordedAt: timestamp, recordedBy: actorSnapshot(state.session) }
    setState((current) => ({
      ...current,
      supportWorkSchedules: (current.supportWorkSchedules || []).filter((record) => record !== previous),
      supportWorkScheduleHistory: [history, ...(current.supportWorkScheduleHistory || [])],
    }))
    notify('Đã xóa lịch làm việc.')
    return { ok: true, schedule: previous, history }
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
    const accountCollection = state.session?.role === 'admin'
      ? 'adminAccounts'
      : state.employees.some((account) => accountKey(account) === accountKey(state.session) || account.username === state.session?.username)
        ? 'employees'
        : 'managerAccounts'
    const accountExists = state[accountCollection].some((account) => account.id === id || account.username === id)
    if (!accountExists) {
      notify('Không tìm thấy tài khoản quản trị.', 'info')
      return false
    }
    const passwordHash = await hashPassword(password)
    updateCollection(accountCollection, (items) => items.map((account) =>
      account.id === id || account.username === id ? { ...account, passwordHash, legacyPassword: '', password: undefined } : account,
    ))
    notify('Đã đổi mật khẩu quản trị.')
    return true
  }

  const verifyCurrentPassword = async (password) => {
    if (apiRef.current.enabled) return Boolean(password)
    const collection = state.session?.role === 'admin'
      ? state.adminAccounts
      : state.employees.some((account) => accountKey(account) === accountKey(state.session) || account.username === state.session?.username)
        ? state.employees
        : state.managerAccounts
    const account = collection.find((item) => accountKey(item) === accountKey(state.session) || item.username === state.session?.username)
    if (!account) return false
    if (account.passwordHash) return verifyPassword(password, account.passwordHash)
    return Boolean(account.legacyPassword) && account.legacyPassword === password
  }

  const saveSettings = async (settings = {}) => {
    if (!state.session) return { ok: false, message: 'Vui lòng đăng nhập để cập nhật cài đặt tài khoản.' }
    let payload
    try {
      payload = createAccountSettingsPayload(settings)
    } catch (error) {
      const message = error?.message || 'Ảnh đại diện không hợp lệ.'
      notify(message, 'info')
      return { ok: false, message }
    }

    const applyPersistedSettings = (persistedSettings, user = null) => {
      const displayName = String(user?.displayName || persistedSettings.name || state.session?.name || '').trim()
      if (user && apiRef.current.user) apiRef.current.user = { ...apiRef.current.user, ...user, displayName }
      setState((current) => {
        const accountCollection = current.session?.role === 'admin'
          ? 'adminAccounts'
          : current.employees.some((account) => accountKey(account) === accountKey(current.session) || account.username === current.session?.username)
            ? 'employees'
            : 'managerAccounts'
        return {
          ...current,
          settings: { ...current.settings, ...persistedSettings },
          session: current.session ? { ...current.session, name: displayName || current.session.name } : current.session,
          [accountCollection]: (current[accountCollection] || []).map((account) =>
            accountKey(account) === accountKey(current.session) || account.username === current.session?.username
              ? { ...account, name: displayName || account.name }
              : account,
          ),
        }
      })
    }

    if (apiRef.current.enabled) {
      try {
        // Account settings are fully returned by this command, so a second
        // download of the complete global state is both unnecessary and very
        // expensive for an avatar payload. Reuse one idempotency key while the
        // server finishes any durable cleanup left by an interrupted upload;
        // the cleanup response is emitted before the mutation executes.
        const remote = apiRef.current
        let result
        for (let versionAttempt = 0; versionAttempt < 2; versionAttempt += 1) {
          // A VERSION_CONFLICT represents a different mutation attempt because
          // expectedVersion is part of the request contract. Cleanup retries,
          // on the other hand, must keep the exact same key and payload.
          const expectedVersion = remote.version
          const idempotencyKey = `account_settings.update:${crypto.randomUUID()}`
          try {
            for (let cleanupAttempt = 0; cleanupAttempt < 3; cleanupAttempt += 1) {
              try {
                result = await apiCommand('account_settings.update', payload, {
                  expectedVersion,
                  idempotencyKey,
                })
                break
              } catch (error) {
                if (error?.code !== 'ACCOUNT_AVATAR_CLEANUP_RETRY' || cleanupAttempt === 2) throw error
              }
            }
            break
          } catch (error) {
            if (error?.code !== 'VERSION_CONFLICT' || versionAttempt === 1) throw error
            try {
              const latest = await apiGetState('global')
              activateRemotePayload(latest, latest.user || remote.user, activeStoreIdRef.current)
            } catch {
              const refreshError = new Error('Dữ liệu tài khoản vừa thay đổi nhưng không thể tải bản mới nhất. Ảnh và thông tin cũ vẫn được giữ nguyên; vui lòng thử lại.')
              refreshError.code = 'VERSION_CONFLICT'
              throw refreshError
            }
          }
        }
        remote.version = Math.max(Number(remote.version || 0), Number(result.version || 0))
        remote.hydratedVersion = Math.max(Number(remote.hydratedVersion || 0), Number(result.version || 0))
        const remoteSettings = result.settings || {}
        const avatarMetadata = accountAvatarMetadata(remoteSettings.avatar)
        const avatarWasChanged = payload.avatar !== undefined
        const { avatar: submittedAvatar, ...safePayload } = payload
        const currentAvatar = typeof state.settings?.avatar === 'string' ? state.settings.avatar : ''
        const legacyRemoteAvatar = typeof remoteSettings.avatar === 'string'
          && !remoteSettings.avatar.startsWith('data:image/')
          ? remoteSettings.avatar
          : ''
        const immediateAvatar = avatarMetadata
          ? (avatarWasChanged && submittedAvatar ? submittedAvatar : currentAvatar)
          : legacyRemoteAvatar
        const previousAvatarSignature = accountAvatarMetadataSignature(state.settings?.avatarMetadata)
        const nextAvatarSignature = accountAvatarMetadataSignature(avatarMetadata)
        const confirmedAvatarIsLoaded = Boolean(
          nextAvatarSignature
          && avatarObjectUrlRef.current.signature === nextAvatarSignature
          && avatarObjectUrlRef.current.url,
        )
        const shouldLoadAvatar = Boolean(
          avatarMetadata
          && !confirmedAvatarIsLoaded
          && (nextAvatarSignature !== previousAvatarSignature || state.settings?.avatarLoading),
        )
        const persistedSettings = {
          ...safePayload,
          ...remoteSettings,
          avatarMetadata,
          avatar: immediateAvatar,
          avatarLoading: shouldLoadAvatar,
          avatarError: '',
        }
        applyPersistedSettings(persistedSettings, result.user)
        notify('Đã lưu thay đổi tài khoản.')
        return {
          ok: true,
          settings: {
            ...persistedSettings,
            avatar: persistedSettings.avatar,
          },
          user: result.user,
        }
      } catch (error) {
        notify(error.message || 'Không thể lưu cài đặt tài khoản.', 'info')
        return { ok: false, message: error.message }
      }
    }
    applyPersistedSettings(payload)
    notify('Đã lưu thay đổi tài khoản.')
    return { ok: true, settings: payload }
  }

  const canManageOrderInformationOptions = () => (
    ['admin', 'business_support'].includes(normalizeAuthRole(state.session?.role))
  )

  const createOrderInformationOption = async (payload = {}) => {
    if (!canManageOrderInformationOptions()) {
      return { ok: false, message: 'Tài khoản không có quyền quản lý thông tin đơn hàng.' }
    }
    const options = normalizeOrderInformationOptions(state.orderInformationOptions)
    const input = normalizeOrderInformationFields(payload)
    const validationMessage = validateOrderInformationOptionInput(input, options)
    if (validationMessage) return { ok: false, message: validationMessage }

    if (apiRef.current.enabled) {
      try {
        const result = await runRemoteDomainCommand('order_information.create', input)
        notify('Đã thêm nghề nghiệp dùng cho đơn hàng.')
        return { ok: true, option: result.option }
      } catch (error) {
        notify(error.message || 'Không thể thêm nghề nghiệp.', 'info')
        return { ok: false, message: error.message }
      }
    }

    const timestamp = new Date().toISOString()
    const actor = actorSnapshot(state.session)
    const sortOrder = options.reduce((maximum, option) => Math.max(maximum, Number(option.sortOrder) || 0), 0) + 100
    const [option] = normalizeOrderInformationOptions([{
      id: uid('OCC'),
      kind: ORDER_INFORMATION_KIND.OCCUPATION,
      ...input,
      active: true,
      sortOrder,
      system: false,
      createdAt: timestamp,
      createdBy: actor,
      updatedAt: timestamp,
      updatedBy: actor,
      deletedAt: null,
      deletedBy: null,
      deleteReason: '',
    }])
    const audit = {
      id: uid('AUD'),
      entity: 'order_information_option',
      entityId: option.id,
      action: 'create',
      before: null,
      after: option,
      actor,
      createdAt: timestamp,
    }
    setState((current) => ({
      ...current,
      orderInformationOptions: normalizeOrderInformationOptions([
        ...normalizeOrderInformationOptions(current.orderInformationOptions),
        option,
      ]),
      auditLogs: [audit, ...(current.auditLogs || [])],
      stateVersion: current.stateVersion + 1,
    }))
    notify('Đã thêm nghề nghiệp dùng cho đơn hàng.')
    return { ok: true, option }
  }

  const updateOrderInformationOption = async (id, payload = {}) => {
    if (!canManageOrderInformationOptions()) {
      return { ok: false, message: 'Tài khoản không có quyền quản lý thông tin đơn hàng.' }
    }
    const options = normalizeOrderInformationOptions(state.orderInformationOptions)
    const previous = options.find((option) => String(option.id) === String(id))
    if (!previous) return { ok: false, message: 'Không tìm thấy nghề nghiệp.' }
    const input = normalizeOrderInformationFields(payload)
    const validationMessage = validateOrderInformationOptionInput(input, options, { currentId: previous.id })
    if (validationMessage) return { ok: false, message: validationMessage }
    if (previous.label === input.label && previous.code === input.code) {
      return { ok: true, option: previous, existing: true }
    }

    if (apiRef.current.enabled) {
      try {
        const result = await runRemoteDomainCommand('order_information.update', { optionId: previous.id, ...input })
        notify('Đã cập nhật nghề nghiệp.')
        return { ok: true, option: result.option }
      } catch (error) {
        notify(error.message || 'Không thể cập nhật nghề nghiệp.', 'info')
        return { ok: false, message: error.message }
      }
    }

    const timestamp = new Date().toISOString()
    const actor = actorSnapshot(state.session)
    const [option] = normalizeOrderInformationOptions([{
      ...previous,
      ...input,
      updatedAt: timestamp,
      updatedBy: actor,
    }])
    const audit = {
      id: uid('AUD'),
      entity: 'order_information_option',
      entityId: option.id,
      action: 'update',
      before: previous,
      after: option,
      actor,
      createdAt: timestamp,
    }
    setState((current) => ({
      ...current,
      orderInformationOptions: normalizeOrderInformationOptions(
        normalizeOrderInformationOptions(current.orderInformationOptions)
          .map((item) => String(item.id) === String(option.id) ? option : item),
      ),
      auditLogs: [audit, ...(current.auditLogs || [])],
      stateVersion: current.stateVersion + 1,
    }))
    notify('Đã cập nhật nghề nghiệp.')
    return { ok: true, option }
  }

  const deleteOrderInformationOption = async (id, reason = '') => {
    if (!canManageOrderInformationOptions()) {
      return { ok: false, message: 'Tài khoản không có quyền quản lý thông tin đơn hàng.' }
    }
    const options = normalizeOrderInformationOptions(state.orderInformationOptions)
    const previous = options.find((option) => String(option.id) === String(id))
    if (!previous) return { ok: false, message: 'Không tìm thấy nghề nghiệp.' }
    if (!previous.active) return { ok: true, option: previous, existing: true }
    const normalizedReason = String(reason || '').trim()
    if (!normalizedReason) return { ok: false, message: 'Cần nhập lý do vô hiệu hóa nghề nghiệp.' }

    if (apiRef.current.enabled) {
      try {
        const result = await runRemoteDomainCommand('order_information.disable', {
          optionId: previous.id,
          reason: normalizedReason,
        })
        notify('Đã vô hiệu hóa nghề nghiệp.', 'info')
        return { ok: true, option: result.option }
      } catch (error) {
        notify(error.message || 'Không thể vô hiệu hóa nghề nghiệp.', 'info')
        return { ok: false, message: error.message }
      }
    }

    const timestamp = new Date().toISOString()
    const actor = actorSnapshot(state.session)
    const option = {
      ...previous,
      active: false,
      deletedAt: timestamp,
      deletedBy: actor,
      deleteReason: normalizedReason,
      updatedAt: timestamp,
      updatedBy: actor,
    }
    const audit = {
      id: uid('AUD'),
      entity: 'order_information_option',
      entityId: option.id,
      action: 'disable',
      before: previous,
      after: option,
      reason: normalizedReason,
      actor,
      createdAt: timestamp,
    }
    setState((current) => ({
      ...current,
      orderInformationOptions: normalizeOrderInformationOptions(current.orderInformationOptions)
        .map((item) => String(item.id) === String(option.id) ? option : item),
      auditLogs: [audit, ...(current.auditLogs || [])],
      stateVersion: current.stateVersion + 1,
    }))
    notify('Đã vô hiệu hóa nghề nghiệp.', 'info')
    return { ok: true, option }
  }

  const restoreOrderInformationOption = async (id) => {
    if (!canManageOrderInformationOptions()) {
      return { ok: false, message: 'Tài khoản không có quyền quản lý thông tin đơn hàng.' }
    }
    const options = normalizeOrderInformationOptions(state.orderInformationOptions)
    const previous = options.find((option) => String(option.id) === String(id))
    if (!previous) return { ok: false, message: 'Không tìm thấy nghề nghiệp.' }
    if (previous.active) return { ok: true, option: previous, existing: true }

    if (apiRef.current.enabled) {
      try {
        const result = await runRemoteDomainCommand('order_information.restore', { optionId: previous.id })
        notify('Đã khôi phục nghề nghiệp.')
        return { ok: true, option: result.option }
      } catch (error) {
        notify(error.message || 'Không thể khôi phục nghề nghiệp.', 'info')
        return { ok: false, message: error.message }
      }
    }

    const timestamp = new Date().toISOString()
    const actor = actorSnapshot(state.session)
    const option = {
      ...previous,
      active: true,
      deletedAt: null,
      deletedBy: null,
      deleteReason: '',
      updatedAt: timestamp,
      updatedBy: actor,
    }
    const audit = {
      id: uid('AUD'),
      entity: 'order_information_option',
      entityId: option.id,
      action: 'restore',
      before: previous,
      after: option,
      actor,
      createdAt: timestamp,
    }
    setState((current) => ({
      ...current,
      orderInformationOptions: normalizeOrderInformationOptions(current.orderInformationOptions)
        .map((item) => String(item.id) === String(option.id) ? option : item),
      auditLogs: [audit, ...(current.auditLogs || [])],
      stateVersion: current.stateVersion + 1,
    }))
    notify('Đã khôi phục nghề nghiệp.')
    return { ok: true, option }
  }

  const reorderOrderInformationOptions = async (orderedIds = []) => {
    if (!canManageOrderInformationOptions()) {
      return { ok: false, message: 'Tài khoản không có quyền quản lý thông tin đơn hàng.' }
    }
    const options = normalizeOrderInformationOptions(state.orderInformationOptions)
    const normalizedIds = Array.isArray(orderedIds) ? orderedIds.map(String) : []
    const knownIds = new Set(options.map((option) => String(option.id)))
    if (normalizedIds.length !== options.length
      || new Set(normalizedIds).size !== normalizedIds.length
      || normalizedIds.some((id) => !knownIds.has(id))) {
      return { ok: false, message: 'Thứ tự nghề nghiệp không hợp lệ.' }
    }
    if (normalizedIds.every((id, index) => id === String(options[index].id))) {
      return { ok: true, options, existing: true }
    }

    if (apiRef.current.enabled) {
      try {
        const result = await runRemoteDomainCommand('order_information.reorder', { orderedIds: normalizedIds })
        notify('Đã cập nhật thứ tự nghề nghiệp.')
        return { ok: true, options: result.options }
      } catch (error) {
        notify(error.message || 'Không thể cập nhật thứ tự nghề nghiệp.', 'info')
        return { ok: false, message: error.message }
      }
    }

    const timestamp = new Date().toISOString()
    const actor = actorSnapshot(state.session)
    const optionsById = new Map(options.map((option) => [String(option.id), option]))
    const reordered = normalizedIds.map((id, index) => ({
      ...optionsById.get(id),
      sortOrder: (index + 1) * 100,
      updatedAt: timestamp,
      updatedBy: actor,
    }))
    const audit = {
      id: uid('AUD'),
      entity: 'order_information_option',
      entityId: 'order-information-options',
      action: 'reorder',
      before: options.map((option) => option.id),
      after: reordered.map((option) => option.id),
      actor,
      createdAt: timestamp,
    }
    setState((current) => ({
      ...current,
      orderInformationOptions: reordered,
      auditLogs: [audit, ...(current.auditLogs || [])],
      stateVersion: current.stateVersion + 1,
    }))
    notify('Đã cập nhật thứ tự nghề nghiệp.')
    return { ok: true, options: reordered }
  }

  const createOrder = async (payload = {}) => {
    const amount = nonNegativeInteger(payload.amount)
    const requestedStoreId = payload.storeId || state.session?.storeId || state.activeStoreId
    const storeId = state.session?.role === 'employee' ? state.session.storeId : requestedStoreId
    const store = state.stores.find((item) => item.id === storeId)
    if (!store || amount <= 0) return { ok: false, message: 'Cửa hàng hoặc số tiền đơn hàng chưa hợp lệ.' }
    const gender = String(payload.gender || '').trim()
    const occupation = String(payload.occupation || '').trim()
    const acquisitionChannel = String(payload.acquisitionChannel || '').trim()
    const paymentMethod = String(payload.paymentMethod || '').trim()
    if (!ORDER_GENDERS.has(gender)) return { ok: false, message: 'Vui lòng chọn giới tính khách hàng.' }
    if (!occupationValueAllowed({ options: state.orderInformationOptions, value: occupation })) {
      return { ok: false, message: 'Vui lòng chọn nghề nghiệp đang hoạt động trong danh sách của hệ thống.' }
    }
    if (!ORDER_ACQUISITION_CHANNELS.has(acquisitionChannel)) return { ok: false, message: 'Vui lòng chọn kênh khách hàng biết đến cửa hàng.' }
    if (!ORDER_PAYMENT_METHODS.includes(paymentMethod)) return { ok: false, message: 'Vui lòng chọn hình thức thanh toán.' }
    const idempotencyKey = String(payload.idempotencyKey || '').trim()
    if (idempotencyKey && state.idempotencyKeys.includes(idempotencyKey)) {
      const existing = state.orders.find((item) => item.idempotencyKey === idempotencyKey)
      return { ok: true, order: existing, existing: true }
    }

    if (apiRef.current.enabled) {
      try {
        const result = await runRemoteDomainCommand(
          'order.create',
          { ...payload, gender, occupation, acquisitionChannel, paymentMethod, amount, storeId, idempotencyKey: undefined },
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
      gender,
      occupation,
      acquisitionChannel,
      amount,
      paymentMethod,
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
    if (!['admin', 'business_support'].includes(normalizeAuthRole(state.session?.role))) return { ok: false, message: 'Tài khoản không có quyền sửa đơn hàng.' }
    const previous = state.orders.find((item) => item.id === id && !item.deletedAt)
    if (!previous) return { ok: false, message: 'Không tìm thấy đơn hàng.' }
    const reason = String(payload.reason || '').trim()
    if (!reason) return { ok: false, message: 'Cần nhập lý do chỉnh sửa.' }
    const candidate = {
      ...previous,
      customerName: payload.customerName == null ? previous.customerName : String(payload.customerName).trim(),
      customerPhone: payload.customerPhone == null ? previous.customerPhone : normalizePhone(payload.customerPhone),
      customerAge: payload.customerAge == null ? previous.customerAge : Math.max(0, Number(payload.customerAge) || 0),
      gender: payload.gender == null ? previous.gender : String(payload.gender).trim(),
      occupation: payload.occupation == null ? previous.occupation : String(payload.occupation).trim(),
      acquisitionChannel: payload.acquisitionChannel == null ? previous.acquisitionChannel : String(payload.acquisitionChannel).trim(),
      amount: payload.amount == null ? previous.amount : nonNegativeInteger(payload.amount),
      paymentMethod: payload.paymentMethod == null ? previous.paymentMethod : String(payload.paymentMethod).trim(),
    }
    if (candidate.amount <= 0) return { ok: false, message: 'Số tiền đơn hàng phải lớn hơn 0.' }
    if (payload.occupation != null && !occupationValueAllowed({
      options: state.orderInformationOptions,
      value: candidate.occupation,
      previousValue: previous.occupation,
      allowUnchangedInactive: true,
    })) {
      return { ok: false, message: 'Chỉ được giữ nguyên nghề nghiệp đã vô hiệu hóa; hãy chọn giá trị đang hoạt động nếu thay đổi.' }
    }
    if (!ORDER_PAYMENT_METHODS.includes(candidate.paymentMethod)) {
      return { ok: false, message: 'Vui lòng chọn hình thức thanh toán.' }
    }
    const changedFields = ['customerName', 'customerPhone', 'customerAge', 'gender', 'occupation', 'acquisitionChannel', 'amount', 'paymentMethod']
      .filter((key) => JSON.stringify(previous[key]) !== JSON.stringify(candidate[key]))
    if (!changedFields.length) return { ok: true, order: previous, existing: true }
    if (apiRef.current.enabled) {
      try {
        const result = await runRemoteDomainCommand('order.update', {
          ...payload,
          orderId: id,
          ...(payload.occupation != null ? { occupation: candidate.occupation } : {}),
          ...(payload.paymentMethod != null ? { paymentMethod: candidate.paymentMethod } : {}),
          ...(payload.amount != null ? { amount: candidate.amount } : {}),
          reason,
        })
        notify(`Đã cập nhật đơn hàng ${result.order.code}.`)
        return { ok: true, order: result.order, existing: result.existing }
      } catch (error) {
        notify(error.message || 'Không thể cập nhật đơn hàng.', 'info')
        return { ok: false, message: error.message }
      }
    }
    const timestamp = new Date().toISOString()
    const next = { ...candidate, updatedAt: timestamp }
    const actor = actorSnapshot(state.session)
    const audit = { id: uid('ODA'), action: 'Sửa', orderId: id, orderCode: previous.code, storeId: previous.storeId, before: previous, after: next, changedFields, revenueBefore: previous.amount, revenueAfter: next.amount, reason, actor, createdAt: timestamp }
    setState((current) => ({ ...current, orders: current.orders.map((item) => item.id === id ? next : item), orderAudit: [audit, ...current.orderAudit], auditLogs: [audit, ...current.auditLogs], stateVersion: current.stateVersion + 1 }))
    notify(`Đã cập nhật đơn hàng ${previous.code}.`)
    return { ok: true, order: next }
  }

  const deleteOrder = async (id, reason = '') => {
    if (!['admin', 'business_support'].includes(normalizeAuthRole(state.session?.role))) return { ok: false, message: 'Tài khoản không có quyền xóa đơn hàng.' }
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

  const readNotification = async (id) => {
    if (id == null) return { ok: false, message: 'Không tìm thấy thông báo.' }
    if (apiRef.current.enabled) {
      try {
        const result = await runRemoteDomainCommand('notification.mark_read', { notificationId: id })
        setState((current) => ({
          ...current,
          notifications: applyNotificationCommandResult(current.notifications, result),
        }))
        return { ok: true, ...result }
      } catch (error) {
        notify(error.message || 'Không thể đánh dấu thông báo đã đọc.', 'info')
        return { ok: false, message: error.message }
      }
    }
    const timestamp = new Date().toISOString()
    updateCollection('notifications', (items) => items.map((item) => String(item.id) === String(id) ? { ...item, readAt: item.readAt || timestamp } : item))
    return { ok: true }
  }

  const clearNotifications = async (storeId = null) => {
    if (apiRef.current.enabled) {
      try {
        const result = await runRemoteDomainCommand('notification.mark_all_read', storeId ? { storeId } : {})
        setState((current) => ({
          ...current,
          notifications: applyNotificationCommandResult(current.notifications, result),
        }))
        notify('Đã đánh dấu tất cả thông báo là đã đọc.', 'info')
        return { ok: true, ...result }
      } catch (error) {
        notify(error.message || 'Không thể cập nhật danh sách thông báo.', 'info')
        return { ok: false, message: error.message }
      }
    }
    const timestamp = new Date().toISOString()
    updateCollection('notifications', (items) => items.map((item) => (
      !item.readAt && (!storeId || !item.storeId || String(item.storeId) === String(storeId))
        ? { ...item, readAt: timestamp }
        : item
    )))
    notify('Đã đánh dấu tất cả thông báo là đã đọc.', 'info')
    return { ok: true }
  }

  const savePolicies = async (payload = {}) => {
    if (!canManagePolicies(state.session?.role)) return { ok: false, message: 'Chỉ Admin hoặc Nhân viên Hỗ trợ KD được thay đổi chính sách.' }
    const next = {
      ...state.policies,
      ...payload,
      lateToleranceMinutes: Number(payload.lateToleranceMinutes ?? state.policies.lateToleranceMinutes),
      earlyCheckInLimitMinutes: Number(payload.earlyCheckInLimitMinutes ?? state.policies.earlyCheckInLimitMinutes),
      attendanceEvaluation: { ...state.policies.attendanceEvaluation, ...(payload.attendanceEvaluation || {}) },
      effectiveFrom: payload.effectiveFrom || today(),
      version: Number(state.policies.version || 1) + 1,
    }
    const numericValues = [next.lateToleranceMinutes, next.earlyCheckInLimitMinutes, ...Object.values(next.attendanceEvaluation)]
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
    if (!isStoreWorkspaceRole(state.session?.role)) return { ok: false, message: 'Tài khoản không có quyền tạo chi phí.' }
    const storeId = payload.storeId || state.activeStoreId || state.session?.storeId
    if (normalizeAuthRole(state.session?.role) === 'store_manager' && String(storeId || '') !== String(state.session?.storeId || '')) {
      return { ok: false, message: 'Quản lý cửa hàng chỉ được tạo chi phí cho cửa hàng trực thuộc.' }
    }
    const items = normalizeStoreExpenseItems(payload)
    const validationMessage = validateStoreExpenseItems(items)
    const amount = items.reduce((total, item) => total + item.amount, 0)
    if (!storeId || validationMessage) return { ok: false, message: validationMessage || 'Cửa hàng chưa hợp lệ.' }
    if (apiRef.current.enabled) {
      try {
        const result = await runRemoteDomainCommand('fixed_expense.create', {
          storeId,
          items,
          note: String(payload.note || '').trim(),
          occurredAt: payload.occurredAt,
        })
        notify('Đã lưu phiếu chi cửa hàng.')
        return { ok: true, expense: result.expense, expenseEntry: result.expenseEntry }
      } catch (error) {
        notify(error.message || 'Không thể lưu chi phí.', 'info')
        return { ok: false, message: error.message }
      }
    }
    const timestamp = new Date().toISOString()
    const actor = actorSnapshot(state.session)
    const record = { id: uid('FIX'), storeId, type: 'Phiếu chi phí cửa hàng', items, totalAmount: amount, amount, note: String(payload.note || '').trim(), occurredAt: payload.occurredAt || timestamp, createdAt: timestamp, createdBy: actor, deletedAt: null }
    const expense = { id: uid('EXP'), storeId, type: record.type, category: 'fixed', amount, description: record.note || items.map((item) => item.name || item.category).join(', '), sourceType: 'fixed-expense', sourceId: record.id, recognized: true, occurredAt: record.occurredAt, createdAt: timestamp, createdBy: actor.id }
    setState((current) => ({ ...current, fixedExpenses: [record, ...current.fixedExpenses], expenseEntries: [expense, ...current.expenseEntries], stateVersion: current.stateVersion + 1 }))
    notify('Đã lưu phiếu chi cửa hàng.')
    return { ok: true, expense: record }
  }

  const updateFixedExpense = async (expenseId, payload = {}) => {
    if (!isStoreWorkspaceRole(state.session?.role)) return { ok: false, message: 'Tài khoản không có quyền sửa chi phí.' }
    const previous = state.fixedExpenses.find((item) => String(item.id || '') === String(expenseId || '') && !item.deletedAt)
    if (!previous) return { ok: false, message: 'Không tìm thấy phiếu chi cần sửa.' }
    if (normalizeAuthRole(state.session?.role) === 'store_manager' && String(previous.storeId || '') !== String(state.session?.storeId || '')) {
      return { ok: false, message: 'Quản lý cửa hàng chỉ được sửa chi phí của cửa hàng trực thuộc.' }
    }
    const reason = String(payload.reason || '').trim()
    if (!reason) return { ok: false, message: 'Vui lòng nhập lý do chỉnh sửa.' }
    const items = normalizeStoreExpenseItems(payload, previous)
    const validationMessage = validateStoreExpenseItems(items)
    if (validationMessage) return { ok: false, message: validationMessage }
    const amount = items.reduce((total, item) => total + item.amount, 0)
    const commandPayload = {
      expenseId: previous.id,
      items,
      note: payload.note == null ? String(previous.note || '') : String(payload.note || '').trim(),
      occurredAt: payload.occurredAt || previous.occurredAt,
      reason,
    }
    if (apiRef.current.enabled) {
      try {
        const result = await runRemoteDomainCommand('fixed_expense.update', commandPayload)
        notify('Đã cập nhật phiếu chi cửa hàng.')
        return { ok: true, expense: result.expense, expenseEntry: result.expenseEntry }
      } catch (error) {
        notify(error.message || 'Không thể cập nhật phiếu chi.', 'info')
        return { ok: false, message: error.message }
      }
    }
    const timestamp = new Date().toISOString()
    const actor = actorSnapshot(state.session)
    const updated = { ...previous, items, totalAmount: amount, amount, type: 'Phiếu chi phí cửa hàng', note: commandPayload.note, occurredAt: commandPayload.occurredAt, updatedAt: timestamp, updatedBy: actor, updateReason: reason }
    setState((current) => ({
      ...current,
      fixedExpenses: current.fixedExpenses.map((item) => item.id === previous.id ? updated : item),
      expenseEntries: current.expenseEntries.map((entry) => entry.sourceType === 'fixed-expense' && String(entry.sourceId) === String(previous.id)
        ? { ...entry, amount, type: updated.type, description: updated.note || items.map((item) => item.name || item.category).join(', '), occurredAt: updated.occurredAt, updatedAt: timestamp }
        : entry),
      stateVersion: current.stateVersion + 1,
    }))
    notify('Đã cập nhật phiếu chi cửa hàng.')
    return { ok: true, expense: updated }
  }

  const deleteFixedExpense = async (expenseId, reasonValue = '') => {
    if (normalizeAuthRole(state.session?.role) !== 'admin') return { ok: false, message: 'Chỉ Admin được xóa phiếu chi cửa hàng.' }
    const previous = state.fixedExpenses.find((item) => String(item.id || '') === String(expenseId || '') && !item.deletedAt)
    if (!previous) return { ok: false, message: 'Không tìm thấy phiếu chi cần xóa.' }
    const reason = String(typeof reasonValue === 'object' ? reasonValue.reason : reasonValue || '').trim()
    if (!reason) return { ok: false, message: 'Vui lòng nhập lý do xóa.' }
    if (apiRef.current.enabled) {
      try {
        const result = await runRemoteDomainCommand('fixed_expense.delete', { id: previous.id, reason })
        notify('Đã xóa phiếu chi cửa hàng.')
        return { ok: true, expense: result.expense, expenseEntry: result.expenseEntry }
      } catch (error) {
        notify(error.message || 'Không thể xóa phiếu chi.', 'info')
        return { ok: false, message: error.message }
      }
    }
    const timestamp = new Date().toISOString()
    const actor = actorSnapshot(state.session)
    const deleted = { ...previous, deletedAt: timestamp, deletedBy: actor, deleteReason: reason }
    setState((current) => ({
      ...current,
      fixedExpenses: current.fixedExpenses.map((item) => item.id === previous.id ? deleted : item),
      expenseEntries: current.expenseEntries.map((entry) => entry.sourceType === 'fixed-expense' && String(entry.sourceId) === String(previous.id)
        ? { ...entry, recognized: false, deletedAt: timestamp, deletedBy: actor.id }
        : entry),
      stateVersion: current.stateVersion + 1,
    }))
    notify('Đã xóa phiếu chi cửa hàng.')
    return { ok: true, expense: deleted }
  }

  const requireCompensationOperator = (targetUnit = '') => {
    const role = normalizeAuthRole(state.session?.role)
    if (!['admin', 'business_support', 'store_manager'].includes(role)) {
      throw new Error('Chỉ Admin, Nhân viên hỗ trợ KD hoặc Quản lý cửa hàng được thực hiện thao tác này.')
    }
    if (role === 'store_manager' && targetUnit !== 'store') {
      throw new Error('Quản lý cửa hàng chỉ được ghi nhận vi phạm tại cửa hàng được phân công.')
    }
    if (targetUnit === 'business_support' && role !== 'admin') {
      throw new Error('Chỉ Admin được quản lý vi phạm của Nhân viên hỗ trợ KD.')
    }
    if (!apiRef.current.enabled) {
      throw new Error('Cần kết nối máy chủ để cập nhật dữ liệu lương thưởng an toàn.')
    }
  }

  const setStoreEmployeeSalaryConfig = async (payload = {}) => {
    const role = normalizeAuthRole(state.session?.role)
    if (!['admin', 'business_support'].includes(role)) {
      throw new Error('Chỉ Admin hoặc Nhân viên hỗ trợ KD được cài đặt lương Full-Time.')
    }
    if (!apiRef.current.enabled) {
      throw new Error('Cần kết nối máy chủ để lưu cấu hình lương an toàn.')
    }
    return runRemoteDomainCommand(
      'store_salary_config.set',
      payload,
      payload.idempotencyKey || `store-salary-config:${crypto.randomUUID()}`,
    )
  }

  const createCompensationEntry = async (payload = {}) => {
    requireCompensationOperator()
    return runRemoteDomainCommand(
      'compensation_entry.create',
      payload,
      payload.idempotencyKey || `compensation-entry:${crypto.randomUUID()}`,
    )
  }

  const approveCompensationEntry = async (payload = {}) => {
    requireCompensationOperator()
    return runRemoteDomainCommand(
      'compensation_entry.approve',
      payload,
      payload.idempotencyKey || `compensation-approval:${crypto.randomUUID()}`,
    )
  }

  const voidCompensationEntry = async (payload = {}) => {
    requireCompensationOperator()
    return runRemoteDomainCommand(
      'compensation_entry.void',
      payload,
      payload.idempotencyKey || `compensation-void:${crypto.randomUUID()}`,
    )
  }

  const requireWorkCatalogOperator = () => {
    const role = normalizeAuthRole(state.session?.role)
    if (!['admin', 'business_support'].includes(role)) {
      throw new Error('Chỉ Admin hoặc Nhân viên hỗ trợ KD được quản lý danh mục công việc và vi phạm.')
    }
    if (!apiRef.current.enabled) {
      throw new Error('Cần kết nối máy chủ để cập nhật danh mục an toàn.')
    }
  }

  const setWorkReward = async (payload = {}) => {
    const role = normalizeAuthRole(state.session?.role)
    if (!['employee', 'business_support'].includes(role)) {
      throw new Error('Chỉ nhân viên được tự ghi nhận công việc tính thưởng của mình.')
    }
    if (!apiRef.current.enabled) {
      throw new Error('Cần kết nối máy chủ để ghi nhận tiền thưởng an toàn.')
    }
    const result = await runRemoteDomainCommand(
      'work_reward.set',
      {
        attendanceId: payload.attendanceId,
        catalogItemId: payload.catalogItemId,
        checked: payload.checked === true,
        ...(payload.expectedEntityVersion == null ? {} : { expectedEntityVersion: payload.expectedEntityVersion }),
      },
      payload.idempotencyKey || `work-reward:${crypto.randomUUID()}`,
    )
    if (result?.reward) {
      setState((current) => {
        const progress = Array.isArray(current.workCatalogProgress) ? current.workCatalogProgress : []
        const entries = Array.isArray(current.compensationEntries) ? current.compensationEntries : []
        const rewardMatch = resolveRecordIdentifier(progress, result.reward.id)
        const entryMatch = result.entry ? resolveRecordIdentifier(entries, result.entry.id) : null
        if (rewardMatch.ambiguous || entryMatch?.ambiguous) return current
        const rewardExists = !rewardMatch.ambiguous && Boolean(rewardMatch.record)
        const entryExists = result.entry && !entryMatch.ambiguous && Boolean(entryMatch.record)
        return {
          ...current,
          workCatalogProgress: rewardExists
            ? progress.map((record) => record === rewardMatch.record ? result.reward : record)
            : [result.reward, ...progress],
          compensationEntries: !result.entry
            ? entries
            : entryExists
              ? entries.map((record) => record === entryMatch.record ? result.entry : record)
              : [result.entry, ...entries],
        }
      })
    }
    return result
  }

  const setWorkRewards = async (payload = {}) => {
    const role = normalizeAuthRole(state.session?.role)
    if (!['employee', 'business_support'].includes(role)) {
      throw new Error('Chỉ nhân viên được tự ghi nhận công việc tính thưởng của mình.')
    }
    if (!apiRef.current.enabled) {
      throw new Error('Cần kết nối máy chủ để ghi nhận tiền thưởng an toàn.')
    }
    const items = (Array.isArray(payload.items) ? payload.items : []).map((item) => ({
      catalogItemId: item.catalogItemId,
      checked: item.checked === true,
      ...(item.expectedEntityVersion == null ? {} : { expectedEntityVersion: item.expectedEntityVersion }),
    }))
    const result = await runRemoteDomainCommand(
      'work_reward.set_batch',
      { attendanceId: payload.attendanceId, items },
      payload.idempotencyKey || `work-reward-batch:${crypto.randomUUID()}`,
    )
    const rewards = Array.isArray(result?.rewards) ? result.rewards : []
    const entries = Array.isArray(result?.entries) ? result.entries : []
    const teamClaims = Array.isArray(result?.teamClaims) ? result.teamClaims : []
    if (rewards.length || entries.length || teamClaims.length) {
      setState((current) => {
        const mergeRecords = (records, updates) => {
          let next = Array.isArray(records) ? [...records] : []
          for (const update of updates) {
            const match = resolveRecordIdentifier(next, update?.id)
            if (match.ambiguous) return null
            next = match.record
              ? next.map((record) => record === match.record ? update : record)
              : [update, ...next]
          }
          return next
        }
        const nextProgress = mergeRecords(current.workCatalogProgress, rewards)
        const nextEntries = mergeRecords(current.compensationEntries, entries)
        const nextTeamClaims = mergeRecords(current.teamRewardClaims, teamClaims)
        if (!nextProgress || !nextEntries || !nextTeamClaims) return current
        return {
          ...current,
          workCatalogProgress: nextProgress,
          compensationEntries: nextEntries,
          teamRewardClaims: nextTeamClaims,
        }
      })
    }
    return result
  }

  const createWorkCatalogItem = async (payload = {}) => {
    requireWorkCatalogOperator()
    return runRemoteDomainCommand(
      'work_catalog.create',
      payload,
      payload.idempotencyKey || `work-catalog-create:${crypto.randomUUID()}`,
    )
  }

  const updateWorkCatalogItem = async (payload = {}) => {
    requireWorkCatalogOperator()
    return runRemoteDomainCommand(
      'work_catalog.update',
      payload,
      payload.idempotencyKey || `work-catalog-update:${crypto.randomUUID()}`,
    )
  }

  const deleteWorkCatalogItem = async (payload = {}) => {
    requireWorkCatalogOperator()
    return runRemoteDomainCommand(
      'work_catalog.delete',
      payload,
      payload.idempotencyKey || `work-catalog-delete:${crypto.randomUUID()}`,
    )
  }

  const restoreWorkCatalogItem = async (payload = {}) => {
    requireWorkCatalogOperator()
    return runRemoteDomainCommand(
      'work_catalog.restore',
      payload,
      payload.idempotencyKey || `work-catalog-restore:${crypto.randomUUID()}`,
    )
  }

  const createViolation = async (payload = {}) => {
    requireCompensationOperator(String(payload.targetUnit || ''))
    return runRemoteDomainCommand(
      'violation.create',
      payload,
      payload.idempotencyKey || `violation:${crypto.randomUUID()}`,
    )
  }

  const createViolationBatch = async (payload = {}) => {
    requireCompensationOperator(String(payload.targetUnit || ''))
    return runRemoteDomainCommand(
      'violation.create_batch',
      payload,
      payload.idempotencyKey || `violation-batch:${crypto.randomUUID()}`,
    )
  }

  const voidViolation = async (payload = {}) => {
    const violation = matchedRecordOrNull(resolveRecordIdentifier(state.violations, payload.id || payload.violationId))
    requireCompensationOperator(String(violation?.targetUnit || ''))
    return runRemoteDomainCommand(
      'violation.void',
      payload,
      payload.idempotencyKey || `violation-void:${crypto.randomUUID()}`,
    )
  }

  const calculateRevenueBonusDay = async (payload = {}) => {
    requireCompensationOperator()
    return runRemoteDomainCommand(
      'revenue_bonus.calculate_day',
      payload,
      payload.idempotencyKey || `revenue-bonus:${crypto.randomUUID()}`,
    )
  }

  const approveRevenueBonusMilestone = async (payload = {}) => {
    requireCompensationOperator()
    return runRemoteDomainCommand(
      'revenue_bonus.approve_milestone',
      payload,
      payload.idempotencyKey || `revenue-bonus-milestone-approve:${crypto.randomUUID()}`,
    )
  }

  const rejectRevenueBonusMilestone = async (payload = {}) => {
    requireCompensationOperator()
    return runRemoteDomainCommand(
      'revenue_bonus.reject_milestone',
      payload,
      payload.idempotencyKey || `revenue-bonus-milestone-reject:${crypto.randomUUID()}`,
    )
  }

  const addSalaryAdjustment = async (payload = {}) => {
    if (!isStoreWorkspaceRole(state.session?.role)) return { ok: false, message: 'Tài khoản không có quyền tạo khoản lương thưởng.' }
    const employeeMatch = resolveEmployeeIdentifier(state.employees, payload.employeeId)
    if (employeeMatch.ambiguous || employeeMatch.matches.length > 1) {
      return { ok: false, code: 'EMPLOYEE_IDENTIFIER_COLLISION', message: 'Không thể xác định nhân viên vì có mã trùng nhau khi không phân biệt chữ hoa/thường.' }
    }
    const employee = employeeMatch.record
    const amount = nonNegativeInteger(payload.amount)
    const period = payload.period || monthKey()
    if (!employee || amount <= 0) return { ok: false, message: 'Nhân viên hoặc số tiền chưa hợp lệ.' }
    const payrollMatches = state.payrollPeriods.filter((item) => (
      !item.supersededAt
      && item.period === period
      && sameIdentifier(item.storeId, employee.storeId)
    ))
    if (payrollMatches.length > 1) {
      return { ok: false, code: 'PAYROLL_PERIOD_IDENTIFIER_COLLISION', message: 'Không thể tạo khoản lương thưởng vì kỳ lương có mã cửa hàng trùng nhau khi không phân biệt chữ hoa/thường.' }
    }
    const payroll = payrollMatches[0] || null
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
      payrollPeriods: current.payrollPeriods.map((item) => item === payroll && item.status === 'Đã chốt' && !item.confirmedAt && !item.lockedAt ? { ...item, needsReclose: true, invalidatedAt: timestamp, invalidationReason: 'salary_adjustment.create' } : item),
      stateVersion: current.stateVersion + 1,
    }))
    notify(`Đã tạo khoản ${record.type.toLowerCase()}.`)
    return { ok: true, adjustment: record }
  }

  const getAvailableSalary = (employeeId, period = monthKey()) => localAvailableSalaryForEmployee(state, employeeId, period)

  const availableSalaryResult = (employeeId, period) => {
    try {
      return { ok: true, available: getAvailableSalary(employeeId, period) }
    } catch (error) {
      const message = error?.code === STORE_SALARY_CONFIG_IDENTIFIER_COLLISION
        ? 'Không thể tính lương khả dụng vì nhân viên có nhiều cấu hình lương trùng kỳ với mã chỉ khác chữ hoa/thường. Cần xử lý dữ liệu trùng trước khi thao tác ứng lương.'
        : error?.message || 'Không thể tính lương khả dụng của nhân viên.'
      return { ok: false, code: error?.code, message }
    }
  }

  const createSalaryAdvance = async (payload = {}) => {
    if (!isStoreWorkspaceRole(state.session?.role)) return { ok: false, message: 'Tài khoản không có quyền tạo ứng lương.' }
    const employeeMatch = resolveEmployeeIdentifier(state.employees, payload.employeeId)
    if (employeeMatch.ambiguous || employeeMatch.matches.length > 1) {
      const message = 'Không thể xác định nhân viên vì có mã trùng nhau khi không phân biệt chữ hoa/thường.'
      notify(message, 'info')
      return { ok: false, code: 'EMPLOYEE_IDENTIFIER_COLLISION', message }
    }
    const employee = employeeMatch.record
    const period = payload.period || monthKey()
    const amount = nonNegativeInteger(payload.amount)
    if (!employee) return { ok: false, message: 'Nhân viên chưa hợp lệ.' }
    const salaryResult = availableSalaryResult(employee.id, period)
    if (!salaryResult.ok) {
      notify(salaryResult.message, 'info')
      return salaryResult
    }
    const available = salaryResult.available
    if (amount <= 0 || amount >= available) return { ok: false, message: `Số tiền ứng phải lớn hơn 0 và nhỏ hơn lương khả dụng ${available.toLocaleString('vi-VN')}đ.` }
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
    const previousMatch = operationalIdentifierRecordMatch(state.salaryAdvances, id, (item) => [item.id])
    const previous = previousMatch.ambiguous ? null : previousMatch.record
    if (!previous || previous.status !== 'Mới tạo') return { ok: false, message: 'Chỉ khoản ứng mới tạo mới được chỉnh sửa.' }
    const salaryResult = availableSalaryResult(previous.employeeId, previous.period)
    if (!salaryResult.ok) {
      notify(salaryResult.message, 'info')
      return salaryResult
    }
    const availableWithoutCurrent = salaryResult.available
    const amount = nonNegativeInteger(payload.amount ?? previous.amount)
    if (amount <= 0 || amount >= availableWithoutCurrent) return { ok: false, message: 'Số tiền ứng phải nhỏ hơn lương khả dụng.' }
    if (apiRef.current.enabled) {
      try {
        const result = await runRemoteDomainCommand('salary_advance.update', {
          advanceId: previous.id,
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
    updateCollection('salaryAdvances', (items) => items.map((item) => item.id === previous.id ? next : item))
    notify('Đã cập nhật khoản ứng lương.')
    return { ok: true, advance: next }
  }

  const confirmSalaryAdvance = async (id) => {
    const previousMatch = operationalIdentifierRecordMatch(state.salaryAdvances, id, (item) => [item.id])
    const previous = previousMatch.ambiguous ? null : previousMatch.record
    if (!previous || previous.status !== 'Mới tạo') return { ok: false, message: 'Khoản ứng không còn ở trạng thái có thể xác nhận.' }
    const salaryResult = availableSalaryResult(previous.employeeId, previous.period)
    if (!salaryResult.ok) {
      notify(salaryResult.message, 'info')
      return salaryResult
    }
    const available = salaryResult.available
    if (previous.amount >= available) return { ok: false, message: 'Lương khả dụng đã thay đổi; vui lòng điều chỉnh số tiền ứng.' }
    if (apiRef.current.enabled) {
      try {
        const result = await runRemoteDomainCommand('salary_advance.confirm', { advanceId: previous.id })
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
    const expense = { id: uid('EXP'), storeId: previous.storeId, type: 'Ứng lương', category: 'payroll', amount: previous.amount, description: `Ứng lương ${previous.employeeName}`, sourceType: 'salary-advance', sourceId: previous.id, recognized: false, occurredAt: timestamp, createdAt: timestamp, createdBy: actor.id }
    const audit = { id: uid('AUD'), entity: 'salary-advance', entityId: previous.id, action: 'confirm', before: previous, after: confirmed, actor, createdAt: timestamp }
    setState((current) => ({ ...current, salaryAdvances: current.salaryAdvances.map((item) => item.id === previous.id ? confirmed : item), cashTransactions: [transaction, ...current.cashTransactions], expenseEntries: [expense, ...current.expenseEntries], auditLogs: [audit, ...current.auditLogs], stateVersion: current.stateVersion + 1 }))
    notify('Đã xác nhận chi ứng lương.')
    return { ok: true, advance: confirmed }
  }

  const closePayrollPeriod = async (storeId = state.activeStoreId, period = monthKey()) => {
    const storeMatch = resolveRecordIdentifier(state.stores, storeId)
    const scopedStore = matchedRecordOrNull(storeMatch)
    if (!scopedStore) return { ok: false, code: storeMatch.ambiguous ? 'STORE_IDENTIFIER_COLLISION' : 'STORE_NOT_FOUND', message: 'Không thể xác định cửa hàng của kỳ lương.' }
    const canonicalStoreId = scopedStore.id
    const payrollPeriodMatch = operationalIdentifierRecordMatch(
      state.payrollPeriods.filter((item) => item.period === period && !item.supersededAt),
      canonicalStoreId,
      (item) => [item.storeId],
    )
    if (payrollPeriodMatch.ambiguous) return { ok: false, code: 'PAYROLL_PERIOD_IDENTIFIER_COLLISION', message: 'Kỳ lương có nhiều bản ghi trùng cửa hàng; cần xử lý trước khi chốt.' }
    const existing = payrollPeriodMatch.record || null
    if (existing?.status === 'Đã khóa') return { ok: false, message: 'Kỳ lương đã khóa.' }
    if (apiRef.current.enabled) {
      try {
        const result = await runRemoteDomainCommand('payroll.close', { storeId: canonicalStoreId, period })
        notify(`Đã chốt sổ kỳ ${period}.`)
        return { ok: true, period: result.period }
      } catch (error) {
        notify(error.message || 'Không thể chốt kỳ lương.', 'info')
        return { ok: false, message: error.message }
      }
    }
    const employees = state.employees.filter((item) => (
      String(item.unit || 'store') === 'store'
      && operationalIdentifierReferenceMatchesRecord(state.stores, scopedStore, item.storeId)
      && item.status !== 'Đã nghỉ việc'
    ))
    if (hasOperationalIdentifierCollision(employees, employeeIdentifierValues)) {
      return { ok: false, code: 'EMPLOYEE_IDENTIFIER_COLLISION', message: 'Danh sách nhân viên của kỳ lương có mã trùng nhau khi không phân biệt chữ hoa/thường.' }
    }
    if (hasLocalPayrollReferenceCollision({ state, employees, store: scopedStore, period })) {
      return { ok: false, code: 'PAYROLL_REFERENCE_IDENTIFIER_COLLISION', message: 'Dữ liệu chấm công, điều chỉnh hoặc ứng lương có mã tham chiếu mơ hồ; cần xử lý trước khi chốt.' }
    }
    const employeeHours = employees.map((employee) => ({
      id: employee.id,
      role: 'employee',
      hours: localHomePayrollAttendance({
        attendance: state.attendance,
        employee,
        employees: state.employees,
        stores: state.stores,
        period,
      })
        .reduce((sum, record) => sum + Math.max(0, Number(record.hours) || 0), 0),
    }))
    const rows = employees.map((employee) => {
      const hours = employeeHours.find((item) => item.id === employee.id)?.hours || 0
      const employeeStore = matchedRecordOrNull(resolveRecordIdentifier(state.stores, employee.storeId))
      const { baseSalary, salaryConfig } = calculateLocalStoreEmployeeBasePay({
        state,
        employee,
        store: employeeStore,
        period,
        hours,
      })
      const gross = employeeGrossFor(state, employee.id, period)
      const advancesPaid = advancePaidFor(state, employee.id, period)
      return {
        employeeId: employee.id,
        employeeName: employee.name,
        hours,
        baseSalary,
        gross,
        advancesPaid,
        remaining: Math.max(0, gross - advancesPaid),
        salarySnapshot: {
          salary: employee.salary,
          monthlySalary: employee.monthlySalary,
          hourlyRate: employee.hourlyRate,
          baseSalary: employee.baseSalary,
          requiredMonthlyHours: employee.requiredMonthlyHours,
          standardWorkDays: employee.standardWorkDays,
          payBasis: salaryConfig ? 'tiered-hourly' : getPayBasis(employee),
          payFormula: salaryConfig ? 'STORE_FULL_TIME_TIERED' : employee.payFormula,
          salaryConfigSnapshot: salaryConfig ? { ...salaryConfig } : null,
          thresholdHours: salaryConfig?.thresholdHours,
          standardHourlyRateVnd: salaryConfig?.standardHourlyRateVnd,
          excessHourlyRateVnd: salaryConfig?.excessHourlyRateVnd,
          tiktokAllowance: employee.tiktokAllowance,
        },
      }
    })
    const timestamp = new Date().toISOString()
    const netPayrollExpense = rows.reduce((sum, row) => sum + nonNegativeInteger(row.gross), 0)
    const summary = buildLocalPayrollFinanceSnapshot({ state, storeId: canonicalStoreId, period, netPayrollExpense })
    const periodRecord = { id: existing?.id || uid('PAY'), storeId: canonicalStoreId, period, rows, financeSnapshot: summary, policySnapshot: clone(state.policies), status: 'Đã chốt', closedAt: timestamp, closedBy: actorSnapshot(state.session), confirmedAt: existing?.confirmedAt || null, lockedAt: null }
    const payrollAccrual = { id: `EXP-PAYROLL-${periodRecord.id}`, storeId: canonicalStoreId, type: 'Chi phí lương trong kỳ', category: 'payroll', amount: netPayrollExpense, description: `Chi phí lương kỳ ${period}`, sourceType: 'payroll-accrual', sourceId: periodRecord.id, recognized: true, period, occurredAt: timestamp, createdAt: timestamp, createdBy: state.session?.id || state.session?.code || 'SYSTEM' }
    setState((current) => ({
      ...current,
      payrollPeriods: [periodRecord, ...current.payrollPeriods.filter((item) => item !== existing)],
      expenseEntries: [payrollAccrual, ...current.expenseEntries.filter((entry) => !(entry.sourceType === 'payroll-accrual' && String(entry.sourceId) === String(periodRecord.id)))],
      stateVersion: current.stateVersion + 1,
    }))
    notify(`Đã chốt sổ kỳ ${period}.`)
    return { ok: true, period: periodRecord }
  }

  const confirmPayrollPayment = async (storeId = state.activeStoreId, period = monthKey()) => {
    const storeMatch = resolveRecordIdentifier(state.stores, storeId)
    const scopedStore = matchedRecordOrNull(storeMatch)
    if (!scopedStore) return { ok: false, code: storeMatch.ambiguous ? 'STORE_IDENTIFIER_COLLISION' : 'STORE_NOT_FOUND', message: 'Không thể xác định cửa hàng của kỳ lương.' }
    const canonicalStoreId = scopedStore.id
    const snapshotMatch = operationalIdentifierRecordMatch(
      state.payrollPeriods.filter((item) => item.period === period && !item.supersededAt),
      canonicalStoreId,
      (item) => [item.storeId],
    )
    if (snapshotMatch.ambiguous) return { ok: false, code: 'PAYROLL_PERIOD_IDENTIFIER_COLLISION', message: 'Kỳ lương có nhiều bản ghi trùng cửa hàng; cần xử lý trước khi chi.' }
    const snapshot = snapshotMatch.record || null
    if (snapshot?.confirmedAt) return { ok: false, message: 'Kỳ lương đã được xác nhận chi.' }
    if (apiRef.current.enabled) {
      if (!snapshot) return { ok: false, message: 'Cần chốt sổ trước khi xác nhận chi lương.' }
      try {
        const result = await runRemoteDomainCommand('payroll.pay', { storeId: canonicalStoreId, period })
        notify(`Đã xác nhận chi lương kỳ ${period}.`)
        return { ok: true, period: result.period, payments: result.payments || [] }
      } catch (error) {
        notify(error.message || 'Không thể xác nhận chi lương.', 'info')
        return { ok: false, message: error.message }
      }
    }
    const source = snapshot || (await closePayrollPeriod(canonicalStoreId, period)).period
    if (!source) return { ok: false, message: 'Không thể tạo số liệu kỳ lương.' }
    const timestamp = new Date().toISOString()
    const actor = actorSnapshot(state.session)
    const employeePayments = source.rows.filter((row) => row.remaining > 0).map((row) => ({ id: uid('PAYTX'), storeId: canonicalStoreId, period, employeeId: row.employeeId, employeeName: row.employeeName, amount: row.remaining, type: 'Lương nhân viên', createdAt: timestamp, actor }))
    const payments = employeePayments
    const expenses = payments.map((payment) => ({ id: uid('EXP'), storeId, type: payment.type, category: 'payroll', amount: payment.amount, description: `${payment.type} kỳ ${period}`, sourceType: 'payroll-payment', sourceId: payment.id, recognized: false, occurredAt: timestamp, createdAt: timestamp, createdBy: actor.id }))
    const transactions = payments.map((payment) => ({ id: uid('TXN'), storeId, type: payment.type, direction: 'out', amount: payment.amount, sourceType: 'payroll-payment', sourceId: payment.id, occurredAt: timestamp, createdAt: timestamp, actor }))
    const confirmed = { ...source, confirmedAt: timestamp, confirmedBy: actor, status: 'Đã chi' }
    setState((current) => ({ ...current, payrollPeriods: [confirmed, ...current.payrollPeriods.filter((item) => item !== snapshot)], payrollPayments: [...payments, ...current.payrollPayments], expenseEntries: [...expenses, ...current.expenseEntries], cashTransactions: [...transactions, ...current.cashTransactions], stateVersion: current.stateVersion + 1 }))
    notify(`Đã xác nhận chi lương kỳ ${period}.`)
    return { ok: true, payments }
  }

  const lockPayrollPeriod = async (storeId = state.activeStoreId, period = monthKey()) => {
    const storeMatch = resolveRecordIdentifier(state.stores, storeId)
    const scopedStore = matchedRecordOrNull(storeMatch)
    if (!scopedStore) return { ok: false, code: storeMatch.ambiguous ? 'STORE_IDENTIFIER_COLLISION' : 'STORE_NOT_FOUND', message: 'Không thể xác định cửa hàng của kỳ lương.' }
    const canonicalStoreId = scopedStore.id
    const previousMatch = operationalIdentifierRecordMatch(
      state.payrollPeriods.filter((item) => item.period === period && !item.supersededAt),
      canonicalStoreId,
      (item) => [item.storeId],
    )
    if (previousMatch.ambiguous) return { ok: false, code: 'PAYROLL_PERIOD_IDENTIFIER_COLLISION', message: 'Kỳ lương có nhiều bản ghi trùng cửa hàng; cần xử lý trước khi khóa.' }
    const previous = previousMatch.record || null
    if (!previous) return { ok: false, message: 'Cần chốt sổ trước khi khóa kỳ.' }
    if (previous.status === 'Đã khóa') return { ok: true, existing: true }
    if (apiRef.current.enabled) {
      try {
        const result = await runRemoteDomainCommand('payroll.lock', { storeId: canonicalStoreId, period })
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
    setState((current) => ({ ...current, payrollPeriods: current.payrollPeriods.map((item) => item === previous ? locked : item), auditLogs: [audit, ...current.auditLogs], stateVersion: current.stateVersion + 1 }))
    notify(`Đã khóa kỳ lương ${period}.`)
    return { ok: true, period: locked }
  }

  const createShiftDefinition = async (payload = {}) => {
    const name = String(payload.name || '').trim()
    if (!name || !payload.start || !payload.end) return { ok: false, message: 'Vui lòng nhập đủ tên và thời gian ca làm việc.' }
    const storeId = payload.storeId || state.activeStoreId
    const date = String(payload.date || '').trim()
    if (apiRef.current.enabled) {
      try {
        const result = await runRemoteDomainCommand('shift_definition.create', {
          storeId,
          name,
          start: payload.start,
          end: payload.end,
          ...(date ? { date } : {}),
        })
        notify('Đã tạo ca làm việc dùng chung.')
        return { ok: true, shift: result.shift }
      } catch (error) {
        notify(error.message || 'Không thể tạo ca làm việc.', 'info')
        return { ok: false, message: error.message }
      }
    }
    const colors = ['#22C55E', '#3B82F6', '#F97316', '#A855F7', '#EC4899', '#06B6D4', '#EAB308', '#EF4444']
    const durationMinutes = Math.max(0, Number(timeToMinutes(payload.end)) - Number(timeToMinutes(payload.start)))
    const definition = { id: uid('SHIFT'), storeId, name, start: payload.start, end: payload.end, time: `${payload.start} - ${payload.end}`, date: date || null, effectiveFrom: date || null, color: colors[state.shiftDefinitions.filter((shift) => shift.storeId === storeId && !shift.deletedAt).length % colors.length], tint: '#edf5ff', durationMinutes, durationHours: durationMinutes / 60, active: true, version: 1, createdAt: new Date().toISOString(), createdBy: actorSnapshot(state.session) }
    updateCollection('shiftDefinitions', (items) => [definition, ...items])
    notify('Đã tạo ca làm việc dùng chung.')
    return { ok: true, shift: definition }
  }

  const updateShiftDefinition = async (id, payload = {}) => {
    const previous = state.shiftDefinitions.find((item) => item.id === id)
    if (!previous) return { ok: false, message: 'Không tìm thấy ca làm việc.' }
    if (apiRef.current.enabled) {
      try {
        const result = await runRemoteDomainCommand('shift_definition.update', { shiftId: id, storeId: previous.storeId, ...payload })
        notify('Đã cập nhật ca; dữ liệu lịch sử giữ nguyên bản chụp cũ.')
        return { ok: true, shift: result.shift }
      } catch (error) {
        notify(error.message || 'Không thể cập nhật ca làm việc.', 'info')
        return { ok: false, message: error.message }
      }
    }
    const next = { ...previous, ...payload, time: `${payload.start || previous.start} - ${payload.end || previous.end}`, version: Number(previous.version || 1) + 1, updatedAt: new Date().toISOString(), updatedBy: actorSnapshot(state.session) }
    updateCollection('shiftDefinitions', (items) => items.map((item) => item.id === id ? next : item))
    notify('Đã cập nhật ca; dữ liệu lịch sử giữ nguyên bản chụp cũ.')
    return { ok: true, shift: next }
  }

  const deleteShiftDefinition = async (id) => {
    const previous = state.shiftDefinitions.find((item) => item.id === id)
    if (!previous) return { ok: false, message: 'Không tìm thấy ca làm việc.' }
    if (apiRef.current.enabled) {
      try {
        const result = await runRemoteDomainCommand('shift_definition.delete', { shiftId: id, storeId: previous.storeId })
        notify('Đã ngừng sử dụng ca làm việc.', 'info')
        return { ok: true, shift: result.shift }
      } catch (error) {
        notify(error.message || 'Không thể ngừng sử dụng ca làm việc.', 'info')
        return { ok: false, message: error.message }
      }
    }
    updateCollection('shiftDefinitions', (items) => items.map((item) => item.id === id ? { ...item, active: false, deletedAt: new Date().toISOString(), deletedBy: actorSnapshot(state.session) } : item))
    notify('Đã ngừng sử dụng ca làm việc.', 'info')
    return { ok: true }
  }

  const saveScheduleMultiple = async (employeeIds = [], shiftIds = [], details = {}) => {
    const date = details.date || today()
    if (!employeeIds.length || !shiftIds.length) return { ok: false, message: 'Vui lòng chọn ca và nhân viên.' }
    if (apiRef.current.enabled) {
      try {
        const result = await runRemoteDomainCommand('schedule.assign', {
          storeId: details.storeId || state.activeStoreId,
          date,
          employeeIds,
          shiftIds,
          note: details.note || '',
        })
        notify('Đã lưu lịch phân ca.')
        return { ok: true, assignments: result.assignments || [] }
      } catch (error) {
        notify(error.message || 'Không thể lưu lịch phân ca.', 'info')
        return { ok: false, message: error.message }
      }
    }
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

  const replaceScheduleDay = async (assignments = [], details = {}) => {
    const date = details.date || today()
    const storeId = details.storeId || state.activeStoreId || state.session?.storeId
    if (!storeId || !date || !Array.isArray(assignments)) {
      return { ok: false, message: 'Dữ liệu lịch phân ca không hợp lệ.' }
    }
    if (apiRef.current.enabled) {
      try {
        const result = await runRemoteDomainCommand('schedule.replace_day', {
          storeId,
          date,
          assignments: assignments.map((item) => ({
            id: item.id,
            employeeId: item.employeeId,
            shiftIds: item.shiftIds,
            note: item.note || '',
          })),
        })
        notify('Đã cập nhật lịch phân ca.')
        return { ok: true, assignments: result.assignments || [] }
      } catch (error) {
        notify(error.message || 'Không thể cập nhật lịch phân ca.', 'info')
        return { ok: false, message: error.message }
      }
    }
    updateCollection('schedule', (items) => {
      const now = new Date().toISOString()
      const nextDay = assignments.map((item) => {
        const previous = items.find((record) => (
          String(record.storeId || '') === String(storeId)
          && String(record.date || record.workDate || '') === String(date)
          && String(record.employeeId || '') === String(item.employeeId || '')
        ))
        const previousSnapshots = new Map((previous?.shiftSnapshots || []).map((snapshot) => [String(snapshot.id), snapshot]))
        const shiftSnapshots = (item.shiftIds || []).map((shiftId) => {
          if (previousSnapshots.has(String(shiftId))) return previousSnapshots.get(String(shiftId))
          const shift = state.shiftDefinitions.find((definition) => String(definition.id) === String(shiftId))
          return shift ? { id: shift.id, name: shift.name, start: shift.start, end: shift.end, color: shift.color, version: shift.version } : { id: shiftId }
        })
        return {
          ...previous,
          ...item,
          storeId,
          date,
          shiftId: item.shiftIds?.[0],
          shiftSnapshots,
          createdAt: previous?.createdAt || now,
          createdBy: previous?.createdBy || actorSnapshot(state.session),
          updatedAt: now,
          updatedBy: actorSnapshot(state.session),
        }
      })
      return [
        ...nextDay,
        ...items.filter((item) => !(
        String(item.storeId || '') === String(storeId)
        && String(item.date || item.workDate || '') === String(date)
        )),
      ]
    })
    notify('Đã cập nhật lịch phân ca.')
    return { ok: true, assignments }
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
    const goodsAmount = items.reduce((sum, item) => sum + Math.round((Number(item.weight) || 0) * (Number(item.price) || 0)), 0)
    const voucher = { id: uid('PV'), code: `PN-${voucherDate(timestamp)}-${String(sequence).padStart(4, '0')}`, storeId, items, goodsAmount, shippingAmount, relatedAmount, totalAmount: goodsAmount + shippingAmount + relatedAmount, status: 'Đã lưu', createdAt: timestamp, createdBy: actorSnapshot(state.session), idempotencyKey: payload.idempotencyKey || null }
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
    const goodsAmount = items.reduce((sum, item) => sum + Math.round((Number(item.weight) || 0) * (Number(item.price) || 0)), 0)
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

  const saveSupportTransfer = async (payload = {}) => {
    if (!canManageSupportTransfers(state.session?.role)) return { ok: false, message: 'Chỉ Admin hoặc Nhân viên Hỗ trợ KD được điều chuyển nhân sự.' }
    const employee = matchedRecordOrNull(resolveEmployeeIdentifier(state.employees, payload.employeeId))
    const fromStore = matchedRecordOrNull(resolveRecordIdentifier(state.stores, payload.fromStoreId))
    const toStore = matchedRecordOrNull(resolveRecordIdentifier(state.stores, payload.toStoreId))
    const employeeHomeStore = employee
      ? matchedRecordOrNull(resolveRecordIdentifier(state.stores, employee.storeId))
      : null
    if (!employee || !fromStore || !toStore || employeeHomeStore !== fromStore || fromStore === toStore) {
      return { ok: false, message: 'Nhân viên hoặc cửa hàng điều chuyển chưa hợp lệ.' }
    }
    const exactDateTimes = isVietnamDateTimeLocal(payload.startAt) && isVietnamDateTimeLocal(payload.endAt)
    const timeBounds = exactDateTimes ? supportTransferBounds(payload) : supportTransferBounds({
      fromDate: payload.fromDate,
      toDate: payload.toDate,
    })
    if (!timeBounds) {
      return { ok: false, message: 'Khoảng thời gian điều chuyển chưa hợp lệ.' }
    }
    const hourlySupportRate = nonNegativeInteger(payload.hourlySupportRate)
    const allowance = nonNegativeInteger(payload.allowance)
    if (hourlySupportRate <= 0) return { ok: false, message: 'Lương hỗ trợ theo giờ phải lớn hơn 0.' }
    const commandPayload = {
      employeeId: employee.id || employee.code,
      fromStoreId: fromStore.id,
      toStoreId: toStore.id,
      startAt: exactDateTimes ? payload.startAt : timeBounds.startAt,
      endAt: exactDateTimes ? payload.endAt : timeBounds.endAt,
      hourlySupportRate,
      allowance,
      note: String(payload.note || '').trim(),
    }
    if (apiRef.current.enabled) {
      try {
        const result = await runRemoteDomainCommand('support_transfer.create', commandPayload)
        const transfer = result.transfer
        if (!transfer) return { ok: false, message: 'Máy chủ không trả về phiếu điều chuyển.' }
        setState((current) => ({
          ...current,
          supportTransfers: current.supportTransfers.some((item) => item.id === transfer.id)
            ? current.supportTransfers.map((item) => item.id === transfer.id ? transfer : item)
            : [transfer, ...current.supportTransfers],
        }))
        notify('Đã lưu điều chuyển hỗ trợ.')
        return { ok: true, transfer }
      } catch (error) {
        notify(error.message || 'Không thể lưu điều chuyển hỗ trợ.', 'info')
        return { ok: false, message: error.message }
      }
    }
    const transfer = {
      id: uid('SUP'),
      ...commandPayload,
      startAt: timeBounds.startAt,
      endAt: timeBounds.endAt,
      fromDate: businessDate(timeBounds.startAt),
      toDate: businessDate(new Date(timeBounds.endMs - 1)),
      status: 'Đã lưu',
      createdAt: new Date().toISOString(),
      createdBy: actorSnapshot(state.session),
    }
    updateCollection('supportTransfers', (items) => [transfer, ...items])
    notify('Đã lưu điều chuyển hỗ trợ.')
    return { ok: true, transfer }
  }

  const updateSupportTransfer = async (transferId, payload = {}) => {
    if (!canManageSupportTransfers(state.session?.role)) return { ok: false, message: 'Chỉ Admin hoặc Nhân viên Hỗ trợ KD được sửa điều chuyển nhân sự.' }
    const previousMatch = operationalIdentifierRecordMatch(
      state.supportTransfers.filter((item) => !item.deletedAt),
      transferId,
      (item) => [item.id],
    )
    const previous = previousMatch.ambiguous ? null : previousMatch.record
    if (!previous) return { ok: false, message: 'Không tìm thấy phiếu điều chuyển.' }
    const employeeId = String(payload.employeeId ?? previous.employeeId ?? '')
    const fromStoreId = String(payload.fromStoreId ?? previous.fromStoreId ?? '')
    const toStoreId = String(payload.toStoreId ?? previous.toStoreId ?? '')
    const employeeMatch = resolveEmployeeIdentifier(state.employees, employeeId)
    const employee = employeeMatch.ambiguous ? null : employeeMatch.record
    const destinationStore = operationalIdentifierRecordMatch(state.stores, toStoreId, (store) => [store.id])
    if (!employee || !sameIdentifier(employee.storeId, fromStoreId)
      || destinationStore.ambiguous || !destinationStore.record || sameIdentifier(fromStoreId, toStoreId)) {
      return { ok: false, message: 'Nhân viên hoặc cửa hàng điều chuyển chưa hợp lệ.' }
    }
    const startAt = payload.startAt ?? previous.startAt
    const endAt = payload.endAt ?? previous.endAt
    const timeBounds = supportTransferBounds({ ...previous, startAt, endAt })
    if (!timeBounds) return { ok: false, message: 'Khoảng thời gian điều chuyển chưa hợp lệ.' }
    const hourlySupportRate = nonNegativeInteger(payload.hourlySupportRate ?? previous.hourlySupportRate)
    const allowance = nonNegativeInteger(payload.allowance ?? previous.allowance)
    if (hourlySupportRate <= 0) return { ok: false, message: 'Lương hỗ trợ theo giờ phải lớn hơn 0.' }
    const commandPayload = {
      transferId: previous.id,
      employeeId,
      fromStoreId,
      toStoreId,
      startAt: isVietnamDateTimeLocal(startAt) ? startAt : timeBounds.startAt,
      endAt: isVietnamDateTimeLocal(endAt) ? endAt : timeBounds.endAt,
      hourlySupportRate,
      allowance,
      note: String(payload.note ?? previous.note ?? '').trim(),
      status: String(payload.status ?? previous.status ?? 'Đã duyệt'),
    }
    if (apiRef.current.enabled) {
      try {
        const result = await runRemoteDomainCommand('support_transfer.update', commandPayload)
        const transfer = result.transfer
        if (!transfer) return { ok: false, message: 'Máy chủ không trả về phiếu điều chuyển.' }
        setState((current) => ({
          ...current,
          supportTransfers: current.supportTransfers.map((item) => item.id === transfer.id ? transfer : item),
        }))
        notify('Đã cập nhật điều chuyển hỗ trợ.')
        return { ok: true, transfer }
      } catch (error) {
        notify(error.message || 'Không thể cập nhật điều chuyển hỗ trợ.', 'info')
        return { ok: false, message: error.message }
      }
    }
    const transfer = {
      ...previous,
      ...commandPayload,
      startAt: timeBounds.startAt,
      endAt: timeBounds.endAt,
      fromDate: businessDate(timeBounds.startAt),
      toDate: businessDate(new Date(timeBounds.endMs - 1)),
      updatedAt: new Date().toISOString(),
      updatedBy: actorSnapshot(state.session),
    }
    updateCollection('supportTransfers', (items) => items.map((item) => item.id === transfer.id ? transfer : item))
    notify('Đã cập nhật điều chuyển hỗ trợ.')
    return { ok: true, transfer }
  }

  const deleteSupportTransfer = async (transferId, reasonValue = '') => {
    if (!canDeleteSupportTransfers(state.session?.role)) return { ok: false, message: 'Chỉ Admin được xóa lịch sử điều chuyển nhân sự.' }
    const previousMatch = operationalIdentifierRecordMatch(
      state.supportTransfers.filter((item) => !item.deletedAt),
      transferId,
      (item) => [item.id],
    )
    const previous = previousMatch.ambiguous ? null : previousMatch.record
    const reason = String(reasonValue || '').trim()
    if (!previous) return { ok: false, message: 'Không tìm thấy phiếu điều chuyển.' }
    if (!reason || reason.length > 500) return { ok: false, message: 'Lý do xóa phải có từ 1 đến 500 ký tự.' }
    if (apiRef.current.enabled) {
      try {
        const result = await runRemoteDomainCommand('support_transfer.delete', { transferId: previous.id, reason })
        const transfer = result.transfer
        if (!transfer) return { ok: false, message: 'Máy chủ không trả về phiếu điều chuyển.' }
        setState((current) => ({
          ...current,
          supportTransfers: current.supportTransfers.map((item) => item.id === transfer.id ? transfer : item),
        }))
        notify('Đã xóa điều chuyển hỗ trợ.', 'info')
        return { ok: true, transfer }
      } catch (error) {
        notify(error.message || 'Không thể xóa điều chuyển hỗ trợ.', 'info')
        return { ok: false, message: error.message }
      }
    }
    const timestamp = new Date().toISOString()
    const transfer = {
      ...previous,
      status: 'Đã xóa',
      deletedAt: timestamp,
      deletedBy: actorSnapshot(state.session),
      deleteReason: reason,
      updatedAt: timestamp,
    }
    updateCollection('supportTransfers', (items) => items.map((item) => item.id === transfer.id ? transfer : item))
    notify('Đã xóa điều chuyển hỗ trợ.', 'info')
    return { ok: true, transfer }
  }

  const restoreOperationalData = async (payload = {}) => {
    if (normalizeAuthRole(state.session?.role) !== 'admin') {
      return { ok: false, message: 'Chỉ Admin được khôi phục dữ liệu vận hành.' }
    }
    const dataType = String(payload.dataType || '')
    const requestedStoreId = String(payload.storeId || '')
    const fromDate = String(payload.fromDate || '').slice(0, 10)
    const toDate = String(payload.toDate || '').slice(0, 10)
    const requestedEmployeeId = String(payload.employeeId || '')
    const reason = String(payload.reason || '').trim()
    const storeMatch = resolveRecordIdentifier(state.stores, requestedStoreId)
    const scopedStore = matchedRecordOrNull(storeMatch)
    const employeeMatch = requestedEmployeeId ? resolveEmployeeIdentifier(state.employees, requestedEmployeeId) : null
    const scopedEmployee = requestedEmployeeId ? matchedRecordOrNull(employeeMatch) : null
    if (!['orders', 'attendance'].includes(dataType) || !scopedStore || (requestedEmployeeId && !scopedEmployee)) {
      return { ok: false, message: 'Loại dữ liệu hoặc cửa hàng chưa hợp lệ.' }
    }
    if (!/^\d{4}-\d{2}-\d{2}$/u.test(fromDate) || !/^\d{4}-\d{2}-\d{2}$/u.test(toDate) || fromDate > toDate) {
      return { ok: false, message: 'Khoảng ngày khôi phục chưa hợp lệ.' }
    }
    if (!reason || reason.length > 500) return { ok: false, message: 'Lý do khôi phục phải có từ 1 đến 500 ký tự.' }
    const storeId = scopedStore.id
    const employeeId = scopedEmployee?.id || scopedEmployee?.code || ''
    const commandPayload = { dataType, storeId, fromDate, toDate, ...(employeeId ? { employeeId } : {}), reason }
    if (apiRef.current.enabled) {
      try {
        const result = await runRemoteDomainCommand('operational_reset.restore', commandPayload)
        const restoredCount = Number(result.reset?.restoredCount ?? result.restoredCount ?? 0)
        notify(`Đã khôi phục ${restoredCount} bản ghi ${dataType === 'orders' ? 'đơn hàng' : 'chấm công'}.`)
        return { ok: true, ...result }
      } catch (error) {
        notify(error.message || 'Không thể khôi phục dữ liệu vận hành.', 'info')
        return { ok: false, message: error.message }
      }
    }

    const collection = dataType === 'orders' ? 'orders' : 'attendance'
    const collectionRecords = Array.isArray(state[collection]) ? state[collection] : []
    const sourceAudits = dataType === 'orders'
      ? state.orderAudit
      : (state.attendanceAudit?.length ? state.attendanceAudit : state.auditLogs)
    const entityNames = dataType === 'orders' ? new Set(['order', 'orders']) : new Set(['attendance'])
    const latestByEntity = new Map()
    sourceAudits.forEach((audit) => {
      const before = audit.before
      const scopedRecord = audit.after || before
      const entity = String(audit.entity || (dataType === 'orders' ? 'order' : 'attendance'))
      const entityId = String(audit.entityId || audit.orderId || audit.attendanceId || before?.id || '')
      const entityMatch = resolveRecordIdentifier(collectionRecords, entityId)
      const entityRecord = matchedRecordOrNull(entityMatch)
      const recordDate = String(scopedRecord?.date || scopedRecord?.workDate || scopedRecord?.createdAt || audit.createdAt || '').slice(0, 10)
      const recordStoreId = String(audit.storeId || scopedRecord?.storeId || '')
      const recordEmployeeId = String(scopedRecord?.employeeId || audit.employeeId || '')
      const employeeReferenceMatches = !scopedEmployee || matchedRecordOrNull(resolveEmployeeIdentifier(state.employees, recordEmployeeId)) === scopedEmployee
      if (!before || !entityRecord || audit.restoredAt || !isRestorableOperationalAuditAction(audit.action, dataType) || !entityId || !entityNames.has(entity) || !operationalIdentifierReferenceMatchesRecord(state.stores, scopedStore, recordStoreId) || recordDate < fromDate || recordDate > toDate || !employeeReferenceMatches) return
      const canonicalEntityId = String(entityRecord.id || '')
      const previousAudit = latestByEntity.get(canonicalEntityId)
      if (!previousAudit || String(audit.createdAt || '') > String(previousAudit.createdAt || '')) latestByEntity.set(canonicalEntityId, audit)
    })
    if (!latestByEntity.size) return { ok: false, message: 'Không có bản chỉnh sửa hoặc xóa nào phù hợp để khôi phục.' }
    const restorableEntries = [...latestByEntity.entries()].filter(([entityId]) => (
      Boolean(matchedRecordOrNull(resolveRecordIdentifier(collectionRecords, entityId)))
    ))
    if (!restorableEntries.length) return { ok: false, message: 'Bản ghi gốc không còn tồn tại để khôi phục an toàn.' }
    const restoredAt = new Date().toISOString()
    const actor = actorSnapshot(state.session)
    const restoredCount = restorableEntries.length
    setState((current) => {
      const currentRecords = Array.isArray(current[collection]) ? current[collection] : []
      const restoredById = new Map(restorableEntries.flatMap(([entityId, audit]) => {
        const currentRecord = matchedRecordOrNull(resolveRecordIdentifier(currentRecords, entityId))
        if (!currentRecord) return []
        const restored = {
          ...restoreOperationalRecordFields(currentRecord, audit.before, dataType),
          restoredAt,
          restoredBy: actor,
          restoreReason: reason,
          updatedAt: restoredAt,
          updatedBy: actor,
        }
        return [[String(entityId), restored]]
      }))
      const sourceAuditIds = new Set(restorableEntries.map(([, audit]) => String(audit.id || '')).filter(Boolean))
      const markedAudits = (items = []) => items.map((audit) => (
        sourceAuditIds.has(String(audit.id || '')) ? { ...audit, restoredAt, restoredBy: actor } : audit
      ))
      const resetHistory = {
        id: uid('OPR'),
        ...commandPayload,
        restoredCount,
        restoredIds: [...restoredById.keys()],
        createdAt: restoredAt,
        createdBy: actor,
      }
      return {
        ...current,
        [collection]: currentRecords.map((record) => restoredById.get(String(record.id)) || record),
        ...(dataType === 'orders' ? { orderAudit: markedAudits(current.orderAudit) } : { attendanceAudit: markedAudits(current.attendanceAudit) }),
        operationalResetHistory: [resetHistory, ...(current.operationalResetHistory || [])],
        auditLogs: [{ id: uid('AUD'), entity: 'operational-reset', entityId: `${dataType}:${storeId}`, action: 'Khôi phục', reason, details: { ...commandPayload, restoredCount }, actor, createdAt: restoredAt }, ...markedAudits(current.auditLogs)],
        stateVersion: current.stateVersion + 1,
      }
    })
    notify(`Đã khôi phục ${restoredCount} bản ghi ${dataType === 'orders' ? 'đơn hàng' : 'chấm công'}.`)
    return { ok: true, restoredCount }
  }

  const addAttendanceRecord = (payload) => {
    const record = { id: payload.id || uid('CC'), ...payload, deletedAt: null }
    updateCollection('attendance', (items) => [record, ...items])
    return record
  }

  const updateAttendance = async (id, payload = {}) => {
    if (!['admin', 'business_support'].includes(normalizeAuthRole(state.session?.role))) {
      notify('Tài khoản không có quyền chỉnh sửa chấm công.', 'info')
      return { ok: false, message: 'Tài khoản không có quyền chỉnh sửa chấm công.' }
    }
    const previousMatch = operationalIdentifierRecordMatch(state.attendance, id, (record) => [record.id])
    const previous = previousMatch.ambiguous ? null : previousMatch.record
    if (!previous) return { ok: false, message: 'Không tìm thấy bản ghi chấm công.' }
    const reason = String(payload.reason || '').trim()
    if (!reason || reason.length > 500) return { ok: false, message: 'Lý do chỉnh sửa phải có từ 1 đến 500 ký tự.' }
    const date = String(payload.date || payload.workDate || previous.date || previous.workDate || previous.checkInAt || '').trim().slice(0, 10)
    const checkIn = String(payload.checkIn ?? previous.checkIn ?? previous.checkInTime ?? '').slice(0, 5)
    const checkOut = String(payload.checkOut ?? previous.checkOut ?? previous.checkOutTime ?? '').slice(0, 5)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, message: 'Ngày chấm công không hợp lệ.' }
    if (!/^\d{2}:\d{2}$/.test(checkIn) || timeToMinutes(checkIn) == null) return { ok: false, message: 'Giờ vào không hợp lệ.' }
    if (checkOut && (!/^\d{2}:\d{2}$/.test(checkOut) || timeToMinutes(checkOut) == null)) return { ok: false, message: 'Giờ kết không hợp lệ.' }
    if ((previous.checkOut || previous.checkOutAt) && !checkOut) return { ok: false, message: 'Giờ kết không được để trống với ca đã kết thúc.' }

    const commandPayload = { attendanceId: previous.id, date, checkIn, checkOut, reason }
    if (apiRef.current.enabled) {
      try {
        const result = await runRemoteDomainCommand('attendance.update', commandPayload)
        if (!result.attendance) return { ok: false, message: 'Máy chủ không trả về bản ghi chấm công.' }
        setState((current) => ({
          ...current,
          attendance: current.attendance.map((record) => record.id === previous.id ? result.attendance : record),
        }))
        notify('Đã cập nhật chấm công và tính lại số giờ.')
        return { ok: true, attendance: result.attendance }
      } catch (error) {
        notify(error.message || 'Không thể cập nhật chấm công.', 'info')
        return { ok: false, message: error.message }
      }
    }

    const nextDate = (source) => {
      const parsed = new Date(`${source}T00:00:00.000Z`)
      parsed.setUTCDate(parsed.getUTCDate() + 1)
      return parsed.toISOString().slice(0, 10)
    }
    const checkInAt = `${date}T${checkIn}:00+07:00`
    const checkOutDate = checkOut && timeToMinutes(checkOut) < timeToMinutes(checkIn) ? nextDate(date) : date
    const checkOutAt = checkOut ? `${checkOutDate}T${checkOut}:00+07:00` : null
    const next = {
      ...previous,
      date,
      workDate: date,
      checkIn,
      checkInTime: checkIn,
      checkInAt,
      checkOut: checkOut || null,
      checkOutTime: checkOut || null,
      checkOutAt,
      editReason: reason,
      updatedAt: new Date().toISOString(),
    }
    next.hours = calculateWorkedHours(checkInAt, checkOutAt)
    next.arrivalTag = getArrivalTag(checkIn, next.shiftStart, state.policies.lateToleranceMinutes)
    next.departureTag = checkOut ? getDepartureTag(checkOut, next.shiftEnd, state.policies.lateToleranceMinutes) : 'Đang làm việc'
    next.punctuality = next.arrivalTag
    next.status = next.arrivalTag
    next.minutesLate = minutesLate(checkIn, next.shiftStart)
    const timestamp = new Date().toISOString()
    const actor = actorSnapshot(state.session)
    const changedFields = ATTENDANCE_CORRECTION_FIELDS.filter((field) => JSON.stringify(previous[field]) !== JSON.stringify(next[field]))
    const audit = {
      id: uid('ATA'),
      entity: 'attendance',
      entityId: previous.id,
      attendanceId: previous.id,
      storeId: previous.storeId,
      employeeId: previous.employeeId,
      action: 'Sửa',
      changedFields,
      reason,
      before: previous,
      after: next,
      actor,
      createdAt: timestamp,
    }
    setState((current) => ({
      ...current,
      attendance: current.attendance.map((record) => record.id === previous.id ? next : record),
      attendanceAudit: [audit, ...(current.attendanceAudit || [])],
      auditLogs: [audit, ...current.auditLogs],
      stateVersion: current.stateVersion + 1,
    }))
    notify('Đã cập nhật chấm công và tính lại số giờ.')
    return { ok: true, attendance: next }
  }

  const deleteAttendance = (id) => {
    if (state.session?.role !== 'admin') return false
    const previousMatch = operationalIdentifierRecordMatch(state.attendance, id, (record) => [record.id])
    const previous = previousMatch.ambiguous ? null : previousMatch.record
    if (!previous) return false
    const timestamp = new Date().toISOString()
    const actor = actorSnapshot(state.session)
    const next = { ...previous, deletedAt: timestamp, deletedBy: actor }
    const audit = { id: uid('AUD'), entity: 'attendance', entityId: previous.id, action: 'delete', before: previous, after: next, actor, createdAt: timestamp }
    setState((current) => ({ ...current, attendance: current.attendance.map((record) => record.id === previous.id ? next : record), auditLogs: [audit, ...current.auditLogs], stateVersion: current.stateVersion + 1 }))
    return true
  }

  const checkIn = async (payload = {}) => {
    const employeeId = payload.employeeId || state.session?.employeeId || state.session?.code
    const employeeMatch = resolveEmployeeIdentifier(state.employees, employeeId)
    const employee = employeeMatch.ambiguous ? null : employeeMatch.record
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
    const employeeUnitValue = employee.unit || employee.unitType || employee.department || employee.storeId
    const canonicalOfficeAttendance = isOfficeUnit(employeeUnitValue) || isBusinessSupportUnit(employeeUnitValue)
    const localAttendanceKey = canonicalOfficeAttendance ? attendanceClaimKey(employee.id, workDate) : ''
    const existing = state.attendance.find((record) => sameIdentifier(record.employeeId, employee.id) && !record.deletedAt && !record.checkOut && !record.checkOutAt)
    if (existing) {
      setState((current) => ({ ...current, activeAttendanceId: existing.id, checkedInAt: existing.checkIn || existing.checkInTime, finishedShift: false }))
      notify('Bạn đã điểm danh ca làm việc này.', 'info')
      return { ok: true, record: existing, existing: true }
    }
    if (canonicalOfficeAttendance && (
      localAttendanceCheckInClaimsRef.current.has(localAttendanceKey)
      || state.attendance.some((record) => (
        String(record.employeeId || '') === String(employee.id || '')
        && !record.deletedAt
        && attendanceRecordWorkDate(record) === workDate
      ))
    )) {
      const message = 'Bạn đã chấm công trong ngày hôm nay.'
      notify(message, 'info')
      return { ok: false, message }
    }

    const scheduled = state.shiftDefinitions.find((shift) => shift.id === payload.shiftId && shift.active !== false)
      || shifts.find((shift) => shift.id === payload.shiftId)
    const effectiveWorkingTime = canonicalOfficeAttendance
      ? resolveAttendanceWorkingTime(employee, workDate, state.supportWorkSchedules || [])
      : resolveEffectiveWorkingTime(employee, workDate)
    const requestedShiftId = payload.shiftId || payload.shift
    const attendanceWorkShifts = Array.isArray(effectiveWorkingTime.workShifts) ? effectiveWorkingTime.workShifts : []
    const canonicalSelection = canonicalOfficeAttendance && attendanceWorkShifts.length
      ? resolveAttendanceShiftSelection(effectiveWorkingTime, requestedShiftId)
      : null
    if (canonicalSelection?.requiresSelection) {
      const message = 'Vui lòng chọn ca làm việc hợp lệ trước khi điểm danh.'
      notify(message, 'info')
      return { ok: false, message }
    }
    const profileShift = canonicalSelection?.shift
      || attendanceWorkShifts.find((shift) => String(shift.id) === String(requestedShiftId || ''))
      || (!requestedShiftId && attendanceWorkShifts.length === 1 ? attendanceWorkShifts[0] : null)
    const canonicalShift = canonicalOfficeAttendance ? profileShift : null
    const shiftId = canonicalShift?.id || requestedShiftId || profileShift?.id || 'ca1'
    const shiftStart = canonicalShift?.start || payload.shiftStart || scheduled?.start || profileShift?.start || effectiveWorkingTime.workStart || (employee.unit === 'office' ? '08:00' : '07:00')
    const shiftEnd = canonicalShift?.end || payload.shiftEnd || scheduled?.end || profileShift?.end || effectiveWorkingTime.workEnd || (employee.unit === 'office' ? '17:00' : '12:00')
    const checkInTime = canonicalOfficeAttendance ? vietnamAttendanceTimeLabel(at) : timeLabel(at)
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
      requiredWorkingDaysSnapshot: Number(employee.monthlyWorkdayTargets?.[workDate.slice(0, 7)] || employee.standardWorkDays || 26),
      standardWorkDaysSnapshot: Number(employee.monthlyWorkdayTargets?.[workDate.slice(0, 7)] || employee.standardWorkDays || 26),
      shift: shiftId,
      shiftId,
      shiftName: canonicalShift?.name || scheduled?.name || profileShift?.name || payload.shiftName || shiftId,
      shiftStart,
      shiftEnd,
      checkIn: checkInTime,
      checkInTime,
      checkInAt: canonicalOfficeAttendance ? vietnamAttendanceDateTime(at) : localDateTime(at),
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
      workdayCredit: 0,
      note: arrivalTag === 'Đi trễ' ? 'Đi trễ so với giờ bắt đầu' : '',
    }
    if (canonicalOfficeAttendance) localAttendanceCheckInClaimsRef.current.add(localAttendanceKey)
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
    const attendanceMatch = resolveOpenAttendanceIdentifier(state.attendance, {
      employeeId: state.activeAttendanceId ? '' : employeeId,
      attendanceId: state.activeAttendanceId || '',
    })
    if (attendanceMatch.ambiguous) {
      const message = 'Không thể xác định lượt điểm danh đang mở vì có mã trùng nhau khi không phân biệt chữ hoa/thường.'
      notify(message, 'info')
      return { ok: false, code: 'ATTENDANCE_IDENTIFIER_COLLISION', message }
    }
    const openRecord = attendanceMatch.record
    if (!openRecord) {
      notify('Không tìm thấy lượt điểm danh đang mở.', 'info')
      return { ok: false }
    }
    const storeEmployeeAttendance = String(openRecord.unit || openRecord.unitType || 'store') === 'store'
      && !['OFFICE', 'BUSINESS_SUPPORT'].includes(String(openRecord.storeId || ''))
    const attendanceUnitValue = openRecord.unit || openRecord.unitType || openRecord.department || openRecord.storeId
    const canonicalOfficeAttendance = isOfficeUnit(attendanceUnitValue) || isBusinessSupportUnit(attendanceUnitValue)

    if (apiRef.current.enabled) {
      const rawLocation = payload.location || payload.coords || (
        payload.latitude != null || payload.lat != null ? payload : null
      )
      const proposedCommandPayload = {
        attendanceId: openRecord.id,
        location: rawLocation,
        ...(storeEmployeeAttendance ? {
          cashRevenue: nonNegativeInteger(payload.cashRevenue ?? payload.cash),
          transferRevenue: nonNegativeInteger(payload.transferRevenue ?? payload.transfer),
          incompleteTaskReason: String(payload.incompleteTaskReason || payload.incompleteReason || '').trim(),
        } : {}),
        ...(payload.expense == null ? {} : { expense: nonNegativeInteger(payload.expense) }),
        ...(payload.tiktok == null ? {} : { tiktok: Boolean(payload.tiktok) }),
      }
      const { location: _location, ...checkoutBusinessPayload } = proposedCommandPayload
      void _location
      const requestFingerprint = JSON.stringify(checkoutBusinessPayload)
      const requestKey = String(openRecord.id)
      const storedRequest = attendanceCheckoutRequests[requestKey]
      const explicitIdempotencyKey = String(payload.idempotencyKey || '')
      let request = storedRequest
      if (!storedRequest
        || storedRequest.fingerprint !== requestFingerprint
        || (explicitIdempotencyKey && storedRequest.idempotencyKey !== explicitIdempotencyKey)) {
        request = {
          fingerprint: requestFingerprint,
          idempotencyKey: explicitIdempotencyKey || `attendance-out:${crypto.randomUUID()}`,
          commandPayload: proposedCommandPayload,
        }
        setAttendanceCheckoutRequests((current) => ({ ...current, [requestKey]: request }))
      }
      try {
        const result = await runRemoteDomainCommand('attendance.check_out', request.commandPayload, request.idempotencyKey)
        setAttendanceCheckoutRequests((current) => {
          const { [requestKey]: _completed, ...remaining } = current
          void _completed
          return remaining
        })
        notify(finishMessage ? 'Đã kết ca và lưu thông tin chấm công.' : `Đã ghi nhận ra về lúc ${result.attendance.checkOut}.`)
        return { ok: true, record: result.attendance }
      } catch (error) {
        notify(error.message || 'Không thể ghi nhận ra về.', 'info')
        return { ok: false, message: error.message }
      }
    }

    const at = resolveDate(payload.at || payload.checkOutAt)
    const checkOutTime = canonicalOfficeAttendance ? vietnamAttendanceTimeLabel(at) : timeLabel(at)
    const rawLocation = payload.location || payload.coords || (
      payload.latitude != null || payload.lat != null ? payload : null
    )
    const location = normalizeLocation(rawLocation, openRecord.locationName || 'IDOSI')
    const departureTag = getDepartureTag(checkOutTime, openRecord.shiftEnd, payload.toleranceMinutes ?? state.policies.lateToleranceMinutes)
    const checkOutAt = canonicalOfficeAttendance ? vietnamAttendanceDateTime(at) : localDateTime(at)
    const hours = calculateWorkedHours(openRecord.checkInAt || openRecord.checkIn, checkOutAt)
    const attendanceReferenceMatches = (reference) => operationalIdentifierReferenceMatchesRecord(
      state.attendance,
      openRecord,
      reference,
    )
    const relatedOrders = state.orders.filter((order) => (
      !order.deletedAt
      && order.status !== 'Đã xóa'
      && sameIdentifier(order.employeeId, employeeId)
      && sameIdentifier(order.storeId, openRecord.storeId)
      && (
        attendanceReferenceMatches(order.attendanceId)
        || (!order.attendanceId
          && ((!String(order.shiftId || '').trim() && !String(openRecord.shiftId || openRecord.shift || '').trim())
            || sameIdentifier(order.shiftId, openRecord.shiftId || openRecord.shift))
          && Date.parse(order.createdAt) >= Date.parse(openRecord.checkInAt)
          && Date.parse(order.createdAt) <= at.getTime())
      )
    ))
    const expectedCashRevenue = relatedOrders.filter((order) => order.paymentMethod === 'Tiền mặt').reduce((sum, order) => sum + Number(order.amount || 0), 0)
    const expectedTransferRevenue = relatedOrders.filter((order) => order.paymentMethod === 'Chuyển khoản').reduce((sum, order) => sum + Number(order.amount || 0), 0)
    const cashRevenue = nonNegativeInteger(payload.cashRevenue ?? payload.cash)
    const transferRevenue = nonNegativeInteger(payload.transferRevenue ?? payload.transfer)
    const scopedTasks = storeTasksForAttendance({
      tasks: state.tasks,
      attendance: openRecord,
      attendanceRecords: state.attendance,
      employeeId,
      employees: state.employees,
      stores: state.stores,
      shiftDefinitions: state.shiftDefinitions,
      taskAssignmentHistory: state.taskAssignmentHistory,
    })
    const incompleteTasks = scopedTasks.filter((task) => {
      if (task.required === false) return false
      const completion = operationalIdentifierEntry(task.completedBy, employeeId)
      if (completion.ambiguous) return true
      return !(completion.found ? completion.value : task.done)
    })
    if (storeEmployeeAttendance && (cashRevenue !== expectedCashRevenue || transferRevenue !== expectedTransferRevenue)) {
      const message = `Doanh thu kết ca chưa khớp: tiền mặt ${expectedCashRevenue.toLocaleString('en-US')} đ, chuyển khoản ${expectedTransferRevenue.toLocaleString('en-US')} đ.`
      notify(message, 'info')
      return { ok: false, message, expectedCashRevenue, expectedTransferRevenue }
    }
    if (storeEmployeeAttendance && incompleteTasks.length) {
      const message = `Cần hoàn thành đủ ${incompleteTasks.length} công việc cố định còn lại trước khi kết ca.`
      notify(message, 'info')
      return { ok: false, message, incompleteTaskIds: incompleteTasks.map((task) => task.id) }
    }
    const recordedShiftExpense = state.expenseEntries
      .filter((entry) => entry.recognized !== false
        && attendanceReferenceMatches(entry.attendanceId)
        && String(entry.sourceType || '') === 'shift-expense-item')
      .reduce((total, entry) => total + nonNegativeInteger(entry.amount), 0)
    const checkoutShiftExpense = nonNegativeInteger(payload.expense)
    const updated = {
      ...openRecord,
      ...payload.details,
      checkOut: checkOutTime,
      checkOutTime,
      checkOutAt,
      checkOutLocation: location,
      departureTag,
      hours,
      workdayCredit: canonicalOfficeAttendance ? 1 : openRecord.workdayCredit,
      revenue: storeEmployeeAttendance ? expectedCashRevenue + expectedTransferRevenue : Number(payload.revenue ?? payload.totalRevenue ?? (Number(payload.cash || 0) + Number(payload.transfer || 0))) || Number(openRecord.revenue) || 0,
      expense: recordedShiftExpense + checkoutShiftExpense,
      shiftExpenseTotal: recordedShiftExpense + checkoutShiftExpense,
      cash: storeEmployeeAttendance ? expectedCashRevenue : Number(payload.cash) || Number(openRecord.cash) || 0,
      transfer: storeEmployeeAttendance ? expectedTransferRevenue : Number(payload.transfer) || Number(openRecord.transfer) || 0,
      orderCount: storeEmployeeAttendance ? relatedOrders.length : Number(openRecord.orderCount) || 0,
      incompleteTaskReason: '',
      incompleteTaskIds: incompleteTasks.map((task) => task.id),
      tiktok: Boolean(payload.tiktok ?? openRecord.tiktok),
      note: payload.note ?? openRecord.note,
    }
    setState((current) => {
      const currentAttendanceReferenceMatches = (reference) => operationalIdentifierReferenceMatchesRecord(
        current.attendance,
        openRecord,
        reference,
      )
      return {
        ...current,
        attendance: current.attendance.map((record) => String(record.id || '') === String(openRecord.id || '') ? updated : record),
        expenseEntries: checkoutShiftExpense > 0 && !current.expenseEntries.some((entry) => (
          entry.sourceType === 'shift-expense' && currentAttendanceReferenceMatches(entry.sourceId)
        ))
          ? [{ id: uid('EXP'), storeId: openRecord.storeId, type: 'Chi phí trong ca', category: 'shift', amount: checkoutShiftExpense, description: `Chi phí ${openRecord.shiftName || openRecord.shift}`, sourceType: 'shift-expense', sourceId: openRecord.id, attendanceId: openRecord.id, recognized: true, occurredAt: checkOutAt, createdAt: checkOutAt, createdBy: employeeId, employeeId, shiftId: openRecord.shift }, ...current.expenseEntries]
          : current.expenseEntries,
        cashTransactions: checkoutShiftExpense > 0 && !current.cashTransactions.some((entry) => (
          entry.sourceType === 'shift-expense' && currentAttendanceReferenceMatches(entry.sourceId)
        ))
          ? [{ id: uid('TXN'), storeId: openRecord.storeId, type: 'Chi phí trong ca', direction: 'out', amount: checkoutShiftExpense, sourceType: 'shift-expense', sourceId: openRecord.id, attendanceId: openRecord.id, occurredAt: checkOutAt, createdAt: checkOutAt, actor: actorSnapshot(current.session) }, ...current.cashTransactions]
          : current.cashTransactions,
        activeAttendanceId: null,
        checkedInAt: openRecord.checkIn || openRecord.checkInTime,
        finishedShift: true,
      }
    })
    notify(finishMessage ? 'Đã kết ca và lưu thông tin chấm công.' : `Đã ghi nhận ra về lúc ${checkOutTime}.`)
    return { ok: true, record: updated }
  }

  const checkOut = (payload = {}) => closeAttendance(payload, false)
  const finishShift = (payload = {}) => closeAttendance(payload, true)

  const resetDemo = async () => {
    if (state.session?.role !== 'admin') {
      notify('Chỉ Admin được Reset dữ liệu.', 'info')
      return { ok: false, message: 'Chỉ Admin được Reset dữ liệu.' }
    }
    const demoState = createInitialState()
    if (apiRef.current.enabled) {
      try {
        const result = await runRemoteDomainCommand('system.reset_demo', { state: sharedStateSnapshot(demoState) })
        notify('Đã khôi phục dữ liệu mẫu IDOSI.', 'info')
        return { ok: true, state: result.state }
      } catch (error) {
        notify(error.message || 'Không thể khôi phục dữ liệu mẫu.', 'info')
        return { ok: false, message: error.message }
      }
    }
    setState(demoState)
    notify('Đã khôi phục dữ liệu mẫu IDOSI.', 'info')
    return { ok: true, state: demoState }
  }

  const resetAllData = async () => {
    if (state.session?.role !== 'admin') {
      notify('Chỉ Admin được xóa toàn bộ dữ liệu hệ thống.', 'info')
      return { ok: false, message: 'Chỉ Admin được xóa toàn bộ dữ liệu hệ thống.' }
    }
    if (apiRef.current.enabled) {
      const payload = { confirmation: 'RESET_ALL_DATA' }
      const idempotencyKey = getOrCreateSystemResetIdempotencyKey(apiRef.current.systemResetIdempotencyKey)
      apiRef.current.systemResetIdempotencyKey = idempotencyKey
      const retryDelays = [250, 750, 1500]
      try {
        let result
        for (let attempt = 0; attempt <= retryDelays.length; attempt += 1) {
          try {
            result = await runRemoteDomainCommand('system.reset_all', payload, idempotencyKey)
            break
          } catch (error) {
            if (error.code !== 'RESET_CLEANUP_PENDING' || attempt === retryDelays.length) throw error
            await new Promise((resolve) => window.setTimeout(resolve, retryDelays[attempt]))
          }
        }
        clearSystemResetIdempotencyKey(idempotencyKey)
        apiRef.current.systemResetIdempotencyKey = null
        notify('Đã xóa toàn bộ dữ liệu và tài khoản; tài khoản Admin được giữ lại.')
        return { ok: true, ...result }
      } catch (error) {
        notify(error.message || 'Không thể xóa toàn bộ dữ liệu hệ thống.', 'info')
        return { ok: false, message: error.message }
      }
    }

    const clearedState = createLocalSystemResetState(state)
    setState(clearedState)
    notify('Đã xóa toàn bộ dữ liệu và tài khoản; tài khoản Admin được giữ lại.')
    return { ok: true, state: clearedState }
  }

  const selectedStoreId = state.session?.role === 'store_manager' || state.session?.role === 'employee'
    ? state.session.storeId
    : state.activeStoreId || state.session?.storeId
  const selectedStoreMatch = resolveRecordIdentifier(state.stores, selectedStoreId)
  const activeStore = selectedStoreMatch.ambiguous
    ? null
    : selectedStoreMatch.record
      || (state.session?.role === 'store_manager' || state.session?.role === 'employee' ? null : state.stores[0] || null)
  const currentEmployee = state.session?.employeeId
    ? matchedRecordOrNull(resolveEmployeeIdentifier(state.employees, state.session.employeeId))
    : null
  const revenueBonuses = revenueBonusView(state.revenueBonusDaily, state.revenueBonusAllocations)

  const value = {
    ...state,
    revenueBonuses,
    activeStore,
    currentEmployee,
    authReady: sessionRestoreReady,
    apiStatus,
    toast,
    notify,
    login,
    selectSessionRole,
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
    addBusinessSupport,
    updateBusinessSupport,
    deleteBusinessSupport,
    addStoreManager,
    updateStoreManager,
    deleteStoreManager,
    addOfficeAdjustment,
    updateOfficeAdjustment,
    deleteOfficeAdjustment,
    addImport,
    updateImport,
    deleteImport,
    setTaskDone,
    addShiftExpense,
    saveStoreTaskProgress,
    replaceTasks,
    assignSupportWork,
    updateSupportWork,
    saveBusinessSupportSchedule,
    deleteBusinessSupportSchedule,
    saveSchedule,
    changeAdminPassword,
    verifyCurrentPassword,
    saveSettings,
    createOrderInformationOption,
    updateOrderInformationOption,
    deleteOrderInformationOption,
    restoreOrderInformationOption,
    reorderOrderInformationOptions,
    createOrder,
    updateOrder,
    deleteOrder,
    readNotification,
    clearNotifications,
    savePolicies,
    addFixedExpense,
    updateFixedExpense,
    deleteFixedExpense,
    setStoreEmployeeSalaryConfig,
    createCompensationEntry,
    approveCompensationEntry,
    voidCompensationEntry,
    createWorkCatalogItem,
    updateWorkCatalogItem,
    deleteWorkCatalogItem,
    restoreWorkCatalogItem,
    setWorkReward,
    setWorkRewards,
    createViolation,
    createViolationBatch,
    voidViolation,
    calculateRevenueBonusDay,
    approveRevenueBonusMilestone,
    rejectRevenueBonusMilestone,
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
    replaceScheduleDay,
    createImportVoucher,
    updateImportVoucher,
    deleteImportVoucher,
    saveSupportTransfer,
    updateSupportTransfer,
    deleteSupportTransfer,
    restoreOperationalData,
    addAttendanceRecord,
    updateAttendance,
    deleteAttendance,
    checkIn,
    checkOut,
    clockIn: checkIn,
    clockOut: checkOut,
    finishShift,
    resetDemo,
    resetAllData,
  }

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

export const useApp = () => {
  const context = useContext(AppContext)
  if (!context) throw new Error('useApp must be used inside AppProvider')
  return context
}
