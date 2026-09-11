"""今日作战（daily battles）路由与业务逻辑。

SQL 与事务边界保持一致，业务规则：
- 搭配方案是模板，创建今日作战时复制菜品到 daily_battle_dishes。
- 确认 = 写消耗记录 + 调整库存，同一事务，失败回滚。
- 撤销确认时按原消耗反向恢复，无法精确恢复则报冲突。
"""

from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
from typing import Any

import asyncpg
from fastapi import APIRouter, Request

from ..db import get_pool, lock_inventory_workflow
from ..errors import conflict, not_found, validation_error
from ..responses import created, ok
from ..menu_workflow import attach_preparations, save_preparations, assert_version
from ..quantity import normalize_stock, parse_usage_quantity, render_stock
from ..validation import (
    enum_value,
    ensure_object_body,
    optional_date,
    optional_text,
    pagination,
    parse_id,
    required_text,
)

router = APIRouter()

BATTLE_STATUSES = ["planned", "confirmed", "cancelled"]
REVOCATION_STATUSES = ["planned", "cancelled"]
MEAL_SLOTS = ['breakfast', 'lunch', 'dinner']


# ---------- 输入构造 ----------

def ids_array(value: Any, field: str = "dish_ids") -> list[int]:
    if not isinstance(value, list) or len(value) == 0:
        raise validation_error(f"{field} 必须是至少包含一个菜品 ID 的数组")
    if len(value) > 50:
        raise validation_error("一条今日作战最多包含 50 个菜品")
    ids = [parse_id(item, field) for item in value]
    if len(set(ids)) != len(ids):
        raise validation_error(f"{field} 不能包含重复菜品")
    return ids

def validate_preparations_cover_dishes(dishes: list[dict], raw_preparations: Any) -> None:
    expected = {int(d["id"]): d.get("name", "") for d in dishes}
    if not isinstance(raw_preparations, list):
        raise validation_error("菜品耗材预设参数类型不正确")
    if not expected:
        return
    if len(raw_preparations) == 0:
        raise validation_error("每道菜至少需要贴一项耗材")
    prepared_dish_ids = set()
    for item in raw_preparations:
        row = ensure_object_body(item)
        dish_id = parse_id(row.get("dish_id"), "dish_id")
        prepared_dish_ids.add(dish_id)
    missing = [expected[dish_id] for dish_id in expected if dish_id not in prepared_dish_ids]
    if missing:
        raise validation_error("以下菜品尚未贴耗材：" + "、".join(missing))


async def assert_ready_for_confirmation(conn, battle_id: int, inputs: list[dict]) -> None:
    """菜单可先保存为草稿；只有确认库存前才强制备餐和预计量完整。"""
    rows = await conn.fetch(
        """SELECT bd.id AS daily_battle_dish_id, bd.dish_name,
                  p.ingredient_id, p.planned_quantity_text
           FROM daily_battle_dishes bd
           LEFT JOIN daily_battle_preparations p ON p.daily_battle_dish_id = bd.id
           WHERE bd.daily_battle_id = $1
           ORDER BY bd.position, p.position, p.id""",
        battle_id,
    )
    missing_ingredients = []
    missing_amounts = []
    preparation_pairs = set()
    for row in rows:
        dish_name = row["dish_name"]
        if row["ingredient_id"] is None:
            missing_ingredients.append(dish_name)
            continue
        preparation_pairs.add((int(row["daily_battle_dish_id"]), int(row["ingredient_id"])))
        if not row["planned_quantity_text"] or not row["planned_quantity_text"].strip():
            missing_amounts.append(dish_name)
    if missing_ingredients or missing_amounts:
        parts = []
        if missing_ingredients:
            parts.append("补全耗材：" + "、".join(dict.fromkeys(missing_ingredients)))
        if missing_amounts:
            parts.append("填写预计用量：" + "、".join(dict.fromkeys(missing_amounts)))
        raise validation_error("确认前请" + "；".join(parts))

    input_pairs = set()
    for input_ in inputs:
        dish_id = input_.get("daily_battle_dish_id")
        if dish_id is None:
            raise validation_error("请按菜品核对每项已贴耗材")
        pair = (int(dish_id), int(input_["ingredient_id"]))
        if pair in input_pairs:
            raise validation_error("同一道菜的同一耗材只能核对一次")
        input_pairs.add(pair)
    if input_pairs != preparation_pairs:
        raise validation_error("请按本餐已贴耗材逐项填写实际用量")



