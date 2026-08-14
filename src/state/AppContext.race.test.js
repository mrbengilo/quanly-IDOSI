import { describe, expect, it } from 'vitest'
import { mergeLegacyCredentialMigration } from './AppContext'

describe('legacy credential migration race guard', () => {
  const remoteState = {
    employees: [{ id: 'REMOTE-001', name: 'Nhân viên từ máy chủ' }],
    managerAccounts: [],
    adminAccounts: [],
    session: { id: 'ADMIN-REMOTE', role: 'admin' },
  }
  const migratedLocalAccounts = {
    employees: [{ id: 'LOCAL-001', name: 'Nhân viên local cũ' }],
    managerAccounts: [{ id: 'MANAGER-LOCAL' }],
    adminAccounts: [{ id: 'ADMIN-LOCAL' }],
  }

  it('keeps the bootstrapped remote state when the API has already activated', () => {
    const result = mergeLegacyCredentialMigration(remoteState, migratedLocalAccounts, true)

    expect(result).toBe(remoteState)
    expect(result.employees).toEqual(remoteState.employees)
    expect(result.employees).not.toEqual(migratedLocalAccounts.employees)
  })

  it('applies migrated credentials while the application is still local', () => {
    const result = mergeLegacyCredentialMigration(remoteState, migratedLocalAccounts, false)

    expect(result).not.toBe(remoteState)
    expect(result.employees).toEqual(migratedLocalAccounts.employees)
    expect(result.session).toEqual(remoteState.session)
  })
})
