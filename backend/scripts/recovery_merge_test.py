"""合并撤销真实事务回归，仅写独立测试库。"""
from concurrent.futures import ThreadPoolExecutor
import copy
import regression_test as t


def choices(preview):
    return {'expected_updated_at': preview['expected_updated_at'], 'merge_resolutions': [
        {k: r[k] for k in ('source_ingredient_id','source_updated_at','target_ingredient_id','target_updated_at')} | {'stock_unit': r['target_unit']}
        for r in preview['items'] if r['target_ingredient_id'] is not None]}


def wasted(name, amount=3, unit='个'):
    i = t.ingredient(name, value=amount, unit=unit)
    a = t.data('POST', f"/api/ingredients/{i['id']}/waste", {'stock_value':amount,'stock_unit':unit,'reason':'spoiled','expected_updated_at':i['updated_at']},201)
    return i, a['adjustment']


def main():
    t.require_clean_isolated()
    old,a = wasted('合并鸡蛋-'+t.STAMP)
    new=t.ingredient(old['name'],value=5)
    path=f"/api/ingredients/adjustments/{a['id']}"
    p=t.data('GET',path+'/recovery-preview')
    t.check('预览3加5等于8且不改库存',p['items'][0]['suggested_value']==8 and t.data('GET',f"/api/ingredients/{new['id']}")==new)
    status,body=t.request('POST',path+'/revoke')
    t.check('未选择返回合并要求',status==409 and body['error']['code']=='MERGE_REQUIRED')
    payload=choices(p)
    t.ingredient(old['name'],value=1)
    status,body=t.request('POST',path+'/revoke',payload)
    t.check('预览后补货拒绝旧版本',status==409 and body['error']['code']=='RECORD_CHANGED')
    payload=choices(t.data('GET',path+'/recovery-preview'))
    with ThreadPoolExecutor(max_workers=2) as e:
        futures=[e.submit(t.request,'POST',path+'/revoke',payload) for _ in range(2)]
        statuses=sorted(f.result()[0] for f in futures)
    t.check('双人并发只恢复一次',statuses==[200,409])
    t.check('恢复后保留新ID数量为9',t.data('GET',f"/api/ingredients/{new['id']}")['stock_value']==9)
    t.check('旧库存未复活',t.request('GET',f"/api/ingredients/{old['id']}")[0]==404)
    history=t.data('GET',f"/api/ingredients/{old['id']}/adjustments")
    t.check('历史记录合并去向',history[0]['status']=='reversed' and history[0]['recovery_merges'][0]['target_ingredient_id']==new['id'])

    old,a=wasted('换算大米-'+t.STAMP,2,'斤')
    new=t.ingredient(old['name'],value=3,unit='kg')
    path=f"/api/ingredients/adjustments/{a['id']}"
    body=choices(t.data('GET',path+'/recovery-preview'));body['merge_resolutions'][0]['stock_unit']='斤'
    result=t.data('POST',path+'/revoke',body)
    t.check('支持选择旧单位换算',result['inventory']['stock_value']==8 and result['inventory']['stock_unit']=='斤')

    stocks=[t.ingredient('整餐合并-'+str(i)+'-'+t.STAMP,value=3) for i in range(2)]
    dishes=[t.data('POST','/api/dishes',{'name':'恢复菜-'+str(i)+'-'+t.STAMP},201) for i in range(3)]
    prep=[{'dish_id':d['id'],'ingredient_id':stocks[0 if i<2 else 1]['id'],'planned_quantity_text':'1'} for i,d in enumerate(dishes)]
    b=t.data('POST','/api/daily-battles',{'battle_date':'2036-01-02','meal_slot':'dinner','dish_ids':[d['id'] for d in dishes],'preparations':prep},201)
    usages=[{'ingredient_id':stocks[0 if i<2 else 1]['id'],'daily_battle_dish_id':d['id'],'quantity_used_text':str([1,2,3][i]),'expected_updated_at':stocks[0 if i<2 else 1]['updated_at']} for i,d in enumerate(b['dishes'])]
    t.data('POST',f"/api/daily-battles/{b['id']}/confirm",{'expected_updated_at':b['updated_at'],'consumptions':usages})
    targets=[t.ingredient(s['name'],value=5,unit=('个' if i==0 else '盒')) for i,s in enumerate(stocks)]
    path=f"/api/daily-battles/{b['id']}"
    payload=choices(t.data('GET',path+'/recovery-preview'))
    bad=copy.deepcopy(payload);bad['merge_resolutions'][1].update(final_stock_text='0',final_stock_value=0)
    t.check('第二项无效整餐失败',t.request('POST',path+'/revoke-confirmation',bad)[0]==400)
    t.check('第一项更新也回滚',t.data('GET',f"/api/ingredients/{targets[0]['id']}")==targets[0])
    t.check('失败时菜单仍已确认',t.data('GET',path)['status']=='confirmed')
    payload['merge_resolutions'][1].update(final_stock_text='7.5',final_stock_value=7.5)
    restored=t.data('POST',path+'/revoke-confirmation',payload)
    t.check('回到待完成并重关联且清空用量',restored['status']=='planned' and all(p['planned_quantity_text'] is None and p['ingredient_id'] in [i['id'] for i in targets] for p in restored['preparations']))
    t.check('多菜同耗材只加回合计量',t.data('GET',f"/api/ingredients/{targets[0]['id']}")['stock_value']==8)
    t.check('不可换算由人工指定最终量',t.data('GET',f"/api/ingredients/{targets[1]['id']}")['stock_value']==7.5)
    history=t.data('GET',path+'/consumptions')
    t.check('所有消耗反转并各有审计',len(history)==3 and all(c['status']=='reversed' and len(c['recovery_merges'])==1 for c in history))
    t.check('重复撤销拒绝',t.request('POST',path+'/revoke-confirmation',payload)[0]==409)
    t.data('POST',path+'/cancel')
    print(f'PASS: {t.COUNT} assertions')


if __name__=='__main__':main()
