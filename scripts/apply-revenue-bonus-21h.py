from pathlib import Path

def replace_once(path, old, new):
    target = Path(path)
    text = target.read_text(encoding='utf-8')
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{path}: expected exactly one match, found {count}')
    target.write_text(text.replace(old, new, 1), encoding='utf-8')

def insert_before_last(path, marker, addition):
    target = Path(path)
    text = target.read_text(encoding='utf-8')
    position = text.rfind(marker)
    if position < 0:
        raise SystemExit(f'{path}: final marker not found')
    target.write_text(text[:position] + addition + text[position:], encoding='utf-8')

eligibility_path = 'src/domain/revenueBonusEligibility.js'
replace_once(
    eligibility_path,
    "const normalizeIdentifier = (value) => String(value ?? '').trim().toLocaleLowerCase('vi-VN')\n",
    """export const REVENUE_BONUS_DAILY_OPEN_HOUR = 21
export const REVENUE_BONUS_TIME_ZONE = 'Asia/Ho_Chi_Minh'

const REVENUE_BONUS_DAILY_OPEN_MINUTE = REVENUE_BONUS_DAILY_OPEN_HOUR * 60
const REVENUE_BONUS_DAILY_OPEN_LABEL = `${String(REVENUE_BONUS_DAILY_OPEN_HOUR).padStart(2, '0')}:00`
const VIETNAM_CLOCK_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: REVENUE_BONUS_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
})

const normalizeIdentifier = (value) => String(value ?? '').trim().toLocaleLowerCase('vi-VN')

const vietnamClock = (value) => {
  const instant = value instanceof Date ? value : new Date(value ?? Date.now())
  if (Number.isNaN(instant.getTime())) throw new TypeError('now must be a valid date.')
  const parts = Object.fromEntries(
    VIETNAM_CLOCK_FORMATTER.formatToParts(instant)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  )
  const hour = Number(parts.hour) % 24
  const minute = Number(parts.minute)
  return {
    businessDate: `${parts.year}-${parts.month}-${parts.day}`,
    minuteOfDay: (hour * 60) + minute,
  }
}
""",
)
replace_once(
    eligibility_path,
    """  DATA_COLLISION: 'Ngày này có nhiều kết quả thưởng đang hiệu lực; cần xử lý dữ liệu trùng.',
  FINAL_SHIFT_UNRESOLVED: 'Chưa xác định được ca cuối cùng của ngày từ lịch phân ca.',
""",
    """  DATA_COLLISION: 'Ngày này có nhiều kết quả thưởng đang hiệu lực; cần xử lý dữ liệu trùng.',
  DAILY_WINDOW_NOT_OPEN: 'Nút TÍNH THƯỞNG NGÀY chỉ mở sau 21:00 mỗi ngày (giờ Việt Nam).',
  FUTURE_DATE: 'Không thể tính thưởng doanh thu cho ngày trong tương lai.',
  FINAL_SHIFT_UNRESOLVED: 'Chưa xác định được ca cuối cùng của ngày từ lịch phân ca.',
""",
)
replace_once(
    eligibility_path,
    """  attendance = [],
  dailyRecords = [],
} = {}) {
""",
    """  attendance = [],
  dailyRecords = [],
  now = Date.now(),
} = {}) {
""",
)
replace_once(
    eligibility_path,
    """  if (!normalizedStoreId || !/^\\d{4}-\\d{2}-\\d{2}$/u.test(String(businessDate))) {
    throw new TypeError('storeId and businessDate are required.')
  }
  const common = {
""",
    """  if (!normalizedStoreId || !/^\\d{4}-\\d{2}-\\d{2}$/u.test(String(businessDate))) {
    throw new TypeError('storeId and businessDate are required.')
  }
  const clock = vietnamClock(now)
  const common = {
""",
)
replace_once(
    eligibility_path,
    """    finalShiftName: null,
    finalShiftEndAt: null,
  }
""",
    """    finalShiftName: null,
    finalShiftEndAt: null,
    currentBusinessDate: clock.businessDate,
    dailyWindowOpensAt: REVENUE_BONUS_DAILY_OPEN_LABEL,
  }
""",
)
replace_once(
    eligibility_path,
    """  if (effectiveDaily.length === 1) {
    return result('ALREADY_CALCULATED', {
      ...common,
      message: REVENUE_BONUS_ELIGIBILITY_MESSAGES.ALREADY_CALCULATED,
      existingCount: 1,
      existingId: String(effectiveDaily[0].id || ''),
    })
  }

  const candidates = scheduleShiftCandidates({ schedule, shiftDefinitions, storeId, businessDate })
""",
    """  if (effectiveDaily.length === 1) {
    return result('ALREADY_CALCULATED', {
      ...common,
      message: REVENUE_BONUS_ELIGIBILITY_MESSAGES.ALREADY_CALCULATED,
      existingCount: 1,
      existingId: String(effectiveDaily[0].id || ''),
    })
  }
  if (businessDate > clock.businessDate) {
    return result('FUTURE_DATE', {
      ...common,
      message: REVENUE_BONUS_ELIGIBILITY_MESSAGES.FUTURE_DATE,
      existingCount: 0,
    })
  }
  if (businessDate === clock.businessDate && clock.minuteOfDay < REVENUE_BONUS_DAILY_OPEN_MINUTE) {
    return result('DAILY_WINDOW_NOT_OPEN', {
      ...common,
      message: REVENUE_BONUS_ELIGIBILITY_MESSAGES.DAILY_WINDOW_NOT_OPEN,
      existingCount: 0,
    })
  }

  const candidates = scheduleShiftCandidates({ schedule, shiftDefinitions, storeId, businessDate })
""",
)

