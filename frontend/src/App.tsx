import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  api,
  CATEGORIES,
  LOCATIONS,
  localDate,
  type Ingredient,
  type Dish,
  type MealPlan,
  type Battle,
  type Consumption,
  type IngredientCreate,
  type IngredientUpdate,
  type MealPlanInput,
} from "./api";
import "./App.css";
import "./menu-workflow.css";
import { MenuTimeline, MenuEditor, MenuConfirm } from "./MenuWorkflow";
import { canConvertUnits, startedBatchRows } from "./batch-ingredient-logic";

const NAV = [
  ["battles", "菜单", "sun"],
  ["ingredients", "库存", "pantry"],
  ["dishes", "菜品", "book"],
] as const;
const isReadyForConfirmation = (battle: Battle) => battle.dishes.every((dish) => {
  const preparations = battle.preparations.filter((prep) => prep.daily_battle_dish_id === dish.id);
  return preparations.length > 0 && preparations.every((prep) => Boolean(prep.planned_quantity_text?.trim()));
});
const confirmationNotice = (battle: Battle) => battle.dishes.some((dish) => !battle.preparations.some((prep) => prep.daily_battle_dish_id === dish.id))
  ? "确认前先为每道菜添加耗材。"
  : "确认前请填写每项耗材的预计用量。";
const stockLabel = (item: Ingredient) => {
  const text = item.stock_text;
  const unit = item.stock_unit;
  return unit && !text.includes(unit) ? `${text}${unit}` : text;
};
type Page = (typeof NAV)[number][0] | "plans" | "consumptions" | "adjustments";
type IconName =
  (typeof NAV)[number][2] | "plus" | "moon" | "bowl" | "arrow" | "close" | "grid" | "history";
