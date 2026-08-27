import { useState } from 'react'
import { Banknote, CircleDollarSign, Gift, ShieldAlert, WalletCards } from 'lucide-react'
import { useApp } from '../../state/AppContext'
import { Badge, Card, InfoNote, MetricCard, PageHeader, Select, TableWrap } from '../../components/UI'
import { money } from '../../utils'
import {
  entityId,
  entryAmount,
  entryDate,
  entryEmployeeId,
  entryType,
  isApproved,
  isVoided,
  revenueAllocations,
  samePeriod,
  statusLabel,
  statusTone,
  typeLabel,
} from './compensationViewModel'
import { displayDate, storeName } from './compensationUi'
import './compensation-page.css'

const rowValue = (row, ...keys) => {
  for (const key of keys) {
    if (row?.[key] != null && Number.isFinite(Number(row[key]))) return Number(row[key])
  }
  return null
}

const payrollRowsFor = (periods, employeeId, period) => periods
  .filter((item) => String(item?.period || item?.month || '') === period)
  .flatMap((item) => (Array.isArray(item?.rows) ? item.rows.map((row) => ({
    ...row,
    payrollPeriodId: item.id,
    payrollStoreId: item.storeId,
    payrollStoreName: item.storeName,
    periodStatus: item.status,
    lockedAt: item.lockedAt,
  })) : []))
  .filter((row) => entryEmployeeId(row) === employeeId)

const aggregateRowValue = (rows, ...keys) => {
  const values = rows.map((row) => rowValue(row, ...keys)).filter((value) => value != null)
  return values.length ? values.reduce((sum, value) => sum + value, 0) : null
}

const availablePeriods = ({ compensationEntries, violations, allocations, payrollPeriods, employeeId }) => [...new Set([
  ...compensationEntries.filter((entry) => entryEmployeeId(entry) === employeeId).map((entry) => entryDate(entry).slice(0, 7)),
  ...violations.filter((entry) => entryEmployeeId(entry) === employeeId).map((entry) => entryDate(entry).slice(0, 7)),
  ...allocations.filter((entry) => entryEmployeeId(entry) === employeeId).map((entry) => entryDate(entry).slice(0, 7)),
  ...payrollPeriods.filter((item) => (item.rows || []).some((row) => entryEmployeeId(row) === employeeId)).map((item) => String(item.period || item.month || '')),
].filter((period) => /^\d{4}-\d{2}$/u.test(period)))].sort().reverse()

