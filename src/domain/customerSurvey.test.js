import { describe, expect, it } from 'vitest'
import { customerSurveySummary } from './customerSurvey'
import { DEFAULT_ORDER_INFORMATION_OPTIONS } from './orderInformationSettings'

describe('customerSurveySummary', () => {
  it('filters by store/month and produces stable customer insights', () => {
    const result = customerSurveySummary([
      { id: '1', storeId: 'S01', createdAt: '2026-08-21T11:14:59+07:00', gender: 'Nữ', customerAge: 22, acquisitionChannel: 'Tiktok', occupation: 'Dữ liệu cũ' },
      { id: '2', storeId: 'S01', createdAt: '2026-08-21T11:15:00+07:00', gender: 'Nữ', customerAge: 28, acquisitionChannel: 'Facebook', occupation: 'Nhân viên VP' },
      { id: '3', storeId: 'S01', createdAt: '2026-08-21T12:00:00+07:00', gender: 'Nam', customerAge: 23, acquisitionChannel: 'TikTok', occupation: 'Nhân viên VP' },
      { id: 'legacy-new-time', storeId: 'S01', createdAt: '2026-08-21T12:30:00+07:00', gender: 'Nam', customerAge: 31, acquisitionChannel: 'Zalo', occupation: 'nhân viên' },
      { id: '4', storeId: 'S02', createdAt: '2026-08-03T08:00:00+07:00', gender: 'Nam', customerAge: 50, acquisitionChannel: 'Zalo', occupation: 'Kinh doanh' },
      { id: '5', storeId: 'S01', createdAt: '2026-07-03T08:00:00+07:00', gender: 'Nam', customerAge: 40, acquisitionChannel: 'Zalo', occupation: 'Khác' },
      { id: '6', storeId: 'S01', createdAt: '2026-08-03T08:00:00+07:00', deletedAt: '2026-08-04T00:00:00Z' },
    ], { period: '2026-08', storeId: 'S01' })

    expect(result.total).toBe(4)
    expect(result.genders).toMatchObject({ Nữ: 2, Nam: 2 })
    expect(result.channels).toMatchObject({ TikTok: 2, Facebook: 1, Zalo: 1 })
    expect(result.ageRange).toEqual({ min: 22, max: 31 })
    expect(result.occupationTotal).toBe(2)
    expect(result.occupations).toEqual({ 'Nhân viên VP': 2 })
    expect(result.insights).toMatchObject({ topGender: 'Nam', topChannel: 'TikTok', topAge: '18–24', topOccupation: 'Nhân viên VP' })
  })

  it('keeps an inactive configured occupation in historical statistics', () => {
    const occupationOptions = DEFAULT_ORDER_INFORMATION_OPTIONS.map((option) => (
      option.label === 'Kỹ sư' ? { ...option, active: false, deletedAt: '2026-08-24T00:00:00+07:00' } : option
    ))
    const result = customerSurveySummary([
      { id: '1', createdAt: '2026-08-22T08:00:00+07:00', occupation: 'Kỹ sư' },
      { id: '2', createdAt: '2026-08-22T09:00:00+07:00', occupation: 'Giá trị không cấu hình' },
    ], { occupationOptions })

    expect(result.occupations).toEqual({ 'Kỹ sư': 1 })
    expect(result.occupationTotal).toBe(1)
  })
})
