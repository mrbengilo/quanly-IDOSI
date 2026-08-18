export const ADDRESS_SUGGESTION_TYPES = Object.freeze({
  province: 'province',
  ward: 'ward',
  street: 'street',
})

const clean = (value) => String(value ?? '').trim()
const raw = (value) => String(value ?? '')

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

export const applyAddressSuggestion = (current, type, input, suggestion, options = {}) => {
  const isCommitted = Boolean(suggestion || options.commit)
  const value = isCommitted ? clean(input) : raw(input)
  const next = {
    province: raw(current?.province),
    ward: raw(current?.ward),
    street: raw(current?.street),
  }
  const previousValue = clean(options.previousValue ?? current?.[type])

  if (type === ADDRESS_SUGGESTION_TYPES.province) {
    next.province = suggestion ? clean(suggestion.province || suggestion.value || value) : value
    if (isCommitted && clean(next.province) !== previousValue) {
      next.ward = ''
      next.street = ''
    }
  } else if (type === ADDRESS_SUGGESTION_TYPES.ward) {
    if (suggestion?.province) next.province = clean(suggestion.province)
    next.ward = suggestion ? clean(suggestion.ward || suggestion.value || value) : value
    if (isCommitted && clean(next.ward) !== previousValue) next.street = ''
  } else {
    if (suggestion?.province) next.province = clean(suggestion.province)
    if (suggestion?.ward) next.ward = clean(suggestion.ward)
    next.street = suggestion ? clean(suggestion.street || suggestion.value || value) : value
  }

  return next
}

export const addressSuggestionParams = ({ type, query, province = '', ward = '' }) => ({
  type: ADDRESS_SUGGESTION_TYPES[type] || ADDRESS_SUGGESTION_TYPES.province,
  query: clean(query),
  ...(clean(province) ? { province: clean(province) } : {}),
  ...(clean(ward) ? { ward: clean(ward) } : {}),
})
