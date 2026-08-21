import { useEffect, useState } from 'react'
import {
  CalendarClock,
  CalendarDays,
  Clock3,
  Edit3,
  Eye,
  EyeOff,
  History,
  MapPin,
  Plus,
  Save,
  Trash2,
  UserCheck,
  Users,
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
  Modal,
  PageHeader,
  SearchInput,
  Select,
  TableFooter,
  TableWrap,
} from '../../components/UI'
import { AddressAutocomplete } from '../../components/StructuredAddressAutocomplete'
import { IdentityDocumentViewer } from '../../components/IdentityDocumentViewer'
import { optimizeIdentityImage } from '../../domain/identityImage'
import { apiGetIdentityImage } from '../../services/idosiApi'
import { useApp } from '../../state/AppContext'
import { shortDate, today } from '../../utils'
import { officeLocationMapUrl } from '../employee/officeAttendance'
import {
  officeAttendanceStatsByEmployee,
  officeAttendanceSummary,
  officeAttendanceViewRows,
} from './officeAttendanceView'
import {
  nextOfficeEmployeeCodeFromState,
  OFFICE_EMPLOYEE_TYPES,
  OFFICE_POSITIONS,
  validateOfficeEmployee,
} from './officeEmployeeForm'
import { WorkingTimeFields } from './WorkingTimeFields'
import { WorkingTimeSettingsModal } from './WorkingTimeSettingsModal'
import {
  normalizeWorkingTimeForm,
  withEmploymentWorkingTime,
  workingTimePayload,
} from './workingTime'

const EMPLOYEE_STATUSES = ['Đang làm việc', 'Tạm ngưng', 'Đã nghỉ việc']

const emptyEmployee = {
  code: '',
  name: '',
  cccd: '',
  phone: '',
  province: '',
  ward: '',
  street: '',
  startDate: today(),
  employmentType: OFFICE_EMPLOYEE_TYPES[0],
  workTimeType: 'Full-Time',
  workStart: '08:00',
  workEnd: '17:30',
  workShifts: [{ id: 'full_time', name: 'Giờ hành chính', start: '08:00', end: '17:30' }],
  position: OFFICE_POSITIONS[0],
  identityImages: { front: '', back: '' },
  username: '',
  password: '',
}

const normalizeText = (value = '') => String(value).trim().toLowerCase()
const employeeCode = (employee = {}) => employee.code || employee.employeeCode || employee.id || ''
const officeEmployeeType = (employee = {}) => {
  const value = employee.employmentType || employee.officeEmployeeType || employee.officeEmploymentType || employee.contractType || OFFICE_EMPLOYEE_TYPES[0]
  if (['Chính thức', 'Chinh thuc'].includes(value)) return 'Full-Time'
  if (['Thực tập sinh', 'Thực Tập Sinh', 'Thuc tap sinh'].includes(value)) return 'Thực Tập Sinh'
  if (['Thử việc', 'Thu viec'].includes(value)) return 'Part-Time'
  return OFFICE_EMPLOYEE_TYPES.includes(value) ? value : OFFICE_EMPLOYEE_TYPES[0]
}
const addressParts = (employee = {}) => {
  const nested = typeof employee.address === 'object' && employee.address ? employee.address : {}
  return {
    province: employee.province || employee.addressProvince || nested.province || nested.provinceCity || '',
    ward: employee.ward || employee.addressWard || nested.ward || '',
    street: employee.street || employee.addressStreet || nested.street || (typeof employee.address === 'string' ? employee.address : ''),
  }
}

const addressLabel = (employee) => {
  const address = addressParts(employee)
  return [address.street, address.ward, address.province].filter(Boolean).join(', ') || '—'
}

const isOfficeValue = (value) => ['office', 'van phong', 'văn phòng', 'khối văn phòng', 'khoi van phong', 'vp'].includes(normalizeText(value))

const isOfficeEmployee = (employee = {}) => Boolean(
  employee.isOffice
  || [employee.department, employee.unitType, employee.employeeGroup, employee.workUnit, employee.employeeKind, employee.storeId].some(isOfficeValue),
)

