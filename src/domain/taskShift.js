import { activeWorkCatalogItems, WORK_CATALOG_KIND } from './workCatalog.js'
import { resolveStoreChecklistCatalogShift } from './storeShiftChecklist.js'

const text = (value) => String(value || '').trim()
const folded = (value) => text(value).toLowerCase()
const aliases = (record) => [record?.id, record?.code, record?.employeeId, record?.employeeCode].map(text).filter(Boolean)
const resolve = (records, reference) => {
  const matches = records.filter((record) => aliases(record).some((id) => folded(id) === folded(reference)))
  const exact = matches.filter((record) => aliases(record).includes(text(reference)))
  return exact.length === 1 ? exact[0] : matches.length === 1 ? matches[0] : null
}
const matches = (records, target, reference) => Boolean(target && text(reference) && resolve(records, reference) === target)
export const isMandatoryTask = (task) => task.rewardEligible !== true
  && (task.catalogKind || task.catalogSnapshot?.kind || task.kind) !== WORK_CATALOG_KIND.REWARD_TASK

export const taskShiftChoices = (state, storeId) => {
  const stores = state.stores || []
  const store = resolve(stores, storeId)
  if (!store) return []
  const configured = (state.shiftDefinitions || []).filter((shift) => !shift.deletedAt && shift.active !== false
    && (!shift.storeId || matches(stores, store, shift.storeId)))
  const synthetic = (state.attendance || []).filter((record) => record.supportTransferId
    && !record.deletedAt && !record.checkOut && !record.checkOutAt
    && matches(stores, store, record.storeId)
    && !configured.some((shift) => shift.id === (record.shiftId || record.shift)))
    .map((record) => ({ id: record.shiftId || record.shift, name: record.shiftName,
      storeId: record.storeId, start: record.shiftStart, end: record.shiftEnd }))
  const catalogChoices = []
  for (const item of state.workCatalogItems || []) {
    if (item.targetGroup !== 'store' || item.kind !== WORK_CATALOG_KIND.FIXED_TASK || item.deletedAt || item.active === false
      || (item.storeId && !matches(stores, store, item.storeId)) || !text(item.shiftId)) continue
    // Catalog shift ids are also configuration, not a hard-coded fallback list.
    // A deleted configured shift must not be resurrected from its catalog rows.
    if ((state.shiftDefinitions || []).some((shift) => folded(shift.id) === folded(item.shiftId))
      || catalogChoices.some((shift) => shift.id === item.shiftId)) continue
    catalogChoices.push({ id: item.shiftId, name: item.shiftName || resolveStoreChecklistCatalogShift({ id: item.shiftId })?.shiftName || item.shiftId, storeId })
  }
  return [...configured, ...synthetic, ...catalogChoices]
}

