const SYSTEM_SCREEN_BY_PATH = Object.freeze({
  '/account/settings': 'account-settings',
  '/admin/stores': 'stores',
  '/admin/cashflow': 'cashflow',
  '/admin/reports': 'reports',
  '/admin/employees': 'employees',
  '/admin/business-support': 'business-support',
  '/admin/business-support-schedule': 'business-support-schedule',
  '/admin/store-managers': 'store-managers',
  '/office': 'office',
  '/admin/settings': 'settings',
  '/admin/policies': 'policies',
  '/admin/order-audit': 'order-audit',
  '/admin/customer-survey': 'customer-survey',
  '/admin/support-transfers': 'support-transfers',
  '/admin/order-information-settings': 'order-information-settings',
  '/admin/work-catalog': 'work-catalog',
  '/admin/compensation/managers': 'compensation-managers',
  '/admin/compensation/revenue': 'compensation-revenue',
  '/admin/tasks': 'tasks',
  '/admin/violations/store': 'violations-store',
  '/admin/violations/office': 'violations-office',
  '/admin/assignments': 'assignments',
  '/admin/reset': 'reset',
  '/admin/work-registration-schedules': 'work-registration-schedules',
  '/admin/violations/business-support': 'violations-business-support',
  '/support/overview': 'support-overview',
  '/support/tasks': 'support-tasks',
  '/support/assigned-work': 'support-tasks',
  '/support/my-schedule': 'support-schedule',
  '/support/my-compensation': 'support-compensation',
  '/support/my-violations': 'support-violations',
  '/employee/home': 'employee-home',
  '/employee/tasks': 'employee-tasks',
  '/employee/assigned-work': 'employee-assigned-work',
  '/employee/reward-tasks': 'employee-reward-tasks',
  '/employee/shift-expenses': 'employee-shift-expenses',
  '/employee/orders': 'employee-orders',
  '/employee/attendance': 'employee-attendance',
  '/employee/work-history': 'employee-work-history',
  '/employee/schedule': 'employee-schedule',
  '/employee/payroll': 'employee-payroll',
  '/employee/compensation': 'employee-compensation',
  '/employee/violations': 'employee-violations',
  '/employee/revenue-bonus': 'employee-revenue-bonus',
  '/employee/cashflow': 'employee-cashflow',
})

export const storeScreenForPath = (pathname) => {
  const screen = String(pathname || '').match(/^\/store\/([^/]+)/u)?.[1] || 'overview'
  return screen === 'shifts' ? 'schedule' : screen
}

export const systemScreenForPath = (pathname) => SYSTEM_SCREEN_BY_PATH[String(pathname || '')] || ''

export const employeeScreen = (screen) => String(screen || '').startsWith('employee-')

