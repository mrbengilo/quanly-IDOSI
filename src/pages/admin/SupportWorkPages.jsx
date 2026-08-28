import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  CalendarDays,
  CheckCircle2,
  ClipboardCheck,
  Clock3,
  Gift,
  ListChecks,
  Send,
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
import { money, shortDate, today } from '../../utils'
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
  return <div className="assignment-history__snapshot"><b>{label}</b><ol>{tasks.map((task, index) => <li key={task.id || `${task.name || task.title}-${index}`}><strong>{task.name || task.title || `Công việc ${index + 1}`}</strong>{Number(task.amountVnd || 0) > 0 && <small>{money(task.amountVnd)}</small>}{(task.description || task.detail) && <small>{task.description || task.detail}</small>}</li>)}</ol></div>
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

export function AdminSupportWorkPage() {
  const app = useApp()
  const supportProfiles = roleProfilesFromApp(app, ROLE_KEYS.businessSupport)
  const officeProfiles = (Array.isArray(app.employees) ? app.employees : []).filter((profile) => (
    !profile.deletedAt
    && ['office', 'văn phòng', 'van phong'].includes(String(profile.unit || profile.unitType || profile.department || '').trim().toLocaleLowerCase('vi-VN'))
    && !['Đã nghỉ việc', 'inactive'].includes(String(profile.status || ''))
  ))
  const allProfiles = [...supportProfiles, ...officeProfiles]
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
  const supportRewardRows = workRewardRows({
    attendance: app.attendance,
    workCatalogProgress: app.workCatalogProgress,
    tasks: app.tasks,
    employees: supportProfiles,
    targetUnit: 'business_support',
  })
  const supportRewardStatistics = rewardStatistics(supportRewardRows)
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
        <Button icon={Send} loading={busy} disabled={busy || !validTasks.length} onClick={send}>GỬI</Button>
      </div>
    </Card>

    <Card title="Lịch sử giao việc">
      <TableWrap><thead><tr><th>Ngày giao</th><th>Nhân viên</th><th>Danh sách công việc</th><th>Tiến độ</th><th>Trạng thái</th><th>Lý do chưa hoàn thành</th><th>Lịch sử thời gian</th></tr></thead>
        <tbody>{sortedAssignments.map((assignment) => {
          const progress = supportWorkProgress(assignment)
          const status = supportWorkStatus(assignment.status)
          return <tr key={assignment.id}><td><strong>{shortDate(assignment.date)}</strong><small className="table-note">Gửi: {formatDateTime24(assignment.assignedAt)}</small></td><td><strong>{assignment.employeeName || allProfiles.find((profile) => roleProfileCode(profile) === assignment.employeeId)?.name || assignment.employeeId}</strong><small className="table-note">{assignment.targetUnit === 'office' ? 'Khối văn phòng' : 'Hỗ trợ KD'} • {assignment.employeeId}</small></td><td><ol className="compact-task-list">{assignment.tasks?.map((task) => <li key={task.id} className={task.completed ? 'is-complete' : ''}><strong>{task.name}</strong>{Number(task.amountVnd || 0) > 0 && <small>{task.kind === WORK_CATALOG_KIND.REWARD_TASK ? 'Thưởng ' : ''}{money(task.amountVnd)}</small>}{task.description && <small>{task.description}</small>}</li>)}</ol></td><td><strong>{progress.completed}/{progress.total}</strong><small className="table-note">{progress.rate.toFixed(0)}%</small></td><td><Badge tone={status.tone}>{status.label}</Badge><small className="table-note">Cập nhật: {formatDateTime24(assignment.updatedAt)}</small></td><td>{assignment.incompleteReason || '—'}</td><td><ol className="assignment-history">{(assignment.history || []).map((entry, index) => <AssignmentHistoryEntry entry={entry} key={`${entry.at || 'history'}-${index}`} />)}</ol></td></tr>
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
        <span><strong>{index + 1}. {task.name}</strong>{Number(task.amountVnd || 0) > 0 && <small>{task.kind === WORK_CATALOG_KIND.REWARD_TASK ? 'Thưởng ' : ''}{money(task.amountVnd)}</small>}</span>
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
  const [rewardDate, setRewardDate] = useState(today)
  const [rewardBusyKey, setRewardBusyKey] = useState('')
  const requestedId = String(searchParams.get('assignment') || '')
  const employeeId = String(
    app.currentEmployee?.id
    || app.currentEmployee?.code
    || app.currentEmployee?.employeeId
    || app.session?.employeeId
    || app.session?.code
    || '',
  )
  const assignments = (Array.isArray(app.supportWorkAssignments) ? app.supportWorkAssignments : [])
    .filter((assignment) => employeeId && String(assignment.employeeId) === employeeId)
    .toSorted((left, right) => String(right.date || right.assignedAt).localeCompare(String(left.date || left.assignedAt)))
  const rewardRows = useMemo(() => workRewardRows({
    attendance: app.attendance,
    workCatalogProgress: app.workCatalogProgress,
    tasks: app.tasks,
    employees: app.employees,
    employeeId,
  }), [app.attendance, app.workCatalogProgress, app.tasks, app.employees, employeeId])
  const dayRewardRows = rewardRows.filter((row) => row.workDate === rewardDate)
  const actionableDayRewardRows = dayRewardRows.filter((row) => row.attendanceOpen)
  const completedDayRows = dayRewardRows.filter((row) => row.completed)
  const rewardMonth = rewardDate.slice(0, 7)
  const completedMonthRows = rewardRows.filter((row) => row.completed && row.month === rewardMonth)
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

  const toggleReward = async (row, checked) => {
    if (typeof app.setWorkReward !== 'function') {
      app.notify?.('Chức năng ghi nhận công việc tính thưởng chưa sẵn sàng.', 'info')
      return
    }
    const key = `${row.attendanceId}:${row.catalogItemId}`
    const progress = (Array.isArray(app.workCatalogProgress) ? app.workCatalogProgress : []).find((item) => (
      String(item.attendanceId || item.checklistAttendanceId || '') === String(row.attendanceId)
      && String(item.catalogItemId || item.workCatalogItemId || item.taskId || '') === String(row.catalogItemId)
    ))
    const expectedEntityVersion = Number(progress?.version)
    setRewardBusyKey(key)
    try {
      const result = await app.setWorkReward({
        attendanceId: row.attendanceId,
        catalogItemId: row.catalogItemId,
        checked,
        ...(Number.isSafeInteger(expectedEntityVersion) && expectedEntityVersion > 0 ? { expectedEntityVersion } : {}),
      })
      if (result?.ok === false) app.notify?.(result.message || 'Không thể cập nhật công việc tính thưởng.', 'info')
    } catch (error) {
      app.notify?.(error?.message || 'Không thể cập nhật công việc tính thưởng.', 'info')
    } finally {
      setRewardBusyKey('')
    }
  }

  const update = async (payload, validationMessage = '') => {
    if (validationMessage) return app.notify?.(validationMessage, 'info')
    if (typeof app.updateSupportWork !== 'function') return app.notify?.('Chức năng cập nhật công việc chưa sẵn sàng.', 'info')
    const result = await app.updateSupportWork(payload)
    if (result?.ok === false) app.notify?.(result.message || 'Không thể cập nhật công việc.', 'info')
    return result
  }

  return <div className="page support-work-page compensation-page">
    <PageHeader title="CÔNG VIỆC TÍNH THƯỞNG" subtitle="Tick công việc đã hoàn thành khi ca còn mở; mức thưởng được lấy từ danh mục đã chụp tại lúc bắt đầu ca." icon={ListChecks} />
    <div className="metrics-grid metrics-grid--4">
      <MetricCard label="CÔNG VIỆC CA ĐANG MỞ" value={actionableDayRewardRows.length} icon={ListChecks} tone="blue" />
      <MetricCard label="ĐÃ TICK TRONG NGÀY" value={completedDayRows.length} icon={CheckCircle2} tone="green" />
      <MetricCard label="THƯỞNG TRONG NGÀY" value={money(completedDayRows.reduce((sum, row) => sum + row.amountVnd, 0))} icon={Gift} tone="green" />
      <MetricCard label="THƯỞNG TRONG THÁNG" value={money(completedMonthRows.reduce((sum, row) => sum + row.amountVnd, 0))} icon={CalendarDays} tone="orange" />
    </div>
    <Card title="Công việc tính thưởng theo ca">
      <div className="reward-work-toolbar">
        <Field label="Ngày làm việc"><Input aria-label="Ngày làm việc tính thưởng" type="date" value={rewardDate} onChange={(event) => setRewardDate(event.target.value)} /></Field>
        <InfoNote>Danh sách này được cố định theo ca lúc điểm danh. Tick công việc đã hoàn thành để hệ thống ghi nhận đúng ngày, ca và mức thưởng.</InfoNote>
      </div>
      <div className="reward-shift-list">
        {rewardGroups.map((group) => <section className="reward-shift-card" key={group.attendanceId} aria-label={`${group.shiftName} ngày ${group.workDate}`} aria-busy={group.rows.some((row) => rewardBusyKey === `${row.attendanceId}:${row.catalogItemId}`)}>
          <div className="reward-shift-card__head">
            <span><strong>{group.shiftName || 'Chưa gắn ca'}</strong><small><CalendarDays size={15} aria-hidden="true" /> {shortDate(group.workDate)}{group.shiftTime ? ` · ${group.shiftTime}` : ''}</small></span>
            <Badge tone="green">{group.rows.filter((row) => row.completed).length}/{group.rows.length} đã tick</Badge>
          </div>
          <div className="reward-task-checklist">
            {group.rows.map((row) => {
              const busy = rewardBusyKey === `${row.attendanceId}:${row.catalogItemId}`
              return <label key={row.id} className={row.completed ? 'is-complete' : ''}>
                <input type="checkbox" aria-label={`${row.title} (+${money(row.amountVnd)}), ${group.shiftName || 'chưa gắn ca'}, ngày ${shortDate(group.workDate)}`} checked={row.completed} disabled={Boolean(rewardBusyKey)} onChange={(event) => toggleReward(row, event.target.checked)} />
                <span><strong>{row.title}</strong>{row.description && <small>{row.description}</small>}</span>
                <b className="reward-task-amount">+{money(row.amountVnd)}</b>
                {busy && <small className="reward-task-saving" role="status" aria-live="polite">Đang lưu…</small>}
              </label>
            })}
          </div>
        </section>)}
      </div>
      {!rewardGroups.length && <InfoNote tone="orange">Không có ca đang mở kèm công việc tính thưởng trong ngày đã chọn. Ca đã kết thúc chỉ xuất hiện trong lịch sử và thống kê.</InfoNote>}
    </Card>
    <Card title="Lịch sử nhận thưởng theo ngày, theo tháng"><RewardHistoryTable rows={rewardRows} employees={app.employees} /></Card>
    <Card title="Thống kê nhận thưởng"><CompensationStatisticsGrid statistics={statistics} mode="reward" /></Card>
    {assignments.length > 0 && <>
      <h2 className="support-work-section-title">Công việc được giao trước đây</h2>
      <div className="support-assignment-list">{assignments.map((assignment) => <SupportAssignmentCard key={`${assignment.id}:${assignment.updatedAt || ''}`} assignment={assignment} highlighted={requestedId === String(assignment.id)} onUpdate={update} />)}</div>
    </>}
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
