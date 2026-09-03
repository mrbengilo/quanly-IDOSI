from pathlib import Path


def replace_once(path, old, new, label):
    target = Path(path)
    text = target.read_text(encoding='utf-8')
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected exactly one match, found {count}')
    target.write_text(text.replace(old, new, 1), encoding='utf-8')
    print(f'prepare: {label}')


replace_once(
    'src/domain/supportEmployeeTag.js',
    """  const transferReferences = explicitTransferReferences(sourceRecord)
  if (transferReferences.length > 1) return null

  const inferredTransfers = matchingTransfers({
""",
    """  const transferReferences = explicitTransferReferences(sourceRecord)
  const immutableSnapshotEvidence = Boolean(
    explicitHomeStoreId(sourceRecord)
    && recordStoreId(sourceRecord)
    && recordExplicitlyMarksSupport(sourceRecord),
  )
  if (transferReferences.length > 1 && !immutableSnapshotEvidence) return null

  const inferredTransfers = matchingTransfers({
""",
    'preserve explicit snapshot tags with multiple transfer ids',
)

replace_once(
    'src/domain/supportEmployeeTag.js',
    """    if (referencedTransfer) {
      if (!transferMatchesScope({
        transfer: referencedTransfer,
        employeeId: canonicalEmployeeId,
        storeId: operationalStoreId,
        businessDate: date,
      })) return null
      transfer = referencedTransfer
    } else {
      const immutableSnapshotEvidence = Boolean(
        explicitHomeStoreId(sourceRecord)
        && recordStoreId(sourceRecord)
        && recordExplicitlyMarksSupport(sourceRecord),
      )
      if (!immutableSnapshotEvidence) return null
    }
""",
    """    if (referencedTransfer) {
      const referencedTransferMatches = transferMatchesScope({
        transfer: referencedTransfer,
        employeeId: canonicalEmployeeId,
        storeId: operationalStoreId,
        businessDate: date,
      })
      if (referencedTransferMatches) transfer = referencedTransfer
      else if (!immutableSnapshotEvidence) return null
    } else if (!immutableSnapshotEvidence) return null
""",
    'prefer immutable snapshot support evidence when live transfer lacks historical bounds',
)

replace_once(
    'scripts/apply-systemwide-support-tag.py',
    """    \"\"\"<td>{order.employeeName}<small className=\"table-note\">{order.employeeId}</small></td>\"\"\",
    \"\"\"<td><strong>{order.employeeName || employeeFor(employees, order.employeeId)?.name || order.employeeId || '—'}</strong><SupportEmployeeTag record={order} employeeId={order.employeeId || order.employeeCode} storeId={storeId} businessDate={businessDate(order.createdAt || order.date)} employees={employees} stores={stores} supportTransfers={supportTransfers} className=\"table-note\" /><small className=\"table-note\">{order.employeeId || order.employeeCode || '—'}</small></td>\"\"\",
""",
    """    \"\"\"<td>{order.employeeName}<small className=\"table-note\">{order.employeeId || '—'}</small></td>\"\"\",
    \"\"\"<td><strong>{order.employeeName || operationalIdentifierRecordMatch(employees, order.employeeId || order.employeeCode, employeeIdentifierValues).record?.name || order.employeeId || order.employeeCode || '—'}</strong><SupportEmployeeTag record={order} employeeId={order.employeeId || order.employeeCode} storeId={storeId} businessDate={businessDate(order.createdAt || order.date)} employees={employees} stores={stores} supportTransfers={supportTransfers} className=\"table-note\" /><small className=\"table-note\">{order.employeeId || order.employeeCode || '—'}</small></td>\"\"\",
""",
    'repair store-order source marker and employee resolution',
)

replace_once(
    'scripts/apply-systemwide-support-tag.py',
    """    \"\"\"  const employeeOptions = employees.filter((employee) => String(employee.unit || 'store') === 'store'
    && employee.storeId === storeId)
\"\"\",
""",
    """    \"\"\"  const employeeOptions = employees.filter((employee) => String(employee.unit || 'store') === 'store' && employee.storeId === storeId)
\"\"\",
""",
    'repair current store-order employee-options source marker',
)

replace_once(
    'scripts/apply-systemwide-support-tag.py',
    """    \"\"\"{rows.map((row) => <tr key={row.rowKey}><td><strong>{row.employee.name}</strong><small className=\"table-note\">{row.employee.id} • {row.employee.employmentType}</small></td>\"\"\",
""",
    """    \"\"\"{rows.map((row) => <tr key={row.rowKey}><td><strong>{row.employee.name}</strong>{row.isSupportEmployee && <small className=\"table-note\"><Badge tone=\"orange\">Nhân viên hỗ trợ • {row.supportOriginStoreName || row.supportOriginStoreId || 'Cửa hàng khác'}</Badge></small>}<small className=\"table-note\">{row.employee.id} • {row.employee.employmentType}</small></td>\"\"\",
""",
    'repair current payroll-row source marker',
)

replace_once(
    'scripts/apply-systemwide-support-tag.py',
    "path = 'src/index.css'\ntext = read(path)\n",
    "path = 'src/styles.css'\ntext = read(path)\n",
    'target the active global stylesheet',
)

print('System-wide support tag preparation completed.')
