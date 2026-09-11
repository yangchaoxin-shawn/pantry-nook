import type { components } from "./api-schema";
export const CATEGORIES = ["碳水", "蔬菜", "蛋白质", "水果", "其他"] as const;
export const LOCATIONS = ["冰箱冷藏", "冰箱冷冻", "室温", "其他"] as const;
export type Ingredient = components["schemas"]["Ingredient"];
export type Dish = components["schemas"]["Dish"];
export type MealPlan = components["schemas"]["MealPlan"];
export type Battle = components["schemas"]["DailyBattle"];
export type Consumption = components["schemas"]["Consumption"];
export type IngredientCreate = components["schemas"]["IngredientCreate"];
export type IngredientUpdate = components["schemas"]["IngredientUpdate"];
export type InventoryAdjustment = components["schemas"]["InventoryAdjustment"];
export type InventoryAdjustmentRecord = components["schemas"]["InventoryAdjustmentRecord"];
export type IngredientUnitResolution = { ingredient_id: number; unit: string };
export type IngredientCategoryResolution = { ingredient_id: number; category: (typeof CATEGORIES)[number] };
export type IngredientManualTotal = { ingredient_id: number; stock_text: string; stock_value: number; unit: string; expected_updated_at: string };
export type MealPlanInput =
  | components["schemas"]["MealPlanCreate"]
  | components["schemas"]["MealPlanUpdate"];
export type BattleInput =
  | components["schemas"]["DailyBattleCreate"]
  | components["schemas"]["DailyBattleUpdate"];
export type BattleConfirm = components["schemas"]["BattleConfirm"];
type BattleActionArgs =
  | [id: number, action: "confirm", payload: BattleConfirm]
  | [id: number, action: "cancel"]
  | [
      id: number,
      action: "revoke-confirmation",
      payload?: components["schemas"]["BattleRevoke"],
    ];
