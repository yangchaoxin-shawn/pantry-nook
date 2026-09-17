"""离线测试：只使用临时目录和 Bash 假命令，不调用真实 Docker/SSH。"""

from __future__ import annotations

import hashlib
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import tarfile
import tempfile
import unittest

import backup_media
import release_checks


ROOT = Path(__file__).resolve().parent
BASH = os.environ.get("PANTRY_TEST_BASH") or (
    r"C:\Program Files\Git\bin\bash.exe" if os.name == "nt" else shutil.which("bash")
)
RELEASE = "1.2.1-20260917T120000Z-" + "a" * 12


class ArtifactChecks(unittest.TestCase):
    def test_unsafe_archive_members_are_rejected(self):
        for name, member_type in [("../../etc/passwd", tarfile.REGTYPE), ("/etc/passwd", tarfile.REGTYPE),
                                  ("backend/file", tarfile.SYMTYPE), ("backend/.env", tarfile.REGTYPE),
                                  ("backend/uploads/photo.jpg", tarfile.REGTYPE)]:
            with self.subTest(name=name), tempfile.TemporaryDirectory(prefix="pantry-script-test-") as directory:
                archive_path = Path(directory) / "bad.tgz"
                with tarfile.open(archive_path, "w:gz") as archive:
                    member = tarfile.TarInfo(name)
                    member.type = member_type
                    archive.addfile(member, io.BytesIO())
                with self.assertRaises(ValueError):
                    release_checks.archive_members(archive_path, "backend_source", RELEASE)

    def test_duplicate_archive_member_is_rejected(self):
        with tempfile.TemporaryDirectory(prefix="pantry-script-test-") as directory:
            path = Path(directory) / "bad.tgz"
            with tarfile.open(path, "w:gz") as archive:
                for _ in range(2):
                    archive.addfile(tarfile.TarInfo("backend/file"), io.BytesIO())
            with self.assertRaisesRegex(ValueError, "重复"):
                release_checks.archive_members(path, "backend_source", RELEASE)

    def test_manifest_and_three_artifact_hashes(self):
        with tempfile.TemporaryDirectory(prefix="pantry-script-test-") as directory:
            directory = Path(directory)
            artifacts = {}
            entries = {
                "frontend": (f"pantry-nook-frontend-{RELEASE}.tgz", ["index.html", "assets/main.js"]),
                "backend_source": (f"pantry-nook-backend-{RELEASE}.tgz", ["docker-compose.yml", "backend/Dockerfile", "scripts/server-release-record.py"]),
                "backend_image": (f"pantry-nook-backend-image-{RELEASE}.tar.gz", [f"pantry-nook-backend-image-{RELEASE}.tar"]),
            }
            for kind, (filename, names) in entries.items():
                path = directory / filename
                with tarfile.open(path, "w:gz") as archive:
                    for name in names:
                        archive.addfile(tarfile.TarInfo(name), io.BytesIO())
                artifacts[kind] = {"file": filename, "sha256": release_checks.digest(path)}
            artifacts["backend_image"].update(tag=RELEASE, image="pantry-nook-backend:" + RELEASE,
                                              image_id="sha256:" + "b" * 64, platform="linux/amd64")
            manifest = dict(manifest_version=1, project="pantry-nook", clean=True, commit="a" * 40,
                            version="1.2.1", release_id=RELEASE, artifacts=artifacts,
                            local_preflight={"result": "passed"}, inputs={"migrations": []})
            path = directory / "manifest.json"
            path.write_text(json.dumps(manifest), encoding="utf-8")
            checksum = release_checks.digest(path)
            self.assertEqual(release_checks.validate_manifest(path, RELEASE, checksum)["commit"], "a" * 40)
            with self.assertRaisesRegex(ValueError, "manifest SHA"):
                release_checks.validate_manifest(path, RELEASE, "0" * 64)
            (directory / entries["frontend"][0]).write_bytes(b"tampered")
            with self.assertRaisesRegex(ValueError, "制品 SHA"):
                release_checks.validate_manifest(path, RELEASE, checksum)

    def test_migration_checks_before_and_after(self):
        with tempfile.TemporaryDirectory(prefix="pantry-script-test-") as directory:
            before, after = Path(directory) / "before", Path(directory) / "after"
            data = {"inputs": {"migrations": [{"file": "001.sql", "sha256": "a"}, {"file": "002.sql", "sha256": "b"}]}}
            before.write_text("001.sql\ta\ttime\n", encoding="utf-8")
            after.write_text("001.sql\ta\ttime\n002.sql\tb\ttime\n", encoding="utf-8")
            release_checks.migrations(data, before, after)
            before.write_text("001.sql\tchanged\ttime\n", encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "不兼容"):
                release_checks.migrations(data, before, after)


