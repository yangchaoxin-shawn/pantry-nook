import { describe, expect, it } from 'vitest';
import type { Battle } from '../../shared/api/client';
import { menuTimelineSections } from './menu-timeline-logic';

type TimelineItem = Pick<Battle, 'id' | 'battle_date' | 'meal_slot' | 'created_at' | 'status'>;
const meal = (id: number, date: string, status: Battle['status'], slot: Battle['meal_slot'] = 'dinner', created = '2026-09-14T09:00:00'): TimelineItem => ({ id, battle_date: date, status, meal_slot: slot, created_at: created });

describe('餐安排时间线', () => {
  it('历史筛选只影响历史，过去的待完成餐继续可达', () => {
    const result = menuTimelineSections([meal(1, '2026-08-01', 'planned'), meal(2, '2026-09-14', 'confirmed'), meal(3, '2026-09-13', 'cancelled')], '2026-09-14');
    expect(result.pendingCount).toBe(1);
    expect(result.pending[0].battles[0].id).toBe(1);
    expect(result.history.flatMap(group => group.battles.map(battle => battle.id))).toEqual([2]);
  });

  it('同日聚合餐次，保持日期和餐次倒序；不更改源列表', () => {
    const battles = [meal(1, '2026-09-14', 'planned', 'breakfast'), meal(2, '2026-09-13', 'planned'), meal(3, '2026-09-14', 'planned', 'dinner'), meal(4, '2026-09-14', 'planned', 'lunch')];
    const result = menuTimelineSections(battles);
    expect(result.pending.map(group => group.date)).toEqual(['2026-09-14', '2026-09-13']);
    expect(result.pending[0].battles.map(battle => battle.id)).toEqual([3, 4, 1]);
    expect(battles.map(battle => battle.id)).toEqual([1, 2, 3, 4]);
  });

  it('历史同日保留完成和取消记录，重复餐次按建立时间及 ID 稳定排序', () => {
    const result = menuTimelineSections([meal(2, '2026-09-14', 'cancelled'), meal(1, '2026-09-14', 'confirmed', 'dinner', '2026-09-14T10:00:00'), meal(3, '2026-09-14', 'confirmed')]);
    expect(result.history).toHaveLength(1);
    expect(result.history[0].battles.map(battle => battle.id)).toEqual([1, 3, 2]);
    expect(menuTimelineSections([], '2026-09-14')).toEqual({ pendingCount: 0, pending: [], history: [] });
  });
});
