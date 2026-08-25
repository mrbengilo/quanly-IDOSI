import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PolicySettings, ResetDataPage, SupportTransfersPage } from './GovernancePages'

const mocked = vi.hoisted(() => ({
  session: { role: 'business_support', name: 'Hỗ trợ KD' },
  attendance: [],
  supportTransfers: [],
  auditLogs: [],
  attendanceAudit: [],
  operationalResetHistory: [],
  saveSupportTransfer: vi.fn(),
  updateSupportTransfer: vi.fn(),
  deleteSupportTransfer: vi.fn(),
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

const baseAttendance = [
  {
    id: 'ATT-001', employeeId: 'SM234-001', storeId: 'CH001', shiftName: 'Ca sáng',
    shiftStart: '07:00', shiftEnd: '12:00', date: '2026-08-18', checkIn: '07:05', checkOut: '12:00', hours: 4.92, status: 'Đi trễ',
  },
  {
    id: 'ATT-INBOUND', employeeId: 'TNV-001', storeId: 'CH001', supportTransferId: 'TR-INBOUND', shiftName: 'Ca hỗ trợ',
    shiftStart: '13:00', shiftEnd: '18:00', date: '2026-08-18', checkIn: '14:00', checkOut: '17:00', hours: 3, status: 'Đúng giờ',
  },
  {
    id: 'ATT-OFFICE', employeeId: 'VP-001', storeId: 'OFFICE', shiftName: 'Giờ hành chính',
    date: '2026-08-18', checkIn: '08:00', checkOut: '17:00', hours: 8, status: 'Đúng giờ',
  },
  {
    id: 'ATT-SUPPORT', employeeId: 'HTKD-001', storeId: 'BUSINESS_SUPPORT', shiftName: 'Giờ hành chính',
    date: '2026-08-18', checkIn: '08:00', checkOut: '17:00', hours: 8, status: 'Đúng giờ',
  },
]

vi.mock('../../state/AppContext', () => ({
  useApp: () => ({
    session: mocked.session,
    stores,
    employees,
    supportTransfers: mocked.supportTransfers,
    attendance: mocked.attendance,
    auditLogs: mocked.auditLogs,
    attendanceAudit: mocked.attendanceAudit,
    operationalResetHistory: mocked.operationalResetHistory,
    policies: {
      lateToleranceMinutes: 5,
      earlyCheckInLimitMinutes: 30,
      employeeKpiRates: { from30000: 5, from15000: 3, from7000: 1 },
      attendanceEvaluation: { maintainMaxLateCount: 1, improveMinLateCount: 3, improveMinLateMinutes: 30 },
      effectiveFrom: '2026-08-18',
    },
    policyHistory: [],
    saveSupportTransfer: mocked.saveSupportTransfer,
    updateSupportTransfer: mocked.updateSupportTransfer,
    deleteSupportTransfer: mocked.deleteSupportTransfer,
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
    mocked.attendance = baseAttendance.map((record) => ({ ...record }))
    mocked.supportTransfers = []
    mocked.auditLogs = []
    mocked.attendanceAudit = []
    mocked.operationalResetHistory = []
    mocked.saveSupportTransfer.mockReset().mockResolvedValue({ ok: true })
    mocked.updateSupportTransfer.mockReset().mockResolvedValue({ ok: true })
    mocked.deleteSupportTransfer.mockReset().mockResolvedValue({ ok: true })
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
    fireEvent.change(screen.getByLabelText(/Lương hỗ trợ/i), { target: { value: '35' } })
    fireEvent.change(screen.getByLabelText(/Phụ cấp/i), { target: { value: '200' } })
    fireEvent.click(screen.getByRole('button', { name: /Lưu điều chuyển/i }))

    await waitFor(() => expect(mocked.saveSupportTransfer).toHaveBeenCalledWith(expect.objectContaining({
      employeeId: 'SM234-001',
      fromStoreId: 'CH001',
      toStoreId: 'CH002',
      hourlySupportRate: 35,
      allowance: 200,
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

  it('lets Business Support edit an existing transfer without exposing deletion', async () => {
    mocked.supportTransfers = [{
      id: 'TR-001', employeeId: 'SM234-001', fromStoreId: 'CH001', toStoreId: 'CH002',
      startAt: '2026-08-20T01:00:00.000Z', endAt: '2026-08-20T05:00:00.000Z',
      hourlySupportRate: 30_000, allowance: 200_000, note: 'Hỗ trợ buổi sáng', status: 'Đã duyệt',
      createdAt: '2026-08-19T00:00:00.000Z',
    }]
    render(<SupportTransfersPage />)

    fireEvent.click(screen.getByRole('button', { name: 'Sửa' }))
    expect(screen.getByText('Chỉnh sửa điều chuyển')).toBeTruthy()
    fireEvent.change(screen.getByLabelText(/Ghi chú/i), { target: { value: 'Cập nhật lịch hỗ trợ' } })
    fireEvent.click(screen.getByRole('button', { name: /Cập nhật điều chuyển/i }))
    await waitFor(() => expect(mocked.updateSupportTransfer).toHaveBeenCalledWith('TR-001', expect.objectContaining({
      employeeId: 'SM234-001', fromStoreId: 'CH001', toStoreId: 'CH002',
      startAt: '2026-08-20T08:00', endAt: '2026-08-20T12:00',
      hourlySupportRate: 30_000, allowance: 200_000, note: 'Cập nhật lịch hỗ trợ',
    })))

    expect(screen.queryByRole('button', { name: 'Xóa' })).toBeNull()
    expect(mocked.deleteSupportTransfer).not.toHaveBeenCalled()
  })

  it('lets Admin edit and delete an existing transfer with an explicit audit reason', async () => {
    mocked.session = { role: 'admin', name: 'Admin' }
    mocked.supportTransfers = [{
      id: 'TR-001', employeeId: 'SM234-001', fromStoreId: 'CH001', toStoreId: 'CH002',
      startAt: '2026-08-20T01:00:00.000Z', endAt: '2026-08-20T05:00:00.000Z',
      hourlySupportRate: 30_000, allowance: 200_000, note: 'Hỗ trợ buổi sáng', status: 'Đã duyệt',
      createdAt: '2026-08-19T00:00:00.000Z',
    }]
    render(<SupportTransfersPage />)

    fireEvent.click(screen.getByRole('button', { name: 'Sửa' }))
    fireEvent.change(screen.getByLabelText(/Ghi chú/i), { target: { value: 'Admin cập nhật lịch hỗ trợ' } })
    fireEvent.click(screen.getByRole('button', { name: /Cập nhật điều chuyển/i }))
    await waitFor(() => expect(mocked.updateSupportTransfer).toHaveBeenCalledWith('TR-001', expect.objectContaining({
      note: 'Admin cập nhật lịch hỗ trợ',
    })))

    fireEvent.click(screen.getByRole('button', { name: 'Xóa' }))
    fireEvent.change(screen.getByLabelText(/Lý do xóa/i), { target: { value: 'Lịch hỗ trợ không còn áp dụng' } })
    fireEvent.click(screen.getByRole('button', { name: /^Xóa điều chuyển$/i }))
    await waitFor(() => expect(mocked.deleteSupportTransfer).toHaveBeenCalledWith(
      'TR-001',
      'Lịch hỗ trợ không còn áp dụng',
    ))
  })

  it('blocks Business Support from the Reset dữ liệu page', () => {
    render(<ResetDataPage />)

    expect(screen.getByRole('heading', { name: /Không có quyền truy cập/i })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Khôi phục chỉnh sửa\/xóa/i })).toBeNull()
    expect(mocked.restoreOperationalData).not.toHaveBeenCalled()
  })

  it('lets Admin restore only the selected operational scope with a required audit reason', async () => {
    mocked.session = { role: 'admin', name: 'Admin' }
    render(<ResetDataPage />)

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

  it('lets Admin edit attendance while keeping the destructive reset separately confirmed', () => {
    mocked.session = { role: 'admin', name: 'Admin' }
    render(<ResetDataPage />)

    expect(screen.getAllByRole('button', { name: 'Chỉnh sửa' })).toHaveLength(4)
    expect(screen.queryByText('Chỉ xem')).toBeNull()
  })

  it('shows exactly which field and employee were changed in the Reset audit log', () => {
    mocked.session = { role: 'admin', name: 'Admin' }
    mocked.attendanceAudit = [{
      id: 'AUDIT-ATT-001', attendanceId: 'ATT-001', employeeId: 'SM234-001', action: 'Sửa',
      changedFields: ['checkIn', 'checkOut'],
      before: { employeeId: 'SM234-001', checkIn: '07:05', checkOut: '12:00' },
      after: { employeeId: 'SM234-001', checkIn: '07:15', checkOut: '12:10' },
      reason: 'Đối soát máy chấm công', createdAt: '2026-08-18T12:00:00.000Z',
      actor: { name: 'Admin' },
    }]
    render(<ResetDataPage />)

    const auditCard = screen.getByText('Nhật ký chỉnh sửa gần nhất').closest('section')
    const auditRow = within(auditCard).getByText((_, node) => node?.tagName === 'SMALL' && node.textContent.includes('ATT-001')).closest('tr')
    expect(within(auditRow).getByText('Nguyễn An')).toBeTruthy()
    expect(within(auditRow).getByText(/Giờ vào: 07:05 → 07:15/)).toBeTruthy()
    expect(within(auditRow).getByText(/Giờ kết: 12:00 → 12:10/)).toBeTruthy()
    expect(within(auditRow).getByText(/Đối soát máy chấm công/)).toBeTruthy()
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
