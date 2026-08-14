import { useEffect, useRef, useState } from 'react'
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
  ShoppingCart,
  Store,
  Users,
  WalletCards,
  X,
} from 'lucide-react'
import { useApp } from '../state/AppContext'
import { Avatar, Brand, Toast } from '../components/UI'

const systemOperations = [
  { label: 'Tổng quan', path: '/admin/overview', icon: LayoutDashboard },
  { label: 'Cửa hàng', path: '/admin/stores', icon: Store },
  { label: 'Dòng tiền', path: '/admin/cashflow', icon: Banknote },
  { label: 'Báo cáo', path: '/admin/reports', icon: BarChart3 },
  { label: 'Điều chuyển nhân sự hỗ trợ', path: '/admin/support-transfers', icon: Users },
  { label: 'Cài đặt', path: '/admin/settings', icon: Settings },
]

const storeOperations = [
  { label: 'Tổng quan cửa hàng', path: '/store/overview', icon: LayoutDashboard },
  { label: 'Đơn hàng', path: '/store/orders', icon: ShoppingCart },
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
    { label: 'Quản lý nhân viên', path: '/admin/employees', icon: Users, badge: 'Mới' },
    officeOperation,
    { label: 'Giao việc toàn hệ thống', path: '/admin/tasks', icon: ClipboardCheck },
    ...systemOperations.slice(2, 5),
    { label: 'Cài đặt chính sách', path: '/admin/policies', icon: Settings, badge: 'Mới' },
    systemOperations[5],
    { label: 'Reset dữ liệu', path: '/admin/reset', icon: CalendarClock },
    { label: 'Lịch sử sửa/xóa đơn hàng', path: '/admin/order-audit', icon: ClipboardCheck },
  ],
  employee: [
    { label: 'Trang chủ', path: '/employee/home', icon: LayoutDashboard },
    { label: 'Đơn hàng', path: '/employee/orders', icon: ShoppingCart },
    { label: 'Dòng tiền', path: '/employee/cashflow', icon: Banknote },
    { label: 'Chấm công', path: '/employee/attendance', icon: Clock3 },
    { label: 'Bảng lương', path: '/employee/payroll', icon: WalletCards },
    { label: 'Lịch sử làm việc', path: '/employee/work-history', icon: CalendarCheck },
  ],
}

