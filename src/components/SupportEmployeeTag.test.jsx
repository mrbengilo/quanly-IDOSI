import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { SupportEmployeeTag } from './SupportEmployeeTag'

const stores = [
  { id: 'HOME', name: 'Dosii Cần Thơ' },
  { id: 'SUPPORT', name: 'SM TNV' },
]
const employee = { id: 'EMP-01', name: 'Nhân viên A', storeId: 'HOME' }
const transfer = {
  id: 'TR-01', employeeId: employee.id, fromStoreId: 'HOME', toStoreId: 'SUPPORT',
  startAt: '2026-09-01T00:00:00+07:00', endAt: '2026-09-03T23:59:59+07:00',
  status: 'Hoàn tất',
}

const props = (businessDate) => ({
  record: {
    employeeId: employee.id,
    storeId: 'SUPPORT',
    businessDate,
    supportTransferId: transfer.id,
  },
  employee,
  employeeId: employee.id,
  storeId: 'SUPPORT',
  businessDate,
  employees: [employee],
  stores,
  supportTransfers: [transfer],
})

afterEach(cleanup)

describe('SupportEmployeeTag', () => {
  it('renders the standardized orange tag from 01/09/2026', () => {
    render(<SupportEmployeeTag {...props('2026-09-01')} />)

    const tag = screen.getByText('Nhân viên hỗ trợ • Từ Dosii Cần Thơ')
    expect(tag.className).toContain('badge--orange')
    expect(tag.closest('[data-support-employee-tag="true"]')).toBeTruthy()
  })

  it('does not label historical records before 01/09/2026', () => {
    render(<SupportEmployeeTag {...props('2026-08-31')} />)

    expect(screen.queryByText(/Nhân viên hỗ trợ/u)).toBeNull()
  })
})
