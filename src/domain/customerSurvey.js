import { businessDate } from '../utils'

const normalize = (value) => String(value || '').trim().toLocaleLowerCase('vi')
export const OCCUPATION_SURVEY_START_AT = '2026-08-21T11:15:00+07:00'
const OCCUPATION_SURVEY_START_MS = Date.parse(OCCUPATION_SURVEY_START_AT)

const validOrders = (orders = [], { period = '', storeId = '' } = {}) => (Array.isArray(orders) ? orders : [])
  .filter((order) => (
    order
    && !order.deletedAt
    && order.status !== 'Đã xóa'
    && order.source !== 'legacy-opening-balance'
    && (!period || businessDate(order.createdAt || order.updatedAt).startsWith(period))
    && (!storeId || String(order.storeId || '') === String(storeId))
  ))

const genderOf = (value) => {
  const text = normalize(value)
  if (text === 'nam' || text === 'male') return 'Nam'
  if (text === 'nữ' || text === 'nu' || text === 'female') return 'Nữ'
  return 'Khác / chưa rõ'
}

const channelOf = (value) => {
  const text = normalize(value)
  if (text.includes('tiktok') || text.includes('tik tok')) return 'TikTok'
  if (text.includes('facebook')) return 'Facebook'
  if (text.includes('zalo')) return 'Zalo'
  return 'Khác'
}

const ageBucketOf = (value) => {
  const age = Number(value)
  if (!Number.isFinite(age) || age <= 0) return 'Chưa rõ tuổi'
  if (age < 18) return 'Dưới 18'
  if (age <= 24) return '18–24'
  if (age <= 34) return '25–34'
  if (age <= 44) return '35–44'
  return 'Từ 45'
}

const countBy = (records, selector) => records.reduce((result, record) => {
  const key = selector(record)
  result[key] = (result[key] || 0) + 1
  return result
}, {})

const topEntry = (counts = {}) => Object.entries(counts)
  .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], 'vi'))[0] || ['', 0]

export function customerSurveySummary(orders = [], filters = {}) {
  const records = validOrders(orders, filters)
  const occupationRecords = records.filter((order) => {
    const timestamp = Date.parse(order.createdAt || order.occurredAt || order.updatedAt || '')
    return Number.isFinite(timestamp) && timestamp >= OCCUPATION_SURVEY_START_MS
  })
  const genders = countBy(records, (order) => genderOf(order.gender))
  const channels = countBy(records, (order) => channelOf(order.acquisitionChannel))
  const ages = countBy(records, (order) => ageBucketOf(order.customerAge))
  const occupations = countBy(occupationRecords, (order) => String(order.occupation || '').trim() || 'Chưa rõ nghề nghiệp')
  const numericAges = records.map((order) => Number(order.customerAge)).filter((age) => Number.isFinite(age) && age > 0)
  const [topGender, topGenderCount] = topEntry(genders)
  const [topChannel, topChannelCount] = topEntry(channels)
  const [topAge, topAgeCount] = topEntry(ages)
  const [topOccupation, topOccupationCount] = topEntry(occupations)
  return {
    records,
    total: records.length,
    genders,
    channels,
    ages,
    occupations,
    occupationTotal: occupationRecords.length,
    ageRange: numericAges.length ? { min: Math.min(...numericAges), max: Math.max(...numericAges) } : null,
    insights: {
      topGender, topGenderCount,
      topChannel, topChannelCount,
      topAge, topAgeCount,
      topOccupation, topOccupationCount,
    },
  }
}

export const customerSurveyHelpers = Object.freeze({ genderOf, channelOf, ageBucketOf, validOrders })
