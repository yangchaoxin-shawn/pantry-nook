import type { Ingredient } from '../../shared/api/client';

export const ALL_INGREDIENT_CATEGORIES = '全部' as const;
export type IngredientCategoryFilter = typeof ALL_INGREDIENT_CATEGORIES | Ingredient['category'];

type CategorizedIngredient = Pick<Ingredient, 'id' | 'category'>;

/** 保持库存原顺序，只隐藏这道菜已关联或不属于当前大类的候选项。 */
export function ingredientCandidates<T extends CategorizedIngredient>(
  ingredients: readonly T[],
  linkedIngredientIds: readonly number[],
  category: IngredientCategoryFilter,
): T[] {
  const linked = new Set(linkedIngredientIds);
  return ingredients.filter((ingredient) =>
    !linked.has(ingredient.id)
      && (category === ALL_INGREDIENT_CATEGORIES || ingredient.category === category));
}
