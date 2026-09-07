import { supportTransferBounds, supportTransferIsUsable } from './supportTransferTime.js'

const key = (value) => String(value || '').trim().toLowerCase()
const list = (value) => Array.isArray(value) ? value : []
const employeeKey = (record) => key(record?.employeeId || record?.employeeCode)
export const sameScheduleIdentifier = (left, right) => Boolean(key(left)) && key(left) === key(right)
export const supportAllowsScheduling = (transfer) => Boolean(transfer)
  && supportTransferIsUsable(transfer) && !transfer.schedulingClosedAt

export const shiftWindow = (date, shift = {}) => {
  const times = String(shift.time || '').match(/(\d{1,2}:\d{2})\s*[-–]\s*(\d{1,2}:\d{2})/u)
  const start = String(shift.start || shift.shiftStart || times?.[1] || '').padStart(5, '0')
  const end = String(shift.end || shift.shiftEnd || times?.[2] || '').padStart(5, '0')
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(String(date))
    || !/^(?:[01]\d|2[0-3]):[0-5]\d$/u.test(start)
    || !/^(?:[01]\d|2[0-3]):[0-5]\d$/u.test(end) || start === end) return null
  const startMs = Date.parse(`${date}T${start}:00+07:00`)
  let endMs = Date.parse(`${date}T${end}:00+07:00`)
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return null
  if (new Date(startMs + 7 * 3_600_000).toISOString().slice(0, 10) !== date) return null
  if (endMs < startMs) endMs += 86_400_000
  return { startMs, endMs, start, end, startAt: new Date(startMs).toISOString(), endAt: new Date(endMs).toISOString() }
}

export const scheduleWindows = (state = {}, { employeeId = '', storeId = '' } = {}) => list(state.schedule).flatMap((assignment) => {
  if (!assignment || assignment.deletedAt || assignment.cancelledAt || assignment.status === 'Đã hủy'
    || (employeeId && employeeKey(assignment) !== key(employeeId))
    || (storeId && key(assignment.storeId) !== key(storeId))) return []
  const date = assignment.date || assignment.workDate
  const ids = [...new Map(list(assignment.shiftIds?.length ? assignment.shiftIds : [assignment.shiftId])
    .filter(Boolean).map((id) => [key(id), id])).values()]
  return ids.flatMap((id) => {
    const snapshots = list(assignment.shiftSnapshots).filter((shift) => key(shift.id) === key(id))
    const definitions = list(state.shiftDefinitions).filter((shift) => key(shift.id) === key(id)
      && (!shift.storeId || key(shift.storeId) === key(assignment.storeId)))
    const matches = snapshots.length ? snapshots : definitions
    const snapshot = snapshots.length === 1 ? snapshots[0] : null
    const definition = definitions.length === 1 ? definitions[0] : null
    const shift = matches.length !== 1 ? null : snapshot && !shiftWindow(date, snapshot) && definition
      ? { ...definition, ...snapshot, start: snapshot.start || definition.start, end: snapshot.end || definition.end }
      : matches[0]
    const bounds = shift && shiftWindow(date, shift)
    return [{
      assignmentId: assignment.id, employeeId: assignment.employeeId || assignment.employeeCode,
      storeId: assignment.storeId, date, shiftId: id, shift, invalid: !bounds,
      supportTransferId: shift?.supportTransferId || assignment.supportTransferId || '',
      ...(bounds || {}),
    }]
  })
})

export const windowsOverlap = (left, right) => !left.invalid && !right.invalid
  && left.startMs < right.endMs && right.startMs < left.endMs

export const supportForScheduledWindow = (state, window) => {
  const matches = list(state.supportTransfers).filter((transfer) => {
    if (!supportAllowsScheduling(transfer) || employeeKey(transfer) !== employeeKey(window)
      || key(transfer.toStoreId) !== key(window.storeId)
      || (window.supportTransferId && key(window.supportTransferId) !== key(transfer.id))) return false
    const bounds = supportTransferBounds(transfer)
    return bounds && !window.invalid && bounds.startMs <= window.startMs && window.endMs <= bounds.endMs
  })
  return matches.length === 1 ? matches[0] : null
}

export const attendanceMatchesWindow = (record, window) => !record?.deletedAt
  && employeeKey(record) === employeeKey(window) && key(record.storeId) === key(window.storeId)
  && key(record.shiftId || record.shift) === key(window.shiftId)
  && (record.scheduledWorkDate || record.workDate || record.date || record.attendanceDate) === window.date

export const scheduledCheckInChoices = (state, employeeId, at, earlyMinutes = 0) => {
  const now = new Date(at).getTime()
  const employee = list(state.employees).find((record) => [record.id, record.code].some((id) => key(id) === key(employeeId)))
  if (!employee || !Number.isFinite(now)) return []
  return scheduleWindows(state, { employeeId }).filter((window) => {
    if (window.invalid || now < window.startMs - Math.max(0, earlyMinutes) * 60_000 || now >= window.endMs
      || list(state.attendance).some((record) => attendanceMatchesWindow(record, window))) return false
    if (key(window.storeId) === key(employee.storeId)) return true
    const transfer = supportForScheduledWindow(state, window)
    const bounds = transfer && supportTransferBounds(transfer)
    return bounds && bounds.startMs <= now && now < bounds.endMs
  })
}

// Reports the first conflict but checks every selected employee against all
// stores and adjacent dates. Call inside the same CAS transaction as the write.
export const scheduleConflict = (state, assignments = []) => {
  const selected = new Set(assignments.map((record) => String(record.id)))
  const windows = scheduleWindows(state)
  for (const window of windows.filter((item) => selected.has(String(item.assignmentId)))) {
    if (window.invalid) return { code: 'SCHEDULE_TIME_INVALID', window }
    const conflict = windows.find((other) => other !== window && employeeKey(other) === employeeKey(window)
      && (other.invalid || windowsOverlap(window, other)))
    if (conflict) return { code: 'SCHEDULE_TIME_OVERLAP', window, conflict }
    const employee = list(state.employees).find((record) => [record.id, record.code].some((id) => key(id) === employeeKey(window)))
    if (!employee || (key(window.storeId) !== key(employee.storeId) && !supportForScheduledWindow(state, window))) {
      return { code: 'SUPPORT_SCHEDULE_OUTSIDE_WINDOW', window }
    }
  }
  return null
}

export const nextSupportTransferBoundaryDelay = (transfers = [], at = Date.now(), scheduleBoundaries = []) => {
  const nowMs = at instanceof Date ? at.getTime() : Number(at)
  if (!Number.isFinite(nowMs)) return null
  const nextBoundary = [...scheduleBoundaries, ...transfers
    .filter((record) => !record?.deletedAt && !['Đã xóa', 'Đã hủy', 'Hoàn tất'].includes(String(record?.status || '')))
    .flatMap((record) => {
      const bounds = supportTransferBounds(record)
      return bounds ? [bounds.startMs, bounds.endMs] : []
    })]
    .filter((epochMs) => epochMs > nowMs)
    .sort((left, right) => left - right)[0]
  return Number.isFinite(nextBoundary) ? Math.max(0, nextBoundary - nowMs) : null
}
