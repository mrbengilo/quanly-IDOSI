from pathlib import Path


def read(path):
    return Path(path).read_text(encoding='utf-8')


def write(path, text):
    Path(path).write_text(text, encoding='utf-8')


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected one match, found {count}')
    print(f'apply: {label}')
    return text.replace(old, new, 1)


def insert_before_last(text, marker, addition, label):
    index = text.rfind(marker)
    if index < 0:
        raise SystemExit(f'{label}: marker not found')
    print(f'apply: {label}')
    return text[:index] + addition + text[index:]


# Allocate the complete daily reward pool once. This prevents separate
# percentage/milestone rounding from changing an employee's total share.
domain_path = 'src/domain/automaticRevenueBonus.js'
domain = read(domain_path)
domain = replace_once(
    domain,
    """const safeAllocation = (poolVnd, participants) => participants.length
  ? allocateByLargestRemainder({ poolVnd, participants })
  : {
      poolVnd,
      totalWeightUnits: 0,
      allocatedVnd: 0,
      unallocatedVnd: poolVnd,
      allocations: [],
    }

const overrideSortKey = (record = {}) => {
""",
    """const safeAllocation = (poolVnd, participants) => participants.length
  ? allocateByLargestRemainder({ poolVnd, participants })
  : {
      poolVnd,
      totalWeightUnits: 0,
      allocatedVnd: 0,
      unallocatedVnd: poolVnd,
      allocations: [],
    }

const allocateComponentWithinFormulaTotals = (poolVnd, formulaAllocation) => {
  const formulaRows = Array.isArray(formulaAllocation?.allocations)
    ? formulaAllocation.allocations
    : []
  const totalWeightUnits = Number(formulaAllocation?.totalWeightUnits || 0)
  if (!formulaRows.length || totalWeightUnits <= 0) {
    return {
      poolVnd,
      totalWeightUnits: 0,
      allocatedVnd: 0,
      unallocatedVnd: poolVnd,
      allocations: [],
    }
  }

  const totalWeight = BigInt(totalWeightUnits)
  const pool = BigInt(poolVnd)
  const provisional = formulaRows.map((row) => {
    const numerator = pool * BigInt(row.weightUnits)
    const formulaAmountVnd = Number(row.amountVnd || 0)
    return {
      id: row.id,
      weightUnits: row.weightUnits,
      formulaAmountVnd,
      amountVnd: Math.min(Number(numerator / totalWeight), formulaAmountVnd),
      remainder: numerator % totalWeight,
    }
  })
  let remainingVnd = poolVnd - provisional.reduce((sum, row) => sum + row.amountVnd, 0)
  const remainderOrder = [...provisional].sort((left, right) => {
    if (left.remainder > right.remainder) return -1
    if (left.remainder < right.remainder) return 1
    return String(left.id).localeCompare(String(right.id), 'en-US')
  })

  while (remainingVnd > 0) {
    let advanced = false
    for (const row of remainderOrder) {
      if (row.amountVnd >= row.formulaAmountVnd) continue
      row.amountVnd += 1
      remainingVnd -= 1
      advanced = true
      if (remainingVnd === 0) break
    }
    if (!advanced) {
      throw new RangeError('Unable to reconcile revenue bonus component allocations.')
    }
  }

  const allocations = provisional.map(({ id, weightUnits, amountVnd }) => ({
    id,
    weightUnits,
    amountVnd,
  }))
  const allocatedVnd = allocations.reduce((sum, row) => sum + row.amountVnd, 0)
  return {
    poolVnd,
    totalWeightUnits,
    allocatedVnd,
    unallocatedVnd: poolVnd - allocatedVnd,
    allocations,
  }
}

const overrideSortKey = (record = {}) => {
""",
    'add total-pool component reconciliation',
)
domain = replace_once(
    domain,
    """  const participants = [...weights].map(([id, weightUnits]) => ({ id, weightUnits }))
  const percentageAllocation = safeAllocation(percentage.bonusVnd, participants)
  const milestoneAllocation = safeAllocation(milestone.amountVnd, participants)
  const formulaPercentageByEmployee = new Map(
    percentageAllocation.allocations.map((record) => [identifierKey(record.id), record.amountVnd]),
  )
  const formulaMilestoneByEmployee = new Map(
    milestoneAllocation.allocations.map((record) => [identifierKey(record.id), record.amountVnd]),
  )
""",
    """  const participants = [...weights].map(([id, weightUnits]) => ({ id, weightUnits }))
  const totalPoolVnd = percentage.bonusVnd + milestone.amountVnd
  const formulaAllocation = safeAllocation(totalPoolVnd, participants)
  const percentageAllocation = allocateComponentWithinFormulaTotals(
    percentage.bonusVnd,
    formulaAllocation,
  )
  const percentageByEmployeeId = new Map(
    percentageAllocation.allocations.map((record) => [identifierKey(record.id), record.amountVnd]),
  )
  const milestoneAllocations = formulaAllocation.allocations.map((record) => ({
    id: record.id,
    weightUnits: record.weightUnits,
    amountVnd: record.amountVnd - (percentageByEmployeeId.get(identifierKey(record.id)) || 0),
  }))
  const milestoneAllocatedVnd = milestoneAllocations.reduce(
    (sum, record) => sum + record.amountVnd,
    0,
  )
  const milestoneAllocation = {
    poolVnd: milestone.amountVnd,
    totalWeightUnits: formulaAllocation.totalWeightUnits,
    allocatedVnd: milestoneAllocatedVnd,
    unallocatedVnd: milestone.amountVnd - milestoneAllocatedVnd,
    allocations: milestoneAllocations,
  }
  const formulaPercentageByEmployee = new Map(
    percentageAllocation.allocations.map((record) => [identifierKey(record.id), record.amountVnd]),
  )
  const formulaMilestoneByEmployee = new Map(
    milestoneAllocation.allocations.map((record) => [identifierKey(record.id), record.amountVnd]),
  )
""",
    'allocate complete reward pool once',
)
domain = replace_once(
    domain,
    '  const totalWeightUnits = percentageAllocation.totalWeightUnits\n',
    '  const totalWeightUnits = formulaAllocation.totalWeightUnits\n',
    'use complete-pool total weight',
)
domain = replace_once(
    domain,
    """  const unallocatedVnd = percentageAllocation.unallocatedVnd
    + milestoneAllocation.unallocatedVnd
    + excludedSupportShareVnd
""",
    """  const unallocatedVnd = formulaAllocation.unallocatedVnd
    + excludedSupportShareVnd
""",
    'calculate actual unallocated amount from complete pool',
)
domain = replace_once(
    domain,
    '    totalPoolVnd: percentage.bonusVnd + milestone.amountVnd,\n',
    '    totalPoolVnd,\n',
    'reuse complete reward pool',
)
write(domain_path, domain)


