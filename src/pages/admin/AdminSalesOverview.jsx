import { useEffect, useMemo, useState } from 'react'
import { Package, Scale, TrendingDown, TrendingUp } from 'lucide-react'
import { Button, Card, InfoNote, MetricCard } from '../../components/UI'
import { summarizeOrders } from '../../domain/orderSummary'
import { salesOverviewFromSummary } from '../../domain/salesOverview'
import { apiGetSalesOverview } from '../../services/idosiApi'
import './adminSalesOverview.css'

const number = (value) => Number(value).toLocaleString('vi-VN', { maximumFractionDigits: 3 })
const EMPTY_ORDERS = []

export default function AdminSalesOverview({ period, remote, orders = EMPTY_ORDERS }) {
  const [result, setResult] = useState(null)
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    if (!remote) return undefined
    const controller = new AbortController()
    apiGetSalesOverview(period, { signal: controller.signal }).then((payload) => {
      if (!controller.signal.aborted) setResult({ period, retry, data: payload })
    }).catch((error) => {
      if (!controller.signal.aborted) setResult({ period, retry, error: error.message || 'Không thể tải thống kê bán hàng.' })
    })
    return () => controller.abort()
  }, [period, remote, retry])
  const local = useMemo(() => remote ? null : salesOverviewFromSummary(summarizeOrders(orders, { period })), [remote, orders, period])
  const current = result?.period === period && result?.retry === retry ? result : null
  const data = remote ? current?.data : local
  const error = remote && current?.error
  const loading = remote && !current
  const weight = data?.weight
  const placeholder = loading ? '…' : '—'
  const productLabel = (product) => product ? `${product.productName} (${number(product.quantity)} cái)` : 'Chưa có dữ liệu'
  return (
    <section className="admin-sales" aria-label="Thống kê bán hàng" aria-busy={loading}>
      <div className="section-heading"><div><h2>Thống kê bán hàng</h2><p>Tháng {period.slice(5)}/{period.slice(0, 4)} · Tất cả cửa hàng</p></div></div>
      {error && <div role="alert"><InfoNote tone="orange">{error} <Button variant="outline" onClick={() => setRetry((value) => value + 1)}>Thử lại thống kê</Button></InfoNote></div>}
      {loading && <p role="status">Đang tải thống kê bán hàng…</p>}
      <div className="admin-sales__metrics">
        <MetricCard label="TỔNG KHỐI LƯỢNG ĐÃ BÁN" value={!data ? placeholder : `${number(weight.totalKg ?? weight.knownKg)} kg`} helper="Khối lượng bán theo kg và quy đổi theo bảng hiện hành" icon={Scale} tone="blue" compact />
        <MetricCard label="TỔNG SỐ LƯỢNG ĐÃ BÁN" value={data ? `${number(data.quantity)} cái` : placeholder} helper="Bán thường + sale theo cái; không cộng kg" icon={Package} tone="green" compact />
        <MetricCard label="MẶT HÀNG BÁN NHIỀU NHẤT" value={data ? productLabel(data.mostSold) : placeholder} icon={TrendingUp} tone="green" compact />
        <MetricCard label="MẶT HÀNG BÁN ÍT NHẤT" value={data ? productLabel(data.leastSold) : placeholder} helper="Chỉ tính mặt hàng có phát sinh bán theo cái" icon={TrendingDown} tone="orange" compact />
      </div>
      {data?.unclassifiedOrders > 0 && <InfoNote tone="orange">Có {number(data.unclassifiedOrders)} đơn chưa có chi tiết mặt hàng; số lượng và khối lượng chưa phản ánh đầy đủ các đơn này.</InfoNote>}
      <Card title="Biểu đồ mặt hàng bán chạy">
        <p>Tối đa 10 mặt hàng · Đơn vị: cái. Khi bằng nhau, sắp xếp theo tên mặt hàng.</p>
        {!data ? <p>{loading ? 'Đang tải biểu đồ…' : 'Chưa tải được biểu đồ.'}</p> : !data.topProducts.length ? <p>Chưa có mặt hàng bán theo cái trong kỳ đã chọn.</p> : (
          <ol className="admin-sales__chart" aria-label="Số lượng bán theo mặt hàng">
            {data.topProducts.map((product, index) => <li key={`${product.productId || product.productCode || product.productName}-${index}`}>
              <span className="admin-sales__name">{product.productName}</span>
              <span className="admin-sales__track" aria-hidden="true"><span style={{ width: `${product.quantity / data.topProducts[0].quantity * 100}%` }} /></span>
              <strong>{number(product.quantity)} cái</strong>
            </li>)}
          </ol>
        )}
      </Card>
    </section>
  )
}
