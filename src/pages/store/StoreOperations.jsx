import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
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
  Package,
  Plus,
  Save,
  ShieldAlert,
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
  InfoNote,
  Input,
  MoneyInput,
  MetricCard,
  Modal,
  PageHeader,
  SearchInput,
  Select,
  TableFooter,
  TableWrap,
} from '../../components/UI'
import { FinancialChart } from '../../components/Charts'
import { SupportEmployeeTag } from '../../components/SupportEmployeeTag'
import { AddressAutocomplete } from '../../components/StructuredAddressAutocomplete'
import { IdentityDocumentViewer } from '../../components/IdentityDocumentViewer'
import { optimizeIdentityImage } from '../../domain/identityImage'
import { cashSeries, shifts } from '../../data'
import { apiGetIdentityImage } from '../../services/idosiApi'
import { nextSupportTransferBoundaryDelay, useApp } from '../../state/AppContext'
import { UnitCompensationStatistics } from '../compensation/UnitCompensationStatistics'
import { ViolationManagementPage } from '../compensation/ViolationManagementPage'
import { workRewardRows } from '../compensation/compensationStatistics'
import { formatVietnamTransferDateTime, supportTransferBounds, supportTransferMatchesMoment } from '../../domain/supportTransferTime'
import {
  downloadCsv,
  getEmployeeType,
  getHourlyRate,
  money,
  operationalIdentifierEntry,
  operationalIdentifierRecordMatch,
  shortDate,
  today,
} from '../../utils'
import {
  defaultStoreFullTimeSalaryPolicy,
  effectiveStoreSalaryConfig,
  STORE_SALARY_CONFIG_IDENTIFIER_COLLISION,
} from '../../domain/storeTieredPayroll'
import {
  activeWorkCatalogItems,
  WORK_CATALOG_KIND,
  WORK_CATALOG_TARGET,
} from '../../domain/workCatalog'
import { formatTaskDate, formatTaskDateTime24 } from './storeTaskAssignments'
import {
  buildStoreEmployeePayload,
  formatStoreMoneyInput,
  isHourlyStoreEmployee,
  nextStoreEmployeeCode,
  normalizeStoreEmploymentType,
  validateStoreEmployee,
} from './storeEmployeeForm'
import '../task-assignment.css'

const identifierMatch = (records, reference, identifiersOf = (record) => [record?.id]) => {
  const match = operationalIdentifierRecordMatch(records, reference, identifiersOf)
  return match.ambiguous ? null : match.record
}
const employeeIdentifiers = (employee = {}) => [employee.id, employee.code, employee.employeeId]
const employeeFor = (employees, reference) => identifierMatch(employees, reference, employeeIdentifiers)
const storeFor = (stores, reference) => identifierMatch(stores, reference, (store) => [store.id])
const shiftById = (id) => identifierMatch(shifts, id, (shift) => [shift.id])
const shiftHours = (shift) => {
  const [startHour, startMinute] = String(shift?.start || '').split(':').map(Number)
  const [endHour, endMinute] = String(shift?.end || '').split(':').map(Number)
  if (![startHour, startMinute, endHour, endMinute].every(Number.isFinite)) return 0
  const start = startHour * 60 + startMinute
  let end = endHour * 60 + endMinute
  if (end < start) end += 24 * 60
  return Math.max(0, end - start) / 60
}

const EMPLOYEE_STATUSES = ['Đang làm việc', 'Tạm ngưng', 'Đã nghỉ việc']
const EMPLOYMENT_TYPES = ['Full-Time', 'Part-Time', 'Thử Việc']
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
  employeeSource: 'new',
  linkedEmployeeId: '',
}

const normalizeText = (value = '') => String(value).trim().toLowerCase()
const isHourlyEmployee = isHourlyStoreEmployee
const normalizeEmploymentType = normalizeStoreEmploymentType
const employmentTypeLabel = normalizeStoreEmploymentType
const formatMoneyInput = formatStoreMoneyInput

const activeSupportTransferForStore = (transfers = [], employees = [], stores = [], employee, store, moment = new Date()) => transfers
  .filter((record) => (
    employeeFor(employees, record.employeeId) === employee
    && storeFor(stores, record.toStoreId) === store
    && supportTransferMatchesMoment(record, moment)
  ))
  .sort((left, right) => String(right.createdAt || '').localeCompare(String(left.createdAt || '')))[0] || null

const activeSupportTransferFromStore = (transfers = [], employees = [], stores = [], employee, store, moment = new Date()) => transfers
  .filter((record) => (
    employeeFor(employees, record.employeeId) === employee
    && storeFor(stores, record.fromStoreId) === store
    && Boolean(storeFor(stores, record.toStoreId))
    && storeFor(stores, record.toStoreId) !== store
    && supportTransferMatchesMoment(record, moment)
  ))
  .sort((left, right) => String(right.createdAt || '').localeCompare(String(left.createdAt || '')))[0] || null

