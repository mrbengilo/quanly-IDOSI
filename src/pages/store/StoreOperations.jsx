import { useEffect, useRef, useState } from 'react'
import {
  BarChart3,
  Box,
  CalendarDays,
  Check,
  ClipboardCheck,
  Clock3,
  Edit3,
  Eye,
  EyeOff,
  Filter,
  Info,
  Package,
  Plus,
  Save,
  Send,
  Store,
  Trash2,
  UserCheck,
  Users,
  Wallet,
  Weight,
} from 'lucide-react'
import {
  Avatar,
  Badge,
  Button,
  Card,
  DateRange,
  Drawer,
  ExportButton,
  Field,
  FinancialChart,
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
import { AddressAutocomplete } from '../../components/StructuredAddressAutocomplete'
import { IdentityDocumentViewer } from '../../components/IdentityDocumentViewer'
import { cashSeries, shifts } from '../../data'
import { apiGetIdentityImage } from '../../services/idosiApi'
import { useApp } from '../../state/AppContext'
import { formatVietnamTransferDateTime, supportTransferBounds, supportTransferMatchesMoment } from '../../domain/supportTransferTime'
import {
  downloadCsv,
  getEmployeeType,
  getHourlyRate,
  getMonthlySalary,
  getPayBasis,
  money,
  salaryBasisLabel,
  shortDate,
  today,
} from '../../utils'
import { selectTaskShiftForDate, taskShiftOptionsForDate } from './taskScope'
import {
  buildStoreTaskAssignmentPayload,
  canAssignStoreTasks,
  formatTaskDate,
  formatTaskDateTime24,
  storeTaskHistory,
} from './storeTaskAssignments'
import {
  buildStoreEmployeePayload,
  formatStoreMoneyInput,
  isPartTimeEmployee,
  nextStoreEmployeeCode,
  normalizeStoreEmploymentType,
  storeEmployeePrefix,
  validateStoreEmployee,
} from './storeEmployeeForm'
import '../task-assignment.css'

const shiftById = (id) => shifts.find((shift) => shift.id === id)

const EMPLOYEE_STATUSES = ['Đang làm việc', 'Tạm ngưng', 'Đã nghỉ việc']
const EMPLOYMENT_TYPES = ['Full-Time', 'Part-Time']
const IDENTITY_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])
const MAX_IDENTITY_IMAGE_SIZE = 2 * 1024 * 1024
const emptyEmployeeForm = {
  id: '',
  name: '',
  cccd: '',
  phone: '',
  province: '',
  ward: '',
  street: '',
  startDate: today(),
  identityImages: { front: '', back: '' },
  salary: '',
  baseSalary: '',
  standardWorkDays: '26',
  requiredMonthlyHours: '',
  employmentType: 'Full-Time',
  position: 'Nhân viên bán hàng',
  age: '',
  username: '',
  password: '',
  status: 'Đang làm việc',
  storeId: '',
}

const normalizeText = (value = '') => String(value).trim().toLowerCase()
const isPartTime = isPartTimeEmployee
const normalizeEmploymentType = normalizeStoreEmploymentType
const employmentTypeLabel = normalizeStoreEmploymentType
const formatMoneyInput = formatStoreMoneyInput

const activeSupportTransferForStore = (transfers = [], employeeId, storeId, moment = new Date()) => transfers
  .filter((record) => (
    String(record.employeeId || '') === String(employeeId || '')
    && String(record.toStoreId || '') === String(storeId || '')
    && supportTransferMatchesMoment(record, moment)
  ))
  .sort((left, right) => String(right.createdAt || '').localeCompare(String(left.createdAt || '')))[0] || null

const activeSupportTransferFromStore = (transfers = [], employeeId, storeId, moment = new Date()) => transfers
  .filter((record) => (
    String(record.employeeId || '') === String(employeeId || '')
    && String(record.fromStoreId || '') === String(storeId || '')
    && String(record.toStoreId || '') !== String(storeId || '')
    && supportTransferMatchesMoment(record, moment)
  ))
  .sort((left, right) => String(right.createdAt || '').localeCompare(String(left.createdAt || '')))[0] || null

const storeEmployeesForDate = (employees = [], transfers = [], storeId, moment = new Date(), { includeSupportingAway = false } = {}) => employees
  .filter((employee) => String(employee.unit || 'store') === 'store' && !employee.deletedAt)
  .flatMap((employee) => {
    if (String(employee.storeId || '') === String(storeId || '')) {
      const supportingAway = activeSupportTransferFromStore(transfers, employee.id || employee.code, storeId, moment)
      return supportingAway && !includeSupportingAway ? [] : [employee]
    }
    const supportAssignment = activeSupportTransferForStore(
      transfers,
      employee.id || employee.code,
      storeId,
      moment,
    )
    return supportAssignment ? [{
      ...employee,
      homeStoreId: employee.storeId,
      supportStoreId: storeId,
      supportAssignment,
    }] : []
  })

const transferTimeLabel = (record = {}) => {
  const bounds = supportTransferBounds(record)
  if (record.startAt && record.endAt && bounds) {
    return `${formatVietnamTransferDateTime(bounds.startAt)} – ${formatVietnamTransferDateTime(bounds.endAt)}`
  }
  return `${formatTaskDate(record.fromDate)} – ${formatTaskDate(record.toDate)}`
}

const useTransferClock = () => {
  const [moment, setMoment] = useState(() => new Date())
  useEffect(() => {
    const timer = window.setInterval(() => setMoment(new Date()), 1_000)
    return () => window.clearInterval(timer)
  }, [])
  return moment
}

let storeTaskDraftSequence = 0
const newStoreTaskRow = () => ({ id: `store-task-draft-${storeTaskDraftSequence += 1}`, title: '', detail: '' })
const storeTaskStatusTone = (status) => status === 'Hoàn thành' ? 'green' : status === 'Đang thực hiện' ? 'blue' : 'orange'

const readIdentityImage = (file) => new Promise((resolve, reject) => {
  if (!file) return resolve('')
  if (!IDENTITY_IMAGE_TYPES.has(file.type)) return reject(new Error('Ảnh CCCD phải là tệp JPG, PNG hoặc WEBP.'))
  if (file.size > MAX_IDENTITY_IMAGE_SIZE) return reject(new Error('Mỗi ảnh CCCD không được vượt quá 2 MB.'))
  const reader = new FileReader()
  reader.onerror = () => reject(new Error('Không thể đọc tệp ảnh CCCD.'))
  reader.onload = () => resolve(String(reader.result || ''))
  reader.readAsDataURL(file)
})

const useStoreScope = () => {
  const app = useApp()
  const transferClock = useTransferClock()
  const stores = Array.isArray(app.stores) ? app.stores : []
  const storeId = ['employee', 'store_manager'].includes(app.session?.role)
    ? app.session.storeId
    : app.activeStoreId || app.session?.storeId || stores[0]?.id || ''
  const allEmployees = Array.isArray(app.employees) ? app.employees : []
  const supportTransfers = Array.isArray(app.supportTransfers) ? app.supportTransfers : []
  const employees = storeEmployeesForDate(allEmployees, supportTransfers, storeId, transferClock)
  const employeeIds = new Set(employees.map((employee) => String(employee.id)))
  const attendance = (Array.isArray(app.attendance) ? app.attendance : []).filter((record) =>
    record.storeId ? String(record.storeId) === String(storeId) : employeeIds.has(String(record.employeeId)),
  )
  const imports = (Array.isArray(app.imports) ? app.imports : []).filter((record) =>
    String(record.storeId || stores[0]?.id || '') === String(storeId),
  )
  const schedule = (Array.isArray(app.schedule) ? app.schedule : []).filter((record) => employeeIds.has(String(record.employeeId)))
  return {
    ...app,
    stores,
    storeId,
    activeStore: stores.find((store) => String(store.id) === String(storeId)) || stores[0],
    employees,
    allEmployees,
    supportTransfers,
    attendance,
    imports,
    schedule,
  }
}

const employeeAddressParts = (employee = {}) => {
  const nested = typeof employee.address === 'object' && employee.address ? employee.address : {}
  const details = employee.addressDetails || nested
  return {
    province: employee.province || employee.addressProvince || details.province || details.provinceCity || '',
    ward: employee.ward || employee.addressWard || details.ward || '',
    street: employee.street || employee.addressStreet || details.street || (typeof employee.address === 'string' ? employee.address : ''),
  }
}

const employeeAddressLabel = (employee) => {
  const { province, ward, street } = employeeAddressParts(employee)
  return [street, ward, province].filter(Boolean).join(', ') || '—'
}

