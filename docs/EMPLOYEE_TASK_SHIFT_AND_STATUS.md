# Employee task shift lock and store-employee status

This document records the business rules, contracts and release evidence for
two related store-employee changes:

- **A. One work-task shift per attendance** (`/employee/tasks`).
- **B. Store-employee working status and login lock** (HTKD personnel management).

## A. One work-task shift per attendance

### State machine

The lock belongs to the attendance record on the server
(`attendance.taskShiftSelection`), never to a tab, component, URL or browser
storage. `attendanceTaskShiftLock(attendance)` in `src/domain/taskProgress.js`
is the single derivation used by the server and the UI.

```text
NO ATTENDANCE / CLOSED ──check-in──▶ OPEN · NONE ──task.shift.select(X)──▶ OPEN · SELECTED(X)
        ▲                                                                       │
        └────────────────────────────── check-out ◀─────────────────────────────┘
```

| State | Meaning | UI | Writes |
|---|---|---|---|
| no open attendance | not checked in, or checked out | message + "Đi đến điểm danh"; no selector, no checklist; history only | all task writes rejected |
| `none` | open attendance, nothing chosen | three buttons Ca sáng / Ca chiều / Ca tối, none pre-selected, no checklist | `task.shift.select` only |
| `selected` | one shift locked | only the chosen button (pressed, disabled, "Đã chọn · đã khóa") and its checklist | save/done for that shift only |
| `legacy-multi` | attendance saved several shifts before this rule | only its saved shifts; no new selection | save for saved shifts only |

A new attendance always starts in `none`; nothing is inherited from the
previous attendance (drafts are keyed by attendance id and shift).

### Slot mapping (`taskShiftSlots`)

The three buttons map to the store's configured shift ids for the attendance
business date through the existing `taskShiftChoices` (store, date, deleted,
support synthetic and catalog rules) and `resolveStoreChecklistCatalogShift`
(canonical aliases/time templates). No id is hard-coded.

Precedence when several candidates map to one slot (specificity, not guessing):

1. the attendance's own support-transfer shift (custom hours map by their
   configured start: < 12:00 morning, < 17:00 afternoon, otherwise night);
2. store + business-date specific definition;
3. store definition;
4. business-date generic definition;
5. generic definition; catalog-only choices last.

Equal top precedence → slot `ambiguous` (disabled, "Cấu hình trùng").
No candidate → slot `missing` (disabled, "Chưa cấu hình"). Nothing is created
or guessed. The server enforces the same mapping.

### Command contract — new command `task.shift.select`

`POST /api/command` with the existing envelope (`expectedVersion`,
`Idempotency-Key`), payload:

```json
{ "attendanceId": "<own open attendance>", "selectedTaskShiftId": "<configured shift id>" }
```

- Actor: role `employee`, profile unit `store`; employee is derived from the
  authenticated actor. `employeeId` / `storeId` in the payload are only
  cross-checked (mismatch → `403 TASK_SCOPE_FORBIDDEN`).
- Validates: attendance exists, belongs to the actor, is open; shift is valid
  for store + business date (`taskShiftContext`) and maps to a slot.
- First selection: persists `taskShiftSelection`, binds exactly one
  `taskShiftContexts` entry and creates missing catalog task rows. It never
  marks work done, creates rewards, or changes `shiftId`, check-in/out times,
  payroll or KPI fields. Audit action `task.shift.select`.
- Same shift again: `200 { existing: true }`, no write, no extra audit.
- Different shift: `409 TASK_SHIFT_ALREADY_SELECTED`.
- Legacy multi-context: `409 TASK_SHIFT_LEGACY_MULTI_CONTEXT`.
- Closed / missing attendance: `409 OPEN_ATTENDANCE_REQUIRED`.
- Invalid / ambiguous / other-date / other-store shift: `409 TASK_SHIFT_INVALID`
  (or the `taskShiftContext` code).

