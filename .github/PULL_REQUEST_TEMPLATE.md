# Pull Request – IDOSI

> Quy trình chi tiết: `docs/DEVELOPMENT_WORKFLOW.md`. Nếu PR được deploy VPS, dùng thêm `docs/VPS_DEPLOYMENT_CHECKLIST.md`.

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
`Yêu cầu → dữ liệu → domain → API/backend → state → UI → database → production target → tests → downstream features`

Các module có nguy cơ regression:
- 

## Business rules
Liệt kê business rule đã thêm/thay đổi. Nếu không đổi, ghi `Không thay đổi business rule`.

## Phân quyền & store isolation
- Vai trò được phép thao tác:
- Vai trò chỉ được xem:
- [ ] Backend authorization đã được kiểm tra.
- [ ] Store/user scope đã được kiểm tra.
- [ ] Không mở rộng quyền ngoài yêu cầu.

## Finance / Payroll / KPI
- [ ] Không liên quan.
- [ ] Có liên quan và đã thêm/cập nhật regression tests.
- Nguồn business logic canonical:
- Edge cases đã test:

## Database / migration
- Có thay đổi schema? Có / Không
- Migration:
- Tương thích dữ liệu cũ? Có / Không / N/A
- Backup/restore implication:

## Production targets
- [ ] Sites / Cloudflare
- [ ] VPS / SQLite
- [ ] Cả hai
- VPS compatibility notes:

## Kiểm thử bắt buộc
- [ ] `npm run lint`
- [ ] `npm test`
- [ ] `npm run build`
- [ ] `npm run sites:verify`
- [ ] VPS/runtime tests nếu VPS bị ảnh hưởng

Test mới/đã cập nhật:
- 

## Self-review
Đã review diff cho:
- [ ] Regression
- [ ] Duplicate business logic
- [ ] Permission bypass / cross-store leak
- [ ] Money/KPI/payroll mismatch
- [ ] Idempotency / race condition
- [ ] Timezone / date boundary
- [ ] Migration / data-loss risk
- [ ] Sites/VPS incompatibility
- [ ] Unrelated file changes

## Kiểm tra thủ công
- [ ] Desktop nếu có UI
- [ ] Mobile / responsive nếu có UI
- [ ] Loading / empty / error states
- [ ] Permission denied nếu liên quan
- [ ] Flow nghiệp vụ chính

## Rollback plan
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

## Dữ liệu nhạy cảm
- [ ] Không commit password/token/secret hoặc dữ liệu production nhạy cảm.
- [ ] Không dùng `localStorage` làm source of truth production.
- [ ] Không hard-code store/employee/permission/money nếu đã có nguồn thật.

## Definition of Done
- [ ] Chỉ thay đổi đúng scope.
- [ ] Không tạo logic nghiệp vụ trùng lặp.
- [ ] Test cần thiết đã được bổ sung/cập nhật.
- [ ] Verify IDOSI PASS.
- [ ] Diff đã được review.
- [ ] Rollback plan đã rõ.
- [ ] Production target đã được xác định.
