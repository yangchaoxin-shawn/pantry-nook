import type { Dispatch, SetStateAction } from "react";
import { api, type Dish, type Ingredient, type MealPlan } from "../shared/api/client";
import { CatalogEditor } from "../features/catalog/CatalogEditors";
import { CasualUseEditor, IngredientDetail, WasteEditor } from "../features/inventory/InventoryDetails";
import { IngredientBatchEditor, IngredientEditor } from "../features/inventory/InventoryEditors";
import { stockLabel } from "../features/inventory/inventory-format";
import { FreshMenuEditor } from "../features/menu/FreshMenuEditor";
import { MenuReviewFlow } from "../features/menu/MenuReviewFlow";
import { RecoveryDialog, type RecoveryDraft } from "../features/recovery/RecoveryDialog";
import { Dialog, Field } from "../shared/ui/Primitives";
import type { AppData, Modal, Page } from "./types";

type Props = {
  modal: Modal;
  data: AppData;
  busy: boolean;
  actionError: string;
  editConflict: Ingredient | Dish | MealPlan | null;
  recoveryDrafts: Record<string, RecoveryDraft>;
  setModal: Dispatch<SetStateAction<Modal | null>>;
  setBusy: Dispatch<SetStateAction<boolean>>;
  setEditConflict: Dispatch<SetStateAction<Ingredient | Dish | MealPlan | null>>;
  setActionError: Dispatch<SetStateAction<string>>;
  setRecoveryDrafts: Dispatch<SetStateAction<Record<string, RecoveryDraft>>>;
  setNotice: Dispatch<SetStateAction<string>>;
  setData: Dispatch<SetStateAction<AppData | null>>;
  setDate: Dispatch<SetStateAction<string>>;
  reload: () => void;
  navigate: (page: Page) => void;
  open: (modal: Modal) => void;
  mutate: (run: () => Promise<unknown>, message: string) => Promise<void>;
};

function title(modal: Modal) {
  if (modal.kind === "recovery") return "核对恢复库存";
  if (modal.kind === "action") return modal.title;
  if (modal.kind === "confirm") return "核对这一餐的实际用料";
  if (modal.kind === "ingredient") return "编辑食材";
  if (modal.kind === "ingredientSingle") return "记录食材";
  if (modal.kind === "ingredientBatch") return "批量记录食材";
  if (modal.kind === "ingredientDetail") return `查看食材 · ${modal.item.name}`;
  if (modal.kind === "ingredientUse") return `用掉了 · ${modal.item.name}`;
  if (modal.kind === "ingredientWaste") return `处理变质/损坏 · ${modal.item.name}`;
  if (modal.kind === "dishInPlans") return "先处理常用搭配";
  if (modal.kind === "dishInMenus") return "先处理待完成菜单";
  if (modal.kind === "dish") return modal.item ? "编辑菜品" : "添加菜品";
  if (modal.kind === "plan") return modal.item ? "编辑搭配" : "创建搭配";
  return modal.item ? "编辑菜单" : "安排一餐";
}

