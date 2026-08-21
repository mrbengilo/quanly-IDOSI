import { useMemo, useState } from 'react'
import { CalendarClock, ChevronLeft, ChevronRight, History, Save } from 'lucide-react'
import { Avatar, Badge, Button, Card, Field, Input, PageHeader, Select, TableWrap } from '../../components/UI'
import {
  supportScheduleDays,
  supportScheduleEmploymentMode,
  supportScheduleRange,
  supportSchedulesForView,
} from '../../domain/supportWorkSchedule'
import { useApp } from '../../state/AppContext'
import { shortDate } from '../../utils'

const today = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' })

const SCHEDULE_GROUPS = [
  { value: 'business_support', label: 'Nhân viên hỗ trợ KD' },
  { value: 'office', label: 'Khối văn phòng' },
]

const employeeUnit = (employee = {}) => String(employee.unit || employee.unitType || '').toLowerCase()
const scheduleEmployees = (employees = [], targetUnit = 'business_support') => employees.filter((employee) => (
  employeeUnit(employee) === targetUnit
  && !employee.deletedAt
  && !['Đã nghỉ việc', 'inactive'].includes(employee.status)
))

const scheduleGroupLabel = (targetUnit) => SCHEDULE_GROUPS.find(({ value }) => value === targetUnit)?.label || 'Nhân viên hỗ trợ KD'

const shiftAnchor = (date, view, direction) => {
  const next = new Date(`${date}T00:00:00`)
  if (Number.isNaN(next.getTime())) return today()
  if (view === 'month') next.setMonth(next.getMonth() + direction)
  else next.setDate(next.getDate() + direction * (view === 'week' ? 7 : 1))
  return next.toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' })
}

const calendarDayLabel = (date) => new Intl.DateTimeFormat('vi-VN', {
  weekday: 'short', day: '2-digit', month: '2-digit', timeZone: 'UTC',
}).format(new Date(`${date}T00:00:00Z`))

export function BusinessSupportSchedulePage() {
  const app = useApp()
  const [form, setForm] = useState({ targetUnit: 'business_support', date: today(), employeeId: '', shiftName: '', start: '08:00', end: '17:30', note: '' })
  const [saving, setSaving] = useState(false)
  const employees = scheduleEmployees(app.employees || [], form.targetUnit)
  const selectedEmployee = employees.find((employee) => String(employee.id || employee.code) === form.employeeId)
  const shiftMode = supportScheduleEmploymentMode(selectedEmployee) === 'shift'
  const histories = Array.isArray(app.supportWorkScheduleHistory) ? app.supportWorkScheduleHistory : []

  const set = (field) => (event) => setForm((current) => ({ ...current, [field]: event.target.value }))
  const save = async (event) => {
    event.preventDefault()
    if (saving) return
    setSaving(true)
    const result = await app.saveBusinessSupportSchedule?.(form)
    setSaving(false)
    if (result?.ok) setForm((current) => ({ ...current, shiftName: '', note: '' }))
  }

  return <div className="page support-schedule-page">
    <PageHeader title="PHÂN LỊCH LÀM VIỆC" subtitle="Phân lịch theo ngày cho Khối văn phòng và Nhân viên hỗ trợ KD; lịch được chuyển tới đúng tài khoản nhân viên." icon={CalendarClock} />
    <Card title="Tạo lịch làm việc">
      <form className="support-schedule-form" onSubmit={save}>
        <Field label="Chọn ngày" required><Input type="date" value={form.date} onChange={set('date')} /></Field>
        <Field label="Loại nhân viên" required><Select value={form.targetUnit} onChange={(event) => setForm((current) => ({ ...current, targetUnit: event.target.value, employeeId: '', shiftName: '' }))}>{SCHEDULE_GROUPS.map((group) => <option key={group.value} value={group.value}>{group.label}</option>)}</Select></Field>
        <Field label="Chọn nhân viên" required><Select value={form.employeeId} onChange={set('employeeId')}><option value="">Chọn {scheduleGroupLabel(form.targetUnit)}</option>{employees.map((employee) => <option key={employee.id || employee.code} value={employee.id || employee.code}>{employee.name} — {employee.id || employee.code}</option>)}</Select></Field>
        {shiftMode && <Field label="Tên ca" required><Input value={form.shiftName} onChange={set('shiftName')} placeholder="Ví dụ: Ca chiều" /></Field>}
        <Field label="Giờ bắt đầu" required><Input type="time" value={form.start} onChange={set('start')} /></Field>
        <Field label="Giờ kết thúc" required><Input type="time" value={form.end} onChange={set('end')} /></Field>
        <Field label="Ghi chú"><Input value={form.note} onChange={set('note')} placeholder="Thông tin bổ sung" /></Field>
        <Button type="submit" icon={Save} loading={saving}>LƯU</Button>
      </form>
    </Card>
    <Card title="Lịch sử phân lịch" className="support-schedule-history">
      <TableWrap><thead><tr><th>Thời gian tạo</th><th>Nhóm nhân viên</th><th>Nhân viên</th><th>Ngày làm</th><th>Loại</th><th>Ca / Thời gian</th><th>Ghi chú</th><th>Người tạo</th></tr></thead><tbody>
        {histories.map((record) => <tr key={record.id}><td>{new Date(record.recordedAt || record.updatedAt || record.createdAt).toLocaleString('vi-VN', { hour12: false })}</td><td>{scheduleGroupLabel(record.targetUnit || 'business_support')}</td><td><strong>{record.employeeName}</strong><small className="table-sub">{record.employeeId}</small></td><td>{shortDate(record.date)}</td><td><Badge tone={supportScheduleEmploymentMode(record) === 'shift' ? 'orange' : 'blue'}>{record.employmentType}</Badge></td><td><strong>{record.shiftName}</strong><small className="table-sub">{record.start}–{record.end}</small></td><td>{record.note || '—'}</td><td>{record.recordedBy?.name || record.recordedBy?.username || record.updatedBy?.name || '—'}</td></tr>)}
        {!histories.length && <tr><td colSpan="8">Chưa có lịch sử phân lịch làm việc.</td></tr>}
      </tbody></TableWrap>
    </Card>
  </div>
}

