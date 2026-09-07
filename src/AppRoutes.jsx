import { cloneElement, Suspense, useLayoutEffect, useState } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { isOfficeProfile } from './domain/officeProfile'
import { employeeScreen, storeScreenForPath, systemScreenForPath } from './domain/workspaceScreens'
import Login from './pages/Login'
import { useApp } from './state/AppContext'

import {
  AppShell,
  RoleSelectionPage,
  AdminSettings,
  AdminStores,
  BusinessSupportManagement,
  StoreManagerManagement,
  CustomerSurveyPage,
  AttendanceResetPage,
  DataRestorePage,
  AdminWorkRegistrationSchedulePage,
  OrderInformationSettingsPage,
  WorkCatalogSettingsPage,
  AdminSupportAssignmentPage,
  AdminSupportWorkPage,
  SupportAssignedWorkPage,
  SupportWorkInboxPage,
  BusinessSupportSchedulePage,
  MyBusinessSupportSchedulePage,
  AdminCashflowV2,
  AdminOverviewV2,
  AdminReportsV2,
  OrderAuditPage,
  PolicySettings,
  SupportTransfersPage,
  SystemEmployees,
  OfficeManagement,
  EmployeeCashflow,
  EmployeeShiftHistory,
  EmployeeSchedulePage,
  EmployeeAssignedTasksPage,
  EmployeeShiftExpensePage,
  EmployeeAttendancePage,
  EmployeeDashboardV2,
  EmployeeOrdersPage,
  EmployeePayrollDetails,
  OfficeEmployeeDashboard,
  OfficeEmployeePayrollPage,
  StoreEmployees,
  StoreTasks,
  StoreSettings,
  StoreExpensesV2,
  StoreSalarySettings,
  StoreAttendanceV2,
  StoreCashflowV2,
  StoreImportsV2,
  StoreOverviewV2,
  StoreOrdersPage,
  StorePayrollV2,
  StoreReportsV2,
  UnifiedSchedule,
  ManagerCompensationPage,
  MyCompensationPage,
  MyViolationsPage,
  RevenueBonusPage,
  ViolationRefundPage,
  ViolationManagementPage,
  preloadRouteModule,
} from './routeModules'

const canonicalRole = (role) => role === 'manager' ? 'business_support' : role

const homeByRole = {
  admin: '/admin/overview',
  business_support: '/support/overview',
  store_manager: '/store/overview',
  employee: '/employee/home',
}

const homeFor = (session) => homeByRole[canonicalRole(session?.role)] || '/login'

const currentVietnamMonth = () => new Date(Date.now() + (7 * 60 * 60 * 1_000)).toISOString().slice(0, 7)

function RouteLoading({ message = 'Đang tải màn hình...' }) {
  return <div className="route-loading" role="status" aria-live="polite" aria-busy="true">{message}</div>
}

function ProjectionLoadFailure({ onRetry }) {
  return <div className="route-loading" role="alert">
    <section className="route-loading__error">
      <strong>Không thể tải dữ liệu màn hình</strong>
      <p>Kết nối có thể vừa bị gián đoạn. Dữ liệu hiện có không bị thay đổi.</p>
      <button type="button" className="button" onClick={onRetry}>Thử lại</button>
    </section>
  </div>
}

