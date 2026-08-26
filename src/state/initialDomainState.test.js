import { describe, expect, it } from 'vitest'
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
      workCatalogItems: [],
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
  })
})
