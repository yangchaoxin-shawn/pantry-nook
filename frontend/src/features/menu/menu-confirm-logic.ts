import type { Battle, Ingredient } from '../../shared/api/client';
import { convertUnitValue } from '../inventory/batch-ingredient-logic';

const USAGE = /^(?:(?:0|[1-9]\d*)(?:\.\d+)?|\.\d+|(?:0|[1-9]\d*)\/[1-9]\d*)$/;

// 分子/分母上限与后端 quantity.py 对齐：超限由前端先行拦下，避免到后端才 400。
const MAX_NUMERATOR = 999_999_999;
const MAX_DENOMINATOR = 1_000_000;

export function usageValue(text: string): number | null {
  const value = text.trim();
  if (!USAGE.test(value)) return null;
  const [numerator, denominator] = value.split('/');
  if (denominator !== undefined && (Number(numerator) > MAX_NUMERATOR || Number(denominator) > MAX_DENOMINATOR)) return null;
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

export function resolvePlannedQuantity(text: string | null | undefined, draftUnit: string | null | undefined, currentUnit: string | null | undefined, latestText: string | null | undefined, latestUnit: string | null | undefined): { text: string | null | undefined; review?: string } {
  if (!text?.trim()) return { text };
  if (!currentUnit) throw new Error('库存缺少单位，请先补全库存单位。');
  const sourceUnit = draftUnit || currentUnit;
  const numberText = initialUsage(text, sourceUnit);
  const value = usageValue(numberText);
  if (value === null) throw new Error(`预计用量仍按 ${sourceUnit} 填写，请核对数量与单位。`);
  // 原文和单位都与刚读取的菜单相同，而且后端能按当前单位解析，才可保留旧单位快照。
  if (text === latestText && sourceUnit === latestUnit && initialUsage(text, currentUnit) !== '') return { text };
  if (sourceUnit === currentUnit) return { text: `${numberText}${currentUnit}` };
  const converted = convertUnitValue(value, sourceUnit, currentUnit);
  if (converted === null) throw new Error(`原预计 ${text}${text.toLocaleLowerCase().endsWith(sourceUnit.toLocaleLowerCase()) ? '' : sourceUnit} 不能换算成 ${currentUnit}，请按当前库存单位重新填写预计用量。`);
  const convertedText = `${Number(converted.toFixed(6))}${currentUnit}`;
  return { text: convertedText, review: `${text}${text.toLocaleLowerCase().endsWith(sourceUnit.toLocaleLowerCase()) ? '' : sourceUnit} → ${convertedText}` };
}
