"""搭配方案（meal-plans）路由与业务逻辑。

搭配方案是模板，只引用菜品 ID，不直接关联库存。
"""

from __future__ import annotations

from typing import Any

import asyncpg
from fastapi import APIRouter, Request

from ..db import get_pool, lock_catalog_workflow
from ..errors import conflict, not_found, validation_error
from ..responses import created, ok
from ..validation import ensure_object_body, optional_text, pagination, parse_id

router = APIRouter()


def plan_signature(ids: list[int]) -> str:
    """菜品集合决定搭配身份；显示顺序不参与重复判断。"""
    return ",".join(str(id_) for id_ in sorted(ids))


def public_plan(row: dict) -> dict:
    result = dict(row)
    result.pop("dish_signature", None)
    return result


def duplicate_conflict(exc: asyncpg.UniqueViolationError):
    if exc.constraint_name == "meal_plans_normalized_name_unique":
        return conflict("搭配名称已经存在，请编辑原搭配或换一个名称")
    return conflict("已经存在相同菜品组合，请直接使用或编辑原搭配")


def dish_ids(value: Any) -> list[int]:
    if not isinstance(value, list) or len(value) == 0:
        raise validation_error("dish_ids 必须是至少包含一个菜品 ID 的数组")
    if len(value) > 50:
        raise validation_error("一个搭配方案最多包含 50 个菜品")
    ids = [parse_id(item, "dish_ids") for item in value]
    if len(set(ids)) != len(ids):
        raise validation_error("dish_ids 不能包含重复菜品")
    return ids


def plan_input(body: dict, partial: bool = False) -> dict:
    input_: dict[str, Any] = {}
    has = lambda f: f in body

    if not partial or has("name"):
        input_["name"] = optional_text(body.get("name"), "name")
    if not partial or has("dish_ids"):
        input_["dish_ids"] = dish_ids(body.get("dish_ids"))
    if partial and len(input_) == 0:
        raise validation_error("至少需要提供一个可修改字段")
    return input_


async def _find_dishes(pool, ids: list[int]) -> None:
    rows = await pool.fetch("SELECT id FROM dishes WHERE id = ANY($1::bigint[]) AND deleted_at IS NULL", ids)
    if len(rows) != len(ids):
        raise not_found("菜品")


async def _assert_unique(pool, name: str | None, signature: str, exclude_id: int | None = None) -> None:
    same_dishes = await pool.fetchrow(
        "SELECT id, name FROM meal_plans WHERE dish_signature = $1 AND ($2::bigint IS NULL OR id <> $2) LIMIT 1",
        signature,
        exclude_id,
    )
    if same_dishes is not None:
        label = same_dishes["name"] or "未命名搭配"
        raise conflict(f"已经存在相同搭配“{label}”，请直接使用或编辑")
    if name is None:
        return
    same_name = await pool.fetchrow(
        "SELECT id FROM meal_plans WHERE LOWER(btrim(name)) = LOWER(btrim($1)) AND ($2::bigint IS NULL OR id <> $2) LIMIT 1",
        name,
        exclude_id,
    )
    if same_name is not None:
        raise conflict(f"搭配名称“{name}”已经存在，请编辑原搭配或换一个名称")


async def _get_plan(pool, id_: int, lock: bool = False) -> dict:
    if lock:
        locked = await pool.fetchrow("SELECT id FROM meal_plans WHERE id = $1 FOR UPDATE", id_)
        if locked is None:
            raise not_found("搭配方案")

    rows = await pool.fetch(
        """SELECT p.*,
                  COALESCE(
                    (SELECT json_agg(
                      json_build_object('id', d.id, 'name', d.name, 'position', mpd.position)
                      ORDER BY mpd.position
                    ) FILTER (WHERE d.id IS NOT NULL)
                    FROM meal_plan_dishes mpd
                    LEFT JOIN dishes d ON d.id = mpd.dish_id
                    WHERE mpd.meal_plan_id = p.id
                    ), '[]'::json) AS dishes
           FROM meal_plans p
           WHERE p.id = $1
           GROUP BY p.id""",
        id_,
    )
    if len(rows) == 0:
        raise not_found("搭配方案")
    return public_plan(dict(rows[0]))


