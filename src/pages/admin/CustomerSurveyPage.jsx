import { useMemo, useState } from 'react'
import { BarChart3, BriefcaseBusiness, MessageCircle, UsersRound, VenusAndMars } from 'lucide-react'
import { Card, Field, InfoNote, Input, MetricCard, PageHeader, Select, TableWrap } from '../../components/UI'
import { customerSurveySummary } from '../../domain/customerSurvey'
import { useApp } from '../../state/AppContext'
import { today } from '../../utils'
import './CustomerSurveyPage.css'

const percentage = (value, total) => total ? `${((Number(value || 0) / total) * 100).toFixed(1)}%` : '0.0%'

const sortedEntries = (counts = {}) => Object.entries(counts)
  .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], 'vi'))

function DistributionTable({ title, label, counts, total }) {
  const entries = sortedEntries(counts)
  return (
    <Card title={title} className="customer-survey-distribution">
      <TableWrap>
        <thead><tr><th>{label}</th><th>Số khách</th><th>Tỷ lệ</th></tr></thead>
        <tbody>{entries.map(([name, value]) => <tr key={name}><td><strong>{name}</strong></td><td>{value}</td><td><span className="survey-percent">{percentage(value, total)}</span></td></tr>)}{!entries.length && <tr><td colSpan="3">Chưa có dữ liệu khảo sát.</td></tr>}</tbody>
      </TableWrap>
    </Card>
  )
}

export function CustomerSurveyPage() {
  const { orders = [], stores = [] } = useApp()
  const [period, setPeriod] = useState(today().slice(0, 7))
  const [storeId, setStoreId] = useState('all')
  const overview = useMemo(() => customerSurveySummary(orders, { period }), [orders, period])
  const selected = useMemo(() => customerSurveySummary(orders, {
    period,
    storeId: storeId === 'all' ? '' : storeId,
  }), [orders, period, storeId])
  const selectedStore = stores.find((store) => String(store.id) === String(storeId))
  const { insights } = selected

  return (
    <div className="page customer-survey-page">
      <PageHeader
        title="KHẢO SÁT THÔNG TIN KH"
        subtitle="Thống kê thông tin khách hàng từ các đơn hàng đã ghi nhận trên toàn hệ thống."
        icon={BarChart3}
        actions={<Input type="month" value={period} onChange={(event) => setPeriod(event.target.value)} aria-label="Tháng khảo sát" />}
      />

      <div className="metrics-grid metrics-grid--4" aria-label="Tổng quan khảo sát khách hàng">
        <MetricCard label="TỔNG SỐ KHÁCH" value={overview.total} suffix="lượt" icon={UsersRound} tone="green" />
        <MetricCard label="GIỚI TÍNH NAM" value={overview.genders.Nam || 0} helper={percentage(overview.genders.Nam, overview.total)} icon={VenusAndMars} tone="blue" />
        <MetricCard label="GIỚI TÍNH NỮ" value={overview.genders.Nữ || 0} helper={percentage(overview.genders.Nữ, overview.total)} icon={VenusAndMars} tone="purple" />
        <MetricCard label="ĐỘ TUỔI GHI NHẬN" value={overview.ageRange ? `${overview.ageRange.min}–${overview.ageRange.max}` : '—'} suffix="tuổi" icon={UsersRound} tone="orange" />
        <MetricCard label="TIKTOK" value={overview.channels.TikTok || 0} helper={percentage(overview.channels.TikTok, overview.total)} icon={MessageCircle} tone="green" />
        <MetricCard label="FACEBOOK" value={overview.channels.Facebook || 0} helper={percentage(overview.channels.Facebook, overview.total)} icon={MessageCircle} tone="blue" />
        <MetricCard label="ZALO" value={overview.channels.Zalo || 0} helper={percentage(overview.channels.Zalo, overview.total)} icon={MessageCircle} tone="teal" />
        <MetricCard label="KÊNH KHÁC" value={overview.channels.Khác || 0} helper={percentage(overview.channels.Khác, overview.total)} icon={BriefcaseBusiness} tone="orange" />
        <MetricCard label="CÔNG VIỆC PHỔ BIẾN" value={overview.insights.topOccupation || '—'} helper={overview.total ? `${overview.insights.topOccupationCount} khách` : 'Chưa có dữ liệu'} icon={BriefcaseBusiness} tone="green" />
      </div>

      <Card title="Thống kê từng cửa hàng" className="customer-survey-filter-card">
        <div className="form-grid">
          <Field label="Chọn tháng"><Input type="month" value={period} onChange={(event) => setPeriod(event.target.value)} /></Field>
          <Field label="Chọn cửa hàng"><Select value={storeId} onChange={(event) => setStoreId(event.target.value)}><option value="all">Tất cả cửa hàng</option>{stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}</Select></Field>
        </div>
        <InfoNote>{selectedStore ? `Đang xem chi tiết ${selectedStore.name}` : 'Đang xem tổng hợp toàn hệ thống'} trong kỳ {period.split('-').reverse().join('/')} • {selected.total} lượt khách có dữ liệu khảo sát.</InfoNote>
      </Card>

      <div className="customer-survey-grid">
        <DistributionTable title="Độ tuổi khách hàng" label="Nhóm tuổi" counts={selected.ages} total={selected.total} />
        <DistributionTable title="Kênh khách hàng biết đến" label="Kênh" counts={selected.channels} total={selected.total} />
        <DistributionTable title="Công việc / nghề nghiệp" label="Công việc" counts={selected.occupations} total={selected.total} />
      </div>

      <Card title="Nhận xét và đánh giá" className="customer-survey-insights">
        {selected.total ? <div className="survey-insight-list">
          <article><span>Độ tuổi nổi bật</span><strong>{insights.topAge}</strong><small>{insights.topAgeCount} khách • {percentage(insights.topAgeCount, selected.total)}</small></article>
          <article><span>Giới tính nhiều nhất</span><strong>{insights.topGender}</strong><small>{insights.topGenderCount} khách • {percentage(insights.topGenderCount, selected.total)}</small></article>
          <article><span>Kênh hiệu quả nhất</span><strong>{insights.topChannel}</strong><small>{insights.topChannelCount} khách • {percentage(insights.topChannelCount, selected.total)}</small></article>
          <article><span>Công việc phổ biến</span><strong>{insights.topOccupation}</strong><small>{insights.topOccupationCount} khách • {percentage(insights.topOccupationCount, selected.total)}</small></article>
        </div> : <p>Chưa có dữ liệu để đưa ra nhận xét trong phạm vi đã chọn.</p>}
      </Card>
    </div>
  )
}

export default CustomerSurveyPage
