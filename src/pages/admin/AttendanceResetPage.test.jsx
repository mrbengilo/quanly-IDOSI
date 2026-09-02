import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AttendanceResetPage } from './AttendanceResetPage'

const mocked = vi.hoisted(() => ({
  app: {},
  updateAttendance: vi.fn(),
  emergencyCloseAttendance: vi.fn(),
  notify: vi.fn(),
}))

vi.mock('../../state/AppContext', () => ({ useApp: () => mocked.app }))

describe('AttendanceResetPage', () => {
  afterEach(cleanup)

  beforeEach(() => {
    mocked.updateAttendance.mockReset().mockResolvedValue({ ok: true })
    mocked.emergencyCloseAttendance.mockReset().mockResolvedValue({ ok: true })
    mocked.notify.mockReset()
    mocked.app = {
      session: { role: 'admin' },
      stores: [{ id: 'S01', name: 'Dosii NTL' }],
      employees: [
        { id: 'VP-01', name: 'Nhân viên VP', unit: 'office', avatar: '/avatar-vp.png' },
        { id: 'HTKD-01', name: 'Hỗ trợ KD', unit: 'business_support' },
        { id: 'NV-01', name: 'Nhân viên shop', unit: 'store', storeId: 'S01' },
      ],
      attendance: [
        { id: 'ATT-01', employeeId: 'VP-01', date: '2026-08-21', shiftName: 'Giờ hành chính', shiftStart: '08:00', shiftEnd: '17:30', checkIn: '08:12', checkOut: '17:31', status: 'Đi trễ' },
        { id: 'ATT-OPEN', employeeId: 'NV-01', date: '2026-08-22', shiftName: 'Ca sáng', shiftStart: '08:00', shiftEnd: '12:00', checkIn: '08:05', checkInAt: '2026-08-22T01:05:00.000Z', checkOut: null, checkOutAt: null, status: 'Đi đúng giờ' },
      ],
      updateAttendance: mocked.updateAttendance,
      emergencyCloseAttendance: mocked.emergencyCloseAttendance,
      notify: mocked.notify,
    }
  })

  it('lets Admin emergency-close an open attendance exactly once with a required reason', async () => {
    render(<AttendanceResetPage />)
    fireEvent.change(screen.getByLabelText(/Cửa hàng/u), { target: { value: 'S01' } })
    fireEvent.change(screen.getByLabelText(/^Nhân viên/u), { target: { value: 'NV-01' } })

    expect(screen.getByText('Đang làm')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'KẾT CA KHẨN CẤP' }))
    const confirm = screen.getByRole('button', { name: 'XÁC NHẬN KẾT CA' })
    expect(confirm.disabled).toBe(true)

    fireEvent.change(screen.getByLabelText(/Lý do kết ca khẩn cấp/u), {
      target: { value: 'Admin đã đối soát thiết bị lỗi' },
    })
    expect(confirm.disabled).toBe(false)
    fireEvent.click(confirm)

    await waitFor(() => expect(mocked.emergencyCloseAttendance).toHaveBeenCalledTimes(1))
    expect(mocked.emergencyCloseAttendance).toHaveBeenCalledWith('ATT-OPEN', 'Admin đã đối soát thiết bị lỗi')
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Kết ca khẩn cấp' })).toBeNull())
  })

  it('only exposes attendance selection and edits the chosen employee times', async () => {
    render(<AttendanceResetPage />)
    expect(screen.queryByText(/xóa toàn bộ/u)).toBeNull()
    expect(screen.queryByText(/khôi phục đơn hàng/u)).toBeNull()

    fireEvent.change(screen.getByLabelText(/Nhóm nhân viên/u), { target: { value: 'office' } })
    fireEvent.change(screen.getByLabelText(/^Nhân viên/u), { target: { value: 'VP-01' } })
    expect(screen.getByText('Nhân viên VP')).toBeTruthy()
    expect(screen.getByAltText('Ảnh đại diện Nhân viên VP').getAttribute('src')).toBe('/avatar-vp.png')

    fireEvent.click(screen.getByRole('button', { name: 'Chỉnh sửa' }))
    fireEvent.change(screen.getByLabelText(/Giờ vào/u), { target: { value: '08:00' } })
    fireEvent.change(screen.getByLabelText(/Giờ ra/u), { target: { value: '17:30' } })
    fireEvent.change(screen.getByLabelText(/Lý do chỉnh sửa/u), { target: { value: 'Chỉnh theo biên bản' } })
    fireEvent.click(screen.getByRole('button', { name: 'LƯU' }))

    await waitFor(() => expect(mocked.updateAttendance).toHaveBeenCalledWith('ATT-01', expect.objectContaining({
      date: '2026-08-21', checkIn: '08:00', checkOut: '17:30', reason: 'Chỉnh theo biên bản',
    })))
  })

  it('rejects non-Admin access', () => {
    mocked.app = { ...mocked.app, session: { role: 'business_support' } }
    render(<AttendanceResetPage />)
    expect(screen.getByText('KHÔNG CÓ QUYỀN TRUY CẬP')).toBeTruthy()
  })
})
