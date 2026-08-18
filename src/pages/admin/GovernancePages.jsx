import { useMemo, useState } from 'react'
import {
  CalendarClock,
  History,
  KeyRound,
  LockKeyhole,
  RefreshCcw,
  Save,
  Settings2,
  ShieldCheck,
  Trash2,
  UserCog,
  Users,
} from 'lucide-react'
import {
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
  TableWrap,
} from '../../components/UI'
import { useApp } from '../../state/AppContext'
import { formatMoneyInput, money, parseMoneyInput, shortDate, today } from '../../utils'
import { orderAuditChanges } from './orderAuditUtils'

const displayDateTime = (value) => {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? String(value || '—') : date.toLocaleString('vi-VN', { hour12: false })
}

const employeeTypeLabel = (employee = {}) => String(employee.employmentType || employee.employeeType || employee.type || 'Full-Time').toLowerCase().includes('part') ? 'Part-Time' : 'Full-Time'

function OrderAuditChangeList({ record }) {
  const changes = orderAuditChanges(record)
  if (!changes.length) return <span>—</span>
  return <div className="audit-change-list">{changes.map((change) => <div className="audit-change-item" key={change.field}><strong>{change.label}</strong><span><del>{change.before}</del><b aria-hidden="true">→</b><ins>{change.after}</ins></span></div>)}</div>
}

export function PolicySettings() {
  const { policies, policyHistory = [], savePolicies, notify, session } = useApp()
  const [form, setForm] = useState(() => ({
    lateToleranceMinutes: policies.lateToleranceMinutes,
    earlyCheckInLimitMinutes: policies.earlyCheckInLimitMinutes,
    from30000: policies.employeeKpiRates.from30000,
    from15000: policies.employeeKpiRates.from15000,
    from7000: policies.employeeKpiRates.from7000,
    maintainMaxLateCount: policies.attendanceEvaluation.maintainMaxLateCount,
    improveMinLateCount: policies.attendanceEvaluation.improveMinLateCount,
    improveMinLateMinutes: policies.attendanceEvaluation.improveMinLateMinutes,
    effectiveFrom: policies.effectiveFrom || today(),
  }))
  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }))

  if (!['admin', 'business_support', 'manager'].includes(session?.role)) {
    return <div className="page"><PageHeader title="KHÔNG CÓ QUYỀN TRUY CẬP" subtitle="Tài khoản này không được truy cập Cài đặt chính sách." icon={LockKeyhole} /></div>
  }

  const save = async () => {
    const result = await savePolicies({
      lateToleranceMinutes: Number(form.lateToleranceMinutes),
      earlyCheckInLimitMinutes: Number(form.earlyCheckInLimitMinutes),
      employeeKpiRates: {
        from30000: Number(form.from30000),
        from15000: Number(form.from15000),
        from7000: Number(form.from7000),
      },
      attendanceEvaluation: {
        maintainMaxLateCount: Number(form.maintainMaxLateCount),
        improveMinLateCount: Number(form.improveMinLateCount),
        improveMinLateMinutes: Number(form.improveMinLateMinutes),
      },
      effectiveFrom: form.effectiveFrom,
    })
    if (!result.ok) notify(result.message, 'info')
  }

  return (
    <div className="page governance-page">
      <PageHeader title="CÀI ĐẶT CHÍNH SÁCH" subtitle="Chính sách dùng chung cho toàn bộ cửa hàng; kỳ đã khóa luôn giữ nguyên bản chụp cũ." icon={Settings2} actions={<Button icon={Save} onClick={save}>LƯU TẤT CẢ</Button>} />
      <div className="policy-grid">
        <Card title="Set thời gian đi trễ" className="policy-card">
          <Field label="Số phút được phép"><Input type="number" min="0" step="1" value={form.lateToleranceMinutes} onChange={set('lateToleranceMinutes')} /></Field>
          <Field label="Điểm danh sớm tối đa"><Input type="number" min="0" step="1" value={form.earlyCheckInLimitMinutes} onChange={set('earlyCheckInLimitMinutes')} /></Field>
          <InfoNote>Đã lưu thời gian đi trễ: <strong>{policies.lateToleranceMinutes} phút</strong>. Phút trễ thực tế vẫn tính từ giờ bắt đầu ca.</InfoNote>
        </Card>
        <Card title="KPI nhân viên theo lợi nhuận/giờ" className="policy-card span-2">
          <div className="form-grid form-grid--3">
            <Field label="Từ 30,000đ/giờ (%)"><Input type="number" min="0" step="0.01" value={form.from30000} onChange={set('from30000')} /></Field>
            <Field label="Từ 15,000đ/giờ (%)"><Input type="number" min="0" step="0.01" value={form.from15000} onChange={set('from15000')} /></Field>
            <Field label="Từ 7,000đ/giờ (%)"><Input type="number" min="0" step="0.01" value={form.from7000} onChange={set('from7000')} /></Field>
          </div>
          <Field label="Ngày hiệu lực"><Input type="date" value={form.effectiveFrom} onChange={set('effectiveFrom')} /></Field>
          <InfoNote>Hệ thống chọn mốc cao nhất đạt được, không làm tròn giờ hoặc lợi nhuận/giờ trước khi tính thưởng.</InfoNote>
        </Card>
        <Card title="Ngưỡng đánh giá chuyên cần" className="policy-card">
          <Field label="Tối đa số lần trễ — Cần duy trì"><Input type="number" min="0" step="1" value={form.maintainMaxLateCount} onChange={set('maintainMaxLateCount')} /></Field>
          <Field label="Từ số lần trễ — Cần cải thiện"><Input type="number" min="0" step="1" value={form.improveMinLateCount} onChange={set('improveMinLateCount')} /></Field>
          <Field label="Hoặc tổng phút trễ từ"><Input type="number" min="0" step="1" value={form.improveMinLateMinutes} onChange={set('improveMinLateMinutes')} /></Field>
        </Card>
      </div>
      <Card title="Lịch sử thay đổi chính sách">
        <TableWrap><thead><tr><th>Thời gian</th><th>Người chỉnh sửa</th><th>Phiên bản cũ</th><th>Phiên bản mới</th><th>Ngày hiệu lực</th></tr></thead><tbody>{policyHistory.map((item) => <tr key={item.id}><td>{displayDateTime(item.createdAt)}</td><td>{item.actor?.name || 'Hệ thống'}</td><td>v{item.before?.version || 1}</td><td><Badge>v{item.after?.version || 1}</Badge></td><td>{shortDate(item.after?.effectiveFrom)}</td></tr>)}{!policyHistory.length && <tr><td colSpan="5">Chưa có thay đổi chính sách.</td></tr>}</tbody></TableWrap>
      </Card>
    </div>
  )
}

