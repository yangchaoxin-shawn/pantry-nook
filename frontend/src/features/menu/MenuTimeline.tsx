import { useState } from 'react';
import type { Battle, Consumption } from '../../shared/api/client';
import { LittlePerson } from '../../shared/ui/LittlePerson';
import { menuTimelineSections, type MenuDateGroup } from './menu-timeline-logic';
import './menu-timeline.css';

const MEALS = { breakfast: '早餐', lunch: '午餐', dinner: '晚餐' } as const;
const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

function preparationAction(battle: Battle) {
  for (const dish of battle.dishes) {
    const preparations = battle.preparations.filter(prep => prep.daily_battle_dish_id === dish.id);
    if (!preparations.length) return '补全耗材';
    if (preparations.some(prep => !prep.planned_quantity_text?.trim())) return '补全预计量';
  }
  return '做完了，核对用料';
}

function plannedLabel(text: string | null | undefined, unit: string | null | undefined) {
  const value = text?.trim();
  if (!value) return '';
  return unit && !value.toLocaleLowerCase().endsWith(unit.toLocaleLowerCase()) ? `${value}${unit}` : value;
}

export function MenuTimeline({ battles, consumptions, edit, confirm, cancel, restore, revoke, remove, copy }: {
  battles: Battle[]; consumptions: Consumption[];
  edit: (b: Battle) => void; confirm: (b: Battle) => void; cancel: (b: Battle) => void;
  restore: (b: Battle) => void; revoke: (b: Battle) => void; remove: (b: Battle) => void; copy: (b: Battle) => void;
}) {
  const [historyDate, setHistoryDate] = useState('');
  const sections = menuTimelineSections(battles, historyDate);

  function entry(battle: Battle) {
    const history = consumptions.filter(item => item.daily_battle_id === battle.id);
    const planned = battle.status === 'planned';
    return <article className={`meal-timeline-entry${planned ? ' meal-timeline-entry-planned' : ' meal-timeline-entry-history'}`} key={battle.id} aria-labelledby={`meal-title-${battle.id}`}>
      <div className="meal-timeline-entry-heading">
        <h3 id={`meal-title-${battle.id}`}>{battle.meal_slot ? MEALS[battle.meal_slot] : '未分类'}</h3>
        <span className={`badge ${battle.status}`}>{planned ? '待完成' : battle.status === 'confirmed' ? '已完成' : '已取消'}</span>
      </div>
      <div className="meal-timeline-dishes">{battle.dishes.map((dish, index) => <span className="meal-timeline-dish" key={dish.id}>
        <LittlePerson namespace="dish" businessId={dish.dish_id} className="meal-dish-person" />
        <span>{dish.name}</span>
        {index < battle.dishes.length - 1 && <i aria-hidden="true">·</i>}
      </span>)}</div>
      <details className="meal-timeline-details"><summary>{planned ? '查看备餐食材' : '查看用料与记录'}</summary>
        {planned && battle.dishes.map(dish => <div key={dish.id} className="menu-dish-prep"><strong>{dish.name}</strong>
          <p>{battle.preparations.filter(prep => prep.daily_battle_dish_id === dish.id).map(prep => `${prep.ingredient_id === null ? `待购买：${prep.pending_ingredient_name}` : prep.ingredient_name}${prep.planned_quantity_text ? `（预计${plannedLabel(prep.planned_quantity_text, prep.planned_quantity_unit)}）` : ''}${prep.ingredient_id !== null && prep.ingredient_status !== 'active' ? ' · 已不在库' : ''}`).join('、') || '还没有选择食材，可编辑补充'}</p></div>)}
        {history.length > 0 ? history.map(item => <p key={item.id} className="menu-usage-line">{item.daily_battle_dish_name || '本餐'} · {item.ingredient_name}：用了{item.quantity_used_text}<span className="muted">{item.status === 'reversed' ? '（已撤销）' : ''}{item.recovery_merges?.map(merge => <span key={merge.id}> · 已合并恢复到{merge.target_name}</span>)}</span></p>) : !planned && <p className="muted">{battle.status === 'cancelled' ? '未执行，不影响库存。' : '本餐没有记录库存消耗。'}</p>}
      </details>
      <div className="meal-timeline-actions">
        {planned ? <><button type="button" className="btn-primary" onClick={() => confirm(battle)}>{preparationAction(battle)}</button><button type="button" className="btn-ghost" onClick={() => edit(battle)}>编辑菜单</button><button type="button" className="text-button" onClick={() => cancel(battle)}>取消</button></> : <>
          <button type="button" className="btn-ghost" onClick={() => copy(battle)}>再吃一次</button>{battle.status === 'confirmed' && <button type="button" className="text-button" onClick={() => revoke(battle)}>撤销确定</button>}{battle.status === 'cancelled' && <button type="button" className="text-button" onClick={() => restore(battle)}>恢复为待完成</button>}</>}
        {battle.status !== 'confirmed' && !history.length && <button type="button" className="text-button danger" onClick={() => remove(battle)}>删除</button>}
      </div>
    </article>;
  }

  function dateGroups(groups: MenuDateGroup<Battle>[]) {
    return <div className="meal-date-groups">{groups.map(group => {
      const [year, month, day] = group.date.split('-');
      const weekday = WEEKDAYS[new Date(`${group.date}T12:00:00`).getDay()];
      return <section className="meal-date-group" key={group.date} aria-label={`${group.date}的餐安排`}>
        <div className="meal-date-stamp"><time dateTime={group.date}><span className="meal-date-year">{year}</span><span className="meal-date-day">{month}<i>/</i>{day}</span></time><span className="meal-date-weekday">{weekday}</span></div>
        <div className="meal-date-entries">{group.battles.map(entry)}</div>
      </section>;
    })}</div>;
  }

  return <div className="meal-journal">
    <section aria-label="待完成菜单"><div className="meal-journal-heading"><div><span className="meal-journal-kicker">一餐一餐，好好吃饭</span><h2>准备吃什么</h2></div><span className="muted">{sections.pendingCount} 份待完成</span></div>
      {sections.pending.length ? dateGroups(sections.pending) : <div className="card menu-empty">还没有待完成的菜单，安排一餐吧。</div>}
    </section>
    <section className="meal-journal-history" aria-label="菜单历史"><div className="meal-journal-heading"><div><span className="meal-journal-kicker">留下的，也是生活</span><h2>之前的菜单</h2></div><div className="meal-history-filter"><label>日期<input type="date" aria-label="历史日期" value={historyDate} onChange={event => setHistoryDate(event.target.value)} /></label>{historyDate && <button type="button" className="text-button" onClick={() => setHistoryDate('')}>全部日期</button>}</div></div>
      {sections.history.length ? dateGroups(sections.history) : <div className="card menu-empty">{historyDate ? '这一天没有已完成或已取消的菜单。' : '做完并确定后，菜单会留在这里。'}</div>}
    </section>
  </div>;
}