# Exact regression for the owner's 8h/8h/8h SM TNV example.
test_path = 'src/domain/automaticRevenueBonus.test.js'
tests = read(test_path)
exact_example_test = r"""
  it('records 1,400,000 VND payable from a 2,100,000 VND SM pool when one of three equal workers is support', () => {
    const result = calculateAutomaticRevenueBonusDay(base({
      programId: REVENUE_BONUS_PROGRAM_IDS.SM_DAILY,
      milestoneProgramId: TEAM_MILESTONE_PROGRAM_IDS.SM_DAILY_REVENUE,
      employees: [
        { id: 'A', name: 'Nhân viên A', unit: 'store', storeId: 'S01' },
        { id: 'B', name: 'Nhân viên B', unit: 'store', storeId: 'S01' },
        { id: 'C', name: 'Nhân viên hỗ trợ C', unit: 'store', storeId: 'HOME' },
      ],
      orders: [{
        id: 'O-SUPPORT-EXACT', storeId: 'S01', amount: 25_000_001, status: 'Hoàn tất',
        createdAt: '2026-09-03T10:00:00+07:00',
      }],
      supportTransfers: [{
        id: 'ST-C-EXACT', employeeId: 'C', fromStoreId: 'HOME', toStoreId: 'S01',
        startAt: '2026-09-03T00:00:00+07:00', endAt: '2026-09-04T00:00:00+07:00',
        status: 'ACTIVE',
      }],
      attendance: [{
        id: 'A-A-EXACT', storeId: 'S01', employeeId: 'A', workDate: '2026-09-03',
        workedSeconds: 28_800, checkOutAt: '2026-09-03T10:00:00.000Z',
      }, {
        id: 'A-B-EXACT', storeId: 'S01', employeeId: 'B', workDate: '2026-09-03',
        workedSeconds: 28_800, checkOutAt: '2026-09-03T10:00:00.000Z',
      }, {
        id: 'A-C-EXACT', storeId: 'S01', employeeId: 'C', workDate: '2026-09-03',
        supportTransferId: 'ST-C-EXACT', workedSeconds: 28_800,
        checkOutAt: '2026-09-03T10:00:00.000Z',
      }],
    }))

    expect(result).toMatchObject({
      percentagePoolVnd: 1_750_000,
      milestonePoolVnd: 350_000,
      totalPoolVnd: 2_100_000,
      formulaAllocatedVnd: 2_100_000,
      automaticAllocatedVnd: 1_400_000,
      allocatedVnd: 1_400_000,
      unallocatedVnd: 700_000,
      excludedSupportShareVnd: 700_000,
      totalWorkedSeconds: 86_400,
      participantCount: 3,
      eligibleParticipantCount: 2,
      supportExcludedCount: 1,
    })
    expect(allocation(result, 'A')).toMatchObject({
      workedSeconds: 28_800,
      weightPercent: 100 / 3,
      formulaShareVnd: 700_000,
      automaticAmountVnd: 700_000,
      amountVnd: 700_000,
    })
    expect(allocation(result, 'B')).toMatchObject({
      formulaShareVnd: 700_000,
      automaticAmountVnd: 700_000,
      amountVnd: 700_000,
    })
    expect(allocation(result, 'C')).toMatchObject({
      formulaShareVnd: 700_000,
      excludedSupportShareVnd: 700_000,
      automaticAmountVnd: 0,
      amountVnd: 0,
      supportTransferred: true,
      status: 'SUPPORT_EXCLUDED',
    })
  })

"""
tests = replace_once(
    tests,
    "  it('updates an open employee weight and allocation from trusted real time without a manual action', () => {\n",
    exact_example_test + "  it('updates an open employee weight and allocation from trusted real time without a manual action', () => {\n",
    'add exact 2.1m support-share regression',
)
write(test_path, tests)


