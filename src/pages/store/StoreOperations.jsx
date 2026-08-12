import { useState } from 'react'
import {
  BarChart3,
  Box,
  CalendarDays,
  Check,
  Clock3,
  Download,
  Edit3,
  Eye,
  Filter,
  Package,
  Plus,
  Save,
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
import { cashSeries, shifts } from '../../data'
import { useApp } from '../../state/AppContext'
import { downloadCsv, money } from '../../utils'

const shiftById = (id) => shifts.find((shift) => shift.id === id)

const EMPLOYEE_STATUSES = ['Đang làm việc', 'Tạm ngưng', 'Đã nghỉ việc']
const EMPLOYMENT_TYPES = ['Full-time', 'Part-time']
const PHONE_PATTERN = /^(?:\+84|84|0)(?:3|5|7|8|9)\d{8}$/
const CCCD_PATTERN = /^\d{12}$/
const emptyEmployeeForm = {
  id: '',
  name: '',
  cccd: '',
  phone: '',
  province: '',
  ward: '',
  street: '',
  salary: '',
  employmentType: 'Full-time',
  position: 'Nhân viên bán hàng',
  age: '',
  cccdImage: '',
  cccdImageName: '',
  username: '',
  password: '',
  status: 'Đang làm việc',
  storeId: '',
}

const normalizePhone = (value = '') => String(value).replace(/[\s.()-]/g, '')
const normalizeText = (value = '') => String(value).trim().toLowerCase()

const useStoreScope = () => {
  const app = useApp()
  const stores = Array.isArray(app.stores) ? app.stores : []
  const storeId = app.session?.storeId || app.activeStoreId || stores[0]?.id || ''
  const employees = (Array.isArray(app.employees) ? app.employees : []).filter((employee) =>
    employee.unit !== 'office' && String(employee.storeId || stores[0]?.id || '') === String(storeId),
  )
  const employeeIds = new Set(employees.map((employee) => String(employee.id)))
  const attendance = (Array.isArray(app.attendance) ? app.attendance : []).filter((record) =>
    record.storeId ? String(record.storeId) === String(storeId) : employeeIds.has(String(record.employeeId)),
  )
  const imports = (Array.isArray(app.imports) ? app.imports : []).filter((record) =>
    String(record.storeId || stores[0]?.id || '') === String(storeId),
  )
  const schedule = (Array.isArray(app.schedule) ? app.schedule : []).filter((record) => employeeIds.has(String(record.employeeId)))
  return { ...app, stores, storeId, activeStore: stores.find((store) => String(store.id) === String(storeId)) || stores[0], employees, attendance, imports, schedule }
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

const employeeType = (employee = {}) => employee.employmentType || employee.employeeType || employee.type || 'Full-time'
const employeePosition = (employee = {}) => employee.position || employee.role || 'Nhân viên bán hàng'

const employeeToForm = (employee = {}, storeId = '') => {
  const address = employeeAddressParts(employee)
  return {
    ...emptyEmployeeForm,
    id: employee.id || employee.code || employee.employeeCode || '',
    name: employee.name || employee.employeeName || '',
    cccd: String(employee.cccd || employee.citizenId || ''),
    phone: employee.phone || '',
    province: address.province,
    ward: address.ward,
    street: address.street,
    salary: employee.salary ?? '',
    employmentType: employeeType(employee),
    position: employeePosition(employee),
    age: employee.age ?? '',
    cccdImage: employee.cccdImage || employee.identityImage || '',
    cccdImageName: employee.cccdImageName || employee.identityImageName || '',
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

function validateEmployee(form, employees, editingId) {
  const errors = []
  const required = [
    ['Mã nhân viên', form.id],
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
    ['Cửa hàng', form.storeId],
  ]

  required.forEach(([label, value]) => {
    if (!String(value ?? '').trim()) errors.push(`${label} là trường bắt buộc.`)
  })
  if (!CCCD_PATTERN.test(form.cccd)) errors.push('Số CCCD phải gồm đúng 12 chữ số.')
  if (!PHONE_PATTERN.test(normalizePhone(form.phone))) errors.push('Số điện thoại Việt Nam không đúng định dạng.')
  if (!Number.isFinite(Number(form.salary)) || Number(form.salary) <= 0) errors.push('Lương phải là số lớn hơn 0.')
  if (!Number.isInteger(Number(form.age)) || Number(form.age) < 16 || Number(form.age) > 100) {
    errors.push('Tuổi phải là số nguyên từ 16 đến 100.')
  }
  if (!editingId && !form.password) errors.push('Mật khẩu là trường bắt buộc.')
  if (!editingId && !form.cccdImage) errors.push('Vui lòng chọn hình ảnh CCCD.')

  const others = employees.filter((employee) => String(employee.id || employee.code || '') !== String(editingId || ''))
  if (others.some((employee) => normalizeText(employee.id || employee.code || employee.employeeCode) === normalizeText(form.id))) {
    errors.push('Mã nhân viên đã tồn tại.')
  }
  if (others.some((employee) => String(employee.cccd || employee.citizenId || '') === form.cccd)) {
    errors.push('Số CCCD đã được sử dụng.')
  }
  if (others.some((employee) => normalizeText(employee.username) === normalizeText(form.username))) {
    errors.push('Tên đăng nhập đã tồn tại.')
  }
  if (others.some((employee) => normalizePhone(employee.phone) === normalizePhone(form.phone))) {
    errors.push('Số điện thoại đã được sử dụng.')
  }
  return [...new Set(errors)]
}

export function StoreOverview() {
  const { employees, attendance, imports, activeStore } = useStoreScope()
  const totalHours = attendance.reduce((sum, item) => sum + (Number(item.hours) || 0), 0)
  const importTotal = imports.reduce((sum, item) => sum + item.weight * item.price + item.shipping, 0)
  const storeName = activeStore?.name || 'IDOSI'
  return (
    <div className="page">
      <PageHeader title="Tổng quan cửa hàng" subtitle={`Chào buổi sáng! Đây là tình hình hoạt động của ${storeName} hôm nay.`} icon={Store} actions={<DateRange value="15/05/2025" />} />
      <div className="metric-grid metric-grid--four">
        <MetricCard label="Doanh thu hôm nay" value={money(18500000)} icon={BarChart3} trend={12.5} helper=" so với hôm qua" tone="green" />
        <MetricCard label="Chi phí hôm nay" value={money(6250000)} icon={Wallet} helper="6 khoản chi" tone="orange" />
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
  const { employees, schedule, notify } = useStoreScope()
  const [mode, setMode] = useState('day')
  const [open, setOpen] = useState(false)
  return (
    <div className="page">
      <PageHeader title="Ca làm việc" subtitle="Quản lý và phân ca làm việc cho nhân viên" actions={<><DateRange value="15/05/2025 (Thứ Năm)" /><Button icon={Plus} onClick={() => setOpen(true)}>Tạo lịch ca</Button><ExportButton onClick={() => downloadCsv('ca-lam-viec.csv', schedule)} /></>} />
      <div className="shift-summary-grid">
        {shifts.map((shift, index) => <Card key={shift.id} className={`shift-summary shift-summary--${shift.id}`}><div style={{ borderColor: shift.color }}><span style={{ color: shift.color }}>{shift.name}</span><strong>{shift.time}</strong><small><Users size={18} /> {[6, 7, 5][index]} nhân viên</small></div></Card>)}
        <Card className="day-overview"><h3>Tổng quan ngày 15/05/2025</h3><div><span><Clock3 />Tổng ca <b>3</b></span><span><Users />Tổng nhân viên <b>{employees.length}</b></span><span><CalendarDays />Tổng lượt ca <b>32</b></span></div></Card>
      </div>
      <Card className="schedule-card">
        <div className="tabs"><button className={mode === 'day' ? 'active' : ''} onClick={() => setMode('day')}>Lịch theo ngày</button><button className={mode === 'week' ? 'active' : ''} onClick={() => setMode('week')}>Lịch theo tuần</button></div>
        <div className="card__subheader"><h2>Lịch phân ca {mode === 'day' ? 'ngày 15/05/2025' : 'tuần 12/05 - 18/05'}</h2><div><Select defaultValue="all"><option value="all">Tất cả ca</option></Select><Select defaultValue="all"><option value="all">Tất cả vị trí</option></Select><Button variant="outline" icon={Filter}>Bộ lọc</Button></div></div>
        <ScheduleTable employees={employees} schedule={schedule} />
      </Card>
      <div className="bottom-info-grid">
        <Card title="Ghi chú"><ul className="plain-list"><li>Nhân viên có thể làm 1 đến 3 ca trong một ngày.</li><li>Mỗi ca có thể có nhiều nhân viên cùng làm việc.</li><li>Nhấp vào ca để xem chi tiết hoặc chỉnh sửa.</li></ul></Card>
        <Card title="Thông tin ca làm việc"><div className="shift-info-row">{shifts.map((shift) => <div key={shift.id} style={{ borderColor: shift.color }}><strong style={{ color: shift.color }}>{shift.name}</strong><span>{shift.time}</span><small>5 giờ</small></div>)}</div></Card>
        <Card title="Thống kê lượt ca trong ngày"><div className="shift-bars">{shifts.map((shift, index) => <p key={shift.id}><span>{shift.name}: {[12, 13, 7][index]} lượt</span><i><b style={{ width: `${[37.5, 40.6, 21.9][index]}%`, background: shift.color }} /></i></p>)}</div></Card>
      </div>
      <Modal open={open} onClose={() => setOpen(false)} title="Tạo lịch ca" footer={<><Button variant="outline" onClick={() => setOpen(false)}>Hủy</Button><Button icon={Save} onClick={() => { notify('Đã tạo lịch ca mới.'); setOpen(false) }}>Lưu lịch ca</Button></>}>
        <div className="form-grid"><Field label="Ngày áp dụng"><Input type="date" defaultValue="2025-05-15" /></Field><Field label="Ca làm"><Select defaultValue="ca1">{shifts.map((shift) => <option key={shift.id} value={shift.id}>{shift.name} • {shift.time}</option>)}</Select></Field><Field label="Ghi chú" className="span-2"><textarea placeholder="Nhập ghi chú..." /></Field></div>
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
        return <tr key={employee.id}><td><div className="person-cell"><Avatar name={employee.name} color={employee.color} /><span><strong>{employee.name}</strong><small>{employee.shortRole}</small></span></div></td>{shifts.map((shift) => <td key={shift.id}>{item?.shiftIds.includes(shift.id) ? <span className={`shift-chip shift-chip--${shift.id}`}><Clock3 />{shift.name} • {shift.time}</span> : '–'}</td>)}</tr>
      })}</tbody>
    </TableWrap>
  )
}

export function StoreSchedule() {
  const { employees, schedule, saveSchedule } = useStoreScope()
  const [open, setOpen] = useState(true)
  const [shiftId, setShiftId] = useState('ca1')
  const [selected, setSelected] = useState(() => employees.slice(0, 3).map((employee) => employee.id))
  const toggle = (id) => setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])
  const save = () => { saveSchedule(selected, shiftId); setOpen(false) }
  return (
    <div className="page">
      <PageHeader title="Lịch phân ca" subtitle="Tạo và quản lý lịch phân công ca làm việc cho nhân viên" actions={<><DateRange value="15/05/2025 (Thứ Năm)" /><Select defaultValue="week"><option value="week">Tuần này</option></Select><Button icon={Plus} onClick={() => setOpen(true)}>Tạo ca</Button></>} />
      <div className="schedule-summary">{shifts.map((shift, index) => <Card key={shift.id} className={`schedule-summary__item schedule-summary__item--${shift.id}`}><Clock3 style={{ color: shift.color }} /><div><span>{shift.name}</span><strong>{shift.time}</strong><small>{[6, 7, 5][index]} nhân viên</small></div></Card>)}<Card className="schedule-day-stats"><h3>Tổng quan ngày 15/05/2025</h3><div><span>Tổng ca<b>3</b></span><span>Nhân viên<b>{employees.length}</b></span><span>Ca trống<b>2</b></span><span>Tổng giờ<b>152.5</b></span></div></Card></div>
      <div className={`schedule-builder ${open ? 'schedule-builder--open' : ''}`}>
        <Card title="Danh sách lịch phân ca" className="schedule-builder__table"><ScheduleTable employees={employees} schedule={schedule} /><TableFooter shown={employees.length} total={employees.length} /></Card>
        {open && <Card className="schedule-panel">
          <div className="card__header"><h2>Tạo lịch phân ca</h2><button onClick={() => setOpen(false)}>×</button></div>
          <Field label="1. Chọn ngày"><Input type="date" defaultValue="2025-05-15" /></Field>
          <Field label="2. Chọn ca & thời gian"><div className="shift-selector">{shifts.map((shift) => <button key={shift.id} className={shiftId === shift.id ? 'active' : ''} style={{ '--shift-color': shift.color }} onClick={() => setShiftId(shift.id)}>{shift.name}{shiftId === shift.id && <Check />}</button>)}</div></Field>
          <div className="time-row"><Input type="time" value={shiftById(shiftId).start} readOnly /><span>–</span><Input type="time" value={shiftById(shiftId).end} readOnly /></div>
          <Field label="Tên ca (tùy chọn)"><Input placeholder="Ca sáng" /></Field>
          <Field label={`3. Chọn nhân viên • Đã chọn: ${selected.length}`}><SearchInput value="" onChange={() => {}} placeholder="Tìm kiếm nhân viên..." /></Field>
          <div className="employee-picker">{employees.map((employee) => <label key={employee.id} className={selected.includes(employee.id) ? 'selected' : ''}><input type="checkbox" checked={selected.includes(employee.id)} onChange={() => toggle(employee.id)} /><Avatar name={employee.name} color={employee.color} size={30} /><strong>{employee.name}</strong><small>{employee.shortRole}</small></label>)}</div>
          <Field label="4. Ghi chú (tùy chọn)"><textarea placeholder="Nhập ghi chú..." /></Field>
          <div className="panel-actions"><Button variant="outline" onClick={() => setOpen(false)}>Hủy</Button><Button onClick={save}>Lưu lịch ca</Button></div>
        </Card>}
      </div>
    </div>
  )
}

