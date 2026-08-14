import { useEffect, useState } from 'react'
import {
  Banknote,
  BarChart3,
  CalendarDays,
  Clock3,
  Download,
  Filter,
  Gift,
  PieChart,
  Save,
  Settings,
  Store,
  TrendingUp,
  UserRound,
  Users,
  Wallet,
} from 'lucide-react'
import {
  Avatar,
  Badge,
  Button,
  Card,
  DateRange,
  DonutChart,
  ExportButton,
  Field,
  FinancialChart,
  InfoNote,
  Input,
  MetricCard,
  Modal,
  PageHeader,
  Progress,
  SearchInput,
  Select,
  TableWrap,
} from '../../components/UI'
import { cashSeries, payRows, shifts } from '../../data'
import { useApp } from '../../state/AppContext'
import {
  calculateEmployeeBasePay,
  downloadCsv,
  getHourlyRate,
  getMonthlySalary,
  getPayBasis,
  money,
  salaryBasisLabel,
} from '../../utils'

const findShift = (id) => shifts.find((shift) => shift.id === id)

const attendancePay = (employee, hours) => getPayBasis(employee) === 'hourly'
  ? calculateEmployeeBasePay(employee, { hours })
  : null

const isoDate = (value) => {
  if (!value) return ''
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value
  const match = String(value).match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  return match ? `${match[3]}-${match[2]}-${match[1]}` : ''
}

const displayDate = (value) => {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/)
  return match ? `${match[3]}/${match[2]}/${match[1]}` : value || ''
}

const dateInRange = (date, range) => {
  const parts = String(range || '').match(/(\d{2}\/\d{2}\/\d{4})\s*-\s*(\d{2}\/\d{2}\/\d{4})/)
  if (!parts) return true
  const normalized = isoDate(date)
  return normalized >= isoDate(parts[1]) && normalized <= isoDate(parts[2])
}

const currentRange = (dates) => {
  const validDates = dates.filter(Boolean).sort()
  if (!validDates.length) return '01/08/2026 - 31/08/2026'
  return `${displayDate(validDates[0])} - ${displayDate(validDates.at(-1))}`
}

const useStoreScope = () => {
  const app = useApp()
  const stores = Array.isArray(app.stores) ? app.stores : []
  const storeId = app.session?.role === 'employee'
    ? app.session.storeId
    : app.activeStoreId || app.session?.storeId || stores[0]?.id || ''
  const employees = (Array.isArray(app.employees) ? app.employees : []).filter((employee) =>
    employee.unit !== 'office' && String(employee.storeId || stores[0]?.id || '') === String(storeId),
  )
  const employeeIds = new Set(employees.map((employee) => String(employee.id)))
  const attendance = (Array.isArray(app.attendance) ? app.attendance : []).filter((record) =>
    record.storeId ? String(record.storeId) === String(storeId) : employeeIds.has(String(record.employeeId)),
  )
  const imports = (Array.isArray(app.imports) ? app.imports : []).filter((record) => String(record.storeId || storeId) === String(storeId))
  const activeStore = stores.find((store) => String(store.id) === String(storeId)) || stores[0]
  return { ...app, stores, storeId, activeStore, employees, attendance, imports }
}

