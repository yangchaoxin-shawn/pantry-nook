"""创建全新的独立测试数据库并运行服务，绝不修改 .env 指向的业务库。

运行：uv run python scripts/isolated_server.py --port 3010
每次生成新数据库；停止服务后保留测试数据供核查，不自动清空或删除。
端口上已在运行同一个复用的测试库时直接提示并退出；端口被占用时不新建测试库。
"""

from __future__ import annotations

import argparse
import asyncio
import os
import re
import socket
from pathlib import Path
import sys
from uuid import uuid4
from urllib.request import urlopen

import asyncpg
from dotenv import load_dotenv
import uvicorn

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
load_dotenv(ROOT / ".env")


def running_marker(port: int) -> str | None:
    """端口空闲返回 None；已有服务在听时返回它的隔离测试库标记，不是本项目的隔离服务则返回空串。"""
    with socket.socket() as probe:
        probe.settimeout(1)
        if probe.connect_ex(("127.0.0.1", port)) != 0:
            return None
    try:
        with urlopen(f"http://127.0.0.1:{port}/health", timeout=3) as response:
            return response.headers.get("X-Pantry-Nook-Test-Database", "")
    except OSError:
        return ""


async def prepare() -> str:
    from app.db import _db_config

    config = _db_config()
    # 标识符无法参数绑定，只允许程序内部生成的固定前缀 + UUID 十六进制。
    database = "pantry_nook_test_" + uuid4().hex
    config["database"] = "postgres"
    admin = await asyncpg.connect(**config)
    try:
        await admin.execute('CREATE DATABASE "' + database + '"')
    finally:
        await admin.close()
    config["database"] = database
    conn = await asyncpg.connect(**config)
    try:
        await conn.execute((ROOT / "app/db/schema.sql").read_text(encoding="utf-8"))
        # 用与容器完全相同的空库启动路径验证 schema 快照与 migration 的衔接。
        from app.migrations import migrate, register_current_schema_migrations
        await register_current_schema_migrations(conn)
        await migrate(conn)
    finally:
        await conn.close()
    return database


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=3010)
    parser.add_argument("--reuse-test-database", help="仅允许复用本脚本生成的 pantry_nook_test_<UUID> 库")
    args = parser.parse_args()
    if args.reuse_test_database and not re.fullmatch(r"pantry_nook_test_[0-9a-f]{32}", args.reuse_test_database):
        parser.error("只允许复用隔离测试数据库")
    # 先查端口：同一个测试库已在运行就不必重复启动；被占用时也不先建出一个没人用的空库。
    running = running_marker(args.port)
    if running is not None:
        if running and running == args.reuse_test_database:
            print(f"端口 {args.port} 上已在运行隔离测试库 {running}，无需重复启动。", flush=True)
            sys.exit(0)
        occupant = f"隔离测试库 {running} " if running else "其他服务"
        sys.exit(f"端口 {args.port} 已被{occupant}占用：请换一个端口，或先确认并停掉占用它的服务。")
    database = args.reuse_test_database or asyncio.run(prepare())
    os.environ["DB_NAME"] = database
    # 每个测试数据库绑定自己的媒体目录；不使用 .env 的共享媒体位置。
    media = ROOT.parent / '.review' / 'media-test' / database
    media.mkdir(parents=True, exist_ok=True)
    marker = media / '.pantry-test-database'
    if marker.exists() and marker.read_text(encoding='utf-8') != database:
        raise RuntimeError('测试媒体目录标记与数据库不一致')
    marker.write_text(database, encoding='utf-8')
    os.environ['MEDIA_ROOT'] = str(media.resolve())
    print(f"隔离数据库：{database}；端口：{args.port}；不含真实业务数据", flush=True)
    from app.main import app

    @app.middleware("http")
    async def isolated_marker(request, call_next):
        response = await call_next(request)
        if request.url.path == "/health":
            response.headers["X-Pantry-Nook-Test-Database"] = database
            response.headers['X-Pantry-Nook-Test-Media'] = database
        return response

    uvicorn.run(app, host="127.0.0.1", port=args.port)
