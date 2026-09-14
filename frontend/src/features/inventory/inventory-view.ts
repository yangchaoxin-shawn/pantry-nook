import { CATEGORIES, type Ingredient } from "../../shared/api/client";

export const LOCATION_OPTIONS: { label: string; value: Ingredient["location"] }[] = [
  { label: "全部位置", value: null },
  { label: "室温", value: "室温" },
  { label: "冷藏", value: "冰箱冷藏" },
  { label: "冷冻", value: "冰箱冷冻" },
  { label: "其他", value: "其他" },
];
type InventoryViewInput = {
  ingredients: Ingredient[];
  locationItems: Ingredient[] | null;
  inventoryLocation: Ingredient["location"];
  locationError: string;
  search: string;
  category: string;
};
type InventoryView = { status: "loading" } | { status: "empty" } | { status: "error"; message: string } | {
  status: "ready";
  groups: { category: Ingredient["category"]; items: Ingredient[] }[];
};

export function inventoryView({ ingredients, locationItems, inventoryLocation, locationError, search, category }: InventoryViewInput): InventoryView {
  if (inventoryLocation && locationError) return { status: "error", message: locationError };
  const source = inventoryLocation ? locationItems : ingredients;
  if (source === null) return { status: "loading" };
  // 切换时不把上一位置结果显示为新位置的清单或空态。
  if (inventoryLocation && source.some((item) => item.location !== inventoryLocation)) return { status: "loading" };
  const query = search.trim().toLocaleLowerCase();
  const matches = source.filter((item) => (category === "全部" || item.category === category)
    && `${item.name} ${item.location ?? ""}`.toLocaleLowerCase().includes(query));
  const groups = CATEGORIES.map((group) => ({ category: group, items: matches.filter((item) => item.category === group) }))
    .filter((group) => group.items.length > 0);
  return groups.length ? { status: "ready", groups } : { status: "empty" };
}
