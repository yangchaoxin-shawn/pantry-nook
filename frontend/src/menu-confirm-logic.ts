import type { Battle, Ingredient } from './api';

// 只剥离库存的完整单位，避免把未知文字或不同单位误读为数值。
export function initialUsage(text: string | null | undefined, unit: string | null): string {
  let value = text?.trim() ?? '';
  if (unit && value.toLocaleLowerCase().endsWith(unit.toLocaleLowerCase())) value = value.slice(0, -unit.length).trim();
  return /^(?:\d+(?:\.\d+)?|\.\d+)$/.test(value) ? value : '';
}

export function inventoryVersion(battle: Pick<Battle, 'preparations'>, ingredients: Pick<Ingredient, 'id' | 'updated_at'>[]): string {
  return [...new Set(battle.preparations.map(p => p.ingredient_id))].sort((a, b) => a - b)
    .map(id => `${id}:${ingredients.find(i => i.id === id)?.updated_at ?? 'unavailable'}`).join('|');
}
