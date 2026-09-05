import { createHash } from 'node:crypto'
import { Buffer } from 'node:buffer'
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, relative, resolve, sep } from 'node:path'

const META_SUFFIX = '.idosi-meta.json'
const ENVELOPE_MAGIC = Buffer.from('IDOSI_FILE_R2_V1', 'ascii')
const ENVELOPE_HEADER_SIZE = ENVELOPE_MAGIC.byteLength + 4
const MAX_ENVELOPE_METADATA_SIZE = 64 * 1024

const normalizeKey = (key) => {
  const normalized = String(key || '').replaceAll('\\', '/').replace(/^\/+|\/+$/gu, '')
  if (!normalized || normalized.split('/').some((part) => !part || part === '.' || part === '..')) {
    throw new Error('Khóa tệp không hợp lệ.')
  }
  return normalized
}

const safePath = (root, key) => {
  const target = resolve(root, ...normalizeKey(key).split('/'))
  const relativePath = relative(root, target)
  if (!relativePath || relativePath.startsWith(`..${sep}`) || relativePath === '..') {
    throw new Error('Đường dẫn tệp vượt ngoài vùng lưu trữ.')
  }
  return target
}

export const atomicWriteFile = async (target, value) => {
  await mkdir(dirname(target), { recursive: true })
  const temporary = `${target}.${process.pid}.${crypto.randomUUID()}.tmp`
  try {
    await writeFile(temporary, value)
    await rename(temporary, target)
  } finally {
    await rm(temporary, { force: true }).catch(() => {})
  }
}

const encodeEnvelope = (value, metadata) => {
  const body = Buffer.from(value)
  const metadataBytes = Buffer.from(JSON.stringify(metadata), 'utf8')
  if (metadataBytes.byteLength > MAX_ENVELOPE_METADATA_SIZE) {
    throw new Error('Metadata tệp vượt quá giới hạn.')
  }
  const header = Buffer.alloc(ENVELOPE_HEADER_SIZE)
  ENVELOPE_MAGIC.copy(header)
  header.writeUInt32BE(metadataBytes.byteLength, ENVELOPE_MAGIC.byteLength)
  return Buffer.concat([header, metadataBytes, body])
}

const decodeEnvelope = (value) => {
  const bytes = Buffer.from(value.buffer, value.byteOffset, value.byteLength)
  if (bytes.byteLength < ENVELOPE_MAGIC.byteLength
    || !bytes.subarray(0, ENVELOPE_MAGIC.byteLength).equals(ENVELOPE_MAGIC)) {
    return null
  }
  if (bytes.byteLength < ENVELOPE_HEADER_SIZE) {
    throw new Error('Tệp lưu trữ bị hỏng: envelope không đầy đủ.')
  }
  const metadataSize = bytes.readUInt32BE(ENVELOPE_MAGIC.byteLength)
  const bodyOffset = ENVELOPE_HEADER_SIZE + metadataSize
  if (metadataSize > MAX_ENVELOPE_METADATA_SIZE || bodyOffset > bytes.byteLength) {
    throw new Error('Tệp lưu trữ bị hỏng: metadata không hợp lệ.')
  }
  let metadata
  try {
    metadata = JSON.parse(bytes.subarray(ENVELOPE_HEADER_SIZE, bodyOffset).toString('utf8'))
  } catch {
    throw new Error('Tệp lưu trữ bị hỏng: metadata không đọc được.')
  }
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    throw new Error('Tệp lưu trữ bị hỏng: metadata không hợp lệ.')
  }
  return { body: bytes.subarray(bodyOffset), metadata }
}

const listFiles = async (directory, root, output = []) => {
  let entries
  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch (error) {
    if (error?.code === 'ENOENT') return output
    throw error
  }
  for (const entry of entries) {
    const target = resolve(directory, entry.name)
    if (entry.isDirectory()) await listFiles(target, root, output)
    else if (entry.isFile() && !entry.name.endsWith(META_SUFFIX) && !entry.name.endsWith('.tmp')) {
      output.push(relative(root, target).split(sep).join('/'))
    }
  }
  return output
}

export class FileR2 {
  constructor(rootDirectory, { atomicWriteFile: writeAtomically = atomicWriteFile } = {}) {
    this.root = resolve(rootDirectory)
    this.atomicWriteFile = writeAtomically
  }

  async put(key, value, options = {}) {
    const normalizedKey = normalizeKey(key)
    const target = safePath(this.root, normalizedKey)
    const bytes = value instanceof Uint8Array ? value : new Uint8Array(value)
    const metadata = {
      httpMetadata: options.httpMetadata || {},
      customMetadata: options.customMetadata || {},
    }
    await this.atomicWriteFile(target, encodeEnvelope(bytes, metadata))
    await rm(`${target}${META_SUFFIX}`, { force: true }).catch(() => {})
    return { key: normalizedKey }
  }

  async get(key) {
    const normalizedKey = normalizeKey(key)
    const target = safePath(this.root, normalizedKey)
    let bytes
    try {
      bytes = await readFile(target)
    } catch (error) {
      if (error?.code === 'ENOENT') return null
      throw error
    }
    const envelope = decodeEnvelope(bytes)
    let body = bytes
    let metadata = envelope?.metadata || {}
    if (envelope) {
      body = envelope.body
    } else {
      try {
        metadata = JSON.parse(await readFile(`${target}${META_SUFFIX}`, 'utf8'))
      } catch (error) {
        if (error?.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error
      }
    }
    return {
      body,
      size: body.byteLength,
      etag: createHash('sha256').update(body).digest('hex'),
      httpMetadata: metadata.httpMetadata || {},
      customMetadata: metadata.customMetadata || {},
    }
  }

  async version(key) {
    try {
      const details = await stat(safePath(this.root, key), { bigint: true })
      return `${details.ino}:${details.size}:${details.mtimeNs}:${details.ctimeNs}`
    } catch (error) {
      if (error?.code === 'ENOENT') return null
      throw error
    }
  }

  async list({ prefix = '', cursor = '', limit = 1000 } = {}) {
    const normalizedPrefix = String(prefix || '').replaceAll('\\', '/').replace(/^\/+?/u, '')
    const keys = (await listFiles(this.root, this.root))
      .filter((key) => key.startsWith(normalizedPrefix))
      .sort()
    const start = Math.max(0, Number(cursor || 0) || 0)
    const pageSize = Math.min(1000, Math.max(1, Number(limit) || 1000))
    const objects = []
    for (const key of keys.slice(start, start + pageSize)) {
      const object = await this.get(key)
      if (!object) continue
      const details = await stat(safePath(this.root, key))
      objects.push({ key, size: object.size, uploaded: details.mtime.toISOString() })
    }
    const truncated = start + pageSize < keys.length
    return { objects, truncated, ...(truncated ? { cursor: String(start + pageSize) } : {}) }
  }

  async delete(key) {
    const target = safePath(this.root, key)
    await Promise.all([
      rm(target, { force: true }),
      rm(`${target}${META_SUFFIX}`, { force: true }),
    ])
  }
}
