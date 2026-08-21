import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  CalendarDays,
  CheckCircle2,
  ClipboardCheck,
  Clock3,
  ListChecks,
  Plus,
  Send,
  Trash2,
} from 'lucide-react'
import {
  Avatar,
  Badge,
  Button,
  Card,
  Field,
  InfoNote,
  Input,
  MetricCard,
  PageHeader,
  Select,
  TableWrap,
} from '../../components/UI'
import { useApp } from '../../state/AppContext'
import { shortDate, today, uid } from '../../utils'
import { ROLE_KEYS, roleProfileCode, roleProfilesFromApp } from './roleManagementUtils'
import { isFinalSupportWorkStatus, supportWorkEvaluation, supportWorkProgress, supportWorkStatus } from './supportWorkUtils'
import '../task-assignment.css'

const ratingTone = (rating) => {
  if (rating === 'Hoàn thành tốt') return 'green'
  if (rating === 'Hoàn thành') return 'blue'
  if (rating === 'Cần cải thiện') return 'red'
  return 'orange'
}

const formatDateTime24 = (value) => {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value || '—')
  return new Intl.DateTimeFormat('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).format(date)
}

const assignmentActor = (actor) => actor?.name || actor?.displayName || actor?.username || actor || 'Hệ thống'

const historyActionLabel = (action) => ({
  assigned: 'Đã giao việc',
  replaced: 'Đã thay thế danh sách',
  'progress-updated': 'Đã lưu tiến độ',
  submitted: 'Đã gửi kết quả',
  'Giao việc': 'Đã giao việc',
  'Giao lại danh sách': 'Đã thay thế danh sách',
  'Lưu tiến độ': 'Đã lưu tiến độ',
  'Gửi kết quả': 'Đã gửi kết quả',
}[action] || action || 'Cập nhật')

function HistoryTaskSnapshot({ label, tasks = [] }) {
  if (!Array.isArray(tasks) || !tasks.length) return null
  return <div className="assignment-history__snapshot"><b>{label}</b><ol>{tasks.map((task, index) => <li key={task.id || `${task.name || task.title}-${index}`}><strong>{task.name || task.title || `Công việc ${index + 1}`}</strong>{(task.description || task.detail) && <small>{task.description || task.detail}</small>}</li>)}</ol></div>
}

function AssignmentHistoryEntry({ entry }) {
  const details = entry?.details || {}
  const hasProgress = Number.isFinite(Number(details.totalTasks)) || Number.isFinite(Number(details.completedTasks))
  return <li>
    <strong>{formatDateTime24(entry?.at)}</strong>
    <span>{historyActionLabel(entry?.action)} · {assignmentActor(entry?.actor)}</span>
    <HistoryTaskSnapshot label="Nội dung đã giao" tasks={details.tasks} />
    <HistoryTaskSnapshot label="Danh sách trước" tasks={details.beforeTasks} />
    <HistoryTaskSnapshot label="Danh sách sau" tasks={details.afterTasks} />
    {hasProgress && <small className="assignment-history__details">Tiến độ: {Number(details.completedTasks || 0)}/{Number(details.totalTasks || 0)} công việc{Number(details.completionRate) >= 0 ? ` · ${Number(details.completionRate).toFixed(0)}%` : ''}</small>}
    {Array.isArray(details.changedTaskIds) && details.changedTaskIds.length > 0 && <small className="assignment-history__details">Mã công việc thay đổi: {details.changedTaskIds.join(', ')}</small>}
    {details.incompleteReason && <small className="assignment-history__details">Lý do: {details.incompleteReason}</small>}
  </li>
}

const newTaskRow = () => ({ id: uid('CVHT'), name: '', description: '' })

