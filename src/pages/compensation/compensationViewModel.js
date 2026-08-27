import { canonicalViolationTargetUnit } from '../../domain/violationTargetUnit'

const normalize = (value) => String(value ?? '').trim().toLowerCase()

export const canonicalRole = (role) => normalize(role) === 'manager' ? 'business_support' : normalize(role)

export const entityId = (entity) => String(entity?.id || entity?.code || entity?.employeeId || '').trim()

export const entryEmployeeId = (entry) => String(
  entry?.employeeId || entry?.targetEmployeeId || entry?.employee?.id || entry?.employee?.code || '',
).trim()

export const entryStoreId = (entry) => String(entry?.storeId || entry?.targetStoreId || '').trim()

export const entryAmount = (entry) => Number(
  entry?.amountVnd ?? entry?.amount ?? entry?.totalAmountVnd ?? entry?.totalAmount ?? 0,
) || 0

export const entryDate = (entry) => String(
  entry?.effectiveDate || entry?.occurredOn || entry?.businessDate || entry?.date || entry?.createdAt || '',
).slice(0, 10)

export const entryType = (entry) => String(entry?.type || entry?.kind || entry?.category || '').trim().toUpperCase()

export const isVoided = (entry) => Boolean(
  entry?.voidedAt || entry?.deletedAt || ['VOID', 'VOIDED', 'CANCELLED', 'ĐÃ HỦY'].includes(String(entry?.status || '').trim().toUpperCase()),
)

export const isApproved = (entry) => {
  const status = normalize(entry?.status)
  return Boolean(entry?.approvedAt) || ['approved', 'confirmed', 'đã duyệt', 'đã xác nhận', 'active'].includes(status)
}

export const isRejected = (entry) => Boolean(entry?.rejectedAt)
  || ['rejected', 'đã từ chối'].includes(normalize(entry?.status))

export const typeLabel = (type) => ({
  MANUAL: 'Thưởng thủ công',
  ALLOWANCE: 'Phụ cấp',
  REVENUE: 'Thưởng doanh thu',
  WORK: 'Thưởng công việc',
}[String(type || '').toUpperCase()] || String(type || 'Khoản ghi nhận'))

export const statusLabel = (entry) => {
  if (isVoided(entry)) return 'Đã hủy'
  if (isRejected(entry)) return 'Đã từ chối'
  if (isApproved(entry)) return 'Đã duyệt'
  return normalize(entry?.status) === 'pending' ? 'Chờ duyệt' : String(entry?.status || 'Chờ duyệt')
}

export const statusTone = (entry) => isVoided(entry) || isRejected(entry) ? 'red' : isApproved(entry) ? 'green' : 'orange'

const INTERNAL_STORE_IDS = new Set(['OFFICE', 'BUSINESS_SUPPORT', 'ADMIN', 'SYSTEM'])
const INACTIVE_STORE_STATUSES = new Set([
  'đã đóng', 'ngưng hoạt động', 'ngừng hoạt động', 'tạm ngưng', 'inactive', 'closed',
])

export const operationalStores = (stores = []) => stores.filter((store) => {
  const id = entityId(store).toUpperCase()
  if (!id || INTERNAL_STORE_IDS.has(id) || store?.deletedAt
    || store?.active === false || store?.isOperational === false) return false
  return !INACTIVE_STORE_STATUSES.has(normalize(store?.status))
})

export const storesVisibleToRole = (stores = [], session = {}) => {
  const list = operationalStores(stores)
  const role = canonicalRole(session?.role)
  if (['admin', 'business_support'].includes(role)) return list
  const storeId = String(session?.storeId || '').trim()
  return list.filter((store) => entityId(store) === storeId)
}

export const employeeUnit = (employee = {}) => {
  const unit = normalize(employee?.unit || employee?.unitType || employee?.department)
  if (['business_support', 'business-support', 'support', 'htkd'].includes(unit)) return 'business_support'
  if (['office', 'back_office', 'kvp', 'văn phòng', 'khối văn phòng'].includes(unit)) return 'office'
  return 'store'
}

export const activeEmployees = (employees = []) => employees.filter((employee) => (
  !employee?.deletedAt && !['đã nghỉ việc', 'inactive'].includes(normalize(employee?.status))
))

