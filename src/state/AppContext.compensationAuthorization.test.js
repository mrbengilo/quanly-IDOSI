import { describe, expect, it } from 'vitest'
import { assertCompensationCommandAuthorization } from './AppContext'

describe('compensation client command authorization', () => {
  it('allows store managers to calculate, confirm and manage violations for their assigned store', () => {
    for (const command of ['revenue_bonus.calculate_day', 'revenue_bonus.confirm_day', 'violation.create', 'violation.void']) {
      expect(assertCompensationCommandAuthorization({
        command, role: 'store_manager', actorStoreId: 'S01', storeId: 'S01', targetUnit: command.startsWith('violation.') ? 'store' : '',
      })).toBe(true)
    }
  })

  it('rejects cross-store manager operations and milestone monetary decisions', () => {
    expect(() => assertCompensationCommandAuthorization({
      command: 'revenue_bonus.calculate_day', role: 'store_manager', actorStoreId: 'S01', storeId: 'S02',
    })).toThrow(/đúng cửa hàng/u)
    for (const command of ['revenue_bonus.approve_milestone', 'revenue_bonus.reject_milestone']) {
      expect(() => assertCompensationCommandAuthorization({
        command, role: 'store_manager', actorStoreId: 'S01', storeId: 'S01',
      })).toThrow(/không có quyền/u)
    }
  })

  it('preserves payroll operator access', () => {
    for (const role of ['admin', 'business_support']) {
      for (const command of ['revenue_bonus.calculate_day', 'revenue_bonus.confirm_day', 'revenue_bonus.approve_milestone', 'revenue_bonus.reject_milestone']) {
        expect(assertCompensationCommandAuthorization({ command, role, storeId: 'S02' })).toBe(true)
      }
    }
  })
})
