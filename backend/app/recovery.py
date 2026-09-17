"""安全撤销与同名库存合并；调用者持有库存事务锁，整次操作原子提交。"""
from collections import defaultdict
from decimal import Decimal
from .errors import AppError, conflict, not_found, validation_error
from .menu_workflow import assert_version
from .quantity import render_stock
from .validation import ensure_object_body, optional_number, parse_id, required_text

FACTORS = {'g': ('mass', Decimal(1)), 'kg': ('mass', Decimal(1000)), '斤': ('mass', Decimal(500)),
           'ml': ('volume', Decimal(1)), 'L': ('volume', Decimal(1000))}


def convert(value, source, target):
    if source == target:
        return Decimal(value)
    a, b = FACTORS.get(source), FACTORS.get(target)
    return Decimal(value) * a[1] / b[1] if a and b and a[0] == b[0] else None


def changed():
    return AppError(409, 'RECORD_CHANGED', '库存或记录已更新，请重新读取恢复预览后核对。本次未保存。')


async def load(conn, kind, ident):
    if kind == 'adjustment':
        root = await conn.fetchrow('SELECT * FROM inventory_adjustments WHERE id=$1', ident)
        if root is None:
            raise not_found('库存处理记录')
        if root['status'] != 'active':
            raise conflict('这条库存处理已撤销')
        events = [dict(root)]
        stamp = root['stock_after_updated_at']
    else:
        root = await conn.fetchrow('SELECT * FROM daily_battles WHERE id=$1', ident)
        if root is None:
            raise not_found('菜单')
        if root['status'] != 'confirmed':
            raise conflict('只有已确认的菜单可以撤销')
        events = [dict(r) for r in await conn.fetch("SELECT * FROM consumptions WHERE daily_battle_id=$1 AND status='active' ORDER BY id", ident)]
        stamp = root['confirmed_at']
    groups = defaultdict(list)
    for event in events:
        groups[event['ingredient_id']].append(event)
    rows = []
    prefix = 'stock' if kind == 'adjustment' else 'remaining'
    for iid, group in sorted(groups.items()):
        old = await conn.fetchrow('SELECT * FROM ingredients WHERE id=$1', iid)
        first, last = group[0], group[-1]
        if old is None:
            raise not_found('原食材记录')
        unchanged = old['updated_at'] == stamp and old['stock_value'] == last[prefix+'_after_value'] and old['stock_text'] == last[prefix+'_after_text'] and old['status'] == last['ingredient_status_after'] and old['ended_at'] == last['ingredient_ended_at_after']
        if kind == 'battle' and not unchanged:
            raise conflict('相关库存已有后续变更，不能安全撤销；请到库存核对')
        unit = first['stock_before_unit'] if kind == 'adjustment' else first['quantity_unit']
        restored = Decimal(first[prefix+'_before_value']) - Decimal(last[prefix+'_after_value'])
        target = await conn.fetchrow("SELECT * FROM ingredients WHERE status='active' AND LOWER(btrim(name))=LOWER(btrim($1)) AND id<>$2", old['name'], iid)
        if target and (old['status'] == 'active' or old['stock_value'] != 0):
            raise conflict('旧库存状态异常，不能合并恢复')
        # 独立库存处理撤销只补回该次数量，不覆盖之后的补货、消耗或盘点结果。
        if kind == 'adjustment' and not target and not unchanged:
            target = old
        rows.append({'source': dict(old), 'target': dict(target) if target else None,
                     'events': group, 'restored_value': restored, 'restored_unit': unit,
                     'before_value': first[prefix+'_before_value'], 'before_text': first[prefix+'_before_text'],
                     'before_status': first['ingredient_status_before'], 'before_ended': first['ingredient_ended_at_before']})
    return dict(root), rows


def preview(root, rows):
    items = []
    for row in rows:
        source, target = row['source'], row['target']
        amount = convert(row['restored_value'], row['restored_unit'], target['stock_unit']) if target else None
        items.append({'source_ingredient_id': source['id'], 'source_updated_at': source['updated_at'], 'name': source['name'],
                      'restored_value': row['restored_value'], 'restored_unit': row['restored_unit'],
                      'target_ingredient_id': target['id'] if target else None, 'target_updated_at': target['updated_at'] if target else None,
                      'target_value': target['stock_value'] if target else None, 'target_unit': target['stock_unit'] if target else None,
                      'suggested_value': target['stock_value'] + amount if target and amount is not None else None})
    return {'expected_updated_at': root['updated_at'], 'items': items}


