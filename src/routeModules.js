import { lazy } from 'react'
import { isOfficeProfile } from './domain/officeProfile'

const moduleLoads = new WeakMap()
const componentLoads = new WeakMap()

export const createLazyRouteComponent = (loadModule, exportName) => {
  const load = () => {
    if (!moduleLoads.has(loadModule)) {
      const pending = loadModule().catch((error) => {
        // A speculative failure must not poison the later foreground attempt.
        moduleLoads.delete(loadModule)
        throw error
      })
      moduleLoads.set(loadModule, pending)
    }
    return moduleLoads.get(loadModule)
  }
  const component = lazy(() => load().then((module) => ({ default: module[exportName] })))
  componentLoads.set(component, load)
  return component
}

export const AppShell = createLazyRouteComponent(() => import('./layout/AppShell'), 'default')
export const RoleSelectionPage = createLazyRouteComponent(() => import('./pages/RoleSelectionPage'), 'default')

const loadAdminPages = () => import('./pages/admin/AdminPages')
export const AdminSettings = createLazyRouteComponent(loadAdminPages, 'AdminSettings')
export const AdminStores = createLazyRouteComponent(loadAdminPages, 'AdminStores')

const loadRoleManagement = () => import('./pages/admin/RoleManagement')
export const BusinessSupportManagement = createLazyRouteComponent(loadRoleManagement, 'BusinessSupportManagement')
export const StoreManagerManagement = createLazyRouteComponent(loadRoleManagement, 'StoreManagerManagement')

export const CustomerSurveyPage = createLazyRouteComponent(() => import('./pages/admin/CustomerSurveyPage'), 'CustomerSurveyPage')
export const AttendanceResetPage = createLazyRouteComponent(() => import('./pages/admin/AttendanceResetPage'), 'AttendanceResetPage')
export const DataRestorePage = createLazyRouteComponent(() => import('./pages/admin/DataRestorePage'), 'DataRestorePage')
export const AdminWorkRegistrationSchedulePage = createLazyRouteComponent(() => import('./pages/admin/AdminWorkRegistrationSchedulePage'), 'AdminWorkRegistrationSchedulePage')
export const OrderInformationSettingsPage = createLazyRouteComponent(() => import('./pages/admin/OrderInformationSettingsPage'), 'OrderInformationSettingsPage')
export const WorkCatalogSettingsPage = createLazyRouteComponent(() => import('./pages/admin/WorkCatalogSettingsPage'), 'WorkCatalogSettingsPage')

const loadSupportWorkPages = () => import('./pages/admin/SupportWorkPages')
export const AdminSupportAssignmentPage = createLazyRouteComponent(loadSupportWorkPages, 'AdminSupportAssignmentPage')
export const AdminSupportWorkPage = createLazyRouteComponent(loadSupportWorkPages, 'AdminSupportWorkPage')
export const SupportAssignedWorkPage = createLazyRouteComponent(loadSupportWorkPages, 'SupportAssignedWorkPage')
export const SupportWorkInboxPage = createLazyRouteComponent(loadSupportWorkPages, 'SupportWorkInboxPage')

const loadBusinessSupportSchedule = () => import('./pages/admin/BusinessSupportSchedulePage')
export const BusinessSupportSchedulePage = createLazyRouteComponent(loadBusinessSupportSchedule, 'BusinessSupportSchedulePage')
export const MyBusinessSupportSchedulePage = createLazyRouteComponent(loadBusinessSupportSchedule, 'MyBusinessSupportSchedulePage')

const loadSystemFinance = () => import('./pages/admin/SystemFinanceV2')
export const AdminCashflowV2 = createLazyRouteComponent(loadSystemFinance, 'AdminCashflowV2')
export const AdminOverviewV2 = createLazyRouteComponent(loadSystemFinance, 'AdminOverviewV2')
export const AdminReportsV2 = createLazyRouteComponent(loadSystemFinance, 'AdminReportsV2')

const loadGovernancePages = () => import('./pages/admin/GovernancePages')
export const OrderAuditPage = createLazyRouteComponent(loadGovernancePages, 'OrderAuditPage')
export const PolicySettings = createLazyRouteComponent(loadGovernancePages, 'PolicySettings')
export const SupportTransfersPage = createLazyRouteComponent(loadGovernancePages, 'SupportTransfersPage')
export const SystemEmployees = createLazyRouteComponent(loadGovernancePages, 'SystemEmployees')

export const OfficeManagement = createLazyRouteComponent(() => import('./pages/office/OfficeManagement'), 'OfficeManagement')