// Pure resolver is exported for store-isolation regression coverage.
// eslint-disable-next-line react-refresh/only-export-components
export const storeEmployeesForDate = (employees = [], transfers = [], stores = [], storeId, moment = new Date(), { includeSupportingAway = false } = {}) => {
  const store = storeFor(stores, storeId)
  if (!store) return []
  return employees
  .filter((employee) => String(employee.unit || 'store') === 'store' && !employee.deletedAt)
  .flatMap((employee) => {
    if (storeFor(stores, employee.storeId) === store) {
      const supportingAway = activeSupportTransferFromStore(transfers, employees, stores, employee, store, moment)
      return supportingAway && !includeSupportingAway ? [] : [employee]
    }
    const supportAssignment = activeSupportTransferForStore(
      transfers,
      employees,
      stores,
      employee,
      store,
      moment,
    )
    return supportAssignment ? [{
      ...employee,
      homeStoreId: employee.storeId,
      supportStoreId: store.id,
      supportAssignment,
    }] : []
  })
}

const transferTimeLabel = (record = {}) => {
  const bounds = supportTransferBounds(record)
  if (record.startAt && record.endAt && bounds) {
    return `${formatVietnamTransferDateTime(bounds.startAt)} – ${formatVietnamTransferDateTime(bounds.endAt)}`
  }
  return `${formatTaskDate(record.fromDate)} – ${formatTaskDate(record.toDate)}`
}

const useTransferClock = (transfers = []) => {
  const [moment, setMoment] = useState(() => new Date())
  useEffect(() => {
    let active = true
    let timer = null
    const scheduleNextBoundary = () => {
      const delay = nextSupportTransferBoundaryDelay(transfers, Date.now())
      if (delay == null) return
      timer = window.setTimeout(() => {
        if (!active) return
        setMoment(new Date())
        scheduleNextBoundary()
      }, Math.min(delay, 2_147_000_000))
    }
    scheduleNextBoundary()
    return () => {
      active = false
      if (timer != null) window.clearTimeout(timer)
    }
  }, [transfers])
  return moment
}

const readIdentityImage = async (file) => file ? (await optimizeIdentityImage(file)).dataUrl : ''

const useStoreScope = () => {
  const app = useApp()
  const stores = Array.isArray(app.stores) ? app.stores : []
  const requestedStoreId = ['employee', 'store_manager'].includes(app.session?.role)
    ? app.session.storeId
    : app.activeStoreId || app.session?.storeId || stores[0]?.id || ''
  const activeStore = storeFor(stores, requestedStoreId)
  const storeId = String(activeStore?.id || '')
  const allEmployees = Array.isArray(app.employees) ? app.employees : []
  const supportTransfers = Array.isArray(app.supportTransfers) ? app.supportTransfers : []
  const transferClock = useTransferClock(supportTransfers)
  const employees = storeEmployeesForDate(allEmployees, supportTransfers, stores, storeId, transferClock)
  const attendance = activeStore ? (Array.isArray(app.attendance) ? app.attendance : []).filter((record) => (
    record.storeId ? storeFor(stores, record.storeId) === activeStore : Boolean(employeeFor(employees, record.employeeId))
  )) : []
  const imports = activeStore ? (Array.isArray(app.imports) ? app.imports : []).filter((record) => (
    storeFor(stores, record.storeId || storeId) === activeStore
  )) : []
  const schedule = (Array.isArray(app.schedule) ? app.schedule : []).filter((record) => Boolean(employeeFor(employees, record.employeeId)))
  return {
    ...app,
    stores,
    storeId,
    activeStore,
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
    salary: isHourlyEmployee(employmentType) ? formatMoneyInput(getHourlyRate(employee)) : '',
    baseSalary: '',
    standardWorkDays: '',
    requiredMonthlyHours: '',
    employmentType,
    position: employeePosition(employee),
    age: employee.age ?? '',
    username: employee.username || '',
    password: '',
    status: employee.status === 'Tạm nghỉ' ? 'Tạm ngưng' : (employee.status || 'Đang làm việc'),
    storeId: employee.storeId || storeId,
  }
}

