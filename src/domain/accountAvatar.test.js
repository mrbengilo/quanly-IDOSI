import { describe, expect, it, vi } from 'vitest'
import { Buffer } from 'node:buffer'
import {
  ACCOUNT_AVATAR_MAX_BYTES,
  ACCOUNT_AVATAR_MAX_SOURCE_BYTES,
  accountAvatarCrop,
  mergeAccountPersonnelProfile,
  optimizeAccountAvatar,
  validateAccountAvatarDataUrl,
} from './accountAvatar'

const imageBytes = (mimeType, bytes) => {
  const buffer = Buffer.alloc(bytes, 0x41)
  if (mimeType === 'image/png') Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer)
  if (mimeType === 'image/jpeg') Buffer.from([0xff, 0xd8, 0xff]).copy(buffer)
  if (mimeType === 'image/webp') {
    Buffer.from('RIFF').copy(buffer, 0)
    Buffer.from('WEBP').copy(buffer, 8)
  }
  return buffer
}

const avatarDataUrl = (mimeType, bytes) => `data:${mimeType};base64,${imageBytes(mimeType, bytes).toString('base64')}`

describe('account avatar image contract', () => {
  it('rejects an original image above 5 MiB before decoding it', async () => {
    const decodeImage = vi.fn()
    await expect(optimizeAccountAvatar({
      type: 'image/jpeg',
      size: ACCOUNT_AVATAR_MAX_SOURCE_BYTES + 1,
    }, { decodeImage })).rejects.toMatchObject({ code: 'AVATAR_SOURCE_TOO_LARGE' })
    expect(decodeImage).not.toHaveBeenCalled()
  })

  it('iteratively resizes and compresses an accepted source to at most 300 KiB', async () => {
    const cleanup = vi.fn()
    const encodeImage = vi.fn()
      .mockResolvedValueOnce(new Blob([imageBytes('image/webp', ACCOUNT_AVATAR_MAX_BYTES + 20_000)], { type: 'image/webp' }))
      .mockResolvedValueOnce(new Blob([imageBytes('image/jpeg', ACCOUNT_AVATAR_MAX_BYTES + 10_000)], { type: 'image/jpeg' }))
      .mockResolvedValueOnce(new Blob([imageBytes('image/webp', ACCOUNT_AVATAR_MAX_BYTES - 1)], { type: 'image/webp' }))

    const result = await optimizeAccountAvatar({ type: 'image/png', size: 4 * 1024 * 1024 }, {
      decodeImage: vi.fn().mockResolvedValue({ source: {}, width: 3200, height: 2400, cleanup }),
      encodeImage,
    })

    expect(result.mimeType).toBe('image/webp')
    expect(result.bytes).toBe(ACCOUNT_AVATAR_MAX_BYTES - 1)
    expect(result.bytes).toBeLessThanOrEqual(ACCOUNT_AVATAR_MAX_BYTES)
    expect(result).toMatchObject({ width: 1400, height: 1050, sourceBytes: 4 * 1024 * 1024 })
    expect(encodeImage).toHaveBeenCalledTimes(3)
    expect(encodeImage).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      sourceX: 0,
      sourceY: 0,
      sourceWidth: 3200,
      sourceHeight: 2400,
      width: 1400,
      height: 1050,
    }))
    expect(cleanup).toHaveBeenCalledOnce()
  })

  it('only creates a square output when an explicit avatar crop is supplied', async () => {
    const encodeImage = vi.fn().mockResolvedValue(
      new Blob([imageBytes('image/webp', 120_000)], { type: 'image/webp' }),
    )

    const result = await optimizeAccountAvatar({ type: 'image/png', size: 4 * 1024 * 1024 }, {
      crop: { zoom: 2, positionX: 1, positionY: -1 },
      decodeImage: vi.fn().mockResolvedValue({ source: {}, width: 3200, height: 2400 }),
      encodeImage,
    })

    expect(result).toMatchObject({
      width: 1024,
      height: 1024,
      crop: { sourceX: 2000, sourceY: 0, sourceWidth: 1200, sourceHeight: 1200 },
    })
    expect(encodeImage).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      sourceX: 2000,
      sourceY: 0,
      sourceWidth: 1200,
      sourceHeight: 1200,
      width: 1024,
      height: 1024,
    }))
  })

  it('applies square crop zoom and positioning within the original image bounds', () => {
    expect(accountAvatarCrop(3200, 2400, { zoom: 2, positionX: 1, positionY: -1 })).toEqual({
      sourceX: 2000,
      sourceY: 0,
      sourceWidth: 1200,
      sourceHeight: 1200,
    })
  })

  it.each(['image/jpeg', 'image/png', 'image/webp'])('accepts %s at the exact 300 KiB final boundary', (mimeType) => {
    expect(validateAccountAvatarDataUrl(avatarDataUrl(mimeType, ACCOUNT_AVATAR_MAX_BYTES))).toMatchObject({
      mimeType,
      bytes: ACCOUNT_AVATAR_MAX_BYTES,
    })
  })

  it('rejects final payloads over 300 KiB and unsupported image MIME types', () => {
    expect(() => validateAccountAvatarDataUrl(
      avatarDataUrl('image/png', ACCOUNT_AVATAR_MAX_BYTES + 1),
    )).toThrow(expect.objectContaining({ code: 'AVATAR_TOO_LARGE' }))
    expect(() => validateAccountAvatarDataUrl('data:image/gif;base64,R0lGODlhAQABAIAAAAUEBA=='))
      .toThrow(expect.objectContaining({ code: 'AVATAR_INVALID' }))
    expect(() => validateAccountAvatarDataUrl('data:image/png;base64,QUFBQQ=='))
      .toThrow(expect.objectContaining({ code: 'AVATAR_INVALID' }))
  })

  it('keeps canonical personnel fields when an older account projection is partial', () => {
    expect(mergeAccountPersonnelProfile({
      code: 'HTKD-001',
      name: 'Nguyễn Hồ Sơ',
      phone: '0901234567',
      cccd: '079123456789',
      address: 'Thành phố Hồ Chí Minh',
    }, {
      code: 'HTKD-001',
      name: 'Nguyễn Hồ Sơ Mới',
      phone: '',
      cccd: null,
    })).toMatchObject({
      code: 'HTKD-001',
      name: 'Nguyễn Hồ Sơ Mới',
      phone: '0901234567',
      cccd: '079123456789',
      address: 'Thành phố Hồ Chí Minh',
    })
  })
})
