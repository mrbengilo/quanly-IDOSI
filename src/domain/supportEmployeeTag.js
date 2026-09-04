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
  'DELETED',
  'DA HUY',
  'DA XOA',
])

const compact = (value) => String(value ?? '').trim()
const folded = (value) => compact(value).toLocaleLowerCase('en-US')
const sameIdentifier = (left, right) => Boolean(compact(left) && folded(left) === folded(right))
const safeRecord = (value) => value && typeof value === 'object' ? value : {}

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

const recordBusinessDate = (record) => {
  const source = safeRecord(record)
  return supportEmployeeBusinessDate(
    source.businessDate
    || source.workDate
    || source.attendanceDate
    || source.effectiveDate
    || source.occurredOn
    || source.date
    || source.occurredAt
    || source.checkInAt
    || source.createdAt,
  )
}

const employeeIdentifiers = (employee) => {
  const source = safeRecord(employee)
  return [
    source.id,
    source.code,
    source.employeeId,
    source.employeeCode,
  ].map(compact).filter(Boolean)
}

const storeIdentifiers = (store) => {
  const source = safeRecord(store)
  return [source.id, source.code].map(compact).filter(Boolean)
}

const normalizedEmployeePrefix = (value) => compact(value)
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/gu, '')
  .replace(/[^A-Za-z0-9]/gu, '')
  .toLocaleLowerCase('en-US')

const employeeCodePrefix = (value) => {
  const match = compact(value).match(/^(.+?)[\s_-]+\d+$/u)
  return match ? normalizedEmployeePrefix(match[1]) : ''
}

const storeEmployeePrefixes = (store) => {
  const source = safeRecord(store)
  return [source.employeePrefix, source.employeeCodePrefix, source.staffPrefix]
    .map(normalizedEmployeePrefix)
    .filter(Boolean)
}

const storeFromEmployeeCode = (stores, employeeReference) => {
  const prefix = employeeCodePrefix(employeeReference)
  if (!prefix) return null
  const matches = (Array.isArray(stores) ? stores : []).filter((store) => (
    storeEmployeePrefixes(store).includes(prefix)
  ))
  return matches.length === 1 ? matches[0] : null
}

const transferIdentifiers = (transfer) => {
  const source = safeRecord(transfer)
  return [source.id, source.transferId, source.supportTransferId].map(compact).filter(Boolean)
}

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

const transferEmployeeId = (record) => {
  const source = safeRecord(record)
  return compact(source.employeeId || source.employeeCode || source.staffId)
}

const transferHomeStoreId = (record) => {
  const source = safeRecord(record)
  return compact(
    source.fromStoreId || source.homeStoreId || source.sourceStoreId || source.originStoreId,
  )
}

const transferSupportStoreId = (record) => {
  const source = safeRecord(record)
  return compact(
    source.toStoreId || source.supportStoreId || source.destinationStoreId || source.targetStoreId,
  )
}

const normalizedTransferStatus = (record) => compact(safeRecord(record).status)
  .toLocaleUpperCase('vi-VN')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/gu, '')
  .replace(/Đ/gu, 'D')

