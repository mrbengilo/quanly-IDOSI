import { useId, useState } from 'react'
import { PackageOpen } from 'lucide-react'
import { normalizeOrderItems, orderItemsLabel } from '../domain/orderItems'
import { ORDER_REVENUE_TYPES, ORDER_REVENUE_LABELS, hasOrderLinePricing, orderItemRevenueType, orderItemUnit } from '../domain/orderRevenue'
import { productOptions } from '../domain/orderInformationSettings'
import './orderItems.css'

export function OrderItemSelector({ options = [], value = [], onChange, error = '', disabled = false, allowSale = true }) {
  const labelId = useId()
  const [activeType, setActiveType] = useState('NORMAL')
  const selectedItems = (Array.isArray(value) ? value : []).map((item) => ({
    ...item,
    productId: String(item?.productId || item?.id || '').trim(),
    quantity: item?.quantity ?? '',
  })).filter((item) => item.productId)
  const matches = (item, id) => item.productId === id && orderItemRevenueType(item) === activeType
  const selectedById = new Map(selectedItems.filter((item) => orderItemRevenueType(item) === activeType).map((item) => [item.productId, item]))
  const priced = hasOrderLinePricing(selectedItems)
  const isKg = activeType === 'SALE_KG'
  const available = (() => {
    const active = productOptions(options)
    const ids = new Set(active.map((option) => String(option.id)))
    const historical = selectedItems.filter((item) => {
      if (ids.has(item.productId)) return false
      ids.add(item.productId)
      return true
    }).map((item) => ({ id: item.productId, code: item.productCode, label: item.productName || item.productCode || 'Mặt hàng cũ', active: false }))
    return [...active, ...historical]
  })()
  const toggle = (option, checked) => {
    if (checked) {
      onChange?.([...selectedItems, {
        productId: String(option.id), quantity: 1,
        ...(activeType === 'NORMAL' ? {} : { revenueType: activeType, unit: isKg ? 'KG' : 'PIECE', unitPrice: '' }),
      }])
    } else onChange?.(selectedItems.filter((item) => !matches(item, String(option.id))))
  }
  const changeField = (id, field, input) => onChange?.(selectedItems.map((item) => matches(item, id)
    ? { ...item, [field]: input === '' ? '' : Number(input) }
    : item))

  return <div className={`order-item-selector ${error ? 'order-item-selector--error' : ''}`} role="group" aria-labelledby={labelId}>
    <span className="field__label" id={labelId}>Mặt hàng <b>*</b></span>
    <div className="order-revenue-types" role="group" aria-label="Chọn loại bán">
      {ORDER_REVENUE_TYPES.map((type) => <button type="button" key={type} aria-pressed={activeType === type}
        disabled={disabled || (!allowSale && type !== 'NORMAL')} onClick={() => setActiveType(type)}>
        <strong>{ORDER_REVENUE_LABELS[type]}</strong><small>{type === 'NORMAL' ? 'Như hiện tại' : 'Hàng sale'}</small>
      </button>)}
    </div>
    <small>{isKg ? 'Nhập kg thực bán, tối đa 3 chữ số thập phân; đơn giá theo kg.' : 'Chọn một hoặc nhiều mặt hàng và nhập số lượng tương ứng.'}</small>
    {priced && <small>Đơn có hàng sale: nhập đơn giá của mọi dòng, kể cả hàng thường. Tổng tiền được tự tính.</small>}
    {available.length ? <div className="order-item-selector__grid">
      {available.map((option) => {
        const id = String(option.id)
        const selected = selectedById.get(id)
        return <div className={`order-item-selector__row ${selected ? 'is-selected' : ''}`} key={id}>
          <label className="order-item-selector__choice">
            <input type="checkbox" checked={Boolean(selected)} disabled={disabled || (option.active === false && !selected)} onChange={(event) => toggle(option, event.target.checked)} />
            <span><strong>{option.label}</strong><small>{option.code || '—'}{option.active === false ? ' • Đã ngừng sử dụng' : ''}</small></span>
          </label>
          {selected && <>
            <label className="order-item-selector__quantity">
              <span>{isKg ? 'Khối lượng' : 'Số lượng'}</span>
              <input aria-label={`${isKg ? 'Khối lượng' : 'Số lượng'} ${option.label}`} type="number"
                inputMode={isKg ? 'decimal' : 'numeric'} min={isKg ? '0.001' : '1'} max="1000000" step={isKg ? '0.001' : '1'}
                value={selected.quantity} disabled={disabled} onChange={(event) => changeField(id, 'quantity', event.target.value)} />
              <em>{isKg ? 'kg' : 'cái'}</em>
            </label>
            {priced && <>
              <label className="order-item-selector__quantity"><span>Đơn giá</span>
                <input aria-label={`Đơn giá ${option.label}`} type="number" inputMode="numeric" min="0" step="1"
                  value={selected.unitPrice ?? ''} disabled={disabled} onChange={(event) => changeField(id, 'unitPrice', event.target.value)} />
                <em>đ/{isKg ? 'kg' : 'cái'}</em>
              </label>
              <label className="order-item-selector__quantity"><span>Giảm giá dòng</span>
                <input aria-label={`Giảm giá ${option.label}`} type="number" inputMode="numeric" min="0" step="1"
                  value={selected.discountAmount ?? 0} disabled={disabled} onChange={(event) => changeField(id, 'discountAmount', event.target.value)} />
                <em>đ</em>
              </label>
            </>}
          </>}
        </div>
      })}
    </div> : <div className="order-item-selector__empty"><PackageOpen size={20} /> Chưa có mặt hàng đang hoạt động. Vui lòng báo Admin/HTKD cấu hình.</div>}
    {selectedItems.length > 0 && <div className="order-revenue-types__selection" aria-label="Các dòng đã chọn">
      {ORDER_REVENUE_TYPES.map((type) => {
        const count = selectedItems.filter((item) => orderItemRevenueType(item) === type).length
        return count ? <button type="button" key={type} onClick={() => setActiveType(type)} disabled={disabled}>{ORDER_REVENUE_LABELS[type]}: {count} dòng</button> : null
      })}
    </div>}
    {error && <small className="field__error" role="alert">{error}</small>}
  </div>
}

export function OrderItemsSummary({ items = [] }) {
  const normalized = normalizeOrderItems(items)
  if (!normalized.length) return <span className="order-items-summary order-items-summary--empty">Chưa ghi nhận</span>
  return <ul className="order-items-summary" aria-label={orderItemsLabel(normalized)}>
    {normalized.map((item, index) => <li key={`${item.productId || item.productCode || item.productName}-${index}`}>
      <span>{item.productName || item.productCode || 'Mặt hàng'}{orderItemRevenueType(item) !== 'NORMAL' && <small className="table-note">{ORDER_REVENUE_LABELS[item.revenueType]}</small>}</span>
      <strong>{Number(item.quantity).toLocaleString('vi-VN')} {orderItemUnit(item) === 'KG' ? 'kg' : 'cái'}</strong>
    </li>)}
  </ul>
}

export default OrderItemSelector