export function AdminSupportWorkPage() {
  const app = useApp()
  const supportProfiles = roleProfilesFromApp(app, ROLE_KEYS.businessSupport)
  const officeProfiles = (Array.isArray(app.employees) ? app.employees : []).filter((profile) => (
    !profile.deletedAt
    && ['office', 'văn phòng', 'van phong'].includes(String(profile.unit || profile.unitType || profile.department || '').trim().toLocaleLowerCase('vi-VN'))
    && !['Đã nghỉ việc', 'inactive'].includes(String(profile.status || ''))
  ))
  const allProfiles = [...supportProfiles, ...officeProfiles]
  const [form, setForm] = useState({ date: today(), targetUnit: 'business_support', employeeId: '', tasks: [newTaskRow()] })
  const profiles = form.targetUnit === 'office' ? officeProfiles : supportProfiles
  const [busy, setBusy] = useState(false)
  const validTasks = form.tasks
    .map((task) => ({ id: task.id, name: task.name.trim(), description: '' }))
    .filter((task) => task.name)
  const sortedAssignments = useMemo(() => [...(Array.isArray(app.supportWorkAssignments) ? app.supportWorkAssignments : [])].toSorted((left, right) => (
    String(right.assignedAt || right.updatedAt || right.date).localeCompare(String(left.assignedAt || left.updatedAt || left.date))
  )), [app.supportWorkAssignments])
  const reusableTasks = useMemo(() => [...new Map(sortedAssignments
    .flatMap((assignment) => Array.isArray(assignment.tasks) ? assignment.tasks : [])
    .flatMap((task) => {
      const name = String(task.name || task.title || '').trim()
      return name ? [[name.toLocaleLowerCase('vi-VN'), name]] : []
    }))].map(([key, name]) => ({ key, name })), [sortedAssignments])

  const updateTask = (id, key, value) => setForm((current) => ({
    ...current,
    tasks: current.tasks.map((task) => task.id === id ? { ...task, [key]: value } : task),
  }))

  const removeTask = (id) => setForm((current) => ({
    ...current,
    tasks: current.tasks.length > 1 ? current.tasks.filter((task) => task.id !== id) : current.tasks,
  }))

  const toggleReusableTask = (template) => setForm((current) => {
    const selected = current.tasks.some((task) => task.templateKey === template.key)
    if (selected) {
      const tasks = current.tasks.filter((task) => task.templateKey !== template.key)
      return { ...current, tasks: tasks.length ? tasks : [newTaskRow()] }
    }
    const tasks = current.tasks.length === 1 && !current.tasks[0].name.trim()
      ? []
      : current.tasks
    return { ...current, tasks: [...tasks, { ...newTaskRow(), name: template.name, templateKey: template.key }] }
  })

  const send = async () => {
    if (!form.date) return app.notify?.('Vui lòng chọn ngày giao việc.', 'info')
    if (!form.employeeId) return app.notify?.('Vui lòng chọn nhân viên nhận việc.', 'info')
    if (!validTasks.length || validTasks.length !== form.tasks.length) return app.notify?.('Mỗi công việc cần có tên.', 'info')
    if (typeof app.assignSupportWork !== 'function') return app.notify?.('Chức năng giao việc chưa sẵn sàng.', 'info')
    setBusy(true)
    try {
      const result = await app.assignSupportWork({ date: form.date, targetUnit: form.targetUnit, employeeId: form.employeeId, tasks: validTasks })
      if (result?.ok === false) return app.notify?.(result.message || 'Không thể giao việc.', 'info')
      setForm({ date: today(), targetUnit: 'business_support', employeeId: '', tasks: [newTaskRow()] })
    } finally {
      setBusy(false)
    }
  }

  return <div className="page support-work-page">
    <PageHeader title="GIAO VIỆC" subtitle="Giao công việc cho nhân viên hỗ trợ kinh doanh hoặc Khối văn phòng và theo dõi toàn bộ lịch sử." icon={ClipboardCheck} />
    <Card title="Tạo danh sách công việc">
      <div className="support-work-form-head">
        <Field label="Chọn ngày" required><Input type="date" value={form.date} onChange={(event) => setForm((current) => ({ ...current, date: event.target.value }))} /></Field>
        <Field label="Nhóm nhân viên" required><Select aria-label="Nhóm nhân viên" value={form.targetUnit} onChange={(event) => setForm((current) => ({ ...current, targetUnit: event.target.value, employeeId: '' }))}><option value="business_support">Nhân viên hỗ trợ KD</option><option value="office">Khối văn phòng</option></Select></Field>
        <Field label={form.targetUnit === 'office' ? 'Nhân viên Khối văn phòng' : 'Nhân viên hỗ trợ kinh doanh'} required><Select aria-label="Nhân viên nhận việc" value={form.employeeId} onChange={(event) => setForm((current) => ({ ...current, employeeId: event.target.value }))}><option value="">Chọn nhân viên</option>{profiles.map((profile) => <option key={roleProfileCode(profile)} value={roleProfileCode(profile)}>{profile.name} — {roleProfileCode(profile)}</option>)}</Select></Field>
      </div>
      {reusableTasks.length > 0 && <>
        <InfoNote>Tick các công việc đã nhập trước đây để dùng lại; chỉ cần thêm công việc mới khi danh sách chưa có.</InfoNote>
        <div className="employee-picker support-work-templates task-template-picker" role="group" aria-label="Công việc hỗ trợ KD nhập sẵn">
          {reusableTasks.map((template) => {
            const selected = form.tasks.some((task) => task.templateKey === template.key)
            return <label key={template.key} className={selected ? 'selected' : ''}><input type="checkbox" checked={selected} onChange={() => toggleReusableTask(template)} /><span><strong>{template.name}</strong></span></label>
          })}
        </div>
      </>}
      <div className="support-task-editor task-assignment-editor" aria-label="Danh sách công việc">
        <div className="support-task-editor__head"><span>STT</span><span>Tên công việc</span><span /></div>
        {form.tasks.map((task, index) => <div className="support-task-editor__row" key={task.id}>
          <strong>{index + 1}</strong>
          <Input value={task.name} maxLength={200} onChange={(event) => updateTask(task.id, 'name', event.target.value)} placeholder="Tên công việc" aria-label={`Tên công việc ${index + 1}`} />
          <button type="button" className="danger icon-action" onClick={() => removeTask(task.id)} disabled={form.tasks.length === 1} aria-label={`Xóa công việc ${index + 1}`}><Trash2 size={18} /></button>
        </div>)}
      </div>
      <div className="support-work-actions">
        <Button variant="outline" icon={Plus} onClick={() => setForm((current) => ({ ...current, tasks: [...current.tasks, newTaskRow()] }))}>THÊM CÔNG VIỆC</Button>
        <Button icon={Send} loading={busy} disabled={busy} onClick={send}>GỬI</Button>
      </div>
    </Card>

    <Card title="Lịch sử giao việc">
      <TableWrap><thead><tr><th>Ngày giao</th><th>Nhân viên</th><th>Danh sách công việc</th><th>Tiến độ</th><th>Trạng thái</th><th>Lý do chưa hoàn thành</th><th>Lịch sử thời gian</th></tr></thead>
        <tbody>{sortedAssignments.map((assignment) => {
          const progress = supportWorkProgress(assignment)
          const status = supportWorkStatus(assignment.status)
          return <tr key={assignment.id}><td><strong>{shortDate(assignment.date)}</strong><small className="table-note">Gửi: {formatDateTime24(assignment.assignedAt)}</small></td><td><strong>{assignment.employeeName || allProfiles.find((profile) => roleProfileCode(profile) === assignment.employeeId)?.name || assignment.employeeId}</strong><small className="table-note">{assignment.targetUnit === 'office' ? 'Khối văn phòng' : 'Hỗ trợ KD'} • {assignment.employeeId}</small></td><td><ol className="compact-task-list">{assignment.tasks?.map((task) => <li key={task.id} className={task.completed ? 'is-complete' : ''}><strong>{task.name}</strong>{task.description && <small>{task.description}</small>}</li>)}</ol></td><td><strong>{progress.completed}/{progress.total}</strong><small className="table-note">{progress.rate.toFixed(0)}%</small></td><td><Badge tone={status.tone}>{status.label}</Badge><small className="table-note">Cập nhật: {formatDateTime24(assignment.updatedAt)}</small></td><td>{assignment.incompleteReason || '—'}</td><td><ol className="assignment-history">{(assignment.history || []).map((entry, index) => <AssignmentHistoryEntry entry={entry} key={`${entry.at || 'history'}-${index}`} />)}</ol></td></tr>
        })}{!sortedAssignments.length && <tr><td colSpan="7">Chưa có lịch sử giao việc.</td></tr>}</tbody>
      </TableWrap>
    </Card>
  </div>
}

