import { useState } from 'react'
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Check,
  Clock3,
  Edit3,
  Plus,
  Save,
  Trash2,
  Users,
} from 'lucide-react'
import {
  Avatar,
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  InfoNote,
  Input,
  MetricCard,
  Modal,
  PageHeader,
  SearchInput,
  Select,
  TableFooter,
  TableWrap,
} from '../../components/UI'
import { useApp } from '../../state/AppContext'
import { removeShiftAssignments, replaceShiftAssignees } from './scheduleAssignments'

const localDate = () => {
  const value = new Date()
  const offset = value.getTimezoneOffset() * 60_000
  return new Date(value.getTime() - offset).toISOString().slice(0, 10)
}

const displayDate = (value) => {
  const [year, month, day] = String(value || '').split('-')
  return year && month && day ? `${day}/${month}/${year.slice(-2)}` : '—'
}

const displayDateTime = (value) => {
  if (!value) return 'Chưa ghi nhận'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return 'Chưa ghi nhận'
  return new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(parsed)
}

const moveDate = (value, days) => {
  const date = new Date(`${value}T12:00:00`)
  date.setDate(date.getDate() + days)
  return date.toISOString().slice(0, 10)
}

const weekDates = (value) => {
  const date = new Date(`${value}T12:00:00`)
  const mondayOffset = (date.getDay() + 6) % 7
  const monday = moveDate(value, -mondayOffset)
  return Array.from({ length: 7 }, (_, index) => moveDate(monday, index))
}

const timeLabel = (start, end) => start && end ? `${start} - ${end}` : 'Chưa thiết lập'

const shiftMinutes = (shift = {}) => {
  const [startHour, startMinute] = String(shift.start || '').split(':').map(Number)
  const [endHour, endMinute] = String(shift.end || '').split(':').map(Number)
  if (![startHour, startMinute, endHour, endMinute].every(Number.isFinite)) return 0
  const start = startHour * 60 + startMinute
  const end = endHour * 60 + endMinute
  const difference = end - start
  return difference > 0 ? difference : difference + 24 * 60
}

const durationLabel = (shift) => {
  const minutes = shiftMinutes(shift)
  if (!minutes) return '—'
  const hours = Math.floor(minutes / 60)
  const remainder = minutes % 60
  return remainder ? `${hours} giờ ${remainder} phút` : `${hours} giờ`
}

const BRIGHT_SHIFT_COLORS = [
  '#ff3d71',
  '#7c3aed',
  '#00a6fb',
  '#00b894',
  '#ff8a00',
  '#e84393',
  '#3a86ff',
  '#8ac926',
  '#ff595e',
  '#00c2d1',
]

const nextShiftColor = (shifts = []) => {
  const used = new Set(shifts.filter((shift) => shift.active !== false).map((shift) => String(shift.color || '').toLowerCase()))
  return BRIGHT_SHIFT_COLORS.find((color) => !used.has(color.toLowerCase()))
    || BRIGHT_SHIFT_COLORS[shifts.length % BRIGHT_SHIFT_COLORS.length]
}

const blankShift = (date, color = BRIGHT_SHIFT_COLORS[0]) => ({
  name: '',
  start: '07:00',
  end: '12:00',
  date,
  color,
})

const employeeRole = (employee = {}) => employee.position || employee.shortRole || employee.role || 'Nhân viên'

