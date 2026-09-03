import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DataRestorePage } from './DataRestorePage'

const mocked = vi.hoisted(() => ({
  app: {},
  apiGetAudit: vi.fn(),
}))

vi.mock('../../services/idosiApi', () => ({
  apiGetAudit: mocked.apiGetAudit,
}))

vi.mock('../../state/AppContext', () => ({
  useApp: () => mocked.app,
}))

const auditRows = () => [{
  id: 50,
  action: 'attendance.update',
  entityType: 'attendance',
  entityId: 'ATT-01',
  actorId: 'admin-1',
  actorRole: 'admin',
  serverTimestamp: '2026-09-03T07:15:00.000Z',
  before: {
    id: 'ATT-01', employeeId: 'E01', storeId: 'S01', date: '2026-09-03',
    shiftName: 'Ca sáng', shiftStart: '08:00', shiftEnd: '12:00',
    checkIn: '08:00', checkOut: '12:00',
  },
  after: {
    id: 'ATT-01', employeeId: 'E01', storeId: 'S01', date: '2026-09-03',
    shiftName: 'Ca sáng', shiftStart: '08:00', shiftEnd: '12:00',
    checkIn: '08:05', checkOut: '12:05', editReason: 'Sửa theo camera',
  },
  metadata: { changedFields: ['checkIn', 'checkOut'], reason: 'Sửa theo camera' },
}, {
  id: 42,
  action: 'employee.delete',
  entityType: 'employee',
  entityId: 'ST-002',
  actorId: 'admin-1',
  actorRole: 'admin',
  serverTimestamp: '2026-09-02T08:00:00.000Z',
  before: {
    id: 'ST-002', name: 'Trần Thị Ngọc Bích', storeId: 'S02', unit: 'store',
    status: 'Đang làm việc', phone: '0909000002', position: 'Nhân viên bán hàng', startDate: '2026-08-01',
  },
  after: null,
  metadata: { reason: 'Xóa nhầm hồ sơ' },
}, {
  id: 41,
  action: 'order.update',
  entityType: 'order',
  entityId: 'ORDER-001',
  actorId: 'support-1',
  actorRole: 'business_support',
  serverTimestamp: '2026-09-02T07:00:00.000Z',
  before: {
    id: 'ORDER-001', code: 'NTL-00001', storeId: 'S01', date: '2026-09-02',
    customerName: 'Khách A', customerPhone: '0909000001', employeeId: 'E01', employeeName: 'Nguyễn An',
    shiftName: 'Ca sáng', paymentMethod: 'Tiền mặt', amount: 100000,
  },
  after: {
    id: 'ORDER-001', code: 'NTL-00001', storeId: 'S01', date: '2026-09-02',
    customerName: 'Khách A', customerPhone: '0909000001', employeeId: 'E01', employeeName: 'Nguyễn An',
    shiftName: 'Ca sáng', paymentMethod: 'Chuyển khoản', amount: 100000,
  },
  metadata: { changedFields: ['paymentMethod'], reason: 'Khách chuyển khoản' },
}, {
  id: 40,
  action: 'order.delete',
  entityType: 'order',
  entityId: 'ORDER-002',
  actorId: 'admin-1',
  actorRole: 'admin',
  serverTimestamp: '2026-09-02T06:00:00.000Z',
  before: {
    id: 'ORDER-002', code: 'TNV-00002', storeId: 'S02', date: '2026-09-02',
    customerName: 'Khách B', employeeName: 'Nhân viên B', shiftName: 'Ca chiều',
    paymentMethod: 'Tiền mặt', amount: 250000,
  },
  after: null,
  metadata: { reason: 'Đơn trùng' },
}]

const baseApp = () => ({
  session: { role: 'admin', name: 'Admin' },
  stores: [{ id: 'S01', name: 'Dosii NTL' }, { id: 'S02', name: 'SM TNV' }],
  employees: [{ id: 'E01', code: 'NV-01', name: 'Nguyễn An', storeId: 'S01', unit: 'store' }, {
    id: 'BS01', name: 'Trần HTKD', storeId: 'BUSINESS_SUPPORT', unit: 'business_support',
  }, {
    id: 'OF01', name: 'Lê Văn Phòng', storeId: 'OFFICE', unit: 'office',
  }],
  attendance: [{
    id: 'ATT-01', employeeId: 'NV-01', storeId: 'S01', date: '2026-09-03',
    shiftName: 'Ca sáng', shiftStart: '08:00', shiftEnd: '12:00',
    checkIn: '08:05', checkInAt: '2026-09-03T01:05:00.000Z',
    checkOut: '12:05', checkOutAt: '2026-09-03T05:05:00.000Z', status: 'Đã ghi nhận',
  }],
  updateAttendance: vi.fn().mockResolvedValue({ ok: true }),
  restoreOperationalData: vi.fn().mockResolvedValue({ ok: true, restoredCount: 1 }),
  notify: vi.fn(),
})

