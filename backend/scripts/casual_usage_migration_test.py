"""从 v1.2.0 的 14 项迁移状态演练 015；只新建并保留随机命名的本地测试库。"""
from __future__ import annotations

import asyncio
import hashlib
import json
from pathlib import Path
import subprocess
import sys
from uuid import uuid4

import asyncpg
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
REPO = ROOT.parent
sys.path.insert(0, str(ROOT))
load_dotenv(ROOT / ".env")

from app.db import _db_config
from app.migrations import migrate, register_current_schema_migrations


async def main() -> None:
    config = _db_config()
    assert config["host"] in ("localhost", "127.0.0.1"), "只允许本机 PostgreSQL"
    database = "pantry_nook_test_" + uuid4().hex
    admin_config = {**config, "database": "postgres"}
    admin = await asyncpg.connect(**admin_config)
    try:
        await admin.execute(f'CREATE DATABASE "{database}"')
    finally:
        await admin.close()

    connection = await asyncpg.connect(**{**config, "database": database})
    try:
        old_schema = subprocess.check_output(
            ["git", "show", "v1.2.0:backend/app/db/schema.sql"],
            cwd=REPO,
            text=True,
            encoding="utf-8",
        )
        await connection.execute(old_schema)
        assert await register_current_schema_migrations(connection)
        for version in ("013_photo_journal.sql", "014_journal_photo_edit.sql"):
            path = ROOT / "migrations" / version
            content = path.read_text(encoding="utf-8")
            await connection.execute(content)
            await connection.execute(
                "INSERT INTO schema_migrations(version,checksum) VALUES($1,$2)",
                version,
                hashlib.sha256(content.encode()).hexdigest(),
            )
        assert await connection.fetchval("SELECT COUNT(*) FROM schema_migrations") == 14

        ingredient = await connection.fetchrow(
            "INSERT INTO ingredients(name,category,stock_text,stock_value,stock_unit) "
            "VALUES('迁移保留葡萄','水果','2',2,'kg') RETURNING *"
        )
        old_adjustment = await connection.fetchrow(
            "INSERT INTO inventory_adjustments(ingredient_id,reason,note,stock_before_text,stock_before_value,stock_before_unit,"
            "stock_after_text,stock_after_value,stock_after_unit,stock_after_updated_at,ingredient_status_before,ingredient_status_after) "
            "VALUES($1,'spoiled','旧记录','2',2,'kg','1',1,'kg',$2,'active','active') RETURNING *",
            ingredient["id"], ingredient["updated_at"],
        )

        await migrate(connection)
        await migrate(connection)
        assert await connection.fetchval("SELECT COUNT(*) FROM schema_migrations") == 15
        preserved = await connection.fetchrow("SELECT * FROM inventory_adjustments WHERE id=$1", old_adjustment["id"])
        assert preserved["reason"] == "spoiled" and preserved["note"] == "旧记录" and preserved["client_request_id"] is None

        request_id = uuid4()
        insert_used = (
            "INSERT INTO inventory_adjustments(ingredient_id,reason,client_request_id,stock_before_text,stock_before_value,stock_before_unit,"
            "stock_after_text,stock_after_value,stock_after_unit,stock_after_updated_at,ingredient_status_before,ingredient_status_after) "
            "VALUES($1,'used',$2,'2',2,'kg','1',1,'kg',$3,'active','active')"
        )
        await connection.execute(insert_used, ingredient["id"], request_id, ingredient["updated_at"])
        try:
            await connection.execute(insert_used, ingredient["id"], request_id, ingredient["updated_at"])
            raise AssertionError("client_request_id 唯一索引未生效")
        except asyncpg.UniqueViolationError:
            pass

        evidence = {
            "database": database,
            "from": "v1.2.0 / 14 migrations",
            "to": 15,
            "old_adjustment_preserved": True,
            "used_reason_accepted": True,
            "client_request_id_unique": True,
            "repeat_safe": True,
        }
        output = REPO / ".review" / "casual-usage-migration-evidence.json"
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(json.dumps(evidence, ensure_ascii=False, indent=2), encoding="utf-8")
        print(json.dumps(evidence, ensure_ascii=False))
    finally:
        await connection.close()


if __name__ == "__main__":
    asyncio.run(main())
