# AGENTS.md — IDOSI Engineering Guide

Mandatory rules for Codex and coding agents modifying IDOSI.

## 1. Mission

Finish the user's task **as fast as safely possible** with the smallest correct change. Preserve finance/payroll correctness, data integrity, authorization, auditability, persistence safety, responsive behavior, and regression protection.

The user should be able to describe work in normal language. **Do not require the user to write a technical prompt, implementation plan, file list, test plan, or Codex command.** Convert the request into an internal execution brief automatically and start work.

Speed comes from tight scope, correct model routing, targeted reads/tests, and removing redundant loops — never from skipping correctness checks on affected flows.

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

## 3. Automatic Request Compiler — mandatory

For every user request, silently compile it into a concise internal execution brief before editing:

```text
GOAL: exact user outcome
ACCEPTANCE: observable behavior that must be true when done
RISK: FAST | STANDARD | CRITICAL
MODEL: GPT-5.6 Terra | GPT-5.6 Sol | runtime fallback
REASONING: HIGH | XHIGH
SPEED: FAST | ULTRA FAST if supported
SCOPE: expected modules/files
CANONICAL SOURCE: existing logic/data source to preserve/reuse
AFFECTED FLOWS: primary flow + related/downstream flows
INVARIANTS: behavior/data/permission rules that must not regress
TEST MATRIX: targeted tests + related-flow regressions + final gate
DELIVERY: branch -> patch -> PR -> CI -> merge
```

Rules:

- Do not ask the user to rewrite the request as a prompt.
- Do not ask for implementation details that can be discovered from the repository.
- Use the current request, existing IDOSI conventions, canonical code, and previous established business rules to fill the execution brief.
- If low-risk details are unspecified, follow existing UI/business conventions and continue.
- Only surface ambiguity when choosing one interpretation could materially change money/KPI/payroll, authorization, destructive behavior, schema/data migration, or production deployment semantics. Otherwise make the safest compatible choice and proceed.
- Never spend a long visible analysis phase before coding. The execution brief is an internal control, not a reason to delay implementation.

## 4. Visible Task Intake Report — mandatory before implementation

Immediately after receiving a task and before deep implementation, show the user a **short execution report**. Keep it concise enough that it does not become a planning bottleneck.

Required format:

```text
NGUYÊN NHÂN / NHU CẦU:
- <root cause if confirmed, otherwise the business/technical need>

GIẢI PHÁP:
- <proposed solution, preserving canonical logic/source of truth>

CÔNG VIỆC SẼ THỰC HIỆN:
1. <task step 1>
2. <task step 2>
3. <tests / related flows / delivery as applicable>

MỨC ĐỘ & PHẠM VI DỰ KIẾN:
- Risk: FAST | STANDARD | CRITICAL
- Workload: SMALL | MEDIUM | LARGE | CRITICAL
- Scope: <main modules/flow groups>
- Verification: <targeted / related-flow / final gate>
```

Rules for this report:

- For a bug: state the confirmed root cause if already known. If not yet confirmed, say `Nguyên nhân cần xác minh trong code` and state the leading evidence; do not invent a root cause.
- For a new feature/change request: use `NHU CẦU` or the business reason instead of pretending there is a defect.
- `GIẢI PHÁP` must describe the intended technical/business approach, not generic filler.
- `CÔNG VIỆC SẼ THỰC HIỆN` must be actionable and scoped; include related-flow testing when a functional path changes.
- Do **not** promise an exact completion time in minutes/hours or a future delivery time. Use `Workload` plus expected scope/steps as the forecast. The agent must perform the task in the current execution rather than defer work.
- Do not ask the user to approve this report unless a genuine safety-critical/business-rule ambiguity requires a decision. After displaying it, proceed immediately.
- Update the report only if root cause, Risk, scope, or solution materially changes. Do not repeatedly restate the same plan.

## 5. Model, reasoning, and speed routing

**HIGH reasoning is the minimum quality floor** for IDOSI implementation work when the runtime exposes that control.

- Normal/default task: **GPT-5.6 Terra + HIGH + FAST**.
- Cross-layer or clearly harder normal task: **GPT-5.6 Sol + HIGH + FAST**.
- Money/finance/difficult task: **GPT-5.6 Sol + HIGH + ULTRA FAST** when the runtime exposes Ultra Fast; otherwise the fastest available mode, at least FAST.
- Finance-sensitive includes revenue, expense, profit, payroll, salary, KPI, bonus, allowance, advance, order-money mutations, closing periods, and calculations feeding those values.
- Prefer Sol also for difficult auth/store isolation, schema/migration/persistence, destructive data repair, concurrency/idempotency, VPS/runtime/storage, and complex cross-system rules.
- Use XHIGH only when HIGH is demonstrably insufficient for difficult ambiguity, migration/concurrency, or correctness-sensitive cross-system reasoning.
- Select the model once at task start. Switch at most once if new evidence materially changes complexity/risk.
- If runtime cannot select the requested model/reasoning/speed, state the recommended route once and continue using the best available current runtime. Never block and never claim a switch that did not occur.