export function StoreEmployees() {
  const app = useApp()
  const employees = Array.isArray(app.employees) ? app.employees : []
  const stores = Array.isArray(app.stores) ? app.stores : []
  const { addEmployee, updateEmployee, deleteEmployee, notify, session, activeStoreId } = app
  const scopedStoreId = session?.storeId || activeStoreId || stores[0]?.id || ''
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('all')
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState({ ...emptyEmployeeForm, storeId: scopedStoreId })
  const [errors, setErrors] = useState([])

  const scopedEmployees = employees.filter((employee) => {
    if (employee.unit === 'office') return false
    if (!scopedStoreId) return true
    if (!employee.storeId) return String(scopedStoreId) === String(stores[0]?.id || scopedStoreId)
    return String(employee.storeId) === String(scopedStoreId)
  })

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
    setEditing(null)
    setErrors([])
    setForm({ ...emptyEmployeeForm, storeId: scopedStoreId })
    setOpen(true)
  }

  const openEdit = (employee) => {
    setEditing(employee)
    setErrors([])
    setForm(employeeToForm(employee, scopedStoreId))
    setOpen(true)
  }

  const closeDrawer = () => {
    setOpen(false)
    setEditing(null)
    setErrors([])
  }

  const updateField = (field) => (event) => {
    let value = event.target.value
    if (field === 'cccd') value = value.replace(/\D/g, '').slice(0, 12)
    if (field === 'age') value = value.replace(/\D/g, '').slice(0, 3)
    setForm((current) => ({ ...current, [field]: value }))
  }

  const chooseImage = (event) => {
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
    reader.onload = () => setForm((current) => ({
      ...current,
      cccdImage: String(reader.result || ''),
      cccdImageName: file.name,
    }))
    reader.readAsDataURL(file)
  }

  const save = (event) => {
    event?.preventDefault()
    const editingId = editing?.id || editing?.code || ''
    const validationErrors = validateEmployee(form, employees, editingId)
    if (validationErrors.length) {
      setErrors(validationErrors)
      notify?.('Vui lòng kiểm tra lại thông tin nhân viên.', 'info')
      return
    }

    const addressDetails = {
      province: form.province.trim(),
      ward: form.ward.trim(),
      street: form.street.trim(),
    }
    const payload = {
      id: form.id.trim(),
      code: form.id.trim(),
      employeeCode: form.id.trim(),
      name: form.name.trim(),
      cccd: form.cccd,
      citizenId: form.cccd,
      phone: form.phone.trim(),
      ...addressDetails,
      addressDetails,
      address: [addressDetails.street, addressDetails.ward, addressDetails.province].join(', '),
      salary: Number(form.salary),
      employmentType: form.employmentType,
      employeeType: form.employmentType,
      position: form.position.trim(),
      role: form.position.trim(),
      shortRole: form.position.replace(/^Nhân viên\s*/i, '') || form.position,
      age: Number(form.age),
      cccdImage: form.cccdImage,
      cccdImageName: form.cccdImageName,
      username: form.username.trim(),
      status: form.status,
      storeId: form.storeId,
      unit: 'store',
      ...(form.password ? { password: form.password } : {}),
    }

    if (editing) {
      if (typeof updateEmployee !== 'function') return notify?.('Chức năng cập nhật nhân viên đang được kết nối.', 'info')
      updateEmployee(editingId, payload)
    } else {
      if (typeof addEmployee !== 'function') return notify?.('Chức năng thêm nhân viên đang được kết nối.', 'info')
      addEmployee(payload)
    }
    closeDrawer()
  }

  const activeCount = scopedEmployees.filter((item) => item.status === 'Đang làm việc').length
  const pausedCount = scopedEmployees.filter((item) => item.status === 'Tạm ngưng' || item.status === 'Tạm nghỉ').length
  const stoppedCount = scopedEmployees.filter((item) => item.status === 'Đã nghỉ việc').length

  return (
    <div className="page">
      <PageHeader title="Quản lý nhân viên" subtitle="Thêm, sửa, xóa và quản lý hồ sơ nhân viên theo cửa hàng." actions={<><SearchInput value={query} onChange={setQuery} placeholder="Tìm mã, tên, CCCD..." /><Button icon={Plus} onClick={openCreate}>Thêm nhân viên</Button></>} />
      <div className="metric-grid metric-grid--four">
        <MetricCard label="Tổng nhân viên" value={scopedEmployees.length} helper="Thuộc cửa hàng đang chọn" icon={Users} tone="green" compact />
        <MetricCard label="Đang làm việc" value={activeCount} helper="Theo trạng thái" icon={UserCheck} tone="green" compact />
        <MetricCard label="Tạm ngưng" value={pausedCount} helper="Theo trạng thái" icon={Clock3} tone="orange" compact />
        <MetricCard label="Đã nghỉ việc" value={stoppedCount} helper="Theo trạng thái" icon={Users} tone="red" compact />
      </div>
      <div className="filter-pills"><button className={status === 'all' ? 'active' : ''} onClick={() => setStatus('all')}>Tất cả ({scopedEmployees.length})</button>{EMPLOYEE_STATUSES.map((item) => <button key={item} className={status === item ? 'active' : ''} onClick={() => setStatus(item)}>{item}</button>)}</div>
      <Card>
        <TableWrap>
          <thead><tr><th>Mã nhân viên</th><th>Nhân viên</th><th>Loại</th><th>Vị trí</th><th>CCCD</th><th>Liên hệ</th><th>Địa chỉ</th><th>Lương</th><th>Tài khoản</th><th>Trạng thái</th><th>Thao tác</th></tr></thead>
          <tbody>
            {filtered.map((employee) => {
              const normalizedStatus = employee.status === 'Tạm nghỉ' ? 'Tạm ngưng' : (employee.status || 'Đang làm việc')
              const type = employeeType(employee)
              return <tr key={employee.id}>
                <td><strong>{employee.id}</strong></td>
                <td><div className="person-cell"><Avatar name={employee.name} color={employee.color} /><span><strong>{employee.name}</strong><small>{employee.age ? `${employee.age} tuổi` : 'Chưa cập nhật tuổi'}</small></span></div></td>
                <td><Badge tone={type === 'Full-time' ? 'blue' : 'green'}>{type}</Badge></td>
                <td>{employeePosition(employee)}</td>
                <td>{employee.cccd || employee.citizenId || '—'}<small className="table-sub">{employee.cccdImageName || employee.identityImageName || 'Chưa có ảnh'}</small></td>
                <td>{employee.phone || '—'}</td>
                <td className="address-cell">{employeeAddressLabel(employee)}</td>
                <td><strong>{employee.salary ? money(employee.salary) : '—'}</strong></td>
                <td>{employee.username || '—'}</td>
                <td><Badge tone={employeeStatusTone(normalizedStatus)}>{normalizedStatus}</Badge></td>
                <td><div className="row-actions"><button onClick={() => openEdit(employee)} aria-label={`Sửa ${employee.name}`}><Edit3 /></button><button className="danger" onClick={() => window.confirm(`Xóa ${employee.name}?`) && deleteEmployee?.(employee.id)} aria-label={`Xóa ${employee.name}`}><Trash2 /></button></div></td>
              </tr>
            })}
            {!filtered.length && <tr><td colSpan="11">Không có nhân viên phù hợp.</td></tr>}
          </tbody>
        </TableWrap>
        <TableFooter shown={filtered.length} total={filtered.length} />
      </Card>
      <Drawer open={open} onClose={closeDrawer} title={editing ? 'Cập nhật nhân viên' : 'Thêm nhân viên'} footer={<><Button type="button" variant="outline" onClick={closeDrawer}>Hủy bỏ</Button><Button type="button" icon={Save} onClick={save}>{editing ? 'Lưu thay đổi' : 'Lưu nhân viên'}</Button></>}>
        <form className="form-stack" onSubmit={save}>
          {errors.length > 0 && <InfoNote tone="orange"><strong>Thông tin chưa hợp lệ</strong><ul>{errors.map((error) => <li key={error}>{error}</li>)}</ul></InfoNote>}
          <h3>Thông tin nhân viên</h3>
          <div className="form-grid">
            <Field label="Mã nhân viên" required hint={editing ? 'Mã nhân viên không thay đổi sau khi tạo' : ''}><Input value={form.id} onChange={updateField('id')} disabled={Boolean(editing)} placeholder="Ví dụ: NV009" /></Field>
            <Field label="Tên nhân viên" required><Input value={form.name} onChange={updateField('name')} placeholder="Nhập họ và tên" /></Field>
            <Field label="Số CCCD" required hint="Chỉ gồm đúng 12 chữ số"><Input inputMode="numeric" maxLength={12} value={form.cccd} onChange={updateField('cccd')} placeholder="012345678901" /></Field>
            <Field label="Số điện thoại" required><Input type="tel" value={form.phone} onChange={updateField('phone')} placeholder="0901234567" /></Field>
            <Field label="Lương" required><Input type="number" min="1" value={form.salary} onChange={updateField('salary')} placeholder="Nhập mức lương" /></Field>
            <Field label="Tuổi" required><Input inputMode="numeric" min="16" max="100" value={form.age} onChange={updateField('age')} placeholder="Ví dụ: 22" /></Field>
            <Field label="Loại nhân viên" required><Select value={form.employmentType} onChange={updateField('employmentType')}>{EMPLOYMENT_TYPES.map((type) => <option key={type}>{type}</option>)}</Select></Field>
            <Field label="Vị trí công việc" required><Select value={form.position} onChange={updateField('position')}><option>Nhân viên bán hàng</option><option>Nhân viên thu ngân</option><option>Nhân viên kho</option><option>Trưởng ca</option><option>Khác</option></Select></Field>
            <Field label="Trạng thái" required><Select value={form.status} onChange={updateField('status')}>{EMPLOYEE_STATUSES.map((item) => <option key={item}>{item}</option>)}</Select></Field>
            <Field label="Cửa hàng" required><Select value={form.storeId} onChange={updateField('storeId')} disabled={Boolean(session?.storeId)}><option value="">Chọn cửa hàng</option>{stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}</Select></Field>
          </div>
          <h3>Địa chỉ</h3>
          <div className="form-grid">
            <Field label="Tỉnh / Thành phố" required><Input value={form.province} onChange={updateField('province')} placeholder="Ví dụ: TP. Hồ Chí Minh" /></Field>
            <Field label="Phường / Xã" required><Input value={form.ward} onChange={updateField('ward')} placeholder="Nhập phường/xã" /></Field>
            <Field label="Đường, số nhà" required className="span-2"><Input value={form.street} onChange={updateField('street')} placeholder="Nhập số nhà và tên đường" /></Field>
          </div>
          <h3>Tài khoản đăng nhập</h3>
          <div className="form-grid">
            <Field label="Tên đăng nhập" required><Input autoComplete="username" value={form.username} onChange={updateField('username')} placeholder="Ví dụ: nguyenvana" /></Field>
            <Field label="Mật khẩu" required={!editing} hint={editing ? 'Để trống nếu không muốn đổi mật khẩu' : ''}><Input type="password" autoComplete="new-password" value={form.password} onChange={updateField('password')} placeholder={editing ? 'Nhập mật khẩu mới nếu cần' : 'Nhập mật khẩu'} /></Field>
          </div>
          <Field label="Hình ảnh CCCD" required={!editing} hint="JPG hoặc PNG, tối đa 5MB">
            <label className="upload-box">
              {form.cccdImage ? <img src={form.cccdImage} alt="Xem trước CCCD" style={{ maxWidth: '100%', maxHeight: 120, borderRadius: 8 }} /> : <Download />}
              <b>{form.cccdImageName || 'Chọn ảnh CCCD'}</b>
              <small>{form.cccdImageName ? 'Bấm để chọn ảnh khác' : 'Chỉ hỗ trợ JPG, PNG. Tối đa 5MB'}</small>
              <input type="file" accept="image/jpeg,image/png" onChange={chooseImage} />
            </label>
          </Field>
        </form>
      </Drawer>
    </div>
  )
}

