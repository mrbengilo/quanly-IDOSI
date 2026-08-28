import { normalizeClock, scheduleShiftIds } from './recordCompatibility.js'

const text = (value) => String(value || '').trim()
const firstClock = (...values) => {
  const value = values.map(text).find(Boolean) || ''
  return normalizeClock(value)
}

export class ScheduleResolutionError extends Error {
  constructor(record, shiftId = '', code = 'SHIFT_UNRESOLVED') {
    super('SCHEDULE_SHIFT_UNRESOLVED')
    this.name = 'ScheduleResolutionError'
    this.scheduleId = text(record?.id)
    this.shiftId = text(shiftId)
    this.code = code
  }
}

export const resolveScheduleRecordOwnership = ({
  record = {}, selectedStoreId = '', employeeWorksAtSelectedStore,
  effectiveEmployeeStoreId = '', employeeStoreId = '',
} = {}) => {
  const selected = text(selectedStoreId)
  const explicit = text(record.storeId)
  const effective = text(effectiveEmployeeStoreId)
  const home = text(employeeStoreId)
  if (!selected) return { status: 'unresolved', code: 'SELECTED_STORE_MISSING', storeId: '' }
  if (explicit) return explicit === selected
    ? { status: 'selected', code: 'EXPLICIT_SELECTED_STORE', storeId: explicit }
    : { status: 'other', code: 'EXPLICIT_OTHER_STORE', storeId: explicit }
  if (employeeWorksAtSelectedStore !== undefined) {
    if (effective) return effective === selected && employeeWorksAtSelectedStore
      ? { status: 'selected', code: 'EFFECTIVE_SELECTED_STORE', storeId: effective }
      : { status: 'other', code: 'EFFECTIVE_OTHER_STORE', storeId: effective }
    return { status: 'unresolved', code: 'EMPLOYEE_STORE_UNRESOLVED', storeId: '' }
  }
  if (home) return home === selected
    ? { status: 'selected', code: 'LEGACY_HOME_STORE', storeId: home }
    : { status: 'other', code: 'LEGACY_OTHER_HOME_STORE', storeId: home }
  return { status: 'selected', code: 'CALLER_SCOPED_DISPLAY', storeId: selected }
}

const definitionFor = (definitions, shiftId, storeId) => {
  const matches = (Array.isArray(definitions) ? definitions : []).filter((definition) => (
    text(definition?.id) === shiftId
    && (!text(definition?.storeId) || text(definition.storeId) === storeId)
  ))
  return matches.find((definition) => text(definition.storeId) === storeId) || matches[0] || null
}

export const resolveScheduleRecordStore = ({
  record = {}, selectedStoreId = '', employeeStoreId = '',
  employeeWorksAtSelectedStore, effectiveEmployeeStoreId = '',
} = {}) => {
  const ownership = resolveScheduleRecordOwnership({
    record, selectedStoreId, employeeStoreId, employeeWorksAtSelectedStore, effectiveEmployeeStoreId,
  })
  return ownership.status === 'selected' ? ownership.storeId : ''
}