# Make the actual amount that must be paid explicit on the store revenue page.
page_path = 'src/pages/compensation/RevenueBonusPage.jsx'
page = read(page_path)
page = replace_once(
    page,
    """        <MetricCard compact label="TỔNG QUỸ THƯỞNG" value={metricValue(money(poolTotal))} helper={automaticMode ? 'Gồm thưởng tỷ lệ và mốc cao nhất' : ''} icon={CircleDollarSign} tone="blue" />
        <MetricCard compact label="ĐÃ PHÂN BỔ HIỆU LỰC" value={metricValue(money(allocatedTotal))} helper={adminAdjustmentTotal !== 0 ? 'Đã gồm điều chỉnh của Admin' : 'Tự động theo giờ thực tế'} icon={WalletCards} tone="green" />
        <MetricCard compact label="CHƯA PHÂN BỔ THEO CÔNG THỨC" value={metricValue(money(unallocatedTotal))} helper={excludedSupportShareTotal > 0 ? 'Phần của giờ hỗ trợ được giữ lại, không trả cho người hỗ trợ' : unallocatedTotal > 0 ? 'Thiếu thời gian làm việc hợp lệ' : 'Đã đối soát'} icon={Clock3} tone={unallocatedTotal > 0 ? 'orange' : 'blue'} />
""",
    """        <MetricCard compact label="TỔNG QUỸ THƯỞNG" value={metricValue(money(poolTotal))} helper={excludedSupportShareTotal > 0 ? 'Quỹ công thức trước khi loại phần nhân viên hỗ trợ' : automaticMode ? 'Gồm thưởng tỷ lệ và mốc cao nhất' : ''} icon={CircleDollarSign} tone="blue" />
        <MetricCard compact label="THƯỞNG DOANH THU GHI NHẬN THỰC TẾ" value={metricValue(money(allocatedTotal))} helper={excludedSupportShareTotal > 0 ? 'Số tiền thực tế phải chi cho nhân viên chính' : adminAdjustmentTotal !== 0 ? 'Đã gồm điều chỉnh của Admin' : 'Tự động theo giờ thực tế'} icon={WalletCards} tone="green" />
        <MetricCard compact label={excludedSupportShareTotal > 0 ? 'PHẦN KHÔNG GHI NHẬN CHI' : 'CHƯA PHÂN BỔ THEO CÔNG THỨC'} value={metricValue(money(unallocatedTotal))} helper={excludedSupportShareTotal > 0 ? 'Tỷ trọng theo giờ của nhân viên hỗ trợ; thưởng tự động bằng 0 đ' : unallocatedTotal > 0 ? 'Thiếu thời gian làm việc hợp lệ' : 'Đã đối soát'} icon={Clock3} tone={unallocatedTotal > 0 ? 'orange' : 'blue'} />
""",
    'clarify actual recorded revenue bonus metrics',
)
page = replace_once(
    page,
    '      {unallocatedTotal > 0 && privileged && <InfoNote tone="orange">\n',
    '      {unallocatedTotal > 0 && (privileged || storeManager) && <InfoNote tone="orange">\n',
    'show support exclusion explanation to store managers',
)
page = replace_once(
    page,
    """        {excludedSupportShareTotal > 0
          ? `${money(excludedSupportShareTotal)} thuộc tỷ trọng giờ của nhân viên điều chuyển hỗ trợ: giờ vẫn nằm trong mẫu số nhưng nhân viên hỗ trợ không nhận thưởng doanh thu.`
          : 'Có quỹ chưa phân bổ do thiếu thời gian làm việc hợp lệ. Hệ thống sẽ tự phân bổ lại khi dữ liệu chấm công được cập nhật.'}
""",
    """        {excludedSupportShareTotal > 0
          ? `Giờ làm của nhân viên hỗ trợ vẫn nằm trong tổng giờ chia thưởng. Phần tỷ trọng ${money(excludedSupportShareTotal)} không được ghi nhận chi cho nhân viên hỗ trợ; số tiền thưởng doanh thu ghi nhận thực tế phải chi là ${money(allocatedTotal)}.`
          : 'Có quỹ chưa phân bổ do thiếu thời gian làm việc hợp lệ. Hệ thống sẽ tự phân bổ lại khi dữ liệu chấm công được cập nhật.'}
""",
    'explain actual payable support exclusion',
)
page = replace_once(
    page,
    '            <th>Thưởng tự động</th><th>Thưởng hiệu lực</th><th>Trạng thái</th>\n',
    '            <th>Thưởng tự động</th><th>Thưởng ghi nhận thực tế</th><th>Trạng thái</th>\n',
    'rename effective reward column',
)
page = replace_once(
    page,
    '                {allocation.supportTransferred && <small className="compensation-subline">Giờ làm vẫn được tính vào mẫu số chia thưởng.</small>}\n',
    '                {allocation.supportTransferred && <small className="compensation-subline">Theo công thức tự động: giờ làm vẫn được tính vào mẫu số; phần tỷ trọng {money(allocation.excludedSupportShareVnd || allocation.formulaShareVnd || 0)} không ghi nhận chi và thưởng tự động của nhân viên hỗ trợ bằng 0 đ.</small>}\n',
    'show excluded support share on employee row',
)
write(page_path, page)


