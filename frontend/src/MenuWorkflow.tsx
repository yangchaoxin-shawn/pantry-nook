import { initialUsage, inventoryVersion, usageValue } from './menu-confirm-logic';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, localDate, type Battle, type BattleInput, type BattleConfirm, type Dish, type Ingredient, type MealPlan, type Consumption } from './api';

const MEALS = { breakfast: '早餐', lunch: '午餐', dinner: '晚餐' } as const;
type Meal = keyof typeof MEALS;
type PrepBase = { dish_id: number; planned_quantity_text?: string | null };
type InventoryPrep = PrepBase & { ingredient_id: number; pending_ingredient_name?: null };
type PendingPrep = PrepBase & { ingredient_id?: null; pending_ingredient_name: string };
type Prep = InventoryPrep | PendingPrep;
const inventoryPrep = (dish_id: number, ingredient_id: number, planned_quantity_text?: string | null): InventoryPrep => ({ dish_id, ingredient_id, planned_quantity_text });
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

export function MenuTimeline({ battles, consumptions, edit, confirm, cancel, revoke, remove, copy }: {
  battles: Battle[]; consumptions: Consumption[];
  edit: (b: Battle) => void; confirm: (b: Battle) => void; cancel: (b: Battle) => void;
  revoke: (b: Battle) => void; remove: (b: Battle) => void; copy: (b: Battle) => void;
}) {
  const [historyDate, setHistoryDate] = useState('');
  const sorted = [...battles].sort((a, b) => b.battle_date.localeCompare(a.battle_date) ||
    ((b.meal_slot ? { breakfast: 1, lunch: 2, dinner: 3 }[b.meal_slot] : 0) -
      (a.meal_slot ? { breakfast: 1, lunch: 2, dinner: 3 }[a.meal_slot] : 0)) || b.created_at.localeCompare(a.created_at) || b.id-a.id);
  function card(b: Battle) {
    const history = consumptions.filter(c => c.daily_battle_id === b.id);
    const preparation = preparationState(b);
    const primaryAction = preparation === 'ready' ? '做完了，核对用料' : preparation === 'missing-ingredient' ? '补全耗材' : '补全预计量';
    return <article className="menu-order" key={b.id}>
      <div className="section-heading"><h3>{b.battle_date} · {b.meal_slot ? MEALS[b.meal_slot] : '未分类'}</h3>
        <span className={`badge ${b.status}`}>{b.status === 'planned' ? '待完成' : b.status === 'confirmed' ? '已完成' : '已取消'}</span></div>
      <p className="menu-order-dishes">{b.dishes.map(d => d.name).join(' · ')}</p>
      <details className="menu-order-details"><summary>{b.status === 'planned' ? '查看备餐食材' : '查看用料与记录'}</summary>
        {b.status === 'planned' && b.dishes.map(d => <div key={d.id} className="menu-dish-prep"><strong>{d.name}</strong>
          <p>{b.preparations.filter(p => p.dish_id === d.dish_id).map(p => `${p.ingredient_id === null ? `待购买：${p.pending_ingredient_name}` : p.ingredient_name}${p.planned_quantity_text ? `（预计${p.planned_quantity_text}）` : ''}${p.ingredient_id !== null && p.ingredient_status !== 'active' ? ' · 已不在库' : ''}`).join('、') || '还没有选择食材，可编辑补充'}</p></div>)}
        {history.length > 0 ? history.map(c => <p key={c.id} className="menu-usage-line">{c.daily_battle_dish_name || '本餐'} · {c.ingredient_name}：用了{c.quantity_used_text}<span className="muted">{c.status === 'reversed' ? '（已撤销）' : ''}{c.recovery_merges?.map(m => <span key={m.id}> · 已合并恢复到{m.target_name}</span>)}</span></p>) : b.status !== 'planned' && <p className="muted">{b.status === 'cancelled' ? '未执行，不影响库存。' : '本餐没有记录库存消耗。'}</p>}
      </details>
      <div className="actions">
        {b.status === 'planned' ? <><button className="btn-primary" onClick={() => confirm(b)}>{primaryAction}</button><button className="btn-ghost" onClick={() => edit(b)}>编辑菜单</button><button className="text-button" onClick={() => cancel(b)}>取消</button></> : <>
          <button className="btn-ghost" onClick={() => copy(b)}>再吃一次</button>{b.status === 'confirmed' && <button className="text-button" onClick={() => revoke(b)}>撤销确定</button>}</>}
        {b.status !== 'confirmed' && !history.length && <button className="text-button danger" onClick={() => remove(b)}>删除</button>}
      </div>
    </article>;
  }
  const pending = sorted.filter(b => b.status === 'planned');
  const done = sorted.filter(b => b.status !== 'planned' && (!historyDate || b.battle_date === historyDate));
  return <div className="menu-timeline">
    <section aria-label="待完成菜单"><div className="section-heading"><h2>准备吃什么</h2><span className="muted">{pending.length} 份待完成</span></div>
      {pending.length ? pending.map(card) : <div className="card menu-empty">还没有待完成的菜单，安排一餐吧。</div>}
    </section>
    <section aria-label="菜单历史"><div className="section-heading"><h2>之前的菜单</h2><div className="history-filter"><label>日期<input type="date" aria-label="历史日期" value={historyDate} onChange={e => setHistoryDate(e.target.value)} /></label>{historyDate && <button className="text-button" onClick={() => setHistoryDate('')}>全部日期</button>}</div></div>
      {done.length ? done.map(card) : <div className="card menu-empty">{historyDate ? '这一天没有已完成或已取消的菜单。' : '做完并确定后，菜单会留在这里。'}</div>}
    </section>
  </div>;
}

