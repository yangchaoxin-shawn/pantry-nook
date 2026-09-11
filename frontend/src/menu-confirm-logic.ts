import type { Battle, Ingredient } from './api';

const USAGE = /^(?:(?:0|[1-9]\d*)(?:\.\d+)?|\.\d+|(?:0|[1-9]\d*)\/[1-9]\d*)$/;

export function usageValue(text: string): number | null {
  const value = text.trim();
  if (!USAGE.test(value)) return null;
  const [numerator, denominator] = value.split('/');
  const number = denominator === undefined ? Number(numerator) : Number(numerator) / Number(denominator);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

// 只剥离库存的完整单位，避免把未知文字或不同单位误读为数值。
export function initialUsage(text: string | null | undefined, unit: string | null): string {
  let value = text?.trim() ?? '';
  if (unit && value.toLocaleLowerCase().endsWith(unit.toLocaleLowerCase())) value = value.slice(0, -unit.length).trim();
  return usageValue(value) !== null ? value : '';
}

export function inventoryVersion(battle: Pick<Battle, 'preparations'>, ingredients: Pick<Ingredient, 'id' | 'updated_at'>[]): string {
  return [...new Set(battle.preparations.map(p => p.ingredient_id).filter((id): id is number => id !== null))].sort((a, b) => a - b)
    .map(id => `${id}:${ingredients.find(i => i.id === id)?.updated_at ?? 'unavailable'}`).join('|');
}
