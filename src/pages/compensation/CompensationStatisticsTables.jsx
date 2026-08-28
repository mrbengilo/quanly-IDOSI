import { Badge, TableWrap } from '../../components/UI'
import { money } from '../../utils'

const employeeName = (employees = [], employeeId = '', fallback = '') => employees.find((employee) => (
  [employee.id, employee.code, employee.employeeId].map(String).includes(String(employeeId))
))?.name || fallback || employeeId || 'Không xác định'

const displayDate = (value) => {
  const [year, month, day] = String(value || '').slice(0, 10).split('-')
  return year && month && day ? `${day}/${month}/${year}` : '—'
}

const displayTime = (value) => {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  return new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).format(date)
}

export function CompensationStatisticsGrid({
  statistics,
  employees = [],
  showEmployee = false,
  mode = 'reward',
}) {
  const sources = [
    ...(showEmployee ? [{ title: 'Theo nhân viên', rows: statistics?.byEmployee || [], employee: true }] : []),
    { title: 'Theo ngày', rows: statistics?.byDay || [] },
    { title: 'Theo tháng', rows: statistics?.byMonth || [] },
  ]
  const violation = mode === 'violation'

  return <div className="compensation-statistics-grid">
    {sources.map((source) => <section key={source.title} aria-label={`Thống kê ${source.title.toLocaleLowerCase('vi-VN')}`}>
      <h3>{source.title}</h3>
      <TableWrap className="compensation-table compensation-statistics-table">
        <thead><tr><th>{source.employee ? 'Nhân viên' : 'Thời gian'}</th><th>Số lần</th><th>{violation ? 'Tổng khấu trừ' : 'Tổng thưởng'}</th>{source.employee && <th>Đánh giá</th>}</tr></thead>
        <tbody>
          {source.rows.map((row) => <tr key={row.key}>
            <td><strong>{source.employee ? employeeName(employees, row.key, row.label) : row.label}</strong>{source.employee && <small className="compensation-subline">{row.key}</small>}</td>
            <td>{row.count}</td>
            <td><strong className={violation ? 'compensation-debit' : 'compensation-credit'}>{violation ? '−' : '+'}{money(row.amountVnd)}</strong></td>
            {source.employee && <td><Badge tone="orange">Chưa cấu hình đánh giá</Badge></td>}
          </tr>)}
          {!source.rows.length && <tr><td colSpan={source.employee ? 4 : 3} className="compensation-empty">Chưa có dữ liệu.</td></tr>}
        </tbody>
      </TableWrap>
    </section>)}
  </div>
}

export function RewardHistoryTable({ rows = [], employees = [], showEmployee = false }) {
  const completedRows = rows.filter((row) => row.completed && row.payoutStatus !== 'void')
  return <TableWrap className="compensation-table reward-history-table">
    <thead><tr>{showEmployee && <th>Nhân viên</th>}<th>Ngày</th><th>Ca làm</th><th>Công việc</th><th>Tiền thưởng</th><th>Ghi nhận lúc</th><th>Trạng thái</th></tr></thead>
    <tbody>
      {completedRows.map((row) => <tr key={row.id}>
        {showEmployee && <td><strong>{employeeName(employees, row.employeeId, row.employeeName)}</strong><small className="compensation-subline">{row.employeeId}</small></td>}
        <td><strong>{displayDate(row.workDate)}</strong></td>
        <td><strong>{row.shiftName || 'Chưa gắn ca'}</strong>{row.shiftTime && <small className="compensation-subline">{row.shiftTime}</small>}</td>
        <td>{row.title}</td>
        <td><strong className="compensation-credit">+{money(row.amountVnd)}</strong></td>
        <td>{displayTime(row.completedAt)}</td>
        <td><Badge tone={row.payoutStatus === 'pending' ? 'orange' : 'green'}>{row.payoutStatus === 'pending' ? 'Chờ duyệt team' : 'Đã ghi nhận'}</Badge></td>
      </tr>)}
      {!completedRows.length && <tr><td colSpan={showEmployee ? 7 : 6} className="compensation-empty">Chưa có lịch sử nhận thưởng.</td></tr>}
    </tbody>
  </TableWrap>
}
