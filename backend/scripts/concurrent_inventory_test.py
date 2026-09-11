"""双人共享的库存/确认定向回归；只写隔离测试库。"""
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
import re
import urllib.request
import regression_test as t


def stock(i):
    return t.data('GET', f"/api/ingredients/{i['id']}")


def menu(ingredients, dishes):
    return t.data('POST', '/api/daily-battles', {
        'battle_date': '2026-09-11', 'meal_slot': 'dinner', 'dish_ids': [d['id'] for d in dishes],
        'preparations': [{'dish_id': d['id'], 'ingredient_id': i['id'], 'planned_quantity_text': '1' + i['stock_unit']}
                         for d, i in zip(dishes, ingredients)],
    }, 201)


def confirmation(b, items, used=1):
    ids = list(dict.fromkeys(i['id'] for i in items))
    return {'expected_updated_at': b['updated_at'],
            'consumptions': [{'ingredient_id': i['id'], 'daily_battle_dish_id': d['id'], 'quantity_used_text': str(used)}
                             for i, d in zip(items, b['dishes'])],
            'ingredient_totals': [{'ingredient_id': iid, 'stock_value': (i := next(i for i in items if i['id'] == iid))['stock_value'] - used * sum(v['id'] == iid for v in items),
                                   'stock_text': str(i['stock_value'] - used * sum(v['id'] == iid for v in items)),
                                   'expected_updated_at': i['updated_at']} for iid in ids]}


def confirm(b, payload):
    return t.request('POST', f"/api/daily-battles/{b['id']}/confirm", payload)


def parallel(actions):
    barrier = Barrier(len(actions))
    def run(action):
        barrier.wait(timeout=10)
        return action()
    with ThreadPoolExecutor(max_workers=len(actions)) as executor:
        return list(executor.map(run, actions))


