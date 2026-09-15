import { ORDER_REVENUE_TYPES, ORDER_REVENUE_LABELS } from '../domain/orderRevenue'
import { money } from '../utils'
import './orderItems.css'

/** Display only server/shared-domain totals; pagination and payment filters cannot recalculate these cards. */
export function OrderRevenueSummary({ totals, label = 'Phân loại doanh thu', totalLabel = 'Tổng doanh thu', totalHelper = '' }) {
  const cards = [
    ...ORDER_REVENUE_TYPES.map((type) => ({ type, label: ORDER_REVENUE_LABELS[type], amount: totals?.revenueByType?.[type] })),
    { type: 'TOTAL', label: totalLabel, amount: totals?.revenue },
  ]
  return <section className="order-revenue-summary" aria-label={label}>
    <div className="order-revenue-summary__grid">
      {cards.map((card) => <div className={`metric metric-card order-revenue-summary__card order-revenue-summary__card--${card.type.toLowerCase()}`} key={card.type} data-testid={`revenue-${card.type}`}>
        <span>{card.label}</span>
        <strong>{card.amount == null ? '—' : money(card.amount)}</strong>
        <small>{card.type === 'TOTAL' ? totalHelper || 'Bằng tổng 3 loại doanh thu' : card.type === 'NORMAL' ? 'Hàng thường' : 'Hàng sale'}</small>
      </div>)}
    </div>
    {totals && !totals.revenueByType && <small className="order-revenue-summary__notice">Chưa có dữ liệu phân loại. Làm mới số liệu sau khi hệ thống cập nhật; không tự suy đoán doanh thu sale.</small>}
  </section>
}