function RoleGuard({ roles, children, preserveShell = false }) {
  const {
    session,
    currentEmployee,
    activeStoreId,
    authReady = true,
    remoteDataReady = true,
    remoteProjection = { kind: 'global', storeId: '' },
    ensureStoreWorkspaceData,
    ensureSystemWorkspaceData,
  } = useApp()
  const [projectionFailure, setProjectionFailure] = useState(null)
  const [projectionRetry, setProjectionRetry] = useState(0)
  const location = useLocation()
  const role = canonicalRole(session?.role)
  const allowedRoles = Array.isArray(roles) ? roles : [roles]
  const roleAllowed = allowedRoles.includes(role)
    && !(location.pathname === '/store/salary-settings' && role === 'store_manager')
  const systemOperator = ['admin', 'business_support'].includes(role)
  const remoteSession = remoteProjection.kind !== 'local'
  const storeWorkspace = location.pathname === '/store' || location.pathname.startsWith('/store/')
  const routeSearch = new URLSearchParams(location.search)
  const assignedStoreId = session?.storeId || session?.assignedStoreId || ''
  const routeStoreId = role === 'store_manager'
    ? assignedStoreId || activeStoreId || ''
    : routeSearch.get('store') || activeStoreId || ''
  const routeStoreScreen = storeScreenForPath(location.pathname)
  const routeSystemScreen = systemScreenForPath(location.pathname)
  const routeStorePeriod = ['overview', 'payroll'].includes(routeStoreScreen)
    ? routeSearch.get('period') || currentVietnamMonth()
    : ''
  const initialRoleHome = location.pathname === homeFor(session)
  const storeProjectionRequired = remoteSession
    && storeWorkspace
    && ['admin', 'business_support', 'store_manager'].includes(role)
  const accountProjectionRequired = routeSystemScreen === 'account-settings'
  const employeeProjectionRequired = role === 'employee' && employeeScreen(routeSystemScreen)
  const systemProjectionRequired = remoteSession
    && !storeWorkspace
    && Boolean(routeSystemScreen)
    && (systemOperator || employeeProjectionRequired || accountProjectionRequired)
  const projectionKey = storeProjectionRequired
    ? `store:${routeStoreId}:${routeStoreScreen}:${routeStorePeriod}`
    : systemProjectionRequired
      ? `system:${routeSystemScreen}`
      : ''

  useLayoutEffect(() => {
    if (!authReady || !session || session.needsRoleSelection || !roleAllowed) return
    void preloadRouteModule(location.pathname, { session, currentEmployee })
    if (!remoteSession) return
    let active = true
    const load = (request) => {
      setProjectionFailure(null)
      Promise.resolve(request()).catch(() => {
        if (active) setProjectionFailure({ key: projectionKey })
      })
    }
    if (storeProjectionRequired && routeStoreId) {
      load(() => ensureStoreWorkspaceData?.(routeStoreId, {
        screen: routeStoreScreen,
        ...(routeStorePeriod ? { period: routeStorePeriod } : {}),
      }))
      return () => { active = false }
    }
    // The provider owns freshness and deduplication. Even a matching cached
    // screen may need a refresh, and this guard must observe its failure/retry.
    if (systemProjectionRequired) {
      load(() => ensureSystemWorkspaceData?.({ screen: routeSystemScreen }))
    }
    return () => { active = false }
  }, [
    authReady,
    currentEmployee,
    location.pathname,
    roleAllowed,
    ensureStoreWorkspaceData,
    ensureSystemWorkspaceData,
    initialRoleHome,
    remoteDataReady,
    remoteProjection.kind,
    remoteProjection.period,
    remoteProjection.screen,
    routeStoreId,
    routeStoreScreen,
    routeStorePeriod,
    routeSystemScreen,
    session,
    storeProjectionRequired,
    systemProjectionRequired,
    remoteSession,
    projectionKey,
    projectionRetry,
  ])

  if (!authReady) return <RouteLoading message="Đang khôi phục màn hình..." />
  if (!session) return <Navigate to="/login" replace />
  if (session.needsRoleSelection) return <Navigate to="/select-role" replace />
  if (!roleAllowed) return <Navigate to={homeFor(session)} replace />
  const selectedStoreProjectionReady = !storeProjectionRequired || (
    remoteProjection.kind === 'store'
    && String(remoteProjection.storeId || '').toLocaleLowerCase('en-US') === String(routeStoreId).toLocaleLowerCase('en-US')
    && String(remoteProjection.screen || '') === routeStoreScreen
    && (!routeStorePeriod || String(remoteProjection.period || '') === routeStorePeriod)
  )
  const systemProjectionReady = !systemProjectionRequired || (
    remoteProjection.kind !== 'store'
    && String(remoteProjection.screen || '') === routeSystemScreen
  )
  const compactHomeReady = initialRoleHome && remoteProjection.kind !== 'store'
  if (projectionFailure?.key === projectionKey && !compactHomeReady) {
    const onRetry = () => setProjectionRetry((current) => current + 1)
    return preserveShell
      ? cloneElement(children, {
          workspaceStatus: {
            kind: 'error',
            message: 'Không thể tải dữ liệu màn hình',
            detail: 'Kết nối có thể vừa bị gián đoạn. Dữ liệu hiện có không bị thay đổi.',
            onRetry,
          },
        })
      : <ProjectionLoadFailure onRetry={onRetry} />
  }
  if ((!remoteDataReady || !selectedStoreProjectionReady || !systemProjectionReady) && !compactHomeReady) {
    return preserveShell
      ? cloneElement(children, {
          workspaceStatus: {
            kind: 'loading',
            message: 'Đang tải dữ liệu chi tiết...',
          },
        })
      : <RouteLoading message="Đang tải dữ liệu chi tiết của hệ thống..." />
  }
  return children
}

