import { memo, useEffect, useMemo, useState } from 'react'
import { CircleDollarSign, Clock3, Pencil, RotateCcw, Store, Trash2, WalletCards } from 'lucide-react'
import { useApp } from '../../state/AppContext'
import {
  Badge,
  Button,
  Card,
  Field,
  InfoNote,
  Input,
  MetricCard,
  Modal,
  MoneyInput,
  PageHeader,
  Select,
  TableWrap,
} from '../../components/UI'
import { businessDate as toBusinessDate, money, operationalIdentifierRecordMatch } from '../../utils'
import { SupportEmployeeTag } from '../../components/SupportEmployeeTag'
import { resolveSupportEmployeeTagContext } from '../../domain/supportEmployeeTag'
import {
  canonicalRole,
  entityId,
  entryEmployeeId,
  entryStoreId,
  revenueAllocations,
  revenueRecordDate,
  revenueRecordTotal,
  sameOperationalIdentifier,
  statusLabel,
  statusTone,
  storesVisibleToRole,
} from './compensationViewModel'
import {
  REVENUE_BONUS_PROGRAM_IDS,
  REVENUE_BONUS_PROGRAMS,
  TEAM_MILESTONE_PROGRAM_IDS,
  selectRevenueBonusTier,
} from '../../domain/compensationPolicies'
import {
  AUTOMATIC_REVENUE_BONUS_EFFECTIVE_DATE,
  calculateAutomaticRevenueBonusDay,
  calculateAutomaticRevenueBonusPeriod,
} from '../../domain/automaticRevenueBonus'
import { classifyStorePayrollPolicy, STORE_PAYROLL_POLICY } from '../../domain/storeTieredPayroll'
import { apiGetRevenueBonusLive, apiGetRevenueBonusPeriod } from '../../services/idosiApi'
import { revenueBonusHistoryProjection, revenueBonusStatistics } from './compensationStatistics'
import {
  AccessDenied,
  ActionError,
  displayDate,
  employeeName,
  storeName,
  useCompensationAction,
  vietnamToday,
} from './compensationUi'
import './compensation-page.css'

const allocationAmount = (allocation) => Number(
  allocation?.allocatedVnd ?? allocation?.amountVnd ?? allocation?.amount ?? allocation?.bonusVnd ?? 0,
) || 0

const recordRevenue = (record) => Number(record?.revenueVnd ?? record?.dailyRevenueVnd ?? record?.revenue ?? 0) || 0

const recordBusinessDate = (record = {}) => toBusinessDate(
  record.workDate || record.attendanceDate || record.date || record.effectiveDate
  || record.occurredOn || record.occurredAt || record.createdAt || '',
)

const liveWorkedSeconds = (record, nowMs, projectOpen = true) => {
  const storedSource = record?.approvedSalesSeconds
    ?? record?.workedSeconds
    ?? (record?.hours == null ? 0 : Number(record.hours) * 3_600)
  const parsedStoredSeconds = Number(storedSource)
  const storedSeconds = Number.isFinite(parsedStoredSeconds) && parsedStoredSeconds >= 0 ? parsedStoredSeconds : 0
  if (record?.checkOutAt || record?.checkOut) return Math.max(0, Math.trunc(storedSeconds))
  if (!projectOpen) return Math.max(0, Math.trunc(storedSeconds))
  const checkInMs = Date.parse(record?.checkInAt || '')
  if (!Number.isFinite(checkInMs) || nowMs <= checkInMs) return Math.max(0, Math.trunc(storedSeconds))
  return Math.max(Math.trunc(storedSeconds), Math.min(Math.floor((nowMs - checkInMs) / 1_000), 24 * 60 * 60))
}

const liveWorkedHours = (record, nowMs, projectOpen = true) => liveWorkedSeconds(record, nowMs, projectOpen) / 3_600

const identifierKey = (value) => String(value || '').trim().toLocaleLowerCase('en-US')

const resolvedEntityId = (records, reference, identifiers = (record) => [entityId(record)]) => (
  entityId(operationalIdentifierRecordMatch(records, reference, identifiers).record)
)

const effectiveDailyRecord = (record = {}) => !record.deletedAt
  && !record.voidedAt
  && !record.supersededAt
  && !['VOID', 'VOIDED', 'SUPERSEDED', 'CANCELLED'].includes(String(record.status || '').trim().toUpperCase())

const buildLocalLiveSnapshot = ({ app, storeId, selectedDate, programId, milestoneProgramId, nowMs }) => (
  calculateAutomaticRevenueBonusDay({
    storeId,
    businessDate: selectedDate,
    programId,
    milestoneProgramId,
    orders: Array.isArray(app.orders) ? app.orders : [],
    attendance: Array.isArray(app.attendance) ? app.attendance : [],
    employees: Array.isArray(app.employees) ? app.employees : [],
    supportTransfers: Array.isArray(app.supportTransfers) ? app.supportTransfers : [],
    overrides: Array.isArray(app.revenueBonusOverrides) ? app.revenueBonusOverrides : [],
    nowMs,
  })
)

const revenueStatusLabel = (record = {}) => {
  const status = String(record.status || '').trim().toUpperCase()
  if (status === 'LIVE') return 'Tự động trực tiếp'
  if (status === 'ADMIN_ADJUSTED') return 'Admin đã chỉnh sửa'
  if (status === 'ADMIN_DELETED') return 'Admin đã xóa'
  if (status === 'SUPPORT_EXCLUDED') return 'Hỗ trợ cửa hàng – không nhận thưởng'
  return statusLabel(record)
}

const revenueStatusTone = (record = {}) => {
  const status = String(record.status || '').trim().toUpperCase()
  if (status === 'LIVE') return 'blue'
  if (status === 'ADMIN_ADJUSTED') return 'orange'
  if (status === 'ADMIN_DELETED') return 'red'
  if (status === 'SUPPORT_EXCLUDED') return 'orange'
  return statusTone(record)
}

const formatWorkedHours = (hours) => {
  const normalized = Math.max(0, Number(hours) || 0)
  const wholeHours = Math.floor(normalized)
  const minutes = Math.round((normalized - wholeHours) * 60)
  if (minutes === 60) return `${wholeHours + 1} giờ 00 phút`
  return `${wholeHours} giờ ${String(minutes).padStart(2, '0')} phút`
}

