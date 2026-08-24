# AGENTS.md — IDOSI Engineering Guide

This file defines mandatory working rules for Codex and other coding agents modifying the IDOSI repository.

## 1. Mission

IDOSI is a production system. Prioritize correctness, data integrity, authorization, auditability, maintainability, regression safety, and efficient execution.

Do not optimize for the most code, longest analysis, or strongest model by default. Optimize for the smallest correct change with sufficient evidence and the lowest compute/credit level that can safely complete the task.

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

## 3. Mandatory risk + effort routing before deep work

Before deep analysis or editing, classify every request on two independent axes:

- `RISK LEVEL: FAST | STANDARD | CRITICAL`
- `EFFORT: LOW | MEDIUM | HIGH`

Report briefly:

```text
RISK LEVEL: FAST | STANDARD | CRITICAL
EFFORT: LOW | MEDIUM | HIGH
Reason: <1-3 reasons>
Expected scope: <module/file groups>
Sensitive areas: <finance/payroll/auth/database/VPS/etc or none>
Verification plan: <checks to run>
MODEL ROUTING: AUTO / RECOMMEND <capability class>
```

### Model-routing principle

Model names and availability can change. Do not hard-code a permanent mapping such as `FAST = model X` or `CRITICAL = model Y` in repository policy.

If the Codex environment supports automatic model routing, allow it to choose the cheapest/fastest model that satisfies the required capability and effort. If the environment does not support changing model programmatically, report the recommended capability/effort and continue with the current available model rather than blocking the task.

Never claim to have switched models unless the runtime/product actually performed that switch.

Recommended capability classes:

- FAST + LOW: fast coding/editing model; minimal reasoning.
- STANDARD + MEDIUM: balanced coding model with normal reasoning.
- CRITICAL + HIGH: strongest available coding/reasoning capability appropriate for correctness-sensitive work.
- A FAST task may use MEDIUM effort when the implementation is mechanically broad but low-risk.
- A CRITICAL task is normally HIGH effort, but effort is about reasoning depth, not permission to skip required safety gates.

### FAST

Use only for low-risk presentation/documentation changes that do not change business rules, data contracts, mutations, persistence, auth, money, attendance calculations, or production runtime behavior.

Typical FAST tasks: text/label/typo, color/spacing/icon/typography, small layout-only UI changes, documentation-only changes.

FAST flow:
`classify -> targeted read -> focused branch -> minimal change -> targeted checks -> PR -> required CI -> merge`

Do not scan the whole repository for a clearly scoped FAST task.

### STANDARD

Use for ordinary functionality that changes a non-sensitive flow or logic but does not directly alter finance/payroll/auth/schema/persistence or other CRITICAL areas.

Typical STANDARD tasks: ordinary CRUD flows, non-sensitive forms/validation, read-only reports, normal API/service/state/UI additions.

STANDARD flow:
`classify -> analyze -> impact map -> branch -> tests -> implementation -> self-review -> full verification -> PR -> CI -> merge`

### CRITICAL

CRITICAL is mandatory if the request or discovered impact touches any of:
- finance, revenue, expense, profit
- KPI, payroll, salary, bonus, allowance, salary advance
- order mutations affecting money/audit
- attendance/worked-hours logic feeding payroll/KPI
- authorization, roles, store isolation
- authentication/session/credentials
- database/schema/migration/persistence
- destructive delete/data repair
- sensitive idempotency/concurrency/race conditions
- production VPS runtime/storage/deployment behavior
- core business-rule changes

CRITICAL flow:
`classify -> deep analyze -> impact map -> regression test -> minimal implementation -> security/data self-review -> full verification -> PR -> CI/review -> merge -> production safeguards`

### Escalation rules