page_path = 'src/pages/compensation/RevenueBonusPage.jsx'
replace_once(
    page_path,
    """      attendance: app.attendance,
      dailyRecords: Array.isArray(app.revenueBonusDaily) ? app.revenueBonusDaily : (app.revenueBonuses || []),
    }),
""",
    """      attendance: app.attendance,
      dailyRecords: Array.isArray(app.revenueBonusDaily) ? app.revenueBonusDaily : (app.revenueBonuses || []),
      now: nowMs,
    }),
""",
)
replace_once(
    page_path,
    """  const shouldTickLocalClock = !serverBacked
    && businessDate === vietnamToday()
    && (app.attendance || []).some((attendance) => (
      !attendance.deletedAt
      && sameOperationalIdentifier(entryStoreId(attendance), selectedStoreId)
      && recordBusinessDate(attendance) === businessDate
      && !attendance.checkOutAt
      && !attendance.checkOut
    ))
""",
    """  const shouldTickLocalClock = !serverBacked && businessDate === vietnamToday()
""",
)
replace_once(
    page_path,
    """  const calculationCollision = calculationEligibility?.code === 'DATA_COLLISION' || selectedDayCollision
  const calculationDone = !calculationCollision && (calculationEligibility?.code === 'ALREADY_CALCULATED'
""",
    """  const calculationCollision = calculationEligibility?.code === 'DATA_COLLISION' || selectedDayCollision
  const calculationWindowClosed = calculationEligibility?.code === 'DAILY_WINDOW_NOT_OPEN'
  const calculationDone = !calculationCollision && (calculationEligibility?.code === 'ALREADY_CALCULATED'
""",
)
replace_once(
    page_path,
    """  const calculate = async () => {
    if (!calculationReady || submittedCalculationRef.current === calculationScope) return
    submittedCalculationRef.current = calculationScope
    const result = await run({
      key: 'calculate',
      action: app.calculateRevenueBonusDay,
      payload: { storeId: selectedStoreId, businessDate },
      success: `Đã tính thưởng doanh thu ngày ${displayDate(businessDate)}.`,
      unavailable: 'Chức năng tính thưởng doanh thu đang được đồng bộ với máy chủ. Dữ liệu đã tính trước đó vẫn được giữ nguyên.',
    })
    if (result && result.ok !== false) setSubmittedCalculationScope(calculationScope)
    else submittedCalculationRef.current = ''
  }
""",
    """  const calculate = async () => {
    if (!calculationReady || submittedCalculationRef.current === calculationScope) return
    const confirmed = typeof window === 'undefined' || window.confirm([
      `Xác nhận tính thưởng doanh thu ngày ${displayDate(businessDate)} cho ${storeName(stores, selectedStoreId)}?`,
      'Mỗi cửa hàng chỉ được tính một lần trong ngày. Kết quả đã lưu không thể tính lại.',
    ].join('\\n\\n'))
    if (!confirmed) return
    submittedCalculationRef.current = calculationScope
    const result = await run({
      key: 'calculate',
      action: app.calculateRevenueBonusDay,
      payload: {
        storeId: selectedStoreId,
        businessDate,
        idempotencyKey: `revenue-bonus-day:${identifierKey(selectedStoreId)}:${businessDate}`,
      },
      success: `Đã tính thưởng doanh thu ngày ${displayDate(businessDate)}.`,
      unavailable: 'Chức năng tính thưởng doanh thu đang được đồng bộ với máy chủ. Dữ liệu đã tính trước đó vẫn được giữ nguyên.',
    })
    if (result && result.ok !== false) setSubmittedCalculationScope(calculationScope)
    else submittedCalculationRef.current = ''
  }
""",
)
replace_once(
    page_path,
    """        actions={privileged && <Button
        icon={calculationDone ? CheckCircle2 : Calculator}
        loading={busyKey === 'calculate'}
        disabled={Boolean(busyKey) || !calculationReady}
        onClick={calculate}
        title={eligibilityMessage}
      >{awaitingSavedResult ? 'ĐANG ĐỒNG BỘ KẾT QUẢ' : calculationDone ? 'ĐÃ TÍNH THƯỞNG' : 'TÍNH THƯỞNG NGÀY'}</Button>}
""",
    """        actions={privileged && <Button
        className={`revenue-bonus-calculate-button ${calculationReady ? 'is-ready' : ''}`}
        icon={calculationDone ? CheckCircle2 : Calculator}
        loading={busyKey === 'calculate'}
        disabled={Boolean(busyKey) || !calculationReady}
        onClick={calculate}
        title={eligibilityMessage}
      >{awaitingSavedResult
        ? 'ĐANG ĐỒNG BỘ KẾT QUẢ'
        : calculationDone
          ? 'ĐÃ TÍNH THƯỞNG'
          : calculationWindowClosed
            ? 'TÍNH SAU 21:00'
            : 'TÍNH THƯỞNG NGÀY'}</Button>}
""",
)

