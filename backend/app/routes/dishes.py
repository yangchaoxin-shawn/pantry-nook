"""菜品库（dishes）路由与业务逻辑。

删除是软删除（deleted_at），保留历史关系；名称唯一（active 且 trim 后）。
"""

from __future__ import annotations

import asyncpg
from fastapi import APIRouter, Request

from ..db import get_pool, lock_catalog_workflow
from ..menu_workflow import assert_version
from ..errors import conflict, not_found, validation_error
from ..responses import created, ok
from ..validation import like_pattern, pagination, parse_id, read_json_object, required_text

router = APIRouter()


def dish_input(body: dict, partial: bool = False) -> dict:
    has_name = "name" in body
    if not partial or has_name:
        return {"name": required_text(body.get("name"), "name")}
    raise validation_error("至少需要提供一个可修改字段")


async def _get_active_dish(pool, id_: int):
    result = await pool.fetchrow("SELECT * FROM dishes WHERE id = $1 AND deleted_at IS NULL", id_)
    if result is None:
        raise not_found("菜品")
    return result


@router.get("")
async def list_dishes(request: Request):
    q = dict(request.query_params)
    limit, offset = pagination(q).values()
    conditions = ["deleted_at IS NULL"]
    values: list = []

    if q.get("q") is not None:
        query = required_text(q["q"], "q", 100)
        values.append(like_pattern(query))
        conditions.append(f"name ILIKE ${len(values)} ESCAPE '{chr(92)}'")

    where = f"WHERE {' AND '.join(conditions)}"
    values.extend([limit, offset])

    pool = await get_pool()
    rows = await pool.fetch(
        f"""SELECT *, COUNT(*) OVER()::int AS total_count
            FROM dishes
            {where}
            ORDER BY created_at DESC
            LIMIT ${len(values) - 1} OFFSET ${len(values)}""",
        *values,
    )
    total = rows[0]["total_count"] if rows else 0
    if not rows and offset:
        total = await pool.fetchval(f"SELECT COUNT(*) FROM dishes {where}", *values[:-2])
    items = [dict(r) for r in rows]
    for item in items:
        item.pop("total_count", None)
    return ok(items, {"total": int(total), "limit": limit, "offset": offset})


@router.get("/{dish_id}")
async def get_dish(dish_id: int):
    pid = parse_id(dish_id)
    pool = await get_pool()
    return ok(await _get_active_dish(pool, pid))


@router.post("")
async def create_dish(request: Request):
    body = await read_json_object(request)
    input_ = dish_input(body)
    pool = await get_pool()
    try:
        result = await pool.fetchrow("INSERT INTO dishes (name) VALUES ($1) RETURNING *", input_["name"])
    except asyncpg.exceptions.UniqueViolationError:
        raise conflict("菜品名称已存在")
    return created(result)


@router.patch("/{dish_id}")
async def update_dish(dish_id: int, request: Request):
    pid = parse_id(dish_id)
    body = await read_json_object(request)
    input_ = dish_input(body, partial=True)
    pool = await get_pool()
    try:
        async with pool.acquire() as conn, conn.transaction():
            await lock_catalog_workflow(conn)
            current = await conn.fetchrow("SELECT * FROM dishes WHERE id=$1 AND deleted_at IS NULL FOR UPDATE", pid)
            if current is None:
                raise not_found("菜品")
            assert_version(body.get('expected_updated_at'), current['updated_at'], dict(current))
            result = await conn.fetchrow(
                "UPDATE dishes SET name=$1,updated_at=NOW() WHERE id=$2 RETURNING *", input_["name"], pid,
            )
    except asyncpg.exceptions.UniqueViolationError:
        raise conflict("菜品名称已存在")
    if result is None:
        raise not_found("菜品")
    return ok(result)


@router.delete("/{dish_id}")
async def delete_dish(dish_id: int):
    pid = parse_id(dish_id)
    pool = await get_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            await lock_catalog_workflow(conn)
            dish = await conn.fetchrow(
                "SELECT id FROM dishes WHERE id = $1 AND deleted_at IS NULL FOR UPDATE", pid,
            )
            if dish is None:
                raise not_found("菜品")
            plans = await conn.fetch(
                """SELECT p.name FROM meal_plans p
                   JOIN meal_plan_dishes mpd ON mpd.meal_plan_id = p.id
                   WHERE mpd.dish_id = $1
                   ORDER BY p.created_at DESC
                   FOR SHARE""",
                pid,
            )
            if plans:
                labels = [row["name"] or "未命名搭配" for row in plans]
                raise conflict("这道菜正在被搭配“" + "、".join(labels) + "”使用，请先编辑或删除这些搭配")
            pending_menus = await conn.fetch(
                """SELECT b.battle_date, b.meal_slot
                     FROM daily_battles b
                     JOIN daily_battle_dishes bd ON bd.daily_battle_id = b.id
                    WHERE bd.dish_id = $1 AND b.status = 'planned'
                    ORDER BY b.battle_date DESC, b.meal_slot DESC
                    FOR SHARE""",
                pid,
            )
            if pending_menus:
                slot_labels = {"breakfast": "早餐", "lunch": "午餐", "dinner": "晚餐"}
                labels = [f"{row['battle_date'].isoformat()} {slot_labels[row['meal_slot']]}" for row in pending_menus]
                raise conflict("这道菜正在被待完成菜单“" + "、".join(labels) + "”使用，请先调整这些菜单")
            result = await conn.fetchrow(
                """UPDATE dishes
                   SET deleted_at = NOW(), updated_at = NOW()
                   WHERE id = $1
                   RETURNING *""",
                pid,
            )
    return ok(result)


@router.get("/{dish_id}/meal-plans")
async def dish_meal_plans(dish_id: int):
    pid = parse_id(dish_id)
    pool = await get_pool()
    await _get_active_dish(pool, pid)
    rows = await pool.fetch(
        """SELECT p.id, p.name, p.created_at, p.updated_at, mpd.position
           FROM meal_plans p
           JOIN meal_plan_dishes mpd ON mpd.meal_plan_id = p.id
           WHERE mpd.dish_id = $1
           ORDER BY p.created_at DESC""",
        pid,
    )
    return ok(rows)
