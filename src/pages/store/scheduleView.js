export const STORE_SHIFT_COLOR_PALETTE = Object.freeze([
  '#ff3d71', '#7c3aed', '#00a6fb', '#00b894', '#ff8a00',
  '#e84393', '#3a86ff', '#8ac926', '#ff595e', '#00c2d1',
])

const identity = (value) => String(value || '')
const rawDate = (value) => String(value || '').slice(0, 10)

const parseCalendarDate = (value) => {
  const text = rawDate(value)
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/u)
  if (!match) return null
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
  if (date.getUTCFullYear() !== Number(match[1])
    || date.getUTCMonth() !== Number(match[2]) - 1
    || date.getUTCDate() !== Number(match[3])) return null
  return date
}

const calendarDate = (date) => date?.toISOString().slice(0, 10) || ''

export const storeScheduleDate = (value) => calendarDate(parseCalendarDate(value))

export const vietnamScheduleDate = (value = new Date()) => {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date)
}

const moveCalendarDays = (value, amount) => {
  const date = parseCalendarDate(value)
  if (!date) return ''
  date.setUTCDate(date.getUTCDate() + amount)
  return calendarDate(date)
}

export const storeScheduleRange = (anchorDate, view = 'day') => {
  const anchor = parseCalendarDate(anchorDate)
  if (!anchor) return { from: '', to: '', dates: [] }
  const from = new Date(anchor)
  const to = new Date(anchor)
  if (view === 'week') {
    const mondayOffset = (from.getUTCDay() + 6) % 7
    from.setUTCDate(from.getUTCDate() - mondayOffset)
    to.setTime(from.getTime())
    to.setUTCDate(from.getUTCDate() + 6)
  } else if (view === 'month') {
    from.setUTCDate(1)
    to.setUTCMonth(from.getUTCMonth() + 1, 0)
  }
  const start = calendarDate(from)
  const end = calendarDate(to)
  const dates = []
  for (let cursor = start; cursor && cursor <= end; cursor = moveCalendarDays(cursor, 1)) dates.push(cursor)
  return { from: start, to: end, dates }
}

export const moveStoreScheduleDate = (anchorDate, view = 'day', direction = 1) => {
  const anchor = parseCalendarDate(anchorDate)
  const amount = Number(direction)
  if (!anchor || !Number.isFinite(amount)) return ''
  if (view === 'month') {
    const target = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + amount, 1))
    const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate()
    target.setUTCDate(Math.min(anchor.getUTCDate(), lastDay))
    return calendarDate(target)
  }
  anchor.setUTCDate(anchor.getUTCDate() + amount * (view === 'week' ? 7 : 1))
  return calendarDate(anchor)
}

const clockMinutes = (value) => {
  const match = String(value || '').match(/^([01]\d|2[0-3]):([0-5]\d)$/u)
  return match ? Number(match[1]) * 60 + Number(match[2]) : null
}

export const scheduleShiftIsOvernight = (shift = {}) => {
  const start = clockMinutes(shift.start)
  const end = clockMinutes(shift.end)
  return start != null && end != null && end < start
}

export const scheduleShiftDurationMinutes = (shift = {}) => {
  const start = clockMinutes(shift.start)
  const end = clockMinutes(shift.end)
  if (start == null || end == null) return 0
  return end >= start ? end - start : end + 24 * 60 - start
}

export const scheduleShiftTimeLabel = (shift = {}) => {
  if (!shift.start || !shift.end) return 'Chưa thiết lập'
  return `${shift.start} - ${shift.end}${scheduleShiftIsOvernight(shift) ? ' (+1 ngày)' : ''}`
}

export const scheduleShiftDurationLabel = (shift = {}) => {
  const minutes = scheduleShiftDurationMinutes(shift)
  if (!minutes) return '—'
  const hours = Math.floor(minutes / 60)
  const remainder = minutes % 60
  return remainder ? `${hours} giờ ${remainder} phút` : `${hours} giờ`
}

export const stableScheduleShiftColor = (storeId, shiftId) => {
  const key = `${identity(storeId)}:${identity(shiftId)}`
  let hash = 2166136261
  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return STORE_SHIFT_COLOR_PALETTE[(hash >>> 0) % STORE_SHIFT_COLOR_PALETTE.length]
}

export const scheduleShiftIds = (record = {}) => {
  const values = Array.isArray(record.shiftIds) && record.shiftIds.length
    ? record.shiftIds
    : record.shiftId ? [record.shiftId] : []
  return [...new Set(values.map(identity).filter(Boolean))]
}

export const storeScheduleRecordMatches = (record = {}, storeId = '') => {
  const requestedStoreId = identity(storeId)
  const recordStoreId = identity(record.storeId)
  return !requestedStoreId || !recordStoreId || recordStoreId === requestedStoreId
}

const definitionMatchesStore = (definition = {}, storeId = '') => {
  const requestedStoreId = identity(storeId)
  const definitionStoreId = identity(definition.storeId)
  return !requestedStoreId || !definitionStoreId || definitionStoreId === requestedStoreId
}

const nonEmpty = (...values) => values.find((value) => value !== undefined && value !== null && String(value).trim() !== '')

