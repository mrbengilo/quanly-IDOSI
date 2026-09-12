import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { OrderCustomFieldsEditor, OrderCustomFieldsSummary } from './OrderCustomFields'

const options = [
  { id: 'ATTR-SIZE', kind: 'custom_field', code: 'ATTR-001', label: 'Kích cỡ', fieldType: 'select', choices: ['S', 'M', 'L'], required: true, active: true },
  { id: 'ATTR-GIFT', kind: 'custom_field', code: 'ATTR-002', label: 'Gói quà', fieldType: 'boolean', required: false, active: true },
  { id: 'ATTR-NOTE', kind: 'custom_field', code: 'ATTR-003', label: 'Ghi chú rất dài không được che hoặc cắt mất thông tin', fieldType: 'text', required: false, active: true },
]

afterEach(cleanup)

describe('OrderCustomFields', () => {
  it('renders every active field and emits a compact controlled value list', () => {
    const onChange = vi.fn()
    render(<OrderCustomFieldsEditor
      options={options}
      value={[{ fieldId: 'ATTR-SIZE', value: 'M' }]}
      onChange={onChange}
    />)

    expect(screen.getByLabelText('Kích cỡ').value).toBe('M')
    expect(screen.getByLabelText('Gói quà').value).toBe('')
    expect(screen.getByLabelText('Ghi chú rất dài không được che hoặc cắt mất thông tin')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Gói quà'), { target: { value: 'false' } })
    expect(onChange).toHaveBeenLastCalledWith([
      { fieldId: 'ATTR-SIZE', value: 'M' },
      { fieldId: 'ATTR-GIFT', value: 'false' },
    ])
  })

  it('shows complete labels and formatted values in the order snapshot summary', () => {
    render(<OrderCustomFieldsSummary values={[
      { fieldId: 'ATTR-SIZE', fieldLabel: 'Kích cỡ đầy đủ', fieldType: 'select', value: 'XL' },
      { fieldId: 'ATTR-GIFT', fieldLabel: 'Gói quà', fieldType: 'boolean', value: false },
      { fieldId: 'ATTR-DATE', fieldLabel: 'Ngày giao', fieldType: 'date', value: '2026-09-12' },
    ]} />)
    expect(screen.getByText('Kích cỡ đầy đủ')).toBeTruthy()
    expect(screen.getByText('XL')).toBeTruthy()
    expect(screen.getByText('Không')).toBeTruthy()
    expect(screen.getByText('12/09/2026')).toBeTruthy()
  })
})
