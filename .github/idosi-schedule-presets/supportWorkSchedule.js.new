const rawDateOnly = (value) => String(value || '').slice(0, 10)

const SUPPORT_SCHEDULE_PRESET_BLUEPRINTS = [
  { id: 'morning', name: 'Ca sáng', start: '08:30', end: '12:00' },
  { id: 'afternoon', name: 'Ca chiều', start: '13:00', end: '17:30' },
  { id: 'office-hours', name: 'Giờ hành chính', start: '08:30', end: '17:30' },
]

export const SUPPORT_SCHEDULE_PRESETS = Object.freeze(
  SUPPORT_SCHEDULE_PRESET_BLUEPRINTS.map((preset) => Object.freeze({ ...preset })),
)

const normalizeTime = (value) => {
  const match = String(value || '').trim().match(/^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/u)
  return match ? `${match[1]}:${match[2]}` : ''
}

const timeMinutes = (value) => {
  const time = normalizeTime(value)
  if (!time) return null
  const [hour, minute] = time.split(':').map(Number)
  return (hour * 60) + minute
}

const normalizedPermissionToken = (value) => String(value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/gu, '')
  .replace(/[Đđ]/gu, 'd')
  .trim()
  .toLowerCase()

const presetInput = (record, fallback) => {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return { ...fallback }
  const start = normalizeTime(record.start)
  const end = normalizeTime(record.end)
  if (!start || !end || timeMinutes(end) <= timeMinutes(start)) return { ...fallback }
  return {
    ...record,
    id: fallback.id,
    name: fallback.name,
    start,
    end,
  }
}

export const normalizeSupportSchedulePresets = (records = []) => {
  const source = Array.isArray(records) ? records : []
  return SUPPORT_SCHEDULE_PRESETS.map((fallback) => {
    const matches = source.filter((record) => String(record?.id || '') === fallback.id)
    return matches.length === 1 ? presetInput(matches[0], fallback) : { ...fallback }
  })
}

export const validateSupportSchedulePresets = (records = []) => {
  if (!Array.isArray(records) || records.length !== SUPPORT_SCHEDULE_PRESETS.length) {
    return { ok: false, message: 'Cần cấu hình đầy đủ Ca sáng, Ca chiều và Giờ hành chính.' }
  }
  const allowedIds = new Set(SUPPORT_SCHEDULE_PRESETS.map(({ id }) => id))
  const submittedIds = records.map((record) => String(record?.id || ''))
  if (new Set(submittedIds).size !== SUPPORT_SCHEDULE_PRESETS.length
    || submittedIds.some((id) => !allowedIds.has(id))) {
    return { ok: false, message: 'Danh sách khung giờ cấu hình không hợp lệ.' }
  }

  const presets = []
  for (const fallback of SUPPORT_SCHEDULE_PRESETS) {
    const record = records.find((candidate) => String(candidate?.id || '') === fallback.id)
    const start = normalizeTime(record?.start)
    const end = normalizeTime(record?.end)
    if (!start || !end) {
      return { ok: false, message: `${fallback.name}: giờ bắt đầu hoặc giờ kết thúc chưa hợp lệ.` }
    }
    if (timeMinutes(end) <= timeMinutes(start)) {
      return { ok: false, message: `${fallback.name}: giờ kết thúc phải sau giờ bắt đầu.` }
    }
    presets.push({ id: fallback.id, name: fallback.name, start, end })
  }
  return { ok: true, presets }
}

export const supportSchedulePresetsEqual = (left = [], right = []) => {
  const leftPresets = normalizeSupportSchedulePresets(left)
  const rightPresets = normalizeSupportSchedulePresets(right)
  return SUPPORT_SCHEDULE_PRESETS.every(({ id }) => {
    const leftPreset = leftPresets.find((preset) => preset.id === id)
    const rightPreset = rightPresets.find((preset) => preset.id === id)
    return leftPreset?.start === rightPreset?.start && leftPreset?.end === rightPreset?.end
  })
}

