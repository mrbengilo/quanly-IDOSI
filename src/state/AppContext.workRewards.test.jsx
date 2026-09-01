import { act, cleanup, render, screen } from '@testing-library/react'
import { createRef, forwardRef, useImperativeHandle } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppProvider, createInitialState, useApp } from './AppContext'

const api = vi.hoisted(() => ({
  apiBootstrapState: vi.fn(),
  apiCommand: vi.fn(),
  apiGetAccountAvatar: vi.fn(),
  apiGetState: vi.fn(),
  apiGetStateMetadata: vi.fn(),
  apiLogin: vi.fn(),
  apiListUsers: vi.fn(),
  apiLogout: vi.fn(),
  clearApiSession: vi.fn(),
}))

vi.mock('../services/idosiApi', () => ({
  ...api,
  apiPolicyEntries: () => [],
  apiPolicyMap: () => ({}),
  hasApiSession: () => false,
  isLocalApiFallbackAllowed: () => false,
}))

const supportUser = {
  id: 'USER-HTKD-001', employeeId: 'HTKD-001', username: 'support-one',
  displayName: 'Hỗ trợ KD', role: 'business_support', status: 'active', version: 1,
}

const remoteState = () => ({
  ...createInitialState(),
  employees: [{
    id: 'HTKD-001', code: 'HTKD-001', name: 'Hỗ trợ KD', unit: 'business_support',
    storeId: 'BUSINESS_SUPPORT', status: 'Đang làm việc',
  }],
})

let appRef

const AppProbe = forwardRef(function AppProbe(_props, ref) {
  const app = useApp()
  useImperativeHandle(ref, () => app, [app])
  return <output aria-label="Số bản ghi thưởng">{app.workCatalogProgress.length}:{app.compensationEntries.length}:{app.teamRewardClaims.length}</output>
})

describe('work reward batch client command', () => {
  beforeEach(() => {
    appRef = createRef()
    localStorage.clear()
    sessionStorage.clear()
    api.apiLogin.mockResolvedValue({ user: supportUser })
    api.apiBootstrapState.mockResolvedValue({ user: supportUser, state: remoteState(), policies: [], version: 1 })
    api.apiListUsers.mockResolvedValue({ users: [supportUser] })
    api.apiGetStateMetadata.mockResolvedValue({ version: 2 })
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
    localStorage.clear()
    sessionStorage.clear()
  })

  it('sends one batch command and merges every returned finance record together', async () => {
    api.apiCommand.mockResolvedValue({
      version: 2,
      rewards: [
        { id: 'REWARD-01', attendanceId: 'ATT-01', catalogItemId: 'CAT-01', checked: true },
        { id: 'REWARD-02', attendanceId: 'ATT-01', catalogItemId: 'CAT-02', checked: true },
      ],
      entries: [{ id: 'ENTRY-01', sourceType: 'work-catalog-claim', amountVnd: 3_000 }],
      teamClaims: [{ id: 'TEAM-01', status: 'PENDING' }],
    })
    api.apiGetState.mockReturnValue(new Promise(() => {}))
    render(<AppProvider><AppProbe ref={appRef} /></AppProvider>)
    await act(async () => {
      expect((await appRef.current.login('support-one', 'password')).ok).toBe(true)
    })

    await act(async () => {
      await appRef.current.setWorkRewards({
        attendanceId: 'ATT-01',
        items: [
          { catalogItemId: 'CAT-01', checked: true },
          { catalogItemId: 'CAT-02', checked: true, expectedEntityVersion: 2 },
        ],
        idempotencyKey: 'reward-batch-client-0001',
      })
    })

    expect(api.apiCommand).toHaveBeenCalledWith(
      'work_reward.set_batch',
      {
        attendanceId: 'ATT-01',
        items: [
          { catalogItemId: 'CAT-01', checked: true },
          { catalogItemId: 'CAT-02', checked: true, expectedEntityVersion: 2 },
        ],
      },
      { expectedVersion: 1, idempotencyKey: 'reward-batch-client-0001' },
    )
    expect(screen.getByLabelText('Số bản ghi thưởng').textContent).toBe('2:1:1')
  })
})
