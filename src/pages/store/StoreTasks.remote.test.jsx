import { cleanup, fireEvent, render, screen, waitFor, act } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { StoreTasks } from './StoreOperations'
const mocked = vi.hoisted(() => ({ app: {}, history: vi.fn(), violations: vi.fn() }))
vi.mock('../../state/AppContext', () => ({ useApp: () => mocked.app }))
vi.mock('../../services/idosiApi', () => ({ apiGetStoreTaskHistory: (...args) => mocked.history(...args), apiGetStoreScreenState: (...args) => mocked.violations(...args), apiGetIdentityImage: vi.fn() }))
const payload = (id, hasMore = false) => ({ state: {
  employees: [{ id: 'E1', name: 'Nhân viên', storeId: 'S1', unit: 'store' }],
  attendance: [{ id, storeId: 'S1', employeeId: 'E1', workDate: '2026-09-30', shiftId: 'ca1', checklistSnapshot: { tasks: [{ id: 'R1', kind: 'REWARD_TASK', name: `Thưởng ${id}`, amountVnd: 3000 }] } }],
  workCatalogProgress: [{ id: `P${id}`, attendanceId: id, catalogItemId: 'R1', checked: true }], tasks: [], compensationEntries: [], violations: [], violationPointSummaries: [], taskAssignmentHistory: [],
}, page: { hasMore, nextCursor: hasMore ? 'next-page' : null } })
const renderPage = () => render(<MemoryRouter><StoreTasks /></MemoryRouter>)
beforeEach(() => {
  mocked.app = { session: { role: 'admin' }, remoteProjection: { kind: 'store' }, activeStoreId: 'S1', stores: [{ id: 'S1', name: 'Cửa hàng 1' }, { id: 'S2', name: 'Cửa hàng 2' }], employees: [{ id: 'E1', name: 'Nhân viên', storeId: 'S1', unit: 'store' }], attendance: [], tasks: [], violations: [], workCatalogItems: [], shiftDefinitions: [{ id: 'ca1', name: 'Ca sáng' }] }
  mocked.history.mockReset().mockResolvedValue(payload('A1', true))
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
