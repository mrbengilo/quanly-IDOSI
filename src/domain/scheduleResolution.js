import { scheduleShiftIds } from './recordCompatibility.js'

const text = (value) => String(value || '').trim()
const validClock = (value) => /^([01]\d|2[0-3]):[0-5]\d$/u.test(text(value))
const firstClock = (...values) => {
  const value = values.map(text).find(Boolean) || ''
  return validClock(value) ? value : ''
}

export class ScheduleResolutionError extends Error {
  constructor(record, shiftId = '') {
    super('SCHEDULE_SHIFT_UNRESOLVED')
    this.name = 'ScheduleResolutionError'
    this.scheduleId = text(record?.id)
    this.shiftId = text(shiftId)
  }
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
  const selected = text(selectedStoreId)
  const explicit = text(record.storeId)
  const owned = text(employeeStoreId)
  const effective = text(effectiveEmployeeStoreId)
  if (!selected || (explicit && explicit !== selected)) return ''
  if (employeeWorksAtSelectedStore === false) return ''
  if (!explicit && employeeWorksAtSelectedStore !== undefined && effective !== selected) return ''
  // Backward-compatible reader context: callers without canonical employee
  // eligibility evidence may still scope storeless rows by known home ownership.
  if (employeeWorksAtSelectedStore === undefined && owned && owned !== selected) return ''
  return explicit || (employeeWorksAtSelectedStore !== undefined ? effective : owned || selected)
}

export const resolveCanonicalScheduleRecord = ({
  record = {}, shiftDefinitions = [], selectedStoreId = '', employeeStoreId = '',
  employeeWorksAtSelectedStore, effectiveEmployeeStoreId = '',
} = {}) => {
  const storeId = resolveScheduleRecordStore({
    record, selectedStoreId, employeeStoreId, employeeWorksAtSelectedStore, effectiveEmployeeStoreId,
  })
  if (!storeId) throw new ScheduleResolutionError(record)
  const ids = scheduleShiftIds(record)
  const snapshots = Array.isArray(record.shiftSnapshots) ? record.shiftSnapshots : []
  const resolveId = (id) => {
    const shiftId = text(id)
    const snapshot = snapshots.find((item) => text(item?.id) === shiftId) || null
    const definition = definitionFor(shiftDefinitions, shiftId, storeId)
    const legacyApplies = ids.length <= 1 || text(record.shiftId) === shiftId
    const start = firstClock(snapshot?.start, definition?.start, legacyApplies && record.shiftStart, legacyApplies && record.start)
    const end = firstClock(snapshot?.end, definition?.end, legacyApplies && record.shiftEnd, legacyApplies && record.end)
    if (!shiftId || !start || !end) throw new ScheduleResolutionError(record, shiftId)
    return { ...(definition || {}), ...(snapshot || {}), id: shiftId, storeId, start, end,
      source: snapshot ? 'snapshot' : definition ? 'definition' : 'record' }
  }
  if (ids.length) return ids.map(resolveId)
  if (snapshots.length) return snapshots.map((snapshot) => {
    const id = text(snapshot?.id)
    if (id) return resolveId(id)
    const start = firstClock(snapshot?.start)
    const end = firstClock(snapshot?.end)
    if (!start || !end) throw new ScheduleResolutionError(record)
    return { ...snapshot, storeId, start, end, source: 'snapshot' }
  })
  const start = firstClock(record.start, record.shiftStart)
  const end = firstClock(record.end, record.shiftEnd)
  if (!start || !end) throw new ScheduleResolutionError(record)
  return [{ ...record, storeId, start, end, source: 'record' }]
}
