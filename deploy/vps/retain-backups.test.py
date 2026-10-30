import hashlib
import importlib.util
import io
import os
import sqlite3
from pathlib import Path
import tarfile
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("retention", Path(__file__).with_name("retain-backups.py"))
retention = importlib.util.module_from_spec(spec)
spec.loader.exec_module(retention)


class RetentionTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name).resolve()
        self.addCleanup(self.temporary.cleanup)

    def archive(self, day, daily=False):
        directory = self.root / "daily" if daily else self.root
        directory.mkdir(exist_ok=True)
        prefix = "daily" if daily else "data"
        path = directory / f"idosi-{prefix}-202610{day:02}T000000Z.tar.gz"
        fixture = self.root / "fixture.sqlite"
        database = sqlite3.connect(fixture)
        try:
            database.execute("CREATE TABLE IF NOT EXISTS fixture (id INTEGER PRIMARY KEY)")
            database.execute("INSERT OR IGNORE INTO fixture VALUES (1)")
            database.commit()
        finally:
            database.close()
        with tarfile.open(path, "w:gz") as archive:
            data = fixture.read_bytes()
            info = tarfile.TarInfo("./idosi.sqlite")
            info.size = len(data)
            archive.addfile(info, io.BytesIO(data))
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        Path(str(path) + ".sha256").write_text(f"{digest}  {path.name}\n")
        return path

    def test_mixed_inventory_preserves_exact_two_newest_and_reports(self):
        paths = [self.archive(1), self.archive(2, daily=True), self.archive(3)]
        report = self.root / "deploy-history.env"
        report.write_text("STATUS=SUCCESS\n")
        unknown = self.root / "unrelated.tar.gz"
        unknown.write_bytes(b"keep")
        rows = retention.inventory(self.root)
        retention.retain(self.root, "inventory")
        self.assertTrue(all(path.exists() for path in paths))
        result = retention.retain(self.root, "apply", retention.manifest_hash(rows))
        self.assertEqual(result["count_after"], 2)
        self.assertFalse(paths[0].exists())
        self.assertFalse(Path(str(paths[0]) + ".sha256").exists())
        self.assertTrue(all(path.exists() for path in paths[1:] + [report, unknown]))
        retention.retain(self.root, "apply", retention.manifest_hash(retention.inventory(self.root)))

    def test_corrupt_database_inside_valid_archives_preserves_older_recovery_point(self):
        paths = [self.archive(day) for day in (1, 2, 3)]
        for path in paths[1:]:
            with tarfile.open(path, "w:gz") as archive:
                data = b"not a SQLite database"
                member = tarfile.TarInfo("./idosi.sqlite")
                member.size = len(data)
                archive.addfile(member, io.BytesIO(data))
            digest = hashlib.sha256(path.read_bytes()).hexdigest()
            Path(str(path) + ".sha256").write_text(f"{digest}  {path.name}\n")
        with self.assertRaises(sqlite3.DatabaseError):
            retention.retain(self.root, "apply", retention.manifest_hash(retention.inventory(self.root)))
        self.assertTrue(all(path.exists() for path in paths))

    def test_archived_wal_is_restored_for_integrity_verification(self):
        path = self.archive(1)
        fixture = self.root / "wal.sqlite"
        database = sqlite3.connect(fixture)
        try:
            database.execute("PRAGMA journal_mode=WAL")
            database.execute("PRAGMA wal_autocheckpoint=0")
            database.execute("CREATE TABLE wal_only (id INTEGER PRIMARY KEY)")
            database.commit()
            with tarfile.open(path, "w:gz") as archive:
                archive.add(fixture, arcname="./idosi.sqlite")
                archive.add(Path(str(fixture) + "-wal"), arcname="./idosi.sqlite-wal")
            digest = hashlib.sha256(path.read_bytes()).hexdigest()
            Path(str(path) + ".sha256").write_text(f"{digest}  {path.name}\n")
            self.assertEqual(retention.verify_archive(self.root, retention.inventory(self.root)[0]), digest)
        finally:
            database.close()

    def test_changed_manifest_or_missing_second_backup_never_deletes(self):
        self.archive(1)
        with self.assertRaises(ValueError):
            retention.retain(self.root, "apply", retention.manifest_hash(retention.inventory(self.root)))
        self.archive(2)
        with self.assertRaises(ValueError):
            retention.retain(self.root, "apply", "outdated")

    def test_invalid_retained_checksum_prevents_any_purge(self):
        paths = [self.archive(day) for day in (1, 2, 3)]
        paths[-1].write_bytes(b"damaged")
        with self.assertRaises(ValueError):
            retention.retain(self.root, "apply", retention.manifest_hash(retention.inventory(self.root)))
        self.assertTrue(all(path.exists() for path in paths))

    def test_deployment_report_checksum_supported(self):
        path = self.archive(1)
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        Path(str(path) + ".sha256").unlink()
        (self.root / "deploy-fixture.env").write_text(f"BACKUP_FILE={path}\nBACKUP_SHA256={digest}\n")
        self.assertEqual(retention.verify_archive(self.root, retention.inventory(self.root)[0]), digest)

    def test_unreadable_retained_archive_prevents_purge_even_with_matching_hash(self):
        paths = [self.archive(day) for day in (1, 2, 3)]
        paths[-1].write_bytes(b"not gzip")
        digest = hashlib.sha256(paths[-1].read_bytes()).hexdigest()
        Path(str(paths[-1]) + ".sha256").write_text(f"{digest}  {paths[-1].name}\n")
        with self.assertRaises(Exception):
            retention.retain(self.root, "apply", retention.manifest_hash(retention.inventory(self.root)))
        self.assertTrue(all(path.exists() for path in paths))

    def test_legacy_archive_names_are_inventoried_and_removed_without_touching_other_files(self):
        self.archive(2)
        self.archive(3)
        for name in ("idosi-data-before-release-20260821T050136Z.tar.gz",
                     "idosi-data-2026-08-21-before-release.tar.gz"):
            path = self.root / name
            path.write_bytes(b"obsolete archive")
            os.utime(path, (1787270400, 1787270400))
        unknown = self.root / "another-application.tar.gz"
        unknown.write_bytes(b"not an IDOSI backup")
        rows = retention.inventory(self.root)
        self.assertEqual(len(rows), 4)
        self.assertEqual([row["path"] for row in rows[:2]], [
            "idosi-data-20261003T000000Z.tar.gz", "idosi-data-20261002T000000Z.tar.gz"])
        result = retention.retain(self.root, "apply", retention.manifest_hash(rows))
        self.assertEqual(result["count_after"], 2)
        self.assertEqual(len(list(self.root.glob("idosi-data-*.tar.gz"))), 2)
        self.assertTrue(unknown.exists())

    def test_invalid_embedded_date_falls_back_to_filesystem_time(self):
        path = self.root / "idosi-data-20269999T990000Z.tar.gz"
        path.write_bytes(b"old archive")
        os.utime(path, (1787270400, 1787270400))
        row = retention.inventory(self.root)[0]
        self.assertEqual(row["timestamp"], "20260821T000000Z")


if __name__ == "__main__":
    unittest.main()
