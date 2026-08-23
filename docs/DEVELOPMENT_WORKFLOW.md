# IDOSI Professional Development Workflow

Tài liệu này là quy trình bắt buộc khi thêm, sửa, refactor hoặc hotfix chức năng IDOSI.

## 1. Mục tiêu

Mỗi thay đổi phải nhỏ, có thể review, có test, có rollback và không làm phát sinh thay đổi ngoài phạm vi. Không sửa trực tiếp `main`.

Để tiết kiệm thời gian và Codex credit, mọi yêu cầu phải được phân loại rủi ro trước khi phân tích sâu hoặc code. Mức kiểm tra phải tương xứng với rủi ro, không dùng quy trình CRITICAL cho thay đổi nhỏ nếu không có tín hiệu rủi ro.

## 2. Risk routing bắt buộc

Ngay khi nhận yêu cầu, Codex phải xuất ngắn gọn:

```text
RISK LEVEL: FAST | STANDARD | CRITICAL
Reason: <1-3 lý do>
Expected scope: <module/file groups>
Sensitive areas: finance/payroll/auth/database/VPS/etc hoặc none
Verification plan: <mức kiểm tra sẽ chạy>
```

Codex tự chọn mức theo tiêu chí sau.

### FAST — rủi ro thấp

Dùng khi thay đổi chỉ mang tính trình bày hoặc tài liệu, không thay đổi business rule/data contract/runtime.

Ví dụ:
- text/label/typo
- màu, spacing, icon, typography
- UI layout nhỏ
- tài liệu
- test snapshot/documentation-only

FAST không được dùng nếu task đụng business logic, mutation API, auth, tiền, database, persistence, chấm công hoặc deploy runtime.

Luồng FAST:

`REQUEST -> RISK CLASSIFY -> TARGETED ANALYSIS -> BRANCH -> MINIMAL CHANGE -> TARGETED CHECK -> PR -> CI -> MERGE`

Tối thiểu:
- đọc đúng component/file liên quan
- không scan sâu module không liên quan
- targeted test nếu có
- lint/build phù hợp
- PR + required CI vẫn bắt buộc

### STANDARD — rủi ro trung bình

Dùng cho chức năng thông thường có logic hoặc flow mới nhưng không trực tiếp thay đổi tiền/quyền/schema/persistence nhạy cảm.

Ví dụ:
- form CRUD thông thường
- báo cáo/read-only view
- API/service không nhạy cảm
- state/UI flow mới
- validation thông thường

Luồng STANDARD:

`REQUEST -> RISK CLASSIFY -> ANALYZE -> IMPACT MAP -> BRANCH -> TEST -> IMPLEMENT -> SELF REVIEW -> FULL VERIFY -> PR -> CI -> MERGE`

Tối thiểu:
- Impact Map vừa đủ
- test logic/flow bị ảnh hưởng
- review regression
- `npm run lint`
- `npm test`
- `npm run build`
- `npm run sites:verify`
- VPS test thêm nếu runtime VPS bị ảnh hưởng

### CRITICAL — rủi ro cao

Bắt buộc dùng nếu yêu cầu hoặc impact thực tế chạm một trong các nhóm:
- finance, revenue, expense, profit
- KPI, payroll, salary, bonus, allowance, salary advance
- order mutation có ảnh hưởng tiền/audit
- attendance/worked hours nếu downstream vào payroll/KPI
- authorization/role/store isolation
- database/schema/migration/persistence
- authentication/session/credentials
- destructive delete/data repair
- idempotency/concurrency/race condition nhạy cảm
- production VPS runtime/storage/deployment behavior
- thay đổi business rule cốt lõi

Luồng CRITICAL:

`REQUEST -> RISK CLASSIFY -> DEEP ANALYZE -> IMPACT MAP -> REGRESSION TEST -> MINIMAL IMPLEMENTATION -> SECURITY/DATA SELF REVIEW -> FULL VERIFY -> PR -> CI -> REVIEW -> MERGE -> BACKUP/DEPLOY/HEALTH/SMOKE khi production`