def consumption_input(body: dict) -> dict:
    input_: dict[str, Any] = {
        "ingredient_id": parse_id(body.get("ingredient_id"), "ingredient_id"),
        "quantity_used_text": required_text(body.get("quantity_used_text"), "quantity_used_text"),
        "expected_updated_at": required_text(body.get("expected_updated_at"), "expected_updated_at", 64),
    }
    input_["usage_value"] = parse_usage_quantity(input_["quantity_used_text"])

    if "daily_battle_dish_id" in body:
        val = body.get("daily_battle_dish_id")
        input_["daily_battle_dish_id"] = None if val in (None, "") else parse_id(val, "daily_battle_dish_id")
    if "note" in body:
        input_["note"] = optional_text(body.get("note"), "note", 5000)
    return input_


def confirm_input(body: dict) -> list[dict]:
    consumptions = body.get("consumptions", [])
    if consumptions is None:
        consumptions = []
    if not isinstance(consumptions, list):
        raise validation_error("consumptions 必须是数组")
    if len(consumptions) > 500:
        raise validation_error("一次确认最多包含 500 条消耗记录")
    return [consumption_input(ensure_object_body(item)) for item in consumptions]


def prepare_inventory_changes(inputs: list[dict], ingredients: dict[int, dict]) -> None:
    """Calculate final stock in the transaction instead of accepting client totals."""
    totals: dict[int, Decimal] = {}
    last: dict[int, int] = {}
    for pos, input_ in enumerate(inputs):
        ingredient_id = int(input_["ingredient_id"])
        entry = ingredients[ingredient_id]
        assert_version(input_["expected_updated_at"], entry["row"]["updated_at"])
        totals[ingredient_id] = totals.get(ingredient_id, Decimal(0)) + input_["usage_value"]
        last[ingredient_id] = pos

    for ingredient_id, total in totals.items():
        entry = ingredients[ingredient_id]
        row = entry["row"]
        if entry["status"] != "active":
            raise conflict(f"食材“{row['name']}”当前不可消耗")
        if row["stock_value"] is None or not row["stock_unit"]:
            raise validation_error(f"食材“{row['name']}”缺少可计算的库存数量或单位")
        used = normalize_stock(total)
        remaining = normalize_stock(Decimal(row["stock_value"]) - used)
        # Three separately confirmed 1/3 usages can leave one rounding micro-unit.
        # Treat that residual as empty only after a positive actual usage.
        if total > 0 and abs(remaining) <= Decimal("0.000001"):
            remaining = Decimal(0)
        if remaining < 0:
            raise validation_error(f"食材“{row['name']}”库存不足，请重新核对实际用量")
        entry.update(used_value=used, final_text=render_stock(remaining), final_value=remaining)

    for pos, input_ in enumerate(inputs):
        ingredient_id = int(input_["ingredient_id"])
        entry = ingredients[ingredient_id]
        row = entry["row"]
        input_["quantity_value"] = normalize_stock(input_["usage_value"]) or None
        input_["quantity_unit"] = row["stock_unit"]
        input_["updates_inventory"] = last[ingredient_id] == pos
        input_["remaining_text"] = entry["final_text"] if last[ingredient_id] == pos else row["stock_text"]
        input_["remaining_value"] = entry["final_value"] if last[ingredient_id] == pos else row["stock_value"]


# ---------- 查询 / 事务辅助 ----------

async def _get_battle(client, id: int, lock: bool = False) -> dict:
    if lock:
        locked = await client.fetchrow("SELECT id FROM daily_battles WHERE id = $1 FOR UPDATE", id)
        if locked is None:
            raise not_found("今日作战")

    rows = await client.fetch(
        """SELECT b.*,
                  COALESCE(
                    (SELECT json_agg(
                      json_build_object(
                        'id', bd.id,
                        'dish_id', bd.dish_id,
                        'name', bd.dish_name,
                        'position', bd.position
                      ) ORDER BY bd.position
                    ) FILTER (WHERE bd.id IS NOT NULL)
                    FROM daily_battle_dishes bd WHERE bd.daily_battle_id = b.id
                    ), '[]'::json) AS dishes
           FROM daily_battles b
           WHERE b.id = $1
           GROUP BY b.id""",
        id,
    )
    if len(rows) == 0:
        raise not_found("今日作战")
    result = dict(rows[0])
    await attach_preparations(client, [result])
    return result


