import { useMemo, useState } from 'react'
import {
  BriefcaseBusiness,
  CalendarDays,
  Clock3,
  Edit3,
  Eye,
  EyeOff,
  History,
  Plus,
  Save,
  ShieldCheck,
  Store,
  Trash2,
  UserCheck,
  UserCog,
  Users,
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
import { formatMoneyInput, money, shortDate, today } from '../../utils'
import {
  officeArrivalMinutes,
  officeArrivalStatus,
  officeAttendanceRows,
  officeAttendanceStats,
  officeLocationLabel,
  officeRecordDate,
} from '../employee/officeAttendance'
import {
  EMPLOYEE_STATUSES,
  OFFICE_EMPLOYEE_TYPES,
  ROLE_KEYS,
  emptyRoleProfile,
  nextRoleCode,
  roleProfileAddress,
  roleProfileCode,
  roleProfilePayload,
  roleProfileToForm,
  roleProfilesFromApp,
  validateRoleProfile,
} from './roleManagementUtils'

const ROLE_CONFIG = Object.freeze({
  [ROLE_KEYS.businessSupport]: {
    title: 'NHÂN VIÊN HỖ TRỢ KD',
    subtitle: 'Quản lý hồ sơ, tài khoản, chấm công và mức độ chuyên cần của nhân viên hỗ trợ kinh doanh.',
    singular: 'nhân viên hỗ trợ kinh doanh',
    icon: BriefcaseBusiness,
    addMethod: 'addBusinessSupport',
    updateMethod: 'updateBusinessSupport',
    deleteMethod: 'deleteBusinessSupport',
  },
  [ROLE_KEYS.storeManager]: {
    title: 'QUẢN LÝ CỬA HÀNG',
    subtitle: 'Tạo tài khoản quản lý và gán chính xác cửa hàng được phép truy cập.',
    singular: 'quản lý cửa hàng',
    icon: UserCog,
    addMethod: 'addStoreManager',
    updateMethod: 'updateStoreManager',
    deleteMethod: 'deleteStoreManager',
  },
})

const normalize = (value = '') => String(value).trim().toLocaleLowerCase('vi-VN')
const recordEmployeeId = (record = {}) => String(record.employeeId || record.employeeCode || record.staffId || record.userId || '')

const profileType = (profile = {}) => (
  profile.officeEmployeeType
  || profile.officeEmploymentType
  || profile.contractType
  || profile.employmentType
  || profile.employeeType
  || OFFICE_EMPLOYEE_TYPES[0]
)

const statusTone = (status) => {
  if (status === 'Đang làm việc' || status === 'Đang hoạt động') return 'green'
  if (status === 'Đã nghỉ việc' || status === 'Ngưng hoạt động') return 'red'
  return 'orange'
}

const attendanceTone = (label) => {
  if (label === 'Đi sớm') return 'blue'
  if (label === 'Đi đúng giờ' || label === 'Đúng giờ') return 'green'
  if (label === 'Đi trễ') return 'orange'
  return 'red'
}

const ratingTone = (rating) => {
  if (rating === 'Chuyên cần tốt') return 'green'
  if (rating === 'Cần duy trì') return 'blue'
  if (rating === 'Cần cải thiện') return 'red'
  return 'orange'
}

const time24 = (value) => {
  const match = String(value || '').match(/(?:T|\s|^)(\d{1,2}):(\d{2})/u)
  return match ? `${String(match[1]).padStart(2, '0')}:${match[2]}` : '—'
}

const hoursWorked = (record = {}) => {
  const explicit = Number(record.hours)
  if (Number.isFinite(explicit) && explicit >= 0) return explicit
  const toMinutes = (value) => {
    const match = String(value || '').match(/(?:T|\s|^)(\d{1,2}):(\d{2})/u)
    return match ? Number(match[1]) * 60 + Number(match[2]) : null
  }
  const start = toMinutes(record.checkIn || record.checkInTime || record.checkInAt)
  const end = toMinutes(record.checkOut || record.checkOutTime || record.checkOutAt)
  if (start == null || end == null) return 0
  return Math.max(0, (end >= start ? end - start : end + 1440 - start) / 60)
}

function RoleProfileDrawer({
  config,
  editingProfile,
  errors,
  form,
  onChange,
  onClose,
  onSave,
  open,
  roleKey,
  requiresPassword,
  showPassword,
  stores,
  togglePassword,
}) {
  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={editingProfile ? `Cập nhật ${config.singular}` : `Thêm ${config.singular}`}
      footer={<><Button variant="outline" onClick={onClose}>Hủy bỏ</Button><Button icon={Save} onClick={onSave}>{editingProfile ? 'Lưu thay đổi' : 'Lưu tài khoản'}</Button></>}
    >
      <form className="form-stack" onSubmit={onSave}>
        {errors.length > 0 && <InfoNote tone="orange"><strong>Thông tin chưa hợp lệ</strong><ul>{errors.map((error) => <li key={error}>{error}</li>)}</ul></InfoNote>}

        {roleKey === ROLE_KEYS.storeManager && <>
          <h3>Cửa hàng quản lý</h3>
          <Field label="Cửa hàng quản lý" required hint={editingProfile ? 'Cửa hàng gắn với tài khoản và không thay đổi sau khi tạo.' : 'Tài khoản chỉ truy cập đúng cửa hàng đã chọn.'}>
            <Select icon={Store} value={form.storeId} onChange={onChange('storeId')} disabled={Boolean(editingProfile)}>
              <option value="">Chọn cửa hàng</option>
              {stores.map((store) => <option key={store.id} value={store.id}>{store.name} — {store.id}</option>)}
            </Select>
          </Field>
        </>}

        <h3>Thông tin nhân viên</h3>
        <div className="form-grid">
          <Field label="Mã nhân viên" required hint="Mã xem trước; máy chủ phát sinh mã chính thức khi lưu"><Input value={form.code} readOnly placeholder={roleKey === ROLE_KEYS.storeManager ? 'Chọn cửa hàng để xem mã' : ''} /></Field>
          <Field label="Tên nhân viên" required><Input value={form.name} onChange={onChange('name')} placeholder="Nhập họ và tên" /></Field>
          <Field label="Loại nhân viên" required><Select value={form.officeEmployeeType} onChange={onChange('officeEmployeeType')}>{OFFICE_EMPLOYEE_TYPES.map((type) => <option key={type}>{type}</option>)}</Select></Field>
          <Field label="Ngày bắt đầu làm" required><Input icon={CalendarDays} type="date" value={form.startDate} onChange={onChange('startDate')} /></Field>
          <Field label="Số CCCD" required hint="Chỉ gồm đúng 12 chữ số"><Input inputMode="numeric" maxLength={12} value={form.cccd} onChange={onChange('cccd')} placeholder="012345678901" /></Field>
          <Field label="Số điện thoại" required hint="Đủ 10 số và bắt đầu bằng 0"><Input type="tel" inputMode="numeric" maxLength={10} value={form.phone} onChange={onChange('phone')} placeholder="0901234567" /></Field>
          <Field label="Lương" required><Input inputMode="numeric" value={form.salary} onChange={onChange('salary')} placeholder="8,000,000" /></Field>
          <Field label="Vị trí công việc" required><Input value={form.position} onChange={onChange('position')} placeholder="Nhập vị trí" /></Field>
          <Field label="Tuổi" required><Input inputMode="numeric" min="18" max="100" value={form.age} onChange={onChange('age')} placeholder="Ví dụ: 26" /></Field>
        </div>

        <h3>Giờ làm và ngày công quy định</h3>
        <div className="form-grid">
          <Field label="Giờ bắt đầu" required hint="Định dạng 24 giờ"><Input type="time" value={form.workStart} onChange={onChange('workStart')} /></Field>
          <Field label="Giờ kết thúc" required hint="Định dạng 24 giờ"><Input type="time" value={form.workEnd} onChange={onChange('workEnd')} /></Field>
          <Field label="Tháng áp dụng" required><Input type="month" value={form.standardWorkDaysPeriod} onChange={onChange('standardWorkDaysPeriod')} /></Field>
          <Field label="Số ngày công quy định" required hint="Từ 1 đến 31 ngày"><Input type="number" inputMode="numeric" min="1" max="31" step="1" value={form.standardWorkDays} onChange={onChange('standardWorkDays')} /></Field>
        </div>

        <h3>Địa chỉ</h3>
        <div className="form-grid">
          <Field label="Tỉnh / Thành phố" required><Input value={form.province} onChange={onChange('province')} placeholder="Nhập tỉnh/thành phố" /></Field>
          <Field label="Phường / Xã" required><Input value={form.ward} onChange={onChange('ward')} placeholder="Nhập phường/xã" /></Field>
          <Field label="Đường, số nhà" required className="span-2"><Input value={form.street} onChange={onChange('street')} placeholder="Nhập số nhà và tên đường" /></Field>
        </div>

        <h3>Tài khoản đăng nhập</h3>
        <div className="form-grid">
          <Field label="Tên đăng nhập" required><Input autoComplete="username" value={form.username} onChange={onChange('username')} placeholder="Nhập tên đăng nhập" /></Field>
          <Field label="Mật khẩu" required={requiresPassword} hint={requiresPassword ? 'Ít nhất 8 ký tự để cấp tài khoản đăng nhập' : 'Để trống nếu không muốn đổi mật khẩu'}>
            <span className="password-input"><Input type={showPassword ? 'text' : 'password'} autoComplete="new-password" value={form.password} onChange={onChange('password')} placeholder={editingProfile ? 'Nhập mật khẩu mới nếu cần' : 'Nhập mật khẩu'} /><button type="button" onClick={togglePassword} aria-label={showPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'} title={showPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}>{showPassword ? <EyeOff size={20} /> : <Eye size={20} />}</button></span>
          </Field>
        </div>
        <InfoNote>Tài khoản chỉ được cấp quyền theo vai trò và phạm vi đã gán. Hệ thống không hiển thị lại mật khẩu hiện tại.</InfoNote>
      </form>
    </Drawer>
  )
}

function ProfileList({ config, onCreate, onDelete, onEdit, profiles, roleKey, stores }) {
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [storeFilter, setStoreFilter] = useState('all')
  const normalizedQuery = normalize(query)
  const rows = profiles.filter((profile) => {
    const searchable = [roleProfileCode(profile), profile.name, profile.username, profile.phone, profile.cccd, profile.position, roleProfileAddress(profile)].join(' ').toLocaleLowerCase('vi-VN')
    return (!normalizedQuery || searchable.includes(normalizedQuery))
      && (statusFilter === 'all' || profile.status === statusFilter)
      && (storeFilter === 'all' || profile.storeId === storeFilter || profile.assignedStoreId === storeFilter)
  })
  const activeCount = profiles.filter((profile) => !['Tạm ngưng', 'Đã nghỉ việc', 'Ngưng hoạt động'].includes(profile.status)).length
  const pausedCount = profiles.filter((profile) => ['Tạm ngưng', 'Tạm nghỉ'].includes(profile.status)).length
  const resignedCount = profiles.filter((profile) => profile.status === 'Đã nghỉ việc').length

  return <>
    <div className="metric-grid metric-grid--four">
      <MetricCard label="Tổng nhân sự" value={profiles.length} suffix="nhân viên" icon={Users} tone="blue" compact />
      <MetricCard label="Đang làm việc" value={activeCount} suffix="nhân viên" icon={UserCheck} tone="green" compact />
      <MetricCard label="Tạm ngưng" value={pausedCount} suffix="nhân viên" icon={Clock3} tone="orange" compact />
      <MetricCard label="Đã nghỉ việc" value={resignedCount} suffix="nhân viên" icon={Users} tone="red" compact />
    </div>
    <Card>
      <div className="card__subheader">
        <div className="filter-pills"><button type="button" className={statusFilter === 'all' ? 'active' : ''} onClick={() => setStatusFilter('all')}>Tất cả ({profiles.length})</button>{EMPLOYEE_STATUSES.map((status) => <button type="button" key={status} className={statusFilter === status ? 'active' : ''} onClick={() => setStatusFilter(status)}>{status}</button>)}</div>
        <div>
          <SearchInput value={query} onChange={setQuery} placeholder="Tìm mã, tên, CCCD..." />
          {roleKey === ROLE_KEYS.storeManager && <Select aria-label="Lọc theo cửa hàng" value={storeFilter} onChange={(event) => setStoreFilter(event.target.value)}><option value="all">Tất cả cửa hàng</option>{stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}</Select>}
          <Button icon={Plus} onClick={onCreate}>Thêm tài khoản</Button>
        </div>
      </div>
      <TableWrap>
        <thead><tr><th>Mã nhân viên</th><th>Nhân viên</th><th>Loại nhân viên</th><th>Ngày bắt đầu</th>{roleKey === ROLE_KEYS.storeManager && <th>Cửa hàng quản lý</th>}<th>Liên hệ / CCCD</th><th>Địa chỉ</th><th>Vị trí</th><th>Giờ làm / ngày công</th><th>Lương</th><th>Trạng thái</th><th>Thao tác</th></tr></thead>
        <tbody>
          {rows.map((profile) => {
            const storeId = profile.storeId === 'OFFICE' ? '' : profile.storeId || profile.assignedStoreId
            const store = stores.find((item) => item.id === storeId)
            const type = profileType(profile)
            return <tr key={profile.id || roleProfileCode(profile)}>
              <td><strong>{roleProfileCode(profile)}</strong></td>
              <td><div className="person-cell"><Avatar name={profile.name} color={profile.color} /><span><strong>{profile.name}</strong><small>{profile.username || 'Chưa có tên đăng nhập'}</small></span></div></td>
              <td><Badge tone={type === 'Chính thức' ? 'green' : type === 'Thử việc' ? 'orange' : 'blue'}>{type}</Badge></td>
              <td><strong>{shortDate(profile.startDate || profile.employmentStartDate || profile.hireDate) || '—'}</strong></td>
              {roleKey === ROLE_KEYS.storeManager && <td><strong>{store?.name || storeId || '—'}</strong><small className="table-note">{store?.id || ''}</small></td>}
              <td>{profile.phone || '—'}<small className="table-note">CCCD: {profile.cccd || profile.citizenId || '—'}</small></td>
              <td className="address-cell">{roleProfileAddress(profile)}</td>
              <td>{profile.position || profile.workPosition || '—'}</td>
              <td><strong>{profile.workStart || '08:00'}–{profile.workEnd || '17:00'}</strong><small className="table-note">{profile.standardWorkDays || 26} ngày/tháng</small></td>
              <td><strong>{money(profile.monthlySalary || profile.salary)}</strong></td>
              <td><Badge tone={statusTone(profile.status)}>{profile.status || EMPLOYEE_STATUSES[0]}</Badge></td>
              <td><div className="row-actions"><button type="button" onClick={() => onEdit(profile)} aria-label={`Sửa ${profile.name}`} title={`Sửa ${profile.name}`}><Edit3 size={17} /></button><button type="button" className="danger" onClick={() => onDelete(profile)} aria-label={`Xóa ${profile.name}`} title={`Xóa ${profile.name}`}><Trash2 size={17} /></button></div></td>
            </tr>
          })}
          {!rows.length && <tr><td colSpan={roleKey === ROLE_KEYS.storeManager ? 12 : 11}>Chưa có {config.singular} phù hợp.</td></tr>}
        </tbody>
      </TableWrap>
      <TableFooter shown={rows.length} total={rows.length} />
    </Card>
  </>
}

function BusinessSupportAttendance({ attendance, policies, profiles }) {
  const [period, setPeriod] = useState(today().slice(0, 7))
  const rows = useMemo(() => profiles.flatMap((profile) => (
    officeAttendanceRows(attendance, profile)
      .filter((record) => !period || officeRecordDate(record).startsWith(period))
      .map((record) => ({ profile, record }))
  )).toSorted((left, right) => String(right.record.checkInAt || officeRecordDate(right.record)).localeCompare(String(left.record.checkInAt || officeRecordDate(left.record)))), [attendance, period, profiles])
  const aggregateStats = officeAttendanceStats(rows.map(({ record }) => record), policies?.attendanceEvaluation)

  return <>
    <Card className="filter-card"><div className="filter-grid"><Field label="Tháng chấm công"><Input type="month" value={period} onChange={(event) => setPeriod(event.target.value)} /></Field><InfoNote>Thời gian hiển thị theo định dạng 24 giờ; thống kê chỉ tính các lượt đã ghi nhận giờ vào.</InfoNote></div></Card>
    <div className="metric-grid metric-grid--four">
      <MetricCard label="Lượt điểm danh" value={aggregateStats.total} suffix="lượt" icon={History} tone="blue" compact />
      <MetricCard label="Đi sớm" value={aggregateStats.early} suffix={`${aggregateStats.earlyMinutes} phút`} icon={Clock3} tone="blue" compact />
      <MetricCard label="Đúng giờ" value={aggregateStats.onTime} suffix="lượt" icon={UserCheck} tone="green" compact />
      <MetricCard label="Đi trễ" value={aggregateStats.late} suffix={`${aggregateStats.lateMinutes} phút`} icon={Clock3} tone="orange" compact />
    </div>
    <Card title="Bảng chấm công điểm danh">
      <TableWrap>
        <thead><tr><th>Ngày</th><th>Nhân viên</th><th>Giờ quy định</th><th>Giờ vào</th><th>Giờ ra</th><th>Số giờ</th><th>Trạng thái</th><th>Số phút</th><th>Vị trí điểm danh</th></tr></thead>
        <tbody>
          {rows.map(({ profile, record }, index) => {
            const label = officeArrivalStatus(record)
            const minutes = officeArrivalMinutes(record)
            return <tr key={record.id || `${recordEmployeeId(record)}-${officeRecordDate(record)}-${index}`}><td><strong>{shortDate(officeRecordDate(record))}</strong></td><td><div className="person-cell"><Avatar name={profile.name} color={profile.color} /><span><strong>{profile.name}</strong><small>{roleProfileCode(profile)}</small></span></div></td><td><strong>{record.shiftStart || profile.workStart || '08:00'}–{record.shiftEnd || profile.workEnd || '17:00'}</strong></td><td className="green-text"><strong>{time24(record.checkIn || record.checkInTime || record.checkInAt)}</strong></td><td><strong>{time24(record.checkOut || record.checkOutTime || record.checkOutAt)}</strong></td><td>{hoursWorked(record).toFixed(2)} giờ</td><td><Badge tone={attendanceTone(label)}>{label}</Badge></td><td>{label === 'Đi sớm' ? `${minutes.earlyMinutes} phút sớm` : label === 'Đi trễ' ? `${minutes.lateMinutes} phút trễ` : '—'}</td><td className="address-cell">{officeLocationLabel(record.checkInLocation || record.location || record.address)}</td></tr>
          })}
          {!rows.length && <tr><td colSpan="9">Chưa có dữ liệu chấm công trong tháng đã chọn.</td></tr>}
        </tbody>
      </TableWrap>
      <TableFooter shown={rows.length} total={rows.length} />
    </Card>
  </>
}

function BusinessSupportEvaluation({ attendance, policies, profiles }) {
  const [period, setPeriod] = useState(today().slice(0, 7))
  return <>
    <Card className="filter-card"><div className="filter-grid"><Field label="Tháng đánh giá"><Input type="month" value={period} onChange={(event) => setPeriod(event.target.value)} /></Field><InfoNote>Mức chuyên cần được tính tự động theo ngưỡng chính sách chấm công Admin đang áp dụng.</InfoNote></div></Card>
    <Card title="Đánh giá mức độ chuyên cần">
      <TableWrap>
        <thead><tr><th>Nhân viên</th><th>Ngày bắt đầu</th><th>Lượt chấm công</th><th>Đi sớm</th><th>Đúng giờ</th><th>Đi trễ</th><th>Phút đi sớm</th><th>Phút đi trễ</th><th>Tỷ lệ đúng giờ</th><th>Đánh giá</th></tr></thead>
        <tbody>
          {profiles.map((profile) => {
            const records = officeAttendanceRows(attendance, profile).filter((record) => !period || officeRecordDate(record).startsWith(period))
            const stats = officeAttendanceStats(records, policies?.attendanceEvaluation)
            return <tr key={profile.id || roleProfileCode(profile)}><td><div className="person-cell"><Avatar name={profile.name} color={profile.color} /><span><strong>{profile.name}</strong><small>{roleProfileCode(profile)}</small></span></div></td><td>{shortDate(profile.startDate || profile.employmentStartDate || profile.hireDate) || '—'}</td><td><strong>{stats.total}</strong></td><td className="green-text">{stats.early}</td><td className="green-text">{stats.onTime}</td><td className="orange-text">{stats.late}</td><td>{stats.earlyMinutes}</td><td>{stats.lateMinutes}</td><td><strong>{stats.onTimeRate.toFixed(2)}%</strong></td><td><Badge tone={ratingTone(stats.rating)}>{stats.rating}</Badge></td></tr>
          })}
          {!profiles.length && <tr><td colSpan="10">Chưa có nhân viên hỗ trợ kinh doanh để đánh giá.</td></tr>}
        </tbody>
      </TableWrap>
    </Card>
  </>
}

function RoleManagement({ roleKey }) {
  const app = useApp()
  const config = ROLE_CONFIG[roleKey]
  const profiles = roleProfilesFromApp(app, roleKey)
  const stores = Array.isArray(app.stores) ? app.stores : []
  const attendance = Array.isArray(app.attendance) ? app.attendance : []
  const allProfiles = [
    ...(Array.isArray(app.employees) ? app.employees : []),
    ...(Array.isArray(app.businessSupportEmployees) ? app.businessSupportEmployees : []),
    ...(Array.isArray(app.storeManagers) ? app.storeManagers : []),
    ...(Array.isArray(app.deletedEmployees) ? app.deletedEmployees : []),
  ]
  const [tab, setTab] = useState('profiles')
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [editingProfile, setEditingProfile] = useState(null)
  const [pendingDelete, setPendingDelete] = useState(null)
  const [form, setForm] = useState(() => emptyRoleProfile(roleKey))
  const [errors, setErrors] = useState([])
  const [showPassword, setShowPassword] = useState(false)
  const requiresPassword = !editingProfile || !(
    editingProfile.authUserId || editingProfile.authVersion || editingProfile.passwordHash || editingProfile.legacyPassword
  )

  const closeDrawer = () => {
    setDrawerOpen(false)
    setEditingProfile(null)
    setErrors([])
    setShowPassword(false)
  }

  const openCreate = () => {
    setEditingProfile(null)
    setForm({ ...emptyRoleProfile(roleKey), code: roleKey === ROLE_KEYS.storeManager ? '' : nextRoleCode(allProfiles, roleKey) })
    setErrors([])
    setShowPassword(false)
    setDrawerOpen(true)
  }

  const openEdit = (profile) => {
    setEditingProfile(profile)
    setForm(roleProfileToForm(profile, roleKey))
    setErrors([])
    setShowPassword(false)
    setDrawerOpen(true)
  }

  const updateField = (field) => (event) => {
    let value = event.target.value
    if (field === 'cccd') value = value.replace(/\D/gu, '').slice(0, 12)
    if (field === 'phone') value = value.replace(/\D/gu, '').slice(0, 10)
    if (field === 'age') value = value.replace(/\D/gu, '').slice(0, 3)
    if (field === 'standardWorkDays') value = value.replace(/\D/gu, '').slice(0, 2)
    if (field === 'salary') value = formatMoneyInput(value)
    setForm((current) => ({
      ...current,
      [field]: value,
      ...(field === 'storeId'
        ? { code: nextRoleCode(allProfiles, roleKey, stores.find((store) => store.id === value)) }
        : {}),
    }))
  }

  const saveProfile = async (event) => {
    event?.preventDefault()
    const editingKey = editingProfile?.id || (editingProfile ? roleProfileCode(editingProfile) : '')
    const validationErrors = validateRoleProfile({ form, profiles: allProfiles, editingKey, requiresPassword, roleKey })
    if (validationErrors.length) {
      setErrors(validationErrors)
      app.notify?.(`Vui lòng kiểm tra lại hồ sơ ${config.singular}.`, 'info')
      return
    }
    const payload = roleProfilePayload(form, roleKey)
    const specificAction = editingProfile ? app[config.updateMethod] : app[config.addMethod]
    const fallbackAction = editingProfile ? app.updateEmployee : app.addEmployee
    const action = typeof specificAction === 'function' ? specificAction : fallbackAction
    if (typeof action !== 'function') return app.notify?.(`Chức năng lưu ${config.singular} đang được kết nối.`, 'info')
    try {
      const result = editingProfile ? await action(editingKey, payload) : await action(payload)
      if (result?.ok === false) return app.notify?.(result.message || `Không thể lưu ${config.singular}.`, 'info')
      closeDrawer()
    } catch (error) {
      app.notify?.(error?.message || `Không thể lưu ${config.singular}.`, 'info')
    }
  }

  const confirmDelete = async () => {
    if (!pendingDelete) return
    const specificAction = app[config.deleteMethod]
    const action = typeof specificAction === 'function' ? specificAction : app.deleteEmployee
    if (typeof action !== 'function') return app.notify?.(`Chức năng xóa ${config.singular} đang được kết nối.`, 'info')
    try {
      const result = await action(pendingDelete.id || roleProfileCode(pendingDelete))
      if (result?.ok === false) return app.notify?.(result.message || `Không thể xóa ${config.singular}.`, 'info')
      setPendingDelete(null)
    } catch (error) {
      app.notify?.(error?.message || `Không thể xóa ${config.singular}.`, 'info')
    }
  }

  if (app.session?.role !== 'admin') {
    return <div className="page"><PageHeader title="KHÔNG CÓ QUYỀN TRUY CẬP" subtitle="Chỉ Admin có quyền quản lý và tạo các tài khoản này." icon={ShieldCheck} /></div>
  }

  return <div className="page">
    <PageHeader title={config.title} subtitle={config.subtitle} icon={config.icon} actions={<Button icon={Plus} onClick={openCreate}>Thêm tài khoản</Button>} />
    {roleKey === ROLE_KEYS.businessSupport && <div className="tabs"><button type="button" className={tab === 'profiles' ? 'active' : ''} onClick={() => setTab('profiles')}><Users />Danh sách nhân viên</button><button type="button" className={tab === 'attendance' ? 'active' : ''} onClick={() => setTab('attendance')}><History />Chấm công</button><button type="button" className={tab === 'evaluation' ? 'active' : ''} onClick={() => setTab('evaluation')}><ShieldCheck />Chuyên cần</button></div>}
    {(roleKey !== ROLE_KEYS.businessSupport || tab === 'profiles') && <ProfileList config={config} onCreate={openCreate} onDelete={setPendingDelete} onEdit={openEdit} profiles={profiles} roleKey={roleKey} stores={stores} />}
    {roleKey === ROLE_KEYS.businessSupport && tab === 'attendance' && <BusinessSupportAttendance attendance={attendance} policies={app.policies} profiles={profiles} />}
    {roleKey === ROLE_KEYS.businessSupport && tab === 'evaluation' && <BusinessSupportEvaluation attendance={attendance} policies={app.policies} profiles={profiles} />}
    <RoleProfileDrawer config={config} editingProfile={editingProfile} errors={errors} form={form} onChange={updateField} onClose={closeDrawer} onSave={saveProfile} open={drawerOpen} requiresPassword={requiresPassword} roleKey={roleKey} showPassword={showPassword} stores={stores} togglePassword={() => setShowPassword((current) => !current)} />
    <Modal open={Boolean(pendingDelete)} onClose={() => setPendingDelete(null)} title={`Xóa ${config.singular}`} footer={<><Button variant="outline" onClick={() => setPendingDelete(null)}>Hủy</Button><Button variant="danger" icon={Trash2} onClick={confirmDelete}>XÓA TÀI KHOẢN</Button></>}><InfoNote tone="orange">Xóa <strong>{pendingDelete?.name}</strong> khỏi danh sách? Lịch sử chấm công và nhật ký hệ thống vẫn được giữ lại.</InfoNote></Modal>
  </div>
}

export function BusinessSupportManagement() {
  return <RoleManagement roleKey={ROLE_KEYS.businessSupport} />
}

export function StoreManagerManagement() {
  return <RoleManagement roleKey={ROLE_KEYS.storeManager} />
}
