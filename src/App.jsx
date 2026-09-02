import { Component, lazy, Suspense } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { isOfficeProfile } from './domain/officeProfile'
import Login from './pages/Login'
import { useApp } from './state/AppContext'

const lazyNamed = (loadModule, exportName) => lazy(() => (
  loadModule().then((module) => ({ default: module[exportName] }))
))

const AppShell = lazy(() => import('./layout/AppShell'))
const RoleSelectionPage = lazy(() => import('./pages/RoleSelectionPage'))

const loadAdminPages = () => import('./pages/admin/AdminPages')
const AdminSettings = lazyNamed(loadAdminPages, 'AdminSettings')
const AdminStores = lazyNamed(loadAdminPages, 'AdminStores')

const loadRoleManagement = () => import('./pages/admin/RoleManagement')
const BusinessSupportManagement = lazyNamed(loadRoleManagement, 'BusinessSupportManagement')
const StoreManagerManagement = lazyNamed(loadRoleManagement, 'StoreManagerManagement')

const CustomerSurveyPage = lazyNamed(() => import('./pages/admin/CustomerSurveyPage'), 'CustomerSurveyPage')
const AttendanceResetPage = lazyNamed(() => import('./pages/admin/AttendanceResetPage'), 'AttendanceResetPage')
const AdminWorkRegistrationSchedulePage = lazyNamed(() => import('./pages/admin/AdminWorkRegistrationSchedulePage'), 'AdminWorkRegistrationSchedulePage')
const OrderInformationSettingsPage = lazyNamed(() => import('./pages/admin/OrderInformationSettingsPage'), 'OrderInformationSettingsPage')
const WorkCatalogSettingsPage = lazyNamed(() => import('./pages/admin/WorkCatalogSettingsPage'), 'WorkCatalogSettingsPage')

const loadSupportWorkPages = () => import('./pages/admin/SupportWorkPages')
const AdminSupportAssignmentPage = lazyNamed(loadSupportWorkPages, 'AdminSupportAssignmentPage')
const AdminSupportWorkPage = lazyNamed(loadSupportWorkPages, 'AdminSupportWorkPage')
const SupportAssignedWorkPage = lazyNamed(loadSupportWorkPages, 'SupportAssignedWorkPage')
const SupportWorkInboxPage = lazyNamed(loadSupportWorkPages, 'SupportWorkInboxPage')

const loadBusinessSupportSchedule = () => import('./pages/admin/BusinessSupportSchedulePage')
const BusinessSupportSchedulePage = lazyNamed(loadBusinessSupportSchedule, 'BusinessSupportSchedulePage')
const MyBusinessSupportSchedulePage = lazyNamed(loadBusinessSupportSchedule, 'MyBusinessSupportSchedulePage')

const loadSystemFinance = () => import('./pages/admin/SystemFinanceV2')
const AdminCashflowV2 = lazyNamed(loadSystemFinance, 'AdminCashflowV2')
const AdminOverviewV2 = lazyNamed(loadSystemFinance, 'AdminOverviewV2')
const AdminReportsV2 = lazyNamed(loadSystemFinance, 'AdminReportsV2')

const loadGovernancePages = () => import('./pages/admin/GovernancePages')
const OrderAuditPage = lazyNamed(loadGovernancePages, 'OrderAuditPage')
const PolicySettings = lazyNamed(loadGovernancePages, 'PolicySettings')
const SupportTransfersPage = lazyNamed(loadGovernancePages, 'SupportTransfersPage')
const SystemEmployees = lazyNamed(loadGovernancePages, 'SystemEmployees')

const OfficeManagement = lazyNamed(() => import('./pages/office/OfficeManagement'), 'OfficeManagement')

const loadEmployeePages = () => import('./pages/employee/EmployeePages')
const EmployeeCashflow = lazyNamed(loadEmployeePages, 'EmployeeCashflow')
const EmployeeShiftHistory = lazyNamed(loadEmployeePages, 'EmployeeShiftHistory')

const EmployeeSchedulePage = lazyNamed(() => import('./pages/employee/EmployeeSchedulePage'), 'EmployeeSchedulePage')

