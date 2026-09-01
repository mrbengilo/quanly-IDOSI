import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  CalendarDays,
  CheckCircle2,
  ClipboardCheck,
  Clock3,
  Gift,
  ListChecks,
  Plus,
  Save,
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
import {
  money,
  operationalIdentifierRecordMatch,
  sameOperationalIdentifier,
  shortDate,
  today,
} from '../../utils'
import { activeWorkCatalogItems, WORK_CATALOG_KIND } from '../../domain/workCatalog'
import { ROLE_KEYS, roleProfileCode, roleProfilesFromApp } from './roleManagementUtils'
import { isFinalSupportWorkStatus, supportWorkEvaluation, supportWorkProgress, supportWorkStatus } from './supportWorkUtils'
import { rewardStatistics, workRewardRows } from '../compensation/compensationStatistics'
import { CompensationStatisticsGrid, RewardHistoryTable } from '../compensation/CompensationStatisticsTables'
import '../task-assignment.css'
import '../compensation/compensation-page.css'

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
const profileIdentifiers = (profile = {}) => [profile.id, profile.code, profile.employeeId]
const matchedRecord = (records, reference, identifiersOf = (record) => [record?.id]) => {
  const match = operationalIdentifierRecordMatch(records, reference, identifiersOf)
  return match.ambiguous ? null : match.record
}
const matchedProfile = (profiles, reference) => matchedRecord(profiles, reference, profileIdentifiers)
const matchedProgress = (records, row) => {
  const candidates = (Array.isArray(records) ? records : []).filter((item) => (
    sameOperationalIdentifier(item.attendanceId || item.checklistAttendanceId, row.attendanceId)
    && sameOperationalIdentifier(
      item.catalogItemId || item.workCatalogItemId || item.taskId,
      row.catalogItemId,
    )
  ))
  const exact = candidates.filter((item) => (
    String(item.attendanceId || item.checklistAttendanceId || '').trim() === String(row.attendanceId || '').trim()
    && String(item.catalogItemId || item.workCatalogItemId || item.taskId || '').trim() === String(row.catalogItemId || '').trim()
  ))
  if (exact.length === 1) return exact[0]
  return exact.length === 0 && candidates.length === 1 ? candidates[0] : null
}
const supportTaskIsRequired = (task = {}) => {
  if (task.required === true) return true
  if (task.required === false) return false
  return String(task.kind || task.catalogKind || task.catalogSnapshot?.kind || '').trim().toUpperCase() !== WORK_CATALOG_KIND.REWARD_TASK
}
let supportDraftSequence = 0
const newSupportDraftTask = () => ({ id: `manual-${Date.now()}-${++supportDraftSequence}`, name: '' })

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
  return <div className="assignment-history__snapshot"><b>{label}</b><ol>{tasks.map((task, index) => <li key={task.id || `${task.name || task.title}-${index}`}><strong>{task.name || task.title || `Công việc ${index + 1}`}</strong>{Number(task.amountVnd || 0) > 0 && <small>{money(task.amountVnd)}</small>}{(task.description || task.detail) && <small>{task.description || task.detail}</small>}{task.employeeNote && <small>Ghi chú nhân viên: {task.employeeNote}</small>}</li>)}</ol></div>
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

function SupportAssignmentHistoryTable({ assignments = [], profiles = [], requestedId = '' }) {
  const requestedAssignment = matchedRecord(assignments, requestedId, (assignment) => [assignment.id])
  return <Card title="Lịch sử giao việc và tiến độ hoàn thành">
    <TableWrap><thead><tr><th>Ngày giao</th><th>Nhân viên</th><th>Danh sách công việc</th><th>Tiến độ</th><th>Trạng thái</th><th>Ghi chú kết quả</th><th>Lịch sử thời gian</th></tr></thead>
      <tbody>{assignments.map((assignment) => {
        const progress = supportWorkProgress(assignment)
        const status = supportWorkStatus(assignment.status)
        return <tr key={assignment.id} className={requestedAssignment === assignment ? 'assignment-row--highlight' : ''}><td><strong>{shortDate(assignment.date)}</strong><small className="table-note">Gửi: {formatDateTime24(assignment.assignedAt)}</small></td><td><strong>{assignment.employeeName || matchedProfile(profiles, assignment.employeeId)?.name || assignment.employeeId}</strong><small className="table-note">{assignment.targetUnit === 'office' ? 'Khối văn phòng' : 'Hỗ trợ KD'} • {assignment.employeeId}</small></td><td><ol className="compact-task-list">{assignment.tasks?.map((task) => <li key={task.id} className={task.completed ? 'is-complete' : ''}><strong>{task.name}</strong>{task.description && <small>{task.description}</small>}{task.employeeNote && <small>Ghi chú nhân viên: {task.employeeNote}</small>}</li>)}</ol></td><td><strong>{progress.completed}/{progress.total}</strong><small className="table-note">{progress.rate.toFixed(0)}%</small></td><td><Badge tone={status.tone}>{status.label}</Badge><small className="table-note">Cập nhật: {formatDateTime24(assignment.updatedAt)}</small></td><td>{assignment.incompleteReason || assignment.tasks?.find((task) => task.employeeNote)?.employeeNote || '—'}</td><td><ol className="assignment-history">{(assignment.history || []).map((entry, index) => <AssignmentHistoryEntry entry={entry} key={`${entry.at || 'history'}-${index}`} />)}</ol></td></tr>
      })}{!assignments.length && <tr><td colSpan="7">Chưa có lịch sử giao việc.</td></tr>}</tbody>
    </TableWrap>
  </Card>
}