export function SystemEmployees() {
  const { employees = [], stores = [], updateEmployee, deleteEmployee, notify, session } = useApp()
  const [query, setQuery] = useState('')
  const [storeId, setStoreId] = useState('all')
  const [status, setStatus] = useState('all')
  const [resetTarget, setResetTarget] = useState(null)
  const [newPassword, setNewPassword] = useState('')
  const normalized = query.trim().toLowerCase()
  const storeEmployees = employees.filter((employee) => String(employee.unit || 'store') === 'store')
  const rows = storeEmployees.filter((employee) => (storeId === 'all' || employee.storeId === storeId) && (status === 'all' || employee.status === status) && (!normalized || [employee.id, employee.name, employee.phone, employee.cccd, employee.username].some((value) => String(value || '').toLowerCase().includes(normalized))))
  const canManageEmployee = session?.role === 'admin'

  const changeStatus = async (employee, nextStatus) => {
    if (!canManageEmployee) return
    const result = await updateEmployee(employee.id, { status: nextStatus })
    if (!result?.ok) notify(result?.message || 'Không thể cập nhật trạng thái.', 'info')
  }

  const resetPassword = async () => {
    if (!canManageEmployee) return
    if (newPassword.length < 8) return notify('Mật khẩu đặt lại phải có ít nhất 8 ký tự.', 'info')
    const result = await updateEmployee(resetTarget.id, { password: newPassword })
    if (!result?.ok) return notify(result?.message || 'Không thể đặt lại mật khẩu.', 'info')
    setResetTarget(null)
    setNewPassword('')
  }

  return (
    <div className="page">
      <PageHeader title="DANH SÁCH NHÂN VIÊN CỬA HÀNG" subtitle="Hồ sơ nhân sự của toàn bộ hệ thống; mật khẩu hiện tại không bao giờ được hiển thị." icon={Users} />
      {!canManageEmployee && <InfoNote>Chế độ chỉ xem. Chỉ Admin được đổi trạng thái, đặt lại mật khẩu hoặc xóa nhân viên.</InfoNote>}
      <div className="metrics-grid metrics-grid--4">
        <MetricCard label="TỔNG NHÂN VIÊN" value={storeEmployees.length} icon={Users} tone="blue" />
        <MetricCard label="ĐANG LÀM VIỆC" value={storeEmployees.filter((item) => item.status === 'Đang làm việc').length} icon={ShieldCheck} tone="green" />
        <MetricCard label="TẠM NGƯNG" value={storeEmployees.filter((item) => item.status === 'Tạm ngưng').length} icon={LockKeyhole} tone="orange" />
        <MetricCard label="ĐÃ NGHỈ VIỆC" value={storeEmployees.filter((item) => item.status === 'Đã nghỉ việc').length} icon={UserCog} tone="red" />
      </div>
      <Card title="Danh sách nhân viên cửa hàng" action={<div className="toolbar-wrap"><SearchInput value={query} onChange={setQuery} placeholder="Tìm mã, tên, CCCD..." /><Select value={storeId} onChange={(event) => setStoreId(event.target.value)}><option value="all">Tất cả cửa hàng</option>{stores.map((store) => <option value={store.id} key={store.id}>{store.name}</option>)}</Select><Select value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">Tất cả trạng thái</option><option>Đang làm việc</option><option>Tạm ngưng</option>{session?.role === 'admin' && <option>Đã nghỉ việc</option>}</Select></div>}>
        <TableWrap><thead><tr><th>Mã</th><th>Họ và tên</th><th>Cửa hàng</th><th>Loại nhân viên</th><th>Liên hệ / CCCD</th><th>Lương cứng</th><th>Phụ cấp TikTok</th><th>Tài khoản</th><th>Trạng thái</th>{canManageEmployee && <th>Thao tác</th>}</tr></thead><tbody>{rows.map((employee) => <tr key={employee.id}><td><strong>{employee.id}</strong></td><td><strong>{employee.name}</strong><small className="table-note">{employee.position}</small></td><td>{stores.find((store) => store.id === employee.storeId)?.name || employee.storeId}</td><td><Badge tone={employeeTypeLabel(employee) === 'Part-Time' ? 'orange' : 'blue'}>{employeeTypeLabel(employee)}</Badge></td><td>{employee.phone}<small className="table-note">CCCD: {employee.cccd}</small></td><td>{money(employee.monthlySalary || employee.hourlyRate || employee.salary)}<small className="table-note">{employee.payBasis === 'hourly' ? 'Theo giờ' : 'Theo tháng'}</small></td><td>{money(employee.tiktokAllowance)}</td><td><strong>{employee.username}</strong><small className="table-note">Đăng nhập gần nhất: {displayDateTime(employee.lastLoginAt)}</small></td><td>{canManageEmployee ? <Select aria-label={`Trạng thái ${employee.name}`} value={employee.status} onChange={(event) => changeStatus(employee, event.target.value)}><option>Đang làm việc</option><option>Tạm ngưng</option><option>Đã nghỉ việc</option></Select> : <Badge tone={employee.status === 'Đã nghỉ việc' ? 'red' : employee.status === 'Tạm ngưng' ? 'orange' : 'green'}>{employee.status || 'Đang làm việc'}</Badge>}</td>{canManageEmployee && <td><div className="row-actions"><button type="button" onClick={() => setResetTarget(employee)} aria-label={`Đặt lại mật khẩu ${employee.name}`} title="Đặt lại mật khẩu"><KeyRound size={17} /></button><button type="button" className="danger" onClick={() => window.confirm(`Xóa ${employee.name} khỏi hệ thống? Lịch sử vẫn được giữ.`) && deleteEmployee(employee.id)} aria-label={`Xóa ${employee.name}`} title="Xóa nhân viên"><Trash2 size={17} /></button></div></td>}</tr>)}{!rows.length && <tr><td colSpan={canManageEmployee ? 10 : 9}>Không có nhân viên phù hợp.</td></tr>}</tbody></TableWrap>
      </Card>
      {canManageEmployee && <Modal open={Boolean(resetTarget)} onClose={() => setResetTarget(null)} title={`Đặt lại mật khẩu — ${resetTarget?.name || ''}`} footer={<><Button variant="outline" onClick={() => setResetTarget(null)}>Hủy</Button><Button icon={KeyRound} onClick={resetPassword}>ĐẶT LẠI</Button></>}><InfoNote>Admin chỉ đặt mật khẩu mới; hệ thống không thể đọc lại mật khẩu hiện tại.</InfoNote><Field label="Mật khẩu mới" required><Input type="password" autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} /></Field></Modal>}
    </div>
  )
}

