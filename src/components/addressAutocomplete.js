export const ADDRESS_SUGGESTION_TYPES = Object.freeze({
  province: 'province',
  ward: 'ward',
  street: 'street',
})

const clean = (value) => String(value ?? '').trim()

export const normalizeAddressSuggestion = (suggestion, type) => {
  if (typeof suggestion === 'string') {
    const value = clean(suggestion)
    return value ? { label: value, value } : null
  }
  if (!suggestion || typeof suggestion !== 'object') return null

  const typedValue = clean(suggestion[type])
  const value = clean(suggestion.value || typedValue || suggestion.label || suggestion.description)
  const label = clean(suggestion.label || suggestion.description || value)
  if (!value || !label) return null

  return {
    label,
    value,
    placeId: clean(suggestion.placeId || suggestion.place_id),
    province: clean(suggestion.province || suggestion.provinceCity),
    ward: clean(suggestion.ward || suggestion.commune),
    street: clean(suggestion.street || suggestion.route),
  }
}

export const normalizeAddressSuggestions = (payload, type) => {
  const source = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.suggestions)
      ? payload.suggestions
      : Array.isArray(payload?.results)
        ? payload.results
        : []
  const unique = new Map()
  source.forEach((item) => {
    const suggestion = normalizeAddressSuggestion(item, type)
    if (!suggestion) return
    const key = suggestion.value.toLocaleLowerCase('vi-VN')
    if (!unique.has(key)) unique.set(key, suggestion)
  })
  return [...unique.values()].slice(0, 8)
}

export const applyAddressSuggestion = (current, type, input, suggestion) => {
  const value = clean(input)
  const next = {
    province: clean(current?.province),
    ward: clean(current?.ward),
    street: clean(current?.street),
  }

  if (type === ADDRESS_SUGGESTION_TYPES.province) {
    next.province = clean(suggestion?.province || suggestion?.value || value)
    if (next.province !== clean(current?.province)) {
      next.ward = ''
      next.street = ''
    }
  } else if (type === ADDRESS_SUGGESTION_TYPES.ward) {
    next.province = clean(suggestion?.province || next.province)
    next.ward = clean(suggestion?.ward || suggestion?.value || value)
    if (next.ward !== clean(current?.ward)) next.street = ''
  } else {
    next.province = clean(suggestion?.province || next.province)
    next.ward = clean(suggestion?.ward || next.ward)
    next.street = clean(suggestion?.street || suggestion?.value || value)
  }

  return next
}

export const addressSuggestionParams = ({ type, query, province = '', ward = '' }) => ({
  type: ADDRESS_SUGGESTION_TYPES[type] || ADDRESS_SUGGESTION_TYPES.province,
  query: clean(query),
  ...(clean(province) ? { province: clean(province) } : {}),
  ...(clean(ward) ? { ward: clean(ward) } : {}),
})