const employeeToForm = (employee = {}) => {
  const address = addressParts(employee)
  const employmentType = officeEmployeeType(employee)
  const workingTime = normalizeWorkingTimeForm(employee, employmentType)
  return {
    ...emptyEmployee,
    code: employeeCode(employee),
    name: employee.name || '',
    cccd: String(employee.cccd || employee.citizenId || ''),
    phone: employee.phone || '',
    province: address.province,
    ward: address.ward,
    street: address.street,
    startDate: String(employee.startDate || employee.joinDate || '').slice(0, 10),
    employmentType,
    ...workingTime,
    position: OFFICE_POSITIONS.includes(employee.position || employee.workPosition || employee.role)
      ? (employee.position || employee.workPosition || employee.role)
      : OFFICE_POSITIONS[0],
    identityImages: {
      front: employee.identityImages?.front || employee.cccdFrontImage || '',
      back: employee.identityImages?.back || employee.cccdBackImage || '',
    },
    username: employee.username || '',
    password: '',
  }
}

const employeeStatusTone = (status) => {
  if (status === 'Đang làm việc') return 'green'
  if (status === 'Đã nghỉ việc') return 'red'
  return 'orange'
}

const recordEmployeeId = (record = {}) => record.employeeId || record.employeeCode || record.staffId || record.userId || ''
const attendanceTone = (label, departure = false) => {
  const source = normalizeText(label)
  if (source.includes('đúng') || source.includes('đã ra về')) return 'green'
  if (source.includes('sớm')) return departure ? 'orange' : 'blue'
  if (source.includes('trễ') || source.includes('muộn')) return 'orange'
  return 'blue'
}

const attendanceEvaluationTone = (value) => {
  if (value === 'Chuyên cần tốt') return 'green'
  if (value === 'Cần cải thiện') return 'red'
  return 'orange'
}

const shortYearDate = (value) => {
  if (!value) return '—'
  const parsed = new Date(`${String(value).slice(0, 10)}T00:00:00`)
  return Number.isNaN(parsed.getTime())
    ? '—'
    : parsed.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: '2-digit' })
}

const imagePreview = (value) => typeof value === 'string' && value.startsWith('data:image/') ? value : ''

const readIdentityImage = async (file) => file ? (await optimizeIdentityImage(file)).dataUrl : ''