async def _get_battle_consumptions(client, id: int) -> list[dict]:
    rows = await client.fetch(
        """SELECT c.*, i.name AS ingredient_name, i.category,
                  bd.dish_name AS daily_battle_dish_name
           FROM consumptions c
           JOIN ingredients i ON i.id = c.ingredient_id
           LEFT JOIN daily_battle_dishes bd ON bd.id = c.daily_battle_dish_id
           WHERE c.daily_battle_id = $1
           ORDER BY c.created_at ASC, c.id ASC""",
        id,
    )
    return [dict(r) for r in rows]


async def _source_dishes(client, input_: dict) -> list[dict]:
    if input_.get("meal_plan_id"):
        plan = await client.fetchrow("SELECT id FROM meal_plans WHERE id = $1 FOR SHARE", input_["meal_plan_id"])
        if plan is None:
            raise not_found("搭配方案")
        rows = await client.fetch(
            """SELECT d.id, d.name, d.deleted_at, mpd.position
               FROM meal_plan_dishes mpd
               JOIN dishes d ON d.id = mpd.dish_id
               WHERE mpd.meal_plan_id = $1
               ORDER BY mpd.position""",
            input_["meal_plan_id"],
        )
        if len(rows) == 0:
            raise not_found("搭配方案中的菜品")
        if any(r["deleted_at"] is not None for r in rows):
            raise conflict("搭配方案包含已删除的菜品，请先修改方案")
        return [dict(r) for r in rows]

    dish_ids = input_["dish_ids"]
    rows = await client.fetch(
        "SELECT id, name FROM dishes WHERE id = ANY($1::bigint[]) AND deleted_at IS NULL",
        dish_ids,
    )
    if len(rows) != len(dish_ids):
        raise not_found("菜品")
    names = {int(r["id"]): r["name"] for r in rows}
    return [{"id": int(did), "name": names[int(did)], "position": pos} for pos, did in enumerate(dish_ids)]


async def _insert_battle_dishes(client, battle_id: int, dishes: list[dict]) -> None:
    for position, dish in enumerate(dishes):
        await client.execute(
            """INSERT INTO daily_battle_dishes
               (daily_battle_id, dish_id, dish_name, position)
               VALUES ($1, $2, $3, $4)""",
            battle_id, dish["id"], dish["name"], position,
        )


# ---------- 路由 ----------

@router.get("")
async def list_battles(request: Request):
    q = dict(request.query_params)
    limit, offset = pagination(q).values()
    conditions: list[str] = []
    values: list[Any] = []

    if q.get("from") is not None:
        values.append(optional_date(q["from"], "from"))
        conditions.append(f"b.battle_date >= ${len(values)}")
    if q.get("to") is not None:
        values.append(optional_date(q["to"], "to"))
        conditions.append(f"b.battle_date <= ${len(values)}")
    if q.get("status") is not None:
        values.append(enum_value(q["status"], "status", BATTLE_STATUSES))
        conditions.append(f"b.status = ${len(values)}")
    if q.get('meal_slot') is not None:
        values.append(enum_value(q['meal_slot'], 'meal_slot', MEAL_SLOTS))
        conditions.append(f'b.meal_slot = ${len(values)}')

    where = f"WHERE {' AND '.join(conditions)}" if conditions else ""
    values.extend([limit, offset])
    limit_index, offset_index = len(values) - 1, len(values)

    pool = await get_pool()
    rows = await pool.fetch(
        f"""SELECT b.*,
                  COALESCE(
                    (SELECT json_agg(
                      json_build_object(
                        'id', bd.id,
                        'dish_id', bd.dish_id,
                        'name', bd.dish_name,
                        'position', bd.position
                      ) ORDER BY bd.position
                    ) FILTER (WHERE bd.id IS NOT NULL)
                    FROM daily_battle_dishes bd WHERE bd.daily_battle_id = b.id
                    ), '[]'::json) AS dishes,
                  COUNT(*) OVER()::int AS total_count
           FROM daily_battles b
           {where}
           GROUP BY b.id
           ORDER BY b.battle_date DESC,
             CASE b.meal_slot WHEN 'dinner' THEN 3 WHEN 'lunch' THEN 2 WHEN 'breakfast' THEN 1 ELSE 0 END DESC,
             b.created_at DESC, b.id DESC
           LIMIT ${limit_index} OFFSET ${offset_index}""",
        *values,
    )
    total = rows[0]["total_count"] if rows else 0
    if not rows and offset:
        total = await pool.fetchval(f"SELECT COUNT(*) FROM daily_battles b {where}", *values[:-2])
    items = [dict(r) for r in rows]
    for item in items:
        item.pop("total_count", None)
    await attach_preparations(pool, items)
    return ok(items, {"total": int(total), "limit": limit, "offset": offset})


