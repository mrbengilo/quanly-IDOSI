import { useEffect, useMemo, useState } from 'react'
import {
  BriefcaseBusiness,
  CalendarDays,
  ClipboardCheck,
  Clock3,
  Edit3,
  Eye,
  EyeOff,
  History,
  MapPin,
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
import { useApp } from '../../state/AppContext'
import { apiGetIdentityImage } from '../../services/idosiApi'
import { shortDate, today } from '../../utils'
import {
  officeArrivalMinutes,
  officeArrivalStatus,
  officeAttendanceRows,
  officeAttendanceStats,
  officeLocationMapUrl,
  officeRecordDate,
} from '../employee/officeAttendance'
import {
  ROLE_KEYS,
  emptyRoleProfile,
  formatRoleDate,
  nextRoleCode,
  roleProfileAddress,
  roleProfileCode,
  roleEmploymentType,
  roleEmploymentTypes,
  roleProfilePayload,
  roleProfileToForm,
  roleProfilesFromApp,
  resolveOriginalRoleProfile,
  resolveRoleIdentityImage,
  validateRoleProfile,
} from './roleManagementUtils'
import { SupportWorkEvaluationTable } from './SupportWorkPages'
import { WorkingTimeFields } from '../office/WorkingTimeFields'
import {
  withEmploymentWorkingTime,
} from '../office/workingTime'

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
    title: 'NHÂN VIÊN QUẢN LÝ CỬA HÀNG',
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

const profileType = roleEmploymentType

const employmentTypeTone = (type) => type === 'Full-Time' ? 'green' : type === 'Part-Time' ? 'blue' : 'orange'

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

const readIdentityImage = async (file) => (await optimizeIdentityImage(file)).dataUrl

const identityImagePreview = (value) => {
  const source = typeof value === 'string' ? value : value?.previewUrl || value?.objectUrl || ''
  return /^(?:data:image\/|blob:)/u.test(source) ? source : ''
}

function RoleProfileDrawer({
  config,
  editingProfile,
  errors,
  form,
  imageBusy,
  isSaving,
  onChange,
  onAddressChange,
  onClose,
  onImageChange,
  onSave,
  open,
  roleKey,
  requiresPassword,
  showPassword,
  storeEmployees,
  stores,
  togglePassword,
}) {
  const employmentTypes = roleEmploymentTypes(roleKey)
  return (
    <Modal
      wide
      open={open}
      onClose={onClose}
      title={editingProfile ? `Cập nhật ${config.singular}` : `Thêm ${config.singular}`}
      footer={<><Button type="button" variant="outline" onClick={onClose} disabled={isSaving}>Hủy bỏ</Button><Button type="button" icon={Save} loading={isSaving} onClick={onSave} disabled={isSaving || Boolean(imageBusy)}>{editingProfile ? 'Lưu thay đổi' : 'Lưu tài khoản'}</Button></>}
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
          {!editingProfile && <Field label="Cách tạo Quản lý cửa hàng" required>
            <Select value={form.managerSource || 'new'} onChange={onChange('managerSource')}>
              <option value="new">Tạo hồ sơ quản lý mới</option>
              <option value="existing">Chọn nhân viên cửa hàng hoặc Hỗ trợ KD hiện có</option>
            </Select>
          </Field>}
          {!editingProfile && form.managerSource === 'existing' && <Field label="Nhân viên được phân quyền quản lý" required hint="Nhân viên giữ nguyên các vai trò hiện có và dùng cùng tài khoản để vào giao diện quản lý.">
            <Select value={form.linkedEmployeeId || ''} onChange={onChange('linkedEmployeeId')}>
              <option value="">Chọn nhân viên</option>
              {storeEmployees.filter((employee) => (
                String(employee.unit || '').toLowerCase() === 'business_support'
                || String(employee.storeId || '') === String(form.storeId || '')
              ) && !employee.isStoreManager).map((employee) => <option key={employee.id || employee.code} value={employee.id || employee.code}>{employee.name} — {employee.id || employee.code}{String(employee.unit || '').toLowerCase() === 'business_support' ? ' · Hỗ trợ KD' : ''}</option>)}
            </Select>
          </Field>}
        </>}

        {!(roleKey === ROLE_KEYS.storeManager && !editingProfile && form.managerSource === 'existing') && <>
        <h3>Thông tin nhân viên</h3>
        <div className="form-grid">
          <Field label="Mã nhân viên" required hint="Mã xem trước; máy chủ phát sinh mã chính thức khi lưu"><Input value={form.code} readOnly /></Field>
          <Field label="Tên nhân viên" required><Input value={form.name} onChange={onChange('name')} placeholder="Nhập họ và tên" /></Field>
          <Field label="Số điện thoại" required hint="Đủ 10 số và bắt đầu bằng 0"><Input type="tel" inputMode="numeric" maxLength={10} value={form.phone} onChange={onChange('phone')} placeholder="0901234567" /></Field>
          <Field label="CCCD" required hint="CCCD phải gồm đúng 12 chữ số"><Input inputMode="numeric" maxLength={12} value={form.cccd} onChange={onChange('cccd')} placeholder="012345678901" /></Field>
          <Field label="Ngày bắt đầu làm" required hint="Hiển thị trong danh sách theo dd/mm/yy"><Input icon={CalendarDays} type="date" value={form.startDate} onChange={onChange('startDate')} /></Field>
          <Field label="Loại nhân viên" required><Select value={form.employmentType} onChange={onChange('employmentType')}>{employmentTypes.map((type) => <option key={type}>{type}</option>)}</Select></Field>
          <Field label="Vị trí công việc" required hint="Vị trí cố định theo vai trò tài khoản"><Input value={form.position} readOnly /></Field>
        </div>

        {roleKey === ROLE_KEYS.businessSupport && !editingProfile && <>
          <h3>Thời gian làm việc</h3>
          <WorkingTimeFields form={form} onChange={(workingTime) => onChange('__workingTime')({ target: { value: workingTime } })} />
        </>}
        {roleKey === ROLE_KEYS.businessSupport && editingProfile && <InfoNote>Thời gian làm việc hiện tại được giữ nguyên khi cập nhật hồ sơ.</InfoNote>}

        <h3>Địa chỉ</h3>
        <AddressAutocomplete value={{ province: form.province, ward: form.ward, street: form.street }} onChange={onAddressChange} />

        <h3>Hình ảnh CCCD</h3>
        <div className="form-grid">
          {['front', 'back'].map((side) => {
            const label = side === 'front' ? 'Mặt trước CCCD' : 'Mặt sau CCCD'
            const image = form.identityImages?.[side]
            const preview = identityImagePreview(image)
            return <Field key={side} label={label} required hint="Ảnh gốc tối đa 5 MB; hệ thống tự tối ưu dưới 300 KB">
              <Input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => onImageChange(side, event)} disabled={Boolean(imageBusy)} aria-label={label} />
              {image && <small>{preview ? `Đã chọn ${side === 'front' ? 'mặt trước' : 'mặt sau'}` : `Đã lưu ${side === 'front' ? 'mặt trước' : 'mặt sau'}`}</small>}
              {preview && <img className="identity-image-preview" src={preview} alt={`Xem trước ${label.toLocaleLowerCase('vi-VN')}`} />}
            </Field>
          })}
        </div>
        {imageBusy && <InfoNote>Đang tối ưu ảnh {imageBusy === 'front' ? 'mặt trước' : 'mặt sau'} CCCD…</InfoNote>}

        <h3>Tài khoản đăng nhập</h3>
        <div className="form-grid">
          <Field label="Tên đăng nhập" required><Input autoComplete="username" value={form.username} onChange={onChange('username')} placeholder="Nhập tên đăng nhập" /></Field>
          <Field label="Mật khẩu" required={requiresPassword} hint={requiresPassword ? 'Ít nhất 8 ký tự để cấp tài khoản đăng nhập' : 'Để trống nếu không muốn đổi mật khẩu'}>
            <span className="password-input"><Input type={showPassword ? 'text' : 'password'} autoComplete="new-password" value={form.password} onChange={onChange('password')} placeholder={editingProfile ? 'Nhập mật khẩu mới nếu cần' : 'Nhập mật khẩu'} /><button type="button" onClick={togglePassword} aria-label={showPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'} title={showPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}>{showPassword ? <EyeOff size={20} /> : <Eye size={20} />}</button></span>
          </Field>
        </div>
        <InfoNote>Quản lý cửa hàng không có lương quản lý riêng; chỉ nhận phụ cấp và thưởng cuối tháng. Tài khoản chỉ được cấp quyền theo phạm vi đã gán.</InfoNote>
        </>}
      </form>
    </Modal>
  )
}