export function AppModal(props: Props) {
  const { modal, data, busy, actionError, editConflict, recoveryDrafts, setModal, setBusy, setEditConflict, setActionError, setRecoveryDrafts, setNotice, setData, setDate, reload, navigate, open, mutate } = props;
  const close = () => { setModal(null); setEditConflict(null); };
  if (modal.kind === 'confirm') return <MenuReviewFlow key={modal.item.id} item={modal.item} initialIngredients={data.ingredients} dishes={data.dishes} plans={data.plans}
    onClose={changed => { close(); if (changed) reload(); }}
    onDishAdded={dish => setData(current => current ? { ...current, dishes: current.dishes.some(item => item.id === dish.id) ? current.dishes : [...current.dishes, dish] } : current)}
    onRefresh={(battle, ingredients) => setData(current => current ? { ...current, ingredients: ingredients ?? current.ingredients, battles: current.battles.map(item => item.id === battle.id ? battle : item) } : current)}
    onConfirmed={() => { setModal(null); setNotice('已确定，库存已更新，菜单已归入历史'); reload(); }} />;
  return <Dialog key={modal.kind} title={title(modal)} onClose={close} busy={busy}>
    {modal.kind === "recovery" && <RecoveryDialog kind={modal.recoveryKind} id={modal.id}
      draft={recoveryDrafts[`${modal.recoveryKind}:${modal.id}`]}
      onDraft={(draft) => setRecoveryDrafts((current) => ({ ...current, [`${modal.recoveryKind}:${modal.id}`]: draft }))}
      onPending={setBusy}
      onSuccess={() => {
        setRecoveryDrafts((current) => { const next = { ...current }; delete next[`${modal.recoveryKind}:${modal.id}`]; return next; });
        setModal(null); setNotice("已撤销，库存已恢复"); reload();
      }} />}
    {actionError && <p className="form-error" role="alert">{actionError}</p>}
    {editConflict && <section className="form-hint" aria-label="最新记录">
      <strong>对方已保存的内容</strong>
      <p>{editConflict.name || "未命名搭配"}{"stock_value" in editConflict && ` · ${editConflict.category} · ${stockLabel(editConflict)} · ${editConflict.location || "未填位置"}`}{"dishes" in editConflict && ` · ${editConflict.dishes.map((dish) => dish.name).join("、")}`}</p>
      {"note" in editConflict && <p>备注：{editConflict.note || "无"}</p>}
      <p>下方仍是你的输入。核对后可以继续修改，再次保存。</p>
      <button type="button" className="btn-ghost" onClick={() => {
        setModal((current) => {
          if (current?.kind === "ingredient") return { ...current, item: editConflict as Ingredient };
          if (current?.kind === "ingredientUse") return { ...current, item: editConflict as Ingredient };
          if (current?.kind === "dish") return { ...current, item: editConflict as Dish };
          if (current?.kind === "plan") return { ...current, item: editConflict as MealPlan };
          return current;
        });
        setEditConflict(null); setActionError("");
      }}>已核对，继续编辑</button>
    </section>}
    {modal.kind === "ingredient" && <IngredientEditor item={modal.item} focusLocation={modal.focusLocation} busy={busy} blocked={!!editConflict} save={(payload) => void mutate(() => api.saveIngredient(modal.item.id, payload), "食材已保存")} />}
    {(modal.kind === "ingredientBatch" || modal.kind === "ingredientSingle") && <IngredientBatchEditor busy={busy} single={modal.kind === "ingredientSingle"} suggestedNames={modal.kind === "ingredientBatch" ? modal.suggestedNames : undefined} existingIngredients={data.ingredients} save={(ingredients, resolutions, categoryResolutions, manualTotals) => void mutate(() => api.saveIngredientsBatch(ingredients, resolutions, categoryResolutions, manualTotals), `已记录 ${ingredients.length} 项食材`)} />}
    {modal.kind === "ingredientDetail" && <IngredientDetail item={modal.item} busy={busy} edit={() => open({ kind: "ingredient", item: modal.item })} use={() => open({ kind: "ingredientUse", item: modal.item })} waste={() => open({ kind: "ingredientWaste", item: modal.item })} />}
    {modal.kind === "ingredientUse" && <CasualUseEditor item={modal.item} busy={busy} blocked={!!editConflict} save={(payload) => void mutate(() => api.useIngredient(modal.item.id, payload), "已记录日常用掉，库存已更新")} />}
    {modal.kind === "ingredientWaste" && <WasteEditor item={modal.item} busy={busy} save={(payload) => void mutate(() => api.wasteIngredient(modal.item.id, payload), "库存已更新")} />}
    {modal.kind === "dish" && <form onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); void mutate(() => api.saveDish(modal.item?.id, String(form.get("name")), modal.item?.updated_at), "菜品已保存"); }}>
      <Field label="菜品名称"><input name="name" required maxLength={255} defaultValue={modal.item?.name} placeholder="例如：番茄炒蛋" /></Field>
      <button className="btn-primary submit" disabled={busy || !!editConflict}>{busy ? "保存中…" : "保存菜品"}</button>
    </form>}
    {modal.kind === "dishInPlans" && <><p className="dialog-description">“{modal.item.name}”正在被{modal.planNames.join("、")}使用。先编辑或删除这些搭配，再回来删除菜品。</p><div className="actions"><button className="btn-ghost" onClick={() => setModal(null)}>返回</button><button className="btn-primary" onClick={() => { setModal(null); navigate("plans"); }}>查看常用搭配</button></div></>}
    {modal.kind === "dishInMenus" && <><p className="dialog-description">“{modal.item.name}”正在被待完成菜单{modal.menuNames.join("、")}使用。先调整这些菜单，再回来删除菜品。</p><div className="actions"><button className="btn-ghost" onClick={() => setModal(null)}>返回</button><button className="btn-primary" onClick={() => { setModal(null); navigate("battles"); }}>查看餐安排</button></div></>}
    {modal.kind === "plan" && <CatalogEditor item={modal.item} dishes={data.dishes} busy={busy} blocked={!!editConflict} savePlan={(payload) => void mutate(() => api.savePlan(modal.item?.id, payload), "搭配已保存")} />}
    {modal.kind === "battle" && <FreshMenuEditor key={modal.item?.id ?? 'new'} item={modal.item} copyFrom={modal.copyFrom} initialPlan={modal.plan} notice={modal.notice} sourceDishes={data.dishes} plans={data.plans} ingredients={data.ingredients} busy={busy}
      onDishAdded={(dish) => setData((current) => current ? { ...current, dishes: current.dishes.some((item) => item.id === dish.id) ? current.dishes : [...current.dishes, dish] } : current)}
      save={(payload) => mutate(async () => { const result = await api.saveBattle(modal.item?.id, payload); setDate(result.data.battle_date); navigate("battles"); return result; }, "菜单已保存，备餐不会扣库存")} />}
    {modal.kind === "action" && <><p className="dialog-description">{modal.message}</p><div className="actions"><button className="btn-ghost" disabled={busy} onClick={() => setModal(null)}>返回</button><button className="btn-primary" disabled={busy} onClick={() => void mutate(modal.run, "操作已保存")}>{busy ? "处理中…" : "确认操作"}</button></div></>}
  </Dialog>;
}