Bắt buộc:
- xác định canonical business logic
- regression test trước hoặc cùng implementation
- kiểm tra wrong role/wrong store/duplicate/retry/null/boundary khi phù hợp
- kiểm tra Sites/VPS nếu dùng chung backend/domain
- migration + backup/rollback plan nếu có persistence change
- không được suy đoán công thức tiền/quyền khi yêu cầu mơ hồ

### Quy tắc nâng/hạ mức

- Bắt đầu bằng mức thấp nhất mà bằng chứng hiện tại cho phép.
- Nếu trong lúc đọc code phát hiện ảnh hưởng nhạy cảm hơn, Codex phải **nâng mức** ngay và báo ngắn gọn lý do.
- Không được hạ từ CRITICAL xuống STANDARD/FAST chỉ để tiết kiệm credit nếu đã chạm tiêu chí CRITICAL.
- Không quét toàn repo nếu task FAST/STANDARD đã có phạm vi rõ ràng.
- Không chạy lại cùng một phân tích/test vô ích nếu input/code không đổi.
- Ưu tiên search theo symbol/file/module liên quan trước, chỉ mở rộng khi thiếu bằng chứng.

## 3. Luồng chuẩn

Luồng tổng quát:

`REQUEST -> RISK CLASSIFY -> ANALYZE -> IMPACT MAP -> BRANCH -> REGRESSION TEST -> IMPLEMENT -> SELF REVIEW -> VERIFY -> PR -> CI -> REVIEW -> MERGE MAIN -> VPS BACKUP -> DEPLOY -> HEALTH CHECK -> SMOKE TEST -> MONITOR`

Các phase không áp dụng có thể rút gọn theo Risk Level, nhưng branch/PR/required CI không được bỏ.

## 4. Phase A — Analysis

Trước khi sửa code:

1. Phân loại FAST / STANDARD / CRITICAL.
2. Đọc implementation hiện tại đúng phạm vi.
3. Tìm code/domain/helper/service có thể reuse.
4. Xác định business rule.
5. Xác định Impact Map: `UI -> state -> domain -> API -> backend -> database` ở mức phù hợp Risk Level.
6. Kiểm tra authorization, store isolation, audit, finance/payroll impact khi có tín hiệu liên quan.
7. Xác định production target: Sites, VPS hoặc cả hai.
8. Xác định migration và rollback risk.
9. Xác định test cần thêm.

Không bắt đầu bằng rewrite file hoặc tạo logic mới khi chưa tìm implementation hiện có.

## 5. Phase B — Branch & Scope

Mỗi task dùng một branch riêng:

- `feature/<name>`
- `fix/<name>`
- `refactor/<name>`
- `ui/<name>`
- `hotfix/<name>`
- `chore/<name>`

Một PR chỉ nên có một mục tiêu nghiệp vụ. Nếu task kéo theo nhiều module độc lập, chia nhỏ trước khi code.

Không thực hiện refactor lớn trong cùng PR bugfix trừ khi bắt buộc để sửa đúng lỗi.

Nếu dự kiến thay đổi lan rộng bất thường so với yêu cầu, Codex phải dừng và báo scope expansion trước khi tiếp tục.

## 6. Phase C — Test-first for risk areas

Bugfix phải có regression test khi khả thi. Các thay đổi finance, KPI, payroll, attendance, authorization, store isolation và persistence phải có test trước hoặc đồng thời với implementation.

Test tối thiểu khi phù hợp: positive, zero, negative, null/missing, duplicate retry, wrong store, wrong role, locked period, deleted record, timezone boundary, month boundary.

FAST chỉ cần targeted test nếu thay đổi không chạm logic; không tạo test vô nghĩa chỉ để tăng số lượng test.

## 7. Phase D — Implementation order

Ưu tiên thứ tự:

`tests/domain -> backend/API -> state -> UI -> migration`

