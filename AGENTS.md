# AGENTS.md — IDOSI Engineering Guide

This file defines mandatory working rules for Codex and other coding agents modifying IDOSI.

## 1. Mission: fast delivery without unsafe shortcuts

IDOSI is a production system. The default objective is **finish the user's task quickly with the smallest correct change**, while preserving data integrity, finance/payroll correctness, authorization, auditability, persistence safety, and regression protection.

Do not optimize for long analysis, large refactors, many files, repeated full-test runs, or maximum compute by default. Prefer targeted inspection, focused patches, targeted verification during iteration, and one appropriate final gate.

## 2. Technical baseline

- Node.js >= 22.13
- React 19 + Vite 8 + React Router
- Vitest + ESLint
- Frontend: `src/`
- Domain/business logic: `src/domain/`
- Shared state: `src/state/`
- API client: `src/services/idosiApi.js`
- Backend/runtime: `server/`
- Database/migrations: `db/`, `drizzle/`
- Sites/Cloudflare: Worker API + D1
- VPS: Node.js + SQLite + file/image storage under `server/vps/`, deployment under `deploy/vps/`

`localStorage` is compatibility/demo/development state only and MUST NOT become the production source of truth.

## 3. Mandatory routing: risk, model, reasoning, speed

Before deep work, classify briefly:

```text
RISK: FAST | STANDARD | CRITICAL
MODEL: GPT-5.6 Terra | GPT-5.6 Sol | runtime fallback
REASONING: HIGH | XHIGH
SPEED: FAST | ULTRA FAST if supported
SCOPE: <expected modules/files>
SENSITIVE: <none | finance/payroll/auth/database/VPS/...>
VERIFY: <targeted checks + final gate>
```

### User-required model policy

The quality floor for implementation tasks is **HIGH reasoning**. Do not intentionally route IDOSI coding work below HIGH unless the runtime does not expose that control.

- **Normal/default work:** prefer **GPT-5.6 Terra + HIGH + FAST** for speed/cost, or **GPT-5.6 Sol + HIGH + FAST** when the task is cross-layer or Terra is insufficient.
- **Money/finance and difficult work:** prefer **GPT-5.6 Sol + HIGH + ULTRA FAST** when the current Codex runtime exposes an Ultra Fast speed mode; otherwise use the fastest available mode, at least FAST.
- Finance-sensitive includes revenue, expense, profit, payroll, salary, KPI, bonus, allowance, advance, order-money mutations, closing periods, and calculations that feed those values.
- Also prefer Sol for difficult auth/store isolation, schema/migration/persistence, destructive data repair, concurrency/idempotency, production VPS/runtime/storage, and complex cross-system business rules.
- Use **XHIGH** only when HIGH is demonstrably insufficient for ambiguity, migration complexity, difficult concurrency, or correctness-sensitive cross-system reasoning. Do not raise reasoning merely because the task is large mechanically.
- Choose the model once at task start. Switch at most once when new evidence materially changes complexity/risk. Do not waste time model-hopping.
- If the runtime cannot programmatically select the requested model/reasoning/speed, state the recommended route once and continue with the best available current model. Never block the task and never claim a switch that did not happen.

## 4. Risk levels

### FAST

Presentation/documentation-only work that does not change business rules, contracts, mutations, persistence, auth, finance formulas, attendance calculations, or production runtime behavior.

Examples: labels, copy, typography, spacing, icons, small layout/UI styling, docs.

Flow:
`classify -> targeted read -> branch -> minimal patch -> targeted check -> PR -> CI -> merge`

Never scan the whole repository for a clearly scoped FAST task.

### STANDARD

Ordinary functionality that changes non-sensitive application behavior without modifying canonical finance/payroll/auth/schema/persistence/core production rules.

Examples: normal CRUD, forms, validation, read-only reports, ordinary API/state/UI flows.

Flow:
`classify -> targeted impact map -> branch -> targeted tests -> implement -> targeted recheck -> final gate -> PR -> CI -> merge`

A screen that only displays finance data can remain STANDARD if it does not change formulas, persistence, authorization, or money mutations; model routing may still use Sol when finance context is important.

### CRITICAL

Use CRITICAL when the requested or discovered change modifies any of:

