const asFiniteNonNegative = (value, field) => {
  const number = Number(value)
  if (!Number.isFinite(number) || number < 0) throw new TypeError(`${field} must be a non-negative number.`)
  return number
}

const asRatePercent = (value, field = 'ratePercent') => asFiniteNonNegative(value, field)

const clonePolicy = (policy) => JSON.parse(JSON.stringify(policy))

export function normalizeKpiTiers(tiers = []) {
  if (!Array.isArray(tiers) || !tiers.length) throw new TypeError('At least one employee KPI tier is required.')
  const normalized = tiers.map((tier, index) => ({
    threshold: asFiniteNonNegative(tier.threshold ?? tier.minimumProfitPerHour, `tiers[${index}].threshold`),
    ratePercent: asRatePercent(tier.ratePercent ?? tier.percent, `tiers[${index}].ratePercent`),
  })).sort((left, right) => right.threshold - left.threshold)
  const thresholds = new Set(normalized.map((tier) => tier.threshold))
  if (thresholds.size !== normalized.length) throw new TypeError('KPI tier thresholds must be unique.')
  return normalized
}

export function selectEmployeeKpiTier(profitPerHour, tiers) {
  const hourlyProfit = Number(profitPerHour)
  if (!Number.isFinite(hourlyProfit) || hourlyProfit < 0) return null
  return normalizeKpiTiers(tiers).find((tier) => hourlyProfit >= tier.threshold) || null
}

export function calculateKpiBonuses({
  profit,
  participants = [],
  employeeTiers,
  policyId = '',
  policyEffectiveAt = '',
} = {}) {
  const normalizedProfit = Number(profit)
  if (!Number.isFinite(normalizedProfit)) throw new TypeError('profit must be a finite number.')
  if (!Array.isArray(participants)) throw new TypeError('participants must be an array.')

  const ids = new Set()
  const people = participants.map((participant, index) => {
    const id = String(participant.id || participant.employeeId || '').trim()
    if (!id) throw new TypeError(`participants[${index}].id is required.`)
    if (ids.has(id)) throw new TypeError(`Duplicate KPI participant id: ${id}`)
    ids.add(id)
    const role = String(participant.role || participant.type || 'employee').toLowerCase()
    if (role !== 'employee') throw new TypeError(`participants[${index}].role must be employee.`)
    return {
      ...participant,
      id,
      role,
      hours: asFiniteNonNegative(participant.hours, `participants[${index}].hours`),
    }
  })
  const tiers = normalizeKpiTiers(employeeTiers)
  const totalHours = people.reduce((total, participant) => total + participant.hours, 0)
  const policySnapshot = clonePolicy({
    policyId,
    effectiveAt: policyEffectiveAt,
    employeeTiers: tiers,
  })

  if (normalizedProfit <= 0 || totalHours === 0) {
    return {
      eligible: false,
      reason: normalizedProfit <= 0 ? 'NON_POSITIVE_PROFIT' : 'NO_WORKED_HOURS',
      profit: normalizedProfit,
      totalHours,
      profitPerHour: totalHours ? normalizedProfit / totalHours : 0,
      employeeTier: null,
      results: people.map((participant) => ({ ...participant, ratePercent: 0, amount: 0 })),
      totalBonus: 0,
      policySnapshot,
    }
  }

  const profitPerHour = normalizedProfit / totalHours
  const employeeTier = selectEmployeeKpiTier(profitPerHour, tiers)
  const results = people.map((participant) => {
    const ratePercent = employeeTier?.ratePercent || 0
    const amount = Math.floor((participant.hours / totalHours) * (ratePercent / 100) * normalizedProfit)
    return { ...participant, ratePercent, amount }
  })
  return {
    eligible: true,
    reason: '',
    profit: normalizedProfit,
    totalHours,
    profitPerHour,
    employeeTier,
    results,
    totalBonus: results.reduce((total, result) => total + result.amount, 0),
    policySnapshot,
  }
}

export const calculateKpi = calculateKpiBonuses
