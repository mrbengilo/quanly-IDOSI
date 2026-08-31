import { useEffect, useMemo, useState } from 'react'
import {
  Banknote,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Fingerprint,
  LogOut,
  MapPin,
  Wallet,
} from 'lucide-react'
import {
  Badge,
  Button,
  Card,
  Field,
  InfoNote,
  Input,
  MetricCard,
  PageHeader,
  Select,
  TableFooter,
  TableWrap,
} from '../../components/UI'
import { useApp } from '../../state/AppContext'
import {
  reconcileAttendanceShiftId,
  resolveAttendanceWorkingTime,
} from '../../domain/attendanceWorkingTime'
import {
  money,
  operationalIdentifierRecordMatch,
  sameOperationalIdentifier,
  shortDate,
} from '../../utils'
import { normalizeWorkingTimeForm } from '../office/workingTime'
import {
  officeArrivalMinutes,
  officeArrivalStatus,
  officeAdjustmentTotals,
  officeAttendanceRows,
  officeAttendanceStats,
  officeEmployeeKey,
  officeLocationLabel,
  officePayrollStoreId,
  officePayrollSummary,
  officeRecordDate,
  officeSalaryAdjustments,
} from './officeAttendance'

const VN_TIME_ZONE = 'Asia/Ho_Chi_Minh'

const vietnamDateKey = (date = new Date()) => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: VN_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date).map((part) => [part.type, part.value]))
  return `${parts.year}-${parts.month}-${parts.day}`
}

const vietnamClock = (date) => date.toLocaleTimeString('vi-VN', {
  timeZone: VN_TIME_ZONE,
  hourCycle: 'h23',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
})

const vietnamLongDate = (date) => shortDate(vietnamDateKey(date))

const timeOnly = (value) => {
  if (!value) return '—'
  const match = String(value).match(/(?:T|\s|^)(\d{1,2}):(\d{2})(?::(\d{2}))?/u)
  if (!match) return String(value)
  return `${String(match[1]).padStart(2, '0')}:${match[2]}${match[3] ? `:${match[3]}` : ''}`
}

const workedHours = (record = {}) => {
  const explicit = Number(record.hours ?? record.workHours)
  if (Number.isFinite(explicit) && explicit >= 0) return explicit
  const startedAt = Date.parse(record.checkInAt || '')
  const finishedAt = Date.parse(record.checkOutAt || '')
  return Number.isFinite(startedAt) && Number.isFinite(finishedAt) && finishedAt >= startedAt
    ? (finishedAt - startedAt) / 3_600_000
    : 0
}

const employeeIdentifier = (employee) => String(
  employee?.id || employee?.code || employee?.employeeCode || employee?.employeeId || '',
)
const employeeAliases = (employee) => [employee?.id, employee?.code, employee?.employeeId, employee?.employeeCode]
  .map((value) => String(value || '').trim())
  .filter(Boolean)
const employeeRecordAliases = (record) => [record?.employeeId, record?.employeeCode, record?.staffId, record?.userId]
  .map((value) => String(value || '').trim())
  .filter(Boolean)

const currentOfficeEmployee = (app) => {
  const session = app.session || {}
  const employees = Array.isArray(app.employees) ? app.employees : []
  const references = [employeeIdentifier(app.currentEmployee), session.employeeId, session.code, session.id]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
  for (const reference of references) {
    const resolution = operationalIdentifierRecordMatch(employees, reference, employeeAliases)
    if (resolution.record) return resolution.record
    if (resolution.ambiguous) return {}
  }
  if (session.username) {
    const usernameMatches = employees.filter((employee) => employee.username === session.username)
    if (usernameMatches.length === 1) return usernameMatches[0]
    if (usernameMatches.length > 1) return {}
  }
  return employees.length ? {} : (app.currentEmployee || session)
}

const employeeReferenceMatches = (employees, employee, reference) => {
  if (!employee || !String(reference || '').trim()) return false
  const source = Array.isArray(employees) && employees.length ? employees : [employee]
  const resolution = operationalIdentifierRecordMatch(source, reference, employeeAliases)
  return !resolution.ambiguous && resolution.record === employee
}

