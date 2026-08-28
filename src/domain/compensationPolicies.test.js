import { describe, expect, it } from 'vitest'
import {
  calculateRevenueBonus,
  calculateTeamMilestoneReward,
  HTKD_REWARDS,
  HTKD_VIOLATIONS,
  OFFICE_REWARDS,
  OFFICE_VIOLATIONS,
  REVENUE_BONUS_PROGRAM_IDS,
  REVENUE_BONUS_PROGRAMS,
  revenueBonusProgramsForStore,
  selectHighestTeamMilestone,
  STORE_VIOLATIONS,
  STORE_WORK_REWARDS,
  TEAM_MILESTONE_PROGRAM_IDS,
  TEAM_MILESTONE_PROGRAMS,
  WORKBOOK_COMPENSATION_POLICY,
} from './compensationPolicies'

const reward = (items, code) => items.find((item) => item.code === code)
const amountMap = (items) => Object.fromEntries(
  items.filter((item) => item.amountVnd != null).map((item) => [item.code, item.amountVnd]),
)

describe('canonical revenue bonus programs', () => {
  it('keeps stable program ids and frozen workbook policies', () => {
    expect(REVENUE_BONUS_PROGRAM_IDS).toEqual({
      DOSII_DAILY: 'revenue-bonus.store-dosii-daily.v1',
      SM_DAILY: 'revenue-bonus.store-sm-daily.v1',
    })
    expect(Object.isFrozen(REVENUE_BONUS_PROGRAMS)).toBe(true)
    expect(Object.isFrozen(REVENUE_BONUS_PROGRAMS[REVENUE_BONUS_PROGRAM_IDS.DOSII_DAILY].tiers)).toBe(true)
  })

  it('maps SM and DOSII store identities to one canonical program pair', () => {
    expect(revenueBonusProgramsForStore({ name: 'SM TNV' })).toEqual({
      programId: REVENUE_BONUS_PROGRAM_IDS.SM_DAILY,
      milestoneProgramId: TEAM_MILESTONE_PROGRAM_IDS.SM_DAILY_REVENUE,
    })
    expect(revenueBonusProgramsForStore({ name: 'Dosii Nguyễn Trãi' })).toEqual({
      programId: REVENUE_BONUS_PROGRAM_IDS.DOSII_DAILY,
      milestoneProgramId: TEAM_MILESTONE_PROGRAM_IDS.DOSII_DAILY_REVENUE,
    })
  })

  it('recognizes the canonical SM234 store shape even when its display name uses IDOSI', () => {
    expect(revenueBonusProgramsForStore({
      id: 'SM234',
      short: 'SM234',
      name: 'IDOSI 234',
    })).toEqual({
      programId: REVENUE_BONUS_PROGRAM_IDS.SM_DAILY,
      milestoneProgramId: TEAM_MILESTONE_PROGRAM_IDS.SM_DAILY_REVENUE,
    })
  })

  it.each([
    [0, null, 0, 0],
    [1_499_999, null, 0, 0],
    [1_500_000, 'dosii.daily.1_500_000_through_2_000_000', 100, 15_000],
    [2_000_000, 'dosii.daily.1_500_000_through_2_000_000', 100, 20_000],
    [2_000_001, 'dosii.daily.over_2_000_000_through_4_000_000', 200, 40_000],
    [4_000_000, 'dosii.daily.over_2_000_000_through_4_000_000', 200, 80_000],
    [4_000_001, 'dosii.daily.over_4_000_000', 400, 160_000],
  ])('applies exact DOSII boundary %s VND', (revenueVnd, tierId, rateBasisPoints, bonusVnd) => {
    expect(calculateRevenueBonus({
      programId: REVENUE_BONUS_PROGRAM_IDS.DOSII_DAILY,
      revenueVnd,
    })).toMatchObject({ revenueVnd, tierId, rateBasisPoints, bonusVnd })
  })

  it.each([
    [0, null, 0, 0],
    [2_499_999, null, 0, 0],
    [2_500_000, 'sm.daily.2_500_000_through_6_000_000', 400, 100_000],
    [6_000_000, 'sm.daily.2_500_000_through_6_000_000', 400, 240_000],
    [6_000_001, 'sm.daily.over_6_000_000_through_12_000_000', 600, 360_000],
    [12_000_000, 'sm.daily.over_6_000_000_through_12_000_000', 600, 720_000],
    [12_000_001, 'sm.daily.over_12_000_000', 700, 840_000],
  ])('applies exact SM boundary %s VND', (revenueVnd, tierId, rateBasisPoints, bonusVnd) => {
    expect(calculateRevenueBonus({
      programId: REVENUE_BONUS_PROGRAM_IDS.SM_DAILY,
      revenueVnd,
    })).toMatchObject({ revenueVnd, tierId, rateBasisPoints, bonusVnd })
  })

  it('treats input as VND, floors fractional đồng, and stays exact for large safe integers', () => {
    expect(calculateRevenueBonus({
      programId: REVENUE_BONUS_PROGRAM_IDS.DOSII_DAILY,
      revenueVnd: 1_500,
    }).bonusVnd).toBe(0)
    expect(calculateRevenueBonus({
      programId: REVENUE_BONUS_PROGRAM_IDS.DOSII_DAILY,
      revenueVnd: 2_000_001,
    }).bonusVnd).toBe(40_000)
    const expected = Number((BigInt(Number.MAX_SAFE_INTEGER) * 700n) / 10_000n)
    expect(calculateRevenueBonus({
      programId: REVENUE_BONUS_PROGRAM_IDS.SM_DAILY,
      revenueVnd: Number.MAX_SAFE_INTEGER,
    }).bonusVnd).toBe(expected)
  })

  it('rejects unknown programs and invalid VND input', () => {
    expect(() => calculateRevenueBonus({ programId: 'unknown', revenueVnd: 2_000_000 })).toThrow(RangeError)
    expect(() => calculateRevenueBonus({
      programId: REVENUE_BONUS_PROGRAM_IDS.DOSII_DAILY,
      revenueVnd: -1,
    })).toThrow(TypeError)
    expect(() => calculateRevenueBonus({
      programId: REVENUE_BONUS_PROGRAM_IDS.DOSII_DAILY,
      revenueVnd: 2_000_000.5,
    })).toThrow(TypeError)
  })
})

