const vnd = (value, field) => {
  const normalized = Number(value)
  if (!Number.isSafeInteger(normalized) || normalized < 0) {
    throw new TypeError(`${field} must be a non-negative integer amount in VND.`)
  }
  return normalized
}

const safeVndSum = (values, field) => {
  const total = values.reduce((sum, value) => sum + BigInt(value), 0n)
  if (total > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError(`${field} exceeds the safe integer range.`)
  }
  return Number(total)
}

/**
 * Applies violations in the canonical order: bonus, allowance, then salary.
 * Any excess remains a receivable instead of making employee net pay negative.
 */
export function applyViolationWaterfall({
  violationVnd = 0,
  bonusVnd = 0,
  allowanceVnd = 0,
  salaryVnd = 0,
} = {}) {
  const violation = vnd(violationVnd, 'violationVnd')
  const bonus = vnd(bonusVnd, 'bonusVnd')
  const allowance = vnd(allowanceVnd, 'allowanceVnd')
  const salary = vnd(salaryVnd, 'salaryVnd')
  const grossPayVnd = safeVndSum([bonus, allowance, salary], 'grossPayVnd')

  const appliedToBonusVnd = Math.min(violation, bonus)
  let remainingViolationVnd = violation - appliedToBonusVnd
  const appliedToAllowanceVnd = Math.min(remainingViolationVnd, allowance)
  remainingViolationVnd -= appliedToAllowanceVnd
  const appliedToSalaryVnd = Math.min(remainingViolationVnd, salary)
  remainingViolationVnd -= appliedToSalaryVnd

  const appliedViolationVnd = safeVndSum(
    [appliedToBonusVnd, appliedToAllowanceVnd, appliedToSalaryVnd],
    'appliedViolationVnd',
  )
  const remainingBonusVnd = bonus - appliedToBonusVnd
  const remainingAllowanceVnd = allowance - appliedToAllowanceVnd
  const remainingSalaryVnd = salary - appliedToSalaryVnd
  const netPayVnd = safeVndSum(
    [remainingBonusVnd, remainingAllowanceVnd, remainingSalaryVnd],
    'netPayVnd',
  )

  return {
    grossPayVnd,
    violationVnd: violation,
    appliedToBonusVnd,
    appliedToAllowanceVnd,
    appliedToSalaryVnd,
    appliedViolationVnd,
    remainingBonusVnd,
    remainingAllowanceVnd,
    remainingSalaryVnd,
    netPayVnd,
    remainingReceivableVnd: remainingViolationVnd,
  }
}

/**
 * Applies a confirmed salary advance after the violation waterfall.
 * Unapplied advance is reported separately and is not reclassified as a violation receivable.
 */
export function applyAdvanceToNetPay({ netPayVnd = 0, advanceVnd = 0 } = {}) {
  const netPayBeforeAdvanceVnd = vnd(netPayVnd, 'netPayVnd')
  const normalizedAdvanceVnd = vnd(advanceVnd, 'advanceVnd')
  const appliedAdvanceVnd = Math.min(netPayBeforeAdvanceVnd, normalizedAdvanceVnd)
  return {
    netPayBeforeAdvanceVnd,
    advanceVnd: normalizedAdvanceVnd,
    appliedAdvanceVnd,
    netPayVnd: netPayBeforeAdvanceVnd - appliedAdvanceVnd,
    unappliedAdvanceVnd: normalizedAdvanceVnd - appliedAdvanceVnd,
  }
}