const revenueTierLabel = (tier) => {
  const minimum = tier.minimumInclusive ? '≥' : '>'
  if (tier.maximumRevenueVnd == null) return `${minimum} ${tier.minimumRevenueVnd.toLocaleString('vi-VN')} đ`
  const maximum = tier.maximumInclusive ? '≤' : '<'
  return `${minimum} ${tier.minimumRevenueVnd.toLocaleString('vi-VN')} – ${maximum} ${tier.maximumRevenueVnd.toLocaleString('vi-VN')} đ`
}

const displayMonth = (month) => {
  const match = String(month || '').match(/^(\d{4})-(\d{2})$/u)
  return match ? `Tháng ${match[2]}/${match[1]}` : 'Tháng chưa xác định'
}

function RevenueStatisticsTable({ title, rows, firstColumn = 'Thời gian' }) {
  return <div>
    <h3>{title}</h3>
    <TableWrap className="compensation-table">
      <thead><tr><th>{firstColumn}</th><th>Số lần</th><th>Tổng thưởng</th></tr></thead>
      <tbody>{rows.map((row) => <tr key={row.key}>
        <td><strong>{row.label}</strong></td>
        <td>{row.count}</td>
        <td><strong>{money(row.amountVnd)}</strong></td>
      </tr>)}{!rows.length && <tr><td colSpan="3" className="compensation-empty">Chưa có dữ liệu.</td></tr>}</tbody>
    </TableWrap>
  </div>
}

const RevenueHistorySections = memo(function RevenueHistorySections({
  currentEmployeeName,
  collisions,
  employeeCollisions,
  employeeOptions,
  employees,
  filteredRows,
  filteredTotal,
  historyDate,
  historyEmployeeId,
  historyMonth,
  privateView,
  rows,
  setHistoryDate,
  setHistoryEmployeeId,
  setHistoryMonth,
  statistics,
  stores,
  supportTransfers,
}) {
  return <>
    <Card title="Lịch sử ghi nhận thưởng doanh thu" action={<Badge tone="blue">Tổng thưởng: {money(filteredTotal)}</Badge>}>
      {(collisions.length > 0 || employeeCollisions.length > 0) && <InfoNote tone="red">
        Dữ liệu có {collisions.length} ngày trùng kết quả và {employeeCollisions.length} nhóm mã nhân viên mơ hồ. Hệ thống đã loại các dòng này khỏi lịch sử và thống kê để không cộng nhầm tiền; Admin cần xử lý dữ liệu.
      </InfoNote>}
      <div className="compensation-form-grid reward-history-filters">
        <Field label="Ngày ghi nhận">
          <Input aria-label="Ngày ghi nhận thưởng doanh thu" type="date" value={historyDate} onChange={(event) => {
            const date = event.target.value
            setHistoryDate(date)
            if (date) setHistoryMonth(date.slice(0, 7))
          }} />
        </Field>
        <Field label="Tháng ghi nhận">
          <Input aria-label="Tháng ghi nhận thưởng doanh thu" type="month" value={historyMonth} onChange={(event) => {
            const month = event.target.value
            setHistoryMonth(month)
            if (historyDate && !historyDate.startsWith(month)) setHistoryDate('')
          }} />
        </Field>
        {!privateView ? <Field label="Nhân viên">
          <Select aria-label="Nhân viên nhận thưởng doanh thu" value={historyEmployeeId} onChange={(event) => setHistoryEmployeeId(event.target.value)}>
            <option value="">Tất cả nhân viên</option>
            {employeeOptions.map((employee) => <option key={employee.id} value={employee.id}>{employee.name}</option>)}
          </Select>
        </Field> : <div className="compensation-fixed-scope" role="group" aria-label="Nhân viên hiện tại"><span>Nhân viên</span><strong>{currentEmployeeName}</strong></div>}
      </div>
      <TableWrap className="compensation-table">
        <thead><tr><th>Ngày</th><th>Nhân viên</th><th>Cửa hàng</th><th>Thời gian làm thực tế</th><th>Tỷ trọng</th><th>Tiền thưởng</th><th>Trạng thái</th></tr></thead>
        <tbody>{filteredRows.map((row) => <tr key={row.id}>
          <td>{displayDate(row.businessDate)}</td>
          <td><strong>{row.employeeName}</strong><SupportEmployeeTag context={resolveSupportEmployeeTagContext({ record: row, employeeId: row.employeeId, storeId: row.storeId, businessDate: row.businessDate, employees, stores, supportTransfers })} className="compensation-subline" /><small className="compensation-subline">{row.employeeId}</small></td>
          <td>{storeName(stores, row.storeId, row.storeName)}</td>
          <td>{Number(row.approvedSalesHours || 0).toFixed(2)} giờ</td>
          <td>{row.weightPercent == null ? '—' : `${Number(row.weightPercent).toFixed(2)}%`}</td>
          <td><strong>{money(row.amountVnd)}</strong></td>
          <td><Badge tone={revenueStatusTone(row)}>{revenueStatusLabel(row)}</Badge></td>
        </tr>)}{!filteredRows.length && <tr><td colSpan="7" className="compensation-empty">Không có lịch sử phù hợp bộ lọc.</td></tr>}</tbody>
      </TableWrap>
    </Card>
    <Card title="Thống kê thưởng doanh thu" action={<Badge tone="green">{rows.length} lượt ghi nhận</Badge>}>
      <div className="compensation-summary-strip">
        <span>Tổng thưởng doanh thu {displayMonth(statistics.requestedMonth).toLocaleLowerCase('vi-VN')}</span>
        <strong>{money(statistics.monthlyTotalVnd)}</strong>
      </div>
      <div className="compensation-statistics-grid">
        <RevenueStatisticsTable title="Theo ngày" rows={statistics.byDay} />
        <RevenueStatisticsTable title="Theo nhân viên" rows={statistics.byEmployee} firstColumn="Nhân viên" />
        <RevenueStatisticsTable title="Theo tháng" rows={statistics.byMonth} />
      </div>
    </Card>
  </>
})