css_path = Path('src/pages/compensation/compensation-page.css')
css = css_path.read_text(encoding='utf-8')
css_addition = """

.revenue-bonus-calculate-button {
  transition: box-shadow 180ms ease, transform 180ms ease;
}

.revenue-bonus-calculate-button.is-ready:not(:disabled) {
  box-shadow: 0 0 0 4px rgba(7, 136, 63, .16), 0 10px 24px rgba(7, 136, 63, .24);
  transform: translateY(-1px);
}

.revenue-bonus-calculate-button.is-ready:not(:disabled):hover {
  box-shadow: 0 0 0 5px rgba(7, 136, 63, .18), 0 12px 28px rgba(7, 136, 63, .28);
  transform: translateY(-2px);
}
"""
if '.revenue-bonus-calculate-button.is-ready' in css:
    raise SystemExit(f'{css_path}: ready-button styles already exist')
css_path.write_text(css.rstrip() + css_addition + '\n', encoding='utf-8')

eligibility_test_path = 'src/domain/revenueBonusEligibility.test.js'
eligibility_tests = """

  it('keeps the current-day calculation window closed until 21:00 Vietnam time', () => {
    expect(revenueBonusEligibility({
      storeId: 'S1', businessDate: '2026-08-31', schedule, shiftDefinitions: shifts,
      attendance: [closed()], dailyRecords: [], now: '2026-08-31T13:59:59.000Z',
    })).toMatchObject({
      allowed: false,
      code: 'DAILY_WINDOW_NOT_OPEN',
      currentBusinessDate: '2026-08-31',
      dailyWindowOpensAt: '21:00',
    })
  })

  it('opens the current-day calculation window exactly at 21:00 Vietnam time', () => {
    expect(revenueBonusEligibility({
      storeId: 'S1', businessDate: '2026-08-31', schedule, shiftDefinitions: shifts,
      attendance: [closed()], dailyRecords: [], now: '2026-08-31T14:00:00.000Z',
    })).toMatchObject({ allowed: true, code: 'READY' })
  })

  it('rejects a future business date before evaluating attendance', () => {
    expect(revenueBonusEligibility({
      storeId: 'S1', businessDate: '2026-09-01', schedule, shiftDefinitions: shifts,
      attendance: [], dailyRecords: [], now: '2026-08-31T14:00:00.000Z',
    })).toMatchObject({
      allowed: false,
      code: 'FUTURE_DATE',
      currentBusinessDate: '2026-08-31',
    })
  })
"""
insert_before_last(eligibility_test_path, '\n})\n', eligibility_tests)

