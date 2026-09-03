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


def append_once(text, marker, addition, label):
    if marker in text:
        raise SystemExit(f'{label}: marker already exists')
    print(f'apply: {label}')
    return text.rstrip() + '\n\n' + addition.strip() + '\n'


# Store operational screens: orders, attendance and payroll.
path = 'src/pages/store/StoreV2Pages.jsx'
text = read(path)
text = replace_once(
    text,
    "import { SearchableSelect } from '../../components/SearchableSelect'\n",
    "import { SearchableSelect } from '../../components/SearchableSelect'\nimport { SupportEmployeeTag } from '../../components/SupportEmployeeTag'\n",
    'StoreV2Pages support tag import',
)
text = replace_once(
    text,
    """    employees = [],
    orderInformationOptions = [],
""",
    """    employees = [],
    stores = [],
    supportTransfers = [],
    orderInformationOptions = [],
""",
    'StoreOrders support context collections',
)
text = replace_once(
    text,
    """  const employeeOptions = employees.filter((employee) => String(employee.unit || 'store') === 'store'
    && employee.storeId === storeId)
""",
    """  const orderEmployeeIds = new Set(storeOrders
    .flatMap((order) => [order.employeeId, order.employeeCode])
    .map(compactIdentifier)
    .filter(Boolean)
    .map((identifier) => identifier.toLocaleLowerCase('en-US')))
  const employeeOptions = employees.filter((employee) => String(employee.unit || 'store') === 'store'
    && (sameOperationalIdentifier(employee.storeId, storeId)
      || employeeIdentifierValues(employee).some((identifier) => (
        orderEmployeeIds.has(identifier.toLocaleLowerCase('en-US'))
      ))))
""",
    'StoreOrders include inbound support employees',
)
text = replace_once(
    text,
    """<td>{order.employeeName}<small className="table-note">{order.employeeId}</small></td>""",
    """<td><strong>{order.employeeName || employeeFor(employees, order.employeeId)?.name || order.employeeId || '—'}</strong><SupportEmployeeTag record={order} employeeId={order.employeeId || order.employeeCode} storeId={storeId} businessDate={businessDate(order.createdAt || order.date)} employees={employees} stores={stores} supportTransfers={supportTransfers} className="table-note" /><small className="table-note">{order.employeeId || order.employeeCode || '—'}</small></td>""",
    'StoreOrders render standardized support tag',
)
text = replace_once(
    text,
    """{pay.kind === 'support' ? <><Badge tone="orange">NV hỗ trợ</Badge><small className="table-note">{pay.support.homeStoreName || homeStore?.name || homeStoreId || 'Cửa hàng chính'} → {pay.support.supportStoreName || supportStore?.name || store?.name || storeId}</small>""",
    """{pay.kind === 'support' ? <><SupportEmployeeTag record={{ ...record, supportCompensation: pay.support, supportStoreId: storeId, isSupportEmployee: true }} employee={employee} employeeId={attendanceEmployeeReference(record)} storeId={storeId} businessDate={record.date || record.workDate || record.checkInAt} employees={employees} stores={stores} supportTransfers={supportTransfers} /><small className="table-note">{pay.support.homeStoreName || homeStore?.name || homeStoreId || 'Cửa hàng chính'} → {pay.support.supportStoreName || supportStore?.name || store?.name || storeId}</small>""",
    'StoreAttendance apply support tag cutover',
)
text = replace_once(
    text,
    """{rows.map((row) => <tr key={row.rowKey}><td><strong>{row.employee.name}</strong><small className="table-note">{row.employee.id} • {row.employee.employmentType}</small></td>""",
    """{rows.map((row) => <tr key={row.rowKey}><td><strong>{row.employee.name}</strong><SupportEmployeeTag record={{ employeeId: row.employee.id, isSupportEmployee: row.isSupportEmployee, supportHomeStoreId: row.supportOriginStoreId, supportHomeStoreName: row.supportOriginStoreName, supportStoreId: storeId, supportStoreName: store?.name, supportTransferIds: row.supportTransferIds }} employee={row.employee} employeeId={row.employee.id} storeId={storeId} businessDate={`${period}-01`} employees={employees} stores={stores} supportTransfers={supportTransfers} className="table-note" /><small className="table-note">{row.employee.id} • {row.employee.employmentType}</small></td>""",
    'StorePayroll standardize live and snapshot support tag',
)
write(path, text)