const definitionForShift = (definitions, shiftId, storeId) => {
  const candidates = (Array.isArray(definitions) ? definitions : []).filter((definition) => (
    identity(definition.id) === identity(shiftId) && definitionMatchesStore(definition, storeId)
  ))
  return candidates.find((definition) => identity(definition.storeId) === identity(storeId)) || candidates[0] || null
}

export const resolveStoreScheduleShift = ({ record = {}, shiftId, shiftDefinitions = [], storeId = '' } = {}) => {
  const id = identity(shiftId)
  if (!id || !storeScheduleRecordMatches(record, storeId)) return null
  const effectiveStoreId = identity(record.storeId || storeId)
  const snapshot = (Array.isArray(record.shiftSnapshots) ? record.shiftSnapshots : [])
    .find((item) => identity(item?.id) === id) || null
  const definition = definitionForShift(shiftDefinitions, id, effectiveStoreId)
  const ids = scheduleShiftIds(record)
  const legacyApplies = ids.length <= 1 || identity(record.shiftId) === id
  const legacyName = legacyApplies ? nonEmpty(record.shiftName, record.name) : undefined
  const legacyStart = legacyApplies ? nonEmpty(record.shiftStart, record.start) : undefined
  const legacyEnd = legacyApplies ? nonEmpty(record.shiftEnd, record.end) : undefined
  const start = nonEmpty(snapshot?.start, definition?.start, legacyStart) || ''
  const end = nonEmpty(snapshot?.end, definition?.end, legacyEnd) || ''
  const name = nonEmpty(snapshot?.name, definition?.name, legacyName) || `Ca ${id}`
  const color = nonEmpty(snapshot?.color, definition?.color, legacyApplies ? record.shiftColor : undefined)
    || stableScheduleShiftColor(effectiveStoreId, id)
  const calculatedDuration = scheduleShiftDurationMinutes({ start, end })
  const durationMinutes = calculatedDuration || Number(nonEmpty(snapshot?.durationMinutes, definition?.durationMinutes) || 0)
  return {
    ...(definition || {}),
    ...(snapshot || {}),
    id,
    storeId: effectiveStoreId,
    name,
    start,
    end,
    time: start && end ? scheduleShiftTimeLabel({ start, end }) : nonEmpty(snapshot?.time, definition?.time, record.shiftTime) || '',
    color,
    durationMinutes,
    durationHours: durationMinutes / 60,
    snapshot: Boolean(snapshot),
    source: snapshot ? 'snapshot' : definition ? 'definition' : legacyName || legacyStart || legacyEnd ? 'record' : 'fallback',
    historical: Boolean(snapshot || definition?.deletedAt || definition?.active === false),
  }
}

export const resolveStoreScheduleRecordShifts = ({ record = {}, shiftDefinitions = [], storeId = '' } = {}) => (
  scheduleShiftIds(record).map((shiftId) => resolveStoreScheduleShift({ record, shiftId, shiftDefinitions, storeId })).filter(Boolean)
)

export const activeStoreShiftDefinitions = (shiftDefinitions = [], { storeId = '', date = '' } = {}) => {
  const byId = new Map()
  const candidates = (Array.isArray(shiftDefinitions) ? shiftDefinitions : []).filter((shift) => (
    shift.active !== false
    && !shift.deletedAt
    && definitionMatchesStore(shift, storeId)
    && (!shift.date || identity(shift.date) === identity(date))
  ))
  candidates.forEach((shift) => {
    const id = identity(shift.id)
    const previous = byId.get(id)
    const exactStore = identity(shift.storeId) === identity(storeId)
    const previousExactStore = identity(previous?.storeId) === identity(storeId)
    if (id && (!previous || (exactStore && !previousExactStore))) byId.set(id, shift)
  })
  return [...byId.values()].map((shift) => ({
      ...shift,
      color: shift.color || stableScheduleShiftColor(storeId || shift.storeId, shift.id),
      time: scheduleShiftTimeLabel(shift),
      durationMinutes: scheduleShiftDurationMinutes(shift) || Number(shift.durationMinutes || 0),
    }))
    .sort((left, right) => (
      String(left.start || '').localeCompare(String(right.start || ''))
      || String(left.name || '').localeCompare(String(right.name || ''), 'vi')
      || identity(left.id).localeCompare(identity(right.id))
    ))
}

export const storeScheduleShiftColumns = ({
  date,
  records = [],
  shiftDefinitions = [],
  storeId = '',
} = {}) => {
  const byId = new Map(activeStoreShiftDefinitions(shiftDefinitions, { storeId, date })
    .map((shift) => [identity(shift.id), shift]))
  records.filter((record) => (
    storeScheduleRecordMatches(record, storeId)
    && identity(record.date || record.workDate) === identity(date)
  )).forEach((record) => {
    resolveStoreScheduleRecordShifts({ record, shiftDefinitions, storeId }).forEach((shift) => {
      if (!byId.has(identity(shift.id))) byId.set(identity(shift.id), shift)
    })
  })
  return [...byId.values()].sort((left, right) => (
    String(left.start || '').localeCompare(String(right.start || ''))
    || String(left.name || '').localeCompare(String(right.name || ''), 'vi')
    || identity(left.id).localeCompare(identity(right.id))
  ))
}
