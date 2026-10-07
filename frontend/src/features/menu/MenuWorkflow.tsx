import { initialUsage, inventoryVersion, resolvePlannedQuantity, usageValue } from './menu-confirm-logic';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, CATEGORIES, localDate, type Battle, type BattleInput, type BattleConfirm, type Dish, type Ingredient, type MealPlan } from '../../shared/api/client';
import { canConvertUnits, convertUnitValue } from '../inventory/batch-ingredient-logic';
import { restoreReviewRows, restockSuggestions, type ReviewDraft, type ReviewUsage } from './review-draft';
import { ALL_INGREDIENT_CATEGORIES, ingredientCandidates, type IngredientCategoryFilter } from './ingredient-category-filter';

const MEALS = { breakfast: '早餐', lunch: '午餐', dinner: '晚餐' } as const;
type Meal = keyof typeof MEALS;
type PrepBase = { dish_id: number; planned_quantity_text?: string | null; planned_quantity_unit?: string | null; previous_quantity_label?: string };
type InventoryPrep = PrepBase & { ingredient_id: number; pending_ingredient_name?: null };
type PendingPrep = PrepBase & { ingredient_id?: null; pending_ingredient_name: string };
type Prep = InventoryPrep | PendingPrep;
const inventoryPrep = (dish_id: number, ingredient_id: number, planned_quantity_text?: string | null, planned_quantity_unit?: string | null): InventoryPrep => ({ dish_id, ingredient_id, planned_quantity_text, planned_quantity_unit });
const pendingPrep = (dish_id: number, pending_ingredient_name = '', planned_quantity_text?: string | null): PendingPrep => ({ dish_id, pending_ingredient_name, planned_quantity_text });
const isInventoryPrep = (prep: Prep): prep is InventoryPrep => prep.ingredient_id != null;
const message = (e: unknown) => e instanceof Error ? e.message : '操作失败，请重试';

type PreparationState = 'ready' | 'missing-ingredient' | 'missing-amount';
const preparationState = (battle: Battle): PreparationState => {
  for (const dish of battle.dishes) {
    const preparations = battle.preparations.filter((prep) => prep.daily_battle_dish_id === dish.id);
    if (!preparations.length) return 'missing-ingredient';
    if (preparations.some((prep) => !prep.planned_quantity_text?.trim())) return 'missing-amount';
  }
  return 'ready';
};

const plannedLabel = (text: string | null | undefined, unit: string | null | undefined) => {
  const value = text?.trim();
  if (!value) return '';
  return unit && !value.toLocaleLowerCase().endsWith(unit.toLocaleLowerCase()) ? `${value}${unit}` : value;
};