const recordReferencesEmployee = (employees, employee, record) => (
  employeeRecordAliases(record).some((reference) => employeeReferenceMatches(employees, employee, reference))
)

const recordMatchForAliases = (records, references, identifierValuesOf) => {
  const aliases = references.map((value) => String(value || '').trim()).filter(Boolean)
  const exactMatches = records.filter((record) => identifierValuesOf(record).some((value) => (
    aliases.includes(String(value || '').trim())
  )))
  if (exactMatches.length) return {
    record: exactMatches.length === 1 ? exactMatches[0] : null,
    ambiguous: exactMatches.length > 1,
  }
  const foldedMatches = records.filter((record) => identifierValuesOf(record).some((value) => (
    aliases.some((alias) => sameOperationalIdentifier(alias, value))
  )))
  return {
    record: foldedMatches.length === 1 ? foldedMatches[0] : null,
    ambiguous: foldedMatches.length > 1,
  }
}

const payrollRowForEmployee = (rows, employees, employee) => {
  const matches = (Array.isArray(rows) ? rows : []).filter((row) => (
    recordReferencesEmployee(employees, employee, row)
  ))
  return recordMatchForAliases(matches, employeeAliases(employee), employeeRecordAliases)
}

const requestLocation = () => new Promise((resolve, reject) => {
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
    (error) => {
      const messages = {
        1: 'Bạn cần bật và cấp quyền vị trí để chấm công.',
        2: 'Không thể xác định vị trí hiện tại. Vui lòng thử lại.',
        3: 'Yêu cầu lấy vị trí đã hết thời gian. Vui lòng thử lại.',
      }
      reject(new Error(messages[error.code] || 'Không thể lấy vị trí chấm công.'))
    },
    { enableHighAccuracy: true, timeout: 12_000, maximumAge: 0 },
  )
})

const statusTone = (label) => label === 'Đi trễ' ? 'red' : label === 'Đi sớm' ? 'green' : label === 'Đi đúng giờ' ? 'blue' : 'orange'
const ratingTone = (label) => label === 'Chuyên cần tốt' ? 'green' : label === 'Cần cải thiện' ? 'red' : label === 'Cần duy trì' ? 'orange' : 'blue'

const attendanceRoleDetails = (session = {}, employee = {}) => {
  const role = session?.role === 'manager' ? 'business_support' : session?.role
  if (role === 'business_support' || employee.unit === 'business_support') {
    return {
      isOperationalRole: true,
      title: 'TỔNG QUAN NHÂN VIÊN HỖ TRỢ KD',
      unitLabel: 'Nhân viên hỗ trợ KD',
      defaultPosition: 'NV hỗ trợ KD',
    }
  }
  if (role === 'store_manager' || employee.unit === 'store_manager') {
    return {
      isOperationalRole: true,
      title: 'TỔNG QUAN QUẢN LÝ CỬA HÀNG',
      unitLabel: 'Quản lý cửa hàng',
      defaultPosition: 'Quản lý cửa hàng',
    }
  }
  return {
    isOperationalRole: false,
    title: 'NHÂN VIÊN VĂN PHÒNG',
    unitLabel: 'Văn Phòng',
    defaultPosition: 'Khối Văn Phòng',
  }
}

