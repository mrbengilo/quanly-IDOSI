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
import { money, shortDate, today } from '../../utils'

const displayDateTime = (value) => {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? String(value || '—') : date.toLocaleString('vi-VN', { hour12: false })
}

const employeeTypeLabel = (employee = {}) => String(employee.employmentType || employee.employeeType || employee.type || 'Full-Time').toLowerCase().includes('part') ? 'Part-Time' : 'Full-Time'

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

  if (session?.role !== 'admin') {
    return <div className="page"><PageHeader title="KHÔNG CÓ QUYỀN TRUY CẬP" subtitle="Tài khoản Quản lý không được truy cập Cài đặt chính sách." icon={LockKeyhole} /></div>
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
  const canDeleteEmployee = session?.role === 'admin'

  const changeStatus = async (employee, nextStatus) => {
    const result = await updateEmployee(employee.id, { status: nextStatus })
    if (!result?.ok) notify(result?.message || 'Không thể cập nhật trạng thái.', 'info')
  }

  const resetPassword = async () => {
    if (newPassword.length < 8) return notify('Mật khẩu đặt lại phải có ít nhất 8 ký tự.', 'info')
    const result = await updateEmployee(resetTarget.id, { password: newPassword })
    if (!result?.ok) return notify(result?.message || 'Không thể đặt lại mật khẩu.', 'info')
    setResetTarget(null)
    setNewPassword('')
  }

  return (
    <div className="page">
      <PageHeader title="QUẢN LÝ NHÂN VIÊN" subtitle="Hồ sơ nhân sự của toàn bộ hệ thống; mật khẩu hiện tại không bao giờ được hiển thị." icon={Users} />
      <div className="metrics-grid metrics-grid--4">
        <MetricCard label="TỔNG NHÂN VIÊN" value={storeEmployees.length} icon={Users} tone="blue" />
        <MetricCard label="ĐANG LÀM VIỆC" value={storeEmployees.filter((item) => item.status === 'Đang làm việc').length} icon={ShieldCheck} tone="green" />
        <MetricCard label="TẠM NGƯNG" value={storeEmployees.filter((item) => item.status === 'Tạm ngưng').length} icon={LockKeyhole} tone="orange" />
        <MetricCard label="ĐÃ NGHỈ VIỆC" value={storeEmployees.filter((item) => item.status === 'Đã nghỉ việc').length} icon={UserCog} tone="red" />
      </div>
      <Card title="Danh sách nhân viên cửa hàng" action={<div className="toolbar-wrap"><SearchInput value={query} onChange={setQuery} placeholder="Tìm mã, tên, CCCD..." /><Select value={storeId} onChange={(event) => setStoreId(event.target.value)}><option value="all">Tất cả cửa hàng</option>{stores.map((store) => <option value={store.id} key={store.id}>{store.name}</option>)}</Select><Select value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">Tất cả trạng thái</option><option>Đang làm việc</option><option>Tạm ngưng</option>{session?.role === 'admin' && <option>Đã nghỉ việc</option>}</Select></div>}>
        <TableWrap><thead><tr><th>Mã</th><th>Họ và tên</th><th>Cửa hàng</th><th>Loại nhân viên</th><th>Liên hệ / CCCD</th><th>Lương cứng</th><th>Phụ cấp TikTok</th><th>Tài khoản</th><th>Trạng thái</th><th>Thao tác</th></tr></thead><tbody>{rows.map((employee) => <tr key={employee.id}><td><strong>{employee.id}</strong></td><td><strong>{employee.name}</strong><small className="table-note">{employee.position}</small></td><td>{stores.find((store) => store.id === employee.storeId)?.name || employee.storeId}</td><td><Badge tone={employeeTypeLabel(employee) === 'Part-Time' ? 'orange' : 'blue'}>{employeeTypeLabel(employee)}</Badge></td><td>{employee.phone}<small className="table-note">CCCD: {employee.cccd}</small></td><td>{money(employee.monthlySalary || employee.hourlyRate || employee.salary)}<small className="table-note">{employee.payBasis === 'hourly' ? 'Theo giờ' : 'Theo tháng'}</small></td><td>{money(employee.tiktokAllowance)}</td><td><strong>{employee.username}</strong><small className="table-note">Đăng nhập gần nhất: {displayDateTime(employee.lastLoginAt)}</small></td><td>{session?.role !== 'admin' && employee.status === 'Đã nghỉ việc' ? <Badge tone="red">Đã nghỉ việc</Badge> : <Select aria-label={`Trạng thái ${employee.name}`} value={employee.status} onChange={(event) => changeStatus(employee, event.target.value)}><option>Đang làm việc</option><option>Tạm ngưng</option>{session?.role === 'admin' && <option>Đã nghỉ việc</option>}</Select>}</td><td><div className="row-actions"><button type="button" onClick={() => setResetTarget(employee)} aria-label={`Đặt lại mật khẩu ${employee.name}`} title="Đặt lại mật khẩu"><KeyRound size={17} /></button>{canDeleteEmployee && <button type="button" className="danger" onClick={() => window.confirm(`Xóa ${employee.name} khỏi hệ thống? Lịch sử vẫn được giữ.`) && deleteEmployee(employee.id)} aria-label={`Xóa ${employee.name}`} title="Xóa nhân viên"><Trash2 size={17} /></button>}</div></td></tr>)}{!rows.length && <tr><td colSpan="10">Không có nhân viên phù hợp.</td></tr>}</tbody></TableWrap>
      </Card>
      <Modal open={Boolean(resetTarget)} onClose={() => setResetTarget(null)} title={`Đặt lại mật khẩu — ${resetTarget?.name || ''}`} footer={<><Button variant="outline" onClick={() => setResetTarget(null)}>Hủy</Button><Button icon={KeyRound} onClick={resetPassword}>ĐẶT LẠI</Button></>}><InfoNote>Admin chỉ đặt mật khẩu mới; hệ thống không thể đọc lại mật khẩu hiện tại.</InfoNote><Field label="Mật khẩu mới" required><Input type="password" autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} /></Field></Modal>
    </div>
  )
}

