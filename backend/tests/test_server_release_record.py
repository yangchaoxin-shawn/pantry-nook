import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest


SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "server-release-record.py"
SPEC = importlib.util.spec_from_file_location("server_release_record", SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(MODULE)


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


class ServerReleaseRecordTests(unittest.TestCase):
    def prepare_args(self, folder: Path) -> argparse.Namespace:
        manifest = folder / "manifest.json"
        manifest.write_text(json.dumps({
            "release_id": "1.2.0-20260917T120000Z-0123456789ab",
            "version": "1.2.0",
            "commit": "0123456789abcdef0123456789abcdef01234567",
            "artifacts": {
                "frontend": {"sha256": "1" * 64},
                "backend_source": {"sha256": "2" * 64},
                "backend_image": {"sha256": "3" * 64, "tag": "1.2.0-test", "image_id": "sha256:" + "4" * 64},
            },
        }), encoding="utf-8")
        database = folder / "database.dump"
        media = folder / "media.tar.gz"
        media_manifest = folder / "media-manifest.tsv"
        database.write_bytes(b"database-backup")
        media.write_bytes(b"media-backup")
        media_manifest.write_text("assets/example/original\t12\t" + "5" * 64 + "\n", encoding="utf-8")
        database_sha = folder / "database.sha256"
        media_sha = folder / "media.sha256"
        manifest_sha = folder / "media-manifest.sha256"
        database_sha.write_text(f"{digest(database)}  {database.name}\n", encoding="utf-8")
        media_sha.write_text(f"{digest(media)}  {media.name}\n", encoding="utf-8")
        manifest_sha.write_text(f"{digest(media_manifest)}  {media_manifest.name}\n", encoding="utf-8")
        return argparse.Namespace(
            manifest=str(manifest), record=str(folder / "record.txt"),
            database_backup=str(database), database_backup_sha_file=str(database_sha),
            media_volume="pantry-media-data", media_backup=str(media), media_backup_sha_file=str(media_sha),
            media_manifest=str(media_manifest), media_manifest_sha_file=str(manifest_sha),
            backend_backup="/data/pantry-nook.bak.release", frontend_backup="/usr/local/nginx/html/pantry-nook.bak.release",
            nginx_backup="/usr/local/nginx/cert.d/preview.conf.bak.release",
            migrations_before="/records/migrations-before.tsv", migrations_after="/records/migrations-after.tsv",
        )

    def test_prepare_records_database_and_media_and_status_transitions(self):
        with tempfile.TemporaryDirectory() as temporary:
            args = self.prepare_args(Path(temporary))
            MODULE.prepare(args)
            values = MODULE.read_record(Path(args.record))
            self.assertEqual(values["record_version"], "2")
            self.assertEqual(values["status"], "prepared")
            self.assertEqual(values["media_volume"], "pantry-media-data")
            self.assertEqual(values["media_backup_sha256"], digest(Path(args.media_backup)))
            self.assertEqual(values["media_manifest_sha256"], digest(Path(args.media_manifest)))
            MODULE.set_status(argparse.Namespace(record=args.record, status="deploying"))
            MODULE.set_status(argparse.Namespace(record=args.record, status="verified"))
            self.assertEqual(MODULE.read_record(Path(args.record))["status"], "verified")

    def test_prepare_rejects_media_backup_hash_mismatch(self):
        with tempfile.TemporaryDirectory() as temporary:
            args = self.prepare_args(Path(temporary))
            Path(args.media_backup).write_bytes(b"changed")
            with self.assertRaisesRegex(ValueError, "media backup SHA256 mismatch"):
                MODULE.prepare(args)

    def test_prepare_rejects_media_manifest_hash_mismatch_and_invalid_volume(self):
        with tempfile.TemporaryDirectory() as temporary:
            args = self.prepare_args(Path(temporary))
            Path(args.media_manifest).write_text("changed\n", encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "media manifest SHA256 mismatch"):
                MODULE.prepare(args)
        with tempfile.TemporaryDirectory() as temporary:
            args = self.prepare_args(Path(temporary))
            args.media_volume = "invalid/volume"
            with self.assertRaisesRegex(ValueError, "invalid media volume"):
                MODULE.prepare(args)

    def test_read_keeps_version_one_records_compatible(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "record.txt"
            values = {key: "pending" for key in MODULE.REQUIRED_KEYS_V1}
            values["record_version"] = "1"
            values["status"] = "prepared"
            MODULE.write_record(path, values)
            self.assertEqual(MODULE.read_record(path), values)
            MODULE.set_status(argparse.Namespace(record=str(path), status="deploying"))
            updated = MODULE.read_record(path)
            self.assertEqual(updated["record_version"], "1")
            self.assertEqual(updated["status"], "deploying")
            self.assertNotIn("media_volume", updated)

    def test_unknown_record_version_is_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "record.txt"
            path.write_text("record_version=3\n", encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "unsupported release record version"):
                MODULE.read_record(path)


if __name__ == "__main__":
    unittest.main()