function OfficePayrollCard({ app, employee, period, rows, showHeader = false, onPeriodChange }) {
  const isBusinessSupport = app.session?.role === 'business_support' || employee.unit === 'business_support'
  const payrollStoreId = officePayrollStoreId(app.session, employee)
  const currentMonth = vietnamDateKey().slice(0, 7)
  const activePeriodCandidates = (Array.isArray(app.payrollPeriods) ? app.payrollPeriods : []).filter((item) => (
    !item.supersededAt
    && String(item.period || '') === period
  ))
  const activePeriodMatch = operationalIdentifierRecordMatch(
    activePeriodCandidates,
    payrollStoreId,
    (item) => item.storeId,
  )
  const payrollPeriodUnavailable = activePeriodMatch.ambiguous
  const closedPeriod = activePeriodMatch.record && !activePeriodMatch.record.needsReclose
    ? activePeriodMatch.record
    : null
  const closedPayrollRowMatch = payrollRowForEmployee(closedPeriod?.rows, app.employees, employee)
  const payrollRowUnavailable = closedPayrollRowMatch.ambiguous
  const payrollDataUnavailable = payrollPeriodUnavailable || payrollRowUnavailable
  const closedPayrollRow = payrollRowUnavailable ? null : closedPayrollRowMatch.record
  const summary = officePayrollSummary({
    records: rows,
    employee,
    period,
    historical: period < currentMonth,
    payrollRow: closedPayrollRow,
  })
  const scopedSalaryAdjustments = (Array.isArray(app.salaryAdjustments) ? app.salaryAdjustments : []).filter((item) => (
    recordReferencesEmployee(app.employees, employee, item)
  )).map((item) => ({ ...item, employeeId: officeEmployeeKey(employee) }))
  const scopedLegacyAdjustments = (Array.isArray(app.officeAdjustments) ? app.officeAdjustments : []).filter((item) => (
    recordReferencesEmployee(app.employees, employee, item)
  )).map((item) => ({ ...item, employeeId: officeEmployeeKey(employee) }))
  const extras = officeSalaryAdjustments({
    salaryAdjustments: scopedSalaryAdjustments,
    legacyAdjustments: scopedLegacyAdjustments,
    employeeId: officeEmployeeKey(employee),
    period,
  })
  const adjustmentTotals = officeAdjustmentTotals(extras)
  const total = summary.authoritative ? summary.gross : Math.max(0, summary.basePay + adjustmentTotals.net)
  const progress = Math.min(100, summary.ratio * 100)

  return (
    <section className={showHeader ? 'office-payroll-page-section' : ''} aria-labelledby="office-payroll-title">
      {showHeader && (
        <PageHeader
          title={isBusinessSupport ? 'BẢNG LƯƠNG HỖ TRỢ KINH DOANH CỦA TÔI' : 'BẢNG LƯƠNG VĂN PHÒNG CỦA TÔI'}
          subtitle="Lương tỷ lệ theo số ngày làm thực tế và ngày công chuẩn do Admin thiết lập."
          icon={Wallet}
          actions={<Field label="Tháng lương"><Input type="month" value={period} onChange={(event) => onPeriodChange?.(event.target.value)} /></Field>}
        />
      )}
      <Card title="Bảng lương theo ngày công">
        {payrollPeriodUnavailable && <InfoNote tone="red">Kỳ lương có nhiều bản ghi trùng mã cửa hàng. Số tiền đã được khóa cho đến khi Admin xử lý dữ liệu trùng.</InfoNote>}
        {payrollRowUnavailable && <InfoNote tone="red">Kỳ lương có nhiều dòng trùng mã nhân viên. Số tiền đã được khóa cho đến khi Admin xử lý dữ liệu trùng.</InfoNote>}
        <div className="metric-grid metric-grid--four">
          <MetricCard label="NGÀY LÀM THỰC TẾ" value={summary.actualDays} suffix="ngày" helper={`Quy định ${summary.requiredDays} ngày`} icon={CalendarDays} tone="blue" compact />
          <MetricCard label="LƯƠNG THÁNG" value={payrollDataUnavailable ? '—' : money(summary.monthlySalary)} helper={payrollDataUnavailable ? 'Chờ Admin xử lý dữ liệu trùng' : summary.requiredDaysSource === 'closed-payroll' ? 'Theo kỳ lương đã chốt' : summary.requiredDaysSource === 'snapshot' ? 'Theo snapshot kỳ lương' : summary.requiredDaysSource === 'monthly-target' ? `Mục tiêu riêng tháng ${period.split('-').reverse().join('/')}` : 'Mức lương hiện tại'} icon={Banknote} tone="blue" compact />
          <MetricCard label="LƯƠNG THEO CÔNG" value={payrollDataUnavailable ? '—' : money(summary.basePay)} helper={`${summary.payableDays}/${summary.requiredDays} ngày công`} icon={Clock3} tone="green" compact />
          <MetricCard label={summary.authoritative ? 'TỔNG ĐÃ CHỐT' : 'TỔNG TẠM TÍNH'} value={payrollDataUnavailable ? '—' : money(total)} helper={payrollDataUnavailable ? 'Không hiển thị số tạm tính có thể sai' : summary.authoritative ? `Kỳ lương ${closedPeriod.status || 'đã chốt'}` : `Điều chỉnh ròng ${money(adjustmentTotals.net)}`} icon={Wallet} tone="green" compact />
        </div>
        <div className="office-payroll-progress" aria-label={`Tiến độ ngày công ${progress.toFixed(0)}%`}>
          <div><span>Tiến độ ngày công</span><strong>{summary.actualDays}/{summary.requiredDays} ngày</strong></div>
          <progress value={summary.payableDays} max={summary.requiredDays}>{progress.toFixed(0)}%</progress>
          <small>{summary.authoritative ? 'Số liệu lấy từ kỳ lương đã chốt trên máy chủ.' : `Lương theo công = Lương tháng ÷ ${summary.requiredDays} × ${summary.payableDays} ngày thực tế.`}</small>
        </div>
        <TableWrap>
          <thead><tr><th>Kỳ lương</th><th>Ngày thực tế / quy định</th><th>Lương theo công</th><th>Thưởng</th><th>Phụ cấp</th><th>Khấu trừ</th><th>{summary.authoritative ? 'Tổng đã chốt' : 'Tổng tạm tính'}</th></tr></thead>
          <tbody><tr><td><strong>{period.split('-').reverse().join('/')}</strong></td><td>{summary.actualDays} / {summary.requiredDays} ngày</td><td>{payrollDataUnavailable ? '—' : money(summary.basePay)}</td><td>{payrollDataUnavailable ? '—' : money(adjustmentTotals.bonus)}</td><td>{payrollDataUnavailable ? '—' : money(adjustmentTotals.allowance)}</td><td>{payrollDataUnavailable ? '—' : money(adjustmentTotals.deduction)}</td><td className="green-text"><strong>{payrollDataUnavailable ? '—' : money(total)}</strong></td></tr></tbody>
        </TableWrap>
      </Card>
    </section>
  )
}