const loadEmployeePages = () => import('./pages/employee/EmployeePages')
export const EmployeeCashflow = createLazyRouteComponent(loadEmployeePages, 'EmployeeCashflow')
export const EmployeeShiftHistory = createLazyRouteComponent(loadEmployeePages, 'EmployeeShiftHistory')

export const EmployeeSchedulePage = createLazyRouteComponent(() => import('./pages/employee/EmployeeSchedulePage'), 'EmployeeSchedulePage')

const loadEmployeeShiftOperations = () => import('./pages/employee/EmployeeShiftOperations')
export const EmployeeAssignedTasksPage = createLazyRouteComponent(loadEmployeeShiftOperations, 'EmployeeAssignedTasksPage')
export const EmployeeShiftExpensePage = createLazyRouteComponent(loadEmployeeShiftOperations, 'EmployeeShiftExpensePage')

const loadEmployeeV2Pages = () => import('./pages/employee/EmployeeV2Pages')
export const EmployeeAttendancePage = createLazyRouteComponent(loadEmployeeV2Pages, 'EmployeeAttendancePage')
export const EmployeeDashboardV2 = createLazyRouteComponent(loadEmployeeV2Pages, 'EmployeeDashboardV2')
export const EmployeeOrdersPage = createLazyRouteComponent(loadEmployeeV2Pages, 'EmployeeOrdersPage')
export const EmployeePayrollDetails = createLazyRouteComponent(loadEmployeeV2Pages, 'EmployeePayrollDetails')

const loadOfficeEmployeeDashboard = () => import('./pages/employee/OfficeEmployeeDashboard')
export const OfficeEmployeeDashboard = createLazyRouteComponent(loadOfficeEmployeeDashboard, 'OfficeEmployeeDashboard')
export const OfficeEmployeePayrollPage = createLazyRouteComponent(loadOfficeEmployeeDashboard, 'OfficeEmployeePayrollPage')

const loadStoreOperations = () => import('./pages/store/StoreOperations')
export const StoreEmployees = createLazyRouteComponent(loadStoreOperations, 'StoreEmployees')
export const StoreTasks = createLazyRouteComponent(loadStoreOperations, 'StoreTasks')

export const StoreSettings = createLazyRouteComponent(() => import('./pages/store/StoreFinance'), 'StoreSettings')
export const StoreExpensesV2 = createLazyRouteComponent(() => import('./pages/store/StoreExpensesV2'), 'StoreExpensesV2')
export const StoreSalarySettings = createLazyRouteComponent(() => import('./pages/store/StoreSalarySettings'), 'StoreSalarySettings')

const loadStoreV2Pages = () => import('./pages/store/StoreV2Pages')
export const StoreAttendanceV2 = createLazyRouteComponent(loadStoreV2Pages, 'StoreAttendanceV2')
export const StoreCashflowV2 = createLazyRouteComponent(loadStoreV2Pages, 'StoreCashflowV2')
export const StoreImportsV2 = createLazyRouteComponent(loadStoreV2Pages, 'StoreImportsV2')
export const StoreOverviewV2 = createLazyRouteComponent(loadStoreV2Pages, 'StoreOverviewV2')
export const StoreOrdersPage = createLazyRouteComponent(loadStoreV2Pages, 'StoreOrdersPage')
export const StorePayrollV2 = createLazyRouteComponent(loadStoreV2Pages, 'StorePayrollV2')
export const StoreReportsV2 = createLazyRouteComponent(loadStoreV2Pages, 'StoreReportsV2')
export const StoreStatisticsPage = createLazyRouteComponent(() => import('./pages/store/StoreStatisticsPage'), 'StoreStatisticsPage')

export const UnifiedSchedule = createLazyRouteComponent(() => import('./pages/store/UnifiedSchedule'), 'default')

const loadCompensationPages = () => import('./pages/compensation')
export const ManagerCompensationPage = createLazyRouteComponent(loadCompensationPages, 'ManagerCompensationPage')
export const MyCompensationPage = createLazyRouteComponent(loadCompensationPages, 'MyCompensationPage')
export const MyViolationsPage = createLazyRouteComponent(loadCompensationPages, 'MyViolationsPage')
export const RevenueBonusPage = createLazyRouteComponent(loadCompensationPages, 'RevenueBonusPage')
export const ViolationRefundPage = createLazyRouteComponent(loadCompensationPages, 'ViolationRefundPage')
export const ViolationManagementPage = createLazyRouteComponent(loadCompensationPages, 'ViolationManagementPage')

