import { describe, expect, it } from 'vitest'
import {
  createAttendanceTaskProgress,
  savedTaskProgressCoversIncompleteTasks,
} from './taskProgress'

describe('attendance task progress', () => {
  it('covers only the same attendance, employee and complete set of incomplete tasks', () => {
    const progress = createAttendanceTaskProgress({
      attendanceId: 'ATT-01',
      employeeId: 'ST-01',
      completedTasks: 1,
      totalTasks: 3,
      completionRate: 33,
      incompleteTaskIds: ['TASK-03', 'TASK-02'],
      incompleteReason: 'Khách đông nên chưa hoàn tất',
      fingerprint: 'snapshot-01',
      submittedAt: '2026-09-02T08:00:00.000Z',
    })

    expect(savedTaskProgressCoversIncompleteTasks({
      progress,
      attendanceId: 'att-01',
      employeeId: 'st-01',
      incompleteTaskIds: ['task-02', 'TASK-03'],
    })).toBe(true)
    expect(savedTaskProgressCoversIncompleteTasks({
      progress,
      attendanceId: 'ATT-01',
      employeeId: 'ST-01',
      incompleteTaskIds: ['TASK-02'],
    })).toBe(false)
    expect(savedTaskProgressCoversIncompleteTasks({
      progress: { ...progress, incompleteReason: '' },
      attendanceId: 'ATT-01',
      employeeId: 'ST-01',
      incompleteTaskIds: ['TASK-02', 'TASK-03'],
    })).toBe(false)
  })
})
