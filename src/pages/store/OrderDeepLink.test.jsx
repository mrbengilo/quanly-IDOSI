import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
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

function CurrentRoute() {
  const location = useLocation()
  return <output data-testid="current-route">{location.pathname}{location.search}</output>
}

describe('order notification deep links', () => {
  it('reveals and highlights the requested order in the store view', () => {
    mocked.app = {
      session: { role: 'manager' },
      activeStoreId: 'S02',
      stores: [{ id: 'S01', name: 'Cửa hàng 01' }, { id: 'S02', name: 'Cửa hàng 02' }],
      orders: [targetOrder],
      employees: [{ id: 'E01', storeId: 'S01', name: 'Nhân viên 01' }],
      updateOrder: vi.fn(),
      deleteOrder: vi.fn(),
      notify: vi.fn(),
    }
    render(<MemoryRouter initialEntries={['/store/orders?store=S01&order=ORDER-TARGET']}><StoreOrdersPage /></MemoryRouter>)

    expect(screen.getByText('S01-00002').closest('tr')?.classList.contains('order-row--highlight')).toBe(true)
  })

  it('corrects a stale store query and never mixes another store\'s orders into the requested order view', async () => {
    const otherStoreOrder = {
      ...targetOrder,
      id: 'ORDER-OTHER',
      code: 'S02-00001',
      storeId: 'S02',
      employeeId: 'E02',
      customerName: 'Khách cửa hàng 02',
    }
    mocked.app = {
      session: { role: 'admin' },
      activeStoreId: 'S02',
      stores: [{ id: 'S01', name: 'Cửa hàng 01' }, { id: 'S02', name: 'Cửa hàng 02' }],
      orders: [otherStoreOrder, targetOrder],
      employees: [
        { id: 'E01', storeId: 'S01', name: 'Nhân viên 01' },
        { id: 'E02', storeId: 'S02', name: 'Nhân viên 02' },
      ],
      updateOrder: vi.fn(),
      deleteOrder: vi.fn(),
      notify: vi.fn(),
    }
    render(
      <MemoryRouter initialEntries={['/store/orders?store=S02&order=ORDER-TARGET']}>
        <StoreOrdersPage />
        <CurrentRoute />
      </MemoryRouter>,
    )

    expect(screen.getByText('S01-00002')).toBeTruthy()
    expect(screen.queryByText('S02-00001')).toBeNull()
    await waitFor(() => expect(screen.getByTestId('current-route').textContent).toBe('/store/orders?store=S01&order=ORDER-TARGET'))
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

  it('blocks employee order creation until an attendance shift is open', () => {
    const notify = vi.fn()
    mocked.app = {
      currentEmployee: { id: 'E01', storeId: 'S01', name: 'Nhân viên 01' },
      orders: [],
      attendance: [],
      createOrder: vi.fn(),
      notify,
    }
    render(<MemoryRouter initialEntries={['/employee/orders']}><EmployeeOrdersPage /></MemoryRouter>)

    const createButton = screen.getByRole('button', { name: 'TẠO ĐƠN HÀNG' })
    expect(createButton.disabled).toBe(true)
    expect(screen.getByText('Bạn chưa có ca đang mở. Hãy điểm danh vào ca trước khi tạo đơn hàng.')).toBeTruthy()
    createButton.click()
    expect(mocked.app.createOrder).not.toHaveBeenCalled()
  })

  it('enables employee order creation during an open attendance shift', () => {
    mocked.app = {
      currentEmployee: { id: 'E01', storeId: 'S01', name: 'Nhân viên 01' },
      orders: [],
      attendance: [{ id: 'ATT-01', employeeId: 'E01', shift: 'CA-01', shiftName: 'Ca sáng', checkIn: '08:00' }],
      createOrder: vi.fn(),
      notify: vi.fn(),
    }
    render(<MemoryRouter initialEntries={['/employee/orders']}><EmployeeOrdersPage /></MemoryRouter>)

    expect(screen.getByRole('button', { name: 'TẠO ĐƠN HÀNG' }).disabled).toBe(false)
  })

  it('shows edit and delete order controls to Business Support', () => {
    mocked.app = {
      session: { role: 'business_support' },
      activeStoreId: 'S01',
      stores: [{ id: 'S01', name: 'Cửa hàng 01' }],
      orders: [targetOrder],
      employees: [{ id: 'E01', storeId: 'S01', name: 'Nhân viên 01' }],
      updateOrder: vi.fn(),
      deleteOrder: vi.fn(),
      notify: vi.fn(),
    }
    render(<MemoryRouter initialEntries={['/store/orders']}><StoreOrdersPage /></MemoryRouter>)

    expect(screen.getByRole('button', { name: /^Sửa$/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /^Xóa$/i })).toBeTruthy()
  })
})