const fullTimeSalaryPolicyFor = ({ configs, employee, store, period }) => {
  try {
    const employeeId = employee.id || employee.code || employee.employeeId
    const configured = effectiveStoreSalaryConfig(configs, {
      employeeId,
      storeId: store?.id,
      period,
      store,
      canonicalOwnerAliases: true,
    })
    return {
      policy: configured || defaultStoreFullTimeSalaryPolicy(store),
      configured: Boolean(configured),
    }
  } catch (error) {
    if (error?.code === STORE_SALARY_CONFIG_IDENTIFIER_COLLISION) {
      return { policy: null, configured: false, collision: true }
    }
    return null
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
          <div className="people-list">{employees.slice(0, 5).map((employee, index) => <div key={employee.id}><Avatar name={employee.name} src={employee.avatar} employeeId={employee.id || employee.code} color={employee.color} /><span><strong>{employee.name}</strong><small>{employee.shortRole}</small></span><Badge tone={index === 4 ? 'orange' : 'green'}>{index === 4 ? 'Ca 2' : 'Ca 1'}</Badge></div>)}</div>
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
    return inPeriod && (shiftFilter === 'all' || item.shiftIds?.some((id) => shiftById(id) === shiftById(shiftFilter)))
  })
  const positions = [...new Set(employees.map(employeePosition))]
  const totalAssignments = visibleSchedule.reduce((sum, item) => sum + (item.shiftIds?.length || 0), 0)
  const countForShift = (id) => visibleSchedule.filter((item) => item.shiftIds?.some((candidate) => shiftById(candidate) === shiftById(id))).length
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
        <Card className="day-overview"><h3>Tổng quan {mode === 'day' ? `ngày ${date.split('-').reverse().join('/')}` : 'tuần đã chọn'}</h3><div><span><Clock3 />Tổng ca <b>{shifts.filter((shift) => countForShift(shift.id) > 0).length}</b></span><span><Users />Tổng nhân viên <b>{new Set(visibleSchedule.map((item) => employeeFor(employees, item.employeeId)?.id).filter(Boolean)).size}</b></span><span><CalendarDays />Tổng lượt ca <b>{totalAssignments}</b></span></div></Card>
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
        <div className="form-grid"><Field label="Ngày áp dụng"><Input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></Field><Field label="Ca làm"><Select value={shiftId} onChange={(event) => setShiftId(event.target.value)}>{shifts.map((shift) => <option key={shift.id} value={shift.id}>{shift.name} • {shift.time}</option>)}</Select></Field><Field label={`Nhân viên • Đã chọn ${selected.length}`} className="span-2"><div className="employee-picker">{employees.map((employee) => <label key={employee.id} className={selected.includes(employee.id) ? 'selected' : ''}><input type="checkbox" checked={selected.includes(employee.id)} onChange={() => setSelected((current) => current.includes(employee.id) ? current.filter((id) => id !== employee.id) : [...current, employee.id])} /><Avatar name={employee.name} src={employee.avatar} employeeId={employee.id || employee.code} color={employee.color} size={30} /><strong>{employee.name}</strong><small>{employee.shortRole}</small></label>)}</div></Field><Field label="Ghi chú" className="span-2"><textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="Nhập ghi chú..." /></Field></div>
      </Modal>
    </div>
  )
}

