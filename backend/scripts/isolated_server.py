"""创建全新的独立测试数据库并运行服务，绝不修改 .env 指向的业务库。

运行：uv run python scripts/isolated_server.py --port 3010
每次生成新数据库；停止服务后保留测试数据供核查，不自动清空或删除。
"""

from __future__ import annotations

import argparse
import asyncio
import os
import re
from pathlib import Path
import sys
from uuid import uuid4

import asyncpg
from dotenv import load_dotenv
import uvicorn

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
load_dotenv(ROOT / ".env")


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
    database = args.reuse_test_database or asyncio.run(prepare())
    os.environ["DB_NAME"] = database
    print(f"隔离数据库：{database}；端口：{args.port}；不含真实业务数据", flush=True)
    from app.main import app

    @app.middleware("http")
    async def isolated_marker(request, call_next):
        response = await call_next(request)
        if request.url.path == "/health":
            response.headers["X-Pantry-Nook-Test-Database"] = database
        return response

    uvicorn.run(app, host="127.0.0.1", port=args.port)
