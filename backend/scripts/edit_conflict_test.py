"""正数入库与双人编辑冲突回归；只写独立测试数据库。"""
from concurrent.futures import ThreadPoolExecutor
import regression_test as t


def main():
    t.require_clean_isolated()
    item = {'name': f'正数入库-{t.STAMP}', 'category': '蔬菜', 'stock_text': '0', 'stock_value': 0, 'stock_unit': '个'}
    status, _ = t.request('POST', '/api/ingredients/batch', {'items': [{**item, 'name': f'半批-{t.STAMP}', 'stock_text': '1', 'stock_value': 1}, item]})
    t.check('含零数量整批拒绝且不保存半批', status == 400 and not t.data('GET', '/api/ingredients'))
    stock = t.ingredient(f'冲突库存-{t.STAMP}')
    dish = t.data('POST', '/api/dishes', {'name': f'冲突菜-{t.STAMP}'}, 201)
    plan = t.data('POST', '/api/meal-plans', {'name': f'冲突搭配-{t.STAMP}', 'dish_ids': [dish['id']]}, 201)
    for path, record, first, second in [
        (f"/api/ingredients/{stock['id']}", stock, {'note': '对方备注'}, {'category': '其他'}),
        (f"/api/dishes/{dish['id']}", dish, {'name': f'对方菜-{t.STAMP}'}, {'name': f'我的菜-{t.STAMP}'}),
        (f"/api/meal-plans/{plan['id']}", plan, {'name': f'对方搭配-{t.STAMP}'}, {'name': f'我的搭配-{t.STAMP}'}),
    ]:
        t.check('所有编辑均必须有版本', t.request('PATCH', path, first)[0] == 400)
        updated = t.data('PATCH', path, {**first, 'expected_updated_at': record['updated_at']})
        status, result = t.request('PATCH', path, {**second, 'expected_updated_at': record['updated_at']})
        t.check('过期保存返回最新内容且未覆盖', status == 409 and result['error']['code'] == 'RECORD_CHANGED' and result['error']['details']['current'] == updated and t.data('GET', path) == updated)
        latest = t.data('PATCH', path, {**second, 'expected_updated_at': updated['updated_at']})
        t.check('核对后带最新版本可保存', all(latest[k] == v for k, v in second.items()))
        with ThreadPoolExecutor(max_workers=2) as ex:
            futures = [ex.submit(t.request, 'PATCH', path, {**values, 'expected_updated_at': latest['updated_at']}) for values in [first, second]]
            statuses = sorted(f.result()[0] for f in futures)
        t.check('同一版本并发编辑只保存一次', statuses == [200, 409])

    status, _ = t.request('POST', '/api/ingredients/batch', {'items': [{**item, 'name': stock['name'], 'stock_value': 1, 'stock_text': '1', 'stock_unit': '盒'}], 'resolutions': [{'ingredient_id': stock['id'], 'stock_unit': '个', 'category': '蔬菜', 'final_stock_value': 0, 'final_stock_text': '0', 'expected_updated_at': stock['updated_at']}]})
    t.check('人工合并数量也必须大于零', status == 400)
    print(f'PASS: {t.COUNT} assertions')


if __name__ == '__main__':
    main()
