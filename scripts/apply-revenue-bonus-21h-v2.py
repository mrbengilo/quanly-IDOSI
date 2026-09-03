from pathlib import Path


def read(path):
    return Path(path).read_text(encoding='utf-8')


def write(path, text):
    Path(path).write_text(text, encoding='utf-8')


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected exactly one match, found {count}')
    print(f'apply: {label}')
    return text.replace(old, new, 1)


def replace_section(text, start_marker, end_marker, replacement, label):
    start = text.find(start_marker)
    if start < 0:
        raise SystemExit(f'{label}: start marker not found')
    end = text.find(end_marker, start + len(start_marker))
    if end < 0:
        raise SystemExit(f'{label}: end marker not found')
    print(f'apply: {label}')
    return text[:start] + replacement + text[end:]


def insert_before_last(text, marker, addition, label):
    position = text.rfind(marker)
    if position < 0:
        raise SystemExit(f'{label}: final marker not found')
    print(f'apply: {label}')
    return text[:position] + addition + text[position:]


# Server-authoritative eligibility shared by the live endpoint and calculate command.
eligibility_path = 'src/domain/revenueBonusEligibility.js'
eligibility = read(eligibility_path)
eligibility = replace_once(
    eligibility,
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
    'eligibility clock helpers',
)
eligibility = replace_once(
    eligibility,
    "  DATA_COLLISION: 'Ngày này có nhiều kết quả thưởng đang hiệu lực; cần xử lý dữ liệu trùng.',\n",
    """  DATA_COLLISION: 'Ngày này có nhiều kết quả thưởng đang hiệu lực; cần xử lý dữ liệu trùng.',
  DAILY_WINDOW_NOT_OPEN: 'Nút TÍNH THƯỞNG NGÀY chỉ mở từ 21:00 mỗi ngày (giờ Việt Nam).',
  FUTURE_DATE: 'Không thể tính thưởng doanh thu cho ngày trong tương lai.',
""",
    'eligibility messages',
)
eligibility = replace_once(
    eligibility,
    "  dailyRecords = [],\n} = {}) {\n",
    "  dailyRecords = [],\n  now = Date.now(),\n} = {}) {\n",
    'eligibility now parameter',
)
eligibility = replace_once(
    eligibility,
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
    'eligibility current Vietnam clock',
)
eligibility = replace_once(
    eligibility,
    "    finalShiftEndAt: null,\n  }\n",
    """    finalShiftEndAt: null,
    currentBusinessDate: clock.businessDate,
    dailyWindowOpensAt: REVENUE_BONUS_DAILY_OPEN_LABEL,
  }
""",
    'eligibility public clock details',
)
eligibility = replace_once(
    eligibility,
    "  const candidates = scheduleShiftCandidates({ schedule, shiftDefinitions, storeId, businessDate })\n",
    """  if (businessDate > clock.businessDate) {
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
    'eligibility daily window gate',
)
write(eligibility_path, eligibility)


# Store and global revenue bonus UI.
page_path = 'src/pages/compensation/RevenueBonusPage.jsx'
page = read(page_path)
page = replace_once(
    page,
    "      dailyRecords: Array.isArray(app.revenueBonusDaily) ? app.revenueBonusDaily : (app.revenueBonuses || []),\n    }),\n",
    """      dailyRecords: Array.isArray(app.revenueBonusDaily) ? app.revenueBonusDaily : (app.revenueBonuses || []),
      now: nowMs,
    }),
""",
    'page local eligibility clock',
)
page = replace_section(
    page,
    "  const shouldTickLocalClock = !serverBacked\n",
    "  useEffect(() => {\n",
    "  const shouldTickLocalClock = !serverBacked && businessDate === vietnamToday()\n",
    'page tick through 21:00 boundary',
)
page = replace_once(
    page,
    "  const calculationCollision = calculationEligibility?.code === 'DATA_COLLISION' || selectedDayCollision\n",
    """  const calculationCollision = calculationEligibility?.code === 'DATA_COLLISION' || selectedDayCollision
  const calculationWindowClosed = calculationEligibility?.code === 'DAILY_WINDOW_NOT_OPEN'
