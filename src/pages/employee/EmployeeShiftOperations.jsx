import { useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ClipboardCheck, Clock3, Lock, LogIn, ReceiptText, Save, Store } from 'lucide-react'
import { Badge, Button, Card, Field, InfoNote, Input, MoneyInput, PageHeader, Progress, TableWrap } from '../../components/UI'
import { attendanceTaskShiftLock, TASK_SHIFT_LOCK_STATUS, taskShiftContext, taskShiftLockAllows, taskShiftSlotFor, taskShiftSlots } from '../../domain/taskShift'
import { useApp } from '../../state/AppContext'
import {
  money,
  operationalIdentifierRecordMatch,
  shortDateTime24,
} from '../../utils'
import { taskCompletedByEmployee } from './taskScope'

const employeeKey = (record) => String(record?.id || record?.code || record?.employeeId || '')
const employeeAliases = (record) => [record?.id, record?.code, record?.employeeId, record?.employeeCode]
  .map((value) => String(value || '').trim())
  .filter(Boolean)
const storeAliases = (record) => [record?.id, record?.code]
  .map((value) => String(value || '').trim())
  .filter(Boolean)
const recordDate = (record) => String(record?.date || record?.workDate || record?.checkInAt || record?.createdAt || '').slice(0, 10)
const resolveTarget = (records, reference, identifierOf, fallback = null) => {
  const source = Array.isArray(records) ? records : []
  if (!source.length) return fallback
  const resolution = operationalIdentifierRecordMatch(source, reference, identifierOf)
  return resolution.ambiguous ? null : resolution.record
}

const referenceMatchesTarget = (records, target, reference, identifierOf) => {
  if (!target || !String(reference || '').trim()) return false
  const source = Array.isArray(records) && records.length ? records : [target]
  const resolution = operationalIdentifierRecordMatch(source, reference, identifierOf)
  return !resolution.ambiguous && resolution.record === target
}

const currentEmployeeOf = (app) => {
  const employees = Array.isArray(app.employees) ? app.employees : []
  const keys = [
    employeeKey(app.currentEmployee),
    app.session?.employeeId,
    app.session?.code,
    app.session?.id,
  ].filter(Boolean)
  for (const key of keys) {
    const resolution = operationalIdentifierRecordMatch(employees, key, employeeAliases)
    if (resolution.ambiguous) return {}
    if (resolution.record) return resolution.record
  }
  const usernameMatches = employees.filter((employee) => (
    app.session?.username && employee.username === app.session.username
  ))
  if (usernameMatches.length === 1) return usernameMatches[0]
  if (usernameMatches.length > 1) return {}
  return employees.length ? {} : (app.currentEmployee || app.session || {})
}

const ownOpenAttendance = (attendance, employee, employees) => {
  const target = resolveTarget(employees, employeeKey(employee), employeeAliases, employee)
  if (!target) return null
  return (Array.isArray(attendance) ? attendance : []).find((record) => (
    !record.deletedAt
    && [record.employeeId, record.employeeCode].some((reference) => (
      referenceMatchesTarget(employees, target, reference, employeeAliases)
    ))
    && !record.checkOutAt
    && !record.checkOut
  )) || null
}

