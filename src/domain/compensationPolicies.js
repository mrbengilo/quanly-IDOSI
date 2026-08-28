const BASIS_POINTS_PER_PERCENT = 100
const BASIS_POINTS_PER_WHOLE = 10_000

const deepFreeze = (value) => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value
  for (const child of Object.values(value)) deepFreeze(child)
  return Object.freeze(value)
}

const nonNegativeInteger = (value, field) => {
  const normalized = Number(value)
  if (!Number.isSafeInteger(normalized) || normalized < 0) {
    throw new TypeError(`${field} must be a non-negative safe integer.`)
  }
  return normalized
}

const positiveVnd = (value, field) => {
  const normalized = nonNegativeInteger(value, field)
  if (normalized === 0) throw new TypeError(`${field} must be a positive integer amount in VND.`)
  return normalized
}

const stableId = (value, field) => {
  const normalized = String(value ?? '').trim()
  if (!normalized) throw new TypeError(`${field} is required.`)
  return normalized
}

const isWithinRevenueTier = (revenueVnd, tier) => {
  const aboveMinimum = tier.minimumInclusive
    ? revenueVnd >= tier.minimumRevenueVnd
    : revenueVnd > tier.minimumRevenueVnd
  const belowMaximum = tier.maximumRevenueVnd == null
    || (tier.maximumInclusive
      ? revenueVnd <= tier.maximumRevenueVnd
      : revenueVnd < tier.maximumRevenueVnd)
  return aboveMinimum && belowMaximum
}

const percentageOfVnd = (amountVnd, rateBasisPoints) => Number(
  (BigInt(amountVnd) * BigInt(rateBasisPoints)) / BigInt(BASIS_POINTS_PER_WHOLE),
)

export const REVENUE_BONUS_PROGRAM_IDS = deepFreeze({
  DOSII_DAILY: 'revenue-bonus.store-dosii-daily.v1',
  SM_DAILY: 'revenue-bonus.store-sm-daily.v1',
})

export const REVENUE_BONUS_PROGRAMS = deepFreeze({
  [REVENUE_BONUS_PROGRAM_IDS.DOSII_DAILY]: {
    id: REVENUE_BONUS_PROGRAM_IDS.DOSII_DAILY,
    label: 'Thưởng doanh thu ngày DOSII',
    metric: 'daily_revenue_vnd',
    rounding: 'floor_to_integer_vnd',
    tiers: [
      {
        id: 'dosii.daily.1_500_000_through_2_000_000',
        minimumRevenueVnd: 1_500_000,
        minimumInclusive: true,
        maximumRevenueVnd: 2_000_000,
        maximumInclusive: true,
        rateBasisPoints: 100,
      },
      {
        id: 'dosii.daily.over_2_000_000_through_4_000_000',
        minimumRevenueVnd: 2_000_000,
        minimumInclusive: false,
        maximumRevenueVnd: 4_000_000,
        maximumInclusive: true,
        rateBasisPoints: 200,
      },
      {
        id: 'dosii.daily.over_4_000_000',
        minimumRevenueVnd: 4_000_000,
        minimumInclusive: false,
        maximumRevenueVnd: null,
        maximumInclusive: false,
        rateBasisPoints: 400,
      },
    ],
  },
  [REVENUE_BONUS_PROGRAM_IDS.SM_DAILY]: {
    id: REVENUE_BONUS_PROGRAM_IDS.SM_DAILY,
    label: 'Thưởng doanh thu ngày SM',
    metric: 'daily_revenue_vnd',
    rounding: 'floor_to_integer_vnd',
    tiers: [
      {
        id: 'sm.daily.2_500_000_through_6_000_000',
        minimumRevenueVnd: 2_500_000,
        minimumInclusive: true,
        maximumRevenueVnd: 6_000_000,
        maximumInclusive: true,
        rateBasisPoints: 400,
      },
      {
        id: 'sm.daily.over_6_000_000_through_12_000_000',
        minimumRevenueVnd: 6_000_000,
        minimumInclusive: false,
        maximumRevenueVnd: 12_000_000,
        maximumInclusive: true,
        rateBasisPoints: 600,
      },
      {
        id: 'sm.daily.over_12_000_000',
        minimumRevenueVnd: 12_000_000,
        minimumInclusive: false,
        maximumRevenueVnd: null,
        maximumInclusive: false,
        rateBasisPoints: 700,
      },
    ],
  },
})

