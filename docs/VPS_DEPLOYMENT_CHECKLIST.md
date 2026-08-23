# IDOSI VPS Deployment Checklist

Checklist bắt buộc cho deploy production VPS.

## A. Pre-deploy

- [ ] PR đã merge vào `main`.
- [ ] `Verify IDOSI` PASS.
- [ ] Xác nhận commit SHA cần deploy.
- [ ] VPS working tree sạch, không có sửa tay chưa commit.
- [ ] Xác định migration có/không.
- [ ] Xác định rollback commit.
- [ ] Xác nhận dung lượng disk còn đủ.
- [ ] Xác nhận backup database/storage trước thay đổi rủi ro.

## B. Backup

SQLite phải được backup nhất quán trước migration hoặc thay đổi dữ liệu rủi ro. Không copy tùy tiện file DB đang ghi nếu quy trình hiện tại yêu cầu cơ chế backup nhất quán.

Cần ghi lại:

- thời gian backup
- database backup location
- image/file storage backup nếu task ảnh hưởng storage
- commit SHA hiện đang chạy

Không deploy migration phá schema khi chưa có backup có thể restore.

## C. Prepare release

Từ `main`:

```bash
git fetch --all --prune
git checkout main
git pull --ff-only
npm ci
npm run lint
npm test
npm run build
```

Nếu bất kỳ bước nào fail: DỪNG DEPLOY.

Không dùng `npm install` tùy tiện trên production khi repo có lockfile và quy trình release yêu cầu reproducible install.

## D. Migration

Nếu có migration:

- [ ] Đã review migration SQL.
- [ ] Không truncate/reset production data.
- [ ] Migration tương thích dữ liệu hiện có.
- [ ] Có backup trước migration.
- [ ] Có rollback/restore plan.
- [ ] Migration hoàn thành không có foreign-key violation.

SQLite VPS runtime hiện tự áp dụng migration theo cơ chế repo; thay đổi cơ chế này phải được test riêng.

## E. Restart / reload

- [ ] Restart/reload service theo service manager hiện tại.
- [ ] Service lên trạng thái healthy/running.
- [ ] Không có crash loop.
- [ ] Log startup không có lỗi migration/database/storage/auth.

Không chỉnh source trực tiếp trên VPS để sửa lỗi sau deploy; tạo hotfix branch và đi lại pipeline.

## F. Health check

Kiểm tra endpoint health/bootstrap tương ứng của runtime và tối thiểu:

- HTTP status đúng
- API phản hồi
- database truy cập được
- static assets tải được
- file/image storage truy cập được nếu có liên quan

## G. Smoke test production

Kiểm tra theo phạm vi thay đổi; tối thiểu khi phù hợp:

- [ ] Login Admin.
- [ ] Login store manager.
- [ ] Login employee.
- [ ] Dashboard tải được.
- [ ] Read orders/attendance/finance/payroll.
- [ ] Mutation liên quan task hoạt động đúng.
- [ ] Permission denied đúng với role không có quyền.
- [ ] Store isolation đúng.
- [ ] Mobile/responsive nếu thay UI.

Không tạo dữ liệu production rác chỉ để smoke test; dùng flow test-safe hoặc rollback dữ liệu kiểm thử có chủ đích.

## H. Release record

Ghi lại:

- deployed commit SHA
- deployment time
- backup location
- migration result
- service status
- health check result
- smoke-test result
- rollback target

## I. Rollback

Rollback khi có Critical/High production regression hoặc data-integrity risk.

Quy trình tổng quát:

1. Dừng mutation rủi ro nếu cần.
2. Xác định last-known-good commit.
3. Roll code về commit đó.
4. Restore database từ backup nếu migration/data change không backward-compatible.
5. Restart service.
6. Health check.
7. Smoke test.
8. Tạo hotfix issue/PR để xử lý root cause.

Không 'fix forward' trực tiếp trên VPS bằng cách sửa file thủ công.
