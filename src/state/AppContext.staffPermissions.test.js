import { describe, expect, it } from 'vitest'
import {
  canCreateEmployeeUnit,
  canManagePolicies,
  createInitialState,
  createLocalSystemResetState,
  generateBusinessSupportStoreCredentials,
  hydrateState,
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

  it('shares policy editing with Business Support while excluding store roles', () => {
    expect(canManagePolicies('admin')).toBe(true)
    expect(canManagePolicies('business_support')).toBe(true)
    expect(canManagePolicies('manager')).toBe(true)
    expect(canManagePolicies('store_manager')).toBe(false)
    expect(canManagePolicies('employee')).toBe(false)
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

  it('keeps an explicit local reset empty after reload while retaining every Admin account', () => {
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
    expect(resetState.adminAccounts.map((account) => account.username)).toEqual(['admin', 'admin-2'])
    expect(resetState.session?.username).toBe('admin')

    const reloaded = hydrateState({ ...resetState, session: null })
    expect(reloaded.stores).toEqual([])
    expect(reloaded.employees).toEqual([])
    expect(reloaded.orders).toEqual([])
    expect(reloaded.shiftDefinitions).toEqual([])
    expect(reloaded.activeStoreId).toBeNull()
    expect(reloaded.adminAccounts.map((account) => account.username)).toEqual(['admin', 'admin-2'])
  })
})