@router.get("/{battle_id}/consumptions")
async def battle_consumptions(battle_id: int):
    pid = parse_id(battle_id)
    pool = await get_pool()
    await _get_battle(pool, pid)
    return ok(await _get_battle_consumptions(pool, pid))


@router.get("/{battle_id}")
async def get_battle_route(battle_id: int):
    pid = parse_id(battle_id)
    pool = await get_pool()
    return ok(await _get_battle(pool, pid))


@router.post("")
async def create_battle(request: Request):
    body = ensure_object_body(await request.json())
    battle_date_raw = required_text(body.get("battle_date"), "battle_date", 10)
    battle_date_val = optional_date(battle_date_raw, "battle_date")
    has_plan = body.get("meal_plan_id") not in (None, "")
    has_dishes = "dish_ids" in body
    input_: dict[str, Any] = {"battle_date": battle_date_val}
    meal_slot = enum_value(body.get('meal_slot'), 'meal_slot', MEAL_SLOTS, optional=True)

    if has_plan == has_dishes:
        raise validation_error("meal_plan_id 和 dish_ids 必须二选一")
    if has_plan:
        input_["meal_plan_id"] = parse_id(body.get("meal_plan_id"), "meal_plan_id")
    if has_dishes:
        input_["dish_ids"] = ids_array(body.get("dish_ids"))

    pool = await get_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            await lock_inventory_workflow(conn)
            dishes = await _source_dishes(conn, input_)
            # 菜单草稿允许稍后填预计用量，但每道菜必须先贴至少一种耗材。
            validate_preparations_cover_dishes(dishes, body.get("preparations", []))
            battle = await conn.fetchrow(
                "INSERT INTO daily_battles (battle_date, meal_plan_id, meal_slot) VALUES ($1, $2, $3) RETURNING id",
                input_["battle_date"], input_.get("meal_plan_id"), meal_slot,
            )
            await _insert_battle_dishes(conn, battle["id"], dishes)
            await save_preparations(conn, battle['id'], body.get('preparations', []))
            result = await _get_battle(conn, battle["id"])
    return created(result)