function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  const paths: Record<IconName, ReactNode> = {
    sun: (
      <>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" />
      </>
    ),
    moon: <path d="M20.5 14.5A9 9 0 0 1 9.5 3.5a9 9 0 1 0 11 11Z" />,
    pantry: (
      <>
        <rect x="5" y="3" width="14" height="18" rx="2" />
        <path d="M5 10h14M9 6v1m0 7v3" />
      </>
    ),
    book: (
      <path d="M4 5a2 2 0 0 1 2-2h14v17H6a2 2 0 0 0-2 2V5Zm0 13a2 2 0 0 1 2-2h14M8 7h8m-8 4h5" />
    ),
    grid: (
      <>
        <rect x="3" y="3" width="7" height="7" rx="2" />
        <rect x="14" y="3" width="7" height="7" rx="2" />
        <rect x="3" y="14" width="7" height="7" rx="2" />
        <rect x="14" y="14" width="7" height="7" rx="2" />
      </>
    ),
    history: <path d="M3 11a9 9 0 1 1 3 8M3 4v7h7M12 7v5l3 2" />,
    bowl: (
      <>
        <path d="M3 11h18c0 6-3 9-9 9s-9-3-9-9Z" />
        <path d="M9 7c-2-2 2-2 0-4m6 4c-2-2 2-2 0-4" />
      </>
    ),
    plus: <path d="M12 5v14M5 12h14" />,
    arrow: <path d="m9 5 7 7-7 7" />,
    close: <path d="m6 6 12 12M6 18 18 6" />,
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}
function Empty({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="empty">
      <span className="empty-icon">
        <Icon name="bowl" size={32} />
      </span>
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}
function Dialog({
  title,
  onClose,
  children,
  busy,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  busy: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    const previous = document.activeElement;
    d?.showModal();
    return () => {
      d?.close();
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      aria-labelledby="dialog-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
    >
      <div className="dialog-heading">
        <h2 id="dialog-title">{title}</h2>
        <button
          type="button"
          className="icon-button"
          aria-label="关闭弹窗"
          disabled={busy}
          onClick={onClose}
        >
          <Icon name="close" />
        </button>
      </div>
      {children}
    </dialog>
  );
}

function IngredientDetail({
  item,
  busy,
  edit,
  waste,
  history,
}: {
  item: Ingredient;
  busy: boolean;
  edit: () => void;
  waste: () => void;
  history: () => void;
}) {
  const stockQuantity = stockLabel(item);
  const [reversibleCount, setReversibleCount] = useState<number | null>(null);
  useEffect(() => {
    let alive = true;
    api.ingredientAdjustments(item.id)
      .then((response) => alive && setReversibleCount(response.data.filter((record) => record.status === "active").length))
      .catch(() => alive && setReversibleCount(null));
    return () => { alive = false; };
  }, [item.id]);
  return (
    <div className="ingredient-detail">
      <dl className="detail-grid">
        <div>
          <dt>分类</dt>
          <dd>{item.category}</dd>
        </div>
        <div>
          <dt>当前库存</dt>
          <dd>{stockQuantity}</dd>
        </div>
        {item.location && <div>
          <dt>存放位置</dt>
          <dd>{item.location}</dd>
        </div>}
      </dl>
      {item.note && (
        <div className="detail-note">
          <h4>备注</h4>
          <p>{item.note}</p>
        </div>
      )}
      <div className="actions ingredient-detail-actions">
        <button className="btn-ghost" onClick={edit} disabled={busy}>
          编辑
        </button>
        <button className="btn-ghost" onClick={history} disabled={busy}>
          变质/损坏记录{reversibleCount ? ` · 可撤销 ${reversibleCount} 条` : ""}
        </button>
        <button className="text-button danger" onClick={waste} disabled={busy}>处理变质/损坏</button>
      </div>
    </div>
  );
}

const wasteReasonText = { spoiled: "变质", damaged: "损坏", other: "其他" } as const;
function WasteEditor({ item, busy, save }: { item: Ingredient; busy: boolean; save: (payload: Parameters<typeof api.wasteIngredient>[1]) => void }) {
  const [all, setAll] = useState(true);
  const [quantity, setQuantity] = useState(String(item.stock_value));
  const [reason, setReason] = useState<"spoiled" | "damaged" | "other">("spoiled");
  const amount = Number(quantity);
  const invalid = !Number.isFinite(amount) || amount <= 0 || amount > item.stock_value;
  return <form onSubmit={(event) => { event.preventDefault(); if (!invalid) save({ stock_text: quantity, stock_value: amount, stock_unit: item.stock_unit, reason, note: String(new FormData(event.currentTarget).get("note") || "") || null, expected_updated_at: item.updated_at }); }}>
    <p className="dialog-description">当前库存 {stockLabel(item)}。处理后可在“变质/损坏记录”里查看。</p>
    <div className="unit-choice"><button type="button" className={all ? "chip active" : "chip"} onClick={() => { setAll(true); setQuantity(String(item.stock_value)); }}>全部处理</button><button type="button" className={!all ? "chip active" : "chip"} onClick={() => setAll(false)}>处理部分</button></div>
    <Field label={`处理数量（${item.stock_unit}）`}><input required disabled={all} type="number" min="0.000001" max={item.stock_value} step="0.000001" inputMode="decimal" value={quantity} onChange={e => setQuantity(e.target.value)} /></Field>
    <Field label="原因"><select value={reason} onChange={e => setReason(e.target.value as typeof reason)}>{Object.entries(wasteReasonText).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></Field>
    <Field label="备注（选填）"><textarea name="note" rows={2} maxLength={5000} placeholder="例如：冷藏失温" /></Field>
    {invalid && <p className="form-error">处理数量应大于 0，且不能超过当前库存。</p>}
    <button className="btn-primary submit" disabled={busy || invalid}>{busy ? "处理中…" : "确认处理"}</button>
  </form>;
}
function AdjustmentHistory({ item, busy, revoke }: { item: Ingredient; busy: boolean; revoke: (id: number) => void }) {
  const [records, setRecords] = useState<import("./api").InventoryAdjustment[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { let alive = true; api.ingredientAdjustments(item.id).then(x => alive && setRecords(x.data)).catch(e => alive && setError(e instanceof Error ? e.message : "读取失败")); return () => { alive = false; }; }, [item.id]);
  if (error) return <p className="form-error">{error}</p>;
  if (!records) return <p className="muted">正在读取变质/损坏记录…</p>;
  if (!records.length) return <p className="muted">还没有变质或损坏处理记录。</p>;
  const label = (text: string, unit: string) => text.includes(unit) ? text : `${text}${unit}`;
  return <div className="adjustment-history">{records.map(record => <article className="list-row" key={record.id}><div><strong>{wasteReasonText[record.reason]}</strong><p className="muted">{label(record.stock_before_text, record.stock_before_unit)} → {label(record.stock_after_text, record.stock_after_unit)}{record.note ? ` · ${record.note}` : ""}</p></div>{record.status === "active" ? <button className="text-button" disabled={busy} onClick={() => revoke(record.id)}>撤销处理</button> : <span className="muted">已撤销</span>}</article>)}</div>;
}

function InventoryAdjustmentLedger({ busy, refreshKey, revoke }: { busy: boolean; refreshKey: number; revoke: (id: number) => void }) {
  const [records, setRecords] = useState<import("./api").InventoryAdjustmentRecord[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    api.inventoryAdjustments().then((response) => alive && setRecords(response)).catch((cause) => alive && setError(cause instanceof Error ? cause.message : "读取失败"));
    return () => { alive = false; };
  }, [refreshKey]);
  if (error) return <section className="card error-state" role="alert"><p>{error}</p></section>;
  if (!records) return <p className="muted">正在读取库存处理记录…</p>;
  if (!records.length) return <Empty title="还没有库存处理记录">变质或损坏处理会出现在这里。</Empty>;
  const label = (text: string, unit: string) => text.includes(unit) ? text : `${text}${unit}`;
  const render = (record: import("./api").InventoryAdjustmentRecord) => <article className="list-row adjustment-ledger-row" key={record.id}>
    <div><strong>{record.ingredient_name} · {wasteReasonText[record.reason]}</strong><p className="muted">{label(record.stock_before_text, record.stock_before_unit)} → {label(record.stock_after_text, record.stock_after_unit)}{record.note ? ` · ${record.note}` : ""}</p></div>
    {record.status === "active" ? <button className="btn-primary" disabled={busy} onClick={() => revoke(record.id)}>撤销处理</button> : <span className="muted">已撤销</span>}
  </article>;
  const active = records.filter((record) => record.status === "active");
  const reversed = records.filter((record) => record.status === "reversed");
  return <div className="adjustment-ledger">
    <section className="card"><div className="section-heading"><h2>可撤销处理</h2><span className="muted">{active.length} 条</span></div>{active.length ? active.map(render) : <p className="muted">没有可撤销的处理。</p>}</section>
    {reversed.length > 0 && <section className="card"><div className="section-heading"><h2>处理历史</h2><span className="muted">{reversed.length} 条</span></div>{reversed.map(render)}</section>}
  </div>;
}

function DishPicker({
  dishes,
  selected,
  setSelected,
}: {
  dishes: Dish[];
  selected: number[];
  setSelected: (ids: number[]) => void;
}) {
  return (
    <fieldset className="dish-picker">
      <legend>选择菜品 · 已选 {selected.length} 道</legend>
      {dishes.length === 0 ? (
        <p>请先到菜品库保存一道菜。</p>
      ) : (
        dishes.map((d) => (
          <label
            className={`choice ${selected.includes(d.id) ? "selected" : ""}`}
            key={d.id}
          >
            <input
              type="checkbox"
              checked={selected.includes(d.id)}
              onChange={() =>
                setSelected(
                  selected.includes(d.id)
                    ? selected.filter((id) => id !== d.id)
                    : [...selected, d.id],
                )
              }
            />
            {d.name}
          </label>
        ))
      )}
    </fieldset>
  );
}
type Modal =
  | { kind: "ingredient"; item: Ingredient }
  | { kind: "ingredientSingle" }
  | { kind: "ingredientBatch" }
  | { kind: "ingredientDetail"; item: Ingredient }
  | { kind: "ingredientWaste"; item: Ingredient }
  | { kind: "ingredientHistory"; item: Ingredient }
  | { kind: "dish"; item?: Dish }
  | { kind: "dishInPlans"; item: Dish; planNames: string[] }
  | { kind: "plan"; item?: MealPlan }
  | { kind: "battle"; item?: Battle; plan?: MealPlan; copyFrom?: Battle; notice?: string }
  | { kind: "confirm"; item: Battle }
  | {
      kind: "action";
      title: string;
      message: string;
      run: () => Promise<unknown>;
    };
type Data = {
  ingredients: Ingredient[];
  dishes: Dish[];
  plans: MealPlan[];
  battles: Battle[];
  consumptions: Consumption[];
};
export default function App() {
  const [page, setPage] = useState<Page>("battles"),
    [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true),
    [loadError, setLoadError] = useState(""),
    [revision, setRevision] = useState(0);
  const [modal, setModal] = useState<Modal | null>(null),
    [busy, setBusy] = useState(false),
    [actionError, setActionError] = useState(""),
    [notice, setNotice] = useState("");
  const mutationLock = useRef(false);
  const [date, setDate] = useState(localDate),
    [search, setSearch] = useState("");
  const [category, setCategory] = useState("全部"),
    [consumptionStatus, setConsumptionStatus] = useState("all");
  const [dark, setDark] = useState(
    () => window.matchMedia("(prefers-color-scheme: dark)").matches,
  );
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
  }, [dark]);
  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      api.ingredients(controller.signal),
      api.dishes(controller.signal),
      api.plans(controller.signal),
      api.battles(controller.signal),
      api.consumptions(controller.signal),
    ])
      .then(([ingredients, dishes, plans, battles, consumptions]) => {
        if (!controller.signal.aborted) {
          setData({ ingredients, dishes, plans, battles, consumptions });
          setLoadError("");
        }
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setLoadError(
            error instanceof Error ? error.message : "加载失败，请重试。",
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [revision]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 4500);
    return () => clearTimeout(timer);
  }, [notice]);
  function reload() {
    setLoading(true);
    setLoadError("");
    setRevision((v) => v + 1);
  }
  function navigate(next: Page) {
    setPage(next);
    setSearch("");
    setNotice("");
  }
  function open(next: Modal) {
    setActionError("");
    setModal(next);
  }
  async function requestDishDelete(item: Dish) {
    try {
      const referencedPlans = (await api.dishMealPlans(item.id)).data;
      if (referencedPlans.length) {
        open({
          kind: "dishInPlans",
          item,
          planNames: referencedPlans.map((plan) => plan.name || "未命名搭配"),
        });
        return;
      }
    } catch {
      // 删除接口仍会在提交时校验，读取失败不放宽后端保护。
    }
    open({
      kind: "action",
      title: "删除这道菜？",
      message: `“${item.name}”将从菜品库移除，历史菜单会保留。`,
      run: () => api.deleteDish(item.id),
    });
  }
  async function mutate(run: () => Promise<unknown>, message: string) {
    if (mutationLock.current) return;
    mutationLock.current = true;
    setBusy(true);
    setActionError("");
    try {
      await run();
      setModal(null);
      setNotice(message);
      reload();
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "操作失败，请重试。",
      );
    } finally {
      mutationLock.current = false;
      setBusy(false);
    }
  }
  const inventories =
    data?.ingredients.filter(
      (i) =>
        (category === "全部" || i.category === category) &&
        `${i.name} ${i.location ?? ""}`.includes(search.trim()),
    ) ?? [];
  const titles = {
    battles: "安排好每一餐",
    ingredients: "食材库存",
    dishes: "把拿手菜记下来",
    plans: "好好搭配，好好吃饭",
    consumptions: "每一餐，都有迹可循",
    adjustments: "库存处理记录",
  };
  const subtitles = {
    battles: "选菜、备餐，做完后确定。每一餐都留在这里。",
    ingredients: "家里有什么，心里有个数。",
    dishes: "留住喜欢的味道，下次做饭不再纠结。",
    plans: "保存喜欢的组合，做饭时随时拿来用。",
    consumptions: "实际用了什么、还剩多少，都记在这里。",
    adjustments: "变质或损坏后，也能从这里找到并撤销处理。",
  };
  const dateLabel = new Date(`${date}T12:00:00`).toLocaleDateString("zh-CN", {
    month: "long",
    day: "numeric",
    weekday: "long",
  });
  const addButton = (text: string, next: Modal, disabled = false) => (
    <button
      className="btn-primary"
      disabled={disabled || loading || !!loadError}
      onClick={() => open(next)}
    >
      <Icon name="plus" />
      {text}
    </button>
  );
  return (
    <div className="app">
      <a className="skip-link" href="#main">
        跳到主要内容
      </a>
      <header className="header">
        <button
          className="brand"
          onClick={() => navigate("battles")}
          aria-label="食隅记首页"
        >
          <span className="brand-mark">
            <Icon name="bowl" size={23} />
          </span>
          <span>
            食隅记<small>PANTRY NOOK</small>
          </span>
        </button>
        <nav className="navigation" aria-label="主导航">
          {NAV.map(([key, title, icon]) => (
            <button
              key={key}
              className={page === key ? "nav-item active" : "nav-item"}
              aria-current={page === key ? "page" : undefined}
              onClick={() => navigate(key)}
            >
              <Icon name={icon} />
              <span>{title}</span>
            </button>
          ))}
        </nav>
        <button
          className="theme-toggle"
          onClick={() => setDark((v) => !v)}
          aria-label={dark ? "切换亮色主题" : "切换暗色主题"}
        >
          <Icon name={dark ? "sun" : "moon"} />
          <span>{dark ? "亮色" : "暗色"}</span>
        </button>
      </header>
      <main id="main" className="main">
        <div className="page-heading">
          <div>
            <p className="eyebrow">
              {page === "battles" ? dateLabel : "PANTRY NOOK · 厨房里的小日常"}
            </p>
            <h1>{titles[page]}</h1>
            <p className="subtitle">{subtitles[page]}</p>
          </div>
          <div className="heading-actions">
            {page === "battles" ? (
              <>
                {addButton("安排一餐", { kind: "battle" })}
                <button
                  className="btn-ghost"
                  onClick={() => navigate("ingredients")}
                >
                  查看库存
                </button>
              </>
            ) : page === "ingredients" ? (
              <>
                {addButton("批量记录", { kind: "ingredientBatch" })}
                <button
                  className="btn-ghost"
                  disabled={loading || !!loadError}
                  onClick={() => open({ kind: "ingredientSingle" })}
                >
                  单个记录
                </button>
                <button className="btn-ghost" onClick={() => navigate("adjustments")}>库存处理记录</button>
              </>
            ) : page === "dishes" ? (
              <>{addButton("添加菜品", { kind: "dish" })}<button className="btn-ghost" onClick={() => navigate("plans")}>常用搭配</button></>
            ) : page === "plans" ? (
              addButton("创建搭配", { kind: "plan" })
            ) : (
              <button className="btn-ghost" disabled={loading} onClick={reload}>
                刷新记录
              </button>
            )}
          </div>
        </div>
        {loading ? (
          <div
            className="loading-state"
            role="status"
            aria-label="正在加载厨房数据"
          >
            <div className="skeleton wide" />
            <div className="loading-grid">
              <div className="skeleton tall" />
              <div className="skeleton tall" />
            </div>
            <p>正在打开你的厨房…</p>
          </div>
        ) : loadError ? (
          <section className="card error-state" role="alert">
            <h2>厨房暂时连接不上</h2>
            <p>{loadError}</p>
            <button className="btn-primary" onClick={reload}>
              重新加载
            </button>
          </section>
        ) : (
          data && (
            <>
              {page === "battles" && (
                <MenuTimeline battles={data.battles} consumptions={data.consumptions}
                  edit={b => open({kind: 'battle', item: b})}
                  confirm={b => isReadyForConfirmation(b)
                    ? open({kind: 'confirm', item: b})
                    : open({kind: 'battle', item: b, notice: confirmationNotice(b)})}
                  copy={b => open({kind: 'battle', copyFrom: b})}
                  cancel={b => open({kind: 'action', title: '取消这份菜单？', message: '菜单保留在历史中，不产生消耗，不改变库存。', run: () => api.battleAction(b.id, 'cancel')})}
                  revoke={b => open({kind: 'action', title: '撤销这次确定？', message: '恢复本次确认前的库存，菜单回到待完成。如果存在后续变化，会提示你先核对。', run: () => api.battleAction(b.id, 'revoke-confirmation', {target_status: 'planned'})})}
                  remove={b => open({kind: 'action', title: '删除这份未执行菜单？', message: '没有消耗历史的菜单会被删除，无法恢复。库存不变。', run: () => api.deleteBattle(b.id)})}
                />
              )}
              {page === "ingredients" && (
                <>
                  <div className="filter-bar">
                    <input
                      type="search"
                      aria-label="搜索食材"
                      placeholder="搜索食材或存放位置"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                  </div>
                  <div className="chips" aria-label="食材分类">
                    {["全部", ...CATEGORIES].map((c) => (
                      <button
                        className={category === c ? "chip active" : "chip"}
                        aria-pressed={category === c}
                        key={c}
                        onClick={() => setCategory(c)}
                      >
                        {c}
                      </button>
                    ))}
                  </div>
                  <div className="inventory-groups">
                    {CATEGORIES.map(group => {
                      const items = inventories.filter(i => i.category === group);
                      return items.length > 0 && <section className="inventory-group" key={group} aria-label={group + '库存'}>
                        <div className="section-heading"><h2>{group}</h2><span className="muted">{items.length} 项</span></div>
                        <div className="inventory-list">
                          {items.map(i => <button type="button" className="ingredient-row ingredient-compact" key={i.id}
                            aria-label={`查看${i.name}，余量${i.stock_text ?? i.stock_text}`}
                            onClick={() => open({kind: 'ingredientDetail', item: i})}>
                            <span className="ingredient-name">{i.name}</span><span className="ingredient-quantity">{stockLabel(i)}</span>
                            <span className="ingredient-row-arrow" aria-hidden="true"><Icon name="arrow" size={15} /></span>
                          </button>)}
                        </div>
                      </section>;
                    })}
                  </div>
                  {inventories.length === 0 && (
                    <section className="card">
                      <Empty
                        title={
                          search || category !== "全部"
                            ? "没有找到这些食材"
                            : "这里还没有食材"
                        }
                      >
                        {search || category !== "全部"
                          ? "试试其他名称，或切换分类。"
                          : "记下家里现有的食材，让下一顿有个着落。"}
                      </Empty>
                    </section>
                  )}
                </>
              )}
              {page === "adjustments" && (
                <InventoryAdjustmentLedger busy={busy} refreshKey={revision}
                  revoke={(id) => void mutate(() => api.revokeAdjustment(id), "已撤销库存处理")} />
              )}
              {page === "dishes" && (
                <>
                  <div className="filter-bar">
                    <input
                      type="search"
                      aria-label="搜索菜品"
                      placeholder="找一道熟悉的菜"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                  </div>
                  <section className="card">
                    <div className="section-heading">
                      <h2>我的菜品库</h2>
                      <span className="muted">保存菜名，随时搭配</span>
                    </div>
                    {data.dishes
                      .filter((d) => d.name.includes(search.trim()))
                      .map((d) => (
                        <article className="list-row" key={d.id}>
                          <span className="category-icon">
                            <Icon name="book" />
                          </span>
                          <strong>{d.name}</strong>
                          <div className="actions">
                            <button
                              className="btn-ghost"
                              onClick={() => open({ kind: "dish", item: d })}
                            >
                              编辑
                            </button>
                            <button
                              className="text-button danger"
                              onClick={() => void requestDishDelete(d)}
                            >
                              删除
                            </button>
                          </div>
                        </article>
                      ))}
                    {!data.dishes.some((d) =>
                      d.name.includes(search.trim()),
                    ) && (
                      <Empty title="还没有找到菜品">
                        把常做的菜记下来，下次就能直接选。
                      </Empty>
                    )}
                  </section>
                </>
              )}
              {page === "plans" && (
                <>
                  <div className="inventory-grid">
                    {data.plans.map((p) => (
                      <article className="card plan-card" key={p.id}>
                        <span className="eyebrow">喜欢的组合</span>
                        <h2>{p.name || "未命名搭配"}</h2>
                        <div className="dish-tags">
                          {p.dishes.map((d) => (
                            <span key={d.id}>{d.name}</span>
                          ))}
                        </div>
                        <div className="actions">
                          <button
                            className="btn-primary"
                            onClick={() => {
                              navigate("battles");
                              open({ kind: "battle", plan: p });
                            }}
                          >
                            用这个搭配
                          </button>
                          <button
                            className="text-button"
                            onClick={() => open({ kind: "plan", item: p })}
                          >
                            编辑
                          </button>
                          <button
                            className="text-button danger"
                            onClick={() =>
                              open({
                                kind: "action",
                                title: "删除这个搭配？",
                                message:
                                  "将删除这个模板。已经复制出的作战菜单不受影响。",
                                run: () => api.deletePlan(p.id),
                              })
                            }
                          >
                            删除
                          </button>
                        </div>
                      </article>
                    ))}
                  </div>
                  {data.plans.length === 0 && (
                    <section className="card">
                      <Empty title="存一份喜欢的搭配">
                        选几道菜组成模板，下次可以直接安排。
                      </Empty>
                    </section>
                  )}
                </>
              )}
              {page === "consumptions" && (
                <>
                  <div className="filter-bar">
                    <input
                      aria-label="搜索消耗记录"
                      type="search"
                      placeholder="搜索食材或消耗原文"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                    <select
                      aria-label="消耗状态"
                      value={consumptionStatus}
                      onChange={(e) => setConsumptionStatus(e.target.value)}
                    >
                      <option value="all">全部记录</option>
                      <option value="active">有效消耗</option>
                      <option value="reversed">已撤销</option>
                    </select>
                  </div>
                  <section className="card">
                    <div className="section-heading">
                      <h2>消耗记录</h2>
                      <span className="muted">保留每次确认与撤销</span>
                    </div>
                    {data.consumptions
                      .filter(
                        (c) =>
                          (consumptionStatus === "all" ||
                            consumptionStatus === c.status) &&
                          `${c.ingredient_name} ${c.quantity_used_text}`.includes(
                            search.trim(),
                          ),
                      )
                      .map((c) => (
                        <article className="consumption-row" key={c.id}>
                          <div>
                            <small>
                              {c.battle_date} · 作战 #{c.daily_battle_id}
                            </small>
                            <h3>{c.ingredient_name}</h3>
                            <p>
                              用了 {c.quantity_used_text}
                              {c.daily_battle_dish_name
                                ? ` · ${c.daily_battle_dish_name}`
                                : ""}
                            </p>
                            <p className="muted">
                              当时余量：{c.remaining_before_text ?? "未记录"} →{" "}
                              {c.remaining_after_text ?? "未记录"}
                            </p>
                          </div>
                          <span
                            className={`badge ${c.status === "active" ? "confirmed" : "cancelled"}`}
                          >
                            {c.status === "active" ? "有效消耗" : "已撤销"}
                          </span>
                        </article>
                      ))}
                    {!data.consumptions.some(
                      (c) =>
                        (consumptionStatus === "all" ||
                          consumptionStatus === c.status) &&
                        `${c.ingredient_name} ${c.quantity_used_text}`.includes(
                          search.trim(),
                        ),
                    ) && (
                      <Empty title="这里还没有消耗记录">
                        做完饭后核对用料并确认，记录就会出现在这里。
                      </Empty>
                    )}
                  </section>
                </>
              )}
            </>
          )
        )}
        <footer className="footer">
          <Icon name="bowl" size={16} />
          一隅烟火，三餐日常。<span>食隅记 Pantry Nook</span>
        </footer>
      </main>
      {notice && (
        <div role="status" className="toast">
          ✓ {notice}
        </div>
      )}
      {modal && data && (
        <Dialog
          key={modal.kind}
          title={
            modal.kind === "action"
              ? modal.title
              : modal.kind === "confirm"
                ? "核对这一餐的实际用料"
                : modal.kind === "ingredient"
                  ? "编辑食材"
                  : modal.kind === "ingredientSingle"
                    ? "记录食材"
                  : modal.kind === "ingredientBatch"
                    ? "批量记录食材"
                  : modal.kind === "ingredientDetail"
                    ? `查看食材 · ${modal.item.name}`
                  : modal.kind === "ingredientWaste"
                    ? `处理变质/损坏 · ${modal.item.name}`
                  : modal.kind === "ingredientHistory"
                    ? `变质/损坏记录 · ${modal.item.name}`
                  : modal.kind === "dishInPlans"
                    ? "先处理常用搭配"
                  : modal.kind === "dish"
                    ? modal.item
                      ? "编辑菜品"
                      : "添加菜品"
                    : modal.kind === "plan"
                      ? modal.item
                        ? "编辑搭配"
                        : "创建搭配"
                      : modal.item
                        ? "编辑菜单"
                        : "安排一餐"
          }
          onClose={() => { setModal(null); if (modal.kind === "confirm") reload(); }}
          busy={busy}
        >
          {actionError && (
            <p className="form-error" role="alert">
              {actionError}
            </p>
          )}
          {modal.kind === "ingredient" && (
            <IngredientEditor
              item={modal.item}
              busy={busy}
              save={(payload) =>
                void mutate(
                  () => api.saveIngredient(modal.item.id, payload),
                  "食材已保存",
                )
              }
            />
          )}
          {(modal.kind === "ingredientBatch" || modal.kind === "ingredientSingle") && (
            <IngredientBatchEditor
              busy={busy}
              single={modal.kind === "ingredientSingle"}
              existingIngredients={data.ingredients}
              save={(ingredients, resolutions, categoryResolutions, manualTotals) =>
                void mutate(
                  () => api.saveIngredientsBatch(ingredients, resolutions, categoryResolutions, manualTotals),
                  `已记录 ${ingredients.length} 项食材`,
                )
              }
            />
          )}
          {modal.kind === "ingredientDetail" && (
            <IngredientDetail
              item={modal.item}
              busy={busy}
              edit={() => {
                open({ kind: "ingredient", item: modal.item });
              }}
              waste={() => open({ kind: "ingredientWaste", item: modal.item })}
              history={() => open({ kind: "ingredientHistory", item: modal.item })}
            />
          )}
          {modal.kind === "ingredientWaste" && (
            <WasteEditor item={modal.item} busy={busy} save={payload => void mutate(() => api.wasteIngredient(modal.item.id, payload), "库存已更新")} />
          )}
          {modal.kind === "ingredientHistory" && (
            <AdjustmentHistory item={modal.item} busy={busy} revoke={id => void mutate(() => api.revokeAdjustment(id), "已撤销库存处理")} />
          )}
          {modal.kind === "dish" && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                void mutate(
                  () => api.saveDish(modal.item?.id, String(f.get("name"))),
                  "菜品已保存",
                );
              }}
            >
              <Field label="菜品名称">
                <input
                  name="name"
                  required
                  maxLength={255}
                  defaultValue={modal.item?.name}
                  placeholder="例如：番茄炒蛋"
                />
              </Field>
              <button className="btn-primary submit" disabled={busy}>
                {busy ? "保存中…" : "保存菜品"}
              </button>
            </form>
          )}
          {modal.kind === "dishInPlans" && (
            <>
              <p className="dialog-description">
                “{modal.item.name}”正在被{modal.planNames.join("、")}使用。先编辑或删除这些搭配，再回来删除菜品。
              </p>
              <div className="actions">
                <button className="btn-ghost" onClick={() => setModal(null)}>返回</button>
                <button className="btn-primary" onClick={() => { setModal(null); navigate("plans"); }}>查看常用搭配</button>
              </div>
            </>
          )}
          {modal.kind === "plan" && (
            <PlanEditor
              item={modal.item}
              dishes={data.dishes}
              busy={busy}
              savePlan={(payload) =>
                void mutate(
                  () => api.savePlan(modal.item?.id, payload),
                  "搭配已保存",
                )
              }
            />
          )}
          {modal.kind === "battle" && (
            <MenuEditor item={modal.item} copyFrom={modal.copyFrom} initialPlan={modal.plan} notice={modal.notice}
              sourceDishes={data.dishes} plans={data.plans} ingredients={data.ingredients} busy={busy}
              onDishAdded={dish => setData(current => current ? {...current, dishes: current.dishes.some(d => d.id === dish.id) ? current.dishes : [...current.dishes, dish]} : current)}
              save={payload => void mutate(async () => {
                const result = await api.saveBattle(modal.item?.id, payload);
                setDate(result.data.battle_date); navigate("battles"); return result;
              }, "菜单已保存，备餐不会扣库存")}
            />
          )}
          {modal.kind === "confirm" && (
            <MenuConfirm battleId={modal.item.id} busy={busy} onPending={setBusy}
              save={async payload => {
                await api.battleAction(modal.item.id, "confirm", payload);
                setModal(null);
                setNotice("已确定，库存已更新，菜单已归入历史");
                reload();
              }}
            />
          )}
          {modal.kind === "action" && (
            <>
              <p className="dialog-description">{modal.message}</p>
              <div className="actions">
                <button
                  className="btn-ghost"
                  disabled={busy}
                  onClick={() => setModal(null)}
                >
                  返回
                </button>
                <button
                  className="btn-primary"
                  disabled={busy}
                  onClick={() => void mutate(modal.run, "操作已保存")}
                >
                  {busy ? "处理中…" : "确认操作"}
                </button>
              </div>
            </>
          )}
        </Dialog>
      )}
    </div>
  );
}

