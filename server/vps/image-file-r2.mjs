import { createHash } from 'node:crypto'
import sharp from 'sharp'
import { FileR2 } from './file-r2.mjs'

const VARIANTS = Object.freeze({
  avatar: { bytes: 20 * 1024, edge: 256, minimumEdge: 96 },
  identity: { bytes: 100 * 1024, edge: 1400, minimumEdge: 320 },
})
const pendingEncodes = []
let activeEncodes = 0

// Bound native decoding across all requests, including different employees.
const withEncoder = async (encode) => {
  if (activeEncodes >= 2) {
    if (pendingEncodes.length >= 64) throw new Error('Image preview queue is full')
    await new Promise((resolve) => pendingEncodes.push(resolve))
  } else activeEncodes += 1
  try {
    return await encode()
  } finally {
    const next = pendingEncodes.shift()
    if (next) next()
    else activeEncodes -= 1
  }
}

export const encodeImagePreview = (body, variant) => withEncoder(async () => {
  const preset = VARIANTS[variant]
  if (!preset) throw new Error('Unsupported image preview variant')
  let edge = preset.edge
  while (edge >= preset.minimumEdge) {
    let smallest = Number.POSITIVE_INFINITY
    for (const quality of [82, 68, 54]) {
      const result = await sharp(body, { limitInputPixels: 40_000_000, failOn: 'warning' })
        .rotate()
        .resize({ width: edge, height: edge, fit: 'inside', withoutEnlargement: true })
        .webp({ quality, effort: 3 })
        .timeout({ seconds: 10 })
        .toBuffer()
      if (result.byteLength <= preset.bytes) return result
      smallest = Math.min(smallest, result.byteLength)
    }
    if (edge === preset.minimumEdge) break
    edge = Math.max(preset.minimumEdge, Math.floor(edge * Math.min(0.8, Math.sqrt(preset.bytes / smallest) * 0.9)))
  }
  throw new Error('Image cannot fit the display budget')
})

const previewKey = (key, variant) => `image-previews/v1/${variant}/${createHash('sha256').update(String(key)).digest('hex')}.webp`

export class ImageFileR2 extends FileR2 {
  constructor(root, options = {}) {
    super(root, options)
    this.encodePreview = options.encodePreview || encodeImagePreview
    this.pendingPreviews = new Map()
  }

  getPreview(key, variant) {
    if (!VARIANTS[variant]) return Promise.reject(new Error('Unsupported image preview variant'))
    const displayKey = previewKey(key, variant)
    if (this.pendingPreviews.has(displayKey)) return this.pendingPreviews.get(displayKey)
    const pending = this.readPreview(key, variant, displayKey).finally(() => this.pendingPreviews.delete(displayKey))
    this.pendingPreviews.set(displayKey, pending)
    return pending
  }

  async readPreview(key, variant, displayKey) {
    const sourceVersion = await this.version(key)
    if (!sourceVersion) return null
    const cached = await this.get(displayKey)
    if (cached?.customMetadata?.sourceVersion === sourceVersion) return cached
    const source = await this.get(key)
    if (!source) return null
    const body = await this.encodePreview(source.body, variant)
    // An upload/delete during encoding must not publish a stale derivative.
    if (await this.version(key) !== sourceVersion) return null
    await this.put(displayKey, body, {
      httpMetadata: { contentType: 'image/webp' },
      customMetadata: { sourceVersion },
    })
    return { body, size: body.byteLength, etag: createHash('sha256').update(body).digest('hex'), httpMetadata: { contentType: 'image/webp' } }
  }

  async delete(key) {
    await super.delete(key)
    const displayKeys = Object.keys(VARIANTS).map((variant) => previewKey(key, variant))
    await Promise.allSettled(displayKeys.map((displayKey) => this.pendingPreviews.get(displayKey)))
    await Promise.all(displayKeys.map((displayKey) => super.delete(displayKey)))
  }
}
