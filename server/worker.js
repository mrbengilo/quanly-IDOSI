import {
  validateStoreChecklistCheckout,
} from '../src/domain/storeShiftChecklist.js'
import {
  DEFAULT_WORK_CATALOG_ITEMS,
  STAFF_WORK_CATALOG_SEED_VERSION,
  REVENUE_BONUS_PROGRAM_IDS,
  TEAM_MILESTONE_PROGRAM_IDS,
  WORKBOOK_COMPENSATION_POLICY,
  calculateRevenueBonus,
  calculateTeamMilestoneReward,
} from '../src/domain/compensationPolicies.js'
import { allocateByLargestRemainder } from '../src/domain/compensationAllocation.js'
import { applyAdvanceToNetPay, applyViolationWaterfall } from '../src/domain/compensationSettlement.js'
import { revenueBonusEligibility } from '../src/domain/revenueBonusEligibility.js'
import {
  STORE_EMPLOYMENT_TYPE,
  STORE_FULL_TIME_THRESHOLD_HOURS,
  STORE_PAYROLL_MODEL,
  STORE_PAYROLL_POLICY,
  STORE_SALARY_CONFIG_IDENTIFIER_COLLISION,
  calculateStoreEmployeeBasePay,
  classifyStorePayrollPolicy,
  defaultStoreTieredRates,
  effectiveStoreSalaryConfig,
  normalizeStoreEmploymentType,
  normalizeStoreSalaryConfig,
} from '../src/domain/storeTieredPayroll.js'
import {
  calculateManagerMonthlyRevenueBonus,
  managerRevenueBonusIdempotencyKey,
  resolveExactlyOneActiveStoreManager,
} from '../src/domain/managerRevenueBonus.js'
import {
  WORK_CATALOG_KIND,
  WORK_CATALOG_TARGET,
  activeWorkCatalogItems,
  normalizeWorkCatalogItem,
  snapshotActiveWorkCatalogItems,
  softDeleteWorkCatalogItem,
  workCatalogClaimKey,
  workCatalogProgressKey,
  workCatalogViolationKey,
} from '../src/domain/workCatalog.js'

const API_PREFIX = '/api/'
const MAX_JSON_BYTES = 16 * 1024 * 1024
const MAX_COMPACT_STATE_BYTES = 1_500_000
const MAX_STATE_ENTITY_BYTES = 1_500_000
const MAX_STATE_BATCH_JSON_BYTES = 1_400_000
const MAX_AUDIT_JSON_BYTES = 350_000
const MAX_RECEIPT_INLINE_BYTES = 1_500_000
const MAX_RECEIPT_CHUNK_BYTES = 1_500_000
const STATE_ENTITY_ORDER_STEP = 1_000_000
const STATE_ENTITY_PAGE_SIZE = 10_000
// Retained serialized snapshot budget; request-local materialization may temporarily use more heap.
const MAX_GLOBAL_STATE_SNAPSHOT_CACHE_BYTES = 24 * 1024 * 1024
const MAX_AVATAR_BYTES = 300 * 1024
const MAX_IDENTITY_IMAGE_BYTES = 300 * 1024
const ACCOUNT_AVATAR_KEY_PREFIX = 'account-avatars/'
const ACCOUNT_AVATAR_MIGRATION_METADATA_KEY = 'migration:account-avatars-v1'
const ACCOUNT_AVATAR_PENDING_CLEANUP_KEY = 'account-avatars:pending-cleanup'
const ACCOUNT_AVATAR_MUTATION_CLEANUP_PREFIX = 'account-avatars:mutation-cleanup:'
// Cancelled markers are permanent late-put fences, so bound them per owner without a cross-account cap.
const MAX_ACCOUNT_AVATAR_MUTATION_MARKERS_PER_USER = 8
const MAX_JSON_DEPTH = 64
const MAX_MONEY_VND = 100_000_000_000
const DEFAULT_SESSION_TTL_SECONDS = 12 * 60 * 60
const PBKDF2_ALGORITHM = 'PBKDF2-SHA256'
const DEFAULT_PBKDF2_ITERATIONS = 100_000
const MIN_PBKDF2_ITERATIONS = 100_000
// Generate at the current VPS-safe cost while accepting historical values allowed by the database schema.
const MAX_PBKDF2_GENERATION_ITERATIONS = 100_000
const MAX_PBKDF2_VERIFICATION_ITERATIONS = 1_000_000
const VALID_ROLES = new Set(['admin', 'business_support', 'store_manager', 'employee'])
const VALID_ACCOUNT_STATUSES = new Set(['active', 'locked', 'inactive'])
const globalStateSnapshotCaches = new WeakMap()

const ACCOUNT_AVATAR_CONTENT_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
const MAX_AVATAR_DIMENSION = 4096
const MAX_AVATAR_PIXELS = 16 * 1024 * 1024
const MAX_AVATAR_DECODED_BYTES = 32 * 1024 * 1024
const MAX_GIF_AVATAR_PIXELS = 1024 * 1024

const readUint16BigEndian = (bytes, offset) => (bytes[offset] * 0x100) + bytes[offset + 1]
const readUint16LittleEndian = (bytes, offset) => bytes[offset] + (bytes[offset + 1] * 0x100)
const readUint24LittleEndian = (bytes, offset) => bytes[offset] + (bytes[offset + 1] * 0x100) + (bytes[offset + 2] * 0x10000)
const readUint32BigEndian = (bytes, offset) => (
  (bytes[offset] * 0x1000000) + (bytes[offset + 1] * 0x10000) + (bytes[offset + 2] * 0x100) + bytes[offset + 3]
) >>> 0
const readUint32LittleEndian = (bytes, offset) => (
  bytes[offset] + (bytes[offset + 1] * 0x100) + (bytes[offset + 2] * 0x10000) + (bytes[offset + 3] * 0x1000000)
) >>> 0
const asciiAt = (bytes, offset, length) => String.fromCharCode(...bytes.subarray(offset, offset + length))
const validAvatarDimensions = (width, height, channels = 4, bytesPerChannel = 1) => {
  const pixels = width * height
  return Number.isSafeInteger(width) && Number.isSafeInteger(height)
    && width > 0 && height > 0
    && width <= MAX_AVATAR_DIMENSION && height <= MAX_AVATAR_DIMENSION
    && Number.isSafeInteger(pixels) && pixels <= MAX_AVATAR_PIXELS
    && pixels * channels * bytesPerChannel <= MAX_AVATAR_DECODED_BYTES
}

const crc32 = (bytes, start, end) => {
  let crc = 0xffffffff
  for (let index = start; index < end; index += 1) {
    crc ^= bytes[index]
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
  }
  return (crc ^ 0xffffffff) >>> 0
}

const pngRowPlan = (width, height, bitsPerPixel, interlace) => {
  const passes = interlace
    ? [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]]
    : [[0, 0, 1, 1]]
  const plan = []
  let decodedBytes = 0
  for (const [startX, startY, stepX, stepY] of passes) {
    const passWidth = width > startX ? Math.ceil((width - startX) / stepX) : 0
    const passHeight = height > startY ? Math.ceil((height - startY) / stepY) : 0
    if (!passWidth || !passHeight) continue
    const stride = 1 + Math.ceil((passWidth * bitsPerPixel) / 8)
    decodedBytes += stride * passHeight
    if (!Number.isSafeInteger(decodedBytes) || decodedBytes > MAX_AVATAR_DECODED_BYTES) return null
    plan.push({ rows: passHeight, stride })
  }
  return { decodedBytes, plan }
}

const validInflatedPng = async (idatParts, rowPlan) => {
  if (typeof Blob !== 'function' || typeof DecompressionStream !== 'function') return false
  let reader
  try {
    reader = new Blob(idatParts).stream().pipeThrough(new DecompressionStream('deflate')).getReader()
    const inflated = new Uint8Array(rowPlan.decodedBytes)
    let written = 0
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (!(value instanceof Uint8Array) || written + value.byteLength > inflated.byteLength) {
        await reader.cancel().catch(() => {})
        return false
      }
      inflated.set(value, written)
      written += value.byteLength
    }
    if (written !== inflated.byteLength) return false
    let offset = 0
    for (const { rows, stride } of rowPlan.plan) {
      for (let row = 0; row < rows; row += 1) {
        if (inflated[offset] > 4) return false
        offset += stride
      }
    }
    return offset === inflated.byteLength
  } catch {
    await reader?.cancel().catch(() => {})
    return false
  }
}

const validPngAvatar = async (bytes) => {
  if (bytes.length < 57
    || ![0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((value, index) => bytes[index] === value)) return false
  let offset = 8
  let colorType
  let seenHeader = false
  let seenPalette = false
  let seenImageData = false
  let imageDataClosed = false
  let seenEnd = false
  let rowPlan
  const idatParts = []
  while (offset < bytes.length) {
    if (offset + 12 > bytes.length) return false
    const length = readUint32BigEndian(bytes, offset)
    const dataStart = offset + 8
    const dataEnd = dataStart + length
    if (!Number.isSafeInteger(dataEnd) || dataEnd + 4 > bytes.length) return false
    const typeBytes = bytes.subarray(offset + 4, offset + 8)
    if (![...typeBytes].every((value) => (value >= 65 && value <= 90) || (value >= 97 && value <= 122))
      || (typeBytes[2] & 0x20) !== 0
      || crc32(bytes, offset + 4, dataEnd) !== readUint32BigEndian(bytes, dataEnd)) return false
    const type = asciiAt(bytes, offset + 4, 4)
    if (!seenHeader && type !== 'IHDR') return false
    if (seenEnd) return false
    if (seenImageData && type !== 'IDAT') imageDataClosed = true
    if (type === 'IHDR') {
      if (seenHeader || length !== 13) return false
      const width = readUint32BigEndian(bytes, dataStart)
      const height = readUint32BigEndian(bytes, dataStart + 4)
      const bitDepth = bytes[dataStart + 8]
      colorType = bytes[dataStart + 9]
      const channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 })[colorType]
      const validDepths = ({ 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] })[colorType]
      if (!channels || !validDepths.includes(bitDepth)
        || bytes[dataStart + 10] !== 0 || bytes[dataStart + 11] !== 0 || ![0, 1].includes(bytes[dataStart + 12])
        || !validAvatarDimensions(width, height, channels, bitDepth === 16 ? 2 : 1)) return false
      rowPlan = pngRowPlan(width, height, channels * bitDepth, bytes[dataStart + 12])
      if (!rowPlan) return false
      seenHeader = true
    } else if (type === 'PLTE') {
      if (!seenHeader || seenPalette || seenImageData || length < 3 || length > 768 || length % 3 !== 0 || [0, 4].includes(colorType)) return false
      seenPalette = true
    } else if (type === 'IDAT') {
      if (!seenHeader || imageDataClosed || (colorType === 3 && !seenPalette)) return false
      seenImageData = true
      idatParts.push(bytes.slice(dataStart, dataEnd))
    } else if (type === 'IEND') {
      if (!seenImageData || length !== 0 || dataEnd + 4 !== bytes.length) return false
      seenEnd = true
    } else if ((typeBytes[0] & 0x20) === 0) {
      return false
    }
    offset = dataEnd + 4
  }
  return seenHeader && seenImageData && seenEnd && await validInflatedPng(idatParts, rowPlan)
}

const validJpegAvatar = (bytes) => {
  if (bytes.length < 32 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return false
  const quantizationTables = new Set()
  const huffmanTables = new Set()
  const frameComponents = new Map()
  const scannedComponents = new Set()
  let frameMarker = 0
  let seenScan = false
  let restartInterval = 0
  let offset = 2
  while (offset < bytes.length) {
    if (bytes[offset] !== 0xff) return false
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1
    if (offset >= bytes.length) return false
    const marker = bytes[offset]
    offset += 1
    if (marker === 0xd9) {
      return offset === bytes.length && Boolean(frameMarker) && seenScan
        && [...frameComponents.keys()].every((componentId) => scannedComponents.has(componentId))
        && [...frameComponents.values()].every(({ quantizationTable }) => quantizationTables.has(quantizationTable))
    }
    if (marker === 0x00 || marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7) || offset + 2 > bytes.length) return false
    const segmentLength = readUint16BigEndian(bytes, offset)
    const dataStart = offset + 2
    const dataEnd = offset + segmentLength
    if (segmentLength < 2 || dataEnd > bytes.length) return false
    const isStartOfFrame = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)
    if (isStartOfFrame) {
      if (frameMarker || ![0xc0, 0xc1, 0xc2].includes(marker) || segmentLength < 11) return false
      const precision = bytes[dataStart]
      const height = readUint16BigEndian(bytes, dataStart + 1)
      const width = readUint16BigEndian(bytes, dataStart + 3)
      const componentCount = bytes[dataStart + 5]
      if (precision !== 8 || componentCount < 1 || componentCount > 4
        || segmentLength !== 8 + (3 * componentCount)
        || !validAvatarDimensions(width, height, componentCount)) return false
      let samplingUnits = 0
      for (let index = 0; index < componentCount; index += 1) {
        const componentOffset = dataStart + 6 + (index * 3)
        const componentId = bytes[componentOffset]
        const horizontalSampling = bytes[componentOffset + 1] >>> 4
        const verticalSampling = bytes[componentOffset + 1] & 0x0f
        const quantizationTable = bytes[componentOffset + 2]
        if (frameComponents.has(componentId) || horizontalSampling < 1 || horizontalSampling > 4
          || verticalSampling < 1 || verticalSampling > 4 || quantizationTable > 3) return false
        samplingUnits += horizontalSampling * verticalSampling
        frameComponents.set(componentId, { quantizationTable })
      }
      if (samplingUnits > 10) return false
      frameMarker = marker
    } else if (marker === 0xdb) {
      let cursor = dataStart
      while (cursor < dataEnd) {
        const descriptor = bytes[cursor]
        const precision = descriptor >>> 4
        const tableId = descriptor & 0x0f
        const tableBytes = precision === 0 ? 64 : (precision === 1 ? 128 : 0)
        if (!tableBytes || tableId > 3 || cursor + 1 + tableBytes > dataEnd) return false
        for (let index = cursor + 1; index < cursor + 1 + tableBytes; index += precision + 1) {
          const value = precision ? readUint16BigEndian(bytes, index) : bytes[index]
          if (value === 0) return false
        }
        quantizationTables.add(tableId)
        cursor += 1 + tableBytes
      }
      if (cursor !== dataEnd) return false
    } else if (marker === 0xc4) {
      let cursor = dataStart
      while (cursor < dataEnd) {
        if (cursor + 17 > dataEnd) return false
        const descriptor = bytes[cursor]
        const tableClass = descriptor >>> 4
        const tableId = descriptor & 0x0f
        if (tableClass > 1 || tableId > 3) return false
        let symbolCount = 0
        let remainingCodes = 1
        for (let index = 0; index < 16; index += 1) {
          const count = bytes[cursor + 1 + index]
          symbolCount += count
          remainingCodes = (remainingCodes * 2) - count
          if (remainingCodes < 0) return false
        }
        const symbolsStart = cursor + 17
        if (!symbolCount || symbolCount > 256 || symbolsStart + symbolCount > dataEnd) return false
        for (let index = symbolsStart; index < symbolsStart + symbolCount; index += 1) {
          const symbol = bytes[index]
          if ((tableClass === 0 && symbol > 11)
            || (tableClass === 1 && ((symbol & 0x0f) > 10 || ((symbol & 0x0f) === 0 && ![0, 15].includes(symbol >>> 4))))) return false
        }
        huffmanTables.add(`${tableClass}:${tableId}`)
        cursor = symbolsStart + symbolCount
      }
      if (cursor !== dataEnd) return false
    } else if (marker === 0xdd) {
      if (segmentLength !== 4) return false
      restartInterval = readUint16BigEndian(bytes, dataStart)
    } else if (marker === 0xda) {
      if (!frameMarker || segmentLength < 8) return false
      const componentCount = bytes[dataStart]
      if (componentCount < 1 || componentCount > frameComponents.size || segmentLength !== 6 + (2 * componentCount)) return false
      const scanComponents = new Set()
      const spectralStart = bytes[dataEnd - 3]
      const spectralEnd = bytes[dataEnd - 2]
      const approximation = bytes[dataEnd - 1]
      if ((frameMarker !== 0xc2 && (spectralStart !== 0 || spectralEnd !== 63 || approximation !== 0))
        || (frameMarker === 0xc2 && (spectralStart > spectralEnd || spectralEnd > 63))) return false
      for (let index = 0; index < componentCount; index += 1) {
        const componentId = bytes[dataStart + 1 + (index * 2)]
        const selectors = bytes[dataStart + 2 + (index * 2)]
        const dcTable = selectors >>> 4
        const acTable = selectors & 0x0f
        if (!frameComponents.has(componentId) || scanComponents.has(componentId) || dcTable > 3 || acTable > 3
          || (spectralStart === 0 && !huffmanTables.has(`0:${dcTable}`))
          || (spectralEnd > 0 && !huffmanTables.has(`1:${acTable}`))) return false
        scanComponents.add(componentId)
        scannedComponents.add(componentId)
      }
      offset = dataEnd
      let entropyBytes = 0
      let foundMarker = false
      while (offset < bytes.length) {
        if (bytes[offset] !== 0xff) {
          entropyBytes += 1
          offset += 1
          continue
        }
        const markerStart = offset
        while (offset < bytes.length && bytes[offset] === 0xff) offset += 1
        if (offset >= bytes.length) return false
        const scanMarker = bytes[offset]
        if (scanMarker === 0x00 && offset === markerStart + 1) {
          entropyBytes += 1
          offset += 1
          continue
        }
        if (scanMarker >= 0xd0 && scanMarker <= 0xd7 && restartInterval > 0) {
          offset += 1
          continue
        }
        offset = markerStart
        foundMarker = true
        break
      }
      if (!entropyBytes || !foundMarker) return false
      seenScan = true
      continue
    } else if (marker === 0xcc) {
      return false
    }
    offset = dataEnd
  }
  return false
}

const readGifSubBlocks = (bytes, start) => {
  const parts = []
  let total = 0
  let offset = start
  while (offset < bytes.length) {
    const length = bytes[offset]
    offset += 1
    if (length === 0) {
      const data = new Uint8Array(total)
      let cursor = 0
      for (const part of parts) {
        data.set(part, cursor)
        cursor += part.byteLength
      }
      return { data, offset }
    }
    if (offset + length > bytes.length || total + length > MAX_AVATAR_BYTES) return null
    parts.push(bytes.subarray(offset, offset + length))
    total += length
    offset += length
  }
  return null
}

const validGifLzw = (data, minimumCodeSize, expectedPixels, paletteSize) => {
  if (minimumCodeSize < 2 || minimumCodeSize > 8 || !data.length) return false
  const clearCode = 1 << minimumCodeSize
  const endCode = clearCode + 1
  const prefixes = new Int16Array(4096)
  const suffixes = new Uint8Array(4096)
  const stack = new Uint8Array(4096)
  for (let index = 0; index < clearCode; index += 1) suffixes[index] = index
  let available = endCode + 1
  let codeSize = minimumCodeSize + 1
  let bitOffset = 0
  let previousCode = -1
  let firstByte = 0
  let outputPixels = 0
  let sawClear = false
  const readCode = () => {
    if (bitOffset + codeSize > data.length * 8) return -1
    let code = 0
    for (let bit = 0; bit < codeSize; bit += 1) {
      code |= ((data[(bitOffset + bit) >>> 3] >>> ((bitOffset + bit) & 7)) & 1) << bit
    }
    bitOffset += codeSize
    return code
  }
  const emit = (value) => {
    if (value >= paletteSize || outputPixels >= expectedPixels) return false
    outputPixels += 1
    return true
  }
  while (true) {
    let code = readCode()
    if (code < 0) return false
    if (code === clearCode) {
      available = endCode + 1
      codeSize = minimumCodeSize + 1
      previousCode = -1
      sawClear = true
      continue
    }
    if (!sawClear) return false
    if (code === endCode) return outputPixels === expectedPixels
    if (previousCode < 0) {
      if (code >= clearCode || !emit(code)) return false
      firstByte = code
      previousCode = code
      continue
    }
    const incomingCode = code
    let stackSize = 0
    if (code === available) {
      stack[stackSize] = firstByte
      stackSize += 1
      code = previousCode
    } else if (code > available) {
      return false
    }
    while (code >= clearCode) {
      if (code >= available || stackSize >= stack.length) return false
      stack[stackSize] = suffixes[code]
      stackSize += 1
      code = prefixes[code]
    }
    firstByte = suffixes[code]
    if (stackSize >= stack.length) return false
    stack[stackSize] = firstByte
    stackSize += 1
    while (stackSize > 0) {
      stackSize -= 1
      if (!emit(stack[stackSize])) return false
    }
    if (available < 4096) {
      prefixes[available] = previousCode
      suffixes[available] = firstByte
      available += 1
      if (available === (1 << codeSize) && codeSize < 12) codeSize += 1
    }
    previousCode = incomingCode
  }
}

const validGifAvatar = (bytes) => {
  if (bytes.length < 20 || !['GIF87a', 'GIF89a'].includes(asciiAt(bytes, 0, 6))) return false
  const logicalWidth = readUint16LittleEndian(bytes, 6)
  const logicalHeight = readUint16LittleEndian(bytes, 8)
  if (!validAvatarDimensions(logicalWidth, logicalHeight)) return false
  const packed = bytes[10]
  const globalPaletteSize = (packed & 0x80) ? 1 << ((packed & 0x07) + 1) : 0
  let offset = 13 + (globalPaletteSize * 3)
  if (offset > bytes.length || (globalPaletteSize && bytes[11] >= globalPaletteSize)) return false
  let frames = 0
  while (offset < bytes.length) {
    const introducer = bytes[offset]
    offset += 1
    if (introducer === 0x3b) return offset === bytes.length && frames > 0
    if (introducer === 0x21) {
      if (offset >= bytes.length) return false
      const label = bytes[offset]
      offset += 1
      if (label === 0xf9) {
        if (offset + 6 > bytes.length || bytes[offset] !== 4 || bytes[offset + 5] !== 0) return false
        offset += 6
      } else {
        const extension = readGifSubBlocks(bytes, offset)
        if (!extension) return false
        offset = extension.offset
      }
      continue
    }
    if (introducer !== 0x2c || offset + 9 > bytes.length) return false
    const left = readUint16LittleEndian(bytes, offset)
    const top = readUint16LittleEndian(bytes, offset + 2)
    const width = readUint16LittleEndian(bytes, offset + 4)
    const height = readUint16LittleEndian(bytes, offset + 6)
    const imagePacked = bytes[offset + 8]
    if (frames > 0 || width * height > MAX_GIF_AVATAR_PIXELS
      || (imagePacked & 0x18) !== 0 || !validAvatarDimensions(width, height)
      || left + width > logicalWidth || top + height > logicalHeight) return false
    offset += 9
    const localPaletteSize = (imagePacked & 0x80) ? 1 << ((imagePacked & 0x07) + 1) : 0
    if (localPaletteSize) offset += localPaletteSize * 3
    const paletteSize = localPaletteSize || globalPaletteSize
    if (!paletteSize || offset >= bytes.length) return false
    const minimumCodeSize = bytes[offset]
    offset += 1
    const imageData = readGifSubBlocks(bytes, offset)
    if (!imageData || !validGifLzw(imageData.data, minimumCodeSize, width * height, paletteSize)) return false
    offset = imageData.offset
    frames += 1
  }
  return false
}

const webpDimensions = (type, payload) => {
  if (type === 'VP8L') {
    if (payload.length < 5 || payload[0] !== 0x2f) return null
    const bits = readUint32LittleEndian(payload, 1)
    if ((bits >>> 29) !== 0) return null
    return {
      width: (bits & 0x3fff) + 1,
      height: ((bits >>> 14) & 0x3fff) + 1,
      hasAlpha: Boolean(bits & 0x10000000),
    }
  }
  if (type === 'VP8 ') {
    if (payload.length < 10) return null
    const frameTag = payload[0] + (payload[1] * 0x100) + (payload[2] * 0x10000)
    const firstPartitionLength = frameTag >>> 5
    if ((frameTag & 1) !== 0 || ((frameTag >>> 1) & 0x07) > 3 || ((frameTag >>> 4) & 1) !== 1
      || firstPartitionLength < 1 || firstPartitionLength > payload.length - 10
      || payload[3] !== 0x9d || payload[4] !== 0x01 || payload[5] !== 0x2a) return null
    return {
      width: readUint16LittleEndian(payload, 6) & 0x3fff,
      height: readUint16LittleEndian(payload, 8) & 0x3fff,
      hasAlpha: false,
    }
  }
  return null
}

const validWebpAvatar = (bytes) => {
  if (bytes.length < 30 || asciiAt(bytes, 0, 4) !== 'RIFF' || asciiAt(bytes, 8, 4) !== 'WEBP'
    || readUint32LittleEndian(bytes, 4) !== bytes.length - 8) return false
  let offset = 12
  let extendedDimensions = null
  let extendedFlags = 0
  let imageDimensions = null
  let imageChunks = 0
  let imageType = ''
  let alphaChunk = false
  const metadataChunks = new Set()
  while (offset < bytes.length) {
    if (offset + 8 > bytes.length) return false
    const type = asciiAt(bytes, offset, 4)
    const length = readUint32LittleEndian(bytes, offset + 4)
    const dataStart = offset + 8
    const dataEnd = dataStart + length
    const paddedEnd = dataEnd + (length & 1)
    if (!Number.isSafeInteger(dataEnd) || paddedEnd > bytes.length || (length & 1 && bytes[dataEnd] !== 0)) return false
    const payload = bytes.subarray(dataStart, dataEnd)
    if (type === 'VP8X') {
      if (offset !== 12 || extendedDimensions || length !== 10 || (payload[0] & 0xc3) !== 0 || (payload[0] & 0x02) !== 0
        || payload[1] !== 0 || payload[2] !== 0 || payload[3] !== 0) return false
      extendedFlags = payload[0]
      extendedDimensions = {
        width: readUint24LittleEndian(payload, 4) + 1,
        height: readUint24LittleEndian(payload, 7) + 1,
      }
      if (!validAvatarDimensions(extendedDimensions.width, extendedDimensions.height)) return false
    } else if (type === 'VP8 ' || type === 'VP8L') {
      if (imageChunks) return false
      imageDimensions = webpDimensions(type, payload)
      if (!imageDimensions || !validAvatarDimensions(imageDimensions.width, imageDimensions.height)) return false
      imageType = type
      imageChunks += 1
    } else if (type === 'ALPH') {
      if (!extendedDimensions || imageChunks || alphaChunk || length < 2 || (payload[0] & 0xc0) !== 0 || (payload[0] & 0x03) > 1) return false
      alphaChunk = true
    } else if (['ANIM', 'ANMF'].includes(type)) {
      return false
    } else if (['ICCP', 'EXIF', 'XMP '].includes(type)) {
      if (metadataChunks.has(type)) return false
      metadataChunks.add(type)
    } else if (type !== 'JUNK') {
      return false
    }
    offset = paddedEnd
  }
  if (offset !== bytes.length || imageChunks !== 1) return false
  if (extendedDimensions && (extendedDimensions.width !== imageDimensions.width || extendedDimensions.height !== imageDimensions.height)) return false
  if (extendedDimensions) {
    if (imageType === 'VP8 ' && Boolean(extendedFlags & 0x10) !== alphaChunk) return false
    if (imageType === 'VP8L' && (alphaChunk || Boolean(extendedFlags & 0x10) !== imageDimensions.hasAlpha)) return false
    if (metadataChunks.has('ICCP') !== Boolean(extendedFlags & 0x20)
      || metadataChunks.has('EXIF') !== Boolean(extendedFlags & 0x08)
      || metadataChunks.has('XMP ') !== Boolean(extendedFlags & 0x04)) return false
  } else if (metadataChunks.size) {
    return false
  }
  return true
}

const validAvatarImageStructure = async (mimeType, bytes) => {
  if (!(bytes instanceof Uint8Array)) return false
  if (mimeType === 'image/png') return validPngAvatar(bytes)
  if (mimeType === 'image/jpeg') return validJpegAvatar(bytes)
  if (mimeType === 'image/webp') return validWebpAvatar(bytes)
  if (mimeType === 'image/gif') return validGifAvatar(bytes)
  return false
}
const BUSINESS_SUPPORT_STORE_ID = 'BUSINESS_SUPPORT'
const OFFICE_STORE_ID = 'OFFICE'
const RESERVED_PHYSICAL_STORE_IDS = new Set([
  OFFICE_STORE_ID,
  BUSINESS_SUPPORT_STORE_ID,
  'ADMIN',
  'SYSTEM',
])
const OPERATIONS_ROLES = new Set(['admin', 'business_support', 'store_manager'])
const PAYROLL_OPERATOR_ROLES = new Set(['admin', 'business_support'])
const BUSINESS_SUPPORT_SELF_SERVICE_COMMANDS = new Set([
  'attendance.check_in',
  'attendance.check_out',
  'account_settings.update',
  'notification.mark_read',
  'notification.mark_all_read',
  'notification.clear',
  'notification.clear_all',
  'task.progress.save',
  'work_reward.set',
  'work_reward.set_batch',
  'user.change_password',
])
const BUSINESS_SUPPORT_DOMAIN_COMMANDS = new Set([
  'store.update',
  'employee.create',
  'employee.update',
  'order_information.create',
  'order_information.update',
  'order_information.disable',
  'order_information.restore',
  'order_information.reorder',
  'shift_definition.create',
  'shift_definition.update',
  'shift_definition.delete',
  'schedule.assign',
  'schedule.replace_day',
  'tasks.assign',
  'tasks.replace_scope',
  'fixed_expense.create',
  'fixed_expense.update',
  'fixed_expense.delete',
  'expense.create',
  'expense.update',
  'expense.delete',
  'import.create',
  'import.update',
  'import.delete',
  'import_voucher.create',
  'import_voucher.update',
  'import_voucher.delete',
  'salary_adjustment.create',
  'store_salary_config.set',
  'work_catalog.create',
  'work_catalog.update',
  'work_catalog.delete',
  'work_catalog.restore',
  'salary_advance.create',
  'salary_advance.update',
  'salary_advance.confirm',
  'payroll.close',
  'payroll.pay',
  'attendance.update',
  'order.update',
  'order.delete',
  'policy.set',
  'policies.set',
  'support_transfer.create',
  'support_transfer.update',
  'support_work.update',
  'support_schedule.assign',
  'support_schedule.delete',
  'compensation_entry.create',
  'compensation_entry.approve',
  'compensation_entry.void',
  'violation.create',
  'violation.create_batch',
  'violation.void',
  'revenue_bonus.calculate_day',
  'revenue_bonus.approve_milestone',
  'revenue_bonus.reject_milestone',
])
const RETIRED_COMMANDS = new Set(['employee.working_time.set'])
const ADDRESS_SUGGESTION_TYPES = new Set(['province', 'ward', 'street'])
const ADDRESS_SUGGESTION_RATE_LIMIT = 30
const ADDRESS_SUGGESTION_RATE_WINDOW_MS = 60_000
const MAX_LEGACY_ATTENDANCE_AUDITS = 10_000
const addressSuggestionRateWindows = new Map()

const DEFAULT_POLICIES = Object.freeze({
  late_tolerance_minutes: 10,
  early_check_in_limit_minutes: 120,
  attendance_maintain_max_late_count: 2,
  attendance_improve_min_late_count: 3,
  attendance_improve_min_late_minutes: 30,
})

class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.details = details
  }
}

const textEncoder = new TextEncoder()

const toBase64Url = (bytes) => {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '')
}

const fromBase64Url = (value) => {
  const normalized = String(value).replaceAll('-', '+').replaceAll('_', '/')
  const padding = '='.repeat((4 - (normalized.length % 4)) % 4)
  const binary = atob(`${normalized}${padding}`)
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

const decodeIdentityImage = (value, side) => {
  const source = String(value || '')
  const match = source.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/u)
  if (!match) {
    throw new ApiError(400, 'IDENTITY_IMAGE_INVALID', 'Ảnh CCCD phải là ảnh JPEG, PNG hoặc WebP mã hóa base64 hợp lệ.', { side })
  }
  if (match[2].length > Math.ceil(MAX_IDENTITY_IMAGE_BYTES / 3) * 4 + 4) {
    throw new ApiError(413, 'IDENTITY_IMAGE_TOO_LARGE', 'Mỗi ảnh CCCD sau khi tối ưu không được vượt quá 300 KB.', { side })
  }
  let bytes
  try {
    const binary = atob(match[2])
    bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
  } catch {
    throw new ApiError(400, 'IDENTITY_IMAGE_INVALID', 'Dữ liệu ảnh CCCD không hợp lệ.', { side })
  }
  if (!bytes.length || bytes.byteLength > MAX_IDENTITY_IMAGE_BYTES) {
    throw new ApiError(bytes.length ? 413 : 400, bytes.length ? 'IDENTITY_IMAGE_TOO_LARGE' : 'IDENTITY_IMAGE_INVALID', bytes.length
      ? 'Mỗi ảnh CCCD sau khi tối ưu không được vượt quá 300 KB.'
      : 'Ảnh CCCD không được để trống.', { side })
  }
  const type = match[1]
  const validSignature = type === 'image/jpeg'
    ? bytes[0] === 0xff && bytes[1] === 0xd8 && bytes.at(-2) === 0xff && bytes.at(-1) === 0xd9
    : (type === 'image/png'
        ? [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((byte, index) => bytes[index] === byte)
        : bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
          && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50)
  if (!validSignature) {
    throw new ApiError(400, 'IDENTITY_IMAGE_INVALID', 'Nội dung ảnh CCCD không khớp định dạng đã khai báo.', { side })
  }
  const extension = type === 'image/jpeg' ? 'jpg' : type.slice('image/'.length)
  return { bytes, contentType: type, extension }
}

const decodeAccountAvatar = async (value) => {
  const source = String(value || '')
  const match = source.match(/^data:(image\/(?:jpeg|png|webp|gif));base64,([A-Za-z0-9+/]+={0,2})$/u)
  if (!match) {
    throw new ApiError(400, 'AVATAR_INVALID', 'Ảnh đại diện phải là dữ liệu ảnh JPG, PNG, WebP hoặc GIF hợp lệ.')
  }
  if (match[2].length > Math.ceil(MAX_AVATAR_BYTES / 3) * 4 + 4) {
    throw new ApiError(413, 'AVATAR_TOO_LARGE', 'Ảnh đại diện sau khi tối ưu không được vượt quá 300 KB.')
  }
  let binary
  let bytes
  try {
    binary = atob(match[2])
    bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
  } catch {
    throw new ApiError(400, 'AVATAR_INVALID', 'Ảnh đại diện phải là dữ liệu ảnh JPG, PNG, WebP hoặc GIF hợp lệ.')
  }
  if (!bytes.length || bytes.byteLength > MAX_AVATAR_BYTES) {
    throw new ApiError(bytes.length ? 413 : 400, bytes.length ? 'AVATAR_TOO_LARGE' : 'AVATAR_INVALID', bytes.length
      ? 'Ảnh đại diện sau khi tối ưu không được vượt quá 300 KB.'
      : 'Ảnh đại diện không được để trống.')
  }
  if (!await validAvatarImageStructure(match[1], bytes)) {
    throw new ApiError(400, 'AVATAR_INVALID', 'Ảnh đại diện phải là dữ liệu ảnh JPG, PNG, WebP hoặc GIF hợp lệ.')
  }
  const contentType = match[1]
  const extension = contentType === 'image/jpeg' ? 'jpg' : contentType.slice('image/'.length)
  return { bytes, contentType, extension }
}

const randomBytes = (length) => {
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  return bytes
}

const constantTimeEqual = (left, right) => {
  const leftBytes = left instanceof Uint8Array ? left : textEncoder.encode(String(left))
  const rightBytes = right instanceof Uint8Array ? right : textEncoder.encode(String(right))
  const length = Math.max(leftBytes.length, rightBytes.length)
  let difference = leftBytes.length ^ rightBytes.length
  for (let index = 0; index < length; index += 1) {
    difference |= (leftBytes[index] || 0) ^ (rightBytes[index] || 0)
  }
  return difference === 0
}

const derivePasswordBytes = async (password, salt, iterations) => {
  const key = await crypto.subtle.importKey(
    'raw',
    textEncoder.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits'],
  )
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    key,
    256,
  )
  return new Uint8Array(bits)
}

export const hashPassword = async (password, options = {}) => {
  const source = String(password || '')
  if (source.length < 8 || source.length > 256) {
    throw new ApiError(400, 'INVALID_PASSWORD', 'Mật khẩu phải có từ 8 đến 256 ký tự.')
  }
  const iterations = Number(options.iterations || DEFAULT_PBKDF2_ITERATIONS)
  if (
    !Number.isInteger(iterations)
    || iterations < MIN_PBKDF2_ITERATIONS
    || iterations > MAX_PBKDF2_GENERATION_ITERATIONS
  ) {
    throw new ApiError(500, 'INVALID_PASSWORD_POLICY', 'Cấu hình băm mật khẩu không hợp lệ.')
  }
  const salt = options.salt ? fromBase64Url(options.salt) : randomBytes(16)
  const digest = await derivePasswordBytes(source, salt, iterations)
  return {
    hash: toBase64Url(digest),
    salt: toBase64Url(salt),
    iterations,
    algorithm: PBKDF2_ALGORITHM,
  }
}

export const verifyPassword = async (password, record) => {
  try {
    if (record?.algorithm !== PBKDF2_ALGORITHM) return false
    const iterations = Number(record?.iterations)
    if (
      !Number.isInteger(iterations)
      || iterations < MIN_PBKDF2_ITERATIONS
      || iterations > MAX_PBKDF2_VERIFICATION_ITERATIONS
    ) return false
    const salt = fromBase64Url(record.salt)
    const expected = fromBase64Url(record.hash)
    const actual = await derivePasswordBytes(String(password || ''), salt, iterations)
    return constantTimeEqual(actual, expected)
  } catch {
    return false
  }
}

const sha256 = async (value) => {
  const digest = await crypto.subtle.digest('SHA-256', textEncoder.encode(String(value)))
  return toBase64Url(new Uint8Array(digest))
}

const normalizeUsername = (value) => String(value || '').trim().toLocaleLowerCase('vi-VN')
// Operational identifiers are canonical references, not credentials. Historical
// imports may preserve different letter casing, so compare them case-insensitively.
// Login names and passwords deliberately do not use this helper.
const normalizeIdentifierKey = (value) => String(value ?? '').trim().toLocaleLowerCase('en-US')
const sameIdentifier = (left, right) => (
  Boolean(normalizeIdentifierKey(left))
  && normalizeIdentifierKey(left) === normalizeIdentifierKey(right)
)

const isReservedPhysicalStoreIdentifier = (value) => [...RESERVED_PHYSICAL_STORE_IDS]
  .some((identifier) => sameIdentifier(identifier, value))

const assertNoReservedPhysicalStoreIdentifiers = (state) => {
  const reservedStore = (Array.isArray(state?.stores) ? state.stores : [])
    .find((store) => isReservedPhysicalStoreIdentifier(store?.id))
  if (!reservedStore) return
  throw new ApiError(
    400,
    'STORE_ID_RESERVED',
    'Mã đơn vị nội bộ không được dùng làm mã cửa hàng vật lý.',
    { storeId: String(reservedStore.id || '').trim() },
  )
}

const uniqueIdentifierRecordMatch = ({
  records,
  identifier,
  identifierOf = (record) => record?.id,
  predicate = () => true,
  collisionCode,
  collisionMessage,
}) => {
  const requestedIdentifier = String(identifier ?? '').trim()
  if (!requestedIdentifier) return null
  const matches = (Array.isArray(records) ? records : [])
    .map((record, index) => ({ record, index, identifier: String(identifierOf(record) ?? '').trim() }))
    .filter((match) => predicate(match.record) && sameIdentifier(match.identifier, requestedIdentifier))
  if (matches.length <= 1) return matches[0] || null
  const exactMatches = matches.filter((match) => match.identifier === requestedIdentifier)
  if (exactMatches.length === 1) return exactMatches[0]
  throw new ApiError(409, collisionCode, collisionMessage, {
    identifier: normalizeIdentifierKey(requestedIdentifier),
    conflictingIdentifiers: matches.map((match) => match.identifier),
  })
}

const strictUniqueIdentifierRecordMatch = ({
  records,
  identifier,
  identifierOf = (record) => record?.id,
  predicate = () => true,
  collisionCode,
  collisionMessage,
}) => {
  const requestedIdentifier = String(identifier ?? '').trim()
  if (!requestedIdentifier) return null
  const matches = (Array.isArray(records) ? records : [])
    .map((record, index) => ({ record, index, identifier: String(identifierOf(record) ?? '').trim() }))
    .filter((match) => predicate(match.record) && sameIdentifier(match.identifier, requestedIdentifier))
  if (matches.length <= 1) return matches[0] || null
  throw new ApiError(409, collisionCode, collisionMessage, {
    identifier: normalizeIdentifierKey(requestedIdentifier),
    conflictingIdentifiers: matches.map((match) => match.identifier),
  })
}

// Mutations must distinguish an unrelated reference from a case-folded
// reference that could point at more than one persisted parent. Read-only
// projections may simply omit an ambiguous link, but money, payroll and
// attendance mutations must fail closed before changing state.
const mutationIdentifierReferenceMatchesRecord = ({
  records,
  record,
  reference,
  identifierOf = (candidate) => candidate?.id,
  collisionCode = 'OPERATIONAL_IDENTIFIER_REFERENCE_COLLISION',
  collisionMessage = 'Tham chiếu mã nghiệp vụ đang mơ hồ; cần xử lý dữ liệu trùng trước khi tiếp tục.',
}) => {
  const requestedIdentifier = String(reference ?? '').trim()
  if (!requestedIdentifier || !record) return false
  const match = uniqueIdentifierRecordMatch({
    records,
    identifier: requestedIdentifier,
    identifierOf,
    collisionCode,
    collisionMessage,
  })
  return match?.record === record
}

const collisionAwareIdentifierReferenceKey = ({
  records,
  reference,
  identifierOf = (candidate) => candidate?.id,
}) => {
  const requestedIdentifier = String(reference ?? '').trim()
  if (!requestedIdentifier) return ''
  const foldedMatches = (Array.isArray(records) ? records : [])
    .filter((candidate) => sameIdentifier(identifierOf(candidate), requestedIdentifier))
  return foldedMatches.length > 1
    ? `exact:${requestedIdentifier}`
    : `folded:${normalizeIdentifierKey(requestedIdentifier)}`
}

const withCanonicalIdentifierEntry = (record, identifier, value) => {
  const canonicalIdentifier = String(identifier ?? '').trim()
  const entries = Object.entries(isPlainRecord(record) ? record : {})
    .filter(([candidateId]) => !sameIdentifier(candidateId, canonicalIdentifier))
  if (canonicalIdentifier) entries.push([canonicalIdentifier, value])
  return Object.fromEntries(entries)
}
const isPlainRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)

const employeeIdentifierValues = (record) => [
  record?.id,
  record?.code,
  record?.employeeId,
  record?.employeeCode,
].map((value) => String(value || '').trim()).filter(Boolean)

const uniqueEmployeeIdentifierRecordMatch = ({
  records,
  identifier,
  predicate = () => true,
  collisionCode = 'EMPLOYEE_IDENTIFIER_COLLISION',
  collisionMessage = 'Mã nhân viên đang trùng với nhiều hồ sơ; không thể xác định nhân viên an toàn.',
}) => {
  const requestedIdentifier = String(identifier ?? '').trim()
  if (!requestedIdentifier) return null
  const matches = (Array.isArray(records) ? records : [])
    .map((record, index) => ({ record, index, identifiers: employeeIdentifierValues(record) }))
    .filter((match) => predicate(match.record)
      && match.identifiers.some((candidate) => sameIdentifier(candidate, requestedIdentifier)))
  if (matches.length <= 1) return matches[0] || null
  const exactMatches = matches.filter((match) => match.identifiers.includes(requestedIdentifier))
  if (exactMatches.length === 1) return exactMatches[0]
  throw new ApiError(409, collisionCode, collisionMessage, {
    identifier: normalizeIdentifierKey(requestedIdentifier),
    conflictingIdentifiers: matches.map((match) => match.identifiers[0] || ''),
  })
}

const assertNoCaseCollidingHistoricalIdentifiers = ({
  activeRecords,
  deletedRecords,
  identifierValues,
  code,
  message,
  allowExactDuplicateActive = false,
}) => {
  const entriesByIdentifier = new Map()
  const collections = [
    ['active', Array.isArray(activeRecords) ? activeRecords : []],
    ['deleted', Array.isArray(deletedRecords) ? deletedRecords : []],
  ]
  for (const [collection, records] of collections) {
    records.forEach((record, index) => {
      const owner = `${collection}:${index}`
      const values = identifierValues(record)
      const displayIdentifier = values[0] || ''
      for (const rawValue of values) {
        const rawIdentifier = String(rawValue || '').trim()
        const identifier = normalizeIdentifierKey(rawIdentifier)
        if (!identifier) continue
        const previousEntries = entriesByIdentifier.get(identifier) || []
        const conflicts = previousEntries.some((previous) => {
          if (previous.owner === owner) return false
          // The same canonical spelling may legitimately appear in immutable
          // deletion history. Live duplicates remain ambiguous unless the
          // caller has established that an exact spelling is one legacy scope;
          // differently-cased aliases always fail closed.
          if (previous.rawIdentifier === rawIdentifier
            && (allowExactDuplicateActive
              || previous.collection === 'deleted'
              || collection === 'deleted')) return false
          return true
        })
        if (conflicts) {
          const previous = previousEntries.find((entry) => entry.owner !== owner)
          throw new ApiError(409, code, message, {
            identifier,
            firstIdentifier: previous?.displayIdentifier || previous?.rawIdentifier || identifier,
            conflictingIdentifier: displayIdentifier || rawIdentifier || identifier,
          })
        }
        previousEntries.push({
          owner,
          collection,
          rawIdentifier,
          displayIdentifier: displayIdentifier || rawIdentifier,
        })
        entriesByIdentifier.set(identifier, previousEntries)
      }
    })
  }
}

const assertNoCaseCollidingEmployeeIdentifiers = (state) => {
  assertNoCaseCollidingHistoricalIdentifiers({
    activeRecords: state?.employees,
    deletedRecords: state?.deletedEmployees,
    identifierValues: employeeIdentifierValues,
    code: 'EMPLOYEE_IDENTIFIER_COLLISION',
    message: 'Dữ liệu có nhiều hồ sơ nhân viên dùng cùng một mã nhưng khác chữ hoa/thường.',
  })
}

const assertNoCaseCollidingStoreIdentifiers = (state) => {
  assertNoCaseCollidingHistoricalIdentifiers({
    activeRecords: state?.stores,
    deletedRecords: state?.deletedStores,
    identifierValues: (record) => [String(record?.id || '').trim()].filter(Boolean),
    code: 'STORE_IDENTIFIER_COLLISION',
    message: 'Dữ liệu có nhiều cửa hàng dùng cùng một mã nhưng khác chữ hoa/thường.',
    // Migration 0004 intentionally preserves repeated legacy rows with the
    // exact same store id. They represent one authorization scope; only a
    // differently-cased spelling can create a second folded scope and leak.
    allowExactDuplicateActive: true,
  })
}

const assertNoCaseCollidingSupportTransferIdentifiers = (state) => {
  assertNoCaseCollidingHistoricalIdentifiers({
    activeRecords: state?.supportTransfers,
    deletedRecords: [],
    identifierValues: (record) => [String(record?.id || '').trim()].filter(Boolean),
    code: 'SUPPORT_TRANSFER_IDENTIFIER_COLLISION',
    message: 'Dữ liệu có nhiều phiếu điều chuyển dùng cùng một mã nhưng khác chữ hoa/thường.',
  })
}

const assertNoCaseCollidingAttendanceIdentifiers = (state) => {
  assertNoCaseCollidingHistoricalIdentifiers({
    activeRecords: state?.attendance,
    deletedRecords: [],
    identifierValues: (record) => [String(record?.id || '').trim()].filter(Boolean),
    code: 'ATTENDANCE_IDENTIFIER_COLLISION',
    message: 'Dữ liệu có nhiều bản chấm công dùng cùng một mã nhưng khác chữ hoa/thường.',
  })
}

const assertNoCaseCollidingOperationalIdentifiers = (state) => {
  assertNoCaseCollidingEmployeeIdentifiers(state)
  assertNoCaseCollidingStoreIdentifiers(state)
  assertNoCaseCollidingSupportTransferIdentifiers(state)
}

const assertNoCaseCollidingActiveWorkCatalogIdentifiers = (state) => {
  const activeRecords = (Array.isArray(state?.workCatalogItems) ? state.workCatalogItems : [])
    .filter((record) => !record?.deletedAt && record?.active !== false)
  const ownerByIdentifier = new Map()
  activeRecords.forEach((record, index) => {
    const rawIdentifier = String(record?.id || '').trim()
    const identifier = normalizeIdentifierKey(rawIdentifier)
    if (!identifier) return
    const previous = ownerByIdentifier.get(identifier)
    if (previous) {
      throw new ApiError(
        409,
        'WORK_CATALOG_IDENTIFIER_COLLISION',
        'Danh mục có nhiều công việc dùng cùng một mã nhưng khác chữ hoa/thường.',
        {
          identifier,
          firstIdentifier: previous.rawIdentifier,
          conflictingIdentifier: rawIdentifier || identifier,
        },
      )
    }
    ownerByIdentifier.set(identifier, { owner: index, rawIdentifier })
  })
}

const activeWorkCatalogIdentifierMatches = (state, itemId) => {
  const identifier = normalizeIdentifierKey(itemId)
  if (!identifier) return []
  return (Array.isArray(state?.workCatalogItems) ? state.workCatalogItems : [])
    .map((record, index) => ({ record, index }))
    .filter(({ record }) => (
      !record?.deletedAt
      && record?.active !== false
      && normalizeIdentifierKey(record?.id) === identifier
    ))
}

const isEmbeddedImageDataUrl = (value) => typeof value === 'string'
  && /^data:image(?:\/|-)[a-z0-9.+-]+;base64,/iu.test(value)

const containsEmbeddedImageData = (value, depth = 0) => {
  if (depth > MAX_JSON_DEPTH) return false
  if (isEmbeddedImageDataUrl(value)) return true
  if (Array.isArray(value)) return value.some((item) => containsEmbeddedImageData(item, depth + 1))
  if (!isPlainRecord(value)) return false
  return Object.values(value).some((item) => containsEmbeddedImageData(item, depth + 1))
}

const replaceEmbeddedImageData = (value, replacements = new Map(), depth = 0) => {
  if (depth > MAX_JSON_DEPTH) return null
  if (isEmbeddedImageDataUrl(value)) return replacements.get(value) || null
  if (Array.isArray(value)) return value.map((item) => replaceEmbeddedImageData(item, replacements, depth + 1))
  if (!isPlainRecord(value)) return value
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key,
    replaceEmbeddedImageData(item, replacements, depth + 1),
  ]))
}

const jsonTextContainsEmbeddedImageData = (value) => /["']data:image(?:\/|-)[a-z0-9.+-]+;base64,/iu.test(String(value || ''))
const parseStoredJson = (value, fallback = null) => {
  try {
    return JSON.parse(value)
  } catch {
    return fallback
  }
}

const localDateTimeParts = (isoTimestamp) => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(isoTimestamp)).map(({ type, value }) => [type, value]))
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
    seconds: `${parts.hour}:${parts.minute}:${parts.second}`,
    minuteOfDay: (Number(parts.hour) * 60) + Number(parts.minute),
  }
}

const VIETNAM_UTC_OFFSET = '+07:00'
const TRANSFER_LOCAL_DATE_TIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/u
const TRANSFER_EXPLICIT_DATE_TIME_PATTERN = /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:?\d{2})$/iu

const validCalendarDateParts = (year, month, day) => {
  const parsed = new Date(Date.UTC(year, month - 1, day))
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() + 1 === month
    && parsed.getUTCDate() === day
}

const shiftCalendarDate = (date, days) => {
  const match = String(date || '').match(/^(\d{4})-(\d{2})-(\d{2})$/u)
  if (!match || !validCalendarDateParts(Number(match[1]), Number(match[2]), Number(match[3]))) return ''
  const shifted = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days))
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}-${String(shifted.getUTCDate()).padStart(2, '0')}`
}

const transferDateTimeEpoch = (value) => {
  const source = String(value || '').trim()
  const localMatch = source.match(TRANSFER_LOCAL_DATE_TIME_PATTERN)
  if (localMatch) {
    const year = Number(localMatch[1])
    const month = Number(localMatch[2])
    const day = Number(localMatch[3])
    const hour = Number(localMatch[4])
    const minute = Number(localMatch[5])
    if (!validCalendarDateParts(year, month, day) || hour > 23 || minute > 59) return null
    const timestamp = Date.parse(`${source}:00${VIETNAM_UTC_OFFSET}`)
    return Number.isFinite(timestamp) ? timestamp : null
  }
  if (!TRANSFER_EXPLICIT_DATE_TIME_PATTERN.test(source)) return null
  const timestamp = Date.parse(source)
  return Number.isFinite(timestamp) ? timestamp : null
}

const requiredTransferDateTime = (value, field) => {
  const epochMs = transferDateTimeEpoch(value)
  if (epochMs == null) {
    throw new ApiError(400, 'TRANSFER_DATE_TIME_INVALID', `${field} phải có định dạng ngày giờ hợp lệ YYYY-MM-DDTHH:mm.`)
  }
  return new Date(epochMs).toISOString()
}

export const supportTransferTimeBounds = (record = {}) => {
  const legacyStart = record.fromDate ? `${record.fromDate}T00:00` : ''
  const legacyEndDate = shiftCalendarDate(record.toDate || record.fromDate, 1)
  const legacyEnd = legacyEndDate ? `${legacyEndDate}T00:00` : ''
  const startMs = transferDateTimeEpoch(record.startAt || legacyStart)
  const endMs = transferDateTimeEpoch(record.endAt || legacyEnd)
  if (startMs == null || endMs == null || endMs <= startMs) return null
  return { startMs, endMs, startAt: new Date(startMs).toISOString(), endAt: new Date(endMs).toISOString() }
}

const supportTransferCalendarRange = (bounds) => {
  if (!bounds) return { fromDate: '', toDate: '' }
  return {
    fromDate: localDateTimeParts(new Date(bounds.startMs).toISOString()).date,
    // endAt is exclusive, so the last included local calendar day is one millisecond earlier.
    toDate: localDateTimeParts(new Date(bounds.endMs - 1).toISOString()).date,
  }
}

const supportTransferUsable = (record = {}) => (
  !record.deletedAt
  && !['Đã xóa', 'Đã hủy', 'Hoàn tất'].includes(String(record.status || ''))
)

export const isSupportTransferActiveAt = (record, at) => {
  if (!supportTransferUsable(record)) return false
  const bounds = supportTransferTimeBounds(record)
  const atMs = transferDateTimeEpoch(at) ?? Date.parse(String(at || ''))
  return Boolean(bounds && Number.isFinite(atMs) && bounds.startMs <= atMs && atMs < bounds.endMs)
}

const supportTransferOverlapsDate = (record, date) => {
  if (!supportTransferUsable(record) || !/^\d{4}-\d{2}-\d{2}$/u.test(String(date || ''))) return false
  const bounds = supportTransferTimeBounds(record)
  const dayStart = transferDateTimeEpoch(`${date}T00:00`)
  const nextDate = shiftCalendarDate(date, 1)
  const dayEnd = transferDateTimeEpoch(`${nextDate}T00:00`)
  return Boolean(bounds
    && Number.isFinite(dayStart)
    && Number.isFinite(dayEnd)
    && bounds.startMs < dayEnd
    && bounds.endMs > dayStart)
}

const supportTransferMatchesTime = (record, at) => /^\d{4}-\d{2}-\d{2}$/u.test(String(at || ''))
  ? supportTransferOverlapsDate(record, at)
  : isSupportTransferActiveAt(record, at)

const supportTransferMatchesEmployeeStore = (record, employeeId, storeId) => (
  isPlainRecord(record)
  && sameIdentifier(record.employeeId, employeeId)
  && sameIdentifier(record.toStoreId, storeId)
)

const supportTransferOverlapsCalendarRange = (record, fromDate, toDate) => {
  const bounds = supportTransferTimeBounds(record)
  const rangeStartMs = transferDateTimeEpoch(`${fromDate}T00:00`)
  const rangeEndDate = shiftCalendarDate(toDate, 1)
  const rangeEndMs = transferDateTimeEpoch(`${rangeEndDate}T00:00`)
  return Boolean(bounds
    && Number.isFinite(rangeStartMs)
    && Number.isFinite(rangeEndMs)
    && bounds.startMs < rangeEndMs
    && bounds.endMs > rangeStartMs)
}

const linkedSupportTransferForAttendance = (state, attendance, employeeId, storeId) => {
  const transferId = String(attendance?.supportTransferId || '').trim()
  if (!transferId) return null
  return (Array.isArray(state.supportTransfers) ? state.supportTransfers : []).find((record) => (
    sameIdentifier(record.id, transferId)
    && supportTransferMatchesEmployeeStore(record, employeeId, storeId)
  )) || null
}

const parseShiftTime = (value) => {
  const match = String(value || '').trim().match(/^(\d{1,2}):(\d{2})$/u)
  if (!match) return null
  const hour = Number(match[1])
  const minute = Number(match[2])
  if (hour > 23 || minute > 59) return null
  return { label: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`, minuteOfDay: (hour * 60) + minute }
}

const shiftTimes = (shift) => {
  const range = String(shift?.time || '').split(/[–—-]/u).map((part) => part.trim())
  const start = parseShiftTime(shift?.start || range[0])
  const end = parseShiftTime(shift?.end || range[1])
  return { start, end }
}

const normalizeLocation = (value, serverTimestamp) => {
  if (!isPlainRecord(value)) {
    throw new ApiError(400, 'LOCATION_REQUIRED', 'Cần cấp quyền vị trí để ghi nhận chấm công.')
  }
  const latitude = Number(value.latitude ?? value.lat)
  const longitude = Number(value.longitude ?? value.lng ?? value.lon)
  const accuracy = value.accuracy == null ? null : Number(value.accuracy)
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90
    || !Number.isFinite(longitude) || longitude < -180 || longitude > 180
    || (accuracy !== null && (!Number.isFinite(accuracy) || accuracy < 0 || accuracy > 100_000))) {
    throw new ApiError(400, 'LOCATION_INVALID', 'Tọa độ chấm công không hợp lệ.')
  }
  return {
    latitude,
    longitude,
    accuracy,
    label: String(value.label || '').trim().slice(0, 160) || null,
    capturedAt: serverTimestamp,
  }
}

const canonicalize = (value, depth = 0) => {
  if (depth > MAX_JSON_DEPTH) throw new ApiError(400, 'JSON_TOO_DEEP', 'Dữ liệu JSON lồng quá sâu.')
  if (Array.isArray(value)) return value.map((item) => canonicalize(item, depth + 1))
  if (!isPlainRecord(value)) return value
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, canonicalize(value[key], depth + 1)]),
  )
}

const SECRET_STATE_FIELDS = new Set([
  'password',
  'passwordHash',
  'password_hash',
  'passwordSalt',
  'password_salt',
  'passwordIterations',
  'password_iterations',
  'legacyPassword',
  'token',
  'tokenHash',
  'token_hash',
])

const normalizedStateKey = (key) => String(key || '').toLocaleLowerCase('en-US').replace(/[^a-z0-9]/gu, '')

const isSecretStateField = (key) => {
  if (SECRET_STATE_FIELDS.has(key)) return true
  const normalized = normalizedStateKey(key)
  return [
    'password',
    'passwordhash',
    'passwordsalt',
    'passworditerations',
    'legacypassword',
    'token',
    'tokenhash',
    'accesstoken',
    'refreshtoken',
    'apikey',
    'secret',
    'credential',
    'credentials',
    'authorization',
    'cookie',
    'setcookie',
  ].includes(normalized)
    || normalized.includes('password')
    || normalized.endsWith('token')
    || normalized.endsWith('tokenhash')
    || normalized.includes('accesstoken')
    || normalized.includes('refreshtoken')
    || normalized.includes('apikey')
    || normalized.includes('secret')
    || normalized.includes('credential')
    || normalized.includes('authorization')
    || normalized.includes('cookie')
}

const isCredentialEnvelope = (value) => {
  if (!isPlainRecord(value)) return false
  const keys = new Set(Object.keys(value).map(normalizedStateKey))
  return ['hash', 'salt', 'iterations', 'algorithm'].every((key) => keys.has(key))
}

const sanitizeStateValue = (value, depth = 0) => {
  if (depth > MAX_JSON_DEPTH) throw new ApiError(400, 'JSON_TOO_DEEP', 'Dữ liệu JSON lồng quá sâu.')
  if (Array.isArray(value)) return value
    .filter((item) => !isCredentialEnvelope(item))
    .map((item) => sanitizeStateValue(item, depth + 1))
  if (!isPlainRecord(value)) return value
  if (isCredentialEnvelope(value)) return null
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key, item]) => !isSecretStateField(key) && !isCredentialEnvelope(item))
      .map(([key, item]) => [key, sanitizeStateValue(item, depth + 1)]),
  )
}

const COMPENSATION_STATE_COLLECTIONS = Object.freeze([
  'storeEmployeeSalaryConfigs',
  'workCatalogItems',
  'workCatalogProgress',
  'storeShiftTaskTemplates',
  'compensationEntries',
  'violations',
  'revenueBonusDaily',
  'revenueBonusAllocations',
  'teamRewardClaims',
  'teamRewardParticipants',
  'periodReconciliations',
  'jobRuns',
])

const withoutRetiredKpiRow = (row) => {
  if (!isPlainRecord(row)) return row
  const { kpiBonus: _retiredKpiBonus, ...safeRow } = row
  void _retiredKpiBonus
  return safeRow
}

const withoutRetiredKpiFields = (period) => {
  if (!isPlainRecord(period)) return period
  const { kpiSnapshot: _retiredKpiSnapshot, ...safePeriod } = period
  void _retiredKpiSnapshot
  if (!Array.isArray(safePeriod.rows)) return safePeriod
  return {
    ...safePeriod,
    rows: safePeriod.rows.map(withoutRetiredKpiRow),
  }
}

const redactRevenueBonusDaily = (record) => {
  if (!isPlainRecord(record)) return record
  const { allocations, participantDetails, ...safe } = record
  void allocations
  void participantDetails
  return safe
}

const normalizeSharedStateForStorage = (value) => {
  const sanitized = sanitizeStateValue(isPlainRecord(value) ? value : {})
  const state = isPlainRecord(sanitized) ? sanitized : {}
  for (const key of [
    'adminAccounts',
    'managerAccounts',
    'managerPayroll',
    'profitShares',
    'policies',
    'orderCounters',
    'importCounter',
    'idempotencyKeys',
    'session',
    'activeAttendanceId',
    'checkedInAt',
    'finishedShift',
  ]) delete state[key]
  if (Array.isArray(state.stores)) {
    state.stores = state.stores.map((store) => {
      const configured = isPlainRecord(store?.operatingHours) ? store.operatingHours : {}
      const opening = parseShiftTime(store?.opening ?? store?.openingTime ?? configured.opening)
      const closing = parseShiftTime(store?.closing ?? store?.closingTime ?? configured.closing)
      if (!opening || !closing || closing.minuteOfDay <= opening.minuteOfDay) return store
      return {
        ...store,
        opening: opening.label,
        openingTime: opening.label,
        closing: closing.label,
        closingTime: closing.label,
        operatingHours: { opening: opening.label, closing: closing.label },
      }
    })
  }
  if (Array.isArray(state.importVouchers)) {
    const expenses = Array.isArray(state.expenseEntries) ? state.expenseEntries : []
    const canonicalImportExpenses = new Map()
    const otherExpenses = []
    for (const expense of expenses) {
      if (String(expense?.sourceType || '') !== 'import-voucher') {
        otherExpenses.push(expense)
        continue
      }
      const sourceId = String(expense?.sourceId || '')
      if (sourceId && !canonicalImportExpenses.has(sourceId)) canonicalImportExpenses.set(sourceId, expense)
    }
    for (const voucher of state.importVouchers) {
      const voucherId = String(voucher?.id || '')
      if (!voucherId || canonicalImportExpenses.has(voucherId)) continue
      const totalAmount = Number(voucher.totalAmount ?? (
        Number(voucher.goodsAmount || 0)
        + Number(voucher.shippingAmount || 0)
        + Number(voucher.relatedAmount || 0)
      ))
      if (!Number.isSafeInteger(totalAmount) || totalAmount < 0) continue
      const deleted = Boolean(voucher.deletedAt || voucher.status === 'Đã xóa')
      canonicalImportExpenses.set(voucherId, {
        id: `exp_import_${voucherId}`,
        storeId: voucher.storeId,
        type: 'Nhập hàng',
        category: 'inventory',
        amount: totalAmount,
        description: `Phiếu nhập ${voucher.code || voucherId}`,
        sourceType: 'import-voucher',
        sourceId: voucherId,
        recognized: !deleted,
        occurredAt: voucher.createdAt,
        createdAt: voucher.createdAt,
        createdBy: voucher.createdBy?.id || voucher.createdBy || 'SYSTEM',
        ...(deleted ? { deletedAt: voucher.deletedAt, voidedAt: voucher.deletedAt } : {}),
      })
    }
    state.expenseEntries = [...canonicalImportExpenses.values(), ...otherExpenses]
  }
  for (const key of COMPENSATION_STATE_COLLECTIONS) {
    if (!Array.isArray(state[key])) state[key] = []
  }
  if (Number(state.staffWorkCatalogSeedVersion || 0) < STAFF_WORK_CATALOG_SEED_VERSION) {
    const knownCodes = new Set(state.workCatalogItems
      .map((item) => String(item?.code || '').trim().toLocaleLowerCase('en-US'))
      .filter(Boolean))
    const missingDefaults = []
    for (const item of DEFAULT_WORK_CATALOG_ITEMS) {
      const code = String(item?.code || '').trim().toLocaleLowerCase('en-US')
      if (!code || knownCodes.has(code)) continue
      knownCodes.add(code)
      missingDefaults.push({ ...item })
    }
    state.workCatalogItems = [...state.workCatalogItems, ...missingDefaults]
    state.staffWorkCatalogSeedVersion = STAFF_WORK_CATALOG_SEED_VERSION
  }
  if (Array.isArray(state.payrollPeriods)) {
    state.payrollPeriods = state.payrollPeriods.map(withoutRetiredKpiFields)
  }
  return state
}

const employeeReference = (record) => String(
  record?.employeeId || record?.employee_id || record?.assigneeId || record?.userId || '',
)

const employeeReferences = (record) => {
  const references = new Set()
  const add = (value) => {
    const normalized = String(value || '').trim()
    if (normalized) references.add(normalized)
  }
  const collect = (value, parentKey = '', depth = 0) => {
    if (depth > 16 || value == null) return
    if (Array.isArray(value)) {
      for (const item of value) {
        if (['employeeIds', 'assignees', 'participants'].includes(parentKey)) {
          if (isPlainRecord(item)) add(
            item.employeeId || item.employee_id || item.assigneeId || item.userId || item.id || item.code,
          )
          else add(item)
        }
        collect(item, parentKey, depth + 1)
      }
      return
    }
    if (!isPlainRecord(value)) return
    if (['assignees', 'participants'].includes(parentKey)) {
      add(value.employeeId || value.employee_id || value.assigneeId || value.userId || value.id || value.code)
    }
    if (['before', 'after'].includes(parentKey)
      && (value.employeeCode || value.unit || value.unitType || value.department)) {
      add(value.employeeId || value.employee_id || value.employeeCode || value.id || value.code)
    }
    for (const [key, nested] of Object.entries(value)) {
      if (['employeeId', 'employee_id', 'assigneeId', 'userId'].includes(key)) add(nested)
      if (key === 'completedBy' && isPlainRecord(nested)) Object.keys(nested).forEach(add)
      collect(nested, key, depth + 1)
    }
  }
  collect(record)
  return [...references]
}

const redactEmployeeReferences = (value, allowedEmployeeIds, parentKey = '', depth = 0) => {
  const allowedKeys = depth === 0
    ? new Set([...allowedEmployeeIds].map(normalizeIdentifierKey).filter(Boolean))
    : allowedEmployeeIds
  if (depth > 16 || value == null) return value
  if (Array.isArray(value)) {
    return value.flatMap((item) => {
      if (['employeeIds', 'assignees', 'participants'].includes(parentKey)) {
        const reference = isPlainRecord(item)
          ? String(item.employeeId || item.employee_id || item.assigneeId || item.userId || item.id || item.code || '')
          : String(item || '')
        if (reference && !allowedKeys.has(normalizeIdentifierKey(reference))) return []
      }
      const redacted = redactEmployeeReferences(item, allowedKeys, parentKey, depth + 1)
      return redacted === undefined ? [] : [redacted]
    })
  }
  if (!isPlainRecord(value)) return value
  const directReference = String(
    value.employeeId || value.employee_id || value.assigneeId || value.userId || '',
  ).trim()
  const contextualReference = ['before', 'after', 'assignees', 'participants'].includes(parentKey)
    ? String(value.employeeCode || value.id || value.code || '').trim()
    : ''
  if (depth > 0
    && ((directReference && !allowedKeys.has(normalizeIdentifierKey(directReference)))
      || (contextualReference && !allowedKeys.has(normalizeIdentifierKey(contextualReference))))) return undefined
  const projected = {}
  for (const [key, nested] of Object.entries(value)) {
    if (['employeeId', 'employee_id', 'assigneeId', 'userId'].includes(key)) {
      if (allowedKeys.has(normalizeIdentifierKey(nested))) projected[key] = nested
      continue
    }
    if (key === 'completedBy' && isPlainRecord(nested)) {
      projected[key] = Object.fromEntries(Object.entries(nested)
        .filter(([employeeId]) => allowedKeys.has(normalizeIdentifierKey(employeeId))))
      continue
    }
    const redacted = redactEmployeeReferences(nested, allowedKeys, key, depth + 1)
    if (redacted !== undefined) projected[key] = redacted
  }
  return projected
}

const belongsToEmployee = (record, employeeId) => {
  if (!isPlainRecord(record)) return false
  return employeeReferences(record).some((reference) => sameIdentifier(reference, employeeId))
}

const orderCreatorEmployeeId = (record) => {
  if (!isPlainRecord(record)) return ''
  const explicitEmployeeId = String(
    record.createdByEmployeeId
      || record.creatorEmployeeId
      || record.createdBy?.employeeId
      || record.createdBy?.employee_id
      || '',
  ).trim()
  if (explicitEmployeeId) return explicitEmployeeId

  // Older employee orders predate the creator snapshot. Their direct employeeId is
  // the only durable creator identity. An explicit non-employee actor, however,
  // must never make an assigned order appear as if the employee created it.
  const creatorRole = String(record.createdBy?.role || '').trim().toLowerCase()
  if (creatorRole && creatorRole !== 'employee') return ''
  return String(record.employeeId || record.employee_id || '').trim()
}

const orderCreatedByEmployee = (record, employeeId) => (
  Boolean(String(employeeId || '').trim())
  && sameIdentifier(orderCreatorEmployeeId(record), employeeId)
)

const taskAssigneeIds = (task) => {
  const references = new Set()
  const add = (value) => {
    const normalized = String(value || '').trim()
    if (normalized) references.add(normalized)
  }
  add(task?.employeeId || task?.employee_id || task?.assigneeId || task?.userId)
  for (const value of Array.isArray(task?.employeeIds) ? task.employeeIds : []) add(value)
  for (const value of Array.isArray(task?.assignees) ? task.assignees : []) {
    if (isPlainRecord(value)) add(value.employeeId || value.employee_id || value.assigneeId || value.userId || value.id || value.code)
    else add(value)
  }
  return [...references]
}

const taskAppliesToEmployee = (task, employeeId, storeId) => {
  if (!isPlainRecord(task) || task.deletedAt || !sameIdentifier(task.storeId, storeId)) return false
  const assignees = taskAssigneeIds(task)
  return !assignees.length || assignees.some((assigneeId) => sameIdentifier(assigneeId, employeeId))
}

const completedByEmployeeValue = (completedBy, employeeId) => {
  if (!isPlainRecord(completedBy)) return undefined
  const entries = Object.entries(completedBy)
  const requestedIdentifier = String(employeeId || '').trim()
  const exact = entries.filter(([candidateId]) => candidateId === requestedIdentifier)
  if (exact.length === 1) return exact[0][1]
  const matches = entries.filter(([candidateId]) => sameIdentifier(candidateId, requestedIdentifier))
  return matches.length === 1 ? matches[0][1] : undefined
}

const filterArray = (state, key, predicate) => (Array.isArray(state[key]) ? state[key].filter(predicate) : [])

const hasExplicitNotificationAudience = (record) => employeeReferences(record).length > 0

const employeeUnit = (record) => {
  const explicit = String(record?.unit || record?.unitType || record?.department || '').trim().toLowerCase()
  if (['business_support', 'business-support', 'support'].includes(explicit)) return 'business_support'
  if (['store_manager', 'store-manager', 'manager'].includes(explicit)) return 'store_manager'
  if (explicit === 'office' || sameIdentifier(record?.storeId, OFFICE_STORE_ID) || record?.isOffice === true) return 'office'
  return 'store'
}

const officeLikeEmployee = (record) => ['office', 'business_support', 'store_manager'].includes(employeeUnit(record))

const roleForEmployeeUnit = (unit) => {
  if (unit === 'business_support') return 'business_support'
  if (unit === 'store_manager') return 'store_manager'
  return 'employee'
}

const payrollProjectionEmployeeId = (record) => String(
  record?.employeeId || record?.employee_id || record?.id || record?.code || '',
).trim()

const projectPayrollPeriodForEmployees = (period, visibleEmployeeIds) => {
  const visibleEmployeeKeys = new Set([...visibleEmployeeIds].map(normalizeIdentifierKey).filter(Boolean))
  const rows = Array.isArray(period?.rows)
    ? period.rows.filter((row) => visibleEmployeeKeys.has(normalizeIdentifierKey(payrollProjectionEmployeeId(row))))
    : null
  return { ...withoutRetiredKpiFields(period), ...(rows ? { rows: rows.map(withoutRetiredKpiRow) } : {}) }
}

const referencedOrderForNotification = (state, record) => {
  const orders = Array.isArray(state.orders) ? state.orders : []
  const stores = Array.isArray(state.stores) ? state.stores : []
  const references = (values) => [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))]
  const normalizeIdentity = (value) => String(value || '')
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/gu, '')
  const storeIdFromCode = (code) => {
    const prefix = normalizeIdentity(String(code || '').trim().replace(/-\d+$/u, ''))
    if (!prefix) return ''
    const matches = stores.filter((store) => [
      store.id, store.short, store.code, store.employeePrefix, store.name,
    ].some((value) => normalizeIdentity(value) === prefix))
    return matches.length === 1 ? String(matches[0].id || '') : ''
  }
  const embeddedStoreId = String(
    record.order?.storeId
      || record.data?.order?.storeId
      || '',
  )
  const genericStoreId = String(
    record.data?.storeId
      || record.storeId
      || '',
  )
  const uniqueOrderByCode = (reference) => {
    const matches = orders.filter((order) => String(order.code || '').trim() === reference)
    if (matches.length === 1) return matches[0]
    for (const storeId of references([embeddedStoreId, storeIdFromCode(reference), genericStoreId])) {
      const scoped = matches.filter((order) => sameIdentifier(order.storeId, storeId))
      if (scoped.length === 1) return scoped[0]
    }
    return null
  }
  const idReferences = references([
    record.orderId,
    record.order_id,
    record.data?.orderId,
    record.data?.order_id,
    record.data?.order?.id,
    record.order?.id,
  ])
  for (const reference of idReferences) {
    const matches = orders.filter((order) => String(order.id || '').trim() === reference)
    if (matches.length === 1) return matches[0]
  }

  const codeReferences = references([
    record.orderCode,
    record.order_code,
    record.data?.orderCode,
    record.data?.order_code,
    record.data?.order?.code,
    record.order?.code,
  ])
  for (const reference of codeReferences) {
    const order = uniqueOrderByCode(reference)
    if (order) return order
  }
  // Older notification rows stored the visible order code in `orderId`.
  // Only use this cross-type fallback after exact IDs and explicit codes fail.
  for (const reference of idReferences) {
    const order = uniqueOrderByCode(reference)
    if (order) return order
  }
  return null
}

const canAccessNotification = (state, actor, record) => {
  if (!isPlainRecord(record)) return false
  if (actor.role === 'admin') return true
  if (actor.role === 'business_support') {
    if (String(record.type || '') === 'support-work-submitted') return false
    if (String(record.type || '') === 'support-work-assigned') {
      return belongsToEmployee(record, String(actor.employee_id || actor.user_id || ''))
    }
    return true
  }
  const recordStoreId = String(record.storeId || '')
  if (actor.role === 'store_manager') {
    const storeId = String(actor.store_id || '')
    if (!storeId || !sameIdentifier(recordStoreId, storeId)) return false
    const referencedEmployeeIds = employeeReferences(record)
    if (!referencedEmployeeIds.length) return true
    const eventTime = String(record.createdAt || record.occurredAt || '')
    const eventEpoch = Date.parse(eventTime)
    return referencedEmployeeIds.every((reference) => (
      (Array.isArray(state.employees) ? state.employees : []).some((employee) => (
        employeeIdentifierValues(employee).some((identifier) => sameIdentifier(identifier, reference))
        && sameIdentifier(employee.storeId, storeId)
        && (employeeUnit(employee) === 'store'
          || employeeIdentifierValues(employee).some((identifier) => sameIdentifier(identifier, actor.employee_id)))
      ))
      || (Number.isFinite(eventEpoch) && (Array.isArray(state.supportTransfers) ? state.supportTransfers : []).some((transfer) => {
        if (!sameIdentifier(transfer.employeeId, reference)
          || !sameIdentifier(transfer.toStoreId, storeId)
          || transfer.deletedAt
          || ['Đã xóa', 'Đã hủy'].includes(String(transfer.status || ''))) return false
        const bounds = supportTransferTimeBounds(transfer)
        return Boolean(bounds && bounds.startMs <= eventEpoch && eventEpoch < bounds.endMs)
      }))
    ))
  }
  if (actor.role !== 'employee') return false
  if (String(record.type || '') === 'store-task-progress-submitted') return false
  const employeeId = String(actor.employee_id || actor.user_id || '')
  const storeId = String(actor.store_id || '')
  if (!employeeId || !storeId || (recordStoreId && !sameIdentifier(recordStoreId, storeId))) return false
  if (String(record.type || '').startsWith('order.')) {
    const order = referencedOrderForNotification(state, record)
    if (!order || !orderCreatedByEmployee(order, employeeId)) return false
  }
  return hasExplicitNotificationAudience(record)
    ? belongsToEmployee(record, employeeId)
    : sameIdentifier(recordStoreId, storeId)
}

const notificationActorId = (actor) => String(actor?.user_id || actor?.id || '')

const notificationReadAtForActor = (record, actor) => {
  if (!isPlainRecord(record)) return null
  if (record.readAt || record.read || record.isRead) return record.readAt || record.updatedAt || record.createdAt || null
  const actorId = notificationActorId(actor)
  if (!actorId || !isPlainRecord(record.readAtByUserId)) return null
  return record.readAtByUserId[actorId] || null
}

const projectNotificationForActor = (record, actor) => {
  const safeRecord = actor.role === 'employee'
    ? redactEmployeeReferences(record, new Set([String(actor.employee_id || actor.user_id || '')]))
    : record
  const { readAtByUserId, readByUserIds, ...projected } = safeRecord
  void readAtByUserId
  void readByUserIds
  return { ...projected, readAt: notificationReadAtForActor(record, actor) }
}

const accountAvatarOwnerSegment = (value) => String(value || '')
  .replace(/[^A-Za-z0-9_-]/gu, '_')
  .slice(0, 120)

const accountAvatarKeyPrefixForUser = (userId) => `${ACCOUNT_AVATAR_KEY_PREFIX}${accountAvatarOwnerSegment(userId)}/`

const normalizeAccountAvatarMetadata = (value, userId = '') => {
  if (!isPlainRecord(value)) return null
  const key = String(value.key || '')
  const contentType = String(value.contentType || value.mimeType || '')
  const size = Number(value.size)
  const version = Number(value.version)
  if (!key.startsWith(userId ? accountAvatarKeyPrefixForUser(userId) : ACCOUNT_AVATAR_KEY_PREFIX)
    || !ACCOUNT_AVATAR_CONTENT_TYPES.has(contentType)
    || !Number.isSafeInteger(size) || size < 1 || size > MAX_AVATAR_BYTES
    || !Number.isSafeInteger(version) || version < 1) return null
  return {
    key,
    contentType,
    size,
    version,
  }
}

const ownEmployeeProfile = (state, user) => {
  const userId = String(user?.user_id || user?.id || '')
  const employeeId = String(user?.employee_id || user?.employeeId || '')
  const employees = Array.isArray(state?.employees) ? state.employees : []
  if (employeeId) {
    const employeeMatch = uniqueEmployeeIdentifierRecordMatch({
      records: employees,
      identifier: employeeId,
      predicate: isPlainRecord,
      collisionCode: 'EMPLOYEE_AVATAR_PROFILE_COLLISION',
      collisionMessage: 'Định danh hồ sơ ảnh đại diện đang trùng; không thể chọn hồ sơ an toàn.',
    })
    if (employeeMatch) return employeeMatch.record
  }
  if (!userId) return null
  return uniqueIdentifierRecordMatch({
    records: employees,
    identifier: userId,
    identifierOf: (profile) => profile?.authUserId,
    predicate: isPlainRecord,
    collisionCode: 'EMPLOYEE_AVATAR_OWNER_COLLISION',
    collisionMessage: 'Tài khoản đang liên kết nhiều hồ sơ ảnh đại diện; cần xử lý dữ liệu trùng.',
  })?.record || null
}

const employeeProfileIdentifier = (profile = {}) => String(
  profile.id || profile.code || profile.employeeId || profile.employeeCode || '',
).trim()

const actorRoleEmployeeProfile = (state, user) => {
  const employees = Array.isArray(state?.employees) ? state.employees : []
  const employeeId = String(user?.employee_id || user?.employeeId || '').trim()
  if (employeeId) {
    const match = uniqueEmployeeIdentifierRecordMatch({
      records: employees,
      identifier: employeeId,
      predicate: isPlainRecord,
      collisionCode: 'EMPLOYEE_ROLE_PROFILE_COLLISION',
      collisionMessage: 'Định danh hồ sơ cho vai trò hiện tại đang trùng; không thể chọn theo thứ tự dữ liệu.',
    })
    if (match) return match.record
  }
  const userId = String(user?.user_id || user?.id || '').trim()
  return userId
    ? uniqueIdentifierRecordMatch({
        records: employees,
        identifier: userId,
        identifierOf: (profile) => profile?.authUserId,
        predicate: isPlainRecord,
        collisionCode: 'EMPLOYEE_ROLE_OWNER_COLLISION',
        collisionMessage: 'Tài khoản đang liên kết nhiều hồ sơ vai trò; cần xử lý dữ liệu trùng.',
      })?.record || null
    : null
}

const canonicalActorEmployeeProfile = (state, user) => {
  const employees = Array.isArray(state?.employees) ? state.employees : []
  let current = actorRoleEmployeeProfile(state, user)
  const visited = new Set()
  while (current) {
    const currentId = employeeProfileIdentifier(current)
    const currentKey = normalizeIdentifierKey(currentId)
    if (!currentKey || visited.has(currentKey)) break
    visited.add(currentKey)
    const linkedId = String(
      current.linkedEmployeeId
      || current.sourceEmployeeId
      || current.rootEmployeeId
      || current.originalEmployeeId
      || '',
    ).trim()
    if (!linkedId) break
    const linked = uniqueEmployeeIdentifierRecordMatch({
      records: employees,
      identifier: linkedId,
      predicate: isPlainRecord,
      collisionCode: 'LINKED_EMPLOYEE_PROFILE_COLLISION',
      collisionMessage: 'Hồ sơ nhân viên liên kết đang trùng; không thể chọn theo thứ tự dữ liệu.',
    })?.record || null
    if (!linked) break
    current = linked
  }
  return current
}

const accountProfileScalar = (value) => (
  ['string', 'number'].includes(typeof value) ? String(value).trim() : ''
)

const accountProfileAddress = (profile = {}) => {
  if (typeof profile.address === 'string' && profile.address.trim()) return profile.address.trim()
  const nested = isPlainRecord(profile.address) ? profile.address : {}
  return [
    profile.street || profile.addressStreet || nested.street,
    profile.ward || profile.addressWard || nested.ward,
    profile.province || profile.addressProvince || nested.province || nested.provinceCity,
  ].map(accountProfileScalar).filter(Boolean).join(', ')
}

// Account settings only needs the signed-in person's canonical personnel
// identity. Keep this deliberately smaller than an employee record so a
// linked Store role cannot use the projection to inspect another unit/store.
const projectActorAccountProfile = (state, user) => {
  const profile = canonicalActorEmployeeProfile(state, user)
  if (!profile) return null
  return {
    code: accountProfileScalar(profile.code || profile.employeeCode || profile.id || profile.employeeId),
    name: accountProfileScalar(profile.name),
    email: accountProfileScalar(profile.email || profile.workEmail),
    phone: accountProfileScalar(profile.phone || profile.phoneNumber || profile.mobile),
    cccd: accountProfileScalar(profile.cccd || profile.citizenId || profile.identityNumber),
    birthday: accountProfileScalar(profile.birthday || profile.birthDate || profile.dateOfBirth || profile.dob).slice(0, 10),
    gender: accountProfileScalar(profile.gender || profile.sex),
    address: accountProfileAddress(profile),
    position: accountProfileScalar(profile.position || profile.workPosition || profile.jobPosition),
  }
}

const ownProfileAvatarMetadata = (profile, userId) => {
  if (!isPlainRecord(profile)) return null
  const normalizedUserId = String(userId || '').trim()
  const direct = normalizedUserId
    ? normalizeAccountAvatarMetadata(profile.avatarImage, normalizedUserId)
      || normalizeAccountAvatarMetadata(profile.avatar, normalizedUserId)
    : null
  if (direct) return direct

  // Early versions migrated an employee image before the employee had an
  // authUserId. Those objects used a deterministic legacy-profile owner. The
  // current user may read that object only when their employee_id resolves to
  // this exact profile; arbitrary account-avatar keys remain rejected.
  const profileId = String(profile.id || profile.code || profile.employeeId || '')
  const legacy = normalizeAccountAvatarMetadata(profile.avatarImage)
    || normalizeAccountAvatarMetadata(profile.avatar)
  const legacyPrefix = profileId
    ? accountAvatarKeyPrefixForUser(`legacy-profile-${profileId}`)
    : ''
  return legacy && legacyPrefix && legacy.key.startsWith(legacyPrefix) ? legacy : null
}

const ownAccountSettings = (state, user) => {
  const userId = String(user.user_id || user.id || '')
  const stored = isPlainRecord(state.accountSettings?.[userId]) ? state.accountSettings[userId] : null
  const legacy = user.role === 'admin' && isPlainRecord(state.settings) ? state.settings : {}
  const settings = {
    name: user.display_name || user.displayName || user.username || '',
    email: '',
    phone: '',
    birthday: '',
    gender: '',
    address: '',
    bio: '',
    avatar: '',
    ...legacy,
    ...(stored || {}),
    notifications: {
      tasks: true,
      dailyReport: true,
      expenseAlert: false,
      ...(isPlainRecord(legacy.notifications) ? legacy.notifications : {}),
      ...(isPlainRecord(stored?.notifications) ? stored.notifications : {}),
    },
  }
  const metadata = normalizeAccountAvatarMetadata(settings.avatar, userId)
  if (metadata) settings.avatar = metadata
  else if (isEmbeddedImageDataUrl(settings.avatar) || isPlainRecord(settings.avatar) || !settings.avatar) {
    const invalidEmbeddedAvatar = isEmbeddedImageDataUrl(settings.avatar) || isPlainRecord(settings.avatar)
    // Multi-role accounts often sign in through a store-role proxy. Resolve
    // the actor's canonical personnel chain before falling back to the proxy,
    // otherwise a valid legacy avatar on the original HTKD/KVP profile is
    // silently replaced by the default initials.
    const candidates = [
      canonicalActorEmployeeProfile(state, user),
      actorRoleEmployeeProfile(state, user),
      ownEmployeeProfile(state, user),
    ].filter((profile, index, profiles) => profile && profiles.indexOf(profile) === index)
    let profileMetadata = null
    let legacyUrl = ''
    for (const profile of candidates) {
      profileMetadata ||= ownProfileAvatarMetadata(profile, userId)
      legacyUrl ||= typeof profile.avatar === 'string' && !isEmbeddedImageDataUrl(profile.avatar)
        ? profile.avatar
        : (typeof profile.avatarImage === 'string' && !isEmbeddedImageDataUrl(profile.avatarImage)
            ? profile.avatarImage
            : '')
      if (profileMetadata || legacyUrl) break
    }
    if (profileMetadata || legacyUrl) settings.avatar = profileMetadata || legacyUrl
    else if (invalidEmbeddedAvatar) settings.avatar = null
  }
  return settings
}

const employeeAccountAvatar = (state, employee = {}) => {
  const authUserId = String(employee.authUserId || '')
  const accountAvatar = authUserId && isPlainRecord(state.accountSettings?.[authUserId])
    ? state.accountSettings[authUserId].avatar
    : null
  if (typeof accountAvatar === 'string' && !isEmbeddedImageDataUrl(accountAvatar)) return accountAvatar
  return typeof employee.avatar === 'string' && !isEmbeddedImageDataUrl(employee.avatar)
    ? employee.avatar
    : ''
}

const withEmployeeAccountAvatar = (state, employee = {}) => {
  const avatar = employeeAccountAvatar(state, employee)
  return avatar ? { ...employee, avatar } : { ...employee }
}

export const projectSharedState = (rawState, user) => {
  const normalizedState = normalizeSharedStateForStorage(rawState)
  const supportCompensationContext = createSupportCompensationProjectionContext(normalizedState)
  // Folded employee IDs are safe at an authorization boundary only when they
  // resolve to exactly one profile. Admin keeps access to repair legacy data;
  // every operational projection fails closed instead of leaking peer records.
  if (user.role !== 'admin') assertNoCaseCollidingOperationalIdentifiers(normalizedState)
  let state = {
    ...normalizedState,
    orderInformationOptions: orderInformationOptionsFromState(normalizedState),
    ...(Object.hasOwn(normalizedState, 'employees') ? {
      employees: (Array.isArray(normalizedState.employees) ? normalizedState.employees : [])
        .map((employee) => withEmployeeAccountAvatar(normalizedState, employee)),
    } : {}),
    ...(Object.hasOwn(normalizedState, 'attendance') ? {
      attendance: (Array.isArray(normalizedState.attendance) ? normalizedState.attendance : [])
        .map((record) => withSupportCompensation(normalizedState, record, supportCompensationContext)),
    } : {}),
  }
  const common = {
    schemaVersion: state.schemaVersion,
    stateVersion: state.stateVersion,
    orderInformationOptions: state.orderInformationOptions,
    session: null,
    activeAttendanceId: null,
    checkedInAt: null,
    finishedShift: false,
    ...(user.role === 'admin' ? {} : {
      accountProfile: projectActorAccountProfile(state, user),
    }),
  }
  if (user.role === 'admin') {
    const { accountSettings, ...adminState } = state
    void accountSettings
    return {
      ...adminState,
      notifications: filterArray(state, 'notifications', () => true).map((record) => projectNotificationForActor(record, user)),
      settings: ownAccountSettings(state, user),
      session: null,
    }
  }

  if (user.role === 'business_support') {
    const ownEmployeeId = String(user.employee_id || '')
    const ownAttendance = filterArray(state, 'attendance', (record) => belongsToEmployee(record, ownEmployeeId))
    const ownOpenAttendance = ownAttendance.find((record) => !record.deletedAt && !record.checkOut && !record.checkOutAt)
    const ownLatestAttendance = [...ownAttendance]
      .sort((left, right) => String(right.checkInAt || right.createdAt || '').localeCompare(String(left.checkInAt || left.createdAt || '')))[0]
    const { accountSettings, accountProfile: persistedAccountProfile, ...operationalState } = state
    void accountSettings
    void persistedAccountProfile
    return {
      ...operationalState,
      supportWorkAssignments: filterArray(state, 'supportWorkAssignments', (record) => (
        belongsToEmployee(record, ownEmployeeId)
      )),
      notifications: filterArray(state, 'notifications', (record) => canAccessNotification(state, user, record))
        .map((record) => projectNotificationForActor(record, user)),
      settings: ownAccountSettings(state, user),
      accountProfile: projectActorAccountProfile(state, user),
      activeAttendanceId: ownOpenAttendance?.id || null,
      checkedInAt: ownOpenAttendance?.checkInAt || ownOpenAttendance?.checkIn || null,
      finishedShift: Boolean(!ownOpenAttendance && ownLatestAttendance?.checkOutAt),
      session: null,
    }
  }

  if (user.role === 'store_manager') {
    const requestedStoreId = String(user.store_id || '')
    const storeId = String(
      (Array.isArray(state.stores) ? state.stores : []).find((record) => sameIdentifier(record.id, requestedStoreId))?.id
      || requestedStoreId,
    )
    if (!storeId || [OFFICE_STORE_ID, BUSINESS_SUPPORT_STORE_ID].some((identifier) => sameIdentifier(identifier, storeId))) return common
    const ownEmployeeId = String(user.employee_id || '')
    const ownAttendance = filterArray(state, 'attendance', (record) => belongsToEmployee(record, ownEmployeeId))
    const ownOpenAttendance = ownAttendance.find((record) => !record.deletedAt && !record.checkOut && !record.checkOutAt)
    const ownLatestAttendance = [...ownAttendance]
      .sort((left, right) => String(right.checkInAt || right.createdAt || '').localeCompare(String(left.checkInAt || left.createdAt || '')))[0]
    const homeEmployees = filterArray(state, 'employees', (record) => (
      sameIdentifier(record.storeId, storeId)
      && (employeeUnit(record) === 'store'
        || employeeIdentifierValues(record).some((identifier) => sameIdentifier(identifier, ownEmployeeId)))
    ))
    const projectionTimestamp = new Date().toISOString()
    const inboundTransfers = filterArray(state, 'supportTransfers', (record) => (
      sameIdentifier(record.toStoreId, storeId)
      && isSupportTransferActiveAt(record, projectionTimestamp)
    ))
    const inboundTransferByEmployee = new Map(inboundTransfers.map((record) => [normalizeIdentifierKey(record.employeeId), record]))
    const transferredEmployees = filterArray(state, 'employees', (record) => (
      employeeUnit(record) === 'store'
      && !record.deletedAt
      && employeeIdentifierValues(record).some((identifier) => inboundTransferByEmployee.has(normalizeIdentifierKey(identifier)))
    )).map((record) => {
      const transfer = employeeIdentifierValues(record)
        .map((identifier) => inboundTransferByEmployee.get(normalizeIdentifierKey(identifier)))
        .find(Boolean)
      return {
        ...record,
        homeStoreId: record.storeId,
        supportStoreId: storeId,
        supportAssignment: {
          id: transfer.id,
          fromStoreId: transfer.fromStoreId,
          toStoreId: transfer.toStoreId,
          startAt: supportTransferTimeBounds(transfer)?.startAt || transfer.startAt,
          endAt: supportTransferTimeBounds(transfer)?.endAt || transfer.endAt,
          fromDate: transfer.fromDate,
          toDate: transfer.toDate,
          hourlySupportRate: transfer.hourlySupportRate,
          allowance: transfer.allowance,
          status: transfer.status,
        },
      }
    })
    const employees = [...homeEmployees]
    for (const employee of transferredEmployees) {
      if (!employees.some((record) => (
        employeeIdentifierValues(record).some((left) => employeeIdentifierValues(employee).some((right) => sameIdentifier(left, right)))
      ))) {
        employees.push(employee)
      }
    }
    const visibleEmployeeIds = new Set(employees.flatMap((record) => (
      employeeIdentifierValues(record).map(normalizeIdentifierKey).filter(Boolean)
    )))
    const storeEmployeeIds = new Set(employees.filter((record) => employeeUnit(record) === 'store')
      .flatMap((record) => employeeIdentifierValues(record).map(normalizeIdentifierKey).filter(Boolean)))
    const historicalInboundEmployeeIds = filterArray(state, 'supportTransfers', (record) => (
      sameIdentifier(record.toStoreId, storeId)
      && !record.deletedAt
      && String(record.status || '') !== 'Đã xóa'
    )).map((record) => normalizeIdentifierKey(record.employeeId)).filter(Boolean)
    const historicalStoreEmployeeIds = new Set([
      ...storeEmployeeIds,
      ...historicalInboundEmployeeIds,
      ...filterArray(state, 'deletedEmployees', (record) => (
        sameIdentifier(record.storeId, storeId) && employeeUnit(record) === 'store'
      )).flatMap((record) => employeeIdentifierValues(record).map(normalizeIdentifierKey).filter(Boolean)),
    ])
    const payrollVisibleEmployeeIds = new Set([
      ...storeEmployeeIds,
      ...historicalInboundEmployeeIds,
    ])
    const historicalVisibleEmployeeIds = new Set([...visibleEmployeeIds, ...historicalStoreEmployeeIds])
    const belongsToAllowedStoreEmployees = (record, allowedEmployeeIds) => {
      const recordStoreId = String(record?.storeId || '')
      if (recordStoreId && !sameIdentifier(recordStoreId, storeId)) return false
      const references = employeeReferences(record)
      if (references.length) return references.every((reference) => allowedEmployeeIds.has(normalizeIdentifierKey(reference)))
      return sameIdentifier(recordStoreId, storeId)
    }
    const employeeScoped = (key) => filterArray(
      state,
      key,
      (record) => belongsToAllowedStoreEmployees(record, storeEmployeeIds),
    )
    const historicalVisibleScoped = (key) => filterArray(
      state,
      key,
      (record) => belongsToAllowedStoreEmployees(record, historicalVisibleEmployeeIds),
    )
    const historicalEmployeeScoped = (key) => filterArray(
      state,
      key,
      (record) => belongsToAllowedStoreEmployees(record, historicalStoreEmployeeIds),
    )
    const ownCompensationEntries = historicalVisibleScoped('compensationEntries')
      .filter((record) => belongsToEmployee(record, ownEmployeeId))
    const ownViolations = historicalVisibleScoped('violations')
      .filter((record) => belongsToEmployee(record, ownEmployeeId))
    const compensationTeamTotals = (() => {
      const totals = new Map()
      const ensure = (period) => {
        if (!totals.has(period)) totals.set(period, {
          period,
          workVnd: 0,
          manualVnd: 0,
          allowanceVnd: 0,
          revenueVnd: 0,
          violationsVnd: 0,
        })
        return totals.get(period)
      }
      const add = (amount) => {
        const normalized = Number(amount)
        return Number.isSafeInteger(normalized) && normalized >= 0 ? normalized : 0
      }
      for (const record of historicalVisibleScoped('compensationEntries')) {
        if (record.deletedAt || record.voidedAt || !['approved', 'active', 'confirmed'].includes(normalizeTextKey(record.status))) continue
        const period = String(record.period || monthFromRecord(record) || '').trim()
        if (!/^\d{4}-\d{2}$/u.test(period)) continue
        const type = String(record.type || record.kind || '').trim().toUpperCase()
        const field = type === 'WORK' ? 'workVnd' : type === 'ALLOWANCE' ? 'allowanceVnd' : type === 'REVENUE' ? 'revenueVnd' : 'manualVnd'
        const bucket = ensure(period)
        bucket[field] += add(record.amountVnd ?? record.amount)
      }
      for (const record of historicalVisibleScoped('violations')) {
        if (record.deletedAt || record.voidedAt || !['active', 'approved', 'confirmed'].includes(normalizeTextKey(record.status))) continue
        const period = String(record.period || monthFromRecord(record) || '').trim()
        if (!/^\d{4}-\d{2}$/u.test(period)) continue
        const bucket = ensure(period)
        bucket.violationsVnd += add(Math.abs(Number(record.amountVnd ?? record.amount)))
      }
      return [...totals.values()].sort((left, right) => right.period.localeCompare(left.period))
    })()
    const payrollPeriods = filterArray(state, 'payrollPeriods', (period) => (
      !period.supersededAt && sameIdentifier(period.storeId, storeId)
    )).map((period) => projectPayrollPeriodForEmployees(period, payrollVisibleEmployeeIds))
    const deletedEmployees = filterArray(state, 'deletedEmployees', (record) => (
      sameIdentifier(record.storeId, storeId)
      && (employeeUnit(record) === 'store'
        || employeeIdentifierValues(record).some((identifier) => sameIdentifier(identifier, ownEmployeeId)))
    ))
    return {
      ...common,
      activeStoreId: storeId,
      activeAttendanceId: ownOpenAttendance?.id || null,
      checkedInAt: ownOpenAttendance?.checkInAt || ownOpenAttendance?.checkIn || null,
      finishedShift: Boolean(!ownOpenAttendance && ownLatestAttendance?.checkOutAt),
      stores: filterArray(state, 'stores', (record) => sameIdentifier(record.id, storeId)),
      employees,
      attendance: historicalVisibleScoped('attendance'),
      schedule: employeeScoped('schedule'),
      tasks: employeeScoped('tasks'),
      taskAssignmentHistory: historicalEmployeeScoped('taskAssignmentHistory'),
      notifications: filterArray(state, 'notifications', (record) => canAccessNotification(state, user, record))
        .map((record) => projectNotificationForActor(record, user)),
      salaryAdjustments: employeeScoped('salaryAdjustments'),
      salaryAdvances: employeeScoped('salaryAdvances'),
      payrollPeriods,
      payrollPayments: employeeScoped('payrollPayments'),
      storeEmployeeSalaryConfigs: filterArray(state, 'storeEmployeeSalaryConfigs', (record) => (
        !record.deletedAt
        && sameIdentifier(record.storeId, storeId)
        && storeEmployeeIds.has(normalizeIdentifierKey(record.employeeId || record.employee_id))
      )).map((record) => redactEmployeeReferences(record, storeEmployeeIds)),
      workCatalogItems: filterArray(state, 'workCatalogItems', (record) => (
        String(record.targetGroup || '') === WORK_CATALOG_TARGET.STORE
        && (!record.storeId || sameIdentifier(record.storeId, storeId))
        && !record.deletedAt
      )),
      workCatalogProgress: historicalEmployeeScoped('workCatalogProgress'),
      storeShiftTaskTemplates: state.storeShiftTaskTemplates,
      compensationEntries: ownCompensationEntries,
      violations: ownViolations,
      compensationTeamTotals,
      revenueBonusDaily: filterArray(state, 'revenueBonusDaily', (record) => sameIdentifier(record.storeId, storeId))
        .map(redactRevenueBonusDaily),
      revenueBonusAllocations: filterArray(state, 'revenueBonusAllocations', (record) => (
        sameIdentifier(record.storeId, storeId)
      )),
      teamRewardClaims: filterArray(state, 'teamRewardClaims', (record) => sameIdentifier(record.storeId, storeId)),
      teamRewardParticipants: filterArray(state, 'teamRewardParticipants', (record) => (
        sameIdentifier(record.storeId, storeId)
      )),
      periodReconciliations: filterArray(state, 'periodReconciliations', (record) => sameIdentifier(record.storeId, storeId)),
      jobRuns: filterArray(state, 'jobRuns', (record) => sameIdentifier(record.storeId, storeId)),
      shiftDefinitions: employeeScoped('shiftDefinitions'),
      orders: historicalEmployeeScoped('orders'),
      expenseEntries: historicalEmployeeScoped('expenseEntries'),
      fixedExpenses: historicalEmployeeScoped('fixedExpenses'),
      cashTransactions: historicalEmployeeScoped('cashTransactions'),
      importVouchers: historicalEmployeeScoped('importVouchers'),
      imports: historicalEmployeeScoped('imports'),
      deletedEmployees,
      supportTransfers: filterArray(state, 'supportTransfers', (record) => (
        sameIdentifier(record.fromStoreId, storeId) || sameIdentifier(record.toStoreId, storeId)
      )),
      settings: ownAccountSettings(state, user),
      session: null,
    }
  }

  const requestedStoreId = String(user.store_id || '')
  const requestedEmployeeId = String(user.employee_id || user.user_id || '')
  if (user.role === 'employee' && requestedEmployeeId) {
    const ownEmployee = (Array.isArray(state.employees) ? state.employees : []).find((record) => (
      employeeIdentifierValues(record).some((identifier) => sameIdentifier(identifier, requestedEmployeeId))
    ))
    const employeeId = String(
      ownEmployee?.id || ownEmployee?.code || ownEmployee?.employeeId || requestedEmployeeId,
    )
    const storeId = String(
      (Array.isArray(state.stores) ? state.stores : []).find((record) => (
        sameIdentifier(record.id, requestedStoreId || ownEmployee?.storeId)
      ))?.id
      || ownEmployee?.storeId
      || requestedStoreId,
    )
    const ownUnit = ownEmployee ? employeeUnit(ownEmployee) : 'store'
    const ownCatalogTarget = ownUnit === 'office'
      ? WORK_CATALOG_TARGET.OFFICE
      : WORK_CATALOG_TARGET.STORE
    const own = (key) => filterArray(state, key, (record) => belongsToEmployee(record, employeeId))
    const ownAttendance = own('attendance')
    const ownSupportTransfers = own('supportTransfers')
    const openAttendance = ownAttendance.find((record) => !record.deletedAt && !record.checkOut && !record.checkOutAt)
    const latestAttendance = [...ownAttendance]
      .sort((left, right) => String(right.checkInAt || right.createdAt || '').localeCompare(String(left.checkInAt || left.createdAt || '')))[0]
    const visibleStoreIds = new Set([
      storeId,
      String(user.home_store_id || ''),
      String(openAttendance?.storeId || ''),
    ].map(normalizeIdentifierKey).filter(Boolean))
    const stores = filterArray(state, 'stores', (record) => visibleStoreIds.has(normalizeIdentifierKey(record.id)))
      .map((record) => Object.fromEntries(Object.entries(record).filter(([key]) => (
        !['revenue', 'expense', 'profit', 'cash', 'balance', 'costs'].includes(key)
      ))))
    const taskStoreIds = new Set([storeId, String(openAttendance?.storeId || '')].filter(Boolean))
    const tasks = filterArray(state, 'tasks', (record) => (
      [...taskStoreIds].some((taskStoreId) => taskAppliesToEmployee(record, employeeId, taskStoreId))
    )).map((record) => redactEmployeeReferences(record, new Set([employeeId])))
    const payrollPeriods = (Array.isArray(state.payrollPeriods) ? state.payrollPeriods : []).flatMap((period) => {
      if (period.supersededAt) return []
      const rows = Array.isArray(period.rows)
        ? period.rows.filter((row) => belongsToEmployee(row, employeeId))
        : []
      if (!rows.length) return []
      const { financeSnapshot, kpiSnapshot, closedBy, ...safePeriod } = period
      void financeSnapshot
      void kpiSnapshot
      void closedBy
      return [{ ...safePeriod, rows }]
    })
    return {
      ...common,
      activeStoreId: storeId || null,
      stores,
      employees: filterArray(state, 'employees', (record) => (
        employeeIdentifierValues(record).some((identifier) => sameIdentifier(identifier, employeeId))
      )),
      attendance: ownAttendance,
      schedule: own('schedule'),
      tasks,
      taskAssignmentHistory: own('taskAssignmentHistory')
        .map((record) => redactEmployeeReferences(record, new Set([employeeId]))),
      supportWorkAssignments: own('supportWorkAssignments'),
      supportWorkSchedules: own('supportWorkSchedules'),
      supportTransfers: ownSupportTransfers,
      orders: filterArray(state, 'orders', (record) => orderCreatedByEmployee(record, employeeId)),
      expenseEntries: own('expenseEntries'),
      notifications: filterArray(state, 'notifications', (record) => canAccessNotification(state, user, record))
        .map((record) => projectNotificationForActor(record, user)),
      officeAdjustments: own('officeAdjustments'),
      salaryAdjustments: own('salaryAdjustments'),
      salaryAdvances: own('salaryAdvances'),
      payrollPeriods,
      payrollPayments: own('payrollPayments'),
      storeEmployeeSalaryConfigs: filterArray(state, 'storeEmployeeSalaryConfigs', (record) => (
        !record.deletedAt
        && sameIdentifier(record.employeeId || record.employee_id, employeeId)
        && (!record.storeId || visibleStoreIds.has(normalizeIdentifierKey(record.storeId)))
      )).map((record) => redactEmployeeReferences(record, new Set([employeeId]))),
      workCatalogItems: filterArray(state, 'workCatalogItems', (record) => (
        String(record.targetGroup || '') === ownCatalogTarget
        && (ownCatalogTarget !== WORK_CATALOG_TARGET.STORE
          || !record.storeId
          || visibleStoreIds.has(normalizeIdentifierKey(record.storeId)))
        && !record.deletedAt
      )),
      workCatalogProgress: own('workCatalogProgress'),
      storeShiftTaskTemplates: state.storeShiftTaskTemplates,
      compensationEntries: own('compensationEntries'),
      violations: own('violations'),
      revenueBonusDaily: filterArray(state, 'revenueBonusDaily', (record) => (
        visibleStoreIds.has(normalizeIdentifierKey(record.storeId))
      )).map(redactRevenueBonusDaily),
      revenueBonusAllocations: own('revenueBonusAllocations'),
      teamRewardClaims: filterArray(state, 'teamRewardClaims', (record) => (
        visibleStoreIds.has(normalizeIdentifierKey(record.storeId))
      )),
      teamRewardParticipants: own('teamRewardParticipants'),
      shiftDefinitions: filterArray(state, 'shiftDefinitions', (record) => !record.storeId || sameIdentifier(record.storeId, storeId)),
      settings: ownAccountSettings(state, user),
      activeAttendanceId: openAttendance?.id || null,
      checkedInAt: openAttendance?.checkInAt || openAttendance?.checkIn || null,
      finishedShift: Boolean(!openAttendance && latestAttendance?.checkOutAt),
    }
  }
  return common
}

const requestHash = (value) => sha256(JSON.stringify(canonicalize(value)))

const jsonResponse = (body, status = 200, extraHeaders = {}) => {
  const candidateRequestId = typeof body?.requestId === 'string' ? body.requestId : ''
  const requestId = /^[a-z0-9._:-]{1,160}$/iu.test(candidateRequestId) ? candidateRequestId : ''
  const headers = new Headers({
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    ...(requestId ? { 'X-Request-Id': requestId } : {}),
    ...extraHeaders,
  })
  return new Response(JSON.stringify(body), { status, headers })
}

const apiPayload = (context, body = {}) => ({
  ok: true,
  ...body,
  serverTime: context.now,
  requestId: context.requestId,
})

const readJson = async (request) => {
  const declaredLength = Number(request.headers.get('content-length') || 0)
  if (declaredLength > MAX_JSON_BYTES) throw new ApiError(413, 'PAYLOAD_TOO_LARGE', 'Dữ liệu gửi lên quá lớn.')
  let text = ''
  if (request.body) {
    const reader = request.body.getReader()
    const decoder = new TextDecoder()
    let received = 0
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      received += value.byteLength
      if (received > MAX_JSON_BYTES) {
        await reader.cancel()
        throw new ApiError(413, 'PAYLOAD_TOO_LARGE', 'Dữ liệu gửi lên quá lớn.')
      }
      text += decoder.decode(value, { stream: true })
    }
    text += decoder.decode()
  }
  if (!text.trim()) return {}
  try {
    const parsed = JSON.parse(text)
    if (!isPlainRecord(parsed)) throw new Error('JSON body must be an object')
    return parsed
  } catch {
    throw new ApiError(400, 'INVALID_JSON', 'Dữ liệu JSON không hợp lệ.')
  }
}

const getDatabase = (env) => {
  if (!env?.DB?.prepare || !env?.DB?.batch) {
    throw new ApiError(503, 'DATABASE_UNAVAILABLE', 'Cơ sở dữ liệu chưa được cấu hình.')
  }
  return env.DB
}

const first = (db, sql, ...bindings) => db.prepare(sql).bind(...bindings).first()
const run = (db, sql, ...bindings) => db.prepare(sql).bind(...bindings).run()
const all = async (db, sql, ...bindings) => {
  const result = await db.prepare(sql).bind(...bindings).all()
  return Array.isArray(result?.results) ? result.results : []
}
const changes = (result) => Number(result?.meta?.changes ?? result?.changes ?? 0)

const uniqueUserByEmployeeIdentifier = async (db, employeeId) => {
  const identifier = String(employeeId || '').trim()
  if (!identifier) return null
  const matches = await all(db, `
    SELECT * FROM users
    WHERE LOWER(employee_id) = LOWER(?)
    ORDER BY created_at, id
  `, identifier)
  if (matches.length > 1) {
    throw new ApiError(
      409,
      'AUTH_EMPLOYEE_IDENTIFIER_COLLISION',
      'Có nhiều tài khoản dùng cùng mã nhân viên nhưng khác chữ hoa/thường; cần xử lý dữ liệu tài khoản trước khi tiếp tục.',
      {
        identifier: normalizeIdentifierKey(identifier),
        conflictingUserIds: matches.map((record) => String(record.id || '')),
        conflictingIdentifiers: matches.map((record) => String(record.employee_id || '')),
      },
    )
  }
  return matches[0] || null
}

const sessionTtlSeconds = (env) => {
  const configured = Number(env?.SESSION_TTL_SECONDS || DEFAULT_SESSION_TTL_SECONDS)
  if (!Number.isInteger(configured)) return DEFAULT_SESSION_TTL_SECONDS
  return Math.min(7 * 24 * 60 * 60, Math.max(15 * 60, configured))
}

const addSeconds = (isoTimestamp, seconds) => new Date(Date.parse(isoTimestamp) + seconds * 1000).toISOString()

const roleOptionKey = (option = {}) => [
  option.role,
  String(option.storeId || '').trim(),
  String(option.employeeId || '').trim(),
].join(':')

const matchingSessionRoleOption = (options, { role, storeId = '', employeeId = '' } = {}) => {
  const requestedRole = String(role || '').trim()
  const requestedStoreId = String(storeId || '').trim()
  const requestedEmployeeId = String(employeeId || '').trim()
  const candidates = (Array.isArray(options) ? options : []).filter((option) => (
    option.role === requestedRole
    && (!requestedStoreId || sameIdentifier(option.storeId, requestedStoreId))
    && (!requestedEmployeeId || sameIdentifier(option.employeeId, requestedEmployeeId))
  ))
  if (candidates.length <= 1) return candidates[0] || null
  const exactCandidates = candidates.filter((option) => (
    (!requestedStoreId || String(option.storeId || '').trim() === requestedStoreId)
    && (!requestedEmployeeId || String(option.employeeId || '').trim() === requestedEmployeeId)
  ))
  return exactCandidates.length === 1 ? exactCandidates[0] : null
}

const availableRoleOptionsForUser = async (db, user, preloadedState = null) => {
  if (user.role === 'admin') {
    return [{ role: 'admin', storeId: null, employeeId: user.employee_id || null, label: 'Admin' }]
  }
  const uniqueAuthUser = await uniqueUserByEmployeeIdentifier(db, user.employee_id)
  if (uniqueAuthUser && String(uniqueAuthUser.id || '') !== String(user.user_id || user.id || '')) {
    throw new ApiError(
      409,
      'AUTH_EMPLOYEE_IDENTIFIER_COLLISION',
      'Mã nhân viên của tài khoản không còn liên kết duy nhất; cần xử lý dữ liệu tài khoản trước khi tiếp tục.',
    )
  }
  const state = preloadedState == null
    ? normalizeSharedStateForStorage(parseStoredJson((await loadState(db, 'global'))?.value_json, {}))
    : normalizeSharedStateForStorage(preloadedState)
  assertNoCaseCollidingOperationalIdentifiers(state)
  const employees = Array.isArray(state.employees) ? state.employees : []
  const stores = Array.isArray(state.stores) ? state.stores : []
  const activeProfiles = employees.filter((profile) => (
    !profile.deletedAt && !['da nghi viec', 'inactive'].includes(normalizeTextKey(profile.status))
  ))
  const userId = String(user.user_id || user.id || '')
  const baseEmployeeId = String(user.employee_id || '')
  const linkedToUser = (profile) => (
    String(profile.authUserId || '') === userId
    || (baseEmployeeId && sameIdentifier(profile.linkedEmployeeId, baseEmployeeId))
  )
  const options = []
  const add = (option) => {
    if (!option?.role) return
    const rawEmployeeId = String(option.employeeId || '').trim()
    const employee = rawEmployeeId
      ? uniqueEmployeeIdentifierRecordMatch({
          records: activeProfiles,
          identifier: rawEmployeeId,
          collisionCode: 'SESSION_EMPLOYEE_IDENTIFIER_COLLISION',
          collisionMessage: 'Mã nhân viên của vai trò phiên đăng nhập đang trùng.',
        })?.record || null
      : null
    const rawStoreId = String(option.storeId || '').trim()
    const virtualStoreId = sameIdentifier(rawStoreId, OFFICE_STORE_ID)
      ? OFFICE_STORE_ID
      : sameIdentifier(rawStoreId, BUSINESS_SUPPORT_STORE_ID)
        ? BUSINESS_SUPPORT_STORE_ID
        : ''
    const store = rawStoreId && !virtualStoreId
      ? uniqueIdentifierRecordMatch({
          records: stores,
          identifier: rawStoreId,
          predicate: (record) => !record?.deletedAt,
          collisionCode: 'SESSION_STORE_IDENTIFIER_COLLISION',
          collisionMessage: 'Mã cửa hàng của vai trò phiên đăng nhập đang trùng.',
        })?.record || null
      : null
    const canonical = {
      ...option,
      storeId: virtualStoreId || String(store?.id || rawStoreId || '').trim() || null,
      employeeId: employeeProfileIdentifier(employee) || rawEmployeeId || null,
    }
    if (options.some((current) => roleOptionKey(current) === roleOptionKey(canonical))) return
    options.push(canonical)
  }
  const rootProfile = uniqueEmployeeIdentifierRecordMatch({
    records: activeProfiles,
    identifier: baseEmployeeId,
    collisionCode: 'SESSION_EMPLOYEE_IDENTIFIER_COLLISION',
    collisionMessage: 'Mã nhân viên gốc của phiên đăng nhập đang trùng.',
  })?.record || null
  const linkedManagerProfiles = activeProfiles.filter((profile) => employeeUnit(profile) === 'store_manager' && linkedToUser(profile))
  const linkedStoreProfiles = activeProfiles.filter((profile) => employeeUnit(profile) === 'store' && linkedToUser(profile))

  // Legacy promotions changed the account's base role to store_manager. Recover
  // the original profile role so the same login can still enter Employee/HTKD.
  if (user.role === 'store_manager' && linkedManagerProfiles.length) {
    const sourceId = String(linkedManagerProfiles[0].linkedEmployeeId || '')
    const source = uniqueEmployeeIdentifierRecordMatch({
      records: activeProfiles,
      identifier: sourceId,
      collisionCode: 'SESSION_LINKED_EMPLOYEE_COLLISION',
      collisionMessage: 'Hồ sơ nhân viên liên kết của vai trò đang trùng.',
    })?.record || null
    if (employeeUnit(source) === 'business_support') {
      add({ role: 'business_support', storeId: BUSINESS_SUPPORT_STORE_ID, employeeId: sourceId, label: 'Hỗ trợ KD' })
    } else if (source) {
      add({ role: 'employee', storeId: source.storeId || user.store_id || null, employeeId: sourceId, label: 'Nhân viên' })
    }
  } else if (user.role === 'business_support') {
    add({ role: 'business_support', storeId: BUSINESS_SUPPORT_STORE_ID, employeeId: baseEmployeeId || rootProfile?.id || null, label: 'Hỗ trợ KD' })
  } else if (user.role === 'employee') {
    add({ role: 'employee', storeId: rootProfile?.storeId || user.store_id || null, employeeId: baseEmployeeId || rootProfile?.id || null, label: employeeUnit(rootProfile) === 'office' ? 'Nhân viên văn phòng' : 'Nhân viên' })
  } else if (user.role === 'store_manager') {
    add({ role: 'store_manager', storeId: rootProfile?.storeId || user.store_id || null, employeeId: baseEmployeeId || rootProfile?.id || null, label: 'Quản lý CH' })
  }

  linkedManagerProfiles.forEach((profile) => add({
    role: 'store_manager',
    storeId: profile.storeId || null,
    employeeId: profile.id || profile.code || null,
    label: 'Quản lý CH',
    profileName: profile.name || '',
  }))
  linkedStoreProfiles.forEach((profile) => add({
    role: 'employee',
    storeId: profile.storeId || null,
    employeeId: profile.id || profile.code || null,
    label: 'Nhân viên cửa hàng',
    profileName: profile.name || '',
  }))
  if (!options.length) {
    add({ role: user.role, storeId: user.store_id || null, employeeId: user.employee_id || null, label: user.role })
  }
  const order = { store_manager: 0, employee: 1, business_support: 2, admin: 3 }
  return options.sort((left, right) => (order[left.role] ?? 9) - (order[right.role] ?? 9))
}

const resolveSessionRole = async (db, session, preloadedState = null) => {
  const options = await availableRoleOptionsForUser(db, session, preloadedState)
  const selected = matchingSessionRoleOption(options, {
    role: session.active_role,
    storeId: session.active_store_id,
    employeeId: session.active_employee_id,
  })
  const base = options.find((option) => option.role === session.role) || options[0]
  const effective = selected || base
  return {
    ...session,
    role: effective.role,
    store_id: effective.storeId || null,
    employee_id: effective.employeeId || null,
    available_roles: options,
    needs_role_selection: options.length > 1 && (!session.role_selected_at || !selected),
  }
}

const publicUser = (user) => ({
  id: user.user_id || user.id,
  username: user.username,
  displayName: user.display_name,
  role: user.role,
  storeId: user.store_id || null,
  employeeId: user.employee_id || null,
  status: user.status,
  version: Number(user.version || 1),
  lastLoginAt: user.last_login_at || null,
  ...(user.home_store_id ? { homeStoreId: user.home_store_id } : {}),
  ...(user.active_transfer_id ? { activeTransferId: user.active_transfer_id } : {}),
  ...(Array.isArray(user.available_roles) ? { availableRoles: user.available_roles } : {}),
  ...(user.needs_role_selection ? { needsRoleSelection: true } : {}),
})

const bearerToken = (request) => {
  const match = request.headers.get('authorization')?.match(/^Bearer\s+([^\s]+)$/iu)
  return match?.[1] || null
}

const requireSession = async (request, db, context, { resolveOperationalContext = true } = {}) => {
  const token = bearerToken(request)
  if (!token || token.length < 32 || token.length > 512) {
    throw new ApiError(401, 'AUTH_REQUIRED', 'Vui lòng đăng nhập để tiếp tục.')
  }
  const tokenHash = await sha256(token)
  const session = await first(db, `
    SELECT
      s.id AS session_id,
      s.token_hash,
      s.expires_at,
      s.active_role,
      s.active_store_id,
      s.active_employee_id,
      s.role_selected_at,
      s.last_seen_at,
      u.id AS user_id,
      u.username,
      u.display_name,
      u.role,
      u.store_id,
      u.employee_id,
      u.status,
      u.version,
      u.last_login_at
    FROM sessions AS s
    INNER JOIN users AS u ON u.id = s.user_id
    WHERE s.token_hash = ?
      AND s.revoked_at IS NULL
      AND s.expires_at > ?
      AND u.status = 'active'
    LIMIT 1
  `, tokenHash, context.now)
  if (!session) throw new ApiError(401, 'SESSION_INVALID', 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn.')
  const lastSeenAt = Date.parse(String(session.last_seen_at || ''))
  if (!Number.isFinite(lastSeenAt) || Date.parse(context.now) - lastSeenAt >= 60_000) {
    await run(db, 'UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?', context.now, tokenHash)
  }
  if (!resolveOperationalContext) return session

  let globalStateRow = null
  let globalState = null
  if (session.role !== 'admin') {
    globalStateRow = await loadState(db, 'global')
    globalState = parseStoredJson(globalStateRow?.value_json, {})
  }
  const assumed = await resolveSessionRole(db, session, globalState)
  const effective = await resolveEffectiveEmployeeStore(db, assumed, context.now, globalState)
  if (globalStateRow) {
    Object.defineProperty(effective, '_globalStateRow', { value: globalStateRow, enumerable: false })
    Object.defineProperty(effective, '_globalState', { value: globalState, enumerable: false })
  }
  return effective
}

const activeSupportTransferFor = (state, employeeId, at) => (Array.isArray(state.supportTransfers)
  ? state.supportTransfers
  : [])
  .filter((record) => (
    sameIdentifier(record.employeeId, employeeId)
    && supportTransferMatchesTime(record, at)
  ))
  .sort((left, right) => String(right.createdAt || '').localeCompare(String(left.createdAt || '')))[0] || null

const supportTransferToStoreOnDate = (state, employeeId, storeId, at) => (Array.isArray(state.supportTransfers)
  ? state.supportTransfers
  : [])
  .filter((record) => (
    sameIdentifier(record.employeeId, employeeId)
    && sameIdentifier(record.toStoreId, storeId)
    && supportTransferMatchesTime(record, at)
  ))
  .sort((left, right) => String(right.createdAt || '').localeCompare(String(left.createdAt || '')))[0] || null

const employeeWorksAtStoreOnDate = (state, employee, storeId, date) => (
  sameIdentifier(employee?.storeId, storeId)
  || Boolean(supportTransferToStoreOnDate(
    state,
    String(employee?.id || employee?.code || ''),
    storeId,
    date,
  ))
)

const resolveEffectiveEmployeeStore = async (db, user, now, preloadedState = null) => {
  if (user?.role !== 'employee' || !user?.employee_id) return user
  const state = preloadedState == null
    ? parseStoredJson((await loadState(db, 'global'))?.value_json, {})
    : preloadedState
  const transfer = activeSupportTransferFor(state, user.employee_id, now)
  if (!transfer?.toStoreId) return user
  return {
    ...user,
    home_store_id: user.store_id || transfer.fromStoreId || null,
    store_id: String(transfer.toStoreId),
    active_transfer_id: String(transfer.id || ''),
  }
}

const validScope = (scope) => /^(?:global|store:[A-Za-z0-9_-]{1,80}|employee:[A-Za-z0-9_-]{1,80})$/u.test(String(scope || ''))

const defaultScope = (user) => {
  if (VALID_ROLES.has(user.role)) return 'global'
  throw new ApiError(403, 'SCOPE_UNAVAILABLE', 'Tài khoản chưa được gán phạm vi dữ liệu.')
}

export const canReadScope = (user, scope) => {
  if (!validScope(scope)) return false
  if (scope === 'global' && VALID_ROLES.has(user.role)) return true
  if (user.role === 'admin') return true
  if (user.role === 'business_support') return scope === 'global'
  if (user.role === 'store_manager') return scope === `store:${user.store_id}`
  if (user.role === 'employee') return scope === `employee:${user.employee_id || user.user_id}`
  return false
}

export const canWriteScope = (user, scope) => user.role === 'admin' && validScope(scope)

export const canUseCounter = (user, name) => {
  const counterName = String(name || '')
  if (!/^[A-Za-z0-9:_-]{3,120}$/u.test(counterName)) return false
  return user.role === 'admin'
}

const assertScope = (user, scope, write = false) => {
  const allowed = write ? canWriteScope(user, scope) : canReadScope(user, scope)
  if (!allowed) throw new ApiError(403, 'SCOPE_FORBIDDEN', 'Bạn không có quyền truy cập phạm vi dữ liệu này.')
}

const validateExpectedVersion = (value) => {
  const version = Number(value)
  if (!Number.isInteger(version) || version < 0) {
    throw new ApiError(400, 'INVALID_VERSION', 'Phiên bản dữ liệu mong đợi phải là số nguyên không âm.')
  }
  return version
}

const commandExpectedVersion = (body) => validateExpectedVersion(
  body?._expectedGlobalStateVersion ?? body?.expectedVersion,
)

const validateIdempotencyKey = (request, body) => {
  const value = String(request.headers.get('idempotency-key') || body.idempotencyKey || '').trim()
  if (!/^[A-Za-z0-9._:-]{8,160}$/u.test(value)) {
    throw new ApiError(400, 'INVALID_IDEMPOTENCY_KEY', 'Mỗi lệnh ghi cần khóa chống gửi trùng hợp lệ.')
  }
  return value
}

const jsonByteLength = (value) => textEncoder.encode(String(value)).byteLength

const splitUtf8String = (value, maximumBytes) => {
  const source = String(value)
  const encoded = textEncoder.encode(source)
  if (encoded.byteLength <= maximumBytes) return [source]
  const decoder = new TextDecoder('utf-8', { fatal: true })
  const chunks = []
  let start = 0
  while (start < encoded.byteLength) {
    let end = Math.min(encoded.byteLength, start + maximumBytes)
    while (end < encoded.byteLength && end > start && (encoded[end] & 0xC0) === 0x80) end -= 1
    if (end <= start) throw new ApiError(500, 'JSON_CHUNK_FAILED', 'Không thể chia nhỏ dữ liệu JSON an toàn.')
    chunks.push(decoder.decode(encoded.subarray(start, end)))
    start = end
  }
  return chunks
}

const loadReceipt = async (db, actorId, idempotencyKey) => {
  const receipt = await first(db, `
    SELECT request_hash, response_json, status_code
    FROM command_receipts
    WHERE actor_id = ? AND idempotency_key = ?
    LIMIT 1
  `, actorId, idempotencyKey)
  if (!receipt) return null
  const marker = parseStoredJson(receipt.response_json, null)
  if (marker?.__idosiChunkedResponse !== 1) return receipt
  const chunkCount = Number(marker.chunkCount)
  if (!Number.isSafeInteger(chunkCount) || chunkCount < 1 || chunkCount > 10_000) {
    throw new ApiError(500, 'RECEIPT_CORRUPT', 'Manifest biên nhận chống gửi trùng không hợp lệ.')
  }
  const rows = []
  for (let index = 0; index < chunkCount; index += 1) {
    const chunk = await first(db, `
      SELECT chunk_index, chunk_text, chunk_bytes
      FROM command_receipt_chunks
      WHERE actor_id = ? AND idempotency_key = ? AND chunk_index = ?
      LIMIT 1
    `, actorId, idempotencyKey, index)
    if (!chunk) throw new ApiError(500, 'RECEIPT_CORRUPT', 'Biên nhận chống gửi trùng không đầy đủ.')
    rows.push(chunk)
  }
  const responseJson = rows.map((row) => String(row.chunk_text)).join('')
  const valid = rows.length === chunkCount
    && rows.every((row, index) => Number(row.chunk_index) === index
      && jsonByteLength(row.chunk_text) === Number(row.chunk_bytes))
    && jsonByteLength(responseJson) === Number(marker.byteLength)
  if (!valid) throw new ApiError(500, 'RECEIPT_CORRUPT', 'Biên nhận chống gửi trùng không đầy đủ.')
  return { ...receipt, response_json: responseJson }
}

const replayReceipt = (receipt, hash) => {
  if (!receipt) return null
  if (!constantTimeEqual(receipt.request_hash, hash)) {
    throw new ApiError(409, 'IDEMPOTENCY_KEY_REUSED', 'Khóa chống gửi trùng đã được dùng cho một lệnh khác.')
  }
  return new Response(receipt.response_json, {
    status: Number(receipt.status_code) || 200,
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json; charset=utf-8',
      'Idempotency-Replayed': 'true',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}

const stateEntityIdentity = (value, serialized) => {
  if (isPlainRecord(value)) {
    for (const key of ['id', 'notificationId']) {
      const candidate = String(value[key] || '').trim()
      if (candidate) return `${key}:${candidate}`
    }
  }
  return `value:${serialized}`
}

const loadStateEntityRows = async (db, scope) => {
  const rows = []
  let cursor = null
  let metadataBuffer = []
  let metadataExhausted = false
  while (true) {
    if (!metadataBuffer.length) {
      if (metadataExhausted) break
      metadataBuffer = cursor
        ? await all(db, `
            SELECT collection_key, entity_key, entity_order, value_bytes
            FROM state_entities
            WHERE scope_key = ? AND (
              collection_key > ?
              OR (collection_key = ? AND entity_order > ?)
              OR (collection_key = ? AND entity_order = ? AND entity_key > ?)
            )
            ORDER BY collection_key, entity_order, entity_key
            LIMIT ${STATE_ENTITY_PAGE_SIZE}
          `, scope, cursor.collectionKey, cursor.collectionKey, cursor.entityOrder,
          cursor.collectionKey, cursor.entityOrder, cursor.entityKey)
        : await all(db, `
            SELECT collection_key, entity_key, entity_order, value_bytes
            FROM state_entities
            WHERE scope_key = ?
            ORDER BY collection_key, entity_order, entity_key
            LIMIT ${STATE_ENTITY_PAGE_SIZE}
          `, scope)
      if (!metadataBuffer.length) break
      metadataExhausted = metadataBuffer.length < STATE_ENTITY_PAGE_SIZE
    }
    let pageCount = 0
    let estimatedBytes = 0
    for (const metadata of metadataBuffer) {
      const rowBytes = Number(metadata.value_bytes)
        + jsonByteLength(metadata.collection_key)
        + jsonByteLength(metadata.entity_key)
        + 256
      if (pageCount > 0 && estimatedBytes + rowBytes > MAX_STATE_BATCH_JSON_BYTES) break
      pageCount += 1
      estimatedBytes += rowBytes
    }
    const page = cursor
      ? await all(db, `
          SELECT collection_key, entity_key, entity_order, value_json, value_bytes, created_at, updated_at
          FROM state_entities
          WHERE scope_key = ? AND (
            collection_key > ?
            OR (collection_key = ? AND entity_order > ?)
            OR (collection_key = ? AND entity_order = ? AND entity_key > ?)
          )
          ORDER BY collection_key, entity_order, entity_key
          LIMIT ${pageCount}
        `, scope, cursor.collectionKey, cursor.collectionKey, cursor.entityOrder,
        cursor.collectionKey, cursor.entityOrder, cursor.entityKey)
      : await all(db, `
          SELECT collection_key, entity_key, entity_order, value_json, value_bytes, created_at, updated_at
          FROM state_entities
          WHERE scope_key = ?
          ORDER BY collection_key, entity_order, entity_key
          LIMIT ${pageCount}
        `, scope)
    if (page.length !== pageCount) {
      throw new ApiError(409, 'STATE_SNAPSHOT_CHANGED', 'Trạng thái thay đổi trong khi đang đọc.')
    }
    rows.push(...page)
    metadataBuffer = metadataBuffer.slice(pageCount)
    const last = page.at(-1)
    cursor = {
      collectionKey: String(last.collection_key),
      entityOrder: Number(last.entity_order),
      entityKey: String(last.entity_key),
    }
  }
  return rows
}

const hydrateStateSnapshot = (row, manifests = [], entities = []) => {
  if (!row) {
    if (manifests.length || entities.length) {
      throw new ApiError(500, 'STATE_ENTITY_ORPHANED', 'Bản ghi trạng thái không có trạng thái cha.')
    }
    return null
  }
  if (!manifests.length) {
    if (entities.length) {
      throw new ApiError(500, 'STATE_ENTITY_ORPHANED', 'Bản ghi trạng thái không có danh mục cha.')
    }
    return row
  }
  const hydrated = parseStoredJson(row.value_json, null)
  if (!isPlainRecord(hydrated)) throw new ApiError(500, 'STATE_CORRUPT', 'Trạng thái lưu trữ không hợp lệ.')
  const metadata = new Map(manifests.map((manifest) => [String(manifest.collection_key), {
    createdAt: manifest.created_at,
    updatedAt: manifest.updated_at,
    rows: [],
  }]))
  for (const key of metadata.keys()) hydrated[key] = []
  for (const entity of entities) {
    const collectionKey = String(entity.collection_key)
    const collection = metadata.get(collectionKey)
    if (!collection) throw new ApiError(500, 'STATE_ENTITY_ORPHANED', 'Bản ghi trạng thái không có danh mục cha.')
    const serialized = String(entity.value_json)
    if (jsonByteLength(serialized) !== Number(entity.value_bytes)
      || Number(entity.value_bytes) > MAX_STATE_ENTITY_BYTES) {
      throw new ApiError(500, 'STATE_ENTITY_CORRUPT', 'Kích thước bản ghi trạng thái không hợp lệ.')
    }
    const value = parseStoredJson(serialized, undefined)
    if (value === undefined && serialized !== 'null') {
      throw new ApiError(500, 'STATE_ENTITY_CORRUPT', 'Bản ghi trạng thái không phải JSON hợp lệ.')
    }
    hydrated[collectionKey].push(value)
    collection.rows.push({
      entityKey: String(entity.entity_key),
      entityOrder: Number(entity.entity_order),
      valueJson: serialized,
      identity: stateEntityIdentity(value, serialized),
      createdAt: entity.created_at,
      updatedAt: entity.updated_at,
    })
  }
  row.value_json = JSON.stringify(hydrated)
  Object.defineProperty(row, '_externalCollections', { value: metadata, enumerable: false })
  return row
}

const loadStateSnapshot = async (db, scope) => {
  const row = await first(db, `
    SELECT scope_key, value_json, version, updated_at, updated_by, last_request_id
    FROM app_state
    WHERE scope_key = ?
    LIMIT 1
  `, scope)
  if (!row) return null
  const manifests = await all(db, `
    SELECT collection_key, created_at, updated_at
    FROM state_collections
    WHERE scope_key = ?
    ORDER BY collection_key
  `, scope)
  if (!manifests.length) return row
  return hydrateStateSnapshot(row, manifests, await loadStateEntityRows(db, scope))
}

const cloneStateSnapshotRow = (row) => {
  if (!row) return null
  const clone = { ...row }
  if (row._externalCollections instanceof Map) {
    const metadata = new Map([...row._externalCollections].map(([key, collection]) => [key, {
      ...collection,
      rows: collection.rows.map((entity) => ({ ...entity })),
    }]))
    Object.defineProperty(clone, '_externalCollections', { value: metadata, enumerable: false })
  }
  return clone
}

const stateSnapshotCacheBytes = (row) => {
  let bytes = jsonByteLength(row?.value_json || '') + 512
  if (!(row?._externalCollections instanceof Map)) return bytes
  for (const [collectionKey, collection] of row._externalCollections) {
    bytes += jsonByteLength(collectionKey)
      + jsonByteLength(collection.createdAt || '')
      + jsonByteLength(collection.updatedAt || '')
      + 256
    for (const entity of collection.rows) {
      bytes += jsonByteLength(entity.entityKey)
        + jsonByteLength(entity.valueJson)
        + jsonByteLength(entity.identity)
        + jsonByteLength(entity.createdAt || '')
        + jsonByteLength(entity.updatedAt || '')
        + 256
      if (bytes > MAX_GLOBAL_STATE_SNAPSHOT_CACHE_BYTES) return bytes
    }
  }
  return bytes
}

const loadOptimizedStateSnapshot = async (db, scope) => {
  const cached = scope === 'global' ? globalStateSnapshotCaches.get(db) : null
  const snapshot = await db.readStateSnapshot(scope, cached ? {
    version: cached.version,
    lastRequestId: cached.lastRequestId,
  } : null)
  if (snapshot?.unchanged === true) {
    if (!cached) throw new ApiError(500, 'STATE_SNAPSHOT_INVALID', 'SQLite báo cache hit khi chưa có snapshot phù hợp.')
    return cloneStateSnapshotRow(cached.row)
  }
  if (scope === 'global') globalStateSnapshotCaches.delete(db)
  if (snapshot?.unchanged !== false
    || !Array.isArray(snapshot.manifests)
    || !Array.isArray(snapshot.entities)) {
    throw new ApiError(500, 'STATE_SNAPSHOT_INVALID', 'SQLite không trả về snapshot trạng thái hợp lệ.')
  }
  const row = hydrateStateSnapshot(snapshot.row, snapshot.manifests, snapshot.entities)
  if (scope !== 'global') return row
  if (!row) return null
  const estimatedBytes = stateSnapshotCacheBytes(row)
  if (estimatedBytes > MAX_GLOBAL_STATE_SNAPSHOT_CACHE_BYTES) return row
  globalStateSnapshotCaches.set(db, {
    version: Number(row.version),
    lastRequestId: String(row.last_request_id || ''),
    estimatedBytes,
    row,
  })
  return cloneStateSnapshotRow(row)
}

const loadState = async (db, scope) => {
  if (typeof db?.readStateSnapshot === 'function') return loadOptimizedStateSnapshot(db, scope)
  for (let attempt = 0; attempt < 3; attempt += 1) {
    let row
    try {
      row = await loadStateSnapshot(db, scope)
    } catch (error) {
      if (error instanceof ApiError
        && ['STATE_SNAPSHOT_CHANGED', 'STATE_ENTITY_ORPHANED'].includes(error.code)) continue
      throw error
    }
    if (!row || !(row._externalCollections instanceof Map)) return row
    const latest = await first(db, `
      SELECT version, last_request_id FROM app_state WHERE scope_key = ? LIMIT 1
    `, scope)
    if (latest
      && Number(latest.version) === Number(row.version)
      && String(latest.last_request_id || '') === String(row.last_request_id || '')) return row
  }
  throw new ApiError(409, 'STATE_READ_CONFLICT', 'Trạng thái đang được cập nhật; vui lòng thử lại.')
}

const assignStateEntityOrders = (descriptors) => {
  const anchors = descriptors
    .map((descriptor, index) => descriptor.match ? { index, order: descriptor.match.entityOrder } : null)
    .filter(Boolean)
  const monotonic = anchors.every((anchor, index) => (
    Number.isSafeInteger(anchor.order)
    && (index === 0 || anchor.order > anchors[index - 1].order)
  ))
  const reindex = () => descriptors.forEach((descriptor, index) => {
    descriptor.entityOrder = (index + 1) * STATE_ENTITY_ORDER_STEP
  })
  if (!anchors.length || !monotonic) {
    reindex()
    return
  }
  for (const anchor of anchors) descriptors[anchor.index].entityOrder = anchor.order
  let previousIndex = -1
  let previousOrder = null
  for (const anchor of anchors) {
    const count = anchor.index - previousIndex - 1
    if (count > 0) {
      if (previousOrder === null) {
        const start = anchor.order - count
        if (!Number.isSafeInteger(start)) return reindex()
        for (let offset = 0; offset < count; offset += 1) {
          descriptors[previousIndex + 1 + offset].entityOrder = start + offset
        }
      } else {
        const gap = anchor.order - previousOrder - 1
        if (gap < count) return reindex()
        let lastAssigned = previousOrder
        for (let offset = 0; offset < count; offset += 1) {
          const order = previousOrder + Math.floor(((anchor.order - previousOrder) * (offset + 1)) / (count + 1))
          if (!Number.isSafeInteger(order) || order <= lastAssigned || order >= anchor.order) return reindex()
          descriptors[previousIndex + 1 + offset].entityOrder = order
          lastAssigned = order
        }
      }
    }
    previousIndex = anchor.index
    previousOrder = anchor.order
  }
  for (let index = previousIndex + 1; index < descriptors.length; index += 1) {
    const order = previousOrder + ((index - previousIndex) * STATE_ENTITY_ORDER_STEP)
    if (!Number.isSafeInteger(order)) return reindex()
    descriptors[index].entityOrder = order
  }
}

const packJsonArrayPayloads = (items, maximumBytes = MAX_STATE_BATCH_JSON_BYTES) => {
  const payloads = []
  const oversized = []
  let parts = []
  let bytes = 2
  const flush = () => {
    if (!parts.length) return
    payloads.push(`[${parts.join(',')}]`)
    parts = []
    bytes = 2
  }
  for (const item of items) {
    const serialized = JSON.stringify(item)
    const itemBytes = jsonByteLength(serialized) + (parts.length ? 1 : 0)
    if (itemBytes + 2 > maximumBytes) {
      flush()
      oversized.push(item)
      continue
    }
    if (bytes + itemBytes > maximumBytes) flush()
    parts.push(serialized)
    bytes += jsonByteLength(serialized) + (parts.length > 1 ? 1 : 0)
  }
  flush()
  return { payloads, oversized }
}

const prepareStatePersistencePlan = (current, nextState, now) => {
  if (containsEmbeddedImageData(nextState)) {
    throw new ApiError(400, 'EMBEDDED_IMAGE_STATE_FORBIDDEN', 'Ảnh riêng tư phải được lưu trong kho ảnh; trạng thái chỉ được chứa metadata.')
  }
  const compactState = {}
  const nextCollections = new Map()
  for (const [key, value] of Object.entries(nextState)) {
    if (Array.isArray(value)) nextCollections.set(key, value)
    else compactState[key] = value
  }
  const compactJson = JSON.stringify(compactState)
  if (jsonByteLength(compactJson) > MAX_COMPACT_STATE_BYTES) {
    throw new ApiError(413, 'STATE_SHELL_TOO_LARGE', 'Phần cấu hình trạng thái vượt giới hạn an toàn của D1.')
  }

  const existingCollections = current?._externalCollections instanceof Map
    ? current._externalCollections
    : new Map()
  const manifestCreates = []
  const manifestDeletes = []
  const entityUpserts = []
  const entityDeletes = []
  const collectionClears = []

  for (const key of nextCollections.keys()) {
    if (key.length > 512) throw new ApiError(400, 'STATE_COLLECTION_KEY_INVALID', 'Tên danh mục trạng thái quá dài.')
    if (!existingCollections.has(key)) manifestCreates.push(key)
  }
  for (const key of existingCollections.keys()) {
    if (!nextCollections.has(key)) manifestDeletes.push(key)
  }

  for (const [collectionKey, values] of nextCollections) {
    const existingRows = existingCollections.get(collectionKey)?.rows || []
    const queues = new Map()
    for (const row of existingRows) {
      const identity = row.identity ?? stateEntityIdentity(row.value, row.valueJson)
      if (!queues.has(identity)) queues.set(identity, [])
      queues.get(identity).push(row)
    }
    const usedKeys = new Set()
    const descriptors = values.map((value) => {
      const valueJson = JSON.stringify(value) ?? 'null'
      const valueBytes = jsonByteLength(valueJson)
      if (valueBytes > MAX_STATE_ENTITY_BYTES) {
        throw new ApiError(413, 'STATE_ENTITY_TOO_LARGE', `Bản ghi trong ${collectionKey} vượt giới hạn an toàn của D1.`)
      }
      const identity = stateEntityIdentity(value, valueJson)
      const match = queues.get(identity)?.shift() || null
      if (match) usedKeys.add(match.entityKey)
      return { valueJson, valueBytes, match }
    })
    assignStateEntityOrders(descriptors)
    if (existingRows.length && usedKeys.size === 0) {
      collectionClears.push(collectionKey)
    } else {
      for (const row of existingRows) {
        if (!usedKeys.has(row.entityKey)) entityDeletes.push({ collectionKey, entityKey: row.entityKey })
      }
    }
    for (const descriptor of descriptors) {
      const entityKey = descriptor.match?.entityKey || `ent_${crypto.randomUUID()}`
      if (!descriptor.match
        || descriptor.match.valueJson !== descriptor.valueJson
        || descriptor.match.entityOrder !== descriptor.entityOrder) {
        entityUpserts.push({
          collectionKey,
          entityKey,
          entityOrder: descriptor.entityOrder,
          recordJson: descriptor.valueJson,
          valueBytes: descriptor.valueBytes,
          createdAt: descriptor.match?.createdAt || now,
        })
      }
    }
  }
  return {
    compactJson,
    manifestCreates,
    manifestDeletes,
    collectionClears,
    entityUpserts,
    entityDeletes,
  }
}

const stateSuccessSql = `
  SELECT 1 FROM app_state
  WHERE scope_key = ? AND version = ? AND last_request_id = ?
`

const statePersistenceStatements = (db, scope, plan, nextVersion, requestId, now) => {
  const statements = []
  for (const payload of packJsonArrayPayloads(plan.manifestCreates).payloads) {
    statements.push(db.prepare(`
      INSERT INTO state_collections (scope_key, collection_key, created_at, updated_at)
      SELECT ?, CAST(entry.value AS TEXT), ?, ?
      FROM json_each(?) AS entry
      WHERE EXISTS (${stateSuccessSql})
      ON CONFLICT(scope_key, collection_key) DO UPDATE SET updated_at = excluded.updated_at
    `).bind(scope, now, now, payload, scope, nextVersion, requestId))
  }
  for (const payload of packJsonArrayPayloads(plan.collectionClears).payloads) {
    statements.push(db.prepare(`
      DELETE FROM state_entities
      WHERE scope_key = ?
        AND EXISTS (${stateSuccessSql})
        AND collection_key IN (SELECT CAST(value AS TEXT) FROM json_each(?))
    `).bind(scope, scope, nextVersion, requestId, payload))
  }
  for (const payload of packJsonArrayPayloads(plan.entityDeletes).payloads) {
    statements.push(db.prepare(`
      DELETE FROM state_entities
      WHERE scope_key = ?
        AND EXISTS (${stateSuccessSql})
        AND EXISTS (
          SELECT 1 FROM json_each(?) AS entry
          WHERE json_extract(entry.value, '$.collectionKey') = state_entities.collection_key
            AND json_extract(entry.value, '$.entityKey') = state_entities.entity_key
        )
    `).bind(scope, scope, nextVersion, requestId, payload))
  }
  const packedUpserts = packJsonArrayPayloads(plan.entityUpserts)
  for (const payload of packedUpserts.payloads) {
    statements.push(db.prepare(`
      INSERT INTO state_entities (
        scope_key, collection_key, entity_key, entity_order, value_json, value_bytes, created_at, updated_at
      )
      SELECT
        ?,
        json_extract(entry.value, '$.collectionKey'),
        json_extract(entry.value, '$.entityKey'),
        json_extract(entry.value, '$.entityOrder'),
        json_extract(entry.value, '$.recordJson'),
        json_extract(entry.value, '$.valueBytes'),
        json_extract(entry.value, '$.createdAt'),
        ?
      FROM json_each(?) AS entry
      WHERE EXISTS (${stateSuccessSql})
      ON CONFLICT(scope_key, collection_key, entity_key) DO UPDATE SET
        entity_order = excluded.entity_order,
        value_json = excluded.value_json,
        value_bytes = excluded.value_bytes,
        updated_at = excluded.updated_at
    `).bind(scope, now, payload, scope, nextVersion, requestId))
  }
  for (const item of packedUpserts.oversized) {
    statements.push(db.prepare(`
      INSERT INTO state_entities (
        scope_key, collection_key, entity_key, entity_order, value_json, value_bytes, created_at, updated_at
      )
      SELECT ?, ?, ?, ?, ?, ?, ?, ?
      WHERE EXISTS (${stateSuccessSql})
      ON CONFLICT(scope_key, collection_key, entity_key) DO UPDATE SET
        entity_order = excluded.entity_order,
        value_json = excluded.value_json,
        value_bytes = excluded.value_bytes,
        updated_at = excluded.updated_at
    `).bind(
      scope,
      item.collectionKey,
      item.entityKey,
      item.entityOrder,
      item.recordJson,
      item.valueBytes,
      item.createdAt,
      now,
      scope,
      nextVersion,
      requestId,
    ))
  }
  for (const payload of packJsonArrayPayloads(plan.manifestDeletes).payloads) {
    statements.push(db.prepare(`
      DELETE FROM state_collections
      WHERE scope_key = ?
        AND EXISTS (${stateSuccessSql})
        AND collection_key IN (SELECT CAST(value AS TEXT) FROM json_each(?))
    `).bind(scope, scope, nextVersion, requestId, payload))
  }
  return statements
}

const prepareStateCommit = (db, {
  current,
  nextState,
  scope,
  currentVersion,
  nextVersion,
  now,
  actorId,
  requestId,
}) => {
  const plan = prepareStatePersistencePlan(current, nextState, now)
  const mutation = current
    ? db.prepare(`
        UPDATE app_state
        SET value_json = ?, version = ?, updated_at = ?, updated_by = ?, last_request_id = ?
        WHERE scope_key = ? AND version = ?
      `).bind(plan.compactJson, nextVersion, now, actorId, requestId, scope, currentVersion)
    : db.prepare(`
        INSERT OR IGNORE INTO app_state (
          scope_key, value_json, version, updated_at, updated_by, last_request_id
        ) VALUES (?, ?, ?, ?, ?, ?)
      `).bind(scope, plan.compactJson, nextVersion, now, actorId, requestId)
  return {
    mutation,
    compactJson: plan.compactJson,
    externalStatements: statePersistenceStatements(db, scope, plan, nextVersion, requestId, now),
  }
}

const boundedAuditJson = (value) => {
  if (value === undefined) return null
  const serialized = JSON.stringify(replaceEmbeddedImageData(value))
  if (jsonByteLength(serialized) <= MAX_AUDIT_JSON_BYTES) return serialized
  const summary = {
    truncated: true,
    byteLength: jsonByteLength(serialized),
    kind: Array.isArray(value) ? 'array' : typeof value,
  }
  if (isPlainRecord(value)) {
    summary.id = value.id || value.code || value.employeeId || null
    summary.keys = Object.keys(value).slice(0, 100)
  }
  return JSON.stringify(summary)
}

const stateAuditSnapshot = (state) => ({
  stateVersion: Number(state?.stateVersion || 0),
  collections: Object.fromEntries(Object.entries(state || {})
    .filter(([, value]) => Array.isArray(value))
    .map(([key, value]) => [key, value.length])),
  scalarKeys: Object.entries(state || {}).filter(([, value]) => !Array.isArray(value)).map(([key]) => key),
})

const receiptStatements = (db, {
  actorId,
  idempotencyKey,
  requestHash: hash,
  responseJson,
  status,
  createdAt,
  successSql,
  successBindings,
  enforceSuccess = false,
}) => {
  if (jsonTextContainsEmbeddedImageData(responseJson)) {
    throw new ApiError(500, 'EMBEDDED_IMAGE_RECEIPT_FORBIDDEN', 'Biên nhận lệnh không được chứa dữ liệu ảnh nhúng.')
  }
  const responseBytes = jsonByteLength(responseJson)
  const chunks = responseBytes > MAX_RECEIPT_INLINE_BYTES
    ? splitUtf8String(responseJson, MAX_RECEIPT_CHUNK_BYTES)
    : []
  const storedResponse = chunks.length
    ? JSON.stringify({ __idosiChunkedResponse: 1, chunkCount: chunks.length, byteLength: responseBytes })
    : responseJson
  const receipt = enforceSuccess
    ? db.prepare(`
        INSERT INTO command_receipts (
          actor_id, idempotency_key, request_hash, response_json, status_code, created_at
        ) VALUES (?, ?, (SELECT ? WHERE EXISTS (${successSql})), ?, ?, ?)
      `).bind(actorId, idempotencyKey, hash, ...successBindings, storedResponse, status, createdAt)
    : db.prepare(`
        INSERT INTO command_receipts (
          actor_id, idempotency_key, request_hash, response_json, status_code, created_at
        )
        SELECT ?, ?, ?, ?, ?, ?
        WHERE EXISTS (${successSql})
      `).bind(actorId, idempotencyKey, hash, storedResponse, status, createdAt, ...successBindings)
  return [
    receipt,
    ...chunks.map((chunk, index) => db.prepare(`
      INSERT INTO command_receipt_chunks (
        actor_id, idempotency_key, chunk_index, chunk_text, chunk_bytes, created_at
      )
      SELECT ?, ?, ?, ?, ?, ?
      WHERE EXISTS (
        SELECT 1 FROM command_receipts
        WHERE actor_id = ? AND idempotency_key = ? AND request_hash = ? AND created_at = ?
      )
    `).bind(
      actorId,
      idempotencyKey,
      index,
      chunk,
      jsonByteLength(chunk),
      createdAt,
      actorId,
      idempotencyKey,
      hash,
      createdAt,
    )),
  ]
}

const listPolicies = async (db) => {
  const rows = await all(db, `
    SELECT policy_key, value_json, version, effective_at, updated_at, updated_by
    FROM policies
    ORDER BY policy_key
  `)
  return rows.map((row) => ({
    key: row.policy_key,
    value: parseStoredJson(row.value_json),
    version: Number(row.version),
    effectiveAt: row.effective_at,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
  }))
}

const bootstrapDatabase = async (request, env, context) => {
  const db = getDatabase(env)
  const existing = await first(db, 'SELECT COUNT(*) AS count FROM users')
  if (Number(existing?.count) > 0) {
    return jsonResponse(apiPayload(context, { initialized: true, alreadyInitialized: true }))
  }

  const configuredToken = String(env?.BOOTSTRAP_TOKEN || '')
  const providedToken = String(request.headers.get('x-idosi-bootstrap-token') || '')
  if (!configuredToken) {
    throw new ApiError(503, 'BOOTSTRAP_DISABLED', 'Cần cấu hình khóa khởi tạo bảo mật trước lần sử dụng đầu tiên.')
  }
  if (!providedToken || !constantTimeEqual(configuredToken, providedToken)) {
    throw new ApiError(403, 'BOOTSTRAP_FORBIDDEN', 'Khóa khởi tạo không hợp lệ.')
  }

  const body = await readJson(request)
  const username = String(body.username || '').trim()
  const normalizedUsername = normalizeUsername(username)
  const displayName = String(body.displayName || 'Quản trị viên IDOSI').trim().slice(0, 160)
  if (!/^[A-Za-z0-9._-]{3,80}$/u.test(username)) {
    throw new ApiError(400, 'INVALID_USERNAME', 'Tên đăng nhập phải có từ 3 đến 80 ký tự hợp lệ.')
  }
  const initialState = body.initialState === undefined ? {} : body.initialState
  if (!isPlainRecord(initialState)) throw new ApiError(400, 'INVALID_STATE', 'Trạng thái ban đầu phải là một đối tượng JSON.')
  const sanitizedInitialState = normalizeSharedStateForStorage(initialState)
  const normalizedInitialState = {
    ...sanitizedInitialState,
    orderInformationOptions: materializeDefaultOrderInformationOptions(sanitizedInitialState),
  }
  assertNoReservedPhysicalStoreIdentifiers(normalizedInitialState)
  assertNoCaseCollidingOperationalIdentifiers(normalizedInitialState)
  configuredOrderPaymentMethods(normalizedInitialState)

  const password = await hashPassword(body.password)
  const userId = `usr_${crypto.randomUUID()}`
  const requestId = context.requestId
  const stateCommit = prepareStateCommit(db, {
    current: null,
    nextState: normalizedInitialState,
    scope: 'global',
    currentVersion: 0,
    nextVersion: 1,
    now: context.now,
    actorId: userId,
    requestId,
  })
  const statements = [
    db.prepare(`
      INSERT INTO system_metadata (meta_key, value_json, version, updated_at)
      VALUES ('bootstrap', ?, 1, ?)
    `).bind(JSON.stringify({ requestId, username: normalizedUsername }), context.now),
    db.prepare(`
      INSERT INTO users (
        id, username, username_normalized, display_name, password_hash, password_salt,
        password_iterations, password_algorithm, role, status, created_at, updated_at, password_updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'admin', 'active', ?, ?, ?)
    `).bind(
      userId,
      username,
      normalizedUsername,
      displayName,
      password.hash,
      password.salt,
      password.iterations,
      password.algorithm,
      context.now,
      context.now,
      context.now,
    ),
    stateCommit.mutation,
    ...stateCommit.externalStatements,
  ]
  if (!hasLegacyAccountAvatarData(normalizedInitialState)) {
    statements.push(db.prepare(`
      INSERT INTO system_metadata (meta_key, value_json, version, updated_at)
      VALUES (?, ?, 1, ?)
      ON CONFLICT(meta_key) DO NOTHING
    `).bind(
      ACCOUNT_AVATAR_MIGRATION_METADATA_KEY,
      JSON.stringify({ completedAt: context.now, source: 'fresh-bootstrap' }),
      context.now,
    ))
  }
  for (const [key, value] of Object.entries(DEFAULT_POLICIES)) {
    statements.push(db.prepare(`
      INSERT INTO policies (
        policy_key, value_json, version, effective_at, updated_at, updated_by, last_request_id
      ) VALUES (?, ?, 1, ?, ?, ?, ?)
      ON CONFLICT(policy_key) DO UPDATE SET
        value_json = excluded.value_json,
        version = 1,
        effective_at = excluded.effective_at,
        updated_at = excluded.updated_at,
        updated_by = excluded.updated_by,
        last_request_id = excluded.last_request_id
    `).bind(key, JSON.stringify(value), context.now, context.now, userId, requestId))
  }
  for (const name of ['system:sessions']) {
    statements.push(db.prepare(`
      INSERT INTO counters (counter_name, counter_value, version, updated_at, last_request_id)
      VALUES (?, 0, 1, ?, ?)
    `).bind(name, context.now, requestId))
  }
  const orderCounterValues = new Map()
  const seenOrderCodes = new Set()
  for (const order of Array.isArray(normalizedInitialState.orders) ? normalizedInitialState.orders : []) {
    const orderCode = String(order?.code || '').trim().toUpperCase()
    const storeId = String(order?.storeId || '').trim()
    if (!orderCode || !storeId) continue
    if (seenOrderCodes.has(orderCode)) {
      throw new ApiError(400, 'DUPLICATE_ORDER_CODE', 'Dữ liệu ban đầu chứa mã đơn hàng bị trùng.')
    }
    seenOrderCodes.add(orderCode)
    const suffix = orderCode.match(/-(\d{5})$/u)
    if (!suffix) continue
    const value = Number(suffix[1])
    orderCounterValues.set(storeId, Math.max(orderCounterValues.get(storeId) || 0, value))
  }
  for (const [storeId, value] of orderCounterValues) {
    statements.push(db.prepare(`
      INSERT INTO counters (counter_name, counter_value, version, updated_at, last_request_id)
      VALUES (?, ?, 1, ?, ?)
    `).bind(`store:${storeId}:orders`, value, context.now, requestId))
  }
  let importCounterValue = 0
  const seenImportCodes = new Set()
  for (const voucher of Array.isArray(normalizedInitialState.importVouchers) ? normalizedInitialState.importVouchers : []) {
    const voucherCode = String(voucher?.code || '').trim().toUpperCase()
    if (!voucherCode) continue
    if (seenImportCodes.has(voucherCode)) {
      throw new ApiError(400, 'DUPLICATE_IMPORT_CODE', 'Dữ liệu ban đầu chứa mã phiếu nhập bị trùng.')
    }
    seenImportCodes.add(voucherCode)
    const suffix = voucherCode.match(/-(\d{4,5})$/u)
    if (suffix) importCounterValue = Math.max(importCounterValue, Number(suffix[1]))
  }
  statements.push(db.prepare(`
    INSERT INTO counters (counter_name, counter_value, version, updated_at, last_request_id)
    VALUES ('system:imports', ?, 1, ?, ?)
  `).bind(importCounterValue, context.now, requestId))
  statements.push(db.prepare(`
    INSERT INTO audit_log (
      request_id, actor_id, actor_role, action, entity_type, entity_id,
      before_json, after_json, metadata_json, server_timestamp
    ) VALUES (?, ?, 'admin', 'system.bootstrap', 'system', 'idosi', NULL, ?, ?, ?)
  `).bind(
    requestId,
    userId,
    JSON.stringify({ initialized: true, orderInformationDefaults: orderInformationDefaultsSummary() }),
    JSON.stringify({ source: 'bootstrap-api', orderInformationDefaults: orderInformationDefaultsSummary() }),
    context.now,
  ))

  let created = true
  let admin
  try {
    await db.batch(statements)
  } catch (error) {
    admin = await first(db, `
      SELECT id, username, display_name, role
      FROM users
      WHERE role = 'admin'
      ORDER BY created_at, id
      LIMIT 1
    `)
    if (!admin) throw error
    created = false
  }
  admin ||= await first(db, `
    SELECT id, username, display_name, role FROM users WHERE username_normalized = ? LIMIT 1
  `, normalizedUsername)
  if (!admin) throw new ApiError(500, 'BOOTSTRAP_FAILED', 'Không thể xác nhận tài khoản quản trị ban đầu.')
  return jsonResponse(apiPayload(context, {
    initialized: true,
    alreadyInitialized: !created,
    admin: { id: admin.id, username: admin.username, displayName: admin.display_name, role: admin.role },
  }), created ? 201 : 200)
}

const login = async (request, env, context) => {
  const db = getDatabase(env)
  const body = await readJson(request)
  const submittedUsername = String(body.username || '').trim()
  const username = normalizeUsername(submittedUsername)
  const passwordValue = String(body.password || '')
  if (!/^[A-Za-z0-9._-]{3,80}$/u.test(submittedUsername) || passwordValue.length < 1 || passwordValue.length > 256) {
    throw new ApiError(400, 'CREDENTIALS_INVALID', 'Tên đăng nhập hoặc mật khẩu không hợp lệ.')
  }
  const user = await first(db, `
    SELECT * FROM users WHERE username_normalized = ? LIMIT 1
  `, username)

  const passwordRecord = user ? {
    hash: user.password_hash,
    salt: user.password_salt,
    iterations: user.password_iterations,
    algorithm: user.password_algorithm,
  } : {
    hash: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    salt: 'AAAAAAAAAAAAAAAAAAAAAA',
    iterations: DEFAULT_PBKDF2_ITERATIONS,
    algorithm: PBKDF2_ALGORITHM,
  }
  const matches = await verifyPassword(passwordValue, passwordRecord)
  // Keep the normalized column for collision-safe lookup/backward-compatible
  // storage, but authentication itself follows the exact username spelling.
  // Password verification is already byte/case sensitive through PBKDF2.
  if (!user || user.username !== submittedUsername || !matches) {
    throw new ApiError(401, 'INVALID_CREDENTIALS', 'Tên đăng nhập hoặc mật khẩu chưa đúng.')
  }
  if (!VALID_ACCOUNT_STATUSES.has(user.status) || user.status !== 'active') {
    throw new ApiError(403, 'ACCOUNT_DISABLED', 'Tài khoản hiện không ở trạng thái hoạt động.')
  }
  if (!VALID_ROLES.has(user.role)) throw new ApiError(403, 'ROLE_INVALID', 'Vai trò tài khoản không hợp lệ.')

  const globalStateRow = user.role === 'admin' ? null : await loadState(db, 'global')
  const globalState = globalStateRow ? parseStoredJson(globalStateRow.value_json, {}) : null
  const availableRoles = await availableRoleOptionsForUser(db, user, globalState)
  const initialRole = availableRoles.find((option) => option.role === user.role) || availableRoles[0]
  const roleSelectedAt = availableRoles.length === 1 ? context.now : null

  const rawToken = toBase64Url(randomBytes(32))
  const tokenHash = await sha256(rawToken)
  const sessionId = `ses_${crypto.randomUUID()}`
  const expiresAt = addSeconds(context.now, sessionTtlSeconds(env))
  const userAgent = String(request.headers.get('user-agent') || '').slice(0, 512)
  const ipAddress = String(request.headers.get('cf-connecting-ip') || '').slice(0, 80)
  await db.batch([
    db.prepare(`
      INSERT INTO sessions (
        id, token_hash, user_id, created_at, last_seen_at, expires_at, user_agent, ip_address,
        active_role, active_store_id, active_employee_id, role_selected_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      sessionId, tokenHash, user.id, context.now, context.now, expiresAt, userAgent, ipAddress,
      initialRole.role, initialRole.storeId, initialRole.employeeId, roleSelectedAt,
    ),
    db.prepare('UPDATE users SET last_login_at = ?, updated_at = ? WHERE id = ?')
      .bind(context.now, context.now, user.id),
    db.prepare(`
      INSERT INTO audit_log (
        request_id, actor_id, actor_role, action, entity_type, entity_id,
        before_json, after_json, metadata_json, server_timestamp
      ) VALUES (?, ?, ?, 'auth.login', 'session', ?, NULL, ?, ?, ?)
    `).bind(
      context.requestId,
      user.id,
      user.role,
      sessionId,
      JSON.stringify({ expiresAt }),
      JSON.stringify({ userAgent, ipAddress: ipAddress || null }),
      context.now,
    ),
  ])

  const effectiveUser = await resolveEffectiveEmployeeStore(db, {
    ...user,
    last_login_at: context.now,
    role: initialRole.role,
    store_id: initialRole.storeId,
    employee_id: initialRole.employeeId,
    available_roles: availableRoles,
    needs_role_selection: availableRoles.length > 1,
  }, context.now, globalState)
  let bootstrapRow = globalStateRow || await loadState(db, 'global')
  bootstrapRow = await migrateLegacyAccountAvatars(db, env, effectiveUser, context, bootstrapRow)
  bootstrapRow = await persistOpenStoreAttendanceChecklistRepairs(db, effectiveUser, context, bootstrapRow)
  const policies = await listPolicies(db)
  const bootstrapState = bootstrapRow ? parseStoredJson(bootstrapRow.value_json, {}) : {}
  const publicEffectiveUser = publicUser(effectiveUser)
  const visibleUsers = OPERATIONS_ROLES.has(effectiveUser.role)
    ? (await visibleUserRowsForActor(db, effectiveUser)).map(publicUser)
    : null
  return jsonResponse(apiPayload(context, {
    token: rawToken,
    tokenType: 'Bearer',
    expiresAt,
    user: publicEffectiveUser,
    // Login already resolved the actor and loaded the global snapshot. Return
    // the same scoped bootstrap projection here so the client does not issue a
    // second heavyweight request before it can render the first screen.
    bootstrap: {
      user: publicEffectiveUser,
      scope: 'global',
      projection: effectiveUser.role,
      state: projectSharedState(bootstrapState, effectiveUser),
      version: Number(bootstrapRow?.version || 0),
      updatedAt: bootstrapRow?.updated_at || null,
      policies,
    },
    ...(visibleUsers ? { users: visibleUsers } : {}),
  }))
}

const selectSessionRole = async (request, env, context) => {
  const db = getDatabase(env)
  const actor = await requireSession(request, db, context)
  const body = await readJson(request)
  const requestedRole = String(body.role || '').trim()
  const requestedStoreId = String(body.storeId || '').trim()
  const requestedEmployeeId = String(body.employeeId || '').trim()
  const selected = matchingSessionRoleOption(actor.available_roles, {
    role: requestedRole,
    storeId: requestedStoreId,
    employeeId: requestedEmployeeId,
  })
  if (!selected) {
    throw new ApiError(400, 'ROLE_SELECTION_INVALID', 'Vai trò được chọn không còn hợp lệ. Vui lòng đăng nhập lại.')
  }
  const result = await run(db, `
    UPDATE sessions
    SET active_role = ?, active_store_id = ?, active_employee_id = ?, role_selected_at = ?, last_seen_at = ?
    WHERE id = ? AND revoked_at IS NULL AND expires_at > ?
  `, selected.role, selected.storeId || null, selected.employeeId || null, context.now, context.now, actor.session_id, context.now)
  if (changes(result) !== 1) throw new ApiError(401, 'SESSION_INVALID', 'Phiên đăng nhập không còn hợp lệ.')
  const effective = await resolveEffectiveEmployeeStore(db, {
    ...actor,
    role: selected.role,
    store_id: selected.storeId || null,
    employee_id: selected.employeeId || null,
    active_role: selected.role,
    active_store_id: selected.storeId || null,
    active_employee_id: selected.employeeId || null,
    role_selected_at: context.now,
    needs_role_selection: false,
  }, context.now, actor._globalState || null)
  return jsonResponse(apiPayload(context, { user: publicUser(effective) }))
}

const getBootstrap = async (request, env, context, url) => {
  const db = getDatabase(env)
  const user = await requireSession(request, db, context)
  const scope = url.searchParams.get('scope') || defaultScope(user)
  assertScope(user, scope)
  let stateRow = scope === 'global' && user._globalStateRow
    ? user._globalStateRow
    : await loadState(db, scope)
  if (scope === 'global') {
    stateRow = await migrateLegacyAccountAvatars(db, env, user, context, stateRow)
    stateRow = await persistOpenStoreAttendanceChecklistRepairs(db, user, context, stateRow)
  }
  const policies = await listPolicies(db)
  const rawState = stateRow ? parseStoredJson(stateRow.value_json, {}) : {}
  return jsonResponse(apiPayload(context, {
    user: publicUser(user),
    scope,
    projection: scope === 'global' ? user.role : 'private',
    state: scope === 'global' ? projectSharedState(rawState, user) : sanitizeStateValue(rawState),
    version: Number(stateRow?.version || 0),
    updatedAt: stateRow?.updated_at || null,
    policies,
  }))
}

const getState = async (request, env, context, url) => {
  const db = getDatabase(env)
  const user = await requireSession(request, db, context)
  const scope = url.searchParams.get('scope') || defaultScope(user)
  assertScope(user, scope)
  let row = scope === 'global' && user._globalStateRow
    ? user._globalStateRow
    : await loadState(db, scope)
  if (scope === 'global') {
    row = await migrateLegacyAccountAvatars(db, env, user, context, row)
    row = await persistOpenStoreAttendanceChecklistRepairs(db, user, context, row)
  }
  const policies = await listPolicies(db)
  const rawState = row ? parseStoredJson(row.value_json, {}) : {}
  return jsonResponse(apiPayload(context, {
    user: publicUser(user),
    scope,
    projection: scope === 'global' ? user.role : 'private',
    state: scope === 'global' ? projectSharedState(rawState, user) : sanitizeStateValue(rawState),
    version: Number(row?.version || 0),
    updatedAt: row?.updated_at || null,
    updatedBy: row?.updated_by || null,
    policies,
  }))
}

const getStateMetadata = async (request, env, context, url) => {
  const db = getDatabase(env)
  const user = await requireSession(request, db, context, { resolveOperationalContext: false })
  const scope = url.searchParams.get('scope') || defaultScope(user)
  assertScope(user, scope)
  const row = await first(db, `
    SELECT version, updated_at
    FROM app_state
    WHERE scope_key = ?
    LIMIT 1
  `, scope)
  const policyRows = await all(db, `
    SELECT policy_key, version
    FROM policies
    ORDER BY policy_key
  `)
  return jsonResponse(apiPayload(context, {
    scope,
    version: Number(row?.version || 0),
    updatedAt: row?.updated_at || null,
    userVersion: Number(user.version || 0),
    policyVersions: Object.fromEntries(policyRows.map((policy) => [
      policy.policy_key,
      Number(policy.version || 0),
    ])),
  }))
}

const getRevenueBonusLive = async (request, env, context, url) => {
  const db = getDatabase(env)
  const user = await requireSession(request, db, context)
  if (!['admin', 'business_support', 'store_manager', 'employee'].includes(user.role)) {
    throw new ApiError(403, 'ROLE_FORBIDDEN', 'Tài khoản không có quyền xem thưởng doanh thu cửa hàng.')
  }
  const storeId = String(url.searchParams.get('storeId') || '').trim()
  const actorStoreId = String(user.store_id || '').trim()
  if (['store_manager', 'employee'].includes(user.role) && (!storeId || !sameIdentifier(storeId, actorStoreId))) {
    throw new ApiError(403, 'STORE_SCOPE_FORBIDDEN', 'Tài khoản chỉ được xem thưởng doanh thu đúng cửa hàng đang làm việc.')
  }
  assertOperationalStoreAccess(user, storeId)
  const businessDate = compensationDate(url.searchParams.get('businessDate'), 'Ngày kinh doanh')
  const row = user._globalStateRow || await loadState(db, 'global')
  const state = normalizeSharedStateForStorage(row ? parseStoredJson(row.value_json, {}) : {})
  const store = requireActivePhysicalStore(state, storeId)
  const live = revenueBonusLiveSnapshot({ state, store, businessDate, now: context.now })
  const viewerEmployeeId = String(user.employee_id || '').trim()
  const canViewAllAllocations = ['admin', 'business_support', 'store_manager'].includes(user.role)
  return jsonResponse(apiPayload(context, {
    snapshot: {
      ...live,
      allocations: canViewAllAllocations
        ? live.allocations
        : live.allocations.filter((allocation) => sameIdentifier(allocation.employeeId, viewerEmployeeId)),
    },
  }))
}

const DOMAIN_PROTECTED_STATE_COLLECTIONS = new Set([
  'attendance',
  'attendanceAudit',
  'tasks',
  'taskAssignmentHistory',
  'orders',
  'orderAudit',
  'orderInformationOptions',
  'operationalResetHistory',
  'supportTransfers',
  'supportWorkAssignments',
  'supportWorkSchedules',
  'supportWorkScheduleHistory',
  'expenseEntries',
  'fixedExpenses',
  'cashTransactions',
  'importVouchers',
  'salaryAdjustments',
  'salaryAdvances',
  'payrollPeriods',
  'payrollPayments',
  ...COMPENSATION_STATE_COLLECTIONS,
])

const SUPPORT_ATTENDANCE_PROJECTION_FIELDS = new Set([
  'supportCompensation',
  'supportHourlyRate',
  'supportHours',
  'supportBasePay',
  'supportAllowance',
  'supportAllowanceApplied',
  'supportActualPay',
])

const protectedCollectionComparable = (key, value) => {
  if (key === 'orderInformationOptions') {
    return orderInformationOptionsFromState(Array.isArray(value) ? { orderInformationOptions: value } : {})
  }
  if (key !== 'attendance' || !Array.isArray(value)) return value
  return value.map((record) => Object.fromEntries(Object.entries(record || {}).filter(([field]) => (
    !SUPPORT_ATTENDANCE_PROJECTION_FIELDS.has(field)
  ))))
}

const referencedSupportTransferIds = (state) => {
  const identifiers = new Set()
  const add = (value) => {
    const identifier = String(value || '').trim()
    if (identifier) identifiers.add(identifier)
  }
  for (const record of Array.isArray(state?.attendance) ? state.attendance : []) {
    add(record?.supportTransferId)
    add(record?.supportCompensation?.transferId)
  }
  for (const record of Array.isArray(state?.expenseEntries) ? state.expenseEntries : []) {
    add(record?.supportTransferId)
  }
  for (const period of Array.isArray(state?.payrollPeriods) ? state.payrollPeriods : []) {
    for (const row of Array.isArray(period?.rows) ? period.rows : []) {
      for (const identifier of Array.isArray(row?.supportTransferIds) ? row.supportTransferIds : []) add(identifier)
      for (const identifier of Array.isArray(row?.supportCompensation?.transferIds)
        ? row.supportCompensation.transferIds
        : []) add(identifier)
      for (const detail of Array.isArray(row?.supportDetails) ? row.supportDetails : []) add(detail?.transferId)
    }
  }
  return identifiers
}

const assertSupportTransferCollisionRepair = (currentState, nextTransfers) => {
  const current = Array.isArray(currentState?.supportTransfers) ? currentState.supportTransfers : []
  const next = Array.isArray(nextTransfers) ? nextTransfers : []
  const identifierCounts = new Map()
  current.forEach((record) => {
    const key = normalizeIdentifierKey(record?.id)
    if (key) identifierCounts.set(key, (identifierCounts.get(key) || 0) + 1)
  })
  const collidingIdentifiers = new Set(
    [...identifierCounts].filter(([, count]) => count > 1).map(([identifier]) => identifier),
  )
  const remainingBySnapshot = new Map()
  current.forEach((record) => {
    const snapshot = JSON.stringify(canonicalize(record))
    const rows = remainingBySnapshot.get(snapshot) || []
    rows.push(record)
    remainingBySnapshot.set(snapshot, rows)
  })
  next.forEach((record) => {
    const snapshot = JSON.stringify(canonicalize(record))
    const rows = remainingBySnapshot.get(snapshot)
    if (!rows?.length) {
      throw new ApiError(
        400,
        'DOMAIN_COMMAND_REQUIRED',
        'Khi sửa va chạm mã điều chuyển, chỉ được loại bỏ bản ghi trùng; không được thêm hoặc sửa nội dung phiếu.',
      )
    }
    rows.pop()
  })
  const removed = [...remainingBySnapshot.values()].flat()
  if (!removed.length || removed.some((record) => !collidingIdentifiers.has(normalizeIdentifierKey(record?.id)))) {
    throw new ApiError(
      400,
      'DOMAIN_COMMAND_REQUIRED',
      'Chỉ được loại bỏ đúng phiếu điều chuyển có mã đang va chạm hoa/thường.',
    )
  }
  const nextIdentifierByKey = new Map(next.map((record) => [
    normalizeIdentifierKey(record?.id),
    String(record?.id || '').trim(),
  ]).filter(([key, identifier]) => key && identifier))
  const referencedIdentifiers = referencedSupportTransferIds(currentState)
  const unresolvedReference = [...referencedIdentifiers].find((reference) => {
    const key = normalizeIdentifierKey(reference)
    if (!collidingIdentifiers.has(key)) return false
    return String(reference || '').trim() !== nextIdentifierByKey.get(key)
  })
  if (unresolvedReference) {
    throw new ApiError(
      400,
      'DOMAIN_COMMAND_REQUIRED',
      'Không được sửa va chạm phiếu điều chuyển khi dữ liệu chấm công hoặc tài chính chưa tham chiếu chính xác phiếu được giữ lại.',
      {
        identifier: normalizeIdentifierKey(unresolvedReference),
        referencedIdentifier: unresolvedReference,
        survivingIdentifier: nextIdentifierByKey.get(normalizeIdentifierKey(unresolvedReference)) || null,
      },
    )
  }
  const survivingCollisionKeys = new Set(next.map((record) => normalizeIdentifierKey(record?.id)).filter(Boolean))
  if ([...new Set(removed.map((record) => normalizeIdentifierKey(record?.id)).filter(Boolean))]
    .some((identifier) => !survivingCollisionKeys.has(identifier))) {
    throw new ApiError(
      400,
      'DOMAIN_COMMAND_REQUIRED',
      'Mỗi nhóm mã điều chuyển va chạm phải giữ lại một phiếu nguyên vẹn.',
    )
  }
}

const operationalReferenceValues = (state, kind) => {
  const references = new Set()
  const add = (value) => {
    const identifier = String(value || '').trim()
    if (identifier) references.add(identifier)
  }
  const excludedRoots = kind === 'employee'
    ? new Set()
    : new Set(['stores', 'deletedStores'])
  const directKeys = kind === 'employee'
    ? new Set([
        'employeeId', 'employee_id', 'employeeCode', 'employee_code', 'assigneeId', 'userId',
        'createdByEmployeeId', 'creatorEmployeeId', 'linkedEmployeeId', 'managerEmployeeId',
      ])
    : new Set([
        'storeId', 'store_id', 'fromStoreId', 'toStoreId', 'homeStoreId', 'activeStoreId',
        'sourceStoreId', 'targetStoreId', 'assignedStoreId', 'assigned_store_id',
        'supportStoreId', 'support_store_id',
      ])
  const arrayKeys = kind === 'employee'
    ? new Set(['employeeIds', 'assigneeIds', 'assignedEmployeeIds', 'assignees', 'participants'])
    : new Set(['storeIds'])
  const employeeMasterKeys = new Set(['id', 'code', 'employeeId', 'employeeCode'])
  const employeeReferenceFromMediaKey = (value) => {
    const key = String(value || '').trim()
    const identityImageMatch = key.match(/^identity-images\/([^/]+)\/(?:front|back)\//u)
    if (identityImageMatch) return identityImageMatch[1]
    const legacyAvatarMatch = key.match(/^account-avatars\/legacy-profile-([^/]+)\//u)
    return legacyAvatarMatch?.[1] || ''
  }
  const visit = (value, parentKey = '', depth = 0, skipEmployeeMasterKeys = false) => {
    if (value == null || depth > 20) return
    if (Array.isArray(value)) {
      for (const item of value) {
        if (arrayKeys.has(parentKey)) {
          if (isPlainRecord(item)) add(kind === 'employee'
            ? item.employeeId || item.employee_id || item.assigneeId || item.userId || item.id || item.code
            : item.storeId || item.store_id || item.id || item.code)
          else add(item)
        }
        visit(
          item,
          parentKey,
          depth + 1,
          kind === 'employee' && ['employees', 'deletedEmployees'].includes(parentKey),
        )
      }
      return
    }
    if (!isPlainRecord(value)) return
    for (const [key, nested] of Object.entries(value)) {
      if (directKeys.has(key) && !(skipEmployeeMasterKeys && employeeMasterKeys.has(key))) add(nested)
      if (kind === 'employee' && key === 'key') add(employeeReferenceFromMediaKey(nested))
      if (kind === 'employee' && key === 'completedBy' && isPlainRecord(nested)) {
        Object.keys(nested).forEach(add)
      }
      visit(nested, key, depth + 1)
    }
  }
  for (const [key, value] of Object.entries(isPlainRecord(state) ? state : {})) {
    if (excludedRoots.has(key)) continue
    if (directKeys.has(key)) add(value)
    if (arrayKeys.has(key) && Array.isArray(value)) value.forEach(add)
    visit(value, key)
  }
  return references
}

const removedMasterRecords = (currentRecords, nextRecords, label) => {
  const remainingBySnapshot = new Map()
  const current = Array.isArray(currentRecords) ? currentRecords : []
  const next = Array.isArray(nextRecords) ? nextRecords : []
  current.forEach((record) => {
    const snapshot = JSON.stringify(canonicalize(record))
    const rows = remainingBySnapshot.get(snapshot) || []
    rows.push(record)
    remainingBySnapshot.set(snapshot, rows)
  })
  next.forEach((record) => {
    const snapshot = JSON.stringify(canonicalize(record))
    const rows = remainingBySnapshot.get(snapshot)
    if (!rows?.length) {
      throw new ApiError(
        400,
        'DOMAIN_COMMAND_REQUIRED',
        `Khi sửa va chạm mã ${label}, chỉ được loại bỏ hồ sơ trùng; không được thêm hoặc sửa hồ sơ.`,
      )
    }
    rows.pop()
  })
  return [...remainingBySnapshot.values()].flat()
}

const assertMasterIdentifierCollisionRepair = ({
  currentState,
  nextState,
  collection,
  historyCollection,
  identifierValues,
  kind,
  label,
}) => {
  const currentRecords = Array.isArray(currentState?.[collection]) ? currentState[collection] : []
  const nextRecords = Array.isArray(nextState?.[collection]) ? nextState[collection] : []
  const currentHistory = Array.isArray(currentState?.[historyCollection]) ? currentState[historyCollection] : []
  const nextHistory = Array.isArray(nextState?.[historyCollection]) ? nextState[historyCollection] : []
  if (JSON.stringify(canonicalize(currentHistory)) !== JSON.stringify(canonicalize(nextHistory))) {
    throw new ApiError(400, 'DOMAIN_COMMAND_REQUIRED', `Lịch sử ${label} không được thay đổi khi sửa va chạm mã.`)
  }
  if (JSON.stringify(canonicalize(currentRecords)) === JSON.stringify(canonicalize(nextRecords))) return null

  const ownersByIdentifier = new Map()
  currentRecords.forEach((record, index) => {
    const recordKeys = new Set(identifierValues(record).map(normalizeIdentifierKey).filter(Boolean))
    recordKeys.forEach((key) => {
      const owners = ownersByIdentifier.get(key) || new Set()
      owners.add(index)
      ownersByIdentifier.set(key, owners)
    })
  })
  const collisionKeys = new Set([...ownersByIdentifier]
    .filter(([, owners]) => owners.size > 1)
    .map(([key]) => key))
  const removed = removedMasterRecords(currentRecords, nextRecords, label)
  if (!removed.length || removed.some((record) => (
    !identifierValues(record).some((identifier) => collisionKeys.has(normalizeIdentifierKey(identifier)))
  ))) {
    throw new ApiError(400, 'DOMAIN_COMMAND_REQUIRED', `Chỉ được loại bỏ đúng hồ sơ ${label} có mã đang va chạm hoa/thường.`)
  }

  const survivingRawByKey = new Map()
  nextRecords.forEach((record) => identifierValues(record).forEach((identifier) => {
    const raw = String(identifier || '').trim()
    const key = normalizeIdentifierKey(raw)
    if (!key || !raw) return
    const values = survivingRawByKey.get(key) || new Set()
    values.add(raw)
    survivingRawByKey.set(key, values)
  }))
  const removedKeys = new Set(removed.flatMap((record) => identifierValues(record))
    .map(normalizeIdentifierKey).filter(Boolean))
  for (const collisionKey of collisionKeys) {
    if (removedKeys.has(collisionKey) && !survivingRawByKey.has(collisionKey)) {
      throw new ApiError(400, 'DOMAIN_COMMAND_REQUIRED', `Mỗi nhóm mã ${label} va chạm phải giữ lại một hồ sơ nguyên vẹn.`)
    }
  }

  const unresolvedReference = [...operationalReferenceValues(nextState, kind)].find((reference) => {
    const key = normalizeIdentifierKey(reference)
    if (!removedKeys.has(key)) return false
    return !survivingRawByKey.get(key)?.has(String(reference || '').trim())
  })
  if (unresolvedReference) {
    throw new ApiError(
      400,
      'DOMAIN_COMMAND_REQUIRED',
      `Không được loại bỏ hồ sơ ${label} khi dữ liệu nghiệp vụ chưa tham chiếu chính xác hồ sơ được giữ lại.`,
      {
        identifier: normalizeIdentifierKey(unresolvedReference),
        referencedIdentifier: unresolvedReference,
        survivingIdentifiers: [...(survivingRawByKey.get(normalizeIdentifierKey(unresolvedReference)) || [])],
      },
    )
  }
  return { removedKeys, survivingRawByKey }
}

const assertOperationalMasterCollisionRepair = (currentState, nextState) => {
  const employeeRepair = assertMasterIdentifierCollisionRepair({
    currentState,
    nextState,
    collection: 'employees',
    historyCollection: 'deletedEmployees',
    identifierValues: employeeIdentifierValues,
    kind: 'employee',
    label: 'nhân viên',
  })
  const storeRepair = assertMasterIdentifierCollisionRepair({
    currentState,
    nextState,
    collection: 'stores',
    historyCollection: 'deletedStores',
    identifierValues: (record) => [String(record?.id || '').trim()].filter(Boolean),
    kind: 'store',
    label: 'cửa hàng',
  })
  return { employeeRepair, storeRepair }
}

const assertAuthEmployeeLinksSurviveCollisionRepair = async (db, repair) => {
  if (!repair?.removedKeys?.size) return
  const users = await all(db, `
    SELECT id, employee_id
    FROM users
    WHERE employee_id IS NOT NULL
    ORDER BY created_at, id
  `)
  const unresolved = users.find((user) => {
    const reference = String(user.employee_id || '').trim()
    const key = normalizeIdentifierKey(reference)
    return repair.removedKeys.has(key) && !repair.survivingRawByKey.get(key)?.has(reference)
  })
  if (unresolved) {
    throw new ApiError(
      400,
      'DOMAIN_COMMAND_REQUIRED',
      'Không được loại bỏ hồ sơ nhân viên khi tài khoản đăng nhập chưa liên kết chính xác hồ sơ được giữ lại.',
      {
        userId: String(unresolved.id || ''),
        referencedIdentifier: String(unresolved.employee_id || ''),
        survivingIdentifiers: [
          ...(repair.survivingRawByKey.get(normalizeIdentifierKey(unresolved.employee_id)) || []),
        ],
      },
    )
  }
}

const assertAuthStoreLinksSurviveCollisionRepair = async (db, repair) => {
  if (!repair?.removedKeys?.size) return
  const users = await all(db, `
    SELECT id, store_id
    FROM users
    WHERE store_id IS NOT NULL
    ORDER BY created_at, id
  `)
  const unresolved = users.find((user) => {
    const reference = String(user.store_id || '').trim()
    const key = normalizeIdentifierKey(reference)
    return repair.removedKeys.has(key) && !repair.survivingRawByKey.get(key)?.has(reference)
  })
  if (unresolved) {
    throw new ApiError(
      400,
      'DOMAIN_COMMAND_REQUIRED',
      'Không được loại bỏ hồ sơ cửa hàng khi tài khoản đăng nhập chưa liên kết chính xác cửa hàng được giữ lại.',
      {
        userId: String(unresolved.id || ''),
        referencedIdentifier: String(unresolved.store_id || ''),
        survivingIdentifiers: [
          ...(repair.survivingRawByKey.get(normalizeIdentifierKey(unresolved.store_id)) || []),
        ],
      },
    )
  }
}

const assertProtectedCollectionsUnchanged = (currentState, nextState, {
  allowSupportTransferCollisionRepair = false,
} = {}) => {
  for (const key of DOMAIN_PROTECTED_STATE_COLLECTIONS) {
    if (key === 'supportTransfers' && allowSupportTransferCollisionRepair) {
      const currentValue = protectedCollectionComparable(key, currentState?.[key])
      const nextValue = protectedCollectionComparable(key, nextState?.[key])
      if (JSON.stringify(canonicalize(currentValue)) !== JSON.stringify(canonicalize(nextValue))) {
        assertSupportTransferCollisionRepair(currentState, nextValue)
      }
      continue
    }
    const currentValue = protectedCollectionComparable(key, currentState?.[key])
    const nextValue = protectedCollectionComparable(key, nextState?.[key])
    if (JSON.stringify(canonicalize(currentValue)) !== JSON.stringify(canonicalize(nextValue))) {
      throw new ApiError(400, 'DOMAIN_COMMAND_REQUIRED', `Bộ sưu tập ${key} chỉ được thay đổi bằng lệnh nghiệp vụ.`)
    }
  }
}

const preserveProtectedCollections = (currentState, nextState, {
  allowSupportTransferCollisionRepair = false,
} = {}) => {
  const protectedState = { ...nextState }
  for (const key of DOMAIN_PROTECTED_STATE_COLLECTIONS) {
    if (key === 'supportTransfers' && allowSupportTransferCollisionRepair) continue
    if (Object.hasOwn(currentState || {}, key)) protectedState[key] = currentState[key]
    else delete protectedState[key]
  }
  return protectedState
}

const preserveNotificationReadReceipts = (currentState, nextState) => {
  const currentById = new Map((Array.isArray(currentState?.notifications) ? currentState.notifications : [])
    .map((record) => [String(record.id || record.notificationId || ''), record]))
  return (Array.isArray(nextState?.notifications) ? nextState.notifications : []).map((record) => {
    const id = String(record.id || record.notificationId || '')
    const current = currentById.get(id)
    const { readAtByUserId: _incomingReceipts, readByUserIds: _incomingReaderIds, ...safe } = record
    void _incomingReceipts
    void _incomingReaderIds
    if (!current) {
      const { readAt: _incomingReadAt, read: _incomingRead, isRead: _incomingIsRead, ...created } = safe
      void _incomingReadAt
      void _incomingRead
      void _incomingIsRead
      return created
    }
    const restored = {
      ...safe,
      readAt: current.readAt || null,
      ...(current.read !== undefined ? { read: current.read } : {}),
      ...(current.isRead !== undefined ? { isRead: current.isRead } : {}),
    }
    if (isPlainRecord(current.readAtByUserId)) restored.readAtByUserId = current.readAtByUserId
    return restored
  })
}

const stateCommand = async (db, user, body, commandContext) => {
  const scope = String(body.scope || defaultScope(user))
  assertScope(user, scope, true)
  const expectedVersion = commandExpectedVersion(body)
  const current = scope === 'global' && body._preloadedGlobalStateRow
    ? body._preloadedGlobalStateRow
    : await loadState(db, scope)
  const currentVersion = Number(current?.version || 0)
  if (currentVersion !== expectedVersion) {
    throw new ApiError(409, 'VERSION_CONFLICT', 'Dữ liệu đã thay đổi trên máy chủ.', { currentVersion })
  }

  const payload = isPlainRecord(body.payload) ? body.payload : {}
  const currentState = current ? parseStoredJson(current.value_json, {}) : {}
  if (scope === 'global') {
    const rawMutation = body.type === 'state.replace' ? payload.state : payload.patch
    if (isPlainRecord(rawMutation) && Object.hasOwn(rawMutation, 'accountSettings')) {
      throw new ApiError(
        400,
        'DOMAIN_COMMAND_REQUIRED',
        'Thiết lập tài khoản chỉ được thay đổi bằng lệnh account_settings.update.',
      )
    }
  }
  let nextState
  if (body.type === 'state.replace') {
    nextState = payload.state
  } else {
    if (!isPlainRecord(currentState) || !isPlainRecord(payload.patch)) {
      throw new ApiError(400, 'INVALID_STATE_PATCH', 'Dữ liệu cập nhật trạng thái không hợp lệ.')
    }
    nextState = { ...currentState, ...payload.patch }
  }
  if (!isPlainRecord(nextState)) throw new ApiError(400, 'INVALID_STATE', 'Trạng thái phải là một đối tượng JSON.')
  const operationalCollisionRepair = scope === 'global' && body._operationalCollisionRepair === true
  if (scope === 'global') {
    if (operationalCollisionRepair) {
      const repair = assertOperationalMasterCollisionRepair(currentState, nextState)
      await assertAuthEmployeeLinksSurviveCollisionRepair(db, repair.employeeRepair)
      await assertAuthStoreLinksSurviveCollisionRepair(db, repair.storeRepair)
    }
    assertProtectedCollectionsUnchanged(currentState, nextState, {
      allowSupportTransferCollisionRepair: operationalCollisionRepair,
    })
    nextState = preserveProtectedCollections(currentState, nextState, {
      allowSupportTransferCollisionRepair: operationalCollisionRepair,
    })
  }
  nextState = normalizeSharedStateForStorage(nextState)
  if (scope === 'global') {
    const normalizedCurrentState = normalizeSharedStateForStorage(currentState)
    const currentAccountSettings = normalizedCurrentState.accountSettings
    nextState.accountSettings = isPlainRecord(currentAccountSettings) ? currentAccountSettings : {}
    if (Object.hasOwn(normalizedCurrentState, 'settings')) nextState.settings = normalizedCurrentState.settings
    else delete nextState.settings
    nextState.notifications = preserveNotificationReadReceipts(currentState, nextState)
    assertNoReservedPhysicalStoreIdentifiers(nextState)
    assertNoCaseCollidingOperationalIdentifiers(nextState)
  }
  const nextVersion = currentVersion + 1
  const responseBody = apiPayload(commandContext, {
    command: body.type,
    scope,
    state: scope === 'global' ? projectSharedState(nextState, user) : nextState,
    version: nextVersion,
    updatedAt: commandContext.now,
  })
  const responseJson = JSON.stringify(responseBody)
  const stateCommit = prepareStateCommit(db, {
    current,
    nextState,
    scope,
    currentVersion,
    nextVersion,
    now: commandContext.now,
    actorId: user.user_id,
    requestId: commandContext.requestId,
  })

  const results = await db.batch([
    stateCommit.mutation,
    ...stateCommit.externalStatements,
    db.prepare(`
      INSERT INTO audit_log (
        request_id, actor_id, actor_role, action, entity_type, entity_id,
        before_json, after_json, metadata_json, server_timestamp
      )
      SELECT ?, ?, ?, ?, 'state', ?, ?, ?, ?, ?
      WHERE EXISTS (
        SELECT 1 FROM app_state WHERE scope_key = ? AND version = ? AND last_request_id = ?
      )
    `).bind(
      commandContext.requestId,
      user.user_id,
      user.role,
      body.type,
      scope,
      current ? boundedAuditJson(scope === 'global'
        ? stateAuditSnapshot(normalizeSharedStateForStorage(currentState))
        : stateAuditSnapshot(sanitizeStateValue(currentState))) : null,
      boundedAuditJson(stateAuditSnapshot(nextState)),
      JSON.stringify({ fromVersion: currentVersion, toVersion: nextVersion }),
      commandContext.now,
      scope,
      nextVersion,
      commandContext.requestId,
    ),
    ...receiptStatements(db, {
      actorId: user.user_id,
      idempotencyKey: commandContext.idempotencyKey,
      requestHash: commandContext.hash,
      responseJson,
      status: 200,
      createdAt: commandContext.now,
      successSql: stateSuccessSql,
      successBindings: [scope, nextVersion, commandContext.requestId],
    }),
  ])
  if (changes(results?.[0]) !== 1) {
    const latest = await loadState(db, scope)
    throw new ApiError(409, 'VERSION_CONFLICT', 'Dữ liệu đã thay đổi trên máy chủ.', {
      currentVersion: Number(latest?.version || 0),
    })
  }
  return jsonResponse(responseBody)
}

const validatePolicy = (key, value) => {
  if (!Object.hasOwn(DEFAULT_POLICIES, key)) {
    throw new ApiError(400, 'POLICY_UNKNOWN', 'Chính sách không được hỗ trợ.')
  }
  const number = Number(value)
  if (!Number.isFinite(number) || number < 0) {
    throw new ApiError(400, 'POLICY_VALUE_INVALID', 'Giá trị chính sách phải là số không âm.')
  }
  if (key === 'late_tolerance_minutes' || key === 'early_check_in_limit_minutes') {
    if (!Number.isInteger(number) || number > 1_440) {
      throw new ApiError(400, 'POLICY_VALUE_INVALID', 'Số phút đi trễ phải là số nguyên từ 0 đến 1.440.')
    }
    return number
  }
  if (key === 'attendance_maintain_max_late_count' || key === 'attendance_improve_min_late_count') {
    if (!Number.isInteger(number) || number > 366) {
      throw new ApiError(400, 'POLICY_VALUE_INVALID', 'Số lần đi trễ phải là số nguyên từ 0 đến 366.')
    }
    return number
  }
  if (key === 'attendance_improve_min_late_minutes') {
    if (!Number.isInteger(number) || number > 44_640) {
      throw new ApiError(400, 'POLICY_VALUE_INVALID', 'Tổng phút đi trễ phải là số nguyên từ 0 đến 44.640.')
    }
    return number
  }
  if (number > 100) throw new ApiError(400, 'POLICY_VALUE_INVALID', 'Tỷ lệ phần trăm không được vượt quá 100.')
  return number
}

const serverCounterCode = (name, value, serverTimestamp) => {
  const parts = String(name).split(':')
  const kind = String(parts.at(-1) || '').toLocaleLowerCase('vi-VN')
  const sequence = String(value).padStart(5, '0')
  if (parts[0] === 'store' && parts[1] && kind === 'orders') {
    const storeCode = parts[1].toUpperCase().replace(/[^A-Z0-9]/gu, '').slice(0, 20)
    if (!storeCode) throw new ApiError(400, 'COUNTER_NAME_INVALID', 'Bộ đếm đơn hàng thiếu mã cửa hàng hợp lệ.')
    return `${storeCode}-${sequence}`
  }
  if (kind === 'imports') {
    const local = localDateTimeParts(serverTimestamp)
    const [year, month, day] = local.date.split('-')
    return `PN-${day}/${month}/${year.slice(-2)}-${String(value).padStart(4, '0')}`
  }
  const serverPrefix = kind.toUpperCase().replace(/[^A-Z0-9]/gu, '').slice(0, 12) || 'ID'
  return `${serverPrefix}-${sequence}`
}

const policyNumber = async (db, key, fallback) => {
  const row = await first(db, 'SELECT value_json FROM policies WHERE policy_key = ? LIMIT 1', key)
  const value = Number(parseStoredJson(row?.value_json, fallback))
  return Number.isFinite(value) ? value : fallback
}

const commitGlobalStateDomainCommand = async (db, actor, current, nextState, options, commandContext) => {
  const currentVersion = Number(current.version)
  const nextVersion = currentVersion + 1
  const receiptBody = apiPayload(commandContext, { ...options.response, version: nextVersion })
  const responseBody = options.ephemeralResponse
    ? apiPayload(commandContext, { ...options.response, ...options.ephemeralResponse, version: nextVersion })
    : receiptBody
  const responseJson = JSON.stringify(receiptBody)
  const stateGuardSql = options.stateGuard?.sql ? ` AND EXISTS (${options.stateGuard.sql})` : ''
  const stateGuardBindings = Array.isArray(options.stateGuard?.bindings) ? options.stateGuard.bindings : []
  const additionalStatements = Array.isArray(options.additionalStatements) ? options.additionalStatements : []
  const stateCommit = prepareStateCommit(db, {
    current,
    nextState,
    scope: 'global',
    currentVersion,
    nextVersion,
    now: commandContext.now,
    actorId: actor.user_id,
    requestId: commandContext.requestId,
  })
  const stateMutation = options.stateGuard?.sql
    ? db.prepare(`
        UPDATE app_state
        SET value_json = ?, version = ?, updated_at = ?, updated_by = ?, last_request_id = ?
        WHERE scope_key = 'global' AND version = ?${stateGuardSql}
      `).bind(
        stateCommit.compactJson,
        nextVersion,
        commandContext.now,
        actor.user_id,
        commandContext.requestId,
        currentVersion,
        ...stateGuardBindings,
      )
    : stateCommit.mutation
  let results
  try {
    results = await db.batch([
      stateMutation,
      ...stateCommit.externalStatements,
      ...additionalStatements,
      db.prepare(`
        INSERT INTO audit_log (
          request_id, actor_id, actor_role, action, entity_type, entity_id,
          before_json, after_json, metadata_json, server_timestamp
        )
        SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        WHERE EXISTS (
          SELECT 1 FROM app_state
          WHERE scope_key = 'global' AND version = ? AND last_request_id = ?
        )
      `).bind(
        commandContext.requestId,
        actor.user_id,
        actor.role,
        options.action,
        options.entityType,
        options.entityId,
        boundedAuditJson(options.before),
        boundedAuditJson(options.after),
        boundedAuditJson(options.metadata),
        commandContext.now,
        nextVersion,
        commandContext.requestId,
      ),
      ...receiptStatements(db, {
        actorId: actor.user_id,
        idempotencyKey: commandContext.idempotencyKey,
        requestHash: commandContext.hash,
        responseJson,
        status: options.status || 200,
        createdAt: commandContext.now,
        successSql: stateSuccessSql,
        successBindings: ['global', nextVersion, commandContext.requestId],
      }),
    ])
  } catch {
    const latest = await loadState(db, 'global')
    throw new ApiError(409, 'VERSION_CONFLICT', 'Dữ liệu đã thay đổi trên máy chủ.', {
      currentVersion: Number(latest?.version || 0),
    })
  }
  if (changes(results?.[0]) !== 1) {
    const latest = await loadState(db, 'global')
    throw new ApiError(409, 'VERSION_CONFLICT', 'Dữ liệu đã thay đổi trên máy chủ.', {
      currentVersion: Number(latest?.version || 0),
    })
  }
  return jsonResponse(responseBody, options.status || 200)
}

const commitGlobalStateCounterDomainCommand = async (
  db,
  actor,
  current,
  nextState,
  counter,
  options,
  commandContext,
) => {
  const currentVersion = Number(current.version)
  const nextVersion = currentVersion + 1
  const counterVersion = Number(counter.row?.version || 0)
  const nextCounterVersion = Number(counter.nextVersion || (counterVersion + 1))
  const status = options.status || 200
  const responseBody = apiPayload(commandContext, {
    ...options.response,
    version: nextVersion,
    counter: { name: counter.name, value: counter.value, version: nextCounterVersion },
  })
  const responseJson = JSON.stringify(responseBody)
  const stateCommit = prepareStateCommit(db, {
    current,
    nextState,
    scope: 'global',
    currentVersion,
    nextVersion,
    now: commandContext.now,
    actorId: actor.user_id,
    requestId: commandContext.requestId,
  })
  const counterMutation = counter.row
    ? db.prepare(`
        UPDATE counters
        SET counter_value = ?, version = ?, updated_at = ?, last_request_id = ?
        WHERE counter_name = ? AND version = ?
      `).bind(counter.value, nextCounterVersion, commandContext.now, commandContext.requestId, counter.name, counterVersion)
    : db.prepare(`
        INSERT OR IGNORE INTO counters (counter_name, counter_value, version, updated_at, last_request_id)
        VALUES (?, ?, ?, ?, ?)
      `).bind(counter.name, counter.value, nextCounterVersion, commandContext.now, commandContext.requestId)
  const counterAliases = (Array.isArray(counter.aliasRows) ? counter.aliasRows : [])
    .filter((row) => String(row.counter_name || '') !== String(counter.name || ''))
  const counterAliasMutations = counterAliases.map((row) => db.prepare(`
    DELETE FROM counters
    WHERE counter_name = ? AND version = ?
  `).bind(row.counter_name, Number(row.version || 0)))
  let results
  try {
    results = await db.batch([
      stateCommit.mutation,
      counterMutation,
      ...counterAliasMutations,
      ...stateCommit.externalStatements,
      db.prepare(`
        INSERT INTO audit_log (
          request_id, actor_id, actor_role, action, entity_type, entity_id,
          before_json, after_json, metadata_json, server_timestamp
        )
        SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        WHERE EXISTS (
          SELECT 1 FROM app_state WHERE scope_key = 'global' AND version = ? AND last_request_id = ?
        ) AND EXISTS (
          SELECT 1 FROM counters WHERE counter_name = ? AND version = ? AND last_request_id = ?
        ) AND NOT EXISTS (
          SELECT 1 FROM counters
          WHERE LOWER(counter_name) = LOWER(?) AND counter_name <> ?
        )
      `).bind(
        commandContext.requestId,
        actor.user_id,
        actor.role,
        options.action,
        options.entityType,
        options.entityId,
        boundedAuditJson(options.before),
        boundedAuditJson(options.after),
        boundedAuditJson(options.metadata),
        commandContext.now,
        nextVersion,
        commandContext.requestId,
        counter.name,
        nextCounterVersion,
        commandContext.requestId,
        counter.name,
        counter.name,
      ),
      ...receiptStatements(db, {
        actorId: actor.user_id,
        idempotencyKey: commandContext.idempotencyKey,
        requestHash: commandContext.hash,
        responseJson,
        status,
        createdAt: commandContext.now,
        successSql: `
          SELECT 1 FROM app_state
          WHERE scope_key = 'global' AND version = ? AND last_request_id = ?
            AND EXISTS (
              SELECT 1 FROM counters WHERE counter_name = ? AND version = ? AND last_request_id = ?
            ) AND NOT EXISTS (
              SELECT 1 FROM counters
              WHERE LOWER(counter_name) = LOWER(?) AND counter_name <> ?
            )
        `,
        successBindings: [
          nextVersion,
          commandContext.requestId,
          counter.name,
          nextCounterVersion,
          commandContext.requestId,
          counter.name,
          counter.name,
        ],
        enforceSuccess: true,
      }),
    ])
  } catch {
    const latest = await loadState(db, 'global')
    throw new ApiError(409, 'VERSION_CONFLICT', 'Dữ liệu hoặc bộ đếm đã thay đổi trên máy chủ.', {
      currentVersion: Number(latest?.version || 0),
    })
  }
  const aliasesChanged = counterAliases.every((_, index) => changes(results?.[2 + index]) === 1)
  if (changes(results?.[0]) !== 1 || changes(results?.[1]) !== 1 || !aliasesChanged) {
    throw new ApiError(409, 'VERSION_CONFLICT', 'Dữ liệu hoặc bộ đếm đã thay đổi trên máy chủ.')
  }
  return jsonResponse(responseBody, status)
}

const serverActorSnapshot = (actor) => ({
  id: actor.user_id,
  name: actor.display_name || actor.username || 'Hệ thống',
  role: actor.role,
})

const assertAdmin = (actor, message = 'Chỉ quản trị viên được thực hiện thao tác này.') => {
  if (actor.role !== 'admin') throw new ApiError(403, 'ROLE_FORBIDDEN', message)
}

const assertOperationsRole = (actor, message = 'Tài khoản không có quyền thực hiện thao tác này.') => {
  if (!OPERATIONS_ROLES.has(actor.role)) throw new ApiError(403, 'ROLE_FORBIDDEN', message)
}

const assertPayrollOperator = (actor, message = 'Chỉ Admin hoặc Nhân viên hỗ trợ KD được quản lý lương cửa hàng.') => {
  if (!PAYROLL_OPERATOR_ROLES.has(actor.role)) throw new ApiError(403, 'ROLE_FORBIDDEN', message)
}

const operationalIdentifierHistoryRepairCommand = async (db, actor, body, commandContext) => {
  assertAdmin(actor, 'Chỉ Admin được xử lý bí danh mã trong lịch sử.')
  if (body.type !== 'operational_identifier.resolve_history_alias') {
    throw new ApiError(400, 'COMMAND_UNKNOWN', 'Lệnh xử lý bí danh lịch sử không được hỗ trợ.')
  }
  const payload = isPlainRecord(body.payload) ? body.payload : {}
  const kind = String(payload.kind || '').trim()
  if (!['employee', 'store'].includes(kind)) {
    throw new ApiError(400, 'IDENTIFIER_KIND_INVALID', 'Loại mã cần xử lý phải là employee hoặc store.')
  }
  const aliasIdentifier = String(payload.aliasIdentifier || payload.historyIdentifier || '').trim()
  const canonicalIdentifier = String(payload.canonicalIdentifier || '').trim()
  const reason = String(payload.reason || '').trim()
  if (!aliasIdentifier || !canonicalIdentifier || aliasIdentifier === canonicalIdentifier
    || !sameIdentifier(aliasIdentifier, canonicalIdentifier)) {
    throw new ApiError(400, 'IDENTIFIER_ALIAS_INVALID', 'Bí danh và mã chuẩn phải khác cách viết hoa/thường nhưng cùng một mã.')
  }
  if (!reason || reason.length > 500) {
    throw new ApiError(400, 'REASON_REQUIRED', 'Cần nhập lý do xử lý bí danh từ 1 đến 500 ký tự.')
  }
  const { current, state } = await loadGlobalCommandState(db, body)
  const collection = kind === 'employee' ? 'employees' : 'stores'
  const historyCollection = kind === 'employee' ? 'deletedEmployees' : 'deletedStores'
  const identifierValues = kind === 'employee'
    ? employeeIdentifierValues
    : (record) => [String(record?.id || '').trim()].filter(Boolean)
  const activeRecords = Array.isArray(state[collection]) ? state[collection] : []
  const canonicalMatches = activeRecords.filter((record) => (
    !record.deletedAt
    && identifierValues(record).some((identifier) => identifier === canonicalIdentifier)
  ))
  if (canonicalMatches.length !== 1) {
    throw new ApiError(409, 'CANONICAL_IDENTIFIER_AMBIGUOUS', 'Không xác định được duy nhất hồ sơ đang hoạt động mang mã chuẩn.')
  }
  const historyRecords = Array.isArray(state[historyCollection]) ? state[historyCollection] : []
  const aliasMatches = historyRecords
    .map((record, index) => ({ record, index }))
    .filter(({ record }) => identifierValues(record).some((identifier) => identifier === aliasIdentifier))
  if (aliasMatches.length !== 1) {
    throw new ApiError(409, 'HISTORY_IDENTIFIER_AMBIGUOUS', 'Không xác định được duy nhất hồ sơ lịch sử mang bí danh cần xử lý.')
  }
  const previous = aliasMatches[0].record
  const identifierFields = kind === 'employee'
    ? ['id', 'code', 'employeeId', 'employeeCode']
    : ['id']
  const originalIdentifiers = Object.fromEntries(identifierFields
    .filter((field) => Object.hasOwn(previous, field))
    .map((field) => [field, previous[field]]))
  const repaired = {
    ...previous,
    ...Object.fromEntries(identifierFields
      .filter((field) => sameIdentifier(previous[field], aliasIdentifier))
      .map((field) => [field, canonicalIdentifier])),
    identifierAliasResolution: {
      aliasIdentifier,
      canonicalIdentifier,
      originalIdentifiers,
      reason,
      resolvedAt: commandContext.now,
      resolvedBy: serverActorSnapshot(actor),
    },
  }
  const nextHistory = historyRecords.map((record, index) => (
    index === aliasMatches[0].index ? repaired : record
  ))
  const nextState = {
    ...state,
    [historyCollection]: nextHistory,
    stateVersion: Math.max(1, Number(state.stateVersion) || 1) + 1,
  }
  return commitGlobalStateDomainCommand(db, actor, current, nextState, {
    action: body.type,
    entityType: `${kind}-history-identifier`,
    entityId: canonicalIdentifier,
    before: previous,
    after: repaired,
    metadata: { kind, aliasIdentifier, canonicalIdentifier, reason },
    response: { command: body.type, kind, record: repaired },
  }, commandContext)
}

const businessSupportCommandAllowed = (body) => {
  const type = String(body?.type || '')
  return BUSINESS_SUPPORT_SELF_SERVICE_COMMANDS.has(type) || BUSINESS_SUPPORT_DOMAIN_COMMANDS.has(type)
}

const assertOperationalStoreAccess = (actor, storeId) => {
  const normalizedStoreId = normalizeIdentifierKey(storeId)
  if (actor.role === 'business_support'
    && (!normalizedStoreId || [OFFICE_STORE_ID, BUSINESS_SUPPORT_STORE_ID, 'ADMIN', 'SYSTEM']
      .map(normalizeIdentifierKey).includes(normalizedStoreId))) {
    throw new ApiError(403, 'OFFICE_FORBIDDEN', 'Nhân viên hỗ trợ kinh doanh không có quyền thao tác Khối văn phòng hoặc đơn vị nội bộ.')
  }
  if (actor.role === 'store_manager'
    && (!normalizedStoreId || !sameIdentifier(normalizedStoreId, actor.store_id))) {
    throw new ApiError(403, 'STORE_SCOPE_FORBIDDEN', 'Quản lý cửa hàng chỉ được thao tác đúng cửa hàng được phân công.')
  }
}

const loadGlobalCommandState = async (db, body) => {
  const expectedVersion = commandExpectedVersion(body)
  const current = body._preloadedGlobalStateRow || await loadState(db, 'global')
  const currentVersion = Number(current?.version || 0)
  if (!current || currentVersion !== expectedVersion) {
    throw new ApiError(409, 'VERSION_CONFLICT', 'Dữ liệu đã thay đổi trên máy chủ.', { currentVersion })
  }
  return {
    current,
    state: normalizeSharedStateForStorage(parseStoredJson(current.value_json, {})),
  }
}

const defaultStoreCodeFromName = (name) => {
  const normalizedName = normalizeTextKey(name)
  if (normalizedName === 'sm tnv') return 'SM-TNV'
  if (!normalizedName.startsWith('dosii ')) return ''
  const branchName = normalizedName.slice('dosii '.length).trim()
  const words = branchName.match(/[a-z0-9]+/gu) || []
  if (!words.length) return ''
  const branchCode = words.length === 1
    ? words[0]
    : words.map((word) => word[0]).join('')
  return branchCode ? `DOSII-${branchCode.toUpperCase().slice(0, 74)}` : ''
}

const nextStoreCode = (state, name = '') => {
  const brandedCode = defaultStoreCodeFromName(name)
  const knownStores = [
    ...(Array.isArray(state.stores) ? state.stores : []),
    ...(Array.isArray(state.deletedStores) ? state.deletedStores : []),
  ]
  const knownIdentifiers = new Set(knownStores
    .map((store) => normalizeIdentifierKey(store?.id))
    .filter(Boolean))
  if (brandedCode) {
    if (!knownIdentifiers.has(normalizeIdentifierKey(brandedCode))) return brandedCode
    let suffix = 2
    const candidateFor = (value) => {
      const suffixText = `-${String(value).padStart(2, '0')}`
      return `${brandedCode.slice(0, 80 - suffixText.length)}${suffixText}`
    }
    while (knownIdentifiers.has(normalizeIdentifierKey(candidateFor(suffix)))) {
      suffix += 1
    }
    return candidateFor(suffix)
  }
  const next = knownStores.reduce((maximum, store) => {
    const match = String(store?.id || '').match(/^CH(\d+)$/iu)
    return match ? Math.max(maximum, Number(match[1])) : maximum
  }, 0) + 1
  return `CH${String(next).padStart(3, '0')}`
}

const storeCommand = async (db, actor, body, commandContext) => {
  assertOperationsRole(actor, 'Chỉ Admin, Nhân viên hỗ trợ KD hoặc Quản lý cửa hàng được cập nhật cửa hàng.')
  const operation = body.type.split('.').at(-1)
  if (!['create', 'update', 'delete'].includes(operation)) {
    throw new ApiError(400, 'COMMAND_UNKNOWN', 'Lệnh cửa hàng không được hỗ trợ.')
  }
  if (operation === 'delete') assertAdmin(actor, 'Chỉ Admin được xóa cửa hàng.')
  if (actor.role === 'store_manager' && operation !== 'update') {
    throw new ApiError(403, 'STORE_SCOPE_FORBIDDEN', 'Quản lý cửa hàng chỉ được cập nhật cửa hàng được phân công.')
  }
  const payload = isPlainRecord(body.payload) ? body.payload : {}
  const { current, state } = await loadGlobalCommandState(db, body)
  const stores = Array.isArray(state.stores) ? state.stores : []
  const requestedName = String(payload.name || '').trim().slice(0, 160)
  const storeId = operation === 'create'
    ? String(payload.id || nextStoreCode(state, requestedName)).trim().toUpperCase()
    : String(payload.storeId || payload.id || '').trim()
  if (operation !== 'create') assertOperationalStoreAccess(actor, storeId)
  if (!/^[A-Za-z0-9_-]{1,80}$/u.test(storeId)) {
    throw new ApiError(400, 'STORE_ID_INVALID', 'Mã cửa hàng không hợp lệ.')
  }
  if (isReservedPhysicalStoreIdentifier(storeId)) {
    throw new ApiError(400, 'STORE_ID_RESERVED', 'Mã đơn vị nội bộ không được dùng làm mã cửa hàng vật lý.')
  }
  const matchingStores = stores
    .map((store, index) => ({ store, index }))
    .filter(({ store }) => sameIdentifier(store.id, storeId))
  if (operation !== 'create' && matchingStores.length > 1) {
    throw new ApiError(
      409,
      'STORE_IDENTIFIER_COLLISION',
      'Mã cửa hàng đang trùng với nhiều bản ghi; cần xử lý dữ liệu trùng trước khi cập nhật.',
      {
        identifier: normalizeIdentifierKey(storeId),
        conflictingIdentifiers: matchingStores.map(({ store }) => String(store.id || '')),
      },
    )
  }
  const existingMatch = matchingStores[0] || null
  const existing = existingMatch?.store || null

  if (operation === 'create') {
    if (existing && !existing.deletedAt) throw new ApiError(409, 'STORE_EXISTS', 'Mã cửa hàng đã tồn tại.')
    if ((Array.isArray(state.deletedStores) ? state.deletedStores : []).some((store) => sameIdentifier(store.id, storeId))) {
      throw new ApiError(409, 'STORE_ID_RETIRED', 'Mã cửa hàng đã được sử dụng và không thể cấp lại.')
    }
    const name = requestedName
    if (!name) throw new ApiError(400, 'STORE_NAME_INVALID', 'Tên cửa hàng không được để trống.')
    if (stores.some((store) => !store.deletedAt && normalizeTextKey(store.name) === normalizeTextKey(name))) {
      throw new ApiError(409, 'STORE_EXISTS', 'Tên cửa hàng đã tồn tại.')
    }
    const phone = String(payload.phone || '').replace(/\D/gu, '')
    if (phone && !/^0\d{9}$/u.test(phone)) {
      throw new ApiError(400, 'PHONE_INVALID', 'Số điện thoại cửa hàng phải có đúng 10 số và bắt đầu bằng số 0.')
    }
    const email = String(payload.email || '').trim().toLowerCase()
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) {
      throw new ApiError(400, 'EMAIL_INVALID', 'Email cửa hàng không đúng định dạng.')
    }
    const tax = String(payload.tax ?? payload.taxCode ?? '').trim().slice(0, 64)
    const operatingHours = isPlainRecord(payload.operatingHours) ? payload.operatingHours : {}
    const opening = parseShiftTime(payload.opening ?? payload.openingTime ?? operatingHours.opening ?? '07:00')
    const closing = parseShiftTime(payload.closing ?? payload.closingTime ?? operatingHours.closing ?? '23:00')
    if (!opening || !closing || closing.minuteOfDay <= opening.minuteOfDay) {
      throw new ApiError(400, 'STORE_HOURS_INVALID', 'Giờ mở/đóng cửa phải theo định dạng 24 giờ và giờ đóng phải sau giờ mở.')
    }
    const store = {
      id: storeId,
      name,
      short: String(payload.short || name.replace(/^(?:IDOSI|SecondMall)\s*/iu, '')).trim().slice(0, 80),
      location: String(payload.location || '').trim().slice(0, 160),
      address: String(payload.address || '').trim().slice(0, 500),
      phone,
      email: email.slice(0, 254),
      tax,
      taxCode: tax,
      opening: opening.label,
      openingTime: opening.label,
      closing: closing.label,
      closingTime: closing.label,
      operatingHours: { opening: opening.label, closing: closing.label },
      status: ['Ngưng hoạt động', 'inactive'].includes(String(payload.status)) ? 'Ngưng hoạt động' : 'Đang hoạt động',
      accent: String(payload.accent || '#075fba').trim().slice(0, 32),
      employees: 0,
      revenue: 0,
      expense: 0,
      createdAt: commandContext.now,
      createdBy: serverActorSnapshot(actor),
    }
    const nextState = {
      ...state,
      stores: [store, ...stores.filter((item) => !sameIdentifier(item.id, storeId))],
      stateVersion: Math.max(1, Number(state.stateVersion) || 1) + 1,
    }
    return commitGlobalStateDomainCommand(db, actor, current, nextState, {
      action: body.type,
      entityType: 'store',
      entityId: storeId,
      before: null,
      after: store,
      response: { command: body.type, store },
      status: 201,
    }, commandContext)
  }

  if (!existing || existing.deletedAt) throw new ApiError(404, 'STORE_NOT_FOUND', 'Không tìm thấy cửa hàng.')
  const canonicalStoreId = String(existing.id || storeId)
  if (operation === 'delete') {
    const hasOrders = (Array.isArray(state.orders) ? state.orders : []).some((order) => (
      sameIdentifier(order.storeId, storeId) && !order.deletedAt && order.status !== 'Đã xóa'
      && order.source !== 'legacy-opening-balance'
    ))
    const hasEmployees = (Array.isArray(state.employees) ? state.employees : []).some((employee) => (
      sameIdentifier(employee.storeId, storeId) && !employee.deletedAt
      && !['Đã nghỉ việc', 'inactive'].includes(String(employee.status || ''))
    ))
    if (hasOrders || hasEmployees) {
      throw new ApiError(409, 'STORE_IN_USE', 'Không thể xóa cửa hàng đang có đơn hàng hoặc nhân viên.')
    }
    const deleted = { ...existing, deletedAt: commandContext.now, deletedBy: serverActorSnapshot(actor) }
    const nextState = {
      ...state,
      stores: stores.filter((_, index) => index !== existingMatch.index),
      deletedStores: [deleted, ...(Array.isArray(state.deletedStores) ? state.deletedStores : [])],
      stateVersion: Math.max(1, Number(state.stateVersion) || 1) + 1,
    }
    return commitGlobalStateDomainCommand(db, actor, current, nextState, {
      action: body.type,
      entityType: 'store',
      entityId: canonicalStoreId,
      before: existing,
      after: null,
      response: { command: body.type, store: deleted },
    }, commandContext)
  }

  const candidate = { ...existing }
  if (payload.name !== undefined) candidate.name = String(payload.name || '').trim().slice(0, 160)
  if (payload.short !== undefined) candidate.short = String(payload.short || '').trim().slice(0, 80)
  if (payload.location !== undefined) candidate.location = String(payload.location || '').trim().slice(0, 160)
  if (payload.address !== undefined) candidate.address = String(payload.address || '').trim().slice(0, 500)
  if (payload.accent !== undefined) candidate.accent = String(payload.accent || '').trim().slice(0, 32)
  if (payload.phone !== undefined) candidate.phone = String(payload.phone || '').replace(/\D/gu, '')
  if (payload.email !== undefined) candidate.email = String(payload.email || '').trim().toLowerCase().slice(0, 254)
  if (payload.tax !== undefined || payload.taxCode !== undefined) {
    candidate.tax = String(payload.tax ?? payload.taxCode ?? '').trim().slice(0, 64)
    candidate.taxCode = candidate.tax
  }
  const operatingHours = isPlainRecord(payload.operatingHours) ? payload.operatingHours : {}
  if (payload.opening !== undefined || payload.openingTime !== undefined || operatingHours.opening !== undefined) {
    candidate.opening = String(payload.opening ?? payload.openingTime ?? operatingHours.opening ?? '').trim()
    candidate.openingTime = candidate.opening
  }
  if (payload.closing !== undefined || payload.closingTime !== undefined || operatingHours.closing !== undefined) {
    candidate.closing = String(payload.closing ?? payload.closingTime ?? operatingHours.closing ?? '').trim()
    candidate.closingTime = candidate.closing
  }
  if (payload.status !== undefined) {
    const status = String(payload.status || '')
    if (!['Đang hoạt động', 'Ngưng hoạt động', 'Hoạt động'].includes(status)) {
      throw new ApiError(400, 'STORE_STATUS_INVALID', 'Trạng thái cửa hàng không hợp lệ.')
    }
    candidate.status = status === 'Hoạt động' ? 'Đang hoạt động' : status
  }
  if (!candidate.name || !candidate.short) {
    throw new ApiError(400, 'STORE_INVALID', 'Tên và tên viết tắt của cửa hàng là bắt buộc.')
  }
  if (candidate.phone && !/^0\d{9}$/u.test(candidate.phone)) {
    throw new ApiError(400, 'PHONE_INVALID', 'Số điện thoại cửa hàng phải có đúng 10 số và bắt đầu bằng số 0.')
  }
  if (candidate.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(candidate.email)) {
    throw new ApiError(400, 'EMAIL_INVALID', 'Email cửa hàng không đúng định dạng.')
  }
  const opening = parseShiftTime(candidate.opening ?? candidate.openingTime ?? '07:00')
  const closing = parseShiftTime(candidate.closing ?? candidate.closingTime ?? '23:00')
  if (!opening || !closing || closing.minuteOfDay <= opening.minuteOfDay) {
    throw new ApiError(400, 'STORE_HOURS_INVALID', 'Giờ mở/đóng cửa phải theo định dạng 24 giờ và giờ đóng phải sau giờ mở.')
  }
  candidate.opening = opening.label
  candidate.openingTime = opening.label
  candidate.closing = closing.label
  candidate.closingTime = closing.label
  candidate.operatingHours = { opening: opening.label, closing: closing.label }
  const changedFields = [
    'name', 'short', 'location', 'address', 'accent', 'status', 'phone', 'email',
    'tax', 'taxCode', 'opening', 'openingTime', 'closing', 'closingTime', 'operatingHours',
  ]
    .filter((key) => JSON.stringify(candidate[key]) !== JSON.stringify(existing[key]))
  if (!changedFields.length) {
    return recordNoopCommand(db, actor, {
      command: body.type,
      version: Number(current.version),
      store: existing,
      existing: true,
    }, 200, commandContext)
  }
  const updated = { ...candidate, updatedAt: commandContext.now, updatedBy: serverActorSnapshot(actor) }
  const nextState = {
    ...state,
    stores: stores.map((store, index) => index === existingMatch.index ? updated : store),
    stateVersion: Math.max(1, Number(state.stateVersion) || 1) + 1,
  }
  return commitGlobalStateDomainCommand(db, actor, current, nextState, {
    action: body.type,
    entityType: 'store',
    entityId: storeId,
    before: existing,
    after: updated,
    metadata: { changedFields },
    response: { command: body.type, store: updated },
  }, commandContext)
}

const requestedWorkCatalogItemId = (task) => String(
  task?.catalogItemId
  || task?.catalogSnapshot?.catalogItemId
  || task?.catalogSnapshot?.id
  || '',
).trim()

const workTaskIsRequired = (task) => {
  if (task?.required === true) return true
  if (task?.required === false) return false
  const catalogKind = String(task?.kind || task?.catalogKind || task?.catalogSnapshot?.kind || '').trim().toUpperCase()
  return catalogKind !== WORK_CATALOG_KIND.REWARD_TASK
}

const activeCatalogTaskSnapshots = (state, rawTasks, {
  targetGroup,
  storeId = null,
  date,
  shiftId = null,
  shiftName = null,
}) => {
  assertNoCaseCollidingActiveWorkCatalogIdentifiers(state)
  const requestedIds = new Set((Array.isArray(rawTasks) ? rawTasks : [])
    .map(requestedWorkCatalogItemId)
    .map(normalizeIdentifierKey)
    .filter(Boolean))
  if (!requestedIds.size) return new Map()
  let snapshots
  try {
    snapshots = snapshotActiveWorkCatalogItems({
      items: state.workCatalogItems,
      targetGroup,
      storeId,
      date,
      shiftId,
      shiftName,
    })
  } catch (error) {
    throw new ApiError(409, 'WORK_CATALOG_DATA_INVALID', 'Danh mục công việc đang có dữ liệu không hợp lệ.', {
      reason: error instanceof Error ? error.message : String(error),
    })
  }
  return new Map(snapshots
    .filter((snapshot) => requestedIds.has(normalizeIdentifierKey(snapshot.catalogItemId)))
    .map((snapshot) => [normalizeIdentifierKey(snapshot.catalogItemId), snapshot]))
}

const assignedCatalogTaskMetadata = (rawTask, activeSnapshots, scope) => {
  const catalogItemId = requestedWorkCatalogItemId(rawTask)
  if (!catalogItemId) return null
  const snapshot = activeSnapshots.get(normalizeIdentifierKey(catalogItemId))
  if (!snapshot) {
    throw new ApiError(400, 'WORK_CATALOG_TASK_INVALID', 'Công việc danh mục không còn hoạt động hoặc không đúng phạm vi được giao.', {
      catalogItemId,
      targetGroup: scope.targetGroup,
      storeId: scope.storeId || null,
      date: scope.date,
      shiftId: scope.shiftId || null,
    })
  }
  const submittedVersion = rawTask.catalogVersion ?? rawTask.catalogSnapshot?.catalogVersion
  if (submittedVersion !== undefined && submittedVersion !== null && submittedVersion !== '') {
    const normalizedVersion = Number(submittedVersion)
    if (!Number.isSafeInteger(normalizedVersion) || normalizedVersion < 1) {
      throw new ApiError(400, 'WORK_CATALOG_VERSION_INVALID', 'Phiên bản công việc danh mục không hợp lệ.', {
        catalogItemId,
      })
    }
    if (normalizedVersion !== snapshot.catalogVersion) {
      throw new ApiError(409, 'WORK_CATALOG_VERSION_CONFLICT', 'Công việc danh mục đã thay đổi; vui lòng tải lại danh sách trước khi giao.', {
        catalogItemId,
        requestedVersion: normalizedVersion,
        currentVersion: snapshot.catalogVersion,
      })
    }
  }
  const catalogSnapshot = { ...snapshot }
  return {
    catalogItemId: snapshot.catalogItemId,
    catalogCode: snapshot.catalogCode,
    catalogVersion: snapshot.catalogVersion,
    kind: snapshot.kind,
    catalogKind: snapshot.kind,
    amountVnd: snapshot.amountVnd,
    required: snapshot.required === true,
    rewardEligible: snapshot.kind === WORK_CATALOG_KIND.REWARD_TASK,
    catalogSnapshot,
  }
}

const catalogTaskHistoryMetadata = (task) => task?.catalogItemId ? {
  catalogItemId: task.catalogItemId,
  catalogCode: task.catalogCode,
  catalogVersion: task.catalogVersion,
  kind: task.kind || task.catalogKind,
  amountVnd: Number(task.amountVnd || 0),
  required: workTaskIsRequired(task),
  ...(isPlainRecord(task.catalogSnapshot) ? { catalogSnapshot: { ...task.catalogSnapshot } } : {}),
} : {}

const throwShiftIdentifierCollision = (matches, shiftId) => {
  throw new ApiError(
    409,
    'SHIFT_IDENTIFIER_COLLISION',
    'Mã ca làm việc đang trùng với nhiều bản ghi; không thể xác định ca an toàn.',
    {
      identifier: normalizeIdentifierKey(shiftId),
      conflictingIdentifiers: matches.map((shift) => String(shift?.id || '')),
    },
  )
}

const uniqueShiftDefinitionMatch = (definitions, shiftId) => {
  const matches = (Array.isArray(definitions) ? definitions : [])
    .filter((definition) => sameIdentifier(definition?.id, shiftId))
  if (matches.length > 1) throwShiftIdentifierCollision(matches, shiftId)
  return matches[0] || null
}

const assertUniqueShiftDefinitionIdentifiers = (definitions) => {
  const definitionsByIdentifier = new Map()
  for (const definition of Array.isArray(definitions) ? definitions : []) {
    const identifier = normalizeIdentifierKey(definition?.id)
    if (!identifier) continue
    const matches = definitionsByIdentifier.get(identifier) || []
    matches.push(definition)
    if (matches.length > 1) throwShiftIdentifierCollision(matches, definition?.id)
    definitionsByIdentifier.set(identifier, matches)
  }
}

const taskAssignmentCommand = async (db, actor, body, commandContext) => {
  assertOperationsRole(actor, 'Tài khoản không có quyền giao việc cửa hàng.')
  if (!['tasks.assign', 'tasks.replace_scope'].includes(body.type)) {
    throw new ApiError(400, 'COMMAND_UNKNOWN', 'Lệnh giao việc cửa hàng không được hỗ trợ.')
  }
  const payload = isPlainRecord(body.payload) ? body.payload : {}
  const requestedStoreId = String(payload.storeId || '').trim()
  assertOperationalStoreAccess(actor, requestedStoreId)
  const date = String(payload.date || '').trim()
  let shiftId = String(payload.shiftId || '').trim()
  if (!/^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/u.test(date)) {
    throw new ApiError(400, 'TASK_DATE_INVALID', 'Ngày giao việc phải có định dạng YYYY-MM-DD.')
  }
  if (shiftId && !/^[A-Za-z0-9_-]{1,80}$/u.test(shiftId)) {
    throw new ApiError(400, 'SHIFT_INVALID', 'Ca làm việc không hợp lệ.')
  }
  if (!Array.isArray(payload.tasks) || payload.tasks.length > 100
    || (body.type === 'tasks.assign' && payload.tasks.length < 1)) {
    throw new ApiError(400, 'TASKS_INVALID', 'Danh sách giao việc phải có từ 1 đến 100 công việc.')
  }
  const { current, state } = await loadGlobalCommandState(db, body)
  const store = requireStore(state, requestedStoreId)
  const storeId = String(store.id || requestedStoreId)
  let shift = null
  if (shiftId) {
    const scopedShiftDefinitions = (Array.isArray(state.shiftDefinitions) ? state.shiftDefinitions : [])
      .filter((definition) => (
        sameIdentifier(definition.storeId, storeId)
        && !definition.deletedAt
        && definition.active !== false
      ))
    shift = uniqueShiftDefinitionMatch(scopedShiftDefinitions, shiftId)
    if (!shift) {
      throw new ApiError(400, 'SHIFT_INVALID', 'Ca làm việc không tồn tại hoặc không thuộc cửa hàng.')
    }
    shiftId = String(shift.id || shiftId)
    if (shift.date && String(shift.date) !== date) {
      throw new ApiError(400, 'SHIFT_DATE_MISMATCH', `Ca ${shift.name || shift.id} chỉ áp dụng ngày ${shift.date}.`)
    }
  }
  const requestedEmployeeIds = Array.isArray(payload.employeeIds)
    ? [...new Map(payload.employeeIds
      .map((value) => String(value || '').trim())
      .filter(Boolean)
      .map((value) => [normalizeIdentifierKey(value), value])).values()]
    : []
  if (body.type === 'tasks.assign' && !requestedEmployeeIds.length) {
    throw new ApiError(400, 'TASK_ASSIGNEES_REQUIRED', 'Cần chọn ít nhất một nhân viên nhận việc.')
  }
  const activeStoreEmployees = new Map((Array.isArray(state.employees) ? state.employees : [])
    .filter((employee) => (
      employeeWorksAtStoreOnDate(state, employee, storeId, date)
      && employeeUnit(employee) === 'store'
      && !employee.deletedAt
      && !['da nghi viec', 'tam ngung', 'inactive', 'locked'].includes(normalizeTextKey(employee.status))
    ))
    .map((employee) => [normalizeIdentifierKey(employee.id || employee.code), employee]))
  const invalidEmployeeIds = requestedEmployeeIds.filter((employeeId) => !activeStoreEmployees.has(normalizeIdentifierKey(employeeId)))
  if (invalidEmployeeIds.length) {
    throw new ApiError(400, 'EMPLOYEE_STORE_MISMATCH', 'Danh sách nhận việc có nhân viên không thuộc cửa hàng hoặc không còn hoạt động.', {
      employeeIds: invalidEmployeeIds,
    })
  }
  const employeeIds = requestedEmployeeIds.map((employeeId) => {
    const employee = activeStoreEmployees.get(normalizeIdentifierKey(employeeId))
    return String(employee?.id || employee?.code || employeeId)
  })
  const catalogScope = {
    targetGroup: WORK_CATALOG_TARGET.STORE,
    storeId,
    date,
    shiftId: shiftId || null,
    shiftName: shift?.name || shift?.shiftName || null,
  }
  const activeCatalogSnapshots = activeCatalogTaskSnapshots(state, payload.tasks, catalogScope)
  const assignmentId = `tsa_${crypto.randomUUID()}`
  const existingTasks = Array.isArray(state.tasks) ? state.tasks : []
  const previousTasks = existingTasks.filter((task) => (
    sameIdentifier(task.storeId, storeId)
    && normalizeIdentifierKey(task.shiftId || task.shift) === normalizeIdentifierKey(shiftId)
    && String(task.date || task.workDate || '') === date
    && !String(task.checklistAttendanceId || '').trim()
  ))
  const replaceableTaskIds = new Set(body.type === 'tasks.replace_scope'
    ? previousTasks.map((task) => normalizeIdentifierKey(task.id)).filter(Boolean)
    : [])
  const existingTaskIds = new Set(existingTasks.map((task) => normalizeIdentifierKey(task.id)).filter(Boolean))
  const seenTaskIds = new Set()
  const seenCatalogItemIds = new Set()
  const tasks = payload.tasks.map((rawTask, index) => {
    if (!isPlainRecord(rawTask)) throw new ApiError(400, 'TASK_INVALID', `Công việc thứ ${index + 1} không hợp lệ.`)
    const catalogMetadata = assignedCatalogTaskMetadata(rawTask, activeCatalogSnapshots, catalogScope)
    if (catalogMetadata && seenCatalogItemIds.has(catalogMetadata.catalogItemId)) {
      throw new ApiError(400, 'WORK_CATALOG_TASK_DUPLICATE', 'Không được giao trùng một công việc danh mục trong cùng lượt.', {
        catalogItemId: catalogMetadata.catalogItemId,
      })
    }
    if (catalogMetadata) seenCatalogItemIds.add(catalogMetadata.catalogItemId)
    const title = String(catalogMetadata?.catalogSnapshot?.name || rawTask.title || '')
      .trim()
      .slice(0, catalogMetadata ? 300 : 240)
    const detail = String(rawTask.detail || '').trim().slice(0, 2_000)
    if (!title) throw new ApiError(400, 'TASK_TITLE_REQUIRED', `Công việc thứ ${index + 1} chưa có nội dung.`)
    const taskId = String(rawTask.id || `task_${crypto.randomUUID()}`).trim().slice(0, 160)
    const taskKey = normalizeIdentifierKey(taskId)
    if (!/^[A-Za-z0-9_-]{1,160}$/u.test(taskId) || seenTaskIds.has(taskKey)) {
      throw new ApiError(400, 'TASK_ID_INVALID', 'Mã công việc phải hợp lệ và không được trùng trong cùng lượt giao.')
    }
    if (existingTaskIds.has(taskKey) && !replaceableTaskIds.has(taskKey)) {
      throw new ApiError(409, 'TASK_ID_EXISTS', 'Mã công việc đã tồn tại trong lịch sử giao việc đang hoạt động.')
    }
    seenTaskIds.add(taskKey)
    return {
      id: taskId,
      assignmentId,
      storeId,
      storeName: store.name,
      shiftId,
      date,
      employeeIds,
      title,
      detail,
      ...(catalogMetadata || {}),
      done: false,
      completedBy: {},
      createdAt: commandContext.now,
      createdBy: serverActorSnapshot(actor),
      assignedAt: commandContext.now,
      assignedBy: serverActorSnapshot(actor),
    }
  })
  const replaced = body.type === 'tasks.replace_scope'
  const notifications = employeeIds.map((employeeId) => {
    const employee = activeStoreEmployees.get(normalizeIdentifierKey(employeeId))
    return {
      id: `ntf_${crypto.randomUUID()}`,
      type: 'store-task-assigned',
      storeId,
      employeeId,
      assignmentId,
      taskIds: tasks.map((task) => task.id),
      date,
      shiftId,
      route: '/employee/home',
      title: 'Bạn có công việc mới',
      message: `${actor.display_name || actor.username || 'Quản lý'} đã giao ${tasks.length} công việc cho ${employee?.name || employeeId} ngày ${date}.`,
      createdAt: commandContext.now,
      createdBy: serverActorSnapshot(actor),
      readAt: null,
    }
  })
  const history = {
    id: assignmentId,
    historyId: `tah_${crypto.randomUUID()}`,
    assignmentId,
    action: replaced ? 'scope-replaced' : 'assigned',
    storeId,
    storeName: store.name,
    date,
    shiftId,
    employeeIds,
    taskCount: tasks.length,
    tasks: tasks.map((task) => ({
      id: task.id,
      title: task.title,
      detail: task.detail,
      employeeIds: task.employeeIds,
      completedBy: {},
      ...catalogTaskHistoryMetadata(task),
    })),
    ...(replaced ? {
      replacedTasks: previousTasks.map((task) => ({
        id: task.id,
        assignmentId: task.assignmentId || null,
        title: task.title,
        detail: task.detail || '',
        employeeIds: Array.isArray(task.employeeIds) ? task.employeeIds : [],
        completedBy: isPlainRecord(task.completedBy) ? task.completedBy : {},
        createdAt: task.createdAt || null,
        ...catalogTaskHistoryMetadata(task),
      })),
    } : {}),
    createdAt: commandContext.now,
    createdBy: serverActorSnapshot(actor),
  }
  const nextState = {
    ...state,
    tasks: replaced
      ? [
          ...tasks,
          ...existingTasks.filter((task) => !(
        sameIdentifier(task.storeId, storeId)
        && normalizeIdentifierKey(task.shiftId || task.shift) === normalizeIdentifierKey(shiftId)
        && String(task.date || task.workDate || '') === date
        && !String(task.checklistAttendanceId || '').trim()
      )),
        ]
      : [...tasks, ...existingTasks],
    taskAssignmentHistory: [history, ...(Array.isArray(state.taskAssignmentHistory) ? state.taskAssignmentHistory : [])],
    notifications: [...notifications, ...(Array.isArray(state.notifications) ? state.notifications : [])],
    stateVersion: Math.max(1, Number(state.stateVersion) || 1) + 1,
  }
  return commitGlobalStateDomainCommand(db, actor, current, nextState, {
    action: body.type,
    entityType: 'task-assignment',
    entityId: assignmentId,
    before: replaced ? previousTasks : null,
    after: tasks,
    metadata: {
      storeId, date, shiftId, employeeIds, taskCount: tasks.length,
      catalogTaskCount: tasks.filter((task) => Boolean(task.catalogItemId)).length,
      replaced, notificationIds: notifications.map((notification) => notification.id),
    },
    response: {
      command: body.type, assignmentId, storeId, date, shiftId, employeeIds,
      tasks, notifications, history,
    },
    status: replaced ? 200 : 201,
  }, commandContext)
}

const STORE_EMPLOYEE_PREFIXES = new Map([
  ['SECOND MALL SM234', 'SM234'],
  ['SM234', 'SM234'],
  ['TO NGOC VAN', 'TNV'],
  ['TNV', 'TNV'],
  ['DI AN', 'DIAN'],
  ['DIAN', 'DIAN'],
  ['KHA VAN CAN', 'KVC'],
  ['KVC', 'KVC'],
  ['TAY HOA', 'TH'],
  ['TH', 'TH'],
  ['NGUYEN VAN THUONG', 'NVT'],
  ['NVT', 'NVT'],
  ['NO TRANG LONG', 'NTL'],
  ['NTL', 'NTL'],
  ['LE VAN THO', 'LVT'],
  ['LVT', 'LVT'],
  ['BUON MA THUOT', 'BMT'],
  ['BUON MA THUOC', 'BMT'],
  ['BMT', 'BMT'],
  ['CAN THO', 'CT'],
  ['CT', 'CT'],
])

const asciiUpper = (value) => String(value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/gu, '')
  .replace(/Đ/gu, 'D')
  .replace(/đ/gu, 'd')
  .toUpperCase()
  .replace(/[^A-Z0-9]+/gu, ' ')
  .trim()

const storeEmployeePrefix = (store) => {
  const rawCandidates = [store?.employeePrefix, store?.short, store?.name]
    .map((value) => asciiUpper(value))
    .filter(Boolean)
  const candidates = rawCandidates.map((value) => value.replace(/^IDOSI\s+/u, ''))
  const identity = rawCandidates.join(' ')
  const brand = /\bDOSII\b/u.test(identity)
    ? 'DOSII'
    : (/\bDOSSI\b/u.test(identity)
        ? 'DOSSI'
        : (/\bSM\b/u.test(identity) ? 'SM' : ''))
  for (const candidate of candidates) {
    if (STORE_EMPLOYEE_PREFIXES.has(candidate)) {
      const branch = STORE_EMPLOYEE_PREFIXES.get(candidate)
      if (branch === 'SM234') return branch
      return brand ? `${brand}-${branch}` : branch
    }
    if (/\d/u.test(candidate)) return candidate.replace(/\s+/gu, '').slice(0, 12)
  }
  const words = (candidates[0] || 'NV').split(/\s+/u).filter(Boolean)
  return words.map((word) => word[0]).join('').slice(0, 8) || 'NV'
}

const nextEmployeeCode = (state, store, unit = null) => {
  const normalizedUnit = unit || (String(store?.id || '') === OFFICE_STORE_ID ? 'office' : 'store')
  const prefix = storeEmployeePrefix(store)
  const pattern = normalizedUnit === 'office'
    ? /^VP-?(\d+)$/u
    : (normalizedUnit === 'business_support'
      ? /^HTKD-?(\d+)$/u
      : (normalizedUnit === 'store_manager'
        ? /^(?:QLCH-|QL-[A-Z0-9]+-)(\d+)$/u
        : new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}-(\\d+)$`, 'u')))
  const knownEmployees = [
    ...(Array.isArray(state.employees) ? state.employees : []),
    ...(Array.isArray(state.deletedEmployees) ? state.deletedEmployees : []),
  ]
  const next = knownEmployees.reduce((maximum, employee) => {
    const match = String(employee.id || employee.code || employee.employeeCode || '').toUpperCase().match(pattern)
    return match ? Math.max(maximum, Number(match[1])) : maximum
  }, 0) + 1
  if (normalizedUnit === 'office') return `VP-${String(next).padStart(3, '0')}`
  if (normalizedUnit === 'business_support') return `HTKD-${String(next).padStart(3, '0')}`
  if (normalizedUnit === 'store_manager') return `QLCH-${String(next).padStart(3, '0')}`
  return `${prefix}-${String(next).padStart(3, '0')}`
}

const employeeStatusValues = (value) => {
  const normalized = normalizeTextKey(value)
  if (['active', 'dang lam viec', 'dang hoat dong'].includes(normalized)) {
    return { profile: 'Đang làm việc', account: 'active' }
  }
  if (['locked', 'tam ngung', 'tam nghi'].includes(normalized)) {
    return { profile: 'Tạm ngưng', account: 'locked' }
  }
  if (['inactive', 'da nghi viec'].includes(normalized)) {
    return { profile: 'Đã nghỉ việc', account: 'inactive' }
  }
  throw new ApiError(400, 'STATUS_INVALID', 'Trạng thái nhân viên không hợp lệ.')
}

const normalizeEmployeeUnitRequest = (payload, previous = null) => {
  if (previous) return employeeUnit(previous)
  const raw = String(payload.unit || payload.unitType || payload.department || payload.role || '').trim().toLowerCase()
  if (['business_support', 'business-support', 'support'].includes(raw)) return 'business_support'
  if (['store_manager', 'store-manager', 'manager'].includes(raw)) return 'store_manager'
  if (raw === 'office' || sameIdentifier(payload.storeId, OFFICE_STORE_ID)) return 'office'
  return 'store'
}

const OPERATIONAL_PROFILE_FIELDS = new Set([
  'employeeId', 'id', 'code', 'employeeCode',
  'unit', 'unitType', 'department', 'role', 'storeId',
  'name', 'phone', 'cccd', 'citizenId', 'address', 'addressDetails', 'startDate', 'joinDate',
  'employmentType', 'position', 'jobPosition', 'username', 'password', 'authUserId',
  'status',
  'workTimeType', 'workStart', 'workEnd', 'workShifts', 'workingTime',
  'baseSalary', 'standardWorkDays', 'requiredMonthlyHours', 'linkedEmployeeId',
  'identityImages', 'cccdImages', 'identityCardImages', 'cccdFront', 'cccdBack',
])

const PROFILE_WORKING_TIME_FIELDS = new Set([
  'workTimeType', 'workStart', 'workEnd', 'workShifts', 'workingTime',
])

const STORE_SALARY_CONFIG_INPUT_FIELDS = new Set([
  'thresholdHours', 'thresholdSeconds', 'standardHourlyRateVnd', 'regularHourlyRateVnd',
  'excessHourlyRateVnd', 'effectiveFrom', 'storePolicy', 'salaryConfig',
])

const STORE_LEGACY_FULL_TIME_SALARY_FIELDS = new Set([
  'salary', 'baseSalary', 'monthlySalary', 'hourlyRate', 'payBasis', 'salaryBasis',
  'salaryUnit', 'payFormula', 'requiredMonthlyHours', 'standardWorkDays',
  'storeSalaryConfigRequired',
])

const operationalEmploymentType = (value) => {
  const normalized = normalizeTextKey(value).replace(/[ _]+/gu, '-')
  if (normalized === 'full-time') return 'Full-Time'
  if (normalized === 'part-time') return 'Part-Time'
  if (normalized === 'thuc-tap-sinh') return 'Thực Tập Sinh'
  throw new ApiError(400, 'EMPLOYMENT_TYPE_INVALID', 'Loại nhân viên phải là Full-Time, Part-Time hoặc Thực Tập Sinh.')
}

const officeEmploymentType = (value) => {
  const normalized = normalizeTextKey(value).replace(/[ _]+/gu, '-')
  if (['full-time', 'chinh-thuc', 'thu-viec'].includes(normalized)) return 'Full-Time'
  if (normalized === 'part-time') return 'Part-Time'
  if (['thuc-tap-sinh', 'thuc-tap'].includes(normalized)) return 'Thực Tập Sinh'
  throw new ApiError(400, 'EMPLOYMENT_TYPE_INVALID', 'Loại nhân viên Khối văn phòng phải là Full-Time, Part-Time hoặc Thực Tập Sinh.')
}

const officePosition = (value) => {
  const normalized = normalizeTextKey(value)
  if (normalized === 'ke toan') return 'Kế Toán'
  if (normalized === 'marketing') return 'Marketing'
  throw new ApiError(400, 'POSITION_INVALID', 'Vị trí công việc Khối văn phòng phải là Kế Toán hoặc Marketing.')
}

const normalizeAddressDetails = (value) => {
  if (value === undefined || value === null) return null
  if (!isPlainRecord(value)) {
    throw new ApiError(400, 'ADDRESS_DETAILS_INVALID', 'Thông tin địa chỉ chi tiết không hợp lệ.')
  }
  const province = String(value.province || '').trim()
  const ward = String(value.ward || '').trim()
  const street = String(value.street || '').trim()
  if ([province, ward, street].some((part) => part.length > 200)) {
    throw new ApiError(400, 'ADDRESS_DETAILS_INVALID', 'Mỗi phần địa chỉ không được vượt quá 200 ký tự.')
  }
  return { province, ward, street }
}

const operationalPosition = (value, unit) => {
  const expected = unit === 'business_support' ? 'NV hỗ trợ KD' : 'Quản lý cửa hàng'
  if (value == null || String(value).trim() === '') return expected
  if (normalizeTextKey(value) !== normalizeTextKey(expected)) {
    throw new ApiError(400, 'POSITION_INVALID', `Vị trí công việc phải là ${expected}.`)
  }
  return expected
}

const MAX_REQUIRED_MONTHLY_HOURS = 744
const MAX_PROFILE_WORK_SHIFTS = 12

const expectedWorkTimeType = (employmentType) => (
  employmentType === 'Full-Time' ? 'Full-Time' : 'Part-Time'
)

const profileWorkShiftId = (value, index) => {
  const safe = String(value || '').trim().replace(/[^A-Za-z0-9_-]/gu, '_').slice(0, 80)
  return safe || `work_${index + 1}`
}

const normalizeProfileWorkingTime = (payload, previous, employmentType) => {
  const workTimeType = expectedWorkTimeType(employmentType)
  const requestedType = payload.workTimeType ?? payload.workingTime?.type
  if (requestedType !== undefined && String(requestedType).trim() !== workTimeType) {
    throw new ApiError(400, 'OFFICE_WORK_TIME_TYPE_INVALID', 'Loại thời gian làm việc phải khớp với loại nhân viên.')
  }
  const hasCanonicalPayload = Object.hasOwn(payload, 'workShifts') || Object.hasOwn(payload, 'workingTime')
  const canonicalInput = payload.workShifts ?? payload.workingTime?.shifts
  let rawShifts
  if (hasCanonicalPayload) {
    if (!Array.isArray(canonicalInput)) {
      throw new ApiError(400, 'OFFICE_WORK_SHIFTS_INVALID', 'Danh sách ca làm việc không hợp lệ.')
    }
    rawShifts = canonicalInput
  } else if (payload.workStart !== undefined || payload.workEnd !== undefined) {
    rawShifts = [{
      id: workTimeType === 'Full-Time' ? 'full_time' : 'work_1',
      name: workTimeType === 'Full-Time' ? 'Giờ hành chính' : 'Ca 1',
      start: payload.workStart ?? previous?.workStart,
      end: payload.workEnd ?? previous?.workEnd,
    }]
  } else if (Array.isArray(previous?.workShifts)) {
    rawShifts = previous.workShifts
  } else if (Array.isArray(previous?.workingTime?.shifts)) {
    rawShifts = previous.workingTime.shifts
  } else {
    rawShifts = [{
      id: workTimeType === 'Full-Time' ? 'full_time' : 'work_1',
      name: workTimeType === 'Full-Time' ? 'Giờ hành chính' : 'Ca 1',
      start: previous?.workStart || '08:00',
      end: previous?.workEnd || (workTimeType === 'Full-Time' ? '17:30' : '12:00'),
    }]
  }
  if (!rawShifts.length || rawShifts.length > MAX_PROFILE_WORK_SHIFTS) {
    throw new ApiError(400, 'OFFICE_WORK_SHIFTS_INVALID', `Cần từ 1 đến ${MAX_PROFILE_WORK_SHIFTS} ca làm việc.`)
  }
  if (workTimeType === 'Full-Time' && rawShifts.length !== 1) {
    throw new ApiError(400, 'OFFICE_WORK_SHIFTS_INVALID', 'Nhân viên Full-Time chỉ dùng một khung giờ cố định.')
  }
  const workShifts = rawShifts.map((rawShift, index) => {
    if (!isPlainRecord(rawShift)) throw new ApiError(400, 'OFFICE_WORK_SHIFT_INVALID', 'Ca làm việc không hợp lệ.')
    const name = String(rawShift.name || '').trim().slice(0, 80)
    const start = parseShiftTime(rawShift.start)
    const end = parseShiftTime(rawShift.end)
    if (!name || !start || !end || end.minuteOfDay <= start.minuteOfDay) {
      throw new ApiError(400, 'OFFICE_WORK_TIME_INVALID', 'Mỗi ca cần tên, giờ bắt đầu và giờ kết thúc hợp lệ trong cùng ngày.')
    }
    return { id: profileWorkShiftId(rawShift.id, index), name, start: start.label, end: end.label }
  })
  const ids = workShifts.map(({ id }) => id)
  const names = workShifts.map(({ name }) => normalizeTextKey(name))
  if (new Set(ids).size !== ids.length || new Set(names).size !== names.length) {
    throw new ApiError(400, 'OFFICE_WORK_SHIFTS_DUPLICATE', 'Mã và tên ca làm việc không được trùng nhau.')
  }
  const first = workShifts[0]
  return {
    workTimeType,
    workStart: first.start,
    workEnd: first.end,
    workShifts,
    workingTime: {
      type: workTimeType,
      mode: workTimeType === 'Full-Time' ? 'fixed' : 'shifts',
      shifts: workShifts,
    },
  }
}

const profileWorkingTimeSchedule = (employee) => {
  const employmentType = officeEmploymentType(employee?.employmentType || 'Full-Time')
  const entries = new Map()
  for (const rawEntry of Array.isArray(employee?.workTimeSchedule) ? employee.workTimeSchedule : []) {
    if (!isPlainRecord(rawEntry)) continue
    let effectiveFrom
    try {
      effectiveFrom = optionalCalendarDate(rawEntry.effectiveFrom, 'Ngày áp dụng')
    } catch {
      continue
    }
    if (!effectiveFrom) continue
    try {
      const entryEmploymentType = officeEmploymentType(rawEntry.employmentType || employmentType)
      entries.set(effectiveFrom, {
        effectiveFrom,
        employmentType: entryEmploymentType,
        ...normalizeProfileWorkingTime(rawEntry, employee, entryEmploymentType),
        ...(rawEntry.createdAt ? { createdAt: rawEntry.createdAt } : {}),
        ...(rawEntry.createdBy ? { createdBy: rawEntry.createdBy } : {}),
        ...(rawEntry.updatedAt ? { updatedAt: rawEntry.updatedAt } : {}),
        ...(rawEntry.updatedBy ? { updatedBy: rawEntry.updatedBy } : {}),
        ...(rawEntry.source ? { source: rawEntry.source } : {}),
      })
    } catch {
      // A malformed legacy entry must not make the employee unable to check in.
    }
  }
  return [...entries.values()].sort((left, right) => left.effectiveFrom.localeCompare(right.effectiveFrom))
}

const resolveProfileWorkingTime = (employee, workDate) => {
  const date = String(workDate || '').trim()
  const effective = profileWorkingTimeSchedule(employee)
    .filter((entry) => !date || entry.effectiveFrom <= date)
    .at(-1)
  if (effective) return effective
  const employmentType = officeEmploymentType(employee?.employmentType || 'Full-Time')
  return {
    effectiveFrom: null,
    employmentType,
    ...normalizeProfileWorkingTime({}, employee, employmentType),
  }
}

const configuredProfileWorkShifts = (employee, workDate, state = {}) => {
  const daily = (Array.isArray(state.supportWorkSchedules) ? state.supportWorkSchedules : [])
    .find((record) => (
      !record.deletedAt
      && belongsToEmployee(record, employee?.id || employee?.code || employee?.employeeId)
      && String(record.date || '') === String(workDate || '')
    ))
  if (daily) {
    const start = parseShiftTime(daily.start)
    const end = parseShiftTime(daily.end)
    if (start && end && end.minuteOfDay > start.minuteOfDay) {
      return [{
        id: String(daily.id || `SUPPORT_${daily.employeeId}_${daily.date}`).replace(/[^A-Za-z0-9_-]/gu, '_').slice(0, 80),
        name: String(daily.shiftName || daily.name || 'Lịch làm việc').trim().slice(0, 80),
        start: start.label,
        end: end.label,
        version: Number(daily.version || 1),
        source: 'support-daily-schedule',
      }]
    }
  }
  const resolved = resolveProfileWorkingTime(employee, workDate)
  const canonical = Array.isArray(resolved?.workShifts)
    ? resolved.workShifts
    : Array.isArray(resolved?.workingTime?.shifts) ? resolved.workingTime.shifts : []
  const shifts = canonical.flatMap((rawShift, index) => {
    if (!isPlainRecord(rawShift)) return []
    const start = parseShiftTime(rawShift.start)
    const end = parseShiftTime(rawShift.end)
    if (!start || !end || end.minuteOfDay <= start.minuteOfDay) return []
    return [{
      id: profileWorkShiftId(rawShift.id, index),
      name: String(rawShift.name || `Ca ${index + 1}`).trim().slice(0, 80),
      start: start.label,
      end: end.label,
      version: 1,
      source: 'profile-work-shift',
      ...(resolved.effectiveFrom ? { effectiveFrom: resolved.effectiveFrom } : {}),
    }]
  })
  if (shifts.length) return shifts
  const start = parseShiftTime(resolved?.workStart)
  const end = parseShiftTime(resolved?.workEnd)
  if (!start || !end || end.minuteOfDay <= start.minuteOfDay) return []
  return [{
    id: `${employeeUnit(employee).toUpperCase()}_DEFAULT`,
    name: employeeUnit(employee) === 'office' ? 'Giờ làm Văn phòng' : 'Giờ làm theo hồ sơ',
    start: start.label,
    end: end.label,
    version: 1,
    source: 'office-profile',
  }]
}

const validRequiredMonthlyHours = (value) => {
  const hours = Number(value)
  return Number.isFinite(hours) && hours > 0 && hours <= MAX_REQUIRED_MONTHLY_HOURS ? hours : null
}

const isSecondMallSm234Store = (store) => {
  const id = asciiUpper(store?.id).replace(/\s+/gu, '')
  const identity = [store?.short, store?.name, store?.employeePrefix]
    .map((value) => asciiUpper(value).replace(/\s+/gu, ''))
    .join('|')
  return id === 'CH001' || identity.includes('SM234') || identity.includes('SECONDMALL')
}

const identityImageInputs = (payload) => {
  const container = payload.identityImages ?? payload.cccdImages ?? payload.identityCardImages
  const fromContainer = (side, index) => {
    if (isPlainRecord(container) && Object.hasOwn(container, side)) {
      return { provided: true, value: container[side] }
    }
    if (Array.isArray(container) && index < container.length) {
      return { provided: true, value: container[index] }
    }
    return { provided: false, value: undefined }
  }
  const front = Object.hasOwn(payload, 'cccdFront')
    ? { provided: true, value: payload.cccdFront }
    : fromContainer('front', 0)
  const back = Object.hasOwn(payload, 'cccdBack')
    ? { provided: true, value: payload.cccdBack }
    : fromContainer('back', 1)
  return { front, back }
}

const withoutIdentityImagePayload = (payload) => Object.fromEntries(Object.entries(payload).filter(([key]) => ![
  'identityImages', 'cccdImages', 'identityCardImages', 'cccdFront', 'cccdBack',
].includes(key)))

const bestEffortDeleteIdentityImages = async (bucket, keys) => {
  if (!bucket?.delete) return
  for (const key of new Set((keys || []).filter(Boolean))) {
    try {
      await bucket.delete(key)
    } catch (error) {
      console.warn('Unable to clean up an IDOSI identity image', { key, error: String(error) })
    }
  }
}

const prepareIdentityImageUpdate = async (env, payload, previous, employeeId, timestamp) => {
  const inputs = identityImageInputs(payload)
  const changedSides = Object.entries(inputs).filter(([, input]) => input.provided)
  const existing = isPlainRecord(previous?.identityImages) ? previous.identityImages : {}
  if (!changedSides.length) return { identityImages: existing, uploadedKeys: [], retiredKeys: [] }
  const bucket = env?.IDENTITY_IMAGES
  if (!bucket?.put || !bucket?.delete) {
    throw new ApiError(503, 'IDENTITY_IMAGE_STORAGE_UNAVAILABLE', 'Kho lưu ảnh CCCD chưa được cấu hình.')
  }
  const identityImages = { ...existing }
  const uploadedKeys = []
  const retiredKeys = []
  try {
    for (const [side, input] of changedSides) {
      const oldKey = String(existing?.[side]?.key || '')
      if (input.value == null || String(input.value).trim() === '') {
        delete identityImages[side]
        if (oldKey) retiredKeys.push(oldKey)
        continue
      }
      const image = decodeIdentityImage(input.value, side)
      const key = `identity-images/${employeeId}/${side}/${crypto.randomUUID()}.${image.extension}`
      await bucket.put(key, image.bytes, {
        httpMetadata: { contentType: image.contentType },
        customMetadata: { employeeId, side, uploadedAt: timestamp },
      })
      uploadedKeys.push(key)
      if (oldKey && oldKey !== key) retiredKeys.push(oldKey)
      identityImages[side] = {
        key,
        contentType: image.contentType,
        size: image.bytes.byteLength,
        uploadedAt: timestamp,
      }
    }
  } catch (error) {
    await bestEffortDeleteIdentityImages(bucket, uploadedKeys)
    if (error instanceof ApiError) throw error
    throw new ApiError(503, 'IDENTITY_IMAGE_STORAGE_FAILED', 'Không thể lưu ảnh CCCD vào kho riêng tư.')
  }
  return { identityImages, uploadedKeys, retiredKeys }
}

const deleteAccountAvatarObjects = async (bucket, keys) => {
  const targets = [...new Set((keys || []).filter((key) => String(key).startsWith(ACCOUNT_AVATAR_KEY_PREFIX)))]
  if (!bucket?.delete) return targets
  const failedKeys = []
  for (const key of targets) {
    try {
      await bucket.delete(key)
    } catch (error) {
      failedKeys.push(key)
      console.warn('Unable to clean up an IDOSI account avatar', { key, error: String(error) })
    }
  }
  return failedKeys
}

const cleanupAccountAvatarObjects = async (db, bucket, keys, {
  reason,
  timestamp,
  preservedKeys = [],
} = {}) => {
  const failedKeys = await deleteAccountAvatarObjects(bucket, keys)
  if (failedKeys.length) {
    await enqueuePendingAccountAvatarCleanup(db, failedKeys, { reason, timestamp, preservedKeys })
  }
  return failedKeys
}

const uploadAccountAvatarObject = async (bucket, source, userId, timestamp, version = 1, lifecycle = {}) => {
  if (!bucket?.put || !bucket?.delete) {
    throw new ApiError(503, 'ACCOUNT_AVATAR_STORAGE_UNAVAILABLE', 'Kho lưu ảnh đại diện chưa được cấu hình.')
  }
  const image = await decodeAccountAvatar(source)
  const normalizedVersion = Math.max(1, Number(version) || 1)
  const key = `${accountAvatarKeyPrefixForUser(userId)}${crypto.randomUUID()}.${image.extension}`
  try {
    if (typeof lifecycle.beforePut === 'function') await lifecycle.beforePut(key)
    await bucket.put(key, image.bytes, {
      httpMetadata: { contentType: image.contentType },
      customMetadata: {
        userId: String(userId || ''),
        version: String(normalizedVersion),
        uploadedAt: timestamp,
      },
    })
    if (typeof lifecycle.afterPut === 'function') await lifecycle.afterPut(key)
  } catch (error) {
    if (error instanceof ApiError) throw error
    throw new ApiError(503, 'ACCOUNT_AVATAR_STORAGE_FAILED', 'Không thể lưu ảnh đại diện vào kho riêng tư.')
  }
  return {
    metadata: {
      key,
      contentType: image.contentType,
      size: image.bytes.byteLength,
      version: normalizedVersion,
    },
    key,
  }
}

const prepareAccountAvatarUpdate = async (env, input, previous, userId, timestamp, lifecycle = {}) => {
  const existing = normalizeAccountAvatarMetadata(previous, userId)
  if (input === undefined) return { avatar: existing, uploadedKeys: [], retiredKeys: [] }
  const source = String(input || '').trim()
  if (!source) {
    if (existing && !env?.IDENTITY_IMAGES?.delete) {
      throw new ApiError(503, 'ACCOUNT_AVATAR_STORAGE_UNAVAILABLE', 'Kho lưu ảnh đại diện chưa được cấu hình.')
    }
    return { avatar: null, uploadedKeys: [], retiredKeys: existing ? [existing.key] : [] }
  }
  const uploaded = await uploadAccountAvatarObject(
    env?.IDENTITY_IMAGES,
    source,
    userId,
    timestamp,
    Number(existing?.version || 0) + 1,
    lifecycle,
  )
  return {
    avatar: uploaded.metadata,
    uploadedKeys: [uploaded.key],
    retiredKeys: existing?.key && existing.key !== uploaded.key ? [existing.key] : [],
  }
}

const hasLegacyAccountAvatarData = (state) => {
  const accountSettings = isPlainRecord(state?.accountSettings) ? state.accountSettings : {}
  const profileHasLegacyAvatar = (employee) => (
    isEmbeddedImageDataUrl(employee?.avatar) || isEmbeddedImageDataUrl(employee?.avatarImage)
  )
  return isEmbeddedImageDataUrl(state?.settings?.avatar)
    || Object.values(accountSettings).some((settings) => isEmbeddedImageDataUrl(settings?.avatar))
    || (Array.isArray(state?.employees) ? state.employees : []).some(profileHasLegacyAvatar)
    || (Array.isArray(state?.deletedEmployees) ? state.deletedEmployees : [])
      .some(profileHasLegacyAvatar)
}

const prepareLegacyAccountAvatarMigration = async (
  env,
  db,
  rawState,
  timestamp,
  preferredUserId = '',
  lifecycle = {},
) => {
  const state = isPlainRecord(rawState) ? rawState : {}
  const accountSettings = Object.fromEntries(Object.entries(isPlainRecord(state.accountSettings) ? state.accountSettings : {})
    .map(([userId, settings]) => [userId, isPlainRecord(settings) ? { ...settings } : settings]))
  const employees = (Array.isArray(state.employees) ? state.employees : []).map((employee) => ({ ...employee }))
  const deletedEmployees = (Array.isArray(state.deletedEmployees) ? state.deletedEmployees : []).map((employee) => ({ ...employee }))
  const legacyTopLevelAvatar = isEmbeddedImageDataUrl(state.settings?.avatar) ? state.settings.avatar : ''
  const hasLegacy = hasLegacyAccountAvatarData(state)
  if (!hasLegacy) {
    return { changed: false, state, uploadedKeys: [], replacements: new Map(), quarantined: [] }
  }

  const bucket = env?.IDENTITY_IMAGES
  const users = await all(db, 'SELECT id, employee_id, role FROM users ORDER BY created_at, id')
  const uniqueAvatarOwnerUser = (identifier, identifierOf, collisionCode, collisionMessage) => (
    uniqueIdentifierRecordMatch({
      records: users,
      identifier,
      identifierOf,
      collisionCode,
      collisionMessage,
    })?.record || null
  )
  const avatarOwnerUserForProfile = (employee) => {
    const authUserId = String(employee?.authUserId || '').trim()
    if (authUserId) {
      const linkedUser = uniqueAvatarOwnerUser(
        authUserId,
        (user) => user?.id,
        'LEGACY_AVATAR_AUTH_OWNER_COLLISION',
        'Mã tài khoản sở hữu ảnh đại diện cũ đang trùng hoa/thường.',
      )
      if (linkedUser) return linkedUser
    }
    for (const identifier of employeeIdentifierValues(employee)) {
      const linkedUser = uniqueAvatarOwnerUser(
        identifier,
        (user) => user?.employee_id,
        'LEGACY_AVATAR_EMPLOYEE_OWNER_COLLISION',
        'Mã nhân viên sở hữu ảnh đại diện cũ đang trùng hoa/thường.',
      )
      if (linkedUser) return linkedUser
    }
    return null
  }
  const preferredUser = users.find((user) => String(user.id) === String(preferredUserId || ''))
  const defaultAdminId = String(
    (preferredUser?.role === 'admin' ? preferredUser.id : '')
    || users.find((user) => user.role === 'admin')?.id
    || '',
  )
  const uploadedKeys = []
  const replacements = new Map()
  const quarantined = []
  const metadataByOwnerAndSource = new Map()
  const upload = async (source, ownerId) => {
    const normalizedOwnerId = String(ownerId || `legacy-${crypto.randomUUID()}`)
    const identity = `${normalizedOwnerId}\u0000${source}`
    if (metadataByOwnerAndSource.has(identity)) return metadataByOwnerAndSource.get(identity)
    const uploaded = await uploadAccountAvatarObject(bucket, source, normalizedOwnerId, timestamp, 1, lifecycle)
    uploadedKeys.push(uploaded.key)
    metadataByOwnerAndSource.set(identity, uploaded.metadata)
    if (!replacements.has(source)) replacements.set(source, uploaded.metadata)
    return uploaded.metadata
  }
  const migrateOrQuarantine = async (source, ownerId, location) => {
    try {
      await decodeAccountAvatar(source)
    } catch (error) {
      if (!(error instanceof ApiError) || !['AVATAR_INVALID', 'AVATAR_TOO_LARGE'].includes(error.code)) throw error
      replacements.set(source, null)
      quarantined.push({
        location,
        ownerId: String(ownerId || ''),
        reason: error.code === 'AVATAR_TOO_LARGE' ? 'legacy-avatar-too-large' : 'legacy-avatar-invalid',
      })
      return null
    }
    return upload(source, ownerId)
  }

  try {
    for (const [userId, settings] of Object.entries(accountSettings)) {
      if (!isPlainRecord(settings) || !isEmbeddedImageDataUrl(settings.avatar)) continue
      settings.avatar = await migrateOrQuarantine(settings.avatar, userId, `accountSettings.${userId}.avatar`)
    }

    if (legacyTopLevelAvatar) {
      const ownerId = defaultAdminId || `legacy-admin-${crypto.randomUUID()}`
      const metadata = await migrateOrQuarantine(legacyTopLevelAvatar, ownerId, 'settings.avatar')
      if (metadata) {
        accountSettings[ownerId] = {
          ...(isPlainRecord(accountSettings[ownerId]) ? accountSettings[ownerId] : {}),
          avatar: metadata,
        }
      }
    }

    for (const [collection, profiles] of [['employees', employees], ['deletedEmployees', deletedEmployees]]) {
      for (const employee of profiles) {
        const sourceField = isEmbeddedImageDataUrl(employee.avatar)
          ? 'avatar'
          : isEmbeddedImageDataUrl(employee.avatarImage)
            ? 'avatarImage'
            : ''
        if (!sourceField) continue
        const source = employee[sourceField]
        const employeeId = String(employee.id || employee.code || employee.employeeId || '')
        const ownerId = String(avatarOwnerUserForProfile(employee)?.id || '')
        const metadata = await migrateOrQuarantine(
          source,
          ownerId || `legacy-profile-${employeeId || crypto.randomUUID()}`,
          `${collection}.${employeeId || 'unknown'}.${sourceField}`,
        )
        delete employee.avatar
        delete employee.avatarImage
        if (metadata) employee.avatarImage = metadata
        if (metadata && ownerId && !normalizeAccountAvatarMetadata(accountSettings[ownerId]?.avatar, ownerId)) {
          accountSettings[ownerId] = {
            ...(isPlainRecord(accountSettings[ownerId]) ? accountSettings[ownerId] : {}),
            avatar: metadata,
          }
        }
      }
    }
  } catch (error) {
    await cleanupAccountAvatarObjects(db, bucket, uploadedKeys, {
      reason: 'legacy-avatar-migration-rollback',
      timestamp,
    })
    throw error
  }

  const settings = isPlainRecord(state.settings) ? { ...state.settings } : state.settings
  if (isPlainRecord(settings) && isEmbeddedImageDataUrl(settings.avatar)) delete settings.avatar
  return {
    changed: true,
    state: {
      ...state,
      ...(settings === undefined ? {} : { settings }),
      accountSettings,
      employees,
      deletedEmployees,
    },
    uploadedKeys,
    replacements,
    quarantined,
  }
}

const legacyAvatarMigrationAudit = (migration) => ({
  migratedObjects: Array.isArray(migration?.uploadedKeys) ? migration.uploadedKeys.length : 0,
  quarantinedInvalidObjects: Array.isArray(migration?.quarantined) ? migration.quarantined.length : 0,
  quarantined: (Array.isArray(migration?.quarantined) ? migration.quarantined : []).slice(0, 100),
})

const rewriteLegacyReceiptImages = async (db, row, replacements) => {
  const loaded = await loadReceipt(db, row.actor_id, row.idempotency_key)
  const responseJson = String(loaded?.response_json || '')
  if (!jsonTextContainsEmbeddedImageData(responseJson)) return false
  const parsed = parseStoredJson(responseJson, undefined)
  if (parsed === undefined) {
    throw new ApiError(500, 'ACCOUNT_AVATAR_MIGRATION_FAILED', 'Biên nhận cũ chứa ảnh nhúng nhưng không phải JSON hợp lệ.')
  }
  const sanitizedJson = JSON.stringify(replaceEmbeddedImageData(parsed, replacements))
  const responseBytes = jsonByteLength(sanitizedJson)
  const chunks = responseBytes > MAX_RECEIPT_INLINE_BYTES
    ? splitUtf8String(sanitizedJson, MAX_RECEIPT_CHUNK_BYTES)
    : []
  const storedResponse = chunks.length
    ? JSON.stringify({ __idosiChunkedResponse: 1, chunkCount: chunks.length, byteLength: responseBytes })
    : sanitizedJson
  await db.batch([
    db.prepare(`
      UPDATE command_receipts
      SET response_json = ?
      WHERE actor_id = ? AND idempotency_key = ? AND request_hash = ?
    `).bind(storedResponse, row.actor_id, row.idempotency_key, row.request_hash),
    db.prepare('DELETE FROM command_receipt_chunks WHERE actor_id = ? AND idempotency_key = ?')
      .bind(row.actor_id, row.idempotency_key),
    ...chunks.map((chunk, index) => db.prepare(`
      INSERT INTO command_receipt_chunks (
        actor_id, idempotency_key, chunk_index, chunk_text, chunk_bytes, created_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).bind(
      row.actor_id,
      row.idempotency_key,
      index,
      chunk,
      jsonByteLength(chunk),
      row.created_at,
    )),
  ])
  return true
}

const scrubLegacyAvatarArtifacts = async (db, replacements = new Map()) => {
  const auditRows = await all(db, `
    SELECT id, before_json, after_json, metadata_json
    FROM audit_log
    WHERE before_json LIKE '%data:image%base64,%'
       OR after_json LIKE '%data:image%base64,%'
       OR metadata_json LIKE '%data:image%base64,%'
  `)
  for (const row of auditRows) {
    const sanitizeJson = (value) => {
      if (!value || !jsonTextContainsEmbeddedImageData(value)) return value
      const parsed = parseStoredJson(value, undefined)
      return parsed === undefined ? null : JSON.stringify(replaceEmbeddedImageData(parsed, replacements))
    }
    await run(db, `
      UPDATE audit_log SET before_json = ?, after_json = ?, metadata_json = ? WHERE id = ?
    `, sanitizeJson(row.before_json), sanitizeJson(row.after_json), sanitizeJson(row.metadata_json), row.id)
  }

  const receiptRows = await all(db, `
    SELECT actor_id, idempotency_key, request_hash, response_json, created_at
    FROM command_receipts
    WHERE response_json LIKE '%data:image%base64,%'
       OR response_json LIKE '%__idosiChunkedResponse%'
  `)
  for (const row of receiptRows) await rewriteLegacyReceiptImages(db, row, replacements)

  const metadataRows = await all(db, `
    SELECT meta_key, value_json FROM system_metadata
    WHERE value_json LIKE '%data:image%base64,%'
  `)
  for (const row of metadataRows) {
    const parsed = parseStoredJson(row.value_json, undefined)
    const sanitized = parsed === undefined ? null : JSON.stringify(replaceEmbeddedImageData(parsed, replacements))
    await run(db, `
      UPDATE system_metadata SET value_json = ?, version = version + 1
      WHERE meta_key = ? AND value_json = ?
    `, sanitized, row.meta_key, row.value_json)
  }
}

const markAccountAvatarMigrationComplete = (db, timestamp) => run(db, `
  INSERT INTO system_metadata (meta_key, value_json, version, updated_at)
  VALUES (?, ?, 1, ?)
  ON CONFLICT(meta_key) DO UPDATE SET
    value_json = excluded.value_json,
    version = system_metadata.version + 1,
    updated_at = excluded.updated_at
`, ACCOUNT_AVATAR_MIGRATION_METADATA_KEY, JSON.stringify({ completedAt: timestamp }), timestamp)

const migrateLegacyAccountAvatars = async (db, env, actor, context, currentRow = null, attempt = 0) => {
  let current = currentRow || await loadState(db, 'global')
  if (!current) return current
  const completedMarker = await first(
    db,
    'SELECT meta_key FROM system_metadata WHERE meta_key = ? LIMIT 1',
    ACCOUNT_AVATAR_MIGRATION_METADATA_KEY,
  )
  if (completedMarker) return current
  const rawState = parseStoredJson(current.value_json, {})
  const ownerId = actor?.user_id || actor?.id || ''
  const avatarMutation = hasLegacyAccountAvatarData(rawState)
    ? await beginAccountAvatarMutationCleanup(db, ownerId, `${context.requestId}:account-avatar-migration`, context.now)
    : null
  let prepared
  try {
    prepared = await prepareLegacyAccountAvatarMigration(
      env,
      db,
      rawState,
      context.now,
      ownerId,
      avatarMutation ? accountAvatarMutationLifecycle(db, env?.IDENTITY_IMAGES, avatarMutation) : {},
    )
  } catch (error) {
    if (avatarMutation) {
      await cleanupAccountAvatarMutation(db, env?.IDENTITY_IMAGES, avatarMutation.metaKey, context, {
        suppressFailure: true,
      })
    }
    throw error
  }
  if (prepared.changed) {
    const requestId = `${context.requestId}:account-avatar-migration`
    let nextState
    let nextVersion
    let stateCommit
    try {
      nextState = normalizeSharedStateForStorage(prepared.state)
      nextVersion = Number(current.version) + 1
      stateCommit = prepareStateCommit(db, {
        current,
        nextState,
        scope: 'global',
        currentVersion: Number(current.version),
        nextVersion,
        now: context.now,
        actorId: actor?.user_id || actor?.id || 'system',
        requestId,
      })
    } catch (error) {
      if (avatarMutation) {
        await cleanupAccountAvatarMutation(db, env?.IDENTITY_IMAGES, avatarMutation.metaKey, context, {
          suppressFailure: true,
        })
      }
      throw error
    }
    const committedAvatarMutation = commitAccountAvatarMutationCleanup(
      avatarMutation,
      [],
      [...accountAvatarKeysFromState(nextState)],
      context.now,
    )
    const stateMutation = db.prepare(`
      UPDATE app_state
      SET value_json = ?, version = ?, updated_at = ?, updated_by = ?, last_request_id = ?
      WHERE scope_key = 'global' AND version = ?
        AND EXISTS (
          SELECT 1 FROM system_metadata WHERE meta_key = ? AND value_json = ?
        )
    `).bind(
      stateCommit.compactJson,
      nextVersion,
      context.now,
      actor?.user_id || actor?.id || 'system',
      requestId,
      Number(current.version),
      avatarMutation.metaKey,
      avatarMutation.valueJson,
    )
    let results
    try {
      results = await db.batch([
        stateMutation,
        ...stateCommit.externalStatements,
        db.prepare(`
          UPDATE system_metadata
          SET value_json = ?, version = version + 1, updated_at = ?
          WHERE meta_key = ? AND value_json = ?
            AND EXISTS (${stateSuccessSql})
        `).bind(
          committedAvatarMutation.valueJson,
          context.now,
          avatarMutation.metaKey,
          avatarMutation.valueJson,
          'global',
          nextVersion,
          requestId,
        ),
        db.prepare(`
          INSERT INTO audit_log (
            request_id, actor_id, actor_role, action, entity_type, entity_id,
            before_json, after_json, metadata_json, server_timestamp
          )
          SELECT ?, ?, ?, 'account_avatar.migrate_legacy', 'account-avatar', 'legacy-inline', NULL, NULL, ?, ?
          WHERE EXISTS (${stateSuccessSql})
        `).bind(
          requestId,
          actor?.user_id || actor?.id || 'system',
          actor?.role || 'system',
          JSON.stringify(legacyAvatarMigrationAudit(prepared)),
          context.now,
          'global',
          nextVersion,
          requestId,
        ),
      ])
    } catch (error) {
      await cleanupAccountAvatarMutation(db, env?.IDENTITY_IMAGES, avatarMutation.metaKey, context, {
        suppressFailure: true,
      })
      if (attempt < 1) return migrateLegacyAccountAvatars(db, env, actor, context, null, attempt + 1)
      throw new ApiError(409, 'ACCOUNT_AVATAR_MIGRATION_CONFLICT', 'Ảnh đại diện cũ thay đổi trong lúc chuyển đổi; vui lòng thử lại.', {
        cause: String(error),
      })
    }
    if (changes(results?.[0]) !== 1) {
      await cleanupAccountAvatarMutation(db, env?.IDENTITY_IMAGES, avatarMutation.metaKey, context, {
        suppressFailure: true,
      })
      if (attempt < 1) return migrateLegacyAccountAvatars(db, env, actor, context, null, attempt + 1)
      throw new ApiError(409, 'ACCOUNT_AVATAR_MIGRATION_CONFLICT', 'Ảnh đại diện cũ thay đổi trong lúc chuyển đổi; vui lòng thử lại.')
    }
    current = await loadState(db, 'global')
    await cleanupAccountAvatarMutation(db, env?.IDENTITY_IMAGES, avatarMutation.metaKey, context, {
      suppressFailure: true,
    })
  }

  if (!prepared.changed && avatarMutation) {
    await cleanupAccountAvatarMutation(db, env?.IDENTITY_IMAGES, avatarMutation.metaKey, context, {
      suppressFailure: true,
    })
  }

  try {
    await scrubLegacyAvatarArtifacts(db, prepared.replacements)
    await markAccountAvatarMigrationComplete(db, context.now)
  } catch (error) {
    if (error instanceof ApiError) throw error
    throw new ApiError(503, 'ACCOUNT_AVATAR_MIGRATION_FAILED', 'Không thể hoàn tất làm sạch dữ liệu ảnh đại diện cũ.', {
      cause: String(error),
    })
  }
  return current
}

const normalizeOperationalEmployeeProfile = (payload, previous, store, state, unit) => {
  const unsupportedFields = Object.keys(payload).filter((key) => !OPERATIONAL_PROFILE_FIELDS.has(key))
  if (unsupportedFields.length) {
    throw new ApiError(400, 'EMPLOYEE_PROFILE_FIELDS_INVALID', 'Hồ sơ vai trò này chỉ nhận các thuộc tính nhân sự đã quy định.', {
      fields: unsupportedFields,
    })
  }
  const id = previous
    ? String(previous.id || previous.code || previous.employeeCode || '')
    : nextEmployeeCode(state, store, unit)
  const name = payload.name === undefined && previous ? String(previous.name || '') : String(payload.name || '').trim().slice(0, 160)
  if (!name) throw new ApiError(400, 'EMPLOYEE_NAME_INVALID', 'Tên nhân viên không được để trống.')
  const phone = payload.phone === undefined && previous
    ? String(previous.phone || '')
    : String(payload.phone || '').replace(/\D/gu, '')
  if (!/^0\d{9}$/u.test(phone)) {
    throw new ApiError(400, 'PHONE_INVALID', 'Số điện thoại phải có đúng 10 số và bắt đầu bằng số 0.')
  }
  const cccd = payload.cccd === undefined && payload.citizenId === undefined && previous
    ? String(previous.cccd || previous.citizenId || '')
    : String(payload.cccd ?? payload.citizenId ?? '').replace(/\D/gu, '')
  if (!/^\d{12}$/u.test(cccd)) {
    throw new ApiError(400, 'CCCD_INVALID', 'CCCD phải có đúng 12 chữ số.')
  }
  const address = payload.address === undefined && previous
    ? String(previous.address || '')
    : String(payload.address || '').trim().slice(0, 500)
  if (!address) throw new ApiError(400, 'EMPLOYEE_ADDRESS_INVALID', 'Địa chỉ nhân viên không được để trống.')
  const addressDetails = normalizeAddressDetails(payload.addressDetails ?? previous?.addressDetails)
  const rawStartDate = payload.startDate ?? payload.joinDate ?? previous?.startDate ?? previous?.joinDate ?? ''
  const startDate = optionalCalendarDate(rawStartDate, 'Ngày bắt đầu làm')
  if (!startDate) throw new ApiError(400, 'START_DATE_REQUIRED', 'Ngày bắt đầu làm là bắt buộc.')
  const employmentType = operationalEmploymentType(payload.employmentType ?? previous?.employmentType ?? 'Full-Time')
  if (unit === 'store_manager' && !['Full-Time', 'Part-Time'].includes(employmentType)) {
    throw new ApiError(400, 'EMPLOYMENT_TYPE_INVALID', 'Loại nhân viên Quản lý cửa hàng phải là Full-Time hoặc Part-Time.')
  }
  const workingTime = normalizeProfileWorkingTime(payload, previous, employmentType)
  const position = operationalPosition(payload.position ?? payload.jobPosition ?? previous?.position, unit)
  const preservedMetadata = previous ? Object.fromEntries(Object.entries(previous).filter(([key]) => [
    'createdAt', 'createdBy', 'updatedAt', 'updatedBy', 'authUserId', 'authVersion', 'identityImages', 'workTimeSchedule',
  ].includes(key))) : {}
  const profile = sanitizeStateValue({
    ...preservedMetadata,
    id,
    code: id,
    employeeCode: id,
    name,
    phone,
    cccd,
    citizenId: cccd,
    address,
    ...(addressDetails ? { addressDetails } : {}),
    startDate,
    joinDate: startDate,
    employmentType,
    ...(unit === 'store_manager' ? {
      salary: 0,
      baseSalary: 0,
      monthlySalary: 0,
      hourlyRate: 0,
      payBasis: 'allowance-only',
      salaryBasis: 'allowance-only',
      salaryUnit: 'none',
      payFormula: 'allowance-bonus-only',
      ...(payload.linkedEmployeeId || previous?.linkedEmployeeId
        ? { linkedEmployeeId: String(payload.linkedEmployeeId || previous.linkedEmployeeId) }
        : {}),
    } : {}),
    position,
    jobPosition: position,
    storeId: store.id,
    unit,
    unitType: unit,
    department: unit,
    isOffice: false,
    isOfficeLike: true,
    ...workingTime,
    status: previous?.status || 'Đang làm việc',
  })
  if (previous?.username) profile.username = previous.username
  return profile
}

const normalizeEmployeeProfilePayload = (payload, previous, store, state, unit = null) => {
  const normalizedUnit = unit || employeeUnit(previous || { storeId: store?.id })
  if (['business_support', 'store_manager'].includes(normalizedUnit)) {
    return normalizeOperationalEmployeeProfile(payload, previous, store, state, normalizedUnit)
  }
  const officeLike = ['office', 'business_support', 'store_manager'].includes(normalizedUnit)
  const id = previous
    ? String(previous.id || previous.code || previous.employeeCode || '')
    : String(['business_support', 'store_manager', 'office'].includes(normalizedUnit)
      ? nextEmployeeCode(state, store, normalizedUnit)
      : (payload.id || payload.code || payload.employeeCode || nextEmployeeCode(state, store, normalizedUnit))).trim().toUpperCase()
  if (!/^[A-Za-z0-9_-]{2,80}$/u.test(id)) throw new ApiError(400, 'EMPLOYEE_ID_INVALID', 'Mã nhân viên không hợp lệ.')
  const name = payload.name === undefined && previous ? previous.name : String(payload.name || '').trim().slice(0, 160)
  if (!name) throw new ApiError(400, 'EMPLOYEE_NAME_INVALID', 'Tên nhân viên không được để trống.')
  const phone = payload.phone === undefined && previous ? String(previous.phone || '') : String(payload.phone || '').replace(/\D/gu, '')
  if (!/^0\d{9}$/u.test(phone)) {
    throw new ApiError(400, 'PHONE_INVALID', 'Số điện thoại phải có đúng 10 số và bắt đầu bằng số 0.')
  }
  const rawEmploymentType = String(payload.employmentType ?? previous?.employmentType ?? (officeLike ? 'Chính thức' : 'Full-Time')).trim()
  const employmentType = normalizedUnit === 'office'
    ? officeEmploymentType(rawEmploymentType)
    : normalizeStoreEmploymentType(rawEmploymentType)
  const allowedTypes = normalizedUnit === 'office'
    ? ['Full-Time', 'Part-Time', 'Thực Tập Sinh']
    : [STORE_EMPLOYMENT_TYPE.FULL_TIME, STORE_EMPLOYMENT_TYPE.PART_TIME, STORE_EMPLOYMENT_TYPE.PROBATION]
  if (!allowedTypes.includes(employmentType)) {
    throw new ApiError(400, 'EMPLOYMENT_TYPE_INVALID', 'Loại nhân viên không hợp lệ.')
  }
  const storeFullTime = normalizedUnit === 'store' && employmentType === 'Full-Time'
  const storeHourly = normalizedUnit === 'store' && employmentType !== STORE_EMPLOYMENT_TYPE.FULL_TIME
  const payBasis = storeFullTime
    ? 'tiered-hourly'
    : (storeHourly || employmentType === 'Part-Time' ? 'hourly' : 'monthly')
  const salarySource = payBasis === 'monthly'
    ? (payload.baseSalary ?? payload.monthlySalary ?? payload.salary
      ?? previous?.baseSalary ?? previous?.monthlySalary ?? previous?.salary ?? 0)
    : (payload.hourlyRate ?? payload.salary ?? previous?.hourlyRate ?? previous?.salary ?? 0)
  const salary = storeFullTime
    ? null
    : asVnd(salarySource, payBasis === 'monthly' ? 'Lương tháng' : 'Lương giờ')
  const previousStoreEmploymentType = normalizeStoreEmploymentType(previous?.employmentType)
  const storeSalaryConfigRequired = storeFullTime
    ? (previousStoreEmploymentType === STORE_EMPLOYMENT_TYPE.FULL_TIME
        ? previous?.storeSalaryConfigRequired === true
        : true)
    : false
  const cccd = ['office', 'store'].includes(normalizedUnit)
    ? String(payload.cccd ?? payload.citizenId ?? previous?.cccd ?? previous?.citizenId ?? '').replace(/\D/gu, '')
    : String(payload.cccd ?? payload.citizenId ?? previous?.cccd ?? previous?.citizenId ?? '').trim().slice(0, 20)
  if (['office', 'store'].includes(normalizedUnit) && (!previous || payload.cccd !== undefined || payload.citizenId !== undefined)
    && !/^\d{12}$/u.test(cccd)) {
    throw new ApiError(400, 'CCCD_INVALID', 'CCCD phải có đúng 12 chữ số.')
  }
  const address = String(payload.address ?? previous?.address ?? '').trim().slice(0, 500)
  if (['office', 'store'].includes(normalizedUnit) && !previous && !address) {
    throw new ApiError(400, 'EMPLOYEE_ADDRESS_INVALID', 'Địa chỉ nhân viên không được để trống.')
  }
  const addressDetails = normalizeAddressDetails(payload.addressDetails ?? previous?.addressDetails)
  const workingTime = officeLike ? normalizeProfileWorkingTime(payload, previous, employmentType) : null
  if (officeLike && payload.monthlyWorkdayTargets !== undefined) {
    throw new ApiError(400, 'OFFICE_WORK_DAYS_PAYLOAD_INVALID', 'Hãy cập nhật ngày công theo cặp standardWorkDaysPeriod và standardWorkDays.')
  }
  const monthlyWorkdayTargets = Object.fromEntries(Object.entries(
    isPlainRecord(previous?.monthlyWorkdayTargets) ? previous.monthlyWorkdayTargets : {},
  ).filter(([period, days]) => (
    /^\d{4}-(?:0[1-9]|1[0-2])$/u.test(period)
    && Number.isInteger(Number(days))
    && Number(days) >= 1
    && Number(days) <= 31
  )).map(([period, days]) => [period, Number(days)]))
  const hasRequestedStandardWorkDays = officeLike && payload.standardWorkDays !== undefined
  const requestedStandardWorkDays = hasRequestedStandardWorkDays
    ? Number(payload.standardWorkDays)
    : Number(previous?.standardWorkDays)
  if (hasRequestedStandardWorkDays && !validRequiredWorkingDays(requestedStandardWorkDays)) {
    throw new ApiError(400, 'OFFICE_WORK_DAYS_INVALID', 'Số ngày công riêng của nhân viên Văn phòng phải từ 1 đến 31.')
  }
  const requestedStandardWorkDaysPeriod = officeLike && payload.standardWorkDaysPeriod !== undefined
    ? String(payload.standardWorkDaysPeriod || '').trim()
    : ''
  if (requestedStandardWorkDaysPeriod && !/^\d{4}-(?:0[1-9]|1[0-2])$/u.test(requestedStandardWorkDaysPeriod)) {
    throw new ApiError(400, 'OFFICE_WORK_DAYS_PERIOD_INVALID', 'Tháng áp dụng ngày công phải theo định dạng YYYY-MM.')
  }
  if (officeLike && payload.standardWorkDaysPeriod !== undefined && !hasRequestedStandardWorkDays) {
    throw new ApiError(400, 'OFFICE_WORK_DAYS_REQUIRED', 'Cần gửi standardWorkDays cùng tháng áp dụng.')
  }
  if (officeLike && hasRequestedStandardWorkDays && payload.standardWorkDaysPeriod === undefined) {
    throw new ApiError(400, 'OFFICE_WORK_DAYS_PERIOD_REQUIRED', 'Cần chọn tháng áp dụng cùng số ngày công.')
  }
  if (requestedStandardWorkDaysPeriod) monthlyWorkdayTargets[requestedStandardWorkDaysPeriod] = requestedStandardWorkDays
  const requestedStartDate = payload.startDate ?? payload.joinDate ?? previous?.startDate ?? previous?.joinDate ?? ''
  const startDate = requestedStartDate ? optionalCalendarDate(requestedStartDate, 'Ngày bắt đầu làm') : ''
  if (!previous && ['business_support', 'store_manager', 'office', 'store'].includes(normalizedUnit) && !startDate) {
    throw new ApiError(400, 'START_DATE_REQUIRED', 'Ngày bắt đầu làm là bắt buộc.')
  }
  const position = normalizedUnit === 'office'
    ? (payload.position !== undefined || previous?.position
        ? officePosition(payload.position ?? previous.position)
        : (previous ? '' : officePosition(payload.position)))
    : String(payload.position ?? previous?.position ?? (normalizedUnit === 'store' ? 'Nhân viên bán hàng' : '')).trim().slice(0, 160)
  const profile = sanitizeStateValue({
    ...(previous || {}),
    ...payload,
    id,
    code: id,
    employeeCode: id,
    name,
    phone,
    cccd,
    citizenId: cccd,
    address,
    ...(addressDetails ? { addressDetails } : {}),
    storeId: store.id,
    unit: normalizedUnit,
    unitType: normalizedUnit,
    department: normalizedUnit,
    isOffice: normalizedUnit === 'office',
    isOfficeLike: officeLike,
    employmentType,
    position,
    jobPosition: position,
    payBasis,
    salaryBasis: payBasis,
    salaryUnit: payBasis === 'monthly' ? 'month' : 'hour',
    ...(storeFullTime ? {
      payFormula: STORE_PAYROLL_MODEL.FULL_TIME_TIERED,
      storeSalaryConfigRequired,
      ...(previous && Object.hasOwn(previous, 'salary') ? { salary: previous.salary } : {}),
      ...(previous && Object.hasOwn(previous, 'monthlySalary') ? { monthlySalary: previous.monthlySalary } : {}),
      ...(previous && Object.hasOwn(previous, 'hourlyRate') ? { hourlyRate: previous.hourlyRate } : {}),
      ...(previous && Object.hasOwn(previous, 'baseSalary') ? { baseSalary: previous.baseSalary } : {}),
      ...(previous && Object.hasOwn(previous, 'requiredMonthlyHours')
        ? { requiredMonthlyHours: previous.requiredMonthlyHours }
        : {}),
      ...(previous && Object.hasOwn(previous, 'standardWorkDays')
        ? { standardWorkDays: previous.standardWorkDays }
        : {}),
    } : {
      salary,
      monthlySalary: payBasis === 'monthly' ? salary : null,
      hourlyRate: payBasis === 'hourly' ? salary : null,
      baseSalary: null,
    }),
    ...(startDate ? { startDate, joinDate: startDate } : {}),
    ...(['business_support', 'store_manager'].includes(normalizedUnit)
      ? { needsProfileCompletion: !startDate }
      : {}),
    ...(officeLike ? {
      ...workingTime,
      monthlyWorkdayTargets,
      ...(validRequiredWorkingDays(requestedStandardWorkDays)
        ? { standardWorkDays: requestedStandardWorkDays }
        : {}),
      ...(requestedStandardWorkDaysPeriod
        ? { standardWorkDaysPeriod: requestedStandardWorkDaysPeriod }
        : {}),
    } : {}),
    status: previous?.status || 'Đang làm việc',
  })
  for (const key of [
    'password', 'passwordHash', 'legacyPassword', 'token', 'role',
    'deletedAt', 'deletedBy', 'createdAt', 'createdBy', 'updatedAt', 'updatedBy',
    'thresholdHours', 'thresholdSeconds', 'standardHourlyRateVnd', 'regularHourlyRateVnd',
    'excessHourlyRateVnd', 'effectiveFrom', 'storePolicy', 'salaryConfig',
  ]) delete profile[key]
  if (normalizedUnit === 'store' && !storeFullTime) {
    delete profile.standardWorkDays
    delete profile.requiredMonthlyHours
    delete profile.baseSalary
    delete profile.payFormula
    delete profile.storeSalaryConfigRequired
  } else if (normalizedUnit === 'store' && storeFullTime && !previous) {
    delete profile.salary
    delete profile.monthlySalary
    delete profile.hourlyRate
    delete profile.baseSalary
    delete profile.requiredMonthlyHours
    delete profile.standardWorkDays
  }
  if (previous?.authUserId) profile.authUserId = previous.authUserId
  else delete profile.authUserId
  if (previous?.authVersion) profile.authVersion = previous.authVersion
  else delete profile.authVersion
  return profile
}

const employeeProfileCommand = async (db, actor, body, commandContext, env) => {
  assertOperationsRole(actor, 'Tài khoản không có quyền quản lý hồ sơ nhân viên.')
  const operation = body.type.split('.').at(-1)
  if (!['create', 'update', 'delete'].includes(operation)) {
    throw new ApiError(400, 'COMMAND_UNKNOWN', 'Lệnh hồ sơ nhân viên không được hỗ trợ.')
  }
  if (operation === 'delete') assertAdmin(actor, 'Chỉ Admin được xóa nhân viên khỏi hệ thống.')
  const payload = isPlainRecord(body.payload) ? body.payload : {}
  const profilePayload = isPlainRecord(payload.employee) ? payload.employee : payload
  const { current, state } = await loadGlobalCommandState(db, body)
  const employees = Array.isArray(state.employees) ? state.employees : []
  let employeeId = operation === 'create'
    ? String(profilePayload.id || profilePayload.code || profilePayload.employeeCode || '').trim().toUpperCase()
    : String(payload.employeeId || profilePayload.id || profilePayload.code || '').trim()
  const previous = operation === 'create'
    ? null
    : employees.find((employee) => sameIdentifier(employee.id || employee.code, employeeId) && !employee.deletedAt)
  if (operation !== 'create' && !previous) throw new ApiError(404, 'EMPLOYEE_NOT_FOUND', 'Không tìm thấy hồ sơ nhân viên.')
  const unit = normalizeEmployeeUnitRequest(profilePayload, previous)
  const linkedEmployeeId = operation === 'create' && ['store_manager', 'store'].includes(unit)
    ? String(profilePayload.linkedEmployeeId || '').trim()
    : ''
  const linkedStoreEmployee = linkedEmployeeId
    ? employees.find((employee) => (
        sameIdentifier(employee.id || employee.code, linkedEmployeeId)
        && (unit === 'store_manager'
          ? ['store', 'business_support'].includes(employeeUnit(employee))
          : ['business_support', 'office'].includes(employeeUnit(employee)))
        && !employee.deletedAt
        && !['da nghi viec', 'inactive'].includes(normalizeTextKey(employee.status))
      ))
    : null
  if (linkedEmployeeId && !linkedStoreEmployee) {
    throw new ApiError(404, 'LINKED_EMPLOYEE_NOT_FOUND', 'Không tìm thấy hồ sơ đang hoạt động để liên kết thêm vai trò.')
  }
  const creatingStoreEmployee = operation === 'create' && unit === 'store'
  const supportCreatingStoreEmployee = actor.role === 'business_support' && creatingStoreEmployee && !linkedEmployeeId
  if (creatingStoreEmployee) employeeId = ''
  if (operation === 'update' && Object.keys(profilePayload).some((field) => PROFILE_WORKING_TIME_FIELDS.has(field))) {
    throw new ApiError(
      400,
      'WORK_TIME_UPDATE_COMMAND_REQUIRED',
      'Không thể chỉnh sửa cấu hình giờ làm trực tiếp trong hồ sơ sau khi tạo.',
    )
  }
  if (operation === 'update' && actor.role === 'store_manager' && unit === 'store') {
    const currentType = normalizeStoreEmploymentType(previous?.employmentType)
    const requestedType = profilePayload.employmentType === undefined
      ? currentType
      : normalizeStoreEmploymentType(profilePayload.employmentType)
    const attemptedConfigFields = Object.keys(profilePayload)
      .filter((field) => STORE_SALARY_CONFIG_INPUT_FIELDS.has(field))
    const changedFullTimePayrollModel = currentType !== requestedType
      && [currentType, requestedType].includes(STORE_EMPLOYMENT_TYPE.FULL_TIME)
    const changedLegacySalaryFields = (currentType === STORE_EMPLOYMENT_TYPE.FULL_TIME
      || requestedType === STORE_EMPLOYMENT_TYPE.FULL_TIME)
      ? Object.keys(profilePayload).filter((field) => (
          STORE_LEGACY_FULL_TIME_SALARY_FIELDS.has(field)
          && JSON.stringify(canonicalize(profilePayload[field])) !== JSON.stringify(canonicalize(previous?.[field]))
        ))
      : []
    if (attemptedConfigFields.length || changedFullTimePayrollModel || changedLegacySalaryFields.length) {
      throw new ApiError(
        403,
        'STORE_SALARY_CONFIG_FORBIDDEN',
        'Chỉ Admin hoặc Nhân viên hỗ trợ KD được thay đổi cấu hình lương Full-Time.',
      )
    }
  }
  const supportOperationAllowed = (
    ['store', 'office', 'store_manager'].includes(unit) && ['create', 'update'].includes(operation)
  )
  if (actor.role === 'business_support' && !supportOperationAllowed) {
    throw new ApiError(403, 'BUSINESS_SUPPORT_READ_ONLY', 'Nhân viên hỗ trợ KD chỉ được thêm hoặc cập nhật nhân viên cửa hàng, Khối văn phòng và Quản lý cửa hàng.')
  }
  const requestedIdentityImages = identityImageInputs(profilePayload)
  const hasIdentityImagePayload = Object.values(requestedIdentityImages).some((input) => input.provided)
  const hasCompleteIdentityImages = ['front', 'back'].every((side) => (
    requestedIdentityImages[side].provided && String(requestedIdentityImages[side].value || '').trim()
  ))
  if (hasIdentityImagePayload && !['business_support', 'store_manager', 'office', 'store'].includes(unit)) {
    throw new ApiError(400, 'IDENTITY_IMAGE_ROLE_INVALID', 'Ảnh CCCD riêng tư chỉ áp dụng cho hồ sơ nhân viên hợp lệ.')
  }
  if (previous && ['unit', 'unitType', 'department', 'role'].some((field) => profilePayload[field] !== undefined)) {
    const requestedUnit = normalizeEmployeeUnitRequest(profilePayload)
    if (requestedUnit !== unit) {
      throw new ApiError(400, 'EMPLOYEE_UNIT_IMMUTABLE', 'Không thể đổi nhóm vai trò của hồ sơ nhân viên.')
    }
  }
  if (unit === 'business_support' && actor.role !== 'admin') {
    throw new ApiError(403, 'ROLE_FORBIDDEN', 'Chỉ Admin được quản lý hồ sơ Nhân viên hỗ trợ KD.')
  }
  if (['store_manager', 'office'].includes(unit)
    && !['admin', 'business_support'].includes(actor.role)) {
    throw new ApiError(403, 'ROLE_FORBIDDEN', 'Chỉ Admin hoặc Nhân viên hỗ trợ KD được quản lý hồ sơ này.')
  }
  if (previous && unit === 'store') assertOperationalStoreAccess(actor, String(previous.storeId || ''))
  if (actor.role !== 'admin' && previous && ['da nghi viec', 'inactive'].includes(normalizeTextKey(previous.status))) {
    throw new ApiError(403, 'EMPLOYEE_REACTIVATE_FORBIDDEN', 'Chỉ Admin được khôi phục nhân viên đã nghỉ việc.')
  }
  if (previous && profilePayload.storeId !== undefined
    && !sameIdentifier(profilePayload.storeId, previous.storeId)) {
    throw new ApiError(400, 'EMPLOYEE_STORE_IMMUTABLE', 'Không thể đổi đơn vị của nhân viên qua cập nhật hồ sơ.')
  }
  const storeId = unit === 'business_support'
    ? BUSINESS_SUPPORT_STORE_ID
    : (operation === 'create'
      ? String(profilePayload.storeId || linkedStoreEmployee?.storeId || '').trim()
      : String(previous.storeId || '').trim())
  if (operation === 'create' && unit === 'office' && !sameIdentifier(storeId, OFFICE_STORE_ID)) {
    throw new ApiError(400, 'OFFICE_STORE_REQUIRED', 'Nhân viên Khối văn phòng bắt buộc thuộc đơn vị OFFICE.')
  }
  if (unit === 'store') assertOperationalStoreAccess(actor, storeId)
  if (unit === 'store_manager') assertOperationalStoreAccess(actor, storeId)
  let store
  if (unit === 'business_support') {
    store = { id: BUSINESS_SUPPORT_STORE_ID, name: 'Nhân viên hỗ trợ kinh doanh', short: 'HTKD' }
  } else if (unit === 'office' && sameIdentifier(storeId, OFFICE_STORE_ID) && ['admin', 'business_support'].includes(actor.role)) {
    store = { id: OFFICE_STORE_ID, name: 'Khối Văn Phòng', short: 'VP' }
  } else store = requireStore(state, storeId)
  if (unit === 'store_manager' && [OFFICE_STORE_ID, BUSINESS_SUPPORT_STORE_ID].some((id) => sameIdentifier(id, storeId))) {
    throw new ApiError(400, 'STORE_INVALID', 'Quản lý cửa hàng phải được gán cho một cửa hàng đang tồn tại.')
  }
  if (unit === 'store_manager') requireActivePhysicalStore(state, storeId)
  if (linkedStoreEmployee && employeeUnit(linkedStoreEmployee) === 'store' && !sameIdentifier(linkedStoreEmployee.storeId, storeId)) {
    throw new ApiError(400, 'LINKED_EMPLOYEE_STORE_MISMATCH', 'Nhân viên được chọn không thuộc cửa hàng cần phân quyền quản lý.')
  }
  if (operation === 'create' && unit === 'store' && linkedEmployeeId && employees.some((employee) => (
    employeeUnit(employee) === 'store'
    && sameIdentifier(employee.storeId, storeId)
    && sameIdentifier(employee.linkedEmployeeId, linkedEmployeeId)
    && !employee.deletedAt
  ))) {
    throw new ApiError(409, 'LINKED_EMPLOYEE_ROLE_EXISTS', 'Nhân viên đã có vai trò Nhân viên tại cửa hàng này.')
  }

  if (operation === 'delete') {
    const linkedRoleProfile = Boolean(previous.linkedEmployeeId && ['store_manager', 'store'].includes(unit))
    const authEmployeeId = linkedRoleProfile ? String(previous.linkedEmployeeId) : employeeId
    const authTarget = await uniqueUserByEmployeeIdentifier(db, authEmployeeId)
    const nextAuthVersion = authTarget ? Number(authTarget.version || 1) + 1 : null
    const linkedSource = linkedRoleProfile
      ? employees.find((employee) => sameIdentifier(employee.id || employee.code, authEmployeeId) && !employee.deletedAt)
      : null
    const restoredRole = employeeUnit(linkedSource) === 'business_support' ? 'business_support' : 'employee'
    const restoredStoreId = restoredRole === 'business_support'
      ? BUSINESS_SUPPORT_STORE_ID
      : String(linkedSource?.storeId || authTarget?.store_id || '') || null
    const { identityImages: deletedIdentityImages, ...profileWithoutIdentityImages } = previous
    const deleted = {
      ...profileWithoutIdentityImages,
      ...(authTarget ? { authUserId: authTarget.id, authVersion: nextAuthVersion } : {}),
      status: 'Đã nghỉ việc',
      deletedAt: commandContext.now,
      deletedBy: serverActorSnapshot(actor),
    }
    const nextState = {
      ...state,
      employees: employees.filter((employee) => !sameIdentifier(employee.id || employee.code, employeeId)),
      schedule: (Array.isArray(state.schedule) ? state.schedule : []).filter((entry) => !belongsToEmployee(entry, employeeId)),
      deletedEmployees: [deleted, ...(Array.isArray(state.deletedEmployees) ? state.deletedEmployees : [])],
      stateVersion: Math.max(1, Number(state.stateVersion) || 1) + 1,
    }
    const nextStateVersion = Number(current.version) + 1
    const additionalStatements = authTarget ? [
      db.prepare(`
        UPDATE users
        SET status = ?, role = ?, store_id = ?, employee_id = ?, version = ?, updated_at = ?
        WHERE id = ? AND version = ?
          AND EXISTS (
            SELECT 1 FROM app_state
            WHERE scope_key = 'global' AND version = ? AND last_request_id = ?
          )
      `).bind(
        linkedRoleProfile ? 'active' : 'inactive',
        linkedRoleProfile ? (authTarget.role === 'store_manager' ? restoredRole : authTarget.role) : authTarget.role,
        linkedRoleProfile ? (authTarget.role === 'store_manager' ? restoredStoreId : authTarget.store_id) : authTarget.store_id,
        linkedRoleProfile ? authEmployeeId : authTarget.employee_id,
        nextAuthVersion,
        commandContext.now,
        authTarget.id,
        Number(authTarget.version || 1),
        nextStateVersion,
        commandContext.requestId,
      ),
      db.prepare(`
        UPDATE sessions
        SET revoked_at = ?, last_seen_at = ?
        WHERE user_id = ? AND revoked_at IS NULL
          AND EXISTS (SELECT 1 FROM users WHERE id = ? AND version = ?)
      `).bind(
        commandContext.now,
        commandContext.now,
        authTarget.id,
        authTarget.id,
        nextAuthVersion,
      ),
    ] : []
    const response = await commitGlobalStateDomainCommand(db, actor, current, nextState, {
      action: body.type,
      entityType: 'employee',
      entityId: employeeId,
      before: previous,
      after: null,
      response: {
        command: body.type,
        employee: deleted,
        ...(authTarget ? {
          user: {
            ...publicUser(authTarget),
            status: linkedRoleProfile ? 'active' : 'inactive',
            role: linkedRoleProfile && authTarget.role === 'store_manager' ? restoredRole : authTarget.role,
            storeId: linkedRoleProfile && authTarget.role === 'store_manager' ? restoredStoreId : authTarget.store_id,
            employeeId: linkedRoleProfile ? authEmployeeId : authTarget.employee_id,
            version: nextAuthVersion,
          },
        } : {}),
      },
      additionalStatements,
      stateGuard: authTarget ? {
        sql: 'SELECT 1 FROM users WHERE id = ? AND version = ?',
        bindings: [authTarget.id, Number(authTarget.version || 1)],
      } : undefined,
    }, commandContext)
    if (!linkedRoleProfile) {
      await bestEffortDeleteIdentityImages(
        env?.IDENTITY_IMAGES,
        Object.values(isPlainRecord(deletedIdentityImages) ? deletedIdentityImages : {}).map((image) => image?.key),
      )
    }
    return response
  }

  const profileInput = withoutIdentityImagePayload(linkedStoreEmployee ? {
    ...profilePayload,
    name: linkedStoreEmployee.name,
    phone: linkedStoreEmployee.phone,
    cccd: linkedStoreEmployee.cccd || linkedStoreEmployee.citizenId,
    address: linkedStoreEmployee.address,
    addressDetails: linkedStoreEmployee.addressDetails,
    startDate: profilePayload.startDate || linkedStoreEmployee.startDate || linkedStoreEmployee.joinDate,
    employmentType: unit === 'store'
      ? 'Part-Time'
      : (profilePayload.employmentType || linkedStoreEmployee.employmentType || 'Full-Time'),
    linkedEmployeeId,
  } : profilePayload)
  if (creatingStoreEmployee) {
    for (const field of ['employeeId', 'id', 'code', 'employeeCode']) delete profileInput[field]
  }
  const profile = normalizeEmployeeProfilePayload(profileInput, previous, store, state, unit)
  const linkedIdentityImages = isPlainRecord(linkedStoreEmployee?.identityImages)
    ? linkedStoreEmployee.identityImages
    : {}
  const previousIdentityImages = isPlainRecord(previous?.identityImages) ? previous.identityImages : {}
  const hasEffectiveIdentityImages = ['front', 'back'].every((side) => {
    if (linkedIdentityImages[side]?.key) return true
    const requested = requestedIdentityImages[side]
    if (requested.provided) return Boolean(String(requested.value || '').trim())
    return Boolean(previousIdentityImages[side]?.key)
  })
  if (!hasEffectiveIdentityImages) {
    throw new ApiError(400, 'IDENTITY_IMAGES_REQUIRED', 'Cần tải đủ ảnh mặt trước và mặt sau CCCD của nhân viên.')
  }
  if (supportCreatingStoreEmployee) {
    const normalizedCccd = String(profilePayload.cccd ?? profilePayload.citizenId ?? '').replace(/\D/gu, '')
    if (!/^\d{12}$/u.test(normalizedCccd)) {
      throw new ApiError(400, 'CCCD_INVALID', 'CCCD phải có đúng 12 chữ số.')
    }
    if (!profile.startDate) {
      throw new ApiError(400, 'START_DATE_REQUIRED', 'Ngày bắt đầu làm là bắt buộc đối với nhân viên cửa hàng.')
    }
    if (!hasCompleteIdentityImages) {
      throw new ApiError(400, 'IDENTITY_IMAGES_REQUIRED', 'Cần tải đủ ảnh mặt trước và mặt sau CCCD của nhân viên cửa hàng.')
    }
    profile.cccd = normalizedCccd
    profile.citizenId = normalizedCccd
    profile.position = 'Nhân viên bán hàng'
    profile.jobPosition = 'Nhân viên bán hàng'
  }
  let requestedStatus = null
  if (operation === 'update' && profilePayload.status !== undefined) {
    requestedStatus = employeeStatusValues(profilePayload.status)
    if (actor.role !== 'admin' && requestedStatus.account === 'inactive') {
      throw new ApiError(403, 'EMPLOYEE_DELETE_FORBIDDEN', 'Chỉ Admin được cho nhân viên nghỉ việc hoặc xóa khỏi hệ thống.')
    }
    profile.status = requestedStatus.profile
  }
  const previousWasActiveManager = previous
    ? resolveExactlyOneActiveStoreManager({ storeId, managers: [previous] }).ok
    : false
  const introducesActiveManager = !previousWasActiveManager
    && resolveExactlyOneActiveStoreManager({ storeId, managers: [profile] }).ok
  if (introducesActiveManager) {
    const managerResolution = resolveExactlyOneActiveStoreManager({
      storeId,
      managers: [
        ...employees.filter((employee) => !sameIdentifier(
          employee.id || employee.code,
          previous?.id || previous?.code,
        )),
        ...(Array.isArray(state.managerAccounts) ? state.managerAccounts : []),
        profile,
      ],
    })
    if (managerResolution.code === 'STORE_MANAGER_MULTIPLE_ACTIVE') {
      throw new ApiError(409, 'STORE_MANAGER_EXISTS', 'Cửa hàng đã có một Quản lý cửa hàng đang hoạt động.')
    }
  }
  if (operation === 'create') {
    if (employeeId && !sameIdentifier(employeeId, profile.id)) {
      throw new ApiError(400, 'EMPLOYEE_ID_INVALID', 'Mã nhân viên gửi lên không khớp mã được tạo.')
    }
    if (employees.some((employee) => employeeIdentifierValues(employee).some((id) => sameIdentifier(id, profile.id)))) {
      throw new ApiError(409, 'EMPLOYEE_EXISTS', 'Mã nhân viên đã tồn tại.')
    }
    if ((Array.isArray(state.deletedEmployees) ? state.deletedEmployees : []).some((employee) => (
      employeeIdentifierValues(employee).some((id) => sameIdentifier(id, profile.id))
    ))) {
      throw new ApiError(409, 'EMPLOYEE_ID_RETIRED', 'Mã nhân viên đã được sử dụng và không thể cấp lại.')
    }
  }
  const saved = {
    ...profile,
    ...(operation === 'create'
      ? { createdAt: commandContext.now, createdBy: serverActorSnapshot(actor) }
      : { updatedAt: commandContext.now, updatedBy: serverActorSnapshot(actor) }),
  }
  const nextStateVersion = Number(current.version) + 1
  const additionalStatements = []
  let stateGuard
  let responseUser = null
  let requestedUsername = String(profilePayload.username || '').trim()
  let requestedPassword = String(profilePayload.password || '')
  const requestedAuthUserId = String(profilePayload.authUserId || '').trim()
  const expectedAuthRole = roleForEmployeeUnit(unit)

  if (operation === 'create') {
    if (linkedStoreEmployee) {
      const linkedTarget = await uniqueUserByEmployeeIdentifier(db, linkedEmployeeId)
      if (!linkedTarget || !['employee', 'business_support', 'store_manager'].includes(linkedTarget.role)) {
        throw new ApiError(409, 'LINKED_EMPLOYEE_ACCOUNT_REQUIRED', 'Hồ sơ được chọn phải có tài khoản đăng nhập đang hoạt động.')
      }
      if (linkedTarget.status !== 'active') {
        throw new ApiError(409, 'LINKED_EMPLOYEE_ACCOUNT_INACTIVE', 'Tài khoản nhân viên được chọn đang bị khóa hoặc ngưng hoạt động.')
      }
      const currentAuthVersion = Number(linkedTarget.version || 1)
      responseUser = {
        ...publicUser(linkedTarget),
        version: currentAuthVersion,
      }
      saved.username = linkedTarget.username
      saved.authUserId = linkedTarget.id
      saved.authVersion = currentAuthVersion
      saved.linkedEmployeeId = linkedEmployeeId
      stateGuard = {
        sql: 'SELECT 1 FROM users WHERE id = ? AND version = ? AND LOWER(employee_id) = LOWER(?)',
        bindings: [linkedTarget.id, currentAuthVersion, linkedEmployeeId],
      }
    } else {
    if (requestedAuthUserId && !['business_support', 'store_manager', 'office'].includes(unit)) {
      throw new ApiError(400, 'AUTH_LINK_INVALID', 'Chỉ hồ sơ Hỗ trợ KD, Quản lý cửa hàng hoặc Khối văn phòng được liên kết tài khoản có sẵn.')
    }
    const linkedTarget = requestedAuthUserId
      ? await first(db, 'SELECT * FROM users WHERE id = ? LIMIT 1', requestedAuthUserId)
      : null
    if (requestedAuthUserId && !linkedTarget) {
      throw new ApiError(404, 'USER_NOT_FOUND', 'Không tìm thấy tài khoản cần liên kết.')
    }
    if (linkedTarget) {
      if (linkedTarget.role !== expectedAuthRole || linkedTarget.employee_id) {
        throw new ApiError(409, 'AUTH_LINK_INVALID', 'Tài khoản đã liên kết hồ sơ hoặc không đúng vai trò.')
      }
      const username = requestedUsername || linkedTarget.username
      if (!/^[A-Za-z0-9._-]{3,80}$/u.test(username)) {
        throw new ApiError(400, 'INVALID_USERNAME', 'Tên đăng nhập nhân viên không hợp lệ.')
      }
      const normalizedUsername = normalizeUsername(username)
      const duplicate = await first(db, `
        SELECT id FROM users WHERE username_normalized = ? AND id <> ? LIMIT 1
      `, normalizedUsername, linkedTarget.id)
      if (duplicate) throw new ApiError(409, 'USER_EXISTS', 'Tên đăng nhập đã được sử dụng.')
      const password = requestedPassword ? await hashPassword(requestedPassword) : null
      const currentAuthVersion = Number(linkedTarget.version || 1)
      const nextAuthVersion = currentAuthVersion + 1
      responseUser = {
        ...publicUser(linkedTarget),
        username,
        displayName: saved.name,
        storeId,
        employeeId: saved.id,
        version: nextAuthVersion,
      }
      saved.username = username
      saved.authUserId = linkedTarget.id
      saved.authVersion = nextAuthVersion
      stateGuard = {
        sql: 'SELECT 1 FROM users WHERE id = ? AND version = ? AND employee_id IS NULL',
        bindings: [linkedTarget.id, currentAuthVersion],
      }
      additionalStatements.push(db.prepare(`
        UPDATE users
        SET username = ?, username_normalized = ?, display_name = ?, store_id = ?, employee_id = ?,
            password_hash = ?, password_salt = ?, password_iterations = ?, password_algorithm = ?,
            password_updated_at = ?, version = ?, updated_at = ?
        WHERE id = ? AND version = ? AND employee_id IS NULL AND role = ?
          AND EXISTS (
            SELECT 1 FROM app_state
            WHERE scope_key = 'global' AND version = ? AND last_request_id = ?
          )
      `).bind(
        username,
        normalizedUsername,
        saved.name,
        storeId,
        saved.id,
        password?.hash || linkedTarget.password_hash,
        password?.salt || linkedTarget.password_salt,
        password?.iterations || linkedTarget.password_iterations,
        password?.algorithm || linkedTarget.password_algorithm,
        password ? commandContext.now : linkedTarget.password_updated_at,
        nextAuthVersion,
        commandContext.now,
        linkedTarget.id,
        currentAuthVersion,
        expectedAuthRole,
        nextStateVersion,
        commandContext.requestId,
      ))
      additionalStatements.push(db.prepare(`
        UPDATE sessions
        SET revoked_at = ?, last_seen_at = ?
        WHERE user_id = ? AND revoked_at IS NULL
          AND EXISTS (SELECT 1 FROM users WHERE id = ? AND version = ? AND LOWER(employee_id) = LOWER(?))
      `).bind(
        commandContext.now,
        commandContext.now,
        linkedTarget.id,
        linkedTarget.id,
        nextAuthVersion,
        saved.id,
      ))
    } else {
      const credentialsRequired = ['business_support', 'store_manager', 'office', 'store'].includes(unit)
      if (credentialsRequired && (!requestedUsername || !requestedPassword)) {
        throw new ApiError(400, 'EMPLOYEE_CREDENTIALS_REQUIRED', 'Tên đăng nhập và mật khẩu là bắt buộc cho vai trò này.')
      }
      if (requestedUsername || requestedPassword) {
        if (!requestedUsername || !requestedPassword) {
          throw new ApiError(400, 'EMPLOYEE_CREDENTIALS_REQUIRED', 'Tên đăng nhập và mật khẩu nhân viên phải được gửi cùng nhau.')
        }
        if (!/^[A-Za-z0-9._-]{3,80}$/u.test(requestedUsername)) {
          throw new ApiError(400, 'INVALID_USERNAME', 'Tên đăng nhập nhân viên không hợp lệ.')
        }
        const normalizedUsername = normalizeUsername(requestedUsername)
        const duplicate = await first(db, `
          SELECT id FROM users WHERE username_normalized = ? OR LOWER(employee_id) = LOWER(?) LIMIT 1
        `, normalizedUsername, saved.id)
        if (duplicate) throw new ApiError(409, 'USER_EXISTS', 'Tên đăng nhập hoặc mã nhân viên đã có tài khoản.')
        const password = await hashPassword(requestedPassword)
        const userId = `usr_${crypto.randomUUID()}`
        responseUser = {
          id: userId,
          username: requestedUsername,
          displayName: saved.name,
          role: expectedAuthRole,
          storeId,
          employeeId: saved.id,
          status: 'active',
          version: 1,
          lastLoginAt: null,
        }
        saved.username = requestedUsername
        saved.authUserId = userId
        saved.authVersion = 1
        additionalStatements.push(db.prepare(`
          INSERT INTO users (
            id, username, username_normalized, display_name, password_hash, password_salt,
            password_iterations, password_algorithm, role, status, version, store_id, employee_id,
            created_at, updated_at, password_updated_at
          )
          SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', 1, ?, ?, ?, ?, ?
          WHERE EXISTS (
            SELECT 1 FROM app_state
            WHERE scope_key = 'global' AND version = ? AND last_request_id = ?
          )
        `).bind(
          userId,
          requestedUsername,
          normalizedUsername,
          saved.name,
          password.hash,
          password.salt,
          password.iterations,
          password.algorithm,
          expectedAuthRole,
          storeId,
          saved.id,
          commandContext.now,
          commandContext.now,
          commandContext.now,
          nextStateVersion,
          commandContext.requestId,
        ))
      }
    }
    }
  }

  if (operation === 'update' && !previous?.linkedEmployeeId) {
    const authEmployeeId = saved.id
    const authTarget = await uniqueUserByEmployeeIdentifier(db, authEmployeeId)
    if (authTarget) {
      if (authTarget.role !== expectedAuthRole) {
        throw new ApiError(409, 'EMPLOYEE_ROLE_MISMATCH', 'Vai trò tài khoản không khớp nhóm hồ sơ nhân viên.')
      }
      if (actor.role !== 'admin' && authTarget.status === 'inactive') {
        throw new ApiError(403, 'EMPLOYEE_REACTIVATE_FORBIDDEN', 'Chỉ Admin được khôi phục tài khoản nhân viên đã nghỉ việc.')
      }
      const username = requestedUsername || authTarget.username
      const normalizedUsername = normalizeUsername(username)
      if (!/^[A-Za-z0-9._-]{3,80}$/u.test(username)) {
        throw new ApiError(400, 'INVALID_USERNAME', 'Tên đăng nhập nhân viên không hợp lệ.')
      }
      const duplicate = await first(db, `
        SELECT id FROM users WHERE username_normalized = ? AND id <> ? LIMIT 1
      `, normalizedUsername, authTarget.id)
      if (duplicate) throw new ApiError(409, 'USER_EXISTS', 'Tên đăng nhập đã được sử dụng.')
      const password = requestedPassword ? await hashPassword(requestedPassword) : null
      const currentAuthVersion = Number(authTarget.version || 1)
      const nextAuthVersion = currentAuthVersion + 1
      responseUser = {
        ...publicUser(authTarget),
        username,
        displayName: saved.name,
        storeId,
        status: requestedStatus?.account || authTarget.status,
        version: nextAuthVersion,
      }
      saved.username = username
      saved.authUserId = authTarget.id
      saved.authVersion = nextAuthVersion
      stateGuard = {
        sql: 'SELECT 1 FROM users WHERE id = ? AND version = ?',
        bindings: [authTarget.id, currentAuthVersion],
      }
      additionalStatements.push(db.prepare(`
        UPDATE users
        SET username = ?, username_normalized = ?, display_name = ?, store_id = ?, status = ?,
            password_hash = ?, password_salt = ?, password_iterations = ?, password_algorithm = ?,
            password_updated_at = ?, version = ?, updated_at = ?
        WHERE id = ? AND version = ?
          AND EXISTS (
            SELECT 1 FROM app_state
            WHERE scope_key = 'global' AND version = ? AND last_request_id = ?
          )
      `).bind(
        username,
        normalizedUsername,
        saved.name,
        storeId,
        requestedStatus?.account || authTarget.status,
        password?.hash || authTarget.password_hash,
        password?.salt || authTarget.password_salt,
        password?.iterations || authTarget.password_iterations,
        password?.algorithm || authTarget.password_algorithm,
        password ? commandContext.now : authTarget.password_updated_at,
        nextAuthVersion,
        commandContext.now,
        authTarget.id,
        currentAuthVersion,
        nextStateVersion,
        commandContext.requestId,
      ))
      if (requestedPassword
        || String(authTarget.store_id || '') !== storeId
        || (requestedStatus && requestedStatus.account !== 'active')) {
        additionalStatements.push(db.prepare(`
          UPDATE sessions
          SET revoked_at = ?, last_seen_at = ?
          WHERE user_id = ? AND revoked_at IS NULL
            AND EXISTS (
              SELECT 1 FROM users WHERE id = ? AND version = ? AND updated_at = ?
            )
        `).bind(
          commandContext.now,
          commandContext.now,
          authTarget.id,
          authTarget.id,
          nextAuthVersion,
          commandContext.now,
        ))
      }
    } else {
      delete saved.username
      delete saved.authUserId
      delete saved.authVersion
      if (requestedUsername || requestedPassword) {
        if (!requestedUsername || !requestedPassword) {
          throw new ApiError(400, 'EMPLOYEE_CREDENTIALS_REQUIRED', 'Tên đăng nhập và mật khẩu nhân viên phải được gửi cùng nhau.')
        }
        if (!/^[A-Za-z0-9._-]{3,80}$/u.test(requestedUsername)) {
          throw new ApiError(400, 'INVALID_USERNAME', 'Tên đăng nhập nhân viên không hợp lệ.')
        }
        const normalizedUsername = normalizeUsername(requestedUsername)
        const duplicate = await first(db, `
          SELECT id FROM users WHERE username_normalized = ? OR LOWER(employee_id) = LOWER(?) LIMIT 1
        `, normalizedUsername, saved.id)
        if (duplicate) throw new ApiError(409, 'USER_EXISTS', 'Tên đăng nhập hoặc mã nhân viên đã có tài khoản.')
        const password = await hashPassword(requestedPassword)
        const userId = `usr_${crypto.randomUUID()}`
        const accountStatus = employeeStatusValues(saved.status).account
        responseUser = {
          id: userId,
          username: requestedUsername,
          displayName: saved.name,
          role: expectedAuthRole,
          storeId,
          employeeId: saved.id,
          status: accountStatus,
          version: 1,
          lastLoginAt: null,
        }
        saved.username = requestedUsername
        saved.authUserId = userId
        saved.authVersion = 1
        stateGuard = {
          sql: 'SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM users WHERE username_normalized = ? OR LOWER(employee_id) = LOWER(?))',
          bindings: [normalizedUsername, saved.id],
        }
        additionalStatements.push(db.prepare(`
          INSERT INTO users (
            id, username, username_normalized, display_name, password_hash, password_salt,
            password_iterations, password_algorithm, role, status, version, store_id, employee_id,
            created_at, updated_at, password_updated_at
          )
          SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?
          WHERE EXISTS (
            SELECT 1 FROM app_state
            WHERE scope_key = 'global' AND version = ? AND last_request_id = ?
          )
        `).bind(
          userId,
          requestedUsername,
          normalizedUsername,
          saved.name,
          password.hash,
          password.salt,
          password.iterations,
          password.algorithm,
          expectedAuthRole,
          accountStatus,
          storeId,
          saved.id,
          commandContext.now,
          commandContext.now,
          commandContext.now,
          nextStateVersion,
          commandContext.requestId,
        ))
      }
    }
  }
  const nextEmployees = operation === 'create'
    ? [saved, ...employees]
    : employees.map((employee) => sameIdentifier(employee.id || employee.code, employeeId) ? saved : employee)
  const payrollTargets = []
  if (operation === 'update') {
    const targetPeriod = String(profilePayload.standardWorkDaysPeriod || '')
    const targetDaysChanged = Boolean(targetPeriod) && (
      Number(previous?.monthlyWorkdayTargets?.[targetPeriod]) !== Number(saved.monthlyWorkdayTargets?.[targetPeriod])
    )
    if (targetDaysChanged) {
      const period = payrollPeriodFor(state, storeId, targetPeriod)
      if (period?.lockedAt || period?.status === 'Đã khóa') {
        throw new ApiError(409, 'PAYROLL_PERIOD_LOCKED', 'Kỳ lương đã khóa; không thể đổi số ngày công.')
      }
      if (period?.confirmedAt || period?.status === 'Đã chi') {
        throw new ApiError(409, 'PAYROLL_PERIOD_PAID', 'Kỳ lương đã chi; không thể đổi số ngày công.')
      }
      payrollTargets.push({ storeId, period: targetPeriod })
    }
    const payrollFields = [
      'status', 'employmentType', 'payBasis', 'salaryBasis', 'salary',
      'monthlySalary', 'hourlyRate', 'baseSalary', 'requiredMonthlyHours',
      'standardWorkDays', 'payFormula', 'tiktokAllowance',
    ]
    const compensationChanged = payrollFields.some((field) => (
      JSON.stringify(canonicalize(previous?.[field])) !== JSON.stringify(canonicalize(saved?.[field]))
    ))
    if (compensationChanged) {
      const currentPeriod = localDateTimeParts(commandContext.now).date.slice(0, 7)
      if (unit === 'store' && isSecondMallSm234Store(store)) {
        assertPayrollNotPaidOrLocked(state, storeId, currentPeriod)
      }
      for (const period of Array.isArray(state.payrollPeriods) ? state.payrollPeriods : []) {
        if (!sameIdentifier(period.storeId, storeId)
          || period.status !== 'Đã chốt'
          || period.confirmedAt
          || period.lockedAt) continue
        payrollTargets.push({ storeId, period: String(period.period || '') })
      }
    }
  }
  const identityImageUpdate = linkedStoreEmployee
    ? { identityImages: linkedIdentityImages, uploadedKeys: [], retiredKeys: [] }
    : ['business_support', 'store_manager', 'office', 'store'].includes(unit)
      ? await prepareIdentityImageUpdate(env, profilePayload, previous, saved.id, commandContext.now)
    : { identityImages: {}, uploadedKeys: [], retiredKeys: [] }
  if (Object.keys(identityImageUpdate.identityImages).length) saved.identityImages = identityImageUpdate.identityImages
  else delete saved.identityImages
  const nextState = {
    ...state,
    employees: nextEmployees,
    stores: (Array.isArray(state.stores) ? state.stores : []).map((item) => ({
      ...item,
      employees: nextEmployees.filter((employee) => (
        sameIdentifier(employee.storeId, item.id)
        && employeeUnit(employee) === 'store'
        && !employee.deletedAt
        && !['Đã nghỉ việc', 'inactive'].includes(String(employee.status || ''))
      )).length,
    })),
    payrollPeriods: invalidateClosedPayrollPeriods(state, payrollTargets, commandContext.now, body.type),
    stateVersion: Math.max(1, Number(state.stateVersion) || 1) + 1,
  }
  try {
    const response = await commitGlobalStateDomainCommand(db, actor, current, nextState, {
      action: body.type,
      entityType: 'employee',
      entityId: saved.id,
      before: previous,
      after: saved,
      metadata: { payrollTargets },
      response: { command: body.type, employee: saved, ...(responseUser ? { user: responseUser } : {}) },
      additionalStatements,
      stateGuard,
      status: operation === 'create' ? 201 : 200,
    }, commandContext)
    await bestEffortDeleteIdentityImages(env?.IDENTITY_IMAGES, identityImageUpdate.retiredKeys)
    return response
  } catch (error) {
    await bestEffortDeleteIdentityImages(env?.IDENTITY_IMAGES, identityImageUpdate.uploadedKeys)
    throw error
  }
}

const BRIGHT_SHIFT_COLORS = Object.freeze([
  '#22C55E', '#3B82F6', '#F97316', '#A855F7', '#EC4899',
  '#06B6D4', '#EAB308', '#EF4444', '#14B8A6', '#8B5CF6',
])

const shiftDefinitionCommand = async (db, actor, body, commandContext) => {
  assertOperationsRole(actor, 'Tài khoản không có quyền quản lý ca làm việc cửa hàng.')
  const operation = body.type.split('.').at(-1)
  if (!['create', 'update', 'delete'].includes(operation)) {
    throw new ApiError(400, 'COMMAND_UNKNOWN', 'Lệnh ca làm việc không được hỗ trợ.')
  }
  const payload = isPlainRecord(body.payload) ? body.payload : {}
  const { current, state } = await loadGlobalCommandState(db, body)
  const definitions = Array.isArray(state.shiftDefinitions) ? state.shiftDefinitions : []
  let shiftId = operation === 'create'
    ? String(payload.id || `shift_${crypto.randomUUID()}`).trim()
    : String(payload.shiftId || payload.id || '').trim()
  if (!/^[A-Za-z0-9_-]{1,160}$/u.test(shiftId)) throw new ApiError(400, 'SHIFT_INVALID', 'Mã ca làm việc không hợp lệ.')
  const matchingDefinitions = definitions
    .map((shift, index) => ({ shift, index }))
    .filter(({ shift }) => sameIdentifier(shift.id, shiftId) && !shift.deletedAt)
  if (matchingDefinitions.length > 1) {
    throw new ApiError(
      409,
      'SHIFT_IDENTIFIER_COLLISION',
      'Mã ca làm việc đang trùng với nhiều bản ghi; không thể cập nhật an toàn.',
      {
        identifier: normalizeIdentifierKey(shiftId),
        conflictingIdentifiers: matchingDefinitions.map(({ shift }) => String(shift.id || '')),
      },
    )
  }
  const previousMatch = matchingDefinitions[0] || null
  const previous = previousMatch?.shift || null
  if (operation === 'create' && previous) throw new ApiError(409, 'SHIFT_EXISTS', 'Mã ca làm việc đã tồn tại.')
  if (operation !== 'create' && !previous) throw new ApiError(404, 'SHIFT_NOT_FOUND', 'Không tìm thấy ca làm việc.')
  if (previous) shiftId = String(previous.id || shiftId)
  const requestedStoreId = String(payload.storeId ?? previous?.storeId ?? '').trim()
  if (previous && payload.storeId !== undefined && !sameIdentifier(requestedStoreId, previous.storeId)) {
    throw new ApiError(400, 'SHIFT_STORE_IMMUTABLE', 'Không thể chuyển ca làm việc sang cửa hàng khác.')
  }
  const scopedStoreId = String(previous?.storeId || requestedStoreId).trim()
  assertOperationalStoreAccess(actor, scopedStoreId)
  const store = requireStore(state, scopedStoreId)
  const storeId = String(store.id || scopedStoreId).trim()

  if (operation === 'delete') {
    const deleted = { ...previous, deletedAt: commandContext.now, deletedBy: serverActorSnapshot(actor), active: false }
    const nextState = {
      ...state,
      shiftDefinitions: definitions.map((shift, index) => index === previousMatch.index ? deleted : shift),
      stateVersion: Math.max(1, Number(state.stateVersion) || 1) + 1,
    }
    return commitGlobalStateDomainCommand(db, actor, current, nextState, {
      action: body.type,
      entityType: 'shift-definition',
      entityId: shiftId,
      before: previous,
      after: deleted,
      response: { command: body.type, shift: deleted },
    }, commandContext)
  }

  const name = String(payload.name ?? previous?.name ?? '').trim().slice(0, 160)
  const date = String(payload.date ?? previous?.date ?? '').trim()
  const start = parseShiftTime(payload.start ?? previous?.start)
  const end = parseShiftTime(payload.end ?? previous?.end)
  if (!name) throw new ApiError(400, 'SHIFT_NAME_INVALID', 'Tên ca không được để trống.')
  if (date && !/^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/u.test(date)) {
    throw new ApiError(400, 'SHIFT_DATE_INVALID', 'Ngày áp dụng ca phải có định dạng YYYY-MM-DD.')
  }
  if (!start || !end || end.minuteOfDay <= start.minuteOfDay) {
    throw new ApiError(400, 'SHIFT_TIME_INVALID', 'Giờ bắt đầu/kết thúc phải theo định dạng 24 giờ và giờ kết thúc phải sau giờ bắt đầu.')
  }
  const sameStoreCount = definitions.filter((shift) => sameIdentifier(shift.storeId, storeId) && !shift.deletedAt).length
  const shift = {
    ...(previous || {}),
    id: shiftId,
    storeId,
    name,
    date: date || null,
    start: start.label,
    end: end.label,
    time: `${start.label} - ${end.label}`,
    color: previous?.color || BRIGHT_SHIFT_COLORS[sameStoreCount % BRIGHT_SHIFT_COLORS.length],
    durationMinutes: end.minuteOfDay - start.minuteOfDay,
    durationHours: (end.minuteOfDay - start.minuteOfDay) / 60,
    version: operation === 'create' ? 1 : Number(previous?.version || 1) + 1,
    active: true,
    ...(operation === 'create'
      ? { createdAt: commandContext.now, createdBy: serverActorSnapshot(actor) }
      : { updatedAt: commandContext.now, updatedBy: serverActorSnapshot(actor) }),
  }
  const nextState = {
    ...state,
    shiftDefinitions: operation === 'create'
      ? [shift, ...definitions]
        : definitions.map((item, index) => index === previousMatch.index ? shift : item),
    stateVersion: Math.max(1, Number(state.stateVersion) || 1) + 1,
  }
  return commitGlobalStateDomainCommand(db, actor, current, nextState, {
    action: body.type,
    entityType: 'shift-definition',
    entityId: shiftId,
    before: previous,
    after: shift,
    response: { command: body.type, shift },
    status: operation === 'create' ? 201 : 200,
  }, commandContext)
}

const scheduleCommand = async (db, actor, body, commandContext) => {
  assertOperationsRole(actor, 'Tài khoản không có quyền phân ca cửa hàng.')
  if (!['schedule.assign', 'schedule.replace_day'].includes(body.type)) {
    throw new ApiError(400, 'COMMAND_UNKNOWN', 'Lệnh lịch phân ca không được hỗ trợ.')
  }
  const payload = isPlainRecord(body.payload) ? body.payload : {}
  const requestedStoreId = String(payload.storeId || '').trim()
  const date = String(payload.date || '').trim()
  assertOperationalStoreAccess(actor, requestedStoreId)
  if (!/^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/u.test(date)) {
    throw new ApiError(400, 'SCHEDULE_DATE_INVALID', 'Ngày phân ca phải có định dạng YYYY-MM-DD.')
  }
  const { current, state } = await loadGlobalCommandState(db, body)
  const store = requireStore(state, requestedStoreId)
  const storeId = String(store.id || requestedStoreId).trim()
  const storeEmployees = new Map((Array.isArray(state.employees) ? state.employees : [])
    .filter((employee) => (
      employeeWorksAtStoreOnDate(state, employee, storeId, date)
      && employeeUnit(employee) === 'store'
      && !employee.deletedAt
    ))
    .map((employee) => [normalizeIdentifierKey(employee.id || employee.code), String(employee.id || employee.code || '')]))
  const shiftDefinitions = (Array.isArray(state.shiftDefinitions) ? state.shiftDefinitions : [])
    .filter((shift) => sameIdentifier(shift.storeId, storeId) && !shift.deletedAt && shift.active !== false)
  assertUniqueShiftDefinitionIdentifiers(shiftDefinitions)
  const shifts = new Map(shiftDefinitions.map((shift) => [normalizeIdentifierKey(shift.id), shift]))
  const schedule = Array.isArray(state.schedule) ? state.schedule : []
  let rawAssignments
  if (body.type === 'schedule.assign') {
    const employeeIds = Array.isArray(payload.employeeIds)
      ? [...new Map(payload.employeeIds
          .map((employeeId) => String(employeeId || '').trim())
          .filter(Boolean)
          .map((employeeId) => [normalizeIdentifierKey(employeeId), employeeId])).values()]
      : []
    const shiftIds = Array.isArray(payload.shiftIds) ? [...new Set(payload.shiftIds.map(String))] : []
    if (!employeeIds.length || !shiftIds.length) {
      throw new ApiError(400, 'SCHEDULE_ASSIGNMENT_INVALID', 'Cần chọn ít nhất một ca và một nhân viên.')
    }
    rawAssignments = employeeIds.map((employeeId) => ({ employeeId, shiftIds, note: payload.note }))
  } else {
    if (!Array.isArray(payload.assignments) || payload.assignments.length > 500) {
      throw new ApiError(400, 'SCHEDULE_ASSIGNMENT_INVALID', 'Danh sách phân ca không hợp lệ.')
    }
    rawAssignments = [...payload.assignments.reduce((byEmployee, assignment) => {
      const employeeId = String(assignment?.employeeId || '').trim()
      const key = normalizeIdentifierKey(employeeId)
      if (!key || !isPlainRecord(assignment)) {
        byEmployee.set(`invalid:${byEmployee.size}`, assignment)
        return byEmployee
      }
      const previousAssignment = byEmployee.get(key)
      if (!previousAssignment) {
        byEmployee.set(key, assignment)
        return byEmployee
      }
      byEmployee.set(key, {
        ...previousAssignment,
        ...assignment,
        employeeId: previousAssignment.employeeId || assignment.employeeId,
        shiftIds: [
          ...(Array.isArray(previousAssignment.shiftIds) ? previousAssignment.shiftIds : [previousAssignment.shiftId]),
          ...(Array.isArray(assignment.shiftIds) ? assignment.shiftIds : [assignment.shiftId]),
        ].filter(Boolean),
      })
      return byEmployee
    }, new Map()).values()]
  }
  const assignments = rawAssignments.map((assignment, index) => {
    if (!isPlainRecord(assignment)) throw new ApiError(400, 'SCHEDULE_ASSIGNMENT_INVALID', `Phân ca thứ ${index + 1} không hợp lệ.`)
    const requestedEmployeeId = String(assignment.employeeId || '').trim()
    const requestedShiftIds = [...new Map((Array.isArray(assignment.shiftIds)
      ? assignment.shiftIds
      : [assignment.shiftId])
      .map((shiftId) => String(shiftId || '').trim())
      .filter(Boolean)
      .map((shiftId) => [normalizeIdentifierKey(shiftId), shiftId])).values()]
    const employeeId = storeEmployees.get(normalizeIdentifierKey(requestedEmployeeId))
    if (!employeeId) {
      throw new ApiError(400, 'EMPLOYEE_STORE_MISMATCH', `Nhân viên ${requestedEmployeeId || index + 1} không thuộc cửa hàng.`)
    }
    if (!requestedShiftIds.length || requestedShiftIds.some((shiftId) => !shifts.has(normalizeIdentifierKey(shiftId)))) {
      throw new ApiError(400, 'SHIFT_INVALID', `Ca làm việc của nhân viên ${employeeId} không hợp lệ.`)
    }
    const shiftIds = requestedShiftIds.map((shiftId) => String(shifts.get(normalizeIdentifierKey(shiftId)).id || shiftId))
    const mismatchedShift = shiftIds.map((shiftId) => shifts.get(normalizeIdentifierKey(shiftId)))
      .find((shift) => shift.date && String(shift.date) !== date)
    if (mismatchedShift) {
      throw new ApiError(400, 'SHIFT_DATE_MISMATCH', `Ca ${mismatchedShift.name || mismatchedShift.id} chỉ áp dụng ngày ${mismatchedShift.date}.`)
    }
    const previousAssignment = schedule.find((entry) => (
      sameIdentifier(entry.storeId, storeId)
      && String(entry.date || entry.workDate || '') === date
      && sameIdentifier(employeeReference(entry), employeeId)
    ))
    const previousSnapshots = new Map((Array.isArray(previousAssignment?.shiftSnapshots) ? previousAssignment.shiftSnapshots : [])
      .filter(isPlainRecord)
      .map((snapshot) => [normalizeIdentifierKey(snapshot.id), snapshot]))
    const shiftSnapshots = shiftIds.map((shiftId) => {
      const previousSnapshot = previousSnapshots.get(normalizeIdentifierKey(shiftId))
      if (previousSnapshot) return previousSnapshot
      const shift = shifts.get(normalizeIdentifierKey(shiftId))
      return {
        id: shift.id,
        name: shift.name,
        start: shift.start,
        end: shift.end,
        time: shift.time || `${shift.start} - ${shift.end}`,
        color: shift.color,
        durationMinutes: Number(shift.durationMinutes || 0),
        durationHours: Number(shift.durationHours || 0),
        date: shift.date || null,
        version: Number(shift.version || 1),
      }
    })
    return {
      id: String(assignment.id || previousAssignment?.id || `schedule_${crypto.randomUUID()}`),
      storeId,
      employeeId,
      date,
      shiftIds,
      shiftId: shiftIds[0],
      shiftSnapshots,
      note: String(assignment.note || '').trim().slice(0, 500),
      createdAt: previousAssignment?.createdAt || commandContext.now,
      createdBy: previousAssignment?.createdBy || serverActorSnapshot(actor),
      ...(previousAssignment ? { updatedAt: commandContext.now, updatedBy: serverActorSnapshot(actor) } : {}),
    }
  })
  const outsideDay = schedule.filter((entry) => !(
    sameIdentifier(entry.storeId, storeId) && String(entry.date || entry.workDate || '') === date
  ))
  let nextDay = assignments
  if (body.type === 'schedule.assign') {
    const selected = new Set(assignments.map((entry) => normalizeIdentifierKey(entry.employeeId)))
    nextDay = [
      ...assignments,
      ...schedule.filter((entry) => (
        sameIdentifier(entry.storeId, storeId)
        && String(entry.date || entry.workDate || '') === date
        && !selected.has(normalizeIdentifierKey(employeeReference(entry)))
      )),
    ]
  }
  const nextState = {
    ...state,
    schedule: [...nextDay, ...outsideDay],
    stateVersion: Math.max(1, Number(state.stateVersion) || 1) + 1,
  }
  return commitGlobalStateDomainCommand(db, actor, current, nextState, {
    action: body.type,
    entityType: 'schedule-day',
    entityId: `${storeId}:${date}`,
    before: schedule.filter((entry) => sameIdentifier(entry.storeId, storeId) && String(entry.date || entry.workDate || '') === date),
    after: nextDay,
    metadata: { storeId, date, assignmentCount: nextDay.length },
    response: { command: body.type, storeId, date, assignments: nextDay },
  }, commandContext)
}

const optionalCalendarDate = (value, field) => {
  const date = String(value || '').trim()
  if (!date) return ''
  const match = date.match(/^(\d{4})-(\d{2})-(\d{2})$/u)
  const parsed = match ? new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))) : null
  if (!parsed
    || parsed.getUTCFullYear() !== Number(match[1])
    || parsed.getUTCMonth() + 1 !== Number(match[2])
    || parsed.getUTCDate() !== Number(match[3])) {
    throw new ApiError(400, 'DATE_INVALID', `${field} không hợp lệ.`)
  }
  return date
}

const accountSettingsPayload = (body) => (
  isPlainRecord(body?.payload?.settings)
    ? body.payload.settings
    : (isPlainRecord(body?.payload) ? body.payload : {})
)

const accountSettingsUpdatesAvatar = (body) => accountSettingsPayload(body).avatar !== undefined

const accountSettingsCommand = async (db, actor, body, commandContext, env) => {
  if (!VALID_ROLES.has(actor.role)) throw new ApiError(403, 'ROLE_FORBIDDEN', 'Tài khoản không có quyền cập nhật thiết lập tài khoản.')
  if (body.type !== 'account_settings.update') {
    throw new ApiError(400, 'COMMAND_UNKNOWN', 'Lệnh thiết lập tài khoản không được hỗ trợ.')
  }
  const payload = accountSettingsPayload(body)
  const updatesAvatar = payload.avatar !== undefined
  const { current, state: storedState } = await loadGlobalCommandState(db, body)
  const avatarMutation = updatesAvatar
    ? await beginAccountAvatarMutationCleanup(
      db,
      actor.user_id,
      commandContext.requestId,
      commandContext.now,
    )
    : null
  const avatarLifecycle = avatarMutation
    ? accountAvatarMutationLifecycle(db, env?.IDENTITY_IMAGES, avatarMutation)
    : {}
  let legacyMigration = {
    changed: false,
    state: storedState,
    uploadedKeys: [],
    replacements: new Map(),
    quarantined: [],
  }
  if (avatarMutation) {
    try {
      legacyMigration = await prepareLegacyAccountAvatarMigration(
        env,
        db,
        storedState,
        commandContext.now,
        actor.user_id,
        avatarLifecycle,
      )
    } catch (error) {
      await cleanupAccountAvatarMutation(db, env?.IDENTITY_IMAGES, avatarMutation.metaKey, commandContext, {
        suppressFailure: true,
      })
      throw error
    }
  }
  let committed = false
  let avatarUpdate
  try {
  const state = normalizeSharedStateForStorage(legacyMigration.state)
  const userId = String(actor.user_id)
  const target = await first(db, "SELECT * FROM users WHERE id = ? AND role IN ('admin', 'business_support', 'store_manager', 'employee') LIMIT 1", actor.user_id)
  if (!target) throw new ApiError(404, 'USER_NOT_FOUND', 'Không tìm thấy tài khoản quản trị hiện tại.')
  const previous = ownAccountSettings(state, actor)
  if (!updatesAvatar) {
    const storedSettings = isPlainRecord(state.accountSettings?.[userId]) ? state.accountSettings[userId] : null
    const legacySettings = actor.role === 'admin' && isPlainRecord(state.settings) ? state.settings : null
    if (storedSettings && Object.hasOwn(storedSettings, 'avatar')) previous.avatar = storedSettings.avatar
    else if (legacySettings && Object.hasOwn(legacySettings, 'avatar')) previous.avatar = legacySettings.avatar
  }
  const next = { ...previous }
  if (payload.name !== undefined) next.name = String(payload.name || '').trim().slice(0, 160)
  if (!next.name) throw new ApiError(400, 'DISPLAY_NAME_INVALID', 'Họ tên không được để trống.')
  if (payload.email !== undefined) {
    const email = String(payload.email || '').trim().toLowerCase()
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) {
      throw new ApiError(400, 'EMAIL_INVALID', 'Email không đúng định dạng.')
    }
    next.email = email.slice(0, 254)
  }
  if (payload.phone !== undefined) {
    const phone = String(payload.phone || '').replace(/\D/gu, '')
    if (phone && !/^0\d{9}$/u.test(phone)) {
      throw new ApiError(400, 'PHONE_INVALID', 'Số điện thoại phải có đúng 10 số và bắt đầu bằng số 0.')
    }
    next.phone = phone
  }
  if (payload.birthday !== undefined) next.birthday = optionalCalendarDate(payload.birthday, 'Ngày sinh')
  if (payload.gender !== undefined) {
    const gender = String(payload.gender || '').trim()
    if (gender && !['Nam', 'Nữ', 'Khác'].includes(gender)) {
      throw new ApiError(400, 'GENDER_INVALID', 'Giới tính không hợp lệ.')
    }
    next.gender = gender
  }
  if (payload.address !== undefined) next.address = String(payload.address || '').trim().slice(0, 500)
  if (payload.bio !== undefined) {
    const bio = String(payload.bio || '').trim()
    if (bio.length > 200) throw new ApiError(400, 'BIO_TOO_LONG', 'Giới thiệu không được vượt quá 200 ký tự.')
    next.bio = bio
  }
  avatarUpdate = { avatar: previous.avatar, uploadedKeys: [], retiredKeys: [] }
  if (updatesAvatar) {
    avatarUpdate = await prepareAccountAvatarUpdate(
      env,
      payload.avatar,
      previous.avatar,
      actor.user_id,
      commandContext.now,
      avatarLifecycle,
    )
    next.avatar = avatarUpdate.avatar
  }
  if (payload.notifications !== undefined) {
    if (!isPlainRecord(payload.notifications)) {
      throw new ApiError(400, 'NOTIFICATION_PREFERENCES_INVALID', 'Thiết lập thông báo không hợp lệ.')
    }
    const notifications = { ...previous.notifications }
    for (const key of ['tasks', 'dailyReport', 'expenseAlert']) {
      if (payload.notifications[key] !== undefined) {
        if (typeof payload.notifications[key] !== 'boolean') {
          throw new ApiError(400, 'NOTIFICATION_PREFERENCES_INVALID', 'Giá trị thông báo phải là bật hoặc tắt.')
        }
        notifications[key] = payload.notifications[key]
      }
    }
    next.notifications = notifications
  }
  const currentUserVersion = Number(target.version || 1)
  const nextUserVersion = currentUserVersion + 1
  const nextStateVersion = Number(current.version) + 1
  const nextState = {
    ...state,
    accountSettings: { ...(isPlainRecord(state.accountSettings) ? state.accountSettings : {}), [userId]: next },
    stateVersion: Math.max(1, Number(state.stateVersion) || 1) + 1,
  }
  const responseUser = {
    ...publicUser({
      ...target,
      role: actor.role,
      store_id: actor.store_id,
      employee_id: actor.employee_id,
      available_roles: actor.available_roles,
      needs_role_selection: false,
    }),
    displayName: next.name,
    version: nextUserVersion,
  }
  const committedAvatarMutation = avatarMutation
    ? commitAccountAvatarMutationCleanup(
      avatarMutation,
      avatarUpdate.retiredKeys,
      [...accountAvatarKeysFromState(nextState)],
      commandContext.now,
    )
    : null
  let response
  try {
    response = await commitGlobalStateDomainCommand(db, actor, current, nextState, {
      action: body.type,
      entityType: 'account-settings',
      entityId: userId,
      before: previous,
      after: next,
      metadata: legacyMigration.changed
        ? { legacyAvatarMigration: legacyAvatarMigrationAudit(legacyMigration) }
        : {},
      response: { command: body.type, settings: next, user: responseUser },
      stateGuard: avatarMutation
        ? {
            sql: `
          SELECT 1 FROM users
          WHERE id = ? AND version = ?
            AND EXISTS (
              SELECT 1 FROM system_metadata WHERE meta_key = ? AND value_json = ?
            )
        `,
            bindings: [userId, currentUserVersion, avatarMutation.metaKey, avatarMutation.valueJson],
          }
        : {
            sql: 'SELECT 1 FROM users WHERE id = ? AND version = ?',
            bindings: [userId, currentUserVersion],
          },
      additionalStatements: [
        db.prepare(`
          UPDATE users
          SET display_name = ?, version = ?, updated_at = ?
          WHERE id = ? AND version = ?
            AND EXISTS (
              SELECT 1 FROM app_state
              WHERE scope_key = 'global' AND version = ? AND last_request_id = ?
            )
        `).bind(
          next.name,
          nextUserVersion,
          commandContext.now,
          userId,
          currentUserVersion,
          nextStateVersion,
          commandContext.requestId,
        ),
        ...(avatarMutation ? [db.prepare(`
          UPDATE system_metadata
          SET value_json = ?, version = version + 1, updated_at = ?
          WHERE meta_key = ? AND value_json = ?
            AND EXISTS (${stateSuccessSql})
        `).bind(
          committedAvatarMutation.valueJson,
          commandContext.now,
          avatarMutation.metaKey,
          avatarMutation.valueJson,
          'global',
          nextStateVersion,
          commandContext.requestId,
        )] : []),
      ],
    }, commandContext)
  } catch (error) {
    if (avatarMutation) {
      await cleanupAccountAvatarMutation(db, env?.IDENTITY_IMAGES, avatarMutation.metaKey, commandContext, {
        suppressFailure: true,
      })
    }
    throw error
  }
  committed = true
  if (avatarMutation) {
    await cleanupAccountAvatarMutation(db, env?.IDENTITY_IMAGES, avatarMutation.metaKey, commandContext, {
      suppressFailure: true,
    })
  }
  if (legacyMigration.changed) {
    try {
      await scrubLegacyAvatarArtifacts(db, legacyMigration.replacements)
      await markAccountAvatarMigrationComplete(db, commandContext.now)
    } catch (error) {
      console.warn('Unable to finish legacy account-avatar artifact cleanup after a committed update', { error: String(error) })
    }
  }
  return response
  } catch (error) {
    if (!committed && avatarMutation) {
      await cleanupAccountAvatarMutation(db, env?.IDENTITY_IMAGES, avatarMutation.metaKey, commandContext, {
        suppressFailure: true,
      })
    }
    throw error
  }
}

const notificationUnread = (record, actor) => !notificationReadAtForActor(record, actor)

const markNotificationReadForActor = (record, actor, timestamp) => {
  const actorId = notificationActorId(actor)
  if (!actorId) throw new ApiError(401, 'SESSION_INVALID', 'Phiên đăng nhập không hợp lệ.')
  return {
    ...record,
    readAtByUserId: {
      ...(isPlainRecord(record.readAtByUserId) ? record.readAtByUserId : {}),
      [actorId]: timestamp,
    },
    updatedAt: timestamp,
  }
}

const notificationCommand = async (db, actor, body, commandContext) => {
  const operation = body.type.split('.').at(-1)
  const markAll = ['mark_all_read', 'clear', 'clear_all'].includes(operation)
  if (operation !== 'mark_read' && !markAll) {
    throw new ApiError(400, 'COMMAND_UNKNOWN', 'Lệnh thông báo không được hỗ trợ.')
  }
  const payload = isPlainRecord(body.payload) ? body.payload : {}
  const { current, state } = await loadGlobalCommandState(db, body)
  const notifications = Array.isArray(state.notifications) ? state.notifications : []

  if (operation === 'mark_read') {
    const notificationId = String(payload.notificationId || payload.id || '').trim()
    if (!notificationId) throw new ApiError(400, 'NOTIFICATION_ID_REQUIRED', 'Cần chọn thông báo.')
    const previousMatch = uniqueIdentifierRecordMatch({
      records: notifications,
      identifier: notificationId,
      identifierOf: (record) => record.id || record.notificationId,
      collisionCode: 'NOTIFICATION_IDENTIFIER_COLLISION',
      collisionMessage: 'Mã thông báo đang trùng với nhiều bản ghi; không thể cập nhật an toàn.',
    })
    const previous = previousMatch?.record || null
    if (!previous || !canAccessNotification(state, actor, previous)) {
      throw new ApiError(404, 'NOTIFICATION_NOT_FOUND', 'Không tìm thấy thông báo trong phạm vi được phép.')
    }
    const previousProjected = projectNotificationForActor(previous, actor)
    if (!notificationUnread(previous, actor)) {
      return recordNoopCommand(db, actor, {
        command: body.type,
        version: Number(current.version),
        notification: previousProjected,
        notifications: [previousProjected],
        updatedCount: 0,
        existing: true,
      }, 200, commandContext)
    }
    const next = markNotificationReadForActor(previous, actor, commandContext.now)
    const nextProjected = projectNotificationForActor(next, actor)
    const nextState = {
      ...state,
      notifications: notifications.map((record) => (
        record === previous ? next : record
      )),
      stateVersion: Math.max(1, Number(state.stateVersion) || 1) + 1,
    }
    return commitGlobalStateDomainCommand(db, actor, current, nextState, {
      action: body.type,
      entityType: 'notification',
      entityId: notificationId,
      before: previous,
      after: next,
      metadata: { updatedCount: 1, readerId: notificationActorId(actor) },
      response: { command: body.type, notification: nextProjected, notifications: [nextProjected], updatedCount: 1 },
    }, commandContext)
  }

  const requestedStoreId = String(payload.storeId || '').trim()
  let storeId = requestedStoreId
  if (actor.role === 'employee') {
    storeId = String(actor.store_id || '')
    if (requestedStoreId && !sameIdentifier(requestedStoreId, storeId)) {
      throw new ApiError(403, 'STORE_FORBIDDEN', 'Nhân viên chỉ được xử lý thông báo của cửa hàng mình.')
    }
  }
  if (actor.role === 'store_manager') {
    storeId = String(actor.store_id || '')
    if (requestedStoreId && !sameIdentifier(requestedStoreId, storeId)) {
      throw new ApiError(403, 'STORE_SCOPE_FORBIDDEN', 'Quản lý cửa hàng chỉ được xử lý thông báo của cửa hàng mình.')
    }
  }
  if (storeId && ![OFFICE_STORE_ID, BUSINESS_SUPPORT_STORE_ID].some((unitId) => sameIdentifier(unitId, storeId))) {
    const store = requireStore(state, storeId)
    storeId = String(store.id || storeId)
  }
  const targets = notifications.filter((record) => (
    notificationUnread(record, actor)
    && canAccessNotification(state, actor, record)
    && (!storeId || sameIdentifier(record.storeId, storeId))
  ))
  if (!targets.length) {
    return recordNoopCommand(db, actor, {
      command: body.type,
      version: Number(current.version),
      storeId: storeId || null,
      notificationIds: [],
      notifications: [],
      updatedCount: 0,
      existing: true,
    }, 200, commandContext)
  }
  const targetIds = new Set(targets.map((record) => String(record.id || record.notificationId || '')))
  const updated = targets.map((record) => markNotificationReadForActor(record, actor, commandContext.now))
  const projectedUpdated = updated.map((record) => projectNotificationForActor(record, actor))
  const updatedById = new Map(updated.map((record) => [String(record.id || record.notificationId || ''), record]))
  const nextState = {
    ...state,
    notifications: notifications.map((record) => (
      updatedById.get(String(record.id || record.notificationId || '')) || record
    )),
    stateVersion: Math.max(1, Number(state.stateVersion) || 1) + 1,
  }
  return commitGlobalStateDomainCommand(db, actor, current, nextState, {
    action: body.type,
    entityType: 'notification-scope',
    entityId: `${actor.role}:${storeId || 'all'}`,
    before: targets.map((record) => ({ id: record.id || record.notificationId, readAt: notificationReadAtForActor(record, actor) })),
    after: projectedUpdated.map((record) => ({ id: record.id || record.notificationId, readAt: record.readAt })),
    metadata: { storeId: storeId || null, updatedCount: targetIds.size, readerId: notificationActorId(actor) },
    response: {
      command: body.type,
      storeId: storeId || null,
      notificationIds: [...targetIds],
      notifications: projectedUpdated,
      updatedCount: targetIds.size,
    },
  }, commandContext)
}

const monthsInDateRange = (fromDate, toDate) => {
  const start = new Date(`${fromDate}T00:00:00.000Z`)
  const end = new Date(`${toDate}T00:00:00.000Z`)
  if (start > end || (end.getTime() - start.getTime()) > 366 * 24 * 60 * 60 * 1000) {
    throw new ApiError(400, 'TRANSFER_DATE_RANGE_INVALID', 'Khoảng điều chuyển phải theo thứ tự và không vượt quá 366 ngày.')
  }
  const months = []
  let year = start.getUTCFullYear()
  let month = start.getUTCMonth() + 1
  const endKey = (end.getUTCFullYear() * 12) + end.getUTCMonth()
  while ((year * 12) + month - 1 <= endKey) {
    months.push(`${year}-${String(month).padStart(2, '0')}`)
    month += 1
    if (month > 12) {
      year += 1
      month = 1
    }
  }
  return months
}

const supportTransferCommand = async (db, actor, body, commandContext) => {
  if (!['admin', 'business_support'].includes(actor.role)) {
    throw new ApiError(403, 'ROLE_FORBIDDEN', 'Chỉ Admin hoặc Nhân viên hỗ trợ KD được quản lý điều chuyển nhân sự.')
  }
  const operation = body.type.split('.').at(-1)
  if (!['create', 'update', 'delete'].includes(operation)) {
    throw new ApiError(400, 'COMMAND_UNKNOWN', 'Lệnh điều chuyển hỗ trợ không được hỗ trợ.')
  }
  if (operation === 'delete' && actor.role !== 'admin') {
    throw new ApiError(403, 'ROLE_FORBIDDEN', 'Chỉ Admin được xóa lịch sử điều chuyển nhân sự.')
  }
  const payload = isPlainRecord(body.payload) ? body.payload : {}
  const { current, state } = await loadGlobalCommandState(db, body)
  const transfers = Array.isArray(state.supportTransfers) ? state.supportTransfers : []
  const transferId = operation === 'create'
    ? String(payload.id || `support_${crypto.randomUUID()}`).trim()
    : String(payload.transferId || payload.id || '').trim()
  if (!/^[A-Za-z0-9_-]{3,100}$/u.test(transferId)) {
    throw new ApiError(400, 'SUPPORT_TRANSFER_ID_INVALID', 'Mã điều chuyển không hợp lệ.')
  }
  if (operation === 'create' && transfers.some((record) => sameIdentifier(record.id, transferId))) {
    throw new ApiError(409, 'SUPPORT_TRANSFER_EXISTS', 'Mã điều chuyển đã tồn tại.')
  }
  const previousMatch = operation === 'create'
    ? null
    : uniqueIdentifierRecordMatch({
        records: transfers,
        identifier: transferId,
        collisionCode: 'SUPPORT_TRANSFER_IDENTIFIER_COLLISION',
        collisionMessage: 'Mã điều chuyển đang trùng với nhiều bản ghi; không thể cập nhật an toàn.',
      })
  const previous = previousMatch?.record || null
  if (operation !== 'create' && !previous) {
    throw new ApiError(404, 'SUPPORT_TRANSFER_NOT_FOUND', 'Không tìm thấy điều chuyển hỗ trợ.')
  }
  if (previous?.deletedAt || previous?.status === 'Đã xóa') {
    if (operation === 'delete') {
      return recordNoopCommand(db, actor, {
        command: body.type,
        version: Number(current.version),
        transfer: previous,
        existing: true,
      }, 200, commandContext)
    }
    throw new ApiError(409, 'SUPPORT_TRANSFER_DELETED', 'Điều chuyển hỗ trợ đã bị xóa.')
  }
  const canonicalTransferId = String(previous?.id || transferId).trim()
  if (previous && (Array.isArray(state.attendance) ? state.attendance : []).some((record) => (
    !record.deletedAt && sameIdentifier(record.supportTransferId, previous.id)
  ))) {
    throw new ApiError(
      409,
      'SUPPORT_TRANSFER_ATTENDANCE_IMMUTABLE',
      'Điều chuyển đã phát sinh chấm công; không thể sửa, hủy hoặc xóa.',
    )
  }
  const requestedEmployeeId = String(payload.employeeId ?? previous?.employeeId ?? '').trim()
  const employee = uniqueEmployeeIdentifierRecordMatch({
    records: [
      ...(Array.isArray(state.employees) ? state.employees : []),
      ...(operation === 'create' ? [] : (Array.isArray(state.deletedEmployees) ? state.deletedEmployees : [])),
    ],
    identifier: requestedEmployeeId,
    predicate: (record) => employeeUnit(record) === 'store',
  })?.record || null
  if (!employee
    || (operation === 'create' && (employee.deletedAt || ['Đã nghỉ việc', 'inactive'].includes(String(employee.status || ''))))) {
    throw new ApiError(400, 'EMPLOYEE_INVALID', 'Nhân viên hỗ trợ không hợp lệ.')
  }
  const employeeId = String(employee.id || employee.code || requestedEmployeeId).trim()
  const sourceStore = requireStore(state, previous?.fromStoreId || employee.storeId)
  const fromStoreId = String(sourceStore.id || previous?.fromStoreId || employee.storeId).trim()
  const requestedFromStoreId = String(payload.fromStoreId ?? fromStoreId).trim()
  if (!sameIdentifier(requestedFromStoreId, fromStoreId)) {
    throw new ApiError(400, 'TRANSFER_SOURCE_MISMATCH', 'Cửa hàng điều chuyển phải đúng với cửa hàng hiện tại của nhân viên.')
  }
  const requestedToStoreId = String(payload.toStoreId ?? previous?.toStoreId ?? '').trim()
  assertOperationalStoreAccess(actor, fromStoreId)
  assertOperationalStoreAccess(actor, requestedToStoreId)
  const destinationStore = requireStore(state, requestedToStoreId)
  const toStoreId = String(destinationStore.id || requestedToStoreId).trim()
  if (sameIdentifier(fromStoreId, toStoreId)) {
    throw new ApiError(400, 'SUPPORT_STORE_INVALID', 'Cửa hàng hỗ trợ phải khác cửa hàng hiện tại của nhân viên.')
  }
  const requestedLegacyStartDate = payload.fromDate ?? payload.startDate ?? payload.date
  const requestedLegacyEndDate = payload.toDate ?? payload.endDate ?? payload.date
  const legacyStartDate = requestedLegacyStartDate === undefined
    ? ''
    : optionalCalendarDate(requestedLegacyStartDate, 'Ngày bắt đầu')
  const legacyEndDate = requestedLegacyEndDate === undefined
    ? ''
    : optionalCalendarDate(requestedLegacyEndDate, 'Ngày kết thúc')
  const previousBounds = previous ? supportTransferTimeBounds(previous) : null
  const requestedStartAt = String(payload.startAt ?? '').trim()
  const requestedEndAt = String(payload.endAt ?? '').trim()
  const rawStartAt = payload.startAt !== undefined
    ? (/^\d{4}-\d{2}-\d{2}$/u.test(requestedStartAt) ? `${requestedStartAt}T00:00` : requestedStartAt)
    : legacyStartDate
      ? `${legacyStartDate}T00:00`
      : previousBounds?.startAt
  const legacyExclusiveEndDate = legacyEndDate ? shiftCalendarDate(legacyEndDate, 1) : ''
  const rawEndAt = payload.endAt !== undefined
    ? (/^\d{4}-\d{2}-\d{2}$/u.test(requestedEndAt)
        ? `${shiftCalendarDate(requestedEndAt, 1)}T00:00`
        : requestedEndAt)
    : legacyExclusiveEndDate
      ? `${legacyExclusiveEndDate}T00:00`
      : previousBounds?.endAt
  if (!rawStartAt || !rawEndAt) {
    throw new ApiError(400, 'TRANSFER_DATE_TIME_REQUIRED', 'Cần nhập đủ thời gian bắt đầu và kết thúc.')
  }
  const startAt = requiredTransferDateTime(rawStartAt, 'Thời gian bắt đầu')
  const endAt = requiredTransferDateTime(rawEndAt, 'Thời gian kết thúc')
  const timeBounds = supportTransferTimeBounds({ startAt, endAt })
  if (!timeBounds || timeBounds.endMs - timeBounds.startMs > 366 * 24 * 60 * 60 * 1_000) {
    throw new ApiError(400, 'TRANSFER_DATE_RANGE_INVALID', 'Khoảng điều chuyển phải theo thứ tự và không vượt quá 366 ngày.')
  }
  const { fromDate, toDate } = supportTransferCalendarRange(timeBounds)
  const months = monthsInDateRange(fromDate, toDate)
  const previousRange = supportTransferCalendarRange(previousBounds)
  const previousMonths = previousBounds ? monthsInDateRange(previousRange.fromDate, previousRange.toDate) : []
  const payrollTargets = [...new Map([
    ...[fromStoreId, toStoreId].flatMap((storeId) => months.map((period) => ({ storeId, period }))),
    ...(previous ? [previous.fromStoreId, previous.toStoreId]
      .flatMap((storeId) => previousMonths.map((period) => ({ storeId, period }))) : []),
  ].map((target) => [`${target.storeId}:${target.period}`, target])).values()]
  for (const target of payrollTargets) assertPayrollNotPaidOrLocked(state, target.storeId, target.period)

  if (operation === 'delete') {
    const reason = String(payload.reason || '').trim()
    if (!reason || reason.length > 500) {
      throw new ApiError(400, 'REASON_REQUIRED', 'Cần nhập lý do xóa từ 1 đến 500 ký tự.')
    }
    const deleted = {
      ...previous,
      status: 'Đã xóa',
      deletedAt: commandContext.now,
      deletedBy: serverActorSnapshot(actor),
      deleteReason: reason,
      updatedAt: commandContext.now,
    }
    const nextState = {
      ...state,
      supportTransfers: transfers.map((record, index) => index === previousMatch.index ? deleted : record),
      payrollPeriods: invalidateClosedPayrollPeriods(state, payrollTargets, commandContext.now, body.type),
      stateVersion: Math.max(1, Number(state.stateVersion) || 1) + 1,
    }
    return commitGlobalStateDomainCommand(db, actor, current, nextState, {
      action: body.type,
      entityType: 'support-transfer',
      entityId: canonicalTransferId,
      before: previous,
      after: deleted,
      metadata: { reason, payrollTargets },
      response: { command: body.type, transfer: deleted },
    }, commandContext)
  }

  const note = String(payload.note ?? previous?.note ?? '').trim()
  if (note.length > 1_000) throw new ApiError(400, 'NOTE_TOO_LONG', 'Ghi chú không được vượt quá 1.000 ký tự.')
  const rawHourlySupportRate = payload.hourlySupportRate ?? payload.hourlyRate
    ?? payload.supportHourlyRate ?? previous?.hourlySupportRate
  if (rawHourlySupportRate === undefined || rawHourlySupportRate === null || rawHourlySupportRate === '') {
    throw new ApiError(400, 'SUPPORT_HOURLY_RATE_REQUIRED', 'Cần nhập lương hỗ trợ theo giờ.')
  }
  const hourlySupportRate = asVnd(rawHourlySupportRate, 'Lương hỗ trợ theo giờ', { positive: true })
  const allowance = asVnd(payload.allowance ?? previous?.allowance ?? 0, 'Phụ cấp')
  const status = String(payload.status ?? previous?.status ?? 'Đã duyệt')
  if (!['Đã duyệt', 'Hoàn tất', 'Đã hủy'].includes(status)) {
    throw new ApiError(400, 'SUPPORT_TRANSFER_STATUS_INVALID', 'Trạng thái điều chuyển không hợp lệ.')
  }
  const overlap = transfers.find((record) => (
    !sameIdentifier(record.id, canonicalTransferId)
    && sameIdentifier(record.employeeId, employeeId)
    && supportTransferUsable(record)
    && (() => {
      const existingBounds = supportTransferTimeBounds(record)
      return existingBounds
        && existingBounds.startMs < timeBounds.endMs
        && existingBounds.endMs > timeBounds.startMs
    })()
  ))
  if (overlap) {
    throw new ApiError(409, 'SUPPORT_TRANSFER_OVERLAP', 'Nhân viên đã có lịch điều chuyển trùng thời gian.', { transferId: overlap.id })
  }
  const transfer = {
    ...(previous || {}),
    id: canonicalTransferId,
    employeeId,
    employeeName: employee.name || employeeId,
    fromStoreId,
    toStoreId,
    startAt,
    endAt,
    fromDate,
    toDate,
    hourlySupportRate,
    allowance,
    note,
    status,
    ...(operation === 'create'
      ? { createdAt: commandContext.now, createdBy: serverActorSnapshot(actor) }
      : { updatedAt: commandContext.now, updatedBy: serverActorSnapshot(actor) }),
  }
  const nextState = {
    ...state,
    supportTransfers: operation === 'create'
      ? [transfer, ...transfers]
      : transfers.map((record, index) => index === previousMatch.index ? transfer : record),
    payrollPeriods: invalidateClosedPayrollPeriods(state, payrollTargets, commandContext.now, body.type),
    stateVersion: Math.max(1, Number(state.stateVersion) || 1) + 1,
  }
  return commitGlobalStateDomainCommand(db, actor, current, nextState, {
    action: body.type,
    entityType: 'support-transfer',
    entityId: canonicalTransferId,
    before: previous,
    after: transfer,
    metadata: { payrollTargets },
    response: { command: body.type, transfer },
    status: operation === 'create' ? 201 : 200,
  }, commandContext)
}

const RESET_ARRAY_COLLECTIONS = Object.freeze([
  'stores',
  'employees',
  'imports',
  'attendance',
  'attendanceAudit',
  'schedule',
  'tasks',
  'taskAssignmentHistory',
  'officeAdjustments',
  'orders',
  'orderAudit',
  'orderInformationOptions',
  'notifications',
  'expenseEntries',
  'fixedExpenses',
  'cashTransactions',
  'salaryAdjustments',
  'salaryAdvances',
  'payrollPeriods',
  'payrollPayments',
  'shiftDefinitions',
  'importVouchers',
  'auditLogs',
  'deletedStores',
  'deletedEmployees',
  'supportTransfers',
  'operationalResetHistory',
  'supportWorkAssignments',
  'supportWorkSchedules',
  'supportWorkScheduleHistory',
  'policyHistory',
  ...COMPENSATION_STATE_COLLECTIONS,
])

const resetStateSummary = (state) => ({
  schemaVersion: Number(state.schemaVersion || 0),
  stateVersion: Number(state.stateVersion || 0),
  collections: Object.fromEntries(RESET_ARRAY_COLLECTIONS.map((key) => [key, Array.isArray(state[key]) ? state[key].length : 0])),
})

const normalizeDemoResetState = (value, currentState) => {
  if (!isPlainRecord(value)) {
    throw new ApiError(400, 'RESET_STATE_INVALID', 'Dữ liệu mẫu phải là một đối tượng JSON.')
  }
  const normalized = normalizeSharedStateForStorage(value)
  for (const required of ['stores', 'employees']) {
    if (!Array.isArray(normalized[required])) {
      throw new ApiError(400, 'RESET_STATE_INVALID', `Dữ liệu mẫu thiếu danh sách ${required}.`)
    }
  }
  for (const key of RESET_ARRAY_COLLECTIONS) {
    if (normalized[key] !== undefined && !Array.isArray(normalized[key])) {
      throw new ApiError(400, 'RESET_STATE_INVALID', `Bộ sưu tập ${key} phải là một mảng.`)
    }
    if (Array.isArray(normalized[key]) && normalized[key].some((record) => !isPlainRecord(record))) {
      throw new ApiError(400, 'RESET_STATE_INVALID', `Bộ sưu tập ${key} chỉ được chứa đối tượng.`)
    }
  }
  const uniqueIds = (records, field, label) => {
    const ids = records.map((record) => String(record[field] || '').trim())
    if (ids.some((id) => !id) || new Set(ids).size !== ids.length) {
      throw new ApiError(400, 'RESET_STATE_INVALID', `${label} phải có mã duy nhất và không được để trống.`)
    }
  }
  uniqueIds(normalized.stores, 'id', 'Cửa hàng')
  uniqueIds(normalized.employees, 'id', 'Nhân viên')
  const storeIds = new Set(normalized.stores.map((store) => String(store.id)))
  if (normalized.activeStoreId !== undefined && normalized.activeStoreId !== null
    && !storeIds.has(String(normalized.activeStoreId))) {
    throw new ApiError(400, 'RESET_STATE_INVALID', 'Cửa hàng đang chọn không tồn tại trong dữ liệu mẫu.')
  }
  const schemaVersion = Number(normalized.schemaVersion || 2)
  if (!Number.isInteger(schemaVersion) || schemaVersion < 1 || schemaVersion > 2) {
    throw new ApiError(400, 'RESET_STATE_INVALID', 'Phiên bản lược đồ dữ liệu mẫu không được hỗ trợ.')
  }
  normalized.orderInformationOptions = materializeDefaultOrderInformationOptions(normalized)
  configuredOrderPaymentMethods(normalized)
  return {
    ...normalized,
    schemaVersion,
    accountSettings: isPlainRecord(currentState.accountSettings) ? currentState.accountSettings : {},
  }
}

const systemResetDemoCommand = async (db, actor, body, commandContext, env) => {
  assertAdmin(actor, 'Chỉ Admin được Reset dữ liệu mẫu.')
  if (body.type !== 'system.reset_demo') {
    throw new ApiError(400, 'COMMAND_UNKNOWN', 'Lệnh hệ thống không được hỗ trợ.')
  }
  const payload = isPlainRecord(body.payload) ? body.payload : {}
  const { current, state: storedState } = await loadGlobalCommandState(db, body)
  const avatarMutation = hasLegacyAccountAvatarData(storedState)
    ? await beginAccountAvatarMutationCleanup(db, actor.user_id, commandContext.requestId, commandContext.now)
    : null
  let legacyMigration
  try {
    legacyMigration = await prepareLegacyAccountAvatarMigration(
      env,
      db,
      storedState,
      commandContext.now,
      actor.user_id,
      avatarMutation ? accountAvatarMutationLifecycle(db, env?.IDENTITY_IMAGES, avatarMutation) : {},
    )
  } catch (error) {
    if (avatarMutation) {
      await cleanupAccountAvatarMutation(db, env?.IDENTITY_IMAGES, avatarMutation.metaKey, commandContext, {
        suppressFailure: true,
      })
    }
    throw error
  }
  let committed = false
  try {
  const state = normalizeSharedStateForStorage(legacyMigration.state)
  const resetState = normalizeDemoResetState(payload.state, state)
  const adminSettings = isPlainRecord(resetState.accountSettings?.[actor.user_id])
    ? { [actor.user_id]: resetState.accountSettings[actor.user_id] }
    : {}
  const nextState = {
    ...resetState,
    accountSettings: adminSettings,
    stateVersion: Math.max(1, Number(state.stateVersion) || 1) + 1,
  }
  const projectedState = projectSharedState(nextState, actor)
  const nextStateVersion = Number(current.version) + 1
  const preservedKeys = [...accountAvatarKeysFromState({ accountSettings: adminSettings })]
  let cleanupKeys
  try {
    cleanupKeys = await listAccountAvatarKeysForReset(env?.IDENTITY_IMAGES, state, preservedKeys)
  } catch (error) {
    if (avatarMutation) {
      await cleanupAccountAvatarMutation(db, env?.IDENTITY_IMAGES, avatarMutation.metaKey, commandContext, {
        suppressFailure: true,
      })
    }
    throw error
  }
  const cleanupMarker = JSON.stringify({
    schema: 1,
    reason: body.type,
    keys: cleanupKeys,
    preservedKeys,
    createdAt: commandContext.now,
  })
  const committedAvatarMutation = avatarMutation
    ? commitAccountAvatarMutationCleanup(avatarMutation, [], preservedKeys, commandContext.now)
    : null
  let response
  try {
    response = await commitGlobalStateDomainCommand(db, actor, current, nextState, {
      action: body.type,
      entityType: 'system',
      entityId: 'demo-state',
      before: resetStateSummary(state),
      after: resetStateSummary(nextState),
      metadata: {
        nonAdminAccountsPurged: true,
        nonAdminSessionsPurged: true,
        preservedAdminAccountSettings: true,
        accountAvatarObjectsTargeted: cleanupKeys.length,
        ...(legacyMigration.changed
          ? { legacyAvatarMigration: legacyAvatarMigrationAudit(legacyMigration) }
          : {}),
      },
      response: { command: body.type, state: projectedState, nonAdminAccountsPurged: true },
      ...(avatarMutation ? {
        stateGuard: {
          sql: 'SELECT 1 FROM system_metadata WHERE meta_key = ? AND value_json = ?',
          bindings: [avatarMutation.metaKey, avatarMutation.valueJson],
        },
      } : {}),
      additionalStatements: [
        db.prepare(`
          DELETE FROM users
          WHERE role <> 'admin'
            AND EXISTS (
              SELECT 1 FROM app_state
              WHERE scope_key = 'global' AND version = ? AND last_request_id = ?
            )
        `).bind(nextStateVersion, commandContext.requestId),
        ...(avatarMutation ? [db.prepare(`
          UPDATE system_metadata
          SET value_json = ?, version = version + 1, updated_at = ?
          WHERE meta_key = ? AND value_json = ?
            AND EXISTS (${stateSuccessSql})
        `).bind(
          committedAvatarMutation.valueJson,
          commandContext.now,
          avatarMutation.metaKey,
          avatarMutation.valueJson,
          'global',
          nextStateVersion,
          commandContext.requestId,
        )] : []),
        db.prepare(`
          INSERT INTO system_metadata (meta_key, value_json, version, updated_at)
          SELECT ?, ?, 1, ?
          WHERE EXISTS (${stateSuccessSql})
          ON CONFLICT(meta_key) DO UPDATE SET
            value_json = excluded.value_json,
            version = system_metadata.version + 1,
            updated_at = excluded.updated_at
        `).bind(
          ACCOUNT_AVATAR_PENDING_CLEANUP_KEY,
          cleanupMarker,
          commandContext.now,
          'global',
          nextStateVersion,
          commandContext.requestId,
        ),
      ],
    }, commandContext)
  } catch (error) {
    if (avatarMutation) {
      await cleanupAccountAvatarMutation(db, env?.IDENTITY_IMAGES, avatarMutation.metaKey, commandContext, {
        suppressFailure: true,
      })
    }
    throw error
  }
  committed = true
  if (avatarMutation) {
    await cleanupAccountAvatarMutation(db, env?.IDENTITY_IMAGES, avatarMutation.metaKey, commandContext, {
      suppressFailure: true,
    })
  }
  if (legacyMigration.changed) {
    try {
      await scrubLegacyAvatarArtifacts(db, legacyMigration.replacements)
      await markAccountAvatarMigrationComplete(db, commandContext.now)
    } catch (error) {
      console.warn('Unable to finish legacy account-avatar artifact cleanup after a committed demo reset', { error: String(error) })
    }
  }
  try {
    await resumePendingAccountAvatarCleanup(db, env, commandContext)
  } catch (error) {
    const apiError = error instanceof ApiError
      ? error
      : new ApiError(503, 'RESET_CLEANUP_PENDING', 'Dữ liệu đã được Reset nhưng kho ảnh đại diện chưa xóa xong.')
    return jsonResponse({
      ok: false,
      error: { code: apiError.code, message: apiError.message, ...(apiError.details ? { details: apiError.details } : {}) },
      serverTime: commandContext.now,
      requestId: commandContext.requestId,
    }, apiError.status)
  }
  return response
  } catch (error) {
    if (!committed) {
      if (avatarMutation) {
        await cleanupAccountAvatarMutation(db, env?.IDENTITY_IMAGES, avatarMutation.metaKey, commandContext, {
          suppressFailure: true,
        })
      }
    }
    throw error
  }
}

const RESET_ALL_PENDING_METADATA_KEY = 'system:reset_all_pending'
const IDENTITY_IMAGE_KEY_PREFIX = 'identity-images/'

const accountAvatarKeysFromState = (state) => {
  const keys = new Set()
  for (const settings of Object.values(isPlainRecord(state?.accountSettings) ? state.accountSettings : {})) {
    const key = String(settings?.avatar?.key || '')
    if (key.startsWith(ACCOUNT_AVATAR_KEY_PREFIX)) keys.add(key)
  }
  for (const collection of ['employees', 'deletedEmployees']) {
    for (const profile of Array.isArray(state?.[collection]) ? state[collection] : []) {
      for (const value of [profile?.avatar, profile?.avatarImage]) {
        const key = String(value?.key || '')
        if (key.startsWith(ACCOUNT_AVATAR_KEY_PREFIX)) keys.add(key)
      }
    }
  }
  return keys
}

const listAccountAvatarKeysForReset = async (bucket, state = null, preservedKeys = []) => {
  if (!bucket?.list || !bucket?.delete) {
    throw new ApiError(503, 'ACCOUNT_AVATAR_STORAGE_UNAVAILABLE', 'Reset dữ liệu cần kho ảnh đại diện có quyền liệt kê và xóa.')
  }
  const preserved = new Set((preservedKeys || []).filter((key) => String(key).startsWith(ACCOUNT_AVATAR_KEY_PREFIX)))
  const keys = accountAvatarKeysFromState(state)
  let cursor
  const seenCursors = new Set()
  try {
    for (let pageIndex = 0; pageIndex < 10_000; pageIndex += 1) {
      const page = await bucket.list({ prefix: ACCOUNT_AVATAR_KEY_PREFIX, ...(cursor ? { cursor } : {}) })
      for (const object of Array.isArray(page?.objects) ? page.objects : []) {
        const key = String(object?.key || '')
        if (key.startsWith(ACCOUNT_AVATAR_KEY_PREFIX)) keys.add(key)
      }
      if (!page?.truncated) return [...keys].filter((key) => !preserved.has(key)).sort()
      const nextCursor = String(page.cursor || '')
      if (!nextCursor || seenCursors.has(nextCursor)) throw new Error('R2 pagination cursor is missing or repeated')
      seenCursors.add(nextCursor)
      cursor = nextCursor
    }
    throw new Error('R2 pagination exceeded the safety limit')
  } catch (error) {
    throw new ApiError(503, 'ACCOUNT_AVATAR_LIST_FAILED', 'Không thể kiểm kê đầy đủ kho ảnh đại diện trước khi Reset dữ liệu.', {
      cause: String(error),
    })
  }
}

const purgeAndVerifyAccountAvatars = async (bucket, preservedKeys = [], initialKeys = null) => {
  const preserved = new Set(normalizedAccountAvatarCleanupKeys(preservedKeys))
  const targets = Array.isArray(initialKeys)
    ? new Set(normalizedAccountAvatarCleanupKeys(initialKeys).filter((key) => !preserved.has(key)))
    : null
  const remainingKeys = async () => {
    const listed = await listAccountAvatarKeysForReset(bucket, null, preservedKeys)
    return targets ? listed.filter((key) => targets.has(key)) : listed
  }
  let keys = targets ? [...targets].sort() : await remainingKeys()
  try {
    for (let pass = 0; pass < 3; pass += 1) {
      for (const key of keys) await bucket.delete(key)
      keys = await remainingKeys()
      if (!keys.length) return
    }
  } catch (error) {
    throw new ApiError(503, 'RESET_CLEANUP_PENDING', 'Dữ liệu đã được Reset nhưng kho ảnh đại diện chưa xóa xong; hãy gửi lại đúng lệnh để tiếp tục.', {
      cause: String(error),
    })
  }
  throw new ApiError(503, 'RESET_CLEANUP_PENDING', 'Dữ liệu đã được Reset nhưng vẫn còn ảnh đại diện; hãy gửi lại đúng lệnh để tiếp tục.', {
    remainingAccountAvatarObjects: keys.length,
  })
}

const loadPendingAccountAvatarCleanup = (db) => first(db, `
  SELECT value_json FROM system_metadata WHERE meta_key = ? LIMIT 1
`, ACCOUNT_AVATAR_PENDING_CLEANUP_KEY)

const normalizedAccountAvatarCleanupKeys = (values) => [...new Set((Array.isArray(values) ? values : [])
  .map((value) => String(value || ''))
  .filter((key) => key.startsWith(ACCOUNT_AVATAR_KEY_PREFIX)))]
  .sort()

const parseAccountAvatarMutationCleanupMarker = (value) => {
  const marker = typeof value === 'string' ? parseStoredJson(value, null) : value
  if (!isPlainRecord(marker) || !Array.isArray(marker.keys) || !Array.isArray(marker.preservedKeys)) {
    throw new ApiError(500, 'ACCOUNT_AVATAR_CLEANUP_MARKER_INVALID', 'Trạng thái dọn ảnh đại diện đang cập nhật không hợp lệ.')
  }
  return {
    ...marker,
    schema: 1,
    phase: ['committed', 'cancelled', 'acknowledged'].includes(marker.phase) ? marker.phase : 'prepared',
    status: marker.status === 'cleaning' ? 'cleaning' : 'pending',
    keys: normalizedAccountAvatarCleanupKeys(marker.keys),
    pendingKeys: normalizedAccountAvatarCleanupKeys(marker.pendingKeys),
    preservedKeys: normalizedAccountAvatarCleanupKeys(marker.preservedKeys),
    ownerRequestId: String(marker.ownerRequestId || ''),
  }
}

const beginAccountAvatarMutationCleanup = async (db, userId, requestId, timestamp) => {
  const metaKey = `${ACCOUNT_AVATAR_MUTATION_CLEANUP_PREFIX}${crypto.randomUUID()}`
  const marker = {
    schema: 1,
    phase: 'prepared',
    status: 'pending',
    userId: String(userId || ''),
    requestId: String(requestId || ''),
    ownerRequestId: String(requestId || ''),
    keys: [],
    pendingKeys: [],
    preservedKeys: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  }
  const valueJson = JSON.stringify(marker)
  const inserted = await run(db, `
    INSERT INTO system_metadata (meta_key, value_json, version, updated_at)
    SELECT ?, ?, 1, ?
    WHERE NOT EXISTS (
      SELECT 1 FROM system_metadata
      WHERE meta_key LIKE ?
        AND json_extract(value_json, '$.userId') = ?
        AND COALESCE(json_extract(value_json, '$.phase'), 'prepared') <> 'cancelled'
    )
      AND (
        SELECT COUNT(*) FROM system_metadata
        WHERE meta_key LIKE ? AND json_extract(value_json, '$.userId') = ?
      ) < ?
  `,
  metaKey, valueJson, timestamp,
  `${ACCOUNT_AVATAR_MUTATION_CLEANUP_PREFIX}%`, marker.userId,
  `${ACCOUNT_AVATAR_MUTATION_CLEANUP_PREFIX}%`, marker.userId, MAX_ACCOUNT_AVATAR_MUTATION_MARKERS_PER_USER)
  if (changes(inserted) !== 1) {
    throw new ApiError(503, 'ACCOUNT_AVATAR_CLEANUP_QUEUE_FAILED', 'Không thể chuẩn bị cập nhật ảnh đại diện; vui lòng thử lại.')
  }
  return { metaKey, marker, valueJson }
}

const reserveAccountAvatarMutationObject = async (db, mutation, key, timestamp) => {
  const marker = {
    ...mutation.marker,
    keys: normalizedAccountAvatarCleanupKeys([...mutation.marker.keys, key]),
    pendingKeys: normalizedAccountAvatarCleanupKeys([...mutation.marker.pendingKeys, key]),
    updatedAt: timestamp,
  }
  const valueJson = JSON.stringify(marker)
  const updated = await run(db, `
    UPDATE system_metadata
    SET value_json = ?, version = version + 1, updated_at = ?
    WHERE meta_key = ? AND value_json = ?
  `, valueJson, timestamp, mutation.metaKey, mutation.valueJson)
  if (changes(updated) !== 1) {
    throw new ApiError(503, 'ACCOUNT_AVATAR_CLEANUP_QUEUE_FAILED', 'Không thể ghi nhận ảnh đại diện mới trước khi lưu; vui lòng thử lại.')
  }
  mutation.marker = marker
  mutation.valueJson = valueJson
}

const confirmAccountAvatarMutationObject = async (db, bucket, mutation, key, timestamp) => {
  const marker = {
    ...mutation.marker,
    pendingKeys: mutation.marker.pendingKeys.filter((pendingKey) => pendingKey !== key),
    updatedAt: timestamp,
  }
  const valueJson = JSON.stringify(marker)
  let updated
  let updateError
  try {
    updated = await run(db, `
      UPDATE system_metadata
      SET value_json = ?, version = version + 1, updated_at = ?
      WHERE meta_key = ? AND value_json = ?
    `, valueJson, timestamp, mutation.metaKey, mutation.valueJson)
  } catch (error) {
    updateError = error
  }
  if (!updateError && changes(updated) === 1) {
    mutation.marker = marker
    mutation.valueJson = valueJson
    return
  }

  await acknowledgeCancelledAccountAvatarMutation(db, bucket, mutation, key, timestamp)
  throw new ApiError(503, 'ACCOUNT_AVATAR_UPLOAD_CANCELLED', 'Lượt tải ảnh đại diện đã bị hủy an toàn; vui lòng thử lại.', {
    ...(updateError ? { cause: String(updateError) } : {}),
  })
}

const accountAvatarMutationLifecycle = (db, bucket, mutation) => ({
  beforePut: (key) => reserveAccountAvatarMutationObject(db, mutation, key, new Date().toISOString()),
  afterPut: (key) => confirmAccountAvatarMutationObject(db, bucket, mutation, key, new Date().toISOString()),
})

const commitAccountAvatarMutationCleanup = (mutation, cleanupKeys, preservedKeys, timestamp) => {
  if (mutation.marker.pendingKeys.length) {
    throw new ApiError(503, 'ACCOUNT_AVATAR_UPLOAD_PENDING', 'Ảnh đại diện chưa hoàn tất lưu trữ; vui lòng thử lại.')
  }
  const marker = {
    ...mutation.marker,
    phase: 'committed',
    status: 'pending',
    ownerRequestId: '',
    keys: normalizedAccountAvatarCleanupKeys([...mutation.marker.keys, ...cleanupKeys]),
    pendingKeys: [],
    preservedKeys: normalizedAccountAvatarCleanupKeys(preservedKeys),
    updatedAt: timestamp,
  }
  return { marker, valueJson: JSON.stringify(marker) }
}

const loadAccountAvatarMutationCleanup = (db, metaKey = '') => metaKey
  ? first(db, `
      SELECT meta_key, value_json FROM system_metadata WHERE meta_key = ? LIMIT 1
    `, metaKey)
  : first(db, `
      SELECT meta_key, value_json FROM system_metadata
      WHERE meta_key LIKE ?
        AND COALESCE(json_extract(value_json, '$.phase'), 'prepared') <> 'cancelled'
      ORDER BY updated_at, meta_key
      LIMIT 1
    `, `${ACCOUNT_AVATAR_MUTATION_CLEANUP_PREFIX}%`)

const loadCancelledAccountAvatarMutationCleanup = (db) => first(db, `
  SELECT meta_key, value_json FROM system_metadata
  WHERE meta_key LIKE ? AND json_extract(value_json, '$.phase') = 'cancelled'
  ORDER BY updated_at, meta_key
  LIMIT 1
`, `${ACCOUNT_AVATAR_MUTATION_CLEANUP_PREFIX}%`)

const cleanupAccountAvatarMutation = async (db, bucket, metaKey, context = {}, {
  suppressFailure = false,
} = {}) => {
  const row = await loadAccountAvatarMutationCleanup(db, metaKey)
  if (!row) return false
  const markerJson = String(row.value_json || '')
  const marker = parseAccountAvatarMutationCleanupMarker(markerJson)
  const now = String(context.now || new Date().toISOString())
  const ownerRequestId = String(context.requestId || `account-avatar-mutation-cleanup-${crypto.randomUUID()}`)
  const claimedMarker = {
    ...marker,
    status: 'cleaning',
    ownerRequestId,
    updatedAt: now,
  }
  const claimedJson = JSON.stringify(claimedMarker)
  const claimed = await run(db, `
    UPDATE system_metadata
    SET value_json = ?, version = version + 1, updated_at = ?
    WHERE meta_key = ? AND value_json = ?
  `, claimedJson, now, row.meta_key, markerJson)
  if (changes(claimed) !== 1) {
    if (suppressFailure) return false
    throw new ApiError(503, 'ACCOUNT_AVATAR_CLEANUP_PENDING', 'Một request khác đã nhận quyền dọn ảnh đại diện; vui lòng thử lại sau.')
  }

  let failedKeys
  try {
    const current = await loadState(db, 'global')
    const state = parseStoredJson(current?.value_json, {})
    const preservedKeys = new Set([
      ...claimedMarker.preservedKeys,
      ...accountAvatarKeysFromState(isPlainRecord(state) ? state : {}),
    ])
    const targets = claimedMarker.keys.filter((key) => !preservedKeys.has(key))
    failedKeys = await deleteAccountAvatarObjects(bucket, targets)
  } catch (error) {
    const pendingMarker = {
      ...claimedMarker,
      status: 'pending',
      ownerRequestId: '',
      updatedAt: now,
    }
    await run(db, `
      UPDATE system_metadata
      SET value_json = ?, version = version + 1, updated_at = ?
      WHERE meta_key = ? AND value_json = ?
    `, JSON.stringify(pendingMarker), now, row.meta_key, claimedJson).catch(() => {})
    if (suppressFailure) {
      console.warn('Unable to finish durable account-avatar mutation cleanup', { metaKey: row.meta_key, error: String(error) })
      return false
    }
    throw error
  }

  const requiresTombstone = claimedMarker.phase === 'cancelled' || claimedMarker.pendingKeys.length > 0
  if (failedKeys.length) {
    const pendingMarker = {
      ...claimedMarker,
      phase: requiresTombstone ? 'cancelled' : claimedMarker.phase,
      status: 'pending',
      ownerRequestId: '',
      keys: requiresTombstone ? claimedMarker.keys : failedKeys,
      updatedAt: now,
    }
    await run(db, `
      UPDATE system_metadata
      SET value_json = ?, version = version + 1, updated_at = ?
      WHERE meta_key = ? AND value_json = ?
    `, JSON.stringify(pendingMarker), now, row.meta_key, claimedJson)
    if (suppressFailure) return false
    throw new ApiError(503, 'ACCOUNT_AVATAR_CLEANUP_PENDING', 'Ảnh đại diện cũ chưa dọn xong; vui lòng thử lại sau.')
  }

  if (requiresTombstone) {
    const cancelledMarker = {
      ...claimedMarker,
      phase: 'cancelled',
      status: 'pending',
      ownerRequestId: '',
      updatedAt: now,
    }
    const cancelled = await run(db, `
      UPDATE system_metadata
      SET value_json = ?, version = version + 1, updated_at = ?
      WHERE meta_key = ? AND value_json = ?
    `, JSON.stringify(cancelledMarker), now, row.meta_key, claimedJson)
    if (changes(cancelled) !== 1) {
      if (suppressFailure) return false
      throw new ApiError(503, 'ACCOUNT_AVATAR_CLEANUP_PENDING', 'Marker hủy tải ảnh đã thay đổi; vui lòng thử lại sau.')
    }
    return marker.phase !== 'cancelled'
  }

  const completed = await run(db, `
    DELETE FROM system_metadata WHERE meta_key = ? AND value_json = ?
  `, row.meta_key, claimedJson)
  if (changes(completed) !== 1) {
    if (suppressFailure) return false
    throw new ApiError(503, 'ACCOUNT_AVATAR_CLEANUP_PENDING', 'Kho ảnh đã được dọn nhưng marker đã thay đổi; vui lòng thử lại sau.')
  }
  return true
}

const acknowledgeCancelledAccountAvatarMutation = async (db, bucket, mutation, key, timestamp) => {
  const fallbackKeys = normalizedAccountAvatarCleanupKeys([...mutation.marker.keys, key])
  try {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const row = await loadAccountAvatarMutationCleanup(db, mutation.metaKey)
      if (!row) break
      const markerJson = String(row.value_json || '')
      const marker = parseAccountAvatarMutationCleanupMarker(markerJson)
      const sameMutation = marker.requestId === mutation.marker.requestId
        && marker.userId === mutation.marker.userId
      if (!sameMutation || marker.phase === 'committed') break

      let acknowledgedJson = markerJson
      if (marker.phase !== 'acknowledged') {
        const acknowledgedMarker = {
          ...marker,
          phase: 'acknowledged',
          status: 'pending',
          ownerRequestId: '',
          pendingKeys: [],
          updatedAt: timestamp,
        }
        acknowledgedJson = JSON.stringify(acknowledgedMarker)
        const acknowledged = await run(db, `
          UPDATE system_metadata
          SET value_json = ?, version = version + 1, updated_at = ?
          WHERE meta_key = ? AND value_json = ?
        `, acknowledgedJson, timestamp, mutation.metaKey, markerJson)
        if (changes(acknowledged) !== 1) continue
      }

      mutation.valueJson = acknowledgedJson
      await cleanupAccountAvatarMutation(db, bucket, mutation.metaKey, {
        now: timestamp,
        requestId: `${mutation.marker.requestId}:acknowledge`,
      }, { suppressFailure: true })
      return
    }
  } catch (error) {
    console.warn('Unable to acknowledge cancelled account-avatar upload', {
      metaKey: mutation.metaKey,
      error: String(error),
    })
  }

  const failedKeys = await deleteAccountAvatarObjects(bucket, fallbackKeys)
  if (failedKeys.length) {
    await enqueuePendingAccountAvatarCleanup(db, failedKeys, {
      reason: 'account-avatar-upload-ownership-lost', timestamp,
    })
  }
}

const resumePendingAccountAvatarMutationCleanup = async (db, env, context = {}) => {
  const cancelled = await loadCancelledAccountAvatarMutationCleanup(db)
  if (cancelled) {
    await cleanupAccountAvatarMutation(db, env?.IDENTITY_IMAGES, cancelled.meta_key, context, { suppressFailure: true })
  }
  const row = await loadAccountAvatarMutationCleanup(db)
  if (!row) return false
  return cleanupAccountAvatarMutation(db, env?.IDENTITY_IMAGES, row.meta_key, context)
}

const parseAccountAvatarCleanupMarker = (value) => {
  const marker = typeof value === 'string' ? parseStoredJson(value, null) : value
  if (!isPlainRecord(marker) || !Array.isArray(marker.keys) || !Array.isArray(marker.preservedKeys)) {
    throw new ApiError(500, 'ACCOUNT_AVATAR_CLEANUP_MARKER_INVALID', 'Trạng thái tiếp tục xóa ảnh đại diện không hợp lệ.')
  }
  return {
    ...marker,
    schema: 2,
    keys: normalizedAccountAvatarCleanupKeys(marker.keys),
    preservedKeys: normalizedAccountAvatarCleanupKeys(marker.preservedKeys),
    status: marker.status === 'cleaning' ? 'cleaning' : 'pending',
    ownerRequestId: String(marker.ownerRequestId || ''),
    leaseExpiresAt: String(marker.leaseExpiresAt || ''),
    reasons: [...new Set((Array.isArray(marker.reasons) ? marker.reasons : [marker.reason])
      .map((reason) => String(reason || '').slice(0, 120))
      .filter(Boolean))].slice(-20),
  }
}

const enqueuePendingAccountAvatarCleanup = async (db, keys, {
  preservedKeys = [],
  reason = 'account-avatar-delete-failed',
  timestamp = new Date().toISOString(),
} = {}) => {
  const requestedKeys = normalizedAccountAvatarCleanupKeys(keys)
  if (!requestedKeys.length) return false
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const row = await loadPendingAccountAvatarCleanup(db)
    if (!row) {
      const marker = {
        schema: 2,
        status: 'pending',
        ownerRequestId: '',
        leaseExpiresAt: '',
        keys: requestedKeys,
        preservedKeys: normalizedAccountAvatarCleanupKeys(preservedKeys),
        reasons: [String(reason).slice(0, 120)],
        createdAt: timestamp,
        updatedAt: timestamp,
      }
      const inserted = await run(db, `
        INSERT OR IGNORE INTO system_metadata (meta_key, value_json, version, updated_at)
        VALUES (?, ?, 1, ?)
      `, ACCOUNT_AVATAR_PENDING_CLEANUP_KEY, JSON.stringify(marker), timestamp)
      if (changes(inserted) === 1) return true
      continue
    }
    const markerJson = String(row.value_json || '')
    const marker = parseAccountAvatarCleanupMarker(markerJson)
    const nextMarker = {
      ...marker,
      status: 'pending',
      ownerRequestId: '',
      leaseExpiresAt: '',
      keys: normalizedAccountAvatarCleanupKeys([...marker.keys, ...requestedKeys]),
      preservedKeys: normalizedAccountAvatarCleanupKeys([...marker.preservedKeys, ...preservedKeys]),
      reasons: [...new Set([...marker.reasons, String(reason).slice(0, 120)].filter(Boolean))].slice(-20),
      updatedAt: timestamp,
    }
    const updated = await run(db, `
      UPDATE system_metadata
      SET value_json = ?, version = version + 1, updated_at = ?
      WHERE meta_key = ? AND value_json = ?
    `, JSON.stringify(nextMarker), timestamp, ACCOUNT_AVATAR_PENDING_CLEANUP_KEY, markerJson)
    if (changes(updated) === 1) return true
  }
  throw new ApiError(503, 'ACCOUNT_AVATAR_CLEANUP_QUEUE_FAILED', 'Không thể ghi nhận ảnh đại diện cần dọn; vui lòng thử lại.')
}

const resumePendingAccountAvatarCleanup = async (db, env, context = {}) => {
  const row = await loadPendingAccountAvatarCleanup(db)
  if (!row) return false
  const markerJson = String(row.value_json || '')
  const marker = parseAccountAvatarCleanupMarker(markerJson)
  const now = String(context.now || new Date().toISOString())
  const ownerRequestId = String(context.requestId || `account-avatar-cleanup-${crypto.randomUUID()}`)
  const nowMs = Date.parse(now)
  const leaseExpiresAtMs = Date.parse(marker.leaseExpiresAt)
  if (marker.status === 'cleaning'
    && marker.ownerRequestId !== ownerRequestId
    && Number.isFinite(leaseExpiresAtMs)
    && leaseExpiresAtMs > nowMs) {
    throw new ApiError(503, 'ACCOUNT_AVATAR_CLEANUP_PENDING', 'Một request khác đang dọn ảnh đại diện; vui lòng thử lại sau.')
  }
  const claimedMarker = {
    ...marker,
    status: 'cleaning',
    ownerRequestId,
    leaseExpiresAt: new Date((Number.isFinite(nowMs) ? nowMs : Date.now()) + 60_000).toISOString(),
    updatedAt: now,
  }
  const claimedJson = JSON.stringify(claimedMarker)
  const claimed = await run(db, `
    UPDATE system_metadata
    SET value_json = ?, version = version + 1, updated_at = ?
    WHERE meta_key = ? AND value_json = ?
  `, claimedJson, now, ACCOUNT_AVATAR_PENDING_CLEANUP_KEY, markerJson)
  if (changes(claimed) !== 1) {
    throw new ApiError(503, 'ACCOUNT_AVATAR_CLEANUP_PENDING', 'Một request khác đã nhận quyền dọn ảnh đại diện; vui lòng thử lại sau.')
  }
  try {
    await purgeAndVerifyAccountAvatars(env?.IDENTITY_IMAGES, claimedMarker.preservedKeys, claimedMarker.keys)
  } catch (error) {
    const pendingMarker = {
      ...claimedMarker,
      status: 'pending',
      ownerRequestId: '',
      leaseExpiresAt: '',
      updatedAt: now,
    }
    await run(db, `
      UPDATE system_metadata
      SET value_json = ?, version = version + 1, updated_at = ?
      WHERE meta_key = ? AND value_json = ?
    `, JSON.stringify(pendingMarker), now, ACCOUNT_AVATAR_PENDING_CLEANUP_KEY, claimedJson)
    throw error
  }
  const completed = await run(db, `
    DELETE FROM system_metadata WHERE meta_key = ? AND value_json = ?
  `, ACCOUNT_AVATAR_PENDING_CLEANUP_KEY, claimedJson)
  if (changes(completed) !== 1) {
    throw new ApiError(503, 'ACCOUNT_AVATAR_CLEANUP_PENDING', 'Kho ảnh đã được dọn nhưng hàng đợi có mục mới; vui lòng thử lại.')
  }
  return true
}

const identityImageKeysFromState = (state) => {
  const keys = new Set()
  for (const collection of ['employees', 'deletedEmployees']) {
    for (const profile of Array.isArray(state?.[collection]) ? state[collection] : []) {
      if (!isPlainRecord(profile?.identityImages)) continue
      for (const metadata of Object.values(profile.identityImages)) {
        const key = String(metadata?.key || '')
        if (key.startsWith(IDENTITY_IMAGE_KEY_PREFIX)) keys.add(key)
      }
    }
  }
  return keys
}

const listIdentityImageKeysForReset = async (bucket, state = null) => {
  if (!bucket?.list || !bucket?.delete) {
    throw new ApiError(503, 'IDENTITY_IMAGE_STORAGE_UNAVAILABLE', 'Reset toàn bộ dữ liệu cần kho ảnh CCCD có quyền liệt kê và xóa.')
  }
  const keys = identityImageKeysFromState(state)
  let cursor
  const seenCursors = new Set()
  try {
    for (let pageIndex = 0; pageIndex < 10_000; pageIndex += 1) {
      const page = await bucket.list({ prefix: IDENTITY_IMAGE_KEY_PREFIX, ...(cursor ? { cursor } : {}) })
      for (const object of Array.isArray(page?.objects) ? page.objects : []) {
        const key = String(object?.key || '')
        if (key.startsWith(IDENTITY_IMAGE_KEY_PREFIX)) keys.add(key)
      }
      if (!page?.truncated) return [...keys].sort()
      const nextCursor = String(page.cursor || '')
      if (!nextCursor || seenCursors.has(nextCursor)) {
        throw new Error('R2 pagination cursor is missing or repeated')
      }
      seenCursors.add(nextCursor)
      cursor = nextCursor
    }
    throw new Error('R2 pagination exceeded the safety limit')
  } catch (error) {
    throw new ApiError(503, 'IDENTITY_IMAGE_LIST_FAILED', 'Không thể kiểm kê đầy đủ kho ảnh CCCD trước khi Reset toàn bộ dữ liệu.', {
      cause: String(error),
    })
  }
}

const purgeAndVerifyIdentityImages = async (bucket, initialKeys = null) => {
  let keys = Array.isArray(initialKeys) ? [...new Set(initialKeys)].sort() : await listIdentityImageKeysForReset(bucket)
  try {
    for (let pass = 0; pass < 3; pass += 1) {
      for (const key of keys) await bucket.delete(key)
      keys = await listIdentityImageKeysForReset(bucket)
      if (!keys.length) return
    }
  } catch (error) {
    if (error instanceof ApiError && error.code === 'RESET_CLEANUP_PENDING') throw error
    throw new ApiError(503, 'RESET_CLEANUP_PENDING', 'Dữ liệu D1 đã được Reset nhưng kho ảnh CCCD chưa xóa xong; hãy gửi lại đúng lệnh để tiếp tục.', {
      cause: String(error),
    })
  }
  throw new ApiError(503, 'RESET_CLEANUP_PENDING', 'Dữ liệu D1 đã được Reset nhưng vẫn còn ảnh CCCD; hãy gửi lại đúng lệnh để tiếp tục.', {
    remainingIdentityImageObjects: keys.length,
  })
}

const loadPendingSystemResetAll = (db) => first(db, `
  SELECT value_json FROM system_metadata WHERE meta_key = ? LIMIT 1
`, RESET_ALL_PENDING_METADATA_KEY)

const finalizeSystemResetAll = async (db, pendingRow) => {
  const markerJson = String(pendingRow?.value_json || '')
  const marker = parseStoredJson(markerJson, null)
  if (!isPlainRecord(marker) || !isPlainRecord(marker.responseBody) || !isPlainRecord(marker.audit)) {
    throw new ApiError(500, 'RESET_MARKER_INVALID', 'Trạng thái tiếp tục Reset toàn bộ dữ liệu không hợp lệ.')
  }
  const markerGuardSql = `
    SELECT 1 FROM system_metadata WHERE meta_key = ? AND value_json = ?
  `
  const responseJson = JSON.stringify(marker.responseBody)
  try {
    await db.batch([
      db.prepare(`
        INSERT INTO audit_log (
          request_id, actor_id, actor_role, action, entity_type, entity_id,
          before_json, after_json, metadata_json, server_timestamp
        )
        SELECT ?, ?, ?, 'system.reset_all', 'system', 'all-application-data', ?, ?, ?, ?
        WHERE EXISTS (${markerGuardSql})
      `).bind(
        marker.requestId,
        marker.actorId,
        marker.actorRole,
        boundedAuditJson(marker.audit.before),
        boundedAuditJson(marker.audit.after),
        boundedAuditJson(marker.audit.metadata),
        marker.serverTime,
        RESET_ALL_PENDING_METADATA_KEY,
        markerJson,
      ),
      ...receiptStatements(db, {
        actorId: marker.actorId,
        idempotencyKey: marker.idempotencyKey,
        requestHash: marker.requestHash,
        responseJson,
        status: 200,
        createdAt: marker.serverTime,
        successSql: markerGuardSql,
        successBindings: [RESET_ALL_PENDING_METADATA_KEY, markerJson],
      }),
      db.prepare(`
        DELETE FROM system_metadata
        WHERE meta_key = ? AND value_json = ?
          AND EXISTS (
            SELECT 1 FROM command_receipts
            WHERE actor_id = ? AND idempotency_key = ? AND request_hash = ?
          )
      `).bind(
        RESET_ALL_PENDING_METADATA_KEY,
        markerJson,
        marker.actorId,
        marker.idempotencyKey,
        marker.requestHash,
      ),
    ])
  } catch (error) {
    const receipt = await loadReceipt(db, marker.actorId, marker.idempotencyKey)
    const replay = replayReceipt(receipt, marker.requestHash)
    if (replay) return replay
    throw new ApiError(500, 'RESET_FINALIZE_FAILED', 'Kho ảnh đã được xóa nhưng không thể hoàn tất biên nhận Reset.', {
      cause: String(error),
    })
  }
  const receipt = await loadReceipt(db, marker.actorId, marker.idempotencyKey)
  if (!receipt || await loadPendingSystemResetAll(db)) {
    throw new ApiError(500, 'RESET_FINALIZE_FAILED', 'Không thể xác nhận hoàn tất Reset toàn bộ dữ liệu.')
  }
  return jsonResponse(marker.responseBody)
}

const systemResetAllCommand = async (db, actor, body, commandContext, env) => {
  assertAdmin(actor, 'Chỉ Admin được Reset toàn bộ dữ liệu hệ thống.')
  if (body.type !== 'system.reset_all') {
    throw new ApiError(400, 'COMMAND_UNKNOWN', 'Lệnh hệ thống không được hỗ trợ.')
  }
  const payload = isPlainRecord(body.payload) ? body.payload : {}
  const unsupportedFields = Object.keys(payload).filter((key) => key !== 'confirmation')
  if (unsupportedFields.length) {
    throw new ApiError(400, 'RESET_PAYLOAD_INVALID', 'Reset toàn bộ dữ liệu chỉ nhận trường xác nhận.', {
      fields: unsupportedFields,
    })
  }
  if (payload.confirmation !== 'RESET_ALL_DATA') {
    throw new ApiError(400, 'RESET_CONFIRMATION_REQUIRED', 'Cần xác nhận chính xác RESET_ALL_DATA để Reset toàn bộ dữ liệu.')
  }

  const pendingRow = await loadPendingSystemResetAll(db)
  if (pendingRow) {
    const pending = parseStoredJson(pendingRow.value_json, null)
    if (!isPlainRecord(pending)
      || pending.actorId !== actor.user_id) {
      throw new ApiError(409, 'RESET_ALREADY_PENDING', 'Một lệnh Reset toàn bộ dữ liệu của Admin khác đang chờ xóa ảnh CCCD.')
    }
    await purgeAndVerifyIdentityImages(env?.IDENTITY_IMAGES)
    await purgeAndVerifyAccountAvatars(
      env?.IDENTITY_IMAGES,
      Array.isArray(pending.preservedAccountAvatarKeys) ? pending.preservedAccountAvatarKeys : [],
    )
    return finalizeSystemResetAll(db, pendingRow)
  }

  const { current, state: storedState } = await loadGlobalCommandState(db, body)
  const avatarMutation = hasLegacyAccountAvatarData(storedState)
    ? await beginAccountAvatarMutationCleanup(db, actor.user_id, commandContext.requestId, commandContext.now)
    : null
  let legacyMigration
  try {
    legacyMigration = await prepareLegacyAccountAvatarMigration(
      env,
      db,
      storedState,
      commandContext.now,
      actor.user_id,
      avatarMutation ? accountAvatarMutationLifecycle(db, env?.IDENTITY_IMAGES, avatarMutation) : {},
    )
  } catch (error) {
    if (avatarMutation) {
      await cleanupAccountAvatarMutation(db, env?.IDENTITY_IMAGES, avatarMutation.metaKey, commandContext, {
        suppressFailure: true,
      })
    }
    throw error
  }
  let committed = false
  try {
  const state = normalizeSharedStateForStorage(legacyMigration.state)
  const [
    removableAccounts,
    removableAdminAccounts,
    nonAdminAccounts,
    removableSessions,
    receipts,
    receiptChunks,
    audits,
    policies,
    counters,
    privateStateScopes,
    stateCollections,
    stateEntities,
  ] = await Promise.all([
    first(db, 'SELECT COUNT(*) AS count FROM users WHERE id <> ?', actor.user_id),
    first(db, "SELECT COUNT(*) AS count FROM users WHERE id <> ? AND role = 'admin'", actor.user_id),
    first(db, "SELECT COUNT(*) AS count FROM users WHERE role <> 'admin'"),
    first(db, 'SELECT COUNT(*) AS count FROM sessions WHERE id <> ?', actor.session_id),
    first(db, 'SELECT COUNT(*) AS count FROM command_receipts'),
    first(db, 'SELECT COUNT(*) AS count FROM command_receipt_chunks'),
    first(db, 'SELECT COUNT(*) AS count FROM audit_log'),
    first(db, 'SELECT COUNT(*) AS count FROM policies'),
    first(db, 'SELECT COUNT(*) AS count FROM counters'),
    first(db, "SELECT COUNT(*) AS count FROM app_state WHERE scope_key <> 'global'"),
    first(db, 'SELECT COUNT(*) AS count FROM state_collections'),
    first(db, 'SELECT COUNT(*) AS count FROM state_entities'),
  ])
  const adminAccountIds = [String(actor.user_id)]
  const actorAccountSettings = isPlainRecord(state.accountSettings?.[actor.user_id])
    ? state.accountSettings[actor.user_id]
    : ownAccountSettings(state, actor)
  const preservedAccountSettings = { [actor.user_id]: actorAccountSettings }
  const preservedAccountAvatarKeys = [...accountAvatarKeysFromState({ accountSettings: preservedAccountSettings })]
  let identityImageKeys
  let accountAvatarKeys
  try {
    identityImageKeys = await listIdentityImageKeysForReset(env?.IDENTITY_IMAGES, state)
    accountAvatarKeys = await listAccountAvatarKeysForReset(env?.IDENTITY_IMAGES, state, preservedAccountAvatarKeys)
  } catch (error) {
    if (avatarMutation) {
      await cleanupAccountAvatarMutation(db, env?.IDENTITY_IMAGES, avatarMutation.metaKey, commandContext, {
        suppressFailure: true,
      })
    }
    throw error
  }
  const nextState = {
    schemaVersion: Number.isInteger(Number(state.schemaVersion)) && Number(state.schemaVersion) > 0
      ? Number(state.schemaVersion)
      : 2,
    stateVersion: Math.max(1, Number(state.stateVersion) || 1) + 1,
    accountSettings: preservedAccountSettings,
    ...Object.fromEntries(RESET_ARRAY_COLLECTIONS.map((key) => [key, []])),
    orderInformationOptions: materializeDefaultOrderInformationOptions({}),
  }
  const purged = {
    accounts: Number(removableAccounts?.count || 0),
    otherAdminAccounts: Number(removableAdminAccounts?.count || 0),
    nonAdminAccounts: Number(nonAdminAccounts?.count || 0),
    sessions: Number(removableSessions?.count || 0),
    commandReceipts: Number(receipts?.count || 0),
    commandReceiptChunks: Number(receiptChunks?.count || 0),
    audits: Number(audits?.count || 0),
    policies: Number(policies?.count || 0),
    counters: Number(counters?.count || 0),
    privateStateScopes: Number(privateStateScopes?.count || 0),
    stateCollections: Number(stateCollections?.count || 0),
    stateEntities: Number(stateEntities?.count || 0),
    identityImageObjectsTargeted: identityImageKeys.length,
    accountAvatarObjectsTargeted: accountAvatarKeys.length,
  }
  const nextStateVersion = Number(current.version) + 1
  const responseBody = apiPayload(commandContext, {
    command: body.type,
    state: projectSharedState(nextState, actor),
    reset: {
      purged,
      preservedAdminAccountIds: adminAccountIds,
      preservedCurrentAdminSession: true,
      preservedAdminAccountSettings: Object.keys(preservedAccountSettings).sort(),
      defaultPolicyCount: Object.keys(DEFAULT_POLICIES).length,
      identityImagePrefix: IDENTITY_IMAGE_KEY_PREFIX,
      identityImageStorageVerifiedEmpty: true,
      accountAvatarPrefix: ACCOUNT_AVATAR_KEY_PREFIX,
      accountAvatarStorageVerified: true,
    },
    version: nextStateVersion,
  })
  const marker = {
    schema: 1,
    actorId: actor.user_id,
    actorRole: actor.role,
    idempotencyKey: commandContext.idempotencyKey,
    requestHash: commandContext.hash,
    requestId: commandContext.requestId,
    serverTime: commandContext.now,
    preservedAccountAvatarKeys,
    responseBody,
    audit: {
      before: resetStateSummary(state),
      after: resetStateSummary(nextState),
      metadata: {
        confirmation: 'RESET_ALL_DATA',
        purged,
        preservedAdminAccountIds: adminAccountIds,
        preservedCurrentAdminSession: true,
        preservedAdminAccountSettings: Object.keys(preservedAccountSettings).sort(),
        defaultPoliciesRestored: Object.keys(DEFAULT_POLICIES).sort(),
        identityImagePrefix: IDENTITY_IMAGE_KEY_PREFIX,
        accountAvatarPrefix: ACCOUNT_AVATAR_KEY_PREFIX,
        preservedAccountAvatarKeys,
        ...(legacyMigration.changed
          ? { legacyAvatarMigration: legacyAvatarMigrationAudit(legacyMigration) }
          : {}),
      },
    },
  }
  const markerJson = JSON.stringify(marker)
  const guardSql = `
    EXISTS (
      SELECT 1 FROM app_state
      WHERE scope_key = 'global' AND version = ? AND last_request_id = ?
    )
  `
  const stateCommit = prepareStateCommit(db, {
    current,
    nextState,
    scope: 'global',
    currentVersion: Number(current.version),
    nextVersion: nextStateVersion,
    now: commandContext.now,
    actorId: actor.user_id,
    requestId: commandContext.requestId,
  })
  const committedAvatarMutation = avatarMutation
    ? commitAccountAvatarMutationCleanup(
        avatarMutation,
        [],
        preservedAccountAvatarKeys,
        commandContext.now,
      )
    : null
  const stateMutation = avatarMutation
    ? db.prepare(`
        UPDATE app_state
        SET value_json = ?, version = ?, updated_at = ?, updated_by = ?, last_request_id = ?
        WHERE scope_key = 'global' AND version = ?
          AND EXISTS (
            SELECT 1 FROM system_metadata WHERE meta_key = ? AND value_json = ?
          )
      `).bind(
        stateCommit.compactJson,
        nextStateVersion,
        commandContext.now,
        actor.user_id,
        commandContext.requestId,
        Number(current.version),
        avatarMutation.metaKey,
        avatarMutation.valueJson,
      )
    : stateCommit.mutation
  const additionalStatements = [
    db.prepare(`DELETE FROM app_state WHERE scope_key <> 'global' AND ${guardSql}`)
      .bind(nextStateVersion, commandContext.requestId),
    db.prepare(`DELETE FROM audit_log WHERE ${guardSql}`)
      .bind(nextStateVersion, commandContext.requestId),
    db.prepare(`DELETE FROM command_receipt_chunks WHERE ${guardSql}`)
      .bind(nextStateVersion, commandContext.requestId),
    db.prepare(`DELETE FROM command_receipts WHERE ${guardSql}`)
      .bind(nextStateVersion, commandContext.requestId),
    db.prepare(`DELETE FROM sessions WHERE id <> ? AND ${guardSql}`)
      .bind(actor.session_id, nextStateVersion, commandContext.requestId),
    db.prepare(`DELETE FROM users WHERE id <> ? AND ${guardSql}`)
      .bind(actor.user_id, nextStateVersion, commandContext.requestId),
    db.prepare(`DELETE FROM policies WHERE ${guardSql}`)
      .bind(nextStateVersion, commandContext.requestId),
    ...Object.entries(DEFAULT_POLICIES).map(([key, value]) => db.prepare(`
      INSERT INTO policies (
        policy_key, value_json, version, effective_at, updated_at, updated_by, last_request_id
      )
      SELECT ?, ?, 1, ?, ?, ?, ?
      WHERE ${guardSql}
    `).bind(
      key,
      JSON.stringify(value),
      commandContext.now,
      commandContext.now,
      actor.user_id,
      commandContext.requestId,
      nextStateVersion,
      commandContext.requestId,
    )),
    db.prepare(`DELETE FROM counters WHERE ${guardSql}`)
      .bind(nextStateVersion, commandContext.requestId),
    ...(avatarMutation ? [db.prepare(`
      UPDATE system_metadata
      SET value_json = ?, version = version + 1, updated_at = ?
      WHERE meta_key = ? AND value_json = ?
        AND ${guardSql}
    `).bind(
      committedAvatarMutation.valueJson,
      commandContext.now,
      avatarMutation.metaKey,
      avatarMutation.valueJson,
      nextStateVersion,
      commandContext.requestId,
    )] : []),
    db.prepare(`
      INSERT INTO system_metadata (meta_key, value_json, version, updated_at)
      SELECT ?, ?, 1, ?
      WHERE ${guardSql}
      ON CONFLICT(meta_key) DO UPDATE SET
        value_json = excluded.value_json,
        version = system_metadata.version + 1,
        updated_at = excluded.updated_at
    `).bind(
      RESET_ALL_PENDING_METADATA_KEY,
      markerJson,
      commandContext.now,
      nextStateVersion,
      commandContext.requestId,
    ),
  ]
  let results
  try {
    results = await db.batch([
      stateMutation,
      ...stateCommit.externalStatements,
      ...additionalStatements,
    ])
  } catch (error) {
    if (avatarMutation) {
      await cleanupAccountAvatarMutation(db, env?.IDENTITY_IMAGES, avatarMutation.metaKey, commandContext, {
        suppressFailure: true,
      })
    }
    const latest = await loadState(db, 'global')
    throw new ApiError(409, 'VERSION_CONFLICT', 'Dữ liệu đã thay đổi trên máy chủ trước khi Reset.', {
      currentVersion: Number(latest?.version || 0),
      cause: String(error),
    })
  }
  if (changes(results?.[0]) !== 1) {
    if (avatarMutation) {
      await cleanupAccountAvatarMutation(db, env?.IDENTITY_IMAGES, avatarMutation.metaKey, commandContext, {
        suppressFailure: true,
      })
    }
    const latest = await loadState(db, 'global')
    throw new ApiError(409, 'VERSION_CONFLICT', 'Dữ liệu đã thay đổi trên máy chủ trước khi Reset.', {
      currentVersion: Number(latest?.version || 0),
    })
  }
  committed = true
  if (avatarMutation) {
    await cleanupAccountAvatarMutation(db, env?.IDENTITY_IMAGES, avatarMutation.metaKey, commandContext, {
      suppressFailure: true,
    })
  }
  await purgeAndVerifyIdentityImages(env?.IDENTITY_IMAGES, identityImageKeys)
  await purgeAndVerifyAccountAvatars(env?.IDENTITY_IMAGES, preservedAccountAvatarKeys, accountAvatarKeys)
  return finalizeSystemResetAll(db, await loadPendingSystemResetAll(db))
  } catch (error) {
    if (!committed) {
      if (avatarMutation) {
        await cleanupAccountAvatarMutation(db, env?.IDENTITY_IMAGES, avatarMutation.metaKey, commandContext, {
          suppressFailure: true,
        })
      }
    }
    throw error
  }
}

const asVnd = (value, field, { positive = false } = {}) => {
  const amount = Number(value)
  if (!Number.isSafeInteger(amount) || amount < 0 || amount > MAX_MONEY_VND || (positive && amount === 0)) {
    throw new ApiError(400, 'MONEY_INVALID', `${field} phải là số nguyên ${positive ? 'dương' : 'không âm'} không quá ${MAX_MONEY_VND.toLocaleString('vi-VN')}đ.`)
  }
  return amount
}

const safeMoneySum = (left, right, field = 'Tổng tiền') => {
  const result = Number(left) + Number(right)
  if (!Number.isSafeInteger(result) || Math.abs(result) > Number.MAX_SAFE_INTEGER) {
    throw new ApiError(409, 'MONEY_TOTAL_INVALID', `${field} vượt quá giới hạn an toàn.`)
  }
  return result
}

const asMonth = (value, field = 'Kỳ') => {
  const period = String(value || '').trim()
  if (!/^\d{4}-(?:0[1-9]|1[0-2])$/u.test(period)) {
    throw new ApiError(400, 'PERIOD_INVALID', `${field} phải có định dạng YYYY-MM.`)
  }
  return period
}

const dateFromRecord = (record) => {
  const businessDate = String(record?.workDate || record?.attendanceDate || record?.date || record?.effectiveDate || record?.occurredOn || '').trim()
  if (/^\d{4}-\d{2}-\d{2}$/u.test(businessDate)) return businessDate
  const source = String(record?.occurredAt || record?.createdAt || '').trim()
  if (/^\d{4}-\d{2}-\d{2}$/u.test(source)) return source
  const timestamp = Date.parse(source)
  return Number.isFinite(timestamp) ? localDateTimeParts(new Date(timestamp).toISOString()).date : source.slice(0, 10)
}

export const monthFromRecord = (record) => {
  const period = String(record?.period || '').trim()
  return /^\d{4}-(?:0[1-9]|1[0-2])$/u.test(period) ? period : dateFromRecord(record).slice(0, 7)
}

const asOccurredAt = (value, fallback) => {
  const occurredAt = value == null || value === '' ? fallback : String(value)
  const match = occurredAt.match(/^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])(?:T|$)/u)
  const calendarDate = match
    ? new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
    : null
  const calendarValid = Boolean(calendarDate
    && calendarDate.getUTCFullYear() === Number(match[1])
    && calendarDate.getUTCMonth() + 1 === Number(match[2])
    && calendarDate.getUTCDate() === Number(match[3]))
  if (!calendarValid
    || !Number.isFinite(Date.parse(occurredAt.length === 10 ? `${occurredAt}T00:00:00+07:00` : occurredAt))) {
    throw new ApiError(400, 'OCCURRED_AT_INVALID', 'Ngày ghi nhận không hợp lệ.')
  }
  return occurredAt
}

const requireStore = (state, storeId) => {
  const normalized = String(storeId || '').trim()
  const store = (Array.isArray(state.stores) ? state.stores : [])
    .find((record) => sameIdentifier(record.id, normalized) && !record.deletedAt)
  if (!store) throw new ApiError(400, 'STORE_INVALID', 'Cửa hàng không hợp lệ.')
  return store
}

const requirePayrollUnit = (state, storeId) => {
  const normalized = String(storeId || '').trim()
  if (sameIdentifier(normalized, OFFICE_STORE_ID) && (Array.isArray(state.employees) ? state.employees : []).some((employee) => (
    !employee.deletedAt
    && employeeUnit(employee) === 'office'
  ))) {
    return { id: OFFICE_STORE_ID, name: 'Khối Văn Phòng', unit: 'office' }
  }
  if (sameIdentifier(normalized, BUSINESS_SUPPORT_STORE_ID) && (Array.isArray(state.employees) ? state.employees : []).some((employee) => (
    !employee.deletedAt && employeeUnit(employee) === 'business_support'
  ))) {
    return { id: BUSINESS_SUPPORT_STORE_ID, name: 'Nhân viên hỗ trợ kinh doanh', unit: 'business_support' }
  }
  return requireStore(state, normalized)
}

const payrollPeriodFor = (state, storeId, period) => {
  const matches = (Array.isArray(state.payrollPeriods) ? state.payrollPeriods : [])
    .filter((record) => (
      !record.supersededAt
      && sameIdentifier(record.storeId, storeId)
      && String(record.period || '') === period
    ))
  if (matches.length > 1) {
    throw new ApiError(
      409,
      'PAYROLL_PERIOD_IDENTIFIER_COLLISION',
      'Kỳ lương đang có nhiều bản ghi trùng cửa hàng và tháng; cần xử lý dữ liệu trùng trước khi tiếp tục.',
      {
        storeId: normalizeIdentifierKey(storeId),
        period,
        conflictingPeriodIds: matches.map((record) => String(record?.id || '')),
        conflictingStoreIds: matches.map((record) => String(record?.storeId || '')),
      },
    )
  }
  return matches[0]
}

const assertAccountingPeriodOpen = (state, storeId, period) => {
  const payroll = payrollPeriodFor(state, storeId, period)
  if (payroll?.status === 'Đã khóa' || payroll?.lockedAt) {
    throw new ApiError(409, 'PAYROLL_PERIOD_LOCKED', 'Kỳ lương liên quan đã khóa; không thể thay đổi số liệu.')
  }
}

const invalidateClosedPayrollPeriods = (state, targets, timestamp, reason) => {
  const targetKeys = new Set((Array.isArray(targets) ? targets : [targets])
    .filter(Boolean)
    .map((target) => `${normalizeIdentifierKey(target.storeId)}:${String(target.period || '')}`))
  return (Array.isArray(state.payrollPeriods) ? state.payrollPeriods : []).map((payroll) => {
    if (payroll.supersededAt) return payroll
    const key = `${normalizeIdentifierKey(payroll.storeId)}:${String(payroll.period || '')}`
    if (!targetKeys.has(key)
      || payroll.status !== 'Đã chốt'
      || payroll.confirmedAt
      || payroll.lockedAt) return payroll
    return {
      ...payroll,
      needsReclose: true,
      invalidatedAt: timestamp,
      invalidationReason: reason,
      updatedAt: timestamp,
    }
  })
}

const sourceMatch = (record, sourceType, sourceId) => (
  String(record?.sourceType || '') === sourceType && String(record?.sourceId || '') === String(sourceId)
)

const recordNoopCommand = async (db, actor, response, status, commandContext) => {
  const responseBody = apiPayload(commandContext, response)
  try {
    await run(db, `
      INSERT INTO command_receipts (
        actor_id, idempotency_key, request_hash, response_json, status_code, created_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `, actor.user_id, commandContext.idempotencyKey, commandContext.hash, JSON.stringify(responseBody), status, commandContext.now)
  } catch {
    const receipt = await loadReceipt(db, actor.user_id, commandContext.idempotencyKey)
    const replay = replayReceipt(receipt, commandContext.hash)
    if (replay) return replay
    throw new ApiError(409, 'IDEMPOTENCY_CONFLICT', 'Không thể ghi nhận lệnh lặp lại.')
  }
  return jsonResponse(responseBody, status)
}

const orderBelongsToAttendance = (order, attendance, attendanceRecords) => {
  const attendanceEmployeeId = String(attendance.employeeId || '')
  if (!attendanceEmployeeId || !orderCreatedByEmployee(order, attendanceEmployeeId)) return false
  if (order.attendanceId) {
    return mutationIdentifierReferenceMatchesRecord({
      records: attendanceRecords,
      record: attendance,
      reference: order.attendanceId,
      collisionCode: 'ATTENDANCE_REFERENCE_COLLISION',
      collisionMessage: 'Mã chấm công tham chiếu trong đơn hàng đang mơ hồ; cần xử lý dữ liệu trùng trước khi tính doanh thu ca.',
    })
  }
  if (!attendance.storeId) return false
  const createdAt = Date.parse(order.createdAt)
  const checkInAt = Date.parse(attendance.checkInAt)
  const checkOutAt = Date.parse(attendance.checkOutAt || attendance.updatedAt)
  const orderShiftId = String(order.shiftId || '').trim()
  const attendanceShiftId = String(attendance.shiftId || attendance.shift || '').trim()
  return sameIdentifier(order.storeId, attendance.storeId)
    && ((!orderShiftId && !attendanceShiftId) || sameIdentifier(orderShiftId, attendanceShiftId))
    && Number.isFinite(createdAt)
    && Number.isFinite(checkInAt)
    && Number.isFinite(checkOutAt)
    && createdAt >= checkInAt
    && createdAt <= checkOutAt
}

const orderSalesTotals = (orders, attendance, attendanceRecords) => {
  const scoped = orders.filter((order) => (
    !order.deletedAt
    && order.status !== 'Đã xóa'
    && orderBelongsToAttendance(order, attendance, attendanceRecords)
  ))
  const revenue = scoped.reduce((sum, order) => safeMoneySum(sum, Number(order.amount || 0), 'Doanh thu ca'), 0)
  const cash = scoped.filter((order) => order.paymentMethod === 'Tiền mặt')
    .reduce((sum, order) => safeMoneySum(sum, Number(order.amount || 0), 'Tiền mặt trong ca'), 0)
  return { revenue, cash, transfer: revenue - cash, orderCount: scoped.length }
}

const refreshAttendanceSales = (state, orders, changedOrder, timestamp) => {
  const attendance = Array.isArray(state.attendance) ? state.attendance : []
  const target = attendance.find((record) => orderBelongsToAttendance(changedOrder, record, attendance))
  if (!target) return attendance
  const totals = orderSalesTotals(orders, target, attendance)
  return attendance.map((record) => record === target
    ? { ...record, ...totals, updatedAt: timestamp }
    : record)
}

const normalizeTextKey = (value) => String(value || '')
  .trim()
  .toLocaleLowerCase('vi-VN')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/gu, '')
  .replaceAll('đ', 'd')

const nonCancelled = (record) => {
  const status = normalizeTextKey(record?.status)
  return !record?.deletedAt && !['da huy', 'huy', 'cancelled', 'voided'].includes(status)
}

const workedHoursFor = (state, employeeId, storeId, period) => (Array.isArray(state.attendance) ? state.attendance : [])
  .filter((record) => (
    !record.deletedAt
    && belongsToEmployee(record, employeeId)
    && sameIdentifier(record.storeId, storeId)
    && monthFromRecord(record) === period
  ))
  .reduce((sum, record) => {
    const hours = Number(record.hours ?? (Number(record.workedSeconds || 0) / 3_600))
    return sum + (Number.isFinite(hours) && hours > 0 ? hours : 0)
  }, 0)

const attendanceWorkedHours = (record = {}) => {
  const value = Number(record.hours ?? (Number(record.workedSeconds || 0) / 3_600))
  return Number.isFinite(value) && value > 0 ? value : 0
}

const linkedAttendanceForSupportTransfer = (state, transfer) => {
  const transferBounds = supportTransferTimeBounds(transfer)
  if (!transferBounds) return []
  const employeeId = String(transfer.employeeId || '')
  const storeId = String(transfer.toStoreId || '')
  const calendarRange = supportTransferCalendarRange(transferBounds)
  return (Array.isArray(state.attendance) ? state.attendance : []).filter((record) => {
    if (record.deletedAt
      || !belongsToEmployee(record, employeeId)
      || !sameIdentifier(record.storeId, storeId)) return false
    if (record.supportTransferId) return sameIdentifier(record.supportTransferId, transfer.id)
    const checkInMs = Date.parse(String(record.checkInAt || ''))
    if (Number.isFinite(checkInMs)) return transferBounds.startMs <= checkInMs && checkInMs < transferBounds.endMs
    const legacyDate = dateFromRecord(record)
    return legacyDate >= calendarRange.fromDate && legacyDate <= calendarRange.toDate
  })
}

const supportAllowanceAttendanceId = (state, transfer) => {
  const completed = linkedAttendanceForSupportTransfer(state, transfer)
    .filter((record) => attendanceWorkedHours(record) > 0 && Boolean(record.checkOutAt || record.checkOut || record.checkOutTime))
    .sort((left, right) => {
      const leftEpoch = Date.parse(String(left.checkInAt || left.createdAt || ''))
      const rightEpoch = Date.parse(String(right.checkInAt || right.createdAt || ''))
      if (Number.isFinite(leftEpoch) && Number.isFinite(rightEpoch) && leftEpoch !== rightEpoch) return leftEpoch - rightEpoch
      const dateOrder = dateFromRecord(left).localeCompare(dateFromRecord(right))
      return dateOrder || String(left.id || '').localeCompare(String(right.id || ''))
    })
  return String(completed[0]?.id || '') || null
}

const storeNameForId = (state, storeId) => (Array.isArray(state.stores) ? state.stores : [])
  .find((record) => sameIdentifier(record.id, storeId) && !record.deletedAt)?.name || null

const createSupportCompensationProjectionContext = (state) => {
  const transfersById = new Map()
  for (const transfer of Array.isArray(state.supportTransfers) ? state.supportTransfers : []) {
    if (!isPlainRecord(transfer)
      || transfer.deletedAt
      || ['Đã xóa', 'Đã hủy'].includes(String(transfer.status || ''))) continue
    const key = normalizeIdentifierKey(transfer.id)
    if (key && !transfersById.has(key)) transfersById.set(key, transfer)
  }

  const storeNamesById = new Map()
  for (const store of Array.isArray(state.stores) ? state.stores : []) {
    if (!isPlainRecord(store) || store.deletedAt) continue
    const key = normalizeIdentifierKey(store.id)
    if (key && !storeNamesById.has(key)) storeNamesById.set(key, store.name || null)
  }

  const allowanceAttendanceIds = new WeakMap()
  return {
    transferForId: (transferId) => transfersById.get(normalizeIdentifierKey(transferId)) || null,
    storeNameForId: (storeId) => storeNamesById.get(normalizeIdentifierKey(storeId)) || null,
    allowanceAttendanceIdFor: (transfer) => {
      if (!isPlainRecord(transfer)) return null
      if (!allowanceAttendanceIds.has(transfer)) {
        allowanceAttendanceIds.set(transfer, supportAllowanceAttendanceId(state, transfer))
      }
      return allowanceAttendanceIds.get(transfer)
    },
  }
}

export const supportCompensationForAttendance = (state, record, projectionContext = null) => {
  const transferId = String(record?.supportTransferId || record?.supportCompensation?.transferId || '')
  if (!transferId) return null
  const transfer = projectionContext?.transferForId
    ? projectionContext.transferForId(transferId)
    : (Array.isArray(state.supportTransfers) ? state.supportTransfers : []).find((candidate) => (
        sameIdentifier(candidate.id, transferId)
        && !candidate.deletedAt
        && !['Đã xóa', 'Đã hủy'].includes(String(candidate.status || ''))
      ))
  if (!transfer) return isPlainRecord(record.supportCompensation) ? record.supportCompensation : null
  const bounds = supportTransferTimeBounds(transfer)
  if (!bounds) return isPlainRecord(record.supportCompensation) ? record.supportCompensation : null
  const hours = attendanceWorkedHours(record)
  const hourlyRateValue = Number(transfer.hourlySupportRate ?? record.supportHourlyRate ?? 0)
  const hourlyRate = Number.isSafeInteger(hourlyRateValue) && hourlyRateValue >= 0 ? hourlyRateValue : 0
  const basePay = Math.floor(hours * hourlyRate)
  if (!Number.isSafeInteger(basePay) || basePay < 0 || basePay > MAX_MONEY_VND) return null
  const allowanceValue = Number(transfer.allowance ?? 0)
  const configuredAllowance = Number.isSafeInteger(allowanceValue) && allowanceValue >= 0 ? allowanceValue : 0
  // The selected row is an exact persisted attendance identity. A legacy
  // case-colliding alias must never receive the same one-time allowance.
  const allowanceAttendanceId = projectionContext?.allowanceAttendanceIdFor
    ? projectionContext.allowanceAttendanceIdFor(transfer)
    : supportAllowanceAttendanceId(state, transfer)
  const allowanceApplied = Boolean(
    hours > 0
    && String(record.id || '') === String(allowanceAttendanceId || ''),
  )
  const allowance = allowanceApplied ? configuredAllowance : 0
  const totalPay = safeMoneySum(basePay, allowance, 'Lương thực nhận ca hỗ trợ')
  const projectedStoreName = (storeId) => projectionContext?.storeNameForId
    ? projectionContext.storeNameForId(storeId)
    : storeNameForId(state, storeId)
  return {
    transferId,
    homeStoreId: String(transfer.fromStoreId || record.homeStoreId || ''),
    homeStoreName: projectedStoreName(transfer.fromStoreId) || record.supportCompensation?.homeStoreName || null,
    supportStoreId: String(transfer.toStoreId || record.storeId || ''),
    supportStoreName: projectedStoreName(transfer.toStoreId) || record.supportCompensation?.supportStoreName || null,
    transferStartAt: bounds.startAt,
    transferEndAt: bounds.endAt,
    hourlyRate,
    hours,
    basePay,
    allowance,
    configuredAllowance,
    allowanceApplied,
    totalPay,
    expenseEntryId: totalPay > 0 ? `exp_support_${record.id}` : null,
  }
}

const withSupportCompensation = (state, record, projectionContext = null) => {
  const supportCompensation = supportCompensationForAttendance(state, record, projectionContext)
  if (!supportCompensation) return record
  return {
    ...record,
    supportCompensation,
    supportHourlyRate: supportCompensation.hourlyRate,
    supportHours: supportCompensation.hours,
    supportBasePay: supportCompensation.basePay,
    supportAllowance: supportCompensation.allowance,
    supportAllowanceApplied: supportCompensation.allowanceApplied,
    supportActualPay: supportCompensation.totalPay,
  }
}

export const supportTransferPayFor = (state, employeeId, storeId, period) => {
  const monthStart = `${period}-01`
  const nextMonthDate = (() => {
    const [year, month] = period.split('-').map(Number)
    const next = new Date(Date.UTC(year, month, 1))
    return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-01`
  })()
  const monthStartMs = transferDateTimeEpoch(`${monthStart}T00:00`)
  const monthEndMs = transferDateTimeEpoch(`${nextMonthDate}T00:00`)
  const candidates = (Array.isArray(state.supportTransfers) ? state.supportTransfers : []).filter((record) => (
    sameIdentifier(record.employeeId, employeeId)
    && sameIdentifier(record.toStoreId, storeId)
    && !record.deletedAt
    && !['Đã xóa', 'Đã hủy'].includes(String(record.status || ''))
    && (() => {
      const bounds = supportTransferTimeBounds(record)
      return bounds && bounds.startMs < monthEndMs && bounds.endMs > monthStartMs
    })()
  ))
  if (!candidates.length) return null
  const transfers = []
  let hours = 0
  let base = 0
  let allowance = 0
  for (const transfer of candidates) {
    const transferBounds = supportTransferTimeBounds(transfer)
    const transferAttendance = linkedAttendanceForSupportTransfer(state, transfer)
    const allowanceAttendanceId = supportAllowanceAttendanceId(state, transfer)
    const firstAttendance = transferAttendance.find((record) => (
      String(record.id || '') === String(allowanceAttendanceId || '')
    ))
    // A transfer allowance belongs to exactly one payroll period. Prefer the
    // first linked attendance/check-in period; if no attendance exists yet,
    // attribute it to the configured transfer-start month.
    const attributionPeriod = firstAttendance
      ? monthFromRecord(firstAttendance)
      : localDateTimeParts(transferBounds.startAt).date.slice(0, 7)
    const periodAttendance = transferAttendance.filter((record) => monthFromRecord(record) === period)
    const transferHours = periodAttendance.reduce((sum, record) => sum + attendanceWorkedHours(record), 0)
    if (transferHours <= 0) continue
    const hourlyRate = Number(transfer.hourlySupportRate || 0)
    const transferBase = Math.floor(transferHours * hourlyRate)
    const transferAllowance = attributionPeriod === period ? Number(transfer.allowance || 0) : 0
    const attendanceIds = periodAttendance.map((record) => String(record.id || '')).filter(Boolean)
    const detail = {
      transferId: String(transfer.id || ''),
      homeStoreId: String(transfer.fromStoreId || ''),
      homeStoreName: storeNameForId(state, transfer.fromStoreId),
      supportStoreId: String(transfer.toStoreId || ''),
      supportStoreName: storeNameForId(state, transfer.toStoreId),
      startAt: transferBounds.startAt,
      endAt: transferBounds.endAt,
      hours: transferHours,
      hourlyRate,
      basePay: transferBase,
      allowance: transferAllowance,
      totalPay: safeMoneySum(transferBase, transferAllowance, 'Lương điều chuyển theo phiếu'),
      attendanceIds,
      allowanceAttendanceId,
    }
    transfers.push({ ...transfer, compensation: detail })
    hours += transferHours
    base = safeMoneySum(base, transferBase, 'Lương hỗ trợ điều chuyển')
    allowance = safeMoneySum(allowance, transferAllowance, 'Phụ cấp điều chuyển')
  }
  if (!transfers.length) return null
  const details = transfers.map((record) => record.compensation)
  return { transfers, details, hours, base, allowance, totalPay: safeMoneySum(base, allowance, 'Tổng lương hỗ trợ') }
}

const recognizedSupportCompensationFor = (state, storeId, employeeId, supportDetails) => {
  const attendanceRecords = (Array.isArray(state.attendance) ? state.attendance : [])
    .filter((record) => !record.deletedAt)
  const attendanceSourceKey = (reference) => collisionAwareIdentifierReferenceKey({
    records: attendanceRecords,
    reference,
  })
  const attendanceIds = new Set((Array.isArray(supportDetails) ? supportDetails : [])
    .flatMap((detail) => Array.isArray(detail.attendanceIds)
      ? detail.attendanceIds.map(attendanceSourceKey).filter(Boolean)
      : []))
  const seenSources = new Set()
  return (Array.isArray(state.expenseEntries) ? state.expenseEntries : [])
    .filter((entry) => (
      sameIdentifier(entry.storeId, storeId)
      && sameIdentifier(entry.employeeId, employeeId)
      && String(entry.sourceType || '') === 'support-attendance-compensation'
      && attendanceIds.has(attendanceSourceKey(entry.sourceId || entry.attendanceId))
      && entry.recognized !== false
      && !entry.deletedAt
      && !entry.voidedAt
    ))
    .reduce((sum, entry) => {
      const sourceId = attendanceSourceKey(entry.sourceId || entry.attendanceId || entry.id)
      if (seenSources.has(sourceId)) return sum
      seenSources.add(sourceId)
      return safeMoneySum(sum, Number(entry.amount || 0), 'Chi phí lương hỗ trợ đã ghi nhận')
    }, 0)
}

const validRequiredWorkingDays = (value) => {
  const days = Number(value)
  return Number.isInteger(days) && days >= 1 && days <= 31 ? days : null
}

const requiredWorkingDaysForEmployee = (employee, period) => (
  validRequiredWorkingDays(isPlainRecord(employee?.monthlyWorkdayTargets)
    ? employee.monthlyWorkdayTargets[period]
    : null)
  || validRequiredWorkingDays(employee?.standardWorkDays)
  || 26
)

const snapshottedRequiredWorkingDaysFor = (state, employee, employeeId, storeId, period) => {
  const monthlyTarget = validRequiredWorkingDays(isPlainRecord(employee?.monthlyWorkdayTargets)
    ? employee.monthlyWorkdayTargets[period]
    : null)
  if (monthlyTarget) return monthlyTarget
  const records = (Array.isArray(state.attendance) ? state.attendance : [])
    .filter((record) => (
      !record.deletedAt
      && belongsToEmployee(record, employeeId)
      && sameIdentifier(record.storeId, storeId)
      && monthFromRecord(record) === period
    ))
    .sort((left, right) => dateFromRecord(left).localeCompare(dateFromRecord(right)))
  for (const record of records) {
    const snapshot = validRequiredWorkingDays(
      record.requiredWorkingDaysSnapshot ?? record.standardWorkDaysSnapshot,
    )
    if (snapshot) return snapshot
  }
  return validRequiredWorkingDays(employee?.standardWorkDays) || 26
}

const workedDaysFor = (state, employeeId, storeId, period) => {
  const credits = new Map()
  for (const record of Array.isArray(state.attendance) ? state.attendance : []) {
    if (record.deletedAt
      || !belongsToEmployee(record, employeeId)
      || !sameIdentifier(record.storeId, storeId)
      || monthFromRecord(record) !== period) continue
    const completed = Boolean(record.checkOutAt || record.checkOut || record.checkOutTime)
    if (!completed) continue
    const workedSeconds = Number(record.workedSeconds ?? (Number(record.hours || 0) * 3_600))
    if (!Number.isFinite(workedSeconds) || workedSeconds <= 0) continue
    const date = dateFromRecord(record)
    if (!/^\d{4}-\d{2}-\d{2}$/u.test(date)) continue
    const explicitCredit = Number(record.workdayCredit)
    const credit = Number.isFinite(explicitCredit) ? Math.min(1, Math.max(0, explicitCredit)) : 1
    credits.set(date, Math.max(credits.get(date) || 0, credit))
  }
  return [...credits.values()].reduce((sum, credit) => sum + credit, 0)
}

const recognizedExpensesFor = (state, storeId, period, { excludeSourceTypes = [] } = {}) => {
  const sources = new Set()
  const excludedSources = new Set(excludeSourceTypes.map(normalizeIdentifierKey))
  let amount = 0
  for (const entry of Array.isArray(state.expenseEntries) ? state.expenseEntries : []) {
    if (!sameIdentifier(entry.storeId, storeId)
      || monthFromRecord(entry) !== period
      || entry.recognized === false
      || entry.deletedAt
      || entry.voidedAt
      || excludedSources.has(normalizeIdentifierKey(entry.sourceType))) continue
    const value = Number(entry.amount)
    if (!Number.isSafeInteger(value) || value < 0) continue
    // Source identities are immutable financial identities. Preserve exact
    // spelling so two legacy records that differ only by case cannot collapse
    // into one recognized cost.
    const source = entry.sourceType && entry.sourceId
      ? `${normalizeIdentifierKey(entry.sourceType)}:exact:${String(entry.sourceId).trim()}`
      : `id:exact:${String(entry.id || '').trim()}`
    if (sources.has(source)) continue
    sources.add(source)
    amount = safeMoneySum(amount, value, 'Tổng chi phí trong kỳ')
  }
  return amount
}

const revenueFor = (state, storeId, period) => (Array.isArray(state.orders) ? state.orders : [])
  .filter((order) => (
    sameIdentifier(order.storeId, storeId)
    && monthFromRecord(order) === period
    && !order.deletedAt
    && order.status !== 'Đã xóa'
    && Number.isSafeInteger(Number(order.amount))
    && Number(order.amount) >= 0
  ))
  .reduce((sum, order) => safeMoneySum(sum, Number(order.amount), 'Tổng doanh thu trong kỳ'), 0)

const adjustmentKind = (record = {}) => {
  const type = normalizeTextKey(record.type || record.kind || record.adjustmentType)
  if (type.includes('khau tru')) return 'deduction'
  if (type.includes('phu cap')) return 'allowance'
  return 'bonus'
}

const adjustmentAmountFor = (state, employeeId, period) => {
  const current = Array.isArray(state.salaryAdjustments) ? state.salaryAdjustments : []
  const legacy = Array.isArray(state.officeAdjustments) ? state.officeAdjustments : []
  const seenIds = new Set()
  const primarySignatures = new Set()
  const matches = (record) => (
      belongsToEmployee(record, employeeId)
      && nonCancelled(record)
      && (record.period ? String(record.period) === period : monthFromRecord(record) === period)
  )
  const apply = (sum, record, legacyRecord) => {
      const amount = Number(record.amount)
      if (!Number.isSafeInteger(amount) || amount < 0) return sum
      const id = String(record.id || '').trim()
      const kind = adjustmentKind(record)
      const signature = [employeeId, period, kind, amount, normalizeTextKey(record.note || record.content)].join('|')
      if ((id && seenIds.has(id)) || (legacyRecord && primarySignatures.has(signature))) return sum
      if (id) seenIds.add(id)
      if (!legacyRecord) primarySignatures.add(signature)
      return safeMoneySum(sum, kind === 'deduction' ? -amount : amount, 'Tổng điều chỉnh lương')
  }
  let total = current.filter(matches).reduce((sum, record) => apply(sum, record, false), 0)
  total = legacy.filter(matches).reduce((sum, record) => apply(sum, record, true), total)
  return total
}

const paidAdvancesFor = (state, employeeId, period) => (Array.isArray(state.salaryAdvances) ? state.salaryAdvances : [])
  .filter((record) => (
    belongsToEmployee(record, employeeId)
    && String(record.period || '') === period
    && normalizeTextKey(record.status) === 'da chi'
    && !record.deletedAt
  ))
  .reduce((sum, record) => safeMoneySum(
    sum,
    Number.isSafeInteger(Number(record.amount)) ? Number(record.amount) : 0,
    'Tổng ứng lương',
  ), 0)

const compensationRecordActiveForPayroll = (record, employeeId, period) => (
  belongsToEmployee(record, employeeId)
  && monthFromRecord(record) === period
  && !record.deletedAt
  && !record.voidedAt
  && ['approved', 'active', 'confirmed', 'da duyet', 'da xac nhan'].includes(normalizeTextKey(record.status))
)

const compensationAmountTotalsFor = (state, employeeId, period) => {
  const totals = { manual: 0, work: 0, allowance: 0, revenue: 0 }
  const add = (field, value, label) => {
    totals[field] = safeMoneySum(totals[field], asVnd(value, label), label)
  }
  for (const record of Array.isArray(state.compensationEntries) ? state.compensationEntries : []) {
    if (!compensationRecordActiveForPayroll(record, employeeId, period)
      || employeeUnit({ unit: record.targetUnit }) === 'store_manager'
      || String(record.sourceType || '') === 'manager-revenue-bonus') continue
    const type = String(record.type || record.kind || '').trim().toUpperCase()
    const field = type === 'WORK' ? 'work' : type === 'ALLOWANCE' ? 'allowance' : type === 'REVENUE' ? 'revenue' : 'manual'
    add(field, record.amountVnd ?? record.amount ?? 0, 'Tổng thưởng/phụ cấp')
  }
  for (const record of Array.isArray(state.revenueBonusAllocations) ? state.revenueBonusAllocations : []) {
    if (!compensationRecordActiveForPayroll(record, employeeId, period)) continue
    add('revenue', record.amountVnd ?? record.amount ?? 0, 'Tổng thưởng doanh thu')
  }
  return totals
}

const MANAGER_REVENUE_BONUS_SOURCE_TYPE = 'manager-revenue-bonus'

const managerCompensationTotalsFor = (state, employeeId, period, managerProfile = null) => {
  const totals = { manual: 0, work: 0, allowance: 0, revenue: 0, total: 0 }
  const managerSharesEmployeePayroll = employeeUnit(managerProfile) === 'store'
  for (const record of Array.isArray(state.compensationEntries) ? state.compensationEntries : []) {
    if (!compensationRecordActiveForPayroll(record, employeeId, period)
      || String(record.sourceType || '') === MANAGER_REVENUE_BONUS_SOURCE_TYPE
      || (managerSharesEmployeePayroll && employeeUnit({ unit: record.targetUnit }) !== 'store_manager')) continue
    const type = String(record.type || record.kind || '').trim().toUpperCase()
    const field = type === 'WORK' ? 'work' : type === 'ALLOWANCE' ? 'allowance' : type === 'REVENUE' ? 'revenue' : 'manual'
    const amount = asVnd(record.amountVnd ?? record.amount ?? 0, 'Thưởng/phụ cấp quản lý')
    totals[field] = safeMoneySum(totals[field], amount, 'Tổng thưởng/phụ cấp quản lý')
    totals.total = safeMoneySum(totals.total, amount, 'Tổng thưởng/phụ cấp quản lý')
  }
  return totals
}

const managerRevenueBonusFor = (state, storeId, period, profitBeforeManagerCompensationVnd) => {
  const resolution = resolveExactlyOneActiveStoreManager({
    storeId,
    managers: [
      ...(Array.isArray(state.employees) ? state.employees : []),
      ...(Array.isArray(state.managerAccounts) ? state.managerAccounts : []),
    ],
  })
  if (!resolution.ok) {
    if (resolution.code === 'STORE_MANAGER_MULTIPLE_ACTIVE') {
      throw new ApiError(409, resolution.code, 'Cửa hàng có nhiều Quản lý cửa hàng đang hoạt động; không thể tính thưởng doanh thu.', {
        storeId,
        managerCount: resolution.matches.length,
      })
    }
    return null
  }
  const manager = resolution.manager
  const managerProfileId = String(manager.id || manager.code || '').trim()
  const managerId = managerProfileId || String(resolution.managerId || '').trim()
  const compensation = managerCompensationTotalsFor(state, managerId, period, manager)
  const profitBeforeManagerBonusVnd = safeMoneySum(
    profitBeforeManagerCompensationVnd,
    -compensation.total,
    'Lợi nhuận trước thưởng doanh thu quản lý',
  )
  const calculation = calculateManagerMonthlyRevenueBonus({ profitBeforeManagerBonusVnd })
  return {
    ...calculation,
    idempotencyKey: managerRevenueBonusIdempotencyKey({ storeId, period, managerId }),
    storeId,
    period,
    managerId,
    managerProfileId: managerProfileId || managerId,
    managerName: manager.name || manager.displayName || managerId,
    compensation,
    managerCompensationVnd: compensation.total,
    totalManagerExpenseVnd: safeMoneySum(compensation.total, calculation.bonusVnd, 'Tổng chi phí quản lý'),
  }
}

const violationAmountFor = (state, employeeId, period) => (Array.isArray(state.violations) ? state.violations : [])
  .filter((record) => (
    belongsToEmployee(record, employeeId)
    && monthFromRecord(record) === period
    && !record.deletedAt
    && !record.voidedAt
    && ['active', 'approved', 'confirmed', 'dang ap dung', 'da duyet'].includes(normalizeTextKey(record.status))
  ))
  .reduce((sum, record) => safeMoneySum(
    sum,
    asVnd(record.amountVnd ?? record.amount ?? 0, 'Số tiền vi phạm'),
    'Tổng vi phạm',
  ), 0)

const calculatePayrollSnapshot = async (db, state, requestedStoreId, period) => {
  const payrollUnit = requirePayrollUnit(state, requestedStoreId)
  const storeId = String(payrollUnit.id || requestedStoreId).trim()
  const employees = (Array.isArray(state.employees) ? state.employees : []).filter((employee) => (
    sameIdentifier(employee.storeId, storeId)
    && employeeUnit(employee) === String(payrollUnit.unit || 'store')
    && !employee.deletedAt
    && normalizeTextKey(employee.status) !== 'da nghi viec'
  ))
  const participantIds = new Set()
  const participants = employees.map((employee) => {
    const employeeId = String(employee.id || employee.code || '').trim()
    if (!employeeId) throw new ApiError(409, 'PAYROLL_EMPLOYEE_INVALID', 'Hồ sơ nhân viên thiếu mã định danh.')
    const participantKey = normalizeIdentifierKey(employeeId)
    if (participantIds.has(participantKey)) {
      throw new ApiError(409, 'PAYROLL_EMPLOYEE_DUPLICATE', 'Danh sách nhân viên có mã bị trùng.')
    }
    participantIds.add(participantKey)
    return {
      employee,
      hours: workedHoursFor(state, employeeId, storeId, period),
      workedDays: workedDaysFor(state, employeeId, storeId, period),
      supportPay: null,
    }
  })
  for (const employee of Array.isArray(state.employees) ? state.employees : []) {
    const employeeId = String(employee.id || employee.code || '').trim()
    const participantKey = normalizeIdentifierKey(employeeId)
    if (!employeeId || participantIds.has(participantKey) || employeeUnit(employee) !== 'store' || employee.deletedAt) continue
    const supportPay = supportTransferPayFor(state, employeeId, storeId, period)
    if (!supportPay) continue
    participantIds.add(participantKey)
    participants.push({ employee, hours: supportPay.hours, workedDays: 0, supportPay })
  }
  const revenue = revenueFor(state, storeId, period)
  const attendanceProratedPayroll = ['office', 'business_support'].includes(String(payrollUnit.unit || ''))
  const rows = participants.map(({ employee, hours, workedDays, supportPay }) => {
    const employeeId = String(employee.id || employee.code || '')
    const storeEmploymentType = normalizeStoreEmploymentType(employee.employmentType)
    const physicalStorePolicy = String(payrollUnit.unit || 'store') === 'store'
      ? classifyStorePayrollPolicy(payrollUnit)
      : STORE_PAYROLL_POLICY.UNSUPPORTED
    let configuredSalary = null
    if (!supportPay
      && physicalStorePolicy !== STORE_PAYROLL_POLICY.UNSUPPORTED
      && storeEmploymentType === STORE_EMPLOYMENT_TYPE.FULL_TIME) {
      try {
        configuredSalary = effectiveStoreSalaryConfig(state.storeEmployeeSalaryConfigs, {
          employeeId,
          storeId,
          period,
          store: payrollUnit,
          canonicalOwnerAliases: true,
        })
      } catch (error) {
        if (error?.code !== STORE_SALARY_CONFIG_IDENTIFIER_COLLISION) throw error
        throw new ApiError(
          409,
          STORE_SALARY_CONFIG_IDENTIFIER_COLLISION,
          'Nhân viên đang có nhiều cấu hình lương cùng kỳ với mã chỉ khác chữ hoa/thường; cần xử lý dữ liệu trước khi tính lương.',
          error.details,
        )
      }
    }
    if (!supportPay
      && physicalStorePolicy !== STORE_PAYROLL_POLICY.UNSUPPORTED
      && storeEmploymentType === STORE_EMPLOYMENT_TYPE.FULL_TIME
      && !configuredSalary
      && employee.storeSalaryConfigRequired === true) {
      throw new ApiError(409, 'STORE_SALARY_CONFIG_REQUIRED', 'Nhân viên Full-Time chưa được cài đặt lương cho kỳ này.', {
        employeeId,
        storeId,
        period,
      })
    }
    const tieredSalaryConfig = configuredSalary || (
      !supportPay
      && physicalStorePolicy !== STORE_PAYROLL_POLICY.UNSUPPORTED
      && storeEmploymentType === STORE_EMPLOYMENT_TYPE.FULL_TIME
        ? {
            ...defaultStoreTieredRates(payrollUnit),
            employeeId,
            storeId,
            employmentType: STORE_EMPLOYMENT_TYPE.FULL_TIME,
            effectiveFrom: null,
            version: 1,
          }
        : null
    )
    const tieredPay = tieredSalaryConfig
      ? calculateStoreEmployeeBasePay({
          store: payrollUnit,
          employeeId,
          employmentType: STORE_EMPLOYMENT_TYPE.FULL_TIME,
          workedHours: hours,
          salaryConfig: tieredSalaryConfig,
        })
      : null
    const payBasis = String(employee.payBasis || employee.salaryBasis || (
      normalizeTextKey(employee.employmentType).includes('part') ? 'hourly' : 'monthly'
    )).toLowerCase()
    const hourlyRate = Number(employee.hourlyRate ?? (payBasis === 'hourly' ? employee.salary : 0) ?? 0)
    const monthlySalary = Number(employee.monthlySalary ?? (payBasis === 'monthly' ? employee.salary : 0) ?? 0)
    const requiredWorkingDays = snapshottedRequiredWorkingDaysFor(
      state,
      employee,
      employeeId,
      storeId,
      period,
    )
    const configuredBaseSalary = Number(employee.baseSalary ?? monthlySalary)
    const monthlyBase = Math.max(0, Number.isSafeInteger(configuredBaseSalary)
      ? configuredBaseSalary
      : Math.trunc(configuredBaseSalary || 0))
    const requiredMonthlyHours = validRequiredMonthlyHours(employee.requiredMonthlyHours)
    const sm234HoursFormula = String(payrollUnit.unit || 'store') === 'store'
      && isSecondMallSm234Store(payrollUnit)
      && normalizeTextKey(employee.employmentType) === 'full-time'
      && Boolean(requiredMonthlyHours)
    const base = supportPay ? supportPay.base : tieredPay
      ? tieredPay.amountVnd
      : payBasis === 'hourly'
      ? Math.floor(hours * (Number.isFinite(hourlyRate) && hourlyRate > 0 ? hourlyRate : 0))
      : (sm234HoursFormula
          ? Math.floor((hours / requiredMonthlyHours) * monthlyBase)
          : (attendanceProratedPayroll
          ? Math.floor(monthlyBase * Math.min(requiredWorkingDays, Math.max(0, workedDays)) / requiredWorkingDays)
          : monthlyBase))
    const baseAllowance = supportPay
      ? Number(supportPay.allowance || 0)
      : (Number.isSafeInteger(Number(employee.tiktokAllowance)) ? Number(employee.tiktokAllowance) : 0)
    const adjustment = supportPay ? 0 : adjustmentAmountFor(state, employeeId, period)
    const compensation = supportPay
      ? { manual: 0, work: 0, allowance: 0, revenue: 0 }
      : compensationAmountTotalsFor(state, employeeId, period)
    const legacyBonus = Math.max(0, adjustment)
    const legacyDeduction = Math.max(0, -adjustment)
    const manualBonusVnd = safeMoneySum(compensation.manual, legacyBonus, 'Tổng thưởng thủ công')
    const workBonusVnd = compensation.work
    const revenueBonusVnd = compensation.revenue
    const bonusVnd = [manualBonusVnd, workBonusVnd, revenueBonusVnd]
      .reduce((sum, value) => safeMoneySum(sum, value, 'Tổng thưởng'), 0)
    const allowanceVnd = safeMoneySum(baseAllowance, compensation.allowance, 'Tổng phụ cấp')
    const violationVnd = safeMoneySum(
      supportPay ? 0 : violationAmountFor(state, employeeId, period),
      legacyDeduction,
      'Tổng vi phạm/khấu trừ',
    )
    if (![base, allowanceVnd, bonusVnd, violationVnd].every(Number.isSafeInteger)) {
      throw new ApiError(409, 'PAYROLL_DATA_INVALID', `Số liệu lương của ${employeeId} không hợp lệ.`)
    }
    const violationSettlement = applyViolationWaterfall({
      salaryVnd: Math.max(0, base),
      bonusVnd,
      allowanceVnd,
      violationVnd,
    })
    const advancesPaid = supportPay ? 0 : paidAdvancesFor(state, employeeId, period)
    const advanceSettlement = applyAdvanceToNetPay({
      netPayVnd: violationSettlement.netPayVnd,
      advanceVnd: advancesPaid,
    })
    const gross = violationSettlement.grossPayVnd
    if (!Number.isSafeInteger(gross) || !Number.isSafeInteger(advancesPaid)) {
      throw new ApiError(409, 'PAYROLL_DATA_INVALID', `Tổng lương của ${employeeId} vượt quá giới hạn an toàn.`)
    }
    return {
      employeeId,
      employeeName: employee.name || employee.displayName || employeeId,
      hours,
      workedDays,
      requiredWorkingDays: attendanceProratedPayroll ? requiredWorkingDays : null,
      baseSalary: base,
      gross,
      manualBonusVnd,
      workBonusVnd,
      revenueBonusVnd,
      bonusVnd,
      allowanceVnd,
      violationVnd,
      appliedViolationVnd: violationSettlement.appliedViolationVnd,
      remainingViolationReceivableVnd: violationSettlement.remainingReceivableVnd,
      advancesPaid,
      ...(supportPay ? {
        supportTransferIds: supportPay.transfers.map((record) => record.id),
        supportHourlyPay: supportPay.base,
        supportAllowance: supportPay.allowance,
        supportActualPay: supportPay.totalPay,
        supportCompensation: {
          hours: supportPay.hours,
          basePay: supportPay.base,
          allowance: supportPay.allowance,
          totalPay: supportPay.totalPay,
          transferIds: supportPay.transfers.map((record) => record.id),
        },
        supportDetails: supportPay.details,
      } : {}),
      remaining: advanceSettlement.netPayVnd,
      netPayVnd: advanceSettlement.netPayVnd,
      netPayBeforeAdvanceVnd: advanceSettlement.netPayBeforeAdvanceVnd,
      appliedAdvanceVnd: advanceSettlement.appliedAdvanceVnd,
      unappliedAdvanceVnd: advanceSettlement.unappliedAdvanceVnd,
      salarySnapshot: {
        salary: employee.salary ?? null,
        monthlySalary: employee.monthlySalary ?? null,
        baseSalary: employee.baseSalary ?? null,
        hourlyRate: employee.hourlyRate ?? null,
        requiredMonthlyHours: employee.requiredMonthlyHours ?? null,
        tiktokAllowance: employee.tiktokAllowance ?? 0,
        standardWorkDays: attendanceProratedPayroll ? requiredWorkingDays : (employee.standardWorkDays ?? null),
        proratedByWorkedDays: attendanceProratedPayroll && payBasis === 'monthly',
        payFormula: tieredPay
          ? STORE_PAYROLL_MODEL.FULL_TIME_TIERED
          : (sm234HoursFormula ? 'monthly-hours' : (employee.payFormula ?? null)),
        proratedByActualHours: Boolean(tieredPay || sm234HoursFormula),
        ...(tieredPay ? {
          salaryConfigSource: configuredSalary ? 'configured' : 'legacy-default',
          storePolicy: tieredPay.storePolicy,
          workedSeconds: tieredPay.workedSeconds,
          standardHours: tieredPay.standardHours,
          excessHours: tieredPay.excessHours,
          salaryConfig: tieredPay.salaryConfigSnapshot,
        } : {}),
      },
    }
  })
  const recognizedSupportExpense = rows.reduce((sum, row) => {
    if (!row.supportCompensation) return sum
    const accrued = recognizedSupportCompensationFor(state, storeId, row.employeeId, row.supportDetails)
    if (accrued > row.supportActualPay) {
      throw new ApiError(409, 'SUPPORT_PAYROLL_ACCRUAL_MISMATCH', 'Chi phí lương hỗ trợ đã ghi nhận lớn hơn lương theo chấm công.', {
        employeeId: row.employeeId,
        expectedAmount: row.supportActualPay,
        accruedAmount: accrued,
      })
    }
    return safeMoneySum(sum, accrued, 'Chi phí lương hỗ trợ đã ghi nhận')
  }, 0)
  const employeePayrollExpense = rows.reduce((sum, row) => safeMoneySum(
    sum,
    Math.max(0, asVnd(row.gross ?? 0, 'Tổng lương') - asVnd(row.appliedViolationVnd ?? 0, 'Vi phạm đã áp dụng')),
    'Chi phí lương trong kỳ',
  ), 0)
  if (recognizedSupportExpense > employeePayrollExpense) {
    throw new ApiError(409, 'PAYROLL_ACCRUAL_MISMATCH', 'Chi phí lương hỗ trợ đã ghi nhận lớn hơn tổng lương của kỳ.')
  }
  const employeeNetPayrollExpense = employeePayrollExpense - recognizedSupportExpense
  const nonPayrollExpense = recognizedExpensesFor(state, storeId, period, {
    excludeSourceTypes: [
      'payroll-accrual',
      'payroll-payment',
      'salary-advance',
      'support-attendance-compensation',
    ],
  })
  const recognizedExpense = safeMoneySum(nonPayrollExpense, recognizedSupportExpense, 'Chi phí đã ghi nhận trong kỳ')
  const supportAccrualGap = rows.reduce((sum, row) => (
    row.supportCompensation
      ? safeMoneySum(
          sum,
          Math.max(0, asVnd(row.supportActualPay ?? 0, 'Lương hỗ trợ')
            - recognizedSupportCompensationFor(state, storeId, row.employeeId, row.supportDetails)),
          'Chi phí lương hỗ trợ còn thiếu trong kỳ',
        )
      : sum
  ), 0)
  const expenseBeforeManagerCompensation = [nonPayrollExpense, recognizedSupportExpense, employeeNetPayrollExpense]
    .reduce((sum, value) => safeMoneySum(sum, value, 'Tổng chi phí trước thưởng quản lý'), 0)
  const profitBeforeManagerCompensation = safeMoneySum(
    revenue,
    -expenseBeforeManagerCompensation,
    'Lợi nhuận trước thưởng quản lý',
  )
  const managerRevenueBonus = String(payrollUnit.unit || 'store') === 'store'
    ? managerRevenueBonusFor(state, storeId, period, profitBeforeManagerCompensation)
    : null
  const managerCompensationExpense = managerRevenueBonus?.managerCompensationVnd || 0
  const managerRevenueBonusVnd = managerRevenueBonus?.bonusVnd || 0
  const totalManagerExpense = managerRevenueBonus?.totalManagerExpenseVnd || 0
  const earnedPayrollExpense = safeMoneySum(
    employeePayrollExpense,
    totalManagerExpense,
    'Tổng chi phí lương, thưởng và phụ cấp',
  )
  const netPayrollExpense = safeMoneySum(
    employeeNetPayrollExpense,
    totalManagerExpense,
    'Chi phí lương, thưởng và phụ cấp cần ghi nhận',
  )
  const expense = safeMoneySum(expenseBeforeManagerCompensation, totalManagerExpense, 'Tổng chi phí trong kỳ')
  const profit = managerRevenueBonus
    ? managerRevenueBonus.finalProfitVnd
    : safeMoneySum(revenue, -expense, 'Lợi nhuận trong kỳ')
  if (![revenue, expense, profit, managerCompensationExpense, managerRevenueBonusVnd].every(Number.isSafeInteger)) {
    throw new ApiError(409, 'FINANCE_DATA_INVALID', 'Số liệu tài chính trong kỳ vượt quá giới hạn an toàn.')
  }
  return {
    rows,
    managerRevenueBonus,
    financeSnapshot: {
      revenue,
      expense,
      profit,
      recognizedExpense,
      nonPayrollExpense,
      earnedPayrollExpense,
      recognizedSupportExpense,
      netPayrollExpense,
      supportAccrualGap,
      employeePayrollExpense,
      employeeNetPayrollExpense,
      managerCompensationExpense,
      managerRevenueBonusVnd,
      totalManagerExpense,
      profitBeforeManagerCompensation,
      profitBeforeManagerBonusVnd: managerRevenueBonus?.profitBeforeManagerBonusVnd ?? profitBeforeManagerCompensation,
    },
    policySnapshot: { compensationPolicyVersion: 1 },
  }
}

const vietnamBusinessTimestamp = (date, time) => {
  const timestamp = new Date(`${date}T${time}:00+07:00`)
  if (!Number.isFinite(timestamp.getTime())) {
    throw new ApiError(400, 'ATTENDANCE_TIME_INVALID', 'Ngày giờ chấm công không hợp lệ.')
  }
  return timestamp.toISOString()
}

const attendanceUpdateCommand = async (db, actor, body, commandContext) => {
  if (!['admin', 'business_support'].includes(actor.role)) {
    throw new ApiError(403, 'ROLE_FORBIDDEN', 'Chỉ Admin hoặc Nhân viên hỗ trợ KD được chỉnh sửa thời gian chấm công.')
  }
  if (body.type !== 'attendance.update') {
    throw new ApiError(400, 'COMMAND_UNKNOWN', 'Lệnh chỉnh sửa chấm công không được hỗ trợ.')
  }
  const payload = isPlainRecord(body.payload) ? body.payload : {}
  if (['employeeId', 'storeId', 'shiftId', 'shift'].some((field) => payload[field] !== undefined)) {
    throw new ApiError(400, 'ATTENDANCE_SCOPE_IMMUTABLE', 'Không được thay đổi nhân viên, cửa hàng hoặc ca liên kết của chấm công.')
  }
  const reason = String(payload.reason || '').trim()
  if (!reason || reason.length > 500) {
    throw new ApiError(400, 'REASON_REQUIRED', 'Cần nhập lý do chỉnh sửa từ 1 đến 500 ký tự.')
  }
  const requestedAttendanceId = String(payload.attendanceId || payload.id || '').trim()
  if (!requestedAttendanceId) throw new ApiError(400, 'ATTENDANCE_ID_REQUIRED', 'Cần chọn bản ghi chấm công.')
  const { current, state } = await loadGlobalCommandState(db, body)
  const attendance = Array.isArray(state.attendance) ? state.attendance : []
  const previousMatch = uniqueIdentifierRecordMatch({
    records: attendance,
    identifier: requestedAttendanceId,
    predicate: (record) => !record.deletedAt,
    collisionCode: 'ATTENDANCE_IDENTIFIER_COLLISION',
    collisionMessage: 'Mã chấm công đang trùng với nhiều bản ghi; không thể chỉnh sửa an toàn.',
  })
  const previous = previousMatch?.record || null
  if (!previous) throw new ApiError(404, 'ATTENDANCE_NOT_FOUND', 'Không tìm thấy bản ghi chấm công.')
  const attendanceId = String(previous.id || requestedAttendanceId).trim()
  const attendanceReferenceMatches = (reference) => mutationIdentifierReferenceMatchesRecord({
    records: attendance,
    record: previous,
    reference,
    collisionCode: 'ATTENDANCE_REFERENCE_COLLISION',
    collisionMessage: 'Một liên kết đang tham chiếu mơ hồ tới nhiều bản chấm công; không thể chỉnh sửa an toàn.',
  })
  const storeId = String(previous.storeId || '').trim()
  const employeeId = employeeReference(previous)
  if (!storeId || !employeeId) {
    throw new ApiError(409, 'ATTENDANCE_SCOPE_INVALID', 'Bản ghi chấm công thiếu liên kết nhân viên hoặc cửa hàng.')
  }
  const employeeRecords = [
    ...(Array.isArray(state.employees) ? state.employees : []),
    ...(Array.isArray(state.deletedEmployees) ? state.deletedEmployees : []),
  ]
  const linkedEmployee = uniqueEmployeeIdentifierRecordMatch({
    records: employeeRecords,
    identifier: employeeId,
  })?.record || null
  const linkedTransfer = linkedSupportTransferForAttendance(state, previous, employeeId, storeId)
  const transferRecords = Array.isArray(state.supportTransfers) ? state.supportTransfers : []
  const transferReferenceMatches = (reference) => Boolean(linkedTransfer) && mutationIdentifierReferenceMatchesRecord({
    records: transferRecords,
    record: linkedTransfer,
    reference,
    collisionCode: 'SUPPORT_TRANSFER_REFERENCE_COLLISION',
    collisionMessage: 'Một liên kết đang tham chiếu mơ hồ tới nhiều phiếu điều chuyển; không thể tính lại an toàn.',
  })
  const linkedTransferBounds = linkedTransfer ? supportTransferTimeBounds(linkedTransfer) : null
  if (previous.supportTransferId && (!linkedTransfer || !linkedTransferBounds)) {
    throw new ApiError(
      409,
      'SUPPORT_TRANSFER_TIME_INVALID',
      'Bản ghi chấm công hỗ trợ thiếu phiếu điều chuyển hoặc thời gian điều chuyển hợp lệ.',
    )
  }
  if (actor.role === 'business_support') {
    assertOperationalStoreAccess(actor, storeId)
    const homeStoreAttendance = sameIdentifier(linkedEmployee?.storeId, storeId)
    if (!linkedEmployee
      || employeeUnit(linkedEmployee) !== 'store'
      || (!homeStoreAttendance && !linkedTransfer)) {
      throw new ApiError(403, 'ATTENDANCE_STORE_EMPLOYEE_ONLY', 'Nhân viên hỗ trợ KD chỉ được chỉnh chấm công của nhân viên cửa hàng.')
    }
  }

  const submittedDateEntries = ['date', 'workDate', 'attendanceDate']
    .filter((field) => payload[field] !== undefined)
    .map((field) => [field, optionalCalendarDate(payload[field], 'Ngày chấm công')])
  const distinctSubmittedDates = [...new Set(submittedDateEntries.map(([, value]) => value))]
  if (distinctSubmittedDates.length > 1) {
    throw new ApiError(400, 'ATTENDANCE_DATE_CONFLICT', 'Các trường ngày chấm công phải có cùng giá trị.')
  }
  const previousDate = optionalCalendarDate(dateFromRecord(previous), 'Ngày chấm công hiện tại')
  const date = distinctSubmittedDates[0] || previousDate
  const linkedCollections = []
  const linkedProgress = (Array.isArray(state.workCatalogProgress) ? state.workCatalogProgress : [])
    .some((record) => attendanceReferenceMatches(record.attendanceId))
  const linkedWorkReward = (Array.isArray(state.compensationEntries) ? state.compensationEntries : [])
    .some((record) => (
      attendanceReferenceMatches(record.attendanceId)
      && (String(record.sourceType || '') === 'work-catalog-claim'
        || (String(record.type || '').toUpperCase() === 'WORK' && Boolean(record.catalogItemId)))
    ))
  const linkedViolation = (Array.isArray(state.violations) ? state.violations : [])
    .some((record) => attendanceReferenceMatches(record.attendanceId))
  if (linkedProgress) linkedCollections.push('workCatalogProgress')
  if (linkedWorkReward) linkedCollections.push('compensationEntries')
  if (linkedViolation) linkedCollections.push('violations')
  const linkedDateMutation = linkedCollections.length && (
    date !== previousDate
    || submittedDateEntries.some(([field, value]) => (
      value && value !== String(previous[field] || previousDate)
    ))
  )
  if (linkedDateMutation) {
    throw new ApiError(
      409,
      'ATTENDANCE_DATE_LINKED_COMPENSATION',
      'Không thể đổi ngày chấm công đã liên kết thưởng hoặc vi phạm; các nội dung khác vẫn có thể chỉnh sửa.',
      { attendanceId, linkedCollections },
    )
  }
  const checkIn = parseShiftTime(payload.checkIn ?? payload.checkInTime ?? previous.checkIn ?? previous.checkInTime)
  if (!checkIn) throw new ApiError(400, 'ATTENDANCE_TIME_INVALID', 'Giờ vào phải theo định dạng 24 giờ HH:mm.')
  const previousCheckOut = previous.checkOut ?? previous.checkOutTime
    ?? (previous.checkOutAt ? localDateTimeParts(previous.checkOutAt).time : '')
  const requestedCheckOut = payload.checkOut !== undefined ? payload.checkOut : payload.checkOutTime
  if (requestedCheckOut !== undefined && !String(requestedCheckOut || '').trim() && previous.checkOutAt) {
    throw new ApiError(400, 'ATTENDANCE_CHECK_OUT_REQUIRED', 'Không thể xóa giờ ra của ca đã kết thúc.')
  }
  const checkOut = parseShiftTime(requestedCheckOut === undefined ? previousCheckOut : requestedCheckOut)
  if ((requestedCheckOut === undefined ? previousCheckOut : requestedCheckOut) && !checkOut) {
    throw new ApiError(400, 'ATTENDANCE_TIME_INVALID', 'Giờ ra phải theo định dạng 24 giờ HH:mm.')
  }
  if (checkOut && !linkedTransferBounds && checkOut.minuteOfDay <= checkIn.minuteOfDay) {
    throw new ApiError(400, 'ATTENDANCE_TIME_ORDER_INVALID', 'Giờ ra phải sau giờ vào trong cùng ngày làm việc.')
  }

  const previousPeriod = monthFromRecord(previous)
  const nextPeriod = date.slice(0, 7)
  const payrollTargets = [...new Map([
    { storeId, period: previousPeriod },
    { storeId, period: nextPeriod },
    ...(linkedTransfer ? linkedAttendanceForSupportTransfer(state, linkedTransfer).map((record) => ({
      storeId,
      period: monthFromRecord(record),
    })) : []),
  ].map((target) => [`${target.storeId}:${target.period}`, target])).values()]
  for (const target of payrollTargets) assertPayrollNotPaidOrLocked(state, target.storeId, target.period)

  const checkInAt = vietnamBusinessTimestamp(date, checkIn.label)
  const checkOutDate = checkOut && linkedTransferBounds && checkOut.minuteOfDay <= checkIn.minuteOfDay
    ? shiftCalendarDate(date, 1)
    : date
  const checkOutAt = checkOut ? vietnamBusinessTimestamp(checkOutDate, checkOut.label) : null
  const checkInMs = Date.parse(checkInAt)
  const checkOutMs = checkOutAt ? Date.parse(checkOutAt) : null
  if (linkedTransferBounds && (
    checkInMs < linkedTransferBounds.startMs
    || checkInMs >= linkedTransferBounds.endMs
    || (checkOutMs != null && (checkOutMs <= checkInMs || checkOutMs > linkedTransferBounds.endMs))
  )) {
    throw new ApiError(
      400,
      'ATTENDANCE_TRANSFER_BOUNDS_INVALID',
      'Thời gian chấm công phải nằm hoàn toàn trong thời gian điều chuyển đã thiết lập.',
      { startAt: linkedTransferBounds.startAt, endAt: linkedTransferBounds.endAt },
    )
  }
  const payableCheckOutMs = checkOutMs == null
    ? null
    : (linkedTransferBounds ? Math.min(checkOutMs, linkedTransferBounds.endMs) : checkOutMs)
  const workedSeconds = payableCheckOutMs == null ? 0 : Math.floor((payableCheckOutMs - checkInMs) / 1000)
  if (!Number.isSafeInteger(workedSeconds) || workedSeconds < 0 || workedSeconds >= 24 * 60 * 60) {
    throw new ApiError(400, 'ATTENDANCE_DURATION_INVALID', 'Thời lượng chấm công phải lớn hơn 0 và nhỏ hơn 24 giờ.')
  }
  const linkedShift = uniqueShiftDefinitionMatch(
    Array.isArray(state.shiftDefinitions) ? state.shiftDefinitions : [],
    previous.shiftId || previous.shift,
  )
  const shiftStart = parseShiftTime(previous.shiftStart) || shiftTimes(linkedShift).start
  const shiftEnd = parseShiftTime(previous.shiftEnd) || shiftTimes(linkedShift).end
  if (!shiftStart) throw new ApiError(409, 'ATTENDANCE_SHIFT_INVALID', 'Bản ghi chấm công thiếu giờ bắt đầu ca.')
  const minutesFromStart = linkedTransferBounds
    ? Math.floor((checkInMs - linkedTransferBounds.startMs) / 60_000)
    : checkIn.minuteOfDay - shiftStart.minuteOfDay
  const lateTolerance = Math.trunc(await policyNumber(db, 'late_tolerance_minutes', 10))
  const officeAttendance = officeLikeEmployee(previous) || previous.attendanceMode === 'office'
  const requiredWorkingDays = validRequiredWorkingDays(previous.requiredWorkingDaysSnapshot)
    || validRequiredWorkingDays(previous.standardWorkDaysSnapshot)
    || requiredWorkingDaysForEmployee(linkedEmployee, date.slice(0, 7))
  const arrivalTag = minutesFromStart < 0
    ? 'Đi sớm'
    : (minutesFromStart <= lateTolerance ? 'Đi đúng giờ' : 'Đi trễ')
  const departureTag = !checkOut
    ? 'Chưa ra về'
    : (linkedTransferBounds
        ? (checkOutMs < linkedTransferBounds.endMs ? 'Về sớm' : 'Đã ra về')
        : (shiftEnd && checkOut.minuteOfDay < shiftEnd.minuteOfDay ? 'Về sớm' : 'Đã ra về'))
  const nextBase = {
    ...previous,
    ...(linkedCollections.length ? {
      ...(Object.hasOwn(previous, 'date') ? { date: previous.date } : {}),
      ...(Object.hasOwn(previous, 'workDate') ? { workDate: previous.workDate } : {}),
      ...(Object.hasOwn(previous, 'attendanceDate') ? { attendanceDate: previous.attendanceDate } : {}),
    } : { date, workDate: date, attendanceDate: date }),
    checkIn: checkIn.label,
    checkInTime: checkIn.label,
    checkInAt,
    checkOut: checkOut?.label || null,
    checkOutTime: checkOut?.label || null,
    checkOutAt,
    arrivalTag,
    departureTag,
    punctuality: arrivalTag,
    status: arrivalTag,
    minutesEarly: Math.max(0, -minutesFromStart),
    minutesLate: Math.max(0, minutesFromStart),
    ...(officeAttendance ? {
      attendanceMode: 'office',
      requiredWorkingDaysSnapshot: requiredWorkingDays,
      standardWorkDaysSnapshot: requiredWorkingDays,
      workdayCredit: checkOut ? 1 : 0,
    } : {}),
    workedSeconds,
    workedMinutes: workedSeconds / 60,
    hours: workedSeconds / 3_600,
    editedAt: commandContext.now,
    editedBy: serverActorSnapshot(actor),
    editReason: reason,
    updatedAt: commandContext.now,
    updatedBy: serverActorSnapshot(actor),
  }
  const attendanceCandidate = attendance.map((record, index) => index === previousMatch.index ? nextBase : record)
  const compensationState = linkedTransfer ? { ...state, attendance: attendanceCandidate } : state
  const nextAttendance = linkedTransfer
    ? attendanceCandidate.map((record) => (
        transferReferenceMatches(record.supportTransferId)
          ? withSupportCompensation(compensationState, record)
          : record
      ))
    : attendanceCandidate
  const next = nextAttendance[previousMatch.index] || nextBase
  let nextExpenseEntries = Array.isArray(state.expenseEntries) ? [...state.expenseEntries] : []
  if (linkedTransfer) {
    for (const supportAttendance of nextAttendance.filter((record) => (
      transferReferenceMatches(record.supportTransferId)
    ))) {
      const compensation = supportAttendance.supportCompensation
      const supportAmount = Number(compensation?.totalPay || 0)
      const supportAttendanceRecord = uniqueIdentifierRecordMatch({
        records: attendance,
        identifier: supportAttendance.id,
        collisionCode: 'ATTENDANCE_IDENTIFIER_COLLISION',
        collisionMessage: 'Mã chấm công đang trùng với nhiều bản ghi; không thể cập nhật chi phí hỗ trợ an toàn.',
      })?.record || null
      if (!supportAttendanceRecord) {
        throw new ApiError(409, 'ATTENDANCE_REFERENCE_NOT_FOUND', 'Không thể xác định bản chấm công gốc để cập nhật chi phí hỗ trợ.')
      }
      const matchingExpenseIndexes = nextExpenseEntries.flatMap((entry, index) => (
        String(entry?.sourceType || '') === 'support-attendance-compensation'
        && mutationIdentifierReferenceMatchesRecord({
          records: attendance,
          record: supportAttendanceRecord,
          reference: entry?.sourceId,
          collisionCode: 'ATTENDANCE_REFERENCE_COLLISION',
          collisionMessage: 'Chi phí hỗ trợ đang tham chiếu mơ hồ tới nhiều bản chấm công; không thể cập nhật an toàn.',
        })
          ? [index]
          : []
      ))
      if (matchingExpenseIndexes.length > 1) {
        throw new ApiError(
          409,
          'SUPPORT_COMPENSATION_EXPENSE_COLLISION',
          'Bản chấm công đang có nhiều chi phí hỗ trợ cùng nguồn; cần đối soát dữ liệu trước khi cập nhật.',
          { attendanceId: supportAttendanceRecord.id },
        )
      }
      const expenseIndex = matchingExpenseIndexes[0] ?? -1
      if (supportAmount > 0) {
        assertAccountingPeriodOpen(state, storeId, monthFromRecord(supportAttendance))
        const expense = {
          ...(expenseIndex >= 0 ? nextExpenseEntries[expenseIndex] : {
            id: `exp_support_${supportAttendance.id}`,
            storeId,
            employeeId,
            attendanceId: supportAttendance.id,
            supportTransferId: linkedTransfer.id,
            type: 'Lương ca hỗ trợ',
            category: 'payroll-support',
            sourceType: 'support-attendance-compensation',
            sourceId: supportAttendance.id,
            createdAt: commandContext.now,
            createdBy: actor.user_id,
          }),
          amount: supportAmount,
          description: `Lương hỗ trợ ${supportAttendance.employeeName || employeeId}: ${compensation.hours} giờ × ${compensation.hourlyRate} đ${compensation.allowance ? ` + ${compensation.allowance} đ phụ cấp` : ''}`,
          recognized: true,
          occurredAt: supportAttendance.checkOutAt || supportAttendance.updatedAt || commandContext.now,
          deletedAt: null,
          voidedAt: null,
          updatedAt: commandContext.now,
          updatedBy: actor.user_id,
        }
        if (expenseIndex >= 0) nextExpenseEntries[expenseIndex] = expense
        else nextExpenseEntries.unshift(expense)
      } else if (expenseIndex >= 0) {
        nextExpenseEntries[expenseIndex] = {
          ...nextExpenseEntries[expenseIndex],
          recognized: false,
          voidedAt: commandContext.now,
          updatedAt: commandContext.now,
          updatedBy: actor.user_id,
        }
      }
    }
  }
  const changedFields = [
    'date', 'checkIn', 'checkInAt', 'checkOut', 'checkOutAt', 'arrivalTag',
    'departureTag', 'minutesEarly', 'minutesLate', 'workdayCredit', 'workedSeconds', 'hours',
    'supportCompensation', 'supportActualPay',
  ].filter((field) => JSON.stringify(next[field]) !== JSON.stringify(previous[field]))
  const auditRecord = {
    id: `ata_${crypto.randomUUID()}`,
    action: 'Sửa',
    attendanceId,
    storeId,
    employeeId,
    before: previous,
    after: next,
    changedFields,
    reason,
    actor: serverActorSnapshot(actor),
    createdAt: commandContext.now,
  }
  const nextState = {
    ...state,
    attendance: nextAttendance,
    expenseEntries: nextExpenseEntries,
    attendanceAudit: [auditRecord, ...(Array.isArray(state.attendanceAudit) ? state.attendanceAudit : [])],
    auditLogs: [auditRecord, ...(Array.isArray(state.auditLogs) ? state.auditLogs : [])],
    payrollPeriods: invalidateClosedPayrollPeriods(state, payrollTargets, commandContext.now, body.type),
    stateVersion: Math.max(1, Number(state.stateVersion) || 1) + 1,
  }
  return commitGlobalStateDomainCommand(db, actor, current, nextState, {
    action: body.type,
    entityType: 'attendance',
    entityId: attendanceId,
    before: previous,
    after: next,
    metadata: { reason, changedFields, storeId, employeeId, payrollTargets },
    response: { command: body.type, attendance: next, audit: auditRecord },
  }, commandContext)
}

const normalizedOperationalResetType = (value) => {
  const normalized = normalizeTextKey(value).replace(/\s+/gu, '_')
  if (['order', 'orders', 'don_hang'].includes(normalized)) return 'orders'
  if (['attendance', 'attendances', 'cham_cong'].includes(normalized)) return 'attendance'
  return ''
}

const recordEmployeeId = (record) => String(record?.employeeId || record?.employeeCode || '').trim()

const ORDER_OPERATIONAL_MUTABLE_FIELDS = Object.freeze([
  'customerName', 'customerPhone', 'customerAge', 'amount', 'paymentMethod',
  'status', 'deletedAt', 'deletedBy', 'deleteReason',
])

const ATTENDANCE_CORRECTION_FIELDS = Object.freeze([
  'date', 'workDate', 'attendanceDate', 'checkIn', 'checkInTime', 'checkInAt',
  'checkOut', 'checkOutTime', 'checkOutAt', 'arrivalTag', 'departureTag',
  'punctuality', 'status', 'minutesEarly', 'minutesLate', 'workedSeconds',
  'workedMinutes', 'hours', 'workdayCredit', 'attendanceMode',
  'requiredWorkingDaysSnapshot', 'standardWorkDaysSnapshot',
  'editedAt', 'editedBy', 'editReason',
])

const restoreAuditedFields = (current, baseline, fields) => {
  const restored = { ...current }
  for (const field of fields) {
    if (Object.hasOwn(baseline, field)) restored[field] = baseline[field]
    else delete restored[field]
  }
  return restored
}

const operationalAuditFingerprint = (record, dataType) => {
  const keys = dataType === 'orders'
    ? [
        'id', 'code', 'storeId', 'employeeId', 'attendanceId', 'customerName',
        'customerPhone', 'customerAge', 'amount', 'paymentMethod', 'status',
        'deletedAt', 'createdAt',
      ]
    : ['id', 'storeId', 'employeeId', 'shiftId', 'shift', ...ATTENDANCE_CORRECTION_FIELDS]
  return JSON.stringify(Object.fromEntries(keys.map((key) => [key, record?.[key] ?? null])))
}

const recordWithinOperationalResetScope = (record, scope) => {
  if (!isPlainRecord(record) || !sameIdentifier(record.storeId, scope.storeId)) return false
  const date = dateFromRecord(record)
  if (!date || date < scope.fromDate || date > scope.toDate) return false
  return !scope.employeeId || sameIdentifier(recordEmployeeId(record), scope.employeeId)
}

const latestRestorableAuditByEntity = (history, options) => {
  const latest = new Map()
  for (const audit of Array.isArray(history) ? history : []) {
    if (!isPlainRecord(audit) || audit.restoredAt || !isPlainRecord(audit.before)) continue
    if (!options.actions.has(String(audit.action || ''))) continue
    if (!String(audit.id || '').trim()) continue
    const entityId = String(audit[options.entityKey] || audit.before.id || '').trim()
    const scopedRecord = isPlainRecord(audit.after) ? audit.after : audit.before
    if (!entityId || !recordWithinOperationalResetScope(scopedRecord, options.scope)) continue
    const current = latest.get(entityId)
    const timestamp = Date.parse(audit.createdAt || '')
    const currentTimestamp = Date.parse(current?.createdAt || '')
    if (!current || (Number.isFinite(timestamp) && (!Number.isFinite(currentTimestamp) || timestamp > currentTimestamp))) {
      latest.set(entityId, audit)
    }
  }
  return latest
}

const attendanceAuditSignature = (audit) => {
  if (!isPlainRecord(audit?.before) || !isPlainRecord(audit?.after)) return ''
  return JSON.stringify([
    String(audit.attendanceId || audit.before.id || ''),
    String(audit.createdAt || ''),
    operationalAuditFingerprint(audit.before, 'attendance'),
    operationalAuditFingerprint(audit.after, 'attendance'),
  ])
}

const legacyAttendanceAuditsForScope = async (db, stateAudits, scope) => {
  const rows = await all(db, `
    SELECT
      id, request_id, actor_id, actor_role, entity_id,
      before_json, after_json, metadata_json, server_timestamp
    FROM audit_log
    WHERE action = 'attendance.update' AND entity_type = 'attendance'
      AND LOWER(json_extract(after_json, '$.storeId')) = LOWER(?)
      AND COALESCE(
        json_extract(after_json, '$.workDate'),
        json_extract(after_json, '$.attendanceDate'),
        json_extract(after_json, '$.date'),
        substr(json_extract(after_json, '$.createdAt'), 1, 10),
        ''
      ) BETWEEN ? AND ?
      AND (? = '' OR LOWER(COALESCE(
        json_extract(after_json, '$.employeeId'),
        json_extract(after_json, '$.employeeCode'),
        ''
      )) = LOWER(?))
    ORDER BY id DESC
    LIMIT ?
  `, scope.storeId, scope.fromDate, scope.toDate, scope.employeeId, scope.employeeId, MAX_LEGACY_ATTENDANCE_AUDITS)
  const represented = new Set((Array.isArray(stateAudits) ? stateAudits : [])
    .map(attendanceAuditSignature).filter(Boolean))
  const legacy = []
  for (const row of rows) {
    const auditLogId = Number(row.id)
    if (!Number.isSafeInteger(auditLogId) || auditLogId <= 0) continue
    let before
    let after
    let metadata
    try {
      before = sanitizeStateValue(parseStoredJson(row.before_json))
      after = sanitizeStateValue(parseStoredJson(row.after_json))
      metadata = sanitizeStateValue(parseStoredJson(row.metadata_json, {}))
    } catch {
      continue
    }
    if (!isPlainRecord(before) || !isPlainRecord(after)
      || before.truncated === true || after.truncated === true) continue
    const attendanceId = String(row.entity_id || before.id || '').trim()
    if (!attendanceId
      || !sameIdentifier(before.id, attendanceId)
      || !sameIdentifier(after.id, attendanceId)
      || !sameIdentifier(before.storeId, after.storeId)
      || !sameIdentifier(employeeReference(before), employeeReference(after))
      || !recordWithinOperationalResetScope(after, scope)) continue
    const audit = {
      id: `ata_legacy_${auditLogId}`,
      action: 'Sửa',
      attendanceId,
      storeId: String(metadata.storeId || after.storeId || ''),
      employeeId: String(metadata.employeeId || employeeReference(after) || ''),
      before,
      after,
      changedFields: Array.isArray(metadata.changedFields)
        ? metadata.changedFields.map(String).slice(0, 100)
        : [],
      reason: String(metadata.reason || '').slice(0, 500),
      actor: {
        id: row.actor_id ? String(row.actor_id) : null,
        name: 'Nhật ký hệ thống',
        role: VALID_ROLES.has(String(row.actor_role || '')) ? String(row.actor_role) : 'admin',
      },
      createdAt: String(row.server_timestamp || ''),
      legacyAuditLogId: auditLogId,
      legacyRequestId: String(row.request_id || ''),
      source: 'd1-audit-log',
    }
    const signature = attendanceAuditSignature(audit)
    if (!signature || represented.has(signature)) continue
    represented.add(signature)
    legacy.push(audit)
  }
  return legacy
}

const operationalResetCommand = async (db, actor, body, commandContext) => {
  if (actor.role !== 'admin') {
    throw new ApiError(403, 'ROLE_FORBIDDEN', 'Chỉ Admin được khôi phục chỉnh sửa dữ liệu vận hành.')
  }
  if (body.type !== 'operational_reset.restore') {
    throw new ApiError(400, 'COMMAND_UNKNOWN', 'Lệnh khôi phục dữ liệu vận hành không được hỗ trợ.')
  }
  const payload = isPlainRecord(body.payload) ? body.payload : {}
  const dataType = normalizedOperationalResetType(payload.dataType ?? payload.type)
  if (!dataType) {
    throw new ApiError(400, 'OPERATIONAL_RESET_TYPE_INVALID', 'Chỉ có thể khôi phục chỉnh sửa đơn hàng hoặc chấm công.')
  }
  const reason = String(payload.reason || '').trim()
  if (!reason || reason.length > 500) {
    throw new ApiError(400, 'REASON_REQUIRED', 'Cần nhập lý do khôi phục từ 1 đến 500 ký tự.')
  }
  const { current, state } = await loadGlobalCommandState(db, body)
  const requestedStoreId = String(payload.storeId || '').trim()
  assertOperationalStoreAccess(actor, requestedStoreId)
  const store = requireStore(state, requestedStoreId)
  const storeId = String(store.id || requestedStoreId).trim()
  const fromDate = optionalCalendarDate(payload.fromDate ?? payload.startDate ?? payload.date, 'Từ ngày')
  const toDate = optionalCalendarDate(payload.toDate ?? payload.endDate ?? payload.date, 'Đến ngày')
  if (!fromDate || !toDate) {
    throw new ApiError(400, 'OPERATIONAL_RESET_DATE_REQUIRED', 'Cần chọn khoảng ngày khôi phục.')
  }
  monthsInDateRange(fromDate, toDate)
  const requestedEmployeeId = String(payload.employeeId || '').trim()
  let employeeId = requestedEmployeeId
  if (requestedEmployeeId) {
    const employee = [
      ...(Array.isArray(state.employees) ? state.employees : []),
      ...(Array.isArray(state.deletedEmployees) ? state.deletedEmployees : []),
    ].find((record) => [record.id, record.code, record.employeeId]
      .some((candidateId) => sameIdentifier(candidateId, requestedEmployeeId)))
    employeeId = String(employee?.id || employee?.code || employee?.employeeId || requestedEmployeeId).trim()
    const historicalDestinationTransfer = (Array.isArray(state.supportTransfers) ? state.supportTransfers : [])
      .some((record) => (
        supportTransferMatchesEmployeeStore(record, employeeId, storeId)
        && supportTransferOverlapsCalendarRange(record, fromDate, toDate)
      ))
    if (!employee
      || employeeUnit(employee) !== 'store'
      || (!sameIdentifier(employee.storeId, storeId) && !historicalDestinationTransfer)) {
      throw new ApiError(400, 'OPERATIONAL_RESET_EMPLOYEE_INVALID', 'Nhân viên không thuộc cửa hàng đã chọn.')
    }
  }
  const scope = { storeId, fromDate, toDate, employeeId }
  const resetId = `opr_${crypto.randomUUID()}`
  const actorSnapshot = serverActorSnapshot(actor)
  let beforeRecords = []
  let restoredRecords = []
  let sourceAuditIds = []
  let nextState

  if (dataType === 'orders') {
    const orders = Array.isArray(state.orders) ? state.orders : []
    const orderAudit = Array.isArray(state.orderAudit) ? state.orderAudit : []
    const latestAudits = latestRestorableAuditByEntity(orderAudit, {
      actions: new Set(['Sửa', 'Xóa']), entityKey: 'orderId', scope,
    })
    const restorationById = new Map()
    for (const [orderId, audit] of latestAudits) {
      const currentOrder = orders.find((record) => String(record.id || '') === orderId)
      if (!currentOrder) continue
      if (operationalAuditFingerprint(currentOrder, dataType) !== operationalAuditFingerprint(audit.after, dataType)) {
        throw new ApiError(409, 'OPERATIONAL_RESET_STALE_AUDIT', 'Đơn hàng đã thay đổi sau bản chỉnh sửa gần nhất; hãy tải lại dữ liệu trước khi khôi phục.', { entityId: orderId })
      }
      const baseline = audit.before
      const restored = {
        ...restoreAuditedFields(currentOrder, baseline, ORDER_OPERATIONAL_MUTABLE_FIELDS),
        restoredAt: commandContext.now,
        restoredBy: actorSnapshot,
        restoreReason: reason,
        updatedAt: commandContext.now,
        updatedBy: actorSnapshot,
      }
      beforeRecords.push(currentOrder)
      restoredRecords.push(restored)
      sourceAuditIds.push(String(audit.id || ''))
      restorationById.set(orderId, { restored, audit })
    }
    if (!restorationById.size) {
      return recordNoopCommand(db, actor, {
        command: body.type,
        version: Number(current.version),
        reset: { id: null, dataType, scope, restoredCount: 0, restoredIds: [] },
        restoredCount: 0,
        restoredIds: [],
        restored: [],
        existing: true,
      }, 200, commandContext)
    }
    const payrollTargets = [...new Map(restoredRecords.flatMap((restored, index) => [
      { storeId: String(restored.storeId || ''), period: monthFromRecord(restored) },
      { storeId: String(beforeRecords[index].storeId || ''), period: monthFromRecord(beforeRecords[index]) },
    ]).map((target) => [`${target.storeId}:${target.period}`, target])).values()]
    for (const target of payrollTargets) assertPayrollNotPaidOrLocked(state, target.storeId, target.period)
    const nextOrders = orders.map((record) => restorationById.get(String(record.id || ''))?.restored || record)
    const attendanceRows = Array.isArray(state.attendance) ? state.attendance : []
    const affectedAttendanceRows = new Set()
    for (const [orderId, { restored }] of restorationById) {
      const currentOrder = orders.find((record) => String(record.id || '') === orderId)
      for (const attendance of attendanceRows) {
        if (orderBelongsToAttendance(currentOrder, attendance, attendanceRows)
          || orderBelongsToAttendance(restored, attendance, attendanceRows)) {
          affectedAttendanceRows.add(attendance)
        }
      }
    }
    const nextAttendance = attendanceRows.map((attendance) => (
      affectedAttendanceRows.has(attendance)
        ? { ...attendance, ...orderSalesTotals(nextOrders, attendance, attendanceRows), updatedAt: commandContext.now }
        : attendance
    ))
    const restoredAudit = orderAudit.map((audit) => (
      sourceAuditIds.includes(String(audit.id || ''))
        ? { ...audit, restoredAt: commandContext.now, restoredBy: actorSnapshot, resetId }
        : audit
    ))
    const resetAuditRecords = restoredRecords.map((restored, index) => {
      const before = beforeRecords[index]
      const changedFields = [
        ...ORDER_OPERATIONAL_MUTABLE_FIELDS,
      ].filter((field) => JSON.stringify(before[field]) !== JSON.stringify(restored[field]))
      return {
        id: `oda_${crypto.randomUUID()}`,
        action: 'Khôi phục',
        orderId: restored.id,
        orderCode: restored.code,
        storeId,
        before,
        after: restored,
        changedFields,
        revenueBefore: before.deletedAt || before.status === 'Đã xóa' ? 0 : Number(before.amount || 0),
        revenueAfter: restored.deletedAt || restored.status === 'Đã xóa' ? 0 : Number(restored.amount || 0),
        reason,
        actor: actorSnapshot,
        resetId,
        sourceAuditId: sourceAuditIds[index],
        createdAt: commandContext.now,
      }
    })
    const historyRecord = {
      id: resetId, dataType, ...scope, reason, restoredCount: restoredRecords.length,
      restoredIds: restoredRecords.map((record) => record.id), sourceAuditIds,
      createdAt: commandContext.now, createdBy: actorSnapshot,
    }
    nextState = {
      ...state,
      orders: nextOrders,
      attendance: nextAttendance,
      orderAudit: [...resetAuditRecords, ...restoredAudit],
      auditLogs: [...resetAuditRecords, ...(Array.isArray(state.auditLogs) ? state.auditLogs : [])],
      operationalResetHistory: [historyRecord, ...(Array.isArray(state.operationalResetHistory) ? state.operationalResetHistory : [])],
      payrollPeriods: invalidateClosedPayrollPeriods(state, payrollTargets, commandContext.now, body.type),
      stateVersion: Math.max(1, Number(state.stateVersion) || 1) + 1,
    }
  } else {
    const attendance = Array.isArray(state.attendance) ? state.attendance : []
    const stateAttendanceAudit = Array.isArray(state.attendanceAudit) ? state.attendanceAudit : []
    const attendanceAudit = [
      ...stateAttendanceAudit,
      ...await legacyAttendanceAuditsForScope(db, stateAttendanceAudit, scope),
    ]
    const latestAudits = latestRestorableAuditByEntity(attendanceAudit, {
      actions: new Set(['Sửa']), entityKey: 'attendanceId', scope,
    })
    const restorationById = new Map()
    for (const [attendanceId, audit] of latestAudits) {
      const currentAttendance = attendance.find((record) => String(record.id || '') === attendanceId && !record.deletedAt)
      if (!currentAttendance) continue
      if (operationalAuditFingerprint(currentAttendance, dataType) !== operationalAuditFingerprint(audit.after, dataType)) {
        throw new ApiError(409, 'OPERATIONAL_RESET_STALE_AUDIT', 'Chấm công đã thay đổi sau bản chỉnh sửa gần nhất; hãy tải lại dữ liệu trước khi khôi phục.', { entityId: attendanceId })
      }
      const restored = {
        ...restoreAuditedFields(currentAttendance, audit.before, ATTENDANCE_CORRECTION_FIELDS),
        restoredAt: commandContext.now,
        restoredBy: actorSnapshot,
        restoreReason: reason,
        updatedAt: commandContext.now,
        updatedBy: actorSnapshot,
      }
      beforeRecords.push(currentAttendance)
      restoredRecords.push(restored)
      sourceAuditIds.push(String(audit.id || ''))
      restorationById.set(attendanceId, { restored, audit })
    }
    if (!restorationById.size) {
      return recordNoopCommand(db, actor, {
        command: body.type,
        version: Number(current.version),
        reset: { id: null, dataType, scope, restoredCount: 0, restoredIds: [] },
        restoredCount: 0,
        restoredIds: [],
        restored: [],
        existing: true,
      }, 200, commandContext)
    }
    const payrollTargets = [...new Map(restoredRecords.flatMap((restored, index) => [
      { storeId: String(restored.storeId || ''), period: monthFromRecord(restored) },
      { storeId: String(beforeRecords[index].storeId || ''), period: monthFromRecord(beforeRecords[index]) },
    ]).map((target) => [`${target.storeId}:${target.period}`, target])).values()]
    for (const target of payrollTargets) assertPayrollNotPaidOrLocked(state, target.storeId, target.period)
    const restoredAudit = attendanceAudit.map((audit) => (
      sourceAuditIds.includes(String(audit.id || ''))
        ? { ...audit, restoredAt: commandContext.now, restoredBy: actorSnapshot, resetId }
        : audit
    ))
    const resetAuditRecords = restoredRecords.map((restored, index) => {
      const before = beforeRecords[index]
      const changedFields = ATTENDANCE_CORRECTION_FIELDS
        .filter((field) => JSON.stringify(before[field]) !== JSON.stringify(restored[field]))
      return {
        id: `ata_${crypto.randomUUID()}`,
        action: 'Khôi phục',
        attendanceId: restored.id,
        storeId,
        employeeId: recordEmployeeId(restored),
        before,
        after: restored,
        changedFields,
        reason,
        actor: actorSnapshot,
        resetId,
        sourceAuditId: sourceAuditIds[index],
        createdAt: commandContext.now,
      }
    })
    const historyRecord = {
      id: resetId, dataType, ...scope, reason, restoredCount: restoredRecords.length,
      restoredIds: restoredRecords.map((record) => record.id), sourceAuditIds,
      createdAt: commandContext.now, createdBy: actorSnapshot,
    }
    nextState = {
      ...state,
      attendance: attendance.map((record) => restorationById.get(String(record.id || ''))?.restored || record),
      attendanceAudit: [...resetAuditRecords, ...restoredAudit],
      auditLogs: [...resetAuditRecords, ...(Array.isArray(state.auditLogs) ? state.auditLogs : [])],
      operationalResetHistory: [historyRecord, ...(Array.isArray(state.operationalResetHistory) ? state.operationalResetHistory : [])],
      payrollPeriods: invalidateClosedPayrollPeriods(state, payrollTargets, commandContext.now, body.type),
      stateVersion: Math.max(1, Number(state.stateVersion) || 1) + 1,
    }
  }

  const reset = nextState.operationalResetHistory[0]
  return commitGlobalStateDomainCommand(db, actor, current, nextState, {
    action: body.type,
    entityType: 'operational-reset',
    entityId: resetId,
    before: beforeRecords,
    after: restoredRecords,
    metadata: { dataType, scope, reason, sourceAuditIds, restoredCount: restoredRecords.length },
    response: {
      command: body.type,
      reset,
      restoredCount: restoredRecords.length,
      restoredIds: restoredRecords.map((record) => record.id),
      restored: restoredRecords,
    },
  }, commandContext)
}

const STORE_ATTENDANCE_CHECKLIST_REPAIR_VERSION = 1
const CANONICAL_STORE_FIXED_CODE_PREFIX = 'store.fixed.store-checklist-'

function checklistSnapshotForAttendance({
  state,
  shift,
  attendanceId,
  employeeId,
  storeId,
  targetGroup,
  date,
  shiftId,
  checkInTime = null,
  now,
}) {
  assertNoCaseCollidingActiveWorkCatalogIdentifiers(state)
  const times = shiftTimes(shift)
  let definitions
  try {
    definitions = snapshotActiveWorkCatalogItems({
      items: state.workCatalogItems,
      targetGroup,
      storeId: targetGroup === WORK_CATALOG_TARGET.STORE ? storeId : null,
      shiftId,
      shiftName: shift?.name || shift?.shiftName || null,
      shiftStart: times.start?.label || shift?.start || shift?.shiftStart || null,
      shiftEnd: times.end?.label || shift?.end || shift?.shiftEnd || null,
      shiftCheckInTime: checkInTime,
      date,
    })
  } catch (error) {
    throw new ApiError(409, 'WORK_CATALOG_DATA_INVALID', 'Danh mục công việc của ca đang có dữ liệu không hợp lệ.', {
      reason: error instanceof Error ? error.message : String(error),
    })
  }
  const assignmentId = `catalog_checklist_${attendanceId}`
  const tasks = definitions.map((definition, index) => ({
    id: `${attendanceId}_${definition.catalogItemId}`,
    catalogItemId: definition.catalogItemId,
    catalogCode: definition.catalogCode,
    catalogVersion: definition.catalogVersion,
    catalogKind: definition.kind,
    catalogSnapshot: { ...definition },
    checklistTaskId: definition.catalogItemId,
    checklistAttendanceId: attendanceId,
    checklistTemplateId: 'WORK-CATALOG',
    templateId: 'WORK-CATALOG',
    templateVersion: definition.catalogVersion,
    assignmentId,
    storeId,
    employeeId,
    employeeIds: [employeeId],
    date,
    workDate: date,
    shiftId,
    shift: shiftId,
    title: definition.name,
    description: definition.name,
    detail: '',
    amountVnd: definition.amountVnd,
    position: Number(definition.sortOrder || index),
    required: definition.required === true,
    rewardEligible: definition.kind === WORK_CATALOG_KIND.REWARD_TASK,
    active: true,
    completedBy: {},
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  }))
  return {
    template: { id: 'WORK-CATALOG', key: 'work-catalog', name: 'Danh mục công việc', version: 1 },
    assignmentId,
    tasks,
    snapshot: {
      source: 'work-catalog',
      templateId: 'WORK-CATALOG',
      templateKey: 'work-catalog',
      templateName: 'Danh mục công việc',
      templateVersion: 1,
      assignmentId,
      targetGroup,
      storeId: targetGroup === WORK_CATALOG_TARGET.STORE ? storeId : null,
      shiftId,
      shiftName: shift?.name || shift?.shiftName || null,
      capturedAt: now,
      ...(targetGroup === WORK_CATALOG_TARGET.STORE ? {
        storeChecklistRepairVersion: STORE_ATTENDANCE_CHECKLIST_REPAIR_VERSION,
      } : {}),
      tasks: tasks.map((task) => ({
        id: task.id,
        catalogItemId: task.catalogItemId,
        catalogCode: task.catalogCode,
        catalogVersion: task.catalogVersion,
        kind: task.catalogKind,
        templateId: task.templateId,
        position: task.position,
        name: task.title,
        description: task.description,
        amountVnd: task.amountVnd,
        required: task.required,
        optional: !task.required,
        active: task.active,
        version: task.templateVersion,
      })),
    },
  }
}

export function reconcileOpenStoreAttendanceChecklists(state) {
  if (!Array.isArray(state.attendance) || !Array.isArray(state.workCatalogItems)) {
    return state
  }
  try {
    assertNoCaseCollidingOperationalIdentifiers(state)
    assertNoCaseCollidingAttendanceIdentifiers(state)
  } catch (error) {
    if ([
      'EMPLOYEE_IDENTIFIER_COLLISION',
      'STORE_IDENTIFIER_COLLISION',
      'SUPPORT_TRANSFER_IDENTIFIER_COLLISION',
      'ATTENDANCE_IDENTIFIER_COLLISION',
    ].includes(error?.code)) {
      // This repair runs on state reads as well as mutations. Legacy aliases
      // must never be resolved by array order because doing so can attach a
      // store checklist to the wrong employee or store. Preserve the state for
      // an administrator to repair explicitly instead of persisting guesses.
      return state
    }
    throw error
  }
  const employees = Array.isArray(state.employees) ? state.employees : []
  let tasks = Array.isArray(state.tasks) ? state.tasks : []
  let histories = Array.isArray(state.taskAssignmentHistory) ? state.taskAssignmentHistory : []
  const taskRowsByAttendanceId = new Map()
  const retiredTaskRowsByAttendanceId = new Map()
  for (const task of tasks) {
    const attendanceKey = normalizeIdentifierKey(task?.checklistAttendanceId)
    if (!attendanceKey) continue
    const targetMap = task?.deletedAt ? retiredTaskRowsByAttendanceId : taskRowsByAttendanceId
    const rows = targetMap.get(attendanceKey) || []
    rows.push(task)
    targetMap.set(attendanceKey, rows)
  }
  const historyByAssignmentId = new Map()
  const collidingHistoryAssignmentKeys = new Set()
  for (const history of histories) {
    const assignmentKey = normalizeIdentifierKey(history?.assignmentId || history?.id)
    if (!assignmentKey) continue
    if (historyByAssignmentId.has(assignmentKey)) {
      collidingHistoryAssignmentKeys.add(assignmentKey)
      continue
    }
    historyByAssignmentId.set(assignmentKey, history)
  }
  const updatedHistoryByAssignmentId = new Map()
  const newHistories = []
  let changed = false
  const attendance = state.attendance.map((record) => {
    if (!isPlainRecord(record) || record.deletedAt || record.checkOutAt || record.checkOut) return record
    const employeeId = String(record.employeeId || record.employee_id || '').trim()
    const employee = employees.find((candidate) => (
      employeeIdentifierValues(candidate).some((value) => sameIdentifier(value, employeeId))
    ))
    if (!employeeId || !employee || employeeUnit(employee) !== 'store') return record
    const existingSnapshot = isPlainRecord(record.checklistSnapshot) ? record.checklistSnapshot : null
    if (existingSnapshot
      && normalizeIdentifierKey(existingSnapshot.source) !== 'work-catalog'
      && normalizeIdentifierKey(existingSnapshot.templateId) !== 'work-catalog') return record
    const attendanceId = String(record.id || '').trim()
    // Progress mutations are scoped by the store and business date persisted on
    // the attendance row. Never invent either value from the current employee or
    // timestamp: doing so creates checklist tasks that the same attendance cannot
    // subsequently read or update.
    const storeId = String(record.storeId || '').trim()
    const explicitBusinessDate = String(record.date || record.workDate || '').trim()
    const date = /^\d{4}-\d{2}-\d{2}(?:$|T)/u.test(explicitBusinessDate)
      ? explicitBusinessDate.slice(0, 10)
      : ''
    const shiftId = String(record.shiftId || record.shift || '').trim()
    if (!attendanceId || !storeId || !date || !shiftId) return record
    const storedCheckInTime = parseShiftTime(record.checkInTime || record.checkIn)?.label || null
    const checkInAtEpoch = Date.parse(String(record.checkInAt || ''))
    const checkInTime = storedCheckInTime || (Number.isFinite(checkInAtEpoch)
      ? localDateTimeParts(record.checkInAt).time
      : null)
    const capturedAt = existingSnapshot?.capturedAt || record.checkInAt || record.createdAt || `${date}T00:00:00.000Z`
    const assignmentId = String(existingSnapshot?.assignmentId || `catalog_checklist_${attendanceId}`)
    const capturedSnapshotTasks = Array.isArray(existingSnapshot?.tasks)
      ? existingSnapshot.tasks.filter(isPlainRecord)
      : []
    const snapshotAlreadySealed = Number(
      existingSnapshot?.storeChecklistRepairVersion || 0,
    ) >= STORE_ATTENDANCE_CHECKLIST_REPAIR_VERSION
    // A legacy shift id/name is schedule metadata, not proof of an actual
    // check-in. Only a stored check-in time (or valid timestamp) may choose the
    // canonical mandatory-work bucket before the repair is sealed.
    if (!checkInTime && !snapshotAlreadySealed) return record
    const snapshotTaskKind = (task) => String(
      task?.kind || task?.catalogKind || task?.catalogSnapshot?.kind || '',
    ).trim().toUpperCase()
    const capturedHasCanonicalFixedTask = capturedSnapshotTasks.some((task) => (
      snapshotTaskKind(task) === WORK_CATALOG_KIND.FIXED_TASK
      && String(
        task.catalogCode || task.catalogSnapshot?.catalogCode || task.catalogSnapshot?.code || '',
      ).toLocaleLowerCase('en-US').startsWith(CANONICAL_STORE_FIXED_CODE_PREFIX)
    ))
    const capturedNeedsCanonicalRepair = Boolean(
      existingSnapshot
      && !snapshotAlreadySealed
      && capturedSnapshotTasks.length
      && !capturedHasCanonicalFixedTask
    )
    const taskIdentity = (task) => {
      const catalogItemId = String(
        task?.catalogItemId || task?.checklistTaskId || task?.catalogSnapshot?.catalogItemId || '',
      ).trim()
      if (catalogItemId) return `catalog:${normalizeIdentifierKey(catalogItemId)}`
      const id = String(task?.id || '').trim()
      return id ? `id:${normalizeIdentifierKey(id)}` : ''
    }
    const capturedTaskIdentifierCollision = (records) => {
      const seenByType = { catalogItemId: new Map(), taskId: new Map() }
      for (const task of records) {
        const identifiers = {
          catalogItemId: String(
            task?.catalogItemId || task?.checklistTaskId || task?.catalogSnapshot?.catalogItemId || '',
          ).trim(),
          taskId: String(task?.id || '').trim(),
        }
        for (const [type, identifier] of Object.entries(identifiers)) {
          const key = normalizeIdentifierKey(identifier)
          if (!key) continue
          const previous = seenByType[type].get(key)
          if (previous) {
            return { type, normalizedIdentifier: key, conflictingIdentifiers: [previous, identifier] }
          }
          seenByType[type].set(key, identifier)
        }
      }
      return null
    }
    const uniqueTasks = (records) => {
      const seen = new Set()
      return records.filter((task) => {
        const identity = taskIdentity(task)
        if (!identity || seen.has(identity)) return false
        seen.add(identity)
        return true
      })
    }
    const taskRowFromCapturedSnapshot = (snapshotTask, index) => {
      const catalogItemId = String(snapshotTask.catalogItemId || snapshotTask.checklistTaskId || '').trim()
      const id = String(snapshotTask.id || (catalogItemId ? `${attendanceId}_${catalogItemId}` : '')).trim()
      if (!id) return null
      const catalogKind = snapshotTaskKind(snapshotTask)
      const catalogVersion = Math.max(1, Number(snapshotTask.catalogVersion || snapshotTask.version || 1) || 1)
      const title = String(snapshotTask.name || snapshotTask.title || snapshotTask.description || 'Công việc')
      const required = snapshotTask.required === true
      const amountVnd = Math.max(0, Number(snapshotTask.amountVnd || 0) || 0)
      const catalogSnapshot = isPlainRecord(snapshotTask.catalogSnapshot)
        ? { ...snapshotTask.catalogSnapshot }
        : {
            catalogItemId,
            catalogCode: snapshotTask.catalogCode || null,
            catalogVersion,
            kind: catalogKind,
            targetGroup: WORK_CATALOG_TARGET.STORE,
            storeId,
            shiftId,
            name: title,
            amountVnd,
            required,
            effectiveDate: date,
          }
      return {
        id,
        catalogItemId: catalogItemId || null,
        catalogCode: snapshotTask.catalogCode || catalogSnapshot.catalogCode || null,
        catalogVersion,
        catalogKind,
        catalogSnapshot,
        checklistTaskId: catalogItemId || id,
        checklistAttendanceId: attendanceId,
        checklistTemplateId: 'WORK-CATALOG',
        templateId: 'WORK-CATALOG',
        templateVersion: Math.max(1, Number(snapshotTask.version || catalogVersion) || 1),
        assignmentId,
        storeId,
        employeeId,
        employeeIds: [employeeId],
        date,
        workDate: date,
        shiftId,
        shift: shiftId,
        title,
        description: String(snapshotTask.description || title),
        detail: '',
        amountVnd,
        position: Number.isFinite(Number(snapshotTask.position)) ? Number(snapshotTask.position) : index,
        required,
        rewardEligible: catalogKind === WORK_CATALOG_KIND.REWARD_TASK,
        active: snapshotTask.active !== false,
        completedBy: {},
        createdAt: capturedAt,
        updatedAt: capturedAt,
        deletedAt: null,
      }
    }

    const capturedCollision = capturedTaskIdentifierCollision(capturedSnapshotTasks)
    if (capturedCollision) {
      const checklistRepairError = {
        code: 'CHECKLIST_SNAPSHOT_IDENTIFIER_COLLISION',
        message: 'Checklist đã chụp có mã công việc bị trùng; cần xử lý dữ liệu trước khi hệ thống có thể phục hồi checklist.',
        detectedAt: String(record.checklistRepairError?.detectedAt || capturedAt),
        details: capturedCollision,
      }
      if (JSON.stringify(record.checklistRepairError) === JSON.stringify(checklistRepairError)) return record
      changed = true
      return { ...record, checklistRepairError }
    }

    const capturedTaskRows = capturedSnapshotTasks
      .map(taskRowFromCapturedSnapshot)
      .filter(Boolean)
    let targetSnapshotTasks
    let targetTaskRows
    let snapshotBase
    if (existingSnapshot && (
      snapshotAlreadySealed
      || (capturedSnapshotTasks.length && !capturedNeedsCanonicalRepair)
    )) {
      // Once at least one canonical fixed row was captured, the pre-patch snapshot
      // is authoritative: its active catalog may legitimately have contained fewer
      // rows. Never compare that snapshot with today's catalog.
      targetSnapshotTasks = uniqueTasks(capturedSnapshotTasks)
      targetTaskRows = uniqueTasks(capturedTaskRows)
      snapshotBase = existingSnapshot
    } else {
      let checklist
      try {
        checklist = checklistSnapshotForAttendance({
          state,
          shift: {
            id: shiftId,
            name: record.shiftName || shiftId,
            start: record.shiftStart,
            end: record.shiftEnd,
          },
          attendanceId,
          employeeId,
          storeId,
          targetGroup: WORK_CATALOG_TARGET.STORE,
          date,
          shiftId,
          checkInTime,
          now: capturedAt,
        })
      } catch (error) {
        const checklistRepairError = {
          code: String(error?.code || 'WORK_CATALOG_DATA_INVALID'),
          message: String(error?.message || 'Không thể phục hồi checklist bắt buộc cho ca đang mở.'),
          detectedAt: String(record.checklistRepairError?.detectedAt || capturedAt),
        }
        if (JSON.stringify(record.checklistRepairError) === JSON.stringify(checklistRepairError)) return record
        changed = true
        return { ...record, checklistRepairError }
      }
      if (!checklist) return record
      const canonicalFixedTaskRows = checklist.tasks.filter((task) => (
        task.catalogKind === WORK_CATALOG_KIND.FIXED_TASK
        && normalizeIdentifierKey(task.catalogCode).startsWith(CANONICAL_STORE_FIXED_CODE_PREFIX)
      ))
      const canonicalFixedIds = new Set(canonicalFixedTaskRows.map((task) => (
        normalizeIdentifierKey(task.catalogItemId)
      )))
      const canonicalFixedCodes = new Set(canonicalFixedTaskRows.map((task) => (
        normalizeIdentifierKey(task.catalogCode)
      )))
      if (capturedNeedsCanonicalRepair) {
        // The former dynamic-shift bug omitted every canonical fixed row. The legacy
        // snapshot can still contain rewards and/or exact custom-shift work; preserve
        // all of those captured rows and add only the missing canonical checklist.
        const canonicalFixedSnapshotTasks = checklist.snapshot.tasks.filter((task) => (
          canonicalFixedIds.has(normalizeIdentifierKey(task.catalogItemId))
          || canonicalFixedCodes.has(normalizeIdentifierKey(task.catalogCode))
        ))
        if (!canonicalFixedTaskRows.length) return record
        targetSnapshotTasks = uniqueTasks([...canonicalFixedSnapshotTasks, ...capturedSnapshotTasks])
        targetTaskRows = uniqueTasks([...canonicalFixedTaskRows, ...capturedTaskRows])
        snapshotBase = existingSnapshot
      } else {
        // A legacy open attendance without any captured list has no immutable source
        // to recover from. Do not seal a reward-only snapshot when its check-in cannot
        // resolve a canonical bucket; a later audited attendance correction must be
        // allowed to create the complete fixed + reward snapshot.
        if (!canonicalFixedTaskRows.length) return record
        targetSnapshotTasks = uniqueTasks(checklist.snapshot.tasks)
        targetTaskRows = uniqueTasks(checklist.tasks)
        snapshotBase = checklist.snapshot
      }
    }

    if (!snapshotAlreadySealed) {
      // The snapshot being sealed is the immutable source for every later
      // repair. Persist the exact positional/catalog metadata used to build the
      // task rows now, then derive those rows back from that snapshot. Without
      // this normalization the first repair used richer live-catalog metadata
      // while the second repair used the compact snapshot and changed state
      // again.
      targetSnapshotTasks = uniqueTasks(targetSnapshotTasks).map((snapshotTask, index) => {
        const taskRow = taskRowFromCapturedSnapshot(snapshotTask, index)
        return {
          ...snapshotTask,
          position: taskRow?.position ?? index,
          ...(taskRow?.catalogSnapshot ? { catalogSnapshot: { ...taskRow.catalogSnapshot } } : {}),
        }
      })
      targetTaskRows = uniqueTasks(targetSnapshotTasks
        .map(taskRowFromCapturedSnapshot)
        .filter(Boolean))
    }

    const attendanceKey = normalizeIdentifierKey(attendanceId)
    const assignmentKey = normalizeIdentifierKey(assignmentId)
    if (collidingHistoryAssignmentKeys.has(assignmentKey)) {
      // Immutable assignment history must never be selected by folded array
      // order. Preserve every colliding row until an audited repair resolves
      // the identifier collision.
      return record
    }
    const existingChecklistTasks = taskRowsByAttendanceId.get(attendanceKey) || []
    const retiredChecklistTasks = retiredTaskRowsByAttendanceId.get(attendanceKey) || []
    const existingHistory = updatedHistoryByAssignmentId.get(assignmentKey)
      || historyByAssignmentId.get(assignmentKey)
      || null
    const existingHistoryTasks = Array.isArray(existingHistory?.tasks)
      ? existingHistory.tasks
      : []
    const taskIdKey = (task) => normalizeIdentifierKey(task?.id)
    if (new Set(existingChecklistTasks.map(taskIdKey)).size !== existingChecklistTasks.length) {
      // Do not select progress from one of two case-colliding task identifiers.
      // Preserve both rows so the checkout mutation can fail closed and require
      // an explicit administrator repair instead of grafting progress by order.
      return record
    }
    const restoreTaskProgress = (task, survivingTask) => {
      if (!survivingTask) return task
      const restored = { ...task }
      for (const field of [
        'completedBy',
        'completionHistory',
        'done',
        'checked',
        'completed',
        'note',
        'notesByEmployee',
        'updatedAt',
        'updatedBy',
      ]) {
        if (Object.hasOwn(survivingTask, field)) restored[field] = survivingTask[field]
      }
      return restored
    }
    const targetTaskIds = new Set(targetTaskRows.map(taskIdKey).filter(Boolean))
    const targetTaskIdentities = new Set(targetTaskRows.map(taskIdentity).filter(Boolean))
    const belongsToTargetChecklist = (task) => (
      targetTaskIds.has(taskIdKey(task)) || targetTaskIdentities.has(taskIdentity(task))
    )
    const taskCompletedForEmployee = (task) => (
      completedByEmployeeValue(task?.completedBy, employeeId) === true
      || task?.done === true
      || task?.checked === true
      || task?.completed === true
    )
    const progressSourceFor = (target, collections) => {
      const targetId = taskIdKey(target)
      const targetIdentity = taskIdentity(target)
      const candidates = collections.flatMap((collection) => (
        Array.isArray(collection) ? collection : []
      )).filter((candidate) => (
        taskIdKey(candidate) === targetId || taskIdentity(candidate) === targetIdentity
      ))
      const identifiersByFoldedKey = new Map()
      for (const candidate of candidates) {
        const rawIdentifier = String(candidate?.id || '').trim()
        const foldedIdentifier = taskIdKey(candidate)
        if (!rawIdentifier || !foldedIdentifier) continue
        const spellings = identifiersByFoldedKey.get(foldedIdentifier) || new Set()
        spellings.add(rawIdentifier)
        identifiersByFoldedKey.set(foldedIdentifier, spellings)
      }
      const ambiguous = [...identifiersByFoldedKey.values()].some((spellings) => spellings.size > 1)
      return {
        source: ambiguous ? null : (candidates.find(taskCompletedForEmployee) || candidates[0] || null),
        ambiguous,
      }
    }
    const canonicalProgressSources = targetTaskRows.map((task) => progressSourceFor(
      task,
      [existingChecklistTasks, existingHistoryTasks, retiredChecklistTasks],
    ))
    const historyProgressSources = targetTaskRows.map((task) => progressSourceFor(
      task,
      [existingHistoryTasks, existingChecklistTasks, retiredChecklistTasks],
    ))
    if ([...canonicalProgressSources, ...historyProgressSources].some(({ ambiguous }) => ambiguous)) {
      // A case-colliding task in any historical source makes the source of
      // completion unknowable. Preserve the sealed record until an audited
      // collision repair resolves it instead of selecting by array order.
      return record
    }
    const canonicalTaskRows = targetTaskRows.map((task, index) => restoreTaskProgress(
      task,
      canonicalProgressSources[index].source,
    ))
    const canonicalHistoryRows = targetTaskRows.map((task, index) => restoreTaskProgress(
      task,
      historyProgressSources[index].source,
    ))
    const catalogSnapshotMetadataMatches = (actual, expected) => {
      const actualSnapshot = isPlainRecord(actual?.catalogSnapshot) ? actual.catalogSnapshot : null
      const expectedSnapshot = isPlainRecord(expected?.catalogSnapshot) ? expected.catalogSnapshot : null
      if (!expectedSnapshot) return !actualSnapshot
      return Boolean(actualSnapshot)
        && String(actualSnapshot.catalogItemId || '') === String(expectedSnapshot.catalogItemId || '')
        && String(actualSnapshot.catalogCode || '') === String(expectedSnapshot.catalogCode || '')
        && Number(actualSnapshot.catalogVersion || 0) === Number(expectedSnapshot.catalogVersion || 0)
        && String(actualSnapshot.kind || '') === String(expectedSnapshot.kind || '')
        && String(actualSnapshot.name || '') === String(expectedSnapshot.name || '')
        && Number(actualSnapshot.amountVnd || 0) === Number(expectedSnapshot.amountVnd || 0)
        && Boolean(actualSnapshot.required) === Boolean(expectedSnapshot.required)
    }
    const taskMetadataMatches = (actual, expected) => (
      String(actual?.id || '') === String(expected?.id || '')
      && mutationIdentifierReferenceMatchesRecord({
        records: state.attendance,
        record,
        reference: actual?.checklistAttendanceId,
        collisionCode: 'ATTENDANCE_REFERENCE_COLLISION',
        collisionMessage: 'Mã chấm công tham chiếu trong checklist đang mơ hồ; cần xử lý dữ liệu trùng trước khi sửa checklist.',
      })
      && String(actual?.assignmentId || '') === assignmentId
      && String(actual?.storeId || '') === storeId
      && String(actual?.employeeId || '') === employeeId
      && Array.isArray(actual?.employeeIds)
      && actual.employeeIds.length === 1
      && String(actual.employeeIds[0] || '') === employeeId
      && String(actual?.date || '') === date
      && String(actual?.workDate || '') === date
      && String(actual?.shiftId || '') === shiftId
      && String(actual?.shift || '') === shiftId
      && String(actual?.catalogItemId || '') === String(expected?.catalogItemId || '')
      && String(actual?.catalogCode || '') === String(expected?.catalogCode || '')
      && Number(actual?.catalogVersion || 0) === Number(expected?.catalogVersion || 0)
      && String(actual?.catalogKind || '') === String(expected?.catalogKind || '')
      && String(actual?.checklistTaskId || '') === String(expected?.checklistTaskId || '')
      && String(actual?.checklistTemplateId || '') === String(expected?.checklistTemplateId || '')
      && String(actual?.templateId || '') === String(expected?.templateId || '')
      && Number(actual?.templateVersion || 0) === Number(expected?.templateVersion || 0)
      && String(actual?.title || '') === String(expected?.title || '')
      && String(actual?.description || '') === String(expected?.description || '')
      && Number(actual?.amountVnd || 0) === Number(expected?.amountVnd || 0)
      && Number(actual?.position || 0) === Number(expected?.position || 0)
      && Boolean(actual?.required) === Boolean(expected?.required)
      && Boolean(actual?.rewardEligible) === Boolean(expected?.rewardEligible)
      && Boolean(actual?.active) === Boolean(expected?.active)
      && catalogSnapshotMetadataMatches(actual, expected)
    )
    const targetRowsAreCanonical = (currentRows, expectedRows) => {
      const relevantRows = currentRows.filter(belongsToTargetChecklist)
      return relevantRows.length === expectedRows.length
        && expectedRows.every((expected) => relevantRows.some((actual) => taskMetadataMatches(actual, expected)))
    }
    const taskRowsNeedRepair = !targetRowsAreCanonical(existingChecklistTasks, canonicalTaskRows)
    // An empty sealed checklist has no progress to audit. Do not manufacture an
    // empty assignment history during a read-time repair: that would advance the
    // global state version merely because a caller opened the app.
    const historyRowsNeedRepair = targetTaskRows.length > 0 && (
      !existingHistory || !targetRowsAreCanonical(existingHistoryTasks, canonicalHistoryRows)
    )
    const repairErrorNeedsClearing = Boolean(record.checklistRepairError)
    if (snapshotAlreadySealed
      && !taskRowsNeedRepair
      && !historyRowsNeedRepair
      && !repairErrorNeedsClearing) return record

    let recordChanged = false
    if (taskRowsNeedRepair) {
      tasks = [
        ...canonicalTaskRows,
        ...tasks.filter((task) => (
          !sameIdentifier(task?.checklistAttendanceId, attendanceId)
          || !belongsToTargetChecklist(task)
        )),
      ]
      taskRowsByAttendanceId.set(attendanceKey, [
        ...canonicalTaskRows,
        ...existingChecklistTasks.filter((task) => !belongsToTargetChecklist(task)),
      ])
      retiredTaskRowsByAttendanceId.set(
        attendanceKey,
        retiredChecklistTasks.filter((task) => !belongsToTargetChecklist(task)),
      )
      recordChanged = true
    }

    if (existingHistory) {
      if (historyRowsNeedRepair) {
        const repairedHistoryTasks = [
          ...canonicalHistoryRows.map((task) => ({ ...task })),
          ...existingHistoryTasks.filter((task) => !belongsToTargetChecklist(task)),
        ]
        let repairedHistory = { ...existingHistory, tasks: repairedHistoryTasks }
        const targetRequiredTasks = targetTaskRows.filter(workTaskIsRequired)
        const existingRelevantRequiredTasks = existingHistoryTasks.filter((task) => (
          belongsToTargetChecklist(task) && workTaskIsRequired(task)
        ))
        const requiredShapeChanged = existingRelevantRequiredTasks.length !== targetRequiredTasks.length
          || targetRequiredTasks.some((task) => (
            existingRelevantRequiredTasks.filter((candidate) => (
              taskIdKey(candidate) === taskIdKey(task) || taskIdentity(candidate) === taskIdentity(task)
            )).length !== 1
          ))
        if (requiredShapeChanged) {
          const requiredHistoryTasks = repairedHistoryTasks.filter(workTaskIsRequired)
          const completedRequiredTasks = requiredHistoryTasks.filter((task) => (
            completedByEmployeeValue(task.completedBy, employeeId) === true
            || task.done === true
            || task.completed === true
          )).length
          const totalTasks = requiredHistoryTasks.length
          const completionRate = totalTasks
            ? Math.round((completedRequiredTasks / totalTasks) * 100)
            : 0
          const complete = totalTasks > 0 && completedRequiredTasks === totalTasks
          repairedHistory = {
            ...repairedHistory,
            status: complete ? 'completed' : 'assigned',
            totalTasks,
            completedTasks: completedRequiredTasks,
            completionRate,
            incompleteReason: '',
            submittedAt: null,
            completionByEmployee: withCanonicalIdentifierEntry(
              existingHistory.completionByEmployee,
              employeeId,
              {
                completedTasks: completedRequiredTasks,
                totalTasks,
                completionRate,
                requiredTasks: totalTasks,
                completedRequiredTasks,
                incompleteReason: '',
                submittedAt: null,
                attendanceId,
              },
            ),
          }
        }
        updatedHistoryByAssignmentId.set(assignmentKey, repairedHistory)
        recordChanged = true
      }
    } else if (targetTaskRows.length > 0) {
      const newHistory = {
        id: assignmentId,
        assignmentId,
        source: 'store-shift-checklist',
        checklistAttendanceId: attendanceId,
        checklistTemplateId: 'WORK-CATALOG',
        storeId,
        date,
        shiftId,
        employeeIds: [employeeId],
        tasks: canonicalHistoryRows.map((task) => ({ ...task })),
        status: 'assigned',
        createdAt: capturedAt,
        createdBy: { id: 'SYSTEM', name: 'Hệ thống', role: 'system' },
        progressHistory: [],
      }
      newHistories.unshift(newHistory)
      historyByAssignmentId.set(assignmentKey, newHistory)
      recordChanged = true
    }
    const snapshotNeedsSealing = !snapshotAlreadySealed
    if (!recordChanged && !snapshotNeedsSealing && !repairErrorNeedsClearing) return record
    changed = true
    const recordWithoutRepairError = { ...record }
    delete recordWithoutRepairError.checklistRepairError
    if (!snapshotNeedsSealing) return recordWithoutRepairError
    return {
      ...recordWithoutRepairError,
      checklistSnapshot: {
        ...snapshotBase,
        source: 'work-catalog',
        templateId: 'WORK-CATALOG',
        assignmentId,
        storeChecklistRepairVersion: STORE_ATTENDANCE_CHECKLIST_REPAIR_VERSION,
        tasks: targetSnapshotTasks,
      },
    }
  })

  if (updatedHistoryByAssignmentId.size) {
    histories = histories.map((history) => (
      updatedHistoryByAssignmentId.get(normalizeIdentifierKey(history?.assignmentId || history?.id)) || history
    ))
  }
  if (newHistories.length) histories = [...newHistories, ...histories]
  return changed ? { ...state, attendance, tasks, taskAssignmentHistory: histories } : state
}

async function persistOpenStoreAttendanceChecklistRepairs(db, actor, context, currentRow = null, attempt = 0) {
  const current = currentRow || await loadState(db, 'global')
  if (!current) return current
  const normalizedState = normalizeSharedStateForStorage(parseStoredJson(current.value_json, {}))
  const reconciledState = reconcileOpenStoreAttendanceChecklists(normalizedState)
  if (reconciledState === normalizedState) return current
  const repairedState = {
    ...reconciledState,
    stateVersion: Math.max(1, Number(normalizedState.stateVersion) || 1) + 1,
  }

  const currentVersion = Number(current.version || 0)
  const nextVersion = currentVersion + 1
  const requestId = `${context.requestId}:store-checklist-repair:${attempt}`
  const actorId = String(actor?.user_id || actor?.id || 'system')
  const actorRole = String(actor?.role || 'system')
  const changedRecordIds = (before, after, idFromRecord) => {
    const beforeById = new Map((Array.isArray(before) ? before : []).map((record) => [idFromRecord(record), record]))
    return (Array.isArray(after) ? after : [])
      .filter((record) => {
        const id = idFromRecord(record)
        return id && JSON.stringify(canonicalize(beforeById.get(id))) !== JSON.stringify(canonicalize(record))
      })
      .map(idFromRecord)
  }
  const repairedAttendanceIds = [...new Set([
    ...changedRecordIds(normalizedState.attendance, repairedState.attendance, (record) => String(record?.id || '')),
    ...changedRecordIds(normalizedState.tasks, repairedState.tasks, (record) => String(record?.id || ''))
      .map((taskId) => String(repairedState.tasks.find((record) => String(record?.id || '') === taskId)?.checklistAttendanceId || '')),
    ...changedRecordIds(
      normalizedState.taskAssignmentHistory,
      repairedState.taskAssignmentHistory,
      (record) => String(record?.assignmentId || record?.id || ''),
    ).map((assignmentId) => String(repairedState.taskAssignmentHistory.find((record) => (
      String(record?.assignmentId || record?.id || '') === assignmentId
    ))?.checklistAttendanceId || '')),
  ].filter(Boolean))].sort()
  const stateCommit = prepareStateCommit(db, {
    current,
    nextState: repairedState,
    scope: 'global',
    currentVersion,
    nextVersion,
    now: context.now,
    actorId,
    requestId,
  })
  let results
  try {
    results = await db.batch([
      stateCommit.mutation,
      ...stateCommit.externalStatements,
      db.prepare(`
        INSERT INTO audit_log (
          request_id, actor_id, actor_role, action, entity_type, entity_id,
          before_json, after_json, metadata_json, server_timestamp
        )
        SELECT ?, ?, ?, 'attendance.checklist.repair_legacy', 'attendance-checklist', 'open-store-attendance',
               NULL, NULL, ?, ?
        WHERE EXISTS (
          SELECT 1 FROM app_state
          WHERE scope_key = 'global' AND version = ? AND last_request_id = ?
        )
      `).bind(
        requestId,
        actorId,
        actorRole,
        boundedAuditJson({
          fromVersion: currentVersion,
          toVersion: nextVersion,
          repairedAttendanceIds,
        }),
        context.now,
        nextVersion,
        requestId,
      ),
    ])
  } catch {
    if (attempt < 1) {
      return persistOpenStoreAttendanceChecklistRepairs(db, actor, context, null, attempt + 1)
    }
    const latest = await loadState(db, 'global')
    throw new ApiError(409, 'CHECKLIST_REPAIR_CONFLICT', 'Danh sách công việc ca vừa thay đổi; vui lòng tải lại dữ liệu.', {
      currentVersion: Number(latest?.version || 0),
    })
  }
  if (changes(results?.[0]) !== 1) {
    if (attempt < 1) {
      return persistOpenStoreAttendanceChecklistRepairs(db, actor, context, null, attempt + 1)
    }
    const latest = await loadState(db, 'global')
    throw new ApiError(409, 'CHECKLIST_REPAIR_CONFLICT', 'Danh sách công việc ca vừa thay đổi; vui lòng tải lại dữ liệu.', {
      currentVersion: Number(latest?.version || 0),
    })
  }
  const repairedRow = await loadState(db, 'global')
  if (repairedRow) {
    Object.defineProperty(repairedRow, '_storeChecklistRepair', {
      value: Object.freeze({ previousVersion: currentVersion, nextVersion }),
      enumerable: false,
    })
  }
  return repairedRow
}

const attendanceCommand = async (db, actor, body, commandContext) => {
  if (!['employee', 'business_support', 'store_manager'].includes(actor.role)) {
    throw new ApiError(403, 'ROLE_FORBIDDEN', 'Lệnh chấm công trực tiếp chỉ dành cho tài khoản nhân sự.')
  }
  const expectedVersion = commandExpectedVersion(body)
  const current = body._preloadedGlobalStateRow || await loadState(db, 'global')
  const currentVersion = Number(current?.version || 0)
  if (!current || currentVersion !== expectedVersion) {
    throw new ApiError(409, 'VERSION_CONFLICT', 'Dữ liệu đã thay đổi trên máy chủ.', { currentVersion })
  }
  const state = normalizeSharedStateForStorage(parseStoredJson(current.value_json, {}))
  const payload = isPlainRecord(body.payload) ? body.payload : {}
  const employeeId = String(actor.employee_id || actor.user_id || '')
  const storeId = String(actor.store_id || '')
  const employee = (Array.isArray(state.employees) ? state.employees : [])
    .find((record) => sameIdentifier(record.id || record.code, employeeId) && !record.deletedAt)
  const activeTransfer = actor.active_transfer_id
    ? (Array.isArray(state.supportTransfers) ? state.supportTransfers : []).find((record) => (
        sameIdentifier(record.id, actor.active_transfer_id)
        && sameIdentifier(record.employeeId, employeeId)
        && sameIdentifier(record.toStoreId, storeId)
        && !record.deletedAt
        && !['Đã xóa', 'Đã hủy', 'Hoàn tất'].includes(String(record.status || ''))
      ))
    : null
  if (!employee || (!sameIdentifier(employee.storeId, storeId) && !activeTransfer)) {
    throw new ApiError(409, 'EMPLOYEE_PROFILE_MISSING', 'Tài khoản chưa được liên kết với hồ sơ nhân viên hợp lệ.')
  }
  const officeEmployee = officeLikeEmployee(employee)
  const location = normalizeLocation(payload.location, commandContext.now)
  const attendance = Array.isArray(state.attendance) ? state.attendance : []
  const ownOpenRecords = attendance.filter((record) => (
    belongsToEmployee(record, employeeId)
    && !record.deletedAt
    && !record.checkOut
    && !record.checkOutAt
  ))
  const localNow = localDateTimeParts(commandContext.now)

  if (body.type === 'attendance.check_in') {
    if (ownOpenRecords.length) {
      throw new ApiError(409, 'ATTENDANCE_ALREADY_OPEN', 'Bạn đã có một ca làm việc đang mở.', {
        attendanceId: ownOpenRecords[0].id,
      })
    }
    // Reject before creating an attendance row so a paid/locked payroll period
    // can never acquire a new open shift that cannot later be settled safely.
    assertPayrollNotPaidOrLocked(state, storeId, localNow.date.slice(0, 7))
    const dayAssignments = (Array.isArray(state.schedule) ? state.schedule : []).filter((record) => (
      belongsToEmployee(record, employeeId)
      && String(record.date || record.workDate || '') === localNow.date
      && !record.deletedAt
    ))
    const assignedShiftIds = new Set(dayAssignments.flatMap((record) => [
      String(record.shiftId || ''),
      ...(Array.isArray(record.shiftIds) ? record.shiftIds.map(String) : []),
    ]).map(normalizeIdentifierKey).filter(Boolean))
    const activeShifts = (Array.isArray(state.shiftDefinitions) ? state.shiftDefinitions : []).filter((record) => (
      record.active !== false
      && (!record.storeId || sameIdentifier(record.storeId, storeId))
      && (!record.date || String(record.date) === localNow.date)
      && shiftTimes(record).start
      && shiftTimes(record).end
    ))
    assertUniqueShiftDefinitionIdentifiers(activeShifts)
    const profileShifts = officeEmployee ? configuredProfileWorkShifts(employee, localNow.date, state) : []
    const canonicalProfileScheduleEmployee = ['office', 'business_support'].includes(employeeUnit(employee))
    let shiftId = String(payload.shiftId || payload.workShiftId || '').trim()
    // Office and Business Support attendance is resolved exclusively from the
    // server-side effective/daily schedule. A daily assignment can replace a
    // profile shift with a new generated id, so reconcile a stale submitted id
    // only when the canonical schedule is unambiguous. Never use client times.
    let shift = !canonicalProfileScheduleEmployee && shiftId
      ? uniqueShiftDefinitionMatch(activeShifts, shiftId)
      : null
    let activeTransferBounds = null
    if (shiftId && !/^[A-Za-z0-9_-]{1,80}$/u.test(shiftId)) {
      throw new ApiError(400, 'SHIFT_INVALID', 'Cần chọn ca làm việc hợp lệ.')
    }
    if (!shift && officeEmployee && shiftId) {
      shift = uniqueShiftDefinitionMatch(profileShifts, shiftId)
      if (!shift && canonicalProfileScheduleEmployee && profileShifts.length === 1) {
        shift = profileShifts[0]
        shiftId = String(shift.id || '')
      }
    }
    if (shift && !['profile-work-shift', 'office-profile', 'support-daily-schedule'].includes(shift.source)
      && dayAssignments.length && !assignedShiftIds.has(normalizeIdentifierKey(shiftId))) {
      throw new ApiError(403, 'SHIFT_NOT_ASSIGNED', 'Ca này không nằm trong lịch làm việc hôm nay của bạn.')
    }
    // A support transfer is itself the attendance window. Even if a stale or
    // destination schedule is submitted, punctuality must use the exact
    // configured transfer start/end rather than unrelated shift hours.
    if (activeTransfer) {
      activeTransferBounds = supportTransferTimeBounds(activeTransfer)
      const transferStart = activeTransferBounds
        ? parseShiftTime(localDateTimeParts(activeTransferBounds.startAt).time)
        : null
      const transferEnd = activeTransferBounds
        ? parseShiftTime(localDateTimeParts(activeTransferBounds.endAt).time)
        : null
      if (!transferStart || !transferEnd) {
        throw new ApiError(409, 'SUPPORT_TRANSFER_TIME_INVALID', 'Phiếu điều chuyển thiếu thời gian làm việc hợp lệ.')
      }
      shiftId = `SUPPORT_TRANSFER_${activeTransfer.id}`.replace(/[^A-Za-z0-9_-]/gu, '_').slice(0, 80)
      shift = {
        id: shiftId,
        name: 'Ca hỗ trợ cửa hàng',
        storeId,
        start: transferStart.label,
        end: transferEnd.label,
        version: 1,
        source: 'support-transfer',
      }
    }
    if (!shift && officeEmployee && !canonicalProfileScheduleEmployee && !shiftId) {
      shift = activeShifts.find((record) => assignedShiftIds.has(normalizeIdentifierKey(record.id))) || null
      shiftId = String(shift?.id || '')
    }
    if (!shift && officeEmployee && !shiftId) {
      if (profileShifts.length > 1) {
        throw new ApiError(400, 'PROFILE_WORK_SHIFT_REQUIRED', 'Vui lòng chọn ca làm việc trong hồ sơ trước khi điểm danh.')
      }
      shift = profileShifts[0] || null
      shiftId = String(shift?.id || '')
    }
    if (!shift && officeEmployee && !profileShifts.length) {
      throw new ApiError(409, 'OFFICE_WORK_TIME_INVALID', 'Hồ sơ nhân sự thiếu giờ làm việc hợp lệ.')
    }
    const times = shiftTimes(shift)
    if (!shift || !times.start || !times.end) {
      throw new ApiError(400, 'SHIFT_INVALID', 'Ca làm việc không tồn tại hoặc thiếu giờ bắt đầu/kết thúc.')
    }
    if (officeEmployee && attendance.some((record) => (
      belongsToEmployee(record, employeeId)
      && !record.deletedAt
      && dateFromRecord(record) === localNow.date
    ))) {
      throw new ApiError(409, 'OFFICE_ATTENDANCE_ALREADY_RECORDED', 'Bạn đã chấm công trong ngày hôm nay.')
    }
    const currentEpochMs = Date.parse(commandContext.now)
    const minutesFromStart = activeTransferBounds && Number.isFinite(currentEpochMs)
      ? Math.floor((currentEpochMs - activeTransferBounds.startMs) / 60_000)
      : localNow.minuteOfDay - times.start.minuteOfDay
    const earlyLimit = Math.trunc(await policyNumber(db, 'early_check_in_limit_minutes', 120))
    if (minutesFromStart < -earlyLimit) {
      throw new ApiError(409, 'CHECK_IN_TOO_EARLY', `Chỉ được điểm danh sớm tối đa ${earlyLimit} phút.`, {
        minutesUntilStart: Math.abs(minutesFromStart),
        earlyLimitMinutes: earlyLimit,
      })
    }
    const lateTolerance = Math.trunc(await policyNumber(db, 'late_tolerance_minutes', 10))
    const requiredWorkingDays = requiredWorkingDaysForEmployee(employee, localNow.date.slice(0, 7))
    const arrivalTag = minutesFromStart < 0
      ? 'Đi sớm'
      : (minutesFromStart <= lateTolerance ? 'Đi đúng giờ' : 'Đi trễ')
    const attendanceId = `att_${crypto.randomUUID()}`
    const attendanceUnit = employeeUnit(employee)
    const checklistTargetGroup = attendanceUnit === 'office'
      ? WORK_CATALOG_TARGET.OFFICE
      : attendanceUnit === 'business_support'
        ? WORK_CATALOG_TARGET.BUSINESS_SUPPORT
        : attendanceUnit === 'store' ? WORK_CATALOG_TARGET.STORE : null
    const checklist = checklistTargetGroup
      ? checklistSnapshotForAttendance({
          state,
          shift,
          attendanceId,
          employeeId,
          storeId,
          targetGroup: checklistTargetGroup,
          date: localNow.date,
          shiftId,
          checkInTime: localNow.time,
          now: commandContext.now,
        })
      : null
    const record = {
      id: attendanceId,
      date: localNow.date,
      workDate: localNow.date,
      attendanceDate: localNow.date,
      employeeId,
      employeeName: employee.name || actor.display_name,
      storeId,
      homeStoreId: activeTransfer?.fromStoreId || employee.storeId || storeId,
      ...(activeTransfer ? {
        supportTransferId: activeTransfer.id,
        supportTransferSnapshot: {
          id: activeTransfer.id,
          fromStoreId: activeTransfer.fromStoreId,
          fromStoreName: storeNameForId(state, activeTransfer.fromStoreId),
          toStoreId: activeTransfer.toStoreId,
          toStoreName: storeNameForId(state, activeTransfer.toStoreId),
          startAt: activeTransferBounds.startAt,
          endAt: activeTransferBounds.endAt,
          hourlySupportRate: Number(activeTransfer.hourlySupportRate || 0),
          allowance: Number(activeTransfer.allowance || 0),
        },
        supportHourlyRate: Number(activeTransfer.hourlySupportRate || 0),
      } : {}),
      unit: employee.unit || 'store',
      employmentTypeSnapshot: employee.employmentType || null,
      payBasisSnapshot: employee.payBasis || null,
      monthlySalarySnapshot: Number(employee.monthlySalary || 0),
      hourlyRateSnapshot: Number(employee.hourlyRate || 0),
      standardWorkDaysSnapshot: officeEmployee
        ? requiredWorkingDays
        : Number(employee.standardWorkDays || 0),
      ...(officeEmployee ? {
        requiredWorkingDaysSnapshot: requiredWorkingDays,
        workdayCredit: 0,
        attendanceMode: 'office',
      } : {}),
      shift: shiftId,
      shiftId,
      shiftName: shift.name || shiftId,
      shiftStart: times.start.label,
      shiftEnd: times.end.label,
      shiftVersion: Number(shift.version || 1),
      shiftSource: shift.source || (officeEmployee ? 'office-schedule' : 'store-schedule'),
      checkIn: localNow.time,
      checkInTime: localNow.time,
      checkInAt: commandContext.now,
      checkInLocation: location,
      location,
      locationName: location.label || '',
      checkOut: null,
      checkOutTime: null,
      checkOutAt: null,
      checkOutLocation: null,
      arrivalTag,
      departureTag: 'Chưa ra về',
      punctuality: arrivalTag,
      status: arrivalTag,
      minutesEarly: Math.max(0, -minutesFromStart),
      minutesLate: Math.max(0, minutesFromStart),
      workedSeconds: 0,
      hours: 0,
      createdAt: commandContext.now,
      updatedAt: commandContext.now,
      device: { userAgent: commandContext.userAgent || null },
      ...(checklist ? { checklistSnapshot: checklist.snapshot } : {}),
      deletedAt: null,
    }
    const checklistAssignment = checklist?.tasks?.length ? {
      id: checklist.assignmentId,
      assignmentId: checklist.assignmentId,
      source: 'store-shift-checklist',
      checklistAttendanceId: attendanceId,
      checklistTemplateId: checklist.template.id,
      storeId,
      date: localNow.date,
      shiftId,
      employeeIds: [employeeId],
      tasks: checklist.tasks.map((task) => ({ ...task })),
      status: 'assigned',
      createdAt: commandContext.now,
      createdBy: { id: 'SYSTEM', name: 'Hệ thống', role: 'system' },
      progressHistory: [],
    } : null
    const nextState = {
      ...state,
      attendance: [record, ...attendance],
      tasks: checklist ? [...checklist.tasks, ...(Array.isArray(state.tasks) ? state.tasks : [])] : state.tasks,
      taskAssignmentHistory: checklistAssignment
        ? [checklistAssignment, ...(Array.isArray(state.taskAssignmentHistory) ? state.taskAssignmentHistory : [])]
        : state.taskAssignmentHistory,
      stateVersion: Math.max(1, Number(state.stateVersion) || 1) + 1,
    }
    return commitGlobalStateDomainCommand(db, actor, current, nextState, {
      action: body.type,
      entityType: 'attendance',
      entityId: record.id,
      before: null,
      after: record,
      metadata: { storeId, shiftId, serverTimestamp: commandContext.now },
      response: { command: body.type, attendance: record },
      status: 201,
    }, commandContext)
  }

  if (body.type !== 'attendance.check_out') {
    throw new ApiError(400, 'COMMAND_UNKNOWN', 'Lệnh chấm công không được hỗ trợ.')
  }
  const requestedId = String(payload.attendanceId || '')
  const openRecord = requestedId
    ? uniqueIdentifierRecordMatch({
        records: ownOpenRecords,
        identifier: requestedId,
        collisionCode: 'ATTENDANCE_IDENTIFIER_COLLISION',
        collisionMessage: 'Mã chấm công đang trùng với nhiều bản ghi; không thể kết ca an toàn.',
      })?.record
    : ownOpenRecords[0]
  if (!openRecord) throw new ApiError(409, 'ATTENDANCE_NOT_OPEN', 'Không tìm thấy ca làm việc đang mở.')
  if (ownOpenRecords.length > 1 && !requestedId) {
    throw new ApiError(409, 'ATTENDANCE_AMBIGUOUS', 'Có nhiều ca đang mở; cần chỉ rõ mã chấm công.')
  }
  const attendanceReferenceMatches = (reference) => mutationIdentifierReferenceMatchesRecord({
    records: attendance,
    record: openRecord,
    reference,
    collisionCode: 'ATTENDANCE_REFERENCE_COLLISION',
    collisionMessage: 'Mã chấm công tham chiếu trong dữ liệu ca đang mơ hồ; cần xử lý dữ liệu trùng trước khi kết ca.',
  })
  // An exact transfer end immediately restores the account's home-store scope.
  // The employee must still be able to settle the already-open destination shift,
  // without regaining any permission to create new destination activity.
  const attendanceStoreId = String(openRecord.storeId || storeId)
  const attendanceTransfer = openRecord.supportTransferId
    ? (Array.isArray(state.supportTransfers) ? state.supportTransfers : []).find((record) => (
        sameIdentifier(record.id, openRecord.supportTransferId)
        && sameIdentifier(record.employeeId, employeeId)
        && sameIdentifier(record.toStoreId, attendanceStoreId)
        && !record.deletedAt
        && !['Đã xóa', 'Đã hủy'].includes(String(record.status || ''))
      )) || null
    : null
  const attendanceTransferBounds = attendanceTransfer ? supportTransferTimeBounds(attendanceTransfer) : null
  const checkInTime = Date.parse(openRecord.checkInAt)
  const checkOutTime = Date.parse(commandContext.now)
  if (!Number.isFinite(checkInTime) || checkOutTime < checkInTime) {
    throw new ApiError(409, 'ATTENDANCE_TIME_INVALID', 'Thời gian vào ca đang lưu không hợp lệ.')
  }
  const attendancePeriod = asMonth(monthFromRecord(openRecord), 'Kỳ chấm công')
  assertPayrollNotPaidOrLocked(state, attendanceStoreId, attendancePeriod)
  const payableCheckOutTime = attendanceTransferBounds
    ? Math.min(checkOutTime, attendanceTransferBounds.endMs)
    : checkOutTime
  const elapsedSeconds = Math.floor((checkOutTime - checkInTime) / 1000)
  const workedSeconds = Math.max(0, Math.floor((payableCheckOutTime - checkInTime) / 1000))
  const shiftStart = parseShiftTime(openRecord.shiftStart)
  const shiftEnd = parseShiftTime(openRecord.shiftEnd)
  let departureDelta = 0
  if (shiftStart && shiftEnd) {
    let endMinute = shiftEnd.minuteOfDay
    let currentMinute = localNow.minuteOfDay
    if (endMinute <= shiftStart.minuteOfDay) {
      endMinute += 1_440
      if (currentMinute < shiftStart.minuteOfDay) currentMinute += 1_440
    }
    departureDelta = currentMinute - endMinute
  }
  const relatedOrders = (Array.isArray(state.orders) ? state.orders : []).filter((order) => (
    !order.deletedAt
    && String(order.status || '') === 'Hoàn tất'
    && orderCreatedByEmployee(order, employeeId)
    && sameIdentifier(order.storeId, attendanceStoreId)
    && (
      (String(order.attendanceId || '').trim() && attendanceReferenceMatches(order.attendanceId))
      || (!order.attendanceId
        && (
          (!String(order.shiftId || order.shift || '').trim()
            && !String(openRecord.shiftId || openRecord.shift || '').trim())
          || sameIdentifier(order.shiftId || order.shift, openRecord.shiftId || openRecord.shift)
        )
        && Date.parse(order.createdAt) >= checkInTime
        && Date.parse(order.createdAt) <= checkOutTime)
    )
  ))
  const revenue = relatedOrders.reduce(
    (sum, order) => safeMoneySum(sum, Number(order.amount || 0), 'Doanh thu đơn hàng trong ca'),
    0,
  )
  const cash = relatedOrders
    .filter((order) => order.paymentMethod === 'Tiền mặt')
    .reduce((sum, order) => safeMoneySum(sum, Number(order.amount || 0), 'Tiền mặt đơn hàng trong ca'), 0)
  const transfer = revenue - cash
  const storeEmployee = employeeUnit(employee) === 'store'
  const attendanceDate = String(openRecord.date || openRecord.workDate || localNow.date)
  const attendanceShiftId = String(openRecord.shiftId || openRecord.shift || '')
  const checklistSnapshot = isPlainRecord(openRecord.checklistSnapshot)
    ? openRecord.checklistSnapshot
    : null
  const configuredChecklistMissing = storeEmployee && !checklistSnapshot
    ? (() => {
        try {
          const configuredChecklist = checklistSnapshotForAttendance({
            state,
            shift: {
              id: attendanceShiftId,
              name: openRecord.shiftName || attendanceShiftId,
              start: openRecord.shiftStart,
              end: openRecord.shiftEnd,
            },
            attendanceId: String(openRecord.id || ''),
            employeeId,
            storeId: attendanceStoreId,
            targetGroup: WORK_CATALOG_TARGET.STORE,
            date: attendanceDate,
            shiftId: attendanceShiftId,
            checkInTime: openRecord.checkInTime || openRecord.checkIn,
            now: openRecord.checkInAt || openRecord.createdAt || commandContext.now,
          })
          return Boolean(configuredChecklist?.tasks?.length)
        } catch {
          return true
        }
      })()
    : false
  const workCatalogChecklistPending = configuredChecklistMissing
    || (checklistSnapshot
      && (checklistSnapshot.source === 'work-catalog' || checklistSnapshot.templateId === 'WORK-CATALOG')
      && Number(checklistSnapshot.storeChecklistRepairVersion || 0) < STORE_ATTENDANCE_CHECKLIST_REPAIR_VERSION)
  if (storeEmployee && (openRecord.checklistRepairError || workCatalogChecklistPending)) {
    throw new ApiError(
      409,
      'CHECKLIST_REPAIR_PENDING',
      'Checklist bắt buộc của ca đang chờ hệ thống phục hồi; chưa thể kết ca.',
      {
        attendanceId: openRecord.id,
        repairError: openRecord.checklistRepairError || {
          code: 'CHECKLIST_SNAPSHOT_MISSING',
          message: 'Ca đang mở chưa có checklist bắt buộc đã được phục hồi và chốt.',
        },
      },
    )
  }
  let declaredCash = cash
  let declaredTransfer = transfer
  if (storeEmployee) {
    if (payload.cashRevenue === undefined || payload.cashRevenue === null || payload.cashRevenue === ''
      || payload.transferRevenue === undefined || payload.transferRevenue === null || payload.transferRevenue === '') {
      throw new ApiError(400, 'SHIFT_REVENUE_REQUIRED', 'Cần nhập đủ doanh thu tiền mặt và chuyển khoản trước khi kết ca.')
    }
    declaredCash = asVnd(payload.cashRevenue, 'Doanh thu tiền mặt')
    declaredTransfer = asVnd(payload.transferRevenue, 'Doanh thu chuyển khoản')
    if (declaredCash !== cash || declaredTransfer !== transfer) {
      throw new ApiError(409, 'SHIFT_REVENUE_MISMATCH', 'Doanh thu kết ca không khớp với đơn hàng Hoàn tất trong ca.', {
        expected: { cashRevenue: cash, transferRevenue: transfer, totalRevenue: revenue },
        received: {
          cashRevenue: declaredCash,
          transferRevenue: declaredTransfer,
          totalRevenue: safeMoneySum(declaredCash, declaredTransfer, 'Doanh thu khai báo kết ca'),
        },
      })
    }
  }
  const checklistTasks = Array.isArray(openRecord.checklistSnapshot?.tasks)
    ? (Array.isArray(state.tasks) ? state.tasks : []).filter((task) => (
        attendanceReferenceMatches(task.checklistAttendanceId)
        && !task.deletedAt
      ))
    : []
  if (Array.isArray(openRecord.checklistSnapshot?.tasks)) {
    const checklistTaskById = new Map(checklistTasks.map((task) => [normalizeIdentifierKey(task.id), task]))
    if (checklistTaskById.size !== checklistTasks.length) {
      throw new ApiError(
        409,
        'TASK_IDENTIFIER_COLLISION',
        'Ca đang làm có nhiều công việc trùng mã; không thể kết ca an toàn.',
        {
          attendanceId: openRecord.id,
          conflictingIdentifiers: checklistTasks.map((task) => String(task.id || '')),
        },
      )
    }
    const catalogChecklist = openRecord.checklistSnapshot.source === 'work-catalog'
      || openRecord.checklistSnapshot.templateId === 'WORK-CATALOG'
    const checklistValidation = catalogChecklist
      ? (() => {
          const requiredTasks = openRecord.checklistSnapshot.tasks.filter(workTaskIsRequired)
          const missingTasks = requiredTasks.filter((snapshotTask) => {
            const task = checklistTaskById.get(normalizeIdentifierKey(snapshotTask.id))
            return !task || completedByEmployeeValue(task.completedBy, employeeId) !== true
          })
          return {
            allowed: missingTasks.length === 0,
            code: missingTasks.length ? 'CHECKLIST_INCOMPLETE' : 'CHECKLIST_COMPLETE',
            missingTaskIds: missingTasks.map((task) => String(task.id || '')),
            missingTasks,
          }
        })()
      : validateStoreChecklistCheckout({
          template: {
            id: openRecord.checklistSnapshot.templateId,
            key: openRecord.checklistSnapshot.templateKey,
            name: openRecord.checklistSnapshot.templateName,
          },
          taskRecords: checklistTasks,
          completionRecords: checklistTasks.map((task) => ({
            taskId: task.id,
            checked: completedByEmployeeValue(task.completedBy, employeeId) === true,
          })),
        })
    if (!checklistValidation.allowed) {
      throw new ApiError(409, checklistValidation.code, 'Bạn phải hoàn thành toàn bộ checklist bắt buộc trước khi kết ca.', {
        attendanceId: openRecord.id,
        missingTaskIds: checklistValidation.missingTaskIds,
        missingTasks: checklistValidation.missingTasks.map((task) => ({
          id: task.id,
          checklistTaskId: task.checklistTaskId || null,
          title: task.title || task.description || '',
        })),
      })
    }
  }
  const incompleteTasks = storeEmployee
      ? (Array.isArray(state.tasks) ? state.tasks : []).filter((task) => {
        if (attendanceReferenceMatches(task.checklistAttendanceId)) return false
        if (!workTaskIsRequired(task)) return false
        if (!taskAppliesToEmployee(task, employeeId, attendanceStoreId)) return false
        if (String(task.date || task.workDate || '') !== attendanceDate) return false
        const taskShiftId = String(task.shiftId || task.shift || '')
        if (taskShiftId && !sameIdentifier(taskShiftId, attendanceShiftId)) return false
        const completedBy = isPlainRecord(task.completedBy) ? task.completedBy : {}
        return completedByEmployeeValue(completedBy, employeeId) !== true && task.done !== true
      })
    : []
  const incompleteTaskReason = String(payload.incompleteTaskReason || '').trim()
  if (incompleteTaskReason.length > 1_000) {
    throw new ApiError(400, 'INCOMPLETE_TASK_REASON_INVALID', 'Lý do chưa hoàn thành công việc không được vượt quá 1.000 ký tự.')
  }
  if (incompleteTasks.length && !incompleteTaskReason) {
    throw new ApiError(400, 'INCOMPLETE_TASK_REASON_REQUIRED', 'Cần nhập lý do cho các công việc chưa hoàn thành trước khi kết ca.', {
      taskIds: incompleteTasks.map((task) => task.id),
    })
  }
  if (officeEmployee && (Number(payload.expense || 0) !== 0 || payload.tiktok === true)) {
    throw new ApiError(400, 'OFFICE_CHECK_OUT_FIELDS_INVALID', 'Chấm công ra về của nhân sự theo giờ hồ sơ chỉ ghi nhận thời gian và vị trí.')
  }
  const shiftExpense = officeEmployee || payload.expense == null ? 0 : asVnd(payload.expense, 'Chi phí trong ca')
  if (shiftExpense > 0) assertAccountingPeriodOpen(state, attendanceStoreId, attendancePeriod)
  const expenseEntries = Array.isArray(state.expenseEntries) ? state.expenseEntries : []
  const recordedShiftExpense = officeEmployee ? 0 : expenseEntries
    .filter((entry) => (
      entry.recognized !== false
      && attendanceReferenceMatches(entry.attendanceId)
      && String(entry.sourceType || '') === 'shift-expense-item'
    ))
    .reduce((sum, entry) => safeMoneySum(sum, Number(entry.amount || 0), 'Tổng chi phí trong ca'), 0)
  const totalShiftExpense = safeMoneySum(recordedShiftExpense, shiftExpense, 'Tổng chi phí trong ca')
  const updatedRecordBase = {
    ...openRecord,
    checkOut: localNow.time,
    checkOutTime: localNow.time,
    checkOutAt: commandContext.now,
    checkOutLocation: location,
    departureTag: shiftEnd && departureDelta < 0 ? 'Về sớm' : 'Đã ra về',
    ...(officeEmployee ? { workdayCredit: workedSeconds > 0 ? 1 : 0 } : {}),
    ...(attendanceTransferBounds ? { elapsedSeconds } : {}),
    workedSeconds,
    workedMinutes: workedSeconds / 60,
    hours: workedSeconds / 3_600,
    revenue,
    cash,
    transfer,
    ...(storeEmployee ? {
      declaredRevenue: {
        cash: declaredCash,
        transfer: declaredTransfer,
        total: safeMoneySum(declaredCash, declaredTransfer, 'Doanh thu khai báo kết ca'),
      },
      revenueReconciliation: {
        matched: true,
        expectedCash: cash,
        expectedTransfer: transfer,
        expectedTotal: revenue,
        checkedAt: commandContext.now,
      },
      incompleteTaskReason: incompleteTasks.length ? incompleteTaskReason : null,
      incompleteTasksSnapshot: incompleteTasks.map((task) => ({
        id: task.id,
        assignmentId: task.assignmentId || null,
        title: task.title,
        detail: task.detail || '',
      })),
    } : {}),
    orderCount: relatedOrders.length,
    expense: totalShiftExpense,
    shiftExpenseTotal: totalShiftExpense,
    tiktok: officeEmployee ? false : Boolean(payload.tiktok),
    updatedAt: commandContext.now,
  }
  const compensationState = attendanceTransfer ? {
    ...state,
    attendance: attendance.map((record) => (
      record === openRecord ? updatedRecordBase : record
    )),
  } : state
  const updatedRecord = attendanceTransfer
    ? withSupportCompensation(compensationState, updatedRecordBase)
    : updatedRecordBase
  const supportCompensation = isPlainRecord(updatedRecord.supportCompensation)
    ? updatedRecord.supportCompensation
    : null
  const supportExpense = Number(supportCompensation?.totalPay || 0)
  if (supportExpense > 0) assertAccountingPeriodOpen(state, attendanceStoreId, attendancePeriod)
  const shiftExpenseEntry = shiftExpense > 0 ? {
    id: `exp_shift_${openRecord.id}`,
    storeId: attendanceStoreId,
    employeeId,
    shiftId: openRecord.shiftId || openRecord.shift || null,
    type: 'Chi phí trong ca',
    category: 'shift',
    amount: shiftExpense,
    description: `Chi phí ${openRecord.shiftName || openRecord.shift || ''}`.trim(),
    sourceType: 'shift-expense',
    sourceId: openRecord.id,
    recognized: true,
    occurredAt: commandContext.now,
    createdAt: commandContext.now,
    createdBy: actor.user_id,
  } : null
  const supportExpenseEntry = supportExpense > 0 ? {
    id: `exp_support_${openRecord.id}`,
    storeId: attendanceStoreId,
    employeeId,
    attendanceId: openRecord.id,
    supportTransferId: attendanceTransfer?.id || null,
    type: 'Lương ca hỗ trợ',
    category: 'payroll-support',
    amount: supportExpense,
    description: `Lương hỗ trợ ${updatedRecord.employeeName || employeeId}: ${supportCompensation.hours} giờ × ${supportCompensation.hourlyRate} đ${supportCompensation.allowance ? ` + ${supportCompensation.allowance} đ phụ cấp` : ''}`,
    sourceType: 'support-attendance-compensation',
    sourceId: openRecord.id,
    recognized: true,
    occurredAt: commandContext.now,
    createdAt: commandContext.now,
    createdBy: actor.user_id,
  } : null
  const cashTransaction = shiftExpense > 0 ? {
    id: `txn_shift_${openRecord.id}`,
    storeId: attendanceStoreId,
    employeeId,
    type: 'Chi phí trong ca',
    direction: 'out',
    amount: shiftExpense,
    sourceType: 'shift-expense',
    sourceId: openRecord.id,
    occurredAt: commandContext.now,
    createdAt: commandContext.now,
    actor: serverActorSnapshot(actor),
  } : null
  const cashTransactions = Array.isArray(state.cashTransactions) ? state.cashTransactions : []
  if (shiftExpenseEntry && expenseEntries.some((entry) => sourceMatch(entry, 'shift-expense', openRecord.id))) {
    throw new ApiError(409, 'SHIFT_EXPENSE_EXISTS', 'Chi phí của ca này đã được ghi nhận.')
  }
  if (supportExpenseEntry && expenseEntries.some((entry) => sourceMatch(entry, 'support-attendance-compensation', openRecord.id))) {
    throw new ApiError(409, 'SUPPORT_COMPENSATION_EXPENSE_EXISTS', 'Chi phí lương ca hỗ trợ này đã được ghi nhận.')
  }
  const nextState = {
    ...state,
    attendance: attendance.map((record) => String(record.id || '') === String(openRecord.id) ? updatedRecord : record),
    expenseEntries: [supportExpenseEntry, shiftExpenseEntry, ...expenseEntries].filter(Boolean),
    cashTransactions: cashTransaction ? [cashTransaction, ...cashTransactions] : cashTransactions,
    supportTransfers: attendanceTransfer
      ? (Array.isArray(state.supportTransfers) ? state.supportTransfers : []).map((record) => (
          String(record.id || '') === String(attendanceTransfer.id)
            ? {
                ...record,
                status: 'Hoàn tất',
                completedAt: commandContext.now,
                completedAttendanceId: openRecord.id,
                updatedAt: commandContext.now,
              }
            : record
        ))
      : (Array.isArray(state.supportTransfers) ? state.supportTransfers : []),
    payrollPeriods: invalidateClosedPayrollPeriods(
      state,
      { storeId: attendanceStoreId, period: attendancePeriod },
      commandContext.now,
      body.type,
    ),
    stateVersion: Math.max(1, Number(state.stateVersion) || 1) + 1,
  }
  return commitGlobalStateDomainCommand(db, actor, current, nextState, {
    action: body.type,
    entityType: 'attendance',
    entityId: openRecord.id,
    before: openRecord,
    after: updatedRecord,
    metadata: {
      storeId: attendanceStoreId,
      period: attendancePeriod,
      shiftId: openRecord.shiftId || openRecord.shift,
      shiftExpense,
      recordedShiftExpense,
      totalShiftExpense,
      supportExpense,
      supportTransferId: attendanceTransfer?.id || null,
      serverTimestamp: commandContext.now,
      ...(storeEmployee ? {
        revenueReconciliation: {
          cashRevenue: cash,
          transferRevenue: transfer,
          totalRevenue: revenue,
          matched: true,
        },
        incompleteTaskIds: incompleteTasks.map((task) => task.id),
        incompleteTaskReason: incompleteTasks.length ? incompleteTaskReason : null,
      } : {}),
    },
    response: {
      command: body.type,
      attendance: updatedRecord,
      expense: shiftExpenseEntry,
      supportExpense: supportExpenseEntry,
    },
  }, commandContext)
}

const ORDER_GENDERS = new Set(['Nam', 'Nữ', 'Khác'])
const ORDER_ACQUISITION_CHANNELS = new Set(['Facebook', 'Tiktok', 'Zalo', 'Bạn Bè', 'Người thân', 'Khác'])
const ORDER_INFORMATION_KIND = 'occupation'
const ORDER_PAYMENT_METHOD_KIND = 'payment_method'
const ORDER_INFORMATION_KINDS = new Set([ORDER_INFORMATION_KIND, ORDER_PAYMENT_METHOD_KIND])
const ORDER_INFORMATION_OPTION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{1,99}$/u
const ORDER_INFORMATION_OPTION_CODE_PATTERN = /^[A-Z0-9][A-Z0-9_-]{1,39}$/u
const MAX_ORDER_INFORMATION_OPTIONS = 1_000
const DEFAULT_ORDER_OCCUPATION_LABELS = [
  'Nhân viên VP',
  'Kỹ sư',
  'Bác sĩ',
  'Giáo viên',
  'Học sinh/Sinh viên',
  'Lao động',
  'Nội trợ',
  'Buôn bán/kinh doanh',
  'Tài xế',
  'Giám đốc',
  'Ca sỉ',
  'Lao công',
  'Bảo vệ',
  'Công nhân',
  'Khác',
]

const normalizeOrderInformationText = (value) => String(value ?? '')
  .normalize('NFC')
  .trim()
  .replace(/\s+/gu, ' ')

const normalizeOrderInformationLabel = (value) => normalizeOrderInformationText(value)
  .toLocaleLowerCase('vi-VN')

const DEFAULT_ORDER_OCCUPATION_OPTIONS = DEFAULT_ORDER_OCCUPATION_LABELS.map((label, index) => ({
  id: `order-occupation-${String(index + 1).padStart(3, '0')}`,
  kind: ORDER_INFORMATION_KIND,
  code: `OCC-${String(index + 1).padStart(3, '0')}`,
  label,
  normalizedLabel: normalizeOrderInformationLabel(label),
  active: true,
  sortOrder: (index + 1) * 100,
  system: false,
  createdAt: '2026-08-25T00:00:00+07:00',
  createdBy: 'SYSTEM',
  updatedAt: '2026-08-25T00:00:00+07:00',
  updatedBy: 'SYSTEM',
  deletedAt: null,
  deletedBy: null,
}))

const DEFAULT_ORDER_PAYMENT_METHOD_OPTIONS = [
  { id: 'order-payment-001', code: 'PAY-001', label: 'Tiền mặt', sortOrder: 1600 },
  { id: 'order-payment-002', code: 'PAY-002', label: 'Chuyển khoản', sortOrder: 1700 },
].map((option) => ({
  ...option,
  kind: ORDER_PAYMENT_METHOD_KIND,
  normalizedLabel: normalizeOrderInformationLabel(option.label),
  active: true,
  system: true,
  createdAt: '2026-08-25T00:00:00+07:00',
  createdBy: 'SYSTEM',
  updatedAt: '2026-08-25T00:00:00+07:00',
  updatedBy: 'SYSTEM',
  deletedAt: null,
  deletedBy: null,
}))

const DEFAULT_ORDER_INFORMATION_OPTIONS = [
  ...DEFAULT_ORDER_OCCUPATION_OPTIONS,
  ...DEFAULT_ORDER_PAYMENT_METHOD_OPTIONS,
]

const orderInformationDefaultsSummary = () => ({
  persisted: true,
  collectionKey: 'orderInformationOptions',
  canonicalSeedCount: DEFAULT_ORDER_INFORMATION_OPTIONS.length,
  occupationSeedCount: DEFAULT_ORDER_OCCUPATION_OPTIONS.length,
  paymentMethodSeedCount: DEFAULT_ORDER_PAYMENT_METHOD_OPTIONS.length,
})

const orderInformationOptionsFromState = (state) => (
  Array.isArray(state?.orderInformationOptions) ? state.orderInformationOptions : []
)

const orderInformationOptionKind = (option) => String(option?.kind || ORDER_INFORMATION_KIND)

const materializeDefaultOrderInformationOptions = (state) => {
  const options = orderInformationOptionsFromState(state).map((option) => sanitizeStateValue(option))
  for (const defaultOption of DEFAULT_ORDER_INFORMATION_OPTIONS) {
    const defaultCode = String(defaultOption.code).toUpperCase()
    const exists = options.some((option) => (
      String(option?.id || '') === defaultOption.id
      || String(option?.code || '').trim().toUpperCase() === defaultCode
      || (
        orderInformationOptionKind(option) === defaultOption.kind
        && normalizeOrderInformationLabel(option?.label) === defaultOption.normalizedLabel
      )
    ))
    if (!exists) options.push({ ...defaultOption })
  }
  return options
}

const configuredOrderPaymentMethods = (state) => {
  const options = orderInformationOptionsFromState(state)
  const activePaymentOptions = options.filter((option) => (
    isPlainRecord(option)
    && orderInformationOptionKind(option) === ORDER_PAYMENT_METHOD_KIND
    && orderInformationOptionIsActive(option)
  ))
  if (activePaymentOptions.length !== DEFAULT_ORDER_PAYMENT_METHOD_OPTIONS.length) {
    throw new ApiError(409, 'ORDER_PAYMENT_CONFIGURATION_INVALID', 'Cấu hình hình thức thanh toán trong cơ sở dữ liệu không hợp lệ.')
  }
  const methods = DEFAULT_ORDER_PAYMENT_METHOD_OPTIONS.map((expected) => {
    const matches = activePaymentOptions.filter((option) => (
      normalizeOrderInformationLabel(option.label) === expected.normalizedLabel
    ))
    if (matches.length !== 1) {
      throw new ApiError(409, 'ORDER_PAYMENT_CONFIGURATION_INVALID', 'Cấu hình hình thức thanh toán trong cơ sở dữ liệu không hợp lệ.')
    }
    return expected.label
  })
  return new Set(methods)
}

const orderInformationOptionIsActive = (option) => option?.active !== false && !option?.deletedAt

const findOrderInformationOptionByLabel = (state, value) => {
  const normalizedLabel = normalizeOrderInformationLabel(value)
  if (!normalizedLabel) return null
  return orderInformationOptionsFromState(state).find((option) => (
    isPlainRecord(option)
    && String(option.kind || ORDER_INFORMATION_KIND) === ORDER_INFORMATION_KIND
    && normalizeOrderInformationLabel(option.label) === normalizedLabel
  )) || null
}

const resolveOrderOccupation = (state, value, previousValue = '', allowUnchangedInactive = false) => {
  const requested = normalizeOrderInformationText(value)
  const option = findOrderInformationOptionByLabel(state, requested)
  if (option && orderInformationOptionIsActive(option)) return normalizeOrderInformationText(option.label)
  if (allowUnchangedInactive
    && normalizeOrderInformationLabel(requested)
      === normalizeOrderInformationLabel(previousValue)
    && normalizeOrderInformationLabel(previousValue)) {
    return String(previousValue)
  }
  throw new ApiError(400, 'ORDER_OCCUPATION_INVALID', 'Nghề nghiệp không thuộc danh sách đang hoạt động của hệ thống.')
}

const orderCustomerProfile = (payload, state, previous = null) => {
  const gender = String(payload.gender ?? payload.customerGender ?? previous?.gender ?? '').trim()
  if (!ORDER_GENDERS.has(gender)) {
    throw new ApiError(400, 'ORDER_GENDER_INVALID', 'Giới tính là bắt buộc và phải là Nam, Nữ hoặc Khác.')
  }
  const occupation = resolveOrderOccupation(
    state,
    payload.occupation ?? payload.customerOccupation ?? previous?.occupation ?? '',
    previous?.occupation,
    Boolean(previous),
  )
  const acquisitionChannel = String(
    payload.acquisitionChannel ?? payload.channel ?? payload.knownFrom ?? previous?.acquisitionChannel ?? '',
  ).trim()
  if (!ORDER_ACQUISITION_CHANNELS.has(acquisitionChannel)) {
    throw new ApiError(400, 'ORDER_ACQUISITION_CHANNEL_INVALID', 'Kênh biết đến phải là Facebook, Tiktok, Zalo, Bạn Bè, Người thân hoặc Khác.')
  }
  return { gender, occupation, acquisitionChannel }
}

const validateOrderInformationOptionId = (value) => {
  const optionId = String(value || '').trim()
  if (!ORDER_INFORMATION_OPTION_ID_PATTERN.test(optionId)) {
    throw new ApiError(400, 'ORDER_INFORMATION_OPTION_ID_INVALID', 'Mã định danh nghề nghiệp không hợp lệ.')
  }
  return optionId
}

const orderInformationOptionsForMutation = (state) => {
  const options = orderInformationOptionsFromState(state)
  if (options.length > MAX_ORDER_INFORMATION_OPTIONS) {
    throw new ApiError(409, 'ORDER_INFORMATION_LIMIT', `Danh mục nghề nghiệp vượt quá ${MAX_ORDER_INFORMATION_OPTIONS} lựa chọn.`)
  }
  const ids = new Set()
  for (const option of options) {
    const id = String(option?.id || '').trim()
    if (!isPlainRecord(option)
      || !ORDER_INFORMATION_KINDS.has(orderInformationOptionKind(option))
      || !ORDER_INFORMATION_OPTION_ID_PATTERN.test(id)
      || ids.has(id)) {
      throw new ApiError(409, 'ORDER_INFORMATION_STATE_INVALID', 'Danh mục nghề nghiệp đang có bản ghi không hợp lệ hoặc trùng mã định danh.')
    }
    ids.add(id)
  }
  return {
    options,
    occupations: options.filter((option) => orderInformationOptionKind(option) === ORDER_INFORMATION_KIND),
  }
}

const validateOrderInformationOptionInput = (payload, options, currentId = '') => {
  const label = normalizeOrderInformationText(payload.label)
  const code = String(payload.code || '').trim().toUpperCase()
  if (!label || label.length > 120) {
    throw new ApiError(400, 'ORDER_INFORMATION_LABEL_INVALID', 'Tên hiển thị là bắt buộc và không được vượt quá 120 ký tự.')
  }
  if (!ORDER_INFORMATION_OPTION_CODE_PATTERN.test(code)) {
    throw new ApiError(400, 'ORDER_INFORMATION_CODE_INVALID', 'Mã phải có 2–40 ký tự chữ in hoa, số, gạch ngang hoặc gạch dưới.')
  }
  const normalizedLabel = normalizeOrderInformationLabel(label)
  const duplicate = options.find((option) => (
    String(option.id || '') !== String(currentId)
    && (
      normalizeOrderInformationLabel(option.label) === normalizedLabel
      || String(option.code || '').trim().toUpperCase() === code
    )
  ))
  if (duplicate) {
    throw new ApiError(409, 'ORDER_INFORMATION_DUPLICATE', 'Tên hiển thị hoặc mã đã tồn tại trong danh mục nghề nghiệp.', {
      conflictingOptionId: duplicate.id,
    })
  }
  return { label, code, normalizedLabel }
}

const orderInformationCommand = async (db, actor, body, commandContext) => {
  if (!['admin', 'business_support'].includes(actor.role)) {
    throw new ApiError(403, 'ROLE_FORBIDDEN', 'Chỉ Admin hoặc Nhân viên hỗ trợ KD được quản lý thông tin đơn hàng.')
  }
  const operation = String(body.type || '').split('.').at(-1)
  if (!['create', 'update', 'disable', 'restore', 'reorder'].includes(operation)) {
    throw new ApiError(400, 'COMMAND_UNKNOWN', 'Lệnh quản lý thông tin đơn hàng không được hỗ trợ.')
  }
  const payload = isPlainRecord(body.payload) ? body.payload : {}
  if (payload.kind !== undefined && String(payload.kind) !== ORDER_INFORMATION_KIND) {
    throw new ApiError(400, 'ORDER_INFORMATION_KIND_INVALID', 'Hiện chỉ hỗ trợ danh mục nghề nghiệp; hình thức thanh toán là trường hệ thống.')
  }
  const { current, state } = await loadGlobalCommandState(db, body)
  const { options, occupations } = orderInformationOptionsForMutation(state)
  const actorSnapshot = serverActorSnapshot(actor)

  if (operation === 'create') {
    if (Object.hasOwn(payload, 'id') || Object.hasOwn(payload, 'optionId')) {
      throw new ApiError(400, 'ORDER_INFORMATION_OPTION_ID_SERVER_MANAGED', 'Mã định danh nghề nghiệp được máy chủ tự cấp.')
    }
    if (options.length >= MAX_ORDER_INFORMATION_OPTIONS) {
      throw new ApiError(409, 'ORDER_INFORMATION_LIMIT', `Chỉ được lưu tối đa ${MAX_ORDER_INFORMATION_OPTIONS} nghề nghiệp.`)
    }
    const input = validateOrderInformationOptionInput(payload, options)
    const option = sanitizeStateValue({
      id: `order-occupation-${crypto.randomUUID()}`,
      kind: ORDER_INFORMATION_KIND,
      ...input,
      active: true,
      sortOrder: occupations.reduce((maximum, candidate, index) => (
        Math.max(maximum, Number(candidate.sortOrder) || ((index + 1) * 100))
      ), 0) + 100,
      system: false,
      createdAt: commandContext.now,
      createdBy: actorSnapshot,
      updatedAt: commandContext.now,
      updatedBy: actorSnapshot,
      deletedAt: null,
      deletedBy: null,
    })
    const nextState = {
      ...state,
      orderInformationOptions: [...options, option],
      stateVersion: Math.max(1, Number(state.stateVersion) || 1) + 1,
    }
    return commitGlobalStateDomainCommand(db, actor, current, nextState, {
      action: body.type,
      entityType: 'order-information-option',
      entityId: option.id,
      before: null,
      after: option,
      metadata: { kind: ORDER_INFORMATION_KIND },
      response: { command: body.type, option },
      status: 201,
    }, commandContext)
  }

  if (operation === 'reorder') {
    const orderedIds = Array.isArray(payload.orderedIds)
      ? payload.orderedIds.map((id) => validateOrderInformationOptionId(id))
      : []
    const currentIds = occupations.map((option) => String(option.id))
    if (orderedIds.length !== currentIds.length
      || new Set(orderedIds).size !== orderedIds.length
      || currentIds.some((id) => !orderedIds.includes(id))) {
      throw new ApiError(400, 'ORDER_INFORMATION_ORDER_INVALID', 'Thứ tự nghề nghiệp phải chứa đúng một lần toàn bộ mã hiện có.')
    }
    if (orderedIds.every((id, index) => id === currentIds[index])) {
      return recordNoopCommand(db, actor, {
        command: body.type,
        version: Number(current.version),
        options: occupations,
        existing: true,
      }, 200, commandContext)
    }
    const byId = new Map(occupations.map((option) => [String(option.id), option]))
    const nextOccupations = orderedIds.map((id, index) => sanitizeStateValue({
      ...byId.get(id),
      sortOrder: (index + 1) * 100,
      updatedAt: commandContext.now,
      updatedBy: actorSnapshot,
    }))
    const nextOptions = [
      ...nextOccupations,
      ...options.filter((option) => orderInformationOptionKind(option) !== ORDER_INFORMATION_KIND),
    ]
    const nextState = {
      ...state,
      orderInformationOptions: nextOptions,
      stateVersion: Math.max(1, Number(state.stateVersion) || 1) + 1,
    }
    return commitGlobalStateDomainCommand(db, actor, current, nextState, {
      action: body.type,
      entityType: 'order-information-options',
      entityId: ORDER_INFORMATION_KIND,
      before: occupations,
      after: nextOccupations,
      metadata: { orderedIds },
      response: { command: body.type, options: nextOccupations },
    }, commandContext)
  }

  const optionId = validateOrderInformationOptionId(payload.optionId)
  const index = options.findIndex((option) => String(option.id) === optionId)
  if (index < 0) {
    throw new ApiError(404, 'ORDER_INFORMATION_OPTION_NOT_FOUND', 'Không tìm thấy nghề nghiệp cần thay đổi.')
  }
  const previous = options[index]
  if (orderInformationOptionKind(previous) !== ORDER_INFORMATION_KIND) {
    throw new ApiError(403, 'ORDER_INFORMATION_SYSTEM_OPTION_PROTECTED', 'Hình thức thanh toán hệ thống không thể thay đổi bằng lệnh quản lý nghề nghiệp.')
  }
  let option
  let metadata = { kind: ORDER_INFORMATION_KIND }
  if (operation === 'update') {
    const input = validateOrderInformationOptionInput({
      label: payload.label === undefined ? previous.label : payload.label,
      code: payload.code === undefined ? previous.code : payload.code,
    }, options, optionId)
    if (input.label === previous.label
      && input.code === previous.code
      && input.normalizedLabel === previous.normalizedLabel) {
      return recordNoopCommand(db, actor, {
        command: body.type,
        version: Number(current.version),
        option: previous,
        existing: true,
      }, 200, commandContext)
    }
    option = sanitizeStateValue({
      ...previous,
      ...input,
      updatedAt: commandContext.now,
      updatedBy: actorSnapshot,
    })
  } else if (operation === 'disable') {
    const reason = normalizeOrderInformationText(payload.reason)
    if (!reason || reason.length > 500) {
      throw new ApiError(400, 'ORDER_INFORMATION_REASON_REQUIRED', 'Cần nhập lý do vô hiệu hóa từ 1 đến 500 ký tự.')
    }
    if (!orderInformationOptionIsActive(previous)) {
      return recordNoopCommand(db, actor, {
        command: body.type,
        version: Number(current.version),
        option: previous,
        existing: true,
      }, 200, commandContext)
    }
    const usedByOrderCount = (Array.isArray(state.orders) ? state.orders : []).filter((order) => (
      normalizeOrderInformationLabel(order.occupation) === normalizeOrderInformationLabel(previous.label)
    )).length
    option = sanitizeStateValue({
      ...previous,
      active: false,
      deletedAt: commandContext.now,
      deletedBy: actorSnapshot,
      deleteReason: reason,
      updatedAt: commandContext.now,
      updatedBy: actorSnapshot,
    })
    metadata = { ...metadata, reason, usedByOrderCount, deletionMode: 'soft-disable' }
  } else {
    if (orderInformationOptionIsActive(previous)) {
      return recordNoopCommand(db, actor, {
        command: body.type,
        version: Number(current.version),
        option: previous,
        existing: true,
      }, 200, commandContext)
    }
    option = sanitizeStateValue({
      ...previous,
      active: true,
      deletedAt: null,
      deletedBy: null,
      deleteReason: null,
      updatedAt: commandContext.now,
      updatedBy: actorSnapshot,
    })
  }
  const nextOptions = options.map((candidate, candidateIndex) => candidateIndex === index ? option : candidate)
  const nextState = {
    ...state,
    orderInformationOptions: nextOptions,
    stateVersion: Math.max(1, Number(state.stateVersion) || 1) + 1,
  }
  return commitGlobalStateDomainCommand(db, actor, current, nextState, {
    action: body.type,
    entityType: 'order-information-option',
    entityId: optionId,
    before: previous,
    after: option,
    metadata,
    response: { command: body.type, option },
  }, commandContext)
}

const orderCreateCommand = async (db, actor, body, commandContext) => {
  if (['business_support', 'store_manager'].includes(actor.role)) {
    throw new ApiError(403, 'ORDER_READ_ONLY', 'Tài khoản quản lý vận hành chỉ được xem danh sách đơn hàng.')
  }
  const payload = isPlainRecord(body.payload) ? body.payload : {}
  const expectedVersion = commandExpectedVersion(body)
  const current = body._preloadedGlobalStateRow || await loadState(db, 'global')
  const currentVersion = Number(current?.version || 0)
  if (!current || currentVersion !== expectedVersion) {
    throw new ApiError(409, 'VERSION_CONFLICT', 'Dữ liệu đã thay đổi trên máy chủ.', { currentVersion })
  }
  const state = normalizeSharedStateForStorage(parseStoredJson(current.value_json, {}))
  const requestedStoreId = String(payload.storeId || '').trim()
  const scopedStoreId = actor.role === 'admin' ? requestedStoreId : String(actor.store_id || '').trim()
  if (!scopedStoreId || (actor.role === 'employee' && requestedStoreId && !sameIdentifier(requestedStoreId, scopedStoreId))) {
    throw new ApiError(403, 'STORE_FORBIDDEN', 'Bạn không có quyền tạo đơn cho cửa hàng này.')
  }
  const store = requireStore(state, scopedStoreId)
  const storeId = String(store.id || scopedStoreId).trim()
  const storeCode = String(store?.short || store?.code || store?.id || '')
    .toUpperCase().replace(/[^A-Z0-9]/gu, '').slice(0, 20)
  if (!storeCode) throw new ApiError(400, 'STORE_INVALID', 'Cửa hàng không hợp lệ hoặc thiếu mã cửa hàng.')

  const amount = Number(payload.amount)
  if (!Number.isSafeInteger(amount) || amount <= 0 || amount > MAX_MONEY_VND) {
    throw new ApiError(400, 'ORDER_AMOUNT_INVALID', 'Số tiền đơn hàng phải là số nguyên dương theo đơn vị đồng.')
  }
  const customerName = String(payload.customerName || '').trim()
  if (!customerName || customerName.length > 160) {
    throw new ApiError(400, 'CUSTOMER_NAME_INVALID', 'Tên khách hàng là bắt buộc và không được vượt quá 160 ký tự.')
  }
  const customerPhone = String(payload.customerPhone || '').replace(/\D/gu, '')
  if (customerPhone && (customerPhone.length < 9 || customerPhone.length > 15)) {
    throw new ApiError(400, 'CUSTOMER_PHONE_INVALID', 'Số điện thoại khách hàng không hợp lệ.')
  }
  let customerAge = null
  if (payload.customerAge !== '' && payload.customerAge != null) {
    customerAge = Number(payload.customerAge)
    if (!Number.isInteger(customerAge) || customerAge < 0 || customerAge > 150) {
      throw new ApiError(400, 'CUSTOMER_AGE_INVALID', 'Tuổi khách hàng phải là số nguyên từ 0 đến 150.')
    }
  }
  if (!configuredOrderPaymentMethods(state).has(payload.paymentMethod)) {
    throw new ApiError(400, 'PAYMENT_METHOD_INVALID', 'Hình thức thanh toán không hợp lệ.')
  }
  const customerProfile = orderCustomerProfile(payload, state)
  const employeeId = actor.role === 'employee'
    ? String(actor.employee_id || actor.user_id)
    : (String(payload.employeeId || '') || null)
  const employee = employeeId
    ? uniqueEmployeeIdentifierRecordMatch({
        records: state.employees,
        identifier: employeeId,
        predicate: (record) => employeeUnit(record) === 'store' && !record.deletedAt,
      })?.record || null
    : null
  const employeeStatus = normalizeTextKey(employee?.status)
  const employeeInactive = ['da nghi viec', 'tam ngung', 'inactive', 'locked'].includes(employeeStatus)
  if (actor.role === 'employee' && (!employee || employeeInactive)) {
    throw new ApiError(409, 'EMPLOYEE_PROFILE_MISSING', 'Tài khoản chưa được liên kết với hồ sơ nhân viên hợp lệ.')
  }
  const activeTransfer = actor.active_transfer_id
    ? (Array.isArray(state.supportTransfers) ? state.supportTransfers : []).find((record) => (
        sameIdentifier(record.id, actor.active_transfer_id)
        && sameIdentifier(record.employeeId, employeeId)
        && sameIdentifier(record.toStoreId, storeId)
        && !record.deletedAt
        && !['Đã xóa', 'Đã hủy', 'Hoàn tất'].includes(String(record.status || ''))
      ))
    : null
  if (employee && !sameIdentifier(employee.storeId, storeId) && !activeTransfer) {
    throw new ApiError(403, 'EMPLOYEE_STORE_MISMATCH', 'Nhân viên không thuộc cửa hàng tạo đơn.')
  }

  const openAttendanceMatches = employeeId
    ? (Array.isArray(state.attendance) ? state.attendance : []).filter((record) => (
        belongsToEmployee(record, employeeId)
        && sameIdentifier(record.storeId, storeId)
        && !record.deletedAt
        && !record.checkOut
        && !record.checkOutAt
      ))
    : []
  if (openAttendanceMatches.length > 1) {
    throw new ApiError(409, 'ATTENDANCE_AMBIGUOUS', 'Nhân viên có nhiều ca đang mở tại cửa hàng; cần xử lý dữ liệu chấm công trước khi tạo đơn.')
  }
  const openAttendance = openAttendanceMatches[0] || null
  if (actor.role === 'employee' && !openAttendance) {
    throw new ApiError(409, 'ATTENDANCE_NOT_OPEN', 'Nhân viên chỉ được tạo đơn trong ca đang mở.')
  }
  const requestedShiftId = String(payload.shiftId || '') || null
  const shiftId = openAttendance?.shift || openAttendance?.shiftId || (actor.role === 'admin' ? requestedShiftId : null)
  const scopedShiftDefinitions = (Array.isArray(state.shiftDefinitions) ? state.shiftDefinitions : [])
    .filter((record) => (
      sameIdentifier(record.storeId, storeId)
      && !record.deletedAt
      && record.active !== false
    ))
  const shiftDefinition = shiftId ? uniqueShiftDefinitionMatch(scopedShiftDefinitions, shiftId) : null
  if (shiftId && !shiftDefinition && !openAttendance) {
    throw new ApiError(400, 'SHIFT_INVALID', 'Ca làm việc không tồn tại hoặc không thuộc cửa hàng tạo đơn.')
  }
  const times = shiftTimes(shiftDefinition)

  const counterName = `store:${storeId}:orders`
  const counterRows = await all(db, `
    SELECT counter_name, counter_value, version
    FROM counters
    WHERE LOWER(counter_name) = LOWER(?)
  `, counterName)
  const counter = counterRows.find((row) => String(row.counter_name) === counterName) || null
  const counterValue = counterRows.reduce((maximum, row) => (
    Math.max(maximum, Number(row.counter_value || 0))
  ), 0)
  if (!Number.isSafeInteger(counterValue) || counterValue >= 99_999) {
    throw new ApiError(409, 'ORDER_COUNTER_EXHAUSTED', 'Dãy mã đơn hàng của cửa hàng đã hết.')
  }
  const nextCounterValue = counterValue + 1
  const code = `${storeCode}-${String(nextCounterValue).padStart(5, '0')}`
  const creator = {
    ...serverActorSnapshot(actor),
    ...(actor.role === 'employee' ? { employeeId } : {}),
  }
  const order = {
    id: `ord_${crypto.randomUUID()}`,
    code,
    storeId,
    customerName,
    customerPhone,
    customerAge,
    ...customerProfile,
    amount,
    paymentMethod: payload.paymentMethod,
    employeeId,
    employeeName: employee?.name || actor.display_name || 'Quản trị viên',
    shiftId,
    shiftName: openAttendance?.shiftName || shiftDefinition?.name || String(payload.shiftName || '').trim().slice(0, 120) || 'Chưa gắn ca',
    shiftStart: openAttendance?.shiftStart || times.start?.label || null,
    shiftEnd: openAttendance?.shiftEnd || times.end?.label || null,
    attendanceId: openAttendance?.id || null,
    ...(activeTransfer ? { supportTransferId: activeTransfer.id, homeStoreId: activeTransfer.fromStoreId } : {}),
    status: 'Hoàn tất',
    source: 'order',
    createdByEmployeeId: actor.role === 'employee' ? employeeId : null,
    createdBy: creator,
    createdAt: commandContext.now,
    updatedAt: commandContext.now,
    deletedAt: null,
  }
  const notification = {
    id: `ntf_${crypto.randomUUID()}`,
    type: 'order.created',
    storeId,
    employeeId,
    orderId: order.id,
    orderCode: order.code,
    title: `Đơn hàng mới ${order.code}`,
    message: `${order.employeeName} vừa tạo đơn ${order.code}.`,
    createdAt: commandContext.now,
    readAt: null,
  }
  const nextState = {
    ...state,
    orders: [order, ...(Array.isArray(state.orders) ? state.orders : [])],
    notifications: [notification, ...(Array.isArray(state.notifications) ? state.notifications : [])],
    payrollPeriods: invalidateClosedPayrollPeriods(
      state,
      { storeId, period: monthFromRecord(order) },
      commandContext.now,
      body.type,
    ),
    stateVersion: Math.max(1, Number(state.stateVersion) || 1) + 1,
  }
  return commitGlobalStateCounterDomainCommand(db, actor, current, nextState, {
    name: counterName,
    row: counter,
    aliasRows: counterRows.filter((row) => String(row.counter_name) !== counterName),
    nextVersion: Math.max(0, ...counterRows.map((row) => Number(row.version || 0))) + 1,
    value: nextCounterValue,
  }, {
    action: body.type,
    entityType: 'order',
    entityId: order.id,
    before: null,
    after: order,
    metadata: { storeId, counterName, counterValue: nextCounterValue },
    response: { command: body.type, order, notification },
    status: 201,
  }, commandContext)
}

const orderMutationCommand = async (db, actor, body, commandContext) => {
  if (!['admin', 'business_support'].includes(actor.role)) {
    throw new ApiError(403, 'ROLE_FORBIDDEN', 'Chỉ Admin hoặc Nhân viên hỗ trợ KD được sửa hoặc xóa đơn hàng.')
  }
  const payload = isPlainRecord(body.payload) ? body.payload : {}
  const reason = String(payload.reason || '').trim()
  if (!reason || reason.length > 500) {
    throw new ApiError(400, 'REASON_REQUIRED', 'Cần nhập lý do từ 1 đến 500 ký tự.')
  }
  const { current, state } = await loadGlobalCommandState(db, body)
  const orderId = String(payload.orderId || payload.id || '').trim()
  const orders = Array.isArray(state.orders) ? state.orders : []
  const previous = orders.find((order) => String(order.id || '') === orderId)
  if (!previous || previous.deletedAt || previous.status === 'Đã xóa') {
    throw new ApiError(404, 'ORDER_NOT_FOUND', 'Không tìm thấy đơn hàng đang hoạt động.')
  }
  if (previous.source === 'legacy-opening-balance') {
    throw new ApiError(409, 'LEGACY_ORDER_IMMUTABLE', 'Không thể thay đổi bản ghi doanh thu chuyển tiếp.')
  }
  assertPayrollNotPaidOrLocked(state, previous.storeId, monthFromRecord(previous))
  const actorSnapshot = serverActorSnapshot(actor)
  let next
  let action
  let changedFields
  if (body.type === 'order.delete') {
    action = 'Xóa'
    changedFields = ['status', 'deletedAt', 'deletedBy']
    next = {
      ...previous,
      status: 'Đã xóa',
      deletedAt: commandContext.now,
      deletedBy: actorSnapshot,
      updatedAt: commandContext.now,
    }
  } else if (body.type === 'order.update') {
    action = 'Sửa'
    const candidate = { ...previous }
    if (payload.customerName !== undefined) {
      const customerName = String(payload.customerName || '').trim()
      if (!customerName || customerName.length > 160) {
        throw new ApiError(400, 'CUSTOMER_NAME_INVALID', 'Tên khách hàng là bắt buộc và không quá 160 ký tự.')
      }
      candidate.customerName = customerName
    }
    if (payload.customerPhone !== undefined) {
      const customerPhone = String(payload.customerPhone || '').replace(/\D/gu, '')
      if (customerPhone && (customerPhone.length < 9 || customerPhone.length > 15)) {
        throw new ApiError(400, 'CUSTOMER_PHONE_INVALID', 'Số điện thoại khách hàng không hợp lệ.')
      }
      candidate.customerPhone = customerPhone
    }
    if (payload.customerAge !== undefined) {
      if (payload.customerAge === '' || payload.customerAge === null) candidate.customerAge = null
      else {
        const customerAge = Number(payload.customerAge)
        if (!Number.isInteger(customerAge) || customerAge < 0 || customerAge > 150) {
          throw new ApiError(400, 'CUSTOMER_AGE_INVALID', 'Tuổi khách hàng phải là số nguyên từ 0 đến 150.')
        }
        candidate.customerAge = customerAge
      }
    }
    if (payload.amount !== undefined) candidate.amount = asVnd(payload.amount, 'Số tiền đơn hàng', { positive: true })
    if (payload.paymentMethod !== undefined) {
      if (!configuredOrderPaymentMethods(state).has(payload.paymentMethod)) {
        throw new ApiError(400, 'PAYMENT_METHOD_INVALID', 'Hình thức thanh toán không hợp lệ.')
      }
      candidate.paymentMethod = payload.paymentMethod
    }
    if (payload.gender !== undefined || payload.customerGender !== undefined) {
      const gender = String(payload.gender ?? payload.customerGender ?? '').trim()
      if (!ORDER_GENDERS.has(gender)) {
        throw new ApiError(400, 'ORDER_GENDER_INVALID', 'Giới tính phải là Nam, Nữ hoặc Khác.')
      }
      candidate.gender = gender
    }
    if (payload.occupation !== undefined || payload.customerOccupation !== undefined) {
      candidate.occupation = resolveOrderOccupation(
        state,
        payload.occupation ?? payload.customerOccupation ?? '',
        previous.occupation,
        true,
      )
    }
    if (payload.acquisitionChannel !== undefined || payload.channel !== undefined || payload.knownFrom !== undefined) {
      const acquisitionChannel = String(
        payload.acquisitionChannel ?? payload.channel ?? payload.knownFrom ?? '',
      ).trim()
      if (!ORDER_ACQUISITION_CHANNELS.has(acquisitionChannel)) {
        throw new ApiError(400, 'ORDER_ACQUISITION_CHANNEL_INVALID', 'Kênh biết đến không hợp lệ.')
      }
      candidate.acquisitionChannel = acquisitionChannel
    }
    changedFields = [
      'customerName', 'customerPhone', 'customerAge', 'gender', 'occupation',
      'acquisitionChannel', 'amount', 'paymentMethod',
    ]
      .filter((key) => JSON.stringify(candidate[key]) !== JSON.stringify(previous[key]))
    if (!changedFields.length) {
      return recordNoopCommand(db, actor, {
        command: body.type,
        version: Number(current.version),
        order: previous,
        existing: true,
      }, 200, commandContext)
    }
    next = { ...candidate, updatedAt: commandContext.now }
  } else {
    throw new ApiError(400, 'COMMAND_UNKNOWN', 'Lệnh đơn hàng không được hỗ trợ.')
  }

  const nextOrders = orders.map((order) => String(order.id || '') === orderId ? next : order)
  const nextAttendance = refreshAttendanceSales(state, nextOrders, previous, commandContext.now)
  const auditRecord = {
    id: `oda_${crypto.randomUUID()}`,
    action,
    orderId,
    orderCode: previous.code,
    storeId: previous.storeId,
    before: previous,
    after: next,
    changedFields,
    revenueBefore: Number(previous.amount || 0),
    revenueAfter: next.deletedAt ? 0 : Number(next.amount || 0),
    reason,
    actor: actorSnapshot,
    createdAt: commandContext.now,
  }
  const nextState = {
    ...state,
    orders: nextOrders,
    attendance: nextAttendance,
    orderAudit: [auditRecord, ...(Array.isArray(state.orderAudit) ? state.orderAudit : [])],
    auditLogs: [auditRecord, ...(Array.isArray(state.auditLogs) ? state.auditLogs : [])],
    payrollPeriods: invalidateClosedPayrollPeriods(
      state,
      { storeId: previous.storeId, period: monthFromRecord(previous) },
      commandContext.now,
      body.type,
    ),
    stateVersion: Math.max(1, Number(state.stateVersion) || 1) + 1,
  }
  return commitGlobalStateDomainCommand(db, actor, current, nextState, {
    action: body.type,
    entityType: 'order',
    entityId: orderId,
    before: previous,
    after: next,
    metadata: { reason, changedFields, attendanceId: previous.attendanceId || null },
    response: { command: body.type, order: next, audit: auditRecord },
  }, commandContext)
}

const supportWorkMetrics = (tasks) => {
  const totalTasks = tasks.length
  const completedTasks = tasks.filter((task) => task.completed === true).length
  const required = tasks.filter(workTaskIsRequired)
  const completedRequiredTasks = required.filter((task) => task.completed === true).length
  const requiredTasks = required.length
  const rewardTasks = totalTasks - requiredTasks
  const completedRewardTasks = tasks.filter((task) => !workTaskIsRequired(task) && task.completed === true).length
  return {
    totalTasks,
    completedTasks,
    completionRate: totalTasks ? Math.round((completedTasks / totalTasks) * 100) : 0,
    requiredTasks,
    completedRequiredTasks,
    incompleteRequiredTasks: requiredTasks - completedRequiredTasks,
    rewardTasks,
    completedRewardTasks,
  }
}

const supportWorkTaskHistorySnapshot = (tasks) => (Array.isArray(tasks) ? tasks : []).map((task) => ({
  id: String(task.id || ''),
  name: String(task.name || task.title || ''),
  description: String(task.description || task.detail || ''),
  completed: task.completed === true,
  completedAt: task.completedAt || null,
  completedBy: task.completedBy || null,
  employeeNote: String(task.employeeNote || ''),
  required: workTaskIsRequired(task),
  ...catalogTaskHistoryMetadata(task),
}))

const normalizeAssignedSupportTasks = (rawTasks, previousTasks, actor, timestamp, activeCatalogSnapshots, catalogScope) => {
  if (!Array.isArray(rawTasks) || rawTasks.length < 1 || rawTasks.length > 100) {
    throw new ApiError(400, 'SUPPORT_WORK_TASKS_INVALID', 'Danh sách công việc phải có từ 1 đến 100 mục.')
  }
  const priorById = new Map()
  for (const task of Array.isArray(previousTasks) ? previousTasks : []) {
    const idKey = normalizeIdentifierKey(task?.id)
    if (idKey && priorById.has(idKey)) {
      throw new ApiError(409, 'SUPPORT_WORK_TASK_IDENTIFIER_COLLISION', 'Lượt giao việc có nhiều công việc dùng cùng một mã nhưng khác chữ hoa/thường.')
    }
    if (idKey) priorById.set(idKey, task)
  }
  const ids = new Set()
  const catalogItemIds = new Set()
  return rawTasks.map((rawTask, index) => {
    if (!isPlainRecord(rawTask)) {
      throw new ApiError(400, 'SUPPORT_WORK_TASK_INVALID', `Công việc thứ ${index + 1} không hợp lệ.`)
    }
    const requestedId = String(rawTask.id || `swt_${crypto.randomUUID()}`).trim()
    const idKey = normalizeIdentifierKey(requestedId)
    if (!/^[A-Za-z0-9_-]{1,160}$/u.test(requestedId) || ids.has(idKey)) {
      throw new ApiError(400, 'SUPPORT_WORK_TASK_ID_INVALID', 'Mã công việc phải hợp lệ và không được trùng.')
    }
    ids.add(idKey)
    const prior = priorById.get(idKey)
    const id = String(prior?.id || requestedId)
    const catalogMetadata = assignedCatalogTaskMetadata(rawTask, activeCatalogSnapshots, catalogScope)
    const catalogItemKey = normalizeIdentifierKey(catalogMetadata?.catalogItemId)
    if (catalogMetadata && catalogItemIds.has(catalogItemKey)) {
      throw new ApiError(400, 'WORK_CATALOG_TASK_DUPLICATE', 'Không được giao trùng một công việc danh mục trong cùng lượt.', {
        catalogItemId: catalogMetadata.catalogItemId,
      })
    }
    if (catalogMetadata) catalogItemIds.add(catalogItemKey)
    const name = String(catalogMetadata?.catalogSnapshot?.name || rawTask.name || rawTask.title || '').trim()
    const description = String(rawTask.description ?? rawTask.detail ?? '').trim()
    const maximumNameLength = catalogMetadata ? 300 : 200
    if (!name || name.length > maximumNameLength) {
      throw new ApiError(400, 'SUPPORT_WORK_TASK_NAME_INVALID', `Tên công việc là bắt buộc và không quá ${maximumNameLength} ký tự.`)
    }
    if (description.length > 2_000) {
      throw new ApiError(400, 'SUPPORT_WORK_TASK_DESCRIPTION_INVALID', 'Mô tả công việc không được vượt quá 2.000 ký tự.')
    }
    return {
      id,
      name,
      title: name,
      description,
      detail: description,
      ...(catalogMetadata || {}),
      completed: Boolean(prior?.completed),
      completedAt: prior?.completedAt || null,
      completedBy: prior?.completedBy || null,
      completedByActor: prior?.completedByActor || null,
      employeeNote: String(prior?.employeeNote || ''),
      assignedAt: prior?.assignedAt || timestamp,
      assignedBy: prior?.assignedBy || serverActorSnapshot(actor),
    }
  })
}

const supportWorkCommand = async (db, actor, body, commandContext) => {
  const payload = isPlainRecord(body.payload) ? body.payload : {}
  const { current, state } = await loadGlobalCommandState(db, body)
  const assignments = Array.isArray(state.supportWorkAssignments) ? state.supportWorkAssignments : []

  if (body.type === 'support_work.assign') {
    assertAdmin(actor, 'Chỉ Admin được giao việc cho nhân viên.')
    const date = optionalCalendarDate(payload.date, 'Ngày giao việc')
    if (!date) throw new ApiError(400, 'SUPPORT_WORK_DATE_REQUIRED', 'Ngày giao việc là bắt buộc.')
    const targetUnit = payload.targetUnit === 'office' ? 'office' : 'business_support'
    const requestedEmployeeId = String(payload.employeeId || '').trim()
    const employee = (Array.isArray(state.employees) ? state.employees : []).find((record) => (
      !record.deletedAt
      && employeeIdentifierValues(record).some((identifier) => sameIdentifier(identifier, requestedEmployeeId))
      && employeeUnit(record) === targetUnit
      && !['da nghi viec', 'inactive'].includes(normalizeTextKey(record.status))
    ))
    if (!employee) {
      throw new ApiError(404, 'SUPPORT_EMPLOYEE_NOT_FOUND', 'Không tìm thấy nhân viên nhận việc đang hoạt động.')
    }
    const employeeId = String(employee.id || employee.code || employee.employeeId || requestedEmployeeId).trim()
    const requestedAssignmentId = String(payload.assignmentId || '').trim()
    if (requestedAssignmentId && !/^[A-Za-z0-9_-]{1,160}$/u.test(requestedAssignmentId)) {
      throw new ApiError(400, 'SUPPORT_WORK_ID_INVALID', 'Mã lượt giao việc không hợp lệ.')
    }
    const previousMatch = requestedAssignmentId
      ? uniqueIdentifierRecordMatch({
          records: assignments,
          identifier: requestedAssignmentId,
          predicate: (record) => !record.deletedAt,
          collisionCode: 'SUPPORT_WORK_IDENTIFIER_COLLISION',
          collisionMessage: 'Mã lượt giao việc đang trùng với nhiều bản ghi; không thể cập nhật an toàn.',
        })
      : null
    const previous = previousMatch?.record || null
    if (requestedAssignmentId && !previous) {
      throw new ApiError(404, 'SUPPORT_WORK_NOT_FOUND', 'Không tìm thấy lượt giao việc cần cập nhật.')
    }
    if (previous && (!sameIdentifier(previous.employeeId, employeeId) || String(previous.date || '') !== date || String(previous.targetUnit || 'business_support') !== targetUnit)) {
      throw new ApiError(400, 'SUPPORT_WORK_SCOPE_IMMUTABLE', 'Không thể đổi nhân viên hoặc ngày của lượt giao việc đã tạo.')
    }
    if (previous?.submittedAt) {
      throw new ApiError(409, 'SUPPORT_WORK_SUBMITTED', 'Công việc đã được nhân viên gửi kết quả và không thể thay thế.')
    }
    const catalogScope = {
      targetGroup: targetUnit,
      storeId: null,
      date,
      shiftId: null,
      shiftName: null,
    }
    const activeCatalogSnapshots = activeCatalogTaskSnapshots(state, payload.tasks, catalogScope)
    const tasks = normalizeAssignedSupportTasks(
      payload.tasks,
      previous?.tasks,
      actor,
      commandContext.now,
      activeCatalogSnapshots,
      catalogScope,
    )
    const metrics = supportWorkMetrics(tasks)
    const assignmentId = previous?.id || `swa_${crypto.randomUUID()}`
    const historyEntry = {
      action: previous ? 'replaced' : 'assigned',
      at: commandContext.now,
      actor: serverActorSnapshot(actor),
      details: previous
        ? {
            taskCount: tasks.length,
            beforeTasks: supportWorkTaskHistorySnapshot(previous.tasks),
            afterTasks: supportWorkTaskHistorySnapshot(tasks),
          }
        : {
            taskCount: tasks.length,
            tasks: supportWorkTaskHistorySnapshot(tasks),
          },
    }
    const assignment = {
      ...(previous || {}),
      id: assignmentId,
      date,
      employeeId,
      employeeName: employee.name || employeeId,
      targetUnit,
      tasks,
      ...metrics,
      status: metrics.completedTasks ? 'in_progress' : 'assigned',
      incompleteReason: null,
      submittedAt: null,
      assignedAt: previous?.assignedAt || commandContext.now,
      assignedBy: previous?.assignedBy || serverActorSnapshot(actor),
      updatedAt: commandContext.now,
      updatedBy: serverActorSnapshot(actor),
      history: [...(Array.isArray(previous?.history) ? previous.history : []), historyEntry],
    }
    const notification = {
      id: `notif_${crypto.randomUUID()}`,
      type: 'support-work-assigned',
      storeId: targetUnit === 'office' ? OFFICE_STORE_ID : BUSINESS_SUPPORT_STORE_ID,
      employeeId,
      assignmentId,
      targetUnit,
      route: targetUnit === 'office' ? '/employee/assigned-work' : '/support/assigned-work',
      title: 'Công việc mới từ Admin',
      message: `Bạn có ${tasks.length} công việc được giao cho ngày ${date}.`,
      createdAt: commandContext.now,
      createdBy: serverActorSnapshot(actor),
      readAt: null,
    }
    const nextState = {
      ...state,
      supportWorkAssignments: previous
        ? assignments.map((record) => record === previous ? assignment : record)
        : [assignment, ...assignments],
      notifications: [notification, ...(Array.isArray(state.notifications) ? state.notifications : [])],
      stateVersion: Math.max(1, Number(state.stateVersion) || 1) + 1,
    }
    return commitGlobalStateDomainCommand(db, actor, current, nextState, {
      action: body.type,
      entityType: 'support-work-assignment',
      entityId: assignmentId,
      before: previous,
      after: assignment,
      metadata: {
        employeeId,
        targetUnit,
        date,
        taskCount: tasks.length,
        catalogTaskCount: tasks.filter((task) => Boolean(task.catalogItemId)).length,
        replaced: Boolean(previous),
      },
      response: { command: body.type, assignment, notification },
      status: previous ? 200 : 201,
    }, commandContext)
  }

  if (body.type !== 'support_work.update') {
    throw new ApiError(400, 'COMMAND_UNKNOWN', 'Lệnh giao việc Hỗ trợ KD không được hỗ trợ.')
  }
  const actorEmployeeId = String(actor.employee_id || actor.user_id || '')
  const actorEmployee = (Array.isArray(state.employees) ? state.employees : []).find((record) => (
    employeeIdentifierValues(record).some((identifier) => sameIdentifier(identifier, actorEmployeeId))
  ))
  const actorIsOfficeEmployee = actor.role === 'employee' && employeeUnit(actorEmployee) === 'office'
  if (actor.role !== 'business_support' && !actorIsOfficeEmployee) {
    throw new ApiError(403, 'ROLE_FORBIDDEN', 'Chỉ nhân viên nhận việc được cập nhật tiến độ công việc của mình.')
  }
  const requestedAssignmentId = String(payload.assignmentId || payload.id || '').trim()
  const previousMatch = uniqueIdentifierRecordMatch({
    records: assignments,
    identifier: requestedAssignmentId,
    predicate: (record) => !record.deletedAt,
    collisionCode: 'SUPPORT_WORK_IDENTIFIER_COLLISION',
    collisionMessage: 'Mã lượt giao việc đang trùng với nhiều bản ghi; không thể cập nhật an toàn.',
  })
  const previous = previousMatch?.record || null
  if (!previous) throw new ApiError(404, 'SUPPORT_WORK_NOT_FOUND', 'Không tìm thấy công việc được giao.')
  const assignmentId = String(previous.id || requestedAssignmentId).trim()
  const employeeId = String(actorEmployee?.id || actorEmployee?.code || actorEmployee?.employeeId || actorEmployeeId).trim()
  if (!belongsToEmployee(previous, employeeId)) {
    throw new ApiError(403, 'SUPPORT_WORK_FORBIDDEN', 'Bạn chỉ được cập nhật công việc được giao cho chính mình.')
  }
  if ((previous.targetUnit === 'office') !== actorIsOfficeEmployee) {
    throw new ApiError(403, 'SUPPORT_WORK_FORBIDDEN', 'Nhóm tài khoản không khớp với lượt giao việc.')
  }
  if (previous.submittedAt) {
    throw new ApiError(409, 'SUPPORT_WORK_SUBMITTED', 'Kết quả công việc đã được gửi và không thể thay đổi.')
  }
  const updates = payload.tasks === undefined ? [] : payload.tasks
  if (!Array.isArray(updates) || updates.length > 100) {
    throw new ApiError(400, 'SUPPORT_WORK_PROGRESS_INVALID', 'Tiến độ công việc phải là một danh sách không quá 100 mục.')
  }
  const updateById = new Map()
  for (const update of updates) {
    const id = String(update?.id || '').trim()
    const idKey = normalizeIdentifierKey(id)
    if (!idKey || typeof update?.completed !== 'boolean' || updateById.has(idKey)) {
      throw new ApiError(400, 'SUPPORT_WORK_PROGRESS_INVALID', 'Mỗi tiến độ phải có mã duy nhất và trạng thái completed dạng boolean.')
    }
    const noteProvided = Object.prototype.hasOwnProperty.call(update, 'note')
      || Object.prototype.hasOwnProperty.call(update, 'employeeNote')
    const note = noteProvided ? String(update?.note ?? update?.employeeNote ?? '').trim() : ''
    if (note.length > 1_000) {
      throw new ApiError(400, 'SUPPORT_WORK_TASK_NOTE_INVALID', 'Ghi chú của từng công việc không được vượt quá 1.000 ký tự.')
    }
    updateById.set(idKey, { completed: update.completed, note, noteProvided })
  }
  const knownIds = new Set()
  for (const task of Array.isArray(previous.tasks) ? previous.tasks : []) {
    const idKey = normalizeIdentifierKey(task?.id)
    if (idKey && knownIds.has(idKey)) {
      throw new ApiError(409, 'SUPPORT_WORK_TASK_IDENTIFIER_COLLISION', 'Lượt giao việc có nhiều công việc dùng cùng một mã nhưng khác chữ hoa/thường.')
    }
    if (idKey) knownIds.add(idKey)
  }
  const unknownIds = [...updateById.keys()].filter((id) => !knownIds.has(id))
  if (unknownIds.length) {
    throw new ApiError(400, 'SUPPORT_WORK_TASK_NOT_FOUND', 'Tiến độ chứa công việc không thuộc lượt giao việc này.', { taskIds: unknownIds })
  }
  const changedTaskIds = []
  const tasks = (Array.isArray(previous.tasks) ? previous.tasks : []).map((task) => {
    const id = String(task.id || '')
    const idKey = normalizeIdentifierKey(id)
    if (!updateById.has(idKey)) return task
    const update = updateById.get(idKey)
    const completionChanged = Boolean(task.completed) !== update.completed
    const nextNote = update.noteProvided ? update.note : String(task.employeeNote || '')
    const noteChanged = update.noteProvided && String(task.employeeNote || '') !== nextNote
    if (!completionChanged && !noteChanged) return task
    changedTaskIds.push(id)
    const completed = update.completed
    return {
      ...task,
      completed,
      employeeNote: nextNote,
      completedAt: completionChanged ? (completed ? commandContext.now : null) : task.completedAt || null,
      completedBy: completionChanged ? (completed ? String(actor.user_id || '') : null) : task.completedBy || null,
      completedByActor: completionChanged ? (completed ? serverActorSnapshot(actor) : null) : task.completedByActor || null,
    }
  })
  const submit = payload.submit === true
  if (payload.submit !== undefined && typeof payload.submit !== 'boolean') {
    throw new ApiError(400, 'SUPPORT_WORK_SUBMIT_INVALID', 'Trạng thái gửi kết quả phải là boolean.')
  }
  const metrics = supportWorkMetrics(tasks)
  const reason = String(payload.incompleteReason || '').trim()
  if (reason.length > 1_000) {
    throw new ApiError(400, 'SUPPORT_WORK_REASON_INVALID', 'Lý do chưa hoàn thành không được vượt quá 1.000 ký tự.')
  }
  if (submit && metrics.incompleteRequiredTasks > 0 && !reason) {
    throw new ApiError(400, 'SUPPORT_WORK_REASON_REQUIRED', 'Cần nhập lý do khi gửi kết quả chưa hoàn thành hết công việc.')
  }
  if (!changedTaskIds.length && !submit) {
    return recordNoopCommand(db, actor, {
      command: body.type,
      version: Number(current.version),
      assignment: previous,
      existing: true,
    }, 200, commandContext)
  }
  const status = submit
    ? (metrics.incompleteRequiredTasks === 0 ? 'completed' : 'incomplete')
    : (metrics.completedTasks ? 'in_progress' : 'assigned')
  const historyEntry = {
    action: submit ? 'submitted' : 'progress-updated',
    at: commandContext.now,
    actor: serverActorSnapshot(actor),
    details: {
      changedTaskIds,
      ...metrics,
      tasks: supportWorkTaskHistorySnapshot(tasks),
      ...(submit && metrics.incompleteRequiredTasks > 0 && reason ? { incompleteReason: reason } : {}),
    },
  }
  const assignment = {
    ...previous,
    tasks,
    ...metrics,
    status,
    incompleteReason: submit && metrics.incompleteRequiredTasks > 0 ? reason : null,
    submittedAt: submit ? commandContext.now : null,
    updatedAt: commandContext.now,
    updatedBy: serverActorSnapshot(actor),
    history: [...(Array.isArray(previous.history) ? previous.history : []), historyEntry],
  }
  const assignmentIsOffice = previous.targetUnit === 'office'
  const notification = submit ? {
    id: `notif_${crypto.randomUUID()}`,
    type: 'support-work-submitted',
    storeId: assignmentIsOffice ? OFFICE_STORE_ID : BUSINESS_SUPPORT_STORE_ID,
    audienceRoles: ['admin'],
    assignmentId,
    route: `/admin/assignments?unit=${assignmentIsOffice ? 'office' : 'business_support'}&assignment=${encodeURIComponent(assignmentId)}`,
    title: assignmentIsOffice ? 'Nhân viên Khối văn phòng đã gửi kết quả công việc' : 'Hỗ trợ KD đã gửi kết quả công việc',
    message: `${previous.employeeName || employeeId} hoàn thành ${metrics.completedTasks}/${metrics.totalTasks} công việc ngày ${previous.date}.`,
    createdAt: commandContext.now,
    createdBy: serverActorSnapshot(actor),
    readAt: null,
  } : null
  const nextState = {
    ...state,
    supportWorkAssignments: assignments.map((record) => record === previous ? assignment : record),
    notifications: notification
      ? [notification, ...(Array.isArray(state.notifications) ? state.notifications : [])]
      : state.notifications,
    stateVersion: Math.max(1, Number(state.stateVersion) || 1) + 1,
  }
  return commitGlobalStateDomainCommand(db, actor, current, nextState, {
    action: body.type,
    entityType: 'support-work-assignment',
    entityId: assignmentId,
    before: previous,
    after: assignment,
    metadata: { employeeId, changedTaskIds, submitted: submit, ...metrics },
    response: { command: body.type, assignment, ...(notification ? { notification } : {}) },
  }, commandContext)
}

const supportScheduleCommand = async (db, actor, body, commandContext) => {
  if (!['support_schedule.assign', 'support_schedule.delete'].includes(body.type)) {
    throw new ApiError(400, 'COMMAND_UNKNOWN', 'Lệnh phân lịch làm việc không được hỗ trợ.')
  }
  const payload = isPlainRecord(body.payload) ? body.payload : {}
  const { current, state } = await loadGlobalCommandState(db, body)
  const schedules = Array.isArray(state.supportWorkSchedules) ? state.supportWorkSchedules : []
  const actorEmployeeId = String(actor.employee_id || '').trim()
  const actorEmployee = uniqueEmployeeIdentifierRecordMatch({
    records: state.employees,
    identifier: actorEmployeeId,
    predicate: (record) => !record.deletedAt,
  })?.record || null
  const canonicalActorEmployeeId = String(
    actorEmployee?.id || actorEmployee?.code || actorEmployee?.employeeId || actorEmployeeId,
  ).trim()
  const selfManagingOfficeSchedule = actor.role === 'employee' && employeeUnit(actorEmployee) === 'office'
  if (!['admin', 'business_support'].includes(actor.role) && !selfManagingOfficeSchedule) {
    throw new ApiError(403, 'ROLE_FORBIDDEN', 'Chỉ Admin, Nhân viên hỗ trợ KD hoặc nhân viên văn phòng tự quản lý lịch của mình được thực hiện thao tác này.')
  }
  if (body.type === 'support_schedule.delete') {
    const scheduleId = String(payload.scheduleId || payload.id || '').trim()
    const previousMatch = uniqueIdentifierRecordMatch({
      records: schedules,
      identifier: scheduleId,
      predicate: (record) => !record.deletedAt,
      collisionCode: 'SUPPORT_SCHEDULE_IDENTIFIER_COLLISION',
      collisionMessage: 'Mã lịch làm việc đang trùng với nhiều bản ghi; không thể xóa an toàn.',
    })
    const previous = previousMatch?.record || null
    if (!previous) throw new ApiError(404, 'SUPPORT_SCHEDULE_NOT_FOUND', 'Không tìm thấy lịch làm việc.')
    if (selfManagingOfficeSchedule && (
      !sameIdentifier(previous.employeeId, canonicalActorEmployeeId)
      || previous.targetUnit !== 'office'
    )) {
      throw new ApiError(403, 'SUPPORT_SCHEDULE_SELF_ONLY', 'Nhân viên văn phòng chỉ được xóa lịch làm việc của chính mình.')
    }
    const reason = String(payload.reason || '').trim().slice(0, 500)
    if (!reason) throw new ApiError(400, 'REASON_REQUIRED', 'Cần nhập lý do xóa lịch làm việc.')
    const history = {
      ...previous,
      id: `swsh_${crypto.randomUUID()}`,
      scheduleId: String(previous.id || scheduleId),
      action: 'Xóa lịch',
      reason,
      recordedAt: commandContext.now,
      recordedBy: serverActorSnapshot(actor),
    }
    const nextState = {
      ...state,
      supportWorkSchedules: schedules.filter((record, index) => index !== previousMatch.index),
      supportWorkScheduleHistory: [history, ...(Array.isArray(state.supportWorkScheduleHistory) ? state.supportWorkScheduleHistory : [])],
      stateVersion: Math.max(1, Number(state.stateVersion) || 1) + 1,
    }
    return commitGlobalStateDomainCommand(db, actor, current, nextState, {
      action: body.type,
      entityType: 'support-work-schedule',
      entityId: String(previous.id || scheduleId),
      before: previous,
      after: null,
      metadata: { employeeId: previous.employeeId, targetUnit: previous.targetUnit, date: previous.date, reason },
      response: { command: body.type, schedule: previous, history },
    }, commandContext)
  }
  const requestedEmployeeId = String(payload.employeeId || '').trim()
  if (selfManagingOfficeSchedule && requestedEmployeeId && !sameIdentifier(requestedEmployeeId, canonicalActorEmployeeId)) {
    throw new ApiError(403, 'SUPPORT_SCHEDULE_SELF_ONLY', 'Nhân viên văn phòng chỉ được tạo hoặc sửa lịch làm việc của chính mình.')
  }
  const submittedEmployeeId = selfManagingOfficeSchedule ? canonicalActorEmployeeId : requestedEmployeeId
  const targetUnit = selfManagingOfficeSchedule ? 'office' : payload.targetUnit === 'office' ? 'office' : 'business_support'
  const date = optionalCalendarDate(payload.date, 'Ngày làm việc')
  if (!submittedEmployeeId || !date) throw new ApiError(400, 'SUPPORT_SCHEDULE_REQUIRED', 'Cần chọn ngày và nhân viên.')
  const employee = uniqueEmployeeIdentifierRecordMatch({
    records: state.employees,
    identifier: submittedEmployeeId,
    predicate: (record) => employeeUnit(record) === targetUnit && !record.deletedAt,
  })?.record || null
  if (!employee) throw new ApiError(404, 'SUPPORT_EMPLOYEE_NOT_FOUND', `Không tìm thấy ${targetUnit === 'office' ? 'nhân viên Khối văn phòng' : 'Nhân viên hỗ trợ KD'} đang hoạt động.`)
  const employeeId = String(employee.id || employee.code || employee.employeeId || submittedEmployeeId).trim()
  const start = parseShiftTime(payload.start)
  const end = parseShiftTime(payload.end)
  if (!start || !end || end.minuteOfDay <= start.minuteOfDay) {
    throw new ApiError(400, 'SUPPORT_SCHEDULE_TIME_INVALID', 'Giờ bắt đầu và kết thúc phải hợp lệ trong cùng ngày.')
  }
  const employmentType = officeEmploymentType(employee.employmentType || employee.workTimeType || 'Full-Time')
  const partTime = ['Part-Time', 'Thực Tập Sinh'].includes(employmentType)
  const shiftName = String(payload.shiftName || '').trim().slice(0, 80)
  if (partTime && !shiftName) throw new ApiError(400, 'SUPPORT_SCHEDULE_SHIFT_NAME_REQUIRED', 'Nhân viên Part-Time/Thực Tập Sinh cần tên ca làm việc.')
  const requestedScheduleId = String(payload.scheduleId || '').trim()
  const previousMatch = requestedScheduleId
    ? uniqueIdentifierRecordMatch({
        records: schedules,
        identifier: requestedScheduleId,
        predicate: (record) => !record.deletedAt,
        collisionCode: 'SUPPORT_SCHEDULE_IDENTIFIER_COLLISION',
        collisionMessage: 'Mã lịch làm việc đang trùng với nhiều bản ghi; không thể sửa an toàn.',
      })
    : null
  const scopedPreviousSchedules = requestedScheduleId ? [] : schedules.filter((record) => (
    sameIdentifier(record.employeeId, employeeId)
    && String(record.date || '') === date
    && !record.deletedAt
  ))
  if (!requestedScheduleId && scopedPreviousSchedules.length > 1) {
    throw new ApiError(409, 'SUPPORT_SCHEDULE_SCOPE_COLLISION', 'Nhân viên có nhiều lịch làm việc trong cùng ngày; cần xử lý dữ liệu trùng trước khi tiếp tục.')
  }
  const previous = previousMatch?.record || scopedPreviousSchedules[0] || null
  if (requestedScheduleId && !previous) throw new ApiError(404, 'SUPPORT_SCHEDULE_NOT_FOUND', 'Không tìm thấy lịch làm việc cần sửa.')
  if (selfManagingOfficeSchedule && previous && (
    !sameIdentifier(previous.employeeId, canonicalActorEmployeeId)
    || previous.targetUnit !== 'office'
  )) {
    throw new ApiError(403, 'SUPPORT_SCHEDULE_SELF_ONLY', 'Nhân viên văn phòng chỉ được sửa lịch làm việc của chính mình.')
  }
  const targetCollision = schedules.find((record) => (
    !sameIdentifier(record.id, previous?.id)
    && sameIdentifier(record.employeeId, employeeId)
    && String(record.date || '') === date
    && !record.deletedAt
  ))
  if (targetCollision) throw new ApiError(409, 'SUPPORT_SCHEDULE_EXISTS', 'Nhân viên đã có lịch làm việc trong ngày này.')
  const id = previous?.id || `sws_${crypto.randomUUID()}`
  const previousIndex = previous ? schedules.indexOf(previous) : -1
  const version = Number(previous?.version || 0) + 1
  const schedule = {
    id,
    employeeId,
    employeeName: employee.name || employeeId,
    targetUnit,
    date,
    employmentType,
    shiftName: partTime ? shiftName : (shiftName || 'Làm việc Full-Time'),
    start: start.label,
    end: end.label,
    note: String(payload.note || '').trim().slice(0, 500),
    version,
    createdAt: previous?.createdAt || commandContext.now,
    createdBy: previous?.createdBy || serverActorSnapshot(actor),
    updatedAt: commandContext.now,
    updatedBy: serverActorSnapshot(actor),
  }
  const history = {
    ...schedule,
    id: `swsh_${crypto.randomUUID()}`,
    scheduleId: id,
    action: previous ? 'Cập nhật lịch' : 'Tạo lịch',
    recordedAt: commandContext.now,
    recordedBy: serverActorSnapshot(actor),
  }
  const notification = {
    id: `ntf_${crypto.randomUUID()}`,
    type: 'support-schedule-assigned',
    employeeId,
    targetEmployeeId: employeeId,
    targetUnit,
    route: targetUnit === 'office' ? '/employee/schedule' : '/support/my-schedule',
    title: 'Lịch làm việc đã được cập nhật',
    message: `${date}: ${schedule.shiftName} ${schedule.start}–${schedule.end}`,
    scheduleId: id,
    createdAt: commandContext.now,
    createdBy: serverActorSnapshot(actor),
    readAt: null,
  }
  const nextState = {
    ...state,
    supportWorkSchedules: previous
      ? schedules.map((record, index) => index === previousIndex ? schedule : record)
      : [schedule, ...schedules],
    supportWorkScheduleHistory: [history, ...(Array.isArray(state.supportWorkScheduleHistory) ? state.supportWorkScheduleHistory : [])],
    notifications: [notification, ...(Array.isArray(state.notifications) ? state.notifications : [])],
    stateVersion: Math.max(1, Number(state.stateVersion) || 1) + 1,
  }
  return commitGlobalStateDomainCommand(db, actor, current, nextState, {
    action: body.type,
    entityType: 'support-work-schedule',
    entityId: id,
    before: previous,
    after: schedule,
    metadata: { employeeId, targetUnit, date, version },
    response: { command: body.type, schedule, history },
  }, commandContext)
}

const taskDoneCommand = async (db, actor, body, commandContext) => {
  if (actor.role !== 'employee') {
    throw new ApiError(403, 'ROLE_FORBIDDEN', 'Lệnh hoàn thành công việc chỉ dành cho nhân viên.')
  }
  const payload = isPlainRecord(body.payload) ? body.payload : {}
  if (typeof payload.done !== 'boolean') {
    throw new ApiError(400, 'TASK_STATUS_INVALID', 'Trạng thái công việc phải là true hoặc false.')
  }
  const { current, state } = await loadGlobalCommandState(db, body)
  const taskId = String(payload.taskId || payload.id || '').trim()
  const tasks = Array.isArray(state.tasks) ? state.tasks : []
  const matchingTasks = tasks
    .map((task, index) => ({ task, index }))
    .filter(({ task }) => sameIdentifier(task.id, taskId) && !task.deletedAt)
  if (matchingTasks.length > 1) {
    throw new ApiError(
      409,
      'TASK_IDENTIFIER_COLLISION',
      'Mã công việc đang trùng với nhiều bản ghi; không thể cập nhật an toàn.',
      {
        identifier: normalizeIdentifierKey(taskId),
        conflictingIdentifiers: matchingTasks.map(({ task }) => String(task.id || '')),
      },
    )
  }
  const previousMatch = matchingTasks[0] || null
  const previous = previousMatch?.task || null
  if (!previous) throw new ApiError(404, 'TASK_NOT_FOUND', 'Không tìm thấy công việc.')
  const employeeId = String(actor.employee_id || actor.user_id || '')
  const storeId = String(actor.store_id || '')
  if (!taskAppliesToEmployee(previous, employeeId, storeId)) {
    throw new ApiError(403, 'TASK_FORBIDDEN', 'Công việc không thuộc cửa hàng của bạn.')
  }
  const localNow = localDateTimeParts(commandContext.now)
  const taskDate = String(previous.date || previous.workDate || '')
  if (taskDate && taskDate !== localNow.date) {
    throw new ApiError(409, 'TASK_DATE_INVALID', 'Chỉ được cập nhật công việc của ngày hiện tại.')
  }
  const taskShiftId = String(previous.shiftId || previous.shift || '')
  if (taskShiftId) {
    const openAttendance = (Array.isArray(state.attendance) ? state.attendance : []).find((record) => (
      belongsToEmployee(record, employeeId)
      && !record.deletedAt
      && !record.checkOutAt
      && !record.checkOut
    ))
    if (!openAttendance || !sameIdentifier(openAttendance.shiftId || openAttendance.shift, taskShiftId)) {
      throw new ApiError(409, 'TASK_SHIFT_INVALID', 'Công việc không thuộc ca đang mở của bạn.')
    }
  }
  const completedBy = isPlainRecord(previous.completedBy) ? previous.completedBy : {}
  if (completedByEmployeeValue(completedBy, employeeId) === true && payload.done === false) {
    throw new ApiError(409, 'TASK_COMPLETION_IMMUTABLE', 'Công việc đã lưu hoàn thành không thể bỏ chọn hoặc gửi lại.')
  }
  if (Boolean(completedByEmployeeValue(completedBy, employeeId)) === payload.done
    && Object.keys(completedBy).some((candidateId) => sameIdentifier(candidateId, employeeId))) {
    return recordNoopCommand(db, actor, {
      command: body.type,
      version: Number(current.version),
      task: { ...previous, completedBy: { [employeeId]: payload.done } },
      existing: true,
    }, 200, commandContext)
  }
  const next = {
    ...previous,
    completedBy: withCanonicalIdentifierEntry(completedBy, employeeId, payload.done),
    completionHistory: [
      ...(Array.isArray(previous.completionHistory) ? previous.completionHistory : []),
      {
        done: payload.done,
        at: commandContext.now,
        employeeId,
        actor: serverActorSnapshot(actor),
      },
    ],
    updatedAt: commandContext.now,
    updatedBy: serverActorSnapshot(actor),
  }
  const completionEvent = {
    taskId: previous.id,
    employeeId,
    done: payload.done,
    at: commandContext.now,
    actor: serverActorSnapshot(actor),
  }
  const assignmentHistories = Array.isArray(state.taskAssignmentHistory) ? state.taskAssignmentHistory : []
  const matchingAssignmentHistories = previous.assignmentId
    ? assignmentHistories.filter((assignment) => (
        sameIdentifier(assignment.assignmentId || assignment.id, previous.assignmentId)
      ))
    : []
  if (matchingAssignmentHistories.length > 1) {
    throw new ApiError(
      409,
      'TASK_ASSIGNMENT_IDENTIFIER_COLLISION',
      'Lịch sử giao việc có mã lượt giao bị trùng; cần xử lý dữ liệu trước khi cập nhật tiến độ.',
      {
        normalizedIdentifier: normalizeIdentifierKey(previous.assignmentId),
        conflictingIdentifiers: matchingAssignmentHistories.map((assignment) => (
          String(assignment.assignmentId || assignment.id || '')
        )),
      },
    )
  }
  const matchingAssignmentHistory = matchingAssignmentHistories[0] || null
  const matchingHistoryTask = matchingAssignmentHistory
    ? uniqueIdentifierRecordMatch({
        records: matchingAssignmentHistory.tasks,
        identifier: previous.id,
        identifierOf: (task) => task?.id,
        collisionCode: 'TASK_HISTORY_IDENTIFIER_COLLISION',
        collisionMessage: 'Lịch sử giao việc có mã công việc bị trùng; không thể cập nhật tiến độ an toàn.',
      })?.record || null
    : null
  const taskAssignmentHistory = assignmentHistories
    .map((assignment) => {
       if (!previous.assignmentId || assignment !== matchingAssignmentHistory) {
        return assignment
      }
      return {
        ...assignment,
        tasks: (Array.isArray(assignment.tasks) ? assignment.tasks : []).map((task) => (
          task === matchingHistoryTask
            ? {
                ...task,
                completedBy: withCanonicalIdentifierEntry(task.completedBy, employeeId, payload.done),
              }
            : task
        )),
        progressHistory: [
          ...(Array.isArray(assignment.progressHistory) ? assignment.progressHistory : []),
          completionEvent,
        ],
        updatedAt: commandContext.now,
        updatedBy: serverActorSnapshot(actor),
      }
    })
  const nextState = {
    ...state,
    tasks: tasks.map((task, index) => index === previousMatch.index ? next : task),
    taskAssignmentHistory,
    stateVersion: Math.max(1, Number(state.stateVersion) || 1) + 1,
  }
  return commitGlobalStateDomainCommand(db, actor, current, nextState, {
    action: body.type,
    entityType: 'task-completion',
    entityId: `${previous.id}:${employeeId}`,
    before: { taskId: previous.id, employeeId, done: Boolean(completedByEmployeeValue(completedBy, employeeId)) },
    after: { taskId: previous.id, employeeId, done: payload.done },
    metadata: { taskId: previous.id, employeeId, storeId, assignmentId: previous.assignmentId || null },
    response: {
      command: body.type,
      task: { ...next, completedBy: { [employeeId]: payload.done } },
    },
  }, commandContext)
}

const taskProgressCommand = async (db, actor, body, commandContext) => {
  if (!['employee', 'business_support'].includes(actor.role)) {
    throw new ApiError(403, 'ROLE_FORBIDDEN', 'Chỉ nhân viên được gửi kết quả công việc trong ca.')
  }
  const payload = isPlainRecord(body.payload) ? body.payload : {}
  const { current, state } = await loadGlobalCommandState(db, body)
  const employeeId = String(actor.employee_id || actor.user_id || '').trim()
  const employee = uniqueEmployeeIdentifierRecordMatch({
    records: state.employees,
    identifier: employeeId,
    predicate: (record) => !record.deletedAt,
  })?.record || null
  const targetUnit = employee ? employeeUnit(employee) : ''
  if (!employee || !['store', 'office', 'business_support'].includes(targetUnit)) {
    throw new ApiError(403, 'EMPLOYEE_PROFILE_REQUIRED', 'Tài khoản chưa được liên kết với hồ sơ nhân viên hợp lệ.')
  }
  const attendance = Array.isArray(state.attendance) ? state.attendance : []
  const attendanceId = String(payload.attendanceId || '').trim()
  const ownOpenAttendance = attendance.filter((record) => (
    belongsToEmployee(record, employeeId)
    && !record.deletedAt
    && !record.checkOutAt
    && !record.checkOut
  ))
  const openAttendance = attendanceId
    ? uniqueIdentifierRecordMatch({
        records: ownOpenAttendance,
        identifier: attendanceId,
        collisionCode: 'ATTENDANCE_IDENTIFIER_COLLISION',
        collisionMessage: 'Mã chấm công đang trùng với nhiều bản ghi; không thể lưu kết quả công việc an toàn.',
      })?.record
    : (ownOpenAttendance.length === 1 ? ownOpenAttendance[0] : null)
  if (!attendanceId && ownOpenAttendance.length > 1) {
    throw new ApiError(409, 'ATTENDANCE_AMBIGUOUS', 'Có nhiều ca đang mở; cần chỉ rõ mã chấm công.')
  }
  if (!openAttendance) {
    throw new ApiError(409, 'OPEN_ATTENDANCE_REQUIRED', 'Bạn cần điểm danh và đang trong ca để lưu kết quả công việc.')
  }
  const attendanceReferenceMatches = (reference) => mutationIdentifierReferenceMatchesRecord({
    records: attendance,
    record: openAttendance,
    reference,
    collisionCode: 'ATTENDANCE_REFERENCE_COLLISION',
    collisionMessage: 'Mã chấm công tham chiếu trong công việc đang mơ hồ; cần xử lý dữ liệu trùng trước khi lưu tiến độ.',
  })
  const storeId = String(openAttendance.storeId || '')
  const date = String(openAttendance.date || openAttendance.workDate || '').slice(0, 10)
  const shiftId = String(openAttendance.shiftId || openAttendance.shift || '')
  const scopedTasks = (Array.isArray(state.tasks) ? state.tasks : []).filter((task) => {
    if (!taskAppliesToEmployee(task, employeeId, storeId)) return false
    if (String(task.date || task.workDate || '').slice(0, 10) !== date) return false
    const checklistAttendanceId = String(task.checklistAttendanceId || '').trim()
    if (checklistAttendanceId && !attendanceReferenceMatches(checklistAttendanceId)) return false
    const taskShiftId = String(task.shiftId || task.shift || '')
    return !taskShiftId || sameIdentifier(taskShiftId, shiftId)
  })
  if (!scopedTasks.length) {
    throw new ApiError(404, 'TASKS_NOT_FOUND', 'Ca đang làm chưa có công việc được giao.')
  }
  if (!Array.isArray(payload.tasks) || payload.tasks.length < 1) {
    throw new ApiError(400, 'TASK_PROGRESS_INVALID', 'Cần gửi trạng thái của toàn bộ công việc trong ca.')
  }
  const scopedById = new Map(scopedTasks.map((task) => [normalizeIdentifierKey(task.id), task]))
  if (scopedById.size !== scopedTasks.length) {
    throw new ApiError(409, 'TASK_IDENTIFIER_COLLISION', 'Ca đang làm có nhiều công việc trùng mã; không thể cập nhật an toàn.')
  }
  const scopedTaskRecords = new Set(scopedTasks)
  const submittedById = new Map()
  for (const item of payload.tasks) {
    const taskId = String(item?.id || item?.taskId || '').trim()
    const taskKey = normalizeIdentifierKey(taskId)
    if (!taskKey || !scopedById.has(taskKey) || submittedById.has(taskKey) || typeof item?.completed !== 'boolean') {
      throw new ApiError(400, 'TASK_PROGRESS_INVALID', 'Danh sách kết quả có công việc không hợp lệ hoặc không thuộc ca đang làm.')
    }
    submittedById.set(taskKey, item.completed)
  }
  if (submittedById.size !== scopedById.size || [...scopedById.keys()].some((taskId) => !submittedById.has(taskId))) {
    throw new ApiError(400, 'TASK_PROGRESS_INCOMPLETE', 'Cần gửi trạng thái của đầy đủ công việc được giao trong ca.')
  }
  const revertedTask = scopedTasks.find((task) => (
    completedByEmployeeValue(task.completedBy, employeeId) === true
    && submittedById.get(normalizeIdentifierKey(task.id)) !== true
  ))
  if (revertedTask) {
    throw new ApiError(409, 'TASK_COMPLETION_IMMUTABLE', 'Công việc đã lưu hoàn thành không thể bỏ chọn hoặc gửi lại.')
  }
  const requestedIncompleteReason = String(payload.incompleteReason || payload.note || '').trim()
  if (requestedIncompleteReason.length > 1_000) {
    throw new ApiError(400, 'INCOMPLETE_TASK_REASON_INVALID', 'Ghi chú chưa hoàn thành không được vượt quá 1.000 ký tự.')
  }
  const requiredTaskIds = new Set(scopedTasks.filter(workTaskIsRequired).map((task) => normalizeIdentifierKey(task.id)))
  const incompleteTaskIds = [...submittedById]
    .filter(([taskId, completed]) => requiredTaskIds.has(taskId) && !completed)
    .map(([taskId]) => String(scopedById.get(taskId)?.id || taskId))
  if (incompleteTaskIds.length && !requestedIncompleteReason) {
    throw new ApiError(400, 'INCOMPLETE_TASK_REASON_REQUIRED', 'Cần nhập ghi chú khi chưa hoàn thành tất cả công việc.', {
      taskIds: incompleteTaskIds,
    })
  }
  const incompleteReason = incompleteTaskIds.length ? requestedIncompleteReason : ''
  const normalizedStatuses = [...submittedById].sort(([left], [right]) => left.localeCompare(right))
  const mandatoryProgress = (taskIds = requiredTaskIds) => {
    const mandatoryIds = taskIds instanceof Set ? taskIds : new Set(taskIds)
    const totalTasks = mandatoryIds.size
    const completedTasks = [...mandatoryIds]
      .filter((taskId) => submittedById.get(taskId) === true)
      .length
    return {
      totalTasks,
      completedTasks,
      completionRate: totalTasks ? Math.round((completedTasks / totalTasks) * 100) : 0,
    }
  }
  const submissionFingerprint = JSON.stringify({ attendanceId: openAttendance.id, tasks: normalizedStatuses, incompleteReason })
  const histories = Array.isArray(state.taskAssignmentHistory) ? state.taskAssignmentHistory : []
  const assignmentIds = [...new Set(scopedTasks.map((task) => String(task.assignmentId || '')).filter(Boolean))]
  const assignmentIdKeys = new Set(assignmentIds.map(normalizeIdentifierKey))
  if (assignmentIdKeys.size !== assignmentIds.length) {
    throw new ApiError(
      409,
      'TASK_ASSIGNMENT_IDENTIFIER_COLLISION',
      'Ca đang làm có nhiều lượt giao việc trùng mã; không thể cập nhật tiến độ an toàn.',
      { conflictingIdentifiers: assignmentIds },
    )
  }
  const historyCountsByAssignmentKey = new Map()
  for (const assignment of histories) {
    const assignmentId = String(assignment.assignmentId || assignment.id || '').trim()
    const assignmentKey = normalizeIdentifierKey(assignmentId)
    if (!assignmentIdKeys.has(assignmentKey)) continue
    const matches = historyCountsByAssignmentKey.get(assignmentKey) || []
    matches.push(assignmentId)
    historyCountsByAssignmentKey.set(assignmentKey, matches)
  }
  const collidingAssignmentHistory = [...historyCountsByAssignmentKey]
    .find(([, identifiers]) => identifiers.length > 1)
  if (collidingAssignmentHistory) {
    throw new ApiError(
      409,
      'TASK_ASSIGNMENT_IDENTIFIER_COLLISION',
      'Lịch sử giao việc có mã lượt giao bị trùng; cần xử lý dữ liệu trước khi cập nhật tiến độ.',
      {
        normalizedIdentifier: collidingAssignmentHistory[0],
        conflictingIdentifiers: collidingAssignmentHistory[1],
      },
    )
  }
  const existingSubmission = histories.flatMap((assignment) => (
    Array.isArray(assignment.progressHistory) ? assignment.progressHistory : []
  )).find((event) => (
    event?.action === 'progress-submitted'
    && sameIdentifier(event.employeeId, employeeId)
    && mutationIdentifierReferenceMatchesRecord({
      records: state.attendance,
      record: openAttendance,
      reference: event.attendanceId,
      collisionCode: 'ATTENDANCE_REFERENCE_COLLISION',
      collisionMessage: 'Lịch sử tiến độ đang tham chiếu mơ hồ tới nhiều bản chấm công; không thể ghi nhận an toàn.',
    })
    && String(event.fingerprint || '') === submissionFingerprint
  ))
  if (existingSubmission) {
    const { completedTasks, totalTasks, completionRate } = mandatoryProgress()
    const existingResult = {
      attendanceId: openAttendance.id,
      employeeId,
      totalTasks,
      completedTasks,
      completionRate,
      incompleteReason,
      submittedAt: existingSubmission.at,
    }
    return recordNoopCommand(db, actor, {
      command: body.type,
      version: Number(current.version),
      ...existingResult,
      existing: true,
    }, 200, commandContext)
  }

  const nextTasks = (Array.isArray(state.tasks) ? state.tasks : []).map((task) => {
    if (!scopedTaskRecords.has(task)) return task
    const taskId = normalizeIdentifierKey(task.id)
    if (!submittedById.has(taskId)) return task
    const completed = submittedById.get(taskId)
    const completedBy = isPlainRecord(task.completedBy) ? task.completedBy : {}
    if (Boolean(completedByEmployeeValue(completedBy, employeeId)) === completed
      && Object.keys(completedBy).some((candidateId) => sameIdentifier(candidateId, employeeId))) return task
    const event = { done: completed, at: commandContext.now, employeeId, actor: serverActorSnapshot(actor) }
    return {
      ...task,
      completedBy: withCanonicalIdentifierEntry(completedBy, employeeId, completed),
      completionHistory: [...(Array.isArray(task.completionHistory) ? task.completionHistory : []), event],
      updatedAt: commandContext.now,
      updatedBy: serverActorSnapshot(actor),
    }
  })
  const assignmentResults = []
  const progressEventBase = {
    action: 'progress-submitted',
    employeeId,
    employeeName: employee.name || employeeId,
    attendanceId: openAttendance.id,
    storeId,
    date,
    shiftId,
    incompleteReason: incompleteTaskIds.length ? incompleteReason : '',
    fingerprint: submissionFingerprint,
    at: commandContext.now,
    actor: serverActorSnapshot(actor),
  }
  const historyTaskUpdates = new Map()
  for (const assignment of histories) {
    const assignmentId = String(assignment.assignmentId || assignment.id || '')
    if (!assignmentIdKeys.has(normalizeIdentifierKey(assignmentId))) continue
    const assignmentTasks = scopedTasks.filter((task) => sameIdentifier(task.assignmentId, assignmentId))
    const taskUpdates = new Map()
    for (const scopedTask of assignmentTasks) {
      const historyTask = uniqueIdentifierRecordMatch({
        records: assignment.tasks,
        identifier: scopedTask.id,
        identifierOf: (task) => task?.id,
        collisionCode: 'TASK_HISTORY_IDENTIFIER_COLLISION',
        collisionMessage: 'Lịch sử giao việc có mã công việc bị trùng; không thể cập nhật tiến độ an toàn.',
      })?.record || null
      if (historyTask) {
        taskUpdates.set(historyTask, submittedById.get(normalizeIdentifierKey(scopedTask.id)))
      }
    }
    historyTaskUpdates.set(assignment, taskUpdates)
  }
  const nextHistories = histories.map((assignment) => {
    const assignmentId = String(assignment.assignmentId || assignment.id || '')
    const taskUpdates = historyTaskUpdates.get(assignment)
    if (!taskUpdates) return assignment
    const assignmentTasks = scopedTasks.filter((task) => sameIdentifier(task.assignmentId, assignmentId))
    const assignmentRequiredTaskIds = assignmentTasks
      .filter(workTaskIsRequired)
      .map((task) => normalizeIdentifierKey(task.id))
    const completedRequiredTasks = assignmentRequiredTaskIds
      .filter((taskId) => submittedById.get(taskId) === true)
      .length
    const { totalTasks, completedTasks, completionRate } = mandatoryProgress(assignmentRequiredTaskIds)
    const requiredTasks = assignmentRequiredTaskIds.length
    const requiredComplete = completedRequiredTasks === requiredTasks
    const result = { assignmentId, totalTasks, completedTasks, completionRate, requiredTasks, completedRequiredTasks }
    assignmentResults.push(result)
    const progressEvent = { ...progressEventBase, ...result }
    return {
      ...assignment,
      tasks: (Array.isArray(assignment.tasks) ? assignment.tasks : []).map((task) => {
        if (!taskUpdates.has(task)) return task
        return {
          ...task,
          completedBy: withCanonicalIdentifierEntry(task.completedBy, employeeId, taskUpdates.get(task)),
        }
      }),
      status: requiredComplete ? 'completed' : 'incomplete',
      completionRate,
      completedTasks,
      totalTasks,
      incompleteReason: requiredComplete ? '' : incompleteReason,
      completionByEmployee: withCanonicalIdentifierEntry(
        assignment.completionByEmployee,
        employeeId,
        {
          completedTasks,
          totalTasks,
          completionRate,
          requiredTasks,
          completedRequiredTasks,
          incompleteReason: requiredComplete ? '' : incompleteReason,
          submittedAt: commandContext.now,
          attendanceId: openAttendance.id,
        },
      ),
      progressHistory: [...(Array.isArray(assignment.progressHistory) ? assignment.progressHistory : []), progressEvent],
      submittedAt: commandContext.now,
      updatedAt: commandContext.now,
      updatedBy: serverActorSnapshot(actor),
    }
  })
  const allTaskCount = scopedTasks.length
  const { totalTasks, completedTasks, completionRate } = mandatoryProgress()
  const requiredTasks = requiredTaskIds.size
  const completedRequiredTasks = [...submittedById]
    .filter(([taskId, completed]) => requiredTaskIds.has(taskId) && completed)
    .length
  const rewardTasks = allTaskCount - requiredTasks
  const completedRewardTasks = [...submittedById]
    .filter(([taskId, completed]) => !requiredTaskIds.has(taskId) && completed)
    .length
  const notifications = (assignmentIds.length ? assignmentResults : [{ assignmentId: '', totalTasks, completedTasks, completionRate }])
    .map((result) => ({
      id: `ntf_${crypto.randomUUID()}`,
      type: 'store-task-progress-submitted',
      storeId,
      employeeId,
      attendanceId: openAttendance.id,
      assignmentId: result.assignmentId || null,
      route: `/store/tasks${result.assignmentId ? `?assignment=${encodeURIComponent(result.assignmentId)}` : ''}`,
      title: `${employee.name || employeeId} đã gửi kết quả công việc`,
      message: `Hoàn thành ${result.completedTasks}/${result.totalTasks} công việc (${result.completionRate}%).`,
      createdAt: commandContext.now,
      createdBy: serverActorSnapshot(actor),
      readAt: null,
    }))
  const nextState = {
    ...state,
    tasks: nextTasks,
    taskAssignmentHistory: nextHistories,
    notifications: [...notifications, ...(Array.isArray(state.notifications) ? state.notifications : [])],
    stateVersion: Math.max(1, Number(state.stateVersion) || 1) + 1,
  }
  const result = {
    attendanceId: openAttendance.id,
    employeeId,
    totalTasks,
    completedTasks,
    completionRate,
    requiredTasks,
    completedRequiredTasks,
    rewardTasks,
    completedRewardTasks,
    incompleteReason: incompleteTaskIds.length ? incompleteReason : '',
    submittedAt: commandContext.now,
    assignments: assignmentResults,
  }
  return commitGlobalStateDomainCommand(db, actor, current, nextState, {
    action: body.type,
    entityType: 'task-progress',
    entityId: `${openAttendance.id}:${employeeId}`,
    before: scopedTasks.map((task) => ({ id: task.id, completed: Boolean(completedByEmployeeValue(task.completedBy, employeeId)) })),
    after: normalizedStatuses.map(([id, completed]) => ({ id: String(scopedById.get(id)?.id || id), completed })),
    metadata: { storeId, date, shiftId, attendanceId: openAttendance.id, completionRate, incompleteTaskIds },
    response: { command: body.type, ...result, notifications },
  }, commandContext)
}

const shiftExpenseCommand = async (db, actor, body, commandContext) => {
  if (actor.role !== 'employee') {
    throw new ApiError(403, 'ROLE_FORBIDDEN', 'Chỉ nhân viên cửa hàng được nhập chi phí trong ca.')
  }
  const payload = isPlainRecord(body.payload) ? body.payload : {}
  const { current, state } = await loadGlobalCommandState(db, body)
  const actorEmployeeId = String(actor.employee_id || actor.user_id || '').trim()
  const employee = (Array.isArray(state.employees) ? state.employees : []).find((record) => (
    [record.id, record.code, record.employeeId].some((candidateId) => sameIdentifier(candidateId, actorEmployeeId))
  ))
  if (!employee || employeeUnit(employee) !== 'store') {
    throw new ApiError(403, 'STORE_EMPLOYEE_REQUIRED', 'Chức năng này chỉ dành cho nhân viên cửa hàng.')
  }
  const employeeId = String(employee.id || employee.code || employee.employeeId || actorEmployeeId).trim()
  const attendance = Array.isArray(state.attendance) ? state.attendance : []
  const attendanceId = String(payload.attendanceId || '').trim()
  const ownOpenAttendance = attendance.filter((record) => (
    belongsToEmployee(record, employeeId)
    && !record.deletedAt
    && !record.checkOutAt
    && !record.checkOut
  ))
  const openAttendance = attendanceId
    ? uniqueIdentifierRecordMatch({
        records: ownOpenAttendance,
        identifier: attendanceId,
        collisionCode: 'ATTENDANCE_IDENTIFIER_COLLISION',
        collisionMessage: 'Mã chấm công đang trùng với nhiều bản ghi; không thể ghi nhận chi phí an toàn.',
      })?.record
    : (ownOpenAttendance.length === 1 ? ownOpenAttendance[0] : null)
  if (!attendanceId && ownOpenAttendance.length > 1) {
    throw new ApiError(409, 'ATTENDANCE_AMBIGUOUS', 'Có nhiều ca đang mở; cần chỉ rõ mã chấm công.')
  }
  if (!openAttendance) {
    throw new ApiError(409, 'OPEN_ATTENDANCE_REQUIRED', 'Bạn cần điểm danh và đang trong ca để nhập chi phí.')
  }
  const attendanceReferenceMatches = (reference) => mutationIdentifierReferenceMatchesRecord({
    records: attendance,
    record: openAttendance,
    reference,
    collisionCode: 'ATTENDANCE_REFERENCE_COLLISION',
    collisionMessage: 'Mã chấm công tham chiếu trong chi phí ca đang mơ hồ; cần xử lý dữ liệu trùng trước khi ghi nhận.',
  })
  const store = requireStore(state, openAttendance.storeId)
  const storeId = String(store.id || openAttendance.storeId || '').trim()
  if (String(actor.store_id || '') && !sameIdentifier(actor.store_id, storeId)) {
    throw new ApiError(403, 'STORE_SCOPE_FORBIDDEN', 'Ca đang mở không thuộc cửa hàng hiện tại của tài khoản.')
  }
  const name = String(payload.name || payload.expenseName || '').trim()
  const note = String(payload.note || '').trim()
  if (!name || name.length > 160) {
    throw new ApiError(400, 'SHIFT_EXPENSE_NAME_INVALID', 'Tên chi phí là bắt buộc và không được vượt quá 160 ký tự.')
  }
  if (note.length > 1_000) {
    throw new ApiError(400, 'SHIFT_EXPENSE_NOTE_INVALID', 'Ghi chú không được vượt quá 1.000 ký tự.')
  }
  const amount = asVnd(payload.amount, 'Số tiền chi phí', { positive: true })
  const period = asMonth(monthFromRecord(openAttendance), 'Kỳ chi phí')
  assertAccountingPeriodOpen(state, storeId, period)
  const expenseId = `exp_shift_item_${crypto.randomUUID()}`
  const shiftId = openAttendance.shiftId || openAttendance.shift || null
  const expense = {
    id: expenseId,
    storeId,
    storeName: store.name || '',
    employeeId,
    employeeName: employee.name || employeeId,
    attendanceId: openAttendance.id,
    shiftId,
    shiftName: openAttendance.shiftName || shiftId || '',
    type: name,
    name,
    category: 'shift',
    amount,
    description: note || name,
    note,
    sourceType: 'shift-expense-item',
    sourceId: expenseId,
    recognized: true,
    occurredAt: commandContext.now,
    createdAt: commandContext.now,
    createdBy: actor.user_id,
    createdByActor: serverActorSnapshot(actor),
  }
  const transaction = {
    id: `txn_shift_item_${crypto.randomUUID()}`,
    storeId,
    employeeId,
    attendanceId: openAttendance.id,
    shiftId,
    type: name,
    direction: 'out',
    amount,
    description: note || name,
    sourceType: 'shift-expense-item',
    sourceId: expenseId,
    occurredAt: commandContext.now,
    createdAt: commandContext.now,
    actor: serverActorSnapshot(actor),
  }
  const previousShiftExpense = (Array.isArray(state.expenseEntries) ? state.expenseEntries : [])
    .filter((entry) => (
      entry.recognized !== false
      && attendanceReferenceMatches(entry.attendanceId)
      && ['shift-expense-item', 'shift-expense'].includes(String(entry.sourceType || ''))
    ))
    .reduce((sum, entry) => safeMoneySum(sum, Number(entry.amount || 0), 'Tổng chi phí trong ca'), 0)
  const totalShiftExpense = safeMoneySum(previousShiftExpense, amount, 'Tổng chi phí trong ca')
  const updatedAttendance = {
    ...openAttendance,
    expense: totalShiftExpense,
    shiftExpenseTotal: totalShiftExpense,
    updatedAt: commandContext.now,
  }
  const nextState = {
    ...state,
    attendance: attendance.map((record) => record === openAttendance ? updatedAttendance : record),
    expenseEntries: [expense, ...(Array.isArray(state.expenseEntries) ? state.expenseEntries : [])],
    cashTransactions: [transaction, ...(Array.isArray(state.cashTransactions) ? state.cashTransactions : [])],
    stateVersion: Math.max(1, Number(state.stateVersion) || 1) + 1,
  }
  return commitGlobalStateDomainCommand(db, actor, current, nextState, {
    action: body.type,
    entityType: 'shift-expense',
    entityId: expenseId,
    before: null,
    after: expense,
    metadata: { storeId, employeeId, attendanceId: openAttendance.id, shiftId, period, amount, totalShiftExpense },
    response: { command: body.type, expense, transaction, attendance: updatedAttendance },
    status: 201,
  }, commandContext)
}

const FIXED_EXPENSE_TYPES = new Set([
  'Set up',
  'Mặt bằng',
  'Điện',
  'Nước',
  'Wifi',
  'Marketing',
  'Rác',
  'Khác',
])

const normalizeFixedExpenseType = (value) => {
  const raw = String(value || '').trim()
  const normalized = normalizeTextKey(raw)
  const aliases = new Map([
    ['set up', 'Set up'],
    ['setup', 'Set up'],
    ['chi phi thiet lap cua hang', 'Set up'],
    ['mat bang', 'Mặt bằng'],
    ['dien', 'Điện'],
    ['nuoc', 'Nước'],
    ['wifi', 'Wifi'],
    ['wi-fi', 'Wifi'],
    ['marketing', 'Marketing'],
    ['rac', 'Rác'],
    ['khac', 'Khác'],
    ['chi phi khac', 'Khác'],
  ])
  return aliases.get(normalized) || (FIXED_EXPENSE_TYPES.has(raw) ? raw : '')
}

export const normalizeFixedExpenseItems = (value, legacy = {}) => {
  const rawItems = Array.isArray(value)
    ? value
    : [{
        category: legacy.type || 'Khác',
        name: legacy.name,
        amount: legacy.amount,
        description: legacy.note ?? legacy.description,
      }]
  if (rawItems.length < 1 || rawItems.length > 50) {
    throw new ApiError(400, 'EXPENSE_ITEMS_INVALID', 'Phiếu chi phí phải có từ 1 đến 50 khoản chi.')
  }
  let totalAmount = 0
  const items = rawItems.map((item, index) => {
    if (!isPlainRecord(item)) throw new ApiError(400, 'EXPENSE_ITEM_INVALID', `Khoản chi thứ ${index + 1} không hợp lệ.`)
    const category = normalizeFixedExpenseType(item.category ?? item.type)
    if (!category) throw new ApiError(400, 'EXPENSE_TYPE_INVALID', `Loại khoản chi thứ ${index + 1} không hợp lệ.`)
    const name = String(item.name || '').trim()
    const description = String(item.description ?? item.note ?? '').trim()
    if (name.length > 160 || description.length > 500) {
      throw new ApiError(400, 'EXPENSE_ITEM_INVALID', `Nội dung khoản chi thứ ${index + 1} vượt quá giới hạn.`)
    }
    if (category === 'Khác' && !name && !description) {
      throw new ApiError(400, 'EXPENSE_CUSTOM_DETAIL_REQUIRED', `Khoản chi Khác thứ ${index + 1} cần nhập tên hoặc nội dung.`)
    }
    const amount = asVnd(item.amount ?? 0, `Số tiền khoản chi thứ ${index + 1}`)
    totalAmount = safeMoneySum(totalAmount, amount, 'Tổng phiếu chi phí cửa hàng')
    return {
      category,
      name: name || category,
      amount,
      description,
    }
  })
  if (totalAmount <= 0) throw new ApiError(400, 'EXPENSE_TOTAL_INVALID', 'Tổng phiếu chi phí phải lớn hơn 0 đồng.')
  return { items, totalAmount }
}

const fixedExpenseDescription = (record) => {
  const note = String(record.note || '').trim()
  if (note) return note
  const items = Array.isArray(record.items) ? record.items : []
  return items.map((item) => `${item.name || item.category}: ${item.amount} đ`).join('; ').slice(0, 1_000)
}

const expenseCommand = async (db, actor, body, commandContext) => {
  assertOperationsRole(actor, 'Tài khoản không có quyền quản lý chi phí cửa hàng.')
  const payload = isPlainRecord(body.payload) ? body.payload : {}
  const fixed = body.type.startsWith('fixed_expense.')
  const operation = body.type.split('.').at(-1)
  if (!['create', 'update', 'delete'].includes(operation)) {
    throw new ApiError(400, 'COMMAND_UNKNOWN', 'Lệnh chi phí không được hỗ trợ.')
  }
  const { current, state } = await loadGlobalCommandState(db, body)
  const actorSnapshot = serverActorSnapshot(actor)
  const expenses = Array.isArray(state.expenseEntries) ? state.expenseEntries : []
  const fixedExpenses = Array.isArray(state.fixedExpenses) ? state.fixedExpenses : []

  if (operation === 'create') {
    const requestedStoreId = String(payload.storeId || '').trim()
    assertOperationalStoreAccess(actor, requestedStoreId)
    const store = requireStore(state, requestedStoreId)
    const storeId = String(store.id || requestedStoreId).trim()
    const note = String(payload.note ?? payload.description ?? '').trim()
    if (note.length > 1_000) throw new ApiError(400, 'NOTE_TOO_LONG', 'Ghi chú không được vượt quá 1.000 ký tự.')
    const fixedVoucher = fixed
      ? normalizeFixedExpenseItems(payload.items, { type: payload.type, amount: payload.amount, note })
      : null
    const amount = fixedVoucher
      ? fixedVoucher.totalAmount
      : asVnd(payload.amount, 'Số tiền chi phí', { positive: true })
    const type = fixedVoucher
      ? (Array.isArray(payload.items) ? 'Phiếu chi phí cửa hàng' : fixedVoucher.items[0].category)
      : String(payload.type || 'Chi phí khác').trim()
    if (!type || type.length > 120) throw new ApiError(400, 'EXPENSE_TYPE_INVALID', 'Loại chi phí không hợp lệ.')
    const occurredAt = asOccurredAt(payload.occurredAt, commandContext.now)
    assertAccountingPeriodOpen(state, storeId, occurredAt.slice(0, 7))
    const sourceId = `${fixed ? 'fix' : 'mex'}_${crypto.randomUUID()}`
    const entry = {
      id: `exp_${crypto.randomUUID()}`,
      storeId,
      type,
      category: fixed ? 'fixed' : String(payload.category || 'other').trim().slice(0, 80) || 'other',
      amount,
      description: fixedVoucher ? fixedExpenseDescription({ items: fixedVoucher.items, note }) : note,
      sourceType: fixed ? 'fixed-expense' : 'manual-expense',
      sourceId,
      recognized: true,
      occurredAt,
      createdAt: commandContext.now,
      createdBy: actor.user_id,
    }
    const fixedRecord = fixed ? {
      id: sourceId,
      storeId,
      type,
      amount,
      totalAmount: amount,
      items: fixedVoucher.items,
      note,
      occurredAt,
      createdAt: commandContext.now,
      createdBy: actorSnapshot,
      deletedAt: null,
    } : null
    const nextState = {
      ...state,
      expenseEntries: [entry, ...expenses],
      fixedExpenses: fixedRecord ? [fixedRecord, ...fixedExpenses] : fixedExpenses,
      payrollPeriods: invalidateClosedPayrollPeriods(
        state,
        { storeId, period: occurredAt.slice(0, 7) },
        commandContext.now,
        body.type,
      ),
      stateVersion: Math.max(1, Number(state.stateVersion) || 1) + 1,
    }
    return commitGlobalStateDomainCommand(db, actor, current, nextState, {
      action: body.type,
      entityType: fixed ? 'fixed-expense' : 'expense',
      entityId: sourceId,
      before: null,
      after: fixedRecord || entry,
      metadata: { expenseEntryId: entry.id, storeId },
      response: {
        command: body.type,
        expense: fixedRecord || entry,
        expenseEntry: entry,
      },
      status: 201,
    }, commandContext)
  }

  const reason = String(payload.reason || '').trim()
  if (!reason || reason.length > 500) {
    throw new ApiError(400, 'REASON_REQUIRED', 'Cần nhập lý do từ 1 đến 500 ký tự.')
  }
  const entityId = String(
    fixed ? (payload.expenseId || payload.fixedExpenseId || payload.id) : (payload.expenseId || payload.id),
  ).trim()
  const previous = fixed
    ? fixedExpenses.find((record) => String(record.id || '') === entityId)
    : expenses.find((record) => (
        String(record.id || '') === entityId
        && String(record.sourceType || '') === 'manual-expense'
      ))
  if (!previous) throw new ApiError(404, 'EXPENSE_NOT_FOUND', 'Không tìm thấy chi phí.')
  assertOperationalStoreAccess(actor, previous.storeId)
  if (fixed && operation === 'delete') {
    assertAdmin(actor, 'Chỉ Admin được xóa phiếu chi phí cửa hàng.')
  }
  const previousEntry = fixed
    ? expenses.find((entry) => sourceMatch(entry, 'fixed-expense', previous.id))
    : previous
  if (previous.deletedAt || previousEntry?.deletedAt || previousEntry?.recognized === false) {
    if (operation === 'delete') {
      return recordNoopCommand(db, actor, {
        command: body.type,
        version: Number(current.version),
        expense: previous,
        existing: true,
      }, 200, commandContext)
    }
    throw new ApiError(409, 'EXPENSE_DELETED', 'Chi phí đã bị xóa.')
  }
  const previousPeriod = monthFromRecord(previous)
  assertAccountingPeriodOpen(state, previous.storeId, previousPeriod)

  let next
  let nextEntry
  let changedFields
  if (operation === 'delete') {
    changedFields = ['deletedAt', 'recognized']
    next = {
      ...previous,
      deletedAt: commandContext.now,
      deletedBy: actorSnapshot,
      updatedAt: commandContext.now,
    }
    nextEntry = {
      ...(previousEntry || {
        id: `exp_${crypto.randomUUID()}`,
        storeId: previous.storeId,
        type: previous.type,
        category: fixed ? 'fixed' : 'other',
        amount: previous.amount,
        description: previous.note || previous.description || '',
        sourceType: fixed ? 'fixed-expense' : 'manual-expense',
        sourceId: previous.id,
        occurredAt: previous.occurredAt,
        createdAt: previous.createdAt,
      }),
      recognized: false,
      voidedAt: commandContext.now,
      deletedAt: commandContext.now,
      deletedBy: actor.user_id,
      updatedAt: commandContext.now,
    }
  } else {
    const candidate = { ...previous }
    if (fixed && (payload.items !== undefined || payload.type !== undefined || payload.amount !== undefined)) {
      const previousFirst = Array.isArray(previous.items) ? previous.items[0] : null
      const normalized = normalizeFixedExpenseItems(payload.items, {
        type: payload.type ?? previousFirst?.category ?? previous.type,
        amount: payload.amount ?? previousFirst?.amount ?? previous.amount,
        name: previousFirst?.name,
        note: payload.note ?? payload.description ?? previousFirst?.description ?? previous.note,
      })
      candidate.items = normalized.items
      candidate.amount = normalized.totalAmount
      candidate.totalAmount = normalized.totalAmount
      candidate.type = Array.isArray(payload.items) ? 'Phiếu chi phí cửa hàng' : normalized.items[0].category
    } else if (!fixed) {
      if (payload.type !== undefined) {
        const type = String(payload.type || '').trim()
        if (!type || type.length > 120) throw new ApiError(400, 'EXPENSE_TYPE_INVALID', 'Loại chi phí không hợp lệ.')
        candidate.type = type
      }
      if (payload.amount !== undefined) candidate.amount = asVnd(payload.amount, 'Số tiền chi phí', { positive: true })
    }
    if (payload.note !== undefined || payload.description !== undefined) {
      const note = String(payload.note ?? payload.description ?? '').trim()
      if (note.length > 1_000) throw new ApiError(400, 'NOTE_TOO_LONG', 'Ghi chú không được vượt quá 1.000 ký tự.')
      if (fixed) candidate.note = note
      else candidate.description = note
    }
    if (payload.occurredAt !== undefined) candidate.occurredAt = asOccurredAt(payload.occurredAt, previous.occurredAt)
    if (!fixed && payload.category !== undefined) {
      candidate.category = String(payload.category || '').trim().slice(0, 80) || 'other'
    }
    const businessFields = fixed
      ? ['type', 'items', 'amount', 'totalAmount', 'note', 'occurredAt']
      : ['type', 'category', 'amount', 'description', 'occurredAt']
    changedFields = businessFields.filter((key) => JSON.stringify(candidate[key]) !== JSON.stringify(previous[key]))
    if (!changedFields.length) {
      return recordNoopCommand(db, actor, {
        command: body.type,
        version: Number(current.version),
        expense: previous,
        expenseEntry: previousEntry,
        existing: true,
      }, 200, commandContext)
    }
    assertAccountingPeriodOpen(state, previous.storeId, String(candidate.occurredAt).slice(0, 7))
    next = { ...candidate, updatedAt: commandContext.now, updatedBy: actorSnapshot }
    nextEntry = {
      ...(previousEntry || {
        id: `exp_${crypto.randomUUID()}`,
        storeId: previous.storeId,
        sourceType: fixed ? 'fixed-expense' : 'manual-expense',
        sourceId: previous.id,
        recognized: true,
        createdAt: previous.createdAt || commandContext.now,
        createdBy: actor.user_id,
      }),
      type: next.type,
      category: fixed ? 'fixed' : next.category,
      amount: next.amount,
      description: fixed ? fixedExpenseDescription(next) : next.description,
      occurredAt: next.occurredAt,
      recognized: true,
      updatedAt: commandContext.now,
      updatedBy: actor.user_id,
    }
  }

  const nextExpenses = previousEntry
    ? expenses.map((entry) => String(entry.id || '') === String(previousEntry.id) ? nextEntry : entry)
    : [nextEntry, ...expenses]
  if (!fixed) next = nextEntry
  const nextState = {
    ...state,
    expenseEntries: nextExpenses,
    fixedExpenses: fixed
      ? fixedExpenses.map((record) => String(record.id || '') === entityId ? next : record)
      : fixedExpenses,
    payrollPeriods: invalidateClosedPayrollPeriods(state, [
      { storeId: previous.storeId, period: previousPeriod },
      { storeId: previous.storeId, period: monthFromRecord(next) },
    ], commandContext.now, body.type),
    stateVersion: Math.max(1, Number(state.stateVersion) || 1) + 1,
  }
  return commitGlobalStateDomainCommand(db, actor, current, nextState, {
    action: body.type,
    entityType: fixed ? 'fixed-expense' : 'expense',
    entityId,
    before: previous,
    after: next,
    metadata: { reason, changedFields, expenseEntryId: nextEntry.id },
    response: { command: body.type, expense: next, expenseEntry: nextEntry },
  }, commandContext)
}

const normalizeImportItems = (value) => {
  if (!Array.isArray(value) || value.length < 1 || value.length > 200) {
    throw new ApiError(400, 'IMPORT_ITEMS_INVALID', 'Phiếu nhập phải có từ 1 đến 200 mặt hàng.')
  }
  let goodsAmount = 0
  let shippingAmount = 0
  const items = value.map((item, index) => {
    if (!isPlainRecord(item)) throw new ApiError(400, 'IMPORT_ITEM_INVALID', `Mặt hàng thứ ${index + 1} không hợp lệ.`)
    const name = String(item.name || '').trim()
    const category = String(item.category || 'Khác').trim()
    const note = String(item.note || '').trim()
    const quantity = Number(item.quantity)
    const weight = Number(item.weight)
    const price = asVnd(item.price, `Đơn giá mặt hàng thứ ${index + 1}`, { positive: true })
    if (!name || name.length > 160 || !category || category.length > 120 || note.length > 500) {
      throw new ApiError(400, 'IMPORT_ITEM_INVALID', `Thông tin mặt hàng thứ ${index + 1} không hợp lệ.`)
    }
    if (!Number.isSafeInteger(quantity) || quantity <= 0 || quantity > 1_000_000) {
      throw new ApiError(400, 'IMPORT_QUANTITY_INVALID', `Số bao mặt hàng thứ ${index + 1} phải là số nguyên dương.`)
    }
    if (!Number.isFinite(weight) || weight <= 0 || weight > 1_000_000) {
      throw new ApiError(400, 'IMPORT_WEIGHT_INVALID', `Cân nặng mặt hàng thứ ${index + 1} phải là số dương.`)
    }
    const itemShippingAmount = asVnd(
      item.shippingAmount ?? item.shipping ?? 0,
      `Phí vận chuyển mặt hàng thứ ${index + 1}`,
    )
    const lineAmount = Math.round(weight * price)
    if (!Number.isSafeInteger(lineAmount) || lineAmount <= 0 || lineAmount > MAX_MONEY_VND) {
      throw new ApiError(400, 'IMPORT_TOTAL_INVALID', `Thành tiền mặt hàng thứ ${index + 1} không hợp lệ.`)
    }
    goodsAmount = safeMoneySum(goodsAmount, lineAmount, 'Tổng tiền hàng')
    shippingAmount = safeMoneySum(shippingAmount, itemShippingAmount, 'Tổng phí vận chuyển')
    if (goodsAmount > MAX_MONEY_VND) {
      throw new ApiError(400, 'IMPORT_TOTAL_INVALID', 'Tổng tiền hàng vượt quá giới hạn cho phép.')
    }
    return { name, category, quantity, weight, price, shippingAmount: itemShippingAmount, note, lineAmount }
  })
  return { items, goodsAmount, shippingAmount }
}

const importVoucherCommand = async (db, actor, body, commandContext) => {
  assertOperationsRole(actor, 'Tài khoản không có quyền quản lý phiếu nhập cửa hàng.')
  const payload = isPlainRecord(body.payload) ? body.payload : {}
  const operation = body.type.split('.').at(-1)
  if (!['create', 'update', 'delete'].includes(operation)) {
    throw new ApiError(400, 'COMMAND_UNKNOWN', 'Lệnh phiếu nhập không được hỗ trợ.')
  }
  const { current, state } = await loadGlobalCommandState(db, body)
  const vouchers = Array.isArray(state.importVouchers) ? state.importVouchers : []
  const expenses = Array.isArray(state.expenseEntries) ? state.expenseEntries : []
  const actorSnapshot = serverActorSnapshot(actor)

  if (operation === 'create') {
    const requestedStoreId = String(payload.storeId || '').trim()
    assertOperationalStoreAccess(actor, requestedStoreId)
    const store = requireStore(state, requestedStoreId)
    const storeId = String(store.id || requestedStoreId).trim()
    const normalizedItems = normalizeImportItems(payload.items)
    const { items, goodsAmount } = normalizedItems
    const shippingAmount = asVnd(payload.shippingAmount ?? normalizedItems.shippingAmount, 'Phí vận chuyển')
    const relatedAmount = asVnd(payload.relatedAmount ?? 0, 'Chi phí liên quan')
    const totalAmount = safeMoneySum(safeMoneySum(goodsAmount, shippingAmount), relatedAmount)
    if (totalAmount <= 0 || totalAmount > MAX_MONEY_VND) {
      throw new ApiError(400, 'IMPORT_TOTAL_INVALID', 'Tổng giá trị phiếu nhập không hợp lệ.')
    }
    const counterName = 'system:imports'
    const counterRow = await first(db, `
      SELECT counter_name, counter_value, version FROM counters WHERE counter_name = ? LIMIT 1
    `, counterName)
    const historicalMax = vouchers.reduce((maximum, voucher) => {
      const match = String(voucher.code || '').match(/-(\d{4,5})$/u)
      return match ? Math.max(maximum, Number(match[1])) : maximum
    }, 0)
    const baseValue = Math.max(Number(counterRow?.counter_value || 0), historicalMax)
    if (!Number.isSafeInteger(baseValue) || baseValue >= 9_999) {
      throw new ApiError(409, 'IMPORT_COUNTER_EXHAUSTED', 'Dãy mã phiếu nhập đã hết.')
    }
    const nextValue = baseValue + 1
    const localNow = localDateTimeParts(commandContext.now)
    const [year, month, day] = localNow.date.split('-')
    const voucher = {
      id: `imp_${crypto.randomUUID()}`,
      code: `PN-${day}/${month}/${year.slice(-2)}-${String(nextValue).padStart(4, '0')}`,
      storeId,
      items,
      goodsAmount,
      shippingAmount,
      relatedAmount,
      totalAmount,
      status: 'Đã lưu',
      createdAt: commandContext.now,
      createdBy: actorSnapshot,
      updatedAt: commandContext.now,
      deletedAt: null,
    }
    const expense = {
      id: `exp_import_${voucher.id}`,
      storeId,
      type: 'Nhập hàng',
      category: 'inventory',
      amount: totalAmount,
      description: `Phiếu nhập ${voucher.code}`,
      sourceType: 'import-voucher',
      sourceId: voucher.id,
      recognized: true,
      occurredAt: commandContext.now,
      createdAt: commandContext.now,
      createdBy: actor.user_id,
    }
    const nextState = {
      ...state,
      importVouchers: [voucher, ...vouchers],
      expenseEntries: [expense, ...expenses],
      payrollPeriods: invalidateClosedPayrollPeriods(
        state,
        { storeId, period: monthFromRecord(voucher) },
        commandContext.now,
        body.type,
      ),
      stateVersion: Math.max(1, Number(state.stateVersion) || 1) + 1,
    }
    return commitGlobalStateCounterDomainCommand(db, actor, current, nextState, {
      name: counterName,
      row: counterRow,
      value: nextValue,
    }, {
      action: body.type,
      entityType: 'import-voucher',
      entityId: voucher.id,
      before: null,
      after: voucher,
      metadata: { storeId, code: voucher.code, counterValue: nextValue, expenseEntryId: expense.id },
      response: { command: body.type, voucher, expense },
      status: 201,
    }, commandContext)
  }

  const voucherId = String(payload.voucherId || payload.id || '').trim()
  const previous = vouchers.find((voucher) => String(voucher.id || '') === voucherId)
  if (!previous) throw new ApiError(404, 'IMPORT_NOT_FOUND', 'Không tìm thấy phiếu nhập.')
  assertOperationalStoreAccess(actor, previous.storeId)
  if (previous.deletedAt || previous.status === 'Đã xóa') {
    if (operation === 'delete') {
      return recordNoopCommand(db, actor, {
        command: body.type,
        version: Number(current.version),
        voucher: previous,
        existing: true,
      }, 200, commandContext)
    }
    throw new ApiError(409, 'IMPORT_DELETED', 'Phiếu nhập đã bị xóa.')
  }
  const reason = String(payload.reason || '').trim()
  if (!reason || reason.length > 500) {
    throw new ApiError(400, 'REASON_REQUIRED', 'Cần nhập lý do từ 1 đến 500 ký tự.')
  }
  assertAccountingPeriodOpen(state, previous.storeId, monthFromRecord(previous))
  const previousExpense = expenses.find((entry) => sourceMatch(entry, 'import-voucher', previous.id))
  let next
  let nextExpense
  let changedFields
  if (operation === 'delete') {
    changedFields = ['status', 'deletedAt']
    next = {
      ...previous,
      status: 'Đã xóa',
      deletedAt: commandContext.now,
      deletedBy: actorSnapshot,
      updatedAt: commandContext.now,
    }
    nextExpense = {
      ...(previousExpense || {
        id: `exp_import_${previous.id}`,
        storeId: previous.storeId,
        type: 'Nhập hàng',
        category: 'inventory',
        amount: Number(previous.totalAmount || 0),
        description: `Phiếu nhập ${previous.code}`,
        sourceType: 'import-voucher',
        sourceId: previous.id,
        occurredAt: previous.createdAt,
        createdAt: previous.createdAt,
      }),
      recognized: false,
      voidedAt: commandContext.now,
      deletedAt: commandContext.now,
      deletedBy: actor.user_id,
      updatedAt: commandContext.now,
    }
  } else {
    const normalized = payload.items === undefined
      ? {
          items: previous.items,
          goodsAmount: Number(previous.goodsAmount || 0),
          shippingAmount: Number(previous.shippingAmount || 0),
        }
      : normalizeImportItems(payload.items)
    const shippingAmount = payload.shippingAmount === undefined
      ? asVnd(normalized.shippingAmount ?? previous.shippingAmount ?? 0, 'Phí vận chuyển')
      : asVnd(payload.shippingAmount, 'Phí vận chuyển')
    const relatedAmount = payload.relatedAmount === undefined
      ? asVnd(previous.relatedAmount || 0, 'Chi phí liên quan')
      : asVnd(payload.relatedAmount, 'Chi phí liên quan')
    const totalAmount = safeMoneySum(safeMoneySum(normalized.goodsAmount, shippingAmount), relatedAmount)
    if (totalAmount <= 0 || totalAmount > MAX_MONEY_VND) {
      throw new ApiError(400, 'IMPORT_TOTAL_INVALID', 'Tổng giá trị phiếu nhập không hợp lệ.')
    }
    const candidate = {
      ...previous,
      items: normalized.items,
      goodsAmount: normalized.goodsAmount,
      shippingAmount,
      relatedAmount,
      totalAmount,
    }
    changedFields = ['items', 'goodsAmount', 'shippingAmount', 'relatedAmount', 'totalAmount']
      .filter((key) => JSON.stringify(candidate[key]) !== JSON.stringify(previous[key]))
    if (!changedFields.length) {
      return recordNoopCommand(db, actor, {
        command: body.type,
        version: Number(current.version),
        voucher: previous,
        expense: previousExpense,
        existing: true,
      }, 200, commandContext)
    }
    next = { ...candidate, updatedAt: commandContext.now, updatedBy: actorSnapshot }
    nextExpense = {
      ...(previousExpense || {
        id: `exp_import_${previous.id}`,
        storeId: previous.storeId,
        type: 'Nhập hàng',
        category: 'inventory',
        description: `Phiếu nhập ${previous.code}`,
        sourceType: 'import-voucher',
        sourceId: previous.id,
        recognized: true,
        occurredAt: previous.createdAt,
        createdAt: previous.createdAt,
        createdBy: actor.user_id,
      }),
      amount: totalAmount,
      recognized: true,
      updatedAt: commandContext.now,
      updatedBy: actor.user_id,
    }
  }
  const nextExpenses = previousExpense
    ? expenses.map((entry) => String(entry.id || '') === String(previousExpense.id) ? nextExpense : entry)
    : [nextExpense, ...expenses]
  const nextState = {
    ...state,
    importVouchers: vouchers.map((voucher) => String(voucher.id || '') === voucherId ? next : voucher),
    expenseEntries: nextExpenses,
    payrollPeriods: invalidateClosedPayrollPeriods(
      state,
      { storeId: previous.storeId, period: monthFromRecord(previous) },
      commandContext.now,
      body.type,
    ),
    stateVersion: Math.max(1, Number(state.stateVersion) || 1) + 1,
  }
  return commitGlobalStateDomainCommand(db, actor, current, nextState, {
    action: body.type,
    entityType: 'import-voucher',
    entityId: voucherId,
    before: previous,
    after: next,
    metadata: { reason, changedFields, expenseEntryId: nextExpense.id },
    response: { command: body.type, voucher: next, expense: nextExpense },
  }, commandContext)
}

const assertPayrollNotPaidOrLocked = (state, storeId, period) => {
  const payroll = payrollPeriodFor(state, storeId, period)
  if (payroll?.lockedAt || payroll?.status === 'Đã khóa') {
    throw new ApiError(409, 'PAYROLL_PERIOD_LOCKED', 'Kỳ lương đã khóa.')
  }
  if (payroll?.confirmedAt || payroll?.status === 'Đã chi') {
    throw new ApiError(409, 'PAYROLL_PERIOD_PAID', 'Kỳ lương đã chi; không thể thay đổi.')
  }
  return payroll
}

const SALARY_ADJUSTMENT_TYPES = new Set(['Thưởng khác', 'Phụ cấp khác', 'Khấu trừ'])

const salaryAdjustmentCommand = async (db, actor, body, commandContext) => {
  assertPayrollOperator(actor, 'Chỉ Admin hoặc Nhân viên hỗ trợ KD được tạo khoản điều chỉnh lương cửa hàng.')
  if (body.type !== 'salary_adjustment.create') {
    throw new ApiError(400, 'COMMAND_UNKNOWN', 'Lệnh điều chỉnh lương không được hỗ trợ.')
  }
  const payload = isPlainRecord(body.payload) ? body.payload : {}
  const { current, state } = await loadGlobalCommandState(db, body)
  const requestedEmployeeId = String(payload.employeeId || '').trim()
  const employee = uniqueEmployeeIdentifierRecordMatch({
    records: state.employees,
    identifier: requestedEmployeeId,
    predicate: (record) => !record.deletedAt,
  })?.record || null
  const status = normalizeTextKey(employee?.status)
  if (!employee || ['da nghi viec', 'tam ngung', 'inactive', 'locked'].includes(status)) {
    throw new ApiError(400, 'EMPLOYEE_INVALID', 'Nhân viên không hợp lệ.')
  }
  const employeeId = String(employee.id || employee.code || employee.employeeId || requestedEmployeeId).trim()
  const storeId = String(employee.storeId || '').trim()
  if (employeeUnit(employee) === 'store_manager') {
    throw new ApiError(400, 'EMPLOYEE_INVALID', 'Quản lý cửa hàng không tham gia bảng lương nhân viên cửa hàng.')
  }
  assertOperationalStoreAccess(actor, storeId)
  const period = asMonth(payload.period)
  requirePayrollUnit(state, storeId)
  assertPayrollNotPaidOrLocked(state, storeId, period)
  const type = String(payload.type || '').trim()
  if (!SALARY_ADJUSTMENT_TYPES.has(type)) {
    throw new ApiError(400, 'SALARY_ADJUSTMENT_TYPE_INVALID', 'Loại điều chỉnh lương không hợp lệ.')
  }
  const amount = asVnd(payload.amount, 'Số tiền điều chỉnh', { positive: true })
  const note = String(payload.note || '').trim()
  if (note.length > 1_000) throw new ApiError(400, 'NOTE_TOO_LONG', 'Ghi chú không được vượt quá 1.000 ký tự.')
  const adjustment = {
    id: `adj_${crypto.randomUUID()}`,
    employeeId,
    employeeName: employee.name || employee.displayName || employeeId,
    storeId,
    period,
    type,
    amount,
    note,
    status: 'Đã tạo',
    createdAt: commandContext.now,
    createdBy: serverActorSnapshot(actor),
    deletedAt: null,
  }
  const nextState = {
    ...state,
    salaryAdjustments: [adjustment, ...(Array.isArray(state.salaryAdjustments) ? state.salaryAdjustments : [])],
    payrollPeriods: invalidateClosedPayrollPeriods(
      state,
      { storeId, period },
      commandContext.now,
      body.type,
    ),
    stateVersion: Math.max(1, Number(state.stateVersion) || 1) + 1,
  }
  return commitGlobalStateDomainCommand(db, actor, current, nextState, {
    action: body.type,
    entityType: 'salary-adjustment',
    entityId: adjustment.id,
    before: null,
    after: adjustment,
    metadata: { storeId, period, employeeId, type },
    response: { command: body.type, adjustment },
    status: 201,
  }, commandContext)
}

const salaryAdvanceCommand = async (db, actor, body, commandContext) => {
  assertPayrollOperator(actor, 'Chỉ Admin hoặc Nhân viên hỗ trợ KD được quản lý ứng lương cửa hàng.')
  const payload = isPlainRecord(body.payload) ? body.payload : {}
  const operation = body.type.split('.').at(-1)
  if (!['create', 'update', 'confirm'].includes(operation)) {
    throw new ApiError(400, 'COMMAND_UNKNOWN', 'Lệnh ứng lương không được hỗ trợ.')
  }
  const { current, state } = await loadGlobalCommandState(db, body)
  const advances = Array.isArray(state.salaryAdvances) ? state.salaryAdvances : []
  const actorSnapshot = serverActorSnapshot(actor)

  if (operation === 'create') {
    const requestedEmployeeId = String(payload.employeeId || '').trim()
    const employee = uniqueEmployeeIdentifierRecordMatch({
      records: state.employees,
      identifier: requestedEmployeeId,
      predicate: (record) => !record.deletedAt,
    })?.record || null
    if (!employee || normalizeTextKey(employee.status) === 'da nghi viec') {
      throw new ApiError(400, 'EMPLOYEE_INVALID', 'Nhân viên không hợp lệ.')
    }
    const employeeId = String(employee.id || employee.code || employee.employeeId || requestedEmployeeId).trim()
    if (employeeUnit(employee) === 'store_manager') {
      throw new ApiError(400, 'EMPLOYEE_INVALID', 'Quản lý cửa hàng không tham gia bảng lương nhân viên cửa hàng.')
    }
    const period = asMonth(payload.period)
    const storeId = String(employee.storeId || '')
    assertOperationalStoreAccess(actor, storeId)
    requirePayrollUnit(state, storeId)
    assertPayrollNotPaidOrLocked(state, storeId, period)
    const snapshot = await calculatePayrollSnapshot(db, state, storeId, period)
    const payrollRow = snapshot.rows.find((row) => sameIdentifier(row.employeeId, employeeId))
    const available = Number(payrollRow?.remaining || 0)
    const amount = asVnd(payload.amount, 'Số tiền ứng', { positive: true })
    if (amount >= available) {
      throw new ApiError(409, 'SALARY_ADVANCE_TOO_HIGH', 'Số tiền ứng phải nhỏ hơn lương khả dụng.', { availableSalary: available })
    }
    const note = String(payload.note || '').trim()
    if (note.length > 1_000) throw new ApiError(400, 'NOTE_TOO_LONG', 'Ghi chú không được vượt quá 1.000 ký tự.')
    const advance = {
      id: `adv_${crypto.randomUUID()}`,
      employeeId,
      employeeName: employee.name || employee.displayName || employeeId,
      storeId,
      period,
      amount,
      availableAtCreation: available,
      availableSalaryAtCreation: available,
      remainingAfter: available - amount,
      remainingSalaryAfterAdvance: available - amount,
      note,
      status: 'Mới tạo',
      createdAt: commandContext.now,
      createdBy: actorSnapshot,
      confirmedAt: null,
      confirmedBy: null,
      deletedAt: null,
    }
    const nextState = {
      ...state,
      salaryAdvances: [advance, ...advances],
      stateVersion: Math.max(1, Number(state.stateVersion) || 1) + 1,
    }
    return commitGlobalStateDomainCommand(db, actor, current, nextState, {
      action: body.type,
      entityType: 'salary-advance',
      entityId: advance.id,
      before: null,
      after: advance,
      metadata: { employeeId, storeId, period, availableSalary: available },
      response: { command: body.type, advance },
      status: 201,
    }, commandContext)
  }

  const requestedAdvanceId = String(payload.advanceId || payload.id || '').trim()
  const previousMatch = uniqueIdentifierRecordMatch({
    records: advances,
    identifier: requestedAdvanceId,
    predicate: (advance) => !advance.deletedAt,
    collisionCode: 'SALARY_ADVANCE_IDENTIFIER_COLLISION',
    collisionMessage: 'Mã khoản ứng lương đang trùng với nhiều bản ghi; không thể xử lý an toàn.',
  })
  const previous = previousMatch?.record || null
  if (!previous) throw new ApiError(404, 'SALARY_ADVANCE_NOT_FOUND', 'Không tìm thấy khoản ứng lương.')
  const advanceId = String(previous.id || requestedAdvanceId).trim()
  const advanceReferenceMatches = (reference) => mutationIdentifierReferenceMatchesRecord({
    records: advances,
    record: previous,
    reference,
    collisionCode: 'SALARY_ADVANCE_REFERENCE_COLLISION',
    collisionMessage: 'Bút toán đang tham chiếu mơ hồ tới nhiều khoản ứng lương; không thể xác nhận an toàn.',
  })
  assertOperationalStoreAccess(actor, previous.storeId)
  if (previous.status !== 'Mới tạo') {
    throw new ApiError(409, 'SALARY_ADVANCE_IMMUTABLE', 'Chỉ khoản ứng mới tạo mới được thay đổi hoặc xác nhận.')
  }
  const period = asMonth(previous.period)
  assertPayrollNotPaidOrLocked(state, previous.storeId, period)
  const snapshot = await calculatePayrollSnapshot(db, state, previous.storeId, period)
  const payrollRow = snapshot.rows.find((row) => sameIdentifier(row.employeeId, previous.employeeId))
  const available = Number(payrollRow?.remaining || 0)

  if (operation === 'update') {
    const amount = payload.amount === undefined
      ? asVnd(previous.amount, 'Số tiền ứng', { positive: true })
      : asVnd(payload.amount, 'Số tiền ứng', { positive: true })
    if (amount >= available) {
      throw new ApiError(409, 'SALARY_ADVANCE_TOO_HIGH', 'Số tiền ứng phải nhỏ hơn lương khả dụng.', { availableSalary: available })
    }
    const note = payload.note === undefined ? previous.note : String(payload.note || '').trim()
    if (note.length > 1_000) throw new ApiError(400, 'NOTE_TOO_LONG', 'Ghi chú không được vượt quá 1.000 ký tự.')
    const changedFields = ['amount', 'note'].filter((key) => (
      key === 'amount' ? amount !== Number(previous.amount) : note !== String(previous.note || '')
    ))
    if (!changedFields.length) {
      return recordNoopCommand(db, actor, {
        command: body.type,
        version: Number(current.version),
        advance: previous,
        existing: true,
      }, 200, commandContext)
    }
    const next = {
      ...previous,
      amount,
      note,
      remainingAfter: available - amount,
      remainingSalaryAfterAdvance: available - amount,
      updatedAt: commandContext.now,
      updatedBy: actorSnapshot,
    }
    const nextState = {
      ...state,
      salaryAdvances: advances.map((advance, index) => index === previousMatch.index ? next : advance),
      stateVersion: Math.max(1, Number(state.stateVersion) || 1) + 1,
    }
    return commitGlobalStateDomainCommand(db, actor, current, nextState, {
      action: body.type,
      entityType: 'salary-advance',
      entityId: advanceId,
      before: previous,
      after: next,
      metadata: { changedFields, availableSalary: available },
      response: { command: body.type, advance: next },
    }, commandContext)
  }

  const amount = asVnd(previous.amount, 'Số tiền ứng', { positive: true })
  if (amount >= available) {
    throw new ApiError(409, 'SALARY_ADVANCE_TOO_HIGH', 'Lương khả dụng đã thay đổi; cần điều chỉnh khoản ứng.', { availableSalary: available })
  }
  const expenseEntries = Array.isArray(state.expenseEntries) ? state.expenseEntries : []
  const cashTransactions = Array.isArray(state.cashTransactions) ? state.cashTransactions : []
  if (expenseEntries.some((entry) => (
    String(entry?.sourceType || '') === 'salary-advance' && advanceReferenceMatches(entry?.sourceId)
  )) || cashTransactions.some((entry) => (
    String(entry?.sourceType || '') === 'salary-advance' && advanceReferenceMatches(entry?.sourceId)
  ))) {
    throw new ApiError(409, 'SALARY_ADVANCE_FINANCE_EXISTS', 'Khoản ứng đã có bút toán tài chính.')
  }
  const confirmed = {
    ...previous,
    status: 'Đã chi',
    confirmedAt: commandContext.now,
    confirmedBy: actorSnapshot,
    availableAtConfirmation: available,
    remainingAfter: available - amount,
    remainingSalaryAfterPayment: available - amount,
    updatedAt: commandContext.now,
  }
  const transaction = {
    id: `txn_advance_${advanceId}`,
    storeId: previous.storeId,
    employeeId: previous.employeeId,
    type: 'Ứng lương',
    direction: 'out',
    amount,
    sourceType: 'salary-advance',
    sourceId: advanceId,
    occurredAt: commandContext.now,
    createdAt: commandContext.now,
    actor: actorSnapshot,
  }
  const expense = {
    id: `exp_advance_${advanceId}`,
    storeId: previous.storeId,
    employeeId: previous.employeeId,
    type: 'Ứng lương',
    category: 'payroll',
    amount,
    description: `Ứng lương ${previous.employeeName}`,
    sourceType: 'salary-advance',
    sourceId: advanceId,
    // Salary advances are cash movements and payroll deductions, not a second
    // expense recognition. The payroll accrual created at period close owns
    // expense recognition for the salary earned in the period.
    recognized: false,
    occurredAt: commandContext.now,
    createdAt: commandContext.now,
    createdBy: actor.user_id,
  }
  const nextState = {
    ...state,
    salaryAdvances: advances.map((advance, index) => index === previousMatch.index ? confirmed : advance),
    payrollPeriods: invalidateClosedPayrollPeriods(
      state,
      { storeId: previous.storeId, period },
      commandContext.now,
      body.type,
    ),
    expenseEntries: [expense, ...expenseEntries],
    cashTransactions: [transaction, ...cashTransactions],
    stateVersion: Math.max(1, Number(state.stateVersion) || 1) + 1,
  }
  return commitGlobalStateDomainCommand(db, actor, current, nextState, {
    action: body.type,
    entityType: 'salary-advance',
    entityId: advanceId,
    before: previous,
    after: confirmed,
    metadata: { availableSalary: available, expenseId: expense.id, transactionId: transaction.id },
    response: { command: body.type, advance: confirmed, expense, transaction },
  }, commandContext)
}

const requireActivePhysicalStore = (state, storeId) => {
  const normalizedStoreId = String(storeId || '').trim()
  if (!normalizedStoreId || [OFFICE_STORE_ID, BUSINESS_SUPPORT_STORE_ID, 'ADMIN', 'SYSTEM']
    .some((identifier) => sameIdentifier(identifier, normalizedStoreId))) {
    throw new ApiError(400, 'STORE_INVALID', 'Cần chọn cửa hàng vật lý đang hoạt động.')
  }
  const store = requireStore(state, normalizedStoreId)
  const status = normalizeTextKey(store.status)
  if (store.active === false || store.isOperational === false
    || ['da dong', 'ngung hoat dong', 'tam ngung', 'inactive', 'closed'].includes(status)) {
    throw new ApiError(409, 'STORE_INACTIVE', 'Cửa hàng đã ngừng hoạt động.')
  }
  return store
}

const storeSalaryConfigPeriods = (state, storeId, employeeId, effectiveFrom) => {
  const configs = (Array.isArray(state.storeEmployeeSalaryConfigs) ? state.storeEmployeeSalaryConfigs : [])
    .filter((config) => (
      !config.deletedAt
      && sameIdentifier(config.storeId, storeId)
      && sameIdentifier(config.employeeId, employeeId)
    ))
  const nextEffectiveFrom = configs
    .map((config) => String(config.effectiveFrom || ''))
    .filter((period) => /^\d{4}-(?:0[1-9]|1[0-2])$/u.test(period) && period > effectiveFrom)
    .sort()[0] || null
  return (Array.isArray(state.payrollPeriods) ? state.payrollPeriods : [])
    .filter((payroll) => (
      !payroll.supersededAt
      &&
      sameIdentifier(payroll.storeId, storeId)
      && /^\d{4}-(?:0[1-9]|1[0-2])$/u.test(String(payroll.period || ''))
      && String(payroll.period) >= effectiveFrom
      && (!nextEffectiveFrom || String(payroll.period) < nextEffectiveFrom)
    ))
}

const storeSalaryConfigCollisionRepairCommand = async (db, actor, body, commandContext) => {
  assertAdmin(actor, 'Chỉ Admin được xử lý cấu hình lương trùng mã.')
  const payload = isPlainRecord(body.payload) ? body.payload : {}
  const { current, state } = await loadGlobalCommandState(db, body)
  const requestedStoreId = String(payload.storeId || '').trim()
  const store = requireActivePhysicalStore(state, requestedStoreId)
  const storeId = String(store.id || requestedStoreId).trim()
  const requestedEmployeeId = String(payload.employeeId || '').trim()
  const employeeMatch = uniqueEmployeeIdentifierRecordMatch({
    records: state.employees,
    identifier: requestedEmployeeId,
    predicate: (record) => (
      !record.deletedAt
      && sameIdentifier(record.storeId, storeId)
      && employeeUnit(record) === 'store'
    ),
  })
  if (!employeeMatch?.record) {
    throw new ApiError(404, 'STORE_EMPLOYEE_NOT_FOUND', 'Không tìm thấy nhân viên cửa hàng đang hoạt động.')
  }
  const employeeId = String(
    employeeMatch.record.id || employeeMatch.record.code || employeeMatch.record.employeeId || requestedEmployeeId,
  ).trim()
  const effectiveFrom = asMonth(payload.effectiveFrom, 'Tháng áp dụng')
  const reason = String(payload.reason || '').trim()
  if (!reason || reason.length > 500) {
    throw new ApiError(400, 'REASON_REQUIRED', 'Cần nhập lý do xử lý dữ liệu trùng từ 1 đến 500 ký tự.')
  }
  const configs = Array.isArray(state.storeEmployeeSalaryConfigs) ? state.storeEmployeeSalaryConfigs : []
  const matchingConfigs = configs.filter((config) => (
    !config.deletedAt
    && sameIdentifier(config.storeId, storeId)
    && sameIdentifier(config.employeeId, employeeId)
    && String(config.effectiveFrom || '') === effectiveFrom
  ))
  if (matchingConfigs.length < 2) {
    throw new ApiError(409, 'STORE_SALARY_CONFIG_COLLISION_NOT_FOUND', 'Không còn nhiều cấu hình lương trùng trong phạm vi đã chọn.')
  }
  const keepConfigId = String(payload.keepConfigId || '').trim()
  const keepMatch = uniqueIdentifierRecordMatch({
    records: matchingConfigs,
    identifier: keepConfigId,
    collisionCode: 'KEEP_CONFIG_AMBIGUOUS',
    collisionMessage: 'Mã cấu hình cần giữ đang trùng; không thể chọn bản ghi an toàn.',
  })
  const keep = keepMatch?.record || null
  if (!keep) {
    throw new ApiError(400, 'KEEP_CONFIG_INVALID', 'Cần chọn chính xác một cấu hình trong nhóm trùng để giữ lại.')
  }
  const canonicalKeepConfigId = String(keep.id || '').trim()
  const impactedPayrolls = storeSalaryConfigPeriods(state, storeId, employeeId, effectiveFrom)
  for (const payroll of impactedPayrolls) {
    assertPayrollNotPaidOrLocked(state, storeId, String(payroll.period || ''))
  }
  const actorSnapshot = serverActorSnapshot(actor)
  const repairedConfigs = matchingConfigs.map((config) => (
    config === keep
      ? {
          ...config,
          storeId,
          employeeId,
          updatedAt: commandContext.now,
          updatedBy: actorSnapshot,
          version: Number(config.version || 1) + 1,
        }
      : {
          ...config,
          active: false,
          status: 'RETIRED_COLLISION',
          deletedAt: commandContext.now,
          deletedBy: actorSnapshot,
          collisionResolvedIntoId: canonicalKeepConfigId,
          collisionResolutionReason: reason,
          updatedAt: commandContext.now,
          updatedBy: actorSnapshot,
          version: Number(config.version || 1) + 1,
        }
  ))
  const repairedByOriginal = new Map(matchingConfigs.map((config, index) => [config, repairedConfigs[index]]))
  const repairedKeep = repairedByOriginal.get(keep)
  const payrollTargets = impactedPayrolls.map((payroll) => ({ storeId, period: String(payroll.period || '') }))
  const nextState = {
    ...state,
    storeEmployeeSalaryConfigs: configs.map((config) => repairedByOriginal.get(config) || config),
    payrollPeriods: invalidateClosedPayrollPeriods(state, payrollTargets, commandContext.now, body.type),
    stateVersion: Math.max(1, Number(state.stateVersion) || 1) + 1,
  }
  return commitGlobalStateDomainCommand(db, actor, current, nextState, {
    action: body.type,
    entityType: 'store-employee-salary-config-collision',
    entityId: canonicalKeepConfigId,
    before: matchingConfigs,
    after: repairedConfigs,
    metadata: { storeId, employeeId, effectiveFrom, keepConfigId: canonicalKeepConfigId, reason, payrollTargets },
    response: {
      command: body.type,
      salaryConfig: repairedKeep,
      retiredConfigIds: matchingConfigs.filter((config) => config !== keep).map((config) => config.id),
    },
  }, commandContext)
}

const storeSalaryConfigCommand = async (db, actor, body, commandContext) => {
  assertPayrollOperator(actor, 'Chỉ Admin hoặc Nhân viên hỗ trợ KD được cài đặt lương Full-Time.')
  if (body.type !== 'store_salary_config.set') {
    throw new ApiError(400, 'COMMAND_UNKNOWN', 'Lệnh cấu hình lương cửa hàng không được hỗ trợ.')
  }
  const payload = isPlainRecord(body.payload) ? body.payload : {}
  const { current, state } = await loadGlobalCommandState(db, body)
  const requestedStoreId = String(payload.storeId || '').trim()
  assertOperationalStoreAccess(actor, requestedStoreId)
  const store = requireActivePhysicalStore(state, requestedStoreId)
  const storeId = String(store.id || requestedStoreId).trim()
  if (classifyStorePayrollPolicy(store) === STORE_PAYROLL_POLICY.UNSUPPORTED) {
    throw new ApiError(409, 'STORE_SALARY_POLICY_UNSUPPORTED', 'Cửa hàng chưa thuộc nhóm chính sách lương được hỗ trợ.')
  }
  const requestedEmployeeId = String(payload.employeeId || '').trim()
  const employee = (Array.isArray(state.employees) ? state.employees : []).find((record) => (
    !record.deletedAt
    && sameIdentifier(record.id || record.code || record.employeeId, requestedEmployeeId)
    && sameIdentifier(record.storeId, storeId)
    && employeeUnit(record) === 'store'
    && !['da nghi viec', 'tam ngung', 'inactive', 'locked'].includes(normalizeTextKey(record.status))
  ))
  if (!employee) {
    throw new ApiError(404, 'STORE_EMPLOYEE_NOT_FOUND', 'Không tìm thấy nhân viên cửa hàng đang hoạt động.')
  }
  const employeeId = String(employee.id || employee.code || employee.employeeId || requestedEmployeeId).trim()
  if (normalizeStoreEmploymentType(employee.employmentType) !== STORE_EMPLOYMENT_TYPE.FULL_TIME) {
    throw new ApiError(409, 'FULL_TIME_EMPLOYEE_REQUIRED', 'Cấu hình lương này chỉ áp dụng cho nhân viên Full-Time.')
  }
  const thresholdHours = Number(payload.thresholdHours)
  if (thresholdHours !== STORE_FULL_TIME_THRESHOLD_HOURS) {
    throw new ApiError(400, 'STORE_SALARY_THRESHOLD_INVALID', `Ngưỡng giờ lương Full-Time phải là ${STORE_FULL_TIME_THRESHOLD_HOURS} giờ.`)
  }
  const regularHourlyRateVnd = asVnd(
    payload.regularHourlyRateVnd ?? payload.standardHourlyRateVnd,
    'Lương theo giờ đến 208 giờ',
    { positive: true },
  )
  const excessHourlyRateVnd = asVnd(
    payload.excessHourlyRateVnd,
    'Lương theo giờ vượt 208 giờ',
    { positive: true },
  )
  const effectiveFrom = asMonth(payload.effectiveFrom, 'Tháng áp dụng')
  const configs = Array.isArray(state.storeEmployeeSalaryConfigs) ? state.storeEmployeeSalaryConfigs : []
  const matchingConfigs = configs.filter((config) => (
    !config.deletedAt
    && sameIdentifier(config.storeId, storeId)
    && sameIdentifier(config.employeeId, employeeId)
    && String(config.effectiveFrom || '') === effectiveFrom
  ))
  if (matchingConfigs.length > 1) {
    throw new ApiError(
      409,
      'STORE_SALARY_CONFIG_IDENTIFIER_COLLISION',
      'Nhân viên đang có nhiều cấu hình lương cùng kỳ với mã chỉ khác chữ hoa/thường; cần xử lý dữ liệu trước khi tính hoặc sửa lương.',
      {
        storeId,
        employeeId,
        effectiveFrom,
        conflictingConfigIds: matchingConfigs.map((config) => String(config.id || '')),
      },
    )
  }
  const existing = matchingConfigs[0] || null
  if (existing) expectedEntityVersion(payload, existing)
  const impactedPayrolls = storeSalaryConfigPeriods(state, storeId, employeeId, effectiveFrom)
  for (const payroll of impactedPayrolls) {
    assertPayrollNotPaidOrLocked(state, storeId, String(payroll.period || ''))
  }
  let normalized
  try {
    normalized = normalizeStoreSalaryConfig({
      employeeId,
      storeId,
      employmentType: STORE_EMPLOYMENT_TYPE.FULL_TIME,
      thresholdHours,
      standardHourlyRateVnd: regularHourlyRateVnd,
      excessHourlyRateVnd,
      effectiveFrom,
      version: Number(existing?.version || 0) + 1,
    }, { store, employeeId, storeId, effectiveFrom })
  } catch {
    throw new ApiError(400, 'STORE_SALARY_CONFIG_INVALID', 'Cấu hình lương Full-Time không hợp lệ.')
  }
  const actorSnapshot = serverActorSnapshot(actor)
  const salaryConfig = {
    ...(existing || {}),
    id: existing?.id || `store_salary_${crypto.randomUUID()}`,
    ...normalized,
    regularHourlyRateVnd: normalized.standardHourlyRateVnd,
    active: true,
    status: 'ACTIVE',
    ...(existing
      ? { updatedAt: commandContext.now, updatedBy: actorSnapshot }
      : { createdAt: commandContext.now, createdBy: actorSnapshot }),
  }
  const payrollTargets = impactedPayrolls.map((payroll) => ({
    storeId,
    period: String(payroll.period || ''),
  }))
  const nextState = {
    ...state,
    storeEmployeeSalaryConfigs: existing
      ? configs.map((config) => String(config.id || '') === String(existing.id) ? salaryConfig : config)
      : [salaryConfig, ...configs],
    payrollPeriods: invalidateClosedPayrollPeriods(state, payrollTargets, commandContext.now, body.type),
    stateVersion: Math.max(1, Number(state.stateVersion) || 1) + 1,
  }
  return commitGlobalStateDomainCommand(db, actor, current, nextState, {
    action: body.type,
    entityType: 'store-employee-salary-config',
    entityId: salaryConfig.id,
    before: existing || null,
    after: salaryConfig,
    metadata: { storeId, employeeId, effectiveFrom, payrollTargets },
    response: { command: body.type, salaryConfig },
    status: existing ? 200 : 201,
  }, commandContext)
}

const compensationEmployee = (state, employeeId) => {
  const employee = uniqueEmployeeIdentifierRecordMatch({
    records: state.employees,
    identifier: employeeId,
    predicate: (record) => (
      !record.deletedAt && normalizeTextKey(record.status) !== 'da nghi viec'
    ),
  })?.record
  if (!employee) throw new ApiError(404, 'EMPLOYEE_NOT_FOUND', 'Không tìm thấy nhân viên đang hoạt động.')
  return employee
}

const compensationDate = (value, field) => {
  const normalized = String(value || '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(normalized)) {
    throw new ApiError(400, 'DATE_INVALID', `${field} phải có định dạng YYYY-MM-DD.`)
  }
  asOccurredAt(normalized, normalized)
  return normalized
}

const expectedEntityVersion = (payload, previous) => {
  if (payload.expectedVersion === undefined || payload.expectedVersion === null || payload.expectedVersion === '') return
  const expected = Number(payload.expectedVersion)
  if (!Number.isSafeInteger(expected) || expected < 1 || expected !== Number(previous.version || 1)) {
    throw new ApiError(409, 'ENTITY_VERSION_CONFLICT', 'Bản ghi đã thay đổi; vui lòng tải lại dữ liệu.')
  }
}

const compensationEntryCommand = async (db, actor, body, commandContext) => {
  assertPayrollOperator(actor, 'Chỉ Admin hoặc Nhân viên hỗ trợ KD được quản lý thưởng và phụ cấp.')
  const operation = body.type.split('.').at(-1)
  if (!['create', 'approve', 'void'].includes(operation)) {
    throw new ApiError(400, 'COMMAND_UNKNOWN', 'Lệnh thưởng/phụ cấp không được hỗ trợ.')
  }
  const payload = isPlainRecord(body.payload) ? body.payload : {}
  const { current, state } = await loadGlobalCommandState(db, body)
  const entries = Array.isArray(state.compensationEntries) ? state.compensationEntries : []
  const actorSnapshot = serverActorSnapshot(actor)

  if (operation === 'create') {
    const type = String(payload.type || '').trim().toUpperCase()
    if (!['MANUAL', 'WORK', 'ALLOWANCE'].includes(type)) {
      throw new ApiError(400, 'COMPENSATION_TYPE_INVALID', 'Loại thưởng/phụ cấp không hợp lệ.')
    }
    const employee = compensationEmployee(state, payload.employeeId)
    const employeeId = String(employee.id || employee.code || employee.employeeId)
    const requestedStoreId = String(payload.storeId || employee.storeId || '').trim()
    assertOperationalStoreAccess(actor, requestedStoreId)
    const store = requireActivePhysicalStore(state, requestedStoreId)
    const storeId = String(store.id || requestedStoreId).trim()
    if (!sameIdentifier(employee.storeId, storeId)) {
      throw new ApiError(409, 'EMPLOYEE_STORE_MISMATCH', 'Nhân viên không thuộc cửa hàng đã chọn.')
    }
    const targetUnit = String(payload.targetUnit || 'store_manager').trim()
    if (targetUnit === 'store_manager') {
      const roles = Array.isArray(employee.roles) ? employee.roles.map(normalizeTextKey) : []
      const manager = employeeUnit(employee) === 'store_manager'
        || employee.isStoreManager === true
        || roles.includes('store_manager')
        || normalizeTextKey(employee.position).includes('quan ly cua hang')
      if (!manager) throw new ApiError(409, 'STORE_MANAGER_REQUIRED', 'Khoản này chỉ áp dụng cho quản lý cửa hàng.')
    }
    const effectiveDate = compensationDate(payload.effectiveDate, 'Ngày áp dụng')
    const period = effectiveDate.slice(0, 7)
    assertPayrollNotPaidOrLocked(state, storeId, period)
    const amountVnd = asVnd(payload.amountVnd ?? payload.amount, 'Số tiền thưởng/phụ cấp', { positive: true })
    const note = String(payload.note || '').trim()
    if (!note || note.length > 1_000) throw new ApiError(400, 'NOTE_REQUIRED', 'Nội dung ghi nhận phải từ 1 đến 1.000 ký tự.')
    const entry = {
      id: `cmp_${crypto.randomUUID()}`,
      type,
      targetUnit,
      employeeId,
      employeeName: employee.name || employee.displayName || employeeId,
      storeId,
      amountVnd,
      effectiveDate,
      period,
      note,
      status: 'SUBMITTED',
      version: 1,
      createdAt: commandContext.now,
      createdBy: actorSnapshot,
      updatedAt: commandContext.now,
      deletedAt: null,
      voidedAt: null,
    }
    const nextState = {
      ...state,
      compensationEntries: [entry, ...entries],
      payrollPeriods: invalidateClosedPayrollPeriods(state, { storeId, period }, commandContext.now, body.type),
      stateVersion: Math.max(1, Number(state.stateVersion) || 1) + 1,
    }
    return commitGlobalStateDomainCommand(db, actor, current, nextState, {
      action: body.type,
      entityType: 'compensation-entry',
      entityId: entry.id,
      before: null,
      after: entry,
      metadata: { storeId, employeeId, period, amountVnd, type },
      response: { command: body.type, entry },
      status: 201,
    }, commandContext)
  }

  const entryId = String(payload.id || payload.entryId || '').trim()
  const previous = entries.find((record) => String(record.id || '') === entryId)
  if (!previous) throw new ApiError(404, 'COMPENSATION_ENTRY_NOT_FOUND', 'Không tìm thấy khoản thưởng/phụ cấp.')
  expectedEntityVersion(payload, previous)
  const previousStoreId = String(previous.storeId || '').trim()
  if (previousStoreId === OFFICE_STORE_ID) {
    assertAdmin(actor, 'Chỉ Admin được điều chỉnh khoản thưởng của Khối văn phòng.')
  } else if (previousStoreId === BUSINESS_SUPPORT_STORE_ID) {
    if (!['admin', 'business_support'].includes(actor.role)) {
      throw new ApiError(403, 'COMPENSATION_SCOPE_FORBIDDEN', 'Tài khoản không có quyền điều chỉnh khoản thưởng của Nhân viên hỗ trợ KD.')
    }
  } else {
    assertOperationalStoreAccess(actor, previousStoreId)
    requireActivePhysicalStore(state, previousStoreId)
  }
  const period = asMonth(previous.period || monthFromRecord(previous))
  assertPayrollNotPaidOrLocked(state, previous.storeId, period)
  if (previous.voidedAt || normalizeTextKey(previous.status) === 'void') {
    return recordNoopCommand(db, actor, {
      command: body.type, version: Number(current.version), entry: previous, existing: true,
    }, 200, commandContext)
  }
  let next
  if (operation === 'approve') {
    if (normalizeTextKey(previous.status) === 'approved' || previous.approvedAt) {
      return recordNoopCommand(db, actor, {
        command: body.type, version: Number(current.version), entry: previous, existing: true,
      }, 200, commandContext)
    }
    if (String(previous.createdBy?.id || '') === String(actor.user_id || '')) {
      throw new ApiError(403, 'SELF_APPROVAL_FORBIDDEN', 'Người tạo không được tự duyệt khoản thưởng/phụ cấp.')
    }
    next = {
      ...previous,
      status: 'APPROVED',
      approvedAt: commandContext.now,
      approvedBy: actorSnapshot,
      updatedAt: commandContext.now,
      updatedBy: actorSnapshot,
      version: Number(previous.version || 1) + 1,
    }
  } else {
    const reason = String(payload.reason || '').trim()
    if (!reason || reason.length > 500) throw new ApiError(400, 'REASON_REQUIRED', 'Cần nhập lý do hủy từ 1 đến 500 ký tự.')
    next = {
      ...previous,
      status: 'VOID',
      voidedAt: commandContext.now,
      voidedBy: actorSnapshot,
      voidReason: reason,
      updatedAt: commandContext.now,
      updatedBy: actorSnapshot,
      version: Number(previous.version || 1) + 1,
    }
  }
  const nextState = {
    ...state,
    compensationEntries: entries.map((record) => String(record.id || '') === entryId ? next : record),
    payrollPeriods: invalidateClosedPayrollPeriods(state, { storeId: previous.storeId, period }, commandContext.now, body.type),
    stateVersion: Math.max(1, Number(state.stateVersion) || 1) + 1,
  }
  return commitGlobalStateDomainCommand(db, actor, current, nextState, {
    action: body.type,
    entityType: 'compensation-entry',
    entityId: entryId,
    before: previous,
    after: next,
    metadata: { storeId: previous.storeId, employeeId: previous.employeeId, period },
    response: { command: body.type, entry: next },
  }, commandContext)
}

const normalizeWorkCatalogPayload = (payload, previous, actorSnapshot, now) => {
  try {
    return normalizeWorkCatalogItem({
      ...(previous || {}),
      ...payload,
      id: previous?.id || payload.id,
      code: previous?.code || payload.code,
      kind: previous?.kind || payload.kind,
      targetGroup: previous?.targetGroup || payload.targetGroup,
      version: previous ? Number(previous.version || 1) + 1 : 1,
      createdAt: previous?.createdAt || now,
      createdBy: previous?.createdBy || actorSnapshot,
      updatedAt: now,
      updatedBy: actorSnapshot,
      deletedAt: null,
    })
  } catch (error) {
    throw new ApiError(400, 'WORK_CATALOG_INVALID', 'Thông tin công việc hoặc vi phạm không hợp lệ.', {
      reason: error instanceof Error ? error.message : String(error),
    })
  }
}

const assertWorkCatalogScopeAccess = (state, actor, item) => {
  const targetGroup = String(item?.targetGroup || '').trim()
  const storeId = String(item?.storeId || '').trim()
  if (actor.role === 'business_support'
    && (targetGroup !== WORK_CATALOG_TARGET.STORE || !storeId)) {
    throw new ApiError(
      403,
      'WORK_CATALOG_SCOPE_FORBIDDEN',
      'Nhân viên hỗ trợ KD chỉ được quản lý danh mục của một cửa hàng vật lý cụ thể.',
    )
  }
  if (targetGroup === WORK_CATALOG_TARGET.STORE && storeId) {
    assertOperationalStoreAccess(actor, storeId)
    requireActivePhysicalStore(state, storeId)
  }
}

const workCatalogCommand = async (db, actor, body, commandContext) => {
  assertPayrollOperator(actor, 'Chỉ Admin hoặc Nhân viên hỗ trợ KD được quản lý danh mục công việc và vi phạm.')
  const operation = String(body.type || '').split('.').at(-1)
  if (!['create', 'update', 'delete', 'restore'].includes(operation)) {
    throw new ApiError(400, 'COMMAND_UNKNOWN', 'Lệnh danh mục công việc không được hỗ trợ.')
  }
  const payload = isPlainRecord(body.payload) ? body.payload : {}
  const { current, state } = await loadGlobalCommandState(db, body)
  const records = Array.isArray(state.workCatalogItems) ? state.workCatalogItems : []
  const actorSnapshot = serverActorSnapshot(actor)

  if (operation === 'create') {
    assertNoCaseCollidingActiveWorkCatalogIdentifiers(state)
    const item = normalizeWorkCatalogPayload(payload, null, actorSnapshot, commandContext.now)
    assertWorkCatalogScopeAccess(state, actor, item)
    if (records.some((record) => sameIdentifier(record.id, item.id)
      || (String(record.targetGroup || '') === item.targetGroup
        && String(record.kind || '') === item.kind
        && sameIdentifier(record.code, item.code)))) {
      throw new ApiError(409, 'WORK_CATALOG_DUPLICATE', 'Mã danh mục đã tồn tại; hãy sửa hoặc khôi phục mục hiện có.')
    }
    const nextState = {
      ...state,
      workCatalogItems: [item, ...records],
      stateVersion: Math.max(1, Number(state.stateVersion) || 1) + 1,
    }
    return commitGlobalStateDomainCommand(db, actor, current, nextState, {
      action: body.type,
      entityType: 'work-catalog-item',
      entityId: item.id,
      before: null,
      after: item,
      metadata: { targetGroup: item.targetGroup, kind: item.kind, storeId: item.storeId || null },
      response: { command: body.type, item },
      status: 201,
    }, commandContext)
  }

  const itemId = String(payload.id || payload.itemId || '').trim()
  const activeIdentifierMatches = activeWorkCatalogIdentifierMatches(state, itemId)
  const repairingIdentifierCollision = activeIdentifierMatches.length > 1
  let previousMatch
  if (repairingIdentifierCollision) {
    if (operation !== 'delete') assertNoCaseCollidingActiveWorkCatalogIdentifiers(state)
    assertAdmin(actor, 'Chỉ Admin được xử lý mã danh mục bị trùng chữ hoa/thường.')
    const exactMatches = activeIdentifierMatches.filter(({ record }) => String(record.id || '') === itemId)
    if (exactMatches.length !== 1) {
      throw new ApiError(
        409,
        'WORK_CATALOG_REPAIR_TARGET_AMBIGUOUS',
        'Cần gửi đúng mã có phân biệt chữ hoa/thường để ngừng sử dụng bản ghi bị trùng.',
        {
          identifier: normalizeIdentifierKey(itemId),
          conflictingIdentifiers: activeIdentifierMatches.map(({ record }) => String(record.id || '')),
        },
      )
    }
    previousMatch = exactMatches[0]
  } else {
    assertNoCaseCollidingActiveWorkCatalogIdentifiers(state)
    const identifierMatches = records
      .map((record, index) => ({ record, index }))
      .filter(({ record }) => sameIdentifier(record.id, itemId))
    const exactMatches = identifierMatches.filter(({ record }) => String(record.id || '') === itemId)
    if (exactMatches.length === 1) previousMatch = exactMatches[0]
    else if (identifierMatches.length === 1) previousMatch = identifierMatches[0]
    else if (identifierMatches.length > 1) {
      throw new ApiError(
        409,
        'WORK_CATALOG_REPAIR_TARGET_AMBIGUOUS',
        'Cần gửi đúng mã có phân biệt chữ hoa/thường để chọn bản ghi danh mục.',
        {
          identifier: normalizeIdentifierKey(itemId),
          conflictingIdentifiers: identifierMatches.map(({ record }) => String(record.id || '')),
        },
      )
    } else previousMatch = null
  }
  const previous = previousMatch?.record || null
  if (!previous) throw new ApiError(404, 'WORK_CATALOG_NOT_FOUND', 'Không tìm thấy mục công việc hoặc vi phạm.')
  expectedEntityVersion(payload, previous)
  assertWorkCatalogScopeAccess(state, actor, previous)

  let next
  if (operation === 'delete') {
    if (previous.deletedAt) {
      return recordNoopCommand(db, actor, {
        command: body.type, version: Number(current.version), item: previous, existing: true,
      }, 200, commandContext)
    }
    try {
      next = softDeleteWorkCatalogItem(previous, {
        at: commandContext.now,
        by: actorSnapshot,
        reason: String(payload.reason || '').trim(),
      })
    } catch (error) {
      throw new ApiError(400, 'WORK_CATALOG_INVALID', 'Không thể ngừng sử dụng mục danh mục này.', {
        reason: error instanceof Error ? error.message : String(error),
      })
    }
  } else if (operation === 'restore') {
    if (!previous.deletedAt && previous.active !== false) {
      return recordNoopCommand(db, actor, {
        command: body.type, version: Number(current.version), item: previous, existing: true,
      }, 200, commandContext)
    }
    next = normalizeWorkCatalogPayload({
      ...previous,
      active: true,
      deletedAt: null,
      deletedBy: null,
      deleteReason: null,
    }, previous, actorSnapshot, commandContext.now)
    if (records.some((record, index) => (
      index !== previousMatch.index
      && !record.deletedAt
      && record.active !== false
      && sameIdentifier(record.id, previous.id)
    ))) {
      throw new ApiError(
        409,
        'WORK_CATALOG_DUPLICATE',
        'Không thể khôi phục vì đang có một mục khác sử dụng cùng mã danh mục.',
      )
    }
  } else {
    if (previous.deletedAt) {
      throw new ApiError(409, 'WORK_CATALOG_DELETED', 'Mục danh mục đã ngừng sử dụng; hãy khôi phục trước khi sửa.')
    }
    next = normalizeWorkCatalogPayload({
      name: payload.name ?? previous.name,
      amountVnd: payload.amountVnd ?? previous.amountVnd,
      active: payload.active ?? previous.active,
      sortOrder: payload.sortOrder ?? previous.sortOrder,
      storeId: payload.storeId ?? previous.storeId,
      shiftId: payload.shiftId ?? previous.shiftId,
      shiftName: payload.shiftName ?? previous.shiftName,
      effectiveFrom: payload.effectiveFrom ?? previous.effectiveFrom,
      effectiveTo: payload.effectiveTo ?? previous.effectiveTo,
    }, previous, actorSnapshot, commandContext.now)
  }

  assertWorkCatalogScopeAccess(state, actor, next)

  const nextState = {
    ...state,
    workCatalogItems: records.map((record, index) => index === previousMatch.index ? next : record),
    stateVersion: Math.max(1, Number(state.stateVersion) || 1) + 1,
  }
  return commitGlobalStateDomainCommand(db, actor, current, nextState, {
    action: body.type,
    entityType: 'work-catalog-item',
    entityId: previous.id,
    before: previous,
    after: next,
    metadata: {
      targetGroup: next.targetGroup,
      kind: next.kind,
      storeId: next.storeId || null,
      identifierCollisionRepair: repairingIdentifierCollision,
    },
    response: { command: body.type, item: next },
  }, commandContext)
}

const canonicalViolationPolicy = (targetUnit, policyCode) => {
  const policySet = targetUnit === 'business_support'
    ? WORKBOOK_COMPENSATION_POLICY.businessSupport
    : WORKBOOK_COMPENSATION_POLICY[targetUnit]
  return policySet?.violations?.find((record) => record.code === policyCode) || null
}

const rewardCatalogSnapshotForAttendance = (attendance, requestedCatalogItemId) => {
  const requestedIdentifier = String(requestedCatalogItemId || '').trim()
  if (!requestedIdentifier) throw new ApiError(400, 'WORK_REWARD_CATALOG_REQUIRED', 'Cần chọn công việc tính thưởng.')
  const checklistTasks = Array.isArray(attendance?.checklistSnapshot?.tasks)
    ? attendance.checklistSnapshot.tasks
    : []
  const taskMatch = uniqueIdentifierRecordMatch({
    records: checklistTasks,
    identifier: requestedIdentifier,
    identifierOf: (record) => record?.catalogItemId || record?.checklistTaskId || record?.id,
    collisionCode: 'WORK_REWARD_CATALOG_COLLISION',
    collisionMessage: 'Snapshot ca làm có nhiều công việc dùng cùng một mã; không thể ghi nhận thưởng an toàn.',
  })
  const task = taskMatch?.record || null
  if (!task) {
    throw new ApiError(400, 'WORK_REWARD_CATALOG_INVALID', 'Công việc không thuộc danh mục đã chốt cho ca làm việc này.')
  }
  const catalogItemId = String(
    task.catalogItemId || task.checklistTaskId || task.id || requestedIdentifier,
  ).trim()
  const embedded = isPlainRecord(task.catalogSnapshot) ? task.catalogSnapshot : {}
  const kind = String(task.kind || task.catalogKind || embedded.kind || '').trim().toUpperCase()
  if (kind !== WORK_CATALOG_KIND.REWARD_TASK) {
    throw new ApiError(400, 'WORK_REWARD_CATALOG_INVALID', 'Chỉ công việc tính thưởng mới được ghi nhận thưởng.')
  }
  const amountVnd = asVnd(task.amountVnd ?? embedded.amountVnd, 'Số tiền thưởng', { positive: true })
  const name = String(task.name || task.title || task.description || embedded.name || '').trim()
  if (!name) throw new ApiError(409, 'WORK_REWARD_SNAPSHOT_INVALID', 'Snapshot công việc tính thưởng thiếu tên công việc.')
  const catalogVersion = Number(task.catalogVersion ?? task.version ?? embedded.catalogVersion ?? embedded.version ?? 1)
  if (!Number.isSafeInteger(catalogVersion) || catalogVersion < 1) {
    throw new ApiError(409, 'WORK_REWARD_SNAPSHOT_INVALID', 'Snapshot công việc tính thưởng có phiên bản không hợp lệ.')
  }
  return {
    id: catalogItemId,
    code: String(task.catalogCode || embedded.catalogCode || embedded.code || catalogItemId).trim(),
    version: catalogVersion,
    kind,
    targetGroup: String(
      task.targetGroup || embedded.targetGroup || attendance?.checklistSnapshot?.targetGroup || '',
    ).trim(),
    name,
    amountVnd,
    rewardScope: String(task.rewardScope || embedded.rewardScope || '').trim() || null,
    milestoneProgramId: String(task.milestoneProgramId || embedded.milestoneProgramId || '').trim() || null,
    milestoneId: String(task.milestoneId || embedded.milestoneId || '').trim() || null,
    effectiveDate: String(task.effectiveDate || embedded.effectiveDate || dateFromRecord(attendance)).trim(),
  }
}

const planWorkRewardClaim = ({ state, actor, payload, commandContext, commandType = 'work_reward.set' }) => {
  if (payload.checked !== true) {
    throw new ApiError(400, 'WORK_REWARD_CHECKED_INVALID', 'Công việc tính thưởng chỉ được tick và lưu một lần; không thể bỏ chọn sau khi đã ghi nhận.')
  }
  const actorEmployeeId = String(actor.employee_id || actor.user_id || '').trim()
  const employee = compensationEmployee(state, actorEmployeeId)
  const employeeId = String(employee.id || employee.code || employee.employeeId)
  const targetUnit = employeeUnit(employee)
  const actorCanClaimUnit = targetUnit === 'business_support'
    ? actor.role === 'business_support'
    : actor.role === 'employee'
  if (!['store', 'office', 'business_support'].includes(targetUnit) || !actorCanClaimUnit) {
    throw new ApiError(403, 'WORK_REWARD_UNIT_FORBIDDEN', 'Tài khoản không thuộc nhóm nhân viên phù hợp để ghi nhận công việc tính thưởng.')
  }
  const requestedAttendanceId = String(payload.attendanceId || '').trim()
  if (!requestedAttendanceId) throw new ApiError(400, 'ATTENDANCE_REQUIRED', 'Cần chọn ca chấm công để ghi nhận thưởng.')
  const attendanceMatch = uniqueIdentifierRecordMatch({
    records: state.attendance,
    identifier: requestedAttendanceId,
    identifierOf: (record) => record?.id,
    predicate: (record) => !record?.deletedAt && belongsToEmployee(record, employeeId),
    collisionCode: 'ATTENDANCE_IDENTIFIER_COLLISION',
    collisionMessage: 'Mã chấm công đang trùng với nhiều bản ghi; không thể ghi nhận thưởng an toàn.',
  })
  const attendance = attendanceMatch?.record || null
  if (!attendance) throw new ApiError(404, 'ATTENDANCE_NOT_FOUND', 'Không tìm thấy ca chấm công của nhân viên.')
  const attendanceId = String(attendance.id || requestedAttendanceId).trim()
  if (attendance.checkOutAt || attendance.checkOut) {
    throw new ApiError(409, 'OPEN_ATTENDANCE_REQUIRED', 'Chỉ được thay đổi công việc tính thưởng khi ca chấm công còn mở.')
  }
  const workDate = compensationDate(dateFromRecord(attendance), 'Ngày làm việc')
  const catalogSnapshot = rewardCatalogSnapshotForAttendance(attendance, payload.catalogItemId)
  if (catalogSnapshot.targetGroup && catalogSnapshot.targetGroup !== targetUnit) {
    throw new ApiError(409, 'WORK_REWARD_UNIT_MISMATCH', 'Công việc tính thưởng không thuộc nhóm nhân viên hiện tại.')
  }
  const storeId = targetUnit === 'store'
    ? String(attendance.storeId || employee.storeId || '').trim()
    : targetUnit === 'office' ? OFFICE_STORE_ID : BUSINESS_SUPPORT_STORE_ID
  if (!storeId) throw new ApiError(409, 'WORK_REWARD_STORE_REQUIRED', 'Ca chấm công thiếu cửa hàng để ghi nhận thưởng.')
  const period = workDate.slice(0, 7)
  assertPayrollNotPaidOrLocked(state, storeId, period)
  let progressId
  let entryId
  try {
    const identity = {
      employeeId,
      workDate,
      shiftRef: attendanceId,
      catalogItemId: catalogSnapshot.id,
    }
    progressId = workCatalogProgressKey(identity)
    entryId = workCatalogClaimKey(identity)
  } catch (error) {
    throw new ApiError(409, 'WORK_REWARD_IDENTITY_INVALID', 'Không thể tạo định danh ổn định cho lần nhận thưởng.', {
      reason: error instanceof Error ? error.message : String(error),
    })
  }
  const progressRecords = Array.isArray(state.workCatalogProgress) ? state.workCatalogProgress : []
  const compensationEntries = Array.isArray(state.compensationEntries) ? state.compensationEntries : []
  const previousMatch = strictUniqueIdentifierRecordMatch({
    records: progressRecords,
    identifier: progressId,
    collisionCode: 'WORK_REWARD_OCCURRENCE_COLLISION',
    collisionMessage: 'Lần ghi nhận thưởng có nhiều bản ghi trùng định danh; cần xử lý dữ liệu trước khi ghi nhận tiếp.',
  })
  const previousEntryMatch = strictUniqueIdentifierRecordMatch({
    records: compensationEntries,
    identifier: entryId,
    collisionCode: 'WORK_REWARD_ENTRY_COLLISION',
    collisionMessage: 'Khoản thưởng có nhiều bản ghi trùng định danh; cần xử lý dữ liệu trước khi ghi nhận tiếp.',
  })
  const previous = previousMatch?.record || null
  const previousEntry = previousEntryMatch?.record || null
  if (previous) {
    expectedEntityVersion({
      expectedVersion: payload.expectedEntityVersion ?? payload.expectedVersion,
    }, previous)
  }
  const actorSnapshot = serverActorSnapshot(actor)
  const employeeName = employee.name || employee.displayName || employeeId
  const shiftId = String(attendance.shiftId || attendance.shift || '').trim()
  const nextProgressVersion = Number(previous?.version || 0) + 1
  if (catalogSnapshot.rewardScope === 'team') {
    const teamRewardClaims = Array.isArray(state.teamRewardClaims) ? state.teamRewardClaims : []
    const milestoneProgramId = catalogSnapshot.milestoneProgramId || 'team-work-reward'
    const milestoneId = catalogSnapshot.milestoneId || catalogSnapshot.code
    const teamClaimId = `work-catalog-team-claim:v1:${encodeURIComponent(storeId)}:${workDate}:${encodeURIComponent(milestoneProgramId)}:${encodeURIComponent(milestoneId)}`
    const previousClaimMatch = strictUniqueIdentifierRecordMatch({
      records: teamRewardClaims,
      identifier: teamClaimId,
      collisionCode: 'TEAM_REWARD_OCCURRENCE_COLLISION',
      collisionMessage: 'Mốc thưởng team có nhiều bản ghi trùng định danh; cần xử lý dữ liệu trước khi ghi nhận tiếp.',
    })
    const previousClaim = previousClaimMatch?.record || null
    const claimActive = previousClaim && !previousClaim.deletedAt && !previousClaim.voidedAt
      && ['pending', 'approved'].includes(normalizeTextKey(previousClaim.status))
    if (previous?.checked === true && claimActive) {
      return {
        changed: false,
        nextState: state,
        response: {
          checked: payload.checked,
          reward: previous,
          entry: null,
          teamClaim: previousClaim,
          existing: true,
        },
        status: 200,
      }
    }
    if (previous) {
      throw new ApiError(409, 'WORK_REWARD_ALREADY_RECORDED', 'Công việc tính thưởng này đã được ghi nhận trước đó và không thể tick lại.')
    }
    const competingClaims = payload.checked
      ? teamRewardClaims.filter((record) => (
        sameIdentifier(record.storeId, storeId)
        && String(record.businessDate || record.workDate || '') === workDate
        && sameIdentifier(record.milestoneProgramId, milestoneProgramId)
        && !record.deletedAt
        && !record.voidedAt
        && ['pending', 'approved'].includes(normalizeTextKey(record.status))
        && record !== previousClaim
      ))
      : []
    if (competingClaims.length > 1) {
      throw new ApiError(409, 'TEAM_REWARD_ACTIVE_CLAIM_COLLISION', 'Có nhiều mốc thưởng team đang hiệu lực trong cùng ngày; cần đối soát trước khi ghi nhận tiếp.')
    }
    const competingClaim = competingClaims[0] || null
    if (payload.checked) {
      if (competingClaim?.status && normalizeTextKey(competingClaim.status) === 'approved') {
        throw new ApiError(409, 'TEAM_REWARD_ALREADY_APPROVED', 'Mốc thưởng team đã được duyệt và không thể ghi nhận thêm.')
      }
      if (competingClaim && Number(competingClaim.amountVnd || 0) >= catalogSnapshot.amountVnd) {
        throw new ApiError(409, 'TEAM_REWARD_HIGHER_MILESTONE_EXISTS', 'Mốc thưởng team cao hơn hoặc tương đương đã được gửi trong ngày.')
      }
    }
    const competingProgressMatch = competingClaim && Number(competingClaim.amountVnd || 0) < catalogSnapshot.amountVnd
      ? uniqueIdentifierRecordMatch({
          records: progressRecords,
          identifier: competingClaim.rewardProgressId,
          collisionCode: 'TEAM_REWARD_PROGRESS_REFERENCE_COLLISION',
          collisionMessage: 'Mã tiến độ tham chiếu của mốc thưởng team đang mơ hồ; cần xử lý dữ liệu trùng trước khi thay mốc.',
        })
      : null
    if (competingClaim && Number(competingClaim.amountVnd || 0) < catalogSnapshot.amountVnd && !competingProgressMatch) {
      throw new ApiError(409, 'TEAM_REWARD_PROGRESS_REFERENCE_MISSING', 'Mốc thưởng team cũ không còn bản ghi tiến độ tương ứng; cần đối soát trước khi thay mốc.')
    }
    const reward = {
      ...(previous || {}),
      id: progressId,
      occurrenceKey: progressId,
      employeeId,
      employeeName,
      targetGroup: targetUnit,
      storeId,
      attendanceId,
      workDate,
      period,
      shiftId,
      shiftName: String(attendance.shiftName || shiftId).trim(),
      shiftStart: attendance.shiftStart || null,
      shiftEnd: attendance.shiftEnd || null,
      shiftVersion: Number(attendance.shiftVersion || 1),
      shiftSource: attendance.shiftSource || 'attendance-snapshot',
      employmentTypeSnapshot: attendance.employmentTypeSnapshot || employee.employmentType || null,
      catalogItemId: catalogSnapshot.id,
      catalogCode: catalogSnapshot.code,
      catalogVersion: catalogSnapshot.version,
      catalogSnapshot,
      amountVnd: catalogSnapshot.amountVnd,
      checked: payload.checked,
      status: payload.checked ? 'PENDING_TEAM_REVIEW' : 'VOID',
      compensationEntryId: null,
      version: nextProgressVersion,
      createdAt: previous?.createdAt || commandContext.now,
      createdBy: previous?.createdBy || actorSnapshot,
      updatedAt: commandContext.now,
      updatedBy: actorSnapshot,
      claimedAt: payload.checked ? commandContext.now : previous?.claimedAt || null,
      claimedBy: payload.checked ? actorSnapshot : previous?.claimedBy || actorSnapshot,
      voidedAt: payload.checked ? null : commandContext.now,
      voidedBy: payload.checked ? null : actorSnapshot,
      deletedAt: null,
    }
    const teamClaim = {
      ...(previousClaim || {}),
      id: teamClaimId,
      sourceType: 'work-catalog-team-claim',
      rewardProgressId: progressId,
      storeId,
      businessDate: workDate,
      workDate,
      period,
      programId: milestoneProgramId,
      milestoneProgramId,
      milestoneId,
      amountVnd: catalogSnapshot.amountVnd,
      employeeId,
      employeeName,
      attendanceId,
      shiftId,
      status: payload.checked ? 'PENDING' : 'VOID',
      createdAt: previousClaim?.createdAt || commandContext.now,
      createdBy: previousClaim?.createdBy || actorSnapshot,
      updatedAt: commandContext.now,
      updatedBy: actorSnapshot,
      voidedAt: payload.checked ? null : commandContext.now,
      voidedBy: payload.checked ? null : actorSnapshot,
    }
    const nextState = {
      ...state,
      workCatalogProgress: [
        ...progressRecords.map((record, index) => {
          if (index === previousMatch?.index) return reward
          if (competingProgressMatch && record === competingProgressMatch.record) {
            return { ...record, checked: false, status: 'VOID', voidedAt: commandContext.now, voidReason: 'Đã thay bằng mốc thưởng team cao hơn.', updatedAt: commandContext.now, updatedBy: actorSnapshot }
          }
          return record
        }),
        ...(previous ? [] : [reward]),
      ],
      teamRewardClaims: [
        ...teamRewardClaims.map((record, index) => {
          if (index === previousClaimMatch?.index) return teamClaim
          if (competingClaim && record === competingClaim && Number(competingClaim.amountVnd || 0) < catalogSnapshot.amountVnd) {
            return { ...record, status: 'SUPERSEDED', supersededAt: commandContext.now, updatedAt: commandContext.now, updatedBy: actorSnapshot }
          }
          return record
        }),
        ...(previousClaim ? [] : [teamClaim]),
      ],
    }
    return {
      changed: true,
      nextState,
      response: { checked: payload.checked, reward, entry: null, teamClaim },
      status: previous || !payload.checked ? 200 : 201,
      audit: {
        entityType: 'work-catalog-team-reward',
        entityId: teamClaimId,
        before: previous,
        after: reward,
        metadata: {
          storeId, employeeId, period, attendanceId, catalogItemId: catalogSnapshot.id,
          amountVnd: catalogSnapshot.amountVnd, checked: payload.checked, teamClaimId,
        },
      },
    }
  }
  const entryActive = Boolean(previousEntry
    && !previousEntry.deletedAt
    && !previousEntry.voidedAt
    && normalizeTextKey(previousEntry.status) === 'approved')
  const alreadyChecked = previous?.checked === true && entryActive
  if (alreadyChecked) {
    return {
      changed: false,
      nextState: state,
      response: {
        checked: payload.checked,
        reward: previous,
        entry: previousEntry,
        teamClaim: null,
        existing: true,
      },
      status: 200,
    }
  }
  if (previous || previousEntry) {
    throw new ApiError(409, 'WORK_REWARD_ALREADY_RECORDED', 'Công việc tính thưởng này đã được ghi nhận trước đó và không thể tick lại.')
  }
  const reward = {
    ...(previous || {}),
    id: progressId,
    occurrenceKey: progressId,
    employeeId,
    employeeName,
    targetGroup: targetUnit,
    storeId,
    attendanceId,
    workDate,
    period,
    shiftId,
    shiftName: String(attendance.shiftName || shiftId).trim(),
    shiftStart: attendance.shiftStart || null,
    shiftEnd: attendance.shiftEnd || null,
    shiftVersion: Number(attendance.shiftVersion || 1),
    shiftSource: attendance.shiftSource || 'attendance-snapshot',
    employmentTypeSnapshot: attendance.employmentTypeSnapshot || employee.employmentType || null,
    catalogItemId: catalogSnapshot.id,
    catalogCode: catalogSnapshot.code,
    catalogVersion: catalogSnapshot.version,
    catalogSnapshot,
    amountVnd: catalogSnapshot.amountVnd,
    checked: payload.checked,
    status: payload.checked ? 'CLAIMED' : 'VOID',
    compensationEntryId: entryId,
    version: nextProgressVersion,
    createdAt: previous?.createdAt || commandContext.now,
    createdBy: previous?.createdBy || actorSnapshot,
    updatedAt: commandContext.now,
    updatedBy: actorSnapshot,
    claimedAt: payload.checked ? commandContext.now : previous?.claimedAt || null,
    claimedBy: payload.checked ? actorSnapshot : previous?.claimedBy || actorSnapshot,
    voidedAt: payload.checked ? null : commandContext.now,
    voidedBy: payload.checked ? null : actorSnapshot,
    deletedAt: null,
  }
  const systemSnapshot = { id: 'SYSTEM', name: 'Hệ thống', role: 'system' }
  const entry = {
    ...(previousEntry || {}),
    id: entryId,
    type: 'WORK',
    targetUnit,
    employeeId,
    employeeName,
    storeId,
    amountVnd: catalogSnapshot.amountVnd,
    effectiveDate: workDate,
    period,
    note: catalogSnapshot.name,
    status: payload.checked ? 'APPROVED' : 'VOID',
    sourceType: 'work-catalog-claim',
    sourceId: progressId,
    attendanceId,
    workDate,
    shiftId,
    shiftName: reward.shiftName,
    employmentTypeSnapshot: reward.employmentTypeSnapshot,
    catalogItemId: catalogSnapshot.id,
    catalogCode: catalogSnapshot.code,
    catalogVersion: catalogSnapshot.version,
    catalogSnapshot,
    version: Number(previousEntry?.version || 0) + 1,
    createdAt: previousEntry?.createdAt || commandContext.now,
    createdBy: previousEntry?.createdBy || actorSnapshot,
    submittedBy: actorSnapshot,
    approvedAt: payload.checked ? commandContext.now : previousEntry?.approvedAt || null,
    approvedBy: payload.checked ? systemSnapshot : previousEntry?.approvedBy || systemSnapshot,
    updatedAt: commandContext.now,
    updatedBy: actorSnapshot,
    voidedAt: payload.checked ? null : commandContext.now,
    voidedBy: payload.checked ? null : actorSnapshot,
    voidReason: payload.checked ? null : 'Nhân viên bỏ chọn công việc tính thưởng.',
    deletedAt: null,
  }
  const nextState = {
    ...state,
    workCatalogProgress: previous
      ? progressRecords.map((record, index) => index === previousMatch.index ? reward : record)
      : [reward, ...progressRecords],
    compensationEntries: previousEntry
      ? compensationEntries.map((record, index) => index === previousEntryMatch.index ? entry : record)
      : [entry, ...compensationEntries],
    payrollPeriods: invalidateClosedPayrollPeriods(state, { storeId, period }, commandContext.now, commandType),
  }
  return {
    changed: true,
    nextState,
    response: { checked: payload.checked, reward, entry, teamClaim: null },
    status: previous || !payload.checked ? 200 : 201,
    audit: {
      entityType: 'work-catalog-reward',
      entityId: progressId,
      before: previous,
      after: reward,
      metadata: {
        storeId, employeeId, period, attendanceId, catalogItemId: catalogSnapshot.id,
        amountVnd: catalogSnapshot.amountVnd, checked: payload.checked, compensationEntryId: entryId,
      },
    },
  }
}

const workRewardCommand = async (db, actor, body, commandContext) => {
  if (!['work_reward.set', 'work_reward.set_batch'].includes(body.type)) {
    throw new ApiError(400, 'COMMAND_UNKNOWN', 'Lệnh công việc tính thưởng không được hỗ trợ.')
  }
  if (!['employee', 'business_support'].includes(actor.role)) {
    throw new ApiError(403, 'ROLE_FORBIDDEN', 'Chỉ nhân viên được tự ghi nhận công việc tính thưởng của mình.')
  }
  const payload = isPlainRecord(body.payload) ? body.payload : {}
  const { current, state } = await loadGlobalCommandState(db, body)

  if (body.type === 'work_reward.set') {
    const plan = planWorkRewardClaim({ state, actor, payload, commandContext, commandType: body.type })
    const response = { command: body.type, ...plan.response }
    if (!plan.changed) {
      return recordNoopCommand(db, actor, {
        ...response,
        version: Number(current.version),
      }, plan.status, commandContext)
    }
    const nextState = {
      ...plan.nextState,
      stateVersion: Math.max(1, Number(state.stateVersion) || 1) + 1,
    }
    return commitGlobalStateDomainCommand(db, actor, current, nextState, {
      action: body.type,
      ...plan.audit,
      response,
      status: plan.status,
    }, commandContext)
  }

  const attendanceId = String(payload.attendanceId || '').trim()
  if (!attendanceId) throw new ApiError(400, 'ATTENDANCE_REQUIRED', 'Cần chọn ca chấm công để ghi nhận thưởng.')
  if (!Array.isArray(payload.items) || payload.items.length < 1 || payload.items.length > 100) {
    throw new ApiError(400, 'WORK_REWARD_BATCH_INVALID', 'Cần chọn từ 1 đến 100 công việc tính thưởng.')
  }
  const seenCatalogItemIds = new Map()
  const items = payload.items.map((item, index) => {
    if (!isPlainRecord(item)) {
      throw new ApiError(400, 'WORK_REWARD_BATCH_INVALID', `Công việc tính thưởng thứ ${index + 1} không hợp lệ.`)
    }
    const catalogItemId = String(item.catalogItemId || '').trim()
    const catalogItemKey = normalizeIdentifierKey(catalogItemId)
    if (!catalogItemKey || item.checked !== true) {
      throw new ApiError(400, 'WORK_REWARD_BATCH_INVALID', 'Mỗi công việc tính thưởng phải có mã hợp lệ và được tick trước khi lưu.')
    }
    if (seenCatalogItemIds.has(catalogItemKey)) {
      throw new ApiError(400, 'WORK_REWARD_BATCH_DUPLICATE', 'Mỗi công việc tính thưởng chỉ được gửi một lần trong cùng yêu cầu.', {
        normalizedIdentifier: catalogItemKey,
        conflictingIdentifiers: [seenCatalogItemIds.get(catalogItemKey), catalogItemId],
      })
    }
    seenCatalogItemIds.set(catalogItemKey, catalogItemId)
    const itemAttendanceId = String(item.attendanceId || '').trim()
    if (itemAttendanceId && !sameIdentifier(itemAttendanceId, attendanceId)) {
      throw new ApiError(400, 'WORK_REWARD_BATCH_ATTENDANCE_MISMATCH', 'Mọi công việc trong một lần lưu phải thuộc cùng ca chấm công.')
    }
    return {
      attendanceId,
      catalogItemId,
      checked: true,
      ...(item.expectedEntityVersion == null ? {} : { expectedEntityVersion: item.expectedEntityVersion }),
    }
  })

  const batchEmployeeId = String(actor.employee_id || actor.user_id || '').trim()
  const batchEmployee = compensationEmployee(state, batchEmployeeId)
  const batchCanonicalEmployeeId = String(batchEmployee.id || batchEmployee.code || batchEmployee.employeeId)
  const batchAttendance = uniqueIdentifierRecordMatch({
    records: state.attendance,
    identifier: attendanceId,
    identifierOf: (record) => record?.id,
    predicate: (record) => !record?.deletedAt && belongsToEmployee(record, batchCanonicalEmployeeId),
    collisionCode: 'ATTENDANCE_IDENTIFIER_COLLISION',
    collisionMessage: 'Mã chấm công đang trùng với nhiều bản ghi; không thể ghi nhận thưởng an toàn.',
  })?.record || null
  if (!batchAttendance) throw new ApiError(404, 'ATTENDANCE_NOT_FOUND', 'Không tìm thấy ca chấm công của nhân viên.')
  const teamPrograms = new Map()
  for (const item of items) {
    const snapshot = rewardCatalogSnapshotForAttendance(batchAttendance, item.catalogItemId)
    if (snapshot.rewardScope !== 'team') continue
    const programId = String(snapshot.milestoneProgramId || 'team-work-reward').trim()
    const programKey = normalizeIdentifierKey(programId)
    if (teamPrograms.has(programKey)) {
      throw new ApiError(400, 'WORK_REWARD_TEAM_MILESTONE_BATCH_CONFLICT', 'Mỗi chương trình thưởng team chỉ được chọn một mốc trong cùng ngày.', {
        milestoneProgramId: programId,
        catalogItemIds: [teamPrograms.get(programKey), item.catalogItemId],
      })
    }
    teamPrograms.set(programKey, item.catalogItemId)
  }

  let workingState = state
  const plans = []
  for (const item of items) {
    const plan = planWorkRewardClaim({
      state: workingState,
      actor,
      payload: item,
      commandContext,
      commandType: body.type,
    })
    plans.push({ item, ...plan })
    workingState = plan.nextState
  }

  const results = plans.map((plan) => ({
    catalogItemId: String(plan.response.reward?.catalogItemId || plan.item.catalogItemId),
    checked: true,
    reward: plan.response.reward,
    entry: plan.response.entry || null,
    teamClaim: plan.response.teamClaim || null,
    existing: plan.response.existing === true,
  }))
  const changedPlans = plans.filter((plan) => plan.changed)
  const response = {
    command: body.type,
    attendanceId: String(results[0]?.reward?.attendanceId || attendanceId),
    results,
    rewards: results.map((result) => result.reward),
    entries: results.map((result) => result.entry).filter(Boolean),
    teamClaims: results.map((result) => result.teamClaim).filter(Boolean),
    createdCount: changedPlans.length,
    existingCount: plans.length - changedPlans.length,
  }
  if (!changedPlans.length) {
    return recordNoopCommand(db, actor, {
      ...response,
      version: Number(current.version),
      existing: true,
    }, 200, commandContext)
  }
  const nextState = {
    ...workingState,
    stateVersion: Math.max(1, Number(state.stateVersion) || 1) + 1,
  }
  return commitGlobalStateDomainCommand(db, actor, current, nextState, {
    action: body.type,
    entityType: 'work-catalog-reward-batch',
    entityId: `${response.attendanceId}:${String(results[0]?.reward?.employeeId || actor.employee_id || actor.user_id || '').trim()}`,
    before: changedPlans.map((plan) => plan.audit?.before || null),
    after: changedPlans.map((plan) => plan.audit?.after || plan.response.reward),
    metadata: {
      attendanceId: response.attendanceId,
      catalogItemIds: results.map((result) => result.catalogItemId),
      compensationEntryIds: results.map((result) => result.entry?.id).filter(Boolean),
      teamClaimIds: results.map((result) => result.teamClaim?.id).filter(Boolean),
      createdCount: response.createdCount,
      existingCount: response.existingCount,
    },
    response,
    status: 201,
  }, commandContext)
}

const resolveStoreViolationShiftSnapshot = (state, employee, employeeId, storeId, occurredOn, requestedShiftId) => {
  const assignments = (Array.isArray(state.schedule) ? state.schedule : []).filter((record) => (
    !record.deletedAt
    && (!record.storeId || sameIdentifier(record.storeId, storeId))
    && String(record.date || record.workDate || '') === occurredOn
    && belongsToEmployee(record, employeeId)
  ))
  const scheduledShifts = new Map()
  for (const assignment of assignments) {
    const snapshots = new Map()
    for (const snapshot of Array.isArray(assignment.shiftSnapshots) ? assignment.shiftSnapshots : []) {
      if (!isPlainRecord(snapshot)) continue
      const snapshotId = String(snapshot.id || '').trim()
      const snapshotKey = normalizeIdentifierKey(snapshotId)
      if (!snapshotKey) continue
      const existingSnapshot = snapshots.get(snapshotKey)
      if (existingSnapshot && String(existingSnapshot.id || '') !== snapshotId) {
        throwShiftIdentifierCollision([existingSnapshot, snapshot], snapshotId)
      }
      if (!existingSnapshot) snapshots.set(snapshotKey, snapshot)
    }
    const shiftIds = [...new Set([
      String(assignment.shiftId || ''),
      ...(Array.isArray(assignment.shiftIds) ? assignment.shiftIds.map(String) : []),
    ].filter(Boolean))]
    for (const shiftId of shiftIds) {
      const shiftKey = normalizeIdentifierKey(shiftId)
      if (!shiftKey) continue
      const existingShift = scheduledShifts.get(shiftKey)
      if (existingShift && existingShift.id !== shiftId) {
        throwShiftIdentifierCollision([{ id: existingShift.id }, { id: shiftId }], shiftId)
      }
      if (!existingShift) scheduledShifts.set(shiftKey, { id: shiftId, snapshot: snapshots.get(shiftKey) || null })
    }
  }
  let shiftKey = normalizeIdentifierKey(requestedShiftId)
  if (shiftKey && !scheduledShifts.has(shiftKey)) {
    throw new ApiError(400, 'VIOLATION_SHIFT_NOT_SCHEDULED', 'Ca làm việc không thuộc lịch phân ca của nhân viên trong ngày đã chọn.')
  }
  if (!shiftKey && scheduledShifts.size > 1) {
    throw new ApiError(400, 'VIOLATION_SHIFT_REQUIRED', 'Nhân viên có nhiều ca được phân; cần chọn ca bị vi phạm.')
  }
  if (!shiftKey) shiftKey = [...scheduledShifts.keys()][0] || ''
  const scheduledShift = scheduledShifts.get(shiftKey) || null
  const shiftId = String(scheduledShift?.id || '').trim()
  if (!shiftId) {
    throw new ApiError(409, 'VIOLATION_SHIFT_NOT_SCHEDULED', 'Nhân viên chưa có lịch phân ca tại cửa hàng trong ngày đã chọn.')
  }
  const scopedDefinitions = (Array.isArray(state.shiftDefinitions) ? state.shiftDefinitions : []).filter((record) => (
    !record.deletedAt
    && record.active !== false
    && (!record.storeId || sameIdentifier(record.storeId, storeId))
    && (!record.date || String(record.date) === occurredOn)
  ))
  const definition = uniqueShiftDefinitionMatch(scopedDefinitions, shiftId)
  const scheduledSnapshot = scheduledShift?.snapshot || null
  const snapshotTimes = scheduledSnapshot ? shiftTimes(scheduledSnapshot) : { start: null, end: null }
  const definitionTimes = definition ? shiftTimes(definition) : { start: null, end: null }
  const source = snapshotTimes.start && snapshotTimes.end ? scheduledSnapshot : definition
  const times = source === scheduledSnapshot ? snapshotTimes : definitionTimes
  if (!source || !times.start || !times.end) {
    throw new ApiError(409, 'VIOLATION_SHIFT_INVALID', 'Lịch phân ca thiếu snapshot hoặc định nghĩa ca hợp lệ.')
  }
  return {
    attendanceId: null,
    shiftId,
    shiftName: String(source.name || source.shiftName || shiftId).trim(),
    shiftStart: times.start.label,
    shiftEnd: times.end.label,
    shiftVersion: Number(source.version || 1),
    shiftSource: source === scheduledSnapshot ? 'store-schedule-snapshot' : 'store-shift-definition',
    employmentTypeSnapshot: employee.employmentType || null,
  }
}

const resolveViolationShiftSnapshot = (state, employee, employeeId, storeId, targetUnit, occurredOn, payload) => {
  const requestedAttendanceId = String(payload.attendanceId || '').trim()
  const requestedShiftId = String(payload.shiftId || '').trim()
  const attendanceCandidates = (Array.isArray(state.attendance) ? state.attendance : []).filter((record) => (
    !record.deletedAt
    && belongsToEmployee(record, employeeId)
    && dateFromRecord(record) === occurredOn
    && (!record.storeId || sameIdentifier(record.storeId, storeId))
  ))
  let attendance
  if (requestedAttendanceId) {
    attendance = uniqueIdentifierRecordMatch({
      records: attendanceCandidates,
      identifier: requestedAttendanceId,
      collisionCode: 'ATTENDANCE_IDENTIFIER_COLLISION',
      collisionMessage: 'Mã chấm công đang trùng với nhiều bản ghi; không thể ghi nhận vi phạm an toàn.',
    })?.record || null
    if (!attendance) {
      throw new ApiError(400, 'VIOLATION_ATTENDANCE_INVALID', 'Ca chấm công không thuộc nhân viên hoặc ngày đã chọn.')
    }
  } else {
    const matchingAttendance = requestedShiftId
      ? attendanceCandidates.filter((record) => sameIdentifier(record.shiftId || record.shift, requestedShiftId))
      : attendanceCandidates
    if (matchingAttendance.length > 1) {
      throw new ApiError(400, 'VIOLATION_ATTENDANCE_REQUIRED', 'Có nhiều ca chấm công phù hợp; cần chọn đúng ca chấm công.')
    }
    attendance = matchingAttendance[0] || null
  }
  if (attendance) {
    const shiftId = String(attendance.shiftId || attendance.shift || '').trim()
    if (!shiftId || (requestedShiftId && !sameIdentifier(requestedShiftId, shiftId))) {
      throw new ApiError(400, 'VIOLATION_SHIFT_MISMATCH', 'Ca làm việc không khớp với bản ghi chấm công.')
    }
    const hasCompleteSnapshot = Boolean(attendance.shiftStart && attendance.shiftEnd
      && Number.isSafeInteger(Number(attendance.shiftVersion)) && Number(attendance.shiftVersion) > 0)
    if (hasCompleteSnapshot) {
      return {
        attendanceId: String(attendance.id || '').trim(),
        shiftId,
        shiftName: String(attendance.shiftName || shiftId).trim(),
        shiftStart: attendance.shiftStart,
        shiftEnd: attendance.shiftEnd,
        shiftVersion: Number(attendance.shiftVersion),
        shiftSource: attendance.shiftSource || 'attendance-snapshot',
        employmentTypeSnapshot: attendance.employmentTypeSnapshot || employee.employmentType || null,
      }
    }
    let fallback = null
    if (targetUnit === WORK_CATALOG_TARGET.STORE) {
      fallback = resolveStoreViolationShiftSnapshot(state, employee, employeeId, storeId, occurredOn, shiftId)
    } else {
      const configuredShift = uniqueShiftDefinitionMatch(
        configuredProfileWorkShifts(employee, occurredOn, state),
        shiftId,
      )
      const start = configuredShift?.start || configuredShift?.shiftStart || null
      const end = configuredShift?.end || configuredShift?.shiftEnd || null
      if (configuredShift && start && end) {
        fallback = {
          attendanceId: null,
          shiftId,
          shiftName: String(configuredShift.name || configuredShift.shiftName || shiftId).trim(),
          shiftStart: start,
          shiftEnd: end,
          shiftVersion: Number(configuredShift.version || 1),
          shiftSource: configuredShift.source || 'profile-work-shift',
          employmentTypeSnapshot: employee.employmentType || null,
        }
      }
    }
    if (!fallback?.shiftStart || !fallback?.shiftEnd) {
      throw new ApiError(409, 'VIOLATION_SHIFT_SNAPSHOT_MISSING', 'Ca chấm công cũ thiếu snapshot ca và không thể khôi phục từ lịch làm việc; không ghi nhận vi phạm.')
    }
    return {
      ...fallback,
      attendanceId: String(attendance.id || '').trim(),
      employmentTypeSnapshot: attendance.employmentTypeSnapshot || fallback.employmentTypeSnapshot || employee.employmentType || null,
    }
  }
  if (targetUnit === WORK_CATALOG_TARGET.STORE) {
    return resolveStoreViolationShiftSnapshot(
      state,
      employee,
      employeeId,
      storeId,
      occurredOn,
      requestedShiftId,
    )
  }
  const configuredShifts = configuredProfileWorkShifts(employee, occurredOn, state)
  let configuredShift = null
  if (requestedShiftId) {
    configuredShift = uniqueShiftDefinitionMatch(configuredShifts, requestedShiftId)
    if (!configuredShift) {
      throw new ApiError(400, 'VIOLATION_SHIFT_INVALID', 'Ca làm việc không thuộc lịch hồ sơ của nhân viên trong ngày đã chọn.')
    }
  } else if (configuredShifts.length === 1) {
    configuredShift = configuredShifts[0]
  } else if (configuredShifts.length > 1) {
    throw new ApiError(400, 'VIOLATION_SHIFT_REQUIRED', 'Nhân viên có nhiều ca làm việc; cần chọn ca bị vi phạm.')
  }
  if (!configuredShift) {
    throw new ApiError(409, 'VIOLATION_SHIFT_NOT_CONFIGURED', 'Không tìm thấy ca chấm công hoặc lịch hồ sơ hợp lệ cho ngày đã chọn.')
  }
  return {
    attendanceId: null,
    shiftId: String(configuredShift.id || '').trim(),
    shiftName: String(configuredShift.name || configuredShift.id || '').trim(),
    shiftStart: configuredShift.start || null,
    shiftEnd: configuredShift.end || null,
    shiftVersion: Number(configuredShift.version || 1),
    shiftSource: configuredShift.source || 'profile-work-shift',
    employmentTypeSnapshot: employee.employmentType || null,
  }
}

const violationOccurrenceKey = ({ employeeId, occurredOn, shiftId, catalogItemId }) => {
  try {
    return workCatalogViolationKey({ employeeId, workDate: occurredOn, shiftRef: shiftId, catalogItemId })
  } catch (error) {
    throw new ApiError(409, 'VIOLATION_IDENTITY_INVALID', 'Không thể tạo định danh ổn định cho vi phạm.', {
      reason: error instanceof Error ? error.message : String(error),
    })
  }
}

const violationMatchesOccurrence = (record, occurrenceKey, identity) => (
  String(record?.occurrenceKey || record?.id || '') === occurrenceKey
  || (
    String(record?.employeeId || '') === identity.employeeId
    && String(record?.occurredOn || record?.workDate || record?.date || '') === identity.occurredOn
    && String(record?.shiftId || record?.shift || '') === identity.shiftId
    && String(record?.catalogItemId || '') === identity.catalogItemId
  )
)

const violationCommand = async (db, actor, body, commandContext) => {
  const operation = body.type.split('.').at(-1)
  if (!['create', 'create_batch', 'void'].includes(operation)) throw new ApiError(400, 'COMMAND_UNKNOWN', 'Lệnh vi phạm không được hỗ trợ.')
  if (!PAYROLL_OPERATOR_ROLES.has(actor.role) && actor.role !== 'store_manager') {
    throw new ApiError(403, 'ROLE_FORBIDDEN', 'Tài khoản không có quyền quản lý vi phạm.')
  }
  const payload = isPlainRecord(body.payload) ? body.payload : {}
  const { current, state } = await loadGlobalCommandState(db, body)
  const records = Array.isArray(state.violations) ? state.violations : []
  const actorSnapshot = serverActorSnapshot(actor)
  if (operation === 'create_batch') {
    const targetUnit = String(payload.targetUnit || 'store').trim()
    if (!['store', 'office', 'business_support'].includes(targetUnit)) {
      throw new ApiError(400, 'VIOLATION_UNIT_INVALID', 'Nhóm nhân viên vi phạm không hợp lệ.')
    }
    if (actor.role === 'store_manager' && targetUnit !== 'store') {
      throw new ApiError(403, 'STORE_SCOPE_FORBIDDEN', 'Quản lý cửa hàng chỉ được ghi nhận vi phạm nhân viên thuộc cửa hàng của mình.')
    }
    if (targetUnit === 'business_support') assertAdmin(actor, 'Chỉ Admin được ghi nhận vi phạm cho Nhân viên hỗ trợ KD.')
    const employee = compensationEmployee(state, payload.employeeId)
    const employeeId = String(employee.id || employee.code || employee.employeeId)
    if (employeeUnit(employee) !== targetUnit) {
      throw new ApiError(409, 'EMPLOYEE_UNIT_MISMATCH', 'Nhân viên không thuộc nhóm đã chọn.')
    }
    const storeId = targetUnit === 'store'
      ? String(payload.storeId || employee.storeId || '').trim()
      : targetUnit === 'office' ? OFFICE_STORE_ID : BUSINESS_SUPPORT_STORE_ID
    if (targetUnit === 'store') {
      assertOperationalStoreAccess(actor, storeId)
      requireActivePhysicalStore(state, storeId)
      if (String(employee.storeId || '') !== storeId) {
        throw new ApiError(409, 'EMPLOYEE_STORE_MISMATCH', 'Nhân viên không thuộc cửa hàng đã chọn.')
      }
    }
    const occurredOn = compensationDate(payload.occurredOn, 'Ngày phát sinh')
    const period = occurredOn.slice(0, 7)
    assertPayrollNotPaidOrLocked(state, storeId, period)
    const shiftSnapshot = resolveViolationShiftSnapshot(
      state,
      employee,
      employeeId,
      storeId,
      targetUnit,
      occurredOn,
      payload,
    )
    if (!Array.isArray(payload.catalogItemIds)) {
      throw new ApiError(400, 'VIOLATION_CATALOG_REQUIRED', 'Cần chọn ít nhất một nội dung vi phạm.')
    }
    const requestedCatalogItemIds = payload.catalogItemIds.map((value) => String(value || '').trim())
    if (requestedCatalogItemIds.some((value) => !value)) {
      throw new ApiError(400, 'VIOLATION_CATALOG_INVALID', 'Danh sách vi phạm chứa mã không hợp lệ.')
    }
    const catalogItemIds = [...new Set(requestedCatalogItemIds)]
    if (catalogItemIds.length !== requestedCatalogItemIds.length) {
      throw new ApiError(400, 'VIOLATION_CATALOG_DUPLICATE', 'Mỗi nội dung vi phạm chỉ được chọn một lần trong cùng yêu cầu.')
    }
    if (!catalogItemIds.length || catalogItemIds.length > 100) {
      throw new ApiError(400, 'VIOLATION_CATALOG_INVALID', 'Cần chọn từ 1 đến 100 nội dung vi phạm.')
    }
    let availableCatalogItems
    try {
      availableCatalogItems = activeWorkCatalogItems(state.workCatalogItems, {
        targetGroup: targetUnit,
        storeId: targetUnit === WORK_CATALOG_TARGET.STORE ? storeId : null,
        shiftId: shiftSnapshot.shiftId,
        shiftName: shiftSnapshot.shiftName,
        date: occurredOn,
        kinds: WORK_CATALOG_KIND.VIOLATION,
      })
    } catch (error) {
      throw new ApiError(409, 'WORK_CATALOG_DATA_INVALID', 'Danh mục vi phạm đang có dữ liệu không hợp lệ.', {
        reason: error instanceof Error ? error.message : String(error),
      })
    }
    const catalogById = new Map(availableCatalogItems.map((item) => [item.id, item]))
    const missingCatalogItemIds = catalogItemIds.filter((catalogItemId) => !catalogById.has(catalogItemId))
    if (missingCatalogItemIds.length) {
      throw new ApiError(400, 'VIOLATION_CATALOG_INVALID', 'Nội dung vi phạm không còn hoạt động hoặc không thuộc ca và nhóm đã chọn.', {
        catalogItemIds: missingCatalogItemIds,
      })
    }
    const note = String(payload.note || '').trim()
    if (note.length > 1_000) throw new ApiError(400, 'NOTE_INVALID', 'Ghi chú không được vượt quá 1.000 ký tự.')
    const employeeName = employee.name || employee.displayName || employeeId
    const selected = []
    const created = []
    const reactivated = []
    for (const catalogItemId of catalogItemIds) {
      const catalogItem = catalogById.get(catalogItemId)
      const identity = { employeeId, occurredOn, shiftId: shiftSnapshot.shiftId, catalogItemId }
      const occurrenceKey = violationOccurrenceKey(identity)
      const existing = records.find((record) => violationMatchesOccurrence(record, occurrenceKey, identity)) || null
      if (existing) {
        if (existing.voidedAt || normalizeTextKey(existing.status) === 'void') {
          const revived = {
            ...existing,
            status: 'ACTIVE',
            voidedAt: null,
            voidedBy: null,
            voidReason: null,
            updatedAt: commandContext.now,
            updatedBy: actorSnapshot,
            version: Number(existing.version || 1) + 1,
          }
          reactivated.push(revived)
          selected.push(revived)
        } else selected.push(existing)
        continue
      }
      const catalogSnapshot = {
        id: catalogItem.id,
        code: catalogItem.code,
        name: catalogItem.name,
        amountVnd: catalogItem.amountVnd,
        targetGroup: catalogItem.targetGroup,
        kind: catalogItem.kind,
        version: catalogItem.version,
      }
      const violation = {
        id: occurrenceKey,
        occurrenceKey,
        targetUnit,
        employeeId,
        employeeName,
        storeId,
        policyCode: catalogItem.code,
        title: catalogItem.name,
        amountVnd: catalogItem.amountVnd,
        catalogItemId: catalogItem.id,
        catalogCode: catalogItem.code,
        catalogVersion: catalogItem.version,
        catalogSnapshot,
        occurredOn,
        workDate: occurredOn,
        date: occurredOn,
        period,
        attendanceId: shiftSnapshot.attendanceId,
        shiftId: shiftSnapshot.shiftId,
        shift: shiftSnapshot.shiftId,
        shiftName: shiftSnapshot.shiftName,
        shiftStart: shiftSnapshot.shiftStart,
        shiftEnd: shiftSnapshot.shiftEnd,
        shiftVersion: shiftSnapshot.shiftVersion,
        shiftSource: shiftSnapshot.shiftSource,
        employmentTypeSnapshot: shiftSnapshot.employmentTypeSnapshot,
        note,
        status: 'ACTIVE',
        version: 1,
        createdAt: commandContext.now,
        createdBy: actorSnapshot,
        updatedAt: commandContext.now,
        deletedAt: null,
        voidedAt: null,
      }
      created.push(violation)
      selected.push(violation)
    }
    if (!created.length && !reactivated.length) {
      return recordNoopCommand(db, actor, {
        command: body.type,
        version: Number(current.version),
        violations: selected,
        createdCount: 0,
        existingCount: selected.length,
        existing: true,
      }, 200, commandContext)
    }
    const nextState = {
      ...state,
      violations: [
        ...created,
        ...records.map((record) => reactivated.find((item) => String(item.id || '') === String(record.id || '')) || record),
      ],
      payrollPeriods: invalidateClosedPayrollPeriods(state, { storeId, period }, commandContext.now, body.type),
      stateVersion: Math.max(1, Number(state.stateVersion) || 1) + 1,
    }
    return commitGlobalStateDomainCommand(db, actor, current, nextState, {
      action: body.type,
      entityType: 'violation-batch',
      entityId: `violation-batch:${employeeId}:${occurredOn}:${shiftSnapshot.shiftId}`,
      before: selected.filter((record) => !created.includes(record)),
      after: selected,
      metadata: {
        targetUnit, storeId, employeeId, period, shiftId: shiftSnapshot.shiftId,
        attendanceId: shiftSnapshot.attendanceId, createdCount: created.length,
        reactivatedCount: reactivated.length,
        existingCount: selected.length - created.length - reactivated.length,
      },
      response: {
        command: body.type,
        violations: selected,
        createdCount: created.length,
        reactivatedCount: reactivated.length,
        existingCount: selected.length - created.length - reactivated.length,
      },
      status: created.length ? 201 : 200,
    }, commandContext)
  }
  if (operation === 'create') {
    const targetUnit = String(payload.targetUnit || 'store').trim()
    if (!['store', 'office', 'business_support'].includes(targetUnit)) {
      throw new ApiError(400, 'VIOLATION_UNIT_INVALID', 'Nhóm nhân viên vi phạm không hợp lệ.')
    }
    if (actor.role === 'store_manager' && targetUnit !== 'store') {
      throw new ApiError(403, 'STORE_SCOPE_FORBIDDEN', 'Quản lý cửa hàng chỉ được ghi nhận vi phạm nhân viên thuộc cửa hàng của mình.')
    }
    if (targetUnit === 'business_support') assertAdmin(actor, 'Chỉ Admin được ghi nhận vi phạm cho Nhân viên hỗ trợ KD.')
    const employee = compensationEmployee(state, payload.employeeId)
    const employeeId = String(employee.id || employee.code || employee.employeeId)
    const actualUnit = employeeUnit(employee)
    if (actualUnit !== targetUnit) throw new ApiError(409, 'EMPLOYEE_UNIT_MISMATCH', 'Nhân viên không thuộc nhóm đã chọn.')
    const storeId = targetUnit === 'store'
      ? String(payload.storeId || employee.storeId || '').trim()
      : targetUnit === 'office' ? OFFICE_STORE_ID : BUSINESS_SUPPORT_STORE_ID
    if (targetUnit === 'store') {
      assertOperationalStoreAccess(actor, storeId)
      requireActivePhysicalStore(state, storeId)
      if (String(employee.storeId || '') !== storeId) throw new ApiError(409, 'EMPLOYEE_STORE_MISMATCH', 'Nhân viên không thuộc cửa hàng đã chọn.')
    }
    const occurredOn = compensationDate(payload.occurredOn, 'Ngày phát sinh')
    const period = occurredOn.slice(0, 7)
    assertPayrollNotPaidOrLocked(state, storeId, period)
    const shiftSnapshot = resolveViolationShiftSnapshot(
      state,
      employee,
      employeeId,
      storeId,
      targetUnit,
      occurredOn,
      payload,
    )
    const catalogItemId = String(payload.catalogItemId || '').trim()
    let catalogItem = null
    let policyCode = String(payload.policyCode || '').trim()
    let title
    let amountVnd
    if (catalogItemId) {
      try {
        catalogItem = activeWorkCatalogItems(state.workCatalogItems, {
          targetGroup: targetUnit,
          storeId: targetUnit === WORK_CATALOG_TARGET.STORE ? storeId : null,
          date: occurredOn,
          kinds: WORK_CATALOG_KIND.VIOLATION,
        }).find((record) => record.id === catalogItemId) || null
      } catch (error) {
        throw new ApiError(409, 'WORK_CATALOG_DATA_INVALID', 'Danh mục vi phạm đang có dữ liệu không hợp lệ.', {
          reason: error instanceof Error ? error.message : String(error),
        })
      }
      if (!catalogItem) {
        throw new ApiError(400, 'VIOLATION_CATALOG_INVALID', 'Nội dung vi phạm không còn hoạt động hoặc không thuộc nhóm nhân viên đã chọn.')
      }
      policyCode = catalogItem.code
      title = catalogItem.name
      amountVnd = asVnd(payload.amountVnd ?? catalogItem.amountVnd, 'Số tiền vi phạm', { positive: true })
      if (amountVnd !== catalogItem.amountVnd) {
        throw new ApiError(400, 'VIOLATION_AMOUNT_INVALID', 'Số tiền vi phạm phải đúng danh mục hiện hành.')
      }
    } else {
      // Backward compatibility for already deployed clients. New interfaces
      // always send catalogItemId and never display these retired constants.
      const policy = canonicalViolationPolicy(targetUnit, policyCode)
      if (!policy) throw new ApiError(400, 'VIOLATION_POLICY_INVALID', 'Nội dung vi phạm không thuộc chính sách hiện hành.')
      title = policy.label
      amountVnd = asVnd(payload.amountVnd ?? policy.amountVnd, 'Số tiền vi phạm', { positive: true })
      if (amountVnd !== policy.amountVnd) throw new ApiError(400, 'VIOLATION_AMOUNT_INVALID', 'Số tiền vi phạm phải đúng chính sách hiện hành.')
    }
    const occurrenceCatalogItemId = catalogItem?.id || `legacy-policy:${policyCode}`
    const occurrenceIdentity = {
      employeeId,
      occurredOn,
      shiftId: shiftSnapshot.shiftId,
      catalogItemId: occurrenceCatalogItemId,
    }
    const occurrenceKey = violationOccurrenceKey(occurrenceIdentity)
    const existing = records.find((record) => violationMatchesOccurrence(record, occurrenceKey, occurrenceIdentity)) || null
    if (existing) {
      if (existing.voidedAt || normalizeTextKey(existing.status) === 'void') {
        const revived = {
          ...existing,
          status: 'ACTIVE',
          voidedAt: null,
          voidedBy: null,
          voidReason: null,
          updatedAt: commandContext.now,
          updatedBy: actorSnapshot,
          version: Number(existing.version || 1) + 1,
        }
        const nextState = {
          ...state,
          violations: records.map((record) => String(record.id || '') === String(existing.id || '') ? revived : record),
          payrollPeriods: invalidateClosedPayrollPeriods(state, { storeId, period }, commandContext.now, body.type),
          stateVersion: Math.max(1, Number(state.stateVersion) || 1) + 1,
        }
        return commitGlobalStateDomainCommand(db, actor, current, nextState, {
          action: body.type,
          entityType: 'violation',
          entityId: revived.id,
          before: existing,
          after: revived,
          metadata: { targetUnit, storeId, employeeId, period, shiftId: shiftSnapshot.shiftId, reactivated: true },
          response: { command: body.type, violation: revived, existing: true, reactivated: true },
          status: 200,
        }, commandContext)
      }
      return recordNoopCommand(db, actor, {
        command: body.type,
        version: Number(current.version),
        violation: existing,
        existing: true,
      }, 200, commandContext)
    }
    const note = String(payload.note || '').trim()
    if (note.length > 1_000) throw new ApiError(400, 'NOTE_INVALID', 'Ghi chú không được vượt quá 1.000 ký tự.')
    const violation = {
      id: occurrenceKey,
      occurrenceKey,
      targetUnit,
      employeeId,
      employeeName: employee.name || employee.displayName || employeeId,
      storeId,
      policyCode,
      title,
      amountVnd,
      ...(catalogItem ? {
        catalogItemId: catalogItem.id,
        catalogCode: catalogItem.code,
        catalogVersion: catalogItem.version,
        catalogSnapshot: {
          id: catalogItem.id,
          code: catalogItem.code,
          name: catalogItem.name,
          amountVnd: catalogItem.amountVnd,
          targetGroup: catalogItem.targetGroup,
          kind: catalogItem.kind,
          version: catalogItem.version,
        },
      } : {}),
      occurredOn,
      workDate: occurredOn,
      date: occurredOn,
      attendanceId: shiftSnapshot.attendanceId,
      shiftId: shiftSnapshot.shiftId,
      shift: shiftSnapshot.shiftId,
      shiftName: shiftSnapshot.shiftName,
      shiftStart: shiftSnapshot.shiftStart,
      shiftEnd: shiftSnapshot.shiftEnd,
      shiftVersion: shiftSnapshot.shiftVersion,
      shiftSource: shiftSnapshot.shiftSource,
      employmentTypeSnapshot: shiftSnapshot.employmentTypeSnapshot,
      period,
      note,
      status: 'ACTIVE',
      version: 1,
      createdAt: commandContext.now,
      createdBy: actorSnapshot,
      updatedAt: commandContext.now,
      deletedAt: null,
      voidedAt: null,
    }
    const nextState = {
      ...state,
      violations: [violation, ...records],
      payrollPeriods: invalidateClosedPayrollPeriods(state, { storeId, period }, commandContext.now, body.type),
      stateVersion: Math.max(1, Number(state.stateVersion) || 1) + 1,
    }
    return commitGlobalStateDomainCommand(db, actor, current, nextState, {
      action: body.type,
      entityType: 'violation',
      entityId: violation.id,
      before: null,
      after: violation,
      metadata: { targetUnit, storeId, employeeId, period, policyCode, amountVnd },
      response: { command: body.type, violation },
      status: 201,
    }, commandContext)
  }
  const violationId = String(payload.id || payload.violationId || '').trim()
  const previous = records.find((record) => String(record.id || '') === violationId)
  if (!previous) throw new ApiError(404, 'VIOLATION_NOT_FOUND', 'Không tìm thấy vi phạm.')
  expectedEntityVersion(payload, previous)
  if (previous.targetUnit === 'business_support') assertAdmin(actor, 'Chỉ Admin được hủy vi phạm của Nhân viên hỗ trợ KD.')
  if (previous.targetUnit === 'store') {
    assertOperationalStoreAccess(actor, previous.storeId)
    requireActivePhysicalStore(state, previous.storeId)
  }
  const period = asMonth(previous.period || monthFromRecord(previous))
  assertPayrollNotPaidOrLocked(state, previous.storeId, period)
  if (previous.voidedAt || normalizeTextKey(previous.status) === 'void') {
    return recordNoopCommand(db, actor, {
      command: body.type, version: Number(current.version), violation: previous, existing: true,
    }, 200, commandContext)
  }
  const reason = String(payload.reason || '').trim()
  if (!reason || reason.length > 500) throw new ApiError(400, 'REASON_REQUIRED', 'Cần nhập lý do hủy từ 1 đến 500 ký tự.')
  const next = {
    ...previous,
    status: 'VOID',
    voidedAt: commandContext.now,
    voidedBy: actorSnapshot,
    voidReason: reason,
    updatedAt: commandContext.now,
    updatedBy: actorSnapshot,
    version: Number(previous.version || 1) + 1,
  }
  const nextState = {
    ...state,
    violations: records.map((record) => String(record.id || '') === violationId ? next : record),
    payrollPeriods: invalidateClosedPayrollPeriods(state, { storeId: previous.storeId, period }, commandContext.now, body.type),
    stateVersion: Math.max(1, Number(state.stateVersion) || 1) + 1,
  }
  return commitGlobalStateDomainCommand(db, actor, current, nextState, {
    action: body.type,
    entityType: 'violation',
    entityId: violationId,
    before: previous,
    after: next,
    metadata: { targetUnit: previous.targetUnit, storeId: previous.storeId, employeeId: previous.employeeId, period },
    response: { command: body.type, violation: next },
  }, commandContext)
}

const revenueBonusProgramForStore = (store) => {
  const isSm = classifyStorePayrollPolicy(store) === STORE_PAYROLL_POLICY.SM_TNV
  return isSm
    ? {
        programId: REVENUE_BONUS_PROGRAM_IDS.SM_DAILY,
        milestoneProgramId: TEAM_MILESTONE_PROGRAM_IDS.SM_DAILY_REVENUE,
      }
    : {
        programId: REVENUE_BONUS_PROGRAM_IDS.DOSII_DAILY,
        milestoneProgramId: TEAM_MILESTONE_PROGRAM_IDS.DOSII_DAILY_REVENUE,
      }
}

const liveAttendanceSeconds = (record, nowMs, projectOpen = true) => {
  const storedSource = record?.approvedSalesSeconds
    ?? record?.workedSeconds
    ?? (record?.hours == null ? 0 : Number(record.hours) * 3_600)
  const parsedStoredSeconds = Number(storedSource)
  const storedSeconds = Number.isFinite(parsedStoredSeconds) && parsedStoredSeconds >= 0 ? parsedStoredSeconds : 0
  if (record?.checkOutAt || record?.checkOut) return Math.max(0, Math.trunc(storedSeconds))
  if (!projectOpen) return Math.max(0, Math.trunc(storedSeconds))
  const checkInMs = Date.parse(record?.checkInAt || '')
  if (!Number.isFinite(checkInMs) || nowMs <= checkInMs) return Math.max(0, Math.trunc(storedSeconds))
  const elapsedSeconds = Math.floor((nowMs - checkInMs) / 1_000)
  return Math.max(Math.trunc(storedSeconds), Math.min(elapsedSeconds, 24 * 60 * 60))
}

const publicRevenueBonusEligibility = (eligibility = {}) => {
  const {
    openAttendanceIds,
    conflictingIds,
    existingId,
    ...safeEligibility
  } = eligibility
  void openAttendanceIds
  void conflictingIds
  void existingId
  return safeEligibility
}

export const revenueBonusLiveSnapshot = ({ state, store, businessDate, now = new Date().toISOString() } = {}) => {
  const storeId = String(store?.id || '')
  const nowMs = Date.parse(now)
  if (!storeId || !Number.isFinite(nowMs)) throw new TypeError('store and a valid now timestamp are required.')
  assertNoCaseCollidingOperationalIdentifiers(state)
  const projectOpenAttendance = businessDate === localDateTimeParts(new Date(nowMs).toISOString()).date

  const orders = (Array.isArray(state?.orders) ? state.orders : []).filter((order) => (
    sameIdentifier(order.storeId, storeId)
    && dateFromRecord(order) === businessDate
    && !order.deletedAt
    && String(order.status || '') !== 'Đã xóa'
    && Number.isSafeInteger(Number(order.amount))
    && Number(order.amount) >= 0
  ))
  const revenueVnd = orders.reduce(
    (sum, order) => safeMoneySum(sum, Number(order.amount), 'Doanh thu ngày'),
    0,
  )
  const { programId } = revenueBonusProgramForStore(store)
  const percentage = calculateRevenueBonus({ programId, revenueVnd })
  const employeeById = new Map((Array.isArray(state?.employees) ? state.employees : []).flatMap((employee) => (
    employeeIdentifierValues(employee)
      .map((id) => [normalizeIdentifierKey(id), employee])
  )))
  const weightByEmployee = new Map()
  let attendanceCount = 0
  let openAttendanceCount = 0
  const activeEmployeeIds = new Set()
  for (const attendance of Array.isArray(state?.attendance) ? state.attendance : []) {
    const requestedEmployeeId = String(attendance.employeeId || '').trim()
    const employee = employeeById.get(normalizeIdentifierKey(requestedEmployeeId))
    if (!requestedEmployeeId || !employee
      || !sameIdentifier(attendance.storeId, storeId)
      || dateFromRecord(attendance) !== businessDate
      || attendance.deletedAt) continue
    const employeeId = String(employee.id || employee.code || employee.employeeId || requestedEmployeeId).trim()
    attendanceCount += 1
    const open = !attendance.checkOutAt && !attendance.checkOut
    if (open) {
      openAttendanceCount += 1
      activeEmployeeIds.add(employeeId)
    }
    const seconds = liveAttendanceSeconds(attendance, nowMs, projectOpenAttendance)
    if (seconds > 0) weightByEmployee.set(employeeId, (weightByEmployee.get(employeeId) || 0) + seconds)
  }
  const participants = [...weightByEmployee].map(([id, weightUnits]) => ({ id, weightUnits }))
  const allocation = participants.length
    ? allocateByLargestRemainder({ poolVnd: percentage.bonusVnd, participants })
    : {
        poolVnd: percentage.bonusVnd,
        totalWeightUnits: 0,
        allocatedVnd: 0,
        unallocatedVnd: percentage.bonusVnd,
        allocations: [],
      }
  const allocations = allocation.allocations.map((record) => {
    const employee = employeeById.get(normalizeIdentifierKey(record.id))
    return {
      employeeId: record.id,
      employeeName: employee?.name || employee?.displayName || record.id,
      workedSeconds: record.weightUnits,
      amountVnd: record.amountVnd,
      weightPercent: allocation.totalWeightUnits > 0
        ? (record.weightUnits / allocation.totalWeightUnits) * 100
        : 0,
      status: 'LIVE',
    }
  })
  const calculationEligibility = publicRevenueBonusEligibility(revenueBonusEligibility({
    storeId,
    businessDate,
    schedule: Array.isArray(state?.schedule) ? state.schedule : [],
    shiftDefinitions: Array.isArray(state?.shiftDefinitions) ? state.shiftDefinitions : [],
    attendance: Array.isArray(state?.attendance) ? state.attendance : [],
    dailyRecords: Array.isArray(state?.revenueBonusDaily) ? state.revenueBonusDaily : [],
  }))
  return {
    storeId,
    businessDate,
    projectedAt: new Date(nowMs).toISOString(),
    revenueVnd,
    orderCount: orders.length,
    programId,
    tierId: percentage.tierId,
    rateBasisPoints: percentage.rateBasisPoints,
    percentagePoolVnd: percentage.bonusVnd,
    allocatedVnd: allocation.allocatedVnd,
    unallocatedVnd: allocation.unallocatedVnd,
    totalWorkedSeconds: allocation.totalWeightUnits,
    attendanceCount,
    openAttendanceCount,
    activeEmployeeCount: activeEmployeeIds.size,
    participantCount: participants.length,
    calculationEligibility,
    allocations,
  }
}

const revenueBonusMilestoneDecision = async (db, actor, body, commandContext, current, state, payload) => {
  const approve = body.type === 'revenue_bonus.approve_milestone'
  const requestedClaimId = String(payload.claimId || payload.teamRewardClaimId || '').trim()
  const claims = Array.isArray(state.teamRewardClaims) ? state.teamRewardClaims : []
  const claimMatch = uniqueIdentifierRecordMatch({
    records: claims,
    identifier: requestedClaimId,
    collisionCode: 'TEAM_REWARD_CLAIM_IDENTIFIER_COLLISION',
    collisionMessage: 'Mã đề nghị thưởng đang trùng với nhiều bản ghi; không thể xử lý an toàn.',
  })
  const claim = claimMatch?.record || null
  if (!claim) throw new ApiError(404, 'TEAM_REWARD_CLAIM_NOT_FOUND', 'Không tìm thấy đề nghị thưởng nóng.')
  const claimId = String(claim.id || requestedClaimId).trim()
  const claimReferenceMatches = (reference) => mutationIdentifierReferenceMatchesRecord({
    records: claims,
    record: claim,
    reference,
    collisionCode: 'TEAM_REWARD_CLAIM_REFERENCE_COLLISION',
    collisionMessage: 'Người tham gia đang tham chiếu mơ hồ tới nhiều đề nghị thưởng; không thể duyệt an toàn.',
  })
  assertOperationalStoreAccess(actor, claim.storeId)
  requireActivePhysicalStore(state, claim.storeId)
  expectedEntityVersion(payload, claim)
  const normalizedStatus = normalizeTextKey(claim.status)
  const finalStatus = approve ? 'approved' : 'rejected'
  if (normalizedStatus === finalStatus) {
    return recordNoopCommand(db, actor, {
      command: body.type, version: Number(current.version), teamClaim: claim, existing: true,
    }, 200, commandContext)
  }
  if (normalizedStatus !== 'pending') {
    throw new ApiError(409, 'TEAM_REWARD_CLAIM_FINALIZED', 'Đề nghị thưởng nóng đã được xử lý.')
  }
  const dailyRecords = Array.isArray(state.revenueBonusDaily) ? state.revenueBonusDaily : []
  const dailyMatch = uniqueIdentifierRecordMatch({
    records: dailyRecords,
    identifier: claim.revenueBonusDailyId,
    collisionCode: 'REVENUE_BONUS_DAILY_IDENTIFIER_COLLISION',
    collisionMessage: 'Mã kết quả thưởng ngày đang trùng với nhiều bản ghi; không thể xử lý an toàn.',
  })
  const daily = dailyMatch?.record || null
  if (!daily || daily.supersededAt || daily.voidedAt) {
    throw new ApiError(409, 'REVENUE_BONUS_SUPERSEDED', 'Kết quả tính thưởng ngày đã thay đổi; không thể duyệt đề nghị cũ.')
  }
  const dailyReferenceMatches = (reference) => mutationIdentifierReferenceMatchesRecord({
    records: dailyRecords,
    record: daily,
    reference,
    collisionCode: 'REVENUE_BONUS_DAILY_REFERENCE_COLLISION',
    collisionMessage: 'Bản ghi thưởng đang tham chiếu mơ hồ tới nhiều kết quả thưởng ngày; không thể quyết toán an toàn.',
  })
  if (!sameIdentifier(daily.milestoneId, claim.milestoneId)
    || Number(daily.pendingMilestonePoolVnd || 0) !== Number(claim.amountVnd || 0)) {
    throw new ApiError(409, 'TEAM_REWARD_NOT_HIGHEST', 'Chỉ được duyệt mốc thưởng cao nhất đang hiệu lực.')
  }
  const participants = (Array.isArray(state.teamRewardParticipants) ? state.teamRewardParticipants : [])
    .filter((record) => claimReferenceMatches(record.claimId))
  const actorEmployeeId = String(actor.employee_id || actor.user_id || '')
  if (approve && participants.some((record) => belongsToEmployee(record, actorEmployeeId))) {
    throw new ApiError(403, 'SELF_APPROVAL_FORBIDDEN', 'Người tham gia không được tự duyệt thưởng nóng của mình.')
  }
  const actorSnapshot = serverActorSnapshot(actor)
  const decidedClaim = {
    ...claim,
    status: approve ? 'APPROVED' : 'REJECTED',
    approvedAt: approve ? commandContext.now : null,
    approvedBy: approve ? actorSnapshot : null,
    rejectedAt: approve ? null : commandContext.now,
    rejectedBy: approve ? null : actorSnapshot,
    decisionNote: String(payload.note || '').trim().slice(0, 500),
    updatedAt: commandContext.now,
    version: Number(claim.version || 1) + 1,
  }
  const decidedParticipants = participants.map((record) => ({
    ...record,
    status: approve ? 'APPROVED' : 'REJECTED',
    amountVnd: approve ? Number(record.proposedAmountVnd || 0) : 0,
    approvedAt: approve ? commandContext.now : null,
    approvedBy: approve ? actorSnapshot : null,
    rejectedAt: approve ? null : commandContext.now,
    rejectedBy: approve ? null : actorSnapshot,
    updatedAt: commandContext.now,
    version: Number(record.version || 1) + 1,
  }))
  const participantByEmployee = new Map()
  for (const participant of decidedParticipants) {
    const employeeKey = normalizeIdentifierKey(participant.employeeId)
    if (!employeeKey) continue
    if (participantByEmployee.has(employeeKey)) {
      throw new ApiError(409, 'TEAM_REWARD_PARTICIPANT_COLLISION', 'Đề nghị thưởng có nhiều người tham gia trùng mã nhân viên; không thể phân bổ an toàn.')
    }
    participantByEmployee.set(employeeKey, participant)
  }
  const allocationEmployeeKeys = new Set()
  for (const record of Array.isArray(state.revenueBonusAllocations) ? state.revenueBonusAllocations : []) {
    if (!dailyReferenceMatches(record.revenueBonusDailyId)) continue
    const employeeKey = normalizeIdentifierKey(record.employeeId)
    if (!employeeKey) continue
    if (allocationEmployeeKeys.has(employeeKey)) {
      throw new ApiError(409, 'REVENUE_BONUS_ALLOCATION_COLLISION', 'Kết quả thưởng ngày có nhiều phân bổ trùng mã nhân viên; không thể quyết toán an toàn.')
    }
    allocationEmployeeKeys.add(employeeKey)
  }
  const allocations = (Array.isArray(state.revenueBonusAllocations) ? state.revenueBonusAllocations : []).map((record) => {
    if (!dailyReferenceMatches(record.revenueBonusDailyId)) return record
    const participant = participantByEmployee.get(normalizeIdentifierKey(record.employeeId))
    if (!participant) return record
    const milestonePoolVnd = approve ? Number(participant.amountVnd || 0) : 0
    return {
      ...record,
      milestonePoolVnd,
      amountVnd: safeMoneySum(Number(record.percentagePoolVnd || 0), milestonePoolVnd, 'Thưởng doanh thu nhân viên'),
      updatedAt: commandContext.now,
      version: Number(record.version || 1) + 1,
    }
  })
  const dailyAllocations = allocations.filter((record) => dailyReferenceMatches(record.revenueBonusDailyId))
  const allocatedVnd = dailyAllocations.reduce((sum, record) => safeMoneySum(sum, Number(record.amountVnd || 0), 'Thưởng đã phân bổ'), 0)
  const milestonePoolVnd = approve ? Number(claim.amountVnd || 0) : 0
  const totalPoolVnd = safeMoneySum(Number(daily.percentagePoolVnd || 0), milestonePoolVnd, 'Tổng quỹ thưởng doanh thu')
  const decidedDaily = {
    ...daily,
    milestonePoolVnd,
    pendingMilestonePoolVnd: 0,
    rejectedMilestonePoolVnd: approve ? 0 : Number(claim.amountVnd || 0),
    milestoneStatus: approve ? 'APPROVED' : 'REJECTED',
    totalPoolVnd,
    allocatedVnd,
    unallocatedVnd: Math.max(0, totalPoolVnd - allocatedVnd),
    updatedAt: commandContext.now,
    version: Number(daily.version || 1) + 1,
  }
  const reconciliation = {
    id: `prc_${crypto.randomUUID()}`,
    storeId: claim.storeId,
    period: claim.period,
    businessDate: claim.businessDate,
    type: approve ? 'TEAM_REWARD_APPROVAL' : 'TEAM_REWARD_REJECTION',
    sourceId: claimId,
    totalPoolVnd,
    allocatedVnd,
    unallocatedVnd: decidedDaily.unallocatedVnd,
    balanced: allocatedVnd + decidedDaily.unallocatedVnd === totalPoolVnd,
    createdAt: commandContext.now,
    createdBy: actorSnapshot,
  }
  const decidedParticipantByRecord = new Map(participants.map((record, index) => [record, decidedParticipants[index]]))
  const nextState = {
    ...state,
    revenueBonusDaily: dailyRecords.map((record, index) => index === dailyMatch.index ? decidedDaily : record),
    revenueBonusAllocations: allocations,
    teamRewardClaims: claims.map((record, index) => index === claimMatch.index ? decidedClaim : record),
    teamRewardParticipants: (Array.isArray(state.teamRewardParticipants) ? state.teamRewardParticipants : [])
      .map((record) => decidedParticipantByRecord.get(record) || record),
    periodReconciliations: [reconciliation, ...(Array.isArray(state.periodReconciliations) ? state.periodReconciliations : [])],
    payrollPeriods: approve
      ? invalidateClosedPayrollPeriods(state, { storeId: claim.storeId, period: claim.period }, commandContext.now, body.type)
      : state.payrollPeriods,
    stateVersion: Math.max(1, Number(state.stateVersion) || 1) + 1,
  }
  return commitGlobalStateDomainCommand(db, actor, current, nextState, {
    action: body.type,
    entityType: 'team-reward-claim',
    entityId: claimId,
    before: claim,
    after: decidedClaim,
    metadata: { storeId: claim.storeId, businessDate: claim.businessDate, amountVnd: claim.amountVnd },
    response: {
      command: body.type,
      revenueBonus: decidedDaily,
      teamClaim: decidedClaim,
      allocations: dailyAllocations,
      teamParticipants: decidedParticipants,
      reconciliation,
    },
  }, commandContext)
}

const revenueBonusCommand = async (db, actor, body, commandContext) => {
  assertPayrollOperator(actor, 'Chỉ Admin hoặc Nhân viên hỗ trợ KD được tính thưởng doanh thu.')
  if (!['revenue_bonus.calculate_day', 'revenue_bonus.approve_milestone', 'revenue_bonus.reject_milestone'].includes(body.type)) {
    throw new ApiError(400, 'COMMAND_UNKNOWN', 'Lệnh thưởng doanh thu không được hỗ trợ.')
  }
  const payload = isPlainRecord(body.payload) ? body.payload : {}
  const { current, state } = await loadGlobalCommandState(db, body)
  if (body.type !== 'revenue_bonus.calculate_day') {
    return revenueBonusMilestoneDecision(db, actor, body, commandContext, current, state, payload)
  }
  const requestedStoreId = String(payload.storeId || '').trim()
  assertOperationalStoreAccess(actor, requestedStoreId)
  const store = requireActivePhysicalStore(state, requestedStoreId)
  const storeId = String(store.id || requestedStoreId).trim()
  const businessDate = compensationDate(payload.businessDate, 'Ngày tính thưởng')
  const period = businessDate.slice(0, 7)
  assertPayrollNotPaidOrLocked(state, storeId, period)
  const dailyRecords = Array.isArray(state.revenueBonusDaily) ? state.revenueBonusDaily : []
  const eligibility = revenueBonusEligibility({
    storeId,
    businessDate,
    schedule: Array.isArray(state.schedule) ? state.schedule : [],
    shiftDefinitions: Array.isArray(state.shiftDefinitions) ? state.shiftDefinitions : [],
    attendance: Array.isArray(state.attendance) ? state.attendance : [],
    dailyRecords,
  })
  if (eligibility.code === 'DATA_COLLISION') {
    throw new ApiError(
      409,
      'REVENUE_BONUS_DAILY_SCOPE_COLLISION',
      eligibility.message,
      {
        storeId,
        businessDate,
        conflictingIdentifiers: eligibility.conflictingIds,
      },
    )
  }
  if (!['READY', 'ALREADY_CALCULATED'].includes(eligibility.code)) {
    throw new ApiError(
      409,
      `REVENUE_BONUS_${eligibility.code}`,
      eligibility.message,
      publicRevenueBonusEligibility(eligibility),
    )
  }
  const orders = (Array.isArray(state.orders) ? state.orders : []).filter((order) => (
    sameIdentifier(order.storeId, storeId)
    && dateFromRecord(order) === businessDate
    && !order.deletedAt
    && String(order.status || '') !== 'Đã xóa'
    && Number.isSafeInteger(Number(order.amount))
    && Number(order.amount) >= 0
  ))
  const revenueVnd = orders.reduce((sum, order) => safeMoneySum(sum, Number(order.amount), 'Doanh thu ngày'), 0)
  const { programId, milestoneProgramId } = revenueBonusProgramForStore(store)
  const percentage = calculateRevenueBonus({ programId, revenueVnd })
  const milestone = calculateTeamMilestoneReward({ programId: milestoneProgramId, achievedUnits: revenueVnd })
  const employeeById = new Map((Array.isArray(state.employees) ? state.employees : []).flatMap((employee) => (
    [employee.id, employee.code, employee.employeeId]
      .filter(Boolean)
      .map((id) => [normalizeIdentifierKey(id), employee])
  )))
  const participantWeights = new Map()
  for (const attendance of Array.isArray(state.attendance) ? state.attendance : []) {
    const employeeId = String(attendance.employeeId || '').trim()
    const employee = employeeById.get(normalizeIdentifierKey(employeeId))
    if (!employeeId || !employee
      || !sameIdentifier(attendance.storeId, storeId)
      || dateFromRecord(attendance) !== businessDate
      || attendance.deletedAt
      || (!attendance.checkOutAt && !attendance.checkOut)) continue
    const weightUnits = liveAttendanceSeconds(attendance, Date.parse(commandContext.now), false)
    if (weightUnits > 0) {
      const canonicalEmployeeId = String(employee.id || employee.code || employee.employeeId || employeeId)
      participantWeights.set(canonicalEmployeeId, (participantWeights.get(canonicalEmployeeId) || 0) + weightUnits)
    }
  }
  const participants = [...participantWeights].map(([id, weightUnits]) => ({ id, weightUnits }))
  const allocate = (poolVnd) => participants.length
    ? allocateByLargestRemainder({ poolVnd, participants })
    : { poolVnd, totalWeightUnits: 0, allocatedVnd: 0, unallocatedVnd: poolVnd, allocations: [] }
  const percentageAllocation = allocate(percentage.bonusVnd)
  const milestoneAllocation = allocate(milestone.amountVnd)
  const percentageByEmployee = new Map(percentageAllocation.allocations.map((record) => [record.id, record.amountVnd]))
  const milestoneByEmployee = new Map(milestoneAllocation.allocations.map((record) => [record.id, record.amountVnd]))
  const fingerprint = await requestHash({
    storeId,
    businessDate,
    programId,
    revenueVnd,
    percentage,
    milestone,
    participants,
  })
  const currentDaily = eligibility.code === 'ALREADY_CALCULATED'
    ? uniqueIdentifierRecordMatch({
        records: dailyRecords,
        identifier: eligibility.existingId,
        collisionCode: 'REVENUE_BONUS_DAILY_IDENTIFIER_COLLISION',
        collisionMessage: 'Mã kết quả thưởng ngày đang trùng với nhiều bản ghi; không thể tính thưởng an toàn.',
      })?.record || null
    : null
  const currentDailyReferenceMatches = (reference) => Boolean(currentDaily) && mutationIdentifierReferenceMatchesRecord({
    records: dailyRecords,
    record: currentDaily,
    reference,
    collisionCode: 'REVENUE_BONUS_DAILY_REFERENCE_COLLISION',
    collisionMessage: 'Bản ghi thưởng đang tham chiếu mơ hồ tới nhiều kết quả thưởng ngày; không thể tính lại an toàn.',
  })
  if (currentDaily?.fingerprint === fingerprint) {
    return recordNoopCommand(db, actor, {
      command: body.type,
      version: Number(current.version),
      revenueBonus: currentDaily,
      allocations: (Array.isArray(state.revenueBonusAllocations) ? state.revenueBonusAllocations : [])
        .filter((record) => currentDailyReferenceMatches(record.revenueBonusDailyId)),
      existing: true,
    }, 200, commandContext)
  }
  if (currentDaily) {
    throw new ApiError(
      409,
      'REVENUE_BONUS_DAY_ALREADY_CALCULATED',
      'Thưởng doanh thu của ngày này đã được tính; không thể ghi đè kết quả lịch sử.',
      publicRevenueBonusEligibility(eligibility),
    )
  }
  const calculationId = `rbd_${crypto.randomUUID()}`
  const actorSnapshot = serverActorSnapshot(actor)
  const allocations = participants.map(({ id: employeeId, weightUnits }) => {
    const employee = employeeById.get(normalizeIdentifierKey(employeeId))
    const percentagePoolVnd = percentageByEmployee.get(employeeId) || 0
    return {
      id: `rba_${crypto.randomUUID()}`,
      revenueBonusDailyId: calculationId,
      storeId,
      businessDate,
      period,
      employeeId,
      employeeName: employee?.name || employee?.displayName || employeeId,
      weightUnits,
      percentagePoolVnd,
      milestonePoolVnd: 0,
      amountVnd: percentagePoolVnd,
      status: 'APPROVED',
      approvedAt: commandContext.now,
      approvedBy: actorSnapshot,
      createdAt: commandContext.now,
      version: 1,
      voidedAt: null,
      deletedAt: null,
    }
  })
  const totalPoolVnd = percentage.bonusVnd
  const unallocatedVnd = percentageAllocation.unallocatedVnd
  const daily = {
    id: calculationId,
    storeId,
    storeName: store.name || storeId,
    businessDate,
    period,
    programId,
    programLabel: programId === REVENUE_BONUS_PROGRAM_IDS.SM_DAILY ? 'Thưởng doanh thu ngày SM' : 'Thưởng doanh thu ngày DOSII',
    milestoneProgramId,
    revenueVnd,
    tierId: percentage.tierId,
    rateBasisPoints: percentage.rateBasisPoints,
    ratePercent: percentage.ratePercent,
    percentagePoolVnd: percentage.bonusVnd,
    milestoneId: milestone.milestoneId,
    milestonePoolVnd: 0,
    pendingMilestonePoolVnd: milestone.amountVnd,
    milestoneStatus: milestone.amountVnd > 0 ? 'PENDING' : 'NOT_ELIGIBLE',
    totalPoolVnd,
    allocatedVnd: totalPoolVnd - unallocatedVnd,
    unallocatedVnd,
    participantCount: participants.length,
    fingerprint,
    status: 'APPROVED',
    calculatedAt: commandContext.now,
    calculatedBy: actorSnapshot,
    version: 1,
    supersededAt: null,
    voidedAt: null,
  }
  const teamClaim = milestone.amountVnd > 0 ? {
    id: `trc_${crypto.randomUUID()}`,
    revenueBonusDailyId: calculationId,
    storeId,
    businessDate,
    period,
    programId: milestoneProgramId,
    milestoneId: milestone.milestoneId,
    achievedUnits: revenueVnd,
    amountVnd: milestone.amountVnd,
    status: 'PENDING',
    approvedAt: null,
    approvedBy: null,
    createdAt: commandContext.now,
    version: 1,
  } : null
  const teamParticipants = teamClaim ? allocations.map((allocation) => ({
    id: `trp_${crypto.randomUUID()}`,
    claimId: teamClaim.id,
    revenueBonusDailyId: calculationId,
    storeId,
    businessDate,
    period,
    employeeId: allocation.employeeId,
    employeeName: allocation.employeeName,
    weightUnits: allocation.weightUnits,
    proposedAmountVnd: milestoneByEmployee.get(allocation.employeeId) || 0,
    amountVnd: 0,
    status: 'PENDING',
    createdAt: commandContext.now,
    version: 1,
  })) : []
  const reconciliation = {
    id: `prc_${crypto.randomUUID()}`,
    storeId,
    period,
    businessDate,
    type: 'REVENUE_BONUS_DAY',
    sourceId: calculationId,
    revenueVnd,
    totalPoolVnd,
    pendingMilestonePoolVnd: milestone.amountVnd,
    allocatedVnd: daily.allocatedVnd,
    unallocatedVnd,
    balanced: daily.allocatedVnd + unallocatedVnd === totalPoolVnd,
    createdAt: commandContext.now,
    createdBy: actorSnapshot,
  }
  const jobRun = {
    id: `job_${crypto.randomUUID()}`,
    type: 'REVENUE_BONUS_DAY',
    storeId,
    businessDate,
    period,
    fingerprint,
    status: 'SUCCEEDED',
    sourceId: calculationId,
    startedAt: commandContext.now,
    finishedAt: commandContext.now,
    createdBy: actorSnapshot,
  }
  const nextState = {
    ...state,
    revenueBonusDaily: [daily, ...dailyRecords],
    revenueBonusAllocations: [
      ...allocations,
      ...(Array.isArray(state.revenueBonusAllocations) ? state.revenueBonusAllocations : []),
    ],
    teamRewardClaims: [
      ...(teamClaim ? [teamClaim] : []),
      ...(Array.isArray(state.teamRewardClaims) ? state.teamRewardClaims : []),
    ],
    teamRewardParticipants: [
      ...teamParticipants,
      ...(Array.isArray(state.teamRewardParticipants) ? state.teamRewardParticipants : []),
    ],
    periodReconciliations: [reconciliation, ...(Array.isArray(state.periodReconciliations) ? state.periodReconciliations : [])],
    jobRuns: [jobRun, ...(Array.isArray(state.jobRuns) ? state.jobRuns : [])],
    payrollPeriods: invalidateClosedPayrollPeriods(state, { storeId, period }, commandContext.now, body.type),
    stateVersion: Math.max(1, Number(state.stateVersion) || 1) + 1,
  }
  return commitGlobalStateDomainCommand(db, actor, current, nextState, {
    action: body.type,
    entityType: 'revenue-bonus-day',
    entityId: calculationId,
    before: null,
    after: daily,
    metadata: { storeId, businessDate, period, revenueVnd, totalPoolVnd, unallocatedVnd, participantCount: participants.length },
    response: { command: body.type, revenueBonus: daily, allocations, teamClaim, teamParticipants, reconciliation, jobRun },
    status: 201,
  }, commandContext)
}

const assertPayrollHasNoOpenAttendance = (state, storeId, period) => {
  const openAttendance = (Array.isArray(state.attendance) ? state.attendance : []).filter((record) => (
    !record.deletedAt
    && sameIdentifier(record.storeId, storeId)
    && monthFromRecord(record) === period
    && !record.checkOut
    && !record.checkOutAt
  ))
  if (openAttendance.length) {
    throw new ApiError(
      409,
      'PAYROLL_ATTENDANCE_OPEN',
      'Kỳ lương còn ca chấm công chưa kết thúc; cần kết ca trước khi chốt, chi hoặc khóa.',
      { attendanceIds: openAttendance.map((record) => String(record.id || '')).filter(Boolean) },
    )
  }
}

const upsertManagerRevenueBonusEntry = (state, managerRevenueBonus, actorSnapshot, timestamp, storeId, period) => {
  const entries = Array.isArray(state.compensationEntries) ? state.compensationEntries : []
  const scopedAutomaticEntry = (entry) => (
    String(entry.sourceType || '') === MANAGER_REVENUE_BONUS_SOURCE_TYPE
    && sameIdentifier(entry.storeId, storeId)
    && String(entry.period || monthFromRecord(entry)) === period
  )
  const sourceId = String(managerRevenueBonus?.idempotencyKey || '')
  const previous = sourceId
    ? entries.find((entry) => scopedAutomaticEntry(entry) && String(entry.sourceId || '') === sourceId)
    : null
  const calculationFingerprint = managerRevenueBonus ? JSON.stringify(canonicalize({
    formulaVersion: managerRevenueBonus.formulaVersion,
    managerId: managerRevenueBonus.managerId,
    profitBeforeManagerBonusVnd: managerRevenueBonus.profitBeforeManagerBonusVnd,
    managerCompensationVnd: managerRevenueBonus.managerCompensationVnd,
    bonusVnd: managerRevenueBonus.bonusVnd,
    finalProfitVnd: managerRevenueBonus.finalProfitVnd,
  })) : null
  const unchanged = Boolean(previous && previous.calculationFingerprint === calculationFingerprint
    && !previous.deletedAt && !previous.voidedAt && normalizeTextKey(previous.status) === 'approved')
  const nextEntry = !managerRevenueBonus
    ? null
    : unchanged
      ? previous
      : {
          ...(previous || {}),
          id: previous?.id || `cmp_${sourceId}`,
          type: 'REVENUE',
          targetUnit: 'store_manager',
          employeeId: managerRevenueBonus.managerId,
          employeeName: managerRevenueBonus.managerName,
          managerProfileId: managerRevenueBonus.managerProfileId,
          storeId,
          amountVnd: asVnd(managerRevenueBonus.bonusVnd, 'Thưởng doanh thu quản lý'),
          effectiveDate: `${period}-01`,
          period,
          note: `Thưởng doanh thu quản lý ${period}: 2% lợi nhuận cuối cùng`,
          status: 'APPROVED',
          formulaVersion: managerRevenueBonus.formulaVersion,
          ratePercent: managerRevenueBonus.ratePercent,
          calculationFingerprint,
          calculationSnapshot: sanitizeStateValue(managerRevenueBonus),
          sourceType: MANAGER_REVENUE_BONUS_SOURCE_TYPE,
          sourceId,
          version: previous ? Number(previous.version || 1) + 1 : 1,
          createdAt: previous?.createdAt || timestamp,
          createdBy: previous?.createdBy || actorSnapshot,
          approvedAt: previous?.approvedAt || timestamp,
          approvedBy: previous?.approvedBy || actorSnapshot,
          updatedAt: timestamp,
          updatedBy: actorSnapshot,
          deletedAt: null,
          voidedAt: null,
          voidedBy: null,
          voidReason: null,
        }
  const supersede = (entry) => {
    if (!scopedAutomaticEntry(entry)) return entry
    if (sourceId && String(entry.sourceId || '') === sourceId) return nextEntry || entry
    if (entry.deletedAt || entry.voidedAt || normalizeTextKey(entry.status) === 'void') return entry
    return {
      ...entry,
      status: 'VOID',
      voidedAt: timestamp,
      voidedBy: actorSnapshot,
      voidReason: 'Quản lý cửa hàng hoặc kết quả kỳ lương đã thay đổi khi chốt lại.',
      updatedAt: timestamp,
      updatedBy: actorSnapshot,
      version: Number(entry.version || 1) + 1,
    }
  }
  const nextEntries = entries.map(supersede)
  if (nextEntry && !previous) nextEntries.unshift(nextEntry)
  return { entries: nextEntries, entry: nextEntry }
}

const payrollPeriodCollisionRepairCommand = async (db, actor, body, commandContext) => {
  assertAdmin(actor, 'Chỉ Admin được xử lý kỳ lương trùng mã.')
  const payload = isPlainRecord(body.payload) ? body.payload : {}
  const { current, state } = await loadGlobalCommandState(db, body)
  const requestedStoreId = String(payload.storeId || '').trim()
  const payrollUnit = requirePayrollUnit(state, requestedStoreId)
  const storeId = String(payrollUnit.id || requestedStoreId).trim()
  const period = asMonth(payload.period)
  const reason = String(payload.reason || '').trim()
  if (!reason || reason.length > 500) {
    throw new ApiError(400, 'REASON_REQUIRED', 'Cần nhập lý do xử lý dữ liệu trùng từ 1 đến 500 ký tự.')
  }
  const periods = Array.isArray(state.payrollPeriods) ? state.payrollPeriods : []
  const candidates = periods.filter((record) => (
    !record.supersededAt
    && sameIdentifier(record.storeId, storeId)
    && String(record.period || '') === period
  ))
  if (candidates.length < 2) {
    throw new ApiError(409, 'PAYROLL_PERIOD_COLLISION_NOT_FOUND', 'Không còn nhiều kỳ lương trùng trong phạm vi đã chọn.')
  }
  const keepPayrollId = String(payload.keepPayrollId || '').trim()
  const keepMatch = uniqueIdentifierRecordMatch({
    records: candidates,
    identifier: keepPayrollId,
    collisionCode: 'KEEP_PAYROLL_AMBIGUOUS',
    collisionMessage: 'Mã kỳ lương cần giữ đang trùng; không thể chọn bản ghi an toàn.',
  })
  const keep = keepMatch?.record || null
  if (!keep) {
    throw new ApiError(400, 'KEEP_PAYROLL_INVALID', 'Cần chọn chính xác một kỳ lương trong nhóm trùng để giữ lại.')
  }
  const canonicalKeepPayrollId = String(keep.id || '').trim()
  const discarded = candidates.filter((record) => record !== keep)
  const referencedDiscarded = discarded.find((record) => {
    const hasPayment = (Array.isArray(state.payrollPayments) ? state.payrollPayments : [])
      .some((payment) => payrollPaymentReferencesPeriod(payment, record, periods, {
        collisionCode: 'PAYROLL_COLLISION_REPAIR_UNSAFE',
        collisionMessage: 'Tham chiếu chi lương đang mơ hồ giữa nhiều kỳ; không thể gộp an toàn.',
      }))
    const hasAccrual = (Array.isArray(state.expenseEntries) ? state.expenseEntries : [])
      .some((entry) => payrollAccrualReferencesPeriod(entry, record, periods, {
        collisionCode: 'PAYROLL_COLLISION_REPAIR_UNSAFE',
        collisionMessage: 'Tham chiếu bút toán lương đang mơ hồ giữa nhiều kỳ; không thể gộp an toàn.',
      }))
    return hasPayment || hasAccrual || record.confirmedAt || record.lockedAt
      || ['Đã chi', 'Đã khóa'].includes(String(record.status || ''))
  })
  if (referencedDiscarded) {
    throw new ApiError(
      409,
      'PAYROLL_COLLISION_REPAIR_UNSAFE',
      'Kỳ lương không giữ lại đã có chi trả, khóa hoặc bút toán; không thể tự động gộp an toàn.',
      { conflictingPeriodId: String(referencedDiscarded.id || '') },
    )
  }
  const actorSnapshot = serverActorSnapshot(actor)
  const repaired = candidates.map((record) => (
    record === keep
      ? { ...record, storeId, updatedAt: commandContext.now }
      : {
          ...record,
          supersededAt: commandContext.now,
          supersededByPayrollId: canonicalKeepPayrollId,
          supersededBy: actorSnapshot,
          supersededStatus: record.status || null,
          status: 'Đã thay thế',
          collisionResolutionReason: reason,
          updatedAt: commandContext.now,
        }
  ))
  const repairedByOriginal = new Map(candidates.map((record, index) => [record, repaired[index]]))
  const repairedKeep = repairedByOriginal.get(keep)
  const nextState = {
    ...state,
    payrollPeriods: periods.map((record) => repairedByOriginal.get(record) || record),
    stateVersion: Math.max(1, Number(state.stateVersion) || 1) + 1,
  }
  return commitGlobalStateDomainCommand(db, actor, current, nextState, {
    action: body.type,
    entityType: 'payroll-period-collision',
    entityId: canonicalKeepPayrollId,
    before: candidates,
    after: repaired,
    metadata: { storeId, period, keepPayrollId: canonicalKeepPayrollId, reason },
    response: {
      command: body.type,
      period: repairedKeep,
      supersededPeriodIds: discarded.map((record) => record.id),
    },
  }, commandContext)
}

const payrollPeriodReferenceCandidates = (records, referenceRecord) => (
  (Array.isArray(records) ? records : []).filter((candidate) => {
    const referenceStoreId = String(referenceRecord?.storeId || '').trim()
    const referencePeriod = String(referenceRecord?.period || '').trim()
    return (!referenceStoreId || sameIdentifier(candidate?.storeId, referenceStoreId))
      && (!referencePeriod || String(candidate?.period || '') === referencePeriod)
  })
)

const payrollPaymentReferencesPeriod = (payment, payrollPeriod, payrollPeriods = [payrollPeriod], options = {}) => {
  const paymentPeriodId = String(payment?.periodId || '').trim()
  if (paymentPeriodId) {
    return mutationIdentifierReferenceMatchesRecord({
      records: payrollPeriodReferenceCandidates(payrollPeriods, payment),
      record: payrollPeriod,
      reference: paymentPeriodId,
      collisionCode: options.collisionCode || 'PAYROLL_PERIOD_REFERENCE_COLLISION',
      collisionMessage: options.collisionMessage
        || 'Bản ghi chi lương tham chiếu mơ hồ tới nhiều kỳ lương; cần xử lý dữ liệu trùng trước.',
    })
  }
  return sameIdentifier(payment?.storeId, payrollPeriod?.storeId)
    && String(payment?.period || '') === String(payrollPeriod?.period || '')
}

const payrollAccrualReferencesPeriod = (entry, payrollPeriod, payrollPeriods = [payrollPeriod], options = {}) => (
  String(entry?.sourceType || '') === 'payroll-accrual'
  && mutationIdentifierReferenceMatchesRecord({
    records: payrollPeriodReferenceCandidates(payrollPeriods, entry),
    record: payrollPeriod,
    reference: entry?.sourceId,
    collisionCode: options.collisionCode || 'PAYROLL_PERIOD_REFERENCE_COLLISION',
    collisionMessage: options.collisionMessage
      || 'Bút toán lương tham chiếu mơ hồ tới nhiều kỳ lương; cần xử lý dữ liệu trùng trước.',
  })
)

const payrollCommand = async (db, actor, body, commandContext) => {
  const payload = isPlainRecord(body.payload) ? body.payload : {}
  const operation = body.type.split('.').at(-1)
  if (!['close', 'pay', 'lock'].includes(operation)) {
    throw new ApiError(400, 'COMMAND_UNKNOWN', 'Lệnh kỳ lương không được hỗ trợ.')
  }
  if (operation === 'lock') {
    assertAdmin(actor, 'Chỉ Admin được khóa kỳ lương.')
  } else {
    assertPayrollOperator(actor, 'Chỉ Admin hoặc Nhân viên hỗ trợ KD được chốt hoặc chi kỳ lương.')
  }
  const { current, state } = await loadGlobalCommandState(db, body)
  const requestedStoreId = String(payload.storeId || '').trim()
  assertOperationalStoreAccess(actor, requestedStoreId)
  const period = asMonth(payload.period)
  const payrollUnit = requirePayrollUnit(state, requestedStoreId)
  const storeId = String(payrollUnit.id || requestedStoreId).trim()
  const periods = Array.isArray(state.payrollPeriods) ? state.payrollPeriods : []
  const existing = payrollPeriodFor(state, storeId, period)
  const actorSnapshot = serverActorSnapshot(actor)
  assertPayrollHasNoOpenAttendance(state, storeId, period)

  if (operation === 'close') {
    if (existing?.lockedAt || existing?.status === 'Đã khóa') {
      throw new ApiError(409, 'PAYROLL_PERIOD_LOCKED', 'Kỳ lương đã khóa.')
    }
    if (existing?.confirmedAt || existing?.status === 'Đã chi') {
      throw new ApiError(409, 'PAYROLL_PERIOD_PAID', 'Kỳ lương đã chi; không thể chốt lại.')
    }
    const snapshot = await calculatePayrollSnapshot(db, state, storeId, period)
    const managerBonusState = upsertManagerRevenueBonusEntry(
      state,
      snapshot.managerRevenueBonus,
      actorSnapshot,
      commandContext.now,
      storeId,
      period,
    )
    const next = {
      id: existing?.id || `pyr_${crypto.randomUUID()}`,
      storeId,
      period,
      ...snapshot,
      status: 'Đã chốt',
      closedAt: commandContext.now,
      closedBy: actorSnapshot,
      confirmedAt: null,
      confirmedBy: null,
      lockedAt: null,
      lockedBy: null,
      needsReclose: false,
    }
    const expenseEntries = Array.isArray(state.expenseEntries) ? state.expenseEntries : []
    const earnedPayrollExpense = asVnd(next.financeSnapshot?.earnedPayrollExpense ?? 0, 'Chi phí lương trong kỳ')
    const accruedSupportCompensation = asVnd(
      next.financeSnapshot?.recognizedSupportExpense ?? 0,
      'Chi phí lương hỗ trợ đã ghi nhận',
    )
    const netPayrollExpense = asVnd(next.financeSnapshot?.netPayrollExpense ?? 0, 'Chi phí lương cần ghi nhận')
    const payrollAccrual = {
      id: `exp_payroll_accrual_${next.id}`,
      storeId,
      type: 'Chi phí lương trong kỳ',
      category: 'payroll',
      description: `Chi phí lương kỳ ${period}`,
      amount: netPayrollExpense,
      grossPayrollExpense: earnedPayrollExpense,
      supportCompensationAccrued: accruedSupportCompensation,
      managerCompensationExpense: asVnd(
        next.financeSnapshot?.managerCompensationExpense ?? 0,
        'Thưởng và phụ cấp quản lý',
      ),
      managerRevenueBonusVnd: asVnd(
        next.financeSnapshot?.managerRevenueBonusVnd ?? 0,
        'Thưởng doanh thu quản lý',
      ),
      sourceType: 'payroll-accrual',
      sourceId: next.id,
      recognized: true,
      period,
      occurredAt: commandContext.now,
      createdAt: commandContext.now,
      createdBy: actor.user_id,
    }
    const linkedPayrollAccruals = existing
      ? expenseEntries.filter((entry) => payrollAccrualReferencesPeriod(entry, existing, periods))
      : []
    if (linkedPayrollAccruals.length > 1) {
      throw new ApiError(
        409,
        'PAYROLL_ACCRUAL_COLLISION',
        'Kỳ lương có nhiều bút toán ghi nhận chi phí; cần đối soát trước khi chốt lại.',
        { payrollPeriodId: String(existing.id || '') },
      )
    }
    const previousPayrollAccrual = linkedPayrollAccruals[0] || null
    const nextState = {
      ...state,
      payrollPeriods: [next, ...periods.filter((record) => (
        record.supersededAt
        || !(sameIdentifier(record.storeId, storeId) && String(record.period || '') === period)
      ))],
      compensationEntries: managerBonusState.entries,
      expenseEntries: previousPayrollAccrual
        ? expenseEntries.map((entry) => entry === previousPayrollAccrual ? payrollAccrual : entry)
        : [payrollAccrual, ...expenseEntries],
      stateVersion: Math.max(1, Number(state.stateVersion) || 1) + 1,
    }
    return commitGlobalStateDomainCommand(db, actor, current, nextState, {
      action: body.type,
      entityType: 'payroll-period',
      entityId: next.id,
      before: existing || null,
      after: next,
      metadata: {
        storeId,
        period,
        rowCount: next.rows.length,
        managerRevenueBonusId: managerBonusState.entry?.id || null,
      },
      response: {
        command: body.type,
        period: next,
        payrollAccrual,
        managerRevenueBonusEntry: managerBonusState.entry,
      },
      status: existing ? 200 : 201,
    }, commandContext)
  }

  if (!existing) throw new ApiError(404, 'PAYROLL_PERIOD_NOT_FOUND', 'Cần chốt sổ kỳ lương trước.')
  if (operation === 'lock') {
    if (existing.status === 'Đã khóa' || existing.lockedAt) {
      return recordNoopCommand(db, actor, {
        command: body.type,
        version: Number(current.version),
        period: existing,
        existing: true,
      }, 200, commandContext)
    }
    if (!existing.confirmedAt || existing.status !== 'Đã chi') {
      throw new ApiError(409, 'PAYROLL_NOT_PAID', 'Chỉ được khóa kỳ lương sau khi đã chi.')
    }
    const locked = {
      ...existing,
      status: 'Đã khóa',
      lockedAt: commandContext.now,
      lockedBy: actorSnapshot,
      updatedAt: commandContext.now,
    }
    const nextState = {
      ...state,
      payrollPeriods: periods.map((record) => record === existing ? locked : record),
      stateVersion: Math.max(1, Number(state.stateVersion) || 1) + 1,
    }
    return commitGlobalStateDomainCommand(db, actor, current, nextState, {
      action: body.type,
      entityType: 'payroll-period',
      entityId: existing.id,
      before: existing,
      after: locked,
      metadata: { storeId, period },
      response: { command: body.type, period: locked },
    }, commandContext)
  }

  if (existing.lockedAt || existing.status === 'Đã khóa') {
    throw new ApiError(409, 'PAYROLL_PERIOD_LOCKED', 'Kỳ lương đã khóa.')
  }
  if (existing.needsReclose) {
    throw new ApiError(409, 'PAYROLL_NEEDS_RECLOSE', 'Số liệu trong kỳ đã thay đổi; cần chốt sổ lại trước khi chi.')
  }
  if (existing.confirmedAt || existing.status === 'Đã chi') {
    return recordNoopCommand(db, actor, {
      command: body.type,
      version: Number(current.version),
      period: existing,
      payments: (Array.isArray(state.payrollPayments) ? state.payrollPayments : [])
        .filter((payment) => payrollPaymentReferencesPeriod(payment, existing, periods)),
      existing: true,
    }, 200, commandContext)
  }
  if (existing.status !== 'Đã chốt' || !Array.isArray(existing.rows)) {
    throw new ApiError(409, 'PAYROLL_NOT_CLOSED', 'Kỳ lương chưa có bản chốt hợp lệ.')
  }
  const existingPayments = Array.isArray(state.payrollPayments) ? state.payrollPayments : []
  const expenses = Array.isArray(state.expenseEntries) ? state.expenseEntries : []
  const transactions = Array.isArray(state.cashTransactions) ? state.cashTransactions : []
  const payments = []
  const paymentExpenses = []
  const paymentTransactions = []
  const paidEmployeeIds = new Set()
  for (const row of existing.rows) {
    const amount = asVnd(row.remaining ?? 0, 'Số tiền chi lương')
    if (amount === 0) continue
    const employeeId = String(row.employeeId || '').trim()
    if (!employeeId) throw new ApiError(409, 'PAYROLL_ROW_INVALID', 'Dòng lương thiếu mã nhân viên.')
    const employeeIdentifierKey = normalizeIdentifierKey(employeeId)
    if (paidEmployeeIds.has(employeeIdentifierKey)) {
      throw new ApiError(409, 'PAYROLL_ROW_DUPLICATE', 'Bản chốt lương có nhân viên bị trùng.')
    }
    paidEmployeeIds.add(employeeIdentifierKey)
    if (existingPayments.some((payment) => (
      payrollPaymentReferencesPeriod(payment, existing, periods)
      && sameIdentifier(payment.employeeId, employeeId)
    ))) {
      throw new ApiError(409, 'PAYROLL_PAYMENT_EXISTS', 'Kỳ lương đã có bản ghi chi trả không nhất quán.')
    }
    const supportExpectedAmount = row.supportCompensation
      ? asVnd(row.supportActualPay ?? row.supportCompensation.totalPay ?? 0, 'Lương hỗ trợ trong kỳ')
      : 0
    if (row.supportCompensation && supportExpectedAmount !== amount) {
      throw new ApiError(409, 'SUPPORT_PAYROLL_ACCRUAL_MISMATCH', 'Chi lương hỗ trợ không khớp chi phí đã ghi nhận theo chấm công; cần chốt lại kỳ lương.', {
        employeeId,
        paymentAmount: amount,
        expectedAmount: supportExpectedAmount,
      })
    }
    const supportAccruedAmount = row.supportCompensation
      ? recognizedSupportCompensationFor(state, storeId, employeeId, row.supportDetails)
      : 0
    if (supportAccruedAmount > supportExpectedAmount) {
      throw new ApiError(409, 'SUPPORT_PAYROLL_ACCRUAL_MISMATCH', 'Chi phí lương hỗ trợ đã ghi nhận lớn hơn bản chốt; cần đối soát chấm công.', {
        employeeId,
        expectedAmount: supportExpectedAmount,
        accruedAmount: supportAccruedAmount,
      })
    }
    const payment = {
      id: `pay_${existing.id}_${employeeId}`,
      periodId: existing.id,
      storeId,
      period,
      employeeId,
      employeeName: row.employeeName || employeeId,
      amount,
      accruedExpenseAmount: supportAccruedAmount,
      type: 'Lương nhân viên',
      createdAt: commandContext.now,
      actor: actorSnapshot,
    }
    if (expenses.some((entry) => (
      String(entry?.sourceType || '') === 'payroll-payment'
      && sameIdentifier(entry?.sourceId, payment.id)
    )) || transactions.some((entry) => (
      String(entry?.sourceType || '') === 'payroll-payment'
      && sameIdentifier(entry?.sourceId, payment.id)
    ))) {
      throw new ApiError(409, 'PAYROLL_FINANCE_EXISTS', 'Bút toán chi lương đã tồn tại không nhất quán.')
    }
    payments.push(payment)
      paymentExpenses.push({
      id: `exp_${payment.id}`,
      storeId,
      employeeId,
      type: payment.type,
      category: 'payroll',
      description: `${payment.type} kỳ ${period}`,
      sourceType: 'payroll-payment',
      sourceId: payment.id,
      amount,
      // Paying a closed period settles cash only. Expense was recognized once
      // by the period-level payroll accrual during payroll.close.
      recognized: false,
      ...(supportAccruedAmount > 0 ? {
        accruedBySourceType: 'support-attendance-compensation',
        accruedAmount: supportAccruedAmount,
      } : {}),
      ...(row.supportCompensation ? { supportExpectedAmount, recognizedAmount: 0 } : {}),
      occurredAt: commandContext.now,
      createdAt: commandContext.now,
      createdBy: actor.user_id,
    })
    paymentTransactions.push({
      id: `txn_${payment.id}`,
      storeId,
      employeeId,
      type: payment.type,
      direction: 'out',
      amount,
      sourceType: 'payroll-payment',
      sourceId: payment.id,
      occurredAt: commandContext.now,
      createdAt: commandContext.now,
      actor: actorSnapshot,
    })
  }
  const paid = {
    ...existing,
    status: 'Đã chi',
    confirmedAt: commandContext.now,
    confirmedBy: actorSnapshot,
    updatedAt: commandContext.now,
  }
  const nextState = {
    ...state,
    payrollPeriods: periods.map((record) => record === existing ? paid : record),
    payrollPayments: [...payments, ...existingPayments],
    expenseEntries: [...paymentExpenses, ...expenses],
    cashTransactions: [...paymentTransactions, ...transactions],
    stateVersion: Math.max(1, Number(state.stateVersion) || 1) + 1,
  }
  return commitGlobalStateDomainCommand(db, actor, current, nextState, {
    action: body.type,
    entityType: 'payroll-period',
    entityId: existing.id,
    before: existing,
    after: paid,
    metadata: { storeId, period, paymentIds: payments.map((payment) => payment.id) },
    response: { command: body.type, period: paid, payments },
  }, commandContext)
}

const policyCommand = async (db, user, body, commandContext) => {
  if (!['admin', 'business_support'].includes(user.role)) {
    throw new ApiError(403, 'ROLE_FORBIDDEN', 'Chỉ Admin hoặc Nhân viên hỗ trợ KD được thay đổi chính sách.')
  }
  const payload = isPlainRecord(body.payload) ? body.payload : {}
  const key = String(payload.key || '')
  const value = validatePolicy(key, payload.value)
  const expectedVersion = validateExpectedVersion(body.expectedVersion)
  const current = await first(db, `
    SELECT policy_key, value_json, version, effective_at, updated_at, updated_by
    FROM policies WHERE policy_key = ? LIMIT 1
  `, key)
  const currentVersion = Number(current?.version || 0)
  if (currentVersion !== expectedVersion) {
    throw new ApiError(409, 'VERSION_CONFLICT', 'Chính sách đã thay đổi trên máy chủ.', { currentVersion })
  }
  const nextVersion = currentVersion + 1
  const valueJson = JSON.stringify(value)
  const effectiveAt = commandContext.now
  const responseBody = apiPayload(commandContext, {
    command: body.type,
    policy: { key, value, version: nextVersion, effectiveAt, updatedAt: commandContext.now },
  })
  const responseJson = JSON.stringify(responseBody)
  const mutation = current
    ? db.prepare(`
        UPDATE policies
        SET value_json = ?, version = ?, effective_at = ?, updated_at = ?, updated_by = ?, last_request_id = ?
        WHERE policy_key = ? AND version = ?
      `).bind(
        valueJson,
        nextVersion,
        effectiveAt,
        commandContext.now,
        user.user_id,
        commandContext.requestId,
        key,
        currentVersion,
      )
    : db.prepare(`
        INSERT OR IGNORE INTO policies (
          policy_key, value_json, version, effective_at, updated_at, updated_by, last_request_id
        ) VALUES (?, ?, 1, ?, ?, ?, ?)
      `).bind(key, valueJson, effectiveAt, commandContext.now, user.user_id, commandContext.requestId)

  const results = await db.batch([
    mutation,
    db.prepare(`
      INSERT INTO audit_log (
        request_id, actor_id, actor_role, action, entity_type, entity_id,
        before_json, after_json, metadata_json, server_timestamp
      )
      SELECT ?, ?, ?, 'policy.set', 'policy', ?, ?, ?, ?, ?
      WHERE EXISTS (
        SELECT 1 FROM policies WHERE policy_key = ? AND version = ? AND last_request_id = ?
      )
    `).bind(
      commandContext.requestId,
      user.user_id,
      user.role,
      key,
      current?.value_json || null,
      valueJson,
      JSON.stringify({ fromVersion: currentVersion, toVersion: nextVersion, effectiveAt }),
      commandContext.now,
      key,
      nextVersion,
      commandContext.requestId,
    ),
    db.prepare(`
      INSERT INTO command_receipts (
        actor_id, idempotency_key, request_hash, response_json, status_code, created_at
      )
      SELECT ?, ?, ?, ?, 200, ?
      WHERE EXISTS (
        SELECT 1 FROM policies WHERE policy_key = ? AND version = ? AND last_request_id = ?
      )
    `).bind(
      user.user_id,
      commandContext.idempotencyKey,
      commandContext.hash,
      responseJson,
      commandContext.now,
      key,
      nextVersion,
      commandContext.requestId,
    ),
  ])
  if (changes(results?.[0]) !== 1) {
    const latest = await first(db, 'SELECT version FROM policies WHERE policy_key = ?', key)
    throw new ApiError(409, 'VERSION_CONFLICT', 'Chính sách đã thay đổi trên máy chủ.', {
      currentVersion: Number(latest?.version || 0),
    })
  }
  return jsonResponse(responseBody)
}

const policiesCommand = async (db, user, body, commandContext) => {
  if (!['admin', 'business_support'].includes(user.role)) {
    throw new ApiError(403, 'ROLE_FORBIDDEN', 'Chỉ Admin hoặc Nhân viên hỗ trợ KD được thay đổi chính sách.')
  }
  const payload = isPlainRecord(body.payload) ? body.payload : {}
  const updates = Array.isArray(payload.updates) ? payload.updates : []
  if (!updates.length || updates.length > Object.keys(DEFAULT_POLICIES).length) {
    throw new ApiError(400, 'POLICY_BATCH_INVALID', 'Danh sách chính sách cần cập nhật không hợp lệ.')
  }
  const keys = updates.map((update) => String(update?.key || ''))
  if (new Set(keys).size !== keys.length) {
    throw new ApiError(400, 'POLICY_BATCH_DUPLICATE', 'Mỗi chính sách chỉ được xuất hiện một lần trong lệnh.')
  }
  const normalized = updates.map((update, index) => ({
    key: keys[index],
    value: validatePolicy(keys[index], update?.value),
    expectedVersion: validateExpectedVersion(update?.expectedVersion),
  }))
  const currentRows = await Promise.all(normalized.map(({ key }) => first(db, `
    SELECT policy_key, value_json, version, effective_at, updated_at, updated_by
    FROM policies WHERE policy_key = ? LIMIT 1
  `, key)))
  const conflict = normalized.find((update, index) => Number(currentRows[index]?.version || 0) !== update.expectedVersion)
  if (conflict) {
    const index = normalized.indexOf(conflict)
    throw new ApiError(409, 'VERSION_CONFLICT', 'Một chính sách đã thay đổi trên máy chủ.', {
      key: conflict.key,
      currentVersion: Number(currentRows[index]?.version || 0),
    })
  }
  const after = normalized.map((update) => ({
    key: update.key,
    value: update.value,
    version: update.expectedVersion + 1,
    effectiveAt: commandContext.now,
    updatedAt: commandContext.now,
    updatedBy: user.user_id,
  }))
  const responseBody = apiPayload(commandContext, { command: body.type, policies: after })
  const statements = normalized.map((update, index) => {
    const current = currentRows[index]
    return current
      ? db.prepare(`
          UPDATE policies
          SET value_json = ?, version = ?, effective_at = ?, updated_at = ?, updated_by = ?, last_request_id = ?
          WHERE policy_key = ? AND version = ?
        `).bind(
          JSON.stringify(update.value),
          update.expectedVersion + 1,
          commandContext.now,
          commandContext.now,
          user.user_id,
          commandContext.requestId,
          update.key,
          update.expectedVersion,
        )
      : db.prepare(`
          INSERT OR IGNORE INTO policies (
            policy_key, value_json, version, effective_at, updated_at, updated_by, last_request_id
          ) VALUES (?, ?, 1, ?, ?, ?, ?)
        `).bind(
          update.key,
          JSON.stringify(update.value),
          commandContext.now,
          commandContext.now,
          user.user_id,
          commandContext.requestId,
        )
  })
  const placeholders = normalized.map(() => '?').join(', ')
  const guardBindings = [...keys, commandContext.requestId, normalized.length]
  statements.push(
    db.prepare(`
      INSERT INTO audit_log (
        request_id, actor_id, actor_role, action, entity_type, entity_id,
        before_json, after_json, metadata_json, server_timestamp
      )
      SELECT ?, ?, ?, 'policies.set', 'policy-set', 'global', ?, ?, ?, ?
      WHERE (
        SELECT COUNT(*) FROM policies
        WHERE policy_key IN (${placeholders}) AND last_request_id = ?
      ) = ?
    `).bind(
      commandContext.requestId,
      user.user_id,
      user.role,
      JSON.stringify(currentRows.map((row) => row ? {
        key: row.policy_key,
        value: parseStoredJson(row.value_json),
        version: Number(row.version),
      } : null)),
      JSON.stringify(after),
      JSON.stringify({ atomic: true, count: normalized.length }),
      commandContext.now,
      ...guardBindings,
    ),
    db.prepare(`
      INSERT INTO command_receipts (
        actor_id, idempotency_key, request_hash, response_json, status_code, created_at
      ) VALUES (
        ?, ?,
        (SELECT ? WHERE (
          SELECT COUNT(*) FROM policies
          WHERE policy_key IN (${placeholders}) AND last_request_id = ?
        ) = ?),
        ?, 200, ?
      )
    `).bind(
      user.user_id,
      commandContext.idempotencyKey,
      commandContext.hash,
      ...guardBindings,
      JSON.stringify(responseBody),
      commandContext.now,
    ),
  )
  let results
  try {
    results = await db.batch(statements)
  } catch {
    const latest = await Promise.all(keys.map((key) => first(db, 'SELECT version FROM policies WHERE policy_key = ?', key)))
    throw new ApiError(409, 'VERSION_CONFLICT', 'Một chính sách đã thay đổi trên máy chủ.', {
      versions: Object.fromEntries(keys.map((key, index) => [key, Number(latest[index]?.version || 0)])),
    })
  }
  if (results.slice(0, normalized.length).some((result) => changes(result) !== 1)) {
    throw new ApiError(409, 'VERSION_CONFLICT', 'Một chính sách đã thay đổi trên máy chủ.')
  }
  return jsonResponse(responseBody)
}

const counterCommand = async (db, user, body, commandContext) => {
  if (user.role !== 'admin') {
    throw new ApiError(403, 'ROLE_FORBIDDEN', 'Bộ đếm kỹ thuật chỉ dành cho quản trị viên.')
  }
  const payload = isPlainRecord(body.payload) ? body.payload : {}
  const name = String(payload.name || '')
  if (!canUseCounter(user, name)) throw new ApiError(403, 'COUNTER_FORBIDDEN', 'Bạn không có quyền sử dụng bộ đếm này.')
  const counterKind = String(name.split(':').at(-1) || '').toLocaleLowerCase('vi-VN')
  if (['orders', 'imports'].includes(counterKind)) {
    throw new ApiError(400, 'DOMAIN_COMMAND_REQUIRED', 'Mã nghiệp vụ chỉ được sinh trong lệnh tạo bản ghi tương ứng.')
  }
  const expectedVersion = validateExpectedVersion(body.expectedVersion)
  const current = await first(db, `
    SELECT counter_name, counter_value, version FROM counters WHERE counter_name = ? LIMIT 1
  `, name)
  const currentVersion = Number(current?.version || 0)
  if (currentVersion !== expectedVersion) {
    throw new ApiError(409, 'VERSION_CONFLICT', 'Bộ đếm đã thay đổi trên máy chủ.', { currentVersion })
  }
  const currentValue = Number(current?.counter_value || 0)
  if (!Number.isSafeInteger(currentValue) || currentValue >= 99_999) {
    throw new ApiError(409, 'COUNTER_EXHAUSTED', 'Bộ đếm đã vượt giới hạn an toàn.')
  }
  const nextValue = currentValue + 1
  const nextVersion = currentVersion + 1
  const code = serverCounterCode(name, nextValue, commandContext.now)
  const responseBody = apiPayload(commandContext, {
    command: body.type,
    counter: { name, value: nextValue, version: nextVersion, code },
  })
  const responseJson = JSON.stringify(responseBody)
  const mutation = current
    ? db.prepare(`
        UPDATE counters
        SET counter_value = ?, version = ?, updated_at = ?, last_request_id = ?
        WHERE counter_name = ? AND version = ?
      `).bind(nextValue, nextVersion, commandContext.now, commandContext.requestId, name, currentVersion)
    : db.prepare(`
        INSERT OR IGNORE INTO counters (counter_name, counter_value, version, updated_at, last_request_id)
        VALUES (?, 1, 1, ?, ?)
      `).bind(name, commandContext.now, commandContext.requestId)

  const results = await db.batch([
    mutation,
    db.prepare(`
      INSERT INTO audit_log (
        request_id, actor_id, actor_role, action, entity_type, entity_id,
        before_json, after_json, metadata_json, server_timestamp
      )
      SELECT ?, ?, ?, 'counter.next', 'counter', ?, ?, ?, ?, ?
      WHERE EXISTS (
        SELECT 1 FROM counters WHERE counter_name = ? AND version = ? AND last_request_id = ?
      )
    `).bind(
      commandContext.requestId,
      user.user_id,
      user.role,
      name,
      JSON.stringify({ value: currentValue, version: currentVersion }),
      JSON.stringify({ value: nextValue, version: nextVersion, code }),
      JSON.stringify({ serverGenerated: true }),
      commandContext.now,
      name,
      nextVersion,
      commandContext.requestId,
    ),
    db.prepare(`
      INSERT INTO command_receipts (
        actor_id, idempotency_key, request_hash, response_json, status_code, created_at
      )
      SELECT ?, ?, ?, ?, 200, ?
      WHERE EXISTS (
        SELECT 1 FROM counters WHERE counter_name = ? AND version = ? AND last_request_id = ?
      )
    `).bind(
      user.user_id,
      commandContext.idempotencyKey,
      commandContext.hash,
      responseJson,
      commandContext.now,
      name,
      nextVersion,
      commandContext.requestId,
    ),
  ])
  if (changes(results?.[0]) !== 1) {
    const latest = await first(db, 'SELECT version FROM counters WHERE counter_name = ?', name)
    throw new ApiError(409, 'VERSION_CONFLICT', 'Bộ đếm đã thay đổi trên máy chủ.', {
      currentVersion: Number(latest?.version || 0),
    })
  }
  return jsonResponse(responseBody)
}

const changeOwnPasswordCommand = async (db, actor, body, commandContext) => {
  const payload = isPlainRecord(body.payload) ? body.payload : {}
  const expectedVersion = validateExpectedVersion(body.expectedVersion)
  const target = await first(db, 'SELECT * FROM users WHERE id = ? LIMIT 1', actor.user_id)
  if (!target || target.status !== 'active') {
    throw new ApiError(401, 'SESSION_INVALID', 'Tài khoản hoặc phiên đăng nhập không còn hợp lệ.')
  }
  const currentVersion = Number(target.version || 1)
  if (currentVersion !== expectedVersion) {
    throw new ApiError(409, 'VERSION_CONFLICT', 'Tài khoản đã thay đổi trên máy chủ.', { currentVersion })
  }
  const currentPassword = String(payload.currentPassword || '')
  if (currentPassword.length < 1 || currentPassword.length > 256) {
    throw new ApiError(400, 'CURRENT_PASSWORD_REQUIRED', 'Cần nhập mật khẩu hiện tại.')
  }
  const currentRecord = {
    hash: target.password_hash,
    salt: target.password_salt,
    iterations: target.password_iterations,
    algorithm: target.password_algorithm,
  }
  if (!await verifyPassword(currentPassword, currentRecord)) {
    throw new ApiError(401, 'CURRENT_PASSWORD_INVALID', 'Mật khẩu hiện tại chưa đúng.')
  }
  const newPassword = String(payload.newPassword || '')
  if (await verifyPassword(newPassword, currentRecord)) {
    throw new ApiError(400, 'PASSWORD_UNCHANGED', 'Mật khẩu mới phải khác mật khẩu hiện tại.')
  }
  const password = await hashPassword(newPassword)
  const nextVersion = currentVersion + 1
  const after = { ...publicUser(target), version: nextVersion, passwordUpdatedAt: commandContext.now }
  const responseBody = apiPayload(commandContext, {
    command: body.type,
    user: after,
    otherSessionsRevoked: true,
  })
  const results = await db.batch([
    db.prepare(`
      UPDATE users
      SET password_hash = ?, password_salt = ?, password_iterations = ?, password_algorithm = ?,
          password_updated_at = ?, updated_at = ?, version = ?
      WHERE id = ? AND version = ?
    `).bind(
      password.hash,
      password.salt,
      password.iterations,
      password.algorithm,
      commandContext.now,
      commandContext.now,
      nextVersion,
      actor.user_id,
      currentVersion,
    ),
    db.prepare(`
      UPDATE sessions
      SET revoked_at = ?, last_seen_at = ?
      WHERE user_id = ? AND id <> ? AND revoked_at IS NULL
        AND EXISTS (
          SELECT 1 FROM users WHERE id = ? AND version = ? AND updated_at = ?
        )
    `).bind(
      commandContext.now,
      commandContext.now,
      actor.user_id,
      actor.session_id,
      actor.user_id,
      nextVersion,
      commandContext.now,
    ),
    db.prepare(`
      INSERT INTO audit_log (
        request_id, actor_id, actor_role, action, entity_type, entity_id,
        before_json, after_json, metadata_json, server_timestamp
      )
      SELECT ?, ?, ?, 'user.change_password', 'user', ?, NULL, ?, ?, ?
      WHERE EXISTS (SELECT 1 FROM users WHERE id = ? AND version = ? AND updated_at = ?)
    `).bind(
      commandContext.requestId,
      actor.user_id,
      actor.role,
      actor.user_id,
      JSON.stringify({ passwordUpdatedAt: commandContext.now, version: nextVersion }),
      JSON.stringify({ otherSessionsRevoked: true }),
      commandContext.now,
      actor.user_id,
      nextVersion,
      commandContext.now,
    ),
    db.prepare(`
      INSERT INTO command_receipts (
        actor_id, idempotency_key, request_hash, response_json, status_code, created_at
      )
      SELECT ?, ?, ?, ?, 200, ?
      WHERE EXISTS (SELECT 1 FROM users WHERE id = ? AND version = ? AND updated_at = ?)
    `).bind(
      actor.user_id,
      commandContext.idempotencyKey,
      commandContext.hash,
      JSON.stringify(responseBody),
      commandContext.now,
      actor.user_id,
      nextVersion,
      commandContext.now,
    ),
  ])
  if (changes(results?.[0]) !== 1) {
    throw new ApiError(409, 'VERSION_CONFLICT', 'Tài khoản đã thay đổi trên máy chủ.')
  }
  return jsonResponse(responseBody)
}

const userCommand = async (db, actor, body, commandContext) => {
  assertOperationsRole(actor, 'Tài khoản không có quyền quản lý tài khoản nhân sự.')
  const payload = isPlainRecord(body.payload) ? body.payload : {}

  if (body.type === 'user.create') {
    const role = String(payload.role || 'employee').trim()
    if (!['business_support', 'store_manager', 'employee'].includes(role)) {
      throw new ApiError(400, 'ROLE_INVALID', 'Vai trò tài khoản không hợp lệ.')
    }
    if (role !== 'employee' && actor.role !== 'admin') {
      throw new ApiError(403, 'ROLE_FORBIDDEN', 'Chỉ Admin được tạo tài khoản Hỗ trợ KD hoặc Quản lý cửa hàng.')
    }
    const username = String(payload.username || '').trim()
    const normalizedUsername = normalizeUsername(username)
    const requestedStoreId = role === 'business_support'
      ? BUSINESS_SUPPORT_STORE_ID
      : String(payload.storeId || '').trim()
    const requestedEmployeeId = String(payload.employeeId || '').trim()
    const displayName = String(payload.displayName || '').trim().slice(0, 160)
    if (!/^[A-Za-z0-9._-]{3,80}$/u.test(username)) {
      throw new ApiError(400, 'INVALID_USERNAME', 'Tên đăng nhập không hợp lệ.')
    }
    if (!/^[A-Za-z0-9_-]{1,80}$/u.test(requestedStoreId) || !/^[A-Za-z0-9_-]{1,80}$/u.test(requestedEmployeeId)) {
      throw new ApiError(400, 'EMPLOYEE_SCOPE_INVALID', 'Tài khoản cần mã đơn vị và mã nhân viên hợp lệ.')
    }
    if (role === 'employee') assertOperationalStoreAccess(actor, requestedStoreId)
    const globalState = body._preloadedGlobalStateRow || await loadState(db, 'global')
    const state = normalizeSharedStateForStorage(parseStoredJson(globalState?.value_json, {}))
    assertNoCaseCollidingOperationalIdentifiers(state)
    const employeeProfile = uniqueEmployeeIdentifierRecordMatch({
      records: state.employees,
      identifier: requestedEmployeeId,
      predicate: (record) => !record.deletedAt,
    })?.record || null
    const retiredEmployee = (Array.isArray(state.deletedEmployees) ? state.deletedEmployees : [])
      .some((record) => employeeIdentifierValues(record)
        .some((identifier) => sameIdentifier(identifier, requestedEmployeeId)))
    const storeMatch = uniqueIdentifierRecordMatch({
      records: state.stores,
      identifier: requestedStoreId,
      predicate: (store) => !store.deletedAt,
      collisionCode: 'STORE_IDENTIFIER_COLLISION',
      collisionMessage: 'Mã cửa hàng đang trùng với nhiều bản ghi; không thể tạo tài khoản an toàn.',
    })
    const virtualStoreId = sameIdentifier(requestedStoreId, OFFICE_STORE_ID)
      ? OFFICE_STORE_ID
      : sameIdentifier(requestedStoreId, BUSINESS_SUPPORT_STORE_ID)
        ? BUSINESS_SUPPORT_STORE_ID
        : ''
    if (!storeMatch && !virtualStoreId) {
      throw new ApiError(400, 'STORE_INVALID', 'Đơn vị gán cho nhân viên không tồn tại.')
    }
    if (retiredEmployee) {
      throw new ApiError(409, 'EMPLOYEE_ID_RETIRED', 'Mã nhân viên đã nghỉ việc và không thể cấp lại tài khoản.')
    }
    if (!employeeProfile) {
      throw new ApiError(404, 'EMPLOYEE_NOT_FOUND', 'Cần có hồ sơ nhân viên đang hoạt động trước khi tạo tài khoản.')
    }
    const employeeId = String(
      employeeProfile.id || employeeProfile.code || employeeProfile.employeeId || requestedEmployeeId,
    ).trim()
    const storeId = String(storeMatch?.record?.id || virtualStoreId || requestedStoreId).trim()
    const profileStatus = normalizeTextKey(employeeProfile?.status)
    if (profileStatus && !['active', 'dang lam viec', 'dang hoat dong', 'hoat dong'].includes(profileStatus)) {
      throw new ApiError(409, 'EMPLOYEE_INACTIVE', 'Không thể tạo tài khoản hoạt động cho nhân viên đã ngưng hoặc nghỉ việc.')
    }
    if (!sameIdentifier(employeeProfile.storeId, storeId) || roleForEmployeeUnit(employeeUnit(employeeProfile)) !== role) {
      throw new ApiError(400, 'EMPLOYEE_ROLE_MISMATCH', 'Hồ sơ nhân viên không thuộc đúng đơn vị hoặc vai trò đã chọn.')
    }
    const existing = await first(db, `
      SELECT id FROM users WHERE username_normalized = ? OR (? <> '' AND LOWER(employee_id) = LOWER(?)) LIMIT 1
    `, normalizedUsername, employeeId, employeeId)
    if (existing) throw new ApiError(409, 'USER_EXISTS', 'Tên đăng nhập hoặc mã nhân viên đã tồn tại.')
    const password = await hashPassword(payload.password)
    const userId = `usr_${crypto.randomUUID()}`
    const responseUser = {
      id: userId,
      username,
      displayName: displayName || employeeProfile.name || employeeId,
      role,
      storeId: storeId || null,
      employeeId: employeeId || null,
      status: 'active',
      version: 1,
      lastLoginAt: null,
    }
    const responseBody = apiPayload(commandContext, { command: body.type, user: responseUser })
    try {
      await db.batch([
        db.prepare(`
          INSERT INTO users (
            id, username, username_normalized, display_name, password_hash, password_salt,
            password_iterations, password_algorithm, role, status, version, store_id, employee_id,
            created_at, updated_at, password_updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', 1, ?, ?, ?, ?, ?)
        `).bind(
          userId,
          username,
          normalizedUsername,
          responseUser.displayName,
          password.hash,
          password.salt,
          password.iterations,
          password.algorithm,
          role,
          storeId || null,
          employeeId || null,
          commandContext.now,
          commandContext.now,
          commandContext.now,
        ),
        db.prepare(`
          INSERT INTO audit_log (
            request_id, actor_id, actor_role, action, entity_type, entity_id,
            before_json, after_json, metadata_json, server_timestamp
          ) VALUES (?, ?, ?, 'user.create', 'user', ?, NULL, ?, NULL, ?)
        `).bind(
          commandContext.requestId,
          actor.user_id,
          actor.role,
          userId,
          JSON.stringify(responseUser),
          commandContext.now,
        ),
        db.prepare(`
          INSERT INTO command_receipts (
            actor_id, idempotency_key, request_hash, response_json, status_code, created_at
          ) VALUES (?, ?, ?, ?, 201, ?)
        `).bind(
          actor.user_id,
          commandContext.idempotencyKey,
          commandContext.hash,
          JSON.stringify(responseBody),
          commandContext.now,
        ),
      ])
    } catch (error) {
      const raced = await first(db, `
        SELECT id FROM users WHERE username_normalized = ? OR (? <> '' AND LOWER(employee_id) = LOWER(?)) LIMIT 1
      `, normalizedUsername, employeeId, employeeId)
      if (raced) throw new ApiError(409, 'USER_EXISTS', 'Tên đăng nhập hoặc mã nhân viên đã tồn tại.')
      throw error
    }
    return jsonResponse(responseBody, 201)
  }

  if (!['user.update', 'user.set_status', 'user.reset_password'].includes(body.type)) {
    throw new ApiError(400, 'COMMAND_UNKNOWN', 'Lệnh tài khoản không được hỗ trợ.')
  }
  const userId = String(payload.userId || '')
  const target = await first(db, "SELECT * FROM users WHERE id = ? AND role IN ('employee', 'business_support', 'store_manager') LIMIT 1", userId)
  if (!target) throw new ApiError(404, 'USER_NOT_FOUND', 'Không tìm thấy tài khoản được phép quản lý.')
  if (target.role !== 'employee' && actor.role !== 'admin') {
    throw new ApiError(403, 'ROLE_FORBIDDEN', 'Chỉ Admin được quản lý tài khoản Hỗ trợ KD hoặc Quản lý cửa hàng.')
  }
  if (target.role === 'employee') assertOperationalStoreAccess(actor, target.store_id)
  if (actor.role !== 'admin' && target.status === 'inactive') {
    throw new ApiError(403, 'EMPLOYEE_REACTIVATE_FORBIDDEN', 'Chỉ Admin được quản lý lại tài khoản nhân viên đã nghỉ việc.')
  }
  if (payload.role !== undefined && String(payload.role) !== String(target.role)) {
    throw new ApiError(400, 'ROLE_IMMUTABLE', 'Vai trò tài khoản không thể thay đổi.')
  }
  const expectedVersion = validateExpectedVersion(body.expectedVersion)
  const currentVersion = Number(target.version || 1)
  if (expectedVersion !== currentVersion) {
    throw new ApiError(409, 'VERSION_CONFLICT', 'Tài khoản đã thay đổi trên máy chủ.', { currentVersion })
  }
  const nextVersion = currentVersion + 1

  if (body.type === 'user.update') {
    if (payload.employeeId !== undefined
      && String(payload.employeeId || '').trim() !== String(target.employee_id || '').trim()
      && !sameIdentifier(payload.employeeId, target.employee_id)) {
      throw new ApiError(400, 'EMPLOYEE_ID_IMMUTABLE', 'Mã nhân viên của tài khoản không thể thay đổi.')
    }
    const username = payload.username === undefined ? target.username : String(payload.username || '').trim()
    const normalizedUsername = normalizeUsername(username)
    const displayName = payload.displayName === undefined
      ? target.display_name
      : String(payload.displayName || '').trim().slice(0, 160)
    const storeId = String(target.store_id || '')
    if (payload.storeId !== undefined
      && String(payload.storeId || '').trim() !== storeId
      && !sameIdentifier(payload.storeId, storeId)) {
      throw new ApiError(400, 'EMPLOYEE_STORE_IMMUTABLE', 'Không thể đổi đơn vị tài khoản tách khỏi hồ sơ nhân viên.')
    }
    if (!/^[A-Za-z0-9._-]{3,80}$/u.test(username)) {
      throw new ApiError(400, 'INVALID_USERNAME', 'Tên đăng nhập nhân viên không hợp lệ.')
    }
    if (!displayName) throw new ApiError(400, 'DISPLAY_NAME_INVALID', 'Tên hiển thị không được để trống.')
    if (!/^[A-Za-z0-9_-]{1,80}$/u.test(storeId)) {
      throw new ApiError(400, 'EMPLOYEE_SCOPE_INVALID', 'Mã cửa hàng không hợp lệ.')
    }
    if (target.role === 'employee') {
      assertOperationalStoreAccess(actor, storeId)
      const globalState = body._preloadedGlobalStateRow || await loadState(db, 'global')
      const state = normalizeSharedStateForStorage(parseStoredJson(globalState?.value_json, {}))
      const validStore = uniqueIdentifierRecordMatch({
        records: state.stores,
        identifier: storeId,
        predicate: (store) => !store.deletedAt,
        collisionCode: 'STORE_IDENTIFIER_COLLISION',
        collisionMessage: 'Mã cửa hàng đang trùng với nhiều bản ghi; không thể cập nhật tài khoản an toàn.',
      })
      const validOffice = sameIdentifier(storeId, OFFICE_STORE_ID)
      if (!validStore && !validOffice) {
        throw new ApiError(400, 'STORE_INVALID', 'Đơn vị gán cho nhân viên không tồn tại.')
      }
    }
    const duplicate = await first(db, `
      SELECT id FROM users WHERE username_normalized = ? AND id <> ? LIMIT 1
    `, normalizedUsername, userId)
    if (duplicate) throw new ApiError(409, 'USER_EXISTS', 'Tên đăng nhập đã được sử dụng.')
    const scopeChanged = !sameIdentifier(target.store_id, storeId)
    const after = {
      ...publicUser(target),
      username,
      displayName,
      storeId,
      version: nextVersion,
    }
    const responseBody = apiPayload(commandContext, { command: body.type, user: after })
    const statements = [
      db.prepare(`
        UPDATE users
        SET username = ?, username_normalized = ?, display_name = ?, store_id = ?, version = ?, updated_at = ?
        WHERE id = ? AND version = ?
      `).bind(
        username,
        normalizedUsername,
        displayName,
        storeId,
        nextVersion,
        commandContext.now,
        userId,
        currentVersion,
      ),
    ]
    if (scopeChanged) {
      statements.push(db.prepare(`
        UPDATE sessions
        SET revoked_at = ?, last_seen_at = ?
        WHERE user_id = ? AND revoked_at IS NULL
          AND EXISTS (
            SELECT 1 FROM users WHERE id = ? AND version = ? AND updated_at = ?
          )
      `).bind(
        commandContext.now,
        commandContext.now,
        userId,
        userId,
        nextVersion,
        commandContext.now,
      ))
    }
    statements.push(
      db.prepare(`
        INSERT INTO audit_log (
          request_id, actor_id, actor_role, action, entity_type, entity_id,
          before_json, after_json, metadata_json, server_timestamp
        )
        SELECT ?, ?, ?, 'user.update', 'user', ?, ?, ?, ?, ?
        WHERE EXISTS (SELECT 1 FROM users WHERE id = ? AND version = ? AND updated_at = ?)
      `).bind(
        commandContext.requestId,
        actor.user_id,
        actor.role,
        userId,
        JSON.stringify(publicUser(target)),
        JSON.stringify(after),
        JSON.stringify({ scopeChanged }),
        commandContext.now,
        userId,
        nextVersion,
        commandContext.now,
      ),
      db.prepare(`
        INSERT INTO command_receipts (
          actor_id, idempotency_key, request_hash, response_json, status_code, created_at
        )
        SELECT ?, ?, ?, ?, 200, ?
        WHERE EXISTS (SELECT 1 FROM users WHERE id = ? AND version = ? AND updated_at = ?)
      `).bind(
        actor.user_id,
        commandContext.idempotencyKey,
        commandContext.hash,
        JSON.stringify(responseBody),
        commandContext.now,
        userId,
        nextVersion,
        commandContext.now,
      ),
    )
    let results
    try {
      results = await db.batch(statements)
    } catch (error) {
      const racedDuplicate = await first(db, `
        SELECT id FROM users WHERE username_normalized = ? AND id <> ? LIMIT 1
      `, normalizedUsername, userId)
      if (racedDuplicate) throw new ApiError(409, 'USER_EXISTS', 'Tên đăng nhập đã được sử dụng.')
      throw error
    }
    if (changes(results?.[0]) !== 1) throw new ApiError(409, 'VERSION_CONFLICT', 'Tài khoản đã thay đổi trên máy chủ.')
    return jsonResponse(responseBody)
  }

  if (body.type === 'user.set_status') {
    const status = String(payload.status || '')
    if (!VALID_ACCOUNT_STATUSES.has(status)) throw new ApiError(400, 'STATUS_INVALID', 'Trạng thái tài khoản không hợp lệ.')
    if (actor.role !== 'admin' && (status === 'inactive' || target.status === 'inactive')) {
      throw new ApiError(403, 'EMPLOYEE_DELETE_FORBIDDEN', 'Chỉ Admin được xóa hoặc vô hiệu hóa nhân viên khỏi hệ thống.')
    }
    const after = { ...publicUser(target), status, version: nextVersion }
    const responseBody = apiPayload(commandContext, { command: body.type, user: after })
    const statements = [
      db.prepare(`
        UPDATE users SET status = ?, version = ?, updated_at = ? WHERE id = ? AND version = ?
      `).bind(status, nextVersion, commandContext.now, userId, currentVersion),
    ]
    if (status !== 'active') {
      statements.push(db.prepare(`
        UPDATE sessions
        SET revoked_at = ?, last_seen_at = ?
        WHERE user_id = ? AND revoked_at IS NULL
          AND EXISTS (
            SELECT 1 FROM users WHERE id = ? AND version = ? AND updated_at = ?
          )
      `).bind(
        commandContext.now,
        commandContext.now,
        userId,
        userId,
        nextVersion,
        commandContext.now,
      ))
    }
    statements.push(
      db.prepare(`
        INSERT INTO audit_log (
          request_id, actor_id, actor_role, action, entity_type, entity_id,
          before_json, after_json, metadata_json, server_timestamp
        )
        SELECT ?, ?, ?, 'user.set_status', 'user', ?, ?, ?, NULL, ?
        WHERE EXISTS (SELECT 1 FROM users WHERE id = ? AND version = ? AND updated_at = ?)
      `).bind(
        commandContext.requestId,
        actor.user_id,
        actor.role,
        userId,
        JSON.stringify(publicUser(target)),
        JSON.stringify(after),
        commandContext.now,
        userId,
        nextVersion,
        commandContext.now,
      ),
      db.prepare(`
        INSERT INTO command_receipts (
          actor_id, idempotency_key, request_hash, response_json, status_code, created_at
        )
        SELECT ?, ?, ?, ?, 200, ?
        WHERE EXISTS (SELECT 1 FROM users WHERE id = ? AND version = ? AND updated_at = ?)
      `).bind(
        actor.user_id,
        commandContext.idempotencyKey,
        commandContext.hash,
        JSON.stringify(responseBody),
        commandContext.now,
        userId,
        nextVersion,
        commandContext.now,
      ),
    )
    const results = await db.batch(statements)
    if (changes(results?.[0]) !== 1) throw new ApiError(409, 'VERSION_CONFLICT', 'Tài khoản đã thay đổi trên máy chủ.')
    return jsonResponse(responseBody)
  }

  const password = await hashPassword(payload.password)
  const after = { ...publicUser(target), version: nextVersion, passwordUpdatedAt: commandContext.now }
  const responseBody = apiPayload(commandContext, { command: body.type, user: after })
  const results = await db.batch([
    db.prepare(`
      UPDATE users
      SET password_hash = ?, password_salt = ?, password_iterations = ?, password_algorithm = ?,
          password_updated_at = ?, updated_at = ?, version = ?
      WHERE id = ? AND version = ?
    `).bind(
      password.hash,
      password.salt,
      password.iterations,
      password.algorithm,
      commandContext.now,
      commandContext.now,
      nextVersion,
      userId,
      currentVersion,
    ),
    db.prepare(`
      UPDATE sessions
      SET revoked_at = ?, last_seen_at = ?
      WHERE user_id = ? AND revoked_at IS NULL
        AND EXISTS (
          SELECT 1 FROM users WHERE id = ? AND version = ? AND updated_at = ?
        )
    `).bind(
      commandContext.now,
      commandContext.now,
      userId,
      userId,
      nextVersion,
      commandContext.now,
    ),
    db.prepare(`
      INSERT INTO audit_log (
        request_id, actor_id, actor_role, action, entity_type, entity_id,
        before_json, after_json, metadata_json, server_timestamp
      )
      SELECT ?, ?, ?, 'user.reset_password', 'user', ?, NULL, ?, NULL, ?
      WHERE EXISTS (SELECT 1 FROM users WHERE id = ? AND version = ? AND updated_at = ?)
    `).bind(
      commandContext.requestId,
      actor.user_id,
      actor.role,
      userId,
      JSON.stringify({ passwordUpdatedAt: commandContext.now, version: nextVersion }),
      commandContext.now,
      userId,
      nextVersion,
      commandContext.now,
    ),
    db.prepare(`
      INSERT INTO command_receipts (
        actor_id, idempotency_key, request_hash, response_json, status_code, created_at
      )
      SELECT ?, ?, ?, ?, 200, ?
      WHERE EXISTS (SELECT 1 FROM users WHERE id = ? AND version = ? AND updated_at = ?)
    `).bind(
      actor.user_id,
      commandContext.idempotencyKey,
      commandContext.hash,
      JSON.stringify(responseBody),
      commandContext.now,
      userId,
      nextVersion,
      commandContext.now,
    ),
  ])
  if (changes(results?.[0]) !== 1) throw new ApiError(409, 'VERSION_CONFLICT', 'Tài khoản đã thay đổi trên máy chủ.')
  return jsonResponse(responseBody)
}

const executeCommand = async (request, env, context) => {
  const db = getDatabase(env)
  const user = await requireSession(request, db, context)
  const body = await readJson(request)
  const updatesAccountAvatar = body.type === 'account_settings.update' && accountSettingsUpdatesAvatar(body)
  const skipsAccountAvatarCleanup = body.type === 'account_settings.update' && !updatesAccountAvatar
  if (!skipsAccountAvatarCleanup) {
    // Mutation fences and retired-object cleanup are distinct durable queues.
    // Drain both in the same preflight so the client needs at most one safe,
    // idempotent retry instead of one manual Save click for each queue.
    const mutationCleanupFinished = await resumePendingAccountAvatarMutationCleanup(db, env, context)
    const retiredObjectCleanupFinished = await resumePendingAccountAvatarCleanup(db, env, context)
    if (mutationCleanupFinished || retiredObjectCleanupFinished) {
      throw new ApiError(
        503,
        'ACCOUNT_AVATAR_CLEANUP_RETRY',
        'Ảnh đại diện tồn đọng đã được dọn; request này chưa được thực thi, vui lòng gửi lại.',
      )
    }
  }
  if (body.type !== 'system.reset_all' && await loadPendingSystemResetAll(db)) {
    throw new ApiError(503, 'RESET_CLEANUP_PENDING', 'Hệ thống đang hoàn tất xóa ảnh CCCD của lần Reset toàn bộ dữ liệu; các lệnh ghi tạm thời bị khóa.')
  }
  if (RETIRED_COMMANDS.has(String(body.type || ''))) {
    throw new ApiError(410, 'COMMAND_RETIRED', 'Chức năng cài đặt thời gian làm việc đã ngừng sử dụng.')
  }
  if (user.role === 'business_support' && !businessSupportCommandAllowed(body)) {
    throw new ApiError(403, 'BUSINESS_SUPPORT_READ_ONLY', 'Nhân viên hỗ trợ KD không có quyền thực hiện thao tác này.')
  }
  const collisionStateRow = user._globalStateRow || await loadState(db, 'global')
  const collisionState = normalizeSharedStateForStorage(parseStoredJson(collisionStateRow?.value_json, {}))
  try {
    assertNoCaseCollidingOperationalIdentifiers(collisionState)
  } catch (error) {
    const repairableCollision = [
      'EMPLOYEE_IDENTIFIER_COLLISION',
      'STORE_IDENTIFIER_COLLISION',
      'SUPPORT_TRANSFER_IDENTIFIER_COLLISION',
    ].includes(error?.code)
    const globalScope = String(body.scope || defaultScope(user)) === 'global'
    const adminStateRepair = user.role === 'admin'
      && globalScope
      && ['state.replace', 'state.merge'].includes(body.type)
    const adminReset = user.role === 'admin'
      && ['system.reset_all', 'system.reset_demo'].includes(body.type)
    const adminHistoryAliasRepair = user.role === 'admin'
      && body.type === 'operational_identifier.resolve_history_alias'
    if (!repairableCollision || (!adminStateRepair && !adminReset && !adminHistoryAliasRepair)) throw error
    if (adminStateRepair) {
      Object.defineProperty(body, '_operationalCollisionRepair', {
        value: true,
        enumerable: false,
      })
    }
  }
  const idempotencyKey = validateIdempotencyKey(request, body)
  const hash = await requestHash({ ...body, idempotencyKey: undefined })
  const existingReceipt = await loadReceipt(db, user.user_id, idempotencyKey)
  const replay = replayReceipt(existingReceipt, hash)
  if (replay) return replay

  const commandContext = {
    ...context,
    idempotencyKey,
    hash,
    userAgent: String(request.headers.get('user-agent') || '').slice(0, 512),
  }
  const persistedGlobalStateRow = await persistOpenStoreAttendanceChecklistRepairs(
    db,
    user,
    commandContext,
    collisionStateRow,
  )
  if (persistedGlobalStateRow) {
    Object.defineProperty(body, '_preloadedGlobalStateRow', {
      value: persistedGlobalStateRow,
      enumerable: false,
    })
    const repair = persistedGlobalStateRow._storeChecklistRepair
    const commandScope = body.type === 'state.replace' || body.type === 'state.merge'
      ? String(body.scope || defaultScope(user))
      : 'global'
    // Rebase only across the deterministic repair committed by this request.
    // If another writer changed the state first, previousVersion will not match
    // the client's version and the normal optimistic-concurrency conflict remains.
    if (commandScope === 'global'
      && !['state.replace', 'state.merge'].includes(body.type)
      && repair
      && Number(body.expectedVersion) === Number(repair.previousVersion)
      && Number(persistedGlobalStateRow.version) === Number(repair.nextVersion)) {
      Object.defineProperty(body, '_expectedGlobalStateVersion', {
        value: Number(repair.nextVersion),
        enumerable: false,
      })
    }
  }
  try {
    if (body.type === 'state.replace' || body.type === 'state.merge') {
      return await stateCommand(db, user, body, commandContext)
    }
    if (String(body.type || '').startsWith('store.')) {
      return await storeCommand(db, user, body, commandContext)
    }
    if (body.type === 'tasks.assign' || body.type === 'tasks.replace_scope') {
      return await taskAssignmentCommand(db, user, body, commandContext)
    }
    if (String(body.type || '').startsWith('employee.')) {
      return await employeeProfileCommand(db, user, body, commandContext, env)
    }
    if (String(body.type || '').startsWith('shift_definition.')) {
      return await shiftDefinitionCommand(db, user, body, commandContext)
    }
    if (String(body.type || '').startsWith('schedule.')) {
      return await scheduleCommand(db, user, body, commandContext)
    }
    if (String(body.type || '').startsWith('account_settings.')) {
      return await accountSettingsCommand(db, user, body, commandContext, env)
    }
    if (String(body.type || '').startsWith('notification.')) {
      return await notificationCommand(db, user, body, commandContext)
    }
    if (String(body.type || '').startsWith('support_transfer.')) {
      return await supportTransferCommand(db, user, body, commandContext)
    }
    if (String(body.type || '').startsWith('operational_reset.')) {
      return await operationalResetCommand(db, user, body, commandContext)
    }
    if (body.type === 'operational_identifier.resolve_history_alias') {
      return await operationalIdentifierHistoryRepairCommand(db, user, body, commandContext)
    }
    if (body.type === 'system.reset_all') {
      return await systemResetAllCommand(db, user, body, commandContext, env)
    }
    if (body.type === 'system.reset_demo') {
      return await systemResetDemoCommand(db, user, body, commandContext, env)
    }
    if (body.type === 'policy.set') return await policyCommand(db, user, body, commandContext)
    if (body.type === 'policies.set') return await policiesCommand(db, user, body, commandContext)
    if (body.type === 'attendance.update') {
      return await attendanceUpdateCommand(db, user, body, commandContext)
    }
    if (body.type === 'attendance.check_in' || body.type === 'attendance.check_out') {
      return await attendanceCommand(db, user, body, commandContext)
    }
    if (String(body.type || '').startsWith('order_information.')) {
      return await orderInformationCommand(db, user, body, commandContext)
    }
    if (body.type === 'order.create') return await orderCreateCommand(db, user, body, commandContext)
    if (body.type === 'order.update' || body.type === 'order.delete') {
      return await orderMutationCommand(db, user, body, commandContext)
    }
    if (String(body.type || '').startsWith('support_work.')) {
      return await supportWorkCommand(db, user, body, commandContext)
    }
    if (String(body.type || '').startsWith('support_schedule.')) {
      return await supportScheduleCommand(db, user, body, commandContext)
    }
    if (body.type === 'task.progress.save') {
      return await taskProgressCommand(db, user, body, commandContext)
    }
    if (body.type === 'task.done' || body.type === 'task.set_done') {
      return await taskDoneCommand(db, user, body, commandContext)
    }
    if (body.type === 'shift_expense.create') {
      return await shiftExpenseCommand(db, user, body, commandContext)
    }
    if (String(body.type || '').startsWith('fixed_expense.')
      || String(body.type || '').startsWith('expense.')) {
      return await expenseCommand(db, user, body, commandContext)
    }
    if (String(body.type || '').startsWith('import.')
      || String(body.type || '').startsWith('import_voucher.')) {
      return await importVoucherCommand(db, user, body, commandContext)
    }
    if (String(body.type || '').startsWith('salary_advance.')) {
      return await salaryAdvanceCommand(db, user, body, commandContext)
    }
    if (String(body.type || '').startsWith('salary_adjustment.')) {
      return await salaryAdjustmentCommand(db, user, body, commandContext)
    }
    if (String(body.type || '').startsWith('store_salary_config.')) {
      if (body.type === 'store_salary_config.resolve_collision') {
        return await storeSalaryConfigCollisionRepairCommand(db, user, body, commandContext)
      }
      return await storeSalaryConfigCommand(db, user, body, commandContext)
    }
    if (String(body.type || '').startsWith('compensation_entry.')) {
      return await compensationEntryCommand(db, user, body, commandContext)
    }
    if (String(body.type || '').startsWith('work_catalog.')) {
      return await workCatalogCommand(db, user, body, commandContext)
    }
    if (body.type === 'work_reward.set' || body.type === 'work_reward.set_batch') {
      return await workRewardCommand(db, user, body, commandContext)
    }
    if (String(body.type || '').startsWith('violation.')) {
      return await violationCommand(db, user, body, commandContext)
    }
    if (String(body.type || '').startsWith('revenue_bonus.')) {
      return await revenueBonusCommand(db, user, body, commandContext)
    }
    if (String(body.type || '').startsWith('payroll.')) {
      if (body.type === 'payroll.resolve_period_collision') {
        return await payrollPeriodCollisionRepairCommand(db, user, body, commandContext)
      }
      return await payrollCommand(db, user, body, commandContext)
    }
    if (body.type === 'counter.next') return await counterCommand(db, user, body, commandContext)
    if (body.type === 'user.change_password') {
      return await changeOwnPasswordCommand(db, user, body, commandContext)
    }
    if (String(body.type || '').startsWith('user.')) return await userCommand(db, user, body, commandContext)
    throw new ApiError(400, 'COMMAND_UNKNOWN', 'Lệnh không được hỗ trợ.')
  } catch (error) {
    const racedReceipt = await loadReceipt(db, user.user_id, idempotencyKey)
    const racedReplay = replayReceipt(racedReceipt, hash)
    if (racedReplay) return racedReplay
    throw error
  }
}

const logout = async (request, env, context) => {
  const db = getDatabase(env)
  const user = await requireSession(request, db, context)
  if (await loadPendingSystemResetAll(db)) {
    throw new ApiError(503, 'RESET_CLEANUP_PENDING', 'Không thể đăng xuất phiên Admin đang dùng để hoàn tất Reset toàn bộ dữ liệu.')
  }
  await db.batch([
    db.prepare('UPDATE sessions SET revoked_at = ?, last_seen_at = ? WHERE id = ? AND revoked_at IS NULL')
      .bind(context.now, context.now, user.session_id),
    db.prepare(`
      INSERT INTO audit_log (
        request_id, actor_id, actor_role, action, entity_type, entity_id,
        before_json, after_json, metadata_json, server_timestamp
      ) VALUES (?, ?, ?, 'auth.logout', 'session', ?, NULL, ?, NULL, ?)
    `).bind(
      context.requestId,
      user.user_id,
      user.role,
      user.session_id,
      JSON.stringify({ revokedAt: context.now }),
      context.now,
    ),
  ])
  return jsonResponse(apiPayload(context, { loggedOut: true }))
}

const visibleUserRowsForActor = async (db, actor) => ['admin', 'business_support'].includes(actor.role)
  ? await all(db, `
        SELECT id, username, display_name, role, status, version, store_id, employee_id, last_login_at
        FROM users
        WHERE role IN ('employee', 'business_support', 'store_manager')
        ORDER BY role DESC, display_name, username
      `)
  : await all(db, `
        SELECT id, username, display_name, role, status, version, store_id, employee_id, last_login_at
        FROM users
        WHERE role = 'employee' AND LOWER(store_id) = LOWER(?)
        ORDER BY display_name, username
      `, String(actor.store_id || ''))

const listUsers = async (request, env, context) => {
  const db = getDatabase(env)
  const actor = await requireSession(request, db, context)
  if (!OPERATIONS_ROLES.has(actor.role)) {
    throw new ApiError(403, 'ROLE_FORBIDDEN', 'Tài khoản không có quyền xem danh sách tài khoản nhân sự.')
  }
  const rows = await visibleUserRowsForActor(db, actor)
  return jsonResponse(apiPayload(context, { users: rows.map(publicUser) }))
}

const getAccountAvatar = async (request, env, context) => {
  const db = getDatabase(env)
  const actor = await requireSession(request, db, context)
  let current = actor._globalStateRow || await loadState(db, 'global')
  current = await migrateLegacyAccountAvatars(db, env, actor, context, current)
  const state = normalizeSharedStateForStorage(parseStoredJson(current?.value_json, {}))
  const metadata = normalizeAccountAvatarMetadata(ownAccountSettings(state, actor).avatar)
  if (!metadata) throw new ApiError(404, 'ACCOUNT_AVATAR_NOT_FOUND', 'Tài khoản chưa có ảnh đại diện.')
  const bucket = env?.IDENTITY_IMAGES
  if (!bucket?.get) {
    throw new ApiError(503, 'ACCOUNT_AVATAR_STORAGE_UNAVAILABLE', 'Kho lưu ảnh đại diện chưa được cấu hình.')
  }
  const object = await bucket.get(metadata.key)
  if (!object?.body) throw new ApiError(404, 'ACCOUNT_AVATAR_NOT_FOUND', 'Không tìm thấy ảnh đại diện trong kho riêng tư.')
  const extension = metadata.contentType === 'image/jpeg' ? 'jpg' : metadata.contentType.split('/')[1]
  const headers = new Headers({
    'Cache-Control': 'private, no-store',
    'Content-Disposition': `inline; filename="avatar.${extension}"`,
    'Content-Security-Policy': "default-src 'none'",
    'Content-Type': metadata.contentType,
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Avatar-Version': String(metadata.version),
  })
  if (Number.isSafeInteger(metadata.size)) headers.set('Content-Length', String(metadata.size))
  if (object.etag) headers.set('ETag', String(object.etag))
  return new Response(object.body, { status: 200, headers })
}

const employeeAvatarNotFound = () => new ApiError(
  404,
  'EMPLOYEE_AVATAR_NOT_FOUND',
  'Không tìm thấy ảnh đại diện nhân viên.',
)

const activeEmployeeAvatarProfile = (profile) => {
  if (!isPlainRecord(profile) || profile.deletedAt || profile.active === false) return false
  return ![
    'da nghi viec', 'nghi viec', 'tam ngung', 'inactive', 'locked', 'da xoa', 'deleted',
  ].includes(normalizeTextKey(profile.status))
}

const activePhysicalStoreByIdentifier = (state, storeId) => {
  const requestedStoreId = String(storeId || '').trim()
  if (!requestedStoreId || isReservedPhysicalStoreIdentifier(requestedStoreId)) return null
  const store = uniqueIdentifierRecordMatch({
    records: state?.stores,
    identifier: requestedStoreId,
    predicate: (record) => !record?.deletedAt,
    collisionCode: 'EMPLOYEE_AVATAR_STORE_COLLISION',
    collisionMessage: 'Mã cửa hàng của hồ sơ ảnh đại diện đang trùng.',
  })?.record || null
  if (!store || store.active === false || store.isOperational === false) return null
  return ['da dong', 'ngung hoat dong', 'tam ngung', 'inactive', 'closed'].includes(normalizeTextKey(store.status))
    ? null
    : store
}

const activePhysicalStoreForAvatarProfile = (state, profile) => (
  activePhysicalStoreByIdentifier(state, profile?.storeId)
)

const canonicalLinkedEmployeeProfile = (records, profile, {
  collisionCode = 'LINKED_EMPLOYEE_PROFILE_COLLISION',
  collisionMessage = 'Hồ sơ nhân viên liên kết đang trùng.',
} = {}) => {
  const employees = Array.isArray(records) ? records : []
  let current = profile
  const visited = new Set()
  while (isPlainRecord(current)) {
    const currentId = employeeProfileIdentifier(current)
    const currentKey = normalizeIdentifierKey(currentId)
    if (!currentKey || visited.has(currentKey)) break
    visited.add(currentKey)
    const linkedId = String(
      current.linkedEmployeeId
      || current.sourceEmployeeId
      || current.rootEmployeeId
      || current.originalEmployeeId
      || '',
    ).trim()
    if (!linkedId) break
    const linked = uniqueEmployeeIdentifierRecordMatch({
      records: employees,
      identifier: linkedId,
      predicate: isPlainRecord,
      collisionCode,
      collisionMessage,
    })?.record || null
    if (!linked) break
    current = linked
  }
  return current || profile
}

const canonicalEmployeeAvatarProfile = (state, profile) => canonicalLinkedEmployeeProfile(
  state?.employees,
  profile,
  {
    collisionCode: 'EMPLOYEE_AVATAR_LINK_COLLISION',
    collisionMessage: 'Hồ sơ liên kết của ảnh đại diện đang trùng.',
  },
)

const employeeAvatarProfileIds = (profile) => new Set([
  profile?.id, profile?.code, profile?.employeeId, profile?.employeeCode,
].map((value) => String(value || '').trim()).filter(Boolean))

const employeeAvatarIsActorIdentity = (state, actor, profile) => {
  const actorUserId = String(actor?.user_id || actor?.id || '').trim()
  const actorRoleProfile = actorRoleEmployeeProfile(state, actor)
  const actorCanonical = canonicalActorEmployeeProfile(state, actor)
  const targetCanonical = canonicalEmployeeAvatarProfile(state, profile)
  const targetProfiles = [profile, targetCanonical].filter(Boolean)
  if (actorUserId && targetProfiles.some((candidate) => String(candidate.authUserId || '').trim() === actorUserId)) {
    return true
  }
  if ([actorRoleProfile, actorCanonical].filter(Boolean).some((candidate) => targetProfiles.includes(candidate))) {
    return true
  }
  const actorIds = new Set([
    String(actor?.employee_id || actor?.employeeId || '').trim(),
    ...employeeAvatarProfileIds(actorRoleProfile),
    ...employeeAvatarProfileIds(actorCanonical),
  ].filter(Boolean))
  const targetIds = new Set([
    ...employeeAvatarProfileIds(profile),
    ...employeeAvatarProfileIds(targetCanonical),
  ])
  return [...targetIds].some((value) => actorIds.has(value))
}

const employeeAvatarAuthorized = (state, actor, profile) => {
  if (!activeEmployeeAvatarProfile(profile)) return false
  const unit = employeeUnit(profile)
  const physicalStore = activePhysicalStoreForAvatarProfile(state, profile)
  if (actor.role === 'admin') {
    return ['office', 'business_support'].includes(unit) || Boolean(physicalStore)
  }
  if (actor.role === 'business_support') {
    return !['office', 'business_support'].includes(unit) && Boolean(physicalStore)
  }
  if (actor.role === 'store_manager') {
    const actorStore = activePhysicalStoreByIdentifier(state, actor.store_id)
    return !['office', 'business_support'].includes(unit)
      && Boolean(physicalStore)
      && physicalStore === actorStore
  }
  return actor.role === 'employee' && employeeAvatarIsActorIdentity(state, actor, profile)
}

const employeeAvatarMetadata = (state, actor, profile) => {
  const canonical = canonicalEmployeeAvatarProfile(state, profile)
  const profiles = [profile, canonical].filter((candidate, index, records) => (
    candidate && records.indexOf(candidate) === index
  ))
  const ownerIds = [...new Set([
    ...profiles.map((candidate) => String(candidate.authUserId || '').trim()),
    ...(employeeAvatarIsActorIdentity(state, actor, profile)
      ? [String(actor.user_id || actor.id || '').trim()]
      : []),
  ].filter(Boolean))]
  for (const ownerId of ownerIds) {
    const stored = normalizeAccountAvatarMetadata(state.accountSettings?.[ownerId]?.avatar, ownerId)
    if (stored) return stored
  }
  for (const candidate of profiles) {
    for (const ownerId of ownerIds) {
      const stored = ownProfileAvatarMetadata(candidate, ownerId)
      if (stored) return stored
    }
    // With no account owner this helper accepts only the exact
    // legacy-profile-<employeeId> namespace, never an arbitrary object key.
    const legacy = ownProfileAvatarMetadata(candidate, '')
    if (legacy) return legacy
  }
  return null
}

const getEmployeeAccountAvatar = async (request, env, context, employeeId) => {
  const db = getDatabase(env)
  const actor = await requireSession(request, db, context)
  const normalizedEmployeeId = String(employeeId || '').trim()
  if (!/^[A-Za-z0-9_-]{2,80}$/u.test(normalizedEmployeeId)) {
    throw employeeAvatarNotFound()
  }
  let current = actor._globalStateRow || await loadState(db, 'global')
  current = await migrateLegacyAccountAvatars(db, env, actor, context, current)
  const state = normalizeSharedStateForStorage(parseStoredJson(current?.value_json, {}))
  let profile
  try {
    profile = uniqueEmployeeIdentifierRecordMatch({
      records: state.employees,
      identifier: normalizedEmployeeId,
      predicate: isPlainRecord,
      collisionCode: 'EMPLOYEE_AVATAR_PROFILE_COLLISION',
      collisionMessage: 'Định danh hồ sơ ảnh đại diện đang trùng.',
    })?.record || null
  } catch (error) {
    if (error instanceof ApiError && error.code === 'EMPLOYEE_AVATAR_PROFILE_COLLISION') {
      throw employeeAvatarNotFound()
    }
    throw error
  }
  if (!profile || !employeeAvatarAuthorized(state, actor, profile)) throw employeeAvatarNotFound()
  const metadata = employeeAvatarMetadata(state, actor, profile)
  if (!metadata) throw employeeAvatarNotFound()
  const bucket = env?.IDENTITY_IMAGES
  if (!bucket?.get) {
    throw new ApiError(503, 'ACCOUNT_AVATAR_STORAGE_UNAVAILABLE', 'Kho lưu ảnh đại diện chưa được cấu hình.')
  }
  const object = await bucket.get(metadata.key)
  if (!object?.body) throw employeeAvatarNotFound()
  const extension = metadata.contentType === 'image/jpeg' ? 'jpg' : metadata.contentType.split('/')[1]
  const headers = new Headers({
    'Cache-Control': 'private, no-store',
    'Content-Disposition': `inline; filename="avatar.${extension}"`,
    'Content-Security-Policy': "default-src 'none'",
    'Content-Type': metadata.contentType,
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Avatar-Version': String(metadata.version),
  })
  if (Number.isSafeInteger(metadata.size)) headers.set('Content-Length', String(metadata.size))
  if (object.etag) headers.set('ETag', String(object.etag))
  return new Response(object.body, { status: 200, headers })
}

const getIdentityImage = async (request, env, context, employeeId, side) => {
  const db = getDatabase(env)
  const actor = await requireSession(request, db, context)
  const normalizedEmployeeId = String(employeeId || '').trim()
  if (!/^[A-Za-z0-9_-]{2,80}$/u.test(normalizedEmployeeId) || !['front', 'back'].includes(side)) {
    throw new ApiError(404, 'IDENTITY_IMAGE_NOT_FOUND', 'Không tìm thấy ảnh CCCD.')
  }
  const current = await loadState(db, 'global')
  const state = normalizeSharedStateForStorage(parseStoredJson(current?.value_json, {}))
  const profiles = [
    ...(Array.isArray(state.employees) ? state.employees : []),
    ...(Array.isArray(state.deletedEmployees) ? state.deletedEmployees : []),
  ]
  let profile
  try {
    profile = uniqueEmployeeIdentifierRecordMatch({
      records: profiles,
      identifier: normalizedEmployeeId,
      predicate: isPlainRecord,
      collisionCode: 'IDENTITY_IMAGE_PROFILE_COLLISION',
      collisionMessage: 'Định danh hồ sơ ảnh CCCD đang trùng.',
    })?.record || null
  } catch (error) {
    if (error instanceof ApiError && error.code === 'IDENTITY_IMAGE_PROFILE_COLLISION') {
      throw new ApiError(403, 'IDENTITY_IMAGE_FORBIDDEN', 'Bạn không có quyền xem ảnh CCCD này.')
    }
    throw error
  }
  const canonicalProfile = profile
    ? canonicalLinkedEmployeeProfile(profiles, profile, {
        collisionCode: 'IDENTITY_IMAGE_LINK_COLLISION',
        collisionMessage: 'Hồ sơ liên kết của ảnh CCCD đang trùng.',
      })
    : null
  const imageProfiles = [profile, canonicalProfile].filter((candidate, index, records) => (
    candidate && records.indexOf(candidate) === index
  ))
  const actorStore = actor.role === 'store_manager'
    ? activePhysicalStoreByIdentifier(state, actor.store_id)
    : null
  const profileStore = profile ? activePhysicalStoreForAvatarProfile(state, profile) : null
  const authorized = actor.role === 'admin'
    || actor.role === 'business_support'
    || (actor.role === 'store_manager' && Boolean(actorStore) && profileStore === actorStore)
    || (actor.role === 'employee' && profile && employeeAvatarIsActorIdentity(state, actor, profile))
  if (!profile || !['business_support', 'store_manager', 'office', 'store'].includes(employeeUnit(profile)) || !authorized) {
    throw new ApiError(403, 'IDENTITY_IMAGE_FORBIDDEN', 'Bạn không có quyền xem ảnh CCCD này.')
  }
  const imageProfile = imageProfiles.find((candidate) => isPlainRecord(candidate.identityImages?.[side])) || null
  const metadata = isPlainRecord(imageProfile?.identityImages?.[side]) ? imageProfile.identityImages[side] : null
  const key = String(metadata?.key || '')
  const imageProfileId = employeeProfileIdentifier(imageProfile)
  if (!imageProfileId || !key.startsWith(`identity-images/${imageProfileId}/${side}/`)) {
    throw new ApiError(404, 'IDENTITY_IMAGE_NOT_FOUND', 'Không tìm thấy ảnh CCCD.')
  }
  const bucket = env?.IDENTITY_IMAGES
  if (!bucket?.get) {
    throw new ApiError(503, 'IDENTITY_IMAGE_STORAGE_UNAVAILABLE', 'Kho lưu ảnh CCCD chưa được cấu hình.')
  }
  const object = await bucket.get(key)
  if (!object?.body) throw new ApiError(404, 'IDENTITY_IMAGE_NOT_FOUND', 'Không tìm thấy ảnh CCCD.')
  const contentType = ['image/jpeg', 'image/png', 'image/webp'].includes(String(metadata.contentType))
    ? String(metadata.contentType)
    : 'application/octet-stream'
  const size = Number(metadata.size ?? object.size)
  const headers = new Headers({
    'Cache-Control': 'private, no-store',
    'Content-Disposition': `inline; filename="${side}.${contentType === 'image/jpeg' ? 'jpg' : contentType.split('/')[1] || 'bin'}"`,
    'Content-Security-Policy': "default-src 'none'",
    'Content-Type': contentType,
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
  })
  if (Number.isSafeInteger(size) && size >= 0) headers.set('Content-Length', String(size))
  if (object.etag) headers.set('ETag', String(object.etag))
  return new Response(object.body, { status: 200, headers })
}

const listAudit = async (request, env, context, url) => {
  const db = getDatabase(env)
  const user = await requireSession(request, db, context)
  if (!['admin', 'business_support'].includes(user.role)) {
    throw new ApiError(403, 'ROLE_FORBIDDEN', 'Tài khoản không có quyền xem nhật ký hệ thống.')
  }
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit')) || 50))
  const beforeId = Number(url.searchParams.get('beforeId'))
  const orderOnly = user.role === 'business_support'
  const rows = orderOnly
    ? (Number.isInteger(beforeId) && beforeId > 0
        ? await all(db, `
            SELECT * FROM audit_log
            WHERE entity_type = 'order' AND action IN ('order.update', 'order.delete') AND id < ?
            ORDER BY id DESC LIMIT ?
          `, beforeId, limit)
        : await all(db, `
            SELECT * FROM audit_log
            WHERE entity_type = 'order' AND action IN ('order.update', 'order.delete')
            ORDER BY id DESC LIMIT ?
          `, limit))
    : (Number.isInteger(beforeId) && beforeId > 0
        ? await all(db, 'SELECT * FROM audit_log WHERE id < ? ORDER BY id DESC LIMIT ?', beforeId, limit)
        : await all(db, 'SELECT * FROM audit_log ORDER BY id DESC LIMIT ?', limit))
  return jsonResponse(apiPayload(context, {
    audit: rows.map((row) => ({
      id: Number(row.id),
      requestId: row.request_id,
      actorId: row.actor_id,
      actorRole: row.actor_role,
      action: row.action,
      entityType: row.entity_type,
      entityId: row.entity_id,
      before: parseStoredJson(row.before_json),
      after: parseStoredJson(row.after_json),
      metadata: parseStoredJson(row.metadata_json),
      serverTimestamp: row.server_timestamp,
    })),
  }))
}

const addressSuggestionRateKey = (request, actor) => {
  const forwarded = String(request.headers.get('cf-connecting-ip') || '').trim().slice(0, 64)
  return `${String(actor.user_id || actor.id || '')}:${forwarded}`
}

const enforceAddressSuggestionRate = (request, actor, context) => {
  const now = Number.isFinite(Date.parse(context.now)) ? Date.parse(context.now) : Date.now()
  const key = addressSuggestionRateKey(request, actor)
  const previous = addressSuggestionRateWindows.get(key)
  const entry = !previous || now - previous.startedAt >= ADDRESS_SUGGESTION_RATE_WINDOW_MS
    ? { startedAt: now, count: 0 }
    : previous
  entry.count += 1
  addressSuggestionRateWindows.set(key, entry)
  if (addressSuggestionRateWindows.size > 2_000) {
    for (const [candidateKey, window] of addressSuggestionRateWindows) {
      if (now - window.startedAt >= ADDRESS_SUGGESTION_RATE_WINDOW_MS) addressSuggestionRateWindows.delete(candidateKey)
    }
  }
  if (entry.count > ADDRESS_SUGGESTION_RATE_LIMIT) {
    throw new ApiError(429, 'ADDRESS_SUGGESTION_RATE_LIMITED', 'Bạn đã gửi quá nhiều yêu cầu gợi ý địa chỉ. Vui lòng thử lại sau.', {
      retryAfterSeconds: Math.max(1, Math.ceil((entry.startedAt + ADDRESS_SUGGESTION_RATE_WINDOW_MS - now) / 1_000)),
    })
  }
}

const safeAddressContextPart = (value, label) => {
  const text = [...String(value || '').trim()]
    .filter((character) => character.codePointAt(0) >= 32 && character.codePointAt(0) !== 127)
    .join('')
  if (text.length > 120) throw new ApiError(400, 'ADDRESS_QUERY_TOO_LONG', `${label} không được vượt quá 120 ký tự.`)
  return text
}

const getAddressSuggestions = async (request, env, context, url) => {
  const db = getDatabase(env)
  const actor = await requireSession(request, db, context)
  const apiKey = String(env?.GOOGLE_MAPS_API_KEY || '').trim()
  if (!apiKey) {
    return jsonResponse(apiPayload(context, { configured: false, suggestions: [] }))
  }
  const type = String(url.searchParams.get('type') || '').trim().toLowerCase()
  if (!ADDRESS_SUGGESTION_TYPES.has(type)) {
    throw new ApiError(400, 'ADDRESS_TYPE_INVALID', 'Loại gợi ý địa chỉ phải là province, ward hoặc street.')
  }
  const query = safeAddressContextPart(url.searchParams.get('query'), 'Nội dung tìm kiếm')
  const province = safeAddressContextPart(url.searchParams.get('province'), 'Tỉnh/thành phố')
  const ward = safeAddressContextPart(url.searchParams.get('ward'), 'Phường/xã')
  if (query.length < 2) {
    return jsonResponse(apiPayload(context, { configured: true, suggestions: [] }))
  }
  enforceAddressSuggestionRate(request, actor, context)
  const contextParts = type === 'province'
    ? ['Việt Nam']
    : (type === 'ward' ? [province, 'Việt Nam'] : [ward, province, 'Việt Nam'])
  const input = [query, ...contextParts.filter(Boolean)].join(', ').slice(0, 400)
  const sessionToken = String(url.searchParams.get('sessionToken') || '').trim()
  if (sessionToken && !/^[A-Za-z0-9_-]{8,80}$/u.test(sessionToken)) {
    throw new ApiError(400, 'ADDRESS_SESSION_TOKEN_INVALID', 'Mã phiên gợi ý địa chỉ không hợp lệ.')
  }
  const upstreamBody = {
    input,
    languageCode: 'vi',
    regionCode: 'vn',
    includedRegionCodes: ['vn'],
    ...(sessionToken ? { sessionToken } : {}),
  }
  let upstream
  try {
    upstream = await fetch('https://places.googleapis.com/v1/places:autocomplete', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': [
          'suggestions.placePrediction.placeId',
          'suggestions.placePrediction.text.text',
          'suggestions.placePrediction.structuredFormat.mainText.text',
          'suggestions.placePrediction.structuredFormat.secondaryText.text',
        ].join(','),
      },
      body: JSON.stringify(upstreamBody),
      ...(typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
        ? { signal: AbortSignal.timeout(5_000) }
        : {}),
    })
  } catch {
    throw new ApiError(502, 'ADDRESS_PROVIDER_UNAVAILABLE', 'Dịch vụ gợi ý địa chỉ tạm thời không khả dụng.')
  }
  if (!upstream.ok) {
    throw new ApiError(502, 'ADDRESS_PROVIDER_ERROR', 'Dịch vụ gợi ý địa chỉ không thể xử lý yêu cầu.')
  }
  let result
  try {
    result = await upstream.json()
  } catch {
    throw new ApiError(502, 'ADDRESS_PROVIDER_INVALID_RESPONSE', 'Dịch vụ gợi ý địa chỉ trả về dữ liệu không hợp lệ.')
  }
  const suggestions = (Array.isArray(result?.suggestions) ? result.suggestions : []).flatMap((entry) => {
    const prediction = entry?.placePrediction
    const label = String(prediction?.text?.text || '').trim()
    if (!label) return []
    const value = String(prediction?.structuredFormat?.mainText?.text || label).trim()
    return [{
      label: label.slice(0, 500),
      value: value.slice(0, 200),
      placeId: String(prediction?.placeId || '').slice(0, 200),
      ...(type === 'province' ? { province: value.slice(0, 200) } : {}),
      ...(type === 'ward' ? { province, ward: value.slice(0, 200) } : {}),
      ...(type === 'street' ? { province, ward, street: value.slice(0, 200) } : {}),
    }]
  }).slice(0, 8)
  return jsonResponse(apiPayload(context, { configured: true, suggestions }))
}

const methodNotAllowed = (allowed) => {
  throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Phương thức không được hỗ trợ.', { allowed })
}

const handleApi = async (request, env, context, url) => {
  const path = url.pathname
  if (path === '/api/health') {
    if (request.method !== 'GET') return methodNotAllowed(['GET'])
    return jsonResponse(apiPayload(context, {
      service: 'idosi-api',
      databaseConfigured: Boolean(env?.DB?.prepare && env?.DB?.batch),
      identityImageStorageConfigured: Boolean(env?.IDENTITY_IMAGES?.get && env?.IDENTITY_IMAGES?.put),
      accountAvatarStorageConfigured: Boolean(env?.IDENTITY_IMAGES?.get && env?.IDENTITY_IMAGES?.put),
      addressSuggestionsConfigured: Boolean(String(env?.GOOGLE_MAPS_API_KEY || '').trim()),
    }))
  }
  if (path === '/api/bootstrap') {
    if (request.method === 'POST') return bootstrapDatabase(request, env, context)
    if (request.method === 'GET') return getBootstrap(request, env, context, url)
    return methodNotAllowed(['GET', 'POST'])
  }
  if (path === '/api/login') {
    if (request.method !== 'POST') return methodNotAllowed(['POST'])
    return login(request, env, context)
  }
  if (path === '/api/session/role') {
    if (request.method !== 'POST') return methodNotAllowed(['POST'])
    return selectSessionRole(request, env, context)
  }
  if (path === '/api/state') {
    if (request.method !== 'GET') return methodNotAllowed(['GET'])
    return getState(request, env, context, url)
  }
  if (path === '/api/state-metadata') {
    if (request.method !== 'GET') return methodNotAllowed(['GET'])
    return getStateMetadata(request, env, context, url)
  }
  if (path === '/api/revenue-bonus/live') {
    if (request.method !== 'GET') return methodNotAllowed(['GET'])
    return getRevenueBonusLive(request, env, context, url)
  }
  if (path === '/api/command') {
    if (request.method !== 'POST') return methodNotAllowed(['POST'])
    return executeCommand(request, env, context)
  }
  if (path === '/api/logout') {
    if (request.method !== 'POST') return methodNotAllowed(['POST'])
    return logout(request, env, context)
  }
  if (path === '/api/users') {
    if (request.method !== 'GET') return methodNotAllowed(['GET'])
    return listUsers(request, env, context)
  }
  if (path === '/api/address-suggestions') {
    if (request.method !== 'GET') return methodNotAllowed(['GET'])
    return getAddressSuggestions(request, env, context, url)
  }
  if (path === '/api/account-avatar') {
    if (request.method !== 'GET') return methodNotAllowed(['GET'])
    return getAccountAvatar(request, env, context)
  }
  const accountAvatarMatch = path.match(/^\/api\/account-avatars\/([^/]+)$/u)
  if (accountAvatarMatch) {
    if (request.method !== 'GET') return methodNotAllowed(['GET'])
    let employeeId
    try {
      employeeId = decodeURIComponent(accountAvatarMatch[1])
    } catch {
      throw new ApiError(404, 'EMPLOYEE_AVATAR_NOT_FOUND', 'Không tìm thấy ảnh đại diện nhân viên.')
    }
    return getEmployeeAccountAvatar(request, env, context, employeeId)
  }
  const identityImageMatch = path.match(/^\/api\/identity-images\/([^/]+)\/(front|back)$/u)
  if (identityImageMatch) {
    if (request.method !== 'GET') return methodNotAllowed(['GET'])
    let employeeId
    try {
      employeeId = decodeURIComponent(identityImageMatch[1])
    } catch {
      throw new ApiError(404, 'IDENTITY_IMAGE_NOT_FOUND', 'Không tìm thấy ảnh CCCD.')
    }
    return getIdentityImage(request, env, context, employeeId, identityImageMatch[2])
  }
  if (path === '/api/audit') {
    if (request.method !== 'GET') return methodNotAllowed(['GET'])
    return listAudit(request, env, context, url)
  }
  throw new ApiError(404, 'API_NOT_FOUND', 'Không tìm thấy API.')
}

const fetchAsset = (request, env) => {
  if (!env?.ASSETS?.fetch) return Promise.resolve(new Response('Static asset binding is unavailable.', { status: 503 }))
  return env.ASSETS.fetch(request)
}

const handleStatic = async (request, env) => {
  const response = await fetchAsset(request, env)
  if (response.status !== 404 || !['GET', 'HEAD'].includes(request.method)) return response
  const url = new URL(request.url)
  if (url.pathname.includes('.')) return response
  url.pathname = '/index.html'
  return fetchAsset(new Request(url, request), env)
}

const worker = {
  async fetch(request, env) {
    const url = new URL(request.url)
    if (!url.pathname.startsWith(API_PREFIX)) return handleStatic(request, env)
    const context = {
      now: new Date().toISOString(),
      requestId: crypto.randomUUID(),
    }
    try {
      return await handleApi(request, env, context, url)
    } catch (error) {
      if (error instanceof ApiError) {
        return jsonResponse({
          ok: false,
          error: { code: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) },
          serverTime: context.now,
          requestId: context.requestId,
        }, error.status)
      }
      console.error('Unhandled IDOSI worker error', error)
      return jsonResponse({
        ok: false,
        error: { code: 'INTERNAL_ERROR', message: 'Máy chủ không thể xử lý yêu cầu.' },
        serverTime: context.now,
        requestId: context.requestId,
      }, 500)
    }
  },
}

export default worker
