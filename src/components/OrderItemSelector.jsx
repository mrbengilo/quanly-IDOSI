import { useId } from 'react'
import { PackageOpen } from 'lucide-react'
import { normalizeOrderItems, orderItemsLabel } from '../domain/orderItems'
import { productOptions } from '../domain/orderInformationSettings'
import './orderItems.css'

export function OrderItemSelector({ options = [], value = [], onChange, error = '', disabled = false }) {
  const labelId = useId()
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
      onChange?.([...selectedItems, { productId: String(option.id), quantity: 1 }])
    } else {
      onChange?.(selectedItems.filter((item) => item.productId !== String(option.id)))
    }
  }

  const changeQuantity = (productId, nextQuantity) => {
    onChange?.(selectedItems.map((item) => item.productId === productId
      ? { ...item, quantity: nextQuantity === '' ? '' : Number(nextQuantity) }
      : item))
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
              <span>Số lượng</span>
              <input
                aria-label={`Số lượng ${option.label}`}
                type="number"
                inputMode="numeric"
                min="1"
                max="1000000"
                step="1"
                value={selected.quantity}
                disabled={disabled}
                onChange={(event) => changeQuantity(productId, event.target.value)}
              />
              <em>cái</em>
            </label>}
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
      <span>{item.productName || item.productCode || 'Mặt hàng'}</span><strong>{item.quantity} cái</strong>
    </li>)}
  </ul>
}

export default OrderItemSelector
