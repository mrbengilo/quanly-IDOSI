const sameId = (left, right) => String(left ?? '') === String(right ?? '')
const employeeId = (employee = {}) => String(employee?.id || employee?.code || employee?.employeeCode || '')
const explicitWorkDateOf = (record = {}) => String(record.date || record.workDate || '').slice(0, 10)
const attendanceDateOf = (record = {}) => String(record.date || record.workDate || record.checkInAt || record.createdAt || '').slice(0, 10)
const shiftIdOf = (record = {}) => String(record.shiftId || record.shift || '')

const addScope = (scopes, storeId, shiftId) => {
  if (!storeId || !shiftId) return
  scopes.add(`${String(storeId)}\u0000${String(shiftId)}`)
}

export const taskCompletedByEmployee = (task = {}, id) => Boolean(
  id && task.completedBy && task.completedBy[String(id)],
)

export const employeeTaskScopesForDate = ({ schedule = [], attendance = [], employee = {}, workDate } = {}) => {
  const id = employeeId(employee)
  const scopes = new Set()

  schedule.forEach((assignment) => {
    const assignmentDate = explicitWorkDateOf(assignment)
    if (assignment.deletedAt || !sameId(assignment.employeeId, id) || (assignmentDate && assignmentDate !== workDate)) return
    const storeId = assignment.storeId || employee?.storeId
    ;(assignment.shiftIds || []).forEach((shiftId) => addScope(scopes, storeId, shiftId))
  })

  attendance.forEach((record) => {
    if (
      record.deletedAt
      || !sameId(record.employeeId, id)
      || attendanceDateOf(record) !== workDate
      || record.checkOutAt
      || record.checkOut
    ) return
    addScope(scopes, record.storeId || employee?.storeId, shiftIdOf(record))
  })

  return scopes
}

export const employeeTasksForDate = ({ tasks = [], schedule = [], attendance = [], employee = {}, workDate } = {}) => {
  const id = employeeId(employee)
  const scopes = employeeTaskScopesForDate({ schedule, attendance, employee, workDate })

  return tasks.filter((task) => (
    explicitWorkDateOf(task) === workDate
    && (!task.employeeId || sameId(task.employeeId, id))
    && scopes.has(`${String(task.storeId || '')}\u0000${shiftIdOf(task)}`)
  ))
}
