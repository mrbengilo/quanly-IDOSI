import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BusinessSupportSchedulePage, MyBusinessSupportSchedulePage } from './BusinessSupportSchedulePage'

const mocked = vi.hoisted(() => ({
  app: {},
  saveBusinessSupportSchedule: vi.fn(),
}))

vi.mock('../../state/AppContext', () => ({ useApp: () => mocked.app }))

describe('BusinessSupportSchedulePage', () => {
  afterEach(cleanup)

  beforeEach(() => {
    mocked.saveBusinessSupportSchedule.mockReset().mockResolvedValue({ ok: true })
    mocked.app = {
      session: { role: 'business_support', employeeId: 'HTKD-01', name: 'Hỗ trợ KD' },
      employees: [
        { id: 'HTKD-01', name: 'Hỗ trợ KD', unit: 'business_support', employmentType: 'Full-Time' },
        { id: 'VP-01', name: 'Kế toán văn phòng', unit: 'office', employmentType: 'Full-Time' },
        { id: 'VP-02', name: 'Thực tập Marketing', unit: 'office', employmentType: 'Thực Tập Sinh' },
      ],
      supportWorkScheduleHistory: [],
      supportWorkSchedules: [],
      saveBusinessSupportSchedule: mocked.saveBusinessSupportSchedule,
      settings: { avatar: '/avatar-office.jpg' },
    }
  })

  it('filters the employee selector by group and saves an Office schedule with its target unit', async () => {
    render(<BusinessSupportSchedulePage />)

    expect(screen.getByLabelText(/Chọn nhân viên/u).textContent).toContain('Hỗ trợ KD')
    expect(screen.getByLabelText(/Chọn nhân viên/u).textContent).not.toContain('Kế toán văn phòng')
    fireEvent.change(screen.getByLabelText(/Loại nhân viên/u), { target: { value: 'office' } })
    expect(screen.getByLabelText(/Chọn nhân viên/u).textContent).toContain('Kế toán văn phòng')
    expect(screen.getByLabelText(/Chọn nhân viên/u).textContent).toContain('Thực tập Marketing')
    expect(screen.getByLabelText(/Chọn nhân viên/u).textContent).not.toContain('Hỗ trợ KD —')

    fireEvent.change(screen.getByLabelText(/Chọn nhân viên/u), { target: { value: 'VP-01' } })
    fireEvent.change(screen.getByLabelText(/Chọn ngày/u), { target: { value: '2026-08-24' } })
    fireEvent.change(screen.getByLabelText(/Giờ bắt đầu/u), { target: { value: '08:00' } })
    fireEvent.change(screen.getByLabelText(/Giờ kết thúc/u), { target: { value: '17:30' } })
    fireEvent.click(screen.getByRole('button', { name: 'LƯU' }))

    await waitFor(() => expect(mocked.saveBusinessSupportSchedule).toHaveBeenCalledWith(expect.objectContaining({
      targetUnit: 'office', employeeId: 'VP-01', date: '2026-08-24', start: '08:00', end: '17:30',
    })))
  })

  it('renders the personal weekly schedule horizontally with avatar and empty days', () => {
    mocked.app = {
      ...mocked.app,
      currentEmployee: { id: 'VP-01', name: 'Kế toán văn phòng', unit: 'office', employmentType: 'Full-Time' },
      session: { role: 'employee', employeeId: 'VP-01', name: 'Kế toán văn phòng', unit: 'office' },
      supportWorkSchedules: [
        { id: 'S1', employeeId: 'VP-01', targetUnit: 'office', date: '2026-08-21', shiftName: 'Giờ hành chính', start: '08:00', end: '17:30' },
        { id: 'S2', employeeId: 'VP-01', targetUnit: 'office', date: '2026-08-22', shiftName: 'Ca sáng', start: '08:00', end: '12:00', note: 'Họp đầu ca' },
      ],
    }
    render(<MyBusinessSupportSchedulePage />)

    expect(document.querySelector('.my-work-schedule-grid thead tr')?.children).toHaveLength(8)
    expect(document.querySelector('.my-work-schedule-grid')?.textContent).toContain('21/08')
    expect(screen.getByText('Giờ hành chính')).toBeTruthy()
    expect(screen.getByText('Ca sáng')).toBeTruthy()
    expect(screen.getByText('Họp đầu ca')).toBeTruthy()
    expect(screen.getAllByText('Không có lịch')).toHaveLength(5)
    expect(screen.getByAltText('Ảnh đại diện Kế toán văn phòng').getAttribute('src')).toBe('/avatar-office.jpg')
  })
})
