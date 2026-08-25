# AGENTS.md — IDOSI Engineering Guide

Mandatory rules for Codex and coding agents modifying IDOSI.

## 1. Mission

Finish the user's task **as fast as safely possible** with the smallest correct, production-quality change. Preserve finance/payroll correctness, data integrity, authorization, auditability, persistence safety, responsive behavior, maintainability, and regression protection.

The user may describe work in normal business language. **Do not require the user to write a technical prompt, file list, implementation plan, test plan, or Codex command.** Convert the request into an internal execution brief automatically and start work.

Speed comes from expert judgment, tight scope, correct model routing, targeted reads/tests, and removing redundant loops — never from skipping correctness checks on affected flows.

## 2. Professional Engineering Standard — mandatory

Operate at a **senior/staff software-engineering quality standard equivalent to 10+ years of professional practice**. This is a quality bar, not a claim of literal personal work history.

Work end-to-end as needed across:

- product/UX reasoning and UI design quality
- system/software architecture
- frontend and backend engineering
- APIs and integrations
- databases, migrations, persistence, caching and storage
- authentication, authorization and security
- performance, concurrency and reliability
- testing, debugging, regression analysis and code review
- CI/CD, deployment, VPS/runtime and observability
- maintainability, refactoring and technical debt control

Be broadly capable across modern programming languages, frameworks and tools, but **never rely on assumed universal knowledge**. A technology, API, library, framework, platform behavior, version, syntax, or convention that is unfamiliar, ambiguous, version-sensitive, or rapidly changing must be verified from repository evidence and/or authoritative documentation when available.

Every implementation should aim for:

- **Correctness:** solves the real requirement and preserves invariants.
- **Simplicity:** smallest coherent solution; no unnecessary abstractions.
- **Efficiency:** good runtime/DB/network behavior and low implementation overhead.
- **Productivity:** avoid repeated analysis, repeated full tests and unrelated refactors.
- **Consistency:** follow existing architecture, patterns, naming and design system.
- **Testability:** logic has clear seams and appropriate regression coverage.
- **Security:** least privilege, validated inputs, no secret leakage or permission bypass.
- **Maintainability:** readable code, canonical logic, no duplicated source of truth.
- **Professional UX:** clear hierarchy, responsive states, loading/error/empty/disabled behavior where relevant.

Do not produce merely "working" code when a clearly better, equally scoped production-grade implementation is available.

## 3. Evidence-First / No Hallucination Rule — mandatory

**Never fabricate, guess, or present an assumption as fact.** When something is unclear or unknown, reason from evidence and verify it.

Use this evidence order:

1. Current repository code, tests, schemas, configs, migrations, history and established IDOSI business rules.
2. Runtime/tool output and reproducible tests.
3. Official/authoritative documentation for external or version-sensitive technology when available.
4. Standards/specifications or reliable primary references.
5. Logical inference only when direct evidence is unavailable; label it as a hypothesis until verified.

When uncertain:

- separate **known facts**, **unknowns**, and **hypotheses**;
- search/read the exact relevant implementation first;
- compare data flow and callers/consumers;
- form the smallest plausible hypotheses;
- test or inspect evidence to eliminate hypotheses;
- update the root cause/solution when evidence changes;
- state remaining uncertainty instead of inventing an answer.

Never invent:

- a root cause without evidence;
- APIs, methods, flags, schema fields or platform capabilities;
- package/library behavior or version support;
- production state, deployment success or test results that were not observed;
- business formulas, permissions or data semantics not established by requirements/code;
- files/functions that have not been verified to exist.

For bugs, distinguish `symptom -> evidence -> root cause -> fix`. If root cause is not yet confirmed, say `Nguyên nhân cần xác minh trong code` and continue investigation.

## 4. Technical baseline

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

## 5. Automatic Request Compiler — mandatory

For every user request, compile a concise internal execution brief before editing:

```text
GOAL: exact user outcome
ACCEPTANCE: observable behavior that must be true when done
CAUSE/NEED: confirmed cause or business/technical need; unknowns explicitly marked
SOLUTION: evidence-based implementation approach
RISK: FAST | STANDARD | CRITICAL
WORKLOAD: SMALL | MEDIUM | LARGE | CRITICAL
MODEL: GPT-5.6 Terra | GPT-5.6 Sol | runtime fallback
REASONING: HIGH | XHIGH
SPEED: FAST | ULTRA FAST if supported
SCOPE: expected modules/files
CANONICAL SOURCE: existing logic/data source to preserve/reuse
AFFECTED FLOWS: primary + related/downstream flows
INVARIANTS: behavior/data/permission rules that must not regress
TEST MATRIX: targeted tests + related-flow regressions + final gate
DELIVERY: branch -> patch -> PR -> CI -> merge
```

Do not ask for implementation details that can be discovered from the repository. Low-risk unspecified details follow existing conventions. Surface ambiguity only when a wrong interpretation could materially change money/KPI/payroll, authorization, destructive behavior, schema/data migration, or production deployment semantics.

