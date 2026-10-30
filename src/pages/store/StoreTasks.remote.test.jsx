import { cleanup, fireEvent, render, screen, waitFor, act } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { StoreTasks } from './StoreOperations'
import { money } from '../../utils'
const mocked = vi.hoisted(() => ({ app: {}, history: vi.fn(), summary: vi.fn(), violations: vi.fn() }))
vi.mock('../../state/AppContext', () => ({ useApp: () => mocked.app }))
vi.mock('../../services/idosiApi', () => ({ apiGetStoreTaskHistory: (...args) => mocked.history(...args), apiGetStoreTaskSummary: (...args) => mocked.summary(...args), apiGetStoreScreenState: (...args) => mocked.violations(...args), apiGetIdentityImage: vi.fn() }))
const payload = (id, hasMore = false) => ({ state: {
  employees: [{ id: 'E1', name: 'Nhân viên', storeId: 'S1', unit: 'store' }],
  attendance: [{ id, storeId: 'S1', employeeId: 'E1', workDate: '2026-09-30', shiftId: 'ca1', checklistSnapshot: { tasks: [{ id: 'R1', kind: 'REWARD_TASK', name: `Thưởng ${id}`, amountVnd: 3000 }] } }],
  workCatalogProgress: [{ id: `P${id}`, attendanceId: id, catalogItemId: 'R1', checked: true }], tasks: [], compensationEntries: [], violations: [], violationPointSummaries: [], taskAssignmentHistory: [],
}, page: { hasMore, nextCursor: hasMore ? 'next-page' : null } })
const summaryPayload = (amount = 93000) => ({ summary: { count: 31, totalAmountVnd: amount, statistics: {
  byEmployee: [{ key: 'E1', label: 'Nhân viên', count: 30, amountVnd: amount - 3000 }],
  byDay: [{ key: '2026-09-30', label: '30/09/2026', count: 30, amountVnd: amount - 3000 }],
  byMonth: [{ key: '2026-09', label: 'Tháng 09/2026', count: 30, amountVnd: amount - 3000 }],
} } })
const renderPage = () => render(<MemoryRouter><StoreTasks /></MemoryRouter>)
beforeEach(() => {
  mocked.app = { session: { role: 'admin' }, remoteProjection: { kind: 'store' }, activeStoreId: 'S1', stores: [{ id: 'S1', name: 'Cửa hàng 1' }, { id: 'S2', name: 'Cửa hàng 2' }], employees: [{ id: 'E1', name: 'Nhân viên', storeId: 'S1', unit: 'store' }], attendance: [], tasks: [], violations: [], workCatalogItems: [], shiftDefinitions: [{ id: 'ca1', name: 'Ca sáng' }] }
  mocked.history.mockReset().mockResolvedValue(payload('A1', true))
  mocked.summary.mockReset().mockResolvedValue(summaryPayload())
  mocked.violations.mockReset().mockResolvedValue({ state: { ...mocked.app, session: null, attendance: [], violations: [] } })
})
afterEach(cleanup)
it('loads exactly the first page, then requests next/back/filter pages only after interaction', async () => {
  renderPage()
  await screen.findByText('Thưởng A1')
  expect(mocked.history).toHaveBeenCalledTimes(1)
  expect(mocked.violations).not.toHaveBeenCalled()
  mocked.history.mockResolvedValueOnce(payload('A2'))
  fireEvent.click(screen.getByRole('button', { name: 'Trang sau' }))
  await screen.findByText('Thưởng A2')
  expect(screen.queryByText('Thưởng A1')).toBeNull()
  expect(mocked.history).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: 'next-page' }))
  fireEvent.change(screen.getByLabelText('Ngày nhận thưởng'), { target: { value: '2026-09-01' } })
  await waitFor(() => expect(mocked.history).toHaveBeenCalledTimes(3))
  expect(mocked.history).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: '', date: '2026-09-01' }))
  expect(screen.getByRole('button', { name: 'Trang trước' }).disabled).toBe(true)
})
it('ignores stale responses and resets the cursor when switching stores', async () => {
  const view = renderPage()
  await screen.findByText('Thưởng A1')
  let resolveOld
  mocked.history.mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve }))
  fireEvent.click(screen.getByRole('button', { name: 'Trang sau' }))
  mocked.app = { ...mocked.app, activeStoreId: 'S2' }
  mocked.history.mockResolvedValue(payload('NEW'))
  view.rerender(<MemoryRouter><StoreTasks /></MemoryRouter>)
  await waitFor(() => expect(mocked.history).toHaveBeenLastCalledWith(expect.objectContaining({ storeId: 'S2', cursor: '' })))
  await act(async () => resolveOld(payload('STALE')))
  expect(screen.queryByText('Thưởng STALE')).toBeNull()
})
it('retries a failed page and loads violation data only after selecting the tab', async () => {
  mocked.history.mockRejectedValueOnce(new Error('Lỗi mạng thử nghiệm'))
  renderPage()
  await screen.findByText(/Lỗi mạng thử nghiệm/)
  fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }))
  await screen.findByText('Thưởng A1')
  expect(mocked.history).toHaveBeenCalledTimes(2)
  fireEvent.click(screen.getByRole('tab', { name: /Vi phạm/ }))
  await waitFor(() => expect(mocked.violations).toHaveBeenCalledTimes(1))
  expect(mocked.violations).toHaveBeenCalledWith('S1', 'task-violations', expect.objectContaining({ period: expect.stringMatching(/^\d{4}-\d{2}$/) }))
  await screen.findByRole('heading', { name: 'Ghi nhận vi phạm' })
  expect(screen.queryByText(/Chỉ Admin và Nhân viên hỗ trợ KD được quản lý/)).toBeNull()
})

