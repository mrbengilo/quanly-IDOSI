import { useEffect, useMemo, useState } from 'react'
import {
  Banknote,
  CalendarDays,
  CheckCircle2,
  ClipboardCheck,
  Clock3,
  Fingerprint,
  LogOut,
  MapPin,
  Plus,
  ShoppingCart,
  Wallet,
} from 'lucide-react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  InfoNote,
  Input,
  MetricCard,
  Modal,
  PageHeader,
  Select,
  TableFooter,
  TableWrap,
} from '../../components/UI'
import { resolveShiftCandidates } from '../../domain'
import { useApp } from '../../state/AppContext'
import { businessDate, getHourlyRate, getMonthlySalary, getPayBasis, money, shortDate, today } from '../../utils'
import { employeeTasksForDate, taskCompletedByEmployee } from './taskScope'

const parseMoney = (value) => Math.max(0, Math.trunc(Number(String(value ?? '').replace(/[^\d-]/gu, '')) || 0))
const moneyInput = (value) => String(value ?? '').replace(/\D/gu, '').replace(/\B(?=(\d{3})+(?!\d))/gu, ',')
const recordDate = (record = {}) => String(record.date || record.workDate || record.createdAt || '').slice(0, 10)
const employeeKey = (employee = {}) => String(employee?.id || employee?.code || employee?.employeeCode || '')
const timestamp = (value) => value ? new Date(value).toLocaleString('vi-VN', { hour12: false }) : '—'
const periodLabel = (value) => value ? value.split('-').reverse().join('/') : '—'

const statusLabel = (value) => {
  const normalized = String(value || '').toLocaleLowerCase('vi-VN')
  if (normalized.includes('trễ')) return 'Đi trễ'
  if (normalized.includes('sớm')) return 'Đi sớm'
  if (normalized.includes('đúng')) return 'Đi đúng giờ'
  return value || 'Chưa xác định'
}

const statusTone = (value) => {
  const label = statusLabel(value)
  if (label === 'Đi trễ') return 'red'
  if (label === 'Đi sớm') return 'green'
  if (label === 'Đi đúng giờ') return 'blue'
  return 'orange'
}

const workedHours = (record = {}) => {
  const explicit = Number(record.hours)
  if (Number.isFinite(explicit) && explicit >= 0) return explicit
  return 0
}

const employeeAttendance = (attendance, employeeId) => attendance
  .filter((record) => !record.deletedAt && String(record.employeeId) === String(employeeId))
  .sort((left, right) => String(right.checkInAt || right.date || '').localeCompare(String(left.checkInAt || left.date || '')))

const findScheduledShifts = (app, employee, workDate) => {
  const assignment = (app.schedule || []).find((record) => (
    String(record.employeeId) === employeeKey(employee)
    && (!record.date || record.date === workDate)
  ))
  const ids = assignment?.shiftIds || []
  const snapshots = Array.isArray(assignment?.shiftSnapshots) ? assignment.shiftSnapshots : []
  const definitions = Array.isArray(app.shiftDefinitions) ? app.shiftDefinitions : []
  const selected = ids.map((id) => (
    snapshots.find((shift) => String(shift.id) === String(id))
    || definitions.find((shift) => String(shift.id) === String(id) && shift.active !== false)
  )).filter(Boolean)
  const fallback = definitions.filter((shift) => (
    shift.active !== false
    && (!shift.storeId || String(shift.storeId) === String(employee.storeId))
    && (!shift.date || shift.date === workDate)
  ))
  return (selected.length ? selected : fallback).map((shift) => ({ ...shift, date: workDate }))
}

const geolocate = () => new Promise((resolve, reject) => {
  if (!navigator.geolocation) {
    reject(new Error('Thiết bị hoặc trình duyệt chưa hỗ trợ định vị.'))
    return
  }
  navigator.geolocation.getCurrentPosition(
    (position) => resolve({
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      accuracy: position.coords.accuracy,
      capturedAt: new Date().toISOString(),
    }),
    (error) => reject(new Error(error.code === 1
      ? 'Bạn cần cấp quyền vị trí để chấm công.'
      : 'Không thể xác định vị trí hiện tại. Vui lòng thử lại.')),
    { enableHighAccuracy: true, timeout: 12_000, maximumAge: 0 },
  )
})