const employeeType = getEmployeeType
const employeePosition = (employee = {}) => employee.position || employee.role || 'Nhân viên bán hàng'
const employeeSalary = (employee = {}) => getPayBasis(employee) === 'hourly' ? getHourlyRate(employee) : getMonthlySalary(employee)
const employeeSalarySuffix = (employee = {}) => getPayBasis(employee) === 'hourly' ? '/ giờ' : '/ tháng'

const employeeToForm = (employee = {}, storeId = '') => {
  const address = employeeAddressParts(employee)
  const employmentType = normalizeEmploymentType(employeeType(employee))
  return {
    ...emptyEmployeeForm,
    id: employee.id || employee.code || employee.employeeCode || '',
    name: employee.name || employee.employeeName || '',
    cccd: String(employee.cccd || employee.citizenId || ''),
    phone: employee.phone || '',
    province: address.province,
    ward: address.ward,
    street: address.street,
    startDate: String(employee.startDate || employee.joinDate || '').slice(0, 10),
    identityImages: {
      front: employee.identityImages?.front || employee.cccdFrontImage || '',
      back: employee.identityImages?.back || employee.cccdBackImage || '',
    },
    salary: isPartTime(employmentType) ? formatMoneyInput(employeeSalary(employee)) : '',
    baseSalary: isPartTime(employmentType) ? '' : formatMoneyInput(employee.baseSalary || employeeSalary(employee)),
    standardWorkDays: String(employee.standardWorkDays || 26),
    requiredMonthlyHours: String(employee.requiredMonthlyHours || ''),
    employmentType,
    position: employeePosition(employee),
    age: employee.age ?? '',
    username: employee.username || '',
    password: '',
    status: employee.status === 'Tạm nghỉ' ? 'Tạm ngưng' : (employee.status || 'Đang làm việc'),
    storeId: employee.storeId || storeId,
  }
}

const employeeStatusTone = (status) => {
  if (status === 'Đang làm việc') return 'green'
  if (status === 'Đã nghỉ việc') return 'red'
  return 'orange'
}

export function StoreOverview() {
  const { employees, attendance, imports, activeStore } = useStoreScope()
  const totalHours = attendance.reduce((sum, item) => sum + (Number(item.hours) || 0), 0)
  const importTotal = imports.reduce((sum, item) => sum + item.weight * item.price + item.shipping, 0)
  const storeName = activeStore?.name || 'IDOSI'
  const recordedRevenue = attendance.reduce((sum, item) => sum + (Number(item.revenue) || 0), 0)
  const recordedExpense = attendance.reduce((sum, item) => sum + (Number(item.expense) || 0), 0)
  const revenue = recordedRevenue || Number(activeStore?.revenue) || 0
  const expense = recordedExpense || Number(activeStore?.expense) || 0
  const currentDate = shortDate(today())
  return (
    <div className="page">
      <PageHeader title="Tổng quan cửa hàng" subtitle={`Chào buổi sáng! Đây là tình hình hoạt động của ${storeName} hôm nay.`} icon={Store} actions={<DateRange value={currentDate} />} />
      <div className="metric-grid metric-grid--four">
        <MetricCard label="Doanh thu ghi nhận" value={money(revenue)} icon={BarChart3} helper="Theo dữ liệu cửa hàng" tone="green" />
        <MetricCard label="Chi phí ghi nhận" value={money(expense)} icon={Wallet} helper="Theo dữ liệu cửa hàng" tone="orange" />
        <MetricCard label="Nhân viên đang làm" value={`${employees.filter((item) => item.status === 'Đang làm việc').length} người`} icon={Users} helper="3 ca làm việc" tone="teal" />
        <MetricCard label="Tổng giờ đã làm" value={`${totalHours.toFixed(1)} giờ`} icon={Clock3} helper="Dữ liệu chấm công" tone="blue" />
      </div>
      <div className="chart-grid chart-grid--wide">
        <Card title="Doanh thu & lợi nhuận 15 ngày"><FinancialChart data={cashSeries} keys={['revenue', 'profit']} /></Card>
        <Card title="Ca làm việc hôm nay">
          <div className="today-shifts">{shifts.map((shift, index) => <div key={shift.id} style={{ '--shift-color': shift.color }}><span>{shift.name}</span><strong>{shift.time}</strong><small>{[4, 3, 3][index]} nhân viên</small></div>)}</div>
          <InfoNote>Ca 1 đang hoạt động. Dữ liệu doanh thu được cập nhật liên tục.</InfoNote>
        </Card>
      </div>
      <div className="chart-grid">
        <Card title="Nhân viên đang làm việc">
          <div className="people-list">{employees.slice(0, 5).map((employee, index) => <div key={employee.id}><Avatar name={employee.name} color={employee.color} /><span><strong>{employee.name}</strong><small>{employee.shortRole}</small></span><Badge tone={index === 4 ? 'orange' : 'green'}>{index === 4 ? 'Ca 2' : 'Ca 1'}</Badge></div>)}</div>
        </Card>
        <Card title="Nhập hàng gần đây">
          <TableWrap><thead><tr><th>Mặt hàng</th><th>Số lượng</th><th>Khối lượng</th><th>Thành tiền</th></tr></thead><tbody>{imports.slice(0, 5).map((item) => <tr key={item.id}><td><strong>{item.name}</strong></td><td>{item.quantity} {item.unit}</td><td>{item.weight} kg</td><td>{money(item.weight * item.price + item.shipping)}</td></tr>)}</tbody></TableWrap>
          <div className="mini-total"><span>Tổng giá trị nhập</span><strong>{money(importTotal)}</strong></div>
        </Card>
      </div>
    </div>
  )
}

