import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorkingTimeSettingsModal } from './WorkingTimeSettingsModal'

const profiles = [{
  id: 'VP-001',
  name: 'Nguyễn Văn A',
  employmentType: 'Full-Time',
  startDate: '2026-08-01',
  workStart: '08:00',
  workEnd: '17:30',
  workShifts: [{ id: 'full_time', name: 'Giờ hành chính', start: '08:00', end: '17:30' }],
  workTimeSchedule: [
    { effectiveFrom: '2026-08-01', workTimeType: 'Full-Time', workStart: '08:00', workEnd: '17:30', workShifts: [{ id: 'full_time', name: 'Giờ hành chính', start: '08:00', end: '17:30' }] },
    { effectiveFrom: '2026-08-21', workTimeType: 'Full-Time', workStart: '09:00', workEnd: '18:00', workShifts: [{ id: 'full_time', name: 'Giờ mới', start: '09:00', end: '18:00' }] },
  ],
}, {
  id: 'HTKD-001',
  name: 'Hỗ trợ thực tập',
  employmentType: 'Thực Tập Sinh',
  startDate: '2026-08-01',
  workStart: '08:00',
  workEnd: '12:00',
  workShifts: [
    { id: 'am', name: 'Ca sáng', start: '08:00', end: '12:00' },
    { id: 'pm', name: 'Ca chiều', start: '13:00', end: '17:30' },
  ],
}]

describe('WorkingTimeSettingsModal', () => {
  afterEach(cleanup)

  it('requires an employee selection, resolves the configuration at the selected date, and saves an effective-dated payload', async () => {
    const onSave = vi.fn().mockResolvedValue({ ok: true })
    const onClose = vi.fn()
    render(<WorkingTimeSettingsModal open profiles={profiles} onSave={onSave} onClose={onClose} />)

    expect(screen.getByText(/Chọn nhân viên để hiển thị/i)).toBeTruthy()
    expect(screen.queryByLabelText(/Giờ bắt đầu \(24 giờ\)/i)).toBeNull()

    fireEvent.change(screen.getByLabelText('Chọn nhân viên cài đặt thời gian làm việc'), { target: { value: 'VP-001' } })
    fireEvent.change(screen.getByLabelText('Ngày áp dụng thời gian làm việc'), { target: { value: '2026-08-20' } })
    expect(screen.getByLabelText(/Giờ bắt đầu \(24 giờ\)/i).value).toBe('08:00')

    fireEvent.change(screen.getByLabelText('Ngày áp dụng thời gian làm việc'), { target: { value: '2026-08-21' } })
    expect(screen.getByLabelText(/Giờ bắt đầu \(24 giờ\)/i).value).toBe('09:00')
    fireEvent.change(screen.getByLabelText(/Giờ kết thúc \(24 giờ\)/i), { target: { value: '18:30' } })
    fireEvent.click(screen.getByRole('button', { name: 'LƯU' }))

    expect(onSave).toHaveBeenCalledWith('VP-001', expect.objectContaining({
      effectiveFrom: '2026-08-21',
      workTimeType: 'Full-Time',
      workStart: '09:00',
      workEnd: '18:30',
    }))
  })

  it('shows named reusable shifts for Part-Time and interns', () => {
    render(<WorkingTimeSettingsModal open profiles={profiles} onClose={() => {}} />)
    fireEvent.change(screen.getByLabelText('Chọn nhân viên cài đặt thời gian làm việc'), { target: { value: 'HTKD-001' } })

    expect(screen.getByText(/Thực Tập Sinh · ca làm linh hoạt/i)).toBeTruthy()
    expect(screen.getByDisplayValue('Ca sáng')).toBeTruthy()
    expect(screen.getByDisplayValue('Ca chiều')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Thêm ca làm việc/i })).toBeTruthy()
  })
})
