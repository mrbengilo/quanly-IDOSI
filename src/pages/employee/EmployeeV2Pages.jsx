import { useEffect, useRef, useState } from 'react'
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
  MoneyInput,
  MetricCard,
  Modal,
  PageHeader,
  Select,
  TableFooter,
  TableWrap,
} from '../../components/UI'
import { SearchableSelect } from '../../components/SearchableSelect'
import { resolveShiftCandidates } from '../../domain'
import { STORE_SALARY_CONFIG_IDENTIFIER_COLLISION } from '../../domain/storeTieredPayroll'
import { activeOccupationLabels, ORDER_PAYMENT_METHODS } from '../../domain/orderInformationSettings'
import { formatVietnamTransferDateTime, isSupportTransferActiveAt, supportTransferBounds } from '../../domain/supportTransferTime'
import { useApp } from '../../state/AppContext'
import {
  businessDate,
  calculateEmployeeBasePay,
  getHourlyRate,
  getMonthlySalary,
  getPayBasis,
  money,
  operationalIdentifierRecordMatch,
  operationalIdentifierReferenceMatchesRecord,
  resolveStoreEmployeeSalaryPolicy,
  shortDate,
  shortDateTime24,
  today,
  usesMonthlyHoursFormula,
} from '../../utils'
import { employeeTasksForDate, taskCompletedByEmployee } from './taskScope'
import {
  ACQUISITION_CHANNELS,
  checkoutReconciliation,
  effectiveEmployeeStoreId,
  employeeCreatedOrders,
  ORDER_GENDERS,
  ordersForOpenAttendance,
  shiftRevenueBreakdown,
  validateEmployeeOrder,
} from './employeeShiftOrders'
import {
  employeePayrollSnapshotSummary,
  supportAttendanceCompensationRows,
  supportCompensationTotals,
  supportPayrollDetailRows,
  supportRowsUncoveredByPayrollSnapshot,
} from './employeeSupportCompensation'

const parseMoney = (value) => Math.max(0, Math.trunc(Number(String(value ?? '').replace(/[^\d-]/gu, '')) || 0))
const recordDate = (record) => String(record?.date || record?.workDate || record?.checkInAt || record?.createdAt || '').slice(0, 10)
const employeeKey = (employee = {}) => String(employee?.id || employee?.code || employee?.employeeCode || '')
const employeeAliases = (employee = {}) => [employee?.id, employee?.code, employee?.employeeId, employee?.employeeCode]
  .map((value) => String(value || '').trim())
  .filter(Boolean)
const storeAliases = (store = {}) => [store?.id, store?.code]
  .map((value) => String(value || '').trim())
  .filter(Boolean)
const shiftAliases = (shift = {}) => [shift?.id, shift?.code]
  .map((value) => String(value || '').trim())
  .filter(Boolean)
const timestamp = shortDateTime24
const periodLabel = (value) => value ? value.split('-').reverse().join('/') : '—'
const EMPTY_ORDER_FORM = Object.freeze({ customerName: '', customerPhone: '', customerAge: '', gender: '', occupation: '', acquisitionChannel: '', amount: '', paymentMethod: '' })
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

const attendanceEarlyMinutes = (record) => Math.max(0, Number(record?.minutesEarly ?? record?.earlyMinutes) || 0)
const attendanceLateMinutes = (record) => Math.max(0, Number(record?.minutesLate ?? record?.lateMinutes) || 0)
const taskIsRequired = (task = {}) => task.required !== false

const resolveTarget = (records, reference, identifierOf, fallback = null) => {
  const source = Array.isArray(records) ? records : []
  if (!source.length) return fallback
  const resolution = operationalIdentifierRecordMatch(source, reference, identifierOf)
  return resolution.ambiguous ? null : resolution.record
}

const referenceMatchesTarget = (records, target, reference, identifierOf) => {
  if (!target || !String(reference || '').trim()) return false
  const source = Array.isArray(records) && records.length ? records : [target]
  const resolution = operationalIdentifierRecordMatch(source, reference, identifierOf)
  return !resolution.ambiguous && resolution.record === target
}

const employeeReferenceMatches = (employees, employee, reference) => (
  referenceMatchesTarget(employees, resolveTarget(employees, employeeKey(employee), employeeAliases, employee), reference, employeeAliases)
)

const storeForReference = (stores, reference) => resolveTarget(stores, reference, storeAliases)

const currentEmployeeForApp = (app) => {
  const employees = Array.isArray(app.employees) ? app.employees : []
  const references = [
    employeeKey(app.currentEmployee),
    app.session?.employeeId,
    app.session?.code,
    app.session?.id,
  ].map((value) => String(value || '').trim()).filter(Boolean)
  for (const reference of references) {
    const resolution = operationalIdentifierRecordMatch(employees, reference, employeeAliases)
    if (resolution.record) return resolution.record
    if (resolution.ambiguous) return {}
  }
  if (app.session?.username) {
    const usernameMatches = employees.filter((employee) => employee.username === app.session.username)
    if (usernameMatches.length === 1) return usernameMatches[0]
    if (usernameMatches.length > 1) return {}
  }
  return employees.length ? {} : (app.currentEmployee || app.session || {})
}

const workedHours = (record = {}) => {
  const explicit = Number(record.hours)
  if (Number.isFinite(explicit) && explicit >= 0) return explicit
  return 0
}

const employeeAttendance = (attendance, employee, { employees = [], stores = [], storeId = '' } = {}) => {
  const targetEmployee = resolveTarget(employees, employeeKey(employee), employeeAliases, employee)
  const targetStore = storeId ? resolveTarget(stores, storeId, storeAliases, { id: String(storeId) }) : null
  if (!targetEmployee || (storeId && !targetStore)) return []
  return attendance
    .filter((record) => (
      !record.deletedAt
      && [record.employeeId, record.employeeCode].some((reference) => (
        referenceMatchesTarget(employees, targetEmployee, reference, employeeAliases)
      ))
      && (!storeId || referenceMatchesTarget(stores, targetStore, record.storeId, storeAliases))
    ))
    .sort((left, right) => String(right.checkInAt || right.date || '').localeCompare(String(left.checkInAt || left.date || '')))
}

const findScheduledShifts = (app, employee, workDate) => {
  const targetEmployee = resolveTarget(app.employees, employeeKey(employee), employeeAliases, employee)
  const targetStore = resolveTarget(app.stores, employee.storeId, storeAliases, { id: String(employee.storeId || '') })
  if (!targetEmployee || !targetStore) return []
  const assignment = (app.schedule || []).find((record) => (
    employeeReferenceMatches(app.employees, targetEmployee, record.employeeId)
    && referenceMatchesTarget(app.stores, targetStore, record.storeId || employee.storeId, storeAliases)
    && (!record.date || record.date === workDate)
  ))
  const ids = assignment?.shiftIds || []
  const snapshots = Array.isArray(assignment?.shiftSnapshots) ? assignment.shiftSnapshots : []
  const definitions = Array.isArray(app.shiftDefinitions) ? app.shiftDefinitions : []
  const selected = ids.map((id) => (
    resolveTarget(snapshots, id, shiftAliases)
    || resolveTarget(definitions.filter((shift) => shift.active !== false), id, shiftAliases)
  )).filter(Boolean)
  return selected.map((shift) => ({ ...shift, date: workDate }))
}

