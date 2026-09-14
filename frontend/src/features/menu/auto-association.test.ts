import { describe, expect, it } from 'vitest';
import type { Battle, Ingredient } from '../../shared/api/client';
import { planAutoAssociation } from './auto-association';

const ingredient = (id: number, name: string, unit = 'kg'): Ingredient => ({
  id, name, category: '蛋白质', stock_text: '2', stock_value: 2, stock_unit: unit,
  location: null, note: null, created_at: '2026-09-14T00:00:00Z', updated_at: '2026-09-14T00:00:00Z',
});

const battle = (preparations: Battle['preparations'], status: Battle['status'] = 'planned'): Battle => ({
  id: 7, battle_date: '2026-09-14', meal_plan_id: null, meal_slot: 'dinner', status,
  confirmed_at: null, cancelled_at: null, created_at: '2026-09-14T00:00:00Z', updated_at: '2026-09-14T00:00:00Z',
  dishes: [
    { id: 10, dish_id: 100, name: '莲藕排骨汤', position: 0 },
    { id: 11, dish_id: 101, name: '排骨焖饭', position: 1 },
  ],
  preparations,
});

const pending = (id: number, dishId: number, name = '排骨', quantity = '500g'): Battle['preparations'][number] => ({
  id, daily_battle_dish_id: dishId === 100 ? 10 : 11, dish_id: dishId, ingredient_id: null,
  ingredient_name: null, ingredient_status: null, pending_ingredient_name: name,
  planned_quantity_text: quantity, planned_quantity_unit: null, position: 0,
  created_at: '2026-09-14T00:00:00Z', updated_at: '2026-09-14T00:00:00Z',
});

describe('补货后自动关联', () => {
  it('本次同名补货只有一个有效库存时，自动换算成库存单位', () => {
    const result = planAutoAssociation(battle([pending(1, 100)]), [ingredient(20, ' 排骨 ')], ['排骨']);
    expect(result.problems).toEqual([]);
    expect(result.associations).toEqual([{ name: '排骨', ingredientId: 20, plannedQuantityText: '0.5kg', conversion: '500g → 0.5kg' }]);
    expect(result.preparations).toEqual([{ dish_id: 100, ingredient_id: 20, planned_quantity_text: '0.5kg' }]);
  });

  it('同单位、大小写与首尾空白可规范化，裸数字沿用库存单位', () => {
    const sameUnit = planAutoAssociation(battle([pending(1, 100, ' 牛奶 ', '1L')]), [ingredient(20, '牛奶', 'L')], ['牛奶']);
    const bare = planAutoAssociation(battle([pending(1, 100, '鸡蛋', '2')]), [ingredient(21, '鸡蛋', '个')], [' 鸡蛋 ']);
    expect(sameUnit.associations[0].plannedQuantityText).toBe('1L');
    expect(bare.associations[0].plannedQuantityText).toBe('2个');
  });

  it('不同菜品的同名待购项可全部关联同一库存', () => {
    const result = planAutoAssociation(battle([pending(1, 100), pending(2, 101, '排骨', '0.25kg')]), [ingredient(20, '排骨')], ['排骨']);
    expect(result.associations).toHaveLength(2);
    expect(result.preparations.map(item => item.ingredient_id)).toEqual([20, 20]);
  });

  it('用户改了补货名时不靠近似名称猜测', () => {
    const result = planAutoAssociation(battle([pending(1, 100)]), [ingredient(20, '猪肋排')], ['猪肋排']);
    expect(result.associations).toEqual([]);
    expect(result.problems).toContain('排骨：本次补货名称未完全匹配');
  });

  it('零条或多条同名库存都交给编辑页处理', () => {
    const none = planAutoAssociation(battle([pending(1, 100)]), [], ['排骨']);
    const many = planAutoAssociation(battle([pending(1, 100)]), [ingredient(20, '排骨'), ingredient(21, ' 排骨 ')], ['排骨']);
    expect(none.problems).toContain('排骨：读取到 0 条有效同名库存，无法确定关联');
    expect(many.problems).toContain('排骨：读取到 2 条有效同名库存，无法确定关联');
  });

  it('单位不能识别或不能换算时保留待购项', () => {
    const unknown = planAutoAssociation(battle([pending(1, 100, '排骨', '2勺')]), [ingredient(20, '排骨')], ['排骨']);
    const incompatible = planAutoAssociation(battle([pending(1, 100, '排骨', '2个')]), [ingredient(20, '排骨')], ['排骨']);
    expect(unknown.associations).toEqual([]);
    expect(unknown.problems[0]).toContain('单位无法识别');
    expect(incompatible.associations).toEqual([]);
    expect(incompatible.problems[0]).toContain('不能换算成 kg');
  });

  it('确定项可先关联，不确定项继续留在编辑页', () => {
    const result = planAutoAssociation(
      battle([pending(1, 100), pending(2, 101, '葱', '1把')]),
      [ingredient(20, '排骨'), ingredient(21, '葱', '把')],
      ['排骨'],
    );
    expect(result.associations.map(item => item.name)).toEqual(['排骨']);
    expect(result.preparations[1]).toEqual({ dish_id: 101, pending_ingredient_name: '葱', planned_quantity_text: '1把' });
    expect(result.problems).toContain('葱：本次补货名称未完全匹配');
  });

  it('同一道菜的重复关联不自动猜测，但不同菜不受影响', () => {
    const result = planAutoAssociation(battle([pending(1, 100), pending(2, 100)]), [ingredient(20, '排骨')], ['排骨']);
    expect(result.associations).toEqual([]);
    expect(result.problems).toContain('排骨：同一道菜存在重复耗材，需手动确认');
  });

  it('菜单不再是计划中或原关联失效时禁止自动保存', () => {
    const linked: Battle['preparations'][number] = { ...pending(9, 101, '鸡蛋', '2个'), ingredient_id: 99, ingredient_name: '鸡蛋', ingredient_status: 'discarded', pending_ingredient_name: null, planned_quantity_unit: '个' };
    expect(planAutoAssociation(battle([pending(1, 100)], 'confirmed'), [ingredient(20, '排骨')], ['排骨']).canSave).toBe(false);
    const unavailable = planAutoAssociation(battle([pending(1, 100), linked]), [ingredient(20, '排骨')], ['排骨']);
    expect(unavailable.canSave).toBe(false);
    expect(unavailable.problems).toContain('鸡蛋已不在库');
  });
});
