const PHONE_PATTERN = /^0\d{9}$/
const CCCD_PATTERN = /^\d{12}$/

const normalizePhone = (value = '') => String(value).replace(/[\s.()-]/g, '')
const normalizeText = (value = '') => String(value).trim().toLowerCase()

export const parseStoreMoneyInput = (value) => Number(String(value ?? '').replace(/\D/g, '')) || 0

export const formatStoreMoneyInput = (value) => {
  const amount = parseStoreMoneyInput(value)
  return amount ? new Intl.NumberFormat('en-US').format(amount) : ''
}

export const isPartTimeEmployee = (value) => String(value || '').toLowerCase() === 'part-time'
export const normalizeStoreEmploymentType = (value) => isPartTimeEmployee(value) ? 'Part-Time' : 'Full-Time'

const normalizeCredentialToken = (value = '') => String(value)
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[Đđ]/g, 'd')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '')

const employeeGivenName = (name = '') => normalizeCredentialToken(name).split('-').filter(Boolean).at(-1) || ''

const normalizeStoreKey = (value = '') => String(value)
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[Đđ]/g, 'D')
  .toUpperCase()

export const storeEmployeePrefix = (store = {}) => {
  const source = normalizeStoreKey(`${store.short || ''} ${store.name || ''} ${store.id || ''}`)
  const rules = [
    ['SM234', 'SM234'],
    ['TO NGOC VAN', 'TNV'],
    ['TAY HOA', 'TH'],
    ['DI AN', 'DIAN'],
    ['NO TRANG LONG', 'NTL'],
    ['BUON MA THU', 'BMT'],
    ['LE VAN THO', 'LVT'],
    ['NGUYEN VAN THUONG', 'NVT'],
    ['KHA VAN CAN', 'KVC'],
    ['CAN THO', 'CT'],
  ]
  const matched = rules.find(([keyword]) => source.includes(keyword))
  if (matched) return matched[1]
  const shortCode = normalizeStoreKey(store.short || store.id || 'NV').replace(/[^A-Z0-9]/g, '').slice(0, 8)
  return shortCode || 'NV'
}

export const generateStoreEmployeeCredentials = (store, name, cccd) => {
  const givenName = employeeGivenName(name)
  const storePrefix = normalizeCredentialToken(storeEmployeePrefix(store))
  const identityNumber = String(cccd || '').replace(/\D/g, '')
  return {
    username: storePrefix && givenName ? `${storePrefix}-${givenName}` : '',
    password: givenName && identityNumber.length === 12 ? `${identityNumber.slice(-6)}${givenName}@` : '',
  }
}

export const freshIdentityImages = (images = {}) => Object.fromEntries(
  ['front', 'back'].flatMap((side) => (
    typeof images?.[side] === 'string' && images[side].startsWith('data:image/')
      ? [[side, images[side]]]
      : []
  )),
)