- Start with the lowest risk and effort justified by current evidence.
- If inspection reveals more sensitive downstream impact, immediately upgrade Risk Level and/or Effort and state why.
- Never downgrade confirmed CRITICAL work merely to save credit.
- Never keep HIGH effort when evidence shows a scoped low-risk task can safely use LOW/MEDIUM effort.
- Credit efficiency comes from tighter scope, targeted search, reuse of analysis, fewer redundant runs, and adaptive compute — never from skipping required safety checks.

Detailed routing: `docs/DEVELOPMENT_WORKFLOW.md`.

## 4. Mandatory workflow principles

Before editing code:
1. Classify Risk Level and Effort.
2. Read relevant existing code.
3. Search for existing implementation before creating new logic.
4. Identify affected UI, state, domain, API/backend, database, authorization, deployment target, and tests at depth appropriate to risk.
5. Build an Impact Map for STANDARD/CRITICAL, and for FAST if a hidden dependency appears.
6. Determine regression risk and whether migration is required.
7. Prefer the smallest coherent change that fully solves the request.

Recommended Impact Map:
`requirement -> data -> domain -> API/backend -> state -> UI -> database -> deployment target -> tests -> downstream features`

Do not rewrite files based only on the task description.

## 5. Architecture boundaries

Preserve where practical:
`UI/pages/components -> state -> domain -> API service -> backend -> database`

- UI handles presentation/interaction, not duplicated finance/payroll/KPI/attendance formulas.
- Reusable business rules belong in `src/domain/` or established equivalent.
- Reuse/extend `src/services/idosiApi.js` rather than scattering direct fetch calls.
- Schema changes require migrations and data preservation.

## 6. Source of truth

Never introduce a second production source of truth. Do not satisfy persistence requirements using only `localStorage`, component state, hard-coded objects, or mock data. Inspect D1 for Sites and SQLite/file storage for VPS as applicable.

## 7. Authorization and store isolation

Authorization is enforced at backend/data boundaries, not only UI. Current roles include `admin`, `business_support`, `store_manager`, `employee`.

- `store_manager` remains scoped to assigned store unless explicitly approved otherwise.
- Employees must not access another employee's protected data by request manipulation.
- Backend mutations validate role plus store/user/resource scope.
- Never broaden permissions incidentally.
- Authorization/store-isolation changes are CRITICAL/HIGH.

## 8. Finance, payroll, KPI, and money

Money-related work is CRITICAL/HIGH.

Before modifying finance/payroll/advances/allowances/bonuses/expenses/revenue/profit/KPI:
1. Find canonical implementation.
2. Understand inputs/outputs/downstream consumers.
3. Add/update regression tests.
4. Avoid duplicated formulas.
5. Do not invent ambiguous formulas.

Handle relevant positive/zero/negative/null/zero-hours/allowance/bonus/advance/expense/edited-order/locked-period/wrong-store/wrong-role/duplicate/time-boundary cases. Follow existing VND representation and rounding.

## 9. Attendance

Worked-hours/shift/time logic feeding payroll/KPI is CRITICAL/HIGH. Test missing checkout, late/early, invalid timestamps, timezone/day rollover, overnight shifts, and location validation as relevant.

## 10. Audit and destructive operations

Preserve audit behavior and history for sensitive records. Do not silently hard-delete where history/soft deletion is established. Sensitive destructive operations are CRITICAL/HIGH.

## 11. Tests are implementation

Prefer domain unit tests, API/service tests, component/smoke tests, and regression tests for bugs. Do not delete/weaken valid tests merely to obtain green CI.

## 12. Verification by risk level

### FAST
Run smallest relevant local checks. Targeted test if logic exists; lint/build when compile/style can be affected; GitHub required CI `verify` must PASS. Documentation-only changes need not repeatedly run the full suite locally when CI will run it.

### STANDARD
Run:
```bash
npm run lint
npm test
npm run build
npm run sites:verify
```
Add VPS/runtime checks if affected.

### CRITICAL
Run complete STANDARD verification plus relevant targeted regression/security/data tests and applicable VPS/persistence checks.