export function MyCompensationPage() {
  const app = useApp()
  const employeeId = entityId(app.currentEmployee) || String(app.session?.employeeId || '')
  const compensationEntries = app.compensationEntries || []
  const violations = app.violations || []
  const allocations = revenueAllocations(app.revenueBonuses || [])
  const payrollPeriods = app.payrollPeriods || []
  const periods = availablePeriods({ compensationEntries, violations, allocations, payrollPeriods, employeeId })
  const currentPeriodParts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit' })
    .formatToParts(new Date())
  const currentPeriodMap = Object.fromEntries(currentPeriodParts.map((part) => [part.type, part.value]))
  const currentPeriod = `${currentPeriodMap.year}-${currentPeriodMap.month}`
  const [periodSelection, setPeriodSelection] = useState('')
  const period = periodSelection || periods[0] || currentPeriod
  const ownEntries = compensationEntries.filter((entry) => entryEmployeeId(entry) === employeeId && samePeriod(entry, period))
  const activeApprovedEntries = ownEntries.filter((entry) => !isVoided(entry) && isApproved(entry))
  const ownViolations = violations.filter((entry) => entryEmployeeId(entry) === employeeId && samePeriod(entry, period))
  const activeViolations = ownViolations.filter((entry) => !isVoided(entry))
  const ownAllocations = allocations.filter((entry) => (
    entryEmployeeId(entry) === employeeId
    && samePeriod(entry, period)
    && String(entry.status || '').toUpperCase() === 'CONFIRMED'
  ))
  const payrollRows = payrollRowsFor(payrollPeriods, employeeId, period)
  const recorded = (type) => activeApprovedEntries.filter((entry) => entryType(entry) === type).reduce((sum, entry) => sum + entryAmount(entry), 0)
  const manualVnd = recorded('MANUAL')
  const workVnd = recorded('WORK')
  const allowanceVnd = recorded('ALLOWANCE')
  const revenueEntryVnd = recorded('REVENUE')
  const revenueVnd = revenueEntryVnd || ownAllocations.reduce((sum, entry) => sum + Number(entry.allocatedVnd ?? entry.amountVnd ?? entry.amount ?? 0), 0)
  const supplementaryVnd = manualVnd + workVnd + allowanceVnd + revenueVnd
  const recordedViolationVnd = activeViolations.reduce((sum, entry) => sum + Math.abs(entryAmount(entry)), 0)
  const salaryVnd = aggregateRowValue(payrollRows, 'salaryVnd', 'baseSalaryVnd', 'baseSalary', 'base')
  const grossVnd = aggregateRowValue(payrollRows, 'grossCompensationVnd', 'grossVnd', 'gross', 'totalIncome')
  const appliedViolationVnd = aggregateRowValue(payrollRows, 'appliedViolationVnd', 'violationAppliedVnd')
  const receivableVnd = aggregateRowValue(payrollRows, 'remainingViolationReceivableVnd', 'remainingReceivableVnd', 'violationReceivableVnd')
  const advanceVnd = aggregateRowValue(payrollRows, 'advanceVnd', 'advancesPaid', 'advancePaidVnd')
  const netPayVnd = aggregateRowValue(payrollRows, 'netPayVnd', 'netVnd', 'net')
  const periodStatuses = [...new Set(payrollRows.map((row) => row.periodStatus).filter(Boolean))]
  const payrollStatus = periodStatuses.length === 1 ? periodStatuses[0] : payrollRows.length ? `${payrollRows.length} bảng quyết toán` : 'Chờ tổng hợp kỳ lương'
  const transactionRows = [
    ...ownEntries.map((entry) => ({ ...entry, rowKind: 'compensation', rowType: typeLabel(entryType(entry)), rowAmount: entryAmount(entry) })),
    ...ownAllocations.filter(() => !revenueEntryVnd).map((entry) => ({ ...entry, rowKind: 'revenue', rowType: 'Thưởng doanh thu', rowAmount: Number(entry.allocatedVnd ?? entry.amountVnd ?? entry.amount ?? 0) || 0 })),
    ...ownViolations.map((entry) => ({ ...entry, rowKind: 'violation', rowType: 'Vi phạm', rowAmount: Math.abs(entryAmount(entry)) })),
  ].sort((left, right) => String(right.createdAt || entryDate(right)).localeCompare(String(left.createdAt || entryDate(left))))

  return (
    <div className="page compensation-page my-compensation-page">
      <PageHeader
        title="THU NHẬP VÀ ĐỐI SOÁT CỦA TÔI"
        subtitle="Bản kê cá nhân chỉ hiển thị dữ liệu của tài khoản đang đăng nhập; số quyết toán lấy từ kỳ lương đã tổng hợp."
        icon={WalletCards}
        actions={<Select aria-label="Kỳ đối soát" value={period} onChange={(event) => setPeriodSelection(event.target.value)}>{periods.length ? periods.map((item) => <option key={item} value={item}>Tháng {item.split('-').reverse().join('/')}</option>) : <option value={period}>Tháng {period.split('-').reverse().join('/')}</option>}</Select>}
      />
      <div className="metric-grid compensation-metrics compensation-metrics--statement">
        <MetricCard compact label="LƯƠNG TRONG KỲ" value={salaryVnd == null ? 'Chưa tổng hợp' : money(salaryVnd)} icon={Banknote} tone="blue" />
        <MetricCard compact label="THƯỞNG + PHỤ CẤP" value={money(supplementaryVnd)} helper="Khoản đã duyệt" icon={Gift} tone="green" />
        <MetricCard compact label="VI PHẠM GHI NHẬN" value={money(recordedViolationVnd)} helper={appliedViolationVnd == null ? 'Chờ quyết toán' : `Đã áp dụng ${money(appliedViolationVnd)}`} icon={ShieldAlert} tone="orange" />
        <MetricCard compact label="THỰC NHẬN" value={netPayVnd == null ? 'Chưa chốt' : money(netPayVnd)} helper={payrollStatus} icon={CircleDollarSign} tone="green" />
      </div>
      <Card title="Tóm tắt quyết toán">
        <div className="compensation-statement-grid">
          <p><span>Lương</span><strong>{salaryVnd == null ? 'Chưa tổng hợp' : money(salaryVnd)}</strong></p>
          <p><span>Thưởng doanh thu</span><strong>{money(revenueVnd)}</strong></p>
          <p><span>Thưởng công việc</span><strong>{money(workVnd)}</strong></p>
          <p><span>Thưởng thủ công</span><strong>{money(manualVnd)}</strong></p>
          <p><span>Phụ cấp</span><strong>{money(allowanceVnd)}</strong></p>
          <p><span>Vi phạm đã áp dụng</span><strong className="compensation-debit">{appliedViolationVnd == null ? 'Chờ quyết toán' : `- ${money(appliedViolationVnd)}`}</strong></p>
          <p><span>Ứng lương đã áp dụng</span><strong>{advanceVnd == null ? 'Chờ quyết toán' : `- ${money(advanceVnd)}`}</strong></p>
          <p><span>Vi phạm còn phải thu</span><strong className="compensation-debit">{receivableVnd == null ? 'Chờ quyết toán' : money(receivableVnd)}</strong></p>
          <p className="compensation-statement-total"><span>Tổng thu nhập trước đối trừ</span><strong>{grossVnd == null ? 'Chưa chốt' : money(grossVnd)}</strong></p>
          <p className="compensation-statement-total"><span>Thực nhận</span><strong>{netPayVnd == null ? 'Chưa chốt' : money(netPayVnd)}</strong></p>
        </div>
        {!payrollRows.length && <InfoNote tone="orange">Kỳ này chưa có bản chụp quyết toán. Các khoản thưởng, phụ cấp và vi phạm bên dưới là dữ liệu đã ghi nhận, không thay thế số lương cuối kỳ.</InfoNote>}
      </Card>
      {payrollRows.length > 0 && <Card title="Quyết toán theo cửa hàng" action={<Badge tone="blue">{payrollRows.length} dòng</Badge>}>
        <TableWrap className="compensation-table">
          <thead><tr><th>Cửa hàng</th><th>Trạng thái kỳ</th><th>Lương</th><th>Tổng trước đối trừ</th><th>Vi phạm áp dụng</th><th>Ứng lương</th><th>Thực nhận</th></tr></thead>
          <tbody>{payrollRows.map((row, index) => <tr key={row.id || `${row.payrollPeriodId || row.payrollStoreId}-${index}`}>
            <td><strong>{storeName(app.stores || [], row.payrollStoreId || row.storeId, row.payrollStoreName || row.storeName)}</strong></td>
            <td><Badge tone={row.periodStatus === 'Đã khóa' ? 'red' : row.periodStatus ? 'green' : 'orange'}>{row.periodStatus || 'Chưa chốt'}</Badge></td>
            <td>{money(rowValue(row, 'salaryVnd', 'baseSalaryVnd', 'baseSalary', 'base') || 0)}</td>
            <td>{money(rowValue(row, 'grossCompensationVnd', 'grossVnd', 'gross', 'totalIncome') || 0)}</td>
            <td className="compensation-debit">{money(rowValue(row, 'appliedViolationVnd', 'violationAppliedVnd') || 0)}</td>
            <td>{money(rowValue(row, 'advanceVnd', 'advancesPaid', 'advancePaidVnd') || 0)}</td>
            <td><strong>{money(rowValue(row, 'netPayVnd', 'netVnd', 'net') || 0)}</strong></td>
          </tr>)}</tbody>
        </TableWrap>
      </Card>}
      <Card title="Lịch sử khoản ghi nhận" action={<Badge tone="blue">{transactionRows.length} dòng</Badge>}>
        <TableWrap className="compensation-table">
          <thead><tr><th>Ngày</th><th>Loại</th><th>Nội dung</th><th>Số tiền</th><th>Trạng thái</th></tr></thead>
          <tbody>{transactionRows.map((entry, index) => <tr key={entry.id || `${entry.rowKind}-${index}`}><td>{displayDate(entryDate(entry))}</td><td><Badge tone={entry.rowKind === 'violation' ? 'red' : entry.rowKind === 'revenue' ? 'blue' : 'green'}>{entry.rowType}</Badge></td><td>{entry.note || entry.title || entry.reason || entry.programLabel || '—'}</td><td><strong className={entry.rowKind === 'violation' ? 'compensation-debit' : ''}>{entry.rowKind === 'violation' ? '- ' : ''}{money(entry.rowAmount)}</strong></td><td><Badge tone={statusTone(entry)}>{statusLabel(entry)}</Badge></td></tr>)}{!transactionRows.length && <tr><td colSpan="5" className="compensation-empty">Chưa có khoản ghi nhận trong kỳ này.</td></tr>}</tbody>
        </TableWrap>
      </Card>
    </div>
  )
}
