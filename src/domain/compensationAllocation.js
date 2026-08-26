const nonNegativeSafeInteger = (value, field) => {
  const normalized = Number(value)
  if (!Number.isSafeInteger(normalized) || normalized < 0) {
    throw new TypeError(`${field} must be a non-negative safe integer.`)
  }
  return normalized
}

const participantId = (value, field) => {
  const normalized = String(value ?? '').trim()
  if (!normalized) throw new TypeError(`${field} is required.`)
  return normalized
}

const compareParticipantIds = (left, right) => {
  if (left < right) return -1
  if (left > right) return 1
  return 0
}

const normalizeParticipants = (participants) => {
  if (!Array.isArray(participants)) throw new TypeError('participants must be an array.')
  const unique = new Map()
  participants.forEach((participant, index) => {
    const id = participantId(participant?.id, `participants[${index}].id`)
    const weightUnits = nonNegativeSafeInteger(
      participant?.weightUnits,
      `participants[${index}].weightUnits`,
    )
    const existing = unique.get(id)
    if (existing && existing.weightUnits !== weightUnits) {
      throw new TypeError(`Duplicate participant ${id} has conflicting weightUnits.`)
    }
    if (!existing) unique.set(id, { id, weightUnits })
  })
  return [...unique.values()].sort((left, right) => compareParticipantIds(left.id, right.id))
}

/**
 * Allocates an integer VND pool without losing remainder đồng.
 * Identical duplicate participant rows are counted once; conflicting duplicates are rejected.
 */
export function allocateByLargestRemainder({ poolVnd, participants = [] } = {}) {
  const normalizedPool = nonNegativeSafeInteger(poolVnd, 'poolVnd')
  const normalizedParticipants = normalizeParticipants(participants)
  const totalWeight = normalizedParticipants.reduce(
    (total, participant) => total + BigInt(participant.weightUnits),
    0n,
  )
  if (totalWeight > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError('Total participant weightUnits exceeds the safe integer range.')
  }

  if (totalWeight === 0n) {
    if (normalizedPool > 0) throw new RangeError('A positive pool requires positive total weightUnits.')
    return {
      poolVnd: normalizedPool,
      totalWeightUnits: 0,
      allocatedVnd: 0,
      unallocatedVnd: 0,
      allocations: normalizedParticipants.map(({ id, weightUnits }) => ({ id, weightUnits, amountVnd: 0 })),
    }
  }

  const pool = BigInt(normalizedPool)
  const provisional = normalizedParticipants.map(({ id, weightUnits }) => {
    const numerator = pool * BigInt(weightUnits)
    return {
      id,
      weightUnits,
      amountVnd: Number(numerator / totalWeight),
      remainder: numerator % totalWeight,
    }
  })
  const baseAllocated = provisional.reduce((total, allocation) => total + allocation.amountVnd, 0)
  const remainderVnd = normalizedPool - baseAllocated
  const remainderOrder = [...provisional].sort((left, right) => {
    if (left.remainder > right.remainder) return -1
    if (left.remainder < right.remainder) return 1
    return compareParticipantIds(left.id, right.id)
  })
  const receivesRemainder = new Set(remainderOrder.slice(0, remainderVnd).map(({ id }) => id))
  const allocations = provisional.map(({ id, weightUnits, amountVnd }) => ({
    id,
    weightUnits,
    amountVnd: amountVnd + (receivesRemainder.has(id) ? 1 : 0),
  }))
  const allocatedVnd = allocations.reduce((total, allocation) => total + allocation.amountVnd, 0)

  return {
    poolVnd: normalizedPool,
    totalWeightUnits: Number(totalWeight),
    allocatedVnd,
    unallocatedVnd: normalizedPool - allocatedVnd,
    allocations,
  }
}
