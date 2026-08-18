const baseUrl = String(process.env.IDOSI_BASE_URL || 'http://127.0.0.1:3000').replace(/\/+$/u, '')
const bootstrapToken = String(process.env.BOOTSTRAP_TOKEN || '')
const username = String(process.env.ADMIN_USERNAME || '').trim()
const password = String(process.env.ADMIN_PASSWORD || '')
const displayName = String(process.env.ADMIN_DISPLAY_NAME || 'Admin IDOSI').trim()

if (!bootstrapToken || !username || !password) {
  console.error('Thiếu BOOTSTRAP_TOKEN, ADMIN_USERNAME hoặc ADMIN_PASSWORD.')
  process.exit(1)
}

const response = await fetch(`${baseUrl}/api/bootstrap`, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'x-idosi-bootstrap-token': bootstrapToken,
  },
  body: JSON.stringify({ username, password, displayName, initialState: {} }),
})
const result = await response.json().catch(() => ({}))
if (!response.ok || result.ok === false) {
  console.error(`Khởi tạo Admin thất bại (${response.status}): ${result?.error?.message || 'Không rõ lỗi'}`)
  process.exit(1)
}
console.log(result.alreadyInitialized
  ? 'Cơ sở dữ liệu đã được khởi tạo trước đó; không thay đổi tài khoản.'
  : `Đã khởi tạo tài khoản Admin ${result.admin?.username || username}.`)
