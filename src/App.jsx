import { Navigate, Route, Routes } from 'react-router-dom'
import AppShell from './layout/AppShell'
import Login from './pages/Login'
import {
  AdminCashflow,
  AdminOverview,
  AdminReports,
  AdminSettings,
  AdminStores,
  AdminTasks,
  ManagerPayroll,
} from './pages/admin/AdminPages'
import { ManagerAccounts } from './pages/admin/ManagerAccounts'
import { OfficeManagement } from './pages/office/OfficeManagement'
import {
  EmployeeCashflow,
  EmployeeHome,
  EmployeePayroll,
  EmployeeShiftHistory,
} from './pages/employee/EmployeePages'
import {
  StoreEmployees,
  StoreImports,
  StoreOverview,
  StoreSchedule,
  StoreShifts,
} from './pages/store/StoreOperations'
import {
  StoreAttendance,
  StoreCashflow,
  StorePayroll,
  StoreReports,
  StoreSettings,
} from './pages/store/StoreFinance'
import { useApp } from './state/AppContext'

const homeByRole = {
  admin: '/admin/overview',
  store: '/store/overview',
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

      <Route element={<RoleGuard roles={['admin', 'store']}><AppShell /></RoleGuard>}>
        <Route path="/admin/overview" element={<AdminOverview />} />
        <Route path="/admin/stores" element={<AdminStores />} />
        <Route path="/admin/tasks" element={<AdminTasks />} />
        <Route path="/admin/cashflow" element={<AdminCashflow />} />
        <Route path="/admin/reports" element={<AdminReports />} />

        <Route path="/office" element={<OfficeManagement />} />
        <Route path="/admin/office" element={<Navigate to="/office" replace />} />
        <Route path="/store/office" element={<Navigate to="/office" replace />} />

        <Route path="/store/overview" element={<StoreOverview />} />
        <Route path="/store/shifts" element={<StoreShifts />} />
        <Route path="/store/schedule" element={<StoreSchedule />} />
        <Route path="/store/employees" element={<StoreEmployees />} />
        <Route path="/store/imports" element={<StoreImports />} />
        <Route path="/store/attendance" element={<StoreAttendance />} />
        <Route path="/store/payroll" element={<StorePayroll />} />
        <Route path="/store/cashflow" element={<StoreCashflow />} />
        <Route path="/store/reports" element={<StoreReports />} />
        <Route path="/store/settings" element={<StoreSettings />} />
      </Route>

      <Route element={<RoleGuard roles="admin"><AppShell /></RoleGuard>}>
        <Route path="/admin/managers" element={<ManagerAccounts />} />
        <Route path="/admin/manager-payroll" element={<ManagerPayroll />} />
        <Route path="/admin/settings" element={<AdminSettings />} />
      </Route>

      <Route element={<RoleGuard roles="employee"><AppShell /></RoleGuard>}>
        <Route path="/employee/home" element={<EmployeeHome />} />
        <Route path="/employee/shifts" element={<EmployeeShiftHistory />} />
        <Route path="/employee/payroll" element={<EmployeePayroll />} />
        <Route path="/employee/cashflow" element={<EmployeeCashflow />} />
      </Route>

      <Route path="*" element={<EntryRedirect />} />
    </Routes>
  )
}
