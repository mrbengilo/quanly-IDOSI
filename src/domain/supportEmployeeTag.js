import { supportTransferBounds } from './supportTransferTime'

export const SUPPORT_EMPLOYEE_TAG_EFFECTIVE_DATE = '2026-09-01'

const VIETNAM_DATE_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Ho_Chi_Minh',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

const CANCELLED_TRANSFER_STATUSES = new Set([
  'CANCELLED',
  'CANCELED',
  'VOID',
  'VOIDED',
  'ĐÃ HỦY',
  'DA HUY',
  'ĐÃ XÓA',
  'DA XOA',
])

const compact = (value) => String(value ?? '').trim()
const folded = (value) => compact(value).toLocaleLowerCase('en-US')
const sameIdentifier = (left, right) => Boolean(compact(left) && folded(left) === folded(right))

const dateFromInstant = (value) => {
  const instant = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(instant.getTime())) return ''
  const parts = Object.fromEntries(VIETNAM_DATE_FORMATTER.formatToParts(instant)
    .filter((part) => part.type !== 'literal')
    .map((part) => [part.type, part.value]))
  return `${parts.year}-${parts.month}-${parts.day}`
}

export const supportEmployeeBusinessDate = (value) => {
  const source = compact(value)
  const direct = source.match(/^(\d{4}-\d{2}-\d{2})/u)
  if (direct) return direct[1]
  return source ? dateFromInstant(source) : ''
}

const recordBusinessDate = (record = {}) => supportEmployeeBusinessDate(
  record.businessDate
  || record.workDate
  || record.attendanceDate
  || record.effectiveDate
  || record.occurredOn
  || record.date
  || record.occurredAt
  || record.checkInAt
  || record.createdAt,
)

const employeeIdentifiers = (employee = {}) => [
  employee.id,
  employee.code,
  employee.employeeId,
  employee.employeeCode,
].map(compact).filter(Boolean)

const storeIdentifiers = (store = {}) => [store.id, store.code].map(compact).filter(Boolean)
const transferIdentifiers = (transfer = {}) => [
  transfer.id,
  transfer.transferId,
  transfer.supportTransferId,
].map(compact).filter(Boolean)

const resolveUnique = (records = [], reference, identifiersOf) => {
  const requested = compact(reference)
  if (!requested) return null
  const candidates = Array.isArray(records) ? records : []
  const exact = candidates.filter((record) => identifiersOf(record).includes(requested))
  if (exact.length === 1) return exact[0]
  if (exact.length > 1) return null
  const normalized = folded(requested)
  const matches = candidates.filter((record) => identifiersOf(record).some((identifier) => folded(identifier) === normalized))
  return matches.length === 1 ? matches[0] : null
}

const transferEmployeeId = (record = {}) => compact(
  record.employeeId || record.employeeCode || record.staffId,
)

const transferHomeStoreId = (record = {}) => compact(
  record.fromStoreId || record.homeStoreId || record.sourceStoreId || record.originStoreId,
)

const transferSupportStoreId = (record = {}) => compact(
  record.toStoreId || record.supportStoreId || record.destinationStoreId || record.targetStoreId,
)

const transferAvailableForHistory = (record = {}) => {
  if (record.deletedAt || record.voidedAt) return false
  const status = compact(record.status).toLocaleUpperCase('vi-VN')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/gu, '')
  return !CANCELLED_TRANSFER_STATUSES.has(status)
}

const transferOverlapsDateIncludingCompleted = (record, businessDate) => {
  if (!transferAvailableForHistory(record) || !businessDate) return false
  const bounds = supportTransferBounds(record)
  if (!bounds) return false
  const dayStart = Date.parse(`${businessDate}T00:00:00+07:00`)
  const next = new Date(`${businessDate}T00:00:00+07:00`)
  next.setUTCDate(next.getUTCDate() + 1)
  const dayEnd = next.getTime()
  return Number.isFinite(dayStart) && Number.isFinite(dayEnd)
    && bounds.startMs < dayEnd
    && bounds.endMs > dayStart
}

const nestedSupport = (record = {}) => (
  record.supportCompensation
  || record.compensation?.support
  || record.supportAssignment
  || record.supportContext
  || {}
)

const explicitTransferReferences = (record = {}) => {
  const support = nestedSupport(record)
  return [...new Set([
    record.supportTransferId,
    record.transferId,
    record.activeTransferId,
    support.transferId,
    ...(Array.isArray(record.supportTransferIds) ? record.supportTransferIds : []),
    ...(Array.isArray(support.transferIds) ? support.transferIds : []),
  ].map(compact).filter(Boolean))]
}

const recordEmployeeId = (record = {}) => compact(
  record.employeeId || record.employeeCode || record.staffId || record.userId,
)

const recordStoreId = (record = {}) => {
  const support = nestedSupport(record)
  return compact(
    record.supportStoreId
    || support.supportStoreId
    || record.destinationStoreId
    || record.storeId
    || record.payrollStoreId,
  )
}

