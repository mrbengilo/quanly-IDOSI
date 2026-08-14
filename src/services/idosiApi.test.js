import { describe, expect, it } from 'vitest'
import { apiPolicyEntries, apiPolicyMap } from './idosiApi'

describe('IDOSI policy API mapping', () => {
  it('round-trips all attendance evaluation thresholds', () => {
    const policies = {
      lateToleranceMinutes: 10,
      earlyCheckInLimitMinutes: 120,
      employeeKpiRates: { from30000: 5, from15000: 3, from7000: 1 },
      attendanceEvaluation: { maintainMaxLateCount: 2, improveMinLateCount: 4, improveMinLateMinutes: 45 },
    }
    const records = apiPolicyEntries(policies).map(([key, value]) => ({ key, value }))
    expect(apiPolicyMap(records)).toMatchObject({
      attendanceEvaluation: { maintainMaxLateCount: 2, improveMinLateCount: 4, improveMinLateMinutes: 45 },
    })
  })
})
