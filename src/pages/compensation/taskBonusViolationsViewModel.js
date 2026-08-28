import { WORK_CATALOG_KIND } from '../../domain/workCatalog'
import { entityId, employeeUnit } from './compensationViewModel'

const text = (value) => String(value ?? '').trim()
const dateOf = (record = {}) => text(
  record.workDate || record.date || record.attendanceDate || record.occurredOn || record.effectiveDate,
).slice(0, 10)
const employeeIdOf = (record = {}) => text(
  record.employeeId || record.targetEmployeeId || record.employee?.id || record.employee?.code,
)
const storeIdOf = (record = {}) => text(record.storeId || record.targetStoreId)
const shiftIdOf = (record = {}) => text(record.shiftId || record.shiftRef || record.shift)
const safeAmount = (value) => {
  const amount = Number(value)
  return Number.isSafeInteger(amount) && amount >= 0 ? amount : 0
}
const array = (value) => Array.isArray(value) ? value : []
const unique = (values) => [...new Set(values.map(text).filter(Boolean))]
const normalizedProfileLabel = (value) => text(value)
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/gu, '')
  .replace(/[\u0111Đ]/gu, 'd')
  .toLocaleLowerCase('vi')
const managerProfileAliases = new Set([
  'store_manager', 'store-manager', 'store manager', 'manager', 'qlch', 'quan ly cua hang',
])

const isStoreManagerProfile = (employee = {}) => {
  const explicitUnit = normalizedProfileLabel(employee.unit || employee.unitType || employee.department)
  const explicitRole = normalizedProfileLabel(employee.role)
  const roles = array(employee.roles).map(normalizedProfileLabel)
  const position = normalizedProfileLabel(employee.position || employee.jobPosition)
  return employee.isStoreManager === true
    || managerProfileAliases.has(explicitUnit)
    || managerProfileAliases.has(explicitRole)
    || roles.some((role) => managerProfileAliases.has(role))
    || position.includes('quan ly cua hang')
}

const shiftDefinition = (shiftDefinitions, storeId, shiftId) => array(shiftDefinitions).find((shift) => (
  entityId(shift) === shiftId
  && (!storeIdOf(shift) || storeIdOf(shift) === storeId)
)) || null

const recordShiftIds = (record = {}) => unique([
  ...array(record.shiftIds),
  record.shiftId,
  record.shiftRef,
  record.shift,
])

const nestedShiftSnapshot = (record, shiftId) => array(record?.shiftSnapshots)
  .find((snapshot) => entityId(snapshot) === shiftId) || null

const shiftFromRecord = ({ record, shiftId, storeId, shiftDefinitions, source }) => {
  if (!record) return null
  const snapshot = nestedShiftSnapshot(record, shiftId)
  const appliesToLegacyFields = recordShiftIds(record).length <= 1 || shiftIdOf(record) === shiftId
  const definition = shiftDefinition(shiftDefinitions, storeId, shiftId)
  // Attendance and schedule rows are historical evidence. Their saved fields
  // intentionally win over a shift definition that may have since changed.
  const name = text(
    snapshot?.name
    || (appliesToLegacyFields ? record.shiftName || record.name : '')
    || definition?.name
    || `Ca ${shiftId}`,
  )
  const start = text(
    snapshot?.start
    || (appliesToLegacyFields ? record.shiftStart || record.start : '')
    || definition?.start,
  )
  const end = text(
    snapshot?.end
    || (appliesToLegacyFields ? record.shiftEnd || record.end : '')
    || definition?.end,
  )
  return {
    id: shiftId,
    name,
    start,
    end,
    time: start && end ? `${start} – ${end}` : '',
    version: Number(snapshot?.version || record.shiftVersion || definition?.version || 0) || null,
    source,
    attendanceId: source === 'attendance' ? text(record.id) : '',
    scheduleId: source === 'schedule' ? text(record.id) : '',
  }
}

/**
 * Returns only shifts evidenced by the employee's schedule or attendance for
 * the selected store/day. Attendance snapshots take precedence. Schedule is a
 * deliberate fallback so a manager can still record “Quên điểm danh”.
 */