## 6. Visible Task Intake Report — mandatory before implementation

Show one concise report, then proceed immediately:

```text
NGUYÊN NHÂN / NHU CẦU:
- <confirmed cause, or need; mark unknown cause honestly>

GIẢI PHÁP:
- <evidence-based solution>

CÔNG VIỆC SẼ THỰC HIỆN:
1. <actionable step>
2. <actionable step>
3. <related-flow tests / delivery when relevant>

MỨC ĐỘ & PHẠM VI DỰ KIẾN:
- Risk: FAST | STANDARD | CRITICAL
- Workload: SMALL | MEDIUM | LARGE | CRITICAL
- Scope: <main modules/flows>
- Verification: <targeted / related-flow / final gate>
```

Do not promise exact completion time in minutes/hours or future delivery. Workload + scope + steps are the forecast. Do not ask the user to approve this report unless a genuine business/safety ambiguity requires a decision.

## 7. Model, reasoning and speed routing

**HIGH reasoning is the minimum quality floor** when runtime exposes that control.

- Normal/default: **GPT-5.6 Terra + HIGH + FAST**.
- Cross-layer/harder normal: **GPT-5.6 Sol + HIGH + FAST**.
- Money/finance/difficult: **GPT-5.6 Sol + HIGH + ULTRA FAST** when supported; otherwise fastest available mode, at least FAST.
- Prefer Sol for revenue/expense/profit/payroll/salary/KPI/bonus/allowance/advance/order-money, difficult auth/store isolation, schema/migration/persistence, destructive data repair, concurrency/idempotency, VPS/runtime/storage and complex cross-system rules.
- Use XHIGH only when HIGH is demonstrably insufficient.
- Select model once at task start; switch at most once if material evidence changes complexity/risk.
- If runtime cannot select requested model/reasoning/speed, state the recommended route once and continue using the best available current runtime. Never claim a switch that did not occur.

## 8. Risk levels

### FAST
Presentation/documentation-only; no change to business rules, contracts, mutations, persistence, auth, finance formulas, attendance calculations or production runtime.

`compile -> intake -> targeted read -> branch -> minimal patch -> targeted check -> PR -> CI -> merge`

### STANDARD
Ordinary non-sensitive CRUD/form/validation/report/API/state/UI behavior without changing canonical finance/payroll/auth/schema/persistence/core production rules.

`compile -> intake -> targeted impact -> targeted tests -> patch -> related-flow regression -> final gate -> PR -> CI -> merge`

### CRITICAL
Any change to finance/money, payroll/KPI, attendance feeding payroll, order-money/audit mutations, authorization/store isolation/session, schema/migration/persistence, destructive data, sensitive idempotency/concurrency, VPS/runtime/storage/deployment or core rules with material downstream impact.

`compile -> intake -> focused deep impact -> regression matrix -> minimal patch -> security/data review -> related-flow regression -> one full final gate -> PR -> CI -> merge -> safeguards`

CRITICAL means stronger evidence/testing of the affected dependency graph, not a whole-repo rewrite.

## 9. Hard Scope Gate

- Search exact feature names, routes, functions, tests, handlers and schema entities before broad scans.
- One PR normally = one coherent business objective.
- If request has >3 independent objectives or expected changes exceed ~20 source/test files, split into focused sub-scopes/PRs and execute sequentially.
- If diff unexpectedly exceeds 25 changed files, stop expanding and split independent remaining work.
- Do not bundle unrelated UI + database + VPS + settings + another feature merely because they were in one message.
- Do not ask the user to repeat known requirements.

## 10. Fast Expert Execution Sequence

1. Start from latest `main`; fresh focused branch.
2. Compile request and show intake report.
3. Route Risk + Model + Reasoning + Speed.
4. Search/read only directly relevant code first.
5. Establish facts, unknowns and hypotheses; verify uncertain points.
6. Find/reuse canonical logic/source of truth.
7. Build Related-Flow Map before changing functional logic.
8. Add/run targeted regression tests where useful.
9. Implement smallest production-quality patch.
10. Self-review as designer + architect + coder + tester + security/reliability reviewer where relevant.
11. During iteration rerun only checks invalidated by edits.
12. Run Related-Flow Regression Matrix.
13. Run final local gate once after stabilization.
14. Open PR promptly; GitHub `verify` is authoritative repository-wide gate.
15. CI fail -> inspect evidence -> reproduce targeted -> fix root cause -> rerun invalidated checks only.
16. Merge after required checks pass.

Do not repeat analysis, model selection, intake report or full verification when code/input has not materially changed.

## 11. Related-Flow Map and Regression Matrix — mandatory

Trace only the relevant dependency chain:

`input/event -> UI -> state -> domain -> API/backend -> persistence -> readers/reports -> downstream finance/payroll/audit/auth/runtime`

Test all applicable categories:

- primary happy path
- previous/backward-compatible behavior
- create/update/delete/read neighbors sharing entity/contract
- UI/state/domain/API consumers
- role/store/user isolation + denied paths
- duplicate/retry/idempotency
- persistence/reload/data-shape compatibility
- finance/payroll/KPI downstream calculations when inputs feed money
- attendance/timezone/day/month/overnight boundaries when time is involved
- locked/closed/deleted lifecycle states
- Sites/VPS compatibility for shared runtime/persistence changes
- desktop/mobile/responsive behavior for UI changes

Do not test unrelated modules merely to appear thorough. A task is not done if the primary path works but an identified related/downstream flow regresses.

## 12. Architecture and source of truth

Preserve where practical:
`UI/pages/components -> state -> domain -> API service -> backend -> database`

- UI handles presentation/interaction, not duplicated finance/payroll/KPI/attendance formulas.
- Reusable business rules belong in `src/domain/` or established equivalent.
- Reuse/extend `src/services/idosiApi.js` rather than scattering direct fetch calls.
- Do not satisfy production persistence with component state, mocks, hard-coded objects or `localStorage`.
- Schema changes require safe migrations and data preservation.

## 13. Finance, payroll, KPI, attendance, auth and persistence

For canonical money/payroll/KPI changes: find canonical implementation, identify relevant inputs/outputs/persistence/downstream consumers, add/update regression tests, test downstream money flows, preserve VND representation/rounding, and never invent formulas.

When relevant test zero/negative/null, zero-hours, bonus/allowance/advance, locked periods, duplicate/retry, wrong role/store and month/time boundaries.

Attendance feeding payroll/KPI is CRITICAL; test missing checkout, timezone/day rollover, overnight shifts, invalid timestamps and schedule resolution when affected.

Authorization is enforced at backend/data boundaries, not UI only. Preserve assigned-store/user isolation unless requirement explicitly changes it.

Migration/persistence changes must preserve existing rows and define backup/rollback implications. Never reset/truncate production for convenience.

## 14. Test and verification policy

### During iteration
- targeted tests for changed path + related flows;
- targeted lint when practical;
- no full `npm test` after every edit;
- no repeated expensive checks when relevant code/input did not change.

### FAST final local gate
Only justified targeted checks. Docs-only changes do not need a local full suite. GitHub `verify` remains repository-wide gate.

### STANDARD final local gate
- targeted tests + related-flow regressions
- `npm run lint`
- `npm run build`
- `npm run sites:verify`
- local full `npm test` only for shared/cross-cutting logic or insufficient targeted coverage

### CRITICAL final local gate
Run once after stabilization:

```bash
npm run lint
npm test
npm run build
npm run sites:verify
```

Plus applicable targeted regression/security/data/VPS/persistence checks.

Never report PASS unless the check was actually run and observed to pass.

## 15. Git, production and security

- Never intentionally develop feature work directly on `main`.
- Each task uses a fresh branch from latest `main`.
- Avoid repeated merge-from-main cycles; sync only when necessary.
- Required GitHub `verify` must PASS before merge.
- Preserve audit/history; do not hard-delete where soft deletion/history exists.
- Validate only affected production targets.
- Never edit production VPS source directly.
- Never commit production passwords, secrets, tokens or private keys.

## 16. Definition of Done

Applicable items:

- user request auto-compiled; intake report shown once;
- cause/need and solution are evidence-based, with uncertainty stated honestly;
- implementation meets senior/staff production-quality standard;
- no fabricated API/root cause/schema/test/deploy claim;
- correct routing used/recommended truthfully;
- scope focused; canonical logic/source of truth preserved;
- Related-Flow Map complete for functional changes;
- primary + all applicable related regressions pass;
- authorization/store isolation preserved;
- final local gate appropriate to Risk passes;
- required GitHub `verify` passes;
- no unrelated changes or secrets;
- migration/rollback/production safeguards documented when relevant.

## 17. Final report — concise and evidence-based

Report only:

1. Confirmed cause/need and final solution
2. What changed
3. Main files/modules
4. Related flows tested and actual results
5. Final checks/CI actual results
6. Remaining uncertainty/risk/rollback when relevant

If something was not verified, say so explicitly. Never fill gaps with guesses.

## 18. Execution objective

- FAST: `auto-compile -> intake -> Terra HIGH FAST -> expert targeted patch -> targeted check -> PR -> CI`
- STANDARD: `auto-compile -> intake -> Terra/Sol HIGH FAST -> evidence -> related-flow map -> targeted tests -> production-grade patch -> regression matrix -> one final gate -> PR -> CI`
- CRITICAL/finance/difficult: `auto-compile -> intake -> Sol HIGH ULTRA FAST if supported -> evidence-driven deep impact -> regression matrix -> minimal production-grade patch -> one full final gate -> PR -> CI -> safeguards`

Overriding rule: **work like a highly experienced senior engineer across design, architecture, coding, testing and review; be fast and rigorous; when knowledge is uncertain, verify and reason logically from evidence — never fabricate.**