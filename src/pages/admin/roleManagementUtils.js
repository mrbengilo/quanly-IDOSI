import { today } from '../../utils'

export const ROLE_KEYS = Object.freeze({
  businessSupport: 'business_support',
  storeManager: 'store_manager',
})

export const ROLE_CODES = Object.freeze({
  [ROLE_KEYS.businessSupport]: 'HTKD',
  [ROLE_KEYS.storeManager]: 'QLCH',
})

export const ROLE_POSITIONS = Object.freeze({
  [ROLE_KEYS.businessSupport]: 'NV hỗ trợ KD',
  [ROLE_KEYS.storeManager]: 'Quản lý cửa hàng',
})

export const EMPLOYMENT_TYPES = Object.freeze(['Full-Time', 'Part-Time', 'Thực Tập Sinh'])

const normalize = (value = '') => String(value).trim().toLocaleLowerCase('vi-VN').replaceAll('-', '_').replaceAll(' ', '_')
const profileCode = (profile = {}) => String(profile.code || profile.employeeCode || profile.id || '')
const profileRoleValues = (profile = {}) => [
  profile.unit,
  profile.unitType,
  profile.department,
  profile.employeeGroup,
  profile.accessRole,
  profile.accountRole,
  profile.systemRole,
  profile.roleType,
  profile.profileType,
  profile.role,
].map(normalize)

export const roleEmploymentType = (profile = {}) => {
  const raw = String(profile.employmentType || profile.employeeType || profile.officeEmployeeType || profile.officeEmploymentType || profile.contractType || '')
  const normalized = raw.normalize('NFD').replace(/[\u0300-\u036f]/gu, '').trim().toLocaleLowerCase('vi-VN')
  if (normalized.includes('part')) return 'Part-Time'
  if (normalized.includes('thuc tap')) return 'Thực Tập Sinh'
  return 'Full-Time'
}

const identityImagesFromProfile = (profile = {}) => {
  const images = profile.identityImages && typeof profile.identityImages === 'object' ? profile.identityImages : {}
  return {
    front: images.front || profile.cccdFrontImage || '',
    back: images.back || profile.cccdBackImage || '',
  }
}

export const roleProfileCode = profileCode

export const profileMatchesRole = (profile = {}, roleKey = '') => {
  const target = normalize(roleKey)
  if (profileRoleValues(profile).includes(target)) return true
  if (target === ROLE_KEYS.businessSupport) {
    return Boolean(profile.isBusinessSupport)
      || ['business_support', 'sales_support', 'nhan_vien_ho_tro_kd', 'hỗ_trợ_kinh_doanh'].includes(normalize(profile.employeeGroup || profile.department))
  }
  if (target === ROLE_KEYS.storeManager) {
    return Boolean(profile.isStoreManager)
      || ['store_manager', 'quan_ly_cua_hang', 'quản_lý_cửa_hàng'].includes(normalize(profile.employeeGroup || profile.department))
  }
  return false
}

export const roleProfilesFromApp = (app = {}, roleKey = '') => {
  const dedicatedKey = roleKey === ROLE_KEYS.businessSupport ? 'businessSupportEmployees' : 'storeManagers'
  if (Array.isArray(app[dedicatedKey])) return app[dedicatedKey]
  return (Array.isArray(app.employees) ? app.employees : []).filter((profile) => profileMatchesRole(profile, roleKey))
}

export const nextRoleCode = (profiles = [], roleKey = '') => {
  const prefix = ROLE_CODES[roleKey] || 'NV'
  const pattern = new RegExp(`^${prefix}-?(\\d+)$`, 'iu')
  const largest = profiles.reduce((current, profile) => {
    const match = pattern.exec(profileCode(profile))
    return match ? Math.max(current, Number(match[1])) : current
  }, 0)
  return `${prefix}-${String(largest + 1).padStart(3, '0')}`
}

export const roleProfileAddress = (profile = {}) => {
  if (typeof profile.address === 'string' && profile.address.trim()) return profile.address.trim()
  const nested = profile.address && typeof profile.address === 'object' ? profile.address : {}
  const parts = [
    profile.street || profile.addressStreet || nested.street,
    profile.ward || profile.addressWard || nested.ward,
    profile.province || profile.addressProvince || nested.province || nested.provinceCity,
  ]
  return parts.filter(Boolean).join(', ') || '—'
}

export const formatRoleDate = (value) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})/u.exec(String(value || ''))
  return match ? `${match[3]}/${match[2]}/${match[1].slice(-2)}` : '—'
}

export const emptyRoleProfile = (roleKey = ROLE_KEYS.businessSupport) => ({
  code: '',
  name: '',
  phone: '',
  cccd: '',
  address: '',
  startDate: today(),
  employmentType: EMPLOYMENT_TYPES[0],
  position: ROLE_POSITIONS[roleKey],
  identityImages: { front: '', back: '' },
  username: '',
  password: '',
  storeId: '',
})

