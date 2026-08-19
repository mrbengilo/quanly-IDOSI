import { describe, expect, it } from 'vitest'
import { removeShiftAssignments, replaceShiftAssignees } from './scheduleAssignments'

const records = [
  { id: 'S1', employeeId: 'E1', shiftIds: ['CA1', 'CA2'], note: 'Ghi chú cũ' },
  { id: 'S2', employeeId: 'E2', shiftIds: ['CA2'], note: '' },
  { id: 'S3', employeeId: 'E3', shiftIds: ['CA3'], note: 'Giữ nguyên' },
]

describe('schedule assignment mutations', () => {
  it('replaces the employee list of one shift without changing other shifts', () => {
    expect(replaceShiftAssignees(records, 'CA2', ['E1', 'E3'], 'Ca hỗ trợ')).toEqual([
      { id: 'S1', employeeId: 'E1', shiftIds: ['CA1', 'CA2'], note: 'Ca hỗ trợ' },
      { id: 'S3', employeeId: 'E3', shiftIds: ['CA3', 'CA2'], note: 'Ca hỗ trợ' },
    ])
  })

  it('removes a shift and drops only employees left without assignments', () => {
    expect(removeShiftAssignments(records, 'CA2')).toEqual([
      { id: 'S1', employeeId: 'E1', shiftIds: ['CA1'], note: 'Ghi chú cũ' },
      { id: 'S3', employeeId: 'E3', shiftIds: ['CA3'], note: 'Giữ nguyên' },
    ])
  })
})
