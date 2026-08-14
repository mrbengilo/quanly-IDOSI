import { describe, expect, it } from 'vitest'
import { employeeTasksForDate, taskCompletedByEmployee } from './taskScope'

describe('employee task scope', () => {
  const employee = { id: 'NV001', storeId: 'CH001' }
  const workDate = '2026-08-14'

  it('shows only tasks for the exact date, store, and assigned or open shift', () => {
    const visible = employeeTasksForDate({
      employee,
      workDate,
      schedule: [{ employeeId: 'NV001', storeId: 'CH001', date: workDate, shiftIds: ['morning'] }],
      attendance: [{ employeeId: 'NV001', storeId: 'CH001', date: workDate, shift: 'evening', checkOut: '' }],
      tasks: [
        { id: 'assigned', storeId: 'CH001', date: workDate, shiftId: 'morning' },
        { id: 'open', storeId: 'CH001', date: workDate, shiftId: 'evening' },
        { id: 'wrong-date', storeId: 'CH001', date: '2026-08-13', shiftId: 'morning' },
        { id: 'wrong-store', storeId: 'CH002', date: workDate, shiftId: 'morning' },
        { id: 'wrong-shift', storeId: 'CH001', date: workDate, shiftId: 'night' },
        { id: 'missing-date', storeId: 'CH001', shiftId: 'morning', createdAt: `${workDate}T09:00:00+07:00` },
        { id: 'other-employee', storeId: 'CH001', date: workDate, shiftId: 'morning', employeeId: 'NV002' },
      ],
    })

    expect(visible.map((task) => task.id)).toEqual(['assigned', 'open'])
  })

  it('uses per-employee completion instead of the shared done flag', () => {
    const task = { done: true, completedBy: { NV001: false, NV002: true } }

    expect(taskCompletedByEmployee(task, 'NV001')).toBe(false)
    expect(taskCompletedByEmployee(task, 'NV002')).toBe(true)
  })
})