export function OrderAuditPage() {
  const { orderAudit = [], stores = [] } = useApp()
  const [query, setQuery] = useState('')
  const rows = orderAudit.filter((item) => !query || [item.orderCode, item.actor?.name, item.reason].some((value) => String(value || '').toLowerCase().includes(query.toLowerCase())))
  return <div className="page"><PageHeader title="LỊCH SỬ SỬA VÀ XÓA ĐƠN HÀNG" subtitle="Đối soát dữ liệu trước/sau của mọi thao tác ảnh hưởng doanh thu." icon={History} /><Card title="Nhật ký đơn hàng" action={<SearchInput value={query} onChange={setQuery} placeholder="Tìm mã đơn, người thao tác..." />}><TableWrap><thead><tr><th>Thời gian</th><th>Người thao tác</th><th>Cửa hàng</th><th>Mã đơn</th><th>Thao tác</th><th>Trường thay đổi</th><th>Doanh thu trước</th><th>Doanh thu sau</th><th>Lý do</th></tr></thead><tbody>{rows.map((item) => <tr key={item.id}><td>{displayDateTime(item.createdAt)}</td><td><strong>{item.actor?.name}</strong><small className="table-note">{item.actor?.role}</small></td><td>{stores.find((store) => store.id === item.storeId)?.name || item.storeId}</td><td><strong>{item.orderCode}</strong></td><td><Badge tone={item.action === 'Xóa' ? 'red' : 'orange'}>{item.action}</Badge></td><td>{item.changedFields?.join(', ') || '—'}</td><td>{money(item.revenueBefore)}</td><td>{money(item.revenueAfter)}</td><td>{item.reason || '—'}</td></tr>)}{!rows.length && <tr><td colSpan="9">Chưa có lịch sử sửa hoặc xóa đơn hàng.</td></tr>}</tbody></TableWrap></Card></div>
}