const activeSupportTransfer = ({
  supportTransfers = [],
  openTransferId = '',
  sessionTransferId = '',
  employee,
  employees = [],
  sessionStore,
  stores = [],
  at,
}) => {
  for (const reference of [openTransferId, sessionTransferId]) {
    if (!reference) continue
    const resolution = operationalIdentifierRecordMatch(supportTransfers, reference, (record) => [record.id])
    if (resolution.ambiguous) return null
    if (resolution.record) return resolution.record
  }
  if (!employee || !sessionStore) return null
  const matches = supportTransfers.filter((record) => (
    employeeReferenceMatches(employees, employee, record.employeeId)
    && referenceMatchesTarget(stores, sessionStore, record.toStoreId, storeAliases)
    && isSupportTransferActiveAt(record, at)
  ))
  return matches.length === 1 ? matches[0] : null
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
    attendance = [],
    orders = [],
    schedule = [],
    tasks = [],
    stores = [],
    supportTransfers = [],
    session,
    policies,
    checkIn,
    checkOut,
    notify,
  } = app
  const employee = currentEmployeeForApp(app)
  const [now, setNow] = useState(() => new Date())
  const [candidateModal, setCandidateModal] = useState(null)
  const [checkoutOpen, setCheckoutOpen] = useState(false)
  const [locating, setLocating] = useState('')
  const [cashRevenue, setCashRevenue] = useState('')
  const [transferRevenue, setTransferRevenue] = useState('')
  const employeeId = employeeKey(employee)
  const workDate = today()
  const allOwnAttendance = employeeAttendance(attendance, employee, { employees: app.employees, stores })
  const activeRecord = allOwnAttendance.find((record) => !record.checkOutAt && !record.checkOut)
  const sessionStoreId = String(session?.storeId || employee?.storeId || '')
  // An expired transfer no longer grants destination access, but its still-open
  // attendance remains visible so the employee can reconcile and close that shift.
  const workingStoreId = String(activeRecord?.storeId || sessionStoreId)
  const homeStoreId = String(session?.homeStoreId || employee?.storeId || sessionStoreId)
  const store = storeForReference(stores, workingStoreId)
  const homeStore = storeForReference(stores, homeStoreId)
  const openTransferId = String(activeRecord?.supportTransferId || '').trim()
  const sessionTransferId = String(session?.activeTransferId || '').trim()
  const activeTransfer = activeSupportTransfer({
    supportTransfers,
    openTransferId,
    sessionTransferId,
    employee,
    employees: app.employees,
    sessionStore: storeForReference(stores, sessionStoreId),
    stores,
    at: now,
  })
  const hasActiveTransferAccess = Boolean(activeTransfer && isSupportTransferActiveAt(activeTransfer, now))
  const isSupporting = Boolean(
    activeTransfer
    && store
    && homeStore
    && store !== homeStore
    && (hasActiveTransferAccess || operationalIdentifierReferenceMatchesRecord(
      supportTransfers,
      activeTransfer,
      activeRecord?.supportTransferId,
    )),
  )
  const dashboardEmployee = { ...(employee || {}), storeId: workingStoreId }
  const ownAttendance = employeeAttendance(attendance, employee, {
    employees: app.employees,
    stores,
    storeId: workingStoreId,
  })
  const operationalDate = activeRecord ? recordDate(activeRecord) : workDate
  const todayRecords = ownAttendance.filter((record) => recordDate(record) === workDate)
  const ownOrders = employeeCreatedOrders(orders, employeeId, workingStoreId, {
    employees: app.employees,
    stores,
  })
  const monthOrders = ownOrders.filter((order) => businessDate(order.createdAt).startsWith(workDate.slice(0, 7)))
  const todayTasks = employeeTasksForDate({
    tasks,
    schedule,
    attendance,
    employee: dashboardEmployee,
    employees: app.employees,
    stores,
    shiftDefinitions: app.shiftDefinitions,
    workDate: operationalDate,
  })
  const completedTasks = todayTasks.filter((task) => taskCompletedByEmployee(task, employeeId, app.employees)).length
  const scheduledShifts = findScheduledShifts(app, dashboardEmployee, operationalDate)
  const transferBounds = supportTransferBounds(activeTransfer || {})
  const shifts = isSupporting ? [{
    id: `SUPPORT_TRANSFER_${activeTransfer.id}`.replace(/[^A-Za-z0-9_-]/gu, '_').slice(0, 80),
    name: 'Ca hỗ trợ cửa hàng',
    start: transferBounds?.startLocal?.slice(11, 16) || '--:--',
    end: transferBounds?.endLocal?.slice(11, 16) || '--:--',
    date: operationalDate,
    source: 'support-transfer',
  }] : scheduledShifts
  const activeShiftOrders = ordersForOpenAttendance(ownOrders, employeeId, activeRecord, app.attendance, {
    employees: app.employees,
    stores,
    shiftDefinitions: app.shiftDefinitions,
  })
  const activeShiftId = String(activeRecord?.shiftId || activeRecord?.shift || '')
  const activeScheduledShift = resolveTarget(shifts, activeShiftId, shiftAliases)
  const activeShiftTasks = todayTasks.filter((task) => {
    const taskShiftId = String(task.shiftId || task.shift || '')
    const activeShift = resolveTarget(app.shiftDefinitions, activeShiftId, shiftAliases, { id: activeShiftId })
    return activeRecord && (!taskShiftId || referenceMatchesTarget(app.shiftDefinitions, activeShift, taskShiftId, shiftAliases))
  })
  const incompleteTasks = activeShiftTasks.filter((task) => taskIsRequired(task) && !taskCompletedByEmployee(task, employeeId, app.employees))
  const incompleteRewardTasks = activeShiftTasks.filter((task) => !taskIsRequired(task) && !taskCompletedByEmployee(task, employeeId, app.employees))
  const expectedRevenue = shiftRevenueBreakdown(activeShiftOrders)
  const reconciliation = checkoutReconciliation({
    orders: activeShiftOrders,
    cashRevenue: parseMoney(cashRevenue),
    transferRevenue: parseMoney(transferRevenue),
  })
  const revenueDeclared = cashRevenue.trim() !== '' && transferRevenue.trim() !== ''
  const checkoutReady = revenueDeclared && reconciliation.matches && incompleteTasks.length === 0

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1_000)
    return () => window.clearInterval(timer)
  }, [])

  const captureAndCheckIn = async (shift) => {
    setLocating('in')
    try {
      const location = await geolocate()
      const result = await checkIn?.({
        employeeId,
        date: operationalDate,
        shiftId: shift.id,
        shiftName: shift.name,
        shiftStart: shift.start,
        shiftEnd: shift.end,
        location,
      })
      if (!result?.ok) notify?.(result?.message || 'Không thể điểm danh.', 'info')
      if (result?.ok) setCandidateModal(null)
    } catch (error) {
      notify?.(error.message, 'info')
    } finally {
      setLocating('')
    }
  }

  const beginCheckIn = () => {
    if (!shifts.length) {
      notify?.('Bạn chưa được xếp ca cho ngày hôm nay.', 'info')
      return
    }
    try {
      const result = resolveShiftCandidates({
        at: now,
        shifts,
        workDate: operationalDate,
        earlyWindowMinutes: Number(policies?.earlyCheckInLimitMinutes || 120),
      })
      if (!result.candidates.length) {
        notify?.(`Chưa đến thời gian điểm danh. Chỉ được vào sớm tối đa ${policies?.earlyCheckInLimitMinutes || 120} phút.`, 'info')
        return
      }
      setCandidateModal(result)
    } catch {
      notify?.('Không thể xác định ca phù hợp từ lịch làm việc.', 'info')
    }
  }

  const submitCheckout = async () => {
    if (!activeRecord) return
    if (!reconciliation.matches) {
      notify?.('Tiền mặt và chuyển khoản phải khớp riêng từng kênh với đơn hàng trong ca.', 'info')
      return
    }
    if (incompleteTasks.length) {
      notify?.(`Cần hoàn thành đủ ${incompleteTasks.length} công việc cố định còn lại trước khi kết ca.`, 'info')
      return
    }
    setLocating('out')
    try {
      const location = await geolocate()
      const result = await checkOut?.({
        attendanceId: activeRecord.id,
        location,
        cashRevenue: parseMoney(cashRevenue),
        transferRevenue: parseMoney(transferRevenue),
      })
      if (!result?.ok) {
        notify?.(result?.message || 'Không thể kết ca.', 'info')
        return
      }
      setCheckoutOpen(false)
      setCashRevenue('')
      setTransferRevenue('')
    } catch (error) {
      notify?.(error.message, 'info')
    } finally {
      setLocating('')
    }
  }

  const displayShift = activeRecord || shifts[0]

  return (
    <div className="page employee-home">
      <div className="employee-hero-title">
        <img src="/favicon.png" width="56" height="56" alt="Logo IDOSI" />
        <h1>{store?.name || 'Cửa hàng IDOSI'}</h1>
        <p>HỆ THỐNG LÀM VIỆC NHÂN VIÊN</p>
      </div>
      <PageHeader
        title={`XIN CHÀO, ${employee?.name || 'NHÂN VIÊN'}`}
        subtitle={isSupporting
          ? `NV hỗ trợ từ ${homeStore?.name || homeStoreId} · đang làm việc tại ${store?.name || workingStoreId}.`
          : 'Điểm danh, theo dõi ca, đơn hàng và công việc đúng cửa hàng trực thuộc.'}
        icon={Fingerprint}
        actions={isSupporting ? <Badge tone="orange">NV HỖ TRỢ</Badge> : null}
      />
      <div className="employee-top-grid">
        <Card className="checkin-card">
          <h2>ĐIỂM DANH</h2>
          <p>{shortDate(now)}</p>
          <strong>{now.toLocaleTimeString('vi-VN', { hour12: false })}</strong>
          {!activeRecord
            ? <Button icon={Fingerprint} loading={locating === 'in'} disabled={Boolean(locating)} onClick={beginCheckIn}>ĐIỂM DANH</Button>
            : <Button variant="danger" icon={LogOut} loading={locating === 'out'} disabled={Boolean(locating)} onClick={() => setCheckoutOpen(true)}>KẾT CA</Button>}
          <small>{activeRecord ? `Đã vào ca lúc ${activeRecord.checkIn || timestamp(activeRecord.checkInAt)}` : 'Khi bấm Điểm danh, hệ thống sẽ yêu cầu quyền vị trí.'}</small>
        </Card>
        <Card className="employee-info-card">
          <h2>THÔNG TIN NHÂN VIÊN</h2>
          <dl>
            <div><dt>Mã nhân viên</dt><dd>{employeeId || '—'}</dd></div>
            <div><dt>Họ và tên</dt><dd>{employee?.name || '—'}</dd></div>
            <div><dt>Cửa hàng đang làm việc</dt><dd>{store?.name || '—'}</dd></div>
            <div><dt>Cửa hàng chính trực thuộc</dt><dd>{homeStore?.name || '—'}</dd></div>
            {isSupporting && <>
              <div><dt>Lương hỗ trợ</dt><dd>{money(activeTransfer.hourlySupportRate || 0)}/giờ</dd></div>
              <div><dt>Phụ cấp hỗ trợ</dt><dd>{money(activeTransfer.allowance || 0)}</dd></div>
              <div><dt>Thời gian hỗ trợ</dt><dd>{activeTransfer.startAt && activeTransfer.endAt ? `${formatVietnamTransferDateTime(activeTransfer.startAt)} – ${formatVietnamTransferDateTime(activeTransfer.endAt)}` : `${shortDate(activeTransfer.fromDate)} – ${shortDate(activeTransfer.toDate)}`}</dd></div>
            </>}
            <div><dt>Loại nhân viên</dt><dd>{employee?.employmentType || employee?.type || '—'}</dd></div>
            <div><dt>Số điện thoại</dt><dd>{employee?.phone || '—'}</dd></div>
          </dl>
        </Card>
        <Card className="current-shift-card">
          <h2>CA LÀM VIỆC HÔM NAY</h2>
          <div>
            <Badge tone={activeRecord ? 'green' : isSupporting ? 'orange' : 'blue'}>{displayShift?.shiftName || displayShift?.name || 'CHƯA XẾP CA'}</Badge>
            <strong>{displayShift ? `${displayShift.shiftStart || displayShift.start || '--:--'} – ${displayShift.shiftEnd || displayShift.end || '--:--'}` : '—'}</strong>
          </div>
          <p><span>Giờ vào: <b>{activeRecord?.checkIn || '--:--'}</b></span><span>Giờ kết ca: <b>{activeRecord?.checkOut || '--:--'}</b></span></p>
          <div className={activeRecord ? 'status-ok' : 'status-pending'}>{activeRecord ? 'Đang làm việc' : todayRecords.some((record) => record.checkOutAt || record.checkOut) ? 'Đã kết ca' : 'Chưa điểm danh'}</div>
        </Card>
      </div>
      <div className="metrics-grid metrics-grid--4">
        <MetricCard label="TRẠNG THÁI CA" value={activeRecord ? 'Đang làm' : todayRecords.some((record) => record.checkOutAt || record.checkOut) ? 'Đã kết ca' : 'Chưa điểm danh'} icon={Clock3} tone={activeRecord ? 'green' : 'blue'} />
        <MetricCard label={isSupporting ? 'CHẾ ĐỘ LÀM VIỆC' : 'CA ĐƯỢC PHÂN HÔM NAY'} value={isSupporting ? 'Hỗ trợ' : shifts.length} suffix={isSupporting ? '' : 'ca'} icon={CalendarDays} tone={isSupporting ? 'orange' : 'blue'} />
        <MetricCard label="ĐƠN TRONG THÁNG" value={monthOrders.length} suffix="đơn" icon={ShoppingCart} tone="green" />
        <MetricCard label="CÔNG VIỆC HÔM NAY" value={`${completedTasks}/${todayTasks.length}`} icon={ClipboardCheck} tone={completedTasks === todayTasks.length && todayTasks.length ? 'green' : 'orange'} />
      </div>
      <Card title="LỊCH PHÂN CA CỦA TÔI">
        <TableWrap>
          <thead><tr><th>Ngày</th><th>Cửa hàng</th><th>Ca</th><th>Thời gian 24 giờ</th><th>Trạng thái</th></tr></thead>
          <tbody>
            {shifts.map((shift) => <tr key={shift.id}><td><strong>{shortDate(operationalDate)}</strong></td><td>{store?.name || '—'}</td><td>{shift.name || shift.id}</td><td><strong>{shift.start || '--:--'} – {shift.end || '--:--'}</strong></td><td><Badge tone={shift === activeScheduledShift ? 'green' : 'blue'}>{shift === activeScheduledShift ? 'Đang làm' : 'Đã xếp ca'}</Badge></td></tr>)}
            {!shifts.length && <tr><td colSpan="5">Chưa có lịch phân ca hôm nay.</td></tr>}
          </tbody>
        </TableWrap>
      </Card>
      <Card title="TRUY CẬP NHANH">
        <div className="quick-action-grid">
          <Button icon={ClipboardCheck} onClick={() => navigate('/employee/tasks')}>Công việc được giao</Button>
          <Button icon={CheckCircle2} variant="outline" onClick={() => navigate('/employee/reward-tasks')}>Công việc tính thưởng</Button>
          <Button icon={Plus} onClick={() => navigate('/employee/orders')}>Tạo đơn hàng</Button>
          <Button icon={Clock3} variant="outline" onClick={() => navigate('/employee/work-history')}>Lịch sử làm việc</Button>
          <Button icon={Wallet} variant="outline" onClick={() => navigate('/employee/payroll')}>Bảng lương</Button>
          <Button icon={Banknote} variant="outline" onClick={() => navigate('/employee/cashflow')}>Dòng tiền cá nhân</Button>
        </div>
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
      <Modal
        open={checkoutOpen && Boolean(activeRecord)}
        onClose={() => setCheckoutOpen(false)}
        title="Kết ca và đối soát doanh thu"
        footer={<><Button variant="outline" onClick={() => setCheckoutOpen(false)}>Hủy</Button><Button variant="danger" icon={LogOut} loading={locating === 'out'} disabled={!checkoutReady || Boolean(locating)} onClick={submitCheckout}>XÁC NHẬN KẾT CA</Button></>}
      >
        <div className="form-grid">
          <Field label="Tiền mặt" required hint={`Theo đơn trong ca: ${money(expectedRevenue.cash)}`} error={cashRevenue && !reconciliation.cashMatches ? 'Số tiền mặt chưa khớp.' : ''}>
            <MoneyInput value={cashRevenue} onChange={(event) => setCashRevenue(event.target.value)} placeholder="Nhập số tiền" />
          </Field>
          <Field label="Chuyển khoản" required hint={`Theo đơn trong ca: ${money(expectedRevenue.transfer)}`} error={transferRevenue && !reconciliation.transferMatches ? 'Số tiền chuyển khoản chưa khớp.' : ''}>
            <MoneyInput value={transferRevenue} onChange={(event) => setTransferRevenue(event.target.value)} placeholder="Nhập số tiền" />
          </Field>
          <InfoNote tone={reconciliation.matches ? 'green' : 'orange'}>
            Đã nhập {money(reconciliation.entered.total)} / Doanh thu đơn hàng {money(expectedRevenue.total)}. Hệ thống kiểm tra riêng tiền mặt và chuyển khoản.
          </InfoNote>
          {!revenueDeclared && <InfoNote tone="orange">Vui lòng nhập rõ cả hai ô; nếu không phát sinh hãy nhập 0.</InfoNote>}
          {expectedRevenue.unknown > 0 && <InfoNote tone="orange">Có {money(expectedRevenue.unknown)} dùng hình thức thanh toán chưa hỗ trợ. Vui lòng liên hệ quản lý trước khi kết ca.</InfoNote>}
          {incompleteTasks.length > 0 && (
            <InfoNote tone="red">
              Còn {incompleteTasks.length} công việc cố định chưa hoàn thành. Hãy hoàn thành trước khi kết ca.
            </InfoNote>
          )}
          {incompleteRewardTasks.length > 0 && (
            <InfoNote>
              Còn {incompleteRewardTasks.length} công việc nhận thưởng tùy chọn chưa hoàn thành; bạn vẫn có thể kết ca và không cần nhập lý do.
            </InfoNote>
          )}
        </div>
      </Modal>
    </div>
  )
}

