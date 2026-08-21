import { Navigate, Route, Routes } from 'react-router-dom'
import AppShell from './layout/AppShell'
import Login from './pages/Login'
import RoleSelectionPage from './pages/RoleSelectionPage'
import {
  AdminSettings,
  AdminStores,
} from './pages/admin/AdminPages'
import { BusinessSupportManagement, StoreManagerManagement } from './pages/admin/RoleManagement'
import { CustomerSurveyPage } from './pages/admin/CustomerSurveyPage'
import { AttendanceResetPage } from './pages/admin/AttendanceResetPage'
import { AdminSupportWorkPage, SupportAssignedWorkPage } from './pages/admin/SupportWorkPages'
import { BusinessSupportSchedulePage, MyBusinessSupportSchedulePage } from './pages/admin/BusinessSupportSchedulePage'
import {
  AdminCashflowV2,
  AdminOverviewV2,
  AdminReportsV2,
} from './pages/admin/SystemFinanceV2'
import {
  OrderAuditPage,
  PolicySettings,
  SupportTransfersPage,
  SystemEmployees,
} from './pages/admin/GovernancePages'
import { OfficeManagement } from './pages/office/OfficeManagement'
import {
  EmployeeCashflow,
  EmployeeShiftHistory,
} from './pages/employee/EmployeePages'
import { EmployeeSchedulePage } from './pages/employee/EmployeeSchedulePage'
import {
  EmployeeAttendancePage,
  EmployeeDashboardV2,
  EmployeeOrdersPage,
  EmployeePayrollDetails,
} from './pages/employee/EmployeeV2Pages'
import {
  OfficeEmployeeDashboard,
  OfficeEmployeePayrollPage,
} from './pages/employee/OfficeEmployeeDashboard'
import { isOfficeProfile } from './pages/employee/officeAttendance'
import { StoreEmployees, StoreTasks } from './pages/store/StoreOperations'
import { StoreSettings } from './pages/store/StoreFinance'
import { StoreExpensesV2 } from './pages/store/StoreExpensesV2'
import {
  StoreAttendanceV2,
  StoreCashflowV2,
  StoreImportsV2,
  StoreOverviewV2,
  StoreOrdersPage,
  StorePayrollV2,
  StoreReportsV2,
} from './pages/store/StoreV2Pages'
import UnifiedSchedule from './pages/store/UnifiedSchedule'
import { useApp } from './state/AppContext'

const canonicalRole = (role) => role === 'manager' ? 'business_support' : role

const homeByRole = {
  admin: '/admin/overview',
  business_support: '/support/overview',
  store_manager: '/store/overview',
  employee: '/employee/home',
}

const homeFor = (session) => homeByRole[canonicalRole(session?.role)] || '/login'

function RoleGuard({ roles, children }) {
  const { session, authReady = true } = useApp()
  if (!authReady) return <div className="route-loading" role="status">Đang khôi phục màn hình...</div>
  if (!session) return <Navigate to="/login" replace />
  if (session.needsRoleSelection) return <Navigate to="/select-role" replace />
  const allowedRoles = Array.isArray(roles) ? roles : [roles]
  if (!allowedRoles.includes(canonicalRole(session.role))) return <Navigate to={homeFor(session)} replace />
  return children
}

function EntryRedirect() {
  const { session, authReady = true } = useApp()
  if (!authReady) return <div className="route-loading" role="status">Đang khôi phục màn hình...</div>
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

export default function App() {
  const { session, authReady = true } = useApp()
  return (
    <Routes>
      <Route path="/" element={<EntryRedirect />} />
      <Route path="/login" element={!authReady ? <div className="route-loading" role="status">Đang khôi phục màn hình...</div> : session ? <Navigate to={session.needsRoleSelection ? '/select-role' : homeFor(session)} replace /> : <Login />} />
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
        <Route path="/store/cashflow" element={<StoreCashflowV2 />} />
        <Route path="/store/reports" element={<StoreReportsV2 />} />
        <Route path="/store/settings" element={<StoreSettings />} />
      </Route>

      <Route element={<RoleGuard roles="business_support"><AppShell /></RoleGuard>}>
        <Route path="/support/overview" element={<OfficeEmployeeDashboard />} />
        <Route path="/support/attendance" element={<Navigate to="/support/overview" replace />} />
        <Route path="/support/tasks" element={<SupportAssignedWorkPage />} />
        <Route path="/support/my-schedule" element={<MyBusinessSupportSchedulePage />} />
      </Route>

      <Route element={<RoleGuard roles="admin"><AppShell /></RoleGuard>}>
        <Route path="/admin/tasks" element={<AdminSupportWorkPage />} />
        <Route path="/admin/reset" element={<AttendanceResetPage />} />
      </Route>

      <Route element={<RoleGuard roles="employee"><AppShell /></RoleGuard>}>
        <Route path="/employee/home" element={<EmployeeHomePage />} />
        <Route path="/employee/tasks" element={<SupportAssignedWorkPage />} />
        <Route path="/employee/orders" element={<StoreEmployeeRoute><EmployeeOrdersPage /></StoreEmployeeRoute>} />
        <Route path="/employee/attendance" element={<EmployeeAttendanceRoute />} />
        <Route path="/employee/shifts" element={<Navigate to="/employee/work-history" replace />} />
        <Route path="/employee/work-history" element={<EmployeeShiftHistory />} />
        <Route path="/employee/schedule" element={<EmployeeScheduleRoute />} />
        <Route path="/employee/payroll" element={<EmployeePayrollPage />} />
        <Route path="/employee/cashflow" element={<StoreEmployeeRoute><EmployeeCashflow /></StoreEmployeeRoute>} />
      </Route>

      <Route path="*" element={<EntryRedirect />} />
    </Routes>
  )
}
