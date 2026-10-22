import { canonicalEmployeeStatus, EMPLOYEE_STATUS } from './employeeStatus.js'
import {
  attendanceMatchesWindow, scheduleAssignmentIsUsable, scheduleConflict,
  shiftWindow, supportForScheduledWindow, sameScheduleIdentifier as same,
} from './supportScheduling.js'

const list = (value) => Array.isArray(value) ? value : []
const key = (value) => String(value || '').trim().toLowerCase()
export const scheduleSwapEmployeeKeys = (employee) => [employee.id, employee.code, employee.employeeId,
  employee.employee_id, employee.employeeCode, employee.employee_code, ...list(employee.identifierAliases)].map(key).filter(Boolean)
const reference = (record) => record.employeeId || record.employee_id || record.employeeCode || record.employee_code
const shiftIds = (record) => list(record.shiftIds?.length ? record.shiftIds : [record.shiftId]).filter(Boolean)
const fail = (code, message) => { throw Object.assign(new Error(message), { code, status: 409 }) }

// Captures the selected assignment, independently of unrelated global-version changes.
// A background projection refresh must never silently change the user's intent.
export const scheduleSwapRevision = (record) => JSON.stringify([
  record.id, reference(record), record.storeId, record.date || record.workDate,
  shiftIds(record), list(record.shiftSnapshots), record.updatedAt || '', record.supportTransferId || '',
])

export const resolveScheduleSwapSelection = (state, { storeId, date, selection }) => {
  if (!shiftWindow(date, { start: '00:00', end: '01:00' })) fail('SCHEDULE_DATE_INVALID', 'Ngày phân ca không hợp lệ.')
  const records = list(state.schedule).filter((row) => same(row.id, selection?.assignmentId))
  if (records.length !== 1 || !same(records[0].storeId, storeId) || (records[0].date || records[0].workDate) !== date
    || !scheduleAssignmentIsUsable(records[0]) || records[0].projectionReadOnly) {
    fail('SCHEDULE_ASSIGNMENT_INVALID', 'Không tìm thấy lịch phân ca có thể chỉnh sửa trong phạm vi đã chọn.')
  }
  const assignment = records[0]
  if (selection.revision && selection.revision !== scheduleSwapRevision(assignment)) {
    fail('VERSION_CONFLICT', 'Lịch phân ca đã thay đổi, vui lòng kiểm tra lại.')
  }
  const employees = list(state.employees).filter((employee) => scheduleSwapEmployeeKeys(employee).includes(key(reference(assignment))))
  const employee = employees.length === 1 ? employees[0] : null
  if (!employee || !scheduleSwapEmployeeKeys(employee).includes(key(selection.employeeId))
    || list(state.employees).some((other) => other !== employee && scheduleSwapEmployeeKeys(other)
      .some((alias) => scheduleSwapEmployeeKeys(employee).includes(alias)))) {
    fail('SCHEDULE_EMPLOYEE_INVALID', 'Nhân viên không khớp với lịch phân ca hoặc danh tính chưa rõ ràng.')
  }
  if (employee.deletedAt || String(employee.unit || employee.unitType || 'store') !== 'store'
    || canonicalEmployeeStatus(employee.status) !== EMPLOYEE_STATUS.ACTIVE) {
    fail('SCHEDULE_EMPLOYEE_INACTIVE', 'Nhân viên không ở trạng thái được phép làm việc tại cửa hàng.')
  }
  const ids = shiftIds(assignment)
  if (new Set(ids.map(key)).size !== ids.length || ids.filter((id) => same(id, selection.shiftId)).length !== 1) {
    fail('SHIFT_INVALID', 'Hãy chọn đúng một ca đang được phân cho nhân viên.')
  }
  const definitions = list(state.shiftDefinitions).filter((shift) => same(shift.id, selection.shiftId)
    && (!shift.storeId || same(shift.storeId, storeId)))
  if (definitions.length !== 1 || definitions[0].active === false || definitions[0].deletedAt
    || (definitions[0].date && definitions[0].date !== date)) {
    fail('SHIFT_INVALID', 'Ca đã ngừng sử dụng hoặc không còn hợp lệ; không thể phân ca này cho người khác.')
  }
  const snapshots = list(assignment.shiftSnapshots).filter((shift) => same(shift.id, selection.shiftId))
  if (snapshots.length !== 1 || !shiftWindow(date, snapshots[0])) {
    fail('SCHEDULE_SNAPSHOT_INVALID', 'Ca thiếu bản chụp thời gian hợp lệ hoặc có bản chụp trùng; cần đối soát lịch trước khi đổi.')
  }
  if (list(assignment.cancelledShifts).some((shift) => same(shift.shiftId || shift.id || shift, selection.shiftId))) {
    fail('SHIFT_INVALID', 'Ca được chọn đã bị hủy.')
  }
  const snapshot = snapshots[0]
  const window = { employeeId: reference(assignment), employeeIdentifierKeys: scheduleSwapEmployeeKeys(employee),
    storeId, date, shiftId: selection.shiftId, ...shiftWindow(date, snapshot) }
  if (list(state.attendance).some((row) => attendanceMatchesWindow(row, window))) {
    fail('SCHEDULE_STARTED_IMMUTABLE', 'Ca đã phát sinh điểm danh; không thể đổi lịch của ca này.')
  }
  // Task/checklist progress normally belongs to attendance. Also fail closed on
  // legacy direct shift records, without locking unrelated shifts in the day.
  const linkedWork = [...list(state.tasks), ...list(state.workCatalogProgress), ...list(state.orders)]
    .some((row) => !row.deletedAt && same(row.storeId, storeId)
      // A manually selected task shift is not the attendance/schedule shift.
      // Its attendance was checked above; do not lock another scheduled shift.
      && !list(state.attendance).some((attendance) => same(attendance.id, row.checklistAttendanceId || row.attendanceId || row.completedAttendanceId))
      && [reference(row), ...list(row.employeeIds), ...Object.keys(row.completedBy || {})]
        .some((id) => scheduleSwapEmployeeKeys(employee).includes(key(id)))
      && (row.scheduledWorkDate || row.workDate || row.date) === date
      && same(row.attendanceShiftId || row.shiftId || row.shift, selection.shiftId))
  if (assignment.lockedAt || snapshot.lockedAt || linkedWork) {
    fail('SCHEDULE_WORK_IMMUTABLE', 'Ca đã có dữ liệu công việc hoặc bị khóa; không thể đổi lịch.')
  }
  return { assignment, employee, ids, snapshot, window }
}