class MediaBackupChecks(unittest.TestCase):
    def test_empty_and_populated_media_backups(self):
        for populated in [False, True]:
            with self.subTest(populated=populated), tempfile.TemporaryDirectory(prefix="pantry-script-test-") as directory:
                root = Path(directory)
                source = root / "source"
                source.mkdir()
                if populated:
                    (source / "original").mkdir()
                    (source / "original/photo.jpg").write_bytes(b"original bytes")
                backup_media.backup(source, root / "media.tgz", root / "media.tsv")
                manifest = (root / "media.tsv").read_text(encoding="utf-8")
                self.assertEqual(bool(manifest), populated)
                if populated:
                    self.assertIn(hashlib.sha256(b"original bytes").hexdigest(), manifest)
                with self.assertRaisesRegex(ValueError, "不覆盖"):
                    backup_media.backup(source, root / "media.tgz", root / "media.tsv")

    def test_staging_blocks_backup(self):
        with tempfile.TemporaryDirectory(prefix="pantry-script-test-") as directory:
            root = Path(directory)
            (root / "source/staging").mkdir(parents=True)
            (root / "source/staging/in-progress").write_bytes(b"partial")
            with self.assertRaisesRegex(ValueError, "staging"):
                backup_media.backup(root / "source", root / "media.tgz", root / "media.tsv")
            self.assertFalse((root / "media.tgz").exists())


# 真实执行 release.sh 的状态机与目录切换函数。外部服务全部替换为 Bash 函数；
# 不调用 check_candidate，因它的职责是生产只读检查，需要真实 Linux/Docker 环境。
HARNESS = r'''
source "$1/release.sh"
root=$(cd "$2" && pwd -P)
case_name=$3
BACKEND_DIR="$root/backend" FRONTEND_DIR="$root/frontend"
BACKEND_STAGE="$root/backend.stage" FRONTEND_STAGE="$root/frontend.stage"
BACKEND_BACKUP="$root/backend.backup" FRONTEND_BACKUP="$root/frontend.backup"
FAILED_BACKEND="$root/backend.failed" FAILED_FRONTEND="$root/frontend.failed"
RECORD_DIR="$root/record" MANIFEST="$root/manifest" CHECKS=checks
OLD_TAG=old OLD_IMAGE=old-image IMAGE_TAG=new IMAGE_ID=new-image
NGINX_CONF="$root/nginx.conf" NGINX_BACKUP="$root/nginx.backup" NGINX_SHA=constant NGINX_BIN=fake_nginx
mkdir "$BACKEND_DIR" "$FRONTEND_DIR" "$RECORD_DIR"
printf old > "$BACKEND_DIR/marker"
printf old > "$FRONTEND_DIR/marker"
printf nginx > "$NGINX_CONF"
printf nginx > "$NGINX_BACKUP"
move_count=0
event() { printf '%s\n' "$*" >> "$root/events"; }
docker() {
  event "docker $*"
  case "$1" in
    stop) [[ $case_name != stop_fail ]] ;;
    start) [[ $case_name != restore_fail ]] ;;
    container)
      [[ $case_name != daemon_down ]] || return 93
      if [[ $case_name != startup_missing ]]; then printf 'fake-container\n'; fi ;;
    inspect)
      case "$*" in
        *State.Status*) printf 'exited\n' ;;
        *Mounts*) printf 'volume:pantry-media-data\n' ;;
        *) return 91 ;;
      esac ;;
    *) return 92 ;;
  esac
}
compose_at() {
  event "compose $*"
  [[ $2 != new || ( $case_name != startup_fail && $case_name != startup_missing && $case_name != daemon_down ) ]]
}
wait_healthy() {
  event "health $1"
  [[ $1 != new-image || $case_name != health_fail ]]
}
prepare_candidate() {
  event prepare
  [[ $case_name != prepare_fail ]] || return 31
  mkdir "$BACKEND_STAGE" "$FRONTEND_STAGE"
  printf new > "$BACKEND_STAGE/marker"
  printf new > "$FRONTEND_STAGE/marker"
}
backup_state() {
  event backup
  [[ $case_name != backup_fail && $case_name != restore_fail ]] || return 32
  printf 'status=deploying\n' > "$RECORD_DIR/deployed-release.txt"
}
mv() {
  move_count=$((move_count + 1))
  event "move $move_count $*"
  [[ $case_name != "move_${move_count}_fail" ]] || return 33
  command mv "$@"
  if [[ $case_name == "move_${move_count}_term" ]]; then kill -TERM "$BASHPID"; fi
}
database() { event database; printf '001.sql\ta\ttime\n'; }
python3() { event "python $*"; [[ $case_name != migration_fail ]]; }
checksum() { printf 'constant\n'; }
fake_nginx() { event nginx; [[ $case_name != nginx_fail ]]; }
apply_candidate
'''


