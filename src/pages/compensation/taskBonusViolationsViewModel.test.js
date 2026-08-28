import { describe, expect, it } from 'vitest'
import {
  filterRewardSubmissionRows,
  selectRewardSubmissionRows,
  selectStoreEmployees,
  selectWorkedShiftOptions,
} from './taskBonusViolationsViewModel'

const shifts = [
  { id: 'MORNING', storeId: 'CH001', name: 'Ca sáng hiện tại', start: '08:00', end: '12:00', active: true },
  { id: 'AFTERNOON', storeId: 'CH001', name: 'Ca chiều', start: '12:00', end: '17:00', active: true },
]

describe('selectWorkedShiftOptions', () => {
  it('uses exact employee/store/day evidence and prefers attendance history over schedule and definitions', () => {
    const options = selectWorkedShiftOptions({
      employeeId: 'NV-01', storeId: 'CH001', date: '2026-08-28', shiftDefinitions: shifts,
      attendance: [{
        id: 'ATT-01', employeeId: 'NV-01', storeId: 'CH001', date: '2026-08-28', shiftId: 'MORNING',
        shiftName: 'Ca sáng lịch sử', shiftStart: '07:30', shiftEnd: '11:30',
      }, {
        id: 'ATT-WRONG-STORE', employeeId: 'NV-01', storeId: 'CH002', date: '2026-08-28', shiftId: 'NIGHT',
      }],
      schedule: [{
        id: 'SCH-01', employeeId: 'NV-01', storeId: 'CH001', date: '2026-08-28',
        shiftIds: ['MORNING', 'AFTERNOON'],
        shiftSnapshots: [
          { id: 'MORNING', name: 'Ca sáng theo lịch', start: '08:00', end: '12:00' },
          { id: 'AFTERNOON', name: 'Ca chiều theo lịch', start: '12:00', end: '17:00' },
        ],
      }, {
        id: 'SCH-WRONG-DAY', employeeId: 'NV-01', storeId: 'CH001', date: '2026-08-27', shiftIds: ['NIGHT'],
      }],
    })

    expect(options).toEqual([
      expect.objectContaining({ id: 'MORNING', name: 'Ca sáng lịch sử', start: '07:30', end: '11:30', source: 'attendance', sourceLabel: 'Đã chấm công' }),
      expect.objectContaining({ id: 'AFTERNOON', name: 'Ca chiều theo lịch', source: 'schedule', sourceLabel: 'Theo lịch phân ca' }),
    ])
  })

  it('returns no active-definition-only shifts but keeps schedule fallback for forgotten attendance', () => {
    expect(selectWorkedShiftOptions({
      employeeId: 'NV-01', storeId: 'CH001', date: '2026-08-28', shiftDefinitions: shifts,
    })).toEqual([])

    expect(selectWorkedShiftOptions({
      employeeId: 'NV-01', storeId: 'CH001', date: '2026-08-28', shiftDefinitions: shifts,
      schedule: [{ id: 'SCH-01', employeeId: 'NV-01', storeId: 'CH001', date: '2026-08-28', shiftIds: ['MORNING'] }],
    })).toEqual([expect.objectContaining({ id: 'MORNING', sourceLabel: 'Theo lịch phân ca' })])
  })
})