export const buildScheduleSwap = (state, payload, { now, actor } = {}) => {
  const { storeId, date, a, b } = payload
  const selections = [a, b].map((selection) => resolveScheduleSwapSelection(state, { storeId, date, selection }))
  const [left, right] = selections
  if (left.employee === right.employee || scheduleSwapEmployeeKeys(left.employee)
    .some((id) => scheduleSwapEmployeeKeys(right.employee).includes(id))) {
    fail('SCHEDULE_SAME_EMPLOYEE', 'Cần chọn hai nhân viên khác nhau.')
  }
  if (same(a.shiftId, b.shiftId)) fail('SCHEDULE_SWAP_NO_CHANGE', 'Hai ca giống nhau; không có thay đổi để lưu.')
  for (const [index, selected] of selections.entries()) {
    if ([a, b][index].revision !== scheduleSwapRevision(selected.assignment)) {
      fail('VERSION_CONFLICT', 'Lịch phân ca đã thay đổi, vui lòng kiểm tra lại.')
    }
  }
  const assignments = selections.map((selected, index) => {
    const incoming = selections[1 - index].snapshot
    const outgoingId = [a, b][index].shiftId
    if (selected.ids.some((id) => !same(id, outgoingId) && same(id, incoming.id))) {
      fail('SCHEDULE_DUPLICATE_SHIFT', 'Nhân viên đã có ca sẽ nhận trong lịch còn lại.')
    }
    const received = { ...incoming }
    delete received.supportTransferId
    if (!same(selected.employee.storeId, storeId)) {
      const transfer = supportForScheduledWindow(state, { employeeId: selected.employee.id || selected.employee.code,
        storeId, date, ...shiftWindow(date, received) })
      if (!transfer) fail('SUPPORT_SCHEDULE_OUTSIDE_WINDOW', 'Ca nhận phải nằm hoàn toàn trong thời gian hỗ trợ được phép.')
      received.supportTransferId = transfer.id
    }
    const ids = selected.ids.map((id) => same(id, outgoingId) ? incoming.id : id)
    return { ...selected.assignment, shiftIds: ids, shiftId: ids[0],
      shiftSnapshots: list(selected.assignment.shiftSnapshots).map((snapshot) => same(snapshot.id, outgoingId) ? received : snapshot),
      ...(now ? { updatedAt: now, updatedBy: actor } : {}),
    }
  })
  const changed = new Map(assignments.map((assignment) => [assignment.id, assignment]))
  const schedule = list(state.schedule).map((assignment) => changed.get(assignment.id) || assignment)
  // Validate both replacements together, against every store and adjacent day.
  const problem = scheduleConflict({ ...state, schedule }, assignments)
  if (problem) fail(problem.code, problem.code === 'SUPPORT_SCHEDULE_OUTSIDE_WINDOW'
    ? 'Ca hỗ trợ nằm ngoài thời gian điều chuyển được phép.'
    : problem.code === 'SCHEDULE_TIME_OVERLAP' ? 'Lịch sau đổi bị trùng giờ với ca đã phân. Vui lòng kiểm tra lại.'
      : 'Lịch liên quan thiếu thời gian hợp lệ; cần đối soát trước khi đổi.')
  return { schedule, assignments, employees: selections.map((selection) => selection.employee), before: selections.map((selection) => selection.assignment) }
}
