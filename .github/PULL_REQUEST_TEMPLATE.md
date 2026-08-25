# Pull Request – IDOSI

> Quy trình: `docs/DEVELOPMENT_WORKFLOW.md`.

## Routing
- Risk: [ ] FAST  [ ] STANDARD  [ ] CRITICAL
- Model: [ ] GPT-5.6 Terra  [ ] GPT-5.6 Sol  [ ] Runtime fallback
- Reasoning: [ ] HIGH  [ ] XHIGH
- Speed: [ ] FAST  [ ] ULTRA FAST if supported  [ ] Runtime fastest available
- Lý do routing:
- Expected scope:

> HIGH reasoning là quality floor cho task lập trình IDOSI khi runtime hỗ trợ. Finance/money/difficult work ưu tiên GPT-5.6 Sol + HIGH + ULTRA FAST nếu có; task bình thường ưu tiên Terra HIGH FAST hoặc Sol HIGH FAST khi cross-layer/khó hơn.

## Scope Gate
- [ ] Một mục tiêu nghiệp vụ coherent
- [ ] Không quá 3 mục tiêu độc lập trong cùng PR
- [ ] Dự kiến <=20 source/test files, hoặc có lý do kỹ thuật rõ vì sao inseparable
- [ ] Nếu diff vượt 25 files, phần độc lập đã được tách
- [ ] Không gom unrelated UI/database/VPS/settings/features vào cùng PR

## Sensitive areas
- [ ] None
- [ ] Finance / revenue / expense / profit
- [ ] KPI / payroll / salary / bonus / allowance / advance
- [ ] Order mutation / audit
- [ ] Attendance / worked hours
- [ ] Authorization / role / store isolation
- [ ] Database / migration / persistence
- [ ] Auth / session / credentials
- [ ] VPS runtime / storage / deployment

## Mục tiêu / Root cause
- 

## Phạm vi thay đổi
- [ ] UI/components
- [ ] State
- [ ] Domain/business logic
- [ ] API/services
- [ ] Backend/Worker
- [ ] Database/migration
- [ ] VPS runtime/storage
- [ ] Test
- [ ] CI/tooling
- [ ] Documentation

## Impact
- Business rule changed:
- Authorization/store impact:
- Finance/payroll/KPI impact:
- Database/persistence impact:
- Production target: Sites / VPS / Both / Runtime-unaffected
- Canonical logic/source of truth:

## Verification

### Iteration
- [ ] Targeted tests/checks used while editing
- [ ] Full suite was not rerun unnecessarily

### FAST final local gate
- [ ] Targeted checks phù hợp
- [ ] Lint/build only if relevant

### STANDARD final local gate
- [ ] Targeted tests for changed logic
- [ ] `npm run lint`
- [ ] `npm run build`
- [ ] `npm run sites:verify`
- [ ] Full local `npm test` only if shared/cross-cutting logic required it

### CRITICAL final local gate
- [ ] `npm run lint`
- [ ] `npm test`
- [ ] `npm run build`
- [ ] `npm run sites:verify`
- [ ] Targeted regression/security/data tests
- [ ] VPS/persistence checks only when affected

### Required CI
- [ ] GitHub `verify` PASS

## Self-review
- [ ] No unrelated changes/refactors
- [ ] No duplicate business logic/source of truth
- [ ] API/state contract preserved when relevant
- [ ] Permission/store isolation reviewed when relevant
- [ ] Money/KPI/payroll boundaries reviewed when relevant
- [ ] Idempotency/race/timezone reviewed when relevant
- [ ] Migration/data-loss/Sites-VPS compatibility reviewed when relevant

## Speed / compute efficiency
- [ ] Exact symbols/files searched before broad scan
- [ ] Model selected once; no unnecessary model-hopping
- [ ] HIGH reasoning floor kept when runtime supports it
- [ ] Targeted tests used during iteration
- [ ] Final full gate run once after patch stabilized
- [ ] Failed CI/checks reproduced and fixed targeted instead of blind full reruns
- [ ] Branch created from latest `main`; no repeated merge-from-main cycles

## Rollback / manual checks
- Rollback plan, if relevant:
- Manual checks, if relevant:
- Remaining risks, if any:

## Definition of Done
- [ ] Scope đúng yêu cầu và không thành mega-task
- [ ] Routing đúng policy và không giả vờ switch model/speed
- [ ] Tests/checks theo Risk PASS
- [ ] Required CI `verify` PASS
- [ ] Diff reviewed
- [ ] Production impact/rollback rõ khi cần
- [ ] Không commit secret hoặc tạo production source-of-truth sai