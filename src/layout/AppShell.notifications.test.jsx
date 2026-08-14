import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AppShell from './AppShell'

const mocked = vi.hoisted(() => ({
  readNotification: vi.fn(),
  clearNotifications: vi.fn(),
  setActiveStoreId: vi.fn(),
}))

vi.mock('../state/AppContext', () => ({
  useApp: () => ({
    session: { role: 'admin', name: 'Admin' },
    stores: [
      { id: 'CH001', name: 'Cua hang 1', short: 'CH1' },
      { id: 'CH002', name: 'Cua hang 2', short: 'CH2' },
    ],
    activeStoreId: 'CH001',
    notifications: [
      { id: 'N1', storeId: 'CH001', title: 'Don moi 1' },
      { id: 'N2', storeId: 'CH001', title: 'Don moi 2' },
      { id: 'N3', storeId: 'CH002', orderId: 'ORDER-CH002', title: 'Don moi cua hang 2' },
    ],
    readNotification: mocked.readNotification,
    clearNotifications: mocked.clearNotifications,
    setActiveStoreId: mocked.setActiveStoreId,
    logout: vi.fn(),
    notify: vi.fn(),
    toast: null,
  }),
}))

describe('AppShell notifications', () => {
  afterEach(cleanup)

  beforeEach(() => {
    mocked.readNotification.mockReset()
    mocked.clearNotifications.mockReset().mockResolvedValue({ ok: true, updatedCount: 2 })
    mocked.setActiveStoreId.mockReset()
  })

  it('marks all notifications in one scoped command instead of one request per item', async () => {
    render(<MemoryRouter initialEntries={['/store/overview']}><AppShell /></MemoryRouter>)

    fireEvent.click(screen.getByRole('button', { name: /Xem thông báo/i }))
    fireEvent.click(screen.getByRole('button', { name: /Xóa tất cả thông báo/i }))

    await waitFor(() => expect(mocked.clearNotifications).toHaveBeenCalledWith('CH001'))
    expect(mocked.clearNotifications).toHaveBeenCalledTimes(1)
    expect(mocked.readNotification).not.toHaveBeenCalled()
  })

  it('switches to the notification store before opening its order', async () => {
    mocked.readNotification.mockResolvedValue({ ok: true })
    render(<MemoryRouter initialEntries={['/admin/overview']}><AppShell /></MemoryRouter>)

    fireEvent.click(screen.getByRole('button', { name: /Xem thông báo/i }))
    fireEvent.click(screen.getByText('Don moi cua hang 2'))

    expect(mocked.setActiveStoreId).toHaveBeenCalledWith('CH002')
    await waitFor(() => expect(mocked.readNotification).toHaveBeenCalledWith('N3'))
  })
})