export function selectRevenueBonusTier({ programId, revenueVnd } = {}) {
  const normalizedProgramId = stableId(programId, 'programId')
  const program = REVENUE_BONUS_PROGRAMS[normalizedProgramId]
  if (!program) throw new RangeError(`Unknown revenue bonus program: ${normalizedProgramId}`)
  const normalizedRevenue = nonNegativeInteger(revenueVnd, 'revenueVnd')
  return program.tiers.find((tier) => isWithinRevenueTier(normalizedRevenue, tier)) || null
}

export function calculateRevenueBonus({ programId, revenueVnd } = {}) {
  const normalizedProgramId = stableId(programId, 'programId')
  const normalizedRevenue = nonNegativeInteger(revenueVnd, 'revenueVnd')
  const tier = selectRevenueBonusTier({ programId: normalizedProgramId, revenueVnd: normalizedRevenue })
  const rateBasisPoints = tier?.rateBasisPoints || 0
  return {
    programId: normalizedProgramId,
    revenueVnd: normalizedRevenue,
    tierId: tier?.id || null,
    rateBasisPoints,
    ratePercent: rateBasisPoints / BASIS_POINTS_PER_PERCENT,
    bonusVnd: percentageOfVnd(normalizedRevenue, rateBasisPoints),
  }
}

export const TEAM_MILESTONE_PROGRAM_IDS = deepFreeze({
  DOSII_DAILY_REVENUE: 'team-milestone.store-dosii-daily-revenue.v1',
  SM_DAILY_REVENUE: 'team-milestone.store-sm-daily-revenue.v1',
  OFFICE_VIDEO_VIEWS: 'team-milestone.office-video-views.v1',
})

export const TEAM_MILESTONE_PROGRAMS = deepFreeze({
  [TEAM_MILESTONE_PROGRAM_IDS.DOSII_DAILY_REVENUE]: {
    id: TEAM_MILESTONE_PROGRAM_IDS.DOSII_DAILY_REVENUE,
    label: 'Mốc doanh thu ngày đội nhóm DOSII',
    metric: 'daily_revenue_vnd',
    selection: 'highest_only',
    milestones: [
      { id: 'dosii.daily.over_10_000_000', thresholdUnits: 10_000_000, comparison: 'GT', amountVnd: 200_000 },
      { id: 'dosii.daily.over_15_000_000', thresholdUnits: 15_000_000, comparison: 'GT', amountVnd: 250_000 },
    ],
  },
  [TEAM_MILESTONE_PROGRAM_IDS.SM_DAILY_REVENUE]: {
    id: TEAM_MILESTONE_PROGRAM_IDS.SM_DAILY_REVENUE,
    label: 'Mốc doanh thu ngày đội nhóm SM',
    metric: 'daily_revenue_vnd',
    selection: 'highest_only',
    milestones: [
      { id: 'sm.daily.over_20_000_000', thresholdUnits: 20_000_000, comparison: 'GT', amountVnd: 250_000 },
      { id: 'sm.daily.over_25_000_000', thresholdUnits: 25_000_000, comparison: 'GT', amountVnd: 350_000 },
    ],
  },
  [TEAM_MILESTONE_PROGRAM_IDS.OFFICE_VIDEO_VIEWS]: {
    id: TEAM_MILESTONE_PROGRAM_IDS.OFFICE_VIDEO_VIEWS,
    label: 'Mốc lượt xem video đội nhóm Khối văn phòng',
    metric: 'video_views',
    selection: 'highest_only',
    milestones: [
      { id: 'office.video.over_50_000_views', thresholdUnits: 50_000, comparison: 'GT', amountVnd: 200_000 },
      { id: 'office.video.over_100_000_views', thresholdUnits: 100_000, comparison: 'GT', amountVnd: 350_000 },
    ],
  },
})

const milestoneIsEligible = (achievedUnits, milestone) => milestone.comparison === 'GTE'
  ? achievedUnits >= milestone.thresholdUnits
  : achievedUnits > milestone.thresholdUnits

