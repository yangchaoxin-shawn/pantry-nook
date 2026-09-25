export const INVENTORY_UNITS = [
  "个",
  "g",
  "kg",
  "斤",
  "ml",
  "L",
  "袋",
  "包",
  "盒",
  "瓶",
  "把",
  "颗",
  "根",
  "块",
  "份",
] as const;

const CATEGORY_UNITS = {
  碳水: ["kg", "g", "斤", "袋", "包", "个"],
  蔬菜: ["个", "根", "g", "kg", "斤", "把", "颗", "份"],
  蛋白质: ["个", "g", "kg", "斤", "盒", "块"],
  水果: ["个", "g", "kg", "斤", "盒"],
  汤料: ["g", "kg", "斤", "包", "袋", "盒", "份"],
  其他: ["ml", "L", "瓶", "包", "盒", "袋", "份"],
} as const;

export type InventoryCategory = keyof typeof CATEGORY_UNITS;

/** 类别只影响推荐顺序，未列出的真实单位仍可手动填写。 */
export function recommendedUnits(category: InventoryCategory): readonly string[] {
  return CATEGORY_UNITS[category];
}

export function orderedUnits(category: InventoryCategory): string[] {
  const recommended = new Set<string>(CATEGORY_UNITS[category]);
  return [...recommended, ...INVENTORY_UNITS.filter((unit) => !recommended.has(unit))];
}

export function applyDefaultUnit<T extends { unit: string }>(rows: T[], unit: string): T[] {
  if (!unit) return rows;
  return rows.map((row) => row.unit ? row : { ...row, unit });
}
