import { useMemo, useState } from 'react'
import { Banknote, CircleDollarSign, History, RotateCcw } from 'lucide-react'
import { Badge, Card, Field, InfoNote, Input, MetricCard, PageHeader, Select, TableWrap } from '../../components/UI'
import { SupportEmployeeTag } from '../../components/SupportEmployeeTag'
import { resolveSupportEmployeeTagContext } from '../../domain/supportEmployeeTag'
import { useApp } from '../../state/AppContext'
import { money, operationalIdentifierRecordMatch } from '../../utils'
import { canonicalRole, entityId, operationalStores } from './compensationViewModel'
import { AccessDenied, displayDate, displayDateTime, storeName, vietnamToday } from './compensationUi'
import './compensation-page.css'

const REFUND_STATUS = Object.freeze({
  PENDING: 'PENDING_PAYROLL',
  RECOGNIZED: 'RECOGNIZED',
  VOID: 'VOID',
  UNKNOWN: 'UNKNOWN',
})

const text = (value) => String(value ?? '').trim()

const refundDate = (refund = {}) => text(refund.occurredOn || refund.createdAt).slice(0, 10)

const refundAmount = (refund = {}) => {
  const amount = Number(refund.amountVnd)
  return Number.isFinite(amount) ? amount : 0
}

const refundStatus = (refund = {}) => {
  const status = text(refund.status).toUpperCase()
  if (refund.voidedAt || ['VOID', 'VOIDED'].includes(status)) return REFUND_STATUS.VOID
  if (status === REFUND_STATUS.RECOGNIZED || (refund.recognized === true && !status)) return REFUND_STATUS.RECOGNIZED
  if (status === REFUND_STATUS.PENDING) return REFUND_STATUS.PENDING
  return REFUND_STATUS.UNKNOWN
}

const statusPresentation = (refund) => {
  const status = refundStatus(refund)
  if (status === REFUND_STATUS.RECOGNIZED) return { label: 'Đã cộng doanh thu', tone: 'green' }
  if (status === REFUND_STATUS.PENDING) return { label: 'Chờ quyết toán', tone: 'orange' }
  if (status === REFUND_STATUS.VOID) return { label: 'Đã hủy', tone: 'red' }
  return { label: 'Chưa xác định', tone: 'red' }
}

const refundTimestamp = (refund = {}) => {
  const value = text(refund.occurredOn || refund.createdAt)
  return value.includes('T') ? displayDateTime(value) : displayDate(value)
}

const shiftDescription = (refund = {}) => {
  const name = text(refund.shiftName)
  const start = text(refund.shiftStart)
  const end = text(refund.shiftEnd)
  const interval = start && end ? `${start} – ${end}` : start || end
  return [name, interval].filter(Boolean).join(' · ') || 'Không gắn ca làm'
}

const legacySupportEmployee = (refund, currentStoreId) => {
  const homeStoreId = text(refund.employeeHomeStoreId)
  return Boolean(
    refund.supportTransferId
    || (homeStoreId && homeStoreId !== currentStoreId)
    || (text(refund.supportStoreId) === currentStoreId && homeStoreId !== currentStoreId),
  )
}

const statusSubline = (refund) => {
  const status = refundStatus(refund)
  if (status === REFUND_STATUS.RECOGNIZED && refund.recognizedAt) return `Ghi nhận lúc ${displayDateTime(refund.recognizedAt)}`
  if (status === REFUND_STATUS.PENDING && refund.period) return `Kỳ lương ${refund.period}`
  if (status === REFUND_STATUS.VOID && refund.voidReason) return text(refund.voidReason)
  return ''
}

