import { useRef, useState, type ComponentProps } from 'react';
import { api, ApiError, type Battle, type Dish, type Ingredient, type MealPlan } from '../../shared/api/client';
import { Dialog } from '../../shared/ui/Primitives';
import { IngredientBatchEditor } from '../inventory/InventoryEditors';
import { stockLabel } from '../inventory/inventory-format';
import { FreshMenuEditor } from './FreshMenuEditor';
import { MenuConfirm } from './MenuWorkflow';
import { planAutoAssociation } from './auto-association';
import { acceptEditedMenu, type ReviewDraft } from './review-draft';

type Step = 'review' | 'restock' | 'reading' | 'edit' | 'uncertain';
const MEALS = { breakfast: '早餐', lunch: '午餐', dinner: '晚餐' } as const;

export function MenuReviewFlow({ item, initialIngredients, dishes, plans, onDishAdded, onRefresh, onClose, onConfirmed }: {
  item: Battle; initialIngredients: Ingredient[]; dishes: Dish[]; plans: MealPlan[];
  onDishAdded: (dish: Dish) => void;
  onRefresh: (battle: Battle, ingredients?: Ingredient[]) => void;
  onClose: (changed: boolean) => void; onConfirmed: () => void;
}) {
  const [filledUsage, setFilledUsage] = useState(false);
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
  const [flowNotice, setFlowNotice] = useState('');
  const [flowNoticeEditable, setFlowNoticeEditable] = useState(true);
  const [editNotice, setEditNotice] = useState('');
  const writeLock = useRef(false);
  const restockedNames = useRef<string[]>([]);

  function returnToReview() { setError(''); setStep('review'); }
  async function readAfterRestock(uncertain = false, submittedNames = restockedNames.current) {
    setBusy(true); setError('');
    if (uncertain) setUncertainRead(false);
    try {
      const [result, latestIngredients] = await Promise.all([api.battle(item.id), api.ingredients()]);
      setBattle(result.data); setIngredients(latestIngredients); onRefresh(result.data, latestIngredients);
      if (uncertain) { setUncertainRead(true); setStep('uncertain'); return; }
      if (result.data.status !== 'planned') {
        setFlowNotice(`补货已保存；这餐已经${result.data.status === 'confirmed' ? '完成' : '取消'}，没有修改库存关联。`);
        setFlowNoticeEditable(false);
        setStep('review');
        return;
      }
      const plan = planAutoAssociation(result.data, latestIngredients, submittedNames);
      if (!plan.canSave) {
        setEditNotice(`补货已保存，但未自动修改关联：${plan.problems.join('；')}。请核对当前菜单。`);
        setStep('edit');
        return;
      }
      if (plan.associations.length) {
        try {
          const saved = await api.saveBattle(item.id, {
            battle_date: result.data.battle_date,
            meal_slot: result.data.meal_slot,
            dish_ids: result.data.dishes.map(dish => dish.dish_id),
            preparations: plan.preparations,
            expected_updated_at: result.data.updated_at,
          });
          const associatedNames = [...new Set(plan.associations.map(association => association.name))].join('、');
          setBattle(saved.data); setDraft(current => acceptEditedMenu(current, saved.data));
          onRefresh(saved.data, latestIngredients);
          if (plan.problems.length) {
            setEditNotice(`已自动关联${associatedNames}；其余项目需要确认：${plan.problems.join('；')}。`);
            setStep('edit');
          } else {
            setFlowNotice(`已自动关联${associatedNames}，预计量已按当前库存单位保存。`);
            setFlowNoticeEditable(true);
            setEditNotice('请核对或修改这餐使用的库存；保存后继续核对。');
            setStep('review');
          }
        } catch (failure) {
          const reason = failure instanceof Error ? failure.message : '自动关联保存失败';
          setEditNotice(`补货已保存，但自动关联未完成：${reason}。已读取当前菜单，请核对后保存；这里不会再次补货。`);
          setStep('edit');
        }
        return;
      }
      if (plan.problems.length) {
        setEditNotice(`补货已保存，但还需确认库存关联：${plan.problems.join('；')}。`);
        setStep('edit');
        return;
      }
      const needsAssociation = result.data.preparations.some(prep => prep.ingredient_id === null || !latestIngredients.some(ingredient => ingredient.id === prep.ingredient_id));
      setStep(needsAssociation && result.data.status === 'planned' ? 'edit' : 'review');
    } catch (failure) { setError(failure instanceof Error ? failure.message : '读取失败，请重试。'); }
    finally { setBusy(false); }
  }
  const saveRestock: ComponentProps<typeof IngredientBatchEditor>['save'] = async (...args) => {
    if (writeLock.current || restockSaved) return;
    const submittedNames = [...new Set(args[0].map(ingredient => ingredient.name))];
    restockedNames.current = submittedNames;
    setNames(submittedNames);
    writeLock.current = true; setBusy(true); setError('');
    try {
      await api.saveIngredientsBatch(...args);
      // 入库成功立即离开可提交表单；后续读取或关联失败只重试对应步骤。
      setChanged(true); setRestockSaved(true); setStep('reading');
      await readAfterRestock(false, submittedNames);
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
  const requestClose = () => {
    if (filledUsage && !window.confirm("已填写的实际用量还没确认提交，关闭后将丢失。确定关闭吗？")) return;
    onClose(changed);
  };
  return <Dialog title={title} busy={busy} onClose={step === 'review' ? requestClose : returnToReview}>
    {step !== 'review' && <div className="meal-flow-context"><p>{battle.battle_date} · {MEALS[battle.meal_slot]} · {battle.dishes.map(dish => dish.name).join('、')}</p><button type="button" className="text-button" disabled={busy} onClick={returnToReview}>{step === 'restock' ? '取消补货，返回核对' : '返回这餐核对'}</button></div>}
    {error && <p className="form-error" role="alert">{error}</p>}
    {step === 'review' && <>{flowNotice && <div className="form-notice" role="status"><strong>{flowNotice}</strong><p>{flowNoticeEditable ? '已回到原餐，实际用量仍保留；如匹配不合适，可以修改关联。' : '以下显示这餐的最新状态；这里不会再次提交补货。'}</p>{flowNoticeEditable && <button type="button" className="btn-ghost" onClick={() => { setFlowNotice(''); setStep('edit'); }}>修改关联</button>}</div>}<MenuConfirm battleId={item.id} busy={busy} onPending={setBusy} draft={draft} onFilledUsageChange={setFilledUsage}
      onEdit={(latest, nextDraft) => { if (latest) setBattle(latest); setDraft(nextDraft); setError(''); setStep('edit'); }}
      onRestock={(suggestedNames, latest, nextDraft, latestIngredients) => { restockedNames.current = []; setNames(suggestedNames); setBattle(latest); setIngredients(latestIngredients); setDraft(nextDraft); setRestockSaved(false); setFlowNotice(''); setFlowNoticeEditable(true); setEditNotice(''); setError(''); setStep('restock'); }}
      save={async payload => { await api.battleAction(item.id, 'confirm', payload); onConfirmed(); }} /></>}
    {step === 'restock' && <><p className="form-notice">只填写这次补入的数量。保存后会回到这餐，已填写的实际用量会保留。</p><IngredientBatchEditor busy={busy} suggestedNames={names} existingIngredients={ingredients} save={saveRestock} /></>}
    {step === 'reading' && <div role="status"><p>补货已保存，正在读取这餐和最新库存。此后重试不会再次入库。</p>{error && <button type="button" className="btn-primary" disabled={busy} onClick={() => void readAfterRestock()}>重新读取并继续</button>}</div>}
    {step === 'uncertain' && <div className="form-notice" role="alert"><strong>这次补货的结果暂未确认</strong><p>请核对当前库存，再返回这餐。这里不会自动再次提交补货。</p>{uncertainRead ? <ul>{names.map(name => { const ingredient = ingredients.find(value => value.name.trim().toLocaleLowerCase() === name.trim().toLocaleLowerCase()); return <li key={name}>{name}：{ingredient ? stockLabel(ingredient) : '当前未找到同名在库食材'}</li>; })}</ul> : <p>尚未读取到最新库存，请恢复连接后重新读取。</p>}<button type="button" className="btn-ghost" disabled={busy} onClick={() => void readAfterRestock(true)}>重新读取库存</button></div>}
    {step === 'edit' && <FreshMenuEditor item={battle} sourceDishes={dishes} plans={plans} ingredients={ingredients} busy={busy}
      notice={editNotice || (restockSaved ? '补货已保存。请明确选择这餐使用的库存，并核对预计量与单位；保存后继续核对。' : '请明确选择这餐使用的库存，并核对预计量与单位；保存后继续核对。')}
      submitLabel="保存并继续核对" onDishAdded={onDishAdded}
      save={async payload => {
        if (writeLock.current) return;
        writeLock.current = true; setBusy(true);
        try {
          const result = await api.saveBattle(item.id, payload);
          setChanged(true);
          setBattle(result.data); setDraft(current => acceptEditedMenu(current, result.data));
          onRefresh(result.data); setFlowNotice(''); setEditNotice(''); setError(''); setStep('review');
        } finally { writeLock.current = false; setBusy(false); }
      }} />}
  </Dialog>;
}
