import type { JournalEntry } from './api';

/** 周一开头的月历格子；月初前的空位为 null。 */
export function monthCells(month: string): (number | null)[] {
  const [year, value] = month.split('-').map(Number);
  const lead = (new Date(year, value - 1, 1).getDay() + 6) % 7;
  const days = new Date(year, value, 0).getDate();
  return [...Array<null>(lead).fill(null), ...Array.from({ length: days }, (_, index) => index + 1)];
}

export function shiftMonth(month: string, delta: number) {
  const [year, value] = month.split('-').map(Number);
  const next = new Date(year, value - 1 + delta, 1);
  return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}`;
}

export function entriesByDay(entries: JournalEntry[]) {
  const days = new Map<number, JournalEntry[]>();
  for (const entry of entries) {
    const day = Number(entry.entry_date.slice(8, 10));
    days.set(day, [...(days.get(day) ?? []), entry]);
  }
  return days;
}

/** 同一天的几顿合成一组看图，封面在前，其余按记录顺序。 */
export function mergeDay(entries: JournalEntry[]): JournalEntry {
  const ordered = entries.flatMap(entry => [...entry.photos].sort((a, b) => Number(b.image.id === entry.cover_upload_id) - Number(a.image.id === entry.cover_upload_id)));
  return { ...entries[0], photos: ordered };
}

export function shortDate(value: string, today: string) {
  const label = `${Number(value.slice(5, 7))} 月 ${Number(value.slice(8, 10))} 日`;
  return value.slice(0, 4) === today.slice(0, 4) ? label : `${Number(value.slice(0, 4))} 年 ${label}`;
}
