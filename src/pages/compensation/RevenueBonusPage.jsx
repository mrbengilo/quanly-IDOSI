import { useEffect, useMemo, useState } from 'react'
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
import { businessDate as toBusinessDate, money } from '../../utils'
import {
  canonicalRole,
  entityId,
  entryEmployeeId,
  entryStoreId,
  revenueAllocations,
  revenueRecordDate,
  revenueRecordTotal,
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
import { apiGetRevenueBonusLive } from '../../services/idosiApi'
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

const buildLocalLiveSnapshot = ({ app, storeId, selectedDate, programId, nowMs }) => {
  if (!Array.isArray(app.orders) || !Array.isArray(app.attendance)) return null
  const orders = app.orders.filter((order) => (
    String(order.storeId || '') === storeId
    && recordBusinessDate(order) === selectedDate
    && !order.deletedAt
    && String(order.status || '') !== 'Đã xóa'
    && Number.isSafeInteger(Number(order.amount))
    && Number(order.amount) >= 0
  ))
  const revenueVnd = orders.reduce((sum, order) => sum + Number(order.amount), 0)
  if (!Number.isSafeInteger(revenueVnd)) return null
  const percentage = calculateRevenueBonus({ programId, revenueVnd })
  const employeeById = new Map((Array.isArray(app.employees) ? app.employees : []).flatMap((employee) => (
    [employee.id, employee.code, employee.employeeId].filter(Boolean).map((id) => [String(id), employee])
  )))
  const weightByEmployee = new Map()
  let attendanceCount = 0
  let openAttendanceCount = 0
  const activeEmployeeIds = new Set()
  const projectOpenAttendance = selectedDate === vietnamToday()
  app.attendance.forEach((attendance) => {
    const employeeId = String(attendance.employeeId || '')
    if (!employeeId || (employeeById.size && !employeeById.has(employeeId))
      || String(attendance.storeId || '') !== storeId
      || recordBusinessDate(attendance) !== selectedDate
      || attendance.deletedAt) return
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

export function RevenueBonusPage() {
  const app = useApp()
  const role = canonicalRole(app.session?.role)
  const currentEmployeeId = entityId(app.currentEmployee) || String(app.session?.employeeId || '')
  const currentStoreId = String(app.session?.storeId || app.currentEmployee?.storeId || '')
  const privileged = ['admin', 'business_support'].includes(role)
  const storeManager = role === 'store_manager'
  const employeeView = ['employee', 'office'].includes(role)
  const privateAllocationView = storeManager || employeeView
  const allowed = privileged || storeManager || employeeView
  const stores = useMemo(() => storesVisibleToRole(
    app.stores,
    privileged ? app.session : { ...app.session, storeId: currentStoreId },
  ), [app.stores, app.session, privileged, currentStoreId])
  const [storeSelection, setStoreSelection] = useState('')
  const [nowMs, setNowMs] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 1_000)
    return () => window.clearInterval(timer)
  }, [])
  const activeOperationalStoreId = privileged && stores.some((store) => entityId(store) === String(app.activeStoreId || ''))
    ? String(app.activeStoreId)
    : ''
  const selectedStoreId = storeSelection || activeOperationalStoreId || entityId(stores[0]) || currentStoreId
  const [businessDate, setBusinessDate] = useState(vietnamToday)
  const [remoteLiveSnapshot, setRemoteLiveSnapshot] = useState(null)
  const { busyKey, error, run } = useCompensationAction(app)
  const records = (app.revenueBonuses || [])
    .filter((record) => entryStoreId(record) === selectedStoreId && revenueRecordDate(record) === businessDate)
    .filter((record) => !record.supersededAt && !record.voidedAt)
  const milestoneClaims = (app.teamRewardClaims || [])
    .filter((claim) => entryStoreId(claim) === selectedStoreId && revenueRecordDate(claim) === businessDate)
    .sort((left, right) => String(right.createdAt || '').localeCompare(String(left.createdAt || '')))
  const savedAllocations = revenueAllocations(records)
    .filter((allocation) => entryStoreId(allocation) === selectedStoreId && revenueRecordDate(allocation) === businessDate)
    .filter((allocation) => !privateAllocationView || entryEmployeeId(allocation) === currentEmployeeId)
  const savedPoolTotal = records.reduce((sum, record) => sum + revenueRecordTotal(record), 0)
  const savedRevenueTotal = records.reduce((sum, record) => sum + recordRevenue(record), 0)
  const savedAllocationTotal = savedAllocations.reduce((sum, allocation) => sum + allocationAmount(allocation), 0)
  const savedUnallocatedTotal = records.reduce((sum, record) => sum + Number(record?.unallocatedVnd || 0), 0)
  const savedMilestonePoolTotal = records.reduce((sum, record) => sum + Math.max(0, Number(record?.milestonePoolVnd || 0)), 0)
  const savedMilestoneAllocationByEmployee = new Map()
  for (const allocation of revenueAllocations(records)) {
    const employeeId = entryEmployeeId(allocation)
    const milestoneAmount = Math.max(0, Number(allocation?.milestonePoolVnd || 0))
    if (employeeId && milestoneAmount > 0) {
      savedMilestoneAllocationByEmployee.set(employeeId, (savedMilestoneAllocationByEmployee.get(employeeId) || 0) + milestoneAmount)
    }
  }
  const savedMilestoneAllocatedTotal = [...savedMilestoneAllocationByEmployee.values()].reduce((sum, amount) => sum + amount, 0)
  const savedMilestoneUnallocatedTotal = Math.max(0, savedMilestonePoolTotal - savedMilestoneAllocatedTotal)
  const selectedStore = stores.find((store) => entityId(store) === selectedStoreId) || null
  const selectedStoreIdentity = [selectedStore?.name, selectedStore?.short, selectedStore?.code]
    .filter(Boolean)
    .join(' ')
    .toLocaleLowerCase('vi-VN')
  const isSmStore = selectedStoreIdentity.includes('secondmall') || /(^|\s)sm($|\s)/u.test(selectedStoreIdentity)
  const revenueProgram = isSmStore
    ? REVENUE_BONUS_PROGRAMS[REVENUE_BONUS_PROGRAM_IDS.SM_DAILY]
    : REVENUE_BONUS_PROGRAMS[REVENUE_BONUS_PROGRAM_IDS.DOSII_DAILY]
  const localLiveSnapshot = useMemo(() => (
    privileged || storeManager || app.apiStatus === 'local'
      ? buildLocalLiveSnapshot({
          app,
          storeId: selectedStoreId,
          selectedDate: businessDate,
          programId: revenueProgram.id,
          nowMs,
        })
      : null
  ), [app, businessDate, nowMs, privileged, revenueProgram.id, selectedStoreId, storeManager])

  useEffect(() => {
    if (!selectedStoreId || !['connected', 'syncing'].includes(app.apiStatus)) return undefined
    let active = true
    let busy = false
    const refresh = async () => {
      if (busy || (typeof document !== 'undefined' && document.hidden)) return
      busy = true
      try {
        const response = await apiGetRevenueBonusLive({ storeId: selectedStoreId, businessDate })
        if (active) setRemoteLiveSnapshot(response?.snapshot || null)
      } catch {
        // Giữ số liệu gần nhất; chu kỳ kế tiếp sẽ tự thử lại.
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
  }, [app.apiStatus, businessDate, selectedStoreId])

  const matchingRemoteSnapshot = remoteLiveSnapshot
    && String(remoteLiveSnapshot.storeId || '') === selectedStoreId
    && String(remoteLiveSnapshot.businessDate || '') === businessDate
    ? remoteLiveSnapshot
    : null
  const liveSnapshot = matchingRemoteSnapshot || localLiveSnapshot
  const revenueTotal = Number(liveSnapshot?.revenueVnd ?? savedRevenueTotal) || 0
  const poolTotal = liveSnapshot
    ? (Number(liveSnapshot.percentagePoolVnd || 0) + savedMilestonePoolTotal)
    : savedPoolTotal
  const unallocatedTotal = liveSnapshot
    ? (Number(liveSnapshot.unallocatedVnd || 0) + savedMilestoneUnallocatedTotal)
    : savedUnallocatedTotal
  const visibleLiveAllocations = (Array.isArray(liveSnapshot?.allocations) ? liveSnapshot.allocations : [])
    .filter((allocation) => !privateAllocationView || entryEmployeeId(allocation) === currentEmployeeId)
    .map((allocation, index) => ({
      ...allocation,
      id: allocation.id || `live:${entryEmployeeId(allocation)}:${index}`,
      storeId: selectedStoreId,
      businessDate,
      approvedSalesHours: Number(allocation.workedSeconds || 0) / 3_600,
      milestonePoolVnd: savedMilestoneAllocationByEmployee.get(entryEmployeeId(allocation)) || 0,
      allocatedVnd: allocationAmount(allocation) + (savedMilestoneAllocationByEmployee.get(entryEmployeeId(allocation)) || 0),
    }))
  const allocations = liveSnapshot ? visibleLiveAllocations : savedAllocations
  const allocationTotal = liveSnapshot
    ? visibleLiveAllocations.reduce((sum, allocation) => sum + allocationAmount(allocation), 0)
    : savedAllocationTotal
  const allocatedTotal = liveSnapshot
    ? (Number(liveSnapshot.allocatedVnd || 0) + savedMilestoneAllocatedTotal)
    : savedAllocationTotal
  const currentRevenueTier = selectRevenueBonusTier({ programId: revenueProgram.id, revenueVnd: Math.max(0, Math.trunc(revenueTotal)) })
  const storeAttendance = (app.attendance || []).filter((attendance) => (
    !attendance.deletedAt
    && entryStoreId(attendance) === selectedStoreId
    && recordBusinessDate(attendance) === businessDate
  ))
  const localActualHours = storeAttendance
    .filter((attendance) => entryEmployeeId(attendance) === currentEmployeeId)
    .reduce((sum, attendance) => sum + liveWorkedHours(attendance, nowMs, businessDate === vietnamToday()), 0)
  const ownLiveAllocation = visibleLiveAllocations.find((allocation) => entryEmployeeId(allocation) === currentEmployeeId)
  const actualHours = ownLiveAllocation
    ? Math.max(Number(ownLiveAllocation.workedSeconds || 0) / 3_600, localActualHours)
    : localActualHours
  const projectedAtMs = Date.parse(liveSnapshot?.projectedAt || '')
  const liveExtraSeconds = Number.isFinite(projectedAtMs) && nowMs > projectedAtMs && businessDate === vietnamToday()
    ? Math.floor((nowMs - projectedAtMs) / 1_000) * Number(liveSnapshot?.openAttendanceCount || 0)
    : 0
  const totalStoreHours = liveSnapshot
    ? (Number(liveSnapshot.totalWorkedSeconds || 0) + liveExtraSeconds) / 3_600
    : storeAttendance.reduce((sum, attendance) => sum + liveWorkedHours(attendance, nowMs, businessDate === vietnamToday()), 0)
  const attendanceCount = Number(liveSnapshot?.attendanceCount ?? storeAttendance.length) || 0
  const liveDataLabel = liveSnapshot ? 'Tự cập nhật mỗi 5 giây' : displayDate(businessDate)

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

  return (
    <div className="page compensation-page revenue-bonus-page">
      <PageHeader
        title="THƯỞNG DOANH THU THEO NGÀY"
        subtitle={privateAllocationView
          ? 'Hiển thị tổng quỹ của cửa hàng và khoản thưởng của chính bạn; không hiển thị phần của đồng nghiệp.'
          : `Theo dõi quỹ và phân bổ thưởng theo giờ bán hàng được duyệt tại ${storeName(stores, selectedStoreId)}.`}
        icon={CircleDollarSign}
        actions={privileged && <Button icon={Calculator} loading={busyKey === 'calculate'} disabled={Boolean(busyKey)} onClick={calculate}>TÍNH THƯỞNG NGÀY</Button>}
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
        <MetricCard compact label="TỔNG QUỸ CỦA TEAM" value={money(poolTotal)} helper={liveDataLabel} icon={CircleDollarSign} tone="blue" />
        <MetricCard compact label="THƯỞNG DOANH THU CỦA TÔI" value={money(allocationTotal)} helper={liveSnapshot ? 'Tạm tính theo giờ thực tế' : displayDate(businessDate)} icon={WalletCards} tone="green" />
        <MetricCard compact label="THỜI GIAN LÀM THỰC TẾ" value={formatWorkedHours(actualHours)} helper="Theo ca đã chấm công" icon={Clock3} tone="blue" />
        <MetricCard compact label="TỔNG GIỜ LÀM CỬA HÀNG" value={formatWorkedHours(totalStoreHours)} helper={`${attendanceCount} ca trong ngày`} icon={Clock3} tone="orange" />
      </div> : <div className="metric-grid compensation-metrics">
        <MetricCard compact label="DOANH THU ĐỦ ĐIỀU KIỆN" value={money(revenueTotal)} helper={liveDataLabel} icon={Store} tone="green" />
        <MetricCard compact label="TỔNG QUỸ THƯỞNG" value={money(poolTotal)} helper={liveSnapshot ? 'Tạm tính theo doanh thu thực tế' : ''} icon={CircleDollarSign} tone="blue" />
        <MetricCard compact label="ĐÃ PHÂN BỔ" value={money(allocatedTotal)} helper={liveSnapshot ? 'Tạm tính theo giờ thực tế' : ''} icon={WalletCards} tone="green" />
        <MetricCard compact label="CHƯA PHÂN BỔ" value={money(unallocatedTotal)} helper={unallocatedTotal > 0 ? 'Cần xử lý trước khi chốt sổ' : 'Đã đối soát'} icon={Clock3} tone={unallocatedTotal > 0 ? 'orange' : 'blue'} />
      </div>}
      <Card className="revenue-milestones-card" title={`Mốc thưởng doanh thu ${revenueProgram.id === REVENUE_BONUS_PROGRAM_IDS.SM_DAILY ? 'SM TNV' : 'Dosii'}`} action={<Badge tone={currentRevenueTier ? 'green' : 'blue'}>{currentRevenueTier ? `Đang ở mốc ${currentRevenueTier.rateBasisPoints / 100}%` : 'Chưa đạt mốc'}</Badge>}>
        <div className="revenue-milestones-summary"><span>Doanh thu đã ghi nhận</span><strong>{money(revenueTotal)}</strong></div>
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
          </tr>)}{!allocations.length && <tr><td colSpan={privateAllocationView ? 6 : 7} className="compensation-empty">Chưa có phân bổ thưởng doanh thu cho ngày đã chọn.</td></tr>}</tbody>
        </TableWrap>
      </Card>
      {!privateAllocationView && <Card title="Lịch sử tính quỹ trong ngày">
        <TableWrap className="compensation-table"><thead><tr><th>Mã tính</th><th>Chương trình</th><th>Doanh thu</th><th>Quỹ tỷ lệ</th><th>Thưởng mốc cao nhất</th><th>Tổng quỹ</th><th>Trạng thái</th></tr></thead><tbody>{records.map((record) => <tr key={record.id}><td>{record.id}</td><td>{record.programLabel || record.programId || '—'}</td><td>{money(recordRevenue(record))}</td><td>{money(record.percentagePoolVnd || 0)}</td><td>{money(record.milestonePoolVnd || record.hotPoolVnd || 0)}</td><td><strong>{money(revenueRecordTotal(record))}</strong></td><td><Badge tone={statusTone(record)}>{statusLabel(record)}</Badge></td></tr>)}{!records.length && <tr><td colSpan="7" className="compensation-empty">Chưa tính quỹ thưởng cho ngày này.</td></tr>}</tbody></TableWrap>
      </Card>}
    </div>
  )
}