export function AdminSupportAssignmentPage() {
  const [searchParams] = useSearchParams()
  const targetUnit = searchParams.get('unit') === 'office' ? 'office' : 'business_support'
  return <AdminSupportAssignmentPageContent key={targetUnit} />
}

function AdminSupportAssignmentPageContent() {
  const app = useApp()
  const [searchParams, setSearchParams] = useSearchParams()
  const requestedId = String(searchParams.get('assignment') || '')
  const requestedTargetUnit = searchParams.get('unit') === 'office' ? 'office' : 'business_support'
  const supportProfiles = roleProfilesFromApp(app, ROLE_KEYS.businessSupport)
  const officeProfiles = (Array.isArray(app.employees) ? app.employees : []).filter((profile) => (
    !profile.deletedAt
    && ['office', 'văn phòng', 'van phong'].includes(String(profile.unit || profile.unitType || profile.department || '').trim().toLocaleLowerCase('vi-VN'))
    && !['Đã nghỉ việc', 'inactive'].includes(String(profile.status || ''))
  ))
  const targetUnit = requestedTargetUnit
  const [date, setDate] = useState(today)
  const [employeeId, setEmployeeId] = useState('')
  const [tasks, setTasks] = useState(() => [newSupportDraftTask()])
  const [busy, setBusy] = useState(false)
  const profiles = targetUnit === 'office' ? officeProfiles : supportProfiles
  const validTasks = tasks
    .map((task) => ({ id: task.id, name: String(task.name || '').trim(), description: '', required: true }))
    .filter((task) => task.name)
  const assignments = [...(Array.isArray(app.supportWorkAssignments) ? app.supportWorkAssignments : [])]
    .filter((assignment) => String(assignment.targetUnit || 'business_support') === targetUnit)
    .toSorted((left, right) => String(right.assignedAt || right.updatedAt || right.date).localeCompare(String(left.assignedAt || left.updatedAt || left.date)))

  const changeTargetUnit = (nextTargetUnit) => {
    if (nextTargetUnit === targetUnit) return
    setEmployeeId('')
    setTasks([newSupportDraftTask()])
    const nextSearchParams = new URLSearchParams(searchParams)
    nextSearchParams.set('unit', nextTargetUnit)
    nextSearchParams.delete('assignment')
    setSearchParams(nextSearchParams, { replace: true })
  }
  const updateTask = (taskId, name) => setTasks((current) => current.map((task) => task.id === taskId ? { ...task, name } : task))
  const removeTask = (taskId) => setTasks((current) => current.length > 1 ? current.filter((task) => task.id !== taskId) : current)
  const addTask = () => setTasks((current) => current.length >= 100 ? current : [...current, newSupportDraftTask()])

  const send = async () => {
    if (!date) return app.notify?.('Vui lòng chọn ngày giao việc.', 'info')
    if (!employeeId) return app.notify?.('Vui lòng chọn nhân viên nhận việc.', 'info')
    if (!validTasks.length) return app.notify?.('Vui lòng nhập ít nhất một công việc.', 'info')
    if (typeof app.assignSupportWork !== 'function') return app.notify?.('Chức năng giao việc chưa sẵn sàng.', 'info')
    setBusy(true)
    try {
      const result = await app.assignSupportWork({ date, targetUnit, employeeId, tasks: validTasks })
      if (result?.ok === false) return app.notify?.(result.message || 'Không thể giao việc.', 'info')
      setEmployeeId('')
      setTasks([newSupportDraftTask()])
    } finally {
      setBusy(false)
    }
  }

  return <div className="page support-work-page support-assignment-admin-page">
    <PageHeader title="GIAO VIỆC" subtitle="Giao danh sách công việc theo ngày cho từng nhân viên HTKD hoặc Khối văn phòng." icon={ClipboardCheck} />
    <div className="store-task-tabs support-work-tabs" role="tablist" aria-label="Nhóm nhân viên nhận việc">
      <button type="button" role="tab" aria-selected={targetUnit === 'business_support'} className={targetUnit === 'business_support' ? 'is-active is-reward' : ''} onClick={() => changeTargetUnit('business_support')}>HTKD</button>
      <button type="button" role="tab" aria-selected={targetUnit === 'office'} className={targetUnit === 'office' ? 'is-active is-reward' : ''} onClick={() => changeTargetUnit('office')}>Khối văn phòng</button>
    </div>
    <Card title={`Giao việc cho ${targetUnit === 'office' ? 'Khối văn phòng' : 'HTKD'}`}>
      <div className="support-work-form-head support-work-form-head--assignment">
        <Field label="Ngày giao việc" required><Input aria-label="Ngày giao việc" type="date" value={date} onChange={(event) => setDate(event.target.value)} /></Field>
        <Field label="Nhân viên" required><Select aria-label="Nhân viên nhận việc" value={employeeId} onChange={(event) => setEmployeeId(event.target.value)}><option value="">Chọn nhân viên</option>{profiles.map((profile) => <option key={roleProfileCode(profile)} value={roleProfileCode(profile)}>{profile.name} — {roleProfileCode(profile)}</option>)}</Select></Field>
      </div>
      <InfoNote>Nhập từng công việc, thêm dòng khi cần rồi bấm “LƯU”. Danh sách sẽ được gửi đúng tài khoản nhân viên đã chọn.</InfoNote>
      <div className="support-task-editor task-assignment-editor" aria-label="Danh sách công việc giao">
        <div className="support-task-editor__head"><span>STT</span><span>Nội dung công việc *</span><span /></div>
        {tasks.map((task, index) => <div className="support-task-editor__row" key={task.id}>
          <strong>{index + 1}</strong>
          <Input aria-label={`Công việc ${index + 1}`} value={task.name} maxLength="200" onChange={(event) => updateTask(task.id, event.target.value)} placeholder="Nhập nội dung công việc" />
          <button type="button" className="icon-action" disabled={tasks.length === 1 || busy} onClick={() => removeTask(task.id)} aria-label={`Xóa công việc ${index + 1}`}><Trash2 size={18} /></button>
        </div>)}
      </div>
      <button type="button" className="add-row" disabled={tasks.length >= 100 || busy} onClick={addTask}><Plus size={18} /> Thêm công việc</button>
      <div className="support-work-actions"><Button icon={Save} loading={busy} disabled={busy || !employeeId || !validTasks.length} onClick={send}>LƯU</Button></div>
    </Card>
    <SupportAssignmentHistoryTable assignments={assignments} profiles={[...supportProfiles, ...officeProfiles]} requestedId={requestedId} />
  </div>
}

