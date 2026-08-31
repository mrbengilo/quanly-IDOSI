import { randomUUID } from 'node:crypto'
import {
  cp,
  lstat,
  mkdir,
  opendir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises'
import { isAbsolute, join, parse, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

export const STATIC_RELEASE_MARKER = '.idosi-release-sha'

const FULL_RELEASE_SHA = /^[0-9a-f]{40}$/u
const HTML_TAG = /<(script|link)\b[^>]*>/giu
const HTML_ATTRIBUTE = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/gu
const STATIC_ORIGIN = 'https://static.idosi.invalid'

export class StaticReleaseError extends Error {
  constructor(code, message, options) {
    super(message, options)
    this.name = 'StaticReleaseError'
    this.code = code
  }
}

const fail = (code, message, options) => {
  throw new StaticReleaseError(code, message, options)
}

const validateReleaseSha = (releaseSha) => {
  if (typeof releaseSha !== 'string' || !FULL_RELEASE_SHA.test(releaseSha)) {
    fail('INVALID_RELEASE_SHA', 'Release SHA phải gồm đúng 40 ký tự hex viết thường.')
  }
  return releaseSha
}

const lstatOrNull = async (path) => {
  try {
    return await lstat(path)
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
}

const isWithin = (parent, candidate) => {
  const path = relative(parent, candidate)
  return path === '' || (!path.startsWith(`..${sep}`) && path !== '..' && !isAbsolute(path))
}

const assertNoSymlinkAncestors = async (path, label) => {
  const absolutePath = resolve(path)
  const { root } = parse(absolutePath)
  let cursor = root
  const segments = absolutePath.slice(root.length).split(sep).filter(Boolean)
  for (const segment of segments) {
    cursor = join(cursor, segment)
    const details = await lstatOrNull(cursor)
    if (!details) return
    if (details.isSymbolicLink()) {
      fail('SYMLINK_NOT_ALLOWED', `${label} không được đi qua symbolic link: ${cursor}`)
    }
  }
}

const assertDirectory = async (path, label) => {
  await assertNoSymlinkAncestors(path, label)
  const details = await lstatOrNull(path)
  if (!details) fail('DIRECTORY_NOT_FOUND', `Không tìm thấy ${label}: ${path}`)
  if (details.isSymbolicLink()) fail('SYMLINK_NOT_ALLOWED', `${label} không được là symbolic link: ${path}`)
  if (!details.isDirectory()) fail('NOT_A_DIRECTORY', `${label} phải là thư mục: ${path}`)
}

const assertSafeTree = async (root, label) => {
  await assertDirectory(root, label)
  const directories = [root]
  while (directories.length) {
    const directory = directories.pop()
    const entries = await opendir(directory)
    for await (const entry of entries) {
      const path = join(directory, entry.name)
      const details = await lstat(path)
      if (details.isSymbolicLink()) {
        fail('SYMLINK_NOT_ALLOWED', `${label} chứa symbolic link: ${relative(root, path)}`)
      }
      if (details.isDirectory()) {
        directories.push(path)
        continue
      }
      if (!details.isFile()) {
        fail('UNSUPPORTED_FILE_TYPE', `${label} chứa loại tệp không được hỗ trợ: ${relative(root, path)}`)
      }
    }
  }
}

const parseAttributes = (tag) => {
  const attributes = new Map()
  const openingNameEnd = tag.search(/\s|>/u)
  const source = openingNameEnd >= 0 ? tag.slice(openingNameEnd) : ''
  for (const match of source.matchAll(HTML_ATTRIBUTE)) {
    const name = match[1].toLowerCase()
    const value = match[2] ?? match[3] ?? match[4] ?? ''
    attributes.set(name, value)
  }
  return attributes
}

const referencedAssets = (html) => {
  const moduleEntries = []
  const favicons = []
  for (const match of html.matchAll(HTML_TAG)) {
    const tagName = match[1].toLowerCase()
    const attributes = parseAttributes(match[0])
    if (tagName === 'script' && String(attributes.get('type') || '').trim().toLowerCase() === 'module') {
      const source = String(attributes.get('src') || '').trim()
      if (source) moduleEntries.push(source)
    }
    if (tagName === 'link') {
      const relationships = String(attributes.get('rel') || '').trim().toLowerCase().split(/\s+/u)
      const href = String(attributes.get('href') || '').trim()
      if (relationships.includes('icon') && href) favicons.push(href)
    }
  }
  if (!moduleEntries.length) {
    fail('MODULE_ENTRY_MISSING', 'index.html phải tham chiếu ít nhất một JavaScript entry type="module".')
  }
  if (!favicons.length) fail('FAVICON_MISSING', 'index.html phải tham chiếu favicon bằng rel="icon".')
  return { moduleEntries, favicons }
}

const assetPath = (root, reference) => {
  const source = String(reference || '').trim()
  if (!source || source.includes('\\') || source.startsWith('//') || /^[a-z][a-z\d+.-]*:/iu.test(source)) {
    fail('INVALID_ASSET_REFERENCE', `Tham chiếu static asset không hợp lệ: ${source || '(trống)'}`)
  }
  const rawPath = source.split(/[?#]/u, 1)[0]
  let decodedPath
  try {
    decodedPath = decodeURIComponent(rawPath)
  } catch (error) {
    fail('INVALID_ASSET_REFERENCE', `Không thể giải mã tham chiếu static asset: ${source}`, { cause: error })
  }
  if (decodedPath.includes('\0') || decodedPath.includes('\\') || decodedPath.split('/').includes('..')) {
    fail('INVALID_ASSET_REFERENCE', `Tham chiếu static asset không được thoát khỏi release root: ${source}`)
  }

  let url
  try {
    url = new URL(source, `${STATIC_ORIGIN}/`)
  } catch (error) {
    fail('INVALID_ASSET_REFERENCE', `Tham chiếu static asset không hợp lệ: ${source}`, { cause: error })
  }
  if (url.origin !== STATIC_ORIGIN || !['http:', 'https:'].includes(url.protocol)) {
    fail('INVALID_ASSET_REFERENCE', `Static asset phải là đường dẫn nội bộ: ${source}`)
  }
  let pathname
  try {
    pathname = decodeURIComponent(url.pathname)
  } catch (error) {
    fail('INVALID_ASSET_REFERENCE', `Không thể giải mã đường dẫn static asset: ${source}`, { cause: error })
  }
  const relativeName = pathname.replace(/^\/+?/u, '')
  if (!relativeName) fail('INVALID_ASSET_REFERENCE', `Static asset phải trỏ đến một tệp: ${source}`)
  const target = resolve(root, ...relativeName.split('/'))
  if (!isWithin(root, target) || target === root) {
    fail('INVALID_ASSET_REFERENCE', `Static asset không được thoát khỏi release root: ${source}`)
  }
  return target
}

const assertRegularFile = async (path, code, message) => {
  const details = await lstatOrNull(path)
  if (!details || !details.isFile() || details.isSymbolicLink() || details.size <= 0) fail(code, message)
}

const validateStaticAssets = async (root) => {
  const indexPath = join(root, 'index.html')
  await assertRegularFile(indexPath, 'INDEX_MISSING', 'Static release thiếu index.html hợp lệ.')
  const html = await readFile(indexPath, 'utf8')
  const assets = referencedAssets(html)
  for (const reference of [...assets.moduleEntries, ...assets.favicons]) {
    const target = assetPath(root, reference)
    await assertRegularFile(
      target,
      'ASSET_MISSING',
      `Static release thiếu asset được index.html tham chiếu: ${reference}`,
    )
  }
  return assets
}

const markerPath = (targetDirectory) => join(targetDirectory, STATIC_RELEASE_MARKER)

const readReleaseMarker = async (targetDirectory, { required = true } = {}) => {
  const path = markerPath(targetDirectory)
  const details = await lstatOrNull(path)
  if (!details) {
    if (required) fail('MARKER_MISSING', `Static release thiếu marker ${STATIC_RELEASE_MARKER}.`)
    return null
  }
  if (details.isSymbolicLink()) fail('SYMLINK_NOT_ALLOWED', `${STATIC_RELEASE_MARKER} không được là symbolic link.`)
  if (!details.isFile()) fail('INVALID_MARKER', `${STATIC_RELEASE_MARKER} phải là tệp thông thường.`)
  return (await readFile(path, 'utf8')).trim()
}

const resultFor = ({ assets, copied, releaseSha, targetDirectory }) => ({
  ok: true,
  releaseSha,
  targetDirectory,
  copied,
  moduleEntries: assets.moduleEntries,
  favicons: assets.favicons,
})

export const verifyStaticRelease = async ({ targetDirectory, releaseSha } = {}) => {
  const expectedSha = validateReleaseSha(releaseSha)
  if (!targetDirectory) fail('TARGET_REQUIRED', 'Thiếu thư mục static release cần xác minh.')
  const target = resolve(targetDirectory)
  if (target === parse(target).root) fail('UNSAFE_TARGET', 'Không được dùng filesystem root làm static release target.')
  await assertSafeTree(target, 'Static release target')
  const observedSha = await readReleaseMarker(target)
  if (observedSha !== expectedSha) {
    fail('MARKER_MISMATCH', `Static release marker là ${observedSha || 'trống'}, không phải ${expectedSha}.`)
  }
  const assets = await validateStaticAssets(target)
  return resultFor({ assets, copied: false, releaseSha: expectedSha, targetDirectory: target })
}

const cleanUnpublishedTarget = async (targetDirectory) => {
  if (await lstatOrNull(markerPath(targetDirectory))) return
  const entries = await readdir(targetDirectory)
  await Promise.all(entries.map((name) => rm(join(targetDirectory, name), { recursive: true, force: true })))
}

const copyStaticTree = async (sourceDirectory, targetDirectory) => {
  const entries = await readdir(sourceDirectory)
  for (const name of entries) {
    await cp(join(sourceDirectory, name), join(targetDirectory, name), {
      recursive: true,
      errorOnExist: true,
      force: false,
      preserveTimestamps: true,
      verbatimSymlinks: true,
    })
  }
}

const writeReleaseMarker = async (targetDirectory, releaseSha) => {
  const target = markerPath(targetDirectory)
  const temporary = join(targetDirectory, `.${STATIC_RELEASE_MARKER}.${process.pid}.${randomUUID()}.tmp`)
  try {
    await writeFile(temporary, `${releaseSha}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o444 })
    await rename(temporary, target)
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => {})
    throw error
  }
}

export const prepareStaticRelease = async ({ sourceDirectory, targetDirectory, releaseSha } = {}) => {
  const expectedSha = validateReleaseSha(releaseSha)
  if (!targetDirectory) fail('TARGET_REQUIRED', 'Thiếu thư mục đích cho static release.')
  const target = resolve(targetDirectory)
  if (target === parse(target).root) fail('UNSAFE_TARGET', 'Không được dùng filesystem root làm static release target.')
  await assertNoSymlinkAncestors(target, 'Static release target')

  const targetDetails = await lstatOrNull(target)
  if (targetDetails) {
    if (targetDetails.isSymbolicLink()) fail('SYMLINK_NOT_ALLOWED', 'Static release target không được là symbolic link.')
    if (!targetDetails.isDirectory()) fail('NOT_A_DIRECTORY', `Static release target phải là thư mục: ${target}`)
    const observedSha = await readReleaseMarker(target, { required: false })
    if (observedSha !== null) return verifyStaticRelease({ targetDirectory: target, releaseSha: expectedSha })
  }

  if (!sourceDirectory) fail('SOURCE_REQUIRED', 'Thiếu thư mục nguồn của static release.')
  const source = resolve(sourceDirectory)
  if (source === parse(source).root) fail('UNSAFE_SOURCE', 'Không được dùng filesystem root làm static release source.')
  if (isWithin(source, target) || isWithin(target, source)) {
    fail('OVERLAPPING_DIRECTORIES', 'Static release source và target không được trùng hoặc lồng nhau.')
  }
  await assertSafeTree(source, 'Static release source')
  if (await lstatOrNull(markerPath(source))) {
    fail('RESERVED_MARKER', `Static release source không được chứa ${STATIC_RELEASE_MARKER}.`)
  }
  await validateStaticAssets(source)

  if (!targetDetails) await mkdir(target, { recursive: true })
  await assertSafeTree(target, 'Static release target')
  if ((await readdir(target)).length) {
    fail('TARGET_NOT_EMPTY', 'Static release target chưa có marker phải là thư mục rỗng.')
  }

  try {
    await copyStaticTree(source, target)
    await assertSafeTree(target, 'Static release target')
    const assets = await validateStaticAssets(target)
    await writeReleaseMarker(target, expectedSha)
    return resultFor({ assets, copied: true, releaseSha: expectedSha, targetDirectory: target })
  } catch (error) {
    await cleanUnpublishedTarget(target).catch(() => {})
    throw error
  }
}

const parseCli = (arguments_) => {
  const [command, ...options] = arguments_
  if (!['prepare', 'verify'].includes(command)) {
    fail('INVALID_COMMAND', 'Lệnh static release phải là prepare hoặc verify.')
  }
  const values = new Map()
  for (let index = 0; index < options.length; index += 2) {
    const option = options[index]
    const value = options[index + 1]
    if (!['--source', '--target', '--sha'].includes(option) || value === undefined || value.startsWith('--')) {
      fail('INVALID_ARGUMENTS', `Tham số static release không hợp lệ: ${option || '(trống)'}`)
    }
    if (values.has(option)) fail('INVALID_ARGUMENTS', `Tham số bị lặp: ${option}`)
    values.set(option, value)
  }
  if (!values.get('--target')) fail('TARGET_REQUIRED', 'Thiếu --target cho static release.')
  if (!values.get('--sha')) fail('INVALID_RELEASE_SHA', 'Thiếu --sha đầy đủ cho static release.')
  if (command === 'prepare' && !values.get('--source')) fail('SOURCE_REQUIRED', 'Thiếu --source khi prepare static release.')
  if (command === 'verify' && values.has('--source')) fail('INVALID_ARGUMENTS', 'Lệnh verify không nhận --source.')
  return {
    command,
    sourceDirectory: values.get('--source'),
    targetDirectory: values.get('--target'),
    releaseSha: values.get('--sha'),
  }
}

export const runStaticReleaseCli = async (arguments_ = process.argv.slice(2)) => {
  const options = parseCli(arguments_)
  return options.command === 'prepare'
    ? prepareStaticRelease(options)
    : verifyStaticRelease(options)
}

const isMainModule = process.argv[1]
  && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))

if (isMainModule) {
  runStaticReleaseCli()
    .then((result) => console.log(JSON.stringify(result)))
    .catch((error) => {
      console.error(JSON.stringify({
        ok: false,
        error: {
          code: error?.code || 'STATIC_RELEASE_ERROR',
          message: error?.message || 'Không thể chuẩn bị static release.',
        },
      }))
      process.exitCode = 1
    })
}
