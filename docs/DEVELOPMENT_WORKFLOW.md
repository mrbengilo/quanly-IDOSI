# IDOSI Professional Development Workflow — Fast Delivery v3

Mục tiêu: **user chỉ nói yêu cầu công việc; Codex tự biến yêu cầu đó thành execution prompt nội bộ, tự route model, tự xác định scope và test, rồi triển khai nhanh nhất có thể mà không bỏ sót regression ở các luồng liên quan.**

## 1. User Request -> Automatic Execution Prompt

Ngay khi nhận task, Codex tự compile thành:

```text
GOAL: kết quả user cần
ACCEPTANCE: điều kiện nghiệm thu có thể quan sát
RISK: FAST | STANDARD | CRITICAL
MODEL: GPT-5.6 Terra | GPT-5.6 Sol | runtime fallback
REASONING: HIGH | XHIGH
SPEED: FAST | ULTRA FAST if supported
SCOPE: module/file dự kiến
CANONICAL SOURCE: logic/data source hiện hữu phải reuse
AFFECTED FLOWS: luồng chính + downstream/adjacent
INVARIANTS: business/data/auth behavior không được phá
TEST MATRIX: targeted + related-flow regression + final gate
DELIVERY: branch -> patch -> PR -> CI -> merge
```

Quy tắc:

- User **không cần** viết prompt kỹ thuật, tên file, kế hoạch test hay command Codex.
- Codex phải tự đọc repo để tìm implementation hiện hữu thay vì hỏi user các chi tiết kỹ thuật có thể tự xác định.
- Requirement đã biết từ task/current product rules phải được dùng trực tiếp, không bắt user lặp lại.
- Low-risk ambiguity: theo convention hiện hữu và làm tiếp.
- Chỉ surface ambiguity khi lựa chọn sai có thể thay đổi tiền/KPI/payroll, quyền truy cập, destructive behavior, schema/data migration hoặc production deployment semantics.
- Không dành thời gian dài chỉ để viết plan; execution prompt là checklist kiểm soát ngắn rồi triển khai ngay.

## 2. Model routing

- **HIGH reasoning là mức tối thiểu** cho task lập trình IDOSI nếu runtime hỗ trợ.
- Task bình thường: **GPT-5.6 Terra + HIGH + FAST**.
- Task cross-layer/khó hơn: **GPT-5.6 Sol + HIGH + FAST**.
- Tiền/tài chính hoặc task khó: **GPT-5.6 Sol + HIGH + ULTRA FAST** nếu runtime có Ultra Fast; nếu không thì FAST/chế độ nhanh nhất khả dụng.
- Sol ưu tiên cho revenue/expense/profit/payroll/salary/KPI/bonus/allowance/advance/order-money, auth/store isolation khó, schema/migration/persistence, destructive data, concurrency/idempotency, VPS/runtime/storage và core business rule khó.
- Chỉ dùng XHIGH khi HIGH thực sự chưa đủ.
- Chọn model một lần đầu task; switch tối đa một lần khi complexity/risk thay đổi đáng kể.
- Nếu runtime không cho chọn model/reasoning/speed: ghi recommendation một lần và tiếp tục bằng runtime tốt nhất đang có, không block task.

## 3. Risk level

### FAST

Text/label/typography/layout/docs hoặc presentation-only; không đổi business rule, mutation, persistence, auth, money formula, attendance calculation hay runtime.

`REQUEST -> AUTO COMPILE -> TARGETED READ -> BRANCH -> MINIMAL PATCH -> TARGETED CHECK -> PR -> CI -> MERGE`

### STANDARD

CRUD/form/validation/report/API/state/UI flow thông thường, không thay canonical finance/payroll/auth/schema/persistence/core production behavior.

`REQUEST -> AUTO COMPILE -> TARGETED IMPACT -> TARGETED TEST -> PATCH -> RELATED-FLOW REGRESSION -> FINAL GATE -> PR -> CI -> MERGE`

### CRITICAL

Khi thay đổi trực tiếp finance/money, payroll/KPI, attendance feed payroll, order-money/audit, auth/store/session, schema/migration/persistence, destructive data, sensitive concurrency/idempotency, VPS/runtime/storage/deployment hoặc core business rule có downstream impact lớn.

`REQUEST -> AUTO COMPILE -> FOCUSED DEEP IMPACT -> REGRESSION MATRIX -> MINIMAL PATCH -> SECURITY/DATA REVIEW -> RELATED-FLOW REGRESSION -> ONE FULL FINAL GATE -> PR -> CI -> MERGE -> SAFEGUARDS`

CRITICAL không đồng nghĩa scan toàn repo.

## 4. Hard Scope Gate

- Search exact symbol/file/module trước broad scan.
- Một PR mặc định = một mục tiêu nghiệp vụ coherent.
- Nếu task có >3 mục tiêu độc lập hoặc dự kiến >20 source/test files: Codex tự split thành sub-scope/PR nhỏ và xử lý tuần tự.
- Nếu diff bất ngờ >25 changed files: dừng mở rộng, tách phần độc lập còn lại.
- Generated migration/metadata bắt buộc có thể không tính vào cap.
- Không gom unrelated UI + database + VPS + settings + feature khác vào một PR chỉ vì cùng nằm trong một message.
- Không hỏi lại requirement đã biết.

## 5. Related-Flow Map — bắt buộc trước khi sửa logic

Codex phải xác định các luồng có thể bị ảnh hưởng theo dependency chain vừa đủ:

`input/event -> UI -> state -> domain -> API/backend -> persistence -> readers/reports -> finance/payroll/audit/auth/runtime downstream`

Ví dụ một thay đổi không chỉ test màn hình chính mà phải kiểm tra các consumer thực sự phụ thuộc vào field/function/entity đó.

