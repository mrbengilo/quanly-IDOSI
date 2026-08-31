import { roleProfileCode } from './roleManagementUtils'
import {
  operationalIdentifierRecordMatch,
  operationalIdentifierReferenceMatchesRecord,
} from '../../utils'

const FINAL_STATUSES = new Set(['completed', 'incomplete'])

export const isFinalSupportWorkStatus = (status) => FINAL_STATUSES.has(status)

export const supportWorkStatus = (status) => ({
  assigned: { label: 'Đã giao', tone: 'blue' },
  in_progress: { label: 'Đang thực hiện', tone: 'orange' },
  completed: { label: 'Hoàn thành', tone: 'green' },
  incomplete: { label: 'Chưa hoàn thành', tone: 'red' },
}[status] || { label: status || 'Đã giao', tone: 'blue' })

export const supportWorkProgress = (assignment = {}) => {
  const tasks = Array.isArray(assignment.tasks) ? assignment.tasks : []
  const completed = tasks.filter((task) => task.completed).length
  return {
    total: tasks.length,
    completed,
    remaining: Math.max(0, tasks.length - completed),
    rate: tasks.length ? (completed / tasks.length) * 100 : 0,
  }
}

export const supportWorkEvaluation = (profile = {}, assignments = []) => {
  const employeeId = roleProfileCode(profile)
  const employeeReferences = [...new Set((Array.isArray(assignments) ? assignments : [])
    .map((assignment) => String(assignment.employeeId || '').trim())
    .filter(Boolean))].map((id) => ({ id }))
  const employeeMatch = operationalIdentifierRecordMatch(employeeReferences, employeeId, (record) => [record.id])
  const rows = employeeMatch.ambiguous || !employeeMatch.record
    ? []
    : assignments.filter((assignment) => operationalIdentifierReferenceMatchesRecord(
      employeeReferences,
      employeeMatch.record,
      assignment.employeeId,
    ))
  const finalizedRows = rows.filter((assignment) => isFinalSupportWorkStatus(assignment.status))
  const total = rows.reduce((sum, assignment) => sum + supportWorkProgress(assignment).total, 0)
  const finalizedProgress = finalizedRows.reduce((result, assignment) => {
    const progress = supportWorkProgress(assignment)
    return {
      total: result.total + progress.total,
      completed: result.completed + progress.completed,
    }
  }, { total: 0, completed: 0 })
  const submitted = finalizedRows.length
  const pending = Math.max(0, rows.length - submitted)
  const completedAssignments = finalizedRows.filter((assignment) => assignment.status === 'completed').length
  const incompleteAssignments = finalizedRows.filter((assignment) => assignment.status === 'incomplete').length
  const completed = finalizedProgress.completed
  const rate = total ? (completed / total) * 100 : 0
  const rating = !rows.length
    ? 'Chưa đánh giá'
    : pending > 0
      ? submitted ? 'Cần cải thiện' : 'Chưa nộp'
      : rate === 100 && incompleteAssignments === 0
      ? 'Hoàn thành tốt'
      : rate >= 80
        ? 'Hoàn thành'
        : 'Cần cải thiện'
  return { rows, total, completed, rate, submitted, pending, completedAssignments, incompleteAssignments, rating }
}
