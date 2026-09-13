import { describe, expect, it } from 'vitest';
import { initialUsage, inventoryVersion, usageValue } from './menu-confirm-logic';
import type { Battle } from '../../shared/api/client';

describe('核对实际用量', () => {
  it.each([['200g', 'g', '200'], ['1个', '个', '1'], [' 2.5 kg ', 'kg', '2.5'], ['5KG', 'kg', '5'], ['1/3个', '个', '1/3'], ['0', '个', '0'], ['.5', 'kg', '.5']])('带入 %s，单位 %s', (text, unit, expected) => expect(initialUsage(text, unit)).toBe(expected));
  it.each(['半个', '200kg', '-1', '2个多', 'Infinity', '1e3', ''])('不能误读 %s', text => expect(initialUsage(text, 'g')).toBe(''));
  it.each([['1/3', 1 / 3], ['2/3', 2 / 3], ['0.5', 0.5], ['1/0', null], ['1/3个', null]])('核对输入支持简单分数 %s', (text, expected) => expect(usageValue(text)).toBe(expected));
  it('只比较相关食材版本，并识别食材消失', () => {
    const battle = { preparations: [{ ingredient_id: 1 }, { ingredient_id: 1 }] } as Pick<Battle, 'preparations'>;
    const original = inventoryVersion(battle, [{ id: 1, updated_at: 'a' }]);
    expect(inventoryVersion(battle, [{ id: 1, updated_at: 'a' }, { id: 2, updated_at: 'b' }])).toBe(original);
    expect(inventoryVersion(battle, [{ id: 1, updated_at: 'b' }])).not.toBe(original);
    expect(inventoryVersion(battle, [])).not.toBe(original);
  });
});
