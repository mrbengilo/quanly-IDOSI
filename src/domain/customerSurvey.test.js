import { describe, expect, it } from 'vitest'
import { customerSurveySummary } from './customerSurvey'

describe('customerSurveySummary', () => {
  it('filters by store/month and produces stable customer insights', () => {
    const result = customerSurveySummary([
      { id: '1', storeId: 'S01', createdAt: '2026-08-21T11:14:59+07:00', gender: 'Nữ', customerAge: 22, acquisitionChannel: 'Tiktok', occupation: 'Dữ liệu cũ' },
      { id: '2', storeId: 'S01', createdAt: '2026-08-21T11:15:00+07:00', gender: 'Nữ', customerAge: 28, acquisitionChannel: 'Facebook', occupation: 'Nhân viên' },
      { id: '3', storeId: 'S01', createdAt: '2026-08-21T12:00:00+07:00', gender: 'Nam', customerAge: 23, acquisitionChannel: 'TikTok', occupation: 'Nhân viên' },
      { id: '4', storeId: 'S02', createdAt: '2026-08-03T08:00:00+07:00', gender: 'Nam', customerAge: 50, acquisitionChannel: 'Zalo', occupation: 'Kinh doanh' },
      { id: '5', storeId: 'S01', createdAt: '2026-07-03T08:00:00+07:00', gender: 'Nam', customerAge: 40, acquisitionChannel: 'Zalo', occupation: 'Khác' },
      { id: '6', storeId: 'S01', createdAt: '2026-08-03T08:00:00+07:00', deletedAt: '2026-08-04T00:00:00Z' },
    ], { period: '2026-08', storeId: 'S01' })

    expect(result.total).toBe(3)
    expect(result.genders).toMatchObject({ Nữ: 2, Nam: 1 })
    expect(result.channels).toMatchObject({ TikTok: 2, Facebook: 1 })
    expect(result.ageRange).toEqual({ min: 22, max: 28 })
    expect(result.occupationTotal).toBe(2)
    expect(result.occupations).toEqual({ 'Nhân viên': 2 })
    expect(result.insights).toMatchObject({ topGender: 'Nữ', topChannel: 'TikTok', topAge: '18–24', topOccupation: 'Nhân viên' })
  })
})
