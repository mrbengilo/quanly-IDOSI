import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PolicySettings, ResetDataPage, SupportTransfersPage } from './GovernancePages'

const mocked = vi.hoisted(() => ({
  session: { role: 'business_support', name: 'Hỗ trợ KD' },
  saveSupportTransfer: vi.fn(),
  restoreOperationalData: vi.fn(),
  resetAllData: vi.fn(),
  updateAttendance: vi.fn(),
  savePolicies: vi.fn(),
  notify: vi.fn(),
}))

const stores = [
  { id: 'CH001', name: 'SecondMall SM234' },
  { id: 'CH002', name: 'IDOSI Tô Ngọc Vân' },
]

const employees = [
  { id: 'SM234-001', name: 'Nguyễn An', unit: 'store', storeId: 'CH001' },
  { id: 'TNV-001', name: 'Trần Bình', unit: 'store', storeId: 'CH002' },
  { id: 'VP-001', name: 'Văn phòng', unit: 'office', storeId: 'OFFICE' },
  { id: 'HTKD-001', name: 'Hỗ trợ KD', unit: 'business_support', storeId: 'BUSINESS_SUPPORT' },
]

vi.mock('../../state/AppContext', () => ({
  useApp: () => ({
    session: mocked.session,
    stores,
    employees,
    supportTransfers: [],
    attendance: [
      {
        id: 'ATT-001', employeeId: 'SM234-001', storeId: 'CH001', shiftName: 'Ca sáng',
        shiftStart: '07:00', shiftEnd: '12:00', date: '2026-08-18', checkIn: '07:05', checkOut: '12:00', hours: 4.92, status: 'Đi trễ',
      },
      {
        id: 'ATT-OFFICE', employeeId: 'VP-001', storeId: 'OFFICE', shiftName: 'Giờ hành chính',
        date: '2026-08-18', checkIn: '08:00', checkOut: '17:00', hours: 8, status: 'Đúng giờ',
      },
      {
        id: 'ATT-SUPPORT', employeeId: 'HTKD-001', storeId: 'BUSINESS_SUPPORT', shiftName: 'Giờ hành chính',
        date: '2026-08-18', checkIn: '08:00', checkOut: '17:00', hours: 8, status: 'Đúng giờ',
      },
    ],
    auditLogs: [],
    attendanceAudit: [],
    operationalResetHistory: [],
    policies: {
      lateToleranceMinutes: 5,
      earlyCheckInLimitMinutes: 30,
      employeeKpiRates: { from30000: 5, from15000: 3, from7000: 1 },
      attendanceEvaluation: { maintainMaxLateCount: 1, improveMinLateCount: 3, improveMinLateMinutes: 30 },
      effectiveFrom: '2026-08-18',
    },
    policyHistory: [],
    saveSupportTransfer: mocked.saveSupportTransfer,
    restoreOperationalData: mocked.restoreOperationalData,
    resetAllData: mocked.resetAllData,
    updateAttendance: mocked.updateAttendance,
    savePolicies: mocked.savePolicies,
    resetDemo: vi.fn(),
    notify: mocked.notify,
  }),
}))

