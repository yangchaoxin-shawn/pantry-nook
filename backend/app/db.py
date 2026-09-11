"""数据库连接池与类型序列化。

API 对外行为：
- DATE 型字段对外始终是 'YYYY-MM-DD' 字符串，避免时区偏移。
- NUMERIC(12,3) 型字段对外是 float(number)，当前业务数量处于 JS 安全整数范围。
- BIGINT(id) 对外是 int。
所有值在写入响应前经 jsonable() 统一转成 JSON 安全类型。
"""

from __future__ import annotations

import json
import os
import asyncio
from datetime import date, datetime
from decimal import Decimal

import asyncpg
from dotenv import load_dotenv

load_dotenv()

_pool: asyncpg.Pool | None = None
_pool_lock = asyncio.Lock()


def _db_config() -> dict:
    return {
        "host": os.getenv("DB_HOST", "localhost"),
        "port": int(os.getenv("DB_PORT", "5432")),
        "database": os.getenv("DB_NAME", "pantry_nook"),
        "user": os.getenv("DB_USER", "postgres"),
        "password": os.getenv("DB_PASSWORD", ""),
    }


async def get_pool() -> asyncpg.Pool:
    """惰性创建连接池（单例）。"""
    global _pool
    if _pool is None:
        async with _pool_lock:
            if _pool is None:
                _pool = await asyncpg.create_pool(**_db_config(), min_size=1, max_size=10, init=_init_connection)
    return _pool


async def close_pool() -> None:
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None


async def _init_connection(conn) -> None:
    # 仅解码 PostgreSQL JSON 类型；名称、数量原文即使形似 JSON 也保持文本。
    for typename in ("json", "jsonb"):
        await conn.set_type_codec(typename, schema="pg_catalog", encoder=json.dumps, decoder=json.loads)


async def lock_inventory_workflow(conn) -> None:
    """仅在写事务内短暂串行化库存和菜单状态变更；用户备餐、核对期间不持锁。"""
    await conn.execute("SELECT pg_advisory_xact_lock($1)", 726140901)


def jsonable(value):
    """把 asyncpg 返回的数据库值转成 JSON 安全类型。

    - asyncpg.Record / dict / list: 递归处理
    - date -> 'YYYY-MM-DD'
    - datetime -> ISO 字符串；Decimal -> float
    - uuid 等其他类型回退到 str
    """
    if value is None or isinstance(value, (bool, int, float)):
        return value
    if isinstance(value, str):
        return value
    if isinstance(value, date) and not isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, asyncpg.Record):
        return {k: jsonable(v) for k, v in value.items()}
    if isinstance(value, dict):
        return {k: jsonable(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [jsonable(v) for v in value]
    return str(value)