function EntryRedirect() {
  const { session, authReady = true } = useApp()
  if (!authReady) return <RouteLoading message="Đang khôi phục màn hình..." />
  return <Navigate to={session?.needsRoleSelection ? '/select-role' : homeFor(session)} replace />
}

function EmployeeHomePage() {
  const { session, currentEmployee } = useApp()
  return isOfficeProfile(session, currentEmployee)
    ? <OfficeEmployeeDashboard />
    : <EmployeeDashboardV2 />
}

function EmployeePayrollPage() {
  const { session, currentEmployee } = useApp()
  return isOfficeProfile(session, currentEmployee)
    ? <OfficeEmployeePayrollPage />
    : <EmployeePayrollDetails />
}

function EmployeeAttendanceRoute() {
  const { session, currentEmployee } = useApp()
  return isOfficeProfile(session, currentEmployee)
    ? <OfficeEmployeeDashboard />
    : <EmployeeAttendancePage />
}

function EmployeeScheduleRoute() {
  const { session, currentEmployee } = useApp()
  return isOfficeProfile(session, currentEmployee)
    ? <MyBusinessSupportSchedulePage />
    : <EmployeeSchedulePage />
}

function EmployeeTasksRoute() {
  const { session, currentEmployee } = useApp()
  return isOfficeProfile(session, currentEmployee)
    ? <SupportAssignedWorkPage />
    : <EmployeeAssignedTasksPage />
}

function StoreEmployeeRoute({ children }) {
  const { session, currentEmployee } = useApp()
  return isOfficeProfile(session, currentEmployee)
    ? <Navigate to="/employee/home" replace />
    : children
}

function StoreOverviewRoute() {
  return <StoreOverviewV2 />
}

function WorkspaceShellContent({ workspaceStatus }) {
  return <Suspense fallback={<RouteLoading />}><AppShell workspaceStatus={workspaceStatus} /></Suspense>
}

function WorkspaceShell({ roles }) {
  return (
    <RoleGuard roles={roles} preserveShell>
      <WorkspaceShellContent />
    </RoleGuard>
  )
}

