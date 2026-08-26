import { describe, expect, it } from 'vitest'
import {
  activeWorkCatalogItems,
  createWorkCatalogItemId,
  decodeWorkCatalogSnapshot,
  decodeWorkCatalogSnapshots,
  normalizeWorkCatalogItem,
  snapshotActiveWorkCatalogItems,
  softDeleteWorkCatalogItem,
  validateWorkCatalogItem,
  WORK_CATALOG_KIND,
  WORK_CATALOG_TARGET,
  workCatalogClaimKey,
  workCatalogProgressKey,
} from './workCatalog'

const definition = (overrides = {}) => ({
  id: 'catalog.store.fixed.open-shop',
  code: 'store.fixed.open-shop',
  kind: WORK_CATALOG_KIND.FIXED_TASK,
  targetGroup: WORK_CATALOG_TARGET.STORE,
  storeId: 'STORE-01',
  shiftId: 'SHIFT-AM',
  shiftName: 'Ca sáng',
  name: 'Mở cửa hàng',
  amountVnd: 0,
  sortOrder: 10,
  active: true,
  version: 1,
  effectiveFrom: '2026-08-01',
  effectiveTo: null,
  ...overrides,
})

describe('work catalog definition contract', () => {
  it('normalizes fixed work into a required checkbox definition', () => {
    expect(normalizeWorkCatalogItem(definition())).toEqual(expect.objectContaining({
      id: 'catalog.store.fixed.open-shop',
      code: 'store.fixed.open-shop',
      kind: WORK_CATALOG_KIND.FIXED_TASK,
      targetGroup: WORK_CATALOG_TARGET.STORE,
      amountVnd: 0,
      required: true,
      active: true,
    }))
    expect(validateWorkCatalogItem(definition())).toBe(true)
  })

  it('requires stable codes and deterministically creates missing ids', () => {
    expect(normalizeWorkCatalogItem(definition({
      id: undefined,
      code: 'Office.Reward.Clean',
      targetGroup: 'office',
      storeId: null,
    }))).toMatchObject({
      id: 'work-catalog:office:fixed_task:office.reward.clean',
      code: 'office.reward.clean',
    })
    expect(createWorkCatalogItemId({
      targetGroup: 'businessSupport',
      kind: 'reward_task',
      code: 'HTKD.REWARD.ON_TIME',
    })).toBe('work-catalog:business_support:reward_task:htkd.reward.on_time')
    expect(() => normalizeWorkCatalogItem(definition({ code: 'mã có khoảng trắng' }))).toThrow(/stable identifier/u)
  })

  it('allows zero-value fixed work but requires positive integer VND for rewards and violations', () => {
    expect(normalizeWorkCatalogItem(definition({ amountVnd: 0 })).amountVnd).toBe(0)
    expect(() => normalizeWorkCatalogItem(definition({
      kind: WORK_CATALOG_KIND.REWARD_TASK,
      amountVnd: 0,
    }))).toThrow(/positive integer/u)
    expect(() => normalizeWorkCatalogItem(definition({
      kind: WORK_CATALOG_KIND.VIOLATION,
      amountVnd: 1.5,
    }))).toThrow(/safe integer/u)
    expect(normalizeWorkCatalogItem(definition({
      kind: WORK_CATALOG_KIND.REWARD_TASK,
      amountVnd: 2_000,
    }))).toMatchObject({ amountVnd: 2_000, required: false })
  })

  it('rejects invalid target scope', () => {
    expect(() => normalizeWorkCatalogItem(definition({
      targetGroup: WORK_CATALOG_TARGET.OFFICE,
      storeId: 'STORE-01',
    }))).toThrow(/storeId is only valid/u)
  })

  it('rejects inverted effective dates', () => {
    expect(() => normalizeWorkCatalogItem(definition({
      effectiveFrom: '2026-09-01',
      effectiveTo: '2026-08-31',
    }))).toThrow(/must not be after/u)
  })
})

