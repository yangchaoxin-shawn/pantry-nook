"""菜单的备餐关联、乐观并发校验与整餐剩余量整理。"""
from datetime import datetime
from .errors import AppError, conflict, validation_error, not_found
from .validation import ensure_object_body, parse_id, optional_text


def assert_version(value, actual, current=None):
    if value is None:
        raise validation_error('请提供记录版本，读取最新数据后再保存')
    try:
        parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
    except (ValueError, TypeError, AttributeError):
        raise validation_error('核对版本格式不正确')
    if parsed.tzinfo is None:
        raise validation_error('核对版本必须包含时区')
    if parsed != actual:
        if current is not None:
            from .db import jsonable
            raise AppError(409, 'RECORD_CHANGED', '记录已更新，请核对最新内容后再保存。本次输入已保留。', {'current': jsonable(current)})
        raise conflict('记录已发生变化，请读取最新数据后重新核对')


async def attach_preparations(conn, items):
    if not items:
        return
    rows = await conn.fetch('''SELECT p.*, bd.daily_battle_id, bd.dish_id,
        i.name AS ingredient_name, i.status AS ingredient_status
        FROM daily_battle_preparations p
        JOIN daily_battle_dishes bd ON bd.id=p.daily_battle_dish_id
        LEFT JOIN ingredients i ON i.id=p.ingredient_id
        WHERE bd.daily_battle_id=ANY($1::bigint[])
        ORDER BY bd.position, p.position, p.id''', [i['id'] for i in items])
    by_id = {i['id']: i for i in items}
    for item in items:
        item['preparations'] = []
    for row in rows:
        result = dict(row)
        bid = result.pop('daily_battle_id')
        by_id[bid]['preparations'].append(result)


async def save_preparations(conn, battle_id, raw):
    if not isinstance(raw, list) or len(raw) > 500:
        raise validation_error('备餐食材必须是数组，最多500项')
    dishes = await conn.fetch('SELECT id,dish_id FROM daily_battle_dishes WHERE daily_battle_id=$1', battle_id)
    dish_map = {r['dish_id']: r['id'] for r in dishes}
    values, seen = [], set()
    for position, item in enumerate(raw):
        item = ensure_object_body(item)
        did = parse_id(item.get('dish_id'))
        if did not in dish_map:
            raise validation_error('备餐食材必须关联本菜单中的菜品')
        raw_id = item.get('ingredient_id')
        pending_name = optional_text(item.get('pending_ingredient_name'), 'pending_ingredient_name', 255)
        if raw_id in (None, ''):
            if not pending_name:
                raise validation_error('每项耗材请选择库存食材，或填写待购买食材名称')
            key = (did, 'pending', pending_name.casefold())
            ingredient_id = None
        else:
            if pending_name:
                raise validation_error('一项耗材不能同时关联库存和待购买名称')
            ingredient_id = parse_id(raw_id, 'ingredient_id')
            key = (did, 'inventory', ingredient_id)
        if key in seen:
            raise validation_error('同一道菜不能重复选择同一种耗材')
        seen.add(key)
        values.append((dish_map[did], ingredient_id, pending_name, optional_text(item.get('planned_quantity_text'), 'planned_quantity_text'), position))
    ids = list({v[1] for v in values if v[1] is not None})
    if ids:
        count = await conn.fetchval("SELECT COUNT(*) FROM ingredients WHERE id=ANY($1::bigint[]) AND status='active'", ids)
        if count != len(ids):
            raise conflict('所选食材已不在库，请重新选择')
    await conn.execute('DELETE FROM daily_battle_preparations WHERE daily_battle_dish_id=ANY($1::bigint[])', list(dish_map.values()))
    if values:
        await conn.executemany('''INSERT INTO daily_battle_preparations
            (daily_battle_dish_id,ingredient_id,pending_ingredient_name,planned_quantity_text,position) VALUES ($1,$2,$3,$4,$5)''', values)
    return None
