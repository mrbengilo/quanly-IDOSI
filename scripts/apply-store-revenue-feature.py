from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text(encoding='utf-8')
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'Expected one match in {path}, found {count}: {old[:160]!r}')
    file.write_text(text.replace(old, new, 1), encoding='utf-8')


def append_once(path: str, marker: str, addition: str) -> None:
    file = Path(path)
    text = file.read_text(encoding='utf-8')
    if marker in text:
        return
    file.write_text(text.rstrip() + '\n\n' + addition.strip() + '\n', encoding='utf-8')


replace_once(
    'src/main.jsx',
    "import './supportSchedule.css'\n",
    "import './supportSchedule.css'\nimport './storeOperationalEnhancements.css'\n",
)

replace_once(
    'src/pages/store/StoreV2Pages.jsx',
    "import { storeDailyReportRows, storeMonthlyReportRows } from './storeReportAnalytics'\n",
    "import { storeDailyReportRows, storeMonthlyReportRows } from './storeReportAnalytics'\nimport { groupOrdersForDisplay } from './orderShiftGroups'\n",
)

replace_once(
    'src/pages/store/StoreV2Pages.jsx',
    """  const groups = useMemo(() => {
    const keyOf = view === 'employee'
      ? (order) => order.employeeId || 'system'
      : view === 'day'
        ? (order) => businessDate(order.createdAt)
        : (order) => `${businessDate(order.createdAt)}:${order.shiftId || 'none'}`
    return [...filtered.reduce((map, order) => {
      const key = keyOf(order)
      if (!map.has(key)) map.set(key, [])
      map.get(key).push(order)
      return map
    }, new Map()).entries()]
  }, [filtered, view])
""",
    """  const groups = useMemo(() => groupOrdersForDisplay(filtered, view), [filtered, view])
""",
)

replace_once(
    'src/pages/store/StoreV2Pages.jsx',
    """        const title = view === 'employee'
          ? `${first.employeeName || 'Dữ liệu hệ thống'} — ${first.employeeId || ''}`
          : view === 'day'
            ? `Ngày ${shortDate(businessDate(first.createdAt))}`
            : `${first.shiftName || 'Chưa gắn ca'} — ${first.shiftStart || '--:--'}–${first.shiftEnd || '--:--'} — ${shortDate(businessDate(first.createdAt))}`
        return <Card key={key} className="order-group" title={title} action={<div className="order-group__totals"><strong>{money(groupTotal)}</strong><span>{group.length} đơn</span></div>}><TableWrap>""",
    """        const title = view === 'employee'
          ? `${first.employeeName || 'Dữ liệu hệ thống'} — ${first.employeeId || ''}`
          : view === 'day'
            ? `Ngày ${shortDate(businessDate(first.createdAt))}`
            : <span className="order-group__shift-title">
                <strong>{first.shiftName || 'Chưa gắn ca'}</strong>
                <small>{first.shiftStart || '--:--'}–{first.shiftEnd || '--:--'} · {shortDate(businessDate(first.createdAt))}</small>
              </span>
        return <Card key={key} className="order-group" title={title} action={<div className="order-group__totals">
          <span className="order-group__total-amount"><small>Tổng tiền ca</small><strong>{money(groupTotal)}</strong></span>
          <span className="order-group__order-count"><small>Số lượng đơn</small><strong>{group.length}</strong><em>đơn</em></span>
        </div>}><TableWrap>""",
)

replace_once(
    'src/pages/compensation/RevenueBonusPage.jsx',
    """    calculationEligibility: revenueBonusEligibility({
      storeId,
      businessDate: selectedDate,
      schedule: Array.isArray(app.schedule) ? app.schedule : [],
      shiftDefinitions: Array.isArray(app.shiftDefinitions) ? app.shiftDefinitions : [],
      attendance: app.attendance,
      dailyRecords: Array.isArray(app.revenueBonusDaily) ? app.revenueBonusDaily : (app.revenueBonuses || []),
    }),""",
    """    calculationEligibility: revenueBonusEligibility({
      storeId,
      businessDate: selectedDate,
      schedule: Array.isArray(app.schedule) ? app.schedule : [],
      shiftDefinitions: Array.isArray(app.shiftDefinitions) ? app.shiftDefinitions : [],
      attendance: app.attendance,
      employees: employeeRecords,
      dailyRecords: Array.isArray(app.revenueBonusDaily) ? app.revenueBonusDaily : (app.revenueBonuses || []),
      nowMs,
    }),""",
)