function SupportAssignmentCard({ assignment, highlighted, onUpdate }) {
  const [tasks, setTasks] = useState(() => (assignment.tasks || []).map((task) => ({ ...task, completed: Boolean(task.completed) })))
  const [reason, setReason] = useState(assignment.incompleteReason || '')
  const [busy, setBusy] = useState('')
  const progress = supportWorkProgress({ tasks })
  const status = supportWorkStatus(assignment.status)
  const finalized = isFinalSupportWorkStatus(assignment.status) && Boolean(assignment.submittedAt)

  const save = async (submit) => {
    if (submit && progress.remaining > 0 && !reason.trim()) return onUpdate(null, 'Vui lòng nhập lý do khi chưa hoàn thành hết công việc.')
    setBusy(submit ? 'submit' : 'save')
    try {
      await onUpdate({
        assignmentId: assignment.id,
        tasks: tasks.map((task) => ({ id: task.id, completed: Boolean(task.completed) })),
        submit,
        incompleteReason: progress.remaining > 0 ? reason.trim() : '',
      })
    } finally {
      setBusy('')
    }
  }

  return <Card className={`support-assignment-card ${highlighted ? 'support-assignment-card--highlight' : ''}`} title={`${shortDate(assignment.date)} · ${assignment.tasks?.length || 0} công việc`} action={<Badge tone={status.tone}>{status.label}</Badge>}>
    <div className="support-assignment-meta"><span><CalendarDays size={17} /> Giao lúc {formatDateTime24(assignment.assignedAt)}</span><span><Clock3 size={17} /> Cập nhật {formatDateTime24(assignment.updatedAt)}</span></div>
    <div className="support-task-checklist">
      {tasks.map((task, index) => <label key={task.id} className={task.completed ? 'is-complete' : ''}>
        <input type="checkbox" checked={task.completed} disabled={finalized || Boolean(busy)} onChange={(event) => setTasks((current) => current.map((item) => item.id === task.id ? { ...item, completed: event.target.checked } : item))} />
        <span><strong>{index + 1}. {task.name}</strong></span>
      </label>)}
    </div>
    <div className="support-assignment-progress"><strong>{progress.completed}/{progress.total} công việc hoàn thành</strong><span>{progress.rate.toFixed(0)}%</span><div><i style={{ width: `${progress.rate}%` }} /></div></div>
    {(progress.remaining > 0 || assignment.incompleteReason) && <Field label="Lý do chưa hoàn thành hết" required={!finalized && progress.remaining > 0}><textarea value={reason} disabled={finalized} maxLength={1000} onChange={(event) => setReason(event.target.value)} placeholder="Nhập lý do cụ thể trước khi gửi kết quả" /></Field>}
    {finalized
      ? <InfoNote>Hệ thống đã ghi nhận kết quả lúc <strong>{formatDateTime24(assignment.submittedAt)}</strong>.</InfoNote>
      : <div className="support-work-actions"><Button variant="outline" icon={Clock3} loading={busy === 'save'} disabled={Boolean(busy)} onClick={() => save(false)}>LƯU TIẾN ĐỘ</Button><Button icon={CheckCircle2} loading={busy === 'submit'} disabled={Boolean(busy)} onClick={() => save(true)}>GỬI KẾT QUẢ</Button></div>}
  </Card>
}

