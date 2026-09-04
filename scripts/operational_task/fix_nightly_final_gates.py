from pathlib import Path

ROOT = Path.cwd()


def replace_once(path, old, new):
    file = ROOT / path
    text = file.read_text(encoding='utf-8')
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f'{path}: expected one occurrence, found {count}: {old[:100]!r}')
    file.write_text(text.replace(old, new, 1), encoding='utf-8')


replace_once(
    'src/pages/admin/BusinessSupportSchedulePage.jsx',
    "import { useEffect, useMemo, useState } from 'react'",
    "import { useMemo, useState } from 'react'",
)
replace_once(
    'src/pages/admin/BusinessSupportSchedulePage.jsx',
    """  const assignedPageCount = Math.max(1, Math.ceil(filteredSchedules.length / ASSIGNED_SCHEDULE_PAGE_SIZE))
  const pagedSchedules = filteredSchedules.slice(
    assignedPage * ASSIGNED_SCHEDULE_PAGE_SIZE,
    (assignedPage + 1) * ASSIGNED_SCHEDULE_PAGE_SIZE,
  )
  const canDelete = ['admin', 'business_support', 'manager'].includes(app.session?.role)

  useEffect(() => {
    setAssignedPage((current) => Math.min(current, assignedPageCount - 1))
  }, [assignedPageCount])
""",
    """  const assignedPageCount = Math.max(1, Math.ceil(filteredSchedules.length / ASSIGNED_SCHEDULE_PAGE_SIZE))
  const safeAssignedPage = Math.min(assignedPage, assignedPageCount - 1)
  const pagedSchedules = filteredSchedules.slice(
    safeAssignedPage * ASSIGNED_SCHEDULE_PAGE_SIZE,
    (safeAssignedPage + 1) * ASSIGNED_SCHEDULE_PAGE_SIZE,
  )
  const canDelete = ['admin', 'business_support', 'manager'].includes(app.session?.role)
""",
)
replace_once(
    'src/pages/admin/BusinessSupportSchedulePage.jsx',
    """          disabled={assignedPage === 0}
          onClick={() => setAssignedPage((current) => Math.max(0, current - 1))}
        >TRƯỚC</Button>
        <span>Trang {assignedPage + 1}/{assignedPageCount} · {filteredSchedules.length} lịch</span>
""",
    """          disabled={safeAssignedPage === 0}
          onClick={() => setAssignedPage(Math.max(0, safeAssignedPage - 1))}
        >TRƯỚC</Button>
        <span>Trang {safeAssignedPage + 1}/{assignedPageCount} · {filteredSchedules.length} lịch</span>
""",
)
replace_once(
    'src/pages/admin/BusinessSupportSchedulePage.jsx',
    """          disabled={assignedPage >= assignedPageCount - 1}
          onClick={() => setAssignedPage((current) => Math.min(assignedPageCount - 1, current + 1))}
""",
    """          disabled={safeAssignedPage >= assignedPageCount - 1}
          onClick={() => setAssignedPage(Math.min(assignedPageCount - 1, safeAssignedPage + 1))}
""",
)

replace_once(
    'src/pages/admin/GovernancePages.jsx',
    "import { useEffect, useMemo, useState } from 'react'",
    "import { useMemo, useState } from 'react'",
)
replace_once(
    'src/pages/admin/GovernancePages.jsx',
    "import { orderAuditChanges } from './orderAuditUtils'\n",
    "",
)
replace_once(
    'src/pages/admin/GovernancePages.jsx',
    """function OrderAuditChangeList({ record }) {
  const changes = orderAuditChanges(record)
  if (!changes.length) return <span>—</span>
  return <div className="audit-change-list">{changes.map((change) => <div className="audit-change-item" key={change.field}><strong>{change.label}</strong><span><del>{change.before}</del><b aria-hidden="true">→</b><ins>{change.after}</ins></span></div>)}</div>
}

""",
    "",
)
replace_once(
    'src/pages/admin/GovernancePages.jsx',
    "  const selectedDate = auditDates[datePage] || currentDate\n",
    "  const safeDatePage = Math.min(datePage, auditDates.length - 1)\n  const selectedDate = auditDates[safeDatePage] || currentDate\n",
)
replace_once(
    'src/pages/admin/GovernancePages.jsx',
    """
  useEffect(() => {
    setDatePage((current) => Math.min(current, auditDates.length - 1))
  }, [auditDates.length])

""",
    "\n",
)
replace_once(
    'src/pages/admin/GovernancePages.jsx',
    """          disabled={datePage === 0}
          onClick={() => setDatePage((current) => Math.max(0, current - 1))}
""",
    """          disabled={safeDatePage === 0}
          onClick={() => setDatePage(Math.max(0, safeDatePage - 1))}
""",
)
replace_once(
    'src/pages/admin/GovernancePages.jsx',
    """          disabled={datePage >= auditDates.length - 1}
          onClick={() => setDatePage((current) => Math.min(auditDates.length - 1, current + 1))}
""",
    """          disabled={safeDatePage >= auditDates.length - 1}
          onClick={() => setDatePage(Math.min(auditDates.length - 1, safeDatePage + 1))}
""",
)

replace_once(
    'src/pages/admin/SystemFinanceV2.jsx',
    "import { useEffect, useMemo, useState } from 'react'",
    "import { useMemo, useState } from 'react'",
)
replace_once(
    'src/pages/admin/SystemFinanceV2.jsx',
    """  const sourceDates = useMemo(() => cashflowSourceDates(sourceSummary.transactions, currentDate), [currentDate, sourceSummary.transactions])
  const sourceDate = sourceDates[sourceDatePage] || currentDate
""",
    """  const sourceDates = useMemo(() => cashflowSourceDates(sourceSummary.transactions, currentDate), [currentDate, sourceSummary.transactions])
  const safeSourceDatePage = Math.min(sourceDatePage, sourceDates.length - 1)
  const sourceDate = sourceDates[safeSourceDatePage] || currentDate
""",
)
replace_once(
    'src/pages/admin/SystemFinanceV2.jsx',
    """
  useEffect(() => {
    setSourceDatePage((current) => Math.min(current, sourceDates.length - 1))
  }, [sourceDates.length])

""",
    "\n",
)
replace_once(
    'src/pages/admin/SystemFinanceV2.jsx',
    """            disabled={sourceDatePage === 0}
            onClick={() => setSourceDatePage((current) => Math.max(0, current - 1))}
""",
    """            disabled={safeSourceDatePage === 0}
            onClick={() => setSourceDatePage(Math.max(0, safeSourceDatePage - 1))}
""",
)
replace_once(
    'src/pages/admin/SystemFinanceV2.jsx',
    """            disabled={sourceDatePage >= sourceDates.length - 1}
            onClick={() => setSourceDatePage((current) => Math.min(sourceDates.length - 1, current + 1))}
""",
    """            disabled={safeSourceDatePage >= sourceDates.length - 1}
            onClick={() => setSourceDatePage(Math.min(sourceDates.length - 1, safeSourceDatePage + 1))}
""",
)

replace_once(
    'src/layout/AppShell.notifications.test.jsx',
    "import { StoreOrdersPage } from '../pages/store/StoreV2Pages'\n",
    "",
)
