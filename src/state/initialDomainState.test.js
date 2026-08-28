import { describe, expect, it } from 'vitest'
import { DEFAULT_STAFF_WORK_CATALOG_ITEMS } from '../domain/compensationPolicies'
import { DOMAIN_SCHEMA_VERSION, migrateDomainState } from './initialDomainState'

describe('domain state migration', () => {
  it('removes retired KPI policy fields while preserving unrelated persisted data', () => {
    const persistedCompensation = [{ id: 'CMP-1', amountVnd: 35 }]
    const persistedViolations = [{ id: 'VIO-1', amountVnd: 50_000 }]
    const persistedRevenue = [{ id: 'RBD-1', storeId: 'CH001' }]
    const stored = {
      schemaVersion: 2,
      stateVersion: 7,
      orders: [{ id: 'ORD-1', amount: 35 }],
      compensationEntries: persistedCompensation,
      violations: persistedViolations,
      revenueBonusDaily: persistedRevenue,
      policies: {
        lateToleranceMinutes: 15,
        employeeKpiRates: { from30000: 5 },
        managerKpiRate: 2,
        attendanceEvaluation: { improveMinLateCount: 4 },
      },
    }

    const migrated = migrateDomainState(stored, { stores: [], imports: [] })

    expect(migrated.schemaVersion).toBe(DOMAIN_SCHEMA_VERSION)
    expect(migrated.orders).toEqual(stored.orders)
    expect(migrated.compensationEntries).toBe(persistedCompensation)
    expect(migrated.violations).toBe(persistedViolations)
    expect(migrated.revenueBonusDaily).toBe(persistedRevenue)
    expect(migrated.policies).not.toHaveProperty('employeeKpiRates')
    expect(migrated.policies).not.toHaveProperty('managerKpiRate')
    expect(migrated.policies.lateToleranceMinutes).toBe(15)
    expect(migrated.policies.attendanceEvaluation.improveMinLateCount).toBe(4)
  })

  it('initializes every compensation and reconciliation collection for older states', () => {
    const migrated = migrateDomainState({ schemaVersion: 2, stateVersion: 3 }, { stores: [], imports: [] })

    expect(migrated).toMatchObject({
      storeEmployeeSalaryConfigs: [],
      staffWorkCatalogSeedVersion: 1,
      workCatalogProgress: [],
      storeShiftTaskTemplates: [],
      compensationEntries: [],
      violations: [],
      revenueBonusDaily: [],
      revenueBonusAllocations: [],
      teamRewardClaims: [],
      teamRewardParticipants: [],
      periodReconciliations: [],
      jobRuns: [],
    })
    expect(migrated.workCatalogItems).toHaveLength(13)
    expect(migrated.workCatalogItems).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'htkd.reward.on_time', amountVnd: 3_000 }),
      expect.objectContaining({ code: 'office.reward.clip_over_100k_views_team', amountVnd: 350_000 }),
      expect.objectContaining({ code: 'office.violation.forgot_attendance', amountVnd: 3_000 }),
    ]))
  })

  it('seeds the staff catalog once without overwriting an existing item or restoring removed items later', () => {
    const customized = { ...DEFAULT_STAFF_WORK_CATALOG_ITEMS[0], name: 'Tên đã chỉnh', amountVnd: 9_000 }
    const first = migrateDomainState({ schemaVersion: 4, workCatalogItems: [customized] }, { stores: [], imports: [] })
    expect(first.workCatalogItems).toHaveLength(13)
    expect(first.workCatalogItems.find((item) => item.code === customized.code)).toBe(customized)

    const afterAdminRemoval = migrateDomainState({
      ...first,
      workCatalogItems: first.workCatalogItems.filter((item) => item.code !== 'office.violation.late'),
    }, { stores: [], imports: [] })
    expect(afterAdminRemoval.workCatalogItems.some((item) => item.code === 'office.violation.late')).toBe(false)
  })
})
