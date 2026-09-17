"""库存处理记录的全局查询视图。"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Request

from ..db import get_pool
from ..responses import ok
from ..validation import enum_value, pagination

router = APIRouter()

ADJUSTMENT_STATUSES = ["active", "reversed"]
REASONS = ["used", "spoiled", "damaged", "other"]


@router.get("")
async def list_adjustments(request: Request):
    query = dict(request.query_params)
    limit, offset = pagination(query).values()
    conditions: list[str] = []
    values: list[Any] = []

    if "status" in query:
        values.append(enum_value(query["status"], "status", ADJUSTMENT_STATUSES))
        conditions.append(f"a.status=${len(values)}")
    if "reason" in query:
        values.append(enum_value(query["reason"], "reason", REASONS))
        conditions.append(f"a.reason=${len(values)}")

    where = f"WHERE {' AND '.join(conditions)}" if conditions else ""
    values.extend([limit, offset])
    pool = await get_pool()
    rows = await pool.fetch(
        f"""SELECT a.*, i.name AS ingredient_name, i.category,
                   COUNT(*) OVER()::int AS total_count
            FROM inventory_adjustments a
            JOIN ingredients i ON i.id = a.ingredient_id
            {where}
            ORDER BY CASE WHEN a.status = 'active' THEN 0 ELSE 1 END,
                     a.created_at DESC, a.id DESC
            LIMIT ${len(values) - 1} OFFSET ${len(values)}""",
        *values,
    )
    total = rows[0]["total_count"] if rows else 0
    if not rows and offset:
        total = await pool.fetchval(
            f"""SELECT COUNT(*) FROM inventory_adjustments a
                JOIN ingredients i ON i.id = a.ingredient_id {where}""",
            *values[:-2],
        )
    records = [dict(row) for row in rows]
    for record in records:
        record.pop("total_count", None)
    from ..recovery import attach_merges
    await attach_merges(pool, records, "adjustment")
    return ok(records, {"total": int(total), "limit": limit, "offset": offset})