export function OfficeEmployeeDashboard() {
  const app = useApp()
  const employee = currentOfficeEmployee(app)
  const roleDetails = attendanceRoleDetails(app.session, employee)
  const { isOperationalRole, title, unitLabel, defaultPosition } = roleDetails
  const employeeId = officeEmployeeKey(employee)
  const [now, setNow] = useState(() => new Date())
  const [filterMode, setFilterMode] = useState('month')
  const [filterValue, setFilterValue] = useState(() => vietnamDateKey().slice(0, 7))
  const [busy, setBusy] = useState('')
  const [locationError, setLocationError] = useState('')
  const dateKey = vietnamDateKey(now)
  const employeeSchedules = useMemo(() => (
    (Array.isArray(app.supportWorkSchedules) ? app.supportWorkSchedules : [])
      .filter((record) => recordReferencesEmployee(app.employees, employee, record))
      .map((record) => ({ ...record, employeeId }))
  ), [app.employees, app.supportWorkSchedules, employee, employeeId])
  const effectiveEmployee = useMemo(
    () => resolveAttendanceWorkingTime(employee, dateKey, employeeSchedules),
    [dateKey, employee, employeeSchedules],
  )
  const attendanceWorkShifts = useMemo(
    () => normalizeWorkingTimeForm(effectiveEmployee, effectiveEmployee.employmentType || employee.employmentType).workShifts,
    [effectiveEmployee, employee.employmentType],
  )
  const [requestedShiftId, setRequestedShiftId] = useState(() => reconcileAttendanceShiftId(attendanceWorkShifts))
  const selectedShiftId = reconcileAttendanceShiftId(attendanceWorkShifts, requestedShiftId)

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1_000)
    return () => window.clearInterval(timer)
  }, [])

  const allRows = useMemo(() => officeAttendanceRows(
    (Array.isArray(app.attendance) ? app.attendance : []).filter((record) => (
      recordReferencesEmployee(app.employees, employee, record)
    )).map((record) => ({ ...record, employeeId })),
    employee,
  ), [app.attendance, app.employees, employee, employeeId])
  const openRecord = allRows.find((record) => !record.checkOut && !record.checkOutAt)
  const todayRecord = allRows.find((record) => officeRecordDate(record) === dateKey)
  const selectedMonth = (filterMode === 'month' ? filterValue : filterValue.slice(0, 7)) || dateKey.slice(0, 7)
  const filteredRows = allRows.filter((record) => filterMode === 'day'
    ? officeRecordDate(record) === filterValue
    : officeRecordDate(record).startsWith(filterValue))
  const monthRows = allRows.filter((record) => officeRecordDate(record).startsWith(selectedMonth))
  const stats = officeAttendanceStats(filteredRows, app.policies?.attendanceEvaluation)
  const selectedShift = attendanceWorkShifts.find((shift) => shift.id === selectedShiftId)
    || (attendanceWorkShifts.length === 1 ? attendanceWorkShifts[0] : null)
  const effectiveShiftId = selectedShift?.id || ''

  const changeFilterMode = (mode) => {
    setFilterMode(mode)
    setFilterValue(mode === 'day' ? dateKey : dateKey.slice(0, 7))
  }

  const runLocatedAction = async (action) => {
    setLocationError('')
    if (!employeeId) {
      const message = `Tài khoản chưa được liên kết với hồ sơ nhân viên ${unitLabel}.`
      setLocationError(message)
      app.notify?.(message, 'info')
      return
    }
    if (action === 'in' && !effectiveShiftId) {
      const message = attendanceWorkShifts.length
        ? 'Vui lòng chọn ca làm việc trước khi điểm danh.'
        : `Hồ sơ nhân viên ${unitLabel} chưa có thời gian làm việc hợp lệ.`
      setLocationError(message)
      app.notify?.(message, 'info')
      return
    }
    setBusy(action)
    try {
      const location = await requestLocation()
      const result = action === 'in'
        ? await app.checkIn?.({
          employeeId,
          date: dateKey,
          shiftId: effectiveShiftId,
          workShiftId: effectiveShiftId,
          shiftName: selectedShift?.name || `Giờ làm ${unitLabel}`,
          shiftStart: selectedShift?.start || effectiveEmployee.workStart || '08:00',
          shiftEnd: selectedShift?.end || effectiveEmployee.workEnd || '17:00',
          location,
          idempotencyKey: `office-attendance-in:${employeeId}:${dateKey}`,
        })
        : await app.checkOut?.({
          employeeId,
          location,
          attendanceId: openRecord?.id,
          idempotencyKey: `office-attendance-out:${openRecord?.id || employeeId}`,
        })
      if (!result?.ok) throw new Error(result?.message || 'Không thể lưu thông tin chấm công.')
    } catch (error) {
      const message = error?.message || 'Không thể lấy vị trí chấm công.'
      setLocationError(message)
      app.notify?.(message, 'info')
    } finally {
      setBusy('')
    }
  }

  const todayStatus = todayRecord ? officeArrivalStatus(todayRecord) : 'Chưa điểm danh'

  return (
    <div className="page office-employee-dashboard">
      <PageHeader title={title} subtitle={`${employee.name || 'Nhân viên'} • ${employee.position || defaultPosition}`} icon={Fingerprint} />

      <div className="office-attendance-hero">
        <Card className="office-live-clock">
          <div className="office-live-clock__icon"><Clock3 aria-hidden="true" /></div>
          <div aria-live="off">
            <span>THỜI GIAN HIỆN TẠI</span>
            <strong>{vietnamClock(now)}</strong>
            <p><CalendarDays aria-hidden="true" /> {vietnamLongDate(now)}</p>
          </div>
        </Card>
        <Card className="office-attendance-action">
          <div className="office-attendance-action__heading">
            <div><span>CHẤM CÔNG HÔM NAY</span><strong>{selectedShift?.name || (attendanceWorkShifts.length > 1 ? 'Chọn ca làm việc' : `Giờ làm ${unitLabel}`)}</strong><small>{selectedShift ? `${selectedShift.start} – ${selectedShift.end}` : attendanceWorkShifts.length > 1 ? '—' : `${effectiveEmployee.workStart || '08:00'} – ${effectiveEmployee.workEnd || '17:00'}`}</small></div>
            <Badge tone={statusTone(todayStatus)}>{todayStatus}</Badge>
          </div>
          {attendanceWorkShifts.length > 1 && !todayRecord && <Field label="Chọn ca làm việc" required>
            <Select value={selectedShiftId} onChange={(event) => setRequestedShiftId(event.target.value)} aria-label="Chọn ca làm việc để điểm danh">
              <option value="">Chọn ca làm việc</option>
              {attendanceWorkShifts.map((shift) => <option key={shift.id} value={shift.id}>{shift.name} · {shift.start}–{shift.end}</option>)}
            </Select>
          </Field>}
          <div className="office-attendance-action__times">
            <p><span>Giờ vào</span><strong>{timeOnly(todayRecord?.checkIn || todayRecord?.checkInAt)}</strong></p>
            <p><span>Giờ ra</span><strong>{timeOnly(todayRecord?.checkOut || todayRecord?.checkOutAt)}</strong></p>
          </div>
          <div className="card-actions">
            <Button icon={Fingerprint} loading={busy === 'in'} disabled={Boolean(openRecord || todayRecord?.checkOut || busy || !effectiveShiftId)} onClick={() => runLocatedAction('in')}>BẤM ĐIỂM DANH</Button>
            <Button variant="danger" icon={LogOut} loading={busy === 'out'} disabled={!openRecord || Boolean(busy)} onClick={() => runLocatedAction('out')}>RA VỀ</Button>
          </div>
          <small className="office-location-hint"><MapPin aria-hidden="true" /> Hệ thống chỉ ghi nhận sau khi bạn chủ động bật và cho phép truy cập vị trí.</small>
        </Card>
      </div>

      {locationError && <div role="alert"><InfoNote tone="orange">{locationError}</InfoNote></div>}

      <Card className="filter-card" title="Bộ lọc chấm công">
        <div className="office-attendance-filters">
          <Field label="Xem theo">
            <Select value={filterMode} onChange={(event) => changeFilterMode(event.target.value)}>
              <option value="day">Ngày</option>
              <option value="month">Tháng</option>
            </Select>
          </Field>
          <Field label={filterMode === 'day' ? 'Chọn ngày' : 'Chọn tháng'}>
            <Input type={filterMode === 'day' ? 'date' : 'month'} value={filterValue} onChange={(event) => setFilterValue(event.target.value)} />
          </Field>
          <InfoNote>Dữ liệu chỉ hiển thị cho tài khoản <strong>{employee.name || employeeId || 'hiện tại'}</strong>.</InfoNote>
        </div>
      </Card>

      <div className="metric-grid metric-grid--five">
        <MetricCard label="ĐI SỚM" value={stats.early} helper={`${stats.earlyMinutes} phút đi sớm`} icon={CheckCircle2} tone="green" compact />
        <MetricCard label="ĐÚNG GIỜ" value={stats.onTime} helper={`${stats.onTimeRate.toFixed(1)}% không trễ`} icon={CheckCircle2} tone="blue" compact />
        <MetricCard label="ĐI TRỄ" value={stats.late} helper={`${stats.lateMinutes} phút đi trễ`} icon={Clock3} tone="red" compact />
        <MetricCard label="TỔNG LƯỢT" value={stats.total} helper={filterMode === 'day' ? 'Trong ngày đã chọn' : 'Trong tháng đã chọn'} icon={CalendarDays} tone="blue" compact />
        <MetricCard label="CHUYÊN CẦN" value={stats.rating} helper={`${stats.onTimeRate.toFixed(1)}% đi sớm/đúng giờ`} icon={Fingerprint} tone={ratingTone(stats.rating)} compact />
      </div>

      <Card title="Lịch sử chấm công chi tiết">
        <TableWrap>
          <thead><tr><th>Ngày</th><th>Ca / giờ quy định</th><th>Giờ vào</th><th>Trạng thái</th><th>Số phút</th><th>Vị trí vào</th><th>Giờ ra</th><th>Vị trí ra</th><th>Số giờ</th></tr></thead>
          <tbody>
            {filteredRows.map((record) => {
              const label = officeArrivalStatus(record)
              const minutes = officeArrivalMinutes(record)
              const difference = label === 'Đi sớm' ? `${minutes.earlyMinutes} phút sớm` : label === 'Đi trễ' ? `${minutes.lateMinutes} phút trễ` : 'Đúng quy định'
              return <tr key={record.id || `${officeRecordDate(record)}-${record.checkIn}`}><td><strong>{shortDate(officeRecordDate(record))}</strong></td><td>{record.shiftName || record.shift || `Ca ${unitLabel}`}<small className="table-note">{record.shiftStart || employee.workStart || '08:00'}–{record.shiftEnd || employee.workEnd || '17:00'}</small></td><td className="green-text"><strong>{timeOnly(record.checkIn || record.checkInAt)}</strong></td><td><Badge tone={statusTone(label)}>{label}</Badge></td><td>{difference}</td><td className="address-cell">{officeLocationLabel(record.checkInLocation || record.location)}</td><td><strong>{timeOnly(record.checkOut || record.checkOutAt)}</strong></td><td className="address-cell">{officeLocationLabel(record.checkOutLocation)}</td><td>{workedHours(record).toFixed(2)} giờ</td></tr>
            })}
            {!filteredRows.length && <tr><td colSpan="9">Chưa có lịch sử chấm công trong thời gian đã chọn.</td></tr>}
          </tbody>
        </TableWrap>
        <TableFooter shown={filteredRows.length} total={filteredRows.length} />
      </Card>

      {!isOperationalRole && <OfficePayrollCard app={app} employee={employee} period={selectedMonth} rows={monthRows} />}
    </div>
  )
}

