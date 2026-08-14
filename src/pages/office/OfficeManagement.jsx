import { useState } from 'react'
import {
  Banknote,
  CalendarDays,
  Clock3,
  Edit3,
  FileImage,
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
import { money, shortDate, today } from '../../utils'

const EMPLOYEE_STATUSES = ['Đang làm việc', 'Tạm ngưng', 'Đã nghỉ việc']
const PHONE_PATTERN = /^(?:\+84|84|0)(?:3|5|7|8|9)\d{8}$/
const CCCD_PATTERN = /^\d{12}$/
const STANDARD_WORK_DAYS = 26

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
  cccdImage: '',
  cccdImageName: '',
  username: '',
  password: '',
  status: EMPLOYEE_STATUSES[0],
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
    salary: employee.salary ?? '',
    position: employee.position || employee.workPosition || employee.role || '',
    age: employee.age ?? '',
    cccdImage: employee.cccdImage || employee.identityImage || '',
    cccdImageName: employee.cccdImageName || employee.identityImageName || '',
    username: employee.username || '',
    password: '',
    status: employee.status || EMPLOYEE_STATUSES[0],
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

const adjustmentKind = (adjustment = {}) => adjustment.type || adjustment.kind || adjustment.adjustmentType || ''
const adjustmentEmployeeId = (adjustment = {}) => adjustment.employeeId || adjustment.staffId || ''
const adjustmentDate = (adjustment = {}) => adjustment.date || adjustment.createdDate || String(adjustment.createdAt || '').slice(0, 10)

function validateEmployee(form, employees, editingKey) {
  const errors = []
  const required = [
    ['Mã nhân viên', form.code],
    ['Tên nhân viên', form.name],
    ['Số CCCD', form.cccd],
    ['Số điện thoại', form.phone],
    ['Tỉnh/Thành phố', form.province],
    ['Phường/Xã', form.ward],
    ['Đường, số nhà', form.street],
    ['Lương', form.salary],
    ['Vị trí công việc', form.position],
    ['Tuổi', form.age],
    ['Tên đăng nhập', form.username],
  ]

  required.forEach(([label, value]) => {
    if (!String(value ?? '').trim()) errors.push(`${label} là trường bắt buộc.`)
  })
  if (!CCCD_PATTERN.test(form.cccd)) errors.push('Số CCCD phải gồm đúng 12 chữ số.')
  if (!PHONE_PATTERN.test(normalizePhone(form.phone))) errors.push('Số điện thoại Việt Nam không đúng định dạng.')
  if (!Number.isFinite(Number(form.salary)) || Number(form.salary) <= 0) errors.push('Lương phải là số lớn hơn 0.')
  if (!Number.isInteger(Number(form.age)) || Number(form.age) < 18 || Number(form.age) > 100) errors.push('Tuổi phải là số nguyên từ 18 đến 100.')
  if (!editingKey && !form.password) errors.push('Mật khẩu là trường bắt buộc.')
  if (!editingKey && !form.cccdImage) errors.push('Vui lòng chọn hình ảnh CCCD.')

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
  const adjustments = Array.isArray(app.officeAdjustments) ? app.officeAdjustments : []
  const { addEmployee, updateEmployee, deleteEmployee, addOfficeAdjustment, notify } = app
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
  const [adjustmentModal, setAdjustmentModal] = useState(false)
  const [adjustmentType, setAdjustmentType] = useState('Thưởng')
  const [adjustmentForm, setAdjustmentForm] = useState(emptyAdjustment)
  const [adjustmentErrors, setAdjustmentErrors] = useState([])
  const [payrollMonth, setPayrollMonth] = useState(today().slice(0, 7))

  const employeeById = (id) => officeEmployees.find((employee) => String(employee.id) === String(id) || String(employeeCode(employee)) === String(id))
  const normalizedQuery = normalizeText(query)
  const filteredEmployees = officeEmployees.filter((employee) => {
    const haystack = [employeeCode(employee), employee.name, employee.cccd, employee.phone, employee.position, employee.workPosition, employee.role, addressLabel(employee)].join(' ').toLowerCase()
    return (!normalizedQuery || haystack.includes(normalizedQuery)) && (statusFilter === 'all' || employee.status === statusFilter)
  })
  const monthAttendance = officeAttendance.filter((record) => !payrollMonth || recordDate(record).startsWith(payrollMonth))
  const monthAdjustments = adjustments.filter((adjustment) => !payrollMonth || adjustmentDate(adjustment).startsWith(payrollMonth))
  const attendanceRows = officeAttendance.map((record) => {
    const employee = employeeById(recordEmployeeId(record))
    return { record, employee, label: attendanceLabel(record, employee) }
  })

  const openEmployeeCreate = () => {
    setEditingEmployee(null)
    setEmployeeForm(emptyEmployee)
    setEmployeeErrors([])
    setEmployeeDrawer(true)
  }

  const openEmployeeEdit = (employee) => {
    setEditingEmployee(employee)
    setEmployeeForm(employeeToForm(employee))
    setEmployeeErrors([])
    setEmployeeDrawer(true)
  }

  const closeEmployeeDrawer = () => {
    setEmployeeDrawer(false)
    setEditingEmployee(null)
    setEmployeeErrors([])
  }

  const updateEmployeeField = (field) => (event) => {
    let value = event.target.value
    if (field === 'cccd') value = value.replace(/\D/g, '').slice(0, 12)
    if (field === 'age') value = value.replace(/\D/g, '').slice(0, 3)
    setEmployeeForm((current) => ({ ...current, [field]: value }))
  }

  const chooseEmployeeImage = (event) => {
    const file = event.target.files?.[0]
    if (!file) return
    if (!['image/jpeg', 'image/png'].includes(file.type)) {
      notify?.('Ảnh CCCD chỉ hỗ trợ định dạng JPG hoặc PNG.', 'info')
      event.target.value = ''
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      notify?.('Ảnh CCCD không được vượt quá 5MB.', 'info')
      event.target.value = ''
      return
    }
    const reader = new FileReader()
    reader.onload = () => setEmployeeForm((current) => ({ ...current, cccdImage: String(reader.result || ''), cccdImageName: file.name }))
    reader.readAsDataURL(file)
  }

  const saveEmployee = async (event) => {
    event?.preventDefault()
    const editingKey = editingEmployee?.id || (editingEmployee ? employeeCode(editingEmployee) : '')
    const errors = validateEmployee(employeeForm, allEmployees, editingKey)
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
      salary: Number(employeeForm.salary),
      position: employeeForm.position.trim(),
      workPosition: employeeForm.position.trim(),
      role: employeeForm.position.trim(),
      shortRole: employeeForm.position.trim(),
      age: Number(employeeForm.age),
      cccdImage: employeeForm.cccdImage,
      cccdImageName: employeeForm.cccdImageName,
      username: employeeForm.username.trim(),
      password: employeeForm.password,
      status: employeeForm.status,
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

  const confirmDelete = () => {
    if (!pendingDelete) return
    if (typeof deleteEmployee !== 'function') return notify?.('Chức năng xóa nhân viên đang được kết nối.', 'info')
    deleteEmployee(pendingDelete.id || employeeCode(pendingDelete))
    setPendingDelete(null)
  }

  const openAdjustment = (type) => {
    setAdjustmentType(type)
    setAdjustmentErrors([])
    setAdjustmentForm({ ...emptyAdjustment, employeeId: officeEmployees[0]?.id || employeeCode(officeEmployees[0]) || '' })
    setAdjustmentModal(true)
  }

  const saveAdjustment = (event) => {
    event?.preventDefault()
    const errors = []
    if (!adjustmentForm.date) errors.push('Vui lòng chọn ngày.')
    if (!adjustmentForm.employeeId) errors.push('Vui lòng chọn nhân viên.')
    if (!Number.isFinite(Number(adjustmentForm.amount)) || Number(adjustmentForm.amount) <= 0) errors.push('Số tiền phải lớn hơn 0.')
    if (!adjustmentForm.content.trim()) errors.push('Vui lòng nhập nội dung.')
    if (errors.length) {
      setAdjustmentErrors(errors)
      return
    }
    if (typeof addOfficeAdjustment !== 'function') return notify?.('Chức năng thưởng và phụ cấp đang được kết nối.', 'info')
    const employee = employeeById(adjustmentForm.employeeId)
    addOfficeAdjustment({
      type: adjustmentType,
      kind: adjustmentType,
      adjustmentType,
      date: adjustmentForm.date,
      employeeId: adjustmentForm.employeeId,
      employeeName: employee?.name || '',
      amount: Number(adjustmentForm.amount),
      content: adjustmentForm.content.trim(),
    })
    setAdjustmentModal(false)
  }

  const activeCount = officeEmployees.filter((employee) => employee.status === 'Đang làm việc').length
  const pausedCount = officeEmployees.filter((employee) => employee.status === 'Tạm ngưng' || employee.status === 'Tạm nghỉ').length
  const resignedCount = officeEmployees.filter((employee) => employee.status === 'Đã nghỉ việc').length
  const earlyCount = attendanceRows.filter((row) => row.label === 'Đi sớm').length
  const onTimeCount = attendanceRows.filter((row) => row.label === 'Đúng giờ').length
  const lateCount = attendanceRows.filter((row) => row.label === 'Đi trễ').length

  return (
    <div className="page">
      <PageHeader
        title="KHỐI VĂN PHÒNG"
        subtitle="Quản lý nhân sự, chấm công, thưởng, phụ cấp và lương văn phòng."
        icon={Users}
        actions={<><Button variant="outline" icon={Gift} onClick={() => openAdjustment('Thưởng')}>Tạo thưởng</Button><Button icon={Wallet} onClick={() => openAdjustment('Phụ cấp')}>Tạo phụ cấp</Button></>}
      />

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
            <div><SearchInput value={query} onChange={setQuery} placeholder="Tìm nhân viên..." /><Button icon={Plus} onClick={openEmployeeCreate}>Thêm nhân viên</Button></div>
          </div>
          <TableWrap>
            <thead><tr><th>Mã nhân viên</th><th>Nhân viên</th><th>CCCD</th><th>Số điện thoại</th><th>Địa chỉ</th><th>Vị trí</th><th>Lương</th><th>Trạng thái</th><th>Thao tác</th></tr></thead>
            <tbody>
              {filteredEmployees.map((employee) => <tr key={employee.id || employeeCode(employee)}><td><strong>{employeeCode(employee)}</strong></td><td><div className="person-cell"><Avatar name={employee.name} color={employee.color} /><span><strong>{employee.name}</strong><small>{employee.username || 'Chưa có tên đăng nhập'}</small></span></div></td><td>{employee.cccd || employee.citizenId || '—'}</td><td>{employee.phone || '—'}</td><td className="address-cell">{addressLabel(employee)}</td><td>{employee.position || employee.workPosition || employee.role || '—'}</td><td><strong>{money(employee.salary)}</strong></td><td><Badge tone={employeeStatusTone(employee.status)}>{employee.status || EMPLOYEE_STATUSES[0]}</Badge></td><td><div className="row-actions"><button onClick={() => openEmployeeEdit(employee)} aria-label={`Sửa ${employee.name}`}><Edit3 /></button><button className="danger" onClick={() => setPendingDelete(employee)} aria-label={`Xóa ${employee.name}`}><Trash2 /></button></div></td></tr>)}
              {!filteredEmployees.length && <tr><td colSpan="9">Chưa có nhân viên văn phòng phù hợp.</td></tr>}
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
              {attendanceRows.map(({ record, employee, label }, index) => <tr key={record.id || `${recordEmployeeId(record)}-${recordDate(record)}-${index}`}><td><strong>{shortDate(recordDate(record))}</strong></td><td><div className="person-cell"><Avatar name={employee?.name || record.employeeName || 'NV'} color={employee?.color} /><span><strong>{employee?.name || record.employeeName || recordEmployeeId(record)}</strong><small>{employeeCode(employee)}</small></span></div></td><td>{employee?.position || employee?.workPosition || employee?.role || '—'}</td><td className="green-text"><strong>{checkInTime(record) || '—'}</strong></td><td><strong>{checkOutTime(record) || '—'}</strong></td><td>{hoursWorked(record).toFixed(2)} giờ</td><td><Badge tone={attendanceTone(label)}>{label}</Badge></td><td className="address-cell">{record.locationName || record.location || record.address || 'Chưa ghi nhận'}</td></tr>)}
              {!attendanceRows.length && <tr><td colSpan="8">Chưa có lịch sử điểm danh của khối văn phòng.</td></tr>}
            </tbody>
          </TableWrap>
          <TableFooter shown={attendanceRows.length} total={attendanceRows.length} />
        </Card>
      </>}

      {tab === 'payroll' && <>
        <Card className="filter-card"><div className="filter-grid"><Field label="Tháng thống kê"><Input type="month" value={payrollMonth} onChange={(event) => setPayrollMonth(event.target.value)} /></Field><InfoNote>Số ngày công được tính theo các ngày có bản ghi điểm danh. Lương công = lương tháng / {STANDARD_WORK_DAYS} × số ngày công.</InfoNote></div></Card>
        <Card title="Thống kê ngày công và lương">
          <TableWrap>
            <thead><tr><th>Nhân viên</th><th>Vị trí</th><th>Ngày công</th><th>Lương tháng</th><th>Lương theo công</th><th>Thưởng</th><th>Phụ cấp</th><th>Tổng nhận</th></tr></thead>
            <tbody>
              {officeEmployees.map((employee) => {
                const id = employee.id || employeeCode(employee)
                const employeeAttendance = monthAttendance.filter((record) => String(recordEmployeeId(record)) === String(id) || String(recordEmployeeId(record)) === String(employeeCode(employee)))
                const days = new Set(employeeAttendance.map(recordDate).filter(Boolean)).size
                const salary = Number(employee.salary) || 0
                const salaryByDays = Math.round((salary / STANDARD_WORK_DAYS) * Math.min(days, STANDARD_WORK_DAYS))
                const employeeAdjustments = monthAdjustments.filter((item) => String(adjustmentEmployeeId(item)) === String(id) || String(adjustmentEmployeeId(item)) === String(employeeCode(employee)))
                const bonus = employeeAdjustments.filter((item) => normalizeText(adjustmentKind(item)).includes('thưởng') || normalizeText(adjustmentKind(item)).includes('thuong')).reduce((sum, item) => sum + Number(item.amount || 0), 0)
                const allowance = employeeAdjustments.filter((item) => normalizeText(adjustmentKind(item)).includes('phụ cấp') || normalizeText(adjustmentKind(item)).includes('phu cap')).reduce((sum, item) => sum + Number(item.amount || 0), 0)
                return <tr key={id}><td><div className="person-cell"><Avatar name={employee.name} color={employee.color} /><span><strong>{employee.name}</strong><small>{employeeCode(employee)}</small></span></div></td><td>{employee.position || employee.workPosition || employee.role || '—'}</td><td><strong>{days} ngày</strong></td><td>{money(salary)}</td><td>{money(salaryByDays)}</td><td className="green-text">{money(bonus)}</td><td className="orange-text">{money(allowance)}</td><td className="green-text"><strong>{money(salaryByDays + bonus + allowance)}</strong></td></tr>
              })}
              {!officeEmployees.length && <tr><td colSpan="8">Chưa có dữ liệu lương nhân viên văn phòng.</td></tr>}
            </tbody>
          </TableWrap>
        </Card>
        <Card title="Lịch sử thưởng và phụ cấp">
          <TableWrap>
            <thead><tr><th>Ngày</th><th>Nhân viên</th><th>Loại</th><th>Số tiền</th><th>Nội dung</th></tr></thead>
            <tbody>{monthAdjustments.map((item, index) => <tr key={item.id || index}><td>{shortDate(adjustmentDate(item))}</td><td><strong>{employeeById(adjustmentEmployeeId(item))?.name || item.employeeName || adjustmentEmployeeId(item)}</strong></td><td><Badge tone={normalizeText(adjustmentKind(item)).includes('thưởng') ? 'green' : 'orange'}>{adjustmentKind(item)}</Badge></td><td><strong>{money(item.amount)}</strong></td><td className="address-cell">{item.content || item.note || '—'}</td></tr>)}{!monthAdjustments.length && <tr><td colSpan="5">Chưa có khoản thưởng hoặc phụ cấp trong tháng.</td></tr>}</tbody>
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
            <Field label="Mã nhân viên" required><Input value={employeeForm.code} onChange={updateEmployeeField('code')} placeholder="Ví dụ: VP001" /></Field>
            <Field label="Tên nhân viên" required><Input value={employeeForm.name} onChange={updateEmployeeField('name')} placeholder="Nhập họ và tên" /></Field>
            <Field label="Số CCCD" required hint="Chỉ gồm đúng 12 chữ số"><Input inputMode="numeric" maxLength={12} value={employeeForm.cccd} onChange={updateEmployeeField('cccd')} placeholder="012345678901" /></Field>
            <Field label="Số điện thoại" required><Input type="tel" value={employeeForm.phone} onChange={updateEmployeeField('phone')} placeholder="0901234567" /></Field>
            <Field label="Lương" required><Input type="number" min="1" value={employeeForm.salary} onChange={updateEmployeeField('salary')} placeholder="Nhập mức lương" /></Field>
            <Field label="Vị trí công việc" required><Input value={employeeForm.position} onChange={updateEmployeeField('position')} placeholder="Ví dụ: Kế toán" /></Field>
            <Field label="Tuổi" required><Input inputMode="numeric" min="18" max="100" value={employeeForm.age} onChange={updateEmployeeField('age')} placeholder="Ví dụ: 26" /></Field>
            <Field label="Trạng thái" required><Select value={employeeForm.status} onChange={updateEmployeeField('status')}>{EMPLOYEE_STATUSES.map((status) => <option key={status}>{status}</option>)}</Select></Field>
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
            <Field label="Mật khẩu" required={!editingEmployee} hint={editingEmployee ? 'Để nguyên nếu không muốn đổi mật khẩu' : ''}><Input type="password" autoComplete="new-password" value={employeeForm.password} onChange={updateEmployeeField('password')} placeholder={editingEmployee ? 'Nhập mật khẩu mới nếu cần' : 'Nhập mật khẩu'} /></Field>
          </div>
          <Field label="Hình ảnh CCCD" required={!editingEmployee} hint="JPG hoặc PNG, tối đa 5MB"><label className="upload-box"><FileImage /><b>{employeeForm.cccdImageName || 'Chọn ảnh CCCD'}</b><small>{employeeForm.cccdImageName ? 'Bấm để chọn ảnh khác' : 'Ảnh sẽ được kiểm tra trước khi lưu'}</small><input type="file" accept="image/jpeg,image/png" onChange={chooseEmployeeImage} /></label></Field>
        </form>
      </Drawer>

      <Modal
        open={adjustmentModal}
        onClose={() => setAdjustmentModal(false)}
        title={`Tạo ${adjustmentType.toLowerCase()}`}
        footer={<><Button variant="outline" onClick={() => setAdjustmentModal(false)}>Hủy</Button><Button icon={Save} onClick={saveAdjustment}>LƯU</Button></>}
      >
        <form className="form-stack" onSubmit={saveAdjustment}>
          {adjustmentErrors.length > 0 && <InfoNote tone="orange"><ul>{adjustmentErrors.map((error) => <li key={error}>{error}</li>)}</ul></InfoNote>}
          <Field label="Ngày" required><Input icon={CalendarDays} type="date" value={adjustmentForm.date} onChange={(event) => setAdjustmentForm({ ...adjustmentForm, date: event.target.value })} /></Field>
          <Field label="Nhân viên" required><Select value={adjustmentForm.employeeId} onChange={(event) => setAdjustmentForm({ ...adjustmentForm, employeeId: event.target.value })}><option value="">Chọn nhân viên</option>{officeEmployees.filter((employee) => employee.status !== 'Đã nghỉ việc').map((employee) => <option key={employee.id || employeeCode(employee)} value={employee.id || employeeCode(employee)}>{employeeCode(employee)} — {employee.name}</option>)}</Select></Field>
          <Field label="Số tiền" required><Input type="number" min="1" value={adjustmentForm.amount} onChange={(event) => setAdjustmentForm({ ...adjustmentForm, amount: event.target.value })} placeholder="Nhập số tiền" /></Field>
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