export const canConfigureSupportSchedulePresets = ({ role, employee } = {}) => {
  const normalizedRole = normalizedPermissionToken(role)
  if (['admin', 'business_support', 'manager'].includes(normalizedRole)) return true
  if (normalizedRole !== 'employee') return false
  const unit = normalizedPermissionToken(employee?.unit || employee?.unitType || employee?.department)
  return ['office', 'van phong', 'khoi van phong', 'vp'].includes(unit)
}

const parseCalendarDate = (value) => {
  const text = rawDateOnly(value)
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/u)
  if (!match) return null
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
  if (date.getUTCFullYear() !== Number(match[1])
    || date.getUTCMonth() !== Number(match[2]) - 1
    || date.getUTCDate() !== Number(match[3])) return null
  return date
}

const formatCalendarDate = (date) => date?.toISOString().slice(0, 10) || ''

export const supportScheduleDate = (value) => formatCalendarDate(parseCalendarDate(value))

export const supportScheduleEmploymentMode = (employee = {}) => {
  const normalized = String(employee.employmentType || employee.workTimeType || '').normalize('NFD').replace(/[\u0300-\u036f]/gu, '').toLowerCase()
  return normalized.includes('part') || normalized.includes('thuc tap') ? 'shift' : 'fixed'
}

export const supportScheduleRange = (anchorDate, view = 'day') => {
  const anchor = parseCalendarDate(anchorDate)
  if (!anchor) return { start: '', end: '' }
  const start = new Date(anchor)
  const end = new Date(anchor)
  if (view === 'week') {
    end.setUTCDate(start.getUTCDate() + 6)
  } else if (view === 'month') {
    start.setUTCDate(1)
    end.setUTCMonth(start.getUTCMonth() + 1, 0)
  }
  return { start: formatCalendarDate(start), end: formatCalendarDate(end) }
}

export const supportScheduleDays = (anchorDate, view = 'day') => {
  const { start, end } = supportScheduleRange(anchorDate, view)
  if (!start || !end) return []
  const cursor = parseCalendarDate(start)
  const last = parseCalendarDate(end)
  const dates = []
  while (cursor <= last) {
    dates.push(formatCalendarDate(cursor))
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return dates
}

export const shiftSupportScheduleAnchor = (anchorDate, view = 'day', direction = 1) => {
  const anchor = parseCalendarDate(anchorDate)
  if (!anchor || !Number.isFinite(Number(direction))) return ''
  const amount = Number(direction)
  if (view === 'month') {
    const targetMonth = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + amount, 1))
    const lastDay = new Date(Date.UTC(targetMonth.getUTCFullYear(), targetMonth.getUTCMonth() + 1, 0)).getUTCDate()
    targetMonth.setUTCDate(Math.min(anchor.getUTCDate(), lastDay))
    return formatCalendarDate(targetMonth)
  }
  anchor.setUTCDate(anchor.getUTCDate() + amount * (view === 'week' ? 7 : 1))
  return formatCalendarDate(anchor)
}

export const supportSchedulesForView = (records = [], {
  employeeId,
  targetUnit,
  anchorDate,
  view = 'day',
} = {}) => {
  const { start, end } = supportScheduleRange(anchorDate, view)
  if (!start || !end) return []
  return records.filter((record) => (
    !record.deletedAt
    && (!employeeId || String(record.employeeId || '') === String(employeeId))
    && (!targetUnit || String(record.targetUnit || '') === String(targetUnit))
    && supportScheduleDate(record.date) >= start
    && supportScheduleDate(record.date) <= end
  )).sort((left, right) => (
    `${supportScheduleDate(left.date)} ${left.start || ''} ${left.id || ''}`
      .localeCompare(`${supportScheduleDate(right.date)} ${right.start || ''} ${right.id || ''}`)
  ))
}
