import { useMemo, useRef, useState } from 'react'
import { ClipboardCheck, Clock3, ReceiptText, Save, Store } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import { Badge, Button, Card, Field, InfoNote, Input, MoneyInput, PageHeader, Progress, TableWrap } from '../../components/UI'
import { WORK_CATALOG_KIND } from '../../domain/workCatalog'
import { resolveStoreChecklistTemplate, STORE_CHECKLIST_TEMPLATES } from '../../domain/storeShiftChecklist'
import { useApp } from '../../state/AppContext'
import {
  money,
  operationalIdentifierRecordMatch,
  shortDateTime24,
  today,
} from '../../utils'
import {
  employeeTaskAssignmentById,
  taskAssignedToEmployee,
  taskCompletedByEmployee,
} from './taskScope'

const employeeKey = (record) => String(record?.id || record?.code || record?.employeeId || '')
const employeeAliases = (record) => [record?.id, record?.code, record?.employeeId, record?.employeeCode]
  .map((value) => String(value || '').trim())
  .filter(Boolean)
const storeAliases = (record) => [record?.id, record?.code]
  .map((value) => String(value || '').trim())
  .filter(Boolean)
const shiftAliases = (record) => [record?.id, record?.code]
  .map((value) => String(value || '').trim())
  .filter(Boolean)
const attendanceAliases = (record) => [record?.id, record?.code, record?.attendanceId]
  .map((value) => String(value || '').trim())
  .filter(Boolean)
const recordDate = (record) => String(record?.date || record?.workDate || record?.checkInAt || record?.createdAt || '').slice(0, 10)
const shiftIdOf = (record) => String(record?.shiftId || record?.shift || '')
const taskKindOf = (task = {}) => String(task.catalogKind || task.catalogSnapshot?.kind || task.kind || '')
const taskIsReward = (task = {}) => task.rewardEligible === true || taskKindOf(task) === WORK_CATALOG_KIND.REWARD_TASK
const taskIsRequired = (task = {}) => task.required !== false
const taskAmount = (task = {}) => Math.max(0, Number(task.amountVnd ?? task.catalogSnapshot?.amountVnd) || 0)
const shiftTemplateOf = (record = {}) => resolveStoreChecklistTemplate({
  id: shiftIdOf(record),
  shiftId: shiftIdOf(record),
  name: record.shiftName || record.name,
  shiftName: record.shiftName,
  start: record.shiftStart || record.start,
  end: record.shiftEnd || record.end,
  checkInTime: record.checkIn || record.checkInTime,
})

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