describe('selectStoreEmployees', () => {
  it('keeps the picker on active home-store employees and excludes transfer-only employees', () => {
    expect(selectStoreEmployees({
      storeId: 'CH001',
      employees: [
        { id: 'NV-HOME', name: 'Nhân viên nhà', unit: 'store', storeId: 'CH001' },
        { id: 'NV-TRANSFER', name: 'Nhân viên hỗ trợ', unit: 'store', storeId: 'CH002' },
        { id: 'QLCH-001', name: 'Quản lý cửa hàng', unit: 'store_manager', storeId: 'CH001' },
        { id: 'QLCH-LEGACY', name: 'Quản lý legacy', unit: 'store', role: 'store_manager', storeId: 'CH001' },
        { id: 'QLCH-POSITION', name: 'Quản lý theo chức danh', unit: 'store', position: 'Quản lý cửa hàng', storeId: 'CH001' },
        { id: 'NV-INACTIVE', name: 'Đã nghỉ', unit: 'store', storeId: 'CH001', status: 'Đã nghỉ việc' },
      ],
      attendance: [{ id: 'ATT-X', employeeId: 'NV-TRANSFER', storeId: 'CH001', date: '2026-08-28', shiftId: 'MORNING' }],
    }).map((employee) => employee.id)).toEqual(['NV-HOME'])
  })

  it('includes an active transferred employee only when the selected store and day have explicit work evidence', () => {
    const input = {
      storeId: 'CH001',
      date: '2026-08-28',
      employees: [
        { id: 'NV-HOME', name: 'Nhân viên nhà', unit: 'store', storeId: 'CH001' },
        {
          id: 'NV-TRANSFER', name: 'Nhân viên hỗ trợ', unit: 'store', storeId: 'CH002',
          historicalStoreId: 'CH001', historicalOnly: true,
        },
        { id: 'NV-UNRELATED', name: 'Nhân viên ngoài phạm vi', unit: 'store', storeId: 'CH004' },
      ],
      attendance: [{
        id: 'ATT-X', employeeId: 'NV-TRANSFER', storeId: 'CH001', date: '2026-08-28', shiftId: 'MORNING',
      }],
    }

    expect(selectStoreEmployees(input).map((employee) => employee.id).sort()).toEqual(['NV-HOME', 'NV-TRANSFER'])
    expect(selectStoreEmployees({ ...input, date: '2026-08-27' }).map((employee) => employee.id)).toEqual(['NV-HOME'])
    expect(selectStoreEmployees({ ...input, storeId: 'CH003' })).toEqual([])
  })
})

