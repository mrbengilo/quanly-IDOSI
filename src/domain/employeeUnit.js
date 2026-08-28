const normalize = (value) => String(value ?? '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/gu, '')
  .replace(/đ/giu, 'd')
  .trim()
  .toLowerCase()
  .replace(/[^a-z0-9]+/gu, '_')
  .replace(/^_+|_+$/gu, '')

const STORE_MANAGER_MARKERS = new Set([
  'store_manager', 'manager', 'quan_ly_cua_hang', 'qlch',
])
const BUSINESS_SUPPORT_MARKERS = new Set([
  'business_support', 'support', 'htkd', 'ho_tro_kinh_doanh',
])
const OFFICE_MARKERS = new Set([
  'office', 'back_office', 'kvp', 'van_phong', 'khoi_van_phong',
])
const STORE_MARKERS = new Set([
  'store', 'store_employee', 'employee', 'cua_hang', 'nhan_vien_cua_hang',
])

const values = (record) => [record?.unit, record?.unitType, record?.department]
  .map(normalize)
  .filter(Boolean)

const roleValues = (record) => [record?.role, ...(Array.isArray(record?.roles) ? record.roles : [])]
  .map(normalize)
  .filter(Boolean)

const hasAny = (items, markers) => items.some((item) => markers.has(item))

/**
 * Canonical employee taxonomy used at both presentation and authorization boundaries.
 * A generic store marker is only a fallback: authoritative manager markers win first.
 * Conflicting authoritative units are intentionally unresolved so callers fail closed.
 */
export function canonicalEmployeeUnit(record = {}, { officeStoreId = 'OFFICE' } = {}) {
  const explicit = values(record)
  const roles = roleValues(record)
  const title = normalize(record?.position || record?.title)
  const manager = record?.isStoreManager === true
    || hasAny(explicit, STORE_MANAGER_MARKERS)
    || hasAny(roles, STORE_MANAGER_MARKERS)
    || STORE_MANAGER_MARKERS.has(title)
  const businessSupport = hasAny(explicit, BUSINESS_SUPPORT_MARKERS)
  const office = hasAny(explicit, OFFICE_MARKERS)
    || String(record?.storeId || '') === String(officeStoreId)
    || record?.isOffice === true

  const authoritative = [manager, businessSupport, office].filter(Boolean).length
  if (authoritative > 1) return 'unknown'
  if (manager) return 'store_manager'
  if (businessSupport) return 'business_support'
  if (office) return 'office'
  if (!explicit.length || hasAny(explicit, STORE_MARKERS)) return 'store'
  return 'unknown'
}
