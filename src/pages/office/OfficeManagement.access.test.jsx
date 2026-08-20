import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { OfficeManagement } from './OfficeManagement'

const mocked = vi.hoisted(() => ({ app: {} }))

vi.mock('../../state/AppContext', () => ({
  useApp: () => mocked.app,
}))

afterEach(() => {
  cleanup()
  mocked.app = {}
})

describe('Office Management permissions', () => {
  it.each(['business_support', 'manager'])('lets %s create and edit Office employees without delete or payroll controls', async (role) => {
    mocked.app = {
      session: { role, employeeId: 'HTKD-001' },
      employees: [{
        id: 'VP-003',
        code: 'VP-003',
        unit: 'office',
        storeId: 'OFFICE',
        isOffice: true,
        name: 'Nhân viên văn phòng',
        status: 'Đang làm việc',
        employmentType: 'Full-Time',
        startDate: '2026-08-01',
        phone: '0901234567',
        cccd: '079123456789',
        province: 'Thành phố Hồ Chí Minh',
        ward: 'Phường Bến Nghé',
        street: '01 Nguyễn Huệ',
        address: '01 Nguyễn Huệ, Phường Bến Nghé, Thành phố Hồ Chí Minh',
        username: 'office.employee',
        authUserId: 'user-office-employee',
        workTimeType: 'Full-Time',
        workStart: '08:00',
        workEnd: '17:30',
        workShifts: [{ id: 'full_time', name: 'Giờ hành chính', start: '08:00', end: '17:30' }],
        identityImages: {
          front: 'data:image/png;base64,office-front',
          back: 'data:image/png;base64,office-back',
        },
        position: 'Kế Toán',
      }],
      deletedEmployees: [{ id: 'VP-008', unit: 'office', deletedAt: '2026-08-17T00:00:00Z' }],
      attendance: [],
      salaryAdjustments: [],
      officeAdjustments: [],
      payrollPeriods: [],
      policies: {},
      addEmployee: vi.fn(),
      updateEmployee: vi.fn().mockResolvedValue({ ok: true }),
      deleteEmployee: vi.fn(),
      addSalaryAdjustment: vi.fn(),
      notify: vi.fn(),
    }

    render(<OfficeManagement />)

    expect(screen.getByRole('button', { name: /Thêm nhân viên/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Sửa Nhân viên văn phòng/i })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Xóa Nhân viên văn phòng/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /Tạo thưởng/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /Tạo phụ cấp/i })).toBeNull()

    const viewFront = screen.getByRole('button', { name: /Xem mặt trước CCCD của Nhân viên văn phòng/i })
    expect(viewFront.closest('.identity-image-actions--stable')).toBeTruthy()
    fireEvent.click(viewFront)
    expect(screen.getByRole('img', { name: /Nhân viên văn phòng · Mặt trước CCCD/i }).closest('.identity-document-viewer__frame')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Đóng' }))

    fireEvent.click(screen.getByRole('button', { name: /Thêm nhân viên/i }))
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(screen.getByDisplayValue('VP-009').readOnly).toBe(true)
    expect(screen.getByLabelText('Mặt trước CCCD')).toBeTruthy()
    expect(screen.getByLabelText('Mặt sau CCCD')).toBeTruthy()

    fireEvent.change(screen.getByPlaceholderText('Nhập mật khẩu để cấp tài khoản'), { target: { value: 'PlaintextMustClear' } })
    fireEvent.change(screen.getByLabelText('Mặt trước CCCD'), {
      target: { files: [new File(['front'], 'front.png', { type: 'image/png' })] },
    })
    await waitFor(() => expect(screen.getByAltText(/Xem trước mặt trước CCCD/i)).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Hủy bỏ' }))
    expect(screen.queryByRole('dialog')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /Thêm nhân viên/i }))
    expect(screen.getByPlaceholderText('Nhập mật khẩu để cấp tài khoản').value).toBe('')
    expect(screen.queryByAltText(/Xem trước mặt trước CCCD/i)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Hủy bỏ' }))

    fireEvent.click(screen.getByRole('button', { name: /Sửa Nhân viên văn phòng/i }))
    expect(screen.queryByText('Thời gian làm việc')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Lưu thay đổi' }))
    await waitFor(() => expect(mocked.app.updateEmployee).toHaveBeenCalledTimes(1))
    const [, updatePayload] = mocked.app.updateEmployee.mock.calls[0]
    expect(updatePayload).not.toHaveProperty('workTimeType')
    expect(updatePayload).not.toHaveProperty('workStart')
    expect(updatePayload).not.toHaveProperty('workEnd')
    expect(updatePayload).not.toHaveProperty('workShifts')
    expect(updatePayload).not.toHaveProperty('workingTime')
  }, 15_000)
})
