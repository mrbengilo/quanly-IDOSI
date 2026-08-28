import { useEffect, useMemo, useState } from 'react'
import {
  BadgeDollarSign,
  Banknote,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Edit3,
  FileText,
  Gift,
  MapPin,
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
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  Badge,
  Button,
  Card,
  Field,
  InfoNote,
  Input,
  MoneyInput,
  MetricCard,
  Modal,
  PageHeader,
  SearchInput,
  Select,
  TableWrap,
} from '../../components/UI'
import { SearchableSelect } from '../../components/SearchableSelect'
import { calculateAvailableSalary, financeSummaryFromState, financeTransactionsFromState } from '../../domain'
import { activeOccupationLabels, findOccupationOption, occupationValueAllowed, ORDER_PAYMENT_METHODS } from '../../domain/orderInformationSettings'
import { resolveOrderRouteScope } from '../../domain/orderStoreScope'
import { useApp } from '../../state/AppContext'
import { payrollCompensationTotalsForEmployee } from '../compensation/compensationViewModel'
import { businessDate, calculateEmployeeBasePay, getHourlyRate, getMonthlySalary, money, resolveStoreEmployeeSalaryPolicy, shortDate, shortDateTime24, today } from '../../utils'
import { storeDailyReportRows, storeMonthlyReportRows } from './storeReportAnalytics'

