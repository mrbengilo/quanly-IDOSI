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
      shiftDefinitions: [
        { id: 'CA-1', storeId: 'S01', name: 'Ca sáng', start: '08:00', end: '12:00' },
        { id: 'CA-2', storeId: 'S02', name: 'Ca hỗ trợ sáng', start: '07:00', end: '11:00' },
      ],
      schedule: [
        { id: 'SCH-1', employeeId: 'E01', storeId: 'S01', date: '2026-08-20', shiftIds: ['CA-1'] },
        { id: 'SCH-2', employeeId: 'E01', storeId: 'S02', date: '2026-08-21', shiftIds: ['CA-2'] },
      ],
      supportTransfers: [{ id: 'TR-1', employeeId: 'E01', fromStoreId: 'S01', toStoreId: 'S02', fromDate: '2026-08-21', toDate: '2026-08-21', hourlySupportRate: 29_000, allowance: 50_000, status: 'Đã duyệt' }],
    }
    render(<MemoryRouter><EmployeeSchedulePage /></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: 'Theo tháng' }))
    fireEvent.change(screen.getByLabelText('Chọn tháng'), { target: { value: '2026-08' } })
    const table = screen.getByRole('columnheader', { name: 'Lương hỗ trợ' }).closest('table')
    expect(within(table).getByText('Dosii NTL')).toBeTruthy()
    expect(within(table).getByText('Dosii KVC')).toBeTruthy()
    expect(within(table).getByText('29,000 đ/giờ')).toBeTruthy()
    expect(within(table).getByText('50,000 đ')).toBeTruthy()
    expect(within(table).getByText('Lịch cửa hàng chính')).toBeTruthy()
    expect(within(table).getByText('Lịch cửa hàng hỗ trợ')).toBeTruthy()
    expect(within(table).getByText(/07:00\s+–\s+11:00/u)).toBeTruthy()
    expect(within(table).queryByText(/00:00/u)).toBeNull()
  })

  it('does not render a grant-only transfer as a schedule row', () => {
    mocked.app = {
      currentEmployee: { id: 'E01', name: 'Nguyễn An', storeId: 'S01' },
      stores: [{ id: 'S02', name: 'Dosii KVC' }],
      schedule: [],
      shiftDefinitions: [],
      supportTransfers: [{
        id: 'TR-ONLY', employeeId: 'E01', fromStoreId: 'S01', toStoreId: 'S02', fromDate: '2026-08-21', toDate: '2026-08-21',
        hourlySupportRate: 29_000, allowance: 50_000, status: 'Đã duyệt',
      }],
    }
    render(<MemoryRouter initialEntries={['/employee/schedule?date=2026-08-21']}><EmployeeSchedulePage /></MemoryRouter>)

    expect(screen.getByText('Chưa có lịch phân ca trong phạm vi đã chọn.')).toBeTruthy()
    expect(screen.queryByText('Dosii KVC')).toBeNull()
    expect(screen.queryByText('Lịch cửa hàng hỗ trợ')).toBeNull()
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

  it('does not label an unmatched foreign-store assignment as a home schedule', () => {
    mocked.app = {
      currentEmployee: { id: 'E01', name: 'Nguyễn An', storeId: 'S01' },
      stores: [{ id: 'S03', name: 'Dosii không xác định' }],
      schedule: [{ id: 'SCH-OTHER', employeeId: 'E01', storeId: 'S03', date: '2026-09-08', shiftIds: ['CA-OTHER'] }],
      shiftDefinitions: [{ id: 'CA-OTHER', storeId: 'S03', name: 'Ca chưa liên kết', start: '08:00', end: '12:00' }],
      supportTransfers: [],
    }
    render(<MemoryRouter initialEntries={['/employee/schedule?date=2026-09-08']}><EmployeeSchedulePage /></MemoryRouter>)

    expect(screen.getByText('Lịch cửa hàng khác')).toBeTruthy()
    expect(screen.queryByText('Lịch cửa hàng chính')).toBeNull()
    expect(screen.queryByText('Lịch cửa hàng hỗ trợ')).toBeNull()
  })

  it('resolves the employee profile through case-insensitive id/code aliases', () => {
    mocked.app = {
      session: { role: 'employee', employeeId: 'e01' },
      employees: [{ id: 'EMP-UUID', code: 'E01', name: 'Nguyễn An', storeId: 'S01' }],
      stores: [{ id: 'S01', name: 'Dosii NTL' }],
      schedule: [{ id: 'SCH-ALIAS', employeeId: 'emp-uuid', storeId: 'S01', date: '2026-09-08', shiftIds: ['CA-1'] }],
      shiftDefinitions: [{ id: 'CA-1', storeId: 'S01', name: 'Ca qua alias', start: '08:00', end: '12:00' }],
      supportTransfers: [],
    }
    render(<MemoryRouter initialEntries={['/employee/schedule?date=2026-09-08']}><EmployeeSchedulePage /></MemoryRouter>)

    expect(screen.getByText('Lịch làm việc của Nguyễn An.')).toBeTruthy()
    expect(screen.getByText('Ca qua alias')).toBeTruthy()
    expect(screen.getByText('Lịch cửa hàng chính')).toBeTruthy()
  })

  it.each(['', '?date=2026-02-30', '?date=invalid'])('falls back to today for a missing or invalid date: %s', (query) => {
    mocked.app = { currentEmployee: { id: 'E01' } }
    render(<MemoryRouter initialEntries={[`/employee/schedule${query}`]}><EmployeeSchedulePage /></MemoryRouter>)
    expect(screen.getByLabelText('Chọn ngày').value).toBe(today())
  })
})
