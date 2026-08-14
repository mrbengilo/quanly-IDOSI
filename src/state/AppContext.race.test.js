import { describe, expect, it } from 'vitest'
import { isCurrentLocalCache, mergeEmployeeAuthUsers, mergeLegacyCredentialMigration, purgeLegacyLocalCredentials } from './AppContext'

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

  it('repairs a migrated support profile with its linked login username', () => {
    const [profile] = mergeEmployeeAuthUsers(
      [{ id: 'HTKD001', name: 'Hỗ trợ cũ', unit: 'business_support' }],
      [{ id: 'user-support', employeeId: 'HTKD001', username: 'manager', status: 'active', version: 3 }],
    )

    expect(profile).toMatchObject({
      id: 'HTKD001',
      username: 'manager',
      authUserId: 'user-support',
      authVersion: 3,
      status: 'Đang làm việc',
    })
  })

  it('purges every legacy local non-Admin credential while preserving employee profiles', () => {
    const result = purgeLegacyLocalCredentials({
      managerAccounts: [{ id: 'manager', username: 'manager', passwordHash: 'secret' }],
      employees: [{ id: 'NV001', name: 'Nhân viên cũ', username: 'employee', passwordHash: 'secret', authUserId: 'user-old' }],
      deletedEmployees: [{ id: 'NV-OLD', username: 'old', legacyPassword: 'secret', authUserId: 'user-deleted' }],
      attendance: [{ id: 'ATT-1', employeeId: 'NV001' }],
    })

    expect(result.managerAccounts).toEqual([])
    expect(result.employees).toEqual([{ id: 'NV001', name: 'Nhân viên cũ' }])
    expect(result.deletedEmployees).toEqual([{ id: 'NV-OLD' }])
    expect(result.attendance).toEqual([{ id: 'ATT-1', employeeId: 'NV001' }])
    expect(result.accountCredentialEpoch).toBe(1)
  })

  it('never treats a remote projection or an old unmarked snapshot as a reusable local cache', () => {
    expect(isCurrentLocalCache({ storageMode: 'remote', cachePrivacyEpoch: 1 })).toBe(false)
    expect(isCurrentLocalCache({ employees: [{ cccd: 'sensitive' }] })).toBe(false)
    expect(isCurrentLocalCache({ storageMode: 'local', cachePrivacyEpoch: 1 })).toBe(true)
  })
})