If required check fails: identify root cause -> fix -> targeted rerun -> final required gate. Never claim completion while required verification fails.

## 13. Credit and compute efficiency

- classify Risk + Effort before deep reading
- use AUTO model routing when product/runtime supports it
- otherwise recommend capability/effort without blocking
- search symbols/files/modules before broad scans
- reuse established analysis in the same task
- targeted tests during iteration; full gate at the appropriate final point
- do not rerun identical expensive checks when code/input has not changed
- keep reports concise
- use focused patches rather than rewriting large files
- split overly broad requests into focused PRs
- do not inspect sensitive modules for isolated FAST UI work without evidence
- escalate model/effort only when complexity/risk evidence warrants it

## 14. Git workflow

Never intentionally develop feature work directly on `main`. Use focused `feature/`, `fix/`, `refactor/`, `ui/`, `chore/`, or `hotfix/` branches. One coherent scope per PR. Required GitHub check `verify` must PASS. Do not bypass `main` ruleset to save time.

## 15. UI and design

UI-only work must not alter business logic unless an identified defect requires it. Maintain consistent typography, Vietnamese text, hierarchy, responsive behavior, interactions, and loading/empty/error/disabled states. Avoid large unrelated style refactors.

## 16. Security

Never commit production passwords, secrets, tokens, private keys, or credential material. Do not expose privileged operations solely through client checks or log sensitive credentials.

## 17. API and mutation safety

Validate inputs, authorization/scope, duplicate submissions where relevant, idempotency conventions, meaningful errors, and failed mutation UI behavior.

## 18. Database migration safety

Database/persistence changes are CRITICAL/HIGH. Identify targets, confirm schema necessity, inspect migrations, preserve data, handle existing rows, and define backup/restore implications. Never reset/truncate production for convenience.

## 19. Refactoring

Do not perform unrelated large refactors. If scope expands abnormally, stop and report scope expansion.

## 20. No silent assumptions

Stop and report ambiguity affecting money/KPI/payroll, authorization, deletion/audit, schema/data migration, or production deployment behavior. Low-risk presentation details should follow existing conventions without unnecessary blocking.

## 21. Production targets and VPS

IDOSI supports Sites/Cloudflare and VPS. Validate every affected target for persistence/auth/storage/bootstrap/migration/data-shape/runtime changes. Follow `deploy/vps/README.md` and `docs/VPS_DEPLOYMENT_CHECKLIST.md`. Do not edit production VPS source directly.

## 22. Definition of Done

Applicable items must be satisfied:
- Risk Level and Effort explicitly stated/justified
- requested behavior implemented
- behavior outside scope preserved
- authorization/store isolation preserved where relevant
- canonical business rules preserved
- affected targets identified
- tests/verification required by Risk Level pass
- migrations/backup/rollback documented when needed
- no secrets introduced
- diff reviewed
- manual/post-deploy checks handled when applicable

## 23. Required final report

Report concisely:
1. Risk Level + Effort + routing reason
2. Summary
3. Files/modules changed
4. Business/domain impact
5. Authorization/store impact
6. API/backend impact
7. Database/migration impact
8. Production target impact
9. Tests/checks and results
10. Remaining risks/manual checks
11. Rollback/deploy notes when applicable

Do not pad reports with unrelated analysis.

## 24. Execution objective

FAST: `classify -> LOW effort by default -> targeted analyze -> minimal change -> targeted verify -> PR -> CI`

STANDARD: `classify -> MEDIUM effort by default -> impact map -> tests -> implement -> full verify -> PR -> CI`

CRITICAL: `classify -> HIGH effort by default -> deep impact map -> regression tests -> minimal implementation -> security/data review -> full verify -> PR -> CI/review -> safeguards`

Effort may adapt when evidence warrants it. The objective is the smallest correct, secure, testable change using the least compute/credit that safely achieves correctness.