export function RevenueBonusPage({ storeScoped = false }) {
  const app = useApp()
  const role = canonicalRole(app.session?.role)
  const isAdmin = role === 'admin'
  const currentEmployeeId = String(entityId(app.currentEmployee) || app.session?.employeeId || '')
  const currentStoreId = String(app.session?.storeId || app.currentEmployee?.storeId || '')
  const privileged = ['admin', 'business_support'].includes(role)
  const storeManager = role === 'store_manager'
  const employeeView = ['employee', 'office'].includes(role)
  const privateAllocationView = employeeView
  const allowed = privileged || storeManager || employeeView
  const stores = useMemo(() => storesVisibleToRole(
    app.stores,
    privileged ? app.session : { ...app.session, storeId: currentStoreId },
  ), [app.stores, app.session, privileged, currentStoreId])
  const [storeSelection, setStoreSelection] = useState('')
  const [businessDate, setBusinessDate] = useState(vietnamToday)
  const [historyDate, setHistoryDate] = useState('')
  const [historyMonth, setHistoryMonth] = useState(() => vietnamToday().slice(0, 7))
  const [historyEmployeeId, setHistoryEmployeeId] = useState('')
  const [remoteLiveSnapshot, setRemoteLiveSnapshot] = useState(null)
  const [remotePollError, setRemotePollError] = useState(null)
  const [remoteLastSuccess, setRemoteLastSuccess] = useState(null)
  const [remoteRefreshVersion, setRemoteRefreshVersion] = useState(0)
  const [remoteHistoryPeriod, setRemoteHistoryPeriod] = useState(null)
  const [remoteHistoryError, setRemoteHistoryError] = useState(null)
  const [nowMs, setNowMs] = useState(() => Date.now())
  const [adminAction, setAdminAction] = useState(null)
  const [adminAmount, setAdminAmount] = useState('')
  const [adminReason, setAdminReason] = useState('')
  const serverBacked = ['connected', 'syncing'].includes(app.apiStatus)
  const activeOperationalStoreId = resolvedEntityId(stores, app.activeStoreId)
  const selectedGlobalStoreId = resolvedEntityId(stores, storeSelection)
    || activeOperationalStoreId
    || entityId(stores[0])
  const scopedStoreReference = privileged
    ? String(app.activeStoreId || '')
    : String(currentStoreId || app.activeStoreId || '')
  const selectedScopedStoreId = resolvedEntityId(stores, scopedStoreReference)
  const selectedStoreId = String((storeScoped ? selectedScopedStoreId : selectedGlobalStoreId) || '')
  const selectedStore = operationalIdentifierRecordMatch(
    stores,
    selectedStoreId,
    (store) => [entityId(store)],
  ).record
  const selectedStorePolicy = classifyStorePayrollPolicy(selectedStore)
  const revenueProgram = selectedStorePolicy === STORE_PAYROLL_POLICY.SM_TNV
    ? REVENUE_BONUS_PROGRAMS[REVENUE_BONUS_PROGRAM_IDS.SM_DAILY]
    : selectedStorePolicy === STORE_PAYROLL_POLICY.DOSII
      ? REVENUE_BONUS_PROGRAMS[REVENUE_BONUS_PROGRAM_IDS.DOSII_DAILY]
      : null
  const milestoneProgramId = selectedStorePolicy === STORE_PAYROLL_POLICY.SM_TNV
    ? TEAM_MILESTONE_PROGRAM_IDS.SM_DAILY_REVENUE
    : TEAM_MILESTONE_PROGRAM_IDS.DOSII_DAILY_REVENUE
  const automaticMode = businessDate >= AUTOMATIC_REVENUE_BONUS_EFFECTIVE_DATE
  const shouldTickLocalClock = !serverBacked && automaticMode && businessDate === vietnamToday()
  useEffect(() => {
    if (!shouldTickLocalClock) return undefined
    const timer = window.setInterval(() => setNowMs(Date.now()), 5_000)
    return () => window.clearInterval(timer)
  }, [shouldTickLocalClock])
  const { busyKey, error, setError, run } = useCompensationAction(app)

  const legacyDailyRecords = useMemo(() => {
    const source = Array.isArray(app.revenueBonusDaily)
      ? app.revenueBonusDaily
      : (app.revenueBonuses || [])
    return source.filter((record) => (
      revenueRecordDate(record) < AUTOMATIC_REVENUE_BONUS_EFFECTIVE_DATE
    ))
  }, [app.revenueBonusDaily, app.revenueBonuses])
  const scopedLegacyRecords = legacyDailyRecords
    .filter((record) => sameOperationalIdentifier(entryStoreId(record), selectedStoreId)
      && revenueRecordDate(record) === businessDate)
    .filter(effectiveDailyRecord)
  const selectedDayCollision = scopedLegacyRecords.length > 1
  const records = selectedDayCollision ? [] : scopedLegacyRecords
  const savedAllocations = revenueAllocations(records)
    .filter((allocation) => sameOperationalIdentifier(entryStoreId(allocation), selectedStoreId)
      && revenueRecordDate(allocation) === businessDate)
    .filter((allocation) => !privateAllocationView
      || sameOperationalIdentifier(entryEmployeeId(allocation), currentEmployeeId))
  const savedPoolTotal = records.reduce((sum, record) => sum + revenueRecordTotal(record), 0)
  const savedRevenueTotal = records.reduce((sum, record) => sum + recordRevenue(record), 0)
  const savedAllocationTotal = savedAllocations.reduce((sum, allocation) => sum + allocationAmount(allocation), 0)
  const savedUnallocatedTotal = records.reduce((sum, record) => sum + Number(record?.unallocatedVnd || 0), 0)

  const localLiveSnapshot = useMemo(() => (
    automaticMode && !serverBacked && revenueProgram && selectedStoreId
      ? buildLocalLiveSnapshot({
          app: {
            orders: app.orders,
            attendance: app.attendance,
            employees: app.employees,
            supportTransfers: app.supportTransfers,
            revenueBonusOverrides: app.revenueBonusOverrides,
          },
          storeId: selectedStoreId,
          selectedDate: businessDate,
          programId: revenueProgram.id,
          milestoneProgramId,
          nowMs,
        })
      : null
  ), [
    app.attendance,
    app.employees,
    app.orders,
    app.revenueBonusOverrides,
    app.supportTransfers,
    automaticMode,
    businessDate,
    milestoneProgramId,
    nowMs,
    revenueProgram,
    selectedStoreId,
    serverBacked,
  ])

  useEffect(() => {
    if (!selectedStoreId || !serverBacked || !automaticMode) return undefined
    let active = true
    let busy = false
    const scope = `${identifierKey(selectedStoreId)}:${businessDate}`
    const refresh = async () => {
      if (busy || (typeof document !== 'undefined' && document.hidden)) return
      busy = true
      try {
        const response = await apiGetRevenueBonusLive({ storeId: selectedStoreId, businessDate })
        if (active) {
          setRemoteLiveSnapshot(response?.snapshot || null)
          setRemoteLastSuccess({ scope, at: Date.now() })
          setRemotePollError(null)
        }
      } catch {
        if (active) setRemotePollError({ scope })
      } finally {
        busy = false
      }
    }
    void refresh()
    const timer = window.setInterval(refresh, 5_000)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [automaticMode, businessDate, remoteRefreshVersion, selectedStoreId, serverBacked])


  useEffect(() => {
    const automaticHistoryMonth = historyMonth >= AUTOMATIC_REVENUE_BONUS_EFFECTIVE_DATE.slice(0, 7)
    if (!selectedStoreId || !serverBacked || !automaticHistoryMonth) return undefined
    let active = true
    let busy = false
    const scope = `${identifierKey(selectedStoreId)}:${historyMonth}`
    const refresh = async () => {
      if (busy || (typeof document !== 'undefined' && document.hidden)) return
      busy = true
      try {
        const response = await apiGetRevenueBonusPeriod({ storeId: selectedStoreId, period: historyMonth })
        if (active) {
          setRemoteHistoryPeriod(response?.period || null)
          setRemoteHistoryError(null)
        }
      } catch {
        if (active) setRemoteHistoryError({ scope })
      } finally {
        busy = false
      }
    }
    void refresh()
    const timer = window.setInterval(refresh, 10_000)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [historyMonth, remoteRefreshVersion, selectedStoreId, serverBacked])

  const liveScope = `${identifierKey(selectedStoreId)}:${businessDate}`
  const matchingRemoteSnapshot = automaticMode && serverBacked && remoteLiveSnapshot
    && sameOperationalIdentifier(remoteLiveSnapshot.storeId, selectedStoreId)
    && String(remoteLiveSnapshot.businessDate || '') === businessDate
    ? remoteLiveSnapshot
    : null
  const remoteDataStale = automaticMode && serverBacked && remotePollError?.scope === liveScope
  const remoteLastSuccessAt = remoteLastSuccess?.scope === liveScope ? remoteLastSuccess.at : null
  const liveSnapshot = automaticMode ? (matchingRemoteSnapshot || localLiveSnapshot) : null
  const automaticLoading = automaticMode && serverBacked && !liveSnapshot && !remoteDataStale
  const historyScope = `${identifierKey(selectedStoreId)}:${historyMonth}`
  const automaticHistoryMonth = historyMonth >= AUTOMATIC_REVENUE_BONUS_EFFECTIVE_DATE.slice(0, 7)
  const matchingRemoteHistoryPeriod = automaticHistoryMonth && serverBacked && remoteHistoryPeriod
    && sameOperationalIdentifier(remoteHistoryPeriod.storeId, selectedStoreId)
    && String(remoteHistoryPeriod.period || '') === historyMonth
    ? remoteHistoryPeriod
    : null
  const remoteHistoryUnavailable = automaticHistoryMonth && serverBacked
    && remoteHistoryError?.scope === historyScope
  const visibleAutomaticAllocations = (Array.isArray(liveSnapshot?.allocations) ? liveSnapshot.allocations : [])
    .filter((allocation) => !privateAllocationView
      || sameOperationalIdentifier(entryEmployeeId(allocation), currentEmployeeId))
  const allocations = automaticMode ? visibleAutomaticAllocations : savedAllocations
  const revenueTotal = automaticMode ? Number(liveSnapshot?.revenueVnd || 0) : savedRevenueTotal
  const poolTotal = automaticMode ? Number(liveSnapshot?.totalPoolVnd || 0) : savedPoolTotal
  const unallocatedTotal = automaticMode ? Number(liveSnapshot?.unallocatedVnd || 0) : savedUnallocatedTotal
  const allocatedTotal = automaticMode ? Number(liveSnapshot?.allocatedVnd || 0) : savedAllocationTotal
  const adminAdjustmentTotal = automaticMode ? Number(liveSnapshot?.adminAdjustmentVnd || 0) : 0
  const excludedSupportShareTotal = automaticMode ? Number(liveSnapshot?.excludedSupportShareVnd || 0) : 0
  const allocationTotal = allocations.reduce((sum, allocation) => sum + allocationAmount(allocation), 0)
  const currentRevenueTier = revenueProgram
    ? selectRevenueBonusTier({
        programId: revenueProgram.id,
        revenueVnd: Math.max(0, Math.trunc(revenueTotal)),
      })
    : null
  const storeAttendance = (app.attendance || []).filter((attendance) => (
    !attendance.deletedAt
    && sameOperationalIdentifier(entryStoreId(attendance), selectedStoreId)
    && recordBusinessDate(attendance) === businessDate
  ))
  const localActualHours = storeAttendance
    .filter((attendance) => sameOperationalIdentifier(entryEmployeeId(attendance), currentEmployeeId))
    .reduce((sum, attendance) => sum + liveWorkedHours(
      attendance,
      nowMs,
      automaticMode && businessDate === vietnamToday(),
    ), 0)
  const ownAutomaticAllocation = visibleAutomaticAllocations
    .find((allocation) => sameOperationalIdentifier(entryEmployeeId(allocation), currentEmployeeId))
  const ownSavedAllocation = savedAllocations
    .find((allocation) => sameOperationalIdentifier(entryEmployeeId(allocation), currentEmployeeId))
  const savedActualHours = Number(ownSavedAllocation?.approvedSalesHours
    ?? ownSavedAllocation?.workedHours
    ?? ownSavedAllocation?.hours
    ?? (ownSavedAllocation?.workedSeconds == null ? 0 : Number(ownSavedAllocation.workedSeconds) / 3_600)) || 0
  const actualHours = Math.max(
    Number(ownAutomaticAllocation?.workedSeconds || 0) / 3_600,
    savedActualHours,
    localActualHours,
  )
  const totalStoreHours = automaticMode && liveSnapshot
    ? Number(liveSnapshot.totalWorkedSeconds || 0) / 3_600
    : storeAttendance.reduce((sum, attendance) => sum + liveWorkedHours(
        attendance,
        nowMs,
        automaticMode && businessDate === vietnamToday(),
      ), 0)
  const attendanceCount = Number(liveSnapshot?.attendanceCount ?? storeAttendance.length) || 0
  const formattedLastRemoteSuccess = remoteLastSuccessAt
    ? new Date(remoteLastSuccessAt).toLocaleTimeString('vi-VN', {
        hour: '2-digit', minute: '2-digit', second: '2-digit',
      })
    : ''
  const liveDataLabel = automaticMode
    ? remoteDataStale
      ? `Dữ liệu gần nhất${formattedLastRemoteSuccess ? ` lúc ${formattedLastRemoteSuccess}` : ''}`
      : 'Tự động cập nhật mỗi 5 giây'
    : displayDate(businessDate)
  const metricValue = (value) => automaticLoading ? 'Đang đồng bộ…' : value

  const legacyHistoryProjection = useMemo(() => revenueBonusHistoryProjection({
    revenueBonusDaily: legacyDailyRecords,
    revenueBonusAllocations: Array.isArray(app.revenueBonusAllocations) ? app.revenueBonusAllocations : [],
    employees: Array.isArray(app.employees) ? app.employees : [],
    storeId: selectedStoreId,
  }), [app.employees, app.revenueBonusAllocations, legacyDailyRecords, selectedStoreId])
  const automaticHistory = useMemo(() => {
    if (!revenueProgram || !selectedStoreId
      || historyMonth < AUTOMATIC_REVENUE_BONUS_EFFECTIVE_DATE.slice(0, 7)) {
      return { days: [], allocations: [] }
    }
    if (serverBacked) return matchingRemoteHistoryPeriod || { days: [], allocations: [] }
    return calculateAutomaticRevenueBonusPeriod({
      storeId: selectedStoreId,
      period: historyMonth,
      programId: revenueProgram.id,
      milestoneProgramId,
      orders: Array.isArray(app.orders) ? app.orders : [],
      attendance: Array.isArray(app.attendance) ? app.attendance : [],
      employees: Array.isArray(app.employees) ? app.employees : [],
      supportTransfers: Array.isArray(app.supportTransfers) ? app.supportTransfers : [],
      overrides: Array.isArray(app.revenueBonusOverrides) ? app.revenueBonusOverrides : [],
      nowMs,
    })
  }, [
    app.attendance,
    app.employees,
    app.orders,
    app.revenueBonusOverrides,
    app.supportTransfers,
    historyMonth,
    matchingRemoteHistoryPeriod,
    milestoneProgramId,
    nowMs,
    revenueProgram,
    selectedStoreId,
    serverBacked,
  ])
  const automaticHistoryRows = useMemo(() => automaticHistory.allocations.map((allocation) => ({
    ...allocation,
    month: allocation.businessDate.slice(0, 7),
    recordedAt: automaticHistory.days
      .find((day) => day.businessDate === allocation.businessDate)?.projectedAt || '',
  })), [automaticHistory])
  const historyRows = useMemo(() => {
    const combined = [...legacyHistoryProjection.rows, ...automaticHistoryRows]
      .toSorted((left, right) => `${right.businessDate} ${right.recordedAt} ${right.id}`
        .localeCompare(`${left.businessDate} ${left.recordedAt} ${left.id}`))
    return privateAllocationView
      ? combined.filter((row) => sameOperationalIdentifier(row.employeeId, currentEmployeeId))
      : combined
  }, [automaticHistoryRows, currentEmployeeId, legacyHistoryProjection.rows, privateAllocationView])
  const historyEmployeeOptions = useMemo(() => [...historyRows.reduce((options, row) => {
    const employeeId = String(row.employeeId || '').trim()
    if (!employeeId) return options
    const key = identifierKey(employeeId)
    if (!options.has(key)) options.set(key, { id: employeeId, name: row.employeeName || employeeId })
    return options
  }, new Map()).values()].toSorted((left, right) => left.name.localeCompare(right.name, 'vi-VN')), [historyRows])
  const filteredHistoryRows = useMemo(() => historyRows.filter((row) => (
    (!historyDate || row.businessDate === historyDate)
    && (!historyMonth || row.month === historyMonth)
    && (!historyEmployeeId || sameOperationalIdentifier(row.employeeId, historyEmployeeId))
  )), [historyDate, historyEmployeeId, historyMonth, historyRows])
  const historyStatistics = useMemo(() => revenueBonusStatistics(historyRows, {
    month: historyMonth,
  }), [historyMonth, historyRows])
  const filteredHistoryTotal = useMemo(() => filteredHistoryRows.reduce(
    (total, row) => total + Math.max(0, Number(row.amountVnd || 0)),
    0,
  ), [filteredHistoryRows])

  if (!allowed || !selectedStoreId) {
    return <AccessDenied subtitle="Tài khoản này không có phạm vi cửa hàng để xem thưởng doanh thu." />
  }
  if (!revenueProgram) {
    return <AccessDenied subtitle="Cửa hàng hiện tại chưa có chính sách thưởng doanh thu được hệ thống hỗ trợ." />
  }

  const openAdminAction = (allocation, mode) => {
    setError('')
    setAdminAction({ allocation, mode })
    setAdminAmount(String(allocationAmount(allocation)))
    setAdminReason('')
  }
  const closeAdminAction = () => {
    if (busyKey.startsWith('revenue-admin:')) return
    setAdminAction(null)
    setAdminAmount('')
    setAdminReason('')
  }
  const submitAdminAction = async () => {
    if (!adminAction || !isAdmin) return
    const reason = adminReason.trim()
    if (reason.length < 3) {
      setError('Lý do điều chỉnh phải có ít nhất 3 ký tự.')
      return
    }
    const { allocation, mode } = adminAction
    const payload = {
      storeId: selectedStoreId,
      businessDate,
      employeeId: entryEmployeeId(allocation),
      reason,
      ...(allocation.overrideVersion ? { expectedVersion: allocation.overrideVersion } : {}),
    }
    let action
    let success
    if (mode === 'edit') {
      const amountVnd = Number(adminAmount)
      if (!Number.isSafeInteger(amountVnd) || amountVnd < 0) {
        setError('Số tiền thưởng phải là số nguyên VND hợp lệ và không âm.')
        return
      }
      payload.amountVnd = amountVnd
      action = app.setRevenueBonusOverride
      success = `Đã cập nhật thưởng doanh thu của ${allocation.employeeName || entryEmployeeId(allocation)}.`
    } else if (mode === 'delete') {
      action = app.deleteRevenueBonusOverride
      success = `Đã xóa thưởng doanh thu của ${allocation.employeeName || entryEmployeeId(allocation)}.`
    } else {
      action = app.restoreRevenueBonusOverride
      success = `Đã khôi phục cách tính tự động cho ${allocation.employeeName || entryEmployeeId(allocation)}.`
    }
    const result = await run({
      key: `revenue-admin:${mode}`,
      action,
      payload,
      success,
      unavailable: 'Chức năng điều chỉnh thưởng doanh thu chỉ khả dụng khi kết nối máy chủ.',
    })
    if (!result || result.ok === false) return
    setAdminAction(null)
    setAdminAmount('')
    setAdminReason('')
    setRemoteRefreshVersion((version) => version + 1)
  }

  const adminActionTitle = adminAction?.mode === 'delete'
    ? 'XÓA THƯỞNG DOANH THU'
    : adminAction?.mode === 'restore'
      ? 'KHÔI PHỤC TÍNH TỰ ĐỘNG'
      : 'CHỈNH SỬA THƯỞNG DOANH THU'
  const adminActionLabel = adminAction?.mode === 'delete'
    ? 'XÁC NHẬN XÓA'
    : adminAction?.mode === 'restore'
      ? 'KHÔI PHỤC TỰ ĐỘNG'
      : 'LƯU ĐIỀU CHỈNH'

  return (
    <div className="page compensation-page revenue-bonus-page">
      <PageHeader
        title="THƯỞNG DOANH THU THEO NGÀY"
        subtitle={privateAllocationView
          ? 'Thưởng được hệ thống tự động cập nhật theo doanh thu và thời gian làm việc thực tế của bạn.'
          : `Hệ thống tự động tính và cập nhật thưởng theo thời gian thực tại ${storeName(stores, selectedStoreId)}.`}
        icon={CircleDollarSign}
        actions={<Badge tone="green">TỰ ĐỘNG</Badge>}
      />
      <Card className="compensation-filter-card">
        <div className="compensation-filter-grid">
          <Field label="Ngày kinh doanh">
            <Input aria-label="Ngày kinh doanh" type="date" value={businessDate} onChange={(event) => setBusinessDate(event.target.value)} />
          </Field>
          {privileged && !storeScoped && <Field label="Cửa hàng">
            <Select aria-label="Cửa hàng" value={selectedStoreId} onChange={(event) => {
              setStoreSelection(event.target.value)
              setHistoryEmployeeId('')
            }}>{stores.map((store) => <option key={entityId(store)} value={entityId(store)}>{store.name}</option>)}</Select>
          </Field>}
          {(!privileged || storeScoped) && <div className="compensation-fixed-scope" role="group" aria-label="Cửa hàng hiện tại">
            <span>Cửa hàng</span><strong>{storeName(stores, selectedStoreId)}</strong>
          </div>}
        </div>
        <ActionError message={error} />
        {remoteDataStale && <InfoNote tone="red">
          Không thể cập nhật dữ liệu trực tiếp. {formattedLastRemoteSuccess
            ? `Đang hiển thị lần cập nhật gần nhất lúc ${formattedLastRemoteSuccess}; hệ thống sẽ tự thử lại.`
            : 'Hệ thống sẽ tự thử lại.'}
        </InfoNote>}
        {automaticMode ? <InfoNote tone="green">
          Không cần bấm tính hoặc duyệt. Doanh thu, giờ làm và mốc thưởng được tự động tính lại mỗi 5 giây.
          {isAdmin ? ' Chỉ Admin có thể chỉnh sửa, xóa hoặc khôi phục thưởng của từng nhân viên.' : ''}
        </InfoNote> : <InfoNote tone="blue">
          Ngày này thuộc dữ liệu lịch sử trước khi chuyển sang cơ chế tự động từ {displayDate(AUTOMATIC_REVENUE_BONUS_EFFECTIVE_DATE)}.
        </InfoNote>}
        {Array.isArray(liveSnapshot?.overrideCollisions) && liveSnapshot.overrideCollisions.length > 0 && <InfoNote tone="red">
          Có điều chỉnh Admin bị trùng. Hệ thống đang dùng bản mới nhất và cần Admin xử lý dữ liệu đối soát.
        </InfoNote>}
      </Card>

      {privateAllocationView ? <div className="metric-grid compensation-metrics compensation-metrics--employee">
        <MetricCard compact label="TỔNG QUỸ CỦA TEAM" value={metricValue(money(poolTotal))} helper={liveDataLabel} icon={CircleDollarSign} tone="blue" />
        <MetricCard compact label="THƯỞNG DOANH THU CỦA TÔI" value={metricValue(money(allocationTotal))} helper={automaticMode ? 'Tự động theo giờ thực tế' : displayDate(businessDate)} icon={WalletCards} tone="green" />
        <MetricCard compact label="THỜI GIAN LÀM THỰC TẾ" value={formatWorkedHours(actualHours)} helper="Theo ca đã chấm công" icon={Clock3} tone="blue" />
        <MetricCard compact label="TỔNG GIỜ LÀM CỬA HÀNG" value={formatWorkedHours(totalStoreHours)} helper={`${attendanceCount} ca trong ngày`} icon={Clock3} tone="orange" />
      </div> : <div className="metric-grid compensation-metrics compensation-metrics--revenue-team">
        <MetricCard compact label="DOANH THU ĐỦ ĐIỀU KIỆN" value={metricValue(money(revenueTotal))} helper={liveDataLabel} icon={Store} tone="green" />
        <MetricCard compact label="TỔNG QUỸ THƯỞNG" value={metricValue(money(poolTotal))} helper={excludedSupportShareTotal > 0 ? 'Quỹ công thức trước khi loại phần nhân viên hỗ trợ' : automaticMode ? 'Gồm thưởng tỷ lệ và mốc cao nhất' : ''} icon={CircleDollarSign} tone="blue" />
        <MetricCard compact label="THƯỞNG DOANH THU GHI NHẬN THỰC TẾ" value={metricValue(money(allocatedTotal))} helper={excludedSupportShareTotal > 0 ? 'Số tiền thực tế phải chi cho nhân viên chính' : adminAdjustmentTotal !== 0 ? 'Đã gồm điều chỉnh của Admin' : 'Tự động theo giờ thực tế'} icon={WalletCards} tone="green" />
        <MetricCard compact label={excludedSupportShareTotal > 0 ? 'PHẦN KHÔNG GHI NHẬN CHI' : 'CHƯA PHÂN BỔ THEO CÔNG THỨC'} value={metricValue(money(unallocatedTotal))} helper={excludedSupportShareTotal > 0 ? 'Tỷ trọng theo giờ của nhân viên hỗ trợ; thưởng tự động bằng 0 đ' : unallocatedTotal > 0 ? 'Thiếu thời gian làm việc hợp lệ' : 'Đã đối soát'} icon={Clock3} tone={unallocatedTotal > 0 ? 'orange' : 'blue'} />
        <MetricCard compact label="ĐIỀU CHỈNH ADMIN" value={metricValue(money(adminAdjustmentTotal))} helper={adminAdjustmentTotal === 0 ? 'Chưa có điều chỉnh' : 'Chênh lệch so với kết quả tự động'} icon={Pencil} tone={adminAdjustmentTotal === 0 ? 'blue' : 'orange'} />
        <MetricCard compact label="TỔNG GIỜ LÀM CỬA HÀNG" value={formatWorkedHours(totalStoreHours)} helper={`${attendanceCount} ca trong ngày`} icon={Clock3} tone="orange" />
      </div>}

      <Card
        className="revenue-milestones-card"
        title={`Mốc thưởng doanh thu ${revenueProgram.id === REVENUE_BONUS_PROGRAM_IDS.SM_DAILY ? 'SM TNV' : 'Dosii'}`}
        action={<Badge tone={currentRevenueTier ? 'green' : 'blue'}>{currentRevenueTier ? `Đang ở mốc ${currentRevenueTier.rateBasisPoints / 100}%` : 'Chưa đạt mốc'}</Badge>}
      >
        <div className="revenue-milestones-summary">
          <span>Doanh thu đã ghi nhận</span><strong>{metricValue(money(revenueTotal))}</strong>
        </div>
        {automaticMode && Number(liveSnapshot?.milestonePoolVnd || 0) > 0 && <InfoNote tone="green">
          Hệ thống đã tự động cộng thưởng mốc cao nhất: {money(liveSnapshot.milestonePoolVnd)}. Không cần duyệt thủ công.
        </InfoNote>}
        <div className="revenue-milestone-list">
          {revenueProgram.tiers.map((tier) => {
            const reached = tier.minimumInclusive
              ? revenueTotal >= tier.minimumRevenueVnd
              : revenueTotal > tier.minimumRevenueVnd
            const active = currentRevenueTier?.id === tier.id
            return <div key={tier.id} className={`revenue-milestone ${reached ? 'is-reached' : ''} ${active ? 'is-active' : ''}`}>
              <span className="revenue-milestone-check" aria-hidden="true">{reached ? '✓' : '○'}</span>
              <span><strong>{revenueTierLabel(tier)}</strong><small>{reached ? 'Đã đạt mốc' : 'Chưa đạt mốc'}</small></span>
              <b>Thưởng {tier.rateBasisPoints / 100}% doanh thu</b>
            </div>
          })}
        </div>
      </Card>

      {unallocatedTotal > 0 && (privileged || storeManager) && <InfoNote tone="orange">
        {excludedSupportShareTotal > 0
          ? `Giờ làm của nhân viên hỗ trợ vẫn nằm trong tổng giờ chia thưởng. Phần tỷ trọng ${money(excludedSupportShareTotal)} không được ghi nhận chi cho nhân viên hỗ trợ; số tiền thưởng doanh thu ghi nhận thực tế phải chi là ${money(allocatedTotal)}.`
          : 'Có quỹ chưa phân bổ do thiếu thời gian làm việc hợp lệ. Hệ thống sẽ tự phân bổ lại khi dữ liệu chấm công được cập nhật.'}
      </InfoNote>}

      <Card title={privateAllocationView ? 'Chi tiết thưởng của tôi' : 'Phân bổ thưởng tự động theo nhân viên'} action={<Badge tone={automaticMode ? 'green' : 'blue'}>{automaticMode ? 'Cập nhật trực tiếp' : `${allocations.length} dòng lịch sử`}</Badge>}>
        <TableWrap className="compensation-table revenue-bonus-allocation-table">
          <thead><tr>
            {!privateAllocationView && <th>Nhân viên</th>}
            <th>Cửa hàng</th><th>Ngày</th><th>Thời gian làm thực tế</th><th>Tỷ trọng</th>
            <th>Thưởng tự động</th><th>Thưởng ghi nhận thực tế</th><th>Trạng thái</th>
            {isAdmin && automaticMode && <th>Thao tác Admin</th>}
          </tr></thead>
          <tbody>{allocations.map((allocation, index) => {
            const automaticAmount = Number(allocation.automaticAmountVnd ?? allocationAmount(allocation)) || 0
            const effectiveAmount = allocationAmount(allocation)
            const deleted = String(allocation.status || '').toUpperCase() === 'ADMIN_DELETED'
            return <tr key={allocation.id || `${entryEmployeeId(allocation)}-${index}`} className={deleted ? 'revenue-bonus-row--deleted' : ''}>
              {!privateAllocationView && <td><strong>{employeeName(app.employees || [], entryEmployeeId(allocation), allocation.employeeName)}</strong><SupportEmployeeTag context={resolveSupportEmployeeTagContext({ record: allocation, employeeId: entryEmployeeId(allocation), storeId: entryStoreId(allocation), businessDate: revenueRecordDate(allocation), employees: app.employees, stores: app.stores, supportTransfers: app.supportTransfers })} className="compensation-subline" /><small className="compensation-subline">{entryEmployeeId(allocation)}</small></td>}
              <td>{storeName(stores, entryStoreId(allocation), allocation.storeName)}</td>
              <td>{displayDate(revenueRecordDate(allocation))}</td>
              <td>{Number(allocation.approvedSalesHours ?? allocation.workedHours ?? allocation.hours ?? (Number(allocation.workedSeconds || 0) / 3_600)).toFixed(2)} giờ</td>
              <td>{allocation.weightPercent != null ? `${Number(allocation.weightPercent).toFixed(2)}%` : allocation.weight != null ? `${(Number(allocation.weight) * 100).toFixed(2)}%` : '—'}</td>
              <td>{automaticMode ? money(automaticAmount) : '—'}</td>
              <td><strong>{money(effectiveAmount)}</strong>{automaticMode && effectiveAmount !== automaticAmount && <small className="compensation-subline">Chênh lệch {money(effectiveAmount - automaticAmount)}</small>}</td>
              <td>
                <Badge tone={revenueStatusTone(allocation)}>{revenueStatusLabel(allocation)}</Badge>
                {allocation.supportTransferred && <small className="compensation-subline">Theo công thức tự động: giờ làm vẫn được tính vào mẫu số; phần tỷ trọng {money(allocation.excludedSupportShareVnd || allocation.formulaShareVnd || 0)} không ghi nhận chi và thưởng tự động của nhân viên hỗ trợ bằng 0 đ.</small>}
                {allocation.overrideReason && <small className="compensation-subline">{allocation.overrideReason}</small>}
              </td>
              {isAdmin && automaticMode && <td><div className="compensation-row-actions revenue-bonus-admin-actions">
                <Button variant="outline" icon={Pencil} disabled={!serverBacked || Boolean(busyKey)} onClick={() => openAdminAction(allocation, 'edit')}>Sửa</Button>
                {!deleted && <Button variant="danger" icon={Trash2} disabled={!serverBacked || Boolean(busyKey)} onClick={() => openAdminAction(allocation, 'delete')}>Xóa</Button>}
                {allocation.overrideId && <Button variant="outline" icon={RotateCcw} disabled={!serverBacked || Boolean(busyKey)} onClick={() => openAdminAction(allocation, 'restore')}>Khôi phục tự động</Button>}
              </div></td>}
            </tr>
          })}{!allocations.length && <tr><td colSpan={(privateAllocationView ? 7 : 8) + (isAdmin && automaticMode ? 1 : 0)} className="compensation-empty">
            {automaticLoading ? 'Đang đồng bộ phân bổ thưởng tự động.' : automaticMode ? 'Chưa có thời gian làm việc để phân bổ thưởng trong ngày này.' : 'Ngày lịch sử này chưa có phân bổ thưởng doanh thu.'}
          </td></tr>}</tbody>
        </TableWrap>
      </Card>

      {remoteHistoryUnavailable && <InfoNote tone="red">
        Không thể cập nhật lịch sử thưởng tự động từ máy chủ. Hệ thống sẽ tự thử lại; số liệu lịch sử cũ không được dùng để ước tính thay thế.
      </InfoNote>}

      <RevenueHistorySections
        collisions={legacyHistoryProjection.collisions}
        currentEmployeeName={employeeName(app.employees || [], currentEmployeeId)}
        employeeCollisions={legacyHistoryProjection.employeeCollisions || []}
        employeeOptions={historyEmployeeOptions}
        employees={app.employees || []}
        filteredRows={filteredHistoryRows}
        filteredTotal={filteredHistoryTotal}
        historyDate={historyDate}
        historyEmployeeId={historyEmployeeId}
        historyMonth={historyMonth}
        privateView={privateAllocationView}
        rows={historyRows}
        setHistoryDate={setHistoryDate}
        setHistoryEmployeeId={setHistoryEmployeeId}
        setHistoryMonth={setHistoryMonth}
        statistics={historyStatistics}
        stores={Array.isArray(app.stores) ? app.stores : stores}
        supportTransfers={app.supportTransfers || []}
      />

      {!automaticMode && !privateAllocationView && <Card title="Lịch sử tính quỹ trong ngày">
        <TableWrap className="compensation-table"><thead><tr><th>Mã tính</th><th>Chương trình</th><th>Doanh thu</th><th>Quỹ tỷ lệ</th><th>Thưởng mốc cao nhất</th><th>Tổng quỹ</th><th>Trạng thái</th></tr></thead><tbody>{records.map((record) => <tr key={record.id}><td>{record.id}</td><td>{record.programLabel || record.programId || '—'}</td><td>{money(recordRevenue(record))}</td><td>{money(record.percentagePoolVnd || 0)}</td><td>{money(record.milestonePoolVnd || record.hotPoolVnd || 0)}</td><td><strong>{money(revenueRecordTotal(record))}</strong></td><td><Badge tone={statusTone(record)}>{statusLabel(record)}</Badge></td></tr>)}{!records.length && <tr><td colSpan="7" className="compensation-empty">Chưa có kết quả thưởng lịch sử cho ngày này.</td></tr>}</tbody></TableWrap>
      </Card>}

      <Modal
        open={Boolean(adminAction)}
        onClose={closeAdminAction}
        title={adminActionTitle}
        footer={<>
          <Button variant="outline" disabled={busyKey.startsWith('revenue-admin:')} onClick={closeAdminAction}>HỦY</Button>
          <Button
            variant={adminAction?.mode === 'delete' ? 'danger' : 'primary'}
            loading={busyKey === `revenue-admin:${adminAction?.mode}`}
            onClick={submitAdminAction}
          >{adminActionLabel}</Button>
        </>}
      >
        {adminAction && <div className="revenue-bonus-admin-form">
          <div className="revenue-bonus-admin-summary">
            <span>Nhân viên</span><strong>{adminAction.allocation.employeeName || entryEmployeeId(adminAction.allocation)}</strong>
            <span>Ngày</span><strong>{displayDate(businessDate)}</strong>
            <span>Thưởng hệ thống tự tính</span><strong>{money(Number(adminAction.allocation.automaticAmountVnd ?? allocationAmount(adminAction.allocation)))}</strong>
          </div>
          {adminAction.mode === 'edit' && <Field label="Số tiền thưởng hiệu lực" required>
            <MoneyInput aria-label="Số tiền thưởng hiệu lực" value={adminAmount} onChange={(event) => setAdminAmount(event.target.value)} autoFocus />
          </Field>}
          {adminAction.mode === 'delete' && <InfoNote tone="red">
            Khoản thưởng hiệu lực của nhân viên sẽ về 0 đồng. Dòng thưởng vẫn được giữ để Admin có thể khôi phục và phục vụ đối soát.
          </InfoNote>}
          {adminAction.mode === 'restore' && <InfoNote tone="green">
            Hệ thống sẽ bỏ điều chỉnh của Admin và quay lại số tiền tự động theo doanh thu, mốc thưởng và thời gian làm việc hiện tại.
          </InfoNote>}
          <Field label="Lý do" required hint="Bắt buộc từ 3 đến 500 ký tự; được lưu vào nhật ký đối soát.">
            <textarea
              aria-label="Lý do điều chỉnh thưởng doanh thu"
              value={adminReason}
              maxLength={500}
              rows={4}
              onChange={(event) => setAdminReason(event.target.value)}
              placeholder="Nhập lý do điều chỉnh..."
            />
          </Field>
        </div>}
      </Modal>
    </div>
  )
}
