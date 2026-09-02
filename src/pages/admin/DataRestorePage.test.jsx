import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DataRestorePage } from './DataRestorePage'

const mocked = vi.hoisted(() => ({
  session: { role: 'admin', name: 'Admin' },
  apiGetAudit: vi.fn(),
  restoreOperationalData: vi.fn(),
  notify: vi.fn(),
}))

vi.mock('../../services/idosiApi', () => ({
  apiGetAudit: mocked.apiGetAudit,
}))

vi.mock('../../state/AppContext', () => ({
  useApp: () => ({
    session: mocked.session,
    restoreOperationalData: mocked.restoreOperationalData,
    notify: mocked.notify,
  }),
}))

describe('Admin data restore', () => {
  beforeEach(() => {
    mocked.session = { role: 'admin', name: 'Admin' }
    mocked.apiGetAudit.mockReset().mockResolvedValue({
      audit: [{
        id: 42, action: 'employee.delete', entityType: 'employee', entityId: 'ST-002',
        actorId: 'admin-1', actorRole: 'admin', serverTimestamp: '2026-09-02T08:00:00.000Z',
        before: { id: 'ST-002', name: 'Trần Thị Ngọc Bích', storeId: 'SM-TNV', status: 'Đang làm việc' },
        after: null, metadata: null,
      }, {
        id: 41, action: 'order.update', entityType: 'order', entityId: 'ORDER-001',
        actorId: 'support-1', actorRole: 'business_support', serverTimestamp: '2026-09-02T07:00:00.000Z',
        before: { id: 'ORDER-001', storeId: 'SM-TNV', date: '2026-09-02', paymentMethod: 'Tiền mặt' },
        after: { id: 'ORDER-001', storeId: 'SM-TNV', date: '2026-09-02', paymentMethod: 'Chuyển khoản' },
        metadata: { changedFields: ['paymentMethod'] },
      }],
    })
    mocked.restoreOperationalData.mockReset().mockResolvedValue({ ok: true, restoredCount: 1 })
    mocked.notify.mockReset()
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('loads real audit rows and restores the exact employee deletion selected by Admin', async () => {
    render(<DataRestorePage />)

    expect(await screen.findByText('ST-002')).toBeTruthy()
    expect(screen.getByText('ORDER-001')).toBeTruthy()
    expect(mocked.apiGetAudit).toHaveBeenCalledWith({ limit: 100, beforeId: 0 })

    const restoreButtons = screen.getAllByRole('button', { name: /^Khôi phục$/i })
    fireEvent.click(restoreButtons[0])
    fireEvent.change(screen.getByLabelText(/Lý do khôi phục/i), {
      target: { value: 'Khôi phục hồ sơ bị xóa nhầm' },
    })
    fireEvent.click(screen.getByRole('button', { name: /^Khôi phục dữ liệu$/i }))

    await waitFor(() => expect(mocked.restoreOperationalData).toHaveBeenCalledWith({
      dataType: 'employees',
      auditLogId: 42,
      storeId: 'SM-TNV',
      reason: 'Khôi phục hồ sơ bị xóa nhầm',
    }))
    await waitFor(() => expect(mocked.apiGetAudit).toHaveBeenCalledTimes(2))
  })

  it('keeps the page unavailable to non-Admin roles', () => {
    mocked.session = { role: 'business_support', name: 'HTKD' }
    render(<DataRestorePage />)

    expect(screen.getByRole('heading', { name: /Không có quyền truy cập/i })).toBeTruthy()
    expect(mocked.apiGetAudit).not.toHaveBeenCalled()
  })
})
