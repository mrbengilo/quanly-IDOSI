import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { WorkCatalogSettingsPage } from './WorkCatalogSettingsPage'

const mocked = vi.hoisted(() => ({ app: {} }))
vi.mock('../../state/AppContext', () => ({ useApp: () => mocked.app }))
beforeEach(() => {
  mocked.app = { session: { role: 'admin' }, stores: [], workCatalogItems: [], notify: vi.fn(),
    createWorkCatalogItem: vi.fn().mockResolvedValue({ ok: true }) }
})
afterEach(cleanup)

it.each(['Công việc cố định', 'Công việc nhận thưởng', 'Vi phạm'])('creates %s and safely retries an unknown save outcome', async (kind) => {
  mocked.app.createWorkCatalogItem.mockRejectedValueOnce(Object.assign(new Error('Timeout'), { code: 'TIMEOUT' }))
  render(<WorkCatalogSettingsPage />)
  fireEvent.click(screen.getByRole('button', { name: 'THÊM DANH MỤC' }))
  fireEvent.change(screen.getByLabelText(/Loại danh mục \*/u, { selector: 'select' }), {
    target: { value: { 'Công việc cố định': 'FIXED_TASK', 'Công việc nhận thưởng': 'REWARD_TASK', 'Vi phạm': 'VIOLATION' }[kind] },
  })
  fireEvent.change(screen.getByPlaceholderText('Nhập tên công việc hoặc vi phạm'), { target: { value: `Mục ${kind}` } })
  if (kind === 'Vi phạm') fireEvent.change(screen.getByLabelText('Điểm vi phạm'), { target: { value: '0.5' } })
  if (kind === 'Công việc nhận thưởng') fireEvent.change(screen.getByPlaceholderText('Nhập đúng số tiền bằng đồng'), { target: { value: '3000' } })
  fireEvent.click(screen.getByRole('button', { name: 'LƯU', exact: true }))
  await waitFor(() => expect(mocked.app.notify).toHaveBeenCalledWith(expect.stringContaining('tránh tạo trùng'), 'info'))
  const originalRequest = mocked.app.createWorkCatalogItem.mock.calls[0][0]
  expect(originalRequest).toMatchObject({ name: `Mục ${kind}`, idempotencyKey: expect.any(String), code: expect.any(String),
    amountVnd: kind === 'Công việc nhận thưởng' ? 3000 : 0 })
  fireEvent.click(screen.getByRole('button', { name: 'LƯU', exact: true }))
  await waitFor(() => expect(mocked.app.createWorkCatalogItem).toHaveBeenCalledTimes(2))
  expect(mocked.app.createWorkCatalogItem.mock.calls[1][0]).toEqual(originalRequest)
  await waitFor(() => expect(screen.queryByRole('button', { name: 'LƯU', exact: true })).toBeNull())
})

it('uses a new request when the user changes the intended configuration after a failure', async () => {
  mocked.app.createWorkCatalogItem.mockRejectedValueOnce(Object.assign(new Error('Lost connection'), { code: 'NETWORK_ERROR' }))
  render(<WorkCatalogSettingsPage />)
  fireEvent.click(screen.getByRole('button', { name: 'THÊM DANH MỤC' }))
  fireEvent.change(screen.getByPlaceholderText('Nhập tên công việc hoặc vi phạm'), { target: { value: 'Original name' } })
  fireEvent.click(screen.getByRole('button', { name: 'LƯU', exact: true }))
  await waitFor(() => expect(mocked.app.notify).toHaveBeenCalled())
  fireEvent.change(screen.getByPlaceholderText('Nhập tên công việc hoặc vi phạm'), { target: { value: 'Changed name' } })
  fireEvent.click(screen.getByRole('button', { name: 'LƯU', exact: true }))
  await waitFor(() => expect(mocked.app.createWorkCatalogItem).toHaveBeenCalledTimes(2))
  const [first, second] = mocked.app.createWorkCatalogItem.mock.calls.map(([payload]) => payload)
  expect(second.name).toBe('Changed name')
  expect(second.idempotencyKey).not.toBe(first.idempotencyKey)
})
