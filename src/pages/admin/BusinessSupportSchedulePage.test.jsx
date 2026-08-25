import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BusinessSupportSchedulePage, MyBusinessSupportSchedulePage } from './BusinessSupportSchedulePage'

const mocked = vi.hoisted(() => ({
  app: {},
  saveBusinessSupportSchedule: vi.fn(),
  deleteBusinessSupportSchedule: vi.fn(),
}))

vi.mock('../../state/AppContext', () => ({ useApp: () => mocked.app }))

describe('BusinessSupportSchedulePage', () => {
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  beforeEach(() => {
    mocked.saveBusinessSupportSchedule.mockReset().mockResolvedValue({ ok: true })
    mocked.deleteBusinessSupportSchedule.mockReset().mockResolvedValue({ ok: true })
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
      deleteBusinessSupportSchedule: mocked.deleteBusinessSupportSchedule,
      settings: { avatar: '/avatar-office.jpg' },
    }
  })

  it('allows Business Support to edit and delete its current schedule from the assignment history', async () => {
    const prompt = vi.spyOn(window, 'prompt').mockReturnValue('Phân lịch nhầm')
    mocked.app = {
      ...mocked.app,
      supportWorkSchedules: [{ id: 'SWS-01', employeeId: 'HTKD-01', employeeName: 'Hỗ trợ KD', targetUnit: 'business_support', date: '2026-08-24', employmentType: 'Full-Time', shiftName: 'Ca linh hoạt cũ', start: '08:00', end: '17:30' }],
      supportWorkScheduleHistory: [{ id: 'H-01', scheduleId: 'SWS-01', employeeId: 'HTKD-01', employeeName: 'Hỗ trợ KD', targetUnit: 'business_support', date: '2026-08-24', employmentType: 'Full-Time', shiftName: 'Ca linh hoạt cũ', start: '08:00', end: '17:30', recordedAt: '2026-08-21T08:00:00.000Z' }],
    }
    render(<BusinessSupportSchedulePage />)

    fireEvent.click(screen.getByRole('button', { name: 'Sửa từ lịch sử của Hỗ trợ KD' }))
    expect(screen.getByText('Chỉnh sửa lịch làm việc')).toBeTruthy()
    fireEvent.change(screen.getByLabelText(/Giờ kết thúc/u), { target: { value: '18:00' } })
    fireEvent.click(screen.getByRole('button', { name: 'LƯU' }))
    await waitFor(() => expect(mocked.saveBusinessSupportSchedule).toHaveBeenCalledWith(expect.objectContaining({ scheduleId: 'SWS-01', shiftName: 'Ca linh hoạt cũ', end: '18:00' })))

    fireEvent.click(screen.getByRole('button', { name: 'Xóa từ lịch sử của Hỗ trợ KD' }))
    await waitFor(() => expect(mocked.deleteBusinessSupportSchedule).toHaveBeenCalledWith('SWS-01', 'Phân lịch nhầm'))
    prompt.mockRestore()
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

  it('applies all established quick-select periods while leaving manual time inputs editable', async () => {
    render(<BusinessSupportSchedulePage />)

    fireEvent.change(screen.getByLabelText(/Loại nhân viên/u), { target: { value: 'office' } })
    fireEvent.change(screen.getByLabelText(/Chọn nhân viên/u), { target: { value: 'VP-02' } })

    const presets = [
      ['Ca sáng', '08:00', '12:00'],
      ['Ca chiều', '13:00', '17:30'],
      ['Giờ hành chính', '08:00', '17:30'],
    ]
    for (const [name, start, end] of presets) {
      const presetButton = screen.getByRole('button', { name: new RegExp(`Chọn nhanh ${name}`, 'u') })
      fireEvent.click(presetButton)
      expect(presetButton.getAttribute('aria-pressed')).toBe('true')
      expect(screen.getByLabelText(/Tên ca/u).value).toBe(name)
      expect(screen.getByLabelText(/Giờ bắt đầu/u).value).toBe(start)
      expect(screen.getByLabelText(/Giờ kết thúc/u).value).toBe(end)
    }

    fireEvent.change(screen.getByLabelText(/Giờ kết thúc/u), { target: { value: '18:15' } })
    fireEvent.click(screen.getByRole('button', { name: 'LƯU' }))
    await waitFor(() => expect(mocked.saveBusinessSupportSchedule).toHaveBeenCalledWith(expect.objectContaining({
      employeeId: 'VP-02', shiftName: 'Giờ hành chính', start: '08:00', end: '18:15',
    })))
  })

  it('renders the personal weekly schedule horizontally with avatar and empty days', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-21T08:00:00+07:00'))
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
    vi.useRealTimers()
  })

  it('lets an Office employee create, edit and delete only their own configured shift', async () => {
    const prompt = vi.spyOn(window, 'prompt').mockReturnValue('Đổi lịch cá nhân')
    mocked.app = {
      ...mocked.app,
      currentEmployee: {
        id: 'VP-02', name: 'Thực tập Marketing', unit: 'office', employmentType: 'Thực Tập Sinh',
        workShifts: [{ id: 'office_pm', name: 'Ca chiều', start: '13:00', end: '17:30' }],
      },
      session: { role: 'employee', employeeId: 'VP-02', name: 'Thực tập Marketing', unit: 'office' },
      supportWorkSchedules: [
        { id: 'SELF-01', employeeId: 'VP-02', targetUnit: 'office', date: '2026-08-21', shiftName: 'Ca chiều', start: '13:00', end: '17:30' },
      ],
    }
    render(<MyBusinessSupportSchedulePage />)

    fireEvent.click(screen.getByRole('button', { name: 'TẠO LỊCH LÀM VIỆC' }))
    expect(screen.queryByLabelText(/Chọn nhân viên/u)).toBeNull()
    expect(screen.getByLabelText(/Chọn ca/u).textContent).toContain('Ca chiều · 13:00–17:30')
    fireEvent.change(screen.getByLabelText(/Chọn ngày/u), { target: { value: '2026-08-24' } })
    fireEvent.click(screen.getByRole('button', { name: 'LƯU' }))
    await waitFor(() => expect(mocked.saveBusinessSupportSchedule).toHaveBeenCalledWith(expect.objectContaining({
      employeeId: 'VP-02', targetUnit: 'office', date: '2026-08-24', shiftName: 'Ca chiều', start: '13:00', end: '17:30',
    })))

    fireEvent.change(screen.getByDisplayValue('2026-08-24'), { target: { value: '2026-08-21' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sửa lịch ngày 21/08/26' }))
    fireEvent.change(screen.getByLabelText(/Giờ kết thúc/u), { target: { value: '18:00' } })
    fireEvent.click(screen.getByRole('button', { name: 'LƯU' }))
    await waitFor(() => expect(mocked.saveBusinessSupportSchedule).toHaveBeenCalledWith(expect.objectContaining({ scheduleId: 'SELF-01', employeeId: 'VP-02', end: '18:00' })))

    fireEvent.click(screen.getByRole('button', { name: 'Xóa lịch ngày 21/08/26' }))
    await waitFor(() => expect(mocked.deleteBusinessSupportSchedule).toHaveBeenCalledWith('SELF-01', 'Đổi lịch cá nhân'))
    prompt.mockRestore()
  })

  it('lets an Office employee use defaults without overwriting an existing custom schedule', async () => {
    const currentDate = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' })
    mocked.app = {
      ...mocked.app,
      currentEmployee: { id: 'VP-01', name: 'Kế toán văn phòng', unit: 'office', employmentType: 'Full-Time' },
      session: { role: 'employee', employeeId: 'VP-01', name: 'Kế toán văn phòng', unit: 'office' },
      supportWorkSchedules: [
        { id: 'CUSTOM-01', employeeId: 'VP-01', targetUnit: 'office', date: currentDate, shiftName: 'Khung giờ cũ', start: '09:15', end: '16:45' },
      ],
    }
    render(<MyBusinessSupportSchedulePage />)

    fireEvent.click(screen.getByRole('button', { name: /Sửa lịch ngày/u }))
    expect(screen.getByLabelText(/Giờ bắt đầu/u).value).toBe('09:15')
    expect(screen.getByLabelText(/Giờ kết thúc/u).value).toBe('16:45')
    fireEvent.click(screen.getByRole('button', { name: 'LƯU' }))
    await waitFor(() => expect(mocked.saveBusinessSupportSchedule).toHaveBeenCalledWith(expect.objectContaining({
      scheduleId: 'CUSTOM-01', shiftName: 'Khung giờ cũ', start: '09:15', end: '16:45',
    })))

    fireEvent.click(screen.getByRole('button', { name: 'TẠO LỊCH LÀM VIỆC' }))
    fireEvent.click(screen.getByRole('button', { name: /Chọn nhanh Ca chiều/u }))
    expect(screen.getByLabelText(/Giờ bắt đầu/u).value).toBe('13:00')
    expect(screen.getByLabelText(/Giờ kết thúc/u).value).toBe('17:30')
    fireEvent.click(screen.getByRole('button', { name: 'LƯU' }))
    await waitFor(() => expect(mocked.saveBusinessSupportSchedule).toHaveBeenLastCalledWith(expect.objectContaining({
      scheduleId: '', shiftName: 'Ca chiều', start: '13:00', end: '17:30',
    })))
  })

  it('keeps self-management controls hidden from a Business Support personal schedule', () => {
    mocked.app = {
      ...mocked.app,
      currentEmployee: { id: 'HTKD-01', name: 'Hỗ trợ KD', unit: 'business_support', employmentType: 'Full-Time' },
      session: { role: 'business_support', employeeId: 'HTKD-01', name: 'Hỗ trợ KD' },
    }
    render(<MyBusinessSupportSchedulePage />)

    expect(screen.queryByRole('button', { name: 'TẠO LỊCH LÀM VIỆC' })).toBeNull()
  })
})
