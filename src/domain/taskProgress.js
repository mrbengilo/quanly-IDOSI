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

const lockText = (value) => String(value || '').trim()
const lockKey = (value) => lockText(value).toLocaleLowerCase('vi-VN')

export const TASK_SHIFT_LOCK_STATUS = Object.freeze({
  NONE: 'none',
  SELECTED: 'selected',
  LEGACY_MULTI: 'legacy-multi',
})

// One attendance owns at most one work-task shift. New attendances persist an
// explicit selection; attendances saved before the rule keep their contexts:
// a single context is that attendance's verified lock, several contexts stay a
// legacy set whose obligations are preserved but cannot grow.
export const attendanceTaskShiftLock = (attendance) => {
  const selectedShiftId = lockText(attendance?.taskShiftSelection?.shiftId)
  const contextShiftIds = [...new Map((Array.isArray(attendance?.taskShiftContexts) ? attendance.taskShiftContexts : [])
    .map((context) => lockText(context?.shiftId))
    .filter(Boolean)
    .map((shiftId) => [lockKey(shiftId), shiftId])).values()]
  if (selectedShiftId) {
    return { status: TASK_SHIFT_LOCK_STATUS.SELECTED, shiftId: selectedShiftId, shiftIds: [selectedShiftId], legacy: false }
  }
  if (contextShiftIds.length === 1) {
    return { status: TASK_SHIFT_LOCK_STATUS.SELECTED, shiftId: contextShiftIds[0], shiftIds: contextShiftIds, legacy: true }
  }
  if (contextShiftIds.length > 1) {
    return { status: TASK_SHIFT_LOCK_STATUS.LEGACY_MULTI, shiftId: '', shiftIds: contextShiftIds, legacy: true }
  }
  return { status: TASK_SHIFT_LOCK_STATUS.NONE, shiftId: '', shiftIds: [], legacy: false }
}

export const taskShiftLockAllows = (lock, shiftId) => Boolean(lockText(shiftId))
  && (lock?.shiftIds || []).some((id) => lockKey(id) === lockKey(shiftId))

const taskInTaskShiftContexts = (task, attendance) => (
  (attendance?.taskShiftContexts || []).some((context) => (context.taskIds || []).includes(task?.id))
)

// Canonical checkout obligation predicate shared by server and UI. Without a
// selected lock the historical rule is unchanged. With a lock the attendance
// owes exactly what the locked shift shows: its saved context(s) plus
// `lockedTaskIds` (the locked shift's current task context, which includes later
// explicit assignments). A check-in snapshot of a shift the employee did not
// select stays stored but is no longer owed.
export const taskIsAttendanceShiftObligation = ({ task, attendance, matchesAttendanceShift = () => false, lockedTaskIds = null }) => {
  const lock = attendanceTaskShiftLock(attendance)
  if (lock.status !== TASK_SHIFT_LOCK_STATUS.SELECTED) {
    const taskShiftId = lockText(task?.shiftId || task?.shift)
    return !taskShiftId || Boolean(matchesAttendanceShift(taskShiftId)) || taskBelongsToAttendanceObligations(task, attendance)
  }
  return taskInTaskShiftContexts(task, attendance) || Boolean(lockedTaskIds?.has?.(task?.id))
}

// Saved progress may still list tasks no longer owed by a locked attendance
// (for example a legacy save before the lock). Compare only owed task ids.
export const taskProgressForObligations = (progress, obligationTaskIds) => {
  if (!progress || typeof progress !== 'object' || Array.isArray(progress)) return progress
  const owed = new Set((Array.isArray(obligationTaskIds) ? obligationTaskIds : []).map(normalizedIdentifier))
  return {
    ...progress,
    incompleteTaskIds: (Array.isArray(progress.incompleteTaskIds) ? progress.incompleteTaskIds : [])
      .filter((taskId) => owed.has(normalizedIdentifier(taskId))),
  }
}
