import { useMemo, useState } from 'react'
import { Calculator, Check, CheckCircle2, CircleDollarSign, Clock3, Store, Timer, TrendingUp, WalletCards, XCircle } from 'lucide-react'
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
import { money } from '../../utils'
import {
  calculateRevenueBonus,
  REVENUE_BONUS_PROGRAMS,
  revenueBonusProgramsForStore,
} from '../../domain/compensationPolicies'
import {
  canonicalRole,
  entityId,
  entryEmployeeId,
  entryStoreId,
  revenueAllocations,
  revenueRecordDate,
  revenueRecordTotal,
  operationalStores,
  statusLabel,
  statusTone,
  storesVisibleToRole,
} from './compensationViewModel'
import {
  AccessDenied,
  ActionError,
  displayDate,
  displayDateTime,
  employeeName,
  storeName,
  useCompensationAction,
  vietnamToday,
} from './compensationUi'
import './compensation-page.css'

const allocationAmount = (allocation) => Number(
  allocation?.allocatedVnd ?? allocation?.amountVnd ?? allocation?.amount ?? allocation?.bonusVnd ?? 0,
) || 0

const allocationApprovedHours = (allocation = {}) => {
  const explicitHours = Number(allocation.approvedSalesHours ?? allocation.workedHours ?? allocation.hours)
  if (Number.isFinite(explicitHours) && explicitHours >= 0) return explicitHours
  const weightUnits = Number(allocation.weightUnits ?? allocation.approvedSalesSeconds)
  return Number.isFinite(weightUnits) && weightUnits >= 0 ? weightUnits / 3_600 : 0
}

const allocationWeightPercent = (allocation = {}) => {
  const explicitPercent = Number(allocation.weightPercent)
  if (allocation.weightPercent != null && Number.isFinite(explicitPercent)) return explicitPercent
  const legacyWeight = Number(allocation.weight)
  if (allocation.weight != null && Number.isFinite(legacyWeight)) return legacyWeight * 100
  const weightUnits = Number(allocation.weightUnits ?? allocation.approvedSalesSeconds)
  const totalWeightUnits = Number(allocation.totalWeightUnits)
  return Number.isFinite(weightUnits) && weightUnits >= 0
    && Number.isFinite(totalWeightUnits) && totalWeightUnits > 0
    ? (weightUnits / totalWeightUnits) * 100
    : null
}

const recordRevenue = (record) => Number(record?.revenueVnd ?? record?.dailyRevenueVnd ?? record?.revenue ?? 0) || 0

const isZeroHourCandidate = (record = {}) => {
  const percentagePoolVnd = Number(record.percentagePoolVnd || 0)
  const totalPoolVnd = Number(record.totalPoolVnd || 0)
  const unallocatedVnd = Number(record.unallocatedVnd || 0)
  return percentagePoolVnd > 0
    && percentagePoolVnd === totalPoolVnd
    && totalPoolVnd === unallocatedVnd
    && Number(record.allocatedVnd || 0) === 0
    && Number(record.milestonePoolVnd || 0) === 0
    && Number(record.participantCount || 0) === 0
}

const vietnamDateFromTimestamp = (value) => {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return String(value || '').slice(0, 10)
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(parsed).map(({ type, value: partValue }) => [type, partValue]))
  return `${parts.year}-${parts.month}-${parts.day}`
}

// Keep this aligned with the server's dateFromRecord helper because stale
// calculation checks must group orders and attendance into the same VN day.
const operationalDate = (record = {}) => {
  const businessDate = String(record.workDate || record.attendanceDate || record.date || '').trim()
  if (/^\d{4}-\d{2}-\d{2}$/u.test(businessDate)) return businessDate
  const source = String(record.occurredAt || record.createdAt || '').trim()
  if (/^\d{4}-\d{2}-\d{2}$/u.test(source)) return source
  return vietnamDateFromTimestamp(source)
}

const identifiers = (...values) => new Set(values
  .flat()
  .map((value) => String(value ?? '').trim())
  .filter(Boolean))

const employeeIdentifiers = (employee = {}) => identifiers(
  employee?.id,
  employee?.code,
  employee?.employeeId,
  employee?.employee_id,
  employee?.employeeCode,
  employee?.linkedEmployeeId,
  employee?.sourceEmployeeId,
  employee?.rootEmployeeId,
  employee?.originalEmployeeId,
)

