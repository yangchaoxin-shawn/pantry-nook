"""消耗记录（consumptions）路由与业务逻辑。

消耗只在今日作战确认时产生，此处为查询视图。
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Request

from ..db import get_pool
from ..errors import not_found
from ..responses import ok
from ..validation import enum_value, optional_date, pagination, parse_id, required_text

router = APIRouter()

CONSUMPTION_STATUSES = ["active", "reversed"]


@router.get("")
async def list_consumptions(request: Request):
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
    if q.get("daily_battle_id") is not None:
        values.append(parse_id(q["daily_battle_id"], "daily_battle_id"))
        conditions.append(f"c.daily_battle_id = ${len(values)}")
    if q.get("ingredient_id") is not None:
        values.append(parse_id(q["ingredient_id"], "ingredient_id"))
        conditions.append(f"c.ingredient_id = ${len(values)}")
    if q.get("status") is not None:
        values.append(enum_value(q["status"], "status", CONSUMPTION_STATUSES))
        conditions.append(f"c.status = ${len(values)}")
    if q.get("q") is not None:
        query = required_text(q["q"], "q", 100)
        values.append(f"%{query}%")
        conditions.append(f"""(
            i.name ILIKE ${len(values)}
            OR c.quantity_used_text ILIKE ${len(values)}
            OR COALESCE(c.note, '') ILIKE ${len(values)}
        )""")

    where = f"WHERE {' AND '.join(conditions)}" if conditions else ""
    values.extend([limit, offset])

    pool = await get_pool()
    rows = await pool.fetch(
        f"""SELECT c.*, b.battle_date, b.status AS battle_status,
                   i.name AS ingredient_name, i.category,
                   bd.dish_name AS daily_battle_dish_name,
                   COUNT(*) OVER()::int AS total_count
            FROM consumptions c
            JOIN daily_battles b ON b.id = c.daily_battle_id
            JOIN ingredients i ON i.id = c.ingredient_id
            LEFT JOIN daily_battle_dishes bd ON bd.id = c.daily_battle_dish_id
            {where}
            ORDER BY b.battle_date DESC, c.created_at DESC, c.id DESC
            LIMIT ${len(values) - 1} OFFSET ${len(values)}""",
        *values,
    )
    total = rows[0]["total_count"] if rows else 0
    if not rows and offset:
        total = await pool.fetchval(
            f"""SELECT COUNT(*) FROM consumptions c
                JOIN daily_battles b ON b.id = c.daily_battle_id
                JOIN ingredients i ON i.id = c.ingredient_id {where}""",
            *values[:-2],
        )
    items = [dict(r) for r in rows]
    for item in items:
        item.pop("total_count", None)
    from ..recovery import attach_merges
    await attach_merges(pool, items, "battle")
    return ok(items, {"total": int(total), "limit": limit, "offset": offset})


@router.get("/{consumption_id}")
async def get_consumption(consumption_id: int):
    pid = parse_id(consumption_id)
    pool = await get_pool()
    result = await pool.fetchrow(
        """SELECT c.*, b.battle_date, b.status AS battle_status,
                  i.name AS ingredient_name, i.category,
                  bd.dish_name AS daily_battle_dish_name
           FROM consumptions c
           JOIN daily_battles b ON b.id = c.daily_battle_id
           JOIN ingredients i ON i.id = c.ingredient_id
           LEFT JOIN daily_battle_dishes bd ON bd.id = c.daily_battle_dish_id
           WHERE c.id = $1""",
        pid,
    )
    if result is None:
        raise not_found("消耗记录")
    from ..recovery import attach_merges
    result = dict(result)
    await attach_merges(pool, [result], "battle")
    return ok(result)
