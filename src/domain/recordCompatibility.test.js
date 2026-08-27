import { describe, expect, it } from 'vitest'
import {
  clockMinuteOfDay,
  normalizeClock,
  resolveRecordEmployee,
} from './recordCompatibility'

describe('record compatibility rules', () => {
  it.each([
    ['0:00', '00:00', 0],
    ['8:30', '08:30', 510],
    ['9:05', '09:05', 545],
    ['08:30', '08:30', 510],
    ['23:59', '23:59', 1439],
  ])('normalizes legacy clock %s', (input, normalized, minuteOfDay) => {
    expect(normalizeClock(input)).toBe(normalized)
    expect(clockMinuteOfDay(input)).toBe(minuteOfDay)
  })

  it.each(['24:00', '8:3', '08:60', '', 'invalid', '08:30:00', null, 830, {}, []])(
    'rejects malformed or non-string clock %j',
    (input) => {
      expect(normalizeClock(input)).toBe('')
      expect(clockMinuteOfDay(input)).toBeNull()
    },
  )

  it('resolves employeeId and employeeCode aliases without assuming they are equal', () => {
    const employees = [
      { id: 'E01', employeeId: 'EMP-01', code: 'CODE-01', employeeCode: 'LEGACY-01' },
      { id: 'E02', employeeCode: 'LEGACY-02' },
    ]
    expect(resolveRecordEmployee({ employeeId: 'E01' }, employees)).toMatchObject({ status: 'resolved', employee: employees[0] })
    expect(resolveRecordEmployee({ employeeCode: 'LEGACY-01' }, employees)).toMatchObject({ status: 'resolved', employee: employees[0] })
    expect(resolveRecordEmployee({ employeeId: 'EMP-01', employeeCode: 'CODE-01' }, employees))
      .toMatchObject({ status: 'resolved', employee: employees[0] })
    expect(resolveRecordEmployee({ employeeId: 'E01', employeeCode: 'LEGACY-02' }, employees))
      .toMatchObject({ status: 'conflict', employee: null })
    expect(resolveRecordEmployee({ employeeCode: 'UNKNOWN' }, employees)).toMatchObject({ status: 'unknown', employee: null })
  })

  it('fails closed when an employee alias is duplicated', () => {
    const employees = [{ id: 'E01', employeeCode: 'DUP' }, { id: 'E02', code: 'DUP' }]
    expect(resolveRecordEmployee({ employeeCode: 'DUP' }, employees))
      .toMatchObject({ status: 'ambiguous', code: 'EMPLOYEE_IDENTIFIER_AMBIGUOUS', employee: null })
  })
})
