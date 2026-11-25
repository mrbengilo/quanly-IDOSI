export const STORE_BRANDS = Object.freeze({ DOSII: 'DOSII', SM: 'SM' })

export const STORE_BRAND_LABELS = Object.freeze({ DOSII: 'Dosii', SM: 'SM' })

const textKey = (value) => String(value ?? '').trim().toUpperCase().normalize('NFD')
  .replace(/\p{M}/gu, '')
  .replaceAll('Đ', 'D')

const brandPrefix = /^(DOSII|IDOSI|SM|SECOND[\s-]*MALL)(?:[\s_-]+|$)/u

const brandFrom = (value) => {
  const prefix = textKey(value).match(brandPrefix)?.[1]
  if (!prefix) return /^SM234(?:\b|$)/u.test(textKey(value)) ? STORE_BRANDS.SM : ''
  return ['DOSII', 'IDOSI'].includes(prefix) ? STORE_BRANDS.DOSII : STORE_BRANDS.SM
}

export const storeDirectoryBrand = (store) => {
  if (!store) return ''
  if (Object.hasOwn(STORE_BRAND_LABELS, store.storeBrand)) return store.storeBrand
  // The name and public code can reflect a brand change while the id remains
  // the original key used by orders, staff, and permissions.
  return [store.name, store.code, store.id, store.short, store.employeePrefix]
    .map(brandFrom).find(Boolean) || ''
}

export const displayStoreCode = (store) => String(store?.code || store?.id || '')

export function nextBrandedStoreCode(name, brand, knownStores = []) {
  if (!Object.hasOwn(STORE_BRAND_LABELS, brand)) return ''
  const words = textKey(name).replace(brandPrefix, '').match(/[A-Z0-9]+/gu) || []
  if (!words.length) return ''
  const branch = words.length === 1 ? words[0] : words.map((word) => word[0]).join('')
  const base = `${brand}-${branch}`.slice(0, 80)
  const used = new Set(knownStores.flatMap((store) => [store?.id, store?.code])
    .map((value) => String(value ?? '').trim().toUpperCase()))
  let candidate = base
  for (let sequence = 2; used.has(candidate); sequence += 1) {
    const suffix = `-${String(sequence).padStart(2, '0')}`
    candidate = `${base.slice(0, 80 - suffix.length)}${suffix}`
  }
  return candidate
}
