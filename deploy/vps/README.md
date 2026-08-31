# Triển khai IDOSI trên VPS

IDOSI production chạy API bằng Node.js 24, SQLite và thư mục ảnh trong Docker
volume; Caddy cấp HTTPS và phục vụ frontend trực tiếp từ static volume bất biến
theo release SHA. Sau khi cài đặt một lần, mọi
release đã merge vào `main` được triển khai tự động khi **Verify IDOSI** PASS cho
đúng merge SHA.

## Kiến trúc production

- Repository trên VPS: `/opt/idosi`
- Compose: `/opt/idosi/deploy/vps/compose.yml`
- App: Node.js API + SQLite, dữ liệu tại `/app/data`
- Frontend: Caddy đọc volume `idosi_static_<full-sha>` ở chế độ read-only
- Persistent volume: volume đang mount vào `/app/data`, thường là `vps_idosi_data`
- Reverse proxy/TLS: Caddy
- Health: `https://idosi.io.vn/api/health`
- Release identity: `https://idosi.io.vn/api/release`
- Backup, job status, log và report: `/opt/idosi/deploy/vps/backups/`

`/api/release` phải trả đúng SHA đang chạy. PR merge, CI xanh hoặc container `Up`
không đủ để kết luận production đã nhận release.

## 1. Cài đặt VPS lần đầu

```bash
sudo apt update
sudo apt install -y ca-certificates curl git openssh-server
curl -fsSL https://get.docker.com | sudo sh
sudo systemctl enable --now docker ssh
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

Tạo deploy user riêng, cho quyền Docker và quyền sở hữu repository:

```bash
sudo adduser --disabled-password --gecos '' idosi-deploy
sudo usermod -aG docker idosi-deploy
sudo mkdir -p /opt/idosi
sudo chown -R idosi-deploy:idosi-deploy /opt/idosi
```

Clone repo và tạo `.env` bằng deploy user:

```bash
sudo -H -u idosi-deploy git clone https://github.com/mrbengilo/quanly-IDOSI.git /opt/idosi
cd /opt/idosi/deploy/vps
sudo -H -u idosi-deploy cp .env.example .env
openssl rand -hex 32
```

Đưa chuỗi ngẫu nhiên vào `BOOTSTRAP_TOKEN` trong `.env`, giữ file mode `600` và
không commit `.env`.

Khởi động lần đầu bằng SHA hiện tại:

```bash
cd /opt/idosi
RELEASE_SHA="$(git rev-parse HEAD)"
cd deploy/vps
sed -i "s|^IDOSI_IMAGE=.*|IDOSI_IMAGE=idosi-app:$RELEASE_SHA|" .env
sed -i "s|^IDOSI_RELEASE_SHA=.*|IDOSI_RELEASE_SHA=$RELEASE_SHA|" .env
docker compose build app
STATIC_VOLUME="idosi_static_$RELEASE_SHA"
docker volume create \
  --label 'io.idosi.managed=true' \
  --label "io.idosi.release-sha=$RELEASE_SHA" \
  "$STATIC_VOLUME"
docker run --rm --network none --read-only --user 0:0 \
  --mount "type=volume,source=$STATIC_VOLUME,target=/static" \
  --entrypoint node "idosi-app:$RELEASE_SHA" server/vps/static-release.mjs prepare \
  --source /app/dist/client --target /static --sha "$RELEASE_SHA"
docker compose up -d --no-build
docker compose ps
curl -fsS https://idosi.io.vn/api/health
curl -fsS https://idosi.io.vn/api/release
docker compose exec -T app node server/vps/verify-public-release.mjs \
  https://idosi.io.vn "$RELEASE_SHA"
```

## 2. Tạo tài khoản Admin ban đầu

Chạy từ `/opt/idosi/deploy/vps`:

```bash
read -rsp "Mật khẩu Admin: " ADMIN_PASSWORD; echo
export ADMIN_PASSWORD
export ADMIN_USERNAME='admin'
export ADMIN_DISPLAY_NAME='Admin IDOSI'
export BOOTSTRAP_TOKEN="$(sed -n 's/^BOOTSTRAP_TOKEN=//p' .env)"
export IDOSI_BASE_URL='https://idosi.io.vn'
docker compose exec -T \
  -e ADMIN_PASSWORD -e ADMIN_USERNAME -e ADMIN_DISPLAY_NAME \
  -e BOOTSTRAP_TOKEN -e IDOSI_BASE_URL \
  app node server/vps/bootstrap.mjs
