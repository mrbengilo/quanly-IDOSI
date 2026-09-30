const normalizedIdentifier = (value) => String(value || '').trim().toLocaleLowerCase('vi-VN')

const normalizedIds = (values) => (Array.isArray(values) ? values : [])
  .map(normalizedIdentifier)
  .filter(Boolean)
  .toSorted()

export const createAttendanceTaskProgress = ({
  attendanceId,
  employeeId,
  completedTasks,
  totalTasks,
  completionRate,
  incompleteTaskIds,
  incompleteReason,
  fingerprint,
  submittedAt,
} = {}) => ({
  attendanceId: String(attendanceId || '').trim(),
  employeeId: String(employeeId || '').trim(),
  completedTasks: Math.max(0, Math.trunc(Number(completedTasks) || 0)),
  totalTasks: Math.max(0, Math.trunc(Number(totalTasks) || 0)),
  completionRate: Math.max(0, Math.min(100, Math.trunc(Number(completionRate) || 0))),
  incompleteTaskIds: (Array.isArray(incompleteTaskIds) ? incompleteTaskIds : [])
    .map((taskId) => String(taskId || '').trim())
    .filter(Boolean),
  incompleteReason: String(incompleteReason || '').trim(),
  fingerprint: String(fingerprint || ''),
  submittedAt: String(submittedAt || ''),
})

export const savedTaskProgressCoversIncompleteTasks = ({
  progress,
  attendanceId,
  employeeId,
  employeeIds,
  incompleteTaskIds,
} = {}) => {
  if (!progress || typeof progress !== 'object' || Array.isArray(progress)) return false
  const expectedIds = normalizedIds(incompleteTaskIds)
  if (!expectedIds.length || !String(progress.incompleteReason || '').trim()) return false
  if (!String(progress.submittedAt || '').trim()) return false
  if (normalizedIdentifier(progress.attendanceId) !== normalizedIdentifier(attendanceId)) return false
  const acceptedEmployeeIds = normalizedIds([employeeId, ...(Array.isArray(employeeIds) ? employeeIds : [])])
  if (acceptedEmployeeIds.length && !acceptedEmployeeIds.includes(normalizedIdentifier(progress.employeeId))) return false
  const savedIds = normalizedIds(progress.incompleteTaskIds)
  return savedIds.length === expectedIds.length
    && savedIds.every((taskId, index) => taskId === expectedIds[index])
}

export const bindTaskShiftContext = (attendance, context) => ({
  ...attendance,
  // Append obligations; neither changing tabs nor saving another shift erases
  // the legacy snapshot or any previously accepted checklist.
  taskShiftContexts: [...(attendance.taskShiftContexts || []).filter((entry) => entry.shiftId !== context.shift.id), {
    shiftId: context.shift.id, shiftName: context.shift.name,
    taskIds: context.tasks.map((task) => task.id),
  }],
})

export const taskBelongsToAttendanceObligations = (task, attendance) => (
  (attendance?.taskShiftContexts || []).some((context) => context.taskIds.includes(task.id))
  || (attendance?.checklistSnapshot?.tasks || []).some((entry) => entry.id === task.id)
)

export const mergeTaskShiftProgress = (attendance, progress, taskIds) => {
  const replaced = new Set(taskIds)
  const previous = attendance.taskProgress
  const remaining = (previous?.incompleteTaskIds || []).filter((id) => !replaced.has(id))
  // Store reasons against task identity so finishing one shift also removes its
  // old reason without borrowing the note of another incomplete shift.
  const incompleteReasonsByTaskId = Object.fromEntries([
    ...remaining.map((id) => [id, previous.incompleteReasonsByTaskId?.[id] || previous.incompleteReason]),
    ...progress.incompleteTaskIds.map((id) => [id, progress.incompleteReason]),
  ])
  return {
    ...progress,
    incompleteTaskIds: Object.keys(incompleteReasonsByTaskId),
    incompleteReasonsByTaskId,
    // Checkout's legacy summary has a 1000-character cap; full notes remain in
    // the per-task map and immutable per-shift progress history.
    incompleteReason: [...new Set(Object.values(incompleteReasonsByTaskId).filter(Boolean))].join('\n').slice(0, 1000),
  }
}
