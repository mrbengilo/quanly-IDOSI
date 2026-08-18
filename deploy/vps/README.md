# Triển khai IDOSI trên VPS

Gói này chạy toàn bộ frontend và API trên VPS bằng Node.js 24, SQLite, thư mục ảnh
riêng và Caddy tự cấp HTTPS cho `idosi.io.vn`. Dữ liệu Cloudflare Sites cũ không
được sao chép; VPS mới khởi tạo sạch và chỉ có tài khoản Admin được tạo qua API
bootstrap.

## 1. Chuẩn bị Ubuntu/Debian

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

DNS cần trỏ `idosi.io.vn` đến IP VPS và `www` CNAME về tên miền gốc. Cổng TCP
22, 80, 443 phải được mở trong cả firewall VPS và firewall của nhà cung cấp.

## 2. Cài đặt

```bash
sudo mkdir -p /opt/idosi
sudo chown "$USER":"$USER" /opt/idosi
git clone <URL_REPO> /opt/idosi
cd /opt/idosi/deploy/vps
cp .env.example .env
openssl rand -hex 32
```

Đưa chuỗi vừa tạo vào `BOOTSTRAP_TOKEN` trong `.env`, không commit file này.

```bash
docker compose up -d --build
docker compose ps
docker compose logs --tail=100 app caddy
curl -fsS https://idosi.io.vn/api/health
```

## 3. Tạo duy nhất một tài khoản Admin

Chạy từ `/opt/idosi/deploy/vps`. Các biến mật khẩu chỉ tồn tại trong tiến trình
lệnh và không được ghi vào repo hay log ứng dụng.

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

Bootstrap chỉ hoạt động khi bảng tài khoản đang trống. Các lần gọi sau không tạo
thêm Admin.

## 4. Cập nhật và sao lưu

```bash
cd /opt/idosi
git pull --ff-only origin main
cd deploy/vps
docker compose up -d --build
```

Sao lưu trước mỗi lần cập nhật hoặc thao tác reset:

```bash
docker compose stop app
docker run --rm -v vps_idosi_data:/data -v "$PWD/backups:/backup" alpine \
  sh -c 'tar czf /backup/idosi-data-$(date +%Y%m%d-%H%M%S).tar.gz -C /data .'
docker compose start app
```

Không xóa volume `idosi_data`. Rollback code không thể tự phục hồi dữ liệu đã xóa;
việc phục hồi cần dùng bản sao lưu volume.
