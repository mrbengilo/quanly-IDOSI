import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { Calculator, CheckCircle2, CircleDollarSign, Clock3, Store, WalletCards, XCircle } from 'lucide-react'
import { useApp } from '../../state/AppContext'
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
  TableWrap,
} from '../../components/UI'
import { businessDate as toBusinessDate, money, operationalIdentifierRecordMatch } from '../../utils'
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
  calculateRevenueBonus,
  selectRevenueBonusTier,
} from '../../domain/compensationPolicies'
import { allocateByLargestRemainder } from '../../domain/compensationAllocation'
import { revenueBonusEligibility } from '../../domain/revenueBonusEligibility'
import { classifyStorePayrollPolicy, STORE_PAYROLL_POLICY } from '../../domain/storeTieredPayroll'
import { apiGetRevenueBonusLive } from '../../services/idosiApi'
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

const employeeIdentifiers = (employee = {}) => [employee.id, employee.code, employee.employeeId].filter(Boolean)
const identifierKey = (value) => String(value || '').trim().toLocaleLowerCase('en-US')

const resolvedEntityId = (records, reference, identifiers = (record) => [entityId(record)]) => (
  entityId(operationalIdentifierRecordMatch(records, reference, identifiers).record)
)

const effectiveDailyRecord = (record = {}) => !record.deletedAt
  && !record.voidedAt
  && !record.supersededAt
  && !['VOID', 'VOIDED', 'SUPERSEDED', 'CANCELLED'].includes(String(record.status || '').trim().toUpperCase())

const employeeResolver = (employees = []) => {
  const exact = new Map()
  const folded = new Map()
  for (const employee of employees) {
    for (const identifier of new Set(employeeIdentifiers(employee).map((value) => String(value).trim()).filter(Boolean))) {
      exact.set(identifier, [...(exact.get(identifier) || []), employee])
      const foldedKey = identifier.toLocaleLowerCase('en-US')
      folded.set(foldedKey, [...(folded.get(foldedKey) || []), employee])
    }
  }
  return (reference) => {
    const requested = String(reference || '').trim()
    if (!requested) return null
    const exactMatches = exact.get(requested) || []
    if (exactMatches.length) return exactMatches.length === 1 ? exactMatches[0] : null
    const matches = folded.get(requested.toLocaleLowerCase('en-US')) || []
    return matches.length === 1 ? matches[0] : null
  }
}