""",
    'page daily window state',
)
page = replace_section(
    page,
    "  const calculate = async () => {\n",
    "  const decideMilestone = (claim, approve) => {\n",
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

  const decideMilestone = (claim, approve) => {
""",
    'page confirmation and deterministic idempotency',
)
page = replace_section(
    page,
    "        actions={privileged && <Button\n",
    "      />\n      <Card className=\"compensation-filter-card\">\n",
    """        actions={privileged && <Button
          className={`revenue-bonus-calculate-button ${calculationReady ? 'is-ready' : calculationWindowClosed ? 'is-time-locked' : ''}`}
          icon={calculationDone ? CheckCircle2 : Calculator}
          loading={busyKey === 'calculate'}
          disabled={Boolean(busyKey) || !calculationReady}
          onClick={calculate}
          title={eligibilityMessage}
        >{awaitingSavedResult ? 'ĐANG ĐỒNG BỘ KẾT QUẢ' : calculationDone ? 'ĐÃ TÍNH THƯỞNG' : 'TÍNH THƯỞNG NGÀY'}</Button>}
      />
      <Card className="compensation-filter-card">
""",
    'page prominent ready button',
)
write(page_path, page)


# Make the eligible action visually prominent without changing the existing primary palette.
css_path = 'src/pages/compensation/compensation-page.css'
css = read(css_path)
if '.revenue-bonus-calculate-button.is-ready' in css:
    raise SystemExit('revenue bonus button styles already exist')
css = css.rstrip() + """

.revenue-bonus-calculate-button {
  transition: box-shadow 180ms ease, opacity 180ms ease, transform 180ms ease;
}

.revenue-bonus-calculate-button.is-time-locked:disabled {
  box-shadow: none;
  opacity: .58;
}

.revenue-bonus-calculate-button.is-ready:not(:disabled) {
  box-shadow: 0 0 0 4px rgba(7, 136, 63, .16), 0 10px 24px rgba(7, 136, 63, .24);
  transform: translateY(-1px);
}

.revenue-bonus-calculate-button.is-ready:not(:disabled):hover {
  box-shadow: 0 0 0 5px rgba(7, 136, 63, .18), 0 12px 28px rgba(7, 136, 63, .28);
  transform: translateY(-2px);
}
""" + '\n'
write(css_path, css)


# Domain regression coverage for the exact Vietnam-time boundary.
eligibility_test_path = 'src/domain/revenueBonusEligibility.test.js'
eligibility_test = read(eligibility_test_path)
eligibility_test = insert_before_last(
    eligibility_test,
    '\n})\n',
    """

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
""",
    'eligibility boundary tests',
)
write(eligibility_test_path, eligibility_test)


# UI regression coverage: time lock, confirmation, prominence and one request per store/day.
pages_test_path = 'src/pages/compensation/CompensationPages.test.jsx'
pages_test = read(pages_test_path)
pages_test = replace_section(
    pages_test,
    "  it('defaults privileged revenue bonus work to the active operational store', async () => {\n",
    "  it('clears the employee history filter when a global Admin switches stores', () => {\n",
    """  it('keeps the current-day calculation button muted before 21:00 Vietnam time', () => {
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

    const calculateButton = screen.getByRole('button', { name: 'TÍNH THƯỞNG NGÀY' })
    expect(calculateButton.disabled).toBe(true)
    expect(calculateButton.classList.contains('is-time-locked')).toBe(true)
    expect(screen.getByText(/chỉ mở từ 21:00 mỗi ngày/i)).toBeTruthy()
    expect(mocked.app.calculateRevenueBonusDay).not.toHaveBeenCalled()
  })

  it('asks for confirmation and submits the active-store day only once from 21:00', async () => {
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
    expect(confirmSpy).toHaveBeenCalledTimes(1)
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

  it('clears the employee history filter when a global Admin switches stores', () => {
""",
    'revenue bonus interaction tests',
)
write(pages_test_path, pages_test)

print('Revenue bonus 21:00 controls applied successfully.')
