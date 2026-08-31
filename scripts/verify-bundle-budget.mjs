import { readFile, stat } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const KIB = 1024

export const DEFAULT_BUNDLE_BUDGETS = Object.freeze({
  initialJavaScript: 500 * KIB,
  entryCss: 120 * KIB,
  favicon: 48 * KIB,
})

const ASSET_GROUPS = Object.freeze([
  { key: 'initialJavaScript', label: 'initial JavaScript' },
  { key: 'entryCss', label: 'entry CSS' },
  { key: 'favicon', label: 'favicon' },
])

function parseAttributes(tag) {
  const attributes = {}
  const attributePattern = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/gu

  for (const match of tag.matchAll(attributePattern)) {
    const [, name, doubleQuotedValue, singleQuotedValue, unquotedValue] = match
    attributes[name.toLowerCase()] = doubleQuotedValue ?? singleQuotedValue ?? unquotedValue ?? ''
  }

  return attributes
}

export function collectEntryAssetReferences(html) {
  const assets = {
    initialJavaScript: [],
    entryCss: [],
    favicon: [],
  }

  for (const match of html.matchAll(/<script\b[^>]*>/giu)) {
    const attributes = parseAttributes(match[0])
    if (attributes.src) assets.initialJavaScript.push(attributes.src)
  }

  for (const match of html.matchAll(/<link\b[^>]*>/giu)) {
    const attributes = parseAttributes(match[0])
    const relationships = new Set((attributes.rel || '').toLowerCase().split(/\s+/u).filter(Boolean))

    if (relationships.has('modulepreload') && attributes.href) assets.initialJavaScript.push(attributes.href)
    if (relationships.has('stylesheet') && attributes.href) assets.entryCss.push(attributes.href)
    if (relationships.has('icon') && attributes.href) assets.favicon.push(attributes.href)
  }

  return assets
}

function isLocalAssetReference(reference) {
  return !/^(?:[a-z][a-z\d+.-]*:|\/\/)/iu.test(reference)
}

function resolveAssetPath(outputDirectory, htmlPath, reference) {
  if (!isLocalAssetReference(reference)) return null

  const pathname = reference.split(/[?#]/u, 1)[0]
  if (!pathname) return null

  let decodedPathname
  try {
    decodedPathname = decodeURIComponent(pathname)
  } catch {
    throw new Error(`Invalid encoded asset reference in ${htmlPath}: ${reference}`)
  }

  const assetPath = decodedPathname.startsWith('/')
    ? resolve(outputDirectory, `.${decodedPathname}`)
    : resolve(dirname(htmlPath), decodedPathname)
  const relativeAssetPath = relative(outputDirectory, assetPath)

  if (relativeAssetPath.startsWith('..') || isAbsolute(relativeAssetPath)) {
    throw new Error(`Asset reference escapes the build output in ${htmlPath}: ${reference}`)
  }

  return assetPath
}

function formatBytes(bytes) {
  return `${(bytes / KIB).toFixed(1)} KiB`
}

async function pathExists(path) {
  try {
    await stat(path)
    return true
  } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw error
  }
}

async function findClientOutputs(distDirectory) {
  const candidates = [distDirectory, resolve(distDirectory, 'client')]
  const outputs = []

  for (const outputDirectory of candidates) {
    const htmlPath = resolve(outputDirectory, 'index.html')
    if (await pathExists(htmlPath)) outputs.push({ outputDirectory, htmlPath })
  }

  if (outputs.length === 0) {
    throw new Error(
      `No client index.html found under ${distDirectory}. Run the Vite build before verifying bundle budgets.`,
    )
  }

  return outputs
}

async function measureAssetGroup({ outputDirectory, htmlPath, references }) {
  const uniqueAssetPaths = new Set()

  for (const reference of references) {
    const assetPath = resolveAssetPath(outputDirectory, htmlPath, reference)
    if (assetPath) uniqueAssetPaths.add(assetPath)
  }

  const files = []
  let totalBytes = 0

  for (const assetPath of uniqueAssetPaths) {
    const assetStat = await stat(assetPath)
    if (!assetStat.isFile()) throw new Error(`Expected a build asset file: ${assetPath}`)

    totalBytes += assetStat.size
    files.push({
      path: relative(outputDirectory, assetPath),
      bytes: assetStat.size,
    })
  }

  return { files, totalBytes }
}

export async function verifyBundleBudgets({
  distDirectory = resolve(process.cwd(), 'dist'),
  budgets = DEFAULT_BUNDLE_BUDGETS,
} = {}) {
  const resolvedDistDirectory = resolve(distDirectory)
  const outputs = await findClientOutputs(resolvedDistDirectory)
  const results = []
  const violations = []

  for (const { outputDirectory, htmlPath } of outputs) {
    const html = await readFile(htmlPath, 'utf8')
    const references = collectEntryAssetReferences(html)
    const outputLabel = relative(process.cwd(), outputDirectory) || '.'
    const groups = {}

    if (references.initialJavaScript.length === 0) {
      throw new Error(`No initial JavaScript reference found in ${htmlPath}`)
    }

    for (const { key, label } of ASSET_GROUPS) {
      const measurement = await measureAssetGroup({
        outputDirectory,
        htmlPath,
        references: references[key],
      })
      const budgetBytes = budgets[key]
      groups[key] = { ...measurement, budgetBytes }

      if (!Number.isFinite(budgetBytes) || budgetBytes < 0) {
        throw new TypeError(`Bundle budget for ${key} must be a non-negative finite number.`)
      }

      if (measurement.totalBytes > budgetBytes) {
        const fileSummary = measurement.files
          .map((file) => `${file.path} (${formatBytes(file.bytes)})`)
          .join(', ')
        violations.push(
          `${outputLabel} ${label}: ${formatBytes(measurement.totalBytes)} > ${formatBytes(budgetBytes)}`
            + (fileSummary ? ` [${fileSummary}]` : ''),
        )
      }
    }

    results.push({ outputDirectory, outputLabel, groups })
  }

  if (violations.length > 0) {
    throw new Error(`Bundle budget exceeded:\n- ${violations.join('\n- ')}`)
  }

  return results
}

function printResults(results) {
  console.log('Bundle budgets verified.')
  for (const { outputLabel, groups } of results) {
    console.log(`- ${outputLabel}`)
    for (const { key, label } of ASSET_GROUPS) {
      const { totalBytes, budgetBytes } = groups[key]
      console.log(`  ${label}: ${formatBytes(totalBytes)} / ${formatBytes(budgetBytes)}`)
    }
  }
}

const invokedAsScript = process.argv[1]
  && import.meta.url === pathToFileURL(resolve(process.argv[1])).href

if (invokedAsScript) {
  try {
    printResults(await verifyBundleBudgets())
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  }
}
