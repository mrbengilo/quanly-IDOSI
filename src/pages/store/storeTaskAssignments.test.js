import { describe, expect, it } from 'vitest'
import { storeTaskHistory } from './storeTaskAssignments'

describe('store task assignment history', () => {
  it('uses the exact completion value before a conflicting case variant', () => {
    const history = storeTaskHistory({
      storeId: 'S01',
      employees: [{ id: 'E01', name: 'Nhân viên 01' }],
      taskAssignmentHistory: [{
        id: 'ASSIGN-01',
        storeId: 's01',
        employeeIds: ['E01'],
        tasks: [{
          id: 'TASK-01',
          employeeIds: ['E01'],
          completedBy: { E01: true, e01: false },
        }],
      }],
    })

    expect(history[0].tasks[0]).toMatchObject({ completed: 1, required: 1, status: 'Hoàn thành' })
  })

  it('fails closed when completion aliases collide without an exact key', () => {
    const history = storeTaskHistory({
      storeId: 'S01',
      employees: [{ id: 'E01', name: 'Nhân viên 01' }],
      taskAssignmentHistory: [{
        id: 'ASSIGN-AMBIGUOUS', storeId: 'S01', employeeIds: ['E01'],
        tasks: [{
          id: 'TASK-AMBIGUOUS', employeeIds: ['E01'],
          completedBy: { ' e01': true, 'e01 ': true },
        }],
      }],
    })

    expect(history[0].tasks[0]).toMatchObject({ completed: 0, required: 1, status: 'Chưa hoàn thành' })
  })

  it('fails closed when assignee identifiers differ only by casing', () => {
    const history = storeTaskHistory({
      storeId: 'S01',
      employees: [
        { id: 'E01', name: 'Nhân viên 01' },
        { id: 'e01', name: 'Nhân viên trùng mã' },
      ],
      taskAssignmentHistory: [{
        id: 'ASSIGN-COLLISION',
        storeId: 'S01',
        employeeIds: ['E01', 'e01'],
        tasks: [{
          id: 'TASK-COLLISION',
          employeeIds: ['E01', 'e01'],
          completedBy: { E01: true, e01: false },
        }],
      }],
    })

    expect(history[0]).toMatchObject({
      completed: 0,
      required: 1,
      status: 'Chưa hoàn thành',
      identifierCollision: true,
    })
    expect(history[0].tasks[0]).toMatchObject({
      completed: 0,
      required: 1,
      status: 'Chưa hoàn thành',
      identifierCollision: true,
    })
  })

  it('keeps exact store task histories isolated and rejects an ambiguous mixed-case store alias', () => {
    const options = {
      taskAssignmentHistory: [{ id: 'A-UPPER', storeId: 'STORE-01', tasks: [{ id: 'T1', title: 'Upper' }] }, {
        id: 'A-LOWER', storeId: 'store-01', tasks: [{ id: 'T2', title: 'Lower' }],
      }],
    }

    expect(storeTaskHistory({ ...options, storeId: 'STORE-01' }).map((row) => row.id)).toEqual(['A-UPPER'])
    expect(storeTaskHistory({ ...options, storeId: 'store-01' }).map((row) => row.id)).toEqual(['A-LOWER'])
    expect(storeTaskHistory({ ...options, storeId: 'Store-01' })).toEqual([])
  })

  it('does not suppress a legacy task when its assignment alias is ambiguous without an exact match', () => {
    const history = storeTaskHistory({
      storeId: 'S01',
      taskAssignmentHistory: [
        { id: 'ASSIGN-1', storeId: 'S01', tasks: [{ id: 'T1', title: 'Explicit upper' }] },
        { id: 'assign-1', storeId: 'S01', tasks: [{ id: 'T2', title: 'Explicit lower' }] },
      ],
      tasks: [{ id: 'T3', assignmentId: 'Assign-1', storeId: 'S01', title: 'Legacy ambiguous' }],
    })

    expect(history.map((row) => row.id)).toEqual(expect.arrayContaining(['ASSIGN-1', 'assign-1', 'Assign-1']))
  })
})
