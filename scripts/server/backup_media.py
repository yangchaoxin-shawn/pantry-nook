"""在只读媒体卷中制作归档，并逐文件校验归档正文。"""

from __future__ import annotations

import argparse
import hashlib
from pathlib import Path
import tarfile


def digest(stream) -> str:
    value = hashlib.sha256()
    for chunk in iter(lambda: stream.read(1024 * 1024), b""):
        value.update(chunk)
    return value.hexdigest()


def backup(source: Path, output: Path, manifest: Path) -> None:
    if output.exists() or manifest.exists():
        raise ValueError("备份路径已存在，不覆盖")
    staging = source / "staging"
    if staging.exists() and any(staging.iterdir()):
        raise ValueError("媒体 staging 非空，拒绝备份")
    expected = {}
    for path in sorted(source.rglob("*")):
        if path.is_symlink() or not (path.is_file() or path.is_dir()):
            raise ValueError("媒体目录含软链接或特殊文件")
        if path.is_file():
            name = path.relative_to(source).as_posix()
            if any(character in name for character in "\r\n\t"):
                raise ValueError("媒体文件名无法安全写入清单")
            with path.open("rb") as stream:
                expected[name] = (path.stat().st_size, digest(stream))
    with tarfile.open(output, "x:gz") as archive:
        archive.add(source, arcname=".", recursive=True)
    actual = {}
    with tarfile.open(output, "r:gz") as archive:
        for member in archive.getmembers():
            if member.isfile():
                with archive.extractfile(member) as stream:
                    actual[member.name.removeprefix("./")] = (member.size, digest(stream))
    if actual != expected:
        raise ValueError("媒体归档内容与卷内清单不一致")
    with manifest.open("x", encoding="utf-8", newline="\n") as stream:
        for name, (size, checksum) in expected.items():
            stream.write(f"{name}\t{size}\t{checksum}\n")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--manifest", type=Path, required=True)
    args = parser.parse_args()
    backup(args.source, args.output, args.manifest)
