import { describe, expect, it } from 'vitest'
import {
  revenueBonusHistoryProjection,
  revenueBonusHistoryRows,
  revenueBonusStatistics,
  rewardStatistics,
  violationStatistics,
  workRewardRows,
} from './compensationStatistics'

describe('violationStatistics', () => {
  it('summarizes active violations by day, month, and employee without counting voided records', () => {
    const result = violationStatistics([
      { employeeId: 'VP-01', employeeName: 'Nhân viên VP cũ', occurredOn: '2026-08-28', amountVnd: 3_000, status: 'ACTIVE' },
      { employeeId: 'VP-01', occurredOn: '2026-08-28', amountVnd: 5_000, status: 'ACTIVE' },
      { employeeId: 'HTKD-01', occurredOn: '2026-08-01', amountVnd: 3_000, voidedAt: '2026-08-02T00:00:00Z' },
    ])

    const severity = 'Chưa cấu hình mức độ'
    expect(result.byDay).toEqual([{ key: '2026-08-28', label: '28/08/2026', count: 2, amountVnd: 8_000, severity }])
    expect(result.byMonth).toEqual([{ key: '2026-08', label: 'Tháng 08/2026', count: 2, amountVnd: 8_000, severity }])
    expect(result.byEmployee).toEqual([{ key: 'VP-01', label: 'Nhân viên VP cũ', count: 2, amountVnd: 8_000, severity }])
  })
})