async def apply(conn, kind, ident, body, root, rows):
    raw = body.get('merge_resolutions', [])
    if not isinstance(raw, list):
        raise validation_error('merge_resolutions 必须是数组')
    if len(raw) > 500:
        raise validation_error('一次最多处理 500 项合并')
    choices = {}
    for raw_item in raw:
        entry = ensure_object_body(raw_item)
        iid = parse_id(entry.get('source_ingredient_id'))
        if iid in choices:
            raise validation_error('不能重复选择同一食材')
        choices[iid] = entry
    required = {r['source']['id'] for r in rows if r['target']}
    if choices.keys() - required:
        raise changed()
    if required - choices.keys():
        raise AppError(409, 'MERGE_REQUIRED', '库存已有变化，请核对本次恢复数量')
    if required or 'expected_updated_at' in body:
        try:
            assert_version(body.get('expected_updated_at'), root['updated_at'])
        except AppError as exc:
            if exc.status == 409:
                raise changed()
            raise
    for row in rows:
        source, target = row['source'], row['target']
        if target:
            entry = choices[source['id']]
            if parse_id(entry.get('target_ingredient_id')) != target['id']:
                raise changed()
            for field, actual in [('source_updated_at', source['updated_at']), ('target_updated_at', target['updated_at'])]:
                try:
                    assert_version(entry.get(field), actual)
                except AppError as exc:
                    if exc.status == 409:
                        raise changed()
                    raise
            unit = required_text(entry.get('stock_unit'), 'stock_unit', 50)
            if unit not in (row['restored_unit'], target['stock_unit']):
                raise validation_error('请选择原库存或现有库存的单位')
            before = convert(target['stock_value'], target['stock_unit'], unit)
            recovered = convert(row['restored_value'], row['restored_unit'], unit)
            manual = before is None or recovered is None
            value = optional_number(entry.get('final_stock_value'), '合并后的数量', min_value=0, exclusive_min=True) if manual else before + recovered
            if value is None:
                raise validation_error('请填写合并后的实际库存量')
            optional_number(value, '合并后的数量', min_value=0, exclusive_min=True)
            text = required_text(entry.get('final_stock_text'), 'final_stock_text') if manual else render_stock(value)
            await conn.execute("UPDATE ingredients SET stock_value=$1,stock_text=$2,stock_unit=$3,status='active',ended_at=NULL,updated_at=NOW() WHERE id=$4", value, text, unit, target['id'])
            # 多菜共用一项食材时，各来源保留各自恢复量；目标快照是同一事务的整体前后值。
            event_amounts = []
            for event in row['events']:
                if kind == 'adjustment':
                    event_amounts.append(Decimal(event['stock_before_value']) - Decimal(event['stock_after_value']))
                else:
                    event_amounts.append(Decimal(event['quantity_value'] or 0))
            if event_amounts:
                # 分数按六位存储时，把汇总尾差归到最后一条，确保逐项审计之和等于实际恢复总量。
                event_amounts[-1] += Decimal(row['restored_value']) - sum(event_amounts, Decimal(0))
            for event, restored in zip(row['events'], event_amounts):
                await conn.execute('''INSERT INTO inventory_recovery_merges
                    (adjustment_id,consumption_id,source_ingredient_id,target_ingredient_id,restored_text,restored_value,restored_unit,
                     target_before_text,target_before_value,target_before_unit,target_after_text,target_after_value,target_after_unit,calculation_mode)
                    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)''',
                    event['id'] if kind == 'adjustment' else None, event['id'] if kind == 'battle' else None,
                    source['id'], target['id'], render_stock(restored), restored, row['restored_unit'],
                    target['stock_text'], target['stock_value'], target['stock_unit'], text, value, unit, 'manual' if manual else 'converted')
            if kind == 'battle':
                await conn.execute('''UPDATE daily_battle_preparations SET ingredient_id=$1,planned_quantity_text=NULL,updated_at=NOW()
                    WHERE ingredient_id=$2 AND daily_battle_dish_id IN (SELECT id FROM daily_battle_dishes WHERE daily_battle_id=$3)''', target['id'], source['id'], ident)
        else:
            await conn.execute('''UPDATE ingredients SET stock_text=$1,stock_value=$2,status=$3,ended_at=$4,updated_at=NOW() WHERE id=$5''',
                               row['before_text'], row['before_value'], row['before_status'], row['before_ended'], source['id'])
    if kind == 'adjustment':
        await conn.execute("UPDATE inventory_adjustments SET status='reversed',reversed_at=NOW(),updated_at=NOW() WHERE id=$1", ident)
    else:
        await conn.execute("UPDATE consumptions SET status='reversed',reversed_at=NOW(),updated_at=NOW() WHERE daily_battle_id=$1 AND status='active'", ident)


async def attach_merges(conn, items, kind):
    column = 'adjustment_id' if kind == 'adjustment' else 'consumption_id'
    if not items:
        return items
    grouped = defaultdict(list)
    rows = await conn.fetch(
        'SELECT m.*,i.name AS target_name FROM inventory_recovery_merges m JOIN ingredients i ON i.id=m.target_ingredient_id WHERE m.'+column+'=ANY($1::bigint[]) ORDER BY m.id',
        [item['id'] for item in items])
    for row in rows:
        grouped[row[column]].append(dict(row))
    for item in items:
        item['recovery_merges'] = grouped[item['id']]
    return items
