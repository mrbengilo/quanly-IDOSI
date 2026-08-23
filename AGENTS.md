# AGENTS.md — IDOSI Engineering Guide

This file defines mandatory working rules for Codex and other coding agents modifying the IDOSI repository.

## 1. Project mission

IDOSI is a production-oriented centralized management system for stores, office staff, and business-support operations. Changes must prioritize correctness, data integrity, authorization, auditability, maintainability, and regression safety over speed.

Never treat this repository as a throwaway prototype.

## 2. Current technical baseline

- Node.js >= 22.5
- React 19
- Vite 8
- React Router
- Vitest
- ESLint
- Frontend source: `src/`
- Business/domain logic: `src/domain/`
- Shared state: `src/state/`
- API client: `src/services/idosiApi.js`
- Backend/runtime: `server/`
- Database/migrations: `db/` and `drizzle/`
- Production data is backend/Worker/D1-backed.
- `localStorage` is compatibility/demo/development state only and MUST NOT become the source of truth for production data.

Before changing architecture, inspect the existing implementation and follow established repository conventions.

## 3. Mandatory workflow for every task

Before editing code:

1. Read the relevant existing code.
2. Identify the affected UI, state, domain, API, backend, database, authorization, and tests.
3. Search for an existing implementation before creating new logic.
4. Build an impact map.
5. Determine regression risks.
6. Determine whether a database migration is actually required.
7. Prefer the smallest coherent change that fully solves the requirement.

Recommended impact map:

`requirement -> data -> domain -> API/backend -> state -> UI -> database -> tests -> affected features`

Do not start by rewriting files based only on the task description.

## 4. Architecture boundaries

Preserve this dependency direction where practical:

`UI/pages/components -> state -> domain -> API service -> backend -> database`

### UI

Pages and components are responsible for presentation and user interaction. Do not duplicate financial, payroll, KPI, attendance, authorization, or other reusable business formulas across components.

### Domain

Reusable business rules belong in `src/domain/` or the repository's existing equivalent abstraction.

Examples include:

- finance calculations
- KPI calculations
- attendance calculations
- payroll calculations
- eligibility and validation rules

Prefer pure functions for calculations when possible so they can be unit-tested.

### API

Reuse and extend `src/services/idosiApi.js` rather than scattering direct fetch calls through UI components unless the existing architecture clearly requires otherwise.

### Database

Do not change schema casually. Any required production schema change must use the project's migration mechanism and must preserve existing data unless the task explicitly defines a safe destructive migration.

## 5. Source of truth

Never introduce a second source of truth for production data.

Do not solve backend persistence requirements by storing production records only in:

- `localStorage`
- component state
- hard-coded JavaScript objects
- mock data

Demo/local compatibility behavior must remain clearly separated from production persistence.

## 6. Authorization and store isolation

Authorization must be enforced at the appropriate backend/data boundary, not only by hiding buttons in the UI.

Current login role codes include:

- `admin`
- `business_support`
- `store_manager`
- `employee`

Always inspect current authorization code before changing permissions.

Mandatory principles:

- `store_manager` operations must remain scoped to the assigned store unless an explicit business rule says otherwise.
- Employees must not gain access to another employee's protected data merely by modifying a request.
- UI visibility is not authorization.
- Backend endpoints must validate authorization and relevant store/user scope.
- Never broaden a role's permissions as an incidental side effect of another feature.

If requirements conflict with existing role behavior, report the conflict before silently changing the authorization model.

## 7. Financial, payroll, KPI, and money rules

Money-related code is high risk.

Before modifying finance, payroll, advances, allowances, bonuses, expenses, revenue, profit, or KPI calculations:

1. Find the canonical existing domain implementation.
2. Understand every input and output.
3. Identify all screens/reports consuming the result.
4. Update or add unit tests before considering the work complete.
5. Avoid duplicating formulas in UI code.

All monetary calculations must explicitly handle relevant edge cases, including where applicable:

- positive values
- zero
- negative profit
- missing/null values
- employee with zero working hours
- allowances
- bonuses
- salary advances
- expenses
- edited/deleted orders
- locked payroll/accounting periods
- store boundaries
- unauthorized users

Never invent a financial formula when requirements are ambiguous. Stop and report the ambiguity.

Avoid unsafe floating-point assumptions for currency. Follow the existing repository's monetary representation; do not silently change units or rounding behavior.

## 8. Attendance rules

Attendance changes may affect payroll, working hours, statistics, and employee history.

When changing attendance logic, inspect downstream dependencies before implementation. Test boundary cases such as missing checkout, late/early status, invalid timestamps, location permission behavior, and records crossing expected time boundaries where relevant.

Do not weaken location or attendance validation merely to make UI flows pass.

## 9. Audit and destructive operations

Deletion and financial/history edits require special care.

For sensitive records such as orders, payroll, financial records, attendance, employees, or configuration:

- preserve existing audit behavior
- do not bypass audit logging
- do not silently hard-delete data when the existing design uses soft deletion/history
- record actor/time/relevant before-after information where the established audit model requires it

Never remove audit trails to simplify implementation.

