import { describe, expect, it } from 'vitest'
import { rewardStatistics, violationStatistics, workRewardRows } from './compensationStatistics'

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
})
