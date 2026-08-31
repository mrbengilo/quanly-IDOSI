import { describe, expect, it } from 'vitest'
import {
  employeesForTarget,
  managerCandidates,
  operationalStores,
  payrollCompensationTotalsForEmployee,
  revenueAllocations,
  statusLabel,
  statusTone,
  storesVisibleToRole,
  targetUnitOfViolation,
} from './compensationViewModel'

const stores = [
  { id: 'CH001', name: 'Dosii NTL' },
  { id: 'CH002', name: 'SM TNV' },
  { id: 'OFFICE', name: 'Khối văn phòng' },
  { id: 'BUSINESS_SUPPORT', name: 'HTKD' },
  { id: 'CH003', name: 'Đã đóng', status: 'Đã đóng' },
  { id: 'CH004', name: 'Tạm ngưng', status: 'Tạm ngưng' },
  { id: 'CH005', name: 'Inactive flag', active: false },
]

describe('compensation view models', () => {
  it('gives business support every operational store without assigned-store filtering', () => {
    expect(operationalStores(stores).map((store) => store.id)).toEqual(['CH001', 'CH002'])
    expect(storesVisibleToRole(stores, { role: 'business_support', assignedStoreIds: ['CH001'] }).map((store) => store.id))
      .toEqual(['CH001', 'CH002'])
    expect(storesVisibleToRole(stores, { role: 'store_manager', storeId: 'CH002' }).map((store) => store.id))
      .toEqual(['CH002'])
  })

  it('uses exact store casing for store roles and fails closed for an ambiguous alias', () => {
    const collidingStores = [{ id: 'CH001' }, { id: 'ch001' }]

    expect(storesVisibleToRole(collidingStores, { role: 'store_manager', storeId: 'CH001' }).map((item) => item.id))
      .toEqual(['CH001'])
    expect(storesVisibleToRole(collidingStores, { role: 'store_manager', storeId: 'Ch001' }))
      .toEqual([])
  })

  it('resolves managers and employee units from linked production profiles', () => {
    const employees = [
      { id: 'NV-01', name: 'Nhân viên', unit: 'store', storeId: 'CH001' },
      { id: 'QL-01', name: 'Quản lý', unit: 'store', storeId: 'CH001', isStoreManager: true },
      { id: 'VP-01', name: 'Văn phòng', unit: 'office' },
      { id: 'HT-01', name: 'Hỗ trợ', unit: 'business_support' },
    ]
    expect(managerCandidates({ employees, storeId: 'CH001' }).map((employee) => employee.id)).toEqual(['QL-01'])
    expect(employeesForTarget({ employees, targetUnit: 'office' }).map((employee) => employee.id)).toEqual(['VP-01'])
    expect(employeesForTarget({ employees, targetUnit: 'store', storeId: 'CH001' }).map((employee) => employee.id)).toEqual(['NV-01', 'QL-01'])
  })

  it('keeps employee and manager scopes isolated when store or employee ids collide by case', () => {
    const employees = [
      { id: 'E01', unit: 'store', storeId: 'STORE-01' },
      { id: 'e01', unit: 'store', storeId: 'store-01' },
    ]
    const managerAccounts = [{ employeeId: 'E01', storeId: 'STORE-01' }, { employeeId: 'e01', storeId: 'store-01' }]

    expect(employeesForTarget({ employees, targetUnit: 'store', storeId: 'STORE-01' }).map((item) => item.id)).toEqual(['E01'])
    expect(employeesForTarget({ employees, targetUnit: 'store', storeId: 'Store-01' })).toEqual([])
    expect(managerCandidates({ employees, managerAccounts, storeId: 'STORE-01' }).map((item) => item.id)).toEqual(['E01'])
    expect(managerCandidates({ employees, managerAccounts, storeId: 'Store-01' })).toEqual([])
  })

  it('normalizes nested revenue allocations without leaking unrelated records', () => {
    const rows = revenueAllocations([{ id: 'RB-1', storeId: 'CH001', businessDate: '2026-08-26', allocations: [{ id: 'A-1', employeeId: 'NV-01', allocatedVnd: 35 }] }])
    expect(rows).toEqual([{ id: 'A-1', employeeId: 'NV-01', allocatedVnd: 35, storeId: 'CH001', businessDate: '2026-08-26', calculationId: 'RB-1' }])
    expect(targetUnitOfViolation({ unit: 'htkd' })).toBe('business_support')
  })

  it('renders pending and rejected milestone decisions in Vietnamese with distinct tones', () => {
    expect(statusLabel({ status: 'PENDING' })).toBe('Chờ duyệt')
    expect(statusTone({ status: 'PENDING' })).toBe('orange')
    expect(statusLabel({ status: 'REJECTED' })).toBe('Đã từ chối')
    expect(statusTone({ status: 'REJECTED' })).toBe('red')
  })

  it('groups only active canonical payroll records without dropping revenue allocations', () => {
    expect(payrollCompensationTotalsForEmployee({
      employeeId: 'NV-01',
      period: '2026-08',
      compensationEntries: [
        { employeeId: 'NV-01', effectiveDate: '2026-08-01', type: 'MANUAL', amountVnd: 10, status: 'APPROVED' },
        { employeeId: 'nv-01', effectiveDate: '2026-08-02', type: 'WORK', amountVnd: 20, status: 'Đã duyệt' },
        { employeeId: 'NV-01', effectiveDate: '2026-08-03', type: 'ALLOWANCE', amountVnd: 30, status: 'ACTIVE' },
        { employeeId: 'NV-01', effectiveDate: '2026-08-04', type: 'REVENUE', amountVnd: 40, approvedAt: '2026-08-04T08:00:00Z' },
        { employeeId: 'NV-01', effectiveDate: '2026-08-05', type: 'MANUAL', amountVnd: 999, status: 'PENDING' },
        { employeeId: 'NV-02', effectiveDate: '2026-08-06', type: 'MANUAL', amountVnd: 999, status: 'APPROVED' },
      ],
      revenueBonusAllocations: [
        { employeeId: 'nv-01', businessDate: '2026-08-07', amountVnd: 50, status: 'APPROVED' },
        { employeeId: 'NV-01', businessDate: '2026-08-08', amountVnd: 999, status: 'VOIDED', voidedAt: '2026-08-09T00:00:00Z' },
      ],
      violations: [
        { employeeId: 'nv-01', effectiveDate: '2026-08-10', amountVnd: 60, status: 'Đang áp dụng' },
        { employeeId: 'NV-01', effectiveDate: '2026-07-10', amountVnd: 999, status: 'ACTIVE' },
      ],
    })).toEqual({ manual: 10, work: 20, allowance: 30, revenue: 90, violations: 60 })
  })

  it('excludes superseded compensation and allocation records even when approvedAt is present', () => {
    expect(payrollCompensationTotalsForEmployee({
      employeeId: 'NV-01',
      period: '2026-08',
      compensationEntries: [{
        employeeId: 'NV-01',
        effectiveDate: '2026-08-01',
        type: 'MANUAL',
        amountVnd: 999,
        approvedAt: '2026-08-01T08:00:00Z',
        supersededAt: '2026-08-02T08:00:00Z',
      }, {
        employeeId: 'NV-01',
        effectiveDate: '2026-08-01',
        type: 'MANUAL',
        amountVnd: 10,
        approvedAt: '2026-08-01T08:00:00Z',
      }],
      revenueBonusAllocations: [{
        employeeId: 'NV-01',
        businessDate: '2026-08-03',
        amountVnd: 999,
        approvedAt: '2026-08-03T08:00:00Z',
        supersededAt: '2026-08-04T08:00:00Z',
      }, {
        employeeId: 'NV-01',
        businessDate: '2026-08-03',
        amountVnd: 20,
        approvedAt: '2026-08-03T08:00:00Z',
      }],
    })).toEqual({ manual: 10, work: 0, allowance: 0, revenue: 20, violations: 0 })
  })
})
