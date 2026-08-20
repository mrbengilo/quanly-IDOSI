export const ACCOUNT_AVATAR_MAX_SOURCE_BYTES = 5 * 1024 * 1024
export const ACCOUNT_AVATAR_MAX_BYTES = 300 * 1024
export const ACCOUNT_AVATAR_MIME_TYPES = Object.freeze(['image/jpeg', 'image/png', 'image/webp'])

const AVATAR_DATA_URL = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]*(?:={0,2}))$/u
const QUALITY_STEPS = [0.86, 0.76, 0.66, 0.56, 0.46]
const OUTPUT_MIME_TYPES = ['image/webp', 'image/jpeg']

export class AccountAvatarError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'AccountAvatarError'
    this.code = code
  }
}

const avatarError = (code, message) => new AccountAvatarError(code, message)

const hasImageSignature = (mimeType, binary) => {
  const byte = (index) => binary.charCodeAt(index)
  if (mimeType === 'image/png') {
    return [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((value, index) => byte(index) === value)
  }
  if (mimeType === 'image/jpeg') return byte(0) === 0xff && byte(1) === 0xd8 && byte(2) === 0xff
  if (mimeType === 'image/webp') {
    return binary.slice(0, 4) === 'RIFF' && binary.slice(8, 12) === 'WEBP'
  }
  return false
}

export function validateAccountAvatarDataUrl(value, { allowEmpty = true } = {}) {
  const avatar = String(value || '')
  if (!avatar) {
    if (allowEmpty) return { dataUrl: '', mimeType: '', bytes: 0 }
    throw avatarError('AVATAR_REQUIRED', 'Vui lòng chọn ảnh đại diện.')
  }

  const match = AVATAR_DATA_URL.exec(avatar)
  let binary
  try {
    if (!match || match[2].length % 4 !== 0) throw new Error('invalid avatar encoding')
    binary = atob(match[2])
  } catch {
    throw avatarError('AVATAR_INVALID', 'Ảnh đại diện phải là dữ liệu ảnh JPG, PNG hoặc WebP hợp lệ.')
  }
  const bytes = binary.length
  if (!bytes || !hasImageSignature(match[1], binary)) {
    throw avatarError('AVATAR_INVALID', 'Ảnh đại diện phải là dữ liệu ảnh JPG, PNG hoặc WebP hợp lệ.')
  }
  if (bytes > ACCOUNT_AVATAR_MAX_BYTES) {
    throw avatarError('AVATAR_TOO_LARGE', 'Ảnh đại diện sau khi tối ưu không được vượt quá 300 KB.')
  }
  return { dataUrl: avatar, mimeType: match[1], bytes }
}

export function validateAccountAvatarSource(file) {
  if (!file) throw avatarError('AVATAR_REQUIRED', 'Vui lòng chọn ảnh đại diện.')
  if (!ACCOUNT_AVATAR_MIME_TYPES.includes(String(file.type || '').toLowerCase())) {
    throw avatarError('AVATAR_SOURCE_TYPE', 'Ảnh gốc chỉ hỗ trợ định dạng JPG, PNG hoặc WebP.')
  }
  if (!Number.isFinite(file.size) || file.size <= 0) {
    throw avatarError('AVATAR_SOURCE_EMPTY', 'Tệp ảnh gốc đang trống hoặc không thể đọc.')
  }
  if (file.size > ACCOUNT_AVATAR_MAX_SOURCE_BYTES) {
    throw avatarError('AVATAR_SOURCE_TOO_LARGE', 'Ảnh gốc không được vượt quá 5 MB. Vui lòng chọn ảnh nhỏ hơn.')
  }
  return file
}

const decodeInBrowser = async (file) => {
  if (typeof createImageBitmap === 'function') {
    let bitmap
    try {
      bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
    } catch {
      bitmap = await createImageBitmap(file)
    }
    return {
      source: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      cleanup: () => bitmap.close?.(),
    }
  }

  if (typeof Image !== 'function' || !URL?.createObjectURL) {
    throw avatarError('AVATAR_BROWSER_UNSUPPORTED', 'Trình duyệt này không hỗ trợ tối ưu ảnh. Vui lòng cập nhật trình duyệt.')
  }
  const objectUrl = URL.createObjectURL(file)
  try {
    const image = await new Promise((resolve, reject) => {
      const element = new Image()
      element.onload = () => resolve(element)
      element.onerror = () => reject(avatarError('AVATAR_DECODE_FAILED', 'Không thể đọc ảnh gốc. Vui lòng chọn tệp ảnh khác.'))
      element.src = objectUrl
    })
    return {
      source: image,
      width: image.naturalWidth,
      height: image.naturalHeight,
      cleanup: () => URL.revokeObjectURL(objectUrl),
    }
  } catch (error) {
    URL.revokeObjectURL(objectUrl)
    throw error
  }
}

const encodeInBrowser = (source, { width, height, mimeType, quality }) => {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d', { alpha: mimeType !== 'image/jpeg' })
  if (!context) throw avatarError('AVATAR_BROWSER_UNSUPPORTED', 'Trình duyệt không thể xử lý ảnh đại diện.')
  if (mimeType === 'image/jpeg') {
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, width, height)
  }
  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'
  context.drawImage(source, 0, 0, width, height)
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob?.size) resolve(blob)
      else reject(avatarError('AVATAR_ENCODE_FAILED', 'Không thể nén ảnh đại diện. Vui lòng thử ảnh khác.'))
    }, mimeType, quality)
  })
}

