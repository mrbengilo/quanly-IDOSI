import { activeWorkCatalogItems, WORK_CATALOG_KIND } from './workCatalog.js'
import { resolveStoreChecklistCatalogShift } from './storeShiftChecklist.js'
import { attendanceTaskShiftLock, bindTaskShiftContext, TASK_SHIFT_LOCK_STATUS, taskShiftLockAllows } from './taskProgress.js'

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

// Preserve the original object (source identity is used by slotRank). Only
// identical JSON records with the same exact id are copies of one entity;
// name/time/template equivalence is not evidence that two definitions are one.
const recordSignature = (value) => JSON.stringify(value, (_key, child) => (
  child && typeof child === 'object' && !Array.isArray(child)
    ? Object.fromEntries(Object.keys(child).sort().map((key) => [key, child[key]]))
    : child
))
const distinctShiftCopies = (shifts) => {
  const seen = new Set()
  return shifts.filter((shift) => {
    if (!text(shift.id)) return true
    const signature = recordSignature(shift)
    if (seen.has(signature)) return false
    seen.add(signature)
    return true
  })
}

export const taskShiftChoices = (state, storeId, date = '', attendance = null) => {
  const stores = state.stores || []
  const store = resolve(stores, storeId)
  if (!store) return []
  const configured = distinctShiftCopies(state.shiftDefinitions || []).filter((shift) => !shift.deletedAt && shift.active !== false
    && (!date || !shift.date || text(shift.date).slice(0, 10) === date)
    && (!shift.storeId || matches(stores, store, shift.storeId)))
  // Server state contains other employees' attendance; the employee projection
  // does not. Only this attendance can supply its immutable support shift.
  const synthetic = (attendance ? [attendance] : []).filter((record) => record.supportTransferId
    && !record.deletedAt && !record.checkOut && !record.checkOutAt
    && (!date || text(record.date || record.workDate).slice(0, 10) === date)
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
    // Do not offer a second catalog alias for the same configured shift. This
    // avoids creating a second manual snapshot by selecting ca3 after its UUID.
    if (configured.some((shift) => resolveStoreChecklistCatalogShift({
      selectedTaskShiftId: shift.id, id: shift.id, name: shift.name, start: shift.start, end: shift.end,
    })?.shiftId === item.shiftId)) continue
    catalogChoices.push({ id: item.shiftId, name: item.shiftName || resolveStoreChecklistCatalogShift({ id: item.shiftId })?.shiftName || item.shiftId, storeId })
  }
  return [...configured, ...synthetic, ...catalogChoices]
}

