import { useEffect, useMemo, useRef, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import {
  ArrowLeft,
  Award,
  Banknote,
  BarChart3,
  Bell,
  Building2,
  CalendarCheck,
  CalendarClock,
  ChevronDown,
  CircleDollarSign,
  ClipboardCheck,
  ClipboardList,
  Clock3,
  LayoutDashboard,
  LogOut,
  Menu,
  PackagePlus,
  ReceiptText,
  Repeat2,
  Settings,
  ShieldAlert,
  ShoppingCart,
  Store,
  Users,
  WalletCards,
  X,
} from 'lucide-react'
import { useApp } from '../state/AppContext'
import { Avatar, Brand, Toast } from '../components/UI'
import { resolveOrderNotificationTarget, resolveOrderRouteScope } from '../domain/orderStoreScope'
import { isOfficeProfile } from '../pages/employee/officeAttendance'
import { playTaskNotificationSound, unlockNotificationSound } from '../domain/notificationSound'

const systemOperations = [
  { label: 'Tổng quan', path: '/admin/overview', icon: LayoutDashboard },
  { label: 'Danh sách cửa hàng', path: '/admin/stores', icon: Store },
  { label: 'Dòng tiền', path: '/admin/cashflow', icon: Banknote },
  { label: 'Báo cáo', path: '/admin/reports', icon: BarChart3 },
  { label: 'Cài đặt', path: '/admin/settings', icon: Settings },
]

const storeOperations = [
  { label: 'Tổng quan', path: '/store/overview', icon: LayoutDashboard },
  { label: 'Đơn hàng', path: '/store/orders', icon: ShoppingCart },
  { label: 'Công việc tính thưởng & vi phạm', path: '/store/tasks', icon: ClipboardCheck },
  { label: 'Lịch phân ca', path: '/store/schedule', icon: CalendarCheck },
  { label: 'Nhân viên cửa hàng', path: '/store/employees', icon: Users },
  { label: 'Cài đặt lương', path: '/store/salary-settings', icon: CircleDollarSign, roles: ['admin', 'business_support'] },
  { label: 'Nhập hàng', path: '/store/imports', icon: PackagePlus },
  { label: 'Chi phí cửa hàng', path: '/store/expenses', icon: ReceiptText },
  { label: 'Chấm công cửa hàng', path: '/store/attendance', icon: Clock3 },
  { label: 'Lương thưởng nhân viên', path: '/store/payroll', icon: CircleDollarSign },
  { label: 'Thưởng doanh thu ngày', path: '/store/revenue-bonus', icon: Award },
  { label: 'Thu nhập của tôi', path: '/store/my-compensation', icon: WalletCards, roles: ['store_manager'] },
  { label: 'Vi phạm của tôi', path: '/store/my-violations', icon: ShieldAlert, roles: ['store_manager'] },
  { label: 'Dòng tiền cửa hàng', path: '/store/cashflow', icon: Banknote },
  { label: 'Báo cáo cửa hàng', path: '/store/reports', icon: BarChart3 },
  { label: 'Cài đặt cửa hàng', path: '/store/settings', icon: Settings },
]

const officeOperation = { label: 'Khối văn phòng', path: '/office', icon: Building2 }
const businessSupportDirectoryOperation = { label: 'Nhân viên hỗ trợ KD', path: '/admin/business-support', icon: Users }
const businessSupportScheduleOperation = { label: 'Phân lịch làm việc', path: '/admin/business-support-schedule', icon: CalendarClock }
const customerSurveyOperation = { label: 'Khảo sát thông tin KH', path: '/admin/customer-survey', icon: ClipboardList }
const orderInformationSettingsOperation = { label: 'Cài đặt thông tin đơn hàng', path: '/admin/order-information-settings', icon: Settings }
const workCatalogSettingsOperation = { label: 'Danh mục công việc & vi phạm', path: '/admin/work-catalog', icon: ClipboardList }
const workRegistrationScheduleOperation = { label: 'Lịch đăng ký làm việc của HTKD và KVP', path: '/admin/work-registration-schedules', icon: CalendarCheck }

const officeEmployeeMenu = [
  { label: 'Trang chủ', path: '/employee/home', icon: LayoutDashboard },
  { label: 'Công việc tính thưởng', path: '/employee/tasks', icon: ClipboardCheck },
  { label: 'Chấm công', path: '/employee/attendance', icon: Clock3 },
  { label: 'Lịch làm việc của tôi', path: '/employee/schedule', icon: CalendarCheck },
  { label: 'Bảng lương', path: '/employee/payroll', icon: WalletCards },
  { label: 'Thu nhập của tôi', path: '/employee/compensation', icon: Award },
  { label: 'Vi phạm của tôi', path: '/employee/violations', icon: ShieldAlert },
  { label: 'Lịch sử làm việc', path: '/employee/work-history', icon: CalendarCheck },
]

const businessSupportMenu = [
  { label: 'Tổng quan', path: '/support/overview', icon: LayoutDashboard },
  { label: 'Công việc tính thưởng', path: '/support/tasks', icon: ClipboardCheck },
  { label: 'Lịch làm việc của tôi', path: '/support/my-schedule', icon: CalendarCheck },
  { label: 'Thu nhập của tôi', path: '/support/my-compensation', icon: WalletCards },
  { label: 'Vi phạm của tôi', path: '/support/my-violations', icon: ShieldAlert },
  businessSupportScheduleOperation,
  businessSupportDirectoryOperation,
  officeOperation,
  systemOperations[1],
  { label: 'Danh sách nhân viên cửa hàng', path: '/admin/employees', icon: Users },
  { label: 'Nhân viên quản lý cửa hàng', path: '/admin/store-managers', icon: Store },
  systemOperations[2],
  systemOperations[3],
  orderInformationSettingsOperation,
  workCatalogSettingsOperation,
  customerSurveyOperation,
  { label: 'Thưởng và phụ cấp quản lý', path: '/admin/compensation/managers', icon: Award },
  { label: 'Thưởng doanh thu ngày', path: '/admin/compensation/revenue', icon: CircleDollarSign },
  { label: 'Vi phạm nhân viên', path: '/admin/violations/store', icon: ShieldAlert },
  { label: 'Vi phạm Khối văn phòng', path: '/admin/violations/office', icon: ShieldAlert },
  { label: 'Lịch sử chỉnh sửa đơn hàng', path: '/admin/order-audit', icon: CalendarClock },
  { label: 'Điều chuyển nhân sự', path: '/admin/support-transfers', icon: Users },
  { label: 'Cài đặt chính sách', path: '/admin/policies', icon: Settings },
]

const systemMenus = {
  admin: [
    ...systemOperations.slice(0, 2),
    { label: 'Danh sách nhân viên cửa hàng', path: '/admin/employees', icon: Users },
    businessSupportDirectoryOperation,
    businessSupportScheduleOperation,
    workRegistrationScheduleOperation,
    { label: 'Công việc tính thưởng & Vi phạm HTKD', path: '/admin/tasks', icon: ClipboardCheck },
    { label: 'Nhân viên quản lý cửa hàng', path: '/admin/store-managers', icon: Store },
    officeOperation,
    customerSurveyOperation,
    { label: 'Thưởng và phụ cấp quản lý', path: '/admin/compensation/managers', icon: Award },
    { label: 'Thưởng doanh thu ngày', path: '/admin/compensation/revenue', icon: CircleDollarSign },
    { label: 'Vi phạm nhân viên', path: '/admin/violations/store', icon: ShieldAlert },
    { label: 'Vi phạm Khối văn phòng', path: '/admin/violations/office', icon: ShieldAlert },
    { label: 'Điều chuyển nhân sự', path: '/admin/support-transfers', icon: Users },
    ...systemOperations.slice(2, 4),
    orderInformationSettingsOperation,
    workCatalogSettingsOperation,
    { label: 'Cài đặt chính sách', path: '/admin/policies', icon: Settings },
    systemOperations[4],
    { label: 'Reset dữ liệu', path: '/admin/reset', icon: CalendarClock },
    { label: 'Lịch sử sửa/xóa đơn hàng', path: '/admin/order-audit', icon: ClipboardCheck },
  ],
  business_support: businessSupportMenu,
  manager: businessSupportMenu,
  employee: [
    { label: 'Trang chủ', path: '/employee/home', icon: LayoutDashboard },
    { label: 'Đơn hàng', path: '/employee/orders', icon: ShoppingCart },
    { label: 'Chi phí trong ca', path: '/employee/shift-expenses', icon: ReceiptText },
    { label: 'Công việc được giao', path: '/employee/tasks', icon: ClipboardCheck },
    { label: 'Dòng tiền', path: '/employee/cashflow', icon: Banknote },
    { label: 'Chấm công', path: '/employee/attendance', icon: Clock3 },
    { label: 'Lịch phân ca', path: '/employee/schedule', icon: CalendarCheck },
    { label: 'Bảng lương', path: '/employee/payroll', icon: WalletCards },
    { label: 'Thu nhập của tôi', path: '/employee/compensation', icon: Award },
    { label: 'Vi phạm của tôi', path: '/employee/violations', icon: ShieldAlert },
    { label: 'Thưởng doanh thu team', path: '/employee/revenue-bonus', icon: CircleDollarSign },
    { label: 'Lịch sử làm việc', path: '/employee/work-history', icon: CalendarCheck },
  ],
}

const notificationTime24 = (value) => {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value || '')
  return new Intl.DateTimeFormat('vi-VN', {
    day: '2-digit', month: '2-digit', year: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).format(date)
}

const notificationId = (item) => String(item?.id || item?.notificationId || item?.data?.notificationId || '')
const notificationStoreId = (item) => String(item?.storeId || item?.store_id || item?.data?.storeId || item?.data?.store_id || item?.order?.storeId || item?.store?.id || '')
const notificationKey = (item) => notificationId(item) || [
  item?.type || 'notification',
  notificationStoreId(item),
  item?.orderId || item?.orderCode || item?.data?.orderId || item?.data?.orderCode || '',
  item?.createdAt || item?.time || item?.updatedAt || '',
].join(':')
const isAssignedTaskNotification = (item) => ['support-work-assigned', 'store-task-assigned'].includes(String(item?.type || ''))

export default function AppShell() {
  const app = useApp()
  const { session, logout, toast, notify, stores = [], activeStoreId } = app
  const [mobileOpen, setMobileOpen] = useState(false)
  const [notificationOpen, setNotificationOpen] = useState(false)
  const [notificationBusy, setNotificationBusy] = useState(false)
  const [locallyReadNotificationIds, setLocallyReadNotificationIds] = useState(() => new Set())
  const [taskPopup, setTaskPopup] = useState(null)
  const notificationRef = useRef(null)
  const taskPopupAccountRef = useRef('')
  const taskPopupSeenRef = useRef(new Set())
  const navigate = useNavigate()
  const location = useLocation()
  const role = session?.role || 'employee'
  const canonicalRole = role === 'manager' ? 'business_support' : role
  const isAdmin = role === 'admin'
  const isBusinessSupport = canonicalRole === 'business_support'
  const isStoreManager = canonicalRole === 'store_manager'
  const isSystemOperator = isAdmin || isBusinessSupport
  const isStoreOperator = isSystemOperator || isStoreManager
  const isEmployee = role === 'employee'
  const isOfficeEmployee = isEmployee && isOfficeProfile(session, app.currentEmployee)
  const isStoreWorkspace = isStoreManager || (isStoreOperator && location.pathname.startsWith('/store/'))
  const isSystemWorkspace = isSystemOperator && !isStoreWorkspace
  const roleMenus = (isOfficeEmployee
    ? officeEmployeeMenu
    : isStoreWorkspace
      ? storeOperations
      : systemMenus[canonicalRole] || systemMenus.employee)
    .filter((item) => !item.roles || item.roles.includes(canonicalRole))
  const availableRoleOptions = Array.isArray(session?.availableRoles) ? session.availableRoles : []
  const canSwitchRole = availableRoleOptions.length > 1
  const assignedStoreId = [session?.assignedStoreId, session?.storeId]
    .find((storeId) => stores.some((store) => store.id === storeId)) || ''
  const isStoreBoundRole = isEmployee || isStoreManager
  const workspaceSearch = new URLSearchParams(location.search)
  const workspaceOrderScope = resolveOrderRouteScope({
    requestedStoreId: isStoreWorkspace ? workspaceSearch.get('store') : '',
    requestedOrderId: isStoreWorkspace ? workspaceSearch.get('order') : '',
    fallbackStoreId: activeStoreId || assignedStoreId,
    orders: app.orders,
    stores,
  })
  const selectedStoreId = isStoreBoundRole
    ? (stores.some((store) => store.id === assignedStoreId) ? assignedStoreId : '')
    : isStoreWorkspace && workspaceOrderScope.storeId
      ? workspaceOrderScope.storeId
      : stores.some((store) => store.id === activeStoreId)
      ? activeStoreId
      : stores.some((store) => store.id === assignedStoreId)
        ? assignedStoreId
        : stores[0]?.id || ''
  const activeStore = stores.find((store) => store.id === selectedStoreId) || (!isStoreBoundRole ? stores[0] : null)
  const notificationItems = useMemo(() => (Array.isArray(app.notifications)
    ? app.notifications
    : Array.isArray(app.orderNotifications)
      ? app.orderNotifications
      : []), [app.notifications, app.orderNotifications])
  const scopedNotificationStoreId = isStoreWorkspace
    ? selectedStoreId
    : isEmployee
      ? session?.storeId
      : null
  const sessionEmployeeId = String(session?.employeeId || session?.code || '')
  const unreadNotifications = useMemo(() => notificationItems.filter((item) => {
    const targetEmployeeId = String(item?.targetEmployeeId || item?.target?.employeeId || item?.data?.employeeId || (['support-work-assigned', 'store-task-assigned'].includes(item?.type) ? item?.employeeId : '') || '')
    const targetRole = String(item?.targetRole || item?.target?.role || '')
    const belongsToAccount = targetEmployeeId
      ? (!isAdmin && targetEmployeeId === sessionEmployeeId)
      : true
    return (!targetRole || targetRole === canonicalRole)
    && belongsToAccount
    && (!scopedNotificationStoreId || !item?.storeId || String(item.storeId) === String(scopedNotificationStoreId))
    && !item?.read
    && !item?.isRead
    && !item?.readAt
    && !locallyReadNotificationIds.has(notificationKey(item))
  }), [canonicalRole, isAdmin, locallyReadNotificationIds, notificationItems, scopedNotificationStoreId, sessionEmployeeId])
  const readNotification = app.readNotification || app.markNotificationRead || app.dismissNotification
  const clearNotifications = app.clearNotifications || app.clearAllNotifications || app.deleteAllNotifications

  useEffect(() => {
    const unlock = () => { void unlockNotificationSound() }
    document.addEventListener('pointerdown', unlock, { once: true })
    document.addEventListener('keydown', unlock, { once: true })
    return () => {
      document.removeEventListener('pointerdown', unlock)
      document.removeEventListener('keydown', unlock)
    }
  }, [])

  useEffect(() => {
    if (!isStoreWorkspace || !isSystemOperator || !selectedStoreId || String(selectedStoreId) === String(activeStoreId)) return
    const changeActiveStore = app.setActiveStoreId || app.setActiveStore
    changeActiveStore?.(selectedStoreId)
  }, [activeStoreId, app.setActiveStore, app.setActiveStoreId, isStoreWorkspace, isSystemOperator, selectedStoreId])

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

  useEffect(() => {
    if (!sessionEmployeeId) return undefined
    const storageKey = `idosi-task-popup-seen:${sessionEmployeeId}`
    if (taskPopupAccountRef.current !== storageKey) {
      taskPopupAccountRef.current = storageKey
      try {
        taskPopupSeenRef.current = new Set(JSON.parse(sessionStorage.getItem(storageKey) || '[]'))
      } catch {
        taskPopupSeenRef.current = new Set()
      }
    }
    const taskItems = unreadNotifications.filter(isAssignedTaskNotification)
    const unseen = taskItems.filter((item) => {
      const id = notificationKey(item)
      return id && !taskPopupSeenRef.current.has(id)
    })
    if (!unseen.length) return undefined
    taskItems.forEach((item) => taskPopupSeenRef.current.add(notificationKey(item)))
    try {
      sessionStorage.setItem(storageKey, JSON.stringify([...taskPopupSeenRef.current].slice(-200)))
    } catch {
      // The popup still works for the current render when session storage is unavailable.
    }
    const newest = unseen.at(-1)
    void playTaskNotificationSound()
    setTaskPopup(newest)
    const timeout = window.setTimeout(() => setTaskPopup(null), 3000)
    return () => window.clearTimeout(timeout)
  }, [sessionEmployeeId, unreadNotifications])

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  const systemRoleLabel = isAdmin ? 'Admin' : isBusinessSupport ? 'Hỗ trợ KD' : 'Quản lý cửa hàng'
  const accountSubtitle = isStoreOperator
    ? isStoreWorkspace ? `${systemRoleLabel} • ${activeStore?.short || activeStore?.name || ''}` : systemRoleLabel
    : session?.code

  const returnToSystemOverview = () => {
    setMobileOpen(false)
    navigate('/admin/overview')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const openNotification = (item) => {
    const id = notificationId(item)
    const localId = notificationKey(item)
    if (localId) setLocallyReadNotificationIds((current) => new Set([...current, localId]))
    setTaskPopup(null)
    if (id && readNotification) {
      Promise.resolve().then(() => readNotification(id)).then((result) => {
        if (result?.ok === false) {
          setLocallyReadNotificationIds((current) => new Set([...current].filter((value) => value !== localId)))
          notify?.(result.message || 'Không thể cập nhật thông báo.', 'info')
        }
      }).catch((error) => {
        setLocallyReadNotificationIds((current) => new Set([...current].filter((value) => value !== localId)))
        notify?.(error.message || 'Không thể cập nhật thông báo.', 'info')
      })
    }
    app.onNotificationOpen?.(item)
    const target = resolveOrderNotificationTarget({
      notification: item,
      orders: app.orders,
      stores,
    })
    const orderId = target.orderId
    const targetStoreId = target.storeId
    if (isSystemOperator
      && targetStoreId
      && stores.some((store) => String(store.id) === targetStoreId)) {
      const changeActiveStore = app.setActiveStoreId || app.setActiveStore
      changeActiveStore?.(targetStoreId)
    }
    const ordersPath = isEmployee ? '/employee/orders' : '/store/orders'
    const assignmentId = item?.assignmentId || item?.data?.assignmentId
    const requestedDestination = item?.route || item?.path || item?.href || item?.url || ''
    const explicitDestination = requestedDestination === '/admin/support-employees'
      ? '/admin/business-support'
      : requestedDestination
    const orderDestination = orderId
      ? `${ordersPath}?${new URLSearchParams({
          ...(targetStoreId ? { store: targetStoreId } : {}),
          order: String(orderId),
        }).toString()}`
      : ''
    const destination = item?.type === 'store-task-assigned'
      ? `/employee/home?assignment=${encodeURIComponent(assignmentId || '')}`
      : assignmentId && (item?.targetUnit === 'office' || item?.data?.targetUnit === 'office')
      ? `/employee/tasks?assignment=${encodeURIComponent(assignmentId)}`
      : assignmentId && (!explicitDestination || String(explicitDestination).startsWith('/support/tasks'))
      ? `/support/tasks?assignment=${encodeURIComponent(assignmentId)}`
      : orderDestination || explicitDestination || ordersPath
    setNotificationOpen(false)
    navigate(destination)
  }

  const clearAllNotifications = async () => {
    if (!clearNotifications || !unreadNotifications.length) {
      notify?.('Chưa có thông báo để cập nhật.', 'info')
      return
    }
    setNotificationBusy(true)
    try {
      const result = await clearNotifications(scopedNotificationStoreId)
      if (result?.ok === false) notify?.(result.message || 'Không thể cập nhật danh sách thông báo.', 'info')
    } catch (error) {
      notify?.(error.message || 'Không thể cập nhật danh sách thông báo.', 'info')
    } finally {
      setNotificationBusy(false)
    }
  }

  return (
    <div className={`app-shell app-shell--${role} ${isStoreWorkspace ? 'app-shell--store-workspace' : ''} ${isSystemWorkspace ? 'app-shell--system-workspace' : ''}`}>
      {mobileOpen && <button className="sidebar-scrim" onClick={() => setMobileOpen(false)} aria-label="Đóng menu" />}
      <aside className={`sidebar ${mobileOpen ? 'sidebar--open' : ''}`}>
        <button className="sidebar__close" onClick={() => setMobileOpen(false)} aria-label="Đóng menu"><X size={20} /></button>
        <div className="sidebar__brand">
          {isEmployee && !isOfficeEmployee ? (
            <div className="store-logo"><img src="/favicon.png" alt="Logo IDOSI" /><div><strong>{activeStore?.name || 'IDOSI'}</strong><small>Nhân viên cửa hàng</small></div></div>
          ) : isEmployee ? <Brand /> : isStoreWorkspace ? (
            <div className="store-logo"><img src="/favicon.png" alt="Logo IDOSI" /><div><strong>{activeStore?.name || 'IDOSI'}</strong><small>{systemRoleLabel}</small></div></div>
          ) : <Brand subtitle={isBusinessSupport ? 'Hỗ trợ KD' : 'Quản lý toàn hệ thống'} />}
        </div>
        {canSwitchRole && (
          <button
            type="button"
            className="role-switcher-button"
            onClick={() => {
              setMobileOpen(false)
              setNotificationOpen(false)
              navigate('/select-role')
            }}
          >
            <Repeat2 size={18} />
            <span>Đổi vai trò</span>
          </button>
        )}
        {isStoreWorkspace && isSystemOperator && (
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
            <Avatar name={session?.name} src={app.settings?.avatar} size={38} />
            <div><strong>{session?.name}</strong><small>{accountSubtitle}</small></div>
            <button onClick={handleLogout} aria-label="Đăng xuất"><LogOut size={18} /></button>
          </div>
        </div>
      </aside>

      <main className="main-content">
        <div className="global-topbar">
          <button className="icon-button topbar-menu" onClick={() => setMobileOpen(true)} aria-label="Mở menu"><Menu size={22} /></button>
          {(isStoreWorkspace || (isEmployee && !isOfficeEmployee)) && <div className="global-topbar__store-name">{activeStore?.name || 'Cửa hàng IDOSI'}</div>}
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
                      disabled={!unreadNotifications.length || notificationBusy}
                    ><X size={15} /> {notificationBusy ? 'Đang cập nhật...' : 'Xóa tất cả thông báo'}</button>
                  </header>
                  <div className="notification-list">
                    {unreadNotifications.map((item, index) => (
                      <button
                        type="button"
                        className="notification-item"
                        key={item?.id || item?.notificationId || `${item?.orderId || 'notification'}-${index}`}
                        onClick={() => openNotification(item)}
                      >
                        <span className="notification-item__icon">{isAssignedTaskNotification(item) ? <ClipboardCheck size={17} /> : <ShoppingCart size={17} />}</span>
                        <span className="notification-item__body">
                          <strong>{item?.title || item?.message || 'Thông báo mới'}</strong>
                          <small>{item?.description || item?.content || item?.message || item?.orderCode || item?.data?.orderCode || 'Mở để xem chi tiết'}</small>
                          {(item?.createdAt || item?.time || item?.updatedAt) && <time>{notificationTime24(item.createdAt || item.time || item.updatedAt)}</time>}
                        </span>
                      </button>
                    ))}
                    {!unreadNotifications.length && (
                      <div className="notification-empty"><Bell size={24} /><strong>Không có thông báo mới</strong><span>Công việc và đơn hàng mới sẽ hiển thị tại đây.</span></div>
                    )}
                  </div>
                </section>
              )}
            </div>
            <button
              className="topbar-account-button"
              onClick={() => navigate('/account/settings')}
              aria-label="Mở trang tài khoản"
            >
              <Avatar name={session?.name} src={app.settings?.avatar} size={38} />
              <span className="topbar-user"><strong>{session?.name}</strong><small>{accountSubtitle}</small></span>
              <ChevronDown size={17} />
            </button>
          </div>
        </div>
        {taskPopup && (
          <button type="button" className="task-notification-popup" onClick={() => openNotification(taskPopup)} aria-label="Mở công việc vừa được giao">
            <span><ClipboardCheck size={20} /></span>
            <span><strong>{taskPopup.title || 'Bạn có công việc mới'}</strong><small>{taskPopup.description || taskPopup.message || 'Bấm để xem danh sách công việc được giao.'}</small></span>
          </button>
        )}
        <Outlet context={{ openMenu: () => setMobileOpen(true), activeStore }} />
      </main>
      <Toast toast={toast} />
    </div>
  )
}

export function ProtectedRoute({ children, roles }) {
  const { session } = useApp()
  const canonicalRole = session?.role === 'manager' ? 'business_support' : session?.role
  const allowedRoles = roles ? (Array.isArray(roles) ? roles : [roles]) : null
  if (!session || (allowedRoles && !allowedRoles.includes(canonicalRole))) return null
  return children
}