describe('Hỗ trợ KD operations', () => {
  beforeEach(() => {
    mocked.session = { role: 'business_support', name: 'Hỗ trợ KD' }
    mocked.saveSupportTransfer.mockReset().mockResolvedValue({ ok: true })
    mocked.restoreOperationalData.mockReset().mockResolvedValue({ ok: true, restoredCount: 1 })
    mocked.resetAllData.mockReset().mockResolvedValue({ ok: true })
    mocked.updateAttendance.mockReset().mockResolvedValue({ ok: true })
    mocked.savePolicies.mockReset().mockResolvedValue({ ok: true })
    mocked.notify.mockReset()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('creates a transfer with the canonical stores, dates and compensation payload', async () => {
    render(<SupportTransfersPage />)

    fireEvent.change(screen.getByLabelText(/Cửa hàng điều chuyển/i), { target: { value: 'CH001' } })
    fireEvent.change(screen.getByLabelText(/^Nhân viên/i), { target: { value: 'SM234-001' } })
    fireEvent.change(screen.getByLabelText(/Cửa hàng nhận hỗ trợ/i), { target: { value: 'CH002' } })
    fireEvent.change(screen.getByLabelText(/Lương hỗ trợ/i), { target: { value: '30000' } })
    fireEvent.change(screen.getByLabelText(/Phụ cấp/i), { target: { value: '200000' } })
    fireEvent.click(screen.getByRole('button', { name: /Lưu điều chuyển/i }))

    await waitFor(() => expect(mocked.saveSupportTransfer).toHaveBeenCalledWith(expect.objectContaining({
      employeeId: 'SM234-001',
      fromStoreId: 'CH001',
      toStoreId: 'CH002',
      hourlySupportRate: 30000,
      allowance: 200000,
    })))
  })

  it('lets business support update the same policy form as Admin', async () => {
    render(<PolicySettings />)

    expect(screen.getByRole('heading', { name: 'CÀI ĐẶT CHÍNH SÁCH' })).toBeTruthy()
    fireEvent.change(screen.getByLabelText(/Số phút được phép/i), { target: { value: '12' } })
    fireEvent.click(screen.getByRole('button', { name: /Lưu tất cả/i }))

    await waitFor(() => expect(mocked.savePolicies).toHaveBeenCalledWith(expect.objectContaining({
      lateToleranceMinutes: 12,
      earlyCheckInLimitMinutes: 30,
      effectiveFrom: '2026-08-18',
    })))
    expect(mocked.notify).not.toHaveBeenCalled()
  })

  it('restores only the selected operational scope and keeps a required audit reason', async () => {
    render(<ResetDataPage />)

    expect(screen.queryByRole('button', { name: /Khôi phục dữ liệu mẫu/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /Bắt đầu xóa dữ liệu/i })).toBeNull()
    fireEvent.change(screen.getByLabelText(/Loại dữ liệu/i), { target: { value: 'attendance' } })
    fireEvent.change(screen.getByLabelText(/Cửa hàng/i), { target: { value: 'CH001' } })
    fireEvent.change(screen.getByLabelText(/Nhân viên \(không bắt buộc\)/i), { target: { value: 'SM234-001' } })
    fireEvent.change(screen.getByLabelText(/Lý do khôi phục/i), { target: { value: 'Đối soát nhầm lần' } })
    fireEvent.click(screen.getByRole('button', { name: /Khôi phục chỉnh sửa\/xóa/i }))

    await waitFor(() => expect(mocked.restoreOperationalData).toHaveBeenCalledWith(expect.objectContaining({
      dataType: 'attendance',
      storeId: 'CH001',
      employeeId: 'SM234-001',
      reason: 'Đối soát nhầm lần',
    })))
  })

  it('only exposes attendance editing for active physical-store employees', () => {
    render(<ResetDataPage />)

    expect(screen.getAllByRole('button', { name: 'Chỉnh sửa' })).toHaveLength(1)
    expect(screen.getAllByText('Chỉ xem')).toHaveLength(2)
  })

  it('requires Admin to type the exact destructive confirmation before resetting everything', async () => {
    mocked.session = { role: 'admin', name: 'Admin' }
    render(<ResetDataPage />)

    fireEvent.click(screen.getByRole('button', { name: /Bắt đầu xóa dữ liệu/i }))
    const deleteButton = screen.getByRole('button', { name: /^Xóa toàn bộ dữ liệu$/i })
    expect(deleteButton.disabled).toBe(true)

    fireEvent.change(screen.getByLabelText(/Nhập RESET_ALL_DATA để xác nhận/i), { target: { value: 'RESET_ALL_DATA' } })
    expect(deleteButton.disabled).toBe(false)
    fireEvent.click(deleteButton)

    await waitFor(() => expect(mocked.resetAllData).toHaveBeenCalledTimes(1))
  })

  it('allows Admin to create staff transfers', () => {
    mocked.session = { role: 'admin', name: 'Admin' }
    render(<SupportTransfersPage />)

    expect(screen.getByRole('heading', { name: /Điều chuyển nhân sự/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Lưu điều chuyển/i })).toBeTruthy()
  })
})
