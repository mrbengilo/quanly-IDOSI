from pathlib import Path


def replace_once(path, old, new, label):
    target = Path(path)
    text = target.read_text(encoding='utf-8')
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected exactly one match, found {count}')
    target.write_text(text.replace(old, new, 1), encoding='utf-8')
    print(f'apply: {label}')


replace_once(
    'src/pages/store/StoreOperations.jsx',
    """<td>{employee.supportAssignment ? <div className="table-stack"><SupportEmployeeTag record={{ ...employee, businessDate: today(), supportAssignment: employee.supportAssignment, supportStoreId: scopedStoreId, homeStoreId: employee.homeStoreId || employee.storeId, isSupportEmployee: true }} employee={employee} employeeId={employee.id || employee.code} storeId={scopedStoreId} businessDate={today()} employees={employees} stores={stores} supportTransfers={supportTransfers} /><small>{storeFor(stores, employee.supportAssignment.fromStoreId || employee.homeStoreId)?.name || employee.supportAssignment.fromStoreId || employee.homeStoreId} → {scopedStore?.name || scopedStoreId}</small>""",
    """<td>{employee.supportAssignment ? <div className="table-stack"><small>{storeFor(stores, employee.supportAssignment.fromStoreId || employee.homeStoreId)?.name || employee.supportAssignment.fromStoreId || employee.homeStoreId} → {scopedStore?.name || scopedStoreId}</small>""",
    'remove duplicate support tag from assignment detail cell',
)

replace_once(
    'src/pages/compensation/ViolationRefundPage.jsx',
    "import { AccessDenied, displayDate, displayDateTime, storeName, vietnamToday } from './compensationUi'\n",
    "import { AccessDenied, displayDate, displayDateTime, vietnamToday } from './compensationUi'\n",
    'remove unused violation-refund import',
)

replace_once(
    'src/pages/employee/employeeSupportCompensation.js',
    """    const endAt = detail.endAt || detail.transferEndAt
    const attendanceCount = Array.isArray(detail.attendanceIds) ? detail.attendanceIds.length : 0
    return {
      key: `${detail.transferId || 'support'}-${index}`,
      date: String(startAt || '').slice(0, 10),
      destinationStoreName: storeNameFor(
        detail.supportStoreId,
        stores,
        detail.supportStoreName || detail.destinationStoreName,
      ),
""",
    """    const endAt = detail.endAt || detail.transferEndAt
    const attendanceCount = Array.isArray(detail.attendanceIds) ? detail.attendanceIds.length : 0
    const destinationStoreId = String(detail.supportStoreId || detail.destinationStoreId || '')
    return {
      key: `${detail.transferId || 'support'}-${index}`,
      date: String(startAt || '').slice(0, 10),
      transferId: String(detail.transferId || ''),
      destinationStoreId,
      destinationStoreName: storeNameFor(
        destinationStoreId,
        stores,
        detail.supportStoreName || detail.destinationStoreName,
      ),
""",
    'preserve support destination and transfer ids in closed payroll details',
)

replace_once(
    'src/pages/employee/employeeSupportCompensation.test.js',
    """    })).toEqual([expect.objectContaining({
      destinationStoreName: 'Dosii KVC',
      timeLabel: '20/08/2026 08:00 – 20/08/2026 15:00',
""",
    """    })).toEqual([expect.objectContaining({
      transferId: 'TR-01',
      destinationStoreId: 'S02',
      destinationStoreName: 'Dosii KVC',
      timeLabel: '20/08/2026 08:00 – 20/08/2026 15:00',
""",
    'verify closed payroll support identifiers',
)

print('Support tag review fixes applied successfully.')
