import { describe, expect, it } from 'vitest'
import {
  buildLocalPayrollFinanceSnapshot,
  calculateLocalStoreEmployeeBasePay,
  localHomePayrollAttendance,
} from './AppContext'

describe('buildLocalPayrollFinanceSnapshot', () => {
  it('recognizes earned payroll once and excludes advance/payment settlement rows', () => {
    const snapshot = buildLocalPayrollFinanceSnapshot({
      storeId: 'CH001',
      period: '2026-08',
      netPayrollExpense: 23_500_000,
      state: {
        orders: [{
          id: 'ORDER-1',
          storeId: 'CH001',
          amount: 100_000_000,
          status: 'Hoàn tất',
          createdAt: '2026-08-20T03:00:00.000Z',
        }],
        expenseEntries: [
          { id: 'NON-PAYROLL', storeId: 'CH001', amount: 50_000_000, recognized: true, occurredAt: '2026-08-20T03:00:00.000Z' },
          { id: 'ADVANCE', storeId: 'CH001', amount: 5_000_000, recognized: true, sourceType: 'salary-advance', occurredAt: '2026-08-20T03:00:00.000Z' },
          { id: 'PAYMENT', storeId: 'CH001', amount: 18_500_000, recognized: true, sourceType: 'payroll-payment', occurredAt: '2026-08-20T03:00:00.000Z' },
          { id: 'OLD-ACCRUAL', storeId: 'CH001', amount: 23_500_000, recognized: true, sourceType: 'payroll-accrual', occurredAt: '2026-08-20T03:00:00.000Z' },
        ],
      },
    })

    expect(snapshot).toMatchObject({
      revenue: 100_000_000,
      recognizedExpense: 50_000_000,
      nonPayrollExpense: 50_000_000,
      netPayrollExpense: 23_500_000,
      expense: 73_500_000,
      profit: 26_500_000,
    })
  })
})

describe('calculateLocalStoreEmployeeBasePay', () => {
  const dosii = { id: 'CH-DOSII', name: 'Dosii KVC', status: 'Đang hoạt động' }
  const smTnv = { id: 'CH-SM', name: 'SM TNV', status: 'Đang hoạt động' }

  it('uses effective Full-Time store tiers and the correct store-family defaults', () => {
    const employee = { id: 'ST-01', unit: 'store', storeId: dosii.id, employmentType: 'Full-Time', baseSalary: 99_000_000 }
    const state = {
      storeEmployeeSalaryConfigs: [{
        id: 'CFG-01', employeeId: employee.id, storeId: dosii.id, effectiveFrom: '2026-08',
        thresholdHours: 208, standardHourlyRateVnd: 30_000, excessHourlyRateVnd: 27_000,
      }],
    }

    expect(calculateLocalStoreEmployeeBasePay({ state, employee, store: dosii, period: '2026-08', hours: 208 }).baseSalary).toBe(6_240_000)
    expect(calculateLocalStoreEmployeeBasePay({ state, employee, store: dosii, period: '2026-08', hours: 209 }).baseSalary).toBe(6_267_000)
    expect(calculateLocalStoreEmployeeBasePay({ state: {}, employee: { ...employee, storeId: smTnv.id }, store: smTnv, period: '2026-08', hours: 209 }).baseSalary).toBe(6_058_000)
  })

  it('keeps Trial hourly pay and Office Full-Time monthly pay unchanged', () => {
    expect(calculateLocalStoreEmployeeBasePay({
      state: {},
      employee: { id: 'TRIAL-01', unit: 'store', employmentType: 'Thử Việc', hourlyRate: 25_000 },
      store: dosii,
      period: '2026-08',
      hours: 8,
    }).baseSalary).toBe(200_000)
    expect(calculateLocalStoreEmployeeBasePay({
      state: {},
      employee: { id: 'OFFICE-01', unit: 'office', employmentType: 'Full-Time', monthlySalary: 12_000_000 },
      store: null,
      period: '2026-08',
      hours: 208,
    }).baseSalary).toBe(12_000_000)
  })
})

describe('localHomePayrollAttendance', () => {
  it('keeps home attendance and excludes support hours from tiered home payroll', () => {
    const employee = { id: 'ST-01', storeId: 'HOME-01' }
    const attendance = [{
      id: 'ATT-HOME', employeeId: 'ST-01', storeId: 'HOME-01', date: '2026-08-10', hours: 8,
    }, {
      id: 'ATT-SUPPORT', employeeId: 'ST-01', storeId: 'SUPPORT-01', date: '2026-08-11', hours: 5,
      supportTransferId: 'TRANSFER-01', supportCompensation: { transferId: 'TRANSFER-01', totalPay: 195_000 },
    }, {
      id: 'ATT-DELETED', employeeId: 'ST-01', storeId: 'HOME-01', date: '2026-08-12', hours: 4,
      deletedAt: '2026-08-13T00:00:00.000Z',
    }, {
      id: 'ATT-OTHER-MONTH', employeeId: 'ST-01', storeId: 'HOME-01', date: '2026-07-31', hours: 7,
    }]

    expect(localHomePayrollAttendance({ attendance, employee, period: '2026-08' }).map((record) => record.id))
      .toEqual(['ATT-HOME'])
  })
})
