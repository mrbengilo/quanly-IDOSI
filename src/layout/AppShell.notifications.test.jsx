import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AppShell from './AppShell'

const mocked = vi.hoisted(() => ({
  session: { role: 'admin', name: 'Admin' },
  activeStoreId: 'CH001',
  readNotification: vi.fn(),
  clearNotifications: vi.fn(),
  setActiveStoreId: vi.fn(),
}))

vi.mock('../state/AppContext', () => ({
  useApp: () => ({
    session: mocked.session,
    stores: [
      { id: 'CH001', name: 'Cua hang 1', short: 'CH1' },
      { id: 'CH002', name: 'Cua hang 2', short: 'CH2' },
    ],
    activeStoreId: mocked.activeStoreId,
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
    mocked.session = { role: 'admin', name: 'Admin' }
    mocked.activeStoreId = 'CH001'
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

  it('shows the Admin-only account management menus', () => {
    render(<MemoryRouter initialEntries={['/admin/overview']}><AppShell /></MemoryRouter>)

    expect(screen.getByRole('link', { name: /Nhân viên hỗ trợ KD/i }).getAttribute('href')).toBe('/admin/business-support')
    expect(screen.getByRole('link', { name: /^Quản lý cửa hàng$/i }).getAttribute('href')).toBe('/admin/store-managers')
  })

  it('gives business support the system workspace and self-attendance without Admin menus', () => {
    mocked.session = { role: 'business_support', name: 'Hỗ trợ KD', employeeId: 'HTKD001' }
    render(<MemoryRouter initialEntries={['/admin/overview']}><AppShell /></MemoryRouter>)

    expect(screen.getByRole('link', { name: /^Cửa hàng$/i })).toBeTruthy()
    expect(screen.getByRole('link', { name: /^Chấm công$/i }).getAttribute('href')).toBe('/support/attendance')
    expect(screen.getAllByText('Hỗ trợ KD').length).toBeGreaterThan(0)
    expect(screen.queryByRole('link', { name: /Khối văn phòng/i })).toBeNull()
    expect(screen.queryByRole('link', { name: /Nhân viên hỗ trợ KD/i })).toBeNull()
    expect(screen.queryByRole('link', { name: /Reset dữ liệu/i })).toBeNull()
  })

  it('locks a store manager to the assigned store workspace', () => {
    mocked.session = { role: 'store_manager', name: 'Quản lý CH2', storeId: 'CH002' }
    mocked.activeStoreId = 'CH001'
    render(<MemoryRouter initialEntries={['/store/overview']}><AppShell /></MemoryRouter>)

    expect(screen.getByRole('link', { name: /^Tổng quan cửa hàng$/i })).toBeTruthy()
    expect(screen.getByRole('link', { name: /^Nhân viên cửa hàng$/i })).toBeTruthy()
    expect(screen.getAllByText('Cua hang 2').length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: /Quay về trang quản lý chính/i })).toBeNull()
    expect(screen.queryByRole('link', { name: /^Cửa hàng$/i })).toBeNull()
    expect(screen.queryByRole('link', { name: /Quản lý nhân viên/i })).toBeNull()
  })
})