export function ResetDataPage() {
  const { attendance = [], employees = [], stores = [], updateAttendance, resetDemo, auditLogs = [], notify, session } = useApp()
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState({ checkIn: '', checkOut: '', reason: '' })
  const rows = attendance.filter((item) => !item.deletedAt && (!query || [item.employeeId, employees.find((employee) => employee.id === item.employeeId)?.name, item.shiftName].some((value) => String(value || '').toLowerCase().includes(query.toLowerCase()))))
  const openEdit = (record) => { setEditing(record); setForm({ checkIn: record.checkIn || '', checkOut: record.checkOut || '', reason: '' }) }
  const save = async () => {
    if (!editing) return
    if (!form.reason.trim()) return notify('Vui lòng nhập lý do chỉnh sửa chấm công.', 'info')
    if (typeof updateAttendance !== 'function') return notify('Chức năng cập nhật chấm công chưa sẵn sàng.', 'info')
    const result = await updateAttendance(editing.id, { date: editing.date || editing.workDate, checkIn: form.checkIn, checkOut: form.checkOut, reason: form.reason.trim() })
    if (!result?.ok) return notify(result?.message || 'Không thể cập nhật chấm công.', 'info')
    setEditing(null)
  }
  const restoreDemo = async () => {
    if (!window.confirm('Khôi phục toàn bộ dữ liệu mẫu?')) return
    if (typeof resetDemo !== 'function') return notify('Chức năng khôi phục dữ liệu chưa sẵn sàng.', 'info')
    const result = await resetDemo()
    if (!result?.ok) notify(result?.message || 'Không thể khôi phục dữ liệu mẫu.', 'info')
  }
  if (session?.role !== 'admin') {
    return <div className="page"><PageHeader title="KHÔNG CÓ QUYỀN TRUY CẬP" subtitle="Tài khoản Quản lý không được truy cập Reset dữ liệu hoặc chỉnh sửa chấm công." icon={LockKeyhole} /></div>
  }
  return <div className="page"><PageHeader title="RESET DỮ LIỆU" subtitle="Công cụ quản trị có kiểm toán; mọi chỉnh sửa chấm công đều lưu giá trị cũ và mới." icon={RefreshCcw} actions={<Button variant="danger" icon={RefreshCcw} onClick={restoreDemo}>KHÔI PHỤC DỮ LIỆU MẪU</Button>} /><Card title="Chấm công theo ca" action={<SearchInput value={query} onChange={setQuery} placeholder="Tìm nhân viên hoặc ca..." />}><TableWrap><thead><tr><th>Nhân viên</th><th>Cửa hàng</th><th>Ca</th><th>Ngày</th><th>Giờ vào / Kết</th><th>Số giờ</th><th>Trạng thái</th><th>Thao tác</th></tr></thead><tbody>{rows.map((record) => <tr key={record.id}><td><strong>{employees.find((employee) => employee.id === record.employeeId)?.name || record.employeeId}</strong><small className="table-note">{record.employeeId}</small></td><td>{stores.find((store) => store.id === record.storeId)?.name || record.storeId}</td><td>{record.shiftName || record.shift}<small className="table-note">{record.shiftStart}–{record.shiftEnd}</small></td><td>{shortDate(record.date || record.workDate)}</td><td>{record.checkIn || '—'} / {record.checkOut || '—'}</td><td>{Number(record.hours || 0).toFixed(2)}</td><td><Badge tone={record.status === 'Đi trễ' ? 'red' : record.status === 'Đi sớm' ? 'green' : 'blue'}>{record.status}</Badge></td><td><Button variant="outline" onClick={() => openEdit(record)}>Chỉnh sửa</Button></td></tr>)}</tbody></TableWrap></Card><Card title="Nhật ký chỉnh sửa gần nhất"><TableWrap><thead><tr><th>Thời gian</th><th>Đối tượng</th><th>Hành động</th><th>Người thực hiện</th></tr></thead><tbody>{auditLogs.slice(0, 20).map((item) => <tr key={item.id}><td>{displayDateTime(item.createdAt)}</td><td>{item.entity} — {item.entityId}</td><td>{item.action}</td><td>{item.actor?.name}</td></tr>)}</tbody></TableWrap></Card><Modal open={Boolean(editing)} onClose={() => setEditing(null)} title="Chỉnh sửa giờ chấm công" footer={<><Button variant="outline" onClick={() => setEditing(null)}>Hủy</Button><Button icon={Save} onClick={save}>LƯU</Button></>}><div className="form-grid"><Field label="Giờ vào" required><Input type="time" value={form.checkIn} onChange={(event) => setForm({ ...form, checkIn: event.target.value })} /></Field><Field label="Giờ kết"><Input type="time" value={form.checkOut} onChange={(event) => setForm({ ...form, checkOut: event.target.value })} /></Field><Field label="Lý do chỉnh sửa" required className="span-2"><textarea maxLength={500} value={form.reason} onChange={(event) => setForm({ ...form, reason: event.target.value })} placeholder="Nhập lý do để lưu nhật ký kiểm toán" /></Field></div></Modal></div>
}

