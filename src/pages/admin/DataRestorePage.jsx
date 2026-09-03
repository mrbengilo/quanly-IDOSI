import { useCallback, useEffect, useMemo, useState } from 'react'
import { Clock3, History, LockKeyhole, RefreshCcw, Save, Search, ShoppingCart, UserRoundX } from 'lucide-react'
import {
  Badge,
  Button,
  Card,
  Field,
  InfoNote,
  Input,
  Modal,
  PageHeader,
  SearchInput,
  Select,
  TableWrap,
} from '../../components/UI'
import { apiGetAudit } from '../../services/idosiApi'
import { useApp } from '../../state/AppContext'
import {
  money,
  operationalIdentifierRecordMatch,
  shortDate,
  shortDateTime24,
  today,
} from '../../utils'
import './DataRestorePage.css'

const AUDIT_PAGE_SIZE = 100
const TAB = Object.freeze({ ATTENDANCE: 'attendance', ORDERS: 'orders', EMPLOYEES: 'employees' })
const UNIT_LABELS = Object.freeze({
  store: 'Cửa Hàng',
  business_support: 'HTKD',
  office: 'Văn Phòng',
})
const FIELD_LABELS = Object.freeze({
  customerName: 'Tên khách hàng',
  customerPhone: 'Số điện thoại',
  customerAge: 'Tuổi',
  gender: 'Giới tính',
  occupation: 'Nghề nghiệp',
  acquisitionChannel: 'Kênh khách hàng',
  amount: 'Số tiền',
  paymentMethod: 'Thanh toán',
  status: 'Trạng thái',
  checkIn: 'Giờ điểm danh',
  checkInTime: 'Giờ điểm danh',
  checkInAt: 'Thời điểm điểm danh',
  checkOut: 'Giờ kết thúc',
  checkOutTime: 'Giờ kết thúc',
  checkOutAt: 'Thời điểm kết thúc',
  date: 'Ngày',
  workDate: 'Ngày làm việc',
  shiftId: 'Mã ca',
  shiftName: 'Ca làm việc',
})
const IGNORED_CHANGE_FIELDS = new Set([
  'updatedAt', 'updatedBy', 'editedAt', 'editedBy', 'createdAt', 'createdBy',
  'version', 'authVersion', 'password', 'passwordHash', 'legacyPassword',
])

const normalizeText = (value) => String(value || '').trim().toLocaleLowerCase('vi-VN')
const employeeId = (employee = {}) => String(
  employee.id || employee.code || employee.employeeId || employee.employeeCode || '',
).trim()
const employeeAliases = (employee = {}) => [
  employee.id, employee.code, employee.employeeId, employee.employeeCode,
].map((value) => String(value || '').trim()).filter(Boolean)
const employeeReferences = (record = {}) => [
  record.employeeId, record.employeeCode, record.staffId, record.userId,
].map((value) => String(value || '').trim()).filter(Boolean)
const storeAliases = (store = {}) => [store.id, store.code, store.storeId]
  .map((value) => String(value || '').trim()).filter(Boolean)

const resolveTarget = (records, reference, aliases, fallback = null) => {
  const source = Array.isArray(records) ? records : []
  if (!source.length) return fallback
  const result = operationalIdentifierRecordMatch(source, reference, aliases)
  return result.ambiguous ? null : result.record || fallback
}

const recordMatchesEmployee = (record, employee, employees) => {
  if (!employee) return false
  return employeeReferences(record).some((reference) => (
    resolveTarget(employees, reference, employeeAliases) === employee
  ))
}

const employeeUnit = (employee = {}) => {
  const unit = normalizeText(employee.unit || employee.unitType || employee.department)
  const storeId = String(employee.storeId || '').trim().toUpperCase()
  if (unit === 'business_support' || storeId === 'BUSINESS_SUPPORT') return 'business_support'
  if (unit === 'office' || storeId === 'OFFICE') return 'office'
  if (unit === 'store_manager') return 'store_manager'
  return unit === 'store' || !unit ? 'store' : unit
}

const recordDate = (record = {}) => String(
  record.workDate || record.attendanceDate || record.date || record.checkInAt || record.createdAt || '',
).slice(0, 10)