export function OrderAuditPage() {
  const { orderAudit = [], stores = [] } = useApp()
  const [query, setQuery] = useState('')
  const rows = orderAudit.filter((item) => !query || [item.orderCode, item.actor?.name, item.reason].some((value) => String(value || '').toLowerCase().includes(query.toLowerCase())))
  return <div className="page"><PageHeader title="LỊCH SỬ SỬA VÀ XÓA ĐƠN HÀNG" subtitle="Đối soát dữ liệu trước/sau của mọi thao tác ảnh hưởng doanh thu." icon={History} /><Card title="Nhật ký đơn hàng" action={<SearchInput value={query} onChange={setQuery} placeholder="Tìm mã đơn, người thao tác..." />}><TableWrap><thead><tr><th>Thời gian</th><th>Người thao tác</th><th>Cửa hàng</th><th>Mã đơn</th><th>Thao tác</th><th>Chi tiết thay đổi (trước → sau)</th><th>Doanh thu trước</th><th>Doanh thu sau</th><th>Lý do</th></tr></thead><tbody>{rows.map((item) => <tr key={item.id}><td>{displayDateTime(item.createdAt)}</td><td><strong>{item.actor?.name}</strong><small className="table-note">{item.actor?.role}</small></td><td>{stores.find((store) => store.id === item.storeId)?.name || item.storeId}</td><td><strong>{item.orderCode}</strong></td><td><Badge tone={item.action === 'Xóa' ? 'red' : 'orange'}>{item.action}</Badge></td><td><OrderAuditChangeList record={item} /></td><td>{money(item.revenueBefore)}</td><td>{money(item.revenueAfter)}</td><td>{item.reason || '—'}</td></tr>)}{!rows.length && <tr><td colSpan="9">Chưa có lịch sử sửa hoặc xóa đơn hàng.</td></tr>}</tbody></TableWrap></Card></div>
}

