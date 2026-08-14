import { formatMoneyInput, parseMoneyInput, today } from '../../utils'

export const ROLE_KEYS = Object.freeze({
  businessSupport: 'business_support',
  storeManager: 'store_manager',
})

export const ROLE_CODES = Object.freeze({
  [ROLE_KEYS.businessSupport]: 'HTKD',
  [ROLE_KEYS.storeManager]: 'QLCH',
})

export const EMPLOYEE_STATUSES = Object.freeze(['Đang làm việc', 'Tạm ngưng', 'Đã nghỉ việc'])
export const OFFICE_EMPLOYEE_TYPES = Object.freeze(['Chính thức', 'Thực tập sinh', 'Thử việc'])

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

const storeCode = (store = {}) => String(store.employeePrefix || store.short || store.code || store.id || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/gu, '')
  .replace(/[^A-Za-z0-9]/gu, '')
  .toUpperCase()
  .slice(0, 12)

export const nextRoleCode = (profiles = [], roleKey = '', store = null) => {
  const storePrefix = roleKey === ROLE_KEYS.storeManager ? storeCode(store) : ''
  if (roleKey === ROLE_KEYS.storeManager && !storePrefix) return ''
  const prefix = roleKey === ROLE_KEYS.storeManager ? `QL-${storePrefix}` : ROLE_CODES[roleKey] || 'NV'
  const separator = roleKey === ROLE_KEYS.storeManager ? '-' : ''
  const largest = profiles.reduce((current, profile) => {
    const escapedPrefix = prefix.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
    const match = new RegExp(`^${escapedPrefix}${separator}(\\d+)$`, 'iu').exec(profileCode(profile))
    return match ? Math.max(current, Number(match[1])) : current
  }, 0)
  return `${prefix}${separator}${String(largest + 1).padStart(3, '0')}`
}

const addressParts = (profile = {}) => {
  const nested = typeof profile.address === 'object' && profile.address ? profile.address : {}
  return {
    province: profile.province || profile.addressProvince || nested.province || nested.provinceCity || '',
    ward: profile.ward || profile.addressWard || nested.ward || '',
    street: profile.street || profile.addressStreet || nested.street || (typeof profile.address === 'string' ? profile.address : ''),
  }
}

export const roleProfileAddress = (profile = {}) => {
  const address = addressParts(profile)
  return [address.street, address.ward, address.province].filter(Boolean).join(', ') || '—'
}

export const emptyRoleProfile = (roleKey = ROLE_KEYS.businessSupport) => ({
  code: '',
  name: '',
  cccd: '',
  phone: '',
  province: '',
  ward: '',
  street: '',
  salary: '',
  position: roleKey === ROLE_KEYS.storeManager ? 'Quản lý cửa hàng' : 'Nhân viên hỗ trợ kinh doanh',
  age: '',
  username: '',
  password: '',
  status: EMPLOYEE_STATUSES[0],
  officeEmployeeType: OFFICE_EMPLOYEE_TYPES[0],
  workStart: '08:00',
  workEnd: '17:00',
  standardWorkDaysPeriod: today().slice(0, 7),
  standardWorkDays: '26',
  startDate: today(),
  storeId: '',
})

export const roleProfileToForm = (profile = {}, roleKey = ROLE_KEYS.businessSupport) => {
  const empty = emptyRoleProfile(roleKey)
  const address = addressParts(profile)
  const targetPeriod = today().slice(0, 7)
  return {
    ...empty,
    code: profileCode(profile),
    name: profile.name || '',
    cccd: String(profile.cccd || profile.citizenId || ''),
    phone: profile.phone || '',
    province: address.province,
    ward: address.ward,
    street: address.street,
    salary: formatMoneyInput(profile.monthlySalary || profile.salary),
    position: profile.position || profile.workPosition || empty.position,
    age: profile.age ?? '',
    username: profile.username || '',
    password: '',
    status: profile.status || EMPLOYEE_STATUSES[0],
    officeEmployeeType: profile.officeEmployeeType || profile.officeEmploymentType || profile.contractType || profile.employmentType || profile.employeeType || OFFICE_EMPLOYEE_TYPES[0],
    workStart: profile.workStart || '08:00',
    workEnd: profile.workEnd || '17:00',
    standardWorkDaysPeriod: targetPeriod,
    standardWorkDays: String(profile.monthlyWorkdayTargets?.[targetPeriod] || profile.standardWorkDays || 26),
    startDate: profile.startDate || profile.employmentStartDate || profile.hireDate || '',
    storeId: profile.storeId === 'OFFICE' ? '' : profile.storeId || profile.assignedStoreId || '',
  }
}

const minutesFromTime = (value = '') => {
  const match = /^(\d{2}):(\d{2})$/u.exec(String(value))
  if (!match) return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  return hours <= 23 && minutes <= 59 ? hours * 60 + minutes : null
}

