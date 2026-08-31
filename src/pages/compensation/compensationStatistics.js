import {
  employeeUnit,
  entryAmount,
  entryDate,
  entryEmployeeId,
  isVoided,
} from './compensationViewModel'
import {
  operationalIdentifierEntry,
  operationalIdentifierRecordMatch,
  operationalIdentifierReferenceKey,
  operationalIdentifierReferenceMatchesRecord,
  sameOperationalIdentifier,
} from '../../utils'

const monthLabel = (period) => {
  const [year, month] = String(period || '').split('-')
  return year && month ? `Tháng ${month}/${year}` : 'Không xác định'
}

export const violationStatistics = (entries = []) => {
  const active = entries.filter((entry) => !isVoided(entry))
  const summarize = (keyFor, labelFor) => [...active.reduce((groups, entry) => {
    const key = keyFor(entry)
    const current = groups.get(key) || {
      key,
      label: labelFor(key, entry),
      count: 0,
      amountVnd: 0,
      severity: 'Chưa cấu hình mức độ',
    }
    current.count += 1
    current.amountVnd += Math.abs(entryAmount(entry))
    groups.set(key, current)
    return groups
  }, new Map()).values()].toSorted((left, right) => right.key.localeCompare(left.key))

  return {
    byDay: summarize(entryDate, (date) => date.split('-').reverse().join('/')),
    byMonth: summarize((entry) => entryDate(entry).slice(0, 7), monthLabel),
    byEmployee: summarize(entryEmployeeId, (employeeId, entry) => (
      entry.employeeName || employeeId || 'Không xác định'
    )),
  }
}

const normalize = (value) => String(value ?? '').trim().toLocaleLowerCase('vi-VN')
const rewardKind = (task = {}) => normalize(
  task.kind || task.catalogKind || task.catalogSnapshot?.kind || task.catalogSnapshot?.catalogKind,
).replaceAll('-', '_')
const isRewardTask = (task = {}) => rewardKind(task) === 'reward_task'
  || task.rewardEligible === true

const attendanceId = (record = {}) => String(record.id || record.attendanceId || '').trim()
const attendanceDate = (record = {}) => String(
  record.workDate || record.attendanceDate || record.date || record.checkInAt || '',
).slice(0, 10)
const attendanceEmployeeId = (record = {}) => String(record.employeeId || record.employeeCode || '').trim()
const attendanceShiftId = (record = {}) => String(record.shiftId || record.shift || '').trim()
const attendanceShiftName = (record = {}) => String(
  record.shiftName || record.checklistSnapshot?.shiftName || record.shiftId || record.shift || 'Chưa gắn ca',
).trim()
const attendanceIsOpen = (record = {}) => {
  const status = normalize(record.status)
  return !record.checkOut && !record.checkOutAt && !record.closedAt
    && !['closed', 'completed', 'đã kết ca', 'đã đóng'].includes(status)
}
const catalogItemId = (task = {}) => String(
  task.catalogItemId || task.checklistTaskId || task.id || task.catalogSnapshot?.id || '',
).trim()
const progressAttendanceId = (record = {}) => String(
  record.attendanceId || record.checklistAttendanceId || record.sourceAttendanceId || '',
).trim()
const progressCatalogItemId = (record = {}) => String(
  record.catalogItemId || record.workCatalogItemId || record.checklistTaskId || record.taskId || '',
).trim()
const completionState = (record = {}) => {
  const status = normalize(record.status)
  if (record.checked === false || record.completed === false
    || ['void', 'voided', 'cancelled', 'canceled', 'đã hủy'].includes(status)) return false
  if (record.checked === true || record.completed === true || record.done === true || record.claimed === true || record.rewarded === true) return true
  return ['claimed', 'completed', 'complete', 'approved', 'earned', 'hoàn thành', 'đã hoàn thành', 'đã ghi nhận']
    .includes(status)
}
const completionTime = (record = {}) => String(
  record.completedAt || record.rewardedAt || record.claimedAt || record.updatedAt || record.createdAt || '',
)

const operationalReferenceRecord = (records, reference, identifierOf) => {
  const requested = String(reference || '').trim()
  if (!requested) return null
  const candidates = (Array.isArray(records) ? records : []).filter((record) => (
    sameOperationalIdentifier(identifierOf(record), requested)
  ))
  const exact = candidates.filter((record) => String(identifierOf(record) || '').trim() === requested)
  if (exact.length === 1) return exact[0]
  return exact.length === 0 && candidates.length === 1 ? candidates[0] : null
}