it('keeps full filtered totals and statistics while navigating pages, and refreshes them only for changed filters', async () => {
  renderPage()
  await screen.findByText('Thưởng A1')
  await waitFor(() => expect(screen.getByRole('columnheader', { name: /Tiền thưởng/ }).textContent).toContain(money(93000)))
  expect(screen.getByRole('tab', { name: /Thưởng công việc 31/ })).toBeTruthy()
  expect(screen.getAllByText('+' + money(90000))).toHaveLength(3)
  expect(mocked.summary).toHaveBeenCalledTimes(1)
  let finishPage
  mocked.history.mockImplementationOnce(() => new Promise((resolve) => { finishPage = resolve }))
  fireEvent.click(screen.getByRole('button', { name: 'Trang sau' }))
  expect(screen.getByRole('columnheader', { name: /Tiền thưởng/ }).textContent).toContain(money(93000))
  expect(screen.getAllByText('+' + money(90000))).toHaveLength(3)
  expect(screen.getByText('Đang tải danh sách...')).toBeTruthy()
  await act(async () => finishPage(payload('A2')))
  await screen.findByText('Thưởng A2')
  expect(mocked.summary).toHaveBeenCalledTimes(1)
  expect(screen.getByRole('columnheader', { name: /Tiền thưởng/ }).textContent).toContain(money(93000))
  mocked.summary.mockResolvedValueOnce(summaryPayload(6000))
  fireEvent.change(screen.getByLabelText('Ngày nhận thưởng'), { target: { value: '2026-09-01' } })
  await waitFor(() => expect(mocked.summary).toHaveBeenCalledTimes(2))
  expect(mocked.summary).toHaveBeenLastCalledWith(expect.objectContaining({ storeId: 'S1', date: '2026-09-01', employeeId: '', shiftId: '' }))
  expect(mocked.summary.mock.calls[1][0]).not.toHaveProperty('cursor')
  await waitFor(() => expect(screen.getByRole('columnheader', { name: /Tiền thưởng/ }).textContent).toContain(money(6000)))
  expect(screen.queryByText(/trang hiện tại/)).toBeNull()
})
it('does not present a page subtotal when the full summary fails and can retry independently', async () => {
  mocked.summary.mockRejectedValueOnce(new Error('Lỗi tổng hợp thử nghiệm'))
  renderPage()
  await screen.findByText('Thưởng A1')
  await screen.findByText(/Lỗi tổng hợp thử nghiệm/)
  expect(screen.getByRole('columnheader', { name: /Tiền thưởng/ }).textContent).toContain('Đang tổng hợp')
  expect(screen.queryByRole('heading', { name: /Thống kê thưởng theo bộ lọc/ })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Thử lại thống kê' }))
  await waitFor(() => expect(screen.getByRole('columnheader', { name: /Tiền thưởng/ }).textContent).toContain(money(93000)))
  expect(mocked.history).toHaveBeenCalledTimes(1)
})
it('ignores a late summary from the previous filter', async () => {
  let finishOldSummary
  mocked.summary.mockImplementationOnce(() => new Promise((resolve) => { finishOldSummary = resolve }))
  renderPage()
  await screen.findByText('Thưởng A1')
  mocked.summary.mockResolvedValueOnce(summaryPayload(6000))
  fireEvent.change(screen.getByLabelText('Nhân viên nhận thưởng'), { target: { value: 'E1' } })
  await waitFor(() => expect(screen.getByRole('columnheader', { name: /Tiền thưởng/ }).textContent).toContain(money(6000)))
  await act(async () => finishOldSummary(summaryPayload(93000)))
  expect(screen.getByRole('columnheader', { name: /Tiền thưởng/ }).textContent).toContain(money(6000))
})
