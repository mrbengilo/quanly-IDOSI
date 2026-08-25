# IDOSI Professional Development Workflow — Fast Delivery v4

Mục tiêu: **user chỉ nói yêu cầu công việc; Codex tự biến yêu cầu đó thành execution prompt nội bộ, hiển thị nguyên nhân/nhu cầu + giải pháp + các việc sẽ làm + mức độ/phạm vi dự kiến, rồi triển khai nhanh nhất có thể mà không bỏ sót regression ở các luồng liên quan.**

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

## 2. Visible Task Intake Report — bắt buộc hiển thị trước khi làm

Sau khi auto-compile request, Codex phải hiển thị ngắn gọn:

```text
NGUYÊN NHÂN / NHU CẦU:
- <root cause đã xác định, hoặc nhu cầu nghiệp vụ/kỹ thuật>

GIẢI PHÁP:
- <cách xử lý dự kiến>

CÔNG VIỆC SẼ THỰC HIỆN:
1. <bước 1>
2. <bước 2>
3. <test luồng liên quan / delivery khi relevant>

MỨC ĐỘ & PHẠM VI DỰ KIẾN:
- Risk: FAST | STANDARD | CRITICAL
- Workload: SMALL | MEDIUM | LARGE | CRITICAL
- Scope: <module/flow groups chính>
- Verification: <targeted / related-flow / final gate>
```

Quy tắc:

- Bug: nêu root cause nếu đã có bằng chứng. Nếu chưa xác định, ghi rõ `Nguyên nhân cần xác minh trong code`, không được đoán.
- Feature/change: dùng `NHU CẦU` hoặc lý do nghiệp vụ thay cho việc bịa nguyên nhân lỗi.
- Giải pháp phải cụ thể theo architecture/source of truth hiện hữu.
- Danh sách công việc phải actionable và đúng scope; functional change phải có related-flow tests.
- Không hứa ETA chính xác theo phút/giờ hoặc thời điểm giao trong tương lai. Dùng `Workload + Scope + số bước` làm dự báo khối lượng, sau đó thực hiện ngay trong task hiện tại.
- Không hỏi user xác nhận lại báo cáo này trừ khi có ambiguity thật sự có thể làm sai tiền/quyền/dữ liệu/deploy.
- Chỉ cập nhật lại báo cáo khi root cause, giải pháp, Risk hoặc scope thay đổi đáng kể.

## 3. Model routing

- **HIGH reasoning là mức tối thiểu** cho task lập trình IDOSI nếu runtime hỗ trợ.
- Task bình thường: **GPT-5.6 Terra + HIGH + FAST**.
- Task cross-layer/khó hơn: **GPT-5.6 Sol + HIGH + FAST**.
- Tiền/tài chính hoặc task khó: **GPT-5.6 Sol + HIGH + ULTRA FAST** nếu runtime có Ultra Fast; nếu không thì FAST/chế độ nhanh nhất khả dụng.
- Sol ưu tiên cho revenue/expense/profit/payroll/salary/KPI/bonus/allowance/advance/order-money, auth/store isolation khó, schema/migration/persistence, destructive data, concurrency/idempotency, VPS/runtime/storage và core business rule khó.
- Chỉ dùng XHIGH khi HIGH thực sự chưa đủ.
- Chọn model một lần đầu task; switch tối đa một lần khi complexity/risk thay đổi đáng kể.
- Nếu runtime không cho chọn model/reasoning/speed: ghi recommendation một lần và tiếp tục bằng runtime tốt nhất đang có, không block task.

## 4. Risk level

### FAST

Text/label/typography/layout/docs hoặc presentation-only; không đổi business rule, mutation, persistence, auth, money formula, attendance calculation hay runtime.

`REQUEST -> AUTO COMPILE -> INTAKE REPORT -> TARGETED READ -> BRANCH -> MINIMAL PATCH -> TARGETED CHECK -> PR -> CI -> MERGE`

### STANDARD

CRUD/form/validation/report/API/state/UI flow thông thường, không thay canonical finance/payroll/auth/schema/persistence/core production behavior.

`REQUEST -> AUTO COMPILE -> INTAKE REPORT -> TARGETED IMPACT -> TARGETED TEST -> PATCH -> RELATED-FLOW REGRESSION -> FINAL GATE -> PR -> CI -> MERGE`

### CRITICAL

Khi thay đổi trực tiếp finance/money, payroll/KPI, attendance feed payroll, order-money/audit, auth/store/session, schema/migration/persistence, destructive data, sensitive concurrency/idempotency, VPS/runtime/storage/deployment hoặc core business rule có downstream impact lớn.