describe('revenue bonus history and statistics', () => {
  it('flattens only effective store allocations and preserves historical employee snapshots', () => {
    const rows = revenueBonusHistoryRows({
      storeId: 'store-01',
      employees: [{ id: 'E-OLD', name: 'Tên hồ sơ hiện tại' }, { id: 'E-02', name: 'Nhân viên Hai' }],
      revenueBonusDaily: [{
        id: 'RBD-AUG', storeId: 'STORE-01', storeName: 'Dosii Một', businessDate: '2026-08-31', period: '2026-08',
        status: 'APPROVED', calculatedAt: '2026-08-31T15:00:00Z',
        allocations: [{
          id: 'RBA-AUG', employeeId: 'E-OLD', employeeName: 'Nhân viên đã nghỉ',
          amountVnd: 3_000, workedSeconds: 7_200, weightPercent: 40, status: 'APPROVED',
        }, {
          id: 'RBA-AUG-VOID', employeeId: 'E-02', amountVnd: 99_000, status: 'VOID',
        }],
      }, {
        id: 'RBD-SEP', storeId: 'STORE-01', businessDate: '2026-09-01', period: '2026-09', status: 'APPROVED',
      }, {
        id: 'RBD-SUPERSEDED', storeId: 'STORE-01', businessDate: '2026-08-30', status: 'SUPERSEDED',
        allocations: [{ id: 'RBA-SUPERSEDED', employeeId: 'E-02', amountVnd: 77_000 }],
      }, {
        id: 'RBD-VOID', storeId: 'STORE-01', businessDate: '2026-08-29', voidedAt: '2026-08-30T00:00:00Z',
        allocations: [{ id: 'RBA-VOID', employeeId: 'E-02', amountVnd: 66_000 }],
      }, {
        id: 'RBD-OTHER', storeId: 'STORE-02', businessDate: '2026-08-31', status: 'APPROVED',
        allocations: [{ id: 'RBA-OTHER', employeeId: 'E-02', amountVnd: 55_000 }],
      }],
      revenueBonusAllocations: [{
        id: 'RBA-SEP', revenueBonusDailyId: 'rbd-sep', storeId: 'store-01', employeeId: 'E-02',
        employeeName: 'Tên chụp tháng 9', amountVnd: 7_000, workedSeconds: 3_600, status: 'APPROVED',
      }, {
        id: 'RBA-SEP-SUPERSEDED', revenueBonusDailyId: 'RBD-SEP', storeId: 'STORE-01', employeeId: 'E-OLD',
        amountVnd: 88_000, status: 'SUPERSEDED',
      }, {
        id: 'RBA-ORPHAN', revenueBonusDailyId: 'UNKNOWN', storeId: 'STORE-01', employeeId: 'E-02',
        amountVnd: 44_000, status: 'APPROVED',
      }],
    })

    expect(rows).toEqual([{
      id: 'RBA-SEP', revenueBonusDailyId: 'RBD-SEP', storeId: 'STORE-01', storeName: '',
      businessDate: '2026-09-01', month: '2026-09', employeeId: 'E-02', employeeName: 'Tên chụp tháng 9',
      workedSeconds: 3_600, approvedSalesHours: 1, weightPercent: null, amountVnd: 7_000,
      status: 'APPROVED', recordedAt: '',
    }, {
      id: 'RBA-AUG', revenueBonusDailyId: 'RBD-AUG', storeId: 'STORE-01', storeName: 'Dosii Một',
      businessDate: '2026-08-31', month: '2026-08', employeeId: 'E-OLD', employeeName: 'Nhân viên đã nghỉ',
      workedSeconds: 7_200, approvedSalesHours: 2, weightPercent: 40, amountVnd: 3_000,
      status: 'APPROVED', recordedAt: '2026-08-31T15:00:00Z',
    }])
  })

  it('aggregates effective history by day, employee and month and totals only the requested month', () => {
    const rows = [{
      id: 'A1', businessDate: '2026-08-30', month: '2026-08', employeeId: 'E-01', employeeName: 'Nhân viên cũ', amountVnd: 3_000,
    }, {
      id: 'A2', businessDate: '2026-08-31', month: '2026-08', employeeId: 'E-01', employeeName: 'Nhân viên cũ', amountVnd: 5_000,
    }, {
      id: 'A2-CASE', businessDate: '2026-08-31', month: '2026-08', employeeId: 'e-01', employeeName: 'Tên viết thường', amountVnd: 2_000,
    }, {
      id: 'A3', businessDate: '2026-09-01', month: '2026-09', employeeId: 'E-02', employeeName: 'Nhân viên Hai', amountVnd: 7_000,
    }, {
      id: 'A4', businessDate: '2026-08-31', month: '2026-08', employeeId: 'E-02', amountVnd: 99_000, status: 'SUPERSEDED',
    }]
    const result = revenueBonusStatistics(rows, { month: '2026-08' })

    expect(result.byDay).toEqual([
      { key: '2026-09-01', label: '01/09/2026', count: 1, amountVnd: 7_000 },
      { key: '2026-08-31', label: '31/08/2026', count: 2, amountVnd: 7_000 },
      { key: '2026-08-30', label: '30/08/2026', count: 1, amountVnd: 3_000 },
    ])
    expect(result.byEmployee).toEqual([
      { key: 'E-02', label: 'Nhân viên Hai', count: 1, amountVnd: 7_000 },
      { key: 'E-01', label: 'Nhân viên cũ', count: 3, amountVnd: 10_000 },
    ])
    expect(result.byMonth).toEqual([
      { key: '2026-09', label: 'Tháng 09/2026', count: 1, amountVnd: 7_000 },
      { key: '2026-08', label: 'Tháng 08/2026', count: 3, amountVnd: 10_000 },
    ])
    expect(result).toMatchObject({ requestedMonth: '2026-08', monthlyTotalVnd: 10_000 })
    expect(revenueBonusStatistics(rows, { month: '2026-13' })).toMatchObject({
      requestedMonth: '', monthlyTotalVnd: 0,
    })
  })

  it('excludes case-folded store/date collisions from rows and statistics', () => {
    const options = {
      storeId: 'STORE-01',
      revenueBonusDaily: [{
        id: 'RBD-COLLISION-UPPER', storeId: 'STORE-01', businessDate: '2026-08-31', status: 'APPROVED',
        allocations: [{ id: 'RBA-COLLISION-UPPER', employeeId: 'E-01', amountVnd: 3_000 }],
      }, {
        id: 'RBD-COLLISION-LOWER', storeId: 'store-01', businessDate: '2026-08-31', status: 'APPROVED',
        allocations: [{ id: 'RBA-COLLISION-LOWER', employeeId: 'E-01', amountVnd: 5_000 }],
      }, {
        id: 'RBD-SAFE', storeId: 'Store-01', businessDate: '2026-08-30', status: 'APPROVED',
        allocations: [{ id: 'RBA-SAFE', employeeId: 'E-01', amountVnd: 7_000 }],
      }, {
        id: 'RBD-VOID-SAME-SCOPE', storeId: 'STORE-01', businessDate: '2026-08-30', status: 'VOID',
        allocations: [{ id: 'RBA-VOID-SAME-SCOPE', employeeId: 'E-01', amountVnd: 99_000 }],
      }],
    }

    const projection = revenueBonusHistoryProjection(options)

    expect(projection).toEqual({
      rows: [expect.objectContaining({
        id: 'RBA-SAFE', revenueBonusDailyId: 'RBD-SAFE', businessDate: '2026-08-30', amountVnd: 7_000,
      })],
      collisions: [{
        storeId: 'STORE-01', storeKey: 'store-01', businessDate: '2026-08-31',
        recordIds: ['RBD-COLLISION-LOWER', 'RBD-COLLISION-UPPER'], recordCount: 2,
      }],
      employeeCollisions: [],
    })
    expect(revenueBonusHistoryRows(options)).toEqual(projection.rows)
    expect(revenueBonusStatistics(projection.rows, { month: '2026-08' })).toMatchObject({
      monthlyTotalVnd: 7_000,
      byDay: [{ key: '2026-08-30', label: '30/08/2026', count: 1, amountVnd: 7_000 }],
    })
  })

  it('keeps case variants for one employee profile and groups them under its canonical id', () => {
    const projection = revenueBonusHistoryProjection({
      employees: [{ id: 'E01', code: 'e01', name: 'Nhân viên Một' }],
      revenueBonusDaily: [{
        id: 'RBD-ALIASES', storeId: 'STORE-01', businessDate: '2026-08-31', status: 'APPROVED',
        allocations: [
          { id: 'RBA-ALIAS-UPPER', employeeId: 'E01', amountVnd: 3_000 },
          { id: 'RBA-ALIAS-LOWER', employeeId: 'e01', amountVnd: 5_000 },
        ],
      }],
    })

    expect(projection.employeeCollisions).toEqual([])
    expect(projection.rows).toEqual([
      expect.objectContaining({ id: 'RBA-ALIAS-UPPER', employeeId: 'E01', amountVnd: 3_000 }),
      expect.objectContaining({ id: 'RBA-ALIAS-LOWER', employeeId: 'E01', amountVnd: 5_000 }),
    ])
    expect(revenueBonusStatistics(projection.rows).byEmployee).toEqual([{
      key: 'E01', label: 'Nhân viên Một', count: 2, amountVnd: 8_000,
    }])
  })

  it('preserves immutable support-tag evidence in projected revenue history', () => {
    const projection = revenueBonusHistoryProjection({
      employees: [{ id: 'SUPPORT-01', name: 'Nhân viên hỗ trợ', storeId: 'HOME' }],
      revenueBonusDaily: [{
        id: 'RBD-SUPPORT', storeId: 'STORE-01', businessDate: '2026-09-02', status: 'APPROVED',
        allocations: [{
          id: 'RBA-SUPPORT', employeeId: 'SUPPORT-01', amountVnd: 0,
          supportTransferred: true, supportTransferIds: ['TR-SUPPORT'],
          supportHomeStoreId: 'HOME', supportHomeStoreName: 'Cửa hàng gốc',
          supportStoreId: 'STORE-01', supportStoreName: 'Cửa hàng hỗ trợ',
        }],
      }],
    })

    expect(projection.rows).toEqual([expect.objectContaining({
      id: 'RBA-SUPPORT',
      supportTransferred: true,
      supportTransferIds: ['TR-SUPPORT'],
      supportHomeStoreId: 'HOME',
      supportStoreId: 'STORE-01',
    })])
  })

  it('excludes allocations when distinct employee profiles collide after case folding', () => {
    const projection = revenueBonusHistoryProjection({
      employees: [
        { id: 'E01', code: 'EMPLOYEE-UPPER', name: 'Hồ sơ chữ hoa' },
        { id: 'e01', code: 'EMPLOYEE-LOWER', name: 'Hồ sơ chữ thường' },
        { id: 'E02', name: 'Hồ sơ an toàn' },
      ],
      revenueBonusDaily: [{
        id: 'RBD-EMPLOYEE-COLLISION', storeId: 'STORE-01', businessDate: '2026-08-31', status: 'APPROVED',
        allocations: [
          { id: 'RBA-COLLISION-UPPER', employeeId: 'E01', amountVnd: 3_000 },
          { id: 'RBA-COLLISION-LOWER', employeeId: 'e01', amountVnd: 5_000 },
          { id: 'RBA-COLLIDING-PROFILE-ALIAS', employeeId: 'EMPLOYEE-UPPER', amountVnd: 11_000 },
          { id: 'RBA-SAFE-EMPLOYEE', employeeId: 'E02', amountVnd: 7_000 },
        ],
      }],
    })

    expect(projection.rows).toEqual([
      expect.objectContaining({ id: 'RBA-SAFE-EMPLOYEE', employeeId: 'E02', amountVnd: 7_000 }),
    ])
    expect(projection.employeeCollisions).toEqual([{
      employeeKey: 'e01', employeeIds: ['E01', 'e01'], recordCount: 2,
    }])
    expect(revenueBonusStatistics(projection.rows, { month: '2026-08' })).toMatchObject({
      monthlyTotalVnd: 7_000,
      byEmployee: [{ key: 'E02', label: 'Hồ sơ an toàn', count: 1, amountVnd: 7_000 }],
    })
  })
})

