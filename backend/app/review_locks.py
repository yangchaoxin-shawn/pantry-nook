"""短时核对锁定：锁住可用量，不在确认前改写物理库存。"""

from __future__ import annotations

from decimal import Decimal

from .errors import conflict


async def release_expired(conn) -> None:
    await conn.execute("DELETE FROM daily_battle_review_locks WHERE expires_at <= NOW()")


async def reserved_by_ingredient(conn, ingredient_ids: list[int], *, excluding_battle_id: int | None = None) -> dict[int, Decimal]:
    if not ingredient_ids:
        return {}
    params: list[object] = [ingredient_ids]
    clause = "ingredient_id = ANY($1::bigint[]) AND expires_at > NOW()"
    if excluding_battle_id is not None:
        params.append(excluding_battle_id)
        clause += " AND daily_battle_id <> $2"
    rows = await conn.fetch(
        f"SELECT ingredient_id, SUM(quantity_value) AS quantity FROM daily_battle_review_locks WHERE {clause} GROUP BY ingredient_id",
        *params,
    )
    return {int(row["ingredient_id"]): Decimal(row["quantity"]) for row in rows}


async def assert_remaining_after_change(conn, ingredient_id: int, remaining: Decimal) -> None:
    """Prevent a direct inventory reduction or disposal from consuming another meal's lock."""
    locks = await reserved_by_ingredient(conn, [ingredient_id])
    if remaining < locks.get(ingredient_id, Decimal(0)):
        raise conflict("该食材已有正在核对的菜单锁定用量；请先完成或退出核对，再减少库存")