type BatchIngredientRow = {
  id: number;
  name: string;
  quantity: string;
  unit: string;
};
type InventoryConflict = {
  ingredient: Ingredient;
  incomingUnit: string;
  incomingCategory: IngredientCreate["category"];
};

const blankBatchIngredient = (id: number): BatchIngredientRow => ({
  id,
  name: "",
  quantity: "",
  unit: "个",
});

function IngredientBatchEditor({
  busy,
  single = false,
  existingIngredients,
  save,
}: {
  busy: boolean;
  single?: boolean;
  existingIngredients: Ingredient[];
  save: (
    ingredients: IngredientCreate[],
    resolutions: { ingredient_id: number; unit: string }[],
    categoryResolutions: { ingredient_id: number; category: IngredientCreate["category"] }[],
    manualTotals: { ingredient_id: number; stock_text: string; stock_value: number; unit: string; expected_updated_at: string }[],
  ) => void;
}) {
  const [rows, setRows] = useState(() =>
    Array.from({ length: single ? 1 : 5 }, (_, index) => blankBatchIngredient(index + 1)),
  );
  const [batchCategory, setBatchCategory] = useState<IngredientCreate["category"]>("蔬菜");
  const [error, setError] = useState("");
  const [conflicts, setConflicts] = useState<InventoryConflict[]>([]);
  const [units, setUnits] = useState<Record<number, string>>({});
  const [categories, setCategories] = useState<Record<number, IngredientCreate["category"]>>({});
  const [manualTotals, setManualTotals] = useState<Record<number, string>>({});
  const change = <K extends keyof BatchIngredientRow>(
    id: number,
    key: K,
    value: BatchIngredientRow[K],
  ) => setRows((current) => current.map((row) => row.id === id ? { ...row, [key]: value } : row));
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const filled = startedBatchRows(rows);
    if (!filled.length) {
      setError("先填写至少一项食材。");
      return;
    }
    const incomplete = filled.find((row) => !row.name.trim() || !row.quantity.trim() || !row.unit.trim());
    if (incomplete) {
      setError(`第 ${rows.indexOf(incomplete) + 1} 项请补全食材名、数量和单位。`);
      return;
    }
    const ingredients = filled.map((row) => ({
      name: row.name.trim(),
      category: batchCategory,
      stock_text: row.quantity.trim(),
      stock_value: Number(row.quantity),
      stock_unit: row.unit.trim(),
    }));
    const matches = ingredients.flatMap((item) => {
      const existing = existingIngredients.find((candidate) => candidate.name.trim().toLocaleLowerCase() === item.name.toLocaleLowerCase());
      if (!existing) return [];
      const existingUnit = existing.stock_unit ?? existing.stock_unit;
      return existingUnit !== item.stock_unit || existing.category !== item.category
        ? [{ ingredient: existing, incomingUnit: item.stock_unit ?? "", incomingCategory: item.category }]
        : [];
    });
    setError("");
    if (matches.length) {
      setConflicts(matches);
      setUnits(Object.fromEntries(matches.map(({ ingredient, incomingUnit }) => [ingredient.id, incomingUnit])));
      setCategories(Object.fromEntries(matches.map(({ ingredient }) => [ingredient.id, ingredient.category])));
      setManualTotals({});
      return;
    }
    save(ingredients, [], [], []);
  }
  const draftIngredients = startedBatchRows(rows).map((row) => ({ name: row.name.trim(), category: batchCategory, stock_text: row.quantity.trim(), stock_value: Number(row.quantity), stock_unit: row.unit.trim() }));
  if (conflicts.length) {
    const manualTotalMissing = conflicts.some(({ ingredient, incomingUnit }) => {
      const oldUnit = ingredient.stock_unit ?? ingredient.stock_unit ?? "";
      return oldUnit !== incomingUnit && !canConvertUnits(oldUnit, incomingUnit) && !manualTotals[ingredient.id]?.trim();
    });
    return <div className="batch-resolution">
    <p className="form-notice">发现已有同名食材。请确认分类和单位；保存后只会保留一条库存记录。</p>
    {conflicts.map(({ ingredient, incomingUnit, incomingCategory }) => {
      const oldUnit = ingredient.stock_unit ?? ingredient.stock_unit ?? "";
      const hasCategoryConflict = ingredient.category !== incomingCategory;
      const hasUnitConflict = oldUnit !== incomingUnit;
      const needsManualTotal = hasUnitConflict && !canConvertUnits(oldUnit, incomingUnit);
      return <fieldset key={ingredient.id}><legend>{ingredient.name}</legend><p className="muted">现有 {ingredient.category} · {stockLabel(ingredient)}；本次 {incomingCategory} · {draftIngredients.find(item => item.name.toLocaleLowerCase() === ingredient.name.toLocaleLowerCase())?.stock_text}{incomingUnit}</p>
        {hasCategoryConflict && <><p className="resolution-label">分类</p><div className="unit-choice"><button type="button" className={categories[ingredient.id] === ingredient.category ? "chip active" : "chip"} onClick={() => setCategories(current => ({...current, [ingredient.id]: ingredient.category}))}>保留为 {ingredient.category}</button><button type="button" className={categories[ingredient.id] === incomingCategory ? "chip active" : "chip"} onClick={() => setCategories(current => ({...current, [ingredient.id]: incomingCategory}))}>改为 {incomingCategory}</button></div></>}
        {hasUnitConflict && <><p className="resolution-label">单位</p><div className="unit-choice"><button type="button" className={units[ingredient.id] === oldUnit ? "chip active" : "chip"} onClick={() => setUnits(current => ({...current, [ingredient.id]: oldUnit}))}>统一为 {oldUnit}</button><button type="button" className={units[ingredient.id] === incomingUnit ? "chip active" : "chip"} onClick={() => setUnits(current => ({...current, [ingredient.id]: incomingUnit}))}>统一为 {incomingUnit}</button></div></>}
        {needsManualTotal && <div className="manual-total"><label htmlFor={`manual-total-${ingredient.id}`}>合并后的库存量（{units[ingredient.id]}）</label><input id={`manual-total-${ingredient.id}`} type="number" inputMode="decimal" min="0" step="0.000001" placeholder="按实际库存填写" value={manualTotals[ingredient.id] ?? ""} onChange={(event) => setManualTotals(current => ({ ...current, [ingredient.id]: event.target.value }))} /><p className="form-hint">这两种单位无法自动换算，请按实际库存填写最终数量。</p></div>}
        </fieldset>;
    })}
    <div className="actions"><button type="button" className="btn-ghost" onClick={() => setConflicts([])}>返回修改</button><button type="button" className="btn-primary" onClick={() => save(
      draftIngredients,
      conflicts.filter(({ ingredient, incomingUnit }) => (ingredient.stock_unit ?? ingredient.stock_unit ?? "") !== incomingUnit).map(({ ingredient }) => ({ ingredient_id: ingredient.id, unit: units[ingredient.id] })),
      conflicts.filter(({ ingredient, incomingCategory }) => ingredient.category !== incomingCategory).map(({ ingredient }) => ({ ingredient_id: ingredient.id, category: categories[ingredient.id] })),
      conflicts.filter(({ ingredient, incomingUnit }) => {
        const oldUnit = ingredient.stock_unit ?? ingredient.stock_unit ?? "";
        return oldUnit !== incomingUnit && !canConvertUnits(oldUnit, incomingUnit);
      }).map(({ ingredient }) => ({ ingredient_id: ingredient.id, stock_text: manualTotals[ingredient.id].trim(), stock_value: Number(manualTotals[ingredient.id]), unit: units[ingredient.id], expected_updated_at: ingredient.updated_at })),
    )} disabled={busy || manualTotalMissing}>{busy ? "保存中…" : "按选择保存"}</button></div>
  </div>;
  }
  return (
    <form className="batch-ingredient-editor" onSubmit={submit}>
      <div className="batch-category-picker">
        <Field label={single ? "这一项食材属于" : "这一批食材属于"}>
          <select value={batchCategory} onChange={(event) => setBatchCategory(event.target.value as IngredientCreate["category"])}>
            {CATEGORIES.map((category) => <option key={category}>{category}</option>)}
          </select>
        </Field>
        <p className="form-hint">{single ? `这一项食材会归到“${batchCategory}”。` : `下面填写的食材都会归到“${batchCategory}”。`}</p>
      </div>
      <p className="form-hint">{single ? "填写名称、数量和单位后保存。" : "连续填写即可，空白行会自动忽略；保存时整批一起入库。"}</p>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="batch-ingredient-rows">
        {rows.map((row, index) => (
          <div className="batch-ingredient-row" key={row.id}>
            <span className="batch-row-number" aria-hidden="true">{index + 1}</span>
            <input
              aria-label={`第 ${index + 1} 项食材名称`}
              placeholder="食材名"
              maxLength={255}
              value={row.name}
              onChange={(event) => change(row.id, "name", event.target.value)}
            />
            <input
              aria-label={`第 ${index + 1} 项数量`}
              type="number"
              inputMode="decimal"
              min="0"
              step="0.000001"
              placeholder="数量"
              value={row.quantity}
              onChange={(event) => change(row.id, "quantity", event.target.value)}
            />
            <input
              aria-label={`第 ${index + 1} 项单位`}
              list="batch-ingredient-units"
              maxLength={50}
              placeholder="单位"
              value={row.unit}
              onChange={(event) => change(row.id, "unit", event.target.value)}
            />
            <button
              type="button"
              className="text-button batch-row-remove"
              aria-label={`清空第 ${index + 1} 项`}
              disabled={busy}
              onClick={() => setRows((current) => current.length === 1 ? [blankBatchIngredient(row.id + 1)] : current.filter((entry) => entry.id !== row.id))}
            >
              清空
            </button>
          </div>
        ))}
      </div>
      <datalist id="batch-ingredient-units">
        {['个', 'g', 'kg', 'ml', 'L', '包', '盒', '袋', '份', '把'].map((unit) => <option key={unit} value={unit} />)}
      </datalist>
      {!single && <button
        type="button"
        className="btn-ghost batch-add-row"
        disabled={busy || rows.length >= 30}
        onClick={() => setRows((current) => [...current, blankBatchIngredient(Math.max(...current.map((row) => row.id)) + 1)])}
      >
        再加一行
      </button>}
      <button className="btn-primary submit" disabled={busy}>
        {busy ? "保存中…" : single ? "保存食材" : "保存这批食材"}
      </button>
    </form>
  );
}