function ProfileList({ allProfiles, canCreate, canDelete, canEdit, config, imageBusyKey, onCreate, onDelete, onEdit, onViewImage, profiles, roleKey, stores }) {
  const [query, setQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState('all')
  const [storeFilter, setStoreFilter] = useState('all')
  const normalizedQuery = normalize(query)
  const employmentTypes = roleEmploymentTypes(roleKey)
  const rows = profiles.filter((profile) => {
    const searchable = [roleProfileCode(profile), profile.name, profile.username, profile.phone, profile.cccd, profile.position, roleProfileAddress(profile)].join(' ').toLocaleLowerCase('vi-VN')
    return (!normalizedQuery || searchable.includes(normalizedQuery))
      && (typeFilter === 'all' || profileType(profile) === typeFilter)
      && (storeFilter === 'all' || profile.storeId === storeFilter || profile.assignedStoreId === storeFilter)
  })

  return <>
    <div className="metric-grid metric-grid--four">
      <MetricCard label="Tổng nhân sự" value={profiles.length} suffix="nhân viên" icon={Users} tone="blue" compact />
      {employmentTypes.map((type) => <MetricCard key={type} label={type} value={profiles.filter((profile) => profileType(profile) === type).length} suffix="nhân viên" icon={UserCheck} tone={employmentTypeTone(type)} compact />)}
    </div>
    <Card>
      <div className="card__subheader">
        <div className="filter-pills"><button type="button" className={typeFilter === 'all' ? 'active' : ''} onClick={() => setTypeFilter('all')}>Tất cả ({profiles.length})</button>{employmentTypes.map((type) => <button type="button" key={type} className={typeFilter === type ? 'active' : ''} onClick={() => setTypeFilter(type)}>{type}</button>)}</div>
        <div>
          <SearchInput value={query} onChange={setQuery} placeholder="Tìm mã, tên, CCCD..." />
          {roleKey === ROLE_KEYS.storeManager && <Select aria-label="Lọc theo cửa hàng" value={storeFilter} onChange={(event) => setStoreFilter(event.target.value)}><option value="all">Tất cả cửa hàng</option>{stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}</Select>}
          {canCreate && <Button icon={Plus} onClick={onCreate}>Thêm tài khoản</Button>}
        </div>
      </div>
      <TableWrap>
        <thead><tr><th>Mã nhân viên</th><th>Nhân viên</th><th>Loại nhân viên</th><th>Ngày bắt đầu</th>{roleKey === ROLE_KEYS.storeManager && <th>Cửa hàng quản lý</th>}<th>Liên hệ / CCCD</th><th>Địa chỉ</th><th>Vị trí</th><th>Hình CCCD</th>{canEdit && <th>Thao tác</th>}</tr></thead>
        <tbody>
          {rows.map((profile) => {
            const storeId = profile.storeId === 'OFFICE' ? '' : profile.storeId || profile.assignedStoreId
            const store = stores.find((item) => item.id === storeId)
            const type = profileType(profile)
            const originalProfile = resolveOriginalRoleProfile(profile, allProfiles)
            const frontIdentity = resolveRoleIdentityImage(profile, 'front', allProfiles)
            const backIdentity = resolveRoleIdentityImage(profile, 'back', allProfiles)
            return <tr key={profile.id || roleProfileCode(profile)}>
              <td><strong>{roleProfileCode(profile)}</strong></td>
              <td><div className="person-cell"><Avatar name={profile.name} src={profile.avatar || originalProfile.avatar} employeeId={roleProfileCode(originalProfile) || roleProfileCode(profile)} color={profile.color || originalProfile.color} /><span><strong>{profile.name}</strong><small>{profile.username || originalProfile.username || 'Chưa có tên đăng nhập'}</small></span></div></td>
              <td><Badge tone={employmentTypeTone(type)}>{type}</Badge></td>
              <td><strong>{formatRoleDate(profile.startDate || profile.joinDate || profile.employmentStartDate || profile.hireDate)}</strong></td>
              {roleKey === ROLE_KEYS.storeManager && <td><strong>{store?.name || storeId || '—'}</strong><small className="table-note">{store?.id || ''}</small></td>}
              <td>{profile.phone || '—'}<small className="table-note">CCCD: {profile.cccd || profile.citizenId || '—'}</small></td>
              <td className="address-cell">{roleProfileAddress(profile)}</td>
              <td>{profile.position || profile.workPosition || '—'}</td>
              <td><div className="row-actions identity-image-actions--stable">
                {frontIdentity.image
                  ? <button type="button" disabled={Boolean(imageBusyKey)} onClick={() => onViewImage(profile, 'front', frontIdentity)} aria-label={`Xem mặt trước CCCD ${profile.name}`}>{imageBusyKey === `${roleProfileCode(frontIdentity.profile)}:front` ? 'Đang tải…' : <><Eye size={15} /> Trước</>}</button>
                  : <small>Chưa có mặt trước</small>}
                {backIdentity.image
                  ? <button type="button" disabled={Boolean(imageBusyKey)} onClick={() => onViewImage(profile, 'back', backIdentity)} aria-label={`Xem mặt sau CCCD ${profile.name}`}>{imageBusyKey === `${roleProfileCode(backIdentity.profile)}:back` ? 'Đang tải…' : <><Eye size={15} /> Sau</>}</button>
                  : <small>Chưa có mặt sau</small>}
              </div></td>
              {canEdit && <td><div className="row-actions"><button type="button" onClick={() => onEdit(profile)} aria-label={`Sửa ${profile.name}`} title={`Sửa ${profile.name}`}><Edit3 size={17} /></button>{canDelete && <button type="button" className="danger" onClick={() => onDelete(profile)} aria-label={`Xóa ${profile.name}`} title={`Xóa ${profile.name}`}><Trash2 size={17} /></button>}</div></td>}
            </tr>
          })}
          {!rows.length && <tr><td colSpan={(roleKey === ROLE_KEYS.storeManager ? 9 : 8) + (canEdit ? 1 : 0)}>Chưa có {config.singular} phù hợp.</td></tr>}
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
            const locationMapUrl = officeLocationMapUrl(record.checkInLocation || record.location || record.address)
            return <tr key={record.id || `${recordEmployeeId(record)}-${officeRecordDate(record)}-${index}`}><td><strong>{shortDate(officeRecordDate(record))}</strong></td><td><div className="person-cell"><Avatar name={profile.name} src={profile.avatar} employeeId={roleProfileCode(profile)} color={profile.color} /><span><strong>{profile.name}</strong><small>{roleProfileCode(profile)}</small></span></div></td><td><strong>{record.shiftStart || profile.workStart || '08:00'}–{record.shiftEnd || profile.workEnd || '17:00'}</strong></td><td className="green-text"><strong>{time24(record.checkIn || record.checkInTime || record.checkInAt)}</strong></td><td><strong>{time24(record.checkOut || record.checkOutTime || record.checkOutAt)}</strong></td><td>{hoursWorked(record).toFixed(2)} giờ</td><td><Badge tone={attendanceTone(label)}>{label}</Badge></td><td>{label === 'Đi sớm' ? `${minutes.earlyMinutes} phút sớm` : label === 'Đi trễ' ? `${minutes.lateMinutes} phút trễ` : '—'}</td><td>{locationMapUrl ? <a className="attendance-location-link" href={locationMapUrl} target="_blank" rel="noreferrer" aria-label={`Xem vị trí điểm danh của ${profile.name} trên Google Maps`}><MapPin size={16} aria-hidden="true" /><span>Xem vị trí</span></a> : <span className="table-note">—</span>}</td></tr>
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
            return <tr key={profile.id || roleProfileCode(profile)}><td><div className="person-cell"><Avatar name={profile.name} src={profile.avatar} employeeId={roleProfileCode(profile)} color={profile.color} /><span><strong>{profile.name}</strong><small>{roleProfileCode(profile)}</small></span></div></td><td>{shortDate(profile.startDate || profile.employmentStartDate || profile.hireDate) || '—'}</td><td><strong>{stats.total}</strong></td><td className="green-text">{stats.early}</td><td className="green-text">{stats.onTime}</td><td className="orange-text">{stats.late}</td><td>{stats.earlyMinutes}</td><td>{stats.lateMinutes}</td><td><strong>{stats.onTimeRate.toFixed(2)}%</strong></td><td><Badge tone={ratingTone(stats.rating)}>{stats.rating}</Badge></td></tr>
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
  const storeEmployees = (Array.isArray(app.employees) ? app.employees : []).filter((profile) => (
    ['store', 'business_support'].includes(String(profile.unit || 'store').toLowerCase()) && !profile.deletedAt
  ))
  const [tab, setTab] = useState('profiles')
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [editingProfile, setEditingProfile] = useState(null)
  const [pendingDelete, setPendingDelete] = useState(null)
  const [form, setForm] = useState(() => emptyRoleProfile(roleKey))
  const [errors, setErrors] = useState([])
  const [showPassword, setShowPassword] = useState(false)
  const [imageBusy, setImageBusy] = useState('')
  const [imageBusyKey, setImageBusyKey] = useState('')
  const [imageViewer, setImageViewer] = useState(null)
  const [isSaving, setIsSaving] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const isAdmin = app.session?.role === 'admin'
  const isBusinessSupport = ['business_support', 'manager'].includes(app.session?.role)
  const canEdit = isAdmin || (isBusinessSupport && roleKey === ROLE_KEYS.storeManager)
  const canDelete = isAdmin
  const canCreate = isAdmin || (isBusinessSupport && roleKey === ROLE_KEYS.storeManager)
  const canView = isAdmin || isBusinessSupport
  const requiresPassword = !editingProfile || !(
    editingProfile.authUserId || editingProfile.authVersion || editingProfile.passwordHash || editingProfile.legacyPassword
  )

  useEffect(() => () => {
    if (imageViewer?.url) URL.revokeObjectURL(imageViewer.url)
  }, [imageViewer])

  const closeImageViewer = () => setImageViewer(null)

  const viewIdentityImage = async (profile, side, resolvedIdentity = {}) => {
    const sourceProfile = resolvedIdentity.profile || profile
    const employeeId = roleProfileCode(sourceProfile)
    const busyKey = `${employeeId}:${side}`
    if (!employeeId || imageBusyKey) return
    const localImage = resolvedIdentity.image || (side === 'front'
      ? sourceProfile.identityImages?.front || sourceProfile.cccdFrontImage
      : sourceProfile.identityImages?.back || sourceProfile.cccdBackImage)
    if (typeof localImage === 'string' && /^data:image\//u.test(localImage)) {
      setImageViewer({
        url: localImage,
        title: `${profile.name || employeeId} · ${side === 'front' ? 'Mặt trước CCCD' : 'Mặt sau CCCD'}`,
      })
      return
    }
    setImageBusyKey(busyKey)
    try {
      const blob = await apiGetIdentityImage(employeeId, side)
      setImageViewer({
        url: URL.createObjectURL(blob),
        title: `${profile.name || employeeId} · ${side === 'front' ? 'Mặt trước CCCD' : 'Mặt sau CCCD'}`,
      })
    } catch (error) {
      app.notify?.(error?.message || 'Không thể tải hình CCCD.', 'info')
    } finally {
      setImageBusyKey('')
    }
  }

  const closeDrawer = () => {
    setDrawerOpen(false)
    setEditingProfile(null)
    setErrors([])
    setShowPassword(false)
    setImageBusy('')
  }

  const openCreate = () => {
    setEditingProfile(null)
    setForm({ ...emptyRoleProfile(roleKey), code: nextRoleCode(allProfiles, roleKey) })
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
    if (field === '__workingTime') {
      setForm((current) => ({ ...current, ...event.target.value }))
      return
    }
    let value = event.target.value
    if (field === 'cccd') value = value.replace(/\D/gu, '').slice(0, 12)
    if (field === 'phone') value = value.replace(/\D/gu, '').slice(0, 10)
    setForm((current) => field === 'employmentType' && roleKey === ROLE_KEYS.businessSupport
      ? withEmploymentWorkingTime(current, value)
      : ({
          ...current,
          [field]: value,
          ...(field === 'storeId'
            ? { code: nextRoleCode(allProfiles, roleKey, stores.find((store) => store.id === value)) }
            : {}),
        }))
  }

  const updateAddress = (address) => setForm((current) => ({
    ...current,
    ...address,
    address: [address.street, address.ward, address.province].map((part) => String(part || '').trim()).filter(Boolean).join(', '),
  }))

  const updateIdentityImage = async (side, event) => {
    const file = event.target.files?.[0]
    if (!file) return
    setImageBusy(side)
    try {
      const image = await readIdentityImage(file)
      setForm((current) => ({
        ...current,
        identityImages: { ...current.identityImages, [side]: image },
      }))
      setErrors((current) => current.filter((error) => !error.startsWith('Hình CCCD') && !error.startsWith('Mỗi hình CCCD') && !error.startsWith('Không thể đọc hình CCCD')))
    } catch (error) {
      const message = error?.message || 'Không thể đọc hình CCCD.'
      setErrors((current) => [...new Set([...current, message])])
      app.notify?.(message, 'info')
    } finally {
      setImageBusy('')
    }
  }

  const saveProfile = async (event) => {
    event?.preventDefault()
    const canSave = editingProfile ? canEdit : canCreate
    if (!canSave || isSaving || imageBusy) return
    const editingKey = editingProfile?.id || (editingProfile ? roleProfileCode(editingProfile) : '')
    const validationErrors = validateRoleProfile({ form, profiles: allProfiles, editingKey, requiresPassword, roleKey })
    if (validationErrors.length) {
      setErrors(validationErrors)
      app.notify?.(`Vui lòng kiểm tra lại hồ sơ ${config.singular}.`, 'info')
      return
    }
    const payload = roleProfilePayload(form, roleKey, { includeWorkingTime: !editingProfile })
    const specificAction = editingProfile ? app[config.updateMethod] : app[config.addMethod]
    const fallbackAction = editingProfile ? app.updateEmployee : app.addEmployee
    const action = typeof specificAction === 'function' ? specificAction : fallbackAction
    if (typeof action !== 'function') {
      const message = `Chức năng lưu ${config.singular} đang được kết nối.`
      setErrors([message])
      return app.notify?.(message, 'info')
    }
    setIsSaving(true)
    try {
      const result = editingProfile ? await action(editingKey, payload) : await action(payload)
      if (result?.ok === false) {
        const message = result.message || `Không thể lưu ${config.singular}.`
        setErrors([message])
        return app.notify?.(message, 'info')
      }
      closeDrawer()
    } catch (error) {
      const message = error?.message || `Không thể lưu ${config.singular}.`
      setErrors([message])
      app.notify?.(message, 'info')
    } finally {
      setIsSaving(false)
    }
  }

  const confirmDelete = async () => {
    if (!canEdit || !pendingDelete || isDeleting) return
    const specificAction = app[config.deleteMethod]
    const action = typeof specificAction === 'function' ? specificAction : app.deleteEmployee
    if (typeof action !== 'function') return app.notify?.(`Chức năng xóa ${config.singular} đang được kết nối.`, 'info')
    setIsDeleting(true)
    try {
      const result = await action(pendingDelete.id || roleProfileCode(pendingDelete))
      if (result?.ok === false) return app.notify?.(result.message || `Không thể xóa ${config.singular}.`, 'info')
      setPendingDelete(null)
    } catch (error) {
      app.notify?.(error?.message || `Không thể xóa ${config.singular}.`, 'info')
    } finally {
      setIsDeleting(false)
    }
  }

  if (!canView) {
    return <div className="page"><PageHeader title="KHÔNG CÓ QUYỀN TRUY CẬP" subtitle="Tài khoản không có quyền xem danh sách này." icon={ShieldCheck} /></div>
  }

  return <div className="page">
    <PageHeader title={config.title} subtitle={config.subtitle} icon={config.icon} actions={canCreate ? <Button icon={Plus} onClick={openCreate}>Thêm tài khoản</Button> : null} />
    {!canCreate && <InfoNote>Chỉ Admin được quản lý tài khoản; Hỗ trợ KD được xem danh sách và lịch sử liên quan.</InfoNote>}
    {isBusinessSupport && roleKey === ROLE_KEYS.storeManager && <InfoNote>Nhân viên Hỗ trợ KD được tạo hoặc sửa Quản lý cửa hàng; chỉ Admin được xóa tài khoản.</InfoNote>}
    {roleKey === ROLE_KEYS.businessSupport && <div className="tabs"><button type="button" className={tab === 'profiles' ? 'active' : ''} onClick={() => setTab('profiles')}><Users />Danh sách nhân viên</button><button type="button" className={tab === 'attendance' ? 'active' : ''} onClick={() => setTab('attendance')}><History />Chấm công</button><button type="button" className={tab === 'evaluation' ? 'active' : ''} onClick={() => setTab('evaluation')}><ShieldCheck />Chuyên cần</button>{canEdit && <button type="button" className={tab === 'work' ? 'active' : ''} onClick={() => setTab('work')}><ClipboardCheck />Công việc</button>}</div>}
    {(roleKey !== ROLE_KEYS.businessSupport || tab === 'profiles') && <ProfileList allProfiles={allProfiles} canCreate={canCreate} canDelete={canDelete} canEdit={canEdit} config={config} imageBusyKey={imageBusyKey} onCreate={openCreate} onDelete={setPendingDelete} onEdit={openEdit} onViewImage={viewIdentityImage} profiles={profiles} roleKey={roleKey} stores={stores} />}
    {roleKey === ROLE_KEYS.businessSupport && tab === 'attendance' && <BusinessSupportAttendance attendance={attendance} policies={app.policies} profiles={profiles} />}
    {roleKey === ROLE_KEYS.businessSupport && tab === 'evaluation' && <BusinessSupportEvaluation attendance={attendance} policies={app.policies} profiles={profiles} />}
    {roleKey === ROLE_KEYS.businessSupport && tab === 'work' && canEdit && <SupportWorkEvaluationTable assignments={app.supportWorkAssignments || []} profiles={profiles} />}
    {canCreate && <RoleProfileDrawer config={config} editingProfile={editingProfile} errors={errors} form={form} imageBusy={imageBusy} isSaving={isSaving} onAddressChange={updateAddress} onChange={updateField} onClose={closeDrawer} onImageChange={updateIdentityImage} onSave={saveProfile} open={drawerOpen} requiresPassword={requiresPassword} roleKey={roleKey} showPassword={showPassword} storeEmployees={storeEmployees} stores={stores} togglePassword={() => setShowPassword((current) => !current)} />}
    <Modal wide open={Boolean(imageViewer)} onClose={closeImageViewer} title={imageViewer?.title || 'Hình ảnh CCCD'} footer={<Button variant="outline" onClick={closeImageViewer}>Đóng</Button>}>
      <IdentityDocumentViewer src={imageViewer?.url || ''} alt={imageViewer?.title || 'Hình ảnh CCCD'} />
    </Modal>
    {canEdit && <Modal open={Boolean(pendingDelete)} onClose={() => setPendingDelete(null)} title={`Xóa ${config.singular}`} footer={<><Button variant="outline" onClick={() => setPendingDelete(null)} disabled={isDeleting}>Hủy</Button><Button variant="danger" icon={Trash2} loading={isDeleting} disabled={isDeleting} onClick={confirmDelete}>XÓA TÀI KHOẢN</Button></>}><InfoNote tone="orange">Xóa <strong>{pendingDelete?.name}</strong> khỏi danh sách? Lịch sử chấm công và nhật ký hệ thống vẫn được giữ lại.</InfoNote></Modal>}
  </div>
}

export function BusinessSupportManagement() {
  return <RoleManagement roleKey={ROLE_KEYS.businessSupport} />
}

export function StoreManagerManagement() {
  return <RoleManagement roleKey={ROLE_KEYS.storeManager} />
}