export function MenuEditor({ item, sourceDishes, plans, ingredients, initialPlan, copyFrom, busy, save, onDishAdded, notice, submitLabel }: {
  item?: Battle; sourceDishes: Dish[]; plans: MealPlan[]; ingredients: Ingredient[]; initialPlan?: MealPlan; copyFrom?: Battle; notice?: string;
  busy: boolean; save: (value: BattleInput) => void | Promise<void>; onDishAdded: (dish: Dish) => void; submitLabel?: string;
}) {
  const [dishes, setDishes] = useState(sourceDishes);
  const [selected, setSelected] = useState<number[]>(item?.dishes.map(d => d.dish_id) ?? copyFrom?.dishes.map(d => d.dish_id) ?? initialPlan?.dishes.map(d => d.id) ?? []);
  const [preps, setPreps] = useState<Prep[]>(item?.preparations.map(p => p.ingredient_id !== null
    ? inventoryPrep(p.dish_id, p.ingredient_id, p.planned_quantity_text, p.planned_quantity_unit)
    : pendingPrep(p.dish_id, p.pending_ingredient_name ?? '', p.planned_quantity_text)) ?? []);
  const [date, setDate] = useState(item?.battle_date ?? localDate());
  const [meal, setMeal] = useState<Meal>(item?.meal_slot ?? copyFrom?.meal_slot ?? 'dinner');
  const [name, setName] = useState('');
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(false);
  const [expectedVersion, setExpectedVersion] = useState(item?.updated_at);
  const [conflict, setConflict] = useState<Battle | null>(null);
  const [unitReview, setUnitReview] = useState<{ key: string; lines: string[] } | null>(null);
  const [ingredientCategoryByDish, setIngredientCategoryByDish] = useState<Record<number, IngredientCategoryFilter>>({});
  const activeForm = useRef(true);
  const saving = useRef(false);
  useEffect(() => { activeForm.current = true; return () => { activeForm.current = false; }; }, []);
  const creating = useRef(false);
  const [planId, setPlanId] = useState(String(initialPlan?.id ?? ''));
  const active = ingredients;
  async function addDish() {
    if (!name.trim() || creating.current) return;
    const known = dishes.find(d => d.name.trim().toLocaleLowerCase() === name.trim().toLocaleLowerCase());
    if (known) { setSelected(s => s.includes(known.id) ? s : [...s, known.id]); setName(''); return; }
    creating.current = true; setAdding(true); setError('');
    try {
      let dish: Dish;
      try { dish = (await api.saveDish(undefined, name.trim())).data; }
      catch (e) {
        // 创建结果未知时只读核对，绝不自动重复提交。
        const existing = (await api.dishes()).find(d => d.name.trim().toLocaleLowerCase() === name.trim().toLocaleLowerCase());
        if (!existing) throw e;
        dish = existing;
      }
      setDishes(s => s.some(d => d.id === dish.id) ? s : [...s, dish]);
      setSelected(s => s.includes(dish.id) ? s : [...s, dish.id]); onDishAdded(dish); setName('');
    } catch(e) { setError(message(e)); } finally { creating.current = false; setAdding(false); }
  }
  function toggle(did: number) {
    const removing = selected.includes(did);
    setSelected(current => removing ? current.filter(id => id !== did) : [...current, did]);
    setPreps(current => current.filter(value => value.dish_id !== did));
    if (removing) setIngredientCategoryByDish(current => {
      const next = { ...current };
      delete next[did];
      return next;
    });
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy || checking || conflict || saving.current) return;
    if (incompletePreparation) {
      setError('待购食材请填写名称；库存耗材和待购名称只能二选一。');
      return;
    }
    if (missingPreparationDishes.length) {
      setError(`先为${missingPreparationDishes.map(id => dishes.find(d => d.id === id)?.name).filter(Boolean).join('、')}添加耗材。`);
      return;
    }
    if (invalidPlannedPreparation) {
      setError('预计用量请填写数字或分数，例如 1、0.5、1/2、1/3；单位会自动带上。');
      return;
    }
    saving.current = true; setChecking(true); setError('');
    try {
      let latestMenu = item;
      if (item) {
        const latest = (await api.battle(item.id)).data;
        if (!activeForm.current) return;
        if (latest.updated_at !== expectedVersion || latest.status !== 'planned') { setConflict(latest); return; }
        latestMenu = latest;
      }
      if (!activeForm.current) return;
      const conversions: string[] = [];
      const preparations = preps.map(prep => {
        if (!isInventoryPrep(prep)) return { dish_id: prep.dish_id, pending_ingredient_name: prep.pending_ingredient_name, planned_quantity_text: prep.planned_quantity_text };
        const latest = latestMenu?.preparations.find(value => value.dish_id === prep.dish_id && value.ingredient_id === prep.ingredient_id);
        const ingredient = ingredients.find(value => value.id === prep.ingredient_id);
        const planned = resolvePlannedQuantity(prep.planned_quantity_text, prep.planned_quantity_unit, ingredient?.stock_unit, latest?.planned_quantity_text, latest?.planned_quantity_unit);
        if (planned.review) conversions.push(`${ingredient?.name ?? '食材'}：${planned.review}`);
        return { dish_id: prep.dish_id, ingredient_id: prep.ingredient_id, planned_quantity_text: planned.text };
      });
      if (conversions.length) {
        const key = JSON.stringify([latestMenu?.updated_at, preparations]);
        if (unitReview?.key !== key) { setUnitReview({ key, lines: conversions }); return; }
      } else setUnitReview(null);
      await save({ battle_date: date, meal_slot: meal, dish_ids: selected, preparations,
        ...(item ? { expected_updated_at: expectedVersion } : {}) });
    } catch (failure) {
      if (activeForm.current) setError(message(failure));
      if (item) {
        try {
          const latest = (await api.battle(item.id)).data;
          if (activeForm.current && (latest.updated_at !== expectedVersion || latest.status !== 'planned')) setConflict(latest);
        } catch { /* 读取失败保留当前输入，由用户重试读取。 */ }
      }
    } finally { saving.current = false; if (activeForm.current) setChecking(false); }
  }
  const unavailable = selected.filter(id => !dishes.some(d => d.id === id));
  const validSelected = selected.filter(id => !unavailable.includes(id));
  const missingPreparationDishes = validSelected.filter(id => !preps.some(prep => prep.dish_id === id));
  const incompletePreparation = preps.find(prep => !isInventoryPrep(prep) && !prep.pending_ingredient_name.trim());
  const invalidPlannedPreparation = preps.find(prep => {
    if (!isInventoryPrep(prep) || !prep.planned_quantity_text?.trim()) return false;
    const unit = prep.planned_quantity_unit ?? ingredients.find(item => item.id === prep.ingredient_id)?.stock_unit ?? null;
    return initialUsage(prep.planned_quantity_text, unit) === '';
  });
  const plannedTotals = new Map<number, number>();
  for (const prep of preps) {
    if (prep.ingredient_id == null) continue;
    const ingredient = ingredients.find(item => item.id === prep.ingredient_id);
    const currentUnit = ingredient?.stock_unit ?? null;
    const savedUnit = prep.planned_quantity_unit ?? currentUnit;
    const parsed = usageValue(initialUsage(prep.planned_quantity_text, savedUnit));
    const value = parsed === null || !savedUnit || !currentUnit || savedUnit === currentUnit
      ? parsed
      : convertUnitValue(parsed, savedUnit, currentUnit);
    if (value !== null) plannedTotals.set(prep.ingredient_id, (plannedTotals.get(prep.ingredient_id) ?? 0) + value);
  }
  return <form onSubmit={submit} className="menu-editor">
    {notice && <p className="form-notice" role="status">{notice}</p>}
    {unitReview && <section className="form-notice" role="status"><strong>预计量将按当前库存单位保存</strong><ul>{unitReview.lines.map(line => <li key={line}>{line}</li>)}</ul><p>数量已按支持的单位换算，原输入仍在下方。核对后再次点击保存。</p></section>}
    {conflict && <section className="form-notice" role="alert"><strong>这餐已经更新，你的输入仍保留在下方。</strong><p>最新菜单：{conflict.battle_date} · {MEALS[conflict.meal_slot]} · {conflict.dishes.map(dish => dish.name).join('、')}</p><p>{conflict.preparations.map(prep => `${prep.ingredient_name ?? prep.pending_ingredient_name} ${plannedLabel(prep.planned_quantity_text, prep.planned_quantity_unit)}`).join('；')}</p>{conflict.status === 'planned' ? <><p>核对以上内容后，你可以继续修改下方输入，再保存这餐。</p><button type="button" className="btn-ghost" onClick={() => { setExpectedVersion(conflict.updated_at); setConflict(null); setError(''); }}>已核对最新内容，继续编辑</button></> : <p>这餐已{conflict.status === 'confirmed' ? '完成' : '取消'}，不能再保存编辑。</p>}</section>}
    <div className="form-grid"><label className="field">日期<input type="date" aria-label="菜单日期" required value={date} onChange={e => setDate(e.target.value)} /></label>
      <label className="field">时段<select aria-label="菜单时段" required value={meal} onChange={e => setMeal(e.target.value as Meal)}>{Object.entries(MEALS).map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label></div>
    {plans.length > 0 && !item && <details className="menu-secondary-option"><summary>从常用搭配开始（选填）</summary><label className="field">选择搭配<select value={planId} onChange={e => { setPlanId(e.target.value); const plan = plans.find(p => p.id === Number(e.target.value)); if (plan) { setSelected(plan.dishes.map(d => d.id)); setPreps([]); } }}><option value="">不使用搭配</option>{plans.map(p => <option key={p.id} value={p.id}>{p.name || '未命名方案'} · {p.dishes.map(d => d.name).join('、')}</option>)}</select></label></details>}
    <div className="inline-dish-add"><label className="field">新菜名<input aria-label="新增菜品" placeholder="输入后加入本餐" value={name} maxLength={255} onChange={e => setName(e.target.value)} onKeyDown={e => { if(e.key === 'Enter') { e.preventDefault(); void addDish(); } }} /></label><button type="button" className="btn-ghost" disabled={adding || busy || !name.trim()} onClick={() => void addDish()}>{adding ? '添加中' : '加入'}</button></div>
    {error && <p className="form-error" role="alert">{error}</p>}
    <fieldset><legend>这餐吃什么</legend><div className="dish-choice-list">{dishes.filter(d => selected.includes(d.id) || d.name.includes(name.trim())).map(d => <label className="choice" key={d.id}><input type="checkbox" checked={selected.includes(d.id)} onChange={() => toggle(d.id)} />{d.name}</label>)}</div>{!dishes.length && <p className="muted">输入菜名后加入</p>}</fieldset>
    {unavailable.length > 0 && <p className="form-error">存在失效菜品<button type="button" className="text-button" onClick={() => { setSelected(s => s.filter(id => !unavailable.includes(id))); setPreps(p => p.filter(v => !unavailable.includes(v.dish_id))); }}>移除失效菜品</button></p>}
    {validSelected.map(did => {
      const dishName = dishes.find(d => d.id === did)?.name ?? '这道菜';
      const categoryFilter = ingredientCategoryByDish[did] ?? ALL_INGREDIENT_CATEGORIES;
      const linkedIngredientIds = preps.filter(prep => prep.dish_id === did && prep.ingredient_id != null).map(prep => prep.ingredient_id as number);
      const allCandidates = ingredientCandidates(active, linkedIngredientIds, ALL_INGREDIENT_CATEGORIES);
      const candidates = ingredientCandidates(active, linkedIngredientIds, categoryFilter);
      const emptyHint = active.length === 0
        ? '库存里还没有食材，可以先添加待购买食材。'
        : categoryFilter === ALL_INGREDIENT_CATEGORIES || allCandidates.length === 0
          ? '这道菜没有更多可关联的库存食材，已选食材仍保留在下方。'
          : `${categoryFilter}里暂时没有可关联的食材，其他大类还有 ${allCandidates.length} 项可选；已选食材仍保留。`;
      return <fieldset key={did}><legend>{dishName} · 备餐</legend>
        <div className="prep-stock-picker">
          <div className="prep-filter-heading"><span>按库存大类找食材</span><small>{candidates.length} 项可选</small></div>
          <div className="prep-category-filter" role="group" aria-label={`筛选${dishName}的库存食材大类`}>
            {[ALL_INGREDIENT_CATEGORIES, ...CATEGORIES].map(category => {
              const count = ingredientCandidates(active, linkedIngredientIds, category).length;
              return <button type="button" key={category} aria-pressed={categoryFilter === category} aria-label={`${category}，${count}项可选`} onClick={() => setIngredientCategoryByDish(current => ({ ...current, [did]: category }))}><span>{category}</span><small aria-hidden="true">{count}</small></button>;
            })}
          </div>
          <div className="actions prep-add-actions"><label className="field">从库存添加耗材<select aria-label={`为${dishName}选择库存耗材`} value="" disabled={!candidates.length} onChange={e => { const id = Number(e.target.value); if (id && candidates.some(item => item.id === id)) setPreps(current => current.some(prep => prep.dish_id === did && prep.ingredient_id === id) ? current : [...current, inventoryPrep(did, id)]); }}><option value="">{candidates.length ? `选择${categoryFilter === ALL_INGREDIENT_CATEGORIES ? '' : categoryFilter}库存食材` : '当前大类没有可选食材'}</option>{candidates.map(i => <option key={i.id} value={i.id}>{i.name} · 库存 {stockLabel(i)}</option>)}</select></label><button type="button" className="btn-ghost" onClick={() => setPreps(p => [...p, pendingPrep(did)])}>添加待购买食材</button></div>
          {!candidates.length && <p className="prep-filter-empty" role="status">{emptyHint}</p>}
        </div>
        {preps.filter(p => p.dish_id === did).map((p, index) => { const ing = ingredients.find(i => i.id === p.ingredient_id); const unit = ing?.stock_unit; const plannedUnit = p.planned_quantity_unit ?? unit; const unitChanged = !!p.planned_quantity_unit && !!unit && p.planned_quantity_unit !== unit; const total = p.ingredient_id == null ? null : plannedTotals.get(p.ingredient_id) ?? 0; const shortage = ing && total !== null && total > ing.stock_value; const inventory = isInventoryPrep(p); return <div className={`prep-row ${inventory ? 'prep-row--inventory' : 'prep-row--pending'}`} key={`${p.ingredient_id ?? 'pending'}-${index}`}>
          {inventory ? <><span>{ing?.name ?? '已不在库'}{unit ? ` · 当前库存单位 ${unit}` : ''}{shortage && <small className="prep-shortage">本餐预计 {total}{unit}，库存只有 {stockLabel(ing)}</small>}</span>{!ing && <label className="field">替换失效的库存关联<select aria-label={`为${dishName}替换失效食材`} value="" disabled={!candidates.length} onChange={e => { const target = candidates.find(value => value.id === Number(e.target.value)); if (target) setPreps(ps => ps.map(value => value === p ? { ...inventoryPrep(did, target.id, p.planned_quantity_unit === target.stock_unit ? p.planned_quantity_text : '', target.stock_unit), previous_quantity_label: plannedLabel(p.planned_quantity_text, p.planned_quantity_unit) } : value)); }}><option value="">{candidates.length ? '选择这次使用的在库食材' : '当前大类没有可选食材'}</option>{candidates.map(value => <option key={value.id} value={value.id}>{value.name} · 库存 {stockLabel(value)}</option>)}</select></label>}{p.previous_quantity_label && <small className="form-hint">原预计 {p.previous_quantity_label}；请核对这次使用的食材及当前单位。</small>}<label className="field">预计用量{plannedUnit ? `（${unitChanged ? `保存时 ${plannedUnit}` : plannedUnit}）` : ''}<input inputMode="decimal" aria-label={`${dishName}的预计${ing?.name ?? '食材'}用量`} placeholder={`预计用量${plannedUnit ? `（${plannedUnit}）` : ''}`} maxLength={255} value={p.planned_quantity_text ?? ''} onChange={e => setPreps(ps => ps.map(v => v === p ? { ...v, planned_quantity_text: e.target.value, planned_quantity_unit: unit } : v))} /></label>{unitChanged && <small className="muted">当前库存已改为 {unit}；保留原值会按 {plannedUnit} 核对，修改后按 {unit} 保存。</small>}</> : <><label className="field">待购买食材<input aria-label={`${dishName}的待购食材`} placeholder="例如菠萝" maxLength={255} value={p.pending_ingredient_name} onChange={e => setPreps(ps => ps.map(v => v === p ? pendingPrep(v.dish_id, e.target.value, v.planned_quantity_text) : v))} /></label><label className="field">预计用量<input inputMode="decimal" aria-label={`${dishName}的预计待购食材用量`} placeholder="例如 1个" maxLength={255} value={p.planned_quantity_text ?? ''} onChange={e => setPreps(ps => ps.map(v => v === p ? { ...v, planned_quantity_text: e.target.value } : v))} /></label><label className="field prep-link">已经入库？<select aria-label={`为${dishName}关联已入库食材`} value="" disabled={!candidates.length} onChange={e => { const ingredient = candidates.find(item => item.id === Number(e.target.value)); if (ingredient) setPreps(ps => ps.map(v => v === p ? inventoryPrep(v.dish_id, ingredient.id, v.planned_quantity_text, ingredient.stock_unit) : v)); }}><option value="">{candidates.length ? `选择${categoryFilter === ALL_INGREDIENT_CATEGORIES ? '' : categoryFilter}库存食材` : '当前大类没有可选食材'}</option>{candidates.map(i => <option key={i.id} value={i.id}>{i.name} · 库存 {stockLabel(i)}</option>)}</select></label></>}
          <button type="button" className="text-button" aria-label={`移除${dishName}的耗材`} onClick={() => setPreps(ps => ps.filter(v => v !== p))}>移除</button>
        </div>; })}
      </fieldset>;
    })}
    {missingPreparationDishes.length > 0 && <p className="form-hint">每道菜至少选择一种耗材后才能保存；预计用量可以稍后补。</p>}
    {incompletePreparation && <p className="form-error">待购食材请填写名称；库存耗材和待购名称只能二选一。</p>}
    {invalidPlannedPreparation && <p className="form-error">预计用量请填写数字或分数；单位会自动带上。</p>}
    <button className="btn-primary" disabled={busy || checking || !!conflict || adding || item?.status !== undefined && item.status !== 'planned' || !selected.length || unavailable.length > 0 || missingPreparationDishes.length > 0 || !!incompletePreparation || !!invalidPlannedPreparation}>{busy || checking ? '保存中' : submitLabel ?? '保存菜单'}</button>
  </form>;
}