function IngredientEditor({
  item,
  busy,
  save,
}: {
  item: Ingredient;
  busy: boolean;
  save: (payload: IngredientCreate | IngredientUpdate) => void;
}) {
  const currentQuantity = item.stock_value;
  const currentUnit = item.stock_unit;
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const p: IngredientUpdate = {
      name: String(f.get("name")),
      category: f.get("category") as IngredientCreate["category"],
      location: (f.get("location") || null) as IngredientCreate["location"],
      note: String(f.get("note") || "") || null,
    };
    {
      const quantityText = String(f.get("quantity") || "").trim();
      const quantityUnit = String(f.get("stock_unit") || "").trim();
      // 编辑库存量就是更新当前库存；购入记录与消耗历史不在此处修改。
      p.stock_text = quantityText;
      p.stock_value = Number(quantityText);
      p.stock_unit = quantityUnit;
    }
    // 只提交用户实际改过的字段，编辑名称不会覆盖另一设备更新后的库存。
    const patch: IngredientUpdate = {};
    for (const key of ["name", "category", "location", "note", "stock_text", "stock_value", "stock_unit"] as const) {
      const value = p[key];
      if (value !== undefined && value !== item[key]) Object.assign(patch, { [key]: value });
    }
    if (Object.keys(patch).some(key => key.startsWith("stock_"))) patch.expected_updated_at = item.updated_at;
    save(patch);
  }
  return (
    <form onSubmit={submit}>
      <div className="form-grid">
        <Field label="食材名称">
          <input
            name="name"
            required
            maxLength={255}
            defaultValue={item?.name}
            placeholder="例如：鸡蛋"
          />
        </Field>
        <Field label="分类">
          <select name="category" defaultValue={item?.category ?? "蔬菜"}>
            {CATEGORIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </Field>
        <Field label="存放位置">
          <select name="location" defaultValue={item?.location ?? ""}>
            <option value="">未填写</option>
            {LOCATIONS.map((l) => (
              <option key={l}>{l}</option>
            ))}
          </select>
        </Field>
      </div>
      <fieldset>
        <legend>当前库存</legend>
        <div className="form-grid">
          <Field label="数量">
            <input
              type="number"
              name="quantity"
              required
              min="0"
              step="0.000001"
              inputMode="decimal"
              defaultValue={currentQuantity}
              placeholder="例如：6"
            />
          </Field>
          <Field label="单位">
            <input
              name="stock_unit"
              required
              list="ingredient-units"
              maxLength={50}
              defaultValue={currentUnit}
              placeholder="例如：个"
            />
          </Field>
        </div>
        <datalist id="ingredient-units">
          {['个', 'g', 'kg', 'ml', 'L', '包', '盒', '袋', '份', '把'].map((unit) => <option key={unit} value={unit} />)}
        </datalist>
      </fieldset>
      <Field label="备注（选填）">
        <textarea
          name="note"
          maxLength={5000}
          rows={2}
          defaultValue={item?.note ?? ""}
        />
      </Field>
      <button
        className="btn-primary submit"
        disabled={busy}
      >
        {busy ? "保存中…" : "保存食材"}
      </button>
    </form>
  );
}
function PlanEditor({
  item,
  dishes,
  busy,
  savePlan,
}: {
  item?: MealPlan;
  dishes: Dish[];
  busy: boolean;
  savePlan: (payload: MealPlanInput) => void;
}) {
  const [selected, setSelected] = useState<number[]>(item?.dishes.map((d) => d.id) ?? []);
  const unavailable = selected.filter((id) => !dishes.some((d) => d.id === id));
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    savePlan({
      name: String(f.get("name") || "") || null,
      dish_ids: selected,
    });
  }
  return (
    <form onSubmit={submit}>
      <Field label="搭配名称（选填）">
        <input name="name" maxLength={255} defaultValue={item?.name ?? ""} placeholder="给这个组合起个名字" />
      </Field>
      <DishPicker dishes={dishes} selected={selected} setSelected={setSelected} />
      {unavailable.length > 0 && (
        <p className="form-error">
          部分菜品已删除，请重新选择。
          <button type="button" className="text-button" onClick={() => setSelected(selected.filter((id) => dishes.some((d) => d.id === id)))}>移除失效选择</button>
        </p>
      )}
      <p className="form-hint">
        搭配是模板，修改不会改变已创建的菜单。
      </p>
      <button className="btn-primary submit" disabled={busy || selected.length === 0 || unavailable.length > 0}>{busy ? "保存中…" : "保存搭配"}</button>
    </form>
  );
}
