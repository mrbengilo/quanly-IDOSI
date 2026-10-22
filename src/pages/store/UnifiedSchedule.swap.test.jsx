import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import UnifiedSchedule from './UnifiedSchedule'
import { vietnamScheduleDate } from './scheduleView'

const mocked = vi.hoisted(() => ({ app: {} }))
vi.mock('../../state/AppContext', () => ({ useApp: () => mocked.app }))
const fixture = () => {
  const shifts = [['AM', '08:00', '12:00'], ['PM', '12:00', '16:00'], ['EV', '16:00', '20:00']]
    .map(([id, start, end]) => ({ id, name: `Ca ${id}`, start, end, storeId: 'STORE', active: true }))
  return { session: { role: 'store_manager', storeId: 'STORE' }, activeStoreId: 'STORE', activeStore: { id: 'STORE', name: 'Fixture' },
    stores: [{ id: 'STORE', name: 'Fixture' }], employees: ['A', 'B'].map((id) => ({ id, code: `CODE-${id}`, name: `Nhân viên ${id}`, storeId: 'STORE', unit: 'store', status: 'Đang làm việc' })),
    schedule: ['A', 'B'].map((employeeId, index) => ({ id: `ASS-${employeeId}`, employeeId, storeId: 'STORE', date: vietnamScheduleDate(),
      shiftIds: [shifts[index].id], shiftSnapshots: [shifts[index]] })), shiftDefinitions: shifts,
    supportTransfers: [], attendance: [], notify: vi.fn(), swapScheduleShifts: vi.fn().mockResolvedValue({ ok: true }) }
}
const open = () => { const view = render(<MemoryRouter><UnifiedSchedule /></MemoryRouter>); fireEvent.click(screen.getByRole('tab', { name: 'Đổi ca' })); return view }
const choose = () => {
  fireEvent.change(screen.getByLabelText('Chọn nhân viên A'), { target: { value: 'A' } })
  fireEvent.change(screen.getByLabelText('Chọn nhân viên B'), { target: { value: 'B' } })
}
beforeEach(() => { mocked.app = fixture() })
afterEach(cleanup)

it.each(['admin', 'business_support', 'store_manager'])('shows swap tab for %s', (role) => {
  mocked.app.session.role = role; open(); expect(screen.getByRole('tabpanel')).toBeTruthy()
})
it.each(['employee', 'manager', 'viewer'])('does not expose swap for %s', (role) => {
  mocked.app.session.role = role; render(<MemoryRouter><UnifiedSchedule /></MemoryRouter>)
  expect(screen.queryByRole('tab', { name: 'Đổi ca' })).toBeNull()
})
it('selects a sole shift visibly, excludes A from B and previews both changes', () => {
  open(); expect(screen.getByRole('button', { name: 'Đổi ca' }).disabled).toBe(true)
  choose()
  expect(screen.getByLabelText('Ca cần đổi của A').value).toBe('["ASS-A","AM"]')
  expect(within(screen.getByLabelText('Chọn nhân viên B')).queryByRole('option', { name: 'Nhân viên A · CODE-A' })).toBeNull()
  expect(screen.getByLabelText('Kết quả sau khi đổi').textContent).toContain('Ca AM · 08:00 - 12:00 → Ca PM · 12:00 - 16:00')
  expect(screen.getByRole('button', { name: 'Đổi ca' }).disabled).toBe(false)
})
it('requires explicit selection for multiple eligible shifts', () => {
  mocked.app.schedule[0].shiftIds.push('EV'); mocked.app.schedule[0].shiftSnapshots.push(mocked.app.shiftDefinitions[2])
  open(); choose()
  expect(screen.getByLabelText('Ca cần đổi của A').value).toBe('')
  expect(screen.getByRole('button', { name: 'Đổi ca' }).disabled).toBe(true)
  fireEvent.change(screen.getByLabelText('Ca cần đổi của A'), { target: { value: '["ASS-A","EV"]' } })
  expect(screen.getByRole('button', { name: 'Đổi ca' }).disabled).toBe(false)
})
it('resets dependent selections on employee/date/store changes', () => {
  const view = open(); choose()
  fireEvent.change(screen.getByLabelText('Chọn nhân viên A'), { target: { value: 'B' } })
  expect(screen.getByLabelText('Chọn nhân viên B').value).toBe('')
  fireEvent.change(screen.getByLabelText('Ngày phân ca'), { target: { value: '2027-01-01' } })
  expect(screen.getByLabelText('Chọn nhân viên A').value).toBe('')
  mocked.app = { ...fixture(), session: { role: 'admin' }, activeStoreId: 'OTHER', activeStore: { id: 'OTHER' } }
  view.rerender(<MemoryRouter><UnifiedSchedule /></MemoryRouter>)
  expect(screen.getByLabelText('Chọn nhân viên A').value).toBe('')
})
it('sends one command, waits for server and ignores old completion after a date change', async () => {
  let finish; mocked.app.swapScheduleShifts.mockImplementation(() => new Promise((resolve) => { finish = resolve }))
  open(); choose(); const button = screen.getByRole('button', { name: 'Đổi ca' })
  fireEvent.click(button); fireEvent.click(button)
  expect(mocked.app.swapScheduleShifts).toHaveBeenCalledTimes(1)
  expect(button.disabled).toBe(true)
  expect(screen.queryByText(/Đã đổi ca thành công/)).toBeNull()
  fireEvent.change(screen.getByLabelText('Ngày phân ca'), { target: { value: '2027-01-01' } })
  await act(async () => finish({ ok: true }))
  expect(screen.queryByText(/Đã đổi ca thành công/)).toBeNull()
  expect(screen.getByLabelText('Chọn nhân viên A').value).toBe('')
})
it('keeps the idempotency key on network retry and resets selection after success', async () => {
  mocked.app.swapScheduleShifts.mockResolvedValueOnce({ ok: false, message: 'Mất kết nối' }).mockResolvedValueOnce({ ok: true })
  open(); choose()
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Đổi ca' })))
  expect(screen.getByRole('alert').textContent).toContain('Mất kết nối')
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Đổi ca' })))
  expect(mocked.app.swapScheduleShifts.mock.calls[0]).toEqual(mocked.app.swapScheduleShifts.mock.calls[1])
  expect(screen.getByText(/Đã đổi ca thành công/)).toBeTruthy()
  expect(screen.getByLabelText('Chọn nhân viên A').value).toBe('')
})
it('clears stale intent after version conflict and shows its error', async () => {
  mocked.app.swapScheduleShifts.mockResolvedValue({ ok: false, code: 'VERSION_CONFLICT', message: 'Lịch phân ca đã thay đổi, vui lòng kiểm tra lại.' })
  open(); choose()
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Đổi ca' })))
  expect(screen.getByRole('alert').textContent).toContain('Lịch phân ca đã thay đổi')
  expect(screen.getByLabelText('Chọn nhân viên A').value).toBe('')
})
it('shows locked-shift reason and never chooses it', () => {
  mocked.app.attendance = [{ employeeId: 'A', storeId: 'STORE', date: vietnamScheduleDate(), shiftId: 'AM' }]
  open(); choose()
  expect(screen.getByText(/Ca đã phát sinh điểm danh/)).toBeTruthy()
  expect(screen.getByLabelText('Ca cần đổi của A').value).toBe('')
  expect(screen.getByRole('button', { name: 'Đổi ca' }).disabled).toBe(true)
})