function ScheduleTable({ employees, schedule }) {
  return (
    <TableWrap className="schedule-table">
      <thead><tr><th>Nhân viên</th>{shifts.map((shift) => <th key={shift.id} style={{ color: shift.color }}>{shift.name} <small>({shift.time})</small></th>)}</tr></thead>
      <tbody>{employees.map((employee) => {
        const item = schedule.find((row) => employeeFor(employees, row.employeeId) === employee)
        return <tr key={employee.id}><td><div className="person-cell"><Avatar name={employee.name} src={employee.avatar} employeeId={employee.id || employee.code} color={employee.color} /><span><strong>{employee.name}</strong><small>{employee.shortRole}</small></span></div></td>{shifts.map((shift) => <td key={shift.id}>{item?.shiftIds?.some((id) => shiftById(id) === shift) ? <span className={`shift-chip shift-chip--${shift.id}`}><Clock3 />{shift.name} • {shift.time}</span> : '–'}</td>)}</tr>
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
  const countForShift = (id) => visibleSchedule.filter((item) => item.shiftIds?.some((candidate) => shiftById(candidate) === shiftById(id))).length
  const totalScheduledHours = visibleSchedule.reduce((total, item) => total + (item.shiftIds || [])
    .reduce((hours, id) => hours + shiftHours(shiftById(id)), 0), 0)
  const save = () => {
    if (!selected.length) return
    saveSchedule(selected, shiftId, { date, note })
    setNote('')
    setOpen(false)
  }
  return (
    <div className="page">
      <PageHeader title="Lịch phân ca" subtitle="Tạo và quản lý lịch phân công ca làm việc cho nhân viên" actions={<><Input icon={CalendarDays} type="date" value={date} onChange={(event) => setDate(event.target.value)} /><Button icon={Plus} onClick={() => setOpen(true)}>Tạo ca</Button></>} />
      <div className="schedule-summary">{shifts.map((shift) => <Card key={shift.id} className={`schedule-summary__item schedule-summary__item--${shift.id}`}><Clock3 style={{ color: shift.color }} /><div><span>{shift.name}</span><strong>{shift.time}</strong><small>{countForShift(shift.id)} nhân viên</small></div></Card>)}<Card className="schedule-day-stats"><h3>Tổng quan ngày {date.split('-').reverse().join('/')}</h3><div><span>Tổng ca<b>{shifts.filter((shift) => countForShift(shift.id) > 0).length}</b></span><span>Nhân viên<b>{new Set(visibleSchedule.map((item) => employeeFor(employees, item.employeeId)?.id).filter(Boolean)).size}</b></span><span>Ca trống<b>{shifts.filter((shift) => countForShift(shift.id) === 0).length}</b></span><span>Tổng giờ<b>{totalScheduledHours.toFixed(2)}</b></span></div></Card></div>
      <div className={`schedule-builder ${open ? 'schedule-builder--open' : ''}`}>
        <Card title="Danh sách lịch phân ca" className="schedule-builder__table"><ScheduleTable employees={employees} schedule={visibleSchedule} /><TableFooter shown={employees.length} total={employees.length} /></Card>
        {open && <Card className="schedule-panel">
          <div className="card__header"><h2>Tạo lịch phân ca</h2><button onClick={() => setOpen(false)}>×</button></div>
          <Field label="1. Chọn ngày"><Input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></Field>
          <Field label="2. Chọn ca & thời gian"><div className="shift-selector">{shifts.map((shift) => <button key={shift.id} className={shiftId === shift.id ? 'active' : ''} style={{ '--shift-color': shift.color }} onClick={() => setShiftId(shift.id)}>{shift.name}{shiftId === shift.id && <Check />}</button>)}</div></Field>
          <div className="time-row"><Input type="time" value={shiftById(shiftId).start} readOnly /><span>–</span><Input type="time" value={shiftById(shiftId).end} readOnly /></div>
          <Field label={`3. Chọn nhân viên • Đã chọn: ${selected.length}`}><SearchInput value={employeeQuery} onChange={setEmployeeQuery} placeholder="Tìm kiếm nhân viên..." /></Field>
          <div className="employee-picker">{visibleEmployees.map((employee) => <label key={employee.id} className={selected.includes(employee.id) ? 'selected' : ''}><input type="checkbox" checked={selected.includes(employee.id)} onChange={() => toggle(employee.id)} /><Avatar name={employee.name} src={employee.avatar} employeeId={employee.id || employee.code} color={employee.color} size={30} /><strong>{employee.name}</strong><small>{employee.shortRole}</small></label>)}</div>
          <Field label="4. Ghi chú (tùy chọn)"><textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="Nhập ghi chú..." /></Field>
          <div className="panel-actions"><Button variant="outline" onClick={() => setOpen(false)}>Hủy</Button><Button onClick={save} disabled={!date || !selected.length}>Lưu lịch ca</Button></div>
        </Card>}
      </div>
    </div>
  )
}

export function StoreEmployees() {
  const app = useApp()
  const employees = Array.isArray(app.employees) ? app.employees : []
  const supportTransfers = Array.isArray(app.supportTransfers) ? app.supportTransfers : []
  const transferClock = useTransferClock(supportTransfers)
  const stores = Array.isArray(app.stores) ? app.stores : []
  const salaryConfigs = Array.isArray(app.storeEmployeeSalaryConfigs) ? app.storeEmployeeSalaryConfigs : []
  const salaryPeriod = today().slice(0, 7)
  const { addEmployee, updateEmployee, deleteEmployee, notify, session, activeStoreId } = app
  const requestedStoreId = session?.role === 'employee'
    ? session.storeId
    : activeStoreId || session?.storeId || stores[0]?.id || ''
  const scopedStore = storeFor(stores, requestedStoreId)
  const scopedStoreId = String(scopedStore?.id || '')
  const linkableProfiles = employees.filter((employee) => {
    const alreadyLinkedHere = employees.some((profile) => (
      String(profile.unit || profile.unitType || '').toLowerCase() === 'store'
      && storeFor(stores, profile.storeId) === scopedStore
      && employeeFor(employees, profile.linkedEmployeeId) === employee
      && !profile.deletedAt
    ))
    return ['business_support', 'office'].includes(String(employee.unit || employee.unitType || '').toLowerCase())
      && !employee.deletedAt
      && !alreadyLinkedHere
  })
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
  const linkingExistingProfile = !editing && ['business_support', 'office'].includes(form.employeeSource)
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
    ? storeEmployeesForDate(employees, supportTransfers, stores, scopedStoreId, transferClock, { includeSupportingAway: true })
    : []
  const canEditEmployee = (employee) => (
    canManageStore
    && (session?.role !== 'store_manager' || !employee.supportAssignment)
    && !activeSupportTransferFromStore(supportTransfers, employees, stores, employee, scopedStore, transferClock)
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

  const updateEmployeeSource = (event) => {
    const employeeSource = event.target.value
    setForm((current) => ({ ...createEmployeeForm(), employeeSource, linkedEmployeeId: '', employmentType: current.employmentType }))
    setErrors([])
  }

  const updateLinkedProfile = (event) => {
    const linkedEmployeeId = event.target.value
    const source = employeeFor(linkableProfiles, linkedEmployeeId)
    setForm((current) => ({
      ...current,
      linkedEmployeeId,
      name: source?.name || '',
      startDate: source?.startDate || source?.joinDate || current.startDate || today(),
      age: source?.age ? String(source.age) : current.age,
      employmentType: 'Part-Time',
      position: 'Nhân viên bán hàng',
    }))
    setErrors([])
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
    setForm((current) => ({
      ...current,
      employmentType,
      salary: '',
      baseSalary: '',
      standardWorkDays: '',
      requiredMonthlyHours: '',
    }))
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
      { requireIdentityImages: !editing, linkedEmployeeId: form.linkedEmployeeId },
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
              const hourlyEmployee = isHourlyEmployee(type)
              const fullTimeSalary = hourlyEmployee ? null : fullTimeSalaryPolicyFor({
                configs: salaryConfigs,
                employee,
                store: scopedStore,
                period: salaryPeriod,
              })
              const outboundTransfer = activeSupportTransferFromStore(supportTransfers, employees, stores, employee, scopedStore, transferClock)
              const supportStore = outboundTransfer
                ? storeFor(stores, outboundTransfer.toStoreId)
                : null
              return <tr key={employee.id} className={outboundTransfer ? 'employee-row--supporting-away' : ''}>
                <td><strong>{employee.id}</strong></td>
                <td><div className="person-cell"><Avatar name={employee.name} src={employee.avatar} employeeId={employee.id || employee.code} color={employee.color} /><span><strong>{employee.name}</strong><SupportEmployeeTag record={{ ...employee, businessDate: today(), supportAssignment: employee.supportAssignment, supportStoreId: scopedStoreId, homeStoreId: employee.homeStoreId || employee.storeId, isSupportEmployee: Boolean(employee.supportAssignment) }} employee={employee} employeeId={employee.id || employee.code} storeId={scopedStoreId} businessDate={today()} employees={employees} stores={stores} supportTransfers={supportTransfers} /><small>{employee.age ? `${employee.age} tuổi` : 'Chưa cập nhật tuổi'}</small></span></div></td>
                <td>{employee.supportAssignment ? <div className="table-stack"><SupportEmployeeTag record={{ ...employee, businessDate: today(), supportAssignment: employee.supportAssignment, supportStoreId: scopedStoreId, homeStoreId: employee.homeStoreId || employee.storeId, isSupportEmployee: true }} employee={employee} employeeId={employee.id || employee.code} storeId={scopedStoreId} businessDate={today()} employees={employees} stores={stores} supportTransfers={supportTransfers} /><small>{storeFor(stores, employee.supportAssignment.fromStoreId || employee.homeStoreId)?.name || employee.supportAssignment.fromStoreId || employee.homeStoreId} → {scopedStore?.name || scopedStoreId}</small><small>{transferTimeLabel(employee.supportAssignment)}</small><small>{money(employee.supportAssignment.hourlySupportRate || 0)}/giờ · Phụ cấp {money(employee.supportAssignment.allowance || 0)}</small><small>Trạng thái: {employee.supportAssignment.status || 'Đã lưu'}</small></div> : outboundTransfer ? <div className="table-stack"><Badge tone="orange">Đang hỗ trợ {supportStore?.name || outboundTransfer.toStoreId}</Badge><small>{transferTimeLabel(outboundTransfer)}</small><small>{money(outboundTransfer.hourlySupportRate || 0)}/giờ · Phụ cấp {money(outboundTransfer.allowance || 0)}</small><small>Hồ sơ tạm khóa thao tác tại cửa hàng chính</small></div> : <><Badge tone="blue">Cửa hàng chính</Badge><small className="table-sub">{scopedStore?.name || scopedStoreId}</small></>}</td>
                <td><Badge tone={type === 'Thử Việc' ? 'orange' : hourlyEmployee ? 'green' : 'blue'}>{employmentTypeLabel(type)}</Badge></td>
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
                <td>{hourlyEmployee
                  ? getHourlyRate(employee) > 0
                    ? <><strong>{money(getHourlyRate(employee))}</strong><small className="table-sub">/ giờ · {employmentTypeLabel(type)}</small></>
                    : <span className="orange-text">Chưa thiết lập</span>
                  : fullTimeSalary?.collision
                    ? <span className="red-text">Trùng mã cấu hình lương — cần xử lý</span>
                  : fullTimeSalary
                    ? <><strong>{money(fullTimeSalary.policy.standardHourlyRateVnd)}/giờ</strong><small className="table-sub">Tới {fullTimeSalary.policy.thresholdHours} giờ; phần vượt {money(fullTimeSalary.policy.excessHourlyRateVnd)}/giờ</small><small className={`table-sub ${fullTimeSalary.configured ? 'green-text' : 'orange-text'}`}>{fullTimeSalary.configured ? 'Đã cài đặt theo nhân viên' : 'Đang dùng mức mặc định an toàn'}</small></>
                    : <span className="orange-text">Cửa hàng chưa có chính sách lương</span>}</td>
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
          {!editing && <div className="form-grid">
            <Field label="Cách tạo nhân viên" required><Select value={form.employeeSource || 'new'} onChange={updateEmployeeSource}><option value="new">Tạo tài khoản nhân viên mới</option><option value="office">Chọn nhân viên Khối văn phòng</option><option value="business_support">Chọn Nhân viên hỗ trợ KD</option></Select></Field>
            {linkingExistingProfile && <Field label={form.employeeSource === 'office' ? 'Nhân viên Khối văn phòng' : 'Nhân viên hỗ trợ KD'} required hint="Tài khoản giữ nguyên vai trò hiện tại và có thêm vai trò Nhân viên cửa hàng."><Select value={form.linkedEmployeeId || ''} onChange={updateLinkedProfile}><option value="">Chọn nhân viên</option>{linkableProfiles.filter((employee) => String(employee.unit || employee.unitType || '').toLowerCase() === form.employeeSource).map((employee) => <option key={employee.id || employee.code} value={employee.id || employee.code}>{employee.name} — {employee.id || employee.code}</option>)}</Select></Field>}
          </div>}
          {linkingExistingProfile && form.linkedEmployeeId && <InfoNote>Đang phân thêm vai trò Nhân viên cửa hàng cho <strong>{form.name}</strong>. Hệ thống dùng chung tài khoản, hồ sơ và CCCD hiện có.</InfoNote>}
          {linkingExistingProfile ? <div className="form-grid">
            <Field label="Mức lương theo giờ (đ/giờ)" required hint="Mức lương dùng khi tài khoản làm việc với vai trò Nhân viên cửa hàng"><MoneyInput value={form.salary} onChange={updateField('salary')} placeholder="Nhập số tiền" /></Field>
          </div> : <div className="form-grid">
            <Field label="Mã nhân viên" required hint="Hệ thống phát sinh tự động theo mã viết tắt của cửa hàng"><Input value={form.id} readOnly aria-readonly="true" /></Field>
            <><Field label="Tên nhân viên" required><Input value={form.name} onChange={updateField('name')} placeholder="Nhập họ và tên" /></Field>
            <Field label="Số CCCD" required hint="Chỉ gồm đúng 12 chữ số"><Input inputMode="numeric" maxLength={12} value={form.cccd} onChange={updateField('cccd')} placeholder="012345678901" /></Field>
            <Field label="Số điện thoại" required hint="Đủ 10 số và bắt đầu bằng số 0"><Input type="tel" inputMode="numeric" maxLength={10} pattern="0[0-9]{9}" value={form.phone} onChange={updateField('phone')} placeholder="0901234567" /></Field></>
            <Field label="Ngày bắt đầu làm" required hint="Hiển thị theo định dạng dd/mm/yy"><Input icon={CalendarDays} type="date" value={form.startDate} onChange={updateField('startDate')} /></Field>
            <Field label="Loại nhân viên" required hint="Full-Time cài lương theo bậc giờ tại Cài đặt lương; Part-Time và Thử Việc hưởng lương theo giờ"><Select value={form.employmentType} onChange={updateEmploymentType}>{EMPLOYMENT_TYPES.map((type) => <option key={type} value={type}>{employmentTypeLabel(type)}</option>)}</Select></Field>
            {isHourlyEmployee(form.employmentType)
              ? <Field label="Lương mặc định theo giờ (đ/giờ)" required hint="Dùng để tính lương theo tổng giờ chấm công"><MoneyInput value={form.salary} onChange={updateField('salary')} placeholder="Nhập số tiền" /></Field>
              : <div className="span-2"><InfoNote>Nhân viên Full-Time không nhập lương cố định tại đây. Sau khi lưu hồ sơ, Admin hoặc Nhân viên hỗ trợ KD cài hai mức lương theo giờ trong danh mục <strong>Cài đặt lương</strong> của cửa hàng.</InfoNote></div>}
            <Field label="Tuổi" required><Input inputMode="numeric" min="16" max="100" value={form.age} onChange={updateField('age')} placeholder="Ví dụ: 22" /></Field>
            <Field label="Vị trí công việc" required hint={isBusinessSupport && !editing ? 'Mặc định cho nhân viên do Hỗ trợ KD tạo' : undefined}>{isBusinessSupport && !editing
              ? <Input value="Nhân viên bán hàng" readOnly aria-readonly="true" />
              : <Select value={form.position} onChange={updateField('position')}><option>Nhân viên bán hàng</option><option>Nhân viên thu ngân</option><option>Nhân viên kho</option><option>Trưởng ca</option><option>Khác</option></Select>}</Field>
          </div>}
          {!linkingExistingProfile && <>
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
              return <Field key={side} label={label} required={!editing} hint="Ảnh gốc tối đa 5 MB; hệ thống tự tối ưu dưới 300 KB">
                <Input type="file" accept="image/jpeg,image/png,image/webp" aria-label={label} onChange={updateIdentityImage(side)} disabled={Boolean(imageBusy)} />
                {image && <small>{preview ? 'Đã chọn ảnh mới' : 'Ảnh đã được lưu riêng tư'}</small>}
                {preview && <img className="identity-image-preview" src={preview} alt={`Xem trước ${label.toLocaleLowerCase('vi-VN')}`} />}
                {image && !preview && editing && <Button type="button" variant="outline" icon={Eye} loading={viewingSide === `${editing.id || editing.code || editing.employeeCode}:${side}`} disabled={Boolean(viewingSide)} onClick={() => viewSavedIdentityImage(side)}>Xem ảnh đã lưu</Button>}
              </Field>
            })}
          </div>
          {imageBusy && <InfoNote>Đang tối ưu ảnh {imageBusy === 'front' ? 'mặt trước' : 'mặt sau'} CCCD…</InfoNote>}
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
          </>}
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
    stores,
    storeId,
    employees: storeEmployees = [],
    attendance = [],
    workCatalogProgress = [],
    compensationEntries = [],
    tasks = [],
    workCatalogItems = [],
    taskAssignmentHistory = [],
    session,
  } = useStoreScope()
  const [searchParams] = useSearchParams()
  const requestedAssignmentId = String(searchParams.get('assignment') || '').trim()
  const canManageViolations = ['admin', 'business_support', 'manager', 'store_manager'].includes(session?.role)
  const [activeTaskTab, setActiveTaskTab] = useState('reward')
  const rewardRows = useMemo(() => workRewardRows({
    attendance,
    workCatalogProgress,
    compensationEntries,
    tasks,
    employees: storeEmployees,
    targetUnit: 'store',
    storeId,
  }), [attendance, workCatalogProgress, compensationEntries, tasks, storeEmployees, storeId])
  const rewardCount = useMemo(() => rewardRows.filter((row) => (
    row.completed && row.payoutStatus !== 'void'
  )).length, [rewardRows])
  const violationCount = useMemo(() => activeWorkCatalogItems(workCatalogItems, {
    targetGroup: WORK_CATALOG_TARGET.STORE,
    storeId,
    date: today(),
    kinds: WORK_CATALOG_KIND.VIOLATION,
  }).length, [workCatalogItems, storeId])
  const scopedAssignmentHistory = taskAssignmentHistory.filter((assignment) => (
    !assignment.storeId || storeFor(stores, assignment.storeId) === activeStore
  ))
  const requestedAssignment = requestedAssignmentId
    ? identifierMatch(
      scopedAssignmentHistory,
      requestedAssignmentId,
      (assignment) => [assignment.assignmentId, assignment.id],
    )
    : null
  const requestedProgress = requestedAssignment
    ? [...(Array.isArray(requestedAssignment.progressHistory) ? requestedAssignment.progressHistory : [])]
        .filter((event) => event?.action === 'progress-submitted')
        .sort((left, right) => String(right.at || '').localeCompare(String(left.at || '')))[0] || null
    : null
  const requestedEmployeeId = String(requestedProgress?.employeeId || '')
  const requestedTasks = (Array.isArray(requestedAssignment?.tasks) ? requestedAssignment.tasks : [])
    .filter((task) => task.required !== false)
  const taskCompletedForRequestedEmployee = (task) => {
    if (!requestedEmployeeId) return task.completed === true || task.done === true
    const completion = operationalIdentifierEntry(task.completedBy, requestedEmployeeId)
    return completion.found && !completion.ambiguous && completion.value === true
  }
  const requestedCompleted = requestedTasks.filter(taskCompletedForRequestedEmployee).length

  return (
    <div className="page admin-task-page">
      <PageHeader title="Công việc tính thưởng & vi phạm" subtitle={`Theo dõi lịch sử thưởng và ghi nhận vi phạm tại ${activeStore?.name || 'cửa hàng đang chọn'}.`} icon={ClipboardCheck} />
      <div className="store-task-tabs" role="tablist" aria-label="Thưởng công việc và vi phạm">
        <button
          type="button"
          role="tab"
          id="store-task-reward-tab"
          aria-controls="store-task-reward-panel"
          aria-selected={activeTaskTab === 'reward'}
          className={activeTaskTab === 'reward' ? 'is-active is-reward' : ''}
          onClick={() => setActiveTaskTab('reward')}
        >
          <ClipboardCheck size={18} aria-hidden="true" />
          <span>Thưởng công việc</span>
          <b>{rewardCount}</b>
        </button>
        {canManageViolations && <button
          type="button"
          role="tab"
          id="store-task-violation-tab"
          aria-controls="store-task-violation-panel"
          aria-selected={activeTaskTab === 'violation'}
          className={activeTaskTab === 'violation' ? 'is-active is-violation' : ''}
          onClick={() => setActiveTaskTab('violation')}
        >
          <ShieldAlert size={18} aria-hidden="true" />
          <span>Vi phạm</span>
          <b className="violation-count">{violationCount}</b>
        </button>}
      </div>

      {activeTaskTab === 'reward' && <section
        id="store-task-reward-panel"
        className="store-task-tab-panel"
        role="tabpanel"
        aria-labelledby="store-task-reward-tab"
      >
        {requestedAssignmentId && <Card className="store-task-progress-card" title="Kết quả công việc bắt buộc nhân viên đã gửi">
          {!requestedAssignment && <InfoNote tone="orange">Không tìm thấy lượt giao việc này trong phạm vi cửa hàng hiện tại.</InfoNote>}
          {requestedAssignment && !requestedProgress && <InfoNote tone="orange">Lượt giao việc chưa có kết quả nhân viên gửi.</InfoNote>}
          {requestedAssignment && requestedProgress && <>
            <div className="store-task-progress-meta">
              <div><span>Nhân viên</span><strong>{requestedProgress.employeeName || requestedEmployeeId || '—'}</strong></div>
              <div><span>Ngày / Ca</span><strong>{formatTaskDate(requestedProgress.date || requestedAssignment.date)} · {requestedProgress.shiftId || requestedAssignment.shiftId || 'Không xác định'}</strong></div>
              <div><span>Tiến độ bắt buộc</span><strong>{requestedProgress.completedTasks ?? requestedCompleted}/{requestedProgress.totalTasks ?? requestedTasks.length} ({requestedProgress.completionRate ?? 0}%)</strong></div>
              <div><span>Gửi lúc</span><strong>{formatTaskDateTime24(requestedProgress.at)}</strong></div>
            </div>
            <div className="store-task-progress-list" aria-label="Kết quả công việc bắt buộc">
              {requestedTasks.map((task) => {
                const completed = taskCompletedForRequestedEmployee(task)
                return <div key={task.id || task.title || task.name} className={completed ? 'is-completed' : 'is-incomplete'}>
                  <span className="store-task-progress-check" aria-hidden="true">{completed ? '✓' : '!'}</span>
                  <strong>{task.title || task.name || 'Công việc bắt buộc'}</strong>
                  <Badge tone={completed ? 'green' : 'orange'}>{completed ? 'Đã hoàn thành' : 'Chưa hoàn thành'}</Badge>
                </div>
              })}
              {!requestedTasks.length && <InfoNote>Lượt giao việc này không có công việc bắt buộc.</InfoNote>}
            </div>
            {requestedProgress.incompleteReason && <InfoNote tone="orange"><strong>Lý do chưa hoàn thành:</strong> {requestedProgress.incompleteReason}</InfoNote>}
          </>}
        </Card>}
        <InfoNote>Danh sách thưởng do nhân viên tự tick và lưu trong mục <strong>“Công việc tính thưởng”</strong> sau khi điểm danh. Trang cửa hàng chỉ theo dõi lịch sử và thống kê.</InfoNote>
        <UnitCompensationStatistics targetUnit="store" storeId={storeId} employees={storeEmployees} sections="reward" rewardRows={rewardRows} />
      </section>}

      {canManageViolations && activeTaskTab === 'violation' && <section
        id="store-task-violation-panel"
        className="store-task-tab-panel store-task-tab-panel--violation"
        role="tabpanel"
        aria-labelledby="store-task-violation-tab"
      >
        <ViolationManagementPage targetUnit="store" storeId={storeId} embedded />
      </section>}
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
          <Field label="Đơn giá nhập (đ/kg)" required><MoneyInput value={form.price} onChange={(event) => setForm({ ...form, price: event.target.value })} placeholder="Nhập số tiền" /></Field>
          <Field label="Phí vận chuyển (đ)"><MoneyInput value={form.shipping} onChange={(event) => setForm({ ...form, shipping: event.target.value })} placeholder="Nhập số tiền" /></Field>
          <div className="calculated-total"><span>Thành tiền</span><strong>{money(formTotal)}</strong><small>= Cân nặng × Đơn giá nhập + Phí vận chuyển</small></div>
          <Field label="Ghi chú (tùy chọn)"><textarea value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} placeholder="Nhập ghi chú..." /></Field>
          <InfoNote><strong>Mẹo</strong><br />Đơn giá nhập là giá của 1kg. Thành tiền được tính tự động.</InfoNote>
        </form>
      </Drawer>
    </div>
  )
}
