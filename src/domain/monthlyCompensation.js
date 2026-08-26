const deepFreeze = (value) => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value
  for (const child of Object.values(value)) deepFreeze(child)
  return Object.freeze(value)
}

const normalizeRole = (value) => String(value ?? '').trim().toLowerCase()
const normalizeId = (value) => String(value ?? '').trim()
const hasReason = (value) => String(value ?? '').trim().length > 0

export const MONTHLY_COMPENSATION_STATUS = deepFreeze({
  OPEN: 'OPEN',
  DRAFT: 'DRAFT',
  UNDER_MANAGER_REVIEW: 'UNDER_MANAGER_REVIEW',
  READY_TO_CLOSE: 'READY_TO_CLOSE',
  BOOKS_CLOSED: 'BOOKS_CLOSED',
  PAYMENT_IN_PROGRESS: 'PAYMENT_IN_PROGRESS',
  PARTIALLY_PAID: 'PARTIALLY_PAID',
  PAID: 'PAID',
  LOCKED: 'LOCKED',
})

export const MONTHLY_COMPENSATION_ACTOR_ROLE = deepFreeze({
  SYSTEM: 'system',
  ADMIN: 'admin',
  BUSINESS_SUPPORT: 'business_support',
  STORE_MANAGER: 'store_manager',
})

const ROLES = MONTHLY_COMPENSATION_ACTOR_ROLE
const STATUS = MONTHLY_COMPENSATION_STATUS

const frozenSnapshotStatuses = new Set([
  STATUS.BOOKS_CLOSED,
  STATUS.PAYMENT_IN_PROGRESS,
  STATUS.PARTIALLY_PAID,
  STATUS.PAID,
  STATUS.LOCKED,
])

export const isMonthlyCompensationSnapshotFrozen = (status) => frozenSnapshotStatuses.has(status)

export const MONTHLY_COMPENSATION_TRANSITIONS = deepFreeze([
  { from: STATUS.OPEN, to: STATUS.DRAFT, roles: [ROLES.SYSTEM, ROLES.ADMIN] },
  { from: STATUS.DRAFT, to: STATUS.UNDER_MANAGER_REVIEW, roles: [ROLES.ADMIN, ROLES.BUSINESS_SUPPORT] },
  {
    from: STATUS.UNDER_MANAGER_REVIEW,
    to: STATUS.READY_TO_CLOSE,
    roles: [ROLES.STORE_MANAGER, ROLES.ADMIN, ROLES.BUSINESS_SUPPORT],
    reasonRequiredForRoles: [ROLES.ADMIN, ROLES.BUSINESS_SUPPORT],
  },
  {
    from: STATUS.UNDER_MANAGER_REVIEW,
    to: STATUS.DRAFT,
    roles: [ROLES.STORE_MANAGER, ROLES.ADMIN, ROLES.BUSINESS_SUPPORT],
    reasonRequiredForRoles: [ROLES.STORE_MANAGER, ROLES.ADMIN, ROLES.BUSINESS_SUPPORT],
  },
  { from: STATUS.READY_TO_CLOSE, to: STATUS.BOOKS_CLOSED, roles: [ROLES.ADMIN, ROLES.BUSINESS_SUPPORT] },
  {
    from: STATUS.BOOKS_CLOSED,
    to: STATUS.UNDER_MANAGER_REVIEW,
    roles: [ROLES.ADMIN],
    reasonRequiredForRoles: [ROLES.ADMIN],
    requiresNoPayments: true,
    requiresVersion: true,
  },
  { from: STATUS.BOOKS_CLOSED, to: STATUS.PAYMENT_IN_PROGRESS, roles: [ROLES.ADMIN, ROLES.BUSINESS_SUPPORT] },
  { from: STATUS.PAYMENT_IN_PROGRESS, to: STATUS.PARTIALLY_PAID, roles: [ROLES.ADMIN, ROLES.BUSINESS_SUPPORT] },
  { from: STATUS.PAYMENT_IN_PROGRESS, to: STATUS.PAID, roles: [ROLES.ADMIN, ROLES.BUSINESS_SUPPORT] },
  { from: STATUS.PARTIALLY_PAID, to: STATUS.PAID, roles: [ROLES.ADMIN, ROLES.BUSINESS_SUPPORT] },
  { from: STATUS.PAID, to: STATUS.LOCKED, roles: [ROLES.ADMIN] },
])

