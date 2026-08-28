const sameId = (left, right) => String(left ?? '') === String(right ?? '')

const uniqueIds = (values = []) => [...new Set(values
  .map((value) => String(value?.id || value?.code || value || '').trim())
  .filter(Boolean))]

const employeeId = (employee = {}) => String(employee.id || employee.code || employee.employeeCode || '')

const taskEmployeeIds = (task = {}) => uniqueIds([
  ...(Array.isArray(task.employeeIds) ? task.employeeIds : []),
  ...(Array.isArray(task.assigneeIds) ? task.assigneeIds : []),
  ...(Array.isArray(task.assignees) ? task.assignees : []),
  task.employeeId,
])

const personLabel = (person) => {
  if (!person) return 'Chưa ghi nhận'
  if (typeof person === 'string') return person
  return person.name || person.fullName || person.username || person.code || person.id || 'Chưa ghi nhận'
}

const workDateOf = (record = {}) => String(record.date || record.workDate || '').slice(0, 10)
const shiftIdOf = (record = {}) => String(record.shiftId || record.shift || '')
const assignedAtOf = (record = {}) => String(record.assignedAt || record.createdAt || record.sentAt || '')
const assignedByOf = (record = {}) => record.assignedBy || record.createdBy || record.actor || record.assignedByName

const taskCompletion = (task, employeeIds) => {
  const required = Math.max(1, employeeIds.length)
  if (task.done === true || task.completed === true) return { completed: required, required }
  const completedBy = task.completedBy && typeof task.completedBy === 'object' ? task.completedBy : {}
  const completed = employeeIds.length
    ? employeeIds.filter((id) => Boolean(completedBy[id])).length
    : Object.values(completedBy).some(Boolean) ? 1 : 0
  return { completed, required }
}

const normalizeTask = (task = {}, assignmentEmployeeIds = []) => {
  const employeeIds = uniqueIds([...assignmentEmployeeIds, ...taskEmployeeIds(task)])
  const completion = taskCompletion(task, employeeIds)
  const status = completion.completed >= completion.required
    ? 'Hoàn thành'
    : completion.completed > 0 ? 'Đang thực hiện' : 'Chưa hoàn thành'
  return {
    id: String(task.id || ''),
    title: String(task.title || task.name || '').trim(),
    detail: String(task.detail || task.description || '').trim(),
    catalogItemId: String(task.catalogItemId || task.catalogSnapshot?.catalogItemId || ''),
    catalogCode: String(task.catalogCode || task.catalogSnapshot?.catalogCode || ''),
    catalogVersion: Number(task.catalogVersion || task.catalogSnapshot?.catalogVersion || 0),
    kind: String(task.kind || task.catalogKind || task.catalogSnapshot?.kind || ''),
    amountVnd: Number(task.amountVnd ?? task.catalogSnapshot?.amountVnd ?? 0),
    catalogRequired: task.required === true || task.catalogSnapshot?.required === true,
    catalogSnapshot: task.catalogSnapshot && typeof task.catalogSnapshot === 'object'
      ? { ...task.catalogSnapshot }
      : null,
    employeeIds,
    completed: completion.completed,
    required: completion.required,
    status,
    completedAt: task.completedAt || task.finishedAt || '',
  }
}

const assignmentKeyForTask = (task = {}) => {
  const assignmentId = task.assignmentId || task.taskAssignmentId || task.batchId
  if (assignmentId) return `assignment:${assignmentId}`
  const actor = personLabel(assignedByOf(task))
  return [
    'legacy',
    task.storeId,
    workDateOf(task),
    shiftIdOf(task),
    assignedAtOf(task),
    actor,
    taskEmployeeIds(task).sort().join(','),
  ].join(':')
}

const assignmentsFromFlatTasks = (tasks = []) => {
  const grouped = new Map()
  tasks.forEach((task) => {
    const key = assignmentKeyForTask(task)
    const current = grouped.get(key) || {
      id: String(task.assignmentId || task.taskAssignmentId || task.batchId || key),
      storeId: task.storeId,
      date: workDateOf(task),
      shiftId: shiftIdOf(task),
      employeeIds: [],
      tasks: [],
      assignedAt: assignedAtOf(task),
      assignedBy: assignedByOf(task),
      status: task.assignmentStatus || '',
    }
    current.employeeIds = uniqueIds([...current.employeeIds, ...taskEmployeeIds(task)])
    current.tasks.push(task)
    grouped.set(key, current)
  })
  return [...grouped.values()]
}