@router.patch("/{battle_id}")
async def update_battle(battle_id: int, request: Request):
    pid = parse_id(battle_id)
    body = ensure_object_body(await request.json())
    input_ = {"dish_ids": ids_array(body.get("dish_ids"))}
    if "preparations" not in body:
        raise validation_error("更新菜单时请同时提交每道菜的耗材")

    pool = await get_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            await lock_inventory_workflow(conn)
            current = await conn.fetchrow("SELECT * FROM daily_battles WHERE id = $1 FOR UPDATE", pid)
            if current is None:
                raise not_found("今日作战")
            if current["status"] != "planned":
                raise conflict("只有计划中的今日作战可以调整菜品")
            assert_version(body.get('expected_updated_at'), current['updated_at'])
            dishes = await _source_dishes(conn, input_)
            validate_preparations_cover_dishes(dishes, body["preparations"])
            existing = await conn.fetch("SELECT id, dish_id FROM daily_battle_dishes WHERE daily_battle_id = $1", pid)
            existing_by_dish = {r["dish_id"]: r["id"] for r in existing}
            removed = [r["id"] for r in existing if r["dish_id"] not in input_["dish_ids"]]
            if removed and await conn.fetchval("SELECT EXISTS(SELECT 1 FROM consumptions WHERE daily_battle_dish_id = ANY($1::bigint[]))", removed):
                raise conflict("该菜品关联历史消耗，不能删除；可以保留该菜品或创建新的今日作战")
            await conn.execute("DELETE FROM daily_battle_dishes WHERE id = ANY($1::bigint[])", removed)
            # 保留历史消耗引用的菜品行及快照；临时移位避免唯一位置约束冲突。
            await conn.execute("UPDATE daily_battle_dishes SET position = position + 1000 WHERE daily_battle_id = $1", pid)
            for position, dish in enumerate(dishes):
                if dish["id"] in existing_by_dish:
                    await conn.execute("UPDATE daily_battle_dishes SET position = $1 WHERE id = $2", position, existing_by_dish[dish["id"]])
                else:
                    await conn.execute("INSERT INTO daily_battle_dishes (daily_battle_id, dish_id, dish_name, position) VALUES ($1, $2, $3, $4)", pid, dish["id"], dish["name"], position)
            await conn.execute("UPDATE daily_battles SET updated_at = NOW() WHERE id = $1", pid)
            if 'meal_slot' in body:
                slot = enum_value(body['meal_slot'], 'meal_slot', MEAL_SLOTS, optional=True)
                await conn.execute('UPDATE daily_battles SET meal_slot=$1 WHERE id=$2', slot, pid)
            if 'battle_date' in body:
                new_date = optional_date(required_text(body['battle_date'], 'battle_date', 10), 'battle_date')
                await conn.execute('UPDATE daily_battles SET battle_date=$1 WHERE id=$2', new_date, pid)
            await save_preparations(conn, pid, body['preparations'])
            result = await _get_battle(conn, pid)
    return ok(result)


@router.post("/{battle_id}/cancel")
async def cancel_battle(battle_id: int):
    pid = parse_id(battle_id)
    pool = await get_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            await lock_inventory_workflow(conn)
            current = await conn.fetchrow("SELECT status FROM daily_battles WHERE id = $1 FOR UPDATE", pid)
            if current is None:
                raise not_found("今日作战")
            if current["status"] != "planned":
                raise conflict("只有计划中的今日作战可以取消")
            await conn.execute(
                """UPDATE daily_battles
                   SET status = 'cancelled', cancelled_at = NOW(), updated_at = NOW()
                   WHERE id = $1""",
                pid,
            )
            result = await _get_battle(conn, pid)
    return ok(result)


