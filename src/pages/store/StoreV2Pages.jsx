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
import { OverdueAttendanceModal } from '../../components/OverdueAttendanceModal'
import {
  calculateAvailableSalary,
  financeSummaryFromState,
  financeTransactionsFromState,
  isPayrollPeriodActionable,
  payrollPeriodActionDate,
} from '../../domain'
import { overdueOpenAttendance } from '../../domain/overdueAttendance'
import { activeOccupationLabels, findOccupationOption, occupationValueAllowed, ORDER_PAYMENT_METHODS } from '../../domain/orderInformationSettings'
import { resolveOrderRouteScope } from '../../domain/orderStoreScope'
import { apiGetHistory } from '../../services/idosiApi'
import { useApp } from '../../state/AppContext'
import {
  entryDate,
  entryEmployeeId,
  entryType,
  payrollCompensationTotalsForEmployee,
  sameOperationalIdentifier,
} from '../compensation/compensationViewModel'
import { STORE_SALARY_CONFIG_IDENTIFIER_COLLISION } from '../../domain/storeTieredPayroll'
import {
  businessDate,
  calculateEmployeeBasePay,
  getHourlyRate,
  getMonthlySalary,
  money,
  operationalIdentifierRecordMatch,
  operationalIdentifierReferenceMatchesRecord,
  resolveStoreEmployeeSalaryPolicy,
  shortDate,
  shortDateTime24,
  today,
} from '../../utils'
import { storeDailyReportRows, storeMonthlyReportRows } from './storeReportAnalytics'
import { groupOrdersForDisplay } from './orderShiftGroups'

const parseMoney = (value) => Number(String(value ?? '').replace(/\D/g, '')) || 0
const EMPTY_LIST = Object.freeze([])
const moneyInput = (value) => new Intl.NumberFormat('en-US').format(parseMoney(value))
const timestamp = shortDateTime24
const mergeHistoryRecords = (current, additions) => {
  const byId = new Map((Array.isArray(current) ? current : []).map((record) => [String(record.id || record.code), record]))
  for (const record of Array.isArray(additions) ? additions : []) byId.set(String(record.id || record.code), record)
  return [...byId.values()]
}
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
const compactIdentifier = (value) => String(value ?? '').trim()
const employeeIdentifierValues = (employee = {}) => [
  employee.id,
  employee.code,
  employee.employeeId,
  employee.employeeCode,
].map(compactIdentifier).filter(Boolean)
const employeePrimaryIdentifier = (employee = {}) => employeeIdentifierValues(employee)[0] || ''
const createOperationalIdentifierResolver = (records = [], identifierValuesOf = (record) => [record?.id]) => {
  const exactIndex = new Map()
  const foldedIndex = new Map()
  const addRecord = (index, identifier, record) => {
    const matches = index.get(identifier)
    if (matches) matches.add(record)
    else index.set(identifier, new Set([record]))
  }
  records.forEach((record) => {
    const identifiers = identifierValuesOf(record)
    const values = (Array.isArray(identifiers) ? identifiers : [identifiers]).map(compactIdentifier).filter(Boolean)
    values.forEach((identifier) => {
      addRecord(exactIndex, identifier, record)
      addRecord(foldedIndex, identifier.toLocaleLowerCase('en-US'), record)
    })
  })
  return (reference) => {
    const requested = compactIdentifier(reference)
    if (!requested) return { record: null, ambiguous: false, matches: [] }
    const matches = [...(foldedIndex.get(requested.toLocaleLowerCase('en-US')) || [])]
    const exactMatches = [...(exactIndex.get(requested) || [])]
    if (exactMatches.length === 1) return { record: exactMatches[0], ambiguous: false, matches }
    if (exactMatches.length > 1 || matches.length > 1) return { record: null, ambiguous: true, matches }
    return { record: matches[0] || null, ambiguous: false, matches }
  }
}
const salaryAvailabilityForEmployee = ({ employees, employeeReference, getAvailableSalary, period }) => {
  const employeeMatch = operationalIdentifierRecordMatch(employees, employeeReference, employeeIdentifierValues)
  if (!employeeReference || employeeMatch.ambiguous || !employeeMatch.record) {
    return {
      ok: false,
      available: 0,
      message: 'Không thể xác định duy nhất nhân viên để tính lương khả dụng.',
    }
  }
  try {
    return {
      ok: true,
      available: getAvailableSalary(employeePrimaryIdentifier(employeeMatch.record), period),
      message: '',
    }
  } catch (error) {
    return {
      ok: false,
      available: 0,
      message: error?.code === STORE_SALARY_CONFIG_IDENTIFIER_COLLISION
        ? 'Không thể tính lương khả dụng vì có cấu hình lương trùng kỳ với mã chỉ khác chữ hoa/thường. Cần xử lý dữ liệu trùng trước khi thao tác ứng lương.'
        : error?.message || 'Không thể tính lương khả dụng của nhân viên.',
    }
  }
}
const employeeOperationalUnit = (employee = {}) => compactIdentifier(
  employee.unit || employee.unitType || employee.department || 'store',
).toLocaleLowerCase('en-US')
const isStoreManagerProfile = (employee = {}) => [
  'store_manager',
  'store-manager',
  'store manager',
  'manager',
].includes(employeeOperationalUnit(employee))
const attendanceEmployeeReference = (record = {}) => compactIdentifier(record.employeeId || record.employeeCode)
const payrollRowEmployeeReference = (row = {}) => compactIdentifier(row?.employeeId || row?.employeeCode)
const attendanceShiftIdentifier = (record = {}) => compactIdentifier(record.shiftId || record.shift)
const recordsHaveIdentifierCollision = (records = [], identifierValuesOf = (record) => [record?.id]) => (
  records.some((record, index) => {
    const identifiers = identifierValuesOf(record)
    const values = (Array.isArray(identifiers) ? identifiers : [identifiers]).map(compactIdentifier).filter(Boolean)
    return records.slice(index + 1).some((candidate) => {
      const candidateIdentifiers = identifierValuesOf(candidate)
      const candidateValues = (Array.isArray(candidateIdentifiers) ? candidateIdentifiers : [candidateIdentifiers])
        .map(compactIdentifier)
        .filter(Boolean)
      return values.some((value) => candidateValues.some((candidateValue) => (
        sameOperationalIdentifier(value, candidateValue)
      )))
    })
  })
)
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
  const transferIdMatch = transferId
    ? operationalIdentifierRecordMatch(transfers, transferId, (item) => [item.id])
    : { record: null, ambiguous: false }
  const transferScopeReference = `${attendanceEmployeeReference(record)}\u0000${compactIdentifier(record.storeId)}`
  const transferScopeMatch = !transferId && attendanceEmployeeReference(record) && record.storeId
    ? operationalIdentifierRecordMatch(
        transfers,
        transferScopeReference,
        (item) => [`${compactIdentifier(item.employeeId || item.employeeCode)}\u0000${compactIdentifier(item.toStoreId)}`],
      )
    : { record: null, ambiguous: false }
  const transfer = transferIdMatch.ambiguous || transferScopeMatch.ambiguous
    ? null
    : transferIdMatch.record || transferScopeMatch.record
  const homeStoreId = canonical.homeStoreId || record.homeStoreId || transfer?.fromStoreId || employee?.storeId || ''
  const supportStoreId = canonical.supportStoreId || record.supportStoreId || transfer?.toStoreId || record.storeId || ''
  const isSupport = Boolean(transferId || canonical.supportStoreId || record.supportStoreId)
    || Boolean(homeStoreId && supportStoreId && !sameOperationalIdentifier(homeStoreId, supportStoreId) && transfer)
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
    homeStoreName: canonical.homeStoreName || record.homeStoreName || '',
    supportStoreId,
    supportStoreName: canonical.supportStoreName || record.supportStoreName || '',
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
const supportTransferIdentifiers = (supportDetails = []) => [...new Set(supportDetails
  .map((pay) => compactIdentifier(pay?.support?.transferId))
  .filter(Boolean))]