page_test_path = 'src/pages/compensation/RevenueBonusStoreManager.test.jsx'
page_tests = read(page_test_path)
page_example_test = r"""
  it('shows 1,400,000 VND as the actual payable amount for the equal 8h/8h/8h support example', () => {
    const smStore = storesSeed.find((store) => store.id === 'SM-TNV')
    const homeStore = { id: 'DOSII-HOME', name: 'Dosii cửa hàng chính' }
    const employees = [
      { id: 'A', name: 'Nhân viên A', unit: 'store', storeId: smStore.id },
      { id: 'B', name: 'Nhân viên B', unit: 'store', storeId: smStore.id },
      { id: 'C', name: 'Nhân viên hỗ trợ C', unit: 'store', storeId: homeStore.id },
    ]
    mocked.app = {
      ...managerApp(smStore),
      session: { role: 'store_manager', employeeId: 'A', storeId: smStore.id },
      currentEmployee: employees[0],
      stores: [smStore, homeStore],
      employees,
      orders: [{
        id: 'SM-EXACT-ORDER', storeId: smStore.id, amount: 25_000_001, status: 'Hoàn tất',
        createdAt: '2026-09-03T10:00:00+07:00',
      }],
      attendance: employees.map((employee) => ({
        id: `SM-EXACT-${employee.id}`,
        storeId: smStore.id,
        employeeId: employee.id,
        workDate: '2026-09-03',
        workedSeconds: 28_800,
        checkOutAt: '2026-09-03T10:00:00+07:00',
        ...(employee.id === 'C' ? { supportTransferId: 'SM-EXACT-TRANSFER' } : {}),
      })),
      supportTransfers: [{
        id: 'SM-EXACT-TRANSFER',
        employeeId: 'C',
        fromStoreId: homeStore.id,
        toStoreId: smStore.id,
        startAt: '2026-09-03T00:00:00+07:00',
        endAt: '2026-09-04T00:00:00+07:00',
        status: 'ACTIVE',
      }],
    }

    render(<RevenueBonusPage storeScoped />)

    const actualMetric = screen.getByText('THƯỞNG DOANH THU GHI NHẬN THỰC TẾ').closest('.metric')
    const excludedMetric = screen.getByText('PHẦN KHÔNG GHI NHẬN CHI').closest('.metric')
    expect(within(actualMetric).getByText('1,400,000 đ')).toBeTruthy()
    expect(within(excludedMetric).getByText('700,000 đ')).toBeTruthy()
    expect(screen.getByText(/số tiền thưởng doanh thu ghi nhận thực tế phải chi là 1,400,000 đ/iu)).toBeTruthy()

    const table = screen.getByRole('heading', { name: 'Phân bổ thưởng tự động theo nhân viên' }).closest('section')
    const rowA = within(table).getByText('Nhân viên A').closest('tr')
    const rowB = within(table).getByText('Nhân viên B').closest('tr')
    const rowC = within(table).getByText('Nhân viên hỗ trợ C').closest('tr')
    expect(within(rowA).getAllByRole('cell')[5].textContent).toBe('700,000 đ')
    expect(within(rowA).getAllByRole('cell')[6].textContent).toBe('700,000 đ')
    expect(within(rowB).getAllByRole('cell')[5].textContent).toBe('700,000 đ')
    expect(within(rowB).getAllByRole('cell')[6].textContent).toBe('700,000 đ')
    expect(within(rowC).getAllByRole('cell')[5].textContent).toBe('0 đ')
    expect(within(rowC).getAllByRole('cell')[6].textContent).toBe('0 đ')
    expect(within(rowC).getByText('Hỗ trợ cửa hàng – không nhận thưởng')).toBeTruthy()
    expect(within(rowC).getByText(/phần tỷ trọng 700,000 đ không ghi nhận chi/iu)).toBeTruthy()
  })
"""
page_tests = insert_before_last(
    page_tests,
    '\n})',
    '\n' + page_example_test,
    'add store revenue example UI regression',
)
write(page_test_path, page_tests)


