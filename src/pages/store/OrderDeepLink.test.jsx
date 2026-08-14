import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EmployeeOrdersPage } from '../employee/EmployeeV2Pages'
import { StoreOrdersPage } from './StoreV2Pages'

const mocked = vi.hoisted(() => ({ app: {} }))

vi.mock('../../state/AppContext', () => ({
  useApp: () => mocked.app,
}))

afterEach(cleanup)

const targetOrder = {
  id: 'ORDER-TARGET',
  code: 'S01-00002',
  storeId: 'S01',
  employeeId: 'E01',
  employeeName: 'Nhân viên 01',
  customerName: 'Khách mục tiêu',
  amount: 2_000_000,
  paymentMethod: 'Chuyển khoản',
  status: 'Hoàn tất',
  createdAt: '2026-08-14T08:30:00+07:00',
}

describe('order notification deep links', () => {
  it('reveals and highlights the requested order in the store view', () => {
    mocked.app = {
      session: { role: 'manager' },
      activeStoreId: 'S01',
      stores: [{ id: 'S01', name: 'Cửa hàng 01' }],
      orders: [targetOrder],
      employees: [{ id: 'E01', storeId: 'S01', name: 'Nhân viên 01' }],
      updateOrder: vi.fn(),
      deleteOrder: vi.fn(),
      notify: vi.fn(),
    }
    render(<MemoryRouter initialEntries={['/store/orders?order=ORDER-TARGET']}><StoreOrdersPage /></MemoryRouter>)

    expect(screen.getByText('S01-00002').closest('tr')?.classList.contains('order-row--highlight')).toBe(true)
  })

  it('highlights the requested own order in the employee view', () => {
    mocked.app = {
      currentEmployee: { id: 'E01', storeId: 'S01', name: 'Nhân viên 01' },
      orders: [targetOrder],
      attendance: [],
      createOrder: vi.fn(),
      notify: vi.fn(),
    }
    render(<MemoryRouter initialEntries={['/employee/orders?order=ORDER-TARGET']}><EmployeeOrdersPage /></MemoryRouter>)

    expect(screen.getByText('S01-00002').closest('tr')?.classList.contains('order-row--highlight')).toBe(true)
  })
})
