import { useState } from 'react'
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Check,
  Clock3,
  Download,
  Edit3,
  Plus,
  Save,
  Trash2,
  Users,
} from 'lucide-react'
import {
  Avatar,
  Button,
  Card,
  EmptyState,
  Field,
  InfoNote,
  Input,
  Modal,
  SearchInput,
  Select,
  TableFooter,
  TableWrap,
} from '../../components/UI'
import { useApp } from '../../state/AppContext'
import { SupportEmployeeTag } from '../../components/SupportEmployeeTag'
import { resolveSupportEmployeeTagContext } from '../../domain/supportEmployeeTag'
import { supportTransferOverlapsDate } from '../../domain/supportTransferTime'
import { downloadCsv } from '../../utils'
import { removeShiftAssignments, replaceShiftAssignees } from './scheduleAssignments'
import {
  activeStoreShiftDefinitions,
  moveStoreScheduleDate,
  resolveStoreScheduleRecordShifts,
  resolveStoreScheduleShift,
  scheduleShiftDurationLabel,
  scheduleShiftIds,
  scheduleShiftTimeLabel,
  stableScheduleShiftColor,
  STORE_SHIFT_COLOR_PALETTE,
  storeScheduleRange,
  storeScheduleRecordMatches,
  storeScheduleShiftColumns,
  vietnamScheduleDate,
} from './scheduleView'
import './UnifiedSchedule.css'

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

const BRIGHT_SHIFT_COLORS = STORE_SHIFT_COLOR_PALETTE

const nextShiftColor = (shifts = []) => {
  const used = new Set(shifts.filter((shift) => shift.active !== false).map((shift) => String(shift.color || '').toLowerCase()))
  return BRIGHT_SHIFT_COLORS.find((color) => !used.has(color.toLowerCase()))
    || BRIGHT_SHIFT_COLORS[shifts.length % BRIGHT_SHIFT_COLORS.length]
}

