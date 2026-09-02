import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import RoleSelectionPage from './RoleSelectionPage'

const mocked = vi.hoisted(() => ({
  selectSessionRole: vi.fn(),
  session: null,
  settings: { avatar: '/avatar-user.jpg' },
}))

vi.mock('../state/AppContext', () => ({
  useApp: () => ({ session: mocked.session, settings: mocked.settings, selectSessionRole: mocked.selectSessionRole }),
}))

describe('RoleSelectionPage', () => {
  afterEach(cleanup)

  beforeEach(() => {
    mocked.selectSessionRole.mockReset().mockImplementation(async (option) => ({ ok: true, account: option }))
    mocked.session = {
      role: 'business_support', employeeId: 'HTKD-01', storeId: 'BUSINESS_SUPPORT',
      name: 'Nguyễn Minh Khôi', needsRoleSelection: true,
      availableRoles: [
        { role: 'store_manager', label: 'Quản lý CH', employeeId: 'QLCH-01', storeId: 'S01' },
        { role: 'employee', label: 'Nhân viên', employeeId: 'E-STORE-01', storeId: 'S01' },
      ],
    }
  })

  it('shows all linked roles and enters the selected workspace', async () => {
    render(<MemoryRouter initialEntries={['/select-role']}><Routes>
      <Route path="/select-role" element={<RoleSelectionPage />} />
      <Route path="/store/overview" element={<h1>Không gian quản lý</h1>} />
    </Routes></MemoryRouter>)

    expect(screen.getByRole('img', { name: 'Ảnh đại diện Nguyễn Minh Khôi' }).getAttribute('src')).toBe('/avatar-user.jpg')
    const roleGroup = screen.getByRole('group', { name: 'Vai trò có thể chọn' })
    expect(roleGroup.style.getPropertyValue('--role-option-count')).toBe('2')
    const managerButton = screen.getByRole('button', { name: /^Quản lý CH Quản lý cửa hàng/u })
    expect(managerButton).toBeTruthy()
    expect(screen.getByRole('button', { name: /^Nhân viên Điểm danh/u })).toBeTruthy()
    fireEvent.click(managerButton)

    await waitFor(() => expect(mocked.selectSessionRole).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'store_manager', employeeId: 'QLCH-01', storeId: 'S01' }),
    ))
    expect(await screen.findByRole('heading', { name: 'Không gian quản lý' })).toBeTruthy()
  })

  it('shows immediate pressed feedback and blocks duplicate role switches', async () => {
    let finishSelection
    mocked.selectSessionRole.mockImplementationOnce((option) => new Promise((resolve) => {
      finishSelection = () => resolve({ ok: false, account: option })
    }))
    render(<MemoryRouter initialEntries={['/select-role']}><Routes>
      <Route path="/select-role" element={<RoleSelectionPage />} />
    </Routes></MemoryRouter>)

    const managerButton = screen.getByRole('button', { name: /^Quản lý CH Quản lý cửa hàng/u })
    const employeeButton = screen.getByRole('button', { name: /^Nhân viên Điểm danh/u })
    fireEvent.click(managerButton)
    fireEvent.click(managerButton)

    await waitFor(() => expect(managerButton.getAttribute('aria-busy')).toBe('true'))
    expect(managerButton.getAttribute('aria-pressed')).toBe('true')
    expect(managerButton.classList.contains('is-pending')).toBe(true)
    expect(managerButton.disabled).toBe(true)
    expect(employeeButton.disabled).toBe(true)
    expect(screen.getByText('Đang mở...')).toBeTruthy()
    expect(mocked.selectSessionRole).toHaveBeenCalledTimes(1)

    finishSelection()
    await waitFor(() => expect(managerButton.disabled).toBe(false))
    expect(managerButton.classList.contains('is-pending')).toBe(false)
  })
})