# Store employee roster and reward history entry point.
path = 'src/pages/store/StoreOperations.jsx'
text = read(path)
text = replace_once(
    text,
    "import { FinancialChart } from '../../components/Charts'\n",
    "import { FinancialChart } from '../../components/Charts'\nimport { SupportEmployeeTag } from '../../components/SupportEmployeeTag'\n",
    'StoreOperations support tag import',
)
text = replace_once(
    text,
    """<td><div className="person-cell"><Avatar name={employee.name} src={employee.avatar} employeeId={employee.id || employee.code} color={employee.color} /><span><strong>{employee.name}</strong><small>{employee.age ? `${employee.age} tuổi` : 'Chưa cập nhật tuổi'}</small></span></div></td>""",
    """<td><div className="person-cell"><Avatar name={employee.name} src={employee.avatar} employeeId={employee.id || employee.code} color={employee.color} /><span><strong>{employee.name}</strong><SupportEmployeeTag record={{ ...employee, businessDate: today(), supportAssignment: employee.supportAssignment, supportStoreId: scopedStoreId, homeStoreId: employee.homeStoreId || employee.storeId, isSupportEmployee: Boolean(employee.supportAssignment) }} employee={employee} employeeId={employee.id || employee.code} storeId={scopedStoreId} businessDate={today()} employees={employees} stores={stores} supportTransfers={supportTransfers} /><small>{employee.age ? `${employee.age} tuổi` : 'Chưa cập nhật tuổi'}</small></span></div></td>""",
    'StoreEmployees tag inbound support profile',
)
text = replace_once(
    text,
    """{employee.supportAssignment ? <div className="table-stack"><Badge tone="orange">Nhân viên hỗ trợ</Badge><small>{storeFor(stores, employee.supportAssignment.fromStoreId || employee.homeStoreId)?.name || employee.supportAssignment.fromStoreId || employee.homeStoreId} → {scopedStore?.name || scopedStoreId}</small>""",
    """{employee.supportAssignment ? <div className="table-stack"><SupportEmployeeTag record={{ ...employee, businessDate: today(), supportAssignment: employee.supportAssignment, supportStoreId: scopedStoreId, homeStoreId: employee.homeStoreId || employee.storeId, isSupportEmployee: true }} employee={employee} employeeId={employee.id || employee.code} storeId={scopedStoreId} businessDate={today()} employees={employees} stores={stores} supportTransfers={supportTransfers} /><small>{storeFor(stores, employee.supportAssignment.fromStoreId || employee.homeStoreId)?.name || employee.supportAssignment.fromStoreId || employee.homeStoreId} → {scopedStore?.name || scopedStoreId}</small>""",
    'StoreEmployees standardize assignment tag',
)
write(path, text)


# Shared reward-history table used by Store tasks.
path = 'src/pages/compensation/UnitCompensationStatistics.jsx'
text = read(path)
text = replace_once(
    text,
    "import { useMemo } from 'react'\n",
    "import { useCallback, useMemo } from 'react'\n",
    'UnitCompensationStatistics useCallback import',
)
text = replace_once(
    text,
    "import { Card } from '../../components/UI'\n",
    "import { Card } from '../../components/UI'\nimport { resolveSupportEmployeeTagContext } from '../../domain/supportEmployeeTag'\n",
    'UnitCompensationStatistics resolver import',
)
text = replace_once(
    text,
    """  const unitLabel = UNIT_LABELS[targetUnit] || 'đơn vị'

  const showReward = sections === 'all' || sections === 'reward'
""",
    """  const unitLabel = UNIT_LABELS[targetUnit] || 'đơn vị'
  const supportTagContextForRewardRow = useCallback((row) => targetUnit === 'store'
    ? resolveSupportEmployeeTagContext({
        record: row,
        employeeId: row.employeeId,
        storeId: row.storeId || storeId,
        businessDate: row.workDate || row.businessDate || row.date,
        employees: app.employees,
        stores: app.stores,
        supportTransfers: app.supportTransfers,
      })
    : null, [app.employees, app.stores, app.supportTransfers, storeId, targetUnit])

  const showReward = sections === 'all' || sections === 'reward'
""",
    'UnitCompensationStatistics support context callback',
)
text = replace_once(
    text,
    """        filterable={targetUnit === 'store'}
      />
""",
    """        filterable={targetUnit === 'store'}
        supportTagContextForRow={supportTagContextForRewardRow}
      />
""",
    'UnitCompensationStatistics pass support context',
)
write(path, text)