const workEntryMatchesPayrollStore = ({
  entry,
  employee,
  attendanceRecords,
  transfers,
  storeReferenceMatches,
  allowedSupportTransferIds = null,
  matchAttendance = null,
  matchSupportTransfer = null,
}) => {
  if (entryType(entry) !== 'WORK') return false
  const supportStoreId = compactIdentifier(entry?.supportStoreId)
  const transferId = compactIdentifier(entry?.supportTransferId)
  const employeeReferences = employeeIdentifierValues(employee)
  let transferStoreId = ''
  if (transferId) {
    const transferMatch = matchSupportTransfer
      ? matchSupportTransfer(transferId)
      : operationalIdentifierRecordMatch(transfers, transferId, (transfer) => [transfer?.id])
    if (transferMatch.ambiguous || (transferMatch.record && !employeeReferences.some((reference) => (
      sameOperationalIdentifier(transferMatch.record.employeeId, reference)
    )))) return false
    transferStoreId = compactIdentifier(transferMatch.record?.toStoreId)
  }
  const attendanceId = compactIdentifier(entry?.attendanceId)
  let attendanceStoreId = ''
  let attendanceTransferId = ''
  if (attendanceId) {
    const match = matchAttendance
      ? matchAttendance(attendanceId)
      : operationalIdentifierRecordMatch(attendanceRecords, attendanceId, (record) => [record?.id])
    if (match.ambiguous || !match.record
      || !employeeReferences.some((reference) => sameOperationalIdentifier(attendanceEmployeeReference(match.record), reference))
      || (transferId && !sameOperationalIdentifier(match.record.supportTransferId, transferId))) return false
    attendanceStoreId = compactIdentifier(match.record.storeId)
    attendanceTransferId = compactIdentifier(match.record.supportTransferId)
  }
  const accountingStoreId = compactIdentifier(entry?.storeId)
  const storeReferences = [supportStoreId, transferStoreId, attendanceStoreId, accountingStoreId].filter(Boolean)
  if (!storeReferences.length || storeReferences.some((reference) => !storeReferenceMatches(reference))) return false
  if (allowedSupportTransferIds instanceof Set) {
    const resolvedTransferId = transferId || attendanceTransferId
    if (!resolvedTransferId
      || !allowedSupportTransferIds.has(resolvedTransferId.toLocaleLowerCase('en-US'))) return false
  }
  return true
}
const supportWorkEntryHasCanonicalAudit = ({
  entry,
  employee,
  supportDetails,
  storeReferenceMatches,
}) => {
  if (entryType(entry) !== 'WORK') return false
  const transferId = compactIdentifier(entry?.supportTransferId)
  const homeStoreId = compactIdentifier(entry?.homeStoreId)
  const supportStoreId = compactIdentifier(entry?.supportStoreId)
  const accountingStoreId = compactIdentifier(entry?.storeId)
  if (!transferId || !homeStoreId || !supportStoreId || !accountingStoreId) return false
  if (!storeReferenceMatches(accountingStoreId) || !storeReferenceMatches(supportStoreId)) return false
  if (!sameOperationalIdentifier(homeStoreId, employee?.storeId)) return false
  return supportTransferIdentifiers(supportDetails).some((candidate) => (
    sameOperationalIdentifier(candidate, transferId)
  ))
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
  const stores = Array.isArray(app.stores) ? app.stores : []
  const canUsePreferredStore = ['admin', 'business_support', 'manager'].includes(app.session?.role)
    && Boolean(preferredStoreId)
  const requestedStoreId = app.session?.role === 'store_manager'
    ? app.session.storeId
    : canUsePreferredStore
      ? preferredStoreId
      : app.activeStore?.id || app.activeStoreId || app.session?.storeId
  const storeMatch = operationalIdentifierRecordMatch(stores, requestedStoreId, (item) => [item.id])
  const store = storeMatch.ambiguous ? null : storeMatch.record
  return {
    ...app,
    storeId: store?.id || compactIdentifier(requestedStoreId),
    store,
    storeSelectionError: storeMatch.ambiguous
      ? Object.assign(new Error('STORE_IDENTIFIER_COLLISION'), { code: 'STORE_IDENTIFIER_COLLISION' })
      : requestedStoreId && !store
        ? Object.assign(new Error('STORE_NOT_FOUND'), { code: 'STORE_NOT_FOUND' })
        : null,
  }
}

