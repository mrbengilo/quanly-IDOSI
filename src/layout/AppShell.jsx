import { useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import {
  Banknote,
  BarChart3,
  Bell,
  Building2,
  CalendarCheck,
  CalendarClock,
  ChevronDown,
  CircleDollarSign,
  ClipboardCheck,
  Clock3,
  LayoutDashboard,
  LogOut,
  Menu,
  PackagePlus,
  Settings,
  Store,
  UserCog,
  Users,
  WalletCards,
  X,
} from 'lucide-react'
import { useApp } from '../state/AppContext'
import { Avatar, Brand, Toast } from '../components/UI'

const menus = {
  admin: [
    { label: 'Tổng quan', path: '/admin/overview', icon: LayoutDashboard },
    { label: 'Cửa hàng', path: '/admin/stores', icon: Store },
    { label: 'Tài khoản quản lý', path: '/admin/managers', icon: UserCog, badge: 'Mới' },
    { label: 'Khối văn phòng', path: '/admin/office', icon: Building2, badge: 'Mới' },
    { label: 'Giao việc', path: '/admin/tasks', icon: ClipboardCheck, badge: 'Mới' },
    { label: 'Dòng tiền', path: '/admin/cashflow', icon: Banknote },
    { label: 'Lương thưởng quản lý', path: '/admin/manager-payroll', icon: WalletCards, badge: 'Mới' },
    { label: 'Báo cáo', path: '/admin/reports', icon: BarChart3 },
    { label: 'Cài đặt', path: '/admin/settings', icon: Settings },
  ],
  store: [
    { label: 'Tổng quan', path: '/store/overview', icon: LayoutDashboard },
    { label: 'Khối văn phòng', path: '/store/office', icon: Building2, badge: 'Mới' },
    { label: 'Ca làm việc', path: '/store/shifts', icon: CalendarClock },
    { label: 'Lịch phân ca', path: '/store/schedule', icon: CalendarCheck },
    { label: 'Nhân viên', path: '/store/employees', icon: Users },
    { label: 'Nhập hàng', path: '/store/imports', icon: PackagePlus },
    { label: 'Chấm công', path: '/store/attendance', icon: Clock3 },
    { label: 'Lương thưởng', path: '/store/payroll', icon: CircleDollarSign },
    { label: 'Dòng tiền', path: '/store/cashflow', icon: Banknote },
    { label: 'Báo cáo', path: '/store/reports', icon: BarChart3 },
    { label: 'Cài đặt', path: '/store/settings', icon: Settings },
  ],
  employee: [
    { label: 'Trang chủ', path: '/employee/home', icon: LayoutDashboard },
    { label: 'Lịch sử ca làm', path: '/employee/shifts', icon: CalendarCheck },
    { label: 'Bảng lương', path: '/employee/payroll', icon: WalletCards },
    { label: 'Dòng tiền', path: '/employee/cashflow', icon: Banknote },
  ],
}

export default function AppShell() {
  const { session, logout, toast, stores = [], activeStoreId, setActiveStoreId } = useApp()
  const [mobileOpen, setMobileOpen] = useState(false)
  const navigate = useNavigate()
  const role = session?.role || 'employee'
  const isAdmin = role === 'admin'
  const isEmployee = role === 'employee'
  const isOfficeEmployee = isEmployee && session?.unit === 'office'
  const roleMenus = isOfficeEmployee ? menus.employee.filter((item) => item.path !== '/employee/cashflow') : menus[role]
  const activeStore = stores.find((store) => store.id === (session?.storeId || activeStoreId)) || stores[0]

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  return (
    <div className={`app-shell app-shell--${role}`}>
      {mobileOpen && <button className="sidebar-scrim" onClick={() => setMobileOpen(false)} aria-label="Đóng menu" />}
      <aside className={`sidebar ${mobileOpen ? 'sidebar--open' : ''}`}>
        <button className="sidebar__close" onClick={() => setMobileOpen(false)} aria-label="Đóng menu"><X size={20} /></button>
        <div className="sidebar__brand">
          {isAdmin ? <Brand compact /> : isEmployee ? <Brand /> : (
            <div className="store-logo"><span>I</span><div><strong>{activeStore?.name || 'IDOSI'}</strong><small>Quản lý cửa hàng</small></div></div>
          )}
        </div>
        <nav>
          {roleMenus.map(({ label, path, icon: Icon, badge }) => (
            <NavLink key={path} to={path} onClick={() => setMobileOpen(false)} className={({ isActive }) => isActive ? 'active' : ''}>
              <Icon size={20} />
              <span>{label}</span>
              {badge && <em>{badge}</em>}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar__footer">
          {!isEmployee && (
            <label className="store-switcher">
              <Store size={18} />
              {isAdmin ? <span>Toàn hệ thống • 9 cửa hàng</span> : (
                <select
                  aria-label="Chọn cửa hàng"
                  value={session?.storeId || activeStoreId || activeStore?.id || ''}
                  onChange={(event) => setActiveStoreId?.(event.target.value)}
                  disabled={Boolean(session?.storeId)}
                >
                  {stores.map((store) => <option value={store.id} key={store.id}>{store.name}</option>)}
                </select>
              )}
              {!isAdmin && <ChevronDown size={16} />}
            </label>
          )}
          <div className="sidebar__profile">
            <Avatar name={session?.name} size={38} />
            <div><strong>{session?.name}</strong><small>{isAdmin ? 'admin@idosi.vn' : session?.code}</small></div>
            <button onClick={handleLogout} aria-label="Đăng xuất"><LogOut size={18} /></button>
          </div>
        </div>
      </aside>

      <main className="main-content">
        <div className="global-topbar">
          <button className="icon-button topbar-menu" onClick={() => setMobileOpen(true)} aria-label="Mở menu"><Menu size={22} /></button>
          <div className="global-topbar__right">
            <button className="icon-button notification"><Bell size={21} /><span>{isEmployee ? 2 : 3}</span></button>
            <Avatar name={session?.name} size={38} />
            <div className="topbar-user"><strong>{session?.name}</strong><small>{session?.code}</small></div>
            <ChevronDown size={17} />
          </div>
        </div>
        <Outlet context={{ openMenu: () => setMobileOpen(true) }} />
      </main>
      <Toast toast={toast} />
    </div>
  )
}

export function ProtectedRoute({ children, roles }) {
  const { session } = useApp()
  if (!session || (roles && !roles.includes(session.role))) return null
  return children
}
