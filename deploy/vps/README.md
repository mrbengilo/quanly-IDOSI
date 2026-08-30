# Triển khai IDOSI trên VPS

IDOSI production chạy frontend + API bằng Node.js 24, SQLite và thư mục ảnh trong
Docker volume; Caddy cấp HTTPS cho `idosi.io.vn`. Các lần cập nhật sau khi cài đặt
ban đầu phải đi qua workflow **Deploy IDOSI VPS**, triển khai đúng commit SHA đã
được workflow **Verify IDOSI** xác nhận.

## Kiến trúc production

- Repository trên VPS: `/opt/idosi`
- Compose: `/opt/idosi/deploy/vps/compose.yml`
- App: Node.js + SQLite, dữ liệu tại `/app/data`
- Persistent volume: volume đang mount vào `/app/data` (thường là `vps_idosi_data`)
- Reverse proxy/TLS: Caddy
- Health: `https://idosi.io.vn/api/health`
- Release identity: `https://idosi.io.vn/api/release`
- Backup và deployment report: `/opt/idosi/deploy/vps/backups/`

`/api/release` phải trả đúng SHA đang chạy. Merge GitHub hoặc container trạng thái
`Up` không đủ để kết luận production đã chạy release mới.

## 1. Cài đặt VPS lần đầu

```bash
sudo apt update
sudo apt install -y ca-certificates curl git openssh-server
curl -fsSL https://get.docker.com | sudo sh
sudo systemctl enable --now docker ssh
sudo usermod -aG docker "$USER"
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

Đăng xuất/đăng nhập lại sau khi thêm user vào group `docker`. DNS phải trỏ
`idosi.io.vn` đến VPS và `www` CNAME về tên miền gốc.

```bash
sudo mkdir -p /opt/idosi
sudo chown "$USER":"$USER" /opt/idosi
git clone https://github.com/mrbengilo/quanly-IDOSI.git /opt/idosi
cd /opt/idosi/deploy/vps
cp .env.example .env
openssl rand -hex 32
```

Đưa chuỗi vừa tạo vào `BOOTSTRAP_TOKEN` trong `.env`; không commit `.env`.
Khởi động lần đầu bằng SHA hiện tại:

```bash
cd /opt/idosi
RELEASE_SHA="$(git rev-parse HEAD)"
cd deploy/vps
sed -i "s|^IDOSI_IMAGE=.*|IDOSI_IMAGE=idosi-app:$RELEASE_SHA|" .env
sed -i "s|^IDOSI_RELEASE_SHA=.*|IDOSI_RELEASE_SHA=$RELEASE_SHA|" .env
docker compose up -d --build

docker compose ps
curl -fsS https://idosi.io.vn/api/health
curl -fsS https://idosi.io.vn/api/release
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

## 3. Cấu hình GitHub branch protection và Environment `production`

Trong **Settings → Branches/Rulesets**, bảo vệ `main` và yêu cầu Pull Request +
check **Verify IDOSI** PASS trước merge. Không cho push trực tiếp bỏ qua CI.

Sau đó mở **Settings → Environments → New environment** và tạo `production`.

Cấu hình bắt buộc:

1. Thêm required reviewer để deployment phải được duyệt.
2. Chỉ cho phép branch `main` triển khai.
3. Không cho người chạy workflow tự duyệt nếu có người duyệt độc lập.
4. Thêm environment secrets:

| Secret | Nội dung |
|---|---|
| `IDOSI_VPS_HOST` | IP hoặc hostname SSH của VPS |
| `IDOSI_VPS_PORT` | Cổng SSH, thường là `22` |
| `IDOSI_VPS_USER` | User có quyền đọc `/opt/idosi` và chạy Docker |
| `IDOSI_VPS_SSH_PRIVATE_KEY` | Private key Ed25519 dành riêng cho deployment |
| `IDOSI_VPS_KNOWN_HOSTS` | Dòng known_hosts đã xác minh fingerprint của VPS |

Tạo deployment key trên máy tin cậy:

```bash
ssh-keygen -t ed25519 -C 'idosi-github-actions' -f idosi_deploy_key
ssh-copy-id -i idosi_deploy_key.pub -p 22 <IDOSI_VPS_USER>@<IDOSI_VPS_HOST>
ssh-keyscan -p 22 -H <IDOSI_VPS_HOST>
```

Phải xác minh fingerprint SSH của VPS trước khi lưu output `ssh-keyscan` vào
`IDOSI_VPS_KNOWN_HOSTS`. Không dùng `StrictHostKeyChecking=no`.

## 4. Quy trình cập nhật production

Luồng chuẩn:

```text
PR review
→ Verify IDOSI PASS
→ merge main
→ Verify IDOSI PASS cho merge SHA
→ chạy Deploy IDOSI VPS với full merge SHA
→ production environment approval
→ pre-deploy checks
→ build image theo SHA
→ dừng traffic ngắn
→ backup volume SQLite + checksum
→ chạy app mới/migration
→ internal health + release SHA
→ khởi động Caddy
→ HTTPS local verification
→ external production verification
→ deployment report
```