export function StoreOverviewV2() {
  const app = useStoreData()
  const navigate = useNavigate()
  const { storeId, store, employees = [], orders = [], attendance = [], schedule = [] } = app
  const [now, setNow] = useState(() => new Date())
  const [period, setPeriod] = useState(today().slice(0, 7))
  const summary = financeSummaryFromState(app, { storeId, ...monthBounds(period) })
  const storeEmployees = employees.filter((employee) => String(employee.unit || 'store') === 'store' && employee.storeId === storeId && employee.status !== 'Đã nghỉ việc')
  const todayOrders = orders.filter((order) => order.storeId === storeId && !order.deletedAt && businessDate(order.createdAt) === today())
  const openAttendance = attendance.filter((record) => sameOperationalIdentifier(record.storeId, storeId) && !record.deletedAt && !record.checkOutAt && !record.checkOut)
  const todayAssignments = schedule.filter((record) => record.storeId === storeId && (!record.date || record.date === today()))
  const overdueAttendance = overdueOpenAttendance(openAttendance, now).map((record) => {
    const match = operationalIdentifierRecordMatch(employees, attendanceEmployeeReference(record), employeeIdentifierValues)
    return { ...record, employeeName: match.ambiguous ? record.employeeName : match.record?.name || record.employeeName }
  })

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000)
    return () => window.clearInterval(timer)
  }, [])

  return (
    <div className="page">
      <OverdueAttendanceModal records={overdueAttendance} audience="store" />
      <PageHeader title={store?.name || 'TỔNG QUAN CỬA HÀNG'} subtitle="Không gian vận hành dành cho Admin và quản lý cửa hàng." icon={Store} actions={<Input type="month" value={period} onChange={(event) => setPeriod(event.target.value)} />} />
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
  const {
    storeId,
    store,
    orders: projectionOrders = [],
    employees = [],
    orderInformationOptions = [],
    apiStatus,
    updateOrder,
    deleteOrder,
    notify,
  } = app
  const orderActorRole = app.session?.role
  const canEditOrders = ['admin', 'business_support'].includes(orderActorRole)
  const canEditOrderAmount = orderActorRole === 'admin'
  const canDeleteOrders = orderActorRole === 'admin'
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
  const historyPeriod = month || (date ? date.slice(0, 7) : '')
  const historyEmployeeId = employeeId === 'all' ? '' : employeeId
  const historyKey = `${storeId}:${historyPeriod}:${historyEmployeeId}`
  const [history, setHistory] = useState({ key: '', records: [], page: null, error: '' })
  const [loadingMoreHistory, setLoadingMoreHistory] = useState(false)
  const remoteHistory = apiStatus === 'connected'
  const historyReady = remoteHistory && history.key === historyKey
  const orders = useMemo(() => {
    if (!historyReady) return projectionOrders
    const projectedById = new Map(projectionOrders.map((record) => [String(record.id || record.code), record]))
    const merged = history.records.map((record) => projectedById.get(String(record.id || record.code)) || record)
    const known = new Set(merged.map((record) => String(record.id || record.code)))
    return [...projectionOrders.filter((record) => !known.has(String(record.id || record.code))), ...merged]
  }, [history.records, historyReady, projectionOrders])

  useEffect(() => {
    if (!remoteHistory || !storeId) return undefined
    let active = true
    apiGetHistory('orders', {
      storeId,
      employeeId: historyEmployeeId,
      period: historyPeriod,
      limit: 50,
    }).then((payload) => {
      if (!active) return
      setHistory({ key: historyKey, records: payload.records || [], page: payload.page || null, error: '' })
    }).catch((error) => {
      if (!active) return
      setHistory({ key: historyKey, records: [], page: null, error: error?.message || 'Không thể tải lịch sử đơn hàng.' })
    })
    return () => { active = false }
  }, [historyEmployeeId, historyKey, historyPeriod, remoteHistory, storeId])

  const loadMoreHistory = async () => {
    if (!history.page?.nextCursor || loadingMoreHistory) return
    setLoadingMoreHistory(true)
    try {
      const payload = await apiGetHistory('orders', {
        storeId,
        employeeId: historyEmployeeId,
        period: historyPeriod,
        cursor: history.page.nextCursor,
        limit: 50,
      })
      setHistory((current) => current.key === historyKey ? {
        ...current,
        records: mergeHistoryRecords(current.records, payload.records || []),
        page: payload.page || null,
        error: '',
      } : current)
    } catch (error) {
      setHistory((current) => current.key === historyKey
        ? { ...current, error: error?.message || 'Không thể tải thêm lịch sử đơn hàng.' }
        : current)
    } finally {
      setLoadingMoreHistory(false)
    }
  }
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
  const groups = useMemo(() => groupOrdersForDisplay(filtered, view), [filtered, view])
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
    if (canEditOrderAmount && !(amount > 0)) nextErrors.amount = 'Số tiền đơn hàng phải lớn hơn 0.'
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
        customerName: form.customerName,
        customerPhone: form.customerPhone,
        customerAge: form.customerAge,
        gender: form.gender,
        occupation: form.occupation,
        acquisitionChannel: form.acquisitionChannel,
        paymentMethod: form.paymentMethod,
        ...(canEditOrderAmount ? { amount } : {}),
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
      {orderActorRole === 'business_support'
        ? <InfoNote>HTKD được sửa thông tin và hình thức thanh toán; chỉ Admin được sửa số tiền hoặc xóa đơn hàng.</InfoNote>
        : !canEditOrders && <InfoNote>Chế độ chỉ xem: tài khoản hiện tại không thể chỉnh sửa hoặc xóa đơn hàng.</InfoNote>}
      <div className="tabs"><button className={view === 'shift' ? 'active' : ''} onClick={() => setView('shift')}>Theo ca</button><button className={view === 'employee' ? 'active' : ''} onClick={() => setView('employee')}>Theo nhân viên</button><button className={view === 'day' ? 'active' : ''} onClick={() => setView('day')}>Theo ngày</button></div>
      {groups.map(([key, group]) => {
        const first = group[0]
        const groupTotal = group.reduce((sum, order) => sum + Number(order.amount || 0), 0)
        const title = view === 'employee'
          ? `${first.employeeName || 'Dữ liệu hệ thống'} — ${first.employeeId || ''}`
          : view === 'day'
            ? `Ngày ${shortDate(businessDate(first.createdAt))}`
            : <span className="order-group__shift-title">
                <strong>{first.shiftName || 'Chưa gắn ca'}</strong>
                <small>{first.shiftStart || '--:--'}–{first.shiftEnd || '--:--'} · {shortDate(businessDate(first.createdAt))}</small>
              </span>
        return <Card key={key} className="order-group" title={title} action={<div className="order-group__totals">
          <span className="order-group__total-amount"><small>Tổng tiền ca</small><strong>{money(groupTotal)}</strong></span>
          <span className="order-group__order-count"><small>Số lượng đơn</small><strong>{group.length}</strong><em>đơn</em></span>
        </div>}><TableWrap><thead><tr><th>Thời gian</th><th>Mã đơn</th><th>Khách hàng</th><th>Khảo sát</th><th>Số tiền</th><th>Thanh toán</th><th>Nhân viên</th><th>Trạng thái</th>{canEditOrders && <th>Thao tác</th>}</tr></thead><tbody>{group.map((order) => <tr id={`order-${order.id}`} className={String(order.id) === requestedOrderKey ? 'order-row--highlight' : ''} key={order.id}><td>{timestamp(order.updatedAt || order.createdAt)}</td><td><strong>{order.code}</strong></td><td>{order.customerName || 'Khách lẻ'}<small className="table-note">{order.customerPhone || 'Không có SĐT'}{order.customerAge != null ? ` • ${order.customerAge} tuổi` : ''}</small></td><td>{order.gender || '—'}<small className="table-note">{order.occupation || 'Chưa rõ'} • {order.acquisitionChannel || 'Chưa rõ kênh'}</small></td><td><strong>{money(order.amount)}</strong></td><td><Badge tone={order.paymentMethod === 'Tiền mặt' ? 'green' : 'blue'}>{order.paymentMethod}</Badge></td><td>{order.employeeName}<small className="table-note">{order.employeeId || '—'}</small></td><td><Badge>{order.status}</Badge></td>{canEditOrders && <td><div className="row-actions"><Button variant="outline" icon={Edit3} onClick={() => openEdit(order)}>Sửa</Button>{canDeleteOrders && <Button variant="danger" icon={Trash2} onClick={() => remove(order)}>Xóa</Button>}</div></td>}</tr>)}</tbody></TableWrap></Card>
      })}
      {remoteHistory && !historyReady && <InfoNote>Đang tải trang lịch sử đơn hàng...</InfoNote>}
      {historyReady && history.error && <InfoNote tone="red">{history.error}</InfoNote>}
      {historyReady && history.page?.hasMore && (
        <div className="period-actions">
          <Button variant="outline" loading={loadingMoreHistory} disabled={loadingMoreHistory} onClick={loadMoreHistory}>
            TẢI THÊM LỊCH SỬ
          </Button>
        </div>
      )}
      {!groups.length && <InfoNote>Chưa có đơn hàng phù hợp bộ lọc.</InfoNote>}
      {canEditOrders && <Modal open={Boolean(editing)} onClose={closeEditor} title={`Sửa đơn hàng ${editing?.code || ''}`} footer={<><Button variant="outline" onClick={closeEditor} disabled={saving}>Hủy</Button><Button icon={Save} loading={saving} disabled={saving} onClick={save}>LƯU THAY ĐỔI</Button></>}>
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
          <Field label="Số tiền" required={canEditOrderAmount} hint={!canEditOrderAmount ? 'Chỉ Admin được thay đổi số tiền.' : undefined} error={formErrors.amount}><MoneyInput value={form.amount} disabled={!canEditOrderAmount} onChange={(event) => updateForm('amount', event.target.value)} placeholder="Nhập số tiền" /></Field>
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
  const storeReferenceMatches = (reference) => Boolean(store) && operationalIdentifierReferenceMatchesRecord(
    stores,
    store,
    reference,
    (item) => item.id,
  )
  const storeRows = attendance.filter((record) => (
    !record.deletedAt && storeReferenceMatches(record.storeId) && recordInMonth(record, period)
  ))
  const storeRowEmployees = storeRows.map((record) => {
    const match = operationalIdentifierRecordMatch(employees, attendanceEmployeeReference(record), employeeIdentifierValues)
    return { record, employee: match.ambiguous ? null : match.record }
  })
  const linkedEmployees = new Set(storeRowEmployees.map((item) => item.employee).filter(Boolean))
  const scopedEmployees = employees.filter((employee) => String(employee.unit || 'store') === 'store'
    && (storeReferenceMatches(employee.storeId) || linkedEmployees.has(employee)))
  const shifts = storeRows.reduce((sources, record) => {
    const id = attendanceShiftIdentifier(record)
    if (!id) return sources
    const name = compactIdentifier(record.shiftName || id)
    const existing = sources.find((source) => source.id === id)
    if (!existing) sources.push({ id, name })
    else if (existing.name !== name) existing.name = id
    return sources
  }, [])
  const selectedShift = shift === 'all'
    ? null
    : operationalIdentifierRecordMatch(shifts, shift, (item) => [item.id])
  const selectedEmployee = employeeId === 'all'
    ? null
    : operationalIdentifierRecordMatch(employees, employeeId, employeeIdentifierValues)
  const normalizedQuery = query.toLocaleLowerCase('vi-VN')
  const filteredRowEmployees = storeRowEmployees.filter(({ record, employee }) => (
    (shift === 'all' || (
      !selectedShift?.ambiguous
      && selectedShift?.record
      && operationalIdentifierReferenceMatchesRecord(
        shifts,
        selectedShift.record,
        attendanceShiftIdentifier(record),
        (item) => item.id,
      )
    ))
    && (employeeId === 'all' || (
      !selectedEmployee?.ambiguous
      && selectedEmployee?.record === employee
    ))
    && (!query || [attendanceEmployeeReference(record), employee?.name, record.employeeName, record.shiftName]
      .some((value) => String(value || '').toLocaleLowerCase('vi-VN').includes(normalizedQuery)))
  ))
  const rows = filteredRowEmployees.map((item) => item.record)
  const rowDetails = filteredRowEmployees.map(({ record, employee }) => ({
    record,
    employee,
    pay: attendancePayDetails(record, employee, supportTransfers),
  }))
  const uniqueTiktokEmployees = new Set(rowDetails
    .filter(({ employee, pay }) => pay.kind !== 'support' && employee?.tiktokAllowance > 0)
    .map(({ employee }) => employee))
  const totalTiktok = [...uniqueTiktokEmployees].reduce((sum, employee) => sum + Number(employee.tiktokAllowance || 0), 0)
  const totalHours = rows.reduce((sum, record) => sum + Number(record.hours || 0), 0)
  const totalPay = rowDetails.reduce((sum, item) => sum + Number(item.pay.amount || 0), 0)
  const supportRows = rowDetails.filter((item) => item.pay.kind === 'support')
  const recordedSupportExpenses = expenseEntries.filter((entry) => !entry.deletedAt
    && !entry.voidedAt
    && entry.recognized !== false
    && entry.sourceType === 'support-attendance-compensation'
    && storeReferenceMatches(entry.storeId)
    && recordInMonth(entry, period))
  const supportAttendanceRecords = supportRows.map((item) => item.record)
  const supportExpenseByAttendance = recordedSupportExpenses.reduce((entries, entry) => {
    const sourceMatch = operationalIdentifierRecordMatch(
      supportAttendanceRecords,
      entry.sourceId || entry.attendanceId,
      (record) => [record.id],
    )
    if (!sourceMatch.ambiguous && sourceMatch.record && !entries.has(sourceMatch.record)) {
      entries.set(sourceMatch.record, Number(entry.amount || 0))
    }
    return entries
  }, new Map())
  const supportExpense = [...supportExpenseByAttendance.values()].reduce((sum, amount) => sum + amount, 0)
    + supportRows
      .filter((item) => !supportExpenseByAttendance.has(item.record))
      .reduce((sum, item) => sum + Number(item.pay.amount || 0), 0)
  const stats = scopedEmployees.map((employee) => {
    const records = rowDetails.filter((item) => item.employee === employee).map((item) => item.record)
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

  return <div className="page"><PageHeader title="CHẤM CÔNG CỬA HÀNG" subtitle="Lịch sử gồm nhân viên trực thuộc và nhân viên được điều chuyển đến hỗ trợ." icon={Clock3} actions={<Input type="month" value={period} onChange={(event) => setPeriod(event.target.value)} />} /><div className="metrics-grid metrics-grid--3" aria-label="Tổng quan chấm công cửa hàng"><MetricCard label="TỔNG GIỜ GHI NHẬN" value={totalHours.toFixed(2)} suffix="giờ" icon={Clock3} tone="blue" /><MetricCard label="LƯỢT HỖ TRỢ NHẬN VÀO" value={supportRows.length} suffix="lượt" icon={Users} tone="orange" /><MetricCard label="CHI PHÍ NHÂN SỰ HỖ TRỢ" value={money(Math.floor(supportExpense))} icon={Wallet} tone="green" /></div><InfoNote>Chi phí lương hỗ trợ được ghi nhận cho <strong>{store?.name || 'cửa hàng nhận hỗ trợ'}</strong>, gồm lương theo giờ hỗ trợ và phụ cấp áp dụng một lần.</InfoNote><Card title="Lịch sử chấm công của nhân viên" action={<div className="toolbar-wrap"><SearchInput value={query} onChange={setQuery} placeholder="Tìm nhân viên..." /><Select value={shift} onChange={(event) => setShift(event.target.value)}><option value="all">Tất cả ca</option>{shifts.map(({ id, name }) => <option key={id} value={id}>{name}</option>)}</Select><Select value={employeeId} onChange={(event) => setEmployeeId(event.target.value)}><option value="all">Tất cả nhân viên</option>{scopedEmployees.map((employee) => <option key={employeePrimaryIdentifier(employee)} value={employeePrimaryIdentifier(employee)}>{employee.name}</option>)}</Select></div>}><TableWrap><thead><tr><th>STT</th><th>Nhân viên / Cửa hàng</th><th>Ca làm việc</th><th>Ngày</th><th>Giờ vào / Kết</th><th>Giờ thực tế</th><th>Trạng thái</th><th>Phút sớm / trễ</th><th>Phụ cấp TikTok</th><th>Lương thực nhận</th><th>Vị trí</th></tr></thead><tbody>{rowDetails.map(({ record, employee, pay }, index) => {
    const status = normalizedStatus(record.status || record.arrivalTag)
    const location = attendanceLocationDetails(record)
    const checkIn = String(record.checkIn || record.checkInTime || '—').slice(0, 5)
    const checkOut = String(record.checkOut || record.checkOutTime || '').slice(0, 5)
    const minutesKind = attendanceMinutesKind(record)
    const homeStoreId = pay.support?.homeStoreId || employee?.storeId
    const homeStoreMatch = operationalIdentifierRecordMatch(stores, homeStoreId, (item) => [item.id])
    const supportStoreMatch = operationalIdentifierRecordMatch(stores, pay.support?.supportStoreId || storeId, (item) => [item.id])
    const homeStore = homeStoreMatch.ambiguous ? null : homeStoreMatch.record
    const supportStore = supportStoreMatch.ambiguous ? null : supportStoreMatch.record
    const supportTime = pay.support?.transferStartAt || pay.support?.transferEndAt
      ? `${shortDateTime24(pay.support.transferStartAt)} – ${shortDateTime24(pay.support.transferEndAt)}`
      : ''
    return <tr key={record.id}><td>{index + 1}</td><td><strong>{employee?.name || record.employeeName}</strong><small className="table-note">{attendanceEmployeeReference(record)}</small>{pay.kind === 'support' ? <><Badge tone="orange">NV hỗ trợ</Badge><small className="table-note">{pay.support.homeStoreName || homeStore?.name || homeStoreId || 'Cửa hàng chính'} → {pay.support.supportStoreName || supportStore?.name || store?.name || storeId}</small>{supportTime && <small className="table-note">{supportTime}</small>}<small className="table-note">{money(pay.support.hourlyRate)}/giờ · Phụ cấp {money(pay.support.allowance)}</small></> : <small className="table-note">Cửa hàng chính: {homeStore?.name || store?.name || storeId}</small>}</td><td><strong>{record.shiftName || attendanceShiftIdentifier(record)}</strong><small className="table-note">{record.shiftStart}–{record.shiftEnd}</small></td><td>{shortDate(record.date || record.workDate)}</td><td><div className="attendance-shift-timing"><span className="attendance-shift-timing__time attendance-shift-timing__time--in"><small>Vào</small><strong>{checkIn}</strong></span>{checkOut ? <><span className="attendance-shift-timing__arrow" aria-hidden="true">→</span><span className="attendance-shift-timing__time attendance-shift-timing__time--out"><small>Kết</small><strong>{checkOut}</strong></span><span className="attendance-shift-timing__state attendance-shift-timing__state--closed"><CheckCircle2 size={14} aria-hidden="true" />Đã kết ca</span></> : <span className="attendance-shift-timing__state attendance-shift-timing__state--open"><Clock3 size={14} aria-hidden="true" />Đang làm</span>}</div></td><td>{Number(record.hours || 0).toFixed(2)}</td><td><Badge tone={statusTone(status)}>{status}</Badge></td><td><span className={`attendance-minutes attendance-minutes--${minutesKind}`}>{attendanceMinutesLabel(record)}</span></td><td>{uniqueTiktokEmployees.has(employee) ? money(employee?.tiktokAllowance) : money(0)}</td><td>{pay.amount == null ? <span className="table-note" title="Nhân viên Full-Time tại cửa hàng chính không tính lương theo từng lượt chấm công">Không áp dụng</span> : <strong>{money(Math.floor(pay.amount))}</strong>}</td><td>{canViewAttendanceLocations && location.mapUrl ? <a className="attendance-location-link" href={location.mapUrl} target="_blank" rel="noreferrer" aria-label={`Xem vị trí điểm danh của ${employee?.name || record.employeeName || attendanceEmployeeReference(record)} trên Google Maps`}><MapPin size={16} aria-hidden="true" /><span>Xem vị trí</span></a> : <span className="table-note">—</span>}</td></tr>
  })}<tr className="total-row"><td colSpan="5">TỔNG</td><td>{totalHours.toFixed(2)} giờ</td><td colSpan="2" /><td>{money(totalTiktok)}</td><td>{money(Math.floor(totalPay))}</td><td /></tr></tbody></TableWrap></Card><Card title="THỐNG KÊ ĐI LÀM ĐÚNG GIỜ"><TableWrap><thead><tr><th>STT</th><th>Nhân viên</th><th>Đi trễ</th><th>Đi đúng giờ</th><th>Đi sớm</th><th>Tổng phút sớm</th><th>Tổng phút trễ</th><th>Tổng ca</th><th>Tỷ lệ đúng giờ</th><th>Đánh giá</th></tr></thead><tbody>{stats.map((item, index) => <tr key={item.employee.id}><td>{index + 1}</td><td><strong>{item.employee.name}</strong><small className="table-note">{item.employee.id}</small></td><td className="red-text attendance-stat-value">{item.late}</td><td className="blue-text attendance-stat-value">{item.onTime}</td><td className="green-text attendance-stat-value">{item.early}</td><td className="green-text attendance-stat-value">{item.earlyMinutes}</td><td className="red-text attendance-stat-value">{item.lateMinutes}</td><td>{item.records}</td><td className="blue-text attendance-stat-value"><strong>{item.rate.toFixed(1)}%</strong></td><td><Badge tone={item.evaluation === 'Chuyên cần tốt' ? 'green' : item.evaluation === 'Cần cải thiện' ? 'red' : 'orange'}>{item.evaluation}</Badge></td></tr>)}</tbody></TableWrap></Card></div>
}

export function StorePayrollV2() {
  const app = useStoreData()
  const [payrollSearchParams, setPayrollSearchParams] = useSearchParams()
  const {
    storeId,
    store,
    stores = [],
    employees = [],
    attendance = [],
    supportTransfers = EMPTY_LIST,
    salaryAdjustments = [],
    salaryAdvances = [],
    payrollPeriods = [],
    storeEmployeeSalaryConfigs = EMPTY_LIST,
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
  const requestedPayrollPeriod = payrollSearchParams.get('period') || ''
  const period = /^\d{4}-\d{2}$/u.test(requestedPayrollPeriod)
    ? requestedPayrollPeriod
    : today().slice(0, 7)
  const setPayrollPeriod = (nextPeriod) => setPayrollSearchParams((current) => {
    const next = new URLSearchParams(current)
    if (nextPeriod) next.set('period', nextPeriod)
    else next.delete('period')
    return next
  }, { replace: true })
  const [modal, setModal] = useState(null)
  const [payrollConfirmation, setPayrollConfirmation] = useState(null)
  const [processingPayrollAction, setProcessingPayrollAction] = useState(false)
  const [form, setForm] = useState({ employeeId: '', type: 'Thưởng khác', amount: '', note: '' })
  const [savingAdjustment, setSavingAdjustment] = useState(false)
  const payrollRole = String(app.session?.role || '').trim().toLowerCase()
  const canOperatePayroll = ['admin', 'business_support', 'manager'].includes(payrollRole)
  const canLockPayroll = payrollRole === 'admin'
  const {
    scopedEmployees,
    currentPeriod,
    payrollPreviewError,
    rows,
    totals,
    scopedSalaryAdvances,
  } = useMemo(() => {
  const storeReferenceMatches = (reference) => Boolean(store) && operationalIdentifierReferenceMatchesRecord(
    stores,
    store,
    reference,
    (item) => item.id,
  )
  const matchEmployee = createOperationalIdentifierResolver(employees, employeeIdentifierValues)
  const matchAttendance = createOperationalIdentifierResolver(attendance, (record) => [record?.id])
  const matchSupportTransfer = createOperationalIdentifierResolver(supportTransfers, (record) => [record?.id])
  const scopedEmployees = employees.filter((employee) => String(employee.unit || 'store') === 'store'
    && !employee.deletedAt
    && storeReferenceMatches(employee.storeId)
    && employee.status !== 'Đã nghỉ việc')
  const scopedAttendance = attendance.filter((record) => (
    !record.deletedAt && storeReferenceMatches(record.storeId) && recordInMonth(record, period)
  ))
  const currentPeriodCandidates = payrollPeriods.filter((item) => (
    !item.supersededAt
    && storeReferenceMatches(item.storeId)
    && item.period === period
  ))
  const currentPeriod = currentPeriodCandidates.length === 1 ? currentPeriodCandidates[0] : null
  const immutableSnapshotRows = currentPeriod && !currentPeriod.needsReclose && Array.isArray(currentPeriod.rows)
    ? currentPeriod.rows
    : null
  const scopedEmployeeIdentifierCollision = recordsHaveIdentifierCollision(scopedEmployees, employeeIdentifierValues)
  const currentPeriodRowIdentifierCollision = recordsHaveIdentifierCollision(
    immutableSnapshotRows || [],
    (row) => [row.employeeId, row.employeeCode],
  )
  let payrollPreviewError = app.storeSelectionError
    || (currentPeriodCandidates.length > 1
    ? Object.assign(new Error('PAYROLL_PERIOD_IDENTIFIER_COLLISION'), { code: 'PAYROLL_PERIOD_IDENTIFIER_COLLISION' })
    : !immutableSnapshotRows && scopedEmployeeIdentifierCollision
      ? Object.assign(new Error('EMPLOYEE_IDENTIFIER_COLLISION'), { code: 'EMPLOYEE_IDENTIFIER_COLLISION' })
      : currentPeriodRowIdentifierCollision
        ? Object.assign(new Error('PAYROLL_ROW_IDENTIFIER_COLLISION'), { code: 'PAYROLL_ROW_IDENTIFIER_COLLISION' })
        : null)
  const attendanceLinks = immutableSnapshotRows ? [] : scopedAttendance.map((record) => {
    const match = matchEmployee(attendanceEmployeeReference(record))
    if (!attendanceEmployeeReference(record) || match.ambiguous || !match.record) {
      payrollPreviewError ||= Object.assign(new Error('ATTENDANCE_EMPLOYEE_IDENTIFIER_INVALID'), {
        code: match.ambiguous ? 'EMPLOYEE_IDENTIFIER_COLLISION' : 'ATTENDANCE_EMPLOYEE_NOT_FOUND',
      })
    }
    return { record, employee: match.ambiguous ? null : match.record }
  })
  const attendanceByEmployee = new Map()
  attendanceLinks.forEach(({ record, employee }) => {
    if (!employee) return
    const records = attendanceByEmployee.get(employee)
    if (records) records.push(record)
    else attendanceByEmployee.set(employee, [record])
  })
  const inboundSupportEmployees = new Set(attendanceLinks
    .filter(({ record, employee }) => employee
      && !employee.deletedAt
      && !storeReferenceMatches(employee.storeId)
      && attendancePayDetails(record, employee, supportTransfers).kind === 'support')
    .map(({ employee }) => employee))
  const liveParticipants = [
    ...scopedEmployees,
    ...employees.filter((employee) => inboundSupportEmployees.has(employee) && !scopedEmployees.includes(employee)),
  ]
  const liveParticipantSet = new Set(liveParticipants)
  const selectedStoreManagerAttendance = new Set(attendanceLinks
    .filter(({ employee }) => employee
      && isStoreManagerProfile(employee)
      && storeReferenceMatches(employee.storeId))
    .map(({ employee }) => employee))
  if (attendanceLinks.some(({ employee }) => employee
    && !liveParticipantSet.has(employee)
    && !selectedStoreManagerAttendance.has(employee))) {
    payrollPreviewError ||= Object.assign(new Error('ATTENDANCE_EMPLOYEE_OUT_OF_SCOPE'), {
      code: 'ATTENDANCE_EMPLOYEE_OUT_OF_SCOPE',
    })
  }
  if (!immutableSnapshotRows && recordsHaveIdentifierCollision(liveParticipants, employeeIdentifierValues)) {
    payrollPreviewError ||= Object.assign(new Error('EMPLOYEE_IDENTIFIER_COLLISION'), { code: 'EMPLOYEE_IDENTIFIER_COLLISION' })
  }
  const participantRows = immutableSnapshotRows
    ? immutableSnapshotRows.map((snapshotRow) => {
        const reference = payrollRowEmployeeReference(snapshotRow)
        const match = matchEmployee(reference)
        if (!reference || match.ambiguous || !match.record) {
          payrollPreviewError ||= Object.assign(new Error('PAYROLL_ROW_EMPLOYEE_IDENTIFIER_INVALID'), {
            code: match.ambiguous ? 'EMPLOYEE_IDENTIFIER_COLLISION' : 'PAYROLL_ROW_EMPLOYEE_NOT_FOUND',
          })
          return null
        }
        return { employee: match.record, snapshotRow }
      }).filter(Boolean)
    : liveParticipants.map((employee) => ({ employee, snapshotRow: null }))
  const groupEmployeeSources = (sources, isRelevant, referenceOf = entryEmployeeId) => {
    const grouped = new Map()
    if (immutableSnapshotRows || payrollPreviewError) return grouped
    sources.forEach((item) => {
      if (!isRelevant(item)) return
      const reference = referenceOf(item)
      const match = matchEmployee(reference)
      const explicitlyScopedToStore = Boolean(compactIdentifier(item.storeId)) && storeReferenceMatches(item.storeId)
      if (!reference || match.ambiguous || !match.record) {
        if (explicitlyScopedToStore) {
          payrollPreviewError ||= Object.assign(new Error('PAYROLL_SOURCE_EMPLOYEE_IDENTIFIER_INVALID'), {
            code: match.ambiguous ? 'EMPLOYEE_IDENTIFIER_COLLISION' : 'PAYROLL_SOURCE_EMPLOYEE_NOT_FOUND',
          })
        }
        return
      }
      if (!liveParticipantSet.has(match.record)) {
        if (explicitlyScopedToStore) {
          payrollPreviewError ||= Object.assign(new Error('PAYROLL_SOURCE_EMPLOYEE_OUT_OF_SCOPE'), {
            code: 'PAYROLL_SOURCE_EMPLOYEE_OUT_OF_SCOPE',
          })
        }
        return
      }
      const records = grouped.get(match.record)
      if (records) records.push(item)
      else grouped.set(match.record, [item])
    })
    return grouped
  }
  const salaryAdjustmentsByEmployee = groupEmployeeSources(
    salaryAdjustments,
    (item) => item.period === period
      && item.status !== 'Đã hủy'
      && !item.deletedAt
      && (!item.storeId || storeReferenceMatches(item.storeId)),
    (item) => compactIdentifier(item.employeeId || item.employeeCode),
  )
  const compensationEntriesByEmployee = groupEmployeeSources(
    compensationEntries,
    (item) => entryDate(item).startsWith(period),
  )
  const revenueAllocationsByEmployee = groupEmployeeSources(
    revenueBonusAllocations,
    (item) => entryDate(item).startsWith(period)
      && (!item.storeId || storeReferenceMatches(item.storeId)),
  )
  const violationsByEmployee = groupEmployeeSources(
    compensationViolations,
    (item) => entryDate(item).startsWith(period)
      && (!item.storeId || storeReferenceMatches(item.storeId)),
  )
  const salaryAdvancesByEmployee = groupEmployeeSources(
    salaryAdvances,
    (item) => item.period === period
      && item.status === 'Đã chi'
      && (!item.storeId || storeReferenceMatches(item.storeId)),
    (item) => compactIdentifier(item.employeeId || item.employeeCode),
  )
  const previewRows = payrollPreviewError ? [] : participantRows.flatMap(({ employee, snapshotRow }, index) => {
    const records = snapshotRow
      ? []
      : attendanceByEmployee.get(employee) || []
    const supportDetails = snapshotRow
      ? []
      : records.map((record) => attendancePayDetails(record, employee, supportTransfers))
        .filter((pay) => pay.kind === 'support')
    const inboundSupport = !snapshotRow && !storeReferenceMatches(employee.storeId) && supportDetails.length > 0
    const inboundSupportTransferIds = inboundSupport
      ? new Set(supportTransferIdentifiers(supportDetails).map((identifier) => (
          identifier.toLocaleLowerCase('en-US')
        )))
      : null
    const hours = snapshotRow ? Number(snapshotRow.hours || 0) : records.reduce((sum, record) => sum + Number(record.hours || 0), 0)
    let liveSalaryPolicy = null
    if (!snapshotRow && !inboundSupport) {
      try {
        liveSalaryPolicy = resolveStoreEmployeeSalaryPolicy(employee, {
          store,
          salaryConfigs: storeEmployeeSalaryConfigs,
          period,
        })
      } catch (error) {
        if (error?.code !== STORE_SALARY_CONFIG_IDENTIFIER_COLLISION) throw error
        payrollPreviewError ||= error
        return []
      }
    }
    const earnedBase = snapshotRow
      ? Number(snapshotRow.baseSalary ?? snapshotRow.basePayVnd ?? 0)
      : inboundSupport
        ? supportDetails.reduce((sum, pay) => sum + Number(pay.support?.basePay || 0), 0)
        : calculateEmployeeBasePay(employee, {
            hours,
            store,
            salaryConfig: liveSalaryPolicy,
            period,
          })
    const snapshotSalaryPolicy = snapshotRow?.salarySnapshot?.salaryConfigSnapshot
      || snapshotRow?.salarySnapshot?.salaryConfig
      || snapshotRow?.salarySnapshot
    const configuredHourlyRate = snapshotRow
      ? Number(snapshotSalaryPolicy?.standardHourlyRateVnd || snapshotRow.salarySnapshot?.hourlyRate || snapshotRow.hourlyRate || 0)
      : inboundSupport
        ? Number(supportDetails[0]?.support?.hourlyRate || 0)
        : Number(liveSalaryPolicy?.standardHourlyRateVnd || getHourlyRate(employee))
    const hourlyRate = configuredHourlyRate > 0
      ? configuredHourlyRate
      : !snapshotRow && !inboundSupport && Number(employee.requiredMonthlyHours) > 0
        ? Math.floor(getMonthlySalary(employee) / Number(employee.requiredMonthlyHours))
        : 0
    const legacyAdjustmentNet = snapshotRow || inboundSupport ? 0 : (salaryAdjustmentsByEmployee.get(employee) || [])
      .reduce((sum, item) => {
        const amount = Number(item.amount || 0)
        if (!Number.isSafeInteger(amount) || amount < 0) return sum
        return sum + (adjustmentKind(item.bonusSource || item.type) === 'VIOLATION' ? -amount : amount)
      }, 0)
    const liveCompensationEntries = snapshotRow ? [] : (compensationEntriesByEmployee.get(employee) || [])
      .filter((item) => (
        inboundSupport
          ? workEntryMatchesPayrollStore({
              entry: item,
              employee,
              attendanceRecords: attendance,
              transfers: supportTransfers,
              storeReferenceMatches,
              allowedSupportTransferIds: inboundSupportTransferIds,
              matchAttendance,
              matchSupportTransfer,
            })
          : entryType(item) === 'WORK' && (item.attendanceId || item.supportTransferId || item.supportStoreId)
            ? workEntryMatchesPayrollStore({
                entry: item,
                employee,
                attendanceRecords: attendance,
                transfers: supportTransfers,
                storeReferenceMatches,
                matchAttendance,
                matchSupportTransfer,
              })
            : (!item.storeId || storeReferenceMatches(item.storeId))
      ))
    const supportAuditEntries = inboundSupport ? liveCompensationEntries.filter((entry) => (
      supportWorkEntryHasCanonicalAudit({
        entry,
        employee,
        supportDetails,
        storeReferenceMatches,
      })
    )) : []
    const canonical = snapshotRow
      ? { manual: 0, work: 0, allowance: 0, revenue: 0, violations: 0 }
      : payrollCompensationTotalsForEmployee({
          compensationEntries: liveCompensationEntries,
          revenueBonusAllocations: inboundSupport ? [] : revenueAllocationsByEmployee.get(employee) || [],
          violations: inboundSupport ? [] : violationsByEmployee.get(employee) || [],
          employeeId: employeePrimaryIdentifier(employee),
          employeeIdentifiers: employeeIdentifierValues(employee),
          period,
        })
    const revenueBonus = snapshotRow ? Number(snapshotRow.revenueBonusVnd || 0) : canonical.revenue
    const workBonus = snapshotRow ? Number(snapshotRow.workBonusVnd || 0) : canonical.work
    const supportWorkBonus = snapshotRow
      ? Number(snapshotRow.supportWorkBonusVnd || 0)
      : inboundSupport
        ? payrollCompensationTotalsForEmployee({
            compensationEntries: supportAuditEntries,
            employeeId: employeePrimaryIdentifier(employee),
            employeeIdentifiers: employeeIdentifierValues(employee),
            period,
          }).work
        : 0
    const supportTransferIds = snapshotRow
      ? (Array.isArray(snapshotRow.supportTransferIds)
          ? snapshotRow.supportTransferIds
          : snapshotRow.supportCompensation?.transferIds || [])
      : supportTransferIdentifiers(supportDetails)
    const supportOriginStoreId = compactIdentifier(
      snapshotRow?.supportCompensation?.homeStoreId
      || snapshotRow?.supportHomeStoreId
      || supportDetails[0]?.support?.homeStoreId
      || (supportTransferIds.length > 0 ? employee.storeId : ''),
    )
    const supportOriginStoreMatch = supportOriginStoreId
      ? operationalIdentifierRecordMatch(stores, supportOriginStoreId, (item) => [item.id])
      : { record: null, ambiguous: false }
    const supportOriginStoreName = compactIdentifier(
      snapshotRow?.supportCompensation?.homeStoreName
      || snapshotRow?.supportHomeStoreName
      || supportDetails[0]?.support?.homeStoreName
      || (!supportOriginStoreMatch.ambiguous ? supportOriginStoreMatch.record?.name : '')
      || supportOriginStoreId
      || 'Cửa hàng khác',
    )
    const isSupportEmployee = snapshotRow
      ? Boolean(
          snapshotRow.isSupportEmployee
          || snapshotRow.supportCompensation?.isSupportEmployee
          || supportTransferIds.length > 0
          || Number(snapshotRow.supportActualPay || 0) > 0
        )
      : inboundSupport
    const manualBonus = snapshotRow ? Number(snapshotRow.manualBonusVnd || 0) : canonical.manual + Math.max(0, legacyAdjustmentNet)
    const tiktokAllowance = snapshotRow
      ? Number(snapshotRow.salarySnapshot?.tiktokAllowance || 0)
      : inboundSupport ? 0 : Number(employee.tiktokAllowance || 0)
    const totalAllowance = snapshotRow
      ? Number(snapshotRow.allowanceVnd || 0)
      : inboundSupport
        ? supportDetails.reduce((sum, pay) => sum + Number(pay.support?.allowance || 0), 0)
        : tiktokAllowance + canonical.allowance
    const otherAllowance = Math.max(0, totalAllowance - tiktokAllowance)
    const violations = snapshotRow ? Number(snapshotRow.violationVnd || 0) : canonical.violations + Math.max(0, -legacyAdjustmentNet)
    const advances = snapshotRow
      ? Number(snapshotRow.advancesPaid ?? snapshotRow.appliedAdvanceVnd ?? 0)
      : inboundSupport ? 0 : (salaryAdvancesByEmployee.get(employee) || [])
        .reduce((sum, item) => sum + Number(item.amount || 0), 0)
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
    const snapshotReference = payrollRowEmployeeReference(snapshotRow)
    const displayEmployee = snapshotRow ? {
      ...employee,
      id: snapshotReference,
      name: snapshotRow.employeeName || employee.name || snapshotReference,
      employmentType: snapshotRow.salarySnapshot?.employmentType || employee.employmentType,
    } : employee
    return [{
      employee: displayEmployee,
      rowKey: snapshotRow ? `${currentPeriod.id}:${snapshotReference}:${index}` : employeePrimaryIdentifier(employee),
      hours,
      earnedBase,
      hourlyRate,
      revenueBonus,
      workBonus,
      supportWorkBonus,
      supportTransferIds,
      isSupportEmployee,
      supportOriginStoreId,
      supportOriginStoreName,
      manualBonus,
      tiktokAllowance,
      otherAllowance,
      violations,
      advances,
      gross: snapshotRow ? Number(snapshotRow.gross ?? snapshotRow.grossCompensationVnd ?? settlement.grossPay) : settlement.grossPay,
      net: snapshotRow ? Number(snapshotRow.netPayVnd ?? snapshotRow.remaining ?? settlement.availableSalary) : settlement.availableSalary,
    }]
  })
  const rows = payrollPreviewError ? [] : previewRows
  const totals = rows.reduce((value, row) => ({
    gross: value.gross + row.gross,
    bonuses: value.bonuses + row.revenueBonus + row.workBonus + row.manualBonus,
    advances: value.advances + row.advances,
    net: value.net + row.net,
  }), { gross: 0, bonuses: 0, advances: 0, net: 0 })
  const scopedSalaryAdvances = salaryAdvances.filter((item) => (
    storeReferenceMatches(item.storeId) && item.period === period
  ))
  return {
    scopedEmployees,
    currentPeriod,
    payrollPreviewError,
    rows,
    totals,
    scopedSalaryAdvances,
  }
  }, [
    app.storeSelectionError,
    attendance,
    compensationEntries,
    compensationViolations,
    employees,
    payrollPeriods,
    period,
    revenueBonusAllocations,
    salaryAdjustments,
    salaryAdvances,
    store,
    storeEmployeeSalaryConfigs,
    stores,
    supportTransfers,
  ])

  const selectedAdvanceAvailability = useMemo(() => (
    modal === 'advance' && form.employeeId
      ? salaryAvailabilityForEmployee({ employees, employeeReference: form.employeeId, getAvailableSalary, period })
      : { ok: true, available: 0, message: '' }
  ), [employees, form.employeeId, getAvailableSalary, modal, period])
  const pendingAdvanceAvailabilityById = useMemo(() => Object.fromEntries(scopedSalaryAdvances
    .filter((item) => item.status === 'Mới tạo')
    .map((item) => [String(item.id), salaryAvailabilityForEmployee({
      employees,
      employeeReference: item.employeeId || item.employeeCode,
      getAvailableSalary,
      period,
    })])), [employees, getAvailableSalary, period, scopedSalaryAdvances])
  const advanceOperationError = payrollPreviewError
    ? 'Không thể thao tác ứng lương khi dữ liệu kỳ lương, hồ sơ nhân viên hoặc cấu hình lương đang bị trùng.'
    : selectedAdvanceAvailability.message
  const adjustmentAmount = parseMoney(form.amount)
  const adjustmentNote = String(form.note || '').trim()
  const adjustmentTypeValid = modal === 'advance' || ['Thưởng khác', 'Phụ cấp khác', 'Khấu trừ'].includes(form.type)
  const adjustmentFormError = !form.employeeId
    ? 'Cửa hàng chưa có nhân viên hợp lệ để thực hiện thao tác này.'
    : !adjustmentTypeValid
      ? 'Vui lòng chọn loại khoản lương thưởng.'
      : adjustmentAmount <= 0
      ? 'Số tiền phải lớn hơn 0 đ.'
      : modal === 'advance' && selectedAdvanceAvailability.ok && adjustmentAmount >= selectedAdvanceAvailability.available
        ? `Số tiền ứng phải nhỏ hơn lương khả dụng ${money(selectedAdvanceAvailability.available)}.`
        : modal === 'advance' && advanceOperationError
          ? advanceOperationError
          : modal !== 'advance' && payrollPreviewError
            ? 'Không thể tạo khoản lương thưởng khi dữ liệu kỳ lương chưa được đối chiếu duy nhất.'
            : !adjustmentNote
              ? 'Vui lòng nhập ghi chú.'
              : adjustmentNote.length > 1_000
                ? 'Ghi chú không được vượt quá 1.000 ký tự.'
                : ''
  const payrollActionUnavailable = Boolean(payrollPreviewError) || !scopedEmployees.length
  const payrollActionDate = payrollPeriodActionDate(period)
  const payrollPeriodActionable = isPayrollPeriodActionable(period, today())
  const payrollIsClosed = currentPeriod?.status === 'Đã chốt' && !currentPeriod?.needsReclose
  const payrollIsPaid = currentPeriod?.status === 'Đã chi' && Boolean(currentPeriod?.confirmedAt)
  const payrollIsLocked = currentPeriod?.status === 'Đã khóa' || Boolean(currentPeriod?.lockedAt)
  const closePayrollDisabled = Boolean(payrollPreviewError)
    || !payrollPeriodActionable
    || payrollIsLocked
    || payrollIsPaid
    || payrollIsClosed
  const confirmPayrollDisabled = Boolean(payrollPreviewError)
    || !payrollPeriodActionable
    || !currentPeriod
    || !payrollIsClosed
    || Boolean(currentPeriod?.needsReclose)
  const lockPayrollDisabled = Boolean(payrollPreviewError)
    || !payrollPeriodActionable
    || !currentPeriod
    || !payrollIsPaid
    || payrollIsLocked

  const openAdjustment = (type) => {
    if (!canOperatePayroll) return
    if (payrollActionUnavailable) {
      notify(payrollPreviewError
        ? 'Cần xử lý dữ liệu kỳ lương trước khi tạo khoản lương thưởng.'
        : 'Cửa hàng chưa có nhân viên hợp lệ.', 'info')
      return
    }
    setModal(type === 'Ứng lương' ? 'advance' : 'adjustment')
    setForm({
      employeeId: employeePrimaryIdentifier(scopedEmployees[0]),
      type,
      amount: '',
      note: '',
      idempotencyKey: `store-payroll:${crypto.randomUUID()}`,
    })
  }
  const closeAdjustment = () => {
    if (savingAdjustment) return
    setModal(null)
  }
  const handleSaveAdjustment = async () => {
    if (!canOperatePayroll || savingAdjustment) return
    if (adjustmentFormError) {
      notify(adjustmentFormError, 'info')
      return
    }
    setSavingAdjustment(true)
    try {
      const payload = { ...form, storeId, period, amount: adjustmentAmount, note: adjustmentNote }
      const result = modal === 'advance' ? await createSalaryAdvance(payload) : await addSalaryAdjustment(payload)
      if (!result?.ok) {
        notify(result?.message || 'Không thể tạo khoản lương thưởng.', 'info')
        return
      }
      setModal(null)
    } catch (error) {
      notify(error?.message || 'Không thể tạo khoản lương thưởng.', 'info')
    } finally {
      setSavingAdjustment(false)
    }
  }
  const handleConfirmAdvance = async (advanceId) => {
    if (!canOperatePayroll) return
    const result = await confirmSalaryAdvance(advanceId)
    if (!result.ok) notify(result.message, 'info')
  }
  const requestPayrollAction = (action) => {
    if (processingPayrollAction) return
    if (action === 'close' && (!canOperatePayroll || closePayrollDisabled)) return
    if (action === 'pay' && (!canOperatePayroll || confirmPayrollDisabled)) return
    if (action === 'lock' && (!canLockPayroll || lockPayrollDisabled)) return
    setPayrollConfirmation(action)
  }
  const handlePayrollAction = async () => {
    if (!payrollConfirmation || processingPayrollAction) return
    const action = payrollConfirmation
    if (action === 'close' && (!canOperatePayroll || closePayrollDisabled)) return
    if (action === 'pay' && (!canOperatePayroll || confirmPayrollDisabled)) return
    if (action === 'lock' && (!canLockPayroll || lockPayrollDisabled)) return
    setProcessingPayrollAction(true)
    try {
      const result = action === 'close'
        ? await closePayrollPeriod(storeId, period)
        : action === 'pay'
          ? await confirmPayrollPayment(storeId, period)
          : await lockPayrollPeriod(storeId, period)
      if (!result?.ok) {
        notify(result?.message || 'Không thể xử lý kỳ lương.', 'info')
        return
      }
      setPayrollConfirmation(null)
    } catch (error) {
      notify(error?.message || 'Không thể xử lý kỳ lương.', 'info')
    } finally {
      setProcessingPayrollAction(false)
    }
  }
  const payrollConfirmationDetails = payrollConfirmation === 'close'
    ? {
        title: currentPeriod?.needsReclose ? 'Xác nhận chốt lại sổ' : 'Xác nhận chốt sổ',
        message: `Chốt số liệu lương thưởng kỳ ${period} của ${store?.name || storeId}? Sau khi chốt mới có thể xác nhận chi lương.`,
        label: currentPeriod?.needsReclose ? 'CHỐT LẠI SỔ' : 'CHỐT SỔ',
        variant: 'primary',
        icon: FileText,
      }
    : payrollConfirmation === 'pay'
      ? {
          title: 'Xác nhận chi lương',
          message: `Xác nhận đã chi lương kỳ ${period} của ${store?.name || storeId}? Thao tác này tạo các bút toán chi lương và không thể thực hiện lần hai.`,
          label: 'XÁC NHẬN CHI LƯƠNG',
          variant: 'primary',
          icon: Banknote,
        }
      : {
          title: 'Xác nhận khóa kỳ lương thưởng',
          message: `Khóa kỳ lương ${period} của ${store?.name || storeId}? Sau khi khóa, dữ liệu của kỳ này không thể chỉnh sửa.`,
          label: 'KHÓA KỲ CHI LƯƠNG THƯỞNG',
          variant: 'danger',
          icon: ShieldCheck,
        }

  return (
    <div className="page">
      <PageHeader
        title="LƯƠNG THƯỞNG NHÂN VIÊN"
        subtitle={`Kỳ ${period} — ${store?.name || ''}. Thu nhập gồm lương, ba nguồn thưởng, phụ cấp và vi phạm đã ghi nhận.`}
        icon={Banknote}
        actions={<><Input type="month" value={period} onChange={(event) => setPayrollPeriod(event.target.value)} />{canOperatePayroll && <><Button icon={Gift} disabled={payrollActionUnavailable} onClick={() => openAdjustment('Thưởng khác')}>TẠO THƯỞNG</Button><Button icon={Plus} disabled={payrollActionUnavailable} onClick={() => openAdjustment('Phụ cấp khác')}>TẠO PHỤ CẤP</Button><Button variant="outline" icon={Wallet} disabled={payrollActionUnavailable} onClick={() => openAdjustment('Ứng lương')}>TẠO ỨNG LƯƠNG</Button></>}</>}
      />
      {!canOperatePayroll && <InfoNote>Chế độ rà soát. Quản lý cửa hàng chỉ xem số liệu cửa hàng mình; Admin hoặc Nhân viên hỗ trợ KD thực hiện chốt và chi kỳ lương.</InfoNote>}
      {payrollPreviewError && <InfoNote tone="red">Không thể tính lương kỳ này vì cửa hàng, kỳ lương, hồ sơ nhân viên có mã trùng hoặc cấu hình lương không thể đối chiếu duy nhất. Toàn bộ số tổng đã được khóa để tránh hiển thị thiếu; Admin cần xử lý dữ liệu trước khi xem trước hoặc chốt lương.</InfoNote>}
      <div className="metrics-grid metrics-grid--4">
        <MetricCard label="TỔNG THU NHẬP" value={payrollPreviewError ? '—' : money(totals.gross)} icon={TrendingUp} tone="green" />
        <MetricCard label="TỔNG THƯỞNG" value={payrollPreviewError ? '—' : money(totals.bonuses)} helper="Doanh thu • Công việc • Thủ công" icon={Gift} tone="blue" />
        <MetricCard label="ĐÃ ỨNG" value={payrollPreviewError ? '—' : money(totals.advances)} icon={Wallet} tone="orange" />
        <MetricCard label="CÒN PHẢI CHI" value={payrollPreviewError ? '—' : money(totals.net)} icon={Banknote} tone="green" />
      </div>
      <Card title="Chi tiết lương thưởng">
        <TableWrap><thead><tr><th>Nhân viên</th><th>Giờ làm</th><th>Lương cứng</th><th>Thưởng doanh thu</th><th>Thưởng công việc</th><th>Thưởng thủ công</th><th>Phụ cấp TikTok</th><th>Phụ cấp khác</th><th>Vi phạm</th><th>Đã ứng</th><th>Thực nhận</th></tr></thead><tbody>
          {rows.map((row) => <tr key={row.rowKey}><td><strong>{row.employee.name}</strong>{row.isSupportEmployee && <small className="table-note"><Badge tone="orange">Nhân viên hỗ trợ • {row.supportOriginStoreName || row.supportOriginStoreId || 'Cửa hàng khác'}</Badge></small>}<small className="table-note">{row.employee.id} • {row.employee.employmentType}</small></td><td>{row.hours.toFixed(2)}</td><td><strong className="payroll-hourly-rate">{money(row.hourlyRate)}/giờ</strong></td><td>{money(row.revenueBonus)}</td><td>{money(row.workBonus)}{row.supportWorkBonus > 0 && <small className="table-note">Thưởng hỗ trợ ghi nhận tại {store?.name || storeId}{row.supportTransferIds.length ? ` • ${row.supportTransferIds.join(', ')}` : ''}</small>}</td><td>{money(row.manualBonus)}</td><td>{money(row.tiktokAllowance)}</td><td>{money(row.otherAllowance)}</td><td>{money(row.violations)}</td><td>{money(row.advances)}</td><td><strong>{money(row.net)}</strong></td></tr>)}
          {payrollPreviewError
            ? <tr><td colSpan="11">Số liệu đang được khóa cho đến khi Admin xử lý dữ liệu trùng.</td></tr>
            : <tr className="total-row"><td colSpan="10">TỔNG CÒN PHẢI CHI</td><td>{money(totals.net)}</td></tr>}
        </tbody></TableWrap>
      </Card>
      <Card title="Lịch sử ứng lương của nhân viên" action={canOperatePayroll ? <Button icon={Plus} disabled={payrollActionUnavailable} onClick={() => openAdjustment('Ứng lương')}>TẠO ỨNG LƯƠNG</Button> : null}>
        <TableWrap><thead><tr><th>Thời gian</th><th>Nhân viên</th><th>Số tiền ứng</th><th>Lương khả dụng lúc tạo</th><th>Còn lại</th><th>Người tạo</th><th>Ghi chú</th><th>Trạng thái</th>{canOperatePayroll && <th>Hành động</th>}</tr></thead><tbody>
          {scopedSalaryAdvances.map((item) => {
            const availability = item.status === 'Mới tạo'
              ? pendingAdvanceAvailabilityById[String(item.id)] || { ok: false, message: 'Không thể tính lương khả dụng của nhân viên.' }
              : { ok: true }
            return <tr key={item.id}><td>{timestamp(item.createdAt)}</td><td><strong>{item.employeeName}</strong><small className="table-note">{item.employeeId}</small></td><td>{money(item.amount)}</td><td>{money(item.availableAtCreation)}</td><td>{money(item.remainingAfter)}</td><td>{item.createdBy?.name}</td><td>{item.note || '—'}</td><td><Badge tone={item.status === 'Đã chi' ? 'green' : 'orange'}>{item.status}</Badge></td>{canOperatePayroll && <td>{item.status === 'Mới tạo' ? <Button icon={CheckCircle2} disabled={!availability.ok || Boolean(payrollPreviewError)} title={!availability.ok ? availability.message : undefined} onClick={() => handleConfirmAdvance(item.id)}>XÁC NHẬN CHI</Button> : <span>{timestamp(item.confirmedAt)}</span>}</td>}</tr>
          })}
          {!scopedSalaryAdvances.length && <tr><td colSpan={canOperatePayroll ? 9 : 8}>Chưa có khoản ứng lương.</td></tr>}
        </tbody></TableWrap>
      </Card>
      <Card title="Xử lý cuối kỳ" action={<Badge tone={currentPeriod?.status === 'Đã khóa' ? 'red' : currentPeriod?.confirmedAt ? 'green' : 'orange'}>{currentPeriod?.needsReclose ? 'Cần chốt lại' : currentPeriod?.status || 'Chưa chốt'}</Badge>}>
        {canOperatePayroll ? <><div className="period-actions"><Button variant="outline" icon={FileText} onClick={() => requestPayrollAction('close')} disabled={closePayrollDisabled}>{currentPeriod?.needsReclose ? 'CHỐT LẠI SỔ' : 'CHỐT SỔ'}</Button><Button icon={Banknote} onClick={() => requestPayrollAction('pay')} disabled={confirmPayrollDisabled}>XÁC NHẬN CHI LƯƠNG</Button>{canLockPayroll && <Button variant="danger" icon={ShieldCheck} onClick={() => requestPayrollAction('lock')} disabled={lockPayrollDisabled}>KHÓA KỲ CHI LƯƠNG THƯỞNG</Button>}</div>{!payrollPeriodActionable && payrollActionDate && <InfoNote tone="orange">Kỳ {period} chỉ được chốt và chi từ ngày <strong>{shortDate(payrollActionDate)}</strong>. Các nút sẽ tự mở theo đúng thứ tự sau khi kỳ kết thúc.</InfoNote>}</> : <InfoNote>Trạng thái kỳ lương chỉ được xem.</InfoNote>}
      </Card>
      {canOperatePayroll && <Modal open={Boolean(payrollConfirmation)} onClose={() => !processingPayrollAction && setPayrollConfirmation(null)} title={payrollConfirmationDetails.title} footer={<><Button variant="outline" disabled={processingPayrollAction} onClick={() => setPayrollConfirmation(null)}>Hủy</Button><Button variant={payrollConfirmationDetails.variant} icon={payrollConfirmationDetails.icon} loading={processingPayrollAction} disabled={processingPayrollAction} onClick={handlePayrollAction}>{payrollConfirmationDetails.label}</Button></>}><InfoNote tone={payrollConfirmation === 'lock' ? 'orange' : 'green'}>{payrollConfirmationDetails.message}</InfoNote></Modal>}
      {canOperatePayroll && <Modal open={Boolean(modal)} onClose={closeAdjustment} title={modal === 'advance' ? 'Tạo ứng lương' : `Tạo ${form.type.toLowerCase()}`} footer={<><Button variant="outline" disabled={savingAdjustment} onClick={closeAdjustment}>Hủy</Button><Button icon={Save} loading={savingAdjustment} disabled={savingAdjustment || Boolean(adjustmentFormError)} onClick={handleSaveAdjustment}>TẠO</Button></>}><div className="form-grid"><Field label="Nhân viên" required><Select value={form.employeeId} required disabled={savingAdjustment} onChange={(event) => setForm({ ...form, employeeId: event.target.value })}>{scopedEmployees.map((employee) => <option key={employeePrimaryIdentifier(employee)} value={employeePrimaryIdentifier(employee)}>{employee.name} — {employeePrimaryIdentifier(employee)}</option>)}</Select></Field>{modal !== 'advance' && <Field label="Loại" required><Select value={form.type} required disabled={savingAdjustment} onChange={(event) => setForm({ ...form, type: event.target.value })}><option>Thưởng khác</option><option>Phụ cấp khác</option><option>Khấu trừ</option></Select></Field>}<Field label="Số tiền" required><MoneyInput value={form.amount} required disabled={savingAdjustment} onChange={(event) => setForm({ ...form, amount: event.target.value })} placeholder="Nhập số tiền" /></Field>{modal === 'advance' && (advanceOperationError ? <InfoNote tone="red">{advanceOperationError}</InfoNote> : <InfoNote>Lương khả dụng hiện tại: <strong>{money(selectedAdvanceAvailability.available)}</strong>. Khoản ứng phải nhỏ hơn mức này.</InfoNote>)}{form.amount && adjustmentFormError && <InfoNote tone="red">{adjustmentFormError}</InfoNote>}<Field label="Ghi chú" required className="span-2"><Input value={form.note} required maxLength={1_000} disabled={savingAdjustment} onChange={(event) => setForm({ ...form, note: event.target.value })} /></Field></div></Modal>}
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
