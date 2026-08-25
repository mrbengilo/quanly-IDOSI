import { describe, expect, it } from 'vitest'
import {
  activeOccupationLabels,
  DEFAULT_ORDER_INFORMATION_OPTIONS,
  findOccupationOption,
  normalizeOrderInformationOptions,
  occupationValueAllowed,
  ORDER_PAYMENT_METHODS,
  validateOrderInformationOptionInput,
} from './orderInformationSettings'

describe('order information settings', () => {
  it('provides stable production defaults and exactly two payment methods', () => {
    expect(DEFAULT_ORDER_INFORMATION_OPTIONS).toHaveLength(15)
    expect(ORDER_PAYMENT_METHODS).toEqual(['Tiền mặt', 'Chuyển khoản'])
    expect(activeOccupationLabels(undefined)).toContain('Nhân viên VP')
  })

  it('hides inactive occupations for new orders while preserving legacy reads', () => {
    const options = DEFAULT_ORDER_INFORMATION_OPTIONS.map((option) => (
      option.label === 'Kỹ sư' ? { ...option, active: false, deletedAt: '2026-08-25T10:00:00+07:00' } : option
    ))
    expect(activeOccupationLabels(options)).not.toContain('Kỹ sư')
    expect(findOccupationOption(options, 'Kỹ sư')).toMatchObject({ label: 'Kỹ sư', active: false })
    expect(occupationValueAllowed({ options, value: 'Kỹ sư' })).toBe(false)
    expect(occupationValueAllowed({ options, value: 'Kỹ sư', previousValue: 'Kỹ sư', allowUnchangedInactive: true })).toBe(true)
    expect(occupationValueAllowed({ options, value: 'Nghề legacy', previousValue: 'Nghề legacy', allowUnchangedInactive: true })).toBe(true)
    expect(occupationValueAllowed({ options, value: 'Nghề legacy' })).toBe(false)
    expect(occupationValueAllowed({ options, value: 'Nghề legacy khác', previousValue: 'Nghề legacy', allowUnchangedInactive: true })).toBe(false)
  })

  it('normalizes labels, sorts options and rejects duplicate names or codes', () => {
    const options = normalizeOrderInformationOptions([
      { id: 'b', kind: 'occupation', code: 'OCC-B', label: '  Bác sĩ  ', sortOrder: 200 },
      { id: 'a', kind: 'occupation', code: 'OCC-A', label: 'Kỹ sư', sortOrder: 100 },
    ])
    expect(options.map(({ label }) => label)).toEqual(['Kỹ sư', 'Bác sĩ'])
    expect(validateOrderInformationOptionInput({ label: '  kỹ sư ', code: 'OCC-C' }, options)).toMatch(/tồn tại/u)
    expect(validateOrderInformationOptionInput({ label: 'Giáo viên', code: 'OCC-A' }, options)).toMatch(/tồn tại/u)
    expect(validateOrderInformationOptionInput({ label: 'Giáo viên', code: 'OCC-C' }, options)).toBe('')
  })
})
