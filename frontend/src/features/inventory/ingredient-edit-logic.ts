import type { Ingredient, IngredientUpdate } from "../../shared/api/client";

type IngredientDraft = Pick<Ingredient, "name" | "category" | "location" | "note"> & { quantity: string; unit: string };

function textWithUnit(item: Ingredient, unit: string): string {
  const text = item.stock_text;
  return item.stock_unit && text.toLocaleLowerCase().endsWith(item.stock_unit.toLocaleLowerCase())
    ? `${text.slice(0, -item.stock_unit.length)}${unit}` : text;
}

export function ingredientEditPatch(original: Ingredient, latest: Ingredient, draft: IngredientDraft): IngredientUpdate {
  const patch: IngredientUpdate = { expected_updated_at: latest.updated_at };
  for (const key of ["name", "category", "location", "note"] as const) {
    if (draft[key] !== original[key]) Object.assign(patch, { [key]: draft[key] });
  }
  const quantity = draft.quantity.trim();
  const unit = draft.unit.trim();
  const quantityChanged = quantity !== String(original.stock_value);
  const unitChanged = unit !== original.stock_unit;
  if (quantityChanged || unitChanged) {
    // 库存是同一组数据；只改单位也须带原文和数值。未动数量时保留分数等原文。
    patch.stock_text = quantityChanged ? quantity : unitChanged ? textWithUnit(original, unit) : original.stock_text;
    patch.stock_value = quantityChanged ? Number(quantity) : original.stock_value;
    patch.stock_unit = unit;
  }
  return patch;
}