`REQUEST -> AUTO COMPILE -> INTAKE REPORT -> FOCUSED DEEP IMPACT -> REGRESSION MATRIX -> MINIMAL PATCH -> SECURITY/DATA REVIEW -> RELATED-FLOW REGRESSION -> ONE FULL FINAL GATE -> PR -> CI -> MERGE -> SAFEGUARDS`

CRITICAL không đồng nghĩa scan toàn repo.

## 5. Hard Scope Gate

- Search exact symbol/file/module trước broad scan.
- Một PR mặc định = một mục tiêu nghiệp vụ coherent.
- Nếu task có >3 mục tiêu độc lập hoặc dự kiến >20 source/test files: Codex tự split thành sub-scope/PR nhỏ và xử lý tuần tự.
- Nếu diff bất ngờ >25 changed files: dừng mở rộng, tách phần độc lập còn lại.
- Generated migration/metadata bắt buộc có thể không tính vào cap.
- Không gom unrelated UI + database + VPS + settings + feature khác vào một PR chỉ vì cùng nằm trong một message.
- Không hỏi lại requirement đã biết.

## 6. Related-Flow Map — bắt buộc trước khi sửa logic

Codex phải xác định các luồng có thể bị ảnh hưởng theo dependency chain vừa đủ:

`input/event -> UI -> state -> domain -> API/backend -> persistence -> readers/reports -> finance/payroll/audit/auth/runtime downstream`

Ví dụ một thay đổi không chỉ test màn hình chính mà phải kiểm tra các consumer thực sự phụ thuộc vào field/function/entity đó.

Không broad-test module không liên quan. Mục tiêu là **đủ dependency coverage**, không phải chạy mọi thứ ở mọi vòng.

## 7. Related-Flow Regression Matrix

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

## 8. Quy trình thực thi nhanh

1. Latest `main` -> branch mới.
2. Auto-compile request thành execution prompt.
3. Hiển thị Visible Task Intake Report.
4. Route Risk + Model + Reasoning + Speed.
5. Targeted search/read module liên quan.
6. Find canonical logic/source of truth.
7. Build Related-Flow Map.
8. Targeted tests/regression trước hoặc trong khi sửa khi hữu ích.
9. Implement minimal patch.
10. Trong vòng sửa chỉ rerun test/check bị invalidated.
11. Chạy Related-Flow Regression Matrix.
12. Khi patch ổn định mới chạy final local gate một lần.
13. Open PR ngay; GitHub `verify` là repository-wide gate chính thức.
14. CI fail -> đọc failing step -> reproduce targeted -> fix -> rerun phần bị invalidated.
15. Merge khi required CI pass.

Không lặp intake report/analysis/model-selection/full-test nếu code/input không thay đổi đáng kể.

## 9. Test policy

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

## 10. Finance / Payroll / KPI / Attendance

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

## 11. Auth / Store isolation / Persistence / Production

- Enforce quyền tại backend/data boundary, không chỉ UI.
- `store_manager` không vượt assigned store nếu requirement không đổi.
- Employee không truy cập protected data người khác qua request manipulation.
- Schema/persistence change phải safe/additive khi phù hợp, preserve existing rows và có rollback/backup implication.
- Không reset/truncate production để tiện test/deploy.
- Chỉ validate production target thực sự bị ảnh hưởng.
- VPS change theo `deploy/vps/README.md` và `docs/VPS_DEPLOYMENT_CHECKLIST.md`.
- Không sửa source trực tiếp trên VPS.

## 12. Git / conflict control

- Không feature trực tiếp `main`.
- Mỗi task branch mới từ latest `main`.
- Không reuse stale completed branch.
- Không merge/rebase `main` lặp đi lặp lại.
- Sync trước PR chỉ khi overlap hoặc GitHub yêu cầu.
- Resolve conflict narrowly.
- Required GitHub `verify` phải PASS trước merge.

## 13. PR gate

PR phải ghi ngắn gọn:

- nguyên nhân/nhu cầu đã xác định
- giải pháp đã chọn
- execution goal/acceptance
- routing
- các công việc chính đã thực hiện
- scope
- affected/related flows
- tests trong Regression Matrix
- final local gate
- required CI `verify`
- rollback nếu relevant

## 14. Definition of Done

- user không phải tự viết prompt kỹ thuật
- request đã auto-compile thành execution brief
- Visible Task Intake Report đã được hiển thị trước implementation
- nguyên nhân/nhu cầu và giải pháp không bị bịa/đoán sai
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

Nguyên tắc cuối: **user nói yêu cầu nghiệp vụ, Codex tự hiểu thành prompt triển khai, hiển thị nguyên nhân/giải pháp/công việc/mức độ-phạm vi ngắn gọn rồi làm ngay. Tốc độ được tối ưu mạnh, nhưng mọi luồng thực sự bị ảnh hưởng bởi thay đổi phải được test kỹ trước khi chốt task.**