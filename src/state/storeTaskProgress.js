import { selectAttendanceTaskShift, taskShiftContext } from '../domain/taskShift.js'
import { attendanceTaskShiftLock, bindTaskShiftContext, mergeTaskShiftProgress, TASK_SHIFT_LOCK_STATUS, taskShiftLockAllows } from '../domain/taskProgress.js'
import { operationalIdentifierEntry, operationalIdentifierReferenceMatchesRecord, uid } from '../utils'

// Loaded only when saving work; catalog resolution is not part of the login bundle.
export async function saveStoreTaskProgressForState(payload, {
  remoteEnabled, state, notify, setState, runRemoteDomainCommand, resolveEmployeeIdentifier, normalizeAuthRole, isOfficeUnit, isBusinessSupportUnit, isStoreManagerUnit, accountKey, resolveOpenAttendanceIdentifier, storeTasksForAttendance, normalizedIdentifier, sameIdentifier, withCanonicalIdentifierEntry, actorSnapshot
}) {
  const employeeId = String(state.session?.employeeId || state.session?.code || '')
  const employeeMatch = resolveEmployeeIdentifier(state.employees, employeeId)
  if (employeeMatch.ambiguous) {
    return { ok: false, code: 'EMPLOYEE_IDENTIFIER_COLLISION', message: 'Không thể xác định nhân viên vì có mã trùng nhau khi không phân biệt chữ hoa/thường.' }
  }
  const employee = employeeMatch.record
  const role = normalizeAuthRole(state.session?.role)
  const employeeUnit = String(employee?.unit || employee?.unitType || employee?.department || '').trim()
  if (role !== 'employee' || !employee || isOfficeUnit(employeeUnit) || isBusinessSupportUnit(employeeUnit) || isStoreManagerUnit(employeeUnit)) {
    return { ok: false, message: 'Chức năng này chỉ dành cho nhân viên cửa hàng.' }
  }
  const attendanceId = String(payload.attendanceId || '')
  const attendanceMatch = resolveOpenAttendanceIdentifier(state.attendance, {
    employeeId: accountKey(employee),
    attendanceId,
  })
  if (attendanceMatch.ambiguous) {
    return { ok: false, code: 'ATTENDANCE_IDENTIFIER_COLLISION', message: 'Không thể xác định ca đang mở vì có mã chấm công trùng nhau khi không phân biệt chữ hoa/thường.' }
  }
  const openAttendance = attendanceMatch.record
  if (!openAttendance) return { ok: false, message: 'Bạn cần điểm danh và đang trong ca để lưu kết quả công việc.' }
  const storeId = String(openAttendance.storeId || employee.storeId || '')
  const date = String(openAttendance.date || openAttendance.workDate || '').slice(0, 10)
  // Same lock as the server: store work needs the attendance's selected shift.
  const lock = attendanceTaskShiftLock(openAttendance)
  if (!Object.hasOwn(payload, 'selectedTaskShiftId') || lock.status === TASK_SHIFT_LOCK_STATUS.NONE) {
    return { ok: false, code: 'TASK_SHIFT_SELECTION_REQUIRED', message: 'Cần chọn ca công việc cho lượt điểm danh này trước khi lưu kết quả.' }
  }
  const manualContext = taskShiftContext({ state, attendance: openAttendance, employeeId, selectedTaskShiftId: payload.selectedTaskShiftId })
  if (manualContext?.error) return { ok: false, code: manualContext.code, message: manualContext.error }
  if (!taskShiftLockAllows(lock, manualContext.shift.id)) {
    return { ok: false, code: 'TASK_SHIFT_LOCKED', message: 'Lượt điểm danh này đã khóa ca công việc khác.' }
  }
  const shiftId = manualContext?.shift.id || String(openAttendance.shiftId || openAttendance.shift || '')
  const scopedTasks = manualContext?.tasks || storeTasksForAttendance({
    tasks: state.tasks,
    attendance: openAttendance,
    attendanceRecords: state.attendance,
    employeeId,
    employees: state.employees,
    stores: state.stores,
    shiftDefinitions: state.shiftDefinitions,
    taskAssignmentHistory: state.taskAssignmentHistory,
  })
  if (!scopedTasks.length) return { ok: false, message: 'Ca đang làm chưa có công việc được giao.' }
  if (scopedTasks.some((task) => operationalIdentifierEntry(task.completedBy, employeeId).ambiguous)) {
    return { ok: false, code: 'TASK_COMPLETION_IDENTIFIER_COLLISION', message: 'Không thể lưu kết quả vì trạng thái hoàn thành có mã nhân viên trùng nhau khi không phân biệt chữ hoa/thường.' }
  }
  const statuses = Array.isArray(payload.tasks) ? payload.tasks : []
  const submitted = new Map()
  const taskIdByKey = new Map(scopedTasks.map((task) => [normalizedIdentifier(task.id), String(task.id || '')]))
  if (taskIdByKey.size !== scopedTasks.length) {
    return { ok: false, code: 'TASK_IDENTIFIER_COLLISION', message: 'Không thể lưu kết quả vì danh sách công việc có mã trùng nhau khi không phân biệt chữ hoa/thường.' }
  }
  const taskIds = new Set(taskIdByKey.keys())
  for (const item of statuses) {
    const taskId = String(item?.id || item?.taskId || '')
    const taskKey = normalizedIdentifier(taskId)
    if (!taskIds.has(taskKey) || submitted.has(taskKey) || typeof item?.completed !== 'boolean') {
      return { ok: false, message: 'Danh sách kết quả có công việc không hợp lệ hoặc không thuộc ca đang làm.' }
    }
    submitted.set(taskKey, item.completed)
  }
  if (submitted.size !== taskIds.size) return { ok: false, message: 'Cần gửi trạng thái của đầy đủ công việc được giao trong ca.' }
  if (scopedTasks.some((task) => operationalIdentifierEntry(task.completedBy, employeeId).value === true && submitted.get(normalizedIdentifier(task.id)) !== true)) {
    return { ok: false, code: 'TASK_COMPLETION_IMMUTABLE', message: 'Công việc đã lưu hoàn thành không thể bỏ chọn.' }
  }
  const incompleteReason = String(payload.incompleteReason || payload.note || '').trim()
  const requiredTaskIds = new Set(scopedTasks.filter((task) => task.required !== false).map((task) => normalizedIdentifier(task.id)))
  const incompleteTaskIds = [...submitted]
    .filter(([taskId, completed]) => requiredTaskIds.has(taskId) && !completed)
    .map(([taskId]) => taskId)
  if (incompleteReason.length > 1_000) return { ok: false, message: 'Ghi chú chưa hoàn thành không được vượt quá 1.000 ký tự.' }
  if (incompleteTaskIds.length && !incompleteReason) return { ok: false, message: 'Cần nhập ghi chú khi chưa hoàn thành công việc cố định.' }
  const idempotencyKey = String(payload.idempotencyKey || `task-progress:${crypto.randomUUID()}`)
  if (remoteEnabled) {
    try {
      const result = await runRemoteDomainCommand('task.progress.save', {
        attendanceId: openAttendance.id,
        ...(manualContext ? { selectedTaskShiftId: shiftId } : {}),
        tasks: [...submitted].map(([id, completed]) => ({ id: taskIdByKey.get(id) || id, completed })),
        incompleteReason,
      }, idempotencyKey)
      notify(`Đã lưu kết quả: hoàn thành ${result.completionRate || 0}%.`)
      return { ok: true, ...result }
    } catch (error) {
      notify(error.message || 'Không thể lưu kết quả công việc.', 'info')
      return { ok: false, message: error.message }
    }
  }
  const normalizedStatuses = [...submitted].sort(([left], [right]) => left.localeCompare(right))
  const fingerprint = JSON.stringify({ attendanceId: openAttendance.id, ...(manualContext ? { selectedTaskShiftId: shiftId } : {}), tasks: normalizedStatuses, incompleteReason })
  const existing = state.taskAssignmentHistory.flatMap((assignment) => assignment.progressHistory || [])
    .find((event) => sameIdentifier(event.employeeId, employeeId) && String(event.fingerprint || '') === fingerprint)
  const mandatoryProgress = (items = scopedTasks) => {
    const mandatoryIds = items
      .filter((task) => task.required !== false)
      .map((task) => normalizedIdentifier(task.id))
    const totalTasks = mandatoryIds.length
    const completedTasks = mandatoryIds.filter((taskId) => submitted.get(taskId) === true).length
    return {
      completedTasks,
      totalTasks,
      completionRate: totalTasks ? Math.round((completedTasks / totalTasks) * 100) : 0,
    }
  }
  const { completedTasks, totalTasks, completionRate } = mandatoryProgress()
  if (existing) return { ok: true, existing: true, completedTasks, totalTasks, completionRate, submittedAt: existing.at }
  const timestamp = new Date().toISOString()
  const assignmentIds = [...new Set(scopedTasks.map((task) => String(task.assignmentId || '')).filter(Boolean))]
  const assignmentKeys = new Set(assignmentIds.map(normalizedIdentifier))
  if (assignmentKeys.size !== assignmentIds.length) {
    return { ok: false, code: 'TASK_ASSIGNMENT_IDENTIFIER_COLLISION', message: 'Không thể lưu kết quả vì lượt giao việc có mã trùng nhau khi không phân biệt chữ hoa/thường.' }
  }
  const submittedByExactTaskId = new Map(scopedTasks.map((task) => [
    String(task.id || ''),
    submitted.get(normalizedIdentifier(task.id)),
  ]))
  const assignmentSummaries = (assignmentIds.length ? assignmentIds : ['']).map((assignmentId) => {
    const scopedAssignmentTasks = scopedTasks
      .filter((task) => !assignmentId || sameIdentifier(task.assignmentId, assignmentId))
    const progress = mandatoryProgress(scopedAssignmentTasks)
    return {
      assignmentId,
      ...progress,
    }
  })
  const newTasks = scopedTasks.filter((task) => !state.tasks.some((entry) => entry.id === task.id))
  const newHistories = [...new Set(newTasks.map((task) => task.assignmentId))].map((id) => ({
    id, assignmentId: id, employeeIds: [employeeId], storeId, date, shiftId,
    tasks: newTasks.filter((task) => task.assignmentId === id), assignedAt: timestamp,
  }))
  setState((current) => ({
    ...current,
    attendance: current.attendance.map((record) => record.id === openAttendance.id ? {
      ...(manualContext ? bindTaskShiftContext(record, manualContext) : record),
      taskProgress: mergeTaskShiftProgress(record, {
        attendanceId: record.id, employeeId, completedTasks, totalTasks, completionRate,
        incompleteTaskIds: scopedTasks.filter((task) => incompleteTaskIds.includes(normalizedIdentifier(task.id))).map((task) => task.id),
        incompleteReason, fingerprint, submittedAt: timestamp,
      }, scopedTasks.map((task) => task.id)),
    } : record),
    tasks: [...current.tasks, ...newTasks].map((task) => submittedByExactTaskId.has(String(task.id || '')) ? {
      ...task,
      completedBy: withCanonicalIdentifierEntry(task.completedBy, employeeId, submittedByExactTaskId.get(String(task.id || ''))),
      completionHistory: [...(task.completionHistory || []), { done: submittedByExactTaskId.get(String(task.id || '')), at: timestamp, employeeId, actor: actorSnapshot(current.session) }],
      updatedAt: timestamp,
    } : task),
    taskAssignmentHistory: [...current.taskAssignmentHistory, ...newHistories].map((assignment) => {
      const assignmentId = String(assignment.assignmentId || assignment.id || '')
      if (!assignmentIds.some((reference) => operationalIdentifierReferenceMatchesRecord(
        [...current.taskAssignmentHistory, ...newHistories],
        assignment,
        reference,
        (record) => record.assignmentId || record.id,
      ))) return assignment
      const assignmentProgress = mandatoryProgress(scopedTasks.filter((task) => String(task.assignmentId || '') === assignmentId))
      const assignmentCompleted = assignmentProgress.completedTasks
      const assignmentTotal = assignmentProgress.totalTasks
      const assignmentRate = assignmentProgress.completionRate
      const requiredComplete = assignmentTotal === 0 || assignmentCompleted === assignmentTotal
      const event = { action: 'progress-submitted', employeeId, employeeName: employee.name || employeeId, attendanceId: openAttendance.id, storeId, date, shiftId, assignmentId, completedTasks: assignmentCompleted, totalTasks: assignmentTotal, completionRate: assignmentRate, incompleteReason: requiredComplete ? '' : incompleteReason, fingerprint, at: timestamp, actor: actorSnapshot(current.session) }
      return {
        ...assignment,
        status: requiredComplete ? 'completed' : 'incomplete',
        completionRate: assignmentRate,
        completedTasks: assignmentCompleted,
        totalTasks: assignmentTotal,
        incompleteReason: requiredComplete ? '' : incompleteReason,
        progressHistory: [...(assignment.progressHistory || []), event],
        updatedAt: timestamp,
      }
    }),
    notifications: assignmentSummaries.flatMap((summary) => (
      ['admin', 'business_support', 'store_manager'].map((targetRole) => ({
        id: uid('NTF'),
        type: 'store-task-progress-submitted',
        targetRole,
        storeId,
        employeeId,
        attendanceId: openAttendance.id,
        assignmentId: summary.assignmentId || null,
        route: `/store/tasks${summary.assignmentId ? `?assignment=${encodeURIComponent(summary.assignmentId)}` : ''}`,
        title: `${employee.name || employeeId} đã gửi kết quả công việc`,
        message: `Hoàn thành ${summary.completedTasks}/${summary.totalTasks} công việc (${summary.completionRate}%).`,
        createdAt: timestamp,
        readAt: null,
      }))
    )).concat(current.notifications || []),
    auditLogs: [{ id: uid('AUD'), entity: 'task-progress', entityId: `${openAttendance.id}:${employeeId}`, action: 'submit', before: null, after: normalizedStatuses, actor: actorSnapshot(current.session), createdAt: timestamp }, ...current.auditLogs],
    stateVersion: current.stateVersion + 1,
  }))
  notify(`Đã lưu kết quả: hoàn thành ${completionRate}%.`)
  return { ok: true, completedTasks, totalTasks, completionRate, incompleteReason, submittedAt: timestamp }
}