export function AdminSupportWorkPage() {
  const app = useApp()
  const supportProfiles = useMemo(() => roleProfilesFromApp({
    employees: app.employees,
    businessSupportEmployees: app.businessSupportEmployees,
  }, ROLE_KEYS.businessSupport), [app.employees, app.businessSupportEmployees])
  const officeProfiles = useMemo(() => (Array.isArray(app.employees) ? app.employees : []).filter((profile) => (
    !profile.deletedAt
    && ['office', 'văn phòng', 'van phong'].includes(String(profile.unit || profile.unitType || profile.department || '').trim().toLocaleLowerCase('vi-VN'))
    && !['Đã nghỉ việc', 'inactive'].includes(String(profile.status || ''))
  )), [app.employees])
  const allProfiles = useMemo(() => [...supportProfiles, ...officeProfiles], [supportProfiles, officeProfiles])
  const [form, setForm] = useState({ date: today(), targetUnit: 'business_support', employeeId: '', selectedCatalogIds: [] })
  const profiles = form.targetUnit === 'office' ? officeProfiles : supportProfiles
  const [busy, setBusy] = useState(false)
  const catalogTasks = useMemo(() => activeWorkCatalogItems(app.workCatalogItems || [], {
    targetGroup: form.targetUnit,
    date: form.date,
    kinds: [WORK_CATALOG_KIND.FIXED_TASK, WORK_CATALOG_KIND.REWARD_TASK],
  }), [app.workCatalogItems, form.targetUnit, form.date])
  const selectedCatalogIdSet = new Set(form.selectedCatalogIds)
  const validTasks = catalogTasks.filter((item) => selectedCatalogIdSet.has(item.id)).map((item) => ({
    name: item.name,
    description: '',
    catalogItemId: item.id,
    catalogCode: item.code,
    catalogVersion: item.version,
    kind: item.kind,
    amountVnd: item.amountVnd,
    required: item.kind === WORK_CATALOG_KIND.FIXED_TASK,
  }))
  const sortedAssignments = useMemo(() => [...(Array.isArray(app.supportWorkAssignments) ? app.supportWorkAssignments : [])].toSorted((left, right) => (
    String(right.assignedAt || right.updatedAt || right.date).localeCompare(String(left.assignedAt || left.updatedAt || left.date))
  )), [app.supportWorkAssignments])
  const supportRewardRows = useMemo(() => workRewardRows({
    attendance: app.attendance,
    workCatalogProgress: app.workCatalogProgress,
    compensationEntries: app.compensationEntries,
    tasks: app.tasks,
    employees: supportProfiles,
    targetUnit: 'business_support',
  }), [app.attendance, app.workCatalogProgress, app.compensationEntries, app.tasks, supportProfiles])
  const supportRewardStatistics = useMemo(() => rewardStatistics(supportRewardRows), [supportRewardRows])
  const toggleCatalogTask = (catalogItemId) => setForm((current) => ({
    ...current,
    selectedCatalogIds: current.selectedCatalogIds.includes(catalogItemId)
      ? current.selectedCatalogIds.filter((id) => id !== catalogItemId)
      : [...current.selectedCatalogIds, catalogItemId],
  }))

  const send = async () => {
    if (!form.date) return app.notify?.('Vui lòng chọn ngày giao việc.', 'info')
    if (!form.employeeId) return app.notify?.('Vui lòng chọn nhân viên nhận việc.', 'info')
    if (!validTasks.length) return app.notify?.('Vui lòng tick ít nhất một công việc trong danh mục đang hoạt động.', 'info')
    if (typeof app.assignSupportWork !== 'function') return app.notify?.('Chức năng giao việc chưa sẵn sàng.', 'info')
    setBusy(true)
    try {
      const result = await app.assignSupportWork({ date: form.date, targetUnit: form.targetUnit, employeeId: form.employeeId, tasks: validTasks })
      if (result?.ok === false) return app.notify?.(result.message || 'Không thể giao việc.', 'info')
      setForm({ date: today(), targetUnit: 'business_support', employeeId: '', selectedCatalogIds: [] })
    } finally {
      setBusy(false)
    }
  }

  return <div className="page support-work-page">
    <PageHeader title="CÔNG VIỆC TÍNH THƯỞNG & VI PHẠM HTKD" subtitle="Quản lý công việc HTKD/Khối văn phòng, lịch sử nhận thưởng và vi phạm HTKD theo ngày, ca." icon={ClipboardCheck} />
    <Card title="Tạo danh sách công việc">
      <div className="support-work-form-head">
        <Field label="Chọn ngày" required><Input type="date" value={form.date} onChange={(event) => setForm((current) => ({ ...current, date: event.target.value }))} /></Field>
        <Field label="Nhóm nhân viên" required><Select aria-label="Nhóm nhân viên" value={form.targetUnit} onChange={(event) => setForm((current) => ({ ...current, targetUnit: event.target.value, employeeId: '', selectedCatalogIds: [] }))}><option value="business_support">Nhân viên hỗ trợ KD</option><option value="office">Khối văn phòng</option></Select></Field>
        <Field label={form.targetUnit === 'office' ? 'Nhân viên Khối văn phòng' : 'Nhân viên hỗ trợ kinh doanh'} required><Select aria-label="Nhân viên nhận việc" value={form.employeeId} onChange={(event) => setForm((current) => ({ ...current, employeeId: event.target.value }))}><option value="">Chọn nhân viên</option>{profiles.map((profile) => <option key={roleProfileCode(profile)} value={roleProfileCode(profile)}>{profile.name} — {roleProfileCode(profile)}</option>)}</Select></Field>
      </div>
      <InfoNote>Tick trực tiếp công việc cần giao. Số tiền thưởng nằm dưới tên; danh sách được quản lý tại “Danh mục công việc & vi phạm”.</InfoNote>
      <div className="employee-picker support-work-templates task-template-picker" role="group" aria-label="Danh mục công việc">
        {catalogTasks.map((item) => {
          const selected = selectedCatalogIdSet.has(item.id)
          return <label key={item.id} className={selected ? 'selected' : ''}><input type="checkbox" checked={selected} onChange={() => toggleCatalogTask(item.id)} /><span><strong>{item.name}</strong><small>{item.kind === WORK_CATALOG_KIND.REWARD_TASK ? `Thưởng ${money(item.amountVnd)}` : item.amountVnd ? money(item.amountVnd) : 'Công việc cố định'}</small></span></label>
        })}
      </div>
      {!catalogTasks.length && <InfoNote tone="orange">Chưa có công việc đang hoạt động cho nhóm và ngày đã chọn.</InfoNote>}
      <div className="support-work-actions">
        <Button icon={Save} loading={busy} disabled={busy || !validTasks.length} onClick={send}>LƯU</Button>
      </div>
    </Card>

    <Card title="Lịch sử giao việc">
      <TableWrap><thead><tr><th>Ngày giao</th><th>Nhân viên</th><th>Danh sách công việc</th><th>Tiến độ</th><th>Trạng thái</th><th>Lý do chưa hoàn thành</th><th>Lịch sử thời gian</th></tr></thead>
        <tbody>{sortedAssignments.map((assignment) => {
          const progress = supportWorkProgress(assignment)
          const status = supportWorkStatus(assignment.status)
          return <tr key={assignment.id}><td><strong>{shortDate(assignment.date)}</strong><small className="table-note">Gửi: {formatDateTime24(assignment.assignedAt)}</small></td><td><strong>{assignment.employeeName || matchedProfile(allProfiles, assignment.employeeId)?.name || assignment.employeeId}</strong><small className="table-note">{assignment.targetUnit === 'office' ? 'Khối văn phòng' : 'Hỗ trợ KD'} • {assignment.employeeId}</small></td><td><ol className="compact-task-list">{assignment.tasks?.map((task) => <li key={task.id} className={task.completed ? 'is-complete' : ''}><strong>{task.name}</strong>{Number(task.amountVnd || 0) > 0 && <small>{task.kind === WORK_CATALOG_KIND.REWARD_TASK ? 'Thưởng ' : ''}{money(task.amountVnd)}</small>}{task.description && <small>{task.description}</small>}</li>)}</ol></td><td><strong>{progress.completed}/{progress.total}</strong><small className="table-note">{progress.rate.toFixed(0)}%</small></td><td><Badge tone={status.tone}>{status.label}</Badge><small className="table-note">Cập nhật: {formatDateTime24(assignment.updatedAt)}</small></td><td>{assignment.incompleteReason || '—'}</td><td><ol className="assignment-history">{(assignment.history || []).map((entry, index) => <AssignmentHistoryEntry entry={entry} key={`${entry.at || 'history'}-${index}`} />)}</ol></td></tr>
        })}{!sortedAssignments.length && <tr><td colSpan="7">Chưa có lịch sử giao việc.</td></tr>}</tbody>
      </TableWrap>
    </Card>
    <Card title="Lịch sử nhận thưởng của HTKD">
      <RewardHistoryTable rows={supportRewardRows} employees={supportProfiles} showEmployee />
    </Card>
    <Card title="Thống kê thưởng của HTKD">
      <CompensationStatisticsGrid statistics={supportRewardStatistics} employees={supportProfiles} showEmployee mode="reward" />
    </Card>
  </div>
}