export const selectWorkedShiftOptions = ({
  attendance = [],
  schedule = [],
  shiftDefinitions = [],
  employeeId = '',
  storeId = '',
  date = '',
} = {}) => {
  const requestedEmployeeId = text(employeeId)
  const requestedStoreId = text(storeId)
  const requestedDate = text(date).slice(0, 10)
  if (!requestedEmployeeId || !requestedStoreId || !requestedDate) return []

  const attendanceRows = array(attendance)
    .filter((record) => !record?.deletedAt)
    .filter((record) => employeeIdOf(record) === requestedEmployeeId)
    .filter((record) => storeIdOf(record) === requestedStoreId)
    .filter((record) => dateOf(record) === requestedDate)
    .sort((left, right) => text(right.checkInAt || right.createdAt).localeCompare(text(left.checkInAt || left.createdAt)))
  const scheduleRows = array(schedule)
    .filter((record) => !record?.deletedAt)
    .filter((record) => employeeIdOf(record) === requestedEmployeeId)
    .filter((record) => storeIdOf(record) === requestedStoreId)
    .filter((record) => dateOf(record) === requestedDate)
    .sort((left, right) => text(right.updatedAt || right.createdAt).localeCompare(text(left.updatedAt || left.createdAt)))

  const ids = unique([
    ...attendanceRows.flatMap(recordShiftIds),
    ...scheduleRows.flatMap(recordShiftIds),
  ])
  return ids.map((shiftId) => {
    const attendanceRecord = attendanceRows.find((record) => recordShiftIds(record).includes(shiftId))
    const scheduleRecord = scheduleRows.find((record) => recordShiftIds(record).includes(shiftId))
    const primary = attendanceRecord
      ? shiftFromRecord({ record: attendanceRecord, shiftId, storeId: requestedStoreId, shiftDefinitions, source: 'attendance' })
      : shiftFromRecord({ record: scheduleRecord, shiftId, storeId: requestedStoreId, shiftDefinitions, source: 'schedule' })
    return {
      ...primary,
      attendanceId: text(attendanceRecord?.id),
      scheduleId: text(scheduleRecord?.id),
      hasAttendance: Boolean(attendanceRecord),
      hasSchedule: Boolean(scheduleRecord),
      sourceLabel: attendanceRecord ? 'Đã chấm công' : 'Theo lịch phân ca',
    }
  }).filter(Boolean).sort((left, right) => (
    text(left.start).localeCompare(text(right.start))
    || text(left.name).localeCompare(text(right.name), 'vi')
    || text(left.id).localeCompare(text(right.id))
  ))
}

export const selectStoreEmployees = ({
  employees = [],
  attendance = [],
  schedule = [],
  storeId = '',
  date = '',
} = {}) => {
  const requestedStoreId = text(storeId)
  if (!requestedStoreId) return []
  const requestedDate = text(date).slice(0, 10)
  const historicalEmployeeIds = new Set(requestedDate ? [
    ...array(attendance),
    ...array(schedule),
  ].filter((record) => (
    !record?.deletedAt
    && storeIdOf(record) === requestedStoreId
    && dateOf(record) === requestedDate
  )).map(employeeIdOf).filter(Boolean) : [])
  return array(employees).filter((employee) => (
    !employee?.deletedAt
    && !['inactive', 'đã nghỉ việc'].includes(text(employee.status).toLocaleLowerCase('vi'))
    && !isStoreManagerProfile(employee)
    && employeeUnit(employee) === 'store'
    && (storeIdOf(employee) === requestedStoreId || historicalEmployeeIds.has(entityId(employee)))
  )).sort((left, right) => (
    text(left.name).localeCompare(text(right.name), 'vi') || entityId(left).localeCompare(entityId(right))
  ))
}

const kindOf = (record = {}) => text(
  record.catalogSnapshot?.kind || record.catalogKind || record.kind || record.type,
).toLocaleUpperCase('en-US')

const isReward = (record, catalogItem, assumeReward = false) => (
  assumeReward
  || record?.rewardEligible === true
  || kindOf(record) === WORK_CATALOG_KIND.REWARD_TASK
  || kindOf(catalogItem) === WORK_CATALOG_KIND.REWARD_TASK
)