const blankShift = (color = BRIGHT_SHIFT_COLORS[0]) => ({
  name: '',
  start: '07:00',
  end: '12:00',
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
  const [date, setDate] = useState(vietnamScheduleDate)
  const [viewMode, setViewMode] = useState('day')
  const [historyMode, setHistoryMode] = useState('day')
  const [focusedEmployeeId, setFocusedEmployeeId] = useState('')
  const [selectedShiftIds, setSelectedShiftIds] = useState([])
  const [selectedEmployeeIds, setSelectedEmployeeIds] = useState([])
  const [employeeQuery, setEmployeeQuery] = useState('')
  const [note, setNote] = useState('')
  const [assignmentModalOpen, setAssignmentModalOpen] = useState(false)
  const [savingNewAssignment, setSavingNewAssignment] = useState(false)
  const [shiftModalOpen, setShiftModalOpen] = useState(false)
  const [editingShift, setEditingShift] = useState(null)
  const [shiftForm, setShiftForm] = useState(() => blankShift(nextShiftColor(shiftDefinitions)))
  const [editingAssignment, setEditingAssignment] = useState(null)
  const [assignmentEmployeeIds, setAssignmentEmployeeIds] = useState([])
  const [assignmentNote, setAssignmentNote] = useState('')
  const [savingAssignment, setSavingAssignment] = useState(false)

  const mainViewRange = storeScheduleRange(date, viewMode)
  const employeeSupportsStoreInView = (employee) => supportTransfers.some((record) => (
    String(record.employeeId || '') === String(employee.id || employee.code || '')
    && String(record.toStoreId || '') === String(storeId)
    && mainViewRange.dates.some((targetDate) => supportTransferOverlapsDate(record, targetDate))
  ))
  const employeeSupportsAnotherStoreOnDate = (employee) => supportTransfers.some((record) => (
    String(record.employeeId || '') === String(employee.id || employee.code || '')
    && String(record.fromStoreId || '') === String(storeId)
    && String(record.toStoreId || '') !== String(storeId)
    && supportTransferOverlapsDate(record, date)
  ))
  const employees = allEmployees
    .filter((employee) => (
      String(employee.unit || 'store') === 'store'
      && employee.status !== 'Đã nghỉ việc'
      && (!storeId || String(employee.storeId) === String(storeId) || employeeSupportsStoreInView(employee))
      && !(viewMode === 'day' && String(employee.storeId) === String(storeId) && employeeSupportsAnotherStoreOnDate(employee))
    ))
    .sort((left, right) => String(left.name || '').localeCompare(String(right.name || ''), 'vi'))

  const dayShifts = activeStoreShiftDefinitions(shiftDefinitions, { storeId, date })
  const employeeIds = new Set(employees.map((employee) => String(employee.id || employee.code || '')))
  const daySchedule = schedule.filter((record) => (
    String(record.date || record.workDate || '') === date
    && employeeIds.has(String(record.employeeId))
    && storeScheduleRecordMatches(record, storeId)
  ))
  const dayViewShifts = storeScheduleShiftColumns({ date, records: daySchedule, shiftDefinitions, storeId })
  const employeeById = new Map(employees.map((employee) => [String(employee.id || employee.code || ''), employee]))
  const scheduleByEmployeeDate = new Map()
  schedule.filter((record) => storeScheduleRecordMatches(record, storeId)).forEach((record) => {
    const key = `${String(record.employeeId || '')}:${String(record.date || record.workDate || '')}`
    if (!scheduleByEmployeeDate.has(key)) scheduleByEmployeeDate.set(key, record)
  })
  const scheduledEmployeeIds = new Set(daySchedule.map((record) => String(record.employeeId)))
  const assignedEmployeeCountByShift = new Map()
  daySchedule.forEach((record) => {
    scheduleShiftIds(record).forEach((shiftId) => {
      const key = String(shiftId)
      assignedEmployeeCountByShift.set(key, (assignedEmployeeCountByShift.get(key) || 0) + 1)
    })
  })
  const visibleEmployees = employees.filter((employee) => (
    `${employee.id || ''} ${employee.code || ''} ${employee.name || ''} ${employeeRole(employee)}`
      .toLocaleLowerCase('vi')
      .includes(employeeQuery.trim().toLocaleLowerCase('vi'))
  ))
  const datesOfWeek = storeScheduleRange(date, 'week').dates
  const datesOfMonth = storeScheduleRange(date, 'month').dates
  const scheduleForEmployeeDate = (employeeId, targetDate) => scheduleByEmployeeDate.get(`${String(employeeId || '')}:${targetDate}`)
  const supportContextForEmployeeDate = (employee, targetDate) => resolveSupportEmployeeTagContext({
    record: {
      employeeId: employee.id || employee.code,
      storeId,
      businessDate: targetDate,
      supportAssignment: employee.supportAssignment,
      supportStoreId: employee.supportStoreId || storeId,
      homeStoreId: employee.homeStoreId || employee.storeId,
      isSupportEmployee: Boolean(employee.supportAssignment || employee.supportStoreId),
    },
    employee,
    employeeId: employee.id || employee.code,
    storeId,
    businessDate: targetDate,
    employees: allEmployees,
    stores: app.stores,
    supportTransfers,
  })
  const supportContextForEmployeeRange = (employee, dates) => (
    dates.map((targetDate) => supportContextForEmployeeDate(employee, targetDate)).find(Boolean) || null
  )

  const resolveScheduledShift = (record, shiftId) => resolveStoreScheduleShift({
    record, shiftId, shiftDefinitions, storeId,
  }) || {
    id: String(shiftId || ''),
    name: `Ca ${String(shiftId || '')}`,
    color: stableScheduleShiftColor(storeId, shiftId),
  }

  const createdScheduleRows = [...new Set(daySchedule.flatMap(scheduleShiftIds))].map((shiftId) => {
    const records = daySchedule.filter((record) => scheduleShiftIds(record).includes(String(shiftId)))
    const shift = resolveScheduledShift(records[0] || {}, shiftId)
    const employeeDetails = records.map((record) => {
      const employee = employeeById.get(String(record.employeeId))
      return { record, employee, name: employee?.name || record.employeeName || record.employeeId }
    })
    const timestamps = records.map((record) => record.updatedAt || record.createdAt).filter(Boolean)
    return {
      shift,
      records,
      employeeNames: employeeDetails.map((item) => item.name),
      employeeDetails,
      note: records.find((record) => record.note)?.note || '',
      updatedAt: timestamps.toSorted().at(-1) || '',
    }
  }).toSorted((left, right) => String(right.shift.start || '').localeCompare(String(left.shift.start || '')))
  const historyDates = new Set(storeScheduleRange(date, historyMode).dates)
  const focusedEmployee = employeeById.get(String(focusedEmployeeId || employees[0]?.id || ''))
  const scheduleHistoryRows = schedule
    .filter((record) => (
      historyDates.has(String(record.date || record.workDate || ''))
      && storeScheduleRecordMatches(record, storeId)
    ))
    .flatMap((record) => scheduleShiftIds(record).map((shiftId) => ({
      id: `${record.id || record.employeeId}-${shiftId}`,
      date: String(record.date || record.workDate || ''),
      employeeName: employeeById.get(String(record.employeeId))?.name || record.employeeName || record.employeeId,
      employeeId: record.employeeId,
      shift: resolveScheduledShift(record, shiftId),
      note: record.note || '',
      updatedAt: record.updatedAt || record.createdAt || '',
    })))
    .toSorted((left, right) => `${right.date}:${right.updatedAt}`.localeCompare(`${left.date}:${left.updatedAt}`))

  const renderScheduleCell = (employeeId, targetDate) => {
    const record = scheduleForEmployeeDate(employeeId, targetDate)
    const shifts = record ? resolveStoreScheduleRecordShifts({ record, shiftDefinitions, storeId }) : []
    return shifts.length
      ? <div className="schedule-view-shifts">{shifts.map((shift) => <span key={shift.id} className="schedule-shift-chip" style={{ '--shift-color': shift.color }}><strong>{shift.name}</strong><small>{scheduleShiftTimeLabel(shift)}</small></span>)}</div>
      : <span className="schedule-empty-cell">—</span>
  }
  const mainRangeLabel = ['week', 'month'].includes(viewMode)
    ? `${displayDate(mainViewRange.from)} – ${displayDate(mainViewRange.to)}`
    : displayDate(date)
  const renderPeriodSchedule = (dates, period) => <TableWrap className={`schedule-matrix schedule-matrix--period schedule-matrix--${period}`}>
    <thead><tr><th>Nhân viên</th>{dates.map((item) => <th key={item}>{displayDate(item)}</th>)}</tr></thead>
    <tbody>{employees.map((employee) => <tr key={employee.id || employee.code}>
      <td><div className="person-cell"><Avatar name={employee.name} src={employee.avatar} employeeId={employee.id || employee.code} color={employee.color} /><span><strong>{employee.name}</strong><SupportEmployeeTag context={supportContextForEmployeeRange(employee, dates)} /><small>{employee.code || employee.id} · {employeeRole(employee)}</small></span></div></td>
      {dates.map((item) => <td key={item}>{renderScheduleCell(employee.id || employee.code, item)}</td>)}
    </tr>)}</tbody>
  </TableWrap>

  const changeDate = (event) => {
    const nextDate = event.target.value
    setDate(nextDate)
    setSelectedShiftIds([])
  }

  const openCreateShift = () => {
    if (!canManageStore) return
    setEditingShift(null)
    setShiftForm(blankShift(nextShiftColor(shiftDefinitions.filter((shift) => !storeId || !shift.storeId || String(shift.storeId) === String(storeId)))))
    setShiftModalOpen(true)
  }

  const openEditShift = (shift) => {
    if (!canManageStore) return
    setEditingShift(shift)
    setShiftForm({
      name: shift.name || '',
      start: shift.start || '07:00',
      end: shift.end || '12:00',
      color: shift.color || stableScheduleShiftColor(storeId, shift.id),
    })
    setShiftModalOpen(true)
  }

  const closeShiftModal = () => {
    setShiftModalOpen(false)
    setEditingShift(null)
    setShiftForm(blankShift(nextShiftColor(shiftDefinitions)))
  }

  const saveShift = async () => {
    if (!canManageStore) return
    const payload = {
      ...shiftForm,
      name: shiftForm.name.trim(),
      storeId,
      ...(editingShift?.date ? { date: '' } : {}),
    }
    if (!payload.name || !payload.start || !payload.end) {
      notify?.('Vui lòng nhập đủ tên và thời gian ca làm việc.', 'info')
      return
    }
    const result = editingShift
      ? await updateShiftDefinition?.(editingShift.id, payload)
      : await createShiftDefinition?.(payload)
    if (!result?.ok) {
      notify?.(result?.message || 'Chưa thể lưu ca làm việc.', 'info')
      return
    }
    setSelectedShiftIds(result.shift?.id ? [result.shift.id] : [])
    closeShiftModal()
  }

  const removeShift = async (shift) => {
    if (!canManageStore) return
    if (!window.confirm(`Ngừng sử dụng ${shift.name}? Lịch sử đã ghi nhận sẽ được giữ nguyên.`)) return
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
    if (!canManageStore || savingNewAssignment) return
    setSavingNewAssignment(true)
    const result = await saveScheduleMultiple?.(selectedEmployeeIds, selectedShiftIds, { date, note, storeId })
    setSavingNewAssignment(false)
    if (!result?.ok) {
      notify?.(result?.message || 'Vui lòng chọn ít nhất một ca và một nhân viên.', 'info')
      return
    }
    setSelectedEmployeeIds([])
    setSelectedShiftIds([])
    setNote('')
    setEmployeeQuery('')
    setAssignmentModalOpen(false)
  }

  const openAssignmentModal = () => {
    if (!canManageStore) return
    setSelectedEmployeeIds([])
    setSelectedShiftIds([])
    setEmployeeQuery('')
    setNote('')
    setAssignmentModalOpen(true)
  }

  const closeAssignmentModal = () => {
    if (savingNewAssignment) return
    setAssignmentModalOpen(false)
    setSelectedEmployeeIds([])
    setSelectedShiftIds([])
    setEmployeeQuery('')
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

  const exportDailySchedule = () => {
    const rows = daySchedule.flatMap((record) => {
      const employee = employeeById.get(String(record.employeeId))
      const ids = scheduleShiftIds(record)
      return ids.map((shiftId) => {
        const shift = resolveScheduledShift(record, shiftId)
        return {
          Ngày: displayDate(date),
          'Mã nhân viên': employee?.code || employee?.id || record.employeeId,
          'Tên nhân viên': employee?.name || record.employeeName || record.employeeId,
          'Vị trí': employeeRole(employee),
          Ca: shift.name,
          'Giờ bắt đầu': shift.start || '',
          'Giờ kết thúc': shift.end || '',
          'Ghi chú': record.note || '',
        }
      })
    })
    if (!rows.length) {
      notify?.('Ngày đang chọn chưa có lịch phân ca để xuất.', 'info')
      return
    }
    downloadCsv(`lich-phan-ca-${date}.csv`, rows)
  }

  return (
    <div className="page unified-schedule-page">
      <header className="schedule-page-hero">
        <div className="schedule-page-hero__store">
          <strong>CỬA HÀNG · {activeStore?.name || 'IDOSI'}</strong>
          <span>Dữ liệu phân ca độc lập theo cửa hàng.</span>
        </div>
        <h1>Lịch phân ca</h1>
        <span className="schedule-page-hero__status"><i /> Đang hoạt động</span>
      </header>

      <Card className="schedule-toolbar-card">
        <div className="schedule-toolbar-card__copy">
          <h2>Lịch phân ca</h2>
          <p>Tạo ca dùng chung, sau đó phân nhiều ca cho nhiều nhân viên.</p>
        </div>
        <div className="schedule-toolbar-card__actions">
          <Input icon={CalendarDays} type="date" value={date} onChange={changeDate} aria-label="Ngày phân ca" />
          <Button variant="outline" icon={Download} onClick={exportDailySchedule}>Xuất Excel</Button>
          {canManageStore && <Button variant="outline" icon={Plus} onClick={openCreateShift}>Tạo ca làm việc</Button>}
          {canManageStore && <Button icon={CalendarDays} onClick={openAssignmentModal} aria-label="PHÂN CA">Tạo lịch phân ca</Button>}
        </div>
      </Card>
      {!canManageStore && <InfoNote>Chế độ chỉ xem. Tài khoản hiện tại không thể tạo, sửa, xóa ca hoặc thay đổi lịch phân ca.</InfoNote>}

      {dayShifts.length ? (
        <section className="schedule-shift-card-grid" aria-label="Ca làm việc dùng chung">
          {dayShifts.map((shift) => {
            const assignedCount = assignedEmployeeCountByShift.get(String(shift.id)) || 0
            return (
              <article key={shift.id} className="schedule-shift-card" style={{ '--shift-color': shift.color }}>
                <i className="schedule-shift-card__accent" aria-hidden="true" />
                <div className="schedule-shift-card__clock"><Clock3 /></div>
                <div className="schedule-shift-card__content">
                  <strong>{shift.name}</strong>
                  <b>{scheduleShiftTimeLabel(shift)}</b>
                  <span>{scheduleShiftDurationLabel(shift)} · {assignedCount} nhân viên</span>
                  <small>Cập nhật: {displayDateTime(shift.updatedAt || shift.createdAt)}</small>
                </div>
                {canManageStore && <div className="schedule-shift-card__actions">
                  <button type="button" onClick={() => openEditShift(shift)} aria-label={`Sửa ${shift.name}`}><Edit3 /></button>
                  <button type="button" className="danger" onClick={() => removeShift(shift)} aria-label={`Xóa ${shift.name}`}><Trash2 /></button>
                </div>}
              </article>
            )
          })}
        </section>
      ) : (
        <Card className="schedule-no-shifts"><EmptyState title="Chưa có ca làm việc" description={canManageStore ? 'Tạo ca một lần để dùng lại khi phân lịch.' : 'Cửa hàng chưa có dữ liệu ca làm việc.'} /></Card>
      )}

      <section className="schedule-stat-strip" aria-label="Thống kê lịch phân ca">
        <article><CalendarDays /><strong>{createdScheduleRows.length}</strong><span>Lịch trong ngày</span></article>
        <article><Users /><strong>{scheduledEmployeeIds.size}</strong><span>Nhân viên đã xếp</span></article>
        <article><Clock3 /><strong>{dayShifts.length}</strong><span>Ca hoạt động</span></article>
        <article><Users /><strong>{Math.max(0, employees.length - scheduledEmployeeIds.size)}</strong><span>Chưa phân ca</span></article>
      </section>

      <Card className="schedule-board">
        <div className="card__subheader">
          <div className="tabs" role="tablist" aria-label="Kiểu xem lịch phân ca">
            <button type="button" className={viewMode === 'day' ? 'active' : ''} onClick={() => setViewMode('day')}>Theo ngày</button>
            <button type="button" className={viewMode === 'week' ? 'active' : ''} onClick={() => setViewMode('week')}>Theo tuần</button>
            <button type="button" className={viewMode === 'month' ? 'active' : ''} onClick={() => setViewMode('month')}>Theo tháng</button>
            <button type="button" className={viewMode === 'employee' ? 'active' : ''} onClick={() => setViewMode('employee')}>Theo nhân viên</button>
          </div>
          <div className="row-actions">
            <Button variant="outline" icon={ChevronLeft} onClick={() => setDate((current) => moveStoreScheduleDate(current, viewMode, -1) || vietnamScheduleDate())} aria-label="Lùi thời gian" />
            <strong>{mainRangeLabel}</strong>
            <Button variant="outline" icon={ChevronRight} onClick={() => setDate((current) => moveStoreScheduleDate(current, viewMode, 1) || vietnamScheduleDate())} aria-label="Tiến thời gian" />
            <Button variant="outline" className="schedule-today-button" onClick={() => setDate(vietnamScheduleDate())}>Hôm nay</Button>
          </div>
        </div>
        {viewMode === 'day' && (dayViewShifts.length ? <TableWrap className="schedule-matrix schedule-matrix--day">
          <thead><tr><th>Nhân viên</th>{dayViewShifts.map((shift) => <th key={shift.id}>{shift.name}<small className="table-note">{scheduleShiftTimeLabel(shift)}</small></th>)}</tr></thead>
          <tbody>{employees.map((employee) => {
            const record = scheduleForEmployeeDate(employee.id || employee.code, date)
            const assigned = new Set(scheduleShiftIds(record))
            return <tr key={employee.id}><td><div className="person-cell"><Avatar name={employee.name} src={employee.avatar} employeeId={employee.id || employee.code} color={employee.color} /><span><strong>{employee.name}</strong><SupportEmployeeTag context={supportContextForEmployeeDate(employee, date)} /><small>{employee.code || employee.id} · {employeeRole(employee)}</small></span></div></td>{dayViewShifts.map((column) => {
              const shift = assigned.has(String(column.id)) ? resolveScheduledShift(record, column.id) : column
              return <td key={column.id}>{assigned.has(String(column.id)) ? <span className="schedule-shift-chip" style={{ '--shift-color': shift.color }}><Check /> <strong>{shift.name}</strong><small>{scheduleShiftTimeLabel(shift)}</small></span> : <span className="schedule-empty-cell">—</span>}</td>
            })}</tr>
          })}</tbody>
        </TableWrap> : <EmptyState title="Chưa có ca trong ngày" description="Tạo ca làm việc hoặc chọn ngày có lịch đã lưu." />)}
        {viewMode === 'week' && renderPeriodSchedule(datesOfWeek, 'week')}
        {viewMode === 'month' && renderPeriodSchedule(datesOfMonth, 'month')}
        {viewMode === 'employee' && <>
          <Field label="Nhân viên"><Select value={focusedEmployeeId || employees[0]?.id || ''} onChange={(event) => setFocusedEmployeeId(event.target.value)}>{employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.name} — {employee.id}</option>)}</Select>{focusedEmployee && <SupportEmployeeTag context={supportContextForEmployeeRange(focusedEmployee, mainViewRange.dates)} />}</Field>
          <TableWrap className="schedule-matrix schedule-matrix--employee"><thead><tr><th>Ngày</th><th>Ca làm việc</th><th>Giờ</th><th>Ghi chú</th></tr></thead><tbody>{schedule.filter((record) => String(record.employeeId) === String(focusedEmployeeId || employees[0]?.id || '') && storeScheduleRecordMatches(record, storeId)).toSorted((left, right) => String(right.date).localeCompare(String(left.date))).map((record) => {
            const assigned = resolveStoreScheduleRecordShifts({ record, shiftDefinitions, storeId })
            return <tr key={record.id || `${record.employeeId}-${record.date}`}><td>{displayDate(record.date)}</td><td>{assigned.map((shift) => shift.name).join(', ') || '—'}</td><td>{assigned.map(scheduleShiftTimeLabel).join(', ') || '—'}</td><td>{record.note || '—'}</td></tr>
          })}</tbody></TableWrap>
        </>}
      </Card>

      <Card className="created-schedule-card">
        <div className="created-schedule-card__header">
          <div>
            <h2>Lịch sử phân ca</h2>
            <p>Xem theo ngày, tuần hoặc tháng; lịch ngày đang chọn có thể sửa hoặc xóa.</p>
          </div>
          <div className="tabs" role="tablist" aria-label="Phạm vi lịch sử phân ca"><button type="button" className={historyMode === 'day' ? 'active' : ''} onClick={() => setHistoryMode('day')}>Theo ngày</button><button type="button" className={historyMode === 'week' ? 'active' : ''} onClick={() => setHistoryMode('week')}>Theo tuần</button><button type="button" className={historyMode === 'month' ? 'active' : ''} onClick={() => setHistoryMode('month')}>Theo tháng</button></div>
        </div>
        {historyMode === 'day' && createdScheduleRows.length ? (
          <div className="created-schedule-list">
            {createdScheduleRows.map((row) => (
              <article key={row.shift.id} className="created-schedule-row">
                <span className="created-schedule-row__icon"><Clock3 /></span>
                <div className="created-schedule-row__content">
                  <strong>{row.shift.name}</strong>
                  <b>{scheduleShiftTimeLabel(row.shift)}</b>
                  <div className="created-schedule-row__employees">{row.employeeDetails.map(({ record, employee, name }) => <span key={record.id || record.employeeId}><strong>{name}</strong><SupportEmployeeTag context={supportContextForEmployeeDate(employee || { id: record.employeeId, name }, date)} /></span>)}</div>
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
        ) : historyMode === 'day' ? (
          <EmptyState title="Chưa có lịch phân ca" description="Chọn ca và nhân viên ở trên để tạo lịch mới." />
        ) : scheduleHistoryRows.length ? <TableWrap><thead><tr><th>Ngày</th><th>Nhân viên</th><th>Ca</th><th>Thời gian</th><th>Ghi chú</th><th>Cập nhật</th></tr></thead><tbody>{scheduleHistoryRows.map((row) => <tr key={row.id}><td><strong>{displayDate(row.date)}</strong></td><td><strong>{row.employeeName}</strong><SupportEmployeeTag context={supportContextForEmployeeDate(employeeById.get(String(row.employeeId)) || { id: row.employeeId, name: row.employeeName }, row.date)} /><small className="table-note">{row.employeeId}</small></td><td>{row.shift.name}</td><td>{scheduleShiftTimeLabel(row.shift)}</td><td>{row.note || '—'}</td><td>{displayDateTime(row.updatedAt)}</td></tr>)}</tbody></TableWrap> : <EmptyState title="Chưa có lịch sử phân ca" description="Không có lịch trong phạm vi đang chọn." />}
        {historyMode === 'day' && createdScheduleRows.length > 0 && <TableFooter shown={createdScheduleRows.length} total={createdScheduleRows.length} />}
      </Card>

      {canManageStore && <Modal
        open={assignmentModalOpen}
        onClose={closeAssignmentModal}
        title="Phân ca nhân viên"
        wide
        footer={(
          <>
            <Button variant="outline" onClick={closeAssignmentModal} disabled={savingNewAssignment}>Hủy</Button>
            <Button
              icon={Save}
              onClick={saveAssignments}
              loading={savingNewAssignment}
              disabled={!selectedShiftIds.length || !selectedEmployeeIds.length}
            >LƯU</Button>
          </>
        )}
      >
        <div className="schedule-assignment-flow">
          <Field label="1. Chọn ngày" required>
            <Input icon={CalendarDays} type="date" value={date} onChange={changeDate} aria-label="Ngày tạo lịch phân ca" />
          </Field>
          <Field label={`2. Chọn ca (có thể chọn nhiều) · Đã chọn ${selectedShiftIds.length}`} required>
            {dayShifts.length ? (
              <div className="shift-selector schedule-assignment-shifts">
                {dayShifts.map((shift) => (
                  <button
                    type="button"
                    key={shift.id}
                    className={selectedShiftIds.includes(shift.id) ? 'active' : ''}
                    style={{ '--shift-color': shift.color }}
                    onClick={() => toggleShift(shift.id)}
                    aria-pressed={selectedShiftIds.includes(shift.id)}
                    aria-label={`Chọn ${shift.name} ${scheduleShiftTimeLabel(shift)}`}
                  >
                    <span><strong>{shift.name}</strong><small>{scheduleShiftTimeLabel(shift)}</small></span>
                    {selectedShiftIds.includes(shift.id) && <Check />}
                  </button>
                ))}
              </div>
            ) : <InfoNote tone="orange">Ngày này chưa có ca làm việc. Hãy tạo ca trước khi phân lịch.</InfoNote>}
          </Field>
          <div className="schedule-assignment-employees">
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
                  <input
                    type="checkbox"
                    checked={selectedEmployeeIds.includes(employee.id)}
                    onChange={() => toggleEmployee(employee.id)}
                    aria-label={`Chọn nhân viên ${employee.name}`}
                  />
                  <Avatar name={employee.name} src={employee.avatar} employeeId={employee.id || employee.code} color={employee.color} size={30} />
                  <strong>{employee.name}</strong>
                  <SupportEmployeeTag context={supportContextForEmployeeDate(employee, date)} />
                  <small>{employee.code || employee.id} · {employeeRole(employee)}</small>
                </label>
              ))}
              {!visibleEmployees.length && <EmptyState title="Không tìm thấy nhân viên" description="Thử một từ khóa khác." />}
            </div>
          </div>
          <Field label="4. Ghi chú (tùy chọn)">
            <textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="Ghi chú cho lịch phân ca..." />
          </Field>
        </div>
      </Modal>}

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
          <span><strong>{editingAssignment?.shift?.name}</strong><small>{scheduleShiftTimeLabel(editingAssignment?.shift)}</small></span>
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
                <Avatar name={employee.name} src={employee.avatar} employeeId={employee.id || employee.code} color={employee.color} size={30} />
                <strong>{employee.name}</strong>
                <SupportEmployeeTag context={supportContextForEmployeeDate(employee, date)} />
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
            <Input value={scheduleShiftDurationLabel(shiftForm)} readOnly />
          </Field>
        </div>
        <InfoNote>Ca được tạo một lần và dùng lại cho mọi ngày phân lịch. Hệ thống lưu bản chụp thời gian để việc sửa ca không làm sai lịch sử cũ.</InfoNote>
      </Modal>}
    </div>
  )
}

export default UnifiedSchedule