# Tag inbound support employees in the detailed store payroll table.
store_page_path = 'src/pages/store/StoreV2Pages.jsx'
store_page = read(store_page_path)
store_page = replace_once(
    store_page,
    """    const supportTransferIds = snapshotRow
      ? (Array.isArray(snapshotRow.supportTransferIds)
          ? snapshotRow.supportTransferIds
          : snapshotRow.supportCompensation?.transferIds || [])
      : supportTransferIdentifiers(supportDetails)
    const manualBonus = snapshotRow ? Number(snapshotRow.manualBonusVnd || 0) : canonical.manual + Math.max(0, legacyAdjustmentNet)
""",
    """    const supportTransferIds = snapshotRow
      ? (Array.isArray(snapshotRow.supportTransferIds)
          ? snapshotRow.supportTransferIds
          : snapshotRow.supportCompensation?.transferIds || [])
      : supportTransferIdentifiers(supportDetails)
    const supportOriginStoreId = compactIdentifier(
      snapshotRow?.supportCompensation?.homeStoreId
      || snapshotRow?.supportHomeStoreId
      || supportDetails[0]?.support?.homeStoreId
      || (supportTransferIds.length > 0 ? employee.storeId : ''),
    )
    const supportOriginStoreMatch = supportOriginStoreId
      ? operationalIdentifierRecordMatch(stores, supportOriginStoreId, (item) => [item.id])
      : { record: null, ambiguous: false }
    const supportOriginStoreName = compactIdentifier(
      snapshotRow?.supportCompensation?.homeStoreName
      || snapshotRow?.supportHomeStoreName
      || supportDetails[0]?.support?.homeStoreName
      || (!supportOriginStoreMatch.ambiguous ? supportOriginStoreMatch.record?.name : '')
      || supportOriginStoreId
      || 'Cửa hàng khác',
    )
    const isSupportEmployee = snapshotRow
      ? Boolean(
          snapshotRow.isSupportEmployee
          || snapshotRow.supportCompensation?.isSupportEmployee
          || supportTransferIds.length > 0
          || Number(snapshotRow.supportActualPay || 0) > 0
        )
      : inboundSupport
    const manualBonus = snapshotRow ? Number(snapshotRow.manualBonusVnd || 0) : canonical.manual + Math.max(0, legacyAdjustmentNet)
""",
    'derive support employee origin for payroll rows',
)
store_page = replace_once(
    store_page,
    """      supportWorkBonus,
      supportTransferIds,
      manualBonus,
""",
    """      supportWorkBonus,
      supportTransferIds,
      isSupportEmployee,
      supportOriginStoreId,
      supportOriginStoreName,
      manualBonus,
""",
    'expose support employee origin on payroll rows',
)
store_page = replace_once(
    store_page,
    """{rows.map((row) => <tr key={row.rowKey}><td><strong>{row.employee.name}</strong><small className="table-note">{row.employee.id} • {row.employee.employmentType}</small></td>""",
    """{rows.map((row) => <tr key={row.rowKey}><td><strong>{row.employee.name}</strong>{row.isSupportEmployee && <small className="table-note"><Badge tone="orange">Nhân viên hỗ trợ • {row.supportOriginStoreName || row.supportOriginStoreId || 'Cửa hàng khác'}</Badge></small>}<small className="table-note">{row.employee.id} • {row.employee.employmentType}</small></td>""",
    'render orange support employee home-store tag',
)
write(store_page_path, store_page)


