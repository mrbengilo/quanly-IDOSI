import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { invalidateEmployeeAvatarCache } from '../services/employeeAvatarCache'
import { Avatar } from './UI'

const mocked = vi.hoisted(() => ({ getEmployeeAvatar: vi.fn() }))

vi.mock('../services/idosiApi', () => ({
  apiGetEmployeeAvatar: mocked.getEmployeeAvatar,
}))

describe('personnel Avatar', () => {
  beforeEach(() => {
    mocked.getEmployeeAvatar.mockReset()
    URL.createObjectURL = vi.fn(() => 'blob:employee-avatar')
    URL.revokeObjectURL = vi.fn()
    invalidateEmployeeAvatarCache()
  })

  afterEach(() => {
    cleanup()
    invalidateEmployeeAvatarCache()
  })

  it('loads the requested employee avatar rather than reusing the signed-in account avatar', async () => {
    mocked.getEmployeeAvatar.mockResolvedValue(new Blob(['avatar'], { type: 'image/webp' }))

    render(<Avatar name="Nhân viên KVC" employeeId="KVC-001" />)

    expect(screen.getByText('VK')).toBeTruthy()
    await waitFor(() => expect(screen.getByAltText('Ảnh đại diện Nhân viên KVC').getAttribute('src')).toBe('blob:employee-avatar'))
    expect(mocked.getEmployeeAvatar).toHaveBeenCalledOnce()
    expect(mocked.getEmployeeAvatar).toHaveBeenCalledWith('KVC-001')
  })

  it('shares one authorized download across repeated rows for the same employee', async () => {
    mocked.getEmployeeAvatar.mockResolvedValue(new Blob(['avatar'], { type: 'image/webp' }))

    render(<><Avatar name="Nhân viên" employeeId="HTKD-001" /><Avatar name="Nhân viên" employeeId="HTKD-001" /></>)

    await waitFor(() => expect(screen.getAllByAltText('Ảnh đại diện Nhân viên')).toHaveLength(2))
    expect(mocked.getEmployeeAvatar).toHaveBeenCalledOnce()
  })

  it('uses an explicit legacy/profile source without an additional request', () => {
    render(<Avatar name="Nhân viên" employeeId="VP-001" src="/legacy-avatar.webp" />)

    expect(screen.getByAltText('Ảnh đại diện Nhân viên').getAttribute('src')).toBe('/legacy-avatar.webp')
    expect(mocked.getEmployeeAvatar).not.toHaveBeenCalled()
  })
})
