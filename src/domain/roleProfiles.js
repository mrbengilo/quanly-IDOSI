const normalize = (value = '') => String(value).trim().toLocaleLowerCase('vi-VN').replaceAll('-', '_').replaceAll(' ', '_')

export const profileMatchesRole = (profile = {}, roleKey = '') => {
  const target = normalize(roleKey)
  const values = [
    profile.unit, profile.unitType, profile.department, profile.employeeGroup,
    profile.accessRole, profile.accountRole, profile.systemRole, profile.roleType,
    profile.profileType, profile.role,
  ].map(normalize)
  if (values.includes(target)) return true
  if (target === 'business_support') {
    return Boolean(profile.isBusinessSupport)
      || ['business_support', 'sales_support', 'nhan_vien_ho_tro_kd', 'hỗ_trợ_kinh_doanh'].includes(normalize(profile.employeeGroup || profile.department))
  }
  if (target === 'store_manager') {
    return Boolean(profile.isStoreManager)
      || ['store_manager', 'quan_ly_cua_hang', 'quản_lý_cửa_hàng'].includes(normalize(profile.employeeGroup || profile.department))
  }
  return false
}