- revenue, expense, profit, payroll, salary, KPI, bonus, allowance, salary advance formulas or money mutations
- order mutations affecting money/audit
- attendance/worked-hours logic that feeds payroll/KPI
- authorization, roles, store/user isolation, authentication/session/credentials
- database schema, migrations, persistence model, destructive data repair
- sensitive idempotency/concurrency/race behavior
- production VPS runtime/storage/deployment behavior
- core business rules with material downstream impact

Flow:
`classify -> focused deep impact -> targeted regression tests -> minimal implementation -> targeted security/data review -> one final full gate -> PR -> CI -> merge -> production safeguards`

CRITICAL means stronger correctness checks, not permission to scan or rewrite unrelated modules.

## 5. Hard scope gate — prevent day-long mega tasks

Before implementation, establish a focused scope from exact symbols/files/modules.

Mandatory rules:

- Search exact feature names, routes, functions, tests, API handlers, and schema entities before broad repository scans.
- One PR should normally contain **one coherent business objective**.
- If a request contains more than **3 independent objectives**, or expected changes exceed roughly **20 source/test files**, automatically split it into focused sub-scopes/PRs and execute them sequentially unless the files are inseparable parts of one migration/architecture change.
- If implementation unexpectedly grows past **25 changed files**, stop expanding, identify why, and split remaining independent work before continuing.
- Generated lockfiles/migration metadata do not count toward the cap when they are unavoidable, but unrelated cleanup does.
- Never combine UI redesign, database migration, VPS tuning, unrelated settings, and another business feature into one PR merely because they arrived in the same user message.
- Do not ask the user to restate already-known requirements. Split operationally yourself unless a genuine business-rule ambiguity would make implementation unsafe.

## 6. Fast execution sequence

For every task:

1. Start from latest `main` and create a focused branch.
2. Classify Risk + model/reasoning/speed.
3. Search/read only the directly relevant code first.
4. Reuse existing canonical logic; do not create parallel implementations.
5. Build only the impact map needed for the actual risk.
6. Run targeted test(s) before/while fixing when useful.
7. Implement the smallest coherent patch.
8. Re-run only affected tests/checks during iteration.
9. Run the final gate **once** after the patch stabilizes.
10. Open PR promptly; let required GitHub CI perform the authoritative repository-wide gate.
11. If CI fails, inspect the failing step, reproduce targeted failure, fix it, and rerun. Do not blindly rerun every expensive local check.
12. Merge after required checks pass and repository rules allow it.

Do not repeat repository analysis or full verification when code/input has not materially changed.

## 7. Architecture and source of truth

Preserve where practical:
`UI/pages/components -> state -> domain -> API service -> backend -> database`

- UI handles presentation/interaction, not duplicate finance/payroll/KPI/attendance formulas.
- Reusable business rules belong in `src/domain/` or established equivalent.
- Reuse/extend `src/services/idosiApi.js` rather than scattering direct fetch calls.
- Do not satisfy production persistence with component state, hard-coded objects, mocks, or `localStorage`.
- Schema changes require additive/safe migrations and data preservation.

## 8. Authorization and store isolation

Current roles include `admin`, `business_support`, `store_manager`, `employee`.

- Enforce authorization at backend/data boundaries, not UI only.
- `store_manager` remains scoped to assigned store unless explicitly approved otherwise.
- Employees must not access another employee's protected data through request manipulation.
- Backend mutations validate role plus store/user/resource scope.
- Never broaden permissions incidentally.

Authorization/store-isolation logic changes are CRITICAL and should route to GPT-5.6 Sol.

## 9. Finance, payroll, KPI and attendance

For canonical money/payroll/KPI changes:

1. Find the canonical implementation first.
2. Understand only relevant inputs, outputs, persistence, and downstream consumers.
3. Add/update targeted regression tests.
4. Avoid duplicated formulas.
5. Do not invent ambiguous formulas.
6. Preserve VND representation and established rounding.

Test relevant boundaries only, such as positive/zero/negative values, zero hours, bonus/allowance/advance, locked periods, duplicate/retry, wrong role/store, and time/month boundaries.

Worked-hours/shift logic feeding payroll/KPI is CRITICAL. Test missing checkout, timezone/day rollover, overnight shifts, invalid timestamps, and schedule resolution only when relevant to the changed path.

## 10. Test and verification policy

Tests are part of implementation, but repeated full suites are not.

### During iteration — all risk levels

