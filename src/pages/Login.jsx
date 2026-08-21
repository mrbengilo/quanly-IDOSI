import { useState } from 'react'
import { Eye, EyeOff, LockKeyhole, ShieldCheck, UserRound } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { Brand, Button, Input } from '../components/UI'
import { demoAccounts } from '../data'
import { useApp } from '../state/AppContext'

const destinations = {
  admin: '/admin/overview',
  business_support: '/admin/overview',
  manager: '/admin/overview',
  store_manager: '/store/overview',
  employee: '/employee/home',
}

const accountRoleLabel = (account) => {
  if (account.role === 'admin') return 'Admin'
  if (['business_support', 'manager'].includes(account.role)) return 'Hỗ trợ KD'
  if (account.role === 'store_manager') return 'Quản lý cửa hàng'
  return account.unit === 'office' ? 'Nhân viên văn phòng' : 'Nhân viên cửa hàng'
}

const REMEMBERED_USER_KEY = 'idosi-remembered-username'

const rememberedUsername = () => {
  try {
    return window.localStorage.getItem(REMEMBERED_USER_KEY) || 'admin'
  } catch {
    return 'admin'
  }
}

const saveRememberedUsername = (username, remember) => {
  try {
    if (remember) window.localStorage.setItem(REMEMBERED_USER_KEY, username)
    else window.localStorage.removeItem(REMEMBERED_USER_KEY)
  } catch {
    // Đăng nhập vẫn hoạt động nếu trình duyệt chặn lưu trữ cục bộ.
  }
}

function ClothingScene() {
  return (
    <div className="clothing-scene" aria-hidden="true">
      <div className="clothing-scene__rail"><i /><i /><i /><i /><i /></div>
      <div className="shopping-bag"><strong>IDOSI</strong><span>quản lý đồng bộ</span><em>09</em></div>
      <div className="price-board"><strong>VẬN HÀNH<br />HIỆU QUẢ</strong><b>24/7</b></div>
      <div className="plant"><i /><i /><i /><i /><i /></div>
    </div>
  )
}

export default function Login() {
  const { login } = useApp()
  const navigate = useNavigate()
  const [username, setUsername] = useState(rememberedUsername)
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [remember, setRemember] = useState(true)
  const [error, setError] = useState('')
  const [recoveryMessage, setRecoveryMessage] = useState('')
  const [loading, setLoading] = useState(false)

  const submit = async (event) => {
    event.preventDefault()
    setLoading(true)
    setError('')
    setRecoveryMessage('')
    const result = await login(username, password)
    setLoading(false)
    if (!result.ok) return setError(result.message)
    saveRememberedUsername(username, remember)
    navigate(result.account.needsRoleSelection ? '/select-role' : (destinations[result.account.role] || '/login'))
  }

  const showRecoveryHelp = () => {
    setError('')
    setRecoveryMessage('Vui lòng liên hệ Admin IDOSI để được xác minh và cấp lại mật khẩu. Không cung cấp CCCD hoặc mật khẩu qua kênh không chính thức.')
  }

  return (
    <main className="login-page">
      <section className="login-hero">
        <Brand blue />
        <div className="login-hero__copy">
          <h1>HỆ THỐNG QUẢN LÝ IDOSI</h1>
          <h2><span>‹</span> 9 CỬA HÀNG • 1 NỀN TẢNG <span>›</span></h2>
          <i>★</i>
          <p>Quản trị cửa hàng và khối văn phòng</p>
        </div>
        <ClothingScene />
      </section>

      <section className="login-panel-wrap">
        <form className="login-panel" onSubmit={submit}>
          <img className="login-round-logo" src="/favicon.png" alt="Biểu trưng IDOSI" />
          <h2>Chào mừng bạn quay trở lại!</h2>
          <p>Vui lòng đăng nhập để tiếp tục vào hệ thống</p>

          <label className="login-field">
            <span>Tên đăng nhập</span>
            <Input icon={UserRound} value={username} onChange={(event) => setUsername(event.target.value)} placeholder="Nhập tên đăng nhập" autoComplete="username" />
          </label>
          <label className="login-field">
            <span>Mật khẩu</span>
            <span className="password-input">
              <Input icon={LockKeyhole} type={showPassword ? 'text' : 'password'} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Nhập mật khẩu" autoComplete="current-password" />
              <button type="button" onClick={() => setShowPassword((current) => !current)} aria-label="Hiện mật khẩu">{showPassword ? <EyeOff size={20} /> : <Eye size={20} />}</button>
            </span>
          </label>

          <div className="login-options">
            <label><input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} /> Ghi nhớ đăng nhập</label>
            <button type="button" onClick={showRecoveryHelp}>Quên mật khẩu?</button>
          </div>
          {error && <div className="login-error">{error}</div>}
          {recoveryMessage && <div className="login-security" role="status"><ShieldCheck size={20} /> {recoveryMessage}</div>}
          <Button type="submit" loading={loading} className="login-submit" icon={LockKeyhole}>Đăng nhập</Button>

          <div className="login-divider"><span>chọn nhanh tên tài khoản</span></div>
          <div className="demo-accounts">
            {demoAccounts.map((account) => (
              <button key={account.username} type="button" onClick={() => { setUsername(account.username); setPassword('') }}>
                <b>{accountRoleLabel(account)}</b>
                <small>{account.username}</small>
              </button>
            ))}
          </div>
          <div className="login-security"><ShieldCheck size={23} /> Bảo mật thông tin tuyệt đối</div>
        </form>
      </section>
      <footer>© 2026 IDOSI. All rights reserved. <span>HỆ THỐNG QUẢN LÝ IDOSI</span></footer>
    </main>
  )
}