export function StoreShifts() {
  const { employees, schedule, saveSchedule, notify } = useStoreScope()
  const [mode, setMode] = useState('day')
  const [open, setOpen] = useState(false)
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [shiftId, setShiftId] = useState('ca1')
  const [note, setNote] = useState('')
  const [selected, setSelected] = useState([])
  const [shiftFilter, setShiftFilter] = useState('all')
  const [positionFilter, setPositionFilter] = useState('all')
  const visibleEmployees = employees.filter((employee) => positionFilter === 'all' || employeePosition(employee) === positionFilter)
  const selectedDate = new Date(`${date}T00:00:00`)
  const startOfWeek = new Date(selectedDate)
  startOfWeek.setDate(selectedDate.getDate() - ((selectedDate.getDay() + 6) % 7))
  const endOfWeek = new Date(startOfWeek)
  endOfWeek.setDate(startOfWeek.getDate() + 6)
  const visibleSchedule = schedule.filter((item) => {
    const itemDate = item.date ? new Date(`${item.date}T00:00:00`) : null
    const inPeriod = !itemDate || (mode === 'day' ? item.date === date : itemDate >= startOfWeek && itemDate <= endOfWeek)
    return inPeriod && (shiftFilter === 'all' || item.shiftIds?.includes(shiftFilter))
  })
  const positions = [...new Set(employees.map(employeePosition))]
  const totalAssignments = visibleSchedule.reduce((sum, item) => sum + (item.shiftIds?.length || 0), 0)
  const countForShift = (id) => visibleSchedule.filter((item) => item.shiftIds?.includes(id)).length
  const save = () => {
    if (!selected.length) return notify('Vui lòng chọn ít nhất một nhân viên.', 'info')
    saveSchedule(selected, shiftId, { date, note })
    setOpen(false)
    setSelected([])
    setNote('')
  }
  return (
    <div className="page">
      <PageHeader title="Ca làm việc" subtitle="Quản lý và phân ca làm việc cho nhân viên" actions={<><Input icon={CalendarDays} type="date" value={date} onChange={(event) => setDate(event.target.value)} /><Button icon={Plus} onClick={() => setOpen(true)}>Tạo lịch ca</Button><ExportButton onClick={() => downloadCsv('ca-lam-viec.csv', visibleSchedule)} /></>} />
      <div className="shift-summary-grid">
        {shifts.map((shift) => <Card key={shift.id} className={`shift-summary shift-summary--${shift.id}`}><div style={{ borderColor: shift.color }}><span style={{ color: shift.color }}>{shift.name}</span><strong>{shift.time}</strong><small><Users size={18} /> {countForShift(shift.id)} nhân viên</small></div></Card>)}
        <Card className="day-overview"><h3>Tổng quan {mode === 'day' ? `ngày ${date.split('-').reverse().join('/')}` : 'tuần đã chọn'}</h3><div><span><Clock3 />Tổng ca <b>{shifts.filter((shift) => countForShift(shift.id) > 0).length}</b></span><span><Users />Tổng nhân viên <b>{new Set(visibleSchedule.map((item) => item.employeeId)).size}</b></span><span><CalendarDays />Tổng lượt ca <b>{totalAssignments}</b></span></div></Card>
      </div>
      <Card className="schedule-card">
        <div className="tabs"><button className={mode === 'day' ? 'active' : ''} onClick={() => setMode('day')}>Lịch theo ngày</button><button className={mode === 'week' ? 'active' : ''} onClick={() => setMode('week')}>Lịch theo tuần</button></div>
        <div className="card__subheader"><h2>Lịch phân ca {mode === 'day' ? `ngày ${date.split('-').reverse().join('/')}` : 'theo tuần'}</h2><div><Select value={shiftFilter} onChange={(event) => setShiftFilter(event.target.value)}><option value="all">Tất cả ca</option>{shifts.map((shift) => <option value={shift.id} key={shift.id}>{shift.name}</option>)}</Select><Select value={positionFilter} onChange={(event) => setPositionFilter(event.target.value)}><option value="all">Tất cả vị trí</option>{positions.map((position) => <option key={position}>{position}</option>)}</Select><Button variant="outline" icon={Filter} onClick={() => { setShiftFilter('all'); setPositionFilter('all') }}>Đặt lại</Button></div></div>
        <ScheduleTable employees={visibleEmployees} schedule={visibleSchedule} />
      </Card>
      <div className="bottom-info-grid">
        <Card title="Ghi chú"><ul className="plain-list"><li>Nhân viên có thể làm 1 đến 3 ca trong một ngày.</li><li>Mỗi ca có thể có nhiều nhân viên cùng làm việc.</li><li>Nhấp vào ca để xem chi tiết hoặc chỉnh sửa.</li></ul></Card>
        <Card title="Thông tin ca làm việc"><div className="shift-info-row">{shifts.map((shift) => <div key={shift.id} style={{ borderColor: shift.color }}><strong style={{ color: shift.color }}>{shift.name}</strong><span>{shift.time}</span><small>5 giờ</small></div>)}</div></Card>
        <Card title="Thống kê lượt ca trong ngày"><div className="shift-bars">{shifts.map((shift, index) => <p key={shift.id}><span>{shift.name}: {[12, 13, 7][index]} lượt</span><i><b style={{ width: `${[37.5, 40.6, 21.9][index]}%`, background: shift.color }} /></i></p>)}</div></Card>
      </div>
      <Modal open={open} onClose={() => setOpen(false)} title="Tạo lịch ca" footer={<><Button variant="outline" onClick={() => setOpen(false)}>Hủy</Button><Button icon={Save} onClick={save} disabled={!selected.length}>Lưu lịch ca</Button></>}>
        <div className="form-grid"><Field label="Ngày áp dụng"><Input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></Field><Field label="Ca làm"><Select value={shiftId} onChange={(event) => setShiftId(event.target.value)}>{shifts.map((shift) => <option key={shift.id} value={shift.id}>{shift.name} • {shift.time}</option>)}</Select></Field><Field label={`Nhân viên • Đã chọn ${selected.length}`} className="span-2"><div className="employee-picker">{employees.map((employee) => <label key={employee.id} className={selected.includes(employee.id) ? 'selected' : ''}><input type="checkbox" checked={selected.includes(employee.id)} onChange={() => setSelected((current) => current.includes(employee.id) ? current.filter((id) => id !== employee.id) : [...current, employee.id])} /><Avatar name={employee.name} color={employee.color} size={30} /><strong>{employee.name}</strong><small>{employee.shortRole}</small></label>)}</div></Field><Field label="Ghi chú" className="span-2"><textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="Nhập ghi chú..." /></Field></div>
      </Modal>
    </div>
  )
}

function ScheduleTable({ employees, schedule }) {
  return (
    <TableWrap className="schedule-table">
      <thead><tr><th>Nhân viên</th>{shifts.map((shift) => <th key={shift.id} style={{ color: shift.color }}>{shift.name} <small>({shift.time})</small></th>)}</tr></thead>
      <tbody>{employees.map((employee) => {
        const item = schedule.find((row) => row.employeeId === employee.id)
        return <tr key={employee.id}><td><div className="person-cell"><Avatar name={employee.name} color={employee.color} /><span><strong>{employee.name}</strong><small>{employee.shortRole}</small></span></div></td>{shifts.map((shift) => <td key={shift.id}>{item?.shiftIds?.includes(shift.id) ? <span className={`shift-chip shift-chip--${shift.id}`}><Clock3 />{shift.name} • {shift.time}</span> : '–'}</td>)}</tr>
      })}</tbody>
    </TableWrap>
  )
}

export function StoreSchedule() {
  const { employees, schedule, saveSchedule } = useStoreScope()
  const [open, setOpen] = useState(true)
  const [shiftId, setShiftId] = useState('ca1')
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [note, setNote] = useState('')
  const [employeeQuery, setEmployeeQuery] = useState('')
  const [selected, setSelected] = useState(() => employees.slice(0, 3).map((employee) => employee.id))
  const toggle = (id) => setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])
  const visibleEmployees = employees.filter((employee) => `${employee.id} ${employee.name} ${employee.shortRole}`.toLowerCase().includes(employeeQuery.toLowerCase()))
  const visibleSchedule = schedule.filter((item) => !item.date || item.date === date)
  const countForShift = (id) => visibleSchedule.filter((item) => item.shiftIds?.includes(id)).length
  const totalAssignments = visibleSchedule.reduce((sum, item) => sum + (item.shiftIds?.length || 0), 0)
  const save = () => {
    if (!selected.length) return
    saveSchedule(selected, shiftId, { date, note })
    setNote('')
    setOpen(false)
  }
  return (
    <div className="page">
      <PageHeader title="Lịch phân ca" subtitle="Tạo và quản lý lịch phân công ca làm việc cho nhân viên" actions={<><Input icon={CalendarDays} type="date" value={date} onChange={(event) => setDate(event.target.value)} /><Button icon={Plus} onClick={() => setOpen(true)}>Tạo ca</Button></>} />
      <div className="schedule-summary">{shifts.map((shift) => <Card key={shift.id} className={`schedule-summary__item schedule-summary__item--${shift.id}`}><Clock3 style={{ color: shift.color }} /><div><span>{shift.name}</span><strong>{shift.time}</strong><small>{countForShift(shift.id)} nhân viên</small></div></Card>)}<Card className="schedule-day-stats"><h3>Tổng quan ngày {date.split('-').reverse().join('/')}</h3><div><span>Tổng ca<b>{shifts.filter((shift) => countForShift(shift.id) > 0).length}</b></span><span>Nhân viên<b>{new Set(visibleSchedule.map((item) => item.employeeId)).size}</b></span><span>Ca trống<b>{shifts.filter((shift) => countForShift(shift.id) === 0).length}</b></span><span>Tổng giờ<b>{totalAssignments * 5}</b></span></div></Card></div>
      <div className={`schedule-builder ${open ? 'schedule-builder--open' : ''}`}>
        <Card title="Danh sách lịch phân ca" className="schedule-builder__table"><ScheduleTable employees={employees} schedule={visibleSchedule} /><TableFooter shown={employees.length} total={employees.length} /></Card>
        {open && <Card className="schedule-panel">
          <div className="card__header"><h2>Tạo lịch phân ca</h2><button onClick={() => setOpen(false)}>×</button></div>
          <Field label="1. Chọn ngày"><Input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></Field>
          <Field label="2. Chọn ca & thời gian"><div className="shift-selector">{shifts.map((shift) => <button key={shift.id} className={shiftId === shift.id ? 'active' : ''} style={{ '--shift-color': shift.color }} onClick={() => setShiftId(shift.id)}>{shift.name}{shiftId === shift.id && <Check />}</button>)}</div></Field>
          <div className="time-row"><Input type="time" value={shiftById(shiftId).start} readOnly /><span>–</span><Input type="time" value={shiftById(shiftId).end} readOnly /></div>
          <Field label={`3. Chọn nhân viên • Đã chọn: ${selected.length}`}><SearchInput value={employeeQuery} onChange={setEmployeeQuery} placeholder="Tìm kiếm nhân viên..." /></Field>
          <div className="employee-picker">{visibleEmployees.map((employee) => <label key={employee.id} className={selected.includes(employee.id) ? 'selected' : ''}><input type="checkbox" checked={selected.includes(employee.id)} onChange={() => toggle(employee.id)} /><Avatar name={employee.name} color={employee.color} size={30} /><strong>{employee.name}</strong><small>{employee.shortRole}</small></label>)}</div>
          <Field label="4. Ghi chú (tùy chọn)"><textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="Nhập ghi chú..." /></Field>
          <div className="panel-actions"><Button variant="outline" onClick={() => setOpen(false)}>Hủy</Button><Button onClick={save} disabled={!date || !selected.length}>Lưu lịch ca</Button></div>
        </Card>}
      </div>
    </div>
  )
}

