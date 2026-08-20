import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AdminSettings } from './AdminPages'

const mocked = vi.hoisted(() => ({
  changeAdminPassword: vi.fn(),
  notify: vi.fn(),
  verifyCurrentPassword: vi.fn(),
}))

vi.mock('../../state/AppContext', () => ({
  useApp: () => ({
    settings: {
      name: 'Quản trị viên',
      email: 'admin@idosi.vn',
      phone: '',
      birthday: '',
      gender: 'Nam',
      address: '',
      bio: '',
      notifications: {},
    },
    session: { id: 'ADMIN-001', username: 'admin', role: 'admin', name: 'Quản trị viên' },
    saveSettings: vi.fn(),
    changeAdminPassword: mocked.changeAdminPassword,
    verifyCurrentPassword: mocked.verifyCurrentPassword,
    resetDemo: vi.fn(),
    notify: mocked.notify,
  }),
}))

const openPasswordSettings = () => {
  render(<AdminSettings />)
  fireEvent.click(screen.getByRole('button', { name: 'Đổi mật khẩu' }))
}

describe('AdminSettings password visibility', () => {
  beforeEach(() => {
    mocked.changeAdminPassword.mockReset().mockResolvedValue(true)
    mocked.verifyCurrentPassword.mockReset().mockResolvedValue(true)
    mocked.notify.mockReset()
  })

  afterEach(cleanup)

  it('keeps every password hidden by default and toggles each field independently', () => {
    openPasswordSettings()

    const fields = [
      ['account-current-password', 'mật khẩu hiện tại'],
      ['account-new-password', 'mật khẩu mới'],
      ['account-confirm-password', 'xác nhận mật khẩu'],
    ]

    for (const [id, label] of fields) {
      const input = document.getElementById(id)
      expect(input.type).toBe('password')

      const showButton = screen.getByRole('button', { name: `Hiện ${label}` })
      expect(showButton.type).toBe('button')
      expect(showButton.getAttribute('aria-pressed')).toBe('false')
      fireEvent.click(showButton)

      expect(input.type).toBe('text')
      const hideButton = screen.getByRole('button', { name: `Ẩn ${label}` })
      expect(hideButton.getAttribute('aria-pressed')).toBe('true')
      fireEvent.click(hideButton)
      expect(input.type).toBe('password')
    }
  })

  it('submits the same current and new password payload after using visibility controls', async () => {
    openPasswordSettings()

    const currentPassword = document.getElementById('account-current-password')
    const newPassword = document.getElementById('account-new-password')
    const confirmPassword = document.getElementById('account-confirm-password')

    fireEvent.change(currentPassword, { target: { value: 'CurrentPass123!' } })
    fireEvent.change(newPassword, { target: { value: 'NextPass456!' } })
    fireEvent.change(confirmPassword, { target: { value: 'NextPass456!' } })
    fireEvent.click(screen.getByRole('button', { name: 'Hiện mật khẩu mới' }))
    fireEvent.click(screen.getByRole('button', { name: 'Lưu thiết lập' }))

    await waitFor(() => expect(mocked.changeAdminPassword).toHaveBeenCalledWith(
      'ADMIN-001',
      'NextPass456!',
      'CurrentPass123!',
    ))
    expect(mocked.verifyCurrentPassword).toHaveBeenCalledWith('CurrentPass123!')
    expect(currentPassword.value).toBe('')
    expect(newPassword.value).toBe('')
    expect(confirmPassword.value).toBe('')
    expect(newPassword.type).toBe('password')
  })
})