export function UnifiedSchedule() {
  const app = useApp()
  const {
    activeStore,
    activeStoreId,
    session,
    notify,
    createShiftDefinition,
    updateShiftDefinition,
    deleteShiftDefinition,
    saveScheduleMultiple,
    replaceScheduleDay,
  } = app
  const shiftDefinitions = Array.isArray(app.shiftDefinitions) ? app.shiftDefinitions : []
  const schedule = Array.isArray(app.schedule) ? app.schedule : []
  const allEmployees = Array.isArray(app.employees) ? app.employees : []
  const supportTransfers = Array.isArray(app.supportTransfers) ? app.supportTransfers : []
  const canManageStore = ['admin', 'business_support', 'manager', 'store_manager'].includes(session?.role)
  const storeId = session?.role === 'store_manager'
    ? session.storeId
    : activeStore?.id || activeStoreId || session?.storeId || ''
  const [date, setDate] = useState(localDate)
  const employeeSupportsStoreOnDate = (employee) => supportTransfers.some((record) => (
    String(record.employeeId || '') === String(employee.id || employee.code || '')
    && String(record.toStoreId || '') === String(storeId)
    && !record.deletedAt
    && !['Đã xóa', 'Đã hủy', 'Hoàn tất'].includes(String(record.status || ''))
    && String(record.fromDate || '') <= date
    && String(record.toDate || '') >= date
  ))
  const employees = allEmployees
    .filter((employee) => (
      String(employee.unit || 'store') === 'store'
      && employee.status !== 'Đã nghỉ việc'
      && (!storeId || String(employee.storeId) === String(storeId) || employeeSupportsStoreOnDate(employee))
    ))
    .sort((left, right) => String(left.name || '').localeCompare(String(right.name || ''), 'vi'))

  const [viewMode, setViewMode] = useState('day')
  const [focusedEmployeeId, setFocusedEmployeeId] = useState('')
  const [selectedShiftIds, setSelectedShiftIds] = useState([])
  const [selectedEmployeeIds, setSelectedEmployeeIds] = useState([])
  const [employeeQuery, setEmployeeQuery] = useState('')
  const [note, setNote] = useState('')
  const [shiftModalOpen, setShiftModalOpen] = useState(false)
  const [editingShift, setEditingShift] = useState(null)
  const [shiftForm, setShiftForm] = useState(() => blankShift(localDate(), nextShiftColor(shiftDefinitions)))
  const [editingAssignment, setEditingAssignment] = useState(null)
  const [assignmentEmployeeIds, setAssignmentEmployeeIds] = useState([])
  const [assignmentNote, setAssignmentNote] = useState('')
  const [savingAssignment, setSavingAssignment] = useState(false)

  const dayShifts = shiftDefinitions
    .filter((shift) => (
      shift.active !== false
      && shift.date === date
      && (!shift.storeId || !storeId || String(shift.storeId) === String(storeId))
    ))
    .sort((left, right) => String(left.start || '').localeCompare(String(right.start || '')))
  const employeeIds = new Set(employees.map((employee) => String(employee.id)))
  const daySchedule = schedule.filter((record) => (
    record.date === date
    && employeeIds.has(String(record.employeeId))
    && (!record.storeId || !storeId || String(record.storeId) === String(storeId))
  ))
  const visibleEmployees = employees.filter((employee) => (
    `${employee.id || ''} ${employee.code || ''} ${employee.name || ''} ${employeeRole(employee)}`
      .toLocaleLowerCase('vi')
      .includes(employeeQuery.trim().toLocaleLowerCase('vi'))
  ))
  const datesOfWeek = weekDates(date)
  const scheduleForEmployeeDate = (employeeId, targetDate) => schedule.find((record) => (
    String(record.employeeId || '') === String(employeeId || '')
    && String(record.date || record.workDate || '') === targetDate
    && (!record.storeId || !storeId || String(record.storeId) === String(storeId))
  ))
  const shiftsForDate = (targetDate) => shiftDefinitions
    .filter((shift) => shift.active !== false && String(shift.date || '') === targetDate && (!shift.storeId || String(shift.storeId) === String(storeId)))
    .sort((left, right) => String(left.start || '').localeCompare(String(right.start || '')))

  const resolveScheduledShift = (record, shiftId) => {
    const snapshot = Array.isArray(record.shiftSnapshots)
      ? record.shiftSnapshots.find((item) => String(item.id) === String(shiftId))
      : null
    if (snapshot) return { ...snapshot, snapshot: true }
    const definition = shiftDefinitions.find((item) => String(item.id) === String(shiftId))
    return definition ? { ...definition, snapshot: false } : { id: shiftId, name: 'Ca không còn hoạt động', snapshot: false }
  }

  const createdScheduleRows = [...new Set(daySchedule.flatMap((record) => (
    record.shiftIds || (record.shiftId ? [record.shiftId] : [])
  )).map(String))].map((shiftId) => {
    const records = daySchedule.filter((record) => (
      record.shiftIds || (record.shiftId ? [record.shiftId] : [])
    ).map(String).includes(shiftId))
    const shift = resolveScheduledShift(records[0] || {}, shiftId)
    const employeeNames = records.map((record) => {
      const employee = employees.find((item) => String(item.id) === String(record.employeeId))
      return employee?.name || record.employeeName || record.employeeId
    })
    const timestamps = records.map((record) => record.updatedAt || record.createdAt).filter(Boolean)
    return {
      shift,
      records,
      employeeNames,
      note: records.find((record) => record.note)?.note || '',
      updatedAt: timestamps.toSorted().at(-1) || '',
    }
  }).toSorted((left, right) => String(right.shift.start || '').localeCompare(String(left.shift.start || '')))

  const changeDate = (event) => {
    const nextDate = event.target.value
    setDate(nextDate)
    setSelectedShiftIds([])
    setShiftForm((current) => editingShift ? current : { ...current, date: nextDate })
  }

  const openCreateShift = () => {
    if (!canManageStore) return
    setEditingShift(null)
    setShiftForm(blankShift(date, nextShiftColor(shiftDefinitions.filter((shift) => !storeId || !shift.storeId || String(shift.storeId) === String(storeId)))))
    setShiftModalOpen(true)
  }

  const openEditShift = (shift) => {
    if (!canManageStore) return
    setEditingShift(shift)
    setShiftForm({
      name: shift.name || '',
      start: shift.start || '07:00',
      end: shift.end || '12:00',
      date: shift.date || date,
      color: shift.color || '#07873d',
    })
    setShiftModalOpen(true)
  }

  const closeShiftModal = () => {
    setShiftModalOpen(false)
    setEditingShift(null)
    setShiftForm(blankShift(date, nextShiftColor(shiftDefinitions)))
  }

  const saveShift = async () => {
    if (!canManageStore) return
    const payload = {
      ...shiftForm,
      name: shiftForm.name.trim(),
      storeId,
    }
    if (!payload.name || !payload.start || !payload.end || !payload.date) {
      notify?.('Vui lòng nhập đủ tên, thời gian và ngày áp dụng.', 'info')
      return
    }
    const result = editingShift
      ? await updateShiftDefinition?.(editingShift.id, payload)
      : await createShiftDefinition?.(payload)
    if (!result?.ok) {
      notify?.(result?.message || 'Chưa thể lưu ca làm việc.', 'info')
      return
    }
    setDate(payload.date)
    setSelectedShiftIds(result.shift?.id ? [result.shift.id] : [])
    closeShiftModal()
  }

  const removeShift = async (shift) => {
    if (!canManageStore) return
    if (!window.confirm(`Ngừng sử dụng ${shift.name} ngày ${displayDate(shift.date)}? Lịch sử đã ghi nhận sẽ được giữ nguyên.`)) return
    const result = await deleteShiftDefinition?.(shift.id)
    if (result === false || result?.ok === false) {
      notify?.(result?.message || 'Chưa thể xóa ca làm việc.', 'info')
      return
    }
    setSelectedShiftIds((current) => current.filter((id) => id !== shift.id))
  }

  const toggleShift = (id) => {
    setSelectedShiftIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])
  }

  const toggleEmployee = (id) => {
    setSelectedEmployeeIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])
  }

  const toggleAllEmployees = () => {
    const visibleIds = visibleEmployees.map((employee) => employee.id)
    const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedEmployeeIds.includes(id))
    setSelectedEmployeeIds((current) => allSelected
      ? current.filter((id) => !visibleIds.includes(id))
      : [...new Set([...current, ...visibleIds])])
  }

  const saveAssignments = async () => {
    if (!canManageStore) return
    const result = await saveScheduleMultiple?.(selectedEmployeeIds, selectedShiftIds, { date, note, storeId })
    if (!result?.ok) {
      notify?.(result?.message || 'Vui lòng chọn ít nhất một ca và một nhân viên.', 'info')
      return
    }
    setSelectedEmployeeIds([])
    setSelectedShiftIds([])
    setNote('')
  }

  const openAssignmentEditor = (row) => {
    if (!canManageStore) return
    setEditingAssignment(row)
    setAssignmentEmployeeIds(row.records.map((record) => String(record.employeeId)))
    setAssignmentNote(row.note)
  }

  const closeAssignmentEditor = () => {
    if (savingAssignment) return
    setEditingAssignment(null)
    setAssignmentEmployeeIds([])
    setAssignmentNote('')
  }

  const toggleAssignmentEmployee = (employeeId) => {
    setAssignmentEmployeeIds((current) => current.includes(employeeId)
      ? current.filter((id) => id !== employeeId)
      : [...current, employeeId])
  }

  const saveEditedAssignment = async () => {
    if (!editingAssignment || !assignmentEmployeeIds.length || savingAssignment) return
    setSavingAssignment(true)
    const assignments = replaceShiftAssignees(
      daySchedule,
      editingAssignment.shift.id,
      assignmentEmployeeIds,
      assignmentNote,
    )
    const result = await replaceScheduleDay?.(assignments, { storeId, date })
    setSavingAssignment(false)
    if (!result?.ok) {
      notify?.(result?.message || 'Chưa thể sửa lịch phân ca.', 'info')
      return
    }
    setEditingAssignment(null)
    setAssignmentEmployeeIds([])
    setAssignmentNote('')
  }

  const deleteAssignment = async (row) => {
    if (!canManageStore) return
    const employeeText = row.employeeNames.length === 1 ? row.employeeNames[0] : `${row.employeeNames.length} nhân viên`
    if (!window.confirm(`Xóa lịch ${row.shift.name} của ${employeeText} ngày ${displayDate(date)}?`)) return
    const assignments = removeShiftAssignments(daySchedule, row.shift.id)
    const result = await replaceScheduleDay?.(assignments, { storeId, date })
    if (!result?.ok) notify?.(result?.message || 'Chưa thể xóa lịch phân ca.', 'info')
  }

  return (
    <div className="page">
      <PageHeader
        title="Lịch phân ca"
        subtitle={`Tạo ca và phân lịch theo từng ngày cho ${activeStore?.name || 'cửa hàng'}.`}
        icon={CalendarDays}
        actions={(
          <>
            <Input icon={CalendarDays} type="date" value={date} onChange={changeDate} aria-label="Ngày phân ca" />
            {canManageStore && <Button icon={Plus} onClick={openCreateShift}>Tạo ca làm việc</Button>}
          </>
        )}
      />
      {!canManageStore && <InfoNote>Chế độ chỉ xem. Tài khoản hiện tại không thể tạo, sửa, xóa ca hoặc thay đổi lịch phân ca.</InfoNote>}

      <div className="metric-grid metric-grid--four schedule-metrics">
        <MetricCard label="Lịch trong ngày" value={createdScheduleRows.length} suffix="lịch" icon={Clock3} tone="blue" compact />
        <MetricCard label="Nhân viên đã xếp" value={new Set(daySchedule.map((item) => item.employeeId)).size} suffix="người" icon={Users} tone="green" compact />
        <MetricCard label="Ca hoạt động" value={dayShifts.length} suffix="ca" icon={CalendarDays} tone="purple" compact />
        <MetricCard label="Chưa phân ca" value={Math.max(0, employees.length - new Set(daySchedule.map((item) => item.employeeId)).size)} suffix="người" icon={Users} tone="orange" compact />
      </div>

      <Card className="schedule-board">
        <div className="card__subheader">
          <div className="tabs" role="tablist" aria-label="Kiểu xem lịch phân ca">
            <button type="button" className={viewMode === 'day' ? 'active' : ''} onClick={() => setViewMode('day')}>Theo ngày</button>
            <button type="button" className={viewMode === 'week' ? 'active' : ''} onClick={() => setViewMode('week')}>Theo tuần</button>
            <button type="button" className={viewMode === 'employee' ? 'active' : ''} onClick={() => setViewMode('employee')}>Theo nhân viên</button>
          </div>
          <div className="row-actions">
            <Button variant="outline" icon={ChevronLeft} onClick={() => setDate((current) => moveDate(current, viewMode === 'week' ? -7 : -1))} aria-label="Lùi thời gian" />
            <strong>{viewMode === 'week' ? `${displayDate(datesOfWeek[0])} – ${displayDate(datesOfWeek[6])}` : displayDate(date)}</strong>
            <Button variant="outline" icon={ChevronRight} onClick={() => setDate((current) => moveDate(current, viewMode === 'week' ? 7 : 1))} aria-label="Tiến thời gian" />
            <Button variant="outline" onClick={() => setDate(localDate())}>Hôm nay</Button>
          </div>
        </div>
        {viewMode === 'day' && (dayShifts.length ? <TableWrap className="schedule-matrix">
          <thead><tr><th>Nhân viên</th>{dayShifts.map((shift) => <th key={shift.id}>{shift.name}<small className="table-note">{timeLabel(shift.start, shift.end)}</small></th>)}</tr></thead>
          <tbody>{employees.map((employee) => {
            const record = scheduleForEmployeeDate(employee.id, date)
            const assigned = new Set(record?.shiftIds || (record?.shiftId ? [record.shiftId] : []))
            return <tr key={employee.id}><td><div className="person-cell"><Avatar name={employee.name} color={employee.color} /><span><strong>{employee.name}</strong><small>{employee.code || employee.id} · {employeeRole(employee)}</small></span></div></td>{dayShifts.map((shift) => <td key={shift.id}>{assigned.has(shift.id) ? <span className="schedule-shift-chip" style={{ '--shift-color': shift.color || '#07873d' }}><Check /> <strong>{shift.name}</strong><small>{timeLabel(shift.start, shift.end)}</small></span> : <span className="schedule-empty-cell">—</span>}</td>)}</tr>
          })}</tbody>
        </TableWrap> : <EmptyState title="Chưa có ca trong ngày" description="Tạo ca làm việc để hiển thị ma trận phân ca." />)}
        {viewMode === 'week' && <TableWrap>
          <thead><tr><th>Nhân viên</th>{datesOfWeek.map((item) => <th key={item}>{displayDate(item)}</th>)}</tr></thead>
          <tbody>{employees.map((employee) => <tr key={employee.id}><td><strong>{employee.name}</strong><small className="table-note">{employee.id}</small></td>{datesOfWeek.map((item) => {
            const record = scheduleForEmployeeDate(employee.id, item)
            const definitions = shiftsForDate(item)
            const ids = record?.shiftIds || (record?.shiftId ? [record.shiftId] : [])
            return <td key={item}>{ids.length ? ids.map((id) => definitions.find((shift) => shift.id === id)?.name || id).join(', ') : '—'}</td>
          })}</tr>)}</tbody>
        </TableWrap>}
        {viewMode === 'employee' && <>
          <Field label="Nhân viên"><Select value={focusedEmployeeId || employees[0]?.id || ''} onChange={(event) => setFocusedEmployeeId(event.target.value)}>{employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.name} — {employee.id}</option>)}</Select></Field>
          <TableWrap><thead><tr><th>Ngày</th><th>Ca làm việc</th><th>Giờ</th><th>Ghi chú</th></tr></thead><tbody>{schedule.filter((record) => String(record.employeeId) === String(focusedEmployeeId || employees[0]?.id || '') && (!record.storeId || String(record.storeId) === String(storeId))).toSorted((left, right) => String(right.date).localeCompare(String(left.date))).map((record) => {
            const assigned = (record.shiftIds || []).map((id) => resolveScheduledShift(record, id))
            return <tr key={record.id || `${record.employeeId}-${record.date}`}><td>{displayDate(record.date)}</td><td>{assigned.map((shift) => shift.name).join(', ') || '—'}</td><td>{assigned.map((shift) => timeLabel(shift.start, shift.end)).join(', ') || '—'}</td><td>{record.note || '—'}</td></tr>
          })}</tbody></TableWrap>
        </>}
      </Card>

      <div className="chart-grid schedule-management-grid">
        <Card
          title={`Ca làm việc ngày ${displayDate(date)}`}
          action={canManageStore ? <Button variant="outline" icon={Plus} onClick={openCreateShift}>Tạo ca</Button> : null}
        >
          {dayShifts.length ? (
            <>
              <TableWrap>
                <thead><tr><th>Tên ca</th><th>Thời gian</th><th>Thời lượng</th><th>Phiên bản</th>{canManageStore && <th>Thao tác</th>}</tr></thead>
                <tbody>
                  {dayShifts.map((shift) => (
                    <tr key={shift.id}>
                      <td><Badge tone="blue">{shift.name}</Badge></td>
                      <td><strong>{timeLabel(shift.start, shift.end)}</strong></td>
                      <td>{durationLabel(shift)}</td>
                      <td>v{shift.version || 1}</td>
                      {canManageStore && <td>
                        <div className="row-actions">
                          <button type="button" onClick={() => openEditShift(shift)} aria-label={`Sửa ${shift.name}`}><Edit3 /></button>
                          <button type="button" className="danger" onClick={() => removeShift(shift)} aria-label={`Xóa ${shift.name}`}><Trash2 /></button>
                        </div>
                      </td>}
                    </tr>
                  ))}
                </tbody>
              </TableWrap>
              <InfoNote>Dữ liệu chấm công và lịch cũ dùng bản chụp tên, giờ bắt đầu và giờ kết thúc; sửa ca hôm nay không đổi lịch sử.</InfoNote>
            </>
          ) : (
            <EmptyState title="Chưa có ca trong ngày" description={canManageStore ? 'Tạo ca làm việc trước khi phân lịch cho nhân viên.' : 'Chưa có dữ liệu ca làm việc trong ngày đã chọn.'} />
          )}
        </Card>

        {canManageStore && <Card title={`Tạo lịch phân ca · ${displayDate(date)}`}>
          <Field label="1. Chọn ngày" required>
            <Input icon={CalendarDays} type="date" value={date} onChange={changeDate} />
          </Field>
          <Field label={`2. Chọn ca (có thể chọn nhiều) · Đã chọn ${selectedShiftIds.length}`}>
            {dayShifts.length ? (
              <div className="shift-selector">
                {dayShifts.map((shift) => (
                  <button
                    type="button"
                    key={shift.id}
                    className={selectedShiftIds.includes(shift.id) ? 'active' : ''}
                    style={{ '--shift-color': shift.color || '#07873d' }}
                    onClick={() => toggleShift(shift.id)}
                    title={timeLabel(shift.start, shift.end)}
                  >
                    {shift.name}
                    {selectedShiftIds.includes(shift.id) && <Check />}
                  </button>
                ))}
              </div>
            ) : <InfoNote tone="orange">Chưa có ca để chọn trong ngày này.</InfoNote>}
          </Field>

          <div className="card__subheader">
            <strong>3. Chọn nhân viên (có thể chọn nhiều) · Đã chọn {selectedEmployeeIds.length}</strong>
            <Button variant="ghost" onClick={toggleAllEmployees} disabled={!visibleEmployees.length}>
              {visibleEmployees.length && visibleEmployees.every((employee) => selectedEmployeeIds.includes(employee.id)) ? 'Bỏ chọn hiển thị' : 'Chọn tất cả hiển thị'}
            </Button>
          </div>
          <SearchInput value={employeeQuery} onChange={setEmployeeQuery} placeholder="Tìm tên hoặc mã nhân viên..." />
          <div className="employee-picker">
            {visibleEmployees.map((employee) => (
              <label key={employee.id} className={selectedEmployeeIds.includes(employee.id) ? 'selected' : ''}>
                <input type="checkbox" checked={selectedEmployeeIds.includes(employee.id)} onChange={() => toggleEmployee(employee.id)} />
                <Avatar name={employee.name} color={employee.color} size={30} />
                <strong>{employee.name}</strong>
                <small>{employee.code || employee.id} · {employeeRole(employee)}</small>
              </label>
            ))}
            {!visibleEmployees.length && <EmptyState title="Không tìm thấy nhân viên" description="Thử một từ khóa khác." />}
          </div>
          <Field label="4. Ghi chú (tùy chọn)">
            <textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="Ghi chú cho lịch phân ca..." />
          </Field>
          <div className="panel-actions">
            <Button variant="outline" onClick={() => { setSelectedShiftIds([]); setSelectedEmployeeIds([]); setNote('') }}>Làm lại</Button>
            <Button icon={Save} onClick={saveAssignments} disabled={!selectedShiftIds.length || !selectedEmployeeIds.length}>LƯU</Button>
          </div>
        </Card>}
      </div>

      <Card className="created-schedule-card">
        <div className="created-schedule-card__header">
          <div>
            <h2>Lịch đã tạo ngày {displayDate(date)}</h2>
            <p>Chọn một lịch để sửa danh sách nhân viên, ghi chú hoặc xóa lịch phân ca.</p>
          </div>
          <Button variant="outline" onClick={() => setDate(localDate())}>Hôm nay</Button>
        </div>
        {createdScheduleRows.length ? (
          <div className="created-schedule-list">
            {createdScheduleRows.map((row) => (
              <article key={row.shift.id} className="created-schedule-row">
                <span className="created-schedule-row__icon"><Clock3 /></span>
                <div className="created-schedule-row__content">
                  <strong>{row.shift.name}</strong>
                  <b>{timeLabel(row.shift.start, row.shift.end)}</b>
                  <span>{row.employeeNames.join(', ')}</span>
                  {row.note && <small>Ghi chú: {row.note}</small>}
                  <small>Cập nhật: {displayDateTime(row.updatedAt)}</small>
                </div>
                {canManageStore && <div className="created-schedule-row__actions">
                  <button type="button" onClick={() => openAssignmentEditor(row)} aria-label={`Sửa lịch ${row.shift.name}`}><Edit3 /></button>
                  <button type="button" className="danger" onClick={() => deleteAssignment(row)} aria-label={`Xóa lịch ${row.shift.name}`}><Trash2 /></button>
                </div>}
              </article>
            ))}
          </div>
        ) : (
          <EmptyState title="Chưa có lịch phân ca" description="Chọn ca và nhân viên ở trên để tạo lịch mới." />
        )}
        {createdScheduleRows.length > 0 && <TableFooter shown={createdScheduleRows.length} total={createdScheduleRows.length} />}
      </Card>

      {canManageStore && <Modal
        open={Boolean(editingAssignment)}
        onClose={closeAssignmentEditor}
        title={`Sửa lịch ${editingAssignment?.shift?.name || ''} · ${displayDate(date)}`}
        wide
        footer={(
          <>
            <Button variant="outline" onClick={closeAssignmentEditor} disabled={savingAssignment}>Hủy</Button>
            <Button icon={Save} onClick={saveEditedAssignment} loading={savingAssignment} disabled={!assignmentEmployeeIds.length}>LƯU LỊCH</Button>
          </>
        )}
      >
        <div className="schedule-edit-summary">
          <Clock3 />
          <span><strong>{editingAssignment?.shift?.name}</strong><small>{timeLabel(editingAssignment?.shift?.start, editingAssignment?.shift?.end)}</small></span>
        </div>
        <Field label={`Nhân viên được phân ca · Đã chọn ${assignmentEmployeeIds.length}`} required>
          <div className="employee-picker schedule-edit-employees">
            {employees.map((employee) => (
              <label key={employee.id} className={assignmentEmployeeIds.includes(String(employee.id)) ? 'selected' : ''}>
                <input
                  type="checkbox"
                  checked={assignmentEmployeeIds.includes(String(employee.id))}
                  onChange={() => toggleAssignmentEmployee(String(employee.id))}
                  aria-label={`Chọn ${employee.name} cho ${editingAssignment?.shift?.name || 'ca'}`}
                />
                <Avatar name={employee.name} color={employee.color} size={30} />
                <strong>{employee.name}</strong>
                <small>{employee.code || employee.id} · {employeeRole(employee)}</small>
              </label>
            ))}
          </div>
        </Field>
        <Field label="Ghi chú (tùy chọn)">
          <textarea value={assignmentNote} onChange={(event) => setAssignmentNote(event.target.value)} placeholder="Ghi chú cho lịch phân ca..." />
        </Field>
        <InfoNote>Thao tác này chỉ sửa lịch ngày đã chọn. Dữ liệu chấm công và bản chụp lịch sử trước đó không bị thay đổi.</InfoNote>
      </Modal>}

      {canManageStore && <Modal
        open={shiftModalOpen}
        onClose={closeShiftModal}
        title={editingShift ? `Sửa ${editingShift.name}` : 'Tạo ca làm việc'}
        footer={(
          <>
            <Button variant="outline" onClick={closeShiftModal}>Hủy</Button>
            <Button icon={Save} onClick={saveShift}>LƯU</Button>
          </>
        )}
      >
        <div className="form-grid">
          <Field label="Tên ca" required>
            <Input value={shiftForm.name} onChange={(event) => setShiftForm({ ...shiftForm, name: event.target.value })} placeholder="Ví dụ: Ca sáng" autoFocus />
          </Field>
          <Field label="Ngày áp dụng" required>
            <Input type="date" value={shiftForm.date} onChange={(event) => setShiftForm({ ...shiftForm, date: event.target.value })} />
          </Field>
          <Field label="Giờ bắt đầu (24 giờ)" required>
            <Input type="time" value={shiftForm.start} onChange={(event) => setShiftForm({ ...shiftForm, start: event.target.value })} />
          </Field>
          <Field label="Giờ kết thúc (24 giờ)" required>
            <Input type="time" value={shiftForm.end} onChange={(event) => setShiftForm({ ...shiftForm, end: event.target.value })} />
          </Field>
          <Field label="Màu nhận diện (hệ thống tự chọn)">
            <div className="input-wrap" aria-label={`Màu ca ${shiftForm.color}`}>
              <span aria-hidden="true" style={{ width: 24, height: 24, borderRadius: 999, background: shiftForm.color, boxShadow: `0 0 0 4px ${shiftForm.color}22` }} />
              <strong>{shiftForm.color.toUpperCase()}</strong>
            </div>
          </Field>
          <Field label="Thời lượng dự kiến">
            <Input value={durationLabel(shiftForm)} readOnly />
          </Field>
        </div>
        <InfoNote>Ca được quản lý độc lập theo ngày. Hệ thống lưu bản chụp thời gian khi phân ca để không làm sai lịch sử.</InfoNote>
      </Modal>}
    </div>
  )
}

export default UnifiedSchedule