@router.get("")
async def list_plans(request: Request):
    q = dict(request.query_params)
    limit, offset = pagination(q).values()
    pool = await get_pool()
    rows = await pool.fetch(
        """SELECT p.*,
                  COALESCE(
                    (SELECT json_agg(
                      json_build_object('id', d.id, 'name', d.name, 'position', mpd.position)
                      ORDER BY mpd.position
                    ) FILTER (WHERE d.id IS NOT NULL)
                    FROM meal_plan_dishes mpd
                    LEFT JOIN dishes d ON d.id = mpd.dish_id
                    WHERE mpd.meal_plan_id = p.id
                    ), '[]'::json) AS dishes,
                  COUNT(*) OVER()::int AS total_count
           FROM meal_plans p
           GROUP BY p.id
           ORDER BY p.created_at DESC
           LIMIT $1 OFFSET $2""",
        limit, offset,
    )
    total = rows[0]["total_count"] if rows else 0
    if not rows and offset:
        total = await pool.fetchval("SELECT COUNT(*) FROM meal_plans")
    items = [dict(r) for r in rows]
    for item in items:
        item.pop("total_count", None)
        item.pop("dish_signature", None)
    return ok(items, {"total": int(total), "limit": limit, "offset": offset})


@router.get("/{plan_id}")
async def get_plan(plan_id: int):
    pid = parse_id(plan_id)
    pool = await get_pool()
    return ok(await _get_plan(pool, pid))


@router.post("")
async def create_plan(request: Request):
    body = ensure_object_body(await request.json())
    input_ = plan_input(body)
    pool = await get_pool()
    signature = plan_signature(input_["dish_ids"])
    try:
        async with pool.acquire() as conn:
            async with conn.transaction():
                await lock_catalog_workflow(conn)
                await _find_dishes(conn, input_["dish_ids"])
                await _assert_unique(conn, input_.get("name"), signature)
                plan = await conn.fetchrow(
                    "INSERT INTO meal_plans (name, dish_signature) VALUES ($1, $2) RETURNING id",
                    input_.get("name"),
                    signature,
                )
                for position, dish_id in enumerate(input_["dish_ids"]):
                    await conn.execute(
                        "INSERT INTO meal_plan_dishes (meal_plan_id, dish_id, position) VALUES ($1, $2, $3)",
                        plan["id"], dish_id, position,
                    )
                result = await _get_plan(conn, plan["id"])
    except asyncpg.UniqueViolationError as exc:
        raise duplicate_conflict(exc) from exc
    return created(result)


@router.patch("/{plan_id}")
async def update_plan(plan_id: int, request: Request):
    pid = parse_id(plan_id)
    body = ensure_object_body(await request.json())
    input_ = plan_input(body, partial=True)
    pool = await get_pool()
    try:
        async with pool.acquire() as conn:
            async with conn.transaction():
                await lock_catalog_workflow(conn)
                current = await _get_plan(conn, pid, lock=True)
                final_ids = input_.get("dish_ids", [dish["id"] for dish in current["dishes"]])
                final_name = input_.get("name", current["name"])
                signature = plan_signature(final_ids)
                if "dish_ids" in input_:
                    await _find_dishes(conn, final_ids)
                await _assert_unique(conn, final_name, signature, pid)
                if "dish_ids" in input_:
                    await conn.execute("DELETE FROM meal_plan_dishes WHERE meal_plan_id = $1", pid)
                    for position, dish_id in enumerate(final_ids):
                        await conn.execute(
                            "INSERT INTO meal_plan_dishes (meal_plan_id, dish_id, position) VALUES ($1, $2, $3)",
                            pid, dish_id, position,
                        )
                await conn.execute(
                    "UPDATE meal_plans SET name = $1, dish_signature = $2, updated_at = NOW() WHERE id = $3",
                    final_name,
                    signature,
                    pid,
                )
                result = await _get_plan(conn, pid)
    except asyncpg.UniqueViolationError as exc:
        raise duplicate_conflict(exc) from exc
    return ok(result)


@router.delete("/{plan_id}")
async def delete_plan(plan_id: int):
    pid = parse_id(plan_id)
    pool = await get_pool()
    result = await pool.fetchrow("DELETE FROM meal_plans WHERE id = $1 RETURNING *", pid)
    if result is None:
        raise not_found("搭配方案")
    return ok(public_plan(dict(result)))