const buildLocalLiveSnapshot = ({ app, storeId, selectedDate, programId, nowMs }) => {
  if (!Array.isArray(app.orders) || !Array.isArray(app.attendance)) return null
  const orders = app.orders.filter((order) => (
    sameOperationalIdentifier(order.storeId, storeId)
    && recordBusinessDate(order) === selectedDate
    && !order.deletedAt
    && String(order.status || '') !== 'Đã xóa'
    && Number.isSafeInteger(Number(order.amount))
    && Number(order.amount) >= 0
  ))
  const revenueVnd = orders.reduce((sum, order) => sum + Number(order.amount), 0)
  if (!Number.isSafeInteger(revenueVnd)) return null
  const percentage = calculateRevenueBonus({ programId, revenueVnd })
  const employeeRecords = Array.isArray(app.employees) ? app.employees : []
  const resolveEmployee = employeeResolver(employeeRecords)
  const employeeById = new Map()
  const weightByEmployee = new Map()
  let attendanceCount = 0
  let openAttendanceCount = 0
  const activeEmployeeIds = new Set()
  const projectOpenAttendance = selectedDate === vietnamToday()
  app.attendance.forEach((attendance) => {
    if (!sameOperationalIdentifier(attendance.storeId, storeId)
      || recordBusinessDate(attendance) !== selectedDate
      || attendance.deletedAt) return
    const employee = resolveEmployee(attendance.employeeId)
    const employeeId = entityId(employee) || String(attendance.employeeId || '').trim()
    if (!employeeId || (employeeRecords.length && !employee)
    ) return
    employeeById.set(employeeId, employee)
    attendanceCount += 1
    if (!attendance.checkOutAt && !attendance.checkOut) {
      openAttendanceCount += 1
      activeEmployeeIds.add(employeeId)
    }
    const seconds = liveWorkedSeconds(attendance, nowMs, projectOpenAttendance)
    if (seconds > 0) weightByEmployee.set(employeeId, (weightByEmployee.get(employeeId) || 0) + seconds)
  })
  const participants = [...weightByEmployee].map(([id, weightUnits]) => ({ id, weightUnits }))
  const allocation = participants.length
    ? allocateByLargestRemainder({ poolVnd: percentage.bonusVnd, participants })
    : { totalWeightUnits: 0, allocatedVnd: 0, unallocatedVnd: percentage.bonusVnd, allocations: [] }
  return {
    storeId,
    businessDate: selectedDate,
    projectedAt: new Date(nowMs).toISOString(),
    revenueVnd,
    orderCount: orders.length,
    percentagePoolVnd: percentage.bonusVnd,
    allocatedVnd: allocation.allocatedVnd,
    unallocatedVnd: allocation.unallocatedVnd,
    totalWorkedSeconds: allocation.totalWeightUnits,
    attendanceCount,
    openAttendanceCount,
    activeEmployeeCount: activeEmployeeIds.size,
    participantCount: participants.length,
    calculationEligibility: revenueBonusEligibility({
      storeId,
      businessDate: selectedDate,
      schedule: Array.isArray(app.schedule) ? app.schedule : [],
      shiftDefinitions: Array.isArray(app.shiftDefinitions) ? app.shiftDefinitions : [],
      attendance: app.attendance,
      employees: employeeRecords,
      dailyRecords: Array.isArray(app.revenueBonusDaily) ? app.revenueBonusDaily : (app.revenueBonuses || []),
      nowMs,
    }),
    allocations: allocation.allocations.map((row) => ({
      employeeId: row.id,
      employeeName: employeeById.get(row.id)?.name || row.id,
      workedSeconds: row.weightUnits,
      weightPercent: allocation.totalWeightUnits > 0 ? (row.weightUnits / allocation.totalWeightUnits) * 100 : 0,
      amountVnd: row.amountVnd,
      status: 'LIVE',
    })),
  }
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
          <td><strong>{row.employeeName}</strong><small className="compensation-subline">{row.employeeId}</small></td>
          <td>{storeName(stores, row.storeId, row.storeName)}</td>
          <td>{Number(row.approvedSalesHours || 0).toFixed(2)} giờ</td>
          <td>{row.weightPercent == null ? '—' : `${Number(row.weightPercent).toFixed(2)}%`}</td>
          <td><strong>{money(row.amountVnd)}</strong></td>
          <td><Badge tone={statusTone(row)}>{statusLabel(row)}</Badge></td>
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
  const [submittedCalculationScope, setSubmittedCalculationScope] = useState('')
  const submittedCalculationRef = useRef('')
  const [remoteLiveSnapshot, setRemoteLiveSnapshot] = useState(null)
  const [remotePollError, setRemotePollError] = useState(null)
  const [remoteLastSuccess, setRemoteLastSuccess] = useState(null)
  const [nowMs, setNowMs] = useState(() => Date.now())
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
  const shouldTickLocalClock = !serverBacked && businessDate === vietnamToday()
  useEffect(() => {
    if (!shouldTickLocalClock) return undefined
    const timer = window.setInterval(() => setNowMs(Date.now()), 5_000)
    return () => window.clearInterval(timer)
  }, [shouldTickLocalClock])
  const { busyKey, error, run } = useCompensationAction(app)
  const scopedRecords = (app.revenueBonuses || [])
    .filter((record) => sameOperationalIdentifier(entryStoreId(record), selectedStoreId) && revenueRecordDate(record) === businessDate)
    .filter(effectiveDailyRecord)
  const selectedDayCollision = scopedRecords.length > 1
  const records = selectedDayCollision ? [] : scopedRecords
  const milestoneClaims = (app.teamRewardClaims || [])
    .filter((claim) => sameOperationalIdentifier(entryStoreId(claim), selectedStoreId) && revenueRecordDate(claim) === businessDate)
    .sort((left, right) => String(right.createdAt || '').localeCompare(String(left.createdAt || '')))
  const savedAllocations = revenueAllocations(records)
    .filter((allocation) => sameOperationalIdentifier(entryStoreId(allocation), selectedStoreId) && revenueRecordDate(allocation) === businessDate)
    .filter((allocation) => !privateAllocationView || sameOperationalIdentifier(entryEmployeeId(allocation), currentEmployeeId))
  const savedPoolTotal = records.reduce((sum, record) => sum + revenueRecordTotal(record), 0)
  const savedRevenueTotal = records.reduce((sum, record) => sum + recordRevenue(record), 0)
  const savedAllocationTotal = savedAllocations.reduce((sum, allocation) => sum + allocationAmount(allocation), 0)
  const savedUnallocatedTotal = records.reduce((sum, record) => sum + Number(record?.unallocatedVnd || 0), 0)
  const savedMilestonePoolTotal = records.reduce((sum, record) => sum + Math.max(0, Number(record?.milestonePoolVnd || 0)), 0)
  const savedMilestoneAllocationByEmployee = new Map()
  for (const allocation of revenueAllocations(records)) {
    const employeeId = entryEmployeeId(allocation)
    const employeeKey = identifierKey(employeeId)
    const milestoneAmount = Math.max(0, Number(allocation?.milestonePoolVnd || 0))
    if (employeeKey && milestoneAmount > 0) {
      savedMilestoneAllocationByEmployee.set(employeeKey, (savedMilestoneAllocationByEmployee.get(employeeKey) || 0) + milestoneAmount)
    }
  }
  const savedMilestoneAllocatedTotal = [...savedMilestoneAllocationByEmployee.values()].reduce((sum, amount) => sum + amount, 0)
  const savedMilestoneUnallocatedTotal = Math.max(0, savedMilestonePoolTotal - savedMilestoneAllocatedTotal)
  const selectedStore = operationalIdentifierRecordMatch(stores, selectedStoreId, (store) => [entityId(store)]).record
  const historyProjection = useMemo(() => revenueBonusHistoryProjection({
      revenueBonusDaily: Array.isArray(app.revenueBonusDaily) ? app.revenueBonusDaily : (app.revenueBonuses || []),
      revenueBonusAllocations: Array.isArray(app.revenueBonusAllocations) ? app.revenueBonusAllocations : [],
      employees: Array.isArray(app.employees) ? app.employees : [],
      storeId: selectedStoreId,
    }), [app.employees, app.revenueBonusAllocations, app.revenueBonusDaily, app.revenueBonuses, selectedStoreId])
  const historyRows = useMemo(() => {
    const rows = historyProjection.rows
    return privateAllocationView
      ? rows.filter((row) => sameOperationalIdentifier(row.employeeId, currentEmployeeId))
      : rows
  }, [currentEmployeeId, historyProjection, privateAllocationView])
  const historyEmployeeOptions = useMemo(() => [...historyRows.reduce((options, row) => {
    const employeeId = String(row.employeeId || '').trim()
    if (!employeeId) return options
    const key = employeeId.toLocaleLowerCase('en-US')
    if (!options.has(key)) options.set(key, { id: employeeId, name: row.employeeName || employeeId })
    return options
  }, new Map()).values()].toSorted((left, right) => left.name.localeCompare(right.name, 'vi-VN')), [historyRows])
  const filteredHistoryRows = useMemo(() => historyRows.filter((row) => (
    (!historyDate || row.businessDate === historyDate)
    && (!historyMonth || row.month === historyMonth)
    && (!historyEmployeeId || sameOperationalIdentifier(row.employeeId, historyEmployeeId))
  )), [historyDate, historyEmployeeId, historyMonth, historyRows])
  const historyStatistics = useMemo(() => revenueBonusStatistics(historyRows, { month: historyMonth }), [historyMonth, historyRows])
  const filteredHistoryTotal = useMemo(() => filteredHistoryRows.reduce(
    (total, row) => total + Math.max(0, Number(row.amountVnd || 0)),
    0,
  ), [filteredHistoryRows])
  const selectedStorePolicy = classifyStorePayrollPolicy(selectedStore)
  const revenueProgram = selectedStorePolicy === STORE_PAYROLL_POLICY.SM_TNV
    ? REVENUE_BONUS_PROGRAMS[REVENUE_BONUS_PROGRAM_IDS.SM_DAILY]
    : selectedStorePolicy === STORE_PAYROLL_POLICY.DOSII
      ? REVENUE_BONUS_PROGRAMS[REVENUE_BONUS_PROGRAM_IDS.DOSII_DAILY]
      : null
  const localLiveSnapshot = useMemo(() => (
    !serverBacked && revenueProgram
      ? buildLocalLiveSnapshot({
          app: {
            orders: app.orders,
            attendance: app.attendance,
            employees: app.employees,
            schedule: app.schedule,
            shiftDefinitions: app.shiftDefinitions,
            revenueBonusDaily: app.revenueBonusDaily,
            revenueBonuses: app.revenueBonuses,
          },
          storeId: selectedStoreId,
          selectedDate: businessDate,
          programId: revenueProgram.id,
          nowMs,
        })
      : null
  ), [
    app.attendance,
    app.employees,
    app.orders,
    app.revenueBonusDaily,
    app.revenueBonuses,
    app.schedule,
    app.shiftDefinitions,
    businessDate,
    nowMs,
    revenueProgram,
    selectedStoreId,
    serverBacked,
  ])

  useEffect(() => {
    if (!selectedStoreId || !serverBacked) return undefined
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
  }, [businessDate, selectedStoreId, serverBacked])

  const calculationScope = `${identifierKey(selectedStoreId)}:${businessDate}`
  const matchingRemoteSnapshot = serverBacked && remoteLiveSnapshot
    && sameOperationalIdentifier(remoteLiveSnapshot.storeId, selectedStoreId)
    && String(remoteLiveSnapshot.businessDate || '') === businessDate
    ? remoteLiveSnapshot
    : null
  const remoteDataStale = serverBacked && remotePollError?.scope === calculationScope
  const remoteLastSuccessAt = remoteLastSuccess?.scope === calculationScope ? remoteLastSuccess.at : null
  const calculationEligibility = serverBacked
    ? matchingRemoteSnapshot?.calculationEligibility || null
    : localLiveSnapshot?.calculationEligibility || null
  const calculationCollision = calculationEligibility?.code === 'DATA_COLLISION' || selectedDayCollision
  const calculationDone = !calculationCollision && (calculationEligibility?.code === 'ALREADY_CALCULATED'
    || records.length > 0
    || submittedCalculationScope === calculationScope)
  const awaitingSavedResult = calculationDone && records.length !== 1
  const calculationReady = !remoteDataStale && !calculationCollision && calculationEligibility?.code === 'READY' && !calculationDone
  const liveSnapshot = calculationDone || calculationCollision ? null : (matchingRemoteSnapshot || localLiveSnapshot)
  const attendanceSnapshot = matchingRemoteSnapshot || localLiveSnapshot
  const revenueTotal = Number(liveSnapshot?.revenueVnd ?? savedRevenueTotal) || 0
  const poolTotal = liveSnapshot
    ? (Number(liveSnapshot.percentagePoolVnd || 0) + savedMilestonePoolTotal)
    : savedPoolTotal
  const unallocatedTotal = liveSnapshot
    ? (Number(liveSnapshot.unallocatedVnd || 0) + savedMilestoneUnallocatedTotal)
    : savedUnallocatedTotal
  const visibleLiveAllocations = (Array.isArray(liveSnapshot?.allocations) ? liveSnapshot.allocations : [])
    .filter((allocation) => !privateAllocationView || sameOperationalIdentifier(entryEmployeeId(allocation), currentEmployeeId))
    .map((allocation, index) => ({
      ...allocation,
      id: allocation.id || `live:${entryEmployeeId(allocation)}:${index}`,
      storeId: selectedStoreId,
      businessDate,
      approvedSalesHours: Number(allocation.workedSeconds || 0) / 3_600,
      milestonePoolVnd: savedMilestoneAllocationByEmployee.get(identifierKey(entryEmployeeId(allocation))) || 0,
      allocatedVnd: allocationAmount(allocation) + (savedMilestoneAllocationByEmployee.get(identifierKey(entryEmployeeId(allocation))) || 0),
    }))
  const allocations = liveSnapshot ? visibleLiveAllocations : savedAllocations
  const allocationTotal = liveSnapshot
    ? visibleLiveAllocations.reduce((sum, allocation) => sum + allocationAmount(allocation), 0)
    : savedAllocationTotal
  const allocatedTotal = liveSnapshot
    ? (Number(liveSnapshot.allocatedVnd || 0) + savedMilestoneAllocatedTotal)
    : savedAllocationTotal
  const currentRevenueTier = !awaitingSavedResult && revenueProgram
    ? selectRevenueBonusTier({ programId: revenueProgram.id, revenueVnd: Math.max(0, Math.trunc(revenueTotal)) })
    : null
  const storeAttendance = (app.attendance || []).filter((attendance) => (
    !attendance.deletedAt
    && sameOperationalIdentifier(entryStoreId(attendance), selectedStoreId)
    && recordBusinessDate(attendance) === businessDate
  ))
  const localActualHours = storeAttendance
    .filter((attendance) => sameOperationalIdentifier(entryEmployeeId(attendance), currentEmployeeId))
    .reduce((sum, attendance) => sum + liveWorkedHours(attendance, nowMs, businessDate === vietnamToday()), 0)
  const ownAttendanceAllocation = (Array.isArray(attendanceSnapshot?.allocations) ? attendanceSnapshot.allocations : [])
    .find((allocation) => sameOperationalIdentifier(entryEmployeeId(allocation), currentEmployeeId))
  const ownSavedAllocation = savedAllocations
    .find((allocation) => sameOperationalIdentifier(entryEmployeeId(allocation), currentEmployeeId))
  const savedActualHours = Number(ownSavedAllocation?.approvedSalesHours
    ?? ownSavedAllocation?.workedHours
    ?? ownSavedAllocation?.hours
    ?? (ownSavedAllocation?.workedSeconds == null ? 0 : Number(ownSavedAllocation.workedSeconds) / 3_600)) || 0
  const actualHours = Math.max(
    Number(ownAttendanceAllocation?.workedSeconds || 0) / 3_600,
    savedActualHours,
    localActualHours,
  )
  const projectedAtMs = Date.parse(attendanceSnapshot?.projectedAt || '')
  const liveExtraSeconds = Number.isFinite(projectedAtMs) && nowMs > projectedAtMs && businessDate === vietnamToday()
    ? Math.floor((nowMs - projectedAtMs) / 1_000) * Number(attendanceSnapshot?.openAttendanceCount || 0)
    : 0
  const totalStoreHours = attendanceSnapshot
    ? (Number(attendanceSnapshot.totalWorkedSeconds || 0) + liveExtraSeconds) / 3_600
    : storeAttendance.reduce((sum, attendance) => sum + liveWorkedHours(attendance, nowMs, businessDate === vietnamToday()), 0)
  const attendanceCount = Number(attendanceSnapshot?.attendanceCount ?? storeAttendance.length) || 0
  const formattedLastRemoteSuccess = remoteLastSuccessAt
    ? new Date(remoteLastSuccessAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : ''
  const liveDataLabel = liveSnapshot
    ? remoteDataStale
      ? `Dữ liệu gần nhất${formattedLastRemoteSuccess ? ` lúc ${formattedLastRemoteSuccess}` : ''}`
      : 'Tự cập nhật mỗi 5 giây'
    : displayDate(businessDate)
  const eligibilityTone = calculationCollision
    ? 'red'
    : awaitingSavedResult
      ? 'orange'
    : calculationReady || calculationDone
      ? 'green'
      : 'orange'
  const eligibilityMessage = calculationCollision
    ? 'Ngày này có nhiều kết quả thưởng đang hiệu lực; cần xử lý dữ liệu trùng trước khi xem hoặc tính thưởng.'
    : awaitingSavedResult
    ? 'Thưởng doanh thu của ngày này đã được tính; hệ thống đang đồng bộ kết quả đã lưu.'
    : calculationDone
    ? 'Thưởng doanh thu của ngày này đã được tính và không thể tính lại.'
    : calculationEligibility?.message
    || (serverBacked
      ? 'Đang kiểm tra trạng thái ca cuối cùng và kết quả thưởng đã lưu.'
      : 'Chưa đủ dữ liệu để kiểm tra điều kiện tính thưởng doanh thu.')
  const openAttendanceAlert = privileged && calculationEligibility?.code === 'ATTENDANCE_OPEN'

  if (!allowed || !selectedStoreId) return <AccessDenied subtitle="Tài khoản này không có phạm vi cửa hàng để xem thưởng doanh thu." />
  if (!revenueProgram) return <AccessDenied subtitle="Cửa hàng hiện tại chưa có chính sách thưởng doanh thu được hệ thống hỗ trợ." />

  const calculate = async () => {
    if (!calculationReady || submittedCalculationRef.current === calculationScope) return
    const confirmed = typeof window === 'undefined' || window.confirm(
      `Xác nhận tính thưởng doanh thu ngày ${displayDate(businessDate)} cho ${storeName(stores, selectedStoreId)}?

Mỗi cửa hàng chỉ được tính một lần cho ngày này và không thể tính lại.`,
    )
    if (!confirmed) return
    submittedCalculationRef.current = calculationScope
    const result = await run({
      key: 'calculate',
      action: app.calculateRevenueBonusDay,
      payload: { storeId: selectedStoreId, businessDate },
      success: `Đã tính thưởng doanh thu ngày ${displayDate(businessDate)}.`,
      unavailable: 'Chức năng tính thưởng doanh thu đang được đồng bộ với máy chủ. Dữ liệu đã tính trước đó vẫn được giữ nguyên.',
    })
    if (result && result.ok !== false) setSubmittedCalculationScope(calculationScope)
    else submittedCalculationRef.current = ''
  }

  const decideMilestone = (claim, approve) => {
    if (!approve && typeof window !== 'undefined' && !window.confirm('Từ chối đề nghị thưởng mốc này? Quyết định sẽ được lưu để đối soát.')) return
    run({
      key: `${approve ? 'approve' : 'reject'}:${claim.id}`,
      action: approve ? app.approveRevenueBonusMilestone : app.rejectRevenueBonusMilestone,
      payload: { claimId: claim.id, expectedVersion: claim.version },
      success: approve ? 'Đã duyệt thưởng mốc cao nhất.' : 'Đã từ chối thưởng mốc và giữ lại lịch sử.',
      unavailable: 'Chức năng duyệt thưởng mốc đang được đồng bộ với máy chủ.',
    })
  }

  return (
    <div className="page compensation-page revenue-bonus-page">
      <PageHeader
        title="THƯỞNG DOANH THU THEO NGÀY"
        subtitle={privateAllocationView
          ? 'Hiển thị tổng quỹ của cửa hàng và khoản thưởng của chính bạn; không hiển thị phần của đồng nghiệp.'
          : `Theo dõi quỹ và phân bổ thưởng theo giờ bán hàng được duyệt tại ${storeName(stores, selectedStoreId)}.`}
        icon={CircleDollarSign}
        actions={privileged && <Button
          className={`revenue-bonus-calculate-button${calculationReady ? ' is-ready' : ''}`}
          icon={calculationDone ? CheckCircle2 : Calculator}
          loading={busyKey === 'calculate'}
          disabled={Boolean(busyKey) || !calculationReady}
          onClick={calculate}
          title={eligibilityMessage}
        >{awaitingSavedResult ? 'ĐANG ĐỒNG BỘ KẾT QUẢ' : calculationDone ? 'ĐÃ TÍNH THƯỞNG' : 'TÍNH THƯỞNG NGÀY'}</Button>}
      />
      <Card className="compensation-filter-card">
        <div className="compensation-filter-grid">
          <Field label="Ngày kinh doanh"><Input aria-label="Ngày kinh doanh" type="date" value={businessDate} onChange={(event) => setBusinessDate(event.target.value)} /></Field>
          {privileged && !storeScoped && <Field label="Cửa hàng"><Select aria-label="Cửa hàng" value={selectedStoreId} onChange={(event) => {
            setStoreSelection(event.target.value)
            setHistoryEmployeeId('')
          }}>{stores.map((store) => <option key={entityId(store)} value={entityId(store)}>{store.name}</option>)}</Select></Field>}
          {(!privileged || storeScoped) && <div className="compensation-fixed-scope" role="group" aria-label="Cửa hàng hiện tại"><span>Cửa hàng</span><strong>{storeName(stores, selectedStoreId)}</strong></div>}
        </div>
        <ActionError message={error} />
        {remoteDataStale && <InfoNote tone="red">
          Không thể cập nhật dữ liệu trực tiếp. {formattedLastRemoteSuccess
            ? `Đang hiển thị lần cập nhật gần nhất lúc ${formattedLastRemoteSuccess}; hệ thống sẽ tự thử lại.`
            : 'Hệ thống sẽ tự thử lại.'}
        </InfoNote>}
        {privileged && (openAttendanceAlert ? <div className="revenue-bonus-attendance-alert" role="alert">
          <Clock3 size={28} aria-hidden="true" />
          <div><strong>CHƯA THỂ TÍNH THƯỞNG NGÀY</strong><p>{eligibilityMessage}</p></div>
        </div> : <InfoNote tone={eligibilityTone}>{eligibilityMessage}</InfoNote>)}
      </Card>
      {privateAllocationView ? <div className="metric-grid compensation-metrics compensation-metrics--employee">
        <MetricCard compact label="TỔNG QUỸ CỦA TEAM" value={awaitingSavedResult ? 'Đang đồng bộ…' : money(poolTotal)} helper={liveDataLabel} icon={CircleDollarSign} tone="blue" />
        <MetricCard compact label="THƯỞNG DOANH THU CỦA TÔI" value={awaitingSavedResult ? 'Đang đồng bộ…' : money(allocationTotal)} helper={awaitingSavedResult ? 'Kết quả đã lưu đang được đồng bộ' : liveSnapshot ? 'Tạm tính theo giờ thực tế' : displayDate(businessDate)} icon={WalletCards} tone="green" />
        <MetricCard compact label="THỜI GIAN LÀM THỰC TẾ" value={formatWorkedHours(actualHours)} helper="Theo ca đã chấm công" icon={Clock3} tone="blue" />
        <MetricCard compact label="TỔNG GIỜ LÀM CỬA HÀNG" value={formatWorkedHours(totalStoreHours)} helper={`${attendanceCount} ca trong ngày`} icon={Clock3} tone="orange" />
      </div> : <div className="metric-grid compensation-metrics compensation-metrics--revenue-team">
        <MetricCard compact label="DOANH THU ĐỦ ĐIỀU KIỆN" value={awaitingSavedResult ? 'Đang đồng bộ…' : money(revenueTotal)} helper={liveDataLabel} icon={Store} tone="green" />
        <MetricCard compact label="TỔNG QUỸ THƯỞNG" value={awaitingSavedResult ? 'Đang đồng bộ…' : money(poolTotal)} helper={awaitingSavedResult ? 'Kết quả đã lưu đang được đồng bộ' : liveSnapshot ? 'Tạm tính theo doanh thu thực tế' : ''} icon={CircleDollarSign} tone="blue" />
        <MetricCard compact label="ĐÃ PHÂN BỔ" value={awaitingSavedResult ? 'Đang đồng bộ…' : money(allocatedTotal)} helper={liveSnapshot ? 'Tạm tính theo giờ thực tế' : ''} icon={WalletCards} tone="green" />
        <MetricCard compact label="CHƯA PHÂN BỔ" value={awaitingSavedResult ? 'Đang đồng bộ…' : money(unallocatedTotal)} helper={awaitingSavedResult ? 'Chờ dữ liệu đối soát' : unallocatedTotal > 0 ? 'Cần xử lý trước khi chốt sổ' : 'Đã đối soát'} icon={Clock3} tone={unallocatedTotal > 0 ? 'orange' : 'blue'} />
        <MetricCard compact label="TỔNG GIỜ LÀM CỬA HÀNG" value={formatWorkedHours(totalStoreHours)} helper={`${attendanceCount} ca trong ngày`} icon={Clock3} tone="orange" />
      </div>}
      <Card className="revenue-milestones-card" title={`Mốc thưởng doanh thu ${revenueProgram.id === REVENUE_BONUS_PROGRAM_IDS.SM_DAILY ? 'SM TNV' : 'Dosii'}`} action={<Badge tone={currentRevenueTier ? 'green' : awaitingSavedResult ? 'orange' : 'blue'}>{awaitingSavedResult ? 'Đang đồng bộ kết quả' : currentRevenueTier ? `Đang ở mốc ${currentRevenueTier.rateBasisPoints / 100}%` : 'Chưa đạt mốc'}</Badge>}>
        <div className="revenue-milestones-summary"><span>Doanh thu đã ghi nhận</span><strong>{awaitingSavedResult ? 'Đang đồng bộ…' : money(revenueTotal)}</strong></div>
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
      {unallocatedTotal > 0 && privileged && <InfoNote tone="orange">Có quỹ chưa phân bổ do thiếu giờ bán hàng được duyệt. Kỳ liên quan phải được xử lý trước khi đóng sổ.</InfoNote>}
      {privileged && <Card title="Duyệt thưởng mốc cao nhất" action={<Badge tone="orange">{milestoneClaims.filter((claim) => String(claim.status || '').toUpperCase() === 'PENDING').length} chờ duyệt</Badge>}>
        <TableWrap className="compensation-table">
          <thead><tr><th>Mốc thưởng</th><th>Ngày</th><th>Số tiền đề nghị</th><th>Trạng thái</th><th>Thao tác</th></tr></thead>
          <tbody>{milestoneClaims.map((claim) => {
            const pending = String(claim.status || '').toUpperCase() === 'PENDING'
            return <tr key={claim.id}>
              <td><strong>{claim.milestoneLabel || claim.milestoneId || claim.programId || 'Mốc cao nhất'}</strong><small className="compensation-subline">{claim.id}</small></td>
              <td>{displayDate(revenueRecordDate(claim))}</td>
              <td><strong>{money(Number(claim.amountVnd || 0))}</strong></td>
              <td><Badge tone={statusTone(claim)}>{statusLabel(claim)}</Badge></td>
              <td><div className="compensation-row-actions">
                {pending && <Button variant="outline" icon={CheckCircle2} loading={busyKey === `approve:${claim.id}`} disabled={Boolean(busyKey)} onClick={() => decideMilestone(claim, true)}>Duyệt</Button>}
                {pending && <Button variant="danger" icon={XCircle} loading={busyKey === `reject:${claim.id}`} disabled={Boolean(busyKey)} onClick={() => decideMilestone(claim, false)}>Từ chối</Button>}
                {!pending && <span>—</span>}
              </div></td>
            </tr>
          })}{!milestoneClaims.length && <tr><td colSpan="5" className="compensation-empty">Ngày này chưa có đề nghị thưởng mốc.</td></tr>}</tbody>
        </TableWrap>
      </Card>}
      <Card title={privateAllocationView ? 'Chi tiết thưởng của tôi' : 'Phân bổ theo nhân viên'} action={<Badge tone={liveSnapshot ? 'green' : 'blue'}>{liveSnapshot ? 'Dữ liệu trực tiếp' : `${allocations.length} dòng`}</Badge>}>
        <TableWrap className="compensation-table">
          <thead><tr>{!privateAllocationView && <th>Nhân viên</th>}<th>Cửa hàng</th><th>Ngày</th><th>Thời gian làm thực tế</th><th>Tỷ trọng</th><th>Thưởng được phân bổ</th><th>Trạng thái</th></tr></thead>
          <tbody>{allocations.map((allocation, index) => <tr key={allocation.id || `${entryEmployeeId(allocation)}-${index}`}>
            {!privateAllocationView && <td><strong>{employeeName(app.employees || [], entryEmployeeId(allocation), allocation.employeeName)}</strong><small className="compensation-subline">{entryEmployeeId(allocation)}</small></td>}
            <td>{storeName(stores, entryStoreId(allocation), allocation.storeName)}</td>
            <td>{displayDate(revenueRecordDate(allocation))}</td>
            <td>{Number(allocation.approvedSalesHours ?? allocation.workedHours ?? allocation.hours ?? 0).toFixed(2)} giờ</td>
            <td>{allocation.weightPercent != null ? `${Number(allocation.weightPercent).toFixed(2)}%` : allocation.weight != null ? `${(Number(allocation.weight) * 100).toFixed(2)}%` : '—'}</td>
            <td><strong>{money(allocationAmount(allocation))}</strong></td>
            <td><Badge tone={allocation.status === 'LIVE' ? 'blue' : statusTone(allocation)}>{allocation.status === 'LIVE' ? 'Tạm tính trực tiếp' : statusLabel(allocation)}</Badge></td>
          </tr>)}{!allocations.length && <tr><td colSpan={privateAllocationView ? 6 : 7} className="compensation-empty">{awaitingSavedResult ? 'Đang đồng bộ phân bổ thưởng đã lưu.' : 'Chưa có phân bổ thưởng doanh thu cho ngày đã chọn.'}</td></tr>}</tbody>
        </TableWrap>
      </Card>
      <RevenueHistorySections
        collisions={historyProjection.collisions}
        currentEmployeeName={employeeName(app.employees || [], currentEmployeeId)}
        employeeCollisions={historyProjection.employeeCollisions || []}
        employeeOptions={historyEmployeeOptions}
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
        stores={stores}
      />
      {!privateAllocationView && <Card title="Lịch sử tính quỹ trong ngày">
        <TableWrap className="compensation-table"><thead><tr><th>Mã tính</th><th>Chương trình</th><th>Doanh thu</th><th>Quỹ tỷ lệ</th><th>Thưởng mốc cao nhất</th><th>Tổng quỹ</th><th>Trạng thái</th></tr></thead><tbody>{records.map((record) => <tr key={record.id}><td>{record.id}</td><td>{record.programLabel || record.programId || '—'}</td><td>{money(recordRevenue(record))}</td><td>{money(record.percentagePoolVnd || 0)}</td><td>{money(record.milestonePoolVnd || record.hotPoolVnd || 0)}</td><td><strong>{money(revenueRecordTotal(record))}</strong></td><td><Badge tone={statusTone(record)}>{statusLabel(record)}</Badge></td></tr>)}{!records.length && <tr><td colSpan="7" className="compensation-empty">Chưa tính quỹ thưởng cho ngày này.</td></tr>}</tbody></TableWrap>
      </Card>}
    </div>
  )
}