def main():
    with urllib.request.urlopen(t.BASE + '/health') as response:
        assert re.fullmatch(r'pantry_nook_test_[0-9a-f]{32}', response.headers.get('X-Pantry-Nook-Test-Database', '')), '拒绝非隔离库'
    dishes = [t.data('POST', '/api/dishes', {'name': f'双人菜{n}-{t.STAMP}'}, 201) for n in range(2)]
    item = t.ingredient(f'双人鸡蛋-{t.STAMP}', value=10)
    b = menu([item], dishes[:1])
    old_payload = confirmation(b, [item])
    fresh = t.ingredient(item['name'], value=2)
    t.check('备餐期间补货累加，草稿不扣除', fresh['stock_value'] == 12)
    t.check('旧核对快照确认被拒', confirm(b, old_payload)[0] == 409)
    t.check('冲突不写消耗也不改菜单', t.data('GET', f"/api/daily-battles/{b['id']}")['status'] == 'planned' and not t.data('GET', f"/api/daily-battles/{b['id']}/consumptions"))
    t.check('旧库存编辑不能覆盖补货', t.request('PATCH', f"/api/ingredients/{item['id']}", {'stock_value': 9, 'expected_updated_at': item['updated_at']})[0] == 409)
    payload = confirmation(b, [fresh], 2)
    results = parallel([lambda: confirm(b, payload), lambda: confirm(b, payload)])
    t.check('两人同时首次确认，一次成功一次冲突', sorted(r[0] for r in results) == [200, 409])
    t.check('只扣一次且只写一条消耗', stock(item)['stock_value'] == 10 and len(t.data('GET', f"/api/daily-battles/{b['id']}/consumptions")) == 1)
    current = stock(item)
    t.data('PATCH', f"/api/ingredients/{item['id']}", {'stock_unit': '盒', 'expected_updated_at': current['updated_at']})
    t.check('相同数值但后续改单位也不能撤销覆盖', t.request('POST', f"/api/daily-battles/{b['id']}/revoke-confirmation", {})[0] == 409)

    shared = t.ingredient(f'共享番茄-{t.STAMP}', value=3)
    first, second = menu([shared], dishes[:1]), menu([shared], dishes[:1])
    results = parallel([lambda: confirm(first, confirmation(first, [shared], 2)), lambda: confirm(second, confirmation(second, [shared], 2))])
    t.check('不同餐争用同一库存，过期版本被拒', sorted(r[0] for r in results) == [200, 409] and stock(shared)['stock_value'] == 1)
    loser = first if results[0][0] == 409 else second
    t.check('刷新后仍不足不会变成负库存', confirm(loser, confirmation(loser, [stock(shared)], 2))[0] == 400 and stock(shared)['stock_value'] == 1)

    waste_item = t.ingredient(f'待餐西兰花-{t.STAMP}', value=3)
    waste_menu = menu([waste_item], dishes[:1])
    def waste(i, amount):
        return t.data('POST', f"/api/ingredients/{i['id']}/waste", {'stock_value': amount, 'stock_unit': i['stock_unit'], 'reason': 'spoiled', 'expected_updated_at': i['updated_at']}, 201)
    adjustment = waste(waste_item, 1)
    t.check('待餐时可部分报废', adjustment['inventory']['stock_value'] == 2)
    t.data('POST', f"/api/ingredients/adjustments/{adjustment['adjustment']['id']}/revoke")
    t.check('待餐时可安全撤销报废', stock(waste_item)['stock_value'] == 3)
    before_waste = stock(waste_item)
    waste(before_waste, 3)
    t.check('核对中全报废后不能确认', confirm(waste_menu, confirmation(waste_menu, [before_waste]))[0] in [400, 409])

    egg, rice = t.ingredient(f'恢复鸡蛋-{t.STAMP}', value=6), t.ingredient(f'恢复大米-{t.STAMP}', value=500, unit='g')
    multi = menu([egg, rice], dishes)
    result = confirm(multi, confirmation(multi, [egg, rice]))
    t.check('多单位确认成功', result[0] == 200)
    records = t.data('GET', f"/api/daily-battles/{multi['id']}/consumptions")
    t.check('每条历史保留各自单位', {r['ingredient_id']: r['quantity_unit'] for r in records} == {egg['id']: '个', rice['id']: 'g'})
    t.data('POST', f"/api/daily-battles/{multi['id']}/revoke-confirmation", {})
    egg = stock(egg)
    double = menu([egg, egg], dishes)
    t.check('同食材跨两菜合计扣除', confirm(double, confirmation(double, [egg, egg]))[0] == 200 and stock(egg)['stock_value'] == 4)
    t.data('POST', f"/api/daily-battles/{double['id']}/revoke-confirmation", {})
    t.check('同食材多条消耗撤销完整恢复', stock(egg)['stock_value'] == 6)
    manual_merge_conflict()
    # 只取消本脚本留下的待完成记录，便于继续隔离浏览器测试。
    for pending in t.data('GET', '/api/daily-battles?status=planned&limit=100'):
        if any(t.STAMP in d['name'] for d in pending['dishes']):
            t.data('POST', f"/api/daily-battles/{pending['id']}/cancel")


def manual_merge_conflict():
    item = t.ingredient(f'人工合并大米-{t.STAMP}', value=5, unit='斤')
    incoming = {'name': item['name'], 'category': item['category'], 'stock_text': '1', 'stock_value': 1, 'stock_unit': '袋'}
    choice = {'ingredient_id': item['id'], 'stock_unit': '斤', 'final_stock_text': '7', 'final_stock_value': 7}
    payload = {'items': [incoming], 'resolutions': [choice]}
    t.check('人工合并必须带库存版本', t.request('POST', '/api/ingredients/batch', payload)[0] == 400)
    fresh = t.ingredient(item['name'], value=1, unit='斤')
    choice['expected_updated_at'] = item['updated_at']
    t.check('人工合并旧快照不能覆盖另一人补货', t.request('POST', '/api/ingredients/batch', payload)[0] == 409 and stock(item)['stock_value'] == 6)
    choice['expected_updated_at'] = fresh['updated_at']
    merged = t.data('POST', '/api/ingredients/batch', payload, 201)[0]
    t.check('最新版本人工合并只更新原库存', merged['id'] == item['id'] and merged['stock_value'] == 7)


if __name__ == '__main__':
    main()
    print(f'PASS: {t.COUNT} assertions')
