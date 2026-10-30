import { useId, useState } from 'react'
import { Badge, Input } from './UI'
import { useCustomerLookup } from './useCustomerLookup'
import { customerPhone } from '../domain/customerLookup'

import './CustomerPhoneInput.css'

export function CustomerHistoryBadge({ isReturningCustomer }) {
  return <Badge tone={isReturningCustomer ? 'green' : 'blue'}>{isReturningCustomer ? 'KH cũ' : 'KH mới'}</Badge>
}

function CustomerInput({ app, storeId, field, value, onChange, onSelect, enabled = true }) {
  const id = useId()
  const [focused, setFocused] = useState(false)
  const [active, setActive] = useState(-1)
  const enough = (field === 'phone' ? customerPhone(value) : String(value || '').trim()).length >= 2
  const { value: result, error, loading } = useCustomerLookup({ app, storeId, mode: 'suggest', field, query: value,
    enabled: enabled && enough })
  const suggestions = result?.suggestions || []
  const expanded = focused && suggestions.length > 0
  const select = (customer) => {
    if (onSelect) onSelect(customer)
    else onChange({ target: { value: field === 'phone' ? customer.customerPhone : customer.customerName } })
    setFocused(false)
    setActive(-1)
  }
  const keyDown = (event) => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setFocused(false); setActive(-1) }
    if (['ArrowDown', 'ArrowUp'].includes(event.key) && suggestions.length) {
      event.preventDefault()
      setFocused(true)
      setActive((current) => current < 0 ? (event.key === 'ArrowDown' ? 0 : suggestions.length - 1)
        : (current + (event.key === 'ArrowDown' ? 1 : -1) + suggestions.length) % suggestions.length)
    }
    if (event.key === 'Enter' && expanded && active >= 0 && suggestions[active]) {
      event.preventDefault()
      select(suggestions[active])
    }
  }
  return <span className="customer-input">
    <Input type={field === 'phone' ? 'tel' : 'text'} inputMode={field === 'phone' ? 'tel' : 'text'}
      autoComplete="off" value={value} role="combobox" aria-autocomplete="list" aria-expanded={expanded}
      aria-controls={expanded ? `${id}-list` : undefined} aria-activedescendant={expanded && active >= 0 && suggestions[active] ? `${id}-${active}` : undefined}
      aria-describedby={`${id}-hint`} onFocus={() => setFocused(true)} onBlur={() => { setFocused(false); setActive(-1) }}
      onKeyDown={keyDown} onChange={(event) => { setFocused(true); setActive(-1); onChange(event) }} />
    {expanded && <span className="customer-input__list" id={`${id}-list`} role="listbox" aria-label="Gợi ý khách hàng">
      {suggestions.map((customer, index) => <span className="customer-input__option" role="option" id={`${id}-${index}`}
        key={customer.key} aria-selected={active === index} onMouseDown={(event) => event.preventDefault()}
        onClick={() => select(customer)}>
        <span className="customer-input__contact"><strong>{customer.customerName}</strong><small>{customer.customerPhone || 'Không có SĐT'}</small></span>
        <CustomerHistoryBadge isReturningCustomer={customer.isReturningCustomer} />
      </span>)}
    </span>}
    <small id={`${id}-hint`} role="status">{error || (loading ? 'Đang tìm khách hàng…'
      : enough && !suggestions.length ? 'Không có gợi ý phù hợp. Bạn có thể tiếp tục nhập khách hàng mới.'
        : `Nhập từ 2 ${field === 'phone' ? 'chữ số' : 'ký tự'} để xem gợi ý khách hàng trên toàn hệ thống.`)}</small>
  </span>
}

export function CustomerNameInput(props) { return <CustomerInput {...props} field="name" /> }
export function CustomerPhoneInput(props) { return <CustomerInput {...props} field="phone" /> }

export function CustomerPurchaseStatus({ app, storeId, customerName, phone, enabled = true }) {
  const field = String(phone || '').trim() ? 'phone' : 'name'
  const query = field === 'phone' ? phone : customerName
  const { value, loading, error } = useCustomerLookup({ app, storeId, mode: 'status', field, query,
    enabled: enabled && Boolean(String(query || '').trim()) })
  if (!String(query || '').trim()) return null
  return <div className="span-2 customer-purchase-status" role="status">
    {loading ? 'Đang đối chiếu lịch sử mua hàng…' : error ? `Chưa xác định loại khách hàng: ${error}`
      : value && !value.hasPurchaseHistory && value.hasSuggestions ? 'Có khách hàng phù hợp. Chọn gợi ý hoặc tiếp tục nhập đầy đủ thông tin để đối chiếu.'
        : value && <><CustomerHistoryBadge isReturningCustomer={value.isReturningCustomer} />
        <span>{value.hasPurchaseHistory ? 'Đã có lịch sử mua hàng trên toàn hệ thống.' : 'Chưa có lịch sử mua hàng khớp thông tin đã nhập trên toàn hệ thống.'}
          {field === 'name' && ' Đang đối chiếu theo tên; nhập SĐT để xác định chính xác hơn.'}</span></>}
  </div>
}