replace_once(
    'src/pages/compensation/RevenueBonusPage.jsx',
    """  const shouldTickLocalClock = !serverBacked
    && businessDate === vietnamToday()
    && (app.attendance || []).some((attendance) => (
      !attendance.deletedAt
      && sameOperationalIdentifier(entryStoreId(attendance), selectedStoreId)
      && recordBusinessDate(attendance) === businessDate
      && !attendance.checkOutAt
      && !attendance.checkOut
    ))""",
    """  const shouldTickLocalClock = !serverBacked && businessDate === vietnamToday()""",
)

replace_once(
    'src/pages/compensation/RevenueBonusPage.jsx',
    """    || (serverBacked
      ? 'Đang kiểm tra trạng thái ca cuối cùng và kết quả thưởng đã lưu.'
      : 'Chưa đủ dữ liệu để kiểm tra điều kiện tính thưởng doanh thu.')

  if (!allowed || !selectedStoreId)""",
    """    || (serverBacked
      ? 'Đang kiểm tra trạng thái ca cuối cùng và kết quả thưởng đã lưu.'
      : 'Chưa đủ dữ liệu để kiểm tra điều kiện tính thưởng doanh thu.')
  const openAttendanceAlert = privileged && calculationEligibility?.code === 'ATTENDANCE_OPEN'

  if (!allowed || !selectedStoreId)""",
)

replace_once(
    'src/pages/compensation/RevenueBonusPage.jsx',
    """  const calculate = async () => {
    if (!calculationReady || submittedCalculationRef.current === calculationScope) return
    submittedCalculationRef.current = calculationScope
    const result = await run({""",
    """  const calculate = async () => {
    if (!calculationReady || submittedCalculationRef.current === calculationScope) return
    const confirmed = typeof window === 'undefined' || window.confirm(
      `Xác nhận tính thưởng doanh thu ngày ${displayDate(businessDate)} cho ${storeName(stores, selectedStoreId)}?\n\nMỗi cửa hàng chỉ được tính một lần cho ngày này và không thể tính lại.`,
    )
    if (!confirmed) return
    submittedCalculationRef.current = calculationScope
    const result = await run({""",
)

replace_once(
    'src/pages/compensation/RevenueBonusPage.jsx',
    """        actions={privileged && <Button
          icon={calculationDone ? CheckCircle2 : Calculator}""",
    """        actions={privileged && <Button
          className={`revenue-bonus-calculate-button${calculationReady ? ' is-ready' : ''}`}
          icon={calculationDone ? CheckCircle2 : Calculator}""",
)

replace_once(
    'src/pages/compensation/RevenueBonusPage.jsx',
    """        {privileged && <InfoNote tone={eligibilityTone}>{eligibilityMessage}</InfoNote>}""",
    """        {privileged && (openAttendanceAlert ? <div className="revenue-bonus-attendance-alert" role="alert">
          <Clock3 size={28} aria-hidden="true" />
          <div><strong>CHƯA THỂ TÍNH THƯỞNG NGÀY</strong><p>{eligibilityMessage}</p></div>
        </div> : <InfoNote tone={eligibilityTone}>{eligibilityMessage}</InfoNote>)}""",
)

replace_once(
    'server/worker.js',
    """    schedule: Array.isArray(state?.schedule) ? state.schedule : [],
    shiftDefinitions: Array.isArray(state?.shiftDefinitions) ? state.shiftDefinitions : [],
    attendance: Array.isArray(state?.attendance) ? state.attendance : [],
    dailyRecords: Array.isArray(state?.revenueBonusDaily) ? state.revenueBonusDaily : [],""",
    """    schedule: Array.isArray(state?.schedule) ? state.schedule : [],
    shiftDefinitions: Array.isArray(state?.shiftDefinitions) ? state.shiftDefinitions : [],
    attendance: Array.isArray(state?.attendance) ? state.attendance : [],
    employees: Array.isArray(state?.employees) ? state.employees : [],
    dailyRecords: Array.isArray(state?.revenueBonusDaily) ? state.revenueBonusDaily : [],
    nowMs,""",
)