const taskMatchesAttendance = (task, attendance, employeeId, {
  attendanceRecords = [],
  employees = [],
  stores = [],
  shiftDefinitions = [],
} = {}) => {
  const store = resolveTarget(stores, attendance.storeId, storeAliases, { id: String(attendance.storeId || '') })
  const shift = resolveTarget(shiftDefinitions, shiftIdOf(attendance), shiftAliases, { id: shiftIdOf(attendance) })
  if (!store || (shiftIdOf(attendance) && !shift)) return false
  return !task.deletedAt
    && referenceMatchesTarget(stores, store, task.storeId, storeAliases)
    && recordDate(task) === recordDate(attendance)
    && taskAssignedToEmployee(task, employeeId, employees)
    && (!task.checklistAttendanceId || referenceMatchesTarget(
      attendanceRecords,
      attendance,
      task.checklistAttendanceId,
      attendanceAliases,
    ))
    && (!shiftIdOf(task) || referenceMatchesTarget(shiftDefinitions, shift, shiftIdOf(task), shiftAliases))
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

export function EmployeeAssignedTasksPage() {
  const app = useApp()
  const [searchParams] = useSearchParams()
  const requestedAssignmentId = String(searchParams.get('assignment') || '').trim()
  const employee = currentEmployeeOf(app)
  const employeeId = employeeKey(employee)
  const attendance = useMemo(
    () => ownOpenAttendance(app.attendance, employee, app.employees),
    [app.attendance, app.employees, employee],
  )
  const attendanceTasks = useMemo(() => {
    const tasks = Array.isArray(app.tasks) ? app.tasks : []
    if (attendance) return tasks.filter((task) => taskMatchesAttendance(
      task,
      attendance,
      employeeId,
      {
        attendanceRecords: (Array.isArray(app.attendance) ? app.attendance : []).filter((record) => !record.deletedAt),
        employees: app.employees,
        stores: app.stores,
        shiftDefinitions: app.shiftDefinitions,
      },
    ))
    if (requestedAssignmentId) return employeeTaskAssignmentById({
      assignmentId: requestedAssignmentId,
      taskAssignmentHistory: app.taskAssignmentHistory,
      tasks,
      employee,
      employees: app.employees,
      stores: app.stores,
    })?.tasks || []
    return tasks.filter((task) => (
      !task.deletedAt
      && recordDate(task) === today()
      && taskAssignedToEmployee(task, employeeId, app.employees)
    ))
  }, [app.attendance, app.employees, app.shiftDefinitions, app.stores, app.taskAssignmentHistory, app.tasks, attendance, employee, employeeId, requestedAssignmentId])
  const mandatoryTasks = useMemo(() => attendanceTasks.filter((task) => !taskIsReward(task)), [attendanceTasks])
  const attendanceShiftKey = useMemo(() => shiftTemplateOf(attendance || {})?.key || '', [attendance])
  const availableShiftKeys = useMemo(() => new Set(mandatoryTasks
    .map((task) => shiftTemplateOf(task)?.key || attendanceShiftKey)
    .filter(Boolean)), [attendanceShiftKey, mandatoryTasks])
  const defaultShiftKey = attendanceShiftKey || [...availableShiftKeys][0] || STORE_CHECKLIST_TEMPLATES[0].key
  const scopeKey = String(attendance?.id || requestedAssignmentId || `day:${recordDate(mandatoryTasks[0]) || today()}`)
  const [shiftSelection, setShiftSelection] = useState({ scopeKey: '', key: '' })
  const [statusDraft, setStatusDraft] = useState({ scopeKey: '', values: {} })
  const [acknowledgedDraft, setAcknowledgedDraft] = useState({ scopeKey: '', values: new Set() })
  const [reasonDraft, setReasonDraft] = useState({ scopeKey: '', value: '' })
  const [saving, setSaving] = useState(false)
  const requestRef = useRef(null)
  const selectedShiftKey = shiftSelection.scopeKey === scopeKey && shiftSelection.key
    ? shiftSelection.key
    : defaultShiftKey
  const statuses = statusDraft.scopeKey === scopeKey ? statusDraft.values : {}
  const acknowledgedTaskIds = acknowledgedDraft.scopeKey === scopeKey ? acknowledgedDraft.values : new Set()
  const incompleteReason = reasonDraft.scopeKey === scopeKey ? reasonDraft.value : ''
  const setStatuses = (updater) => setStatusDraft((current) => {
    const values = current.scopeKey === scopeKey ? current.values : {}
    return { scopeKey, values: typeof updater === 'function' ? updater(values) : updater }
  })
  const setAcknowledgedTaskIds = (updater) => setAcknowledgedDraft((current) => {
    const values = current.scopeKey === scopeKey ? current.values : new Set()
    return { scopeKey, values: typeof updater === 'function' ? updater(values) : updater }
  })
  const setIncompleteReason = (value) => setReasonDraft({ scopeKey, value })

  const storedStatusFor = (task) => taskCompletedByEmployee(task, employeeId, app.employees)
    || acknowledgedTaskIds.has(String(task.id))
  const statusFor = (task) => Object.hasOwn(statuses, String(task.id))
    ? statuses[String(task.id)]
    : storedStatusFor(task)
  const displayedTasks = mandatoryTasks.filter((task) => {
    const taskShiftKey = shiftTemplateOf(task)?.key || defaultShiftKey
    return taskShiftKey === selectedShiftKey
  })
  const completedTasks = displayedTasks.filter(statusFor).length
  const completionRate = displayedTasks.length ? Math.round((completedTasks / displayedTasks.length) * 100) : 0
  const allCompleted = displayedTasks.length > 0 && completedTasks === displayedTasks.length
  const requiredTasks = mandatoryTasks.filter(taskIsRequired)
  const incompleteRequiredTasks = requiredTasks.filter((task) => !statusFor(task))
  const noteRequired = incompleteRequiredTasks.length > 0
  const newlyCompletedTasks = mandatoryTasks.filter((task) => !storedStatusFor(task) && statusFor(task))
  const selectedShiftIsOpen = Boolean(attendance && attendanceShiftKey && selectedShiftKey === attendanceShiftKey)
  const ready = Boolean(selectedShiftIsOpen && newlyCompletedTasks.length && (!noteRequired || incompleteReason.trim()))
  const history = useMemo(() => (app.taskAssignmentHistory || []).flatMap((assignment) => (
    (assignment.progressHistory || []).filter((event) => (
      referenceMatchesTarget(app.employees, employee, event.employeeId, employeeAliases)
    )).map((event) => ({
      ...event,
      assignmentId: event.assignmentId || assignment.assignmentId || assignment.id,
    }))
  )).sort((left, right) => String(right.at || '').localeCompare(String(left.at || ''))), [app.employees, app.taskAssignmentHistory, employee])

  const submit = async () => {
    if (!ready || saving || typeof app.saveStoreTaskProgress !== 'function') return
    // The server persists one atomic snapshot for the complete shift checklist.
    // Reward rows stay on their dedicated screen, but their existing state must
    // remain in this payload so saving mandatory work never clears or omits them.
    const tasks = attendanceTasks.map((task) => ({ id: task.id, completed: statusFor(task) }))
    const normalizedReason = noteRequired ? incompleteReason.trim() : ''
    const fingerprint = JSON.stringify({ attendanceId: attendance.id, tasks, incompleteReason: normalizedReason })
    if (!requestRef.current || requestRef.current.fingerprint !== fingerprint) {
      requestRef.current = { fingerprint, idempotencyKey: `task-progress:${crypto.randomUUID()}` }
    }
    setSaving(true)
    try {
      const result = await app.saveStoreTaskProgress({
        attendanceId: attendance.id,
        tasks,
        incompleteReason: normalizedReason,
        idempotencyKey: requestRef.current.idempotencyKey,
      })
      if (result?.ok) {
        // The progress command records the complete checklist in one atomic
        // request. Reward claims are intentionally handled in the separate
        // “Công việc tính thưởng” screen against the attendance snapshot.
        setAcknowledgedTaskIds((current) => new Set([
          ...current,
          ...newlyCompletedTasks.map((task) => String(task.id)),
        ]))
        setStatuses({})
        setIncompleteReason('')
        requestRef.current = null
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="page employee-assigned-tasks-page">
      <PageHeader title="CÔNG VIỆC ĐƯỢC GIAO" subtitle="Cập nhật kết quả trong ca và gửi tỷ lệ hoàn thành cho quản lý." icon={ClipboardCheck} />
      {!attendance && <InfoNote tone="orange">Bạn có thể xem công việc hôm nay, nhưng chỉ được cập nhật sau khi điểm danh vào đúng ca.</InfoNote>}
      <Card title="Tiến độ công việc" action={<Badge tone={allCompleted ? 'green' : 'orange'}>{completedTasks}/{displayedTasks.length} · {completionRate}%</Badge>}>
        <Progress value={completionRate} color={allCompleted ? '#07883f' : '#f28b16'} />
        <InfoNote>Đây là danh sách công việc bắt buộc theo ca. Công việc nhận thưởng được tick và lưu riêng tại “Công việc tính thưởng”.</InfoNote>
        <div className="shift-checklist-tabs" role="tablist" aria-label="Chọn ca làm việc">
          {STORE_CHECKLIST_TEMPLATES.map((template) => {
            const selected = selectedShiftKey === template.key
            const available = availableShiftKeys.has(template.key)
            return <button
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls="employee-shift-checklist"
              className={selected ? 'is-selected' : ''}
              onClick={() => setShiftSelection({ scopeKey, key: template.key })}
              key={template.key}
            >
              <strong>{template.name}</strong>
              <small>{template.start}–{template.end}</small>
              <span>{available ? 'Có công việc' : 'Chưa điểm danh'}</span>
            </button>
          })}
        </div>
        {!selectedShiftIsOpen && attendance && <InfoNote tone="orange">Chỉ ca đang điểm danh mới được tick và lưu. Hãy chọn <strong>{shiftTemplateOf(attendance)?.name || attendance.shiftName || 'ca đang mở'}</strong> để cập nhật.</InfoNote>}
        <div className="task-checklist" id="employee-shift-checklist" role="tabpanel">
          {displayedTasks.map((task) => {
            const checked = statusFor(task)
            const stored = storedStatusFor(task)
            const reward = taskIsReward(task)
            const amount = taskAmount(task)
            return <label key={task.id} className={stored ? 'done is-locked' : checked ? 'done' : ''}>
              <input
                type="checkbox"
                checked={checked}
                disabled={!selectedShiftIsOpen || saving || stored}
                onChange={(event) => setStatuses((current) => ({ ...current, [String(task.id)]: event.target.checked }))}
              />
              <span>
                <strong>{task.title || task.name || 'Công việc'}</strong>
                {(task.detail || task.description) && <small>{task.detail || task.description}</small>}
                <small>{reward ? `Tùy chọn · Thưởng ${money(amount)}` : `Bắt buộc${amount > 0 ? ` · ${money(amount)}` : ''}`}</small>
              </span>
              <Badge tone={checked ? 'green' : 'orange'}>{stored ? 'Đã lưu' : checked ? 'Chờ lưu' : 'Chưa hoàn thành'}</Badge>
            </label>
          })}
          {!displayedTasks.length && <InfoNote>Chưa có công việc bắt buộc cho ca này trong phạm vi hôm nay.</InfoNote>}
        </div>
        {selectedShiftIsOpen && noteRequired && <Field label="Lý do công việc bắt buộc chưa hoàn thành" required hint="Không cần nhập cho công việc nhận thưởng tùy chọn." error={!incompleteReason.trim() ? 'Bắt buộc nhập lý do nếu còn công việc cố định chưa hoàn thành.' : ''}>
          <textarea value={incompleteReason} maxLength="1000" onChange={(event) => setIncompleteReason(event.target.value)} placeholder="Nêu rõ lý do của công việc cố định chưa hoàn thành" />
        </Field>}
        <Button icon={Save} loading={saving} disabled={!ready || saving} onClick={submit}>LƯU KẾT QUẢ</Button>
      </Card>
      <Card title="Lịch sử gửi kết quả">
        <TableWrap>
          <thead><tr><th>Thời gian</th><th>Lượt giao</th><th>Hoàn thành</th><th>Tỷ lệ</th><th>Ghi chú</th></tr></thead>
          <tbody>
            {history.map((event, index) => <tr key={`${event.assignmentId || 'assignment'}-${event.at || index}`}><td>{shortDateTime24(event.at)}</td><td>{event.assignmentId || '—'}</td><td>{event.completedTasks || 0}/{event.totalTasks || 0}</td><td><Badge tone={Number(event.completionRate) === 100 ? 'green' : 'orange'}>{Number(event.completionRate) || 0}%</Badge></td><td>{event.incompleteReason || 'Đã hoàn thành tất cả'}</td></tr>)}
            {!history.length && <tr><td colSpan="5">Chưa có lần gửi kết quả công việc.</td></tr>}
          </tbody>
        </TableWrap>
      </Card>
    </div>
  )
}

export default EmployeeShiftExpensePage
