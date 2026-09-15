"""清空所有数据表（仅清数据，保留 schema），用于开发测试环境重置。

按外键依赖逆序 TRUNCATE。密码从 .env 读取，不落命令行。
仅允许显式标记的隔离测试库。用法：
  $env:APP_ENV='test'
  $env:PANTRY_ALLOW_TEST_DATA='true'
  uv run python scripts/reset_data.py --yes
"""

from __future__ import annotations

import asyncio
import os
import sys
import re

import asyncpg
from dotenv import load_dotenv

load_dotenv()

# 只包含业务测试数据，刻意保留 schema_migrations，避免下一次启动重复执行迁移。
# 顺序遵循当前外键依赖的子表到父表。新增业务表而未加入这里时，TRUNCATE 会失败，
# 不会悄悄留下部分测试数据。
TABLES = [
    "inventory_adjustments",
    "consumptions",
    "daily_battle_preparations",
    "daily_battle_dishes",
    "daily_battles",
    "meal_plan_dishes",
    "meal_plans",
    "ingredients",
    "dishes",
]

TEST_DATABASE_PATTERN = re.compile(r"^pantry_nook_test_[0-9a-f]{32}$")


def assert_test_data_target() -> None:
    """双重校验环境与库名，避免开发脚本误指向正式库。"""
    app_env = os.getenv("APP_ENV", "").strip().lower()
    allowed = os.getenv("PANTRY_ALLOW_TEST_DATA", "").strip().lower() == "true"
    database = os.getenv("DB_NAME", "pantry_nook").strip()
    if app_env not in {"development", "test", "demo"}:
        raise RuntimeError("仅 development/test/demo 环境允许重置测试数据")
    if not allowed:
        raise RuntimeError("PANTRY_ALLOW_TEST_DATA 必须显式设为 true")
    if TEST_DATABASE_PATTERN.fullmatch(database) is None:
        raise RuntimeError(f"数据库 {database!r} 没有隔离测试标记，拒绝清空")


async def main() -> None:
    if "--yes" not in sys.argv:
        print("此操作会清空全部开发数据。如需执行，请加 --yes")
        return

    assert_test_data_target()

    conn = await asyncpg.connect(
        host=os.getenv("DB_HOST", "localhost"),
        port=int(os.getenv("DB_PORT", "5432")),
        database=os.getenv("DB_NAME", "pantry_nook"),
        user=os.getenv("DB_USER", "postgres"),
        password=os.getenv("DB_PASSWORD", ""),
    )
    try:
        await conn.execute(f'TRUNCATE TABLE {", ".join(TABLES)} RESTART IDENTITY')
        print("已清空全部业务测试数据，已保留表结构和 migration 记录")
    finally:
        await conn.close()


if __name__ == "__main__":
    asyncio.run(main())