const attendanceReferenceKey = (attendanceRecords, reference, catalogId) => {
  const attendanceKey = operationalIdentifierReferenceKey(attendanceRecords, reference, attendanceId)
  const sourceAttendance = operationalReferenceRecord(attendanceRecords, reference, attendanceId)
  const snapshotTasks = Array.isArray(sourceAttendance?.checklistSnapshot?.tasks)
    ? sourceAttendance.checklistSnapshot.tasks
    : []
  const catalogKey = operationalIdentifierReferenceKey(snapshotTasks, catalogId, catalogItemId)
  return `${attendanceKey}:${catalogKey}`
}

const employeeIdentifiers = (employee = {}) => [employee.id, employee.code, employee.employeeId]
const distinctIdentifierRecords = (values = []) => [...new Set(values
  .map((value) => String(value || '').trim())
  .filter(Boolean))].map((id) => ({ id }))
const matchedOperationalRecord = (records, reference, identifierValuesOf = (record) => [record?.id]) => {
  const match = operationalIdentifierRecordMatch(records, reference, identifierValuesOf)
  return match.ambiguous ? null : match.record
}

/**
 * Builds immutable reward rows from the checklist captured at attendance check-in.
 * Current completion is overlaid from the canonical progress collection, with the
 * flat task collection retained only as a compatibility reader for older records.
 */
