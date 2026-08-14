import { Navigate, Route, Routes } from 'react-router-dom'
import AppShell from './layout/AppShell'
import Login from './pages/Login'
import {
  AdminSettings,
  AdminStores,
  AdminTasks,
} from './pages/admin/AdminPages'
import {
  AdminCashflowV2,
  AdminOverviewV2,
  AdminReportsV2,
} from './pages/admin/SystemFinanceV2'
import {
  OrderAuditPage,
  PolicySettings,
  ResetDataPage,
  SupportTransfersPage,
  SystemEmployees,
} from './pages/admin/GovernancePages'
import { OfficeManagement } from './pages/office/OfficeManagement'
import {
  EmployeeCashflow,
  EmployeeShiftHistory,
} from './pages/employee/EmployeePages'
import {
  EmployeeAttendancePage,
  EmployeeDashboardV2,
  EmployeeOrdersPage,
  EmployeePayrollDetails,
} from './pages/employee/EmployeeV2Pages'
import { StoreEmployees } from './pages/store/StoreOperations'
import { StoreSettings } from './pages/store/StoreFinance'
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

const homeByRole = {
  admin: '/admin/overview',
  employee: '/employee/home',
}

const homeFor = (session) => homeByRole[session?.role] || '/login'

function RoleGuard({ roles, children }) {
  const { session } = useApp()
  if (!session) return <Navigate to="/login" replace />
  const allowedRoles = Array.isArray(roles) ? roles : [roles]
  if (!allowedRoles.includes(session.role)) return <Navigate to={homeFor(session)} replace />
  return children
}

function EntryRedirect() {
  const { session } = useApp()
  return <Navigate to={homeFor(session)} replace />
}

export default function App() {
  const { session } = useApp()
  return (
    <Routes>
      <Route path="/" element={<EntryRedirect />} />
      <Route path="/login" element={session ? <Navigate to={homeFor(session)} replace /> : <Login />} />

      <Route element={<RoleGuard roles="admin"><AppShell /></RoleGuard>}>
        <Route path="/admin/overview" element={<AdminOverviewV2 />} />
        <Route path="/admin/stores" element={<AdminStores />} />
        <Route path="/admin/tasks" element={<AdminTasks />} />
        <Route path="/admin/cashflow" element={<AdminCashflowV2 />} />
        <Route path="/admin/reports" element={<AdminReportsV2 />} />

        <Route path="/store/overview" element={<StoreOverviewV2 />} />
        <Route path="/store/shifts" element={<Navigate to="/store/schedule" replace />} />
        <Route path="/store/schedule" element={<UnifiedSchedule />} />
        <Route path="/store/employees" element={<StoreEmployees />} />
        <Route path="/store/orders" element={<StoreOrdersPage />} />
        <Route path="/store/imports" element={<StoreImportsV2 />} />
        <Route path="/store/attendance" element={<StoreAttendanceV2 />} />
        <Route path="/store/payroll" element={<StorePayrollV2 />} />
        <Route path="/store/cashflow" element={<StoreCashflowV2 />} />
        <Route path="/store/reports" element={<StoreReportsV2 />} />
        <Route path="/store/settings" element={<StoreSettings />} />
      </Route>

      <Route element={<RoleGuard roles="admin"><AppShell /></RoleGuard>}>
        <Route path="/office" element={<OfficeManagement />} />
        <Route path="/admin/office" element={<Navigate to="/office" replace />} />
        <Route path="/admin/employees" element={<SystemEmployees />} />
        <Route path="/admin/policies" element={<PolicySettings />} />
        <Route path="/admin/reset" element={<ResetDataPage />} />
        <Route path="/admin/order-audit" element={<OrderAuditPage />} />
        <Route path="/admin/support-transfers" element={<SupportTransfersPage />} />
        <Route path="/admin/settings" element={<AdminSettings />} />
      </Route>

      <Route element={<RoleGuard roles="employee"><AppShell /></RoleGuard>}>
        <Route path="/employee/home" element={<EmployeeDashboardV2 />} />
        <Route path="/employee/orders" element={<EmployeeOrdersPage />} />
        <Route path="/employee/attendance" element={<EmployeeAttendancePage />} />
        <Route path="/employee/shifts" element={<Navigate to="/employee/work-history" replace />} />
        <Route path="/employee/work-history" element={<EmployeeShiftHistory />} />
        <Route path="/employee/payroll" element={<EmployeePayrollDetails />} />
        <Route path="/employee/cashflow" element={<EmployeeCashflow />} />
      </Route>

      <Route path="*" element={<EntryRedirect />} />
    </Routes>
  )
}