export default function AppShell() {
  const app = useApp()
  const { session, logout, toast, notify, stores = [], activeStoreId } = app
  const [mobileOpen, setMobileOpen] = useState(false)
  const [notificationOpen, setNotificationOpen] = useState(false)
  const notificationRef = useRef(null)
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
  const notificationItems = Array.isArray(app.notifications)
    ? app.notifications
    : Array.isArray(app.orderNotifications)
      ? app.orderNotifications
      : []
  const scopedNotificationStoreId = isStoreWorkspace
    ? selectedStoreId
    : isEmployee
      ? session?.storeId
      : null
  const unreadNotifications = notificationItems.filter((item) => (
    (!scopedNotificationStoreId || !item?.storeId || String(item.storeId) === String(scopedNotificationStoreId))
    && !item?.read
    && !item?.isRead
    && !item?.readAt
  ))
  const readNotification = app.readNotification || app.markNotificationRead || app.dismissNotification
  const clearNotifications = app.clearNotifications || app.clearAllNotifications || app.deleteAllNotifications

  useEffect(() => {
    if (!notificationOpen) return undefined
    const closeOnOutsideClick = (event) => {
      if (!notificationRef.current?.contains(event.target)) setNotificationOpen(false)
    }
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') setNotificationOpen(false)
    }
    document.addEventListener('pointerdown', closeOnOutsideClick)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideClick)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [notificationOpen])

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  const accountSubtitle = isAdmin
    ? isStoreWorkspace ? `Quản trị cấp cao • ${activeStore?.short || activeStore?.name || ''}` : 'Quản trị cấp cao'
    : session?.code

  const returnToSystemOverview = () => {
    setMobileOpen(false)
    navigate('/admin/overview')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const openNotification = (item) => {
    const id = item?.id || item?.notificationId || item?.orderId
    if (id != null) readNotification?.(id)
    app.onNotificationOpen?.(item)
    const orderId = item?.orderId || item?.data?.orderId
    const ordersPath = isEmployee ? '/employee/orders' : '/store/orders'
    const destination = item?.path || item?.href || item?.url || (orderId ? `${ordersPath}?order=${encodeURIComponent(orderId)}` : ordersPath)
    setNotificationOpen(false)
    navigate(destination)
  }

  const clearAllNotifications = () => {
    if (readNotification && unreadNotifications.length) {
      unreadNotifications.forEach((item) => readNotification(item?.id || item?.notificationId || item?.orderId))
      notify?.('Đã xóa danh sách thông báo đang hiển thị.', 'info')
    } else if (clearNotifications) clearNotifications(scopedNotificationStoreId)
    else notify?.('Chưa có thông báo để xóa.', 'info')
  }

  return (
    <div className={`app-shell app-shell--${role} ${isStoreWorkspace ? 'app-shell--store-workspace' : ''} ${isSystemWorkspace ? 'app-shell--system-workspace' : ''}`}>
      {mobileOpen && <button className="sidebar-scrim" onClick={() => setMobileOpen(false)} aria-label="Đóng menu" />}
      <aside className={`sidebar ${mobileOpen ? 'sidebar--open' : ''}`}>
        <button className="sidebar__close" onClick={() => setMobileOpen(false)} aria-label="Đóng menu"><X size={20} /></button>
        <div className="sidebar__brand">
          {isEmployee ? <Brand /> : isStoreWorkspace ? (
            <div className="store-logo"><span>I</span><div><strong>{activeStore?.name || 'IDOSI'}</strong><small>Quản trị cấp cao</small></div></div>
          ) : <Brand subtitle="Quản lý toàn hệ thống" />}
        </div>
        {isStoreWorkspace && (
          <button className="back-system" onClick={returnToSystemOverview}>
            <ArrowLeft size={18} /> <span>Quay về trang quản lý chính</span>
          </button>
        )}
        <nav>
          {roleMenus.map(({ label, path, icon: Icon, badge }) => (
            <NavLink key={path} to={path} onClick={() => { setMobileOpen(false); setNotificationOpen(false) }} className={({ isActive }) => isActive ? 'active' : ''}>
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
            <div className="notification-center" ref={notificationRef}>
              <button
                className={`icon-button notification ${notificationOpen ? 'notification--open' : ''}`}
                onClick={() => setNotificationOpen((current) => !current)}
                aria-label={`Xem thông báo${unreadNotifications.length ? `, ${unreadNotifications.length} chưa đọc` : ''}`}
                aria-expanded={notificationOpen}
                aria-controls="notification-popover"
              >
                <Bell size={21} />
                {unreadNotifications.length > 0 && <span>{unreadNotifications.length > 99 ? '99+' : unreadNotifications.length}</span>}
              </button>
              {notificationOpen && (
                <section className="notification-popover" id="notification-popover" aria-label="Thông báo chưa đọc">
                  <header>
                    <div><strong>Thông báo</strong><small>{unreadNotifications.length} chưa đọc</small></div>
                    <button
                      type="button"
                      className="notification-clear"
                      onClick={clearAllNotifications}
                      disabled={!unreadNotifications.length}
                    ><X size={15} /> Xóa tất cả thông báo</button>
                  </header>
                  <div className="notification-list">
                    {unreadNotifications.map((item, index) => (
                      <button
                        type="button"
                        className="notification-item"
                        key={item?.id || item?.notificationId || `${item?.orderId || 'notification'}-${index}`}
                        onClick={() => openNotification(item)}
                      >
                        <span className="notification-item__icon"><ShoppingCart size={17} /></span>
                        <span className="notification-item__body">
                          <strong>{item?.title || item?.message || 'Đơn hàng mới'}</strong>
                          <small>{item?.description || item?.content || item?.message || item?.orderCode || item?.data?.orderCode || 'Mở để xem chi tiết'}</small>
                          {(item?.createdAt || item?.time || item?.updatedAt) && <time>{String(item.createdAt || item.time || item.updatedAt)}</time>}
                        </span>
                      </button>
                    ))}
                    {!unreadNotifications.length && (
                      <div className="notification-empty"><Bell size={24} /><strong>Không có thông báo mới</strong><span>Các đơn hàng mới sẽ hiển thị tại đây.</span></div>
                    )}
                  </div>
                </section>
              )}
            </div>
            <Avatar name={session?.name} size={38} />
            <div className="topbar-user"><strong>{session?.name}</strong><small>{accountSubtitle}</small></div>
            <button
              className="icon-button"
              onClick={() => navigate(isStoreWorkspace ? '/store/settings' : isAdmin ? '/admin/settings' : '/employee/home')}
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