path = 'src/pages/compensation/CompensationStatisticsTables.jsx'
text = read(path)
text = replace_once(
    text,
    "import { Badge, Field, Input, Select, TableWrap } from '../../components/UI'\n",
    "import { Badge, Field, Input, Select, TableWrap } from '../../components/UI'\nimport { SupportEmployeeTag } from '../../components/SupportEmployeeTag'\n",
    'CompensationStatisticsTables support tag import',
)
text = replace_once(
    text,
    "export function RewardHistoryTable({ rows = [], employees = [], showEmployee = false, filterable = false, filterFields }) {\n",
    "export function RewardHistoryTable({ rows = [], employees = [], showEmployee = false, filterable = false, filterFields, supportTagContextForRow = null }) {\n",
    'RewardHistoryTable support callback prop',
)
text = replace_once(
    text,
    """          {showEmployee && <td><strong>{employeeName(employees, row.employeeId, row.employeeName)}</strong><small className="compensation-subline">{row.employeeId}</small></td>}
""",
    """          {showEmployee && <td><strong>{employeeName(employees, row.employeeId, row.employeeName)}</strong><SupportEmployeeTag context={supportTagContextForRow?.(row)} className="compensation-subline" /><small className="compensation-subline">{row.employeeId}</small></td>}
""",
    'RewardHistoryTable render support tag',
)
write(path, text)


