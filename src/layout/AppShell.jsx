import { useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import {
  ArrowLeft,
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

const systemOperations = [
  { label: 'Tổng quan hệ thống', path: '/admin/overview', icon: LayoutDashboard },
  { label: 'Danh sách cửa hàng', path: '/admin/stores', icon: Store },
  { label: 'Giao việc toàn hệ thống', path: '/admin/tasks', icon: ClipboardCheck },
  { label: 'Dòng tiền hệ thống', path: '/admin/cashflow', icon: Banknote },
  { label: 'Báo cáo hệ thống', path: '/admin/reports', icon: BarChart3 },
]

const storeOperations = [
  { label: 'Tổng quan cửa hàng', path: '/store/overview', icon: LayoutDashboard },
  { label: 'Ca làm việc', path: '/store/shifts', icon: CalendarClock },
  { label: 'Lịch phân ca', path: '/store/schedule', icon: CalendarCheck },
  { label: 'Nhân viên cửa hàng', path: '/store/employees', icon: Users },
  { label: 'Nhập hàng', path: '/store/imports', icon: PackagePlus },
  { label: 'Chấm công cửa hàng', path: '/store/attendance', icon: Clock3 },
  { label: 'Lương thưởng nhân viên', path: '/store/payroll', icon: CircleDollarSign },
  { label: 'Dòng tiền cửa hàng', path: '/store/cashflow', icon: Banknote },
  { label: 'Báo cáo cửa hàng', path: '/store/reports', icon: BarChart3 },
  { label: 'Cài đặt cửa hàng', path: '/store/settings', icon: Settings },
]

const officeOperation = { label: 'Khối văn phòng', path: '/office', icon: Building2, badge: 'Mới' }

const systemMenus = {
  admin: [
    ...systemOperations.slice(0, 2),
    { label: 'Tài khoản quản lý', path: '/admin/managers', icon: UserCog, badge: 'Mới' },
    officeOperation,
    ...systemOperations.slice(2),
    { label: 'Lương thưởng quản lý', path: '/admin/manager-payroll', icon: WalletCards },
    { label: 'Cài đặt hệ thống', path: '/admin/settings', icon: Settings },
  ],
  store: [...systemOperations],
  employee: [
    { label: 'Trang chủ', path: '/employee/home', icon: LayoutDashboard },
    { label: 'Lịch sử ca làm', path: '/employee/shifts', icon: CalendarCheck },
    { label: 'Bảng lương', path: '/employee/payroll', icon: WalletCards },
    { label: 'Dòng tiền', path: '/employee/cashflow', icon: Banknote },
  ],
}

export default function AppShell() {
  const { session, logout, toast, notify, stores = [], activeStoreId } = useApp()
  const [mobileOpen, setMobileOpen] = useState(false)
  const navigate = useNavigate()
  const location = useLocation()
  const role = session?.role || 'employee'
  const isAdmin = role === 'admin'
  const isEmployee = role === 'employee'
  const isOfficeEmployee = isEmployee && session?.unit === 'office'
  const isStoreWorkspace = !isEmployee && location.pathname.startsWith('/store/')
  const isSystemWorkspace = !isEmployee && !isStoreWorkspace
  const roleMenus = isOfficeEmployee
    ? systemMenus.employee.filter((item) => item.path !== '/employee/cashflow')
    : isStoreWorkspace
      ? storeOperations
      : systemMenus[role] || systemMenus.employee
  const selectedStoreId = isEmployee
    ? (stores.some((store) => store.id === session?.storeId) ? session.storeId : '')
    : stores.some((store) => store.id === activeStoreId)
      ? activeStoreId
      : stores.some((store) => store.id === session?.storeId)
        ? session.storeId
        : stores[0]?.id || ''
  const activeStore = stores.find((store) => store.id === selectedStoreId) || (!isEmployee ? stores[0] : null)

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  const accountSubtitle = isAdmin
    ? isStoreWorkspace ? `Quản trị cấp cao • ${activeStore?.short || activeStore?.name || ''}` : 'Quản trị cấp cao'
    : role === 'store'
      ? isStoreWorkspace ? `${session?.code || 'Quản lý'} • ${activeStore?.short || activeStore?.name || ''}` : 'Quản lý hệ thống'
      : session?.code

  const returnToSystemOverview = () => {
    setMobileOpen(false)
    navigate('/admin/overview')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  return (
    <div className={`app-shell app-shell--${role} ${isStoreWorkspace ? 'app-shell--store-workspace' : ''} ${isSystemWorkspace ? 'app-shell--system-workspace' : ''}`}>
      {mobileOpen && <button className="sidebar-scrim" onClick={() => setMobileOpen(false)} aria-label="Đóng menu" />}
      <aside className={`sidebar ${mobileOpen ? 'sidebar--open' : ''}`}>
        <button className="sidebar__close" onClick={() => setMobileOpen(false)} aria-label="Đóng menu"><X size={20} /></button>
        <div className="sidebar__brand">
          {isEmployee ? <Brand /> : isStoreWorkspace ? (
            <div className="store-logo"><span>I</span><div><strong>{activeStore?.name || 'IDOSI'}</strong><small>{isAdmin ? 'Quản trị cấp cao' : 'Quản lý cửa hàng'}</small></div></div>
          ) : <Brand subtitle="Quản lý toàn hệ thống" />}
        </div>
        {isStoreWorkspace && (
          <button className="back-system" onClick={returnToSystemOverview}>
            <ArrowLeft size={18} /> <span>Quay về trang quản lý chính</span>
          </button>
        )}
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
          <div className="sidebar__profile">
            <Avatar name={session?.name} size={38} />
            <div><strong>{session?.name}</strong><small>{accountSubtitle}</small></div>
            <button onClick={handleLogout} aria-label="Đăng xuất"><LogOut size={18} /></button>
          </div>
        </div>
      </aside>

      <main className="main-content">
        <div className="global-topbar">
          <button className="icon-button topbar-menu" onClick={() => setMobileOpen(true)} aria-label="Mở menu"><Menu size={22} /></button>
          <div className="global-topbar__right">
            <button
              className="icon-button notification"
              onClick={() => notify?.('Bạn không có thông báo mới.', 'info')}
              aria-label="Xem thông báo"
            ><Bell size={21} /><span>{isEmployee ? 2 : 3}</span></button>
            <Avatar name={session?.name} size={38} />
            <div className="topbar-user"><strong>{session?.name}</strong><small>{accountSubtitle}</small></div>
            <button
              className="icon-button"
              onClick={() => navigate(isStoreWorkspace ? '/store/settings' : isAdmin ? '/admin/settings' : role === 'store' ? '/admin/overview' : '/employee/home')}
              aria-label="Mở trang tài khoản"
            ><ChevronDown size={17} /></button>
          </div>
        </div>
        <Outlet context={{ openMenu: () => setMobileOpen(true), activeStore }} />
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
