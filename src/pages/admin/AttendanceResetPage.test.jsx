import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AttendanceResetPage } from './AttendanceResetPage'

const mocked = vi.hoisted(() => ({ app: {}, updateAttendance: vi.fn(), notify: vi.fn() }))

vi.mock('../../state/AppContext', () => ({ useApp: () => mocked.app }))

describe('AttendanceResetPage', () => {
  afterEach(cleanup)

  beforeEach(() => {
    mocked.updateAttendance.mockReset().mockResolvedValue({ ok: true })
    mocked.notify.mockReset()
    mocked.app = {
      session: { role: 'admin' },
      stores: [{ id: 'S01', name: 'Dosii NTL' }],
      employees: [
        { id: 'VP-01', name: 'Nhân viên VP', unit: 'office', avatar: '/avatar-vp.png' },
        { id: 'HTKD-01', name: 'Hỗ trợ KD', unit: 'business_support' },
        { id: 'NV-01', name: 'Nhân viên shop', unit: 'store', storeId: 'S01' },
      ],
      attendance: [{ id: 'ATT-01', employeeId: 'VP-01', date: '2026-08-21', shiftName: 'Giờ hành chính', shiftStart: '08:00', shiftEnd: '17:30', checkIn: '08:12', checkOut: '17:31', status: 'Đi trễ' }],
      updateAttendance: mocked.updateAttendance,
      notify: mocked.notify,
    }
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
