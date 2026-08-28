const GENERATED_CHECKLIST_ASSIGNMENT_PREFIX = 'catalog_checklist_'

export const taskChecklistAttendanceId = (task = {}) => {
  const explicitAttendanceId = String(task?.checklistAttendanceId || '').trim()
  if (explicitAttendanceId) return explicitAttendanceId

  const assignmentId = String(task?.assignmentId || '').trim()
  return assignmentId.startsWith(GENERATED_CHECKLIST_ASSIGNMENT_PREFIX)
    ? assignmentId.slice(GENERATED_CHECKLIST_ASSIGNMENT_PREFIX.length)
    : ''
}

export const taskMatchesAttendanceChecklist = (task = {}, attendance = null) => {
  const checklistAttendanceId = taskChecklistAttendanceId(task)
  if (!checklistAttendanceId) return true

  const attendanceId = typeof attendance === 'object'
    ? String(attendance?.id || '').trim()
    : String(attendance || '').trim()
  return Boolean(attendanceId) && checklistAttendanceId === attendanceId
}
