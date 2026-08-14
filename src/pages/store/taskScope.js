const sameId = (left, right) => String(left ?? '') === String(right ?? '')

const taskDate = (task = {}) => String(task.date || task.workDate || '').slice(0, 10)

export const taskShiftOptionsForDate = ({
  shiftDefinitions = [],
  fallbackShifts = [],
  storeId,
  date,
} = {}) => {
  const validDefinitions = shiftDefinitions.filter((shift) => (
    shift.active !== false
    && !shift.deletedAt
    && (!shift.storeId || sameId(shift.storeId, storeId))
    && (!shift.date || shift.date === date)
  ))
  const source = validDefinitions.length || shiftDefinitions.length
    ? validDefinitions
    : fallbackShifts

  return source.map((shift) => ({
    id: shift.id,
    name: shift.name,
    start: shift.start,
    end: shift.end,
  }))
}

export const selectTaskShiftForDate = ({ tasks = [], storeId, date, shiftOptions = [] } = {}) => {
  const optionIds = new Set(shiftOptions.map((shift) => String(shift.id)))
  const savedTask = tasks.find((task) => (
    sameId(task.storeId, storeId)
    && taskDate(task) === date
    && optionIds.has(String(task.shiftId || task.shift || ''))
  ))

  return savedTask?.shiftId || savedTask?.shift || shiftOptions[0]?.id || ''
}
