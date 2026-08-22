import { useMemo, useRef, useState } from 'react'
import { ClipboardCheck, Clock3, ReceiptText, Save, Store } from 'lucide-react'
import { Badge, Button, Card, Field, InfoNote, Input, MoneyInput, PageHeader, Progress, TableWrap } from '../../components/UI'
import { useApp } from '../../state/AppContext'
import { money, shortDateTime24, today } from '../../utils'
import { taskAssignedToEmployee, taskCompletedByEmployee } from './taskScope'

const employeeKey = (record = {}) => String(record.id || record.code || record.employeeId || '')
const recordDate = (record = {}) => String(record.date || record.workDate || record.checkInAt || record.createdAt || '').slice(0, 10)
const shiftIdOf = (record = {}) => String(record.shiftId || record.shift || '')

const currentEmployeeOf = (app) => {
  if (app.currentEmployee) return app.currentEmployee
  const keys = [app.session?.employeeId, app.session?.code, app.session?.id].filter(Boolean).map(String)
  return (app.employees || []).find((employee) => keys.includes(employeeKey(employee))) || app.session || {}
}

const ownOpenAttendance = (attendance, employeeId) => (Array.isArray(attendance) ? attendance : []).find((record) => (
  !record.deletedAt
  && String(record.employeeId || '') === employeeId
  && !record.checkOutAt
  && !record.checkOut
)) || null

const taskMatchesAttendance = (task, attendance, employeeId) => (
  !task.deletedAt
  && String(task.storeId || '') === String(attendance.storeId || '')
  && recordDate(task) === recordDate(attendance)
  && taskAssignedToEmployee(task, employeeId)
  && (!shiftIdOf(task) || shiftIdOf(task) === shiftIdOf(attendance))
)

export function EmployeeShiftExpensePage() {
  const app = useApp()
  const employee = currentEmployeeOf(app)
  const employeeId = employeeKey(employee)
  const attendance = useMemo(() => ownOpenAttendance(app.attendance, employeeId), [app.attendance, employeeId])
  const [form, setForm] = useState({ name: '', amount: '', note: '' })
  const [saving, setSaving] = useState(false)
  const requestRef = useRef(null)
  const history = useMemo(() => (app.expenseEntries || [])
    .filter((entry) => (
      entry.recognized !== false
      && String(entry.sourceType || '') === 'shift-expense-item'
      && String(entry.employeeId || '') === employeeId
    ))
    .sort((left, right) => String(right.occurredAt || right.createdAt || '').localeCompare(String(left.occurredAt || left.createdAt || ''))), [app.expenseEntries, employeeId])
  const activeStore = (app.stores || []).find((store) => String(store.id || '') === String(attendance?.storeId || app.session?.storeId || ''))
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
          <Field label="Số tiền" required hint={amount > 0 ? money(amount) : 'Nhập theo đơn vị nghìn đồng'}>
            <MoneyInput value={form.amount} onChange={update('amount')} placeholder="Nhập số nghìn" />
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
              <td><span className="table-stack"><strong><Store size={14} /> {entry.storeName || (app.stores || []).find((store) => String(store.id) === String(entry.storeId))?.name || entry.storeId}</strong><small><Clock3 size={13} /> {entry.shiftName || entry.shiftId || '—'}</small></span></td>
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
  const employee = currentEmployeeOf(app)
  const employeeId = employeeKey(employee)
  const attendance = useMemo(() => ownOpenAttendance(app.attendance, employeeId), [app.attendance, employeeId])
  const displayedTasks = useMemo(() => {
    const tasks = Array.isArray(app.tasks) ? app.tasks : []
    if (attendance) return tasks.filter((task) => taskMatchesAttendance(task, attendance, employeeId))
    return tasks.filter((task) => !task.deletedAt && recordDate(task) === today() && taskAssignedToEmployee(task, employeeId))
  }, [app.tasks, attendance, employeeId])
  const [statuses, setStatuses] = useState({})
  const [incompleteReason, setIncompleteReason] = useState('')
  const [saving, setSaving] = useState(false)
  const requestRef = useRef(null)

  const statusFor = (task) => Object.hasOwn(statuses, String(task.id))
    ? statuses[String(task.id)]
    : taskCompletedByEmployee(task, employeeId)
  const completedTasks = displayedTasks.filter(statusFor).length
  const completionRate = displayedTasks.length ? Math.round((completedTasks / displayedTasks.length) * 100) : 0
  const allCompleted = displayedTasks.length > 0 && completedTasks === displayedTasks.length
  const noteRequired = displayedTasks.length > 0 && !allCompleted
  const ready = Boolean(attendance && displayedTasks.length && (!noteRequired || incompleteReason.trim()))
  const history = useMemo(() => (app.taskAssignmentHistory || []).flatMap((assignment) => (
    (assignment.progressHistory || []).filter((event) => String(event.employeeId || '') === employeeId).map((event) => ({
      ...event,
      assignmentId: event.assignmentId || assignment.assignmentId || assignment.id,
    }))
  )).sort((left, right) => String(right.at || '').localeCompare(String(left.at || ''))), [app.taskAssignmentHistory, employeeId])

  const submit = async () => {
    if (!ready || saving || typeof app.saveStoreTaskProgress !== 'function') return
    const tasks = displayedTasks.map((task) => ({ id: task.id, completed: statusFor(task) }))
    const fingerprint = JSON.stringify({ attendanceId: attendance.id, tasks, incompleteReason: incompleteReason.trim() })
    if (!requestRef.current || requestRef.current.fingerprint !== fingerprint) {
      requestRef.current = { fingerprint, idempotencyKey: `task-progress:${crypto.randomUUID()}` }
    }
    setSaving(true)
    try {
      const result = await app.saveStoreTaskProgress({
        attendanceId: attendance.id,
        tasks,
        incompleteReason: incompleteReason.trim(),
        idempotencyKey: requestRef.current.idempotencyKey,
      })
      if (result?.ok) requestRef.current = null
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
        <div className="task-checklist">
          {displayedTasks.map((task) => {
            const checked = statusFor(task)
            return <label key={task.id} className={checked ? 'done' : ''}>
              <input
                type="checkbox"
                checked={checked}
                disabled={!attendance || saving}
                onChange={(event) => setStatuses((current) => ({ ...current, [String(task.id)]: event.target.checked }))}
              />
              <span><strong>{task.title || task.name || 'Công việc'}</strong>{(task.detail || task.description) && <small>{task.detail || task.description}</small>}</span>
              <Badge tone={checked ? 'green' : 'orange'}>{checked ? 'Đã hoàn thành' : 'Chưa hoàn thành'}</Badge>
            </label>
          })}
          {!displayedTasks.length && <InfoNote>Chưa có công việc được giao trong phạm vi hôm nay.</InfoNote>}
        </div>
        {displayedTasks.length > 0 && <Field label="Ghi chú khi chưa hoàn thành hết" required={noteRequired} error={noteRequired && !incompleteReason.trim() ? 'Bắt buộc nhập ghi chú nếu còn công việc chưa hoàn thành.' : ''}>
          <textarea value={incompleteReason} maxLength="1000" onChange={(event) => setIncompleteReason(event.target.value)} placeholder="Nêu rõ lý do của các công việc chưa hoàn thành" />
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
