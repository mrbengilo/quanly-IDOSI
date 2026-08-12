import { useState } from 'react'
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
  PageHeader,
  Progress,
  SearchInput,
  Select,
  TableWrap,
} from '../../components/UI'
import { cashSeries, payRows, shifts } from '../../data'
import { useApp } from '../../state/AppContext'
import { downloadCsv, money } from '../../utils'

const findShift = (id) => shifts.find((shift) => shift.id === id)

const useStoreScope = () => {
  const app = useApp()
  const stores = Array.isArray(app.stores) ? app.stores : []
  const storeId = app.session?.storeId || app.activeStoreId || stores[0]?.id || ''
  const employees = (Array.isArray(app.employees) ? app.employees : []).filter((employee) =>
    employee.unit !== 'office' && String(employee.storeId || stores[0]?.id || '') === String(storeId),
  )
  const employeeIds = new Set(employees.map((employee) => String(employee.id)))
  const attendance = (Array.isArray(app.attendance) ? app.attendance : []).filter((record) =>
    record.storeId ? String(record.storeId) === String(storeId) : employeeIds.has(String(record.employeeId)),
  )
  return { ...app, stores, storeId, employees, attendance }
}

export function StoreAttendance() {
  const { attendance, employees } = useStoreScope()
  const [query, setQuery] = useState('')
  const [shift, setShift] = useState('all')
  const filtered = attendance.filter((item) => {
    const employee = employees.find((person) => person.id === item.employeeId)
    return employee?.name.toLowerCase().includes(query.toLowerCase()) && (shift === 'all' || item.shift === shift)
  })
  const totalHours = filtered.reduce((sum, item) => sum + (Number(item.hours) || 0), 0)
  const totalPay = Math.round(totalHours * 20000)
  return (
    <div className="page">
      <PageHeader title="Chấm công" subtitle="Theo dõi giờ làm việc của nhân viên" actions={<><DateRange value="15/05/2025 (Thứ Năm)" /><Button variant="outline">‹</Button><Button variant="outline">›</Button><Button variant="outline" icon={Filter}>Bộ lọc</Button><ExportButton onClick={() => downloadCsv('cham-cong.csv', filtered)} /></>} />
      <div className="metric-grid metric-grid--four">
        <MetricCard label="Tổng số nhân viên" value={new Set(filtered.map((item) => item.employeeId)).size} suffix="người" icon={Clock3} tone="green" compact />
        <MetricCard label="Tổng giờ làm" value={totalHours.toFixed(2)} suffix="giờ" helper={`TB: ${(totalHours / Math.max(1, filtered.length)).toFixed(2)} giờ/người`} icon={Clock3} tone="green" compact />
        <MetricCard label="Tổng lương cứng" value={money(totalPay)} helper="20.000 đ/giờ" icon={Banknote} tone="green" compact />
        <MetricCard label="Tổng lương nhận" value={money(totalPay)} icon={Wallet} tone="green" compact />
      </div>
      <Card>
        <div className="card__subheader"><div className="tabs"><button className="active">Tổng hợp theo ngày</button><button>Chi tiết theo ca</button></div><div><SearchInput value={query} onChange={setQuery} placeholder="Tìm kiếm nhân viên..." /><Select value={shift} onChange={(event) => setShift(event.target.value)}><option value="all">Tất cả ca</option>{shifts.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</Select><Select defaultValue="all"><option value="all">Tất cả trạng thái</option><option>Đúng giờ</option><option>Trễ</option></Select></div></div>
        <TableWrap><thead><tr><th>STT</th><th>Nhân viên</th><th>Ca làm việc</th><th>Giờ vào</th><th>Giờ kết ca</th><th>Số giờ làm</th><th>Lương cứng</th><th>Lương nhận</th><th>Trạng thái</th><th>Ghi chú</th></tr></thead><tbody>{filtered.map((item, index) => {
          const employee = employees.find((person) => person.id === item.employeeId)
          const workShift = findShift(item.shift)
          const hours = Number(item.hours) || 0
          return <tr key={item.id}><td>{index + 1}</td><td><div className="person-cell"><Avatar name={employee?.name} color={employee?.color} /><span><strong>{employee?.name}</strong><small>{employee?.shortRole}</small></span></div></td><td><strong style={{ color: workShift?.color }}>{workShift?.name}</strong><small className="table-sub">({workShift?.time})</small></td><td className="green-text"><strong>{item.checkIn}</strong></td><td className={item.status === 'Trễ' ? 'orange-text' : 'red-text'}><strong>{item.checkOut || '—'}</strong></td><td><strong>{hours.toFixed(2)}</strong><small className="table-sub">giờ</small></td><td>{money(hours * 20000)}</td><td className="green-text"><strong>{money(hours * 20000)}</strong></td><td><Badge tone={item.status === 'Trễ' ? 'orange' : 'green'}>{item.status}</Badge></td><td>{item.note || '–'}</td></tr>
        })}<tr className="total-row"><td colSpan="5">TỔNG CỘNG</td><td>{totalHours.toFixed(2)} giờ</td><td>{money(totalPay)}</td><td>{money(totalPay)}</td><td colSpan="2">–</td></tr></tbody></TableWrap>
      </Card>
      <div className="bottom-info-grid">
        <Card title="Giải thích"><ul className="plain-list"><li>Số giờ làm = Giờ kết ca - Giờ vào</li><li>Lương cứng = Số giờ làm × 20.000 đ</li><li>Lương nhận = Lương cứng + Phụ cấp + Thưởng - Khấu trừ</li></ul></Card>
        <Card title="Tổng hợp theo ca"><div className="shift-totals">{shifts.map((item) => { const hours = filtered.filter((row) => row.shift === item.id).reduce((total, row) => total + (Number(row.hours) || 0), 0); return <div key={item.id}><strong style={{ color: item.color }}>{item.name}</strong><b>{hours.toFixed(2)} giờ</b><small>{money(hours * 20000)}</small></div> })}</div></Card>
        <Card title="Tỷ lệ chấm công"><div className="donut-with-legend"><DonutChart height={185} data={[{ name: 'Đúng giờ', value: filtered.filter((item) => item.status === 'Đúng giờ').length }, { name: 'Trễ', value: filtered.filter((item) => item.status === 'Trễ').length }]} center={filtered.length} subcenter="Tổng số" /><div className="legend-list"><p><i className="dot green" />Đúng giờ <strong>{filtered.filter((item) => item.status === 'Đúng giờ').length}</strong></p><p><i className="dot orange" />Trễ <strong>{filtered.filter((item) => item.status === 'Trễ').length}</strong></p></div></div></Card>
      </div>
    </div>
  )
}

export function StorePayroll() {
  const { employees, attendance } = useStoreScope()
  const rows = employees.map((employee) => {
    const seeded = payRows.find((row) => row.employeeId === employee.id)
    if (seeded) return seeded
    const employeeAttendance = attendance.filter((record) => record.employeeId === employee.id)
    const hours = employeeAttendance.reduce((total, record) => total + (Number(record.hours) || 0), 0)
    return { employeeId: employee.id, hours, base: Math.round(hours * (Number(employee.hourlyRate) || 20000)), tiktokAllowance: 0, tiktokBonus: 0, other: 0, bonus: 0 }
  })
  const totals = rows.reduce((acc, row) => ({ hours: acc.hours + row.hours, base: acc.base + row.base, tiktokAllowance: acc.tiktokAllowance + row.tiktokAllowance, tiktokBonus: acc.tiktokBonus + row.tiktokBonus, other: acc.other + row.other, bonus: acc.bonus + row.bonus }), { hours: 0, base: 0, tiktokAllowance: 0, tiktokBonus: 0, other: 0, bonus: 0 })
  const totalPay = totals.base + totals.tiktokAllowance + totals.tiktokBonus + totals.other + totals.bonus
  const hoursData = cashSeries.map((item, index) => ({ day: item.day.slice(0, 2), hours: 16 + (item.revenue % 15) + (index % 3) }))
  return (
    <div className="page">
      <PageHeader title="Lương thưởng nhân viên" subtitle="Quản lý và tổng hợp lương thưởng" actions={<><div className="segmented"><button>Ngày</button><button className="active">Tháng</button></div><DateRange value="08/2026 (Tháng 8/2026)" /><ExportButton onClick={() => downloadCsv('luong-thuong.csv', rows)} /></>} />
      <Card className="period-strip"><span>Thời gian:</span><strong><CalendarDays />01/05/2025 - 31/05/2025</strong><div><Button variant="outline">‹</Button><Button variant="outline">Hôm nay</Button><Button variant="outline">›</Button></div></Card>
      <div className="metric-grid metric-grid--six">
        <MetricCard label="Tổng giờ làm" value={totals.hours.toFixed(2)} suffix="giờ" helper="Trung bình/người: 204.17 giờ" icon={Clock3} tone="green" compact />
        <MetricCard label="Tổng lương" value={money(totals.base)} helper="Lương cứng: 20,000 đ/giờ" icon={Banknote} tone="green" compact />
        <MetricCard label="Tổng thưởng" value={money(totals.tiktokBonus + totals.bonus)} helper="Trung bình/người" icon={Gift} tone="orange" compact />
        <MetricCard label="Tổng phụ cấp" value={money(totals.tiktokAllowance + totals.other)} helper="Phụ cấp TikTok + khác" icon={Wallet} tone="green" compact />
        <MetricCard label="Tổng chi trả" value={money(totalPay)} helper="Tổng lương + thưởng + phụ cấp" icon={Users} tone="teal" compact />
        <MetricCard label="Tổng nhân viên" value={rows.length} suffix="nhân viên" helper="Đang làm việc" icon={UserRound} tone="green" compact />
      </div>
      <Card title="Chi tiết lương thưởng nhân viên">
        <TableWrap><thead><tr><th>STT</th><th>Nhân viên</th><th>Tổng giờ làm</th><th>Lương cứng</th><th>Phụ cấp TikTok</th><th>Thưởng TikTok</th><th>Thưởng / Phụ cấp khác</th><th>Thưởng</th><th>Tổng nhận</th><th>Chi tiết</th></tr></thead><tbody>{rows.map((row, index) => { const employee = employees.find((item) => item.id === row.employeeId); const total = row.base + row.tiktokAllowance + row.tiktokBonus + row.other + row.bonus; return <tr key={row.employeeId}><td>{index + 1}</td><td><div className="person-cell"><Avatar name={employee?.name} color={employee?.color} /><span><strong>{employee?.name}</strong><small>{employee?.role}</small></span></div></td><td><strong>{row.hours.toFixed(2)}</strong><small className="table-sub">(26 ngày)</small></td><td>{money(row.base)}</td><td className="green-text">{money(row.tiktokAllowance)}</td><td className="green-text">{money(row.tiktokBonus)}</td><td className="orange-text">{money(row.other)}</td><td className="green-text">{money(row.bonus)}</td><td><strong>{money(total)}</strong></td><td><Button variant="outline">Xem chi tiết</Button></td></tr> })}<tr className="total-row"><td colSpan="2">TỔNG CỘNG</td><td>{totals.hours.toFixed(2)} giờ</td><td>{money(totals.base)}</td><td>{money(totals.tiktokAllowance)}</td><td>{money(totals.tiktokBonus)}</td><td>{money(totals.other)}</td><td>{money(totals.bonus)}</td><td>{money(totalPay)}</td><td /></tr></tbody></TableWrap>
      </Card>
      <div className="chart-grid chart-grid--three">
        <Card title="Cơ cấu chi trả"><DonutChart data={[{ name: 'Lương cứng', value: totals.base }, { name: 'Thưởng TikTok', value: totals.tiktokBonus }, { name: 'Phụ cấp khác', value: totals.other }, { name: 'Phụ cấp TikTok', value: totals.tiktokAllowance }, { name: 'Thưởng khác', value: totals.bonus }]} center={money(totalPay)} subcenter="Tổng chi trả" /></Card>
        <Card title="Thống kê theo ngày (Tổng giờ làm)"><FinancialChart data={hoursData} type="bar" keys={['hours']} height={240} hideLegend /></Card>
        <Card title="Tóm tắt nhanh"><div className="summary-list"><p><span>Lương cứng</span><strong>{money(totals.base)}</strong></p><p><span>Phụ cấp TikTok</span><strong>{money(totals.tiktokAllowance)}</strong></p><p><span>Thưởng TikTok</span><strong>{money(totals.tiktokBonus)}</strong></p><p><span>Thưởng / PC khác</span><strong>{money(totals.other + totals.bonus)}</strong></p><p className="total"><span>Tổng chi trả</span><strong>{money(totalPay)}</strong></p></div></Card>
      </div>
    </div>
  )
}

export function StoreCashflow() {
  const revenue = 350000000
  const expense = 196350000
  const profit = revenue - expense
  const expenseRows = [
    { type: 'Chi phí cố định', detail: 'Điện, nước, wifi, rác, mặt bằng', value: 26500000, tone: 'orange' },
    { type: 'Lương thưởng nhân viên', detail: 'Tổng lương và thưởng trong kỳ', value: 45000000, tone: 'purple' },
    { type: 'Chi phí nhập hàng', detail: 'Tổng thành tiền các phiếu nhập', value: 124850000, tone: 'blue' },
  ]
  const recent = cashSeries.slice(-5).reverse()
  return (
    <div className="page">
      <PageHeader title="Dòng tiền" subtitle="Trang chủ  ›  Dòng tiền  ›  Dashboard" actions={<><DateRange value="01/05/2025 - 15/05/2025" /><Button variant="outline" icon={Filter}>Bộ lọc</Button></>} />
      <div className="metric-grid metric-grid--four">
        <MetricCard label="DOANH THU" value={money(revenue)} trend={12.5} helper=" so với 16/04 - 30/04" icon={BarChart3} tone="blue" compact />
        <MetricCard label="TỔNG CHI PHÍ" value={money(expense)} trend={8.3} helper=" so với 16/04 - 30/04" icon={Wallet} tone="orange" compact />
        <MetricCard label="LỢI NHUẬN" value={money(profit)} trend={18.9} helper=" so với 16/04 - 30/04" icon={TrendingUp} tone="green" compact />
        <MetricCard label="BIÊN LỢI NHUẬN" value="43.90%" trend={5.1} helper=" so với 16/04 - 30/04" icon={PieChart} tone="purple" compact />
      </div>
      <div className="chart-grid">
        <Card title="Doanh thu theo ngày" action={<Select defaultValue="day"><option value="day">Theo ngày</option></Select>}><FinancialChart data={cashSeries} type="bar" keys={['revenue']} /></Card>
        <Card title="Doanh thu & Lợi nhuận theo ngày" action={<Select defaultValue="day"><option value="day">Theo ngày</option></Select>}><FinancialChart data={cashSeries} keys={['revenue', 'profit']} /></Card>
      </div>
      <div className="chart-grid chart-grid--three">
        <Card title="Doanh thu" action={<Button variant="ghost">Xem chi tiết</Button>}><div className="filter-pills compact"><button className="active">Theo ngày</button><button>Theo tháng</button><button>Theo năm</button></div><TableWrap><thead><tr><th>Ngày</th><th>Doanh thu</th><th>Người tạo</th></tr></thead><tbody>{recent.map((item, index) => <tr key={item.day}><td>{item.day}/2025</td><td>{money(item.revenue * 1000000)}</td><td>{['Nguyễn Văn A', 'Trần Thị B', 'Võ Thị Mai', 'Phạm Hoàng Dũng', 'Đặng Minh Khang'][index]}</td></tr>)}<tr className="total-row"><td>Tổng</td><td>{money(recent.reduce((sum, item) => sum + item.revenue * 1000000, 0))}</td><td /></tr></tbody></TableWrap></Card>
        <Card title="Chi phí" action={<Button variant="ghost">Xem chi tiết</Button>}><div className="expense-list">{expenseRows.map((item) => <div key={item.type} className={`expense-item expense-item--${item.tone}`}><span><Wallet /></span><div><strong>{item.type}</strong><small>{item.detail}</small></div><b>{money(item.value)}</b></div>)}</div><div className="mini-total danger"><span>Tổng chi phí</span><strong>{money(expense)}</strong></div></Card>
        <Card title="Lợi nhuận" action={<Button variant="ghost">Xem chi tiết</Button>}><div className="donut-with-legend vertical"><DonutChart data={[{ name: 'Doanh thu', value: revenue }, { name: 'Tổng chi phí', value: expense }, { name: 'Lợi nhuận', value: profit }]} center={money(profit)} subcenter="Lợi nhuận" /><div className="legend-list"><p><i className="dot blue" />Doanh thu <strong>{money(revenue)}</strong></p><p><i className="dot orange" />Tổng chi phí <strong>{money(expense)}</strong></p><p><i className="dot green" />Lợi nhuận <strong>{money(profit)}</strong></p></div></div><InfoNote>Lợi nhuận = Doanh thu - Tổng chi phí</InfoNote></Card>
      </div>
      <div className="chart-grid"><Card title="Chi phí cố định gần đây"><TableWrap><thead><tr><th>Ngày</th><th>Loại chi phí</th><th>Số tiền</th><th>Ghi chú</th><th>Người tạo</th></tr></thead><tbody>{['Điện', 'Nước', 'Wifi', 'Mặt bằng', 'Rác'].map((name, index) => <tr key={name}><td>01/05/2025</td><td>{name}</td><td>{money([3500000, 650000, 450000, 18000000, 300000][index])}</td><td>–</td><td>Nguyễn Văn A</td></tr>)}</tbody></TableWrap></Card><Card title="Lương thưởng (05/2025)"><TableWrap><thead><tr><th>Khoản mục</th><th>Tổng tiền</th></tr></thead><tbody><tr><td>Tổng lương</td><td>{money(42000000)}</td></tr><tr><td>Tổng thưởng</td><td>{money(3000000)}</td></tr><tr className="total-row"><td>Tổng cộng</td><td>{money(45000000)}</td></tr></tbody></TableWrap></Card></div>
    </div>
  )
}

export function StoreReports() {
  const { employees, attendance } = useStoreScope()
  const totalHours = 210
  const base = 4200000
  const bonus = 900000
  const total = base + bonus
  const hoursData = cashSeries.map((item, index) => ({ day: item.day.slice(0, 2), hours: 8 + ((item.revenue + index) % 12) }))
  return (
    <div className="page">
      <PageHeader title="Báo cáo thống kê" subtitle="Tổng hợp dữ liệu hoạt động của cửa hàng" actions={<><DateRange value="01/05/2025 - 31/05/2025" /><Select defaultValue="month"><option value="month">Xem theo: Tháng</option></Select><Button icon={Download}>Xuất báo cáo</Button></>} />
      <div className="tabs"><button className="active">Tổng quan</button><button>Chấm công</button><button>Lương thưởng</button><button>Ca làm việc</button><button>Nhân viên</button><button>Chi tiết</button></div>
      <div className="metric-grid metric-grid--five">
        <MetricCard label="Tổng nhân viên" value={employees.length} suffix="người" helper="100% đang làm việc" icon={Users} tone="green" compact />
        <MetricCard label="Tổng giờ làm" value={totalHours.toFixed(2)} suffix="giờ" helper="TB: 7.00 giờ/ngày" icon={Clock3} tone="green" compact />
        <MetricCard label="Tổng lương cứng" value={money(base)} helper="20.000 đ/giờ" icon={Banknote} tone="green" compact />
        <MetricCard label="Tổng thưởng" value={money(bonus)} helper="Thưởng + phụ cấp" icon={Gift} tone="green" compact />
        <MetricCard label="Tổng lương nhận" value={money(total)} helper="Tổng chi trả nhân viên" icon={Wallet} tone="green" compact />
      </div>
      <div className="chart-grid chart-grid--three">
        <Card title="Giờ làm việc theo ngày"><FinancialChart data={hoursData} type="bar" keys={['hours']} height={245} hideLegend /></Card>
        <Card title="Doanh thu theo ngày"><FinancialChart data={cashSeries} keys={['revenue']} height={245} hideLegend /></Card>
        <Card title="Cơ cấu lương nhận"><div className="donut-with-legend"><DonutChart data={[{ name: 'Lương cứng', value: base }, { name: 'Thưởng', value: 600000 }, { name: 'Phụ cấp', value: 300000 }]} center={money(total)} subcenter="Tổng lương nhận" /><div className="legend-list"><p><i className="dot green" />Lương cứng <strong>82.4%</strong></p><p><i className="dot teal" />Thưởng <strong>11.8%</strong></p><p><i className="dot orange" />Phụ cấp <strong>5.8%</strong></p></div></div></Card>
      </div>
      <div className="chart-grid chart-grid--wide">
        <Card title="Thống kê theo nhân viên"><TableWrap><thead><tr><th>Nhân viên</th><th>Tổng giờ làm</th><th>Lương cứng</th><th>Thưởng</th><th>Phụ cấp</th><th>Lương nhận</th></tr></thead><tbody>{employees.slice(0, 3).map((employee, index) => <tr key={employee.id}><td><div className="person-cell"><Avatar name={employee.name} color={employee.color} /><span><strong>{employee.name}</strong><small>{employee.shortRole}</small></span></div></td><td>{[75.5, 68, 66.5][index]}</td><td>{money([1510000, 1360000, 1330000][index])}</td><td className="green-text">{money([250000, 200000, 450000][index])}</td><td className="orange-text">{money(100000)}</td><td className="green-text"><strong>{money([1860000, 1660000, 1880000][index])}</strong></td></tr>)}<tr className="total-row"><td>TỔNG CỘNG</td><td>210.00</td><td>{money(base)}</td><td>{money(bonus)}</td><td>{money(300000)}</td><td>{money(total)}</td></tr></tbody></TableWrap></Card>
        <div className="stacked-cards"><Card title="Thống kê ca làm việc"><div className="progress-list">{shifts.map((shift, index) => <div key={shift.id}><span>{shift.name} <small>({shift.time})</small></span><b>{[62.5, 71, 76.5][index]} giờ</b><Progress value={[29.8, 33.8, 36.4][index]} color={shift.color} /></div>)}</div></Card><Card title="Tình trạng chấm công"><div className="summary-list"><p><span>Đúng giờ</span><strong>{attendance.filter((item) => item.status === 'Đúng giờ').length}</strong></p><p><span>Trễ</span><strong>{attendance.filter((item) => item.status === 'Trễ').length}</strong></p><p><span>Vắng</span><strong>0</strong></p></div></Card></div>
      </div>
    </div>
  )
}

export function StoreSettings() {
  const { notify, stores = [], activeStoreId, session } = useApp()
  const activeStore = stores.find((item) => item.id === (session?.storeId || activeStoreId)) || stores[0]
  const [form, setForm] = useState({ name: activeStore?.name || 'IDOSI', phone: activeStore?.phone || '', email: activeStore?.email || 'cuahang@idosi.vn', address: activeStore?.address || '', tax: activeStore?.tax || '', manager: session?.name || 'Quản lý cửa hàng', opening: activeStore?.opening || '07:00', closing: activeStore?.closing || '23:00' })
  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }))
  return (
    <div className="page settings-page">
      <PageHeader title="Cài đặt cửa hàng" subtitle={`Quản lý thông tin và cấu hình hoạt động của ${form.name}`} icon={Settings} />
      <div className="settings-layout">
        <Card className="settings-nav" title="Cài đặt"><button className="active"><Store />Thông tin cửa hàng</button><button><Clock3 />Giờ hoạt động</button><button><UserRound />Tài khoản quản lý</button><button><Banknote />Thiết lập lương</button></Card>
        <Card className="settings-content"><h2>Thông tin cửa hàng</h2><p>Cập nhật thông tin hiển thị và dữ liệu vận hành.</p><div className="store-settings-hero"><Store size={42} /><div><strong>{form.name}</strong><small>Đang hoạt động</small></div><Badge>Hoạt động</Badge></div><div className="form-grid"><Field label="Tên cửa hàng"><Input value={form.name} onChange={set('name')} /></Field><Field label="Người quản lý"><Input value={form.manager} onChange={set('manager')} /></Field><Field label="Số điện thoại"><Input value={form.phone} onChange={set('phone')} /></Field><Field label="Email"><Input value={form.email} onChange={set('email')} /></Field><Field label="Mã số thuế"><Input value={form.tax} onChange={set('tax')} /></Field><Field label="Địa chỉ" className="span-2"><Input value={form.address} onChange={set('address')} /></Field><Field label="Giờ mở cửa"><Input type="time" value={form.opening} onChange={set('opening')} /></Field><Field label="Giờ đóng cửa"><Input type="time" value={form.closing} onChange={set('closing')} /></Field></div><div className="card-actions"><Button icon={Save} onClick={() => notify('Đã lưu cài đặt cửa hàng.')}>Lưu thay đổi</Button></div></Card>
      </div>
    </div>
  )
}