store_test_path = 'src/pages/store/StoreV2Pages.metrics.test.jsx'
store_tests = read(store_test_path)
store_tests = replace_once(
    store_tests,
    """    let row = within(table).getByText(supportEmployee.name).closest('tr')
    expect(within(row).getAllByRole('cell')[4].textContent).toContain('25,000 đ')
""",
    """    let row = within(table).getByText(supportEmployee.name).closest('tr')
    const supportTag = within(row).getByText('Nhân viên hỗ trợ • Dosii TNV')
    expect(supportTag.className).toContain('badge--orange')
    expect(within(row).getAllByRole('cell')[4].textContent).toContain('25,000 đ')
""",
    'verify live support employee orange tag',
)
store_tests = replace_once(
    store_tests,
    """    const supportRow = within(table).getByText('Tên snapshot hỗ trợ').closest('tr')
    expect(within(homeRow).getByText(/home-code/i)).toBeTruthy()
""",
    """    const supportRow = within(table).getByText('Tên snapshot hỗ trợ').closest('tr')
    const snapshotSupportTag = within(supportRow).getByText('Nhân viên hỗ trợ • Dosii TNV')
    expect(snapshotSupportTag.className).toContain('badge--orange')
    expect(within(homeRow).getByText(/home-code/i)).toBeTruthy()
""",
    'verify immutable support employee orange tag',
)
write(store_test_path, store_tests)

print('Support bonus and payroll tag patch applied successfully.')