const blobToDataUrl = (blob) => new Promise((resolve, reject) => {
  const reader = new FileReader()
  reader.onload = () => resolve(String(reader.result || ''))
  reader.onerror = () => reject(avatarError('AVATAR_READ_FAILED', 'Không thể đọc ảnh đã tối ưu. Vui lòng thử lại.'))
  reader.readAsDataURL(blob)
})

const fittedSize = (width, height, maxEdge) => {
  const ratio = Math.min(1, maxEdge / Math.max(width, height))
  return {
    width: Math.max(1, Math.round(width * ratio)),
    height: Math.max(1, Math.round(height * ratio)),
  }
}

export async function optimizeAccountAvatar(file, options = {}) {
  validateAccountAvatarSource(file)
  const decodeImage = options.decodeImage || decodeInBrowser
  const encodeImage = options.encodeImage || encodeInBrowser
  const toDataUrl = options.blobToDataUrl || blobToDataUrl
  const decoded = await decodeImage(file)
  const sourceWidth = Number(decoded?.width)
  const sourceHeight = Number(decoded?.height)
  if (!decoded?.source || !Number.isFinite(sourceWidth) || !Number.isFinite(sourceHeight) || sourceWidth <= 0 || sourceHeight <= 0) {
    decoded?.cleanup?.()
    throw avatarError('AVATAR_DECODE_FAILED', 'Không thể đọc kích thước ảnh gốc. Vui lòng chọn tệp ảnh khác.')
  }

  try {
    let maxEdge = Math.min(1400, Math.max(sourceWidth, sourceHeight))
    const attemptedSizes = new Set()
    while (maxEdge >= 96) {
      const size = fittedSize(sourceWidth, sourceHeight, maxEdge)
      const sizeKey = `${size.width}x${size.height}`
      if (!attemptedSizes.has(sizeKey)) {
        attemptedSizes.add(sizeKey)
        for (const quality of QUALITY_STEPS) {
          for (const mimeType of OUTPUT_MIME_TYPES) {
            let blob
            try {
              blob = await encodeImage(decoded.source, { ...size, mimeType, quality })
            } catch {
              continue
            }
            if (!blob?.size || blob.size > ACCOUNT_AVATAR_MAX_BYTES || !ACCOUNT_AVATAR_MIME_TYPES.includes(blob.type)) continue
            const result = validateAccountAvatarDataUrl(await toDataUrl(blob), { allowEmpty: false })
            return { ...result, width: size.width, height: size.height, sourceBytes: file.size }
          }
        }
      }
      if (Math.max(size.width, size.height) <= 96) break
      maxEdge = Math.max(96, Math.floor(maxEdge * 0.8))
    }
  } finally {
    decoded.cleanup?.()
  }
  throw avatarError('AVATAR_COMPRESSION_FAILED', 'Không thể tối ưu ảnh xuống dưới 300 KB. Vui lòng chọn ảnh khác.')
}
