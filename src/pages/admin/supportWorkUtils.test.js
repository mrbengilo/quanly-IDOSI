import { describe, expect, it } from 'vitest'
import { supportWorkEvaluation, supportWorkProgress, supportWorkStatus } from './supportWorkUtils'

describe('support work helpers', () => {
  it('computes progress and Vietnamese statuses from the persisted assignment contract', () => {
    expect(supportWorkProgress({ tasks: [{ completed: true }, { completed: false }] })).toEqual({
      total: 2,
      completed: 1,
      remaining: 1,
      rate: 50,
    })
    expect(supportWorkStatus('in_progress')).toEqual({ label: 'Đang thực hiện', tone: 'orange' })
    expect(supportWorkStatus('incomplete')).toEqual({ label: 'Chưa hoàn thành', tone: 'red' })
  })

  it('evaluates each support employee only from their own assigned work', () => {
    const evaluation = supportWorkEvaluation({ id: 'HTKD-001' }, [
      { employeeId: 'HTKD-001', status: 'completed', submittedAt: '2026-08-18T09:00:00+07:00', tasks: [{ completed: true }, { completed: true }] },
      { employeeId: 'HTKD-001', status: 'incomplete', submittedAt: '2026-08-18T09:10:00+07:00', tasks: [{ completed: true }, { completed: false }] },
      { employeeId: 'HTKD-002', status: 'completed', submittedAt: '2026-08-18T09:15:00+07:00', tasks: [{ completed: true }] },
    ])

    expect(evaluation).toMatchObject({
      total: 4,
      completed: 3,
      submitted: 2,
      completedAssignments: 1,
      incompleteAssignments: 1,
      rate: 75,
      rating: 'Cần cải thiện',
    })
  })

  it('does not award completion for checked work that has only been saved as progress', () => {
    const evaluation = supportWorkEvaluation({ id: 'HTKD-001' }, [{
      employeeId: 'HTKD-001',
      status: 'in_progress',
      submittedAt: null,
      tasks: [{ completed: true }, { completed: true }],
    }])

    expect(evaluation).toMatchObject({
      total: 2,
      completed: 0,
      submitted: 0,
      pending: 1,
      rate: 0,
      rating: 'Chưa nộp',
    })
  })

  it('uses an exact employee id before aliases and rejects an ambiguous mixed-case alias', () => {
    const assignments = [
      { employeeId: 'EM01', status: 'completed', tasks: [{ completed: true }] },
      { employeeId: 'em01', status: 'incomplete', tasks: [{ completed: false }] },
    ]

    expect(supportWorkEvaluation({ id: 'EM01' }, assignments)).toMatchObject({
      total: 1,
      completed: 1,
      completedAssignments: 1,
    })
    expect(supportWorkEvaluation({ id: 'Em01' }, assignments)).toMatchObject({ rows: [], total: 0 })
  })
})