Không duplicate business formula trong UI. Không dùng `localStorage` làm source of truth production. Không hard-code store/employee/permission/money nếu đã có nguồn dữ liệu thật.

Thay đổi phải là nhỏ nhất đủ giải quyết yêu cầu; tránh format/rename/refactor file ngoài scope.

## 8. Phase E — Self review

Trước khi mở PR, review diff theo Risk Level.

FAST tập trung:
- unrelated changes
- UI regression
- build/lint issue

STANDARD thêm:
- duplicate logic
- flow regression
- API/state contract

CRITICAL kiểm tra đầy đủ:
- permission bypass
- cross-store leak
- money/KPI/payroll mismatch
- idempotency/race issues
- timezone bugs
- migration/data-loss risk
- Sites/VPS incompatibility
- audit/destructive behavior

Finding Critical/High phải được xử lý trước merge. Medium/Low phải được ghi rõ nếu chưa xử lý.

## 9. Phase F — Verification gate

### FAST

Chạy targeted checks cần thiết và để required GitHub CI xác nhận trước merge. Nếu thay đổi có thể ảnh hưởng compile/build, phải chạy lint/build tương ứng trước PR.

### STANDARD / CRITICAL

Chạy từ repository root:

```bash
npm run lint
npm test
npm run build
npm run sites:verify
```

Nếu task ảnh hưởng VPS, chạy thêm VPS/runtime tests và kiểm tra tương thích SQLite/file storage.

Không được ghi 'hoàn thành' nếu required check còn fail.

## 10. Pull Request gate

PR phải mô tả:

- Risk Level và lý do
- mục tiêu và root cause
- Impact Map phù hợp mức rủi ro
- business rule
- authorization/store isolation nếu liên quan
- database/migration nếu liên quan
- Sites/VPS impact
- tests đã thêm/chạy
- kết quả verification
- rollback plan khi có rủi ro production/data
- manual checks

Chỉ merge khi required check `verify` PASS và review không còn finding blocking.

## 11. Merge policy

Chỉ deploy code đã merge vào `main`. Không deploy feature branch vào production VPS trừ staging có chủ đích.

GitHub ruleset bảo vệ `main` và required check `verify` là cổng bắt buộc; không bypass để làm nhanh.

## 12. Hotfix

Production bug nghiêm trọng mặc định là CRITICAL và vẫn phải đi theo:

`main -> hotfix/<name> -> minimal regression test -> minimal fix -> CI -> PR -> merge -> backup -> deploy -> smoke test`

Không sửa trực tiếp file trên VPS.

## 13. Credit-efficiency rules

Để giảm Codex credit mà không giảm an toàn:

- phân loại risk trước khi đọc sâu
- search symbol/file trước, không đọc toàn repo mặc định
- reuse kết quả phân tích trong cùng task
- không lặp lại full test nhiều lần khi chưa có code change; chạy targeted test trong vòng sửa và full gate ở cuối
- chỉ mở rộng Impact Map khi phát hiện dependency thực tế
- không viết lại file lớn nếu patch nhỏ đủ dùng
- không tạo documentation/report dài trong quá trình code; báo cáo ngắn, có bằng chứng
- nếu task quá rộng, chia thành nhiều PR nhỏ thay vì để một phiên Codex xử lý toàn hệ thống

Tiết kiệm credit không bao giờ là lý do để bỏ test bắt buộc cho CRITICAL.

## 14. Definition of Done

Một task chỉ hoàn thành khi các mục áp dụng theo Risk Level đã đạt:

- Risk Level được ghi rõ và hợp lý
- đúng business rule
- không thay đổi ngoài scope
- authorization/store isolation đúng nếu liên quan
- tests phù hợp đã có/chạy
- required verification PASS
- migration an toàn nếu có
- production target đã được xác định
- rollback plan rõ khi cần
- PR diff đã review
- post-deploy validation đã hoàn tất nếu task được deploy
