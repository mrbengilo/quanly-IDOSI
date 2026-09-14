import { useId } from 'react'
import { PackageOpen } from 'lucide-react'
import { normalizeOrderItems, orderItemsLabel } from '../domain/orderItems'
import { normalizeRevenueItem, ORDER_REVENUE_LABELS, revenueTypeOf } from '../domain/orderRevenue'
import { MoneyInput } from './UI'
import { money } from '../utils'
import { productOptions } from '../domain/orderInformationSettings'
import './orderItems.css'

export function OrderItemSelector({ options = [], value = [], onChange, error = '', disabled = false, revenueType = 'NORMAL' }) {
  const labelId = useId()
  const isSale = revenueType !== 'NORMAL'
  const isKg = revenueType === 'SALE_KG'
  const selectedItems = (Array.isArray(value) ? value : []).map((item) => ({
    ...item,
    productId: String(item?.productId || item?.id || '').trim(),
    quantity: item?.quantity ?? '',
  })).filter((item) => item.productId)
  const selectedById = new Map(selectedItems.map((item) => [item.productId, item]))
  const available = (() => {
    const active = productOptions(options)
    const activeIds = new Set(active.map((option) => String(option.id)))
    const historical = selectedItems
      .filter((item) => item.productId && !activeIds.has(item.productId))
      .map((item) => ({
        id: item.productId,
        code: item.productCode,
        label: item.productName || item.productCode || 'Mặt hàng cũ',
        active: false,
      }))
    return [...active, ...historical]
  })()

  const toggle = (option, checked) => {
    if (checked) {
      onChange?.([...selectedItems, { productId: String(option.id), quantity: 1, ...(isSale ? { revenueType, unit: isKg ? 'KG' : 'PIECE', unitPrice: '' } : {}) }])
    } else {
      onChange?.(selectedItems.filter((item) => item.productId !== String(option.id)))
    }
  }

  const changeValue = (productId, field, value) => {
    onChange?.(selectedItems.map((item) => {
      if (item.productId !== productId) return item
      const next = { ...item, [field]: value }
      // Never submit a stale derived line amount after quantity or price changes.
      delete next.lineAmount
      return next
    }))
  }
  const amountLabel = (item) => {
    try { return money(normalizeRevenueItem(item).lineAmount) } catch { return 'Chưa đủ số liệu' }
  }

  return (
    <div className={`order-item-selector ${error ? 'order-item-selector--error' : ''}`} role="group" aria-labelledby={labelId}>
      <span className="field__label" id={labelId}>Mặt hàng <b>*</b></span>
      <small>Chọn một hoặc nhiều mặt hàng và nhập số lượng tương ứng.</small>
      {available.length ? <div className="order-item-selector__grid">
        {available.map((option) => {
          const productId = String(option.id)
          const selected = selectedById.get(productId)
          return <div className={`order-item-selector__row ${selected ? 'is-selected' : ''}`} key={productId}>
            <label className="order-item-selector__choice">
              <input
                type="checkbox"
                checked={Boolean(selected)}
                disabled={disabled}
                onChange={(event) => toggle(option, event.target.checked)}
              />
              <span><strong>{option.label}</strong><small>{option.code || '—'}{option.active === false ? ' • Đã ngừng sử dụng' : ''}</small></span>
            </label>
            {selected && <label className="order-item-selector__quantity">
              <span>{isKg ? 'Khối lượng' : 'Số lượng'}</span>
              <input
                aria-label={`${isKg ? 'Khối lượng' : 'Số lượng'} ${option.label}`}
                type="number"
                inputMode={isKg ? 'decimal' : 'numeric'}
                min={isKg ? '0.001' : '1'}
                max="1000000"
                step={isKg ? '0.001' : '1'}
                value={selected.quantity}
                disabled={disabled}
                onChange={(event) => changeValue(productId, 'quantity', event.target.value === '' ? '' : Number(event.target.value))}
              />
              <em>{isKg ? 'kg' : 'cái'}</em>
            </label>}
            {selected && isSale && <>
              <label className="order-item-selector__price"><span>Đơn giá/{isKg ? 'kg' : 'cái'}</span>
                <MoneyInput aria-label={`Đơn giá ${option.label}`} value={selected.unitPrice} disabled={disabled}
                  onChange={(event) => changeValue(productId, 'unitPrice', event.target.value)} placeholder="Nhập đơn giá" />
              </label>
              <small className="order-item-selector__amount">Thành tiền: <strong>{amountLabel(selected)}</strong></small>
            </>}
          </div>
        })}
      </div> : <div className="order-item-selector__empty"><PackageOpen size={20} /> Chưa có mặt hàng đang hoạt động. Vui lòng báo Admin/HTKD cấu hình.</div>}
      {error && <small className="field__error" role="alert">{error}</small>}
    </div>
  )
}

export function OrderItemsSummary({ items = [] }) {
  const normalized = normalizeOrderItems(items)
  if (!normalized.length) return <span className="order-items-summary order-items-summary--empty">Chưa ghi nhận</span>
  return <ul className="order-items-summary" aria-label={orderItemsLabel(normalized)}>
    {normalized.map((item, index) => <li key={`${item.productId || item.productCode || item.productName}-${index}`}>
      <span>{item.productName || item.productCode || 'Mặt hàng'}{revenueTypeOf(item) !== 'NORMAL' && <small className="table-note">{ORDER_REVENUE_LABELS[revenueTypeOf(item)]}</small>}</span><strong>{item.quantity} {item.unit === 'KG' ? 'kg' : 'cái'}</strong>
    </li>)}
  </ul>
}

export default OrderItemSelector
