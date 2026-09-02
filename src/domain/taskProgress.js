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
  incompleteTaskIds,
} = {}) => {
  if (!progress || typeof progress !== 'object' || Array.isArray(progress)) return false
  const expectedIds = normalizedIds(incompleteTaskIds)
  if (!expectedIds.length || !String(progress.incompleteReason || '').trim()) return false
  if (!String(progress.submittedAt || '').trim()) return false
  if (normalizedIdentifier(progress.attendanceId) !== normalizedIdentifier(attendanceId)) return false
  if (employeeId && normalizedIdentifier(progress.employeeId) !== normalizedIdentifier(employeeId)) return false
  const savedIds = normalizedIds(progress.incompleteTaskIds)
  return savedIds.length === expectedIds.length
    && savedIds.every((taskId, index) => taskId === expectedIds[index])
}