type Usage = ReviewUsage;
const stockLabel = (ingredient?: Ingredient) => {
  if (!ingredient) return '';
  const text = (ingredient.stock_text || '未填写').trim() || '未填写';
  const unit = ingredient.stock_unit;
  return unit && !text.includes(unit)
    ? `${text}${unit}`
    : text;
};
const quantityLabel = (value: number, unit: string | null | undefined) => `${value}${unit ?? ''}`;
type ReviewSnapshot = { battle: Battle; ingredients: Ingredient[] };
export function MenuConfirm({ battleId, busy, save, onPending, onEdit, onRestock, draft }: { battleId: number; busy: boolean; onPending: (pending: boolean) => void; save: (payload: BattleConfirm) => Promise<void>; onEdit: (battle: Battle | null, draft?: ReviewDraft) => void; onRestock: (names: string[], battle: Battle, draft: ReviewDraft, ingredients: Ingredient[]) => void; draft?: ReviewDraft }) {
  const [snapshot, setSnapshot] = useState<ReviewSnapshot | null>(null);
  const latest = useRef<ReviewSnapshot | null>(null);
  const [originalMenuVersion, setOriginalMenuVersion] = useState<string | null>(null);
  const submitting = useRef(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [retry, setRetry] = useState(0);
  const [rows, setRows] = useState<Usage[]>([]);
  const [without, setWithout] = useState(false);
  const initialDraft = useRef(draft);
  useEffect(() => {
    const controller = new AbortController();
    let reading = false;
    async function refresh() {
      if (reading || submitting.current || document.visibilityState === 'hidden') return;
      reading = true;
      try {
        const [result, ingredients] = await Promise.all([api.battle(battleId, controller.signal), api.ingredients(controller.signal)]);
        if (controller.signal.aborted || submitting.current) return;
        const battle = result.data;
        if (!latest.current) {
          setOriginalMenuVersion(initialDraft.current?.battleId === battleId ? initialDraft.current.menuVersion : battle.updated_at);
          setWithout(initialDraft.current?.without ?? false);
          setRows(restoreReviewRows(battle.preparations.filter((p): p is typeof p & { ingredient_id: number } => p.ingredient_id !== null).map((p, key) => {
            const unit = ingredients.find(i => i.id === p.ingredient_id)?.stock_unit ?? null;
            const plannedUnit = p.planned_quantity_unit ?? unit;
            const originalUsage = initialUsage(p.planned_quantity_text, plannedUnit);
            const parsedUsage = usageValue(originalUsage);
            const converted = plannedUnit && unit && plannedUnit !== unit && parsedUsage !== null
              ? convertUnitValue(parsedUsage, plannedUnit, unit) : null;
            const quantityUsed = converted === null ? originalUsage : Number(converted.toFixed(6)).toString();
            return { key, ingredient_id: p.ingredient_id, daily_battle_dish_id: p.daily_battle_dish_id,
              ingredient_name: p.ingredient_name ?? '已不在库食材', ingredient_status: p.ingredient_status ?? 'unavailable',
              planned_quantity_text: p.planned_quantity_text || '未填写', planned_quantity_unit: plannedUnit,
              converted_notice: converted === null ? null : `原预计 ${plannedLabel(p.planned_quantity_text, plannedUnit)}，已按当前库存单位换算`,
              quantity_used_text: quantityUsed, unit };
          }), battleId, initialDraft.current));
          if (initialDraft.current?.battleId === battleId) setNotice('已返回这餐并读取最新库存，之前填写的实际用量已保留，请继续核对。');
        } else if (inventoryVersion(latest.current.battle, latest.current.ingredients) !== inventoryVersion(battle, ingredients)) {
          setNotice('库存已更新，实际用量已保留，请核对后确定。');
        }
        latest.current = { battle, ingredients };
        setSnapshot(latest.current);
        setError('');
      } catch (e) {
        if (!controller.signal.aborted && !submitting.current) setError(message(e));
      } finally { reading = false; }
    }
    void refresh();
    const timer = window.setInterval(() => void refresh(), 3000);
    const resume = () => void refresh();
    window.addEventListener('focus', resume);
    document.addEventListener('visibilitychange', resume);
    return () => { controller.abort(); window.clearInterval(timer); window.removeEventListener('focus', resume); document.removeEventListener('visibilitychange', resume); };
  }, [battleId, retry]);
  if (!snapshot) return error ? <div role="status"><p className="form-notice">{error}</p><div className="actions"><button type="button" className="btn-ghost" onClick={() => onEdit(null, initialDraft.current)}>编辑这餐</button><button type="button" className="btn-ghost" onClick={() => { setError(''); setRetry(r => r+1); }}>重新读取</button></div></div> : <p role="status">正在读取菜单和最新库存…</p>;
  const { battle, ingredients } = snapshot;
  const processed = battle.status !== 'planned';
  const menuChanged = battle.updated_at !== originalMenuVersion;
  const pending = battle.preparations.filter((preparation) => preparation.ingredient_id === null);
  const currentDraft = (): ReviewDraft => ({ battleId, menuVersion: originalMenuVersion ?? battle.updated_at, rows, without });
  const editMenu = () => onEdit(battle, currentDraft());
  const needsPreparation = preparationState(battle) !== 'ready';
  const unitChanged = rows.some(r => {
    const ingredient = ingredients.find(i => i.id === r.ingredient_id);
    return ingredient !== undefined && r.unit !== ingredient.stock_unit;
  });
  const incompatiblePlannedUnit = rows.some(r => {
    const ingredient = ingredients.find(i => i.id === r.ingredient_id);
    return !!ingredient?.stock_unit && !!r.planned_quantity_unit && ingredient.stock_unit !== r.planned_quantity_unit &&
      !canConvertUnits(r.planned_quantity_unit, ingredient.stock_unit);
  });
  const ids = [...new Set(rows.map(r => r.ingredient_id))];
  const unavailable = ids.some(id => !ingredients.some(i => i.id === id));
  const nonCalculable = ids
    .map((id) => ingredients.find((i) => i.id === id))
    .filter((ingredient): ingredient is Ingredient => !!ingredient && (ingredient.stock_value === null || !ingredient.stock_unit));
  const totals = new Map<number, { ingredient: Ingredient; used: number }>();
  const invalidUsageKeys = new Set<number>();
  for (const row of rows) {
    const ingredient = ingredients.find((item) => item.id === row.ingredient_id);
    const usedText = row.quantity_used_text.trim();
    const used = usageValue(usedText);
    if (!usedText || used === null) {
      invalidUsageKeys.add(row.key);
      continue;
    }
    if (!ingredient) continue;
    const total = totals.get(row.ingredient_id);
    totals.set(row.ingredient_id, { ingredient, used: (total?.used ?? 0) + used });
  }
  const invalidUsage = invalidUsageKeys.size > 0;
  const invalidUsageNames = [...invalidUsageKeys]
    .map((key) => rows.find((row) => row.key === key))
    .filter((row): row is (typeof rows)[number] => Boolean(row))
    .map((row) => ingredients.find((item) => item.id === row.ingredient_id)?.name ?? row.ingredient_name);
  // 菜单里每道菜已有关联但没填预计用量时，核对页也要点名（与入口汇总同口径）。
  const missingAmountDishes = battle.dishes.filter((dish) => {
    const preparations = battle.preparations.filter((prep) => prep.daily_battle_dish_id === dish.id);
    return preparations.length > 0 && preparations.some((prep) => !prep.planned_quantity_text?.trim());
  });
  const insufficient = [...totals.values()].some(({ ingredient, used }) => ingredient.stock_value !== null && used > ingredient.stock_value);
  const shortageItems = [...totals.values()].filter(({ ingredient, used }) => ingredient.stock_value !== null && used > ingredient.stock_value);
  const restockNames = restockSuggestions(battle, ingredients, rows, shortageItems.map(({ ingredient }) => ingredient.name));
  const cannotConfirm = needsPreparation || pending.length > 0 || unavailable || invalidUsage || nonCalculable.length > 0 || insufficient || menuChanged || unitChanged || incompatiblePlannedUnit;
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (submitting.current || processed || cannotConfirm || (!rows.length && !without)) return;
    submitting.current = true; setSending(true); onPending(true); setError('');
    try {
      // 提交前再读一次；这里的检查不能代替后端事务内的版本校验。
      const [result, freshIngredients] = await Promise.all([api.battle(battleId), api.ingredients()]);
      const fresh = { battle: result.data, ingredients: freshIngredients };
      latest.current = fresh; setSnapshot(fresh);
      if (fresh.battle.status !== 'planned' || fresh.battle.updated_at !== battle.updated_at ||
          inventoryVersion(battle, ingredients) !== inventoryVersion(fresh.battle, freshIngredients)) {
        setNotice('数据已更新，实际用量已保留，请重新核对后确定。');
        return;
      }
      await save({
        expected_updated_at: battle.updated_at,
        consumptions: rows.map(row => ({
          ingredient_id: row.ingredient_id, daily_battle_dish_id: row.daily_battle_dish_id,
          quantity_used_text: row.quantity_used_text.trim(),
          expected_updated_at: ingredients.find((ingredient) => ingredient.id === row.ingredient_id)?.updated_at ?? '',
        })),
      });
    } catch (e) {
      // 响应丢失或并发冲突只重新读取，不自动重发扣库存请求。
      setError(message(e));
      try {
        const [result, freshIngredients] = await Promise.all([api.battle(battleId), api.ingredients()]);
        latest.current = { battle: result.data, ingredients: freshIngredients };
        setSnapshot(latest.current);
        setNotice('已读取最新数据，请重新核对。');
      } catch { setError('无法确认操作结果，请恢复连接后重新读取；你的用量已保留。'); }
    } finally { submitting.current = false; setSending(false); onPending(false); }
  }
  return (
    <form onSubmit={submit}>
      <p className="dialog-description">
        {battle.battle_date} · {battle.meal_slot ? MEALS[battle.meal_slot] : '未分类'}
        <br />
        核对每种耗材的实际用量；点“确定”后自动更新库存。
      </p>
      {processed && <p className="form-notice" role="status">这餐已{battle.status === 'confirmed' ? '确认' : '取消'}，不能再次扣库存。关闭后即可查看最新记录。</p>}

      {!processed && notice && <p className="form-notice" role="status">{notice}</p>}
      {error && <p className="form-error" role="alert">{error}<button type="button" className="text-button" onClick={() => setRetry(r => r + 1)}>重新读取</button></p>}
      {!processed && (pending.length > 0 || unavailable || insufficient || missingAmountDishes.length > 0) && <div className="review-summary review-summary--blocked" role="alert">
        <strong>确认前，还差这几步</strong>
        <ul>
          {missingAmountDishes.map((dish) => <li key={`amount-${dish.id}`}>{dish.name}：菜单预计用量还没填，返回编辑这餐补齐</li>)}
          {pending.map((preparation) => <li key={`pending-${preparation.id}`}>{preparation.pending_ingredient_name}：{ingredients.some(item => item.name.trim().toLocaleLowerCase() === preparation.pending_ingredient_name?.trim().toLocaleLowerCase()) ? '库存已有同名食材，待你选择关联' : '尚未关联库存'}{preparation.planned_quantity_text ? `，菜单预计 ${preparation.planned_quantity_text}` : ''}</li>)}
          {rows.filter((row, index, all) => !ingredients.some((item) => item.id === row.ingredient_id) && all.findIndex((item) => item.ingredient_id === row.ingredient_id) === index).map((row) => <li key={`missing-${row.ingredient_id}`}>{row.ingredient_name}：已不在库</li>)}
          {shortageItems.map(({ ingredient, used }) => <li key={`short-${ingredient.id}`}>{ingredient.name}：本餐实际填写 {quantityLabel(used, ingredient.stock_unit)}，当前库存只有 {stockLabel(ingredient)}</li>)}
        </ul>
        <span className="review-summary-action">{pending.length || unavailable ? '已入库的食材可以直接关联；需要补货时，保存后会回到这餐继续处理。' : '补货保存后会回到这餐，你填写的实际用量会保留。'}</span>
        <div className="actions review-summary-actions">
          {(pending.length > 0 || unavailable) && <button type="button" className={restockNames.length ? 'btn-ghost' : 'btn-primary'} onClick={editMenu}>{restockNames.length ? '关联或替换库存' : '关联已入库食材'}</button>}
          <button type="button" className={restockNames.length ? 'btn-primary' : 'btn-ghost'} onClick={() => onRestock(restockNames, battle, currentDraft(), ingredients)}>{restockNames.length ? '补货并返回这餐' : '另外补货'}</button>
        </div>
      </div>}
      {!processed && (menuChanged || unitChanged || incompatiblePlannedUnit) && <p className="form-error" role="alert">{[
        menuChanged ? "这餐已被修改，你填写的实际用量已保留，请核对最新菜单后再继续" : "",
        unitChanged ? "库存单位已改变，请按新单位重新填写实际用量" : "",
        incompatiblePlannedUnit ? "库存单位与菜单保存时不同且不能自动换算，请返回编辑菜单重新填写预计用量" : "",
      ].filter(Boolean).join("；")}。</p>}
      {battle.dishes.map((d) => (
        <fieldset key={d.id} disabled={sending || processed || menuChanged}>
          <legend>{d.name}</legend>
          {rows
            .filter((r) => r.daily_battle_dish_id === d.id)
            .map((r) => {
              const i = ingredients.find((item) => item.id === r.ingredient_id);
              const rowInsufficient = i && totals.get(r.ingredient_id)?.used && i.stock_value !== null && totals.get(r.ingredient_id)!.used > i.stock_value;
              return (
                <div className="confirm-usage-row" key={r.key}>
                  <div className="confirm-usage-meta">
                    <strong>{i?.name ?? r.ingredient_name}</strong>
                    {i ? <span className="muted">菜单预计 {plannedLabel(r.planned_quantity_text, r.planned_quantity_unit)} · 当前库存 {stockLabel(i)}</span> : <span className="muted">菜单预计 {plannedLabel(r.planned_quantity_text, r.planned_quantity_unit)} · 已不在库</span>}
                    {r.converted_notice && <span className="form-hint">{r.converted_notice}</span>}
                    {!i && <p className="confirm-row-status">已不在库。请返回编辑菜单替换或移除此食材。</p>}
                    {rowInsufficient && <p className="confirm-row-status">本餐实际填写 {quantityLabel(totals.get(r.ingredient_id)?.used ?? 0, i?.stock_unit)}，当前库存只有 {stockLabel(i)}。</p>}
                  </div>
                  <div className="confirm-usage-input">
                    <label className="field">
                      实际用量{i?.stock_unit ? `（${i.stock_unit}）` : ''}
                      <input
                        aria-label={`${d.name}的${i?.name}实际用量`}
                        aria-invalid={invalidUsageKeys.has(r.key) || undefined}
                        required
                        maxLength={255}
                        inputMode="decimal"
                        placeholder="例如 1/3"
                        value={r.quantity_used_text}
                        disabled={!i}
                        onChange={(e) =>
                          setRows((rs) =>
                            rs.map((v) =>
                              v.key === r.key
                                ? { ...v, quantity_used_text: e.target.value, unit: i?.stock_unit ?? null }
                                : v,
                            ),
                          )
                        }
                      />
                    </label>
                  </div>
                </div>
              );
            })}
          {pending.filter((preparation) => preparation.daily_battle_dish_id === d.id).map((preparation) => <div className="confirm-usage-row" key={`pending-${preparation.id}`}>
            <div className="confirm-usage-meta"><strong>{preparation.pending_ingredient_name}</strong><span className="muted">待关联库存{preparation.planned_quantity_text ? ` · 菜单预计 ${preparation.planned_quantity_text}` : ''}</span><p className="confirm-row-status">选择这次使用的真实库存后，才能确认。</p></div>
          </div>)}
        </fieldset>
      ))}
      {!rows.length && !pending.length && (
        <label className="choice">
          <input
            type="checkbox"
            checked={without}
            onChange={(e) => setWithout(e.target.checked)}
          />
          这餐没有使用已记录的库存
        </label>
      )}
      {invalidUsage && <p className="form-error" role="alert">{[...new Set(invalidUsageNames)].join("、")}的实际用量还没填好（可填 1、0.5、1/2 或 1/3；单位已标在标题中，输入框已标红）。</p>}
      {nonCalculable.length > 0 && <p className="form-error" role="alert">{nonCalculable.map((i) => i.name).join('、')}缺少可计算的库存数量或单位，请先到库存详情补全后再确认。</p>}
      {!processed && (menuChanged || unitChanged || incompatiblePlannedUnit || needsPreparation || nonCalculable.length > 0) && <div className="form-notice"><p>{needsPreparation ? '这餐还有耗材或预计用量未补齐，请先编辑补全。' : '可以返回编辑这餐，核对关联和预计量。'}</p><button type="button" className="btn-ghost" onClick={editMenu}>编辑这餐并继续核对</button></div>}
      <button
        className="btn-primary"
        disabled={busy || sending || !!error || processed || cannotConfirm || (!rows.length && !without)}
      >
        {busy || sending ? '正在确定…' : '确定'}
      </button>
    </form>
  );
}