const explicitHomeStoreId = (record = {}) => {
  const support = nestedSupport(record)
  return compact(
    record.employeeHomeStoreId
    || record.supportHomeStoreId
    || record.homeStoreId
    || support.homeStoreId
    || record.sourceStoreId,
  )
}

const explicitHomeStoreName = (record = {}) => {
  const support = nestedSupport(record)
  return compact(
    record.employeeHomeStoreName
    || record.supportHomeStoreName
    || record.homeStoreName
    || support.homeStoreName,
  )
}

const explicitSupportStoreName = (record = {}) => {
  const support = nestedSupport(record)
  return compact(
    record.supportStoreName
    || record.destinationStoreName
    || support.supportStoreName
    || record.storeName
    || record.payrollStoreName,
  )
}

const recordExplicitlyMarksSupport = (record = {}) => {
  const support = nestedSupport(record)
  return Boolean(
    record.supportTransferred === true
    || record.isSupportEmployee === true
    || support.isSupportEmployee === true
    || record.supportTransferId
    || support.transferId
    || record.supportStoreId
    || support.supportStoreId
    || explicitTransferReferences(record).length,
  )
}

const matchingTransfers = ({ supportTransfers, employeeId, storeId, businessDate }) => (
  (Array.isArray(supportTransfers) ? supportTransfers : []).filter((transfer) => (
    transferAvailableForHistory(transfer)
    && sameIdentifier(transferEmployeeId(transfer), employeeId)
    && sameIdentifier(transferSupportStoreId(transfer), storeId)
    && transferOverlapsDateIncludingCompleted(transfer, businessDate)
  ))
)

/**
 * Canonical support-employee tag context.
 *
 * The tag is intentionally presentation-only: it never changes attendance,
 * payroll or bonus calculations. Historical records before 01/09/2026 remain
 * untagged, while completed transfers can still label records on/after cutover.
 */
export function resolveSupportEmployeeTagContext({
  record = {},
  employee = null,
  employeeId = '',
  storeId = '',
  businessDate = '',
  employees = [],
  stores = [],
  supportTransfers = [],
} = {}) {
  const date = supportEmployeeBusinessDate(businessDate) || recordBusinessDate(record)
  if (!date || date < SUPPORT_EMPLOYEE_TAG_EFFECTIVE_DATE) return null

  const employeeReference = compact(employeeId) || recordEmployeeId(record)
  const resolvedEmployee = employee || resolveUnique(employees, employeeReference, employeeIdentifiers)
  const canonicalEmployeeId = employeeIdentifiers(resolvedEmployee)[0] || employeeReference
  const operationalStoreId = compact(storeId) || recordStoreId(record)
  if (!canonicalEmployeeId || !operationalStoreId) return null

  const transferReferences = explicitTransferReferences(record)
  const referencedTransfers = transferReferences
    .map((reference) => resolveUnique(supportTransfers, reference, transferIdentifiers))
    .filter(Boolean)
    .filter((transfer, index, records) => records.indexOf(transfer) === index)
  const inferredTransfers = matchingTransfers({
    supportTransfers,
    employeeId: canonicalEmployeeId,
    storeId: operationalStoreId,
    businessDate: date,
  })
  const transfer = referencedTransfers.length === 1
    ? referencedTransfers[0]
    : referencedTransfers.length > 1
      ? null
      : inferredTransfers.length === 1
        ? inferredTransfers[0]
        : null

  const homeStoreId = explicitHomeStoreId(record)
    || transferHomeStoreId(transfer)
    || compact(resolvedEmployee?.homeStoreId)
    || compact(resolvedEmployee?.storeId)
  const supportStoreId = recordStoreId(record)
    || transferSupportStoreId(transfer)
    || operationalStoreId
  const supportEvidence = recordExplicitlyMarksSupport(record)
    || Boolean(transfer)
    || Boolean(homeStoreId && supportStoreId && !sameIdentifier(homeStoreId, supportStoreId)
      && inferredTransfers.length === 1)

  if (!supportEvidence || !homeStoreId || !supportStoreId || sameIdentifier(homeStoreId, supportStoreId)) return null
  if (!sameIdentifier(supportStoreId, operationalStoreId)) return null

  const homeStore = resolveUnique(stores, homeStoreId, storeIdentifiers)
  const supportStore = resolveUnique(stores, supportStoreId, storeIdentifiers)
  return {
    employeeId: canonicalEmployeeId,
    businessDate: date,
    homeStoreId,
    homeStoreName: explicitHomeStoreName(record)
      || compact(transfer?.fromStoreName)
      || compact(transfer?.homeStoreName)
      || compact(homeStore?.name)
      || homeStoreId,
    supportStoreId,
    supportStoreName: explicitSupportStoreName(record)
      || compact(transfer?.toStoreName)
      || compact(transfer?.supportStoreName)
      || compact(supportStore?.name)
      || supportStoreId,
    transferId: transferIdentifiers(transfer)[0] || transferReferences[0] || '',
  }
}
