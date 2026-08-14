import { describe, expect, it } from 'vitest'
import { applyNotificationCommandResult } from './notificationState'

describe('notification command persistence', () => {
  it('merges returned records and marks every returned id as read', () => {
    const next = applyNotificationCommandResult([
      { id: 'N1', title: 'Mot', readAt: null },
      { id: 'N2', title: 'Hai', readAt: null },
      { id: 'N3', title: 'Ba', readAt: null },
    ], {
      notificationIds: ['N1', 'N2'],
      notifications: [{ id: 'N1', title: 'Mot moi', readAt: '2026-08-14T09:00:00.000Z' }],
    }, '2026-08-14T09:00:00.000Z')

    expect(next.find((item) => item.id === 'N1')).toMatchObject({ title: 'Mot moi', readAt: '2026-08-14T09:00:00.000Z' })
    expect(next.find((item) => item.id === 'N2')?.readAt).toBe('2026-08-14T09:00:00.000Z')
    expect(next.find((item) => item.id === 'N3')?.readAt).toBeNull()
  })
})
