import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, relative, resolve, sep } from 'node:path'

const META_SUFFIX = '.idosi-meta.json'

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

const atomicWrite = async (target, value) => {
  await mkdir(dirname(target), { recursive: true })
  const temporary = `${target}.${process.pid}.${crypto.randomUUID()}.tmp`
  try {
    await writeFile(temporary, value)
    await rename(temporary, target)
  } finally {
    await rm(temporary, { force: true }).catch(() => {})
  }
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
  constructor(rootDirectory) {
    this.root = resolve(rootDirectory)
  }

  async put(key, value, options = {}) {
    const normalizedKey = normalizeKey(key)
    const target = safePath(this.root, normalizedKey)
    const bytes = value instanceof Uint8Array ? value : new Uint8Array(value)
    const metadata = {
      httpMetadata: options.httpMetadata || {},
      customMetadata: options.customMetadata || {},
    }
    await atomicWrite(target, bytes)
    await atomicWrite(`${target}${META_SUFFIX}`, JSON.stringify(metadata))
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
    let metadata = {}
    try {
      metadata = JSON.parse(await readFile(`${target}${META_SUFFIX}`, 'utf8'))
    } catch (error) {
      if (error?.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error
    }
    return {
      body: bytes,
      size: bytes.byteLength,
      etag: createHash('sha256').update(bytes).digest('hex'),
      httpMetadata: metadata.httpMetadata || {},
      customMetadata: metadata.customMetadata || {},
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
      const details = await stat(safePath(this.root, key))
      objects.push({ key, size: details.size, uploaded: details.mtime.toISOString() })
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