export function selectHighestTeamMilestone({ achievedUnits, milestones = [] } = {}) {
  const normalizedAchievedUnits = nonNegativeInteger(achievedUnits, 'achievedUnits')
  if (!Array.isArray(milestones)) throw new TypeError('milestones must be an array.')

  const ids = new Set()
  const thresholds = new Set()
  const normalized = milestones.map((milestone, index) => {
    const id = stableId(milestone?.id, `milestones[${index}].id`)
    if (ids.has(id)) throw new TypeError(`Duplicate milestone id: ${id}`)
    ids.add(id)
    const thresholdUnits = nonNegativeInteger(milestone?.thresholdUnits, `milestones[${index}].thresholdUnits`)
    if (thresholds.has(thresholdUnits)) throw new TypeError(`Duplicate milestone threshold: ${thresholdUnits}`)
    thresholds.add(thresholdUnits)
    const comparison = milestone?.comparison || 'GT'
    if (!['GT', 'GTE'].includes(comparison)) {
      throw new TypeError(`milestones[${index}].comparison must be GT or GTE.`)
    }
    return {
      ...milestone,
      id,
      thresholdUnits,
      comparison,
      amountVnd: positiveVnd(milestone?.amountVnd, `milestones[${index}].amountVnd`),
    }
  })

  return normalized
    .filter((milestone) => milestoneIsEligible(normalizedAchievedUnits, milestone))
    .sort((left, right) => {
      if (left.thresholdUnits > right.thresholdUnits) return -1
      if (left.thresholdUnits < right.thresholdUnits) return 1
      return 0
    })[0] || null
}

export function calculateTeamMilestoneReward({ programId, achievedUnits } = {}) {
  const normalizedProgramId = stableId(programId, 'programId')
  const program = TEAM_MILESTONE_PROGRAMS[normalizedProgramId]
  if (!program) throw new RangeError(`Unknown team milestone program: ${normalizedProgramId}`)
  const normalizedAchievedUnits = nonNegativeInteger(achievedUnits, 'achievedUnits')
  const milestone = selectHighestTeamMilestone({
    achievedUnits: normalizedAchievedUnits,
    milestones: program.milestones,
  })
  return {
    programId: normalizedProgramId,
    achievedUnits: normalizedAchievedUnits,
    milestoneId: milestone?.id || null,
    amountVnd: milestone?.amountVnd || 0,
  }
}