## 10. Tests are part of the implementation

A feature is not complete merely because the UI works manually.

When business logic changes, update/add the closest relevant tests.

Prefer:

- domain unit tests for formulas and validation
- service/API tests for request behavior
- smoke/component tests for critical user flows
- regression tests for bugs being fixed

For a bug fix, add a regression test whenever reasonably possible.

Do not delete or weaken a valid test just to obtain a green test run. If an existing test is obsolete because the approved business rule changed, explain why and update it to the new rule.

## 11. Required verification before completion

Run all of the following from the repository root:

```bash
npm run lint
npm test
npm run build
npm run sites:verify
```

If any command fails:

1. investigate the root cause
2. fix failures caused by the change
3. rerun the relevant check
4. rerun the full verification sequence before claiming completion

Never claim the task is complete while a required check is failing unless the failure is demonstrably pre-existing and unrelated. In that case, report the exact failure and evidence clearly.

## 12. Git workflow

Do not intentionally develop feature work directly on `main`.

Use a focused branch such as:

- `feature/<name>`
- `fix/<name>`
- `refactor/<name>`
- `chore/<name>`

Keep one coherent business scope per branch/PR.

Avoid combining unrelated changes such as payroll + dashboard redesign + inventory refactor in one task.

Before PR/merge:

- review the diff
- ensure no unrelated files changed
- run the full verification suite
- document migrations and operational impact

## 13. UI and design rules

When a task is UI-only, do not change business logic unless required to fix an identified defect.

Maintain:

- consistent typography
- valid Vietnamese text/diacritics
- clear visual hierarchy
- consistent button states
- responsive behavior
- accessible labels and interactions where practical
- loading states
- empty states
- error states
- disabled/submitting states for mutations

Do not introduce one-off styling if a reusable existing pattern/component already solves the problem.

`src/styles.css` is already large. Avoid casually appending large unrelated style sections. Prefer reusable component/page organization when touching substantial UI areas, while avoiding unnecessary repository-wide refactors.

## 14. Security rules

Never commit:

- production passwords
- API secrets
- session tokens
- private keys
- real credential material

Do not expose privileged backend operations solely through client-side checks.

Do not log passwords, raw session tokens, or sensitive identity data.

Follow existing credential/session hashing and storage mechanisms.

Identity documents/images require controlled storage and must not be embedded into shared JSON/localStorage as a shortcut.

## 15. API and mutation safety

For mutations:

- validate inputs
- validate authorization
- validate store/user scope
- handle duplicate submissions where relevant
- preserve existing idempotency conventions
- return meaningful errors
- ensure UI handles failed requests without pretending success

Never update the UI optimistically in a way that can permanently misrepresent failed financial or destructive mutations.

## 16. Database migration safety

Before adding a migration:

- confirm schema change is necessary
- inspect existing migrations
- make migration deterministic
- preserve existing production data
- consider defaults/nullability for existing rows
- ensure old data remains readable by the new code

Never reset, truncate, or recreate production tables as a convenience unless explicitly approved for a known disposable environment.

## 17. Refactoring rules

Do not perform large unrelated refactors while implementing a feature or bug fix.

Refactor when it materially reduces risk or duplication required by the current task. Otherwise document the follow-up opportunity separately.

Do not rename broad sets of files, routes, API fields, or database columns without a clear requirement and migration/compatibility plan.

## 18. No silent assumptions

Stop and report ambiguity when it affects:

- money calculations
- KPI formulas
- payroll
- authorization
- deletion behavior
- audit requirements
- database schema/data migration
- production deployment

For low-risk presentation details, follow existing UI conventions rather than blocking unnecessarily.

## 19. Definition of done

A task is complete only when applicable items are satisfied:

- requested behavior implemented
- existing behavior preserved outside scope
- authorization enforced
- store isolation preserved
- business rules centralized appropriately
- tests added/updated
- lint passes
- tests pass
- build passes
- sites verification passes
- migrations are included and documented if needed
- no secrets introduced
- diff reviewed for unrelated changes
- manual verification requirements documented

## 20. Required final report from coding agents

At the end of an implementation, report concisely:

1. Summary of completed behavior
2. Files changed
3. Business/domain logic changed
4. Authorization impact
5. API/backend changes
6. Database/migration changes
7. Tests added or updated
8. Result of `npm run lint`
9. Result of `npm test`
10. Result of `npm run build`
11. Result of `npm run sites:verify`
12. Remaining risks/manual checks

Never use the word "complete" or equivalent if required verification is still failing without clearly stating the failure.

## 21. IDOSI task execution order

For substantial features, prefer this order:

`analyze -> impact map -> tests/domain -> backend/API -> state -> UI -> full verification -> diff review -> PR`

For UI-only tasks:

`analyze current screen -> preserve contracts/business rules -> UI implementation -> targeted tests -> full verification -> diff review`

For bug fixes:

`reproduce/identify root cause -> regression test -> minimal fix -> full verification -> diff review`

The objective is not to generate the most code. The objective is to make the smallest correct, secure, testable change that preserves IDOSI's business integrity.