export const validateRoleProfile = ({ form, profiles = [], editingKey = '', requiresPassword = !editingKey, roleKey = ROLE_KEYS.businessSupport } = {}) => {
  const errors = []
  const required = [
    ['Mã nhân viên', form?.code],
    ['Tên nhân viên', form?.name],
    ['Loại nhân viên', form?.officeEmployeeType],
    ['Số CCCD', form?.cccd],
    ['Số điện thoại', form?.phone],
    ['Tỉnh/Thành phố', form?.province],
    ['Phường/Xã', form?.ward],
    ['Đường, số nhà', form?.street],
    ['Lương', form?.salary],
    ['Vị trí công việc', form?.position],
    ['Tuổi', form?.age],
    ['Tên đăng nhập', form?.username],
    ['Giờ bắt đầu', form?.workStart],
    ['Giờ kết thúc', form?.workEnd],
    ['Tháng quy định ngày công', form?.standardWorkDaysPeriod],
    ['Số ngày công quy định', form?.standardWorkDays],
    ['Ngày bắt đầu làm', form?.startDate],
  ]
  if (roleKey === ROLE_KEYS.storeManager) required.push(['Cửa hàng quản lý', form?.storeId])
  required.forEach(([label, value]) => {
    if (!String(value ?? '').trim()) errors.push(`${label} là trường bắt buộc.`)
  })

  if (!/^\d{12}$/u.test(String(form?.cccd || ''))) errors.push('Số CCCD phải gồm đúng 12 chữ số.')
  if (!/^0\d{9}$/u.test(String(form?.phone || ''))) errors.push('Số điện thoại phải gồm đúng 10 chữ số và bắt đầu bằng số 0.')
  if (parseMoneyInput(form?.salary) <= 0) errors.push('Lương phải là số lớn hơn 0.')
  if (!Number.isInteger(Number(form?.age)) || Number(form.age) < 18 || Number(form.age) > 100) errors.push('Tuổi phải là số nguyên từ 18 đến 100.')
  const workStart = minutesFromTime(form?.workStart)
  const workEnd = minutesFromTime(form?.workEnd)
  if (workStart == null || workEnd == null || workEnd <= workStart) errors.push('Giờ làm phải đúng định dạng 24 giờ và giờ kết thúc phải sau giờ bắt đầu.')
  if (!/^\d{4}-\d{2}$/u.test(String(form?.standardWorkDaysPeriod || ''))) errors.push('Tháng quy định ngày công không hợp lệ.')
  if (!Number.isInteger(Number(form?.standardWorkDays)) || Number(form.standardWorkDays) < 1 || Number(form.standardWorkDays) > 31) errors.push('Số ngày công quy định phải từ 1 đến 31.')
  if (form?.startDate && !/^\d{4}-\d{2}-\d{2}$/u.test(String(form.startDate))) errors.push('Ngày bắt đầu làm không hợp lệ.')
  if (requiresPassword && String(form?.password || '').length < 8) errors.push('Mật khẩu phải có ít nhất 8 ký tự.')
  if (!requiresPassword && form?.password && String(form.password).length < 8) errors.push('Mật khẩu mới phải có ít nhất 8 ký tự.')

  const others = profiles.filter((profile) => String(profile.id || profileCode(profile)) !== String(editingKey || ''))
  if (others.some((profile) => normalize(profileCode(profile)) === normalize(form?.code))) errors.push('Mã nhân viên đã tồn tại.')
  if (others.some((profile) => String(profile.cccd || profile.citizenId || '') === String(form?.cccd))) errors.push('Số CCCD đã được sử dụng.')
  if (others.some((profile) => normalize(profile.username) === normalize(form?.username))) errors.push('Tên đăng nhập đã tồn tại.')
  if (others.some((profile) => String(profile.phone || '').replace(/\D/gu, '') === String(form?.phone || ''))) errors.push('Số điện thoại đã được sử dụng.')
  return [...new Set(errors)]
}

export const roleProfilePayload = (form = {}, roleKey = ROLE_KEYS.businessSupport) => {
  const isStoreManager = roleKey === ROLE_KEYS.storeManager
  const address = [form.street.trim(), form.ward.trim(), form.province.trim()].join(', ')
  return {
    name: form.name.trim(),
    cccd: form.cccd,
    phone: form.phone,
    province: form.province.trim(),
    ward: form.ward.trim(),
    street: form.street.trim(),
    address,
    addressDetails: { province: form.province.trim(), ward: form.ward.trim(), street: form.street.trim() },
    salary: parseMoneyInput(form.salary),
    monthlySalary: parseMoneyInput(form.salary),
    payBasis: 'monthly',
    position: form.position.trim(),
    workPosition: form.position.trim(),
    shortRole: form.position.trim(),
    age: Number(form.age),
    username: form.username.trim(),
    ...(form.password ? { password: form.password } : {}),
    status: form.status,
    officeEmployeeType: form.officeEmployeeType,
    officeEmploymentType: form.officeEmployeeType,
    contractType: form.officeEmployeeType,
    employmentType: form.officeEmployeeType,
    employeeType: form.officeEmployeeType,
    workStart: form.workStart,
    workEnd: form.workEnd,
    standardWorkDays: Number(form.standardWorkDays),
    standardWorkDaysPeriod: form.standardWorkDaysPeriod,
    monthlyWorkdayTargets: { [form.standardWorkDaysPeriod]: Number(form.standardWorkDays) },
    startDate: form.startDate,
    employmentStartDate: form.startDate,
    accessRole: roleKey,
    accountRole: roleKey,
    systemRole: roleKey,
    roleType: roleKey,
    employeeGroup: roleKey,
    isBusinessSupport: !isStoreManager,
    isStoreManager,
    unit: roleKey,
    unitType: roleKey,
    department: roleKey,
    isOffice: false,
    storeId: isStoreManager ? form.storeId : 'BUSINESS_SUPPORT',
    assignedStoreId: isStoreManager ? form.storeId : '',
  }
}