- Run targeted test files/suites for the changed path.
- Run targeted lint when practical.
- Do not run `npm test` repeatedly after every small edit.
- Do not rerun the same expensive check when code/input affecting it did not change.

### FAST final local gate

Run only checks justified by the change: targeted lint/test/build as applicable. Documentation-only work does not need a local full suite. Required GitHub `verify` remains the final repository-wide gate.

### STANDARD final local gate

Default:

- targeted tests for changed logic
- `npm run lint`
- `npm run build`
- `npm run sites:verify`

Run local full `npm test` only when shared/cross-cutting logic changed or targeted coverage is insufficient. GitHub `verify` runs the authoritative full suite.

### CRITICAL final local gate

Run once after stabilization:

```bash
npm run lint
npm test
npm run build
npm run sites:verify
```

Plus relevant targeted regression/security/data/VPS/persistence checks. VPS checks are required only when VPS/runtime/storage is actually affected.

If a final gate fails: root cause -> targeted fix -> targeted rerun -> rerun only the final gates invalidated by that fix.

## 11. Git and conflict control

- Never intentionally develop feature work directly on `main`.
- Use focused `feature/`, `fix/`, `refactor/`, `ui/`, `chore/`, `hotfix/` branches.
- Create each new task branch from latest `main`; do not reuse stale completed branches.
- Sync/rebase/merge `main` only when needed. Avoid repeated merge-from-main cycles.
- Before PR, if `main` advanced, sync only when files/dependencies overlap or GitHub reports the branch needs update.
- Resolve conflicts narrowly; do not pull unrelated work into the task.
- Required GitHub `verify` must PASS before merge.

## 12. Production, database and destructive safety

- Preserve audit/history behavior for sensitive records.
- Do not silently hard-delete where soft deletion/history exists.
- Never reset/truncate production for convenience.
- Migration/persistence changes must preserve existing rows and identify backup/rollback implications.
- IDOSI supports Sites/Cloudflare and VPS; validate only affected targets.
- Follow `deploy/vps/README.md` and `docs/VPS_DEPLOYMENT_CHECKLIST.md` when VPS production behavior changes.
- Never edit production VPS source directly.

## 13. Security

Never commit production passwords, secrets, tokens, private keys, or credential material. Validate inputs, authorization/scope, duplicate submissions/idempotency where relevant, and meaningful mutation errors.

## 14. Refactoring discipline

Do not perform unrelated large refactors. If a clean refactor is useful but not required to satisfy the task, leave it for a separate PR. The goal is the smallest safe patch, not the prettiest rewrite.

## 15. Ambiguity

Do not block on low-risk presentation details; follow existing conventions. For ambiguity that materially changes money/KPI/payroll, authorization, destructive behavior, schema/data migration, or production deployment semantics, do not invent rules. Preserve current behavior where possible and report the unresolved business decision clearly.

## 16. Definition of Done

Applicable items:

- requested behavior implemented
- correct model/reasoning/speed route recommended or used truthfully
- scope remains focused; broad requests split when required
- canonical business rules and source of truth preserved
- authorization/store isolation preserved
- targeted iteration checks passed
- final local gate appropriate to Risk passed
- required GitHub `verify` passed
- no secrets introduced
- diff reviewed for unrelated changes
- migration/rollback/production safeguards documented when applicable

## 17. Final report — concise

Report only:

1. Routing: Risk + model + reasoning + speed/fallback
2. What changed
3. Main files/modules
4. Business/auth/database/production impact when relevant
5. Tests/checks and results
6. Remaining risk/rollback only when relevant

Do not pad the report with repeated analysis.

## 18. Execution objective

- FAST: `Terra HIGH FAST -> targeted read -> minimal patch -> targeted check -> PR -> CI`
- STANDARD: `Terra/Sol HIGH FAST -> targeted impact -> targeted tests -> patch -> one final local gate -> PR -> CI`
- CRITICAL / finance / difficult: `Sol HIGH ULTRA FAST if supported -> focused deep impact -> targeted regression -> minimal patch -> one full final gate -> PR -> CI -> safeguards`

The overriding rule is: **HIGH reasoning is the minimum quality floor requested for IDOSI; speed comes from tighter scope, faster model mode, targeted reads/tests, and eliminating redundant work — never from skipping correctness safeguards where they matter.**