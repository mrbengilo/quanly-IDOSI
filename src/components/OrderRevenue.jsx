import { useId, useState } from 'react'
import { Banknote, Package, Scale, ShoppingCart } from 'lucide-react'
import { Field, InfoNote, MetricCard, MoneyInput } from './UI'
import { OrderItemSelector } from './OrderItemSelector'
import { OrderWeightSummary, WeightConversionTable } from './OrderWeight'
import { summarizeItemWeights } from '../domain/orderWeight'
import { productOptions } from '../domain/orderInformationSettings'
import { ORDER_REVENUE_LABELS, ORDER_REVENUE_TYPES, orderRevenueByType, prepareOrderRevenueInput, revenueTypeOf, unclassifiedNormalRevenue } from '../domain/orderRevenue'
import { money } from '../utils'
import './orderRevenue.css'
import '../ordersMobile.css'
import './orderMobileSummary.css'

const presentation = { NORMAL: { icon: ShoppingCart, tone: 'blue' }, SALE_KG: { icon: Scale, tone: 'green' }, SALE_PIECE: { icon: Package, tone: 'orange' } }

export function OrderRevenueSummary({ totals, label = 'Doanh thu theo loại', totalLabel = 'TỔNG DOANH THU', compact = false }) {
  const unclassified = totals?.unclassifiedRevenue || 0
  return <>
    <section className={`order-revenue-summary ${compact ? 'is-compact' : ''}`} aria-label={label}>
      {ORDER_REVENUE_TYPES.map((type) => <MetricCard key={type} label={ORDER_REVENUE_LABELS[type].toLocaleUpperCase('vi-VN')}
        value={totals?.revenueByType ? money(type === 'NORMAL' ? totals.revenueByType.NORMAL - unclassified : totals.revenueByType[type]) : '—'}
        helper={type === 'NORMAL' ? 'Hàng thường' : 'Hàng sale'} compact={compact} {...presentation[type]} />)}
      {totals?.unclassifiedOrders > 0 && <MetricCard label="CHƯA PHÂN LOẠI" value={money(unclassified)} helper={`${totals.unclassifiedOrders} đơn cần đối soát`} icon={Package} tone="orange" compact={compact} />}
      <MetricCard label={totalLabel} value={totals ? money(totals.revenue) : '—'} helper={unclassified ? 'Bán thường + 2 loại sale + chưa phân loại' : 'Bán thường + 2 loại sale'} icon={Banknote} tone="green" compact={compact} />
    </section>
    <OrderWeightSummary weight={totals?.weight} label={`Khối lượng • ${label}`} compact={compact} />
  </>
}

export function OrderRevenueDetails({ order }) {
  const amounts = orderRevenueByType(order)
  const unclassified = unclassifiedNormalRevenue(order, amounts.NORMAL)
  if (!amounts.SALE_KG && !amounts.SALE_PIECE) return <small className="table-note">{unclassified ? 'Chưa phân loại' : 'Bán thường'}</small>
  return <dl className="order-revenue-details" aria-label={`Phân loại doanh thu ${order.code || ''}`}>
    {ORDER_REVENUE_TYPES.filter((type) => (type === 'NORMAL' ? amounts.NORMAL - unclassified : amounts[type]) > 0).map((type) => <div key={type}>
      <dt>{ORDER_REVENUE_LABELS[type]}</dt><dd>{money(type === 'NORMAL' ? amounts.NORMAL - unclassified : amounts[type])}</dd>
    </div>)}
    {unclassified > 0 && <div><dt>Chưa phân loại</dt><dd>{money(unclassified)}</dd></div>}
  </dl>
}

export function OrderRevenueEditor({ options, items = [], amount = '', onItemsChange, onAmountChange, disabled = false, canEditRevenue = true, errors = {} }) {
  const [type, setType] = useState(() => items.length ? revenueTypeOf(items[0]) : 'NORMAL')
  const id = useId()
  const current = items.filter((item) => revenueTypeOf(item) === type)
  const replaceCurrent = (next) => onItemsChange?.([...items.filter((item) => revenueTypeOf(item) !== type), ...next])
  const productNames = new Map(productOptions(options).map((option) => [String(option.id), option.label]))
  const weight = items.length ? summarizeItemWeights(items.map((item) => ({
    ...item, productName: item.productName || productNames.get(String(item.productId)) || '',
  }))) : null
  let preview, previewError
  try {
    const prepared = prepareOrderRevenueInput({ amount: String(amount).replaceAll(',', ''), items })
    const order = { amount: prepared.amount, items }
    preview = { revenue: prepared.amount, revenueByType: orderRevenueByType(order), unclassifiedRevenue: unclassifiedNormalRevenue(order), unclassifiedOrders: items.length === 0 || items.some((item) => item.revenueType === undefined) ? 1 : 0 }
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
      <OrderItemSelector options={options} value={current} revenueType={type} error={errors.items} disabled={disabled || (type !== 'NORMAL' && !canEditRevenue)} canClassify={canEditRevenue} onChange={replaceCurrent} />
      {type === 'NORMAL' && <Field label="Số tiền" required={current.length > 0} hint="Tiền bán thường như hiện tại; không nhập tiền hàng sale vào đây." error={errors.amount}>
        <MoneyInput value={amount} disabled={disabled || !canEditRevenue} onChange={(event) => onAmountChange?.(event.target.value)} placeholder="Nhập số tiền" />
      </Field>}
      {type !== 'NORMAL' && <small>Thành tiền tự tính từ {type === 'SALE_KG' ? 'khối lượng × đơn giá/kg' : 'số cái × đơn giá/cái'}. Đơn vị không thay đổi.</small>}
    </div>
    {!canEditRevenue && <InfoNote>Chỉ Admin được thay đổi số tiền và phần hàng sale.</InfoNote>}
    {errors.amount && type !== 'NORMAL' && <small className="field__error" role="alert">{errors.amount}</small>}
    <OrderRevenueSummary totals={preview} label="Tổng tiền đơn đang nhập" totalLabel="TỔNG TIỀN ĐƠN" compact />
    <OrderWeightSummary weight={weight} label="Khối lượng đơn đang nhập" compact />
    <WeightConversionTable />
    {!preview && !errors.amount && !errors.items && <small className="order-revenue-editor__pending" role="status">{items.length ? previewError : 'Chọn mặt hàng và nhập tiền để tính tổng đơn.'}</small>}
  </section>
}
