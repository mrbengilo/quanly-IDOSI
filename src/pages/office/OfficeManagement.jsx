import { useState } from 'react'
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
  Drawer,
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
import { formatMoneyInput, money, parseMoneyInput, shortDate, today } from '../../utils'
import {
  editableOfficeWorkdayTarget,
  officeAdjustmentTotals,
  officeLocationLabel,
  officePayrollSummary,
  officeSalaryAdjustments,
} from '../employee/officeAttendance'
import { submitOfficeSalaryAdjustment } from './officeSalaryAdjustment'

const EMPLOYEE_STATUSES = ['Đang làm việc', 'Tạm ngưng', 'Đã nghỉ việc']
const OFFICE_EMPLOYEE_TYPES = ['Chính thức', 'Thực tập sinh', 'Thử việc']
const PHONE_PATTERN = /^0\d{9}$/
const CCCD_PATTERN = /^\d{12}$/

const emptyEmployee = {
  code: '',
  name: '',
  cccd: '',
  phone: '',
  province: '',
  ward: '',
  street: '',
  salary: '',
  position: '',
  age: '',
  username: '',
  password: '',
  status: EMPLOYEE_STATUSES[0],
  officeEmployeeType: OFFICE_EMPLOYEE_TYPES[0],
  workStart: '08:00',
  workEnd: '17:00',
  standardWorkDaysPeriod: today().slice(0, 7),
  standardWorkDays: '26',
}

const emptyAdjustment = {
  date: today(),
  employeeId: '',
  amount: '',
  content: '',
}

const normalizeText = (value = '') => String(value).trim().toLowerCase()
const normalizePhone = (value = '') => value.replace(/[\s.()-]/g, '')
const employeeCode = (employee = {}) => employee.code || employee.employeeCode || employee.id || ''
const officeEmployeeType = (employee = {}) => employee.officeEmployeeType || employee.officeEmploymentType || employee.contractType || OFFICE_EMPLOYEE_TYPES[0]
const employeeTargetPeriod = (employee = {}) => employee.standardWorkDaysPeriod || today().slice(0, 7)
const employeeTargetDays = (employee = {}) => {
  const period = employeeTargetPeriod(employee)
  return Number(employee.monthlyWorkdayTargets?.[period] || employee.standardWorkDays || 26)
}

