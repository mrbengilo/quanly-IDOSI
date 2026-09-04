import { useMemo, useState } from 'react'
import { CalendarClock, ChevronLeft, ChevronRight, History } from 'lucide-react'
import { Avatar, Badge, Button, Card, InfoNote, Input, PageHeader, Select, TableWrap } from '../../components/UI'
import {
  shiftSupportScheduleAnchor,
  supportScheduleDays,
  supportScheduleEmploymentMode,
  supportScheduleRange,
  supportSchedulesForView,
} from '../../domain/supportWorkSchedule'
import { useApp } from '../../state/AppContext'
import { shortDate, shortDateTime24 } from '../../utils'

const today = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' })
const employeeId = (employee = {}) => String(employee.id || employee.code || employee.employeeId || '')
const employeeUnit = (employee = {}) => {
  const unit = String(employee.unit || employee.unitType || employee.department || '').toLowerCase()
  if (['business_support', 'business-support', 'support'].includes(unit) || String(employee.storeId || '') === 'BUSINESS_SUPPORT') return 'business_support'
  if (unit === 'office' || String(employee.storeId || '') === 'OFFICE' || employee.isOffice === true) return 'office'
  return unit
}
const inactiveEmployee = (employee = {}) => {
  const status = String(employee.status || '').normalize('NFD').replace(/[\u0300-\u036f]/gu, '').toLowerCase()
  return Boolean(employee.deletedAt || ['da nghi viec', 'inactive'].includes(status))
}

const WORK_REGISTRATION_GROUPS = Object.freeze([
  { value: 'business_support', label: 'Hỗ trợ kinh doanh (HTKD)' },
  { value: 'office', label: 'Khối văn phòng (KVP)' },
])

const calendarDayLabel = (date) => new Intl.DateTimeFormat('vi-VN', {
  weekday: 'short', day: '2-digit', month: '2-digit', timeZone: 'UTC',
}).format(new Date(`${date}T00:00:00Z`))

const uniqueEmployees = (employees = []) => {
  const byId = new Map()
  employees.forEach((employee) => {
    const id = employeeId(employee)
    if (id && !byId.has(id)) byId.set(id, employee)
  })
  return [...byId.values()]
}

function RegistrationGroup({ days, employees, group, records }) {
  const recordsByEmployeeDate = useMemo(() => new Map(records.map((record) => (
    [`${record.employeeId}:${record.date}`, record]
  ))), [records])

  return <Card
    className="work-registration-group"
    title={group.label}
    action={<Badge tone={group.value === 'business_support' ? 'green' : 'blue'}>{employees.length} nhân viên</Badge>}
  >
    <TableWrap
      className="my-work-schedule-scroll work-registration-scroll"
      tableClassName="my-work-schedule-grid work-registration-grid"
      tableLabel={`Lịch đăng ký làm việc của ${group.label}`}
      paginationKey={`${group.value}:${employees.map(employeeId).join('|')}`}
      data-testid={`work-registration-${group.value}`}
    >
        <thead><tr><th className="my-work-schedule-grid__employee">Nhân viên</th>{days.map((date) => <th key={date}>{calendarDayLabel(date)}</th>)}</tr></thead>
        <tbody>
          {employees.map((employee) => {
            const id = employeeId(employee)
            return <tr key={id}>
              <th scope="row" className="my-work-schedule-grid__employee">
                <span className="my-work-schedule-employee">
                  <Avatar name={employee.name || id} src={employee.avatar} employeeId={id} color={employee.color} size={44} />
                  <span>
                    <strong>{employee.name || employee.employeeName || id}</strong>
                    <small>{id}</small>
                    <Badge tone={supportScheduleEmploymentMode(employee) === 'shift' ? 'orange' : 'blue'}>{employee.employmentType || employee.workTimeType || 'Full-Time'}</Badge>
                  </span>
                </span>
              </th>
              {days.map((date) => {
                const record = recordsByEmployeeDate.get(`${id}:${date}`)
                return <td key={date}>{record
                  ? <div className="my-work-schedule-shift">
                    <strong>{record.shiftName || 'Làm việc'}</strong>
                    <small>{record.start || '--:--'}–{record.end || '--:--'}</small>
                    <Badge tone="green">{record.status || 'Đã đăng ký'}</Badge>
                    {record.note && <em>{record.note}</em>}
                    {(record.registeredAt || record.createdAt || record.updatedAt) && <small>Đăng ký: {shortDateTime24(record.registeredAt || record.createdAt || record.updatedAt)}</small>}
                  </div>
                  : <span className="my-work-schedule-empty">Không có lịch</span>}
                </td>
              })}
            </tr>
          })}
          {!employees.length && <tr><td colSpan={days.length + 1}><span className="my-work-schedule-empty">Chưa có nhân viên hoặc lịch đăng ký trong nhóm này.</span></td></tr>}
        </tbody>
    </TableWrap>
  </Card>
}

