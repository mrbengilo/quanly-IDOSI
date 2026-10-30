#!/usr/bin/env python3
"""Inventory, then explicitly retain the two newest IDOSI backup archives."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import tarfile


ARCHIVE = re.compile(r"^idosi-(?:data|daily)-(\d{8}T\d{6}Z)(?:-[A-Za-z0-9._-]+)?\.tar\.gz(?:\.enc)?$")


def inventory(root):
    root = Path(root)
    if root.is_symlink() or root.resolve() != root.absolute() or not root.is_dir():
        raise ValueError("Backup root must be a real absolute directory")
    rows = []
    for directory in (root, root / "daily"):
        if directory.is_symlink():
            raise ValueError("Symlink backup directory refused")
        if not directory.exists():
            continue
        for path in directory.iterdir():
            match = ARCHIVE.fullmatch(path.name)
            if not match:
                continue
            info = path.lstat()
            if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
                raise ValueError("Non-regular or hardlinked archive refused")
            rows.append({"path": str(path.relative_to(root)), "timestamp": match[1],
                         "bytes": info.st_size, "mtime_ns": info.st_mtime_ns,
                         "inode": info.st_ino, "device": info.st_dev})
    return sorted(rows, key=lambda row: (row["timestamp"], row["path"]), reverse=True)


def manifest_hash(rows):
    return hashlib.sha256(json.dumps(rows, sort_keys=True).encode()).hexdigest()


def archive_checksum(root, path):
    sidecar = Path(str(path) + ".sha256")
    if sidecar.exists():
        if sidecar.is_symlink() or not sidecar.is_file():
            raise ValueError("Unsafe checksum sidecar")
        match = re.fullmatch(r"([0-9a-f]{64})\s+\*?([^\r\n]+)\s*", sidecar.read_text().strip())
        if not match or Path(match[2]).name != path.name:
            raise ValueError("Malformed archive checksum")
        return match[1]
    checksums = set()
    for report in root.glob("deploy-*.env"):
        if report.is_symlink() or not report.is_file():
            continue
        fields = dict(line.split("=", 1) for line in report.read_text().splitlines() if "=" in line)
        if fields.get("BACKUP_FILE") == str(path):
            checksums.add(fields.get("BACKUP_SHA256", ""))
    if len(checksums) != 1 or not re.fullmatch(r"[0-9a-f]{64}", next(iter(checksums), "")):
        raise ValueError("Retained archive has no unambiguous recorded checksum")
    return next(iter(checksums))


def verify_archive(root, row):
    path = root / row["path"]
    if path.name.endswith(".enc"):
        raise ValueError("Encrypted retained archive requires a separately verified restore")
    expected = archive_checksum(root, path)
    with path.open("rb") as stream:
        actual = hashlib.file_digest(stream, "sha256").hexdigest()
    if actual != expected:
        raise ValueError("Retained archive checksum mismatch")
    subprocess.run(["gzip", "-t", "--", str(path)], check=True)
    with tarfile.open(path, "r:gz") as archive:
        if not any(member.name.removeprefix("./") == "idosi.sqlite" and member.isfile()
                   and member.size > 0 for member in archive):
            raise ValueError("Retained archive has no SQLite database")
    return actual


def retain(root, mode, expected_manifest=""):
    root = Path(root)
    rows = inventory(root)
    digest = manifest_hash(rows)
    result = {"mode": mode, "manifest": digest, "count_before": len(rows),
              "keep": rows[:2], "delete": rows[2:], "deleted_bytes": 0}
    print(json.dumps(result), flush=True)
    if mode == "inventory":
        return result
    if mode != "apply" or expected_manifest != digest or len(rows) < 2:
        raise ValueError("Apply requires the exact inventory manifest and at least two backups")
    # Validate both recovery points before deleting any file.
    for row in rows[:2]:
        print(json.dumps({"verified": row["path"], "sha256": verify_archive(root, row)}), flush=True)
    if inventory(root) != rows:
        raise ValueError("Backup inventory changed during verification")
    for row in rows[2:]:
        path = root / row["path"]
        sidecar = Path(str(path) + ".sha256")
        if sidecar.is_symlink() or (sidecar.exists() and not sidecar.is_file()):
            raise ValueError("Unsafe obsolete checksum sidecar")
    for row in rows[2:]:
        path = root / row["path"]
        path.unlink()
        Path(str(path) + ".sha256").unlink(missing_ok=True)
        result["deleted_bytes"] += row["bytes"]
        print(json.dumps({"deleted": row["path"], "bytes": row["bytes"]}), flush=True)
    remaining = inventory(root)
    if remaining != rows[:2]:
        raise ValueError("Post-purge inventory does not match the retained pair")
    result.update(count_after=len(remaining), status="SUCCESS")
    print(json.dumps(result), flush=True)
    return result


def main():
    import fcntl  # Linux VPS only; pure inventory/validation can be tested elsewhere.
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=["inventory", "apply"])
    parser.add_argument("manifest", nargs="?", default="")
    args = parser.parse_args()
    # Match backup-daily.sh lock order and serialize with all deployment paths.
    locks = []
    for name in ("/tmp/idosi-daily-backup.lock", "/tmp/idosi-production-deploy.lock"):
        descriptor = os.open(name, os.O_CREAT | os.O_WRONLY | os.O_NOFOLLOW, 0o600)
        locks.append(descriptor)
        fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
    retain(Path("/opt/idosi/deploy/vps/backups"), args.mode, args.manifest)
    subprocess.run(["df", "-h", "/"], check=True)
    subprocess.run(["free", "-h"], check=True)


if __name__ == "__main__":
    main()
