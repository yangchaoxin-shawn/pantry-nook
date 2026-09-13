import type { Ingredient } from "../../shared/api/client";

export function stockLabel(item: Ingredient) {
  const text = item.stock_text;
  const unit = item.stock_unit;
  return unit && !text.includes(unit) ? `${text}${unit}` : text;
}
