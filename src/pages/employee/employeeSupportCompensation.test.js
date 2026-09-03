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

  it('recognizes the legacy nested compensation.support transfer shape', () => {
    const rows = supportAttendanceCompensationRows({
      employeeId: 'E01',
      supportTransfers: [transfer],
      attendance: [{
        id: 'ATT-NESTED', employeeId: 'E01', storeId: 'S02', hours: 3,
        compensation: {
          support: {
            transferId: 'TR-01', hours: 3, hourlyRate: 29_000,
            basePay: 87_000, allowance: 50_000, totalPay: 137_000,
          },
        },
      }],
    })

    expect(rows[0]).toMatchObject({
      transferId: 'TR-01', isSupport: true, hourlyPay: 87_000, allowance: 50_000, actualPay: 137_000,
    })
  })

  it('uses exact transfer spelling and fails closed for an ambiguous folded transfer reference', () => {
    const supportTransfers = [
      { ...transfer, id: 'TR-X', hourlySupportRate: 10_000, allowance: 5_000 },
      { ...transfer, id: 'tr-x', hourlySupportRate: 99_000, allowance: 90_000 },
    ]
    const rows = supportAttendanceCompensationRows({
      employeeId: 'E01',
      supportTransfers,
      attendance: [{
        id: 'ATT-EXACT', employeeId: 'E01', supportTransferId: 'TR-X', hours: 2,
      }, {
        id: 'ATT-AMBIGUOUS', employeeId: 'E01', supportTransferId: 'Tr-X', hours: 2,
      }],
    })

    expect(rows.find(({ record }) => record.id === 'ATT-EXACT')).toMatchObject({
      identifierCollision: false, hourlyRate: 10_000, hourlyPay: 20_000, allowance: 5_000, actualPay: 25_000,
    })
    expect(rows.find(({ record }) => record.id === 'ATT-AMBIGUOUS')).toMatchObject({
      identifierCollision: true, hourlyRate: 0, hourlyPay: 0, allowance: 0, actualPay: 0,
    })
  })

  it('does not mix support attendance from an employee id case collision', () => {
    const employee = { id: 'E01' }
    const rows = supportAttendanceCompensationRows({
      employeeId: 'E01',
      employee,
      employees: [employee, { id: 'e01' }],
      supportTransfers: [transfer],
      attendance: [{
        id: 'ATT-UPPER', employeeId: 'E01', supportTransferId: 'TR-01', hours: 2,
      }, {
        id: 'ATT-LOWER', employeeId: 'e01', supportTransferId: 'TR-01', hours: 9,
      }],
    })

    expect(rows.map(({ record }) => record.id)).toEqual(['ATT-UPPER'])
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
      transferId: 'TR-01',
      destinationStoreId: 'S02',
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

  it('does not cover an exact lowercase attendance collision with an uppercase payroll snapshot', () => {
    const liveRows = [{
      attendanceId: 'ATT-X', transferId: 'TR-UPPER', actualPay: 100_000,
    }, {
      attendanceId: 'att-x', transferId: 'TR-LOWER', actualPay: 200_000,
    }]
    const snapshotSummary = {
      supportDetails: [{ transferId: 'TR-UPPER', attendanceIds: ['ATT-X'] }],
    }

    expect(supportRowsUncoveredByPayrollSnapshot(liveRows, snapshotSummary)).toEqual([
      expect.objectContaining({ attendanceId: 'att-x', transferId: 'TR-LOWER' }),
    ])
  })

  it('deduplicates a unique live attendance when the locked snapshot uses different casing', () => {
    const liveRows = [{
      attendanceId: 'att-unique', actualPay: 100_000,
      record: { id: 'att-unique', employeeId: 'E01', storeId: 'S02' },
    }]
    const snapshotSummary = {
      supportDetails: [{ attendanceIds: ['ATT-UNIQUE'] }],
    }

    expect(supportRowsUncoveredByPayrollSnapshot(liveRows, snapshotSummary)).toEqual([])
  })

  it('does not let transfer or store snapshot coverage cross an exact case collision', () => {
    const liveRows = [{
      attendanceId: 'ATT-UPPER', transferId: 'TR-X', destinationStoreId: 'S-X', actualPay: 100_000,
    }, {
      attendanceId: 'ATT-LOWER', transferId: 'tr-x', destinationStoreId: 's-x', actualPay: 200_000,
    }]

    expect(supportRowsUncoveredByPayrollSnapshot(liveRows, {
      supportSnapshot: true,
      coveredSupportTransferIds: ['TR-X'],
    })).toEqual([expect.objectContaining({ attendanceId: 'ATT-LOWER' })])
    expect(supportRowsUncoveredByPayrollSnapshot(liveRows, {
      supportSnapshot: true,
      legacyCoveredSupportStoreIds: ['S-X'],
    })).toEqual([expect.objectContaining({ attendanceId: 'ATT-LOWER' })])
  })

  it('accepts attendance or legacy-store coverage even when a live transfer id is present', () => {
    const attendanceCovered = [{
      transferId: 'TR-LIVE-NOT-IN-SNAPSHOT', destinationStoreId: 'S02',
      record: { id: 'ATT-COVERED', storeId: 'S02', supportTransferId: 'TR-LIVE-NOT-IN-SNAPSHOT' },
    }]
    expect(supportRowsUncoveredByPayrollSnapshot(attendanceCovered, {
      supportSnapshot: true,
      coveredSupportAttendanceIds: ['ATT-COVERED'],
    })).toEqual([])

    const storeCovered = [{
      transferId: 'TR-LEGACY-LIVE', destinationStoreId: 's02',
      record: { id: 'ATT-LEGACY-STORE', storeId: 's02', supportTransferId: 'TR-LEGACY-LIVE' },
    }]
    expect(supportRowsUncoveredByPayrollSnapshot(storeCovered, {
      supportSnapshot: true,
      legacyCoveredSupportStoreIds: ['S02'],
    })).toEqual([])
  })

  it('uses the exact payroll store id before a case-insensitive alias', () => {
    const summary = employeePayrollSnapshotSummary({
      employeeId: 'E01',
      stores: [{ id: 'S01' }],
      period: '2026-08',
      payrollPeriods: [{
        id: 'PAY-UPPER', storeId: 'S01', period: '2026-08', status: 'Đã khóa',
        rows: [{ employeeId: 'E01', baseSalary: 1_000_000, gross: 1_000_000 }],
      }, {
        id: 'PAY-LOWER', storeId: 's01', period: '2026-08', status: 'Đã khóa',
        rows: [{ employeeId: 'E01', baseSalary: 9_000_000, gross: 9_000_000 }],
      }],
    })

    expect(summary.identifierCollision).not.toBe(true)
    expect(summary.periods.map(({ id }) => id)).toEqual(['PAY-UPPER'])
    expect(summary).toMatchObject({ gross: 1_000_000 })
  })

  it('fails closed when the employee home-store alias is ambiguous without an exact match', () => {
    const summary = employeePayrollSnapshotSummary({
      employeeId: 'E01',
      employee: { id: 'E01', storeId: 'Store-01' },
      employees: [{ id: 'E01', storeId: 'Store-01' }],
      stores: [{ id: 'STORE-01' }, { id: 'store-01' }],
      period: '2026-08',
      payrollPeriods: [{
        id: 'PAY-UPPER', storeId: 'STORE-01', period: '2026-08', status: 'Đã khóa',
        rows: [{ employeeId: 'E01', gross: 1_000_000 }],
      }, {
        id: 'PAY-LOWER', storeId: 'store-01', period: '2026-08', status: 'Đã khóa',
        rows: [{ employeeId: 'E01', gross: 9_000_000 }],
      }],
    })

    expect(summary).toMatchObject({ identifierCollision: true, periods: [], rows: [] })
  })

  it('uses the exact employee payroll row before a case-insensitive alias', () => {
    const summary = employeePayrollSnapshotSummary({
      employeeId: 'E01',
      period: '2026-08',
      payrollPeriods: [{
        id: 'PAY-COLLISION', storeId: 'S01', period: '2026-08', status: 'Đã khóa',
        rows: [
          { employeeId: 'E01', baseSalary: 1_000_000, gross: 1_000_000 },
          { employeeId: 'e01', baseSalary: 9_000_000, gross: 9_000_000 },
        ],
      }],
    })

    expect(summary.identifierCollision).not.toBe(true)
    expect(summary.periods.map(({ id }) => id)).toEqual(['PAY-COLLISION'])
    expect(summary).toMatchObject({ gross: 1_000_000 })
  })

  it('fails closed when an employee payroll alias is ambiguous without an exact match', () => {
    const summary = employeePayrollSnapshotSummary({
      employeeId: 'Ee01',
      period: '2026-08',
      payrollPeriods: [{
        id: 'PAY-AMBIGUOUS-EMPLOYEE', storeId: 'S01', period: '2026-08', status: 'Đã khóa',
        rows: [
          { employeeId: 'EE01', gross: 1_000_000 },
          { employeeId: 'ee01', gross: 9_000_000 },
        ],
      }],
    })

    expect(summary).toMatchObject({ identifierCollision: true, rows: [] })
  })

  it('ignores superseded payroll aliases after an audited collision repair', () => {
    const summary = employeePayrollSnapshotSummary({
      employeeId: 'E01',
      period: '2026-08',
      payrollPeriods: [{
        id: 'PAY-CANONICAL', storeId: 'S01', period: '2026-08', status: 'Đã khóa',
        rows: [{ employeeId: 'E01', baseSalary: 1_000_000, gross: 1_000_000, remaining: 1_000_000 }],
      }, {
        id: 'PAY-ALIAS', storeId: 's01', period: '2026-08', status: 'Đã khóa',
        supersededAt: '2026-08-31T10:00:00.000Z',
        rows: [{ employeeId: 'E01', baseSalary: 9_000_000, gross: 9_000_000 }],
      }],
    })

    expect(summary.identifierCollision).not.toBe(true)
    expect(summary).toMatchObject({ homeBaseSalary: 1_000_000, gross: 1_000_000, remaining: 1_000_000 })
  })
})
