import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { UnitCompensationStatistics } from './UnitCompensationStatistics'
import { ViolationManagementPage } from './ViolationManagementPage'

const mocked = vi.hoisted(() => ({ app: {} }))
vi.mock('../../state/AppContext', () => ({ useApp: () => mocked.app }))

const employee = { id: 'VP-01', name: 'Nhân viên văn phòng', unit: 'office' }
const reward = (id, workDate, extra = {}) => ({
  id, workDate, employeeId: employee.id, title: id, amountVnd: 3000,
  completed: true, payoutStatus: 'approved', ...extra,
})
const violation = (id, occurredOn, extra = {}) => ({
  id, occurredOn, targetUnit: 'office', employeeId: employee.id,
  title: id, status: 'ACTIVE', violationPoints: 0.5, ...extra,
})
const card = (title) => screen.getByRole('heading', { name: title, exact: true }).closest('section')
const changeMonth = (label, value) => fireEvent.change(screen.getByLabelText(label), { target: { value } })

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-13T03:00:00Z'))
  mocked.app = {
    session: { role: 'admin' }, employees: [employee], stores: [],
    violations: [], attendance: [], compensationEntries: [],
    notify: vi.fn(), createViolationBatch: vi.fn(), voidViolation: vi.fn(),
  }
})
afterEach(() => { cleanup(); vi.useRealTimers() })