const transferAvailableForHistory = (record) => {
  const source = safeRecord(record)
  if (!Object.keys(source).length || source.deletedAt || source.voidedAt) return false
  return !CANCELLED_TRANSFER_STATUSES.has(normalizedTransferStatus(source))
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

const nestedSupport = (record) => {
  const source = safeRecord(record)
  return safeRecord(
    source.supportCompensation
    || source.compensation?.support
    || source.supportAssignment
    || source.supportContext,
  )
}

const explicitTransferReferences = (record) => {
  const source = safeRecord(record)
  const support = nestedSupport(source)
  return [...new Set([
    source.supportTransferId,
    source.transferId,
    source.activeTransferId,
    support.transferId,
    ...(Array.isArray(source.supportTransferIds) ? source.supportTransferIds : []),
    ...(Array.isArray(support.transferIds) ? support.transferIds : []),
  ].map(compact).filter(Boolean))]
}

const recordEmployeeId = (record) => {
  const source = safeRecord(record)
  return compact(source.employeeId || source.employeeCode || source.staffId || source.userId)
}

const recordStoreId = (record) => {
  const source = safeRecord(record)
  const support = nestedSupport(source)
  return compact(
    source.supportStoreId
    || support.supportStoreId
    || source.destinationStoreId
    || source.storeId
    || source.payrollStoreId,
  )
}

const explicitHomeStoreId = (record) => {
  const source = safeRecord(record)
  const support = nestedSupport(source)
  return compact(
    source.employeeHomeStoreId
    || source.supportHomeStoreId
    || source.homeStoreId
    || support.homeStoreId
    || source.sourceStoreId,
  )
}

const explicitHomeStoreName = (record) => {
  const source = safeRecord(record)
  const support = nestedSupport(source)
  return compact(
    source.employeeHomeStoreName
    || source.supportHomeStoreName
    || source.homeStoreName
    || support.homeStoreName,
  )
}

const explicitSupportStoreName = (record) => {
  const source = safeRecord(record)
  const support = nestedSupport(source)
  return compact(
    source.supportStoreName
    || source.destinationStoreName
    || support.supportStoreName
    || source.storeName
    || source.payrollStoreName,
  )
}

const recordExplicitlyMarksSupport = (record) => {
  const source = safeRecord(record)
  const support = nestedSupport(source)
  return Boolean(
    source.supportTransferred === true
    || source.isSupportEmployee === true
    || support.isSupportEmployee === true
    || source.supportTransferId
    || support.transferId
    || source.supportStoreId
    || support.supportStoreId
    || explicitTransferReferences(source).length,
  )
}

const transferMatchesScope = ({ transfer, employeeId, storeId, businessDate }) => (
  transferAvailableForHistory(transfer)
  && sameIdentifier(transferEmployeeId(transfer), employeeId)
  && sameIdentifier(transferSupportStoreId(transfer), storeId)
  && transferOverlapsDateIncludingCompleted(transfer, businessDate)
)

const matchingTransfers = ({ supportTransfers, employeeId, storeId, businessDate }) => (
  (Array.isArray(supportTransfers) ? supportTransfers : []).filter((transfer) => (
    transferMatchesScope({ transfer, employeeId, storeId, businessDate })
  ))
)

/**
 * Canonical support-employee tag context.
 *
 * The tag is presentation-only: it never changes attendance, payroll or bonus
 * calculations. Historical records before 01/09/2026 remain untagged, while a
 * completed valid transfer can still label its records on/after the cutover.
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
  const sourceRecord = safeRecord(record)
  const date = supportEmployeeBusinessDate(businessDate) || recordBusinessDate(sourceRecord)
  if (!date || date < SUPPORT_EMPLOYEE_TAG_EFFECTIVE_DATE) return null

  const employeeReference = compact(employeeId) || recordEmployeeId(sourceRecord)
  const resolvedEmployee = safeRecord(employee).id || safeRecord(employee).code
    ? employee
    : resolveUnique(employees, employeeReference, employeeIdentifiers)
  const canonicalEmployeeId = employeeIdentifiers(resolvedEmployee)[0] || employeeReference
  const operationalStoreId = compact(storeId) || recordStoreId(sourceRecord)
  if (!canonicalEmployeeId || !operationalStoreId) return null

  const transferReferences = explicitTransferReferences(sourceRecord)
  const immutableSnapshotEvidence = Boolean(
    explicitHomeStoreId(sourceRecord)
    && recordStoreId(sourceRecord)
    && recordExplicitlyMarksSupport(sourceRecord),
  )
  if (transferReferences.length > 1 && !immutableSnapshotEvidence) return null

  const inferredTransfers = matchingTransfers({
    supportTransfers,
    employeeId: canonicalEmployeeId,
    storeId: operationalStoreId,
    businessDate: date,
  })
  if (!transferReferences.length && inferredTransfers.length > 1) return null

  let transfer = null
  if (transferReferences.length === 1) {
    const referencedTransfer = resolveUnique(
      supportTransfers,
      transferReferences[0],
      transferIdentifiers,
    )
    if (referencedTransfer) {
      const referencedTransferMatches = transferMatchesScope({
        transfer: referencedTransfer,
        employeeId: canonicalEmployeeId,
        storeId: operationalStoreId,
        businessDate: date,
      })
      if (referencedTransferMatches) transfer = referencedTransfer
      else if (!immutableSnapshotEvidence) return null
    } else if (!immutableSnapshotEvidence) return null
  } else if (inferredTransfers.length === 1) {
    transfer = inferredTransfers[0]
  }

  const resolvedEmployeeRecord = safeRecord(resolvedEmployee)
  const inferredHomeStore = storeFromEmployeeCode(stores, canonicalEmployeeId)
  const homeStoreId = explicitHomeStoreId(sourceRecord)
    || transferHomeStoreId(transfer)
    || compact(resolvedEmployeeRecord.homeStoreId)
    || compact(resolvedEmployeeRecord.storeId)
    || storeIdentifiers(inferredHomeStore)[0]
  const supportStoreId = recordStoreId(sourceRecord)
    || transferSupportStoreId(transfer)
    || operationalStoreId
  // Legacy store records can predate the immutable support snapshot and may
  // no longer have a transfer whose exact date window can be reconstructed.
  // The canonical employee/store directory still gives us unambiguous
  // evidence: this employee belongs to one store while the record belongs to
  // another. Older store projections may only retain the employee code, so a
  // unique explicit store employeePrefix is also accepted as directory data.
  // Keep explicit invalid/ambiguous transfer references fail-closed above,
  // then use the directory mismatch only as a presentation fallback.
  const directoryConfirmsExternalStore = Boolean(
    (employeeIdentifiers(resolvedEmployeeRecord).length || inferredHomeStore)
    && homeStoreId
    && supportStoreId
    && !sameIdentifier(homeStoreId, supportStoreId),
  )
  const supportEvidence = recordExplicitlyMarksSupport(sourceRecord)
    || Boolean(transfer)
    || directoryConfirmsExternalStore

  if (!supportEvidence || !homeStoreId || !supportStoreId || sameIdentifier(homeStoreId, supportStoreId)) return null
  if (!sameIdentifier(supportStoreId, operationalStoreId)) return null

  const homeStore = resolveUnique(stores, homeStoreId, storeIdentifiers) || inferredHomeStore
  const supportStore = resolveUnique(stores, supportStoreId, storeIdentifiers)
  const transferRecord = safeRecord(transfer)
  return {
    employeeId: canonicalEmployeeId,
    businessDate: date,
    homeStoreId,
    homeStoreName: explicitHomeStoreName(sourceRecord)
      || compact(transferRecord.fromStoreName)
      || compact(transferRecord.homeStoreName)
      || compact(safeRecord(homeStore).name)
      || homeStoreId,
    supportStoreId,
    supportStoreName: explicitSupportStoreName(sourceRecord)
      || compact(transferRecord.toStoreName)
      || compact(transferRecord.supportStoreName)
      || compact(safeRecord(supportStore).name)
      || supportStoreId,
    transferId: transferIdentifiers(transfer)[0] || transferReferences[0] || '',
  }
}

/**
 * Resolves one support tag for an aggregate row from canonical transfer,
 * snapshot or employee-directory evidence. Callers may pass mixed historical
 * records; records belonging to another employee are ignored and every
 * candidate still goes through the canonical resolver above.
 */
export function resolveSupportEmployeeTagContextFromRecords({
  records = [],
  ...resolverInput
} = {}) {
  const employeeReference = compact(resolverInput.employeeId)
    || employeeIdentifiers(resolverInput.employee)[0]

  for (const record of Array.isArray(records) ? records : []) {
    const candidateEmployeeId = recordEmployeeId(record)
    if (employeeReference && candidateEmployeeId
      && !sameIdentifier(candidateEmployeeId, employeeReference)) continue

    const context = resolveSupportEmployeeTagContext({
      ...resolverInput,
      record,
      employeeId: employeeReference || candidateEmployeeId,
      storeId: compact(resolverInput.storeId) || recordStoreId(record),
      businessDate: recordBusinessDate(record) || resolverInput.businessDate,
    })
    if (context) return context
  }

  return null
}