describe('active work catalog selection', () => {
  const globalFixed = definition({
    id: 'fixed-global',
    code: 'store.fixed.global',
    storeId: null,
    shiftId: null,
    shiftName: null,
    sortOrder: 20,
    name: 'Nhiệm vụ chung',
  })
  const storeFixed = definition({ sortOrder: 5, name: 'Mở cửa' })
  const reward = definition({
    id: 'reward-am',
    code: 'store.reward.am',
    kind: WORK_CATALOG_KIND.REWARD_TASK,
    amountVnd: 5_000,
    sortOrder: 30,
    name: 'Thưởng ca sáng',
  })
  const violation = definition({
    id: 'violation-late',
    code: 'store.violation.late',
    kind: WORK_CATALOG_KIND.VIOLATION,
    amountVnd: 2_000,
    shiftId: null,
    shiftName: null,
    name: 'Đi trễ',
  })

  it('filters target, store, shift and inclusive dates with deterministic sorting', () => {
    const items = [
      reward,
      globalFixed,
      storeFixed,
      violation,
      definition({ id: 'other-store', code: 'store.fixed.other', storeId: 'STORE-02', name: 'Cửa hàng khác' }),
      definition({
        id: 'expired',
        code: 'store.fixed.expired',
        effectiveFrom: '2026-07-01',
        effectiveTo: '2026-07-31',
        name: 'Hết hạn',
      }),
      definition({ id: 'future', code: 'store.fixed.future', effectiveFrom: '2026-09-01', name: 'Tương lai' }),
    ]
    expect(activeWorkCatalogItems(items, {
      targetGroup: 'store',
      storeId: 'STORE-01',
      shiftId: 'SHIFT-AM',
      date: '2026-08-26',
    }).map((item) => item.id)).toEqual([
      'catalog.store.fixed.open-shop',
      'violation-late',
      'fixed-global',
      'reward-am',
    ])
  })

  it('uses only the latest version and honors soft deletion', () => {
    const deleted = {
      ...storeFixed,
      active: false,
      deletedAt: '2026-08-20T00:00:00.000Z',
      version: 2,
    }
    expect(activeWorkCatalogItems([storeFixed, deleted, globalFixed], {
      targetGroup: 'store',
      storeId: 'STORE-01',
      shiftId: 'SHIFT-AM',
      date: '2026-08-26',
    }).map((item) => item.id)).toEqual(['fixed-global'])
  })

  it('matches normalized Vietnamese shift names only when stable ids are absent', () => {
    expect(activeWorkCatalogItems([definition({ shiftId: null, shiftName: 'Ca Chiều' })], {
      targetGroup: 'store',
      storeId: 'STORE-01',
      shiftName: 'ca chieu',
      date: '2026-08-26',
    })).toHaveLength(1)
    expect(activeWorkCatalogItems([definition({ shiftId: 'SHIFT-AM', shiftName: 'Ca chung' })], {
      targetGroup: 'store',
      storeId: 'STORE-01',
      shiftId: 'SHIFT-PM',
      shiftName: 'Ca chung',
      date: '2026-08-26',
    })).toHaveLength(0)
  })

  it('snapshots only fixed and reward work with immutable required semantics', () => {
    const snapshot = snapshotActiveWorkCatalogItems({
      items: [reward, globalFixed, storeFixed, violation],
      targetGroup: 'store',
      storeId: 'STORE-01',
      shiftId: 'SHIFT-AM',
      date: '2026-08-26T17:30:00+07:00',
    })
    expect(snapshot.map((item) => item.catalogItemId)).toEqual([
      'catalog.store.fixed.open-shop',
      'fixed-global',
      'reward-am',
    ])
    expect(snapshot[0]).toMatchObject({
      name: 'Mở cửa',
      amountVnd: 0,
      required: true,
      optional: false,
      checked: false,
      effectiveDate: '2026-08-26',
    })
    expect(snapshot.at(-1)).toMatchObject({ amountVnd: 5_000, required: false, optional: true })
    expect(Object.isFrozen(snapshot)).toBe(true)
    expect(Object.isFrozen(snapshot[0])).toBe(true)
  })
})