const routeComponents = {
  '/select-role': RoleSelectionPage,
  '/account/settings': AdminSettings,
  '/admin/overview': AdminOverviewV2,
  '/admin/stores': AdminStores,
  '/admin/cashflow': AdminCashflowV2,
  '/admin/reports': AdminReportsV2,
  '/admin/employees': SystemEmployees,
  '/admin/business-support': BusinessSupportManagement,
  '/admin/business-support-schedule': BusinessSupportSchedulePage,
  '/admin/store-managers': StoreManagerManagement,
  '/office': OfficeManagement,
  '/admin/settings': AdminSettings,
  '/admin/policies': PolicySettings,
  '/admin/order-audit': OrderAuditPage,
  '/admin/customer-survey': CustomerSurveyPage,
  '/admin/support-transfers': SupportTransfersPage,
  '/admin/order-information-settings': OrderInformationSettingsPage,
  '/admin/work-catalog': WorkCatalogSettingsPage,
  '/admin/compensation/managers': ManagerCompensationPage,
  '/admin/compensation/revenue': RevenueBonusPage,
  '/admin/tasks': AdminSupportWorkPage,
  '/admin/violations/store': ViolationManagementPage,
  '/admin/violations/office': ViolationManagementPage,
  '/store/schedule': UnifiedSchedule,
  '/store/employees': StoreEmployees,
  '/store/orders': StoreOrdersPage,
  '/store/statistics': StoreStatisticsPage,
  '/store/tasks': StoreTasks,
  '/store/imports': StoreImportsV2,
  '/store/expenses': StoreExpensesV2,
  '/store/attendance': StoreAttendanceV2,
  '/store/payroll': StorePayrollV2,
  '/store/salary-settings': StoreSalarySettings,
  '/store/revenue-bonus': RevenueBonusPage,
  '/store/violation-refunds': ViolationRefundPage,
  '/store/my-compensation': MyCompensationPage,
  '/store/my-violations': MyViolationsPage,
  '/store/cashflow': StoreCashflowV2,
  '/store/reports': StoreReportsV2,
  '/store/settings': StoreSettings,
  '/support/overview': OfficeEmployeeDashboard,
  '/support/tasks': SupportAssignedWorkPage,
  '/support/assigned-work': SupportWorkInboxPage,
  '/support/my-schedule': MyBusinessSupportSchedulePage,
  '/support/my-compensation': MyCompensationPage,
  '/support/my-violations': MyViolationsPage,
  '/admin/assignments': AdminSupportAssignmentPage,
  '/admin/reset': AttendanceResetPage,
  '/admin/data-restore': DataRestorePage,
  '/admin/work-registration-schedules': AdminWorkRegistrationSchedulePage,
  '/admin/violations/business-support': ViolationManagementPage,
  '/employee/assigned-work': SupportWorkInboxPage,
  '/employee/reward-tasks': SupportAssignedWorkPage,
  '/employee/shift-expenses': EmployeeShiftExpensePage,
  '/employee/orders': EmployeeOrdersPage,
  '/employee/work-history': EmployeeShiftHistory,
  '/employee/compensation': MyCompensationPage,
  '/employee/violations': MyViolationsPage,
  '/employee/revenue-bonus': RevenueBonusPage,
  '/employee/cashflow': EmployeeCashflow,
  '/store/overview': StoreOverviewV2,
}

const officeRouteComponents = {
  '/employee/home': OfficeEmployeeDashboard,
  '/employee/attendance': OfficeEmployeeDashboard,
  '/employee/payroll': OfficeEmployeePayrollPage,
  '/employee/schedule': MyBusinessSupportSchedulePage,
  '/employee/tasks': SupportAssignedWorkPage,
}
const employeeRouteComponents = {
  '/employee/home': EmployeeDashboardV2,
  '/employee/attendance': EmployeeAttendancePage,
  '/employee/payroll': EmployeePayrollDetails,
  '/employee/schedule': EmployeeSchedulePage,
  '/employee/tasks': EmployeeAssignedTasksPage,
}

export const preloadRouteComponent = (component) => {
  const load = componentLoads.get(component)
  // Preloading warms code only; the page still mounts behind its data/role guard.
  return load ? load().then(() => undefined).catch(() => undefined) : Promise.resolve()
}

export const preloadRouteModule = (pathname, { session, currentEmployee } = {}) => {
  const path = String(pathname || '').split(/[?#]/u, 1)[0]
  const profileComponents = isOfficeProfile(session, currentEmployee)
    ? officeRouteComponents : employeeRouteComponents
  return preloadRouteComponent(profileComponents[path] || routeComponents[path])
}
