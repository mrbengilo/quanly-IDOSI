import { cleanup, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { OrderAuditPage } from './GovernancePages'

vi.mock('../../state/AppContext', () => ({
  useApp: () => ({
    stores: [{ id: 'CH001', name: 'SecondMall SM234' }],
    orderAudit: [{
      id: 'ODA-1',
      action: 'Sửa',
      orderCode: 'DH-001',
      storeId: 'CH001',
      actor: { name: 'Nhân viên hỗ trợ', role: 'business_support' },
      createdAt: '2026-08-18T14:05:06+07:00',
      reason: 'Cập nhật thông tin khách',
      changedFields: ['customerName', 'customerPhone', 'customerAge', 'amount', 'paymentMethod'],
      before: { customerName: 'Khách cũ', customerPhone: '0900000000', customerAge: 24, amount: 2000, paymentMethod: 'Tiền mặt' },
      after: { customerName: 'Khách mới', customerPhone: '0911111111', customerAge: 25, amount: 3500, paymentMethod: 'Chuyển khoản' },
      revenueBefore: 2000,
      revenueAfter: 3500,
    }],
  }),
}))

describe('OrderAuditPage', () => {
  afterEach(cleanup)

  it('shows before and after values for every changed order field', () => {
    render(<MemoryRouter><OrderAuditPage /></MemoryRouter>)

    const expectations = [
      ['Tên khách hàng', 'Khách cũ', 'Khách mới'],
      ['Số điện thoại', '0900000000', '0911111111'],
      ['Tuổi', '24', '25'],
      ['Số tiền', '2,000 đ', '3,500 đ'],
      ['Phương thức thanh toán', 'Tiền mặt', 'Chuyển khoản'],
    ]
    expectations.forEach(([label, before, after]) => {
      const change = screen.getByText(label).closest('.audit-change-item')
      expect(change).toBeTruthy()
      expect(within(change).getByText(before)).toBeTruthy()
      expect(within(change).getByText(after)).toBeTruthy()
    })
  })
})
