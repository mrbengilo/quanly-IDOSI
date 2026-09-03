import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocked = vi.hoisted(() => ({ apiGetEmployeeAvatar: vi.fn() }))

vi.mock('./idosiApi', () => ({
  apiGetEmployeeAvatar: mocked.apiGetEmployeeAvatar,
}))

import {
  invalidateEmployeeAvatarCache,
  loadEmployeeAvatarUrl,
} from './employeeAvatarCache'

let createObjectUrlDescriptor
let revokeObjectUrlDescriptor

beforeEach(() => {
  mocked.apiGetEmployeeAvatar.mockReset()
  createObjectUrlDescriptor = Object.getOwnPropertyDescriptor(URL, 'createObjectURL')
  revokeObjectUrlDescriptor = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL')
  let sequence = 0
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: vi.fn(() => `blob:employee-avatar-${++sequence}`),
  })
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    value: vi.fn(),
  })
})

afterEach(() => {
  invalidateEmployeeAvatarCache()
  if (createObjectUrlDescriptor) Object.defineProperty(URL, 'createObjectURL', createObjectUrlDescriptor)
  else delete URL.createObjectURL
  if (revokeObjectUrlDescriptor) Object.defineProperty(URL, 'revokeObjectURL', revokeObjectUrlDescriptor)
  else delete URL.revokeObjectURL
  vi.useRealTimers()
})

describe('employee avatar cache', () => {
  it('deduplicates case variants and shares one in-flight request', async () => {
    mocked.apiGetEmployeeAvatar.mockResolvedValue(new Blob(['avatar'], { type: 'image/png' }))

    const [first, second] = await Promise.all([
      loadEmployeeAvatarUrl('NV-001'),
      loadEmployeeAvatarUrl('nv-001'),
    ])

    expect(first).toBe('blob:employee-avatar-1')
    expect(second).toBe(first)
    expect(mocked.apiGetEmployeeAvatar).toHaveBeenCalledTimes(1)
    expect(mocked.apiGetEmployeeAvatar).toHaveBeenCalledWith('NV-001')
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1)
  })

  it('negative-caches missing avatars instead of repeating expensive 404 requests', async () => {
    const error = Object.assign(new Error('missing'), {
      status: 404,
      code: 'EMPLOYEE_AVATAR_NOT_FOUND',
    })
    mocked.apiGetEmployeeAvatar.mockRejectedValue(error)

    expect(await loadEmployeeAvatarUrl('NV-MISSING')).toBe('')
    expect(await loadEmployeeAvatarUrl('nv-missing')).toBe('')
    expect(mocked.apiGetEmployeeAvatar).toHaveBeenCalledTimes(1)
  })

  it('bounds concurrent avatar traffic so list screens cannot starve navigation APIs', async () => {
    let active = 0
    let maximum = 0
    mocked.apiGetEmployeeAvatar.mockImplementation(async () => {
      active += 1
      maximum = Math.max(maximum, active)
      await new Promise((resolve) => setTimeout(resolve, 8))
      active -= 1
      return new Blob(['avatar'], { type: 'image/png' })
    })

    const results = await Promise.all(Array.from({ length: 9 }, (_, index) => (
      loadEmployeeAvatarUrl(`NV-${index + 1}`)
    )))

    expect(results.every(Boolean)).toBe(true)
    expect(mocked.apiGetEmployeeAvatar).toHaveBeenCalledTimes(9)
    expect(maximum).toBeLessThanOrEqual(3)
  })
})
