"""Insert realistic demo data for local preview.

运行方式（默认连接 backend/.env）：
uv run python scripts/seed_demo_data.py

规则：
- 同名数据优先复用，减少重复写入。
- 插入库存、菜品、搭配方案、今日作战。
- 为两场作战补一组 confirmed 消耗，保持库存快照一致。
"""

from __future__ import annotations

import asyncio
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from pathlib import Path
import os

import asyncpg
from dotenv import load_dotenv


load_dotenv(Path(__file__).resolve().parent.parent / ".env")

DB_HOST = os.getenv("DB_HOST", "localhost")
DB_PORT = int(os.getenv("DB_PORT", "5432"))
DB_NAME = os.getenv("DB_NAME", "pantry_nook")
DB_USER = os.getenv("DB_USER", "postgres")
DB_PASSWORD = os.getenv("DB_PASSWORD", "")


def to_decimal(value: int | float | str | Decimal | None) -> Decimal | None:
    if value is None:
        return None
    return Decimal(str(value))


INGREDIENT_DEMO = [
    {"name": "大米", "category": "碳水", "quantity_text": "2kg", "quantity_value": "2", "quantity_unit": "kg", "remaining_text": "2kg", "remaining_value": "2", "location": "室温", "purchase_date": date.today() - timedelta(days=2)},
    {"name": "鸡蛋", "category": "蛋白质", "quantity_text": "12个", "quantity_value": "12", "quantity_unit": "个", "remaining_text": "12个", "remaining_value": "12", "location": "冰箱冷藏", "purchase_date": date.today() - timedelta(days=1)},
    {"name": "番茄", "category": "蔬菜", "quantity_text": "4个", "quantity_value": "4", "quantity_unit": "个", "remaining_text": "4个", "remaining_value": "4", "location": "室温", "purchase_date": date.today() - timedelta(days=1)},
    {"name": "菠菜", "category": "蔬菜", "quantity_text": "600g", "quantity_value": "600", "quantity_unit": "g", "remaining_text": "600g", "remaining_value": "600", "location": "冰箱冷藏", "purchase_date": date.today() - timedelta(days=1)},
    {"name": "三文鱼排", "category": "蛋白质", "quantity_text": "700g", "quantity_value": "700", "quantity_unit": "g", "remaining_text": "700g", "remaining_value": "700", "location": "冰箱冷冻", "purchase_date": date.today() - timedelta(days=1)},
]

DISH_NAMES = [
    "番茄鸡蛋",
    "蒜香炒菠菜",
    "三文鱼烤盘",
]

PLAN_DEFINITIONS = [
    ("今日轻早餐", ["番茄鸡蛋"]),
    ("明日晚餐", ["三文鱼烤盘", "蒜香炒菠菜"]),
]


async def ensure_ingredients(conn: asyncpg.Connection) -> dict[str, int]:
    mapping: dict[str, int] = {}
    for item in INGREDIENT_DEMO:
        existing = await conn.fetchrow(
            "SELECT id FROM ingredients WHERE LOWER(name) = LOWER($1) LIMIT 1",
            item["name"],
        )
        if existing is None:
            existing = await conn.fetchrow(
                """
                INSERT INTO ingredients (
                  name, category, quantity_text, quantity_value, quantity_unit,
                  remaining_text, remaining_value, location, purchase_date, note
                ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
                RETURNING id
                """,
                item["name"],
                item["category"],
                item["quantity_text"],
                to_decimal(item["quantity_value"]),
                item["quantity_unit"],
                item["remaining_text"],
                to_decimal(item["remaining_value"]),
                item["location"],
                item["purchase_date"],
                f"{item['name']} 为示例数据。",
            )
        mapping[item["name"]] = existing["id"]
    return mapping


async def ensure_dishes(conn: asyncpg.Connection) -> dict[str, int]:
    mapping: dict[str, int] = {}
    for name in DISH_NAMES:
        existing = await conn.fetchrow(
            "SELECT id FROM dishes WHERE deleted_at IS NULL AND LOWER(name) = LOWER($1) LIMIT 1",
            name,
        )
        if existing is None:
            existing = await conn.fetchrow("INSERT INTO dishes (name) VALUES ($1) RETURNING id", name)
        mapping[name] = existing["id"]
    return mapping