export function SupportAssignedWorkPage() {
  const app = useApp()
  const [searchParams] = useSearchParams()
  const requestedId = String(searchParams.get('assignment') || '')
  const employeeId = String(app.session?.employeeId || app.session?.code || '')
  const assignments = (Array.isArray(app.supportWorkAssignments) ? app.supportWorkAssignments : [])
    .filter((assignment) => employeeId && String(assignment.employeeId) === employeeId)
    .toSorted((left, right) => String(right.date || right.assignedAt).localeCompare(String(left.date || left.assignedAt)))
  const totals = assignments.reduce((result, assignment) => {
    const progress = supportWorkProgress(assignment)
    return { total: result.total + progress.total, completed: result.completed + progress.completed }
  }, { total: 0, completed: 0 })

  const update = async (payload, validationMessage = '') => {
    if (validationMessage) return app.notify?.(validationMessage, 'info')
    if (typeof app.updateSupportWork !== 'function') return app.notify?.('Chức năng cập nhật công việc chưa sẵn sàng.', 'info')
    const result = await app.updateSupportWork(payload)
    if (result?.ok === false) app.notify?.(result.message || 'Không thể cập nhật công việc.', 'info')
    return result
  }

  return <div className="page support-work-page">
    <PageHeader title="CÔNG VIỆC ĐƯỢC GIAO" subtitle="Danh sách công việc Admin giao; cập nhật tiến độ và gửi lý do nếu chưa hoàn thành." icon={ListChecks} />
    <div className="metrics-grid metrics-grid--4">
      <MetricCard label="ĐỢT GIAO VIỆC" value={assignments.length} icon={ClipboardCheck} tone="blue" />
      <MetricCard label="TỔNG CÔNG VIỆC" value={totals.total} icon={ListChecks} tone="orange" />
      <MetricCard label="ĐÃ HOÀN THÀNH" value={totals.completed} icon={CheckCircle2} tone="green" />
      <MetricCard label="CÒN LẠI" value={Math.max(0, totals.total - totals.completed)} icon={Clock3} tone="red" />
    </div>
    <div className="support-assignment-list">{assignments.map((assignment) => <SupportAssignmentCard key={`${assignment.id}:${assignment.updatedAt || ''}`} assignment={assignment} highlighted={requestedId === String(assignment.id)} onUpdate={update} />)}</div>
    {!assignments.length && <InfoNote>Hiện chưa có công việc nào được giao.</InfoNote>}
  </div>
}

