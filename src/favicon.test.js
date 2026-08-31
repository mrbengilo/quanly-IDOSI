import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { cwd } from 'node:process'
import { describe, expect, it } from 'vitest'

const KIB = 1024

const imageBudgets = [
  { name: 'favicon.png', format: 'png', maxWidth: 256, maxHeight: 256, maxBytes: 48 * KIB },
  { name: 'logo.png', format: 'png', maxWidth: 512, maxHeight: 512, maxBytes: 192 * KIB },
  { name: 'logo.jpg', format: 'jpeg', maxWidth: 512, maxHeight: 512, maxBytes: 40 * KIB },
]

function pngDimensions(image) {
  expect([...image.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
  return { width: image.readUInt32BE(16), height: image.readUInt32BE(20) }
}

function jpegDimensions(image) {
  expect(image.readUInt16BE(0)).toBe(0xffd8)

  let offset = 2
  while (offset + 9 < image.length) {
    if (image[offset] !== 0xff) {
      offset += 1
      continue
    }

    while (image[offset] === 0xff) offset += 1
    const marker = image[offset]
    offset += 1

    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue
    if (marker === 0xd9 || marker === 0xda) break

    const segmentLength = image.readUInt16BE(offset)
    const isStartOfFrame = [0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)
    if (isStartOfFrame) {
      return {
        width: image.readUInt16BE(offset + 5),
        height: image.readUInt16BE(offset + 3),
      }
    }

    offset += segmentLength
  }

  throw new Error('JPEG dimensions not found')
}

describe('site images', () => {
  it('links the PNG favicon from the document head', () => {
    const html = readFileSync(resolve(cwd(), 'index.html'), 'utf8')

    expect(html).toMatch(/<link\s+rel="icon"\s+type="image\/png"\s+href="\/favicon\.png"\s*\/>/)
    expect(html).not.toContain('type="image/jpeg"')
  })

  it.each(imageBudgets)('keeps $name within its pixel and byte budgets', ({ name, format, maxWidth, maxHeight, maxBytes }) => {
    const image = readFileSync(resolve(cwd(), 'public', name))
    const dimensions = format === 'png' ? pngDimensions(image) : jpegDimensions(image)

    expect(dimensions.width).toBeLessThanOrEqual(maxWidth)
    expect(dimensions.height).toBeLessThanOrEqual(maxHeight)
    expect(image.byteLength).toBeLessThanOrEqual(maxBytes)
  })

  it('declares a budget for every bundled raster image', () => {
    const publicDirectory = resolve(cwd(), 'public')
    const bundledImages = readdirSync(publicDirectory, { recursive: true })
      .filter((name) => /\.(?:avif|gif|jpe?g|png|webp)$/iu.test(name))
      .toSorted()
    const budgetedImages = imageBudgets.map(({ name }) => name).toSorted()

    expect(bundledImages).toEqual(budgetedImages)
  })
})