async def ensure_plan(conn: asyncpg.Connection, plan_name: str, dish_ids: list[int]) -> int:
    candidates = await conn.fetch("SELECT id FROM meal_plans WHERE name = $1", plan_name)
    for cand in candidates:
        existing = [r["dish_id"] for r in await conn.fetch(
            "SELECT dish_id FROM meal_plan_dishes WHERE meal_plan_id = $1 ORDER BY position",
            cand["id"],
        )]
        if existing == dish_ids:
            return cand["id"]

    created = await conn.fetchrow("INSERT INTO meal_plans (name) VALUES ($1) RETURNING id", plan_name)
    for position, did in enumerate(dish_ids):
        await conn.execute(
            "INSERT INTO meal_plan_dishes (meal_plan_id, dish_id, position) VALUES ($1, $2, $3)",
            created["id"], did, position,
        )
    return created["id"]


async def ensure_battle_from_plan(conn: asyncpg.Connection, battle_date: date, plan_id: int) -> dict[str, int]:
    existing = await conn.fetchrow(
        "SELECT * FROM daily_battles WHERE battle_date = $1 AND meal_plan_id = $2 LIMIT 1",
        battle_date,
        plan_id,
    )
    if existing is not None:
        return dict(existing)

    battle = await conn.fetchrow(
        "INSERT INTO daily_battles (battle_date, meal_plan_id) VALUES ($1, $2) RETURNING *",
        battle_date,
        plan_id,
    )
    source_dishes = await conn.fetch(
        """
        SELECT d.id, d.name, mpd.position
          FROM meal_plan_dishes mpd
          JOIN dishes d ON d.id = mpd.dish_id
         WHERE mpd.meal_plan_id = $1
         ORDER BY mpd.position
        """,
        plan_id,
    )
    for position, dish in enumerate(source_dishes):
        await conn.execute(
            """
            INSERT INTO daily_battle_dishes
            (daily_battle_id, dish_id, dish_name, position)
            VALUES ($1, $2, $3, $4)
            """,
            battle["id"], dish["id"], dish["name"], position,
        )
    return dict(await conn.fetchrow("SELECT * FROM daily_battles WHERE id = $1", battle["id"]))


async def ensure_battle_confirmed(conn: asyncpg.Connection, battle: dict, consumptions: list[dict]) -> None:
    await conn.execute("SELECT pg_advisory_xact_lock($1)", 726140901)
    row = await conn.fetchrow("SELECT * FROM daily_battles WHERE id = $1 FOR UPDATE", battle["id"])
    if row is None or row["status"] != "planned":
        return

    if not consumptions:
        return

    battle_dishes = {r["id"] for r in await conn.fetch(
        "SELECT id FROM daily_battle_dishes WHERE daily_battle_id = $1",
        battle["id"],
    )}
    ingredient_ids = sorted({int(item["ingredient_id"]) for item in consumptions})
    ingredients = {
        int(r["id"]): dict(r)
        for r in await conn.fetch(
            "SELECT * FROM ingredients WHERE id = ANY($1::bigint[]) ORDER BY id FOR UPDATE",
            ingredient_ids,
        )
    }
    if len(ingredients) != len(ingredient_ids):
        raise RuntimeError("部分食材不存在，示例数据写入被中止。")

    await conn.execute(
        "UPDATE daily_battles SET status = 'confirmed', confirmed_at = NOW(), updated_at = NOW() WHERE id = $1",
        battle["id"],
    )

    for item in consumptions:
        ingredient_id = int(item["ingredient_id"])
        ingredient = ingredients[ingredient_id]
        if ingredient["status"] != "active":
            raise RuntimeError(f"食材“{ingredient['name']}”当前不是可用状态。")
        if item.get("daily_battle_dish_id") is not None:
            if int(item["daily_battle_dish_id"]) not in battle_dishes:
                raise RuntimeError(f"食材“{ingredient['name']}”绑定的今日作战菜品不在该战斗中。")

        before_text = ingredient["remaining_text"]
        before_value = ingredient["remaining_value"]
        before_status = ingredient["status"]
        before_ended_at = ingredient["ended_at"]

        if not str(item["remaining_text"]).strip():
            raise RuntimeError(f"食材“{ingredient['name']}”缺少确认后剩余数量。")
        after_text = item["remaining_text"].strip()
        after_value = to_decimal(item.get("remaining_value")) if item.get("remaining_value") is not None else None
        if after_value is None and item.get("quantity_value") is not None:
            after_value = (ingredient["remaining_value"] - to_decimal(item["quantity_value"]))
        if after_value is not None:
            if after_value < 0:
                raise RuntimeError(f"食材“{ingredient['name']}”剩余不足。")
            if ingredient["remaining_value"] is not None and after_value > ingredient["remaining_value"]:
                raise RuntimeError(f"食材“{ingredient['name']}”确认后剩余不能超过当前剩余。")

        after_status = "consumed" if after_value == Decimal("0") else "active"
        after_ended_at = datetime.now(timezone.utc) if after_status == "consumed" else None

        await conn.execute(
            """
            UPDATE ingredients
            SET remaining_text = $1, remaining_value = $2, status = $3, ended_at = $4, updated_at = NOW()
            WHERE id = $5
            """,
            after_text, after_value, after_status, after_ended_at, ingredient_id,
        )

        await conn.execute(
            """
            INSERT INTO consumptions (
              daily_battle_id, daily_battle_dish_id, ingredient_id,
              quantity_used_text, quantity_value, quantity_unit, note,
              remaining_before_text, remaining_before_value,
              remaining_after_text, remaining_after_value,
              ingredient_status_before, ingredient_ended_at_before,
              ingredient_status_after, ingredient_ended_at_after
            ) VALUES (
              $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15
            )
            """,
            battle["id"],
            item.get("daily_battle_dish_id"),
            ingredient_id,
            item["quantity_used_text"],
            item.get("quantity_value"),
            item.get("quantity_unit"),
            item.get("note"),
            before_text,
            before_value,
            after_text,
            after_value,
            before_status,
            before_ended_at,
            after_status,
            after_ended_at,
        )

        ingredient["remaining_text"] = after_text
        ingredient["remaining_value"] = after_value
        ingredient["status"] = after_status
        ingredient["ended_at"] = after_ended_at



