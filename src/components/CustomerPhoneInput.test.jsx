import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { CustomerNameInput, CustomerPhoneInput, CustomerPurchaseStatus } from './CustomerPhoneInput'
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
  mocked.read.mockResolvedValue({ suggestions: [{ key: 'phone:0901234567', customerName: 'Nguyễn Ánh', customerPhone: '0901234567', hasPurchaseHistory: true }] })
  const change = vi.fn()
  const view = render(<CustomerPhoneInput app={mocked.app} storeId="S1" value="0" onChange={change} />)
  expect(mocked.read).not.toHaveBeenCalled()
  view.rerender(<CustomerPhoneInput app={mocked.app} storeId="S1" value="090" onChange={change} />)
  await waitFor(() => expect(mocked.read).toHaveBeenCalledWith(expect.objectContaining({ storeId: 'S1', mode: 'suggest', query: '090' })))
  fireEvent.focus(screen.getByRole('combobox'))
  expect(await screen.findByRole('option', { name: /Nguyễn Ánh.*0901234567.*KH cũ/ })).toBeTruthy()
  fireEvent.change(screen.getByRole('combobox'), { target: { value: '0901234567' } })
  expect(change).toHaveBeenCalled()
  view.rerender(<CustomerPhoneInput app={mocked.app} storeId="S2" value="090" onChange={change} />)
  expect(screen.queryByRole('option')).toBeNull()
})

it('suggests unaccented names with keyboard selection, Escape dismissal, and manual input', () => {
  const select = vi.fn(), change = vi.fn()
  const app = { ...mocked.app, orders: [{ id: 'O1', storeId: 'S1', customerName: 'Đặng Ánh', customerPhone: '0901234567' }] }
  render(<CustomerNameInput app={app} storeId="S1" value="dang" onChange={change} onSelect={select} />)
  const input = screen.getByRole('combobox')
  fireEvent.focus(input)
  expect(screen.getByRole('option', { name: /Đặng Ánh.*KH cũ/ })).toBeTruthy()
  fireEvent.keyDown(input, { key: 'ArrowDown' })
  expect(input.getAttribute('aria-activedescendant')).toBeTruthy()
  fireEvent.keyDown(input, { key: 'Enter' })
  expect(select).toHaveBeenCalledWith(expect.objectContaining({ customerName: 'Đặng Ánh', customerPhone: '0901234567' }))
  expect(screen.queryByRole('listbox')).toBeNull()
  fireEvent.focus(input)
  fireEvent.keyDown(input, { key: 'Escape' })
  expect(screen.queryByRole('listbox')).toBeNull()
  fireEvent.change(input, { target: { value: 'Khách mới' } })
  expect(change).toHaveBeenCalled()
})

it('prioritizes an exact phone over a matching name and recomputes status on store/input changes', () => {
  const app = { ...mocked.app, orders: [{ id: 'O1', storeId: 'S1', customerName: 'Đặng Ánh', customerPhone: '0901234567' }] }
  const view = render(<CustomerPurchaseStatus app={app} storeId="S1" customerName="dang anh" phone="" />)
  expect(screen.getByText('KH cũ')).toBeTruthy()
  view.rerender(<CustomerPurchaseStatus app={app} storeId="S1" customerName="dang" phone="" />)
  expect(screen.queryByText('KH mới')).toBeNull()
  expect(screen.getByText(/Có khách hàng phù hợp/)).toBeTruthy()
  view.rerender(<CustomerPurchaseStatus app={app} storeId="S1" customerName="dang anh" phone="0999999999" />)
  expect(screen.getByText('KH mới')).toBeTruthy()
  view.rerender(<CustomerPurchaseStatus app={app} storeId="S1" customerName="Tên khác" phone="090 123 4567" />)
  expect(screen.getByText('KH cũ')).toBeTruthy()
  view.rerender(<CustomerPurchaseStatus app={app} storeId="S2" customerName="Đặng Ánh" phone="0901234567" />)
  expect(screen.getByText('KH cũ')).toBeTruthy()
  view.rerender(<CustomerPurchaseStatus app={app} storeId="S1" customerName="" phone="" />)
  expect(screen.queryByText(/KH (cũ|mới)/)).toBeNull()
})

it('does not label a customer new while loading, after an error, or from an outdated response', async () => {
  const app = { ...mocked.app, apiStatus: 'connected' }
  let resolveOld
  mocked.read.mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve }))
    .mockRejectedValueOnce(new Error('Mất kết nối'))
    .mockResolvedValue({ hasPurchaseHistory: false })
  const view = render(<CustomerPurchaseStatus app={app} storeId="S1" customerName="Ánh" phone="0901234567" />)
  expect(screen.queryByText('KH mới')).toBeNull()
  await waitFor(() => expect(mocked.read).toHaveBeenCalledTimes(1))
  view.rerender(<CustomerPurchaseStatus app={app} storeId="S2" customerName="Ánh" phone="0901234567" />)
  expect(await screen.findByText(/Chưa xác định loại khách hàng: Mất kết nối/)).toBeTruthy()
  resolveOld({ hasPurchaseHistory: true })
  expect(screen.queryByText('KH cũ')).toBeNull()
  expect(screen.queryByText('KH mới')).toBeNull()
  view.rerender(<CustomerPurchaseStatus app={app} storeId="S2" customerName="Ánh" phone="0999999999" />)
  expect(await screen.findByText('KH mới')).toBeTruthy()
})

it('fills a customer purchased only at another store into the create dialog as KH cũ without saving', () => {
  const employee = { id: 'E1', name: 'Employee', storeId: 'S1' }
  mocked.app = { ...mocked.app, activeStoreId: 'S1', currentEmployee: employee, employees: [employee],
    session: { role: 'employee', employeeId: 'E1', storeId: 'S1' },
    orders: [{ id: 'O1', storeId: 'S2', customerName: 'Đặng Ánh', customerPhone: '0901234567' }],
    stores: [{ id: 'S1', name: 'Home' }], attendance: [{ id: 'A1', employeeId: 'E1', storeId: 'S1', checkInAt: '2026-10-30T08:00:00+07:00', date: '2026-10-30' }],
    createOrder: vi.fn(), notify: vi.fn() }
  render(<MemoryRouter><EmployeeOrdersPage /></MemoryRouter>)
  fireEvent.click(screen.getByRole('button', { name: /Tạo đơn hàng/i }))
  const name = screen.getByRole('combobox', { name: /Tên khách hàng/ })
  fireEvent.change(name, { target: { value: 'dang' } })
  fireEvent.click(screen.getByRole('option', { name: /Đặng Ánh/ }))
  expect(name.value).toBe('Đặng Ánh')
  expect(screen.getByRole('combobox', { name: /Số điện thoại/ }).value).toBe('0901234567')
  expect(screen.getByText('KH cũ')).toBeTruthy()
  expect(mocked.app.createOrder).not.toHaveBeenCalled()
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