const attendanceEmployeeIdentifiers = (record = {}) => identifiers(
  record.employeeId,
  record.employee_id,
  record.employeeCode,
  record.targetEmployeeId,
  record.employee?.id,
  record.employee?.code,
  record.employee?.employeeId,
  record.employee?.employeeCode,
)

const attendanceSeconds = (record = {}, now = Date.now()) => {
  const closed = Boolean(record.checkOutAt || record.checkOut)
  const explicit = Number(record.approvedSalesSeconds ?? record.approvedSalesSec ?? record.workedSeconds)
  if (Number.isFinite(explicit) && explicit >= 0 && (explicit > 0 || closed)) return explicit
  const hours = Number(record.hours)
  if (Number.isFinite(hours) && hours >= 0 && (hours > 0 || closed)) return Math.round(hours * 3_600)
  const checkIn = Date.parse(record.checkInAt || '')
  const checkOut = Date.parse(record.checkOutAt || '')
  if (!Number.isFinite(checkIn)) return 0
  const end = Number.isFinite(checkOut) ? checkOut : now
  return Math.max(0, Math.min(24 * 3_600, Math.floor((end - checkIn) / 1_000)))
}

const tierReached = (tier, revenueVnd) => tier.minimumInclusive
  ? revenueVnd >= tier.minimumRevenueVnd
  : revenueVnd > tier.minimumRevenueVnd

const tierRangeLabel = (tier) => {
  const start = `${tier.minimumInclusive ? 'Từ' : 'Trên'} ${money(tier.minimumRevenueVnd)}`
  if (tier.maximumRevenueVnd == null) return start
  return `${start} đến ${money(tier.maximumRevenueVnd)}`
}

