"""部分报废后补货的定向回归；只写标记的独立库。"""
from concurrent.futures import ThreadPoolExecutor
import regression_test as t
from recovery_merge_test import choices


def scenario(name, incoming_unit='kg'):
    old = t.ingredient(name, value=1.7, unit='kg')
    a = t.data('POST', f"/api/ingredients/{old['id']}/waste", {
        'stock_value':1, 'stock_unit':'kg', 'reason':'spoiled', 'expected_updated_at':old['updated_at']}, 201)['adjustment']
    current = t.data('GET', f"/api/ingredients/{old['id']}")
    t.check('部分报废后剩0.7',current['stock_value']==0.7)
    if incoming_unit=='kg':
        current=t.ingredient(name,value=10,unit='kg')
    else:
        current=t.data('PATCH', f"/api/ingredients/{old['id']}", {
            'stock_value':10, 'stock_text':'10', 'stock_unit':incoming_unit, 'expected_updated_at':current['updated_at']})
    return old, a, current


def main():
    t.require_clean_isolated()
    old,a,current=scenario('补货大米-'+t.STAMP)
    path=f"/api/ingredients/adjustments/{a['id']}"
    preview=t.data('GET',path+'/recovery-preview')
    t.check('原ID补货后预览11.7',preview['items'][0]['suggested_value']==11.7 and preview['items'][0]['target_ingredient_id']==old['id'])
    t.check('预览不修改库存',t.data('GET',f"/api/ingredients/{old['id']}")==current)
    body=choices(preview)
    result=t.data('POST',path+'/revoke',body)
    t.check('确认加回1得到11.7',result['inventory']['stock_value']==11.7)
    t.check('保留原ID及恢复审计',result['inventory']['id']==old['id'] and result['adjustment']['recovery_merges'][0]['target_before_value']==10.7)
    t.check('不能重复恢复',t.request('POST',path+'/revoke',body)[0]==409)

    old,a,current=scenario('并发补货-'+t.STAMP)
    path=f"/api/ingredients/adjustments/{a['id']}"
    body=choices(t.data('GET',path+'/recovery-preview'))
    t.ingredient(old['name'],value=1,unit='kg')
    status,response=t.request('POST',path+'/revoke',body)
    t.check('预览后补货旧版本拒绝',status==409 and response['error']['code']=='RECORD_CHANGED')
    body=choices(t.data('GET',path+'/recovery-preview'))
    with ThreadPoolExecutor(max_workers=2) as pool:
        results=list(pool.map(lambda _:t.request('POST',path+'/revoke',body)[0],range(2)))
    t.check('并发只加回一次',sorted(results)==[200,409] and t.data('GET',f"/api/ingredients/{old['id']}")['stock_value']==12.7)

    for unit,expected in [('斤',12),('袋',7.5)]:
        old,a,current=scenario('换单位补回-'+unit+'-'+t.STAMP,unit)
        path=f"/api/ingredients/adjustments/{a['id']}"
        body=choices(t.data('GET',path+'/recovery-preview'))
        if unit=='袋':
            t.check('不可换算未填数量拒绝',t.request('POST',path+'/revoke',body)[0]==400)
            body['merge_resolutions'][0].update(final_stock_value=7.5,final_stock_text='7.5')
        result=t.data('POST',path+'/revoke',body)
        t.check('按所选单位恢复',result['inventory']['stock_value']==expected and result['inventory']['stock_unit']==unit)
    print(f'PASS: {t.COUNT} assertions')


if __name__=='__main__':main()

