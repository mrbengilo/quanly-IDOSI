import { shifts } from '../data.js'
import {
  DEFAULT_WORK_CATALOG_ITEMS,
  STAFF_WORK_CATALOG_SEED_VERSION,
} from '../domain/compensationPolicies'
import { DEFAULT_ORDER_INFORMATION_OPTIONS } from '../domain/orderInformationSettings'
import { SUPPORT_SCHEDULE_PRESETS, normalizeSupportSchedulePresets } from '../domain/supportWorkSchedule'

export const DOMAIN_SCHEMA_VERSION = 8

const pad = (value, length = 5) => String(value).padStart(length, '0')

const openingOrder = (store, index) => ({
  id: `ORD-OPEN-${pad(index + 1)}`,
  code: `${store.short || store.id}-${pad(index + 1)}`,
  storeId: store.id,
  customerName: 'Số dư doanh thu chuyển tiếp',
  customerPhone: '',
  customerAge: null,
  amount: Math.max(0, Number(store.revenue) || 0),
  paymentMethod: 'Chuyển khoản',
  employeeId: null,
  employeeName: 'Dữ liệu hệ thống',
  shiftId: null,
  shiftName: 'Dữ liệu chuyển tiếp',
  shiftStart: null,
  shiftEnd: null,
  status: 'Hoàn tất',
  source: 'legacy-opening-balance',
  createdAt: '2026-08-01T00:00:00+07:00',
  updatedAt: '2026-08-01T00:00:00+07:00',
  deletedAt: null,
})

const openingExpense = (store, index) => ({
  id: `EXP-OPEN-${pad(index + 1)}`,
  storeId: store.id,
  type: 'Chi phí chuyển tiếp',
  category: 'legacy',
  amount: Math.max(0, Number(store.expense) || 0),
  description: 'Số dư chi phí trước khi nâng cấp nguồn dữ liệu thống nhất',
  sourceType: 'legacy-opening-balance',
  sourceId: `OPEN-${store.id}`,
  recognized: true,
  occurredAt: '2026-08-01T00:00:00+07:00',
  createdAt: '2026-08-01T00:00:00+07:00',
  createdBy: 'SYSTEM',
})

export const defaultPolicies = {
  lateToleranceMinutes: 10,
  earlyCheckInLimitMinutes: 120,
  attendanceEvaluation: {
    maintainMaxLateCount: 2,
    improveMinLateCount: 3,
    improveMinLateMinutes: 30,
  },
  effectiveFrom: '2026-08-01',
  version: 1,
}

export const createDomainState = ({ stores = [], imports = [] } = {}) => ({
  schemaVersion: DOMAIN_SCHEMA_VERSION,
  stateVersion: 1,
  orders: stores.map(openingOrder),
  orderInformationOptions: DEFAULT_ORDER_INFORMATION_OPTIONS.map((option) => ({ ...option })),
  orderCounters: Object.fromEntries(stores.map((store) => [store.id, 1])),
  orderAudit: [],
  notifications: [],
  expenseEntries: stores.map(openingExpense),
  fixedExpenses: [],
  cashTransactions: [],
  policies: defaultPolicies,
  policyHistory: [],
  salaryAdjustments: [],
  salaryAdvances: [],
  payrollPeriods: [],
  payrollPayments: [],
  storeEmployeeSalaryConfigs: [],
  workCatalogItems: DEFAULT_WORK_CATALOG_ITEMS.map((item) => ({ ...item })),
  staffWorkCatalogSeedVersion: STAFF_WORK_CATALOG_SEED_VERSION,
  workCatalogProgress: [],
  storeShiftTaskTemplates: [],
  compensationEntries: [],
  violations: [],
  violationRefunds: [],
  revenueBonusDaily: [],
  revenueBonusAllocations: [],
  revenueBonusOverrides: [],
  teamRewardClaims: [],
  teamRewardParticipants: [],
  periodReconciliations: [],
  jobRuns: [],
  shiftDefinitions: shifts.map((shift) => ({
    ...shift,
    date: null,
    effectiveFrom: '2026-08-01',
    active: true,
    version: 1,
  })),
  importVouchers: imports.map((item, index) => ({
    id: `PV-${pad(index + 1)}`,
    code: `PN-${String(item.createdAt || '01082026').slice(8, 10)}${String(item.createdAt || '01082026').slice(5, 7)}${String(item.createdAt || '01082026').slice(0, 4)}-${pad(index + 1)}`,
    storeId: item.storeId,
    items: [{ ...item }],
    goodsAmount: Math.round((Number(item.weight) || 0) * (Number(item.price) || 0)),
    shippingAmount: Math.round(Number(item.shipping) || 0),
    relatedAmount: 0,
    status: 'Đã lưu',
    createdAt: String(item.createdAt || '2026-08-01T00:00:00+07:00'),
    createdBy: item.creator || 'Dữ liệu hệ thống',
  })),
  importCounter: imports.length,
  auditLogs: [],
  deletedStores: [],
  deletedEmployees: [],
  supportSchedulePresets: SUPPORT_SCHEDULE_PRESETS.map((preset) => ({ ...preset })),
  supportSchedulePresetHistory: [],
  supportTransfers: [],
  idempotencyKeys: [],
})