describe('selectRewardSubmissionRows', () => {
  const common = {
    storeId: 'CH001',
    shiftDefinitions: shifts,
    employees: [
      { id: 'NV-01', name: 'Nguyễn An', unit: 'store', storeId: 'CH001' },
      { id: 'NV-02', name: 'Lê Bình', unit: 'store', storeId: 'CH001' },
    ],
    workCatalogItems: [
      { id: 'REWARD-FLOOR', code: 'store.reward.floor', kind: 'REWARD_TASK', targetGroup: 'store', name: 'Lau nhà hiện tại', amountVnd: 9_999 },
      { id: 'REWARD-MUSIC', code: 'store.reward.music', kind: 'REWARD_TASK', targetGroup: 'store', name: 'Mở nhạc', amountVnd: 1_000 },
      { id: 'FIXED-LIGHT', code: 'store.fixed.light', kind: 'FIXED_TASK', targetGroup: 'store', name: 'Bật đèn', amountVnd: 0 },
    ],
  }

  it('prefers canonical progress, de-duplicates snapshots and only totals linked active ledger rows', () => {
    const rows = selectRewardSubmissionRows({
      ...common,
      workCatalogProgress: [{
        id: 'PROGRESS-FLOOR', employeeId: 'NV-01', employeeName: 'Nguyễn An', storeId: 'CH001', workDate: '2026-08-28',
        shiftRef: 'MORNING', catalogItemId: 'REWARD-FLOOR', catalogCode: 'store.reward.floor', kind: 'REWARD_TASK',
        name: 'Lau nhà theo bản chụp', amountVnd: 2_000, completed: true, submittedAt: '2026-08-28T03:00:00.000Z',
      }, {
        id: 'PROGRESS-TRANSFER', employeeId: 'NV-02', storeId: 'CH001', workDate: '2026-08-28', shiftRef: 'AFTERNOON',
        catalogItemId: 'REWARD-MUSIC', kind: 'REWARD_TASK', name: 'Mở nhạc', amountVnd: 1_000, completed: true,
        payable: false, statusCode: 'TRANSFER_RECONCILIATION_REQUIRED', submittedAt: '2026-08-28T04:00:00.000Z',
      }, {
        id: 'PROGRESS-VOID', employeeId: 'NV-02', storeId: 'CH001', workDate: '2026-08-27', shiftRef: 'MORNING',
        catalogItemId: 'REWARD-FLOOR', kind: 'REWARD_TASK', name: 'Lau nhà cũ', amountVnd: 2_000, completed: false, status: 'NOT_COMPLETED',
      }],
      compensationEntries: [{
        id: 'WORK-01', workCatalogProgressId: 'PROGRESS-FLOOR', type: 'WORK', status: 'ACTIVE', amountVnd: 2_000,
      }, {
        id: 'WORK-TRANSFER', workCatalogProgressId: 'PROGRESS-TRANSFER', type: 'WORK', status: 'ACTIVE', amountVnd: 1_000,
      }, {
        id: 'WORK-VOID', workCatalogProgressId: 'PROGRESS-VOID', type: 'WORK', status: 'VOID', voidedAt: '2026-08-28T05:00:00.000Z',
      }],
      taskAssignmentHistory: [{
        id: 'ASSIGN-01', storeId: 'CH001', date: '2026-08-28', shiftId: 'MORNING',
        tasks: [{
          id: 'TASK-FLOOR', catalogItemId: 'REWARD-FLOOR', catalogKind: 'REWARD_TASK',
          catalogSnapshot: { catalogItemId: 'REWARD-FLOOR', kind: 'REWARD_TASK', name: 'Lau nhà bất biến', amountVnd: 2_000 },
          completedBy: { 'NV-01': true },
        }],
        progressHistory: [{
          action: 'progress-submitted', employeeId: 'NV-01', employeeName: 'Nguyễn An', storeId: 'CH001', date: '2026-08-28',
          shiftId: 'MORNING', at: '2026-08-28T02:00:00.000Z',
          rewardTaskSnapshots: [{ taskId: 'TASK-FLOOR', catalogItemId: 'REWARD-FLOOR', kind: 'REWARD_TASK', name: 'Lau nhà bất biến', amountVnd: 2_000, completed: true }],
        }, {
          action: 'progress-submitted', employeeId: 'NV-01', storeId: 'CH001', date: '2026-08-28', shiftId: 'MORNING',
          at: '2026-08-28T02:30:00.000Z',
          rewardTaskSnapshots: [{ taskId: 'TASK-FLOOR', catalogItemId: 'REWARD-FLOOR', kind: 'REWARD_TASK', name: 'Bản gửi lại', amountVnd: 2_000, completed: true }],
        }],
      }],
    })

    expect(rows).toHaveLength(3)
    expect(rows.find((row) => row.catalogItemId === 'REWARD-FLOOR' && row.employeeId === 'NV-01')).toMatchObject({
      source: 'work-catalog-progress', name: 'Lau nhà theo bản chụp', amountVnd: 2_000, payable: true, status: 'Đã ghi nhận',
    })
    expect(rows.find((row) => row.employeeId === 'NV-02' && row.date === '2026-08-28')).toMatchObject({
      payable: false, status: 'Chờ đối soát điều chuyển', statusTone: 'orange',
    })
    expect(rows.find((row) => row.employeeId === 'NV-02' && row.date === '2026-08-27')).toMatchObject({
      payable: false, voided: true, status: 'Đã hủy',
    })
    expect(rows.filter((row) => row.payable).reduce((sum, row) => sum + row.amountVnd, 0)).toBe(2_000)
  })

  it('excludes mutable completedBy/task.done state until the employee submits it', () => {
    const rows = selectRewardSubmissionRows({
      ...common,
      taskAssignmentHistory: [{
        id: 'ASSIGN-LEGACY', storeId: 'CH001', date: '2026-08-28', shiftId: 'MORNING', employeeIds: ['NV-01'],
        submittedAt: '2026-08-28T03:00:00.000Z',
        tasks: [{
          id: 'TASK-LEGACY', catalogItemId: 'REWARD-FLOOR', catalogKind: 'REWARD_TASK',
          catalogSnapshot: { catalogItemId: 'REWARD-FLOOR', kind: 'REWARD_TASK', name: 'Lau nhà', amountVnd: 2_000 },
          completedBy: { 'NV-01': true },
        }],
      }],
      tasks: [{
        id: 'TASK-FLAT-UNSENT', storeId: 'CH001', employeeId: 'NV-01', date: '2026-08-28', shiftId: 'MORNING',
        catalogItemId: 'REWARD-MUSIC', kind: 'REWARD_TASK', name: 'Mở nhạc chưa gửi', amountVnd: 1_000, done: true,
      }],
    })

    expect(rows).toEqual([])
  })

  it('keeps genuine legacy progress-submitted snapshots visible but non-payable without a ledger', () => {
    const rows = selectRewardSubmissionRows({
      ...common,
      taskAssignmentHistory: [{
        id: 'ASSIGN-LEGACY-SUBMITTED', storeId: 'CH001', date: '2026-08-28', shiftId: 'MORNING',
        progressHistory: [{
          action: 'progress-submitted', employeeId: 'NV-01', employeeName: 'Nguyễn An', attendanceId: 'ATT-LEGACY',
          storeId: 'CH001', date: '2026-08-28', shiftId: 'MORNING', at: '2026-08-28T03:00:00.000Z',
          taskResults: [{
            taskId: 'TASK-LEGACY', catalogItemId: 'REWARD-FLOOR', kind: 'REWARD_TASK',
            name: 'Lau nhà đã gửi', amountVnd: 2_000, completed: true,
          }],
        }],
      }],
    })

    expect(rows).toEqual([expect.objectContaining({
      source: 'submission-snapshot', attendanceId: 'ATT-LEGACY', name: 'Lau nhà đã gửi',
      amountVnd: 2_000, payable: false, status: 'Dữ liệu cũ · chưa tính thưởng', statusTone: 'gray',
    })])
  })

  it('keeps separate attendance occurrences for the same employee, day, shift and catalog item', () => {
    const progress = ['ATT-01', 'ATT-02'].map((attendanceId, index) => ({
      id: `PROGRESS-${index + 1}`,
      employeeId: 'NV-01', storeId: 'CH001', attendanceId, workDate: '2026-08-28', shiftId: 'MORNING',
      catalogItemId: 'REWARD-FLOOR', kind: 'REWARD_TASK', name: 'Lau nhà', amountVnd: 2_000,
      completed: true, submittedAt: `2026-08-28T0${index + 2}:00:00.000Z`,
    }))
    const rows = selectRewardSubmissionRows({
      ...common,
      workCatalogProgress: progress,
      compensationEntries: progress.map((record) => ({
        id: `WORK-${record.id}`, type: 'WORK', status: 'ACTIVE', workCatalogProgressId: record.id,
      })),
    })

    expect(rows).toHaveLength(2)
    expect(rows.map((row) => row.attendanceId).sort()).toEqual(['ATT-01', 'ATT-02'])
    expect(new Set(rows.map((row) => row.dedupeKey)).size).toBe(2)
  })

  it('filters date, employee, shift and accent-insensitive search without mutating rows', () => {
    const rows = [
      { id: '1', date: '2026-08-28', employeeId: 'NV-01', employeeName: 'Nguyễn An', shiftId: 'MORNING', shiftName: 'Ca sáng', name: 'Lau nhà' },
      { id: '2', date: '2026-08-27', employeeId: 'NV-02', employeeName: 'Lê Bình', shiftId: 'AFTERNOON', shiftName: 'Ca chiều', name: 'Mở nhạc' },
    ]

    expect(filterRewardSubmissionRows(rows, {
      fromDate: '2026-08-28', toDate: '2026-08-28', employeeId: 'NV-01', shiftId: 'MORNING', query: 'nguyen lau',
    })).toEqual([rows[0]])
    expect(rows).toHaveLength(2)
  })
})