function SupportAssignmentCard({ assignment, highlighted, onUpdate }) {
  const [tasks, setTasks] = useState(() => (assignment.tasks || []).map((task) => ({
    ...task,
    completed: Boolean(task.completed),
    employeeNote: String(task.employeeNote || ''),
  })))
  const [reason, setReason] = useState(assignment.incompleteReason || '')
  const [busy, setBusy] = useState('')
  const progress = supportWorkProgress({ tasks })
  const requiredRemaining = tasks.filter((task) => supportTaskIsRequired(task) && !task.completed).length
  const status = supportWorkStatus(assignment.status)
  const finalized = isFinalSupportWorkStatus(assignment.status) && Boolean(assignment.submittedAt)

  const save = async (submit) => {
    if (submit && requiredRemaining > 0 && !reason.trim()) return onUpdate(null, 'Vui lòng nhập lý do khi chưa hoàn thành hết công việc bắt buộc.')
    setBusy(submit ? 'submit' : 'save')
    try {
      await onUpdate({
        assignmentId: assignment.id,
        tasks: tasks.map((task) => ({ id: task.id, completed: Boolean(task.completed), note: task.employeeNote.trim() })),
        submit,
        incompleteReason: requiredRemaining > 0 ? reason.trim() : '',
      })
    } finally {
      setBusy('')
    }
  }

  return <Card className={`support-assignment-card ${highlighted ? 'support-assignment-card--highlight' : ''}`} title={`${shortDate(assignment.date)} · ${assignment.tasks?.length || 0} công việc`} action={<Badge tone={status.tone}>{status.label}</Badge>}>
    <div className="support-assignment-meta"><span><CalendarDays size={17} /> Giao lúc {formatDateTime24(assignment.assignedAt)}</span><span><Clock3 size={17} /> Cập nhật {formatDateTime24(assignment.updatedAt)}</span></div>
    <div className="support-task-checklist">
      {tasks.map((task, index) => <div key={task.id} className={`support-task-result ${task.completed ? 'is-complete' : ''}`}>
        <label>
          <input type="checkbox" checked={task.completed} disabled={finalized || Boolean(busy)} onChange={(event) => setTasks((current) => current.map((item) => item.id === task.id ? { ...item, completed: event.target.checked } : item))} />
          <span><strong>{index + 1}. {task.name}</strong>{Number(task.amountVnd || 0) > 0 && <small>{task.kind === WORK_CATALOG_KIND.REWARD_TASK ? 'Thưởng ' : ''}{money(task.amountVnd)}</small>}</span>
        </label>
        <textarea
          aria-label={`Ghi chú công việc ${index + 1}`}
          value={task.employeeNote}
          disabled={finalized || Boolean(busy)}
          maxLength="1000"
          onChange={(event) => setTasks((current) => current.map((item) => item.id === task.id ? { ...item, employeeNote: event.target.value } : item))}
          placeholder="Nhập ghi chú kết quả cho công việc này"
        />
      </div>)}
    </div>
    <div className="support-assignment-progress"><strong>{progress.completed}/{progress.total} công việc hoàn thành</strong><span>{progress.rate.toFixed(0)}%</span><div><i style={{ width: `${progress.rate}%` }} /></div></div>
    {(requiredRemaining > 0 || assignment.incompleteReason) && <Field label="Lý do chưa hoàn thành hết công việc bắt buộc" required={!finalized && requiredRemaining > 0}><textarea value={reason} disabled={finalized} maxLength={1000} onChange={(event) => setReason(event.target.value)} placeholder="Nhập lý do cụ thể trước khi gửi kết quả" /></Field>}
    {finalized
      ? <InfoNote>Hệ thống đã ghi nhận kết quả lúc <strong>{formatDateTime24(assignment.submittedAt)}</strong>.</InfoNote>
      : <div className="support-work-actions"><Button variant="outline" icon={Clock3} loading={busy === 'save'} disabled={Boolean(busy)} onClick={() => save(false)}>LƯU TIẾN ĐỘ</Button><Button icon={CheckCircle2} loading={busy === 'submit'} disabled={Boolean(busy)} onClick={() => save(true)}>GỬI KẾT QUẢ</Button></div>}
  </Card>
}

