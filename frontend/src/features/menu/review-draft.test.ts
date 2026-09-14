import { describe, expect, it } from 'vitest';
import type { Battle } from '../../shared/api/client';
import { acceptEditedMenu, restoreReviewRows, restockSuggestions, type ReviewDraft, type ReviewUsage } from './review-draft';
import { resolvePlannedQuantity } from './menu-confirm-logic';

const row = (dishId: number, ingredientId: number, quantity: string, unit = 'kg'): ReviewUsage => ({ key: ingredientId, daily_battle_dish_id: dishId, ingredient_id: ingredientId, ingredient_name: '排骨', ingredient_status: 'active', planned_quantity_text: '1', planned_quantity_unit: unit, converted_notice: null, quantity_used_text: quantity, unit });
const draft: ReviewDraft = { battleId: 7, menuVersion: 'v1', rows: [row(10, 20, '1/3'), row(11, 20, '0.5')], without: false };

describe('补货回流的实际量草稿', () => {
  it('同一食材分属不同菜品，顺序变化后仍各自恢复', () => {
    const restored = restoreReviewRows([row(11, 20, '1'), row(10, 20, '1')], 7, draft);
    expect(restored.map(value => value.quantity_used_text)).toEqual(['0.5', '1/3']);
  });
  it('新库存 ID 和另一餐不会套用旧实际量', () => {
    expect(restoreReviewRows([row(10, 21, '2')], 7, draft)[0].quantity_used_text).toBe('2');
    expect(restoreReviewRows([row(10, 20, '2')], 8, draft)[0].quantity_used_text).toBe('2');
  });
  it('回流期间换单位时保留原单位标记，供核对页拦截重新填写', () => {
    const restored = restoreReviewRows([row(10, 20, '1000', 'g')], 7, draft)[0];
    expect(restored.quantity_used_text).toBe('1/3');
    expect(restored.unit).toBe('kg');
    expect(restored.planned_quantity_unit).toBe('g');
  });
  it('只有当前餐已保存的编辑可以接受新菜单版本', () => {
    expect(acceptEditedMenu(draft, { id: 7, updated_at: 'v2' } as Battle)?.menuVersion).toBe('v2');
    expect(acceptEditedMenu(draft, { id: 8, updated_at: 'v2' } as Battle)).toBeUndefined();
    expect(draft.menuVersion).toBe('v1');
  });
});

describe('区分缺货与待关联', () => {
  const battle = { preparations: [{ ingredient_id: null, pending_ingredient_name: '排骨' }, { ingredient_id: null, pending_ingredient_name: '葱' }] } as Pick<Battle, 'preparations'>;
  it('已有同名库存只提示关联，缺少的食材才预填补货', () => {
    expect(restockSuggestions(battle, [{ id: 31, name: ' 排骨 ' }], [], [])).toEqual(['葱']);
  });
  it('旧 ID 失效但已有同名新库存，不再次建议入库', () => {
    expect(restockSuggestions({ preparations: [] }, [{ id: 31, name: '排骨' }], [row(10, 20, '1')], [])).toEqual([]);
  });
  it('同名库存确有实际量缺口时，仍允许补货且去重', () => {
    expect(restockSuggestions(battle, [{ id: 31, name: '排骨' }], [], ['排骨', '排骨'])).toEqual(['葱', '排骨']);
  });
});

describe('保存前对照最新菜单的单位快照', () => {
  it('并发菜单已改为克时，旧1kg不能被保存成1g', () => {
    expect(resolvePlannedQuantity('1', 'kg', 'g', '2g', 'g')).toEqual({ text: '1000g', review: '1kg → 1000g' });
  });
  it('旧显式1kg遇到库存g，安全换算后通过现有API校验', () => {
    expect(resolvePlannedQuantity('1kg', 'kg', 'g', '1kg', 'kg')).toEqual({ text: '1000g', review: '1kg → 1000g' });
  });
  it('相同裸数字和旧单位快照仍存在时，保留原语义', () => {
    expect(resolvePlannedQuantity('1', 'kg', 'g', '1', 'kg')).toEqual({ text: '1' });
  });
  it('用户重填相同数字采用新单位时显式提交新单位', () => {
    expect(resolvePlannedQuantity('1', 'g', 'g', '1', 'kg')).toEqual({ text: '1g' });
  });
  it('不能换算且旧快照已改变时必须拦截', () => {
    expect(() => resolvePlannedQuantity('1', '个', 'kg', '2kg', 'kg')).toThrow('请按当前库存单位重新填写');
  });
  it('新填预计量包含当前单位，防止保存期间换单位被误读', () => {
    expect(resolvePlannedQuantity('1/3', 'kg', 'kg', undefined, undefined)).toEqual({ text: '1/3kg' });
  });
});