const explicitlyCompleted = (record = {}, defaultValue = true) => {
  if (record.completed !== undefined) return record.completed === true
  if (record.checked !== undefined) return record.checked === true
  if (record.done !== undefined) return record.done === true
  const status = text(record.status || record.progressStatus).toLocaleUpperCase('en-US')
  if (['INCOMPLETE', 'PENDING', 'NOT_COMPLETED', 'FALSE', 'VOID', 'VOIDED'].includes(status)) return false
  return defaultValue
}

const reconciliationRequired = (...records) => records.some((record) => {
  const code = text(
    record?.reconciliationCode || record?.reasonCode || record?.claimStatus || record?.statusCode || record?.status,
  ).toLocaleUpperCase('en-US')
  return record?.payable === false
    || record?.transferReconciliationRequired === true
    || code === 'TRANSFER_RECONCILIATION_REQUIRED'
})

const compensationIsVoided = (entry) => Boolean(
  entry?.voidedAt
  || entry?.deletedAt
  || ['VOID', 'VOIDED', 'CANCELLED', 'ĐÃ HỦY'].includes(text(entry?.status).toLocaleUpperCase('vi')),
)

const compensationIsActive = (entry = {}) => Boolean(entry?.approvedAt)
  || ['ACTIVE', 'APPROVED', 'CONFIRMED', 'ĐANG ÁP DỤNG', 'ĐÃ DUYỆT', 'ĐÃ XÁC NHẬN']
    .includes(text(entry?.status).toLocaleUpperCase('vi'))

const isRewardLedgerEntry = (entry) => Boolean(entry) && (
  text(entry.type || entry.kind).toLocaleUpperCase('en-US') === 'WORK'
  || /work.?catalog/iu.test(text(entry.sourceType || entry.source?.type))
)

const catalogIdentity = (record = {}) => text(
  record.catalogItemId
  || record.catalogSnapshot?.catalogItemId
  || record.catalogSnapshot?.id
  || record.taskId
  || record.id,
)

const catalogCode = (record = {}) => text(record.catalogCode || record.catalogSnapshot?.catalogCode || record.catalogSnapshot?.code)

const taskName = (record = {}, catalogItem = {}) => text(
  record.catalogSnapshot?.name || record.title || record.name || record.label
  || catalogItem.name || catalogItem.label || record.catalogCode || 'Công việc tính thưởng',
)

const taskAmount = (record = {}, catalogItem = {}) => safeAmount(
  record.catalogSnapshot?.amountVnd ?? record.amountVnd ?? record.rewardAmountVnd ?? catalogItem.amountVnd,
)

const catalogMaps = (items = []) => {
  const byId = new Map()
  const byCode = new Map()
  array(items).forEach((item) => {
    if (item?.deletedAt) return
    if (entityId(item)) byId.set(entityId(item), item)
    if (text(item.code)) byCode.set(text(item.code), item)
  })
  return { byId, byCode }
}

const catalogFor = (record, maps) => maps.byId.get(catalogIdentity(record))
  || maps.byCode.get(catalogCode(record))
  || null

const shiftForRewardRow = ({ attendance, schedule, shiftDefinitions, employeeId, storeId, date, shiftId, attendanceId }) => {
  const exactAttendance = array(attendance).find((record) => (
    !record?.deletedAt
    && text(record.id) === text(attendanceId)
    && employeeIdOf(record) === employeeId
    && storeIdOf(record) === storeId
  ))
  const options = selectWorkedShiftOptions({ attendance, schedule, shiftDefinitions, employeeId, storeId, date })
  return (exactAttendance && recordShiftIds(exactAttendance).includes(shiftId)
    ? shiftFromRecord({ record: exactAttendance, shiftId, storeId, shiftDefinitions, source: 'attendance' })
    : options.find((option) => option.id === shiftId))
    || shiftFromRecord({
      record: { shiftId }, shiftId, storeId, shiftDefinitions, source: 'definition',
    })
}

