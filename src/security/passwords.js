export const DEMO_PASSWORD_HASH = 'pbkdf2$100000$aWRvc2ktZGVtby12Mi1zYWx0$DwE/j7NrkIUL5SABbaXNH6pUxZz8BiS7c9vH6E1+8+0='

const encoder = new TextEncoder()

const bytesToBase64 = (bytes) => {
  let value = ''
  bytes.forEach((byte) => { value += String.fromCharCode(byte) })
  return btoa(value)
}

const base64ToBytes = (value) => {
  const decoded = atob(value)
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0))
}

const derive = async (password, salt, iterations) => {
  const key = await crypto.subtle.importKey('raw', encoder.encode(String(password)), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256)
  return new Uint8Array(bits)
}

export const hashPassword = async (password, { iterations = 100000, salt } = {}) => {
  if (!globalThis.crypto?.subtle) throw new Error('Trình duyệt không hỗ trợ mã hóa mật khẩu an toàn.')
  const saltBytes = salt ? base64ToBytes(salt) : crypto.getRandomValues(new Uint8Array(18))
  const hash = await derive(password, saltBytes, iterations)
  return `pbkdf2$${iterations}$${bytesToBase64(saltBytes)}$${bytesToBase64(hash)}`
}

export const verifyPassword = async (password, encoded) => {
  try {
    const [algorithm, iterationValue, saltValue, hashValue] = String(encoded || '').split('$')
    const iterations = Number(iterationValue)
    if (algorithm !== 'pbkdf2' || !Number.isInteger(iterations) || iterations < 100000 || !saltValue || !hashValue) return false
    const expected = base64ToBytes(hashValue)
    const actual = await derive(password, base64ToBytes(saltValue), iterations)
    if (actual.length !== expected.length) return false
    let difference = 0
    for (let index = 0; index < actual.length; index += 1) difference |= actual[index] ^ expected[index]
    return difference === 0
  } catch {
    return false
  }
}
