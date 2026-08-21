import { describe, expect, it, vi } from 'vitest'
import { IDENTITY_IMAGE_MAX_BYTES, IDENTITY_IMAGE_MAX_SOURCE_BYTES, optimizeIdentityImage } from './identityImage'

const file = (size, type = 'image/png') => ({ size, type })

describe('optimizeIdentityImage', () => {
  it('accepts an original image up to 5 MB and keeps a small image unchanged', async () => {
    const readFile = vi.fn().mockResolvedValue('data:image/png;base64,iVBORw0KGgo=')
    const result = await optimizeIdentityImage(file(IDENTITY_IMAGE_MAX_BYTES), { readFile })
    expect(result.dataUrl).toContain('image/png')
    expect(readFile).toHaveBeenCalledOnce()
  })

  it('optimizes a large original image to the shared 300 KB limit', async () => {
    const optimize = vi.fn().mockResolvedValue({ dataUrl: 'data:image/webp;base64,UklGRg==', bytes: 250_000 })
    const result = await optimizeIdentityImage(file(4 * 1024 * 1024), { optimize })
    expect(result.bytes).toBeLessThanOrEqual(IDENTITY_IMAGE_MAX_BYTES)
    expect(optimize).toHaveBeenCalledOnce()
  })

  it('rejects an original above 5 MB or an unsupported type', async () => {
    await expect(optimizeIdentityImage(file(IDENTITY_IMAGE_MAX_SOURCE_BYTES + 1))).rejects.toThrow('5 MB')
    await expect(optimizeIdentityImage(file(100, 'image/gif'))).rejects.toThrow('JPG, PNG hoặc WebP')
  })
})