replace_once(
    'server/worker.js',
    """    schedule: Array.isArray(state.schedule) ? state.schedule : [],
    shiftDefinitions: Array.isArray(state.shiftDefinitions) ? state.shiftDefinitions : [],
    attendance: Array.isArray(state.attendance) ? state.attendance : [],
    dailyRecords,
  })""",
    """    schedule: Array.isArray(state.schedule) ? state.schedule : [],
    shiftDefinitions: Array.isArray(state.shiftDefinitions) ? state.shiftDefinitions : [],
    attendance: Array.isArray(state.attendance) ? state.attendance : [],
    employees: Array.isArray(state.employees) ? state.employees : [],
    dailyRecords,
    nowMs: Date.parse(commandContext.now),
  })""",
)

replace_once(
    'src/pages/compensation/CompensationPages.test.jsx',
    """  it('defaults privileged revenue bonus work to the active operational store', async () => {
    mocked.app = {""",
    """  it('defaults privileged revenue bonus work to the active operational store', async () => {
    vi.setSystemTime(new Date('2026-08-26T14:05:00.000Z'))
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    mocked.app = {""",
)

replace_once(
    'src/pages/compensation/CompensationPages.test.jsx',
    """    expect(mocked.app.calculateRevenueBonusDay).toHaveBeenCalledTimes(1)
    expect(await screen.findByRole('button', { name: 'ĐANG ĐỒNG BỘ KẾT QUẢ' })).toBeTruthy()
  })""",
    """    expect(mocked.app.calculateRevenueBonusDay).toHaveBeenCalledTimes(1)
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(await screen.findByRole('button', { name: 'ĐANG ĐỒNG BỘ KẾT QUẢ' })).toBeTruthy()
  })""",
)

append_once(
    'src/pages/store/StoreOrdersPage.orderInformation.test.jsx',
    "describe('StoreOrdersPage shift grouping'",
    """describe('StoreOrdersPage shift grouping', () => {
  it('renders the newest shift first with distinct shift, amount and order-count indicators', () => {
    mocked.app = {
      ...makeApp(),
      orders: [
        order({ id: 'ORDER-MORNING', code: 'S01-00001', shiftId: 'morning', shiftName: 'Ca sáng', shiftStart: '08:00', shiftEnd: '12:00', amount: 100_000, createdAt: '2026-08-25T08:30:00+07:00' }),
        order({ id: 'ORDER-AFTERNOON', code: 'S01-00002', shiftId: 'afternoon', shiftName: 'Ca chiều', shiftStart: '13:00', shiftEnd: '17:30', amount: 200_000, createdAt: '2026-08-25T14:00:00+07:00' }),
        order({ id: 'ORDER-NIGHT-1', code: 'S01-00003', shiftId: 'night', shiftName: 'Ca tối', shiftStart: '18:00', shiftEnd: '21:00', amount: 300_000, createdAt: '2026-08-25T18:30:00+07:00' }),
        order({ id: 'ORDER-NIGHT-2', code: 'S01-00004', shiftId: 'night', shiftName: 'Ca tối', shiftStart: '18:00', shiftEnd: '21:00', amount: 400_000, createdAt: '2026-08-25T20:00:00+07:00' }),
      ],
    }
    const { container } = renderPage()
    const groups = [...container.querySelectorAll('.order-group')]

    expect(groups.map((group) => group.querySelector('.order-group__shift-title strong')?.textContent)).toEqual([
      'Ca tối', 'Ca chiều', 'Ca sáng',
    ])
    expect(groups[0].querySelector('.order-group__total-amount strong')?.textContent).toBe('700,000 đ')
    expect(groups[0].querySelector('.order-group__order-count strong')?.textContent).toBe('2')
  })
})""",
)