const nextOfficeEmployeeCode = (employees = []) => {
  const largestNumber = employees.reduce((largest, employee) => {
    const match = /^VP(\d+)$/i.exec(employeeCode(employee))
    return match ? Math.max(largest, Number(match[1])) : largest
  }, 0)
  return `VP${String(largestNumber + 1).padStart(3, '0')}`
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
  const targetPeriod = today().slice(0, 7)
  return {
    ...emptyEmployee,
    code: employeeCode(employee),
    name: employee.name || '',
    cccd: String(employee.cccd || employee.citizenId || ''),
    phone: employee.phone || '',
    province: address.province,
    ward: address.ward,
    street: address.street,
    salary: formatMoneyInput(employee.salary),
    position: employee.position || employee.workPosition || employee.role || '',
    age: employee.age ?? '',
    username: employee.username || '',
    password: '',
    status: employee.status || EMPLOYEE_STATUSES[0],
    officeEmployeeType: officeEmployeeType(employee),
    workStart: employee.workStart || '08:00',
    workEnd: employee.workEnd || '17:00',
    standardWorkDaysPeriod: targetPeriod,
    standardWorkDays: String(editableOfficeWorkdayTarget({ employee, period: targetPeriod })),
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

function validateEmployee(form, employees, editingKey, requiresPassword = !editingKey) {
  const errors = []
  const required = [
    ['Mã nhân viên', form.code],
    ['Tên nhân viên', form.name],
    ['Loại nhân viên', form.officeEmployeeType],
    ['Số CCCD', form.cccd],
    ['Số điện thoại', form.phone],
    ['Tỉnh/Thành phố', form.province],
    ['Phường/Xã', form.ward],
    ['Đường, số nhà', form.street],
    ['Lương', form.salary],
    ['Vị trí công việc', form.position],
    ['Tuổi', form.age],
    ['Tên đăng nhập', form.username],
    ['Giờ bắt đầu', form.workStart],
    ['Giờ kết thúc', form.workEnd],
    ['Tháng quy định ngày công', form.standardWorkDaysPeriod],
    ['Số ngày công quy định', form.standardWorkDays],
  ]

  required.forEach(([label, value]) => {
    if (!String(value ?? '').trim()) errors.push(`${label} là trường bắt buộc.`)
  })
  if (!CCCD_PATTERN.test(form.cccd)) errors.push('Số CCCD phải gồm đúng 12 chữ số.')
  if (!PHONE_PATTERN.test(normalizePhone(form.phone))) errors.push('Số điện thoại phải gồm đúng 10 chữ số và bắt đầu bằng số 0.')
  if (parseMoneyInput(form.salary) <= 0) errors.push('Lương phải là số lớn hơn 0.')
  if (!Number.isInteger(Number(form.age)) || Number(form.age) < 18 || Number(form.age) > 100) errors.push('Tuổi phải là số nguyên từ 18 đến 100.')
  if (!/^\d{2}:\d{2}$/u.test(form.workStart) || !/^\d{2}:\d{2}$/u.test(form.workEnd) || minutesFromTime(form.workStart) >= minutesFromTime(form.workEnd)) errors.push('Giờ làm phải đúng định dạng 24 giờ và giờ kết thúc phải sau giờ bắt đầu.')
  if (!/^\d{4}-\d{2}$/u.test(form.standardWorkDaysPeriod)) errors.push('Tháng quy định ngày công không hợp lệ.')
  if (!Number.isInteger(Number(form.standardWorkDays)) || Number(form.standardWorkDays) < 1 || Number(form.standardWorkDays) > 31) errors.push('Số ngày công quy định phải từ 1 đến 31.')
  if (requiresPassword && !form.password) errors.push('Mật khẩu là trường bắt buộc để cấp tài khoản đăng nhập.')

  const others = [
    ...employees.filter((item) => String(item.id || employeeCode(item)) !== String(editingKey || '')),
  ]
  if (others.some((item) => normalizeText(employeeCode(item)) === normalizeText(form.code))) errors.push('Mã nhân viên đã tồn tại.')
  if (others.some((item) => String(item.cccd || item.citizenId || '') === form.cccd)) errors.push('Số CCCD đã được sử dụng.')
  if (others.some((item) => normalizeText(item.username) === normalizeText(form.username))) errors.push('Tên đăng nhập đã tồn tại.')
  if (others.some((item) => normalizePhone(item.phone) === normalizePhone(form.phone))) errors.push('Số điện thoại đã được sử dụng.')
  return [...new Set(errors)]
}

export function OfficeManagement() {
  const app = useApp()
  const allEmployees = Array.isArray(app.employees) ? app.employees : []
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
    setEmployeeForm({ ...emptyEmployee, code: nextOfficeEmployeeCode(allEmployees) })
    setEmployeeErrors([])
    setShowPassword(false)
    setEmployeeDrawer(true)
  }

  const openEmployeeEdit = (employee) => {
    setEditingEmployee(employee)
    setEmployeeForm(employeeToForm(employee))
    setEmployeeErrors([])
    setShowPassword(false)
    setEmployeeDrawer(true)
  }

  const closeEmployeeDrawer = () => {
    setEmployeeDrawer(false)
    setEditingEmployee(null)
    setEmployeeErrors([])
    setShowPassword(false)
  }

  const updateEmployeeField = (field) => (event) => {
    let value = event.target.value
    if (field === 'cccd') value = value.replace(/\D/g, '').slice(0, 12)
    if (field === 'phone') value = value.replace(/\D/g, '').slice(0, 10)
    if (field === 'age') value = value.replace(/\D/g, '').slice(0, 3)
    if (field === 'standardWorkDays') value = value.replace(/\D/g, '').slice(0, 2)
    if (field === 'salary') value = formatMoneyInput(value)
    setEmployeeForm((current) => ({
      ...current,
      [field]: value,
      ...(field === 'standardWorkDaysPeriod'
        ? { standardWorkDays: String(editableOfficeWorkdayTarget({ employee: editingEmployee || {}, period: value })) }
        : {}),
    }))
  }

  const saveEmployee = async (event) => {
    event?.preventDefault()
    if (!canManageOffice) return
    const editingKey = editingEmployee?.id || (editingEmployee ? employeeCode(editingEmployee) : '')
    const errors = validateEmployee(employeeForm, allEmployees, editingKey, !editingEmployee || editingRequiresPassword)
    if (errors.length) {
      setEmployeeErrors(errors)
      notify?.('Vui lòng kiểm tra lại hồ sơ nhân viên văn phòng.', 'info')
      return
    }
    const address = [employeeForm.street.trim(), employeeForm.ward.trim(), employeeForm.province.trim()].join(', ')
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
      salary: parseMoneyInput(employeeForm.salary),
      position: employeeForm.position.trim(),
      workPosition: employeeForm.position.trim(),
      role: employeeForm.position.trim(),
      shortRole: employeeForm.position.trim(),
      age: Number(employeeForm.age),
      username: employeeForm.username.trim(),
      password: employeeForm.password,
      status: employeeForm.status,
      officeEmployeeType: employeeForm.officeEmployeeType,
      officeEmploymentType: employeeForm.officeEmployeeType,
      contractType: employeeForm.officeEmployeeType,
      workStart: employeeForm.workStart,
      workEnd: employeeForm.workEnd,
      standardWorkDays: Number(employeeForm.standardWorkDays),
      standardWorkDaysPeriod: employeeForm.standardWorkDaysPeriod,
      department: 'office',
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
            <thead><tr><th>Mã nhân viên</th><th>Nhân viên</th><th>Loại nhân viên</th><th>CCCD</th><th>Số điện thoại</th><th>Địa chỉ</th><th>Vị trí</th><th>Giờ làm / ngày công</th><th>Lương</th><th>Trạng thái</th>{canManageOffice && <th>Thao tác</th>}</tr></thead>
            <tbody>
              {filteredEmployees.map((employee) => <tr key={employee.id || employeeCode(employee)}><td><strong>{employeeCode(employee)}</strong></td><td><div className="person-cell"><Avatar name={employee.name} color={employee.color} /><span><strong>{employee.name}</strong><small>{employee.username || 'Chưa có tên đăng nhập'}</small></span></div></td><td><Badge tone={officeEmployeeType(employee) === 'Chính thức' ? 'green' : officeEmployeeType(employee) === 'Thử việc' ? 'orange' : 'blue'}>{officeEmployeeType(employee)}</Badge></td><td>{employee.cccd || employee.citizenId || '—'}</td><td>{employee.phone || '—'}</td><td className="address-cell">{addressLabel(employee)}</td><td>{employee.position || employee.workPosition || employee.role || '—'}</td><td><strong>{employee.workStart || '08:00'}–{employee.workEnd || '17:00'}</strong><small className="table-note">{employeeTargetPeriod(employee).split('-').reverse().join('/')}: {employeeTargetDays(employee)} ngày</small></td><td><strong>{money(employee.salary)}</strong></td><td><Badge tone={employeeStatusTone(employee.status)}>{employee.status || EMPLOYEE_STATUSES[0]}</Badge></td>{canManageOffice && <td><div className="row-actions"><button onClick={() => openEmployeeEdit(employee)} aria-label={`Sửa ${employee.name}`}><Edit3 /></button><button className="danger" onClick={() => setPendingDelete(employee)} aria-label={`Xóa ${employee.name}`}><Trash2 /></button></div></td>}</tr>)}
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

      <Drawer
        open={employeeDrawer}
        onClose={closeEmployeeDrawer}
        title={editingEmployee ? 'Cập nhật nhân viên văn phòng' : 'Thêm nhân viên văn phòng'}
        footer={<><Button variant="outline" onClick={closeEmployeeDrawer}>Hủy bỏ</Button><Button icon={Save} onClick={saveEmployee}>{editingEmployee ? 'Lưu thay đổi' : 'Lưu nhân viên'}</Button></>}
      >
        <form className="form-stack" onSubmit={saveEmployee}>
          {employeeErrors.length > 0 && <InfoNote tone="orange"><strong>Thông tin chưa hợp lệ</strong><ul>{employeeErrors.map((error) => <li key={error}>{error}</li>)}</ul></InfoNote>}
          <h3>Thông tin nhân viên</h3>
          <div className="form-grid">
            <Field label="Mã nhân viên" required hint="Hệ thống tự phát sinh theo thứ tự VP001, VP002, ..."><Input value={employeeForm.code} readOnly /></Field>
            <Field label="Tên nhân viên" required><Input value={employeeForm.name} onChange={updateEmployeeField('name')} placeholder="Nhập họ và tên" /></Field>
            <Field label="Loại nhân viên" required><Select value={employeeForm.officeEmployeeType} onChange={updateEmployeeField('officeEmployeeType')}>{OFFICE_EMPLOYEE_TYPES.map((type) => <option key={type}>{type}</option>)}</Select></Field>
            <Field label="Số CCCD" required hint="Chỉ gồm đúng 12 chữ số"><Input inputMode="numeric" maxLength={12} value={employeeForm.cccd} onChange={updateEmployeeField('cccd')} placeholder="012345678901" /></Field>
            <Field label="Số điện thoại" required hint="Đủ 10 số và bắt đầu bằng 0"><Input type="tel" inputMode="numeric" maxLength={10} value={employeeForm.phone} onChange={updateEmployeeField('phone')} placeholder="0901234567" /></Field>
            <Field label="Lương" required><Input inputMode="numeric" value={employeeForm.salary} onChange={updateEmployeeField('salary')} placeholder="8,000,000" /></Field>
            <Field label="Vị trí công việc" required><Input value={employeeForm.position} onChange={updateEmployeeField('position')} placeholder="Ví dụ: Kế toán" /></Field>
            <Field label="Tuổi" required><Input inputMode="numeric" min="18" max="100" value={employeeForm.age} onChange={updateEmployeeField('age')} placeholder="Ví dụ: 26" /></Field>
          </div>
          <h3>Giờ làm và ngày công quy định</h3>
          <div className="form-grid">
            <Field label="Giờ bắt đầu" required hint="Định dạng 24 giờ"><Input type="time" value={employeeForm.workStart} onChange={updateEmployeeField('workStart')} /></Field>
            <Field label="Giờ kết thúc" required hint="Định dạng 24 giờ"><Input type="time" value={employeeForm.workEnd} onChange={updateEmployeeField('workEnd')} /></Field>
            <Field label="Tháng áp dụng" required><Input type="month" value={employeeForm.standardWorkDaysPeriod} onChange={updateEmployeeField('standardWorkDaysPeriod')} /></Field>
            <Field label="Số ngày công quy định" required hint="Từ 1 đến 31 ngày"><Input type="number" inputMode="numeric" min="1" max="31" step="1" value={employeeForm.standardWorkDays} onChange={updateEmployeeField('standardWorkDays')} /></Field>
          </div>
          <h3>Địa chỉ</h3>
          <div className="form-grid">
            <Field label="Tỉnh / Thành phố" required><Input value={employeeForm.province} onChange={updateEmployeeField('province')} placeholder="Nhập tỉnh/thành phố" /></Field>
            <Field label="Phường / Xã" required><Input value={employeeForm.ward} onChange={updateEmployeeField('ward')} placeholder="Nhập phường/xã" /></Field>
            <Field label="Đường, số nhà" required className="span-2"><Input value={employeeForm.street} onChange={updateEmployeeField('street')} placeholder="Nhập số nhà và tên đường" /></Field>
          </div>
          <h3>Tài khoản đăng nhập</h3>
          <div className="form-grid">
            <Field label="Tên đăng nhập" required><Input autoComplete="username" value={employeeForm.username} onChange={updateEmployeeField('username')} placeholder="Nhập tên đăng nhập" /></Field>
            <Field label="Mật khẩu" required={!editingEmployee || editingRequiresPassword} hint={editingEmployee && !editingRequiresPassword ? 'Để nguyên nếu không muốn đổi mật khẩu' : 'Bắt buộc để cấp tài khoản đăng nhập'}><span className="password-input"><Input type={showPassword ? 'text' : 'password'} autoComplete="new-password" value={employeeForm.password} onChange={updateEmployeeField('password')} placeholder={editingEmployee && !editingRequiresPassword ? 'Nhập mật khẩu mới nếu cần' : 'Nhập mật khẩu để cấp tài khoản'} /><button type="button" onClick={() => setShowPassword((current) => !current)} aria-label={showPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'} title={showPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}>{showPassword ? <EyeOff size={20} /> : <Eye size={20} />}</button></span></Field>
          </div>
          <InfoNote>Vì an toàn dữ liệu, hệ thống chỉ lưu số CCCD và không lưu tệp ảnh CCCD.</InfoNote>
        </form>
      </Drawer>

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