# Unified schedule day/week/month/history and assignment pickers.
path = 'src/pages/store/UnifiedSchedule.jsx'
text = read(path)
text = replace_once(
    text,
    "import { useApp } from '../../state/AppContext'\n",
    "import { useApp } from '../../state/AppContext'\nimport { SupportEmployeeTag } from '../../components/SupportEmployeeTag'\nimport { resolveSupportEmployeeTagContext } from '../../domain/supportEmployeeTag'\n",
    'UnifiedSchedule support tag imports',
)
text = replace_once(
    text,
    """  const scheduleForEmployeeDate = (employeeId, targetDate) => scheduleByEmployeeDate.get(`${String(employeeId || '')}:${targetDate}`)

  const resolveScheduledShift = (record, shiftId) => resolveStoreScheduleShift({
""",
    """  const scheduleForEmployeeDate = (employeeId, targetDate) => scheduleByEmployeeDate.get(`${String(employeeId || '')}:${targetDate}`)
  const supportContextForEmployeeDate = (employee, targetDate) => resolveSupportEmployeeTagContext({
    record: {
      employeeId: employee.id || employee.code,
      storeId,
      businessDate: targetDate,
      supportAssignment: employee.supportAssignment,
      supportStoreId: employee.supportStoreId || storeId,
      homeStoreId: employee.homeStoreId || employee.storeId,
      isSupportEmployee: Boolean(employee.supportAssignment || employee.supportStoreId),
    },
    employee,
    employeeId: employee.id || employee.code,
    storeId,
    businessDate: targetDate,
    employees: allEmployees,
    stores: app.stores,
    supportTransfers,
  })
  const supportContextForEmployeeRange = (employee, dates) => (
    dates.map((targetDate) => supportContextForEmployeeDate(employee, targetDate)).find(Boolean) || null
  )

  const resolveScheduledShift = (record, shiftId) => resolveStoreScheduleShift({
""",
    'UnifiedSchedule support context resolvers',
)
text = replace_once(
    text,
    """      <td><div className="person-cell"><Avatar name={employee.name} src={employee.avatar} employeeId={employee.id || employee.code} color={employee.color} /><span><strong>{employee.name}</strong><small>{employee.code || employee.id} · {employeeRole(employee)}</small></span></div></td>
""",
    """      <td><div className="person-cell"><Avatar name={employee.name} src={employee.avatar} employeeId={employee.id || employee.code} color={employee.color} /><span><strong>{employee.name}</strong><SupportEmployeeTag context={supportContextForEmployeeRange(employee, dates)} /><small>{employee.code || employee.id} · {employeeRole(employee)}</small></span></div></td>
""",
    'UnifiedSchedule period matrix support tag',
)
text = replace_once(
    text,
    """            return <tr key={employee.id}><td><div className="person-cell"><Avatar name={employee.name} src={employee.avatar} employeeId={employee.id || employee.code} color={employee.color} /><span><strong>{employee.name}</strong><small>{employee.code || employee.id} · {employeeRole(employee)}</small></span></div></td>{dayViewShifts.map((column) => {
""",
    """            return <tr key={employee.id}><td><div className="person-cell"><Avatar name={employee.name} src={employee.avatar} employeeId={employee.id || employee.code} color={employee.color} /><span><strong>{employee.name}</strong><SupportEmployeeTag context={supportContextForEmployeeDate(employee, date)} /><small>{employee.code || employee.id} · {employeeRole(employee)}</small></span></div></td>{dayViewShifts.map((column) => {
""",
    'UnifiedSchedule day matrix support tag',
)
text = replace_once(
    text,
    """        ) : scheduleHistoryRows.length ? <TableWrap><thead><tr><th>Ngày</th><th>Nhân viên</th><th>Ca</th><th>Thời gian</th><th>Ghi chú</th><th>Cập nhật</th></tr></thead><tbody>{scheduleHistoryRows.map((row) => <tr key={row.id}><td><strong>{displayDate(row.date)}</strong></td><td>{row.employeeName}<small className="table-note">{row.employeeId}</small></td><td>{row.shift.name}</td>""",
    """        ) : scheduleHistoryRows.length ? <TableWrap><thead><tr><th>Ngày</th><th>Nhân viên</th><th>Ca</th><th>Thời gian</th><th>Ghi chú</th><th>Cập nhật</th></tr></thead><tbody>{scheduleHistoryRows.map((row) => <tr key={row.id}><td><strong>{displayDate(row.date)}</strong></td><td><strong>{row.employeeName}</strong><SupportEmployeeTag context={supportContextForEmployeeDate(employeeById.get(String(row.employeeId)) || { id: row.employeeId, name: row.employeeName }, row.date)} /><small className="table-note">{row.employeeId}</small></td><td>{row.shift.name}</td>""",
    'UnifiedSchedule history support tag',
)
text = replace_once(
    text,
    """                  <strong>{employee.name}</strong>
                  <small>{employee.code || employee.id} · {employeeRole(employee)}</small>
                </label>
""",
    """                  <strong>{employee.name}</strong>
                  <SupportEmployeeTag context={supportContextForEmployeeDate(employee, date)} />
                  <small>{employee.code || employee.id} · {employeeRole(employee)}</small>
                </label>
""",
    'UnifiedSchedule assignment picker support tag',
)
text = replace_once(
    text,
    """                <strong>{employee.name}</strong>
                <small>{employee.code || employee.id} · {employeeRole(employee)}</small>
              </label>
""",
    """                <strong>{employee.name}</strong>
                <SupportEmployeeTag context={supportContextForEmployeeDate(employee, date)} />
                <small>{employee.code || employee.id} · {employeeRole(employee)}</small>
              </label>
""",
    'UnifiedSchedule edit picker support tag',
)
write(path, text)