const statusValues = new Set(Object.values(MONTHLY_COMPENSATION_STATUS))

const paymentExists = (period) => period?.hasPayments === true
  || (Number.isSafeInteger(period?.paymentCount) && period.paymentCount > 0)
  || (Array.isArray(period?.payments) && period.payments.length > 0)

const actorHasStoreScope = (role, actor, period) => {
  if (![ROLES.BUSINESS_SUPPORT, ROLES.STORE_MANAGER].includes(role)) return true
  const periodStoreId = normalizeId(period?.storeId)
  if (!periodStoreId) return false
  if (role === ROLES.STORE_MANAGER) return normalizeId(actor?.storeId) === periodStoreId
  // HTKD is an all-store operational role and is not restricted by per-store assignments.
  return true
}

export function evaluateMonthlyCompensationTransition({
  fromStatus,
  toStatus,
  actor = {},
  period = {},
  reason = '',
  expectedVersion,
} = {}) {
  if (!statusValues.has(fromStatus) || !statusValues.has(toStatus)) {
    return { allowed: false, code: 'MONTHLY_COMPENSATION_STATUS_INVALID' }
  }
  if (fromStatus === STATUS.LOCKED) {
    return { allowed: false, code: 'MONTHLY_COMPENSATION_LOCKED' }
  }
  const rule = MONTHLY_COMPENSATION_TRANSITIONS.find(
    (transition) => transition.from === fromStatus && transition.to === toStatus,
  )
  if (!rule) return { allowed: false, code: 'MONTHLY_COMPENSATION_TRANSITION_NOT_ALLOWED' }

  const role = normalizeRole(actor?.role)
  if (!rule.roles.includes(role)) {
    return { allowed: false, code: 'MONTHLY_COMPENSATION_ROLE_FORBIDDEN' }
  }
  if (!actorHasStoreScope(role, actor, period)) {
    return { allowed: false, code: 'MONTHLY_COMPENSATION_STORE_SCOPE_FORBIDDEN' }
  }
  if (rule.reasonRequiredForRoles?.includes(role) && !hasReason(reason)) {
    return { allowed: false, code: 'MONTHLY_COMPENSATION_REASON_REQUIRED' }
  }
  if (rule.requiresNoPayments && paymentExists(period)) {
    return { allowed: false, code: 'MONTHLY_COMPENSATION_PAYMENT_EXISTS' }
  }
  if (rule.requiresVersion) {
    if (!Number.isSafeInteger(expectedVersion) || !Number.isSafeInteger(period?.version)) {
      return { allowed: false, code: 'MONTHLY_COMPENSATION_VERSION_REQUIRED' }
    }
    if (expectedVersion !== period.version) {
      return { allowed: false, code: 'MONTHLY_COMPENSATION_VERSION_CONFLICT' }
    }
  }
  return { allowed: true, code: 'MONTHLY_COMPENSATION_TRANSITION_ALLOWED', rule }
}

export const canTransitionMonthlyCompensation = (input) => (
  evaluateMonthlyCompensationTransition(input).allowed
)

export function assertMonthlyCompensationTransition(input) {
  const result = evaluateMonthlyCompensationTransition(input)
  if (!result.allowed) throw new RangeError(result.code)
  return result.rule
}

export function assertNoSelfApproval({ submittedById, approverId } = {}) {
  const submittedBy = normalizeId(submittedById)
  const approver = normalizeId(approverId)
  if (!submittedBy || !approver) throw new TypeError('submittedById and approverId are required.')
  if (submittedBy.toLowerCase() === approver.toLowerCase()) throw new RangeError('SELF_APPROVAL_FORBIDDEN')
  return true
}