export function SupportWorkEvaluationTable({ assignments = [], profiles = [] }) {
  return <Card title="Đánh giá mức độ hoàn thành công việc">
    <TableWrap><thead><tr><th>Nhân viên</th><th>Đợt đã giao</th><th>Đợt đã nộp</th><th>Chưa nộp</th><th>Hoàn thành trọn vẹn</th><th>Chưa hoàn thành</th><th>Công việc hoàn thành</th><th>Tỷ lệ</th><th>Đánh giá</th></tr></thead>
      <tbody>{profiles.map((profile) => {
        const evaluation = supportWorkEvaluation(profile, assignments)
        return <tr key={roleProfileCode(profile)}><td><div className="person-cell"><Avatar name={profile.name} color={profile.color} /><span><strong>{profile.name}</strong><small>{roleProfileCode(profile)}</small></span></div></td><td>{evaluation.rows.length}</td><td>{evaluation.submitted}</td><td className="red-text">{evaluation.pending}</td><td className="green-text">{evaluation.completedAssignments}</td><td className="orange-text">{evaluation.incompleteAssignments}</td><td><strong>{evaluation.completed}/{evaluation.total}</strong></td><td><strong>{evaluation.rate.toFixed(2)}%</strong></td><td><Badge tone={ratingTone(evaluation.rating)}>{evaluation.rating}</Badge></td></tr>
      })}{!profiles.length && <tr><td colSpan="9">Chưa có nhân viên hỗ trợ kinh doanh để đánh giá.</td></tr>}</tbody>
    </TableWrap>
  </Card>
}
