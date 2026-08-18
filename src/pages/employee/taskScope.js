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

const explicitAssigneeIds = (task = {}) => [
  task.employeeId,
  ...(Array.isArray(task.employeeIds) ? task.employeeIds : []),
  ...(Array.isArray(task.assigneeIds) ? task.assigneeIds : []),
  ...(Array.isArray(task.assignedEmployeeIds) ? task.assignedEmployeeIds : []),
].filter(Boolean).map(String)

const assignmentIdOf = (record = {}) => String(record.assignmentId || record.id || record.taskAssignmentId || record.batchId || '')

export const taskAssignedToEmployee = (task = {}, id) => {
  const assignees = explicitAssigneeIds(task)
  return assignees.length > 0 && assignees.includes(String(id))
}

export const employeeTaskAssignmentById = ({ assignmentId, taskAssignmentHistory = [], tasks = [], employee = {} } = {}) => {
  const requestedId = String(assignmentId || '').trim()
  const id = employeeId(employee)
  const storeId = String(employee?.storeId || '')
  if (!requestedId || !id || !storeId) return null

  const history = (Array.isArray(taskAssignmentHistory) ? taskAssignmentHistory : []).find((item) => (
    assignmentIdOf(item) === requestedId && sameId(item.storeId, storeId)
  ))
  const historyEmployeeIds = explicitAssigneeIds(history || {})
  const flatTasks = (Array.isArray(tasks) ? tasks : []).filter((task) => (
    !task.deletedAt
    && String(task.assignmentId || task.taskAssignmentId || task.batchId || '') === requestedId
    && sameId(task.storeId, storeId)
    && taskAssignedToEmployee(task, id)
  ))
  const belongsToEmployee = historyEmployeeIds.includes(id) || flatTasks.length > 0
  if (!belongsToEmployee) return null

  const sourceTasks = flatTasks.length ? flatTasks : (Array.isArray(history?.tasks) ? history.tasks : [])
  const visibleTasks = sourceTasks.filter((task) => {
    const taskEmployeeIds = explicitAssigneeIds(task)
    return taskEmployeeIds.length ? taskEmployeeIds.includes(id) : historyEmployeeIds.includes(id)
  }).map((task) => ({
    ...task,
    assignmentId: requestedId,
    storeId,
    date: explicitWorkDateOf(task) || explicitWorkDateOf(history),
    shiftId: shiftIdOf(task) || shiftIdOf(history),
    employeeIds: explicitAssigneeIds(task).length ? explicitAssigneeIds(task) : historyEmployeeIds,
  }))
  if (!visibleTasks.length) return null

  return {
    ...(history || {}),
    id: requestedId,
    assignmentId: requestedId,
    storeId,
    date: explicitWorkDateOf(history) || explicitWorkDateOf(visibleTasks[0]),
    shiftId: shiftIdOf(history) || shiftIdOf(visibleTasks[0]),
    employeeIds: historyEmployeeIds.length ? historyEmployeeIds : [id],
    tasks: visibleTasks,
  }
}

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
    && sameId(task.storeId, employee?.storeId)
    && (
      taskAssignedToEmployee(task, id)
      || (explicitAssigneeIds(task).length === 0 && scopes.has(`${String(task.storeId || '')}\u0000${shiftIdOf(task)}`))
    )
  ))
}
