from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text(encoding='utf-8')
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'Expected exactly one match in {path}, found {count}: {old[:180]!r}')
    file.write_text(text.replace(old, new, 1), encoding='utf-8')


replace_once(
    'src/pages/compensation/RevenueBonusPage.jsx',
    "import { revenueBonusEligibility } from '../../domain/revenueBonusEligibility'\n",
    """import {
  revenueBonusEligibility,
  usesRevenueBonusDailyCloseRule,
} from '../../domain/revenueBonusEligibility'
""",
)

replace_once(
    'src/pages/compensation/RevenueBonusPage.jsx',
    """  const calculationEligibility = serverBacked
    ? matchingRemoteSnapshot?.calculationEligibility || null
    : localLiveSnapshot?.calculationEligibility || null
  const calculationCollision = calculationEligibility?.code === 'DATA_COLLISION' || selectedDayCollision
  const calculationDone = !calculationCollision && (calculationEligibility?.code === 'ALREADY_CALCULATED'
    || records.length > 0
    || submittedCalculationScope === calculationScope)
  const awaitingSavedResult = calculationDone && records.length !== 1
  const calculationReady = !remoteDataStale && !calculationCollision && calculationEligibility?.code === 'READY' && !calculationDone
  const liveSnapshot = calculationDone || calculationCollision ? null : (matchingRemoteSnapshot || localLiveSnapshot)
  const attendanceSnapshot = matchingRemoteSnapshot || localLiveSnapshot
""",
    """  const calculationEligibility = serverBacked
    ? matchingRemoteSnapshot?.calculationEligibility || null
    : localLiveSnapshot?.calculationEligibility || null
  const attendanceSnapshot = matchingRemoteSnapshot || localLiveSnapshot
  const calculationCollision = calculationEligibility?.code === 'DATA_COLLISION' || selectedDayCollision
  const calculationDone = !calculationCollision && (calculationEligibility?.code === 'ALREADY_CALCULATED'
    || records.length > 0
    || submittedCalculationScope === calculationScope)
  const awaitingSavedResult = calculationDone && records.length !== 1
  const historicalCloseRuleFallback = Boolean(
    serverBacked
    && businessDate < vietnamToday()
    && usesRevenueBonusDailyCloseRule(businessDate)
    && Number(attendanceSnapshot?.attendanceCount || 0) > 0
    && Number(attendanceSnapshot?.openAttendanceCount || 0) === 0
    && !calculationDone
    && !calculationCollision
    && [null, 'READY', 'FINAL_SHIFT_NOT_ATTENDED', 'FINAL_SHIFT_UNRESOLVED']
      .includes(calculationEligibility?.code ?? null)
  )
  const calculationReady = !calculationCollision && !calculationDone && (
    (!remoteDataStale && calculationEligibility?.code === 'READY')
    || historicalCloseRuleFallback
  )
  const liveSnapshot = calculationDone || calculationCollision ? null : (matchingRemoteSnapshot || localLiveSnapshot)
""",
)

replace_once(
    'src/pages/compensation/RevenueBonusPage.jsx',
    """    : calculationEligibility?.message
    || (serverBacked
      ? 'Đang kiểm tra trạng thái ca cuối cùng và kết quả thưởng đã lưu.'
      : 'Chưa đủ dữ liệu để kiểm tra điều kiện tính thưởng doanh thu.')
""",
    """    : historicalCloseRuleFallback
    ? remoteDataStale
      ? 'Ngày cũ chưa tính thưởng và toàn bộ ca đã ghi nhận đều kết thúc. Có thể bấm tính; máy chủ sẽ kiểm tra lại trước khi lưu.'
      : 'Ngày cũ chưa tính thưởng và toàn bộ ca đã ghi nhận đều kết thúc. Có thể tính thưởng doanh thu.'
    : calculationEligibility?.message
    || (serverBacked
      ? 'Đang kiểm tra mốc 21:00, các ca chưa kết thúc và kết quả thưởng đã lưu.'
      : 'Chưa đủ dữ liệu để kiểm tra điều kiện tính thưởng doanh thu.')
""",
)

replace_once(
    'src/services/idosiApi.js',
    """export const apiGetRevenueBonusLive = ({ storeId, businessDate }) => {
  const query = new URLSearchParams({
    storeId: String(storeId || ''),
    businessDate: String(businessDate || ''),
  })
  return request(`/api/revenue-bonus/live?${query.toString()}`)
}
""",
    """export const apiGetRevenueBonusLive = ({ storeId, businessDate }) => {
  const query = new URLSearchParams({
    storeId: String(storeId || ''),
    businessDate: String(businessDate || ''),
  })
  return stateReadRequest(`/api/revenue-bonus/live?${query.toString()}`)
}
""",
)

replace_once(
    'server/worker.js',
    """    participantCount: participants.length,
    fingerprint,
    status: 'APPROVED',
""",
    """    participantCount: participants.length,
    eligibilityRuleCode: eligibility.ruleCode,
    eligibilityRuleEffectiveFrom: eligibility.ruleEffectiveFrom,
    fingerprint,
    status: 'APPROVED',
""",
)
