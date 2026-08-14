import { createFinanceTransaction, upsertFinanceTransaction } from './finance'

const normalizeText = (value) => String(value ?? '')
  .trim()
  .toLowerCase()
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/đ/g, 'd')

const CONFIRMED_STATUSES = new Set(['confirmed', 'paid', 'completed', 'da chi', 'da xac nhan'])

const money = (value, field = 'amount') => {
  const amount = Number(value)
  if (!Number.isSafeInteger(amount) || amount < 0) throw new TypeError(`${field} must be a non-negative integer amount in VND.`)
  return amount
}

const amountOf = (record) => money(record?.amount ?? record?.value ?? 0)

export const isConfirmedPayrollRecord = (record = {}) => {
  const status = normalizeText(record.status || record.paymentStatus || record.salaryPaymentStatus)
  return CONFIRMED_STATUSES.has(status) || status.startsWith('da xac nhan')
}

const sumValues = (value, { confirmedOnly = false } = {}) => {
  if (value == null) return 0
  if (!Array.isArray(value)) return money(value)
  return value.reduce((total, item) => {
    if (confirmedOnly && typeof item !== 'number' && !isConfirmedPayrollRecord(item)) return total
    return total + (typeof item === 'number' ? money(item) : amountOf(item))
  }, 0)
}

export const SALARY_ADVANCE_STATUS = Object.freeze({
  NEW: 'Mới tạo',
  PAID: 'Đã chi',
})

export const PAYROLL_PAYMENT_STATUS = Object.freeze({
  DRAFT: 'Nháp',
  CONFIRMED: 'Đã xác nhận chi',
})

export function calculateAvailableSalary({
  basePay = 0,
  actualPay,
  kpiBonus = 0,
  otherBonus = 0,
  bonuses = [],
  tiktokAllowance = 0,
  otherAllowance = 0,
  allowances = [],
  confirmedAdvances = [],
  confirmedDeductions = [],
} = {}) {
  const salary = money(actualPay ?? basePay, 'basePay')
  const bonus = money(kpiBonus, 'kpiBonus') + money(otherBonus, 'otherBonus') + sumValues(bonuses)
  const allowance = money(tiktokAllowance, 'tiktokAllowance') + money(otherAllowance, 'otherAllowance') + sumValues(allowances)
  const advances = sumValues(confirmedAdvances, { confirmedOnly: Array.isArray(confirmedAdvances) })
  const deductions = sumValues(confirmedDeductions, { confirmedOnly: Array.isArray(confirmedDeductions) })
  const grossPay = salary + bonus + allowance
  return {
    basePay: salary,
    bonus,
    allowance,
    grossPay,
    confirmedAdvances: advances,
    confirmedDeductions: deductions,
    availableSalary: Math.max(0, grossPay - advances - deductions),
  }
}

export function validateSalaryAdvance({ amount, availableSalary } = {}) {
  const errors = []
  const normalizedAmount = Number(amount)
  const available = Number(availableSalary)
  if (!Number.isSafeInteger(normalizedAmount) || normalizedAmount <= 0) errors.push('AMOUNT_MUST_BE_POSITIVE_INTEGER')
  if (!Number.isSafeInteger(available) || available < 0) errors.push('AVAILABLE_SALARY_INVALID')
  if (!errors.length && normalizedAmount >= available) errors.push('AMOUNT_MUST_BE_LESS_THAN_AVAILABLE_SALARY')
  return { valid: errors.length === 0, errors, amount: normalizedAmount, availableSalary: available }
}

export function createSalaryAdvance({
  id,
  storeId,
  employeeId,
  employeeName = '',
  amount,
  availableSalary,
  note = '',
  createdAt,
  createdBy,
  idempotencyKey,
} = {}) {
  if (!id || !storeId || !employeeId) throw new TypeError('id, storeId, and employeeId are required.')
  if (!createdAt || !createdBy) throw new TypeError('createdAt and createdBy must come from the caller/server.')
  const validation = validateSalaryAdvance({ amount, availableSalary })
  if (!validation.valid) throw new RangeError(validation.errors.join(','))
  return {
    id: String(id),
    storeId: String(storeId),
    employeeId: String(employeeId),
    employeeName,
    amount: validation.amount,
    availableSalaryAtCreation: validation.availableSalary,
    remainingSalaryAfterAdvance: validation.availableSalary - validation.amount,
    note: String(note || '').trim(),
    createdAt,
    createdBy,
    status: SALARY_ADVANCE_STATUS.NEW,
    idempotencyKey: idempotencyKey || `salary-advance:${id}:create`,
  }
}