export const nextStoreEmployeeCode = (store, employees = []) => {
  const prefix = storeEmployeePrefix(store)
  const matcher = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-(\\d+)$`, 'i')
  const highest = employees.reduce((value, employee) => {
    const match = String(employee.id || employee.code || employee.employeeCode || '').match(matcher)
    return match ? Math.max(value, Number(match[1]) || 0) : value
  }, 0)
  return `${prefix}-${String(highest + 1).padStart(3, '0')}`
}

export function validateStoreEmployee(form, employees, editingId, requiresPassword = !editingId, options = {}) {
  const autoCredentials = Boolean(options.autoCredentials)
  const requireIdentityImages = Boolean(options.requireIdentityImages)
  const errors = []
  const required = [
    ['Mã nhân viên', form.id],
    ['Tên nhân viên', form.name],
    ['Số CCCD', form.cccd],
    ['Số điện thoại', form.phone],
    ['Tỉnh/Thành phố', form.province],
    ['Phường/Xã', form.ward],
    ['Đường, số nhà', form.street],
    ['Ngày bắt đầu làm', form.startDate],
    [isPartTimeEmployee(form.employmentType) ? 'Lương theo giờ' : 'Lương cơ bản', isPartTimeEmployee(form.employmentType) ? form.salary : form.baseSalary],
    ['Vị trí công việc', form.position],
    ['Tuổi', form.age],
    ['Cửa hàng', form.storeId],
  ]
  if (!autoCredentials) required.push(['Tên đăng nhập', form.username])

  required.forEach(([label, value]) => {
    if (!String(value ?? '').trim()) errors.push(`${label} là trường bắt buộc.`)
  })
  if (!CCCD_PATTERN.test(form.cccd)) errors.push('Số CCCD phải gồm đúng 12 chữ số.')
  if (!PHONE_PATTERN.test(normalizePhone(form.phone))) errors.push('Số điện thoại phải gồm đúng 10 số và bắt đầu bằng số 0.')
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(String(form.startDate || ''))) errors.push('Ngày bắt đầu làm không hợp lệ.')
  if (requireIdentityImages && !form.identityImages?.front) errors.push('Hình ảnh mặt trước CCCD là trường bắt buộc.')
  if (requireIdentityImages && !form.identityImages?.back) errors.push('Hình ảnh mặt sau CCCD là trường bắt buộc.')
  if (!Number.isFinite(parseStoreMoneyInput(form.salary)) || parseStoreMoneyInput(form.salary) <= 0) {
    if (isPartTimeEmployee(form.employmentType)) errors.push('Lương theo giờ phải là số lớn hơn 0.')
  }
  if (!isPartTimeEmployee(form.employmentType)) {
    if (parseStoreMoneyInput(form.baseSalary) <= 0) errors.push('Lương cơ bản phải là số lớn hơn 0.')
    if (!Number.isInteger(Number(form.standardWorkDays)) || Number(form.standardWorkDays) < 1 || Number(form.standardWorkDays) > 31) {
      errors.push('Số ngày công quy định phải là số nguyên từ 1 đến 31.')
    }
    if (!Number.isFinite(Number(form.requiredMonthlyHours)) || Number(form.requiredMonthlyHours) <= 0 || Number(form.requiredMonthlyHours) > 744) {
      errors.push('Tổng giờ làm quy định/tháng phải lớn hơn 0 và không vượt quá 744 giờ.')
    }
  }
  if (!Number.isInteger(Number(form.age)) || Number(form.age) < 16 || Number(form.age) > 100) {
    errors.push('Tuổi phải là số nguyên từ 16 đến 100.')
  }
  if (!autoCredentials && requiresPassword && !form.password) errors.push('Mật khẩu là trường bắt buộc để cấp tài khoản đăng nhập.')

  const others = employees.filter((employee) => String(employee.id || employee.code || '') !== String(editingId || ''))
  if (others.some((employee) => normalizeText(employee.id || employee.code || employee.employeeCode) === normalizeText(form.id))) {
    errors.push('Mã nhân viên đã tồn tại.')
  }
  if (others.some((employee) => String(employee.cccd || employee.citizenId || '') === form.cccd)) {
    errors.push('Số CCCD đã được sử dụng.')
  }
  if (!autoCredentials && others.some((employee) => normalizeText(employee.username) === normalizeText(form.username))) {
    errors.push('Tên đăng nhập đã tồn tại.')
  }
  if (others.some((employee) => normalizePhone(employee.phone) === normalizePhone(form.phone))) {
    errors.push('Số điện thoại đã được sử dụng.')
  }
  return [...new Set(errors)]
}

export const buildStoreEmployeePayload = (form, { storeId, store, autoCredentials = false } = {}) => {
  const addressDetails = {
    province: form.province.trim(),
    ward: form.ward.trim(),
    street: form.street.trim(),
  }
  const partTime = isPartTimeEmployee(form.employmentType)
  const baseSalary = partTime ? 0 : parseStoreMoneyInput(form.baseSalary)
  const position = autoCredentials ? 'Nhân viên bán hàng' : form.position.trim()
  const identityImages = freshIdentityImages(form.identityImages)
  return {
    id: form.id.trim(),
    code: form.id.trim(),
    employeeCode: form.id.trim(),
    name: form.name.trim(),
    cccd: form.cccd,
    citizenId: form.cccd,
    phone: form.phone.trim(),
    ...addressDetails,
    addressDetails,
    address: [addressDetails.street, addressDetails.ward, addressDetails.province].join(', '),
    startDate: form.startDate,
    joinDate: form.startDate,
    salary: partTime ? parseStoreMoneyInput(form.salary) : baseSalary,
    payBasis: partTime ? 'hourly' : 'monthly',
    salaryBasis: partTime ? 'hourly' : 'monthly',
    salaryUnit: partTime ? 'hour' : 'month',
    monthlySalary: partTime ? null : baseSalary,
    baseSalary: partTime ? null : baseSalary,
    hourlyRate: partTime ? parseStoreMoneyInput(form.salary) : null,
    standardWorkDays: partTime ? null : Number(form.standardWorkDays),
    requiredMonthlyHours: partTime ? null : Number(form.requiredMonthlyHours),
    payFormula: !partTime && storeEmployeePrefix(store) === 'SM234' ? 'monthly-hours' : 'monthly',
    compensationVersion: 2,
    currency: 'VND',
    employmentType: form.employmentType,
    employeeType: form.employmentType,
    position,
    workPosition: position,
    role: position,
    shortRole: position.replace(/^Nhân viên\s*/i, '') || position,
    age: Number(form.age),
    status: form.status,
    storeId,
    unit: 'store',
    ...(autoCredentials ? {} : { username: form.username.trim(), ...(form.password ? { password: form.password } : {}) }),
    ...(Object.keys(identityImages).length ? { identityImages } : {}),
  }
}