export const workRewardRows = ({
  attendance = [],
  workCatalogProgress = [],
  compensationEntries = [],
  tasks = [],
  employees = [],
  employeeId = '',
  targetUnit = '',
  storeId = '',
} = {}) => {
  const attendanceRecords = (Array.isArray(attendance) ? attendance : []).filter((record) => !record.deletedAt)
  const employeeRecords = Array.isArray(employees) ? employees : []
  const employeeFor = (reference) => matchedOperationalRecord(employeeRecords, reference, employeeIdentifiers)
  const employeeFilterSource = employeeRecords.length
    ? employeeRecords
    : distinctIdentifierRecords(attendanceRecords.map(attendanceEmployeeId))
  const employeeFilterMatch = employeeId
    ? operationalIdentifierRecordMatch(
      employeeFilterSource,
      employeeId,
      employeeRecords.length ? employeeIdentifiers : (record) => [record.id],
    )
    : null
  if (employeeFilterMatch?.ambiguous || (employeeId && !employeeFilterMatch?.record)) return []
  const storeReferences = distinctIdentifierRecords([
    ...attendanceRecords.map((record) => record.storeId),
    ...employeeRecords.map((employee) => employee.storeId),
  ])
  const storeFilterMatch = storeId
    ? operationalIdentifierRecordMatch(storeReferences, storeId, (record) => [record.id])
    : null
  if (storeFilterMatch?.ambiguous || (storeId && !storeFilterMatch?.record)) return []
  const progressByKey = new Map((Array.isArray(workCatalogProgress) ? workCatalogProgress : [])
    .map((record) => [attendanceReferenceKey(
      attendanceRecords,
      progressAttendanceId(record),
      progressCatalogItemId(record),
    ), record])
    .filter(([key]) => !key.startsWith(':') && !key.endsWith(':')))
  const compensationRecords = Array.isArray(compensationEntries) ? compensationEntries : []
  const tasksByKey = new Map((Array.isArray(tasks) ? tasks : [])
    .map((task) => [attendanceReferenceKey(
      attendanceRecords,
      task.checklistAttendanceId || task.attendanceId,
      catalogItemId(task),
    ), task])
    .filter(([key]) => !key.startsWith(':') && !key.endsWith(':')))

  return attendanceRecords
    .filter((record) => {
      if (!employeeFilterMatch?.record) return true
      if (!employeeRecords.length) {
        return operationalIdentifierReferenceMatchesRecord(
          employeeFilterSource,
          employeeFilterMatch.record,
          attendanceEmployeeId(record),
        )
      }
      return employeeFor(attendanceEmployeeId(record)) === employeeFilterMatch.record
    })
    .filter((record) => {
      const employee = employeeFor(attendanceEmployeeId(record))
      return !targetUnit || employeeUnit({ ...employee, ...record }) === targetUnit
    })
    .filter((record) => {
      if (!storeFilterMatch?.record) return true
      const employee = employeeFor(attendanceEmployeeId(record))
      return operationalIdentifierReferenceMatchesRecord(
        storeReferences,
        storeFilterMatch.record,
        record.storeId || employee?.storeId,
      )
    })
    .flatMap((record) => {
      const snapshotTasks = Array.isArray(record.checklistSnapshot?.tasks) ? record.checklistSnapshot.tasks : []
      return snapshotTasks.filter(isRewardTask).map((task, index) => {
        const sourceAttendanceId = attendanceId(record)
        const sourceCatalogItemId = catalogItemId(task)
        const rewardProgressKey = attendanceReferenceKey(attendanceRecords, sourceAttendanceId, sourceCatalogItemId)
        const progress = progressByKey.get(rewardProgressKey)
        const legacyTask = tasksByKey.get(rewardProgressKey)
        const recordEmployeeId = attendanceEmployeeId(record)
        const completionEntry = legacyTask?.completedBy && typeof legacyTask.completedBy === 'object'
          ? operationalIdentifierEntry(legacyTask.completedBy, recordEmployeeId)
          : { found: false, ambiguous: false, value: false }
        const completedBy = completionEntry.found && !completionEntry.ambiguous
          ? Boolean(completionEntry.value)
          : false
        const completed = progress ? completionState(progress) : completionState(legacyTask) || completedBy
        const compensationEntry = matchedOperationalRecord(
          compensationRecords,
          progress?.compensationEntryId,
          (entry) => [entry.id],
        )
        const progressStatus = normalize(progress?.status || compensationEntry?.status)
        const payoutStatus = ['pending_team_review', 'pending', 'submitted'].includes(progressStatus)
          ? 'pending'
          : ['void', 'voided', 'cancelled', 'canceled', 'đã hủy'].includes(progressStatus)
            ? 'void'
            : completed ? 'approved' : 'unclaimed'
        const workDate = attendanceDate(record)
        const shiftStart = String(record.shiftStart || '').trim()
        const shiftEnd = String(record.shiftEnd || '').trim()
        const employee = employeeFor(recordEmployeeId)
        return {
          id: `${sourceAttendanceId}:${sourceCatalogItemId || index}`,
          attendanceId: sourceAttendanceId,
          employeeId: recordEmployeeId,
          employeeName: record.employeeName || employee?.name || employee?.displayName || recordEmployeeId || 'Không xác định',
          targetUnit: employeeUnit({ ...employee, ...record }),
          storeId: String(record.storeId || employee?.storeId || '').trim(),
          workDate,
          month: workDate.slice(0, 7),
          shiftId: attendanceShiftId(record),
          shiftName: attendanceShiftName(record),
          shiftTime: shiftStart || shiftEnd ? `${shiftStart || '--:--'}–${shiftEnd || '--:--'}` : '',
          attendanceOpen: attendanceIsOpen(record),
          catalogItemId: sourceCatalogItemId,
          catalogCode: String(task.catalogCode || task.code || '').trim(),
          catalogVersion: Number(task.catalogVersion || task.version || 1),
          title: String(task.name || task.title || task.description || 'Công việc tính thưởng').trim(),
          description: String(task.description || task.detail || '').trim(),
          amountVnd: Math.max(0, Number(task.amountVnd || 0) || 0),
          completed,
          paid: completed && payoutStatus === 'approved',
          payoutStatus,
          progressVersion: Number(progress?.version || 0),
          completedAt: completed ? completionTime(progress || legacyTask) : '',
        }
      })
    })
    .toSorted((left, right) => `${right.workDate} ${right.completedAt} ${right.id}`
      .localeCompare(`${left.workDate} ${left.completedAt} ${left.id}`))
}

export const rewardStatistics = (rows = []) => {
  const completed = rows.filter((row) => row.paid || (row.completed && row.payoutStatus !== 'pending' && row.payoutStatus !== 'void'))
  const summarize = (keyFor, labelFor) => [...completed.reduce((groups, row) => {
    const key = keyFor(row)
    const current = groups.get(key) || { key, label: labelFor(key, row), count: 0, amountVnd: 0 }
    current.count += 1
    current.amountVnd += Math.max(0, Number(row.amountVnd || 0) || 0)
    groups.set(key, current)
    return groups
  }, new Map()).values()].toSorted((left, right) => right.key.localeCompare(left.key))

  return {
    byDay: summarize((row) => row.workDate, (date) => String(date || '').split('-').reverse().join('/')),
    byMonth: summarize((row) => row.month || String(row.workDate || '').slice(0, 7), monthLabel),
    byEmployee: summarize((row) => row.employeeId, (id, row) => row.employeeName || id || 'Không xác định'),
  }
}
