import { useState } from 'react'
import {
  Banknote,
  CalendarDays,
  Clock3,
  Fingerprint,
  Gift,
  LockKeyhole,
  LogOut,
  MapPin,
  Search,
  TrendingDown,
  TrendingUp,
  Wallet,
} from 'lucide-react'
import {
  Badge,
  Button,
  Card,
  DateRange,
  DonutChart,
  ExportButton,
  Field,
  InfoNote,
  Input,
  MetricCard,
  PageHeader,
  Select,
  TableFooter,
  TableWrap,
} from '../../components/UI'
import { shifts } from '../../data'
import { useApp } from '../../state/AppContext'
import {
  calculateEmployeeBasePay,
  downloadCsv,
  getEmployeeType,
  getHourlyRate,
  getMonthlySalary,
  getPayBasis,
  money,
  shortDate,
} from '../../utils'

const FALLBACK_SHIFT = { id: 'ca1', name: 'Ca 1', time: '07:00 - 12:00', start: '07:00', end: '12:00' }
const getShift = (id) => shifts.find((shift) => shift.id === id) || FALLBACK_SHIFT
const recordEmployeeId = (record = {}) => record.employeeId || record.employeeCode || record.staffId || record.userId || ''
const employeeId = (employee = {}) => employee.id || employee.code || employee.employeeCode || employee.employeeId || ''
const employeeType = getEmployeeType
const employeePosition = (employee = {}) => employee.position || employee.role || employee.jobTitle || 'Nhân viên'
const recordDate = (record = {}) => String(record.date || record.workDate || record.createdAt || '').slice(0, 10)

