import { describe, expect, it } from 'vitest'
import {
  addressSuggestionParams,
  applyAddressSuggestion,
  normalizeAddressSuggestions,
} from './addressAutocomplete'

describe('address autocomplete helpers', () => {
  it('normalizes string and Google-style suggestions without duplicates', () => {
    expect(normalizeAddressSuggestions({ suggestions: [
      'Hồ Chí Minh',
      { description: 'Hồ Chí Minh', place_id: 'duplicate' },
      { label: 'Hà Nội', value: 'Hà Nội', placeId: 'hn' },
    ] }, 'province')).toEqual([
      { label: 'Hồ Chí Minh', value: 'Hồ Chí Minh' },
      { label: 'Hà Nội', value: 'Hà Nội', placeId: 'hn', province: '', ward: '', street: '' },
    ])
  })

  it('preserves spaces and dependent fields while typing, then commits on blur', () => {
    const current = { province: 'Hà Nội', ward: 'Ba Đình', street: 'Kim Mã' }
    expect(applyAddressSuggestion(current, 'province', 'Hồ ')).toEqual({
      province: 'Hồ ', ward: 'Ba Đình', street: 'Kim Mã',
    })
    expect(applyAddressSuggestion(current, 'province', 'Hồ Chí Minh', null, { commit: true, previousValue: 'Hà Nội' })).toEqual({
      province: 'Hồ Chí Minh', ward: '', street: '',
    })
    expect(applyAddressSuggestion(current, 'ward', 'Cửa Nam', null, { commit: true, previousValue: 'Ba Đình' })).toEqual({
      province: 'Hà Nội', ward: 'Cửa Nam', street: '',
    })
  })

  it('builds a scoped request for ward and street lookup', () => {
    expect(addressSuggestionParams({ type: 'street', query: 'Lê Lợi', province: 'Hồ Chí Minh', ward: 'Bến Thành' })).toEqual({
      type: 'street', query: 'Lê Lợi', province: 'Hồ Chí Minh', ward: 'Bến Thành',
    })
  })
})