export function EmployeeDashboardV2() {
  const app = useApp()
  const navigate = useNavigate()
  const {
    currentEmployee: employee,
    attendance = [],
    orders = [],
    schedule = [],
    tasks = [],
    setTaskDone,
    notify,
  } = app
  const [pendingTaskId, setPendingTaskId] = useState(null)
  const employeeId = employeeKey(employee)
  const workDate = today()
  const ownAttendance = employeeAttendance(attendance, employeeId)
  const activeRecord = ownAttendance.find((record) => !record.checkOutAt && !record.checkOut)
  const todayRecords = ownAttendance.filter((record) => recordDate(record) === workDate)
  const monthOrders = orders.filter((order) => String(order.employeeId) === employeeId && !order.deletedAt && businessDate(order.createdAt).startsWith(workDate.slice(0, 7)))
  const todayTasks = employeeTasksForDate({ tasks, schedule, attendance, employee, workDate })
  const completedTasks = todayTasks.filter((task) => taskCompletedByEmployee(task, employeeId)).length
  const shifts = findScheduledShifts(app, employee || {}, workDate)

  const toggleTask = async (task) => {
    if (typeof setTaskDone !== 'function') {
      notify?.('Chức năng cập nhật công việc chưa sẵn sàng.', 'info')
      return
    }
    const done = taskCompletedByEmployee(task, employeeId)
    setPendingTaskId(task.id)
    try {
      const result = await setTaskDone(task.id, !done, employeeId)
      if (!result?.ok) notify?.(result?.message || 'Không thể cập nhật công việc.', 'info')
    } catch (error) {
      notify?.(error.message || 'Không thể cập nhật công việc.', 'info')
    } finally {
      setPendingTaskId(null)
    }
  }

  return (
    <div className="page">
      <PageHeader title={`XIN CHÀO, ${employee?.name || 'NHÂN VIÊN'}`} subtitle="Theo dõi ca làm, đơn hàng và công việc của bạn. Doanh thu được tự động lấy từ đơn hàng đã tạo." icon={Fingerprint} />
      <div className="metrics-grid metrics-grid--4">
        <MetricCard label="TRẠNG THÁI CA" value={activeRecord ? 'Đang làm' : todayRecords.some((record) => record.checkOutAt || record.checkOut) ? 'Đã kết ca' : 'Chưa điểm danh'} icon={Clock3} tone={activeRecord ? 'green' : 'blue'} />
        <MetricCard label="CA ĐƯỢC PHÂN HÔM NAY" value={shifts.length} suffix="ca" icon={CalendarDays} tone="blue" />
        <MetricCard label="ĐƠN TRONG THÁNG" value={monthOrders.length} suffix="đơn" icon={ShoppingCart} tone="green" />
        <MetricCard label="CÔNG VIỆC HÔM NAY" value={`${completedTasks}/${todayTasks.length}`} icon={ClipboardCheck} tone={completedTasks === todayTasks.length && todayTasks.length ? 'green' : 'orange'} />
      </div>
      <div className="two-column-layout">
        <Card title="Ca làm hôm nay">
          <div className="summary-list">
            {shifts.map((shift) => <p key={shift.id}><span>{shift.name || shift.id}</span><strong>{shift.start || '--:--'}–{shift.end || '--:--'}</strong></p>)}
            {!shifts.length && <p><span>Chưa có lịch phân ca</span><strong>—</strong></p>}
            {activeRecord && <p className="total"><span>Đã điểm danh</span><strong>{timestamp(activeRecord.checkInAt || activeRecord.checkIn)}</strong></p>}
          </div>
          <div className="card-actions"><Button icon={Fingerprint} onClick={() => navigate('/employee/attendance')}>MỞ CHẤM CÔNG</Button></div>
        </Card>
        <Card title="Truy cập nhanh">
          <div className="quick-action-grid">
            <Button icon={Plus} onClick={() => navigate('/employee/orders')}>Tạo đơn hàng</Button>
            <Button icon={Clock3} variant="outline" onClick={() => navigate('/employee/work-history')}>Lịch sử làm việc</Button>
            <Button icon={Wallet} variant="outline" onClick={() => navigate('/employee/payroll')}>Bảng lương</Button>
            <Button icon={Banknote} variant="outline" onClick={() => navigate('/employee/cashflow')}>Dòng tiền cá nhân</Button>
          </div>
        </Card>
      </div>
      <Card title="Công việc hôm nay">
        <div className="task-checklist">
          {todayTasks.map((task) => {
            const done = taskCompletedByEmployee(task, employeeId)
            const pending = String(pendingTaskId) === String(task.id)
            return (
              <div key={task.id} className={done ? 'done' : ''}>
                <button
                  type="button"
                  className="icon-button"
                  onClick={() => toggleTask(task)}
                  disabled={pending}
                  aria-label={done ? `Mở lại công việc ${task.title}` : `Hoàn thành công việc ${task.title}`}
                  aria-pressed={done}
                >
                  <CheckCircle2 size={18} />
                </button>
                <div><strong>{task.title}</strong><small>{task.detail}</small></div>
                <Badge tone={done ? 'green' : 'orange'}>{pending ? 'Đang cập nhật...' : done ? 'Đã hoàn thành' : 'Chưa hoàn thành'}</Badge>
              </div>
            )
          })}
          {!todayTasks.length && <InfoNote>Chưa có công việc đúng ca làm hôm nay.</InfoNote>}
        </div>
      </Card>
    </div>
  )
}

