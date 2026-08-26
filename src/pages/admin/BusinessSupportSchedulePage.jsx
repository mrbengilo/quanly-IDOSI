import { useMemo, useState } from 'react'
import { CalendarClock, Check, ChevronLeft, ChevronRight, Edit3, History, Plus, Save, Trash2 } from 'lucide-react'
import { Avatar, Badge, Button, Card, Field, Input, PageHeader, Select, TableWrap } from '../../components/UI'
import {
  SUPPORT_SCHEDULE_PRESETS,
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

function SchedulePresetButtons({ onSelect, selectedName = '', selectedStart = '', selectedEnd = '' }) {
  return <div className="support-schedule-presets">
    <span className="support-schedule-presets__label">Chọn nhanh khung giờ</span>
    <div className="support-schedule-presets__options" role="group" aria-label="Chọn nhanh khung giờ làm việc">
      {SUPPORT_SCHEDULE_PRESETS.map((preset) => {
        const selected = preset.name === selectedName
          && preset.start === selectedStart
          && preset.end === selectedEnd
        return <Button
          key={preset.id}
          type="button"
          variant="outline"
          className={`support-schedule-preset${selected ? ' support-schedule-preset--selected' : ''}`}
          aria-label={`Chọn nhanh ${preset.name} ${preset.start}–${preset.end}`}
          aria-pressed={selected}
          onClick={() => onSelect(preset)}
        >{selected && <Check aria-hidden="true" size={14} />}{preset.name}<small>{preset.start}–{preset.end}</small></Button>
      })}
    </div>
  </div>
}

const emptyScheduleForm = () => ({ targetUnit: 'business_support', date: today(), employeeId: '', shiftName: '', start: '08:00', end: '17:30', note: '', scheduleId: '' })

const configuredEmployeeShifts = (employee = {}) => {
  const candidates = employee.workShifts || employee.workingTime?.shifts || []
  return (Array.isArray(candidates) ? candidates : []).filter((shift) => (
    shift?.name && /^\d{2}:\d{2}$/u.test(String(shift.start || '')) && /^\d{2}:\d{2}$/u.test(String(shift.end || ''))
  )).map((shift, index) => ({
    id: String(shift.id || `configured-${index + 1}`),
    name: String(shift.name),
    start: String(shift.start).slice(0, 5),
    end: String(shift.end).slice(0, 5),
  }))
}

const emptyPersonalScheduleForm = (employee = {}, shifts = []) => {
  const shiftMode = supportScheduleEmploymentMode(employee) === 'shift'
  const firstShift = shiftMode ? shifts[0] : null
  return {
    scheduleId: '',
    date: today(),
    shiftId: firstShift?.id || 'custom',
    shiftName: firstShift?.name || '',
    start: firstShift?.start || String(employee.workStart || '08:00').slice(0, 5),
    end: firstShift?.end || String(employee.workEnd || '17:30').slice(0, 5),
    note: '',
  }
}

export function BusinessSupportSchedulePage() {
  const app = useApp()
  const [form, setForm] = useState(emptyScheduleForm)
  const [saving, setSaving] = useState(false)
  const employees = scheduleEmployees(app.employees || [], form.targetUnit)
  const selectedEmployee = employees.find((employee) => String(employee.id || employee.code) === form.employeeId)
  const shiftMode = supportScheduleEmploymentMode(selectedEmployee) === 'shift'
  const histories = Array.isArray(app.supportWorkScheduleHistory) ? app.supportWorkScheduleHistory : []
  const schedules = (Array.isArray(app.supportWorkSchedules) ? app.supportWorkSchedules : [])
    .filter((record) => !record.deletedAt)
    .sort((left, right) => String(right.date || '').localeCompare(String(left.date || '')))
  const canDelete = ['admin', 'business_support', 'manager'].includes(app.session?.role)

  const set = (field) => (event) => setForm((current) => ({ ...current, [field]: event.target.value }))
  const selectPreset = (preset) => setForm((current) => ({
    ...current,
    shiftName: preset.name,
    start: preset.start,
    end: preset.end,
  }))
  const save = async (event) => {
    event.preventDefault()
    if (saving) return
    setSaving(true)
    const result = await app.saveBusinessSupportSchedule?.(form)
    setSaving(false)
    if (result?.ok) setForm(emptyScheduleForm())
  }
  const editSchedule = (record) => setForm({
    scheduleId: record.id,
    targetUnit: record.targetUnit || 'business_support',
    date: record.date || today(),
    employeeId: record.employeeId || '',
    shiftName: record.shiftName || '',
    start: record.start || '08:00',
    end: record.end || '17:30',
    note: record.note || '',
  })
  const deleteSchedule = async (record) => {
    if (!canDelete) return
    const reason = window.prompt(`Nhập lý do xóa lịch ${record.employeeName || record.employeeId} ngày ${shortDate(record.date)}:`)
    if (!reason?.trim()) return
    await app.deleteBusinessSupportSchedule?.(record.id, reason.trim())
  }

  return <div className="page support-schedule-page">
    <PageHeader title="PHÂN LỊCH LÀM VIỆC" subtitle="Phân lịch theo ngày cho Khối văn phòng và Nhân viên hỗ trợ KD; lịch được chuyển tới đúng tài khoản nhân viên." icon={CalendarClock} />
    <Card title={form.scheduleId ? 'Chỉnh sửa lịch làm việc' : 'Tạo lịch làm việc'}>
      <form className="support-schedule-form" onSubmit={save}>
        <Field label="Chọn ngày" required><Input type="date" value={form.date} onChange={set('date')} /></Field>
        <Field label="Loại nhân viên" required><Select value={form.targetUnit} onChange={(event) => setForm((current) => ({ ...current, targetUnit: event.target.value, employeeId: '', shiftName: '' }))}>{SCHEDULE_GROUPS.map((group) => <option key={group.value} value={group.value}>{group.label}</option>)}</Select></Field>
        <Field label="Chọn nhân viên" required><Select value={form.employeeId} onChange={set('employeeId')}><option value="">Chọn {scheduleGroupLabel(form.targetUnit)}</option>{employees.map((employee) => <option key={employee.id || employee.code} value={employee.id || employee.code}>{employee.name} — {employee.id || employee.code}</option>)}</Select></Field>
        {shiftMode && <Field label="Tên ca" required><Input value={form.shiftName} onChange={set('shiftName')} placeholder="Ví dụ: Ca chiều" /></Field>}
        <SchedulePresetButtons onSelect={selectPreset} selectedName={form.shiftName} selectedStart={form.start} selectedEnd={form.end} />
        <Field label="Giờ bắt đầu" required><Input type="time" value={form.start} onChange={set('start')} /></Field>
        <Field label="Giờ kết thúc" required><Input type="time" value={form.end} onChange={set('end')} /></Field>
        <Field label="Ghi chú"><Input value={form.note} onChange={set('note')} placeholder="Thông tin bổ sung" /></Field>
        <div className="card-actions">{form.scheduleId && <Button type="button" variant="outline" onClick={() => setForm(emptyScheduleForm())}>HỦY SỬA</Button>}<Button type="submit" icon={Save} loading={saving}>LƯU</Button></div>
      </form>
    </Card>
    <Card title="Lịch làm việc đã phân">
      <TableWrap><thead><tr><th>Nhóm</th><th>Nhân viên</th><th>Ngày</th><th>Ca / Thời gian</th><th>Ghi chú</th><th>Thao tác</th></tr></thead><tbody>
        {schedules.map((record) => <tr key={record.id}><td>{scheduleGroupLabel(record.targetUnit)}</td><td><strong>{record.employeeName}</strong><small className="table-sub">{record.employeeId}</small></td><td>{shortDate(record.date)}</td><td><strong>{record.shiftName}</strong><small className="table-sub">{record.start}–{record.end}</small></td><td>{record.note || '—'}</td><td><div className="row-actions"><button type="button" onClick={() => editSchedule(record)} aria-label={`Sửa lịch của ${record.employeeName}`}><Edit3 /></button>{canDelete && <button type="button" className="danger" onClick={() => deleteSchedule(record)} aria-label={`Xóa lịch của ${record.employeeName}`}><Trash2 /></button>}</div></td></tr>)}
        {!schedules.length && <tr><td colSpan="6">Chưa có lịch làm việc.</td></tr>}
      </tbody></TableWrap>
    </Card>
    <Card title="Lịch sử phân lịch" className="support-schedule-history">
      <TableWrap><thead><tr><th>Thời gian tạo</th><th>Nhóm nhân viên</th><th>Nhân viên</th><th>Ngày làm</th><th>Loại</th><th>Ca / Thời gian</th><th>Ghi chú</th><th>Người tạo</th><th>Thao tác</th></tr></thead><tbody>
        {histories.map((record, index) => {
          const current = schedules.find((schedule) => String(schedule.id || '') === String(record.scheduleId || ''))
          const latestForSchedule = current && histories.findIndex((item) => String(item.scheduleId || '') === String(record.scheduleId || '')) === index
          return <tr key={record.id}><td>{new Date(record.recordedAt || record.updatedAt || record.createdAt).toLocaleString('vi-VN', { hour12: false })}</td><td>{scheduleGroupLabel(record.targetUnit || 'business_support')}</td><td><strong>{record.employeeName}</strong><small className="table-sub">{record.employeeId}</small></td><td>{shortDate(record.date)}</td><td><Badge tone={supportScheduleEmploymentMode(record) === 'shift' ? 'orange' : 'blue'}>{record.employmentType}</Badge></td><td><strong>{record.shiftName}</strong><small className="table-sub">{record.start}–{record.end}</small></td><td>{record.note || '—'}</td><td>{record.recordedBy?.name || record.recordedBy?.username || record.updatedBy?.name || '—'}</td><td>{latestForSchedule ? <div className="row-actions"><button type="button" onClick={() => editSchedule(current)} aria-label={`Sửa từ lịch sử của ${record.employeeName}`}><Edit3 /></button>{canDelete && <button type="button" className="danger" onClick={() => deleteSchedule(current)} aria-label={`Xóa từ lịch sử của ${record.employeeName}`}><Trash2 /></button>}</div> : '—'}</td></tr>
        })}
        {!histories.length && <tr><td colSpan="9">Chưa có lịch sử phân lịch làm việc.</td></tr>}
      </tbody></TableWrap>
    </Card>
  </div>
}

export function MyBusinessSupportSchedulePage() {
  const app = useApp()
  const [view, setView] = useState('week')
  const [anchorDate, setAnchorDate] = useState(today())
  const employee = app.currentEmployee || (app.employees || []).find((record) => String(record.id || record.code || '') === String(app.session?.employeeId || '')) || app.session || {}
  const employeeId = String(employee.id || employee.code || app.session?.employeeId || '')
  const canManageOwnSchedule = app.session?.role === 'employee' && employeeUnit(employee) === 'office' && Boolean(employeeId)
  const configuredShifts = configuredEmployeeShifts(employee)
  const [editorOpen, setEditorOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState(() => emptyPersonalScheduleForm())
  const shiftMode = supportScheduleEmploymentMode(employee) === 'shift'
  const records = useMemo(() => supportSchedulesForView(app.supportWorkSchedules || [], {
    employeeId,
    anchorDate,
    view,
  }), [employeeId, app.supportWorkSchedules, anchorDate, view])
  const days = useMemo(() => supportScheduleDays(anchorDate, view), [anchorDate, view])
  const recordsByDate = useMemo(() => new Map(records.map((record) => [String(record.date), record])), [records])
  const range = useMemo(() => supportScheduleRange(anchorDate, view), [anchorDate, view])
  const rangeLabel = range.start === range.end ? shortDate(range.start) : `${shortDate(range.start)} – ${shortDate(range.end)}`

  const openCreate = () => {
    setForm(emptyPersonalScheduleForm(employee, configuredShifts))
    setEditorOpen(true)
  }
  const closeEditor = () => {
    setEditorOpen(false)
    setForm(emptyPersonalScheduleForm(employee, configuredShifts))
  }
  const set = (field) => (event) => setForm((current) => ({ ...current, [field]: event.target.value }))
  const selectShift = (event) => {
    const shiftId = event.target.value
    const selected = configuredShifts.find((shift) => shift.id === shiftId)
    setForm((current) => selected
      ? { ...current, shiftId, shiftName: selected.name, start: selected.start, end: selected.end }
      : { ...current, shiftId: 'custom', shiftName: '', start: '08:00', end: '12:00' })
  }
  const selectPreset = (preset) => {
    const configured = configuredShifts.find((shift) => (
      shift.name === preset.name && shift.start === preset.start && shift.end === preset.end
    ))
    setForm((current) => ({
      ...current,
      shiftId: configured?.id || 'custom',
      shiftName: preset.name,
      start: preset.start,
      end: preset.end,
    }))
  }
  const save = async (event) => {
    event.preventDefault()
    if (!canManageOwnSchedule || saving) return
    setSaving(true)
    const result = await app.saveBusinessSupportSchedule?.({
      scheduleId: form.scheduleId,
      employeeId,
      targetUnit: 'office',
      date: form.date,
      shiftName: form.shiftName || (shiftMode ? '' : 'Làm việc Full-Time'),
      start: form.start,
      end: form.end,
      note: form.note,
    })
    setSaving(false)
    if (result?.ok) {
      setAnchorDate(form.date)
      closeEditor()
    }
  }
  const editSchedule = (record) => {
    if (!canManageOwnSchedule || String(record.employeeId || '') !== employeeId) return
    const configured = configuredShifts.find((shift) => (
      shift.name === record.shiftName && shift.start === record.start && shift.end === record.end
    ))
    setForm({
      scheduleId: record.id,
      date: record.date || today(),
      shiftId: configured?.id || 'custom',
      shiftName: record.shiftName || '',
      start: record.start || '08:00',
      end: record.end || '17:30',
      note: record.note || '',
    })
    setEditorOpen(true)
  }
  const deleteSchedule = async (record) => {
    if (!canManageOwnSchedule || String(record.employeeId || '') !== employeeId) return
    const reason = window.prompt(`Nhập lý do xóa lịch ngày ${shortDate(record.date)}:`)
    if (!reason?.trim()) return
    await app.deleteBusinessSupportSchedule?.(record.id, reason.trim())
  }

  return <div className="page support-schedule-page">
    <PageHeader title="LỊCH LÀM VIỆC CỦA TÔI" subtitle={canManageOwnSchedule ? 'Tự tạo và quản lý lịch làm việc của chính bạn theo ngày, tuần và tháng.' : 'Theo dõi lịch làm việc được Admin hoặc Nhân viên hỗ trợ KD phân theo ngày, tuần và tháng.'} icon={CalendarClock} actions={<div className="support-schedule-page-actions"><Input type="date" value={anchorDate} onChange={(event) => setAnchorDate(event.target.value)} />{canManageOwnSchedule && <Button type="button" icon={Plus} onClick={openCreate}>TẠO LỊCH LÀM VIỆC</Button>}</div>} />
    {canManageOwnSchedule && editorOpen && <Card title={form.scheduleId ? 'Sửa lịch làm việc của tôi' : 'Tạo lịch làm việc của tôi'}>
      <form className="personal-schedule-form" onSubmit={save}>
        <Field label="Chọn ngày" required><Input type="date" value={form.date} onChange={set('date')} /></Field>
        {shiftMode && <Field label="Chọn ca" required><Select value={form.shiftId} onChange={selectShift}>{configuredShifts.map((shift) => <option key={shift.id} value={shift.id}>{shift.name} · {shift.start}–{shift.end}</option>)}<option value="custom">Ca tự nhập</option></Select></Field>}
        {shiftMode && form.shiftId === 'custom' && <Field label="Tên ca" required><Input value={form.shiftName} onChange={set('shiftName')} placeholder="Ví dụ: Ca chiều" /></Field>}
        <SchedulePresetButtons onSelect={selectPreset} selectedName={form.shiftName} selectedStart={form.start} selectedEnd={form.end} />
        <Field label="Giờ bắt đầu" required><Input type="time" value={form.start} onChange={set('start')} /></Field>
        <Field label="Giờ kết thúc" required><Input type="time" value={form.end} onChange={set('end')} /></Field>
        <Field label="Ghi chú"><Input value={form.note} onChange={set('note')} placeholder="Thông tin bổ sung" /></Field>
        <div className="card-actions personal-schedule-form__actions"><Button type="button" variant="outline" onClick={closeEditor}>HỦY</Button><Button type="submit" icon={Save} loading={saving}>LƯU</Button></div>
      </form>
    </Card>}
    <div className="tabs support-schedule-tabs">{[['day', 'Theo ngày'], ['week', 'Theo tuần'], ['month', 'Theo tháng']].map(([key, label]) => <button key={key} type="button" className={view === key ? 'active' : ''} onClick={() => setView(key)}>{label}</button>)}</div>
    <Card title={`${canManageOwnSchedule ? 'Bảng lịch làm việc đã tạo' : 'Bảng lịch làm việc'} · ${rangeLabel}`} action={<div className="support-schedule-navigation"><Button type="button" variant="outline" aria-label="Xem thời gian trước" onClick={() => setAnchorDate((current) => shiftAnchor(current, view, -1))}><ChevronLeft size={18} /></Button><History size={22} /><Button type="button" variant="outline" aria-label="Xem thời gian tiếp theo" onClick={() => setAnchorDate((current) => shiftAnchor(current, view, 1))}><ChevronRight size={18} /></Button></div>}>
      <div className="my-work-schedule-scroll">
        <table className="my-work-schedule-grid">
          <thead><tr><th className="my-work-schedule-grid__employee">Nhân viên</th>{days.map((date) => <th key={date}>{calendarDayLabel(date)}</th>)}</tr></thead>
          <tbody><tr><th scope="row" className="my-work-schedule-grid__employee"><span className="my-work-schedule-employee"><Avatar name={employee.name} src={employee.avatar || app.settings?.avatar} employeeId={employee.id || employee.code || app.session?.employeeId} size={44} /><span><strong>{employee.name || app.session?.name || 'Nhân viên'}</strong><small>{employee.id || employee.code || app.session?.employeeId || ''}</small><Badge tone={supportScheduleEmploymentMode(employee) === 'shift' ? 'orange' : 'blue'}>{employee.employmentType || employee.workTimeType || 'Full-Time'}</Badge></span></span></th>{days.map((date) => {
            const record = recordsByDate.get(date)
            return <td key={date}>{record ? <div className="my-work-schedule-shift"><strong>{record.shiftName}</strong><small>{record.start}–{record.end}</small>{record.note && <em>{record.note}</em>}{canManageOwnSchedule && <span className="my-work-schedule-shift__actions"><button type="button" onClick={() => editSchedule(record)} aria-label={`Sửa lịch ngày ${shortDate(record.date)}`}><Edit3 size={16} /></button><button type="button" className="danger" onClick={() => deleteSchedule(record)} aria-label={`Xóa lịch ngày ${shortDate(record.date)}`}><Trash2 size={16} /></button></span>}</div> : <span className="my-work-schedule-empty">Không có lịch</span>}</td>
          })}</tr></tbody>
        </table>
      </div>
    </Card>
  </div>
}