export function MenuEditor({ item, sourceDishes, plans, ingredients, initialPlan, copyFrom, busy, save, onDishAdded, notice }: {
  item?: Battle; sourceDishes: Dish[]; plans: MealPlan[]; ingredients: Ingredient[]; initialPlan?: MealPlan; copyFrom?: Battle; notice?: string;
  busy: boolean; save: (value: BattleInput) => void; onDishAdded: (dish: Dish) => void;
}) {
  const [dishes, setDishes] = useState(sourceDishes);
  const [selected, setSelected] = useState<number[]>(item?.dishes.map(d => d.dish_id) ?? copyFrom?.dishes.map(d => d.dish_id) ?? initialPlan?.dishes.map(d => d.id) ?? []);
  const [preps, setPreps] = useState<Prep[]>(item?.preparations.map(p => p.ingredient_id !== null
    ? inventoryPrep(p.dish_id, p.ingredient_id, p.planned_quantity_text)
    : pendingPrep(p.dish_id, p.pending_ingredient_name ?? '', p.planned_quantity_text)) ?? []);
  const [date, setDate] = useState(item?.battle_date ?? localDate());
  const [meal, setMeal] = useState<Meal>(item?.meal_slot ?? copyFrom?.meal_slot ?? 'dinner');
  const [name, setName] = useState('');
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');
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
  function toggle(did: number) { setSelected(s => s.includes(did) ? s.filter(id => id !== did) : [...s, did]); setPreps(p => p.filter(v => v.dish_id !== did)); }
  function submit(e: FormEvent) {
    e.preventDefault();
    if (incompletePreparation) {
      setError('待购食材请填写名称；库存耗材和待购名称只能二选一。');
      return;
    }
    if (missingPreparationDishes.length) {
      setError(`先为${missingPreparationDishes.map(id => dishes.find(d => d.id === id)?.name).filter(Boolean).join('、')}添加耗材。`);
      return;
    }
    save({ battle_date: date, meal_slot: meal, dish_ids: selected, preparations: preps,
      ...(item ? { expected_updated_at: item.updated_at } : {}) });
  }
  const unavailable = selected.filter(id => !dishes.some(d => d.id === id));
  const validSelected = selected.filter(id => !unavailable.includes(id));
  const missingPreparationDishes = validSelected.filter(id => !preps.some(prep => prep.dish_id === id));
  const incompletePreparation = preps.find(prep => !isInventoryPrep(prep) && !prep.pending_ingredient_name.trim());
  const plannedTotals = new Map<number, number>();
  for (const prep of preps) {
    if (prep.ingredient_id == null) continue;
    const ingredient = ingredients.find(item => item.id === prep.ingredient_id);
    const value = usageValue(initialUsage(prep.planned_quantity_text, ingredient?.stock_unit ?? null));
    if (value !== null) plannedTotals.set(prep.ingredient_id, (plannedTotals.get(prep.ingredient_id) ?? 0) + value);
  }
  return <form onSubmit={submit} className="menu-editor">
    {notice && <p className="form-notice" role="status">{notice}</p>}
    <div className="form-grid"><label className="field">日期<input type="date" aria-label="菜单日期" required value={date} onChange={e => setDate(e.target.value)} /></label>
      <label className="field">时段<select aria-label="菜单时段" required value={meal} onChange={e => setMeal(e.target.value as Meal)}>{Object.entries(MEALS).map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label></div>
    {plans.length > 0 && !item && <details className="menu-secondary-option"><summary>从常用搭配开始（选填）</summary><label className="field">选择搭配<select value={planId} onChange={e => { setPlanId(e.target.value); const plan = plans.find(p => p.id === Number(e.target.value)); if (plan) { setSelected(plan.dishes.map(d => d.id)); setPreps([]); } }}><option value="">不使用搭配</option>{plans.map(p => <option key={p.id} value={p.id}>{p.name || '未命名方案'} · {p.dishes.map(d => d.name).join('、')}</option>)}</select></label></details>}
    <div className="inline-dish-add"><label className="field">新菜名<input aria-label="新增菜品" placeholder="输入后加入本餐" value={name} maxLength={255} onChange={e => setName(e.target.value)} onKeyDown={e => { if(e.key === 'Enter') { e.preventDefault(); void addDish(); } }} /></label><button type="button" className="btn-ghost" disabled={adding || busy || !name.trim()} onClick={() => void addDish()}>{adding ? '添加中' : '加入'}</button></div>
    {error && <p className="form-error" role="alert">{error}</p>}
    <fieldset><legend>这餐吃什么</legend><div className="dish-choice-list">{dishes.filter(d => selected.includes(d.id) || d.name.includes(name.trim())).map(d => <label className="choice" key={d.id}><input type="checkbox" checked={selected.includes(d.id)} onChange={() => toggle(d.id)} />{d.name}</label>)}</div>{!dishes.length && <p className="muted">输入菜名后加入</p>}</fieldset>
    {unavailable.length > 0 && <p className="form-error">存在失效菜品<button type="button" className="text-button" onClick={() => { setSelected(s => s.filter(id => !unavailable.includes(id))); setPreps(p => p.filter(v => !unavailable.includes(v.dish_id))); }}>移除失效菜品</button></p>}
    {validSelected.map(did => <fieldset key={did}><legend>{dishes.find(d => d.id === did)?.name} · 备餐</legend>
      <div className="actions prep-add-actions"><label className="field">从库存添加耗材<select aria-label={`为${dishes.find(d => d.id === did)?.name}选择库存耗材`} value="" onChange={e => { if(e.target.value) setPreps(p => [...p, inventoryPrep(did, Number(e.target.value))]); }}><option value="">选择库存食材</option>{active.filter(i => !preps.some(p => p.dish_id === did && p.ingredient_id === i.id)).map(i => <option key={i.id} value={i.id}>{i.name} · 库存 {stockLabel(i)}</option>)}</select></label><button type="button" className="btn-ghost" onClick={() => setPreps(p => [...p, pendingPrep(did)])}>添加待购买食材</button></div>
      {preps.filter(p => p.dish_id === did).map((p, index) => { const ing = ingredients.find(i => i.id === p.ingredient_id); const unit = ing?.stock_unit; const total = p.ingredient_id == null ? null : plannedTotals.get(p.ingredient_id) ?? 0; const shortage = ing && total !== null && total > ing.stock_value; const inventory = isInventoryPrep(p); return <div className={`prep-row ${inventory ? 'prep-row--inventory' : 'prep-row--pending'}`} key={`${p.ingredient_id ?? 'pending'}-${index}`}>
        {inventory ? <><span>{ing?.name ?? '已不在库'}{unit ? ` · ${unit}` : ''}{shortage && <small className="prep-shortage">本餐预计 {total}{unit}，库存只有 {stockLabel(ing)}</small>}</span><label className="field">预计用量{unit ? `（${unit}）` : ''}<input aria-label={`${dishes.find(d => d.id === did)?.name}的预计${ing?.name ?? '食材'}用量`} placeholder={`预计用量${unit ? `（${unit}）` : ''}`} maxLength={255} value={p.planned_quantity_text ?? ''} onChange={e => setPreps(ps => ps.map(v => v === p ? { ...v, planned_quantity_text: e.target.value } : v))} /></label></> : <><label className="field">待购买食材<input aria-label={`${dishes.find(d => d.id === did)?.name}的待购食材`} placeholder="例如菠萝" maxLength={255} value={p.pending_ingredient_name} onChange={e => setPreps(ps => ps.map(v => v === p ? pendingPrep(v.dish_id, e.target.value, v.planned_quantity_text) : v))} /></label><label className="field">预计用量<input aria-label={`${dishes.find(d => d.id === did)?.name}的预计待购食材用量`} placeholder="例如 1个" maxLength={255} value={p.planned_quantity_text ?? ''} onChange={e => setPreps(ps => ps.map(v => v === p ? { ...v, planned_quantity_text: e.target.value } : v))} /></label><label className="field prep-link">已经入库？<select aria-label={`为${dishes.find(d => d.id === did)?.name}关联已入库食材`} value="" onChange={e => { if (e.target.value) setPreps(ps => ps.map(v => v === p ? inventoryPrep(v.dish_id, Number(e.target.value), v.planned_quantity_text) : v)); }}><option value="">关联库存（选填）</option>{active.map(i => <option key={i.id} value={i.id}>{i.name} · 库存 {stockLabel(i)}</option>)}</select></label></>}
        <button type="button" className="text-button" aria-label={`移除${dishes.find(d => d.id === did)?.name}的耗材`} onClick={() => setPreps(ps => ps.filter(v => v !== p))}>移除</button>
      </div>; })}
    </fieldset>)}
    {missingPreparationDishes.length > 0 && <p className="form-hint">每道菜至少选择一种耗材后才能保存；预计用量可以稍后补。</p>}
    {incompletePreparation && <p className="form-error">待购食材请填写名称；库存耗材和待购名称只能二选一。</p>}
    <button className="btn-primary" disabled={busy || adding || !selected.length || unavailable.length > 0 || missingPreparationDishes.length > 0 || !!incompletePreparation}>{busy ? '保存中' : '保存菜单'}</button>
  </form>;
}

type Usage = {
  key: number;
  ingredient_id: number;
  daily_battle_dish_id: number | null;
  ingredient_name: string;
  ingredient_status: string;
  planned_quantity_text: string;
  quantity_used_text: string;
  unit: string | null;
};
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
export function MenuConfirm({ battleId, busy, save, onPending, onEdit, onRestock }: { battleId: number; busy: boolean; onPending: (pending: boolean) => void; save: (payload: BattleConfirm) => Promise<void>; onEdit: () => void; onRestock: (names: string[]) => void }) {
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
  useEffect(() => {
    const controller = new AbortController();
    let reading = false;
    latest.current = null;
    async function refresh() {
      if (reading || submitting.current || document.visibilityState === 'hidden') return;
      reading = true;
      try {
        const [result, ingredients] = await Promise.all([api.battle(battleId, controller.signal), api.ingredients(controller.signal)]);
        if (controller.signal.aborted || submitting.current) return;
        const battle = result.data;
        if (!latest.current) {
          setOriginalMenuVersion(battle.updated_at);
          setRows(battle.preparations.filter((p): p is typeof p & { ingredient_id: number } => p.ingredient_id !== null).map((p, key) => {
            const unit = ingredients.find(i => i.id === p.ingredient_id)?.stock_unit ?? null;
            return { key, ingredient_id: p.ingredient_id, daily_battle_dish_id: p.daily_battle_dish_id,
              ingredient_name: p.ingredient_name ?? '已不在库食材', ingredient_status: p.ingredient_status ?? 'unavailable',
              planned_quantity_text: p.planned_quantity_text || '未填写',
              quantity_used_text: initialUsage(p.planned_quantity_text, unit), unit };
          }));
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
  if (!snapshot) return error ? <div role="status"><p className="form-notice">{error}</p><div className="actions"><button type="button" className="btn-ghost" onClick={onEdit}>返回编辑菜单</button><button type="button" className="btn-ghost" onClick={() => { setError(''); setRetry(r => r+1); }}>重新读取</button></div></div> : <p role="status">正在读取菜单和最新库存…</p>;
  const { battle, ingredients } = snapshot;
  const processed = battle.status !== 'planned';
  const menuChanged = battle.updated_at !== originalMenuVersion;
  const pending = battle.preparations.filter((preparation) => preparation.ingredient_id === null);
  const unitChanged = rows.some(r => {
    const ingredient = ingredients.find(i => i.id === r.ingredient_id);
    return ingredient !== undefined && r.unit !== ingredient.stock_unit;
  });
  const ids = [...new Set(rows.map(r => r.ingredient_id))];
  const unavailable = ids.some(id => !ingredients.some(i => i.id === id));
  const nonCalculable = ids
    .map((id) => ingredients.find((i) => i.id === id))
    .filter((ingredient): ingredient is Ingredient => !!ingredient && (ingredient.stock_value === null || !ingredient.stock_unit));
  const totals = new Map<number, { ingredient: Ingredient; used: number }>();
  let invalidUsage = false;
  for (const row of rows) {
    const ingredient = ingredients.find((item) => item.id === row.ingredient_id);
    const usedText = row.quantity_used_text.trim();
    const used = usageValue(usedText);
    if (!usedText || used === null) {
      invalidUsage = true;
      continue;
    }
    if (!ingredient) continue;
    const total = totals.get(row.ingredient_id);
    totals.set(row.ingredient_id, { ingredient, used: (total?.used ?? 0) + used });
  }
  const insufficient = [...totals.values()].some(({ ingredient, used }) => ingredient.stock_value !== null && used > ingredient.stock_value);
  const shortageItems = [...totals.values()].filter(({ ingredient, used }) => ingredient.stock_value !== null && used > ingredient.stock_value);
  const restockNames = [...new Set([
    ...pending.map((preparation) => preparation.pending_ingredient_name).filter((name): name is string => !!name),
    ...shortageItems.map(({ ingredient }) => ingredient.name),
    ...rows.filter((row) => !ingredients.some((ingredient) => ingredient.id === row.ingredient_id)).map((row) => row.ingredient_name),
  ])];
  const cannotConfirm = pending.length > 0 || unavailable || invalidUsage || nonCalculable.length > 0 || insufficient || menuChanged || unitChanged;
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
      {!processed && menuChanged && <p className="form-error" role="alert">菜单已被修改，请关闭后重新打开核对。</p>}
      {!processed && notice && <p className="form-notice" role="status">{notice}</p>}
      {error && <p className="form-error" role="alert">{error}<button type="button" className="text-button" onClick={() => setRetry(r => r + 1)}>重新读取</button></p>}
      {!processed && (pending.length > 0 || unavailable || insufficient) && <div className="review-summary review-summary--blocked" role="alert">
        <strong>暂时不能核对这餐</strong>
        <ul>
          {pending.map((preparation) => <li key={`pending-${preparation.id}`}>{preparation.pending_ingredient_name}：待购买{preparation.planned_quantity_text ? `，菜单预计 ${preparation.planned_quantity_text}` : ''}</li>)}
          {rows.filter((row, index, all) => !ingredients.some((item) => item.id === row.ingredient_id) && all.findIndex((item) => item.ingredient_id === row.ingredient_id) === index).map((row) => <li key={`missing-${row.ingredient_id}`}>{row.ingredient_name}：已不在库</li>)}
          {shortageItems.map(({ ingredient, used }) => <li key={`short-${ingredient.id}`}>{ingredient.name}：本餐实际填写 {quantityLabel(used, ingredient.stock_unit)}，当前库存只有 {stockLabel(ingredient)}</li>)}
        </ul>
        <span className="review-summary-action">补货后返回编辑菜单，将待购买食材关联到库存，再继续核对。</span>
        <div className="actions review-summary-actions">
          <button type="button" className="btn-ghost" onClick={onEdit}>返回编辑菜单</button>
          <button type="button" className="btn-primary" onClick={() => onRestock(restockNames)}>去补货</button>
        </div>
      </div>}
      {unitChanged && <p className="form-error" role="alert">库存单位已改变，请按新单位重新填写实际用量。</p>}
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
                    {i ? <span className="muted">菜单预计 {r.planned_quantity_text} · 当前库存 {stockLabel(i)}</span> : <span className="muted">菜单预计 {r.planned_quantity_text} · 已不在库</span>}
                    {!i && <p className="confirm-row-status">已不在库。请返回编辑菜单替换或移除此食材。</p>}
                    {rowInsufficient && <p className="confirm-row-status">本餐实际填写 {quantityLabel(totals.get(r.ingredient_id)?.used ?? 0, i?.stock_unit)}，当前库存只有 {stockLabel(i)}。</p>}
                  </div>
                  <div className="confirm-usage-input">
                    <label className="field">
                      实际用量{i?.stock_unit ? `（${i.stock_unit}）` : ''}
                      <input
                        aria-label={`${d.name}的${i?.name}实际用量`}
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
            <div className="confirm-usage-meta"><strong>{preparation.pending_ingredient_name}</strong><span className="muted">待购买{preparation.planned_quantity_text ? ` · 菜单预计 ${preparation.planned_quantity_text}` : ''}</span><p className="confirm-row-status">先补货并返回编辑菜单关联库存，才能确认。</p></div>
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
      {invalidUsage && <p className="form-error" role="alert">实际用量可填 1、0.5、1/2 或 1/3；单位已标在标题中。</p>}
      {nonCalculable.length > 0 && <p className="form-error" role="alert">{nonCalculable.map((i) => i.name).join('、')}缺少可计算的库存数量或单位，请先到库存详情补全后再确认。</p>}
      {!(pending.length > 0 || unavailable || insufficient) && (menuChanged || unitChanged) && <button type="button" className="btn-ghost" onClick={onEdit}>返回编辑菜单</button>}
      <button
        className="btn-primary"
        disabled={busy || sending || !!error || processed || cannotConfirm || (!rows.length && !without)}
      >
        {busy || sending ? '正在确定…' : '确定'}
      </button>
    </form>
  );
}
