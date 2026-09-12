import { describe, expect, it } from 'vitest'
import { DEFAULT_ORDER_INFORMATION_OPTIONS } from '../../domain/orderInformationSettings'
import { validateEmployeeOrder } from './employeeShiftOrders'

const validForm = {
  customerName: 'Khách hàng',
  amount: 35,
  gender: 'Nam',
  occupation: 'Kỹ sư',
  acquisitionChannel: 'Facebook',
  paymentMethod: 'Tiền mặt',
  items: [{ productId: 'order-product-001', quantity: 2 }],
}

describe('validateEmployeeOrder', () => {
  it('accepts active production options and exact payment methods', () => {
    expect(validateEmployeeOrder(validForm, { occupationOptions: DEFAULT_ORDER_INFORMATION_OPTIONS })).toEqual({})
  })

  it('rejects placeholders, inactive occupations and a third payment method', () => {
    const options = DEFAULT_ORDER_INFORMATION_OPTIONS.map((option) => (
      option.label === 'Kỹ sư' ? { ...option, active: false, deletedAt: '2026-08-25T00:00:00+07:00' } : option
    ))
    expect(validateEmployeeOrder({ ...validForm, paymentMethod: '', occupation: 'Kỹ sư' }, { occupationOptions: options }))
      .toMatchObject({ occupation: expect.any(String), paymentMethod: expect.any(String) })
    expect(validateEmployeeOrder({ ...validForm, paymentMethod: 'Ví điện tử' }, { occupationOptions: options }))
      .toMatchObject({ paymentMethod: expect.any(String) })
  })

  it('requires a selected product and a positive integer quantity', () => {
    expect(validateEmployeeOrder({ ...validForm, items: [] }, { occupationOptions: DEFAULT_ORDER_INFORMATION_OPTIONS }))
      .toMatchObject({ items: expect.any(String) })
    expect(validateEmployeeOrder({
      ...validForm,
      items: [{ productId: 'order-product-001', quantity: 1.5 }],
    }, { occupationOptions: DEFAULT_ORDER_INFORMATION_OPTIONS })).toMatchObject({ items: expect.any(String) })
  })

  it('validates required Admin-configured order attributes', () => {
    const options = [...DEFAULT_ORDER_INFORMATION_OPTIONS, {
      id: 'ATTR-SIZE', kind: 'custom_field', code: 'ATTR-001', label: 'Kích cỡ',
      fieldType: 'select', choices: ['S', 'M'], required: true, active: true,
    }]
    expect(validateEmployeeOrder({ ...validForm, customFields: [] }, { occupationOptions: options }))
      .toMatchObject({ customFields: 'Vui lòng nhập Kích cỡ.' })
    expect(validateEmployeeOrder({
      ...validForm,
      customFields: [{ fieldId: 'ATTR-SIZE', value: 'M' }],
    }, { occupationOptions: options })).toEqual({})
  })
})