export const roleProfileToForm = (profile = {}, roleKey = ROLE_KEYS.businessSupport) => ({
  ...emptyRoleProfile(roleKey),
  code: profileCode(profile),
  name: profile.name || '',
  phone: String(profile.phone || ''),
  cccd: String(profile.cccd || profile.citizenId || ''),
  address: roleProfileAddress(profile) === '—' ? '' : roleProfileAddress(profile),
  startDate: profile.startDate || profile.joinDate || profile.employmentStartDate || profile.hireDate || '',
  employmentType: roleEmploymentType(profile),
  position: ROLE_POSITIONS[roleKey],
  identityImages: identityImagesFromProfile(profile),
  username: profile.username || '',
  password: '',
  storeId: profile.storeId === 'OFFICE' || profile.storeId === 'BUSINESS_SUPPORT'
    ? ''
    : profile.storeId || profile.assignedStoreId || '',
})

export const validateRoleProfile = ({ form, profiles = [], editingKey = '', requiresPassword = !editingKey, roleKey = ROLE_KEYS.businessSupport } = {}) => {
  const errors = []
  const required = [
    ['Mã nhân viên', form?.code],
    ['Tên nhân viên', form?.name],
    ['Số điện thoại', form?.phone],
    ['CCCD', form?.cccd],
    ['Địa chỉ', form?.address],
    ['Ngày bắt đầu làm', form?.startDate],
    ['Loại nhân viên', form?.employmentType],
    ['Vị trí công việc', form?.position],
    ['Tên đăng nhập', form?.username],
  ]
  if (roleKey === ROLE_KEYS.storeManager) required.unshift(['Cửa hàng quản lý', form?.storeId])
  required.forEach(([label, value]) => {
    if (!String(value ?? '').trim()) errors.push(`${label} là trường bắt buộc.`)
  })

  if (!/^0\d{9}$/u.test(String(form?.phone || ''))) errors.push('Số điện thoại phải gồm đúng 10 chữ số và bắt đầu bằng số 0.')
  if (!/^\d{12}$/u.test(String(form?.cccd || ''))) errors.push('CCCD phải gồm đúng 12 chữ số.')
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(String(form?.startDate || ''))) errors.push('Ngày bắt đầu làm không hợp lệ.')
  if (!EMPLOYMENT_TYPES.includes(form?.employmentType)) errors.push('Loại nhân viên không hợp lệ.')
  if (String(form?.position || '') !== ROLE_POSITIONS[roleKey]) errors.push('Vị trí công việc không đúng với vai trò tài khoản.')
  if (requiresPassword && String(form?.password || '').length < 8) errors.push('Mật khẩu phải có ít nhất 8 ký tự.')
  if (!requiresPassword && form?.password && String(form.password).length < 8) errors.push('Mật khẩu mới phải có ít nhất 8 ký tự.')

  const others = profiles.filter((profile) => String(profile.id || profileCode(profile)) !== String(editingKey || ''))
  if (others.some((profile) => normalize(profileCode(profile)) === normalize(form?.code))) errors.push('Mã nhân viên đã tồn tại.')
  if (others.some((profile) => String(profile.cccd || profile.citizenId || '') === String(form?.cccd))) errors.push('CCCD đã được sử dụng.')
  if (others.some((profile) => normalize(profile.username) === normalize(form?.username))) errors.push('Tên đăng nhập đã tồn tại.')
  if (others.some((profile) => String(profile.phone || '').replace(/\D/gu, '') === String(form?.phone || ''))) errors.push('Số điện thoại đã được sử dụng.')
  return [...new Set(errors)]
}

export const roleProfilePayload = (form = {}, roleKey = ROLE_KEYS.businessSupport) => {
  const isStoreManager = roleKey === ROLE_KEYS.storeManager
  const position = ROLE_POSITIONS[roleKey]
  const identityImages = Object.fromEntries(['front', 'back'].flatMap((side) => {
    const value = form.identityImages?.[side]
    return typeof value === 'string' && /^data:image\//u.test(value) ? [[side, value]] : []
  }))
  return {
    name: form.name.trim(),
    phone: form.phone,
    cccd: form.cccd,
    address: form.address.trim(),
    startDate: form.startDate,
    employmentType: form.employmentType,
    position,
    ...(Object.keys(identityImages).length ? { identityImages } : {}),
    username: form.username.trim(),
    ...(form.password ? { password: form.password } : {}),
    unit: roleKey,
    storeId: isStoreManager ? form.storeId : 'BUSINESS_SUPPORT',
  }
}
