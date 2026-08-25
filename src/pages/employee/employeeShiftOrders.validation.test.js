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
})
