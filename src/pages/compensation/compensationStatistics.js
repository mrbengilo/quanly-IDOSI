import {
  employeeUnit,
  entryAmount,
  entryDate,
  entryEmployeeId,
  isVoided,
} from './compensationViewModel'

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

const progressKey = (record = {}) => `${progressAttendanceId(record)}:${progressCatalogItemId(record)}`
const taskProgressKey = (task = {}) => `${String(task.checklistAttendanceId || task.attendanceId || '').trim()}:${catalogItemId(task)}`

const employeeNameMap = (employees = []) => new Map(employees.flatMap((employee) => {
  const ids = [employee.id, employee.code, employee.employeeId].map((value) => String(value || '').trim()).filter(Boolean)
  return ids.map((id) => [id, employee.name || employee.displayName || id])
}))

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
  const names = employeeNameMap(employees)
  const employeeById = new Map((Array.isArray(employees) ? employees : []).flatMap((employee) => (
    [employee.id, employee.code, employee.employeeId]
      .map((value) => String(value || '').trim())
      .filter(Boolean)
      .map((id) => [id, employee])
  )))
  const progressByKey = new Map((Array.isArray(workCatalogProgress) ? workCatalogProgress : [])
    .map((record) => [progressKey(record), record])
    .filter(([key]) => !key.startsWith(':') && !key.endsWith(':')))
  const compensationById = new Map((Array.isArray(compensationEntries) ? compensationEntries : [])
    .map((entry) => [String(entry.id || '').trim(), entry])
    .filter(([id]) => id))
  const tasksByKey = new Map((Array.isArray(tasks) ? tasks : [])
    .map((task) => [taskProgressKey(task), task])
    .filter(([key]) => !key.startsWith(':') && !key.endsWith(':')))

  return (Array.isArray(attendance) ? attendance : [])
    .filter((record) => !record.deletedAt)
    .filter((record) => !employeeId || attendanceEmployeeId(record) === String(employeeId))
    .filter((record) => {
      const employee = employeeById.get(attendanceEmployeeId(record))
      return !targetUnit || employeeUnit({ ...employee, ...record }) === targetUnit
    })
    .filter((record) => !storeId || String(record.storeId || '') === String(storeId))
    .flatMap((record) => {
      const snapshotTasks = Array.isArray(record.checklistSnapshot?.tasks) ? record.checklistSnapshot.tasks : []
      return snapshotTasks.filter(isRewardTask).map((task, index) => {
        const sourceAttendanceId = attendanceId(record)
        const sourceCatalogItemId = catalogItemId(task)
        const progress = progressByKey.get(`${sourceAttendanceId}:${sourceCatalogItemId}`)
        const legacyTask = tasksByKey.get(`${sourceAttendanceId}:${sourceCatalogItemId}`)
        const recordEmployeeId = attendanceEmployeeId(record)
        const completedBy = legacyTask?.completedBy && typeof legacyTask.completedBy === 'object'
          ? Boolean(legacyTask.completedBy[recordEmployeeId])
          : false
        const completed = progress ? completionState(progress) : completionState(legacyTask) || completedBy
        const compensationEntry = compensationById.get(String(progress?.compensationEntryId || '').trim())
        const progressStatus = normalize(progress?.status || compensationEntry?.status)
        const payoutStatus = ['pending_team_review', 'pending', 'submitted'].includes(progressStatus)
          ? 'pending'
          : ['void', 'voided', 'cancelled', 'canceled', 'đã hủy'].includes(progressStatus)
            ? 'void'
            : completed ? 'approved' : 'unclaimed'
        const workDate = attendanceDate(record)
        const shiftStart = String(record.shiftStart || '').trim()
        const shiftEnd = String(record.shiftEnd || '').trim()
        return {
          id: `${sourceAttendanceId}:${sourceCatalogItemId || index}`,
          attendanceId: sourceAttendanceId,
          employeeId: recordEmployeeId,
          employeeName: record.employeeName || names.get(recordEmployeeId) || recordEmployeeId || 'Không xác định',
          targetUnit: employeeUnit({ ...employeeById.get(recordEmployeeId), ...record }),
          storeId: String(record.storeId || employeeById.get(recordEmployeeId)?.storeId || '').trim(),
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
