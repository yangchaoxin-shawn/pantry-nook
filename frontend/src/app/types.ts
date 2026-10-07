import type { Battle, Consumption, Dish, Ingredient, MealPlan } from "../shared/api/client";
import type { OcrPrefillRow } from "../features/inventory/ocr-receipt-logic";

export type Page = "battles" | "ingredients" | "dishes" | "plans" | "consumptions" | "adjustments" | "journal";

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
  | { kind: "dishInMenus"; item: Dish; menuNames: string[]; battles: Battle[] }
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