const loadEmployeeShiftOperations = () => import('./pages/employee/EmployeeShiftOperations')
const EmployeeAssignedTasksPage = lazyNamed(loadEmployeeShiftOperations, 'EmployeeAssignedTasksPage')
const EmployeeShiftExpensePage = lazyNamed(loadEmployeeShiftOperations, 'EmployeeShiftExpensePage')

const loadEmployeeV2Pages = () => import('./pages/employee/EmployeeV2Pages')
const EmployeeAttendancePage = lazyNamed(loadEmployeeV2Pages, 'EmployeeAttendancePage')
const EmployeeDashboardV2 = lazyNamed(loadEmployeeV2Pages, 'EmployeeDashboardV2')
const EmployeeOrdersPage = lazyNamed(loadEmployeeV2Pages, 'EmployeeOrdersPage')
const EmployeePayrollDetails = lazyNamed(loadEmployeeV2Pages, 'EmployeePayrollDetails')

const loadOfficeEmployeeDashboard = () => import('./pages/employee/OfficeEmployeeDashboard')
const OfficeEmployeeDashboard = lazyNamed(loadOfficeEmployeeDashboard, 'OfficeEmployeeDashboard')
const OfficeEmployeePayrollPage = lazyNamed(loadOfficeEmployeeDashboard, 'OfficeEmployeePayrollPage')

const loadStoreOperations = () => import('./pages/store/StoreOperations')
const StoreEmployees = lazyNamed(loadStoreOperations, 'StoreEmployees')
const StoreTasks = lazyNamed(loadStoreOperations, 'StoreTasks')

const StoreSettings = lazyNamed(() => import('./pages/store/StoreFinance'), 'StoreSettings')
const StoreExpensesV2 = lazyNamed(() => import('./pages/store/StoreExpensesV2'), 'StoreExpensesV2')
const StoreSalarySettings = lazyNamed(() => import('./pages/store/StoreSalarySettings'), 'StoreSalarySettings')

const loadStoreV2Pages = () => import('./pages/store/StoreV2Pages')
const StoreAttendanceV2 = lazyNamed(loadStoreV2Pages, 'StoreAttendanceV2')
const StoreCashflowV2 = lazyNamed(loadStoreV2Pages, 'StoreCashflowV2')
const StoreImportsV2 = lazyNamed(loadStoreV2Pages, 'StoreImportsV2')
const StoreOverviewV2 = lazyNamed(loadStoreV2Pages, 'StoreOverviewV2')
const StoreOrdersPage = lazyNamed(loadStoreV2Pages, 'StoreOrdersPage')
const StorePayrollV2 = lazyNamed(loadStoreV2Pages, 'StorePayrollV2')
const StoreReportsV2 = lazyNamed(loadStoreV2Pages, 'StoreReportsV2')

const UnifiedSchedule = lazy(() => import('./pages/store/UnifiedSchedule'))

const loadCompensationPages = () => import('./pages/compensation')
const ManagerCompensationPage = lazyNamed(loadCompensationPages, 'ManagerCompensationPage')
const MyCompensationPage = lazyNamed(loadCompensationPages, 'MyCompensationPage')
const MyViolationsPage = lazyNamed(loadCompensationPages, 'MyViolationsPage')
const RevenueBonusPage = lazyNamed(loadCompensationPages, 'RevenueBonusPage')
const ViolationRefundPage = lazyNamed(loadCompensationPages, 'ViolationRefundPage')
const ViolationManagementPage = lazyNamed(loadCompensationPages, 'ViolationManagementPage')

const canonicalRole = (role) => role === 'manager' ? 'business_support' : role

const homeByRole = {
  admin: '/admin/overview',
  business_support: '/support/overview',
  store_manager: '/store/overview',
  employee: '/employee/home',
}

const homeFor = (session) => homeByRole[canonicalRole(session?.role)] || '/login'

function RouteLoading({ message = 'Đang tải màn hình...' }) {
  return <div className="route-loading" role="status" aria-live="polite" aria-busy="true">{message}</div>
}

