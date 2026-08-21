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
      role: 'business_support', name: 'Nguyễn Minh Khôi', needsRoleSelection: true,
      availableRoles: [
        { role: 'store_manager', label: 'Quản lý', employeeId: 'QLCH-01', storeId: 'S01' },
        { role: 'employee', label: 'Nhân viên', employeeId: 'E-STORE-01', storeId: 'S01' },
        { role: 'business_support', label: 'Hỗ trợ KD', employeeId: 'HTKD-01', storeId: 'BUSINESS_SUPPORT' },
      ],
    }
  })

  it('shows all linked roles and enters the selected workspace', async () => {
    render(<MemoryRouter initialEntries={['/select-role']}><Routes>
      <Route path="/select-role" element={<RoleSelectionPage />} />
      <Route path="/store/overview" element={<h1>Không gian quản lý</h1>} />
    </Routes></MemoryRouter>)

    expect(screen.getByRole('img', { name: 'Ảnh đại diện Nguyễn Minh Khôi' }).getAttribute('src')).toBe('/avatar-user.jpg')
    expect(screen.getByText('Vai trò hiện tại')).toBeTruthy()
    const managerButton = screen.getByRole('button', { name: /^Quản lý CH Quản lý cửa hàng/u })
    expect(managerButton).toBeTruthy()
    expect(screen.getByRole('button', { name: /^Nhân viên Điểm danh/u })).toBeTruthy()
    expect(screen.getByRole('button', { name: /^Hỗ trợ KD Không gian/u })).toBeTruthy()
    fireEvent.click(managerButton)

    await waitFor(() => expect(mocked.selectSessionRole).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'store_manager', employeeId: 'QLCH-01', storeId: 'S01' }),
    ))
    expect(await screen.findByRole('heading', { name: 'Không gian quản lý' })).toBeTruthy()
  })
})