describe('highest-only team milestones', () => {
  it.each([
    [TEAM_MILESTONE_PROGRAM_IDS.DOSII_DAILY_REVENUE, 10_000_000, null, 0],
    [TEAM_MILESTONE_PROGRAM_IDS.DOSII_DAILY_REVENUE, 10_000_001, 'dosii.daily.over_10_000_000', 200_000],
    [TEAM_MILESTONE_PROGRAM_IDS.DOSII_DAILY_REVENUE, 15_000_000, 'dosii.daily.over_10_000_000', 200_000],
    [TEAM_MILESTONE_PROGRAM_IDS.DOSII_DAILY_REVENUE, 15_000_001, 'dosii.daily.over_15_000_000', 250_000],
    [TEAM_MILESTONE_PROGRAM_IDS.SM_DAILY_REVENUE, 20_000_000, null, 0],
    [TEAM_MILESTONE_PROGRAM_IDS.SM_DAILY_REVENUE, 20_000_001, 'sm.daily.over_20_000_000', 250_000],
    [TEAM_MILESTONE_PROGRAM_IDS.SM_DAILY_REVENUE, 25_000_001, 'sm.daily.over_25_000_000', 350_000],
    [TEAM_MILESTONE_PROGRAM_IDS.OFFICE_VIDEO_VIEWS, 50_000, null, 0],
    [TEAM_MILESTONE_PROGRAM_IDS.OFFICE_VIDEO_VIEWS, 50_001, 'office.video.over_50_000_views', 200_000],
    [TEAM_MILESTONE_PROGRAM_IDS.OFFICE_VIDEO_VIEWS, 100_001, 'office.video.over_100_000_views', 350_000],
  ])('selects one highest milestone for %s at %s', (programId, achievedUnits, milestoneId, amountVnd) => {
    expect(calculateTeamMilestoneReward({ programId, achievedUnits })).toEqual({
      programId, achievedUnits, milestoneId, amountVnd,
    })
  })

  it('supports explicit inclusive generic milestones without summing awards', () => {
    expect(selectHighestTeamMilestone({
      achievedUnits: 20,
      milestones: [
        { id: 'low', thresholdUnits: 10, comparison: 'GTE', amountVnd: 100 },
        { id: 'high', thresholdUnits: 20, comparison: 'GTE', amountVnd: 200 },
      ],
    })).toMatchObject({ id: 'high', amountVnd: 200 })
  })

  it('rejects ambiguous duplicate thresholds', () => {
    expect(() => selectHighestTeamMilestone({
      achievedUnits: 20,
      milestones: [
        { id: 'a', thresholdUnits: 10, amountVnd: 100 },
        { id: 'b', thresholdUnits: 10, amountVnd: 200 },
      ],
    })).toThrow(/Duplicate milestone threshold/)
  })
})

