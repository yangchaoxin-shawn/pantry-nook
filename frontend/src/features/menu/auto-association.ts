import type { Battle, Ingredient } from '../../shared/api/client';
import { INVENTORY_UNITS } from '../inventory/inventory-units';
import { initialUsage, resolvePlannedQuantity } from './menu-confirm-logic';

type AssociationPreparationBase = {
  dish_id: number;
  planned_quantity_text?: string | null;
};

export type AssociationPreparation = AssociationPreparationBase & (
  | { ingredient_id: number; pending_ingredient_name?: null }
  | { ingredient_id?: null; pending_ingredient_name: string }
);

export type AutoAssociation = {
  name: string;
  ingredientId: number;
  plannedQuantityText: string;
  conversion: string | null;
};

export type AutoAssociationPlan = {
  preparations: AssociationPreparation[];
  associations: AutoAssociation[];
  problems: string[];
  canSave: boolean;
};

export const normalizeIngredientName = (name: string) => name.trim().toLocaleLowerCase();

function plannedQuantityInStockUnit(text: string | null | undefined, stockUnit: string): { text?: string; conversion?: string; error?: string } {
  const value = text?.trim();
  if (!value) return { error: '没有填写预计用量' };

  // 裸数字沿用即将关联的库存单位；带单位的原文只接受系统已明确支持的单位。
  let sourceUnit = initialUsage(value, stockUnit) !== '' ? stockUnit : null;
  if (!sourceUnit) {
    sourceUnit = [...INVENTORY_UNITS]
      .sort((left, right) => right.length - left.length)
      .find(unit => initialUsage(value, unit) !== '') ?? null;
  }
  if (!sourceUnit) return { error: `预计用量“${value}”的单位无法识别` };

  try {
    const resolved = resolvePlannedQuantity(value, sourceUnit, stockUnit, undefined, undefined);
    if (!resolved.text?.trim()) return { error: '没有填写预计用量' };
    return { text: resolved.text, conversion: resolved.review };
  } catch (failure) {
    return { error: failure instanceof Error ? failure.message : `预计用量不能换算成 ${stockUnit}` };
  }
}

const preparationInput = (preparation: Battle['preparations'][number]): AssociationPreparation => preparation.ingredient_id === null
  ? { dish_id: preparation.dish_id, pending_ingredient_name: preparation.pending_ingredient_name ?? '', planned_quantity_text: preparation.planned_quantity_text }
  : { dish_id: preparation.dish_id, ingredient_id: preparation.ingredient_id, planned_quantity_text: preparation.planned_quantity_text };

/**
 * 只处理本次确实提交过的同名补货。候选不唯一、预计量不能安全换算或菜单已变化时，
 * 保留待购项并把原因交给编辑页；不同菜品可以同时关联同一条库存。
 */
export function planAutoAssociation(battle: Battle, ingredients: Ingredient[], submittedNames: string[]): AutoAssociationPlan {
  const preparations = battle.preparations.map(preparationInput);
  const associations: AutoAssociation[] = [];
  const problems: string[] = [];
  const submitted = new Set(submittedNames.map(normalizeIngredientName).filter(Boolean));
  const activeIds = new Set(ingredients.map(ingredient => ingredient.id));

  if (battle.status !== 'planned') {
    return { preparations, associations, problems: ['这餐的状态已经变化，未自动修改关联'], canSave: false };
  }

  const unavailable = battle.preparations.filter(preparation => preparation.ingredient_id !== null && !activeIds.has(preparation.ingredient_id));
  if (unavailable.length) {
    problems.push(...unavailable.map(preparation => `${preparation.ingredient_name ?? '原关联食材'}已不在库`));
  }

  const candidates = battle.preparations.flatMap((preparation, index) => {
    if (preparation.ingredient_id !== null) return [];
    const name = preparation.pending_ingredient_name?.trim() ?? '';
    const normalizedName = normalizeIngredientName(name);
    if (!submitted.has(normalizedName)) {
      problems.push(`${name || '待购食材'}：本次补货名称未完全匹配`);
      return [];
    }
    const matches = ingredients.filter(ingredient => normalizeIngredientName(ingredient.name) === normalizedName);
    if (matches.length !== 1) {
      problems.push(`${name}：读取到 ${matches.length} 条有效同名库存，无法确定关联`);
      return [];
    }
    const ingredient = matches[0];
    const quantity = plannedQuantityInStockUnit(preparation.planned_quantity_text, ingredient.stock_unit);
    const plannedQuantityText = quantity.text;
    if (!plannedQuantityText) {
      problems.push(`${name}：${quantity.error ?? '预计用量无法安全换算'}`);
      return [];
    }
    return [{ index, preparation, ingredient, plannedQuantityText, conversion: quantity.conversion ?? null }];
  });

  const occupied = new Set(battle.preparations
    .filter(preparation => preparation.ingredient_id !== null)
    .map(preparation => `${preparation.dish_id}:${preparation.ingredient_id}`));
  const candidateCounts = new Map<string, number>();
  for (const candidate of candidates) {
    const key = `${candidate.preparation.dish_id}:${candidate.ingredient.id}`;
    candidateCounts.set(key, (candidateCounts.get(key) ?? 0) + 1);
  }

  for (const candidate of candidates) {
    const key = `${candidate.preparation.dish_id}:${candidate.ingredient.id}`;
    const name = candidate.preparation.pending_ingredient_name?.trim() ?? candidate.ingredient.name;
    if (occupied.has(key) || (candidateCounts.get(key) ?? 0) > 1) {
      problems.push(`${name}：同一道菜存在重复耗材，需手动确认`);
      continue;
    }
    occupied.add(key);
    preparations[candidate.index] = {
      dish_id: candidate.preparation.dish_id,
      ingredient_id: candidate.ingredient.id,
      planned_quantity_text: candidate.plannedQuantityText,
    };
    associations.push({
      name,
      ingredientId: candidate.ingredient.id,
      plannedQuantityText: candidate.plannedQuantityText,
      conversion: candidate.conversion,
    });
  }

  return {
    preparations,
    associations,
    problems: [...new Set(problems)],
    canSave: unavailable.length === 0,
  };
}
