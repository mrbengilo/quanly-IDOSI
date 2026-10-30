import { useId } from 'react'
import { Input } from './UI'
import { useCustomerLookup } from './useCustomerLookup'
import { customerPhone } from '../domain/customerLookup'

export function CustomerPhoneInput({ app, storeId, value, onChange, enabled = true }) {
  const id = useId()
  const { value: result, error, loading } = useCustomerLookup({ app, storeId, mode: 'suggest', query: value,
    enabled: enabled && customerPhone(value).length >= 2 })
  return <>
    <Input type="tel" inputMode="tel" autoComplete="off" list={id} value={value} onChange={onChange}
      aria-describedby={`${id}-hint`} />
    <datalist id={id}>{(result?.suggestions || []).map((customer) => <option key={customer.customerPhone} value={customer.customerPhone} />)}</datalist>
    <small id={`${id}-hint`} role="status">{error || (loading ? 'Đang tìm số điện thoại…' : 'Nhập từ 2 chữ số để xem gợi ý SĐT đã mua tại cửa hàng.')}</small>
  </>
}
