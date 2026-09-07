import { money } from '../utils'
import './orderPayments.css'

export function OrderPaymentSummary({ totals, label = 'Kết quả lọc', showTotal = true }) {
  const unknownOrders = totals ? totals.orders - totals.cashOrders - totals.transferOrders : 0
  const items = [
    ...(showTotal ? [{ label, amount: totals?.revenue, count: totals?.orders }] : []),
    { label: 'Chuyển khoản', amount: totals?.transfer, count: totals?.transferOrders },
    { label: 'Tiền mặt', amount: totals?.cash, count: totals?.cashOrders },
    ...(unknownOrders > 0 ? [{ label: 'Chưa phân loại', amount: totals.revenue - totals.cash - totals.transfer, count: unknownOrders }] : []),
  ]
  return <div className="order-payment-summary" role="group" aria-label={label}>
    {items.map((item) => <div className="order-payment-summary__item" key={item.label}>
      <span>{item.label}</span><strong>{item.amount == null ? '—' : money(item.amount)}</strong>
      <small>{item.count ?? '—'} đơn</small>
    </div>)}
  </div>
}
