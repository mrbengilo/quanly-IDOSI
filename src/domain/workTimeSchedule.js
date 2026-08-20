const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/u
export const MAX_WORK_TIME_SCHEDULE_ENTRIES = 120

const validCalendarDate = (value) => {
  const date = String(value || '').trim()
  const match = DATE_PATTERN.exec(date)
  if (!match) return ''
  const parsed = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
  return parsed.getUTCFullYear() === Number(match[1])
    && parsed.getUTCMonth() + 1 === Number(match[2])
    && parsed.getUTCDate() === Number(match[3])
    ? date
    : ''
}

const workingTimeFields = (record = {}) => ({
  workTimeType: record.workTimeType,
  workStart: record.workStart,
  workEnd: record.workEnd,
  workShifts: Array.isArray(record.workShifts)
    ? record.workShifts.map((shift) => ({ ...shift }))
    : undefined,
  workingTime: record.workingTime && typeof record.workingTime === 'object'
    ? {
        ...record.workingTime,
        shifts: Array.isArray(record.workingTime.shifts)
          ? record.workingTime.shifts.map((shift) => ({ ...shift }))
          : record.workingTime.shifts,
      }
    : undefined,
})

export const normalizeWorkTimeEffectiveDate = (value) => validCalendarDate(value)

export const workTimeScheduleEntries = (profile = {}) => {
  const byDate = new Map()
  ;(Array.isArray(profile.workTimeSchedule) ? profile.workTimeSchedule : []).forEach((entry) => {
    const effectiveFrom = validCalendarDate(entry?.effectiveFrom)
    if (!effectiveFrom || !entry || typeof entry !== 'object') return
    byDate.set(effectiveFrom, {
      ...entry,
      ...workingTimeFields(entry),
      effectiveFrom,
    })
  })
  return [...byDate.values()].toSorted((left, right) => left.effectiveFrom.localeCompare(right.effectiveFrom))
}

export const resolveEffectiveWorkingTime = (profile = {}, workDate) => {
  const date = validCalendarDate(workDate)
  const effective = date
    ? workTimeScheduleEntries(profile).findLast((entry) => entry.effectiveFrom <= date)
    : null
  return {
    ...profile,
    ...(effective ? workingTimeFields(effective) : {}),
    employmentType: effective?.employmentType || profile.employmentType,
    workTimeEffectiveFrom: effective?.effectiveFrom || null,
  }
}

export const upsertEffectiveWorkingTime = (profile = {}, effectiveFrom, configuration = {}, metadata = {}) => {
  const date = validCalendarDate(effectiveFrom)
  if (!date) throw new Error('Ngày áp dụng không hợp lệ.')
  const entries = workTimeScheduleEntries(profile)
  if (entries.length >= MAX_WORK_TIME_SCHEDULE_ENTRIES
    && !entries.some((entry) => entry.effectiveFrom === date)) {
    throw new Error(`Mỗi nhân viên chỉ được lưu tối đa ${MAX_WORK_TIME_SCHEDULE_ENTRIES} mốc thời gian làm việc.`)
  }
  const baselineDate = validCalendarDate(profile.startDate || profile.joinDate) || '1970-01-01'
  if (!entries.length && baselineDate < date) {
    entries.push({
      effectiveFrom: baselineDate,
      employmentType: profile.employmentType,
      ...workingTimeFields(profile),
      source: 'legacy-profile',
    })
  }
  const previous = entries.find((entry) => entry.effectiveFrom === date)
  const next = {
    ...(previous || {}),
    effectiveFrom: date,
    employmentType: configuration.employmentType || profile.employmentType,
    ...workingTimeFields(configuration),
    ...metadata,
  }
  return [...entries.filter((entry) => entry.effectiveFrom !== date), next]
    .toSorted((left, right) => left.effectiveFrom.localeCompare(right.effectiveFrom))
}