export function EmployeeOrdersPage() {
  const app = useApp()
  const [searchParams] = useSearchParams()
  const { currentEmployee: employee, orders = [], attendance = [], createOrder, notify } = app
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({ customerName: '', customerPhone: '', customerAge: '', amount: '', paymentMethod: 'Chuyển khoản' })
  const employeeId = employeeKey(employee)
  const rows = orders
    .filter((order) => !order.deletedAt && String(order.employeeId) === employeeId && order.source !== 'legacy-opening-balance')
    .sort((left, right) => String(right.createdAt || '').localeCompare(String(left.createdAt || '')))
  const total = rows.reduce((sum, order) => sum + Number(order.amount || 0), 0)
  const requestedOrderId = String(searchParams.get('order') || '')
  const requestedOrder = rows.find((order) => [order.id, order.code].map(String).includes(requestedOrderId))
  const requestedOrderKey = String(requestedOrder?.id || '')
  const openAttendance = attendance.find((record) => String(record.employeeId) === employeeId && !record.deletedAt && !record.checkOutAt && !record.checkOut)

  useEffect(() => {
    if (!requestedOrderKey) return undefined
    const scrollTimer = window.setTimeout(() => {
      document.getElementById(`order-${requestedOrderKey}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 0)
    return () => window.clearTimeout(scrollTimer)
  }, [requestedOrderKey])

  const save = async () => {
    if (!form.customerName.trim() || parseMoney(form.amount) <= 0) {
      notify('Vui lòng nhập tên khách hàng và số tiền hợp lệ.', 'info')
      return
    }
    setSaving(true)
    try {
      const result = await createOrder({
        ...form,
        amount: parseMoney(form.amount),
        employeeId,
        storeId: employee?.storeId,
        shiftId: openAttendance?.shift,
        shiftName: openAttendance?.shiftName,
        idempotencyKey: `order:${employeeId}:${Date.now()}`,
      })
      if (!result?.ok) {
        notify(result?.message || 'Không thể tạo đơn hàng.', 'info')
        return
      }
      setForm({ customerName: '', customerPhone: '', customerAge: '', amount: '', paymentMethod: 'Chuyển khoản' })
      setOpen(false)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="page">
      <PageHeader
        title="ĐƠN HÀNG CỦA TÔI"
        subtitle="Nhân viên chỉ được tạo và xem đơn do chính mình lập. Mã đơn được cấp tự động."
        icon={ShoppingCart}
        actions={<Button icon={Plus} onClick={() => setOpen(true)}>TẠO ĐƠN HÀNG</Button>}
      />
      <div className="metric-grid metric-grid--four">
        <MetricCard label="TỔNG ĐƠN" value={rows.length} helper="Đơn chưa bị xóa" icon={ShoppingCart} tone="blue" />
        <MetricCard label="TỔNG DOANH THU" value={money(total)} helper="Từ đơn hàng thực tế" icon={Banknote} tone="green" />
        <MetricCard label="CA HIỆN TẠI" value={openAttendance?.shiftName || 'Chưa vào ca'} helper={openAttendance ? `${openAttendance.shiftStart || '—'} – ${openAttendance.shiftEnd || '—'}` : 'Điểm danh trước khi tạo đơn để gắn đúng ca'} icon={Clock3} tone="orange" />
      </div>
      <Card title="Lịch sử đơn hàng">
        {rows.length ? (
          <>
            <TableWrap>
              <thead><tr><th>Mã đơn</th><th>Thời gian</th><th>Khách hàng</th><th>Điện thoại</th><th>Tuổi</th><th>Ca làm việc</th><th>Thanh toán</th><th>Số tiền</th></tr></thead>
              <tbody>{rows.map((order) => <tr id={`order-${order.id}`} className={String(order.id) === requestedOrderKey ? 'order-row--highlight' : ''} key={order.id}><td><strong>{order.code}</strong></td><td>{timestamp(order.createdAt)}</td><td>{order.customerName || 'Khách lẻ'}</td><td>{order.customerPhone || '—'}</td><td>{order.customerAge ?? '—'}</td><td>{order.shiftName || 'Chưa gắn ca'}</td><td><Badge tone={order.paymentMethod === 'Tiền mặt' ? 'orange' : 'blue'}>{order.paymentMethod}</Badge></td><td><strong>{money(order.amount)}</strong></td></tr>)}</tbody>
            </TableWrap>
            <TableFooter shown={rows.length} total={rows.length} />
          </>
        ) : <EmptyState title="Chưa có đơn hàng" description="Nhấn Tạo đơn hàng để ghi nhận đơn đầu tiên." />}
      </Card>
      <Modal open={open} onClose={() => setOpen(false)} title="Tạo đơn hàng" footer={<><Button variant="outline" onClick={() => setOpen(false)}>Hủy</Button><Button icon={ShoppingCart} loading={saving} onClick={save}>LƯU ĐƠN</Button></>}>
        <div className="form-grid">
          <Field label="Tên khách hàng" required><Input value={form.customerName} onChange={(event) => setForm({ ...form, customerName: event.target.value })} /></Field>
          <Field label="Số điện thoại"><Input inputMode="tel" value={form.customerPhone} onChange={(event) => setForm({ ...form, customerPhone: event.target.value })} /></Field>
          <Field label="Tuổi"><Input type="number" min="0" max="120" value={form.customerAge} onChange={(event) => setForm({ ...form, customerAge: event.target.value })} /></Field>
          <Field label="Số tiền" required><Input inputMode="numeric" value={form.amount} onChange={(event) => setForm({ ...form, amount: moneyInput(event.target.value) })} /></Field>
          <Field label="Hình thức thanh toán"><Select value={form.paymentMethod} onChange={(event) => setForm({ ...form, paymentMethod: event.target.value })}><option>Chuyển khoản</option><option>Tiền mặt</option></Select></Field>
          <InfoNote>{openAttendance ? `Đơn sẽ tự gắn với ${openAttendance.shiftName || openAttendance.shift}.` : 'Bạn chưa có ca đang mở; đơn vẫn được lưu và hiển thị là chưa gắn ca.'}</InfoNote>
        </div>
      </Modal>
    </div>
  )
}

export function EmployeeAttendancePage() {
  const app = useApp()
  const { currentEmployee: employee, attendance = [], policies, checkIn, checkOut, notify } = app
  const employeeId = employeeKey(employee)
  const rows = employeeAttendance(attendance, employeeId)
  const openRecord = rows.find((record) => !record.checkOut && !record.checkOutAt)
  const [candidateModal, setCandidateModal] = useState(null)
  const [locating, setLocating] = useState('')
  const workDate = today()
  const scheduledShifts = useMemo(() => findScheduledShifts(app, employee || {}, workDate), [app, employee, workDate])

  const captureAndCheckIn = async (shift) => {
    setLocating('in')
    try {
      const location = await geolocate()
      const result = await checkIn({
        employeeId,
        date: workDate,
        shiftId: shift.id,
        shiftName: shift.name,
        shiftStart: shift.start,
        shiftEnd: shift.end,
        location,
      })
      if (!result?.ok) notify(result?.message || 'Không thể điểm danh.', 'info')
      setCandidateModal(null)
    } catch (error) {
      notify(error.message, 'info')
    } finally {
      setLocating('')
    }
  }

  const beginCheckIn = () => {
    if (!scheduledShifts.length) {
      notify('Bạn chưa được xếp ca cho ngày hôm nay.', 'info')
      return
    }
    let result
    try {
      result = resolveShiftCandidates({
        at: new Date(),
        shifts: scheduledShifts,
        workDate,
        earlyWindowMinutes: Number(policies?.earlyCheckInLimitMinutes || 120),
      })
    } catch {
      notify('Không thể xác định ca phù hợp từ lịch làm việc.', 'info')
      return
    }
    if (!result.candidates.length) {
      notify(`Chưa đến thời gian điểm danh. Chỉ được vào sớm tối đa ${policies?.earlyCheckInLimitMinutes || 120} phút.`, 'info')
      return
    }
    setCandidateModal(result)
  }

  const handleCheckOut = async () => {
    setLocating('out')
    try {
      const location = await geolocate()
      const result = await checkOut({ employeeId, location })
      if (!result?.ok) notify(result?.message || 'Không thể ghi nhận ra về.', 'info')
    } catch (error) {
      notify(error.message, 'info')
    } finally {
      setLocating('')
    }
  }

  const stats = rows.reduce((value, record) => {
    const label = statusLabel(record.arrivalTag || record.status)
    value.total += 1
    value.hours += workedHours(record)
    value.lateMinutes += Number(record.minutesLate || 0)
    if (label === 'Đi sớm') value.early += 1
    if (label === 'Đi đúng giờ') value.onTime += 1
    if (label === 'Đi trễ') value.late += 1
    return value
  }, { total: 0, early: 0, onTime: 0, late: 0, lateMinutes: 0, hours: 0 })

  return (
    <div className="page">
      <PageHeader title="CHẤM CÔNG" subtitle="Chọn đúng ca, xác nhận vị trí khi vào và ra. Hệ thống không tự động chấm công." icon={Fingerprint} />
      <div className="attendance-actions-grid">
        <Card className="attendance-action-card" title="Vào ca">
          <Clock3 size={32} />
          <strong>{openRecord?.checkIn || '--:--'}</strong>
          <span>{openRecord ? `${openRecord.shiftName} • ${openRecord.shiftStart}–${openRecord.shiftEnd}` : `${scheduledShifts.length} ca được xếp hôm nay`}</span>
          <Button icon={Fingerprint} onClick={beginCheckIn} loading={locating === 'in'} disabled={Boolean(openRecord) || Boolean(locating)}>ĐIỂM DANH</Button>
        </Card>
        <Card className="attendance-action-card" title="Ra về">
          <MapPin size={32} />
          <strong>{openRecord ? 'Đang làm việc' : 'Chưa có ca mở'}</strong>
          <span>Chỉ ghi nhận khi bạn chủ động bấm nút</span>
          <Button variant="danger" icon={LogOut} onClick={handleCheckOut} loading={locating === 'out'} disabled={!openRecord || Boolean(locating)}>GHI NHẬN RA VỀ</Button>
        </Card>
      </div>
      <div className="metric-grid metric-grid--four">
        <MetricCard label="TỔNG CA" value={stats.total} icon={Clock3} tone="blue" />
        <MetricCard label="ĐI SỚM" value={stats.early} icon={CheckCircle2} tone="green" />
        <MetricCard label="ĐI ĐÚNG GIỜ" value={stats.onTime} icon={CheckCircle2} tone="blue" />
        <MetricCard label="ĐI TRỄ" value={stats.late} helper={`${stats.lateMinutes} phút trễ`} icon={Clock3} tone="red" />
      </div>
      <Card title="Lịch sử chấm công chi tiết">
        <TableWrap>
          <thead><tr><th>Ngày</th><th>Ca làm việc</th><th>Giờ vào</th><th>Vị trí vào</th><th>Giờ ra</th><th>Vị trí ra</th><th>Số giờ</th><th>Trạng thái</th><th>Phút trễ</th></tr></thead>
          <tbody>{rows.map((record) => <tr key={record.id}><td><strong>{shortDate(recordDate(record))}</strong></td><td>{record.shiftName || record.shift}<small className="table-note">{record.shiftStart}–{record.shiftEnd}</small></td><td>{record.checkIn || '—'}</td><td>{record.checkInLocation?.label || record.location?.label || 'Đã ghi tọa độ'}</td><td>{record.checkOut || 'Đang làm'}</td><td>{record.checkOutLocation?.label || (record.checkOut ? 'Đã ghi tọa độ' : '—')}</td><td>{workedHours(record).toFixed(2)}</td><td><Badge tone={statusTone(record.arrivalTag || record.status)}>{statusLabel(record.arrivalTag || record.status)}</Badge></td><td>{Number(record.minutesLate || 0)}</td></tr>)}{!rows.length && <tr><td colSpan="9">Chưa có lịch sử chấm công.</td></tr>}</tbody>
        </TableWrap>
        <TableFooter shown={rows.length} total={rows.length} />
      </Card>
      <Modal open={Boolean(candidateModal)} onClose={() => setCandidateModal(null)} title="Chọn ca để điểm danh">
        <div className="shift-choice-list">
          {candidateModal?.candidates.map((shift) => (
            <button type="button" key={shift.id} onClick={() => captureAndCheckIn(shift)} disabled={Boolean(locating)}>
              <Clock3 />
              <span><strong>{shift.name || shift.id}</strong><small>{shift.start} – {shift.end}</small></span>
              <Badge tone={shift.isCurrent ? 'blue' : 'green'}>{shift.isCurrent ? 'Ca hiện tại' : `Vào sớm ${shift.minutesUntilStart} phút`}</Badge>
            </button>
          ))}
        </div>
        {candidateModal?.requiresEarlyConfirmation && <InfoNote tone="orange">Bạn đang điểm danh sớm. Hãy xác nhận đúng ca trước khi tiếp tục.</InfoNote>}
      </Modal>
    </div>
  )
}

export function EmployeePayrollDetails() {
  const app = useApp()
  const { currentEmployee: employee, attendance = [], salaryAdjustments = [], salaryAdvances = [], payrollPeriods = [] } = app
  const employeeId = employeeKey(employee)
  const periods = [...new Set([
    ...attendance.filter((record) => String(record.employeeId) === employeeId).map((record) => recordDate(record).slice(0, 7)),
    ...payrollPeriods.filter((item) => item.rows?.some((row) => String(row.employeeId) === employeeId)).map((item) => item.period),
  ].filter(Boolean))].sort().reverse()
  const [period, setPeriod] = useState(() => periods[0] || today().slice(0, 7))
  const rows = employeeAttendance(attendance, employeeId).filter((record) => recordDate(record).startsWith(period))
  const snapshot = payrollPeriods.find((item) => item.period === period && item.rows?.some((row) => String(row.employeeId) === employeeId))
  const snapshotRow = snapshot?.rows.find((row) => String(row.employeeId) === employeeId)
  const hours = rows.reduce((sum, record) => sum + workedHours(record), 0)
  const basis = getPayBasis(employee || {})
  const base = basis === 'hourly' ? Math.floor(hours * getHourlyRate(employee || {})) : getMonthlySalary(employee || {})
  const adjustments = salaryAdjustments.filter((item) => String(item.employeeId) === employeeId && item.period === period && item.status !== 'Đã hủy')
  const bonus = adjustments.filter((item) => item.type === 'Thưởng khác').reduce((sum, item) => sum + Number(item.amount || 0), 0)
  const allowance = adjustments.filter((item) => item.type === 'Phụ cấp khác').reduce((sum, item) => sum + Number(item.amount || 0), 0)
  const deductions = adjustments.filter((item) => item.type === 'Khấu trừ').reduce((sum, item) => sum + Number(item.amount || 0), 0)
  const tiktok = Number(employee?.tiktokAllowance || 0)
  const kpi = Number(snapshotRow?.kpiBonus || 0)
  const gross = snapshotRow?.gross ?? Math.max(0, base + bonus + allowance + tiktok + kpi - deductions)
  const advances = salaryAdvances.filter((item) => String(item.employeeId) === employeeId && item.period === period && item.status === 'Đã chi').reduce((sum, item) => sum + Number(item.amount || 0), 0)
  const net = snapshotRow?.remaining ?? Math.max(0, gross - advances)
  const stats = rows.reduce((value, record) => {
    const label = statusLabel(record.arrivalTag || record.status)
    if (label === 'Đi sớm') value.early += 1
    if (label === 'Đi đúng giờ') value.onTime += 1
    if (label === 'Đi trễ') value.late += 1
    value.lateMinutes += Number(record.minutesLate || 0)
    return value
  }, { early: 0, onTime: 0, late: 0, lateMinutes: 0 })
  const onTimeRate = rows.length ? (stats.onTime / rows.length) * 100 : 0
  const evaluation = stats.late === 0 ? 'Chuyên cần tốt' : stats.late >= 3 || stats.lateMinutes >= 30 ? 'Cần cải thiện' : 'Cần duy trì'

  return (
    <div className="page">
      <PageHeader title="BẢNG LƯƠNG CỦA TÔI" subtitle="Dữ liệu cá nhân theo kỳ; các kỳ đã khóa dùng đúng bản chụp lương, KPI và chính sách." icon={Wallet} actions={<Select value={period} onChange={(event) => setPeriod(event.target.value)}><option value={period}>{periodLabel(period)}</option>{periods.filter((item) => item !== period).map((item) => <option key={item} value={item}>{periodLabel(item)}</option>)}</Select>} />
      <div className="metric-grid metric-grid--four">
        <MetricCard label="LƯƠNG CỨNG" value={money(base)} helper={basis === 'hourly' ? `${hours.toFixed(2)} giờ × ${money(getHourlyRate(employee || {}))}` : 'Theo mức lương tháng'} icon={Banknote} tone="blue" />
        <MetricCard label="THƯỞNG KPI" value={money(kpi)} helper={snapshot ? 'Theo snapshot kỳ lương' : 'Chỉ có sau khi chốt kỳ'} icon={CheckCircle2} tone="green" />
        <MetricCard label="ĐÃ ỨNG" value={money(advances)} icon={Wallet} tone="orange" />
        <MetricCard label="THỰC NHẬN" value={money(net)} helper={snapshot?.status || 'Tạm tính'} icon={Banknote} tone="green" />
      </div>
      <Card title="Chi tiết thu nhập">
        <div className="payroll-breakdown">
          <p><span>Lương cứng</span><strong>{money(base)}</strong></p>
          <p><span>Thưởng KPI</span><strong>{money(kpi)}</strong></p>
          <p><span>Thưởng khác</span><strong>{money(bonus)}</strong></p>
          <p><span>Phụ cấp TikTok (một lần trong tháng)</span><strong>{money(tiktok)}</strong></p>
          <p><span>Phụ cấp khác</span><strong>{money(allowance)}</strong></p>
          <p><span>Khấu trừ</span><strong>- {money(deductions)}</strong></p>
          <p><span>Đã ứng</span><strong>- {money(advances)}</strong></p>
          <p className="total"><span>Thực nhận</span><strong>{money(net)}</strong></p>
        </div>
      </Card>
      <Card title="Thống kê chuyên cần">
        <TableWrap><thead><tr><th>Đi sớm</th><th>Đi đúng giờ</th><th>Đi trễ</th><th>Tổng phút trễ</th><th>Tổng ca</th><th>Tỷ lệ đúng giờ</th><th>Đánh giá</th></tr></thead><tbody><tr><td className="green-text"><strong>{stats.early}</strong></td><td className="blue-text"><strong>{stats.onTime}</strong></td><td className="red-text"><strong>{stats.late}</strong></td><td>{stats.lateMinutes}</td><td>{rows.length}</td><td>{onTimeRate.toFixed(1)}%</td><td><Badge tone={evaluation === 'Chuyên cần tốt' ? 'green' : evaluation === 'Cần cải thiện' ? 'red' : 'orange'}>{evaluation}</Badge></td></tr></tbody></TableWrap>
      </Card>
      {snapshot && <InfoNote tone={snapshot.status === 'Đã khóa' ? 'orange' : 'green'}>Kỳ {periodLabel(period)} đã lưu snapshot lúc {timestamp(snapshot.closedAt)}. Trạng thái: <strong>{snapshot.status}</strong>.</InfoNote>}
    </div>
  )
}
