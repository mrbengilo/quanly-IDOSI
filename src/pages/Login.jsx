import { useState } from 'react'
import { Eye, EyeOff, LockKeyhole, ShieldCheck, UserRound } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { Brand, Button, Input } from '../components/UI'
import { demoAccounts } from '../data'
import { useApp } from '../state/AppContext'

const destinations = {
  admin: '/admin/overview',
  store: '/store/overview',
  employee: '/employee/home',
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
  const [username, setUsername] = useState('admin')
  const [password, setPassword] = useState('idosi123')
  const [showPassword, setShowPassword] = useState(false)
  const [remember, setRemember] = useState(true)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const submit = (event) => {
    event.preventDefault()
    setLoading(true)
    setError('')
    window.setTimeout(() => {
      const result = login(username, password)
      setLoading(false)
      if (!result.ok) return setError(result.message)
      navigate(destinations[result.account.role])
    }, 380)
  }

  const demoLogin = (account) => {
    const result = login(account.username, account.password)
    if (result.ok) navigate(destinations[result.account.role])
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
          <div className="login-round-logo">IDOSI<small>hệ thống quản lý</small></div>
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
            <button type="button">Quên mật khẩu?</button>
          </div>
          {error && <div className="login-error">{error}</div>}
          <Button type="submit" loading={loading} className="login-submit" icon={LockKeyhole}>Đăng nhập</Button>

          <div className="login-divider"><span>hoặc đăng nhập nhanh</span></div>
          <div className="demo-accounts">
            {demoAccounts.map((account) => (
              <button key={account.username} type="button" onClick={() => demoLogin(account)}>
                <b>{account.role === 'admin' ? 'Quản trị' : account.role === 'store' ? 'Quản lý' : account.unit === 'office' ? 'Văn phòng' : 'Cửa hàng'}</b>
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