Concurrency: the command is in `STALE_VERSION_REBASE_COMMANDS`; each attempt
re-reads state and commits with the atomic version compare-and-swap. Two
devices choosing different shifts → one `200`, one `409 TASK_SHIFT_ALREADY_SELECTED`.
A select racing check-out → either the selection commits first (and check-out
then validates the locked shift) or the select sees a closed attendance
(`409 OPEN_ATTENDANCE_REQUIRED`); a closed attendance never gains a selection.

Idempotency: a replay of the same key returns the stored receipt. The client
keeps the key per (attendance, shift); on `TIMEOUT` / `NETWORK_ERROR` / 5xx it
re-reads the projection and reports "unknown" — it never shows a lock the
server did not confirm and never reopens a second choice. Validation,
permission and conflict errors are not retried automatically.

### Write guards

- `task.progress.save` for store employees: requires `selectedTaskShiftId`
  **and** an existing lock (`409 TASK_SHIFT_SELECTION_REQUIRED`), and the
  requested shift must be the locked one (`409 TASK_SHIFT_LOCKED`). The old
  attendance-shift fallback (payload without `selectedTaskShiftId`) is closed
  for store employees. Payload tasks outside the locked context → `400`.
- `task.done` / `task.set_done` for mandatory store work: requires an open
  attendance and a lock; the task must belong to the locked obligations.
- Office / HTKD flows (`SupportAssignedWorkPage`, non-store units) are unchanged.

### Checkout obligations and legacy compatibility

`taskIsAttendanceShiftObligation` (shared by server check-out, dashboard and
local mode):

- `none` / `legacy-multi`: unchanged historical rule (attendance shift tasks,
  shift-less tasks, every saved context).
- `selected`: tasks of the saved context(s) plus the locked shift's current
  context (`taskShiftLockedTaskIds`: later explicit assignments and
  explicitly assigned shift-less work). The check-in checklist snapshot of a
  shift that was **not** selected stays stored untouched but is no longer owed
  (otherwise the employee could never check out, because that checklist is
  hidden and unwritable). Saved progress is compared only on owed task ids.

Legacy data:

| Data | Rule |
|---|---|
| new attendance | exactly one shift |
| open attendance, 1 saved context | that context is the lock; selecting the same shift stores `taskShiftSelection.legacyContext = true`; another shift conflicts |
| open attendance, ≥ 2 saved contexts | every context stays owed; only those shifts can be saved; no new selection; nothing picked as "first" |
| closed attendance | untouched; history kept |

Nothing deletes `taskShiftContexts`, `taskProgress`, notes, completion
history or `taskAssignmentHistory`. No SQL migration: the fields live in the
existing JSON attendance records.

### Read projection

`employee-tasks` still returns the employee's own task rows (also needed by the
dashboard check-out panel and other screens). The UI renders only the locked
shift's context, and every write path is enforced on the server, so editing
client state cannot execute another shift's checklist.

## Regression matrix (A)

| # | Case | Evidence |
|---|---|---|
| 1, 13 | no attendance / deep link | `EmployeeShiftOperations.test.jsx` "requires attendance…" |
| 2, 14 | closed attendance, check-out race | `server/vps/task-shift-lock.test.js` |
| 3, 4 | three buttons, choose, others hidden | `EmployeeShiftOperations.test.jsx` |
| 5 | empty shift locks | server + UI tests |
| 6, 18 | reload / other device / VPS restart | server restart test + UI remount |
| 7 | new attendance resets | server + UI tests |
| 8, 10 | double click, retry, lost response | UI single call + same key; server key replay/no-op |
| 9 | concurrent different shifts | server `Promise.all` test |
| 11 | wrong employee/store/date/ambiguous | server + domain tests |
| 12 | missing `selectedTaskShiftId` / other-shift tasks | server + AppContext tests |
| 15 | business date, support shift | domain slots + `EmployeeActiveShiftContext.test.jsx` |
| 16 | legacy single / multi | server legacy test + domain tests |
| 17 | notes, history, rewards | `manual-task-shift.test.js` |