describe('workbook reward and violation constants', () => {
  it('keeps every fixed store reward amount in integer VND', () => {
    expect(amountMap(STORE_WORK_REWARDS)).toEqual({
      'store.reward.on_time': 2_000,
      'store.reward.welcome_advise_thank_customer': 1_000,
      'store.reward.clean_restroom': 5_000,
      'store.reward.clean_altar_table': 2_000,
      'store.reward.sweep_and_mop': 8_000,
      'store.reward.pick_up_clothes_and_hangers': 2_000,
      'store.reward.collect_empty_hangers': 2_000,
      'store.reward.fill_clothing_rack': 2_000,
      'store.reward.confirm_inbound_order': 2_000,
      'store.reward.classify_sale_charity_discard': 8_000,
      'store.reward.correct_payment_location': 5_000,
      'store.reward.complete_order_data': 5_000,
      'store.reward.zalo_photo_engagement': 2_000,
      'store.reward.loyalty_card': 2_000,
      'store.reward.add_zalo_group': 1_000,
      'store.reward.google_review': 1_000,
      'store.reward.tiktok_clip': 20_000,
      'store.reward.livestream': 30_000,
      'store.reward.tiktok_comments': 2_000,
      'store.reward.better_supplier': 100_000,
      'store.reward.report_dishonest_violation': 300_000,
    })
    expect(reward(STORE_WORK_REWARDS, 'store.reward.tiktok_clip').increment).toEqual({
      metric: 'follower_increase', everyUnits: 1_000, amountVnd: 5_000,
    })
    for (const code of ['store.reward.discard_buyer', 'store.reward.charity_buyer', 'store.reward.sale_buyer']) {
      expect(reward(STORE_WORK_REWARDS, code).tiers.map(({ comparison, thresholdUnits, amountVnd }) => (
        { comparison, thresholdUnits, amountVnd }
      ))).toEqual([
        { comparison: 'LT', thresholdUnits: 500, amountVnd: 100_000 },
        { comparison: 'GT', thresholdUnits: 500, amountVnd: 200_000 },
      ])
    }
    expect(reward(STORE_WORK_REWARDS, 'store.reward.new_wholesale_customer_bill').tiers).toEqual([
      expect.objectContaining({ minimumVnd: 1_000_000, maximumVnd: 1_500_000, amountVnd: 100_000 }),
      expect.objectContaining({ minimumVnd: 1_500_000, minimumInclusive: false, amountVnd: 150_000 }),
    ])
  })

  it('keeps the exact store violation codes, labels, and amounts from the approved catalog', () => {
    expect(STORE_VIOLATIONS.map(({ code, label, amountVnd }) => ({ code, label, amountVnd }))).toEqual([
      { code: 'store.violation.late', label: 'Đi trễ', amountVnd: 2_000 },
      { code: 'store.violation.forgot_attendance', label: 'Quên điểm danh', amountVnd: 2_000 },
      { code: 'store.violation.ignore_customer', label: 'Mặc kệ khách ra/vào, không tương tác', amountVnd: 2_000 },
      { code: 'store.violation.dark_hot_no_music', label: 'Để shop tối, nóng, không mở nhạc', amountVnd: 2_000 },
      { code: 'store.violation.dirty_restroom', label: 'Nhà vệ sinh dơ', amountVnd: 5_000 },
      { code: 'store.violation.dirty_altar_table', label: 'Bàn thần tài dơ', amountVnd: 2_000 },
      { code: 'store.violation.dirty_floor', label: 'Sàn nhà dơ', amountVnd: 8_000 },
      { code: 'store.violation.clothes_or_hangers_on_floor', label: 'Quần áo/móc rơi dưới sàn', amountVnd: 2_000 },
      { code: 'store.violation.empty_hangers', label: 'Sào có móc trống', amountVnd: 2_000 },
      { code: 'store.violation.empty_rack_not_filled', label: 'Để sào trống không fill', amountVnd: 2_000 },
      { code: 'store.violation.no_sorting', label: 'Không lọc hàng', amountVnd: 8_000 },
      { code: 'store.violation.wrong_payment_location', label: 'Thanh toán sai vị trí', amountVnd: 5_000 },
      { code: 'store.violation.wrong_app_info_requires_manager', label: 'Nhập sai thông tin phần mềm => kêu quản lý điều chỉnh', amountVnd: 2_000 },
      { code: 'store.violation.merged_or_wrong_time_order', label: 'Nhập đơn gộp, sai thời điểm', amountVnd: 5_000 },
      { code: 'store.violation.phone_over_30_minutes', label: 'Ngồi 1 chỗ bấm điện thoại (chơi) trên 30 phút/lần', amountVnd: 5_000 },
    ])
  })

  it('keeps exact office and HTKD policy amounts and team references', () => {
    expect(amountMap(OFFICE_REWARDS)).toEqual({
      'office.reward.on_time': 3_000,
      'office.reward.take_out_trash': 3_000,
      'office.reward.drain_ac_water': 2_000,
    })
    expect(reward(OFFICE_REWARDS, 'office.reward.video_views_team').milestoneProgramId)
      .toBe(TEAM_MILESTONE_PROGRAM_IDS.OFFICE_VIDEO_VIEWS)
    expect(amountMap(OFFICE_VIOLATIONS)).toEqual({
      'office.violation.late': 3_000,
      'office.violation.forgot_attendance': 3_000,
    })
    expect(amountMap(HTKD_REWARDS)).toEqual({
      'htkd.reward.on_time': 3_000,
      'htkd.reward.take_out_trash': 3_000,
      'htkd.reward.drain_ac_water': 2_000,
    })
    expect(amountMap(HTKD_VIOLATIONS)).toEqual({
      'htkd.violation.late': 3_000,
      'htkd.violation.forgot_attendance': 3_000,
      'htkd.violation.assigned_store_error_requires_admin': 5_000,
    })
    expect(reward(HTKD_VIOLATIONS, 'htkd.violation.assigned_store_error_requires_admin').label)
      .toBe('Thao tác sai cửa hàng cần Admin xử lý')
  })

  it('has unique stable codes and positive integer reward/violation amounts', () => {
    const groups = [STORE_WORK_REWARDS, STORE_VIOLATIONS, OFFICE_REWARDS, OFFICE_VIOLATIONS, HTKD_REWARDS, HTKD_VIOLATIONS]
    for (const items of groups) {
      expect(new Set(items.map(({ code }) => code)).size).toBe(items.length)
      for (const item of items) {
        const amounts = [item.amountVnd, item.increment?.amountVnd, ...(item.tiers || []).map((tier) => tier.amountVnd)]
          .filter((amount) => amount != null)
        expect(amounts.every((amount) => Number.isSafeInteger(amount) && amount > 0)).toBe(true)
      }
    }
    expect(WORKBOOK_COMPENSATION_POLICY.businessSupport.rewards).toBe(HTKD_REWARDS)
    expect(Object.isFrozen(WORKBOOK_COMPENSATION_POLICY)).toBe(true)
    expect(Object.isFrozen(TEAM_MILESTONE_PROGRAMS)).toBe(true)
  })
})