export function SupportWorkInboxPage() {
  const app = useApp()
  const [searchParams] = useSearchParams()
  const requestedId = String(searchParams.get('assignment') || '')
  const employeeId = String(
    app.currentEmployee?.id
    || app.currentEmployee?.code
    || app.currentEmployee?.employeeId
    || app.session?.employeeId
    || app.session?.code
    || '',
  )
  const employeeRecords = Array.isArray(app.employees) ? app.employees : []
  const currentEmployee = matchedProfile(employeeRecords, employeeId)
  const assignments = (Array.isArray(app.supportWorkAssignments) ? app.supportWorkAssignments : [])
    .filter((assignment) => currentEmployee && matchedProfile(employeeRecords, assignment.employeeId) === currentEmployee)
    .toSorted((left, right) => String(right.date || right.assignedAt).localeCompare(String(left.date || left.assignedAt)))
  const requestedAssignment = matchedRecord(assignments, requestedId, (assignment) => [assignment.id])
  const pendingAssignments = assignments.filter((assignment) => !assignment.submittedAt)
  const completedTasks = assignments.reduce((sum, assignment) => sum + supportWorkProgress(assignment).completed, 0)
  const totalTasks = assignments.reduce((sum, assignment) => sum + supportWorkProgress(assignment).total, 0)

  const update = async (payload, validationMessage = '') => {
    if (validationMessage) return app.notify?.(validationMessage, 'info')
    if (typeof app.updateSupportWork !== 'function') return app.notify?.('Chức năng cập nhật công việc chưa sẵn sàng.', 'info')
    const result = await app.updateSupportWork(payload)
    if (result?.ok === false) app.notify?.(result.message || 'Không thể cập nhật công việc.', 'info')
    return result
  }

  return <div className="page support-work-page support-work-inbox-page">
    <PageHeader title="CÔNG VIỆC ĐƯỢC GIAO" subtitle="Tick công việc đã hoàn thành, nhập ghi chú cho từng việc và gửi kết quả tiến độ cho Admin." icon={ListChecks} />
    <div className="metrics-grid metrics-grid--3">
      <MetricCard label="LƯỢT VIỆC CHƯA GỬI" value={pendingAssignments.length} icon={Clock3} tone="orange" />
      <MetricCard label="CÔNG VIỆC ĐÃ HOÀN THÀNH" value={completedTasks} icon={CheckCircle2} tone="green" />
      <MetricCard label="TỔNG CÔNG VIỆC ĐƯỢC GIAO" value={totalTasks} icon={ListChecks} tone="blue" />
    </div>
    {assignments.length
      ? <div className="support-assignment-list">{assignments.map((assignment) => <SupportAssignmentCard key={`${assignment.id}:${assignment.updatedAt || ''}`} assignment={assignment} highlighted={requestedAssignment === assignment} onUpdate={update} />)}</div>
      : <Card><InfoNote>Admin chưa giao công việc cho tài khoản của bạn.</InfoNote></Card>}
  </div>
}