type Envelope<T> = {
  data: T;
  meta?: { total: number; limit: number; offset: number };
};
const BASE = (import.meta.env.VITE_API_BASE || "").replace(/\/$/, "");
async function request<T>(
  path: string,
  method = "GET",
  payload?: unknown,
  signal?: AbortSignal,
): Promise<Envelope<T>> {
  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, {
      method,
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(15000)])
        : AbortSignal.timeout(15000),
      headers:
        payload === undefined
          ? undefined
          : { "Content-Type": "application/json" },
      body: payload === undefined ? undefined : JSON.stringify(payload),
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new Error(
      method === "GET"
        ? "暂时连接不上厨房，请检查网络后重试。"
        : "操作结果尚未确认，请先关闭弹窗并刷新页面核对，再决定是否重试。",
    );
  }
  const body = await response.json().catch(() => null);
  if (!response.ok)
    throw new Error(
      body?.error?.message || `请求失败（${response.status}），请重试。`,
    );
  if (!body || typeof body !== "object" || !("data" in body))
    throw new Error(
      method === "GET"
        ? "收到的数据格式不正确，请重试。"
        : "操作结果尚未确认，请先关闭弹窗并刷新页面核对，再决定是否重试。",
    );
  return body as Envelope<T>;
}
// 读取所有分页，避免遗漏未确认计划或只能选择前 50 条食材。
async function list<T>(path: string, signal?: AbortSignal): Promise<T[]> {
  const items: T[] = [];
  let offset = 0;
  while (true) {
    const page = await request<T[]>(
      `${path}${path.includes("?") ? "&" : "?"}limit=100&offset=${offset}`,
      "GET",
      undefined,
      signal,
    );
    if (!Array.isArray(page.data)) throw new Error("列表格式不正确，请重试。");
    items.push(...page.data);
    offset += page.data.length;
    if (page.data.length < 100 || offset >= (page.meta?.total ?? Infinity))
      return items;
  }
}
export const api = {
  battle: (id: number, signal?: AbortSignal) => request<Battle>(`/api/daily-battles/${id}`, 'GET', undefined, signal),
  ingredients: (s?: AbortSignal) =>
    list<Ingredient>("/api/ingredients", s),
  ingredientsAtLocation: (location: NonNullable<Ingredient["location"]>, s?: AbortSignal) =>
    list<Ingredient>(`/api/ingredients?location=${encodeURIComponent(location)}`, s),
  dishes: (s?: AbortSignal) => list<Dish>("/api/dishes", s),
  plans: (s?: AbortSignal) => list<MealPlan>("/api/meal-plans", s),
  battles: (s?: AbortSignal) => list<Battle>("/api/daily-battles", s),
  consumptions: (s?: AbortSignal) => list<Consumption>("/api/consumptions", s),
  saveIngredient: (
    id: number,
    p: IngredientUpdate,
  ) => {
    if (Object.keys(p).length === 0) return request<Ingredient>(`/api/ingredients/${id}`);
    return request<Ingredient>(`/api/ingredients/${id}`, "PATCH", p);
  },
  saveIngredientsBatch: (
    ingredients: IngredientCreate[],
    unit_resolutions: IngredientUnitResolution[] = [],
    category_resolutions: IngredientCategoryResolution[] = [],
    manual_totals: IngredientManualTotal[] = [],
  ) => {
    const resolutions = new Map<number, { ingredient_id: number; stock_unit?: string; category?: (typeof CATEGORIES)[number]; final_stock_text?: string; final_stock_value?: number; expected_updated_at?: string }>();
    for (const entry of unit_resolutions) resolutions.set(entry.ingredient_id, { ...(resolutions.get(entry.ingredient_id) ?? { ingredient_id: entry.ingredient_id }), stock_unit: entry.unit });
    for (const entry of category_resolutions) resolutions.set(entry.ingredient_id, { ...(resolutions.get(entry.ingredient_id) ?? { ingredient_id: entry.ingredient_id }), category: entry.category });
    for (const entry of manual_totals) resolutions.set(entry.ingredient_id, { ...(resolutions.get(entry.ingredient_id) ?? { ingredient_id: entry.ingredient_id }), stock_unit: entry.unit, final_stock_text: entry.stock_text, final_stock_value: entry.stock_value, expected_updated_at: entry.expected_updated_at });
    return request<Ingredient[]>("/api/ingredients/batch", "POST", { items: ingredients, resolutions: [...resolutions.values()] });
  },
  wasteIngredient: (id: number, payload: {
    stock_text: string; stock_value: number; stock_unit: string;
    reason: "spoiled" | "damaged" | "other"; note?: string | null;
    expected_updated_at: string;
  }) => request<{ inventory: Ingredient; adjustment: InventoryAdjustment }>(`/api/ingredients/${id}/waste`, "POST", payload),
  ingredientAdjustments: (id: number) => request<InventoryAdjustment[]>(`/api/ingredients/${id}/adjustments`),
  inventoryAdjustments: (s?: AbortSignal) => list<InventoryAdjustmentRecord>("/api/inventory-adjustments", s),
  revokeAdjustment: (id: number) => request<{ inventory: Ingredient; adjustment: InventoryAdjustment }>(`/api/ingredients/adjustments/${id}/revoke`, "POST"),
  saveDish: (id: number | undefined, name: string) =>
    request<Dish>(`/api/dishes${id ? `/${id}` : ""}`, id ? "PATCH" : "POST", {
      name,
    }),
  deleteDish: (id: number) => request<Dish>(`/api/dishes/${id}`, "DELETE"),
  dishMealPlans: (id: number) => request<components["schemas"]["DishMealPlan"][]>(`/api/dishes/${id}/meal-plans`),
  savePlan: (id: number | undefined, p: MealPlanInput) =>
    request<MealPlan>(
      `/api/meal-plans${id ? `/${id}` : ""}`,
      id ? "PATCH" : "POST",
      p,
    ),
  deletePlan: (id: number) =>
    request<components["schemas"]["MealPlanRecord"]>(
      `/api/meal-plans/${id}`,
      "DELETE",
    ),
  saveBattle: (id: number | undefined, p: BattleInput) =>
    request<Battle>(
      `/api/daily-battles${id ? `/${id}` : ""}`,
      id ? "PATCH" : "POST",
      p,
    ),
  startBattleReview: (id: number) =>
    request<Battle>(`/api/daily-battles/${id}/review-reservation`, "POST"),
  releaseBattleReview: (id: number) =>
    request<Battle>(`/api/daily-battles/${id}/review-reservation`, "DELETE"),
  deleteBattle: (id: number) => request<components['schemas']['DailyBattleRecord']>(`/api/daily-battles/${id}`, 'DELETE'),
  battleAction: (...[id, action, p]: BattleActionArgs) =>
    request<Battle>(`/api/daily-battles/${id}/${action}`, "POST", p),
};
export const localDate = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
