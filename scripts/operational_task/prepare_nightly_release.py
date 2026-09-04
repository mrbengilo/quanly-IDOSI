from pathlib import Path

transform = Path('/tmp/operational_task/group6_revenue_cutoff.py')
text = transform.read_text(encoding='utf-8')
old = "export const AUTOMATIC_REVENUE_BONUS_EFFECTIVE_DATE = '2026-09-01'\\nexport const AUTOMATIC_REVENUE_BONUS_CUTOFF_HOUR = 22"
new = "export const AUTOMATIC_REVENUE_BONUS_EFFECTIVE_DATE = '2026-09-03'\\nexport const AUTOMATIC_REVENUE_BONUS_CUTOFF_HOUR = 22"
if text.count(old) != 1:
    raise RuntimeError(f'cutover transform anchor count={text.count(old)}')
transform.write_text(text.replace(old, new, 1), encoding='utf-8')

runner = Path('/tmp/operational_task/run_group6_v2.sh')
text = runner.read_text(encoding='utf-8')
old_expectation = "new = \"    expect(period.days.map((day) => day.businessDate)).toEqual(['2026-09-01', '2026-09-02'])\\n\""
original_expectation = "new = \"    expect(period.days.map((day) => day.businessDate)).toEqual([AUTOMATIC_REVENUE_BONUS_EFFECTIVE_DATE])\\n\""
if text.count(old_expectation) != 1:
    raise RuntimeError(f'period expectation transform count={text.count(old_expectation)}')
text = text.replace(old_expectation, original_expectation, 1)
text = text.replace('feat/ops-pages-cached-daily-automation', 'feat/ops-pages-nightly-revenue-final')
commit_anchor = "git commit -m 'feat(revenue): finalize automatic daily rewards after 22:00'\n"
insertion = commit_anchor + "\npython /tmp/operational_task/fix_nightly_final_gates.py\nsed -i \"1s/import { useMemo, useState } from 'react'/import { useEffect, useMemo, useState } from 'react'/\" src/pages/admin/SystemFinanceV2.jsx\ngit add src/pages/admin/BusinessSupportSchedulePage.jsx src/pages/admin/GovernancePages.jsx src/pages/admin/SystemFinanceV2.jsx src/layout/AppShell.notifications.test.jsx\ngit commit -m 'fix(ui): derive bounded pagination without effects'\n"
if text.count(commit_anchor) != 1:
    raise RuntimeError(f'runner commit anchor count={text.count(commit_anchor)}')
runner.write_text(text.replace(commit_anchor, insertion, 1), encoding='utf-8')
