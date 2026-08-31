const MANAGER_ROLE_KEYS = new Set([
  'store_manager',
  'store-manager',
  'store manager',
  'quan ly cua hang',
  'quản lý cửa hàng',
  'qlch',
])

const INACTIVE_STATUS_KEYS = new Set([
  'inactive',
  'locked',
  'disabled',
  'terminated',
  'closed',
  'da nghi viec',
  'đã nghỉ việc',
  'tam ngung',
  'tạm ngưng',
  'tam nghi',
  'tạm nghỉ',
  'ngung hoat dong',
  'ngưng hoạt động',
  'ngừng hoạt động',
])

const normalizeText = (value) => String(value ?? '').trim().toLowerCase()
const normalizeId = (value) => String(value ?? '').trim()
const normalizeIdKey = (value) => normalizeId(value).toLocaleLowerCase('en-US')

const requiredId = (value, field) => {
  const normalized = normalizeId(value)
  if (!normalized) throw new TypeError(`${field} is required.`)
  return normalized
}

const integerVnd = (value, field) => {
  const normalized = Number(value)
  if (!Number.isSafeInteger(normalized)) {
    throw new TypeError(`${field} must be an integer amount in VND.`)
  }
  return normalized
}

const managerIdentity = (manager) => normalizeId(
  manager?.linkedEmployeeId
  || manager?.employeeId
  || manager?.sourceEmployeeId
  || manager?.id
  || manager?.code,
)

const managerStoreIdentity = (manager) => normalizeId(
  manager?.storeId
  || manager?.assignedStoreId,
)

const managerBelongsToStore = (manager, storeId) => (
  normalizeIdKey(managerStoreIdentity(manager)) === normalizeIdKey(storeId)
)

const isActiveRecord = (manager) => {
  if (!manager || manager.deletedAt || manager.archivedAt || manager.revokedAt) return false
  if (manager.active === false || manager.isActive === false || manager.enabled === false) return false
  return !INACTIVE_STATUS_KEYS.has(normalizeText(manager.status))
}

const isStoreManagerRecord = (manager) => {
  if (manager?.isStoreManager === true) return true
  const explicitRole = normalizeText(
    manager?.unit
    || manager?.unitType
    || manager?.role
    || manager?.roleType
    || manager?.accountRole
    || manager?.department,
  )
  if (MANAGER_ROLE_KEYS.has(explicitRole)) return true
  if ((Array.isArray(manager?.roles) ? manager.roles : []).some((role) => MANAGER_ROLE_KEYS.has(normalizeText(role)))) {
    return true
  }
  return normalizeText(manager?.position || manager?.jobPosition).includes('quản lý cửa hàng')
}

export const MANAGER_REVENUE_BONUS_RATE_PERCENT = 2
export const MANAGER_REVENUE_BONUS_FORMULA_VERSION = 'manager-revenue-bonus.final-profit-2-percent.v1'

/**
 * The business rule defines the manager bonus as 2% of profit after the bonus
 * itself. If P0 is profit before this exact bonus, B = floor(P0 * 2 / 102).
 */
export function calculateManagerMonthlyRevenueBonus({ profitBeforeManagerBonusVnd } = {}) {
  const profitBeforeBonus = integerVnd(profitBeforeManagerBonusVnd, 'profitBeforeManagerBonusVnd')
  const bonusVnd = profitBeforeBonus > 0
    ? Number((BigInt(profitBeforeBonus) * 2n) / 102n)
    : 0

  return {
    formulaVersion: MANAGER_REVENUE_BONUS_FORMULA_VERSION,
    ratePercent: MANAGER_REVENUE_BONUS_RATE_PERCENT,
    profitBeforeManagerBonusVnd: profitBeforeBonus,
    bonusVnd,
    finalProfitVnd: profitBeforeBonus - bonusVnd,
  }
}

/**
 * Resolves the single active manager profile for a physical store. Duplicate
 * account/profile representations linked to the same exact employee identifier
 * are deduplicated, while ambiguous store scopes or different active manager
 * identities are reported as a data conflict.
 */
export function resolveExactlyOneActiveStoreManager({ storeId, managers = [] } = {}) {
  const normalizedStoreId = requiredId(storeId, 'storeId')
  if (!Array.isArray(managers)) throw new TypeError('managers must be an array.')

  const storeMatches = []
  for (const manager of managers) {
    if (!isActiveRecord(manager)
      || !isStoreManagerRecord(manager)
      || !managerBelongsToStore(manager, normalizedStoreId)) continue
    const identity = managerIdentity(manager)
    if (!identity) continue
    storeMatches.push(manager)
  }

  const exactStoreMatches = storeMatches.filter((manager) => (
    managerStoreIdentity(manager) === normalizedStoreId
  ))
  let scopedManagers = exactStoreMatches
  if (scopedManagers.length === 0 && storeMatches.length > 0) {
    const matchingStoreIds = new Set(storeMatches.map(managerStoreIdentity))
    if (matchingStoreIds.size > 1) {
      return {
        ok: false,
        code: 'STORE_MANAGER_MULTIPLE_ACTIVE',
        storeId: normalizedStoreId,
        manager: null,
        managerId: null,
        matches: storeMatches,
      }
    }
    scopedManagers = storeMatches
  }

  const uniqueManagers = new Map()
  for (const manager of scopedManagers) {
    const identity = managerIdentity(manager)
    // Only exact identities may represent the same employee/profile pair. Two
    // identifiers differing by case remain distinct owners and must fail closed.
    if (!uniqueManagers.has(identity)) uniqueManagers.set(identity, manager)
  }

  const matches = [...uniqueManagers.values()]
  if (matches.length === 0) {
    return {
      ok: false,
      code: 'STORE_MANAGER_REQUIRED',
      storeId: normalizedStoreId,
      manager: null,
      managerId: null,
      matches,
    }
  }
  if (matches.length > 1) {
    return {
      ok: false,
      code: 'STORE_MANAGER_MULTIPLE_ACTIVE',
      storeId: normalizedStoreId,
      manager: null,
      managerId: null,
      matches,
    }
  }

  const manager = matches[0]
  return {
    ok: true,
    code: 'STORE_MANAGER_RESOLVED',
    storeId: normalizedStoreId,
    manager,
    managerId: managerIdentity(manager),
    matches,
  }
}

export function assertExactlyOneActiveStoreManager(input) {
  const result = resolveExactlyOneActiveStoreManager(input)
  if (result.ok) return result.manager
  const error = new RangeError(result.code)
  error.code = result.code
  error.details = { storeId: result.storeId, managerCount: result.matches.length }
  throw error
}

export function managerRevenueBonusIdempotencyKey({ storeId, period, managerId } = {}) {
  const normalizedStoreId = requiredId(storeId, 'storeId')
  const normalizedManagerId = requiredId(managerId, 'managerId')
  const normalizedPeriod = normalizeId(period)
  if (!/^\d{4}-(0[1-9]|1[0-2])$/u.test(normalizedPeriod)) {
    throw new TypeError('period must use YYYY-MM format.')
  }
  return `manager-revenue-bonus:${normalizedStoreId}:${normalizedPeriod}:${normalizedManagerId}`
}
