import {
  operationalIdentifierEntry,
  operationalIdentifierRecordMatch,
  operationalIdentifierReferenceKey,
} from '../../utils'

const employeeId = (employee = {}) => String(employee?.id || employee?.code || employee?.employeeCode || '')
const employeeAliases = (employee = {}) => [
  employee?.id,
  employee?.code,
  employee?.employeeId,
  employee?.employeeCode,
].map((value) => String(value || '').trim()).filter(Boolean)
const explicitWorkDateOf = (record = {}) => String(record?.date || record?.workDate || '').slice(0, 10)
const attendanceDateOf = (record = {}) => String(record?.date || record?.workDate || record?.checkInAt || record?.createdAt || '').slice(0, 10)
const shiftIdOf = (record = {}) => String(record?.shiftId || record?.shift || '')
const storeIdOf = (store = {}) => String(store?.id || store?.code || '')
const storeAliases = (store = {}) => [store?.id, store?.code]
  .map((value) => String(value || '').trim()).filter(Boolean)

const targetRecord = (records, reference, identifierOf, fallback = null) => {
  const source = Array.isArray(records) ? records : []
  if (!source.length) return fallback
  const resolution = operationalIdentifierRecordMatch(source, reference, identifierOf)
  return resolution.ambiguous ? null : resolution.record
}

const referenceMatchesTarget = (records, target, reference, identifierOf) => {
  if (!target || !String(reference || '').trim()) return false
  const source = Array.isArray(records) && records.length ? records : [target]
  const resolution = operationalIdentifierRecordMatch(source, reference, identifierOf)
  return !resolution.ambiguous && resolution.record === target
}

const employeeTarget = (employee, employees = []) => targetRecord(
  employees,
  employeeId(employee),
  employeeAliases,
  employee,
)

const employeeReferenceMatches = (reference, employee, employees = []) => (
  referenceMatchesTarget(employees, employeeTarget(employee, employees), reference, employeeAliases)
)

const storeTarget = (employee, stores = []) => targetRecord(
  stores,
  employee?.storeId,
  storeAliases,
  employee?.storeId ? { id: String(employee.storeId) } : null,
)

const storeReferenceMatches = (reference, employee, stores = []) => (
  referenceMatchesTarget(stores, storeTarget(employee, stores), reference, storeAliases)
)

const identifierRecords = (values = []) => [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))]
  .map((id) => ({ id }))

const shiftScopeKey = (shiftId, shiftRecords = []) => operationalIdentifierReferenceKey(
  shiftRecords,
  shiftId,
  (record) => record.id,
)

const addScope = (scopes, shiftId, shiftRecords) => {
  const key = shiftScopeKey(shiftId, shiftRecords)
  if (key) scopes.add(key)
}

export const taskCompletedByEmployee = (task = {}, id, employees = []) => {
  if (!id || !task.completedBy || typeof task.completedBy !== 'object') return false
  const employee = targetRecord(employees, id, employeeAliases, { id: String(id) })
  if (!employee) return false
  const matchingEntries = Object.entries(task.completedBy)
    .filter(([key]) => referenceMatchesTarget(employees, employee, key, employeeAliases))
  for (const alias of employeeAliases(employee)) {
    const completion = operationalIdentifierEntry(Object.fromEntries(matchingEntries), alias)
    if (completion.ambiguous) return false
    if (completion.found) return Boolean(completion.value)
  }
  return false
}

const explicitAssigneeIds = (task = {}) => [
  task.employeeId,
  ...(Array.isArray(task.employeeIds) ? task.employeeIds : []),
  ...(Array.isArray(task.assigneeIds) ? task.assigneeIds : []),
  ...(Array.isArray(task.assignedEmployeeIds) ? task.assignedEmployeeIds : []),
].filter(Boolean).map(String)

const assignmentIdOf = (record) => String(record?.assignmentId || record?.id || record?.taskAssignmentId || record?.batchId || '')

export const taskAssignedToEmployee = (task = {}, id, employees = []) => {
  const assignees = explicitAssigneeIds(task)
  const employee = targetRecord(employees, id, employeeAliases, { id: String(id) })
  return Boolean(employee) && assignees.some((assigneeId) => (
    referenceMatchesTarget(employees, employee, assigneeId, employeeAliases)
  ))
}