pages_test_path = 'src/pages/compensation/CompensationPages.test.jsx'
old_calculation_test = """  it('defaults privileged revenue bonus work to the active operational store', async () => {
    mocked.app = {
      ...baseApp('business_support'),
      apiStatus: 'local',
      orders: [],
      activeStoreId: 'CH002',
      attendance: [{
        id: 'ATT-READY', employeeId: 'QL-02', storeId: 'CH002', workDate: '2026-08-26',
        shiftId: 'ca2', shiftName: 'Ca 2', shiftStart: '13:00', shiftEnd: '18:00',
        workedSeconds: 18_000, checkOutAt: '2026-08-26T18:00:00+07:00',
      }],
      shiftDefinitions: [{ id: 'ca2', storeId: 'CH002', name: 'Ca 2', start: '13:00', end: '18:00', active: true }],
    }
    render(<RevenueBonusPage />)

    expect(screen.getByLabelText('Cửa hàng').value).toBe('CH002')
    const calculateButton = screen.getByRole('button', { name: 'TÍNH THƯỞNG NGÀY' })
    expect(calculateButton.disabled).toBe(false)
    fireEvent.click(calculateButton)
    fireEvent.click(calculateButton)

    await waitFor(() => expect(mocked.app.calculateRevenueBonusDay).toHaveBeenCalledWith({
      storeId: 'CH002', businessDate: '2026-08-26',
    }))
    expect(mocked.app.calculateRevenueBonusDay).toHaveBeenCalledTimes(1)
    expect(await screen.findByRole('button', { name: 'ĐANG ĐỒNG BỘ KẾT QUẢ' })).toBeTruthy()
  })
"""
new_calculation_tests = """  it('keeps the current-day calculation button muted before 21:00 Vietnam time', () => {
    vi.setSystemTime(new Date('2026-08-26T13:59:59.000Z'))
    mocked.app = {
      ...baseApp('business_support'),
      apiStatus: 'local',
      orders: [],
      activeStoreId: 'CH002',
      attendance: [{
        id: 'ATT-READY', employeeId: 'QL-02', storeId: 'CH002', workDate: '2026-08-26',
        shiftId: 'ca2', shiftName: 'Ca 2', shiftStart: '13:00', shiftEnd: '18:00',
        workedSeconds: 18_000, checkOutAt: '2026-08-26T18:00:00+07:00',
      }],
      shiftDefinitions: [{ id: 'ca2', storeId: 'CH002', name: 'Ca 2', start: '13:00', end: '18:00', active: true }],
    }
    render(<RevenueBonusPage />)

    const calculateButton = screen.getByRole('button', { name: 'TÍNH SAU 21:00' })
    expect(calculateButton.disabled).toBe(true)
    expect(screen.getByText(/chỉ mở sau 21:00 mỗi ngày/i)).toBeTruthy()
    expect(mocked.app.calculateRevenueBonusDay).not.toHaveBeenCalled()
  })

  it('asks for confirmation and submits the active-store day only once after 21:00', async () => {
    vi.setSystemTime(new Date('2026-08-26T14:00:00.000Z'))
    const confirmSpy = vi.spyOn(window, 'confirm')
      .mockReturnValueOnce(false)
      .mockReturnValue(true)
    mocked.app = {
      ...baseApp('business_support'),
      apiStatus: 'local',
      orders: [],
      activeStoreId: 'CH002',
      attendance: [{
        id: 'ATT-READY', employeeId: 'QL-02', storeId: 'CH002', workDate: '2026-08-26',
        shiftId: 'ca2', shiftName: 'Ca 2', shiftStart: '13:00', shiftEnd: '18:00',
        workedSeconds: 18_000, checkOutAt: '2026-08-26T18:00:00+07:00',
      }],
      shiftDefinitions: [{ id: 'ca2', storeId: 'CH002', name: 'Ca 2', start: '13:00', end: '18:00', active: true }],
    }
    render(<RevenueBonusPage />)

    expect(screen.getByLabelText('Cửa hàng').value).toBe('CH002')
    const calculateButton = screen.getByRole('button', { name: 'TÍNH THƯỞNG NGÀY' })
    expect(calculateButton.disabled).toBe(false)
    expect(calculateButton.classList.contains('is-ready')).toBe(true)

    fireEvent.click(calculateButton)
    await waitFor(() => expect(confirmSpy).toHaveBeenCalledTimes(1))
    expect(mocked.app.calculateRevenueBonusDay).not.toHaveBeenCalled()

    fireEvent.click(calculateButton)
    fireEvent.click(calculateButton)

    await waitFor(() => expect(mocked.app.calculateRevenueBonusDay).toHaveBeenCalledWith({
      storeId: 'CH002',
      businessDate: '2026-08-26',
      idempotencyKey: 'revenue-bonus-day:ch002:2026-08-26',
    }))
    expect(confirmSpy).toHaveBeenCalledTimes(2)
    expect(confirmSpy).toHaveBeenLastCalledWith(expect.stringMatching(/chỉ được tính một lần trong ngày/i))
    expect(mocked.app.calculateRevenueBonusDay).toHaveBeenCalledTimes(1)
    expect(await screen.findByRole('button', { name: 'ĐANG ĐỒNG BỘ KẾT QUẢ' })).toBeTruthy()
  })
"""
replace_once(pages_test_path, old_calculation_test, new_calculation_tests)