Không broad-test module không liên quan. Mục tiêu là **đủ dependency coverage**, không phải chạy mọi thứ ở mọi vòng.

## 6. Related-Flow Regression Matrix

Mỗi functional change phải chọn và test tất cả category áp dụng:

- happy path chính
- behavior cũ/backward compatibility phải giữ
- create/update/delete/read neighbor cùng entity/contract
- UI/state/domain/API consumers của field/function đã đổi
- role/store/user isolation + denied path
- duplicate/retry/idempotency cho mutation
- persistence/reload/data-shape compatibility
- downstream revenue/expense/profit/payroll/KPI nếu input có feed tiền
- attendance/timezone/day/month/overnight nếu có thời gian
- locked/closed/deleted lifecycle states
- Sites/VPS compatibility nếu shared backend/persistence/runtime thay đổi
- desktop/mobile/responsive nếu UI interaction/layout thay đổi

Task chưa hoàn tất nếu luồng chính pass nhưng một affected related flow fail.

## 7. Quy trình thực thi nhanh

1. Latest `main` -> branch mới.
2. Auto-compile request thành execution prompt.
3. Route Risk + Model + Reasoning + Speed.
4. Targeted search/read module liên quan.
5. Find canonical logic/source of truth.
6. Build Related-Flow Map.
7. Targeted tests/regression trước hoặc trong khi sửa khi hữu ích.
8. Implement minimal patch.
9. Trong vòng sửa chỉ rerun test/check bị invalidated.
10. Chạy Related-Flow Regression Matrix.
11. Khi patch ổn định mới chạy final local gate một lần.
12. Open PR ngay; GitHub `verify` là repository-wide gate chính thức.
13. CI fail -> đọc failing step -> reproduce targeted -> fix -> rerun phần bị invalidated.
14. Merge khi required CI pass.

Không lặp analysis/model-selection/full-test nếu code/input không thay đổi đáng kể.

## 8. Test policy

### Iteration

- Targeted tests cho changed path + related flows.
- Targeted lint khi practical.
- Không `npm test` sau mỗi edit.
- Không rerun expensive check khi code ảnh hưởng check đó không đổi.

### FAST final local gate

Targeted checks hợp lý; lint/build nếu relevant. Docs-only không cần full local suite. Required GitHub `verify` vẫn phải PASS.

### STANDARD final local gate

```bash
npm run lint
npm run build
npm run sites:verify
```

Kèm targeted tests + related-flow regressions. Chạy local full `npm test` khi shared/cross-cutting logic thay đổi hoặc targeted coverage không đủ.

### CRITICAL final local gate

Chạy một lần khi patch ổn định:

```bash
npm run lint
npm test
npm run build
npm run sites:verify
```

Kèm targeted regression/security/data/VPS/persistence checks theo Related-Flow Matrix.

Nếu gate fail: root cause -> targeted fix -> targeted rerun -> chỉ rerun final gate bị invalidated.

## 9. Finance / Payroll / KPI / Attendance

Đây là vùng ưu tiên GPT-5.6 Sol.

Khi sửa money/payroll/KPI canonical logic:

1. Tìm implementation canonical.
2. Xác định relevant inputs/outputs/persistence/downstream consumers.
3. Add/update targeted regression tests.
4. Test downstream money-related flows bị feed bởi input đó.
5. Không duplicate formula, không tự đoán công thức mơ hồ.
6. Giữ VND representation/rounding hiện hữu.

Relevant edge cases: zero/negative/null, zero-hours, bonus/allowance/advance, locked period, duplicate/retry, wrong role/store, month/time boundary.

Attendance feed payroll/KPI phải test schedule/date/timezone/overnight/missing checkout khi path thay đổi có liên quan.

## 10. Auth / Store isolation / Persistence / Production

- Enforce quyền tại backend/data boundary, không chỉ UI.
- `store_manager` không vượt assigned store nếu requirement không đổi.
- Employee không truy cập protected data người khác qua request manipulation.
- Schema/persistence change phải safe/additive khi phù hợp, preserve existing rows và có rollback/backup implication.
- Không reset/truncate production để tiện test/deploy.
- Chỉ validate production target thực sự bị ảnh hưởng.
- VPS change theo `deploy/vps/README.md` và `docs/VPS_DEPLOYMENT_CHECKLIST.md`.
- Không sửa source trực tiếp trên VPS.

## 11. Git / conflict control

- Không feature trực tiếp `main`.
- Mỗi task branch mới từ latest `main`.
- Không reuse stale completed branch.
- Không merge/rebase `main` lặp đi lặp lại.
- Sync trước PR chỉ khi overlap hoặc GitHub yêu cầu.
- Resolve conflict narrowly.
- Required GitHub `verify` phải PASS trước merge.

## 12. PR gate

PR phải ghi ngắn gọn:

- execution goal/acceptance
- routing
- scope
- affected/related flows
- tests trong Regression Matrix
- final local gate
- required CI `verify`
- rollback nếu relevant

## 13. Definition of Done

- user không phải tự viết prompt kỹ thuật
- request đã auto-compile thành execution brief
- đúng requirement/scope
- model/reasoning/speed route đúng policy
- canonical logic/source-of-truth preserved
- Related-Flow Map đầy đủ cho functional change
- primary + applicable downstream/adjacent regressions PASS
- auth/store isolation preserved
- final local gate theo Risk PASS
- GitHub `verify` PASS
- diff không unrelated refactor
- migration/production safeguards có khi relevant

Nguyên tắc cuối: **user nói yêu cầu nghiệp vụ, Codex tự hiểu thành prompt triển khai và làm ngay. Tốc độ được tối ưu mạnh, nhưng mọi luồng thực sự bị ảnh hưởng bởi thay đổi phải được test kỹ trước khi chốt task.**