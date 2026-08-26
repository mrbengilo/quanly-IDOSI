import { useMemo, useState } from 'react'
import { Clock3, Save } from 'lucide-react'
import { Avatar, Badge, Button, Card, Field, InfoNote, Input, Modal, PageHeader, Select, TableWrap } from '../../components/UI'
import { useApp } from '../../state/AppContext'
import { shortDate } from '../../utils'

const employeeId = (employee = {}) => String(employee.id || employee.code || employee.employeeCode || '')
const employeeUnit = (employee = {}) => {
  const unit = String(employee.unit || employee.unitType || '').toLowerCase()
  if (unit === 'business_support') return 'business_support'
  if (unit === 'office' || String(employee.storeId || '').toUpperCase() === 'OFFICE') return 'office'
  return 'store'
}

const initialForm = { checkIn: '', checkOut: '', reason: '' }

export function AttendanceResetPage() {
  const { attendance = [], employees = [], stores = [], updateAttendance, notify, session } = useApp()
  const [scope, setScope] = useState({ unit: 'store', storeId: '', employeeId: '' })
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(initialForm)
  const isAdmin = session?.role === 'admin'
  const scopedEmployees = useMemo(() => employees.filter((employee) => (
    !employee.deletedAt
    && employeeUnit(employee) === scope.unit
    && (scope.unit !== 'store' || !scope.storeId || String(employee.storeId || '') === String(scope.storeId))
  )), [employees, scope.storeId, scope.unit])
  const selectedEmployee = scopedEmployees.find((employee) => employeeId(employee) === scope.employeeId)
  const rows = attendance.filter((record) => (
    !record.deletedAt && scope.employeeId && String(record.employeeId || '') === scope.employeeId
  )).sort((left, right) => String(right.checkInAt || right.date || '').localeCompare(String(left.checkInAt || left.date || '')))

  if (!isAdmin) return <div className="page"><PageHeader title="KHÔNG CÓ QUYỀN TRUY CẬP" subtitle="Chỉ Admin được chỉnh sửa dữ liệu chấm công." icon={Clock3} /></div>

  const openEdit = (record) => {
    setEditing(record)
    setForm({ checkIn: record.checkIn || String(record.checkInAt || '').slice(11, 16), checkOut: record.checkOut || String(record.checkOutAt || '').slice(11, 16), reason: '' })
  }
  const save = async () => {
    if (!editing || !form.reason.trim()) return notify?.('Vui lòng nhập lý do chỉnh sửa chấm công.', 'info')
    const result = await updateAttendance?.(editing.id, {
      date: editing.date || editing.workDate,
      checkIn: form.checkIn,
      checkOut: form.checkOut,
      reason: form.reason.trim(),
    })
    if (result?.ok) {
      setEditing(null)
      setForm(initialForm)
    }
  }

  return <div className="page governance-page">
    <PageHeader title="RESET DỮ LIỆU CHẤM CÔNG" subtitle="Chọn đơn vị, nhân viên và chỉnh giờ vào/giờ ra. Mọi thay đổi đều được lưu nhật ký." icon={Clock3} />
    <Card title="Chọn nhân viên">
      <InfoNote>Công cụ này chỉ chỉnh sửa chấm công; không xóa đơn hàng, tài khoản hoặc dữ liệu khác.</InfoNote>
      <div className="form-grid form-grid--3">
        <Field label="Nhóm nhân viên" required><Select value={scope.unit} onChange={(event) => setScope({ unit: event.target.value, storeId: '', employeeId: '' })}><option value="store">Cửa hàng</option><option value="office">Khối văn phòng</option><option value="business_support">Nhân viên hỗ trợ KD</option></Select></Field>
        {scope.unit === 'store' && <Field label="Cửa hàng" required><Select value={scope.storeId} onChange={(event) => setScope((current) => ({ ...current, storeId: event.target.value, employeeId: '' }))}><option value="">Chọn cửa hàng</option>{stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}</Select></Field>}
        <Field label="Nhân viên" required><Select value={scope.employeeId} disabled={scope.unit === 'store' && !scope.storeId} onChange={(event) => setScope((current) => ({ ...current, employeeId: event.target.value }))}><option value="">Chọn nhân viên</option>{scopedEmployees.map((employee) => <option key={employeeId(employee)} value={employeeId(employee)}>{employee.name} — {employeeId(employee)}</option>)}</Select></Field>
      </div>
    </Card>
    <Card title={selectedEmployee ? `Lịch sử chấm công · ${selectedEmployee.name}` : 'Lịch sử chấm công'}>
      <TableWrap><thead><tr><th>Nhân viên</th><th>Ngày</th><th>Ca</th><th>Giờ vào</th><th>Giờ ra</th><th>Trạng thái</th><th>Thao tác</th></tr></thead><tbody>
        {rows.map((record) => <tr key={record.id}><td><div className="person-cell"><Avatar name={selectedEmployee?.name || record.employeeId} src={selectedEmployee?.avatar} employeeId={record.employeeId} color={selectedEmployee?.color} /><span><strong>{selectedEmployee?.name || record.employeeId}</strong><small>{record.employeeId}</small></span></div></td><td>{shortDate(record.date || record.workDate)}</td><td><strong>{record.shiftName || record.shift || '—'}</strong><small className="table-sub">{record.shiftStart || '—'}–{record.shiftEnd || '—'}</small></td><td>{record.checkIn || String(record.checkInAt || '').slice(11, 16) || '—'}</td><td>{record.checkOut || String(record.checkOutAt || '').slice(11, 16) || '—'}</td><td><Badge tone={String(record.status || '').includes('trễ') ? 'red' : String(record.status || '').includes('sớm') ? 'green' : 'blue'}>{record.status || 'Đã ghi nhận'}</Badge></td><td><Button variant="outline" onClick={() => openEdit(record)}>Chỉnh sửa</Button></td></tr>)}
        {!rows.length && <tr><td colSpan="7">{scope.employeeId ? 'Nhân viên chưa có dữ liệu chấm công.' : 'Chọn nhân viên để xem dữ liệu.'}</td></tr>}
      </tbody></TableWrap>
    </Card>
    <Modal open={Boolean(editing)} onClose={() => setEditing(null)} title="Chỉnh sửa giờ chấm công" footer={<><Button variant="outline" onClick={() => setEditing(null)}>Hủy</Button><Button icon={Save} onClick={save}>LƯU</Button></>}>
      <div className="form-grid"><Field label="Giờ vào" required><Input type="time" value={form.checkIn} onChange={(event) => setForm((current) => ({ ...current, checkIn: event.target.value }))} /></Field><Field label="Giờ ra"><Input type="time" value={form.checkOut} onChange={(event) => setForm((current) => ({ ...current, checkOut: event.target.value }))} /></Field><Field label="Lý do chỉnh sửa" required className="span-2"><textarea maxLength={500} value={form.reason} onChange={(event) => setForm((current) => ({ ...current, reason: event.target.value }))} placeholder="Nhập lý do để lưu nhật ký" /></Field></div>
    </Modal>
  </div>
}
