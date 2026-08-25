# Pull Request – IDOSI

> Quy trình: `docs/DEVELOPMENT_WORKFLOW.md`.

## Visible Task Intake Report
- Nguyên nhân / Nhu cầu:
- Giải pháp:
- Công việc sẽ thực hiện:
  1. 
  2. 
  3. 
- Risk: [ ] FAST  [ ] STANDARD  [ ] CRITICAL
- Workload: [ ] SMALL  [ ] MEDIUM  [ ] LARGE  [ ] CRITICAL
- Scope dự kiến:
- Verification dự kiến:

> Không ghi ETA hứa hẹn theo phút/giờ. Dùng Workload + Scope + số bước làm dự báo khối lượng và triển khai ngay.

## Automatic Execution Brief
- Goal:
- Acceptance criteria:
- Model: [ ] GPT-5.6 Terra  [ ] GPT-5.6 Sol  [ ] Runtime fallback
- Reasoning: [ ] HIGH  [ ] XHIGH
- Speed: [ ] FAST  [ ] ULTRA FAST if supported  [ ] Runtime fastest available
- Canonical source/logic:
- Invariants phải giữ:

> User không cần viết prompt kỹ thuật. Codex phải tự compile request thành execution brief rồi triển khai.

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

## Work Completed
Đối chiếu với danh sách công việc đã công bố lúc bắt đầu task:
- [ ] Các bước đã hoàn thành hoặc có lý do rõ nếu thay đổi scope
- [ ] Root cause/need được cập nhật nếu phát hiện khác ban đầu
- [ ] Giải pháp cuối cùng phù hợp canonical architecture/source of truth

Chi tiết:
- 

## Related-Flow Map
Liệt kê các flow thực sự phụ thuộc vào phần thay đổi:
- Primary flow:
- Adjacent CRUD/readers/consumers:
- Auth/store/user flows:
- Finance/payroll/KPI downstream:
- Persistence/backward compatibility:
- Time/lifecycle boundaries:
- Sites/VPS impact:
- Desktop/mobile impact:

## Regression Matrix
Đánh dấu các category áp dụng và ghi test/evidence tương ứng:
- [ ] Happy path chính
- [ ] Behavior cũ/backward compatibility
- [ ] Create/update/delete/read neighbor cùng entity/contract
- [ ] UI/state/domain/API consumers
- [ ] Role/store/user isolation + denied path
- [ ] Duplicate/retry/idempotency
- [ ] Persistence/reload/data shape
- [ ] Revenue/expense/profit/payroll/KPI downstream
- [ ] Timezone/day/month/overnight
- [ ] Locked/closed/deleted lifecycle
- [ ] Sites/VPS compatibility
- [ ] Desktop/mobile/responsive

Test/evidence:
- 

## Verification

### Iteration
- [ ] Targeted tests/checks cho changed path + related flows
- [ ] Không rerun full suite không cần thiết

### FAST final local gate
- [ ] Targeted checks phù hợp
- [ ] Lint/build only if relevant

### STANDARD final local gate
- [ ] Targeted tests + related-flow regressions
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
- [ ] Primary flow PASS
- [ ] All applicable related/downstream flows PASS
- [ ] Permission/store isolation reviewed when relevant
- [ ] Money/KPI/payroll boundaries reviewed when relevant
- [ ] Idempotency/race/timezone reviewed when relevant
- [ ] Migration/data-loss/Sites-VPS compatibility reviewed when relevant

## Speed / compute efficiency
- [ ] Exact symbols/files searched before broad scan
- [ ] Model selected once; no unnecessary model-hopping
- [ ] HIGH reasoning floor kept when runtime supports it
- [ ] Targeted tests used during iteration
- [ ] Related flows tested before final gate
- [ ] Final full gate run once after patch stabilized
- [ ] Failed CI/checks fixed targeted instead of blind full reruns
- [ ] Branch created from latest `main`; no repeated merge-from-main cycles

## Rollback / manual checks
- Rollback plan, if relevant:
- Manual checks, if relevant:
- Remaining risks, if any:

## Definition of Done
- [ ] User request auto-compiled; user không phải viết prompt kỹ thuật
- [ ] Visible Task Intake Report đã hiển thị nguyên nhân/nhu cầu + giải pháp + công việc + workload/scope
- [ ] Scope đúng yêu cầu và không thành mega-task
- [ ] Routing đúng policy
- [ ] Primary + applicable related-flow regressions PASS
- [ ] Tests/checks theo Risk PASS
- [ ] Required CI `verify` PASS
- [ ] Diff reviewed
- [ ] Production impact/rollback rõ khi cần
- [ ] Không commit secret hoặc tạo production source-of-truth sai