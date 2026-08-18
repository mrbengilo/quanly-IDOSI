import { useEffect, useState } from 'react'
import {
  Banknote,
  CalendarDays,
  Clock3,
  Edit3,
  Eye,
  EyeOff,
  Gift,
  History,
  Plus,
  Save,
  Trash2,
  UserCheck,
  Users,
  Wallet,
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
import { apiGetIdentityImage } from '../../services/idosiApi'
import { useApp } from '../../state/AppContext'
import { formatMoneyInput, money, parseMoneyInput, shortDate, today } from '../../utils'
import {
  officeAdjustmentTotals,
  officeLocationLabel,
  officePayrollSummary,
  officeSalaryAdjustments,
} from '../employee/officeAttendance'
import { submitOfficeSalaryAdjustment } from './officeSalaryAdjustment'
import {
  nextOfficeEmployeeCodeFromState,
  OFFICE_EMPLOYEE_TYPES,
  OFFICE_POSITIONS,
  validateOfficeEmployee,
} from './officeEmployeeForm'

const EMPLOYEE_STATUSES = ['Đang làm việc', 'Tạm ngưng', 'Đã nghỉ việc']
const IDENTITY_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])
const MAX_IDENTITY_IMAGE_SIZE = 2 * 1024 * 1024

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
  position: OFFICE_POSITIONS[0],
  identityImages: { front: '', back: '' },
  username: '',
  password: '',
}

const emptyAdjustment = {
  date: today(),
  employeeId: '',
  amount: '',
  content: '',
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
    employmentType: officeEmployeeType(employee),
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

const recordDate = (record = {}) => record.date || record.workDate || record.attendanceDate || String(record.checkInAt || '').slice(0, 10)
const recordEmployeeId = (record = {}) => record.employeeId || record.staffId || record.userId || ''
const checkInTime = (record = {}) => record.checkIn || record.checkInTime || String(record.checkInAt || '').slice(11, 19)
const checkOutTime = (record = {}) => record.checkOut || record.checkOutTime || String(record.checkOutAt || '').slice(11, 19)

const minutesFromTime = (value = '') => {
  const [hours, minutes] = String(value).slice(0, 5).split(':').map(Number)
  return Number.isFinite(hours) && Number.isFinite(minutes) ? hours * 60 + minutes : null
}

const attendanceLabel = (record, employee) => {
  const source = normalizeText(record.status || record.punctuality)
  if (source.includes('sớm') || source.includes('som') || source.includes('early')) return 'Đi sớm'
  if (source.includes('trễ') || source.includes('tre') || source.includes('muộn') || source.includes('late')) return 'Đi trễ'
  if (source.includes('đúng') || source.includes('dung') || source.includes('on time')) return 'Đúng giờ'

  const actual = minutesFromTime(checkInTime(record))
  const expected = minutesFromTime(record.shiftStart || record.startTime || employee?.workStart || '08:00')
  if (actual == null || expected == null) return 'Chưa xác định'
  const difference = actual - expected
  if (difference < -5) return 'Đi sớm'
  if (difference <= 5) return 'Đúng giờ'
  return 'Đi trễ'
}

const attendanceTone = (label) => {
  if (label === 'Đi sớm') return 'blue'
  if (label === 'Đúng giờ') return 'green'
  if (label === 'Đi trễ') return 'orange'
  return 'red'
}

const hoursWorked = (record) => {
  if (Number.isFinite(Number(record.hours))) return Number(record.hours)
  const start = minutesFromTime(checkInTime(record))
  const end = minutesFromTime(checkOutTime(record))
  if (start == null || end == null) return 0
  const minutes = end >= start ? end - start : end + 24 * 60 - start
  return Math.max(0, minutes / 60)
}

const adjustmentEmployeeId = (adjustment = {}) => adjustment.employeeId || adjustment.staffId || ''
const adjustmentDate = (adjustment = {}) => adjustment.date || adjustment.createdDate || String(adjustment.createdAt || '').slice(0, 10)

const shortYearDate = (value) => {
  if (!value) return '—'
  const parsed = new Date(`${String(value).slice(0, 10)}T00:00:00`)
  return Number.isNaN(parsed.getTime())
    ? '—'
    : parsed.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: '2-digit' })
}