export class RouteErrorBoundary extends Component {
  state = { error: null }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, errorInfo) {
    console.error('Không thể tải màn hình ứng dụng.', error, errorInfo)
  }

  render() {
    if (!this.state.error) return this.props.children

    return (
      <div className="route-loading" role="alert">
        <section className="route-loading__error">
          <strong>Không thể tải phiên bản hiện tại</strong>
          <p>Hệ thống có thể vừa được cập nhật hoặc kết nối bị gián đoạn.</p>
          <button type="button" className="button" onClick={() => (this.props.onReload || (() => window.location.reload()))()}>
            Tải lại trang
          </button>
        </section>
      </div>
    )
  }
}

function RoleGuard({ roles, children }) {
  const { session, authReady = true, remoteDataReady = true } = useApp()
  const location = useLocation()
  if (!authReady) return <RouteLoading message="Đang khôi phục màn hình..." />
  if (!session) return <Navigate to="/login" replace />
  if (session.needsRoleSelection) return <Navigate to="/select-role" replace />
  const allowedRoles = Array.isArray(roles) ? roles : [roles]
  if (!allowedRoles.includes(canonicalRole(session.role))) return <Navigate to={homeFor(session)} replace />
  const initialRoleHome = location.pathname === homeFor(session)
  if (!remoteDataReady && !initialRoleHome) {
    return <RouteLoading message="Đang tải dữ liệu chi tiết của hệ thống..." />
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
  const { session } = useApp()
  return canonicalRole(session?.role) === 'store_manager'
    ? <OfficeEmployeeDashboard />
    : <StoreOverviewV2 />
}

function AdminSupportRewardViolationPage() {
  return <>
    <AdminSupportWorkPage />
    <ViolationManagementPage targetUnit="business_support" embedded />
  </>
}

export default function App() {
  const { session, authReady = true } = useApp()
  return (
    <RouteErrorBoundary>
      <Suspense fallback={<RouteLoading />}>
        <Routes>
      <Route path="/" element={<EntryRedirect />} />
      <Route path="/login" element={!authReady ? <RouteLoading message="Đang khôi phục màn hình..." /> : session ? <Navigate to={session.needsRoleSelection ? '/select-role' : homeFor(session)} replace /> : <Login />} />
      <Route path="/select-role" element={<RoleSelectionPage />} />

      <Route element={<RoleGuard roles={['admin', 'business_support', 'store_manager', 'employee']}><AppShell /></RoleGuard>}>
        <Route path="/account/settings" element={<AdminSettings />} />
      </Route>

      <Route element={<RoleGuard roles={['admin', 'business_support']}><AppShell /></RoleGuard>}>
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
        <Route path="/admin/violations/store" element={<ViolationManagementPage targetUnit="store" />} />
        <Route path="/admin/violations/office" element={<ViolationManagementPage targetUnit="office" />} />
      </Route>

      <Route element={<RoleGuard roles={['admin', 'business_support', 'store_manager']}><AppShell /></RoleGuard>}>
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

      <Route element={<RoleGuard roles="business_support"><AppShell /></RoleGuard>}>
        <Route path="/support/overview" element={<OfficeEmployeeDashboard />} />
        <Route path="/support/attendance" element={<Navigate to="/support/overview" replace />} />
        <Route path="/support/tasks" element={<SupportAssignedWorkPage />} />
        <Route path="/support/assigned-work" element={<SupportWorkInboxPage />} />
        <Route path="/support/my-schedule" element={<MyBusinessSupportSchedulePage />} />
        <Route path="/support/my-compensation" element={<MyCompensationPage />} />
        <Route path="/support/my-violations" element={<MyViolationsPage />} />
      </Route>

      <Route element={<RoleGuard roles="admin"><AppShell /></RoleGuard>}>
        <Route path="/admin/tasks" element={<AdminSupportRewardViolationPage />} />
        <Route path="/admin/assignments" element={<AdminSupportAssignmentPage />} />
        <Route path="/admin/reset" element={<AttendanceResetPage />} />
        <Route path="/admin/work-registration-schedules" element={<AdminWorkRegistrationSchedulePage />} />
        <Route path="/admin/violations/business-support" element={<ViolationManagementPage targetUnit="business_support" />} />
      </Route>

      <Route element={<RoleGuard roles="employee"><AppShell /></RoleGuard>}>
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
      </Suspense>
    </RouteErrorBoundary>
  )
}
