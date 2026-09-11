"""边界审查回归；只写独立测试库，失败请求必须保持原状。"""
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta
import urllib.parse
import regression_test as api


def main():
    api.require_clean_isolated()
    failures = []

    def verify(label, condition):
        if not condition:
            failures.append(label)
        print(f"[{'OK' if condition else 'FAIL'}] {label}")

    first = api.ingredient(f"边界甲-{api.STAMP}")
    second = api.ingredient(f"边界乙-{api.STAMP}")
    status, _ = api.request('PATCH', f"/api/ingredients/{second['id']}", {'name': first['name']})
    verify('改名冲突返回409且不改变原食材', status == 409 and api.data('GET', f"/api/ingredients/{second['id']}")['name'] == second['name'])
    query = urllib.parse.urlencode({'q': first['name'], 'offset': 999})
    _, page = api.request('GET', '/api/ingredients?' + query)
    verify('越界分页保留筛选后的总数', page['meta']['total'] == 1 and page['data'] == [])

    for label, value, unit, incoming, target in [
        ('累加溢出', 999999999, 'g', 1, 'g'),
        ('换算超精度', 0.000001, 'g', 1, 'kg'),
    ]:
        stock = api.ingredient(f'{label}-{api.STAMP}', value=value, unit=unit)
        status, _ = api.request('POST', '/api/ingredients/batch', {
            'items': [{'name': stock['name'], 'category': '蔬菜', 'stock_text': str(incoming), 'stock_value': incoming, 'stock_unit': target}],
            'resolutions': [{'ingredient_id': stock['id'], 'stock_unit': target}],
        })
        after = api.data('GET', f"/api/ingredients/{stock['id']}")
        verify(label + '返回400且整体不写入', status == 400 and after == stock)

    waste = api.data('POST', f"/api/ingredients/{first['id']}/waste", {
        'stock_value': 3, 'stock_unit': '个', 'reason': 'spoiled', 'expected_updated_at': first['updated_at'],
    }, 201)
    replacement = api.ingredient(first['name'], value=2)
    status, _ = api.request('POST', f"/api/ingredients/adjustments/{waste['adjustment']['id']}/revoke")
    history = api.data('GET', f"/api/ingredients/{first['id']}/adjustments")
    verify('同名重新入库后撤销报废返回409并保留历史', status == 409 and history[0]['status'] == 'active' and api.data('GET', f"/api/ingredients/{replacement['id']}") == replacement)

    dish = api.data('POST', '/api/dishes', {'name': f'边界菜-{api.STAMP}'}, 201)
    test_date = (date(2035, 1, 1) + timedelta(days=int(api.STAMP, 16) % 365000)).isoformat()
    body = {'battle_date': test_date, 'meal_slot': 'dinner', 'dish_ids': [dish['id']], 'preparations': [
        {'dish_id': dish['id'], 'ingredient_id': second['id'], 'planned_quantity_text': '3'},
    ]}
    battle = api.data('POST', '/api/daily-battles', body, 201)
    status, _ = api.request('PATCH', f"/api/daily-battles/{battle['id']}", body)
    current = api.data('GET', f"/api/daily-battles/{battle['id']}")
    verify('菜单省略版本返回400且不改变版本', status == 400 and current['updated_at'] == battle['updated_at'])
    battle = current
    api.data('POST', f"/api/daily-battles/{battle['id']}/confirm", {
        'expected_updated_at': battle['updated_at'], 'consumptions': [{
            'ingredient_id': second['id'], 'daily_battle_dish_id': battle['dishes'][0]['id'],
            'quantity_used_text': '3', 'expected_updated_at': second['updated_at'],
        }],
    })
    replacement = api.ingredient(second['name'], value=2)
    status, _ = api.request('POST', f"/api/daily-battles/{battle['id']}/revoke-confirmation", {'target_status': 'cancelled'})
    current = api.data('GET', f"/api/daily-battles/{battle['id']}")
    history = api.data('GET', f"/api/daily-battles/{battle['id']}/consumptions")
    verify('同名重新入库后撤销整餐返回409且不反转消耗', status == 409 and current['status'] == 'confirmed' and all(x['status'] == 'active' for x in history))

    for i in range(8):
        dish = api.data('POST', '/api/dishes', {'name': f'并发引用-{api.STAMP}-{i}'}, 201)
        with ThreadPoolExecutor(max_workers=2) as executor:
            create = executor.submit(api.request, 'POST', '/api/meal-plans', {'dish_ids': [dish['id']]})
            delete = executor.submit(api.request, 'DELETE', f"/api/dishes/{dish['id']}")
            created, deleted = create.result()[0], delete.result()[0]
        verify(f'并发引用/删除{i+1}只有一种合法结果', (created, deleted) in [(201, 409), (404, 200)])
    if failures:
        raise AssertionError('；'.join(failures))
    print('PASS: 15 boundary scenarios')


if __name__ == '__main__':
    main()