export function RevenueBonusPage() {
  const app = useApp()
  const role = canonicalRole(app.session?.role)
  const currentEmployeeIdentifiers = useMemo(() => identifiers(
    [...employeeIdentifiers(app.currentEmployee)],
    app.session?.employeeId,
    app.session?.code,
    app.session?.id,
  ), [app.currentEmployee, app.session?.employeeId, app.session?.code, app.session?.id])
  const currentStoreId = String(app.session?.storeId || app.currentEmployee?.storeId || '')
  const privileged = ['admin', 'business_support'].includes(role)
  const storeManager = role === 'store_manager'
  const employeeView = ['employee', 'office'].includes(role)
  const privateAllocationView = storeManager || employeeView
  const allowed = privileged || storeManager || employeeView
  const stores = useMemo(() => {
    const roleScopedStores = storesVisibleToRole(
      app.stores,
      privileged ? app.session : { ...app.session, storeId: currentStoreId },
    )
    if (privileged) {
      const reconciliationStoreIds = new Set((Array.isArray(app.revenueBonuses) ? app.revenueBonuses : [])
        // Projected daily rows are already role-scoped by the server. Keep any
        // non-deleted history selectable after a store closes, including fully
        // approved/rejected milestones and superseded audit rows.
        .filter((record) => !record.deletedAt)
        .map(entryStoreId)
        .filter(Boolean))
      for (const claim of Array.isArray(app.teamRewardClaims) ? app.teamRewardClaims : []) {
        if (!claim.deletedAt && entryStoreId(claim)) reconciliationStoreIds.add(entryStoreId(claim))
      }
      const historicalReconciliationStores = (Array.isArray(app.stores) ? app.stores : [])
        .filter((store) => reconciliationStoreIds.has(entityId(store)) && !store.deletedAt)
        .filter((store) => !['OFFICE', 'BUSINESS_SUPPORT', 'ADMIN', 'SYSTEM'].includes(entityId(store).toUpperCase()))
      return [...new Map([...roleScopedStores, ...historicalReconciliationStores]
        .map((store) => [entityId(store), store])).values()]
    }
    if (!privateAllocationView) return roleScopedStores
    const ownRevenueStoreIds = new Set([currentStoreId].filter(Boolean))
    for (const record of Array.isArray(app.revenueBonuses) ? app.revenueBonuses : []) {
      const hasOwnAllocation = revenueAllocations([record]).some((allocation) => (
        currentEmployeeIdentifiers.has(entryEmployeeId(allocation))
      ))
      if (hasOwnAllocation && entryStoreId(record)) ownRevenueStoreIds.add(entryStoreId(record))
    }
    return (Array.isArray(app.stores) ? app.stores : [])
      .filter((store) => !store.deletedAt && ownRevenueStoreIds.has(entityId(store)))
      .filter((store) => !['OFFICE', 'BUSINESS_SUPPORT', 'ADMIN', 'SYSTEM'].includes(entityId(store).toUpperCase()))
  }, [
    app.stores,
    app.session,
    app.revenueBonuses,
    app.teamRewardClaims,
    privileged,
    privateAllocationView,
    currentStoreId,
    currentEmployeeIdentifiers,
  ])
  const [storeSelection, setStoreSelection] = useState('')
  const activeOperationalStoreId = privileged && stores.some((store) => entityId(store) === String(app.activeStoreId || ''))
    ? String(app.activeStoreId)
    : ''
  const defaultPrivateStoreId = stores.some((store) => entityId(store) === currentStoreId)
    ? currentStoreId
    : entityId(stores[0])
  const validStoreSelection = stores.some((store) => entityId(store) === storeSelection)
    ? storeSelection
    : ''
  const selectedStoreId = validStoreSelection || activeOperationalStoreId || defaultPrivateStoreId || currentStoreId
  const [businessDate, setBusinessDate] = useState(vietnamToday)
  const [historyMode, setHistoryMode] = useState('day')
  const [historyDate, setHistoryDate] = useState(vietnamToday)
  const [historyMonth, setHistoryMonth] = useState(() => vietnamToday().slice(0, 7))
  const { busyKey, error, run } = useCompensationAction(app)
  const allRecords = Array.isArray(app.revenueBonuses) ? app.revenueBonuses : []
  const allActiveRecords = allRecords
    .filter((record) => !record.supersededAt && !record.voidedAt)
  const activeRecords = allActiveRecords
    .filter((record) => entryStoreId(record) === selectedStoreId)
  const records = activeRecords.filter((record) => revenueRecordDate(record) === businessDate)
  const milestoneClaims = (app.teamRewardClaims || [])
    .filter((claim) => !claim.deletedAt && !claim.voidedAt && !claim.supersededAt)
    .filter((claim) => entryStoreId(claim) === selectedStoreId && revenueRecordDate(claim) === businessDate)
    .sort((left, right) => String(right.createdAt || '').localeCompare(String(left.createdAt || '')))
  const allocations = revenueAllocations(records)
    .filter((allocation) => entryStoreId(allocation) === selectedStoreId && revenueRecordDate(allocation) === businessDate)
    .filter((allocation) => !privateAllocationView || currentEmployeeIdentifiers.has(entryEmployeeId(allocation)))
  const poolTotal = records.reduce((sum, record) => sum + revenueRecordTotal(record), 0)
  const revenueTotal = records.reduce((sum, record) => sum + recordRevenue(record), 0)
  const allocationTotal = allocations.reduce((sum, allocation) => sum + allocationAmount(allocation), 0)
  const unallocatedTotal = records.reduce((sum, record) => sum + Number(record?.unallocatedVnd || 0), 0)
  const activeStore = stores.find((store) => entityId(store) === selectedStoreId) || {}
  const activeStoreOperational = operationalStores([activeStore]).length > 0
  const knownEmployeeIdentifiers = useMemo(() => new Set([
    ...(Array.isArray(app.employees) ? app.employees : []),
    ...(Array.isArray(app.deletedEmployees) ? app.deletedEmployees : []),
  ].flatMap((employee) => [...employeeIdentifiers(employee)])), [app.employees, app.deletedEmployees])
  const reconciliationBlockedDays = useMemo(() => new Set(
    (Array.isArray(app.attendance) ? app.attendance : [])
      .filter((attendance) => !attendance.deletedAt)
      .filter((attendance) => (
        !attendance.checkOutAt && !attendance.checkOut
        || (knownEmployeeIdentifiers.has(String(attendance.employeeId || '').trim())
          && Math.max(0, Math.trunc(Number(
            attendance.approvedSalesSeconds ?? attendance.workedSeconds ?? 0,
          ))) > 0)
      ))
      .map((attendance) => `${entryStoreId(attendance)}:${operationalDate(attendance)}`),
  ), [app.attendance, knownEmployeeIdentifiers])
  const hasCurrentEligibleAttendance = (record) => reconciliationBlockedDays.has(
    `${entryStoreId(record)}:${revenueRecordDate(record)}`,
  )
  const orderRevenueByDay = useMemo(() => {
    if (!Array.isArray(app.orders)) return null
    const totals = new Map()
    for (const order of app.orders) {
      const amountVnd = Number(order.amount)
      if (order.deletedAt || String(order.status || '') === 'Đã xóa'
        || !Number.isSafeInteger(amountVnd) || amountVnd < 0) continue
      const key = `${entryStoreId(order)}:${operationalDate(order)}`
      const totalVnd = (totals.get(key) || 0) + amountVnd
      totals.set(key, Number.isSafeInteger(totalVnd) ? totalVnd : Number.NaN)
    }
    return totals
  }, [app.orders])
  const recordCalculationIsCurrent = (record) => {
    if (!orderRevenueByDay) return true
    const revenueKey = `${entryStoreId(record)}:${revenueRecordDate(record)}`
    const currentRevenueVnd = orderRevenueByDay.has(revenueKey) ? orderRevenueByDay.get(revenueKey) : 0
    if (!Number.isSafeInteger(currentRevenueVnd) || currentRevenueVnd < 0) return false
    const recordStore = (Array.isArray(app.stores) ? app.stores : [])
      .find((store) => entityId(store) === entryStoreId(record)) || {}
    const { programId: currentProgramId, milestoneProgramId: currentMilestoneProgramId } = revenueBonusProgramsForStore(recordStore)
    const currentPercentage = calculateRevenueBonus({ programId: currentProgramId, revenueVnd: currentRevenueVnd })
    const qualifiedPercentagePoolVnd = Number(record.unallocatedResolutionCode === 'NO_ELIGIBLE_HOURS'
      ? record.qualifiedPercentagePoolVnd
      : record.percentagePoolVnd)
    return recordRevenue(record) === currentRevenueVnd
      && String(record.programId || '') === currentProgramId
      && String(record.milestoneProgramId || '') === currentMilestoneProgramId
      && String(record.tierId || '') === String(currentPercentage.tierId || '')
      && Number(record.rateBasisPoints || 0) === Number(currentPercentage.rateBasisPoints || 0)
      && qualifiedPercentagePoolVnd === Number(currentPercentage.bonusVnd || 0)
  }
  const zeroHourCandidates = records.filter(isZeroHourCandidate)
  const reconciliationRecordIsStale = (record) => (
    hasCurrentEligibleAttendance(record) || !recordCalculationIsCurrent(record)
  )
  const zeroHourRecords = zeroHourCandidates.filter((record) => !reconciliationRecordIsStale(record))
  const resolvedRecordsRequiringRecalculation = records.filter((record) => (
    record.unallocatedResolutionCode === 'NO_ELIGIBLE_HOURS'
    && reconciliationRecordIsStale(record)
  ))
  const recalculationRequiredRecords = [
    ...zeroHourCandidates.filter(reconciliationRecordIsStale),
    ...resolvedRecordsRequiringRecalculation,
  ]
  const historicalPendingZeroHourRecords = activeRecords
    .filter(isZeroHourCandidate)
    .filter((record) => revenueRecordDate(record) !== businessDate)
    .sort((left, right) => revenueRecordDate(right).localeCompare(revenueRecordDate(left)))
  const historicalPendingMilestoneClaims = (Array.isArray(app.teamRewardClaims) ? app.teamRewardClaims : [])
    .filter((claim) => !claim.deletedAt && !claim.voidedAt && !claim.supersededAt)
    .filter((claim) => entryStoreId(claim) === selectedStoreId)
    .filter((claim) => String(claim.status || '').toUpperCase() === 'PENDING' && Number(claim.amountVnd || 0) > 0)
    .filter((claim) => revenueRecordDate(claim) && revenueRecordDate(claim) !== businessDate)
  const historicalReconciliationRows = [
    ...historicalPendingZeroHourRecords.map((record) => ({
      id: `zero-hour:${record.id}`,
      date: revenueRecordDate(record),
      label: 'Quỹ 0 giờ chưa phân bổ',
      amountVnd: Number(record.unallocatedVnd || 0),
    })),
    ...historicalPendingMilestoneClaims.map((claim) => ({
      id: `milestone:${claim.id}`,
      date: revenueRecordDate(claim),
      label: 'Thưởng mốc chờ duyệt',
      amountVnd: Number(claim.amountVnd || 0),
    })),
  ].sort((left, right) => right.date.localeCompare(left.date))
  const zeroHourResolutionRecords = allRecords
    .filter((record) => entryStoreId(record) === selectedStoreId)
    .filter((record) => record.unallocatedResolutionCode === 'NO_ELIGIBLE_HOURS')
    .sort((left, right) => String(right.unallocatedResolvedAt || '').localeCompare(String(left.unallocatedResolvedAt || '')))
  const dailyRevenueCollectionAvailable = Array.isArray(app.storeDailyRevenue)
  const aggregateRevenue = (dailyRevenueCollectionAvailable ? app.storeDailyRevenue : []).find((record) => (
    entryStoreId(record) === selectedStoreId && revenueRecordDate(record) === businessDate
  ))
  const selectedRevenueKey = `${selectedStoreId}:${businessDate}`
  const selectedOrderRevenue = orderRevenueByDay?.has(selectedRevenueKey)
    ? orderRevenueByDay.get(selectedRevenueKey)
    : 0
  const orderRevenue = Number.isSafeInteger(selectedOrderRevenue) && selectedOrderRevenue >= 0
    ? selectedOrderRevenue
    : 0
  const fallbackRevenueVnd = privileged || storeManager ? orderRevenue : revenueTotal || orderRevenue
  const liveRevenueVnd = Number(dailyRevenueCollectionAvailable
    ? aggregateRevenue?.revenueVnd ?? 0
    : fallbackRevenueVnd) || 0
  const ownDailySeconds = (app.attendance || []).filter((record) => (
    [...attendanceEmployeeIdentifiers(record)].some((identifier) => currentEmployeeIdentifiers.has(identifier))
    && entryStoreId(record) === selectedStoreId
    && operationalDate(record) === businessDate
    && !record.deletedAt
  )).reduce((sum, record) => sum + attendanceSeconds(record), 0)
  const ownDailyHours = ownDailySeconds / 3_600
  const { programId } = revenueBonusProgramsForStore(activeStore)
  const revenueProgram = REVENUE_BONUS_PROGRAMS[programId]
  const reachedTiers = revenueProgram.tiers.filter((tier) => tierReached(tier, liveRevenueVnd))
  const highestReachedTier = reachedTiers.at(-1) || null
  const historyRecords = (privateAllocationView ? allActiveRecords : activeRecords).filter((record) => historyMode === 'month'
    ? revenueRecordDate(record).startsWith(historyMonth)
    : revenueRecordDate(record) === historyDate)
  const historyAllocations = revenueAllocations(historyRecords)
    .filter((allocation) => !privateAllocationView || currentEmployeeIdentifiers.has(entryEmployeeId(allocation)))
    .sort((left, right) => revenueRecordDate(right).localeCompare(revenueRecordDate(left)))
  const historyTotal = historyAllocations.reduce((sum, allocation) => sum + allocationAmount(allocation), 0)

  if (!allowed || !selectedStoreId) return <AccessDenied subtitle="Tài khoản này không có phạm vi cửa hàng để xem thưởng doanh thu." />

  const calculate = () => run({
    key: 'calculate',
    action: app.calculateRevenueBonusDay,
    payload: { storeId: selectedStoreId, businessDate },
    success: `Đã tính thưởng doanh thu ngày ${displayDate(businessDate)}.`,
    unavailable: 'Chức năng tính thưởng doanh thu đang được đồng bộ với máy chủ. Dữ liệu đã tính trước đó vẫn được giữ nguyên.',
  })

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

  const resolveZeroHourPool = (record) => {
    if (typeof window === 'undefined') return
    const reason = String(window.prompt(
      `Nhập lý do xác nhận ${money(record.unallocatedVnd || 0)} không có giờ bán hàng đủ điều kiện:`,
      '',
    ) || '').trim()
    if (!reason) return
    if (reason.length < 10) {
      window.alert('Lý do cần có ít nhất 10 ký tự.')
      return
    }
    if (reason.length > 500) {
      window.alert('Lý do không được vượt quá 500 ký tự.')
      return
    }
    if (!window.confirm('Xác nhận không phân bổ quỹ này? Quyết định và số tiền gốc sẽ được lưu để đối soát.')) return
    run({
      key: `resolve-zero-hour:${record.id}`,
      action: app.resolveRevenueBonusZeroHourPool,
      payload: {
        revenueBonusDailyId: record.id,
        expectedVersion: record.version,
        resolution: 'NO_ELIGIBLE_HOURS',
        reason,
      },
      success: 'Đã xác nhận quỹ không có giờ đủ điều kiện và lưu lịch sử đối soát.',
      unavailable: 'Chức năng xử lý quỹ chưa phân bổ đang được đồng bộ với máy chủ.',
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
        actions={privileged && (activeStoreOperational || records.length > 0) && <Button icon={Calculator} loading={busyKey === 'calculate'} disabled={Boolean(busyKey)} onClick={calculate}>TÍNH THƯỞNG NGÀY</Button>}
      />
      <Card className="compensation-filter-card">
        <div className="compensation-filter-grid">
          <Field label="Ngày kinh doanh"><Input aria-label="Ngày kinh doanh" type="date" value={businessDate} onChange={(event) => setBusinessDate(event.target.value)} /></Field>
          {privileged && <Field label="Cửa hàng"><Select aria-label="Cửa hàng" value={selectedStoreId} onChange={(event) => setStoreSelection(event.target.value)}>{stores.map((store) => <option key={entityId(store)} value={entityId(store)}>{store.name}</option>)}</Select></Field>}
          {!privileged && <div className="compensation-fixed-scope"><span>Phạm vi cửa hàng</span><strong>{storeName(stores, selectedStoreId)}</strong></div>}
        </div>
        <ActionError message={error} />
      </Card>
      {privateAllocationView ? <div className="metric-grid compensation-metrics compensation-metrics--employee">
        <MetricCard compact label="TỔNG GIỜ LÀM CỦA TÔI" value={`${ownDailyHours.toFixed(2)} giờ`} helper={displayDate(businessDate)} icon={Timer} tone="blue" />
        <MetricCard compact label="DOANH THU CỬA HÀNG TRONG NGÀY" value={money(liveRevenueVnd)} helper={`${Number(aggregateRevenue?.orderCount || 0)} đơn hợp lệ`} icon={TrendingUp} tone="green" />
        <MetricCard compact label="TỔNG QUỸ CỦA TEAM" value={money(poolTotal)} helper={displayDate(businessDate)} icon={CircleDollarSign} tone="blue" />
        <MetricCard compact label="THƯỞNG DOANH THU CỦA TÔI" value={money(allocationTotal)} helper={displayDate(businessDate)} icon={WalletCards} tone="green" />
      </div> : <div className="metric-grid compensation-metrics">
        <MetricCard compact label="DOANH THU ĐỦ ĐIỀU KIỆN" value={money(revenueTotal)} icon={Store} tone="green" />
        <MetricCard compact label="TỔNG QUỸ THƯỞNG" value={money(poolTotal)} icon={CircleDollarSign} tone="blue" />
        <MetricCard compact label="ĐÃ PHÂN BỔ" value={money(allocationTotal)} icon={WalletCards} tone="green" />
        <MetricCard compact label="CHƯA PHÂN BỔ" value={money(unallocatedTotal)} helper={unallocatedTotal > 0 ? 'Cần xử lý trước khi chốt sổ' : 'Đã đối soát'} icon={Clock3} tone={unallocatedTotal > 0 ? 'orange' : 'blue'} />
      </div>}
      {privateAllocationView && <Card title="Mốc thưởng doanh thu" action={<Badge tone={highestReachedTier ? 'green' : 'orange'}>{highestReachedTier ? `${highestReachedTier.rateBasisPoints / 100}% đang áp dụng` : 'Chưa đạt mốc'}</Badge>}>
        <div className="revenue-tier-list">
          {revenueProgram.tiers.map((tier, index) => {
            const reached = reachedTiers.some((record) => record.id === tier.id)
            const highest = highestReachedTier?.id === tier.id
            return <div key={tier.id} className={`revenue-tier${reached ? ' is-reached' : ''}${highest ? ' is-highest' : ''}`}>
              <span className="revenue-tier__check" aria-hidden="true">{reached ? <Check size={17} /> : index + 1}</span>
              <span className="revenue-tier__copy"><strong>Mốc {index + 1} · {tier.rateBasisPoints / 100}% doanh thu</strong><small>{tierRangeLabel(tier)}</small></span>
              <Badge tone={highest ? 'green' : reached ? 'blue' : 'orange'}>{highest ? 'Mốc cao nhất được tính' : reached ? 'Đã đạt' : 'Chưa đạt'}</Badge>
            </div>
          })}
        </div>
        <InfoNote>Doanh thu được cập nhật từ đơn hàng hợp lệ. Các mốc đã vượt qua đều được đánh dấu; hệ thống chỉ dùng mốc cao nhất để tính thưởng.</InfoNote>
      </Card>}
      {unallocatedTotal > 0 && privileged && <InfoNote tone="orange">Có quỹ chưa phân bổ do thiếu giờ bán hàng được duyệt. Kỳ liên quan phải được xử lý trước khi đóng sổ.</InfoNote>}
      {privileged && historicalReconciliationRows.length > 0 && <Card title="Ngày có đối soát chờ xử lý" action={<Badge tone="orange">{historicalReconciliationRows.length} chờ xử lý</Badge>}>
        <TableWrap className="compensation-table">
          <thead><tr><th>Ngày</th><th>Nội dung</th><th>Số tiền</th><th>Thao tác</th></tr></thead>
          <tbody>{historicalReconciliationRows.map((row) => <tr key={row.id}>
            <td>{displayDate(row.date)}</td>
            <td>{row.label}</td>
            <td><strong>{money(row.amountVnd)}</strong></td>
            <td><Button variant="outline" onClick={() => setBusinessDate(row.date)}>XEM NGÀY</Button></td>
          </tr>)}</tbody>
        </TableWrap>
      </Card>}
      {privileged && recalculationRequiredRecords.length > 0 && <InfoNote tone="orange">Doanh thu, chính sách thưởng hoặc giờ bán hàng của ngày này đã thay đổi. Hãy hoàn tất chấm công và bấm TÍNH THƯỞNG NGÀY trước khi xử lý quỹ.</InfoNote>}
      {privileged && zeroHourRecords.length > 0 && <Card title="Xử lý quỹ không có giờ đủ điều kiện" action={<Badge tone="orange">{zeroHourRecords.length} chờ xử lý</Badge>}>
        <TableWrap className="compensation-table">
          <thead><tr><th>Ngày</th><th>Quỹ chưa phân bổ</th><th>Điều kiện</th><th>Thao tác</th></tr></thead>
          <tbody>{zeroHourRecords.map((record) => <tr key={record.id}>
            <td>{displayDate(revenueRecordDate(record))}</td>
            <td><strong>{money(record.unallocatedVnd || 0)}</strong></td>
            <td>0 giờ bán hàng được duyệt</td>
            <td><Button variant="outline" loading={busyKey === `resolve-zero-hour:${record.id}`} disabled={Boolean(busyKey)} onClick={() => resolveZeroHourPool(record)}>XÁC NHẬN KHÔNG CÓ GIỜ ĐỦ ĐIỀU KIỆN</Button></td>
          </tr>)}</tbody>
        </TableWrap>
        <InfoNote>Hệ thống giữ nguyên quỹ đủ điều kiện ban đầu, lý do và người xác nhận trong lịch sử đối soát. Nếu đã có giờ hợp lệ, hãy tính lại thay vì xác nhận.</InfoNote>
      </Card>}
      {privileged && zeroHourResolutionRecords.length > 0 && <Card title="Lịch sử xử lý quỹ 0 giờ" action={<Badge tone="green">{zeroHourResolutionRecords.length} bản ghi</Badge>}>
        <TableWrap className="compensation-table">
          <thead><tr><th>Ngày</th><th>Quỹ gốc không phân bổ</th><th>Lý do</th><th>Người xác nhận</th><th>Thời gian</th></tr></thead>
          <tbody>{zeroHourResolutionRecords.map((record) => <tr key={`zero-hour-history:${record.id}`}>
            <td>{displayDate(revenueRecordDate(record))}</td>
            <td><strong>{money(record.zeroHourUnawardedVnd || record.qualifiedPercentagePoolVnd || 0)}</strong></td>
            <td>{record.unallocatedResolutionReason || '—'}</td>
            <td>{record.unallocatedResolvedBy?.name || record.unallocatedResolvedBy?.displayName || record.unallocatedResolvedBy?.username || '—'}</td>
            <td>{displayDateTime(record.unallocatedResolvedAt)}</td>
          </tr>)}</tbody>
        </TableWrap>
      </Card>}
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
                {pending && activeStoreOperational && <Button variant="outline" icon={CheckCircle2} loading={busyKey === `approve:${claim.id}`} disabled={Boolean(busyKey)} onClick={() => decideMilestone(claim, true)}>Duyệt</Button>}
                {pending && <Button variant="danger" icon={XCircle} loading={busyKey === `reject:${claim.id}`} disabled={Boolean(busyKey)} onClick={() => decideMilestone(claim, false)}>Từ chối</Button>}
                {!pending && <span>—</span>}
              </div></td>
            </tr>
          })}{!milestoneClaims.length && <tr><td colSpan="5" className="compensation-empty">Ngày này chưa có đề nghị thưởng mốc.</td></tr>}</tbody>
        </TableWrap>
      </Card>}
      {privateAllocationView ? <Card title="Lịch sử nhận thưởng" action={<Badge tone="green">{money(historyTotal)}</Badge>}>
        <div className="compensation-history-filter">
          <Field label="Thống kê"><Select aria-label="Kiểu thống kê" value={historyMode} onChange={(event) => setHistoryMode(event.target.value)}><option value="day">Theo ngày</option><option value="month">Theo tháng</option></Select></Field>
          {historyMode === 'day'
            ? <Field label="Ngày"><Input aria-label="Ngày lịch sử" type="date" value={historyDate} onChange={(event) => setHistoryDate(event.target.value)} /></Field>
            : <Field label="Tháng"><Input aria-label="Tháng lịch sử" type="month" value={historyMonth} onChange={(event) => setHistoryMonth(event.target.value)} /></Field>}
        </div>
        <TableWrap className="compensation-table">
          <thead><tr><th>Ngày</th><th>Cửa hàng</th><th>Giờ được duyệt</th><th>Tỷ trọng</th><th>Thưởng nhận được</th><th>Trạng thái</th></tr></thead>
          <tbody>{historyAllocations.map((allocation, index) => <tr key={allocation.id || `${entryEmployeeId(allocation)}-${index}`}>
            <td><strong>{displayDate(revenueRecordDate(allocation))}</strong></td>
            <td>{storeName(stores, entryStoreId(allocation), allocation.storeName)}</td>
            <td>{allocationApprovedHours(allocation).toFixed(2)} giờ</td>
            <td>{allocationWeightPercent(allocation) == null ? '—' : `${allocationWeightPercent(allocation).toFixed(2)}%`}</td>
            <td><strong>{money(allocationAmount(allocation))}</strong></td>
            <td><Badge tone={statusTone(allocation)}>{statusLabel(allocation)}</Badge></td>
          </tr>)}{!historyAllocations.length && <tr><td colSpan="6" className="compensation-empty">Chưa có thưởng trong thời gian đã chọn.</td></tr>}</tbody>
        </TableWrap>
      </Card> : <Card title="Phân bổ theo nhân viên" action={<Badge tone="blue">{allocations.length} dòng</Badge>}>
        <TableWrap className="compensation-table">
          <thead><tr>{!privateAllocationView && <th>Nhân viên</th>}<th>Cửa hàng</th><th>Ngày</th><th>Giờ bán hàng duyệt</th><th>Tỷ trọng</th><th>Thưởng được phân bổ</th><th>Trạng thái</th></tr></thead>
          <tbody>{allocations.map((allocation, index) => <tr key={allocation.id || `${entryEmployeeId(allocation)}-${index}`}>
            {!privateAllocationView && <td><strong>{employeeName(app.employees || [], entryEmployeeId(allocation), allocation.employeeName)}</strong><small className="compensation-subline">{entryEmployeeId(allocation)}</small></td>}
            <td>{storeName(stores, entryStoreId(allocation), allocation.storeName)}</td>
            <td>{displayDate(revenueRecordDate(allocation))}</td>
            <td>{allocationApprovedHours(allocation).toFixed(2)} giờ</td>
            <td>{allocationWeightPercent(allocation) == null ? '—' : `${allocationWeightPercent(allocation).toFixed(2)}%`}</td>
            <td><strong>{money(allocationAmount(allocation))}</strong></td>
            <td><Badge tone={statusTone(allocation)}>{statusLabel(allocation)}</Badge></td>
          </tr>)}{!allocations.length && <tr><td colSpan={privateAllocationView ? 6 : 7} className="compensation-empty">Chưa có phân bổ thưởng doanh thu cho ngày đã chọn.</td></tr>}</tbody>
        </TableWrap>
      </Card>}
      {!privateAllocationView && <Card title="Lịch sử tính quỹ trong ngày">
        <TableWrap className="compensation-table"><thead><tr><th>Mã tính</th><th>Chương trình</th><th>Doanh thu</th><th>Quỹ tỷ lệ</th><th>Thưởng mốc cao nhất</th><th>Tổng quỹ</th><th>Trạng thái</th></tr></thead><tbody>{records.map((record) => <tr key={record.id}><td>{record.id}</td><td>{record.programLabel || record.programId || '—'}</td><td>{money(recordRevenue(record))}</td><td>{money(record.percentagePoolVnd || 0)}</td><td>{money(record.milestonePoolVnd || record.hotPoolVnd || 0)}</td><td><strong>{money(revenueRecordTotal(record))}</strong></td><td><Badge tone={statusTone(record)}>{statusLabel(record)}</Badge></td></tr>)}{!records.length && <tr><td colSpan="7" className="compensation-empty">Chưa tính quỹ thưởng cho ngày này.</td></tr>}</tbody></TableWrap>
      </Card>}
    </div>
  )
}
