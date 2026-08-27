const normalize = (value) => String(value ?? '').trim().toLowerCase()

export function canonicalEmployeeUnit(record = {}, { officeStoreId = 'OFFICE' } = {}) {
  const explicit = normalize(record?.unit || record?.unitType || record?.department)
  if (['business_support', 'business-support', 'support', 'htkd'].includes(explicit)) return 'business_support'
  if (['store_manager', 'store-manager', 'manager'].includes(explicit)) return 'store_manager'
  if (['office', 'back_office', 'kvp', 'văn phòng', 'khối văn phòng'].includes(explicit)
    || String(record?.storeId || '') === String(officeStoreId)
    || record?.isOffice === true) return 'office'
  return 'store'
}
