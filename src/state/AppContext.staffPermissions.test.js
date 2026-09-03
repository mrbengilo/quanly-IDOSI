import { describe, expect, it } from 'vitest'
import { Buffer } from 'node:buffer'
import {
  canCreateEmployeeUnit,
  canBusinessSupportUpdateEmployee,
  canCalculateDailyRevenueBonus,
  canDeleteSupportTransfers,
  canManageSupportTransfers,
  canManagePolicies,
  createInitialState,
  createAccountSettingsPayload,
  createLocalSystemResetState,
  generateBusinessSupportStoreCredentials,
  hydrateState,
  nextSupportTransferBoundaryDelay,
  remoteEffectiveUserChanged,
  resolveRemoteActiveStoreId,
} from './AppContext'

const pngAvatarDataUrl = (bytes) => {
  const buffer = Buffer.alloc(bytes, 0x41)
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer)
  return `data:image/png;base64,${buffer.toString('base64')}`
}

describe('Business Support staff and policy permissions', () => {
  it('enforces the final avatar invariant before either remote or local settings persistence', () => {
    const boundaryAvatar = pngAvatarDataUrl(300 * 1024)
    expect(createAccountSettingsPayload({ avatar: boundaryAvatar })).toMatchObject({ avatar: boundaryAvatar })
    expect(() => createAccountSettingsPayload({ avatar: pngAvatarDataUrl(300 * 1024 + 1) }))
      .toThrow(expect.objectContaining({ code: 'AVATAR_TOO_LARGE' }))
    expect(() => createAccountSettingsPayload({ avatar: 'data:image/png;base64,QUFBQQ==' }))
      .toThrow(expect.objectContaining({ code: 'AVATAR_INVALID' }))
    expect(createAccountSettingsPayload({ avatar: 'blob:private-preview' })).not.toHaveProperty('avatar')
    expect(createAccountSettingsPayload({
      avatar: { key: 'account-avatars/usr_1/avatar.webp', contentType: 'image/webp', size: 12, version: 1 },
    })).not.toHaveProperty('avatar')
    expect(createAccountSettingsPayload({ avatar: '' })).toMatchObject({ avatar: '' })
  })

  it('can create office and store profiles without gaining employee update/delete authority', () => {
    expect(canCreateEmployeeUnit('business_support', 'office')).toBe(true)
    expect(canCreateEmployeeUnit('business_support', 'store')).toBe(true)
    expect(canCreateEmployeeUnit('manager', 'store')).toBe(true)
    expect(canCreateEmployeeUnit('business_support', 'business_support')).toBe(false)
    expect(canCreateEmployeeUnit('store_manager', 'office')).toBe(false)
    expect(canCreateEmployeeUnit('employee', 'store')).toBe(false)
  })

  it('keeps profile edits separate from effective-dated working-time commands', () => {
    const shifts = [{ id: 'ca_sang', name: 'Ca sáng', start: '08:00', end: '12:00' }]
    expect(canBusinessSupportUpdateEmployee({ unit: 'office' }, { phone: '0901234567' })).toBe(true)
    expect(canBusinessSupportUpdateEmployee({ unit: 'office' }, { phone: '0901234567', workShifts: shifts })).toBe(false)
    expect(canBusinessSupportUpdateEmployee({ unit: 'business_support' }, {
      workTimeType: 'Part-Time', workStart: '08:00', workEnd: '12:00', workShifts: shifts,
      workingTime: { type: 'Part-Time', mode: 'shifts', shifts },
    })).toBe(false)
    for (const protectedField of ['username', 'password', 'status', 'salary', 'unit', 'storeId', 'phone', 'address']) {
      expect(canBusinessSupportUpdateEmployee({ unit: 'business_support' }, { [protectedField]: 'blocked' }), protectedField).toBe(false)
    }
  })

  it('allows daily revenue calculation only for scoped operational roles', () => {
    expect(canCalculateDailyRevenueBonus('admin')).toBe(true)
    expect(canCalculateDailyRevenueBonus('business_support')).toBe(true)
    expect(canCalculateDailyRevenueBonus('manager')).toBe(true)
    expect(canCalculateDailyRevenueBonus('store_manager')).toBe(true)
    expect(canCalculateDailyRevenueBonus('employee')).toBe(false)
    expect(canCalculateDailyRevenueBonus('office')).toBe(false)
    expect(canCalculateDailyRevenueBonus('')).toBe(false)
  })

  it('shares policy editing with Business Support while excluding store roles', () => {
    expect(canManagePolicies('admin')).toBe(true)
    expect(canManagePolicies('business_support')).toBe(true)
    expect(canManagePolicies('manager')).toBe(true)
    expect(canManagePolicies('store_manager')).toBe(false)
    expect(canManagePolicies('employee')).toBe(false)
  })

  it('allows only Admin and Business Support to manage transfers', () => {
    expect(canManageSupportTransfers('admin')).toBe(true)
    expect(canManageSupportTransfers('business_support')).toBe(true)
    expect(canManageSupportTransfers('manager')).toBe(true)
    expect(canManageSupportTransfers('store_manager')).toBe(false)
    expect(canManageSupportTransfers('employee')).toBe(false)
  })

  it('reserves transfer deletion for Admin while Business Support keeps edit access', () => {
    expect(canManageSupportTransfers('admin')).toBe(true)
    expect(canDeleteSupportTransfers('admin')).toBe(true)
    expect(canManageSupportTransfers('business_support')).toBe(true)
    expect(canDeleteSupportTransfers('business_support')).toBe(false)
    expect(canManageSupportTransfers('manager')).toBe(true)
    expect(canDeleteSupportTransfers('manager')).toBe(false)
    expect(canDeleteSupportTransfers('store_manager')).toBe(false)
    expect(canDeleteSupportTransfers('employee')).toBe(false)
  })

  it('detects same-version effective-store changes and the next exact transfer boundary', () => {
    expect(remoteEffectiveUserChanged(
      { role: 'employee', storeId: 'S01', homeStoreId: 'S01' },
      { role: 'employee', storeId: 'S02', homeStoreId: 'S01', activeTransferId: 'TR-01' },
    )).toBe(true)
    expect(remoteEffectiveUserChanged(
      { role: 'employee', storeId: 'S01', homeStoreId: 'S01' },
      { role: 'employee', storeId: 'S01', homeStoreId: 'S01' },
    )).toBe(false)
    expect(remoteEffectiveUserChanged(
      { role: 'employee', storeId: 'STORE-A', homeStoreId: 'STORE-A', activeTransferId: 'TR-01' },
      { role: 'employee', storeId: 'store-a', homeStoreId: 'store-a', activeTransferId: 'tr-01' },
    )).toBe(false)
    expect(nextSupportTransferBoundaryDelay([{
      status: 'Đã duyệt',
      startAt: '2026-08-20T14:00',
      endAt: '2026-08-20T21:00',
    }], Date.parse('2026-08-20T06:59:00.000Z'))).toBe(60_000)
  })

  it('generates an ephemeral credential and adds a collision suffix without storing a password field', () => {
    expect(generateBusinessSupportStoreCredentials(
      { name: 'Nguyễn Minh Anh', cccd: '079203123456' },
      { short: 'TH' },
      [{ username: 'th-anh' }],
    )).toEqual({ username: 'th-anh-2', password: '123456anh@' })
  })

  it('preserves a valid preferred store only for system-wide roles', () => {
    const stores = [{ id: 'STORE-A' }, { id: 'STORE-B' }]
    expect(resolveRemoteActiveStoreId({
      stores,
      session: { role: 'admin' },
      remoteActiveStoreId: 'STORE-A',
      preferredActiveStoreId: 'store-b',
    })).toBe('STORE-B')
    expect(resolveRemoteActiveStoreId({
      stores,
      session: { role: 'business_support' },
      remoteActiveStoreId: 'STORE-A',
      preferredActiveStoreId: 'REMOVED-STORE',
    })).toBe('STORE-A')
    expect(resolveRemoteActiveStoreId({
      stores,
      session: { role: 'store_manager', storeId: 'store-a' },
      remoteActiveStoreId: 'STORE-A',
      preferredActiveStoreId: 'STORE-B',
    })).toBe('STORE-A')
  })

  it('keeps an explicit local reset empty after reload while retaining only the current Admin account', () => {
    const initial = createInitialState()
    const secondAdmin = { ...initial.adminAccounts[0], id: 'ADMIN-2', code: 'ADMIN-2', username: 'admin-2' }
    const current = {
      ...initial,
      adminAccounts: [...initial.adminAccounts, secondAdmin],
      managerAccounts: [{ id: 'HTKD-001', role: 'business_support' }],
      settings: { ...initial.settings, name: 'Admin đang thao tác' },
      session: { id: 'ADMIN', username: 'admin', role: 'admin', name: 'Admin đang thao tác' },
    }

    const resetState = createLocalSystemResetState(current)
    expect(resetState.stores).toEqual([])
    expect(resetState.employees).toEqual([])
    expect(resetState.orders).toEqual([])
    expect(resetState.shiftDefinitions).toEqual([])
    expect(resetState.managerAccounts).toEqual([])
    expect(resetState.orderCounters).toEqual({})
    expect(resetState.importCounter).toBe(0)
    expect(resetState.systemResetCompletedAt).toBeTruthy()
    expect(resetState.adminAccounts.map((account) => account.username)).toEqual(['admin'])
    expect(resetState.session?.username).toBe('admin')

    const reloaded = hydrateState({ ...resetState, session: null })
    expect(reloaded.stores).toEqual([])
    expect(reloaded.employees).toEqual([])
    expect(reloaded.orders).toEqual([])
    expect(reloaded.shiftDefinitions).toEqual([])
    expect(reloaded.activeStoreId).toBeNull()
    expect(reloaded.adminAccounts.map((account) => account.username)).toEqual(['admin'])
  })
})