describe('work reward statistics', () => {
  const rewardTask = {
    id: 'catalog-reward-clean',
    catalogItemId: 'catalog-reward-clean',
    catalogCode: 'office.reward.clean',
    kind: 'REWARD_TASK',
    name: 'Lau nhà',
    amountVnd: 2_000,
  }

  it('uses attendance snapshots as the immutable reward source and canonical progress as completion', () => {
    const rows = workRewardRows({
      employees: [{ id: 'VP-01', name: 'Nhân viên VP', unit: 'office' }],
      attendance: [{
        id: 'ATT-01', employeeId: 'VP-01', employeeName: 'Nhân viên VP', unit: 'office',
        workDate: '2026-08-28', shiftId: 'VP-AM', shiftName: 'Ca sáng', shiftStart: '08:00', shiftEnd: '12:00',
        checklistSnapshot: { tasks: [rewardTask, { ...rewardTask, id: 'fixed', catalogItemId: 'fixed', kind: 'FIXED_TASK', name: 'Việc bắt buộc', amountVnd: 0 }] },
      }],
      workCatalogProgress: [{ attendanceId: 'ATT-01', catalogItemId: 'catalog-reward-clean', completed: true, completedAt: '2026-08-28T03:00:00Z' }],
      tasks: [{ checklistAttendanceId: 'ATT-01', catalogItemId: 'catalog-reward-clean', completedBy: { 'VP-01': false } }],
    })

    expect(rows).toEqual([expect.objectContaining({
      attendanceId: 'ATT-01', employeeId: 'VP-01', catalogItemId: 'catalog-reward-clean',
      title: 'Lau nhà', amountVnd: 2_000, completed: true, shiftName: 'Ca sáng', shiftTime: '08:00–12:00',
    })])
  })

  it('matches employee, store, attendance, catalog and legacy completion ids without casing sensitivity', () => {
    const rows = workRewardRows({
      employeeId: 'vp-01',
      storeId: 'store-01',
      employees: [{ id: 'vp-01', name: 'Nhân viên VP', unit: 'office', storeId: 'STORE-01' }],
      attendance: [{
        id: 'ATT-CASE', employeeId: 'VP-01', unit: 'office', storeId: 'STORE-01', workDate: '2026-08-28',
        checklistSnapshot: { tasks: [rewardTask] },
      }],
      workCatalogProgress: [{
        attendanceId: 'att-case', catalogItemId: 'CATALOG-REWARD-CLEAN', checked: true, status: 'CLAIMED',
      }],
      tasks: [{
        checklistAttendanceId: 'att-case', catalogItemId: 'CATALOG-REWARD-CLEAN', completedBy: { 'vp-01': true },
      }],
    })

    expect(rows).toEqual([expect.objectContaining({
      attendanceId: 'ATT-CASE', employeeId: 'VP-01', employeeName: 'Nhân viên VP', completed: true,
    })])
  })

  it('keeps employee and store filters exact-first and fails closed for ambiguous casing aliases', () => {
    const employees = [
      { id: 'EM01', name: 'Nhân viên chữ hoa', unit: 'office', storeId: 'STORE-X' },
      { id: 'em01', name: 'Nhân viên chữ thường', unit: 'office', storeId: 'store-x' },
    ]
    const attendance = [
      { id: 'ATT-UPPER', employeeId: 'EM01', storeId: 'STORE-X', unit: 'office', workDate: '2026-08-28', checklistSnapshot: { tasks: [rewardTask] } },
      { id: 'ATT-LOWER', employeeId: 'em01', storeId: 'store-x', unit: 'office', workDate: '2026-08-28', checklistSnapshot: { tasks: [rewardTask] } },
    ]

    expect(workRewardRows({ employees, attendance, employeeId: 'EM01', storeId: 'STORE-X' }))
      .toEqual([expect.objectContaining({ attendanceId: 'ATT-UPPER', employeeName: 'Nhân viên chữ hoa', storeId: 'STORE-X' })])
    expect(workRewardRows({ employees, attendance, employeeId: 'EM01', storeId: 'StOrE-X' })).toEqual([])
    expect(workRewardRows({ employees, attendance, employeeId: 'Em01' })).toEqual([])
  })

  it('does not share reward progress between exact attendance ids that collide by casing', () => {
    const rows = workRewardRows({
      attendance: [{
        id: 'ATT-X', employeeId: 'VP-01', unit: 'office', workDate: '2026-08-28',
        checklistSnapshot: { tasks: [rewardTask] },
      }, {
        id: 'att-x', employeeId: 'VP-02', unit: 'office', workDate: '2026-08-28',
        checklistSnapshot: { tasks: [rewardTask] },
      }],
      workCatalogProgress: [{
        attendanceId: 'att-x', catalogItemId: rewardTask.id, checked: true, status: 'CLAIMED',
      }],
    })

    expect(rows.find((row) => row.attendanceId === 'ATT-X')?.completed).toBe(false)
    expect(rows.find((row) => row.attendanceId === 'att-x')?.completed).toBe(true)
  })

  it('does not share reward progress between exact catalog ids that collide by casing', () => {
    const upperReward = { ...rewardTask, id: 'REWARD-X', catalogItemId: 'REWARD-X', name: 'Thưởng chữ hoa' }
    const lowerReward = { ...rewardTask, id: 'reward-x', catalogItemId: 'reward-x', name: 'Thưởng chữ thường' }
    const rows = workRewardRows({
      attendance: [{
        id: 'ATT-CATALOG-COLLISION', employeeId: 'VP-01', unit: 'office', workDate: '2026-08-28',
        checklistSnapshot: { tasks: [upperReward, lowerReward] },
      }],
      workCatalogProgress: [{
        attendanceId: 'ATT-CATALOG-COLLISION', catalogItemId: 'reward-x', checked: true, status: 'CLAIMED',
      }],
    })

    expect(rows.find((row) => row.catalogItemId === 'REWARD-X')?.completed).toBe(false)
    expect(rows.find((row) => row.catalogItemId === 'reward-x')?.completed).toBe(true)
  })

  it('keeps legacy completedBy as a read-only fallback and summarizes only completed rewards', () => {
    const rows = workRewardRows({
      attendance: [
        { id: 'ATT-01', employeeId: 'HTKD-01', unit: 'business_support', workDate: '2026-08-28', checklistSnapshot: { tasks: [rewardTask] } },
        { id: 'ATT-02', employeeId: 'HTKD-01', unit: 'business_support', workDate: '2026-08-27', checklistSnapshot: { tasks: [rewardTask] } },
      ],
      tasks: [{ checklistAttendanceId: 'ATT-01', catalogItemId: 'catalog-reward-clean', completedBy: { 'HTKD-01': true }, completedAt: '2026-08-28T03:00:00Z' }],
    })
    const statistics = rewardStatistics(rows)

    expect(rows.find((row) => row.attendanceId === 'ATT-01')?.completed).toBe(true)
    expect(rows.find((row) => row.attendanceId === 'ATT-02')?.completed).toBe(false)
    expect(statistics.byDay).toEqual([{ key: '2026-08-28', label: '28/08/2026', count: 1, amountVnd: 2_000 }])
    expect(statistics.byMonth).toEqual([{ key: '2026-08', label: 'Tháng 08/2026', count: 1, amountVnd: 2_000 }])
  })

  it('gives the exact legacy employee key precedence over differently-cased aliases', () => {
    const rows = workRewardRows({
      attendance: [{
        id: 'ATT-LEGACY-EMPLOYEE-CASE', employeeId: 'E01', unit: 'business_support', workDate: '2026-08-28',
        checklistSnapshot: { tasks: [rewardTask] },
      }],
      tasks: [{
        checklistAttendanceId: 'ATT-LEGACY-EMPLOYEE-CASE', catalogItemId: rewardTask.id,
        completedBy: { E01: false, e01: true },
      }],
    })

    expect(rows).toEqual([expect.objectContaining({ employeeId: 'E01', completed: false, paid: false })])
    expect(rewardStatistics(rows).byDay).toEqual([])
  })

  it('recognizes canonical claimed progress while explicit unchecked and void states win', () => {
    const attendance = [
      { id: 'ATT-CLAIMED', employeeId: 'VP-01', unit: 'office', workDate: '2026-08-28', checklistSnapshot: { tasks: [rewardTask] } },
      { id: 'ATT-UNCHECKED', employeeId: 'VP-01', unit: 'office', workDate: '2026-08-28', checklistSnapshot: { tasks: [rewardTask] } },
      { id: 'ATT-VOID', employeeId: 'VP-01', unit: 'office', workDate: '2026-08-28', checklistSnapshot: { tasks: [rewardTask] } },
    ]
    const rows = workRewardRows({
      attendance,
      workCatalogProgress: [
        { attendanceId: 'ATT-CLAIMED', catalogItemId: rewardTask.id, checked: true, status: 'CLAIMED' },
        { attendanceId: 'ATT-UNCHECKED', catalogItemId: rewardTask.id, checked: false, status: 'CLAIMED' },
        { attendanceId: 'ATT-VOID', catalogItemId: rewardTask.id, checked: true, status: 'VOID' },
      ],
      tasks: [
        { checklistAttendanceId: 'ATT-UNCHECKED', catalogItemId: rewardTask.id, completedBy: { 'VP-01': true } },
        { checklistAttendanceId: 'ATT-VOID', catalogItemId: rewardTask.id, completedBy: { 'VP-01': true } },
      ],
    })

    expect(rows.find((row) => row.attendanceId === 'ATT-CLAIMED')?.completed).toBe(true)
    expect(rows.find((row) => row.attendanceId === 'ATT-UNCHECKED')?.completed).toBe(false)
    expect(rows.find((row) => row.attendanceId === 'ATT-VOID')?.completed).toBe(false)
  })

  it('keeps team milestones visibly checked while excluding pending payouts from paid statistics', () => {
    const rows = workRewardRows({
      attendance: [{
        id: 'ATT-TEAM', employeeId: 'VP-01', unit: 'office', workDate: '2026-08-28',
        checklistSnapshot: { tasks: [{ ...rewardTask, rewardScope: 'team', milestoneProgramId: 'office.video.views', milestoneId: 'office.video.over_100_000_views' }] },
      }],
      workCatalogProgress: [{
        attendanceId: 'ATT-TEAM', catalogItemId: rewardTask.id, checked: true, status: 'PENDING_TEAM_REVIEW',
        compensationEntryId: null,
      }],
    })
    expect(rows[0]).toMatchObject({ completed: true, paid: false, payoutStatus: 'pending' })
    expect(rewardStatistics(rows).byDay).toEqual([])
  })

  it('builds a production-sized reward history without blocking the browser thread', () => {
    const employees = Array.from({ length: 30 }, (_, index) => ({
      id: `STORE-EMPLOYEE-${index}`,
      name: `Nhân viên ${index}`,
      unit: 'store',
      storeId: 'STORE-PERFORMANCE',
    }))
    const rewardTasks = Array.from({ length: 5 }, (_, index) => ({
      ...rewardTask,
      id: `REWARD-${index}`,
      catalogItemId: `REWARD-${index}`,
      name: `Công việc ${index}`,
    }))
    const attendance = Array.from({ length: 400 }, (_, index) => ({
      id: `ATTENDANCE-${index}`,
      employeeId: employees[index % employees.length].id,
      unit: 'store',
      storeId: 'STORE-PERFORMANCE',
      workDate: '2026-08-28',
      checklistSnapshot: { tasks: rewardTasks },
    }))
    const workCatalogProgress = attendance.flatMap((record) => rewardTasks.map((task) => ({
      attendanceId: record.id,
      catalogItemId: task.id,
      checked: true,
      status: 'CLAIMED',
    })))

    const startedAt = performance.now()
    const rows = workRewardRows({
      attendance,
      workCatalogProgress,
      employees,
      targetUnit: 'store',
      storeId: 'STORE-PERFORMANCE',
    })
    const elapsedMs = performance.now() - startedAt

    expect(rows).toHaveLength(2_000)
    expect(elapsedMs).toBeLessThan(1_000)
  })
})