Thao tác triển khai:

1. Mở tab **Actions**.
2. Chọn **Deploy IDOSI VPS**.
3. Chọn **Run workflow**.
4. Dán full 40-character merge commit SHA từ `main`.
5. Duyệt job `production` khi GitHub yêu cầu.

Workflow sẽ từ chối khi SHA không thuộc `origin/main` hoặc chưa có một run
**Verify IDOSI** thành công cho đúng SHA đó.

## 5. Những gì script deployment thực hiện

`deploy-release.sh`:

- khóa deployment bằng `flock`, không cho hai release chạy đồng thời;
- dừng nếu working tree VPS có thay đổi thủ công;
- checkout detached đúng `RELEASE_SHA` đã xác minh;
- build image `idosi-app:<full-sha>` trong khi release cũ vẫn phục vụ;
- giữ tag image cũ làm rollback point;
- dừng Caddy và app trong cửa sổ bảo trì ngắn;
- backup volume `/app/data`, kiểm tra archive và tạo SHA-256 checksum;
- khởi động app mới; migration chạy transactionally khi SQLite được mở;
- chỉ khởi động Caddy sau khi `/api/health` và `/api/release` nội bộ PASS;
- kiểm tra HTTPS qua Caddy và ghi deployment report/log;
- tự phục hồi backup + previous image nếu lỗi xảy ra trước khi public traffic mở lại;
- sau khi Caddy đã mở public traffic, không tự restore snapshot khi check sau đó lỗi,
  nhằm tránh ghi đè dữ liệu mới; workflow sẽ fail và yêu cầu xử lý incident có kiểm soát;
- ghi `IDOSI_IMAGE` và `IDOSI_RELEASE_SHA` vào `.env` bằng thay thế nguyên tử sau
  khi release/rollback thành công, để các lệnh Compose sau đó vẫn dùng đúng image.

Không sửa source trực tiếp trên VPS. Không dùng `git pull && docker compose up`
không kèm SHA, backup và production verification.

## 6. Kiểm tra sau deploy

```bash
cd /opt/idosi/deploy/vps
docker compose ps
docker compose logs --since=10m --tail=300 app caddy
curl -fsS https://idosi.io.vn/api/health
curl -fsS https://idosi.io.vn/api/release
```

`data.releaseSha` của `/api/release` phải bằng merge SHA đã triển khai. Sau đó
smoke test đăng nhập, quyền truy cập, màn hình/chức năng vừa thay đổi và các luồng
critical liên quan; không tạo dữ liệu lương/thưởng giả trong production.

## 7. Backup và deployment report

Mỗi deployment tạo:

```text
deploy/vps/backups/idosi-data-<time>-before-<sha>.tar.gz
deploy/vps/backups/deploy-<time>-<sha>.env
deploy/vps/backups/deploy-<time>-<sha>.log
```

Report chứa release SHA, previous SHA, previous image tag, backup path và checksum.
Sao chép định kỳ các backup quan trọng sang nơi lưu trữ khác. Không tự động xóa
backup mới nhất hoặc rollback image đang còn cần thiết.

## 8. Rollback có kiểm soát

Rollback sau khi release đã phục vụ traffic có thể làm mất các thay đổi dữ liệu
phát sinh sau backup. Chỉ thực hiện khi đã đánh giá tác động và chọn đúng report.
Script tạo thêm emergency backup của dữ liệu hiện tại trước khi restore:

```bash
cd /opt/idosi
bash deploy/vps/rollback-release.sh \
  /opt/idosi/deploy/vps/backups/deploy-YYYYMMDDTHHMMSSZ-abcdef123456.env
```

Rollback thực hiện:

```text
dừng Caddy/app
→ emergency backup release hiện tại
→ kiểm tra checksum backup mục tiêu
→ restore volume
→ chạy previous image
→ health/release verification
→ khởi động Caddy
→ checkout previous Git SHA
```

Nếu external verification của GitHub thất bại nhưng VPS local verification đã
PASS, không restore dữ liệu theo phản xạ. Kiểm tra DNS/firewall/Caddy/log trước,
rồi quyết định giữ release hoặc chạy rollback có kiểm soát.

## 9. Điều kiện được báo `DEPLOYED`

Chỉ báo deployment thành công khi đồng thời có:

- đúng SHA đã được Verify IDOSI xác nhận;
- backup và checksum thành công;
- migration/app startup thành công;
- container healthy;
- internal health PASS;
- Caddy HTTPS PASS;
- external `/api/health` PASS;
- external `/api/release` khớp full SHA;
- smoke test chức năng liên quan PASS;
- rollback report tồn tại.