export default function AppRoutes() {
  const { session, authReady = true } = useApp()
  return (
    <Routes>
      <Route path="/" element={<EntryRedirect />} />
      <Route path="/login" element={!authReady ? <RouteLoading message="Đang khôi phục màn hình..." /> : session ? <Navigate to={session.needsRoleSelection ? '/select-role' : homeFor(session)} replace /> : <Login />} />
      <Route path="/select-role" element={<RoleSelectionPage />} />

      <Route element={<WorkspaceShell roles={['admin', 'business_support', 'store_manager', 'employee']} />}>
        <Route path="/account/settings" element={<AdminSettings />} />
      </Route>

      <Route element={<WorkspaceShell roles={['admin', 'business_support']} />}>
        <Route path="/admin/overview" element={<AdminOverviewV2 />} />
        <Route path="/admin/stores" element={<AdminStores />} />
        <Route path="/admin/cashflow" element={<AdminCashflowV2 />} />
        <Route path="/admin/reports" element={<AdminReportsV2 />} />
        <Route path="/admin/employees" element={<SystemEmployees />} />
        <Route path="/admin/business-support" element={<BusinessSupportManagement />} />
        <Route path="/admin/business-support-schedule" element={<BusinessSupportSchedulePage />} />
        <Route path="/admin/store-managers" element={<StoreManagerManagement />} />
        <Route path="/office" element={<OfficeManagement />} />
        <Route path="/admin/office" element={<Navigate to="/office" replace />} />
        <Route path="/admin/settings" element={<AdminSettings />} />
        <Route path="/admin/policies" element={<PolicySettings />} />
        <Route path="/admin/order-audit" element={<OrderAuditPage />} />
        <Route path="/admin/customer-survey" element={<CustomerSurveyPage />} />
        <Route path="/admin/support-transfers" element={<SupportTransfersPage />} />
        <Route path="/admin/order-information-settings" element={<OrderInformationSettingsPage />} />
        <Route path="/admin/work-catalog" element={<WorkCatalogSettingsPage />} />
        <Route path="/admin/compensation/managers" element={<ManagerCompensationPage />} />
        <Route path="/admin/compensation/revenue" element={<RevenueBonusPage />} />
        <Route path="/admin/tasks" element={<AdminSupportWorkPage />} />
        <Route path="/admin/violations/store" element={<ViolationManagementPage targetUnit="store" />} />
        <Route path="/admin/violations/office" element={<ViolationManagementPage targetUnit="office" />} />
      </Route>

      <Route element={<WorkspaceShell roles={['admin', 'business_support', 'store_manager']} />}>
        <Route path="/store/overview" element={<StoreOverviewRoute />} />
        <Route path="/store/shifts" element={<Navigate to="/store/schedule" replace />} />
        <Route path="/store/schedule" element={<UnifiedSchedule />} />
        <Route path="/store/employees" element={<StoreEmployees />} />
        <Route path="/store/orders" element={<StoreOrdersPage />} />
        <Route path="/store/tasks" element={<StoreTasks />} />
        <Route path="/store/imports" element={<StoreImportsV2 />} />
        <Route path="/store/expenses" element={<StoreExpensesV2 />} />
        <Route path="/store/attendance" element={<StoreAttendanceV2 />} />
        <Route path="/store/payroll" element={<StorePayrollV2 />} />
        <Route path="/store/salary-settings" element={<RoleGuard roles={['admin', 'business_support']}><StoreSalarySettings /></RoleGuard>} />
        <Route path="/store/revenue-bonus" element={<RevenueBonusPage storeScoped />} />
        <Route path="/store/violation-refunds" element={<ViolationRefundPage />} />
        <Route path="/store/my-compensation" element={<MyCompensationPage />} />
        <Route path="/store/my-violations" element={<MyViolationsPage />} />
        <Route path="/store/cashflow" element={<StoreCashflowV2 />} />
        <Route path="/store/reports" element={<StoreReportsV2 />} />
        <Route path="/store/settings" element={<StoreSettings />} />
      </Route>

      <Route element={<WorkspaceShell roles="business_support" />}>
        <Route path="/support/overview" element={<OfficeEmployeeDashboard />} />
        <Route path="/support/attendance" element={<Navigate to="/support/overview" replace />} />
        <Route path="/support/tasks" element={<SupportAssignedWorkPage />} />
        <Route path="/support/assigned-work" element={<SupportWorkInboxPage />} />
        <Route path="/support/my-schedule" element={<MyBusinessSupportSchedulePage />} />
        <Route path="/support/my-compensation" element={<MyCompensationPage />} />
        <Route path="/support/my-violations" element={<MyViolationsPage />} />
      </Route>

      <Route element={<WorkspaceShell roles="admin" />}>
        <Route path="/admin/assignments" element={<AdminSupportAssignmentPage />} />
        <Route path="/admin/reset" element={<AttendanceResetPage />} />
        <Route path="/admin/data-restore" element={<DataRestorePage />} />
        <Route path="/admin/work-registration-schedules" element={<AdminWorkRegistrationSchedulePage />} />
        <Route path="/admin/violations/business-support" element={<ViolationManagementPage targetUnit="business_support" />} />
      </Route>

      <Route element={<WorkspaceShell roles="employee" />}>
        <Route path="/employee/home" element={<EmployeeHomePage />} />
        <Route path="/employee/tasks" element={<EmployeeTasksRoute />} />
        <Route path="/employee/assigned-work" element={<SupportWorkInboxPage />} />
        <Route path="/employee/reward-tasks" element={<StoreEmployeeRoute><SupportAssignedWorkPage /></StoreEmployeeRoute>} />
        <Route path="/employee/shift-expenses" element={<StoreEmployeeRoute><EmployeeShiftExpensePage /></StoreEmployeeRoute>} />
        <Route path="/employee/orders" element={<StoreEmployeeRoute><EmployeeOrdersPage /></StoreEmployeeRoute>} />
        <Route path="/employee/attendance" element={<EmployeeAttendanceRoute />} />
        <Route path="/employee/shifts" element={<Navigate to="/employee/work-history" replace />} />
        <Route path="/employee/work-history" element={<EmployeeShiftHistory />} />
        <Route path="/employee/schedule" element={<EmployeeScheduleRoute />} />
        <Route path="/employee/payroll" element={<EmployeePayrollPage />} />
        <Route path="/employee/compensation" element={<MyCompensationPage />} />
        <Route path="/employee/violations" element={<MyViolationsPage />} />
        <Route path="/employee/revenue-bonus" element={<StoreEmployeeRoute><RevenueBonusPage storeScoped /></StoreEmployeeRoute>} />
        <Route path="/employee/cashflow" element={<StoreEmployeeRoute><EmployeeCashflow /></StoreEmployeeRoute>} />
      </Route>

      <Route path="*" element={<EntryRedirect />} />
    </Routes>
  )
}
