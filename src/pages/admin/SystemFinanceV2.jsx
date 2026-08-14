import { useMemo, useState } from 'react'
import {
  BarChart3,
  MapPin,
  ReceiptText,
  Store,
  TrendingDown,
  TrendingUp,
  Users,
  Wallet,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import {
  Badge,
  Button,
  Card,
  ExportButton,
  Input,
  MetricCard,
  PageHeader,
  Select,
  StoreIllustration,
  TableWrap,
} from '../../components/UI'
import { financeSummaryFromState } from '../../domain'
import { useApp } from '../../state/AppContext'
import { downloadCsv, money, shortDate, today } from '../../utils'

const monthBounds = (period) => ({
  from: `${period}-01`,
  to: `${period}-${String(new Date(Number(period.slice(0, 4)), Number(period.slice(5, 7)), 0).getDate()).padStart(2, '0')}`,
})

const transactionDate = (transaction = {}) => String(transaction.occurredAt || transaction.createdAt || '').slice(0, 10)

const summariesFor = (app, period) => {
  const bounds = monthBounds(period)
  return app.stores.map((store) => ({
    store,
    summary: financeSummaryFromState(app, { storeId: store.id, ...bounds }),
  }))
}

const totalsFrom = (rows) => rows.reduce((totals, row) => ({
  revenue: totals.revenue + row.summary.revenue,
  expense: totals.expense + row.summary.expense,
  profit: totals.profit + row.summary.profit,
}), { revenue: 0, expense: 0, profit: 0 })

function SystemMetrics({ rows }) {
  const totals = totalsFrom(rows)
  const margin = totals.revenue > 0 ? (totals.profit / totals.revenue) * 100 : 0
  return (
    <div className="metric-grid metric-grid--five">
      <MetricCard label="CỬA HÀNG" value={rows.length} suffix="cửa hàng" icon={Store} tone="blue" compact />
      <MetricCard label="DOANH THU" value={money(totals.revenue)} icon={TrendingUp} tone="green" compact />
      <MetricCard label="CHI PHÍ" value={money(totals.expense)} icon={TrendingDown} tone="orange" compact />
      <MetricCard label="LỢI NHUẬN" value={money(totals.profit)} icon={Wallet} tone={totals.profit >= 0 ? 'green' : 'red'} compact />
      <MetricCard label="BIÊN LỢI NHUẬN" value={`${margin.toFixed(2)}%`} icon={BarChart3} tone="blue" compact />
    </div>
  )
}

export function AdminOverviewV2() {
  const app = useApp()
  const { stores, setActiveStoreId, session } = app
  const navigate = useNavigate()
  const [period, setPeriod] = useState(today().slice(0, 7))
  const rows = useMemo(() => summariesFor(app, period), [app, period])
  const activeStores = stores.filter((store) => !['Tạm ngưng', 'Ngừng hoạt động'].includes(store.status))
  const openStore = (store) => {
    if (setActiveStoreId?.(store.id) !== false) navigate('/store/overview')
  }

  return (
    <div className="page">
      <PageHeader
        title="TỔNG QUAN HỆ THỐNG"
        subtitle={`Xin chào, ${session?.name || 'Quản trị viên'}. Toàn bộ tài chính dưới đây được tổng hợp trực tiếp từ đơn hàng và các khoản chi đã ghi nhận.`}
        icon={BarChart3}
        actions={<Input type="month" value={period} onChange={(event) => setPeriod(event.target.value)} />}
      />
      <SystemMetrics rows={rows} />
      <div className="section-heading">
        <div><h2>Không gian cửa hàng</h2><p>Chọn một cửa hàng để mở lịch làm việc, đơn hàng, chấm công và bảng lương nhân viên.</p></div>
        <div className="section-heading__actions"><Badge tone="green">{activeStores.length} cửa hàng hoạt động</Badge><Button variant="ghost" onClick={() => navigate('/admin/stores')}>Danh sách cửa hàng</Button></div>
      </div>
      <div className="store-card-grid">
        {rows.map(({ store, summary }) => (
          <Card key={store.id} className="store-card">
            <StoreIllustration name={store.name} accent={store.accent} />
            <div className="store-card__body">
              <div className="store-card__title"><h3>{store.name}</h3><Badge tone={store.status === 'Hoạt động' || store.status === 'Đang hoạt động' ? 'green' : 'orange'}>{store.status || 'Hoạt động'}</Badge></div>
              <p><MapPin size={17} /> {store.location || store.address || 'Chưa cập nhật địa chỉ'}</p>
              <div className="store-card__finance">
                <span><small>Doanh thu trong kỳ</small><strong>{money(summary.revenue)}</strong></span>
                <span><small>Lợi nhuận trong kỳ</small><strong>{money(summary.profit)}</strong></span>
              </div>
              <Button onClick={() => openStore(store)}>Mở cửa hàng <span>→</span></Button>
            </div>
          </Card>
        ))}
      </div>
    </div>
  )
}

export function AdminCashflowV2() {
  const app = useApp()
  const [period, setPeriod] = useState(today().slice(0, 7))
  const [storeId, setStoreId] = useState('all')
  const storeRows = useMemo(() => summariesFor(app, period), [app, period])
  const visibleStoreRows = storeId === 'all' ? storeRows : storeRows.filter((row) => row.store.id === storeId)
  const bounds = monthBounds(period)
  const summary = financeSummaryFromState(app, {
    ...(storeId === 'all' ? {} : { storeId }),
    ...bounds,
  })
  const dailyRows = useMemo(() => {
    const grouped = new Map()
    summary.transactions.forEach((transaction) => {
      const date = transactionDate(transaction)
      if (!date) return
      const row = grouped.get(date) || { date, revenue: 0, expense: 0 }
      if (transaction.direction === 'in') row.revenue += Number(transaction.amount || 0)
      if (transaction.direction === 'out') row.expense += Number(transaction.amount || 0)
      grouped.set(date, row)
    })
    return [...grouped.values()].map((row) => ({ ...row, profit: row.revenue - row.expense })).sort((left, right) => right.date.localeCompare(left.date))
  }, [summary.transactions])

  return (
    <div className="page">
      <PageHeader title="DÒNG TIỀN HỆ THỐNG" subtitle="Đơn hàng là nguồn doanh thu duy nhất; chi phí chỉ xuất hiện sau khi được ghi nhận." icon={Wallet} actions={<><Select value={storeId} onChange={(event) => setStoreId(event.target.value)}><option value="all">Tất cả cửa hàng</option>{app.stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}</Select><Input type="month" value={period} onChange={(event) => setPeriod(event.target.value)} /></>} />
      <SystemMetrics rows={visibleStoreRows} />
      <Card title="Dòng tiền theo ngày">
        <TableWrap><thead><tr><th>Ngày</th><th>Doanh thu từ đơn</th><th>Chi phí đã ghi nhận</th><th>Lợi nhuận</th></tr></thead><tbody>{dailyRows.map((row) => <tr key={row.date}><td>{shortDate(row.date)}</td><td className="green-text"><strong>{money(row.revenue)}</strong></td><td className="orange-text"><strong>{money(row.expense)}</strong></td><td><strong>{money(row.profit)}</strong></td></tr>)}{!dailyRows.length && <tr><td colSpan="4">Chưa có giao dịch trong kỳ đã chọn.</td></tr>}</tbody></TableWrap>
      </Card>
      <Card title="Nguồn giao dịch">
        <TableWrap><thead><tr><th>Thời gian</th><th>Cửa hàng</th><th>Loại</th><th>Nguồn</th><th>Thu / Chi</th><th>Số tiền</th></tr></thead><tbody>{summary.transactions.map((transaction) => <tr key={transaction.id}><td>{shortDate(transactionDate(transaction))}</td><td>{app.stores.find((store) => store.id === transaction.storeId)?.name || transaction.storeId}</td><td>{transaction.type}</td><td>{transaction.sourceType === 'order' ? 'Đơn hàng' : 'Chi phí'}</td><td><Badge tone={transaction.direction === 'in' ? 'green' : 'orange'}>{transaction.direction === 'in' ? 'Thu' : 'Chi'}</Badge></td><td><strong>{money(transaction.amount)}</strong></td></tr>)}</tbody></TableWrap>
      </Card>
    </div>
  )
}

export function AdminReportsV2() {
  const app = useApp()
  const [period, setPeriod] = useState(today().slice(0, 7))
  const rows = useMemo(() => summariesFor(app, period), [app, period])
  const totals = totalsFrom(rows)
  const exportRows = rows.map(({ store, summary }) => ({
    'Mã cửa hàng': store.id,
    'Tên cửa hàng': store.name,
    'Nhân viên': app.employees.filter((employee) => employee.storeId === store.id && employee.status !== 'Đã nghỉ việc').length,
    'Số đơn': summary.transactions.filter((transaction) => transaction.sourceType === 'order').length,
    'Doanh thu': summary.revenue,
    'Chi phí': summary.expense,
    'Lợi nhuận': summary.profit,
  }))

  return (
    <div className="page">
      <PageHeader title="BÁO CÁO TOÀN HỆ THỐNG" subtitle="Báo cáo đối chiếu theo từng cửa hàng trên cùng một nguồn dữ liệu tài chính." icon={ReceiptText} actions={<><Input type="month" value={period} onChange={(event) => setPeriod(event.target.value)} /><ExportButton onClick={() => downloadCsv(`bao-cao-idosi-${period}.csv`, exportRows)} /></>} />
      <SystemMetrics rows={rows} />
      <Card title="Kết quả theo cửa hàng">
        <TableWrap><thead><tr><th>#</th><th>Cửa hàng</th><th>Nhân viên</th><th>Số đơn</th><th>Doanh thu</th><th>Chi phí</th><th>Lợi nhuận</th><th>Biên lợi nhuận</th></tr></thead><tbody>{rows.map(({ store, summary }, index) => <tr key={store.id}><td>{index + 1}</td><td><strong>{store.name}</strong><small className="table-note">{store.id}</small></td><td><Users size={15} /> {app.employees.filter((employee) => employee.storeId === store.id && employee.status !== 'Đã nghỉ việc').length}</td><td>{summary.transactions.filter((transaction) => transaction.sourceType === 'order').length}</td><td className="green-text"><strong>{money(summary.revenue)}</strong></td><td className="orange-text"><strong>{money(summary.expense)}</strong></td><td><strong>{money(summary.profit)}</strong></td><td>{summary.marginPercent.toFixed(2)}%</td></tr>)}<tr className="total-row"><td colSpan="4">Tổng cộng</td><td>{money(totals.revenue)}</td><td>{money(totals.expense)}</td><td>{money(totals.profit)}</td><td>{totals.revenue ? `${((totals.profit / totals.revenue) * 100).toFixed(2)}%` : '0.00%'}</td></tr></tbody></TableWrap>
      </Card>
    </div>
  )
}
