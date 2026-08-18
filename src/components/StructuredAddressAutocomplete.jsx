import { useEffect, useId, useRef, useState } from 'react'
import { apiAddressSuggestions } from '../services/idosiApi'
import { Field, Input } from './UI'
import {
  ADDRESS_SUGGESTION_TYPES,
  addressSuggestionParams,
  applyAddressSuggestion,
  normalizeAddressSuggestions,
} from './addressAutocomplete'

const LABELS = {
  province: 'Tỉnh / Thành phố',
  ward: 'Phường / Xã',
  street: 'Đường, số nhà',
}

const PLACEHOLDERS = {
  province: 'Ví dụ: Hồ Chí Minh',
  ward: 'Ví dụ: Hiệp Bình',
  street: 'Nhập số nhà và tên đường',
}

function SuggestionInput({ disabled, field, onValueChange, required, scope, value }) {
  const listId = useId().replace(/:/g, '')
  const [suggestions, setSuggestions] = useState([])
  const [serviceAvailable, setServiceAvailable] = useState(true)
  const [focused, setFocused] = useState(false)
  const focusStartValue = useRef(String(value || ''))

  useEffect(() => {
    const query = String(value || '').trim()
    if (disabled || !focused || query.length < 2) {
      return undefined
    }

    let active = true
    const timer = window.setTimeout(async () => {
      try {
        const payload = await apiAddressSuggestions(addressSuggestionParams({
          type: field,
          query,
          province: scope.province,
          ward: scope.ward,
        }))
        if (!active) return
        setSuggestions(normalizeAddressSuggestions(payload, field))
        setServiceAvailable(true)
      } catch {
        if (!active) return
        setSuggestions([])
        setServiceAvailable(false)
      }
    }, 320)

    return () => {
      active = false
      window.clearTimeout(timer)
    }
  }, [disabled, field, focused, scope.province, scope.ward, value])

  const visibleSuggestions = disabled || !focused || String(value || '').trim().length < 2 ? [] : suggestions

  const handleChange = (event) => {
    const nextValue = event.target.value
    const selected = visibleSuggestions.find((item) => item.value === nextValue || item.label === nextValue)
    onValueChange(field, nextValue, selected, {
      commit: Boolean(selected),
      previousValue: focusStartValue.current,
    })
  }

  const handleFocus = () => {
    focusStartValue.current = String(value || '')
    setFocused(true)
  }

  const handleBlur = (event) => {
    onValueChange(field, event.target.value, null, {
      commit: true,
      previousValue: focusStartValue.current,
    })
    setFocused(false)
  }

  return (
    <Field
      label={LABELS[field]}
      required={required}
      hint={!serviceAvailable ? 'Không tải được gợi ý; bạn vẫn có thể nhập thủ công.' : undefined}
      className={field === ADDRESS_SUGGESTION_TYPES.street ? 'span-2' : ''}
    >
      <Input
        value={value}
        onChange={handleChange}
        placeholder={PLACEHOLDERS[field]}
        list={listId}
        disabled={disabled}
        autoComplete="off"
        aria-describedby={`${listId}-hint`}
        onFocus={handleFocus}
        onBlur={handleBlur}
      />
      <datalist id={listId}>
        {visibleSuggestions.map((item) => <option key={`${item.placeId || item.value}-${item.label}`} value={item.value}>{item.label}</option>)}
      </datalist>
      <span id={`${listId}-hint`} className="sr-only">Nhập từ hai ký tự để nhận gợi ý địa chỉ.</span>
    </Field>
  )
}

export function AddressAutocomplete({
  className = '',
  disabled = false,
  onChange,
  required = true,
  value = {},
}) {
  const address = {
    province: String(value.province || ''),
    ward: String(value.ward || ''),
    street: String(value.street || ''),
  }

  const update = (field, input, suggestion, options) => {
    onChange?.(applyAddressSuggestion(address, field, input, suggestion, options))
  }

  return (
    <div className={`address-autocomplete ${className}`.trim()}>
      <SuggestionInput field="province" value={address.province} scope={address} onValueChange={update} required={required} disabled={disabled} />
      <SuggestionInput field="ward" value={address.ward} scope={address} onValueChange={update} required={required} disabled={disabled || !address.province.trim()} />
      <SuggestionInput field="street" value={address.street} scope={address} onValueChange={update} required={required} disabled={disabled || !address.ward.trim()} />
      <p className="address-autocomplete__note">Nhập theo thứ tự Tỉnh/Thành phố → Phường/Xã → Đường. Gợi ý được cập nhật từ dịch vụ bản đồ khi kết nối khả dụng.</p>
    </div>
  )
}

export default AddressAutocomplete
