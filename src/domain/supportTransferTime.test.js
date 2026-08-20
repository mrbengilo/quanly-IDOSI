import { describe, expect, it } from 'vitest'
import {
  formatVietnamTransferDateTime,
  isSupportTransferActiveAt,
  isVietnamDateTimeLocal,
  supportTransferBounds,
  supportTransferMatchesMoment,
  toVietnamDateTimeInput,
  vietnamDateTimeLocalToIso,
} from './supportTransferTime'

describe('support transfer Vietnam datetime contract', () => {
  const exact = {
    id: 'TR-EXACT',
    status: 'Đã duyệt',
    startAt: '2026-08-20T14:00',
    endAt: '2026-08-20T21:00',
  }

  it('validates strict local input and persists the equivalent canonical instant', () => {
    expect(isVietnamDateTimeLocal('2026-08-20T14:00')).toBe(true)
    expect(isVietnamDateTimeLocal('2026-02-29T14:00')).toBe(false)
    expect(isVietnamDateTimeLocal('20/08/2026 14:00')).toBe(false)
    expect(vietnamDateTimeLocalToIso('2026-08-20T14:00')).toBe('2026-08-20T07:00:00.000Z')
    expect(toVietnamDateTimeInput('2026-08-20T07:00:00.000Z')).toBe('2026-08-20T14:00')
    expect(formatVietnamTransferDateTime('2026-08-20T07:00:00.000Z')).toBe('20/08/2026 14:00')
  })

  it('uses a start-inclusive and end-exclusive active interval', () => {
    expect(isSupportTransferActiveAt(exact, '2026-08-20T06:59:59.999Z')).toBe(false)
    expect(isSupportTransferActiveAt(exact, '2026-08-20T07:00:00.000Z')).toBe(true)
    expect(isSupportTransferActiveAt(exact, '2026-08-20T10:30:00.000Z')).toBe(true)
    expect(isSupportTransferActiveAt(exact, '2026-08-20T14:00:00.000Z')).toBe(false)
    expect(isSupportTransferActiveAt(exact, '2026-08-20T14:00:00.001Z')).toBe(false)
    expect(isSupportTransferActiveAt({ ...exact, status: 'Hoàn tất' }, '2026-08-20T10:30:00.000Z')).toBe(false)
  })

  it('keeps legacy date-only records active for their complete inclusive calendar dates', () => {
    const legacy = { status: 'Đã duyệt', fromDate: '2026-08-20', toDate: '2026-08-21' }
    const bounds = supportTransferBounds(legacy)
    expect(bounds).toMatchObject({
      startAt: '2026-08-19T17:00:00.000Z',
      endAt: '2026-08-21T17:00:00.000Z',
    })
    expect(isSupportTransferActiveAt(legacy, '2026-08-19T16:59:59.999Z')).toBe(false)
    expect(isSupportTransferActiveAt(legacy, '2026-08-19T17:00:00.000Z')).toBe(true)
    expect(isSupportTransferActiveAt(legacy, '2026-08-21T16:59:59.999Z')).toBe(true)
    expect(isSupportTransferActiveAt(legacy, '2026-08-21T17:00:00.000Z')).toBe(false)
    expect(supportTransferMatchesMoment(legacy, '2026-08-21')).toBe(true)
  })
})