## 6. Risk levels

### FAST

Presentation/documentation-only work with no change to business rules, contracts, mutations, persistence, auth, finance formulas, attendance calculations, or production runtime.

Flow: `compile request -> intake report -> targeted read -> branch -> minimal patch -> targeted check -> PR -> CI -> merge`

### STANDARD

Ordinary non-sensitive CRUD/form/validation/report/API/state/UI behavior without modifying canonical finance/payroll/auth/schema/persistence/core production rules.

Flow: `compile request -> intake report -> targeted impact -> branch -> targeted tests -> patch -> related-flow tests -> final gate -> PR -> CI -> merge`

### CRITICAL

Use when changing finance/money, payroll/KPI, attendance feeding payroll, order-money/audit mutations, authorization/store isolation/session, schema/migration/persistence, destructive data repair, sensitive idempotency/concurrency, production VPS runtime/storage/deployment, or other core rules with material downstream impact.

Flow: `compile request -> intake report -> focused deep impact -> regression matrix -> minimal patch -> security/data review -> related-flow tests -> one full final gate -> PR -> CI -> merge -> safeguards`

CRITICAL means stronger testing of the affected dependency graph, **not** scanning or rewriting the whole repository.

## 7. Hard Scope Gate

- Search exact feature names, routes, functions, tests, API handlers, and schema entities before broad scans.
- One PR should normally contain one coherent business objective.
- If a request has more than 3 independent objectives or is expected to exceed roughly 20 source/test files, automatically split it into focused sub-scopes/PRs and execute sequentially.
- If a diff unexpectedly grows beyond 25 changed files, stop expanding and split independent remaining work.
- Unavoidable generated migration/metadata files may be excluded from the cap.
- Do not bundle unrelated UI redesign + database + VPS + settings + another feature simply because they were stated in one message.
- Do not ask the user to repeat already-known requirements; split operationally yourself.

## 8. Fast execution sequence

1. Start from latest `main`; create a fresh focused branch.
2. Compile the user's request into the execution brief.
3. Show the short Visible Task Intake Report.
4. Route Risk + Model + Reasoning + Speed.
5. Targeted-search the directly relevant symbols/files/modules.
6. Find and reuse canonical logic/source of truth.
7. Build a **Related-Flow Map** before editing logic.
8. Run targeted regression tests where useful.
9. Implement the smallest coherent patch.
10. During iteration, rerun only checks invalidated by the edit.
11. Run the relevant **Related-Flow Regression Matrix**.
12. Run the final local gate once after stabilization.
13. Open PR promptly; GitHub `verify` is the authoritative repository-wide gate.
14. If CI fails: inspect failing step -> reproduce targeted -> fix -> rerun invalidated checks only.
15. Merge after required checks pass and repository rules allow it.

Do not repeat repository analysis, model selection, intake report, or full verification when code/input has not materially changed.

## 9. Related-Flow Map and Regression Matrix — mandatory

Every functional change must identify what else can break because of it.

Trace only the relevant dependency chain:

`input/event -> UI -> state -> domain -> API/backend -> database/persistence -> readers/reports -> downstream finance/payroll/audit/auth/runtime`

For the changed path, test applicable categories:

- primary happy path
- previous/legacy behavior that must remain valid
- create/update/delete/read neighbors sharing the same entity or contract
- API/state/domain consumers of the changed field/function
- role/store/user isolation and permission-denied path when relevant
- duplicate/retry/idempotency when mutations can repeat
- persistence/reload/backward compatibility when data shape changes
- finance/payroll/KPI downstream calculations when an input feeds money
- attendance/timezone/day/month/overnight boundaries when time data is involved
- locked/closed/deleted states when records have lifecycle rules
- Sites/VPS compatibility when shared backend/persistence/runtime logic changes
- desktop/mobile/responsive interaction when UI layout or interaction changes

Do **not** test unrelated modules merely to appear thorough. The requirement is complete coverage of the affected dependency graph, not repository-wide manual testing on every edit.

A task is not done if the primary screen works but an identified downstream/related flow regresses.

## 10. Architecture and source of truth

Preserve where practical:
`UI/pages/components -> state -> domain -> API service -> backend -> database`