export const STORE_WORK_REWARDS = deepFreeze([
  { code: 'store.reward.on_time', label: 'Đi làm đúng giờ', amountVnd: 2_000 },
  { code: 'store.reward.welcome_advise_thank_customer', label: 'Chào đón, tư vấn và cảm ơn khách', amountVnd: 1_000 },
  { code: 'store.reward.clean_restroom', label: 'Vệ sinh toilet sạch sẽ', amountVnd: 5_000 },
  { code: 'store.reward.clean_altar_table', label: 'Vệ sinh bàn thờ sạch sẽ', amountVnd: 2_000 },
  { code: 'store.reward.sweep_and_mop', label: 'Quét và lau sàn', amountVnd: 8_000 },
  { code: 'store.reward.pick_up_clothes_and_hangers', label: 'Nhặt quần áo và móc treo trên sàn', amountVnd: 2_000 },
  { code: 'store.reward.collect_empty_hangers', label: 'Thu gom móc trống', amountVnd: 2_000 },
  { code: 'store.reward.fill_clothing_rack', label: 'Bổ sung quần áo lên sào', amountVnd: 2_000 },
  { code: 'store.reward.confirm_inbound_order', label: 'Xác nhận đơn hàng nhập', amountVnd: 2_000 },
  { code: 'store.reward.classify_sale_charity_discard', label: 'Phân loại hàng bán, từ thiện và loại bỏ', amountVnd: 8_000 },
  { code: 'store.reward.correct_payment_location', label: 'Đặt đúng vị trí hình thức thanh toán', amountVnd: 5_000 },
  { code: 'store.reward.complete_order_data', label: 'Hoàn tất thông tin đơn hàng', amountVnd: 5_000 },
  { code: 'store.reward.zalo_photo_engagement', label: 'Chụp ảnh và tương tác Zalo', amountVnd: 2_000 },
  { code: 'store.reward.loyalty_card', label: 'Tạo thẻ khách hàng thân thiết', amountVnd: 2_000 },
  { code: 'store.reward.add_zalo_group', label: 'Thêm khách vào nhóm Zalo', amountVnd: 1_000 },
  { code: 'store.reward.google_review', label: 'Khách đánh giá Google', amountVnd: 1_000 },
  {
    code: 'store.reward.tiktok_clip',
    label: 'Đăng video TikTok',
    amountVnd: 20_000,
    increment: { metric: 'follower_increase', everyUnits: 1_000, amountVnd: 5_000 },
  },
  { code: 'store.reward.livestream', label: 'Livestream', amountVnd: 30_000 },
  { code: 'store.reward.tiktok_comments', label: 'Bình luận TikTok', amountVnd: 2_000 },
  { code: 'store.reward.better_supplier', label: 'Tìm nhà cung cấp tốt hơn', amountVnd: 100_000 },
  {
    code: 'store.reward.discard_buyer',
    label: 'Tìm người mua hàng loại bỏ',
    metric: 'weight_kg',
    // The workbook has strict <500 kg and >500 kg rows; exactly 500 kg is intentionally not inferred.
    tiers: [
      { id: 'under_500kg', comparison: 'LT', thresholdUnits: 500, amountVnd: 100_000 },
      { id: 'over_500kg', comparison: 'GT', thresholdUnits: 500, amountVnd: 200_000 },
    ],
  },
  {
    code: 'store.reward.charity_buyer',
    label: 'Tìm người mua hàng từ thiện',
    metric: 'weight_kg',
    // Preserve the same strict workbook boundary instead of silently treating 500 kg as either tier.
    tiers: [
      { id: 'under_500kg', comparison: 'LT', thresholdUnits: 500, amountVnd: 100_000 },
      { id: 'over_500kg', comparison: 'GT', thresholdUnits: 500, amountVnd: 200_000 },
    ],
  },
  {
    code: 'store.reward.sale_buyer',
    label: 'Tìm người mua hàng bán',
    metric: 'weight_kg',
    // Preserve the same strict workbook boundary instead of silently treating 500 kg as either tier.
    tiers: [
      { id: 'under_500kg', comparison: 'LT', thresholdUnits: 500, amountVnd: 100_000 },
      { id: 'over_500kg', comparison: 'GT', thresholdUnits: 500, amountVnd: 200_000 },
    ],
  },
  {
    code: 'store.reward.new_wholesale_customer_bill',
    label: 'Khách sỉ mới có hóa đơn',
    metric: 'bill_amount_vnd',
    tiers: [
      { id: '1_000_000_through_1_500_000', minimumVnd: 1_000_000, minimumInclusive: true, maximumVnd: 1_500_000, maximumInclusive: true, amountVnd: 100_000 },
      { id: 'over_1_500_000', minimumVnd: 1_500_000, minimumInclusive: false, maximumVnd: null, maximumInclusive: false, amountVnd: 150_000 },
    ],
  },
  {
    code: 'store.reward.dosii_daily_team',
    label: 'Thưởng đội nhóm theo doanh thu ngày DOSII',
    milestoneProgramId: TEAM_MILESTONE_PROGRAM_IDS.DOSII_DAILY_REVENUE,
  },
  {
    code: 'store.reward.sm_daily_team',
    label: 'Thưởng đội nhóm theo doanh thu ngày SM',
    milestoneProgramId: TEAM_MILESTONE_PROGRAM_IDS.SM_DAILY_REVENUE,
  },
  { code: 'store.reward.report_dishonest_violation', label: 'Báo cáo trung thực hành vi vi phạm', amountVnd: 300_000 },
])