export function EmployeeShiftExpensePage() {
  const app = useApp()
  const employee = currentEmployeeOf(app)
  const employeeId = employeeKey(employee)
  const attendance = useMemo(
    () => ownOpenAttendance(app.attendance, employee, app.employees),
    [app.attendance, app.employees, employee],
  )
  const [form, setForm] = useState({ name: '', amount: '', note: '' })
  const [saving, setSaving] = useState(false)
  const requestRef = useRef(null)
  const history = useMemo(() => (app.expenseEntries || [])
    .filter((entry) => (
      entry.recognized !== false
      && String(entry.sourceType || '') === 'shift-expense-item'
       && referenceMatchesTarget(app.employees, employee, entry.employeeId, employeeAliases)
    ))
    .sort((left, right) => String(right.occurredAt || right.createdAt || '').localeCompare(String(left.occurredAt || left.createdAt || ''))), [app.employees, app.expenseEntries, employee])
  const activeStore = resolveTarget(app.stores, attendance?.storeId || app.session?.storeId, storeAliases)
  const amount = Number(form.amount || 0)
  const ready = Boolean(attendance && form.name.trim() && amount > 0 && form.note.length <= 1_000)

  const update = (field) => (event) => setForm((current) => ({ ...current, [field]: event.target.value }))
  const submit = async (event) => {
    event.preventDefault()
    if (!ready || saving || typeof app.addShiftExpense !== 'function') return
    const fingerprint = JSON.stringify({ attendanceId: attendance.id, name: form.name.trim(), amount, note: form.note.trim() })
    if (!requestRef.current || requestRef.current.fingerprint !== fingerprint) {
      requestRef.current = { fingerprint, idempotencyKey: `shift-expense:${crypto.randomUUID()}` }
    }
    setSaving(true)
    try {
      const result = await app.addShiftExpense({
        attendanceId: attendance.id,
        name: form.name.trim(),
        amount,
        note: form.note.trim(),
        idempotencyKey: requestRef.current.idempotencyKey,
      })
      if (result?.ok) {
        setForm({ name: '', amount: '', note: '' })
        requestRef.current = null
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="page employee-shift-expense-page">
      <PageHeader title="CHI PHÍ TRONG CA" subtitle="Ghi nhận chi phí phát sinh đúng ca, cửa hàng và người tạo." icon={ReceiptText} />
      {!attendance
        ? <InfoNote tone="orange">Bạn cần điểm danh và có ca đang mở trước khi nhập chi phí.</InfoNote>
        : <InfoNote><strong>{activeStore?.name || attendance.storeName || attendance.storeId}</strong> · {attendance.shiftName || attendance.shift || 'Ca làm việc'} · vào lúc {attendance.checkIn || shortDateTime24(attendance.checkInAt)}</InfoNote>}
      <Card title="Nhập chi phí trong ca">
        <form className="form-grid" onSubmit={submit}>
          <Field label="Tên chi phí" required>
            <Input value={form.name} onChange={update('name')} maxLength="160" placeholder="Ví dụ: Mua vật dụng vệ sinh" />
          </Field>
          <Field label="Số tiền" required hint={amount > 0 ? money(amount) : 'Nhập đúng số tiền bằng đồng'}>
            <MoneyInput value={form.amount} onChange={update('amount')} placeholder="Nhập số tiền" />
          </Field>
          <Field label="Ghi chú" className="span-2" hint={`${form.note.length}/1.000 ký tự`} error={form.note.length > 1_000 ? 'Ghi chú không được vượt quá 1.000 ký tự.' : ''}>
            <textarea value={form.note} onChange={update('note')} maxLength="1000" placeholder="Thông tin bổ sung (nếu có)" />
          </Field>
          <Button type="submit" icon={Save} loading={saving} disabled={!ready || saving}>LƯU</Button>
        </form>
      </Card>
      <Card title="Lịch sử chi phí trong ca">
        <TableWrap>
          <thead><tr><th>Thời gian</th><th>Cửa hàng / Ca</th><th>Tên chi phí</th><th>Số tiền</th><th>Ghi chú</th><th>Người tạo</th></tr></thead>
          <tbody>
            {history.map((entry) => <tr key={entry.id}>
              <td><strong>{shortDateTime24(entry.occurredAt || entry.createdAt)}</strong></td>
              <td><span className="table-stack"><strong><Store size={14} /> {entry.storeName || resolveTarget(app.stores, entry.storeId, storeAliases)?.name || entry.storeId}</strong><small><Clock3 size={13} /> {entry.shiftName || entry.shiftId || '—'}</small></span></td>
              <td>{entry.name || entry.type || '—'}</td>
              <td><strong>{money(entry.amount)}</strong></td>
              <td>{entry.note || entry.description || '—'}</td>
              <td>{entry.createdByActor?.name || entry.employeeName || employee.name || employeeId}</td>
            </tr>)}
            {!history.length && <tr><td colSpan="6">Chưa có chi phí trong ca do bạn ghi nhận.</td></tr>}
          </tbody>
        </TableWrap>
      </Card>
    </div>
  )
}

const taskShiftTime = (shift) => (shift?.start && shift?.end ? `${shift.start}–${shift.end}` : '')
const UNAVAILABLE_SLOT_TEXT = {
  missing: 'Chưa cấu hình',
  ambiguous: 'Cấu hình trùng',
}

export function EmployeeAssignedTasksPage() {
  const app = useApp()
  const navigate = useNavigate()
  const employee = currentEmployeeOf(app)
  const employeeId = employeeKey(employee)
  const attendance = ownOpenAttendance(app.attendance, employee, app.employees)
  const storeId = attendance?.storeId || ''
  const date = recordDate(attendance)
  // The lock belongs to the attendance record returned by the server, never to
  // this component, a tab, the URL or browser storage.
  const lock = attendanceTaskShiftLock(attendance)
  const slots = attendance ? taskShiftSlots(app, storeId, date, attendance) : []
  const scopeKey = JSON.stringify([employeeId, storeId, date, attendance?.id || ''])
  const [legacyView, setLegacyView] = useState({ scopeKey: '', id: '' })
  const [expanded, setExpanded] = useState({ scopeKey: '', key: '' })
  const [pending, setPending] = useState({ scopeKey: '', slot: '' })
  const [notice, setNotice] = useState({ scopeKey: '', tone: 'orange', text: '' })
  const selectRequestRef = useRef(null)
  const selectBusyRef = useRef(false)
  const pendingSlot = pending.scopeKey === scopeKey ? pending.slot : ''
  const scopedNotice = notice.scopeKey === scopeKey ? notice : null
  const legacyShiftId = lock.status === TASK_SHIFT_LOCK_STATUS.LEGACY_MULTI
    && legacyView.scopeKey === scopeKey && taskShiftLockAllows(lock, legacyView.id) ? legacyView.id : ''
  const selectedTaskShiftId = lock.status === TASK_SHIFT_LOCK_STATUS.SELECTED ? lock.shiftId : legacyShiftId
  const context = attendance && selectedTaskShiftId ? taskShiftContext({
    state: app, attendance, employeeId, selectedTaskShiftId,
  }) : { tasks: [] }
  const lockedSlot = lock.status === TASK_SHIFT_LOCK_STATUS.SELECTED
    ? taskShiftSlotFor(app, storeId, date, lock.shiftId, attendance)
    : null
  const lockedLabel = lockedSlot?.label || attendance?.taskShiftSelection?.shiftName || context.shift?.name || lock.shiftId
  const displayedTasks = context.error ? [] : context.tasks
  // Drafts are keyed by identity, business date, attendance and task shift.
  const draftKey = JSON.stringify([scopeKey, selectedTaskShiftId])
  const [drafts, setDrafts] = useState({})
  const draft = drafts[draftKey] || { statuses: {}, reason: '', acknowledged: [] }
  const updateDraft = (patch) => setDrafts((current) => ({
    ...current, [draftKey]: { ...(current[draftKey] || { statuses: {}, reason: '', acknowledged: [] }), ...patch },
  }))
  const [saving, setSaving] = useState(false)
  const requestRef = useRef(null)
  const busyRef = useRef(false)
  const storedStatusFor = (task) => taskCompletedByEmployee(task, employeeId, app.employees) || draft.acknowledged.includes(task.id)
  const statusFor = (task) => storedStatusFor(task) || draft.statuses[task.id] === true
  const completedTasks = displayedTasks.filter(statusFor).length
  const completionRate = displayedTasks.length ? Math.round(completedTasks / displayedTasks.length * 100) : 0
  const allCompleted = displayedTasks.length > 0 && completedTasks === displayedTasks.length
  const incompleteRequiredTasks = displayedTasks.filter((task) => task.required !== false && !statusFor(task))
  const noteRequired = incompleteRequiredTasks.length > 0
  const incompleteReason = draft.reason
  const newlyCompletedTasks = displayedTasks.filter((task) => !storedStatusFor(task) && statusFor(task))
  const selectedShiftIsOpen = Boolean(attendance && selectedTaskShiftId && !context.error)
  const ready = selectedShiftIsOpen && displayedTasks.length > 0
    && (newlyCompletedTasks.length > 0 || (noteRequired && incompleteReason.trim()))
    && (!noteRequired || incompleteReason.trim())
  const history = (app.taskAssignmentHistory || []).flatMap((assignment) => (
    (assignment.progressHistory || []).filter((event) => (
      referenceMatchesTarget(app.employees, employee, event.employeeId, employeeAliases)
    )).map((event) => ({
      ...event,
      assignmentId: event.assignmentId || assignment.assignmentId || assignment.id,
    }))
  )).sort((left, right) => String(right.at || '').localeCompare(String(left.at || '')))

  const chooseSlot = async (slot) => {
    if (!attendance || !slot.shift || selectBusyRef.current || lock.status !== TASK_SHIFT_LOCK_STATUS.NONE
      || typeof app.selectTaskShift !== 'function') return
    const fingerprint = JSON.stringify([attendance.id, slot.shift.id])
    // A retry of the same choice reuses its key so a lost response is replayed,
    // never executed twice; a different choice gets its own request.
    if (!selectRequestRef.current || selectRequestRef.current.fingerprint !== fingerprint) {
      selectRequestRef.current = { fingerprint, idempotencyKey: `task-shift:${crypto.randomUUID()}` }
    }
    const requestScope = scopeKey
    selectBusyRef.current = true
    setPending({ scopeKey: requestScope, slot: slot.key })
    setNotice({ scopeKey: '', tone: 'orange', text: '' })
    try {
      const result = await app.selectTaskShift({
        attendanceId: attendance.id,
        selectedTaskShiftId: slot.shift.id,
        idempotencyKey: selectRequestRef.current.idempotencyKey,
      })
      if (result?.ok) {
        selectRequestRef.current = null
      } else {
        if (!result?.uncertain) selectRequestRef.current = null
        setNotice({ scopeKey: requestScope, tone: 'orange', text: result?.message || 'Không thể chọn ca công việc.' })
      }
    } catch (error) {
      setNotice({ scopeKey: requestScope, tone: 'orange', text: error?.message || 'Chưa xác định được kết quả chọn ca. Vui lòng tải lại trang.' })
    } finally {
      selectBusyRef.current = false
      setPending({ scopeKey: '', slot: '' })
    }
  }

  const submit = async () => {
    if (!ready || busyRef.current || typeof app.saveStoreTaskProgress !== 'function') return
    const tasks = displayedTasks.map((task) => ({ id: task.id, completed: statusFor(task) }))
    const normalizedReason = noteRequired ? incompleteReason.trim() : ''
    const fingerprint = JSON.stringify({ attendanceId: attendance.id, selectedTaskShiftId, tasks, incompleteReason: normalizedReason })
    if (!requestRef.current || requestRef.current.fingerprint !== fingerprint) {
      requestRef.current = { fingerprint, idempotencyKey: `task-progress:${crypto.randomUUID()}` }
    }
    busyRef.current = true
    setSaving(true)
    try {
      const result = await app.saveStoreTaskProgress({
        attendanceId: attendance.id, selectedTaskShiftId, tasks,
        incompleteReason: normalizedReason, idempotencyKey: requestRef.current.idempotencyKey,
      })
      if (result?.ok) {
        // Apply the response only to the request's original context, even if
        // session/attendance changed while the command was in flight.
        setDrafts((current) => ({ ...current, [draftKey]: {
          statuses: {}, reason: '', acknowledged: displayedTasks.filter(statusFor).map((task) => task.id),
        } }))
        requestRef.current = null
      } else app.notify?.(result?.message || 'Không thể lưu kết quả công việc. Vui lòng tải lại và thử lại.', 'info')
    } catch (error) {
      app.notify?.(error.message || 'Không thể lưu kết quả công việc.', 'info')
    } finally {
      busyRef.current = false
      setSaving(false)
    }
  }

  const visibleSlots = lock.status === TASK_SHIFT_LOCK_STATUS.SELECTED
    ? [lockedSlot || { key: 'locked', label: lockedLabel, status: 'ready', shift: context.shift || { id: lock.shiftId } }]
    : lock.status === TASK_SHIFT_LOCK_STATUS.LEGACY_MULTI
      ? lock.shiftIds.map((shiftId) => {
          const slot = taskShiftSlotFor(app, storeId, date, shiftId, attendance)
          return { key: shiftId, label: slot?.label || shiftId, status: 'ready', shift: slot?.shift || { id: shiftId } }
        })
      : slots

  return (
    <div className="page employee-assigned-tasks-page">
      <PageHeader title="CÔNG VIỆC ĐƯỢC GIAO" subtitle="Cập nhật kết quả trong ca và gửi tỷ lệ hoàn thành cho quản lý." icon={ClipboardCheck} />
      {!attendance ? (
        <Card title="Công việc trong lượt điểm danh">
          <div className="task-shift-gate" role="status">
            <InfoNote tone="orange">Bạn cần điểm danh trước khi chọn ca và xem công việc được giao.</InfoNote>
            <Button icon={LogIn} onClick={() => navigate('/employee/attendance')}>Đi đến điểm danh</Button>
          </div>
        </Card>
      ) : (
        <Card title="Tiến độ công việc" action={selectedTaskShiftId ? <Badge tone={allCompleted ? 'green' : 'orange'}>{completedTasks}/{displayedTasks.length} · {completionRate}%</Badge> : null}>
          {selectedTaskShiftId && <Progress value={completionRate} color={allCompleted ? '#07883f' : '#f28b16'} />}
          <InfoNote>Công việc nhận thưởng được tick và lưu riêng tại “Công việc tính thưởng”.</InfoNote>
          {lock.status === TASK_SHIFT_LOCK_STATUS.NONE && <InfoNote>Chọn ca công việc cho lượt điểm danh này. Sau khi chọn, ca được khóa và không thể đổi trong lượt điểm danh hiện tại.</InfoNote>}
          {lock.status === TASK_SHIFT_LOCK_STATUS.LEGACY_MULTI && <InfoNote tone="orange">Lượt điểm danh này đã lưu công việc của nhiều ca trước khi áp dụng quy tắc một ca. Bạn chỉ có thể hoàn tất các ca đã lưu; không thể chọn thêm ca mới.</InfoNote>}
          <div className="shift-checklist-tabs task-shift-buttons" role="group" aria-label="Chọn ca công việc" aria-busy={Boolean(pendingSlot)}>
            {visibleSlots.map((slot) => {
              const selected = lock.status === TASK_SHIFT_LOCK_STATUS.SELECTED
                || (lock.status === TASK_SHIFT_LOCK_STATUS.LEGACY_MULTI && taskShiftLockAllows({ shiftIds: [selectedTaskShiftId] }, slot.shift?.id))
              const multiple = slot.status === 'multiple' && !slot.shift
              const unavailable = slot.status !== 'ready' && !multiple && !slot.shift
              const disabled = lock.status === TASK_SHIFT_LOCK_STATUS.SELECTED || unavailable || Boolean(pendingSlot) || saving
              return (
                <button
                  key={slot.key}
                  type="button"
                  className={`${selected ? 'is-selected' : ''}${unavailable ? ' is-unavailable' : ''}`}
                  aria-pressed={selected}
                  aria-expanded={multiple ? expanded.scopeKey === scopeKey && expanded.key === slot.key : undefined}
                  aria-controls={multiple ? `task-shift-options-${slot.key}` : undefined}
                  disabled={disabled}
                  onClick={() => (multiple
                    ? setExpanded({ scopeKey, key: expanded.scopeKey === scopeKey && expanded.key === slot.key ? '' : slot.key })
                    : lock.status === TASK_SHIFT_LOCK_STATUS.LEGACY_MULTI
                    ? setLegacyView({ scopeKey, id: slot.shift.id })
                    : chooseSlot(slot))}
                >
                  <strong>{slot.label}</strong>
                  <small>{unavailable ? UNAVAILABLE_SLOT_TEXT[slot.status] : multiple ? `${slot.choices.length} ca · Chọn giờ làm` : taskShiftTime(slot.shift) || 'Theo cấu hình cửa hàng'}</small>
                  {selected && lock.status === TASK_SHIFT_LOCK_STATUS.SELECTED && <span><Lock size={12} aria-hidden="true" /> Đã chọn · đã khóa</span>}
                  {pendingSlot === slot.key && <span>Đang ghi nhận…</span>}
                </button>
              )
            })}
          </div>
          {lock.status === TASK_SHIFT_LOCK_STATUS.NONE && slots.filter((slot) => slot.status === 'multiple'
            && expanded.scopeKey === scopeKey && expanded.key === slot.key).map((slot) => (
            <div key={slot.key} id={`task-shift-options-${slot.key}`} className="task-shift-options" role="group" aria-label={`Chọn khung giờ ${slot.label.toLowerCase()}`}>
              <p>Cửa hàng có nhiều {slot.label.toLowerCase()}. Chọn đúng khung giờ công việc; sau khi xác nhận, ca sẽ được khóa cho lượt điểm danh này.</p>
              <div className="shift-checklist-tabs task-shift-buttons">
                {slot.choices.map((shift) => <button key={shift.id} type="button" disabled={Boolean(pendingSlot) || saving}
                  onClick={() => chooseSlot({ ...slot, shift })}>
                  <strong>{shift.name || slot.label}</strong>
                  <small>{taskShiftTime(shift) || 'Theo cấu hình cửa hàng'}</small>
                  {pendingSlot === slot.key && <span>Đang ghi nhận…</span>}
                </button>)}
              </div>
            </div>
          ))}
          {lock.status === TASK_SHIFT_LOCK_STATUS.NONE && slots.some((slot) => slot.status === 'ambiguous') && <InfoNote tone="orange">Có ca đang bị cấu hình trùng cho cùng buổi; cần quản lý xử lý trước khi chọn ca đó.</InfoNote>}
          {lock.status === TASK_SHIFT_LOCK_STATUS.NONE && slots.length > 0 && slots.every((slot) => slot.status === 'missing') && <InfoNote tone="orange">Chưa có cấu hình Ca sáng/Ca chiều/Ca tối hợp lệ cho cửa hàng hôm nay.</InfoNote>}
          {scopedNotice?.text && <InfoNote tone={scopedNotice.tone}>{scopedNotice.text}</InfoNote>}
          {lock.status === TASK_SHIFT_LOCK_STATUS.SELECTED && <InfoNote>Ca công việc <strong>{lockedLabel}</strong> đã được khóa cho lượt điểm danh này.</InfoNote>}
          {context.error && <InfoNote tone="orange">{context.error}</InfoNote>}
          {selectedTaskShiftId && <>
            <div className="task-checklist" id="employee-shift-checklist">
              {displayedTasks.map((task) => {
                const checked = statusFor(task)
                const stored = storedStatusFor(task)
                return <label key={task.id} className={stored ? 'done is-locked' : checked ? 'done' : ''}>
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={!selectedShiftIsOpen || saving || stored}
                    onChange={(event) => updateDraft({ statuses: { ...draft.statuses, [task.id]: event.target.checked } })}
                  />
                  <span className="task-checklist__title">{task.title || task.name || 'Công việc'}</span>
                  <Badge tone={checked ? 'green' : 'orange'}>{stored ? 'Đã lưu' : checked ? 'Chờ lưu' : 'Chưa hoàn thành'}</Badge>
                </label>
              })}
              {!context.error && !displayedTasks.length && <InfoNote>Không có công việc bắt buộc cho ca này trong ngày làm việc được phép truy cập.</InfoNote>}
            </div>
            {selectedShiftIsOpen && noteRequired && <Field label="Lý do công việc bắt buộc chưa hoàn thành" required hint="Không cần nhập cho công việc nhận thưởng tùy chọn." error={!incompleteReason.trim() ? 'Bắt buộc nhập lý do nếu còn công việc bắt buộc chưa hoàn thành.' : ''}>
              <textarea value={incompleteReason} maxLength="1000" disabled={saving} onChange={(event) => updateDraft({ reason: event.target.value })} placeholder="Nêu rõ lý do công việc bắt buộc chưa hoàn thành" />
            </Field>}
            <Button icon={Save} loading={saving} disabled={!ready || saving} onClick={submit}>LƯU KẾT QUẢ</Button>
          </>}
        </Card>
      )}
      <Card title="Lịch sử kết quả đã gửi">
        <TableWrap>
          <thead><tr><th>Thời gian</th><th>Ca / Lượt giao</th><th>Hoàn thành</th><th>Tỷ lệ</th><th>Ghi chú</th></tr></thead>
          <tbody>
            {history.map((event, index) => <tr key={`${event.assignmentId || 'assignment'}-${event.at || index}`}><td>{shortDateTime24(event.at)}</td><td>{event.shiftName || event.shiftId || '—'} · {event.assignmentId || '—'}</td><td>{event.completedTasks || 0}/{event.totalTasks || 0}</td><td><Badge tone={Number(event.completionRate) === 100 ? 'green' : 'orange'}>{Number(event.completionRate) || 0}%</Badge></td><td>{event.incompleteReason || 'Đã hoàn thành tất cả'}</td></tr>)}
            {!history.length && <tr><td colSpan="5">Chưa có lần gửi kết quả công việc.</td></tr>}
          </tbody>
        </TableWrap>
      </Card>
    </div>
  )
}

export default EmployeeShiftExpensePage
