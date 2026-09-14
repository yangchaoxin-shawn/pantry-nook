import { useRef, useState, type ComponentProps } from 'react';
import { api, ApiError, type Battle, type Dish, type Ingredient, type MealPlan } from '../../shared/api/client';
import { Dialog } from '../../shared/ui/Primitives';
import { IngredientBatchEditor } from '../inventory/InventoryEditors';
import { stockLabel } from '../inventory/inventory-format';
import { FreshMenuEditor } from './FreshMenuEditor';
import { MenuConfirm } from './MenuWorkflow';
import { acceptEditedMenu, type ReviewDraft } from './review-draft';

type Step = 'review' | 'restock' | 'reading' | 'edit' | 'uncertain';
const MEALS = { breakfast: '早餐', lunch: '午餐', dinner: '晚餐' } as const;

export function MenuReviewFlow({ item, initialIngredients, dishes, plans, onDishAdded, onRefresh, onClose, onConfirmed }: {
  item: Battle; initialIngredients: Ingredient[]; dishes: Dish[]; plans: MealPlan[];
  onDishAdded: (dish: Dish) => void;
  onRefresh: (battle: Battle, ingredients?: Ingredient[]) => void;
  onClose: (changed: boolean) => void; onConfirmed: () => void;
}) {
  const [step, setStep] = useState<Step>('review');
  const [battle, setBattle] = useState(item);
  const [ingredients, setIngredients] = useState(initialIngredients);
  const [draft, setDraft] = useState<ReviewDraft>();
  const [names, setNames] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [restockSaved, setRestockSaved] = useState(false);
  const [changed, setChanged] = useState(false);
  const [uncertainRead, setUncertainRead] = useState(false);
  const writeLock = useRef(false);

  function returnToReview() { setError(''); setStep('review'); }
  async function readAfterRestock(uncertain = false) {
    setBusy(true); setError('');
    if (uncertain) setUncertainRead(false);
    try {
      const [result, latestIngredients] = await Promise.all([api.battle(item.id), api.ingredients()]);
      setBattle(result.data); setIngredients(latestIngredients); onRefresh(result.data, latestIngredients);
      if (uncertain) { setUncertainRead(true); setStep('uncertain'); return; }
      const needsAssociation = result.data.preparations.some(prep => prep.ingredient_id === null || !latestIngredients.some(ingredient => ingredient.id === prep.ingredient_id));
      setStep(needsAssociation && result.data.status === 'planned' ? 'edit' : 'review');
    } catch (failure) { setError(failure instanceof Error ? failure.message : '读取失败，请重试。'); }
    finally { setBusy(false); }
  }
  const saveRestock: ComponentProps<typeof IngredientBatchEditor>['save'] = async (...args) => {
    if (writeLock.current || restockSaved) return;
    setNames([...new Set(args[0].map(ingredient => ingredient.name))]);
    writeLock.current = true; setBusy(true); setError('');
    try {
      await api.saveIngredientsBatch(...args);
      // 入库成功立即离开可提交表单；后续读取或关联失败只重试对应步骤。
      setChanged(true); setRestockSaved(true); setStep('reading');
      await readAfterRestock();
    } catch (failure) {
      if (failure instanceof ApiError) setError(failure.message);
      else {
        setChanged(true);
        setStep('uncertain');
        await readAfterRestock(true);
      }
    } finally { writeLock.current = false; setBusy(false); }
  };
  const title = step === 'restock' ? '为这餐补货' : step === 'edit' ? '补全这餐的库存关联' : '核对这一餐的实际用料';
  return <Dialog title={title} busy={busy} onClose={step === 'review' ? () => onClose(changed) : returnToReview}>
    {step !== 'review' && <div className="meal-flow-context"><p>{battle.battle_date} · {MEALS[battle.meal_slot]} · {battle.dishes.map(dish => dish.name).join('、')}</p><button type="button" className="text-button" disabled={busy} onClick={returnToReview}>{step === 'restock' ? '取消补货，返回核对' : '返回这餐核对'}</button></div>}
    {error && <p className="form-error" role="alert">{error}</p>}
    {step === 'review' && <MenuConfirm battleId={item.id} busy={busy} onPending={setBusy} draft={draft}
      onEdit={(latest, nextDraft) => { if (latest) setBattle(latest); setDraft(nextDraft); setError(''); setStep('edit'); }}
      onRestock={(suggestedNames, latest, nextDraft, latestIngredients) => { setNames(suggestedNames); setBattle(latest); setIngredients(latestIngredients); setDraft(nextDraft); setRestockSaved(false); setError(''); setStep('restock'); }}
      save={async payload => { await api.battleAction(item.id, 'confirm', payload); onConfirmed(); }} />}
    {step === 'restock' && <><p className="form-notice">只填写这次补入的数量。保存后会回到这餐，已填写的实际用量会保留。</p><IngredientBatchEditor busy={busy} suggestedNames={names} existingIngredients={ingredients} save={saveRestock} /></>}
    {step === 'reading' && <div role="status"><p>补货已保存，正在读取这餐和最新库存。此后重试不会再次入库。</p>{error && <button type="button" className="btn-primary" disabled={busy} onClick={() => void readAfterRestock()}>重新读取并继续</button>}</div>}
    {step === 'uncertain' && <div className="form-notice" role="alert"><strong>这次补货的结果暂未确认</strong><p>请核对当前库存，再返回这餐。这里不会自动再次提交补货。</p>{uncertainRead ? <ul>{names.map(name => { const ingredient = ingredients.find(value => value.name.trim().toLocaleLowerCase() === name.trim().toLocaleLowerCase()); return <li key={name}>{name}：{ingredient ? stockLabel(ingredient) : '当前未找到同名在库食材'}</li>; })}</ul> : <p>尚未读取到最新库存，请恢复连接后重新读取。</p>}<button type="button" className="btn-ghost" disabled={busy} onClick={() => void readAfterRestock(true)}>重新读取库存</button></div>}
    {step === 'edit' && <FreshMenuEditor item={battle} sourceDishes={dishes} plans={plans} ingredients={ingredients} busy={busy}
      notice={restockSaved ? '补货已保存。请明确选择这餐使用的库存，并核对预计量与单位；保存后继续核对。' : '请明确选择这餐使用的库存，并核对预计量与单位；保存后继续核对。'}
      submitLabel="保存并继续核对" onDishAdded={onDishAdded}
      save={async payload => {
        if (writeLock.current) return;
        writeLock.current = true; setBusy(true);
        try {
          const result = await api.saveBattle(item.id, payload);
          setChanged(true);
          setBattle(result.data); setDraft(current => acceptEditedMenu(current, result.data));
          onRefresh(result.data); setError(''); setStep('review');
        } finally { writeLock.current = false; setBusy(false); }
      }} />}
  </Dialog>;
}