const makeRewardRow = ({
  source,
  priority,
  record,
  context,
  assumeReward,
  maps,
  employeesById,
  attendance,
  schedule,
  shiftDefinitions,
  requestedStoreId,
  compensationEntry,
}) => {
  const catalogItem = catalogFor(record, maps)
  const hasRewardLedger = isRewardLedgerEntry(compensationEntry)
  const voided = hasRewardLedger && compensationIsVoided(compensationEntry)
  if (!isReward(record, catalogItem, assumeReward) || (!explicitlyCompleted(record) && !voided)) return null
  const employeeId = employeeIdOf(record) || text(context.employeeId)
  const storeId = storeIdOf(record) || text(context.storeId)
  const date = dateOf(record) || text(context.date).slice(0, 10)
  const shiftId = shiftIdOf(record) || text(context.shiftId)
  if (!employeeId || !storeId || storeId !== requestedStoreId || !date) return null
  const itemId = catalogIdentity(record) || text(context.taskId)
  if (!itemId) return null
  const attendanceId = text(
    record.attendanceId || record.checklistAttendanceId
    || context.attendanceId || context.checklistAttendanceId,
  )
  const occurrenceRef = attendanceId || shiftId || 'no-shift'
  const submittedAt = text(
    record.submittedAt || record.completedAt || record.checkedAt || record.createdAt
    || context.submittedAt || context.at,
  )
  const shift = shiftForRewardRow({
    attendance,
    schedule,
    shiftDefinitions,
    employeeId,
    storeId,
    date,
    shiftId,
    attendanceId,
  })
  const needsReconciliation = !voided && reconciliationRequired(record, context)
  const ledgerActive = hasRewardLedger && !voided && !needsReconciliation && compensationIsActive(compensationEntry)
  const ledgerPending = hasRewardLedger && !voided && !needsReconciliation && !ledgerActive
  const employee = employeesById.get(employeeId)
  return {
    id: `${source}:${text(context.assignmentId)}:${employeeId}:${date}:${occurrenceRef}:${itemId}`,
    dedupeKey: `${employeeId}:${date}:${occurrenceRef}:${itemId}`,
    source,
    priority,
    assignmentId: text(record.assignmentId || context.assignmentId),
    taskId: text(record.taskId || record.id || context.taskId),
    catalogItemId: catalogIdentity(record),
    catalogCode: catalogCode(record) || text(catalogItem?.code),
    employeeId,
    employeeName: text(record.employeeName || context.employeeName || employee?.name || employeeId),
    storeId,
    attendanceId,
    date,
    shiftId,
    shiftName: text(record.shiftName || context.shiftName || shift?.name || shiftId || 'Chưa gắn ca'),
    shiftStart: text(record.shiftStart || context.shiftStart || shift?.start),
    shiftEnd: text(record.shiftEnd || context.shiftEnd || shift?.end),
    name: taskName(record, catalogItem),
    amountVnd: taskAmount(record, catalogItem),
    submittedAt,
    compensationEntryId: text(compensationEntry?.id),
    voided,
    payable: ledgerActive,
    status: voided
      ? 'Đã hủy'
      : needsReconciliation
        ? 'Chờ đối soát điều chuyển'
        : ledgerActive
          ? 'Đã ghi nhận'
          : ledgerPending ? 'Chờ ghi nhận thưởng' : 'Dữ liệu cũ · chưa tính thưởng',
    statusTone: voided ? 'red' : needsReconciliation || ledgerPending ? 'orange' : ledgerActive ? 'green' : 'gray',
  }
}

const progressSnapshots = (record = {}) => {
  const nested = [
    ['completedRewardTaskSnapshots', true],
    ['rewardTaskSnapshots', true],
    ['taskResults', false],
    ['tasks', false],
  ]
  const selected = nested.find(([key]) => array(record[key]).length)
  return selected
    ? { records: array(record[selected[0]]), assumeReward: selected[1] }
    : { records: [record], assumeReward: false }
}

/**
 * Canonical display order is workCatalogProgress -> immutable submission
 * snapshots. Mutable task.completedBy/task.done state is deliberately excluded:
 * it can be changed before an employee actually submits the checklist. Rows are
 * de-duplicated by the same employee/day/attendance/catalog identity used by
 * workCatalogProgress claims, with shift as the legacy fallback.
 */