# Revenue bonus current allocation and history.
path = 'src/pages/compensation/RevenueBonusPage.jsx'
text = read(path)
text = replace_once(
    text,
    "import { businessDate as toBusinessDate, money, operationalIdentifierRecordMatch } from '../../utils'\n",
    "import { businessDate as toBusinessDate, money, operationalIdentifierRecordMatch } from '../../utils'\nimport { SupportEmployeeTag } from '../../components/SupportEmployeeTag'\nimport { resolveSupportEmployeeTagContext } from '../../domain/supportEmployeeTag'\n",
    'RevenueBonus support tag imports',
)
text = replace_once(
    text,
    """  employeeOptions,
  filteredRows,
""",
    """  employeeOptions,
  employees,
  filteredRows,
""",
    'RevenueHistory employees prop',
)
text = replace_once(
    text,
    """  statistics,
  stores,
}) {
""",
    """  statistics,
  stores,
  supportTransfers,
}) {
""",
    'RevenueHistory support transfers prop',
)
text = replace_once(
    text,
    """          <td><strong>{row.employeeName}</strong><small className="compensation-subline">{row.employeeId}</small></td>
""",
    """          <td><strong>{row.employeeName}</strong><SupportEmployeeTag context={resolveSupportEmployeeTagContext({ record: row, employeeId: row.employeeId, storeId: row.storeId, businessDate: row.businessDate, employees, stores, supportTransfers })} className="compensation-subline" /><small className="compensation-subline">{row.employeeId}</small></td>
""",
    'RevenueHistory support tag',
)
text = replace_once(
    text,
    """              {!privateAllocationView && <td><strong>{employeeName(app.employees || [], entryEmployeeId(allocation), allocation.employeeName)}</strong><small className="compensation-subline">{entryEmployeeId(allocation)}</small></td>}
""",
    """              {!privateAllocationView && <td><strong>{employeeName(app.employees || [], entryEmployeeId(allocation), allocation.employeeName)}</strong><SupportEmployeeTag context={resolveSupportEmployeeTagContext({ record: allocation, employeeId: entryEmployeeId(allocation), storeId: entryStoreId(allocation), businessDate: revenueRecordDate(allocation), employees: app.employees, stores: app.stores, supportTransfers: app.supportTransfers })} className="compensation-subline" /><small className="compensation-subline">{entryEmployeeId(allocation)}</small></td>}
""",
    'RevenueBonus live allocation support tag',
)
text = replace_once(
    text,
    """        employeeCollisions={legacyHistoryProjection.employeeCollisions || []}
        employeeOptions={historyEmployeeOptions}
        filteredRows={filteredHistoryRows}
""",
    """        employeeCollisions={legacyHistoryProjection.employeeCollisions || []}
        employeeOptions={historyEmployeeOptions}
        employees={app.employees || []}
        filteredRows={filteredHistoryRows}
""",
    'RevenueHistory pass employees',
)
text = replace_once(
    text,
    """        statistics={historyStatistics}
        stores={stores}
      />
""",
    """        statistics={historyStatistics}
        stores={Array.isArray(app.stores) ? app.stores : stores}
        supportTransfers={app.supportTransfers || []}
      />
""",
    'RevenueHistory pass support context collections',
)
write(path, text)


# Violation entry selection and history.
path = 'src/pages/compensation/ViolationManagementPage.jsx'
text = read(path)
text = replace_once(
    text,
    "import { money } from '../../utils'\n",
    "import { money } from '../../utils'\nimport { SupportEmployeeTag } from '../../components/SupportEmployeeTag'\nimport { resolveSupportEmployeeTagContext } from '../../domain/supportEmployeeTag'\n",
    'ViolationManagement support tag imports',
)
text = replace_once(
    text,
    """  const selectedEmployee = employees.find((employee) => entityId(employee) === selectedEmployeeId) || null
  const shiftOptions = useMemo(() => resolveShiftOptions({
""",
    """  const selectedEmployee = employees.find((employee) => entityId(employee) === selectedEmployeeId) || null
  const selectedSupportContext = targetUnit === 'store'
    ? resolveSupportEmployeeTagContext({
        record: { employeeId: selectedEmployeeId, storeId: selectedStoreId, businessDate: occurredOn },
        employee: selectedEmployee,
        employeeId: selectedEmployeeId,
        storeId: selectedStoreId,
        businessDate: occurredOn,
        employees: app.employees,
        stores: app.stores,
        supportTransfers: app.supportTransfers,
      })
    : null
  const shiftOptions = useMemo(() => resolveShiftOptions({
""",
    'ViolationManagement selected support context',
)
text = replace_once(
    text,
    """            </Select>
          </Field>
          <Field label="Ca nhân viên làm trong ngày" required>
""",
    """            </Select>
            <SupportEmployeeTag context={selectedSupportContext} />
          </Field>
          <Field label="Ca nhân viên làm trong ngày" required>
""",
    'ViolationManagement selected employee support tag',
)
text = replace_once(
    text,
    """              <td><strong>{employeeName(employees, entryEmployeeId(entry), entry.employeeName)}</strong><small className="compensation-subline">{entryEmployeeId(entry)}</small></td>
""",
    """              <td><strong>{employeeName(employees, entryEmployeeId(entry), entry.employeeName)}</strong><SupportEmployeeTag context={resolveSupportEmployeeTagContext({ record: entry, employeeId: entryEmployeeId(entry), storeId: entryStoreId(entry), businessDate: entryDate(entry), employees: app.employees, stores: app.stores, supportTransfers: app.supportTransfers })} className="compensation-subline" /><small className="compensation-subline">{entryEmployeeId(entry)}</small></td>
""",
    'ViolationManagement history support tag',
)
write(path, text)


