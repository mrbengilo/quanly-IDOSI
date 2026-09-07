import { supportTransferBounds, supportTransferIsUsable } from './supportTransferTime.js'

const key = (value) => String(value || '').trim().toLowerCase()
const statusKey = (value) => key(value)
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/gu, '')
  .replaceAll('đ', 'd')
const list = (value) => Array.isArray(value) ? value : []
const employeeKey = (record) => key(typeof record === 'object'
  ? record?.employeeId || record?.employee_id || record?.employeeCode || record?.employee_code
  : record)
const employeeIdentifierKeys = (record = {}) => [...new Set([
  record.id,
  record.code,
  record.employeeId,
  record.employee_id,
  record.employeeCode,
  record.employee_code,
].map(key).filter(Boolean))]
const employeeIdentity = (state, value) => {
  const reference = employeeKey(value)
  if (!reference) return { key: '', identifiers: [], employee: null }
  const matches = list(state.employees).filter((record) => employeeIdentifierKeys(record).includes(reference))
  if (matches.length !== 1) return { key: reference, identifiers: [reference], employee: null }
  const employee = matches[0]
  const identifiers = employeeIdentifierKeys(employee)
  return { key: identifiers[0] || reference, identifiers, employee }
}
const sameEmployee = (state, left, right) => {
  const leftKey = employeeKey(left)
  const rightKey = employeeKey(right)
  if (!leftKey || !rightKey) return false
  if (leftKey === rightKey) return true
  const leftIdentity = employeeIdentity(state, left)
  const rightIdentity = employeeIdentity(state, right)
  return Boolean(leftIdentity.employee && leftIdentity.employee === rightIdentity.employee)
}
export const sameScheduleIdentifier = (left, right) => Boolean(key(left)) && key(left) === key(right)
export const supportAllowsScheduling = (transfer) => Boolean(transfer)
  && supportTransferIsUsable(transfer) && !transfer.schedulingClosedAt
const CANCELLED_SCHEDULE_STATUSES = new Set([
  'da xoa', 'xoa', 'da huy', 'huy', 'cancelled', 'canceled', 'void', 'voided', 'deleted',
])
export const scheduleAssignmentIsUsable = (assignment) => Boolean(assignment)
  && !assignment.deletedAt
  && !assignment.cancelledAt
  && !assignment.canceledAt
  && !CANCELLED_SCHEDULE_STATUSES.has(statusKey(assignment.status))

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
  if (!scheduleAssignmentIsUsable(assignment)
    || (employeeId && !sameEmployee(state, assignment, employeeId))
    || (storeId && key(assignment.storeId) !== key(storeId))) return []
  const identity = employeeIdentity(state, assignment)
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
      assignmentId: assignment.id,
      employeeId: assignment.employeeId || assignment.employee_id || assignment.employeeCode || assignment.employee_code,
      employeeIdentifierKeys: identity.identifiers,
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
    if (!supportAllowsScheduling(transfer) || !sameEmployee(state, transfer, window)
      || key(transfer.toStoreId) !== key(window.storeId)
      || (window.supportTransferId && key(window.supportTransferId) !== key(transfer.id))) return false
    const bounds = supportTransferBounds(transfer)
    return bounds && !window.invalid && bounds.startMs <= window.startMs && window.endMs <= bounds.endMs
  })
  return matches.length === 1 ? matches[0] : null
}

export const attendanceMatchesWindow = (record, window) => !record?.deletedAt
  && (employeeKey(record) === employeeKey(window)
    || list(window.employeeIdentifierKeys).includes(employeeKey(record)))
  && key(record.storeId) === key(window.storeId)
  && key(record.shiftId || record.shift) === key(window.shiftId)
  && (record.scheduledWorkDate || record.workDate || record.date || record.attendanceDate) === window.date

export const scheduledCheckInChoices = (state, employeeId, at, earlyMinutes = 0) => {
  const now = new Date(at).getTime()
  const employee = employeeIdentity(state, employeeId).employee
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
    const conflict = windows.find((other) => other !== window && sameEmployee(state, other, window)
      && (other.invalid || windowsOverlap(window, other)))
    if (conflict) return { code: 'SCHEDULE_TIME_OVERLAP', window, conflict }
    const employee = employeeIdentity(state, window).employee
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
    .filter(supportAllowsScheduling)
    .flatMap((record) => {
      const bounds = supportTransferBounds(record)
      return bounds ? [bounds.startMs, bounds.endMs] : []
    })]
    .filter((epochMs) => epochMs > nowMs)
    .sort((left, right) => left - right)[0]
  return Number.isFinite(nextBoundary) ? Math.max(0, nextBoundary - nowMs) : null
}