describe('office history month filters', () => {
  it('filters rewards by business month and year, keeps statuses and totals, and clears to all months', () => {
    const rows = [
      reward('Đầu tháng', '2026-09-01', { completedAt: '2026-10-01T02:00:00Z' }),
      reward('Cuối tháng', '2026-09-30', { payoutStatus: 'pending', amountVnd: 5000 }),
      reward('Tháng mười', '2026-10-01'),
      reward('Năm trước', '2025-09-30'),
      reward('Đã hủy', '2026-09-02', { payoutStatus: 'void' }),
      reward('Chưa làm', '2026-09-03', { completed: false }),
    ]
    const before = JSON.stringify(rows)
    render(<UnitCompensationStatistics targetUnit="office" rewardRows={rows} sections="reward" />)
    const history = card('Lịch sử nhận thưởng — Khối văn phòng')
    const summary = card('Thống kê thưởng — Khối văn phòng')
    const summaryBefore = summary.textContent
    expect(screen.getByLabelText('Tháng nhận thưởng').value).toBe('')
    expect(within(history.querySelector('thead')).getByText('+14,000 đ')).toBeTruthy()

    changeMonth('Tháng nhận thưởng', '2026-09')
    expect(within(history.querySelector('thead')).getByText('+8,000 đ')).toBeTruthy()
    expect(within(history).getByText('Đầu tháng')).toBeTruthy()
    expect(within(history).getByText('Cuối tháng')).toBeTruthy()
    expect(within(history).getByText('Chờ duyệt team')).toBeTruthy()
    for (const title of ['Tháng mười', 'Năm trước', 'Đã hủy', 'Chưa làm']) {
      expect(within(history).queryByText(title)).toBeNull()
    }
    changeMonth('Tháng nhận thưởng', '2025-09')
    expect(within(history).getByText('Năm trước')).toBeTruthy()
    expect(within(history).queryByText('Đầu tháng')).toBeNull()
    changeMonth('Tháng nhận thưởng', '2026-12')
    expect(within(history).getByText('Không có lịch sử phù hợp bộ lọc.')).toBeTruthy()
    expect(within(history.querySelector('thead')).getByText('+0 đ')).toBeTruthy()
    fireEvent.click(within(history).getByRole('button', { name: 'Tất cả tháng' }))
    expect(screen.getByLabelText('Tháng nhận thưởng').value).toBe('')
    expect(within(history.querySelector('thead')).getByText('+14,000 đ')).toBeTruthy()
    expect(summary.textContent).toBe(summaryBefore)
    expect(JSON.stringify(rows)).toBe(before)
  })

  it('resets reward pagination when switching or clearing months', () => {
    const rows = ['2026-09', '2026-10'].flatMap((month) => Array.from({ length: 25 }, (_, i) => (
      reward(`${month}-reward-${i}`, `${month}-01`)
    )))
    render(<UnitCompensationStatistics targetUnit="office" rewardRows={rows} sections="reward" />)
    const history = card('Lịch sử nhận thưởng — Khối văn phòng')
    changeMonth('Tháng nhận thưởng', '2026-09')
    fireEvent.click(within(history).getByRole('button', { name: 'Trang 2' }))
    expect(within(history).getByText('2026-09-reward-24')).toBeTruthy()
    changeMonth('Tháng nhận thưởng', '2026-10')
    expect(within(history).getByText('2026-10-reward-0')).toBeTruthy()
    expect(within(history).queryByText('2026-10-reward-24')).toBeNull()
    fireEvent.click(within(history).getByRole('button', { name: 'Trang 2' }))
    fireEvent.click(within(history).getByRole('button', { name: 'Tất cả tháng' }))
    expect(within(history).getByText('2026-09-reward-0')).toBeTruthy()
  })

  it.each(['admin', 'business_support'])('filters office violations independently of assessment and mutations for %s', (role) => {
    mocked.app.session.role = role
    mocked.app.violations = [
      violation('Hiện tại', '2026-10-01'),
      violation('Lịch sử tiền', '2026-09-01', { violationPoints: null, amountVnd: 3000 }),
      violation('Điểm đã hủy', '2026-09-30', { status: 'VOID' }),
      violation('Năm trước', '2025-09-01'),
      violation('Đơn vị khác', '2026-09-01', { targetUnit: 'business_support' }),
      violation('Kỳ theo giờ Việt Nam', '', { createdAt: '2026-08-31T18:00:00Z' }),
    ]
    const before = JSON.stringify(mocked.app.violations)
    render(<ViolationManagementPage targetUnit="office" embedded />)
    const history = card('Lịch sử vi phạm')
    expect(screen.getByLabelText('Tháng vi phạm').value).toBe('2026-10')
    expect(within(history).getByText('Hiện tại')).toBeTruthy()
    changeMonth('Tháng vi phạm', '2026-09')
    expect(within(history).getByText('Lịch sử tiền')).toBeTruthy()
    expect(within(history).getByText('Điểm đã hủy')).toBeTruthy()
    expect(within(history).getByText('Kỳ theo giờ Việt Nam')).toBeTruthy()
    expect(within(history).getByText('2 đang hiệu lực')).toBeTruthy()
    expect(within(history).queryByText('Đơn vị khác')).toBeNull()
    expect(within(history).queryByText('Năm trước')).toBeNull()
    expect(screen.getByLabelText('Kỳ đánh giá vi phạm').value).toBe('2026-10')
    changeMonth('Kỳ đánh giá vi phạm', '2026-08')
    expect(within(history).getByText('Lịch sử tiền')).toBeTruthy()
    changeMonth('Tháng vi phạm', '2025-09')
    expect(within(history).getByText('Năm trước')).toBeTruthy()
    changeMonth('Tháng vi phạm', '2026-12')
    expect(within(history).getByText('Không có lịch sử phù hợp bộ lọc.')).toBeTruthy()
    fireEvent.click(within(history).getByRole('button', { name: 'Tất cả tháng' }))
    expect(within(history).getByText('Hiện tại')).toBeTruthy()
    expect(within(history).getByText('4 đang hiệu lực')).toBeTruthy()
    expect(mocked.app.createViolationBatch).not.toHaveBeenCalled()
    expect(mocked.app.voidViolation).not.toHaveBeenCalled()
    expect(JSON.stringify(mocked.app.violations)).toBe(before)
  })

  it('resets violation pagination and supports clearing the native month input', () => {
    mocked.app.violations = ['2026-09', '2026-10'].flatMap((month) => Array.from({ length: 25 }, (_, i) => (
      violation(`${month}-violation-${i}`, `${month}-01`)
    )))
    render(<ViolationManagementPage targetUnit="office" embedded />)
    const history = card('Lịch sử vi phạm')
    fireEvent.click(within(history).getByRole('button', { name: 'Trang 2' }))
    expect(within(history).getByText('2026-10-violation-24')).toBeTruthy()
    changeMonth('Tháng vi phạm', '2026-09')
    expect(within(history).getByText('2026-09-violation-0')).toBeTruthy()
    expect(within(history).queryByText('2026-09-violation-24')).toBeNull()
    changeMonth('Tháng vi phạm', '')
    expect(within(history).getByText('2026-10-violation-0')).toBeTruthy()
    expect(within(history).getByText('50 đang hiệu lực')).toBeTruthy()
  })

  it.each(['store', 'business_support'])('does not add month filters to %s histories', (targetUnit) => {
    render(<><ViolationManagementPage targetUnit={targetUnit} embedded /><UnitCompensationStatistics targetUnit={targetUnit} /></>)
    expect(screen.queryByLabelText('Tháng vi phạm')).toBeNull()
    expect(screen.queryByLabelText('Tháng nhận thưởng')).toBeNull()
    expect(screen.getByLabelText('Ngày vi phạm')).toBeTruthy()
  })
})