const resolveCanonicalScheduleRecordEntries = ({
  record = {}, shiftDefinitions = [], selectedStoreId = '', employeeStoreId = '',
  employeeWorksAtSelectedStore, effectiveEmployeeStoreId = '',
} = {}) => {
  const storeId = resolveScheduleRecordStore({
    record, selectedStoreId, employeeStoreId, employeeWorksAtSelectedStore, effectiveEmployeeStoreId,
  })
  if (!storeId) return [{ status: 'unresolved', error: new ScheduleResolutionError(record) }]
  const ids = scheduleShiftIds(record)
  const snapshots = Array.isArray(record.shiftSnapshots) ? record.shiftSnapshots : []
  const resolveId = (id) => {
    const shiftId = text(id)
    const snapshot = snapshots.find((item) => text(item?.id) === shiftId) || null
    const definition = definitionFor(shiftDefinitions, shiftId, storeId)
    const legacyApplies = ids.length <= 1 || text(record.shiftId) === shiftId
    const start = firstClock(snapshot?.start, definition?.start, legacyApplies && record.shiftStart, legacyApplies && record.start)
    const end = firstClock(snapshot?.end, definition?.end, legacyApplies && record.shiftEnd, legacyApplies && record.end)
    if (!shiftId || !start || !end) return { status: 'unresolved', error: new ScheduleResolutionError(record, shiftId) }
    return { status: 'resolved', shift: { ...(definition || {}), ...(snapshot || {}), id: shiftId, storeId, start, end,
      source: snapshot ? 'snapshot' : definition ? 'definition' : 'record' } }
  }
  if (ids.length) return ids.map(resolveId)
  if (snapshots.length) return snapshots.map((snapshot) => {
    const id = text(snapshot?.id)
    if (id) return resolveId(id)
    const start = firstClock(snapshot?.start)
    const end = firstClock(snapshot?.end)
    if (!start || !end) return { status: 'unresolved', error: new ScheduleResolutionError(record) }
    return { status: 'resolved', shift: { ...snapshot, storeId, start, end, source: 'snapshot' } }
  })
  const start = firstClock(record.start, record.shiftStart)
  const end = firstClock(record.end, record.shiftEnd)
  if (!start || !end) return [{ status: 'unresolved', error: new ScheduleResolutionError(record) }]
  return [{ status: 'resolved', shift: { ...record, storeId, start, end, source: 'record' } }]
}

export const resolveCanonicalScheduleRecordResult = (options = {}) => {
  const record = options.record || {}
  const entries = resolveCanonicalScheduleRecordEntries(options).map((entry) => {
    if (entry.status === 'resolved') return entry
    const error = entry.error
    return { status: 'unresolved', code: error.code, reason: error.message,
      scheduleId: error.scheduleId, shiftId: error.shiftId, record }
  })
  const shifts = entries.filter((entry) => entry.status === 'resolved').map((entry) => entry.shift)
  const unresolvedShifts = entries.filter((entry) => entry.status === 'unresolved')
  const firstUnresolved = unresolvedShifts[0] || {}
  return {
    status: unresolvedShifts.length ? shifts.length ? 'partial' : 'unresolved' : 'resolved',
    shifts,
    unresolvedShifts,
    entries,
    record,
    // Compatibility aliases for consumers of the former all-or-error result.
    code: firstUnresolved.code,
    reason: firstUnresolved.reason,
    scheduleId: firstUnresolved.scheduleId,
    shiftId: firstUnresolved.shiftId,
  }
}

export const requireResolvedScheduleRecord = (options = {}) => {
  const result = resolveCanonicalScheduleRecordResult(options)
  if (!result.unresolvedShifts.length) return result.shifts
  const unresolved = result.unresolvedShifts[0]
  throw new ScheduleResolutionError(result.record, unresolved.shiftId, unresolved.code)
}

// Backward-compatible strict API. Display readers must opt into
// displayScheduleRecordShifts() so partial records remain renderable.
export const resolveCanonicalScheduleRecord = (options = {}) => requireResolvedScheduleRecord(options)

const unresolvedDisplayShift = (entry, index) => {
  const record = entry.record
  const identifier = entry.shiftId || text(record.id) || `unresolved-${text(record.employeeId || record.employeeCode)}-${index}`
  return { ...record, id: identifier, shiftId: entry.shiftId || text(record.shiftId),
    name: text(record.shiftName || record.name) || 'Ca không xác định', start: '', end: '', time: '',
    source: 'unresolved', unresolved: true, resolutionCode: entry.code, resolutionReason: 'Thiếu dữ liệu ca' }
}

export const displayScheduleRecordShifts = (options = {}) => {
  const result = resolveCanonicalScheduleRecordResult(options)
  return result.entries.map((entry, index) => (
    entry.status === 'resolved' ? entry.shift : unresolvedDisplayShift(entry, index)
  ))
}
