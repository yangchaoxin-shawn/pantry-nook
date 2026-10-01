"""普通升级的离线制品检查；不连接 Docker、服务器或数据库。"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import os
import subprocess
import tarfile


RELEASE_PATTERN = r"[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?-[0-9]{8}T[0-9]{6}Z-[0-9a-f]{12}"


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def digest(path: Path) -> str:
    result = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            result.update(chunk)
    return result.hexdigest()


def archive_members(path: Path, kind: str, release: str) -> list[tarfile.TarInfo]:
    with tarfile.open(path, "r:gz") as archive:
        members = archive.getmembers()
    names = set()
    for member in members:
        name = PurePosixPath(member.name)
        require(not name.is_absolute() and ".." not in name.parts and "\\" not in member.name,
                "归档包含不安全路径")
        require(member.isfile() or member.isdir(), "归档只能包含普通文件和目录")
        normalized = name.as_posix()
        require(normalized not in names, "归档包含重复路径")
        names.add(normalized)
        require(not any(part.startswith(".env") or part in {".local", ".review", ".git", "uploads", "media"}
                        for part in name.parts), "归档包含配置或本地数据目录")
        if kind == "backend_source" and normalized != ".":
            require(name.parts[0] in {"backend", "scripts", "docker-compose.yml"}, "后端归档出现未约定的入口")
    if kind == "frontend":
        require("index.html" in names and any(name.startswith("assets/") for name in names), "前端产物不完整")
    elif kind == "backend_source":
        require({"docker-compose.yml", "backend/Dockerfile", "scripts/server-release-record.py"} <= names,
                "后端产物不完整")
    else:
        require(names == {f"pantry-nook-backend-image-{release}.tar"} and len(members) == 1,
                "镜像归档必须只有预期的 Docker tar")
    return members


def validate_manifest(path: Path, release: str, expected_sha: str) -> dict:
    require(re.fullmatch(RELEASE_PATTERN, release) is not None, "release ID 格式错误")
    require(re.fullmatch(r"[0-9a-f]{64}", expected_sha) is not None and digest(path) == expected_sha,
            "manifest SHA256 与本机记录不一致")
    data = json.loads(path.read_text(encoding="utf-8-sig"))
    require(data.get("manifest_version") == 1 and data.get("project") == "pantry-nook", "manifest 类型错误")
    require(data.get("release_id") == release and data.get("clean") is True, "manifest release/工作区状态错误")
    require(re.fullmatch(r"[0-9a-f]{40}", data.get("commit", "")) is not None, "完整 commit 错误")
    require(release.startswith(data["version"] + "-") and release.endswith("-" + data["commit"][:12]),
            "release 与版本/commit 不一致")
    require(data.get("local_preflight", {}).get("result") == "passed", "缺少本地预检通过记录")
    artifacts = data["artifacts"]
    require(set(artifacts) == {"frontend", "backend_source", "backend_image"}, "制品集合错误")
    expected_names = {
        "frontend": f"pantry-nook-frontend-{release}.tgz",
        "backend_source": f"pantry-nook-backend-{release}.tgz",
        "backend_image": f"pantry-nook-backend-image-{release}.tar.gz",
    }
    for kind, item in artifacts.items():
        require(item["file"] == expected_names[kind], "制品名与 release 不一致")
        artifact = path.parent / item["file"]
        require(artifact.is_file() and not artifact.is_symlink(), "制品缺失或为软链接")
        require(digest(artifact) == item["sha256"], "制品 SHA256 不一致")
        archive_members(artifact, kind, release)
    image = artifacts["backend_image"]
    require(re.fullmatch(r"[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}", image["tag"]) is not None, "镜像 tag 错误")
    require(image["tag"] == release.replace("+", "-build."), "镜像 tag 必须属于本次 release")
    require(image["image"] == "pantry-nook-backend:" + image["tag"], "镜像名错误")
    require(re.fullmatch(r"sha256:[0-9a-f]{64}", image["image_id"]) is not None, "镜像 ID 错误")
    require(image["platform"] in {"linux/amd64", "linux/arm64"}, "镜像架构错误")
    migrations = data["inputs"]["migrations"]
    require(len({row["file"] for row in migrations}) == len(migrations), "migration 重复")
    return data


def verify_staged(data: dict, backend: Path) -> None:
    require(digest(backend / "docker-compose.yml") == data["inputs"]["docker_compose_sha256"], "Compose 校验失败")
    require(digest(backend / "backend/uv.lock") == data["inputs"]["uv_lock_sha256"], "uv.lock 校验失败")
    actual = {}
    for path in (backend / "backend/migrations").glob("*.sql"):
        content = path.read_text(encoding="utf-8").replace("\r\n", "\n").replace("\r", "\n")
        actual[path.name] = hashlib.sha256(content.encode()).hexdigest()
    require(actual == {row["file"]: row["sha256"] for row in data["inputs"]["migrations"]}, "migration 制品校验失败")


def migrations(data: dict, before_path: Path, after_path: Path | None) -> None:
    def read(path: Path) -> dict:
        rows = {}
        for line in path.read_text(encoding="utf-8").splitlines():
            version, checksum, *_ = line.split("\t")
            require(version not in rows, "数据库 migration 重复")
            rows[version] = checksum
        require(bool(rows), "此入口不适用首次空库部署")
        return rows
    expected = {row["file"]: row["sha256"] for row in data["inputs"]["migrations"]}
    before = read(before_path)
    require(set(before) <= set(expected) and all(expected[key] == value for key, value in before.items()),
            "已有 migration 与候选不兼容")
    if after_path:
        require(read(after_path) == expected, "升级后 migration 与候选不一致")


def compose_check(backend: Path, tag: str) -> None:
    environment = dict(os.environ, PANTRY_BACKEND_IMAGE_TAG=tag)
    result = subprocess.run(
        ["docker", "compose", "--project-name", "pantry-nook", "--project-directory", str(backend),
         "--env-file", str(backend / ".env"), "-f", str(backend / "docker-compose.yml"),
         "config", "--format", "json"], env=environment, capture_output=True, text=True,
    )
    # config 内含密码；失败也只报告状态，不回显 stdout/stderr。
    require(result.returncode == 0, "Compose 配置检查失败；请在服务器检查必需键，不输出秘密")
    data = json.loads(result.stdout)
    require(set(data["services"]) == {"pantry-db", "pantry-backend"}, "此入口只处理既有两个服务")
    backend_config = data["services"]["pantry-backend"]
    db = data["services"]["pantry-db"]
    require(backend_config["container_name"] == "pantry-backend" and db["container_name"] == "pantry-db",
            "生产容器名与约定不一致")
    require(backend_config["image"] == "pantry-nook-backend:" + tag, "Compose 镜像与候选不一致")
    require(db["image"] == "postgres:16", "此入口不处理 PostgreSQL 版本变更")
    require(data["volumes"]["pantry-db-data"]["name"] == "pantry-db-data" and
            data["volumes"]["pantry-media-data"]["name"] == "pantry-media-data", "生产卷名发生变化")
    media_mounts = backend_config["volumes"]
    require(len(media_mounts) == 1 and media_mounts[0].get("type") == "volume" and
            media_mounts[0].get("source") == "pantry-media-data" and media_mounts[0].get("target") == "/data/media" and
            media_mounts[0].get("read_only", False) is False, "媒体挂载发生变化")
    db_mounts = [mount for mount in db["volumes"] if mount.get("target") == "/var/lib/postgresql/data"]
    require(len(db_mounts) == 1 and db_mounts[0].get("type") == "volume" and
            db_mounts[0].get("source") == "pantry-db-data", "数据库挂载发生变化")
    ports = backend_config["ports"]
    require(len(ports) == 1 and ports[0]["host_ip"] == "127.0.0.1" and
            str(ports[0]["published"]) == "8016" and str(ports[0]["target"]) == "3000",
            "后端端口发生变化")
    settings = backend_config["environment"]
    require(settings["APP_ENV"] == "production" and str(settings["PANTRY_ALLOW_TEST_DATA"]).lower() == "false",
            "生产环境不能启用测试写入")
    require(settings["MEDIA_ROOT"] == "/data/media" and settings["DB_HOST"] == "pantry-db" and
            settings["DB_NAME"] == "pantry_nook" and settings["DB_USER"] == "postgres" and
            str(settings["DB_PORT"]) == "5432" and str(settings["PORT"]) == "3000",
            "数据库或媒体配置发生变化")
    require(bool(settings["DB_PASSWORD"]) and settings["DB_PASSWORD"] == db["environment"]["POSTGRES_PASSWORD"],
            "后端和数据库口令配置不一致")
    require(settings["FRONTEND_ORIGIN"] == "https://system.aihuashen.com", "前端来源发生变化")


def previous_record(path: Path) -> None:
    rows = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        key, separator, value = line.partition("=")
        require(bool(separator) and key not in rows, "现有发布记录格式错误")
        rows[key] = value
    require(rows.get("record_version") == "2" and rows.get("status") == "verified", "仅接受已核验的 v2 媒体部署")
    require(rows.get("media_volume") == "pantry-media-data", "现有发布记录媒体卷错误")
    tag, image_id = rows.get("backend_image_tag", ""), rows.get("backend_image_id", "")
    require(re.fullmatch(r"[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}", tag) is not None and
            re.fullmatch(r"sha256:[0-9a-f]{64}", image_id) is not None, "现有发布镜像记录错误")
    print(tag + "\t" + image_id)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["verify", "stage-check", "migrations", "compose-check", "record"])
    parser.add_argument("--manifest", type=Path)
    parser.add_argument("--release-id")
    parser.add_argument("--manifest-sha256")
    parser.add_argument("--backend", type=Path)
    parser.add_argument("--before", type=Path)
    parser.add_argument("--after", type=Path)
    parser.add_argument("--tag")
    parser.add_argument("--record", type=Path)
    args = parser.parse_args()
    if args.command == "record":
        require(args.record is not None, "缺少发布记录")
        previous_record(args.record)
    elif args.command == "compose-check":
        require(args.backend is not None and bool(args.tag), "缺少 Compose 检查参数")
        compose_check(args.backend, args.tag)
    elif args.command == "verify":
        require(args.manifest is not None, "缺少 manifest")
        data = validate_manifest(args.manifest, args.release_id or "", args.manifest_sha256 or "")
        image = data["artifacts"]["backend_image"]
        print("\t".join((image["tag"], image["image_id"], image["platform"])))
    else:
        require(args.manifest is not None, "缺少 manifest")
        data = json.loads(args.manifest.read_text(encoding="utf-8-sig"))
        if args.command == "stage-check":
            require(args.backend is not None, "缺少后端 staging 路径")
            verify_staged(data, args.backend)
        else:
            require(args.before is not None, "缺少升级前 migration 记录")
            migrations(data, args.before, args.after)


if __name__ == "__main__":
    main()