const parseRangeDate = (value) => {
  const text = String(value || '').trim()
  const isoMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`
  const localMatch = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (!localMatch) return ''
  return `${localMatch[3]}-${String(localMatch[2]).padStart(2, '0')}-${String(localMatch[1]).padStart(2, '0')}`
}

const dateRangeForRows = (rows = []) => {
  const dates = rows.map(recordDate).filter(Boolean).sort()
  if (!dates.length) return 'Tất cả thời gian'
  return `${shortDate(dates[0])} - ${shortDate(dates.at(-1))}`
}

const filterRowsByRange = (rows, value) => {
  const [fromText, toText] = String(value || '').split(/\s+-\s+/)
  const from = parseRangeDate(fromText)
  const to = parseRangeDate(toText || fromText)
  if (!from || !to) return rows
  return rows.filter((row) => {
    const date = recordDate(row)
    return date >= from && date <= to
  })
}

const localDateIso = () => {
  const date = new Date()
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const formatTime = (value) => {
  if (!value) return '—'
  if (typeof value === 'object') return formatTime(value.time || value.timestamp || value.capturedAt)
  const text = String(value)
  if (!text.includes('T')) return text.slice(0, 8)
  const date = new Date(text)
  return Number.isNaN(date.getTime()) ? text : date.toLocaleTimeString('vi-VN', { hour12: false })
}

const timeToMinutes = (value) => {
  const match = formatTime(value).match(/^(\d{1,2}):(\d{2})/)
  return match ? Number(match[1]) * 60 + Number(match[2]) : null
}

const workedHours = (record) => {
  const explicit = Number(record.hours ?? record.workHours)
  if (Number.isFinite(explicit) && explicit >= 0) return explicit
  const start = timeToMinutes(record.checkIn || record.checkInTime)
  const end = timeToMinutes(record.checkOut || record.checkOutTime)
  return start != null && end != null ? Math.max(0, (end - start) / 60) : 0
}

const findCurrentEmployee = (app) => {
  const session = app.session || {}
  const employees = Array.isArray(app.employees) ? app.employees : []
  const keys = [session.employeeId, session.code, session.id].filter(Boolean).map(String)
  const found = employees.find((employee) => keys.includes(String(employeeId(employee))) || (
    session.username && employee.username === session.username
  ))
  return found ? { ...session, ...found } : session
}

const attendanceForEmployee = (attendance, employee) => {
  const key = String(employeeId(employee))
  if (!key) return []
  return attendance.filter((record) => String(recordEmployeeId(record)) === key)
}

const isOffice = (employee, session) => employee?.unit === 'office' || session?.unit === 'office' || employee?.department === 'office'

const locationLabel = (location) => {
  if (!location) return '—'
  if (typeof location === 'string') return location
  if (location.address || location.label) return location.address || location.label
  const latitude = Number(location.latitude ?? location.lat)
  const longitude = Number(location.longitude ?? location.lng ?? location.lon)
  if (Number.isFinite(latitude) && Number.isFinite(longitude)) return `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`
  return 'Đã ghi nhận vị trí'
}

const checkInStatus = (record, employee) => {
  const provided = record.checkInStatus || record.arrivalTag || record.punctuality || record.status
  if (provided && !['Hoàn thành', 'Đã chấm công'].includes(provided)) return provided
  const actual = timeToMinutes(record.checkIn || record.checkInTime)
  const expected = timeToMinutes(record.expectedStart || record.shiftStart || employee?.startTime || employee?.workStart || '08:00')
  if (actual == null || expected == null) return 'Chưa xác định'
  if (actual < expected) return 'Đi sớm'
  if (actual <= expected + 5) return 'Đúng giờ'
  return 'Đi trễ'
}

const checkOutStatus = (record, employee) => {
  const provided = record.checkOutStatus || record.departureTag || record.leavingStatus
  if (provided) return provided
  const actual = timeToMinutes(record.checkOut || record.checkOutTime)
  const expected = timeToMinutes(record.expectedEnd || record.shiftEnd || employee?.endTime || employee?.workEnd || '17:30')
  if (actual == null) return 'Chưa ra về'
  return actual < expected ? 'Về sớm' : 'Về đúng giờ'
}

const attendanceTone = (status) => {
  const normalized = String(status).toLowerCase()
  if (normalized.includes('trễ') || normalized.includes('sớm') && normalized.includes('về')) return 'orange'
  if (normalized.includes('đúng')) return 'green'
  if (normalized.includes('đi sớm')) return 'blue'
  return 'orange'
}

const officeExtras = (app, employee) => {
  const key = String(employeeId(employee))
  const sources = [
    ['Thưởng', app.officeBonuses],
    ['Phụ cấp', app.officeAllowances],
    ['Thưởng', app.officeRewards],
    ['Khác', app.officeAdjustments],
    ['Khác', app.officeCompensations],
  ]
  return sources.flatMap(([fallbackType, records]) => (Array.isArray(records) ? records : []).map((record) => ({
    ...record,
    compensationType: record.type || record.kind || record.category || fallbackType,
  }))).filter((record) => String(recordEmployeeId(record)) === key)
}

function OfficeAttendanceHistory({ employee, rows }) {
  return (
    <Card title="LỊCH SỬ ĐIỂM DANH">
      <TableWrap>
        <thead><tr><th>Ngày</th><th>Giờ vào</th><th>Trạng thái vào</th><th>Vị trí vào</th><th>Giờ ra</th><th>Trạng thái ra</th><th>Vị trí ra</th><th>Số giờ</th></tr></thead>
        <tbody>
          {rows.map((row) => {
            const inStatus = checkInStatus(row, employee)
            const outStatus = checkOutStatus(row, employee)
            return <tr key={row.id || `${recordDate(row)}-${formatTime(row.checkIn)}`}>
              <td><strong>{shortDate(recordDate(row))}</strong></td>
              <td>{formatTime(row.checkIn || row.checkInTime)}</td>
              <td><Badge tone={attendanceTone(inStatus)}>{inStatus}</Badge></td>
              <td><MapPin size={14} /> {locationLabel(row.checkInLocation || row.locationIn || row.location)}</td>
              <td>{formatTime(row.checkOut || row.checkOutTime)}</td>
              <td><Badge tone={attendanceTone(outStatus)}>{outStatus}</Badge></td>
              <td><MapPin size={14} /> {locationLabel(row.checkOutLocation || row.locationOut)}</td>
              <td>{workedHours(row).toFixed(2)} giờ</td>
            </tr>
          })}
          {!rows.length && <tr><td colSpan="8">Chưa có lịch sử điểm danh.</td></tr>}
        </tbody>
      </TableWrap>
      <TableFooter shown={rows.length} total={rows.length} />
    </Card>
  )
}

function OfficePayrollSummary({ app, employee, rows, withHeader = false, period = 'all', periods = [], onPeriodChange }) {
  const workingDays = new Set(rows.filter((row) => row.checkIn || row.checkInTime).map(recordDate)).size
  const totalHours = rows.reduce((total, row) => total + workedHours(row), 0)
  const monthlySalary = getMonthlySalary(employee)
  const basePay = monthlySalary ? Math.round((monthlySalary / 26) * workingDays) : Math.round(totalHours * getHourlyRate(employee))
  const extras = officeExtras(app, employee).filter((item) => period === 'all' || recordDate(item).startsWith(period))
  const bonus = extras.filter((item) => String(item.compensationType).toLowerCase().includes('thưởng') || String(item.compensationType).toLowerCase().includes('bonus')).reduce((total, item) => total + (Number(item.amount ?? item.value) || 0), 0)
  const allowance = extras.filter((item) => String(item.compensationType).toLowerCase().includes('phụ cấp') || String(item.compensationType).toLowerCase().includes('allowance')).reduce((total, item) => total + (Number(item.amount ?? item.value) || 0), 0)
  const total = basePay + bonus + allowance
  return (
    <div className={withHeader ? 'page' : ''}>
      {withHeader && <PageHeader title="BẢNG LƯƠNG KHỐI VĂN PHÒNG" subtitle={`Thống kê thu nhập của ${employee.name || 'nhân viên'}.`} actions={<Select value={period} onChange={(event) => onPeriodChange?.(event.target.value)} aria-label="Kỳ lương"><option value="all">Tất cả kỳ lương</option>{periods.map((item) => <option key={item} value={item}>{item.split('-').reverse().join('/')}</option>)}</Select>} />}
      <Card title="BẢNG LƯƠNG">
        <div className="metric-grid metric-grid--four">
          <MetricCard label="NGÀY CÔNG" value={workingDays} suffix="ngày" helper={`${totalHours.toFixed(2)} giờ`} icon={Clock3} tone="blue" compact />
          <MetricCard label="LƯƠNG THEO CÔNG" value={money(basePay)} helper={monthlySalary ? `Lương tháng ${money(monthlySalary)}` : 'Chưa thiết lập lương'} icon={Banknote} tone="green" compact />
          <MetricCard label="THƯỞNG + PHỤ CẤP" value={money(bonus + allowance)} helper={`${extras.length} khoản ghi nhận`} icon={Gift} tone="orange" compact />
          <MetricCard label="TỔNG THU NHẬP" value={money(total)} helper="Tạm tính đến hiện tại" icon={Wallet} tone="green" compact />
        </div>
        <TableWrap>
          <thead><tr><th>Nhân viên</th><th>Vị trí</th><th>Ngày công</th><th>Tổng giờ</th><th>Lương theo công</th><th>Thưởng</th><th>Phụ cấp</th><th>Tổng nhận</th></tr></thead>
          <tbody><tr><td><strong>{employee.name || '—'}</strong></td><td>{employeePosition(employee)}</td><td>{workingDays}</td><td>{totalHours.toFixed(2)}</td><td>{money(basePay)}</td><td>{money(bonus)}</td><td>{money(allowance)}</td><td className="green-text"><strong>{money(total)}</strong></td></tr></tbody>
        </TableWrap>
      </Card>
    </div>
  )
}

export function EmployeeHome() {
  const app = useApp()
  const employee = findCurrentEmployee(app)
  const attendance = Array.isArray(app.attendance) ? app.attendance : []
  const rows = attendanceForEmployee(attendance, employee).sort((a, b) => recordDate(b).localeCompare(recordDate(a)))
  const officeEmployee = isOffice(employee, app.session)
  const todayRecord = rows.find((row) => recordDate(row) === localDateIso())
  const checkedInAt = todayRecord?.checkIn || todayRecord?.checkInTime || app.checkedInAt
  const checkedOutAt = todayRecord?.checkOut || todayRecord?.checkOutTime || app.checkedOutAt
  const [locationError, setLocationError] = useState('')
  const [locatingAction, setLocatingAction] = useState('')
  const [expense, setExpense] = useState('')
  const [cash, setCash] = useState('')
  const [transfer, setTransfer] = useState('')
  const [tiktok, setTiktok] = useState(false)
  const [historyRange, setHistoryRange] = useState(() => dateRangeForRows(rows))
  const [historyShift, setHistoryShift] = useState('all')
  const historyRows = filterRowsByRange(rows, historyRange).filter((row) => historyShift === 'all' || row.shift === historyShift)

  const captureLocation = (action, callback) => {
    setLocationError('')
    if (!navigator.geolocation) {
      const message = 'Trình duyệt không hỗ trợ định vị. Vui lòng dùng thiết bị có GPS.'
      setLocationError(message)
      app.notify?.(message, 'info')
      return
    }
    setLocatingAction(action)
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const location = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
          capturedAt: new Date().toISOString(),
        }
        try {
          await callback(location)
        } catch (error) {
          const message = error?.message || 'Không thể lưu thông tin điểm danh.'
          setLocationError(message)
          app.notify?.(message, 'info')
        } finally {
          setLocatingAction('')
        }
      },
      (error) => {
        const messages = {
          1: 'Bạn chưa cấp quyền vị trí. Hãy cho phép truy cập vị trí rồi thử lại.',
          2: 'Không thể xác định vị trí hiện tại.',
          3: 'Yêu cầu định vị đã hết thời gian.',
        }
        const message = messages[error.code] || 'Không thể lấy vị trí điểm danh.'
        setLocationError(message)
        setLocatingAction('')
        app.notify?.(message, 'info')
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 },
    )
  }

  const handleCheckIn = () => captureLocation('in', (location) => {
    if (typeof app.checkIn !== 'function') throw new Error('Chức năng điểm danh đang được kết nối.')
    return app.checkIn(location)
  })

  const handleOfficeCheckOut = () => captureLocation('out', (location) => {
    if (typeof app.checkOut === 'function') return app.checkOut(location)
    if (typeof app.finishShift === 'function') return app.finishShift(location)
    throw new Error('Chức năng ra về đang được kết nối.')
  })

  if (officeEmployee) {
    return (
      <div className="page employee-home">
        <PageHeader title="KHỐI VĂN PHÒNG" subtitle={`${employee.name || 'Nhân viên'} • ${employeePosition(employee)}`} />
        <div className="chart-grid">
          <Card className="checkin-card">
            <h2>ĐIỂM DANH</h2>
            <p>{new Date().toLocaleDateString('vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' })}</p>
            <strong>{formatTime(checkedInAt || new Date().toLocaleTimeString('vi-VN', { hour12: false }))}</strong>
            <Button icon={Fingerprint} loading={locatingAction === 'in'} onClick={handleCheckIn} disabled={Boolean(checkedInAt) || Boolean(locatingAction)}>{checkedInAt ? 'ĐÃ ĐIỂM DANH' : 'ĐIỂM DANH'}</Button>
            <small>{checkedInAt ? `Giờ vào: ${formatTime(checkedInAt)}` : 'Vị trí và thời gian sẽ được ghi nhận'}</small>
          </Card>
          <Card className="checkin-card">
            <h2>RA VỀ</h2>
            <p>Chỉ bấm sau khi hoàn thành ngày làm việc</p>
            <strong>{checkedOutAt ? formatTime(checkedOutAt) : '--:--:--'}</strong>
            <Button variant="danger" icon={LogOut} loading={locatingAction === 'out'} onClick={handleOfficeCheckOut} disabled={!checkedInAt || Boolean(checkedOutAt) || Boolean(locatingAction)}>{checkedOutAt ? 'ĐÃ RA VỀ' : 'RA VỀ'}</Button>
            <small>{checkedOutAt ? `Giờ ra: ${formatTime(checkedOutAt)}` : 'Hệ thống sẽ ghi nhận vị trí ra về'}</small>
          </Card>
        </div>
        {locationError && <InfoNote tone="orange">{locationError}</InfoNote>}
        <OfficeAttendanceHistory employee={employee} rows={rows} />
        <OfficePayrollSummary app={app} employee={employee} rows={rows} />
      </div>
    )
  }

  const currentShiftId = todayRecord?.shift || employee.shift || 'ca1'
  const tasks = (Array.isArray(app.tasks) ? app.tasks : []).filter((task) =>
    String(task.storeId || employee.storeId) === String(employee.storeId)
    && String(task.shiftId || task.shift || currentShiftId) === String(currentShiftId)
    && String(task.date || task.workDate || localDateIso()) === localDateIso(),
  )
  const taskIsDone = (task) => task.completedBy?.[employeeId(employee)] ?? task.done
  const totalRevenue = Number(cash || 0) + Number(transfer || 0)
  const allDone = tasks.every(taskIsDone)
  const finishedShift = Boolean(checkedOutAt || app.finishedShift)
  const canFinish = checkedInAt && allDone && totalRevenue > 0 && !finishedShift
  const currentTime = new Date().toLocaleTimeString('vi-VN', { hour12: false })
  const workShift = getShift(currentShiftId)
  const stores = Array.isArray(app.stores) ? app.stores : []
  const store = stores.find((item) => String(item.id) === String(employee.storeId || app.session?.storeId))
  const type = employeeType(employee)
  const payBasis = getPayBasis(employee)
  const rate = payBasis === 'hourly' ? getHourlyRate(employee) : getMonthlySalary(employee)

  const handleFinish = () => {
    if (!canFinish) return app.notify?.('Hoàn thành công việc và nhập doanh thu trước khi kết ca.', 'info')
    captureLocation('out', (location) => {
      const payload = { expense: Number(expense || 0), cash: Number(cash), transfer: Number(transfer), tiktok, location }
      if (typeof app.finishShift === 'function') return app.finishShift(payload)
      if (typeof app.checkOut === 'function') return app.checkOut(payload)
      throw new Error('Chức năng kết ca đang được kết nối.')
    })
  }

  return (
    <div className="page employee-home">
      <div className="employee-hero-title"><span>‹</span><h1>{store?.name || 'IDOSI'}</h1><span>›</span><p>HỆ THỐNG LÀM VIỆC NHÂN VIÊN</p></div>
      <div className="employee-top-grid">
        <Card className="checkin-card"><h2>ĐIỂM DANH</h2><p>{new Date().toLocaleDateString('vi-VN')}</p><strong>{formatTime(checkedInAt || currentTime)}</strong><Button icon={Fingerprint} loading={locatingAction === 'in'} onClick={handleCheckIn} disabled={Boolean(checkedInAt) || Boolean(locatingAction)}>{checkedInAt ? 'ĐÃ ĐIỂM DANH' : 'ĐIỂM DANH'}</Button><small>{checkedInAt ? `Đã vào ca lúc ${formatTime(checkedInAt)}` : 'Thời gian và vị trí sẽ được ghi nhận'}</small></Card>
        <Card className="employee-info-card"><h2>THÔNG TIN NHÂN VIÊN</h2><dl><div><dt>Mã nhân viên</dt><dd>{employeeId(employee) || '—'}</dd></div><div><dt>Họ và tên</dt><dd>{employee.name || '—'}</dd></div><div><dt>Vị trí</dt><dd>{employeePosition(employee)}</dd></div><div><dt>Loại nhân viên</dt><dd><Badge tone={type === 'Full-time' ? 'blue' : 'green'}>{type}</Badge></dd></div><div><dt>Số điện thoại</dt><dd>{employee.phone || '—'}</dd></div></dl></Card>
        <Card className="current-shift-card"><h2>CA LÀM VIỆC HÔM NAY</h2><div><Badge tone="green">{workShift.name.toUpperCase()}</Badge><strong>{workShift.time}</strong><small>({Number(employee.shiftHours) || 5} tiếng)</small></div><p><span>Giờ vào: <b>{formatTime(checkedInAt)}</b></span><span>Giờ kết ca: <b>{formatTime(checkedOutAt)}</b></span></p><div className={checkedInAt ? 'status-ok' : 'status-pending'}>{finishedShift ? 'Đã kết ca' : checkedInAt ? 'Đang làm việc' : 'Chưa điểm danh'}</div></Card>
      </div>
      {locationError && <InfoNote tone="orange">{locationError}</InfoNote>}
      <Card className="employee-tasks" title="CÔNG VIỆC CẦN LÀM">
        <TableWrap><thead><tr><th>STT</th><th>Công việc</th><th>Mô tả</th><th>Trạng thái</th></tr></thead><tbody>{tasks.map((task, index) => <tr key={task.id} className={taskIsDone(task) ? 'task-done' : ''}><td>{index + 1}</td><td><strong>{task.title}</strong></td><td>{task.detail}</td><td><input className="big-check" type="checkbox" checked={taskIsDone(task)} onChange={(event) => app.setTaskDone?.(task.id, event.target.checked, employeeId(employee))} /></td></tr>)}{!tasks.length && <tr><td colSpan="4">Chưa có công việc được giao cho cửa hàng, ca và ngày hiện tại.</td></tr>}</tbody></TableWrap>
        <InfoNote>Vui lòng tick hoàn thành tất cả công việc trước khi kết ca.</InfoNote>
      </Card>
      <Card className="finish-shift" title="THÔNG TIN KẾT CA">
        <div className="finish-shift__grid">
          <div><Field label="Chi phí trong ca (nếu có)"><Input type="number" min="0" value={expense} onChange={(event) => setExpense(event.target.value)} placeholder="Nhập chi phí phát sinh" /></Field><div className="expected-pay"><span>Số giờ làm dự kiến: <b>5 tiếng</b></span><span>{payBasis === 'hourly' ? 'Lương ca dự kiến' : 'Mức lương tháng'}: <b>{money(payBasis === 'hourly' ? rate * 5 : rate)}</b></span><small>{payBasis === 'hourly' ? `(${money(rate)}/giờ)` : 'Full-time hưởng lương theo tháng'}</small></div></div>
          <div><h3>Doanh thu ca <b>(bắt buộc)</b></h3><div className="revenue-entry"><Field label="Tiền mặt"><Input type="number" min="0" value={cash} onChange={(event) => setCash(event.target.value)} placeholder="Nhập số tiền" /></Field><Field label="Chuyển khoản"><Input type="number" min="0" value={transfer} onChange={(event) => setTransfer(event.target.value)} placeholder="Nhập số tiền" /></Field><div><span>Tổng tiền</span><strong>{money(totalRevenue)}</strong></div></div><Button className="finish-button" icon={LockKeyhole} loading={locatingAction === 'out'} disabled={!canFinish || Boolean(locatingAction)} onClick={handleFinish}>{finishedShift ? 'ĐÃ KẾT CA' : 'KẾT CA'}</Button>{!canFinish && !finishedShift && <small className="finish-warning">Vui lòng hoàn thành công việc và nhập doanh thu để kết ca</small>}</div>
          <div className="tiktok-box"><h3>♪ CLIP TIKTOK</h3><p>Nếu ca này có làm clip TikTok, vui lòng tick vào ô bên dưới.</p><label><input type="checkbox" checked={tiktok} onChange={(event) => setTiktok(event.target.checked)} /> Ca này có làm clip TikTok</label></div>
        </div>
      </Card>
      <Card title="LỊCH SỬ CA LÀM" action={<><DateRange value={historyRange} onChange={setHistoryRange} /><Select value={historyShift} onChange={(event) => setHistoryShift(event.target.value)} aria-label="Lọc ca làm"><option value="all">Tất cả ca</option>{shifts.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</Select></>}>
        <TableWrap><thead><tr><th>STT</th><th>Mã NV</th><th>Tên nhân viên</th><th>Loại NV</th><th>Ca làm</th><th>Ngày</th><th>Giờ vào</th><th>Giờ ra</th><th>Vị trí</th><th>Số giờ</th><th>Lương</th><th>Trạng thái</th></tr></thead><tbody>{historyRows.slice(0, 7).map((row, index) => { const shift = getShift(row.shift); const hours = workedHours(row); return <tr key={row.id || index}><td>{index + 1}</td><td>{employeeId(employee)}</td><td>{employee.name}</td><td><Badge tone={type === 'Full-time' ? 'blue' : 'green'}>{type}</Badge></td><td><Badge tone={row.shift === 'ca2' ? 'orange' : row.shift === 'ca3' ? 'blue' : 'green'}>{shift.name}</Badge></td><td>{shortDate(recordDate(row))}</td><td>{formatTime(row.checkIn)}</td><td>{formatTime(row.checkOut)}</td><td>{locationLabel(row.checkInLocation || row.location)}</td><td>{hours.toFixed(2)}</td><td>{payBasis === 'hourly' ? money(hours * rate) : 'Theo lương tháng'}</td><td><Badge tone={attendanceTone(checkInStatus(row, employee))}>{checkInStatus(row, employee)}</Badge></td></tr>})}{!historyRows.length && <tr><td colSpan="12">Không có ca làm phù hợp với bộ lọc.</td></tr>}</tbody></TableWrap>
        <TableFooter shown={Math.min(7, historyRows.length)} total={historyRows.length} />
      </Card>
    </div>
  )
}

export function EmployeePayroll() {
  const app = useApp()
  const employee = findCurrentEmployee(app)
  const allRows = attendanceForEmployee(Array.isArray(app.attendance) ? app.attendance : [], employee)
  const periods = [...new Set(allRows.map((row) => recordDate(row).slice(0, 7)).filter(Boolean))].sort().reverse()
  const [period, setPeriod] = useState(() => periods[0] || 'all')
  const rows = period === 'all' ? allRows : allRows.filter((row) => recordDate(row).startsWith(period))
  if (isOffice(employee, app.session)) return <OfficePayrollSummary app={app} employee={employee} rows={rows} withHeader period={period} periods={periods} onPeriodChange={setPeriod} />

  const payBasis = getPayBasis(employee)
  const hourlyRate = getHourlyRate(employee)
  const monthlySalary = getMonthlySalary(employee)
  const totalHours = rows.reduce((total, row) => total + workedHours(row), 0)
  const base = calculateEmployeeBasePay(employee, { hours: totalHours })
  const bonus = rows.reduce((total, row) => total + (Number(row.bonus) || 0), 0)
  const total = base + bonus
  const type = employeeType(employee)
  return (
    <div className="page">
      <PageHeader title="BẢNG LƯƠNG" subtitle={`Thống kê lương + thưởng của ${employee.name || 'nhân viên'}.`} actions={<><Select value={period} onChange={(event) => setPeriod(event.target.value)} aria-label="Kỳ lương"><option value="all">Tất cả kỳ lương</option>{periods.map((item) => <option key={item} value={item}>{item.split('-').reverse().join('/')}</option>)}</Select><Badge tone={type === 'Full-time' ? 'blue' : 'green'}>{type}</Badge></>} />
      <div className="metric-grid metric-grid--four">
        <MetricCard label="TỔNG THU NHẬP" value={money(total)} helper="Tính theo dữ liệu chấm công" icon={Wallet} tone="green" />
        <MetricCard label="TỔNG LƯƠNG" value={money(base)} helper={payBasis === 'hourly' ? `${rows.length} ca × ${money(hourlyRate)}/giờ` : `Lương tháng ${money(monthlySalary)}`} icon={Banknote} tone="blue" />
        <MetricCard label="TỔNG THƯỞNG" value={money(bonus)} helper="Các khoản thưởng đã ghi nhận" icon={Gift} tone="orange" />
        <Card className="completion-card"><DonutChart height={135} data={[{ name: 'Giờ làm', value: Math.max(totalHours, 1) }]} center={`${totalHours.toFixed(1)}h`} subcenter="Tổng giờ" /><div><strong>{rows.length} ca</strong><span>Đã ghi nhận</span></div></Card>
      </div>
      <Card title="CHI TIẾT LƯƠNG THEO CA">
        <TableWrap><thead><tr><th>STT</th><th>Ngày làm</th><th>Ca làm</th><th>Thời gian vào</th><th>Thời gian kết ca</th><th>Số giờ</th><th>Cơ chế lương</th><th>Thưởng ca</th><th>Thành tiền</th></tr></thead><tbody>{rows.map((row, index) => { const hours = workedHours(row); const rowBonus = Number(row.bonus) || 0; const rowPay = payBasis === 'hourly' ? hours * hourlyRate : 0; return <tr key={row.id || index}><td>{index + 1}</td><td>{shortDate(recordDate(row))}</td><td><Badge tone={row.shift === 'ca2' ? 'orange' : row.shift === 'ca3' ? 'blue' : 'green'}>{getShift(row.shift).name}</Badge></td><td>{formatTime(row.checkIn)}</td><td>{formatTime(row.checkOut)}</td><td>{hours.toFixed(2)}</td><td>{payBasis === 'hourly' ? `${money(hourlyRate)}/giờ` : `${money(monthlySalary)}/tháng`}</td><td>{money(rowBonus)}</td><td className="green-text"><strong>{payBasis === 'hourly' ? money(rowPay + rowBonus) : `Theo lương tháng${rowBonus ? ` + ${money(rowBonus)}` : ''}`}</strong></td></tr>})}</tbody></TableWrap>
        <TableFooter shown={rows.length} total={rows.length} />
      </Card>
    </div>
  )
}

export function EmployeeCashflow() {
  const app = useApp()
  const employee = findCurrentEmployee(app)
  const allRows = attendanceForEmployee(Array.isArray(app.attendance) ? app.attendance : [], employee).sort((a, b) => recordDate(b).localeCompare(recordDate(a)))
  const [dateRange, setDateRange] = useState(() => dateRangeForRows(allRows))
  const [shiftFilter, setShiftFilter] = useState('all')
  const rows = filterRowsByRange(allRows, dateRange).filter((row) => shiftFilter === 'all' || row.shift === shiftFilter).slice(0, 7)
  if (isOffice(employee, app.session)) {
    return <div className="page"><PageHeader title="DÒNG TIỀN" /><InfoNote>Nhân viên khối văn phòng không sử dụng chức năng dòng tiền theo ca.</InfoNote></div>
  }
  const currentRecord = allRows[0]
  const currentShift = getShift(currentRecord?.shift)
  const revenue = Number(currentRecord?.revenue) || 0
  const expense = Number(currentRecord?.expense) || 0
  const profit = revenue - expense
  return (
    <div className="page">
      <PageHeader title="DÒNG TIỀN" subtitle="Thống kê doanh thu, chi phí của ca làm hiện tại" icon={Banknote} />
      <Card title="CA LÀM HIỆN TẠI" className="current-cashflow">
        <div className="current-shift-info"><Badge>{currentShift.name}</Badge><strong>{currentShift.time}</strong><span>{currentRecord ? shortDate(recordDate(currentRecord)) : new Date().toLocaleDateString('vi-VN')}</span><Badge>{!currentRecord ? '● Chưa có ca' : currentRecord.checkOut ? '● Đã kết ca' : '● Đang làm'}</Badge><small>{employee.name || employeeId(employee)}</small></div>
        <div className="cashflow-current-card green"><h3><TrendingUp />DOANH THU</h3><strong>{money(revenue)}</strong><p><span>Số đơn: <b>{Number(currentRecord?.orders) || 0}</b></span></p></div>
        <div className="cashflow-current-card red"><h3><TrendingDown />CHI PHÍ</h3><strong>{money(expense)}</strong><p>Tổng chi trong ca</p></div>
        <div className="cashflow-current-card blue"><h3><Wallet />LỢI NHUẬN TẠM TÍNH</h3><strong>{money(profit)}</strong><p>Doanh thu - Chi phí</p><div><span>Tỷ lệ lợi nhuận</span><b>{revenue ? ((profit / revenue) * 100).toFixed(2) : '0.00'}%</b></div></div>
        <InfoNote>Số liệu được cập nhật liên tục trong ca làm</InfoNote>
      </Card>
      <Card title="LỊCH SỬ DÒNG TIỀN CÁC CA KHÁC" action={<><DateRange value={dateRange} onChange={setDateRange} /><Select value={shiftFilter} onChange={(event) => setShiftFilter(event.target.value)} aria-label="Lọc ca làm"><option value="all">Tất cả ca</option>{shifts.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</Select><ExportButton onClick={() => downloadCsv('dong-tien-nhan-vien.csv', rows)} /></>}>
        <TableWrap><thead><tr><th>STT</th><th>Ngày làm</th><th>Ca làm</th><th>Doanh thu</th><th>Chi phí</th><th>Lợi nhuận</th><th>Trạng thái</th></tr></thead><tbody>{rows.map((row, index) => { const rowRevenue = Number(row.revenue) || 0; const rowExpense = Number(row.expense) || 0; return <tr key={row.id || index}><td>{index + 1}</td><td><strong>{shortDate(recordDate(row))}</strong></td><td><Badge>{getShift(row.shift).name}</Badge></td><td>{money(rowRevenue)}</td><td>{money(rowExpense)}</td><td className="green-text"><strong>{money(rowRevenue - rowExpense)}</strong></td><td><Badge>{row.checkOut ? 'Đã kết ca' : 'Đang làm'}</Badge></td></tr>})}{!rows.length && <tr><td colSpan="7">Không có dữ liệu dòng tiền phù hợp với bộ lọc.</td></tr>}</tbody></TableWrap>
        <TableFooter shown={rows.length} total={rows.length} />
      </Card>
    </div>
  )
}

export function EmployeeShiftHistory() {
  const app = useApp()
  const employee = findCurrentEmployee(app)
  const allRows = attendanceForEmployee(Array.isArray(app.attendance) ? app.attendance : [], employee)
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [shift, setShift] = useState('all')
  const [appliedFilters, setAppliedFilters] = useState({ from: '', to: '', shift: 'all' })
  const rows = allRows.filter((item) => {
    const date = recordDate(item)
    return (appliedFilters.shift === 'all' || item.shift === appliedFilters.shift) && (!appliedFilters.from || date >= appliedFilters.from) && (!appliedFilters.to || date <= appliedFilters.to)
  })
  const applyFilters = () => {
    if (from && to && from > to) {
      app.notify?.('Ngày bắt đầu phải trước hoặc bằng ngày kết thúc.', 'info')
      return
    }
    setAppliedFilters({ from, to, shift })
    app.notify?.('Đã áp dụng bộ lọc lịch sử ca làm.', 'success')
  }
  const filterPanel = <Card className="filter-card"><div className="filter-grid filter-grid--four"><Field label="Từ ngày"><Input icon={CalendarDays} type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></Field><Field label="Đến ngày"><Input icon={CalendarDays} type="date" value={to} onChange={(event) => setTo(event.target.value)} /></Field><Field label="Ca làm"><Select value={shift} onChange={(event) => setShift(event.target.value)}><option value="all">Tất cả</option>{shifts.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</Select></Field><Button icon={Search} onClick={applyFilters}>Tìm kiếm</Button></div></Card>
  if (isOffice(employee, app.session)) {
    return <div className="page"><PageHeader title="LỊCH SỬ ĐIỂM DANH" subtitle={`Dữ liệu chấm công của ${employee.name || 'nhân viên'}.`} icon={Clock3} />{filterPanel}<OfficeAttendanceHistory employee={employee} rows={rows} /></div>
  }
  const payBasis = getPayBasis(employee)
  const hourlyRate = getHourlyRate(employee)
  const type = employeeType(employee)
  return (
    <div className="page">
      <PageHeader title="LỊCH SỬ CA LÀM" subtitle={`Xem lịch sử ca làm của ${employee.name || 'nhân viên'}.`} icon={Clock3} actions={<Badge tone={type === 'Full-time' ? 'blue' : 'green'}>{type}</Badge>} />
      {filterPanel}
      <Card action={<ExportButton onClick={() => downloadCsv('lich-su-ca-lam.csv', rows)} />}>
        <TableWrap><thead><tr><th>STT</th><th>Ngày làm việc</th><th>Mã nhân viên</th><th>Tên nhân viên</th><th>Loại</th><th>Ca làm</th><th>Thời gian vào</th><th>Thời gian kết ca</th><th>Số giờ</th><th>Lương dự tính</th></tr></thead><tbody>{rows.map((row, index) => { const hours = workedHours(row); return <tr key={row.id || index}><td>{index + 1}</td><td><strong>{shortDate(recordDate(row))}</strong></td><td>{employeeId(employee)}</td><td><strong>{employee.name}</strong></td><td><Badge tone={type === 'Full-time' ? 'blue' : 'green'}>{type}</Badge></td><td><Badge tone={row.shift === 'ca2' ? 'orange' : row.shift === 'ca3' ? 'blue' : 'green'}>{getShift(row.shift).name}</Badge></td><td>{formatTime(row.checkIn)}</td><td>{formatTime(row.checkOut)}</td><td className="green-text"><strong>{hours.toFixed(2)} giờ</strong></td><td className="green-text"><strong>{payBasis === 'hourly' ? money(hours * hourlyRate) : 'Theo lương tháng'}</strong></td></tr>})}{!rows.length && <tr><td colSpan="10">Không có lịch sử ca làm phù hợp với bộ lọc.</td></tr>}</tbody></TableWrap>
        <TableFooter shown={rows.length} total={rows.length} />
      </Card>
    </div>
  )
}
