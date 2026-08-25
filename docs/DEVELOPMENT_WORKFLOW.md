# IDOSI Professional Development Workflow — Fast Delivery v2

Quy trình bắt buộc khi thêm, sửa, refactor hoặc hotfix IDOSI. Mục tiêu: **nhanh, đúng, ít vòng lặp, không tạo mega-task và không giảm safety ở phần nhạy cảm**.

## 1. Routing ngay khi nhận task

Codex phải xác định ngắn gọn:

```text
RISK: FAST | STANDARD | CRITICAL
MODEL: GPT-5.6 Terra | GPT-5.6 Sol | runtime fallback
REASONING: HIGH | XHIGH
SPEED: FAST | ULTRA FAST if supported
SCOPE: <module/file groups>
SENSITIVE: <none hoặc finance/payroll/auth/database/VPS/...>
VERIFY: <targeted checks + final gate>
```

### Quy tắc model bắt buộc

- **HIGH reasoning là mức tối thiểu** cho task lập trình IDOSI nếu runtime có control này.
- Task bình thường: ưu tiên **GPT-5.6 Terra + HIGH + FAST**.
- Task bình thường nhưng cross-layer/khó hơn: **GPT-5.6 Sol + HIGH + FAST**.
- Task liên quan tiền/tài chính hoặc độ khó cao: ưu tiên **GPT-5.6 Sol + HIGH + ULTRA FAST** nếu Codex runtime có Ultra Fast; nếu không có thì dùng FAST hoặc chế độ nhanh nhất khả dụng.
- Dùng Sol cho revenue/expense/profit/payroll/salary/KPI/bonus/allowance/advance/order-money, auth/store isolation khó, schema/migration/persistence, destructive data, concurrency/idempotency, VPS/runtime/storage và core business rule khó.
- Chỉ nâng lên XHIGH khi HIGH thực sự chưa đủ. Không dùng XHIGH chỉ vì task nhiều file cơ học.
- Chọn model một lần ở đầu task; chỉ switch tối đa một lần nếu phát hiện complexity/risk mới.
- Nếu runtime không cho tự chọn model/reasoning/speed, ghi recommendation một lần và tiếp tục bằng model tốt nhất đang có. Không đứng chờ và không giả vờ đã switch.

## 2. Risk level

### FAST

Text, label, typo, màu, spacing, icon, typography, layout nhỏ, docs hoặc presentation-only; không đổi business rule, mutation, persistence, auth, money formula, attendance calculation hay runtime.

Luồng:
`REQUEST -> CLASSIFY -> TARGETED READ -> BRANCH -> MINIMAL PATCH -> TARGETED CHECK -> PR -> CI -> MERGE`

Không scan toàn repo.

### STANDARD

CRUD/form/validation/report/API/state/UI flow thông thường không thay canonical finance/payroll/auth/schema/persistence/core production behavior.

Luồng:
`REQUEST -> CLASSIFY -> TARGETED IMPACT -> BRANCH -> TARGETED TEST -> IMPLEMENT -> TARGETED RECHECK -> FINAL LOCAL GATE -> PR -> CI -> MERGE`

### CRITICAL

Khi thay đổi trực tiếp:

- doanh thu/chi phí/lợi nhuận/lương/KPI/thưởng/phụ cấp/ứng lương hoặc money mutation
- order mutation ảnh hưởng tiền/audit
- chấm công/giờ làm feed payroll/KPI
- auth/role/store isolation/session
- schema/migration/persistence/data repair
- idempotency/concurrency/race nhạy cảm
- VPS/runtime/storage/deployment
- core business rule có downstream impact lớn

Luồng:
`REQUEST -> CLASSIFY -> FOCUSED DEEP IMPACT -> TARGETED REGRESSION -> MINIMAL FIX -> SECURITY/DATA REVIEW -> ONE FULL FINAL GATE -> PR -> CI -> MERGE -> SAFEGUARDS`

CRITICAL không đồng nghĩa scan cả repo.

## 3. Hard Scope Gate

Mục tiêu là chặn task chạy từ sáng đến tối vì phạm vi phình quá lớn.

- Search symbol/file/module cụ thể trước broad scan.
- Một PR mặc định = một mục tiêu nghiệp vụ coherent.
- Nếu user gửi hơn 3 mục tiêu độc lập hoặc dự kiến >20 source/test files, Codex tự chia thành các sub-scope/PR nhỏ và xử lý tuần tự.
- Nếu diff bất ngờ vượt 25 changed files, không tiếp tục mở rộng vô hạn; tách phần độc lập còn lại.
- Migration/generated metadata bắt buộc có thể không tính vào cap.
- Không gom UI redesign + database + VPS + settings + feature khác vào một PR chỉ vì cùng nằm trong một prompt.
- Không hỏi lại requirement đã biết. Chỉ dừng khi có business ambiguity thật sự có thể làm sai tiền/quyền/dữ liệu.

## 4. Quy trình thực thi nhanh

