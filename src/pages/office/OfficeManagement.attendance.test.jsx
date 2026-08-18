import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OfficeManagement } from './OfficeManagement'

const mocked = vi.hoisted(() => ({ app: {} }))

vi.mock('../../state/AppContext', () => ({
  useApp: () => mocked.app,
}))

const employees = [
  { id: 'VP-001', code: 'VP-001', unit: 'office', storeId: 'OFFICE', isOffice: true, name: 'Nguyễn Văn A', status: 'Đang làm việc', employmentType: 'Full-Time', position: 'Kế Toán', workStart: '08:00', workEnd: '17:00' },
  { id: 'VP-002', code: 'VP-002', unit: 'office', storeId: 'OFFICE', isOffice: true, name: 'Trần Văn B', status: 'Đang làm việc', employmentType: 'Part-Time', position: 'Marketing', workStart: '09:00', workEnd: '18:00' },
]

const attendance = [
  { id: 'CC-001', employeeId: 'VP-001', date: '2026-08-10', shiftName: 'Ca hành chính A', shiftStart: '08:00', shiftEnd: '17:00', checkIn: '07:45', checkOut: '17:00', arrivalTag: 'Đi sớm', departureTag: 'Ra đúng giờ', checkInLocation: { label: 'Văn phòng tầng 1' }, checkOutLocation: { label: 'Văn phòng tầng 2' } },
  { id: 'CC-002', employeeId: 'VP-001', date: '2026-08-11', shiftName: 'Ca hành chính A', shiftStart: '08:00', shiftEnd: '17:00', checkIn: '08:00', checkOut: '17:00', arrivalTag: 'Đi đúng giờ', departureTag: 'Ra đúng giờ' },
  { id: 'CC-003', employeeId: 'VP-002', date: '2026-08-12', shiftName: 'Ca hành chính B', shiftStart: '09:00', shiftEnd: '18:00', checkIn: '09:20', checkOut: '18:00', arrivalTag: 'Đi trễ', departureTag: 'Ra đúng giờ', minutesLate: 20, checkInLocation: { latitude: 10.8, longitude: 106.7 }, checkOutLocation: { label: 'Cổng văn phòng' } },
]

const metricText = (label) => screen.getAllByText(label).find((node) => node.classList.contains('metric__label'))?.closest('.metric')?.textContent || ''

describe('OfficeManagement attendance-only workspace', () => {
  beforeEach(() => {
    mocked.app = {
      session: { role: 'admin', employeeId: 'ADMIN' },
      employees,
      deletedEmployees: [],
      attendance,
      policies: { attendanceEvaluation: { maintainMaxLateCount: 1, improveMinLateCount: 2, improveMinLateMinutes: 15 } },
      addEmployee: vi.fn(),
      updateEmployee: vi.fn(),
      deleteEmployee: vi.fn(),
      notify: vi.fn(),
    }
  })

  afterEach(cleanup)

  it('removes all payroll navigation and mutation controls', () => {
    render(<OfficeManagement />)

    expect(screen.queryByText(/Thống kê lương/i)).toBeNull()
    expect(screen.queryByRole('button', { name: /Tạo thưởng|Tạo phụ cấp/i })).toBeNull()
    expect(screen.queryByText(/Lịch sử thưởng|Lương theo công|Tổng nhận/i)).toBeNull()
    expect(screen.getByRole('button', { name: /Chấm công & chuyên cần/i })).toBeTruthy()
  })

  it('shows full 24-hour attendance history, locations, shifts, tags, and punctuality totals', () => {
    render(<OfficeManagement />)
    fireEvent.click(screen.getByRole('button', { name: /Chấm công & chuyên cần/i }))

    const historyCard = screen.getByRole('heading', { name: 'Lịch sử chấm công' }).closest('section')
    expect(within(historyCard).getAllByText('Ca hành chính A')).toHaveLength(2)
    expect(within(historyCard).getAllByText('08:00–17:00').length).toBeGreaterThan(0)
    expect(within(historyCard).getByText('07:45')).toBeTruthy()
    expect(within(historyCard).getAllByText('17:00').length).toBeGreaterThan(0)
    expect(within(historyCard).getByText('Văn phòng tầng 1')).toBeTruthy()
    expect(within(historyCard).getByText('Văn phòng tầng 2')).toBeTruthy()
    expect(within(historyCard).getByText('10.80000, 106.70000')).toBeTruthy()
    expect(within(historyCard).getAllByText('Đi sớm').length).toBeGreaterThan(0)
    expect(within(historyCard).getAllByText('Ra đúng giờ').length).toBeGreaterThan(0)
    expect(historyCard.textContent).not.toMatch(/AM|PM/i)

    expect(metricText('Đi sớm')).toContain('1')
    expect(metricText('Đúng giờ')).toContain('1')
    expect(metricText('Đi trễ')).toContain('1')
    expect(metricText('Tổng phút đi sớm')).toContain('15')
    expect(metricText('Tổng phút đi trễ')).toContain('20')
    expect(screen.getByRole('heading', { name: /Thống kê và đánh giá chuyên cần theo nhân viên/i })).toBeTruthy()
  })

  it('applies employee and inclusive date filters to history and evaluations', () => {
    render(<OfficeManagement />)
    fireEvent.click(screen.getByRole('button', { name: /Chấm công & chuyên cần/i }))

    fireEvent.change(screen.getByLabelText('Lọc nhân viên chấm công'), { target: { value: 'VP-002' } })
    fireEvent.change(screen.getByLabelText('Từ ngày chấm công'), { target: { value: '2026-08-12' } })
    fireEvent.change(screen.getByLabelText('Đến ngày chấm công'), { target: { value: '2026-08-12' } })

    const historyCard = screen.getByRole('heading', { name: 'Lịch sử chấm công' }).closest('section')
    expect(within(historyCard).getByText('Trần Văn B')).toBeTruthy()
    expect(within(historyCard).queryByText('Nguyễn Văn A')).toBeNull()
    expect(metricText('Lượt điểm danh')).toContain('1')
    expect(metricText('Đi trễ')).toContain('1')

    const evaluationCard = screen.getByRole('heading', { name: /Thống kê và đánh giá chuyên cần theo nhân viên/i }).closest('section')
    expect(within(evaluationCard).getByText('Trần Văn B')).toBeTruthy()
    expect(within(evaluationCard).queryByText('Nguyễn Văn A')).toBeNull()
    expect(within(evaluationCard).getByText('Cần cải thiện')).toBeTruthy()
  })
})
