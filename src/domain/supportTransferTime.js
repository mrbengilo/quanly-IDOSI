const VIETNAM_TIME_ZONE = 'Asia/Ho_Chi_Minh'
const VIETNAM_OFFSET = '+07:00'
// Contract: UI values are strict YYYY-MM-DDTHH:mm in Vietnam time; persisted
// startAt/endAt are canonical ISO instants and the active range is [startAt, endAt).
const LOCAL_DATE_TIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/u
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/u

const vietnamDateTimeFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: VIETNAM_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

const formatterParts = (value) => Object.fromEntries(
  vietnamDateTimeFormatter.formatToParts(value).map(({ type, value: partValue }) => [type, partValue]),
)

const calendarDateIsValid = (year, month, day) => {
  const parsed = new Date(Date.UTC(year, month - 1, day))
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() + 1 === month
    && parsed.getUTCDate() === day
}

const localDateTimeParts = (value) => {
  const match = String(value || '').trim().match(LOCAL_DATE_TIME_PATTERN)
  if (!match) return null
  const [, rawYear, rawMonth, rawDay, rawHour, rawMinute] = match
  const year = Number(rawYear)
  const month = Number(rawMonth)
  const day = Number(rawDay)
  const hour = Number(rawHour)
  const minute = Number(rawMinute)
  if (!calendarDateIsValid(year, month, day) || hour > 23 || minute > 59) return null
  const local = `${rawYear}-${rawMonth}-${rawDay}T${rawHour}:${rawMinute}`
  const epochMs = Date.parse(`${local}:00${VIETNAM_OFFSET}`)
  return Number.isFinite(epochMs) ? { local, epochMs } : null
}

const dateOnlyParts = (value) => {
  const match = String(value || '').trim().match(DATE_PATTERN)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  return calendarDateIsValid(year, month, day)
    ? { year, month, day, date: `${match[1]}-${match[2]}-${match[3]}` }
    : null
}

const addCalendarDays = (value, days) => {
  const parts = dateOnlyParts(value)
  if (!parts) return ''
  const next = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days))
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-${String(next.getUTCDate()).padStart(2, '0')}`
}

const epochFromDateTime = (value) => {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.getTime()
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  const source = String(value || '').trim()
  const local = localDateTimeParts(source)
  if (local) return local.epochMs
  const parsed = Date.parse(source)
  return Number.isFinite(parsed) ? parsed : null
}

const localInputFromEpoch = (epochMs) => {
  if (!Number.isFinite(epochMs)) return ''
  const parts = formatterParts(new Date(epochMs))
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`
}

export const isVietnamDateTimeLocal = (value) => Boolean(localDateTimeParts(value))

export const vietnamDateTimeLocalToIso = (value) => {
  const parsed = localDateTimeParts(value)
  return parsed ? new Date(parsed.epochMs).toISOString() : ''
}

export const toVietnamDateTimeInput = (value = new Date()) => {
  const epochMs = epochFromDateTime(value)
  return epochMs == null ? '' : localInputFromEpoch(epochMs)
}

export const formatVietnamTransferDateTime = (value) => {
  const local = toVietnamDateTimeInput(value)
  if (!local) return '—'
  const [date, time] = local.split('T')
  const [year, month, day] = date.split('-')
  return `${day}/${month}/${year} ${time}`
}

export const legacyTransferStartAt = (record = {}) => {
  const date = dateOnlyParts(record.fromDate || record.startDate || record.date)?.date
  return date ? `${date}T00:00` : ''
}

export const legacyTransferEndAt = (record = {}) => {
  const date = dateOnlyParts(record.toDate || record.endDate || record.date)?.date
  const exclusiveDate = date ? addCalendarDays(date, 1) : ''
  return exclusiveDate ? `${exclusiveDate}T00:00` : ''
}

export const supportTransferBounds = (record = {}) => {
  const startSource = record.startAt || legacyTransferStartAt(record)
  const endSource = record.endAt || legacyTransferEndAt(record)
  const startMs = epochFromDateTime(startSource)
  const endMs = epochFromDateTime(endSource)
  if (startMs == null || endMs == null || endMs <= startMs) return null
  return {
    startMs,
    endMs,
    startAt: new Date(startMs).toISOString(),
    endAt: new Date(endMs).toISOString(),
    startLocal: localInputFromEpoch(startMs),
    endLocal: localInputFromEpoch(endMs),
  }
}

export const supportTransferIsHistoricallyUsable = (record = {}) => (
  !record.deletedAt
  && !record.revokedAt
  && !record.cancelledAt
  && record.active !== false
  && !['đã xóa', 'đã hủy', 'từ chối', 'đã từ chối', 'không hợp lệ', 'rejected', 'invalid', 'inactive', 'cancelled', 'canceled', 'revoked', 'deleted']
    .includes(String(record.status || '').trim().toLocaleLowerCase('vi'))
)

export const supportTransferIsUsable = (record = {}) => (
  supportTransferIsHistoricallyUsable(record)
  && !['hoàn tất', 'completed'].includes(String(record.status || '').trim().toLocaleLowerCase('vi'))
)

export const isSupportTransferActiveAt = (record, at = new Date()) => {
  if (!supportTransferIsUsable(record)) return false
  const bounds = supportTransferBounds(record)
  const atMs = epochFromDateTime(at)
  return Boolean(bounds && atMs != null && bounds.startMs <= atMs && atMs < bounds.endMs)
}

export const supportTransferOverlapsDate = (record, date) => {
  if (!supportTransferIsHistoricallyUsable(record)) return false
  const normalizedDate = dateOnlyParts(date)?.date
  const bounds = supportTransferBounds(record)
  if (!normalizedDate || !bounds) return false
  const dayStart = localDateTimeParts(`${normalizedDate}T00:00`)?.epochMs
  const dayEnd = localDateTimeParts(`${addCalendarDays(normalizedDate, 1)}T00:00`)?.epochMs
  return Number.isFinite(dayStart) && Number.isFinite(dayEnd)
    && bounds.startMs < dayEnd
    && bounds.endMs > dayStart
}

export const activeSupportTransferOverlapsDate = (record, date) => (
  supportTransferIsUsable(record) && supportTransferOverlapsDate(record, date)
)

export const supportTransferMatchesMoment = (record, moment = new Date()) => {
  const source = String(moment || '').trim()
  return DATE_PATTERN.test(source)
    ? activeSupportTransferOverlapsDate(record, source)
    : isSupportTransferActiveAt(record, moment)
}