export function confirmSalaryAdvance({
  advances = [],
  transactions = [],
  advanceId,
  currentAvailableSalary,
  confirmedAt,
  confirmedBy,
} = {}) {
  const index = advances.findIndex((advance) => String(advance.id) === String(advanceId))
  if (index < 0) throw new RangeError('SALARY_ADVANCE_NOT_FOUND')
  const current = advances[index]
  if (isConfirmedPayrollRecord(current)) {
    return { advances, transactions, advance: current, changed: false, alreadyConfirmed: true }
  }
  if (!confirmedAt || !confirmedBy) throw new TypeError('confirmedAt and confirmedBy must come from the caller/server.')
  const validation = validateSalaryAdvance({ amount: current.amount, availableSalary: currentAvailableSalary })
  if (!validation.valid) throw new RangeError(validation.errors.join(','))

  const advance = {
    ...current,
    status: SALARY_ADVANCE_STATUS.PAID,
    confirmedAt,
    confirmedBy,
    availableSalaryAtConfirmation: validation.availableSalary,
    remainingSalaryAfterPayment: validation.availableSalary - validation.amount,
  }
  const nextAdvances = [...advances]
  nextAdvances[index] = advance
  const transactionPayload = createFinanceTransaction({
    id: `TX-ADV-${current.id}`,
    idempotencyKey: `salary-advance:${current.id}:paid`,
    storeId: current.storeId,
    direction: 'out',
    type: 'salary_advance',
    category: 'salary',
    amount: validation.amount,
    status: 'confirmed',
    occurredAt: confirmedAt,
    sourceType: 'salaryAdvance',
    sourceId: current.id,
    employeeId: current.employeeId,
    confirmedBy,
  })
  const upserted = upsertFinanceTransaction(transactions, transactionPayload)
  return {
    advances: nextAdvances,
    transactions: upserted.transactions,
    advance,
    transaction: upserted.transaction,
    changed: true,
    alreadyConfirmed: false,
  }
}

export function calculateRemainingPayroll({
  grossPay,
  confirmedAdvances = [],
  confirmedDeductions = [],
  confirmedPayrollPayments = [],
} = {}) {
  const gross = money(grossPay, 'grossPay')
  const advances = sumValues(confirmedAdvances, { confirmedOnly: Array.isArray(confirmedAdvances) })
  const deductions = sumValues(confirmedDeductions, { confirmedOnly: Array.isArray(confirmedDeductions) })
  const payments = sumValues(confirmedPayrollPayments, { confirmedOnly: Array.isArray(confirmedPayrollPayments) })
  return {
    grossPay: gross,
    confirmedAdvances: advances,
    confirmedDeductions: deductions,
    confirmedPayrollPayments: payments,
    remainingPayable: Math.max(0, gross - advances - deductions - payments),
  }
}

export function confirmPayrollPayment({
  periods = [],
  transactions = [],
  periodId,
  confirmedAt,
  confirmedBy,
} = {}) {
  const index = periods.findIndex((period) => String(period.id) === String(periodId))
  if (index < 0) throw new RangeError('PAYROLL_PERIOD_NOT_FOUND')
  const current = periods[index]
  if (isConfirmedPayrollRecord({ status: current.salaryPaymentStatus || current.paymentStatus })) {
    return { periods, transactions, period: current, changed: false, alreadyConfirmed: true }
  }
  if (!confirmedAt || !confirmedBy) throw new TypeError('confirmedAt and confirmedBy must come from the caller/server.')
  const calculation = calculateRemainingPayroll({
    grossPay: current.grossPay ?? current.totalPay ?? 0,
    confirmedAdvances: current.advances || current.confirmedAdvances || [],
    confirmedDeductions: current.deductions || current.confirmedDeductions || [],
    confirmedPayrollPayments: current.previousPayments || [],
  })
  const period = {
    ...current,
    salaryPaymentStatus: PAYROLL_PAYMENT_STATUS.CONFIRMED,
    salaryPaidAt: confirmedAt,
    salaryPaidBy: confirmedBy,
    salaryPaidAmount: calculation.remainingPayable,
    paymentCalculationSnapshot: calculation,
  }
  const nextPeriods = [...periods]
  nextPeriods[index] = period
  let nextTransactions = transactions
  let transaction = null
  if (calculation.remainingPayable > 0) {
    const upserted = upsertFinanceTransaction(transactions, {
      id: `TX-PAYROLL-${current.id}`,
      idempotencyKey: `payroll-period:${current.id}:salary-paid`,
      storeId: current.storeId,
      direction: 'out',
      type: 'salary_payment',
      category: 'salary',
      amount: calculation.remainingPayable,
      status: 'confirmed',
      occurredAt: confirmedAt,
      sourceType: 'payrollPeriod',
      sourceId: current.id,
      confirmedBy,
    })
    nextTransactions = upserted.transactions
    transaction = upserted.transaction
  }
  return {
    periods: nextPeriods,
    transactions: nextTransactions,
    period,
    transaction,
    changed: true,
    alreadyConfirmed: false,
  }
}
