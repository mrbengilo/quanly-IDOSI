import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AdminSettings } from './AdminPages'

const mocked = vi.hoisted(() => ({
  changeAdminPassword: vi.fn(),
  notify: vi.fn(),
  optimizeAccountAvatar: vi.fn(),
  saveSettings: vi.fn(),
  currentEmployee: null,
  accountProfile: null,
  employees: [],
  session: { id: 'ADMIN-001', username: 'admin', role: 'admin', name: 'Quản trị viên' },
  settings: {},
  validateAccountAvatarSource: vi.fn(),
  verifyCurrentPassword: vi.fn(),
}))

vi.mock('../../domain/accountAvatar', async (importOriginal) => ({
  ...await importOriginal(),
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
    session: mocked.session,
    currentEmployee: mocked.currentEmployee,
    accountProfile: mocked.accountProfile,
    employees: mocked.employees,
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
    mocked.currentEmployee = null
    mocked.accountProfile = null
    mocked.employees = []
    mocked.session = { id: 'ADMIN-001', username: 'admin', role: 'admin', name: 'Quản trị viên' }
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
    expect(screen.getByText(/Ảnh sẵn sàng: 245 KB/u)).toBeTruthy()
    expect(mocked.notify).not.toHaveBeenCalled()

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

  it('shows the canonical employee behind a linked role without copying personnel data into account settings', async () => {
    const canonical = {
      id: 'HTKD-001',
      name: 'Nguyễn Hồ Sơ Gốc',
      email: 'hoso.goc@idosi.vn',
      phone: '0901234567',
      cccd: '079123456789',
      birthday: '1996-04-12',
      gender: 'Nữ',
      address: '12 Nguyễn Huệ, Bến Nghé, TP. Hồ Chí Minh',
      position: 'NV hỗ trợ KD',
      unit: 'business_support',
    }
    const linkedManager = {
      id: 'QLCH-001',
      linkedEmployeeId: canonical.id,
      name: 'Tên snapshot cũ',
      phone: '0900000000',
      cccd: '000000000000',
      unit: 'store_manager',
      storeId: 'CH001',
    }
    mocked.session = { id: 'usr-01', username: 'linked.account', role: 'store_manager', employeeId: linkedManager.id, name: linkedManager.name }
    mocked.currentEmployee = linkedManager
    mocked.accountProfile = canonical
    mocked.employees = [linkedManager]
    mocked.settings = { name: 'Tên cài đặt cũ', email: 'stale@idosi.vn', phone: '0911111111', bio: 'Giới thiệu tài khoản' }

    render(<AdminSettings />)

    expect(screen.getByText('Thông tin được lấy từ hồ sơ nhân sự liên kết với tài khoản hiện tại.')).toBeTruthy()
    expect(screen.getByLabelText('Mã nhân viên').value).toBe('HTKD-001')
    expect(screen.getByLabelText('Họ và tên').value).toBe('Nguyễn Hồ Sơ Gốc')
    expect(screen.getByLabelText('Số CCCD').value).toBe('079123456789')
    expect(screen.getByLabelText('Số điện thoại').value).toBe('0901234567')
    expect(screen.getByLabelText('Email').value).toBe('hoso.goc@idosi.vn')
    expect(screen.getByLabelText('Ngày sinh').value).toBe('1996-04-12')
    expect(screen.getByLabelText('Giới tính').value).toBe('Nữ')
    expect(screen.getByLabelText('Địa chỉ').value).toBe('12 Nguyễn Huệ, Bến Nghé, TP. Hồ Chí Minh')
    expect(screen.getByLabelText('Họ và tên').readOnly).toBe(true)
    expect(screen.getByLabelText('Số CCCD').readOnly).toBe(true)
    expect(screen.getByLabelText('Giới tính').disabled).toBe(true)

    fireEvent.change(document.querySelector('textarea'), { target: { value: 'Giới thiệu mới' } })
    fireEvent.click(screen.getByRole('button', { name: 'Lưu thay đổi' }))

    await waitFor(() => expect(mocked.saveSettings).toHaveBeenCalled())
    const payload = mocked.saveSettings.mock.calls.at(-1)[0]
    expect(payload).toMatchObject({ bio: 'Giới thiệu mới' })
    for (const key of ['name', 'email', 'phone', 'cccd', 'birthday', 'gender', 'address']) {
      expect(payload).not.toHaveProperty(key)
    }
  })
})
