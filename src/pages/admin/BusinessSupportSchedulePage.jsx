import { useMemo, useState } from 'react'
import { CalendarClock, History, Save } from 'lucide-react'
import { Badge, Button, Card, Field, Input, PageHeader, Select, TableWrap } from '../../components/UI'
import { supportScheduleEmploymentMode, supportSchedulesForView } from '../../domain/supportWorkSchedule'
import { useApp } from '../../state/AppContext'
import { shortDate } from '../../utils'

const today = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' })

const supportEmployees = (employees = []) => employees.filter((employee) => (
  String(employee.unit || employee.unitType || '').toLowerCase() === 'business_support'
  && !employee.deletedAt
  && !['Đã nghỉ việc', 'inactive'].includes(employee.status)
))

export function BusinessSupportSchedulePage() {
  const app = useApp()
  const employees = supportEmployees(app.employees || [])
  const [form, setForm] = useState({ date: today(), employeeId: '', shiftName: '', start: '08:00', end: '17:30', note: '' })
  const [saving, setSaving] = useState(false)
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
    <PageHeader title="PHÂN LỊCH LÀM VIỆC" subtitle="Phân lịch theo ngày cho Nhân viên hỗ trợ KD; lịch mới nhất được dùng để điểm danh đúng ca." icon={CalendarClock} />
    <Card title="Tạo lịch làm việc">
      <form className="support-schedule-form" onSubmit={save}>
        <Field label="Chọn ngày" required><Input type="date" value={form.date} onChange={set('date')} /></Field>
        <Field label="Chọn nhân viên" required><Select value={form.employeeId} onChange={set('employeeId')}><option value="">Chọn Nhân viên hỗ trợ KD</option>{employees.map((employee) => <option key={employee.id || employee.code} value={employee.id || employee.code}>{employee.name} — {employee.id || employee.code}</option>)}</Select></Field>
        {shiftMode && <Field label="Tên ca" required><Input value={form.shiftName} onChange={set('shiftName')} placeholder="Ví dụ: Ca chiều" /></Field>}
        <Field label="Giờ bắt đầu" required><Input type="time" value={form.start} onChange={set('start')} /></Field>
        <Field label="Giờ kết thúc" required><Input type="time" value={form.end} onChange={set('end')} /></Field>
        <Field label="Ghi chú"><Input value={form.note} onChange={set('note')} placeholder="Thông tin bổ sung" /></Field>
        <Button type="submit" icon={Save} loading={saving}>LƯU</Button>
      </form>
    </Card>
    <Card title="Lịch sử phân lịch" className="support-schedule-history">
      <TableWrap><thead><tr><th>Thời gian tạo</th><th>Nhân viên</th><th>Ngày làm</th><th>Loại</th><th>Ca / Thời gian</th><th>Ghi chú</th><th>Người tạo</th></tr></thead><tbody>
        {histories.map((record) => <tr key={record.id}><td>{new Date(record.recordedAt || record.updatedAt || record.createdAt).toLocaleString('vi-VN', { hour12: false })}</td><td><strong>{record.employeeName}</strong><small className="table-sub">{record.employeeId}</small></td><td>{shortDate(record.date)}</td><td><Badge tone={supportScheduleEmploymentMode(record) === 'shift' ? 'orange' : 'blue'}>{record.employmentType}</Badge></td><td><strong>{record.shiftName}</strong><small className="table-sub">{record.start}–{record.end}</small></td><td>{record.note || '—'}</td><td>{record.recordedBy?.name || record.recordedBy?.username || record.updatedBy?.name || '—'}</td></tr>)}
        {!histories.length && <tr><td colSpan="7">Chưa có lịch sử phân lịch làm việc.</td></tr>}
      </tbody></TableWrap>
    </Card>
  </div>
}

export function MyBusinessSupportSchedulePage() {
  const app = useApp()
  const [view, setView] = useState('week')
  const [anchorDate, setAnchorDate] = useState(today())
  const records = useMemo(() => supportSchedulesForView(app.supportWorkSchedules || [], {
    employeeId: app.session?.employeeId,
    anchorDate,
    view,
  }), [app.session?.employeeId, app.supportWorkSchedules, anchorDate, view])

  return <div className="page support-schedule-page">
    <PageHeader title="LỊCH LÀM VIỆC CỦA TÔI" subtitle="Theo dõi lịch làm việc được Admin hoặc Nhân viên hỗ trợ KD phân theo ngày, tuần và tháng." icon={CalendarClock} actions={<Input type="date" value={anchorDate} onChange={(event) => setAnchorDate(event.target.value)} />} />
    <div className="tabs support-schedule-tabs">{[['day', 'Theo ngày'], ['week', 'Theo tuần'], ['month', 'Theo tháng']].map(([key, label]) => <button key={key} type="button" className={view === key ? 'active' : ''} onClick={() => setView(key)}>{label}</button>)}</div>
    <Card title="Bảng lịch làm việc" action={<History size={22} />}>
      <TableWrap><thead><tr><th>Ngày</th><th>Tên ca</th><th>Giờ bắt đầu</th><th>Giờ kết thúc</th><th>Loại nhân viên</th><th>Ghi chú</th></tr></thead><tbody>
        {records.map((record) => <tr key={record.id}><td><strong>{shortDate(record.date)}</strong></td><td>{record.shiftName}</td><td>{record.start}</td><td>{record.end}</td><td><Badge tone={supportScheduleEmploymentMode(record) === 'shift' ? 'orange' : 'blue'}>{record.employmentType}</Badge></td><td>{record.note || '—'}</td></tr>)}
        {!records.length && <tr><td colSpan="6">Không có lịch làm việc trong khoảng thời gian đã chọn.</td></tr>}
      </tbody></TableWrap>
    </Card>
  </div>
}
