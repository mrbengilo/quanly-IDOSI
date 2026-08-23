# AGENTS.md — IDOSI Engineering Guide

This file defines mandatory working rules for Codex and other coding agents modifying the IDOSI repository.

## 1. Mission

IDOSI is a production system. Prioritize correctness, data integrity, authorization, auditability, maintainability, regression safety, and efficient execution.

Do not treat this repository as a prototype. Do not optimize for the most code or the longest analysis. Optimize for the smallest correct change with sufficient evidence.

## 2. Technical baseline

- Node.js >= 22.13
- React 19
- Vite 8
- React Router
- Vitest
- ESLint
- Frontend: `src/`
- Business/domain logic: `src/domain/`
- Shared state: `src/state/`
- API client: `src/services/idosiApi.js`
- Backend/runtime: `server/`
- Database/migrations: `db/` and `drizzle/`
- Sites/Cloudflare production: Worker API + D1
- VPS production: Node.js runtime + SQLite + separate image/file storage under `server/vps/` and deployment under `deploy/vps/`

`localStorage` is compatibility/demo/development state only and MUST NOT become the production source of truth.

## 3. Mandatory risk classification before deep work

Before deep analysis or editing, classify every request as exactly one of:

`FAST | STANDARD | CRITICAL`

Report briefly:

```text
RISK LEVEL: FAST | STANDARD | CRITICAL
Reason: <1-3 reasons>
Expected scope: <module/file groups>
Sensitive areas: <finance/payroll/auth/database/VPS/etc or none>
Verification plan: <checks to run>
```

### FAST

Use only for low-risk presentation/documentation changes that do not change business rules, data contracts, mutations, persistence, auth, money, attendance calculations, or production runtime behavior.

Typical FAST tasks:
- text/label/typo
- color/spacing/icon/typography
- small layout-only UI changes
- documentation-only changes

FAST flow:

`classify -> targeted read -> focused branch -> minimal change -> targeted checks -> PR -> required CI -> merge`

Do not scan the whole repository for a clearly scoped FAST task.

### STANDARD

Use for ordinary functionality that changes a non-sensitive flow or logic but does not directly alter finance/payroll/auth/schema/persistence or other CRITICAL areas.

Typical STANDARD tasks:
- ordinary CRUD flows
- non-sensitive forms/validation
- read-only reports
- normal API/service/state/UI additions

STANDARD flow:

`classify -> analyze -> impact map -> branch -> tests -> implementation -> self-review -> full verification -> PR -> CI -> merge`

### CRITICAL

CRITICAL is mandatory if the request or discovered impact touches any of:
- finance, revenue, expense, profit
- KPI, payroll, salary, bonus, allowance, salary advance
- order mutations affecting money/audit
- attendance/worked-hours logic that feeds payroll/KPI
- authorization, roles, store isolation
- authentication/session/credentials
- database/schema/migration/persistence
- destructive delete/data repair
- sensitive idempotency/concurrency/race conditions
- production VPS runtime/storage/deployment behavior
- core business-rule changes

CRITICAL flow:

`classify -> deep analyze -> impact map -> regression test -> minimal implementation -> security/data self-review -> full verification -> PR -> CI/review -> merge -> backup/deploy/health/smoke when production`

### Escalation rules

- Start with the lowest level justified by current evidence.
- If code inspection reveals a more sensitive downstream impact, immediately upgrade the level and state why.
- Never downgrade a confirmed CRITICAL task merely to save time or credit.
- Credit efficiency must come from tighter scope, targeted search, reuse of analysis, and fewer redundant runs — never from skipping required CRITICAL checks.

Detailed routing: `docs/DEVELOPMENT_WORKFLOW.md`.

## 4. Mandatory workflow principles

Before editing code:

1. Classify risk.
2. Read relevant existing code.
3. Search for existing implementation before creating new logic.
4. Identify affected UI, state, domain, API/backend, database, authorization, deployment target, and tests at the depth appropriate to the risk level.
5. Build an Impact Map for STANDARD/CRITICAL, and for FAST if a hidden dependency appears.
6. Determine regression risk and whether migration is required.
7. Prefer the smallest coherent change that fully solves the request.

Recommended Impact Map:

`requirement -> data -> domain -> API/backend -> state -> UI -> database -> deployment target -> tests -> downstream features`

Do not start by rewriting files based only on the task description.

## 5. Architecture boundaries

Preserve this dependency direction where practical:

`UI/pages/components -> state -> domain -> API service -> backend -> database`

- UI handles presentation and interaction, not duplicated finance/payroll/KPI/attendance formulas.
- Reusable business rules belong in `src/domain/` or the established equivalent.
- Reuse/extend `src/services/idosiApi.js` rather than scattering direct fetch calls through components.
- Do not change schema casually; use migrations and preserve production data.

## 6. Source of truth

Never introduce a second production source of truth.

Do not satisfy persistence requirements using only:
- `localStorage`
- component state
- hard-coded JavaScript objects
- mock data