unset ADMIN_PASSWORD BOOTSTRAP_TOKEN
```

Bootstrap chỉ hoạt động khi bảng tài khoản đang trống.

## 3. Cấu hình GitHub một lần

### Bảo vệ `main`

Trong **Settings → Rulesets**, yêu cầu:

- thay đổi qua Pull Request;
- required check `verify` PASS;
- không force-push hoặc xóa `main`.

### Environment `production`

Trong **Settings → Environments**, tạo `production` và:

- chỉ cho branch `main` triển khai;
- để **Required reviewers** tắt và **Wait timer** tắt nếu muốn tự động hoàn toàn;
- thêm các environment secrets:

| Secret | Nội dung |
|---|---|
| `IDOSI_VPS_HOST` | IP/hostname SSH của VPS |
| `IDOSI_VPS_PORT` | Cổng SSH, thường là `22` |
| `IDOSI_VPS_USER` | `idosi-deploy` hoặc deploy user riêng |
| `IDOSI_VPS_SSH_PRIVATE_KEY` | Private key Ed25519 dành riêng cho Actions |
| `IDOSI_VPS_KNOWN_HOSTS` | Dòng ED25519 known_hosts đã đối chiếu fingerprint |

Private key không đặt passphrase vì workflow dùng key không tương tác; giới hạn key
chỉ cho deploy user, bảo vệ secret trong Environment và xoay key khi nghi ngờ lộ.
Không dùng `StrictHostKeyChecking=no`.

## 4. Luồng cập nhật production tự động

```text
Codex chia task + commit nhỏ
→ Pull Request
→ Verify IDOSI PASS
→ merge main
→ Verify IDOSI PASS cho exact merge SHA
→ Deploy IDOSI VPS tự chạy bằng workflow_run
→ durable remote deployment
→ backup + checksum
→ app/migration + internal exact-SHA verification
→ Caddy/local HTTPS
→ external production verification
→ chuyển attestation exact SHA/origin/thời gian external verification qua SSH
→ finalizer xác thực attestation rồi ghi report SUCCESS
→ smoke test và báo cáo
```

Automatic trigger chỉ chấp nhận workflow nguồn khi đồng thời:

- workflow là `Verify IDOSI`;
- conclusion là `success`;
- event nguồn là `push`;
- branch nguồn là `main`;
- `workflow_run.head_sha` là full SHA thuộc lịch sử `origin/main`.

Không deploy từ PR verify, manual verify, feature branch hoặc branch head đang di
chuyển. `concurrency: idosi-production` và `cancel-in-progress: false` bảo vệ một
backup/migration đang chạy khỏi deployment khác.

## 5. Manual re-deploy/fallback

`workflow_dispatch` vẫn tồn tại cho re-deploy hoặc recovery có kiểm soát:

1. Mở **Actions → Deploy IDOSI VPS → Run workflow** từ `main`.
2. Nhập full 40-character SHA.
3. Workflow xác minh SHA thuộc `main` và đã có một `Verify IDOSI` push/main PASS.

Không dùng manual dispatch để bỏ qua CI hoặc triển khai feature branch.

## 6. Những gì deployment thực hiện

- upload đúng script từ exact release checkout;
- chạy critical section bằng detached `setsid`/`nohup`, nên runner mất kết nối
  không kill tiến trình VPS;
- ghi operation status/log dưới `backups/jobs/`;
- khóa bằng `flock`, từ chối VPS dirty và deployment song song;
- build image `idosi-app:<full-sha>` khi release cũ còn phục vụ;
- xác nhận OCI image revision và tạo/verify static volume cùng exact SHA trước
  cửa sổ bảo trì;
- giữ previous image/tag làm rollback point;
- dừng Caddy và app trước khi backup SQLite/file volume;
- kiểm tra archive và tạo SHA-256 checksum;
- khởi động app mới, migration chạy transactionally khi SQLite được mở;
- xác nhận app container thực sự chạy đúng image ID, OCI revision và release SHA;
- chỉ mở Caddy khi internal health, `/api/release`, marker và mount static volume
  đều đúng SHA;
- ghi report `LOCAL_READY` sau local HTTPS check;
- GitHub runner kiểm tra external health, exact SHA, root page và static assets, rồi
  truyền attestation gồm exact SHA, origin, thời gian và GitHub run metadata cho finalizer
  qua kết nối SSH đã xác thực;
- finalizer từ chối attestation thiếu, sai SHA/origin, cũ, nằm trước deployment hoặc
  ở tương lai và chỉ sau đó đổi report nguyên tử sang `SUCCESS`; finalizer không
  lặp lại external fetch từ VPS/app container nên không phụ thuộc NAT hairpin;
- tự rollback trước khi traffic mở nếu rollout thất bại;
- fail closed nếu restore/recovery không chứng minh được dữ liệu an toàn;
- không tự restore snapshot sau khi traffic đã mở để tránh ghi đè write mới.

Không sửa source trực tiếp trên VPS. Không dùng `git pull && docker compose up`
như quy trình release thông thường.

## 7. Xác minh sau deploy

```bash
cd /opt/idosi/deploy/vps
docker compose ps
docker compose logs --since=10m --tail=300 app caddy
curl -fsS https://idosi.io.vn/api/health
curl -fsS https://idosi.io.vn/api/release
docker compose exec -T app node server/vps/verify-public-release.mjs \
  https://idosi.io.vn "$(sed -n 's/^IDOSI_RELEASE_SHA=//p' .env)"