@router.post("/{battle_id}/confirm")
async def confirm_battle(battle_id: int, request: Request):
    pid = parse_id(battle_id)
    body = ensure_object_body(await request.json())
    inputs = confirm_input(body)

    pool = await get_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            await lock_inventory_workflow(conn)
            battle = await conn.fetchrow("SELECT * FROM daily_battles WHERE id = $1 FOR UPDATE", pid)
            if battle is None:
                raise not_found("今日作战")
            if battle["status"] != "planned":
                raise conflict("只有计划中的今日作战可以确认")
            assert_version(required_text(body.get('expected_updated_at'), 'expected_updated_at', 64), battle['updated_at'])

            battle_dishes = await conn.fetch("SELECT id FROM daily_battle_dishes WHERE daily_battle_id = $1", pid)
            battle_dish_ids = {int(r["id"]) for r in battle_dishes}
            for inp in inputs:
                did = inp.get("daily_battle_dish_id")
                if did is not None and int(did) not in battle_dish_ids:
                    raise not_found("今日作战菜品")
            await assert_ready_for_confirmation(conn, pid, inputs)

            ingredient_ids = list({inp["ingredient_id"] for inp in inputs})
            ingredient_rows = []
            if ingredient_ids:
                ingredient_rows = await conn.fetch(
                    """SELECT * FROM ingredients
                       WHERE id = ANY($1::bigint[])
                       ORDER BY id
                       FOR UPDATE""",
                    ingredient_ids,
                )
            if len(ingredient_rows) != len(ingredient_ids):
                raise not_found("食材")
            ingredients = {}
            for ing in ingredient_rows:
                ingredients[int(ing["id"])] = {
                    "row": ing,
                    "remaining_text": ing["stock_text"],
                    "remaining_value": ing["stock_value"],
                    "status": ing["status"],
                    "ended_at": ing["ended_at"],
                }
            prepare_inventory_changes(inputs, ingredients)
            prepared = []

            for inp in inputs:
                key = int(inp["ingredient_id"])
                entry = ingredients[key]
                ing_row = entry["row"]
                before = {
                    "remaining_text": entry["remaining_text"],
                    "remaining_value": entry["remaining_value"],
                    "status": entry["status"],
                    "ended_at": entry["ended_at"],
                }
                remaining_after_text = inp["remaining_text"]
                remaining_after_value = inp["remaining_value"]

                status_after = "consumed" if remaining_after_value == 0 else "active"
                ended_at_after = datetime.now(timezone.utc) if status_after == "consumed" else None
                if inp["updates_inventory"]:
                    await conn.execute(
                        """UPDATE ingredients
                           SET stock_text = $1, stock_value = $2, status = $3, ended_at = $4, updated_at = NOW()
                           WHERE id = $5""",
                        remaining_after_text, remaining_after_value, status_after, ended_at_after, ing_row["id"],
                    )

                prepared.append({
                    "input": inp,
                    "ingredient_id": int(ing_row["id"]),
                    "remaining_before_text": before["remaining_text"],
                    "remaining_before_value": before["remaining_value"],
                    "ingredient_status_before": before["status"],
                    "ingredient_ended_at_before": before["ended_at"],
                    "remaining_after_text": remaining_after_text,
                    "remaining_after_value": remaining_after_value,
                    "ingredient_status_after": status_after,
                    "ingredient_ended_at_after": ended_at_after,
                })
                entry["remaining_text"] = remaining_after_text
                entry["remaining_value"] = remaining_after_value
                entry["status"] = status_after
                entry["ended_at"] = ended_at_after

            await conn.execute(
                """UPDATE daily_battles
                   SET status = 'confirmed', confirmed_at = NOW(), updated_at = NOW()
                   WHERE id = $1""",
                pid,
            )

            for item in prepared:
                inp = item["input"]
                await conn.execute(
                    """INSERT INTO consumptions (
                         daily_battle_id, daily_battle_dish_id, ingredient_id,
                         quantity_used_text, quantity_value, quantity_unit, note,
                         remaining_before_text, remaining_before_value,
                         remaining_after_text, remaining_after_value,
                         ingredient_status_before, ingredient_ended_at_before,
                         ingredient_status_after, ingredient_ended_at_after
                       ) VALUES (
                         $1, $2, $3, $4, $5, $6, $7,
                         $8, $9, $10, $11, $12, $13, $14, $15
                       )""",
                    pid, inp.get("daily_battle_dish_id"), item["ingredient_id"],
                    inp["quantity_used_text"], inp.get("quantity_value"), inp["quantity_unit"], inp.get("note"),
                    item["remaining_before_text"], item["remaining_before_value"],
                    item["remaining_after_text"], item["remaining_after_value"],
                    item["ingredient_status_before"], item["ingredient_ended_at_before"],
                    item["ingredient_status_after"], item["ingredient_ended_at_after"],
                )

            result = await _get_battle(conn, pid)
            result["consumptions"] = await _get_battle_consumptions(conn, pid)
    return ok(result)


