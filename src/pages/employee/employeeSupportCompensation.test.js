import { describe, expect, it } from 'vitest'
import {
  employeePayrollSnapshotSummary,
  supportAttendanceCompensationRows,
  supportCompensationTotals,
  supportPayrollDetailRows,
  supportRowsUncoveredByPayrollSnapshot,
} from './employeeSupportCompensation'

const transfer = {
  id: 'TR-01',
  employeeId: 'E01',
  fromStoreId: 'S01',
  toStoreId: 'S02',
  startAt: '2026-08-20T01:00:00.000Z',
  endAt: '2026-08-20T08:00:00.000Z',
  hourlySupportRate: 29_000,
  allowance: 50_000,
}

describe('employee support compensation helpers', () => {
  it('calculates support pay and labels the destination store and configured time', () => {
    const rows = supportAttendanceCompensationRows({
      employeeId: 'E01',
      supportTransfers: [transfer],
      stores: [{ id: 'S02', name: 'Dosii KVC' }],
      attendance: [{
        id: 'ATT-01', employeeId: 'E01', storeId: 'S02', supportTransferId: 'TR-01',
        date: '2026-08-20', checkInAt: '2026-08-20T01:00:00.000Z', hours: 3,
      }],
    })

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      isSupport: true,
      destinationStoreName: 'Dosii KVC',
      hours: 3,
      hourlyRate: 29_000,
      hourlyPay: 87_000,
      allowance: 50_000,
      actualPay: 137_000,
      timeLabel: '20/08/2026 08:00 – 20/08/2026 15:00',
    })
  })

  it('attributes a transfer allowance once across multiple attendance rows', () => {
    const rows = supportAttendanceCompensationRows({
      employeeId: 'E01',
      supportTransfers: [transfer],
      attendance: [
        {
          id: 'ATT-02', employeeId: 'E01', storeId: 'S02', supportTransferId: 'TR-01',
          checkInAt: '2026-08-20T05:00:00.000Z', hours: 2,
        },
        {
          id: 'ATT-01', employeeId: 'E01', storeId: 'S02', supportTransferId: 'TR-01',
          checkInAt: '2026-08-20T01:00:00.000Z', hours: 3,
        },
      ],
    })

    expect(rows.find(({ record }) => record.id === 'ATT-01')).toMatchObject({ allowance: 50_000, actualPay: 137_000 })
    expect(rows.find(({ record }) => record.id === 'ATT-02')).toMatchObject({ allowance: 0, actualPay: 58_000 })
    expect(supportCompensationTotals(rows)).toEqual({
      hours: 5,
      hourlyPay: 145_000,
      allowance: 50_000,
      actualPay: 195_000,
    })
  })

  it('trusts canonical per-attendance attribution and total instead of adding allowance again', () => {
    const rows = supportAttendanceCompensationRows({
      employeeId: 'E01',
      supportTransfers: [transfer],
      attendance: [{
        id: 'ATT-CANONICAL', employeeId: 'E01', storeId: 'S02', supportTransferId: 'TR-01', hours: 3,
        supportCompensation: {
          hours: 3,
          hourlyRate: 29_000,
          hourlyPay: 87_000,
          allowance: 0,
          allowanceApplied: false,
          totalPay: 87_000,
        },
      }],
    })

    expect(rows[0]).toMatchObject({ hourlyPay: 87_000, allowance: 0, actualPay: 87_000 })
  })

  it('keeps the canonical destination name after the support store leaves the employee projection', () => {
    const rows = supportAttendanceCompensationRows({
      employeeId: 'E01',
      stores: [{ id: 'S01', name: 'Dosii TNV' }],
      attendance: [{
        id: 'ATT-HISTORICAL', employeeId: 'E01', storeId: 'S02', supportTransferId: 'TR-HISTORICAL',
        supportCompensation: {
          transferId: 'TR-HISTORICAL', supportStoreId: 'S02', supportStoreName: 'Dosii KVC',
          hours: 3, hourlyRate: 29_000, basePay: 87_000, allowance: 50_000,
          allowanceApplied: true, totalPay: 137_000,
        },
      }],
    })

    expect(rows[0]).toMatchObject({ destinationStoreId: 'S02', destinationStoreName: 'Dosii KVC' })
  })

  it('sums all home and support snapshots for the employee and preserves locked totals', () => {
    const summary = employeePayrollSnapshotSummary({
      employeeId: 'E01',
      period: '2026-08',
      payrollPeriods: [
        {
          id: 'PAY-HOME', storeId: 'S01', period: '2026-08', status: 'Đã khóa',
          lockedAt: '2026-09-01T01:00:00.000Z',
          rows: [{ employeeId: 'E01', baseSalary: 4_000_000, kpiBonus: 200_000, gross: 4_200_000, advancesPaid: 500_000, remaining: 3_700_000 }],
        },
        {
          id: 'PAY-SUPPORT', storeId: 'S02', period: '2026-08', status: 'Đã khóa',
          lockedAt: '2026-09-01T01:05:00.000Z',
          rows: [{
            employeeId: 'E01', baseSalary: 87_000, supportHourlyPay: 87_000,
            supportAllowance: 50_000, gross: 137_000, remaining: 137_000,
            supportCompensation: { hours: 3, basePay: 87_000, allowance: 50_000, totalPay: 137_000 },
            supportDetails: [{
              transferId: 'TR-01', supportStoreId: 'S02', startAt: transfer.startAt, endAt: transfer.endAt,
              hours: 3, hourlyRate: 29_000, basePay: 87_000, allowance: 50_000, totalPay: 137_000,
              attendanceIds: ['ATT-01'],
            }],
          }],
        },
      ],
    })

    expect(summary).toMatchObject({
      homeBaseSalary: 4_000_000,
      supportHourlyPay: 87_000,
      supportAllowance: 50_000,
      supportPay: 137_000,
      supportHours: 3,
      gross: 4_137_000,
      advancesPaid: 500_000,
      remaining: 3_637_000,
      locked: true,
    })
    expect(summary.homeSnapshot.rows[0]).not.toHaveProperty('kpiBonus')
    expect(supportPayrollDetailRows({
      snapshotDetails: summary.supportDetails,
      stores: [{ id: 'S02', name: 'Dosii KVC' }],
    })).toEqual([expect.objectContaining({
      destinationStoreName: 'Dosii KVC',
      timeLabel: '20/08/2026 08:00 – 20/08/2026 15:00',
      shiftLabel: '1 ca đã chốt',
      hours: 3,
      actualPay: 137_000,
      lockedSnapshot: true,
    })])
  })

  it('keeps live support rows outside a partial payroll snapshot and deduplicates covered transfers', () => {
    const liveRows = supportAttendanceCompensationRows({
      employeeId: 'E01',
      supportTransfers: [transfer, { ...transfer, id: 'TR-02', toStoreId: 'S03' }],
      attendance: [{
        id: 'ATT-01', employeeId: 'E01', storeId: 'S02', supportTransferId: 'TR-01', hours: 3,
      }, {
        id: 'ATT-02', employeeId: 'E01', storeId: 'S03', supportTransferId: 'TR-02', hours: 2,
      }],
    }).filter((row) => row.isSupport)
    const homeOnly = employeePayrollSnapshotSummary({
      employeeId: 'E01', period: '2026-08',
      payrollPeriods: [{
        storeId: 'S01', period: '2026-08', status: 'Đã khóa',
        rows: [{ employeeId: 'E01', baseSalary: 4_000_000, gross: 4_000_000, remaining: 4_000_000 }],
      }],
    })
    expect(supportRowsUncoveredByPayrollSnapshot(liveRows, homeOnly)).toHaveLength(2)

    const destinationOnly = employeePayrollSnapshotSummary({
      employeeId: 'E01', period: '2026-08',
      payrollPeriods: [{
        storeId: 'S02', period: '2026-08', status: 'Đã khóa',
        rows: [{
          employeeId: 'E01', baseSalary: 87_000, gross: 137_000, remaining: 137_000,
          supportCompensation: { hours: 3, basePay: 87_000, allowance: 50_000, totalPay: 137_000, transferIds: ['TR-01'] },
          supportDetails: [{ transferId: 'TR-01', supportStoreId: 'S02', attendanceIds: ['ATT-01'] }],
        }],
      }],
    })
    expect(supportRowsUncoveredByPayrollSnapshot(liveRows, destinationOnly).map((row) => row.transferId)).toEqual(['TR-02'])
  })
})