export function StoreImports() {
  const { imports, addImport, deleteImport, notify } = useStoreScope()
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const empty = { name: '', category: 'Thời trang nữ', quantity: 1, unit: 'Bao', weight: '', price: '', shipping: 0, note: '' }
  const [form, setForm] = useState(empty)
  const filtered = imports.filter((item) => item.name.toLowerCase().includes(query.toLowerCase()))
  const totalWeight = imports.reduce((sum, item) => sum + Number(item.weight), 0)
  const totalCost = imports.reduce((sum, item) => sum + Number(item.weight) * Number(item.price) + Number(item.shipping), 0)
  const formTotal = Number(form.weight) * Number(form.price) + Number(form.shipping)
  const save = (event) => {
    event.preventDefault()
    if (!form.name || !form.weight || !form.price) return notify('Vui lòng nhập đủ thông tin mặt hàng.', 'info')
    addImport({ ...form, quantity: Number(form.quantity), weight: Number(form.weight), price: Number(form.price), shipping: Number(form.shipping) })
    setForm(empty)
    setOpen(false)
  }
  return (
    <div className="page">
      <PageHeader title="Nhập hàng" subtitle="Quản lý danh sách mặt hàng nhập kho" actions={<><DateRange value="01/05/2025 - 15/05/2025" /><Button variant="outline" icon={Filter}>Bộ lọc</Button><Button icon={Plus} onClick={() => setOpen(true)}>Thêm mặt hàng</Button></>} />
      <div className="metric-grid metric-grid--four">
        <MetricCard label="Tổng mặt hàng" value={imports.length} icon={Package} helper="+5 so với tuần trước" tone="green" compact />
        <MetricCard label="Tổng số lượng" value={imports.reduce((sum, item) => sum + Number(item.quantity), 0)} suffix="bao" icon={Box} helper="+18 bao" tone="blue" compact />
        <MetricCard label="Tổng cân nặng" value={totalWeight.toFixed(1)} suffix="kg" icon={Weight} helper="+125.3 kg" tone="purple" compact />
        <MetricCard label="Tổng chi phí nhập" value={money(totalCost)} icon={Wallet} helper="+12.450.000đ" tone="orange" compact />
      </div>
      <Card>
        <div className="card__subheader"><SearchInput value={query} onChange={setQuery} placeholder="Tìm kiếm mặt hàng..." /><Select defaultValue="all"><option value="all">Tất cả danh mục</option><option>Thời trang nữ</option><option>Thời trang nam</option></Select></div>
        <TableWrap><thead><tr><th>STT</th><th>Tên mặt hàng</th><th>Số lượng</th><th>Đơn vị</th><th>Cân nặng</th><th>Đơn giá nhập</th><th>Phí vận chuyển</th><th>Thành tiền</th><th>Hành động</th></tr></thead><tbody>{filtered.map((item, index) => <tr key={item.id}><td>{index + 1}</td><td><div className="product-cell"><span>{['👗', '👔', '🥻', '👚', '👜'][index % 5]}</span><strong>{item.name}</strong></div></td><td><Badge>{item.quantity}</Badge></td><td>{item.unit}</td><td>{item.weight} kg</td><td>{money(item.price)}/kg</td><td>{money(item.shipping)}</td><td><strong>{money(item.weight * item.price + item.shipping)}</strong></td><td><div className="row-actions"><button onClick={() => notify('Chỉnh sửa mặt hàng.', 'info')}><Edit3 /></button><button className="danger" onClick={() => window.confirm(`Xóa ${item.name}?`) && deleteImport(item.id)}><Trash2 /></button></div></td></tr>)}</tbody></TableWrap>
        <TableFooter shown={filtered.length} total={filtered.length} />
      </Card>
      <Card title="Lịch sử nhập hàng" action={<div className="filter-pills compact"><button className="active">Tất cả</button><button>Hôm nay</button><button>Tuần này</button><button>Tháng này</button></div>}>
        <TableWrap><thead><tr><th>Ngày nhập</th><th>Mặt hàng</th><th>Số lượng</th><th>Cân nặng</th><th>Đơn giá</th><th>Phí VC</th><th>Thành tiền</th><th>Người nhập</th><th>Thao tác</th></tr></thead><tbody>{filtered.map((item) => <tr key={item.id}><td>{item.createdAt}</td><td>{item.name}</td><td>{item.quantity}</td><td>{item.weight}</td><td>{money(item.price)}</td><td>{money(item.shipping)}</td><td><strong>{money(item.weight * item.price + item.shipping)}</strong></td><td>{item.creator}</td><td><Eye size={16} /></td></tr>)}</tbody></TableWrap>
      </Card>
      <Drawer open={open} onClose={() => setOpen(false)} title="Thêm mặt hàng" footer={<><Button variant="outline" onClick={() => setOpen(false)}>Hủy</Button><Button icon={Save} onClick={save}>Lưu mặt hàng</Button></>}>
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