export const selectRewardSubmissionRows = ({
  workCatalogProgress = [],
  taskAssignmentHistory = [],
  workCatalogItems = [],
  compensationEntries = [],
  attendance = [],
  schedule = [],
  employees = [],
  shiftDefinitions = [],
  storeId = '',
} = {}) => {
  const requestedStoreId = text(storeId)
  if (!requestedStoreId) return []
  const maps = catalogMaps(workCatalogItems)
  const compensationByProgressId = new Map()
  const compensationById = new Map()
  array(compensationEntries).forEach((entry) => {
    if (text(entry.id)) compensationById.set(text(entry.id), entry)
    const ids = unique([
      entry.workCatalogProgressId,
      entry.progressId,
      entry.source?.workCatalogProgressId,
      /work.?catalog/iu.test(text(entry.sourceType)) ? entry.sourceId : '',
    ])
    ids.forEach((id) => compensationByProgressId.set(id, entry))
  })
  const employeesById = new Map(array(employees).map((employee) => [entityId(employee), employee]))
  const candidates = []
  const push = (details) => {
    const progressIds = unique([
      details.record?.workCatalogProgressId,
      details.record?.progressId,
      details.context?.workCatalogProgressId,
      details.context?.progressId,
      details.source === 'work-catalog-progress' ? details.context?.id : '',
    ])
    const compensationEntryId = text(details.record?.compensationEntryId || details.context?.compensationEntryId)
    const compensationEntry = (compensationEntryId ? compensationById.get(compensationEntryId) : null)
      || progressIds.map((id) => compensationByProgressId.get(id)).find(Boolean)
      || null
    const row = makeRewardRow({
      ...details,
      maps,
      employeesById,
      attendance,
      schedule,
      shiftDefinitions,
      requestedStoreId,
      compensationEntry,
    })
    if (row) candidates.push(row)
  }

  array(workCatalogProgress).forEach((progress) => {
    if (storeIdOf(progress) !== requestedStoreId || progress?.deletedAt) return
    const snapshots = progressSnapshots(progress)
    snapshots.records.forEach((snapshot) => push({
      source: 'work-catalog-progress',
      priority: 3,
      record: snapshot,
      assumeReward: snapshots.assumeReward,
      context: progress,
    }))
  })

  array(taskAssignmentHistory).forEach((assignment) => {
    if (storeIdOf(assignment) !== requestedStoreId || assignment?.deletedAt) return
    array(assignment.progressHistory).forEach((event) => {
      if (text(event.action) !== 'progress-submitted') return
      const snapshotSet = progressSnapshots(event)
      if (snapshotSet.records.length === 1 && snapshotSet.records[0] === event) return
      snapshotSet.records.forEach((snapshot) => {
        push({
          source: 'submission-snapshot',
          priority: 2,
          record: snapshot,
          assumeReward: snapshotSet.assumeReward,
          context: {
            ...assignment,
            ...event,
            assignmentId: event.assignmentId || assignment.assignmentId || assignment.id,
            submittedAt: event.at || event.submittedAt,
          },
        })
      })
    })
  })

  const byIdentity = new Map()
  candidates.forEach((row) => {
    const previous = byIdentity.get(row.dedupeKey)
    if (!previous
      || row.priority > previous.priority
      || (row.priority === previous.priority && row.submittedAt > previous.submittedAt)) {
      byIdentity.set(row.dedupeKey, row)
    }
  })
  return [...byIdentity.values()].sort((left, right) => (
    text(right.submittedAt || right.date).localeCompare(text(left.submittedAt || left.date))
    || left.employeeName.localeCompare(right.employeeName, 'vi')
    || left.name.localeCompare(right.name, 'vi')
  ))
}

const normalizedSearch = (value) => text(value)
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/gu, '')
  .replace(/[đĐ]/gu, 'd')
  .toLocaleLowerCase('vi')

export const filterRewardSubmissionRows = (rows = [], {
  fromDate = '',
  toDate = '',
  shiftId = '',
  employeeId = '',
  query = '',
} = {}) => {
  const search = normalizedSearch(query)
  const searchTokens = search.split(/\s+/u).filter(Boolean)
  return array(rows).filter((row) => (
    (!fromDate || row.date >= fromDate)
    && (!toDate || row.date <= toDate)
    && (!shiftId || row.shiftId === shiftId)
    && (!employeeId || row.employeeId === employeeId)
    && (!search || (() => {
      const haystack = normalizedSearch([
        row.employeeName,
        row.employeeId,
        row.name,
        row.catalogCode,
        row.shiftName,
      ].join(' '))
      return searchTokens.every((token) => haystack.includes(token))
    })())
  ))
}
