import type { Battle, Consumption, Dish, Ingredient, MealPlan } from "../shared/api/client";

export type Page = "battles" | "ingredients" | "dishes" | "plans" | "consumptions" | "adjustments";

export type Modal =
  | { kind: "recovery"; recoveryKind: "adjustment" | "battle"; id: number }
  | { kind: "ingredient"; item: Ingredient }
  | { kind: "ingredientSingle" }
  | { kind: "ingredientBatch"; suggestedNames?: string[] }
  | { kind: "ingredientDetail"; item: Ingredient }
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
