import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { normalizeReleaseSha } from './release-info.mjs'

const DEFAULT_TIMEOUT_MS = 30_000
const STATIC_RELEASE_HEADER = 'x-idosi-static-release'
const REQUIRED_HEALTH_CONFIGURATION = [
  ['databaseConfigured', 'database'],
  ['identityImageStorageConfigured', 'identity image storage'],
  ['accountAvatarStorageConfigured', 'account avatar storage'],
]

const publicOrigin = (baseUrl) => {
  let parsed
  try {
    parsed = new URL(baseUrl)
  } catch (error) {
    throw new Error('Base URL phải là URL HTTP(S) tuyệt đối hợp lệ.', { cause: error })
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new Error('Base URL phải là URL HTTP(S) tuyệt đối hợp lệ.')
  }
  return new URL('/', parsed.origin)
}

const request = async (url, fetchImpl, timeoutMs, expectedStatus = 200, accept = '*/*') => {
  const fetchOnce = () => fetchImpl(url, {
    method: 'GET',
    headers: { accept },
    redirect: 'error',
    signal: AbortSignal.timeout(timeoutMs),
  })
  let response
  try {
    response = await fetchOnce()
  } catch {
    // Retry one cold transport/timeout failure with a fresh timeout signal.
    response = await fetchOnce()
  }
  if (response.status !== expectedStatus) {
    throw new Error(`${url.pathname} trả về HTTP ${response.status}, mong đợi HTTP ${expectedStatus}.`)
  }
  return response
}

const requestJson = async (url, fetchImpl, timeoutMs) => {
  const response = await request(url, fetchImpl, timeoutMs, 200, 'application/json')
  try {
    return await response.json()
  } catch (error) {
    throw new Error(`${url.pathname} không trả về JSON hợp lệ.`, { cause: error })
  }
}

const assertStaticRelease = (response, url, expectedReleaseSha) => {
  const observed = response.headers.get(STATIC_RELEASE_HEADER)
  if (observed !== expectedReleaseSha) {
    throw new Error(`${url.pathname} có X-IDOSI-Static-Release=${observed || 'missing'}, mong đợi ${expectedReleaseSha}.`)
  }
}

const parseAttributes = (source) => {
  const attributes = new Map()
  const pattern = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/gu
  for (const match of source.matchAll(pattern)) {
    attributes.set(match[1].toLowerCase(), match[2] ?? match[3] ?? match[4] ?? '')
  }
  return attributes
}

const referencedAsset = (html, tagPattern, predicate, attribute, label) => {
  const document = html.replace(/<!--[\s\S]*?-->/gu, '')
  for (const match of document.matchAll(tagPattern)) {
    const attributes = parseAttributes(match[1])
    if (predicate(attributes) && attributes.get(attribute)) return attributes.get(attribute)
  }
  throw new Error(`HTML không tham chiếu ${label}.`)
}

