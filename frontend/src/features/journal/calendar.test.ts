import { describe, expect, it } from 'vitest';
import type { JournalEntry } from './api';
import { entriesByDay, mergeDay, monthCells, shiftMonth, shortDate } from './calendar';

const photo = (id: string) => ({ id, image: { id } }) as unknown as JournalEntry['photos'][number];
const entry = (id: number, date: string, cover: string, ids: string[]) =>
  ({ id, entry_date: date, cover_upload_id: cover, photos: ids.map(photo), caption: '' }) as unknown as JournalEntry;

describe('日历墙', () => {
  it('周一开头，月初前补空位，天数按真实月份', () => {
    const october = monthCells('2026-10'); // 2026-10-01 是周四
    expect(october.slice(0, 4)).toEqual([null, null, null, 1]);
    expect(october.filter(Boolean)).toHaveLength(31);
    expect(monthCells('2028-02').filter(Boolean)).toHaveLength(29);
    expect(monthCells('2026-06')[0]).toBe(1); // 周一开始的月份不补空位
  });
  it('跨年翻月', () => {
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
  });
  it('同一天多顿合在一格，看图时每顿封面在前', () => {
    const days = entriesByDay([entry(2, '2026-10-11', 'b2', ['b1', 'b2']), entry(1, '2026-10-11', 'a1', ['a1']), entry(3, '2026-10-03', 'c1', ['c1'])]);
    expect([...days.keys()]).toEqual([11, 3]);
    expect(mergeDay(days.get(11)!).photos.map(item => item.id)).toEqual(['b2', 'b1', 'a1']);
  });
  it('今年省略年份，往年写出年份', () => {
    expect(shortDate('2026-03-05', '2026-10-16')).toBe('3 月 5 日');
    expect(shortDate('2025-12-31', '2026-10-16')).toBe('2025 年 12 月 31 日');
  });
});