For persistence changes, inspect the actual target: D1 for Sites and SQLite/file storage for VPS where applicable.

## 7. Authorization and store isolation

Authorization must be enforced at backend/data boundaries, not only by hiding UI controls.

Current role codes include:
- `admin`
- `business_support`
- `store_manager`
- `employee`

Mandatory principles:
- `store_manager` operations remain scoped to the assigned store unless an explicit approved rule says otherwise.
- Employees must not access another employee's protected data by manipulating requests.
- Backend mutations validate role plus relevant store/user/resource scope.
- Never broaden a role's permission incidentally.
- If requirements conflict with existing role behavior, report the conflict instead of silently changing authorization.

Any authorization/store-isolation change is CRITICAL.

## 8. Finance, payroll, KPI, and money

Money-related work is always CRITICAL.

Before modifying finance, payroll, advances, allowances, bonuses, expenses, revenue, profit, or KPI:

1. Find the canonical implementation.
2. Understand inputs/outputs and all downstream consumers.
3. Add/update regression tests before completion.
4. Avoid duplicating formulas in UI/backend/domain.
5. Do not invent a formula when requirements are ambiguous.

Handle relevant edges such as:
- positive/zero/negative values
- null/missing data
- zero working hours
- allowances/bonuses/advances/expenses
- edited/deleted orders
- locked/paid periods
- wrong store/wrong role
- duplicate/retry/idempotency
- timezone/month boundaries where relevant

Follow existing VND representation and rounding conventions; do not silently change units.

## 9. Attendance

Attendance changes can feed working hours, payroll, KPI, history, and statistics.

Changes affecting worked hours, shift resolution, check-in/out time calculations, or payroll/KPI downstream are CRITICAL.

Test relevant boundaries such as missing checkout, late/early state, invalid timestamps, timezone/day rollover, overnight shifts, and location validation.

Do not weaken attendance/location validation merely to make UI tests pass.

## 10. Audit and destructive operations

For sensitive records such as orders, payroll, financial records, attendance, employees, and configuration:
- preserve existing audit behavior
- do not bypass audit logging
- do not silently hard-delete where the design uses history/soft deletion
- preserve actor/time/before-after data where required

Sensitive destructive operations are CRITICAL.

## 11. Tests are implementation

A feature is not complete merely because the UI works manually.

Prefer:
- domain unit tests for formulas/validation
- API/service tests for request behavior
- component/smoke tests for critical flows
- regression tests for bugs

For bug fixes, add a regression test whenever reasonably possible.

Do not delete or weaken valid tests just to obtain green CI.

## 12. Verification by risk level

### FAST

Run the smallest relevant local checks for the changed scope. At minimum:
- targeted test if logic/test coverage exists
- lint/build when the change can affect compile/style correctness
- GitHub required CI `verify` must PASS before merge

A documentation-only FAST change does not need agents to repeatedly execute the entire suite locally when CI will run it, unless repository tooling requires it or the change affects CI/tooling itself.

### STANDARD

Before claiming completion, run from repository root:

```bash
npm run lint
npm test
npm run build
npm run sites:verify
```

Add VPS/runtime checks if VPS behavior can be affected.

### CRITICAL

Run the complete STANDARD verification plus all relevant targeted regression/security/data tests. For VPS/persistence/runtime changes, run the applicable VPS tests and follow backup/migration/rollback requirements.

If a required check fails:
1. identify root cause
2. fix the cause
3. rerun targeted check
4. rerun the full required gate for that risk level before completion

Never claim completion while required verification is failing.

## 13. Credit-efficiency rules

To minimize Codex credit without reducing safety:

- classify risk before deep reading
- search symbols/files/modules before broad repository scans
- reuse analysis already established in the same task
- run targeted tests during iteration and the full required gate only when needed/final
- do not repeatedly run identical expensive checks when code/input has not changed
- avoid generating long reports during implementation; keep reports evidence-based and concise
- avoid rewriting large files when a focused patch is enough
- split overly broad requests into focused PRs
- do not inspect finance/auth/database/VPS for a clearly isolated FAST UI task unless evidence links them

## 14. Git workflow

Do not intentionally develop feature work directly on `main`.

Use focused branches such as:
- `feature/<name>`
- `fix/<name>`
- `refactor/<name>`
- `ui/<name>`
- `chore/<name>`
- `hotfix/<name>`

One coherent business scope per branch/PR.

Before merge:
- review diff
- ensure no unrelated files changed
- complete verification required by Risk Level
- document migrations/production impact when applicable
- required GitHub check `verify` must PASS

Do not bypass the `main` ruleset to save time.

## 15. UI and design

For UI-only work, do not change business logic unless an identified defect requires it.

Maintain consistent typography, valid Vietnamese text, hierarchy, responsive behavior, accessible interactions where practical, and loading/empty/error/disabled states.

