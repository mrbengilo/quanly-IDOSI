import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { CustomerPhoneInput } from './CustomerPhoneInput'
import { EmployeeOrdersPage } from '../pages/employee/EmployeeV2Pages'

const mocked = vi.hoisted(() => ({ app: {}, read: vi.fn() }))
vi.mock('../state/AppContext', () => ({ useApp: () => mocked.app }))
vi.mock('../services/idosiApi', () => ({ apiGetCustomerLookup: (...args) => mocked.read(...args) }))
beforeEach(() => {
  mocked.read.mockReset()
  mocked.app = { apiStatus: 'local', session: { role: 'employee', storeId: 'S1' }, orders: [] }
})
afterEach(cleanup)

it('only queries phone suggestions after two digits and preserves typing and selection', async () => {
  mocked.app.apiStatus = 'connected'
  mocked.read.mockResolvedValue({ suggestions: [{ customerPhone: '0901234567' }] })
  const change = vi.fn()
  const view = render(<CustomerPhoneInput app={mocked.app} storeId="S1" value="0" onChange={change} />)
  expect(mocked.read).not.toHaveBeenCalled()
  view.rerender(<CustomerPhoneInput app={mocked.app} storeId="S1" value="090" onChange={change} />)
  await waitFor(() => expect(mocked.read).toHaveBeenCalledWith(expect.objectContaining({ storeId: 'S1', mode: 'suggest', query: '090' })))
  await waitFor(() => expect(document.querySelector('datalist option')?.value).toBe('0901234567'))
  fireEvent.change(screen.getByRole('combobox'), { target: { value: '0901234567' } })
  expect(change).toHaveBeenCalled()
  view.rerender(<CustomerPhoneInput app={mocked.app} storeId="S2" value="090" onChange={change} />)
  expect(document.querySelector('datalist option')).toBeNull()
})

it('wires phone suggestions to the employee open support attendance store', async () => {
  const employee = { id: 'E1', name: 'Employee', storeId: 'S1' }
  mocked.app = { ...mocked.app, activeStoreId: 'S1', currentEmployee: employee, employees: [employee],
    session: { role: 'employee', employeeId: 'E1', storeId: 'S1' }, orders: [],
    stores: [{ id: 'S1', name: 'Home' }, { id: 'S2', name: 'Support' }],
    attendance: [{ id: 'A1', employeeId: 'E1', storeId: 'S2', checkInAt: '2026-10-30T08:00:00+07:00', date: '2026-10-30' }], notify: vi.fn() }
  mocked.read.mockResolvedValue({ suggestions: [{ customerPhone: '0999999999' }] })
  const view = render(<MemoryRouter><EmployeeOrdersPage /></MemoryRouter>)
  fireEvent.click(screen.getByRole('button', { name: /Tạo đơn hàng/i }))
  // Keep order creation local; only exercise the read request once the dialog is open.
  mocked.app.apiStatus = 'connected'
  view.rerender(<MemoryRouter><EmployeeOrdersPage /></MemoryRouter>)
  fireEvent.change(screen.getByRole('combobox', { name: /Số điện thoại/ }), { target: { value: '099' } })
  await waitFor(() => expect(mocked.read).toHaveBeenCalledWith(expect.objectContaining({ storeId: 'S2', mode: 'suggest', query: '099' })))
})