const clockValue = (record, kind) => {
  const source = record && typeof record === 'object' ? record : {}
  const explicit = source[kind] || source[`${kind}Time`]
  if (explicit) return String(explicit).slice(0, 5)
  const timestamp = source[`${kind}At`]
  if (!timestamp) return ''
  const parsed = new Date(timestamp)
  if (Number.isNaN(parsed.getTime())) return String(timestamp).slice(11, 16)
  return parsed.toLocaleTimeString('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

const auditSource = (audit = {}) => audit.after || audit.before || {}
const auditTimestamp = (audit = {}) => audit.serverTimestamp || audit.createdAt || audit.updatedAt || ''
const auditReason = (audit = {}) => String(
  audit.metadata?.reason
  || audit.metadata?.restoreReason
  || audit.after?.editReason
  || audit.after?.deleteReason
  || audit.before?.editReason
  || audit.before?.deleteReason
  || '',
).trim()
const auditActor = (audit = {}) => String(
  audit.actorName || audit.metadata?.actorName || audit.actorId || 'Hệ thống',
).trim()
const actionLabel = (action) => {
  const operation = String(action || '').split('.').at(-1)
  if (operation === 'delete') return 'Xóa'
  if (operation === 'update') return 'Sửa'
  if (operation === 'restore') return 'Khôi phục'
  return action || '—'
}

const changedFields = (audit = {}) => {
  const metadataFields = Array.isArray(audit.metadata?.changedFields)
    ? audit.metadata.changedFields
    : []
  if (metadataFields.length) return metadataFields.filter((field) => !IGNORED_CHANGE_FIELDS.has(field))
  const before = audit.before && typeof audit.before === 'object' ? audit.before : {}
  const after = audit.after && typeof audit.after === 'object' ? audit.after : {}
  return [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter((field) => !IGNORED_CHANGE_FIELDS.has(field))
    .filter((field) => JSON.stringify(before[field]) !== JSON.stringify(after[field]))
}

const auditValue = (field, value) => {
  if (value == null || value === '') return '—'
  if (field === 'amount') return money(value)
  if (['checkIn', 'checkInTime', 'checkOut', 'checkOutTime'].includes(field)) return String(value).slice(0, 5)
  if (field.endsWith('At')) return shortDateTime24(value)
  if (typeof value === 'boolean') return value ? 'Có' : 'Không'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

const auditChanges = (audit = {}) => changedFields(audit).map((field) => ({
  field,
  label: FIELD_LABELS[field] || field,
  before: auditValue(field, audit.before?.[field]),
  after: auditValue(field, audit.after?.[field]),
}))

const storeNameFor = (stores, reference) => (
  resolveTarget(stores, reference, storeAliases)?.name || reference || '—'
)

const employeeNameForAudit = (audit, employees) => {
  const source = auditSource(audit)
  const reference = source.employeeId || source.employeeCode || audit.entityId
  return resolveTarget(employees, reference, employeeAliases)?.name
    || source.employeeName
    || source.name
    || reference
    || '—'
}

const orderSearchText = (audit, stores) => {
  const order = auditSource(audit)
  return [
    audit.entityId, order.id, order.code, order.customerName, order.customerPhone,
    order.employeeName, order.paymentMethod, storeNameFor(stores, order.storeId),
    auditActor(audit), actionLabel(audit.action), auditReason(audit),
  ].map(normalizeText).join(' ')
}

const employeeSearchText = (audit, stores) => {
  const employee = audit.before || {}
  return [
    audit.entityId, employeeId(employee), employee.name, employee.phone, employee.position,
    UNIT_LABELS[employeeUnit(employee)] || employeeUnit(employee),
    storeNameFor(stores, employee.storeId), auditActor(audit),
  ].map(normalizeText).join(' ')
}

function AuditLoadMore({ hasMore, loadingMore, loadAudit }) {
  if (!hasMore) return null
  return <div className="card-actions card-actions--below">
    <Button variant="outline" icon={Search} loading={loadingMore} onClick={() => loadAudit({ append: true })}>
      TẢI THÊM LỊCH SỬ
    </Button>
  </div>
}

function ChangeList({ audit, deletedLabel = 'Bản ghi đã bị xóa' }) {
  if (String(audit.action || '').endsWith('.delete')) {
    return <div className="data-restore-change-list"><span><strong>{deletedLabel}</strong><small>{auditReason(audit) || 'Dữ liệu trước khi xóa đã được giữ trong nhật ký.'}</small></span></div>
  }
  const changes = auditChanges(audit)
  if (!changes.length) return <span className="table-note">Không có trường thay đổi rõ ràng.</span>
  return <div className="data-restore-change-list">
    {changes.map((change) => <span key={change.field}>
      <strong>{change.label}</strong>
      <small>{change.before} → {change.after}</small>
    </span>)}
  </div>
}

export function DataRestorePage() {
  const {
    attendance = [],
    employees = [],
    stores = [],
    session,
    updateAttendance,
    restoreOperationalData,
    notify,
  } = useApp()
  const [activeTab, setActiveTab] = useState(TAB.ATTENDANCE)
  const [audit, setAudit] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [error, setError] = useState('')
  const [attendanceFilter, setAttendanceFilter] = useState({
    date: today(), unit: 'store', storeId: '', employeeId: '',
  })
  const [attendanceEditing, setAttendanceEditing] = useState(null)
  const [attendanceForm, setAttendanceForm] = useState({ checkIn: '', checkOut: '', reason: '' })
  const [attendanceSaving, setAttendanceSaving] = useState(false)
  const [orderQuery, setOrderQuery] = useState('')
  const [orderStoreId, setOrderStoreId] = useState('')
  const [employeeQuery, setEmployeeQuery] = useState('')
  const [employeeStoreId, setEmployeeStoreId] = useState('')
  const [restoreTarget, setRestoreTarget] = useState(null)
  const [restoreReason, setRestoreReason] = useState('')
  const [restoring, setRestoring] = useState(false)
  const isAdmin = session?.role === 'admin'

  const loadAudit = useCallback(async ({ append = false } = {}) => {
    if (!isAdmin) return
    append ? setLoadingMore(true) : setLoading(true)
    setError('')
    try {
      const beforeId = append ? Number(audit.at(-1)?.id || 0) : 0
      const response = await apiGetAudit({ limit: AUDIT_PAGE_SIZE, beforeId })
      const rows = Array.isArray(response.audit) ? response.audit : []
      setAudit((current) => {
        const combined = append ? [...current, ...rows] : rows
        const byId = new Map(combined.map((item) => [String(item.id), item]))
        return [...byId.values()]
      })
      setHasMore(rows.length === AUDIT_PAGE_SIZE)
    } catch (requestError) {
      setError(requestError.message || 'Không thể tải nhật ký dữ liệu.')
    } finally {
      append ? setLoadingMore(false) : setLoading(false)
    }
  }, [audit, isAdmin])

  useEffect(() => {
    if (!isAdmin) return undefined
    let active = true
    apiGetAudit({ limit: AUDIT_PAGE_SIZE, beforeId: 0 })
      .then((response) => {
        if (!active) return
        const rows = Array.isArray(response.audit) ? response.audit : []
        setAudit(rows)
        setHasMore(rows.length === AUDIT_PAGE_SIZE)
      })
      .catch((requestError) => {
        if (active) setError(requestError.message || 'Không thể tải nhật ký dữ liệu.')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => { active = false }
  }, [isAdmin])

  const restoredAuditIds = useMemo(() => new Set(audit
    .filter((item) => item.action === 'operational_reset.restore')
    .map((item) => Number(item.metadata?.sourceAuditLogId || 0))
    .filter((id) => id > 0)), [audit])

  const scopedEmployees = useMemo(() => employees
    .filter((employee) => (
      !employee.deletedAt
      && employeeUnit(employee) === attendanceFilter.unit
      && (attendanceFilter.unit !== 'store'
        || !attendanceFilter.storeId
        || resolveTarget(stores, employee.storeId, storeAliases) === resolveTarget(stores, attendanceFilter.storeId, storeAliases))
    ))
    .sort((left, right) => String(left.name || '').localeCompare(String(right.name || ''), 'vi-VN')), [attendanceFilter.storeId, attendanceFilter.unit, employees, stores])

  const selectedEmployee = useMemo(() => resolveTarget(
    scopedEmployees,
    attendanceFilter.employeeId,
    employeeAliases,
  ), [attendanceFilter.employeeId, scopedEmployees])

  const attendanceRows = useMemo(() => {
    if (!selectedEmployee || !attendanceFilter.date) return []
    return attendance
      .filter((record) => (
        !record.deletedAt
        && recordDate(record) === attendanceFilter.date
        && recordMatchesEmployee(record, selectedEmployee, employees)
      ))
      .sort((left, right) => String(right.checkInAt || right.checkIn || '').localeCompare(String(left.checkInAt || left.checkIn || '')))
  }, [attendance, attendanceFilter.date, employees, selectedEmployee])

  const attendanceAuditRows = useMemo(() => {
    if (!selectedEmployee || !attendanceFilter.date) return []
    return audit.filter((item) => (
      item.entityType === 'attendance'
      && item.action === 'attendance.update'
      && recordDate(auditSource(item)) === attendanceFilter.date
      && recordMatchesEmployee(auditSource(item), selectedEmployee, employees)
    ))
  }, [attendanceFilter.date, audit, employees, selectedEmployee])

  const orderAudits = useMemo(() => audit.filter((item) => (
    item.entityType === 'order'
    && ['order.update', 'order.delete'].includes(item.action)
  )), [audit])

  const filteredOrderAudits = useMemo(() => {
    const query = normalizeText(orderQuery)
    return orderAudits.filter((item) => {
      const order = auditSource(item)
      if (orderStoreId && resolveTarget(stores, order.storeId, storeAliases) !== resolveTarget(stores, orderStoreId, storeAliases)) return false
      return !query || orderSearchText(item, stores).includes(query)
    })
  }, [orderAudits, orderQuery, orderStoreId, stores])

  const deletedEmployeeAudits = useMemo(() => {
    const latestByEmployee = new Map()
    audit.forEach((item) => {
      if (item.entityType !== 'employee' || item.action !== 'employee.delete') return
      if (restoredAuditIds.has(Number(item.id))) return
      const key = normalizeText(item.entityId || employeeId(item.before))
      if (key && !latestByEmployee.has(key)) latestByEmployee.set(key, item)
    })
    return [...latestByEmployee.values()]
  }, [audit, restoredAuditIds])

  const filteredDeletedEmployeeAudits = useMemo(() => {
    const query = normalizeText(employeeQuery)
    return deletedEmployeeAudits.filter((item) => {
      const employee = item.before || {}
      if (employeeStoreId && resolveTarget(stores, employee.storeId, storeAliases) !== resolveTarget(stores, employeeStoreId, storeAliases)) return false
      return !query || employeeSearchText(item, stores).includes(query)
    })
  }, [deletedEmployeeAudits, employeeQuery, employeeStoreId, stores])

  const openAttendanceEdit = (record) => {
    setAttendanceEditing(record)
    setAttendanceForm({
      checkIn: clockValue(record, 'checkIn'),
      checkOut: clockValue(record, 'checkOut'),
      reason: '',
    })
  }

  const saveAttendance = async () => {
    if (!attendanceEditing || attendanceSaving) return
    if (!attendanceForm.checkIn) return notify?.('Vui lòng nhập giờ điểm danh.', 'info')
    if (!attendanceForm.reason.trim()) return notify?.('Vui lòng nhập lý do chỉnh sửa chấm công.', 'info')
    if (typeof updateAttendance !== 'function') return notify?.('Chức năng cập nhật chấm công chưa sẵn sàng.', 'info')
    setAttendanceSaving(true)
    try {
      const result = await updateAttendance(attendanceEditing.id, {
        date: recordDate(attendanceEditing),
        checkIn: attendanceForm.checkIn,
        checkOut: attendanceForm.checkOut,
        reason: attendanceForm.reason.trim(),
      })
      if (!result?.ok) {
        notify?.(result?.message || 'Không thể cập nhật chấm công.', 'info')
        return
      }
      setAttendanceEditing(null)
      setAttendanceForm({ checkIn: '', checkOut: '', reason: '' })
      await loadAudit()
    } finally {
      setAttendanceSaving(false)
    }
  }

  const openRestore = (item, dataType) => {
    setRestoreTarget({ audit: item, dataType })
    setRestoreReason('')
  }

  const restoreSelected = async () => {
    if (!restoreTarget || restoring) return
    if (!restoreReason.trim()) return notify?.('Vui lòng nhập lý do khôi phục dữ liệu.', 'info')
    if (typeof restoreOperationalData !== 'function') return notify?.('Chức năng khôi phục dữ liệu chưa sẵn sàng.', 'info')
    const item = restoreTarget.audit
    const source = auditSource(item)
    const date = recordDate(source)
    setRestoring(true)
    try {
      const result = await restoreOperationalData({
        dataType: restoreTarget.dataType,
        auditLogId: item.id,
        storeId: source.storeId || '',
        ...(date ? { fromDate: date, toDate: date } : {}),
        ...(source.employeeId ? { employeeId: source.employeeId } : {}),
        reason: restoreReason.trim(),
      })
      if (!result?.ok) {
        notify?.(result?.message || 'Không thể khôi phục dữ liệu.', 'info')
        return
      }
      setRestoreTarget(null)
      setRestoreReason('')
      await loadAudit()
    } finally {
      setRestoring(false)
    }
  }

  if (!isAdmin) {
    return <div className="page"><PageHeader title="KHÔNG CÓ QUYỀN TRUY CẬP" subtitle="Chỉ Admin được xem và khôi phục dữ liệu hệ thống." icon={LockKeyhole} /></div>
  }

  const selectedUnitLabel = UNIT_LABELS[attendanceFilter.unit] || 'Nhân viên'
  const attendanceEndLabel = attendanceFilter.unit === 'store' ? 'Giờ kết ca' : 'Giờ ra về'
  const attendanceEndHistoryLabel = attendanceFilter.unit === 'store' ? 'Kết ca' : 'Ra về'

  return <div className="page governance-page data-restore-page">
    <PageHeader
      title="KHÔI PHỤC DỮ LIỆU"
      subtitle="Chỉnh sửa chấm công có kiểm toán, khôi phục đơn hàng và kích hoạt lại nhân viên bị xóa."
      icon={History}
      actions={<Button variant="outline" icon={RefreshCcw} onClick={() => loadAudit()} loading={loading}>TẢI LẠI</Button>}
    />
    <div className="data-restore-tabs" role="tablist" aria-label="Nhóm dữ liệu khôi phục">
      <button type="button" role="tab" aria-selected={activeTab === TAB.ATTENDANCE} className={activeTab === TAB.ATTENDANCE ? 'is-active' : ''} onClick={() => setActiveTab(TAB.ATTENDANCE)}>
        <Clock3 size={18} /><span><strong>CHẤM CÔNG</strong><small>Sửa giờ vào và giờ kết thúc</small></span>
      </button>
      <button type="button" role="tab" aria-selected={activeTab === TAB.ORDERS} className={activeTab === TAB.ORDERS ? 'is-active' : ''} onClick={() => setActiveTab(TAB.ORDERS)}>
        <ShoppingCart size={18} /><span><strong>ĐƠN HÀNG</strong><small>Lịch sử sửa, xóa và khôi phục</small></span>
      </button>
      <button type="button" role="tab" aria-selected={activeTab === TAB.EMPLOYEES} className={activeTab === TAB.EMPLOYEES ? 'is-active' : ''} onClick={() => setActiveTab(TAB.EMPLOYEES)}>
        <UserRoundX size={18} /><span><strong>THÔNG TIN NHÂN VIÊN ĐÃ XÓA</strong><small>Kích hoạt lại hồ sơ và tài khoản</small></span>
      </button>
    </div>
    {error ? <InfoNote tone="orange">{error}</InfoNote> : null}

    {activeTab === TAB.ATTENDANCE && <div role="tabpanel" className="data-restore-panel">
      <InfoNote>Mọi lần sửa giờ đều yêu cầu lý do, cập nhật lại số giờ làm liên quan và ghi nhật ký trước/sau, người thực hiện, thời gian thực hiện.</InfoNote>
      <Card title="Chọn dữ liệu chấm công">
        <div className="form-grid form-grid--3">
          <Field label="Ngày làm việc" required>
            <Input type="date" value={attendanceFilter.date} onChange={(event) => setAttendanceFilter((current) => ({ ...current, date: event.target.value, employeeId: '' }))} />
          </Field>
          <Field label="Loại nhân viên" required>
            <Select value={attendanceFilter.unit} onChange={(event) => setAttendanceFilter({ date: attendanceFilter.date, unit: event.target.value, storeId: '', employeeId: '' })}>
              <option value="business_support">HTKD</option>
              <option value="office">Văn Phòng</option>
              <option value="store">Cửa Hàng</option>
            </Select>
          </Field>
          {attendanceFilter.unit === 'store' && <Field label="Cửa hàng" required>
            <Select value={attendanceFilter.storeId} onChange={(event) => setAttendanceFilter((current) => ({ ...current, storeId: event.target.value, employeeId: '' }))}>
              <option value="">Chọn cửa hàng</option>
              {stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}
            </Select>
          </Field>}
          <Field label="Nhân viên" required>
            <Select
              value={attendanceFilter.employeeId}
              disabled={attendanceFilter.unit === 'store' && !attendanceFilter.storeId}
              onChange={(event) => setAttendanceFilter((current) => ({ ...current, employeeId: event.target.value }))}
            >
              <option value="">Chọn nhân viên</option>
              {scopedEmployees.map((employee) => <option key={employeeId(employee)} value={employeeId(employee)}>{employee.name} — {employeeId(employee)}</option>)}
            </Select>
          </Field>
        </div>
      </Card>
      <Card title={selectedEmployee ? `Lịch sử chấm công · ${selectedEmployee.name}` : 'Lịch sử chấm công'}>
        <TableWrap><thead><tr><th>Ngày</th><th>Loại</th><th>Cửa hàng / đơn vị</th><th>Ca làm việc</th><th>Giờ điểm danh</th><th>{attendanceEndLabel}</th><th>Trạng thái</th><th>Thao tác</th></tr></thead><tbody>
          {attendanceRows.map((record) => {
            const open = !record.checkOutAt && !record.checkOut && !record.checkOutTime
            return <tr key={record.id}>
              <td><strong>{shortDate(recordDate(record))}</strong></td>
              <td><Badge tone={attendanceFilter.unit === 'store' ? 'blue' : attendanceFilter.unit === 'office' ? 'green' : 'orange'}>{selectedUnitLabel}</Badge></td>
              <td>{storeNameFor(stores, record.storeId || selectedEmployee?.storeId)}</td>
              <td>{record.shiftName || record.shift || '—'}<small className="table-note">{record.shiftStart || '—'}–{record.shiftEnd || '—'}</small></td>
              <td><strong>{clockValue(record, 'checkIn') || '—'}</strong></td>
              <td><strong>{clockValue(record, 'checkOut') || (open ? 'Đang làm' : '—')}</strong></td>
              <td><Badge tone={open ? 'orange' : 'green'}>{open ? 'Đang làm việc' : record.status || 'Đã ghi nhận'}</Badge></td>
              <td><Button variant="outline" onClick={() => openAttendanceEdit(record)}>SỬA THỜI GIAN</Button></td>
            </tr>
          })}
          {!attendanceRows.length && <tr><td colSpan="8">{selectedEmployee ? 'Không có dữ liệu chấm công trong ngày đã chọn.' : 'Chọn ngày, loại và nhân viên để xem chấm công.'}</td></tr>}
        </tbody></TableWrap>
      </Card>
      <Card title="Lịch sử thay đổi chấm công">
        <TableWrap><thead><tr><th>Thời gian sửa</th><th>Nhân viên</th><th>Ngày làm việc</th><th>Giờ cũ</th><th>Giờ sau sửa</th><th>Nội dung thay đổi</th><th>Người thực hiện</th><th>Lý do</th></tr></thead><tbody>
          {attendanceAuditRows.map((item) => <tr key={item.id}>
            <td>{shortDateTime24(auditTimestamp(item))}</td>
            <td><strong>{employeeNameForAudit(item, employees)}</strong><small className="table-note">{auditSource(item).employeeId || auditSource(item).employeeCode || '—'}</small></td>
            <td>{shortDate(recordDate(auditSource(item)))}</td>
            <td><span className="table-stack"><span>Vào: <strong>{clockValue(item.before, 'checkIn') || '—'}</strong></span><span>{attendanceEndHistoryLabel}: <strong>{clockValue(item.before, 'checkOut') || '—'}</strong></span></span></td>
            <td><span className="table-stack"><span>Vào: <strong>{clockValue(item.after, 'checkIn') || '—'}</strong></span><span>{attendanceEndHistoryLabel}: <strong>{clockValue(item.after, 'checkOut') || '—'}</strong></span></span></td>
            <td><ChangeList audit={item} /></td>
            <td>{auditActor(item)}<small className="table-note">{item.actorRole || '—'}</small></td>
            <td>{auditReason(item) || '—'}</td>
          </tr>)}
          {!loading && !attendanceAuditRows.length && <tr><td colSpan="8">{selectedEmployee ? 'Chưa có lịch sử chỉnh sửa cho dữ liệu đã chọn.' : 'Chọn nhân viên để xem lịch sử thay đổi.'}</td></tr>}
          {loading && <tr><td colSpan="8">Đang tải lịch sử thay đổi...</td></tr>}
        </tbody></TableWrap>
        <AuditLoadMore hasMore={hasMore} loadingMore={loadingMore} loadAudit={loadAudit} />
      </Card>
    </div>}

    {activeTab === TAB.ORDERS && <div role="tabpanel" className="data-restore-panel">
      <InfoNote>Tab này chỉ hiển thị đơn hàng đã từng bị sửa hoặc xóa. Khôi phục luôn dùng đúng bản chụp trước thao tác và bị chặn nếu dữ liệu đã phát sinh thay đổi mới hơn hoặc kỳ lương đã khóa/đã chi.</InfoNote>
      <Card title="Lịch sử đơn hàng bị sửa hoặc xóa" action={<div className="toolbar-wrap"><SearchInput value={orderQuery} onChange={setOrderQuery} placeholder="Tìm mã đơn, khách hàng, người thực hiện..." /><Select aria-label="Lọc cửa hàng đơn hàng" value={orderStoreId} onChange={(event) => setOrderStoreId(event.target.value)}><option value="">Tất cả cửa hàng</option>{stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}</Select></div>}>
        <TableWrap><thead><tr><th>Thời gian thay đổi</th><th>Cửa hàng</th><th>Đơn hàng</th><th>Thông tin đầy đủ</th><th>Thao tác</th><th>Nội dung thay đổi</th><th>Người thực hiện</th><th>Khôi phục</th></tr></thead><tbody>
          {filteredOrderAudits.map((item) => {
            const order = auditSource(item)
            const restored = restoredAuditIds.has(Number(item.id))
            return <tr key={item.id}>
              <td>{shortDateTime24(auditTimestamp(item))}</td>
              <td><strong>{storeNameFor(stores, order.storeId)}</strong><small className="table-note">{order.storeId || '—'}</small></td>
              <td><strong>{order.code || item.entityId || '—'}</strong><small className="table-note">{order.id || item.entityId || '—'}</small></td>
              <td><div className="data-restore-detail-list"><span><b>Khách:</b> {order.customerName || 'Khách lẻ'} · {order.customerPhone || '—'}</span><span><b>Tuổi / giới tính:</b> {order.customerAge ?? '—'} · {order.gender || '—'}</span><span><b>Nghề nghiệp:</b> {order.occupation || '—'}</span><span><b>Biết qua kênh:</b> {order.acquisitionChannel || '—'}</span><span><b>Nhân viên:</b> {order.employeeName || order.employeeId || '—'}</span><span><b>Ca:</b> {order.shiftName || order.shiftId || '—'}</span><span><b>Thanh toán:</b> {order.paymentMethod || '—'}</span><span><b>Số tiền:</b> {money(order.amount || 0)}</span><span><b>Thời gian tạo:</b> {shortDateTime24(order.createdAt) || '—'}</span></div></td>
              <td><Badge tone={item.action.endsWith('.delete') ? 'red' : 'orange'}>{actionLabel(item.action)}</Badge><small className="table-note">{auditReason(item) || 'Không ghi lý do'}</small></td>
              <td><ChangeList audit={item} deletedLabel="Đơn hàng đã bị xóa" /></td>
              <td>{auditActor(item)}<small className="table-note">{item.actorRole || '—'}</small></td>
              <td>{restored ? <Badge tone="green">Đã khôi phục</Badge> : <Button variant="outline" icon={RefreshCcw} onClick={() => openRestore(item, 'orders')}>KHÔI PHỤC</Button>}</td>
            </tr>
          })}
          {!loading && !filteredOrderAudits.length && <tr><td colSpan="8">Chưa có lịch sử đơn hàng phù hợp.</td></tr>}
          {loading && <tr><td colSpan="8">Đang tải lịch sử đơn hàng...</td></tr>}
        </tbody></TableWrap>
        <AuditLoadMore hasMore={hasMore} loadingMore={loadingMore} loadAudit={loadAudit} />
      </Card>
    </div>}

    {activeTab === TAB.EMPLOYEES && <div role="tabpanel" className="data-restore-panel">
      <InfoNote>Danh sách chỉ gồm hồ sơ đang ở trạng thái đã xóa và chưa được khôi phục. Khôi phục sẽ kích hoạt lại hồ sơ nhân viên và tài khoản đăng nhập tương ứng theo nhật ký gốc.</InfoNote>
      <Card title="Thông tin nhân viên đã xóa" action={<div className="toolbar-wrap"><SearchInput value={employeeQuery} onChange={setEmployeeQuery} placeholder="Tìm tên, mã, số điện thoại..." /><Select aria-label="Lọc cửa hàng nhân viên đã xóa" value={employeeStoreId} onChange={(event) => setEmployeeStoreId(event.target.value)}><option value="">Tất cả cửa hàng / đơn vị</option>{stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}</Select></div>}>
        <TableWrap><thead><tr><th>Thời gian xóa</th><th>Mã nhân viên</th><th>Họ tên</th><th>Loại / Chức vụ</th><th>Cửa hàng / đơn vị</th><th>Thông tin liên hệ</th><th>Người thực hiện</th><th>Khôi phục</th></tr></thead><tbody>
          {filteredDeletedEmployeeAudits.map((item) => {
            const employee = item.before || {}
            const unit = employeeUnit(employee)
            return <tr key={item.id}>
              <td>{shortDateTime24(auditTimestamp(item))}</td>
              <td><strong>{employeeId(employee) || item.entityId || '—'}</strong></td>
              <td><strong>{employee.name || '—'}</strong><small className="table-note">Ngày vào làm: {employee.startDate || employee.joinDate ? shortDate(employee.startDate || employee.joinDate) : '—'}</small></td>
              <td><Badge tone={unit === 'store' ? 'blue' : unit === 'office' ? 'green' : 'orange'}>{UNIT_LABELS[unit] || unit || 'Nhân viên'}</Badge><small className="table-note">{employee.position || employee.workPosition || employee.role || '—'}</small></td>
              <td><strong>{storeNameFor(stores, employee.storeId)}</strong><small className="table-note">{employee.storeId || '—'}</small></td>
              <td><div className="data-restore-detail-list"><span><b>Điện thoại:</b> {employee.phone || '—'}</span><span><b>Email:</b> {employee.email || '—'}</span><span><b>CCCD:</b> {employee.cccd || employee.citizenId || '—'}</span><span><b>Địa chỉ:</b> {typeof employee.address === 'string' ? employee.address || '—' : '—'}</span></div></td>
              <td>{auditActor(item)}<small className="table-note">{item.actorRole || '—'} · {auditReason(item) || 'Không ghi lý do'}</small></td>
              <td><Button variant="outline" icon={RefreshCcw} onClick={() => openRestore(item, 'employees')}>KHÔI PHỤC</Button></td>
            </tr>
          })}
          {!loading && !filteredDeletedEmployeeAudits.length && <tr><td colSpan="8">Không có nhân viên đang ở trạng thái đã xóa trong lịch sử đã tải.</td></tr>}
          {loading && <tr><td colSpan="8">Đang tải thông tin nhân viên đã xóa...</td></tr>}
        </tbody></TableWrap>
        <AuditLoadMore hasMore={hasMore} loadingMore={loadingMore} loadAudit={loadAudit} />
      </Card>
    </div>}

    <Modal
      open={Boolean(attendanceEditing)}
      onClose={() => !attendanceSaving && setAttendanceEditing(null)}
      title={`Sửa chấm công · ${selectedEmployee?.name || attendanceEditing?.employeeName || attendanceEditing?.employeeId || ''}`}
      footer={<><Button variant="outline" disabled={attendanceSaving} onClick={() => setAttendanceEditing(null)}>HỦY</Button><Button icon={Save} loading={attendanceSaving} disabled={attendanceSaving || !attendanceForm.checkIn || !attendanceForm.reason.trim()} onClick={saveAttendance}>LƯU</Button></>}
    >
      <div className="form-grid">
        <Field label="Giờ điểm danh" required><Input type="time" value={attendanceForm.checkIn} onChange={(event) => setAttendanceForm((current) => ({ ...current, checkIn: event.target.value }))} /></Field>
        <Field label={attendanceEndLabel}><Input type="time" value={attendanceForm.checkOut} onChange={(event) => setAttendanceForm((current) => ({ ...current, checkOut: event.target.value }))} /></Field>
        <Field label="Lý do chỉnh sửa" required className="span-2"><textarea maxLength={500} value={attendanceForm.reason} onChange={(event) => setAttendanceForm((current) => ({ ...current, reason: event.target.value }))} placeholder="Nhập lý do để ghi đầy đủ vào lịch sử thay đổi" /></Field>
        <InfoNote tone="orange">Dữ liệu sau khi lưu sẽ được dùng lại cho số giờ làm, chấm công và các bước tổng hợp liên quan. Kỳ lương đã chi hoặc đã khóa vẫn được hệ thống bảo vệ.</InfoNote>
      </div>
    </Modal>

    <Modal
      open={Boolean(restoreTarget)}
      onClose={() => !restoring && setRestoreTarget(null)}
      title="Xác nhận khôi phục dữ liệu"
      footer={<><Button variant="outline" disabled={restoring} onClick={() => setRestoreTarget(null)}>HỦY</Button><Button icon={RefreshCcw} loading={restoring} disabled={restoring || !restoreReason.trim()} onClick={restoreSelected}>KHÔI PHỤC DỮ LIỆU</Button></>}
    >
      <div className="form-stack">
        <InfoNote tone="orange">Khôi phục <strong>{restoreTarget?.dataType === 'orders' ? 'đơn hàng' : 'nhân viên'}</strong> mã <strong>{restoreTarget?.audit?.entityId || '—'}</strong> về trạng thái trước thao tác lúc {shortDateTime24(auditTimestamp(restoreTarget?.audit))}.</InfoNote>
        <Field label="Lý do khôi phục" required><textarea maxLength={500} value={restoreReason} onChange={(event) => setRestoreReason(event.target.value)} placeholder="Nhập lý do để lưu nhật ký kiểm toán" /></Field>
      </div>
    </Modal>
  </div>
}