export function SupportTransfersPage() {
  const { stores = [], employees = [], supportTransfers = [], saveSupportTransfer, notify } = useApp()
  const [form, setForm] = useState({ employeeId: '', fromStoreId: '', toStoreId: '', fromDate: today(), toDate: today(), note: '' })
  const employee = useMemo(() => employees.find((item) => item.id === form.employeeId), [employees, form.employeeId])
  const save = async () => {
    if (!form.employeeId || !form.toStoreId || form.toStoreId === employee?.storeId) return notify('Vui lòng chọn nhân viên và cửa hàng hỗ trợ khác cửa hàng hiện tại.', 'info')
    if (!form.fromDate || !form.toDate || form.fromDate > form.toDate) return notify('Khoảng thời gian điều chuyển chưa hợp lệ.', 'info')
    if (typeof saveSupportTransfer !== 'function') return notify('Chức năng điều chuyển chưa sẵn sàng.', 'info')
    const result = await saveSupportTransfer({ employeeId: form.employeeId, toStoreId: form.toStoreId, fromDate: form.fromDate, toDate: form.toDate, note: form.note })
    if (!result?.ok) return notify(result?.message || 'Không thể lưu điều chuyển hỗ trợ.', 'info')
    setForm({ employeeId: '', fromStoreId: '', toStoreId: '', fromDate: today(), toDate: today(), note: '' })
  }
  return <div className="page"><PageHeader title="ĐIỀU CHUYỂN NHÂN SỰ HỖ TRỢ" subtitle="Theo dõi nhân sự hỗ trợ giữa các cửa hàng mà không thay đổi hồ sơ gốc." icon={CalendarClock} /><Card title="Tạo điều chuyển"><div className="form-grid form-grid--3"><Field label="Nhân viên"><Select value={form.employeeId} onChange={(event) => setForm({ ...form, employeeId: event.target.value })}><option value="">Chọn nhân viên</option>{employees.filter((item) => item.unit === 'store').map((item) => <option key={item.id} value={item.id}>{item.name} — {item.id}</option>)}</Select></Field><Field label="Cửa hàng hiện tại"><Input value={stores.find((store) => store.id === employee?.storeId)?.name || ''} readOnly /></Field><Field label="Cửa hàng hỗ trợ"><Select value={form.toStoreId} onChange={(event) => setForm({ ...form, toStoreId: event.target.value })}><option value="">Chọn cửa hàng</option>{stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}</Select></Field><Field label="Từ ngày"><Input type="date" value={form.fromDate} onChange={(event) => setForm({ ...form, fromDate: event.target.value })} /></Field><Field label="Đến ngày"><Input type="date" value={form.toDate} onChange={(event) => setForm({ ...form, toDate: event.target.value })} /></Field><Field label="Ghi chú"><Input value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} /></Field></div><Button icon={Save} onClick={save}>LƯU ĐIỀU CHUYỂN</Button></Card><Card title="Lịch sử điều chuyển"><TableWrap><thead><tr><th>Nhân viên</th><th>Từ cửa hàng</th><th>Đến cửa hàng</th><th>Thời gian</th><th>Ghi chú</th><th>Trạng thái</th></tr></thead><tbody>{supportTransfers.map((item) => <tr key={item.id}><td>{employees.find((employeeItem) => employeeItem.id === item.employeeId)?.name}<small className="table-note">{item.employeeId}</small></td><td>{stores.find((store) => store.id === item.fromStoreId)?.name}</td><td>{stores.find((store) => store.id === item.toStoreId)?.name}</td><td>{shortDate(item.fromDate)} – {shortDate(item.toDate)}</td><td>{item.note || '—'}</td><td><Badge>{item.status}</Badge></td></tr>)}</tbody></TableWrap></Card></div>
}
