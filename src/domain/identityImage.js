import {
  ACCOUNT_AVATAR_MAX_BYTES,
  ACCOUNT_AVATAR_MAX_SOURCE_BYTES,
  optimizeAccountAvatar,
  validateAccountAvatarSource,
} from './accountAvatar'

export const IDENTITY_IMAGE_MAX_SOURCE_BYTES = ACCOUNT_AVATAR_MAX_SOURCE_BYTES
export const IDENTITY_IMAGE_MAX_BYTES = ACCOUNT_AVATAR_MAX_BYTES

const readFileAsDataUrl = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader()
  reader.onerror = () => reject(new Error('Không thể đọc ảnh CCCD. Vui lòng chọn lại tệp.'))
  reader.onload = () => resolve(String(reader.result || ''))
  reader.readAsDataURL(file)
})

const identityError = (error) => {
  const message = String(error?.message || '')
    .replaceAll('Ảnh đại diện', 'Ảnh CCCD')
    .replaceAll('ảnh đại diện', 'ảnh CCCD')
  return new Error(message || 'Không thể tối ưu ảnh CCCD. Vui lòng chọn ảnh khác.')
}
export async function optimizeIdentityImage(file, options = {}) {
  try {
    validateAccountAvatarSource(file)
    if (file.size <= IDENTITY_IMAGE_MAX_BYTES) {
      const readFile = options.readFile || readFileAsDataUrl
      return { dataUrl: await readFile(file), sourceBytes: file.size, bytes: file.size }
    }
    const optimize = options.optimize || optimizeAccountAvatar
    return await optimize(file, options)
  } catch (error) {
    throw identityError(error)
  }
}