const uniqueScheduleReferences = (values = []) => [...new Map(list(values).filter(Boolean)
  .map((value) => [key(value), value])).values()]

const scheduleShiftSnapshot = (state, storeId, shiftId, previousSnapshots = []) => {
  const previous = list(previousSnapshots).find((snapshot) => sameScheduleIdentifier(snapshot.id, shiftId))
  if (previous) return previous
  const scoped = list(state.shiftDefinitions).filter((definition) => sameScheduleIdentifier(definition.id, shiftId)
    && sameScheduleIdentifier(definition.storeId, storeId))
  const global = list(state.shiftDefinitions).filter((definition) => sameScheduleIdentifier(definition.id, shiftId)
    && !String(definition.storeId || '').trim())
  const shift = scoped.length === 1 ? scoped[0] : !scoped.length && global.length === 1 ? global[0] : null
  return shift
    ? { id: shift.id, name: shift.name, start: shift.start, end: shift.end, color: shift.color, version: shift.version }
    : { id: shiftId }
}

export const buildLocalScheduleAssignments = (state = {}, {
  employeeIds = [], shiftIds = [], storeId = '', date = '', note = '', actor, createId,
} = {}) => {
  const now = new Date().toISOString()
  const schedule = [...list(state.schedule)]
  const assignments = []
  const selectedEmployeeIds = uniqueScheduleReferences(employeeIds)
  const selectedShiftIds = uniqueScheduleReferences(shiftIds)
  selectedEmployeeIds.forEach((employeeId) => {
    const index = schedule.findIndex((record) => sameScheduleIdentifier(record.storeId, storeId)
      && sameEmployee(state, record, employeeId)
      && String(record.date || record.workDate || '') === String(date))
    const current = index >= 0 ? schedule[index] : {
      id: createId(), employeeId, storeId, date, shiftIds: [], createdAt: now, createdBy: actor,
    }
    const mergedShiftIds = uniqueScheduleReferences([...(current.shiftIds || []), ...selectedShiftIds])
    const assignment = {
      ...current,
      id: current.id || createId(),
      storeId,
      date,
      shiftId: mergedShiftIds[0],
      shiftIds: mergedShiftIds,
      shiftSnapshots: mergedShiftIds.map((shiftId) => scheduleShiftSnapshot(state, storeId, shiftId, current.shiftSnapshots)),
      note: note || current.note || '',
      updatedAt: now,
      updatedBy: actor,
    }
    if (index >= 0) schedule[index] = assignment
    else schedule.unshift(assignment)
    assignments.push(assignment)
  })
  return {
    schedule,
    assignments,
    conflict: scheduleConflict({ ...state, schedule }, assignments),
  }
}

export const buildLocalScheduleDayReplacement = (state = {}, {
  assignments = [], storeId = '', date = '', actor, createId,
} = {}) => {
  const now = new Date().toISOString()
  const selectedAssignments = [...new Map(list(assignments).filter((item) => item?.employeeId)
    .map((item) => [key(item.employeeId), item])).values()]
  const nextDay = selectedAssignments.map((item) => {
    const previous = list(state.schedule).find((record) => sameScheduleIdentifier(record.storeId, storeId)
      && String(record.date || record.workDate || '') === String(date)
      && sameEmployee(state, record, item.employeeId))
    const normalizedShiftIds = uniqueScheduleReferences(item.shiftIds)
    return {
      ...previous,
      ...item,
      id: previous?.id || item.id || createId(),
      storeId,
      date,
      shiftId: normalizedShiftIds[0],
      shiftIds: normalizedShiftIds,
      shiftSnapshots: normalizedShiftIds.map((shiftId) => scheduleShiftSnapshot(
        state, storeId, shiftId, previous?.shiftSnapshots,
      )),
      createdAt: previous?.createdAt || now,
      createdBy: previous?.createdBy || actor,
      updatedAt: now,
      updatedBy: actor,
    }
  })
  const schedule = [
    ...nextDay,
    ...list(state.schedule).filter((record) => !(sameScheduleIdentifier(record.storeId, storeId)
      && String(record.date || record.workDate || '') === String(date))),
  ]
  return {
    schedule,
    assignments: nextDay,
    conflict: scheduleConflict({ ...state, schedule }, nextDay),
  }
}
