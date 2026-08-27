const normalizeViolationUnit = (value) => String(value ?? '')
  .trim()
  .toLocaleLowerCase('vi-VN')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/gu, '')
  .replaceAll('đ', 'd')

export const canonicalViolationTargetUnit = (record = {}) => {
  const unit = normalizeViolationUnit(record.targetUnit || record.targetGroup || record.unit || record.employeeUnit)
  if (['business_support', 'business-support', 'business support', 'support', 'htkd', 'ho tro kinh doanh', 'nhan vien ho tro kd'].includes(unit)) return 'business_support'
  if (['office', 'back_office', 'kvp', 'van phong', 'khoi van phong', 'vp'].includes(unit)) return 'office'
  // Store violations predate targetUnit; readers historically classify missing
  // and other non-office/non-support values as store employee violations.
  return 'store'
}
