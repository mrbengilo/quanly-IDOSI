#!/usr/bin/env bash
# Exercises backup-daily.sh against a fake docker CLI: archive layout,
# encryption, retention and the deployment-lock skip.
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="$ROOT_DIR/deploy/vps/backup-daily.sh"
bash -n "$SCRIPT"

TEST_DIR="$(mktemp -d)"
trap 'rm -rf -- "$TEST_DIR"' EXIT
export IDOSI_ROOT="$TEST_DIR/idosi"
export IDOSI_BACKUP_DIR="$TEST_DIR/backups"
export IDOSI_DEPLOY_LOCK="$TEST_DIR/deploy.lock"
export IDOSI_BACKUP_LOCK="$TEST_DIR/backup.lock"
export FAKE_CONTAINER_ROOT="$TEST_DIR/container"
mkdir -p "$IDOSI_ROOT/deploy/vps" "$FAKE_CONTAINER_ROOT/app/data/identity-images/E1/front" "$TEST_DIR/bin"
printf 'services: {}\n' > "$IDOSI_ROOT/deploy/vps/compose.yml"
printf 'cccd-front' > "$FAKE_CONTAINER_ROOT/app/data/identity-images/E1/front/image.jpg"

cat > "$TEST_DIR/bin/docker" <<'FAKE'
#!/usr/bin/env bash
set -Eeuo pipefail
map() { printf '%s%s' "$FAKE_CONTAINER_ROOT" "$1"; }
if [[ "$1" == 'compose' ]]; then
  shift 3 # compose -f compose.yml
  case "$1" in
    ps) printf 'fakecontainer\n' ;;
    exec)
      shift 3 # exec -T app
      case "$1" in
        node) mkdir -p "$(dirname "$(map "$3")")"; printf 'SQLite format 3 snapshot' > "$(map "$3")"; printf '{"status":"ok"}\n' ;;
        test) [[ -d "$(map "$3")" ]] ;;
        rm) rm -f -- "$(map "$4")" ;;
        *) exit 97 ;;
      esac
      ;;
    *) exit 98 ;;
  esac
elif [[ "$1" == 'inspect' ]]; then
  printf 'true\n'
elif [[ "$1" == 'cp' ]]; then
  cp -R "$(map "${2#fakecontainer:}")" "$3"
else
  exit 99
fi
FAKE
chmod +x "$TEST_DIR/bin/docker"
export PATH="$TEST_DIR/bin:$PATH"

fail() { printf 'backup-daily test failed: %s\n' "$*" >&2; exit 1; }

# 1. Plain archive keeps the data-volume layout and a matching checksum.
bash "$SCRIPT" >/dev/null
mapfile -t archives < <(ls -1 "$IDOSI_BACKUP_DIR/daily" | grep -E '^idosi-daily-.*\.tar\.gz$')
[[ ${#archives[@]} -eq 1 ]] || fail 'expected one archive'
tar -tzf "$IDOSI_BACKUP_DIR/daily/${archives[0]}" | grep -qx './idosi.sqlite' || fail 'missing idosi.sqlite'
tar -tzf "$IDOSI_BACKUP_DIR/daily/${archives[0]}" | grep -q 'identity-images/E1/front/image.jpg' || fail 'missing images'
(cd "$IDOSI_BACKUP_DIR/daily" && sha256sum -c "${archives[0]}.sha256" >/dev/null) || fail 'checksum mismatch'
[[ ! -e "$FAKE_CONTAINER_ROOT/app/data/.online-backup/"*.sqlite ]] || fail 'snapshot left inside container'

# 2. Retention keeps the newest N daily archives and never touches other files.
for day in 01 02 03 04 05; do
  touch "$IDOSI_BACKUP_DIR/daily/idosi-daily-202601${day}T000000Z.tar.gz"
  touch "$IDOSI_BACKUP_DIR/daily/idosi-daily-202601${day}T000000Z.tar.gz.sha256"
done
touch "$IDOSI_BACKUP_DIR/idosi-data-20260101T000000Z-before-abcdef123456.tar.gz"
sleep 1
IDOSI_BACKUP_KEEP_DAILY=3 bash "$SCRIPT" >/dev/null
remaining="$(ls -1 "$IDOSI_BACKUP_DIR/daily" | grep -cE '^idosi-daily-.*\.tar\.gz$')"
[[ "$remaining" -eq 3 ]] || fail "retention kept $remaining archives"
[[ -e "$IDOSI_BACKUP_DIR/daily/idosi-daily-20260105T000000Z.tar.gz" ]] || fail 'newest old archive pruned'
[[ ! -e "$IDOSI_BACKUP_DIR/daily/idosi-daily-20260104T000000Z.tar.gz" ]] || fail 'old archive not pruned'
[[ ! -e "$IDOSI_BACKUP_DIR/daily/idosi-daily-20260104T000000Z.tar.gz.sha256" ]] || fail 'old checksum not pruned'
[[ -e "$IDOSI_BACKUP_DIR/idosi-data-20260101T000000Z-before-abcdef123456.tar.gz" ]] || fail 'deploy backup touched'

# 3. Encryption leaves only the encrypted archive, which decrypts to the volume layout.
printf 'test-backup-passphrase-0123456789' > "$TEST_DIR/key"
sleep 1
IDOSI_BACKUP_ENCRYPTION_KEY_FILE="$TEST_DIR/key" bash "$SCRIPT" >/dev/null
encrypted="$(ls -1 "$IDOSI_BACKUP_DIR/daily" | grep -E '\.tar\.gz\.enc$' | head -n 1)"
[[ -n "$encrypted" ]] || fail 'no encrypted archive'
[[ ! -e "$IDOSI_BACKUP_DIR/daily/${encrypted%.enc}" ]] || fail 'plaintext archive kept next to encrypted one'
openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -pass "file:$TEST_DIR/key" -in "$IDOSI_BACKUP_DIR/daily/$encrypted" \
  | tar -tz | grep -qx './idosi.sqlite' || fail 'encrypted archive does not decrypt'

# 4. A running deployment makes the backup skip cleanly.
before="$(ls -1 "$IDOSI_BACKUP_DIR/daily" | wc -l)"
(
  exec 9>"$IDOSI_DEPLOY_LOCK"
  flock 9
  bash "$SCRIPT" | grep -q 'bỏ qua backup' || fail 'did not skip during deployment'
)
[[ "$(ls -1 "$IDOSI_BACKUP_DIR/daily" | wc -l)" -eq "$before" ]] || fail 'backup ran during deployment'

printf 'backup-daily tests passed\n'
