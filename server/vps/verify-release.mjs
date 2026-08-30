import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { normalizeReleaseSha } from './release-info.mjs'

const requestJson = async (url, fetchImpl, timeoutMs) => {
  const response = await fetchImpl(url, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!response.ok) throw new Error(`${url.pathname} trả về HTTP ${response.status}.`)
  try {
    return await response.json()
  } catch (error) {
    throw new Error(`${url.pathname} không trả về JSON hợp lệ.`, { cause: error })
  }
}

export const verifyRelease = async ({
  baseUrl,
  expectedReleaseSha,
  fetchImpl = fetch,
  timeoutMs = 10_000,
} = {}) => {
  const expected = normalizeReleaseSha(expectedReleaseSha)
  if (expected === 'unknown') throw new Error('Release SHA phải là commit SHA đầy đủ gồm 40 ký tự hex.')

  const origin = new URL(baseUrl)
  const healthUrl = new URL('/api/health', origin)
  const releaseUrl = new URL('/api/release', origin)
  const health = await requestJson(healthUrl, fetchImpl, timeoutMs)
  if (health?.ok !== true) throw new Error('/api/health không báo trạng thái ok.')

  const release = await requestJson(releaseUrl, fetchImpl, timeoutMs)
  const runningReleaseSha = normalizeReleaseSha(release?.data?.releaseSha)
  if (runningReleaseSha !== expected) {
    throw new Error(`Production đang chạy ${runningReleaseSha}, không phải ${expected}.`)
  }

  return {
    ok: true,
    baseUrl: origin.origin,
    releaseSha: runningReleaseSha,
    startedAt: release?.data?.startedAt || null,
  }
}

const isMainModule = process.argv[1]
  && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))

if (isMainModule) {
  const [baseUrl, expectedReleaseSha] = process.argv.slice(2)
  verifyRelease({ baseUrl, expectedReleaseSha })
    .then((result) => console.log(JSON.stringify(result)))
    .catch((error) => {
      console.error(error.message)
      process.exitCode = 1
    })
}
