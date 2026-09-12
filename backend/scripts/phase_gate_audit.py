"""阶段审查复现脚本：记录期望与实际，发现问题不伪装成通过；仅写隔离库。"""
import json
import sys
from datetime import date, timedelta
import regression_test as t


def main():
    t.require_clean_isolated()
    findings = []
    sequence = 0

    def result(key, expected, actual, passed):
        findings.append(dict(key=key, expected=expected, actual=actual, passed=passed))

    def meal(stock, planned='1', name='审查菜'):
        nonlocal sequence
        sequence += 1
        dish = t.data('POST','/api/dishes',{'name':name+'-'+t.STAMP+str(sequence)},201)
        body = {'battle_date':str(date(2038,1,1)+timedelta(days=sequence)), 'meal_slot':'dinner',
                'dish_ids':[dish['id']], 'preparations':[{'dish_id':dish['id'], 'ingredient_id':stock['id'], 'planned_quantity_text':planned}]}
        battle = t.data('POST','/api/daily-battles',body,201)
        return dish, battle, body

    def confirm(battle, stock, used):
        return t.request('POST',f"/api/daily-battles/{battle['id']}/confirm",{
            'expected_updated_at':battle['updated_at'], 'consumptions':[{'ingredient_id':stock['id'],
            'daily_battle_dish_id':battle['dishes'][0]['id'], 'quantity_used_text':used, 'expected_updated_at':stock['updated_at']}]})

    stock=t.ingredient('文本数值一致-'+t.STAMP,value=2)
    updated=t.data('PATCH',f"/api/ingredients/{stock['id']}",{'stock_value':5,'expected_updated_at':stock['updated_at']})
    result('stock_text_value', '数值修改后展示数量与计算数量一致或拒绝不完整请求',
           {'stock_text':updated['stock_text'],'stock_value':updated['stock_value']}, updated['stock_text']=='5')

    stock=t.ingredient('零用量-'+t.STAMP,value=2)
    _,b,_=meal(stock)
    status,_=confirm(b,stock,'0')
    revoked=t.request('POST',f"/api/daily-battles/{b['id']}/revoke-confirmation",{'target_status':'cancelled'})[0]
    result('zero_usage', '全零确认和撤销不改数量', {'confirm':status,'revoke':revoked},status==200 and revoked==200 and t.data('GET',f"/api/ingredients/{stock['id']}")['stock_value']==2)

    stock=t.ingredient('取消后改餐-'+t.STAMP,value=3)
    _,b,body=meal(stock)
    assert confirm(b,stock,'1')[0]==200
    cancelled=t.data('POST',f"/api/daily-battles/{b['id']}/revoke-confirmation",{'target_status':'cancelled'})
    attempts={
        'create':t.request('POST','/api/daily-battles',body)[0],
        'edit':t.request('PATCH',f"/api/daily-battles/{b['id']}",{**body,'expected_updated_at':cancelled['updated_at']})[0],
        'delete':t.request('DELETE',f"/api/daily-battles/{b['id']}")[0]}
    result('cancelled_slot', '保留历史且能重新安排同一日期餐次', attempts, any(code<300 for code in attempts.values()))

    stock=t.ingredient('错误预计量-'+t.STAMP,value=3)
    _,b,_=meal(stock,'随便写')
    status,_=confirm(b,stock,'1')
    result('invalid_planned_quantity', '非空预计量格式合法才能确认', {'planned':'随便写','confirm':status},status==400)
    if status==200:t.data('POST',f"/api/daily-battles/{b['id']}/revoke-confirmation",{'target_status':'cancelled'})
    else:t.data('POST',f"/api/daily-battles/{b['id']}/cancel")

    stock=t.ingredient('菜品删除影响-'+t.STAMP,value=3)
    dish,b,body=meal(stock)
    deleted=t.request('DELETE',f"/api/dishes/{dish['id']}")[0]
    edited=t.request('PATCH',f"/api/daily-battles/{b['id']}",{**body,'expected_updated_at':b['updated_at']})[0]
    result('deleted_dish_edit', '菜品删除后已有菜单仍可保留快照编辑', {'delete':deleted,'edit_existing':edited},edited==200)
    t.data('POST',f"/api/daily-battles/{b['id']}/cancel")

    # 独立构造两道菜共用库存的恢复历史，不依赖其他脚本的数据。
    stock=t.ingredient('审查恢复归属-'+t.STAMP,value=3)
    d1,b,body=meal(stock)
    d2=t.data('POST','/api/dishes',{'name':'审查第二道菜-'+t.STAMP},201)
    body['dish_ids'].append(d2['id'])
    body['preparations'].append({'dish_id':d2['id'],'ingredient_id':stock['id'],'planned_quantity_text':'2'})
    b=t.data('PATCH',f"/api/daily-battles/{b['id']}",{**body,'expected_updated_at':b['updated_at']})
    t.data('POST',f"/api/daily-battles/{b['id']}/confirm",{'expected_updated_at':b['updated_at'],'consumptions':[
        {'daily_battle_dish_id':dish['id'],'ingredient_id':stock['id'],'quantity_used_text':str(i+1),
         'expected_updated_at':stock['updated_at']} for i,dish in enumerate(b['dishes'])]})
    t.ingredient(stock['name'],value=5)
    from recovery_merge_test import choices
    preview=t.data('GET',f"/api/daily-battles/{b['id']}/recovery-preview")
    t.data('POST',f"/api/daily-battles/{b['id']}/revoke-confirmation",{**choices(preview),'target_status':'cancelled'})
    history=t.data('GET',f"/api/daily-battles/{b['id']}/consumptions")
    mismatches=[{'used':c['quantity_value'],'restored':m['restored_value']} for c in history for m in c.get('recovery_merges',[]) if c['quantity_value']!=m['restored_value']]
    result('recovery_attribution', '每条消耗恢复审计与该条实际用量对应', mismatches, not mismatches)

    # 留一个待完成菜单供浏览器核对：预计 1 kg，之后库存统一改成 g。
    stock=t.ingredient('审查单位大米',value=3,unit='kg')
    _,b,_=meal(stock,'1','审查单位饭')
    t.data('PATCH',f"/api/ingredients/{stock['id']}",{'stock_text':'3000','stock_value':3000,'stock_unit':'g','expected_updated_at':stock['updated_at']})
    current=t.data('GET',f"/api/daily-battles/{b['id']}")
    result('planned_unit_snapshot','单位变更后保留原预计量单位或要求重新填写',
           {'battle_id':b['id'],'planned_quantity_text':current['preparations'][0]['planned_quantity_text'],
            'planned_unit_stored':'planned_unit' in current['preparations'][0]},False)
    print('AUDIT_RESULTS='+json.dumps(findings,ensure_ascii=False))
    print('NOTE: 单位快照项需结合浏览器判定，脚本不代表用户验收。')
    return 1 if any(not item['passed'] for item in findings) else 0


if __name__=='__main__':sys.exit(main())
