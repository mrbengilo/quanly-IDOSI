export const OFFICE_EMPLOYEE_TYPES = ['Full-Time', 'Part-Time', 'Thực Tập Sinh']
export const OFFICE_POSITIONS = ['Kế Toán', 'Marketing']

const PHONE_PATTERN = /^0\d{9}$/
const CCCD_PATTERN = /^\d{12}$/
const normalizeText = (value = '') => String(value).trim().toLowerCase()
const normalizePhone = (value = '') => String(value).replace(/[\s.()-]/g, '')
const employeeCode = (employee = {}) => employee.code || employee.employeeCode || employee.id || ''

export const nextOfficeEmployeeCode = (employees = []) => {
  const largestNumber = employees.reduce((largest, employee) => {
    const match = /^VP-?(\d+)$/i.exec(employeeCode(employee))
    return match ? Math.max(largest, Number(match[1])) : largest
  }, 0)
  return `VP-${String(largestNumber + 1).padStart(3, '0')}`
}

export const nextOfficeEmployeeCodeFromState = ({ employees = [], deletedEmployees = [] } = {}) => (
  nextOfficeEmployeeCode([...employees, ...deletedEmployees])
)

export function validateOfficeEmployee(form, employees, editingKey, requiresPassword = !editingKey) {
  const errors = []
  const required = [
    ['Mã nhân viên', form.code],
    ['Tên nhân viên', form.name],
    ['Loại nhân viên', form.employmentType],
    ['Số CCCD', form.cccd],
    ['Số điện thoại', form.phone],
    ['Tỉnh/Thành phố', form.province],
    ['Phường/Xã', form.ward],
    ['Đường, số nhà', form.street],
    ['Ngày bắt đầu làm', form.startDate],
    ['Vị trí công việc', form.position],
    ['Tên đăng nhập', form.username],
  ]

  required.forEach(([label, value]) => {
    if (!String(value ?? '').trim()) errors.push(`${label} là trường bắt buộc.`)
  })
  if (!CCCD_PATTERN.test(form.cccd)) errors.push('Số CCCD phải gồm đúng 12 chữ số.')
  if (!PHONE_PATTERN.test(normalizePhone(form.phone))) errors.push('Số điện thoại phải gồm đúng 10 chữ số và bắt đầu bằng số 0.')
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(String(form.startDate || ''))) errors.push('Ngày bắt đầu làm không hợp lệ.')
  if (!OFFICE_EMPLOYEE_TYPES.includes(form.employmentType)) errors.push('Loại nhân viên không hợp lệ.')
  if (!OFFICE_POSITIONS.includes(form.position)) errors.push('Vị trí công việc không hợp lệ.')
  if (!form.identityImages?.front) errors.push('Hình ảnh mặt trước CCCD là trường bắt buộc.')
  if (!form.identityImages?.back) errors.push('Hình ảnh mặt sau CCCD là trường bắt buộc.')
  if (requiresPassword && !form.password) errors.push('Mật khẩu là trường bắt buộc để cấp tài khoản đăng nhập.')
  if (form.password && form.password.length < 8) errors.push('Mật khẩu phải có ít nhất 8 ký tự.')

  const others = employees.filter((item) => String(item.id || employeeCode(item)) !== String(editingKey || ''))
  if (others.some((item) => normalizeText(employeeCode(item)) === normalizeText(form.code))) errors.push('Mã nhân viên đã tồn tại.')
  if (others.some((item) => String(item.cccd || item.citizenId || '') === form.cccd)) errors.push('Số CCCD đã được sử dụng.')
  if (others.some((item) => normalizeText(item.username) === normalizeText(form.username))) errors.push('Tên đăng nhập đã tồn tại.')
  if (others.some((item) => normalizePhone(item.phone) === normalizePhone(form.phone))) errors.push('Số điện thoại đã được sử dụng.')
  return [...new Set(errors)]
}