export function EmployeeOrdersPage() {
  const app = useApp()
  const [searchParams] = useSearchParams()
  const { session, stores = [], orders = [], attendance = [], orderInformationOptions = [], apiStatus, createOrder, notify } = app
  const employee = currentEmployeeForApp(app)
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [formErrors, setFormErrors] = useState({})
  const [form, setForm] = useState(EMPTY_ORDER_FORM)
  const orderRequestRef = useRef({ fingerprint: '', idempotencyKey: '' })
  const employeeId = employeeKey(employee)
  const effectiveStoreId = effectiveEmployeeStoreId(session, employee)
  const store = storeForReference(stores, effectiveStoreId)
  const rows = employeeCreatedOrders(orders, employeeId, effectiveStoreId, {
    employees: app.employees,
    stores,
  })
  const total = rows.reduce((sum, order) => sum + Number(order.amount || 0), 0)
  const requestedOrderId = String(searchParams.get('order') || '')
  const requestedOrderMatch = operationalIdentifierRecordMatch(rows, requestedOrderId, (order) => [order.id, order.code])
  const requestedOrder = requestedOrderMatch.ambiguous ? null : requestedOrderMatch.record
  const requestedOrderKey = String(requestedOrder?.id || '')
  const openAttendance = employeeAttendance(attendance, employee, {
    employees: app.employees,
    stores,
    storeId: effectiveStoreId,
  }).find((record) => !record.checkOutAt && !record.checkOut)
  const occupations = activeOccupationLabels(orderInformationOptions)
    .map((occupation) => ({ value: occupation, label: occupation }))

  const openCreate = () => {
    if (!openAttendance) {
      notify('Bạn cần điểm danh vào ca trước khi tạo đơn hàng.', 'info')
      return
    }
    orderRequestRef.current = { fingerprint: '', idempotencyKey: '' }
    setFormErrors({})
    setOpen(true)
  }

  const closeCreate = () => {
    orderRequestRef.current = { fingerprint: '', idempotencyKey: '' }
    setForm(EMPTY_ORDER_FORM)
    setFormErrors({})
    setOpen(false)
  }

  const updateForm = (field, value) => {
    setForm((current) => ({ ...current, [field]: value }))
    setFormErrors((current) => current[field] ? { ...current, [field]: '' } : current)
  }

  useEffect(() => {
    if (!requestedOrderKey) return undefined
    const scrollTimer = window.setTimeout(() => {
      document.getElementById(`order-${requestedOrderKey}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 0)
    return () => window.clearTimeout(scrollTimer)
  }, [requestedOrderKey])

  const save = async () => {
    if (!openAttendance) {
      notify('Ca làm việc đã kết thúc hoặc chưa được mở. Vui lòng điểm danh lại trước khi tạo đơn hàng.', 'info')
      setOpen(false)
      return
    }
    const normalizedForm = { ...form, amount: parseMoney(form.amount), occupation: form.occupation.trim() }
    const errors = validateEmployeeOrder(normalizedForm, { occupationOptions: orderInformationOptions })
    if (Object.keys(errors).length) {
      setFormErrors(errors)
      notify('Vui lòng nhập đủ các thông tin bắt buộc của đơn hàng.', 'info')
      return
    }
    const requestFingerprint = JSON.stringify({
      ...normalizedForm,
      employeeId,
      storeId: effectiveStoreId,
      attendanceId: openAttendance?.id,
      shiftId: openAttendance?.shiftId || openAttendance?.shift,
    })
    if (orderRequestRef.current.fingerprint !== requestFingerprint) {
      orderRequestRef.current = {
        fingerprint: requestFingerprint,
        idempotencyKey: `order:${crypto.randomUUID()}`,
      }
    }
    setSaving(true)
    try {
      const result = await createOrder({
        ...normalizedForm,
        employeeId,
        storeId: effectiveStoreId,
        attendanceId: openAttendance?.id,
        shiftId: openAttendance?.shiftId || openAttendance?.shift,
        shiftName: openAttendance?.shiftName,
        idempotencyKey: orderRequestRef.current.idempotencyKey,
      })
      if (!result?.ok) {
        notify(result?.message || 'Không thể tạo đơn hàng.', 'info')
        return
      }
      closeCreate()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="page">
      <PageHeader
        title="ĐƠN HÀNG CỦA TÔI"
        subtitle={`Mọi đơn hàng và doanh thu được ghi nhận cho ${store?.name || 'cửa hàng trực thuộc'}.`}
        icon={ShoppingCart}
        actions={<Button icon={Plus} onClick={openCreate} disabled={!openAttendance}>TẠO ĐƠN HÀNG</Button>}
      />
      {!openAttendance && <InfoNote tone="orange">Bạn chưa có ca đang mở. Hãy điểm danh vào ca trước khi tạo đơn hàng.</InfoNote>}
      <div className="metric-grid metric-grid--four">
        <MetricCard label="TỔNG ĐƠN" value={rows.length} helper="Đơn chưa bị xóa" icon={ShoppingCart} tone="blue" />
        <MetricCard label="TỔNG DOANH THU" value={money(total)} helper="Từ đơn hàng thực tế" icon={Banknote} tone="green" />
        <MetricCard label="CA HIỆN TẠI" value={openAttendance?.shiftName || 'Chưa vào ca'} helper={openAttendance ? `${openAttendance.shiftStart || '—'} – ${openAttendance.shiftEnd || '—'}` : 'Điểm danh trước khi tạo đơn để gắn đúng ca'} icon={Clock3} tone="orange" />
      </div>
      <Card title="Lịch sử đơn hàng">
        {rows.length ? (
          <>
            <TableWrap>
              <thead><tr><th>Mã đơn</th><th>Thời gian</th><th>Khách hàng</th><th>Giới tính</th><th>Nghề nghiệp</th><th>Biết qua kênh</th><th>Ca làm việc</th><th>Thanh toán</th><th>Số tiền</th></tr></thead>
              <tbody>{rows.map((order) => <tr id={`order-${order.id}`} className={String(order.id) === requestedOrderKey ? 'order-row--highlight' : ''} key={order.id}><td><strong>{order.code}</strong></td><td>{timestamp(order.createdAt)}</td><td>{order.customerName || 'Khách lẻ'}<small className="table-note">{order.customerPhone || '—'} • {order.customerAge ?? '—'} tuổi</small></td><td>{order.gender || '—'}</td><td>{order.occupation || '—'}</td><td><Badge tone="green">{order.acquisitionChannel || '—'}</Badge></td><td>{order.shiftName || 'Chưa gắn ca'}</td><td><Badge tone={order.paymentMethod === 'Tiền mặt' ? 'orange' : 'blue'}>{order.paymentMethod}</Badge></td><td><strong>{money(order.amount)}</strong></td></tr>)}</tbody>
            </TableWrap>
            <TableFooter shown={rows.length} total={rows.length} />
          </>
        ) : <EmptyState title="Chưa có đơn hàng" description="Nhấn Tạo đơn hàng để ghi nhận đơn đầu tiên." />}
      </Card>
      <Modal open={open} onClose={closeCreate} title={`Tạo đơn hàng • ${store?.name || 'IDOSI'}`} footer={<><Button variant="outline" onClick={closeCreate}>Hủy</Button><Button icon={ShoppingCart} loading={saving} onClick={save}>LƯU ĐƠN</Button></>}>
        <div className="form-grid">
          <Field label="Tên khách hàng" required error={formErrors.customerName}><Input value={form.customerName} onChange={(event) => updateForm('customerName', event.target.value)} /></Field>
          <Field label="Số điện thoại"><Input inputMode="tel" value={form.customerPhone} onChange={(event) => updateForm('customerPhone', event.target.value)} /></Field>
          <Field label="Tuổi"><Input type="number" min="0" max="120" value={form.customerAge} onChange={(event) => updateForm('customerAge', event.target.value)} /></Field>
          <Field label="Giới tính" required hint="Hỏi khách hoặc đoán." error={formErrors.gender}><Select value={form.gender} onChange={(event) => updateForm('gender', event.target.value)}><option value="">Chọn giới tính</option>{ORDER_GENDERS.map((item) => <option key={item}>{item}</option>)}</Select></Field>
          <Field label="Nghề nghiệp" required hint="Hỏi khách hoặc đoán; dùng ô tìm kiếm trong danh sách." error={formErrors.occupation}><SearchableSelect aria-label="Nghề nghiệp" value={form.occupation} onChange={(event) => updateForm('occupation', event.target.value)} options={occupations} placeholder="Chọn" loading={['connecting', 'syncing'].includes(apiStatus)} error={apiStatus === 'error' ? 'Không thể tải danh sách nghề nghiệp.' : ''} /></Field>
          <Field label="Biết qua kênh nào" required error={formErrors.acquisitionChannel}><Select value={form.acquisitionChannel} onChange={(event) => updateForm('acquisitionChannel', event.target.value)}><option value="">Chọn kênh</option>{ACQUISITION_CHANNELS.map((item) => <option key={item}>{item}</option>)}</Select></Field>
          <Field label="Số tiền" required error={formErrors.amount}><MoneyInput value={form.amount} onChange={(event) => updateForm('amount', event.target.value)} placeholder="Nhập số tiền" /></Field>
          <Field label="Hình thức thanh toán" required error={formErrors.paymentMethod}><Select value={form.paymentMethod} onChange={(event) => updateForm('paymentMethod', event.target.value)}><option value="">Chọn</option>{ORDER_PAYMENT_METHODS.map((method) => <option key={method} value={method}>{method}</option>)}</Select></Field>
          <InfoNote>Đơn sẽ tự gắn với {openAttendance?.shiftName || openAttendance?.shift}, {store?.name || 'cửa hàng trực thuộc'} và thời gian tạo thực tế.</InfoNote>
        </div>
      </Modal>
    </div>
  )
}

export function EmployeeAttendancePage() {
  const app = useApp()
  const navigate = useNavigate()
  const {
    attendance = [],
    orders = [],
    policies,
    session,
    stores = [],
    supportTransfers = [],
    checkIn,
    notify,
  } = app
  const employee = currentEmployeeForApp(app)
  const employeeId = employeeKey(employee)
  const allRows = employeeAttendance(attendance, employee, { employees: app.employees, stores })
  const openRecord = allRows.find((record) => !record.checkOut && !record.checkOutAt)
  const sessionStoreId = String(session?.storeId || employee?.storeId || '')
  const workingStoreId = String(openRecord?.storeId || sessionStoreId)
  const homeStoreId = String(session?.homeStoreId || employee?.storeId || sessionStoreId)
  const workingStore = storeForReference(stores, workingStoreId)
  const homeStore = storeForReference(stores, homeStoreId)
  const rows = allRows
  const compensationRows = supportAttendanceCompensationRows({
    attendance: rows,
    employeeId,
    employee,
    employees: app.employees,
    supportTransfers,
    stores,
  })
  const compensationByAttendance = new Map(compensationRows.map((item) => [item.record, item]))
  const [candidateModal, setCandidateModal] = useState(null)
  const [locating, setLocating] = useState('')
  const workDate = today()
  const operationalDate = openRecord ? recordDate(openRecord) : workDate
  const openTransferId = String(openRecord?.supportTransferId || '').trim()
  const sessionTransferId = String(session?.activeTransferId || '').trim()
  const activeTransfer = activeSupportTransfer({
    supportTransfers,
    openTransferId,
    sessionTransferId,
    employee,
    employees: app.employees,
    sessionStore: storeForReference(stores, sessionStoreId),
    stores,
    at: new Date(),
  })
  const transferActive = Boolean(activeTransfer && isSupportTransferActiveAt(activeTransfer, new Date()))
  const isSupporting = Boolean(
    activeTransfer
    && workingStore
    && homeStore
    && workingStore !== homeStore
    && (transferActive || operationalIdentifierReferenceMatchesRecord(
      supportTransfers,
      activeTransfer,
      openRecord?.supportTransferId,
    )),
  )
  const scheduledShifts = findScheduledShifts(
    app,
    { ...(employee || {}), storeId: workingStoreId },
    operationalDate,
  )
  const transferBounds = supportTransferBounds(activeTransfer || {})
  const availableShifts = isSupporting ? [{
    id: `SUPPORT_TRANSFER_${activeTransfer.id}`.replace(/[^A-Za-z0-9_-]/gu, '_').slice(0, 80),
    name: 'Ca hỗ trợ cửa hàng',
    start: transferBounds?.startLocal?.slice(11, 16) || '--:--',
    end: transferBounds?.endLocal?.slice(11, 16) || '--:--',
    date: operationalDate,
    source: 'support-transfer',
  }] : scheduledShifts
  const currentShiftOrders = ordersForOpenAttendance(orders, employeeId, openRecord, app.attendance, {
    employees: app.employees,
    stores,
    shiftDefinitions: app.shiftDefinitions,
  })
  const currentShiftRevenue = currentShiftOrders.reduce((sum, order) => sum + Number(order.amount || 0), 0)

  const captureAndCheckIn = async (shift) => {
    setLocating('in')
    try {
      const location = await geolocate()
      const result = await checkIn({
        employeeId,
        date: operationalDate,
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
    if (!availableShifts.length) {
      notify('Bạn chưa được xếp ca cho ngày hôm nay.', 'info')
      return
    }
    let result
    try {
      result = resolveShiftCandidates({
        at: new Date(),
        shifts: availableShifts,
        workDate: operationalDate,
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

  const stats = rows.reduce((value, record) => {
    const label = statusLabel(record.arrivalTag || record.status)
    value.total += 1
    value.hours += workedHours(record)
    value.earlyMinutes += attendanceEarlyMinutes(record)
    value.lateMinutes += attendanceLateMinutes(record)
    if (label === 'Đi sớm') value.early += 1
    if (label === 'Đi đúng giờ') value.onTime += 1
    if (label === 'Đi trễ') value.late += 1
    return value
  }, { total: 0, early: 0, onTime: 0, late: 0, earlyMinutes: 0, lateMinutes: 0, hours: 0 })

  return (
    <div className="page">
      <PageHeader title="CHẤM CÔNG" subtitle="Chọn đúng ca, xác nhận vị trí khi vào và ra. Hệ thống không tự động chấm công." icon={Fingerprint} />
      <div className="attendance-actions-grid">
        <Card className="attendance-action-card" title="Vào ca">
          <Clock3 size={32} />
          <strong>{openRecord?.checkIn || '--:--'}</strong>
          <span>{openRecord ? `${openRecord.shiftName} • ${openRecord.shiftStart}–${openRecord.shiftEnd}` : `${availableShifts.length} ca có thể điểm danh`}</span>
          <Button icon={Fingerprint} onClick={beginCheckIn} loading={locating === 'in'} disabled={Boolean(openRecord) || Boolean(locating)}>ĐIỂM DANH</Button>
        </Card>
        <Card className="attendance-action-card" title="Kết ca">
          <MapPin size={32} />
          <strong>{openRecord ? 'Đang làm việc' : 'Chưa có ca mở'}</strong>
          <span>Đối soát tiền mặt, chuyển khoản và công việc tại Trang chủ.</span>
          {openRecord ? <Button variant="danger" icon={LogOut} onClick={() => navigate('/employee/home')}>MỞ KẾT CA</Button> : null}
        </Card>
      </div>
      <div className="metric-grid metric-grid--four">
        <MetricCard label="TỔNG CA" value={stats.total} icon={Clock3} tone="blue" />
        <MetricCard label="ĐI SỚM" value={stats.early} helper={`${stats.earlyMinutes} phút sớm`} icon={CheckCircle2} tone="green" />
        <MetricCard label="ĐI ĐÚNG GIỜ" value={stats.onTime} icon={CheckCircle2} tone="blue" />
        <MetricCard label="ĐI TRỄ" value={stats.late} helper={`${stats.lateMinutes} phút trễ`} icon={Clock3} tone="red" />
      </div>
      <Card title="Đơn hàng trong ca hiện tại" action={openRecord ? <Badge tone="green">{currentShiftOrders.length} đơn • {money(currentShiftRevenue)}</Badge> : null}>
        {!openRecord
          ? <InfoNote>Bạn cần điểm danh vào ca để hệ thống nhóm đơn hàng theo đúng ca làm việc.</InfoNote>
          : currentShiftOrders.length
            ? <TableWrap><thead><tr><th>Mã đơn</th><th>Thời gian</th><th>Khách hàng</th><th>Thanh toán</th><th>Số tiền</th></tr></thead><tbody>{currentShiftOrders.map((order) => <tr key={order.id || order.code}><td><strong>{order.code || order.id}</strong></td><td>{timestamp(order.createdAt)}</td><td>{order.customerName || 'Khách lẻ'}</td><td><Badge tone={order.paymentMethod === 'Tiền mặt' ? 'orange' : 'blue'}>{order.paymentMethod || '—'}</Badge></td><td><strong>{money(order.amount)}</strong></td></tr>)}</tbody></TableWrap>
            : <EmptyState title="Chưa có đơn hàng trong ca" description="Đơn hàng bạn tạo sau khi vào ca sẽ tự động hiển thị tại đây." />}
      </Card>
      <Card title="Lịch sử làm việc và chấm công">
        <TableWrap>
          <thead><tr><th>Ngày</th><th>Ca làm việc</th><th>Phụ chú</th><th>Giờ vào</th><th>Vị trí vào</th><th>Giờ ra</th><th>Vị trí ra</th><th>Số giờ</th><th>Lương thực nhận</th><th>Số đơn</th><th>Doanh thu ca</th><th>Trạng thái</th><th>Phút sớm / trễ</th></tr></thead>
          <tbody>{rows.map((record) => {
            const shiftOrders = ordersForOpenAttendance(orders, employeeId, record, app.attendance, {
              employees: app.employees,
              stores,
              shiftDefinitions: app.shiftDefinitions,
            })
            const shiftRevenue = shiftOrders.reduce((sum, order) => sum + Number(order.amount || 0), 0)
            const compensation = compensationByAttendance.get(record)
            return <tr key={record.id}><td><strong>{shortDate(recordDate(record))}</strong></td><td>{record.shiftName || record.shift}<small className="table-note">{record.shiftStart}–{record.shiftEnd}</small></td><td>{compensation?.isSupport ? <div className="table-stack"><Badge tone="orange">Ca hỗ trợ • {compensation.destinationStoreName}</Badge><small>{compensation.timeLabel}</small><small>{money(compensation.hourlyRate)}/giờ • Phụ cấp {money(compensation.allowance)}</small></div> : '—'}</td><td>{record.checkIn || '—'}</td><td>{record.checkInLocation?.label || record.location?.label || 'Đã ghi tọa độ'}</td><td>{record.checkOut || 'Đang làm'}</td><td>{record.checkOutLocation?.label || (record.checkOut ? 'Đã ghi tọa độ' : '—')}</td><td>{workedHours(record).toFixed(2)}</td><td>{compensation?.isSupport ? <div className="table-stack"><strong className="green-text">{money(compensation.actualPay)}</strong><small>{compensation.hours.toFixed(2)} giờ × {money(compensation.hourlyRate)}{compensation.allowance > 0 ? ` + ${money(compensation.allowance)}` : ''}</small></div> : '—'}</td><td><strong>{shiftOrders.length}</strong></td><td><strong>{money(shiftRevenue)}</strong></td><td><Badge tone={statusTone(record.arrivalTag || record.status)}>{statusLabel(record.arrivalTag || record.status)}</Badge></td><td><span className="attendance-minutes"><strong>{attendanceEarlyMinutes(record)}</strong> sớm / <strong>{attendanceLateMinutes(record)}</strong> trễ</span></td></tr>
          })}{!rows.length && <tr><td colSpan="13">Chưa có lịch sử chấm công.</td></tr>}</tbody>
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
  const {
    attendance = [],
    stores = [],
    supportTransfers = [],
    salaryAdjustments = [],
    salaryAdvances = [],
    payrollPeriods = [],
    storeEmployeeSalaryConfigs = [],
  } = app
  const employee = currentEmployeeForApp(app)
  const employeeId = employeeKey(employee)
  const targetEmployee = resolveTarget(app.employees, employeeId, employeeAliases, employee)
  const employeeOwnsReference = (reference) => (
    referenceMatchesTarget(app.employees, targetEmployee, reference, employeeAliases)
  )
  const allRows = employeeAttendance(attendance, employee, { employees: app.employees, stores })
  const periods = [...new Set([
    ...allRows.map((record) => recordDate(record).slice(0, 7)),
    ...payrollPeriods.filter((item) => item.rows?.some((row) => employeeOwnsReference(row.employeeId || row.employeeCode))).map((item) => item.period),
  ].filter(Boolean))].sort().reverse()
  const [period, setPeriod] = useState(() => periods[0] || today().slice(0, 7))
  const rows = allRows.filter((record) => recordDate(record).startsWith(period))
  const compensationRows = supportAttendanceCompensationRows({
    attendance: allRows,
    employeeId,
    employee,
    employees: app.employees,
    supportTransfers,
    stores,
  })
  const supportRows = compensationRows.filter((item) => (
    item.isSupport && recordDate(item.record).startsWith(period)
  ))
  const snapshot = employeePayrollSnapshotSummary({
    payrollPeriods,
    employeeId,
    employee,
    employees: app.employees,
    stores,
    period,
  })
  const uncoveredSupportRows = supportRowsUncoveredByPayrollSnapshot(supportRows, snapshot)
  const uncoveredSupportTotals = supportCompensationTotals(uncoveredSupportRows)
  const supportDetails = supportPayrollDetailRows({
    snapshotDetails: snapshot?.supportDetails,
    snapshot,
    attendanceRows: supportRows,
    stores,
  })
  const homeRows = rows.filter((record) => (
    !record.supportTransferId
    && !record.supportCompensation?.transferId
    && !record.compensation?.support?.transferId
  ))
  const hours = homeRows.reduce((sum, record) => sum + workedHours(record), 0)
  const basis = getPayBasis(employee || {})
  const homeStore = storeForReference(stores, employee?.storeId)
  const snapshotSalary = snapshot?.homeSnapshot?.rows?.find((row) => row.salarySnapshot)?.salarySnapshot || null
  const snapshotSalaryPolicy = snapshotSalary?.salaryConfigSnapshot || snapshotSalary?.salaryConfig || null
  let liveSalaryPolicy = null
  let salaryPolicyError = snapshot?.identifierCollision
    ? Object.assign(new Error('PAYROLL_PERIOD_IDENTIFIER_COLLISION'), { code: 'PAYROLL_PERIOD_IDENTIFIER_COLLISION' })
    : null
  if (!snapshot?.homeSnapshot && !salaryPolicyError) {
    try {
      liveSalaryPolicy = resolveStoreEmployeeSalaryPolicy(employee || {}, {
        store: homeStore,
        salaryConfigs: storeEmployeeSalaryConfigs,
        period,
      })
    } catch (error) {
      if (error?.code !== STORE_SALARY_CONFIG_IDENTIFIER_COLLISION) throw error
      salaryPolicyError = error
    }
  }
  const displayedSalaryPolicy = snapshot?.homeSnapshot ? snapshotSalaryPolicy : liveSalaryPolicy
  const effectiveBasis = displayedSalaryPolicy
    ? 'tiered-hourly'
    : snapshot?.homeSnapshot && snapshotSalary
      ? getPayBasis({ ...(employee || {}), ...snapshotSalary })
      : basis
  const estimatedHomeBase = salaryPolicyError ? 0 : calculateEmployeeBasePay(employee || {}, {
    hours,
    store: homeStore,
    salaryConfig: liveSalaryPolicy,
    period,
  })
  const base = snapshot?.homeSnapshot?.baseSalary ?? estimatedHomeBase
  const supportHourlyPay = (snapshot?.supportSnapshot?.hourlyPay || 0) + uncoveredSupportTotals.hourlyPay
  const supportAllowance = (snapshot?.supportSnapshot?.allowance || 0) + uncoveredSupportTotals.allowance
  const supportPay = (snapshot?.supportSnapshot?.pay || 0) + uncoveredSupportTotals.actualPay
  const supportHours = (snapshot?.supportSnapshot?.hours || 0) + uncoveredSupportTotals.hours
  const explicitHourlyRate = Number(displayedSalaryPolicy?.standardHourlyRateVnd || snapshotSalary?.hourlyRate || getHourlyRate(employee || {}))
  const configuredHourlyRate = explicitHourlyRate > 0
    ? explicitHourlyRate
    : Number(employee?.requiredMonthlyHours) > 0
      ? Math.floor(getMonthlySalary(employee || {}) / Number(employee.requiredMonthlyHours))
      : 0
  const adjustments = salaryAdjustments.filter((item) => employeeOwnsReference(item.employeeId) && item.period === period && item.status !== 'Đã hủy')
  const bonus = adjustments.filter((item) => item.type === 'Thưởng khác').reduce((sum, item) => sum + Number(item.amount || 0), 0)
  const allowance = adjustments.filter((item) => item.type === 'Phụ cấp khác').reduce((sum, item) => sum + Number(item.amount || 0), 0)
  const deductions = adjustments.filter((item) => item.type === 'Khấu trừ').reduce((sum, item) => sum + Number(item.amount || 0), 0)
  const tiktok = Number(employee?.tiktokAllowance || 0)
  const estimatedHomeGross = Math.max(0, base + bonus + allowance + tiktok - deductions)
  const gross = (snapshot?.homeSnapshot?.gross ?? estimatedHomeGross) + supportPay
  const estimatedAdvances = salaryAdvances.filter((item) => employeeOwnsReference(item.employeeId) && item.period === period && item.status === 'Đã chi').reduce((sum, item) => sum + Number(item.amount || 0), 0)
  const advances = snapshot?.homeSnapshot?.advancesPaid ?? estimatedAdvances
  const net = Math.max(0, gross - advances)
  const payrollEstimateUnavailable = Boolean(salaryPolicyError && !snapshot?.homeSnapshot)
  const payrollMoney = (value) => payrollEstimateUnavailable ? '—' : money(value)
  const stats = rows.reduce((value, record) => {
    const label = statusLabel(record.arrivalTag || record.status)
    if (label === 'Đi sớm') value.early += 1
    if (label === 'Đi đúng giờ') value.onTime += 1
    if (label === 'Đi trễ') value.late += 1
    value.earlyMinutes += attendanceEarlyMinutes(record)
    value.lateMinutes += attendanceLateMinutes(record)
    return value
  }, { early: 0, onTime: 0, late: 0, earlyMinutes: 0, lateMinutes: 0 })
  const onTimeRate = rows.length ? (stats.onTime / rows.length) * 100 : 0
  const evaluation = stats.late === 0 ? 'Chuyên cần tốt' : stats.late >= 3 || stats.lateMinutes >= 30 ? 'Cần cải thiện' : 'Cần duy trì'

  return (
    <div className="page">
      <PageHeader title="BẢNG LƯƠNG CỦA TÔI" subtitle="Dữ liệu cá nhân theo kỳ; các kỳ đã khóa dùng đúng bản chụp lương và chính sách." icon={Wallet} actions={<Select value={period} onChange={(event) => setPeriod(event.target.value)}><option value={period}>{periodLabel(period)}</option>{periods.filter((item) => item !== period).map((item) => <option key={item} value={item}>{periodLabel(item)}</option>)}</Select>} />
      {salaryPolicyError && <InfoNote tone="red">{snapshot?.identifierCollision
        ? 'Kỳ lương đang có nhiều bản ghi trùng mã cửa hàng khi không phân biệt chữ hoa/thường. Hệ thống đã khóa toàn bộ số tiền để tránh hiển thị sai; vui lòng báo Admin xử lý dữ liệu.'
        : 'Mã cấu hình lương đang trùng hoa/thường. Hệ thống đã khóa phần tạm tính của kỳ chưa chốt để tránh hiển thị sai; vui lòng báo Admin xử lý dữ liệu.'}</InfoNote>}
      <div className="metric-grid metric-grid--four">
        <MetricCard label="LƯƠNG CỨNG" value={payrollMoney(base)} helper={payrollEstimateUnavailable ? 'Chờ Admin xử lý dữ liệu trùng' : displayedSalaryPolicy ? `${hours.toFixed(2)} giờ · Đến ${displayedSalaryPolicy.thresholdHours} giờ: ${money(displayedSalaryPolicy.standardHourlyRateVnd)}/giờ · Vượt: ${money(displayedSalaryPolicy.excessHourlyRateVnd)}/giờ` : effectiveBasis === 'hourly' ? `${hours.toFixed(2)} giờ × ${money(explicitHourlyRate)}` : usesMonthlyHoursFormula(snapshotSalary || employee || {}) ? `${hours.toFixed(2)} / ${(snapshotSalary || employee).requiredMonthlyHours} giờ × ${money((snapshotSalary || employee).baseSalary || getMonthlySalary(snapshotSalary || employee || {}))}` : 'Theo mức lương tháng'} icon={Banknote} tone="blue" />
        <MetricCard label="LƯƠNG CA HỖ TRỢ" value={payrollMoney(supportPay)} helper={payrollEstimateUnavailable ? 'Tổng thu nhập tạm thời không khả dụng' : `${supportHours.toFixed(2)} giờ hỗ trợ • Gồm phụ cấp ${money(supportAllowance)}`} icon={CheckCircle2} tone="green" />
        <MetricCard label="ĐÃ ỨNG" value={payrollMoney(advances)} icon={Wallet} tone="orange" />
        <MetricCard label="THỰC NHẬN" value={payrollMoney(net)} helper={payrollEstimateUnavailable ? 'Không hiển thị số tạm tính có thể sai' : snapshot ? snapshot.statuses.join(' • ') : 'Tạm tính'} icon={Banknote} tone="green" />
      </div>
      <Card title="Chi tiết thu nhập">
        <div className="payroll-breakdown">
          <p><span>Lương cứng ({hours.toFixed(2)} giờ tại cửa hàng chính)</span><strong>{payrollMoney(base)} {!payrollEstimateUnavailable && <small className="table-note">Mức cài đặt {money(configuredHourlyRate)}/giờ</small>}</strong></p>
          <p><span>Lương theo giờ các ca hỗ trợ</span><strong>{payrollMoney(supportHourlyPay)}</strong></p>
          <p><span>Phụ cấp các ca hỗ trợ</span><strong>{payrollMoney(supportAllowance)}</strong></p>
          <p><span>Thưởng khác</span><strong>{payrollMoney(bonus)}</strong></p>
          <p><span>Phụ cấp TikTok (một lần trong tháng)</span><strong>{payrollMoney(tiktok)}</strong></p>
          <p><span>Phụ cấp khác</span><strong>{payrollMoney(allowance)}</strong></p>
          <p><span>Khấu trừ</span><strong>{payrollEstimateUnavailable ? '—' : `- ${money(deductions)}`}</strong></p>
          <p><span>Tổng thu nhập trước ứng lương</span><strong>{payrollMoney(gross)}</strong></p>
          <p><span>Đã ứng</span><strong>{payrollEstimateUnavailable ? '—' : `- ${money(advances)}`}</strong></p>
          <p className="total"><span>Thực nhận</span><strong>{payrollMoney(net)}</strong></p>
        </div>
      </Card>
      <Card title="Chi tiết ca hỗ trợ trong kỳ">
        {supportDetails.length ? <TableWrap><thead><tr><th>Ngày</th><th>Cửa hàng hỗ trợ</th><th>Thời gian hỗ trợ</th><th>Giờ làm thực tế</th><th>Lương hỗ trợ/giờ</th><th>Tiền lương</th><th>Phụ cấp</th><th>Thực nhận</th></tr></thead><tbody>{supportDetails.map((item) => <tr key={item.key}><td><strong>{shortDate(item.date)}</strong></td><td><Badge tone="orange">{item.destinationStoreName}</Badge></td><td>{item.timeLabel}<small className="table-note">{item.shiftLabel}</small></td><td>{item.hours.toFixed(2)} giờ</td><td>{payrollEstimateUnavailable ? '—' : `${money(item.hourlyRate)}/giờ`}</td><td>{payrollMoney(item.hourlyPay)}</td><td>{payrollMoney(item.allowance)}</td><td><strong className={payrollEstimateUnavailable ? undefined : 'green-text'}>{payrollMoney(item.actualPay)}</strong></td></tr>)}</tbody></TableWrap> : <EmptyState title="Không có ca hỗ trợ" description="Kỳ lương này không có ca làm việc tại cửa hàng hỗ trợ." />}
      </Card>
      <Card title="Thống kê chuyên cần">
        <TableWrap><thead><tr><th>Đi sớm</th><th>Đi đúng giờ</th><th>Đi trễ</th><th>Tổng phút sớm</th><th>Tổng phút trễ</th><th>Tổng ca</th><th>Tỷ lệ đúng giờ</th><th>Đánh giá</th></tr></thead><tbody><tr><td className="green-text"><strong>{stats.early}</strong></td><td className="blue-text"><strong>{stats.onTime}</strong></td><td className="red-text"><strong>{stats.late}</strong></td><td>{stats.earlyMinutes}</td><td>{stats.lateMinutes}</td><td>{rows.length}</td><td>{onTimeRate.toFixed(1)}%</td><td><Badge tone={evaluation === 'Chuyên cần tốt' ? 'green' : evaluation === 'Cần cải thiện' ? 'red' : 'orange'}>{evaluation}</Badge></td></tr></tbody></TableWrap>
      </Card>
      {snapshot && !snapshot.identifierCollision && <InfoNote tone={snapshot.locked ? 'orange' : 'green'}>Kỳ {periodLabel(period)} đã tổng hợp {snapshot.rows.length} bản ghi lương từ cửa hàng chính và cửa hàng hỗ trợ{snapshot.closedAt ? ` lúc ${timestamp(snapshot.closedAt)}` : ''}. Trạng thái: <strong>{snapshot.statuses.join(' • ')}</strong>.</InfoNote>}
    </div>
  )
}
