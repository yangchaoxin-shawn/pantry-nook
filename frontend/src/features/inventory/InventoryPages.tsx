import type { ReactNode } from "react";
import { CATEGORIES, type Ingredient, type InventoryAdjustmentKind } from "../../shared/api/client";
import { Empty } from "../../shared/ui/Primitives";
import { InventoryAdjustmentLedger } from "./InventoryDetails";
import { stockLabel } from "./inventory-format";
import { inventoryView, LOCATION_OPTIONS, type InventoryLocation } from "./inventory-view";
import "./inventory-view.css";

function CategoryMark({ category }: { category: string }) {
  const paths: Record<string, ReactNode> = {
    碳水: <path d="m6 20 12-16M9 16c-5 0-5-4-5-4 5-1 6 2 5 4Zm3-4c-4-1-3-5-3-5 4 0 5 2 3 5Zm3-4c-1-4 3-6 3-6 2 3 0 6-3 6ZM12 12c4-2 6 0 6 0-1 4-4 4-6 3" />,
    蔬菜: <path d="M5 19C-1 5 13 3 20 4c1 10-3 17-13 14M5 20 16 8M10 14l-1-5m1 5 5 1" />,
    蛋白质: <><path d="M12 3c-4 0-7 7-7 11a7 7 0 0 0 14 0c0-4-3-11-7-11Z" /><path d="M8 13c-1 3 0 4 2 5" /></>,
    水果: <path d="M12 8C3 1 1 13 6 19c2 3 4 0 6 1 2-1 4 2 6-1 5-6 3-18-6-11Zm0 0c-1-3 0-5 2-6m0 3c3 1 4-1 5-3-3-1-5 0-5 3" />,
    汤料: <><path d="M5 10h14l-1 9H6l-1-9Zm-2 0h18M9 7h6" /><path d="M10 7c0-2 4-2 4 0M3 13h2m14 0h2" /></>,
    其他: <path d="M4 10h16c0 7-4 10-8 10S4 17 4 10ZM8 7c-2-2 2-2 0-4m8 4c-2-2 2-2 0-4" />,
  };
  return <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[category]}</svg>;
}

export function InventoryPage({ ingredients, locationItems, inventoryLocation, locationError, search, category, setSearch, setCategory, chooseLocation, retry, openIngredient, openLocationEditor, actions }: {
  ingredients: Ingredient[];
  locationItems: Ingredient[] | null;
  inventoryLocation: InventoryLocation;
  locationError: string;
  search: string;
  category: string;
  setSearch: (value: string) => void;
  setCategory: (value: string) => void;
  chooseLocation: (value: InventoryLocation) => void;
  retry: () => void;
  openIngredient: (item: Ingredient) => void;
  openLocationEditor?: (item: Ingredient) => void;
  actions?: ReactNode;
}) {
  const view = inventoryView({ ingredients, locationItems, inventoryLocation, locationError, search, category });
  const filtered = Boolean(search.trim() || category !== "全部" || inventoryLocation);
  const locationLabel = LOCATION_OPTIONS.find((option) => option.value === inventoryLocation)?.label;
  const unassignedCount = ingredients.filter(item => !item.location).length;
  const locationsComplete = inventoryLocation === "unassigned" && !search.trim() && category === "全部" && unassignedCount === 0;
  return <section className="pn-inventory" aria-label="库存清单">
    <div className="pn-inventory-toolbar">
      <label className="pn-inventory-search">
        <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></svg>
        <input type="search" aria-label="搜索食材" placeholder="找找家里的食材" value={search} onChange={(event) => setSearch(event.target.value)} />
      </label>
      {actions && <div className="pn-inventory-actions">{actions}</div>}
    </div>
    <div className="pn-inventory-locations" role="group" aria-label="存放位置">
      {LOCATION_OPTIONS.map(({ value, label }) => <button type="button" aria-pressed={inventoryLocation === value} key={label}
        aria-label={value === "unassigned" ? `待补位置，全库存 ${unassignedCount} 项` : undefined} onClick={() => {
        if (value === "unassigned") {
          setSearch("");
          setCategory("全部");
        }
        // 重复点击不清空列表，避免父组件依赖未变化时不再发起请求。
        if (inventoryLocation !== value) chooseLocation(value);
      }}>{label}{value === "unassigned" && <span className="pn-inventory-location-count">{unassignedCount}</span>}</button>)}
    </div>
    <div className="pn-inventory-categories" role="group" aria-label="食材分类">
      {["全部", ...CATEGORIES].map((value) => <button type="button" aria-pressed={category === value} key={value} onClick={() => setCategory(value)}>{value}</button>)}
    </div>
    <div className="pn-inventory-results" aria-busy={view.status === "loading"}>
      {view.status === "loading" ? <div className="pn-inventory-loading" role="status">
        <p>正在读取{inventoryLocation ? locationLabel : "库存"}食材…</p>
        <div className="pn-inventory-skeletons" aria-hidden="true">{[0, 1].map((key) => <div className="pn-inventory-skeleton" key={key}><i /><i /><i /></div>)}</div>
      </div> : view.status === "error" ? <div className="pn-inventory-state" role="alert">
        <h2>暂时没能打开这份清单</h2><p>{view.message}</p><button type="button" className="btn-ghost" onClick={retry}>重新读取</button>
      </div> : view.status === "empty" ? <div className="pn-inventory-state">
        <Empty title={locationsComplete ? "位置都已补齐" : filtered ? "没有找到这些食材" : "这里还没有食材"}>{locationsComplete ? "可以切换到全部位置，继续查看库存。" : filtered ? "试试其他名称，或切换位置和分类。" : "记下家里现有的食材，让下一顿有个着落。"}</Empty>
      </div> : <div className="pn-inventory-groups">{view.groups.map(({ category: group, items }) => <section className="pn-inventory-group" key={group} aria-label={`${group}库存`}>
        <h2><CategoryMark category={group} />{group}</h2>
        <div className="pn-inventory-list">{items.map((item) => <div className="pn-inventory-row" key={item.id}>
          <button type="button" className="pn-inventory-open" aria-label={`查看${item.name}，余量${stockLabel(item)}${!item.location ? "，待补位置" : ""}`} onClick={() => openIngredient(item)}>
            <span className="pn-inventory-name">{item.name}{!item.location && <small className="pn-inventory-location-missing">待补位置</small>}</span><span className="pn-inventory-quantity">{stockLabel(item)}</span>
          </button>
          {!item.location && openLocationEditor && <button type="button" className="pn-inventory-fill-location" aria-label={`补充${item.name}的存放位置`} onClick={() => openLocationEditor(item)}>补位置</button>}
        </div>)}</div>
      </section>)}</div>}
    </div>
  </section>;
}

export function InventoryAdjustmentsPage({ busy, refreshKey, kind, setKind, revoke }: { busy: boolean; refreshKey: number; kind: InventoryAdjustmentKind; setKind: (kind: InventoryAdjustmentKind) => void; revoke: (id: number) => void }) {
  return <InventoryAdjustmentLedger busy={busy} refreshKey={refreshKey} kind={kind} setKind={setKind} revoke={revoke} />;
}
