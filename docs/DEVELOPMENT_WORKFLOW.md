# IDOSI Professional Development Workflow

Tài liệu này là quy trình bắt buộc khi thêm, sửa, refactor hoặc hotfix chức năng IDOSI.

## 1. Mục tiêu

Mỗi thay đổi phải nhỏ, có thể review, có test, có rollback và không làm phát sinh thay đổi ngoài phạm vi. Không sửa trực tiếp `main`.

## 2. Luồng chuẩn

`REQUEST -> ANALYZE -> IMPACT MAP -> BRANCH -> REGRESSION TEST -> IMPLEMENT -> SELF REVIEW -> VERIFY -> PR -> CI -> REVIEW -> MERGE MAIN -> VPS BACKUP -> DEPLOY -> HEALTH CHECK -> SMOKE TEST -> MONITOR`

## 3. Phase A — Analysis

Trước khi sửa code:

1. Đọc implementation hiện tại.
2. Tìm code/domain/helper/service có thể reuse.
3. Xác định business rule.
4. Xác định Impact Map: `UI -> state -> domain -> API -> backend -> database`.
5. Kiểm tra authorization, store isolation, audit, finance/payroll impact.
6. Xác định production target: Sites, VPS hoặc cả hai.
7. Xác định migration và rollback risk.
8. Xác định test cần thêm.

Không bắt đầu bằng rewrite file hoặc tạo logic mới khi chưa tìm implementation hiện có.

## 4. Phase B — Branch & Scope

Mỗi task dùng một branch riêng:

- `feature/<name>`
- `fix/<name>`
- `refactor/<name>`
- `ui/<name>`
- `hotfix/<name>`

Một PR chỉ nên có một mục tiêu nghiệp vụ. Nếu task kéo theo nhiều module độc lập, chia nhỏ trước khi code.

Không thực hiện refactor lớn trong cùng PR bugfix trừ khi bắt buộc để sửa đúng lỗi.

## 5. Phase C — Test-first for risk areas

Bugfix phải có regression test khi khả thi. Các thay đổi finance, KPI, payroll, attendance, authorization, store isolation và persistence phải có test trước hoặc đồng thời với implementation.

Test tối thiểu khi phù hợp: positive, zero, negative, null/missing, duplicate retry, wrong store, wrong role, locked period, deleted record, timezone boundary, month boundary.

## 6. Phase D — Implementation order

Ưu tiên thứ tự:

`tests/domain -> backend/API -> state -> UI -> migration`

Không duplicate business formula trong UI. Không dùng `localStorage` làm source of truth production. Không hard-code store/employee/permission/money nếu đã có nguồn dữ liệu thật.

## 7. Phase E — Self review

Trước khi mở PR, review diff như senior engineer và tìm:

- regression
- duplicate logic
- permission bypass
- cross-store leak
- money/KPI/payroll mismatch
- idempotency/race issues
- timezone bugs
- migration/data-loss risk
- Sites/VPS incompatibility
- unrelated changes

Finding Critical/High phải được xử lý trước merge. Medium/Low phải được ghi rõ nếu chưa xử lý.

## 8. Phase F — Verification gate

Chạy từ repository root:

```bash
npm run lint
npm test
npm run build
npm run sites:verify
```

Nếu task ảnh hưởng VPS, chạy thêm VPS/runtime tests và kiểm tra tương thích SQLite/file storage.

Không được ghi 'hoàn thành' nếu required check còn fail.

## 9. Pull Request gate

PR phải mô tả:

- mục tiêu và root cause
- Impact Map
- business rule
- authorization/store isolation
- database/migration
- Sites/VPS impact
- tests đã thêm
- kết quả verification
- rollback plan
- manual checks

Chỉ merge khi `Verify IDOSI` PASS và review không còn finding blocking.

## 10. Merge policy

Chỉ deploy code đã merge vào `main`. Không deploy feature branch vào production VPS trừ staging có chủ đích.

## 11. Hotfix

Production bug nghiêm trọng vẫn phải đi theo:

`main -> hotfix/<name> -> minimal regression test -> minimal fix -> CI -> PR -> merge -> backup -> deploy -> smoke test`

Không sửa trực tiếp file trên VPS.

## 12. Definition of Done

Một task chỉ hoàn thành khi:

- đúng business rule
- không thay đổi ngoài scope
- authorization/store isolation đúng
- tests phù hợp đã có
- lint/test/build/verify PASS
- migration an toàn nếu có
- production target đã được xác định
- rollback plan rõ
- PR diff đã review
- post-deploy validation đã hoàn tất nếu task được deploy
