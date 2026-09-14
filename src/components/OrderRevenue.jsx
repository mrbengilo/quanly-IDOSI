import { useId, useState } from 'react'
import { Banknote, Package, Scale, ShoppingCart } from 'lucide-react'
import { Field, InfoNote, MetricCard, MoneyInput } from './UI'
import { OrderItemSelector } from './OrderItemSelector'
import { ORDER_REVENUE_LABELS, ORDER_REVENUE_TYPES, orderRevenueByType, prepareOrderRevenueInput, revenueTypeOf } from '../domain/orderRevenue'
import { money } from '../utils'
import './orderRevenue.css'

const presentation = { NORMAL: { icon: ShoppingCart, tone: 'blue' }, SALE_KG: { icon: Scale, tone: 'green' }, SALE_PIECE: { icon: Package, tone: 'orange' } }

export function OrderRevenueSummary({ totals, label = 'Doanh thu theo loại', totalLabel = 'TỔNG DOANH THU', compact = false }) {
  return <section className={`order-revenue-summary ${compact ? 'is-compact' : ''}`} aria-label={label}>
    {ORDER_REVENUE_TYPES.map((type) => <MetricCard key={type} label={ORDER_REVENUE_LABELS[type].toLocaleUpperCase('vi-VN')}
      value={totals?.revenueByType ? money(totals.revenueByType[type]) : '—'}
      helper={type === 'NORMAL' ? 'Hàng thường' : 'Hàng sale'} compact={compact} {...presentation[type]} />)}
    <MetricCard label={totalLabel} value={totals ? money(totals.revenue) : '—'} helper="Bán thường + 2 loại sale" icon={Banknote} tone="green" compact={compact} />
  </section>
}

export function OrderRevenueDetails({ order }) {
  const amounts = orderRevenueByType(order)
  if (!amounts.SALE_KG && !amounts.SALE_PIECE) return <small className="table-note">Bán thường</small>
  return <dl className="order-revenue-details" aria-label={`Phân loại doanh thu ${order.code || ''}`}>
    {ORDER_REVENUE_TYPES.filter((type) => amounts[type] > 0).map((type) => <div key={type}>
      <dt>{ORDER_REVENUE_LABELS[type]}</dt><dd>{money(amounts[type])}</dd>
    </div>)}
  </dl>
}

export function OrderRevenueEditor({ options, items = [], amount = '', onItemsChange, onAmountChange, disabled = false, canEditRevenue = true, errors = {} }) {
  const [type, setType] = useState(() => items.length ? revenueTypeOf(items[0]) : 'NORMAL')
  const id = useId()
  const current = items.filter((item) => revenueTypeOf(item) === type)
  const replaceCurrent = (next) => onItemsChange?.([...items.filter((item) => revenueTypeOf(item) !== type), ...next])
  let preview, previewError
  try {
    const prepared = prepareOrderRevenueInput({ amount: String(amount).replaceAll(',', ''), items })
    preview = { revenue: prepared.amount, revenueByType: orderRevenueByType({ amount: prepared.amount, items }) }
  } catch (error) { previewError = error.message }
  return <section className="order-revenue-editor" aria-label="Ba mục tạo đơn hàng">
    <div className="order-revenue-editor__heading"><strong>Mặt hàng và doanh thu</strong><small>Sale theo ký và sale theo cái thuộc nhóm Hàng sale.</small></div>
    <div className="order-revenue-tabs" role="tablist" aria-label="Loại bán hàng">
      {ORDER_REVENUE_TYPES.map((value) => <button key={value} type="button" role="tab" id={`${id}-${value}`} aria-controls={`${id}-panel`} aria-selected={type === value}
        className={type === value ? 'active' : ''} onClick={() => setType(value)} disabled={disabled}>
        {ORDER_REVENUE_LABELS[value]}<small>{items.filter((item) => revenueTypeOf(item) === value).length} mặt hàng</small>
      </button>)}
    </div>
    <div id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-${type}`} className="order-revenue-editor__panel">
      <OrderItemSelector options={options} value={current} revenueType={type} error={errors.items} disabled={disabled || (type !== 'NORMAL' && !canEditRevenue)} onChange={replaceCurrent} />
      {type === 'NORMAL' && <Field label="Số tiền" required={current.length > 0} hint="Tiền bán thường như hiện tại; không nhập tiền hàng sale vào đây." error={errors.amount}>
        <MoneyInput value={amount} disabled={disabled || !canEditRevenue} onChange={(event) => onAmountChange?.(event.target.value)} placeholder="Nhập số tiền" />
      </Field>}
      {type !== 'NORMAL' && <small>Thành tiền tự tính từ {type === 'SALE_KG' ? 'khối lượng × đơn giá/kg' : 'số cái × đơn giá/cái'}. Đơn vị không thay đổi.</small>}
    </div>
    {!canEditRevenue && <InfoNote>Chỉ Admin được thay đổi số tiền và phần hàng sale.</InfoNote>}
    {errors.amount && type !== 'NORMAL' && <small className="field__error" role="alert">{errors.amount}</small>}
    <OrderRevenueSummary totals={preview} label="Tổng tiền đơn đang nhập" totalLabel="TỔNG TIỀN ĐƠN" compact />
    {!preview && !errors.amount && !errors.items && <small className="order-revenue-editor__pending" role="status">{items.length ? previewError : 'Chọn mặt hàng và nhập tiền để tính tổng đơn.'}</small>}
  </section>
}
