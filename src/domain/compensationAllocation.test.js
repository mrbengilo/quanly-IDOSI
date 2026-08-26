import { describe, expect, it } from 'vitest'
import { allocateByLargestRemainder } from './compensationAllocation'

describe('largest-remainder VND allocation', () => {
  it('preserves the whole integer pool and breaks equal remainders by participant id', () => {
    expect(allocateByLargestRemainder({
      poolVnd: 10,
      participants: [
        { id: 'B', weightUnits: 1 },
        { id: 'C', weightUnits: 1 },
        { id: 'A', weightUnits: 1 },
      ],
    })).toEqual({
      poolVnd: 10,
      totalWeightUnits: 3,
      allocatedVnd: 10,
      unallocatedVnd: 0,
      allocations: [
        { id: 'A', weightUnits: 1, amountVnd: 4 },
        { id: 'B', weightUnits: 1, amountVnd: 3 },
        { id: 'C', weightUnits: 1, amountVnd: 3 },
      ],
    })
  })

  it('is independent of participant input order', () => {
    const first = allocateByLargestRemainder({
      poolVnd: 10,
      participants: [{ id: 'C', weightUnits: 3 }, { id: 'A', weightUnits: 1 }, { id: 'B', weightUnits: 2 }],
    })
    const second = allocateByLargestRemainder({
      poolVnd: 10,
      participants: [{ id: 'B', weightUnits: 2 }, { id: 'C', weightUnits: 3 }, { id: 'A', weightUnits: 1 }],
    })
    expect(first).toEqual(second)
    expect(first.allocations).toEqual([
      { id: 'A', weightUnits: 1, amountVnd: 2 },
      { id: 'B', weightUnits: 2, amountVnd: 3 },
      { id: 'C', weightUnits: 3, amountVnd: 5 },
    ])
  })

  it('deduplicates identical participant rows before allocating', () => {
    expect(allocateByLargestRemainder({
      poolVnd: 1,
      participants: [
        { id: 'B', weightUnits: 1 },
        { id: 'A', weightUnits: 1 },
        { id: 'A', weightUnits: 1 },
      ],
    }).allocations).toEqual([
      { id: 'A', weightUnits: 1, amountVnd: 1 },
      { id: 'B', weightUnits: 1, amountVnd: 0 },
    ])
  })

  it('rejects conflicting duplicate weights instead of silently double-counting them', () => {
    expect(() => allocateByLargestRemainder({
      poolVnd: 100,
      participants: [{ id: 'A', weightUnits: 1 }, { id: 'A', weightUnits: 2 }],
    })).toThrow(/conflicting weightUnits/)
  })

  it('returns zero allocations for a zero pool and rejects an unallocatable positive pool', () => {
    expect(allocateByLargestRemainder({
      poolVnd: 0,
      participants: [{ id: 'B', weightUnits: 0 }, { id: 'A', weightUnits: 0 }],
    }).allocations).toEqual([
      { id: 'A', weightUnits: 0, amountVnd: 0 },
      { id: 'B', weightUnits: 0, amountVnd: 0 },
    ])
    expect(() => allocateByLargestRemainder({
      poolVnd: 1,
      participants: [{ id: 'A', weightUnits: 0 }],
    })).toThrow(RangeError)
  })

  it('uses exact integer arithmetic for a large safe VND pool', () => {
    const result = allocateByLargestRemainder({
      poolVnd: Number.MAX_SAFE_INTEGER,
      participants: [{ id: 'A', weightUnits: 2 }, { id: 'B', weightUnits: 1 }],
    })
    expect(result.allocatedVnd).toBe(Number.MAX_SAFE_INTEGER)
    expect(result.allocations).toEqual([
      { id: 'A', weightUnits: 2, amountVnd: 6_004_799_503_160_661 },
      { id: 'B', weightUnits: 1, amountVnd: 3_002_399_751_580_330 },
    ])
  })

  it.each([
    [{ poolVnd: -1, participants: [] }],
    [{ poolVnd: 1.5, participants: [] }],
    [{ poolVnd: 1, participants: [{ id: '', weightUnits: 1 }] }],
    [{ poolVnd: 1, participants: [{ id: 'A', weightUnits: -1 }] }],
    [{ poolVnd: 1, participants: [{ id: 'A', weightUnits: 0.5 }] }],
  ])('rejects invalid integer allocation input', (input) => {
    expect(() => allocateByLargestRemainder(input)).toThrow(TypeError)
  })
})