export function AdminWorkRegistrationSchedulePage() {
  const app = useApp()
  const [view, setView] = useState('week')
  const [anchorDate, setAnchorDate] = useState(today)
  const [selectedEmployeeId, setSelectedEmployeeId] = useState('all')
  const profiles = useMemo(() => uniqueEmployees([
    ...(Array.isArray(app.employees) ? app.employees : []),
    ...(Array.isArray(app.businessSupportEmployees) ? app.businessSupportEmployees : []),
  ]), [app.businessSupportEmployees, app.employees])
  const profileById = useMemo(() => new Map(profiles.map((employee) => [employeeId(employee), employee])), [profiles])
  const normalizedRecords = useMemo(() => (Array.isArray(app.supportWorkSchedules) ? app.supportWorkSchedules : []).map((record) => ({
    ...record,
    targetUnit: String(record.targetUnit || employeeUnit(profileById.get(String(record.employeeId || '')))).toLowerCase(),
  })), [app.supportWorkSchedules, profileById])
  const employeeFilterOptions = useMemo(() => uniqueEmployees([
    ...profiles,
    ...normalizedRecords.map((record) => ({
      id: record.employeeId,
      name: record.employeeName || record.employeeId,
      unit: record.targetUnit,
      employmentType: record.employmentType,
    })),
  ]).filter((employee) => ['business_support', 'office'].includes(employeeUnit(employee)))
    .sort((left, right) => String(left.name || employeeId(left)).localeCompare(String(right.name || employeeId(right)), 'vi')), [normalizedRecords, profiles])
  const days = useMemo(() => supportScheduleDays(anchorDate, view), [anchorDate, view])
  const range = useMemo(() => supportScheduleRange(anchorDate, view), [anchorDate, view])
  const rangeLabel = range.start === range.end ? shortDate(range.start) : `${shortDate(range.start)} – ${shortDate(range.end)}`

  const groups = useMemo(() => WORK_REGISTRATION_GROUPS.map((group) => {
    const employeeFilter = selectedEmployeeId === 'all' ? undefined : selectedEmployeeId
    const records = supportSchedulesForView(normalizedRecords, { employeeId: employeeFilter, targetUnit: group.value, anchorDate, view })
    const activeProfiles = profiles.filter((employee) => (
      employeeUnit(employee) === group.value
      && !inactiveEmployee(employee)
      && (!employeeFilter || employeeId(employee) === employeeFilter)
    ))
    const employeesById = new Map(activeProfiles.map((employee) => [employeeId(employee), employee]))
    records.forEach((record) => {
      const id = String(record.employeeId || '')
      if (!id || employeesById.has(id)) return
      const profile = profileById.get(id)
      employeesById.set(id, profile || {
        id,
        name: record.employeeName || id,
        employmentType: record.employmentType,
        unit: group.value,
      })
    })
    return {
      group,
      records,
      employees: [...employeesById.values()].sort((left, right) => (
        String(left.name || employeeId(left)).localeCompare(String(right.name || employeeId(right)), 'vi')
      )),
    }
  }), [anchorDate, normalizedRecords, profileById, profiles, selectedEmployeeId, view])

  const move = (direction) => setAnchorDate((current) => shiftSupportScheduleAnchor(current, view, direction) || today())
  const clearFilters = () => {
    setSelectedEmployeeId('all')
    setView('week')
    setAnchorDate(today())
  }

  return <div className="page support-schedule-page work-registration-page">
    <PageHeader
      title="LỊCH ĐĂNG KÝ LÀM VIỆC CỦA HTKD VÀ KVP"
      subtitle="Tổng hợp lịch đăng ký theo ngày, tuần hoặc tháng; dữ liệu chỉ đọc và không thay đổi lịch chấm công."
      icon={CalendarClock}
      actions={<Button type="button" variant="outline" onClick={clearFilters}>Xóa bộ lọc</Button>}
    />
    <Card title="Bộ lọc lịch đăng ký">
      <div className="toolbar-wrap support-schedule-page-actions">
        <Select aria-label="Chọn nhân viên" value={selectedEmployeeId} onChange={(event) => setSelectedEmployeeId(event.target.value)}>
          <option value="all">Tất cả nhân viên</option>
          {employeeFilterOptions.map((employee) => <option key={employeeId(employee)} value={employeeId(employee)}>{employee.name || employeeId(employee)}</option>)}
        </Select>
        <Input aria-label="Ngày tham chiếu lịch đăng ký" type="date" value={anchorDate} onChange={(event) => setAnchorDate(event.target.value)} />
        <Button type="button" variant="outline" onClick={() => setAnchorDate(today())}>Hôm nay</Button>
      </div>
    </Card>
    {app.apiStatus === 'error' && <InfoNote tone="red">Không thể tải lịch đăng ký từ máy chủ. Vui lòng tải lại trang.</InfoNote>}
    {['connecting', 'syncing'].includes(app.apiStatus) && <InfoNote>Đang tải lịch đăng ký...</InfoNote>}
    <div className="tabs support-schedule-tabs" role="tablist" aria-label="Phạm vi lịch đăng ký">
      {[['day', 'Theo ngày'], ['week', 'Theo tuần'], ['month', 'Theo tháng']].map(([key, label]) => <button key={key} type="button" role="tab" aria-selected={view === key} className={view === key ? 'active' : ''} onClick={() => setView(key)}>{label}</button>)}
    </div>
    <Card title={`Phạm vi đang xem · ${rangeLabel}`} action={<div className="support-schedule-navigation"><Button type="button" variant="outline" aria-label="Xem thời gian trước" onClick={() => move(-1)}><ChevronLeft size={18} /></Button><History size={22} /><Button type="button" variant="outline" aria-label="Xem thời gian tiếp theo" onClick={() => move(1)}><ChevronRight size={18} /></Button></div>}>
      <p className="table-note">Hai nhóm được tách theo đơn vị trên hồ sơ; lịch đã lưu vẫn hiển thị khi hồ sơ không còn hoạt động.</p>
    </Card>
    {groups.map(({ group, records, employees }) => <RegistrationGroup key={group.value} days={days} employees={employees} group={group} records={records} />)}
  </div>
}

export default AdminWorkRegistrationSchedulePage
