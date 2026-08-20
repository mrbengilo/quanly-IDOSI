import { describe, expect, it } from 'vitest'
import {
  canCreateEmployeeUnit,
  canBusinessSupportUpdateEmployee,
  canManageSupportTransfers,
  canManagePolicies,
  createInitialState,
  createLocalSystemResetState,
  generateBusinessSupportStoreCredentials,
  hydrateState,
  nextSupportTransferBoundaryDelay,
  remoteEffectiveUserChanged,
  resolveRemoteActiveStoreId,
} from './AppContext'

describe('Business Support staff and policy permissions', () => {
  it('can create office and store profiles without gaining employee update/delete authority', () => {
    expect(canCreateEmployeeUnit('business_support', 'office')).toBe(true)
    expect(canCreateEmployeeUnit('business_support', 'store')).toBe(true)
    expect(canCreateEmployeeUnit('manager', 'store')).toBe(true)
    expect(canCreateEmployeeUnit('business_support', 'business_support')).toBe(false)
    expect(canCreateEmployeeUnit('store_manager', 'office')).toBe(false)
    expect(canCreateEmployeeUnit('employee', 'store')).toBe(false)
  })

  it('keeps full Office edit rights but whitelists Business Support profile changes to working time', () => {
    const shifts = [{ id: 'ca_sang', name: 'Ca sáng', start: '08:00', end: '12:00' }]
    expect(canBusinessSupportUpdateEmployee({ unit: 'office' }, { phone: '0901234567', workShifts: shifts })).toBe(true)
    expect(canBusinessSupportUpdateEmployee({ unit: 'business_support' }, {
      workTimeType: 'Part-Time', workStart: '08:00', workEnd: '12:00', workShifts: shifts,
      workingTime: { type: 'Part-Time', mode: 'shifts', shifts },
    })).toBe(true)
    for (const protectedField of ['username', 'password', 'status', 'salary', 'unit', 'storeId', 'phone', 'address']) {
      expect(canBusinessSupportUpdateEmployee({ unit: 'business_support' }, { [protectedField]: 'blocked' }), protectedField).toBe(false)
    }
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

  it('detects same-version effective-store changes and the next exact transfer boundary', () => {
    expect(remoteEffectiveUserChanged(
      { role: 'employee', storeId: 'S01', homeStoreId: 'S01' },
      { role: 'employee', storeId: 'S02', homeStoreId: 'S01', activeTransferId: 'TR-01' },
    )).toBe(true)
    expect(remoteEffectiveUserChanged(
      { role: 'employee', storeId: 'S01', homeStoreId: 'S01' },
      { role: 'employee', storeId: 'S01', homeStoreId: 'S01' },
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
      preferredActiveStoreId: 'STORE-B',
    })).toBe('STORE-B')
    expect(resolveRemoteActiveStoreId({
      stores,
      session: { role: 'business_support' },
      remoteActiveStoreId: 'STORE-A',
      preferredActiveStoreId: 'REMOVED-STORE',
    })).toBe('STORE-A')
    expect(resolveRemoteActiveStoreId({
      stores,
      session: { role: 'store_manager', storeId: 'ASSIGNED-STORE' },
      remoteActiveStoreId: 'STORE-A',
      preferredActiveStoreId: 'STORE-B',
    })).toBe('ASSIGNED-STORE')
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