export function StoreAttendance() {
  const { attendance, employees } = useStoreScope()
  const [query, setQuery] = useState('')
  const [shift, setShift] = useState('all')
  const [status, setStatus] = useState('all')
  const [view, setView] = useState('summary')
  const availableDates = [...new Set(attendance.map((item) => item.date).filter(Boolean))].sort().reverse()
  const [selectedDate, setSelectedDate] = useState(availableDates[0] || '')
  const normalizedSelectedDate = availableDates.includes(isoDate(selectedDate)) ? isoDate(selectedDate) : availableDates[0] || ''

  const filtered = attendance.filter((item) => {
    const employee = employees.find((person) => person.id === item.employeeId)
    const matchesDate = !normalizedSelectedDate || item.date === normalizedSelectedDate
    const matchesQuery = employee?.name.toLowerCase().includes(query.toLowerCase())
    const matchesShift = shift === 'all' || item.shift === shift
    const matchesStatus = status === 'all' || item.status === status
    return matchesDate && matchesQuery && matchesShift && matchesStatus
  })
  const dateIndex = availableDates.indexOf(normalizedSelectedDate)
  const moveDate = (direction) => {
    if (!availableDates.length) return
    const nextIndex = Math.min(availableDates.length - 1, Math.max(0, (dateIndex < 0 ? 0 : dateIndex) + direction))
    setSelectedDate(displayDate(availableDates[nextIndex]))
  }
  const resetFilters = () => {
    setSelectedDate(displayDate(availableDates[0] || ''))
    setQuery('')
    setShift('all')
    setStatus('all')
  }
  const totalHours = filtered.reduce((sum, item) => sum + (Number(item.hours) || 0), 0)
  const totalHourlyPay = filtered.reduce((sum, item) => {
    const employee = employees.find((person) => person.id === item.employeeId)
    return sum + (attendancePay(employee, Number(item.hours) || 0) || 0)
  }, 0)
  return (
    <div className="page">
      <PageHeader title="Chấm công" subtitle="Theo dõi giờ làm việc của nhân viên" actions={<><DateRange value={displayDate(normalizedSelectedDate)} onChange={setSelectedDate} /><Button variant="outline" onClick={() => moveDate(1)} disabled={!availableDates.length || dateIndex >= availableDates.length - 1}>‹</Button><Button variant="outline" onClick={() => moveDate(-1)} disabled={!availableDates.length || dateIndex <= 0}>›</Button><Button variant="outline" icon={Filter} onClick={resetFilters}>Đặt lại</Button><ExportButton onClick={() => downloadCsv('cham-cong.csv', filtered.map((item) => ({ ...item, employee: employees.find((person) => person.id === item.employeeId)?.name || item.employeeId })))} /></>} />
      <div className="metric-grid metric-grid--four">
        <MetricCard label="Tổng số nhân viên" value={new Set(filtered.map((item) => item.employeeId)).size} suffix="người" icon={Clock3} tone="green" compact />
        <MetricCard label="Tổng giờ làm" value={totalHours.toFixed(2)} suffix="giờ" helper={`TB: ${(totalHours / Math.max(1, filtered.length)).toFixed(2)} giờ/người`} icon={Clock3} tone="green" compact />
        <MetricCard label="Lương Part-time tạm tính" value={money(totalHourlyPay)} helper="Theo giờ chấm công thực tế" icon={Banknote} tone="green" compact />
        <MetricCard label="Cơ chế lương" value="2 loại" helper="Full-time theo tháng · Part-time theo giờ" icon={Wallet} tone="green" compact />
      </div>
      <Card>
        <div className="card__subheader"><div className="tabs"><button className={view === 'summary' ? 'active' : ''} onClick={() => setView('summary')}>Tổng hợp theo ngày</button><button className={view === 'shift' ? 'active' : ''} onClick={() => setView('shift')}>Chi tiết theo ca</button></div><div><SearchInput value={query} onChange={setQuery} placeholder="Tìm kiếm nhân viên..." /><Select value={shift} onChange={(event) => setShift(event.target.value)}><option value="all">Tất cả ca</option>{shifts.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</Select><Select value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">Tất cả trạng thái</option><option value="Đúng giờ">Đúng giờ</option><option value="Đi sớm">Đi sớm</option><option value="Trễ">Trễ</option></Select></div></div>
        <TableWrap><thead><tr><th>STT</th><th>Nhân viên</th><th>Ca làm việc</th><th>Giờ vào</th><th>Giờ kết ca</th><th>Số giờ làm</th><th>Lương cứng</th><th>Lương nhận</th><th>Trạng thái</th><th>Ghi chú</th></tr></thead><tbody>{filtered.map((item, index) => {
          const employee = employees.find((person) => person.id === item.employeeId)
          const workShift = findShift(item.shift)
          const hours = Number(item.hours) || 0
          const pay = attendancePay(employee, hours)
          const payLabel = pay == null ? 'Theo lương tháng' : money(pay)
          return <tr key={item.id}><td>{index + 1}</td><td><div className="person-cell"><Avatar name={employee?.name} color={employee?.color} /><span><strong>{employee?.name}</strong><small>{employee?.shortRole}</small></span></div></td><td><strong style={{ color: workShift?.color }}>{workShift?.name || item.shift}</strong><small className="table-sub">({workShift?.time || `${item.shiftStart || '—'} - ${item.shiftEnd || '—'}`})</small></td><td className="green-text"><strong>{item.checkIn}</strong></td><td className={item.status === 'Trễ' ? 'orange-text' : 'red-text'}><strong>{item.checkOut || '—'}</strong></td><td><strong>{hours.toFixed(2)}</strong><small className="table-sub">giờ</small></td><td>{payLabel}</td><td className="green-text"><strong>{payLabel}</strong></td><td><Badge tone={item.status === 'Trễ' ? 'orange' : 'green'}>{item.status}</Badge></td><td>{item.note || '–'}</td></tr>
        })}{!filtered.length && <tr><td colSpan="10" style={{ textAlign: 'center' }}>Không có dữ liệu chấm công phù hợp.</td></tr>}<tr className="total-row"><td colSpan="5">TỔNG CỘNG</td><td>{totalHours.toFixed(2)} giờ</td><td>{money(totalHourlyPay)}</td><td>{money(totalHourlyPay)}</td><td colSpan="2">Chưa gồm lương tháng Full-time</td></tr></tbody></TableWrap>
      </Card>
      <div className="bottom-info-grid">
        <Card title="Giải thích"><ul className="plain-list"><li>Số giờ làm = Giờ kết ca - Giờ vào</li><li>Full-time được thiết lập và tổng hợp theo lương tháng</li><li>Part-time = Số giờ làm × mức lương theo giờ</li></ul></Card>
        <Card title="Tổng hợp theo ca"><div className="shift-totals">{shifts.map((item) => { const shiftRows = filtered.filter((row) => row.shift === item.id); const hours = shiftRows.reduce((total, row) => total + (Number(row.hours) || 0), 0); const pay = shiftRows.reduce((total, row) => { const employee = employees.find((person) => person.id === row.employeeId); return total + (attendancePay(employee, Number(row.hours) || 0) || 0) }, 0); return <div key={item.id}><strong style={{ color: item.color }}>{item.name}</strong><b>{hours.toFixed(2)} giờ</b><small>{money(pay)} Part-time</small></div> })}</div></Card>
        <Card title="Tỷ lệ chấm công"><div className="donut-with-legend"><DonutChart height={185} data={[{ name: 'Đúng giờ', value: filtered.filter((item) => item.status === 'Đúng giờ').length }, { name: 'Trễ', value: filtered.filter((item) => item.status === 'Trễ').length }]} center={filtered.length} subcenter="Tổng số" /><div className="legend-list"><p><i className="dot green" />Đúng giờ <strong>{filtered.filter((item) => item.status === 'Đúng giờ').length}</strong></p><p><i className="dot orange" />Trễ <strong>{filtered.filter((item) => item.status === 'Trễ').length}</strong></p></div></div></Card>
      </div>
    </div>
  )
}

export function StorePayroll() {
  const { employees, attendance } = useStoreScope()
  const [detailEmployeeId, setDetailEmployeeId] = useState(null)
  const [periodMode, setPeriodMode] = useState('month')
  const [periodDate, setPeriodDate] = useState(() => new Date())
  const periodYear = periodDate.getFullYear()
  const periodMonth = String(periodDate.getMonth() + 1).padStart(2, '0')
  const periodDay = String(periodDate.getDate()).padStart(2, '0')
  const periodLabel = periodMode === 'month'
    ? `01/${periodMonth}/${periodYear} - ${String(new Date(periodYear, periodDate.getMonth() + 1, 0).getDate()).padStart(2, '0')}/${periodMonth}/${periodYear}`
    : `${periodDay}/${periodMonth}/${periodYear}`
  const movePeriod = (direction) => setPeriodDate((current) => {
    const next = new Date(current)
    if (periodMode === 'month') next.setMonth(next.getMonth() + direction)
    else next.setDate(next.getDate() + direction)
    return next
  })
  const rows = employees.map((employee) => {
    const seeded = payRows.find((row) => row.employeeId === employee.id)
    const employeeAttendance = attendance.filter((record) => record.employeeId === employee.id)
    const attendanceHours = employeeAttendance.reduce((total, record) => total + (Number(record.hours) || 0), 0)
    const hours = attendanceHours || Number(seeded?.hours) || 0
    return {
      employeeId: employee.id,
      hours,
      base: calculateEmployeeBasePay(employee, { hours }),
      tiktokAllowance: Number(seeded?.tiktokAllowance) || 0,
      tiktokBonus: Number(seeded?.tiktokBonus) || 0,
      other: Number(seeded?.other) || 0,
      bonus: Number(seeded?.bonus) || 0,
    }
  })
  const totals = rows.reduce((acc, row) => ({ hours: acc.hours + row.hours, base: acc.base + row.base, tiktokAllowance: acc.tiktokAllowance + row.tiktokAllowance, tiktokBonus: acc.tiktokBonus + row.tiktokBonus, other: acc.other + row.other, bonus: acc.bonus + row.bonus }), { hours: 0, base: 0, tiktokAllowance: 0, tiktokBonus: 0, other: 0, bonus: 0 })
  const totalPay = totals.base + totals.tiktokAllowance + totals.tiktokBonus + totals.other + totals.bonus
  const hoursData = cashSeries.map((item, index) => ({ day: item.day.slice(0, 2), hours: 16 + (item.revenue % 15) + (index % 3) }))
  const detailRow = rows.find((row) => row.employeeId === detailEmployeeId)
  const detailEmployee = employees.find((employee) => employee.id === detailEmployeeId)
  const detailTotal = detailRow ? detailRow.base + detailRow.tiktokAllowance + detailRow.tiktokBonus + detailRow.other + detailRow.bonus : 0
  return (
    <div className="page">
      <PageHeader title="Lương thưởng nhân viên" subtitle="Quản lý và tổng hợp lương thưởng" actions={<><div className="segmented"><button className={periodMode === 'day' ? 'active' : ''} onClick={() => setPeriodMode('day')}>Ngày</button><button className={periodMode === 'month' ? 'active' : ''} onClick={() => setPeriodMode('month')}>Tháng</button></div><DateRange value={periodLabel} /><ExportButton onClick={() => downloadCsv('luong-thuong.csv', rows)} /></>} />
      <Card className="period-strip"><span>Thời gian:</span><strong><CalendarDays />{periodLabel}</strong><div><Button variant="outline" onClick={() => movePeriod(-1)}>‹</Button><Button variant="outline" onClick={() => setPeriodDate(new Date())}>Hôm nay</Button><Button variant="outline" onClick={() => movePeriod(1)}>›</Button></div></Card>
      <div className="metric-grid metric-grid--six">
        <MetricCard label="Tổng giờ làm" value={totals.hours.toFixed(2)} suffix="giờ" helper={`Trung bình/người: ${(totals.hours / Math.max(1, rows.length)).toFixed(2)} giờ`} icon={Clock3} tone="green" compact />
        <MetricCard label="Tổng lương" value={money(totals.base)} helper="Full-time theo tháng · Part-time theo giờ" icon={Banknote} tone="green" compact />
        <MetricCard label="Tổng thưởng" value={money(totals.tiktokBonus + totals.bonus)} helper="Trung bình/người" icon={Gift} tone="orange" compact />
        <MetricCard label="Tổng phụ cấp" value={money(totals.tiktokAllowance + totals.other)} helper="Phụ cấp TikTok + khác" icon={Wallet} tone="green" compact />
        <MetricCard label="Tổng chi trả" value={money(totalPay)} helper="Tổng lương + thưởng + phụ cấp" icon={Users} tone="teal" compact />
        <MetricCard label="Tổng nhân viên" value={rows.length} suffix="nhân viên" helper="Đang làm việc" icon={UserRound} tone="green" compact />
      </div>
      <Card title="Chi tiết lương thưởng nhân viên">
        <TableWrap><thead><tr><th>STT</th><th>Nhân viên</th><th>Cơ chế lương</th><th>Tổng giờ làm</th><th>Lương cứng</th><th>Phụ cấp TikTok</th><th>Thưởng TikTok</th><th>Thưởng / Phụ cấp khác</th><th>Thưởng</th><th>Tổng nhận</th><th>Chi tiết</th></tr></thead><tbody>{rows.map((row, index) => { const employee = employees.find((item) => item.id === row.employeeId); const total = row.base + row.tiktokAllowance + row.tiktokBonus + row.other + row.bonus; const basis = getPayBasis(employee); const rate = basis === 'hourly' ? getHourlyRate(employee) : getMonthlySalary(employee); return <tr key={row.employeeId}><td>{index + 1}</td><td><div className="person-cell"><Avatar name={employee?.name} color={employee?.color} /><span><strong>{employee?.name}</strong><small>{employee?.role}</small></span></div></td><td><Badge tone={basis === 'hourly' ? 'green' : 'blue'}>{salaryBasisLabel(employee)}</Badge><small className="table-sub">{money(rate)}{basis === 'hourly' ? '/giờ' : '/tháng'}</small></td><td><strong>{row.hours.toFixed(2)}</strong><small className="table-sub">giờ ghi nhận</small></td><td>{money(row.base)}</td><td className="green-text">{money(row.tiktokAllowance)}</td><td className="green-text">{money(row.tiktokBonus)}</td><td className="orange-text">{money(row.other)}</td><td className="green-text">{money(row.bonus)}</td><td><strong>{money(total)}</strong></td><td><Button variant="outline" onClick={() => setDetailEmployeeId(row.employeeId)}>Xem chi tiết</Button></td></tr> })}<tr className="total-row"><td colSpan="3">TỔNG CỘNG</td><td>{totals.hours.toFixed(2)} giờ</td><td>{money(totals.base)}</td><td>{money(totals.tiktokAllowance)}</td><td>{money(totals.tiktokBonus)}</td><td>{money(totals.other)}</td><td>{money(totals.bonus)}</td><td>{money(totalPay)}</td><td /></tr></tbody></TableWrap>
      </Card>
      <div className="chart-grid chart-grid--three">
        <Card title="Cơ cấu chi trả"><DonutChart data={[{ name: 'Lương cứng', value: totals.base }, { name: 'Thưởng TikTok', value: totals.tiktokBonus }, { name: 'Phụ cấp khác', value: totals.other }, { name: 'Phụ cấp TikTok', value: totals.tiktokAllowance }, { name: 'Thưởng khác', value: totals.bonus }]} center={money(totalPay)} subcenter="Tổng chi trả" /></Card>
        <Card title="Thống kê theo ngày (Tổng giờ làm)"><FinancialChart data={hoursData} type="bar" keys={['hours']} height={240} hideLegend /></Card>
        <Card title="Tóm tắt nhanh"><div className="summary-list"><p><span>Lương cứng</span><strong>{money(totals.base)}</strong></p><p><span>Phụ cấp TikTok</span><strong>{money(totals.tiktokAllowance)}</strong></p><p><span>Thưởng TikTok</span><strong>{money(totals.tiktokBonus)}</strong></p><p><span>Thưởng / PC khác</span><strong>{money(totals.other + totals.bonus)}</strong></p><p className="total"><span>Tổng chi trả</span><strong>{money(totalPay)}</strong></p></div></Card>
      </div>
      <Modal open={Boolean(detailRow)} onClose={() => setDetailEmployeeId(null)} title={`Chi tiết lương - ${detailEmployee?.name || ''}`} footer={<Button onClick={() => setDetailEmployeeId(null)}>Đóng</Button>}>
        {detailRow && <div className="summary-list"><p><span>Cơ chế lương</span><strong>{salaryBasisLabel(detailEmployee)}</strong></p><p><span>Tổng giờ ghi nhận</span><strong>{detailRow.hours.toFixed(2)} giờ</strong></p><p><span>Lương cứng</span><strong>{money(detailRow.base)}</strong></p><p><span>Phụ cấp TikTok</span><strong>{money(detailRow.tiktokAllowance)}</strong></p><p><span>Thưởng TikTok</span><strong>{money(detailRow.tiktokBonus)}</strong></p><p><span>Thưởng / phụ cấp khác</span><strong>{money(detailRow.other + detailRow.bonus)}</strong></p><p className="total"><span>Tổng nhận</span><strong>{money(detailTotal)}</strong></p></div>}
      </Modal>
    </div>
  )
}

export function StoreCashflow() {
  const { activeStore, imports, employees, attendance, notify } = useStoreScope()
  const [period, setPeriod] = useState('day')
  const [range, setRange] = useState('01/08/2026 - 15/08/2026')
  const [appliedRange, setAppliedRange] = useState(range)
  const [focus, setFocus] = useState('revenue')

  const employeePayroll = employees.reduce((sum, employee) => {
    const employeeAttendance = attendance.filter((record) => record.employeeId === employee.id)
    const seeded = payRows.find((row) => row.employeeId === employee.id)
    const hours = employeeAttendance.reduce((total, record) => total + (Number(record.hours) || 0), 0) || Number(seeded?.hours) || 0
    return sum + calculateEmployeeBasePay(employee, { hours }) + (Number(seeded?.tiktokAllowance) || 0) + (Number(seeded?.tiktokBonus) || 0) + (Number(seeded?.other) || 0) + (Number(seeded?.bonus) || 0)
  }, 0)
  const importExpense = imports.reduce((sum, item) => sum + Number(item.weight || 0) * Number(item.price || 0) + Number(item.shipping || 0), 0)
  const seedRevenue = cashSeries.reduce((sum, item) => sum + item.revenue, 0) * 1000000
  const seedExpense = cashSeries.reduce((sum, item) => sum + item.expense, 0) * 1000000
  const storeRevenue = Number(activeStore?.revenue) || seedRevenue
  const storeExpense = Number(activeStore?.expense) || Math.max(seedExpense, employeePayroll + importExpense)
  const fixedExpense = Math.max(0, storeExpense - employeePayroll - importExpense)

  const scopedSeries = cashSeries.map((item) => ({
    day: item.day,
    date: `2026-${item.day.slice(3, 5)}-${item.day.slice(0, 2)}`,
    revenue: Math.round(storeRevenue * item.revenue / Math.max(1, cashSeries.reduce((sum, row) => sum + row.revenue, 0))),
    expense: Math.round(storeExpense * item.expense / Math.max(1, cashSeries.reduce((sum, row) => sum + row.expense, 0))),
  })).map((item) => ({ ...item, profit: item.revenue - item.expense }))
  const filteredSeries = scopedSeries.filter((item) => dateInRange(item.date, appliedRange))
  const aggregate = filteredSeries.reduce((totals, item) => ({ revenue: totals.revenue + item.revenue, expense: totals.expense + item.expense, profit: totals.profit + item.profit }), { revenue: 0, expense: 0, profit: 0 })
  const periodData = period === 'day'
    ? filteredSeries
    : [{ day: period === 'month' ? '08/2026' : '2026', ...aggregate }]
  const chartData = periodData.map((item) => ({ ...item, revenue: item.revenue / 1000000, expense: item.expense / 1000000, profit: item.profit / 1000000 }))
  const revenue = aggregate.revenue
  const expense = aggregate.expense
  const profit = revenue - expense
  const expenseRows = [
    { type: 'Chi phí cố định', detail: 'Điện, nước, wifi, rác, mặt bằng', value: fixedExpense, tone: 'orange' },
    { type: 'Lương thưởng nhân viên', detail: 'Tổng lương và thưởng trong kỳ', value: employeePayroll, tone: 'purple' },
    { type: 'Chi phí nhập hàng', detail: `${imports.length} phiếu nhập của ${activeStore?.name || 'cửa hàng'}`, value: importExpense, tone: 'blue' },
  ]
  const recent = [...periodData].slice(-5).reverse()
  const fixedItems = [
    { name: 'Điện', ratio: 0.13 },
    { name: 'Nước', ratio: 0.03 },
    { name: 'Wifi', ratio: 0.02 },
    { name: 'Mặt bằng', ratio: 0.8 },
    { name: 'Rác', ratio: 0.02 },
  ]
  const applyFilter = () => {
    setAppliedRange(range)
    notify(`Đã lọc dòng tiền ${activeStore?.name || ''} theo khoảng ${range}.`)
  }
  const showFocus = (section) => {
    setFocus(section)
    notify(`Đang xem chi tiết ${section === 'revenue' ? 'doanh thu' : section === 'expense' ? 'chi phí' : 'lợi nhuận'}.`)
  }
  return (
    <div className="page">
      <PageHeader title="Dòng tiền" subtitle={`Trang chủ  ›  ${activeStore?.name || 'Cửa hàng'}  ›  Dòng tiền`} actions={<><DateRange value={range} onChange={setRange} /><Button variant="outline" icon={Filter} onClick={applyFilter}>Lọc dữ liệu</Button><ExportButton label="Xuất báo cáo" onClick={() => downloadCsv('dong-tien.csv', periodData)} /></>} />
      <div className="metric-grid metric-grid--four">
        <MetricCard label="DOANH THU" value={money(revenue)} helper={`Dữ liệu ${activeStore?.name || 'cửa hàng'}`} icon={BarChart3} tone="blue" compact />
        <MetricCard label="TỔNG CHI PHÍ" value={money(expense)} helper={`${imports.length} phiếu nhập · ${employees.length} nhân viên`} icon={Wallet} tone="orange" compact />
        <MetricCard label="LỢI NHUẬN" value={money(profit)} helper="Doanh thu - Tổng chi phí" icon={TrendingUp} tone="green" compact />
        <MetricCard label="BIÊN LỢI NHUẬN" value={`${revenue ? (profit / revenue * 100).toFixed(2) : '0.00'}%`} helper={`Kỳ ${appliedRange}`} icon={PieChart} tone="purple" compact />
      </div>
      <div className="chart-grid">
        <Card title="Doanh thu theo kỳ" action={<Select value={period} onChange={(event) => setPeriod(event.target.value)}><option value="day">Theo ngày</option><option value="month">Theo tháng</option><option value="year">Theo năm</option></Select>}><FinancialChart data={chartData} type="bar" keys={['revenue']} /></Card>
        <Card title="Doanh thu & Lợi nhuận theo kỳ" action={<Select value={period} onChange={(event) => setPeriod(event.target.value)}><option value="day">Theo ngày</option><option value="month">Theo tháng</option><option value="year">Theo năm</option></Select>}><FinancialChart data={chartData} keys={['revenue', 'profit']} /></Card>
      </div>
      <div className="chart-grid chart-grid--three">
        <Card title="Doanh thu" action={<Button variant="ghost" onClick={() => showFocus('revenue')}>{focus === 'revenue' ? 'Đang xem' : 'Xem chi tiết'}</Button>}><div className="filter-pills compact"><button className={period === 'day' ? 'active' : ''} onClick={() => setPeriod('day')}>Theo ngày</button><button className={period === 'month' ? 'active' : ''} onClick={() => setPeriod('month')}>Theo tháng</button><button className={period === 'year' ? 'active' : ''} onClick={() => setPeriod('year')}>Theo năm</button></div><TableWrap><thead><tr><th>Ngày</th><th>Doanh thu</th><th>Người tạo</th></tr></thead><tbody>{recent.map((item, index) => <tr key={item.day}><td>{period === 'day' ? `${item.day}/2026` : item.day}</td><td>{money(item.revenue)}</td><td>{['Nguyễn Văn A', 'Trần Thị B', 'Võ Thị Mai', 'Phạm Hoàng Dũng', 'Đặng Minh Khang'][index]}</td></tr>)}{!recent.length && <tr><td colSpan="3" style={{ textAlign: 'center' }}>Không có dữ liệu trong khoảng đã chọn.</td></tr>}<tr className="total-row"><td>Tổng</td><td>{money(recent.reduce((sum, item) => sum + item.revenue, 0))}</td><td /></tr></tbody></TableWrap></Card>
        <Card title="Chi phí" action={<Button variant="ghost" onClick={() => showFocus('expense')}>{focus === 'expense' ? 'Đang xem' : 'Xem chi tiết'}</Button>}><div className="expense-list">{expenseRows.map((item) => <div key={item.type} className={`expense-item expense-item--${item.tone}`}><span><Wallet /></span><div><strong>{item.type}</strong><small>{item.detail}</small></div><b>{money(item.value)}</b></div>)}</div><div className="mini-total danger"><span>Tổng chi phí</span><strong>{money(storeExpense)}</strong></div></Card>
        <Card title="Lợi nhuận" action={<Button variant="ghost" onClick={() => showFocus('profit')}>{focus === 'profit' ? 'Đang xem' : 'Xem chi tiết'}</Button>}><div className="donut-with-legend vertical"><DonutChart data={[{ name: 'Doanh thu', value: Math.max(0, revenue) }, { name: 'Tổng chi phí', value: Math.max(0, expense) }, { name: 'Lợi nhuận', value: Math.max(0, profit) }]} center={money(profit)} subcenter="Lợi nhuận" /><div className="legend-list"><p><i className="dot blue" />Doanh thu <strong>{money(revenue)}</strong></p><p><i className="dot orange" />Tổng chi phí <strong>{money(expense)}</strong></p><p><i className="dot green" />Lợi nhuận <strong>{money(profit)}</strong></p></div></div><InfoNote>Lợi nhuận = Doanh thu - Tổng chi phí</InfoNote></Card>
      </div>
      <div className="chart-grid"><Card title="Chi phí cố định gần đây"><TableWrap><thead><tr><th>Ngày</th><th>Loại chi phí</th><th>Số tiền</th><th>Ghi chú</th><th>Người tạo</th></tr></thead><tbody>{fixedItems.map((item) => <tr key={item.name}><td>{displayDate(filteredSeries[0]?.date || '2026-08-01')}</td><td>{item.name}</td><td>{money(fixedExpense * item.ratio)}</td><td>Phân bổ trong kỳ</td><td>Dữ liệu hệ thống</td></tr>)}</tbody></TableWrap></Card><Card title="Lương thưởng trong kỳ"><TableWrap><thead><tr><th>Khoản mục</th><th>Tổng tiền</th></tr></thead><tbody><tr><td>Tổng lương và thưởng</td><td>{money(employeePayroll)}</td></tr><tr><td>Chi phí nhập hàng</td><td>{money(importExpense)}</td></tr><tr><td>Chi phí cố định</td><td>{money(fixedExpense)}</td></tr><tr className="total-row"><td>Tổng cộng</td><td>{money(storeExpense)}</td></tr></tbody></TableWrap></Card></div>
    </div>
  )
}

export function StoreReports() {
  const { employees, attendance, activeStore } = useStoreScope()
  const [activeTab, setActiveTab] = useState('overview')
  const [period, setPeriod] = useState('month')
  const [range, setRange] = useState(currentRange(attendance.map((item) => item.date)))
  const filteredAttendance = attendance.filter((item) => dateInRange(item.date, range))
  const employeeRows = employees.map((employee) => {
    const records = filteredAttendance.filter((item) => item.employeeId === employee.id)
    const seeded = payRows.find((item) => item.employeeId === employee.id)
    const hours = records.reduce((sum, item) => sum + (Number(item.hours) || 0), 0)
    const base = calculateEmployeeBasePay(employee, { hours: hours || Number(seeded?.hours) || 0 })
    const bonus = (Number(seeded?.tiktokBonus) || 0) + (Number(seeded?.bonus) || 0)
    const allowance = (Number(seeded?.tiktokAllowance) || 0) + (Number(seeded?.other) || 0)
    return { employeeId: employee.id, employeeName: employee.name, hours, base, bonus, allowance, total: base + bonus + allowance }
  })
  const totals = employeeRows.reduce((sum, item) => ({ hours: sum.hours + item.hours, base: sum.base + item.base, bonus: sum.bonus + item.bonus, allowance: sum.allowance + item.allowance, total: sum.total + item.total }), { hours: 0, base: 0, bonus: 0, allowance: 0, total: 0 })
  const hoursData = Object.values(filteredAttendance.reduce((days, item) => {
    const key = item.date || 'Chưa có ngày'
    days[key] = days[key] || { day: displayDate(key).slice(0, 5), hours: 0 }
    days[key].hours += Number(item.hours) || 0
    return days
  }, {})).sort((left, right) => left.day.localeCompare(right.day))
  const storeRevenue = Number(activeStore?.revenue) || cashSeries.reduce((sum, item) => sum + item.revenue, 0) * 1000000
  const seedRevenue = Math.max(1, cashSeries.reduce((sum, item) => sum + item.revenue, 0))
  const revenueData = cashSeries.map((item) => ({ ...item, revenue: item.revenue * storeRevenue / seedRevenue / 1000000 }))
  const shiftRows = shifts.map((shift) => {
    const rows = filteredAttendance.filter((item) => item.shift === shift.id)
    return { id: shift.id, name: shift.name, time: shift.time, color: shift.color, employees: new Set(rows.map((item) => item.employeeId)).size, hours: rows.reduce((sum, item) => sum + (Number(item.hours) || 0), 0) }
  })
  const changePeriod = (nextPeriod) => {
    setPeriod(nextPeriod)
    const latest = [...attendance.map((item) => item.date).filter(Boolean)].sort().at(-1) || '2026-08-12'
    const [year, month] = latest.split('-')
    if (nextPeriod === 'day') setRange(`${displayDate(latest)} - ${displayDate(latest)}`)
    if (nextPeriod === 'month') {
      const lastDay = new Date(Number(year), Number(month), 0).getDate()
      setRange(`01/${month}/${year} - ${String(lastDay).padStart(2, '0')}/${month}/${year}`)
    }
    if (nextPeriod === 'year') setRange(`01/01/${year} - 31/12/${year}`)
  }
  const exportRows = activeTab === 'attendance' || activeTab === 'details'
    ? filteredAttendance.map((item) => ({ ...item, employee: employees.find((employee) => employee.id === item.employeeId)?.name || item.employeeId }))
    : activeTab === 'shifts'
      ? shiftRows
      : activeTab === 'employees'
        ? employees
        : employeeRows
  return (
    <div className="page">
      <PageHeader title="Báo cáo thống kê" subtitle={`Tổng hợp dữ liệu hoạt động của ${activeStore?.name || 'cửa hàng'}`} actions={<><DateRange value={range} onChange={setRange} /><Select value={period} onChange={(event) => changePeriod(event.target.value)}><option value="day">Xem theo: Ngày</option><option value="month">Xem theo: Tháng</option><option value="year">Xem theo: Năm</option></Select><Button icon={Download} onClick={() => downloadCsv(`bao-cao-${activeTab}.csv`, exportRows)}>Xuất báo cáo</Button></>} />
      <div className="tabs"><button className={activeTab === 'overview' ? 'active' : ''} onClick={() => setActiveTab('overview')}>Tổng quan</button><button className={activeTab === 'attendance' ? 'active' : ''} onClick={() => setActiveTab('attendance')}>Chấm công</button><button className={activeTab === 'payroll' ? 'active' : ''} onClick={() => setActiveTab('payroll')}>Lương thưởng</button><button className={activeTab === 'shifts' ? 'active' : ''} onClick={() => setActiveTab('shifts')}>Ca làm việc</button><button className={activeTab === 'employees' ? 'active' : ''} onClick={() => setActiveTab('employees')}>Nhân viên</button><button className={activeTab === 'details' ? 'active' : ''} onClick={() => setActiveTab('details')}>Chi tiết</button></div>
      <div className="metric-grid metric-grid--five">
        <MetricCard label="Tổng nhân viên" value={employees.length} suffix="người" helper="100% đang làm việc" icon={Users} tone="green" compact />
        <MetricCard label="Tổng giờ làm" value={totals.hours.toFixed(2)} suffix="giờ" helper={`TB: ${(totals.hours / Math.max(1, filteredAttendance.length)).toFixed(2)} giờ/lượt`} icon={Clock3} tone="green" compact />
        <MetricCard label="Tổng lương cứng" value={money(totals.base)} helper="Theo cơ chế từng nhân viên" icon={Banknote} tone="green" compact />
        <MetricCard label="Tổng thưởng" value={money(totals.bonus + totals.allowance)} helper="Thưởng + phụ cấp" icon={Gift} tone="green" compact />
        <MetricCard label="Tổng lương nhận" value={money(totals.total)} helper="Tổng chi trả nhân viên" icon={Wallet} tone="green" compact />
      </div>
      {activeTab === 'overview' && <>
        <div className="chart-grid chart-grid--three">
          <Card title="Giờ làm việc theo ngày">{hoursData.length ? <FinancialChart data={hoursData} type="bar" keys={['hours']} height={245} hideLegend /> : <InfoNote>Chưa có dữ liệu chấm công trong kỳ đã chọn.</InfoNote>}</Card>
          <Card title="Doanh thu theo ngày"><FinancialChart data={revenueData} keys={['revenue']} height={245} hideLegend /></Card>
          <Card title="Cơ cấu lương nhận"><div className="donut-with-legend"><DonutChart data={[{ name: 'Lương cứng', value: totals.base }, { name: 'Thưởng', value: totals.bonus }, { name: 'Phụ cấp', value: totals.allowance }]} center={money(totals.total)} subcenter="Tổng lương nhận" /><div className="legend-list"><p><i className="dot green" />Lương cứng <strong>{totals.total ? (totals.base / totals.total * 100).toFixed(1) : 0}%</strong></p><p><i className="dot teal" />Thưởng <strong>{totals.total ? (totals.bonus / totals.total * 100).toFixed(1) : 0}%</strong></p><p><i className="dot orange" />Phụ cấp <strong>{totals.total ? (totals.allowance / totals.total * 100).toFixed(1) : 0}%</strong></p></div></div></Card>
        </div>
        <div className="chart-grid chart-grid--wide">
          <Card title="Thống kê theo nhân viên"><TableWrap><thead><tr><th>Nhân viên</th><th>Tổng giờ làm</th><th>Lương cứng</th><th>Thưởng</th><th>Phụ cấp</th><th>Lương nhận</th></tr></thead><tbody>{employeeRows.map((row) => { const employee = employees.find((item) => item.id === row.employeeId); return <tr key={row.employeeId}><td><div className="person-cell"><Avatar name={employee?.name} color={employee?.color} /><span><strong>{employee?.name}</strong><small>{employee?.shortRole}</small></span></div></td><td>{row.hours.toFixed(2)}</td><td>{money(row.base)}</td><td className="green-text">{money(row.bonus)}</td><td className="orange-text">{money(row.allowance)}</td><td className="green-text"><strong>{money(row.total)}</strong></td></tr> })}<tr className="total-row"><td>TỔNG CỘNG</td><td>{totals.hours.toFixed(2)}</td><td>{money(totals.base)}</td><td>{money(totals.bonus)}</td><td>{money(totals.allowance)}</td><td>{money(totals.total)}</td></tr></tbody></TableWrap></Card>
          <div className="stacked-cards"><Card title="Thống kê ca làm việc"><div className="progress-list">{shiftRows.map((shift) => <div key={shift.id}><span>{shift.name} <small>({shift.time})</small></span><b>{shift.hours.toFixed(2)} giờ</b><Progress value={totals.hours ? shift.hours / totals.hours * 100 : 0} color={shift.color} /></div>)}</div></Card><Card title="Tình trạng chấm công"><div className="summary-list"><p><span>Đúng giờ</span><strong>{filteredAttendance.filter((item) => item.status === 'Đúng giờ').length}</strong></p><p><span>Đi sớm</span><strong>{filteredAttendance.filter((item) => item.status === 'Đi sớm').length}</strong></p><p><span>Trễ</span><strong>{filteredAttendance.filter((item) => item.status === 'Trễ').length}</strong></p></div></Card></div>
        </div>
      </>}
      {activeTab === 'attendance' && <Card title="Báo cáo chấm công"><TableWrap><thead><tr><th>Ngày</th><th>Nhân viên</th><th>Ca</th><th>Giờ vào</th><th>Giờ ra</th><th>Số giờ</th><th>Trạng thái</th></tr></thead><tbody>{filteredAttendance.map((item) => { const employee = employees.find((row) => row.id === item.employeeId); return <tr key={item.id}><td>{displayDate(item.date)}</td><td>{employee?.name || item.employeeId}</td><td>{findShift(item.shift)?.name || item.shift}</td><td>{item.checkIn}</td><td>{item.checkOut || '—'}</td><td>{Number(item.hours || 0).toFixed(2)}</td><td><Badge tone={item.status === 'Trễ' ? 'orange' : 'green'}>{item.status}</Badge></td></tr> })}{!filteredAttendance.length && <tr><td colSpan="7" style={{ textAlign: 'center' }}>Không có dữ liệu chấm công trong kỳ.</td></tr>}</tbody></TableWrap></Card>}
      {activeTab === 'payroll' && <Card title="Báo cáo lương thưởng"><TableWrap><thead><tr><th>Nhân viên</th><th>Cơ chế</th><th>Giờ làm</th><th>Lương cứng</th><th>Thưởng</th><th>Phụ cấp</th><th>Tổng nhận</th></tr></thead><tbody>{employeeRows.map((row) => { const employee = employees.find((item) => item.id === row.employeeId); return <tr key={row.employeeId}><td>{row.employeeName}</td><td><Badge tone={getPayBasis(employee) === 'hourly' ? 'green' : 'blue'}>{salaryBasisLabel(employee)}</Badge></td><td>{row.hours.toFixed(2)}</td><td>{money(row.base)}</td><td>{money(row.bonus)}</td><td>{money(row.allowance)}</td><td><strong>{money(row.total)}</strong></td></tr> })}<tr className="total-row"><td colSpan="2">TỔNG CỘNG</td><td>{totals.hours.toFixed(2)}</td><td>{money(totals.base)}</td><td>{money(totals.bonus)}</td><td>{money(totals.allowance)}</td><td>{money(totals.total)}</td></tr></tbody></TableWrap></Card>}
      {activeTab === 'shifts' && <Card title="Báo cáo ca làm việc"><TableWrap><thead><tr><th>Ca làm việc</th><th>Khung giờ</th><th>Nhân viên</th><th>Tổng giờ</th><th>Tỷ trọng</th></tr></thead><tbody>{shiftRows.map((shift) => <tr key={shift.id}><td><strong style={{ color: shift.color }}>{shift.name}</strong></td><td>{shift.time}</td><td>{shift.employees}</td><td>{shift.hours.toFixed(2)} giờ</td><td><Progress value={totals.hours ? shift.hours / totals.hours * 100 : 0} color={shift.color} /></td></tr>)}</tbody></TableWrap></Card>}
      {activeTab === 'employees' && <Card title="Báo cáo nhân viên"><TableWrap><thead><tr><th>Mã nhân viên</th><th>Nhân viên</th><th>Vị trí</th><th>Loại nhân viên</th><th>Cơ chế lương</th><th>Trạng thái</th></tr></thead><tbody>{employees.map((employee) => <tr key={employee.id}><td>{employee.code || employee.id}</td><td><div className="person-cell"><Avatar name={employee.name} color={employee.color} /><strong>{employee.name}</strong></div></td><td>{employee.position || employee.role}</td><td><Badge tone={getPayBasis(employee) === 'hourly' ? 'green' : 'blue'}>{employee.employmentType || employee.type}</Badge></td><td>{salaryBasisLabel(employee)}</td><td><Badge>{employee.status || 'Đang làm việc'}</Badge></td></tr>)}</tbody></TableWrap></Card>}
      {activeTab === 'details' && <Card title="Dữ liệu chi tiết"><TableWrap><thead><tr><th>Ngày</th><th>Nhân viên</th><th>Giờ vào</th><th>Giờ ra</th><th>Số giờ</th><th>Trạng thái</th><th>Ghi chú</th></tr></thead><tbody>{filteredAttendance.map((item) => <tr key={item.id}><td>{displayDate(item.date)}</td><td>{employees.find((employee) => employee.id === item.employeeId)?.name || item.employeeId}</td><td>{item.checkIn}</td><td>{item.checkOut || '—'}</td><td>{Number(item.hours || 0).toFixed(2)}</td><td>{item.status}</td><td>{item.note || '—'}</td></tr>)}</tbody></TableWrap></Card>}
    </div>
  )
}

const storeSettingsForm = (store = {}) => ({
  name: store.name || 'IDOSI',
  phone: store.phone ?? '',
  email: store.email ?? 'cuahang@idosi.vn',
  address: store.address ?? '',
  tax: store.tax ?? store.taxCode ?? '',
  opening: store.opening ?? store.openingTime ?? '07:00',
  closing: store.closing ?? store.closingTime ?? '23:00',
})

export function StoreSettings() {
  const { notify, stores = [], activeStoreId, session, updateStore } = useApp()
  const selectedStoreId = session?.role === 'employee' ? session.storeId : activeStoreId || session?.storeId
  const activeStore = stores.find((item) => item.id === selectedStoreId) || stores[0]
  const [tab, setTab] = useState('info')
  const [form, setForm] = useState(() => storeSettingsForm(activeStore))
  useEffect(() => {
    // Đồng bộ biểu mẫu khi quản trị viên chuyển sang một cửa hàng khác.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setForm(storeSettingsForm(activeStore))
  }, [activeStore])
  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }))
  const save = async () => {
    if (!activeStore?.id) return notify('Không tìm thấy cửa hàng cần cập nhật.', 'info')
    if (!form.name.trim()) return notify('Tên cửa hàng không được để trống.', 'info')
    if (form.email && !/^\S+@\S+\.\S+$/.test(form.email)) return notify('Email cửa hàng chưa đúng định dạng.', 'info')
    if (!form.opening || !form.closing) return notify('Vui lòng nhập đầy đủ giờ mở cửa và đóng cửa.', 'info')
    if (typeof updateStore !== 'function') return notify('Chức năng cập nhật cửa hàng chưa sẵn sàng.', 'info')
    const payload = {
      name: form.name.trim(),
      phone: form.phone.trim(),
      email: form.email.trim(),
      address: form.address.trim(),
      tax: form.tax.trim(),
      taxCode: form.tax.trim(),
      opening: form.opening,
      openingTime: form.opening,
      closing: form.closing,
      closingTime: form.closing,
    }
    const result = await updateStore(activeStore.id, payload)
    if (!result?.ok || !result.store) return notify(result?.message || 'Máy chủ chưa ghi nhận cài đặt cửa hàng.', 'info')
    const persisted = storeSettingsForm(result.store)
    if (Object.keys(form).some((key) => String(persisted[key] ?? '') !== String(form[key] ?? '').trim())) {
      return notify('Máy chủ chưa ghi nhận đầy đủ cài đặt cửa hàng.', 'info')
    }
    setForm(persisted)
  }
  return (
    <div className="page settings-page">
      <PageHeader title="Cài đặt cửa hàng" subtitle={`Quản lý thông tin và cấu hình hoạt động của ${form.name}`} icon={Settings} />
      <div className="settings-layout">
        <Card className="settings-nav" title="Cài đặt"><button className={tab === 'info' ? 'active' : ''} onClick={() => setTab('info')}><Store />Thông tin cửa hàng</button><button className={tab === 'hours' ? 'active' : ''} onClick={() => setTab('hours')}><Clock3 />Giờ hoạt động</button><button className={tab === 'payroll' ? 'active' : ''} onClick={() => setTab('payroll')}><Banknote />Thiết lập lương</button></Card>
        <Card className="settings-content"><h2>{tab === 'hours' ? 'Giờ hoạt động' : tab === 'payroll' ? 'Thiết lập lương nhân viên' : 'Thông tin cửa hàng'}</h2><p>{tab === 'payroll' ? 'Mức lương được thiết lập trực tiếp trong hồ sơ từng nhân viên.' : 'Cập nhật thông tin hiển thị và dữ liệu vận hành.'}</p><div className="store-settings-hero"><Store size={42} /><div><strong>{form.name}</strong><small>Đang hoạt động</small></div><Badge>Hoạt động</Badge></div>{tab === 'info' && <div className="form-grid"><Field label="Tên cửa hàng"><Input value={form.name} onChange={set('name')} /></Field><Field label="Số điện thoại"><Input value={form.phone} onChange={set('phone')} /></Field><Field label="Email"><Input value={form.email} onChange={set('email')} /></Field><Field label="Mã số thuế"><Input value={form.tax} onChange={set('tax')} /></Field><Field label="Địa chỉ" className="span-2"><Input value={form.address} onChange={set('address')} /></Field></div>}{tab === 'hours' && <div className="form-grid"><Field label="Giờ mở cửa"><Input type="time" value={form.opening} onChange={set('opening')} /></Field><Field label="Giờ đóng cửa"><Input type="time" value={form.closing} onChange={set('closing')} /></Field></div>}{tab === 'payroll' && <InfoNote>Full-time được thiết lập lương theo tháng; Part-time được thiết lập lương theo giờ tại danh mục Nhân viên. Bảng lương sẽ tự động áp dụng đúng cơ chế.</InfoNote>}<div className="card-actions"><Button icon={Save} onClick={save}>Lưu thay đổi</Button></div></Card>
      </div>
    </div>
  )
}