```

`data.releaseSha`, header `X-IDOSI-Static-Release`, JavaScript entry và favicon
phải cùng release SHA và tải thành công. Smoke test theo phạm vi thay đổi; không
tạo dữ liệu lương, thưởng, vi phạm hoặc tài chính giả không có kế hoạch void/dọn
hợp lệ.

## 8. Quan sát hiệu năng API

Mỗi API request của app ghi một dòng JSON `idosi.api.request` để chẩn đoán mà
không ghi query string, header, body, IP, token hoặc thông tin đăng nhập. Dùng
`requestId` trả trong header `X-Request-Id` để đối chiếu; các trường
`timingMs.handler`, `database.statements`, `database.totalMs`, `responseBytes` và
`slow` tách thời gian xử lý ứng dụng khỏi số lượng/độ trễ SQLite. Docker giữ tối
đa 5 tệp log, mỗi tệp 10 MB cho từng service.

Riêng runtime SQLite trên VPS đọc state shell, collection manifest và entity bằng
một snapshot query đồng bộ. Global raw snapshot có tối đa một cache entry cho mỗi
database, khóa bằng cả `version` và `last_request_id`, với ngân sách serialized giữ
lại 24 MiB (không phải hard cap của V8 heap);
mọi cache hit vẫn đọc head nhỏ và vẫn chạy auth/projection theo từng actor. Không
cache user, session, projection hoặc HTTP response. Cloudflare D1 tiếp tục dùng
paging cũ và không chạy bulk query này.

```bash
docker compose logs --since=10m app | grep 'idosi.api.request'
```

## 9. Backup, report và rollback

Mỗi deployment tạo backup, checksum, log, operation status và report tại:

```text
/opt/idosi/deploy/vps/backups/
```

Sao chép định kỳ các backup quan trọng sang nơi lưu trữ khác. Không tự động xóa
backup mới nhất, report cần audit hoặc previous image còn dùng để rollback.
Giữ cả static volume của current release và rollback release; đây là artifact
không chứa dữ liệu người dùng và có thể tái tạo từ exact image, nhưng không được
xóa khi còn là rollback point.

Rollback có kiểm soát:

```bash
cd /opt/idosi
bash deploy/vps/rollback-release.sh \
  /opt/idosi/deploy/vps/backups/deploy-YYYYMMDDTHHMMSSZ-abcdef123456.env
```

Script tạo emergency backup của dữ liệu hiện tại, kiểm tra checksum backup mục
tiêu, restore volume, chạy previous image, xác minh exact release, lưu `.env` và
chỉ mở Caddy khi mọi bước PASS. Recovery lỗi phải giữ app/Caddy dừng và ghi
incident report. Rollback chấp nhận stack đang chạy hoặc đã dừng nhưng container
và volume còn tồn tại; trước mọi backup/restore, script phải chứng minh app và
Caddy đã dừng, nếu không sẽ fail-closed và không ghi đè SQLite.

## 10. Điều kiện được báo `DEPLOYED`

Chỉ báo thành công khi có bằng chứng:

- exact main SHA đã Verify IDOSI PASS;
- automatic/manual release gate PASS;
- backup + checksum PASS;
- app/migration/internal health PASS;
- local Caddy HTTPS PASS;
- external `/api/health`, `/api/release` và root page PASS;
- report đã `STATUS=SUCCESS`;
- smoke test liên quan PASS;
- rollback point tồn tại.
