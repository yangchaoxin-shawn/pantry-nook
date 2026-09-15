"""Create and update a deterministic, secret-free server release record."""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re


REQUIRED_KEYS = (
    "record_version",
    "status",
    "release_id",
    "version",
    "full_commit",
    "backend_image_tag",
    "backend_image_id",
    "frontend_artifact_sha256",
    "backend_source_artifact_sha256",
    "backend_image_artifact_sha256",
    "database_backup",
    "database_backup_sha256",
    "backend_backup",
    "frontend_backup",
    "nginx_backup",
    "migrations_before",
    "migrations_after",
    "local_manifest",
    "prepared_at_utc",
    "deployed_at_utc",
    "verified_at_utc",
)


def now_utc() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def assert_value(value: str, label: str) -> str:
    if not value or "\n" in value or "\r" in value or "=" in label:
        raise ValueError(f"invalid {label}")
    return value


def write_record(path: Path, values: dict[str, str]) -> None:
    if tuple(values) != REQUIRED_KEYS:
        raise ValueError("release record schema mismatch")
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text("".join(f"{key}={assert_value(value, key)}\n" for key, value in values.items()), encoding="utf-8")
    temporary.chmod(0o600)
    temporary.replace(path)


def read_record(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        key, separator, value = line.partition("=")
        if not separator or key in values:
            raise ValueError("invalid release record line")
        values[key] = value
    if tuple(values) != REQUIRED_KEYS:
        raise ValueError("release record schema mismatch")
    return values


def prepare(args: argparse.Namespace) -> None:
    manifest_path = Path(args.manifest).resolve()
    manifest = json.loads(manifest_path.read_text(encoding="utf-8-sig"))
    release_id = manifest["release_id"]
    if not re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?-[0-9]{8}T[0-9]{6}Z-[0-9a-f]{12}", release_id):
        raise ValueError("invalid release id")
    if not re.fullmatch(r"[0-9a-f]{40}", manifest["commit"]):
        raise ValueError("invalid commit")
    artifacts = manifest["artifacts"]
    backup = Path(args.database_backup).resolve()
    expected_backup_sha = Path(args.database_backup_sha_file).read_text(encoding="utf-8").split()[0]
    if not re.fullmatch(r"[0-9a-f]{64}", expected_backup_sha) or sha256(backup) != expected_backup_sha:
        raise ValueError("database backup SHA256 mismatch")
    values = {
        "record_version": "1",
        "status": "prepared",
        "release_id": release_id,
        "version": manifest["version"],
        "full_commit": manifest["commit"],
        "backend_image_tag": artifacts["backend_image"]["tag"],
        "backend_image_id": artifacts["backend_image"]["image_id"],
        "frontend_artifact_sha256": artifacts["frontend"]["sha256"],
        "backend_source_artifact_sha256": artifacts["backend_source"]["sha256"],
        "backend_image_artifact_sha256": artifacts["backend_image"]["sha256"],
        "database_backup": str(backup),
        "database_backup_sha256": expected_backup_sha,
        "backend_backup": args.backend_backup,
        "frontend_backup": args.frontend_backup,
        "nginx_backup": args.nginx_backup,
        "migrations_before": args.migrations_before,
        "migrations_after": args.migrations_after,
        "local_manifest": str(manifest_path),
        "prepared_at_utc": now_utc(),
        "deployed_at_utc": "pending",
        "verified_at_utc": "pending",
    }
    write_record(Path(args.record), values)


def set_status(args: argparse.Namespace) -> None:
    path = Path(args.record)
    values = read_record(path)
    current = values["status"]
    allowed = {("prepared", "deploying"), ("deploying", "verified")}
    if (current, args.status) not in allowed:
        raise ValueError(f"invalid status transition: {current} -> {args.status}")
    values["status"] = args.status
    if args.status == "deploying":
        values["deployed_at_utc"] = now_utc()
    else:
        values["verified_at_utc"] = now_utc()
    write_record(path, values)


def parser() -> argparse.ArgumentParser:
    root = argparse.ArgumentParser()
    commands = root.add_subparsers(dest="command", required=True)
    create = commands.add_parser("prepare")
    for name in (
        "manifest", "record", "database_backup", "database_backup_sha_file",
        "backend_backup", "frontend_backup", "nginx_backup",
        "migrations_before", "migrations_after",
    ):
        create.add_argument(f"--{name.replace('_', '-')}", required=True)
    create.set_defaults(run=prepare)
    update = commands.add_parser("set-status")
    update.add_argument("--record", required=True)
    update.add_argument("--status", choices=("deploying", "verified"), required=True)
    update.set_defaults(run=set_status)
    return root


if __name__ == "__main__":
    arguments = parser().parse_args()
    arguments.run(arguments)