export function ViolationRefundPage() {
  const app = useApp()
  const role = canonicalRole(app.session?.role)
  const allowed = ['admin', 'business_support', 'store_manager'].includes(role)
  const storeReference = role === 'store_manager' ? app.session?.storeId : app.activeStoreId
  const stores = useMemo(() => operationalStores(Array.isArray(app.stores) ? app.stores : []), [app.stores])
  const storeResolution = useMemo(() => operationalIdentifierRecordMatch(
    stores,
    storeReference,
    (store) => [entityId(store)],
  ), [storeReference, stores])
  const selectedStore = storeResolution.record
  const selectedStoreId = entityId(selectedStore)
  const [historyDate, setHistoryDate] = useState('')
  const [historyMonth, setHistoryMonth] = useState(() => vietnamToday().slice(0, 7))
  const [historyEmployeeId, setHistoryEmployeeId] = useState('')

  const scopedRows = useMemo(() => (Array.isArray(app.violationRefunds) ? app.violationRefunds : [])
    .filter((refund) => text(refund.storeId) === selectedStoreId)
    .toSorted((left, right) => text(right.occurredOn || right.createdAt).localeCompare(text(left.occurredOn || left.createdAt))),
  [app.violationRefunds, selectedStoreId])

  const employeeOptions = useMemo(() => [...scopedRows.reduce((options, refund) => {
    const id = text(refund.employeeId)
    if (!id || options.has(id)) return options
    options.set(id, {
      id,
      name: text(refund.employeeName) || id,
      support: Boolean(resolveSupportEmployeeTagContext({
        record: refund,
        employeeId: refund.employeeId,
        storeId: selectedStoreId,
        businessDate: refundDate(refund),
        employees: app.employees,
        stores: app.stores,
        supportTransfers: app.supportTransfers,
      })),
    })
    return options
  }, new Map()).values()].toSorted((left, right) => left.name.localeCompare(right.name, 'vi-VN')), [app.employees, app.stores, app.supportTransfers, scopedRows, selectedStoreId])

  const filteredRows = useMemo(() => scopedRows.filter((refund) => {
    const date = refundDate(refund)
    return (!historyDate || date === historyDate)
      && (!historyMonth || date.startsWith(historyMonth))
      && (!historyEmployeeId || text(refund.employeeId) === historyEmployeeId)
  }), [historyDate, historyEmployeeId, historyMonth, scopedRows])

  const summary = useMemo(() => filteredRows.reduce((result, refund) => {
    const status = refundStatus(refund)
    if (status === REFUND_STATUS.RECOGNIZED) {
      result.recognizedVnd += refundAmount(refund)
      result.count += 1
    } else if (status === REFUND_STATUS.PENDING) {
      result.pendingVnd += refundAmount(refund)
      result.count += 1
    }
    return result
  }, { recognizedVnd: 0, pendingVnd: 0, count: 0 }), [filteredRows])

  if (!allowed) return <AccessDenied subtitle="Tài khoản này không có quyền xem hoàn trả vi phạm của cửa hàng." />

  if (!selectedStoreId) {
    return <div className="page compensation-page violation-refund-page">
      <PageHeader title="HOÀN TRẢ VI PHẠM" subtitle="Theo dõi các khoản hoàn trả được ghi nhận vào doanh thu cửa hàng." icon={RotateCcw} />
      <InfoNote tone="red">
        {storeResolution.ambiguous
          ? 'Mã cửa hàng hiện tại bị trùng. Hệ thống đã khóa dữ liệu để tránh hiển thị nhầm cửa hàng.'
          : 'Chưa xác định được cửa hàng hiện tại. Vui lòng chọn lại cửa hàng từ khu vực quản lý.'}
      </InfoNote>
    </div>
  }

  return <div className="page compensation-page violation-refund-page">
    <PageHeader
      title="HOÀN TRẢ VI PHẠM"
      subtitle="Lịch sử hoàn trả được ghi nhận đúng cửa hàng phát sinh và cộng vào doanh thu khi quyết toán."
      icon={RotateCcw}
    />

    <Card className="compensation-filter-card" title="Bộ lọc lịch sử hoàn trả">
      <div className="compensation-form-grid reward-history-filters">
        <div className="compensation-fixed-scope" role="group" aria-label="Cửa hàng hiện tại">
          <span>Cửa hàng</span>
          <strong>{selectedStore.name || selectedStore.short || selectedStoreId}</strong>
        </div>
        <Field label="Ngày phát sinh">
          <Input aria-label="Ngày hoàn trả vi phạm" type="date" value={historyDate} onChange={(event) => {
            const date = event.target.value
            setHistoryDate(date)
            if (date) setHistoryMonth(date.slice(0, 7))
          }} />
        </Field>
        <Field label="Tháng phát sinh">
          <Input aria-label="Tháng hoàn trả vi phạm" type="month" value={historyMonth} onChange={(event) => {
            const month = event.target.value
            setHistoryMonth(month)
            if (historyDate && !historyDate.startsWith(month)) setHistoryDate('')
          }} />
        </Field>
        <Field label="Nhân viên">
          <Select aria-label="Nhân viên được hoàn trả vi phạm" value={historyEmployeeId} onChange={(event) => setHistoryEmployeeId(event.target.value)}>
            <option value="">Tất cả nhân viên</option>
            {employeeOptions.map((employee) => <option key={employee.id} value={employee.id}>
              {employee.name}{employee.support ? ' (hỗ trợ)' : ''}
            </option>)}
          </Select>
        </Field>
      </div>
    </Card>

    <div className="metrics-grid metrics-grid--3" aria-label="Tổng quan hoàn trả vi phạm">
      <MetricCard label="TỔNG ĐÃ CỘNG DOANH THU" value={money(summary.recognizedVnd)} helper="Chỉ gồm khoản đã quyết toán" icon={CircleDollarSign} tone="green" />
      <MetricCard label="CHỜ QUYẾT TOÁN" value={money(summary.pendingVnd)} helper="Chưa cộng vào doanh thu" icon={Banknote} tone="orange" />
      <MetricCard label="SỐ LƯỢT HOÀN TRẢ" value={summary.count} helper="Không bao gồm bản ghi đã hủy" icon={History} tone="blue" />
    </div>

    <InfoNote>
      Nhân viên hỗ trợ bị ghi nhận vi phạm tại cửa hàng nào thì khoản hoàn trả được ghi nhận cho cửa hàng đó. Chỉ trạng thái <strong>“Đã cộng doanh thu”</strong> được tính vào tổng doanh thu.
    </InfoNote>

    <Card title="Lịch sử hoàn trả vi phạm" action={<Badge tone="blue">Tổng đã cộng: {money(summary.recognizedVnd)}</Badge>}>
      <TableWrap className="compensation-table">
        <thead><tr><th>Thời gian</th><th>Nhân viên</th><th>Nội dung vi phạm</th><th>Số tiền hoàn trả</th><th>Trạng thái</th></tr></thead>
        <tbody>{filteredRows.map((refund, index) => {
          const presentation = statusPresentation(refund)
          const supportContext = resolveSupportEmployeeTagContext({
            record: refund,
            employeeId: refund.employeeId,
            storeId: selectedStoreId,
            businessDate: refundDate(refund),
            employees: app.employees,
            stores: app.stores,
            supportTransfers: app.supportTransfers,
          })
          const historicalSupport = legacySupportEmployee(refund, selectedStoreId)
          const subline = statusSubline(refund)
          return <tr key={refund.id || refund.sourceId || `${refundDate(refund)}-${refund.employeeId}-${index}`}>
            <td><strong>{refundTimestamp(refund)}</strong><small className="compensation-subline">{shiftDescription(refund)}</small></td>
            <td>
              <strong>{refund.employeeName || refund.employeeId || '—'}</strong>
              <small className="compensation-subline">{refund.employeeId || '—'}</small>
              {supportContext ? <SupportEmployeeTag context={supportContext} /> : !historicalSupport ? <Badge tone="green">Nhân viên chính</Badge> : null}
            </td>
            <td><strong>{refund.title || refund.policyCode || 'Vi phạm'}</strong><small className="compensation-subline">{refund.policyCode || ''}</small></td>
            <td><strong className={refundStatus(refund) === REFUND_STATUS.VOID ? 'compensation-debit' : 'compensation-credit'}>{money(refundAmount(refund))}</strong></td>
            <td><Badge tone={presentation.tone}>{presentation.label}</Badge>{subline && <small className="compensation-subline">{subline}</small>}</td>
          </tr>
        })}{!filteredRows.length && <tr><td colSpan="5" className="compensation-empty">Chưa có khoản hoàn trả vi phạm phù hợp bộ lọc.</td></tr>}</tbody>
      </TableWrap>
    </Card>
  </div>
}
