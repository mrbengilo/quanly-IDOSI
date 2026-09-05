import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { apiGetEmployeeAvatar } from './idosiApi'
import { invalidateEmployeeAvatarCache, loadEmployeeAvatarUrl } from './employeeAvatarCache'

vi.mock('./idosiApi', () => ({ apiGetEmployeeAvatar: vi.fn() }))

describe('employee avatar cache ownership', () => {
  beforeEach(() => {
    invalidateEmployeeAvatarCache()
    vi.stubGlobal('URL', { createObjectURL: vi.fn((blob) => `blob:${blob.owner}`), revokeObjectURL: vi.fn() })
    vi.mocked(apiGetEmployeeAvatar).mockReset()
  })
  afterEach(() => { invalidateEmployeeAvatarCache(); vi.unstubAllGlobals() })

  it('deduplicates one employee and keeps different employee photos separate', async () => {
    vi.mocked(apiGetEmployeeAvatar).mockImplementation(async (owner) => ({ owner }))
    expect(await Promise.all([loadEmployeeAvatarUrl('E01'), loadEmployeeAvatarUrl('E01'), loadEmployeeAvatarUrl('E02')]))
      .toEqual(['blob:E01', 'blob:E01', 'blob:E02'])
    expect(await loadEmployeeAvatarUrl('E01')).toBe('blob:E01')
    expect(apiGetEmployeeAvatar).toHaveBeenCalledTimes(2)
  })

  it('discards an old account response after logout and preserves the new account entry', async () => {
    let finishOld
    vi.mocked(apiGetEmployeeAvatar).mockReturnValueOnce(new Promise((resolve) => { finishOld = resolve }))
      .mockResolvedValueOnce({ owner: 'new-session' })
    const old = loadEmployeeAvatarUrl('E01')
    invalidateEmployeeAvatarCache()
    expect(await loadEmployeeAvatarUrl('E01')).toBe('blob:new-session')
    finishOld({ owner: 'old-session' })
    expect(await old).toBe('')
    expect(await loadEmployeeAvatarUrl('E01')).toBe('blob:new-session')
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1)
  })

  it('does not erase a replacement when an older request fails', async () => {
    let failOld
    vi.mocked(apiGetEmployeeAvatar).mockReturnValueOnce(new Promise((resolve, reject) => { failOld = reject }))
      .mockResolvedValueOnce({ owner: 'replacement' })
    const old = loadEmployeeAvatarUrl('E01')
    const rejected = expect(old).rejects.toThrow('old request')
    invalidateEmployeeAvatarCache('E01')
    await loadEmployeeAvatarUrl('E01')
    failOld(new Error('old request'))
    await rejected
    expect(await loadEmployeeAvatarUrl('E01')).toBe('blob:replacement')
    invalidateEmployeeAvatarCache('E01')
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:replacement')
  })
})
