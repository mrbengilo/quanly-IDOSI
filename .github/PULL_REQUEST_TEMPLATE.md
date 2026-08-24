# Pull Request – IDOSI

> Quy trình: `docs/DEVELOPMENT_WORKFLOW.md`.

## Routing
- Risk Level: [ ] FAST  [ ] STANDARD  [ ] CRITICAL
- Effort: [ ] LOW  [ ] MEDIUM  [ ] HIGH
- Model routing: AUTO / RECOMMEND:
- Lý do:
- Expected scope:

Nếu Risk/Effort được nâng trong lúc làm, ghi lý do:
- 

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

## Impact Map
FAST có thể ghi scope ngắn nếu không có downstream business impact. STANDARD/CRITICAL:
`Yêu cầu → dữ liệu → domain → API/backend → state → UI → database → production target → tests → downstream`

## Business / permission / finance
- Business rule changed:
- Authorization/store impact:
- Finance/payroll/KPI impact:
- Canonical logic:

Nếu chạm finance/payroll/KPI/auth/store/database/persistence/core production runtime → CRITICAL.

## Database / production
- Schema/persistence change: Có / Không
- Migration:
- Backward compatibility:
- Target: Sites / VPS / Both / Runtime-unaffected
- Backup/rollback implication:

## Verification
FAST:
- [ ] Targeted checks phù hợp
- [ ] Lint/build nếu compile/style có thể bị ảnh hưởng
- [ ] Required CI `verify` PASS

STANDARD:
- [ ] `npm run lint`
- [ ] `npm test`
- [ ] `npm run build`
- [ ] `npm run sites:verify`
- [ ] VPS/runtime checks nếu liên quan
- [ ] Required CI `verify` PASS

CRITICAL:
- [ ] Toàn bộ STANDARD gate
- [ ] Targeted regression/security/data tests
- [ ] Wrong-role/store/duplicate/boundary cases khi phù hợp
- [ ] Migration/backup/rollback review khi liên quan
- [ ] Required CI `verify` PASS

## Self-review
- [ ] Unrelated changes
- [ ] Regression
- [ ] Duplicate logic
- [ ] API/state contract khi liên quan
- [ ] Permission/cross-store khi liên quan
- [ ] Money/KPI/payroll khi liên quan
- [ ] Idempotency/race/timezone khi liên quan
- [ ] Migration/data-loss/Sites-VPS khi liên quan

## Credit / compute efficiency
- [ ] Dùng mức Risk + Effort thấp nhất đủ an toàn.
- [ ] Không hard-code model name nếu runtime/model catalog có thể thay đổi.
- [ ] Không tuyên bố đã switch model nếu runtime không thực sự switch.
- [ ] Search targeted trước broad scan.
- [ ] Không rerun expensive checks khi code/input không đổi.
- [ ] Không hạ CRITICAL để tiết kiệm credit.
- [ ] Không giữ HIGH effort vô ích cho task đã chứng minh low-risk.

## Rollback / manual checks
- Rollback plan:
- Manual checks:
- Remaining risks:

## Definition of Done
- [ ] Risk + Effort hợp lý
- [ ] Scope đúng yêu cầu
- [ ] Tests/checks theo Risk PASS
- [ ] Required CI `verify` PASS
- [ ] Diff reviewed
- [ ] Production impact/rollback rõ khi cần
- [ ] Không commit secret hoặc tạo production source-of-truth sai