import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SupportTransferOverview } from './SupportTransferOverview'
import { EmployeeSchedulePage } from '../pages/employee/EmployeeSchedulePage'

const mocked = vi.hoisted(() => ({ app: {} }))
vi.mock('../state/AppContext', () => ({ useApp: () => mocked.app }))
const transfer = { id: 'T1', employeeId: 'E1', employeeName: 'Nguyễn An', fromStoreId: 'A', toStoreId: 'B',
  fromDate: '2026-09-08', toDate: '2026-09-08', status: 'Đã duyệt' }
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
    expect(screen.getByText('08/09/2026 – 08/09/2026')).toBeTruthy()
    expect(screen.queryByText(/00:00/)).toBeNull()
    expect(screen.getByText('Chờ phân ca hỗ trợ')).toBeTruthy()
    expect(screen.getByText('Cửa hàng nhận có thể phân ca trong khoảng ngày điều chuyển.')).toBeTruthy()
  })
  it('keeps an expired stopped grant visible until actual checkout', () => {
    mocked.app.supportTransfers = [{ ...transfer, schedulingClosedAt: '2026-09-07T06:00:00Z' }]
    mocked.app.attendance = [{ employeeId: 'E1', storeId: 'B', supportTransferId: 'T1', checkInAt: '2026-09-08T01:00:00Z' }]
    vi.setSystemTime(new Date('2026-09-09T05:00:00Z'))
    show()
    expect(screen.getByText('Đã dừng phân ca — Chưa kết ca')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Xem ca đang làm' })).toBeTruthy()
  })
  it('keeps a legacy exact-time constraint visible', () => {
    mocked.app.supportTransfers = [{
      ...transfer,
      fromDate: undefined,
      toDate: undefined,
      startAt: '2026-09-08T01:00:00Z',
      endAt: '2026-09-08T10:00:00Z',
    }]
    show()
    expect(screen.getByText('08/09/2026 08:00 – 08/09/2026 17:00')).toBeTruthy()
  })
  it.each([
    [{}, '2026-09-08'],
    [{ startAt: '2026-09-08T18:00:00Z', endAt: '2026-09-08T22:00:00Z' }, '2026-09-09'],
    [{ startAt: '', endAt: '', fromDate: '2026-09-10', toDate: '2026-09-11' }, '2026-09-10'],
  ])('opens the actual schedule on the Vietnam start date of the clicked transfer', (dates, expectedDate) => {
    mocked.app.supportTransfers = [{ ...transfer, ...dates }]
    render(<MemoryRouter initialEntries={['/employee/home']}><Routes>
      <Route path="/employee/home" element={<SupportTransferOverview />} />
      <Route path="/employee/schedule" element={<EmployeeSchedulePage />} />
    </Routes></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: 'Xem lịch' }))
    expect(screen.getByLabelText('Chọn ngày').value).toBe(expectedDate)
    expect(screen.getByText('Chưa có lịch phân ca trong phạm vi đã chọn.')).toBeTruthy()
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