const normalizeAssignment = (assignment, employeeMap, shiftMap) => {
  const tasks = Array.isArray(assignment.tasks) ? assignment.tasks : []
  const employeeIds = uniqueIds([
    ...(Array.isArray(assignment.employeeIds) ? assignment.employeeIds : []),
    ...(Array.isArray(assignment.assigneeIds) ? assignment.assigneeIds : []),
    ...(Array.isArray(assignment.assignees) ? assignment.assignees : []),
    ...tasks.flatMap(taskEmployeeIds),
    assignment.employeeId,
  ])
  const normalizedTasks = tasks.map((task) => normalizeTask(task, employeeIds))
  const completion = normalizedTasks.reduce((total, task) => ({
    completed: total.completed + task.completed,
    required: total.required + task.required,
  }), { completed: 0, required: 0 })
  const status = completion.required > 0 && completion.completed >= completion.required
    ? 'Hoàn thành'
    : completion.completed > 0 ? 'Đang thực hiện' : String(assignment.status || 'Chưa hoàn thành')
  const shiftId = shiftIdOf(assignment)
  const shift = shiftMap.get(shiftId)

  return {
    id: String(assignment.id || assignment.assignmentId || `${assignment.storeId}:${workDateOf(assignment)}:${shiftId}:${assignedAtOf(assignment)}`),
    storeId: String(assignment.storeId || ''),
    date: workDateOf(assignment),
    shiftId,
    shiftName: assignment.shiftName || shift?.name || shiftId || 'Chưa chọn ca',
    shiftTime: shift ? `${shift.start || '--:--'}–${shift.end || '--:--'}` : '',
    employeeIds,
    employeeNames: employeeIds.map((id) => employeeMap.get(id)?.name || employeeMap.get(id)?.fullName || id),
    assignedAt: assignedAtOf(assignment),
    assignedBy: personLabel(assignedByOf(assignment)),
    tasks: normalizedTasks,
    completed: completion.completed,
    required: completion.required,
    status,
  }
}

export const canAssignStoreTasks = (role) => ['admin', 'store_manager', 'business_support'].includes(String(role || ''))

const catalogTaskPayload = (task = {}, effectiveDate = '') => {
  const title = String(task.title || task.name || '').trim()
  const detail = String(task.detail || task.description || '').trim()
  const catalogItemId = String(task.catalogItemId || '').trim()
  if (!catalogItemId) return { title, detail }

  const catalogVersion = Number(task.catalogVersion)
  const amountVnd = Number(task.amountVnd)
  const sortOrder = Number(task.sortOrder)
  const kind = String(task.kind || task.catalogKind || '').trim()
  const required = task.required === true
  const catalogSnapshot = {
    catalogItemId,
    catalogCode: String(task.catalogCode || '').trim(),
    catalogVersion: Number.isSafeInteger(catalogVersion) && catalogVersion > 0 ? catalogVersion : 1,
    kind,
    targetGroup: String(task.targetGroup || '').trim(),
    storeId: task.storeId == null || task.storeId === '' ? null : String(task.storeId),
    shiftId: task.shiftId == null || task.shiftId === '' ? null : String(task.shiftId),
    shiftName: task.shiftName == null || task.shiftName === '' ? null : String(task.shiftName),
    name: String(task.name || title).trim(),
    amountVnd: Number.isSafeInteger(amountVnd) && amountVnd >= 0 ? amountVnd : 0,
    required,
    optional: !required,
    sortOrder: Number.isSafeInteger(sortOrder) && sortOrder >= 0 ? sortOrder : 0,
    effectiveDate: String(task.effectiveDate || effectiveDate).slice(0, 10),
  }
  return {
    title,
    detail,
    catalogItemId,
    catalogCode: catalogSnapshot.catalogCode,
    catalogVersion: catalogSnapshot.catalogVersion,
    kind,
    catalogKind: kind,
    amountVnd: catalogSnapshot.amountVnd,
    required,
    catalogSnapshot,
  }
}

export const buildStoreTaskAssignmentPayload = ({ storeId, date, shiftId, employeeIds = [], tasks = [] } = {}) => {
  const workDate = String(date || '').slice(0, 10)
  return {
    storeId: String(storeId || '').trim(),
    date: workDate,
    shiftId: String(shiftId || '').trim(),
    employeeIds: uniqueIds(employeeIds),
    tasks: tasks.map((task) => catalogTaskPayload(task, workDate)).filter((task) => task.title),
  }
}

export const storeTaskHistory = ({ taskAssignmentHistory = [], tasks = [], storeId, employees = [], shiftDefinitions = [] } = {}) => {
  const employeeMap = new Map(employees.map((employee) => [employeeId(employee), employee]))
  const shiftMap = new Map(shiftDefinitions.map((shift) => [String(shift.id || ''), shift]))
  const explicit = (Array.isArray(taskAssignmentHistory) ? taskAssignmentHistory : [])
    .filter((assignment) => assignment.receiptOnly !== true && sameId(assignment.storeId, storeId))
  const explicitIds = new Set(explicit.map((assignment) => String(assignment.id || assignment.assignmentId || '')).filter(Boolean))
  const legacy = assignmentsFromFlatTasks((Array.isArray(tasks) ? tasks : []).filter((task) => (
    sameId(task.storeId, storeId)
    && !explicitIds.has(String(task.assignmentId || task.taskAssignmentId || task.batchId || ''))
  )))

  return [...explicit, ...legacy]
    .map((assignment) => normalizeAssignment(assignment, employeeMap, shiftMap))
    .sort((left, right) => String(right.assignedAt || right.date).localeCompare(String(left.assignedAt || left.date)))
}

export const formatTaskDate = (value) => {
  const [year, month, day] = String(value || '').slice(0, 10).split('-')
  return year && month && day ? `${day}/${month}/${year.slice(-2)}` : '—'
}

export const formatTaskDateTime24 = (value) => {
  if (!value) return 'Chưa ghi nhận'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  const parts = Object.fromEntries(new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date).map((part) => [part.type, part.value]))
  return `${parts.day}/${parts.month}/${parts.year} ${parts.hour}:${parts.minute}:${parts.second}`
}