export function OfficeManagement() {
  const app = useApp()
  const allEmployees = Array.isArray(app.employees) ? app.employees : []
  const deletedEmployees = Array.isArray(app.deletedEmployees) ? app.deletedEmployees : []
  const allAttendance = Array.isArray(app.attendance) ? app.attendance : []
  const { addEmployee, updateEmployee, deleteEmployee, notify } = app
  const officeEmployees = allEmployees.filter(isOfficeEmployee)
  const officeEmployeeIds = new Set(officeEmployees.flatMap((employee) => [String(employee.id || ''), String(employeeCode(employee))]).filter(Boolean))
  const officeAttendance = allAttendance.filter((record) => officeEmployeeIds.has(String(recordEmployeeId(record))) || isOfficeValue(record.department || record.unitType))

  const [tab, setTab] = useState('employees')
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [employeeDrawer, setEmployeeDrawer] = useState(false)
  const [editingEmployee, setEditingEmployee] = useState(null)
  const [pendingDelete, setPendingDelete] = useState(null)
  const [employeeForm, setEmployeeForm] = useState(emptyEmployee)
  const [employeeErrors, setEmployeeErrors] = useState([])
  const [showPassword, setShowPassword] = useState(false)
  const [imageBusy, setImageBusy] = useState('')
  const [viewingImage, setViewingImage] = useState(null)
  const [viewingSide, setViewingSide] = useState('')
  const [attendanceFrom, setAttendanceFrom] = useState('')
  const [attendanceTo, setAttendanceTo] = useState('')
  const [attendanceEmployeeId, setAttendanceEmployeeId] = useState('all')
  const [workingTimeSettingsOpen, setWorkingTimeSettingsOpen] = useState(false)
  const editingRequiresPassword = Boolean(editingEmployee) && !(
    editingEmployee.authUserId || editingEmployee.authVersion || editingEmployee.passwordHash || editingEmployee.legacyPassword
  )
  const canManageOffice = ['admin', 'business_support', 'manager'].includes(app.session?.role)
  const canDeleteOffice = app.session?.role === 'admin'
  const canCreateOffice = ['admin', 'business_support', 'manager'].includes(app.session?.role)

  useEffect(() => {
    const url = viewingImage?.url
    return () => {
      if (url?.startsWith('blob:')) URL.revokeObjectURL(url)
    }
  }, [viewingImage?.url])

  const normalizedQuery = normalizeText(query)
  const filteredEmployees = officeEmployees.filter((employee) => {
    const haystack = [employeeCode(employee), employee.name, employee.cccd, employee.phone, employee.position, employee.workPosition, employee.role, addressLabel(employee)].join(' ').toLowerCase()
    return (!normalizedQuery || haystack.includes(normalizedQuery)) && (statusFilter === 'all' || employee.status === statusFilter)
  })
  const attendanceRows = officeAttendanceViewRows({
    records: officeAttendance,
    employees: officeEmployees,
    fromDate: attendanceFrom,
    toDate: attendanceTo,
    employeeId: attendanceEmployeeId,
  })
  const attendanceEvaluation = app.policies?.attendanceEvaluation || {}
  const attendanceSummary = officeAttendanceSummary(attendanceRows, attendanceEvaluation)
  const attendanceStats = officeAttendanceStatsByEmployee({
    rows: attendanceRows,
    employees: officeEmployees,
    evaluation: attendanceEvaluation,
    employeeId: attendanceEmployeeId,
  })

  const openEmployeeCreate = () => {
    if (!canCreateOffice) return
    setEditingEmployee(null)
    setEmployeeForm({
      ...emptyEmployee,
      workShifts: emptyEmployee.workShifts.map((shift) => ({ ...shift })),
      code: nextOfficeEmployeeCodeFromState({ employees: allEmployees, deletedEmployees }),
    })
    setEmployeeErrors([])
    setShowPassword(false)
    setImageBusy('')
    setEmployeeDrawer(true)
  }

  const openEmployeeEdit = (employee) => {
    setEditingEmployee(employee)
    setEmployeeForm(employeeToForm(employee))
    setEmployeeErrors([])
    setShowPassword(false)
    setImageBusy('')
    setEmployeeDrawer(true)
  }

  const closeEmployeeDrawer = () => {
    setEmployeeDrawer(false)
    setEditingEmployee(null)
    setEmployeeForm({
      ...emptyEmployee,
      identityImages: { ...emptyEmployee.identityImages },
      workShifts: emptyEmployee.workShifts.map((shift) => ({ ...shift })),
    })
    setEmployeeErrors([])
    setShowPassword(false)
    setImageBusy('')
  }

  const updateEmployeeField = (field) => (event) => {
    let value = event.target.value
    if (field === 'cccd') value = value.replace(/\D/g, '').slice(0, 12)
    if (field === 'phone') value = value.replace(/\D/g, '').slice(0, 10)
    setEmployeeForm((current) => field === 'employmentType'
      ? withEmploymentWorkingTime(current, value)
      : ({ ...current, [field]: value }))
  }

  const updateEmployeeAddress = (address) => {
    setEmployeeForm((current) => ({ ...current, ...address }))
  }

  const updateIdentityImage = (side) => async (event) => {
    const file = event.target.files?.[0]
    if (!file) return
    setImageBusy(side)
    try {
      const value = await readIdentityImage(file)
      setEmployeeForm((current) => ({
        ...current,
        identityImages: { ...current.identityImages, [side]: value },
      }))
      setEmployeeErrors((current) => current.filter((error) => !error.includes(side === 'front' ? 'mặt trước CCCD' : 'mặt sau CCCD')))
    } catch (error) {
      notify?.(error.message, 'info')
    } finally {
      setImageBusy('')
      event.target.value = ''
    }
  }

  const viewSavedIdentityImage = async (side, employee = editingEmployee) => {
    if (!employee) return
    const id = employee.id || employeeCode(employee)
    const busyKey = `${id}:${side}`
    const storedImage = employee.identityImages?.[side]
      || (side === 'front' ? employee.cccdFrontImage : employee.cccdBackImage)
    if (typeof storedImage === 'string' && storedImage.startsWith('data:image/')) {
      setViewingImage({
        url: storedImage,
        label: `${employee.name || id} · ${side === 'front' ? 'Mặt trước CCCD' : 'Mặt sau CCCD'}`,
      })
      return
    }
    setViewingSide(busyKey)
    try {
      const blob = await apiGetIdentityImage(id, side)
      setViewingImage({
        url: URL.createObjectURL(blob),
        label: `${employee.name || id} · ${side === 'front' ? 'Mặt trước CCCD' : 'Mặt sau CCCD'}`,
      })
    } catch (error) {
      notify?.(error.message || 'Không thể tải ảnh CCCD.', 'info')
    } finally {
      setViewingSide('')
    }
  }

  const saveEmployee = async (event) => {
    event?.preventDefault()
    if (editingEmployee ? !canManageOffice : !canCreateOffice) return
    const editingKey = editingEmployee?.id || (editingEmployee ? employeeCode(editingEmployee) : '')
    const errors = validateOfficeEmployee(employeeForm, allEmployees, editingKey, !editingEmployee || editingRequiresPassword)
    if (errors.length) {
      setEmployeeErrors(errors)
      notify?.('Vui lòng kiểm tra lại hồ sơ nhân viên văn phòng.', 'info')
      return
    }
    const address = [employeeForm.street.trim(), employeeForm.ward.trim(), employeeForm.province.trim()].join(', ')
    const identityImages = Object.fromEntries(['front', 'back'].flatMap((side) => {
      const value = employeeForm.identityImages?.[side]
      return typeof value === 'string' && value.startsWith('data:image/') ? [[side, value]] : []
    }))
    const payload = {
      id: employeeForm.code.trim(),
      code: employeeForm.code.trim(),
      employeeCode: employeeForm.code.trim(),
      name: employeeForm.name.trim(),
      cccd: employeeForm.cccd,
      phone: employeeForm.phone.trim(),
      province: employeeForm.province.trim(),
      ward: employeeForm.ward.trim(),
      street: employeeForm.street.trim(),
      address,
      addressDetails: { province: employeeForm.province.trim(), ward: employeeForm.ward.trim(), street: employeeForm.street.trim() },
      startDate: employeeForm.startDate,
      joinDate: employeeForm.startDate,
      employmentType: employeeForm.employmentType,
      ...(!editingEmployee ? workingTimePayload(employeeForm) : {}),
      officeEmployeeType: employeeForm.employmentType,
      officeEmploymentType: employeeForm.employmentType,
      position: employeeForm.position.trim(),
      workPosition: employeeForm.position.trim(),
      role: employeeForm.position.trim(),
      shortRole: employeeForm.position.trim(),
      username: employeeForm.username.trim(),
      ...(employeeForm.password ? { password: employeeForm.password } : {}),
      ...(Object.keys(identityImages).length ? { identityImages } : {}),
      department: 'office',
      unit: 'office',
      unitType: 'office',
      storeId: 'OFFICE',
      isOffice: true,
    }

    if (editingEmployee) {
      if (typeof updateEmployee !== 'function') return notify?.('Chức năng cập nhật nhân viên đang được kết nối.', 'info')
      const result = await updateEmployee(editingKey, payload)
      if (!result?.ok) return notify?.(result?.message || 'Không thể cập nhật nhân viên.', 'info')
    } else {
      if (typeof addEmployee !== 'function') return notify?.('Chức năng thêm nhân viên đang được kết nối.', 'info')
      const result = await addEmployee(payload)
      if (!result?.ok) return notify?.(result?.message || 'Không thể thêm nhân viên.', 'info')
    }
    closeEmployeeDrawer()
  }

  const confirmDelete = async () => {
    if (!canDeleteOffice || !pendingDelete) return
    if (typeof deleteEmployee !== 'function') return notify?.('Chức năng xóa nhân viên đang được kết nối.', 'info')
    const result = await deleteEmployee(pendingDelete.id || employeeCode(pendingDelete))
    if (result?.ok === false) return notify?.(result.message || 'Không thể xóa nhân viên.', 'info')
    setPendingDelete(null)
  }

  const activeCount = officeEmployees.filter((employee) => employee.status === 'Đang làm việc').length
  const pausedCount = officeEmployees.filter((employee) => employee.status === 'Tạm ngưng' || employee.status === 'Tạm nghỉ').length
  const resignedCount = officeEmployees.filter((employee) => employee.status === 'Đã nghỉ việc').length

  if (app.session?.role === 'store_manager') {
    return <div className="page"><PageHeader title="KHÔNG CÓ QUYỀN TRUY CẬP" subtitle="Tài khoản Quản lý không được truy cập Khối văn phòng." icon={Users} /></div>
  }

  return (
    <div className="page">
      <PageHeader
        title="KHỐI VĂN PHÒNG"
        subtitle="Thông tin nhân viên, lịch sử chấm công và đánh giá mức độ chuyên cần."
        icon={Users}
        actions={canManageOffice ? <Button icon={CalendarClock} onClick={() => setWorkingTimeSettingsOpen(true)}>Cài đặt thời gian làm việc</Button> : null}
      />
      {!canManageOffice && <InfoNote>Chế độ chỉ xem. Tài khoản hiện tại không thể sửa hồ sơ nhân viên.</InfoNote>}

      <div className="tabs">
        <button className={tab === 'employees' ? 'active' : ''} onClick={() => setTab('employees')}><Users />Nhân viên</button>
        <button className={tab === 'attendance' ? 'active' : ''} onClick={() => setTab('attendance')}><History />Chấm công &amp; chuyên cần</button>
      </div>

      {tab === 'employees' && <>
        <div className="metric-grid metric-grid--four">
          <MetricCard label="Tổng nhân viên" value={officeEmployees.length} suffix="nhân viên" icon={Users} tone="blue" compact />
          <MetricCard label="Đang làm việc" value={activeCount} suffix="nhân viên" icon={UserCheck} tone="green" compact />
          <MetricCard label="Tạm ngưng" value={pausedCount} suffix="nhân viên" icon={Clock3} tone="orange" compact />
          <MetricCard label="Đã nghỉ việc" value={resignedCount} suffix="nhân viên" icon={Users} tone="red" compact />
        </div>
        <Card>
          <div className="card__subheader">
            <div className="filter-pills"><button className={statusFilter === 'all' ? 'active' : ''} onClick={() => setStatusFilter('all')}>Tất cả ({officeEmployees.length})</button>{EMPLOYEE_STATUSES.map((status) => <button key={status} className={statusFilter === status ? 'active' : ''} onClick={() => setStatusFilter(status)}>{status}</button>)}</div>
            <div><SearchInput value={query} onChange={setQuery} placeholder="Tìm nhân viên..." />{canCreateOffice && <Button icon={Plus} onClick={openEmployeeCreate}>Thêm nhân viên</Button>}</div>
          </div>
          <TableWrap>
            <thead><tr><th>Mã nhân viên</th><th>Nhân viên</th><th>Loại nhân viên</th><th>Ngày bắt đầu</th><th>CCCD</th><th>Số điện thoại</th><th>Địa chỉ</th><th>Vị trí</th><th>Ảnh CCCD</th><th>Trạng thái</th>{canManageOffice && <th>Thao tác</th>}</tr></thead>
            <tbody>
              {filteredEmployees.map((employee) => {
                const type = officeEmployeeType(employee)
                const images = {
                  front: employee.identityImages?.front || employee.cccdFrontImage,
                  back: employee.identityImages?.back || employee.cccdBackImage,
                }
                const imageCount = Object.values(images).filter(Boolean).length
                return <tr key={employee.id || employeeCode(employee)}><td><strong>{employeeCode(employee)}</strong></td><td><div className="person-cell"><Avatar name={employee.name} src={employee.avatar} color={employee.color} /><span><strong>{employee.name}</strong><small>{employee.username || 'Chưa có tên đăng nhập'}</small></span></div></td><td><Badge tone={type === 'Full-Time' ? 'green' : type === 'Part-Time' ? 'blue' : 'orange'}>{type}</Badge></td><td><strong>{shortYearDate(employee.startDate || employee.joinDate)}</strong></td><td>{employee.cccd || employee.citizenId || '—'}</td><td>{employee.phone || '—'}</td><td className="address-cell">{addressLabel(employee)}</td><td>{employee.position || employee.workPosition || employee.role || '—'}</td><td><div className="identity-image-actions identity-image-actions--stable"><Badge tone={imageCount === 2 ? 'green' : 'orange'}>{imageCount}/2 ảnh</Badge>{Object.entries(images).map(([side, image]) => image ? <button key={side} type="button" onClick={() => viewSavedIdentityImage(side, employee)} disabled={Boolean(viewingSide)} aria-label={`Xem ${side === 'front' ? 'mặt trước' : 'mặt sau'} CCCD của ${employee.name}`} title={`Xem ${side === 'front' ? 'mặt trước' : 'mặt sau'} CCCD`}><Eye size={16} /><span>{side === 'front' ? 'Trước' : 'Sau'}</span></button> : null)}</div></td><td><Badge tone={employeeStatusTone(employee.status)}>{employee.status || EMPLOYEE_STATUSES[0]}</Badge></td>{canManageOffice && <td><div className="row-actions"><button onClick={() => openEmployeeEdit(employee)} aria-label={`Sửa ${employee.name}`}><Edit3 /></button>{canDeleteOffice && <button className="danger" onClick={() => setPendingDelete(employee)} aria-label={`Xóa ${employee.name}`}><Trash2 /></button>}</div></td>}</tr>
              })}
              {!filteredEmployees.length && <tr><td colSpan={canManageOffice ? 11 : 10}>Chưa có nhân viên văn phòng phù hợp.</td></tr>}
            </tbody>
          </TableWrap>
          <TableFooter shown={filteredEmployees.length} total={filteredEmployees.length} />
        </Card>
      </>}

      {tab === 'attendance' && <>
        <Card title="Bộ lọc chấm công" className="filter-card">
          <div className="filter-grid filter-grid--four">
            <Field label="Từ ngày"><Input type="date" value={attendanceFrom} onChange={(event) => setAttendanceFrom(event.target.value)} aria-label="Từ ngày chấm công" /></Field>
            <Field label="Đến ngày"><Input type="date" value={attendanceTo} onChange={(event) => setAttendanceTo(event.target.value)} aria-label="Đến ngày chấm công" /></Field>
            <Field label="Nhân viên"><Select value={attendanceEmployeeId} onChange={(event) => setAttendanceEmployeeId(event.target.value)} aria-label="Lọc nhân viên chấm công"><option value="all">Tất cả nhân viên</option>{officeEmployees.map((employee) => <option key={employee.id || employeeCode(employee)} value={employee.id || employeeCode(employee)}>{employeeCode(employee)} — {employee.name}</option>)}</Select></Field>
            <Button variant="outline" onClick={() => { setAttendanceFrom(''); setAttendanceTo(''); setAttendanceEmployeeId('all') }}>Đặt lại bộ lọc</Button>
          </div>
          <InfoNote>Thống kê và đánh giá bên dưới luôn áp dụng đồng thời khoảng thời gian và nhân viên đã chọn.</InfoNote>
        </Card>
        <div className="metric-grid metric-grid--six">
          <MetricCard label="Lượt điểm danh" value={attendanceSummary.total} suffix="lượt" icon={History} tone="blue" compact />
          <MetricCard label="Đi sớm" value={attendanceSummary.early} suffix="lượt" icon={Clock3} tone="blue" compact />
          <MetricCard label="Đúng giờ" value={attendanceSummary.onTime} suffix="lượt" icon={UserCheck} tone="green" compact />
          <MetricCard label="Đi trễ" value={attendanceSummary.late} suffix="lượt" icon={Clock3} tone="orange" compact />
          <MetricCard label="Tổng phút đi sớm" value={attendanceSummary.earlyMinutes} suffix="phút" icon={Clock3} tone="blue" compact />
          <MetricCard label="Tổng phút đi trễ" value={attendanceSummary.lateMinutes} suffix="phút" icon={Clock3} tone="red" compact />
        </div>
        <Card title="Lịch sử chấm công">
          <TableWrap>
            <thead><tr><th>Ngày</th><th>Nhân viên</th><th>Ca làm việc</th><th>Điểm danh vào</th><th>Ra về</th><th>Số giờ</th><th>Tags / Chênh lệch</th><th>Vị trí</th></tr></thead>
            <tbody>
              {attendanceRows.map((row) => {
                const employeeName = row.employee?.name || row.record.employeeName || row.employeeId
                const checkInMapUrl = officeLocationMapUrl(row.checkInLocation)
                const checkOutMapUrl = officeLocationMapUrl(row.checkOutLocation)
                return <tr key={row.id}><td><strong>{shortDate(row.date)}</strong></td><td><div className="person-cell"><Avatar name={employeeName || 'NV'} color={row.employee?.color} /><span><strong>{employeeName}</strong><small>{employeeCode(row.employee) || row.employeeId} · {row.employee?.position || row.employee?.workPosition || row.employee?.role || 'Nhân viên văn phòng'}</small></span></div></td><td><strong>{row.shiftName}</strong><span className="table-sub">{row.shiftStart || '--:--'}–{row.shiftEnd || '--:--'}</span></td><td><strong>{row.checkIn || '—'}</strong></td><td><strong>{row.checkOut || 'Chưa ra về'}</strong></td><td>{row.workedHours.toFixed(2)} giờ</td><td><Badge tone={attendanceTone(row.arrivalStatus)}>{row.arrivalStatus}</Badge> <Badge tone={attendanceTone(row.departureStatus, true)}>{row.departureStatus}</Badge><span className="table-sub">Sớm {row.earlyMinutes} phút · Trễ {row.lateMinutes} phút</span></td><td><div className="attendance-location-actions">{checkInMapUrl && <a className="attendance-location-link" href={checkInMapUrl} target="_blank" rel="noreferrer" aria-label={`Vị trí vào của ${employeeName} trên Google Maps`}><MapPin size={16} aria-hidden="true" /><span>Xem vị trí vào</span></a>}{checkOutMapUrl && <a className="attendance-location-link" href={checkOutMapUrl} target="_blank" rel="noreferrer" aria-label={`Vị trí ra của ${employeeName} trên Google Maps`}><MapPin size={16} aria-hidden="true" /><span>Xem vị trí ra</span></a>}{!checkInMapUrl && !checkOutMapUrl && <span className="table-note">—</span>}</div></td></tr>
              })}
              {!attendanceRows.length && <tr><td colSpan="8">Chưa có lịch sử chấm công phù hợp bộ lọc.</td></tr>}
            </tbody>
          </TableWrap>
          <TableFooter shown={attendanceRows.length} total={attendanceRows.length} />
        </Card>
        <Card title="Thống kê và đánh giá chuyên cần theo nhân viên">
          <TableWrap>
            <thead><tr><th>Nhân viên</th><th>Tổng lượt</th><th>Đi sớm</th><th>Đúng giờ</th><th>Đi trễ</th><th>Tổng phút sớm</th><th>Tổng phút trễ</th><th>Tỷ lệ không trễ</th><th>Đánh giá</th></tr></thead>
            <tbody>
              {attendanceStats.map((item) => <tr key={item.employee.id || employeeCode(item.employee)}><td><div className="person-cell"><Avatar name={item.employee.name} color={item.employee.color} /><span><strong>{item.employee.name}</strong><small>{employeeCode(item.employee)} · {item.employee.position || item.employee.workPosition || item.employee.role || 'Nhân viên văn phòng'}</small></span></div></td><td>{item.total}</td><td className="blue-text">{item.early}</td><td className="green-text">{item.onTime}</td><td className="orange-text">{item.late}</td><td>{item.earlyMinutes} phút</td><td>{item.lateMinutes} phút</td><td><strong>{item.onTimeRate.toFixed(1)}%</strong></td><td><Badge tone={attendanceEvaluationTone(item.rating)}>{item.rating}</Badge></td></tr>)}
              {!attendanceStats.length && <tr><td colSpan="9">Chưa có nhân viên phù hợp bộ lọc để đánh giá.</td></tr>}
            </tbody>
          </TableWrap>
        </Card>
      </>}

      {(editingEmployee ? canManageOffice : canCreateOffice) && <Modal
        wide
        open={employeeDrawer}
        onClose={closeEmployeeDrawer}
        title={editingEmployee ? 'Cập nhật nhân viên văn phòng' : 'Thêm nhân viên văn phòng'}
        footer={<><Button variant="outline" onClick={closeEmployeeDrawer} disabled={Boolean(imageBusy)}>Hủy bỏ</Button><Button icon={Save} onClick={saveEmployee} disabled={Boolean(imageBusy)}>{editingEmployee ? 'Lưu thay đổi' : 'Lưu nhân viên'}</Button></>}
      >
        <form className="form-stack employee-profile-form" onSubmit={saveEmployee}>
          {employeeErrors.length > 0 && <InfoNote tone="orange"><strong>Thông tin chưa hợp lệ</strong><ul>{employeeErrors.map((error) => <li key={error}>{error}</li>)}</ul></InfoNote>}
          <h3>Thông tin nhân viên</h3>
          <div className="form-grid">
            <Field label="Mã nhân viên" required hint="Hệ thống tự phát sinh theo thứ tự VP-001, VP-002, ..."><Input value={employeeForm.code} readOnly /></Field>
            <Field label="Tên nhân viên" required><Input value={employeeForm.name} onChange={updateEmployeeField('name')} placeholder="Nhập họ và tên" /></Field>
            <Field label="Số điện thoại" required hint="Đủ 10 số và bắt đầu bằng 0"><Input type="tel" inputMode="numeric" maxLength={10} value={employeeForm.phone} onChange={updateEmployeeField('phone')} placeholder="0901234567" /></Field>
            <Field label="CCCD" required hint="CCCD phải gồm đúng 12 chữ số"><Input inputMode="numeric" maxLength={12} value={employeeForm.cccd} onChange={updateEmployeeField('cccd')} placeholder="012345678901" /></Field>
            <Field label="Ngày bắt đầu làm" required hint="Hiển thị theo định dạng dd/mm/yy"><Input icon={CalendarDays} type="date" value={employeeForm.startDate} onChange={updateEmployeeField('startDate')} /></Field>
            <Field label="Loại nhân viên" required><Select value={employeeForm.employmentType} onChange={updateEmployeeField('employmentType')}>{OFFICE_EMPLOYEE_TYPES.map((type) => <option key={type}>{type}</option>)}</Select></Field>
            <Field label="Vị trí công việc" required><Select value={employeeForm.position} onChange={updateEmployeeField('position')}>{OFFICE_POSITIONS.map((position) => <option key={position}>{position}</option>)}</Select></Field>
          </div>
          {!editingEmployee && <>
            <h3>Thời gian làm việc</h3>
            <WorkingTimeFields form={employeeForm} onChange={(workingTime) => setEmployeeForm((current) => ({ ...current, ...workingTime }))} />
          </>}
          {editingEmployee && <InfoNote>Dùng chức năng “Cài đặt thời gian làm việc” để thay đổi giờ làm theo ngày áp dụng.</InfoNote>}
          <h3>Địa chỉ</h3>
          <AddressAutocomplete
            value={{ province: employeeForm.province, ward: employeeForm.ward, street: employeeForm.street }}
            onChange={updateEmployeeAddress}
          />
          <h3>Hình ảnh CCCD</h3>
          <div className="form-grid identity-image-grid">
            {['front', 'back'].map((side) => {
              const label = side === 'front' ? 'Mặt trước CCCD' : 'Mặt sau CCCD'
              const image = employeeForm.identityImages?.[side]
              const preview = imagePreview(image)
              return <Field key={side} label={label} required hint="Ảnh gốc tối đa 5 MB; hệ thống tự tối ưu dưới 300 KB">
                <Input type="file" accept="image/jpeg,image/png,image/webp" aria-label={label} onChange={updateIdentityImage(side)} disabled={Boolean(imageBusy)} />
                {image && <small>{preview ? 'Đã chọn ảnh mới' : 'Ảnh đã được lưu riêng tư'}</small>}
                {preview && <img className="identity-image-preview" src={preview} alt={`Xem trước ${label.toLocaleLowerCase('vi-VN')}`} />}
                {image && !preview && editingEmployee && <Button type="button" variant="outline" icon={Eye} loading={viewingSide === `${editingEmployee.id || employeeCode(editingEmployee)}:${side}`} disabled={Boolean(viewingSide)} onClick={() => viewSavedIdentityImage(side)}>Xem ảnh đã lưu</Button>}
              </Field>
            })}
          </div>
          {imageBusy && <InfoNote>Đang tối ưu ảnh {imageBusy === 'front' ? 'mặt trước' : 'mặt sau'} CCCD…</InfoNote>}
          <h3>Tài khoản đăng nhập</h3>
          <div className="form-grid">
            <Field label="Tên đăng nhập" required><Input autoComplete="username" value={employeeForm.username} onChange={updateEmployeeField('username')} placeholder="Nhập tên đăng nhập" /></Field>
            <Field label="Mật khẩu" required={!editingEmployee || editingRequiresPassword} hint={editingEmployee && !editingRequiresPassword ? 'Để nguyên nếu không muốn đổi mật khẩu' : 'Bắt buộc để cấp tài khoản đăng nhập'}><span className="password-input"><Input type={showPassword ? 'text' : 'password'} autoComplete="new-password" value={employeeForm.password} onChange={updateEmployeeField('password')} placeholder={editingEmployee && !editingRequiresPassword ? 'Nhập mật khẩu mới nếu cần' : 'Nhập mật khẩu để cấp tài khoản'} /><button type="button" onClick={() => setShowPassword((current) => !current)} aria-label={showPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'} title={showPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}>{showPassword ? <EyeOff size={20} /> : <Eye size={20} />}</button></span></Field>
          </div>
          <InfoNote>Ảnh CCCD được lưu trong vùng riêng tư và chỉ tài khoản có quyền mới truy cập được. Hệ thống không hiển thị lại mật khẩu hiện tại.</InfoNote>
        </form>
      </Modal>}

      <WorkingTimeSettingsModal
        open={workingTimeSettingsOpen}
        profiles={officeEmployees}
        onClose={() => setWorkingTimeSettingsOpen(false)}
        onSave={(employeeId, payload) => app.setEmployeeWorkingTime?.(employeeId, payload)}
        title="Cài đặt thời gian làm việc · Khối văn phòng"
      />

      <Modal wide open={Boolean(viewingImage)} onClose={() => setViewingImage(null)} title={viewingImage?.label || 'Ảnh CCCD'} footer={<Button variant="outline" onClick={() => setViewingImage(null)}>Đóng</Button>}>
        <IdentityDocumentViewer src={viewingImage?.url || ''} alt={viewingImage?.label || 'Ảnh CCCD'} />
      </Modal>

      <Modal
        open={Boolean(pendingDelete)}
        onClose={() => setPendingDelete(null)}
        title="Xóa nhân viên văn phòng"
        footer={<><Button variant="outline" onClick={() => setPendingDelete(null)}>Hủy</Button><Button onClick={confirmDelete}>Xóa nhân viên</Button></>}
      >
        <InfoNote tone="orange">Bạn sắp xóa hồ sơ của <strong>{pendingDelete?.name}</strong>. Nên chuyển trạng thái sang “Đã nghỉ việc” nếu cần giữ lịch sử chấm công.</InfoNote>
      </Modal>
    </div>
  )
}

export default OfficeManagement
