# IDOSI Professional Development Workflow

Quy trình bắt buộc khi thêm, sửa, refactor hoặc hotfix IDOSI. Mục tiêu là đúng, nhanh, ít credit và không gây regression.

## 1. Hai tầng routing tự động

Ngay khi nhận yêu cầu, Codex phải phân loại:

```text
RISK LEVEL: FAST | STANDARD | CRITICAL
EFFORT: LOW | MEDIUM | HIGH
MODEL ROUTING: AUTO / RECOMMEND <capability class>
Reason: <1-3 lý do>
Expected scope: <module/file groups>
Sensitive areas: <none hoặc finance/payroll/auth/database/VPS/...>
Verification plan: <checks>
```

Risk quyết định mức an toàn/kiểm thử. Effort quyết định độ sâu reasoning/compute. Hai thứ không được đánh đồng.

### FAST + LOW mặc định

Dành cho text, label, typo, màu, spacing, icon, typography, layout nhỏ, docs và thay đổi presentation-only.

`REQUEST -> CLASSIFY -> TARGETED READ -> BRANCH -> MINIMAL PATCH -> TARGETED CHECK -> PR -> CI -> MERGE`

Không scan toàn repo. Không dùng reasoning/model mạnh nếu không có bằng chứng cần thiết.

### STANDARD + MEDIUM mặc định

Dành cho CRUD/form/validation/report/API/state/UI flow thông thường không chạm nhóm nhạy cảm.

`REQUEST -> CLASSIFY -> IMPACT MAP -> BRANCH -> TEST -> IMPLEMENT -> REVIEW -> FULL VERIFY -> PR -> CI -> MERGE`

### CRITICAL + HIGH mặc định

Bắt buộc khi chạm finance/revenue/expense/profit/KPI/payroll/salary/bonus/allowance/advance; order mutation ảnh hưởng tiền/audit; attendance feed payroll/KPI; auth/role/store isolation; session/credentials; database/schema/migration/persistence; destructive data; concurrency/idempotency nhạy cảm; production VPS runtime/storage/deployment; core business rules.

`REQUEST -> CLASSIFY -> DEEP IMPACT -> REGRESSION TEST -> MINIMAL FIX -> SECURITY/DATA REVIEW -> FULL VERIFY -> PR -> CI/REVIEW -> MERGE -> PRODUCTION SAFEGUARDS`

## 2. Model routing

Không hard-code tên model vì model khả dụng và giá/khả năng có thể thay đổi.

- Nếu Codex runtime hỗ trợ auto model routing: chọn model nhanh/rẻ nhất đủ năng lực cho Risk + Effort hiện tại.
- Nếu runtime không cho agent tự đổi model: Codex ghi recommendation và tiếp tục với model hiện tại; không giả vờ đã switch.
- FAST/LOW: ưu tiên fast coding/editing capability.
- STANDARD/MEDIUM: ưu tiên balanced coding capability.
- CRITICAL/HIGH: ưu tiên strongest appropriate coding/reasoning capability.

Có thể nâng Effort hoặc Risk khi phát hiện dependency/rủi ro mới. Không được hạ confirmed CRITICAL chỉ để tiết kiệm credit. Ngược lại, không giữ HIGH effort cho task nhỏ đã chứng minh là low-risk.

## 3. Credit efficiency

- search symbol/file/module trước broad scan
- reuse analysis trong cùng task
- targeted test trong vòng sửa, full gate ở cuối theo Risk
- không chạy lại test/analysis đắt tiền nếu code/input không đổi
- patch nhỏ thay vì rewrite file lớn
- không đọc finance/auth/database/VPS cho FAST UI task nếu không có dependency
- chia task rộng thành PR nhỏ
- báo cáo ngắn, evidence-based
- dùng lowest sufficient model/effort khi runtime hỗ trợ

## 4. Branch & scope

Không sửa trực tiếp `main`. Mỗi task dùng branch `feature/`, `fix/`, `refactor/`, `ui/`, `hotfix/` hoặc `chore/`. Một PR = một mục tiêu nghiệp vụ. Scope lan rộng bất thường phải được phát hiện và báo trước.

## 5. Implementation order

Khi phù hợp:
`tests/domain -> backend/API -> state -> UI -> migration`

Không duplicate business formula. Không dùng `localStorage` làm production source of truth. Không hard-code dữ liệu đã có nguồn thật.

## 6. Test policy

Bugfix có regression test khi khả thi. Finance/KPI/payroll/attendance/auth/store isolation/persistence phải test trước hoặc cùng implementation. Edge cases tùy phạm vi: positive/zero/negative/null, duplicate/retry, wrong store/role, locked/deleted records, timezone/day/month boundary.

FAST presentation-only không tạo test vô nghĩa.

## 7. Verification

FAST: targeted checks phù hợp + required GitHub CI `verify`.

STANDARD:
```bash
npm run lint
npm test
npm run build
npm run sites:verify
```

CRITICAL: toàn bộ STANDARD + targeted regression/security/data tests + VPS/runtime checks nếu liên quan.

Không merge khi required check fail.

## 8. Self-review

FAST: unrelated changes, UI/build/lint regression.

STANDARD: thêm duplicate logic, flow regression, API/state contract.

CRITICAL: thêm permission bypass, cross-store leak, money/KPI/payroll mismatch, idempotency/race, timezone, migration/data loss, audit, Sites/VPS incompatibility.

Critical/High findings phải xử lý trước merge.

## 9. Pull Request gate

PR ghi Risk Level, Effort, routing reason, root cause, Impact Map phù hợp, business/auth/database/production impact, tests, verification và rollback khi cần. Required check `verify` phải PASS. Ruleset `main` không được bypass để tiết kiệm thời gian.

## 10. Production

Chỉ deploy code đã merge `main`. Không sửa source trực tiếp trên VPS. Production-sensitive task là CRITICAL/HIGH và tuân thủ backup/health/smoke/rollback theo tài liệu VPS.

## 11. Definition of Done

- Risk + Effort hợp lý
- model routing/recommendation trung thực với runtime
- đúng scope/business rule
- tests/verification tương ứng PASS
- không duplicate logic hoặc phá quyền/store isolation
- migration/production safeguards có khi cần
- diff reviewed
- PR + CI gate hoàn tất

Nguyên tắc cuối: **dùng mức compute thấp nhất đủ làm đúng việc; tăng compute khi bằng chứng yêu cầu, không giảm safety để tiết kiệm credit.**