export const STORE_VIOLATIONS = deepFreeze([
  { code: 'store.violation.late', label: 'Đi trễ', amountVnd: 2_000 },
  { code: 'store.violation.forgot_attendance', label: 'Quên chấm công', amountVnd: 2_000 },
  { code: 'store.violation.ignore_customer', label: 'Không quan tâm khách hàng', amountVnd: 2_000 },
  { code: 'store.violation.dark_hot_no_music', label: 'Cửa hàng tối, nóng hoặc không có nhạc', amountVnd: 2_000 },
  { code: 'store.violation.dirty_restroom', label: 'Toilet không sạch', amountVnd: 5_000 },
  { code: 'store.violation.dirty_altar_table', label: 'Bàn thờ không sạch', amountVnd: 2_000 },
  { code: 'store.violation.dirty_floor', label: 'Sàn không sạch', amountVnd: 8_000 },
  { code: 'store.violation.clothes_or_hangers_on_floor', label: 'Quần áo hoặc móc treo nằm trên sàn', amountVnd: 2_000 },
  { code: 'store.violation.empty_hangers', label: 'Còn móc trống', amountVnd: 2_000 },
  { code: 'store.violation.empty_rack_not_filled', label: 'Sào trống chưa được bổ sung quần áo', amountVnd: 2_000 },
  { code: 'store.violation.no_sorting', label: 'Không phân loại hàng', amountVnd: 8_000 },
  { code: 'store.violation.wrong_payment_location', label: 'Đặt sai vị trí hình thức thanh toán', amountVnd: 5_000 },
  { code: 'store.violation.wrong_app_info_requires_manager', label: 'Sai thông tin trên ứng dụng cần quản lý xử lý', amountVnd: 2_000 },
  { code: 'store.violation.merged_or_wrong_time_order', label: 'Gộp đơn hoặc sai thời gian đơn hàng', amountVnd: 5_000 },
  { code: 'store.violation.phone_over_30_minutes', label: 'Sử dụng điện thoại quá 30 phút', amountVnd: 5_000 },
])

export const OFFICE_REWARDS = deepFreeze([
  { code: 'office.reward.on_time', label: 'Đi làm đúng giờ', amountVnd: 3_000 },
  { code: 'office.reward.take_out_trash', label: 'Đổ rác', amountVnd: 3_000 },
  { code: 'office.reward.drain_ac_water', label: 'Đổ nước máy lạnh', amountVnd: 2_000 },
  { code: 'office.reward.clip_over_100k_views_team', label: 'Clip trên 100k view (thưởng team)', amountVnd: 350_000 },
  { code: 'office.reward.clip_over_50k_views_team', label: 'Clip trên 50k view (thưởng team)', amountVnd: 200_000 },
])

export const OFFICE_VIOLATIONS = deepFreeze([
  { code: 'office.violation.late', label: 'Đi trễ', amountVnd: 3_000 },
  { code: 'office.violation.forgot_attendance', label: 'Quên điểm danh', amountVnd: 3_000 },
])

export const HTKD_REWARDS = deepFreeze([
  { code: 'htkd.reward.on_time', label: 'Đi làm đúng giờ', amountVnd: 3_000 },
  { code: 'htkd.reward.take_out_trash', label: 'Đổ rác', amountVnd: 3_000 },
  { code: 'htkd.reward.drain_ac_water', label: 'Đổ nước máy lạnh', amountVnd: 2_000 },
])

export const HTKD_VIOLATIONS = deepFreeze([
  { code: 'htkd.violation.late', label: 'Đi trễ', amountVnd: 3_000 },
  { code: 'htkd.violation.forgot_attendance', label: 'Quên điểm danh', amountVnd: 3_000 },
  { code: 'htkd.violation.assigned_store_error_requires_admin', label: 'Cửa hàng phụ trách thao tác sai sót => kêu admin sửa', amountVnd: 5_000 },
])

export const WORKBOOK_COMPENSATION_POLICY = deepFreeze({
  store: { rewards: STORE_WORK_REWARDS, violations: STORE_VIOLATIONS },
  office: { rewards: OFFICE_REWARDS, violations: OFFICE_VIOLATIONS },
  businessSupport: { rewards: HTKD_REWARDS, violations: HTKD_VIOLATIONS },
})

const staffCatalogItems = (targetGroup, kind, records) => records.map((record, index) => ({
  id: `work-catalog:${targetGroup}:${kind.toLocaleLowerCase('en-US')}:${record.code}`,
  code: record.code,
  kind,
  targetGroup,
  storeId: null,
  shiftId: null,
  shiftName: null,
  name: record.label,
  amountVnd: record.amountVnd,
  required: false,
  active: true,
  sortOrder: index,
  effectiveFrom: null,
  effectiveTo: null,
  version: 1,
  deletedAt: null,
}))

export const DEFAULT_STAFF_WORK_CATALOG_ITEMS = deepFreeze([
  ...staffCatalogItems('business_support', 'REWARD_TASK', HTKD_REWARDS),
  ...staffCatalogItems('business_support', 'VIOLATION', HTKD_VIOLATIONS),
  ...staffCatalogItems('office', 'REWARD_TASK', OFFICE_REWARDS),
  ...staffCatalogItems('office', 'VIOLATION', OFFICE_VIOLATIONS),
])