// Pure preview: selecting a shift cannot create attendance, obligations or rewards.
// The command builds the same list from server state and only persists it on Save.
export const taskShiftContext = ({ state, attendance, employeeId, selectedTaskShiftId }) => {
  const fail = (message, code = 'TASK_SHIFT_INVALID') => ({ tasks: [], error: message, code })
  const shifts = taskShiftChoices(state, attendance?.storeId)
  const shift = resolve(shifts, selectedTaskShiftId)
  if (!text(selectedTaskShiftId)) return fail('Vui lòng chọn ca làm việc để xem công việc được giao')
  if (!shift) return fail('Ca làm việc không còn hợp lệ hoặc mã ca không rõ ràng.')
  if (shifts.filter((item) => folded(item.id) === folded(shift.id)).length !== 1) return fail('Mã ca làm việc bị trùng; cần quản lý xử lý.')
  const employee = resolve(state.employees || [], employeeId)
  const store = resolve(state.stores || [], attendance?.storeId)
  if (!employee || !store || !matches(state.employees, employee, attendance?.employeeId)) return fail('Không có quyền truy cập công việc.', 'TASK_SCOPE_FORBIDDEN')
  const date = text(attendance.date || attendance.workDate).slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(date)) return fail('Ngày làm việc không hợp lệ.')
  const canonical = resolveStoreChecklistCatalogShift({ selectedTaskShiftId: shift.id, id: shift.id, name: shift.name, start: shift.start, end: shift.end })
  const shiftMatches = (reference) => {
    if (!text(reference)) return false
    const configured = resolve(shifts, reference)
    if (configured) return configured === shift
    return Boolean(canonical && resolveStoreChecklistCatalogShift({ id: reference })?.shiftId === canonical.shiftId)
  }
  const bound = (attendance.taskShiftContexts || []).find((context) => context.shiftId === shift.id)
  const boundIds = bound ? new Set(bound.taskIds) : null
  const persisted = (state.tasks || []).filter((task) => {
    if (task.deletedAt || task.active === false || !isMandatoryTask(task) || !matches(state.stores, store, task.storeId)) return false
    if (text(task.date || task.workDate).slice(0, 10) !== date) return false
    if (task.checklistAttendanceId && !matches(state.attendance || [attendance], attendance, task.checklistAttendanceId)) return false
    const assignees = [task.employeeId, ...(task.employeeIds || []), ...(task.assigneeIds || []), ...(task.assignedEmployeeIds || [])].filter(Boolean)
    if (!assignees.some((id) => matches(state.employees, employee, id))) return false
    if (boundIds) return boundIds.has(task.id)
    // Legacy rows retain their ids and completion; a captured catalog shift is
    // more precise than the attendance shift stamped on old generated rows.
    return shiftMatches(task.taskShiftId || task.catalogSnapshot?.shiftId || task.shiftId || task.shift)
  })
  if (boundIds && persisted.length !== boundIds.size) return fail('Công việc đã lưu bị thiếu hoặc bị khóa. Vui lòng tải lại và liên hệ quản lý.', 'TASK_CONTEXT_CHANGED')
  if (boundIds) return { shift, tasks: persisted, date }
  let definitions
  try {
    definitions = activeWorkCatalogItems(state.workCatalogItems || [], {
      targetGroup: 'store', storeId: store.id, selectedTaskShiftId: shift.id, shiftId: shift.id, shiftName: shift.name,
      shiftStart: shift.start, shiftEnd: shift.end, date, kinds: [WORK_CATALOG_KIND.FIXED_TASK],
    })
  } catch {
    return fail('Danh mục công việc không hợp lệ.', 'WORK_CATALOG_DATA_INVALID')
  }
  const knownCatalogIds = new Set(persisted.map((task) => task.catalogItemId))
  const assignmentId = `task_shift_${encodeURIComponent(attendance.id)}_${encodeURIComponent(shift.id)}`
  const generated = definitions.filter((item) => !knownCatalogIds.has(item.id)).map((item) => ({
    id: `${assignmentId}_${encodeURIComponent(item.id)}`, assignmentId,
    checklistAttendanceId: attendance.id, taskShiftId: shift.id,
    catalogItemId: item.id, catalogKind: item.kind, catalogVersion: item.version,
    catalogSnapshot: { ...item }, storeId: store.id, employeeId: employee.id || employeeId,
    employeeIds: [employee.id || employeeId], date, workDate: date, shiftId: shift.id,
    shiftName: shift.name, title: item.name, description: item.name,
    required: true, rewardEligible: false, active: true, completedBy: {},
  }))
  if (generated.some((task) => (state.tasks || []).some((row) => row.id === task.id))) {
    return fail('Mã công việc mới trùng dữ liệu đã tồn tại; cần quản lý xử lý.', 'TASK_IDENTIFIER_COLLISION')
  }
  return { shift, tasks: [...persisted, ...generated], date }
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
  return {
    ...progress,
    incompleteTaskIds: [...new Set([...remaining, ...progress.incompleteTaskIds])],
    incompleteReason: [...new Set([remaining.length ? previous.incompleteReason : '', progress.incompleteReason].filter(Boolean))].join('\n').slice(0, 1000),
  }
}