# Violation refund history.
path = 'src/pages/compensation/ViolationRefundPage.jsx'
text = read(path)
text = replace_once(
    text,
    "import { Badge, Card, Field, InfoNote, Input, MetricCard, PageHeader, Select, TableWrap } from '../../components/UI'\n",
    "import { Badge, Card, Field, InfoNote, Input, MetricCard, PageHeader, Select, TableWrap } from '../../components/UI'\nimport { SupportEmployeeTag } from '../../components/SupportEmployeeTag'\nimport { resolveSupportEmployeeTagContext } from '../../domain/supportEmployeeTag'\n",
    'ViolationRefund support tag imports',
)
text = replace_once(text, 'const isSupportEmployee = (refund, currentStoreId) => {\n', 'const legacySupportEmployee = (refund, currentStoreId) => {\n', 'ViolationRefund legacy support detector rename')
text = replace_once(
    text,
    """      support: isSupportEmployee(refund, selectedStoreId),
""",
    """      support: Boolean(resolveSupportEmployeeTagContext({
        record: refund,
        employeeId: refund.employeeId,
        storeId: selectedStoreId,
        businessDate: refundDate(refund),
        employees: app.employees,
        stores: app.stores,
        supportTransfers: app.supportTransfers,
      })),
""",
    'ViolationRefund employee filter support marker',
)
text = replace_once(
    text,
    """  }, new Map()).values()].toSorted((left, right) => left.name.localeCompare(right.name, 'vi-VN')), [scopedRows, selectedStoreId])
""",
    """  }, new Map()).values()].toSorted((left, right) => left.name.localeCompare(right.name, 'vi-VN')), [app.employees, app.stores, app.supportTransfers, scopedRows, selectedStoreId])
""",
    'ViolationRefund employee options dependencies',
)
text = replace_once(
    text,
    """          const support = isSupportEmployee(refund, selectedStoreId)
          const subline = statusSubline(refund)
""",
    """          const supportContext = resolveSupportEmployeeTagContext({
            record: refund,
            employeeId: refund.employeeId,
            storeId: selectedStoreId,
            businessDate: refundDate(refund),
            employees: app.employees,
            stores: app.stores,
            supportTransfers: app.supportTransfers,
          })
          const historicalSupport = legacySupportEmployee(refund, selectedStoreId)
          const subline = statusSubline(refund)
""",
    'ViolationRefund row support context',
)
text = replace_once(
    text,
    """              <Badge tone={support ? 'orange' : 'green'}>{support ? 'Nhân viên hỗ trợ' : 'Nhân viên chính'}</Badge>
              {support && refund.employeeHomeStoreId && <small className="compensation-subline">Cửa hàng gốc: {storeName(stores, refund.employeeHomeStoreId)}</small>}
""",
    """              {supportContext ? <SupportEmployeeTag context={supportContext} /> : !historicalSupport ? <Badge tone="green">Nhân viên chính</Badge> : null}
""",
    'ViolationRefund standardized support tag and cutover',
)
write(path, text)