1. Lấy latest `main`, tạo branch mới cho task.
2. Classify Risk + Model + Reasoning + Speed.
3. Targeted search/read đúng module liên quan.
4. Tìm canonical logic trước khi tạo logic mới.
5. Lập impact map vừa đủ cho risk hiện tại.
6. Chạy targeted regression/test cần thiết.
7. Implement minimal patch.
8. Trong vòng sửa chỉ rerun targeted test/check bị ảnh hưởng.
9. Khi patch ổn định mới chạy final local gate một lần.
10. Mở PR ngay sau final local gate; GitHub `verify` là repository-wide gate chính thức.
11. Nếu CI fail: đọc failing step -> reproduce targeted -> fix -> rerun phần bị invalidated. Không blind-rerun toàn bộ local suite.
12. Merge khi required CI pass và rules cho phép.

Không lặp lại toàn bộ analysis/test nếu code/input không thay đổi đáng kể.

## 5. Implementation order

Khi phù hợp:
`targeted regression/domain -> backend/API -> state -> UI -> migration`

Không duplicate business formula. Không dùng `localStorage` làm production source of truth. Không hard-code dữ liệu khi đã có nguồn thật.

## 6. Test policy

### Trong lúc implement

- Ưu tiên test file/suite trực tiếp liên quan.
- Có thể lint file/module liên quan thay vì full lint mỗi vòng.
- Không chạy `npm test` sau mỗi edit.
- Không rerun check đắt tiền nếu phần code ảnh hưởng đến check đó không đổi.

### FAST final local gate

Chỉ targeted checks hợp lý; lint/build khi thay đổi có thể ảnh hưởng compile/style. Docs-only không cần full local suite. Required GitHub `verify` vẫn phải PASS.

### STANDARD final local gate

Mặc định:

```bash
npm run lint
npm run build
npm run sites:verify
```

Kèm targeted tests cho logic đã sửa.

Chỉ chạy local full `npm test` nếu shared/cross-cutting logic thay đổi hoặc targeted coverage không đủ. GitHub `verify` sẽ chạy full suite.

### CRITICAL final local gate

Chạy một lần sau khi patch ổn định:

```bash
npm run lint
npm test
npm run build
npm run sites:verify
```

Thêm targeted regression/security/data/VPS/persistence checks đúng phạm vi. Không chạy VPS tests nếu VPS không bị ảnh hưởng.

Nếu gate fail: root cause -> targeted fix -> targeted rerun -> chỉ chạy lại final gate bị invalidated.

## 7. Finance / Payroll / KPI / Attendance

Đây là vùng ưu tiên GPT-5.6 Sol.

Khi sửa canonical money/payroll/KPI logic:

1. Tìm canonical implementation.
2. Xác định inputs/outputs/persistence/downstream đúng phạm vi.
3. Thêm/update targeted regression test.
4. Không duplicate formula.
5. Không tự đoán công thức mơ hồ.
6. Giữ VND representation/rounding hiện hữu.

Edge cases chỉ test khi relevant: zero/negative/null, zero-hours, bonus/allowance/advance, locked period, duplicate/retry, wrong role/store, month/time boundary.

Attendance feed payroll/KPI phải test schedule/date/timezone/overnight/missing checkout khi path thay đổi có liên quan.

## 8. Auth / Store isolation / Persistence

- Backend/data boundary mới là nơi enforce quyền; UI check không đủ.
- `store_manager` không được vượt assigned store nếu không có requirement rõ.
- Employee không được truy cập protected data của người khác qua request manipulation.
- Schema/persistence change phải additive/safe, preserve existing rows và có rollback/backup implication.
- Không reset/truncate production để làm test/deploy cho tiện.

## 9. Branch & conflict control

- Không feature trực tiếp trên `main`.
- Mỗi task tạo branch mới từ latest `main`.
- Không reuse stale completed branch.
- Không merge `main` vào branch lặp đi lặp lại.
- Nếu `main` thay đổi trong lúc làm, chỉ sync trước PR khi file/dependency overlap hoặc GitHub yêu cầu update branch.
- Resolve conflict narrowly, không kéo unrelated change vào task.

## 10. PR gate

PR phải ngắn và evidence-based:

- routing đã chọn
- mục tiêu/root cause
- scope chính
- business/auth/database/production impact khi relevant
- targeted tests + final local gate
- required CI `verify`
- rollback chỉ khi cần

Không biến PR description thành một báo cáo dài làm chậm delivery.

## 11. Production

Chỉ deploy code đã merge `main`. Không sửa source trực tiếp VPS. Khi VPS/runtime/storage thực sự bị ảnh hưởng mới áp dụng backup/health/smoke/rollback theo `deploy/vps/README.md` và `docs/VPS_DEPLOYMENT_CHECKLIST.md`.

## 12. Definition of Done

- đúng requirement và scope
- routing model/reasoning/speed trung thực
- HIGH reasoning floor được giữ khi runtime hỗ trợ
- mega-task đã split nếu vượt scope gate
- canonical logic/source-of-truth preserved
- auth/store isolation preserved
- targeted checks PASS
- final local gate theo Risk PASS
- GitHub `verify` PASS
- diff reviewed, không unrelated refactor
- migration/production safeguards có khi relevant

Nguyên tắc cuối: **IDOSI ưu tiên tốc độ bằng GPT-5.6 Terra/Sol ở HIGH reasoning với FAST/ULTRA FAST, scope nhỏ, targeted search/test và loại bỏ vòng lặp thừa; không ưu tiên tốc độ bằng cách bỏ kiểm tra correctness ở tiền, quyền hoặc dữ liệu.**