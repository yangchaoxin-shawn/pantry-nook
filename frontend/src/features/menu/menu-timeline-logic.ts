import type { Battle } from '../../shared/api/client';

const MEAL_ORDER = { breakfast: 1, lunch: 2, dinner: 3 } as const;
type TimelineItem = Pick<Battle, 'id' | 'battle_date' | 'meal_slot' | 'created_at' | 'status'>;
export type MenuDateGroup<T extends TimelineItem> = { date: string; battles: T[] };

function groupDates<T extends TimelineItem>(battles: T[]): MenuDateGroup<T>[] {
  const groups: MenuDateGroup<T>[] = [];
  for (const battle of battles) {
    const last = groups.at(-1);
    if (last?.date === battle.battle_date) last.battles.push(battle);
    else groups.push({ date: battle.battle_date, battles: [battle] });
  }
  return groups;
}

/** 先按真实状态区分待完成与历史；历史日期筛选不隐藏较早的待完成餐。 */
export function menuTimelineSections<T extends TimelineItem>(battles: T[], historyDate = '') {
  const sorted = [...battles].sort((a, b) => b.battle_date.localeCompare(a.battle_date) ||
    (b.meal_slot ? MEAL_ORDER[b.meal_slot] : 0) - (a.meal_slot ? MEAL_ORDER[a.meal_slot] : 0) ||
    b.created_at.localeCompare(a.created_at) || b.id - a.id);
  const pending = sorted.filter(b => b.status === 'planned');
  const history = sorted.filter(b => b.status !== 'planned' && (!historyDate || b.battle_date === historyDate));
  return { pendingCount: pending.length, pending: groupDates(pending), history: groupDates(history) };
}