export const employeesForTarget = ({ employees = [], targetUnit = 'store', storeId = '' } = {}) => (
  activeEmployees(employees).filter((employee) => {
    if (employeeUnit(employee) !== targetUnit) return false
    return targetUnit !== 'store' || String(employee?.storeId || '') === String(storeId || '')
  })
)

export const managerCandidates = ({ employees = [], managerAccounts = [], storeId = '' } = {}) => {
  const linkedManagerIds = new Set(managerAccounts
    .filter((account) => !account?.deletedAt && (!storeId || String(account?.storeId || '') === String(storeId)))
    .map((account) => String(account?.employeeId || '').trim())
    .filter(Boolean))
  return activeEmployees(employees).filter((employee) => {
    if (storeId && String(employee?.storeId || '') !== String(storeId)) return false
    const roles = Array.isArray(employee?.roles) ? employee.roles.map(normalize) : []
    const position = normalize(employee?.position)
    return employee?.isStoreManager === true
      || roles.includes('store_manager')
      || linkedManagerIds.has(entityId(employee))
      || position.includes('quản lý cửa hàng')
  })
}

export const targetUnitOfViolation = canonicalViolationTargetUnit

export const revenueRecordDate = (record) => String(
  record?.businessDate || record?.date || record?.calculationDate || record?.createdAt || '',
).slice(0, 10)

export const revenueRecordTotal = (record) => Number(
  record?.totalPoolVnd ?? record?.poolVnd ?? record?.bonusPoolVnd
  ?? ((Number(record?.percentagePoolVnd || 0) || 0) + (Number(record?.milestonePoolVnd || record?.hotPoolVnd || 0) || 0)),
) || 0

export const revenueAllocations = (records = []) => records.flatMap((record) => {
  const nested = Array.isArray(record?.allocations) ? record.allocations : []
  if (nested.length) return nested.map((allocation) => ({
    ...allocation,
    storeId: allocation.storeId || record.storeId,
    businessDate: allocation.businessDate || record.businessDate || record.date,
    calculationId: allocation.calculationId || record.id,
  }))
  return entryEmployeeId(record) ? [record] : []
})

export const samePeriod = (entry, period) => !period || entryDate(entry).startsWith(period)

const payrollActiveStatuses = new Set([
  'active',
  'approved',
  'confirmed',
  'đang áp dụng',
  'đã duyệt',
  'đã xác nhận',
])

const activePayrollRecord = (entry) => (
  !isVoided(entry)
  && !isRejected(entry)
  && (Boolean(entry?.approvedAt) || payrollActiveStatuses.has(normalize(entry?.status)))
)

const safePayrollAmount = (entry) => {
  const amount = entryAmount(entry)
  return Number.isSafeInteger(amount) && amount >= 0 ? amount : 0
}

/**
 * Mirrors the canonical server payroll buckets for Release A compensation
 * records. Legacy salary adjustments remain a separate compatibility source
 * and are intentionally not folded into this view model.
 */
export const payrollCompensationTotalsForEmployee = ({
  compensationEntries = [],
  revenueBonusAllocations = [],
  violations = [],
  employeeId = '',
  period = '',
} = {}) => {
  const totals = { manual: 0, work: 0, allowance: 0, revenue: 0, violations: 0 }
  const belongsToPeriod = (entry) => (
    entryEmployeeId(entry) === String(employeeId || '')
    && samePeriod(entry, period)
    && activePayrollRecord(entry)
  )

  compensationEntries.filter(belongsToPeriod).forEach((entry) => {
    const type = entryType(entry)
    const bucket = type === 'WORK' ? 'work' : type === 'ALLOWANCE' ? 'allowance' : type === 'REVENUE' ? 'revenue' : 'manual'
    totals[bucket] += safePayrollAmount(entry)
  })
  revenueBonusAllocations.filter((entry) => (
    belongsToPeriod(entry) && normalize(entry.status) === 'confirmed'
  )).forEach((entry) => {
    totals.revenue += safePayrollAmount(entry)
  })
  violations.filter(belongsToPeriod).forEach((entry) => {
    totals.violations += safePayrollAmount(entry)
  })

  return totals
}

export const safeErrorMessage = (error, fallback = 'Không thể hoàn tất thao tác. Vui lòng thử lại.') => {
  const message = String(error?.userMessage || error?.message || '').trim()
  if (!message || /stack|sql|d1|sqlite|constraint|internal server/iu.test(message)) return fallback
  return message.slice(0, 180)
}
