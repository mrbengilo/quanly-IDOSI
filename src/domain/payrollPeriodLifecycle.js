const PAYROLL_PERIOD_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/u
const BUSINESS_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u

export const payrollPeriodActionDate = (period) => {
  const match = String(period || '').trim().match(PAYROLL_PERIOD_PATTERN)
  if (!match) return ''
  const year = Number(match[1])
  const month = Number(match[2])
  const nextYear = month === 12 ? year + 1 : year
  const nextMonth = month === 12 ? 1 : month + 1
  return `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`
}

export const isPayrollPeriodActionable = (period, currentBusinessDate) => {
  const actionDate = payrollPeriodActionDate(period)
  const currentDate = String(currentBusinessDate || '').trim()
  return Boolean(actionDate && BUSINESS_DATE_PATTERN.test(currentDate) && currentDate >= actionDate)
}
