const dateOnly = (value) => String(value || '').slice(0, 10)

export const supportScheduleEmploymentMode = (employee = {}) => {
  const normalized = String(employee.employmentType || employee.workTimeType || '').normalize('NFD').replace(/[\u0300-\u036f]/gu, '').toLowerCase()
  return normalized.includes('part') || normalized.includes('thuc tap') ? 'shift' : 'fixed'
}

export const supportScheduleRange = (anchorDate, view = 'day') => {
  const anchor = new Date(`${dateOnly(anchorDate)}T00:00:00`)
  if (Number.isNaN(anchor.getTime())) return { start: '', end: '' }
  const start = new Date(anchor)
  const end = new Date(anchor)
  if (view === 'week') {
    end.setDate(start.getDate() + 6)
  } else if (view === 'month') {
    start.setDate(1)
    end.setMonth(start.getMonth() + 1, 0)
  }
  const format = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
  return { start: format(start), end: format(end) }
}

export const supportScheduleDays = (anchorDate, view = 'day') => {
  const { start, end } = supportScheduleRange(anchorDate, view)
  if (!start || !end) return []
  const cursor = new Date(`${start}T00:00:00Z`)
  const last = new Date(`${end}T00:00:00Z`)
  const dates = []
  while (cursor <= last) {
    dates.push(cursor.toISOString().slice(0, 10))
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return dates
}

export const supportSchedulesForView = (records = [], { employeeId, anchorDate, view = 'day' } = {}) => {
  const { start, end } = supportScheduleRange(anchorDate, view)
  return records.filter((record) => (
    !record.deletedAt
    && (!employeeId || String(record.employeeId || '') === String(employeeId))
    && dateOnly(record.date) >= start
    && dateOnly(record.date) <= end
  )).sort((left, right) => `${left.date} ${left.start}`.localeCompare(`${right.date} ${right.start}`))
}
