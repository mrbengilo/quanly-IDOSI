from pathlib import Path

path = Path('src/pages/compensation/RevenueBonusPage.jsx')
text = path.read_text(encoding='utf-8')

replacements = [
    (
        "const employeeIdentifiers = (employee = {}) => [employee.id, employee.code, employee.employeeId].filter(Boolean)\n",
        "",
        'remove obsolete employee identifier helper',
    ),
    (
        """  const allDailyRecords = Array.isArray(app.revenueBonusDaily)
    ? app.revenueBonusDaily
    : (app.revenueBonuses || [])
  const legacyDailyRecords = allDailyRecords.filter((record) => (
    revenueRecordDate(record) < AUTOMATIC_REVENUE_BONUS_EFFECTIVE_DATE
  ))
""",
        """  const legacyDailyRecords = useMemo(() => {
    const source = Array.isArray(app.revenueBonusDaily)
      ? app.revenueBonusDaily
      : (app.revenueBonuses || [])
    return source.filter((record) => (
      revenueRecordDate(record) < AUTOMATIC_REVENUE_BONUS_EFFECTIVE_DATE
    ))
  }, [app.revenueBonusDaily, app.revenueBonuses])
""",
        'memoize legacy daily records',
    ),
    (
        """  useEffect(() => {
    if (!selectedStoreId || !serverBacked || !automaticMode) {
      setRemoteLiveSnapshot(null)
      setRemotePollError(null)
      setRemoteLastSuccess(null)
      return undefined
    }
""",
        """  useEffect(() => {
    if (!selectedStoreId || !serverBacked || !automaticMode) return undefined
""",
        'avoid synchronous effect state reset',
    ),
]

for old, new, label in replacements:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected one match, found {count}')
    text = text.replace(old, new, 1)
    print(f'apply: {label}')

path.write_text(text, encoding='utf-8')
print('Automatic revenue page lint findings resolved.')
