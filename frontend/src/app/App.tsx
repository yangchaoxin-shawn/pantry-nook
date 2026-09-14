import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  api,
  ApiError,
  localDate,
  type Ingredient,
  type Dish,
  type MealPlan,
  type Battle,
} from "../shared/api/client";
import "../App.css";
import type { RecoveryDraft } from "../features/recovery/RecoveryDialog";
import "../menu-workflow.css";
import { MenuTimeline } from "../features/menu/MenuTimeline";
import { Icon } from "../shared/ui/Primitives";
import { InventoryAdjustmentsPage, InventoryPage } from "../features/inventory/InventoryPages";
import { DishesPage, PlansPage } from "../features/catalog/CatalogPages";
import { ConsumptionPage } from "../features/menu/ConsumptionPage";
import { AppModal } from "./AppModal";
import { JournalHero, KitchenSketch } from '../shared/ui/JournalArt';
import { JournalSceneHero } from '../shared/ui/JournalSceneHero';
import '../styles/journal.css';
import type { AppData, Modal, Page } from "./types";
import type { InventoryLocation } from '../features/inventory/inventory-view';
import './navigation.css';

const NAV = [
  ["battles", "餐安排", "sun"],
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
export default function App() {
  const [page, setPage] = useState<Page>("battles"),
    [data, setData] = useState<AppData | null>(null);
  const [loading, setLoading] = useState(true),
    [loadError, setLoadError] = useState(""),
    [revision, setRevision] = useState(0);
  const [modal, setModal] = useState<Modal | null>(null),
    [busy, setBusy] = useState(false),
    [actionError, setActionError] = useState(""),
    [notice, setNotice] = useState("");
  const [editConflict, setEditConflict] = useState<Ingredient | Dish | MealPlan | null>(null);
  const mutationLock = useRef(false);
  const [recoveryDrafts, setRecoveryDrafts] = useState<Record<string, RecoveryDraft>>({});
  const [date, setDate] = useState(localDate),
    [search, setSearch] = useState("");
  const [category, setCategory] = useState("全部"),
    [consumptionStatus, setConsumptionStatus] = useState("all");
  const [inventoryLocation, setInventoryLocation] = useState<InventoryLocation>(null),
    [locationItems, setLocationItems] = useState<Ingredient[] | null>(null),
    [locationError, setLocationError] = useState("");
  const pageMemory = useRef<Partial<Record<Page, { search: string; scroll: number }>>>({});
  const restoreScroll = useRef<number | null>(null);
  useLayoutEffect(() => {
    if (!loading && restoreScroll.current !== null) {
      window.scrollTo({ top: restoreScroll.current, behavior: 'instant' });
      restoreScroll.current = null;
    }
  }, [page, loading]);
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
    if (!inventoryLocation || inventoryLocation === 'unassigned') return;
    const controller = new AbortController();
    api.ingredientsAtLocation(inventoryLocation, controller.signal)
      .then((items) => {
        if (!controller.signal.aborted) {
          setLocationItems(items);
          setLocationError("");
        }
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          setLocationItems([]);
          setLocationError(error instanceof Error ? error.message : "暂时无法读取这个位置的食材。");
        }
      });
    return () => controller.abort();
  }, [inventoryLocation, revision]);
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
    if (next === page) return;
    pageMemory.current[page] = { search, scroll: window.scrollY };
    const saved = pageMemory.current[next];
    restoreScroll.current = saved?.scroll ?? 0;
    setPage(next);
    setSearch(saved?.search ?? '');
    setNotice("");
  }
  function chooseInventoryLocation(location: InventoryLocation) {
    if (location === inventoryLocation) return;
    setInventoryLocation(location);
    setLocationError("");
    setLocationItems(null);
  }
  function open(next: Modal) {
    setActionError("");
    setEditConflict(null);
    setModal(next);
  }
  async function requestDishDelete(item: Dish) {
    const pendingMenus = data?.battles.filter((battle) =>
      battle.status === "planned" && battle.dishes.some((dish) => dish.dish_id === item.id),
    ) ?? [];
    if (pendingMenus.length) {
      const mealLabels = { breakfast: "早餐", lunch: "午餐", dinner: "晚餐" } as const;
      open({
        kind: "dishInMenus",
        item,
        menuNames: pendingMenus.map((battle) => `${battle.battle_date} ${mealLabels[battle.meal_slot]}`),
      });
      return;
    }
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
    if (mutationLock.current || editConflict) return;
    mutationLock.current = true;
    setBusy(true);
    setActionError("");
    try {
      await run();
      setModal(null);
      setNotice(message);
      reload();
    } catch (error) {
      if (error instanceof ApiError && error.code === 'RECORD_CHANGED' && error.details?.current) {
        setEditConflict(error.details.current);
      }
      setActionError(
        error instanceof Error ? error.message : "操作失败，请重试。",
      );
    } finally {
      mutationLock.current = false;
      setBusy(false);
    }
  }
  const titles = {
    battles: "安排好每一餐",
    ingredients: "食材库存",
    dishes: "把拿手菜记下来",
    plans: "好好搭配，好好吃饭",
    consumptions: "每一餐，都有迹可循",
    adjustments: "变质 / 损坏记录",
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
  const inventoryActions = <>
    <button className="btn-ghost" disabled={loading || !!loadError} onClick={() => open({ kind: 'ingredientSingle' })}>
      <Icon name="plus" />单个记录
    </button>
    {addButton('批量记录', { kind: 'ingredientBatch' })}
  </>;
  const activePage = page === 'adjustments' ? 'ingredients' : page === 'plans' ? 'dishes' : page === 'consumptions' ? 'battles' : page;
  const parentPage = page === 'adjustments' ? { page: 'ingredients' as const, label: '库存', current: '变质 / 损坏记录' }
    : page === 'plans' ? { page: 'dishes' as const, label: '菜品', current: '常用搭配' }
    : page === 'consumptions' ? { page: 'battles' as const, label: '餐安排', current: '用料记录' } : null;
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
              className={activePage === key ? "nav-item active" : "nav-item"}
              aria-current={activePage === key ? "page" : undefined}
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
        {parentPage && <div className="subpage-navigation"><nav aria-label="当前位置"><button type="button" onClick={() => navigate(parentPage.page)}>{parentPage.label}</button><span aria-hidden="true">/</span><span aria-current="page">{parentPage.current}</span></nav><button type="button" className="btn-ghost subpage-back" onClick={() => navigate(parentPage.page)}><span aria-hidden="true">←</span> 返回{parentPage.label}</button></div>}
        {page === 'ingredients' ? <JournalHero /> : page === 'battles' ? <JournalSceneHero
          kind="menu"
          eyebrow={dateLabel}
          actions={<>
            {addButton("安排一餐", { kind: "battle" })}
            <button className="btn-ghost" onClick={() => navigate("ingredients")}>查看库存</button>
          </>}
        /> : page === 'dishes' ? <JournalSceneHero
          kind="catalog"
          actions={<>
            {addButton("添加菜品", { kind: "dish" })}
            <button className="btn-ghost" onClick={() => navigate("plans")}>常用搭配</button>
          </>}
        /> : <div className="page-heading">
          <div>
            <p className="eyebrow">PANTRY NOOK · 厨房里的小日常</p>
            <h1>{titles[page]}</h1>
            <p className="subtitle">{subtitles[page]}</p>
          </div>
          <div className="heading-actions">
            {page === "plans" ? (
              addButton("创建搭配", { kind: "plan" })
            ) : (
              <button className="btn-ghost" disabled={loading} onClick={reload}>
                刷新记录
              </button>
            )}
          </div>
        </div>}
        {loading ? (
          <div
            className="loading-state"
            role="status"
            aria-label="正在加载厨房数据"
          >
            <KitchenSketch kind="loading" />
            <p>正在打开你的厨房…</p>
            <div className="loading-grid">
              <div className="skeleton tall" />
              <div className="skeleton tall" />
            </div>
          </div>
        ) : loadError ? (
          <section className="card error-state" role="alert">
            <KitchenSketch kind="error" />
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
                  restore={b => open({kind: 'action', title: '恢复这份菜单？', message: '这份原菜单会回到待完成，日期、餐次、菜品和历史都会保留。', run: () => api.battleAction(b.id, 'resume', { expected_updated_at: b.updated_at })})}
                  revoke={b => open({kind: 'recovery', recoveryKind: 'battle', id: b.id})}
                  remove={b => open({kind: 'action', title: '删除这份未执行菜单？', message: '没有消耗历史的菜单会被删除，无法恢复。库存不变。', run: () => api.deleteBattle(b.id)})}
                />
              )}
              {page === "ingredients" && <InventoryPage
                ingredients={data.ingredients}
                locationItems={locationItems}
                inventoryLocation={inventoryLocation}
                locationError={locationError}
                search={search}
                category={category}
                setSearch={setSearch}
                setCategory={setCategory}
                chooseLocation={chooseInventoryLocation}
                retry={reload}
                openIngredient={(item) => open({ kind: "ingredientDetail", item })}
                openLocationEditor={(item) => open({ kind: 'ingredient', item, focusLocation: true })}
                actions={inventoryActions}
              />}
              {page === "adjustments" && <InventoryAdjustmentsPage busy={busy} refreshKey={revision}
                revoke={(id) => open({ kind: "recovery", recoveryKind: "adjustment", id })} />}
              {page === "dishes" && <DishesPage dishes={data.dishes} search={search} setSearch={setSearch}
                edit={(item) => open({ kind: "dish", item })}
                remove={(item) => void requestDishDelete(item)} />}
              {page === "plans" && <PlansPage plans={data.plans}
                onUsePlan={(plan) => { navigate("battles"); open({ kind: "battle", plan }); }}
                edit={(item) => open({ kind: "plan", item })}
                remove={(item) => open({ kind: "action", title: "删除这个搭配？", message: "将删除这个模板。已经复制出的作战菜单不受影响。", run: () => api.deletePlan(item.id) })} />}
              {page === "consumptions" && <ConsumptionPage consumptions={data.consumptions} search={search}
                status={consumptionStatus} setSearch={setSearch} setStatus={setConsumptionStatus} />}
            </>
          )
        )}
        {page === 'ingredients' && <div className="inventory-ledger-link"><button onClick={() => navigate('adjustments')}>变质 / 损坏记录 <Icon name="arrow" size={17} /></button></div>}
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
      {modal && data && <AppModal
        modal={modal}
        data={data}
        busy={busy}
        actionError={actionError}
        editConflict={editConflict}
        recoveryDrafts={recoveryDrafts}
        setModal={setModal}
        setBusy={setBusy}
        setEditConflict={setEditConflict}
        setActionError={setActionError}
        setRecoveryDrafts={setRecoveryDrafts}
        setNotice={setNotice}
        setData={setData}
        setDate={setDate}
        reload={reload}
        navigate={navigate}
        open={open}
        mutate={mutate}
      />}
    </div>
  );
}
