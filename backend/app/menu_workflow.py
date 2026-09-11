"""菜单的备餐关联、乐观并发校验与整餐剩余量整理。"""
from datetime import datetime
from .errors import conflict, validation_error, not_found
from .validation import ensure_object_body, parse_id, optional_text, optional_number, required_text


def assert_version(value, actual):
    if value is None:
        return  # 兼容旧客户端；新确认流程必传库存版本和菜单版本。
    try:
        parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
    except (ValueError, TypeError, AttributeError):
        raise validation_error('核对版本格式不正确')
    if parsed.tzinfo is None:
        raise validation_error('核对版本必须包含时区')
    if parsed != actual:
        raise conflict('记录已发生变化，请读取最新数据后重新核对')


async def attach_preparations(conn, items):
    if not items:
        return
    rows = await conn.fetch('''SELECT p.*, bd.daily_battle_id, bd.dish_id,
        i.name AS ingredient_name, i.status AS ingredient_status
        FROM daily_battle_preparations p
        JOIN daily_battle_dishes bd ON bd.id=p.daily_battle_dish_id
        JOIN ingredients i ON i.id=p.ingredient_id
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
        did, iid = parse_id(item.get('dish_id')), parse_id(item.get('ingredient_id'))
        if did not in dish_map:
            raise validation_error('备餐食材必须关联本菜单中的菜品')
        if (did, iid) in seen:
            raise validation_error('同一道菜不能重复选择同一条库存')
        seen.add((did, iid))
        values.append((dish_map[did], iid, optional_text(item.get('planned_quantity_text'), 'planned_quantity_text'), position))
    ids = list({v[1] for v in values})
    if ids:
        count = await conn.fetchval("SELECT COUNT(*) FROM ingredients WHERE id=ANY($1::bigint[]) AND status='active'", ids)
        if count != len(ids):
            raise conflict('所选食材已不在库，请重新选择')
    await conn.execute('DELETE FROM daily_battle_preparations WHERE daily_battle_dish_id=ANY($1::bigint[])', list(dish_map.values()))
    if values:
        await conn.executemany('''INSERT INTO daily_battle_preparations
            (daily_battle_dish_id,ingredient_id,planned_quantity_text,position) VALUES ($1,$2,$3,$4)''', values)


def apply_totals(body, inputs, ingredients):
    """新客户端每条库存只核对一次余量，分菜保留实际用量，不推测文字单位。

    前几道菜的账面快照保持原量，最后一条记整餐变化；所有行同事务提交，
    逆序撤销可靠复原。中间快照只是记账边界，不宣称逐菜测量过余量。
    """
    if 'ingredient_totals' not in body:
        return
    raw = body['ingredient_totals']
    if not isinstance(raw, list) or len(raw) > 500:
        raise validation_error('实际剩余必须是数组，最多500项')
    totals = {}
    for row in raw:
        row = ensure_object_body(row)
        iid = parse_id(row.get('ingredient_id'))
        if iid in totals:
            raise validation_error('每条库存只填写一次整餐剩余量')
        totals[iid] = {
            'remaining_text': required_text(row.get('stock_text'), 'stock_text'),
            'remaining_value': optional_number(row.get('stock_value'), 'stock_value'),
        }
        if iid not in ingredients:
            raise validation_error('实际剩余必须对应本次使用的食材')
        if not row.get('expected_updated_at'):
            raise validation_error('请刷新库存后核对用料')
        assert_version(row['expected_updated_at'], ingredients[iid]['row']['updated_at'])
    if set(totals) != set(ingredients):
        raise validation_error('请为每条实际使用的库存填写整餐剩余量')
    last = {inp['ingredient_id']: pos for pos, inp in enumerate(inputs)}
    for pos, inp in enumerate(inputs):
        iid = inp['ingredient_id']
        if pos == last[iid]:
            inp.update(totals[iid])
        else:
            original = ingredients[iid]['row']
            inp['remaining_text'] = original['stock_text']
            inp['remaining_value'] = original['stock_value']
        # 这个模式实际量为原文，计算字段由整餐剩余唯一决定。
        inp.pop('quantity_value', None)