export function SupportAssignedWorkPage() {
  const app = useApp()
  const [rewardDate, setRewardDate] = useState(today)
  const [rewardBusyKey, setRewardBusyKey] = useState('')
  const [rewardDraft, setRewardDraft] = useState({})
  const [rewardAcknowledged, setRewardAcknowledged] = useState({})
  const employeeId = String(
    app.currentEmployee?.id
    || app.currentEmployee?.code
    || app.currentEmployee?.employeeId
    || app.session?.employeeId
    || app.session?.code
    || '',
  )
  const rewardRows = useMemo(() => workRewardRows({
    attendance: app.attendance,
    workCatalogProgress: app.workCatalogProgress,
    compensationEntries: app.compensationEntries,
    tasks: app.tasks,
    employees: app.employees,
    employeeId,
  }), [app.attendance, app.workCatalogProgress, app.compensationEntries, app.tasks, app.employees, employeeId])
  const rewardKey = (row) => `${row.attendanceId}:${row.catalogItemId}`
  const dayRewardRows = rewardRows.filter((row) => row.workDate === rewardDate)
  const actionableDayRewardRows = dayRewardRows.filter((row) => (
    row.attendanceOpen
    && !row.completed
    && rewardAcknowledged[rewardKey(row)]?.checked !== true
  ))
  const completedDayRows = dayRewardRows.filter((row) => row.completed)
  const paidDayRows = dayRewardRows.filter((row) => row.paid)
  const rewardMonth = rewardDate.slice(0, 7)
  const completedMonthRows = rewardRows.filter((row) => row.paid && row.month === rewardMonth)
  const rewardGroups = [...actionableDayRewardRows.reduce((groups, row) => {
    const current = groups.get(row.attendanceId) || {
      attendanceId: row.attendanceId,
      workDate: row.workDate,
      shiftName: row.shiftName,
      shiftTime: row.shiftTime,
      rows: [],
    }
    current.rows.push(row)
    groups.set(row.attendanceId, current)
    return groups
  }, new Map()).values()]
  const statistics = useMemo(() => rewardStatistics(rewardRows), [rewardRows])

  const awaitingRewardSync = (row) => {
    const acknowledged = rewardAcknowledged[rewardKey(row)]
    return Boolean(acknowledged && Number(row.progressVersion || 0) < Number(acknowledged.version || 0))
  }
  const checkedInDraft = (row) => {
    const key = rewardKey(row)
    if (Object.hasOwn(rewardDraft, key)) return rewardDraft[key]
    if (awaitingRewardSync(row)) return rewardAcknowledged[key].checked
    return row.completed
  }

  const toggleReward = (row, checked) => {
    setRewardDraft((current) => ({ ...current, [rewardKey(row)]: checked }))
  }

  const saveRewardGroup = async (group) => {
    if (typeof app.setWorkReward !== 'function') {
      app.notify?.('Chức năng ghi nhận công việc tính thưởng chưa sẵn sàng.', 'info')
      return
    }
    const changedRows = group.rows.filter((row) => (
      !awaitingRewardSync(row)
      && checkedInDraft(row) !== row.completed
    ))
    if (!changedRows.length) return
    setRewardBusyKey(group.attendanceId)
    const savedKeys = []
    const savedAcknowledgements = {}
    try {
      for (const row of changedRows) {
        const progress = matchedProgress(app.workCatalogProgress, row)
        const expectedEntityVersion = Number(progress?.version)
        const checked = checkedInDraft(row)
        const result = await app.setWorkReward({
          attendanceId: row.attendanceId,
          catalogItemId: row.catalogItemId,
          checked,
          idempotencyKey: `work-reward:${row.attendanceId}:${row.catalogItemId}:${Number.isSafeInteger(expectedEntityVersion) ? expectedEntityVersion : 0}:${checked ? 'on' : 'off'}`,
          ...(Number.isSafeInteger(expectedEntityVersion) && expectedEntityVersion > 0 ? { expectedEntityVersion } : {}),
        })
        if (result?.ok === false) throw new Error(result.message || `Không thể lưu công việc “${row.title}”.`)
        const key = rewardKey(row)
        savedKeys.push(key)
        savedAcknowledgements[key] = {
          checked,
          version: Number(result?.reward?.version || 0) || (Number.isSafeInteger(expectedEntityVersion) ? expectedEntityVersion : 0) + 1,
        }
      }
      if (savedKeys.length) {
        setRewardAcknowledged((current) => ({
          ...current,
          ...savedAcknowledgements,
        }))
      }
      app.notify?.(`Đã lưu ${savedKeys.length} công việc tính thưởng.`, 'success')
    } catch (error) {
      app.notify?.(error?.message || 'Không thể lưu công việc tính thưởng.', 'info')
    } finally {
      if (savedKeys.length) setRewardDraft((current) => Object.fromEntries(Object.entries(current).filter(([key]) => !savedKeys.includes(key))))
      setRewardBusyKey('')
    }
  }

  return <div className="page support-work-page compensation-page">
    <PageHeader title="CÔNG VIỆC TÍNH THƯỞNG" subtitle="Tick công việc đã hoàn thành khi ca còn mở; mức thưởng được lấy từ danh mục đã chụp tại lúc bắt đầu ca." icon={ListChecks} />
    <div className="metrics-grid metrics-grid--4">
      <MetricCard label="CÔNG VIỆC CA ĐANG MỞ" value={actionableDayRewardRows.length} icon={ListChecks} tone="blue" />
      <MetricCard label="ĐÃ TICK TRONG NGÀY" value={completedDayRows.length} icon={CheckCircle2} tone="green" />
      <MetricCard label="THƯỞNG ĐÃ DUYỆT TRONG NGÀY" value={money(paidDayRows.reduce((sum, row) => sum + row.amountVnd, 0))} icon={Gift} tone="green" />
      <MetricCard label="THƯỞNG TRONG THÁNG" value={money(completedMonthRows.reduce((sum, row) => sum + row.amountVnd, 0))} icon={CalendarDays} tone="orange" />
    </div>
    <Card title="Công việc tính thưởng theo ca">
      <div className="reward-work-toolbar">
        <Field label="Ngày làm việc"><Input aria-label="Ngày làm việc tính thưởng" type="date" value={rewardDate} onChange={(event) => { setRewardDate(event.target.value); setRewardDraft({}); setRewardAcknowledged({}) }} /></Field>
        <InfoNote>Danh sách này hiện ngay khi điểm danh và được cố định theo ca. Tick công việc đã hoàn thành rồi bấm “LƯU” để ghi nhận đúng ngày, ca và mức thưởng.</InfoNote>
      </div>
      <div className="reward-shift-list">
        {rewardGroups.map((group) => {
          const changedCount = group.rows.filter((row) => !awaitingRewardSync(row) && checkedInDraft(row) !== row.completed).length
          const pendingCount = group.rows.filter(awaitingRewardSync).length
          return <section className="reward-shift-card" key={group.attendanceId} aria-label={`${group.shiftName} ngày ${group.workDate}`} aria-busy={rewardBusyKey === group.attendanceId}>
          <div className="reward-shift-card__head">
            <span><strong>{group.shiftName || 'Chưa gắn ca'}</strong><small><CalendarDays size={15} aria-hidden="true" /> {shortDate(group.workDate)}{group.shiftTime ? ` · ${group.shiftTime}` : ''}</small></span>
            <Badge tone="green">{group.rows.filter(checkedInDraft).length}/{group.rows.length} đã tick</Badge>
          </div>
          <div className="reward-task-checklist">
            {group.rows.map((row) => {
              const checked = checkedInDraft(row)
              return <label key={row.id} className={checked ? 'is-complete' : ''}>
                <input type="checkbox" aria-label={`${row.title} (+${money(row.amountVnd)}), ${group.shiftName || 'chưa gắn ca'}, ngày ${shortDate(group.workDate)}`} checked={checked} disabled={Boolean(rewardBusyKey) || awaitingRewardSync(row)} onChange={(event) => toggleReward(row, event.target.checked)} />
                <span><strong>{row.title}</strong>{row.description && <small>{row.description}</small>}</span>
                <b className="reward-task-amount">+{money(row.amountVnd)}</b>
                {row.payoutStatus === 'pending' && <Badge tone="orange">Chờ duyệt team</Badge>}
              </label>
            })}
          </div>
          <div className="reward-shift-card__actions">
            <span>{pendingCount ? `Đang đồng bộ ${pendingCount} thay đổi đã lưu` : changedCount ? `${changedCount} thay đổi chưa lưu` : 'Dữ liệu đã đồng bộ'}</span>
            <Button icon={Save} loading={rewardBusyKey === group.attendanceId} disabled={!changedCount || Boolean(rewardBusyKey)} onClick={() => saveRewardGroup(group)}>LƯU</Button>
          </div>
        </section>
        })}
      </div>
      {!rewardGroups.length && <InfoNote tone="orange">Không có ca đang mở kèm công việc tính thưởng trong ngày đã chọn. Ca đã kết thúc chỉ xuất hiện trong lịch sử và thống kê.</InfoNote>}
    </Card>
    <Card title="Lịch sử nhận thưởng theo ngày, theo tháng"><RewardHistoryTable rows={rewardRows} employees={app.employees} /></Card>
    <Card title="Thống kê nhận thưởng"><CompensationStatisticsGrid statistics={statistics} mode="reward" /></Card>
  </div>
}

