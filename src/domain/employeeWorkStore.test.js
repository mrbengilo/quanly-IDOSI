import { describe, expect, it } from 'vitest'
import {
  activeSupportDestinationStoreIdsOnDate,
  effectiveEmployeeStoreOnDate,
  employeeHistoricallyWorkedAtStoreOnDate,
  employeeWorksAtStoreOnDate,
} from './employeeWorkStore'

const employee = { id: 'E01', storeId: 'S01' }
const active = {
  id: 'TR-01', employeeId: 'E01', fromStoreId: 'S01', toStoreId: 'S02',
  startAt: '2026-08-20T08:00', endAt: '2026-08-21T02:00', status: 'Đã duyệt',
}

describe('canonical employee work-store eligibility', () => {
  it.each([
    ['active destination', active, true],
    ['not started', { ...active, startAt: '2026-08-21T08:00', endAt: '2026-08-22T02:00' }, false],
    ['expired', { ...active, startAt: '2026-08-18T08:00', endAt: '2026-08-19T02:00' }, false],
    ['inactive flag', { ...active, active: false }, false],
    ['soft deleted', { ...active, deletedAt: '2026-08-19T00:00:00Z' }, false],
    ['revoked status', { ...active, status: 'revoked' }, false],
    ['revoked marker', { ...active, revokedAt: '2026-08-19T00:00:00Z' }, false],
    ['cancelled status', { ...active, status: 'Đã hủy' }, false],
  ])('%s controls destination-store eligibility', (_label, transfer, expected) => {
    expect(employeeWorksAtStoreOnDate({
      supportTransfers: [transfer], employee, storeId: 'S02', date: '2026-08-20',
    })).toBe(expected)
  })

  it('keeps ordinary home work and prioritizes one active destination for storeless rows', () => {
    expect(employeeWorksAtStoreOnDate({ employee, storeId: 'S01', date: '2026-08-20' })).toBe(true)
    expect(effectiveEmployeeStoreOnDate({ supportTransfers: [active], employee, date: '2026-08-20' })).toBe('S02')
  })

  it('fails closed for storeless rows with multiple active destinations', () => {
    const transfers = [active, { ...active, id: 'TR-02', toStoreId: 'S03' }]
    expect(activeSupportDestinationStoreIdsOnDate(transfers, employee, '2026-08-20')).toEqual(['S02', 'S03'])
    expect(effectiveEmployeeStoreOnDate({ supportTransfers: transfers, employee, date: '2026-08-20' })).toBe('')
  })

  it('separates completed historical ownership from current transfer authorization', () => {
    const completed = { ...active, status: 'Hoàn tất', completedAt: '2026-08-20T18:00:00+07:00' }
    expect(employeeWorksAtStoreOnDate({ supportTransfers: [completed], employee, storeId: 'S02', date: '2026-08-20' })).toBe(false)
    expect(employeeHistoricallyWorkedAtStoreOnDate({ supportTransfers: [completed], employee, storeId: 'S02', date: '2026-08-20' })).toBe(true)
    expect(effectiveEmployeeStoreOnDate({ supportTransfers: [completed], employee, date: '2026-08-20' })).toBe('S02')
    expect(employeeHistoricallyWorkedAtStoreOnDate({ supportTransfers: [completed], employee, storeId: 'S02', date: '2026-08-19' })).toBe(false)
    expect(employeeHistoricallyWorkedAtStoreOnDate({ supportTransfers: [completed], employee, storeId: 'S02', date: '2026-08-22' })).toBe(false)
  })

  it.each(['Đã hủy', 'cancelled', 'rejected', 'Đã từ chối'])(
    'does not derive historical ownership from %s transfers',
    (status) => expect(employeeHistoricallyWorkedAtStoreOnDate({
      supportTransfers: [{ ...active, status }], employee, storeId: 'S02', date: '2026-08-20',
    })).toBe(false),
  )
})
