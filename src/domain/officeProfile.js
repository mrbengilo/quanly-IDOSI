export const normalizeOfficeValue = (value) => String(value ?? '').trim().toLocaleLowerCase('vi-VN')

export const isOfficeProfile = (session = {}, employee = {}) => {
  session = session || {}
  employee = employee || {}
  const values = [
    session.unit,
    session.department,
    session.storeId,
    employee.unit,
    employee.department,
    employee.unitType,
    employee.storeId,
  ].map(normalizeOfficeValue)
  return Boolean(session.isOffice || employee.isOffice || values.some((value) => (
    value === 'office'
    || value === 'văn phòng'
    || value === 'khối văn phòng'
  )))
}
