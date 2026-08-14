import { useMemo, useState } from 'react'
import {
  BadgeDollarSign,
  Banknote,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Edit3,
  FileText,
  Gift,
  PackageCheck,
  Plus,
  ReceiptText,
  Save,
  ShieldCheck,
  Store,
  Trash2,
  TrendingDown,
  TrendingUp,
  Users,
  Wallet,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
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
import { calculateKpiBonuses, financeSummaryFromState } from '../../domain'
import { useApp } from '../../state/AppContext'
import { businessDate, getHourlyRate, getMonthlySalary, getPayBasis, money, shortDate, today } from '../../utils'

const parseMoney = (value) => Number(String(value ?? '').replace(/\D/g, '')) || 0
const moneyInput = (value) => new Intl.NumberFormat('en-US').format(parseMoney(value))
const timestamp = (value) => {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? String(value || '—') : date.toLocaleString('vi-VN', { hour12: false })
}
const monthBounds = (period) => ({
  from: `${period}-01`,
  to: `${period}-${String(new Date(Number(period.slice(0, 4)), Number(period.slice(5, 7)), 0).getDate()).padStart(2, '0')}`,
})
const recordInMonth = (record, period) => businessDate(record.date || record.workDate || record.createdAt || record.occurredAt).slice(0, 7) === period
const statusTone = (status) => status === 'Đi trễ' ? 'red' : status === 'Đi sớm' ? 'green' : 'blue'
const normalizedStatus = (status) => status === 'Đúng giờ' ? 'Đi đúng giờ' : status === 'Trễ' ? 'Đi trễ' : status || 'Chưa xác định'
const newImportForm = () => ({ name: '', category: 'Thời trang', quantity: 1, price: '', shippingAmount: '', relatedAmount: '', note: '', reason: '' })

function useStoreData() {
  const app = useApp()
  const storeId = app.activeStore?.id || app.activeStoreId || app.session?.storeId
  return { ...app, storeId, store: app.stores.find((item) => item.id === storeId) || app.activeStore }
}

export function StoreOverviewV2() {
  const app = useStoreData()
  const navigate = useNavigate()
  const { storeId, store, employees = [], orders = [], attendance = [], schedule = [] } = app
  const [period, setPeriod] = useState(today().slice(0, 7))
  const summary = financeSummaryFromState(app, { storeId, ...monthBounds(period) })
  const storeEmployees = employees.filter((employee) => employee.storeId === storeId && employee.status !== 'Đã nghỉ việc')
  const todayOrders = orders.filter((order) => order.storeId === storeId && !order.deletedAt && businessDate(order.createdAt) === today())
  const openAttendance = attendance.filter((record) => record.storeId === storeId && !record.deletedAt && !record.checkOutAt && !record.checkOut)
  const todayAssignments = schedule.filter((record) => record.storeId === storeId && (!record.date || record.date === today()))

  return (
    <div className="page">
      <PageHeader title={store?.name || 'TỔNG QUAN CỬA HÀNG'} subtitle="Không gian vận hành cửa hàng dành cho Admin." icon={Store} actions={<Input type="month" value={period} onChange={(event) => setPeriod(event.target.value)} />} />
      <div className="metrics-grid metrics-grid--4">
        <MetricCard label="DOANH THU KỲ" value={money(summary.revenue)} icon={TrendingUp} tone="green" />
        <MetricCard label="CHI PHÍ KỲ" value={money(summary.expense)} icon={TrendingDown} tone="orange" />
        <MetricCard label="LỢI NHUẬN KỲ" value={money(summary.profit)} icon={Wallet} tone={summary.profit >= 0 ? 'green' : 'red'} />
        <MetricCard label="ĐƠN HÔM NAY" value={todayOrders.length} suffix="đơn" icon={ReceiptText} tone="blue" />
      </div>
      <div className="two-column-layout">
        <Card title="Vận hành hôm nay">
          <div className="summary-list">
            <p><span>Nhân viên đang hoạt động</span><strong>{storeEmployees.length}</strong></p>
            <p><span>Đang trong ca</span><strong>{openAttendance.length}</strong></p>
            <p><span>Lượt phân ca</span><strong>{todayAssignments.length}</strong></p>
            <p className="total"><span>Doanh thu từ đơn hôm nay</span><strong>{money(todayOrders.reduce((sum, order) => sum + Number(order.amount || 0), 0))}</strong></p>
          </div>
        </Card>
        <Card title="Truy cập nhanh">
          <div className="quick-action-grid">
            <Button icon={ReceiptText} onClick={() => navigate('/store/orders')}>Đơn hàng</Button>
            <Button icon={CalendarDays} variant="outline" onClick={() => navigate('/store/schedule')}>Lịch làm việc</Button>
            <Button icon={Users} variant="outline" onClick={() => navigate('/store/employees')}>Nhân viên</Button>
            <Button icon={Banknote} variant="outline" onClick={() => navigate('/store/cashflow')}>Dòng tiền</Button>
          </div>
        </Card>
      </div>
      <InfoNote>Doanh thu được cộng từ các đơn chưa xóa. Chi phí được cộng từ các khoản đã xác nhận; không nhập lại doanh thu khi kết ca.</InfoNote>
    </div>
  )
}

export function StoreReportsV2() {
  const app = useStoreData()
  const { storeId, store } = app
  const [period, setPeriod] = useState(today().slice(0, 7))
  const summary = financeSummaryFromState(app, { storeId, ...monthBounds(period) })
  const rows = useMemo(() => {
    const grouped = new Map()
    summary.transactions.forEach((transaction) => {
      const date = String(transaction.occurredAt || transaction.createdAt || '').slice(0, 10)
      if (!date) return
      const row = grouped.get(date) || { date, orders: 0, revenue: 0, expense: 0 }
      if (transaction.direction === 'in') {
        row.revenue += Number(transaction.amount || 0)
        if (transaction.sourceType === 'order') row.orders += 1
      } else {
        row.expense += Number(transaction.amount || 0)
      }
      grouped.set(date, row)
    })
    return [...grouped.values()].map((row) => ({ ...row, profit: row.revenue - row.expense })).sort((left, right) => right.date.localeCompare(left.date))
  }, [summary.transactions])

  return (
    <div className="page">
      <PageHeader title="BÁO CÁO CỬA HÀNG" subtitle={`Báo cáo vận hành của ${store?.name || storeId} trên cùng nguồn dữ liệu đơn hàng và chi phí.`} icon={FileText} actions={<Input type="month" value={period} onChange={(event) => setPeriod(event.target.value)} />} />
      <div className="metrics-grid metrics-grid--4">
        <MetricCard label="SỐ ĐƠN" value={summary.transactions.filter((transaction) => transaction.sourceType === 'order').length} icon={ReceiptText} tone="blue" />
        <MetricCard label="DOANH THU" value={money(summary.revenue)} icon={TrendingUp} tone="green" />
        <MetricCard label="CHI PHÍ" value={money(summary.expense)} icon={TrendingDown} tone="orange" />
        <MetricCard label="LỢI NHUẬN" value={money(summary.profit)} icon={Wallet} tone={summary.profit >= 0 ? 'green' : 'red'} />
      </div>
      <Card title="Kết quả theo ngày"><TableWrap><thead><tr><th>Ngày</th><th>Số đơn</th><th>Doanh thu</th><th>Chi phí</th><th>Lợi nhuận</th></tr></thead><tbody>{rows.map((row) => <tr key={row.date}><td>{shortDate(row.date)}</td><td>{row.orders}</td><td className="green-text"><strong>{money(row.revenue)}</strong></td><td className="orange-text"><strong>{money(row.expense)}</strong></td><td><strong>{money(row.profit)}</strong></td></tr>)}{!rows.length && <tr><td colSpan="5">Chưa có dữ liệu trong kỳ.</td></tr>}</tbody></TableWrap></Card>
      <Card title="Cơ cấu chi phí"><div className="cost-structure-list">{Object.entries(summary.expenseByType).map(([type, amount]) => <div key={type}><span>{type}</span><strong>{money(amount)}</strong><b>{summary.expense ? `${((amount / summary.expense) * 100).toFixed(1)}%` : '0%'}</b></div>)}{!Object.keys(summary.expenseByType).length && <p>Chưa có chi phí trong kỳ.</p>}</div></Card>
    </div>
  )
}

export function StoreOrdersPage() {
  const app = useStoreData()
  const { storeId, store, orders = [], employees = [], updateOrder, deleteOrder, notify } = app
  const [view, setView] = useState('shift')
  const [query, setQuery] = useState('')
  const [date, setDate] = useState('')
  const [employeeId, setEmployeeId] = useState('all')
  const [shiftId, setShiftId] = useState('all')
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState({ customerName: '', customerPhone: '', customerAge: '', amount: '', paymentMethod: 'Chuyển khoản', reason: '' })
  const storeOrders = orders.filter((order) => order.storeId === storeId && order.source !== 'legacy-opening-balance' && !order.deletedAt)
  const employeeOptions = employees.filter((employee) => employee.storeId === storeId)
  const shiftOptions = [...new Map(storeOrders.filter((order) => order.shiftId).map((order) => [order.shiftId, { id: order.shiftId, name: order.shiftName || order.shiftId }])).values()]
  const filtered = storeOrders.filter((order) => {
    if (date && businessDate(order.createdAt) !== date) return false
    if (employeeId !== 'all' && order.employeeId !== employeeId) return false
    if (shiftId !== 'all' && order.shiftId !== shiftId) return false
    const haystack = [order.code, order.customerName, order.customerPhone, order.employeeName].join(' ').toLowerCase()
    return !query || haystack.includes(query.toLowerCase())
  })
  const groups = useMemo(() => {
    const keyOf = view === 'employee' ? (order) => order.employeeId || 'system' : (order) => `${String(order.createdAt).slice(0, 10)}:${order.shiftId || 'none'}`
    return [...filtered.reduce((map, order) => {
      const key = keyOf(order)
      if (!map.has(key)) map.set(key, [])
      map.get(key).push(order)
      return map
    }, new Map()).entries()]
  }, [filtered, view])
  const total = filtered.reduce((sum, order) => sum + Number(order.amount || 0), 0)

  const openEdit = (order) => {
    setEditing(order)
    setForm({ customerName: order.customerName || '', customerPhone: order.customerPhone || '', customerAge: order.customerAge ?? '', amount: moneyInput(order.amount), paymentMethod: order.paymentMethod, reason: '' })
  }
  const save = async () => {
    const result = await updateOrder(editing.id, { ...form, amount: parseMoney(form.amount) })
    if (!result.ok) return notify(result.message, 'info')
    setEditing(null)
  }
  const remove = async (order) => {
    const reason = window.prompt(`Lý do xóa đơn ${order.code}:`) || ''
    if (!reason) return notify('Cần nhập lý do xóa để lưu lịch sử kiểm toán.', 'info')
    const result = await deleteOrder(order.id, reason)
    if (!result.ok) notify(result.message, 'info')
  }

  return (
    <div className="page store-orders-page">
      <PageHeader title="ĐƠN HÀNG" subtitle={`Quản lý đơn hàng của ${store?.name || 'cửa hàng'}; doanh thu cập nhật trực tiếp từ nguồn này.`} icon={ReceiptText} />
      <div className="metrics-grid metrics-grid--3">
        <MetricCard label="TỔNG SỐ ĐƠN" value={filtered.length} suffix="đơn" icon={FileText} tone="blue" />
        <MetricCard label="TỔNG DOANH THU" value={money(total)} icon={TrendingUp} tone="green" />
        <MetricCard label="GIÁ TRỊ TRUNG BÌNH" value={money(filtered.length ? Math.floor(total / filtered.length) : 0)} icon={BadgeDollarSign} tone="orange" />
      </div>
      <Card title="Bộ lọc đơn hàng" className="filter-card"><div className="toolbar-wrap"><SearchInput value={query} onChange={setQuery} placeholder="Tìm mã đơn, khách hàng..." /><Input type="date" value={date} onChange={(event) => setDate(event.target.value)} /><Select value={shiftId} onChange={(event) => setShiftId(event.target.value)}><option value="all">Tất cả ca</option>{shiftOptions.map((shift) => <option key={shift.id} value={shift.id}>{shift.name}</option>)}</Select><Select value={employeeId} onChange={(event) => setEmployeeId(event.target.value)}><option value="all">Tất cả nhân viên</option>{employeeOptions.map((employee) => <option key={employee.id} value={employee.id}>{employee.name}</option>)}</Select><Button variant="outline" onClick={() => { setQuery(''); setDate(''); setShiftId('all'); setEmployeeId('all') }}>Đặt lại</Button></div></Card>
      <div className="tabs"><button className={view === 'shift' ? 'active' : ''} onClick={() => setView('shift')}>Theo ca</button><button className={view === 'employee' ? 'active' : ''} onClick={() => setView('employee')}>Theo nhân viên</button></div>
      {groups.map(([key, group]) => {
        const first = group[0]
        const groupTotal = group.reduce((sum, order) => sum + Number(order.amount || 0), 0)
        const title = view === 'employee' ? `${first.employeeName || 'Dữ liệu hệ thống'} — ${first.employeeId || ''}` : `${first.shiftName || 'Chưa gắn ca'} — ${first.shiftStart || '--:--'}–${first.shiftEnd || '--:--'} — ${shortDate(String(first.createdAt).slice(0, 10))}`
        return <Card key={key} className="order-group" title={title} action={<div className="order-group__totals"><strong>{money(groupTotal)}</strong><span>{group.length} đơn</span></div>}><TableWrap><thead><tr><th>Thời gian</th><th>Mã đơn</th><th>Khách hàng</th><th>Số tiền</th><th>Thanh toán</th><th>Nhân viên</th><th>Trạng thái</th><th>Thao tác</th></tr></thead><tbody>{group.map((order) => <tr id={`order-${order.id}`} key={order.id}><td>{timestamp(order.updatedAt || order.createdAt)}</td><td><strong>{order.code}</strong></td><td>{order.customerName || 'Khách lẻ'}<small className="table-note">{order.customerPhone || 'Không có SĐT'}{order.customerAge != null ? ` • ${order.customerAge} tuổi` : ''}</small></td><td><strong>{money(order.amount)}</strong></td><td><Badge tone={order.paymentMethod === 'Tiền mặt' ? 'green' : 'blue'}>{order.paymentMethod}</Badge></td><td>{order.employeeName}<small className="table-note">{order.employeeId || '—'}</small></td><td><Badge>{order.status}</Badge></td><td><div className="row-actions"><Button variant="outline" icon={Edit3} onClick={() => openEdit(order)}>Sửa</Button><Button variant="danger" icon={Trash2} onClick={() => remove(order)}>Xóa</Button></div></td></tr>)}</tbody></TableWrap></Card>
      })}
      {!groups.length && <InfoNote>Chưa có đơn hàng phù hợp bộ lọc.</InfoNote>}
      <Modal open={Boolean(editing)} onClose={() => setEditing(null)} title={`Sửa đơn hàng ${editing?.code || ''}`} footer={<><Button variant="outline" onClick={() => setEditing(null)}>Hủy</Button><Button icon={Save} onClick={save}>LƯU THAY ĐỔI</Button></>}><div className="form-grid"><Field label="Tên khách hàng"><Input value={form.customerName} onChange={(event) => setForm({ ...form, customerName: event.target.value })} /></Field><Field label="Số điện thoại"><Input value={form.customerPhone} onChange={(event) => setForm({ ...form, customerPhone: event.target.value })} /></Field><Field label="Tuổi"><Input type="number" min="0" value={form.customerAge} onChange={(event) => setForm({ ...form, customerAge: event.target.value })} /></Field><Field label="Số tiền"><Input inputMode="numeric" value={form.amount} onChange={(event) => setForm({ ...form, amount: moneyInput(event.target.value) })} /></Field><Field label="Hình thức thanh toán"><Select value={form.paymentMethod} onChange={(event) => setForm({ ...form, paymentMethod: event.target.value })}><option>Tiền mặt</option><option>Chuyển khoản</option></Select></Field><Field label="Lý do chỉnh sửa" required><Input value={form.reason} onChange={(event) => setForm({ ...form, reason: event.target.value })} /></Field></div></Modal>
    </div>
  )
}

export function StoreCashflowV2() {
  const app = useStoreData()
  const { storeId, store, orders = [], fixedExpenses = [], employees = [], attendance = [], addFixedExpense, notify } = app
  const [period, setPeriod] = useState(today().slice(0, 7))
  const [view, setView] = useState('shift')
  const [expenseOpen, setExpenseOpen] = useState(false)
  const [expenseForm, setExpenseForm] = useState({ type: 'Điện', amount: '', note: '', occurredAt: today() })
  const summary = financeSummaryFromState(app, { storeId, ...monthBounds(period) })
  const scopedAttendance = attendance.filter((record) => record.storeId === storeId && !record.deletedAt && recordInMonth(record, period))
  const profitTone = summary.profit >= 0 ? 'green' : 'red'
  const revenueTransactions = summary.transactions.filter((transaction) => transaction.direction === 'in')
  const expenseTransactions = summary.transactions.filter((transaction) => transaction.direction === 'out')
  const orderById = new Map(orders.map((order) => [String(order.id), order]))
  const fixedExpenseById = new Map(fixedExpenses.map((expense) => [String(expense.id), expense]))
  const groupedRevenue = (() => {
    const grouped = new Map()
    revenueTransactions.forEach((transaction) => {
      const sourceOrder = orderById.get(String(transaction.sourceId))
      const date = String(transaction.occurredAt || '').slice(0, 10)
      const isOpening = sourceOrder?.source === 'legacy-opening-balance' || transaction.sourceType === 'legacy-opening-balance'
      const employeeId = transaction.employeeId || sourceOrder?.employeeId || ''
      const shiftId = transaction.shiftId || sourceOrder?.shiftId || ''
      const key = isOpening
        ? `opening:${date || transaction.id}`
        : view === 'employee'
          ? `employee:${employeeId || 'system'}`
          : `shift:${date}:${shiftId || 'none'}`
      const current = grouped.get(key) || {
        key,
        date,
        latestDate: date,
        employeeId,
        shiftId,
        isOpening,
        sourceOrder,
        orders: 0,
        revenue: 0,
        cash: 0,
        transfer: 0,
        otherPayment: 0,
      }
      const amount = Number(transaction.amount || 0)
      current.latestDate = date > current.latestDate ? date : current.latestDate
      current.orders += transaction.sourceType === 'order' && !isOpening ? 1 : 0
      current.revenue += amount
      if (transaction.paymentMethod === 'Tiền mặt') current.cash += amount
      else if (transaction.paymentMethod === 'Chuyển khoản') current.transfer += amount
      else current.otherPayment += amount
      grouped.set(key, current)
    })

    return [...grouped.values()]
      .map((row) => {
        const relatedExpenses = row.isOpening ? [] : expenseTransactions.filter((transaction) => {
          if (view === 'employee') return row.employeeId && transaction.employeeId === row.employeeId
          return row.shiftId
            && transaction.shiftId === row.shiftId
            && String(transaction.occurredAt || '').slice(0, 10) === row.date
        })
        const relatedAttendance = row.isOpening ? [] : scopedAttendance.filter((record) => {
          if (view === 'employee') return row.employeeId && record.employeeId === row.employeeId
          const attendanceShiftId = record.shiftId || record.shift
          const attendanceDate = String(record.date || record.workDate || record.checkOutAt || '').slice(0, 10)
          return row.shiftId && attendanceShiftId === row.shiftId && attendanceDate === row.date
        })
        const checkOuts = relatedAttendance
          .map((record) => record.checkOutAt || (record.checkOut && (record.date || record.workDate) ? `${record.date || record.workDate}T${record.checkOut}:00+07:00` : ''))
          .filter(Boolean)
          .sort()
        return {
          ...row,
          linkedExpense: relatedExpenses.reduce((total, transaction) => total + Number(transaction.amount || 0), 0),
          attendanceCount: relatedAttendance.length,
          latestCheckOut: checkOuts.at(-1) || '',
        }
      })
      .sort((left, right) => String(right.latestDate).localeCompare(String(left.latestDate)) || left.key.localeCompare(right.key))
  })()
  const revenueTotals = groupedRevenue.reduce((totals, row) => ({
    orders: totals.orders + row.orders,
    revenue: totals.revenue + row.revenue,
    cash: totals.cash + row.cash,
    transfer: totals.transfer + row.transfer,
    otherPayment: totals.otherPayment + row.otherPayment,
    linkedExpense: totals.linkedExpense + row.linkedExpense,
  }), { orders: 0, revenue: 0, cash: 0, transfer: 0, otherPayment: 0, linkedExpense: 0 })
  const fixedExpenseTransactions = expenseTransactions.filter((transaction) => transaction.sourceType === 'fixed-expense')
  const expenseBreakdown = Object.entries(summary.expenseByType).sort((left, right) => right[1] - left[1])

  const saveExpense = async () => {
    const result = await addFixedExpense({ ...expenseForm, storeId, amount: parseMoney(expenseForm.amount), occurredAt: `${expenseForm.occurredAt}T12:00:00+07:00` })
    if (!result.ok) return notify(result.message, 'info')
    setExpenseOpen(false)
    setExpenseForm({ type: 'Điện', amount: '', note: '', occurredAt: today() })
  }

  return (
    <div className="page">
      <PageHeader title="DÒNG TIỀN CỬA HÀNG" subtitle={`Nguồn dữ liệu thống nhất của ${store?.name || 'cửa hàng'} trong kỳ đã chọn.`} icon={Banknote} actions={<><Input type="month" value={period} onChange={(event) => setPeriod(event.target.value)} /><Button icon={Plus} onClick={() => setExpenseOpen(true)}>NHẬP CHI PHÍ CỐ ĐỊNH</Button></>} />
      <div className="metrics-grid metrics-grid--4"><MetricCard label="DOANH THU" value={money(summary.revenue)} icon={TrendingUp} tone="green" /><MetricCard label="CHI PHÍ" value={money(summary.expense)} icon={TrendingDown} tone="orange" /><MetricCard label="LỢI NHUẬN" value={money(summary.profit)} icon={Wallet} tone={profitTone} /><MetricCard label="BIÊN LỢI NHUẬN" value={`${summary.marginPercent.toFixed(2)}%`} icon={BadgeDollarSign} tone="blue" /></div>
      <div className="two-column-layout">
        <Card title="Cơ cấu tổng chi phí cửa hàng"><div className="cost-structure-list">{expenseBreakdown.map(([type, amount]) => <div key={type}><span>{type}</span><strong>{money(amount)}</strong><b>{summary.expense ? `${((amount / summary.expense) * 100).toFixed(1)}%` : '0%'}</b></div>)}{!expenseBreakdown.length && <p>Chưa có chi phí trong kỳ.</p>}</div></Card>
        <Card title="Chi phí cố định đã ghi nhận"><TableWrap><thead><tr><th>Ngày</th><th>Loại</th><th>Số tiền</th><th>Ghi chú</th></tr></thead><tbody>{fixedExpenseTransactions.map((transaction) => {
          const source = fixedExpenseById.get(String(transaction.sourceId))
          return <tr key={transaction.id}><td>{shortDate(String(transaction.occurredAt).slice(0, 10))}</td><td>{transaction.type}</td><td><strong>{money(transaction.amount)}</strong></td><td>{source?.note || source?.description || '—'}</td></tr>
        })}{!fixedExpenseTransactions.length && <tr><td colSpan="4">Chưa có bản ghi chi phí cố định đã xác nhận trong kỳ.</td></tr>}</tbody></TableWrap></Card>
      </div>
      <Card title="Doanh thu chi tiết" action={<div className="tabs tabs--compact"><button className={view === 'shift' ? 'active' : ''} onClick={() => setView('shift')}>Theo ca</button><button className={view === 'employee' ? 'active' : ''} onClick={() => setView('employee')}>Theo nhân viên</button></div>}><TableWrap><thead><tr><th>{view === 'shift' ? 'Ca làm việc' : 'Nhân viên'}</th><th>Số đơn</th><th>Tổng doanh thu</th><th>Tiền mặt</th><th>Chuyển khoản</th><th>Khác</th><th>Chi phí liên kết</th><th>Kết ca gần nhất</th></tr></thead><tbody>{groupedRevenue.map((row) => {
        const employee = employees.find((item) => item.id === row.employeeId)
        const shiftName = row.sourceOrder?.shiftName || row.shiftId || 'Chưa gắn ca'
        const shiftTime = row.sourceOrder?.shiftStart || row.sourceOrder?.shiftEnd ? ` (${row.sourceOrder?.shiftStart || '--:--'}–${row.sourceOrder?.shiftEnd || '--:--'})` : ''
        const label = row.isOpening
          ? `Số dư doanh thu đầu kỳ — ${shortDate(row.date)}`
          : view === 'shift'
            ? `${shiftName}${shiftTime} — ${shortDate(row.date)}`
            : `${row.sourceOrder?.employeeName || employee?.name || 'Dữ liệu hệ thống'}${row.employeeId ? ` — ${row.employeeId}` : ''}`
        const checkOut = row.latestCheckOut ? `${row.attendanceCount} ca • ${timestamp(row.latestCheckOut)}` : '—'
        return <tr key={row.key}><td><strong>{label}</strong></td><td>{row.orders}</td><td><strong>{money(row.revenue)}</strong></td><td>{money(row.cash)}</td><td>{money(row.transfer)}</td><td>{money(row.otherPayment)}</td><td>{money(row.linkedExpense)}</td><td>{checkOut}</td></tr>
      })}{!groupedRevenue.length && <tr><td colSpan="8">Chưa có giao dịch doanh thu trong kỳ.</td></tr>}{Boolean(groupedRevenue.length) && <tr className="total-row"><td>TỔNG KHỚP DOANH THU</td><td>{revenueTotals.orders}</td><td>{money(revenueTotals.revenue)}</td><td>{money(revenueTotals.cash)}</td><td>{money(revenueTotals.transfer)}</td><td>{money(revenueTotals.otherPayment)}</td><td>{money(revenueTotals.linkedExpense)}</td><td /></tr>}</tbody></TableWrap></Card>
      <Card title="Sổ giao dịch chi phí"><TableWrap><thead><tr><th>Thời gian</th><th>Loại</th><th>Nguồn</th><th>Số tiền</th><th>Trạng thái</th></tr></thead><tbody>{expenseTransactions.map((transaction) => <tr key={transaction.id}><td>{timestamp(transaction.occurredAt)}</td><td>{transaction.type}</td><td>{transaction.sourceType}</td><td><strong>{money(transaction.amount)}</strong></td><td><Badge>Đã ghi nhận</Badge></td></tr>)}{!expenseTransactions.length && <tr><td colSpan="5">Chưa có giao dịch chi phí trong kỳ.</td></tr>}{Boolean(expenseTransactions.length) && <tr className="total-row"><td colSpan="3">TỔNG KHỚP CHI PHÍ</td><td>{money(expenseTransactions.reduce((total, transaction) => total + Number(transaction.amount || 0), 0))}</td><td /></tr>}</tbody></TableWrap></Card>
      <Modal open={expenseOpen} onClose={() => setExpenseOpen(false)} title="Nhập chi phí cố định" footer={<><Button variant="outline" onClick={() => setExpenseOpen(false)}>Hủy</Button><Button icon={Save} onClick={saveExpense}>LƯU</Button></>}><div className="form-grid"><Field label="Ngày phát sinh"><Input type="date" value={expenseForm.occurredAt} onChange={(event) => setExpenseForm({ ...expenseForm, occurredAt: event.target.value })} /></Field><Field label="Loại chi phí"><Select value={expenseForm.type} onChange={(event) => setExpenseForm({ ...expenseForm, type: event.target.value })}><option>Điện</option><option>Nước</option><option>Wi-Fi</option><option>Rác</option><option>Marketing</option><option>Chi phí thiết lập cửa hàng</option><option>Chi phí khác</option></Select></Field><Field label="Số tiền"><Input inputMode="numeric" value={expenseForm.amount} onChange={(event) => setExpenseForm({ ...expenseForm, amount: moneyInput(event.target.value) })} /></Field><Field label="Ghi chú"><Input value={expenseForm.note} onChange={(event) => setExpenseForm({ ...expenseForm, note: event.target.value })} /></Field></div></Modal>
    </div>
  )
}

export function StoreAttendanceV2() {
  const app = useStoreData()
  const { storeId, attendance = [], employees = [], policies } = app
  const [period, setPeriod] = useState(today().slice(0, 7))
  const [query, setQuery] = useState('')
  const [shift, setShift] = useState('all')
  const [employeeId, setEmployeeId] = useState('all')
  const scopedEmployees = employees.filter((employee) => employee.storeId === storeId)
  const rows = attendance.filter((record) => !record.deletedAt && record.storeId === storeId && recordInMonth(record, period) && (shift === 'all' || record.shift === shift) && (employeeId === 'all' || record.employeeId === employeeId) && (!query || [record.employeeId, scopedEmployees.find((employee) => employee.id === record.employeeId)?.name, record.shiftName].some((value) => String(value || '').toLowerCase().includes(query.toLowerCase()))))
  const uniqueTiktokEmployees = new Set(rows.filter((record) => scopedEmployees.find((employee) => employee.id === record.employeeId)?.tiktokAllowance > 0).map((record) => record.employeeId))
  const totalTiktok = [...uniqueTiktokEmployees].reduce((sum, id) => sum + Number(scopedEmployees.find((employee) => employee.id === id)?.tiktokAllowance || 0), 0)
  const totalHours = rows.reduce((sum, record) => sum + Number(record.hours || 0), 0)
  const totalPay = rows.reduce((sum, record) => {
    const employee = scopedEmployees.find((item) => item.id === record.employeeId)
    if (!employee) return sum
    if (getPayBasis(employee) === 'hourly') return sum + Number(record.hours || 0) * getHourlyRate(employee)
    return sum + getMonthlySalary(employee) / Number(employee.standardWorkDays || 26)
  }, 0)
  const shifts = [...new Map(attendance.filter((record) => record.storeId === storeId).map((record) => [record.shift, record.shiftName || record.shift])).entries()]
  const stats = scopedEmployees.map((employee) => {
    const records = rows.filter((record) => record.employeeId === employee.id)
    const early = records.filter((record) => normalizedStatus(record.status || record.arrivalTag) === 'Đi sớm').length
    const onTime = records.filter((record) => normalizedStatus(record.status || record.arrivalTag) === 'Đi đúng giờ').length
    const late = records.filter((record) => normalizedStatus(record.status || record.arrivalTag) === 'Đi trễ').length
    const lateMinutes = records.reduce((sum, record) => sum + Number(record.minutesLate || 0), 0)
    const rate = records.length ? (onTime / records.length) * 100 : 0
    const evaluation = late === 0 ? 'Chuyên cần tốt' : late >= policies.attendanceEvaluation.improveMinLateCount || lateMinutes >= policies.attendanceEvaluation.improveMinLateMinutes ? 'Cần cải thiện' : 'Cần duy trì'
    return { employee, records: records.length, early, onTime, late, lateMinutes, rate, evaluation }
  }).filter((item) => item.records > 0)

  return <div className="page"><PageHeader title="CHẤM CÔNG CỬA HÀNG" subtitle="Mỗi lượt chấm công là một bản ghi độc lập, có ca, vị trí và thời gian thực tế." icon={Clock3} actions={<Input type="month" value={period} onChange={(event) => setPeriod(event.target.value)} />} /><Card title="Lịch sử chấm công của nhân viên" action={<div className="toolbar-wrap"><SearchInput value={query} onChange={setQuery} placeholder="Tìm nhân viên..." /><Select value={shift} onChange={(event) => setShift(event.target.value)}><option value="all">Tất cả ca</option>{shifts.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</Select><Select value={employeeId} onChange={(event) => setEmployeeId(event.target.value)}><option value="all">Tất cả nhân viên</option>{scopedEmployees.map((employee) => <option key={employee.id} value={employee.id}>{employee.name}</option>)}</Select></div>}><TableWrap><thead><tr><th>STT</th><th>Nhân viên</th><th>Ca làm việc</th><th>Ngày</th><th>Giờ vào / Kết</th><th>Giờ thực tế</th><th>Trạng thái</th><th>Phút trễ</th><th>Phụ cấp TikTok</th><th>Lương thực nhận</th><th>Vị trí</th></tr></thead><tbody>{rows.map((record, index) => {
    const employee = scopedEmployees.find((item) => item.id === record.employeeId)
    const pay = employee ? getPayBasis(employee) === 'hourly' ? Number(record.hours || 0) * getHourlyRate(employee) : getMonthlySalary(employee) / Number(employee.standardWorkDays || 26) : 0
    const status = normalizedStatus(record.status || record.arrivalTag)
    return <tr key={record.id}><td>{index + 1}</td><td><strong>{employee?.name || record.employeeName}</strong><small className="table-note">{record.employeeId}</small></td><td><strong>{record.shiftName || record.shift}</strong><small className="table-note">{record.shiftStart}–{record.shiftEnd}</small></td><td>{shortDate(record.date || record.workDate)}</td><td>{record.checkIn || '—'} / {record.checkOut || 'Đang làm'}</td><td>{Number(record.hours || 0).toFixed(2)}</td><td><Badge tone={statusTone(status)}>{status}</Badge></td><td>{Number(record.minutesLate || 0)} phút</td><td>{uniqueTiktokEmployees.has(record.employeeId) ? money(employee?.tiktokAllowance) : money(0)}</td><td>{money(Math.floor(pay))}</td><td>{record.location?.label || record.locationName || '—'}<small className="table-note">{record.location?.latitude != null ? `${record.location.latitude}, ${record.location.longitude}` : ''}</small></td></tr>
  })}<tr className="total-row"><td colSpan="5">TỔNG</td><td>{totalHours.toFixed(2)} giờ</td><td colSpan="2" /><td>{money(totalTiktok)}</td><td>{money(Math.floor(totalPay))}</td><td /></tr></tbody></TableWrap></Card><Card title="THỐNG KÊ ĐI LÀM ĐÚNG GIỜ"><TableWrap><thead><tr><th>STT</th><th>Nhân viên</th><th>Đi trễ</th><th>Đi đúng giờ</th><th>Đi sớm</th><th>Tổng phút trễ</th><th>Tổng ca</th><th>Tỷ lệ đúng giờ</th><th>Đánh giá</th></tr></thead><tbody>{stats.map((item, index) => <tr key={item.employee.id}><td>{index + 1}</td><td><strong>{item.employee.name}</strong><small className="table-note">{item.employee.id}</small></td><td className="red-text">{item.late}</td><td className="blue-text">{item.onTime}</td><td className="green-text">{item.early}</td><td>{item.lateMinutes}</td><td>{item.records}</td><td><strong>{item.rate.toFixed(1)}%</strong></td><td><Badge tone={item.evaluation === 'Chuyên cần tốt' ? 'green' : item.evaluation === 'Cần cải thiện' ? 'red' : 'orange'}>{item.evaluation}</Badge></td></tr>)}</tbody></TableWrap></Card></div>
}

export function StorePayrollV2() {
  const app = useStoreData()
  const { storeId, store, employees = [], attendance = [], salaryAdjustments = [], salaryAdvances = [], payrollPeriods = [], policies, addSalaryAdjustment, createSalaryAdvance, confirmSalaryAdvance, getAvailableSalary, closePayrollPeriod, confirmPayrollPayment, lockPayrollPeriod, notify } = app
  const [period, setPeriod] = useState(today().slice(0, 7))
  const [modal, setModal] = useState(null)
  const [form, setForm] = useState({ employeeId: '', type: 'Thưởng khác', amount: '', note: '' })
  const scopedEmployees = employees.filter((employee) => employee.storeId === storeId && employee.status !== 'Đã nghỉ việc')
  const scopedAttendance = attendance.filter((record) => !record.deletedAt && record.storeId === storeId && recordInMonth(record, period))
  const summary = financeSummaryFromState(app, { storeId, ...monthBounds(period) })
  const participants = [
    ...scopedEmployees.map((employee) => ({ id: employee.id, role: 'employee', hours: scopedAttendance.filter((record) => record.employeeId === employee.id).reduce((sum, record) => sum + Number(record.hours || 0), 0) })),
  ]
  const kpi = calculateKpiBonuses({ profit: summary.profit, participants, employeeTiers: [{ threshold: 30000, ratePercent: policies.employeeKpiRates.from30000 }, { threshold: 15000, ratePercent: policies.employeeKpiRates.from15000 }, { threshold: 7000, ratePercent: policies.employeeKpiRates.from7000 }], policyId: `policy-v${policies.version}`, policyEffectiveAt: policies.effectiveFrom })
  const currentPeriod = payrollPeriods.find((item) => item.storeId === storeId && item.period === period)
  const rows = scopedEmployees.map((employee) => {
    const records = scopedAttendance.filter((record) => record.employeeId === employee.id)
    const hours = records.reduce((sum, record) => sum + Number(record.hours || 0), 0)
    const base = getPayBasis(employee) === 'hourly' ? Math.floor(hours * getHourlyRate(employee)) : getMonthlySalary(employee)
    const adjustments = salaryAdjustments.filter((item) => item.employeeId === employee.id && item.period === period && item.status !== 'Đã hủy')
    const otherBonus = adjustments.filter((item) => item.type === 'Thưởng khác').reduce((sum, item) => sum + Number(item.amount || 0), 0)
    const otherAllowance = adjustments.filter((item) => item.type === 'Phụ cấp khác').reduce((sum, item) => sum + Number(item.amount || 0), 0)
    const deductions = adjustments.filter((item) => item.type === 'Khấu trừ').reduce((sum, item) => sum + Number(item.amount || 0), 0)
    const kpiBonus = kpi.results.find((item) => item.id === employee.id)?.amount || 0
    const advances = salaryAdvances.filter((item) => item.employeeId === employee.id && item.period === period && item.status === 'Đã chi').reduce((sum, item) => sum + Number(item.amount || 0), 0)
    const gross = Math.max(0, base + Number(employee.tiktokAllowance || 0) + otherBonus + otherAllowance + kpiBonus - deductions)
    return { employee, hours, base, otherBonus, otherAllowance, deductions, kpiBonus, advances, gross, net: Math.max(0, gross - advances) }
  })
  const totals = rows.reduce((value, row) => ({ gross: value.gross + row.gross, advances: value.advances + row.advances, net: value.net + row.net, kpi: value.kpi + row.kpiBonus }), { gross: 0, advances: 0, net: 0, kpi: 0 })

  const openAdjustment = (type) => { setModal(type === 'Ứng lương' ? 'advance' : 'adjustment'); setForm({ employeeId: scopedEmployees[0]?.id || '', type, amount: '', note: '' }) }
  const saveAdjustment = async () => {
    const payload = { ...form, storeId, period, amount: parseMoney(form.amount), idempotencyKey: `${form.type}:${form.employeeId}:${period}:${Date.now()}` }
    const result = modal === 'advance' ? await createSalaryAdvance(payload) : await addSalaryAdjustment(payload)
    if (!result.ok) return notify(result.message, 'info')
    setModal(null)
  }
  const handleConfirmAdvance = async (advanceId) => {
    const result = await confirmSalaryAdvance(advanceId)
    if (!result.ok) notify(result.message, 'info')
  }
  const handleClosePayroll = async () => {
    const result = await closePayrollPeriod(storeId, period)
    if (!result.ok) notify(result.message, 'info')
  }
  const handleConfirmPayroll = async () => {
    const result = await confirmPayrollPayment(storeId, period)
    if (!result.ok) notify(result.message, 'info')
  }
  const handleLockPayroll = async () => {
    const result = await lockPayrollPeriod(storeId, period)
    if (!result.ok) notify(result.message, 'info')
  }

  return <div className="page"><PageHeader title="LƯƠNG THƯỞNG NHÂN VIÊN" subtitle={`Kỳ ${period} — ${store?.name || ''}. KPI chỉ dùng tổng giờ thực tế của nhân viên và chính sách đang hiệu lực.`} icon={Banknote} actions={<><Input type="month" value={period} onChange={(event) => setPeriod(event.target.value)} /><Button icon={Gift} onClick={() => openAdjustment('Thưởng khác')}>TẠO THƯỞNG</Button><Button icon={Plus} onClick={() => openAdjustment('Phụ cấp khác')}>TẠO PHỤ CẤP</Button><Button variant="outline" icon={Wallet} onClick={() => openAdjustment('Ứng lương')}>TẠO ỨNG LƯƠNG</Button></>} /><div className="metrics-grid metrics-grid--4"><MetricCard label="TỔNG THU NHẬP" value={money(totals.gross)} icon={TrendingUp} tone="green" /><MetricCard label="THƯỞNG KPI NHÂN VIÊN" value={money(totals.kpi)} helper={`${kpi.totalHours.toFixed(2)} giờ • ${money(Math.floor(kpi.profitPerHour))}/giờ`} icon={BadgeDollarSign} tone="blue" /><MetricCard label="ĐÃ ỨNG" value={money(totals.advances)} icon={Wallet} tone="orange" /><MetricCard label="CÒN PHẢI CHI" value={money(totals.net)} icon={Banknote} tone="green" /></div><Card title="Chi tiết lương thưởng"><TableWrap><thead><tr><th>Nhân viên</th><th>Giờ làm</th><th>Lương cứng</th><th>Thưởng KPI</th><th>Thưởng khác</th><th>Phụ cấp TikTok</th><th>Phụ cấp khác</th><th>Khấu trừ</th><th>Đã ứng</th><th>Thực nhận</th></tr></thead><tbody>{rows.map((row) => <tr key={row.employee.id}><td><strong>{row.employee.name}</strong><small className="table-note">{row.employee.id} • {row.employee.employmentType}</small></td><td>{row.hours.toFixed(2)}</td><td>{money(row.base)}</td><td>{money(row.kpiBonus)}</td><td>{money(row.otherBonus)}</td><td>{money(row.employee.tiktokAllowance)}</td><td>{money(row.otherAllowance)}</td><td>{money(row.deductions)}</td><td>{money(row.advances)}</td><td><strong>{money(row.net)}</strong></td></tr>)}<tr className="total-row"><td colSpan="9">TỔNG CÒN PHẢI CHI</td><td>{money(totals.net)}</td></tr></tbody></TableWrap></Card><Card title="Lịch sử ứng lương của nhân viên" action={<Button icon={Plus} onClick={() => openAdjustment('Ứng lương')}>TẠO ỨNG LƯƠNG</Button>}><TableWrap><thead><tr><th>Thời gian</th><th>Nhân viên</th><th>Số tiền ứng</th><th>Lương khả dụng lúc tạo</th><th>Còn lại</th><th>Người tạo</th><th>Ghi chú</th><th>Trạng thái</th><th>Hành động</th></tr></thead><tbody>{salaryAdvances.filter((item) => item.storeId === storeId && item.period === period).map((item) => <tr key={item.id}><td>{timestamp(item.createdAt)}</td><td><strong>{item.employeeName}</strong><small className="table-note">{item.employeeId}</small></td><td>{money(item.amount)}</td><td>{money(item.availableAtCreation)}</td><td>{money(item.remainingAfter)}</td><td>{item.createdBy?.name}</td><td>{item.note || '—'}</td><td><Badge tone={item.status === 'Đã chi' ? 'green' : 'orange'}>{item.status}</Badge></td><td>{item.status === 'Mới tạo' ? <Button icon={CheckCircle2} onClick={() => handleConfirmAdvance(item.id)}>XÁC NHẬN CHI</Button> : <span>{timestamp(item.confirmedAt)}</span>}</td></tr>)}{!salaryAdvances.some((item) => item.storeId === storeId && item.period === period) && <tr><td colSpan="9">Chưa có khoản ứng lương.</td></tr>}</tbody></TableWrap></Card><Card title="Xử lý cuối kỳ" action={<Badge tone={currentPeriod?.status === 'Đã khóa' ? 'red' : currentPeriod?.confirmedAt ? 'green' : 'orange'}>{currentPeriod?.needsReclose ? 'Cần chốt lại' : currentPeriod?.status || 'Chưa chốt'}</Badge>}><div className="period-actions"><Button variant="outline" icon={FileText} onClick={handleClosePayroll} disabled={currentPeriod?.status === 'Đã khóa'}>{currentPeriod?.needsReclose ? 'CHỐT LẠI SỔ' : 'CHỐT SỔ'}</Button><Button icon={Banknote} onClick={handleConfirmPayroll} disabled={Boolean(currentPeriod?.confirmedAt) || currentPeriod?.status === 'Đã khóa' || currentPeriod?.needsReclose}>XÁC NHẬN CHI LƯƠNG</Button><Button variant="danger" icon={ShieldCheck} onClick={handleLockPayroll} disabled={!currentPeriod || currentPeriod?.status === 'Đã khóa' || currentPeriod?.needsReclose}>KHÓA KỲ CHI LƯƠNG THƯỞNG</Button></div></Card><Modal open={Boolean(modal)} onClose={() => setModal(null)} title={modal === 'advance' ? 'Tạo ứng lương' : `Tạo ${form.type.toLowerCase()}`} footer={<><Button variant="outline" onClick={() => setModal(null)}>Hủy</Button><Button icon={Save} onClick={saveAdjustment}>TẠO</Button></>}><div className="form-grid"><Field label="Nhân viên"><Select value={form.employeeId} onChange={(event) => setForm({ ...form, employeeId: event.target.value })}>{scopedEmployees.map((employee) => <option key={employee.id} value={employee.id}>{employee.name} — {employee.id}</option>)}</Select></Field>{modal !== 'advance' && <Field label="Loại"><Select value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value })}><option>Thưởng khác</option><option>Phụ cấp khác</option><option>Khấu trừ</option></Select></Field>}<Field label="Số tiền"><Input inputMode="numeric" value={form.amount} onChange={(event) => setForm({ ...form, amount: moneyInput(event.target.value) })} /></Field>{modal === 'advance' && <InfoNote>Lương khả dụng hiện tại: <strong>{money(getAvailableSalary(form.employeeId, period))}</strong>. Khoản ứng phải nhỏ hơn mức này.</InfoNote>}<Field label="Ghi chú" className="span-2"><Input value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} /></Field></div></Modal></div>
}