- UI handles presentation/interaction, not duplicate finance/payroll/KPI/attendance formulas.
- Reusable business rules belong in `src/domain/` or established equivalent.
- Reuse/extend `src/services/idosiApi.js` rather than scattering direct fetch calls.
- Do not satisfy production persistence with component state, mocks, hard-coded objects, or `localStorage`.
- Schema changes require safe migrations and data preservation.

## 11. Finance, payroll, KPI, attendance, auth, persistence

For canonical money/payroll/KPI changes:

1. Find canonical implementation.
2. Identify relevant inputs, outputs, persistence, and downstream consumers.
3. Add/update targeted regression tests.
4. Test affected related flows before final gate.
5. Avoid duplicated formulas and do not invent ambiguous formulas.
6. Preserve VND representation and established rounding.

Test relevant boundaries such as positive/zero/negative/null, zero hours, bonus/allowance/advance, locked periods, duplicate/retry, wrong role/store, month/time boundaries.

Worked-hours/shift logic feeding payroll/KPI is CRITICAL. When applicable, test missing checkout, timezone/day rollover, overnight shifts, invalid timestamps, and schedule resolution.

Authorization is enforced at backend/data boundaries, not UI only. `store_manager` remains scoped to assigned stores unless explicitly changed; employees must not access protected data of other employees through request manipulation.

Migration/persistence changes must preserve existing rows and identify backup/rollback implications. Never reset/truncate production for convenience.

## 12. Test and verification policy

### During iteration

- Run targeted test files/suites for the changed path and related flows.
- Use targeted lint when practical.
- Do not run `npm test` after every small edit.
- Do not rerun the same expensive check when relevant code/input did not change.

### FAST final local gate

Only checks justified by the change. Documentation-only work does not require a local full suite. GitHub `verify` remains the repository-wide gate.

### STANDARD final local gate

Default:

- targeted tests for changed logic + related-flow regressions
- `npm run lint`
- `npm run build`
- `npm run sites:verify`

Run local full `npm test` when shared/cross-cutting logic changed or targeted coverage is insufficient.

### CRITICAL final local gate

Run once after stabilization:

```bash
npm run lint
npm test
npm run build
npm run sites:verify
```

Plus applicable targeted regression/security/data/VPS/persistence checks from the Related-Flow Matrix.

If a final gate fails: root cause -> targeted fix -> targeted rerun -> rerun only final gates invalidated by that fix.

## 13. Git, production, security

- Never intentionally develop feature work directly on `main`.
- Create each task branch from latest `main`; do not reuse stale completed branches.
- Avoid repeated merge-from-main cycles; sync only when needed for overlapping changes or GitHub requirements.
- Required GitHub `verify` must PASS before merge.
- Preserve audit/history behavior for sensitive records; do not silently hard-delete where history/soft deletion exists.
- Validate only affected production targets. Use `deploy/vps/README.md` and `docs/VPS_DEPLOYMENT_CHECKLIST.md` when VPS behavior changes.
- Never edit production VPS source directly.
- Never commit production passwords, secrets, tokens, or private keys.

## 14. Definition of Done

Applicable items:

- user's natural-language request was converted into an execution brief automatically
- Visible Task Intake Report was shown once before implementation
- requested behavior implemented without requiring the user to author a technical prompt
- model/reasoning/speed route selected truthfully
- scope remains focused; broad requests split when necessary
- canonical logic/source of truth preserved
- Related-Flow Map completed for functional changes
- primary path and all applicable related/downstream regressions pass
- authorization/store isolation preserved
- final local gate appropriate to Risk passes
- required GitHub `verify` passes
- no unrelated changes or secrets introduced
- migration/rollback/production safeguards documented when applicable

## 15. Final report — concise

Report only:

1. Confirmed cause/need and solution actually implemented
2. What changed
3. Main files/modules
4. Related flows tested and result
5. Final checks/CI result
6. Remaining risk/rollback only when relevant

Do not pad the report with repeated analysis.

## 16. Execution objective

- FAST: `auto-compile request -> intake report -> Terra HIGH FAST -> targeted patch -> targeted check -> PR -> CI`
- STANDARD: `auto-compile request -> intake report -> Terra/Sol HIGH FAST -> related-flow map -> targeted tests -> patch -> regression matrix -> one final gate -> PR -> CI`
- CRITICAL/finance/difficult: `auto-compile request -> intake report -> Sol HIGH ULTRA FAST if supported -> focused impact -> regression matrix -> minimal patch -> one full final gate -> PR -> CI -> safeguards`

Overriding rule: **the user states the business request; Codex automatically turns it into the best execution prompt, displays the cause/solution/work plan/workload forecast briefly, and implements it quickly. Any flow affected by the change must be tested carefully before completion.**