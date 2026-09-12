import { describe, expect, it } from 'vitest'
import { resolveOrderCustomFields } from './orderCustomFields'

const options = [
  { id: 'SIZE', kind: 'custom_field', code: 'ATTR-001', label: 'Kích cỡ', fieldType: 'select', choices: ['S', 'M'], required: true, active: true },
  { id: 'GIFT', kind: 'custom_field', code: 'ATTR-002', label: 'Gói quà', fieldType: 'boolean', required: false, active: true },
  { id: 'OLD', kind: 'custom_field', code: 'ATTR-003', label: 'Thuộc tính cũ', fieldType: 'text', required: false, active: false, deletedAt: '2026-09-01' },
]

describe('order custom fields', () => {
  it('validates configured fields and snapshots their definitions', () => {
    expect(resolveOrderCustomFields({
      options,
      values: [{ fieldId: 'SIZE', value: 'M' }, { fieldId: 'GIFT', value: 'false' }],
    })).toEqual({
      values: [
        { fieldId: 'SIZE', fieldCode: 'ATTR-001', fieldLabel: 'Kích cỡ', fieldType: 'select', value: 'M' },
        { fieldId: 'GIFT', fieldCode: 'ATTR-002', fieldLabel: 'Gói quà', fieldType: 'boolean', value: false },
      ],
      error: '',
    })
  })

  it('requires active mandatory fields', () => {
    expect(resolveOrderCustomFields({ options, values: [] }).error).toBe('Vui lòng nhập Kích cỡ.')
  })

  it('keeps a legacy omission editable but does not let an existing required value be removed', () => {
    expect(resolveOrderCustomFields({
      options,
      values: [],
      previousValues: [],
      allowHistorical: true,
    })).toEqual({ values: [], error: '' })
    expect(resolveOrderCustomFields({
      options,
      values: [],
      previousValues: [{
        fieldId: 'SIZE', fieldCode: 'ATTR-001', fieldLabel: 'Kích cỡ', fieldType: 'select', value: 'M',
      }],
      allowHistorical: true,
    }).error).toBe('Vui lòng nhập Kích cỡ.')
  })

  it('preserves inactive historical values during an edit', () => {
    const previousValues = [{ fieldId: 'OLD', fieldCode: 'ATTR-003', fieldLabel: 'Thuộc tính cũ', fieldType: 'text', value: 'Giữ lại' }]
    expect(resolveOrderCustomFields({
      options,
      values: [{ fieldId: 'SIZE', value: 'S' }],
      previousValues,
      allowHistorical: true,
    }).values).toContainEqual(previousValues[0])
  })

  it('rejects normalized but impossible calendar dates', () => {
    const dateOptions = [{
      id: 'DELIVERY', kind: 'custom_field', code: 'ATTR-DATE', label: 'Ngày giao',
      fieldType: 'date', required: true, active: true,
    }]
    expect(resolveOrderCustomFields({
      options: dateOptions,
      values: [{ fieldId: 'DELIVERY', value: '2026-02-30' }],
    }).error).toBe('Ngày giao phải là ngày hợp lệ.')
  })
})