describe('Admin data restore workspace', () => {
  beforeEach(() => {
    mocked.app = baseApp()
    mocked.apiGetAudit.mockReset().mockResolvedValue({ audit: auditRows() })
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('shows three required tabs and lets Admin edit attendance with a complete audit history', async () => {
    render(<DataRestorePage />)

    expect(await screen.findByRole('tab', { name: /CHẤM CÔNG/i })).toBeTruthy()
    expect(screen.getByRole('tab', { name: /^ĐƠN HÀNG/i })).toBeTruthy()
    expect(screen.getByRole('tab', { name: /THÔNG TIN NHÂN VIÊN ĐÃ XÓA/i })).toBeTruthy()
    expect(mocked.apiGetAudit).toHaveBeenCalledWith({ limit: 100, beforeId: 0 })

    fireEvent.change(screen.getByLabelText(/Ngày làm việc/i), { target: { value: '2026-09-03' } })
    fireEvent.change(screen.getByLabelText(/^Cửa hàng/i), { target: { value: 'S01' } })
    fireEvent.change(screen.getByLabelText(/^Nhân viên/i), { target: { value: 'E01' } })

    expect(screen.getAllByText('08:05').length).toBeGreaterThan(0)
    expect(screen.getByText('Sửa theo camera')).toBeTruthy()
    expect(screen.getByText('08:00 → 08:05')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /SỬA THỜI GIAN/i }))
    fireEvent.change(screen.getByLabelText(/Giờ điểm danh/i), { target: { value: '08:15' } })
    fireEvent.change(screen.getByLabelText(/Giờ kết ca/i), { target: { value: '12:15' } })
    fireEvent.change(screen.getByLabelText(/Lý do chỉnh sửa/i), { target: { value: 'Đối chiếu camera cửa hàng' } })
    fireEvent.click(screen.getByRole('button', { name: /^LƯU$/i }))

    await waitFor(() => expect(mocked.app.updateAttendance).toHaveBeenCalledWith('ATT-01', {
      date: '2026-09-03',
      checkIn: '08:15',
      checkOut: '12:15',
      reason: 'Đối chiếu camera cửa hàng',
    }))
    await waitFor(() => expect(mocked.apiGetAudit).toHaveBeenCalledTimes(2))
  })

  it('shows full order change information and restores the exact selected audit version', async () => {
    render(<DataRestorePage />)
    await screen.findByRole('tab', { name: /^ĐƠN HÀNG/i })
    fireEvent.click(screen.getByRole('tab', { name: /^ĐƠN HÀNG/i }))

    const orderCode = await screen.findByText('NTL-00001')
    const row = orderCode.closest('tr')
    expect(within(row).getByText('Dosii NTL')).toBeTruthy()
    expect(within(row).getByText(/Khách A/)).toBeTruthy()
    expect(within(row).getByText(/Tiền mặt → Chuyển khoản/)).toBeTruthy()
    expect(within(row).getByText('support-1')).toBeTruthy()

    fireEvent.click(within(row).getByRole('button', { name: /^KHÔI PHỤC$/i }))
    fireEvent.change(screen.getByLabelText(/Lý do khôi phục/i), { target: { value: 'Khôi phục hình thức thanh toán ban đầu' } })
    fireEvent.click(screen.getByRole('button', { name: /^KHÔI PHỤC DỮ LIỆU$/i }))

    await waitFor(() => expect(mocked.app.restoreOperationalData).toHaveBeenCalledWith({
      dataType: 'orders',
      auditLogId: 41,
      storeId: 'S01',
      fromDate: '2026-09-02',
      toDate: '2026-09-02',
      employeeId: 'E01',
      reason: 'Khôi phục hình thức thanh toán ban đầu',
    }))
  })

  it('lists deleted employee information and reactivates the selected employee through the original deletion audit', async () => {
    render(<DataRestorePage />)
    await screen.findByRole('tab', { name: /THÔNG TIN NHÂN VIÊN ĐÃ XÓA/i })
    fireEvent.click(screen.getByRole('tab', { name: /THÔNG TIN NHÂN VIÊN ĐÃ XÓA/i }))

    const employeeName = await screen.findByText('Trần Thị Ngọc Bích')
    const row = employeeName.closest('tr')
    expect(within(row).getByText('ST-002')).toBeTruthy()
    expect(within(row).getByText('SM TNV')).toBeTruthy()
    expect(within(row).getByText('0909000002')).toBeTruthy()

    fireEvent.click(within(row).getByRole('button', { name: /^KHÔI PHỤC$/i }))
    fireEvent.change(screen.getByLabelText(/Lý do khôi phục/i), { target: { value: 'Khôi phục nhân viên bị xóa nhầm' } })
    fireEvent.click(screen.getByRole('button', { name: /^KHÔI PHỤC DỮ LIỆU$/i }))

    await waitFor(() => expect(mocked.app.restoreOperationalData).toHaveBeenCalledWith({
      dataType: 'employees',
      auditLogId: 42,
      storeId: 'S02',
      reason: 'Khôi phục nhân viên bị xóa nhầm',
    }))
  })

  it('keeps the workspace unavailable to non-Admin roles', () => {
    mocked.app = { ...baseApp(), session: { role: 'business_support', name: 'HTKD' } }
    render(<DataRestorePage />)

    expect(screen.getByRole('heading', { name: /Không có quyền truy cập/i })).toBeTruthy()
    expect(mocked.apiGetAudit).not.toHaveBeenCalled()
  })
})