`src/styles.css` is already large. Avoid appending large unrelated style sections or repository-wide style refactors for small tasks.

## 16. Security

Never commit production passwords, API secrets, session tokens, private keys, or real credential material.

Do not expose privileged operations only through client-side checks. Do not log passwords, raw session tokens, or sensitive identity data.

Identity documents/images require controlled storage and must not be embedded into shared JSON/localStorage as a shortcut.

## 17. API and mutation safety

For mutations:
- validate inputs
- validate authorization and scope
- handle duplicate submissions where relevant
- preserve idempotency conventions
- return meaningful errors
- ensure UI does not pretend a failed mutation succeeded

## 18. Database migration safety

Database/persistence changes are CRITICAL.

Before adding a migration:
- identify affected production target(s)
- confirm schema change is necessary
- inspect existing migrations
- preserve existing data
- handle defaults/nullability for existing rows
- ensure new code can read old data as required
- define VPS backup/restore implications

Never reset/truncate/recreate production tables merely for convenience.

## 19. Refactoring

Do not perform large unrelated refactors while implementing a feature or bug fix.

Refactor only when it materially reduces risk/duplication required by the current task. Otherwise create a follow-up issue/task.

If expected changed files or modules expand abnormally from the original request, stop and report scope expansion before continuing.

## 20. No silent assumptions

Stop and report ambiguity when it affects:
- money/KPI/payroll
- authorization
- deletion/audit
- schema/data migration
- production deployment behavior

For low-risk presentation details, follow existing UI conventions without unnecessary blocking.

## 21. Production targets and VPS

IDOSI supports Sites/Cloudflare and VPS. Do not assume runtime/persistence compatibility automatically.

When task impact includes persistence, auth/session, storage, bootstrap, migration, data shape, or runtime behavior, validate every affected supported target.

VPS production currently uses Docker Compose, Node.js, SQLite, a persistent data volume, separate image storage, and Caddy. Follow `deploy/vps/README.md` and `docs/VPS_DEPLOYMENT_CHECKLIST.md`.

Do not edit source files directly on production VPS. Deploy only code merged to `main` unless using an explicitly defined staging flow.

## 22. Definition of Done

A task is complete only when applicable items are satisfied:
- Risk Level is explicitly stated and justified
- requested behavior is implemented
- existing behavior outside scope is preserved
- authorization/store isolation is preserved when relevant
- business rules remain canonical and non-duplicated
- affected production targets are identified
- tests required by Risk Level are added/updated and pass
- required verification for Risk Level passes
- migrations/backup/rollback are documented when needed
- no secrets introduced
- diff reviewed for unrelated changes
- manual/post-deploy checks documented/performed when applicable

## 23. Required final report

Report concisely:

1. Risk Level and reason
2. Summary of behavior
3. Files/modules changed
4. Business/domain impact
5. Authorization/store impact
6. API/backend impact
7. Database/migration impact
8. Production target impact
9. Tests/checks run and results
10. Remaining risks/manual checks
11. Rollback/deploy notes when applicable

Do not pad the final report with unrelated analysis.

## 24. Execution objective

For FAST:

`classify -> targeted analyze -> branch -> minimal change -> targeted verify -> PR -> CI`

For STANDARD:

`classify -> impact map -> tests -> implement -> full verify -> PR -> CI`

For CRITICAL:

`classify -> deep impact map -> regression tests -> minimal implementation -> security/data review -> full verify -> PR -> CI/review -> production safeguards`

The objective is to make the smallest correct, secure, testable change while spending analysis/test effort in proportion to actual risk.

## 25. Automatic repository delivery and VPS deployment

For user-requested IDOSI source changes, the default delivery behavior is automatic after implementation. Do not ask for a separate confirmation to push, open the PR, merge a verified PR, or deploy the merged release unless the user explicitly asks to stop before one of those stages.

Mandatory delivery chain:

`change -> focused branch -> tests/checks by Risk Level -> PR -> required check verify -> merge main -> Verify IDOSI on main -> automatic VPS deploy workflow -> backup -> Docker Compose rebuild -> health check`

Rules:
- never push feature work directly to `main`
- never bypass the `verify` required check
- merge only after the PR is mergeable and required CI passes
- after merge, do not perform ad-hoc SSH edits; `.github/workflows/deploy-vps.yml` owns production deployment
- deployment must target the exact verified `main` SHA
- production data must be backed up before the new release is pulled/built
- if deployment or health check fails, report the failure and retained backup; do not silently declare success
- do not automatically restore a production backup merely because a health check fails, because that may overwrite writes made after backup; rollback/restore must follow the documented incident procedure
- user confirmation is still required only when the business requirement itself is ambiguous in a CRITICAL area (money, permissions, destructive data semantics, migrations with unclear intent), not for routine delivery steps after an already-approved implementation request

One-time repository/VPS credential setup is documented in `docs/AUTOMATIC_DELIVERY.md`. Once configured, routine verified merges deploy without another user prompt.