export function StoreEmployees() {
  const app = useApp()
  const transferClock = useTransferClock()
  const employees = Array.isArray(app.employees) ? app.employees : []
  const supportTransfers = Array.isArray(app.supportTransfers) ? app.supportTransfers : []
  const stores = Array.isArray(app.stores) ? app.stores : []
  const { addEmployee, updateEmployee, deleteEmployee, notify, session, activeStoreId } = app
  const scopedStoreId = session?.role === 'employee'
    ? session.storeId
    : activeStoreId || session?.storeId || stores[0]?.id || ''
  const scopedStore = stores.find((store) => String(store.id) === String(scopedStoreId)) || stores[0]
  const createEmployeeForm = () => ({
    ...emptyEmployeeForm,
    identityImages: { ...emptyEmployeeForm.identityImages },
    id: nextStoreEmployeeCode(scopedStore, employees),
    storeId: scopedStoreId,
  })
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('all')
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(createEmployeeForm)
  const [errors, setErrors] = useState([])
  const [showPassword, setShowPassword] = useState(false)
  const [imageBusy, setImageBusy] = useState('')
  const [viewingImage, setViewingImage] = useState(null)
  const [viewingSide, setViewingSide] = useState('')
  const canManageStore = ['admin', 'business_support', 'manager', 'store_manager'].includes(session?.role)
  const canCreateStoreEmployee = ['admin', 'business_support', 'manager', 'store_manager'].includes(session?.role)
  const isBusinessSupport = ['business_support', 'manager'].includes(session?.role)
  const canDeleteEmployee = session?.role === 'admin'
  const editingRequiresPassword = Boolean(editing) && !(
    editing.authUserId || editing.authVersion || editing.passwordHash || editing.legacyPassword
  )

  useEffect(() => {
    const url = viewingImage?.url
    return () => {
      if (url?.startsWith('blob:')) URL.revokeObjectURL(url)
    }
  }, [viewingImage?.url])

  const scopedEmployees = scopedStoreId
    ? storeEmployeesForDate(employees, supportTransfers, scopedStoreId, transferClock, { includeSupportingAway: true })
    : employees.filter((employee) => String(employee.unit || 'store') === 'store')
  const canEditEmployee = (employee) => (
    canManageStore
    && (session?.role !== 'store_manager' || !employee.supportAssignment)
    && !activeSupportTransferFromStore(supportTransfers, employee.id || employee.code, scopedStoreId, transferClock)
  )

  const normalizedQuery = normalizeText(query)
  const filtered = scopedEmployees.filter((employee) => {
    const haystack = [
      employee.id,
      employee.name,
      employee.cccd,
      employee.phone,
      employee.username,
      employeePosition(employee),
      employeeType(employee),
      employeeAddressLabel(employee),
    ].join(' ').toLowerCase()
    const employeeStatus = employee.status === 'Tạm nghỉ' ? 'Tạm ngưng' : employee.status
    return (!normalizedQuery || haystack.includes(normalizedQuery)) && (status === 'all' || employeeStatus === status)
  })

  const openCreate = () => {
    if (!canCreateStoreEmployee) return
    setEditing(null)
    setErrors([])
    setShowPassword(false)
    setImageBusy('')
    setForm(createEmployeeForm())
    setOpen(true)
  }

  const openEdit = (employee) => {
    if (!canManageStore) return
    setEditing(employee)
    setErrors([])
    setShowPassword(false)
    setImageBusy('')
    setForm(employeeToForm(employee, scopedStoreId))
    setOpen(true)
  }

  const closeDrawer = () => {
    setOpen(false)
    setEditing(null)
    setErrors([])
    setShowPassword(false)
    setImageBusy('')
    setForm(createEmployeeForm())
  }

  const updateField = (field) => (event) => {
    let value = event.target.value
    if (field === 'cccd') value = value.replace(/\D/g, '').slice(0, 12)
    if (field === 'phone') value = value.replace(/\D/g, '').slice(0, 10)
    if (field === 'age') value = value.replace(/\D/g, '').slice(0, 3)
    if (field === 'salary' || field === 'baseSalary') value = formatMoneyInput(value)
    if (field === 'standardWorkDays') value = value.replace(/\D/g, '').slice(0, 2)
    if (field === 'requiredMonthlyHours') value = value.replace(/[^\d.]/g, '').slice(0, 6)
    setForm((current) => ({ ...current, [field]: value }))
  }

  const updateIdentityImage = (side) => async (event) => {
    const file = event.target.files?.[0]
    if (!file) return
    setImageBusy(side)
    try {
      const value = await readIdentityImage(file)
      setForm((current) => ({
        ...current,
        identityImages: { ...current.identityImages, [side]: value },
      }))
      setErrors((current) => current.filter((error) => !error.includes(side === 'front' ? 'mặt trước CCCD' : 'mặt sau CCCD')))
    } catch (error) {
      notify?.(error.message, 'info')
    } finally {
      setImageBusy('')
      event.target.value = ''
    }
  }

  const viewSavedIdentityImage = async (side, employee = editing) => {
    if (!employee) return
    const employeeId = employee.id || employee.code || employee.employeeCode
    const busyKey = `${employeeId}:${side}`
    const storedImage = employee.identityImages?.[side]
      || (side === 'front' ? employee.cccdFrontImage : employee.cccdBackImage)
    if (typeof storedImage === 'string' && storedImage.startsWith('data:image/')) {
      setViewingImage({
        url: storedImage,
        label: `${employee.name || employeeId} · ${side === 'front' ? 'Mặt trước CCCD' : 'Mặt sau CCCD'}`,
      })
      return
    }
    if (!employeeId || viewingSide) return
    setViewingSide(busyKey)
    try {
      const blob = await apiGetIdentityImage(employeeId, side)
      setViewingImage({
        url: URL.createObjectURL(blob),
        label: `${employee.name || employeeId} · ${side === 'front' ? 'Mặt trước CCCD' : 'Mặt sau CCCD'}`,
      })
    } catch (error) {
      notify?.(error.message || 'Không thể tải ảnh CCCD.', 'info')
    } finally {
      setViewingSide('')
    }
  }

  const updateEmploymentType = (event) => {
    const employmentType = event.target.value
    setForm((current) => ({ ...current, employmentType, salary: '', baseSalary: '' }))
    setErrors([])
  }

  const save = async (event) => {
    event?.preventDefault()
    if (editing ? !canManageStore : !canCreateStoreEmployee) return
    const editingId = editing?.id || editing?.code || ''
    const scopedForm = { ...form, storeId: scopedStoreId }
    const validationErrors = validateStoreEmployee(
      scopedForm,
      employees,
      editingId,
      !editing || editingRequiresPassword,
      { requireIdentityImages: !editing },
    )
    if (validationErrors.length) {
      setErrors(validationErrors)
      notify?.('Vui lòng kiểm tra lại thông tin nhân viên.', 'info')
      return
    }

    const payload = buildStoreEmployeePayload(form, {
      storeId: scopedStoreId,
      store: scopedStore,
    })

    if (editing) {
      if (typeof updateEmployee !== 'function') return notify?.('Chức năng cập nhật nhân viên đang được kết nối.', 'info')
      const result = await updateEmployee(editingId, payload)
      if (!result?.ok) return notify?.(result?.message || 'Không thể cập nhật nhân viên.', 'info')
    } else {
      if (typeof addEmployee !== 'function') return notify?.('Chức năng thêm nhân viên đang được kết nối.', 'info')
      const result = await addEmployee(payload)
      if (!result?.ok) return notify?.(result?.message || 'Không thể thêm nhân viên.', 'info')
    }
    closeDrawer()
  }

  const activeCount = scopedEmployees.filter((item) => item.status === 'Đang làm việc').length
  const pausedCount = scopedEmployees.filter((item) => item.status === 'Tạm ngưng' || item.status === 'Tạm nghỉ').length
  const stoppedCount = scopedEmployees.filter((item) => item.status === 'Đã nghỉ việc').length
  return (
    <div className="page">
      <PageHeader title="Quản lý nhân viên" subtitle={canManageStore ? 'Thêm, sửa và quản lý hồ sơ nhân viên theo cửa hàng.' : isBusinessSupport ? 'Thêm mới và xem danh sách nhân viên theo cửa hàng.' : 'Danh sách nhân viên theo cửa hàng — chế độ chỉ xem.'} actions={<><SearchInput value={query} onChange={setQuery} placeholder="Tìm mã, tên, CCCD..." />{canCreateStoreEmployee && <Button icon={Plus} onClick={openCreate}>Thêm nhân viên</Button>}</>} />
      {!canManageStore && <InfoNote>Chế độ chỉ xem. Tài khoản này không thể thay đổi nhân viên cửa hàng.</InfoNote>}
      <div className="metric-grid metric-grid--four">
        <MetricCard label="Tổng nhân viên" value={scopedEmployees.length} helper="Thuộc cửa hàng đang chọn" icon={Users} tone="green" compact />
        <MetricCard label="Đang làm việc" value={activeCount} helper="Theo trạng thái" icon={UserCheck} tone="green" compact />
        <MetricCard label="Tạm ngưng" value={pausedCount} helper="Theo trạng thái" icon={Clock3} tone="orange" compact />
        <MetricCard label="Đã nghỉ việc" value={stoppedCount} helper="Theo trạng thái" icon={Users} tone="red" compact />
      </div>
      <div className="filter-pills"><button className={status === 'all' ? 'active' : ''} onClick={() => setStatus('all')}>Tất cả ({scopedEmployees.length})</button>{EMPLOYEE_STATUSES.map((item) => <button key={item} className={status === item ? 'active' : ''} onClick={() => setStatus(item)}>{item}</button>)}</div>
      <Card>
        <TableWrap>
          <thead><tr><th>Mã nhân viên</th><th>Nhân viên</th><th>Phân bổ</th><th>Loại</th><th>Vị trí</th><th>CCCD</th><th>Liên hệ</th><th>Địa chỉ</th><th>Lương</th><th>Tài khoản</th><th>Trạng thái</th>{canManageStore && <th>Thao tác</th>}</tr></thead>
          <tbody>
            {filtered.map((employee) => {
              const normalizedStatus = employee.status === 'Tạm nghỉ' ? 'Tạm ngưng' : (employee.status || 'Đang làm việc')
              const type = employeeType(employee)
              const outboundTransfer = activeSupportTransferFromStore(supportTransfers, employee.id || employee.code, scopedStoreId, transferClock)
              const supportStore = outboundTransfer
                ? stores.find((store) => String(store.id) === String(outboundTransfer.toStoreId))
                : null
              return <tr key={employee.id} className={outboundTransfer ? 'employee-row--supporting-away' : ''}>
                <td><strong>{employee.id}</strong></td>
                <td><div className="person-cell"><Avatar name={employee.name} color={employee.color} /><span><strong>{employee.name}</strong><small>{employee.age ? `${employee.age} tuổi` : 'Chưa cập nhật tuổi'}</small></span></div></td>
                <td>{employee.supportAssignment ? <div className="table-stack"><Badge tone="orange">Nhân viên hỗ trợ</Badge><small>{stores.find((store) => String(store.id) === String(employee.supportAssignment.fromStoreId || employee.homeStoreId))?.name || employee.supportAssignment.fromStoreId || employee.homeStoreId} → {scopedStore?.name || scopedStoreId}</small><small>{transferTimeLabel(employee.supportAssignment)}</small><small>{money(employee.supportAssignment.hourlySupportRate || 0)}/giờ · Phụ cấp {money(employee.supportAssignment.allowance || 0)}</small><small>Trạng thái: {employee.supportAssignment.status || 'Đã lưu'}</small></div> : outboundTransfer ? <div className="table-stack"><Badge tone="orange">Đang hỗ trợ {supportStore?.name || outboundTransfer.toStoreId}</Badge><small>{transferTimeLabel(outboundTransfer)}</small><small>{money(outboundTransfer.hourlySupportRate || 0)}/giờ · Phụ cấp {money(outboundTransfer.allowance || 0)}</small><small>Hồ sơ tạm khóa thao tác tại cửa hàng chính</small></div> : <><Badge tone="blue">Cửa hàng chính</Badge><small className="table-sub">{scopedStore?.name || scopedStoreId}</small></>}</td>
                <td><Badge tone={isPartTime(type) ? 'green' : 'blue'}>{employmentTypeLabel(type)}</Badge></td>
                <td>{employeePosition(employee)}</td>
                <td>
                  <span>{employee.cccd || employee.citizenId || '—'}</span>
                  {canManageStore && <div className="identity-image-actions identity-image-actions--stable">
                    {employee.identityImages?.front || employee.cccdFrontImage ? <button type="button" onClick={() => viewSavedIdentityImage('front', employee)} disabled={Boolean(viewingSide)} aria-label={`Xem mặt trước CCCD của ${employee.name}`}><Eye size={16} /><span>Trước</span></button> : null}
                    {employee.identityImages?.back || employee.cccdBackImage ? <button type="button" onClick={() => viewSavedIdentityImage('back', employee)} disabled={Boolean(viewingSide)} aria-label={`Xem mặt sau CCCD của ${employee.name}`}><Eye size={16} /><span>Sau</span></button> : null}
                  </div>}
                </td>
                <td>{employee.phone || '—'}</td>
                <td className="address-cell">{employeeAddressLabel(employee)}</td>
                <td>{employeeSalary(employee) > 0 ? <><strong>{money(employeeSalary(employee))}</strong><small className="table-sub">{employeeSalarySuffix(employee)} · {salaryBasisLabel(employee)}</small>{!isPartTime(type) && <small className="table-sub">{employee.standardWorkDays || 26} ngày · {employee.requiredMonthlyHours || '—'} giờ/tháng</small>}</> : <span className="orange-text">Chưa thiết lập</span>}</td>
                <td>{employee.username || '—'}</td>
                <td>{outboundTransfer ? <Badge tone="orange">Đang hỗ trợ</Badge> : <Badge tone={employeeStatusTone(normalizedStatus)}>{normalizedStatus}</Badge>}</td>
                {canManageStore && <td>{canEditEmployee(employee) ? <div className="row-actions"><button onClick={() => openEdit(employee)} aria-label={`Sửa ${employee.name}`}><Edit3 /></button>{canDeleteEmployee && <button className="danger" onClick={() => window.confirm(`Xóa ${employee.name}?`) && deleteEmployee?.(employee.id)} aria-label={`Xóa ${employee.name}`}><Trash2 /></button>}</div> : <Badge tone="blue">Chỉ xem</Badge>}</td>}
              </tr>
            })}
            {!filtered.length && <tr><td colSpan={canManageStore ? 12 : 11}>Không có nhân viên phù hợp.</td></tr>}
          </tbody>
        </TableWrap>
        <TableFooter shown={filtered.length} total={filtered.length} />
      </Card>
      {canCreateStoreEmployee && <Modal wide open={open} onClose={closeDrawer} title={editing ? 'Cập nhật nhân viên' : 'Thêm nhân viên'} footer={<><Button type="button" variant="outline" onClick={closeDrawer} disabled={Boolean(imageBusy)}>Hủy bỏ</Button><Button type="button" icon={Save} onClick={save} disabled={Boolean(imageBusy)}>{editing ? 'Lưu thay đổi' : 'Lưu nhân viên'}</Button></>}>
        <form className="form-stack" onSubmit={save}>
          {errors.length > 0 && <InfoNote tone="orange"><strong>Thông tin chưa hợp lệ</strong><ul>{errors.map((error) => <li key={error}>{error}</li>)}</ul></InfoNote>}
          <h3>Thông tin nhân viên</h3>
          <div className="form-grid">
            <Field label="Mã nhân viên" required hint="Hệ thống phát sinh tự động theo mã viết tắt của cửa hàng"><Input value={form.id} readOnly aria-readonly="true" /></Field>
            <Field label="Tên nhân viên" required><Input value={form.name} onChange={updateField('name')} placeholder="Nhập họ và tên" /></Field>
            <Field label="Số CCCD" required hint="Chỉ gồm đúng 12 chữ số"><Input inputMode="numeric" maxLength={12} value={form.cccd} onChange={updateField('cccd')} placeholder="012345678901" /></Field>
            <Field label="Số điện thoại" required hint="Đủ 10 số và bắt đầu bằng số 0"><Input type="tel" inputMode="numeric" maxLength={10} pattern="0[0-9]{9}" value={form.phone} onChange={updateField('phone')} placeholder="0901234567" /></Field>
            <Field label="Ngày bắt đầu làm" required hint="Hiển thị theo định dạng dd/mm/yy"><Input icon={CalendarDays} type="date" value={form.startDate} onChange={updateField('startDate')} /></Field>
            <Field label="Loại nhân viên" required hint="Full-Time dùng định mức ngày, giờ và lương cơ bản; Part-Time hưởng lương theo giờ"><Select value={form.employmentType} onChange={updateEmploymentType}>{EMPLOYMENT_TYPES.map((type) => <option key={type} value={type}>{employmentTypeLabel(type)}</option>)}</Select></Field>
            {isPartTime(form.employmentType)
              ? <Field label="Lương mặc định theo giờ (đ/giờ)" required hint="Dùng để tính lương theo tổng giờ chấm công"><Input inputMode="numeric" value={form.salary} onChange={updateField('salary')} placeholder="30,000" /></Field>
              : <>
                  <Field label="Số ngày công quy định/tháng" required hint="Từ 1 đến 31 ngày"><Input type="number" inputMode="numeric" min="1" max="31" step="1" value={form.standardWorkDays} onChange={updateField('standardWorkDays')} placeholder="26" /></Field>
                  <Field label="Tổng giờ làm quy định/tháng" required hint="Dùng làm mẫu số tính lương theo giờ thực tế"><Input type="number" inputMode="decimal" min="0.01" max="744" step="0.01" value={form.requiredMonthlyHours} onChange={updateField('requiredMonthlyHours')} placeholder="208" /></Field>
                  <Field label="Lương cơ bản (đ/tháng)" required hint={storeEmployeePrefix(scopedStore) === 'SM234' ? 'SecondMall: giờ thực tế ÷ giờ quy định × lương cơ bản' : 'Mức lương cơ bản của kỳ lương tháng'}><Input inputMode="numeric" value={form.baseSalary} onChange={updateField('baseSalary')} placeholder="8,000,000" /></Field>
                </>}
            <Field label="Tuổi" required><Input inputMode="numeric" min="16" max="100" value={form.age} onChange={updateField('age')} placeholder="Ví dụ: 22" /></Field>
            <Field label="Vị trí công việc" required hint={isBusinessSupport && !editing ? 'Mặc định cho nhân viên do Hỗ trợ KD tạo' : undefined}>{isBusinessSupport && !editing
              ? <Input value="Nhân viên bán hàng" readOnly aria-readonly="true" />
              : <Select value={form.position} onChange={updateField('position')}><option>Nhân viên bán hàng</option><option>Nhân viên thu ngân</option><option>Nhân viên kho</option><option>Trưởng ca</option><option>Khác</option></Select>}</Field>
          </div>
          <h3>Địa chỉ</h3>
          <AddressAutocomplete
            value={{ province: form.province, ward: form.ward, street: form.street }}
            onChange={(address) => setForm((current) => ({ ...current, ...address }))}
          />
          <h3>Hình ảnh CCCD</h3>
          <div className="form-grid identity-image-grid">
            {['front', 'back'].map((side) => {
              const label = side === 'front' ? 'Mặt trước CCCD' : 'Mặt sau CCCD'
              const image = form.identityImages?.[side]
              const preview = typeof image === 'string' && image.startsWith('data:image/') ? image : ''
              return <Field key={side} label={label} required={!editing} hint="JPG, PNG hoặc WEBP; tối đa 2 MB">
                <Input type="file" accept="image/jpeg,image/png,image/webp" aria-label={label} onChange={updateIdentityImage(side)} disabled={Boolean(imageBusy)} />
                {image && <small>{preview ? 'Đã chọn ảnh mới' : 'Ảnh đã được lưu riêng tư'}</small>}
                {preview && <img className="identity-image-preview" src={preview} alt={`Xem trước ${label.toLocaleLowerCase('vi-VN')}`} />}
                {image && !preview && editing && <Button type="button" variant="outline" icon={Eye} loading={viewingSide === `${editing.id || editing.code || editing.employeeCode}:${side}`} disabled={Boolean(viewingSide)} onClick={() => viewSavedIdentityImage(side)}>Xem ảnh đã lưu</Button>}
              </Field>
            })}
          </div>
          {imageBusy && <InfoNote>Đang đọc ảnh {imageBusy === 'front' ? 'mặt trước' : 'mặt sau'} CCCD…</InfoNote>}
          <h3>Tài khoản đăng nhập</h3>
          <div className="form-grid">
             <Field label="Tên đăng nhập" required><Input autoComplete="username" value={form.username} onChange={updateField('username')} placeholder="Ví dụ: nguyenvana" /></Field>
             <Field label="Mật khẩu" required={!editing || editingRequiresPassword} hint={editing && !editingRequiresPassword ? 'Để trống nếu không muốn đổi mật khẩu' : 'Người tạo tự nhập mật khẩu để cấp tài khoản đăng nhập'}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                 <Input type={showPassword ? 'text' : 'password'} autoComplete="new-password" value={form.password} onChange={updateField('password')} placeholder={editing ? 'Nhập mật khẩu mới nếu cần' : 'Nhập mật khẩu'} />
                <button type="button" className="icon-button" onClick={() => setShowPassword((visible) => !visible)} aria-label={showPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'} title={showPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}>
                  {showPassword ? <EyeOff size={19} /> : <Eye size={19} />}
                </button>
              </div>
            </Field>
          </div>
          <InfoNote>Ảnh CCCD được lưu trong vùng riêng tư. Hệ thống không lưu hoặc hiển thị lại mật khẩu sau khi đóng thông báo cấp tài khoản.</InfoNote>
        </form>
      </Modal>}
      <Modal wide open={Boolean(viewingImage)} onClose={() => setViewingImage(null)} title={viewingImage?.label || 'Ảnh CCCD'} footer={<Button variant="outline" onClick={() => setViewingImage(null)}>Đóng</Button>}>
        <IdentityDocumentViewer src={viewingImage?.url || ''} alt={viewingImage?.label || 'Ảnh CCCD'} />
      </Modal>
    </div>
  )
}

export function StoreTasks() {
  const {
    activeStore,
    storeId,
    allEmployees = [],
    supportTransfers = [],
    tasks = [],
    taskAssignmentHistory = [],
    shiftDefinitions = [],
    replaceTasks,
    notify,
    session,
  } = useStoreScope()
  const canManageStore = canAssignStoreTasks(session?.role)
  const initialDate = today()
  const optionsForDate = (nextDate) => taskShiftOptionsForDate({
    shiftDefinitions,
    fallbackShifts: shifts,
    storeId,
    date: nextDate,
  })
  const [date, setDate] = useState(initialDate)
  const shiftOptions = optionsForDate(date)
  const [shiftId, setShiftId] = useState(() => selectTaskShiftForDate({
    tasks,
    storeId,
    date: initialDate,
    shiftOptions: optionsForDate(initialDate),
  }))
  const [selectedEmployeeIds, setSelectedEmployeeIds] = useState([])
  const [rows, setRows] = useState(() => [newStoreTaskRow()])
  const [busy, setBusy] = useState(false)
  const assignmentRequestRef = useRef({ fingerprint: '', idempotencyKey: '' })
  const employees = storeEmployeesForDate(allEmployees, supportTransfers, storeId, date)
  const assignableEmployees = employees.filter((employee) => (
    !employee.deletedAt && String(employee.status || '').toLocaleLowerCase('vi-VN') !== 'đã nghỉ việc'
  ))
  const assignableEmployeeIds = new Set(assignableEmployees.map((employee) => String(employee.id || employee.code || employee.employeeCode || '')))
  const selectedIds = selectedEmployeeIds.filter((id) => assignableEmployeeIds.has(String(id)))
  const selectedIdSet = new Set(selectedIds.map(String))
  const history = storeTaskHistory({ taskAssignmentHistory, tasks, storeId, employees, shiftDefinitions })
  const reusableTasks = [...new Map(history.flatMap((assignment) => assignment.tasks || []).flatMap((task) => {
    const title = String(task.title || '').trim()
    return title ? [[title.toLocaleLowerCase('vi-VN'), { title }]] : []
  })).entries()].map(([key, task]) => ({ key, ...task }))

  const changeShift = (nextShiftId) => {
    if (!shiftOptions.some((shift) => String(shift.id) === String(nextShiftId))) return
    setShiftId(nextShiftId)
  }
  const changeDate = (nextDate) => {
    const nextShiftOptions = optionsForDate(nextDate)
    const nextShiftId = selectTaskShiftForDate({ tasks, storeId, date: nextDate, shiftOptions: nextShiftOptions })
    setDate(nextDate)
    setShiftId(nextShiftId)
  }
  const updateRow = (index, key, value) => setRows((current) => current.map((item, rowIndex) => rowIndex === index ? { ...item, [key]: value } : item))
  const removeRow = (index) => setRows((current) => current.length > 1 ? current.filter((_, rowIndex) => rowIndex !== index) : current)
  const toggleReusableTask = (template) => setRows((current) => {
    const index = current.findIndex((row) => String(row.templateKey || '') === template.key)
    if (index >= 0) return current.filter((_, rowIndex) => rowIndex !== index)
    const withoutEmptyStarter = current.length === 1 && !current[0].title && !current[0].detail ? [] : current
    return [...withoutEmptyStarter, { ...newStoreTaskRow(), title: template.title, detail: '', templateKey: template.key }]
  })
  const toggleEmployee = (id) => setSelectedEmployeeIds((current) => current.some((item) => String(item) === String(id))
    ? current.filter((item) => String(item) !== String(id))
    : [...current, String(id)])
  const send = async () => {
    if (!canManageStore) return
    if (!date || !shiftId) return notify?.('Vui lòng chọn ngày và ca làm việc.', 'info')
    if (!shiftOptions.some((shift) => String(shift.id) === String(shiftId))) {
      return notify?.('Ca làm việc không hợp lệ cho ngày đã chọn. Vui lòng chọn lại ca.', 'info')
    }
    if (!selectedIds.length) return notify?.('Vui lòng chọn ít nhất một nhân viên nhận việc.', 'info')
    if (rows.some((item) => !String(item.title || '').trim())) return notify?.('Mỗi công việc cần có tên.', 'info')
    if (typeof replaceTasks !== 'function') return notify?.('Chức năng giao việc chưa sẵn sàng.', 'info')

    const payload = buildStoreTaskAssignmentPayload({ storeId, date, shiftId, employeeIds: selectedIds, tasks: rows })
    const requestFingerprint = JSON.stringify(payload)
    if (assignmentRequestRef.current.fingerprint !== requestFingerprint) {
      assignmentRequestRef.current = {
        fingerprint: requestFingerprint,
        idempotencyKey: `tasks:${crypto.randomUUID()}`,
      }
    }
    setBusy(true)
    try {
      const result = await replaceTasks({ ...payload, idempotencyKey: assignmentRequestRef.current.idempotencyKey })
      if (result?.ok === false) return notify?.(result.message || 'Chưa thể gửi danh sách công việc.', 'info')
      assignmentRequestRef.current = { fingerprint: '', idempotencyKey: '' }
      setRows([newStoreTaskRow()])
      setSelectedEmployeeIds([])
    } catch (error) {
      notify?.(error.message || 'Chưa thể gửi danh sách công việc.', 'info')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="page admin-task-page">
      <PageHeader title="Giao việc" subtitle={canManageStore ? `Tạo danh sách công việc theo ca tại ${activeStore?.name || 'cửa hàng đang chọn'}.` : `Xem danh sách công việc theo ca tại ${activeStore?.name || 'cửa hàng đang chọn'}.`} icon={ClipboardCheck} />
      {!canManageStore && <InfoNote>Chế độ chỉ xem. Chỉ Admin, Quản lý cửa hàng và Nhân viên hỗ trợ KD được giao việc.</InfoNote>}
      <Card className="task-toolbar-card">
        <div className="task-toolbar-grid">
          <Field label="Ngày giao việc" required><Input icon={CalendarDays} type="date" value={date} onChange={(event) => changeDate(event.target.value)} /></Field>
          <Field label="Ca làm việc" required>
            <Select value={shiftId} onChange={(event) => changeShift(event.target.value)} disabled={!shiftOptions.length}>
              {!shiftOptions.length && <option value="">Chưa có ca hợp lệ cho ngày này</option>}
              {shiftOptions.map((shift) => <option key={shift.id} value={shift.id}>{shift.name} ({shift.start || '--:--'}–{shift.end || '--:--'})</option>)}
            </Select>
          </Field>
          <Field label="Cửa hàng"><Input icon={Store} value={activeStore?.name || storeId} readOnly /></Field>
          {canManageStore && <Field label="Nhân viên đã chọn"><Input icon={Users} value={`${selectedIds.length} nhân viên`} readOnly /></Field>}
        </div>
      </Card>
      {canManageStore && <Card title="Chọn nhân viên nhận việc">
        <div className="employee-picker" role="group" aria-label="Chọn nhân viên nhận việc">
          {assignableEmployees.map((employee) => {
            const id = String(employee.id || employee.code || employee.employeeCode || '')
            const selected = selectedIdSet.has(id)
            return <label key={id} className={selected ? 'selected' : ''}>
              <input type="checkbox" checked={selected} onChange={() => toggleEmployee(id)} aria-label={`Chọn nhân viên ${employee.name || id}`} />
              <Avatar name={employee.name || id} color={employee.color} />
              <span><strong>{employee.name || id}</strong><small>{id} · {employee.position || employee.role || 'Nhân viên cửa hàng'}</small></span>
              <Badge tone={getEmployeeType(employee) === 'Full-Time' ? 'blue' : 'green'}>{getEmployeeType(employee)}</Badge>
            </label>
          })}
          {!assignableEmployees.length && <InfoNote>Cửa hàng chưa có nhân viên đang làm việc để giao việc.</InfoNote>}
        </div>
        {assignableEmployees.length > 0 && <div className="panel-actions">
          <Button variant="outline" onClick={() => setSelectedEmployeeIds(assignableEmployees.map((employee) => String(employee.id || employee.code || employee.employeeCode || '')))}>Chọn tất cả</Button>
          <Button variant="outline" onClick={() => setSelectedEmployeeIds([])} disabled={!selectedIds.length}>Bỏ chọn</Button>
        </div>}
      </Card>}
      {canManageStore && <div className="split-layout split-layout--tasks">
        <Card title="Danh sách công việc" className="task-editor task-assignment-editor">
          {reusableTasks.length > 0 && <>
            <InfoNote>Tick các công việc đã nhập sẵn cần giao trong lần này. Có thể bổ sung công việc mới bên dưới.</InfoNote>
            <div className="employee-picker task-template-picker" role="group" aria-label="Công việc nhập sẵn">
              {reusableTasks.map((template) => {
                const checked = rows.some((row) => row.templateKey === template.key)
                return <label key={template.key} className={checked ? 'selected' : ''}><input type="checkbox" checked={checked} onChange={() => toggleReusableTask(template)} /><span><strong>{template.title}</strong></span></label>
              })}
            </div>
          </>}
          <div className="task-editor__head"><span>STT</span><span>Tên công việc</span><span /></div>
          {rows.map((item, index) => (
            <div className="task-editor__row" key={item.id}>
              <b>{index + 1}</b>
              <input value={item.title} maxLength={240} onChange={(event) => updateRow(index, 'title', event.target.value)} placeholder="Nhập tên công việc" aria-label={`Tên công việc ${index + 1}`} />
              <button type="button" onClick={() => removeRow(index)} disabled={rows.length === 1} aria-label={`Xóa công việc ${index + 1}`}><Trash2 size={18} /></button>
            </div>
          ))}
          <button type="button" className="add-row" onClick={() => setRows((current) => [...current, newStoreTaskRow()])}><Plus size={18} /> Thêm công việc</button>
          <div className="support-work-actions"><Button icon={Send} loading={busy} disabled={busy} onClick={send}>GỬI</Button></div>
        </Card>
        <Card className="guide-card">
          <h2><Info size={22} /> Giao việc theo cửa hàng</h2>
          <ol><li>Chọn ngày, kể cả ngày trong tương lai.</li><li>Chọn ca và một hoặc nhiều nhân viên cửa hàng.</li><li>Nhập danh sách công việc rồi nhấn “Gửi”.</li></ol>
          <InfoNote><strong>Không phụ thuộc chấm công</strong><br />Có thể giao trước khi nhân viên điểm danh hoặc bắt đầu ca.</InfoNote>
        </Card>
      </div>}
      <Card title="Lịch sử giao việc">
        <TableWrap><thead><tr><th>Người giao / Thời gian</th><th>Ngày / Ca</th><th>Nhân viên nhận</th><th>Nội dung công việc</th><th>Trạng thái / Hoàn thành</th></tr></thead>
          <tbody>{history.map((assignment) => <tr key={assignment.id}>
            <td><strong>{assignment.assignedBy}</strong><span className="table-sub">{formatTaskDateTime24(assignment.assignedAt)}</span></td>
            <td><strong>{formatTaskDate(assignment.date)}</strong><span className="table-sub">{assignment.shiftName}{assignment.shiftTime ? ` · ${assignment.shiftTime}` : ''}</span></td>
            <td><strong>{assignment.employeeNames.join(', ') || 'Toàn bộ nhân viên trong ca'}</strong><span className="table-sub">{assignment.employeeIds.join(', ') || 'Dữ liệu cũ chưa ghi người nhận'}</span></td>
            <td><ol className="compact-task-list">{assignment.tasks.map((task, index) => <li key={task.id || `${assignment.id}-${index}`}><strong>{index + 1}. {task.title || 'Công việc chưa đặt tên'}</strong><small>{task.status} · {task.completed}/{task.required} nhân viên</small></li>)}</ol></td>
            <td><Badge tone={storeTaskStatusTone(assignment.status)}>{assignment.status}</Badge><span className="table-sub">{assignment.completed}/{assignment.required || assignment.tasks.length} lượt hoàn thành</span></td>
          </tr>)}{!history.length && <tr><td colSpan="5">Chưa có lịch sử giao việc tại cửa hàng này.</td></tr>}</tbody>
        </TableWrap>
      </Card>
    </div>
  )
}

export function StoreImports() {
  const { imports, addImport, updateImport, deleteImport, notify } = useStoreScope()
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('all')
  const [period, setPeriod] = useState('all')
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const empty = { name: '', category: 'Thời trang nữ', quantity: 1, unit: 'Bao', weight: '', price: '', shipping: 0, note: '' }
  const [form, setForm] = useState(empty)
  const isInPeriod = (item) => {
    if (period === 'all') return true
    const source = String(item.createdAt || '').match(/(\d{4})-(\d{2})-(\d{2})/)
    if (!source) return true
    const itemDate = new Date(`${source[1]}-${source[2]}-${source[3]}T00:00:00`)
    const now = new Date()
    const elapsedDays = (now - itemDate) / 86400000
    if (period === 'today') return itemDate.toDateString() === now.toDateString()
    if (period === 'week') return elapsedDays >= 0 && elapsedDays < 7
    return itemDate.getMonth() === now.getMonth() && itemDate.getFullYear() === now.getFullYear()
  }
  const filtered = imports.filter((item) => item.name.toLowerCase().includes(query.toLowerCase()) && (category === 'all' || item.category === category) && isInPeriod(item))
  const totalWeight = imports.reduce((sum, item) => sum + Number(item.weight), 0)
  const totalCost = imports.reduce((sum, item) => sum + Number(item.weight) * Number(item.price) + Number(item.shipping), 0)
  const formTotal = Number(form.weight) * Number(form.price) + Number(form.shipping)
  const save = (event) => {
    event.preventDefault()
    if (!form.name || !form.weight || !form.price) return notify('Vui lòng nhập đủ thông tin mặt hàng.', 'info')
    const payload = { ...form, quantity: Number(form.quantity), weight: Number(form.weight), price: Number(form.price), shipping: Number(form.shipping) }
    if (editing) updateImport?.(editing.id, payload)
    else addImport(payload)
    setForm(empty)
    setEditing(null)
    setOpen(false)
  }
  const openEdit = (item) => {
    setEditing(item)
    setForm({ ...empty, ...item })
    setOpen(true)
  }
  return (
    <div className="page">
      <PageHeader title="Nhập hàng" subtitle="Quản lý danh sách mặt hàng nhập kho" actions={<><Button variant="outline" icon={Filter} onClick={() => { setQuery(''); setCategory('all'); setPeriod('all') }}>Đặt lại bộ lọc</Button><Button icon={Plus} onClick={() => { setEditing(null); setForm(empty); setOpen(true) }}>Thêm mặt hàng</Button></>} />
      <div className="metric-grid metric-grid--four">
        <MetricCard label="Tổng mặt hàng" value={imports.length} icon={Package} helper="+5 so với tuần trước" tone="green" compact />
        <MetricCard label="Tổng số lượng" value={imports.reduce((sum, item) => sum + Number(item.quantity), 0)} suffix="bao" icon={Box} helper="+18 bao" tone="blue" compact />
        <MetricCard label="Tổng cân nặng" value={totalWeight.toFixed(1)} suffix="kg" icon={Weight} helper="+125.3 kg" tone="purple" compact />
        <MetricCard label="Tổng chi phí nhập" value={money(totalCost)} icon={Wallet} helper="+12.450.000đ" tone="orange" compact />
      </div>
      <Card>
        <div className="card__subheader"><SearchInput value={query} onChange={setQuery} placeholder="Tìm kiếm mặt hàng..." /><Select value={category} onChange={(event) => setCategory(event.target.value)}><option value="all">Tất cả danh mục</option><option>Thời trang nữ</option><option>Thời trang nam</option><option>Đồ mặc nhà</option><option>Phụ kiện</option></Select></div>
        <TableWrap><thead><tr><th>STT</th><th>Tên mặt hàng</th><th>Số lượng</th><th>Đơn vị</th><th>Cân nặng</th><th>Đơn giá nhập</th><th>Phí vận chuyển</th><th>Thành tiền</th><th>Hành động</th></tr></thead><tbody>{filtered.map((item, index) => <tr key={item.id}><td>{index + 1}</td><td><div className="product-cell"><span>{['👗', '👔', '🥻', '👚', '👜'][index % 5]}</span><strong>{item.name}</strong></div></td><td><Badge>{item.quantity}</Badge></td><td>{item.unit}</td><td>{item.weight} kg</td><td>{money(item.price)}/kg</td><td>{money(item.shipping)}</td><td><strong>{money(item.weight * item.price + item.shipping)}</strong></td><td><div className="row-actions"><button onClick={() => openEdit(item)} aria-label={`Sửa ${item.name}`}><Edit3 /></button><button className="danger" onClick={() => window.confirm(`Xóa ${item.name}?`) && deleteImport(item.id)} aria-label={`Xóa ${item.name}`}><Trash2 /></button></div></td></tr>)}</tbody></TableWrap>
        <TableFooter shown={filtered.length} total={filtered.length} />
      </Card>
      <Card title="Lịch sử nhập hàng" action={<div className="filter-pills compact">{[['all', 'Tất cả'], ['today', 'Hôm nay'], ['week', 'Tuần này'], ['month', 'Tháng này']].map(([value, label]) => <button key={value} className={period === value ? 'active' : ''} onClick={() => setPeriod(value)}>{label}</button>)}</div>}>
        <TableWrap><thead><tr><th>Ngày nhập</th><th>Mặt hàng</th><th>Số lượng</th><th>Cân nặng</th><th>Đơn giá</th><th>Phí VC</th><th>Thành tiền</th><th>Người nhập</th><th>Thao tác</th></tr></thead><tbody>{filtered.map((item) => <tr key={item.id}><td>{item.createdAt}</td><td>{item.name}</td><td>{item.quantity}</td><td>{item.weight}</td><td>{money(item.price)}</td><td>{money(item.shipping)}</td><td><strong>{money(item.weight * item.price + item.shipping)}</strong></td><td>{item.creator}</td><td><Eye size={16} /></td></tr>)}</tbody></TableWrap>
      </Card>
      <Drawer open={open} onClose={() => setOpen(false)} title={editing ? 'Cập nhật mặt hàng' : 'Thêm mặt hàng'} footer={<><Button variant="outline" onClick={() => setOpen(false)}>Hủy</Button><Button icon={Save} onClick={save}>{editing ? 'Lưu thay đổi' : 'Lưu mặt hàng'}</Button></>}>
        <form className="form-stack" onSubmit={save}>
          <Field label="Tên mặt hàng" required><Input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Nhập tên mặt hàng" /></Field>
          <div className="form-grid"><Field label="Số lượng (bao)" required><Input type="number" min="1" value={form.quantity} onChange={(event) => setForm({ ...form, quantity: event.target.value })} /></Field><Field label="Đơn vị"><Select value={form.unit} onChange={(event) => setForm({ ...form, unit: event.target.value })}><option>Bao</option><option>Kiện</option><option>Thùng</option></Select></Field></div>
          <Field label="Danh mục"><Select value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })}><option>Thời trang nữ</option><option>Thời trang nam</option><option>Đồ mặc nhà</option><option>Phụ kiện</option></Select></Field>
          <Field label="Cân nặng (kg)" required><Input type="number" value={form.weight} onChange={(event) => setForm({ ...form, weight: event.target.value })} placeholder="Nhập cân nặng" /></Field>
          <Field label="Đơn giá nhập (đ/kg)" required><Input type="number" value={form.price} onChange={(event) => setForm({ ...form, price: event.target.value })} placeholder="Nhập đơn giá nhập" /></Field>
          <Field label="Phí vận chuyển (đ)"><Input type="number" value={form.shipping} onChange={(event) => setForm({ ...form, shipping: event.target.value })} /></Field>
          <div className="calculated-total"><span>Thành tiền</span><strong>{money(formTotal)}</strong><small>= Cân nặng × Đơn giá nhập + Phí vận chuyển</small></div>
          <Field label="Ghi chú (tùy chọn)"><textarea value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} placeholder="Nhập ghi chú..." /></Field>
          <InfoNote><strong>Mẹo</strong><br />Đơn giá nhập là giá của 1kg. Thành tiền được tính tự động.</InfoNote>
        </form>
      </Drawer>
    </div>
  )
}