export function ResetDataPage() {
  const { attendance = [], employees = [], stores = [], updateAttendance, restoreOperationalData, resetAllData, auditLogs = [], attendanceAudit = [], operationalResetHistory = [], notify, session } = useApp()
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState({ checkIn: '', checkOut: '', reason: '' })
  const [resetForm, setResetForm] = useState({ dataType: 'orders', storeId: '', fromDate: today(), toDate: today(), employeeId: '', reason: '' })
  const [systemResetOpen, setSystemResetOpen] = useState(false)
  const [systemResetConfirmation, setSystemResetConfirmation] = useState('')
  const [systemResetBusy, setSystemResetBusy] = useState(false)
  const canonicalRole = session?.role === 'manager' ? 'business_support' : session?.role
  const isAdmin = canonicalRole === 'admin'
  const isBusinessSupport = canonicalRole === 'business_support'
  const canEditAttendance = isAdmin || isBusinessSupport
  const employeeById = useMemo(() => new Map(employees.map((employee) => [String(employee.id || employee.code), employee])), [employees])
  const canEditAttendanceRecord = (record) => {
    if (isAdmin) return true
    const employee = employeeById.get(String(record.employeeId || ''))
    const status = String(employee?.status || '').toLowerCase()
    return isBusinessSupport
      && String(employee?.unit || employee?.unitType || '') === 'store'
      && String(employee?.storeId || '') === String(record.storeId || '')
      && !employee?.deletedAt
      && !['inactive', 'đã nghỉ việc', 'đã xóa'].includes(status)
  }
  const rows = attendance.filter((item) => !item.deletedAt && (!query || [item.employeeId, employees.find((employee) => employee.id === item.employeeId)?.name, item.shiftName].some((value) => String(value || '').toLowerCase().includes(query.toLowerCase()))))
  const scopedEmployees = employees.filter((employee) => String(employee.unit || 'store') === 'store' && (!resetForm.storeId || String(employee.storeId) === String(resetForm.storeId)) && !employee.deletedAt)
  const recentAudit = [...new Map([...operationalResetHistory, ...attendanceAudit, ...auditLogs]
    .map((item, index) => [String(item.id || `${item.entityId || item.orderId || item.attendanceId || 'audit'}-${index}`), item])).values()]
    .sort((left, right) => String(right.createdAt || '').localeCompare(String(left.createdAt || '')))
    .slice(0, 20)
  const openEdit = (record) => {
    if (!canEditAttendanceRecord(record)) return notify('Hỗ trợ KD chỉ được chỉnh chấm công của nhân viên cửa hàng đang hoạt động.', 'info')
    setEditing(record)
    setForm({ checkIn: record.checkIn || '', checkOut: record.checkOut || '', reason: '' })
  }
  const save = async () => {
    if (!editing) return
    if (!form.reason.trim()) return notify('Vui lòng nhập lý do chỉnh sửa chấm công.', 'info')
    if (typeof updateAttendance !== 'function') return notify('Chức năng cập nhật chấm công chưa sẵn sàng.', 'info')
    const result = await updateAttendance(editing.id, { date: editing.date || editing.workDate, checkIn: form.checkIn, checkOut: form.checkOut, reason: form.reason.trim() })
    if (!result?.ok) return notify(result?.message || 'Không thể cập nhật chấm công.', 'info')
    setEditing(null)
  }
  const closeSystemReset = () => {
    if (systemResetBusy) return
    setSystemResetOpen(false)
    setSystemResetConfirmation('')
  }
  const executeSystemReset = async () => {
    if (!isAdmin || systemResetBusy) return
    if (systemResetConfirmation !== 'RESET_ALL_DATA') return notify('Vui lòng nhập đúng RESET_ALL_DATA để xác nhận.', 'info')
    if (typeof resetAllData !== 'function') return notify('Chức năng xóa toàn bộ dữ liệu chưa sẵn sàng.', 'info')
    setSystemResetBusy(true)
    try {
      const result = await resetAllData()
      if (!result?.ok) return notify(result?.message || 'Không thể xóa toàn bộ dữ liệu hệ thống.', 'info')
      setSystemResetOpen(false)
      setSystemResetConfirmation('')
    } finally {
      setSystemResetBusy(false)
    }
  }
  const restoreOperational = async () => {
    if (!isBusinessSupport) return
    if (!resetForm.storeId || !resetForm.fromDate || !resetForm.toDate) return notify('Vui lòng chọn cửa hàng và khoảng ngày cần khôi phục.', 'info')
    if (resetForm.fromDate > resetForm.toDate) return notify('Khoảng ngày khôi phục chưa hợp lệ.', 'info')
    if (!resetForm.reason.trim()) return notify('Vui lòng nhập lý do khôi phục dữ liệu.', 'info')
    if (typeof restoreOperationalData !== 'function') return notify('Chức năng khôi phục dữ liệu chưa sẵn sàng.', 'info')
    const dataLabel = resetForm.dataType === 'orders' ? 'đơn hàng' : 'chấm công'
    if (!window.confirm(`Khôi phục lần chỉnh sửa/xóa ${dataLabel} gần nhất trong phạm vi đã chọn?`)) return
    const result = await restoreOperationalData({
      dataType: resetForm.dataType,
      storeId: resetForm.storeId,
      fromDate: resetForm.fromDate,
      toDate: resetForm.toDate,
      ...(resetForm.dataType === 'attendance' && resetForm.employeeId ? { employeeId: resetForm.employeeId } : {}),
      reason: resetForm.reason.trim(),
    })
    if (!result?.ok) return notify(result?.message || 'Không thể khôi phục dữ liệu vận hành.', 'info')
    setResetForm((current) => ({ ...current, reason: '' }))
  }
  if (!canEditAttendance) {
    return <div className="page"><PageHeader title="KHÔNG CÓ QUYỀN TRUY CẬP" subtitle="Tài khoản này không được truy cập công cụ dữ liệu vận hành." icon={LockKeyhole} /></div>
  }
  return <div className="page governance-page"><PageHeader title="RESET DỮ LIỆU" subtitle="Quản lý dữ liệu hệ thống theo đúng phạm vi quyền; các thao tác vận hành đều có nhật ký." icon={RefreshCcw} />
    {isAdmin && <Card title="Xóa toàn bộ dữ liệu và tài khoản" className="system-reset-card">
      <InfoNote tone="orange"><strong>Thao tác không thể hoàn tác.</strong><br />Toàn bộ cửa hàng, hồ sơ nhân viên, đơn hàng, chấm công, dòng tiền, lịch sử vận hành và mọi tài khoản khác sẽ bị xóa. Chỉ tài khoản Admin đang thực hiện Reset và phiên hiện tại được giữ lại.</InfoNote>
      <div className="card-actions card-actions--below"><Button variant="danger" icon={Trash2} onClick={() => setSystemResetOpen(true)}>BẮT ĐẦU XÓA DỮ LIỆU</Button></div>
    </Card>}
    {isBusinessSupport && <Card title="Khôi phục chỉnh sửa/xóa" className="operational-reset-card">
      <InfoNote>Chức năng này chỉ khôi phục phiên bản trước của dữ liệu trong phạm vi đã chọn, không xóa trắng dữ liệu hoặc tài khoản.</InfoNote>
      <div className="form-grid form-grid--3">
        <Field label="Loại dữ liệu" required><Select value={resetForm.dataType} onChange={(event) => setResetForm((current) => ({ ...current, dataType: event.target.value, employeeId: '' }))}><option value="orders">Đơn hàng</option><option value="attendance">Chấm công</option></Select></Field>
        <Field label="Cửa hàng" required><Select value={resetForm.storeId} onChange={(event) => setResetForm((current) => ({ ...current, storeId: event.target.value, employeeId: '' }))}><option value="">Chọn cửa hàng</option>{stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}</Select></Field>
        {resetForm.dataType === 'attendance' && <Field label="Nhân viên (không bắt buộc)"><Select value={resetForm.employeeId} onChange={(event) => setResetForm((current) => ({ ...current, employeeId: event.target.value }))}><option value="">Tất cả nhân viên</option>{scopedEmployees.map((employee) => <option key={employee.id} value={employee.id}>{employee.name} — {employee.id}</option>)}</Select></Field>}
        <Field label="Từ ngày" required><Input type="date" value={resetForm.fromDate} onChange={(event) => setResetForm((current) => ({ ...current, fromDate: event.target.value }))} /></Field>
        <Field label="Đến ngày" required><Input type="date" value={resetForm.toDate} onChange={(event) => setResetForm((current) => ({ ...current, toDate: event.target.value }))} /></Field>
        <Field label="Lý do khôi phục" required className="span-2"><textarea maxLength={500} value={resetForm.reason} onChange={(event) => setResetForm((current) => ({ ...current, reason: event.target.value }))} placeholder="Nhập lý do để lưu nhật ký kiểm toán" /></Field>
      </div>
      <div className="card-actions card-actions--below"><Button variant="danger" icon={RefreshCcw} onClick={restoreOperational}>KHÔI PHỤC CHỈNH SỬA/XÓA</Button></div>
    </Card>}
    <Card title="Chấm công theo ca" action={<SearchInput value={query} onChange={setQuery} placeholder="Tìm nhân viên hoặc ca..." />}><TableWrap><thead><tr><th>Nhân viên</th><th>Cửa hàng</th><th>Ca</th><th>Ngày</th><th>Giờ vào / Kết</th><th>Số giờ</th><th>Trạng thái</th><th>Thao tác</th></tr></thead><tbody>{rows.map((record) => { const employee = employeeById.get(String(record.employeeId || '')); const editable = canEditAttendanceRecord(record); return <tr key={record.id}><td><strong>{employee?.name || record.employeeId}</strong><small className="table-note">{record.employeeId}</small></td><td>{stores.find((store) => store.id === record.storeId)?.name || record.storeId}</td><td>{record.shiftName || record.shift}<small className="table-note">{record.shiftStart}–{record.shiftEnd}</small></td><td>{shortDate(record.date || record.workDate)}</td><td>{record.checkIn || '—'} / {record.checkOut || '—'}</td><td>{Number(record.hours || 0).toFixed(2)}</td><td><Badge tone={record.status === 'Đi trễ' ? 'red' : record.status === 'Đi sớm' ? 'green' : 'blue'}>{record.status}</Badge></td><td>{editable ? <Button variant="outline" onClick={() => openEdit(record)}>Chỉnh sửa</Button> : <span className="table-note">Chỉ xem</span>}</td></tr> })}{!rows.length && <tr><td colSpan="8">Chưa có dữ liệu chấm công phù hợp.</td></tr>}</tbody></TableWrap></Card>
    <Card title="Nhật ký chỉnh sửa gần nhất"><TableWrap><thead><tr><th>Thời gian</th><th>Đối tượng</th><th>Hành động</th><th>Người thực hiện</th></tr></thead><tbody>{recentAudit.map((item, index) => { const isResetHistory = Boolean(item.dataType && item.restoredCount != null); const action = item.action || item.type || (isResetHistory ? 'Khôi phục' : '—'); const isRestore = String(action).toLowerCase().includes('restore') || String(action).toLowerCase().includes('khôi phục'); const entity = item.entity || item.type || (item.dataType === 'orders' ? 'đơn hàng' : item.dataType === 'attendance' ? 'chấm công' : 'dữ liệu'); return <tr key={item.id || `${item.entityId || item.orderId || item.attendanceId}-${index}`}><td>{displayDateTime(item.createdAt)}</td><td>{entity} — {item.entityId || item.orderId || item.attendanceId || item.id || '—'}</td><td>{isRestore ? <Badge tone="green">Khôi phục</Badge> : action}</td><td>{item.actor?.name || item.createdBy?.name || '—'}</td></tr> })}{!recentAudit.length && <tr><td colSpan="4">Chưa có nhật ký chỉnh sửa.</td></tr>}</tbody></TableWrap></Card>
    <Modal open={Boolean(editing)} onClose={() => setEditing(null)} title="Chỉnh sửa giờ chấm công" footer={<><Button variant="outline" onClick={() => setEditing(null)}>Hủy</Button><Button icon={Save} onClick={save}>LƯU</Button></>}><div className="form-grid"><Field label="Giờ vào" required hint="Định dạng 24 giờ"><Input type="time" value={form.checkIn} onChange={(event) => setForm({ ...form, checkIn: event.target.value })} /></Field><Field label="Giờ kết" hint="Định dạng 24 giờ"><Input type="time" value={form.checkOut} onChange={(event) => setForm({ ...form, checkOut: event.target.value })} /></Field><Field label="Lý do chỉnh sửa" required className="span-2"><textarea maxLength={500} value={form.reason} onChange={(event) => setForm({ ...form, reason: event.target.value })} placeholder="Nhập lý do để lưu nhật ký kiểm toán" /></Field></div></Modal>
    <Modal open={systemResetOpen} onClose={closeSystemReset} title="Xác nhận xóa toàn bộ dữ liệu" footer={<><Button variant="outline" onClick={closeSystemReset} disabled={systemResetBusy}>Hủy</Button><Button variant="danger" icon={Trash2} loading={systemResetBusy} disabled={systemResetBusy || systemResetConfirmation !== 'RESET_ALL_DATA'} onClick={executeSystemReset}>XÓA TOÀN BỘ DỮ LIỆU</Button></>}>
      <div className="form-stack">
        <InfoNote tone="orange">Sau khi xác nhận, chỉ tài khoản Admin đang thực hiện Reset cùng phiên hiện tại được giữ lại. Dữ liệu và mọi tài khoản khác đã xóa không thể phục hồi từ giao diện.</InfoNote>
        <Field label="Nhập RESET_ALL_DATA để xác nhận" required hint="Phân biệt chữ hoa, dấu gạch dưới và không có khoảng trắng."><Input autoComplete="off" spellCheck="false" value={systemResetConfirmation} onChange={(event) => setSystemResetConfirmation(event.target.value)} placeholder="RESET_ALL_DATA" /></Field>
      </div>
    </Modal>
  </div>
}

