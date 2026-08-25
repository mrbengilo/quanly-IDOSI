import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AdminSettings } from './AdminPages'

const mocked = vi.hoisted(() => ({
  changeAdminPassword: vi.fn(),
  notify: vi.fn(),
  optimizeAccountAvatar: vi.fn(),
  saveSettings: vi.fn(),
  settings: {},
  validateAccountAvatarSource: vi.fn(),
  verifyCurrentPassword: vi.fn(),
}))

vi.mock('../../domain/accountAvatar', () => ({
  optimizeAccountAvatar: mocked.optimizeAccountAvatar,
  validateAccountAvatarSource: mocked.validateAccountAvatarSource,
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
      ...mocked.settings,
    },
    session: { id: 'ADMIN-001', username: 'admin', role: 'admin', name: 'Quản trị viên' },
    saveSettings: mocked.saveSettings,
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
    mocked.optimizeAccountAvatar.mockReset()
    mocked.validateAccountAvatarSource.mockReset()
    mocked.saveSettings.mockReset().mockResolvedValue({ ok: true, settings: {} })
    mocked.settings = {}
    URL.createObjectURL = vi.fn(() => 'blob:avatar-preview')
    URL.revokeObjectURL = vi.fn()
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

  it('accepts a 5 MiB-class WebP source, uses the optimized payload, and explains the final limit', async () => {
    const avatar = 'data:image/webp;base64,UklGRkFBQUFXRUJQ'
    mocked.optimizeAccountAvatar.mockResolvedValue({ dataUrl: avatar, bytes: 245 * 1024 })
    mocked.saveSettings.mockResolvedValue({ ok: true, settings: { avatar } })
    render(<AdminSettings />)

    const input = document.querySelector('input[type="file"]')
    expect(input.accept).toBe('image/jpeg,image/png,image/webp')
    expect(screen.getByText(/Ảnh gốc JPG, PNG, WebP tối đa 5 MB/u)).toBeTruthy()
    const file = new File([new Uint8Array(4 * 1024 * 1024)], 'avatar.webp', { type: 'image/webp' })
    fireEvent.change(input, { target: { files: [file] } })

    expect(mocked.validateAccountAvatarSource).toHaveBeenCalledWith(file)
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(screen.getByAltText('Ảnh gốc đang căn chỉnh').getAttribute('src')).toBe('blob:avatar-preview')
    fireEvent.change(screen.getByLabelText('Thu phóng ảnh đại diện'), { target: { value: '1.5' } })
    fireEvent.change(screen.getByLabelText('Căn ngang ảnh đại diện'), { target: { value: '0.25' } })
    fireEvent.click(screen.getByRole('button', { name: 'Dùng ảnh này' }))

    await waitFor(() => expect(mocked.optimizeAccountAvatar).toHaveBeenCalledWith(file, {
      crop: { positionX: 0.25, positionY: 0, zoom: 1.5 },
    }))
    await waitFor(() => expect(screen.getByAltText('Ảnh đại diện tài khoản').getAttribute('src')).toBe(avatar))
    expect(mocked.notify).toHaveBeenCalledWith(expect.stringContaining('245 KB'), 'info')

    fireEvent.click(screen.getByRole('button', { name: 'Lưu thay đổi' }))
    await waitFor(() => expect(mocked.saveSettings).toHaveBeenCalledWith(expect.objectContaining({ avatar })))
  }, 15_000)

  it('shows private-avatar loading errors and sends an explicit clear operation', async () => {
    mocked.settings = {
      avatar: 'blob:private-account-avatar',
      avatarMetadata: {
        key: 'account-avatars/usr_admin/avatar.webp',
        contentType: 'image/webp',
        size: 128,
        version: 2,
      },
      avatarLoading: true,
      avatarError: 'Không thể tải ảnh đại diện.',
    }
    mocked.saveSettings.mockResolvedValue({ ok: true, settings: { avatar: '' } })
    render(<AdminSettings />)

    expect(screen.getByText(/Đang tải ảnh đại diện riêng tư…/)).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toContain('Không thể tải ảnh đại diện.')
    fireEvent.click(screen.getByRole('button', { name: 'Xóa ảnh' }))
    fireEvent.click(screen.getByRole('button', { name: 'Lưu thay đổi' }))

    await waitFor(() => expect(mocked.saveSettings).toHaveBeenCalledWith(expect.objectContaining({ avatar: '' })))
  })
})
