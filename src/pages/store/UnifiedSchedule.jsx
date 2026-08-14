import { useState } from 'react'
import {
  CalendarDays,
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
  TableFooter,
  TableWrap,
} from '../../components/UI'
import { useApp } from '../../state/AppContext'

const localDate = () => {
  const value = new Date()
  const offset = value.getTimezoneOffset() * 60_000
  return new Date(value.getTime() - offset).toISOString().slice(0, 10)
}

const displayDate = (value) => {
  const [year, month, day] = String(value || '').split('-')
  return year && month && day ? `${day}/${month}/${year}` : '—'
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

const blankShift = (date) => ({
  name: '',
  start: '07:00',
  end: '12:00',
  date,
  color: '#07873d',
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
  } = app
  const shiftDefinitions = Array.isArray(app.shiftDefinitions) ? app.shiftDefinitions : []
  const schedule = Array.isArray(app.schedule) ? app.schedule : []
  const allEmployees = Array.isArray(app.employees) ? app.employees : []
  const storeId = activeStore?.id || activeStoreId || session?.storeId || ''
  const employees = allEmployees
    .filter((employee) => (
      employee.unit !== 'office'
      && employee.status !== 'Đã nghỉ việc'
      && (!storeId || String(employee.storeId) === String(storeId))
    ))
    .sort((left, right) => String(left.name || '').localeCompare(String(right.name || ''), 'vi'))

  const [date, setDate] = useState(localDate)
  const [selectedShiftIds, setSelectedShiftIds] = useState([])
  const [selectedEmployeeIds, setSelectedEmployeeIds] = useState([])
  const [employeeQuery, setEmployeeQuery] = useState('')
  const [note, setNote] = useState('')
  const [shiftModalOpen, setShiftModalOpen] = useState(false)
  const [editingShift, setEditingShift] = useState(null)
  const [shiftForm, setShiftForm] = useState(() => blankShift(localDate()))

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

  const resolveScheduledShift = (record, shiftId) => {
    const snapshot = Array.isArray(record.shiftSnapshots)
      ? record.shiftSnapshots.find((item) => String(item.id) === String(shiftId))
      : null
    if (snapshot) return { ...snapshot, snapshot: true }
    const definition = shiftDefinitions.find((item) => String(item.id) === String(shiftId))
    return definition ? { ...definition, snapshot: false } : { id: shiftId, name: 'Ca không còn hoạt động', snapshot: false }
  }

  const totalAssignments = daySchedule.reduce((total, record) => total + (record.shiftIds?.length || 0), 0)
  const totalScheduledMinutes = daySchedule.reduce((total, record) => (
    total + (record.shiftIds || []).reduce((shiftTotal, shiftId) => shiftTotal + shiftMinutes(resolveScheduledShift(record, shiftId)), 0)
  ), 0)

  const changeDate = (event) => {
    const nextDate = event.target.value
    setDate(nextDate)
    setSelectedShiftIds([])
    setShiftForm((current) => editingShift ? current : { ...current, date: nextDate })
  }

  const openCreateShift = () => {
    setEditingShift(null)
    setShiftForm(blankShift(date))
    setShiftModalOpen(true)
  }

  const openEditShift = (shift) => {
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
    setShiftForm(blankShift(date))
  }

  const saveShift = () => {
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
      ? updateShiftDefinition?.(editingShift.id, payload)
      : createShiftDefinition?.(payload)
    if (!result?.ok) {
      notify?.(result?.message || 'Chưa thể lưu ca làm việc.', 'info')
      return
    }
    setDate(payload.date)
    setSelectedShiftIds(result.shift?.id ? [result.shift.id] : [])
    closeShiftModal()
  }

  const removeShift = (shift) => {
    if (!window.confirm(`Ngừng sử dụng ${shift.name} ngày ${displayDate(shift.date)}? Lịch sử đã ghi nhận sẽ được giữ nguyên.`)) return
    const result = deleteShiftDefinition?.(shift.id)
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

  const saveAssignments = () => {
    const result = saveScheduleMultiple?.(selectedEmployeeIds, selectedShiftIds, { date, note, storeId })
    if (!result?.ok) {
      notify?.(result?.message || 'Vui lòng chọn ít nhất một ca và một nhân viên.', 'info')
      return
    }
    setSelectedEmployeeIds([])
    setSelectedShiftIds([])
    setNote('')
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
            <Button icon={Plus} onClick={openCreateShift}>Tạo ca làm việc</Button>
          </>
        )}
      />

      <div className="metric-grid metric-grid--four">
        <MetricCard label="Ca trong ngày" value={dayShifts.length} suffix="ca" icon={Clock3} tone="blue" compact />
        <MetricCard label="Nhân viên đã phân" value={new Set(daySchedule.map((item) => item.employeeId)).size} suffix="người" icon={Users} tone="green" compact />
        <MetricCard label="Tổng lượt ca" value={totalAssignments} suffix="lượt" icon={CalendarDays} tone="purple" compact />
        <MetricCard label="Tổng giờ dự kiến" value={(totalScheduledMinutes / 60).toFixed(1)} suffix="giờ" icon={Clock3} tone="orange" compact />
      </div>

      <div className="chart-grid">
        <Card
          title={`Ca làm việc ngày ${displayDate(date)}`}
          action={<Button variant="outline" icon={Plus} onClick={openCreateShift}>Tạo ca</Button>}
        >
          {dayShifts.length ? (
            <>
              <TableWrap>
                <thead><tr><th>Tên ca</th><th>Thời gian</th><th>Thời lượng</th><th>Phiên bản</th><th>Thao tác</th></tr></thead>
                <tbody>
                  {dayShifts.map((shift) => (
                    <tr key={shift.id}>
                      <td><Badge tone="blue">{shift.name}</Badge></td>
                      <td><strong>{timeLabel(shift.start, shift.end)}</strong></td>
                      <td>{durationLabel(shift)}</td>
                      <td>v{shift.version || 1}</td>
                      <td>
                        <div className="row-actions">
                          <button type="button" onClick={() => openEditShift(shift)} aria-label={`Sửa ${shift.name}`}><Edit3 /></button>
                          <button type="button" className="danger" onClick={() => removeShift(shift)} aria-label={`Xóa ${shift.name}`}><Trash2 /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </TableWrap>
              <InfoNote>Dữ liệu chấm công và lịch cũ dùng bản chụp tên, giờ bắt đầu và giờ kết thúc; sửa ca hôm nay không đổi lịch sử.</InfoNote>
            </>
          ) : (
            <EmptyState title="Chưa có ca trong ngày" description="Tạo ca làm việc trước khi phân lịch cho nhân viên." />
          )}
        </Card>

        <Card title={`Tạo lịch phân ca · ${displayDate(date)}`}>
          <Field label={`1. Chọn ca · Đã chọn ${selectedShiftIds.length}`}>
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
            <strong>2. Chọn nhân viên · Đã chọn {selectedEmployeeIds.length}</strong>
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
          <Field label="3. Ghi chú (tùy chọn)">
            <textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="Ghi chú cho lịch phân ca..." />
          </Field>
          <div className="panel-actions">
            <Button variant="outline" onClick={() => { setSelectedShiftIds([]); setSelectedEmployeeIds([]); setNote('') }}>Làm lại</Button>
            <Button icon={Save} onClick={saveAssignments} disabled={!selectedShiftIds.length || !selectedEmployeeIds.length}>Lưu lịch phân ca</Button>
          </div>
        </Card>
      </div>

      <Card title={`Danh sách lịch phân ca · ${displayDate(date)}`}>
        {daySchedule.length ? (
          <>
            <TableWrap>
              <thead><tr><th>Nhân viên</th><th>Ngày</th><th>Ca và thời gian đã lưu</th><th>Tổng giờ</th><th>Ghi chú</th></tr></thead>
              <tbody>
                {daySchedule.map((record) => {
                  const employee = employees.find((item) => String(item.id) === String(record.employeeId))
                  const assignedShifts = (record.shiftIds || []).map((shiftId) => resolveScheduledShift(record, shiftId))
                  const rowMinutes = assignedShifts.reduce((total, shift) => total + shiftMinutes(shift), 0)
                  return (
                    <tr key={record.id || `${record.employeeId}-${record.date}`}>
                      <td>
                        <div className="person-cell">
                          <Avatar name={employee?.name || record.employeeName || record.employeeId} color={employee?.color} />
                          <span><strong>{employee?.name || record.employeeName || record.employeeId}</strong><small>{employee?.code || record.employeeId}</small></span>
                        </div>
                      </td>
                      <td><strong>{displayDate(record.date)}</strong></td>
                      <td>
                        {assignedShifts.map((shift) => (
                          <span className="table-sub" key={`${record.employeeId}-${shift.id}`}>
                            <strong>{shift.name || shift.id}</strong> · {timeLabel(shift.start, shift.end)} {shift.snapshot && <Badge tone="green">Bản chụp</Badge>}
                          </span>
                        ))}
                      </td>
                      <td><strong>{(rowMinutes / 60).toFixed(1)} giờ</strong></td>
                      <td>{record.note || '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </TableWrap>
            <TableFooter shown={daySchedule.length} total={daySchedule.length} />
          </>
        ) : (
          <EmptyState title="Chưa có lịch phân ca" description="Chọn nhiều ca và nhiều nhân viên ở trên để tạo lịch." />
        )}
      </Card>

      <Modal
        open={shiftModalOpen}
        onClose={closeShiftModal}
        title={editingShift ? `Sửa ${editingShift.name}` : 'Tạo ca làm việc'}
        footer={(
          <>
            <Button variant="outline" onClick={closeShiftModal}>Hủy</Button>
            <Button icon={Save} onClick={saveShift}>{editingShift ? 'Lưu thay đổi' : 'Tạo ca'}</Button>
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
          <Field label="Thời gian bắt đầu" required>
            <Input type="time" value={shiftForm.start} onChange={(event) => setShiftForm({ ...shiftForm, start: event.target.value })} />
          </Field>
          <Field label="Thời gian kết thúc" required>
            <Input type="time" value={shiftForm.end} onChange={(event) => setShiftForm({ ...shiftForm, end: event.target.value })} />
          </Field>
          <Field label="Màu nhận diện">
            <Input type="color" value={shiftForm.color} onChange={(event) => setShiftForm({ ...shiftForm, color: event.target.value })} />
          </Field>
          <Field label="Thời lượng dự kiến">
            <Input value={durationLabel(shiftForm)} readOnly />
          </Field>
        </div>
        <InfoNote>Ca được quản lý độc lập theo ngày. Hệ thống lưu bản chụp thời gian khi phân ca để không làm sai lịch sử.</InfoNote>
      </Modal>
    </div>
  )
}

export default UnifiedSchedule
