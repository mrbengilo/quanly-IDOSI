import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { EmployeeSchedulePage } from './EmployeeSchedulePage'
import { today } from '../../utils'

const mocked = vi.hoisted(() => ({ app: {} }))
vi.mock('../../state/AppContext', () => ({ useApp: () => mocked.app }))

describe('EmployeeSchedulePage', () => {
  afterEach(cleanup)

  it('shows regular and support schedules with compensation in the selected month', () => {
    mocked.app = {
      session: { role: 'employee', employeeId: 'E01' },
      currentEmployee: { id: 'E01', name: 'Nguyễn An', storeId: 'S01' },
      stores: [{ id: 'S01', name: 'Dosii NTL' }, { id: 'S02', name: 'Dosii KVC' }],
      shiftDefinitions: [{ id: 'CA-1', name: 'Ca sáng', start: '08:00', end: '12:00' }],
      schedule: [{ id: 'SCH-1', employeeId: 'E01', storeId: 'S01', date: '2026-08-20', shiftIds: ['CA-1'] }],
      supportTransfers: [{ id: 'TR-1', employeeId: 'E01', toStoreId: 'S02', startAt: '2026-08-21T07:00:00+07:00', endAt: '2026-08-21T11:00:00+07:00', hourlySupportRate: 29_000, allowance: 50_000, status: 'Đã duyệt' }],
    }
    render(<MemoryRouter><EmployeeSchedulePage /></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: 'Theo tháng' }))
    fireEvent.change(screen.getByLabelText('Chọn tháng'), { target: { value: '2026-08' } })
    const table = screen.getByRole('columnheader', { name: 'Lương hỗ trợ' }).closest('table')
    expect(within(table).getByText('Dosii NTL')).toBeTruthy()
    expect(within(table).getByText('Dosii KVC')).toBeTruthy()
    expect(within(table).getByText('29,000 đ/giờ')).toBeTruthy()
    expect(within(table).getByText('50,000 đ')).toBeTruthy()
  })

  it('opens the requested support date and still allows another date to be selected', () => {
    mocked.app = {
      currentEmployee: { id: 'E01', name: 'Nguyễn An' },
      schedule: [{ id: 'SCH-1', employeeId: 'E01', storeId: 'S02', date: '2026-09-08', shiftIds: ['CA-1'] }],
      shiftDefinitions: [{ id: 'CA-1', name: 'Ca hỗ trợ sáng', start: '08:00', end: '12:00' }],
    }
    render(<MemoryRouter initialEntries={['/employee/schedule?date=2026-09-08']}><EmployeeSchedulePage /></MemoryRouter>)
    expect(screen.getByLabelText('Chọn ngày').value).toBe('2026-09-08')
    expect(screen.getByText('Ca hỗ trợ sáng')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Chọn ngày'), { target: { value: '2026-09-09' } })
    expect(screen.getByLabelText('Chọn ngày').value).toBe('2026-09-09')
    expect(screen.queryByText('Ca hỗ trợ sáng')).toBeNull()
  })

  it.each(['', '?date=2026-02-30', '?date=invalid'])('falls back to today for a missing or invalid date: %s', (query) => {
    mocked.app = { currentEmployee: { id: 'E01' } }
    render(<MemoryRouter initialEntries={[`/employee/schedule${query}`]}><EmployeeSchedulePage /></MemoryRouter>)
    expect(screen.getByLabelText('Chọn ngày').value).toBe(today())
  })
})