// Pure preview: this helper never writes. task.shift.select persists the lock
// and binds obligations; task.progress.save persists their completion later.
export const taskShiftContext = ({ state, attendance, employeeId, selectedTaskShiftId }) => {
  const fail = (message, code = 'TASK_SHIFT_INVALID') => ({ tasks: [], error: message, code })
  // Date-specific shift definitions are valid only on the attendance business
  // date, matching scheduling rules even for an overnight/early check-in.
  const date = text(attendance?.date || attendance?.workDate).slice(0, 10)
  const shifts = taskShiftChoices(state, attendance?.storeId, date, attendance)
  const shift = resolve(shifts, selectedTaskShiftId)
  if (!text(selectedTaskShiftId)) return fail('Vui lòng chọn ca làm việc để xem công việc được giao')
  if (!shift) return fail('Ca làm việc không còn hợp lệ hoặc mã ca không rõ ràng.')
  if (shifts.filter((item) => folded(item.id) === folded(shift.id)).length !== 1) return fail('Mã ca làm việc bị trùng; cần quản lý xử lý.')
  const employee = resolve(state.employees || [], employeeId)
  const store = resolve(state.stores || [], attendance?.storeId)
  if (!employee || !store || !matches(state.employees, employee, attendance?.employeeId)) return fail('Không có quyền truy cập công việc.', 'TASK_SCOPE_FORBIDDEN')
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(date)) return fail('Ngày làm việc không hợp lệ.')
  const canonical = resolveStoreChecklistCatalogShift({ selectedTaskShiftId: shift.id, id: shift.id, name: shift.name, start: shift.start, end: shift.end })
  const shiftMatches = (reference) => {
    // Explicit assignments without a work shift belong to whichever single
    // shift this attendance works, matching the historical checkout rule.
    if (!text(reference)) return true
    const configured = resolve(shifts, reference)
    if (configured === shift) return true
    // Catalog-only canonical choices are aliases for a configured shift, while
    // two independently configured ids must remain distinct even if names match.
    if (configured && (state.shiftDefinitions || []).includes(configured)) return false
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
    if (boundIds?.has(task.id)) return true
    // Legacy rows retain their ids and completion; a captured catalog shift is
    // more precise than the attendance shift stamped on old generated rows.
    return shiftMatches(task.taskShiftId || task.catalogSnapshot?.shiftId || task.shiftId || task.shift)
  })
  if (boundIds && [...boundIds].some((id) => !persisted.some((task) => task.id === id))) return fail('Công việc đã lưu bị thiếu hoặc bị khóa. Vui lòng tải lại và liên hệ quản lý.', 'TASK_CONTEXT_CHANGED')
  // Freeze catalog snapshots, while still showing explicit assignments added
  // later by a manager. Saving accepts those additional obligations atomically.
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
  // A catalog item already captured for this attendance (for example by the
  // check-in snapshot under another shift id/alias) is the same work: reuse
  // that row instead of generating an equivalent duplicate checklist.
  const capturedByCatalogId = new Map()
  for (const task of state.tasks || []) {
    if (task.deletedAt || task.active === false || !isMandatoryTask(task) || !text(task.catalogItemId)) continue
    if (!text(task.checklistAttendanceId) || !matches(state.attendance || [attendance], attendance, task.checklistAttendanceId)) continue
    if (!matches(state.stores, store, task.storeId) || text(task.date || task.workDate).slice(0, 10) !== date) continue
    const assignees = [task.employeeId, ...(task.employeeIds || []), ...(task.assigneeIds || []), ...(task.assignedEmployeeIds || [])].filter(Boolean)
    if (!assignees.some((id) => matches(state.employees, employee, id))) continue
    if (!capturedByCatalogId.has(task.catalogItemId)) capturedByCatalogId.set(task.catalogItemId, task)
  }
  const reused = definitions.filter((item) => !knownCatalogIds.has(item.id) && capturedByCatalogId.has(item.id))
    .map((item) => capturedByCatalogId.get(item.id))
  const assignmentId = `task_shift_${encodeURIComponent(attendance.id)}_${encodeURIComponent(shift.id)}`
  const generated = definitions.filter((item) => !knownCatalogIds.has(item.id) && !capturedByCatalogId.has(item.id)).map((item) => ({
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
  return { shift, tasks: [...persisted, ...reused, ...generated], date }
}

export const TASK_SHIFT_SLOTS = Object.freeze([
  Object.freeze({ key: 'morning', label: 'Ca sáng' }),
  Object.freeze({ key: 'afternoon', label: 'Ca chiều' }),
  Object.freeze({ key: 'night', label: 'Ca tối' }),
])

const slotKeyOf = (shift) => resolveStoreChecklistCatalogShift({
  selectedTaskShiftId: shift.id, id: shift.id, name: shift.name, start: shift.start, end: shift.end,
})?.templateKey || ''

const ownSupportShift = (state, shift, attendance) => Boolean(attendance?.supportTransferId)
  && folded(shift.id) === folded(attendance.shiftId || attendance.shift)
  && !(state.shiftDefinitions || []).includes(shift)

// A configured shift with custom name/hours and no canonical template is placed
// by its configured start (configuration, not check-in or system time).
const configuredStartSlot = (shift) => {
  const match = text(shift?.start).match(/^(\d{1,2}):(\d{2})$/u)
  if (!match) return ''
  const minutes = Number(match[1]) * 60 + Number(match[2])
  return minutes < 12 * 60 ? 'morning' : minutes < 17 * 60 ? 'afternoon' : 'night'
}

// Specificity, not a guess: the attendance's own support-transfer shift, then a
// store/date-specific definition, then a canonical (alias/template) match over a
// start-time placement. Independent top-precedence shifts remain explicit
// choices; only conflicting identities or indistinguishable choices are blocked.
const slotRank = (state, shift, attendance) => {
  if (ownSupportShift(state, shift, attendance)) return 100
  const canonical = slotKeyOf(shift) ? 1 : 0
  if (!(state.shiftDefinitions || []).includes(shift)) return canonical
  return (1 + (text(shift.storeId) ? 2 : 0) + (text(shift.date) ? 1 : 0)) * 2 + canonical
}

export const taskShiftSlots = (state, storeId, date = '', attendance = null) => {
  const choices = taskShiftChoices(state, storeId, date, attendance)
  const configured = new Set(state.shiftDefinitions || [])
  const keyOf = (shift) => slotKeyOf(shift)
    || (configured.has(shift) || ownSupportShift(state, shift, attendance) ? configuredStartSlot(shift) : '')
  return TASK_SHIFT_SLOTS.map((slot) => {
    const candidates = choices.filter((shift) => keyOf(shift) === slot.key)
    if (!candidates.length) return { ...slot, status: 'missing', shift: null }
    const topRank = Math.max(...candidates.map((shift) => slotRank(state, shift, attendance)))
    const best = candidates.filter((shift) => slotRank(state, shift, attendance) === topRank)
    // A conflicting copy can map to another slot or rank. It still cannot be
    // selected by id, so never advertise it as ready on the employee screen.
    const labels = best.map((shift) => `${folded(shift.name)}|${text(shift.start)}|${text(shift.end)}`)
    if (best.some((candidate) => !text(candidate.id) || choices.filter((shift) => folded(shift.id) === folded(candidate.id)).length !== 1)
      || new Set(labels).size !== labels.length) {
      return { ...slot, status: 'ambiguous', shift: null }
    }
    if (best.length > 1) return { ...slot, status: 'multiple', shift: null,
      choices: best.toSorted((left, right) => text(left.start).localeCompare(text(right.start))
        || text(left.end).localeCompare(text(right.end)) || text(left.name).localeCompare(text(right.name))) }
    return { ...slot, status: 'ready', shift: best[0] }
  })
}

export const taskShiftSlotFor = (state, storeId, date, shiftId, attendance = null) => taskShiftSlots(state, storeId, date, attendance)
  .flatMap((slot) => (slot.shift ? [slot] : (slot.choices || []).map((shift) => ({ ...slot, shift }))))
  .find((slot) => folded(slot.shift.id) === folded(shiftId)) || null

// Task ids the locked shift currently shows (persisted rows only). Null when the
// attendance has no single selected lock or the context cannot be resolved.
export const taskShiftLockedTaskIds = ({ state, attendance, employeeId }) => {
  const lock = attendanceTaskShiftLock(attendance)
  if (lock.status !== TASK_SHIFT_LOCK_STATUS.SELECTED) return null
  const context = taskShiftContext({ state, attendance, employeeId, selectedTaskShiftId: lock.shiftId })
  if (context.error) return new Set()
  const persisted = new Set((state.tasks || []).map((task) => task.id))
  return new Set(context.tasks.filter((task) => persisted.has(task.id)).map((task) => task.id))
}

// Pure validation + next attendance for the `task.shift.select` command and the
// local demo fallback. It never marks work done, creates rewards or changes the
// attendance (payroll) shift; it records one shift and binds its obligations.
export const selectAttendanceTaskShift = ({ state, attendance, employeeId, selectedTaskShiftId, now, actor = null }) => {
  const fail = (code, message, status = 409, details = null) => ({ error: message, code, status, details })
  if (!attendance || attendance.deletedAt || attendance.checkOutAt || attendance.checkOut) {
    return fail('OPEN_ATTENDANCE_REQUIRED', 'Bạn cần điểm danh và đang trong ca để chọn ca công việc.')
  }
  const lock = attendanceTaskShiftLock(attendance)
  if (lock.status === TASK_SHIFT_LOCK_STATUS.LEGACY_MULTI) {
    return fail('TASK_SHIFT_LEGACY_MULTI_CONTEXT', 'Lượt điểm danh này đã lưu công việc của nhiều ca trước khi áp dụng quy tắc một ca; chỉ được cập nhật các ca đã lưu.', 409, { shiftIds: lock.shiftIds })
  }
  const date = text(attendance.date || attendance.workDate).slice(0, 10)
  const context = taskShiftContext({ state, attendance, employeeId, selectedTaskShiftId })
  if (context.error) return fail(context.code, context.error, context.code === 'TASK_SCOPE_FORBIDDEN' ? 403 : 409)
  const slot = taskShiftSlotFor(state, attendance.storeId, date, context.shift.id, attendance)
  if (!slot) return fail('TASK_SHIFT_INVALID', 'Ca không thuộc Ca sáng, Ca chiều hoặc Ca tối hợp lệ của cửa hàng hôm nay.')
  if (lock.status === TASK_SHIFT_LOCK_STATUS.SELECTED && !taskShiftLockAllows(lock, context.shift.id)) {
    return fail('TASK_SHIFT_ALREADY_SELECTED', 'Lượt điểm danh này đã chọn ca công việc khác; không thể đổi ca.', 409, { shiftId: lock.shiftId })
  }
  if (attendance.taskShiftSelection?.shiftId) return { existing: true, shift: context.shift, slot, context, attendance, newTasks: [] }
  const existingIds = new Set((state.tasks || []).map((task) => task.id))
  const newTasks = context.tasks.filter((task) => !existingIds.has(task.id)).map((task) => ({ ...task, createdAt: now, updatedAt: now }))
  const alreadyBound = (attendance.taskShiftContexts || []).some((entry) => folded(entry.shiftId) === folded(context.shift.id))
  const next = {
    ...(alreadyBound ? attendance : bindTaskShiftContext(attendance, context)),
    taskShiftSelection: {
      attendanceId: attendance.id, shiftId: context.shift.id, shiftName: context.shift.name || slot.label,
      slot: slot.key, selectedAt: now, ...(actor ? { selectedBy: actor } : {}),
      ...(lock.legacy ? { legacyContext: true } : {}),
    },
    updatedAt: now,
  }
  return { existing: false, shift: context.shift, slot, context, attendance: next, newTasks, date }
}

export { bindTaskShiftContext, taskBelongsToAttendanceObligations, mergeTaskShiftProgress, attendanceTaskShiftLock, taskShiftLockAllows, taskIsAttendanceShiftObligation, taskProgressForObligations, TASK_SHIFT_LOCK_STATUS } from './taskProgress.js'
