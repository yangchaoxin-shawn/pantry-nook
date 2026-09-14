import type { Battle, Ingredient } from '../../shared/api/client';

export type ReviewUsage = {
  key: number;
  ingredient_id: number;
  daily_battle_dish_id: number | null;
  ingredient_name: string;
  ingredient_status: string;
  planned_quantity_text: string;
  planned_quantity_unit: string | null;
  converted_notice: string | null;
  quantity_used_text: string;
  unit: string | null;
};

export type ReviewDraft = {
  battleId: number;
  menuVersion: string;
  rows: ReviewUsage[];
  without: boolean;
};

// 菜单保存会重建耗材行，实际用量按本餐菜品行和库存 ID 对应，不能按数组位置恢复。
export function restoreReviewRows(rows: ReviewUsage[], battleId: number, draft?: ReviewDraft): ReviewUsage[] {
  if (!draft || draft.battleId !== battleId) return rows;
  return rows.map(row => {
    const previous = row.daily_battle_dish_id === null ? undefined : draft.rows.find(item => item.daily_battle_dish_id === row.daily_battle_dish_id && item.ingredient_id === row.ingredient_id);
    return previous ? { ...row, quantity_used_text: previous.quantity_used_text, unit: previous.unit } : row;
  });
}

export function restockSuggestions(battle: Pick<Battle, 'preparations'>, ingredients: Pick<Ingredient, 'id' | 'name'>[], rows: Pick<ReviewUsage, 'ingredient_id' | 'ingredient_name'>[], shortageNames: string[]): string[] {
  const exists = (name: string) => ingredients.some(item => item.name.trim().toLocaleLowerCase() === name.trim().toLocaleLowerCase());
  const pending = battle.preparations.filter(prep => prep.ingredient_id === null).map(prep => prep.pending_ingredient_name).filter((name): name is string => !!name && !exists(name));
  const missing = rows.filter(row => !ingredients.some(item => item.id === row.ingredient_id) && !exists(row.ingredient_name)).map(row => row.ingredient_name);
  return [...new Set([...pending, ...shortageNames, ...missing])];
}

// 只有用户已保存本餐编辑，才接受这次新版本；外部变化仍由核对页拦截。
export function acceptEditedMenu(draft: ReviewDraft | undefined, battle: Battle): ReviewDraft | undefined {
  return draft?.battleId === battle.id ? { ...draft, menuVersion: battle.updated_at } : undefined;
}