# Employee self-service dashboard, attendance history and payroll support detail.
path = 'src/pages/employee/EmployeeV2Pages.jsx'
text = read(path)
text = replace_once(
    text,
    "import { SearchableSelect } from '../../components/SearchableSelect'\n",
    "import { SearchableSelect } from '../../components/SearchableSelect'\nimport { SupportEmployeeTag } from '../../components/SupportEmployeeTag'\n",
    'EmployeeV2Pages support tag import',
)
text = replace_once(
    text,
    """        actions={isSupporting ? <Badge tone="orange">NV HỖ TRỢ</Badge> : null}
""",
    """        actions={isSupporting ? <SupportEmployeeTag record={{ employeeId, storeId: workingStoreId, businessDate: operationalDate, supportTransferId: activeTransfer?.id, employeeHomeStoreId: homeStoreId, supportStoreId: workingStoreId }} employee={employee} employeeId={employeeId} storeId={workingStoreId} businessDate={operationalDate} employees={app.employees} stores={stores} supportTransfers={supportTransfers} /> : null}
""",
    'EmployeeDashboard standardized support tag',
)
text = replace_once(
    text,
    """<td>{compensation?.isSupport ? <div className="table-stack"><Badge tone="orange">Ca hỗ trợ • {compensation.destinationStoreName}</Badge><small>{compensation.timeLabel}</small>""",
    """<td>{compensation?.isSupport ? <div className="table-stack"><SupportEmployeeTag record={{ ...record, employeeId, supportTransferId: compensation.transferId || record.supportTransferId, employeeHomeStoreId: compensation.homeStoreId || employee?.storeId, supportStoreId: compensation.destinationStoreId || record.storeId, supportStoreName: compensation.destinationStoreName, isSupportEmployee: true }} employee={employee} employeeId={employeeId} storeId={compensation.destinationStoreId || record.storeId} businessDate={recordDate(record)} employees={app.employees} stores={stores} supportTransfers={supportTransfers} /><Badge tone="orange">Ca hỗ trợ • {compensation.destinationStoreName}</Badge><small>{compensation.timeLabel}</small>""",
    'EmployeeAttendance support history tag',
)
text = replace_once(
    text,
    """{supportDetails.length ? <TableWrap><thead><tr><th>Ngày</th><th>Cửa hàng hỗ trợ</th><th>Thời gian hỗ trợ</th><th>Giờ làm thực tế</th><th>Lương hỗ trợ/giờ</th><th>Tiền lương</th><th>Phụ cấp</th><th>Thực nhận</th></tr></thead><tbody>{supportDetails.map((item) => <tr key={item.key}><td><strong>{shortDate(item.date)}</strong></td><td><Badge tone="orange">{item.destinationStoreName}</Badge></td>""",
    """{supportDetails.length ? <TableWrap><thead><tr><th>Ngày</th><th>Cửa hàng hỗ trợ</th><th>Thời gian hỗ trợ</th><th>Giờ làm thực tế</th><th>Lương hỗ trợ/giờ</th><th>Tiền lương</th><th>Phụ cấp</th><th>Thực nhận</th></tr></thead><tbody>{supportDetails.map((item) => <tr key={item.key}><td><strong>{shortDate(item.date)}</strong></td><td><SupportEmployeeTag record={{ employeeId, businessDate: item.date, employeeHomeStoreId: employee?.storeId, supportStoreId: item.destinationStoreId || item.record?.storeId, supportStoreName: item.destinationStoreName, supportTransferId: item.transferId, isSupportEmployee: true }} employee={employee} employeeId={employeeId} storeId={item.destinationStoreId || item.record?.storeId} businessDate={item.date} employees={app.employees} stores={stores} supportTransfers={supportTransfers} /><Badge tone="orange">{item.destinationStoreName}</Badge></td>""",
    'EmployeePayroll support detail tag',
)
write(path, text)


# Small global layout rule for consistent tags in dense tables and pickers.
path = 'src/index.css'
text = read(path)
text = append_once(
    text,
    '.support-employee-tag[data-support-employee-tag="true"]',
    """
.support-employee-tag[data-support-employee-tag="true"] {
  display: inline-flex;
  max-width: 100%;
  margin-top: 4px;
  vertical-align: middle;
}

.support-employee-tag[data-support-employee-tag="true"] .badge {
  max-width: 100%;
  line-height: 1.35;
  text-align: left;
  white-space: normal;
}

.person-cell .support-employee-tag,
.employee-picker .support-employee-tag {
  align-self: flex-start;
}

.employee-picker .support-employee-tag {
  grid-column: 2 / -1;
}
""",
    'global support tag layout',
)
write(path, text)

print('System-wide support employee tag source patch applied successfully.')
