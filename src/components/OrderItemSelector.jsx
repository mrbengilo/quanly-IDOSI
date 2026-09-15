import { useId } from 'react'
import { PackageOpen } from 'lucide-react'
import { normalizeOrderItems, orderItemsLabel } from '../domain/orderItems'
import { normalizeRevenueItem, ORDER_REVENUE_LABELS, revenueTypeOf } from '../domain/orderRevenue'
import { MoneyInput } from './UI'
import { money } from '../utils'
import { productOptions } from '../domain/orderInformationSettings'
import './orderItems.css'

const MAX_QUANTITY = 1000000

export function OrderItemSelector({ options = [], value = [], onChange, error = '', disabled = false, revenueType = 'NORMAL' }) {
  const labelId = useId()
  const isSale = revenueType !== 'NORMAL'
  const isKg = revenueType === 'SALE_KG'
  const quantityLabel = isKg ? 'Khối lượng' : 'Số lượng'
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

  const changeValue = (productId, field, nextValue) => {
    if (disabled) return
    onChange?.(selectedItems.map((item) => {
      if (item.productId !== productId) return item
      const next = { ...item, [field]: nextValue }
      // Never submit a stale derived line amount after quantity or price changes.
      delete next.lineAmount
      return next
    }))
  }
  const changeQuantity = (option, nextValue, keepZeroDraft = false) => {
    if (disabled) return
    const productId = String(option.id)
    const quantity = nextValue === '' ? '' : Number(nextValue)
    const scale = isKg ? 1000 : 1
    if (quantity !== '' && (!Number.isFinite(quantity) || quantity < 0 || quantity > MAX_QUANTITY
      || Math.abs(quantity * scale - Math.round(quantity * scale)) > 0.000001)) return
    if (quantity === 0 && !(keepZeroDraft && selectedById.has(productId))) {
      onChange?.(selectedItems.filter((item) => item.productId !== productId))
    } else if (selectedById.has(productId)) {
      // Keep an empty draft editable; the existing submit validation still applies.
      changeValue(productId, 'quantity', quantity)
    } else if (quantity !== '') {
      onChange?.([...selectedItems, { productId, quantity, ...(isSale ? { revenueType, unit: isKg ? 'KG' : 'PIECE', unitPrice: '' } : {}) }])
    }
  }
  const stepQuantity = (option, direction) => {
    const current = Number(selectedById.get(String(option.id))?.quantity) || 0
    const scale = isKg ? 1000 : 1
    const increment = isKg ? 500 : 1
    // Buttons step by 0.5 kg; integer grams preserve manually entered 0.001 kg precision.
    const next = Math.max(0, Math.min(MAX_QUANTITY, (Math.round(current * scale) + direction * increment) / scale))
    changeQuantity(option, next)
  }
  const amountLabel = (item) => {
    try { return money(normalizeRevenueItem(item).lineAmount) } catch { return 'Chưa đủ số liệu' }
  }

  return (
    <div className={`order-item-selector ${error ? 'order-item-selector--error' : ''}`} role="group" aria-labelledby={labelId}>
      <span className="field__label" id={labelId}>Mặt hàng <b>*</b></span>
      <small>Chọn mặt hàng, bấm + / − hoặc nhập số lượng trực tiếp.</small>
      {available.length ? <div className="order-item-selector__grid">
        {available.map((option) => {
          const productId = String(option.id)
          const selected = selectedById.get(productId)
          const quantity = selected ? selected.quantity : 0
          return <div className={`order-item-selector__row order-item-selector__row--stepper ${selected ? 'is-selected' : ''}`} key={productId}>
            <label className="order-item-selector__choice">
              <input
                type="checkbox"
                checked={Boolean(selected)}
                disabled={disabled}
                onChange={(event) => changeQuantity(option, event.target.checked ? 1 : 0)}
              />
              <span>
                <span className="order-item-selector__name">{option.label}</span>
                <small className="order-item-selector__code">{option.code || '—'}</small>
                {option.active === false && <small className="order-item-selector__inactive">Đã ngừng sử dụng</small>}
              </span>
            </label>
            <div className="order-item-selector__quantity order-item-selector__quantity--stepper">
              <div className="order-item-selector__stepper" role="group" aria-label={`Điều chỉnh ${quantityLabel.toLocaleLowerCase('vi-VN')} ${option.label}`}>
                <button type="button" aria-label={`Giảm ${quantityLabel.toLocaleLowerCase('vi-VN')} ${option.label}`}
                  disabled={disabled || Number(quantity) <= 0}
                  onClick={() => stepQuantity(option, -1)}>−</button>
                <input
                  aria-label={`${quantityLabel} ${option.label}`}
                  type="number"
                  inputMode={isKg ? 'decimal' : 'numeric'}
                  min="0"
                  max={MAX_QUANTITY}
                  step={isKg ? '0.001' : '1'}
                  value={quantity}
                  style={{ '--quantity-characters': Math.max(3, String(quantity).length) }}
                  disabled={disabled}
                  onChange={(event) => changeQuantity(option, event.target.value, true)}
                  onBlur={(event) => {
                    // A typed zero may be the beginning of 0.5 kg; keep its price until editing finishes.
                    if (event.target.value !== '' && Number(event.target.value) === 0) changeQuantity(option, 0)
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
                    event.preventDefault()
                    stepQuantity(option, event.key === 'ArrowUp' ? 1 : -1)
                  }}
                />
                <button type="button" aria-label={`Tăng ${quantityLabel.toLocaleLowerCase('vi-VN')} ${option.label}`}
                  disabled={disabled || Number(quantity) >= MAX_QUANTITY}
                  onClick={() => stepQuantity(option, 1)}>+</button>
              </div>
              {isKg && <em>kg</em>}
            </div>
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