export function StoreImportsV2() {
  const app = useStoreData()
  const { storeId, importVouchers = [], createImportVoucher, updateImportVoucher, deleteImportVoucher, notify } = app
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(newImportForm)
  const vouchers = importVouchers.filter((item) => item.storeId === storeId && !item.deletedAt && item.status !== 'Đã xóa')
  const totals = vouchers.reduce((value, item) => ({ goods: value.goods + Number(item.goodsAmount || 0), shipping: value.shipping + Number(item.shippingAmount || 0), related: value.related + Number(item.relatedAmount || 0), total: value.total + Number(item.totalAmount ?? (Number(item.goodsAmount || 0) + Number(item.shippingAmount || 0) + Number(item.relatedAmount || 0))) }), { goods: 0, shipping: 0, related: 0, total: 0 })
  const closeModal = () => { setOpen(false); setEditing(null); setForm(newImportForm()) }
  const openCreate = () => { setEditing(null); setForm(newImportForm()); setOpen(true) }
  const openEdit = (voucher) => {
    const item = voucher.items?.[0] || {}
    setEditing(voucher)
    setForm({ name: item.name || '', category: item.category || 'Thời trang', quantity: item.quantity || 1, price: moneyInput(item.price), shippingAmount: moneyInput(voucher.shippingAmount), relatedAmount: moneyInput(voucher.relatedAmount), note: item.note || '', reason: '' })
    setOpen(true)
  }
  const save = async () => {
    const firstItem = { name: form.name, category: form.category, quantity: Number(form.quantity), price: parseMoney(form.price), note: form.note }
    const items = editing ? [firstItem, ...(editing.items || []).slice(1)] : [firstItem]
    const payload = { storeId, items, shippingAmount: parseMoney(form.shippingAmount), relatedAmount: parseMoney(form.relatedAmount) }
    const result = editing
      ? await updateImportVoucher(editing.id, { ...payload, reason: form.reason })
      : await createImportVoucher({ ...payload, idempotencyKey: `import:${storeId}:${Date.now()}` })
    if (!result.ok) return notify(result.message, 'info')
    closeModal()
  }
  const remove = async (voucher) => {
    const reason = window.prompt(`Lý do xóa phiếu ${voucher.code}:`)
    if (reason == null) return
    const result = await deleteImportVoucher(voucher.id, reason)
    if (!result.ok) notify(result.message, 'info')
  }
  return (
    <div className="page">
      <PageHeader title="NHẬP HÀNG VÀ HÀNG HÓA" subtitle="Mỗi lần lưu tạo một phiếu nhập có mã tuần tự, không ghi đè lịch sử." icon={PackageCheck} />
      <div className="metrics-grid metrics-grid--4">
        <MetricCard label="TỔNG TIỀN NHẬP HÀNG" value={money(totals.goods)} icon={PackageCheck} tone="blue" />
        <MetricCard label="CHI PHÍ VẬN CHUYỂN" value={money(totals.shipping)} icon={TrendingDown} tone="orange" />
        <MetricCard label="CHI PHÍ LIÊN QUAN" value={money(totals.related)} icon={Wallet} tone="orange" />
        <MetricCard label="TỔNG TIỀN PHIẾU NHẬP" value={money(totals.total)} icon={Banknote} tone="green" />
      </div>
      <Card title="Danh sách phiếu nhập">
        <TableWrap>
          <thead><tr><th>Mã phiếu</th><th>Ngày lưu</th><th>Hàng hóa</th><th>Tiền hàng</th><th>Vận chuyển</th><th>Liên quan</th><th>Tổng phiếu</th><th>Người tạo</th><th>Hành động</th></tr></thead>
          <tbody>{vouchers.map((item) => <tr key={item.id}><td><strong>{item.code}</strong></td><td>{timestamp(item.createdAt)}</td><td>{item.items?.map((product) => product.name).join(', ')}</td><td>{money(item.goodsAmount)}</td><td>{money(item.shippingAmount)}</td><td>{money(item.relatedAmount)}</td><td><strong>{money(item.totalAmount ?? Number(item.goodsAmount || 0) + Number(item.shippingAmount || 0) + Number(item.relatedAmount || 0))}</strong></td><td>{item.createdBy?.name || item.createdBy || '—'}</td><td><div className="row-actions"><button onClick={() => openEdit(item)} aria-label={`Sửa ${item.code}`}><Edit3 /></button><button className="danger" onClick={() => remove(item)} aria-label={`Xóa ${item.code}`}><Trash2 /></button></div></td></tr>)}</tbody>
        </TableWrap>
        <div className="card-actions card-actions--below"><Button icon={Plus} onClick={openCreate}>THÊM HÀNG HÓA</Button></div>
      </Card>
      <Modal open={open} onClose={closeModal} title={editing ? `Sửa phiếu ${editing.code}` : 'Tạo phiếu nhập hàng'} footer={<><Button variant="outline" onClick={closeModal}>Hủy</Button><Button icon={Save} onClick={save}>{editing ? 'CẬP NHẬT' : 'LƯU PHIẾU'}</Button></>}>
        <div className="form-grid">
          <Field label="Tên hàng hóa"><Input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></Field>
          <Field label="Danh mục"><Input value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })} /></Field>
          <Field label="Số lượng"><Input type="number" min="1" value={form.quantity} onChange={(event) => setForm({ ...form, quantity: event.target.value })} /></Field>
          <Field label="Đơn giá"><Input inputMode="numeric" value={form.price} onChange={(event) => setForm({ ...form, price: moneyInput(event.target.value) })} /></Field>
          <Field label="Vận chuyển"><Input inputMode="numeric" value={form.shippingAmount} onChange={(event) => setForm({ ...form, shippingAmount: moneyInput(event.target.value) })} /></Field>
          <Field label="Chi phí liên quan"><Input inputMode="numeric" value={form.relatedAmount} onChange={(event) => setForm({ ...form, relatedAmount: moneyInput(event.target.value) })} /></Field>
          <Field label="Ghi chú" className="span-2"><Input value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} /></Field>
          {editing && <Field label="Lý do chỉnh sửa" className="span-2"><Input value={form.reason} onChange={(event) => setForm({ ...form, reason: event.target.value })} placeholder="Bắt buộc để lưu lịch sử kiểm toán" /></Field>}
        </div>
      </Modal>
    </div>
  )
}
