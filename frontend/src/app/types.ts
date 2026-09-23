import type { Battle, Consumption, Dish, Ingredient, MealPlan } from "../shared/api/client";

export type Page = "battles" | "ingredients" | "dishes" | "plans" | "consumptions" | "adjustments" | "journal";

/** 小票识别带入批量录入的预填行；数量、单位和分类允许为空，由用户补齐。 */
export type OcrPrefillRow = { name: string; quantity: string; unit: string; category?: string };

export type Modal =
  | { kind: "recovery"; recoveryKind: "adjustment" | "battle"; id: number }
  | { kind: "ingredient"; item: Ingredient; focusLocation?: boolean }
  | { kind: "ingredientSingle" }
  | { kind: "ocrReceipt" }
  | { kind: "ingredientBatch"; suggestedNames?: string[]; prefillRows?: OcrPrefillRow[] }
  | { kind: "ingredientDetail"; item: Ingredient }
  | { kind: "ingredientUse"; item: Ingredient }
  | { kind: "ingredientWaste"; item: Ingredient }
  | { kind: "dish"; item?: Dish }
  | { kind: "dishInPlans"; item: Dish; planNames: string[] }
  | { kind: "dishInMenus"; item: Dish; menuNames: string[] }
  | { kind: "plan"; item?: MealPlan }
  | { kind: "battle"; item?: Battle; plan?: MealPlan; copyFrom?: Battle; notice?: string }
  | { kind: "confirm"; item: Battle }
  | { kind: "action"; title: string; message: string; run: () => Promise<unknown> };

export type AppData = {
  ingredients: Ingredient[];
  dishes: Dish[];
  plans: MealPlan[];
  battles: Battle[];
  consumptions: Consumption[];
};