const UNCERTAIN_COMMAND_CODES = new Set(['TIMEOUT', 'NETWORK_ERROR'])
const REFRESH_AFTER_CODES = new Set(['TASK_SHIFT_ALREADY_SELECTED', 'TASK_SHIFT_LEGACY_MULTI_CONTEXT', 'OPEN_ATTENDANCE_REQUIRED', 'VERSION_CONFLICT'])

// Records the single task shift of the actor's open attendance. A timeout or
// lost connection is "unknown": the projection is re-read from the server and
// the caller keeps the same idempotency key/payload for any retry.
export async function selectTaskShiftForState(payload, {
  remoteEnabled, state, notify, setState, runRemoteDomainCommand, refreshRemoteProjection, resolveEmployeeIdentifier, normalizeAuthRole, isOfficeUnit, isBusinessSupportUnit, isStoreManagerUnit, accountKey, resolveOpenAttendanceIdentifier, actorSnapshot,
}) {
  const employeeId = String(state.session?.employeeId || state.session?.code || '')
  const employeeMatch = resolveEmployeeIdentifier(state.employees, employeeId)
  if (employeeMatch.ambiguous) {
    return { ok: false, code: 'EMPLOYEE_IDENTIFIER_COLLISION', message: 'Không thể xác định nhân viên vì có mã trùng nhau khi không phân biệt chữ hoa/thường.' }
  }
  const employee = employeeMatch.record
  const role = normalizeAuthRole(state.session?.role)
  const employeeUnit = String(employee?.unit || employee?.unitType || employee?.department || '').trim()
  if (role !== 'employee' || !employee || isOfficeUnit(employeeUnit) || isBusinessSupportUnit(employeeUnit) || isStoreManagerUnit(employeeUnit)) {
    return { ok: false, code: 'ROLE_FORBIDDEN', message: 'Chức năng này chỉ dành cho nhân viên cửa hàng.' }
  }
  const attendanceMatch = resolveOpenAttendanceIdentifier(state.attendance, { employeeId: accountKey(employee), attendanceId: String(payload.attendanceId || '') })
  if (attendanceMatch.ambiguous) {
    return { ok: false, code: 'ATTENDANCE_IDENTIFIER_COLLISION', message: 'Không thể xác định ca đang mở vì có mã chấm công trùng nhau.' }
  }
  const openAttendance = attendanceMatch.record
  if (!openAttendance) return { ok: false, code: 'OPEN_ATTENDANCE_REQUIRED', message: 'Bạn cần điểm danh trước khi chọn ca công việc.' }
  const selectedTaskShiftId = String(payload.selectedTaskShiftId || '').trim()
  if (remoteEnabled) {
    try {
      const result = await runRemoteDomainCommand('task.shift.select', {
        attendanceId: openAttendance.id,
        selectedTaskShiftId,
      }, String(payload.idempotencyKey || `task-shift:${crypto.randomUUID()}`))
      return { ok: true, ...result }
    } catch (error) {
      const uncertain = UNCERTAIN_COMMAND_CODES.has(error?.code) || Number(error?.status) >= 500
      if (uncertain || REFRESH_AFTER_CODES.has(error?.code)) {
        try {
          await refreshRemoteProjection?.()
        } catch {
          // The page keeps showing "unknown" instead of guessing a result.
        }
      }
      if (uncertain) {
        return { ok: false, uncertain: true, code: error?.code || 'UNKNOWN', message: 'Chưa xác định được kết quả chọn ca do kết nối gián đoạn. Trạng thái đã được tải lại từ máy chủ; nếu ca vẫn chưa được khóa, hãy bấm lại đúng ca vừa chọn.' }
      }
      return { ok: false, code: error?.code, message: error?.message || 'Không thể chọn ca công việc.' }
    }
  }
  const timestamp = new Date().toISOString()
  const selection = selectAttendanceTaskShift({
    state, attendance: openAttendance, employeeId, selectedTaskShiftId, now: timestamp, actor: actorSnapshot(state.session),
  })
  if (selection.error) return { ok: false, code: selection.code, message: selection.error }
  if (selection.existing) return { ok: true, existing: true, attendance: openAttendance }
  setState((current) => ({
    ...current,
    attendance: current.attendance.map((record) => record.id === openAttendance.id ? selection.attendance : record),
    tasks: [...current.tasks, ...selection.newTasks.filter((task) => !current.tasks.some((row) => row.id === task.id))],
    stateVersion: current.stateVersion + 1,
  }))
  notify?.(`Đã chọn ${selection.slot.label}.`)
  return { ok: true, attendance: selection.attendance }
}
