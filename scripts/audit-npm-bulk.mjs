import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { gunzipSync } from 'node:zlib'

const DEFAULT_REGISTRY = 'https://registry.npmjs.org/'
const DEFAULT_ATTEMPTS = 3
const SEVERITY_RANK = Object.freeze({
  info: 0,
  low: 1,
  moderate: 2,
  high: 3,
  critical: 4,
})

const cleanText = (value) => String(value ?? '')
  .replace(/[\u0000-\u001f\u007f]/gu, ' ')
  .replace(/\s+/gu, ' ')
  .trim()

const delay = (milliseconds) => new Promise((resolveDelay) => {
  setTimeout(resolveDelay, milliseconds)
})

const packageNameFromPath = (packagePath) => {
  const normalized = String(packagePath || '').replaceAll('\\', '/')
  const marker = 'node_modules/'
  const index = normalized.lastIndexOf(marker)
  return index >= 0 ? normalized.slice(index + marker.length) : ''
}

export function buildBulkAdvisoryPayload(lockfile, { omitDev = false } = {}) {
  if (!lockfile || typeof lockfile !== 'object' || !lockfile.packages || typeof lockfile.packages !== 'object') {
    throw new TypeError('package-lock.json must contain a packages object.')
  }
  const versionsByName = new Map()
  for (const [packagePath, metadata] of Object.entries(lockfile.packages)) {
    if (!packagePath || !metadata || typeof metadata !== 'object' || metadata.link) continue
    if (omitDev && metadata.dev === true) continue
    const name = cleanText(metadata.name || packageNameFromPath(packagePath))
    const version = cleanText(metadata.version)
    if (!name || !version) continue
    const versions = versionsByName.get(name) || new Set()
    versions.add(version)
    versionsByName.set(name, versions)
  }

  return Object.fromEntries(
    [...versionsByName.entries()]
      .sort(([left], [right]) => left.localeCompare(right, 'en-US'))
      .map(([name, versions]) => [name, [...versions].sort((left, right) => left.localeCompare(right, 'en-US'))]),
  )
}

export function decodeBulkAdvisoryBody(rawBody) {
  const raw = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody)
  const body = raw.length >= 2 && raw[0] === 0x1f && raw[1] === 0x8b
    ? gunzipSync(raw)
    : raw
  const text = body.toString('utf8').replace(/^\uFEFF/u, '')
  if (!text.trim()) throw new Error('The npm bulk advisory endpoint returned an empty response.')
  try {
    return JSON.parse(text)
  } catch (error) {
    throw new Error(`The npm bulk advisory endpoint returned invalid JSON: ${cleanText(error?.message)}`)
  }
}

const normalizeAdvisories = (value) => {
  if (Array.isArray(value)) return value
  if (Array.isArray(value?.advisories)) return value.advisories
  return []
}

export function collectAdvisories(report) {
  if (!report || typeof report !== 'object' || Array.isArray(report)) {
    throw new TypeError('The npm bulk advisory report must be an object.')
  }
  const findings = []
  const seen = new Set()
  for (const [packageName, value] of Object.entries(report)) {
    for (const advisory of normalizeAdvisories(value)) {
      if (!advisory || typeof advisory !== 'object') continue
      const severity = cleanText(advisory.severity).toLowerCase()
      const finding = {
        packageName: cleanText(packageName),
        severity: Object.hasOwn(SEVERITY_RANK, severity) ? severity : 'info',
        id: cleanText(advisory.id || advisory.source || advisory.github_advisory_id),
        title: cleanText(advisory.title || advisory.name || 'Untitled advisory'),
        url: cleanText(advisory.url),
        vulnerableVersions: cleanText(advisory.vulnerable_versions || advisory.vulnerableVersions),
      }
      const key = [finding.packageName, finding.id, finding.url, finding.vulnerableVersions].join('\u0000')
      if (seen.has(key)) continue
      seen.add(key)
      findings.push(finding)
    }
  }
  return findings.sort((left, right) => (
    SEVERITY_RANK[right.severity] - SEVERITY_RANK[left.severity]
    || left.packageName.localeCompare(right.packageName, 'en-US')
    || left.id.localeCompare(right.id, 'en-US')
  ))
}

export function advisoriesAtOrAbove(findings, auditLevel = 'high') {
  const normalizedLevel = cleanText(auditLevel).toLowerCase()
  if (!Object.hasOwn(SEVERITY_RANK, normalizedLevel)) {
    throw new TypeError(`Unsupported audit level: ${auditLevel}`)
  }
  return findings.filter((finding) => SEVERITY_RANK[finding.severity] >= SEVERITY_RANK[normalizedLevel])
}