@router.post("/{battle_id}/revoke-confirmation")
async def revoke_confirmation(battle_id: int, request: Request):
    pid = parse_id(battle_id)
    body = {}
    raw = await request.body()
    if raw:
        body = ensure_object_body(await request.json())
    target_status = body.get("target_status", "planned")
    target_status = enum_value(target_status, "target_status", REVOCATION_STATUSES)

    pool = await get_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            await lock_inventory_workflow(conn)
            battle = await conn.fetchrow("SELECT * FROM daily_battles WHERE id = $1 FOR UPDATE", pid)
            if battle is None:
                raise not_found("今日作战")
            if battle["status"] != "confirmed":
                raise conflict("只有已确认的今日作战可以撤销确认")

            consumptions = await conn.fetch(
                """SELECT * FROM consumptions
                   WHERE daily_battle_id = $1 AND status = 'active'
                   ORDER BY id DESC
                   FOR UPDATE""",
                pid,
            )
            ingredient_ids = list({int(r["ingredient_id"]) for r in consumptions})
            ingredient_rows = []
            if ingredient_ids:
                ingredient_rows = await conn.fetch(
                    """SELECT * FROM ingredients
                       WHERE id = ANY($1::bigint[])
                       ORDER BY id
                       FOR UPDATE""",
                    ingredient_ids,
                )
            ingredients = {int(r["id"]): dict(r) for r in ingredient_rows}
            # 只恢复确认之后没有再变更的库存，避免同量覆盖、换单位等绕过快照检查。
            if any(r["updated_at"] != battle["confirmed_at"] for r in ingredient_rows):
                raise conflict("相关库存已有后续变更，不能安全撤销本餐；请到库存核对调整")

            for consumption in consumptions:
                cid = int(consumption["ingredient_id"])
                ing = ingredients.get(cid)
                later_active = await conn.fetchval(
                    """SELECT EXISTS(SELECT 1 FROM consumptions
                       WHERE ingredient_id = $1 AND status = 'active'
                         AND id > $2 AND daily_battle_id <> $3)""",
                    cid, consumption["id"], pid,
                )
                if later_active:
                    raise conflict("该食材存在后续有效消耗，请先撤销后续确认，再恢复本次库存")
                ended_after = consumption["ingredient_ended_at_after"]
                ing_ended = ing["ended_at"] if ing else None
                ends_match = ing_ended == ended_after
                if (
                    ing is None
                    or ing["stock_text"] != consumption["remaining_after_text"]
                    or ing["stock_value"] != consumption["remaining_after_value"]
                    or ing["status"] != consumption["ingredient_status_after"]
                    or not ends_match
                ):
                    name = ing["name"] if ing else str(consumption["ingredient_id"])
                    raise conflict(f"食材“{name}”状态已变化，无法可靠恢复，请手动确认剩余数量")

                await conn.execute(
                    """UPDATE ingredients
                       SET stock_text = $1, stock_value = $2, status = $3, ended_at = $4, updated_at = NOW()
                       WHERE id = $5""",
                    consumption["remaining_before_text"], consumption["remaining_before_value"],
                    consumption["ingredient_status_before"], consumption["ingredient_ended_at_before"], cid,
                )

                await conn.execute(
                    """UPDATE consumptions
                       SET status = 'reversed', reversed_at = NOW(), updated_at = NOW()
                       WHERE id = $1""",
                    consumption["id"],
                )
                # 同一食材可有多条消耗，下一条反向恢复须基于刚恢复的状态。
                ing.update(
                    stock_text=consumption["remaining_before_text"],
                    stock_value=consumption["remaining_before_value"],
                    status=consumption["ingredient_status_before"],
                    ended_at=consumption["ingredient_ended_at_before"],
                )

            await conn.execute(
                """UPDATE daily_battles
                   SET status = $1::varchar,
                       confirmed_at = NULL,
                       cancelled_at = CASE WHEN $1::varchar = 'cancelled' THEN NOW() ELSE NULL END,
                       updated_at = NOW()
                   WHERE id = $2""",
                target_status, pid,
            )
            result = await _get_battle(conn, pid)
    return ok(result)


@router.delete("/{battle_id}")
async def delete_battle(battle_id: int):
    pid = parse_id(battle_id)
    pool = await get_pool()
    try:
        async with pool.acquire() as conn, conn.transaction():
            await lock_inventory_workflow(conn)
            if await conn.fetchval('SELECT EXISTS(SELECT 1 FROM consumptions WHERE daily_battle_id=$1)', pid):
                raise conflict('菜单已有历史消耗记录，不能删除')
            result = await conn.fetchrow(
                """DELETE FROM daily_battles
                   WHERE id = $1 AND status IN ('planned', 'cancelled')
                   RETURNING *""", pid)
        if result is None:
            raise conflict("只有未确认的今日作战可以删除")
        return ok(result)
    except asyncpg.exceptions.ForeignKeyViolationError:
        raise conflict("今日作战已有历史消耗记录，不能删除")