const hasTraversal = (reference) => {
  let decoded = reference.split(/[?#]/u, 1)[0]
  for (let pass = 0; pass < 3; pass += 1) {
    if (decoded.includes('\\') || decoded.split('/').some((segment) => segment === '..')) return true
    let next
    try {
      next = decodeURIComponent(decoded)
    } catch {
      return true
    }
    if (next === decoded) return false
    decoded = next
  }
  return decoded.includes('\\') || decoded.split('/').some((segment) => segment === '..')
}

const safeAssetUrl = (reference, documentUrl, label) => {
  const candidate = String(reference || '').trim()
  const hasControlCharacter = [...candidate].some((character) => {
    const codePoint = character.codePointAt(0)
    return codePoint <= 0x1f || codePoint === 0x7f
  })
  if (!candidate || hasControlCharacter || hasTraversal(candidate)) {
    throw new Error(`${label} có URL không an toàn.`)
  }

  let assetUrl
  try {
    assetUrl = new URL(candidate, documentUrl)
  } catch (error) {
    throw new Error(`${label} có URL không hợp lệ.`, { cause: error })
  }
  if (!['http:', 'https:'].includes(assetUrl.protocol)
    || assetUrl.origin !== documentUrl.origin
    || assetUrl.username
    || assetUrl.password) {
    throw new Error(`${label} phải dùng URL cùng origin.`)
  }
  return assetUrl
}

const releaseProbeUrl = (assetUrl, expectedReleaseSha) => {
  const probeUrl = new URL(assetUrl)
  probeUrl.searchParams.set('_idosi_release', expectedReleaseSha)
  probeUrl.hash = ''
  return probeUrl
}

const requestNonEmptyAsset = async ({
  url,
  fetchImpl,
  timeoutMs,
  expectedReleaseSha,
  accept,
  validContentType,
  contentTypeLabel,
}) => {
  const response = await request(url, fetchImpl, timeoutMs, 200, accept)
  assertStaticRelease(response, url, expectedReleaseSha)
  const contentType = String(response.headers.get('content-type') || '').split(';', 1)[0].trim().toLowerCase()
  if (!validContentType(contentType)) {
    throw new Error(`${url.pathname} có Content-Type=${contentType || 'missing'}, mong đợi ${contentTypeLabel}.`)
  }
  const bytes = (await response.arrayBuffer()).byteLength
  if (bytes === 0) throw new Error(`${url.pathname} trả về nội dung rỗng.`)
  return bytes
}

export const verifyPublicRelease = async ({
  baseUrl,
  expectedReleaseSha,
  fetchImpl = fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) => {
  const expected = normalizeReleaseSha(expectedReleaseSha)
  if (expected === 'unknown') throw new Error('Release SHA phải là commit SHA đầy đủ gồm 40 ký tự hex.')
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('Timeout phải là số mili giây dương.')

  const origin = publicOrigin(baseUrl)
  const healthUrl = new URL('/api/health', origin)
  const releaseUrl = new URL('/api/release', origin)
  const documentUrl = new URL('/', origin)
  const markerUrl = new URL('/.idosi-release-sha', origin)

  const health = await requestJson(healthUrl, fetchImpl, timeoutMs)
  if (health?.ok !== true) throw new Error('/api/health không báo trạng thái ok.')
  for (const [field, label] of REQUIRED_HEALTH_CONFIGURATION) {
    if (health?.[field] !== true) throw new Error(`/api/health báo ${label} chưa được cấu hình.`)
  }

  const release = await requestJson(releaseUrl, fetchImpl, timeoutMs)
  if (release?.ok !== true) throw new Error('/api/release không báo trạng thái ok.')
  const runningReleaseSha = normalizeReleaseSha(release?.data?.releaseSha)
  if (runningReleaseSha !== expected) {
    throw new Error(`Production đang chạy ${runningReleaseSha}, không phải ${expected}.`)
  }

  const documentResponse = await request(documentUrl, fetchImpl, timeoutMs, 200, 'text/html')
  assertStaticRelease(documentResponse, documentUrl, expected)
  if (!String(documentResponse.headers.get('content-type') || '').toLowerCase().startsWith('text/html')) {
    throw new Error('/ không trả về nội dung HTML.')
  }
  const html = await documentResponse.text()
  if (!html.trim()) throw new Error('/ trả về HTML rỗng.')

  const entryReference = referencedAsset(
    html,
    /<script\b([^>]*)>/giu,
    (attributes) => attributes.get('type')?.trim().toLowerCase() === 'module' && attributes.has('src'),
    'src',
    'JavaScript entry dạng module',
  )
  const faviconReference = referencedAsset(
    html,
    /<link\b([^>]*)>/giu,
    (attributes) => String(attributes.get('rel') || '').toLowerCase().split(/\s+/u).includes('icon'),
    'href',
    'favicon',
  )
  const entryUrl = releaseProbeUrl(
    safeAssetUrl(entryReference, documentUrl, 'JavaScript entry'),
    expected,
  )
  const faviconUrl = releaseProbeUrl(
    safeAssetUrl(faviconReference, documentUrl, 'Favicon'),
    expected,
  )

  const [entryBytes, faviconBytes] = await Promise.all([
    requestNonEmptyAsset({
      url: entryUrl,
      fetchImpl,
      timeoutMs,
      expectedReleaseSha: expected,
      accept: 'text/javascript, application/javascript',
      validContentType: (contentType) => ['text/javascript', 'application/javascript'].includes(contentType),
      contentTypeLabel: 'JavaScript',
    }),
    requestNonEmptyAsset({
      url: faviconUrl,
      fetchImpl,
      timeoutMs,
      expectedReleaseSha: expected,
      accept: 'image/*',
      validContentType: (contentType) => contentType.startsWith('image/'),
      contentTypeLabel: 'image/*',
    }),
  ])
  await request(markerUrl, fetchImpl, timeoutMs, 404)

  return {
    ok: true,
    baseUrl: origin.origin,
    releaseSha: runningReleaseSha,
    startedAt: release?.data?.startedAt || null,
    assets: {
      entry: { url: entryUrl.href, bytes: entryBytes },
      favicon: { url: faviconUrl.href, bytes: faviconBytes },
    },
  }
}

const isMainModule = process.argv[1]
  && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))

if (isMainModule) {
  const [baseUrl, expectedReleaseSha] = process.argv.slice(2)
  verifyPublicRelease({ baseUrl, expectedReleaseSha })
    .then((result) => console.log(JSON.stringify(result)))
    .catch((error) => {
      console.error(error.message)
      process.exitCode = 1
    })
}
