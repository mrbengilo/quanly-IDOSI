import { useState } from 'react'
import {
  Clock3,
  Edit3,
  FileImage,
  Plus,
  Save,
  ShieldCheck,
  Store,
  Trash2,
  UserCheck,
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
import { money } from '../../utils'

const ACTIVE_STATUS = 'Đang hoạt động'
const MANAGER_STATUSES = [ACTIVE_STATUS, 'Tạm ngưng', 'Đã nghỉ việc']
const PHONE_PATTERN = /^(?:\+84|84|0)(?:3|5|7|8|9)\d{8}$/
const CCCD_PATTERN = /^\d{12}$/

const emptyForm = {
  code: '',
  name: '',
  cccd: '',
  phone: '',
  province: '',
  ward: '',
  street: '',
  salary: '',
  age: '',
  cccdImage: '',
  cccdImageName: '',
  username: '',
  password: '',
  status: ACTIVE_STATUS,
  storeId: '',
}

const normalizePhone = (value = '') => value.replace(/[\s.()-]/g, '')
const normalizeText = (value = '') => String(value).trim().toLowerCase()
const recordCode = (record = {}) => record.code || record.managerCode || record.id || ''

const addressParts = (record = {}) => {
  const nested = typeof record.address === 'object' && record.address ? record.address : {}
  return {
    province: record.province || record.addressProvince || nested.province || nested.provinceCity || '',
    ward: record.ward || record.addressWard || nested.ward || '',
    street: record.street || record.addressStreet || nested.street || (typeof record.address === 'string' ? record.address : ''),
  }
}

const addressLabel = (record) => {
  const { province, ward, street } = addressParts(record)
  return [street, ward, province].filter(Boolean).join(', ') || '—'
}

const managerToForm = (manager = {}) => {
  const address = addressParts(manager)
  return {
    ...emptyForm,
    code: recordCode(manager),
    name: manager.name || manager.managerName || '',
    cccd: String(manager.cccd || manager.citizenId || ''),
    phone: manager.phone || '',
    province: address.province,
    ward: address.ward,
    street: address.street,
    salary: manager.salary ?? '',
    age: manager.age ?? '',
    cccdImage: manager.cccdImage || manager.identityImage || '',
    cccdImageName: manager.cccdImageName || manager.identityImageName || '',
    username: manager.username || '',
    password: manager.password || '',
    status: manager.status || ACTIVE_STATUS,
    storeId: manager.storeId || manager.assignedStoreId || '',
  }
}

const statusTone = (status) => {
  if (status === ACTIVE_STATUS || status === 'Đang làm việc') return 'green'
  if (status === 'Đã nghỉ việc') return 'red'
  return 'orange'
}

function validateManager(form, managers, employees, editingKey) {
  const errors = []
  const required = [
    ['Mã quản lý', form.code],
    ['Tên quản lý', form.name],
    ['Số CCCD', form.cccd],
    ['Số điện thoại', form.phone],
    ['Tỉnh/Thành phố', form.province],
    ['Phường/Xã', form.ward],
    ['Đường, số nhà', form.street],
    ['Lương', form.salary],
    ['Tuổi', form.age],
    ['Tên đăng nhập', form.username],
    ['Cửa hàng phụ trách', form.storeId],
  ]

  required.forEach(([label, value]) => {
    if (!String(value ?? '').trim()) errors.push(`${label} là trường bắt buộc.`)
  })

  if (!CCCD_PATTERN.test(form.cccd)) errors.push('Số CCCD phải gồm đúng 12 chữ số.')
  if (!PHONE_PATTERN.test(normalizePhone(form.phone))) errors.push('Số điện thoại Việt Nam không đúng định dạng.')
  if (!Number.isFinite(Number(form.salary)) || Number(form.salary) <= 0) errors.push('Lương phải là số lớn hơn 0.')
  if (!Number.isInteger(Number(form.age)) || Number(form.age) < 18 || Number(form.age) > 100) {
    errors.push('Tuổi phải là số nguyên từ 18 đến 100.')
  }
  if (!editingKey && !form.password) errors.push('Mật khẩu là trường bắt buộc.')
  if (!editingKey && !form.cccdImage) errors.push('Vui lòng chọn hình ảnh CCCD.')

  const comparableManagers = managers.filter((item) => String(item.id || recordCode(item)) !== String(editingKey || ''))
  const allOtherAccounts = [...comparableManagers, ...employees]
  if (allOtherAccounts.some((item) => normalizeText(recordCode(item)) === normalizeText(form.code))) {
    errors.push('Mã quản lý đã tồn tại.')
  }
  if (allOtherAccounts.some((item) => String(item.cccd || item.citizenId || '') === form.cccd)) {
    errors.push('Số CCCD đã được sử dụng.')
  }
  if (allOtherAccounts.some((item) => normalizeText(item.username) === normalizeText(form.username))) {
    errors.push('Tên đăng nhập đã tồn tại.')
  }
  if (allOtherAccounts.some((item) => normalizePhone(item.phone) === normalizePhone(form.phone))) {
    errors.push('Số điện thoại đã được sử dụng.')
  }
  return [...new Set(errors)]
}

export function ManagerAccounts() {
  const app = useApp()
  const managers = Array.isArray(app.managerAccounts) ? app.managerAccounts : []
  const employees = Array.isArray(app.employees) ? app.employees : []
  const stores = Array.isArray(app.stores) ? app.stores : []
  const { addManager, updateManager, deleteManager, notify } = app
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [pendingDelete, setPendingDelete] = useState(null)
  const [form, setForm] = useState(emptyForm)
  const [errors, setErrors] = useState([])

  const storeName = (storeId) => stores.find((store) => String(store.id) === String(storeId))?.name || 'Chưa phân công'
  const normalizedQuery = normalizeText(query)
  const filtered = managers.filter((manager) => {
    const haystack = [
      recordCode(manager),
      manager.name,
      manager.cccd,
      manager.phone,
      manager.username,
      addressLabel(manager),
      storeName(manager.storeId || manager.assignedStoreId),
    ].join(' ').toLowerCase()
    const matchesQuery = !normalizedQuery || haystack.includes(normalizedQuery)
    const matchesStatus = statusFilter === 'all' || manager.status === statusFilter
    return matchesQuery && matchesStatus
  })

  const openCreate = () => {
    setEditing(null)
    setErrors([])
    setForm({ ...emptyForm, storeId: stores[0]?.id || '' })
    setDrawerOpen(true)
  }

  const openEdit = (manager) => {
    setEditing(manager)
    setErrors([])
    setForm(managerToForm(manager))
    setDrawerOpen(true)
  }

  const closeDrawer = () => {
    setDrawerOpen(false)
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
    const editingKey = editing?.id || (editing ? recordCode(editing) : '')
    const validationErrors = validateManager(form, managers, employees, editingKey)
    if (validationErrors.length) {
      setErrors(validationErrors)
      notify?.('Vui lòng kiểm tra lại thông tin tài khoản quản lý.', 'info')
      return
    }

    const address = [form.street.trim(), form.ward.trim(), form.province.trim()].join(', ')
    const payload = {
      id: form.code.trim(),
      code: form.code.trim(),
      managerCode: form.code.trim(),
      name: form.name.trim(),
      cccd: form.cccd,
      phone: form.phone.trim(),
      province: form.province.trim(),
      ward: form.ward.trim(),
      street: form.street.trim(),
      address,
      addressDetails: { province: form.province.trim(), ward: form.ward.trim(), street: form.street.trim() },
      salary: Number(form.salary),
      age: Number(form.age),
      cccdImage: form.cccdImage,
      cccdImageName: form.cccdImageName,
      username: form.username.trim(),
      password: form.password,
      role: 'store',
      status: form.status,
      storeId: form.storeId,
      assignedStoreId: form.storeId,
    }

    if (editing) {
      if (typeof updateManager !== 'function') return notify?.('Chức năng cập nhật quản lý đang được kết nối.', 'info')
      updateManager(editingKey, payload)
    } else {
      if (typeof addManager !== 'function') return notify?.('Chức năng thêm quản lý đang được kết nối.', 'info')
      addManager(payload)
    }
    closeDrawer()
  }

  const confirmDelete = () => {
    if (!pendingDelete) return
    if (typeof deleteManager !== 'function') {
      notify?.('Chức năng xóa quản lý đang được kết nối.', 'info')
      return
    }
    deleteManager(pendingDelete.id || recordCode(pendingDelete))
    setPendingDelete(null)
  }

  const activeCount = managers.filter((item) => item.status === ACTIVE_STATUS || item.status === 'Đang làm việc').length
  const pausedCount = managers.filter((item) => item.status === 'Tạm ngưng' || item.status === 'Tạm nghỉ').length
  const assignedStores = new Set(managers.map((item) => item.storeId || item.assignedStoreId).filter(Boolean)).size

  return (
    <div className="page">
      <PageHeader
        title="TÀI KHOẢN QUẢN LÝ"
        subtitle="Tạo tài khoản, phân công cửa hàng và quản lý hồ sơ người quản lý."
        icon={ShieldCheck}
        actions={<><SearchInput value={query} onChange={setQuery} placeholder="Tìm mã, tên, CCCD..." /><Button icon={Plus} onClick={openCreate}>Thêm quản lý</Button></>}
      />

      <div className="metric-grid metric-grid--four">
        <MetricCard label="Tổng tài khoản" value={managers.length} suffix="quản lý" icon={Users} tone="green" compact />
        <MetricCard label="Đang hoạt động" value={activeCount} suffix="tài khoản" icon={UserCheck} tone="teal" compact />
        <MetricCard label="Tạm ngưng" value={pausedCount} suffix="tài khoản" icon={Clock3} tone="orange" compact />
        <MetricCard label="Cửa hàng đã phân công" value={assignedStores} suffix={`/ ${stores.length} cửa hàng`} icon={Store} tone="blue" compact />
      </div>

      <div className="filter-pills">
        <button className={statusFilter === 'all' ? 'active' : ''} onClick={() => setStatusFilter('all')}>Tất cả ({managers.length})</button>
        {MANAGER_STATUSES.map((status) => <button key={status} className={statusFilter === status ? 'active' : ''} onClick={() => setStatusFilter(status)}>{status}</button>)}
      </div>

      <Card>
        <TableWrap>
          <thead><tr><th>Mã quản lý</th><th>Quản lý</th><th>Cửa hàng</th><th>CCCD</th><th>Liên hệ</th><th>Địa chỉ</th><th>Lương</th><th>Tài khoản</th><th>Trạng thái</th><th>Thao tác</th></tr></thead>
          <tbody>
            {filtered.map((manager) => (
              <tr key={manager.id || recordCode(manager)}>
                <td><strong>{recordCode(manager)}</strong></td>
                <td><div className="person-cell"><Avatar name={manager.name} color={manager.color} /><span><strong>{manager.name}</strong><small>{manager.age ? `${manager.age} tuổi` : 'Chưa cập nhật tuổi'}</small></span></div></td>
                <td><strong>{storeName(manager.storeId || manager.assignedStoreId)}</strong></td>
                <td>{manager.cccd || manager.citizenId || '—'}<small className="table-sub">{manager.cccdImageName || manager.identityImageName || 'Chưa có tên ảnh'}</small></td>
                <td>{manager.phone || '—'}</td>
                <td className="address-cell">{addressLabel(manager)}</td>
                <td><strong>{money(manager.salary)}</strong></td>
                <td>{manager.username || '—'}</td>
                <td><Badge tone={statusTone(manager.status)}>{manager.status || ACTIVE_STATUS}</Badge></td>
                <td><div className="row-actions"><button onClick={() => openEdit(manager)} aria-label={`Sửa ${manager.name}`}><Edit3 /></button><button className="danger" onClick={() => setPendingDelete(manager)} aria-label={`Xóa ${manager.name}`}><Trash2 /></button></div></td>
              </tr>
            ))}
            {!filtered.length && <tr><td colSpan="10">Không có tài khoản quản lý phù hợp.</td></tr>}
          </tbody>
        </TableWrap>
        <TableFooter shown={filtered.length} total={filtered.length} />
      </Card>

      <Drawer
        open={drawerOpen}
        onClose={closeDrawer}
        title={editing ? 'Cập nhật tài khoản quản lý' : 'Thêm tài khoản quản lý'}
        footer={<><Button type="button" variant="outline" onClick={closeDrawer}>Hủy bỏ</Button><Button type="button" icon={Save} onClick={save}>{editing ? 'Lưu thay đổi' : 'Tạo tài khoản'}</Button></>}
      >
        <form className="form-stack" onSubmit={save}>
          {errors.length > 0 && <InfoNote tone="orange"><strong>Thông tin chưa hợp lệ</strong><ul>{errors.map((error) => <li key={error}>{error}</li>)}</ul></InfoNote>}
          <h3>Thông tin quản lý</h3>
          <div className="form-grid">
            <Field label="Mã quản lý" required><Input value={form.code} onChange={updateField('code')} placeholder="Ví dụ: QL001" /></Field>
            <Field label="Tên quản lý" required><Input value={form.name} onChange={updateField('name')} placeholder="Nhập họ và tên" /></Field>
            <Field label="Số CCCD" required hint="Chỉ gồm đúng 12 chữ số"><Input inputMode="numeric" maxLength={12} value={form.cccd} onChange={updateField('cccd')} placeholder="012345678901" /></Field>
            <Field label="Số điện thoại" required><Input type="tel" value={form.phone} onChange={updateField('phone')} placeholder="0901234567" /></Field>
            <Field label="Lương" required><Input type="number" min="1" value={form.salary} onChange={updateField('salary')} placeholder="Nhập mức lương" /></Field>
            <Field label="Tuổi" required><Input inputMode="numeric" min="18" max="100" value={form.age} onChange={updateField('age')} placeholder="Ví dụ: 28" /></Field>
            <Field label="Cửa hàng phụ trách" required><Select value={form.storeId} onChange={updateField('storeId')}><option value="">Chọn cửa hàng</option>{stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}</Select></Field>
            <Field label="Trạng thái" required><Select value={form.status} onChange={updateField('status')}>{MANAGER_STATUSES.map((status) => <option key={status}>{status}</option>)}</Select></Field>
          </div>

          <h3>Địa chỉ</h3>
          <div className="form-grid">
            <Field label="Tỉnh / Thành phố" required><Input value={form.province} onChange={updateField('province')} placeholder="Ví dụ: TP. Hồ Chí Minh" /></Field>
            <Field label="Phường / Xã" required><Input value={form.ward} onChange={updateField('ward')} placeholder="Nhập phường/xã" /></Field>
            <Field label="Đường, số nhà" required className="span-2"><Input value={form.street} onChange={updateField('street')} placeholder="Nhập số nhà và tên đường" /></Field>
          </div>

          <h3>Tài khoản đăng nhập</h3>
          <div className="form-grid">
            <Field label="Tên đăng nhập" required><Input autoComplete="username" value={form.username} onChange={updateField('username')} placeholder="Nhập tên đăng nhập" /></Field>
            <Field label="Mật khẩu" required={!editing} hint={editing ? 'Để nguyên nếu không muốn đổi mật khẩu' : ''}><Input type="password" autoComplete="new-password" value={form.password} onChange={updateField('password')} placeholder={editing ? 'Nhập mật khẩu mới nếu cần' : 'Nhập mật khẩu'} /></Field>
          </div>

          <Field label="Hình ảnh CCCD" required={!editing} hint="JPG hoặc PNG, tối đa 5MB">
            <label className="upload-box">
              <FileImage />
              <b>{form.cccdImageName || 'Chọn ảnh CCCD'}</b>
              <small>{form.cccdImageName ? 'Bấm để chọn ảnh khác' : 'Ảnh sẽ được kiểm tra trước khi lưu'}</small>
              <input type="file" accept="image/jpeg,image/png" onChange={chooseImage} />
            </label>
          </Field>
        </form>
      </Drawer>

      <Modal
        open={Boolean(pendingDelete)}
        onClose={() => setPendingDelete(null)}
        title="Xóa tài khoản quản lý"
        footer={<><Button variant="outline" onClick={() => setPendingDelete(null)}>Hủy</Button><Button onClick={confirmDelete}>Xóa tài khoản</Button></>}
      >
        <InfoNote tone="orange">Tài khoản <strong>{pendingDelete?.name}</strong> sẽ không thể đăng nhập sau khi bị xóa. Dữ liệu cửa hàng không bị ảnh hưởng.</InfoNote>
      </Modal>
    </div>
  )
}

export default ManagerAccounts