describe('work catalog lifecycle and historical compatibility', () => {
  it('soft deletes with audit/version metadata without mutating its source', () => {
    const source = definition()
    const deleted = softDeleteWorkCatalogItem(source, {
      at: '2026-08-26T09:00:00+07:00',
      by: 'ADMIN-01',
      reason: 'Ngừng áp dụng',
    })
    expect(deleted).toMatchObject({
      active: false,
      version: 2,
      deletedAt: '2026-08-26T02:00:00.000Z',
      deletedBy: 'ADMIN-01',
      deleteReason: 'Ngừng áp dụng',
    })
    expect(source).toMatchObject({ active: true, version: 1 })
    expect(softDeleteWorkCatalogItem(deleted, { at: '2026-08-27T00:00:00Z' })).toEqual(deleted)
    expect(() => softDeleteWorkCatalogItem(source, { at: 'invalid' })).toThrow(/valid timestamp/u)
  })

  it('records delete audit metadata for a previously disabled definition', () => {
    expect(softDeleteWorkCatalogItem(definition({ active: false }), {
      at: '2026-08-26T10:00:00+07:00',
      by: 'HTKD-01',
    })).toMatchObject({
      active: false,
      deletedAt: '2026-08-26T03:00:00.000Z',
      deletedBy: 'HTKD-01',
      version: 2,
    })
  })

  it('decodes legacy aliases without applying new positive-amount validation', () => {
    expect(decodeWorkCatalogSnapshot({
      checklistTaskId: 'STORE-CHECKLIST-MORNING-01',
      description: 'Bật đèn, quạt, mở nhạc',
      templateId: 'STORE-CHECKLIST-MORNING',
      position: 1,
      checked: true,
    })).toMatchObject({
      catalogItemId: 'STORE-CHECKLIST-MORNING-01',
      name: 'Bật đèn, quạt, mở nhạc',
      amountVnd: 0,
      required: true,
      checked: true,
      completed: true,
      legacy: true,
    })
    expect(decodeWorkCatalogSnapshot({
      code: 'store.reward.old',
      label: 'Thưởng cũ',
      kind: 'REWARD_TASK',
    })).toMatchObject({
      catalogCode: 'store.reward.old',
      kind: WORK_CATALOG_KIND.REWARD_TASK,
      amountVnd: 0,
      required: false,
    })
  })

  it('decodes JSON arrays with stable generated legacy identifiers', () => {
    const encoded = JSON.stringify(['Quét nhà', { title: 'Lau nhà', done: true }])
    const first = decodeWorkCatalogSnapshots(encoded)
    const second = decodeWorkCatalogSnapshots(encoded)
    expect(first).toHaveLength(2)
    expect(first.map((item) => item.catalogItemId)).toEqual(second.map((item) => item.catalogItemId))
    expect(first[0].catalogItemId).toMatch(/^legacy-work-item:/u)
    expect(first[1]).toMatchObject({ name: 'Lau nhà', checked: true })
  })
})

describe('deterministic progress and reward claim identities', () => {
  const input = {
    employeeId: 'EMP-01',
    workDate: '2026-08-26',
    shiftRef: 'ATTENDANCE-01',
    catalogItemId: 'catalog.store.reward.clean',
  }

  it('builds repeatable keys from the work occurrence and catalog item', () => {
    expect(workCatalogProgressKey(input)).toBe(
      'work-catalog-progress:v1:EMP-01:2026-08-26:ATTENDANCE-01:catalog.store.reward.clean',
    )
    expect(workCatalogClaimKey(input)).toBe(
      'work-catalog-claim:v1:work-catalog-progress:v1:EMP-01:2026-08-26:ATTENDANCE-01:catalog.store.reward.clean',
    )
    expect(workCatalogProgressKey({ ...input, catalogItemId: 'catalog.store.reward.other' }))
      .not.toBe(workCatalogProgressKey(input))
  })

  it('rejects incomplete identity inputs instead of creating ambiguous keys', () => {
    expect(() => workCatalogProgressKey({ ...input, employeeId: '' })).toThrow(/employeeId/u)
    expect(() => workCatalogProgressKey({ ...input, workDate: 'not-a-date' })).toThrow(/workDate/u)
  })
})
