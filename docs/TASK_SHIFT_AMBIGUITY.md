# Explicit task-shift choices within a business period

## Symptom and evidence (2026-10-01)

On `/employee/tasks`, SM TNV displayed disabled morning, afternoon and night
buttons with “Cấu hình trùng”. A read-only inspection of the employee's actual
`GET /api/system-screens/employee-tasks` response (version 18611) confirmed
three morning, four afternoon and three night definitions for the attendance
business date. These are separate active IDs with different intervals, not
copies introduced by the browser. Retired and date-specific historical rows
also exist and are correctly excluded from this date.

| Period | Active configured intervals | Old rank | Old result |
| --- | --- | --- | --- |
| Morning | 08:00–12:00, 08:30–12:00, 09:30–13:00 | 7 each | ambiguous |
| Afternoon | 09:30–17:30, 12:00–18:00, 13:30–18:00, 14:00–21:00 | 7 each | ambiguous |
| Night | 17:00–21:00, 18:00–21:00, 19:00–21:00 | 7 each | ambiguous |

The name/template resolver maps the 09:30 “Ca chiều” definition to afternoon;
it must not be remapped using the employee's check-in time. All ten rows are
store-specific, undated, active, not deleted, with different IDs. The API is
authoritative for this employee scope; direct production SQLite and management
account inspection were not performed. No production personal data or raw
payload is committed here. A second store (CH007) had only one current choice
per period and did not reproduce the issue before the patch.

## Confirmed cause and scope

`shiftDefinitionCommand` accepts separate named/time-based definitions and the
scheduling UI supports these independently. Neither enforces one definition
per morning/afternoon/night. `taskShiftSlots` incorrectly treated any equal-rank
pair as conflicting. Consequently both the UI and `selectAttendanceTaskShift`
rejected legitimate choices. Projection/filtering did not create these ten IDs.

Related resolver defects reproduced separately with synthetic fixtures:

- Repeated identical JSON copies of one shift falsely blocked all periods.
- Global server attendance could supply another employee's support shift even
  though that attendance was absent from the employee projection.

## Execution brief / task graph

- Goal/acceptance: valid independent shifts remain explicitly selectable;
  only a successful server command establishes one immutable attendance lock;
  no checklist or progress write before that command.
- Risk/workload: CRITICAL (shared mutation validation and persistence path).
  Current runtime fallback used; no model switch claimed.
- Canonical sources: persisted shift definitions, existing checklist template
  mapping, specificity ranking, attendance lock and command transaction.
- Related-flow map: configuration → employee projection/cache → shared resolver
  → period/interval UI → task.shift.select → task binding → task.progress.save
  → snapshots/history/checkout. Attendance/payroll shift and rewards remain separate.
- T1 (no dependency): reproduce and trace real scope; read-only diagnosis.
- T2 (depends T1): shared resolver + explicit interval UI + domain/component/
  SQLite regression in one atomic `fix(tasks)` commit. These parts require the
  same contract and cannot be shipped separately.
- T3 (depends T2): technical/evidence documentation in `docs(tasks)` commit.
- T3b (browser finding, depends T2): preserve stale version for incomplete task
  command cache and refresh immediately; `fix(tasks): refresh history after task commands`.
- T4 (depends T2/T3): final gates → PR verify → merge → exact main verify →
  automatic VPS deployment → exact SHA/finalizer evidence → read-only smoke.

## Resolution

Preserve existing store/date/source/template precedence. A period with several
distinct top-ranked choices returns `multiple` plus deterministic, time/name
sorted choices, without preselecting one. The employee opens that period's
choices (pure UI), then explicitly selects a named interval (writing command).
The backend finds that exact ID among the same choices before locking it.
Already selected and legacy contexts resolve their actual chosen interval.

Only fully identical JSON copies with the same exact ID are collapsed, preserving
the original object/source. Conflicting identifiers, or distinct IDs that cannot
be distinguished by their displayed name and interval, still produce `ambiguous`
for that period. No arbitrary first/latest/minimum-ID winner is used. Synthetic
support metadata is supplied exclusively by the current attendance.

## Files and verification

| File | Purpose / evidence |
| --- | --- |
| `src/domain/taskShift.js` | Shared multiple-choice validation, exact-copy handling, support scope |
| `src/domain/taskShift.test.js` | Production-shaped 3/4/3 configuration; all ten choices; input-order invariance; copies/conflicts; scope/date/lifecycle/alias rules |
| `src/pages/employee/EmployeeShiftOperations.jsx` | Accessible period expansion, explicit interval action, server-confirmed lock |
| `src/pages/employee/EmployeeShiftOperations.test.jsx` | No write on expansion, no premature checklist/lock, double-click guard, correct submitted ID and locked interval |
| `server/vps/task-shift-lock.test.js` | Real HTTP + SQLite repeated persisted rows and independent intervals; select/replay/save/restart, preserved payroll shift |
| `src/state/AppContext.jsx`, `src/state/AppContext.activeStore.test.jsx` | Task command deltas do not include assignment history; cache retains the previous authoritative version until immediate scoped refresh, including navigation/reload before refresh |

Targeted domain/component/SQLite suite: 51 tests passed. Added regressions failed
on the original resolver, including the production-shaped SM TNV case. Existing
tests cover concurrent selection, denied scopes, checkout race, legacy contexts,
reward separation and timeout/retry handling. Repository-wide and release
evidence is recorded in the PR and delivery report after execution.

Local final gate: lint, build and Sites verification passed (initial JS 499.0 /
500 KiB). The full Windows run reported 1,955 passed / 2 failed: the known
`EPERM` symlink restriction and a checkout-race test incorrectly assuming that
checkout always reads after selection commits. The race can legitimately read
the pre-selection snapshot, reject unfinished tasks, and leave attendance open.
Its regression now verifies exactly that error/state and a new checkout after
re-reading; the complete four-test SQLite lock file passed again. No production
checkout guard was changed. The final revision must pass the full Linux CI gate.

Browser follow-up: real local select/save/reload exposed missing history in the
restored cache despite the persisted/API history being complete. The task delta
had incorrectly labeled the partial cached projection with the new command
version; a fast reload could then skip its deferred authoritative refresh.
The scoped cache fix has two red-before/green-after regressions (select/save).
Related domain/UI/state/cache/SQLite follow-up: 118 tests PASS. Browser checks
at 1366, 1920 and 390 pixels show no document overflow, keyboard focus is visible,
and local selection/save/reload retains the exact interval and progress.

## Data and rollback

No migration, data repair, deletion, ID rewriting or production test writes.
Configuration, attendance IDs, task IDs and snapshots are retained. Normal VPS
deployment creates its consistent backup/checksum and rollback point. Revert the
code via a verified release if required; an old resolver will again block new
selections where several independent shifts occupy one period. Existing saved
contexts retain their IDs. Restoring any older production backup requires the
runbook's emergency backup because it can discard subsequent writes.