const endpointForRegistry = (registry) => {
  const normalized = cleanText(registry || DEFAULT_REGISTRY)
  const base = normalized.endsWith('/') ? normalized : `${normalized}/`
  return new URL('-/npm/v1/security/advisories/bulk', base).toString()
}

export async function requestBulkAdvisories(payload, {
  registry = process.env.npm_config_registry || DEFAULT_REGISTRY,
  attempts = DEFAULT_ATTEMPTS,
  timeoutMs = 90_000,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (typeof fetchImpl !== 'function') throw new TypeError('A Fetch API implementation is required.')
  const endpoint = endpointForRegistry(registry)
  const serialized = JSON.stringify(payload)
  let lastError = null

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          'user-agent': 'idosi-ci-bulk-audit/1.0',
        },
        body: serialized,
        signal: AbortSignal.timeout(timeoutMs),
      })
      const rawBody = Buffer.from(await response.arrayBuffer())
      if (!response.ok) {
        const responseText = rawBody.toString('utf8').slice(0, 500)
        throw new Error(`npm bulk advisory request failed with HTTP ${response.status}: ${cleanText(responseText)}`)
      }
      return decodeBulkAdvisoryBody(rawBody)
    } catch (error) {
      lastError = error
      if (attempt < attempts) {
        const waitMs = Math.min(2_000 * (2 ** (attempt - 1)), 8_000)
        console.warn(`npm bulk advisory attempt ${attempt}/${attempts} failed: ${cleanText(error?.message)}; retrying in ${waitMs}ms.`)
        await delay(waitMs)
      }
    }
  }

  throw new Error(`npm bulk advisory request failed after ${attempts} attempts: ${cleanText(lastError?.message)}`)
}

const parseArguments = (argumentsList) => {
  const options = { auditLevel: 'high', omitDev: false }
  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index]
    if (argument === '--omit=dev' || argument === '--production') {
      options.omitDev = true
      continue
    }
    if (argument === '--audit-level') {
      options.auditLevel = argumentsList[index + 1] || ''
      index += 1
      continue
    }
    if (argument.startsWith('--audit-level=')) {
      options.auditLevel = argument.slice('--audit-level='.length)
      continue
    }
    throw new TypeError(`Unsupported argument: ${argument}`)
  }
  if (!Object.hasOwn(SEVERITY_RANK, options.auditLevel)) {
    throw new TypeError(`Unsupported audit level: ${options.auditLevel}`)
  }
  return options
}

const summarizePayload = (payload) => Object.values(payload)
  .reduce((sum, versions) => sum + versions.length, 0)

const printFinding = (finding) => {
  const details = [
    `[${finding.severity.toUpperCase()}] ${finding.packageName}: ${finding.title}`,
    finding.id ? `id=${finding.id}` : '',
    finding.vulnerableVersions ? `range=${finding.vulnerableVersions}` : '',
    finding.url,
  ].filter(Boolean)
  console.error(details.join(' | '))
}

export async function runBulkAudit({
  lockfilePath = resolve('package-lock.json'),
  auditLevel = 'high',
  omitDev = false,
  registry,
  fetchImpl,
} = {}) {
  const lockfile = JSON.parse(await readFile(lockfilePath, 'utf8'))
  const payload = buildBulkAdvisoryPayload(lockfile, { omitDev })
  const report = await requestBulkAdvisories(payload, { registry, fetchImpl })
  const findings = collectAdvisories(report)
  const blockingFindings = advisoriesAtOrAbove(findings, auditLevel)
  const packageVersionCount = summarizePayload(payload)

  console.log(`npm bulk audit checked ${packageVersionCount} package version(s)${omitDev ? ' in the production tree' : ''}.`)
  console.log(`npm bulk audit found ${findings.length} advisory match(es); ${blockingFindings.length} at or above ${auditLevel}.`)
  for (const finding of blockingFindings) printFinding(finding)
  if (blockingFindings.length) {
    throw new Error(`Dependency audit failed with ${blockingFindings.length} ${auditLevel}-or-higher advisory match(es).`)
  }
  return { payload, report, findings, blockingFindings }
}

const entryPoint = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : ''
if (entryPoint === import.meta.url) {
  try {
    const options = parseArguments(process.argv.slice(2))
    await runBulkAudit(options)
  } catch (error) {
    console.error(`npm bulk audit error: ${cleanText(error?.message)}`)
    process.exitCode = 1
  }
}