const imagePreview = (value) => typeof value === 'string' && value.startsWith('data:image/') ? value : ''

const readIdentityImage = (file) => new Promise((resolve, reject) => {
  if (!file) return resolve('')
  if (!IDENTITY_IMAGE_TYPES.has(file.type)) return reject(new Error('Ảnh CCCD phải là tệp JPG, PNG hoặc WEBP.'))
  if (file.size > MAX_IDENTITY_IMAGE_SIZE) return reject(new Error('Mỗi ảnh CCCD không được vượt quá 2 MB.'))
  const reader = new FileReader()
  reader.onerror = () => reject(new Error('Không thể đọc tệp ảnh CCCD.'))
  reader.onload = () => resolve(String(reader.result || ''))
  reader.readAsDataURL(file)
})

export function OfficeManagement() {
  const app = useApp()
  const allEmployees = Array.isArray(app.employees) ? app.employees : []
  const deletedEmployees = Array.isArray(app.deletedEmployees) ? app.deletedEmployees : []
  const allAttendance = Array.isArray(app.attendance) ? app.attendance : []
  const salaryAdjustments = Array.isArray(app.salaryAdjustments) ? app.salaryAdjustments : []
  const legacyOfficeAdjustments = Array.isArray(app.officeAdjustments) ? app.officeAdjustments : []
  const { addEmployee, updateEmployee, deleteEmployee, addSalaryAdjustment, notify } = app
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
  const editingRequiresPassword = Boolean(editingEmployee) && !(
    editingEmployee.authUserId || editingEmployee.authVersion || editingEmployee.passwordHash || editingEmployee.legacyPassword
  )
  const [adjustmentModal, setAdjustmentModal] = useState(false)
  const [adjustmentType, setAdjustmentType] = useState('Thưởng')
  const [adjustmentForm, setAdjustmentForm] = useState(emptyAdjustment)
  const [adjustmentErrors, setAdjustmentErrors] = useState([])
  const [adjustmentSaving, setAdjustmentSaving] = useState(false)
  const [payrollMonth, setPayrollMonth] = useState(today().slice(0, 7))
  const canManageOffice = app.session?.role === 'admin'

  useEffect(() => {
    const url = viewingImage?.url
    return () => {
      if (url?.startsWith('blob:')) URL.revokeObjectURL(url)
    }
  }, [viewingImage?.url])

  const employeeById = (id) => officeEmployees.find((employee) => String(employee.id) === String(id) || String(employeeCode(employee)) === String(id))
  const normalizedQuery = normalizeText(query)
  const filteredEmployees = officeEmployees.filter((employee) => {
    const haystack = [employeeCode(employee), employee.name, employee.cccd, employee.phone, employee.position, employee.workPosition, employee.role, addressLabel(employee)].join(' ').toLowerCase()
    return (!normalizedQuery || haystack.includes(normalizedQuery)) && (statusFilter === 'all' || employee.status === statusFilter)
  })
  const monthAttendance = officeAttendance.filter((record) => !payrollMonth || recordDate(record).startsWith(payrollMonth))
  const monthAdjustments = officeEmployees.flatMap((employee) => officeSalaryAdjustments({
    salaryAdjustments,
    legacyAdjustments: legacyOfficeAdjustments,
    employeeId: String(employee.id || employeeCode(employee)),
    period: payrollMonth,
  })).toSorted((left, right) => String(right.createdAt || right.date || '').localeCompare(String(left.createdAt || left.date || '')))
  const closedPayrollPeriod = (Array.isArray(app.payrollPeriods) ? app.payrollPeriods : []).find((item) => (
    String(item.storeId || '') === 'OFFICE'
    && String(item.period || '') === payrollMonth
    && !item.needsReclose
  ))
  const attendanceRows = officeAttendance.map((record) => {
    const employee = employeeById(recordEmployeeId(record))
    return { record, employee, label: attendanceLabel(record, employee) }
  })

  const openEmployeeCreate = () => {
    setEditingEmployee(null)
    setEmployeeForm({ ...emptyEmployee, code: nextOfficeEmployeeCodeFromState({ employees: allEmployees, deletedEmployees }) })
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
    setEmployeeErrors([])
    setShowPassword(false)
    setImageBusy('')
  }

  const updateEmployeeField = (field) => (event) => {
    let value = event.target.value
    if (field === 'cccd') value = value.replace(/\D/g, '').slice(0, 12)
    if (field === 'phone') value = value.replace(/\D/g, '').slice(0, 10)
    setEmployeeForm((current) => ({ ...current, [field]: value }))
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
    if (!canManageOffice) return
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
    if (!canManageOffice || !pendingDelete) return
    if (typeof deleteEmployee !== 'function') return notify?.('Chức năng xóa nhân viên đang được kết nối.', 'info')
    const result = await deleteEmployee(pendingDelete.id || employeeCode(pendingDelete))
    if (result?.ok === false) return notify?.(result.message || 'Không thể xóa nhân viên.', 'info')
    setPendingDelete(null)
  }

  const openAdjustment = (type) => {
    setAdjustmentType(type)
    setAdjustmentErrors([])
    setAdjustmentSaving(false)
    setAdjustmentForm({ ...emptyAdjustment, employeeId: officeEmployees[0]?.id || employeeCode(officeEmployees[0]) || '' })
    setAdjustmentModal(true)
  }

  const saveAdjustment = async (event) => {
    event?.preventDefault()
    if (!canManageOffice || adjustmentSaving) return
    const errors = []
    if (!adjustmentForm.date) errors.push('Vui lòng chọn ngày.')
    if (!adjustmentForm.employeeId) errors.push('Vui lòng chọn nhân viên.')
    if (parseMoneyInput(adjustmentForm.amount) <= 0) errors.push('Số tiền phải lớn hơn 0.')
    if (!adjustmentForm.content.trim()) errors.push('Vui lòng nhập nội dung.')
    if (errors.length) {
      setAdjustmentErrors(errors)
      return
    }
    setAdjustmentSaving(true)
    try {
      const result = await submitOfficeSalaryAdjustment({
        addSalaryAdjustment,
        form: adjustmentForm,
        type: adjustmentType,
      })
      if (!result?.ok) {
        setAdjustmentErrors([result?.message || 'Không thể lưu khoản lương thưởng.'])
        return
      }
      setAdjustmentModal(false)
    } catch (error) {
      setAdjustmentErrors([error?.message || 'Không thể lưu khoản lương thưởng.'])
      notify?.(error?.message || 'Không thể lưu khoản lương thưởng.', 'info')
    } finally {
      setAdjustmentSaving(false)
    }
  }

  const activeCount = officeEmployees.filter((employee) => employee.status === 'Đang làm việc').length
  const pausedCount = officeEmployees.filter((employee) => employee.status === 'Tạm ngưng' || employee.status === 'Tạm nghỉ').length
  const resignedCount = officeEmployees.filter((employee) => employee.status === 'Đã nghỉ việc').length
  const earlyCount = attendanceRows.filter((row) => row.label === 'Đi sớm').length
  const onTimeCount = attendanceRows.filter((row) => row.label === 'Đúng giờ').length
  const lateCount = attendanceRows.filter((row) => row.label === 'Đi trễ').length

  if (['manager', 'store_manager'].includes(app.session?.role)) {
    return <div className="page"><PageHeader title="KHÔNG CÓ QUYỀN TRUY CẬP" subtitle="Tài khoản Quản lý không được truy cập Khối văn phòng." icon={Users} /></div>
  }

  return (
    <div className="page">
      <PageHeader
        title="KHỐI VĂN PHÒNG"
        subtitle="Quản lý nhân sự, chấm công, thưởng, phụ cấp và lương văn phòng."
        icon={Users}
        actions={canManageOffice ? <><Button variant="outline" icon={Gift} onClick={() => openAdjustment('Thưởng')}>Tạo thưởng</Button><Button icon={Wallet} onClick={() => openAdjustment('Phụ cấp')}>Tạo phụ cấp</Button></> : null}
      />
      {!canManageOffice && <InfoNote>Chế độ chỉ xem. Chỉ Admin được thêm, sửa, xóa nhân viên hoặc tạo khoản lương thưởng.</InfoNote>}

      <div className="tabs">
        <button className={tab === 'employees' ? 'active' : ''} onClick={() => setTab('employees')}><Users />Nhân viên</button>
        <button className={tab === 'attendance' ? 'active' : ''} onClick={() => setTab('attendance')}><History />Chấm công</button>
        <button className={tab === 'payroll' ? 'active' : ''} onClick={() => setTab('payroll')}><Banknote />Thống kê lương</button>
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
            <div><SearchInput value={query} onChange={setQuery} placeholder="Tìm nhân viên..." />{canManageOffice && <Button icon={Plus} onClick={openEmployeeCreate}>Thêm nhân viên</Button>}</div>
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
                return <tr key={employee.id || employeeCode(employee)}><td><strong>{employeeCode(employee)}</strong></td><td><div className="person-cell"><Avatar name={employee.name} color={employee.color} /><span><strong>{employee.name}</strong><small>{employee.username || 'Chưa có tên đăng nhập'}</small></span></div></td><td><Badge tone={type === 'Full-Time' ? 'green' : type === 'Part-Time' ? 'blue' : 'orange'}>{type}</Badge></td><td><strong>{shortYearDate(employee.startDate || employee.joinDate)}</strong></td><td>{employee.cccd || employee.citizenId || '—'}</td><td>{employee.phone || '—'}</td><td className="address-cell">{addressLabel(employee)}</td><td>{employee.position || employee.workPosition || employee.role || '—'}</td><td><div className="identity-image-actions"><Badge tone={imageCount === 2 ? 'green' : 'orange'}>{imageCount}/2 ảnh</Badge>{Object.entries(images).map(([side, image]) => image ? <button key={side} type="button" onClick={() => viewSavedIdentityImage(side, employee)} disabled={Boolean(viewingSide)} aria-label={`Xem ${side === 'front' ? 'mặt trước' : 'mặt sau'} CCCD của ${employee.name}`} title={`Xem ${side === 'front' ? 'mặt trước' : 'mặt sau'} CCCD`}><Eye size={16} /><span>{side === 'front' ? 'Trước' : 'Sau'}</span></button> : null)}</div></td><td><Badge tone={employeeStatusTone(employee.status)}>{employee.status || EMPLOYEE_STATUSES[0]}</Badge></td>{canManageOffice && <td><div className="row-actions"><button onClick={() => openEmployeeEdit(employee)} aria-label={`Sửa ${employee.name}`}><Edit3 /></button><button className="danger" onClick={() => setPendingDelete(employee)} aria-label={`Xóa ${employee.name}`}><Trash2 /></button></div></td>}</tr>
              })}
              {!filteredEmployees.length && <tr><td colSpan={canManageOffice ? 11 : 10}>Chưa có nhân viên văn phòng phù hợp.</td></tr>}
            </tbody>
          </TableWrap>
          <TableFooter shown={filteredEmployees.length} total={filteredEmployees.length} />
        </Card>
      </>}

      {tab === 'attendance' && <>
        <div className="metric-grid metric-grid--four">
          <MetricCard label="Lượt điểm danh" value={attendanceRows.length} suffix="lượt" icon={History} tone="blue" compact />
          <MetricCard label="Đi sớm" value={earlyCount} suffix="lượt" icon={Clock3} tone="blue" compact />
          <MetricCard label="Đúng giờ" value={onTimeCount} suffix="lượt" icon={UserCheck} tone="green" compact />
          <MetricCard label="Đi trễ" value={lateCount} suffix="lượt" icon={Clock3} tone="orange" compact />
        </div>
        <Card title="Lịch sử điểm danh">
          <TableWrap>
            <thead><tr><th>Ngày</th><th>Nhân viên</th><th>Vị trí công việc</th><th>Giờ vào</th><th>Giờ ra</th><th>Số giờ</th><th>Trạng thái</th><th>Vị trí điểm danh</th></tr></thead>
            <tbody>
              {attendanceRows.map(({ record, employee, label }, index) => <tr key={record.id || `${recordEmployeeId(record)}-${recordDate(record)}-${index}`}><td><strong>{shortDate(recordDate(record))}</strong></td><td><div className="person-cell"><Avatar name={employee?.name || record.employeeName || 'NV'} color={employee?.color} /><span><strong>{employee?.name || record.employeeName || recordEmployeeId(record)}</strong><small>{employeeCode(employee)}</small></span></div></td><td>{employee?.position || employee?.workPosition || employee?.role || '—'}</td><td className="green-text"><strong>{checkInTime(record) || '—'}</strong></td><td><strong>{checkOutTime(record) || '—'}</strong></td><td>{hoursWorked(record).toFixed(2)} giờ</td><td><Badge tone={attendanceTone(label)}>{label}</Badge></td><td className="address-cell">{officeLocationLabel(record.locationName || record.checkInLocation || record.location || record.address)}</td></tr>)}
              {!attendanceRows.length && <tr><td colSpan="8">Chưa có lịch sử điểm danh của khối văn phòng.</td></tr>}
            </tbody>
          </TableWrap>
          <TableFooter shown={attendanceRows.length} total={attendanceRows.length} />
        </Card>
      </>}

      {tab === 'payroll' && <>
        <Card className="filter-card"><div className="filter-grid"><Field label="Tháng thống kê"><Input type="month" value={payrollMonth} onChange={(event) => setPayrollMonth(event.target.value)} /></Field><InfoNote>Ngày công chỉ được tính khi nhân viên đã ghi nhận ra về. Kỳ đã chốt ưu tiên bản lương trên máy chủ.</InfoNote></div></Card>
        <Card title="Thống kê ngày công và lương">
          <TableWrap>
            <thead><tr><th>Nhân viên</th><th>Vị trí</th><th>Ngày thực tế / quy định</th><th>Lương tháng</th><th>Lương theo công</th><th>Thưởng</th><th>Phụ cấp</th><th>Khấu trừ</th><th>Tổng nhận</th></tr></thead>
            <tbody>
              {officeEmployees.map((employee) => {
                const id = employee.id || employeeCode(employee)
                const employeeAttendance = monthAttendance.filter((record) => String(recordEmployeeId(record)) === String(id) || String(recordEmployeeId(record)) === String(employeeCode(employee)))
                const employeeAdjustments = monthAdjustments.filter((item) => String(adjustmentEmployeeId(item)) === String(id) || String(adjustmentEmployeeId(item)) === String(employeeCode(employee)))
                const payrollRow = (Array.isArray(closedPayrollPeriod?.rows) ? closedPayrollPeriod.rows : []).find((row) => String(row.employeeId || row.employeeCode || '') === String(id))
                const summary = officePayrollSummary({ records: employeeAttendance, employee, period: payrollMonth, historical: payrollMonth < today().slice(0, 7), payrollRow })
                const adjustmentTotals = officeAdjustmentTotals(employeeAdjustments)
                const total = summary.authoritative ? summary.gross : Math.max(0, summary.basePay + adjustmentTotals.net)
                return <tr key={id}><td><div className="person-cell"><Avatar name={employee.name} color={employee.color} /><span><strong>{employee.name}</strong><small>{employeeCode(employee)}</small></span></div></td><td>{employee.position || employee.workPosition || employee.role || '—'}</td><td><strong>{summary.actualDays} / {summary.requiredDays} ngày</strong></td><td>{money(summary.monthlySalary)}</td><td>{money(summary.basePay)}</td><td className="green-text">{money(adjustmentTotals.bonus)}</td><td className="orange-text">{money(adjustmentTotals.allowance)}</td><td className="red-text">{money(adjustmentTotals.deduction)}</td><td className="green-text"><strong>{money(total)}</strong>{summary.authoritative && <small className="table-note">Số liệu đã chốt</small>}</td></tr>
              })}
              {!officeEmployees.length && <tr><td colSpan="9">Chưa có dữ liệu lương nhân viên văn phòng.</td></tr>}
            </tbody>
          </TableWrap>
        </Card>
        <Card title="Lịch sử thưởng và phụ cấp">
          <TableWrap>
            <thead><tr><th>Ngày</th><th>Nhân viên</th><th>Loại</th><th>Số tiền</th><th>Nội dung</th></tr></thead>
            <tbody>{monthAdjustments.map((item, index) => <tr key={item.id || index}><td>{shortDate(adjustmentDate(item))}</td><td><strong>{employeeById(adjustmentEmployeeId(item))?.name || item.employeeName || adjustmentEmployeeId(item)}</strong></td><td><Badge tone={item.type === 'Thưởng khác' ? 'green' : item.type === 'Khấu trừ' ? 'red' : 'orange'}>{item.type}</Badge></td><td><strong>{money(item.amount)}</strong></td><td className="address-cell">{item.note || '—'}{item.source === 'legacy-office-adjustment' && <small className="table-note">Dữ liệu cũ</small>}</td></tr>)}{!monthAdjustments.length && <tr><td colSpan="5">Chưa có khoản thưởng hoặc phụ cấp trong tháng.</td></tr>}</tbody>
          </TableWrap>
        </Card>
      </>}

      <Modal
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
              return <Field key={side} label={label} required hint="JPG, PNG hoặc WEBP; tối đa 2 MB">
                <Input type="file" accept="image/jpeg,image/png,image/webp" aria-label={label} onChange={updateIdentityImage(side)} disabled={Boolean(imageBusy)} />
                {image && <small>{preview ? 'Đã chọn ảnh mới' : 'Ảnh đã được lưu riêng tư'}</small>}
                {preview && <img className="identity-image-preview" src={preview} alt={`Xem trước ${label.toLocaleLowerCase('vi-VN')}`} />}
                {image && !preview && editingEmployee && <Button type="button" variant="outline" icon={Eye} loading={viewingSide === `${editingEmployee.id || employeeCode(editingEmployee)}:${side}`} disabled={Boolean(viewingSide)} onClick={() => viewSavedIdentityImage(side)}>Xem ảnh đã lưu</Button>}
              </Field>
            })}
          </div>
          {imageBusy && <InfoNote>Đang đọc ảnh {imageBusy === 'front' ? 'mặt trước' : 'mặt sau'} CCCD…</InfoNote>}
          <h3>Tài khoản đăng nhập</h3>
          <div className="form-grid">
            <Field label="Tên đăng nhập" required><Input autoComplete="username" value={employeeForm.username} onChange={updateEmployeeField('username')} placeholder="Nhập tên đăng nhập" /></Field>
            <Field label="Mật khẩu" required={!editingEmployee || editingRequiresPassword} hint={editingEmployee && !editingRequiresPassword ? 'Để nguyên nếu không muốn đổi mật khẩu' : 'Bắt buộc để cấp tài khoản đăng nhập'}><span className="password-input"><Input type={showPassword ? 'text' : 'password'} autoComplete="new-password" value={employeeForm.password} onChange={updateEmployeeField('password')} placeholder={editingEmployee && !editingRequiresPassword ? 'Nhập mật khẩu mới nếu cần' : 'Nhập mật khẩu để cấp tài khoản'} /><button type="button" onClick={() => setShowPassword((current) => !current)} aria-label={showPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'} title={showPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}>{showPassword ? <EyeOff size={20} /> : <Eye size={20} />}</button></span></Field>
          </div>
          <InfoNote>Ảnh CCCD được lưu trong vùng riêng tư và chỉ tài khoản có quyền mới truy cập được. Hệ thống không hiển thị lại mật khẩu hiện tại.</InfoNote>
        </form>
      </Modal>

      <Modal open={Boolean(viewingImage)} onClose={() => setViewingImage(null)} title={viewingImage?.label || 'Ảnh CCCD'}>
        {viewingImage && <img className="identity-image-viewer" src={viewingImage.url} alt={viewingImage.label} />}
      </Modal>

      <Modal
        open={adjustmentModal}
        onClose={() => setAdjustmentModal(false)}
        title={`Tạo ${adjustmentType.toLowerCase()}`}
        footer={<><Button variant="outline" disabled={adjustmentSaving} onClick={() => setAdjustmentModal(false)}>Hủy</Button><Button icon={Save} loading={adjustmentSaving} disabled={adjustmentSaving} onClick={saveAdjustment}>LƯU</Button></>}
      >
        <form className="form-stack" onSubmit={saveAdjustment}>
          {adjustmentErrors.length > 0 && <InfoNote tone="orange"><ul>{adjustmentErrors.map((error) => <li key={error}>{error}</li>)}</ul></InfoNote>}
          <Field label="Ngày" required><Input icon={CalendarDays} type="date" value={adjustmentForm.date} onChange={(event) => setAdjustmentForm({ ...adjustmentForm, date: event.target.value })} /></Field>
          <Field label="Nhân viên" required><Select value={adjustmentForm.employeeId} onChange={(event) => setAdjustmentForm({ ...adjustmentForm, employeeId: event.target.value })}><option value="">Chọn nhân viên</option>{officeEmployees.filter((employee) => employee.status !== 'Đã nghỉ việc').map((employee) => <option key={employee.id || employeeCode(employee)} value={employee.id || employeeCode(employee)}>{employeeCode(employee)} — {employee.name}</option>)}</Select></Field>
          <Field label="Số tiền" required><Input inputMode="numeric" value={adjustmentForm.amount} onChange={(event) => setAdjustmentForm({ ...adjustmentForm, amount: formatMoneyInput(event.target.value) })} placeholder="2,000" /></Field>
          <Field label="Nội dung" required><textarea value={adjustmentForm.content} onChange={(event) => setAdjustmentForm({ ...adjustmentForm, content: event.target.value })} placeholder={`Nhập nội dung ${adjustmentType.toLowerCase()}`} /></Field>
        </form>
      </Modal>

      <Modal
        open={Boolean(pendingDelete)}
        onClose={() => setPendingDelete(null)}
        title="Xóa nhân viên văn phòng"
        footer={<><Button variant="outline" onClick={() => setPendingDelete(null)}>Hủy</Button><Button onClick={confirmDelete}>Xóa nhân viên</Button></>}
      >
        <InfoNote tone="orange">Bạn sắp xóa hồ sơ của <strong>{pendingDelete?.name}</strong>. Nên chuyển trạng thái sang “Đã nghỉ việc” nếu cần giữ lịch sử chấm công và lương.</InfoNote>
      </Modal>
    </div>
  )
}

export default OfficeManagement
