# Pull Request – IDOSI

> Quy trình chi tiết: `docs/DEVELOPMENT_WORKFLOW.md`. Nếu PR được deploy VPS, dùng thêm `docs/VPS_DEPLOYMENT_CHECKLIST.md`.

## Risk Level
- [ ] FAST
- [ ] STANDARD
- [ ] CRITICAL

Lý do phân loại:
- 

Sensitive areas:
- [ ] None
- [ ] Finance / revenue / expense / profit
- [ ] KPI / payroll / salary / bonus / allowance / salary advance
- [ ] Order mutation / audit
- [ ] Attendance / worked hours
- [ ] Authorization / role / store isolation
- [ ] Database / migration / persistence
- [ ] Auth / session / credentials
- [ ] VPS runtime / storage / deployment

Nếu trong quá trình implementation Risk Level đã được nâng, ghi rõ từ mức nào và vì sao:
- 

## Mục tiêu / Root cause
Mô tả ngắn gọn yêu cầu, lỗi gốc và lý do cần thay đổi.

## Phạm vi thay đổi
- [ ] UI / components
- [ ] State
- [ ] Domain / business logic
- [ ] API / services
- [ ] Backend / Worker
- [ ] Database / migration
- [ ] VPS runtime / storage
- [ ] Test
- [ ] CI / tooling
- [ ] Documentation

## Impact Map
FAST có thể ghi scope ngắn nếu thật sự không có downstream business impact. STANDARD/CRITICAL phải ghi rõ:

`Yêu cầu → dữ liệu → domain → API/backend → state → UI → database → production target → tests → downstream features`

Các module có nguy cơ regression:
- 

## Business rules
Liệt kê business rule đã thêm/thay đổi. Nếu không đổi, ghi `Không thay đổi business rule`.

## Phân quyền & store isolation
- Vai trò được phép thao tác:
- Vai trò chỉ được xem:
- [ ] Không liên quan.
- [ ] Backend authorization đã được kiểm tra.
- [ ] Store/user scope đã được kiểm tra.
- [ ] Không mở rộng quyền ngoài yêu cầu.

## Finance / Payroll / KPI
- [ ] Không liên quan.
- [ ] Có liên quan → Risk Level phải là CRITICAL.
- [ ] Đã thêm/cập nhật regression tests nếu có liên quan.
- Nguồn business logic canonical:
- Edge cases đã test:

## Database / migration
- Có thay đổi schema/persistence? Có / Không
- Nếu Có → Risk Level phải là CRITICAL.
- Migration:
- Tương thích dữ liệu cũ? Có / Không / N/A
- Backup/restore implication:

## Production targets
- [ ] Sites / Cloudflare
- [ ] VPS / SQLite
- [ ] Cả hai
- [ ] Documentation/UI-only, không ảnh hưởng runtime
- VPS compatibility notes:

## Verification plan & result

### FAST
- [ ] Targeted checks phù hợp đã chạy hoặc được giải thích vì sao không cần local run.
- [ ] Lint/build đã chạy nếu thay đổi có thể ảnh hưởng compile/style correctness.
- [ ] GitHub required CI `verify` PASS.

### STANDARD
- [ ] `npm run lint`
- [ ] `npm test`
- [ ] `npm run build`
- [ ] `npm run sites:verify`
- [ ] VPS/runtime tests nếu VPS bị ảnh hưởng
- [ ] GitHub required CI `verify` PASS

### CRITICAL
- [ ] Toàn bộ STANDARD checks PASS.
- [ ] Regression tests cho sensitive business rule PASS.
- [ ] Wrong-role / wrong-store / duplicate / boundary cases đã kiểm tra khi phù hợp.
- [ ] Migration/backup/rollback đã review nếu liên quan.
- [ ] Sites/VPS compatibility đã kiểm tra khi dùng chung logic.
- [ ] GitHub required CI `verify` PASS.

Test mới/đã cập nhật:
- 

## Self-review
Tất cả PR:
- [ ] Unrelated file changes
- [ ] Regression trong scope
- [ ] Duplicate business logic

STANDARD/CRITICAL khi liên quan:
- [ ] API/state contract
- [ ] Permission bypass / cross-store leak
- [ ] Money/KPI/payroll mismatch
- [ ] Idempotency / race condition
- [ ] Timezone / date boundary
- [ ] Migration / data-loss risk
- [ ] Sites/VPS incompatibility
- [ ] Audit/destructive behavior

## Kiểm tra thủ công
- [ ] Desktop nếu có UI
- [ ] Mobile / responsive nếu có UI
- [ ] Loading / empty / error states
- [ ] Permission denied nếu liên quan
- [ ] Flow nghiệp vụ chính
- [ ] Không áp dụng / documentation-only

## Rollback plan
FAST documentation/UI-only có thể ghi `Không cần data rollback`.

- Last-known-good commit / release:
- Code rollback:
- Database restore cần thiết? Có / Không
- Ghi chú:

## VPS deployment readiness
Chỉ đánh dấu khi PR dự kiến deploy production VPS:
- [ ] Chỉ deploy sau khi merge `main`.
- [ ] Có commit SHA release rõ ràng.
- [ ] Có backup plan trước migration/data-risk change.
- [ ] Có health check plan.
- [ ] Có smoke-test plan.
- [ ] Không sửa source trực tiếp trên VPS.

## Credit-efficiency check
- [ ] Chỉ đọc/search module liên quan trước khi mở rộng scope.
- [ ] Không chạy lại full test khi code/input chưa đổi.
- [ ] Không dùng CRITICAL nếu không có tiêu chí CRITICAL.
- [ ] Không hạ CRITICAL để tiết kiệm credit.

## Dữ liệu nhạy cảm
- [ ] Không commit password/token/secret hoặc dữ liệu production nhạy cảm.
- [ ] Không dùng `localStorage` làm source of truth production.
- [ ] Không hard-code store/employee/permission/money nếu đã có nguồn thật.

## Definition of Done
- [ ] Risk Level hợp lý và được ghi rõ.
- [ ] Chỉ thay đổi đúng scope.
- [ ] Không tạo logic nghiệp vụ trùng lặp.
- [ ] Test/checks theo Risk Level đã PASS.
- [ ] Required CI `verify` PASS.
- [ ] Diff đã được review.
- [ ] Rollback plan phù hợp mức rủi ro.
- [ ] Production target đã được xác định.