export function SupportTransfersPage() {
  const { stores = [], employees = [], supportTransfers = [], saveSupportTransfer, notify, session } = useApp()
  const canManageTransfers = ['business_support', 'manager'].includes(session?.role)
  const [form, setForm] = useState({ employeeId: '', fromStoreId: '', toStoreId: '', fromDate: today(), toDate: today(), hourlySupportRate: '', allowance: '', note: '' })
  const employee = useMemo(() => employees.find((item) => item.id === form.employeeId), [employees, form.employeeId])
  const availableEmployees = employees.filter((item) => String(item.unit || 'store') === 'store' && !item.deletedAt && (!form.fromStoreId || String(item.storeId) === String(form.fromStoreId)))
  const save = async () => {
    if (!canManageTransfers) return
    if (!form.fromStoreId || !form.employeeId || !form.toStoreId || form.toStoreId === form.fromStoreId || String(employee?.storeId) !== String(form.fromStoreId)) return notify('Vui lòng chọn cửa hàng đi, nhân viên và cửa hàng nhận hỗ trợ phù hợp.', 'info')
    if (!form.fromDate || !form.toDate || form.fromDate > form.toDate) return notify('Khoảng thời gian điều chuyển chưa hợp lệ.', 'info')
    const hourlySupportRate = parseMoneyInput(form.hourlySupportRate)
    const allowance = parseMoneyInput(form.allowance)
    if (hourlySupportRate <= 0) return notify('Lương hỗ trợ theo giờ phải lớn hơn 0.', 'info')
    if (typeof saveSupportTransfer !== 'function') return notify('Chức năng điều chuyển chưa sẵn sàng.', 'info')
    const result = await saveSupportTransfer({ employeeId: form.employeeId, fromStoreId: form.fromStoreId, toStoreId: form.toStoreId, fromDate: form.fromDate, toDate: form.toDate, hourlySupportRate, allowance, note: form.note })
    if (!result?.ok) return notify(result?.message || 'Không thể lưu điều chuyển hỗ trợ.', 'info')
    setForm({ employeeId: '', fromStoreId: '', toStoreId: '', fromDate: today(), toDate: today(), hourlySupportRate: '', allowance: '', note: '' })
  }
  if (!canManageTransfers) return <div className="page"><PageHeader title="KHÔNG CÓ QUYỀN TRUY CẬP" subtitle="Điều chuyển nhân sự thuộc quyền Nhân viên Hỗ trợ KD." icon={LockKeyhole} /></div>
  return <div className="page governance-page"><PageHeader title="ĐIỀU CHUYỂN NHÂN SỰ" subtitle="Phân bổ nhân viên hỗ trợ giữa các cửa hàng mà không thay đổi hồ sơ gốc." icon={CalendarClock} />
    <Card title="Tạo điều chuyển" className="support-transfer-card"><div className="form-grid form-grid--3">
      <Field label="Từ ngày" required><Input type="date" value={form.fromDate} onChange={(event) => setForm((current) => ({ ...current, fromDate: event.target.value }))} /></Field>
      <Field label="Đến ngày" required><Input type="date" value={form.toDate} onChange={(event) => setForm((current) => ({ ...current, toDate: event.target.value }))} /></Field>
      <Field label="Cửa hàng điều chuyển" required><Select value={form.fromStoreId} onChange={(event) => setForm((current) => ({ ...current, fromStoreId: event.target.value, employeeId: '', toStoreId: current.toStoreId === event.target.value ? '' : current.toStoreId }))}><option value="">Chọn cửa hàng đi</option>{stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}</Select></Field>
      <Field label="Nhân viên" required><Select value={form.employeeId} onChange={(event) => setForm((current) => ({ ...current, employeeId: event.target.value }))} disabled={!form.fromStoreId}><option value="">Chọn nhân viên</option>{availableEmployees.map((item) => <option key={item.id} value={item.id}>{item.name} — {item.id}</option>)}</Select></Field>
      <Field label="Cửa hàng nhận hỗ trợ" required><Select value={form.toStoreId} onChange={(event) => setForm((current) => ({ ...current, toStoreId: event.target.value }))}><option value="">Chọn cửa hàng nhận</option>{stores.filter((store) => String(store.id) !== String(form.fromStoreId)).map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}</Select></Field>
      <Field label="Lương hỗ trợ (theo giờ)" required><Input inputMode="numeric" value={form.hourlySupportRate} onChange={(event) => setForm((current) => ({ ...current, hourlySupportRate: formatMoneyInput(event.target.value) }))} placeholder="30,000" /></Field>
      <Field label="Phụ cấp"><Input inputMode="numeric" value={form.allowance} onChange={(event) => setForm((current) => ({ ...current, allowance: formatMoneyInput(event.target.value) }))} placeholder="200,000" /></Field>
      <Field label="Ghi chú" className="span-2"><textarea maxLength={500} value={form.note} onChange={(event) => setForm((current) => ({ ...current, note: event.target.value }))} placeholder="Nội dung hỗ trợ hoặc lưu ý cho cửa hàng nhận" /></Field>
    </div><div className="card-actions card-actions--below"><Button icon={Save} onClick={save}>LƯU ĐIỀU CHUYỂN</Button></div></Card>
    <Card title="Lịch sử điều chuyển"><TableWrap><thead><tr><th>Nhân viên</th><th>Từ cửa hàng</th><th>Đến cửa hàng</th><th>Thời gian</th><th>Lương hỗ trợ/giờ</th><th>Phụ cấp</th><th>Ghi chú</th><th>Trạng thái</th></tr></thead><tbody>{supportTransfers.map((item) => <tr key={item.id}><td><strong>{employees.find((employeeItem) => employeeItem.id === item.employeeId)?.name || item.employeeId}</strong><small className="table-note">{item.employeeId}</small></td><td>{stores.find((store) => store.id === item.fromStoreId)?.name || item.fromStoreId}</td><td>{stores.find((store) => store.id === item.toStoreId)?.name || item.toStoreId}</td><td>{shortDate(item.fromDate)} – {shortDate(item.toDate)}<small className="table-note">Tạo lúc {displayDateTime(item.createdAt)}</small></td><td>{money(item.hourlySupportRate)}</td><td>{money(item.allowance)}</td><td>{item.note || '—'}</td><td><Badge tone={item.status === 'Đã hủy' ? 'red' : 'green'}>{item.status || 'Đã lưu'}</Badge></td></tr>)}{!supportTransfers.length && <tr><td colSpan="8">Chưa có lịch sử điều chuyển.</td></tr>}</tbody></TableWrap></Card>
  </div>
}
