import { describe, expect, it } from 'vitest'
import {
  isCurrentLocalCache,
  isRestorableOperationalAuditAction,
  mergeEmployeeAuthUsers,
  mergeLegacyCredentialMigration,
  purgeLegacyLocalCredentials,
  restoreOperationalRecordFields,
} from './AppContext'

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
      [{ id: 'user-support', employeeId: 'htkd001', username: 'manager', status: 'active', version: 3 }],
    )

    expect(profile).toMatchObject({
      id: 'HTKD001',
      username: 'manager',
      authUserId: 'user-support',
      authVersion: 3,
      status: 'Đang làm việc',
    })
  })

  it('keeps exact auth links and never folds one ambiguous account onto two profiles', () => {
    const profiles = [
      { id: 'E01', name: 'Hồ sơ chữ hoa' },
      { id: 'e01', name: 'Hồ sơ chữ thường' },
    ]
    const exact = mergeEmployeeAuthUsers(profiles, [
      { id: 'USER-UPPER', employeeId: 'E01', username: 'upper', status: 'active' },
      { id: 'USER-LOWER', employeeId: 'e01', username: 'lower', status: 'active' },
    ])

    expect(exact.map(({ id, authUserId }) => ({ id, authUserId }))).toEqual([
      { id: 'E01', authUserId: 'USER-UPPER' },
      { id: 'e01', authUserId: 'USER-LOWER' },
    ])

    const ambiguous = mergeEmployeeAuthUsers(profiles, [
      { id: 'USER-LOWER', employeeId: 'e01', username: 'lower', status: 'active' },
    ])
    expect(ambiguous[0].authUserId).toBeUndefined()
    expect(ambiguous[1].authUserId).toBe('USER-LOWER')
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

  it('restores only editable order fields and preserves order ownership', () => {
    const current = {
      id: 'DH-001', code: 'DH-001', storeId: 'STORE-A', employeeId: 'NV-001', attendanceId: 'ATT-001',
      customerName: 'Khách đã sửa', amount: 250000, paymentMethod: 'Chuyển khoản', createdAt: '2026-08-18T01:00:00.000Z',
    }
    const baseline = {
      ...current,
      storeId: 'STORE-B', employeeId: 'NV-KHAC', attendanceId: 'ATT-KHAC',
      customerName: 'Khách ban đầu', amount: 200000, paymentMethod: 'Tiền mặt',
    }

    expect(restoreOperationalRecordFields(current, baseline, 'orders')).toMatchObject({
      id: 'DH-001', storeId: 'STORE-A', employeeId: 'NV-001', attendanceId: 'ATT-001',
      customerName: 'Khách ban đầu', amount: 200000, paymentMethod: 'Tiền mặt',
      createdAt: '2026-08-18T01:00:00.000Z',
    })
  })

  it('restores attendance corrections without overwriting sales, location, identity or shift', () => {
    const current = {
      id: 'ATT-001', storeId: 'STORE-A', employeeId: 'NV-001', shiftId: 'SHIFT-01',
      checkIn: '08:30', checkOut: '17:00', sales: 900000, location: { latitude: 10.8, longitude: 106.7 },
    }
    const baseline = {
      ...current,
      storeId: 'STORE-B', employeeId: 'NV-KHAC', shiftId: 'SHIFT-KHAC',
      checkIn: '08:00', sales: 0, location: { latitude: 0, longitude: 0 },
    }

    expect(restoreOperationalRecordFields(current, baseline, 'attendance')).toMatchObject({
      id: 'ATT-001', storeId: 'STORE-A', employeeId: 'NV-001', shiftId: 'SHIFT-01',
      checkIn: '08:00', checkOut: '17:00', sales: 900000,
      location: { latitude: 10.8, longitude: 106.7 },
    })
  })

  it('accepts canonical and legacy local attendance-edit audits for restoration', () => {
    expect(isRestorableOperationalAuditAction('Sửa', 'attendance')).toBe(true)
    expect(isRestorableOperationalAuditAction('update', 'attendance')).toBe(true)
    expect(isRestorableOperationalAuditAction('delete', 'attendance')).toBe(false)
  })
})
