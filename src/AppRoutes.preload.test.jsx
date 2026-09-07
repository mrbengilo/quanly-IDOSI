import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, expect, it, vi } from 'vitest'
import AppRoutes from './AppRoutes'

const mocked = vi.hoisted(() => ({
  selectedModuleStarted: vi.fn(),
  unrelatedModuleStarted: vi.fn(),
  ensureSystemWorkspaceData: vi.fn(() => new Promise(() => {})),
}))
vi.mock('./state/AppContext', () => ({
  useApp: () => ({
    session: { role: 'admin', name: 'Admin' },
    authReady: true,
    remoteDataReady: false,
    remoteProjection: { kind: 'global', screen: 'overview' },
    ensureSystemWorkspaceData: mocked.ensureSystemWorkspaceData,
  }),
}))
vi.mock('./layout/AppShell', () => new Promise(() => {}))
vi.mock('./pages/admin/AdminPages', () => {
  mocked.selectedModuleStarted()
  return { AdminStores: () => <div>Selected screen mounted</div> }
})
vi.mock('./pages/admin/RoleManagement', () => {
  mocked.unrelatedModuleStarted()
  return {}
})
afterEach(cleanup)

it('starts only the selected page module and projection while the shell module is still pending', async () => {
  render(<MemoryRouter initialEntries={['/admin/stores']}><AppRoutes /></MemoryRouter>)
  await waitFor(() => expect(mocked.selectedModuleStarted).toHaveBeenCalledOnce())
  expect(mocked.ensureSystemWorkspaceData).toHaveBeenCalledWith({ screen: 'stores' })
  expect(mocked.unrelatedModuleStarted).not.toHaveBeenCalled()
  expect(screen.queryByText('Selected screen mounted')).toBeNull()
  expect(screen.getByRole('status').textContent).toContain('Đang tải màn hình')
})
