"""初始化数据库：创建 pantry_nook 数据库（如不存在）、清理旧表、导入 schema。

用法：uv run python scripts/init_db.py
"""

from __future__ import annotations

import os
import re
from pathlib import Path

import asyncpg
from dotenv import load_dotenv

load_dotenv()

SCHEMA_PATH = Path(__file__).resolve().parent.parent / "app" / "db" / "schema.sql"


def _admin_config() -> dict:
    return {
        "host": os.getenv("DB_HOST", "localhost"),
        "port": int(os.getenv("DB_PORT", "5432")),
        "user": os.getenv("DB_USER", "postgres"),
        "password": os.getenv("DB_PASSWORD", ""),
    }


async def main() -> None:
    config = _admin_config()
    database = os.getenv("DB_NAME", "pantry_nook")
    if not re.fullmatch(r"[a-zA-Z_][a-zA-Z0-9_]{0,62}", database):
        raise RuntimeError("DB_NAME 必须是最多 63 位的字母、数字或下划线标识符")

    admin = await asyncpg.connect(**config, database="postgres")
    try:
        exists = await admin.fetchval("SELECT 1 FROM pg_database WHERE datname = $1", os.getenv("DB_NAME", "pantry_nook"))
        if not exists:
            # PostgreSQL 不支持数据库标识符参数绑定，以上白名单后再引用标识符。
            await admin.execute('CREATE DATABASE "' + database + '"')
            print(f"已创建数据库 {os.getenv('DB_NAME', 'pantry_nook')}")
        else:
            print(f"数据库 {os.getenv('DB_NAME', 'pantry_nook')} 已存在")
    finally:
        await admin.close()

    db = await asyncpg.connect(**config, database=os.getenv("DB_NAME", "pantry_nook"))
    try:
        async with db.transaction():
            # 检测并清理旧表，避免覆盖含数据的历史结构
            legacy_tables = ["meal_records", "recommended_dishes", "consumptions"]
            existing = await db.fetch(
                """SELECT table_name
                   FROM information_schema.tables
                   WHERE table_schema = 'public'
                     AND table_name = ANY($1::text[])""",
                legacy_tables,
            )
            existing_tables = {r["table_name"] for r in existing}
            old_record_tables = [t for t in existing_tables if t in ("meal_records", "recommended_dishes")]
            has_legacy_consumptions = False
            if "consumptions" in existing_tables:
                col = await db.fetchval(
                    """SELECT 1
                       FROM information_schema.columns
                       WHERE table_schema = 'public'
                         AND table_name = 'consumptions'
                         AND column_name = 'daily_battle_id'"""
                )
                has_legacy_consumptions = col is None

            tables_to_check = list(old_record_tables)
            if has_legacy_consumptions:
                tables_to_check.append("consumptions")
            if tables_to_check:
                for table in tables_to_check:
                    count = await db.fetchval(f"SELECT COUNT(*)::int FROM {table}")
                    if count > 0:
                        raise RuntimeError(
                            f"检测到旧表 {table} 中已有数据，未自动删除。请先备份并手动迁移数据。"
                        )
                if has_legacy_consumptions:
                    await db.execute("DROP TABLE consumptions")
                for table in old_record_tables:
                    await db.execute(f"DROP TABLE {table}")

            schema = SCHEMA_PATH.read_text(encoding="utf-8")
            await db.execute(schema)
            import sys
            sys.path.insert(0, str(SCHEMA_PATH.parents[2]))
            from app.migrations import migrate, register_current_schema_migrations
            await register_current_schema_migrations(db)
            await migrate(db)
        print("已导入表结构")
    finally:
        await db.close()

    print("完成")


if __name__ == "__main__":
    import asyncio

    try:
        asyncio.run(main())
    except Exception as err:  # noqa: BLE001
        print(str(err))
        raise SystemExit(1)