export function OfficeEmployeePayrollPage() {
  const app = useApp()
  const employee = currentOfficeEmployee(app)
  const [period, setPeriod] = useState(() => vietnamDateKey().slice(0, 7))
  const allRows = useMemo(() => officeAttendanceRows(
    (Array.isArray(app.attendance) ? app.attendance : []).filter((record) => (
      recordReferencesEmployee(app.employees, employee, record)
    )).map((record) => ({ ...record, employeeId: officeEmployeeKey(employee) })),
    employee,
  ), [app.attendance, app.employees, employee])
  const rows = allRows.filter((record) => officeRecordDate(record).startsWith(period))
  const stats = officeAttendanceStats(rows, app.policies?.attendanceEvaluation)

  return (
    <div className="page office-employee-payroll">
      <OfficePayrollCard app={app} employee={employee} period={period} rows={rows} showHeader onPeriodChange={setPeriod} />
      <Card title="Đánh giá chuyên cần trong kỳ">
        <TableWrap>
          <thead><tr><th>Đi sớm</th><th>Đúng giờ</th><th>Đi trễ</th><th>Phút đi sớm</th><th>Phút đi trễ</th><th>Tỷ lệ không trễ</th><th>Đánh giá</th></tr></thead>
          <tbody><tr><td>{stats.early}</td><td>{stats.onTime}</td><td>{stats.late}</td><td>{stats.earlyMinutes}</td><td>{stats.lateMinutes}</td><td>{stats.onTimeRate.toFixed(1)}%</td><td><Badge tone={ratingTone(stats.rating)}>{stats.rating}</Badge></td></tr></tbody>
        </TableWrap>
      </Card>
    </div>
  )
}
