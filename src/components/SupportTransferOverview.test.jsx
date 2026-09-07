import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SupportTransferOverview } from './SupportTransferOverview'

const mocked = vi.hoisted(() => ({ app: {} }))
vi.mock('../state/AppContext', () => ({ useApp: () => mocked.app }))
const transfer = { id: 'T1', employeeId: 'E1', employeeName: 'Nguyễn An', fromStoreId: 'A', toStoreId: 'B',
  startAt: '2026-09-08T01:00:00Z', endAt: '2026-09-08T10:00:00Z', status: 'Đã duyệt' }
const show = () => render(<MemoryRouter><SupportTransferOverview /></MemoryRouter>)
describe('support transfer home notice', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-07T05:00:00Z'))
    mocked.app = { session: { role: 'employee', employeeId: 'E1', storeId: 'A' },
      stores: [{ id: 'A', name: 'Cửa hàng chính' }, { id: 'B', name: 'Cửa hàng nhận' }],
      supportTransfers: [transfer], attendance: [], schedule: [] }
  })
  afterEach(() => { cleanup(); vi.useRealTimers() })
  it.each(['employee', 'home', 'host'])('shows future support and the existing orange tag to %s', (viewer) => {
    if (viewer !== 'employee') mocked.app.session = { role: 'store_manager', storeId: viewer === 'home' ? 'A' : 'B' }
    show()
    expect(screen.getByText('Nguyễn An')).toBeTruthy()
    expect(screen.getByText('Cửa hàng chính → Cửa hàng nhận')).toBeTruthy()
    expect(screen.getByText('Nhân viên hỗ trợ • Từ Cửa hàng chính').className).toContain('badge--orange')
    expect(screen.getByText('Chờ phân ca hỗ trợ')).toBeTruthy()
  })
  it('keeps an expired stopped grant visible until actual checkout', () => {
    mocked.app.supportTransfers = [{ ...transfer, schedulingClosedAt: '2026-09-07T06:00:00Z' }]
    mocked.app.attendance = [{ employeeId: 'E1', storeId: 'B', supportTransferId: 'T1', checkInAt: '2026-09-08T01:00:00Z' }]
    vi.setSystemTime(new Date('2026-09-09T05:00:00Z'))
    show()
    expect(screen.getByText('Đã dừng phân ca — Chưa kết ca')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Xem ca đang làm' })).toBeTruthy()
  })
  it('does not show another employee or an unrelated store', () => {
    mocked.app.session.employeeId = 'OTHER'
    const view = show()
    expect(screen.queryByText('Nguyễn An')).toBeNull()
    view.unmount()
    mocked.app.session = { role: 'store_manager', storeId: 'OTHER' }
    show()
    expect(screen.queryByText('Nguyễn An')).toBeNull()
  })
})