const parseMoney = (value) => Number(String(value ?? '').replace(/\D/g, '')) || 0
const moneyInput = (value) => new Intl.NumberFormat('en-US').format(parseMoney(value))
const timestamp = shortDateTime24
const monthBounds = (period) => ({
  from: `${period}-01`,
  to: `${period}-${String(new Date(Number(period.slice(0, 4)), Number(period.slice(5, 7)), 0).getDate()).padStart(2, '0')}`,
})
const recordInMonth = (record, period) => businessDate(record.date || record.workDate || record.createdAt || record.occurredAt).slice(0, 7) === period
const statusTone = (status) => status === 'Đi trễ' ? 'red' : status === 'Đi sớm' ? 'green' : 'blue'
const normalizedStatus = (status) => status === 'Đúng giờ' ? 'Đi đúng giờ' : status === 'Trễ' ? 'Đi trễ' : status || 'Chưa xác định'
const normalizedAdjustmentType = (value) => String(value || '')
  .trim()
  .toLowerCase()
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/đ/g, 'd')
const adjustmentKind = (value) => {
  const type = normalizedAdjustmentType(value)
  if (type === 'revenue' || type.includes('thuong doanh thu')) return 'REVENUE'
  if (type === 'work' || type.includes('thuong cong viec')) return 'WORK'
  if (type === 'manual' || type.includes('thuong khac') || type.includes('thuong thu cong')) return 'MANUAL'
  if (type === 'allowance' || type.includes('phu cap')) return 'ALLOWANCE'
  if (type === 'violation' || type.includes('khau tru') || type.includes('vi pham')) return 'VIOLATION'
  return null
}
const attendanceEarlyMinutes = (record = {}) => Math.max(0, Number(record.minutesEarly ?? record.earlyMinutes) || 0)
const attendanceLateMinutes = (record = {}) => Math.max(0, Number(record.minutesLate ?? record.lateMinutes) || 0)
const attendanceMinutesKind = (record = {}) => {
  const status = normalizedStatus(record.status || record.arrivalTag)
  if (status === 'Đi trễ' || attendanceLateMinutes(record) > 0) return 'late'
  if (status === 'Đi sớm' || attendanceEarlyMinutes(record) > 0) return 'early'
  return 'on-time'
}
const attendanceMinutesLabel = (record = {}) => {
  const kind = attendanceMinutesKind(record)
  const earlyMinutes = attendanceEarlyMinutes(record)
  const lateMinutes = attendanceLateMinutes(record)
  if (kind === 'late') return `Trễ ${lateMinutes} phút`
  if (kind === 'early') return `Sớm ${earlyMinutes} phút`
  return 'Đúng giờ'
}
const attendanceLocationDetails = (record = {}) => {
  const location = record.checkInLocation || {}
  const fallbackLocation = record.location || {}
  const latitude = Number(location.latitude ?? location.lat ?? fallbackLocation.latitude ?? fallbackLocation.lat)
  const longitude = Number(location.longitude ?? location.lng ?? location.lon ?? fallbackLocation.longitude ?? fallbackLocation.lng ?? fallbackLocation.lon)
  const hasCoordinates = Number.isFinite(latitude) && latitude >= -90 && latitude <= 90
    && Number.isFinite(longitude) && longitude >= -180 && longitude <= 180
  const coordinates = hasCoordinates ? `${latitude}, ${longitude}` : ''
  const label = String(
    location.label || location.address || location.name
    || fallbackLocation.label || fallbackLocation.address || fallbackLocation.name
    || record.checkInLocationName || record.locationName || '',
  ).trim()
  const query = coordinates || label
  return {
    coordinates,
    label: label || coordinates || '—',
    mapUrl: query ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}` : '',
  }
}
const supportCompensationForAttendance = (record = {}, employee = {}, transfers = []) => {
  const canonical = record.supportCompensation || record.compensation?.support || {}
  const transferId = canonical.transferId || record.supportTransferId || record.transferId || ''
  const transfer = transfers.find((item) => String(item.id || '') === String(transferId || ''))
    || transfers.find((item) => String(item.employeeId || '') === String(record.employeeId || '')
      && String(item.toStoreId || '') === String(record.storeId || ''))
  const homeStoreId = canonical.homeStoreId || record.homeStoreId || transfer?.fromStoreId || employee.storeId || ''
  const supportStoreId = canonical.supportStoreId || record.supportStoreId || transfer?.toStoreId || record.storeId || ''
  const isSupport = Boolean(transferId || canonical.supportStoreId || record.supportStoreId)
    || Boolean(homeStoreId && supportStoreId && String(homeStoreId) !== String(supportStoreId) && transfer)
  if (!isSupport) return null
  const hours = Math.max(0, Number(canonical.hours ?? record.supportHours ?? record.hours) || 0)
  const hourlyRate = Math.max(0, Number(canonical.hourlyRate ?? record.supportHourlyRate ?? transfer?.hourlySupportRate) || 0)
  const basePay = Math.max(0, Number(canonical.basePay ?? record.supportBasePay ?? record.supportHourlyPay) || (hours * hourlyRate))
  const allowanceApplied = canonical.allowanceApplied ?? record.supportAllowanceApplied ?? true
  const allowance = allowanceApplied
    ? Math.max(0, Number(canonical.allowance ?? record.supportAllowance ?? transfer?.allowance) || 0)
    : 0
  const totalPay = Math.max(0, Number(canonical.totalPay ?? record.supportActualPay) || (basePay + allowance))
  return {
    transferId: transferId || transfer?.id || '',
    homeStoreId,
    supportStoreId,
    transferStartAt: canonical.transferStartAt || transfer?.startAt || transfer?.fromDate || '',
    transferEndAt: canonical.transferEndAt || transfer?.endAt || transfer?.toDate || '',
    hours,
    hourlyRate,
    basePay,
    allowance,
    allowanceApplied: Boolean(allowanceApplied),
    totalPay,
  }
}
const isFullTimeAttendanceEmployee = (employee = {}) => String(employee.employmentType || employee.employeeType || '')
  .trim()
  .toLowerCase()
  .includes('full')
const attendancePayDetails = (record = {}, employee = {}, transfers = []) => {
  const support = supportCompensationForAttendance(record, employee, transfers)
  if (support) return { kind: 'support', amount: support.totalPay, support }
  if (!employee?.id || isFullTimeAttendanceEmployee(employee)) return { kind: 'full-time-home', amount: null, support: null }
  const hours = Math.max(0, Number(record.hours || 0))
  const hourlyRate = Math.max(0, getHourlyRate(employee))
  return { kind: 'part-time-home', amount: hours * hourlyRate, support: null, hours, hourlyRate }
}
const canManageStoreOperations = (role) => ['admin', 'business_support', 'manager', 'store_manager'].includes(role)
const newImportForm = () => ({ name: '', quantity: 1, weight: '', price: '', shippingAmount: '', reason: '' })
const importVoucherCode = (value) => {
  const code = String(value || '')
  const compact = code.match(/^PN-(\d{2})(\d{2})(\d{2}(?:\d{2})?)-(\d+)$/i)
  if (!compact) return code || 'Hệ thống tạo khi lưu'
  return `PN-${compact[1]}/${compact[2]}/${compact[3].slice(-2)}-${compact[4].slice(-4).padStart(4, '0')}`
}
const importVoucherPreview = (vouchers = []) => {
  const now = new Date()
  const day = String(now.getDate()).padStart(2, '0')
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const year = String(now.getFullYear()).slice(-2)
  const nextSequence = vouchers.reduce((maximum, voucher) => {
    const match = String(voucher.code || '').match(/-(\d+)$/u)
    return match ? Math.max(maximum, Number(match[1]) || 0) : maximum
  }, 0) + 1
  return `PN-${day}/${month}/${year}-${String(nextSequence).padStart(4, '0')}`
}

function useStoreData(preferredStoreId = '') {
  const app = useApp()
  const canUsePreferredStore = ['admin', 'business_support', 'manager'].includes(app.session?.role)
    && app.stores.some((store) => String(store.id) === String(preferredStoreId))
  const storeId = app.session?.role === 'store_manager'
    ? app.session.storeId
    : canUsePreferredStore
      ? preferredStoreId
      : app.activeStore?.id || app.activeStoreId || app.session?.storeId
  return { ...app, storeId, store: app.stores.find((item) => item.id === storeId) || app.activeStore }
}

export function StoreOverviewV2() {
  const app = useStoreData()
  const navigate = useNavigate()
  const { storeId, store, employees = [], orders = [], attendance = [], schedule = [] } = app
  const [period, setPeriod] = useState(today().slice(0, 7))
  const summary = financeSummaryFromState(app, { storeId, ...monthBounds(period) })
  const storeEmployees = employees.filter((employee) => String(employee.unit || 'store') === 'store' && employee.storeId === storeId && employee.status !== 'Đã nghỉ việc')
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
  const [reportMode, setReportMode] = useState('day')
  const summary = financeSummaryFromState(app, { storeId, ...monthBounds(period) })
  const transactions = useMemo(() => financeTransactionsFromState({
    orders: app.orders,
    expenseEntries: app.expenseEntries,
  }), [app.expenseEntries, app.orders])
  const rows = useMemo(() => reportMode === 'month'
    ? storeMonthlyReportRows({ transactions, orders: app.orders, storeId, period })
    : storeDailyReportRows({ transactions, orders: app.orders, storeId, period }), [app.orders, period, reportMode, storeId, transactions])
  const detailList = (values = {}) => Object.entries(values).sort((left, right) => right[1] - left[1])
    .map(([label, amount]) => `${label}: ${money(amount)}`).join(' • ') || '—'

  return (
    <div className="page">
      <PageHeader title="BÁO CÁO CỬA HÀNG" subtitle={`Báo cáo vận hành của ${store?.name || storeId} trên cùng nguồn dữ liệu đơn hàng và chi phí.`} icon={FileText} actions={<Input type="month" value={period} onChange={(event) => setPeriod(event.target.value)} />} />
      <div className="metrics-grid metrics-grid--4">
        <MetricCard label="SỐ ĐƠN" value={summary.transactions.filter((transaction) => transaction.sourceType === 'order').length} icon={ReceiptText} tone="blue" />
        <MetricCard label="DOANH THU" value={money(summary.revenue)} icon={TrendingUp} tone="green" />
        <MetricCard label="CHI PHÍ" value={money(summary.expense)} icon={TrendingDown} tone="orange" />
        <MetricCard label="LỢI NHUẬN" value={money(summary.profit)} icon={Wallet} tone={summary.profit >= 0 ? 'green' : 'red'} />
      </div>
      <Card title="Bảng thống kê vận hành" action={<div className="tabs" role="tablist" aria-label="Kiểu báo cáo cửa hàng"><button type="button" className={reportMode === 'day' ? 'active' : ''} onClick={() => setReportMode('day')}>Theo ngày</button><button type="button" className={reportMode === 'month' ? 'active' : ''} onClick={() => setReportMode('month')}>Theo tháng</button></div>}>
        <TableWrap><thead><tr><th>{reportMode === 'month' ? 'Tháng' : 'Ngày'}</th><th>Số đơn</th><th>Doanh thu cụ thể mỗi ca</th><th>Chi phí gì</th><th>Tổng doanh thu</th><th>Tổng chi phí</th><th>Lợi nhuận</th><th>So sánh kỳ trước</th><th>Đánh giá tăng trưởng</th></tr></thead><tbody>{rows.map((row) => <tr key={row.key}><td><strong>{reportMode === 'month' ? row.key.split('-').reverse().join('/') : shortDate(row.key)}</strong></td><td>{row.orders}</td><td><span className="report-detail-cell">{detailList(row.shifts)}</span></td><td><span className="report-detail-cell report-detail-cell--expense">{detailList(row.expenses)}</span></td><td className="green-text"><strong>{money(row.revenue)}</strong></td><td className="orange-text"><strong>{money(row.expense)}</strong></td><td><strong>{money(row.profit)}</strong></td><td><strong className={row.comparison.percent >= 0 ? 'green-text' : 'red-text'}>{row.comparison.percent >= 0 ? '+' : ''}{row.comparison.percent.toFixed(1)}%</strong></td><td><Badge tone={row.comparison.tone}>{row.comparison.label}</Badge></td></tr>)}{!rows.length && <tr><td colSpan="9">Chưa có dữ liệu trong kỳ.</td></tr>}</tbody></TableWrap>
      </Card>
      <Card title="Cơ cấu chi phí"><div className="cost-structure-list">{Object.entries(summary.expenseByType).map(([type, amount]) => <div key={type}><span>{type}</span><strong>{money(amount)}</strong><b>{summary.expense ? `${((amount / summary.expense) * 100).toFixed(1)}%` : '0%'}</b></div>)}{!Object.keys(summary.expenseByType).length && <p>Chưa có chi phí trong kỳ.</p>}</div></Card>
    </div>
  )
}

export function StoreOrdersPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const requestedStoreParam = searchParams.get('store') || ''
  const requestedOrderParam = searchParams.get('order') || ''
  const initialApp = useStoreData(requestedStoreParam)
  const routeScope = resolveOrderRouteScope({
    requestedStoreId: requestedStoreParam,
    requestedOrderId: requestedOrderParam,
    fallbackStoreId: initialApp.storeId,
    orders: initialApp.orders,
    stores: initialApp.stores,
  })
  const app = routeScope.storeId && routeScope.storeId !== initialApp.storeId
    ? {
        ...initialApp,
        storeId: routeScope.storeId,
        store: initialApp.stores.find((item) => String(item.id) === String(routeScope.storeId)),
      }
    : initialApp
  const { storeId, store, orders = [], employees = [], orderInformationOptions = [], apiStatus, updateOrder, deleteOrder, notify } = app
  const canManageOrders = ['admin', 'business_support', 'manager'].includes(app.session?.role)
  const [view, setView] = useState('shift')
  const [query, setQuery] = useState('')
  const [date, setDate] = useState('')
  const [month, setMonth] = useState('')
  const [employeeId, setEmployeeId] = useState('all')
  const [shiftId, setShiftId] = useState('all')
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState({ customerName: '', customerPhone: '', customerAge: '', gender: 'Khác', occupation: '', acquisitionChannel: 'Khác', amount: '', paymentMethod: '', reason: '' })
  const [formErrors, setFormErrors] = useState({})
  const [saving, setSaving] = useState(false)
  const storeOrders = orders.filter((order) => order.storeId === storeId && order.source !== 'legacy-opening-balance' && !order.deletedAt)
  const requestedOrderId = String(requestedOrderParam)
  const requestedOrder = storeOrders.find((order) => [order.id, order.code].map(String).includes(requestedOrderId))
  const requestedOrderKey = String(requestedOrder?.id || '')
  const employeeOptions = employees.filter((employee) => String(employee.unit || 'store') === 'store' && employee.storeId === storeId)
  const shiftOptions = [...new Map(storeOrders.filter((order) => order.shiftId).map((order) => [order.shiftId, { id: order.shiftId, name: order.shiftName || order.shiftId }])).values()]
  const activeOccupations = activeOccupationLabels(orderInformationOptions)
  const currentOccupation = String(editing?.occupation || '').trim()
  const configuredCurrentOccupation = findOccupationOption(orderInformationOptions, currentOccupation, { includeInactive: true })
  const preserveCurrentOccupation = Boolean(currentOccupation && !activeOccupations.includes(currentOccupation))
  const occupationSelectOptions = [
    ...(preserveCurrentOccupation ? [{
      value: currentOccupation,
      label: configuredCurrentOccupation
        ? `${configuredCurrentOccupation.label}${configuredCurrentOccupation.active ? '' : ' (Đã ngừng sử dụng)'}`
        : `${currentOccupation} (Dữ liệu cũ)`,
    }] : []),
    ...activeOccupations
      .filter((occupation) => !preserveCurrentOccupation || occupation !== configuredCurrentOccupation?.label)
      .map((occupation) => ({ value: occupation, label: occupation })),
  ]
  const filtered = storeOrders.filter((order) => {
    if (requestedOrderKey && String(order.id) === requestedOrderKey) return true
    const orderDate = businessDate(order.createdAt)
    if (date && orderDate !== date) return false
    if (month && !orderDate.startsWith(month)) return false
    if (employeeId !== 'all' && order.employeeId !== employeeId) return false
    if (shiftId !== 'all' && order.shiftId !== shiftId) return false
    const haystack = [order.code, order.customerName, order.customerPhone, order.employeeName].join(' ').toLowerCase()
    return !query || haystack.includes(query.toLowerCase())
  })
  const groups = useMemo(() => {
    const keyOf = view === 'employee'
      ? (order) => order.employeeId || 'system'
      : view === 'day'
        ? (order) => businessDate(order.createdAt)
        : (order) => `${businessDate(order.createdAt)}:${order.shiftId || 'none'}`
    return [...filtered.reduce((map, order) => {
      const key = keyOf(order)
      if (!map.has(key)) map.set(key, [])
      map.get(key).push(order)
      return map
    }, new Map()).entries()]
  }, [filtered, view])
  const orderMetrics = filtered.reduce((metrics, order) => {
    const amount = Number(order.amount || 0)
    metrics.orders += 1
    metrics.revenue += amount
    if (order.paymentMethod === 'Tiền mặt') metrics.cash += amount
    if (order.paymentMethod === 'Chuyển khoản') metrics.transfer += amount
    return metrics
  }, { orders: 0, transfer: 0, cash: 0, revenue: 0 })

  useEffect(() => {
    if (!requestedOrderKey || !storeId || requestedStoreParam === String(storeId)) return
    setSearchParams((current) => {
      const next = new URLSearchParams(current)
      next.set('store', String(storeId))
      return next
    }, { replace: true })
  }, [requestedOrderKey, requestedStoreParam, setSearchParams, storeId])

  useEffect(() => {
    if (!requestedOrderKey) return undefined
    const scrollTimer = window.setTimeout(() => {
      document.getElementById(`order-${requestedOrderKey}`)?.scrollIntoView?.({ behavior: 'smooth', block: 'center' })
    }, 0)
    return () => window.clearTimeout(scrollTimer)
  }, [requestedOrderKey])

  const openEdit = (order) => {
    setEditing(order)
    setForm({ customerName: order.customerName || '', customerPhone: order.customerPhone || '', customerAge: order.customerAge ?? '', gender: order.gender || 'Khác', occupation: order.occupation || '', acquisitionChannel: order.acquisitionChannel || 'Khác', amount: moneyInput(order.amount), paymentMethod: order.paymentMethod || '', reason: '' })
    setFormErrors({})
  }
  const closeEditor = () => {
    if (saving) return
    setEditing(null)
    setFormErrors({})
  }
  const updateForm = (field, value) => {
    setForm((current) => ({ ...current, [field]: value }))
    setFormErrors((current) => {
      if (!current[field]) return current
      const next = { ...current }
      delete next[field]
      return next
    })
  }
  const save = async () => {
    if (!editing || saving) return
    const amount = String(form.amount || '').trim().startsWith('-') ? -parseMoney(form.amount) : parseMoney(form.amount)
    const nextErrors = {}
    if (!(amount > 0)) nextErrors.amount = 'Số tiền đơn hàng phải lớn hơn 0.'
    if (!occupationValueAllowed({
      options: orderInformationOptions,
      value: form.occupation,
      previousValue: editing.occupation,
      allowUnchangedInactive: true,
    })) nextErrors.occupation = 'Vui lòng chọn nghề nghiệp trong danh sách.'
    if (!ORDER_PAYMENT_METHODS.includes(form.paymentMethod)) nextErrors.paymentMethod = 'Vui lòng chọn hình thức thanh toán.'
    if (!String(form.reason || '').trim()) nextErrors.reason = 'Cần nhập lý do chỉnh sửa.'
    setFormErrors(nextErrors)
    if (Object.keys(nextErrors).length) return

    setSaving(true)
    try {
      const result = await updateOrder(editing.id, {
        ...form,
        amount,
        reason: String(form.reason).trim(),
      })
      if (!result?.ok) {
        notify(result?.message || 'Không thể cập nhật đơn hàng.', 'info')
        return
      }
      setEditing(null)
      setFormErrors({})
    } finally {
      setSaving(false)
    }
  }
  const remove = async (order) => {
    const reason = window.prompt(`Lý do xóa đơn ${order.code}:`) || ''
    if (!reason) return notify('Cần nhập lý do xóa để lưu lịch sử kiểm toán.', 'info')
    const result = await deleteOrder(order.id, reason)
    if (!result.ok) notify(result.message, 'info')
  }

  return (
    <div className="page store-orders-page">
      <PageHeader title="ĐƠN HÀNG" subtitle={`Danh sách đơn do nhân viên nhập tại ${store?.name || 'cửa hàng'}, thống kê theo ca, nhân viên và ngày tháng.`} icon={ReceiptText} />
      <div className="metrics-grid metrics-grid--4 store-order-metrics" aria-label="Tổng quan đơn hàng">
        <MetricCard label="TỔNG SỐ ĐƠN HÀNG" value={orderMetrics.orders} suffix="đơn" icon={ReceiptText} tone="blue" />
        <MetricCard label="TỔNG TIỀN CHUYỂN KHOẢN" value={money(orderMetrics.transfer)} icon={Banknote} tone="blue" />
        <MetricCard label="TỔNG TIỀN MẶT" value={money(orderMetrics.cash)} icon={Wallet} tone="orange" />
        <MetricCard label="TỔNG DOANH THU" value={money(orderMetrics.revenue)} icon={TrendingUp} tone="green" />
      </div>
      <Card title="Bộ lọc đơn hàng" className="filter-card"><div className="toolbar-wrap"><SearchInput value={query} onChange={setQuery} placeholder="Tìm mã đơn, khách hàng..." /><Input type="date" value={date} onChange={(event) => setDate(event.target.value)} aria-label="Lọc theo ngày" /><Input type="month" value={month} onChange={(event) => setMonth(event.target.value)} aria-label="Lọc theo tháng" /><Select value={shiftId} onChange={(event) => setShiftId(event.target.value)}><option value="all">Tất cả ca</option>{shiftOptions.map((shift) => <option key={shift.id} value={shift.id}>{shift.name}</option>)}</Select><Select value={employeeId} onChange={(event) => setEmployeeId(event.target.value)}><option value="all">Tất cả nhân viên</option>{employeeOptions.map((employee) => <option key={employee.id} value={employee.id}>{employee.name}</option>)}</Select><Button variant="outline" onClick={() => { setQuery(''); setDate(''); setMonth(''); setShiftId('all'); setEmployeeId('all') }}>Đặt lại</Button></div></Card>
      {!canManageOrders && <InfoNote>Chế độ chỉ xem: tài khoản hiện tại không thể chỉnh sửa hoặc xóa đơn hàng.</InfoNote>}
      <div className="tabs"><button className={view === 'shift' ? 'active' : ''} onClick={() => setView('shift')}>Theo ca</button><button className={view === 'employee' ? 'active' : ''} onClick={() => setView('employee')}>Theo nhân viên</button><button className={view === 'day' ? 'active' : ''} onClick={() => setView('day')}>Theo ngày</button></div>
      {groups.map(([key, group]) => {
        const first = group[0]
        const groupTotal = group.reduce((sum, order) => sum + Number(order.amount || 0), 0)
        const title = view === 'employee'
          ? `${first.employeeName || 'Dữ liệu hệ thống'} — ${first.employeeId || ''}`
          : view === 'day'
            ? `Ngày ${shortDate(businessDate(first.createdAt))}`
            : `${first.shiftName || 'Chưa gắn ca'} — ${first.shiftStart || '--:--'}–${first.shiftEnd || '--:--'} — ${shortDate(businessDate(first.createdAt))}`
        return <Card key={key} className="order-group" title={title} action={<div className="order-group__totals"><strong>{money(groupTotal)}</strong><span>{group.length} đơn</span></div>}><TableWrap><thead><tr><th>Thời gian</th><th>Mã đơn</th><th>Khách hàng</th><th>Khảo sát</th><th>Số tiền</th><th>Thanh toán</th><th>Nhân viên</th><th>Trạng thái</th>{canManageOrders && <th>Thao tác</th>}</tr></thead><tbody>{group.map((order) => <tr id={`order-${order.id}`} className={String(order.id) === requestedOrderKey ? 'order-row--highlight' : ''} key={order.id}><td>{timestamp(order.updatedAt || order.createdAt)}</td><td><strong>{order.code}</strong></td><td>{order.customerName || 'Khách lẻ'}<small className="table-note">{order.customerPhone || 'Không có SĐT'}{order.customerAge != null ? ` • ${order.customerAge} tuổi` : ''}</small></td><td>{order.gender || '—'}<small className="table-note">{order.occupation || 'Chưa rõ'} • {order.acquisitionChannel || 'Chưa rõ kênh'}</small></td><td><strong>{money(order.amount)}</strong></td><td><Badge tone={order.paymentMethod === 'Tiền mặt' ? 'green' : 'blue'}>{order.paymentMethod}</Badge></td><td>{order.employeeName}<small className="table-note">{order.employeeId || '—'}</small></td><td><Badge>{order.status}</Badge></td>{canManageOrders && <td><div className="row-actions"><Button variant="outline" icon={Edit3} onClick={() => openEdit(order)}>Sửa</Button><Button variant="danger" icon={Trash2} onClick={() => remove(order)}>Xóa</Button></div></td>}</tr>)}</tbody></TableWrap></Card>
      })}
      {!groups.length && <InfoNote>Chưa có đơn hàng phù hợp bộ lọc.</InfoNote>}
      {canManageOrders && <Modal open={Boolean(editing)} onClose={closeEditor} title={`Sửa đơn hàng ${editing?.code || ''}`} footer={<><Button variant="outline" onClick={closeEditor} disabled={saving}>Hủy</Button><Button icon={Save} loading={saving} disabled={saving} onClick={save}>LƯU THAY ĐỔI</Button></>}>
        <div className="form-grid">
          <Field label="Tên khách hàng"><Input value={form.customerName} onChange={(event) => updateForm('customerName', event.target.value)} /></Field>
          <Field label="Số điện thoại"><Input value={form.customerPhone} onChange={(event) => updateForm('customerPhone', event.target.value)} /></Field>
          <Field label="Tuổi"><Input type="number" min="0" value={form.customerAge} onChange={(event) => updateForm('customerAge', event.target.value)} /></Field>
          <Field label="Giới tính"><Select value={form.gender} onChange={(event) => updateForm('gender', event.target.value)}><option>Nam</option><option>Nữ</option><option>Khác</option></Select></Field>
          <Field label="Nghề nghiệp" required hint="Chỉ các nghề nghiệp đang hoạt động được dùng cho giá trị mới." error={formErrors.occupation}>
            <SearchableSelect
              aria-label="Nghề nghiệp"
              name="occupation"
              value={form.occupation}
              onChange={(event) => updateForm('occupation', event.target.value)}
              options={occupationSelectOptions}
              placeholder="Chọn"
              loading={['connecting', 'syncing'].includes(apiStatus)}
              error={apiStatus === 'error' ? 'Không thể tải danh sách nghề nghiệp.' : ''}
            />
          </Field>
          <Field label="Biết qua kênh nào"><Select value={form.acquisitionChannel} onChange={(event) => updateForm('acquisitionChannel', event.target.value)}><option>Facebook</option><option>Tiktok</option><option>Zalo</option><option>Bạn Bè</option><option>Người thân</option><option>Khác</option></Select></Field>
          <Field label="Số tiền" required error={formErrors.amount}><MoneyInput value={form.amount} onChange={(event) => updateForm('amount', event.target.value)} placeholder="Nhập số tiền" /></Field>
          <Field label="Hình thức thanh toán" required error={formErrors.paymentMethod}><Select value={form.paymentMethod} onChange={(event) => updateForm('paymentMethod', event.target.value)}><option value="">Chọn</option>{ORDER_PAYMENT_METHODS.map((method) => <option key={method} value={method}>{method}</option>)}</Select></Field>
          <Field label="Lý do chỉnh sửa" required error={formErrors.reason} className="span-2"><Input value={form.reason} onChange={(event) => updateForm('reason', event.target.value)} /></Field>
        </div>
      </Modal>}
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
  const canManageStore = canManageStoreOperations(app.session?.role)
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
    if (!canManageStore) return
    const result = await addFixedExpense({ ...expenseForm, storeId, amount: parseMoney(expenseForm.amount), occurredAt: `${expenseForm.occurredAt}T12:00:00+07:00` })
    if (!result.ok) return notify(result.message, 'info')
    setExpenseOpen(false)
    setExpenseForm({ type: 'Điện', amount: '', note: '', occurredAt: today() })
  }

  return (
    <div className="page">
      <PageHeader title="DÒNG TIỀN CỬA HÀNG" subtitle={`Nguồn dữ liệu thống nhất của ${store?.name || 'cửa hàng'} trong kỳ đã chọn.`} icon={Banknote} actions={<><Input type="month" value={period} onChange={(event) => setPeriod(event.target.value)} />{canManageStore && <Button icon={Plus} onClick={() => setExpenseOpen(true)}>NHẬP CHI PHÍ CỐ ĐỊNH</Button>}</>} />
      {!canManageStore && <InfoNote>Chế độ chỉ xem. Nhân viên hỗ trợ KD không thể ghi nhận chi phí hoặc thay đổi dữ liệu dòng tiền.</InfoNote>}
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
      {canManageStore && <Modal open={expenseOpen} onClose={() => setExpenseOpen(false)} title="Nhập chi phí cố định" footer={<><Button variant="outline" onClick={() => setExpenseOpen(false)}>Hủy</Button><Button icon={Save} onClick={saveExpense}>LƯU</Button></>}><div className="form-grid"><Field label="Ngày phát sinh"><Input type="date" value={expenseForm.occurredAt} onChange={(event) => setExpenseForm({ ...expenseForm, occurredAt: event.target.value })} /></Field><Field label="Loại chi phí"><Select value={expenseForm.type} onChange={(event) => setExpenseForm({ ...expenseForm, type: event.target.value })}><option>Điện</option><option>Nước</option><option>Wi-Fi</option><option>Rác</option><option>Marketing</option><option>Chi phí thiết lập cửa hàng</option><option>Chi phí khác</option></Select></Field><Field label="Số tiền"><MoneyInput value={expenseForm.amount} onChange={(event) => setExpenseForm({ ...expenseForm, amount: event.target.value })} /></Field><Field label="Ghi chú"><Input value={expenseForm.note} onChange={(event) => setExpenseForm({ ...expenseForm, note: event.target.value })} /></Field></div></Modal>}
    </div>
  )
}

export function StoreAttendanceV2() {
  const app = useStoreData()
  const { storeId, store, stores = [], attendance = [], employees = [], supportTransfers = [], expenseEntries = [], policies } = app
  const canViewAttendanceLocations = ['admin', 'business_support', 'manager', 'store_manager'].includes(app.session?.role)
  const [period, setPeriod] = useState(today().slice(0, 7))
  const [query, setQuery] = useState('')
  const [shift, setShift] = useState('all')
  const [employeeId, setEmployeeId] = useState('all')
  const storeRows = attendance.filter((record) => !record.deletedAt && String(record.storeId || '') === String(storeId || '') && recordInMonth(record, period))
  const storeEmployeeIds = new Set(storeRows.map((record) => String(record.employeeId || '')))
  const scopedEmployees = employees.filter((employee) => String(employee.unit || 'store') === 'store'
    && (String(employee.storeId || '') === String(storeId || '') || storeEmployeeIds.has(String(employee.id || employee.code || ''))))
  const employeeById = new Map(scopedEmployees.map((employee) => [String(employee.id || employee.code || ''), employee]))
  const rows = storeRows.filter((record) => (shift === 'all' || record.shift === shift)
    && (employeeId === 'all' || String(record.employeeId) === String(employeeId))
    && (!query || [record.employeeId, employeeById.get(String(record.employeeId || ''))?.name, record.employeeName, record.shiftName]
      .some((value) => String(value || '').toLowerCase().includes(query.toLowerCase()))))
  const rowDetails = rows.map((record) => {
    const employee = employeeById.get(String(record.employeeId || ''))
    return { record, employee, pay: attendancePayDetails(record, employee, supportTransfers) }
  })
  const uniqueTiktokEmployees = new Set(rowDetails
    .filter(({ employee, pay }) => pay.kind !== 'support' && employee?.tiktokAllowance > 0)
    .map(({ record }) => record.employeeId))
  const totalTiktok = [...uniqueTiktokEmployees].reduce((sum, id) => sum + Number(employeeById.get(String(id))?.tiktokAllowance || 0), 0)
  const totalHours = rows.reduce((sum, record) => sum + Number(record.hours || 0), 0)
  const totalPay = rowDetails.reduce((sum, item) => sum + Number(item.pay.amount || 0), 0)
  const supportRows = rowDetails.filter((item) => item.pay.kind === 'support')
  const recordedSupportExpenses = expenseEntries.filter((entry) => !entry.deletedAt
    && entry.recognized !== false
    && entry.sourceType === 'support-attendance-compensation'
    && String(entry.storeId || '') === String(storeId || '')
    && recordInMonth(entry, period))
  const supportExpenseByAttendanceId = recordedSupportExpenses.reduce((entries, entry) => {
    const sourceId = String(entry.sourceId || '').trim()
    if (sourceId && !entries.has(sourceId)) entries.set(sourceId, Number(entry.amount || 0))
    return entries
  }, new Map())
  const supportExpense = [...supportExpenseByAttendanceId.values()].reduce((sum, amount) => sum + amount, 0)
    + supportRows
      .filter((item) => !supportExpenseByAttendanceId.has(String(item.record.id || '')))
      .reduce((sum, item) => sum + Number(item.pay.amount || 0), 0)
  const shifts = [...new Map(attendance.filter((record) => record.storeId === storeId).map((record) => [record.shift, record.shiftName || record.shift])).entries()]
  const stats = scopedEmployees.map((employee) => {
    const records = rows.filter((record) => record.employeeId === employee.id)
    const early = records.filter((record) => normalizedStatus(record.status || record.arrivalTag) === 'Đi sớm').length
    const onTime = records.filter((record) => normalizedStatus(record.status || record.arrivalTag) === 'Đi đúng giờ').length
    const late = records.filter((record) => normalizedStatus(record.status || record.arrivalTag) === 'Đi trễ').length
    const earlyMinutes = records.reduce((sum, record) => sum + attendanceEarlyMinutes(record), 0)
    const lateMinutes = records.reduce((sum, record) => sum + attendanceLateMinutes(record), 0)
    const rate = records.length ? (onTime / records.length) * 100 : 0
    const evaluationPolicy = policies?.attendanceEvaluation || { improveMinLateCount: 3, improveMinLateMinutes: 30 }
    const evaluation = late === 0 ? 'Chuyên cần tốt' : late >= evaluationPolicy.improveMinLateCount || lateMinutes >= evaluationPolicy.improveMinLateMinutes ? 'Cần cải thiện' : 'Cần duy trì'
    return { employee, records: records.length, early, onTime, late, earlyMinutes, lateMinutes, rate, evaluation }
  }).filter((item) => item.records > 0)

  return <div className="page"><PageHeader title="CHẤM CÔNG CỬA HÀNG" subtitle="Lịch sử gồm nhân viên trực thuộc và nhân viên được điều chuyển đến hỗ trợ." icon={Clock3} actions={<Input type="month" value={period} onChange={(event) => setPeriod(event.target.value)} />} /><div className="metrics-grid metrics-grid--3" aria-label="Tổng quan chấm công cửa hàng"><MetricCard label="TỔNG GIỜ GHI NHẬN" value={totalHours.toFixed(2)} suffix="giờ" icon={Clock3} tone="blue" /><MetricCard label="LƯỢT HỖ TRỢ NHẬN VÀO" value={supportRows.length} suffix="lượt" icon={Users} tone="orange" /><MetricCard label="CHI PHÍ NHÂN SỰ HỖ TRỢ" value={money(Math.floor(supportExpense))} icon={Wallet} tone="green" /></div><InfoNote>Chi phí lương hỗ trợ được ghi nhận cho <strong>{store?.name || 'cửa hàng nhận hỗ trợ'}</strong>, gồm lương theo giờ hỗ trợ và phụ cấp áp dụng một lần.</InfoNote><Card title="Lịch sử chấm công của nhân viên" action={<div className="toolbar-wrap"><SearchInput value={query} onChange={setQuery} placeholder="Tìm nhân viên..." /><Select value={shift} onChange={(event) => setShift(event.target.value)}><option value="all">Tất cả ca</option>{shifts.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</Select><Select value={employeeId} onChange={(event) => setEmployeeId(event.target.value)}><option value="all">Tất cả nhân viên</option>{scopedEmployees.map((employee) => <option key={employee.id} value={employee.id}>{employee.name}</option>)}</Select></div>}><TableWrap><thead><tr><th>STT</th><th>Nhân viên / Cửa hàng</th><th>Ca làm việc</th><th>Ngày</th><th>Giờ vào / Kết</th><th>Giờ thực tế</th><th>Trạng thái</th><th>Phút sớm / trễ</th><th>Phụ cấp TikTok</th><th>Lương thực nhận</th><th>Vị trí</th></tr></thead><tbody>{rowDetails.map(({ record, employee, pay }, index) => {
    const status = normalizedStatus(record.status || record.arrivalTag)
    const location = attendanceLocationDetails(record)
    const checkIn = String(record.checkIn || record.checkInTime || '—').slice(0, 5)
    const checkOut = String(record.checkOut || record.checkOutTime || '').slice(0, 5)
    const minutesKind = attendanceMinutesKind(record)
    const homeStoreId = pay.support?.homeStoreId || employee?.storeId
    const homeStore = stores.find((item) => String(item.id) === String(homeStoreId))
    const supportStore = stores.find((item) => String(item.id) === String(pay.support?.supportStoreId || storeId))
    const supportTime = pay.support?.transferStartAt || pay.support?.transferEndAt
      ? `${shortDateTime24(pay.support.transferStartAt)} – ${shortDateTime24(pay.support.transferEndAt)}`
      : ''
    return <tr key={record.id}><td>{index + 1}</td><td><strong>{employee?.name || record.employeeName}</strong><small className="table-note">{record.employeeId}</small>{pay.kind === 'support' ? <><Badge tone="orange">NV hỗ trợ</Badge><small className="table-note">{homeStore?.name || homeStoreId || 'Cửa hàng chính'} → {supportStore?.name || store?.name || storeId}</small>{supportTime && <small className="table-note">{supportTime}</small>}<small className="table-note">{money(pay.support.hourlyRate)}/giờ · Phụ cấp {money(pay.support.allowance)}</small></> : <small className="table-note">Cửa hàng chính: {homeStore?.name || store?.name || storeId}</small>}</td><td><strong>{record.shiftName || record.shift}</strong><small className="table-note">{record.shiftStart}–{record.shiftEnd}</small></td><td>{shortDate(record.date || record.workDate)}</td><td><div className="attendance-shift-timing"><span className="attendance-shift-timing__time attendance-shift-timing__time--in"><small>Vào</small><strong>{checkIn}</strong></span>{checkOut ? <><span className="attendance-shift-timing__arrow" aria-hidden="true">→</span><span className="attendance-shift-timing__time attendance-shift-timing__time--out"><small>Kết</small><strong>{checkOut}</strong></span><span className="attendance-shift-timing__state attendance-shift-timing__state--closed"><CheckCircle2 size={14} aria-hidden="true" />Đã kết ca</span></> : <span className="attendance-shift-timing__state attendance-shift-timing__state--open"><Clock3 size={14} aria-hidden="true" />Đang làm</span>}</div></td><td>{Number(record.hours || 0).toFixed(2)}</td><td><Badge tone={statusTone(status)}>{status}</Badge></td><td><span className={`attendance-minutes attendance-minutes--${minutesKind}`}>{attendanceMinutesLabel(record)}</span></td><td>{uniqueTiktokEmployees.has(record.employeeId) ? money(employee?.tiktokAllowance) : money(0)}</td><td>{pay.amount == null ? <span className="table-note" title="Nhân viên Full-Time tại cửa hàng chính không tính lương theo từng lượt chấm công">Không áp dụng</span> : <strong>{money(Math.floor(pay.amount))}</strong>}</td><td>{canViewAttendanceLocations && location.mapUrl ? <a className="attendance-location-link" href={location.mapUrl} target="_blank" rel="noreferrer" aria-label={`Xem vị trí điểm danh của ${employee?.name || record.employeeName || record.employeeId} trên Google Maps`}><MapPin size={16} aria-hidden="true" /><span>Xem vị trí</span></a> : <span className="table-note">—</span>}</td></tr>
  })}<tr className="total-row"><td colSpan="5">TỔNG</td><td>{totalHours.toFixed(2)} giờ</td><td colSpan="2" /><td>{money(totalTiktok)}</td><td>{money(Math.floor(totalPay))}</td><td /></tr></tbody></TableWrap></Card><Card title="THỐNG KÊ ĐI LÀM ĐÚNG GIỜ"><TableWrap><thead><tr><th>STT</th><th>Nhân viên</th><th>Đi trễ</th><th>Đi đúng giờ</th><th>Đi sớm</th><th>Tổng phút sớm</th><th>Tổng phút trễ</th><th>Tổng ca</th><th>Tỷ lệ đúng giờ</th><th>Đánh giá</th></tr></thead><tbody>{stats.map((item, index) => <tr key={item.employee.id}><td>{index + 1}</td><td><strong>{item.employee.name}</strong><small className="table-note">{item.employee.id}</small></td><td className="red-text attendance-stat-value">{item.late}</td><td className="blue-text attendance-stat-value">{item.onTime}</td><td className="green-text attendance-stat-value">{item.early}</td><td className="green-text attendance-stat-value">{item.earlyMinutes}</td><td className="red-text attendance-stat-value">{item.lateMinutes}</td><td>{item.records}</td><td className="blue-text attendance-stat-value"><strong>{item.rate.toFixed(1)}%</strong></td><td><Badge tone={item.evaluation === 'Chuyên cần tốt' ? 'green' : item.evaluation === 'Cần cải thiện' ? 'red' : 'orange'}>{item.evaluation}</Badge></td></tr>)}</tbody></TableWrap></Card></div>
}

export function StorePayrollV2() {
  const app = useStoreData()
  const {
    storeId,
    store,
    employees = [],
    deletedEmployees = [],
    attendance = [],
    salaryAdjustments = [],
    salaryAdvances = [],
    payrollPeriods = [],
    storeEmployeeSalaryConfigs = [],
    compensationEntries = [],
    revenueBonusAllocations = [],
    violations: compensationViolations = [],
    addSalaryAdjustment,
    createSalaryAdvance,
    confirmSalaryAdvance,
    getAvailableSalary,
    closePayrollPeriod,
    confirmPayrollPayment,
    lockPayrollPeriod,
    notify,
  } = app
  const [period, setPeriod] = useState(today().slice(0, 7))
  const [modal, setModal] = useState(null)
  const [form, setForm] = useState({ employeeId: '', type: 'Thưởng khác', amount: '', note: '' })
  const payrollRole = String(app.session?.role || '').trim().toLowerCase()
  const canOperatePayroll = ['admin', 'business_support', 'manager'].includes(payrollRole)
  const canLockPayroll = payrollRole === 'admin'
  const scopedEmployees = employees.filter((employee) => String(employee.unit || 'store') === 'store' && employee.storeId === storeId && employee.status !== 'Đã nghỉ việc')
  const scopedAttendance = attendance.filter((record) => !record.deletedAt && record.storeId === storeId && recordInMonth(record, period))
  const currentPeriod = payrollPeriods.find((item) => item.storeId === storeId && item.period === period)
  const employeeProfiles = [...employees, ...deletedEmployees]
  const profileIdentifiers = (profile = {}) => [profile.id, profile.code, profile.employeeId, profile.employeeCode]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
  const profileForSnapshotRow = (snapshotRow = {}) => {
    const preferredIdentifiers = [
      snapshotRow.settlementProfileId,
      snapshotRow.managerProfileId,
      snapshotRow.employeeId,
    ].map((value) => String(value || '').trim()).filter(Boolean)
    const fallbackId = preferredIdentifiers[0] || 'Nhân viên chưa xác định'
    const snapshotFallback = () => ({
      id: fallbackId,
      name: snapshotRow.employeeName || fallbackId,
      employmentType: snapshotRow.employmentType || snapshotRow.salarySnapshot?.employmentType || '—',
      storeId,
      status: snapshotRow.finalSettlement ? 'Đã nghỉ việc' : '',
      unit: snapshotRow.managerProfileId ? 'store_manager' : 'store',
    })
    const withSnapshotFallbacks = (profile) => ({
      ...profile,
      name: profile.name || profile.displayName || snapshotRow.employeeName || profile.id,
      employmentType: profile.employmentType || snapshotRow.employmentType || snapshotRow.salarySnapshot?.employmentType || '—',
    })
    for (const identifier of preferredIdentifiers) {
      const matchingProfiles = employeeProfiles.filter((profile) => profileIdentifiers(profile).includes(identifier))
      if (matchingProfiles.length === 1) return withSnapshotFallbacks(matchingProfiles[0])
      if (matchingProfiles.length > 1) return snapshotFallback()
    }
    return snapshotFallback()
  }
  const hasAuthoritativeSnapshot = Boolean(
    currentPeriod && !currentPeriod.needsReclose && Array.isArray(currentPeriod.rows),
  )
  const managerPayable = hasAuthoritativeSnapshot && Number(currentPeriod.managerPayable?.amountVnd || 0) > 0
    ? currentPeriod.managerPayable
    : null
  const managerCompensation = currentPeriod?.managerRevenueBonus?.compensation || {}
  const managerCompensationVnd = Math.max(0, Number(managerPayable?.compensationVnd || 0))
  const managerCompensationBreakdownVnd = ['manual', 'work', 'allowance', 'revenue']
    .reduce((sum, field) => sum + Math.max(0, Number(managerCompensation[field] || 0)), 0)
  const managerCompensationBreakdownValid = managerCompensationBreakdownVnd === managerCompensationVnd
  const authoritativeSnapshotRows = hasAuthoritativeSnapshot
    ? [
        ...currentPeriod.rows.map((snapshotRow, index) => ({
          snapshotRow,
          rowKey: `snapshot:${snapshotRow.settlementProfileId || snapshotRow.managerProfileId || snapshotRow.employeeId || 'unknown'}:${index}`,
        })),
        ...(managerPayable ? [{
          snapshotRow: {
            employeeId: managerPayable.employeeId,
            managerProfileId: managerPayable.managerProfileId,
            employeeName: managerPayable.employeeName,
            hours: 0,
            baseSalary: 0,
            manualBonusVnd: managerCompensationBreakdownValid
              ? Math.max(0, Number(managerCompensation.manual || 0))
              : managerCompensationVnd,
            workBonusVnd: managerCompensationBreakdownValid
              ? Math.max(0, Number(managerCompensation.work || 0))
              : 0,
            revenueBonusVnd: (managerCompensationBreakdownValid
              ? Math.max(0, Number(managerCompensation.revenue || 0))
              : 0)
              + Math.max(0, Number(managerPayable.revenueBonusVnd || 0)),
            allowanceVnd: managerCompensationBreakdownValid
              ? Math.max(0, Number(managerCompensation.allowance || 0))
              : 0,
            violationVnd: 0,
            advancesPaid: 0,
            gross: Number(managerPayable.amountVnd || 0),
            netPayVnd: Number(managerPayable.amountVnd || 0),
            salarySnapshot: { hourlyRate: 0, tiktokAllowance: 0 },
            managerPayable: true,
          },
          rowKey: `manager-payable:${managerPayable.managerProfileId || managerPayable.employeeId}`,
        }] : []),
      ]
    : []
  const payrollParticipants = hasAuthoritativeSnapshot
    ? authoritativeSnapshotRows.map(({ snapshotRow, rowKey }) => ({
        employee: profileForSnapshotRow(snapshotRow),
        snapshotRow,
        rowKey,
      }))
    : scopedEmployees.map((employee) => ({ employee, snapshotRow: null, rowKey: `employee:${employee.id}` }))
  const rows = payrollParticipants.map(({ employee, snapshotRow, rowKey }) => {
    const records = scopedAttendance.filter((record) => record.employeeId === employee.id)
    const hours = snapshotRow ? Number(snapshotRow.hours || 0) : records.reduce((sum, record) => sum + Number(record.hours || 0), 0)
    const liveSalaryPolicy = resolveStoreEmployeeSalaryPolicy(employee, {
      store,
      salaryConfigs: storeEmployeeSalaryConfigs,
      period,
    })
    const earnedBase = snapshotRow ? Number(snapshotRow.baseSalary || 0) : calculateEmployeeBasePay(employee, {
      hours,
      store,
      salaryConfig: liveSalaryPolicy,
      period,
    })
    const snapshotSalaryPolicy = snapshotRow?.salarySnapshot?.salaryConfigSnapshot
      || snapshotRow?.salarySnapshot?.salaryConfig
      || snapshotRow?.salarySnapshot
    const configuredHourlyRate = snapshotRow
      ? Number(snapshotSalaryPolicy?.standardHourlyRateVnd || snapshotRow.salarySnapshot?.hourlyRate || 0)
      : Number(liveSalaryPolicy?.standardHourlyRateVnd || getHourlyRate(employee))
    const hourlyRate = configuredHourlyRate > 0
      ? configuredHourlyRate
      : Number(employee.requiredMonthlyHours) > 0
        ? Math.floor(getMonthlySalary(employee) / Number(employee.requiredMonthlyHours))
        : 0
    const legacyAdjustmentNet = salaryAdjustments
      .filter((item) => item.employeeId === employee.id && item.period === period && item.status !== 'Đã hủy' && !item.deletedAt)
      .reduce((sum, item) => {
        const amount = Number(item.amount || 0)
        if (!Number.isSafeInteger(amount) || amount < 0) return sum
        return sum + (adjustmentKind(item.bonusSource || item.type) === 'VIOLATION' ? -amount : amount)
      }, 0)
    const canonical = payrollCompensationTotalsForEmployee({
      compensationEntries,
      revenueBonusAllocations,
      violations: compensationViolations,
      employeeId: employee.id,
      period,
    })
    const revenueBonus = snapshotRow ? Number(snapshotRow.revenueBonusVnd || 0) : canonical.revenue
    const workBonus = snapshotRow ? Number(snapshotRow.workBonusVnd || 0) : canonical.work
    const manualBonus = snapshotRow ? Number(snapshotRow.manualBonusVnd || 0) : canonical.manual + Math.max(0, legacyAdjustmentNet)
    const tiktokAllowance = snapshotRow
      ? Number(snapshotRow.appliedTiktokAllowanceVnd
        ?? snapshotRow.tiktokAllowanceVnd
        ?? (snapshotRow.finalSettlement || snapshotRow.supportCompensation
          ? 0
          : snapshotRow.salarySnapshot?.tiktokAllowance)
        ?? 0)
      : Number(employee.tiktokAllowance || 0)
    const totalAllowance = snapshotRow ? Number(snapshotRow.allowanceVnd || 0) : tiktokAllowance + canonical.allowance
    const otherAllowance = Math.max(0, totalAllowance - tiktokAllowance)
    const violations = snapshotRow ? Number(snapshotRow.violationVnd || 0) : canonical.violations + Math.max(0, -legacyAdjustmentNet)
    const advances = snapshotRow
      ? Number(snapshotRow.advancesPaid ?? snapshotRow.appliedAdvanceVnd ?? 0)
      : salaryAdvances.filter((item) => item.employeeId === employee.id && item.period === period && item.status === 'Đã chi').reduce((sum, item) => sum + Number(item.amount || 0), 0)
    const settlement = calculateAvailableSalary({
      basePay: earnedBase,
      revenueBonus,
      workBonus,
      manualBonus,
      tiktokAllowance,
      otherAllowance,
      confirmedViolations: violations,
      confirmedAdvances: advances,
    })
    return {
      rowKey,
      employee,
      snapshotRow,
      hours,
      earnedBase,
      hourlyRate,
      revenueBonus,
      workBonus,
      manualBonus,
      tiktokAllowance,
      otherAllowance,
      violations,
      advances,
      gross: snapshotRow ? Number(snapshotRow.gross ?? snapshotRow.grossCompensationVnd ?? settlement.grossPay) : settlement.grossPay,
      net: snapshotRow ? Number(snapshotRow.netPayVnd ?? snapshotRow.remaining ?? settlement.availableSalary) : settlement.availableSalary,
    }
  })
  const totals = rows.reduce((value, row) => ({
    gross: value.gross + row.gross,
    bonuses: value.bonuses + row.revenueBonus + row.workBonus + row.manualBonus,
    advances: value.advances + row.advances,
    net: value.net + row.net,
  }), { gross: 0, bonuses: 0, advances: 0, net: 0 })

  const openAdjustment = (type) => {
    if (!canOperatePayroll) return
    setModal(type === 'Ứng lương' ? 'advance' : 'adjustment')
    setForm({ employeeId: scopedEmployees[0]?.id || '', type, amount: '', note: '' })
  }
  const saveAdjustment = async () => {
    if (!canOperatePayroll) return
    const payload = { ...form, storeId, period, amount: parseMoney(form.amount), idempotencyKey: `${form.type}:${form.employeeId}:${period}:${Date.now()}` }
    const result = modal === 'advance' ? await createSalaryAdvance(payload) : await addSalaryAdjustment(payload)
    if (!result.ok) return notify(result.message, 'info')
    setModal(null)
  }
  const handleConfirmAdvance = async (advanceId) => {
    if (!canOperatePayroll) return
    const result = await confirmSalaryAdvance(advanceId)
    if (!result.ok) notify(result.message, 'info')
  }
  const handleClosePayroll = async () => {
    if (!canOperatePayroll) return
    const result = await closePayrollPeriod(storeId, period)
    if (!result.ok) notify(result.message, 'info')
  }
  const handleConfirmPayroll = async () => {
    if (!canOperatePayroll) return
    const result = await confirmPayrollPayment(storeId, period)
    if (!result.ok) notify(result.message, 'info')
  }
  const handleLockPayroll = async () => {
    if (!canLockPayroll) return
    const result = await lockPayrollPeriod(storeId, period)
    if (!result.ok) notify(result.message, 'info')
  }

  return (
    <div className="page">
      <PageHeader
        title="LƯƠNG THƯỞNG NHÂN VIÊN"
        subtitle={`Kỳ ${period} — ${store?.name || ''}. Thu nhập gồm lương, ba nguồn thưởng, phụ cấp và vi phạm đã ghi nhận.`}
        icon={Banknote}
        actions={<><Input type="month" value={period} onChange={(event) => setPeriod(event.target.value)} />{canOperatePayroll && <><Button icon={Gift} onClick={() => openAdjustment('Thưởng khác')}>TẠO THƯỞNG</Button><Button icon={Plus} onClick={() => openAdjustment('Phụ cấp khác')}>TẠO PHỤ CẤP</Button><Button variant="outline" icon={Wallet} onClick={() => openAdjustment('Ứng lương')}>TẠO ỨNG LƯƠNG</Button></>}</>}
      />
      {!canOperatePayroll && <InfoNote>Chế độ rà soát. Quản lý cửa hàng chỉ xem số liệu cửa hàng mình; Admin hoặc Nhân viên hỗ trợ KD thực hiện chốt và chi kỳ lương.</InfoNote>}
      <div className="metrics-grid metrics-grid--4">
        <MetricCard label="TỔNG THU NHẬP" value={money(totals.gross)} icon={TrendingUp} tone="green" />
        <MetricCard label="TỔNG THƯỞNG" value={money(totals.bonuses)} helper="Doanh thu • Công việc • Thủ công" icon={Gift} tone="blue" />
        <MetricCard label="ĐÃ ỨNG" value={money(totals.advances)} icon={Wallet} tone="orange" />
        <MetricCard label="CÒN PHẢI CHI" value={money(totals.net)} icon={Banknote} tone="green" />
      </div>
      <Card title="Chi tiết lương thưởng">
        <TableWrap><thead><tr><th>Nhân viên</th><th>Giờ làm</th><th>Lương cứng</th><th>Thưởng doanh thu</th><th>Thưởng công việc</th><th>Thưởng thủ công</th><th>Phụ cấp TikTok</th><th>Phụ cấp khác</th><th>Vi phạm</th><th>Đã ứng</th><th>Thực nhận</th></tr></thead><tbody>
          {rows.map((row) => <tr key={row.rowKey}><td><strong>{row.employee.name}</strong><small className="table-note">{row.employee.id} • {row.employee.employmentType}</small>{row.snapshotRow?.finalSettlement && <Badge tone="orange">Quyết toán nghỉ việc</Badge>}{row.snapshotRow?.managerPayable && <Badge tone="blue">Thưởng/phụ cấp quản lý</Badge>}</td><td>{row.hours.toFixed(2)}</td><td><strong className="payroll-hourly-rate">{money(row.hourlyRate)}/giờ</strong></td><td>{money(row.revenueBonus)}</td><td>{money(row.workBonus)}</td><td>{money(row.manualBonus)}</td><td>{money(row.tiktokAllowance)}</td><td>{money(row.otherAllowance)}</td><td>{money(row.violations)}</td><td>{money(row.advances)}</td><td><strong>{money(row.net)}</strong></td></tr>)}
          <tr className="total-row"><td colSpan="10">TỔNG CÒN PHẢI CHI</td><td>{money(totals.net)}</td></tr>
        </tbody></TableWrap>
      </Card>
      <Card title="Lịch sử ứng lương của nhân viên" action={canOperatePayroll ? <Button icon={Plus} onClick={() => openAdjustment('Ứng lương')}>TẠO ỨNG LƯƠNG</Button> : null}>
        <TableWrap><thead><tr><th>Thời gian</th><th>Nhân viên</th><th>Số tiền ứng</th><th>Lương khả dụng lúc tạo</th><th>Còn lại</th><th>Người tạo</th><th>Ghi chú</th><th>Trạng thái</th>{canOperatePayroll && <th>Hành động</th>}</tr></thead><tbody>
          {salaryAdvances.filter((item) => item.storeId === storeId && item.period === period).map((item) => <tr key={item.id}><td>{timestamp(item.createdAt)}</td><td><strong>{item.employeeName}</strong><small className="table-note">{item.employeeId}</small></td><td>{money(item.amount)}</td><td>{money(item.availableAtCreation)}</td><td>{money(item.remainingAfter)}</td><td>{item.createdBy?.name}</td><td>{item.note || '—'}</td><td><Badge tone={item.status === 'Đã chi' ? 'green' : 'orange'}>{item.status}</Badge></td>{canOperatePayroll && <td>{item.status === 'Mới tạo' ? <Button icon={CheckCircle2} onClick={() => handleConfirmAdvance(item.id)}>XÁC NHẬN CHI</Button> : <span>{timestamp(item.confirmedAt)}</span>}</td>}</tr>)}
          {!salaryAdvances.some((item) => item.storeId === storeId && item.period === period) && <tr><td colSpan={canOperatePayroll ? 9 : 8}>Chưa có khoản ứng lương.</td></tr>}
        </tbody></TableWrap>
      </Card>
      <Card title="Xử lý cuối kỳ" action={<Badge tone={currentPeriod?.status === 'Đã khóa' ? 'red' : currentPeriod?.confirmedAt ? 'green' : 'orange'}>{currentPeriod?.needsReclose ? 'Cần chốt lại' : currentPeriod?.status || 'Chưa chốt'}</Badge>}>
        {canOperatePayroll ? <div className="period-actions"><Button variant="outline" icon={FileText} onClick={handleClosePayroll} disabled={currentPeriod?.status === 'Đã khóa'}>{currentPeriod?.needsReclose ? 'CHỐT LẠI SỔ' : 'CHỐT SỔ'}</Button><Button icon={Banknote} onClick={handleConfirmPayroll} disabled={Boolean(currentPeriod?.confirmedAt) || currentPeriod?.status === 'Đã khóa' || currentPeriod?.needsReclose}>XÁC NHẬN CHI LƯƠNG</Button>{canLockPayroll && <Button variant="danger" icon={ShieldCheck} onClick={handleLockPayroll} disabled={!currentPeriod || currentPeriod?.status === 'Đã khóa' || currentPeriod?.needsReclose}>KHÓA KỲ CHI LƯƠNG THƯỞNG</Button>}</div> : <InfoNote>Trạng thái kỳ lương chỉ được xem.</InfoNote>}
      </Card>
      {canOperatePayroll && <Modal open={Boolean(modal)} onClose={() => setModal(null)} title={modal === 'advance' ? 'Tạo ứng lương' : `Tạo ${form.type.toLowerCase()}`} footer={<><Button variant="outline" onClick={() => setModal(null)}>Hủy</Button><Button icon={Save} onClick={saveAdjustment}>TẠO</Button></>}><div className="form-grid"><Field label="Nhân viên"><Select value={form.employeeId} onChange={(event) => setForm({ ...form, employeeId: event.target.value })}>{scopedEmployees.map((employee) => <option key={employee.id} value={employee.id}>{employee.name} — {employee.id}</option>)}</Select></Field>{modal !== 'advance' && <Field label="Loại"><Select value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value })}><option>Thưởng khác</option><option>Phụ cấp khác</option><option>Khấu trừ</option></Select></Field>}<Field label="Số tiền"><MoneyInput value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} placeholder="Nhập số tiền" /></Field>{modal === 'advance' && <InfoNote>Lương khả dụng hiện tại: <strong>{money(getAvailableSalary(form.employeeId, period))}</strong>. Khoản ứng phải nhỏ hơn mức này.</InfoNote>}<Field label="Ghi chú" className="span-2"><Input value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} /></Field></div></Modal>}
    </div>
  )
}

export function StoreImportsV2() {
  const app = useStoreData()
  const { storeId, importVouchers = [], createImportVoucher, updateImportVoucher, deleteImportVoucher, notify } = app
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(newImportForm)
  const canManageStore = canManageStoreOperations(app.session?.role)
  const vouchers = importVouchers.filter((item) => item.storeId === storeId && !item.deletedAt && item.status !== 'Đã xóa')
  const totals = vouchers.reduce((value, item) => ({ goods: value.goods + Number(item.goodsAmount || 0), shipping: value.shipping + Number(item.shippingAmount || 0), total: value.total + Number(item.totalAmount ?? (Number(item.goodsAmount || 0) + Number(item.shippingAmount || 0))) }), { goods: 0, shipping: 0, total: 0 })
  const closeModal = () => { setOpen(false); setEditing(null); setForm(newImportForm()) }
  const openCreate = () => {
    if (!canManageStore) return
    setEditing(null)
    setForm(newImportForm())
    setOpen(true)
  }
  const openEdit = (voucher) => {
    if (!canManageStore) return
    const item = voucher.items?.[0] || {}
    setEditing(voucher)
    setForm({
      name: item.name || '',
      quantity: item.packageQuantity || item.bagQuantity || item.quantity || 1,
      weight: item.weight || item.quantity || '',
      price: moneyInput(item.price),
      shippingAmount: moneyInput(voucher.shippingAmount),
      reason: '',
    })
    setOpen(true)
  }
  const save = async () => {
    if (!canManageStore) return
    const quantity = Number(form.quantity)
    const weight = Number(form.weight)
    const price = parseMoney(form.price)
    if (!form.name.trim() || !Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(weight) || weight <= 0 || price <= 0) {
      return notify('Vui lòng nhập đủ tên hàng, số bao, cân nặng và đơn giá.', 'info')
    }
    const firstItem = {
      name: form.name.trim(),
      category: 'Hàng hóa',
      quantity,
      packageQuantity: quantity,
      weight,
      price,
    }
    const items = editing ? [firstItem, ...(editing.items || []).slice(1)] : [firstItem]
    const payload = { storeId, items, shippingAmount: parseMoney(form.shippingAmount), relatedAmount: 0 }
    const result = editing
      ? await updateImportVoucher(editing.id, { ...payload, reason: form.reason })
      : await createImportVoucher({ ...payload, idempotencyKey: `import:${storeId}:${Date.now()}` })
    if (!result.ok) return notify(result.message, 'info')
    closeModal()
  }
  const remove = async (voucher) => {
    if (!canManageStore) return
    const reason = window.prompt(`Lý do xóa phiếu ${voucher.code}:`)
    if (reason == null) return
    const result = await deleteImportVoucher(voucher.id, reason)
    if (!result.ok) notify(result.message, 'info')
  }
  const formTotal = Number(form.weight || 0) * parseMoney(form.price) + parseMoney(form.shippingAmount)
  return (
    <div className="page">
      <PageHeader title="NHẬP HÀNG" subtitle="Mỗi phiếu nhập được lưu theo ngày và giữ đầy đủ thời gian ghi nhận." icon={PackageCheck} actions={canManageStore ? <Button icon={Plus} onClick={openCreate}>THÊM PHIẾU NHẬP</Button> : null} />
      {!canManageStore && <InfoNote>Chế độ chỉ xem. Nhân viên hỗ trợ KD không thể thêm, sửa hoặc xóa phiếu nhập.</InfoNote>}
      <div className="metrics-grid metrics-grid--3">
        <MetricCard label="TỔNG TIỀN NHẬP HÀNG" value={money(totals.goods)} icon={PackageCheck} tone="blue" />
        <MetricCard label="CHI PHÍ VẬN CHUYỂN" value={money(totals.shipping)} icon={TrendingDown} tone="orange" />
        <MetricCard label="TỔNG TIỀN PHIẾU NHẬP" value={money(totals.total)} icon={Banknote} tone="green" />
      </div>
      <Card title="Lịch sử nhập hàng">
        <TableWrap>
          <thead><tr><th>Mã phiếu</th><th>Thời gian ghi nhận</th><th>Tên hàng hóa</th><th>Số lượng (bao)</th><th>Cân nặng (kg)</th><th>Đơn giá (/kg)</th><th>Vận chuyển</th><th>Tổng tiền</th><th>Người tạo</th>{canManageStore && <th>Thao tác</th>}</tr></thead>
          <tbody>{vouchers.map((voucher) => {
            const item = voucher.items?.[0] || {}
            const weight = Number(item.weight ?? item.quantity ?? 0)
            const quantity = Number(item.packageQuantity ?? item.bagQuantity ?? item.quantity ?? 0)
            const total = Number(voucher.totalAmount ?? (weight * Number(item.price || 0) + Number(voucher.shippingAmount || 0)))
            return <tr key={voucher.id}><td><strong>{importVoucherCode(voucher.code)}</strong></td><td>{timestamp(voucher.createdAt)}</td><td>{item.name || '—'}</td><td>{quantity}</td><td>{weight}</td><td>{money(item.price)}/kg</td><td>{money(voucher.shippingAmount)}</td><td><strong>{money(total)}</strong></td><td>{voucher.createdBy?.name || voucher.createdBy || '—'}</td>{canManageStore && <td><div className="row-actions"><button onClick={() => openEdit(voucher)} aria-label={`Sửa ${voucher.code}`}><Edit3 /></button><button className="danger" onClick={() => remove(voucher)} aria-label={`Xóa ${voucher.code}`}><Trash2 /></button></div></td>}</tr>
          })}{!vouchers.length && <tr><td colSpan={canManageStore ? 10 : 9}>Chưa có phiếu nhập hàng.</td></tr>}</tbody>
        </TableWrap>
      </Card>
      {canManageStore && <Modal open={open} onClose={closeModal} title={editing ? `Sửa phiếu ${editing.code}` : 'Tạo phiếu nhập hàng'} footer={<><Button variant="outline" onClick={closeModal}>Hủy</Button><Button icon={Save} onClick={save}>{editing ? 'CẬP NHẬT' : 'LƯU PHIẾU'}</Button></>}>
        <div className="form-grid">
          <Field label="Mã phiếu"><Input value={editing ? importVoucherCode(editing.code) : importVoucherPreview(importVouchers)} readOnly /></Field>
          <Field label="Tên hàng hóa" required><Input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></Field>
          <Field label="Số lượng (bao)" required><Input type="number" min="1" step="1" value={form.quantity} onChange={(event) => setForm({ ...form, quantity: event.target.value })} /></Field>
          <Field label="Cân nặng (kg)" required><Input type="number" min="0.01" step="0.01" value={form.weight} onChange={(event) => setForm({ ...form, weight: event.target.value })} /></Field>
          <Field label="Đơn giá (/kg)" required><MoneyInput value={form.price} onChange={(event) => setForm({ ...form, price: event.target.value })} /></Field>
          <Field label="Vận chuyển"><MoneyInput value={form.shippingAmount} onChange={(event) => setForm({ ...form, shippingAmount: event.target.value })} /></Field>
          <Field label="Tổng tiền" className="span-2"><Input value={money(formTotal)} readOnly /></Field>
          {editing && <Field label="Lý do chỉnh sửa" className="span-2"><Input value={form.reason} onChange={(event) => setForm({ ...form, reason: event.target.value })} placeholder="Bắt buộc để lưu lịch sử kiểm toán" /></Field>}
        </div>
        <InfoNote>Tổng tiền = Đơn giá × Cân nặng + Vận chuyển.</InfoNote>
      </Modal>}
    </div>
  )
}