export function SupportWorkEvaluationTable({ assignments = [], profiles = [] }) {
  return <Card title="Đánh giá mức độ hoàn thành công việc">
    <TableWrap><thead><tr><th>Nhân viên</th><th>Đợt đã giao</th><th>Đợt đã nộp</th><th>Chưa nộp</th><th>Hoàn thành trọn vẹn</th><th>Chưa hoàn thành</th><th>Công việc hoàn thành</th><th>Tỷ lệ</th><th>Đánh giá</th></tr></thead>
      <tbody>{profiles.map((profile) => {
        const evaluation = supportWorkEvaluation(profile, assignments)
        return <tr key={roleProfileCode(profile)}><td><div className="person-cell"><Avatar name={profile.name} src={profile.avatar} employeeId={roleProfileCode(profile)} color={profile.color} /><span><strong>{profile.name}</strong><small>{roleProfileCode(profile)}</small></span></div></td><td>{evaluation.rows.length}</td><td>{evaluation.submitted}</td><td className="red-text">{evaluation.pending}</td><td className="green-text">{evaluation.completedAssignments}</td><td className="orange-text">{evaluation.incompleteAssignments}</td><td><strong>{evaluation.completed}/{evaluation.total}</strong></td><td><strong>{evaluation.rate.toFixed(2)}%</strong></td><td><Badge tone={ratingTone(evaluation.rating)}>{evaluation.rating}</Badge></td></tr>
      })}{!profiles.length && <tr><td colSpan="9">Chưa có nhân viên hỗ trợ kinh doanh để đánh giá.</td></tr>}</tbody>
    </TableWrap>
  </Card>
}
