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
  statusLabel,
  statusTone,
  storesVisibleToRole,
} from './compensationViewModel'
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

const operationalDate = (record = {}) => String(
  record.businessDate || record.workDate || record.attendanceDate || record.date || record.createdAt || '',
).slice(0, 10)

const attendanceSeconds = (record = {}, now = Date.now()) => {
  const explicit = Number(record.approvedSalesSeconds ?? record.approvedSalesSec ?? record.workedSeconds)
  if (Number.isFinite(explicit) && explicit >= 0 && (explicit > 0 || record.checkOutAt || record.checkOut)) return explicit
  const hours = Number(record.hours)
  if (Number.isFinite(hours) && hours >= 0) return Math.round(hours * 3_600)
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
  const activeOperationalStoreId = privileged && stores.some((store) => entityId(store) === String(app.activeStoreId || ''))
    ? String(app.activeStoreId)
    : ''
  const selectedStoreId = storeSelection || activeOperationalStoreId || entityId(stores[0]) || currentStoreId
  const [businessDate, setBusinessDate] = useState(vietnamToday)
  const [historyMode, setHistoryMode] = useState('day')
  const [historyDate, setHistoryDate] = useState(vietnamToday)
  const [historyMonth, setHistoryMonth] = useState(() => vietnamToday().slice(0, 7))
  const { busyKey, error, run } = useCompensationAction(app)
  const activeRecords = (app.revenueBonuses || [])
    .filter((record) => entryStoreId(record) === selectedStoreId)
    .filter((record) => !record.supersededAt && !record.voidedAt)
  const records = activeRecords.filter((record) => revenueRecordDate(record) === businessDate)
  const milestoneClaims = (app.teamRewardClaims || [])
    .filter((claim) => entryStoreId(claim) === selectedStoreId && revenueRecordDate(claim) === businessDate)
    .sort((left, right) => String(right.createdAt || '').localeCompare(String(left.createdAt || '')))
  const allocations = revenueAllocations(records)
    .filter((allocation) => entryStoreId(allocation) === selectedStoreId && revenueRecordDate(allocation) === businessDate)
    .filter((allocation) => !privateAllocationView || entryEmployeeId(allocation) === currentEmployeeId)
  const poolTotal = records.reduce((sum, record) => sum + revenueRecordTotal(record), 0)
  const revenueTotal = records.reduce((sum, record) => sum + recordRevenue(record), 0)
  const allocationTotal = allocations.reduce((sum, allocation) => sum + allocationAmount(allocation), 0)
  const unallocatedTotal = records.reduce((sum, record) => sum + Number(record?.unallocatedVnd || 0), 0)
  const activeStore = stores.find((store) => entityId(store) === selectedStoreId) || {}
  const aggregateRevenue = (app.storeDailyRevenue || []).find((record) => (
    entryStoreId(record) === selectedStoreId && revenueRecordDate(record) === businessDate
  ))
  const orderRevenue = (app.orders || []).filter((order) => (
    entryStoreId(order) === selectedStoreId
    && operationalDate(order) === businessDate
    && !order.deletedAt
    && String(order.status || '') !== 'Đã xóa'
  )).reduce((sum, order) => sum + (Number.isSafeInteger(Number(order.amount)) ? Number(order.amount) : 0), 0)
  const liveRevenueVnd = Number(aggregateRevenue?.revenueVnd ?? (privileged || storeManager
    ? orderRevenue
    : revenueTotal || orderRevenue)) || 0
  const ownDailySeconds = (app.attendance || []).filter((record) => (
    entryEmployeeId(record) === currentEmployeeId
    && entryStoreId(record) === selectedStoreId
    && operationalDate(record) === businessDate
    && !record.deletedAt
  )).reduce((sum, record) => sum + attendanceSeconds(record), 0)
  const ownDailyHours = ownDailySeconds / 3_600
  const { programId } = revenueBonusProgramsForStore(activeStore)
  const revenueProgram = REVENUE_BONUS_PROGRAMS[programId]
  const reachedTiers = revenueProgram.tiers.filter((tier) => tierReached(tier, liveRevenueVnd))
  const highestReachedTier = reachedTiers.at(-1) || null
  const historyRecords = activeRecords.filter((record) => historyMode === 'month'
    ? revenueRecordDate(record).startsWith(historyMonth)
    : revenueRecordDate(record) === historyDate)
  const historyAllocations = revenueAllocations(historyRecords)
    .filter((allocation) => !privateAllocationView || entryEmployeeId(allocation) === currentEmployeeId)
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
            <td>{Number(allocation.approvedSalesHours ?? allocation.workedHours ?? allocation.hours ?? 0).toFixed(2)} giờ</td>
            <td>{allocation.weightPercent != null ? `${Number(allocation.weightPercent).toFixed(2)}%` : allocation.weight != null ? `${(Number(allocation.weight) * 100).toFixed(2)}%` : '—'}</td>
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
            <td>{Number(allocation.approvedSalesHours ?? allocation.workedHours ?? allocation.hours ?? 0).toFixed(2)} giờ</td>
            <td>{allocation.weightPercent != null ? `${Number(allocation.weightPercent).toFixed(2)}%` : allocation.weight != null ? `${(Number(allocation.weight) * 100).toFixed(2)}%` : '—'}</td>
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