export function MyBusinessSupportSchedulePage() {
  const app = useApp()
  const [view, setView] = useState('week')
  const [anchorDate, setAnchorDate] = useState(today())
  const employee = app.currentEmployee || (app.employees || []).find((record) => String(record.id || record.code || '') === String(app.session?.employeeId || '')) || app.session || {}
  const records = useMemo(() => supportSchedulesForView(app.supportWorkSchedules || [], {
    employeeId: app.session?.employeeId,
    anchorDate,
    view,
  }), [app.session?.employeeId, app.supportWorkSchedules, anchorDate, view])
  const days = useMemo(() => supportScheduleDays(anchorDate, view), [anchorDate, view])
  const recordsByDate = useMemo(() => new Map(records.map((record) => [String(record.date), record])), [records])
  const range = useMemo(() => supportScheduleRange(anchorDate, view), [anchorDate, view])
  const rangeLabel = range.start === range.end ? shortDate(range.start) : `${shortDate(range.start)} – ${shortDate(range.end)}`

  return <div className="page support-schedule-page">
    <PageHeader title="LỊCH LÀM VIỆC CỦA TÔI" subtitle="Theo dõi lịch làm việc được Admin hoặc Nhân viên hỗ trợ KD phân theo ngày, tuần và tháng." icon={CalendarClock} actions={<Input type="date" value={anchorDate} onChange={(event) => setAnchorDate(event.target.value)} />} />
    <div className="tabs support-schedule-tabs">{[['day', 'Theo ngày'], ['week', 'Theo tuần'], ['month', 'Theo tháng']].map(([key, label]) => <button key={key} type="button" className={view === key ? 'active' : ''} onClick={() => setView(key)}>{label}</button>)}</div>
    <Card title={`Bảng lịch làm việc · ${rangeLabel}`} action={<div className="support-schedule-navigation"><Button type="button" variant="outline" aria-label="Xem thời gian trước" onClick={() => setAnchorDate((current) => shiftAnchor(current, view, -1))}><ChevronLeft size={18} /></Button><History size={22} /><Button type="button" variant="outline" aria-label="Xem thời gian tiếp theo" onClick={() => setAnchorDate((current) => shiftAnchor(current, view, 1))}><ChevronRight size={18} /></Button></div>}>
      <div className="my-work-schedule-scroll">
        <table className="my-work-schedule-grid">
          <thead><tr><th className="my-work-schedule-grid__employee">Nhân viên</th>{days.map((date) => <th key={date}>{calendarDayLabel(date)}</th>)}</tr></thead>
          <tbody><tr><th scope="row" className="my-work-schedule-grid__employee"><span className="my-work-schedule-employee"><Avatar name={employee.name} src={app.settings?.avatar} size={44} /><span><strong>{employee.name || app.session?.name || 'Nhân viên'}</strong><small>{employee.id || employee.code || app.session?.employeeId || ''}</small><Badge tone={supportScheduleEmploymentMode(employee) === 'shift' ? 'orange' : 'blue'}>{employee.employmentType || employee.workTimeType || 'Full-Time'}</Badge></span></span></th>{days.map((date) => {
            const record = recordsByDate.get(date)
            return <td key={date}>{record ? <span className="my-work-schedule-shift"><strong>{record.shiftName}</strong><small>{record.start}–{record.end}</small>{record.note && <em>{record.note}</em>}</span> : <span className="my-work-schedule-empty">Không có lịch</span>}</td>
          })}</tr></tbody>
        </table>
      </div>
    </Card>
  </div>
}