const mergeArray = (stored, defaults, key) => Array.isArray(stored?.[key]) ? stored[key] : defaults[key]

const migratedStaffWorkCatalog = (stored, defaults) => {
  const current = mergeArray(stored, defaults, 'workCatalogItems')
  if (Number(stored?.staffWorkCatalogSeedVersion || 0) >= STAFF_WORK_CATALOG_SEED_VERSION) return current
  const existingCodes = new Set(current.map((item) => String(item?.code || '')).filter(Boolean))
  return [
    ...current,
    ...DEFAULT_WORK_CATALOG_ITEMS
      .filter((item) => !existingCodes.has(item.code))
      .map((item) => ({ ...item })),
  ]
}

export const migrateDomainState = (stored, context) => {
  const defaults = createDomainState(context)
  if (!stored || typeof stored !== 'object') return defaults
  const storedPolicies = Object.fromEntries(Object.entries(stored.policies || {}).filter(([key]) => ![
    'employeeKpiRates',
    'managerKpiRate',
    'managerMonthlySalary',
  ].includes(key)))

  return {
    ...defaults,
    ...stored,
    schemaVersion: DOMAIN_SCHEMA_VERSION,
    staffWorkCatalogSeedVersion: STAFF_WORK_CATALOG_SEED_VERSION,
    stateVersion: Math.max(1, Number(stored.stateVersion) || 1),
    orders: mergeArray(stored, defaults, 'orders'),
    orderInformationOptions: mergeArray(stored, defaults, 'orderInformationOptions'),
    orderAudit: mergeArray(stored, defaults, 'orderAudit'),
    notifications: mergeArray(stored, defaults, 'notifications'),
    expenseEntries: mergeArray(stored, defaults, 'expenseEntries'),
    fixedExpenses: mergeArray(stored, defaults, 'fixedExpenses'),
    cashTransactions: mergeArray(stored, defaults, 'cashTransactions'),
    policyHistory: mergeArray(stored, defaults, 'policyHistory'),
    salaryAdjustments: mergeArray(stored, defaults, 'salaryAdjustments'),
    salaryAdvances: mergeArray(stored, defaults, 'salaryAdvances'),
    payrollPeriods: mergeArray(stored, defaults, 'payrollPeriods'),
    payrollPayments: mergeArray(stored, defaults, 'payrollPayments'),
    storeEmployeeSalaryConfigs: mergeArray(stored, defaults, 'storeEmployeeSalaryConfigs'),
    workCatalogItems: migratedStaffWorkCatalog(stored, defaults),
    workCatalogProgress: mergeArray(stored, defaults, 'workCatalogProgress'),
    storeShiftTaskTemplates: mergeArray(stored, defaults, 'storeShiftTaskTemplates'),
    compensationEntries: mergeArray(stored, defaults, 'compensationEntries'),
    violations: mergeArray(stored, defaults, 'violations'),
    violationRefunds: mergeArray(stored, defaults, 'violationRefunds'),
    revenueBonusDaily: mergeArray(stored, defaults, 'revenueBonusDaily'),
    revenueBonusAllocations: mergeArray(stored, defaults, 'revenueBonusAllocations'),
    revenueBonusOverrides: mergeArray(stored, defaults, 'revenueBonusOverrides'),
    teamRewardClaims: mergeArray(stored, defaults, 'teamRewardClaims'),
    teamRewardParticipants: mergeArray(stored, defaults, 'teamRewardParticipants'),
    periodReconciliations: mergeArray(stored, defaults, 'periodReconciliations'),
    jobRuns: mergeArray(stored, defaults, 'jobRuns'),
    shiftDefinitions: mergeArray(stored, defaults, 'shiftDefinitions'),
    importVouchers: mergeArray(stored, defaults, 'importVouchers'),
    auditLogs: mergeArray(stored, defaults, 'auditLogs'),
    deletedStores: mergeArray(stored, defaults, 'deletedStores'),
    deletedEmployees: mergeArray(stored, defaults, 'deletedEmployees'),
    supportSchedulePresets: normalizeSupportSchedulePresets(mergeArray(stored, defaults, 'supportSchedulePresets')),
    supportSchedulePresetHistory: mergeArray(stored, defaults, 'supportSchedulePresetHistory'),
    supportTransfers: mergeArray(stored, defaults, 'supportTransfers'),
    idempotencyKeys: mergeArray(stored, defaults, 'idempotencyKeys'),
    policies: {
      ...defaultPolicies,
      ...storedPolicies,
      attendanceEvaluation: {
        ...defaultPolicies.attendanceEvaluation,
        ...(stored.policies?.attendanceEvaluation || {}),
      },
    },
  }
}
