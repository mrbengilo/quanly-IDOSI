# IDOSI VPS Deployment Checklist

Checklist bắt buộc cho production VPS. Quy trình này phải phù hợp với `deploy/vps/README.md`: IDOSI chạy bằng Docker Compose, Node.js 24 trong container, SQLite + image storage trong volume dữ liệu, và Caddy cung cấp HTTPS.

## A. Pre-deploy gate

- [ ] PR đã merge vào `main`.
- [ ] `Verify IDOSI` PASS.
- [ ] Xác nhận commit SHA cần deploy.
- [ ] Xác định last-known-good commit để rollback.
- [ ] Xác định migration có/không.
- [ ] Xác định thay đổi có ảnh hưởng SQLite, image storage, auth/session hoặc bootstrap không.
- [ ] VPS working tree sạch; không có source sửa tay chưa commit.
- [ ] Đủ disk space cho image build và backup.
- [ ] Không có incident đang xử lý hoặc deployment khác chạy song song.

Nếu một gate bắt buộc không đạt: DỪNG DEPLOY.

## B. Xác nhận trạng thái hiện tại

Trên VPS:

```bash
cd /opt/idosi
git status --short
git rev-parse HEAD
cd deploy/vps
docker compose ps
docker compose logs --tail=100 app caddy
curl -fsS https://idosi.io.vn/api/health
```

Ghi lại commit SHA hiện đang chạy và trạng thái health trước deploy.

Không tiếp tục nếu working tree có sửa tay chưa được xử lý rõ ràng.

## C. Backup bắt buộc

Backup trước mỗi lần cập nhật production, đặc biệt trước migration hoặc thay đổi persistence.

Theo cơ chế hiện tại của repo:

```bash
cd /opt/idosi/deploy/vps
docker compose stop app
docker run --rm -v vps_idosi_data:/data -v "$PWD/backups:/backup" alpine \
  sh -c 'tar czf /backup/idosi-data-$(date +%Y%m%d-%H%M%S).tar.gz -C /data .'
docker compose start app
```

Sau backup:

- [ ] File backup tồn tại.
- [ ] File có kích thước hợp lý, không phải 0 byte.
- [ ] Ghi lại đường dẫn/tên backup.
- [ ] `docker compose ps` cho thấy app chạy lại.
- [ ] `/api/health` trả thành công.

Không xóa volume `idosi_data` trong deploy thông thường.

## D. Lấy release từ main

Chỉ deploy code đã merge vào `main`.

```bash
cd /opt/idosi
git fetch origin
git checkout main
git pull --ff-only origin main
git rev-parse HEAD
```

Xác nhận SHA sau pull đúng commit/release dự kiến.

Không deploy trực tiếp branch `feature/*`, `fix/*` hoặc source chưa merge.

## E. Build và rollout

Production hiện build/restart bằng Docker Compose:

```bash
cd /opt/idosi/deploy/vps
docker compose up -d --build
```

Sau đó:

```bash
docker compose ps
docker compose logs --tail=200 app caddy
```

- [ ] App container ở trạng thái running/healthy theo cấu hình hiện tại.
- [ ] Caddy chạy bình thường.
- [ ] Không có crash loop.
- [ ] Không có lỗi migration/database/storage/auth nghiêm trọng trong startup log.

Không chạy `npm install` hoặc chỉnh dependency thủ công bên trong container production để chữa cháy.

## F. Migration safety

SQLite runtime hiện áp dụng migration từ repo khi khởi động. Nếu release có migration:

- [ ] Migration SQL đã được review trong PR.
- [ ] Không reset/truncate/recreate production data để tiện triển khai.
- [ ] Existing rows có default/nullability phù hợp.
- [ ] Có backup trước rollout.
- [ ] Có restore plan nếu migration không backward-compatible.
- [ ] Startup không báo migration failure.
- [ ] Không có foreign-key violation được runtime báo.

Rollback code đơn thuần không phục hồi dữ liệu đã bị migration thay đổi/xóa. Khi cần, phải restore volume backup.

## G. Health check bắt buộc

```bash
curl -fsS https://idosi.io.vn/api/health
```

Xác nhận tối thiểu:

- [ ] HTTPS hoạt động.
- [ ] `/api/health` thành công.
- [ ] API phản hồi.
- [ ] Database truy cập được qua flow ứng dụng.
- [ ] Static assets tải đúng.
- [ ] Image/file storage hoạt động nếu release liên quan storage.

Health check fail => coi deploy chưa thành công.

## H. Smoke test production

Kiểm tra theo phạm vi thay đổi. Với release nghiệp vụ thông thường, tối thiểu khi phù hợp:

- [ ] Login Admin.
- [ ] Login Business Support nếu phạm vi liên quan.
- [ ] Login store manager.
- [ ] Login employee.
- [ ] Dashboard tải được.
- [ ] Orders đọc đúng scope.
- [ ] Attendance đọc/flow liên quan hoạt động.
- [ ] Finance/payroll đọc đúng nếu release chạm nhóm này.
- [ ] Mutation chính của task hoạt động.
- [ ] Role không có quyền bị từ chối đúng.
- [ ] Store isolation đúng.
- [ ] Mobile/responsive kiểm tra nếu thay UI.

Không tạo dữ liệu rác production chỉ để smoke test. Dùng test-safe flow hoặc dữ liệu có kế hoạch dọn/rollback rõ ràng.

## I. Post-deploy observation

Sau rollout, kiểm tra lại:

```bash
cd /opt/idosi/deploy/vps
docker compose ps
docker compose logs --tail=200 app caddy
curl -fsS https://idosi.io.vn/api/health
```

Tìm:

- 5xx mới
- crash/restart bất thường
- migration/database errors
- auth/session errors
- storage errors
- lỗi nghiệp vụ của chức năng vừa thay đổi

## J. Release record

Mỗi deploy cần ghi lại:

- deployed commit SHA
- deployment time
- previous stable commit
- backup filename/path
- migration: có/không + kết quả
- Docker Compose status
- health result
- smoke-test result
- rollback target

## K. Rollback

Rollback khi có Critical/High regression, permission/data leak hoặc data-integrity risk.

### Code rollback

1. Xác định last-known-good commit.
2. Checkout/revert về release đó theo Git policy của đội.
3. Từ `/opt/idosi/deploy/vps`, chạy lại:

```bash
docker compose up -d --build
```

4. Kiểm tra logs, health và smoke test.

### Data rollback

Nếu migration/data mutation không backward-compatible:

1. Hạn chế/dừng app để tránh ghi thêm dữ liệu.
2. Restore từ volume backup đã tạo trước deploy theo runbook vận hành.
3. Đưa code về phiên bản tương thích với backup.
4. Khởi động lại Docker Compose.
5. Health check + smoke test.

Không sửa source trực tiếp trên VPS. Nếu cần fix-forward, tạo `hotfix/<name>`, regression test, CI, PR, merge `main`, backup rồi deploy lại.
