export const ACCOUNT_AVATAR_MAX_SOURCE_BYTES = 5 * 1024 * 1024
export const ACCOUNT_AVATAR_MAX_BYTES = 300 * 1024
export const ACCOUNT_AVATAR_MIME_TYPES = Object.freeze(['image/jpeg', 'image/png', 'image/webp'])

const AVATAR_DATA_URL = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]*(?:={0,2}))$/u
// Keep the number of expensive canvas encodes small on mobile. Two WebP
// attempts preserve the preferred output; JPEG is a compatibility fallback.
// When an output is still too large, optimizeAccountAvatar uses its measured
// size to jump directly to a smaller edge instead of retrying many nearly
// identical dimensions.
const OUTPUT_ATTEMPTS = Object.freeze([
  { mimeType: 'image/webp', quality: 0.82 },
  { mimeType: 'image/webp', quality: 0.64 },
  { mimeType: 'image/jpeg', quality: 0.78 },
  { mimeType: 'image/jpeg', quality: 0.58 },
])
const MAX_AVATAR_OUTPUT_EDGE = 1024
const MAX_IMAGE_OUTPUT_EDGE = 1400

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

const accountProfileValue = (value) => (
  ['string', 'number'].includes(typeof value) && String(value).trim()
    ? String(value).trim()
    : undefined
)

const accountProfileField = (profile = {}, key) => {
  const values = {
    code: [profile.code, profile.employeeCode, profile.employeeId, profile.id],
    name: [profile.name],
    email: [profile.email, profile.workEmail],
    phone: [profile.phone, profile.phoneNumber, profile.mobile],
    cccd: [profile.cccd, profile.citizenId, profile.identityNumber],
    birthday: [profile.birthday, profile.birthDate, profile.dateOfBirth, profile.dob],
    gender: [profile.gender, profile.sex],
    address: [profile.address],
    position: [profile.position, profile.workPosition, profile.jobPosition],
  }
  return (values[key] || []).map(accountProfileValue).find(Boolean)
}

// The API projection is authoritative, while the canonical employee record is
// a compatibility fallback for deployments upgrading from older state. Empty
// projected fields must not erase a still-valid personnel value.
export function mergeAccountPersonnelProfile(fallback = {}, projected = {}) {
  const keys = ['code', 'name', 'email', 'phone', 'cccd', 'birthday', 'gender', 'address', 'position']
  return Object.fromEntries(keys.map((key) => [
    key,
    accountProfileField(projected, key) ?? accountProfileField(fallback, key) ?? '',
  ]))
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

const encodeInBrowser = (source, {
  height,
  mimeType,
  quality,
  sourceHeight,
  sourceWidth,
  sourceX,
  sourceY,
  width,
}) => {
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
  context.drawImage(
    source,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    0,
    0,
    width,
    height,
  )
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

const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, Number(value) || 0))

const fittedSize = (width, height, maxEdge) => {
  const ratio = Math.min(1, maxEdge / Math.max(width, height))
  return {
    width: Math.max(1, Math.round(width * ratio)),
    height: Math.max(1, Math.round(height * ratio)),
  }
}

export function accountAvatarCrop(sourceWidth, sourceHeight, crop = {}) {
  const width = Math.max(1, Number(sourceWidth) || 1)
  const height = Math.max(1, Number(sourceHeight) || 1)
  const zoom = clamp(crop.zoom || 1, 1, 3)
  const cropEdge = Math.min(width, height) / zoom
  const positionX = clamp(crop.positionX, -1, 1)
  const positionY = clamp(crop.positionY, -1, 1)
  return {
    sourceX: (width - cropEdge) * ((positionX + 1) / 2),
    sourceY: (height - cropEdge) * ((positionY + 1) / 2),
    sourceWidth: cropEdge,
    sourceHeight: cropEdge,
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
    const hasExplicitAvatarCrop = Boolean(options.crop && typeof options.crop === 'object')
    const crop = hasExplicitAvatarCrop
      ? accountAvatarCrop(sourceWidth, sourceHeight, options.crop)
      : {
          sourceX: 0,
          sourceY: 0,
          sourceWidth,
          sourceHeight,
        }
    let maxEdge = hasExplicitAvatarCrop
      ? Math.max(96, Math.min(MAX_AVATAR_OUTPUT_EDGE, Math.floor(crop.sourceWidth)))
      : Math.min(MAX_IMAGE_OUTPUT_EDGE, Math.max(sourceWidth, sourceHeight))
    const attemptedSizes = new Set()
    while (maxEdge >= 96) {
      const size = hasExplicitAvatarCrop
        ? { width: maxEdge, height: maxEdge }
        : fittedSize(crop.sourceWidth, crop.sourceHeight, maxEdge)
      const sizeKey = `${size.width}x${size.height}`
      let smallestOversizedBytes = Number.POSITIVE_INFINITY
      if (!attemptedSizes.has(sizeKey)) {
        attemptedSizes.add(sizeKey)
        for (const { mimeType, quality } of OUTPUT_ATTEMPTS) {
          let blob
          try {
            blob = await encodeImage(decoded.source, { ...crop, ...size, mimeType, quality })
          } catch {
            continue
          }
          if (!blob?.size || !ACCOUNT_AVATAR_MIME_TYPES.includes(blob.type)) continue
          if (blob.size > ACCOUNT_AVATAR_MAX_BYTES) {
            smallestOversizedBytes = Math.min(smallestOversizedBytes, blob.size)
            continue
          }
          const result = validateAccountAvatarDataUrl(await toDataUrl(blob), { allowEmpty: false })
          return {
            ...result,
            width: size.width,
            height: size.height,
            sourceBytes: file.size,
            ...(hasExplicitAvatarCrop ? { crop } : {}),
          }
        }
      }
      if (Math.max(size.width, size.height) <= 96) break
      const measuredScale = Number.isFinite(smallestOversizedBytes)
        ? Math.sqrt(ACCOUNT_AVATAR_MAX_BYTES / smallestOversizedBytes) * 0.92
        : 0.72
      maxEdge = Math.max(96, Math.floor(maxEdge * Math.min(0.8, measuredScale)))
    }
  } finally {
    decoded.cleanup?.()
  }
  throw avatarError('AVATAR_COMPRESSION_FAILED', 'Không thể tối ưu ảnh xuống dưới 300 KB. Vui lòng chọn ảnh khác.')
}
