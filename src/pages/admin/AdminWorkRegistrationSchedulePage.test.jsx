import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AdminWorkRegistrationSchedulePage } from './AdminWorkRegistrationSchedulePage'

const mocked = vi.hoisted(() => ({ app: {} }))

vi.mock('../../state/AppContext', () => ({ useApp: () => mocked.app }))

describe('Admin work registration schedule', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-21T08:00:00+07:00'))
    mocked.app = {
      apiStatus: 'ready',
      session: { role: 'admin' },
      employees: [
        { id: 'HTKD-01', name: 'An HTKD', unit: 'business_support', employmentType: 'Full-Time' },
        { id: 'VP-01', name: 'Bình KVP', unit: 'office', employmentType: 'Part-Time' },
        { id: 'STORE-01', name: 'Cửa hàng', unit: 'store', employmentType: 'Full-Time' },
      ],
      supportWorkSchedules: [
        { id: 'S-HTKD', employeeId: 'HTKD-01', employeeName: 'An HTKD', targetUnit: 'business_support', date: '2026-08-21', shiftName: 'Giờ hành chính', start: '08:00', end: '17:30', status: 'Đã duyệt', registeredAt: '2026-08-20T07:30:00.000Z' },
        { id: 'S-KVP', employeeId: 'VP-01', employeeName: 'Bình KVP', targetUnit: 'office', date: '2026-08-22', shiftName: 'Ca sáng', start: '08:00', end: '12:00', note: 'Họp KVP' },
        { id: 'S-DELETED', employeeId: 'VP-01', targetUnit: 'office', date: '2026-08-23', shiftName: 'Ca xóa', start: '08:00', end: '12:00', deletedAt: '2026-08-20T00:00:00Z' },
        { id: 'S-ORPHAN', employeeId: 'HTKD-OLD', employeeName: 'HTKD cũ', targetUnit: 'business_support', date: '2026-08-24', shiftName: 'Ca legacy', start: '13:00', end: '17:00' },
      ],
      saveBusinessSupportSchedule: vi.fn(),
      deleteBusinessSupportSchedule: vi.fn(),
    }
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('renders two isolated read-only groups for the selected week', () => {
    render(<AdminWorkRegistrationSchedulePage />)

    expect(screen.getByRole('heading', { name: 'LỊCH ĐĂNG KÝ LÀM VIỆC CỦA HTKD VÀ KVP' })).toBeTruthy()
    const support = screen.getByTestId('work-registration-business_support')
    const office = screen.getByTestId('work-registration-office')
    expect(within(support).getByText('An HTKD')).toBeTruthy()
    expect(within(support).getByText('HTKD cũ')).toBeTruthy()
    expect(within(support).getByText('Giờ hành chính')).toBeTruthy()
    expect(within(support).getByText('Đã duyệt')).toBeTruthy()
    expect(within(support).getByText('Đăng ký: 20/08/26 14:30:00')).toBeTruthy()
    expect(within(support).queryByText('Bình KVP')).toBeNull()
    expect(within(office).getByText('Bình KVP')).toBeTruthy()
    expect(within(office).getByText('Ca sáng')).toBeTruthy()
    expect(within(office).queryByText('Ca xóa')).toBeNull()
    expect(within(office).queryByText('An HTKD')).toBeNull()
    expect(document.querySelectorAll('.my-work-schedule-grid thead tr')[0].children).toHaveLength(8)
    expect(screen.queryByRole('button', { name: /^(Sửa|Xóa|LƯU)$/u })).toBeNull()
    expect(mocked.app.saveBusinessSupportSchedule).not.toHaveBeenCalled()
    expect(mocked.app.deleteBusinessSupportSchedule).not.toHaveBeenCalled()
  })

  it('switches between day and month ranges using date-only calendar arithmetic', () => {
    render(<AdminWorkRegistrationSchedulePage />)

    fireEvent.click(screen.getByRole('tab', { name: 'Theo ngày' }))
    expect(document.querySelectorAll('.my-work-schedule-grid thead tr')[0].children).toHaveLength(2)

    fireEvent.change(screen.getByLabelText('Ngày tham chiếu lịch đăng ký'), { target: { value: '2026-02-14' } })
    fireEvent.click(screen.getByRole('tab', { name: 'Theo tháng' }))
    expect(document.querySelectorAll('.my-work-schedule-grid thead tr')[0].children).toHaveLength(29)
    fireEvent.click(screen.getByRole('button', { name: 'Xem thời gian tiếp theo' }))
    expect(screen.getByLabelText('Ngày tham chiếu lịch đăng ký').value).toBe('2026-03-14')
  })

  it('filters by employee and resets the employee, date, and view filters', () => {
    render(<AdminWorkRegistrationSchedulePage />)

    fireEvent.change(screen.getByLabelText('Chọn nhân viên'), { target: { value: 'VP-01' } })
    expect(within(screen.getByTestId('work-registration-office')).getByText('Bình KVP')).toBeTruthy()
    expect(within(screen.getByTestId('work-registration-business_support')).queryByText('An HTKD')).toBeNull()

    fireEvent.change(screen.getByLabelText('Ngày tham chiếu lịch đăng ký'), { target: { value: '2026-02-14' } })
    fireEvent.click(screen.getByRole('tab', { name: 'Theo tháng' }))
    fireEvent.click(screen.getByRole('button', { name: 'Xóa bộ lọc' }))

    expect(screen.getByLabelText('Chọn nhân viên').value).toBe('all')
    expect(screen.getByLabelText('Ngày tham chiếu lịch đăng ký').value).toBe('2026-08-21')
    expect(screen.getByRole('tab', { name: 'Theo tuần' }).getAttribute('aria-selected')).toBe('true')
  })

  it('shows synchronization error state without exposing editing actions', () => {
    mocked.app.apiStatus = 'error'
    render(<AdminWorkRegistrationSchedulePage />)

    expect(screen.getByText('Không thể tải lịch đăng ký từ máy chủ. Vui lòng tải lại trang.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^(Sửa|Xóa|LƯU)$/u })).toBeNull()
  })
})