@unittest.skipUnless(BASH and Path(BASH).exists(), "需要 Git Bash 或 Linux Bash；设置 PANTRY_TEST_BASH")
class MaintenanceRecoveryChecks(unittest.TestCase):
    def run_scenario(self, scenario: str):
        directory = tempfile.TemporaryDirectory(prefix="pantry-release-fake-")
        self.addCleanup(directory.cleanup)
        result = subprocess.run(
            [BASH, "--noprofile", "--norc", "-c", HARNESS, "test", ROOT.as_posix(), Path(directory.name).as_posix(), scenario],
            capture_output=True, text=True, encoding="utf-8", timeout=15,
        )
        return Path(directory.name), result

    def test_success_keeps_old_backups_and_requires_public_verification(self):
        root, result = self.run_scenario("success")
        self.assertEqual(result.returncode, 0, result.stderr)
        for name in ["backend", "frontend"]:
            self.assertEqual((root / name / "marker").read_text(), "new")
            self.assertEqual((root / (name + ".backup") / "marker").read_text(), "old")
        self.assertEqual((root / "record/execution-state.txt").read_text().strip(), "awaiting_public_verification")
        self.assertEqual((root / "record/deployed-release.txt").read_text().strip(), "status=deploying")

    def test_preparation_failure_does_not_stop_old_service(self):
        root, result = self.run_scenario("prepare_fail")
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn("docker stop", (root / "events").read_text())
        self.assertEqual((root / "backend/marker").read_text(), "old")

    def test_failures_and_signals_restore_old_code(self):
        scenarios = ["stop_fail", "backup_fail", "startup_fail", "startup_missing", "health_fail", "migration_fail", "nginx_fail"]
        scenarios += [f"move_{index}_fail" for index in range(1, 5)]
        scenarios += [f"move_{index}_term" for index in range(1, 5)]
        for scenario in scenarios:
            with self.subTest(scenario=scenario):
                root, result = self.run_scenario(scenario)
                self.assertNotEqual(result.returncode, 0, result.stdout)
                for name in ["backend", "frontend"]:
                    self.assertEqual((root / name / "marker").read_text(), "old", result.stderr)
                self.assertEqual((root / "record/execution-state.txt").read_text().strip(), "recovered_previous", result.stderr)
                events = (root / "events").read_text()
                self.assertIn("health old-image", events)
                for forbidden in [" down", "volume rm", "pg_restore", "truncate"]:
                    self.assertNotIn(forbidden, events)

    def test_failed_recovery_is_explicit_and_keeps_original_failure(self):
        root, result = self.run_scenario("restore_fail")
        self.assertEqual(result.returncode, 32)
        self.assertEqual((root / "record/execution-state.txt").read_text().strip(), "RECOVERY_FAILED")

    def test_unreachable_docker_does_not_guess_running_container_state(self):
        root, result = self.run_scenario("daemon_down")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual((root / "record/execution-state.txt").read_text().strip(), "RECOVERY_FAILED")
        self.assertEqual((root / "backend/marker").read_text(), "new")
        self.assertEqual((root / "backend.backup/marker").read_text(), "old")

    def test_entrypoint_without_parameters_has_no_actions(self):
        result = subprocess.run([BASH, "--noprofile", "--norc", ROOT.joinpath("release.sh").as_posix()],
                                capture_output=True, text=True, encoding="utf-8", timeout=10)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("--check", result.stdout)


if __name__ == "__main__":
    unittest.main(verbosity=2)