async def seed() -> None:
    conn = await asyncpg.connect(
        host=DB_HOST,
        port=DB_PORT,
        database=DB_NAME,
        user=DB_USER,
        password=DB_PASSWORD,
    )
    try:
        async with conn.transaction():
            ingredient_map = await ensure_ingredients(conn)
            dish_map = await ensure_dishes(conn)
            plan_map = {}
            for plan_name, dish_names in PLAN_DEFINITIONS:
                plan_map[plan_name] = await ensure_plan(
                    conn,
                    plan_name,
                    [dish_map[name] for name in dish_names],
                )

            today = date.today()
            battle_today = await ensure_battle_from_plan(conn, today, plan_map["今日轻早餐"])
            battle_tomorrow = await ensure_battle_from_plan(conn, today + timedelta(days=1), plan_map["明日晚餐"])

            today_dishes = await conn.fetch(
                "SELECT id FROM daily_battle_dishes WHERE daily_battle_id = $1 ORDER BY position",
                battle_today["id"],
            )
            tomorrow_dishes = await conn.fetch(
                "SELECT id FROM daily_battle_dishes WHERE daily_battle_id = $1 ORDER BY position",
                battle_tomorrow["id"],
            )

            await ensure_battle_confirmed(
                conn,
                battle_today,
                [
                    {
                        "daily_battle_dish_id": today_dishes[0]["id"] if today_dishes else None,
                        "ingredient_id": ingredient_map["大米"],
                        "quantity_used_text": "0.4kg",
                        "quantity_unit": "kg",
                        "quantity_value": "0.4",
                        "remaining_text": "1.6kg",
                        "remaining_value": "1.6",
                        "note": "示例消耗",
                    },
                ],
            )

            await ensure_battle_confirmed(
                conn,
                battle_tomorrow,
                [
                    {
                        "daily_battle_dish_id": tomorrow_dishes[0]["id"] if tomorrow_dishes else None,
                        "ingredient_id": ingredient_map["三文鱼排"],
                        "quantity_used_text": "100g",
                        "quantity_unit": "g",
                        "quantity_value": "100",
                        "remaining_text": "500g",
                        "remaining_value": "500",
                        "note": "示例消耗",
                    },
                ],
            )

        print("示例数据写入完成。")
        print("库存示例：", ", ".join(INGREDIENT_DEMO_NAME for INGREDIENT_DEMO_NAME in ingredient_map))
        print("菜品示例：", ", ".join(DISH_NAMES))
        print("方案示例：", ", ".join(f"{name}:{pid}" for name, pid in plan_map.items()))
        print("作战示例：", f"今日={battle_today['id']} 明日={battle_tomorrow['id']}")
    finally:
        await conn.close()


if __name__ == "__main__":
    asyncio.run(seed())
