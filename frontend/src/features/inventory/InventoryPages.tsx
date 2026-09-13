import { CATEGORIES, LOCATIONS, type Ingredient } from "../../shared/api/client";
import { Empty, Icon } from "../../shared/ui/Primitives";
import { InventoryAdjustmentLedger } from "./InventoryDetails";
import { stockLabel } from "./inventory-format";

export function InventoryPage({ ingredients, locationItems, inventoryLocation, locationError, search, category, setSearch, setCategory, chooseLocation, retry, openIngredient }: {
  ingredients: Ingredient[];
  locationItems: Ingredient[] | null;
  inventoryLocation: Ingredient["location"];
  locationError: string;
  search: string;
  category: string;
  setSearch: (value: string) => void;
  setCategory: (value: string) => void;
  chooseLocation: (value: Ingredient["location"]) => void;
  retry: () => void;
  openIngredient: (item: Ingredient) => void;
}) {
  const inventories = (inventoryLocation ? locationItems : ingredients)?.filter((item) =>
    (category === "全部" || item.category === category) && `${item.name} ${item.location ?? ""}`.includes(search.trim()),
  ) ?? [];
  return <>
    <div className="filter-bar"><input type="search" aria-label="搜索食材" placeholder="搜索食材或存放位置" value={search} onChange={(event) => setSearch(event.target.value)} /></div>
    <div className="chips" aria-label="食材分类">{["全部", ...CATEGORIES].map((itemCategory) => <button className={category === itemCategory ? "chip active" : "chip"} aria-pressed={category === itemCategory} key={itemCategory} onClick={() => setCategory(itemCategory)}>{itemCategory}</button>)}</div>
    <div className="chips location-chips" aria-label="存放位置">{["全部位置", ...LOCATIONS].map((location) => {
      const value = location === "全部位置" ? null : location as Ingredient["location"];
      const selected = inventoryLocation === value;
      return <button className={selected ? "chip active" : "chip"} aria-pressed={selected} key={location} onClick={() => chooseLocation(value)}>{location}</button>;
    })}</div>
    {locationError && <div className="error-state-inline" role="alert"><p className="form-error">{locationError}</p><button className="btn-ghost" onClick={retry}>重新读取</button></div>}
    <div className="inventory-groups">{CATEGORIES.map((group) => {
      const items = inventories.filter((item) => item.category === group);
      return items.length > 0 && <section className="inventory-group" key={group} aria-label={`${group}库存`}>
        <div className="section-heading"><h2>{group}</h2><span className="muted">{items.length} 项</span></div>
        <div className="inventory-list">{items.map((item) => <button type="button" className="ingredient-row ingredient-compact" key={item.id} aria-label={`查看${item.name}，余量${item.stock_text}`} onClick={() => openIngredient(item)}><span className="ingredient-name">{item.name}</span><span className="ingredient-quantity">{stockLabel(item)}</span><span className="ingredient-row-arrow" aria-hidden="true"><Icon name="arrow" size={15} /></span></button>)}</div>
      </section>;
    })}</div>
    {!locationError && inventories.length === 0 && <section className="card"><Empty title={search || category !== "全部" || inventoryLocation ? "没有找到这些食材" : "这里还没有食材"}>{search || category !== "全部" || inventoryLocation ? "试试其他名称，或切换分类。" : "记下家里现有的食材，让下一顿有个着落。"}</Empty></section>}
  </>;
}

export function InventoryAdjustmentsPage({ busy, refreshKey, revoke }: { busy: boolean; refreshKey: number; revoke: (id: number) => void }) {
  return <InventoryAdjustmentLedger busy={busy} refreshKey={refreshKey} revoke={revoke} />;
}