export const employeeTaskAssignmentById = ({
  assignmentId,
  taskAssignmentHistory = [],
  tasks = [],
  employee = {},
  employees = [],
  stores = [],
} = {}) => {
  const requestedId = String(assignmentId || '').trim()
  const canonicalEmployee = employeeTarget(employee, employees)
  const canonicalStore = storeTarget(employee, stores)
  const id = employeeId(canonicalEmployee)
  const storeId = storeIdOf(canonicalStore)
  if (!requestedId || !canonicalEmployee || !canonicalStore || !id || !storeId) return null

  const historyCandidates = (Array.isArray(taskAssignmentHistory) ? taskAssignmentHistory : [])
    .filter((item) => storeReferenceMatches(item.storeId, employee, stores))
  const historyMatch = operationalIdentifierRecordMatch(
    historyCandidates,
    requestedId,
    (item) => [assignmentIdOf(item)],
  )
  if (historyMatch.ambiguous) return null
  const history = historyMatch.record
  const historyEmployeeIds = explicitAssigneeIds(history || {})
  const activeTasks = (Array.isArray(tasks) ? tasks : []).filter((task) => !task.deletedAt)
  const assignmentRecords = identifierRecords([
    ...historyCandidates.map(assignmentIdOf),
    ...activeTasks.map(assignmentIdOf),
  ])
  const assignment = targetRecord(assignmentRecords, requestedId, (record) => record.id)
  if (!assignment) return null
  const flatTasks = activeTasks.filter((task) => (
    !task.deletedAt
    && referenceMatchesTarget(assignmentRecords, assignment, assignmentIdOf(task), (record) => record.id)
    && storeReferenceMatches(task.storeId, employee, stores)
    && taskAssignedToEmployee(task, id, employees)
  ))
  const belongsToEmployee = historyEmployeeIds.some((candidateId) => (
    employeeReferenceMatches(candidateId, canonicalEmployee, employees)
  )) || flatTasks.length > 0
  if (!belongsToEmployee) return null

  const sourceTasks = flatTasks.length ? flatTasks : (Array.isArray(history?.tasks) ? history.tasks : [])
  const visibleTasks = sourceTasks.filter((task) => {
    const taskEmployeeIds = explicitAssigneeIds(task)
    return taskEmployeeIds.length
      ? taskEmployeeIds.some((candidateId) => employeeReferenceMatches(candidateId, canonicalEmployee, employees))
      : historyEmployeeIds.some((candidateId) => employeeReferenceMatches(candidateId, canonicalEmployee, employees))
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

export const employeeTaskScopesForDate = ({
  schedule = [],
  attendance = [],
  employee = {},
  employees = [],
  stores = [],
  shiftRecords = [],
  workDate,
} = {}) => {
  const canonicalEmployee = employeeTarget(employee, employees)
  const scopes = new Set()
  if (!canonicalEmployee || !storeTarget(employee, stores)) return scopes

  schedule.forEach((assignment) => {
    const assignmentDate = explicitWorkDateOf(assignment)
    if (
      assignment.deletedAt
      || !employeeReferenceMatches(assignment.employeeId, canonicalEmployee, employees)
      || !storeReferenceMatches(assignment.storeId || employee?.storeId, employee, stores)
      || (assignmentDate && assignmentDate !== workDate)
    ) return
    ;(assignment.shiftIds || []).forEach((shiftId) => addScope(scopes, shiftId, shiftRecords))
  })

  attendance.forEach((record) => {
    if (
      record.deletedAt
      || !employeeReferenceMatches(record.employeeId, canonicalEmployee, employees)
      || !storeReferenceMatches(record.storeId || employee?.storeId, employee, stores)
      || attendanceDateOf(record) !== workDate
      || record.checkOutAt
      || record.checkOut
    ) return
    addScope(scopes, shiftIdOf(record), shiftRecords)
  })

  return scopes
}

export const employeeTasksForDate = ({
  tasks = [],
  schedule = [],
  attendance = [],
  employee = {},
  employees = [],
  stores = [],
  shiftDefinitions = [],
  workDate,
} = {}) => {
  const canonicalEmployee = employeeTarget(employee, employees)
  const id = employeeId(canonicalEmployee)
  if (!canonicalEmployee || !storeTarget(employee, stores)) return []
  const shiftRecords = identifierRecords([
    ...(Array.isArray(shiftDefinitions) ? shiftDefinitions : []).map(shiftIdOf),
    ...schedule.flatMap((assignment) => assignment.shiftIds || []),
    ...attendance.map(shiftIdOf),
    ...tasks.map(shiftIdOf),
  ])
  const scopes = employeeTaskScopesForDate({
    schedule,
    attendance,
    employee,
    employees,
    stores,
    shiftRecords,
    workDate,
  })

  return tasks.filter((task) => (
    !task.deletedAt
    && explicitWorkDateOf(task) === workDate
    && storeReferenceMatches(task.storeId, employee, stores)
    && (
      taskAssignedToEmployee(task, id, employees)
      || (explicitAssigneeIds(task).length === 0 && scopes.has(shiftScopeKey(shiftIdOf(task), shiftRecords)))
    )
  ))
}
