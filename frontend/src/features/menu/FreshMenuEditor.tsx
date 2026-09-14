import { useEffect, useRef, useState, type ComponentProps } from 'react';
import { api, type Battle, type Dish, type Ingredient } from '../../shared/api/client';
import { MenuEditor } from './MenuWorkflow';

// 首次打开读取当前记录；后续只刷新库存，避免后台变化覆盖正在编辑的菜单。
export function FreshMenuEditor(props: ComponentProps<typeof MenuEditor>) {
  const battleId = props.item?.id;
  const [snapshot, setSnapshot] = useState<{ item?: Battle; ingredients: Ingredient[]; dishes: Dish[] } | null>(null);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const initialized = useRef(false);
  useEffect(() => {
    const controller = new AbortController();
    let reading = false;
    async function refresh() {
      if (reading || document.visibilityState === 'hidden') return;
      reading = true;
      try {
        const [battle, ingredients, dishes] = await Promise.all([
          !initialized.current && battleId ? api.battle(battleId, controller.signal) : Promise.resolve(null),
          api.ingredients(controller.signal), initialized.current ? Promise.resolve([]) : api.dishes(controller.signal),
        ]);
        if (controller.signal.aborted) return;
        setSnapshot(previous => previous ? { ...previous, ingredients } : { item: battle?.data, ingredients, dishes });
        initialized.current = true;
        setError('');
      } catch (failure) {
        if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : '读取失败，请重试。');
      } finally { reading = false; }
    }
    void refresh();
    const timer = window.setInterval(() => void refresh(), 3000);
    const resume = () => void refresh();
    window.addEventListener('focus', resume);
    document.addEventListener('visibilitychange', resume);
    return () => { controller.abort(); window.clearInterval(timer); window.removeEventListener('focus', resume); document.removeEventListener('visibilitychange', resume); };
  }, [battleId, retry]);
  return <>
    {error && <p className="form-error" role="alert">{error}<button type="button" className="text-button" onClick={() => setRetry(value => value + 1)}>重新读取</button></p>}
    {snapshot ? <MenuEditor {...props} item={snapshot.item} ingredients={snapshot.ingredients} sourceDishes={snapshot.dishes} busy={props.busy || !!error} /> : !error && <p role="status">正在读取这餐和最新库存…</p>}
  </>;
}
